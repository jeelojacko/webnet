import { createStableRuntimeId } from '../id';
import { bakedSurfaceDefinition } from './cadExplicitBake';
import { tinProvenanceKind } from './cadImportedTin';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
} from './cadSurfaces';
import { deriveSurfaceStatus } from './cadSurfaces';
import { isSurfaceLayerLocked, resolveSurfaceLayerId } from './cadSurfaceTypes';
import { backfillCadSurfaceStyles } from './cadSurfaceStyles';
import { checkSurfaceEditRevision, commitSurface } from './cadTransactionsSurfaceCommands';
import { resolveBakePayload } from './cadTransactionsSurfaceBakeCommands';
import { surfaceComposeCommandDefinitions } from './cadTransactionsSurfaceComposeCommands';
import { volumeCommandDefinitions } from './cadTransactionsVolumeCommands';
import { composeSurfaceMeshes, type ComposeSourceMesh } from './surfaceCompose';
import type { CadCommand, CadCommandDefinition } from './cadTransactions.types';
import type { CadProject, CadSurface, CadSurfacePurpose, CadVolumeSurface } from './cadTypes';

/**
 * Phase 20D Wave-1A design surface workflow (ENGINE ONLY — no UI).
 *
 * SURFPURPOSE (metadata-only role label), DESIGNSURFACE (18X bake-copy path
 * with purpose='design'), DESIGNAPPLY (18Z paste-core reuse with an
 * existing-ground guard), DESIGNVOLUME (find-or-create 18I shortcut).
 * No new composition math (only composeSurfaceMeshes), no volume math.
 */

/** DESIGNAPPLY against an existing-ground target is blocked (copy first). */
export const DESIGN_APPLY_EG_BLOCKED =
  'Apply targets the Existing Ground surface. Create a Design Copy first, then apply the patch to the copy.';
/** Raw grading-shell overlay diagnosis: the shell has no pad interior. */
export const DESIGN_APPLY_RAW_SHELL_GUIDANCE =
  'The grading surface contains slopes only (no pad interior). Build a Design Patch, then apply the patch.';

const findSurface = (project: CadProject, surfaceId: string): CadSurface | null =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId) ?? null;

const isKnownPurpose = (value: unknown): value is CadSurfacePurpose =>
  value === 'existing-ground' ||
  value === 'design' ||
  value === 'design-patch' ||
  value === 'reference' ||
  value === 'other';

// ---------------------------------------------------------------------------
// SURFPURPOSE — explicit metadata-only role label (one history entry, no
// rebuild, no dependent invalidation; revision untouched by construction).
// ---------------------------------------------------------------------------

type SurfPurposeCommand = Extract<CadCommand, { key: 'SURFPURPOSE' }>;

const surfPurposeCommand: CadCommandDefinition<SurfPurposeCommand> = {
  key: 'SURFPURPOSE',
  execute: (snapshot, command) => {
    const surface = findSurface(snapshot.project, command.surfaceId);
    if (!surface || isSurfaceLayerLocked(snapshot.project, surface)) return null;
    const purpose = command.purpose ?? undefined;
    if (purpose !== undefined && !isKnownPurpose(purpose)) return null;
    if (surface.purpose === purpose) return null;
    const next: CadSurface = { ...surface };
    if (purpose === undefined) {
      delete next.purpose;
    } else {
      next.purpose = purpose;
    }
    return commitSurface('SURFPURPOSE', snapshot, {
      ...snapshot.project,
      surfaces: (snapshot.project.surfaces ?? []).map((entry) =>
        entry.id === surface.id ? next : entry),
    }, `SURFPURPOSE (${surface.name})`);
  },
};

// ---------------------------------------------------------------------------
// DESIGNSURFACE — 18X bake-copy path verbatim: CURRENT final mesh via
// buildCadSurface, webnet-bake provenance, brand-new id, purpose='design'.
// No live dependency; the source stays byte-identical.
// ---------------------------------------------------------------------------

type DesignSurfaceCommand = Extract<CadCommand, { key: 'DESIGNSURFACE' }>;

const designSurfaceCommand: CadCommandDefinition<DesignSurfaceCommand> = {
  key: 'DESIGNSURFACE',
  execute: (snapshot, command) => {
    const source = findSurface(snapshot.project, command.sourceSurfaceId);
    if (!source) return null;
    const name = command.name?.trim();
    if (!name) return null;
    if ((snapshot.project.surfaces ?? []).some((entry) => entry.name === name)) return null;
    if (command.styleId != null) {
      const styles = backfillCadSurfaceStyles(snapshot.project.surfaceStyles);
      if (!styles.some((style) => style.id === command.styleId)) return null;
    }
    const payload = resolveBakePayload(
      snapshot.project,
      source,
      command.expectedRevision,
      command.sessionCurrent === true,
    );
    if (!payload) return null;
    const copy: CadSurface = {
      id: createStableRuntimeId('cad-surface'),
      name,
      definition: bakedSurfaceDefinition(payload),
      purpose: 'design',
      ...(command.styleId !== undefined
        ? (command.styleId !== null ? { styleId: command.styleId } : {})
        : (source.styleId != null ? { styleId: source.styleId } : {})),
      layerId: resolveSurfaceLayerId(snapshot.project, command.layerId ?? source.layerId),
      cachedRevision: null,
    };
    return commitSurface('DESIGNSURFACE', snapshot, {
      ...snapshot.project,
      surfaces: [...(snapshot.project.surfaces ?? []), copy],
    }, `DESIGNSURFACE (${copy.name})`);
  },
};

// ---------------------------------------------------------------------------
// DESIGNAPPLY — preflight (pure) + commit (18Z SURFCOMPOSEPASTE core reuse).
// ---------------------------------------------------------------------------

export type DesignApplyPreflight =
  | {
      disposition: 'EXACT';
      baseOnlyArea: number;
      overlayArea: number;
      overlapArea: number;
      resultArea: number;
      seamLength: number;
      maxSeamMismatch: number;
      outputVertexCount: number;
      outputTriangleCount: number;
      targetVertexCount: number;
      targetTriangleCount: number;
      patchVertexCount: number;
      patchTriangleCount: number;
    }
  | { disposition: 'BLOCKED'; reason: string };

interface ResolvedApplyMeshes {
  target: CadSurface;
  patch: CadSurface;
  targetMesh: ComposeSourceMesh;
  patchMesh: ComposeSourceMesh;
  targetRevision: string;
  patchRevision: string;
  targetVertexCount: number;
  targetTriangleCount: number;
  patchVertexCount: number;
  patchTriangleCount: number;
}

const toComposeMesh = (
  surface: CadSurface,
  revision: string,
  built: { points: Array<{ x: number; y: number; z: number }>; triangles: ReadonlyArray<readonly [number, number, number]> },
): ComposeSourceMesh => ({
  surfaceId: surface.id,
  surfaceName: surface.name,
  revision,
  points: built.points.map((point) => ({ x: point.x, y: point.y, z: point.z })),
  triangles: built.triangles.map(([a, b, c]) => [a, b, c] as [number, number, number]),
});

/** Shared fail-closed gates (EG guard first so the message stays specific). */
const resolveApplyMeshes = (
  project: CadProject,
  targetId: string,
  targetExpectedRevision: string,
  patchId: string,
  patchExpectedRevision: string,
  sessionCurrent: boolean,
): { meshes: ResolvedApplyMeshes } | { blocked: string } => {
  if (targetId === patchId) return { blocked: 'Apply requires two different surfaces.' };
  const target = findSurface(project, targetId);
  const patch = findSurface(project, patchId);
  if (!target || !patch) return { blocked: 'Apply surface not found.' };
  if (target.purpose === 'existing-ground') return { blocked: DESIGN_APPLY_EG_BLOCKED };
  if (isSurfaceLayerLocked(project, target)) return { blocked: 'The target surface layer is locked.' };
  if (!sessionCurrent) {
    if (deriveSurfaceStatus(project, target) !== 'CURRENT' || deriveSurfaceStatus(project, patch) !== 'CURRENT') {
      return { blocked: 'Rebuild the target and patch Surfaces before applying.' };
    }
  }
  if (
    checkSurfaceEditRevision(project, targetId, targetExpectedRevision) !== 'ok' ||
    checkSurfaceEditRevision(project, patchId, patchExpectedRevision) !== 'ok'
  ) {
    return { blocked: 'Surface changed during apply — retry.' };
  }
  const builtTarget = buildCadSurface(project, target);
  const builtPatch = buildCadSurface(project, patch);
  if (builtTarget.outcome !== 'ok' || builtTarget.triangles.length === 0) {
    return { blocked: 'The target surface has no triangles to apply onto.' };
  }
  if (builtPatch.outcome !== 'ok' || builtPatch.triangles.length === 0) {
    return { blocked: 'The patch surface has no triangles to apply.' };
  }
  return {
    meshes: {
      target,
      patch,
      targetMesh: toComposeMesh(target, targetExpectedRevision, builtTarget),
      patchMesh: toComposeMesh(patch, patchExpectedRevision, builtPatch),
      targetRevision: targetExpectedRevision,
      patchRevision: patchExpectedRevision,
      targetVertexCount: builtTarget.points.length,
      targetTriangleCount: builtTarget.triangles.length,
      patchVertexCount: builtPatch.points.length,
      patchTriangleCount: builtPatch.triangles.length,
    },
  };
};

/** Failure diagnosis: raw group-bake shells get patch guidance (no rule change). */
const describeApplyFailure = (
  patch: CadSurface,
  failure: { reason: string; maxMismatch?: number },
): string => {
  if (failure.reason === 'SURFACE_COMPOSE_SEAM_Z_MISMATCH') {
    const provenance = patch.definition.importedTin?.provenance;
    if (provenance && tinProvenanceKind(provenance) === 'webnet-grading-group-bake') {
      return DESIGN_APPLY_RAW_SHELL_GUIDANCE;
    }
    return 'The patch seam does not match the target surface (SEAM_Z_MISMATCH).';
  }
  return 'The patch cannot be applied to the target surface.';
};

/**
 * Pure apply preflight: CURRENT-final-mesh composition stats with an
 * EXACT/BLOCKED disposition. No project mutation, no history.
 */
export const preflightDesignApply = (
  project: CadProject,
  targetSurfaceId: string,
  patchSurfaceId: string,
  targetExpectedRevision?: string,
  patchExpectedRevision?: string,
  sessionCurrent = false,
): DesignApplyPreflight => {
  const target = findSurface(project, targetSurfaceId);
  const patch = findSurface(project, patchSurfaceId);
  if (!target || !patch) return { disposition: 'BLOCKED', reason: 'Apply surface not found.' };
  const resolved = resolveApplyMeshes(
    project,
    targetSurfaceId,
    targetExpectedRevision ?? computeCadSurfaceSourceRevision(project, target),
    patchSurfaceId,
    patchExpectedRevision ?? computeCadSurfaceSourceRevision(project, patch),
    sessionCurrent,
  );
  if ('blocked' in resolved) return { disposition: 'BLOCKED', reason: resolved.blocked };
  const { meshes } = resolved;
  const composed = composeSurfaceMeshes(meshes.targetMesh, meshes.patchMesh);
  if (!composed.ok) {
    return { disposition: 'BLOCKED', reason: describeApplyFailure(meshes.patch, composed) };
  }
  return {
    disposition: 'EXACT',
    baseOnlyArea: composed.diagnostics.baseOnlyArea,
    overlayArea: composed.diagnostics.overlayArea,
    overlapArea: composed.diagnostics.overlapArea,
    resultArea: composed.diagnostics.resultArea,
    seamLength: composed.diagnostics.seamLength,
    maxSeamMismatch: composed.diagnostics.maxSeamMismatch,
    outputVertexCount: composed.diagnostics.outputVertexCount,
    outputTriangleCount: composed.diagnostics.outputTriangleCount,
    targetVertexCount: meshes.targetVertexCount,
    targetTriangleCount: meshes.targetTriangleCount,
    patchVertexCount: meshes.patchVertexCount,
    patchTriangleCount: meshes.patchTriangleCount,
  };
};

type DesignApplyCommand = Extract<CadCommand, { key: 'DESIGNAPPLY' }>;

/**
 * Commit: same gates + the same compose, then the SURFCOMPOSEPASTE core
 * transaction (target keeps id/name/layer/style/purpose, definition becomes
 * the composed explicit TIN, patch byte-identical, one undo entry).
 */
const designApplyCommand: CadCommandDefinition<DesignApplyCommand> = {
  key: 'DESIGNAPPLY',
  execute: (snapshot, command) => {
    const resolved = resolveApplyMeshes(
      snapshot.project,
      command.targetSurfaceId,
      command.targetExpectedRevision,
      command.patchSurfaceId,
      command.patchExpectedRevision,
      command.sessionCurrent === true,
    );
    if ('blocked' in resolved) return null;
    const { meshes } = resolved;
    const composed = composeSurfaceMeshes(meshes.targetMesh, meshes.patchMesh);
    if (!composed.ok) return null;
    return surfaceComposeCommandDefinitions.SURFCOMPOSEPASTE.execute(snapshot, {
      key: 'SURFCOMPOSEPASTE',
      targetSurfaceId: command.targetSurfaceId,
      targetExpectedRevision: command.targetExpectedRevision,
      sourceSurfaceId: command.patchSurfaceId,
      sourceExpectedRevision: command.patchExpectedRevision,
      vertices: composed.vertices,
      faces: composed.faces,
      policy: 'overlay-coverage-wins',
      ...(command.sessionCurrent !== undefined ? { sessionCurrent: command.sessionCurrent } : {}),
    });
  },
};

// ---------------------------------------------------------------------------
// DESIGNVOLUME — find-or-create shortcut over ordinary 18I relationships.
// Calculation stays explicit via the existing volume service (no new math).
// ---------------------------------------------------------------------------

/** Find the ordinary volume tracking exactly (base, comparison). */
export const findDesignVolumeSurface = (
  project: CadProject,
  baseSurfaceId: string,
  comparisonSurfaceId: string,
): CadVolumeSurface | null =>
  (project.volumeSurfaces ?? []).find(
    (entry) => entry.baseSurfaceId === baseSurfaceId && entry.comparisonSurfaceId === comparisonSurfaceId,
  ) ?? null;

type DesignVolumeCommand = Extract<CadCommand, { key: 'DESIGNVOLUME' }>;

/**
 * Create the (base, comparison) relationship when untracked (one history
 * entry via the stock 18I create). Already tracked = no-op (null, no
 * history); callers resolve the id through findDesignVolumeSurface.
 */
const designVolumeCommand: CadCommandDefinition<DesignVolumeCommand> = {
  key: 'DESIGNVOLUME',
  execute: (snapshot, command) => {
    const surfaces = snapshot.project.surfaces ?? [];
    const base = surfaces.find((entry) => entry.id === command.baseSurfaceId);
    const comparison = surfaces.find((entry) => entry.id === command.comparisonSurfaceId);
    if (!base || !comparison || base.id === comparison.id) return null;
    if (findDesignVolumeSurface(snapshot.project, base.id, comparison.id)) return null;
    return volumeCommandDefinitions.VOLUME_SURFACE_CREATE.execute(snapshot, {
      key: 'VOLUME_SURFACE_CREATE',
      baseSurfaceId: base.id,
      comparisonSurfaceId: comparison.id,
      ...(command.name !== undefined ? { name: command.name } : {}),
      ...(command.layerId !== undefined ? { layerId: command.layerId } : {}),
      ...(command.styleId !== undefined ? { styleId: command.styleId } : {}),
    });
  },
};

export const designSurfaceCommandDefinitions = {
  SURFPURPOSE: surfPurposeCommand,
  DESIGNSURFACE: designSurfaceCommand,
  DESIGNAPPLY: designApplyCommand,
  DESIGNVOLUME: designVolumeCommand,
};
