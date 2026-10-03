/**
 * Phase 20L.2 — exact-offset group builder tests (production module only).
 *
 * Covers the 10 open curved study routes (line→arc / arc→line ×
 * Distance/Relative/flat-Elevation two-member; line→arc→line × 3 families;
 * same-d same-Z mixed-analytic): exact attempt, Roff law, join-vs-study-
 * oracle coords (docs/evidence/phase20l1/group-corpus.json literals —
 * src never imports scripts/), shared-J, finite XYZ, daylight-on-support,
 * E1 extent, continuity, topology + gtop2 revalidation, determinism, no
 * CURVE_CORNER_APPROXIMATED, sagitta<=tol on both arcs, and
 * tolerance-change J-invariance. No dispatcher wiring is exercised here.
 */
import { describe, expect, it } from 'vitest';

import { featureLineArcSubdivisions } from '../src/engine/cad/cadSurfaceRevision';
import { extentJVWithin } from '../src/engine/cad/grading/gradingExactOffsetGeometry';
import { tryExactOffsetGroup } from '../src/engine/cad/grading/gradingGroupExactOffset';
import type { ExactOffsetGroupInput } from '../src/engine/cad/grading/gradingGroupExactOffset.types';
import { gradingTopologyCertificateExactError } from '../src/engine/cad/grading/gradingTopologyCertificate';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from '../src/engine/cad/grading/gradingTypes';

const DIST: GradingCriterion = { kind: 'distance', gradeRatio: 1, distance: 5 };
const RELEL: GradingCriterion = { kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 };
const EFLAT: GradingCriterion = { kind: 'elevation', gradeRatio: 1, targetElevation: 5 };
const MS = 100;
const TOL = 0.01;
const TAU = Math.PI * 2;
const SIDE: GradingSide = 'left';

// Study-oracle joins (docs/evidence/phase20l1/group-corpus.json, r9).
const J_A1 = { x: -4.772255751, y: 5 };
const J_A2 = { x: -5, y: 4.772255751 };
const J_B1 = { x: 45, y: 54.772255751 };

interface Node { x: number; y: number }
interface Spec { p0: Node; p1: Node; z0: number; z1: number; arc?: { cx: number; cy: number; ccw: boolean } }

const N = (x: number, y: number): Node => ({ x, y });

const toSource = (s: Spec): ResolvedGradingSource => {
  if (!s.arc) {
    return {
      startX: s.p0.x, startY: s.p0.y, endX: s.p1.x, endY: s.p1.y,
      startZ: s.z0, endZ: s.z1, length: Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y),
      reoriented: false, isArc: false,
    };
  }
  const radius = Math.hypot(s.p0.x - s.arc.cx, s.p0.y - s.arc.cy);
  const a0 = Math.atan2(s.p0.y - s.arc.cy, s.p0.x - s.arc.cx);
  let a1 = Math.atan2(s.p1.y - s.arc.cy, s.p1.x - s.arc.cx);
  if (s.arc.ccw) { while (a1 <= a0) a1 += 2 * Math.PI; } else { while (a1 >= a0) a1 -= 2 * Math.PI; }
  return {
    startX: s.p0.x, startY: s.p0.y, endX: s.p1.x, endY: s.p1.y,
    startZ: s.z0, endZ: s.z1, length: radius * Math.abs(a1 - a0),
    reoriented: false, isArc: true,
    arc: { centerX: s.arc.cx, centerY: s.arc.cy, radius, startAngle: a0, endAngle: a1, sweepCCW: s.arc.ccw },
  };
};

const line = (p0: Node, p1: Node): Spec => ({ p0, p1, z0: 0, z1: 0 });
const arc = (p0: Node, p1: Node, cx: number, cy: number, ccw: boolean): Spec =>
  ({ p0, p1, z0: 0, z1: 0, arc: { cx, cy, ccw } });

// Study shapes: A1 line→arc, A2 arc→line, B line→arc→line (all side left).
const A1: Spec[] = [line(N(-40, 0), N(0, 0)), arc(N(0, 0), N(50, 50), 50, 0, false)];
const A2: Spec[] = [arc(N(-50, -50), N(0, 0), 0, -50, false), line(N(0, 0), N(0, 40))];
const B: Spec[] = [...A1, line(N(50, 50), N(50, 90))];

const buildInput = (
  specs: Spec[],
  criterion: GradingCriterion,
  memberCriteria?: GradingCriterion[],
  tol = TOL,
): ExactOffsetGroupInput => ({
  groupId: 'test-exact',
  revision: 'test-rev/1',
  members: specs.map(toSource),
  side: SIDE,
  criterion,
  ...(memberCriteria ? { memberCriteria } : {}),
  maxSearchDistance: MS,
  curveChordTolerance: tol,
});

const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;

interface RouteCase {
  id: string;
  specs: Spec[];
  criterion: GradingCriterion;
  memberCriteria?: GradingCriterion[];
  joins: Array<{ x: number; y: number }>;
}

// The 10 open curved study routes.
const ROUTES: RouteCase[] = [
  { id: 'A1-DIST', specs: A1, criterion: DIST, joins: [J_A1] },
  { id: 'A1-RELEL', specs: A1, criterion: RELEL, joins: [J_A1] },
  { id: 'A1-EFLAT', specs: A1, criterion: EFLAT, joins: [J_A1] },
  { id: 'A2-DIST', specs: A2, criterion: DIST, joins: [J_A2] },
  { id: 'A2-RELEL', specs: A2, criterion: RELEL, joins: [J_A2] },
  { id: 'A2-EFLAT', specs: A2, criterion: EFLAT, joins: [J_A2] },
  { id: 'B-DIST', specs: B, criterion: DIST, joins: [J_A1, J_B1] },
  { id: 'B-RELEL', specs: B, criterion: RELEL, joins: [J_A1, J_B1] },
  { id: 'B-EFLAT', specs: B, criterion: EFLAT, joins: [J_A1, J_B1] },
  {
    id: 'H-mixed-sameD-sameZ', specs: B, criterion: DIST,
    memberCriteria: [DIST, { kind: 'relative-elevation', gradeRatio: 1, relativeElevation: 5 }, DIST],
    joins: [J_A1, J_B1],
  },
];

describe('phase20l.2 exact-offset group builder', () => {
  for (const route of ROUTES) {
    it(`${route.id} routes exact with oracle joins and clean result semantics`, () => {
      const out = tryExactOffsetGroup(buildInput(route.specs, route.criterion, route.memberCriteria));
      expect(out.kind).toBe('exact');
      if (out.kind !== 'exact') return;
      expect(out.d).toBe(5);
      const r = out.result;
      // Result semantics: tessellated curved strip, never corner-approximated.
      expect(r.accuracy).toBe('CURVE_APPROXIMATED');
      expect(r.diagnostics).toEqual([]);
      expect(r.curveGeometryMode).toBe('EXACT_OFFSET_RADIUS');
      expect(r.memberCount).toBe(route.specs.length);
      expect(r.cornerCount).toBe(route.joins.length);
      expect(r.memberRegions).toHaveLength(route.specs.length);
      for (const [mi, region] of r.memberRegions.entries()) {
        expect(region.memberIndex).toBe(mi);
        expect(region.classification).toBe('FIXED');
      }
      // Joins match the study oracle; join Z is the agreed limit (5).
      expect(r.corners).toHaveLength(route.joins.length);
      for (const [j, oj] of route.joins.entries()) {
        const c = r.corners[j]!;
        expect(c.diagnostics).toEqual([]);
        expect(c.tiePointXyz).toBeUndefined();
        const J = c.exactOffsetJoinXyz!;
        expect(near(J[0], oj.x)).toBe(true);
        expect(near(J[1], oj.y)).toBe(true);
        expect(J[2]).toBe(5);
        expect(c.daylightPoints).toEqual([J[0], J[1], J[2]]);
        // E1 extent: the join sits within search of its joint V.
        const V = j === 0 ? { x: 0, y: 0 } : { x: 50, y: 50 };
        const distV = Math.hypot(J[0] - V.x, J[1] - V.y);
        expect(near(distV, 6.911904582, 1e-6)).toBe(true);
        expect(extentJVWithin(distV, MS, Math.max(1, Math.abs(V.x), Math.abs(V.y)))).toBe(true);
        // Shared-J continuity: the global daylight run carries J bitwise.
        const flat = r.daylightPoints;
        let found = false;
        for (let k = 0; k + 2 < flat.length; k += 3) {
          if (flat[k] === J[0] && flat[k + 1] === J[1] && flat[k + 2] === J[2]) { found = true; break; }
        }
        expect(found).toBe(true);
      }
      // Finite XYZ everywhere; criterion-d projection stats; unrepurposed counters.
      expect(r.gradingMesh.points.every(Number.isFinite)).toBe(true);
      expect(r.daylightPoints.every(Number.isFinite)).toBe(true);
      expect(r.sourceBoundaryPoints?.every(Number.isFinite)).toBe(true);
      expect(r.minProjectionDistance).toBe(5);
      expect(r.maxProjectionDistance).toBe(5);
      expect(r.meanProjectionDistance).toBe(5);
      expect(r.candidateTriangleCount).toBe(0);
      expect(r.intersectionSegmentCount).toBe(0);
      expect(r.multipleSolutionCount).toBe(0);
      expect(r.cutSourceLength).toBe(0);
      expect(r.fillSourceLength).toBe(0);
      expect(r.tiedSourceLength).toBe(0);
      // Source length authoritative; mesh nonempty with gtop2 certificate.
      const members = route.specs.map(toSource);
      expect(r.sourceLength).toBe(members.reduce((s, m) => s + m.length, 0));
      expect(r.gradingMesh.triangles.length).toBeGreaterThan(0);
      const cert = r.topologyCertificate!;
      expect(cert.version).toBe('gtop2');
      expect(cert.scope).toBe('group');
      expect(cert.expectedComponents).toBe(1);
      expect(cert.expectedBoundaryCycles).toBe(1);
      expect(gradingTopologyCertificateExactError(cert, 'group',
        { points: r.gradingMesh.points, triangles: r.gradingMesh.triangles },
        { sourceBoundaryPoints: r.sourceBoundaryPoints, gradingBoundaryPoints: r.daylightPoints },
      )).toBeNull();
      // Determinism: a second run is byte-identical.
      const again = tryExactOffsetGroup(buildInput(route.specs, route.criterion, route.memberCriteria));
      expect(again).toEqual(out);
    });
  }

  it('daylight rides the exact offset support (Roff 55 circle, 5 m line offsets)', () => {
    const out = tryExactOffsetGroup(buildInput(B, DIST));
    expect(out.kind).toBe('exact');
    if (out.kind !== 'exact') return;
    const flat = out.result.daylightPoints;
    for (let k = 0; k + 2 < flat.length; k += 3) {
      const x = flat[k]!;
      const y = flat[k + 1]!;
      const onArc = near(Math.hypot(x - 50, y - 0), 55);
      const onLine0 = near(y, 5) && x <= 0.000001 + J_A1.x;
      const onLine2 = near(x, 45) && y >= J_B1.y - 0.000001;
      expect(onArc || onLine0 || onLine2).toBe(true);
    }
  });

  it('tessellation follows the sagitta contract on both arcs (stricter count wins)', () => {
    // A1 arc: source R=50 sweep π/2; daylight Roff=55 from J to the open-end
    // offset (which preserves the source end angle π/2), CW traversal.
    const srcSweep = Math.PI / 2;
    const aJ = Math.atan2(J_A1.y - 0, J_A1.x - 50);
    const daySweep = (((aJ - Math.PI / 2) % TAU) + TAU) % TAU;
    const nSrc = featureLineArcSubdivisions(50, srcSweep, TOL);
    const nOff = featureLineArcSubdivisions(55, daySweep, TOL);
    // Either side may bind the contract — the builder takes the stricter.
    const n = Math.max(nSrc, nOff);
    expect(n).toBeGreaterThan(1);
    for (const [R, sweep] of [[50, srcSweep], [55, daySweep]] as const) {
      expect(R * (1 - Math.cos(sweep / (2 * n)))).toBeLessThanOrEqual(TOL);
    }
    // Merged mesh carries exactly the shared-contract vertices: line run (2)
    // plus arc run (n+1) stitched at V, doubled for source + daylight.
    const out = tryExactOffsetGroup(buildInput(A1, DIST));
    expect(out.kind).toBe('exact');
    if (out.kind !== 'exact') return;
    expect(out.result.gradingMesh.points.length / 3).toBe(2 * (n + 2));
  });

  it('tolerance change refines tessellation but leaves J invariant', () => {
    const coarse = tryExactOffsetGroup(buildInput(B, DIST, undefined, 0.01));
    const fine = tryExactOffsetGroup(buildInput(B, DIST, undefined, 0.001));
    expect(coarse.kind).toBe('exact');
    expect(fine.kind).toBe('exact');
    if (coarse.kind !== 'exact' || fine.kind !== 'exact') return;
    expect(coarse.result.corners.map((c) => c.exactOffsetJoinXyz))
      .toEqual(fine.result.corners.map((c) => c.exactOffsetJoinXyz));
    expect(fine.result.gradingMesh.points.length).toBeGreaterThan(coarse.result.gradingMesh.points.length);
  });

  it('sloped source fails closed to fallback (never partial exact)', () => {
    const sloped: Spec[] = [
      { p0: N(-40, 0), p1: N(0, 0), z0: 0, z1: 1 },
      { p0: N(0, 0), p1: N(50, 50), z0: 1, z1: 2, arc: { cx: 50, cy: 0, ccw: false } },
    ];
    const out = tryExactOffsetGroup(buildInput(sloped, DIST));
    expect(out.kind).toBe('fallback');
    if (out.kind === 'fallback') expect(out.reason).toBe('FALLBACK_SLOPED_SOURCE');
  });
});
