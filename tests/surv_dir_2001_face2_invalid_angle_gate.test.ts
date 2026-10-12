/**
 * SURV-DIR-200.1 — fail-closed malformed direction-review angle gate.
 *
 * Bug (pre-fix): `parseDirectionAngleTokenDeg` fed the raw token straight to
 * `dmsToRad`, which returns literal 0 for unparseable input, so garbage
 * (`abc1`), digit-bearing garbage (`45abc`), multi-dot (`0.0.0`) and
 * extra-segment (`0-00-00-1`) tokens all became a *valid* 0. For a face-2 row
 * `normalizeDirectionLineFace2ToFace1` then subtracted 180 and fabricated
 * `180-00-00.0`, which parseInput accepted as a real measurement. The raw
 * fallback (`?? entry.line`) leaked the same malformed shapes past the
 * formatter, where `parseAngleTokenRad`/`dmsToRad` still accepted
 * `45abc`/`0.0.0`/`0-00-00-1`.
 *
 * Fix: a strict DMS/numeric shape predicate, duplicated locally in both the
 * review formatter (`src/engine/importReviewFormatters.ts`) and the parseInput
 * DN/DM direction route (`src/engine/parseDirectionSetRecords.ts`), gates both
 * seams. `dmsToRad` is untouched and every valid value stays bit-identical.
 * The predicate is intentionally duplicated rather than shared: full-src graph
 * node/edge pins forbid a new shared module here.
 */
import { describe, expect, it } from 'vitest';

import { RAD_TO_DEG, dmsToRad } from '../src/engine/angles';
import {
  formatAngleDms,
  normalizeDirectionAngleDeg,
  normalizeDirectionLineFace2ToFace1,
  parseDirectionAngleTokenDeg,
} from '../src/engine/importReviewFormatters';
import { buildImportReviewModel, buildImportReviewText } from '../src/engine/importReview';
import { parseAngleTokenRad, parseQuadrantBearingTokenToRad } from '../src/engine/parseTokenHelpers';
import { parseInput } from '../src/engine/parse';
import type { ImportedDataset } from '../src/engine/importers';
import type { ParseOptions } from '../src/types';

// Local test-only copy of the strict quadrant-bearing shape predicate (mirrors the
// local gate in src/engine/parseDirectionSetRecords.ts; defined here so the test adds
// no new cross-module import edge).
const isStrictQuadrantBearingToken = (token: string | undefined): boolean => {
  const trimmed = token?.trim();
  if (!trimmed) return false;
  const normalized = trimmed.replace(/\s+/g, '').toUpperCase();
  return /^[NS](?:\d+(?:\.\d*)?|\.\d+)(?:-(?:\d+(?:\.\d*)?|\.\d+)){0,2}-?[EW]$/.test(
    normalized,
  );
};

const MALFORMED_TOKENS = [
  'abc1', // alpha + digit
  'garbage', // alpha only
  '45abc', // mixed digits (parseFloat reads 45)
  '0.0.0', // multi-dot
  '0-00-00-1', // extra segment
  '-', // lone sign
  '+', // lone sign
  '', // empty
];

type DirectionObservationLike = {
  type: 'direction';
  at: string;
  to: string;
  obs: number;
  planned?: boolean;
};

const directionObservations = (text: string): DirectionObservationLike[] =>
  parseInput(text).observations
    .filter((observation) => observation.type === 'direction')
    .map((observation) => observation as unknown as DirectionObservationLike);

const degreesOf = (observation: DirectionObservationLike): number =>
  observation.obs * RAD_TO_DEG;

// ---------------------------------------------------------------------------
// Frozen pre-fix reference implementations, used only by the non-vacuous
// negative controls to prove the gate is load-bearing.
// ---------------------------------------------------------------------------
const frozenParseDirectionAngleTokenDeg = (token: string | undefined): number | undefined => {
  const trimmed = token?.trim();
  if (!trimmed) return undefined;
  const dmsValue = dmsToRad(trimmed) * RAD_TO_DEG;
  if (Number.isFinite(dmsValue)) return normalizeDirectionAngleDeg(dmsValue);
  const numericValue = Number.parseFloat(trimmed);
  if (Number.isFinite(numericValue)) return normalizeDirectionAngleDeg(numericValue);
  return undefined;
};

const frozenNormalizeDirectionLineFace2ToFace1 = (line: string): string | null => {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3) return null;
  const code = tokens[0]?.toUpperCase();
  if (code !== 'DN' && code !== 'DM') return null;
  const angleDeg = frozenParseDirectionAngleTokenDeg(tokens[2]);
  if (!Number.isFinite(angleDeg as number)) return null;
  tokens[2] = formatAngleDms(normalizeDirectionAngleDeg((angleDeg as number) - 180));
  return tokens.join(' ');
};

// ---------------------------------------------------------------------------
// Integration harness: synthetic single-observation setup with a backsight,
// driven through the real buildImportReviewText -> parseInput chain.
// ---------------------------------------------------------------------------
const buildFaceDataset = (face: 'FACE1' | 'FACE2' | undefined): ImportedDataset => ({
  importerId: 'jobxml',
  formatLabel: 'Synthetic',
  summary: 'synthetic',
  notice: { title: 'synthetic', detailLines: [] },
  comments: [],
  controlStations: [],
  observations: [
    {
      kind: 'measurement',
      atId: '1',
      fromId: '1000',
      toId: '2',
      angleDeg: 45,
      distanceM: 10,
      sourceMeta: face ? { face } : undefined,
    },
  ],
  trace: [],
});

const buildIntegrationText = (
  token: string,
  face: 'FACE1' | 'FACE2' | undefined,
  faceNormalizationMode: 'on' | 'off',
): string => {
  const dataset = buildFaceDataset(face);
  const model = buildImportReviewModel(dataset);
  return buildImportReviewText(dataset, model, {
    includedItemIds: new Set(model.items.map((item) => item.id)),
    preset: 'ts-direction-set',
    faceNormalizationMode,
    rowOverrides: { 'observation:0': `DN 2 ${token}` },
  });
};

describe('SURV-DIR-200.1 strict direction-angle shape gate (unit)', () => {
  it('returns undefined for every malformed class instead of a false zero', () => {
    for (const token of MALFORMED_TOKENS) {
      expect(parseDirectionAngleTokenDeg(token), JSON.stringify(token)).toBeUndefined();
    }
  });

  it('keeps the full valid value matrix bit-identical', () => {
    const valid: ReadonlyArray<readonly [string, number]> = [
      ['0', 0],
      ['180', 180],
      ['360', 0],
      ['90', 90],
      ['270', 270],
      // Compact DDD.MMSS; the review formatter normalizes after converting.
      // SURV-DMS-200.2 correction: prior 45.51111111111112 was a binary-carry
      // observation (45°30'40"); compact `45.3000` is 45°30'00" = 45.5.
      ['45.3000', 45.5],
      ['045-30-00', 45.5],
      ['45-', 45], // literal trailing-hyphen abbreviation (documented)
      ['45°', 45], // degree-symbol abbreviation
      ["45°30'", 45], // baseline reads the compact body as 45
      ['45-30-00.5', 45.5001388888889],
      // SURV-DMS-200.2 correction: prior 314.5 relied on the hyphen-branch
      // accident for `-45.5`; stripping one leading sign first reads compact
      // 45°50' = -45.8333…, normalized to 314.1666….
      ['-45.5', 314.1666666666667],
      ['0-00-00', 0],
      ['0.0000', 0],
      ['.5', 0.8333333333333144],
      ['45.', 45],
    ];
    for (const [token, expected] of valid) {
      expect(parseDirectionAngleTokenDeg(token), token).toBe(expected);
    }
  });

  it('does not touch dmsToRad: malformed still returns literal 0 there', () => {
    expect(dmsToRad('abc1')).toBe(0);
    expect(dmsToRad('0.0.0') * RAD_TO_DEG).toBe(0);
    expect(dmsToRad('0-00-00-1') * RAD_TO_DEG).toBe(0);
  });
});

describe('SURV-DIR-200.1 face-2 normalization no longer fabricates 180', () => {
  it('returns null for malformed face-2 lines instead of 180-00-00.0', () => {
    for (const token of MALFORMED_TOKENS) {
      expect(
        normalizeDirectionLineFace2ToFace1(`DN 2 ${token}`),
        JSON.stringify(token),
      ).toBeNull();
    }
  });

  it('preserves the normal face-2 subtract-180 behavior for valid angles', () => {
    expect(normalizeDirectionLineFace2ToFace1('DN 2 000-00-00.0')).toBe('DN 2 180-00-00.0');
    expect(normalizeDirectionLineFace2ToFace1('DN 2 180-00-00.0')).toBe('DN 2 000-00-00.0');
    expect(normalizeDirectionLineFace2ToFace1('DN 2 90-00-00.0')).toBe('DN 2 270-00-00.0');
    // SURV-DMS-200.2 correction: prior `225-30-40.0` came from the compact
    // binary carry (45°30'40"); `45.3000` is 45°30'00", so face-2 is 225-30-00.0.
    expect(normalizeDirectionLineFace2ToFace1('DM 5 45.3000 10.0000')).toBe(
      'DM 5 225-30-00.0 10.0000',
    );
  });
});

describe('SURV-DIR-200.1 end-to-end: malformed row yields no bogus observation', () => {
  const configs: ReadonlyArray<{
    label: string;
    face: 'FACE1' | 'FACE2' | undefined;
    mode: 'on' | 'off';
  }> = [
    { label: 'face2 / normalize on', face: 'FACE2', mode: 'on' },
    { label: 'face2 / normalize off', face: 'FACE2', mode: 'off' },
    { label: 'face1 / normalize on', face: 'FACE1', mode: 'on' },
    { label: 'unresolved / normalize on', face: undefined, mode: 'on' },
  ];

  it('skips the malformed target and leaves only the genuine synthetic backsight', () => {
    for (const config of configs) {
      for (const token of MALFORMED_TOKENS) {
        const text = buildIntegrationText(token, config.face, config.mode);
        const label = `${config.label} ${JSON.stringify(token)}`;

        // No fabricated face-2 back-normalization string for the bad row.
        expect(text, label).not.toContain('DN 2 180-00-00.0');
        expect(text, label).not.toContain('DN 2 0-00-00.0');

        const directions = directionObservations(text);
        const target = directions.find((observation) => observation.to === '2');
        expect(target, `${label} target 2`).toBeUndefined();
        expect(
          directions.some((observation) => degreesOf(observation) === 180),
          `${label} 180 measurement`,
        ).toBe(false);

        // The only surviving row is the legitimate synthetic backsight DN 1000.
        expect(directions.map((observation) => observation.to), label).toEqual(['1000']);
        expect(degreesOf(directions[0]!), label).toBe(0);
      }
    }
  });

  it('still admits genuine valid face-2 angles (baseline preserved end-to-end)', () => {
    const zeroToBack = buildIntegrationText('000-00-00.0', 'FACE2', 'on');
    expect(zeroToBack).toContain('DN 2 180-00-00.0');
    const back = directionObservations(zeroToBack).find((observation) => observation.to === '2');
    expect(back && degreesOf(back)).toBe(180);

    const zeroViaHalfTurn = buildIntegrationText('180', 'FACE2', 'on');
    expect(zeroViaHalfTurn).toContain('DN 2 000-00-00.0');
    const zero = directionObservations(zeroViaHalfTurn).find(
      (observation) => observation.to === '2',
    );
    expect(zero && degreesOf(zero)).toBe(0);

    const wrap = buildIntegrationText('360', 'FACE2', 'on');
    expect(wrap).toContain('DN 2 180-00-00.0');
  });

  it('preserves DB/DN/DM/DE ordering and F1 hints for a valid mixed-face set', () => {
    const dataset: ImportedDataset = {
      importerId: 'jobxml',
      formatLabel: 'Synthetic',
      summary: 'synthetic',
      notice: { title: 'synthetic', detailLines: [] },
      comments: [],
      controlStations: [],
      observations: [
        {
          kind: 'measurement',
          atId: '1',
          fromId: '1000',
          toId: '2',
          angleDeg: 45,
          distanceM: 10,
          sourceMeta: { face: 'FACE1' },
        },
        {
          kind: 'measurement',
          atId: '1',
          fromId: '1000',
          toId: '3',
          angleDeg: 225,
          distanceM: 12,
          sourceMeta: { face: 'FACE2' },
        },
      ],
      trace: [],
    };
    const model = buildImportReviewModel(dataset);
    const text = buildImportReviewText(dataset, model, {
      includedItemIds: new Set(model.items.map((item) => item.id)),
      preset: 'ts-direction-set',
      faceNormalizationMode: 'on',
      emitDirectionFaceHints: true,
    });

    expect(text.split('\n').filter((line) => line.trim().length > 0)).toEqual([
      '.2D',
      '.UNITS M',
      '.ORDER EN',
      '# SETUP 1',
      'DB 1',
      'DN 1000 000-00-00',
      'DM 2 045-00-00.0 10.0000',
      'DM 3 045-00-00.0 12.0000 F1',
      'DE',
    ]);
  });
});

describe('SURV-DIR-200.1 raw parseInput DN/DM direction route gate', () => {
  const runRaw = (angle: string) =>
    directionObservations(['DB 1 1000', `DN 2 ${angle}`, 'DE'].join('\n'));

  it('rejects malformed raw direction angles even though the low-level parser accepts them', () => {
    // `parseAngleTokenRad` alone still reads malformed shapes as real values —
    // so the direction route gate is what closes the raw-fallback hole.
    expect(parseAngleTokenRad('45abc', {} as ParseOptions, 'dms') * RAD_TO_DEG).toBe(45);
    expect(parseAngleTokenRad('0.0.0', {} as ParseOptions, 'dms')).toBe(0);
    expect(parseAngleTokenRad('0-00-00-1', {} as ParseOptions, 'dms')).toBe(0);

    for (const token of MALFORMED_TOKENS) {
      expect(runRaw(token), JSON.stringify(token)).toEqual([]);
    }
  });

  it('keeps valid zero and wrap tokens as real direction measurements', () => {
    expect(runRaw('000-00-00').map(degreesOf)).toEqual([0]);
    expect(runRaw('0.0000').map(degreesOf)).toEqual([0]);
    expect(runRaw('180').map(degreesOf)).toEqual([180]);
  });

  it('keeps preanalysis planned tokens valid', () => {
    const planned = parseInput(['DB 1 1000', 'DN 2 ?', 'DE'].join('\n'), {}, {
      preanalysisMode: true,
    })
      .observations.filter((observation) => observation.type === 'direction')
      .map((observation) => observation as unknown as DirectionObservationLike);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.planned).toBe(true);
    expect(degreesOf(planned[0]!)).toBe(0);
  });
});

describe('SURV-DIR-200.1 non-vacuous negative controls', () => {
  it('fails if the strict invalid->0 gate is removed', () => {
    // Frozen pre-fix behavior: unparseable tokens do become a real value.
    expect(frozenParseDirectionAngleTokenDeg('abc1')).toBe(0);
    expect(frozenParseDirectionAngleTokenDeg('0.0.0')).toBe(0);
    expect(frozenParseDirectionAngleTokenDeg('+')).toBe(0);
    // Digit-bearing garbage is read by the old fallback `parseFloat`.
    expect(frozenParseDirectionAngleTokenDeg('45abc')).toBe(45);
    // The shipped gate rejects them.
    expect(parseDirectionAngleTokenDeg('abc1')).toBeUndefined();
    expect(parseDirectionAngleTokenDeg('45abc')).toBeUndefined();
    expect(parseDirectionAngleTokenDeg('0.0.0')).toBeUndefined();
    expect(parseDirectionAngleTokenDeg('+')).toBeUndefined();
  });

  it('fails if the face-2 -180 normalization is altered or the guard dropped', () => {
    // Frozen pre-fix fabricates the bogus 180 from a malformed face-2 row.
    expect(frozenNormalizeDirectionLineFace2ToFace1('DN 2 abc1')).toBe('DN 2 180-00-00.0');
    expect(normalizeDirectionLineFace2ToFace1('DN 2 abc1')).toBeNull();
    // The genuine subtract-180 mapping is unchanged (a no-op/mutation fails).
    const frozenNoSubtract = (line: string): string => {
      const tokens = line.trim().split(/\s+/).filter(Boolean);
      tokens[2] = formatAngleDms(parseDirectionAngleTokenDeg(tokens[2]) ?? 0);
      return tokens.join(' ');
    };
    expect(normalizeDirectionLineFace2ToFace1('DN 2 000-00-00.0')).toBe('DN 2 180-00-00.0');
    expect(frozenNoSubtract('DN 2 000-00-00.0')).not.toBe(
      normalizeDirectionLineFace2ToFace1('DN 2 000-00-00.0'),
    );
  });

  it('fails if valid literal zero is rejected', () => {
    expect(parseDirectionAngleTokenDeg('0')).toBe(0);
    expect(parseDirectionAngleTokenDeg('0.0000')).toBe(0);
    expect(parseDirectionAngleTokenDeg('0-00-00')).toBe(0);
  });

  it('fails if a raw malformed direction line is accepted downstream again', () => {
    // Low-level parser accepts the raw shape (guard removed => valid obs).
    expect(parseAngleTokenRad('45abc', {} as ParseOptions, 'dms') * RAD_TO_DEG).toBe(45);
    // The direction route must not.
    expect(
      directionObservations(['DB 1 1000', 'DN 2 45abc', 'DE'].join('\n')),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SURV-DIR-200.1 P2 correction: quadrant-bearing raw direction tokens.
//
// The strict DMS/numeric gate above also rejected valid quadrant bearings
// (`N45E`) that `parseAngleTokenRad` -> `parseQuadrantBearingTokenToRad`
// genuinely accepts. The direction route now admits a strict quadrant shape,
// while `parseQuadrantBearingTokenToRad`'s lenient bodies stay fail-closed.
// The import-review formatter is intentionally NOT widened: it does not support
// quadrant tokens (`parseDirectionAngleTokenDeg('N45E')` is undefined), so a
// face-2 row falls back to its raw line and the route decides the value.
// ---------------------------------------------------------------------------
const rawDirections = (lines: string[]): DirectionObservationLike[] =>
  directionObservations(lines.join('\n'));

describe('SURV-DIR-200.1 P2 strict quadrant-bearing shape predicate', () => {
  it('accepts the strict quadrant shape set', () => {
    for (const token of [
      'N45E',
      'N45W',
      'S45E',
      'S45W',
      'N45.3000E',
      'N45-30-00E',
      'N0-00-00E',
      'n45e',
      'N.5E',
      'N45-E', // abbreviated DMS body + trailing hyphen before E/W
      'S45-W',
      'n45-e',
    ]) {
      expect(isStrictQuadrantBearingToken(token), token).toBe(true);
    }
  });

  it('rejects lenient bodies the low-level quadrant parser would still read', () => {
    for (const token of [
      'N45abcE',
      'N45EXE',
      'N0.0.0E',
      'N0-00-00-1E',
      'N45--E',
      'N45Eextra',
      'N45',
      'NE',
      '',
    ]) {
      expect(isStrictQuadrantBearingToken(token), JSON.stringify(token)).toBe(false);
    }
  });
});

describe('SURV-DIR-200.1 P2 raw DN/DM quadrant-bearing route', () => {
  it('accepts quadrant bearings end-to-end through parseInput', () => {
    const expected: ReadonlyArray<readonly [string, number]> = [
      ['N45E', 45],
      ['N45W', 315],
      ['S45E', 135],
      ['S45W', 225],
      ['N45-30-00E', 45.5],
      ['N45.3000E', 45.3], // parseTokenHelpers decimal-body quadrant dialect
      ['n45e', 45],
      ['N0-00-00E', 0],
      ['N45-E', 45], // trailing hyphen before E/W: parser reads body `45-` as 45°
      ['S45-W', 225],
      ['n45-e', 45],
    ];
    for (const [token, degrees] of expected) {
      const directions = rawDirections(['DB 1 1000', `DN 2 ${token}`, 'DE']);
      expect(directions.map((observation) => observation.to), token).toEqual(['2']);
      expect(degreesOf(directions[0]!), token).toBeCloseTo(degrees, 9);
    }
  });

  it('accepts a quadrant bearing on the DM (distance) route too', () => {
    for (const token of ['N45E', 'N45-E']) {
      const directions = rawDirections(['DB 1 1000', `DM 2 ${token} 10.0000 90`, 'DE']);
      expect(directions.map((observation) => observation.to), token).toEqual(['2']);
      expect(degreesOf(directions[0]!), token).toBeCloseTo(45, 9);
    }
  });

  it('still rejects malformed and lenient-quadrant tokens (fail-closed)', () => {
    for (const token of [
      'abc1',
      '0.0.0',
      '0-00-00-1',
      'N45abcE',
      'N45EXE',
      'N0.0.0E',
      'N0-00-00-1E',
      'N45--E',
      'N45Eextra',
      // P2c: symbol-bearing quadrant bodies are fail-closed too (see next test).
      'N45°30\'E',
      'N45°30\'00"E',
      'N45°30\'W',
    ]) {
      expect(rawDirections(['DB 1 1000', `DN 2 ${token}`, 'DE']), token).toEqual([]);
    }
  });

  it('documents the review-formatter boundary and pins the face-2 baseline', () => {
    // The shared review formatter does not support quadrant tokens, so face-2
    // normalization returns null and the raw line is preserved (no fabricated
    // 180-00-00.0). The route then reads `N45E` as 45 degrees; because the
    // face-2 metadata was dropped with the raw fallback, this is the measured
    // baseline (a face-1 fallback), not a claimed 225-degree normalization.
    expect(parseDirectionAngleTokenDeg('N45E')).toBeUndefined();
    expect(normalizeDirectionLineFace2ToFace1('DN 2 N45E')).toBeNull();

    const text = buildIntegrationText('N45E', 'FACE2', 'on');
    expect(text).toContain('DN 2 N45E');
    expect(text).not.toContain('DN 2 180-00-00.0');
    const directions = directionObservations(text);
    const target = directions.find((observation) => observation.to === '2');
    expect(target).toBeDefined();
    expect(degreesOf(target!)).toBeCloseTo(45, 9);
  });

  it('negative control: lenient parser reads the bad body but the route drops it', () => {
    expect((parseQuadrantBearingTokenToRad('N45abcE') ?? Number.NaN) * RAD_TO_DEG).toBe(45);
    expect(isStrictQuadrantBearingToken('N45abcE')).toBe(false);
    expect(rawDirections(['DB 1 1000', 'DN 2 N45abcE', 'DE'])).toEqual([]);
  });

  it('P2c fail-closed: symbol-bearing quadrant bodies yield no observation', () => {
    // `parseQuadrantBearingTokenToRad` has no symbol dialect: a hyphen-free body
    // goes through `Number.parseFloat`, which truncates at the first symbol, so
    // `N45°30'E` misreads as 45° instead of the true 45.5° (and `N45°30'W` as
    // 315° instead of 314.5°). Admitting these tokens would enshrine a fake
    // reading, so the gate rejects them; symbol handling in the quadrant parser
    // belongs to a separate explicit phase.
    expect((parseQuadrantBearingTokenToRad("N45°30'E") ?? Number.NaN) * RAD_TO_DEG).toBe(45);
    expect((parseQuadrantBearingTokenToRad("N45°30'W") ?? Number.NaN) * RAD_TO_DEG).toBe(315);
    for (const token of ["N45°30'E", 'N45°30\'00"E', "N45°30'W", 'S45°W']) {
      expect(isStrictQuadrantBearingToken(token), JSON.stringify(token)).toBe(false);
      expect(rawDirections(['DB 1 1000', `DN 2 ${token}`, 'DE']), token).toEqual([]);
    }
  });
});
