/**
 * SURV-DMS-200.2 — deterministic compact `DDD.MMSS` precision in `dmsToRad`.
 *
 * Bug (pre-fix): the compact branch read the fractional body through
 * floating-point subtraction (`(absVal - d) * 100`), so `45.3000` carried into
 * `45°30'40"` (45.511111111111106) instead of the oracle `45°30'00"` (45.5),
 * and a leading `-` misrouted the token into the hyphenated branch
 * (`-45.3000` -> -45.3 instead of -45.5).
 *
 * Fix: strip exactly one leading sign before the hyphen/compact decision, then
 * extract `MM`/`SS`/fractional-tail textually from the compact body. The
 * hyphenated branch is untouched. This suite uses an independent string oracle
 * (not `dmsToRad`) so it cannot reproduce the historical carry, and proves the
 * correction survives the RW5 importer and the `parseInput` DN direction route.
 */
import { describe, expect, it } from 'vitest';

import { RAD_TO_DEG, dmsToRad } from '../src/engine/angles';
import { cadParseBearingDegrees, cadParseDmsDegrees } from '../src/engine/cad/cadGeometryPrimitives';
import { importExternalInput } from '../src/engine/importers';
import {
  parseDmsAngleDegrees,
  parseQuadrantBearingDegrees,
} from '../src/engine/importers/sharedText';
import { parseDirectionAngleTokenDeg } from '../src/engine/importReviewFormatters';
import { parseInput } from '../src/engine/parse';
import {
  parseAngleTokenRad,
  parseQuadrantBearingTokenToRad,
  toDegrees,
} from '../src/engine/parseTokenHelpers';
import type { ParseOptions } from '../src/types';

// Differences below 1e-4 arcsec are physically meaningless (<0.05 µm at 1 km).
const ARCSEC_TOLERANCE = 1e-4;

// Independent string oracle written straight from the DDD.MMSS spec. It splits
// the textual digits instead of subtracting floating-point parts, so it cannot
// reproduce the historical binary carry the fix corrects.
const oracleCompactDegrees = (token: string): number => {
  let body = token.trim();
  let sign = 1;
  if (body.startsWith('-')) {
    sign = -1;
    body = body.slice(1);
  } else if (body.startsWith('+')) {
    body = body.slice(1);
  }

  if (body.includes('-')) {
    const [d, m, s] = body.split('-');
    return sign * (Number(d) + Number(m ?? 0) / 60 + Number(s ?? 0) / 3600);
  }

  const dot = body.indexOf('.');
  const intPart = dot === -1 ? body : body.slice(0, dot);
  const fracPart = dot === -1 ? '' : body.slice(dot + 1);
  const frac = fracPart.padEnd(4, '0');
  const mm = Number(frac.slice(0, 2));
  const ss = Number(frac.slice(2, 4));
  const tail = fracPart.length > 4 ? Number(`0.${fracPart.slice(4)}`) : 0;
  return sign * (Number(intPart || 0) + mm / 60 + (ss + tail) / 3600);
};

const ORACLE_TOKENS = [
  '45.3000',
  '+45.3000',
  '89.3000',
  '45.5800',
  '45.1234',
  '45.3030',
  '45.5959',
  '0.3000',
  '359.3000',
  '045-30-00',
] as const;

const rg = (token: string): number => dmsToRad(token) * RAD_TO_DEG;

describe('SURV-DMS-200.2 compact DDD.MMSS textual extraction', () => {
  it('matches the independent string oracle within surveying-grade tolerance', () => {
    for (const token of ORACLE_TOKENS) {
      const actualArcsec = rg(token) * 3600;
      const oracleArcsec = oracleCompactDegrees(token) * 3600;
      expect(Math.abs(actualArcsec - oracleArcsec), token).toBeLessThan(ARCSEC_TOLERANCE);
    }
  });

  it('reads 45.3000 as 45°30\'00" instead of the historical carry 45°30\'40"', () => {
    const deg = rg('45.3000');
    expect(deg).toBe(45.5);
    expect(deg).not.toBe(45.511111111111106);
    expect(deg * 3600).toBeCloseTo(45 * 3600 + 30 * 60, 9);
  });

  it('reads 45.3030 as 45°30\'30" and 45.5959 as 45°59\'59"', () => {
    expect(rg('45.3030')).toBeCloseTo(45 + 30 / 60 + 30 / 3600, 12);
    expect(rg('45.5959')).toBeCloseTo(45 + 59 / 60 + 59 / 3600, 12);
  });

  it('keeps the DD (decimal degrees) vs compact-DMS dialect split', () => {
    expect(parseAngleTokenRad('45.3000', {} as ParseOptions, 'dd') * RAD_TO_DEG).toBe(45.3);
    expect(parseAngleTokenRad('45.3000', { angleUnits: 'dd' } as ParseOptions, 'dms') * RAD_TO_DEG).toBe(
      45.3,
    );
    expect(parseAngleTokenRad('45.3000', { angleUnits: 'dms' } as ParseOptions, 'dd') * RAD_TO_DEG).toBe(
      45.5,
    );
    expect(parseAngleTokenRad('45.3000', { angleUnits: 'dms' } as ParseOptions, 'dms') * RAD_TO_DEG).toBe(
      45.5,
    );
    // SURV-DMS-200.2 P2: a leading sign must not force the compact-DMS hyphen
    // path. In dd mode the signed single-part body is decimal (-45.3); in dms
    // mode it is compact DDD.MMSS (-45.5). This is the blocked regression.
    expect(parseAngleTokenRad('-45.3000', {} as ParseOptions, 'dd') * RAD_TO_DEG).toBe(-45.3);
    expect(parseAngleTokenRad('-45.3000', {} as ParseOptions, 'dms') * RAD_TO_DEG).toBe(-45.5);
    // Genuine hyphenated bodies keep the bit-identical dmsToRad route in both
    // modes (the sign is included in the dmsToRad argument).
    expect(parseAngleTokenRad('-45-30-00', {} as ParseOptions, 'dd') * RAD_TO_DEG).toBe(-45.5);
    expect(parseAngleTokenRad('-45-30-00', {} as ParseOptions, 'dms') * RAD_TO_DEG).toBe(-45.5);
  });

  it('leaves the hyphenated branch bit-identical', () => {
    expect(rg('045-30-00')).toBe(45.5);
    expect(rg('45-30-00.5')).toBeCloseTo(45 + 30 / 60 + 0.5 / 3600, 12);
    // Multi-part negative hyphenated bodies are unaffected by the new
    // single-leading-sign handling.
    expect(rg('-45-30-00')).toBe(-45.5);
    expect(rg('45-')).toBe(45);
  });

  it('strips exactly one leading sign before the branch decision', () => {
    expect(rg('-45.3000')).toBe(-45.5);
    expect(rg('+45.3000')).toBe(45.5);
    expect(rg('-45.3000')).toBe(-rg('45.3000'));
  });
});

describe('SURV-DMS-200.2 negative controls (gates unchanged)', () => {
  it('keeps malformed tokens out at the gated import boundaries', () => {
    for (const token of ['abc1', '45abc', '0.0.0', '1e3']) {
      expect(parseDmsAngleDegrees(token), `parseDmsAngleDegrees ${token}`).toBeUndefined();
      expect(parseDirectionAngleTokenDeg(token), `parseDirectionAngleTokenDeg ${token}`).toBeUndefined();
    }
  });

  it('keeps CAD on its decimal dialect and quadrant decimal-body behaviour', () => {
    expect(cadParseDmsDegrees('45.3000')).toBe(45.3);
    expect(cadParseBearingDegrees('45.3000')).toBe(45.30000000000001);
    // parseTokenHelpers reads a no-hyphen quadrant body as a plain decimal.
    expect((parseQuadrantBearingTokenToRad('N45.3000E') ?? Number.NaN) * RAD_TO_DEG).toBe(45.3);
    expect(parseQuadrantBearingDegrees('N45.3000E')).toBe(45.5);
  });

  it('drops malformed DN direction tokens instead of emitting an angle', () => {
    for (const token of ['abc1', '45abc', '0.0.0', '1e3']) {
      const parsed = parseInput(['DB AT BS', `DN TO ${token}`, 'DE'].join('\n'));
      expect(
        parsed.observations.filter((observation) => observation.type === 'direction'),
        token,
      ).toHaveLength(0);
    }
  });
});

const rw5WithAngle = (angleToken: string): string =>
  [
    'JB,NM,SURV-DMS-200.2',
    'MO,AD0,UN0,SF1.0000',
    'OC,OPSTN1,N 1000.0000,E 5000.0000,EL100.0000',
    'SP,PNBS1,N 900.0000,E 5000.0000,EL99.5000',
    'BK,OPSTN1,BPBS1',
    'LS,HI1.5000,HR1.8000',
    `SS,OPSTN1,FPP1,${angleToken},SD100.0000,ZE95.0000`,
    '',
  ].join('\n');

describe('SURV-DMS-200.2 downstream integration', () => {
  it('carries AR45.3000 through the RW5 importer into a 45.5° angle', () => {
    const imported = importExternalInput(rw5WithAngle('AR45.3000'), 'dms2002.rw5');
    expect(imported.detected).toBe(true);
    expect(imported.importerId).toBe('carlson-rw5');

    const angle = parseInput(imported.text).observations.find(
      (observation) => observation.type === 'angle',
    );
    expect(angle).toBeDefined();
    expect(angle && 'obs' in angle ? angle.obs * RAD_TO_DEG : Number.NaN).toBe(45.5);
  });

  it('reads a compact DN 45.3000 direction as 45.5°', () => {
    const direction = parseInput(['DB AT BS', 'DN TO 45.3000', 'DE'].join('\n')).observations.find(
      (observation) => observation.type === 'direction',
    );
    expect(direction).toBeDefined();
    expect(direction && 'obs' in direction ? direction.obs * RAD_TO_DEG : Number.NaN).toBe(45.5);
  });

  it('still rejects malformed RW5 AR tokens downstream', () => {
    for (const token of ['ARabc1', 'AR0.0.0']) {
      const parsed = parseInput(importExternalInput(rw5WithAngle(token), 'dms2002.rw5').text);
      expect(
        parsed.observations.filter((observation) => observation.type === 'angle'),
        token,
      ).toHaveLength(0);
    }
  });
});

describe('SURV-DMS-200.2 P1 toDegrees decimal-degree context', () => {
  it('reads signed decimals as decimal degrees, not compact DMS', () => {
    // PH/P control records are decimal-degree context: a leading sign must
    // not route the token into the compact-DMS hyphen path.
    expect(toDegrees('-63.582441392')).toBe(-63.582441392);
    expect(toDegrees('44.653429353')).toBe(44.653429353);
  });

  it('keeps -45.3000 decimal-consistent while direct dmsToRad stays compact', () => {
    expect(toDegrees('-45.3000')).toBe(-45.3);
    expect(toDegrees('45.3000')).toBe(45.3);
    expect(rg('-45.3000')).toBe(-45.5);
  });

  it('keeps genuine hyphenated bodies on the bit-identical dmsToRad path', () => {
    expect(toDegrees('-45-30-00')).toBe(-45.5);
    expect(toDegrees('045-30-00')).toBe(45.5);
  });

  it('roundtrips the PH decimal pair through parseInput', () => {
    const parsed = parseInput(
      'PH NOVA0010 44.653429353 -63.582441392 123.4560 0.0080 0.0100 0.0150 0.0000',
    );
    expect(parsed.stations.NOVA0010).toBeDefined();
    expect(parsed.stations.NOVA0010.latDeg).toBeCloseTo(44.653429353, 9);
    expect(parsed.stations.NOVA0010.lonDeg).toBeCloseTo(-63.582441392, 9);
  });
});
