import { cadBestFitArc } from '../../engine/cad/cadBestFitArc';
import { cadBestFitLine } from '../../engine/cad/cadBestFitLine';
import { cadBestFitParabola } from '../../engine/cad/cadBestFitParabola';
import { cadParabolaParamPoint } from '../../engine/cad/cadParabolaGeometry';
import type { CadDisplayPrimitive } from '../../engine/cad/cadDisplayTypes';
import type { CadCommandPreviewState } from './useSurveyCadCommandPreview';
import {
  bestFitMinSamples,
  isBestFitSession,
  type BestFitCommandSession,
} from './useSurveyCadBestFitSession';

const FIT_STROKE = '#22d3ee';
const RESIDUAL_STROKE = '#f59e0b';
const PREVIEW_OPACITY = 0.85;

type PreviewLineBody = Omit<
  Extract<CadDisplayPrimitive, { kind: 'line' }>,
  'id' | 'layerId' | 'sourceEntityId'
>;
type PreviewArcBody = Omit<
  Extract<CadDisplayPrimitive, { kind: 'arc' }>,
  'id' | 'layerId' | 'sourceEntityId'
>;

const fitPrimitive = (id: string, primitive: PreviewLineBody | PreviewArcBody): CadDisplayPrimitive => ({
  ...primitive,
  id,
  layerId: 'preview',
  sourceEntityId: id,
});

const residualPrimitive = (
  index: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
): CadDisplayPrimitive =>
  fitPrimitive(`preview:bestfit-residual:${index + 1}`, {
    kind: 'line',
    points: [from, to],
    stroke: RESIDUAL_STROKE,
    strokeWidth: 1,
    opacity: PREVIEW_OPACITY,
  });

const residualPrimitives = (
  samples: readonly { x: number; y: number }[],
  closest: readonly { x: number; y: number }[],
): CadDisplayPrimitive[] =>
  samples.map((sample, index) =>
    residualPrimitive(index, { x: sample.x, y: sample.y }, closest[index] ?? sample),
  );

const PARABOLA_PREVIEW_SEGMENTS = 48;

const parabolaPreviewPoints = (
  canonical: { vertexX: number; vertexY: number; axisAngleDeg: number; focalLength: number; tStart: number; tEnd: number },
): { x: number; y: number }[] => {
  const points: { x: number; y: number }[] = [];
  for (let index = 0; index <= PARABOLA_PREVIEW_SEGMENTS; index += 1) {
    const t = canonical.tStart + ((canonical.tEnd - canonical.tStart) * index) / PARABOLA_PREVIEW_SEGMENTS;
    points.push(cadParabolaParamPoint(canonical, t));
  }
  return points;
};

/**
 * Best-fit session preview: the re-solved fit plus transient residual
 * vectors. Solved from the stored samples only (never persisted); null
 * below the minimum or when the fit fails closed.
 */
export const buildBestFitPreview = (
  session: BestFitCommandSession,
): CadCommandPreviewState | null => {
  if (session.samples.length < bestFitMinSamples(session.key)) return null;
  const points = session.samples.map((sample) => ({ x: sample.x, y: sample.y }));
  if (session.key === 'BESTFITLINE') {
    const result = cadBestFitLine(points);
    if (!result) return null;
    return {
      kind: 'primitives',
      primitives: [
        fitPrimitive('preview:bestfit-fit', {
          kind: 'line',
          points: [result.endP0, result.endP1],
          stroke: FIT_STROKE,
          strokeWidth: 1.5,
          opacity: PREVIEW_OPACITY,
          strokeDasharray: '8 6',
        }),
        ...residualPrimitives(session.samples, result.closestPoints),
      ],
    };
  }
  if (session.key === 'BESTFITARC') {
    const result = cadBestFitArc(points);
    if (!result) return null;
    return {
      kind: 'primitives',
      primitives: [
        fitPrimitive('preview:bestfit-fit', {
          kind: 'arc',
          center: { x: result.centerX, y: result.centerY },
          radius: result.radius,
          startAngleDeg: result.startAngleDeg,
          endAngleDeg: result.endAngleDeg,
          stroke: FIT_STROKE,
          strokeWidth: 1.5,
          opacity: PREVIEW_OPACITY,
          strokeDasharray: '8 6',
        }),
        ...residualPrimitives(session.samples, result.closestPoints),
      ],
    };
  }
  const result = cadBestFitParabola(points);
  if (!result) return null;
  const curve = parabolaPreviewPoints(result.canonical);
  const segments: CadDisplayPrimitive[] = curve
    .slice(0, -1)
    .map((from, index) =>
      fitPrimitive(`preview:bestfit-fit:${index + 1}`, {
        kind: 'line',
        points: [from, curve[index + 1]!],
        stroke: FIT_STROKE,
        strokeWidth: 1.5,
        opacity: PREVIEW_OPACITY,
        strokeDasharray: '8 6',
      }),
    );
  return {
    kind: 'primitives',
    primitives: [...segments, ...residualPrimitives(session.samples, result.closestPoints)],
  };
};

export const bestFitPreviewForSession = (
  session: Parameters<typeof isBestFitSession>[0],
): CadCommandPreviewState | null => {
  if (!isBestFitSession(session)) return null;
  return buildBestFitPreview(session);
};
