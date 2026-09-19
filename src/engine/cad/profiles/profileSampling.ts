import {
  cadNormalizeAngleDeg,
  cadPointOnCircle,
  cadSegmentIntersection,
  cadSignedSweepDeg,
} from '../cadGeometry';
import { alignmentElementLength } from '../cadAlignmentElements';
import {
  candidateTriangles,
  locateProfileElevation,
  planeElevationAt,
} from './profileMeshLocate';
import type { CadAlignmentElement } from '../cadTypes';
import type {
  ProfileExtractionMesh,
  ProfileSample,
  ProfileSampleEventKind,
} from './profileExtraction';

/**
 * Phase 18J alignment walkers (engine only, pure).
 *
 * LINE portions are topology-exact (TIN edge-crossing events; Z linear in
 * chainage within one triangle). ARC portions are topology-aware adaptive
 * subdivisions (display-approximation only). Shared walker/segment helpers
 * live here so extraction stays an orchestrator.
 */

const PLANE_AGREEMENT_EPS = 1e-9;
/** Raw-station dedup epsilon (relative): shared-edge double reports merge. */
const RAW_EPS_REL = 1e-9;
const MAX_ARC_DEPTH = 12;

export interface Walker {
  mesh: ProfileExtractionMesh;
  displayOf: (_raw: number) => number | null;
  segments: ProfileSample[][];
  current: ProfileSample[];
  diagnostics: string[];
}

const pushSample = (walker: Walker, sample: ProfileSample): void => {
  if (
    !Number.isFinite(sample.x) ||
    !Number.isFinite(sample.y) ||
    !Number.isFinite(sample.elevation)
  ) {
    return;
  }
  walker.current.push(sample);
};

export const endSegment = (walker: Walker): void => {
  if (walker.current.length > 0) {
    walker.segments.push(walker.current);
    walker.current = [];
  }
};

const makeSample = (
  walker: Walker,
  raw: number,
  x: number,
  y: number,
  elevation: number,
  elementIndex: number,
  triangleIndex: number | undefined,
  eventKind?: ProfileSampleEventKind,
): ProfileSample => ({
  rawChainage: raw,
  displayStation: walker.displayOf(raw),
  x,
  y,
  elevation,
  alignmentElementIndex: elementIndex,
  ...(triangleIndex != null ? { surfaceTriangleIndex: triangleIndex } : {}),
  ...(eventKind != null ? { eventKind } : {}),
});

export const pointOnElement = (
  element: CadAlignmentElement,
  distanceAlong: number,
): { x: number; y: number } => {
  if (element.kind === 'line') {
    const length = alignmentElementLength(element);
    if (length <= 1e-12) return { ...element.start };
    const ratio = Math.max(0, Math.min(1, distanceAlong / length));
    return {
      x: element.start.x + (element.end.x - element.start.x) * ratio,
      y: element.start.y + (element.end.y - element.start.y) * ratio,
    };
  }
  const sweepDeg = cadSignedSweepDeg(element.startAngleDeg, element.endAngleDeg);
  const direction = sweepDeg >= 0 ? 1 : -1;
  const deltaDeg = (distanceAlong / element.radius) * (180 / Math.PI) * direction;
  return cadPointOnCircle(
    element.center,
    element.radius,
    cadNormalizeAngleDeg(element.startAngleDeg + deltaDeg),
  );
};

interface LineEvent {
  t: number;
  vertex: boolean;
}

const lineEvents = (
  mesh: ProfileExtractionMesh,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  raw0: number,
  raw1: number,
): LineEvent[] => {
  const length = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (!(length > 1e-12)) return [];
  const candidates = candidateTriangles(
    mesh,
    Math.min(p0.x, p1.x),
    Math.min(p0.y, p1.y),
    Math.max(p0.x, p1.x),
    Math.max(p0.y, p1.y),
  );
  const found: LineEvent[] = [];
  for (const tri of candidates) {
    const t = mesh.triangles[tri];
    if (!t) continue;
    const corners = [mesh.points[t[0]], mesh.points[t[1]], mesh.points[t[2]]];
    if (corners.some((corner) => !corner)) continue;
    for (let edge = 0; edge < 3; edge += 1) {
      const a = corners[edge]!;
      const b = corners[(edge + 1) % 3]!;
      const hit = cadSegmentIntersection(p0, p1, a, b);
      if (!hit) continue;
      const dot = (hit.x - p0.x) * (p1.x - p0.x) + (hit.y - p0.y) * (p1.y - p0.y);
      const tt = dot / (length * length);
      if (!(tt > 1e-12) || !(tt < 1 - 1e-12)) continue;
      const onA = Math.hypot(hit.x - a.x, hit.y - a.y) <= 1e-9;
      const onB = Math.hypot(hit.x - b.x, hit.y - b.y) <= 1e-9;
      found.push({ t: tt, vertex: onA || onB });
    }
  }
  found.sort((a, b) => a.t - b.t);
  const deduped: LineEvent[] = [];
  for (const event of found) {
    const last = deduped[deduped.length - 1];
    const rawTol = RAW_EPS_REL * Math.max(1, Math.abs(raw0), Math.abs(raw1));
    if (last && Math.abs(event.t - last.t) * length <= rawTol) {
      last.vertex = last.vertex || event.vertex;
      continue;
    }
    deduped.push({ ...event });
  }
  return deduped;
};

export const walkLine = (
  walker: Walker,
  element: CadAlignmentElement,
  elementIndex: number,
  raw0: number,
  ends: { x: number; y: number }[],
): void => {
  const mesh = walker.mesh;
  const p0 = ends[0]!;
  const p1 = ends[1]!;
  const length = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (!(length > 1e-12)) return;
  const raw1 = raw0 + length;
  const events = lineEvents(mesh, p0, p1, raw0, raw1);
  const bounds = [0, ...events.map((event) => event.t), 1];
  interface Interval {
    inside: boolean;
    elevation: number;
    tri: number;
  }
  const intervals: Interval[] = [];
  for (let index = 0; index + 1 < bounds.length; index += 1) {
    const mid = (bounds[index]! + bounds[index + 1]!) / 2;
    const point = pointOnElement(element, mid * length);
    const located = locateProfileElevation(mesh, point.x, point.y);
    intervals.push(
      located
        ? { inside: true, elevation: located.elevation, tri: located.triangleIndex }
        : { inside: false, elevation: NaN, tri: -1 },
    );
  }
  const emitPoint = (t: number, eventKind?: ProfileSampleEventKind): void => {
    const raw = raw0 + t * length;
    const point = pointOnElement(element, t * length);
    const located = locateProfileElevation(mesh, point.x, point.y);
    if (!located) return;
    pushSample(
      walker,
      makeSample(
        walker,
        raw,
        point.x,
        point.y,
        located.elevation,
        elementIndex,
        located.triangleIndex,
        eventKind,
      ),
    );
  };
  // Opening endpoint.
  if (intervals[0]?.inside) emitPoint(0);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const left = intervals[index]!;
    const right = intervals[index + 1]!;
    const raw = raw0 + event.t * length;
    const point = pointOnElement(element, event.t * length);
    if (left.inside && right.inside) {
      const zLeft = planeElevationAt(mesh, left.tri, point.x, point.y);
      const zRight = planeElevationAt(mesh, right.tri, point.x, point.y);
      if (zLeft != null && zRight != null && Math.abs(zLeft - zRight) <= PLANE_AGREEMENT_EPS) {
        pushSample(
          walker,
          makeSample(
            walker,
            raw,
            point.x,
            point.y,
            (zLeft + zRight) / 2,
            elementIndex,
            left.tri,
            event.vertex ? 'vertex' : 'edge-crossing',
          ),
        );
      } else if (zLeft != null && zRight != null) {
        // Along-edge plane disagreement: break, never sawtooth.
        pushSample(
          walker,
          makeSample(walker, raw, point.x, point.y, zLeft, elementIndex, left.tri, 'plane-break'),
        );
        endSegment(walker);
        walker.diagnostics.push(`plane-break at raw ${raw}`);
        pushSample(
          walker,
          makeSample(
            walker,
            raw,
            point.x,
            point.y,
            zRight,
            elementIndex,
            right.tri,
            'plane-break',
          ),
        );
      } else {
        endSegment(walker);
        emitPoint(event.t, event.vertex ? 'vertex' : 'edge-crossing');
      }
    } else if (left.inside && !right.inside) {
      // Gap bounded on both sides = void; trailing gap = outer boundary.
      const beyond = intervals[index + 2];
      emitPoint(event.t, beyond?.inside ? 'void-exit' : 'boundary-exit');
      endSegment(walker);
    } else if (!left.inside && right.inside) {
      endSegment(walker);
      // Gap preceded by cover = void; leading gap = outer boundary.
      const before = index > 0 ? intervals[index - 1] : undefined;
      emitPoint(event.t, before?.inside ? 'void-entry' : 'boundary-entry');
    }
  }
  if (intervals[intervals.length - 1]?.inside) emitPoint(1);
  else endSegment(walker);
};

export const walkArc = (
  walker: Walker,
  element: Extract<CadAlignmentElement, { kind: 'arc' }>,
  elementIndex: number,
  raw0: number,
  tolerance: number,
): void => {
  const mesh = walker.mesh;
  const length = alignmentElementLength(element);
  if (!(length > 1e-12)) return;
  interface Node {
    distance: number;
    x: number;
    y: number;
    elevation: number | null;
    tri: number;
  }
  const at = (distance: number): Node => {
    const point = pointOnElement(element, distance);
    const located = locateProfileElevation(mesh, point.x, point.y);
    return {
      distance,
      x: point.x,
      y: point.y,
      elevation: located?.elevation ?? null,
      tri: located?.triangleIndex ?? -1,
    };
  };
  const emit = (node: Node): void => {
    if (node.elevation == null) return;
    pushSample(
      walker,
      makeSample(
        walker,
        raw0 + node.distance,
        node.x,
        node.y,
        node.elevation,
        elementIndex,
        node.tri >= 0 ? node.tri : undefined,
      ),
    );
  };
  const start = at(0);
  const end = at(length);
  // Recursive adaptive subdivision; gaps split segments. The chord check
  // covers the midpoint AND both quarter points: a lone midpoint check
  // can pass by oscillatory cancellation while sub-interval deviations
  // stay large (inflection inside a wide interval).
  const subdivide = (left: Node, right: Node, depth: number): void => {
    if (left.elevation == null || right.elevation == null) {
      // Gap side: the finite side (if any) was already emitted by the caller.
      return;
    }
    if (right.distance - left.distance <= 1e-9 * Math.max(1, length)) return;
    const mid = at((left.distance + right.distance) / 2);
    if (mid.elevation == null) {
      endSegment(walker);
      walker.diagnostics.push(`void gap at raw ${raw0 + mid.distance}`);
      return;
    }
    const span = right.distance - left.distance;
    const first = at(left.distance + span / 4);
    const third = at(left.distance + (3 * span) / 4);
    const lerpAt = (distance: number): number => {
      const ratio = (distance - left.distance) / span;
      return left.elevation! + (right.elevation! - left.elevation!) * ratio;
    };
    const deviations = [mid, first, third]
      .filter((node) => node.elevation != null)
      .map((node) => Math.abs(node.elevation! - lerpAt(node.distance)));
    const forced = first.elevation == null || third.elevation == null;
    const worst = deviations.length > 0 ? Math.max(...deviations) : Infinity;
    if (depth >= MAX_ARC_DEPTH || (!forced && worst <= tolerance)) {
      emit(mid);
      return;
    }
    subdivide(left, mid, depth + 1);
    emit(mid);
    subdivide(mid, right, depth + 1);
  };
  if (start.elevation == null) {
    endSegment(walker);
  } else {
    emit(start);
  }
  if (start.elevation != null && end.elevation != null) {
    subdivide(start, end, 0);
    emit(end);
  } else if (start.elevation == null && end.elevation != null) {
    endSegment(walker);
    emit(end);
  } else if (start.elevation != null) {
    // End in a void: subdivide toward the gap, then terminate.
    subdivide(start, end, 0);
    endSegment(walker);
  }
};
