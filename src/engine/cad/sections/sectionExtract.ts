import { locateProfileElevation, planeElevationAt } from '../profiles/profileMeshLocate';
import { PLANE_AGREEMENT_EPS, extractTinAlongSegment } from '../profiles/profileSampling';
import { pointAtSampleOffset, validateSampleWidths } from './sectionDirection';
import type {
  ProfileExtractionMesh,
  ProfileSampleEventKind,
} from '../profiles/profileExtraction';
import type { SectionErrorCode, SectionResult, SectionSample } from './sectionTypes';

export interface ExtractSampleLineInput {
  mesh: ProfileExtractionMesh;
  center: { x: number; y: number };
  /** Unit sample-line direction D (positive offset = LEFT). */
  direction: { x: number; y: number };
  leftWidth: number;
  rightWidth: number;
  /** RAW station: the persisted line identity. */
  rawStation: number;
  lineId?: string;
}

export type ExtractSampleLineResult =
  | { ok: true; section: SectionResult }
  | { ok: false; code: Extract<SectionErrorCode, 'INVALID_WIDTH' | 'INVALID_DIRECTION'> };

/**
 * Straight-XY TIN walk over the canonical offset domain
 * (-rightWidth..+leftWidth, ascending). Same event/void/plane-break
 * semantics as the 18J profile walker via the shared extractTinAlongSegment
 * seam; sections never adapt to arcs (sample lines are straight).
 * Partial coverage yields multiple segments; voids are never bridged.
 */
export const extractSampleLine = (input: ExtractSampleLineInput): ExtractSampleLineResult => {
  const widths = validateSampleWidths(input.leftWidth, input.rightWidth);
  if (!widths.ok) return widths;
  const directionLength = Math.hypot(input.direction.x, input.direction.y);
  if (!(directionLength > 1e-12)) return { ok: false, code: 'INVALID_DIRECTION' };
  const direction = { x: input.direction.x / directionLength, y: input.direction.y / directionLength };

  const minOffset = -input.rightWidth;
  const totalWidth = input.leftWidth + input.rightWidth;
  const at = (offset: number): { x: number; y: number } =>
    pointAtSampleOffset(input.center, direction, offset);
  const p0 = at(minOffset);
  const p1 = at(input.leftWidth);

  const events = extractTinAlongSegment(input.mesh, p0, p1, 0, totalWidth);
  const bounds = [0, ...events.map((event) => event.t), 1];
  interface Interval {
    inside: boolean;
    elevation: number;
    tri: number;
  }
  const intervals: Interval[] = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    const mid = (bounds[index]! + bounds[index + 1]!) / 2;
    const point = at(minOffset + mid * totalWidth);
    const located = locateProfileElevation(input.mesh, point.x, point.y);
    intervals.push(
      located
        ? { inside: true, elevation: located.elevation, tri: located.triangleIndex }
        : { inside: false, elevation: NaN, tri: -1 },
    );
  }

  const segments: SectionSample[][] = [];
  let current: SectionSample[] = [];
  const diagnostics: string[] = [];
  const endSegment = (): void => {
    if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  };
  const push = (sample: SectionSample): void => {
    if (!Number.isFinite(sample.x) || !Number.isFinite(sample.y) || !Number.isFinite(sample.elevation)) return;
    current.push(sample);
  };
  const emitPoint = (t: number, eventKind?: ProfileSampleEventKind): void => {
    const offset = minOffset + t * totalWidth;
    const point = at(offset);
    const located = locateProfileElevation(input.mesh, point.x, point.y);
    if (!located) return;
    push({
      offset,
      x: point.x,
      y: point.y,
      elevation: located.elevation,
      surfaceTriangleIndex: located.triangleIndex,
      ...(eventKind != null ? { eventKind } : {}),
    });
  };

  if (intervals[0]?.inside) emitPoint(0);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const left = intervals[index]!;
    const right = intervals[index + 1]!;
    const offset = minOffset + event.t * totalWidth;
    const point = at(offset);
    if (left.inside && right.inside) {
      const zLeft = planeElevationAt(input.mesh, left.tri, point.x, point.y);
      const zRight = planeElevationAt(input.mesh, right.tri, point.x, point.y);
      if (zLeft != null && zRight != null && Math.abs(zLeft - zRight) <= PLANE_AGREEMENT_EPS) {
        push({
          offset,
          x: point.x,
          y: point.y,
          elevation: (zLeft + zRight) / 2,
          surfaceTriangleIndex: left.tri,
          eventKind: event.vertex ? 'vertex' : 'edge-crossing',
        });
      } else if (zLeft != null && zRight != null) {
        push({ offset, x: point.x, y: point.y, elevation: zLeft, surfaceTriangleIndex: left.tri, eventKind: 'plane-break' });
        endSegment();
        diagnostics.push(`plane-break at offset ${offset}`);
        push({ offset, x: point.x, y: point.y, elevation: zRight, surfaceTriangleIndex: right.tri, eventKind: 'plane-break' });
      } else {
        endSegment();
        emitPoint(event.t, event.vertex ? 'vertex' : 'edge-crossing');
      }
    } else if (left.inside && !right.inside) {
      const beyond = intervals[index + 2];
      emitPoint(event.t, beyond?.inside ? 'void-exit' : 'boundary-exit');
      endSegment();
    } else if (!left.inside && right.inside) {
      endSegment();
      const before = index > 0 ? intervals[index - 1] : undefined;
      emitPoint(event.t, before?.inside ? 'void-entry' : 'boundary-entry');
    }
  }
  if (intervals[intervals.length - 1]?.inside) emitPoint(1);
  else endSegment();
  endSegment();

  let minElevation: number | null = null;
  let maxElevation: number | null = null;
  let coveredWidth = 0;
  for (const samples of segments) {
    if (samples.length === 0) continue;
    coveredWidth += Math.max(0, samples[samples.length - 1]!.offset - samples[0]!.offset);
    for (const sample of samples) {
      if (minElevation == null || sample.elevation < minElevation) minElevation = sample.elevation;
      if (maxElevation == null || sample.elevation > maxElevation) maxElevation = sample.elevation;
    }
  }
  return {
    ok: true,
    section: {
      ...(input.lineId != null ? { lineId: input.lineId } : {}),
      rawStation: input.rawStation,
      center: { ...input.center },
      direction: { ...direction },
      leftWidth: input.leftWidth,
      rightWidth: input.rightWidth,
      segments: segments.map((samples) => ({ samples })),
      minElevation,
      maxElevation,
      coveredWidth,
      gapWidth: Math.max(0, totalWidth - coveredWidth),
      diagnostics,
    },
  };
};
