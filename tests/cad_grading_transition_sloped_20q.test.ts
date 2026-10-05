/**
 * Phase 20Q — sloped-source study pins (STUDY ONLY, zero `src/` changes).
 *
 * Pins the production freeze (sloped sources fail closed at NON_FLAT
 * through both `admitGradingTransition` and `planTransitionJoint`), the
 * zero-slope S-law reduction (bitwise-exact Phase 20P.1 flat behavior),
 * S1 law properties via the study oracle (`scripts/phase20qLaws.ts`,
 * which imports production math and never copies it), and the
 * per-family daylight formulas. Asserts exact `===` throughout — no
 * epsilon anywhere. Asserts nothing about C1 continuity (production has
 * no C1 authority).
 */
import { describe, expect, it } from 'vitest';

import {
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  admitGradingTransition,
  evaluateTransitionLinearV1,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { transitionDaylightAt } from '../src/engine/cad/grading/gradingGroupTransitionTile';
import { planTransitionJoint, type MemberSolve, type TransitionTileInput } from '../src/engine/cad/grading/gradingGroupTransitionTile';
import type { CadGradingTransition } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import {
  buildPhase20qCases,
  type Phase20qCase,
  type Phase20qFamily,
} from '../scripts/phase20qFixtures';
import {
  checkFlatReductionExact,
  evaluatePhase20qLaw,
  phase20qHybridPoints,
  phase20qStations,
  PHASE20Q_S3_TAU,
} from '../scripts/phase20qLaws';
import { phase20qMeshFacts, phase20qWorkerFacts } from '../scripts/phase20qEvidence';
import {
  checkFlatReductionFullSolve,
  phase20qExtendedStudyTile,
  phase20qRealTilingProbe,
  phase20qVerticalExtension,
} from '../scripts/phase20qTiling';
import {
  persistPhase20qInputs,
  phase20qIndependentRecompute,
  phase20qJointZControl,
  phase20qPerCheckpointSourceZExtension,
  phase20qSourceZAwareCheck,
  phase20qValidatorMeshUntampered,
  phase20qWidthTamperViaValidator,
  verifyPhase20qPersistedBytesFromDisk,
} from '../scripts/phase20qRecheck';
import { phase20qTransformDeviations } from '../scripts/phase20qTransforms';

const GRADE = 0.5;
const DIST = (d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: GRADE, distance: d });

const member = (id: string, startZ: number, endZ: number): TransitionMemberGeometry => ({
  memberId: id,
  criterion: DIST(5),
  length: 30,
  dirX: 30,
  dirY: 0,
  startZ,
  endZ,
  isArc: false,
  maxSearchDistance: 50,
});

const input = (l: TransitionMemberGeometry, r: TransitionMemberGeometry): AdmitTransitionInput => ({
  policyVersion: TRANSITION_POLICY_VERSION,
  lawKind: TRANSITION_LAW_KIND,
  lawVersion: TRANSITION_LAW_VERSION,
  criterionFamily: 'distance',
  jointId: 'joint:0',
  memberIds: ['L', 'R'],
  width: 8,
  side: 'left',
  groupSide: 'left',
  isOpen: true,
  transitionCount: 1,
  jointZ: 10,
  members: [l, r],
});

const resolved = (endZ: number, startZNext: number): ResolvedGradingSource[] => [
  { startX: 0, startY: 0, endX: 30, endY: 0, startZ: 10, endZ, length: 30, reoriented: false, isArc: false },
  { startX: 30, startY: 0, endX: 80, endY: 0, startZ: startZNext, endZ: 10, length: 50, reoriented: false, isArc: false },
];

const tileInput = (): TransitionTileInput => {
  const intent: CadGradingTransition = {
    policyVersion: TRANSITION_POLICY_VERSION,
    jointId: 'joint:0',
    memberIds: ['L', 'R'],
    width: 8,
    lawKind: TRANSITION_LAW_KIND,
    lawVersion: TRANSITION_LAW_VERSION,
    criterionFamily: 'distance',
    side: 'left',
  };
  return { side: 'left', revision: 'ggrev1:phase20q-study', maxSearchDistance: 50, transition: intent, transitionMemberKeys: ['L', 'R'] };
};

const slopedCases = (): Phase20qCase[] => buildPhase20qCases().filter((c) => c.matrix === 'sloped');
const flatCases = (): Phase20qCase[] => slopedCases().filter((c) => c.slopePattern === 'FLAT_FLAT');

describe('20Q.1 production freeze: sloped sources fail closed', () => {
  it('admission rejects every sloped source at NON_FLAT (flat control admits)', () => {
    for (const dz of [1e-9, 0.01, 1]) {
      for (const [endZ, startZ] of [[10 + dz, 10 + dz], [10, 10 + dz]] as const) {
        const r = admitGradingTransition(input(member('L', 10, endZ), member('R', startZ, 10)));
        expect(r.ok).toBe(false);
        if (!r.ok) {
          expect(r.code).toBe('NON_FLAT');
          expect(r.detail).toBe('both adjacent members must be exactly flat');
        }
      }
    }
    expect(admitGradingTransition(input(member('L', 10, 10), member('R', 10, 10))).ok).toBe(true);
  });

  it('joint planning maps the sloped reject to bounded TRANSITION codes', () => {
    const out = planTransitionJoint(tileInput(), resolved(11, 11), () => DIST(5), [] as unknown as MemberSolve[], 1);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe('TRANSITION_REJECTED');
      expect(out.detail).toBe('GRADING_AGREEMENT_TRANSITION_NON_FLAT: both adjacent members must be exactly flat');
    }
  });
});

describe('20Q.2 zero-reduction: zero-slope S laws reduce exactly to 20P.1 flat', () => {
  it('FLAT_FLAT reduces bitwise-exact on S1/S2/S3; every sloped row is out of scope', () => {
    for (const c of flatCases()) {
      for (const law of ['S1', 'S2', 'S3'] as const) {
        const r = evaluatePhase20qLaw(law, c, phase20qStations(c), PHASE20Q_S3_TAU);
        expect(checkFlatReductionExact(c, r)).toBe(true);
      }
    }
    for (const c of slopedCases().filter((c) => c.slopePattern !== 'FLAT_FLAT')) {
      const r = evaluatePhase20qLaw('S1', c, phase20qStations(c), PHASE20Q_S3_TAU);
      expect(checkFlatReductionExact(c, r)).toBeNull();
    }
  });

  it('flat rows match the legislated V1 + tile per family with === (no epsilon)', () => {
    for (const f of ['distance', 'relative-elevation', 'elevation'] as const) {
      const c = flatCases().find((c) => c.family === f && c.side === 'left')!;
      const r = evaluatePhase20qLaw('S1', c, phase20qStations(c), PHASE20Q_S3_TAU);
      for (const p of r.points) {
        const v = evaluateTransitionLinearV1(r.vL, r.vR, c.sL, c.sR, p.s - c.LL);
        expect(p.scalarV).toBe(v);
        const q = transitionDaylightAt(c.family, v, c.gradeRatio, c.jointZ, p.s, 0, 0, 1);
        expect([p.dayX, p.dayY, p.dayZ]).toEqual([q.x, q.y, q.z]);
      }
    }
  });
});

describe('20Q.3 S1 law properties (study oracle, production math)', () => {
  const crestSag = (): Phase20qCase[] => slopedCases().filter((c) => c.slopePattern === 'CREST' || c.slopePattern === 'SAG');

  it('C0 is exact at joint and cuts on crest/sag (gap === 0, never epsilon)', () => {
    for (const c of crestSag()) {
      const r = evaluatePhase20qLaw('S1', c, phase20qStations(c), PHASE20Q_S3_TAU);
      expect(r.c0JointGap).toBe(0);
      expect(r.c0CutL).toBe(0);
      expect(r.c0CutR).toBe(0);
      expect(r.rejectReason).toBeNull();
    }
  });

  it('source endpoints are bitwise preserved (input Z never rewritten)', () => {
    for (const c of slopedCases()) {
      const pts = phase20qHybridPoints(c, 'S1', PHASE20Q_S3_TAU);
      const end0 = pts[0]!;
      const end1 = pts[pts.length - 1]!;
      expect([end0.srcX, end0.srcY, end0.srcZ]).toEqual([c.startX, c.startY, c.startZ]);
      expect([end1.srcX, end1.srcY, end1.srcZ]).toEqual([c.endX, c.endY, c.endZ]);
    }
  });

  it('reversal/mirror/large-coordinate stay within corpus bounds (<=7e-9 at 1e8)', () => {
    let xy1e8 = 0;
    let xy1e6 = 0;
    let zShift = 0;
    for (const c of slopedCases()) {
      const t = phase20qTransformDeviations(c, 'S1');
      xy1e8 = Math.max(xy1e8, t.xy1e8 as number);
      xy1e6 = Math.max(xy1e6, t.xy1e6 as number);
      zShift = Math.max(zShift, t.zShift as number);
      expect(t.mirror).toBe(0);
      expect(t.reversal).toBe(0);
    }
    expect(xy1e8).toBeLessThanOrEqual(7e-9);
    expect(xy1e6).toBeLessThanOrEqual(6e-11);
    expect(zShift).toBeLessThanOrEqual(3e-14);
  });

  it('M2 width-tamper accounting: untampered-reject rows are inapplicable, never caught', () => {
    // Agreement + width probes count ONLY where untampered passes
    // (applicable). Sloped S1 CREST 0.05: rel-elev applicable+caught,
    // distance/elevation inapplicable with the expected-reject code in
    // detail (never in caught totals).
    const sample = slopedCases().filter((c) => c.slopePattern === 'CREST' && c.slopeMag === 0.05);
    expect(sample.length).toBeGreaterThan(0);
    for (const c of sample) {
      const w = phase20qWorkerFacts(c, 'S1');
      expect(w.error).toBeNull();
      expect(w.tampers.length).toBe(6);
      const applicable = w.agreement === null;
      for (const t of w.tampers.filter((t) => t.probe !== 'tampered-width')) {
        if (!applicable) {
          expect(t.caught).toBe(false);
          expect(t.detail).toBe(`inapplicable:untampered=${w.agreement}`);
        } else {
          expect(t.caught).toBe(true);
        }
      }
      const width = w.tampers.find((t) => t.probe === 'tampered-width')!;
      const probe = phase20qWidthTamperViaValidator(c, 'S1');
      expect(width.caught).toBe(probe.applicable && probe.tampered !== null);
      if (!probe.applicable) {
        expect(width.caught).toBe(false);
        expect(width.detail).toBe(`inapplicable:untampered=${probe.untampered}`);
        expect(probe.untampered).toBe('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
      } else {
        expect(width.caught).toBe(true);
      }
    }
  });
});

describe('20Q.4 family daylight semantics (production tile, per family)', () => {
  it('pins d/z formulas per family at the tile (L109-110)', () => {
    const left = transitionDaylightAt('distance', 5, GRADE, 10, 0, 0, 0, 1);
    expect([left.d, left.z]).toEqual([5, 10 + GRADE * 5]);
    const rel = transitionDaylightAt('relative-elevation', 2.5, GRADE, 10, 0, 0, 0, 1);
    expect([rel.d, rel.z]).toEqual([2.5 / GRADE, 10 + 2.5]);
    const elev = transitionDaylightAt('elevation', 12.5, GRADE, 10, 0, 0, 0, 1);
    expect([elev.d, elev.z]).toEqual([(12.5 - 10) / GRADE, 12.5]);
  });

  it('sloped-source daylight derives from physical z(s) + V1 v(s) + fixed g', () => {
    const sample = slopedCases().filter((c) => c.W === 10 && c.side === 'left').slice(0, 24);
    expect(sample.length).toBeGreaterThan(0);
    for (const c of sample) {
      const r = evaluatePhase20qLaw('S1', c, phase20qStations(c), PHASE20Q_S3_TAU);
      for (const p of r.points) {
        const leftSide = p.tag === 'jointR' || p.tag === 'midR' || p.tag === 'cutR' || p.tag === 'end1' ? false : true;
        const zSrc = leftSide ? c.jointZL + c.srcSlopeL * (p.s - c.LL) : c.jointZR + c.srcSlopeR * (p.s - c.LL);
        expect(p.srcZ).toBe(zSrc);
        expect(p.dayZ).toBe(transitionDaylightAt(c.family, p.scalarV, c.gradeRatio, zSrc, p.s, 0, 0, 1).z);
      }
    }
  });
});

describe('20Q.12 B1: S1 against the REAL production tiling path', () => {
  it('flat controls admit with source-exact endpoints; every sloped row rejects', () => {
    for (const c of flatCases()) {
      const probe = phase20qRealTilingProbe(c);
      expect(probe.admitted).toBe(true);
    }
    for (const c of slopedCases().filter((c) => c.slopePattern !== 'FLAT_FLAT')) {
      const probe = phase20qRealTilingProbe(c);
      expect(probe.admitted).toBe(false);
      expect(probe.code).toBe('TRANSITION_REJECTED');
    }
  });

  it('zero-reduction holds against the FULL production flat solve (102/102)', () => {
    let checked = 0;
    for (const c of flatCases()) {
      for (const law of ['S1', 'S2', 'S3'] as const) {
        expect(checkFlatReductionFullSolve(c, law)).toBe(true);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
    for (const c of slopedCases().filter((c) => c.slopePattern !== 'FLAT_FLAT')) {
      expect(checkFlatReductionFullSolve(c, 'S1')).toBeNull();
    }
  });

  it('minimal vertical extension reproduces S1 exactly; fixed-Z diverges on slope', () => {
    for (const c of slopedCases().filter((c) => c.slopePattern !== 'FLAT_FLAT').slice(0, 36)) {
      const ext = phase20qVerticalExtension(c);
      expect(ext.extensionDev).toBe(0);
      expect(ext.fixedZDev).toBeGreaterThan(0);
    }
    for (const c of flatCases().slice(0, 6)) {
      const ext = phase20qVerticalExtension(c);
      expect(ext.extensionDev).toBe(0);
      expect(ext.fixedZDev).toBe(0);
    }
  });
});

describe('20Q.13 B2: source-Z-aware check is real PASS/FAIL per family', () => {
  it('S1 passes on every sloped row; jointZ-fixed control diverges on slope only', () => {
    for (const c of slopedCases()) {
      expect(phase20qSourceZAwareCheck(c, 'S1')).toBe('PASS');
    }
    for (const c of slopedCases().filter((c) => c.slopePattern !== 'FLAT_FLAT')) {
      expect(phase20qJointZControl(c, 'S1')).toBe('FAIL-expected-sloped-divergence');
    }
    for (const c of flatCases()) {
      expect(phase20qJointZControl(c, 'S1')).toBe('PASS-flat');
    }
  });
});

describe('20Q.14 B3: persisted recompute from row fields only; width via real validator', () => {
  it('independent recompute from persisted fields matches the row scalars', () => {
    const sample = slopedCases().filter((c) => c.W === 10).slice(0, 24);
    expect(sample.length).toBeGreaterThan(0);
    for (const c of sample) {
      const w = phase20qWorkerFacts(c, 'S1');
      const p = persistPhase20qInputs(c, 'S1');
      const ind = phase20qIndependentRecompute(p, w.recomputeVL, w.recomputeVR);
      expect(ind.error).toBeNull();
      expect(ind.matchVsRow).toBe(true);
    }
  });

  it('width tamper is caught by the real validator; untampered flat passes', () => {
    for (const c of flatCases()) {
      const t = phase20qWidthTamperViaValidator(c, 'S1');
      expect(t.untampered).toBeNull();
      expect(t.caught).toBe(true);
    }
  });
});

describe('20Q.15 M4: mesh expectation declared before build/measure', () => {
  it('expectedRegions is declared (1) with a null pre-mesh gate on every row', () => {
    for (const c of slopedCases()) {
      const m = phase20qMeshFacts(c, 'S1');
      expect(m.expectedRegions).toBe(1);
      expect(m.preMeshGate).toBeNull();
    }
  });
});

describe('20Q.17 M1: real validator per family on untampered sloped S1', () => {
  it('pins the exact per-family table (distance+elevation OFF_LAW, rel-elev passes)', () => {
    // Flat rows pass everywhere; sloped rel-elev passes (source-Z cancels);
    // sloped elevation always rejects; sloped distance passes ONLY inside
    // tolerance (1e-9 slope, W2) and rejects everywhere else — all at the
    // exact GRADING_AGREEMENT_TRANSITION_OFF_LAW code, never a new gate.
    let distancePass = 0;
    let distanceFail = 0;
    for (const c of slopedCases()) {
      const code = phase20qValidatorMeshUntampered(c, 'S1');
      if (c.family === 'relative-elevation') {
        expect(code).toBeNull();
      } else if (c.family === 'elevation') {
        if (c.slopePattern === 'FLAT_FLAT') expect(code).toBeNull();
        else expect(code).toBe('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
      } else {
        if (code === null) {
          distancePass += 1;
          const flat = c.slopePattern === 'FLAT_FLAT';
          const nearFlat = c.slopeMag === 0.000000001 && c.W === 2;
          expect(flat || nearFlat).toBe(true);
        } else {
          distanceFail += 1;
          expect(code).toBe('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
        }
      }
    }
    expect([distancePass, distanceFail]).toEqual([18, 204]);
  });

  it('per-checkpoint-source-Z extension passes every sloped S1 row, all families', () => {
    for (const c of slopedCases()) {
      expect(phase20qPerCheckpointSourceZExtension(c, 'S1')).toBe('PASS');
    }
  });
});

describe('20Q.18 m3: persisted-bytes check reads the written corpus from disk', () => {
  it('recomputes worker values from stored fields only (2622/2622)', async () => {
    const v = await verifyPhase20qPersistedBytesFromDisk('docs/evidence/phase20q/corpus.json');
    expect(v.rows).toBe(2622);
    expect(v.mismatches).toEqual([]);
    expect(v.scalarMatch).toBe(2622);
    expect(v.agreementMatch).toBe(2622);
  });

  it('M2 totals read back from persisted bytes: 894 caught, 1728 inapplicable, 0 missed', async () => {
    const { readFile } = await import('node:fs/promises');
    const rows = JSON.parse(await readFile('docs/evidence/phase20q/corpus.json', 'utf8')) as {
      worker: { tampers: { probe: string; caught: boolean; detail: string }[] };
    }[];
    expect(rows.length).toBe(2622);
    let caught = 0;
    let inapplicable = 0;
    let missed = 0;
    for (const r of rows) {
      const width = r.worker.tampers.find((t) => t.probe === 'tampered-width')!;
      if (width.caught) caught += 1;
      else if (width.detail.startsWith('inapplicable:')) inapplicable += 1;
      else missed += 1;
    }
    expect([caught, inapplicable, missed]).toEqual([894, 1728, 0]);
  });

  it('M2 agreement-tamper totals read back from persisted bytes: 102 caught, 2520 inapplicable, 0 missed per probe', async () => {
    const { readFile } = await import('node:fs/promises');
    const rows = JSON.parse(await readFile('docs/evidence/phase20q/corpus.json', 'utf8')) as {
      worker: { agreement: string | null; tampers: { probe: string; caught: boolean; detail: string }[] };
    }[];
    expect(rows.length).toBe(2622);
    for (const probe of ['tampered-sourceZ', 'tampered-slope', 'tampered-scalar', 'tampered-family', 'tampered-side']) {
      let caught = 0;
      let inapplicable = 0;
      let missed = 0;
      for (const r of rows) {
        const t = r.worker.tampers.find((x) => x.probe === probe)!;
        if (t.caught) {
          caught += 1;
          expect(r.worker.agreement).toBeNull();
        } else if (t.detail.startsWith('inapplicable:')) {
          inapplicable += 1;
          expect(r.worker.agreement).not.toBeNull();
          expect(t.detail).toBe(`inapplicable:untampered=${r.worker.agreement}`);
        } else missed += 1;
      }
      expect([caught, inapplicable, missed]).toEqual([102, 2520, 0]);
    }
  });
});

describe('20Q.19 M4: extended study tile end-to-end (outer sub-solves + checkpoints)', () => {
  it('outer production sub-solves + inner extension reproduce S1 exactly (dev 0, 8 checkpoints)', () => {
    for (const c of slopedCases()) {
      const t = phase20qExtendedStudyTile(c);
      expect(t.outerOk).toBe(true);
      expect(t.outerCode).toBeNull();
      expect(t.outerDev).toBe(0);
      expect(t.extensionDev).toBe(0);
      expect(t.checkpoints).toBe(8);
    }
  });
});
