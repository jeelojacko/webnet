import type { CadEntity, CadEntityId, CadProject, CadSurface, CadSurfaceBoundary } from './cadTypes';
import { boundaryRingOf, collectSources, dedupeRing } from './cadSurfaceRevision';
import { pointInRing } from './tin/tinPredicates';
import { validateRingRelations } from './tin/tinBoundaries';
import type { CadSurfaceReasonCode } from './cadSurfaces';

/**
 * Phase 18W: pure boundary-candidate seam.
 *
 * Boundary rings live in referenced CAD entities (never duplicated into
 * `CadSurfaceDefinition`), so every create / replace / make-independent /
 * vertex-edit path must be able to ask one question: "would this ring make
 * the surface definition invalid?" This module answers it by reusing the
 * EXACT engine seams (`dedupeRing`, `validateRingRelations`, the
 * void-centroid-inside-outer rule) — no weaker UI validator, no epsilon
 * snap, no second vocabulary. Fail-closed (`null` = clean).
 */

export type BoundaryRingPoint = { x: number; y: number };

export interface BoundaryCandidateRings {
  outers: BoundaryRingPoint[][];
  voids: BoundaryRingPoint[][];
}

/** Direct vertex edits of a Parcel-backed source are never allowed. */
export const PARCEL_REFERENCE_ONLY = 'PARCEL_REFERENCE_ONLY' as const;

export type BoundarySourceProblem = CadSurfaceReasonCode | typeof PARCEL_REFERENCE_ONLY;

const RING_ENTITY_TYPES = new Set(['polyline', 'polygon', 'parcel']);

export const isBoundaryRingEntity = (entity: CadEntity | undefined): boolean =>
  entity != null && RING_ENTITY_TYPES.has(entity.type);

/** Deduped candidate ring from an entity's XY vertices (null = not a ring type). */
export const candidateRingOfEntity = (entity: CadEntity): BoundaryRingPoint[] | null => {
  const ring = boundaryRingOf(entity);
  return ring ? dedupeRing(ring) : null;
};

/** Deduped candidate ring from raw XY vertices (Z is not accepted). */
export const candidateRingOfVertices = (
  vertices: ReadonlyArray<BoundaryRingPoint>,
): BoundaryRingPoint[] =>
  dedupeRing(
    vertices
      .filter((vertex) => Number.isFinite(vertex.x) && Number.isFinite(vertex.y))
      .map((vertex) => ({ x: vertex.x, y: vertex.y })),
  );

/**
 * Definition-ordered rings; entries whose source matches `override` take the
 * candidate ring instead of the live entity ring. Entries with a missing
 * entity or a `< 3` ring are skipped exactly like source collection does.
 */
export const boundaryRingsFromDefinition = (
  project: CadProject,
  surface: CadSurface,
  override?: { sourceEntityId: CadEntityId; ring: BoundaryRingPoint[] },
): BoundaryCandidateRings => {
  const outers: BoundaryRingPoint[][] = [];
  const voids: BoundaryRingPoint[][] = [];
  for (const entry of surface.definition.boundaries ?? []) {
    let ring: BoundaryRingPoint[] | null;
    if (override != null && entry.sourceEntityId === override.sourceEntityId) {
      ring = override.ring;
    } else {
      const entity = project.entities.find((candidate) => candidate.id === entry.sourceEntityId);
      ring = entity ? candidateRingOfEntity(entity) : null;
    }
    if (!ring || ring.length < 3) continue;
    if (entry.type === 'outer') outers.push(ring);
    else voids.push(ring);
  }
  return { outers, voids };
};

/** Rings after attaching a new source: outer replaces, void appends. */
export const boundaryRingsWithCandidate = (
  project: CadProject,
  surface: CadSurface,
  kind: CadSurfaceBoundary['type'],
  candidateRing: BoundaryRingPoint[],
): BoundaryCandidateRings => {
  const rings = boundaryRingsFromDefinition(project, surface);
  return kind === 'outer'
    ? { outers: [candidateRing], voids: rings.voids }
    : { outers: rings.outers, voids: [...rings.voids, candidateRing] };
};

/** World-XY breakline chains currently collected for the surface. */
export const surfaceBreaklineChains = (
  project: CadProject,
  surface: CadSurface,
): BoundaryRingPoint[][] => {
  const collected = collectSources(project, surface);
  return collected.breaklines.map((chain) =>
    chain.map((index) => {
      const point = collected.points[index];
      return { x: point.x, y: point.y };
    }),
  );
};

/**
 * First-problem-only candidate validation over the existing ring-relation
 * seam plus the void-centroid-inside-outer rule (mirrors source collection).
 */
export const validateBoundaryCandidate = (
  rings: BoundaryCandidateRings,
  breaklineChains: BoundaryRingPoint[][],
): CadSurfaceReasonCode | null => {
  if (rings.outers.some((ring) => ring.length < 3)) return 'SURFACE_BOUNDARY_INVALID';
  if (rings.voids.some((ring) => ring.length < 3)) return 'SURFACE_VOID_INVALID';
  const problem = validateRingRelations(rings.outers, rings.voids, breaklineChains);
  if (problem === 'outer-invalid') return 'SURFACE_BOUNDARY_INVALID';
  if (problem === 'void-invalid') return 'SURFACE_VOID_INVALID';
  if (problem === 'breakline-crossing') return 'SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX';
  for (const ring of rings.voids) {
    const centroid = {
      x: ring.reduce((sum, point) => sum + point.x, 0) / ring.length,
      y: ring.reduce((sum, point) => sum + point.y, 0) / ring.length,
    };
    if (
      rings.outers.length > 0 &&
      !rings.outers.every((outer) => pointInRing(centroid.x, centroid.y, outer))
    ) {
      return 'SURFACE_VOID_INVALID';
    }
  }
  return null;
};

/** Attach-style candidate check (new outer replaces, new void appends). */
export const validateSurfaceBoundaryCandidate = (
  project: CadProject,
  surface: CadSurface,
  kind: CadSurfaceBoundary['type'],
  candidateRing: BoundaryRingPoint[],
): CadSurfaceReasonCode | null =>
  validateBoundaryCandidate(
    boundaryRingsWithCandidate(project, surface, kind, candidateRing),
    surfaceBreaklineChains(project, surface),
  );

/**
 * Preflight for a boundary-source vertex edit: the UI/caller runs this
 * BEFORE committing the generic `EDIT_ENTITY polyline-vertex` transaction
 * and aborts on a non-null problem. Parcel-backed sources are reference-only.
 */
export const validateBoundaryVertexEdit = (
  project: CadProject,
  surfaceId: string,
  sourceEntityId: CadEntityId,
  candidateVertices: ReadonlyArray<BoundaryRingPoint>,
): BoundarySourceProblem | null => {
  const surface = (project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return 'SURFACE_REFERENCE_MISSING';
  const entity = project.entities.find((entry) => entry.id === sourceEntityId);
  if (!entity) return 'SURFACE_REFERENCE_MISSING';
  if (entity.type === 'parcel') return PARCEL_REFERENCE_ONLY;
  if (!isBoundaryRingEntity(entity)) return 'SURFACE_BOUNDARY_INVALID';
  const entries = (surface.definition.boundaries ?? []).filter(
    (entry) => entry.sourceEntityId === sourceEntityId,
  );
  if (entries.length === 0) return 'SURFACE_REFERENCE_MISSING';
  if (candidateVertices.some((vertex) => !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y))) {
    return 'SURFACE_BOUNDARY_INVALID';
  }
  const ring = candidateRingOfVertices(candidateVertices);
  if (ring.length < 3) {
    return entries.some((entry) => entry.type === 'outer')
      ? 'SURFACE_BOUNDARY_INVALID'
      : 'SURFACE_VOID_INVALID';
  }
  return validateBoundaryCandidate(
    boundaryRingsFromDefinition(project, surface, { sourceEntityId, ring }),
    surfaceBreaklineChains(project, surface),
  );
};

/**
 * Same preflight across every surface that references the entity — the shared
 * choke point behind `EDIT_ENTITY polyline-vertex` and grip vertex moves.
 * Parcels are out of scope here (generic CAD parcel editing stays allowed).
 */
export const validateBoundaryEntityVertexEdit = (
  project: CadProject,
  sourceEntityId: CadEntityId,
  candidateVertices: ReadonlyArray<BoundaryRingPoint>,
): BoundarySourceProblem | null => {
  const entity = project.entities.find((entry) => entry.id === sourceEntityId);
  if (!entity || (entity.type !== 'polyline' && entity.type !== 'polygon')) return null;
  const surfaces = (project.surfaces ?? []).filter((surface) =>
    (surface.definition.boundaries ?? []).some((entry) => entry.sourceEntityId === sourceEntityId),
  );
  if (surfaces.length === 0) return null;
  if (candidateVertices.some((vertex) => !Number.isFinite(vertex.x) || !Number.isFinite(vertex.y))) {
    return 'SURFACE_BOUNDARY_INVALID';
  }
  for (const surface of surfaces) {
    const problem = validateBoundaryVertexEdit(
      project,
      surface.id,
      sourceEntityId,
      candidateVertices,
    );
    if (problem) return problem;
  }
  return null;
};
