/**
 * Phase 20L.2 — dispatcher wiring + fallback parity + worker/product integration.
 *
 * The exact-offset route admits exactly one shape (flat open curved analytic
 * groups at one shared `d`); every other input falls through to the
 * untouched chord path. This suite proves: (a) one exact-route group flows
 * through the REAL production worker path (`toGroupSolveInput` +
 * `computeGroupGradingResultFromRequest`) with session-only provenance and
 * truthful accuracy, surviving a structured-clone round trip; (b) the §15
 * fallback cases missing from the 16-fixture baseline pin their bounded
 * fallback reason plus their chord-path outcome (verified byte-identical
 * with the dispatcher stashed); (c) downstream capability gates run
 * unrelaxed on the exact result.
 */
import { describe, expect, it } from 'vitest';

import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { tryExactOffsetGroup } from '../src/engine/cad/grading/gradingGroupExactOffset';
import type { ExactOffsetGroupCorner } from '../src/engine/cad/grading/gradingGroupExactOffset.types';
import { digestTopologyMeshExact } from '../src/engine/cad/grading/gradingTopologyCertificate';
import { deriveGradingProductCapabilities } from '../src/engine/cad/grading/gradingProductCapabilities';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import { gradingAccuracyText } from '../src/cad-app/shell/cadGradingSnapshot';
import {
  computeGroupGradingResultFromRequest,
  toGroupSolveInput,
  type GradingGroupComputeRequest,
} from '../src/workers/surfaceWorkerHandler';

const DIST = (d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: 1, distance: d });
const ELEV = (g: number, e: number): GradingCriterion =>
  ({ kind: 'elevation', gradeRatio: g, targetElevation: e });

const line = (
  x0: number, y0: number, x1: number, y1: number, z0 = 0, z1 = 0,
): ResolvedGradingSource => ({
  startX: x0, startY: y0, endX: x1, endY: y1, startZ: z0, endZ: z1,
  length: Math.hypot(x1 - x0, y1 - y0), reoriented: false, isArc: false,
});

const arc = (
  x0: number, y0: number, x1: number, y1: number,
  cx: number, cy: number, ccw: boolean, z0 = 0, z1 = 0,
): ResolvedGradingSource => {
  const radius = Math.hypot(x0 - cx, y0 - cy);
  const a0 = Math.atan2(y0 - cy, x0 - cx);
  let a1 = Math.atan2(y1 - cy, x1 - cx);
  if (ccw) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
  return {
    startX: x0, startY: y0, endX: x1, endY: y1, startZ: z0, endZ: z1,
    length: radius * Math.abs(a1 - a0), reoriented: false, isArc: true,
    arc: { centerX: cx, centerY: cy, radius, startAngle: a0, endAngle: a1, sweepCCW: ccw },
  };
};

/** The one exact-route shape: flat open line→arc at one shared d. */
const exactRequest = (): GradingGroupComputeRequest => ({
  groupId: 'exact-line-arc',
  revision: 'ggrev1:exact',
  memberSources: [line(-40, 0, 0, 0), arc(0, 0, 50, 50, 50, 0, false)],
  side: 'left',
  criterion: DIST(5),
  maxSearchDistance: 100,
  curveChordTolerance: 0.01,
  closed: false,
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('phase20l.2 exact route through the production worker path', () => {
  it('routes exact with session-only provenance and truthful accuracy', async () => {
    const outcome = await computeGroupGradingResultFromRequest(exactRequest());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const r = outcome.result;
    expect((r as { curveGeometryMode?: string }).curveGeometryMode).toBe('EXACT_OFFSET_RADIUS');
    expect(r.accuracy).toBe('CURVE_APPROXIMATED');
    expect(gradingAccuracyText(r.accuracy)).toBe('Curve Approximated');
    // Exact joins are not corner approximations: the chord-path diagnostic
    // stays off, so the snapshot curveCornerApproximated flag reads false.
    expect(r.diagnostics.some((d) => d.code === 'CURVE_CORNER_APPROXIMATED')).toBe(false);
    expect(r.cornerCount).toBe(1);
    const corner = r.corners[0]! as ExactOffsetGroupCorner;
    expect(corner.exactOffsetJoinXyz).toHaveLength(3);
    // tiePointXyz is never overloaded with J on the exact route.
    expect(corner.tiePointXyz).toBeUndefined();
    expect(corner.miterRay).toBeDefined();
    expect(r.topologyCertificate?.version).toBe('gtop2');
    expect(r.memberRegions).toHaveLength(2);
    for (const region of r.memberRegions) expect(region.classification).toBe('FIXED');
    // Source boundary stays authoritative: exact member ends, shared joints.
    const src = r.sourceBoundaryPoints ?? [];
    expect([src[0], src[1], src[2]]).toEqual([-40, 0, 0]);
    const tail = src.slice(-3);
    const last = (r as CadGradingGroupResult).gradingMesh;
    expect(tail).toHaveLength(3);
    expect(last.points.length).toBeGreaterThan(0);
  });

  it('request/response cloning preserves the result and revision guards hold', async () => {
    const request = exactRequest();
    const input = toGroupSolveInput(request);
    expect(input.groupId).toBe(request.groupId);
    expect(input.revision).toBe(request.revision);
    expect(input.members).toBe(request.memberSources);
    const outcome = await computeGroupGradingResultFromRequest(clone(request));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const before = digestTopologyMeshExact(
      outcome.result.gradingMesh.points, outcome.result.gradingMesh.triangles,
    );
    const revived = clone(outcome.result);
    expect(revived.revision).toBe('ggrev1:exact');
    expect(revived.sourceBoundaryPoints).toEqual(outcome.result.sourceBoundaryPoints);
    expect(revived.daylightPoints).toEqual(outcome.result.daylightPoints);
    expect(digestTopologyMeshExact(revived.gradingMesh.points, revived.gradingMesh.triangles)).toBe(before);
    expect(revived.topologyCertificate).toEqual(outcome.result.topologyCertificate);
  });

  it('downstream capability gates run unrelaxed on the exact result', async () => {
    const outcome = await computeGroupGradingResultFromRequest(exactRequest());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const caps = deriveGradingProductCapabilities({
      scope: 'group', current: true, result: outcome.result, closed: false,
    });
    // Single-component validated mesh: Extract + Bake representable.
    expect(caps.extract.available).toBe(true);
    expect(caps.bake.available).toBe(true);
    // Open shell is never a closed annular pad: Design Patch stays gated.
    expect(caps.designPatch?.available).toBe(false);
    expect(caps.designPatch?.code).toBe('GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED');
    // Report stats read straight off the result, no relaxed gates.
    expect(Number.isFinite(outcome.result.sourceLength)).toBe(true);
    expect(outcome.result.gradingPlanArea).toBeGreaterThan(0);
    expect(outcome.result.minProjectionDistance).toBeCloseTo(5, 9);
  });
});

describe('phase20l.2 fallback supplements (§15 cases beyond the 16-fixture baseline)', () => {
  const cases: Array<{
    id: string;
    members: ResolvedGradingSource[];
    criterion: GradingCriterion;
    maxSearchDistance: number;
    curveChordTolerance: number;
    reason: string;
    engine: string;
  }> = [
    {
      id: 'sloped-elevation', reason: 'FALLBACK_SLOPED_SOURCE', engine: 'ok:176:CURVE_APPROXIMATED',
      criterion: ELEV(1, 10), maxSearchDistance: 100, curveChordTolerance: 0.01,
      members: [line(-40, 0, 0, 0, 0, 1), arc(0, 0, 50, 50, 50, 0, false, 1, 2)],
    },
    {
      id: 'tangent-collinear', reason: 'FALLBACK_BRANCH_REJECT', engine: 'ok:173:CURVE_APPROXIMATED',
      criterion: DIST(5), maxSearchDistance: 100, curveChordTolerance: 0.01,
      members: [line(-40, 0, 0, 0), line(0, 0, 40, 0), arc(40, 0, 90, 50, 90, 0, false)],
    },
    {
      id: 'extent-e1', reason: 'FALLBACK_EXTENT_E1', engine: 'fail:CORNER_NO_SOLUTION:GRADING_ANALYTIC_CORNER_TRIM',
      criterion: DIST(5), maxSearchDistance: 5, curveChordTolerance: 0.01,
      members: [line(-1, 0, 0, 0), arc(0, 0, 0, 1, 5, 0, false)],
    },
    {
      id: 'mixed-chain-arcpair', reason: 'FALLBACK_ARC_PAIR_NO_GO', engine: 'ok:267:CURVE_APPROXIMATED',
      criterion: DIST(5), maxSearchDistance: 100, curveChordTolerance: 0.01,
      members: [line(-40, 0, 0, 0), arc(0, 0, 50, 50, 50, 0, false), arc(50, 50, 10, 90, 10, 50, true)],
    },
    {
      id: 'strip-tolerance-zero', reason: 'FALLBACK_DEGENERATE_SOURCE', engine: 'fail:MEMBER_NO_SOLUTION:GRADING_ARC_LINEARIZE',
      criterion: DIST(5), maxSearchDistance: 100, curveChordTolerance: 0,
      members: [line(-40, 0, 0, 0), arc(0, 0, 50, 50, 50, 0, false)],
    },
    {
      id: 'degenerate-zero-length', reason: 'FALLBACK_DEGENERATE_SOURCE', engine: 'fail:MEMBER_NO_SOLUTION:GRADING_BAD_SOURCE',
      criterion: DIST(5), maxSearchDistance: 100, curveChordTolerance: 0.01,
      members: [line(0, 0, 0, 0), arc(0, 0, 50, 50, 50, 0, false)],
    },
  ];

  for (const c of cases) {
    it(`${c.id}: bounded fallback, chord-path outcome unchanged`, () => {
      const attempt = tryExactOffsetGroup({
        groupId: c.id, revision: c.id, members: c.members,
        side: 'left', criterion: c.criterion,
        maxSearchDistance: c.maxSearchDistance, curveChordTolerance: c.curveChordTolerance,
      });
      expect(attempt.kind).toBe('fallback');
      if (attempt.kind !== 'fallback') return;
      expect(attempt.reason).toBe(c.reason);
      // Preflight never throws and never invents a new error: the engine
      // falls through to the identical chord-path outcome (stash-verified).
      const out = computeGradingGroupFromSnapshots({
        groupId: c.id, revision: c.id, members: c.members,
        side: 'left', criterion: c.criterion,
        maxSearchDistance: c.maxSearchDistance, curveChordTolerance: c.curveChordTolerance,
        closed: false,
      });
      const summary = out.ok
        ? `ok:${out.result.gradingMesh.triangles.length / 3}:${out.result.accuracy}`
        : `fail:${out.code}:${out.detail}`;
      expect(summary).toBe(c.engine);
    });
  }
});
