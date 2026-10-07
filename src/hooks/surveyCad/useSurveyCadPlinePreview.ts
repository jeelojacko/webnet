import { cadAngleDegFromCenter, cadBuildArcFromThreePoints, cadDistance, type CadArcDefinition } from '../../engine/cad/cadGeometry';
import { describeParcelArcCourse } from '../../engine/cad/cadParcelArcGeometry';
import type {
  CadDisplayPrimitive,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from '../../engine/cad/cadTypes';
import type { CadCommandPreviewState } from './useSurveyCadCommandPreview';
import {
  plineArcThroughOf,
  plineDefaultWidthOf,
  plineDrawModeOf,
  plineGeometryOf,
  plineWidthsOf,
  type PlineCommandSession,
} from './useSurveyCadPlineSession';

const PREVIEW_STROKE = '#22d3ee';
const PREVIEW_OPACITY = 0.85;
const PREVIEW_DASH = '8 6';
const ARC_EDGE_TESSELLATION = 24;

interface PlinePreviewCourse {
  from: { x: number; y: number };
  to: { x: number; y: number };
  geometry: CadPolylineSegmentGeometry;
  width: CadPolylineSegmentWidth;
}

const zeroWidth: CadPolylineSegmentWidth = { startWidth: 0, endWidth: 0 };

const completedCourses = (session: PlineCommandSession): PlinePreviewCourse[] => {
  const geometry = plineGeometryOf(session);
  const widths = plineWidthsOf(session);
  return session.points.slice(0, -1).map((from, index) => ({
    from: { x: from.x, y: from.y },
    to: { x: session.points[index + 1]!.x, y: session.points[index + 1]!.y },
    geometry: geometry[index] ?? { kind: 'line' },
    width: widths[index] ?? zeroWidth,
  }));
};

const linePrimitive = (
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  dashed: boolean,
): CadDisplayPrimitive => ({
  kind: 'line',
  id,
  layerId: 'preview',
  sourceEntityId: id,
  stroke: PREVIEW_STROKE,
  points: [from, to],
  strokeWidth: dashed ? 1.5 : 1,
  opacity: PREVIEW_OPACITY,
  ...(dashed ? { strokeDasharray: PREVIEW_DASH } : {}),
});

const pointPrimitive = (
  id: string,
  point: { x: number; y: number },
): CadDisplayPrimitive => ({
  kind: 'point',
  id,
  layerId: 'preview',
  sourceEntityId: id,
  stroke: PREVIEW_STROKE,
  fill: PREVIEW_STROKE,
  point,
  radius: 2.4,
  opacity: PREVIEW_OPACITY,
});

/** Model-space width edge guides for a straight course (exact, tapered). */
const lineWidthEdges = (
  idPrefix: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: CadPolylineSegmentWidth,
): CadDisplayPrimitive[] => {
  if (width.startWidth === 0 && width.endWidth === 0) return [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-12)) return [];
  const nx = -dy / length;
  const ny = dx / length;
  const offset = (point: { x: number; y: number }, half: number) => ({
    x: point.x + nx * half,
    y: point.y + ny * half,
  });
  return [
    linePrimitive(
      `${idPrefix}:edge-left`,
      offset(from, width.startWidth / 2),
      offset(to, width.endWidth / 2),
      false,
    ),
    linePrimitive(
      `${idPrefix}:edge-right`,
      offset(from, -width.startWidth / 2),
      offset(to, -width.endWidth / 2),
      false,
    ),
  ];
};

/**
 * Model-space width edge guides for a true circular arc course: both edges
 * tessellate the exact arc with the linearly tapered half-width applied
 * along the radial normal at every sample.
 */
const arcWidthEdges = (
  idPrefix: string,
  center: { x: number; y: number },
  radius: number,
  startAngleDeg: number,
  signedSweepDeg: number,
  width: CadPolylineSegmentWidth,
): CadDisplayPrimitive[] => {
  if (width.startWidth === 0 && width.endWidth === 0) return [];
  if (!(radius > 0) || !Number.isFinite(signedSweepDeg) || signedSweepDeg === 0) return [];
  const edgePoint = (fraction: number, side: 1 | -1) => {
    const angleRad = ((startAngleDeg + signedSweepDeg * fraction) * Math.PI) / 180;
    const half = (width.startWidth + (width.endWidth - width.startWidth) * fraction) / 2;
    const radial = { x: Math.cos(angleRad), y: Math.sin(angleRad) };
    const offsetRadius = radius + side * half;
    return {
      x: center.x + radial.x * offsetRadius,
      y: center.y + radial.y * offsetRadius,
    };
  };
  const edges: CadDisplayPrimitive[] = [];
  for (const side of [1, -1] as const) {
    let previous = edgePoint(0, side);
    for (let step = 1; step <= ARC_EDGE_TESSELLATION; step += 1) {
      const next = edgePoint(step / ARC_EDGE_TESSELLATION, side);
      edges.push(
        linePrimitive(
          `${idPrefix}:edge-${side === 1 ? 'outer' : 'inner'}:${step}`,
          previous,
          next,
          false,
        ),
      );
      previous = next;
    }
  }
  return edges;
};

const arcCoursePrimitives = (
  idPrefix: string,
  course: PlinePreviewCourse,
  bulge: number,
): CadDisplayPrimitive[] => {
  const metrics = describeParcelArcCourse(course.from, course.to, bulge);
  if (!metrics) {
    // Fail-closed display: an unresolvable stored course falls back to its
    // chord (the commit path owns validation; preview never throws).
    return [linePrimitive(idPrefix, course.from, course.to, true)];
  }
  return [
    {
      kind: 'arc',
      id: idPrefix,
      layerId: 'preview',
      sourceEntityId: idPrefix,
      stroke: PREVIEW_STROKE,
      center: { ...metrics.center },
      radius: metrics.radius,
      startAngleDeg: metrics.startAngleDeg,
      endAngleDeg: metrics.endAngleDeg,
      strokeWidth: 1.5,
      opacity: PREVIEW_OPACITY,
      strokeDasharray: PREVIEW_DASH,
    },
    ...arcWidthEdges(
      idPrefix,
      metrics.center,
      metrics.radius,
      metrics.startAngleDeg,
      metrics.signedSweepDeg,
      course.width,
    ),
  ];
};

const coursePrimitives = (idPrefix: string, course: PlinePreviewCourse): CadDisplayPrimitive[] =>
  course.geometry.kind === 'arc'
    ? arcCoursePrimitives(idPrefix, course, course.geometry.bulge)
    : [
        linePrimitive(idPrefix, course.from, course.to, true),
        ...lineWidthEdges(idPrefix, course.from, course.to, course.width),
      ];

/**
 * Draft-order sweep for the pending leg. `cadBuildArcFromThreePoints`
 * always emits a CCW builder start→end sweep and swaps its endpoints when
 * the draft leg is CW, so width guides must be re-derived from the draft
 * start point with a signed sweep — otherwise a tapered CW leg lands
 * `startWidth` at the eventual end and the taper is reversed.
 */
const pendingArcDraftOrder = (
  arc: CadArcDefinition,
  draftStart: { x: number; y: number },
): { startAngleDeg: number; signedSweepDeg: number } => {
  const reversed = cadDistance(arc.startPoint, draftStart) > cadDistance(arc.endPoint, draftStart);
  return {
    startAngleDeg: cadAngleDegFromCenter(arc.center, draftStart),
    signedSweepDeg: reversed ? -arc.deltaDeg : arc.deltaDeg,
  };
};

/**
 * Phase C2 PLINE draft preview.
 *
 * Line mode with a legacy (all-line, zero-width) draft keeps the exact C1
 * shape (`polyline` through the cursor). Arc mode renders every completed
 * course natively (true arcs from the stored bulges) and the pending leg as
 * the TRUE 3-point circular arc through start → through-point → cursor —
 * fail-closed to the cursor point alone when the triple is degenerate, so
 * no fabricated chord is ever shown. Before the through-point is picked the
 * preview shows the completed courses plus the cursor point only. Nonzero
 * widths render as model-space edge guides (tapered per course, including
 * the live cursor leg). No implied closure segment is ever emitted.
 */
export const buildPlinePreview = (
  session: PlineCommandSession,
  previewPoint: { x: number; y: number; label: string } | null,
): CadCommandPreviewState | null => {
  if (!previewPoint) return null;
  const cursor = { x: previewPoint.x, y: previewPoint.y };
  if (session.points.length === 0) {
    return { kind: 'point', point: cursor };
  }
  const courses = completedCourses(session);
  const defaultWidth = plineDefaultWidthOf(session);
  const draftHasArcs = courses.some((course) => course.geometry.kind === 'arc');
  const draftHasWidths =
    defaultWidth.startWidth !== 0 ||
    defaultWidth.endWidth !== 0 ||
    courses.some((course) => course.width.startWidth !== 0 || course.width.endWidth !== 0);
  if (plineDrawModeOf(session) === 'line' && !draftHasArcs && !draftHasWidths) {
    return {
      kind: 'polyline',
      points: [...session.points.map((point) => ({ x: point.x, y: point.y })), cursor],
    };
  }
  const primitives: CadDisplayPrimitive[] = courses.flatMap((course, index) =>
    coursePrimitives(`preview:pline:${index + 1}`, course),
  );
  const last = session.points[session.points.length - 1]!;
  const lastPoint = { x: last.x, y: last.y };
  if (plineDrawModeOf(session) === 'line') {
    primitives.push(linePrimitive('preview:pline:pending', lastPoint, cursor, true));
    primitives.push(...lineWidthEdges('preview:pline:pending', lastPoint, cursor, defaultWidth));
    return { kind: 'primitives', primitives };
  }
  const through = plineArcThroughOf(session);
  if (through == null) {
    primitives.push(pointPrimitive('preview:pline:cursor', cursor));
    return { kind: 'primitives', primitives };
  }
  const pendingArc = cadBuildArcFromThreePoints(lastPoint, through, cursor);
  if (!pendingArc) {
    primitives.push(pointPrimitive('preview:pline:cursor', cursor));
    return { kind: 'primitives', primitives };
  }
  const draftOrder = pendingArcDraftOrder(pendingArc, lastPoint);
  primitives.push({
    kind: 'arc',
    id: 'preview:pline:pending',
    layerId: 'preview',
    sourceEntityId: 'preview:pline:pending',
    stroke: PREVIEW_STROKE,
    center: { ...pendingArc.center },
    radius: pendingArc.radius,
    startAngleDeg: pendingArc.startAngleDeg,
    endAngleDeg: pendingArc.endAngleDeg,
    strokeWidth: 1.5,
    opacity: PREVIEW_OPACITY,
    strokeDasharray: PREVIEW_DASH,
  });
  primitives.push(
    ...arcWidthEdges(
      'preview:pline:pending',
      pendingArc.center,
      pendingArc.radius,
      draftOrder.startAngleDeg,
      draftOrder.signedSweepDeg,
      defaultWidth,
    ),
  );
  return { kind: 'primitives', primitives };
};
