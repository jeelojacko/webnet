/**
 * Phase 20P — sparse collinear transition-set study (STUDY ONLY, zero
 * `src/` changes).
 *
 * Sparse joint sets ([0,2], [0,2,4]) and mixed clusters ([0,1,3],
 * [0,2,3,5]) over minimal honest full-group fixtures. Pins:
 * A. the study sparse-set predicate (strict increase with gaps, exact `<`
 *    global station separation, touch/overlap reject, consecutive
 *    reduction == 20N.1 production rule, whole-set fail-closed, trp1
 *    admission unchanged incl. NON_COLLINEAR and width rejects);
 * B. topology DECLARED 1/1/1 pre-mesh (never from a measured count), then
 *    independently measured + gtop2-certified; wrong budget / tied split /
 *    touch-overlap cannot launder to a certificate; production today still
 *    rejects sparse sets;
 * C. worker per-transition agreement + legs-mesh validators accept sparse
 *    result-owned checkpoints while the production group pre-solve gate
 *    still fails closed; one stale/malformed transition or leg rejects the
 *    whole set; skipped native joints own no checkpoints;
 * D. provenance/revision: order-sensitive `ggrev1` (no silent sort), one
 *    citation per intent, positional leg[i]<->intent[i] across gaps,
 *    missing/mismatched leg blocked, skipped joints uncited, persistence
 *    roundtrip keeps sparse ids/order/width precision.
 *
 * Authorities are production imports read-only; the study helper only adds
 * the generalized station-gap arithmetic that production does not yet own.
 */
import { describe, expect, it } from 'vitest';

import {
  admitGradingTransition,
  deriveGroupTransitionExpectation,
  selectGroupTransitions,
  TRANSITION_LAW_KIND,
  TRANSITION_LAW_VERSION,
  TRANSITION_POLICY_VERSION,
  checkGroupTransitionSeparation,
  type AdmitTransitionInput,
  type TransitionMemberGeometry,
} from '../src/engine/cad/grading/gradingTransitionPolicy';
import { deriveTransitionExpectation } from '../src/engine/cad/grading/gradingTopologyExpectation';
import {
  buildGradingTopologyCertificateExact,
  countPositiveWidthRegions,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { buildGroupRevision, type GroupRevisionInput } from '../src/engine/cad/grading/gradingGroupRevision';
import {
  applyTransitionProductGate,
  buildTransitionProvenance,
  transitionEvidenceMatchesIntent,
  transitionResultBakeCitations,
} from '../src/engine/cad/grading/gradingTransitionProvenance';
import { courseCriterionKey } from '../src/engine/cad/grading/gradingGroupCourseCriteria';
import type { CadGradingTransitionProvenance } from '../src/engine/cad/grading/gradingGroupTypes';
import {
  checkGroupTransitionAgreement,
  checkGroupTransitionPlansAgreement,
  validateGroupTransitionLegsMesh,
  validateTransitionResultMesh,
} from '../src/workers/surfaceGradingCompute';
import {
  resolveGroupTransitionMemberViews,
  transitionPlansOf,
} from '../src/workers/surfaceWorkerHandler';
import {
  buildSparseGroup,
  consecutiveReductionMatchesProduction,
  deriveSparsePreMeshExpectation,
  flatPoints,
  meshSparseGroup,
  sparseLegs,
  sparsePlans,
  sparsePredicate,
  sparseWorkerRequest,
  tileSparseGroup,
  type SparseFixtureSpec,
  type SparseGeometry,
} from './helpers/sparseTransitionFixtures';

const FIXTURES = {
  sparse2: {
    fixtureId: 'sparse2',
    family: 'distance',
    memberLengths: [40, 24, 30, 40],
    transitions: [
      { joint: 0, width: 8 },
      { joint: 2, width: 6 },
    ],
  },
  sparse3: {
    fixtureId: 'sparse3',
    family: 'distance',
    memberLengths: [30, 24, 28, 26, 30, 32],
    transitions: [
      { joint: 0, width: 8 },
      { joint: 2, width: 6 },
      { joint: 4, width: 4 },
    ],
  },
  mixed2: {
    fixtureId: 'mixed2',
    family: 'distance',
    memberLengths: [30, 24, 28, 26, 30],
    transitions: [
      { joint: 0, width: 8 },
      { joint: 1, width: 6 },
      { joint: 3, width: 4 },
    ],
  },
  mixed3: {
    fixtureId: 'mixed3',
    family: 'distance',
    memberLengths: [30, 24, 28, 26, 30, 32, 28],
    transitions: [
      { joint: 0, width: 8 },
      { joint: 2, width: 6 },
      { joint: 3, width: 4 },
      { joint: 5, width: 5 },
    ],
  },
  wideGap: {
    fixtureId: 'wideGap',
    family: 'distance',
    memberLengths: [100, 5, 100, 100],
    transitions: [
      { joint: 0, width: 10 },
      { joint: 2, width: 190 },
    ],
  },
  touchSparse: {
    fixtureId: 'touchSparse',
    family: 'distance',
    memberLengths: [40, 24, 30, 40],
    transitions: [
      { joint: 0, width: 48 },
      { joint: 2, width: 60 },
    ],
  },
  overlapAdjacent: {
    fixtureId: 'overlapAdjacent',
    family: 'distance',
    memberLengths: [30, 24, 28, 26, 30],
    transitions: [
      { joint: 0, width: 26 },
      { joint: 1, width: 24 },
    ],
  },
  touchAdjacent: {
    fixtureId: 'touchAdjacent',
    family: 'distance',
    memberLengths: [30, 24, 28, 26, 30],
    transitions: [
      { joint: 0, width: 24 },
      { joint: 1, width: 24 },
    ],
  },
} satisfies Record<string, SparseFixtureSpec>;

const build = (spec: SparseFixtureSpec): SparseGeometry => {
  const out = buildSparseGroup(spec);
  expect(out.ok).toBe(true);
  if (!out.ok) throw new Error(`fixture ${spec.fixtureId} did not build: ${out.code}`);
  return out.value;
};

const preMeshOf = (geometry: SparseGeometry) => {
  const out = deriveSparsePreMeshExpectation(geometry);
  expect(out.ok).toBe(true);
  if (!out.ok) throw new Error(`expected pre-mesh declaration: ${out.code}`);
  return out.value;
};

const revisionInput = (geometry: SparseGeometry, transitions = geometry.transitions.map((t) => t.intent)): GroupRevisionInput => {
  const memberCriterion = geometry.members[0]!.criterion;
  return {
    sourceFeatureLineId: 'fl-sparse',
    courses: geometry.members.map((m, i) => ({
      vertexAId: `S${i}`,
      vertexBId: `S${i + 1}`,
      resolvedSource: {
        startX: m.startStation,
        startY: 0,
        endX: m.startStation + m.length,
        endY: 0,
        startZ: geometry.jointZ,
        endZ: geometry.jointZ,
        length: m.length,
        reoriented: false,
        isArc: false,
      },
    })),
    side: geometry.side,
    criterion: memberCriterion,
    courseCriteria: geometry.members
      .filter((m) => JSON.stringify(m.criterion) !== JSON.stringify(memberCriterion))
      .map((m) => ({ sourceCourse: { vertexAId: `S${m.index}`, vertexBId: `S${m.index + 1}` }, criterion: m.criterion })),
    maxSearchDistance: geometry.family === 'elevation' ? 100 : 50,
    curveChordTolerance: 0.05,
    cornerMode: 'miter',
    closed: false,
    transitions,
  };
};

const bareGeometry = (): TransitionMemberGeometry => ({
  memberId: 'L',
  criterion: { kind: 'distance', gradeRatio: 0.5, distance: 5 },
  length: 20,
  dirX: 1,
  dirY: 0,
  startZ: 10,
  endZ: 10,
  isArc: false,
  maxSearchDistance: 50,
});

const bareAdmission = (overrides: Partial<AdmitTransitionInput> = {}): AdmitTransitionInput => ({
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
  members: [bareGeometry(), { ...bareGeometry(), memberId: 'R' }],
  ...overrides,
});

/* ── A. Candidate predicate ─────────────────────────────────────────────── */

describe('20P-A sparse-set predicate: strict increase with gaps, exact separation', () => {
  it('admits [0,2] and [0,2,4] with gaps and records the station gaps', () => {
    const two = build(FIXTURES.sparse2);
    const three = build(FIXTURES.sparse3);
    expect(sparsePredicate(two)).toMatchObject({ ok: true });
    expect(sparsePredicate(three)).toMatchObject({ ok: true });
    expect(two.transitions.map((t) => t.joint)).toEqual([0, 2]);
    expect(three.transitions.map((t) => t.joint)).toEqual([0, 2, 4]);
    // Station gaps are the FULL member run between joints, not one member.
    expect(two.transitions[0]!.station).toBe(40);
    expect(two.transitions[1]!.station).toBe(94);
    expect(three.transitions.map((t) => t.station)).toEqual([30, 82, 138]);
  });

  it('rejects duplicate / out-of-order / out-of-range / malformed joints (never sorted)', () => {
    const duplicate: SparseFixtureSpec = { ...FIXTURES.sparse2, transitions: [{ joint: 0, width: 8 }, { joint: 0, width: 6 }] };
    const outOfOrder: SparseFixtureSpec = { ...FIXTURES.sparse2, transitions: [{ joint: 2, width: 8 }, { joint: 0, width: 6 }] };
    const outOfRange: SparseFixtureSpec = { ...FIXTURES.sparse2, transitions: [{ joint: 0, width: 8 }, { joint: 9, width: 6 }] };
    for (const spec of [duplicate, outOfOrder, outOfRange]) {
      const out = buildSparseGroup(spec);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe('MALFORMED');
    }
  });

  it('exact `<`: sparse touch (==) rejects, and adjacent overlap (>) rejects', () => {
    expect(sparsePredicate(build(FIXTURES.touchSparse))).toMatchObject({ ok: false, code: 'TOUCHING_NOT_AUTHORIZED' });
    expect(sparsePredicate(build(FIXTURES.touchAdjacent))).toMatchObject({ ok: false, code: 'TOUCHING_NOT_AUTHORIZED' });
    expect(sparsePredicate(build(FIXTURES.overlapAdjacent))).toMatchObject({ ok: false, code: 'OVERLAP_REJECTED' });
    expect(deriveSparsePreMeshExpectation(build(FIXTURES.touchSparse)).ok).toBe(false);
    expect(deriveSparsePreMeshExpectation(build(FIXTURES.overlapAdjacent)).ok).toBe(false);
  });

  it('consecutive reduction is exactly the 20N.1 production separation rule', () => {
    const mixed = build(FIXTURES.mixed2); // joints [0,1,3]; 0 and 1 are consecutive
    expect(consecutiveReductionMatchesProduction(mixed)).toBe(true);
    // Same shared member length the production authority would consume.
    expect(checkGroupTransitionSeparation([8, 6], [mixed.members[1]!.length])).toBe(true);
    expect(consecutiveReductionMatchesProduction(build(FIXTURES.touchAdjacent))).toBe(false);
  });

  it('generalized gap uses the station difference, not the immediate member length', () => {
    const wide = build(FIXTURES.wideGap); // members [100,5,100,100], joints 0 and 2
    expect(wide.transitions[1]!.station - wide.transitions[0]!.station).toBe(105);
    expect(sparsePredicate(wide).ok).toBe(true);
    // The immediate shared member (L1=5) would reject the same sparse set.
    expect(checkGroupTransitionSeparation([10, 190], [wide.members[1]!.length])).toBe(false);
  });

  it('whole set fails closed when one transition is inadmissible', () => {
    const bad: SparseFixtureSpec = {
      ...FIXTURES.mixed2,
      transitions: [{ joint: 0, width: 8 }, { joint: 1, width: 100 }, { joint: 3, width: 4 }],
    };
    const out = buildSparseGroup(bad);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('WIDTH_INFEASIBLE');
  });

  it('gaps >= 2 members cannot overlap while per-joint admission holds (automatic separation)', () => {
    // W_i/2 <= min(L_i, L_{i+1}) <= L_{i+1} and W_j/2 <= min(L_j, L_{j+1}) <= L_j,
    // so the half-span is bounded by the skipped member run = the station gap.
    for (const spec of [FIXTURES.sparse2, FIXTURES.sparse3, FIXTURES.mixed2, FIXTURES.mixed3]) {
      const geometry = build(spec);
      geometry.transitions.forEach((t) => {
        expect(t.width / 2).toBeLessThanOrEqual(Math.min(geometry.members[t.memberL]!.length, geometry.members[t.memberR]!.length));
      });
      expect(sparsePredicate(geometry)).toMatchObject({ ok: true, code: 'OK' });
    }
  });
});

describe('20P-A admission predicate pins (trp1 untouched)', () => {
  it('exact-zero collinearity still admits; any deflection is NON_COLLINEAR', () => {
    const straight = admitGradingTransition(bareAdmission());
    expect(straight.ok).toBe(true);
    const bent = admitGradingTransition(
      bareAdmission({ members: [bareGeometry(), { ...bareGeometry(), memberId: 'R', dirY: 0.1 }] }),
    );
    expect(bent.ok).toBe(false);
    if (!bent.ok) expect(bent.code).toBe('NON_COLLINEAR');
  });

  it('zero / negative / NaN / Infinity widths reject at admission', () => {
    for (const width of [0, -8, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = admitGradingTransition(bareAdmission({ width }));
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.code).toBe('WIDTH_INVALID');
    }
  });
});

/* ── B. Topology expectation declared pre-mesh ──────────────────────────── */

describe('20P-B topology: 1/1/1 declared from structure, measured independently', () => {
  it.each(['sparse2', 'sparse3', 'mixed2', 'mixed3'] as const)('%s: pre-mesh declaration recorded BEFORE meshing', (key) => {
    const geometry = build(FIXTURES[key]);
    // DECLARE first — no produced array has been read at this point.
    const pre = preMeshOf(geometry);
    expect(pre.expectedPositiveWidthRegions).toBe(1);
    expect(pre.expectedComponents).toBe(1);
    expect(pre.expectedBoundaryCycles).toBe(1);
    expect(pre.expectation).toMatchObject({
      scope: 'group',
      shape: 'open-strip',
      positiveWidthRegionCount: 1,
      expectedFaceComponents: 1,
      expectedBoundaryCycles: 1,
      closed: false,
    });
    // THEN measure + certify against the declaration.
    const tiled = tileSparseGroup(geometry);
    const facts = meshSparseGroup(tiled, pre);
    expect(facts.measuredPositiveWidthRegions).toBe(pre.expectedPositiveWidthRegions);
    expect(countPositiveWidthRegions(tiled.source, tiled.daylight)).toBe(1);
    expect(facts.certificate).not.toBeNull();
    expect(facts.certificate).toMatchObject({ components: 1, boundaryCycles: 1, expectedComponents: 1, expectedBoundaryCycles: 1 });
    expect(facts.exactError).toBeNull();
    expect(facts.productionError).toBeNull();
  });

  it('distance/relative-elevation/elevation all declare and measure one region', () => {
    for (const family of ['distance', 'relative-elevation', 'elevation'] as const) {
      const geometry = build({ ...FIXTURES.sparse2, fixtureId: `sparse2-${family}`, family });
      const pre = preMeshOf(geometry);
      const facts = meshSparseGroup(tileSparseGroup(geometry), pre);
      expect(facts.measuredPositiveWidthRegions).toBe(1);
      expect(facts.certificate).not.toBeNull();
      expect(facts.exactError).toBeNull();
    }
  });

  it('a wrong 2-region budget does not certify a one-strip mesh', () => {
    const geometry = build(FIXTURES.sparse2);
    const tiled = tileSparseGroup(geometry);
    const facts = meshSparseGroup(tiled, preMeshOf(geometry));
    const wrong = {
      ...preMeshOf(geometry),
      expectation: {
        ...preMeshOf(geometry).expectation,
        expectedFaceComponents: 2,
        expectedBoundaryCycles: 2,
        positiveWidthRegionCount: 2,
      },
    };
    const cert = buildGradingTopologyCertificateExact({
      scope: 'group',
      points: facts.mesh.points,
      triangles: facts.mesh.triangles,
      expectation: wrong.expectation,
      sourceBoundaryPoints: flatPoints(tiled.source),
      gradingBoundaryPoints: flatPoints(tiled.daylight),
    });
    expect(cert).toBeNull();
  });

  it('a tied/split fixture never launders to the declared 1', () => {
    const geometry = build(FIXTURES.sparse2);
    const tiled = tileSparseGroup(geometry);
    const tied = {
      ...tiled,
      source: tiled.source.map((p) => ({ ...p })),
      daylight: tiled.daylight.map((p) => ({ ...p })),
    };
    // Tie an INTERIOR cell (contiguous zero-width run) so the strip splits
    // into two positive-width regions: the declaration of 1 can no longer hold.
    let tieIdx = -1;
    for (let i = 1; i + 1 < tiled.stations.length - 1; i += 1) {
      const probe = tied.daylight.map((p) => ({ ...p }));
      probe[i] = { ...tied.source[i]! };
      probe[i + 1] = { ...tied.source[i + 1]! };
      if (countPositiveWidthRegions(tied.source, probe) === 2) {
        tieIdx = i;
        break;
      }
    }
    expect(tieIdx).toBeGreaterThan(0);
    tied.daylight[tieIdx] = { ...tied.source[tieIdx]! };
    tied.daylight[tieIdx + 1] = { ...tied.source[tieIdx + 1]! };
    expect(countPositiveWidthRegions(tied.source, tied.daylight)).toBe(2);
    expect(() => meshSparseGroup(tied, preMeshOf(geometry))).toThrow(/pre-mesh vs measured topology mismatch/);
  });

  it('touch / overlap never reach a certificate (no expectation, no mesh)', () => {
    for (const key of ['touchSparse', 'overlapAdjacent', 'touchAdjacent'] as const) {
      const geometry = build(FIXTURES[key]);
      const pre = deriveSparsePreMeshExpectation(geometry);
      expect(pre.ok).toBe(false);
      if (!pre.ok) expect(['TOUCHING_NOT_AUTHORIZED', 'OVERLAP_REJECTED']).toContain(pre.code);
    }
  });

  it('production plural authorities still REJECT sparse sets today (fail closed)', () => {
    const geometry = build(FIXTURES.sparse2);
    const intents = geometry.transitions.map((t) => t.intent);
    expect(selectGroupTransitions(intents)).toMatchObject({ kind: 'rejected', code: 'TRANSITION_REJECTED' });
    const intentsForExpectation = geometry.transitions.map((t) => ({
      jointId: t.intent.jointId,
      width: t.width,
      memberLengths: [geometry.members[t.memberL]!.length, geometry.members[t.memberR]!.length] as [number, number],
      transitionCount: 1,
      isOpen: true,
    }));
    const derived = deriveTransitionExpectation({ scope: 'group', closed: false, positiveWidthRegions: 1 }, intentsForExpectation);
    expect(derived.ok).toBe(false);
    if (!derived.ok) expect(derived.code).toBe('GRADING_AGREEMENT_TRANSITION_MALFORMED');
    expect(deriveGroupTransitionExpectation(intentsForExpectation)).toMatchObject({ ok: false, code: 'TRANSITION_MALFORMED' });
    // Consecutive control still declares 1/1/1 unchanged.
    const mixed = build(FIXTURES.mixed2);
    const consecutive = mixed.transitions.slice(0, 2).map((t) => ({
      jointId: t.intent.jointId,
      width: t.width,
      memberLengths: [mixed.members[t.memberL]!.length, mixed.members[t.memberR]!.length] as [number, number],
      transitionCount: 1,
      isOpen: true,
    }));
    const control = deriveTransitionExpectation({ scope: 'group', closed: false, positiveWidthRegions: 1 }, consecutive);
    expect(control.ok).toBe(true);
    if (control.ok) expect(control.expectation.expectedFaceComponents).toBe(1);
  });
});

/* ── C. Worker ──────────────────────────────────────────────────────────── */

describe('20P-C worker: per-transition agreement + legs across sparse gaps', () => {
  it('resolves sparse member views and admits every plan per-transition', () => {
    const geometry = build(FIXTURES.sparse2);
    const rev = 'ggrev1:sparse2';
    const plans = sparsePlans(geometry, rev);
    const views = resolveGroupTransitionMemberViews(sparseWorkerRequest(geometry, plans));
    expect(views?.length).toBe(2);
    expect(views?.map((pair) => pair.map((v) => v.memberId))).toEqual([
      [geometry.members[0]!.id, geometry.members[1]!.id],
      [geometry.members[2]!.id, geometry.members[3]!.id],
    ]);
    plans.forEach((plan, i) => {
      expect(checkGroupTransitionAgreement(plan, views![i]!, rev)).toMatchObject({ ok: true });
    });
    expect(transitionPlansOf(sparseWorkerRequest(geometry, plans))?.map((p) => p.jointId)).toEqual(['joint:0', 'joint:2']);
  });

  it('validates each result-owned leg and the whole sparse legs set', () => {
    const geometry = build(FIXTURES.sparse2);
    const rev = 'ggrev1:sparse2';
    const plans = sparsePlans(geometry, rev);
    const views = resolveGroupTransitionMemberViews(sparseWorkerRequest(geometry, plans))!;
    const legs = sparseLegs(geometry, rev);
    const tiled = tileSparseGroup(geometry);
    for (let i = 0; i < plans.length; i += 1) {
      const reject = validateTransitionResultMesh({
        family: geometry.family,
        sL: legs[i]!.interval.sL,
        sR: legs[i]!.interval.sR,
        vL: legs[i]!.endpointScalars.vL,
        vR: legs[i]!.endpointScalars.vR,
        daylightCheckpoints: legs[i]!.daylightCheckpoints,
        sourceCheckpoints: legs[i]!.sourceCheckpoints,
        criterionL: views[i]![0]!.criterion,
        criterionR: views[i]![1]!.criterion,
        jointZ: geometry.jointZ,
        maxSearchDistance: 50,
        daylightPoints: flatPoints(tiled.daylight),
        sourceBoundaryPoints: flatPoints(tiled.source),
        side: geometry.side,
      });
      expect(reject).toBeNull();
    }
    expect(
      validateGroupTransitionLegsMesh({
        plans,
        legs,
        views,
        jointZs: plans.map((p) => p.jointZ),
        liveRevision: rev,
        maxSearchDistance: 50,
        daylightPoints: flatPoints(tiled.daylight),
        sourceBoundaryPoints: flatPoints(tiled.source),
        side: geometry.side,
      }),
    ).toBeNull();
  });

  it('one stale/malformed transition or leg rejects the whole sparse set', () => {
    const geometry = build(FIXTURES.sparse2);
    const rev = 'ggrev1:sparse2';
    const plans = sparsePlans(geometry, rev);
    const views = resolveGroupTransitionMemberViews(sparseWorkerRequest(geometry, plans))!;
    const legs = sparseLegs(geometry, rev);
    const tiled = tileSparseGroup(geometry);
    const base = {
      views,
      jointZs: plans.map((p) => p.jointZ),
      liveRevision: rev,
      maxSearchDistance: 50,
      daylightPoints: flatPoints(tiled.daylight),
      sourceBoundaryPoints: flatPoints(tiled.source),
      side: geometry.side as 'left',
    };
    // Tampered second leg checkpoint.
    const tampered = legs.map((leg) => ({ ...leg, daylightCheckpoints: [...leg.daylightCheckpoints] }));
    tampered[1]!.daylightCheckpoints[4]! += 0.5;
    expect(validateGroupTransitionLegsMesh({ plans, legs: tampered, ...base })).toBe('GRADING_AGREEMENT_TRANSITION_OFF_LAW');
    // Stale recorded revision on the second plan.
    const stale = plans.map((p) => ({ ...p }));
    stale[1] = { ...stale[1]!, recordedRevision: 'ggrev1:other' };
    expect(validateGroupTransitionLegsMesh({ plans: stale, legs, ...base })).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
    // Missing leg (length mismatch) fails closed.
    expect(validateGroupTransitionLegsMesh({ plans, legs: [legs[0]!], ...base })).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
    // Reversed legs (positional swap across the gap) fail closed.
    expect(validateGroupTransitionLegsMesh({ plans, legs: [...legs].reverse(), ...base })).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
  });

  it('skipped native joints own no checkpoints and no leg', () => {
    const geometry = build(FIXTURES.mixed2); // transitions [0,1,3]; joint 2 skipped
    expect(geometry.skippedJoints).toEqual([2]);
    const legs = sparseLegs(geometry, 'ggrev1:mixed2');
    expect(legs.length).toBe(geometry.transitions.length);
    expect(legs.map((leg) => leg.joint)).toEqual([0, 1, 3]);
    expect(legs.some((leg) => leg.joint === 2)).toBe(false);
  });

  it('production group pre-solve gate still fails closed on sparse plans', () => {
    const geometry = build(FIXTURES.sparse2);
    const rev = 'ggrev1:sparse2';
    const plans = sparsePlans(geometry, rev);
    const views = resolveGroupTransitionMemberViews(sparseWorkerRequest(geometry, plans))!;
    const out = checkGroupTransitionPlansAgreement({ plans, views, liveRevision: rev });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe('GRADING_AGREEMENT_TRANSITION_MALFORMED');
  });

  it('dual transition/transitions fields stay malformed, never merged', () => {
    const geometry = build(FIXTURES.sparse2);
    const plans = sparsePlans(geometry, 'ggrev1:sparse2');
    const request = sparseWorkerRequest(geometry, plans);
    expect(transitionPlansOf({ ...request, transition: plans[0]! })).toBeNull();
    expect(transitionPlansOf({ ...request, transitions: undefined, transition: plans[0]! })?.map((p) => p.jointId)).toEqual(['joint:0']);
  });
});

/* ── D. Provenance / revision ───────────────────────────────────────────── */

describe('20P-D provenance/revision: order-sensitive, positional, persistence-exact', () => {
  it('ggrev1 is deterministic and order-sensitive (no silent sort)', () => {
    const geometry = build(FIXTURES.sparse2);
    const input = revisionInput(geometry);
    const pin = buildGroupRevision(input);
    expect(pin).toBe(buildGroupRevision(revisionInput(geometry)));
    expect(pin.startsWith('ggrev1:')).toBe(true);
    // Reversed transition order is a different persisted order -> different hash.
    const reversed = buildGroupRevision(revisionInput(geometry, [...geometry.transitions.map((t) => t.intent)].reverse()));
    expect(reversed).not.toBe(pin);
    // Dropping the sparse second transition changes the hash.
    const dropped = buildGroupRevision(revisionInput(geometry, [geometry.transitions[0]!.intent]));
    expect(dropped).not.toBe(pin);
  });

  it('citations: one per intent, only the sparse joints, none for skipped joints', () => {
    const geometry = build(FIXTURES.mixed2);
    const rev = 'ggrev1:mixed2';
    const legs = sparseLegs(geometry, rev);
    const citations = transitionResultBakeCitations(legs);
    expect(citations?.length).toBe(geometry.transitions.length);
    expect(citations?.map((c) => c.jointId)).toEqual(['joint:0', 'joint:1', 'joint:3']);
    expect(citations?.some((c) => c.joint === 2)).toBe(false);
    expect(transitionResultBakeCitations([])).toBeUndefined();
    expect(transitionResultBakeCitations(undefined)).toBeUndefined();
  });

  it('transitionEvidenceMatchesIntent accepts clean intents and rejects a mismatched provenance', () => {
    const geometry = build(FIXTURES.sparse2);
    const rev = 'ggrev1:sparse2';
    for (const t of geometry.transitions) {
      expect(transitionEvidenceMatchesIntent(t.intent, rev)).toBe(true);
      const provenance: CadGradingTransitionProvenance = {
        jointId: t.intent.jointId,
        memberIds: [t.intent.memberIds[0]!, t.intent.memberIds[1]!],
        width: t.width,
        lawKind: t.intent.lawKind,
        lawVersion: t.intent.lawVersion,
        criterionFamily: geometry.family,
        side: geometry.side,
        revision: rev,
      };
      expect(transitionEvidenceMatchesIntent({ ...t.intent, provenance }, rev)).toBe(true);
      expect(transitionEvidenceMatchesIntent({ ...t.intent, provenance: { ...provenance, width: t.width + 1 } }, rev)).toBe(false);
      expect(transitionEvidenceMatchesIntent({ ...t.intent, provenance: { ...provenance, revision: 'ggrev1:other' } }, rev)).toBe(false);
      const built = buildTransitionProvenance({
        intent: t.intent,
        joint: t.joint,
        memberIds: [t.intent.memberIds[0]!, t.intent.memberIds[1]!],
        family: geometry.family,
        endpointScalars: { vL: t.vL, vR: t.vR, gL: geometry.grade, gR: geometry.grade },
        interval: { sL: t.sL, sR: t.sR },
        jointStation: t.station,
        recordedRevision: rev,
        agreementCode: null,
      });
      expect(built).toMatchObject({ joint: t.joint, jointId: t.intent.jointId, widthMeters: t.width });
    }
  });

  it('one missing/mismatched leg blocks the product gates', () => {
    const geometry = build(FIXTURES.sparse2);
    const rev = 'ggrev1:sparse2';
    const plans = sparsePlans(geometry, rev);
    const views = resolveGroupTransitionMemberViews(sparseWorkerRequest(geometry, plans))!;
    const legs = sparseLegs(geometry, rev);
    const tiled = tileSparseGroup(geometry);
    const forged = legs.map((leg, i) => (i === 1 ? { ...leg, width: leg.width + 2 } : leg));
    const reject = validateGroupTransitionLegsMesh({
      plans,
      legs: forged,
      views,
      jointZs: plans.map((p) => p.jointZ),
      liveRevision: rev,
      maxSearchDistance: 50,
      daylightPoints: flatPoints(tiled.daylight),
      sourceBoundaryPoints: flatPoints(tiled.source),
      side: geometry.side,
    });
    expect(reject).toBe('GRADING_AGREEMENT_TRANSITION_STALE');
    const base = {
      extract: { available: true, code: null, notice: null },
      bake: { available: true, code: null, notice: null },
      designPatch: { available: false, code: 'X', notice: 'x' },
    };
    const gated = applyTransitionProductGate(base, { failed: reject !== null, stale: false, closed: false });
    expect(gated.extract.available).toBe(false);
    expect(gated.bake.available).toBe(false);
  });

  it('persistence roundtrip keeps sparse ids/order and full width precision', () => {
    const geometry = build(FIXTURES.sparse2);
    const intents = geometry.transitions.map((t) => t.intent);
    const roundtrip = JSON.parse(JSON.stringify(intents)) as typeof intents;
    expect(roundtrip.map((t) => t.jointId)).toEqual(['joint:0', 'joint:2']);
    expect(roundtrip.map((t) => t.memberIds)).toEqual(intents.map((t) => t.memberIds));
    expect(buildGroupRevision(revisionInput(geometry, roundtrip))).toBe(buildGroupRevision(revisionInput(geometry, intents)));
    // Full-precision width editing always invalidates `ggrev1`.
    const precise = [
      { ...intents[0]!, width: 8.0000000001 },
      intents[1]!,
    ];
    expect(buildGroupRevision(revisionInput(geometry, precise))).not.toBe(buildGroupRevision(revisionInput(geometry, intents)));
    const roundtripPrecise = JSON.parse(JSON.stringify(precise)) as typeof precise;
    expect(roundtripPrecise[0]!.width).toBe(8.0000000001);
  });

  it('member ids are real courseCriterionKey values for the fixture chain', () => {
    const geometry = build(FIXTURES.sparse2);
    expect(geometry.members.map((m) => m.id)).toEqual([
      courseCriterionKey('S0', 'S1'),
      courseCriterionKey('S1', 'S2'),
      courseCriterionKey('S2', 'S3'),
      courseCriterionKey('S3', 'S4'),
    ]);
    expect(geometry.transitions.map((t) => t.intent.memberIds)).toEqual([
      [courseCriterionKey('S0', 'S1'), courseCriterionKey('S1', 'S2')],
      [courseCriterionKey('S2', 'S3'), courseCriterionKey('S3', 'S4')],
    ]);
  });
});
