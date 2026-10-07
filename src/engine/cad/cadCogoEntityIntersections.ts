import {
  cadIntersectArcArc,
  cadIntersectSegmentArc,
  cadSegmentIntersection,
  type CadWorldPoint,
} from './cadGeometry';
import type {
  CadArcEntity,
  CadEntity,
  CadLineEntity,
  CadPolylineEntity,
} from './cadTypes';
import { resolveCadPolylineCourses } from './cadPolylineCourses';

interface CadSegmentRef {
  start: CadWorldPoint;
  end: CadWorldPoint;
  label: string;
}

interface CadCurveRef extends CadSegmentRef {
  kind: 'line' | 'arc';
  /** Arc only. */
  center?: CadWorldPoint;
  radius?: number;
  startAngleDeg?: number;
  endAngleDeg?: number;
}

export interface CadEntityIntersection {
  point: CadWorldPoint;
  label: string;
}

const lineEntityCurves = (entity: CadLineEntity): CadCurveRef[] => [
  {
    kind: 'line',
    start: { x: entity.fromX, y: entity.fromY },
    end: { x: entity.toX, y: entity.toY },
    label: `${entity.fromStationId}-${entity.toStationId}`,
  },
];

/**
 * Phase C2: true course refs honoring the closed last→first edge and arc
 * bulge metadata. Never returns a bulged course as its chord; malformed
 * metadata fails closed (empty) instead of silently straightening.
 */
const polylineEntityCurves = (entity: CadPolylineEntity): CadCurveRef[] => {
  const courses = resolveCadPolylineCourses(entity);
  // Malformed metadata / degenerate ring fails closed (empty), never a
  // silent chord straighten.
  if (!courses) return [];
  return courses.map((course) => {
    const label = `${entity.vertexLabels[course.index] ?? `V${course.index + 1}`}-${entity.vertexLabels[course.index + 1] ?? `V${course.index + 2}`}`;
    if (course.kind === 'arc' && course.metrics != null) {
      return {
        kind: 'arc' as const,
        start: course.from,
        end: course.to,
        label,
        center: course.metrics.center,
        radius: course.metrics.radius,
        startAngleDeg: course.metrics.startAngleDeg,
        endAngleDeg: course.metrics.startAngleDeg + course.metrics.signedSweepDeg,
      };
    }
    return { kind: 'line' as const, start: course.from, end: course.to, label };
  });
};

const lineLikeCurves = (entity: CadLineEntity | CadPolylineEntity): CadCurveRef[] =>
  entity.type === 'line' ? lineEntityCurves(entity) : polylineEntityCurves(entity);

const curveIntersections = (left: CadCurveRef, right: CadCurveRef): CadWorldPoint[] => {
  if (left.kind === 'line' && right.kind === 'line') {
    const point = cadSegmentIntersection(left.start, left.end, right.start, right.end);
    return point ? [point] : [];
  }
  if (left.kind === 'line' && right.kind === 'arc') {
    return cadIntersectSegmentArc(
      left.start,
      left.end,
      right.center!,
      right.radius!,
      right.startAngleDeg!,
      right.endAngleDeg!,
    );
  }
  if (left.kind === 'arc' && right.kind === 'line') {
    return cadIntersectSegmentArc(
      right.start,
      right.end,
      left.center!,
      left.radius!,
      left.startAngleDeg!,
      left.endAngleDeg!,
    );
  }
  return cadIntersectArcArc(
    left.center!,
    left.radius!,
    left.startAngleDeg!,
    left.endAngleDeg!,
    right.center!,
    right.radius!,
    right.startAngleDeg!,
    right.endAngleDeg!,
  );
};

export const isCadLineLikeEntity = (
  entity: CadEntity,
): entity is CadLineEntity | CadPolylineEntity => entity.type === 'line' || entity.type === 'polyline';

export const cadIntersectLineLikeEntities = (
  first: CadLineEntity | CadPolylineEntity,
  second: CadLineEntity | CadPolylineEntity,
): CadEntityIntersection | null => {
  const firstCurves = lineLikeCurves(first);
  const secondCurves = lineLikeCurves(second);

  for (const firstCurve of firstCurves) {
    for (const secondCurve of secondCurves) {
      const points = curveIntersections(firstCurve, secondCurve);
      if (points.length > 0) {
        return {
          point: points[0]!,
          label: `${firstCurve.label} x ${secondCurve.label}`,
        };
      }
    }
  }
  return null;
};

export const cadIntersectLineArcEntity = (
  lineLike: CadLineEntity | CadPolylineEntity,
  arc: CadArcEntity,
): CadEntityIntersection[] =>
  lineLikeCurves(lineLike)
    .flatMap((curve) => {
      const points =
        curve.kind === 'arc'
          ? cadIntersectArcArc(
              curve.center!,
              curve.radius!,
              curve.startAngleDeg!,
              curve.endAngleDeg!,
              { x: arc.centerX, y: arc.centerY },
              arc.radius,
              arc.startAngleDeg,
              arc.endAngleDeg,
            )
          : cadIntersectSegmentArc(
              curve.start,
              curve.end,
              { x: arc.centerX, y: arc.centerY },
              arc.radius,
              arc.startAngleDeg,
              arc.endAngleDeg,
            );
      return points.map((point) => ({
        point,
        label: `${curve.label} x ${arc.id}`,
      }));
    })
    .sort((left, right) => {
      if (Math.abs(left.point.x - right.point.x) > 1e-9) return left.point.x - right.point.x;
      return left.point.y - right.point.y;
    });

export const cadIntersectArcEntities = (
  first: CadArcEntity,
  second: CadArcEntity,
): CadEntityIntersection[] =>
  cadIntersectArcArc(
    { x: first.centerX, y: first.centerY },
    first.radius,
    first.startAngleDeg,
    first.endAngleDeg,
    { x: second.centerX, y: second.centerY },
    second.radius,
    second.startAngleDeg,
    second.endAngleDeg,
  ).map((point) => ({
    point,
    label: `${first.id} x ${second.id}`,
  }));
