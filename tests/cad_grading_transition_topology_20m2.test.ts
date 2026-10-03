/**
 * Phase 20M.2 WAVE E — transition-aware PRE-MESH group expectation.
 *
 * An admitted open transition declares the group-scoped open-strip shape
 * (1 component / 1 boundary cycle / 1 positive-width run) via
 * `deriveTransitionExpectation`; `buildGradingTopologyCertificateExact`
 * (gtop2) is reused unchanged. Invalid width fails pre-mesh, a
 * non-manifold injection fails certification, and stale/missing/mismatch
 * certificates fail closed. Legacy groups without transition intent derive
 * the legacy expectation byte-identically.
 */
import { describe, expect, it } from 'vitest';

import {
  buildGradingTopologyCertificateExact,
  gradingTopologyCertificateProductionError,
} from '../src/engine/cad/grading/gradingTopologyCertificate';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import {
  deriveGradingTopologyExpectation,
  deriveTransitionExpectation,
  type TransitionExpectationIntent,
} from '../src/engine/cad/grading/gradingTopologyExpectation';

const intent = (o?: Partial<TransitionExpectationIntent>): TransitionExpectationIntent => ({
  jointId: 'joint:1',
  width: 8,
  memberLengths: [20, 20],
  transitionCount: 1,
  isOpen: true,
  ...o,
});

/** 10 m x 2 m open quad strip: 1 component / 1 boundary cycle. */
const strip = { points: [0, 0, 0, 10, 0, 0, 10, 2, 0, 0, 2, 0], triangles: [0, 1, 2, 0, 2, 3] };
const boundaries = {
  sourceBoundaryPoints: [0, 0, 0, 10, 0, 0],
  gradingBoundaryPoints: [0, 2, 0, 10, 2, 0],
};

describe('20M.2 WAVE E transition topology expectation', () => {
  it('declares 1 component / 1 cycle / 1 run for an admitted open transition', () => {
    const out = deriveTransitionExpectation({ scope: 'group', closed: false, positiveWidthRegions: 0 }, intent());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.expectation).toMatchObject({
      scope: 'group',
      shape: 'open-strip',
      expectedFaceComponents: 1,
      expectedBoundaryCycles: 1,
      positiveWidthRegionCount: 1,
      closed: false,
    });
  });

  it('certifies the declared transition strip green under unchanged gtop2', () => {
    const out = deriveTransitionExpectation({ scope: 'group', closed: false, positiveWidthRegions: 0 }, intent());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const cert = buildGradingTopologyCertificateExact({
      scope: 'group',
      points: strip.points,
      triangles: strip.triangles,
      expectation: out.expectation,
      ...boundaries,
    });
    expect(cert).not.toBeNull();
    expect(gradingTopologyCertificateProductionError(cert ?? undefined, 'group', strip, boundaries)).toBeNull();
  });

  it('fails invalid width pre-mesh (non-positive and infeasible)', () => {
    const zero = deriveTransitionExpectation({ scope: 'group', closed: false, positiveWidthRegions: 0 }, intent({ width: 0 }));
    expect(zero.ok).toBe(false);
    if (zero.ok) return;
    expect(zero.code).toBe('GRADING_AGREEMENT_TRANSITION_MALFORMED');
    const wide = deriveTransitionExpectation({ scope: 'group', closed: false, positiveWidthRegions: 0 }, intent({ width: 41 }));
    expect(wide.ok).toBe(false);
    if (wide.ok) return;
    expect(wide.code).toBe('GRADING_AGREEMENT_TRANSITION_WIDE');
  });

  it('rejects a non-manifold injection against the declared expectation', () => {
    const out = deriveTransitionExpectation({ scope: 'group', closed: false, positiveWidthRegions: 0 }, intent());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Foldover: second quad reuses the strip interior with flipped winding.
    const cert = buildGradingTopologyCertificateExact({
      scope: 'group',
      points: strip.points,
      triangles: [...strip.triangles, 0, 2, 1],
      expectation: out.expectation,
      ...boundaries,
    });
    expect(cert).toBeNull();
  });

  it('fails stale/missing/mismatch certificates closed', () => {
    const out = deriveTransitionExpectation({ scope: 'group', closed: false, positiveWidthRegions: 0 }, intent());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    // Missing certificate on a nonempty mesh never passes production.
    expect(gradingTopologyCertificateProductionError(undefined, 'group', strip, boundaries)).not.toBeNull();
    // Mismatched scope: a standalone certificate does not certify a group mesh.
    const standalone = buildGradingTopologyCertificateExact({
      scope: 'standalone',
      points: strip.points,
      triangles: strip.triangles,
      expectation: { ...out.expectation, scope: 'standalone' },
      ...boundaries,
    });
    expect(standalone).not.toBeNull();
    expect(gradingTopologyCertificateProductionError(standalone ?? undefined, 'group', strip, boundaries)).not.toBeNull();
    // Stale geometry: the certificate was built for another mesh.
    const moved = { points: [5, 0, 0, 15, 0, 0, 15, 2, 0, 5, 2, 0], triangles: strip.triangles };
    const cert = buildGradingTopologyCertificateExact({
      scope: 'group',
      points: strip.points,
      triangles: strip.triangles,
      expectation: out.expectation,
      ...boundaries,
    });
    expect(cert).not.toBeNull();
    expect(gradingTopologyCertificateProductionError(cert ?? undefined, 'group', moved, boundaries)).not.toBeNull();
  });

  it('rejects a second transition object under trp1', () => {
    const out = deriveTransitionExpectation({ scope: 'group', closed: false, positiveWidthRegions: 0 }, intent({ transitionCount: 2 }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('GRADING_AGREEMENT_TRANSITION_OVERLAP');
  });

  it('leaves legacy groups without transition intent byte-identical', () => {
    const base = { scope: 'group' as const, closed: false, positiveWidthRegions: 2 };
    for (const absent of [undefined, null] as const) {
      const out = deriveTransitionExpectation(base, absent);
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      expect(out.expectation).toEqual(deriveGradingTopologyExpectation(base));
    }
  });

  it('certifies the PRODUCTION transition mesh (wired 1/1/1, not only the synthetic quad)', () => {
    // Real collinear 2-member distance group solved through the production
    // kernel with an admitted transition: the pre-mesh declaration must be
    // the group-scoped 1/1/1 expectation and the emitted gtop2 certificate
    // must certify the production mesh green.
    const seg = (sx: number, sy: number, ex: number, ey: number): ResolvedGradingSource => ({
      startX: sx, startY: sy, endX: ex, endY: ey, startZ: 10, endZ: 10,
      length: Math.hypot(ex - sx, ey - sy), reoriented: false, isArc: false,
    });
    const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
    const outcome = computeGradingGroupFromSnapshots({
      groupId: 'g',
      revision: 'ggrev1:topo',
      members: [seg(-20, 0, 0, 0), seg(0, 0, 20, 0)],
      side: 'left',
      criterion: DIST(0.5, 5),
      memberCriteria: [DIST(0.5, 5), DIST(0.5, 7)],
      maxSearchDistance: 50,
      curveChordTolerance: 0.01,
      closed: false,
      transition: {
        policyVersion: 'trp1',
        jointId: 'joint:0',
        memberIds: ['A>B', 'B>C'],
        width: 8,
        lawKind: 'TRANSITION_LINEAR_V1',
        lawVersion: 'v1',
        criterionFamily: 'distance',
        side: 'left',
      },
      transitionMemberKeys: ['A>B', 'B>C'],
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const cert = outcome.result.topologyCertificate;
    expect(cert).toBeDefined();
    expect(cert).toMatchObject({
      scope: 'group',
      components: 1,
      boundaryCycles: 1,
      positiveWidthRegionCount: 1,
    });
    expect(gradingTopologyCertificateProductionError(cert, 'group', outcome.result.gradingMesh, {
      sourceBoundaryPoints: outcome.result.sourceBoundaryPoints,
      gradingBoundaryPoints: outcome.result.daylightPoints,
    })).toBeNull();
    expect(outcome.result.transition).toMatchObject({ joint: 0, agreementCode: null });
  });
});
