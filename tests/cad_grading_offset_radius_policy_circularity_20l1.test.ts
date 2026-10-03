/**
 * Phase 20L.1 Task 7 — circularity / candidacy / robustness study pins
 * (evidence only, zero `src/` changes). Pins: analytic proof by resolved
 * effective criterion (15/30, no sampling authority), exact Roff sign +
 * boundaries, independent corner candidacy (mesh N/A), normalized-geometry
 * invariance, production criterion-scaling truth.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { scaleGradingCriterion } from '../src/engine/cad/cadProjectTransformGrading';
import { classifyOffsetJoin } from '../scripts/phase20lOffsetJoinCore';
import {
  gateRadiusOffset,
  radialSignOf,
  resolveCornerEffective,
  resolveEffectiveConstantOffset,
  resolveMixedEffective,
  type StudySource,
} from '../scripts/phase20l1EffectiveCriterion';
import { JOIN_FIXTURE_BY_ID, JOIN_FIXTURES } from '../scripts/phase20lOffsetRadiusVariants';

interface CorpusRow {
  fixtureId: string; family: string; admit: boolean; reasonCode: string;
  cornerCandidacyPass: boolean; candidacyDetail: string; meshTopology: string;
  d: number | null;
}

const corpus = (): { rows: CorpusRow[]; transformInvariance: Record<string, Record<string, { agree: boolean; joinErr: number | null }>> } =>
  JSON.parse(
    readFileSync(
      join(dirname(new URL(import.meta.url).pathname), '..', 'docs', 'evidence', 'phase20l1', 'policy-corpus.json'),
      'utf8',
    ),
  );

const ARC = (radius: number, startZ: number, endZ: number): StudySource => ({
  isArc: true, finite: true, radius, startZ, endZ,
});
const DIST = { kind: 'distance', gradeRatio: 1, distance: 5 } as const;
const REL_EL = { kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 } as const;
const ELEV = { kind: 'elevation', gradeRatio: 1, targetElevation: 5 } as const;

describe('20L.1 circularity: executable proof by resolved criterion', () => {
  it('distance + rel-el always proven with criterion-derived d; elevation-sloped never; surface never', () => {
    expect(resolveEffectiveConstantOffset(DIST, ARC(50, 0, 0), 1, 100)).toEqual(
      expect.objectContaining({ proven: true, d: 5 }),
    );
    expect(resolveEffectiveConstantOffset(REL_EL, ARC(50, 0, 0), 1, 100)).toEqual(
      expect.objectContaining({ proven: true, d: 5 }),
    );
    expect(resolveEffectiveConstantOffset(ELEV, ARC(50, 0, 10), 1, 100)).toEqual(
      expect.objectContaining({ proven: false, reason: 'ELEVATION_SLOPED_SOURCE' }),
    );
    expect(resolveEffectiveConstantOffset({ kind: 'fixed', gradeRatio: 1 }, ARC(50, 0, 0), 1, 100)).toEqual(
      expect.objectContaining({ proven: false, reason: 'SURFACE_TARGET' }),
    );
    expect(resolveEffectiveConstantOffset({ kind: 'cut-fill', cutGradeRatio: 1, fillGradeRatio: 1 }, ARC(50, 0, 0), 1, 100)).toEqual(
      expect.objectContaining({ proven: false, reason: 'SURFACE_TARGET' }),
    );
  });
  it('corner-level per-member equality: differing-flat-Z elevation corners reject (Finding 1)', () => {
    // Reviewer repro: LA_CW_OVERLAP members, E=5 g=1, flats z=0 vs z=2
    // (true distances 5 vs 3) must NOT prove a constant offset.
    const f = JOIN_FIXTURE_BY_ID.get('LA_CW_OVERLAP')!;
    type Legs = Parameters<typeof resolveCornerEffective>[1];
    const legs = (zIn: number, zOut: number): Legs => [
      { member: f.input.incoming, startZ: zIn, endZ: zIn },
      { member: f.input.outgoing, startZ: zOut, endZ: zOut },
    ];
    expect(resolveCornerEffective(ELEV, legs(0, 2), 'left', 100)).toEqual(
      expect.objectContaining({ proven: false, reason: 'ELEVATION_MEMBER_MISMATCH' }),
    );
    // Same-flat-Z elevation corner still admits (criterion-derived d=5).
    expect(resolveCornerEffective(ELEV, legs(0, 0), 'left', 100)).toEqual(
      expect.objectContaining({ proven: true, d: 5 }),
    );
    // Sloped member still rejects on slope, not mismatch.
    expect(
      resolveCornerEffective(
        ELEV,
        [
          { member: f.input.incoming, startZ: 0, endZ: 0 },
          { member: f.input.outgoing, startZ: 0, endZ: 10 },
        ],
        'left',
        100,
      ).reason,
    ).toBe('ELEVATION_SLOPED_SOURCE');
    // Distance/rel-el ignore member Z (class A): differing flats still prove.
    expect(resolveCornerEffective(DIST, legs(0, 2), 'left', 100)).toEqual(
      expect.objectContaining({ proven: true, d: 5 }),
    );
  });
  it('elevation flat-boundary exact: startZ===endZ proves, 1-ULP slope rejects', () => {
    expect(resolveEffectiveConstantOffset(ELEV, ARC(50, 0, 0), 1, 100)).toEqual(
      expect.objectContaining({ proven: true, d: 5, reason: 'ELEVATION_FLAT_SOURCE' }),
    );
    expect(resolveEffectiveConstantOffset(ELEV, ARC(50, 0, Number.MIN_VALUE), 1, 100)).toEqual(
      expect.objectContaining({ proven: false, reason: 'ELEVATION_SLOPED_SOURCE' }),
    );
  });
  it('distance/rel-el prove on sloped sources too (class A: no source term)', () => {
    expect(resolveEffectiveConstantOffset(DIST, ARC(50, 0, 10), 1, 100).proven).toBe(true);
    expect(resolveEffectiveConstantOffset(REL_EL, ARC(50, 0, 10), 1, 100).proven).toBe(true);
  });
  it('invalid + degenerate sources fail closed with named reasons (never a fallback constant)', () => {
    const flat = ARC(50, 0, 0);
    expect(resolveEffectiveConstantOffset({ kind: 'distance', gradeRatio: 1, distance: 0 }, flat, 1, 100).reason).toBe('INVALID_CRITERION');
    expect(resolveEffectiveConstantOffset({ kind: 'distance', gradeRatio: 1, distance: 200 }, flat, 1, 100).reason).toBe('INVALID_CRITERION');
    expect(resolveEffectiveConstantOffset({ kind: 'distance', gradeRatio: NaN, distance: 5 }, flat, 1, 100).reason).toBe('INVALID_CRITERION');
    expect(resolveEffectiveConstantOffset({ kind: 'relative-elevation', gradeRatio: 1, relativeElevation: -5 }, flat, 1, 100).reason).toBe('INVALID_CRITERION');
    expect(resolveEffectiveConstantOffset({ kind: 'elevation', gradeRatio: 1, targetElevation: -5 }, flat, 1, 100).reason).toBe('INVALID_CRITERION');
    expect(resolveEffectiveConstantOffset(DIST, { ...flat, isArc: false }, 1, 100).reason).toBe('DEGENERATE_SOURCE');
    expect(resolveEffectiveConstantOffset(DIST, { ...flat, radius: NaN }, 1, 100).reason).toBe('DEGENERATE_SOURCE');
    expect(resolveEffectiveConstantOffset(DIST, flat, null, 100).reason).toBe('DEGENERATE_SOURCE');
  });
  it('Roff exact boundaries: d=R collapse, d>R inward inversion, outward ok', () => {
    expect(gateRadiusOffset(5, -1, 5)).toEqual({ ok: false });
    expect(gateRadiusOffset(5, -1, 8)).toEqual({ ok: false });
    expect(gateRadiusOffset(5, -1, 4)).toEqual({ ok: true, radiusOffset: 1 });
    expect(gateRadiusOffset(5, 1, 5)).toEqual({ ok: true, radiusOffset: 10 });
    expect(gateRadiusOffset(5, -1, NaN)).toEqual({ ok: false });
    // Through the predicate: collapse/inversion fixtures reject on RADIUS, overlap proves.
    const inward = -1 as const;
    expect(resolveEffectiveConstantOffset(DIST, ARC(5, 0, 0), inward, 100).reason).toBe('RADIUS');
    expect(resolveEffectiveConstantOffset(
      { kind: 'distance', gradeRatio: 1, distance: 8 }, ARC(5, 0, 0), inward, 100,
    ).reason).toBe('RADIUS');
    expect(resolveEffectiveConstantOffset(DIST, ARC(50, 0, 0), inward, 100).proven).toBe(true);
  });
  it('mixed-effective: same-d proves, differing-d or surface legs fail', () => {
    const leg = (criterion: typeof DIST | typeof REL_EL | typeof ELEV, d5 = true) => ({
      criterion: d5 ? criterion : { kind: 'distance', gradeRatio: 1, distance: 7 } as const,
      source: ARC(50, 0, 0), radialSign: 1 as const,
    });
    expect(resolveMixedEffective([leg(DIST), leg(REL_EL)], 100)).toEqual(expect.objectContaining({ proven: true, d: 5 }));
    expect(resolveMixedEffective([leg(DIST), leg(REL_EL, false)], 100).reason).toBe('MIXED_EFFECTIVE');
    expect(resolveMixedEffective(
      [{ criterion: { kind: 'fixed', gradeRatio: 1 }, source: ARC(50, 0, 0), radialSign: 1 as const }],
      100,
    ).reason).toBe('SURFACE_TARGET');
    expect(resolveMixedEffective([], 100).reason).toBe('INVALID_CRITERION');
  });
  it('no sampling authority: ELEV_FLAT admits but flat-surface does not (target rep needed)', () => {
    const p = corpus();
    const flatProven = p.rows.filter((r) => r.family === 'ELEV_FLAT' && r.admit);
    expect(flatProven.length).toBe(5);
    expect(p.rows.filter((r) => (r.family === 'SURF_FIXED' || r.family === 'SURF_CUTFILL') && r.admit).length).toBe(0);
  });
  it('Roff exact sign: d=R collapse, d>R inversion, d<R ok', () => {
    expect(classifyOffsetJoin(JOIN_FIXTURE_BY_ID.get('LA_CCW_LEFT_COLLAPSE')!.input).classification).toBe('OFFSET_JOIN_COLLAPSE');
    expect(classifyOffsetJoin(JOIN_FIXTURE_BY_ID.get('LA_CCW_LEFT_INVERSION')!.input).classification).toBe('OFFSET_JOIN_INVERSION');
    expect(classifyOffsetJoin(JOIN_FIXTURE_BY_ID.get('LA_CW_OVERLAP')!.input).classification).toBe('OFFSET_JOIN_UNIQUE');
  });
  it('predicate radial-sign path agrees with the display lookup on every arc member', () => {
    for (const f of JOIN_FIXTURES) {
      for (const m of [f.input.incoming, f.input.outgoing]) {
        if (m.kind !== 'arc') continue;
        const sign = radialSignOf(m, f.input.side);
        expect(sign).not.toBeNull();
        const inwardLookup =
          (f.input.side === 'left' && m.dir === 1) || (f.input.side === 'right' && m.dir === -1);
        expect(sign).toBe(inwardLookup ? -1 : 1);
      }
    }
  });
});

describe('20L.1 candidacy + robustness', () => {
  it('every admitted row passes corner candidacy (finite join, on-curve, on-body, exact Roff, unique)', () => {
    const p = corpus();
    const admitted = p.rows.filter((r) => r.admit);
    expect(admitted.length).toBe(15);
    for (const r of admitted) {
      expect(r.cornerCandidacyPass).toBe(true);
      expect(r.candidacyDetail).toBe('CANDIDACY_OK');
    }
  });
  it('mesh topology recorded N/A with reason on every row (corner classifier, no mesh)', () => {
    const p = corpus();
    expect(p.rows.length).toBe(186);
    for (const r of p.rows) expect(r.meshTopology).toBe('NOT_APPLICABLE_CORNER_CLASSIFIER_NO_MESH');
  });
  it('no closed groups admitted (arc×arc NO_GO recorded truthfully)', () => {
    const p = corpus();
    expect(p.rows.filter((r) => r.admit && r.reasonCode === 'REJECT_ARC_PAIR_NO_GO').length).toBe(0);
  });
  it('origin shifts + rotation + scales + mirror + reversal: normalized geometry agrees', () => {
    const p = corpus();
    const keys = Object.keys(p.transformInvariance);
    expect(keys.length).toBe(5);
    for (const k of keys) {
      for (const cell of Object.values(p.transformInvariance[k]!)) {
        expect(cell.agree).toBe(true);
        expect(cell.joinErr!).toBeLessThanOrEqual(1e-6);
      }
    }
  });
  it('production criterion scaling truth: distance scales, rel-el/elevation invariant', () => {
    // cadProjectTransformGrading: XY similarity scales horizontal lengths
    // only. The geometric co-scaling test above exercises classifier math;
    // production transforms scale the distance-family D and leave Δ/E/g/Z.
    const d = scaleGradingCriterion({ kind: 'distance', gradeRatio: 1, distance: 5 }, 1000);
    expect(d).toEqual({ kind: 'distance', gradeRatio: 1, distance: 5000 });
    expect(scaleGradingCriterion({ kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 }, 1000))
      .toEqual({ kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 });
    expect(scaleGradingCriterion({ kind: 'elevation', gradeRatio: 1, targetElevation: 5 }, 1000))
      .toEqual({ kind: 'elevation', gradeRatio: 1, targetElevation: 5 });
  });
});
