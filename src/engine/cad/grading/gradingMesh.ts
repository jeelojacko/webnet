/**
 * Phase 20B — deterministic grading strip mesh and area/statistics helpers.
 *
 * Numeric only: source and daylight XYZ arrays, identical length and order.
 * No imports from sibling grading modules; zero-width detection uses the
 * shared Phase 18I `zeroDelta` policy.
 */
import { zeroDelta } from '../surfaces/volume/zero';

export interface MeshPoint {
  x: number;
  y: number;
  z: number;
}

export interface GradingStripMesh {
  /** Flat XYZ triplets (deduplicated shared strip vertices). */
  points: number[];
  /** Flat CCW (viewed from +Z) triangle index triplets. */
  triangles: number[];
  /** Strip cells dropped because both boundary pairs were already tied. */
  skippedZeroWidth: number;
}

export type GradingStripMeshResult =
  | ({ ok: true } & GradingStripMesh)
  | { ok: false; code: 'ALREADY_TIED'; skippedZeroWidth: number };

export interface TieStats {
  min: number;
  max: number;
  mean: number;
}

/** Source and daylight pair already coincide in plan and elevation. */
export const isZeroWidthPair = (source: MeshPoint, daylight: MeshPoint): boolean =>
  Math.abs(source.x - daylight.x) <= zeroDelta(source.x, daylight.x) &&
  Math.abs(source.y - daylight.y) <= zeroDelta(source.y, daylight.y) &&
  Math.abs(source.z - daylight.z) <= zeroDelta(source.z, daylight.z);

const signedPlanArea2 = (
  points: number[],
  a: number,
  b: number,
  c: number,
): number =>
  (points[b * 3] - points[a * 3]) * (points[c * 3 + 1] - points[a * 3 + 1]) -
  (points[c * 3] - points[a * 3]) * (points[b * 3 + 1] - points[a * 3 + 1]);

/** Append a triangle with CCW plan winding; zero-plan-area faces are dropped. */
const pushTriangle = (
  triangles: number[],
  points: number[],
  a: number,
  b: number,
  c: number,
): void => {
  const area2 = signedPlanArea2(points, a, b, c);
  if (Math.abs(area2) <= zeroDelta(area2, 0)) return;
  if (area2 > 0) triangles.push(a, b, c);
  else triangles.push(a, c, b);
};

/** Exact-XYZ vertex dedupe so adjacent strip cells share edge vertices. */
class StripPointIndex {
  readonly points: number[] = [];

  private readonly indexByKey = new Map<string, number>();

  addKeyed(key: string, p: MeshPoint): number {
    const existing = this.indexByKey.get(key);
    if (existing !== undefined) return existing;
    const index = this.points.length / 3;
    this.points.push(p.x, p.y, p.z);
    this.indexByKey.set(key, index);
    return index;
  }

  add(p: MeshPoint): number {
    return this.addKeyed(`${p.x}|${p.y}|${p.z}`, p);
  }
}

/**
 * Deterministic strip triangulation between a source polyline and its daylight
 * polyline. Cells whose two boundary pairs are already tied contribute no
 * triangles; when the whole course is tied the result signals `ALREADY_TIED`.
 */
export const buildGradingStripMesh = (
  source: MeshPoint[],
  daylight: MeshPoint[],
): GradingStripMeshResult => {
  const count = Math.min(source.length, daylight.length);
  const index = new StripPointIndex();
  const triangles: number[] = [];
  let skippedZeroWidth = 0;
  const tiedAt = (station: number): boolean =>
    station >= 0 && station < count && isZeroWidthPair(source[station]!, daylight[station]!);
  // A single-point tie between two positive-width cells (CUT→TIED→FILL) is a
  // vertex pinch for one shared index: the two strips meet only at the tied
  // station. Give the two adjacent cells distinct copies so each side traces
  // its own simple boundary cycle; the tied plan point is then the ordinary
  // measure-zero cross-cycle touch the topology validator adjudicates. Tied
  // RUNS (>1 station) are unchanged: their zero-width cells already separate
  // the regions, so the shared run stations carry no pinch.
  const isSingleTiedHinge = (station: number): boolean =>
    station > 0 && station + 1 < count && tiedAt(station) && !tiedAt(station - 1) && !tiedAt(station + 1);
  const addCorner = (p: MeshPoint, station: number, side: 'before' | 'after'): number =>
    isSingleTiedHinge(station)
      ? index.addKeyed(`tied:${station}:${side}:${p.x}|${p.y}|${p.z}`, p)
      : index.add(p);
  for (let i = 0; i + 1 < count; i += 1) {
    const corners: MeshPoint[] = [source[i], source[i + 1], daylight[i + 1], daylight[i]];
    const before = triangles.length;
    const a = addCorner(corners[0], i, 'after');
    const b = addCorner(corners[1], i + 1, 'before');
    const c = addCorner(corners[2], i + 1, 'before');
    const d = addCorner(corners[3], i, 'after');
    pushTriangle(triangles, index.points, a, b, c);
    pushTriangle(triangles, index.points, a, c, d);
    if (triangles.length === before) skippedZeroWidth += 1;
  }
  if (triangles.length === 0) {
    return { ok: false, code: 'ALREADY_TIED', skippedZeroWidth };
  }
  return { ok: true, points: index.points, triangles, skippedZeroWidth };
};

const trianglePlanArea = (
  points: number[],
  a: number,
  b: number,
  c: number,
): number => Math.abs(signedPlanArea2(points, a, b, c)) / 2;

const triangle3dArea = (
  points: number[],
  a: number,
  b: number,
  c: number,
): number => {
  const ux = points[b * 3] - points[a * 3];
  const uy = points[b * 3 + 1] - points[a * 3 + 1];
  const uz = points[b * 3 + 2] - points[a * 3 + 2];
  const vx = points[c * 3] - points[a * 3];
  const vy = points[c * 3 + 1] - points[a * 3 + 1];
  const vz = points[c * 3 + 2] - points[a * 3 + 2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;
  return Math.sqrt(cx * cx + cy * cy + cz * cz) / 2;
};

const sumTriangles = (
  points: number[],
  triangles: number[],
  triangleArea: (_points: number[], _a: number, _b: number, _c: number) => number,
): number => {
  let sum = 0;
  for (let i = 0; i + 2 < triangles.length; i += 3) {
    sum += triangleArea(points, triangles[i], triangles[i + 1], triangles[i + 2]);
  }
  return sum;
};

/** Exact sum of triangle plan areas. */
export const meshPlanArea = (points: number[], triangles: number[]): number =>
  sumTriangles(points, triangles, trianglePlanArea);

/** Exact sum of triangle surface areas in 3D. */
export const mesh3dArea = (points: number[], triangles: number[]): number =>
  sumTriangles(points, triangles, triangle3dArea);

/** Min/max/mean of polyline tie distances (zeros for an empty input). */
export const tieStats = (distances: number[]): TieStats => {
  if (distances.length === 0) return { min: 0, max: 0, mean: 0 };
  let min = distances[0];
  let max = distances[0];
  let sum = 0;
  for (const distance of distances) {
    if (distance < min) min = distance;
    if (distance > max) max = distance;
    sum += distance;
  }
  return { min, max, mean: sum / distances.length };
};
