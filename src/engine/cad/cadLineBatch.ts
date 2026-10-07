/**
 * CAD Draw Phase L1 — shared production line-creation batch law and pure chain
 * draft contract.
 *
 * `buildCadLineEntities` is the single mutation-free builder used by the
 * LINE_CREATE_BATCH command (and by single-segment modes routed through it):
 * it validates EVERY segment before creating any entity and returns null
 * atomically if any segment is non-finite or below the canonical floor.
 */
import { createStableRuntimeId } from '../id';
import { resolveCurrentCadLayerId } from './cadLayers';
import { nextEntityName } from './cadTransactionsEntityFactories';
import {
  CAD_LINE_DEGENERATE_FLOOR,
  cadLineFail,
  cadLineOk,
  type CadLineChainDraft,
  type CadLinePointInput,
  type CadLineResult,
  type CadLineSegmentInput,
} from './cadLineTypes';
import type { CadLineEntity, CadProject } from './cadTypes';

type LineBatchProject = Pick<CadProject, 'entities' | 'layers' | 'currentLayerId'>;

const isFinitePoint = (point: CadLinePointInput): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y) && typeof point.label === 'string';

/** True when a segment is finite and above the canonical per-axis line floor. */
export const isCadLineSegmentValid = (segment: CadLineSegmentInput): boolean =>
  isFinitePoint(segment.start) &&
  isFinitePoint(segment.end) &&
  !(
    Math.abs(segment.start.x - segment.end.x) <= CAD_LINE_DEGENERATE_FLOOR &&
    Math.abs(segment.start.y - segment.end.y) <= CAD_LINE_DEGENERATE_FLOOR
  );

const sequentialNames = (project: LineBatchProject, prefix: string, count: number): string[] => {
  const first = nextEntityName(project as CadProject, prefix);
  const match = /(\d+)$/.exec(first);
  const start = match ? Number(match[1]) : 1;
  return Array.from({ length: count }, (_unused, index) => `${prefix}${start + index}`);
};

/**
 * Build N first-class `CadLineEntity` values on the current layer. Returns
 * null unless every segment is valid (atomic reject).
 */
export const buildCadLineEntities = (
  project: LineBatchProject,
  segments: readonly CadLineSegmentInput[],
  createdBy: string,
): CadLineEntity[] | null => {
  if (segments.length === 0) return null;
  if (!segments.every(isCadLineSegmentValid)) return null;
  const layerId = resolveCurrentCadLayerId(project);
  const names = sequentialNames(project, 'LINE', segments.length);
  return segments.map((segment, index) => ({
    id: createStableRuntimeId('cad-line'),
    type: 'line',
    layerId,
    visible: true,
    locked: false,
    fromStationId: segment.start.label,
    toStationId: segment.end.label,
    fromX: segment.start.x,
    fromY: segment.start.y,
    toX: segment.end.x,
    toY: segment.end.y,
    sourceObservationIds: [],
    metadata: {
      createdBy,
      entityName: names[index],
      manual: true,
    },
  }));
};

export const createCadLineChainDraft = (): CadLineChainDraft => ({ points: [] });

/**
 * Append a point to a chain draft. Returns a NEW draft (the input is never
 * mutated) or fails when the point is non-finite or duplicates the last point.
 */
export const appendCadLineChainPoint = (
  draft: CadLineChainDraft,
  point: CadLinePointInput,
): CadLineResult<CadLineChainDraft> => {
  if (!isFinitePoint(point)) return cadLineFail('NON_FINITE', 'Chain point must have finite coordinates and a label.');
  const last = draft.points[draft.points.length - 1];
  if (last && last.x === point.x && last.y === point.y) {
    return cadLineFail('DEGENERATE', 'Chain point duplicates the previous point.');
  }
  return cadLineOk({ points: [...draft.points, { ...point }] });
};

export const undoCadLineChainPoint = (draft: CadLineChainDraft): CadLineChainDraft =>
  draft.points.length === 0 ? draft : { points: draft.points.slice(0, -1) };

/** Convert a chain draft into ordered segments; needs at least two points. */
export const cadLineChainToSegments = (draft: CadLineChainDraft): CadLineResult<CadLineSegmentInput[]> => {
  if (draft.points.length < 2) {
    return cadLineFail('POINT_RANGE_TOO_SHORT', 'A chain needs at least two points to form segments.');
  }
  const segments: CadLineSegmentInput[] = [];
  for (let index = 1; index < draft.points.length; index += 1) {
    segments.push({ start: draft.points[index - 1], end: draft.points[index] });
  }
  return cadLineOk(segments);
};
