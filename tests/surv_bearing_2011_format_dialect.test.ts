/**
 * SURV-BEARING-201.1 — bearing-format consolidation + DMS dialect parity.
 *
 * Track A (format): the byte-identical `formatCadBearing` (public, in
 * cadCogoSummaries) and the private curve copy were collapsed into the
 * zero-import leaf `src/engine/cad/cadBearingFormat.ts`. These tests pin the
 * exact pre-refactor strings through every public path and the binding
 * identity, and prove the curve/radial consumer resolves the same function.
 *
 * Track B (parsing): the CAD (`cadParse*`) and importer (`parse*`) dialects
 * are intentionally different and MUST NOT be unified. The importer boundary
 * gate in `parseDmsAngleDegrees` requires a strict numeric DMS shape
 * (single-dot segments, at most three hyphen parts, one optional trailing
 * hyphen from degree-symbol normalization) so a malformed field can no longer
 * become a real 0-degree observation, while abbreviated `45°` / `45°30'` keep
 * their pre-change values.
 */
import { describe, expect, it } from 'vitest';

import { RAD_TO_DEG, dmsToRad } from '../src/engine/angles';
import { formatCadBearing as formatFromLeaf } from '../src/engine/cad/cadBearingFormat';
import { formatCadBearing as formatFromSummaries } from '../src/engine/cad/cadCogoSummaries';
import { formatCadBearing as formatFromCogoMath } from '../src/engine/cad/cadCogoMath';
import { cadRadialBearingAtArcAngle } from '../src/engine/cad/cadCogoCurveMath';
import { cadParseBearingDegrees, cadParseDmsDegrees } from '../src/engine/cad/cadGeometryPrimitives';
import {
  parseDmsAngleDegrees,
  parseQuadrantBearingDegrees,
} from '../src/engine/importers/sharedText';
import { parseQuadrantBearingTokenToRad } from '../src/engine/parseTokenHelpers';
import { importExternalInput } from '../src/engine/importers';
import { parseInput } from '../src/engine/parse';
import * as summaries from '../src/engine/cad/cadCogoSummaries';
import * as cogoMath from '../src/engine/cad/cadCogoMath';

// ---------------------------------------------------------------------------
// Frozen pre-refactor formatter (old algorithm copied verbatim), plus optional
// mutations used only by the non-vacuous negative controls.
// ---------------------------------------------------------------------------
type FormatMutation = 'none' | 'swap-quadrant' | 'break-sign' | 'no-carry';

const padInteger = (value: number, width: number): string => value.toString().padStart(width, '0');

const frozenFormat = (azimuthDeg: number, mutation: FormatMutation = 'none'): string => {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  let prefix: 'N' | 'S' = 'N';
  let suffix: 'E' | 'W' = 'E';
  let angle = normalized;
  if (normalized <= 90) {
    prefix = 'N';
    suffix = 'E';
    angle = normalized;
  } else if (normalized <= 180) {
    prefix = 'S';
    suffix = 'E';
    angle = mutation === 'swap-quadrant' ? normalized - 90 : 180 - normalized;
    if (mutation === 'swap-quadrant') prefix = 'N';
  } else if (normalized <= 270) {
    prefix = 'S';
    suffix = 'W';
    angle = mutation === 'break-sign' ? 180 - normalized : normalized - 180;
  } else {
    prefix = 'N';
    suffix = 'W';
    angle = 360 - normalized;
  }

  let degrees = Math.floor(angle);
  let minutesFloat = (angle - degrees) * 60;
  let minutes = Math.floor(minutesFloat);
  let seconds = (minutesFloat - minutes) * 60;

  if (mutation !== 'no-carry' && seconds >= 59.995) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  if (degrees > 90) {
    degrees = 90;
    minutes = 0;
    seconds = 0;
  }

  return `${prefix}${padInteger(degrees, 2)}-${padInteger(minutes, 2)}-${seconds
    .toFixed(2)
    .padStart(5, '0')}${suffix}`;
};

const deterministicGrid = (): number[] => {
  const values: number[] = [];
  for (let i = -720; i <= 720; i += 1) values.push(i * 0.5 + 0.016666);
  let seed = 987654321;
  for (let i = 0; i < 500; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    values.push((seed / 0x7fffffff) * 1440 - 720);
  }
  return values;
};

describe('SURV-BEARING-201.1 cadBearingFormat consolidation', () => {
  it('exposes one formatter instance across every public path', () => {
    expect(summaries.formatCadBearing).toBe(cogoMath.formatCadBearing);
    expect(summaries.formatCadBearing).toBe(formatFromLeaf);
    expect(formatFromSummaries).toBe(formatFromCogoMath);
    expect(formatFromSummaries).toBe(formatFromLeaf);
  });

  it('matches the frozen pre-refactor strings through both public paths', () => {
    const frozen: readonly [number, string][] = [
      [0, 'N00-00-00.00E'],
      [90, 'N90-00-00.00E'],
      [135, 'S45-00-00.00E'],
      [180, 'S00-00-00.00E'],
      [225, 'S45-00-00.00W'],
      [270, 'S90-00-00.00W'],
      [315, 'N45-00-00.00W'],
      [360, 'N00-00-00.00E'],
      [-90, 'S90-00-00.00W'],
      [-0.000000001, 'N00-00-00.00W'],
      [45.5, 'N45-30-00.00E'],
      [89.999999999, 'N90-00-00.00E'],
      [90.000000001, 'S90-00-00.00E'],
      [720.000000001, 'N00-00-00.00E'],
    ];
    for (const [azimuthDeg, expected] of frozen) {
      expect(formatFromSummaries(azimuthDeg), `${azimuthDeg} summaries`).toBe(expected);
      expect(formatFromCogoMath(azimuthDeg), `${azimuthDeg} cogoMath`).toBe(expected);
      expect(formatFromLeaf(azimuthDeg), `${azimuthDeg} leaf`).toBe(expected);
    }
  });

  it('carries xx°59\'59.995"+ in every quadrant', () => {
    expect(formatFromLeaf(0.016666)).toBe('N00-01-00.00E');
    expect(formatFromLeaf(179.983334)).toBe('S00-01-00.00E');
    expect(formatFromLeaf(180.016666)).toBe('S00-01-00.00W');
    expect(formatFromLeaf(359.983334)).toBe('N00-01-00.00W');
  });

  it('agrees with the frozen algorithm over a deterministic finite grid', () => {
    for (const azimuthDeg of deterministicGrid()) {
      expect(formatFromLeaf(azimuthDeg), `leaf ${azimuthDeg}`).toBe(frozenFormat(azimuthDeg));
      expect(formatFromSummaries(azimuthDeg), `summaries ${azimuthDeg}`).toBe(frozenFormat(azimuthDeg));
      expect(formatFromCogoMath(azimuthDeg), `cogoMath ${azimuthDeg}`).toBe(frozenFormat(azimuthDeg));
    }
  });

  it('pins the non-finite baseline exactly (unchanged, not "fixed")', () => {
    expect(formatFromLeaf(Number.NaN)).toBe('NNaN-NaN-00NaNW');
    expect(formatFromLeaf(Number.POSITIVE_INFINITY)).toBe('NNaN-NaN-00NaNW');
    expect(formatFromLeaf(Number.NEGATIVE_INFINITY)).toBe('NNaN-NaN-00NaNW');
    expect(formatFromSummaries(Number.NaN)).toBe(formatFromLeaf(Number.NaN));
    expect(formatFromCogoMath(Number.NaN)).toBe(formatFromLeaf(Number.NaN));
  });

  it('drives the radial/curve call site through the shared leaf formatter', () => {
    const arc = { centerX: 0, centerY: 0 };
    const radial: readonly [number, string][] = [
      [0, 'N90-00-00.00E'],
      [90, 'N00-00-00.00E'],
      [135, 'N45-00-00.00W'],
      [180, 'S90-00-00.00W'],
      [270, 'S00-00-00.00E'],
      [360, 'N90-00-00.00E'],
    ];
    for (const [angleDeg, expected] of radial) {
      expect(cadRadialBearingAtArcAngle({ arc, angleDeg })).toBe(expected);
    }
  });
});

describe('SURV-BEARING-201.1 parser dialect parity', () => {
  it('keeps the CAD decimal vs importer DDD.MMSS split for compact tokens', () => {
    // CAD: no-separator token is a plain decimal.
    expect(cadParseDmsDegrees('45.3000')).toBe(45.3);
    expect(cadParseBearingDegrees('45.3000')).toBe(45.30000000000001);
    // Importer: no-separator token is compact DDD.MMSS (`dmsToRad`).
    expect(parseDmsAngleDegrees('45.3000')).toBe(45.511111111111106);
    expect(parseQuadrantBearingDegrees('N45.3000E')).toBe(45.511111111111106);
    // Hyphenated DMS agrees in both dialects.
    expect(cadParseDmsDegrees('45-30-00')).toBe(45.5);
    expect(parseDmsAngleDegrees('45-30-00')).toBe(45.5);
    // The dialect gap is real: these must never be unified.
    expect(cadParseDmsDegrees('45.3000')).not.toBe(parseDmsAngleDegrees('45.3000'));
  });

  it('keeps the RW5 fixture dialect for AR45.1234 (DDD.MMSS)', () => {
    expect(parseDmsAngleDegrees('45.1234')).toBe(45.209444444444436);
    expect(parseDmsAngleDegrees('45.1234')).toBeCloseTo(45 + 12 / 60 + 34 / 3600, 12);
  });

  it('keeps CAD clamp/wrap vs importer raw values', () => {
    expect(cadParseBearingDegrees('N99E')).toBe(90);
    expect(cadParseBearingDegrees('N99W')).toBe(270);
    expect(cadParseBearingDegrees('360')).toBe(0);
    expect(cadParseBearingDegrees('720')).toBe(0);
    expect(parseQuadrantBearingDegrees('N99E')).toBe(99);
    expect(parseQuadrantBearingDegrees('N99W')).toBe(261);
    expect(parseQuadrantBearingDegrees('360')).toBe(360);
    expect(parseQuadrantBearingDegrees('720')).toBe(720);
  });

  it('keeps the parseTokenHelpers decimal-body quadrant dialect', () => {
    expect((parseQuadrantBearingTokenToRad('N45.3000E') ?? Number.NaN) * RAD_TO_DEG).toBe(45.3);
    expect((parseQuadrantBearingTokenToRad('N45-30-00E') ?? Number.NaN) * RAD_TO_DEG).toBe(45.5);
    expect((parseQuadrantBearingTokenToRad('N99E') ?? Number.NaN) * RAD_TO_DEG).toBe(90);
  });

  it('returns CAD null vs importer undefined for malformed tokens', () => {
    for (const token of ['abc', 'NaN', 'NNE', '', '   ']) {
      expect(cadParseDmsDegrees(token), `cad dms ${JSON.stringify(token)}`).toBeNull();
      expect(parseDmsAngleDegrees(token), `import dms ${JSON.stringify(token)}`).toBeUndefined();
      expect(parseQuadrantBearingDegrees(token), `import quadrant ${JSON.stringify(token)}`).toBeUndefined();
    }
  });

  it('rejects digit-bearing malformed importer tokens, not just letters-only', () => {
    // The old `if (!/\d/.test(normalized))` gate let any token containing one
    // digit through; `dmsToRad` then returned 0 for the unparseable body. The
    // tightened gate requires a pure numeric DMS shape.
    for (const token of ['abc1', '45abc', '12a34', '1a2b3c', '-abc', 'N/A1']) {
      expect(parseDmsAngleDegrees(token), `import dms ${JSON.stringify(token)}`).toBeUndefined();
    }
    // Quadrant extraction must not smuggle a malformed body through either.
    expect(parseQuadrantBearingDegrees('N/A1')).toBeUndefined();
    expect(parseQuadrantBearingDegrees('N45abcE')).toBeUndefined();
  });

  it('preserves the full valid DMS shape matrix after the tightened gate', () => {
    // Compact DDD.MMSS forms (importer dialect).
    expect(parseDmsAngleDegrees('45.3000')).toBe(45.511111111111106);
    expect(parseDmsAngleDegrees('-45.5')).toBe(-45.5);
    expect(parseDmsAngleDegrees('.5')).toBeCloseTo(50 / 60, 12);
    // Hyphenated DMS forms.
    expect(parseDmsAngleDegrees('045-30-00')).toBe(45.5);
    expect(parseDmsAngleDegrees('-45-30-00')).toBe(-45.5);
    expect(parseDmsAngleDegrees('45-30-00.5')).toBeCloseTo(45 + 30 / 60 + 0.5 / 3600, 12);
    // Bare degree numbers (incl. a trailing decimal point).
    expect(parseDmsAngleDegrees('45')).toBe(45);
    expect(parseDmsAngleDegrees('45.')).toBe(45);
    expect(parseDmsAngleDegrees('0')).toBe(0);
    expect(parseDmsAngleDegrees('720')).toBe(720);
    // Legitimate zero tokens.
    expect(parseDmsAngleDegrees('0-00-00')).toBe(0);
    expect(parseDmsAngleDegrees('0.0000')).toBe(0);
  });

  it('P2 keeps abbreviated degree-symbol tokens valid (trailing-hyphen normalization)', () => {
    // Normalization rewrites `°` -> `-` and `'` -> `-`, so a symbol token can
    // end in a hyphen. `dmsToRad` reads the missing trailing parts as 0; the
    // gate must not reject that shape (the first P1 gate regressed it).
    expect(parseDmsAngleDegrees('45°')).toBe(45);
    expect(parseDmsAngleDegrees(`45°30'`)).toBe(45.5);
    expect(parseDmsAngleDegrees(`45°30'00"`)).toBe(45.5);
    // Same values through the quadrant wrapper.
    expect(parseQuadrantBearingDegrees(`N45°30'E`)).toBe(45.5);
    // A literal trailing hyphen (no symbol) is kept at its pre-change value of
    // 45 by design; this is documented behavior, not a bug to "fix".
    expect(parseDmsAngleDegrees('45-')).toBe(45);
    expect(dmsToRad('45-') * RAD_TO_DEG).toBe(45);
  });

  it('P1 rejects multi-dot and extra-segment numerics that dmsToRad floors to 0', () => {
    // Pre-change these slipped through and `dmsToRad` read only leading
    // segments, yielding a *valid* 0. Both are malformed and now undefined.
    expect(dmsToRad('0.0.0') * RAD_TO_DEG).toBe(0);
    expect(parseDmsAngleDegrees('0.0.0')).toBeUndefined();
    expect(dmsToRad('0-00-00-1') * RAD_TO_DEG).toBe(0);
    expect(parseDmsAngleDegrees('0-00-00-1')).toBeUndefined();
    // Deliberate policy: a 4th hyphen segment, consecutive separators and
    // exponent notation are rejected rather than leniently parsed.
    for (const token of [
      '0.0.0',
      '0-00-00-1',
      '45-30-00-1',
      '45--30',
      '1e3',
      '1E3',
      '45..30',
      '.5.5',
      '--45',
      '-',
      '+',
      '.',
      '',
    ]) {
      expect(parseDmsAngleDegrees(token), `import dms ${JSON.stringify(token)}`).toBeUndefined();
    }
    expect(parseQuadrantBearingDegrees('N0.0.0E')).toBeUndefined();
    expect(parseQuadrantBearingDegrees('N0-00-00-1E')).toBeUndefined();
  });

  it('keeps legitimate zero tokens valid in both dialects', () => {
    expect(cadParseDmsDegrees('0-00-00')).toBe(0);
    expect(cadParseDmsDegrees('0.0000')).toBe(0);
    expect(parseDmsAngleDegrees('0-00-00')).toBe(0);
    expect(parseDmsAngleDegrees('0.0000')).toBe(0);
  });
});

describe('SURV-BEARING-201.1 non-vacuous negative controls', () => {
  it('fails if the quadrant mapping is swapped', () => {
    expect(frozenFormat(135, 'swap-quadrant')).not.toBe(formatFromLeaf(135));
    expect(formatFromLeaf(135)).toBe('S45-00-00.00E');
  });

  it('fails if the SE/SW sign symmetry is broken', () => {
    expect(frozenFormat(225, 'break-sign')).not.toBe(formatFromLeaf(225));
    expect(formatFromLeaf(225)).toBe('S45-00-00.00W');
  });

  it('fails if the 59.995s carry is removed', () => {
    expect(frozenFormat(0.016666, 'no-carry')).not.toBe(formatFromLeaf(0.016666));
    expect(formatFromLeaf(0.016666)).toBe('N00-01-00.00E');
  });

  it('fails if the compact-token dialect is flipped', () => {
    // A unified parser would collapse these; the assertion would catch it.
    expect(cadParseDmsDegrees('45.3000')).not.toBe(parseDmsAngleDegrees('45.3000'));
    expect(parseDmsAngleDegrees('45.3000')).toBeCloseTo(dmsToRad('45.3000') * RAD_TO_DEG, 12);
  });

  it('fails if malformed tokens are accepted again', () => {
    // `dmsToRad` itself still returns 0 for unparseable input (untouched),
    // proving the gate lives at the importer boundary.
    expect(dmsToRad('abc')).toBe(0);
    expect(parseDmsAngleDegrees('abc')).toBeUndefined();
    // The pre-gate behavior would have produced a real 0.
    expect(dmsToRad('abc') * RAD_TO_DEG).toBe(0);
  });

  it('fails if the P1/P2 shapes regress to the any-digit gate', () => {
    // An any-digit gate accepts `0.0.0`/`0-00-00-1` (via `dmsToRad` -> 0) and
    // rejects the abbreviated trailing-hyphen shapes. Both directions pinned.
    expect(dmsToRad('0.0.0') * RAD_TO_DEG).toBe(0);
    expect(parseDmsAngleDegrees('0.0.0')).toBeUndefined();
    expect(parseDmsAngleDegrees('45°')).toBe(45);
    expect(parseDmsAngleDegrees('45-')).toBe(45);
  });

  it('fails if the gate regresses to the any-digit check', () => {
    // Digit-bearing garbage is the case a `if (!/\d/.test(...))` gate misses:
    // `abc1` contains a digit, so the old gate passed it to `dmsToRad`, which
    // returned 0 (untouched here). The shape gate must reject it.
    expect(dmsToRad('abc1')).toBe(0);
    expect(parseDmsAngleDegrees('abc1')).toBeUndefined();
    expect(dmsToRad('45abc') * RAD_TO_DEG).toBe(45);
    expect(parseDmsAngleDegrees('45abc')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// FAIL-FIRST at the real importer boundary: malformed AR used to become a
// valid 0-degree observation through `resolveRw5ShotOrientation`.
// ---------------------------------------------------------------------------
const rw5WithAngle = (angleToken: string): string =>
  [
    'JB,NM,SURV-BEARING-201.1',
    'MO,AD0,UN0,SF1.0000',
    'OC,OPSTN1,N 1000.0000,E 5000.0000,EL100.0000',
    'SP,PNBS1,N 900.0000,E 5000.0000,EL99.5000',
    'BK,OPSTN1,BPBS1',
    'LS,HI1.5000,HR1.8000',
    `SS,OPSTN1,FPP1,${angleToken},SD100.0000,ZE95.0000`,
    '',
  ].join('\n');

const importObservations = (angleToken: string) => {
  const imported = importExternalInput(rw5WithAngle(angleToken), 'surv2011.rw5');
  expect(imported.detected).toBe(true);
  expect(imported.importerId).toBe('carlson-rw5');
  return { imported, parsed: parseInput(imported.text) };
};

describe('SURV-BEARING-201.1 malformed AR no longer becomes a 0-degree observation', () => {
  it('drops the malformed angle instead of emitting angleDeg 0', () => {
    const { imported, parsed } = importObservations('ARgarbage');
    expect(imported.text).not.toContain('converted to A');
    expect(imported.text).not.toContain('converted to M');
    expect(
      parsed.observations.some((observation) => observation.type === 'angle'),
    ).toBe(false);
    expect(
      parsed.observations.some(
        (observation) => observation.type === 'angle' && observation.obs === 0,
      ),
    ).toBe(false);
  });

  it('drops digit-bearing malformed AR (ARabc1) instead of emitting angleDeg 0', () => {
    const { imported, parsed } = importObservations('ARabc1');
    expect(imported.text).not.toContain('converted to A');
    expect(imported.text).not.toContain('converted to M');
    expect(
      parsed.observations.some((observation) => observation.type === 'angle'),
    ).toBe(false);
    expect(
      parsed.observations.some(
        (observation) => observation.type === 'angle' && observation.obs === 0,
      ),
    ).toBe(false);
  });

  it('drops multi-dot malformed AR (AR0.0.0) instead of emitting angleDeg 0', () => {
    const { imported, parsed } = importObservations('AR0.0.0');
    expect(imported.text).not.toContain('converted to A');
    expect(imported.text).not.toContain('converted to M');
    expect(
      parsed.observations.some((observation) => observation.type === 'angle'),
    ).toBe(false);
    expect(
      parsed.observations.some(
        (observation) => observation.type === 'angle' && observation.obs === 0,
      ),
    ).toBe(false);
  });

  it('drops extra-segment malformed AR (AR0-00-00-1) instead of emitting angleDeg 0', () => {
    const { imported, parsed } = importObservations('AR0-00-00-1');
    expect(imported.text).not.toContain('converted to A');
    expect(imported.text).not.toContain('converted to M');
    expect(
      parsed.observations.some((observation) => observation.type === 'angle'),
    ).toBe(false);
    expect(
      parsed.observations.some(
        (observation) => observation.type === 'angle' && observation.obs === 0,
      ),
    ).toBe(false);
  });

  it('still imports a legitimate compact AR token', () => {
    const { parsed } = importObservations('AR45.1234');
    const angleObservation = parsed.observations.find(
      (observation) => observation.type === 'angle',
    );
    expect(angleObservation).toBeDefined();
    expect(
      angleObservation && 'obs' in angleObservation ? angleObservation.obs * RAD_TO_DEG : Number.NaN,
    ).toBeCloseTo(45.209444444444436, 9);
  });
});
