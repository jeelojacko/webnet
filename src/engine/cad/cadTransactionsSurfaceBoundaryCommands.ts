import { createStableRuntimeId } from '../id';
import {
  type BoundaryCandidateRings,
  type BoundaryRingPoint,
  boundaryRingsFromDefinition,
  candidateRingOfEntity,
  candidateRingOfVertices,
  isBoundaryRingEntity,
  surfaceBreaklineChains,
  validateBoundaryCandidate,
  validateSurfaceBoundaryCandidate,
} from './cadBoundaryCandidateValidation';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import { isSurfaceLayerLocked, resolveSurfaceLayerId } from './cadSurfaceTypes';
import { commitSurface, editSurface } from './cadTransactionsSurfaceCommands';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type {
  CadEntityId,
  CadLayerId,
  CadPolygonEntity,
  CadProject,
  CadSurface,
  CadSurfaceBoundary,
} from './cadTypes';
import { isNativeSurfaceDefinition } from './cadTypes';

/**
 * Phase 18W — boundary source transactions (extracted verbatim from
 * cadTransactionsSurfaceCommands.ts; behavior-identical split).
 * Boundary entries stay entity-backed refs; parcel sources are copy-only.
 */

const RING_ENTITY_TYPES = new Set(['polyline', 'polygon', 'parcel']);

/** Attach a boundary source: outer replaces the existing outer, void appends. */
const withBoundarySource = (
  boundaries: CadSurfaceBoundary[],
  kind: CadSurfaceBoundary['type'],
  sourceEntityId: CadEntityId,
): CadSurfaceBoundary[] => [
  ...(kind === 'outer' ? boundaries.filter((entry) => entry.type !== 'outer') : boundaries),
  { type: kind, sourceEntityId },
];

type AddBoundaryCommand = Extract<CadCommand, { key: 'SURFACE_ADD_BOUNDARY' }>;

const surfaceAddBoundaryCommand: CadCommandDefinition<AddBoundaryCommand> = {
  key: 'SURFACE_ADD_BOUNDARY',
  execute: (snapshot, command) => {
    const entity = snapshot.project.entities.find((entry) => entry.id === command.sourceEntityId);
    if (!entity || !RING_ENTITY_TYPES.has(entity.type)) return null;
    return editSurface(snapshot, 'SURFACE_ADD_BOUNDARY', command.surfaceId, 'SURFACE_ADD_BOUNDARY',
      (surface) => ({
        ...surface,
        definition: {
          ...surface.definition,
          boundaries: withBoundarySource(
            surface.definition.boundaries ?? [],
            command.kind,
            command.sourceEntityId,
          ),
        },
      }), true);
  },
};

type RemoveBoundaryCommand = Extract<CadCommand, { key: 'SURFACE_REMOVE_BOUNDARY' }>;

const surfaceRemoveBoundaryCommand: CadCommandDefinition<RemoveBoundaryCommand> = {
  key: 'SURFACE_REMOVE_BOUNDARY',
  execute: (snapshot, command) =>
    editSurface(snapshot, 'SURFACE_REMOVE_BOUNDARY', command.surfaceId, 'SURFACE_REMOVE_BOUNDARY',
      (surface) => {
        const boundaries = surface.definition.boundaries ?? [];
        const kept = boundaries.filter((entry) =>
          entry.type !== command.kind ||
          (command.sourceEntityId != null && entry.sourceEntityId !== command.sourceEntityId),
        );
        if (kept.length === boundaries.length) return null;
        return {
          ...surface,
          definition: { ...surface.definition, boundaries: kept },
        };
      }, true),
};

// ---------------------------------------------------------------------------
// Phase 18W: boundary source transactions (boundary stays entity-backed)
// ---------------------------------------------------------------------------

/** Native, unlocked surface eligible for a boundary-definition change. */
const boundarySourceSurface = (
  snapshot: CadWorkspaceSnapshot,
  surfaceId: string,
): CadSurface | null => {
  const surface = (snapshot.project.surfaces ?? []).find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  if (isSurfaceLayerLocked(snapshot.project, surface)) return null;
  // Phase 18X: positive capability — explicit-topology definitions (imported
  // or baked) never accept boundary-source mutations.
  if (!isNativeSurfaceDefinition(surface.definition)) return null;
  return surface;
};

const withBoundaryEntries = (
  surface: CadSurface,
  boundaries: CadSurfaceBoundary[],
): CadSurface => ({
  ...surface,
  definition: { ...surface.definition, boundaries },
  cachedRevision: null,
  buildDiagnostic: undefined,
});

/** One commit for entity + definition so source changes stay a single undo. */
const commitBoundarySourceChange = (
  key: CadCommand['key'],
  snapshot: CadWorkspaceSnapshot,
  surfaceId: string,
  nextSurface: CadSurface,
  addedEntities: CadPolygonEntity[],
  label: string,
): CadCommandExecutionResult =>
  commitSurface(key, snapshot, {
    ...snapshot.project,
    entities: addedEntities.length > 0
      ? [...snapshot.project.entities, ...addedEntities]
      : snapshot.project.entities,
    surfaces: (snapshot.project.surfaces ?? []).map((entry) =>
      entry.id === surfaceId ? nextSurface : entry,
    ),
  }, label);

const boundaryRingEntityName = (surface: CadSurface, kind: CadSurfaceBoundary['type']): string =>
  `${surface.name} ${kind === 'outer' ? 'Outer' : 'Void'} Boundary`;

/** Ordinary polygon copy of a ring — boundary sources are never point-chains. */
const createBoundaryPolygonEntity = (
  ring: ReadonlyArray<{ x: number; y: number }>,
  layerId: CadLayerId,
  name: string,
): CadPolygonEntity => ({
  id: createStableRuntimeId('cad-polygon'),
  type: 'polygon',
  layerId,
  visible: true,
  locked: false,
  vertices: ring.map((point) => ({ x: point.x, y: point.y })),
  vertexLabels: ring.map(() => ''),
  metadata: { entityName: name },
});

type CreateBoundarySourceCommand = Extract<CadCommand, { key: 'SURFACE_CREATE_BOUNDARY_SOURCE' }>;

/**
 * Post-state rings when a void source is swapped: outers unchanged, kept
 * voids resolved in definition order, candidate appended. Same seam as
 * collection (missing/short rings skipped), no weaker validator.
 */
const voidReplacementRings = (
  project: CadProject,
  surface: CadSurface,
  replaceVoidSourceEntityId: CadEntityId,
  candidateRing: BoundaryRingPoint[],
): BoundaryCandidateRings | null => {
  const entries = surface.definition.boundaries ?? [];
  if (!entries.some((entry) => entry.type === 'void' && entry.sourceEntityId === replaceVoidSourceEntityId)) {
    return null;
  }
  const outers = boundaryRingsFromDefinition(project, surface).outers;
  const voids: BoundaryRingPoint[][] = [];
  for (const entry of entries) {
    if (entry.type !== 'void' || entry.sourceEntityId === replaceVoidSourceEntityId) continue;
    const entity = project.entities.find((candidate) => candidate.id === entry.sourceEntityId);
    const ring = entity ? candidateRingOfEntity(entity) : null;
    if (!ring || ring.length < 3) continue;
    voids.push(ring);
  }
  voids.push(candidateRing);
  return { outers, voids };
};

const surfaceCreateBoundarySourceCommand: CadCommandDefinition<CreateBoundarySourceCommand> = {
  key: 'SURFACE_CREATE_BOUNDARY_SOURCE',
  execute: (snapshot, command) => {
    const surface = boundarySourceSurface(snapshot, command.surfaceId);
    if (!surface) return null;
    const ring = candidateRingOfVertices(command.vertices);
    if (ring.length < 3) return null;
    const replaceVoidId = command.kind === 'void' ? command.replaceVoidSourceEntityId : undefined;
    // replaceVoidSourceEntityId is void-only; outer replacement stays withBoundarySource.
    if (command.kind !== 'void' && command.replaceVoidSourceEntityId != null) return null;
    if (replaceVoidId != null) {
      const rings = voidReplacementRings(snapshot.project, surface, replaceVoidId, ring);
      if (!rings) return null;
      if (validateBoundaryCandidate(rings, surfaceBreaklineChains(snapshot.project, surface)) !== null) {
        return null;
      }
    } else if (validateSurfaceBoundaryCandidate(snapshot.project, surface, command.kind, ring) !== null) {
      return null;
    }
    const label = command.sourceLabel?.trim();
    const polygon = createBoundaryPolygonEntity(
      ring,
      resolveSurfaceLayerId(snapshot.project, surface.layerId),
      label || boundaryRingEntityName(surface, command.kind),
    );
    const kept = replaceVoidId != null
      ? (surface.definition.boundaries ?? []).filter(
        (entry) => !(entry.type === 'void' && entry.sourceEntityId === replaceVoidId),
      )
      : (surface.definition.boundaries ?? []);
    return commitBoundarySourceChange(
      'SURFACE_CREATE_BOUNDARY_SOURCE',
      snapshot,
      surface.id,
      withBoundaryEntries(
        surface,
        withBoundarySource(kept, command.kind, polygon.id),
      ),
      [polygon],
      `SURFACE_CREATE_BOUNDARY_SOURCE (${command.kind})`,
    );
  },
};

type ReplaceBoundarySourceCommand = Extract<CadCommand, { key: 'SURFACE_REPLACE_BOUNDARY_SOURCE' }>;

const surfaceReplaceBoundarySourceCommand: CadCommandDefinition<ReplaceBoundarySourceCommand> = {
  key: 'SURFACE_REPLACE_BOUNDARY_SOURCE',
  execute: (snapshot, command) => {
    const surface = boundarySourceSurface(snapshot, command.surfaceId);
    if (!surface) return null;
    const entity = snapshot.project.entities.find((entry) => entry.id === command.sourceEntityId);
    if (!entity || !isBoundaryRingEntity(entity)) return null;
    const entries = (surface.definition.boundaries ?? []).filter(
      (entry) => entry.type === command.kind,
    );
    // Identity is (type, sourceEntityId): only an unambiguous single entry rebinds.
    if (entries.length !== 1 || entries[0]!.sourceEntityId === command.sourceEntityId) return null;
    const ring = candidateRingOfEntity(entity);
    if (!ring || ring.length < 3) return null;
    const rings = boundaryRingsFromDefinition(snapshot.project, surface, {
      sourceEntityId: entries[0]!.sourceEntityId,
      ring,
    });
    if (validateBoundaryCandidate(rings, surfaceBreaklineChains(snapshot.project, surface)) !== null) {
      return null;
    }
    const boundaries = (surface.definition.boundaries ?? []).map((entry) =>
      entry.type === command.kind
        ? { type: command.kind, sourceEntityId: command.sourceEntityId }
        : entry,
    );
    return commitBoundarySourceChange(
      'SURFACE_REPLACE_BOUNDARY_SOURCE',
      snapshot,
      surface.id,
      withBoundaryEntries(surface, boundaries),
      [],
      `SURFACE_REPLACE_BOUNDARY_SOURCE (${command.kind})`,
    );
  },
};

type MakeBoundaryIndependentCommand = Extract<CadCommand, { key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT' }>;

const surfaceMakeBoundaryIndependentCommand: CadCommandDefinition<MakeBoundaryIndependentCommand> = {
  key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT',
  execute: (snapshot, command) => {
    const surface = boundarySourceSurface(snapshot, command.surfaceId);
    if (!surface) return null;
    const ofKind = (surface.definition.boundaries ?? []).filter(
      (entry) => entry.type === command.kind,
    );
    const matched = command.sourceEntityId == null
      ? ofKind
      : ofKind.filter((entry) => entry.sourceEntityId === command.sourceEntityId);
    if (matched.length === 0) return null;
    if (command.sourceEntityId == null && ofKind.length !== 1) return null;
    const oldSourceEntityId = matched[0]!.sourceEntityId;
    const source = snapshot.project.entities.find((entry) => entry.id === oldSourceEntityId);
    if (!source || !isBoundaryRingEntity(source)) return null;
    // Parcel sources are copy sources only — the entity is never mutated.
    const ring = candidateRingOfEntity(source);
    if (!ring || ring.length < 3) return null;
    const rings = boundaryRingsFromDefinition(snapshot.project, surface, {
      sourceEntityId: oldSourceEntityId,
      ring,
    });
    if (validateBoundaryCandidate(rings, surfaceBreaklineChains(snapshot.project, surface)) !== null) {
      return null;
    }
    const polygon = createBoundaryPolygonEntity(
      ring,
      source.layerId,
      `${getCadEntityDisplayLabel(source)} (${command.kind} boundary copy)`,
    );
    const boundaries = (surface.definition.boundaries ?? []).map((entry) =>
      entry.type === command.kind && entry.sourceEntityId === oldSourceEntityId
        ? { type: command.kind, sourceEntityId: polygon.id }
        : entry,
    );
    return commitBoundarySourceChange(
      'SURFACE_MAKE_BOUNDARY_INDEPENDENT',
      snapshot,
      surface.id,
      withBoundaryEntries(surface, boundaries),
      [polygon],
      `SURFACE_MAKE_BOUNDARY_INDEPENDENT (${command.kind})`,
    );
  },
};

export const surfaceBoundaryCommandDefinitions = {
  SURFACE_ADD_BOUNDARY: surfaceAddBoundaryCommand,
  SURFACE_REMOVE_BOUNDARY: surfaceRemoveBoundaryCommand,
  SURFACE_CREATE_BOUNDARY_SOURCE: surfaceCreateBoundarySourceCommand,
  SURFACE_REPLACE_BOUNDARY_SOURCE: surfaceReplaceBoundarySourceCommand,
  SURFACE_MAKE_BOUNDARY_INDEPENDENT: surfaceMakeBoundaryIndependentCommand,
};
