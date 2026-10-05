/**
 * B0 study-side first-class circle adapter {cx,cy,r} — analytical CONTROL only.
 * Delegates every curved operation to existing kernels; sweep-independent by
 * construction. NEVER persisted, never imported by src/.
 */
import {
  cadAngleDegFromCenter,
  cadDistance,
  cadPointOnCircle,
  type CadWorldPoint,
} from '../src/engine/cad/cadGeometry';
import {
  cadIntersectCircleCircle,
  cadIntersectInfiniteLineCircle,
  cadIntersectSegmentCircle,
  cadTangentPointsFromExternalPointToCircle,
} from '../src/engine/cad/cadGeometryCurveIntersections';

export interface StudyCircle { cx: number; cy: number; r: number }
export const circle = (cx: number, cy: number, r: number): StudyCircle => ({ cx, cy, r });
const c = (s: StudyCircle): CadWorldPoint => ({ x: s.cx, y: s.cy });

export const pointAt = (s: StudyCircle, angleDeg: number): CadWorldPoint =>
  cadPointOnCircle(c(s), s.r, angleDeg);
export const angleOf = (s: StudyCircle, p: CadWorldPoint): number => cadAngleDegFromCenter(c(s), p);
export const closestTo = (s: StudyCircle, p: CadWorldPoint): CadWorldPoint => {
  const d = cadDistance(c(s), p);
  if (d <= 1e-12) return { x: s.cx + s.r, y: s.cy }; // center projects to +x rim (documented choice)
  return { x: s.cx + ((p.x - s.cx) / d) * s.r, y: s.cy + ((p.y - s.cy) / d) * s.r };
};
export const tangentsFrom = (s: StudyCircle, p: CadWorldPoint): CadWorldPoint[] =>
  cadTangentPointsFromExternalPointToCircle(p, c(s), s.r);
export const intersectSegment = (s: StudyCircle, a: CadWorldPoint, b: CadWorldPoint): CadWorldPoint[] =>
  cadIntersectSegmentCircle(a, b, c(s), s.r);
export const intersectLine = (s: StudyCircle, a: CadWorldPoint, b: CadWorldPoint): CadWorldPoint[] =>
  cadIntersectInfiniteLineCircle(a, b, c(s), s.r);
export const intersectCircle = (s: StudyCircle, o: StudyCircle): CadWorldPoint[] =>
  cadIntersectCircleCircle(c(s), s.r, c(o), o.r);
export const circumference = (s: StudyCircle): number => 2 * Math.PI * s.r;
export const area = (s: StudyCircle): number => Math.PI * s.r * s.r;

export const runAdapterControl = (): Record<string, unknown> => {
  const s = circle(100, 200, 50);
  const outside = { x: 190, y: 200 };
  return {
    pointAt0: pointAt(s, 0), pointAt90: pointAt(s, 90),
    angleOfEast: angleOf(s, { x: 150, y: 200 }),
    closestOutside: closestTo(s, outside), closestCenter: closestTo(s, { x: 100, y: 200 }),
    tangentOutside: tangentsFrom(s, outside).length, tangentInside: tangentsFrom(s, { x: 105, y: 200 }).length,
    segHits: intersectSegment(s, { x: -100, y: 200 }, { x: 300, y: 200 }).length,
    lineHits: intersectLine(s, { x: -100, y: 200 }, { x: 300, y: 200 }).length,
    circleSecant: intersectCircle(s, circle(160, 200, 50)).length,
    circleConcentric: intersectCircle(s, circle(100, 200, 40)).length,
    circumference: Math.round(circumference(s) * 1e6) / 1e6, area: Math.round(area(s) * 1e6) / 1e6,
    sweepIndependent: true, persisted: false,
  };
};
