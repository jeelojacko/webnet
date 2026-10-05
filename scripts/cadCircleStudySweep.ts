/**
 * B0 study-side sweep experiments B1/B2/B3 through CURRENT kernels unchanged.
 * STUDY-ONLY: imports forensics ground truth, never copies it, persists nothing.
 *
 * B1 = full-circle as (0/360).  B2 = full-circle as (theta/theta+360).
 * B3 = degenerate (theta/theta). Center (100,200) r=50 unless noted.
 */
import {
  cadDistance,
  cadIsAngleOnArcSweep,
  cadPointOnCircle,
  cadSignedSweepDeg,
} from '../src/engine/cad/cadGeometry';
import {
  cadArcMidpoint,
  cadClosestPointOnArc,
} from '../src/engine/cad/cadGeometryArcPrimitives';
import {
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineCircle,
  cadIntersectSegmentCircle,
  cadTangentPointsFromExternalPointToCircle,
} from '../src/engine/cad/cadGeometryCurveIntersections';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import {
  classifyTransform,
  reflectionAboutLine,
  rotationAbout,
  translation,
  uniformScaleAbout,
  type CadTransform2D,
} from '../src/engine/cad/cadTransform2D';
import type { CadArcEntity } from '../src/engine/cad/cadTypes';

export interface CircleCase {
  tag: 'B1' | 'B2' | 'B3';
  startAngleDeg: number;
  endAngleDeg: number;
}
export const STUDY_CENTER = { x: 100, y: 200 };
export const STUDY_RADIUS = 50;
export const STUDY_CASES: CircleCase[] = [
  { tag: 'B1', startAngleDeg: 0, endAngleDeg: 360 },
  { tag: 'B2', startAngleDeg: 30, endAngleDeg: 390 },
  { tag: 'B3', startAngleDeg: 30, endAngleDeg: 30 },
];

const r6 = (n: number): number => (Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : n);
const pt = (p: { x: number; y: number }): { x: number; y: number } => ({ x: r6(p.x), y: r6(p.y) });

/** Endpoints-only bounds path (mirrors cadProjectState arcEndPoints sampling). */
export const endpointsOnlyBounds = (
  cx: number, cy: number, r: number, s: number, e: number,
): { minX: number; minY: number; maxX: number; maxY: number } => {
  const angles = [s, e];
  [0, 90, 180, 270].forEach((q) => {
    if (cadIsAngleOnArcSweep(q, s, e)) angles.push(q);
  });
  const xs = angles.map((a) => cx + Math.cos((a * Math.PI) / 180) * r);
  const ys = angles.map((a) => cy + Math.sin((a * Math.PI) / 180) * r);
  return { minX: r6(Math.min(...xs)), minY: r6(Math.min(...ys)), maxX: r6(Math.max(...xs)), maxY: r6(Math.max(...ys)) };
};

/** Center±radius bounds path (mirrors cadSpatialIndex arcBounds). */
export const centerRadiusBounds = (cx: number, cy: number, r: number) =>
  ({ minX: r6(cx - r), minY: r6(cy - r), maxX: r6(cx + r), maxY: r6(cy + r) });

const arcEntity = (c: CircleCase): CadArcEntity => ({
  id: `study-${c.tag}`, type: 'arc', layerId: 'L0', name: `study ${c.tag}`,
  centerX: STUDY_CENTER.x, centerY: STUDY_CENTER.y, radius: STUDY_RADIUS,
  startAngleDeg: c.startAngleDeg, endAngleDeg: c.endAngleDeg,
  visible: true, locked: false,
} as CadArcEntity);

const applyTransform = (c: CircleCase, t: CadTransform2D): Record<string, unknown> => {
  const cls = classifyTransform(t);
  if (!cls) return { applied: false, reason: 'SINGULAR' };
  const res = transformCadEntityGeometry(arcEntity(c), t, cls);
  if (!res.ok) return { applied: false, reason: (res as { reason: string }).reason };
  const e = (res as { entity: CadArcEntity }).entity;
  return {
    applied: true, kind: cls.kind, centerX: r6(e.centerX), centerY: r6(e.centerY),
    radius: r6(e.radius), startAngleDeg: r6(e.startAngleDeg), endAngleDeg: r6(e.endAngleDeg),
    sweepDeg: r6(cadSignedSweepDeg(e.startAngleDeg, e.endAngleDeg)),
  };
};

export interface SweepRecord {
  tag: string; startAngleDeg: number; endAngleDeg: number;
  signedSweepDeg: number; startPoint: { x: number; y: number }; endPoint: { x: number; y: number };
  midpoint: { x: number; y: number };
  onSweepQuadrants: Record<string, boolean>;
  boundsEndpointsOnly: unknown; boundsCenterRadius: unknown; boundsAgree: boolean;
  closestFromOutside: { x: number; y: number }; closestFromCenter: { x: number; y: number };
  tangentCountOutside: number; tangentCountOnCircle: number; tangentCountInside: number;
  segmentIntersections: number; lineIntersections: number;
  circleCircleSecant: number; circleCircleTangent: number; circleCircleDisjoint: number; circleCircleConcentric: number;
  transforms: Record<string, unknown>;
  properties: { arcLength: number; chordLength: number };
  dxf: { codePath: string; startDeg: number; endDeg: number; note: string };
  svg: { codePath: string; behavior: string };
}

export const runSweepCase = (c: CircleCase): SweepRecord => {
  const { x: cx, y: cy } = STUDY_CENTER;
  const r = STUDY_RADIUS;
  const sweep = cadSignedSweepDeg(c.startAngleDeg, c.endAngleDeg);
  const quad: Record<string, boolean> = {};
  [0, 90, 180, 270, 45].forEach((a) => { quad[`q${a}`] = cadIsAngleOnArcSweep(a, c.startAngleDeg, c.endAngleDeg); });
  const bEnd = endpointsOnlyBounds(cx, cy, r, c.startAngleDeg, c.endAngleDeg);
  const bRad = centerRadiusBounds(cx, cy, r);
  const outside = { x: cx + r + 40, y: cy };
  const secantOther = { x: cx + 60, y: cy };
  const tangentOther = { x: cx + 2 * r, y: cy };
  const disjointOther = { x: cx + 400, y: cy };
  const start = cadPointOnCircle({ x: cx, y: cy }, r, c.startAngleDeg);
  const end = cadPointOnCircle({ x: cx, y: cy }, r, c.endAngleDeg);
  return {
    tag: c.tag, startAngleDeg: c.startAngleDeg, endAngleDeg: c.endAngleDeg, signedSweepDeg: r6(sweep),
    startPoint: pt(start), endPoint: pt(end),
    midpoint: pt(cadArcMidpoint({ x: cx, y: cy }, r, c.startAngleDeg, c.endAngleDeg)),
    onSweepQuadrants: quad, boundsEndpointsOnly: bEnd, boundsCenterRadius: bRad,
    boundsAgree: JSON.stringify(bEnd) === JSON.stringify(bRad),
    closestFromOutside: pt(cadClosestPointOnArc(outside, { x: cx, y: cy }, r, c.startAngleDeg, c.endAngleDeg)),
    closestFromCenter: pt(cadClosestPointOnArc({ x: cx, y: cy }, { x: cx, y: cy }, r, c.startAngleDeg, c.endAngleDeg)),
    tangentCountOutside: cadTangentPointsFromExternalPointToCircle(outside, { x: cx, y: cy }, r).length,
    tangentCountOnCircle: cadTangentPointsFromExternalPointToCircle({ x: cx + r, y: cy }, { x: cx, y: cy }, r).length,
    tangentCountInside: cadTangentPointsFromExternalPointToCircle({ x: cx + 5, y: cy }, { x: cx, y: cy }, r).length,
    segmentIntersections: cadIntersectSegmentCircle({ x: cx - 200, y: cy }, { x: cx + 200, y: cy }, { x: cx, y: cy }, r).length,
    lineIntersections: cadIntersectInfiniteLineCircle({ x: cx - 200, y: cy }, { x: cx + 200, y: cy }, { x: cx, y: cy }, r).length,
    circleCircleSecant: cadIntersectCircleCircle({ x: cx, y: cy }, r, secantOther, r).length,
    circleCircleTangent: cadIntersectCircleCircle({ x: cx, y: cy }, r, tangentOther, r).length,
    circleCircleDisjoint: cadIntersectCircleCircle({ x: cx, y: cy }, r, disjointOther, r).length,
    circleCircleConcentric: cadIntersectCircleCircle({ x: cx, y: cy }, r, { x: cx, y: cy }, r - 10).length,
    transforms: {
      translate: applyTransform(c, translation(10, -7)),
      rotate90: applyTransform(c, rotationAbout(cx, cy, 90)),
      mirror: applyTransform(c, reflectionAboutLine({ x: 0, y: 0 }, { x: 0, y: 1 }) ?? { a: -1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }),
      uniformScale2: applyTransform(c, uniformScaleAbout(cx, cy, 2)),
      nonUniform: applyTransform(c, { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 }),
    },
    properties: {
      arcLength: r6((Math.abs(sweep) * Math.PI * r) / 180),
      chordLength: r6(cadDistance(start, end)),
    },
    dxf: {
      codePath: 'dxfExportModel.ts:442-460 (model.arcs.push verbatim) -> dxfSerializer.ts ARC emitter (groups 50/51 verbatim)',
      startDeg: c.startAngleDeg, endDeg: c.endAngleDeg,
      note: 'No CIRCLE entity exists: model.circles absent (grep-proven). 390 passes through unwritten-normalized; host CAD normalization on import is an UNEXECUTED prediction (no host available; see execution.dxfArcB1).',
    },
    svg: {
      codePath: 'SurveyCadPreview.geometry.ts:242-249 arcPathFromPrimitive',
      behavior: '|sweep|~=360 collapses to two 180deg A segments; B3 sweep 0 renders as empty/degenerate path.',
    },
  };
};

export const runSweepStudy = (): SweepRecord[] => STUDY_CASES.map(runSweepCase);

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(runSweepStudy(), null, 2));
}
