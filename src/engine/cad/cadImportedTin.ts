import { buildSurfaceGrid } from './cadSurfaceInterpolation';
import { computeSurfaceFaceStats } from './surfaceAnalysis';
import { describeEditForRevision } from './cadSurfaceEditDescribe';
import { fnv1a } from './cadRevisionHash';
import { buildTinTopology } from './tin/tinTopology';
import type { CadSurfaceGrid, CadSurfaceSourcePoint } from './cadSurfaces';
import type { CadSurfaceEdit, ImportedTinPayload } from './cadTypes';
import type { TinAdjacency, TinEdgeKinds } from './tin/tinTypes';

/**
 * Phase 18L — imported-TIN materialization (engine only).
 *
 * An ImportedTinDefinition carries explicit file topology, so the mesh is
 * rebuilt WITHOUT Delaunay: vertices map 1:1 to source points, faces map
 * 1:1 to retained triangles. Adjacency/edge-flags/grid/stats derive through
 * the same contracts as native builds (so contours/elevation/slope/
 * profiles/volumes/sample-lines work unchanged), but the domain is exactly
 * the imported faces — never a convex hull — and outside-faces queries
 * return null via the face-indexed grid.
 */

export interface MaterializedImportedTin {
  points: CadSurfaceSourcePoint[];
  triangles: Array<[number, number, number]>;
  adjacency: TinAdjacency[];
  edgeKinds: TinEdgeKinds[];
  grid: CadSurfaceGrid;
}

/** Fail-closed payload check (re-run on reopen — no trust in stored arrays). */
export const validateImportedTinPayload = (payload: ImportedTinPayload): string | null => {
  const { vertices, faces } = payload;
  if (!Array.isArray(vertices) || vertices.length % 3 !== 0 || vertices.length < 9) {
    return 'imported TIN needs ≥3 [x,y,z] vertices.';
  }
  if (vertices.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return 'imported TIN vertices must be finite numbers.';
  }
  if (!Array.isArray(faces) || faces.length % 3 !== 0 || faces.length === 0) {
    return 'imported TIN needs ≥1 [a,b,c] face.';
  }
  const count = vertices.length / 3;
  for (let i = 0; i < faces.length; i += 3) {
    const [a, b, c] = [faces[i] as number, faces[i + 1] as number, faces[i + 2] as number];
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
      return `imported TIN face #${i / 3 + 1} has non-integer indices.`;
    }
    if (a < 0 || b < 0 || c < 0 || a >= count || b >= count || c >= count) {
      return `imported TIN face #${i / 3 + 1} references missing vertex.`;
    }
    if (a === b || b === c || c === a) {
      return `imported TIN face #${i / 3 + 1} is degenerate.`;
    }
    const ax = vertices[a * 3] as number;
    const ay = vertices[a * 3 + 1] as number;
    const bx = vertices[b * 3] as number;
    const by = vertices[b * 3 + 1] as number;
    const cx = vertices[c * 3] as number;
    const cy = vertices[c * 3 + 1] as number;
    if (!((bx - ax) * (cy - ay) - (cx - ax) * (by - ay) > 0)) {
      return `imported TIN face #${i / 3 + 1} is not CCW / has zero XY area.`;
    }
  }
  return null;
};

/** Content revision: vertices + faces + provenance (never entity state). Phase 18S adds the edit stack. */
export const importedTinRevision = (
  surfaceId: string,
  payload: ImportedTinPayload,
  edits?: CadSurfaceEdit[],
): string => {
  const parts = [
    `id:${surfaceId}`,
    `v:${payload.vertices.join(',')}`,
    `f:${payload.faces.join(',')}`,
    `prov:${payload.provenance.format}|${payload.provenance.fileName}|${payload.provenance.surfaceName}|${payload.provenance.sourceId ?? ''}`,
    `edits:${(edits ?? []).map(describeEditForRevision).join('|')}`,
  ];
  return `srev1:imported:${fnv1a(parts.join('#'))}`;
};

/**
 * Materialize the validated mesh. Returns null on invalid payload (caller
 * maps to blocked/FAILED — never a partial mesh). No Delaunay, no hull:
 * every imported face is retained exactly once.
 */
export const materializeImportedTin = (
  surfaceId: string,
  payload: ImportedTinPayload,
): (MaterializedImportedTin & { stats: ReturnType<typeof computeSurfaceFaceStats> }) | null => {
  if (validateImportedTinPayload(payload) != null) return null;
  const points: CadSurfaceSourcePoint[] = [];
  for (let i = 0; i < payload.vertices.length; i += 3) {
    points.push({
      entityId: `${surfaceId}:v${i / 3}`,
      x: payload.vertices[i] as number,
      y: payload.vertices[i + 1] as number,
      z: payload.vertices[i + 2] as number,
    });
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i < payload.faces.length; i += 3) {
    triangles.push([payload.faces[i] as number, payload.faces[i + 1] as number, payload.faces[i + 2] as number]);
  }
  // No constrained edges on the import path (topology already encodes
  // breaklines/boundaries/voids as faces) — all flags stay FREE and the
  // exterior is simply adjacency -1.
  const { adjacency, edgeKinds } = buildTinTopology(
    triangles.map(([a, b, c]) => ({ a, b, c })),
    new Map(),
  );
  return {
    points,
    triangles,
    adjacency,
    edgeKinds,
    grid: buildSurfaceGrid(points, triangles),
    stats: computeSurfaceFaceStats(points, triangles),
  };
};
