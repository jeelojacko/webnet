/**
 * Phase 18O — pure dimension geometry resolver.
 *
 * Turns a semantic dimension request into deterministic drawable geometry:
 * extension/dimension segments, arrowhead transforms, readable text placement,
 * and bounds. No Canvas, no DOM, no browser font metrics — text width is the
 * documented estimate `chars * 0.6 * textHeight`. World points are model units
 * (meters internally); angles are degrees. Arrow transforms follow the
 * `cadAnnotationArrowheads` convention (block-local +X = arrow direction, tip
 * at origin), so `rotationDeg` is the arrow bearing. Radial text prefixes
 * (`R`, `Ø`) are caller-supplied via `prefix`.
 */
import {
  cadAngleDegFromCenter, cadDistance, cadNormalizeAngleDeg,
  cadProjectPointOntoInfiniteLine, type CadWorldPoint,
} from '../cadGeometry';
import type {
  CadDimensionArrowTransform, CadDimensionGeometry, CadDimensionGeometryBounds,
  CadDimensionGeometryInput, CadDimensionGeometryPoint, CadDimensionGeometrySegment,
  CadDimensionTextSide,
} from './cadDimensionGeometryTypes';

export type {
  CadDimensionArrowTransform, CadDimensionGeometry, CadDimensionGeometryBounds,
  CadDimensionGeometryInput, CadDimensionGeometryPoint, CadDimensionGeometrySegment,
  CadDimensionKind, CadDimensionTextSide,
} from './cadDimensionGeometryTypes';

const DEGREE_SYMBOL = '°';
const ARC_CHORD_COUNT = 12;
const TEXT_WIDTH_FACTOR = 0.6;
const FALLBACK_DIRECTION: CadDimensionGeometryPoint = { x: 1, y: 0 };

type ArrowStyle = 'linear' | 'outward' | 'outward-far';

interface CadDimensionDrawing {
  measurement: number;
  extensionSegments: CadDimensionGeometrySegment[];
  dimensionSegments: CadDimensionGeometrySegment[];
  /** Arrows independent of the text fit (angular/radial); null for linear kinds. */
  fixedArrows: CadDimensionArrowTransform[] | null;
  linearArrows: { start: CadDimensionGeometryPoint; end: CadDimensionGeometryPoint; direction: CadDimensionGeometryPoint } | null;
  arrowStyle: ArrowStyle;
  textAnchor: CadDimensionGeometryPoint;
  outsideTextAnchor: CadDimensionGeometryPoint;
  outsideDirection: CadDimensionGeometryPoint;
  insideDir: CadDimensionGeometryPoint;
  rotationDir: CadDimensionGeometryPoint;
  spanLength: number;
}

const finiteOr = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const nonNegative = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

const resolvePrecision = (value: number): number =>
  Number.isFinite(value) ? Math.min(12, Math.max(0, Math.trunc(value))) : 2;

const subtract = (a: CadWorldPoint, b: CadWorldPoint): CadWorldPoint => ({ x: a.x - b.x, y: a.y - b.y });

const addScaled = (point: CadWorldPoint, dir: CadWorldPoint, scale: number): CadWorldPoint => ({
  x: point.x + dir.x * scale,
  y: point.y + dir.y * scale,
});

const midpoint = (a: CadWorldPoint, b: CadWorldPoint): CadWorldPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

const dot = (a: CadWorldPoint, b: CadWorldPoint): number => a.x * b.x + a.y * b.y;

const negate = (v: CadWorldPoint): CadWorldPoint => ({ x: -v.x, y: -v.y });

const perpendicular = (v: CadWorldPoint): CadWorldPoint => ({ x: -v.y, y: v.x });

const unit = (v: CadWorldPoint): CadWorldPoint => {
  const length = Math.hypot(v.x, v.y);
  return length <= 1e-12 ? FALLBACK_DIRECTION : { x: v.x / length, y: v.y / length };
};

const directionBetween = (from: CadWorldPoint, to: CadWorldPoint): CadWorldPoint =>
  unit(subtract(to, from));

const pointAtAngle = (center: CadWorldPoint, radius: number, angleDeg: number): CadWorldPoint => {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: center.x + Math.cos(radians) * radius, y: center.y + Math.sin(radians) * radius };
};

const bearingDeg = (dir: CadWorldPoint): number => cadAngleDegFromCenter({ x: 0, y: 0 }, dir);

/** Readable text rotation: fold upside-down directions by 180 into (-90, 90]. */
export const cadReadableTextRotationDeg = (directionDeg: number): number => {
  const normalized = cadNormalizeAngleDeg(directionDeg);
  if (normalized > 90 && normalized <= 270) return normalized - 180;
  return normalized > 270 ? normalized - 360 : normalized;
};

/** Tangent along an interior arc at ray direction `u`, following `sign` (CCW when +1). */
const tangentDir = (u: CadWorldPoint, sign: number): CadWorldPoint => {
  const ccw = perpendicular(u);
  return sign >= 0 ? ccw : negate(ccw);
};

const arrowAt = (
  point: CadWorldPoint, directionDeg: number, size: number,
): CadDimensionArrowTransform => ({
  x: point.x,
  y: point.y,
  rotationDeg: cadNormalizeAngleDeg(directionDeg),
  size,
});

const buildLinearDrawing = (
  input: CadDimensionGeometryInput,
  axisDir: CadWorldPoint,
  axisNormal: CadWorldPoint,
  measurement: number,
): CadDimensionDrawing => {
  const linePoint = input.dimLinePoint;
  const lineEnd = addScaled(linePoint, axisDir, 1);
  const project = (point: CadWorldPoint): CadWorldPoint =>
    cadProjectPointOntoInfiniteLine(point, linePoint, lineEnd).point;
  const projected1 = project(input.p1);
  const projected2 = project(input.p2);
  const reversed = dot(subtract(projected2, projected1), axisDir) < 0;
  const dimStart = reversed ? projected2 : projected1;
  const dimEnd = reversed ? projected1 : projected2;
  // Axis direction (not the projected delta) keeps rotation/arrows invariant at
  // large coordinates, where the projection itself carries rounding noise.
  const direction = reversed ? negate(axisDir) : axisDir;
  const offset = nonNegative(input.extensionOffset);
  const overshoot = nonNegative(input.extensionOvershoot);

  const extensionFrom = (point: CadWorldPoint, projected: CadWorldPoint) => {
    const delta = subtract(projected, point);
    const sign = dot(subtract(linePoint, point), axisNormal) >= 0 ? 1 : -1;
    const extDir =
      Math.hypot(delta.x, delta.y) <= 1e-12
        ? { x: axisNormal.x * sign, y: axisNormal.y * sign }
        : unit(delta);
    return {
      segment: { from: addScaled(point, extDir, offset), to: addScaled(projected, extDir, overshoot) },
      dir: extDir,
    };
  };
  const extension1 = extensionFrom(input.p1, projected1);
  const extension2 = extensionFrom(input.p2, projected2);

  return {
    measurement,
    extensionSegments: [extension1.segment, extension2.segment],
    dimensionSegments: [{ from: dimStart, to: dimEnd }],
    fixedArrows: null,
    linearArrows: { start: dimStart, end: dimEnd, direction },
    arrowStyle: 'linear',
    textAnchor: midpoint(dimStart, dimEnd),
    outsideTextAnchor: dimEnd,
    outsideDirection: direction,
    insideDir: extension1.dir,
    rotationDir: direction,
    spanLength: measurement,
  };
};

const resolveAngularRadius = (
  input: CadDimensionGeometryInput, vertex: CadWorldPoint, ray1: CadWorldPoint, ray2: CadWorldPoint,
): number => {
  const toDimLine = cadDistance(vertex, input.dimLinePoint);
  if (toDimLine > 1e-12) return toDimLine;
  const shortestRay = Math.min(cadDistance(vertex, ray1), cadDistance(vertex, ray2));
  return shortestRay > 1e-12 ? shortestRay : 1;
};

const buildArcSegments = (
  vertex: CadWorldPoint, radius: number, startAngleDeg: number, sign: number, sweepDeg: number,
): CadDimensionGeometrySegment[] => {
  const segments: CadDimensionGeometrySegment[] = [];
  for (let index = 0; index < ARC_CHORD_COUNT; index += 1) {
    const fromAngle = startAngleDeg + (sign * sweepDeg * index) / ARC_CHORD_COUNT;
    const toAngle = startAngleDeg + (sign * sweepDeg * (index + 1)) / ARC_CHORD_COUNT;
    segments.push({
      from: pointAtAngle(vertex, radius, fromAngle),
      to: pointAtAngle(vertex, radius, toAngle),
    });
  }
  return segments;
};

const buildAngularDrawing = (input: CadDimensionGeometryInput): CadDimensionDrawing => {
  const vertex = input.vertex ?? input.p1;
  const ray1 = input.ray1Point ?? input.p1;
  const ray2 = input.ray2Point ?? input.p2;
  const u1 = directionBetween(vertex, ray1);
  const u2 = directionBetween(vertex, ray2);
  const startAngle = bearingDeg(u1);
  let sweep = cadNormalizeAngleDeg(bearingDeg(u2) - startAngle);
  if (sweep > 180) sweep = 360 - sweep;
  const sign = u1.x * u2.y - u1.y * u2.x >= 0 ? 1 : -1;
  const radius = resolveAngularRadius(input, vertex, ray1, ray2);
  const offset = nonNegative(input.extensionOffset);
  const overshoot = nonNegative(input.extensionOvershoot);
  const extensionSegments = [ray1, ray2].map((ray) => ({
    from: addScaled(vertex, directionBetween(vertex, ray), offset),
    to: addScaled(vertex, directionBetween(vertex, ray), radius + overshoot),
  }));
  const arcPoint = (angleDeg: number): CadWorldPoint => pointAtAngle(vertex, radius, angleDeg);
  const endAngle = startAngle + sign * sweep;
  const fixedArrows = [
    arrowAt(arcPoint(startAngle), bearingDeg(tangentDir(u1, sign)), nonNegative(input.arrowSize)),
    arrowAt(arcPoint(endAngle), bearingDeg(tangentDir(u2, sign)), nonNegative(input.arrowSize)),
  ];

  return {
    measurement: sweep,
    extensionSegments,
    dimensionSegments: buildArcSegments(vertex, radius, startAngle, sign, sweep),
    fixedArrows,
    linearArrows: null,
    arrowStyle: 'linear',
    textAnchor: arcPoint(startAngle + (sign * sweep) / 2),
    outsideTextAnchor: arcPoint(endAngle),
    outsideDirection: tangentDir(u2, sign),
    insideDir: unit(subtract(arcPoint(startAngle + (sign * sweep) / 2), vertex)),
    rotationDir: unit(subtract(arcPoint(startAngle + (sign * sweep) / 2), vertex)),
    spanLength: ((sweep * Math.PI) / 180) * radius,
  };
};

const resolveRadius = (input: CadDimensionGeometryInput, center: CadWorldPoint): number => {
  const declared = finiteOr(input.radius ?? Number.NaN, Number.NaN);
  if (Number.isFinite(declared)) return Math.abs(declared);
  if (input.arcPoint) {
    const toArc = cadDistance(center, input.arcPoint);
    if (toArc > 0) return toArc;
  }
  return 0;
};

const resolveRadialDirection = (
  input: CadDimensionGeometryInput, center: CadWorldPoint,
): CadWorldPoint => {
  if (input.arcPoint) {
    const toArc = subtract(input.arcPoint, center);
    if (Math.hypot(toArc.x, toArc.y) > 1e-12) return unit(toArc);
  }
  const toDimLine = subtract(input.dimLinePoint, center);
  return Math.hypot(toDimLine.x, toDimLine.y) > 1e-12 ? unit(toDimLine) : FALLBACK_DIRECTION;
};

const buildRadialDrawing = (
  input: CadDimensionGeometryInput,
  isDiameter: boolean,
): CadDimensionDrawing => {
  const center = input.center ?? midpoint(input.p1, input.p2);
  const radius = resolveRadius(input, center);
  const direction = resolveRadialDirection(input, center);
  const near = isDiameter ? addScaled(center, direction, -radius) : { ...center };
  const far = addScaled(center, direction, radius);
  const mid = midpoint(near, far);
  const cross = perpendicular(direction);
  const side = dot(cross, subtract(input.dimLinePoint, mid)) < 0 ? -1 : 1;

  return {
    measurement: isDiameter ? radius * 2 : radius,
    extensionSegments: [],
    dimensionSegments: [{ from: near, to: far }],
    fixedArrows: null,
    linearArrows: { start: near, end: far, direction },
    arrowStyle: isDiameter ? 'outward' : 'outward-far',
    textAnchor: mid,
    outsideTextAnchor: far,
    outsideDirection: direction,
    insideDir: side < 0 ? negate(cross) : cross,
    rotationDir: direction,
    spanLength: cadDistance(near, far),
  };
};

const buildDrawing = (input: CadDimensionGeometryInput): CadDimensionDrawing => {
  switch (input.kind) {
    case 'linear-horizontal':
      return buildLinearDrawing(input, { x: 1, y: 0 }, { x: 0, y: 1 }, Math.abs(input.p2.x - input.p1.x));
    case 'linear-vertical':
      return buildLinearDrawing(input, { x: 0, y: 1 }, { x: 1, y: 0 }, Math.abs(input.p2.y - input.p1.y));
    case 'aligned': {
      const direction = directionBetween(input.p1, input.p2);
      return buildLinearDrawing(
        input,
        direction,
        perpendicular(direction),
        cadDistance(input.p1, input.p2),
      );
    }
    case 'angular':
      return buildAngularDrawing(input);
    case 'radius':
      return buildRadialDrawing(input, false);
    case 'diameter':
      return buildRadialDrawing(input, true);
  }
};

/** Arrowheads point inward for an inside text fit and outward for an outside fit. */
const buildArrows = (
  drawing: CadDimensionDrawing,
  arrowsInward: boolean,
  arrowSize: number,
): CadDimensionArrowTransform[] => {
  if (drawing.fixedArrows) return drawing.fixedArrows;
  const pair = drawing.linearArrows;
  if (!pair) return [];
  const forwardDeg = bearingDeg(pair.direction);
  const backwardDeg = cadNormalizeAngleDeg(forwardDeg + 180);
  if (drawing.arrowStyle === 'outward') {
    return [arrowAt(pair.start, backwardDeg, arrowSize), arrowAt(pair.end, forwardDeg, arrowSize)];
  }
  if (drawing.arrowStyle === 'outward-far') {
    return [arrowAt(pair.end, forwardDeg, arrowSize)];
  }
  return arrowsInward
    ? [arrowAt(pair.start, forwardDeg, arrowSize), arrowAt(pair.end, backwardDeg, arrowSize)]
    : [arrowAt(pair.start, backwardDeg, arrowSize), arrowAt(pair.end, forwardDeg, arrowSize)];
};

const resolveTextPosition = (
  drawing: CadDimensionDrawing, side: CadDimensionTextSide, textGap: number, textWidth: number,
): CadWorldPoint => {
  const anchor =
    side === 'inside'
      ? drawing.textAnchor
      : addScaled(drawing.outsideTextAnchor, drawing.outsideDirection, textWidth / 2 + textGap);
  return addScaled(anchor, drawing.insideDir, textGap);
};

const formatMeasurement = (
  input: CadDimensionGeometryInput,
  measurement: number,
  precision: number,
): string => {
  const unit = input.kind === 'angular' ? DEGREE_SYMBOL : '';
  return `${input.prefix ?? ''}${measurement.toFixed(precision)}${unit}${input.suffix ?? ''}`;
};

const buildBounds = (points: CadDimensionGeometryPoint[]): CadDimensionGeometryBounds => {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return points.reduce<CadDimensionGeometryBounds>(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
};

/** Deterministic dimension geometry for a single semantic dimension. */
export function deriveCadDimensionGeometry(
  input: CadDimensionGeometryInput,
): CadDimensionGeometry {
  const textGap = nonNegative(input.textGap);
  const arrowSize = nonNegative(input.arrowSize);
  const textHeight = nonNegative(input.textHeight);
  const drawing = buildDrawing(input);
  const measurement = finiteOr(drawing.measurement, 0);
  const formattedText = formatMeasurement(input, measurement, resolvePrecision(input.decimalPrecision));
  const textWidth = formattedText.length * TEXT_WIDTH_FACTOR * textHeight;
  const fitsInside = drawing.spanLength >= textWidth + 2 * arrowSize + 2 * textGap;
  const textSide: CadDimensionTextSide = fitsInside ? 'inside' : 'outside';
  const textPosition = resolveTextPosition(drawing, textSide, textGap, textWidth);
  const arrowTransforms = buildArrows(drawing, fitsInside, arrowSize);
  const boundsPoints: CadDimensionGeometryPoint[] = [
    ...drawing.extensionSegments.flatMap((segment) => [segment.from, segment.to]),
    ...drawing.dimensionSegments.flatMap((segment) => [segment.from, segment.to]),
    ...arrowTransforms.map((arrow) => ({ x: arrow.x, y: arrow.y })),
    textPosition,
  ];

  return {
    measurement,
    formattedText,
    extensionSegments: drawing.extensionSegments,
    dimensionSegments: drawing.dimensionSegments,
    arrowTransforms,
    textPosition,
    textRotationDeg: cadReadableTextRotationDeg(bearingDeg(drawing.rotationDir)),
    textSide,
    bounds: buildBounds(boundsPoints),
    status: 'ok',
  };
}
