import { makeWebnetBakeProvenance } from './cadImportedTin';
import type { CadSurface, CadSurfaceDefinition, ImportedTinPayload } from './cadTypes';

/**
 * Phase 18X — explicit bake canonicalization + payload construction.
 *
 * A bake snapshots the FINAL post-replay mesh into the stored explicit
 * topology (no Delaunay, no adjacency/grid/stats persisted). Inputs are
 * never mutated; every returned array is a fresh deep copy.
 */

export interface CanonicalExplicitTin {
  vertices: number[];
  faces: number[];
}

/** Structural mesh subset: accepts a CadSurfaceBuildResult without importing it. */
export interface BakedTinMesh {
  points: ReadonlyArray<{ x: number; y: number; z: number }>;
  triangles: ReadonlyArray<readonly [number, number, number]>;
}

export interface BakeProvenanceSource {
  sourceRevision: string;
  sourceSourceKind?: string;
}

/** Signed double XY area: > 0 = CCW. */
const signedDoubleAreaXy = (
  vertices: readonly number[],
  a: number,
  b: number,
  c: number,
): number =>
  (vertices[b * 3]! - vertices[a * 3]!) * (vertices[c * 3 + 1]! - vertices[a * 3 + 1]!) -
  (vertices[c * 3]! - vertices[a * 3]!) * (vertices[b * 3 + 1]! - vertices[a * 3 + 1]!);

/**
 * Compact unreferenced vertices, apply a deterministic ascending-index
 * remap, preserve input face order, and enforce CCW winding by swapping
 * the 2nd/3rd index when the signed XY area is negative. Never mutates
 * `vertices`/`faces`; both outputs are deep copies.
 */
export const canonicalizeBakedTin = (
  vertices: readonly number[],
  faces: readonly number[],
): CanonicalExplicitTin => {
  const referenced = new Set<number>();
  for (const index of faces) {
    if (Number.isInteger(index) && index >= 0) referenced.add(index);
  }
  const remap = new Map<number, number>();
  const outVertices: number[] = [];
  for (const oldIndex of [...referenced].sort((a, b) => a - b)) {
    remap.set(oldIndex, outVertices.length / 3);
    outVertices.push(
      vertices[oldIndex * 3] ?? 0,
      vertices[oldIndex * 3 + 1] ?? 0,
      vertices[oldIndex * 3 + 2] ?? 0,
    );
  }
  const outFaces: number[] = [];
  for (let i = 0; i + 2 < faces.length; i += 3) {
    const a = remap.get(faces[i]!);
    const b = remap.get(faces[i + 1]!);
    const c = remap.get(faces[i + 2]!);
    if (a === undefined || b === undefined || c === undefined) continue;
    if (signedDoubleAreaXy(outVertices, a, b, c) < 0) outFaces.push(a, c, b);
    else outFaces.push(a, b, c);
  }
  return { vertices: outVertices, faces: outFaces };
};

/**
 * Turn a final build mesh into a stored explicit payload: exact doubles
 * (no rounding), no adjacency/grid/stats, canonicalized topology, and a
 * strict `kind:'webnet-bake'` provenance (never `format:'LandXML'`, never
 * the pre-bake definition).
 */
export const createBakedPayloadFromMesh = (
  mesh: BakedTinMesh,
  surface: Pick<CadSurface, 'id' | 'name'>,
  provenance: BakeProvenanceSource,
): ImportedTinPayload => {
  const vertices: number[] = [];
  for (const point of mesh.points) vertices.push(point.x, point.y, point.z);
  const faces: number[] = [];
  for (const triangle of mesh.triangles) faces.push(triangle[0], triangle[1], triangle[2]);
  const canonical = canonicalizeBakedTin(vertices, faces);
  return {
    vertices: canonical.vertices,
    faces: canonical.faces,
    provenance: makeWebnetBakeProvenance({
      sourceSurfaceId: surface.id,
      sourceSurfaceName: surface.name,
      sourceRevision: provenance.sourceRevision,
      ...(provenance.sourceSourceKind != null ? { sourceSourceKind: provenance.sourceSourceKind } : {}),
    }),
  };
};

/**
 * Explicit definition for a baked surface: stored topology only. Point
 * authority, breaklines, boundaries, build options, and the edit stack are
 * all cleared (geometry is already flattened into the payload).
 */
export const bakedSurfaceDefinition = (payload: ImportedTinPayload): CadSurfaceDefinition => ({
  sourceKind: 'explicit-tin',
  pointSource: { kind: 'points', pointEntityIds: [] },
  importedTin: payload,
});
