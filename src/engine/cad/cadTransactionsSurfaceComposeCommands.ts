import { createStableRuntimeId } from '../id';
import { bakedSurfaceDefinition, canonicalizeBakedTin } from './cadExplicitBake';
import { explicitTinTopologyDigest, makeWebnetComposeProvenance } from './cadImportedTin';
import { deriveSurfaceStatus } from './cadSurfaces';
import { isSurfaceLayerLocked } from './cadSurfaceTypes';
import { checkSurfaceEditRevision, commitSurface } from './cadTransactionsSurfaceCommands';
import type { CadCommand, CadCommandDefinition } from './cadTransactions.types';
import type { CadProject, CadSurface, ImportedTinPayload } from './cadTypes';

/**
 * Phase 18Y exact two-surface composition transactions (SURFCOMPOSE /
 * SURFCOMPOSEPASTE).
 *
 * The WORKER computes the composed explicit topology; these commands only
 * persist it. Both paths snapshot the precomputed, canonical payload into a
 * stored explicit TIN (never a recompute — undo/redo replay the stored
 * snapshot). Gates mirror 18X bake: CURRENT status required, expected
 * revisions re-read at commit (a source that moved while the worker ran is a
 * race discard), non-empty result, target layer lock blocks the in-place
 * path. One history entry each; the COMPOSE COPY path mutates NEITHER source.
 */

/** Same-source gate (COMPOSE COPY + PASTE both require two distinct ids). */
export const SURFACE_COMPOSE_SAME_SOURCE = 'Surface composition requires two different surfaces.';
/** Status gate message (UI surfaces this; a null result carries no text). */
export const SURFACE_COMPOSE_NOT_CURRENT = 'Rebuild the source Surfaces before composing.';
/** Stale-revision race gate: the worker result is discarded, never committed. */
export const SURFACE_COMPOSE_STALE_REVISION = 'Surface changed during composition — retry.';
/** Non-empty result gate. */
export const SURFACE_COMPOSE_EMPTY = 'Surface composition produced no triangles.';

type ComposeCopyCommand = Extract<CadCommand, { key: 'SURFCOMPOSE' }>;
type ComposePasteCommand = Extract<CadCommand, { key: 'SURFCOMPOSEPASTE' }>;

const findSurface = (project: CadProject, surfaceId: string): CadSurface | null =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId) ?? null;

/** Unique "<Base> + <Overlay> - Composite" name (suffix only on collision). */
const uniqueComposedSurfaceName = (
  project: CadProject,
  baseName: string,
  overlayName: string,
): string => {
  const taken = new Set((project.surfaces ?? []).map((entry) => entry.name));
  const base = `${baseName} + ${overlayName} - Composite`;
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
};

const composeProvenanceOptions = (
  base: CadSurface,
  overlay: CadSurface,
  baseRevision: string,
  overlayRevision: string,
) => ({
  baseSurfaceId: base.id,
  baseSurfaceName: base.name,
  baseRevision,
  overlaySurfaceId: overlay.id,
  overlaySurfaceName: overlay.name,
  overlayRevision,
});

/**
 * Canonicalize the worker's composed topology into a stored explicit payload.
 * The `resultDigest` is the topology digest of the canonical payload (never a
 * function of provenance), so it namespaces the composition revision. Null =
 * reject (empty/non-triangulated result); inputs are never mutated.
 */
const createComposedPayload = (
  vertices: readonly number[],
  faces: readonly number[],
  base: CadSurface,
  overlay: CadSurface,
  baseRevision: string,
  overlayRevision: string,
): ImportedTinPayload | null => {
  if (!Array.isArray(vertices) || !Array.isArray(faces) || faces.length < 3) return null;
  const canonical = canonicalizeBakedTin(vertices, faces);
  if (canonical.faces.length === 0) return null;
  const options = composeProvenanceOptions(base, overlay, baseRevision, overlayRevision);
  const resultDigest = explicitTinTopologyDigest({
    vertices: canonical.vertices,
    faces: canonical.faces,
    provenance: makeWebnetComposeProvenance(options),
  });
  return {
    vertices: canonical.vertices,
    faces: canonical.faces,
    provenance: makeWebnetComposeProvenance({ ...options, resultDigest }),
  };
};

interface ResolvedSources {
  base: CadSurface;
  overlay: CadSurface;
  baseRevision: string;
  overlayRevision: string;
}

/**
 * Race + status gates shared by both commands. Null = reject (fail-closed):
 * same id, missing surface, not CURRENT, or a source revision that moved
 * while the worker ran (`checkSurfaceEditRevision` re-read).
 *
 * `sessionCurrent` is the session TIN-cache assertion (see SURFBAKE): the
 * project never persists `cachedRevision`, so the persisted derivation alone
 * reads UNBUILT in-session. Absent = fail-closed.
 */
const resolveComposeSources = (
  project: CadProject,
  baseId: string,
  baseExpectedRevision: string,
  overlayId: string,
  overlayExpectedRevision: string,
  sessionCurrent: boolean,
): ResolvedSources | null => {
  if (baseId === overlayId) return null;
  const base = findSurface(project, baseId);
  const overlay = findSurface(project, overlayId);
  if (!base || !overlay) return null;
  if (
    !sessionCurrent &&
    (deriveSurfaceStatus(project, base) !== 'CURRENT' ||
      deriveSurfaceStatus(project, overlay) !== 'CURRENT')
  ) {
    return null;
  }
  if (
    checkSurfaceEditRevision(project, baseId, baseExpectedRevision) !== 'ok' ||
    checkSurfaceEditRevision(project, overlayId, overlayExpectedRevision) !== 'ok'
  ) {
    return null;
  }
  return { base, overlay, baseRevision: baseExpectedRevision, overlayRevision: overlayExpectedRevision };
};

/**
 * COMPOSE COPY: append a brand-new explicit-tin surface carrying the composed
 * topology. Neither source is mutated (both stay byte-identical); layer/style
 * come from Base. Normal creation rules — no source-layer lock gate.
 */
const surfaceComposeCopyCommand: CadCommandDefinition<ComposeCopyCommand> = {
  key: 'SURFCOMPOSE',
  execute: (snapshot, command) => {
    const sources = resolveComposeSources(
      snapshot.project,
      command.baseSurfaceId,
      command.baseExpectedRevision,
      command.overlaySurfaceId,
      command.overlayExpectedRevision,
      command.sessionCurrent === true,
    );
    if (!sources) return null;
    const payload = createComposedPayload(
      command.vertices,
      command.faces,
      sources.base,
      sources.overlay,
      sources.baseRevision,
      sources.overlayRevision,
    );
    if (!payload) return null;
    const copy: CadSurface = {
      id: createStableRuntimeId('cad-surface'),
      name: uniqueComposedSurfaceName(snapshot.project, sources.base.name, sources.overlay.name),
      definition: bakedSurfaceDefinition(payload),
      ...(sources.base.styleId != null ? { styleId: sources.base.styleId } : {}),
      ...(sources.base.layerId != null ? { layerId: sources.base.layerId } : {}),
      cachedRevision: null,
    };
    return commitSurface(
      'SURFCOMPOSE',
      snapshot,
      { ...snapshot.project, surfaces: [...(snapshot.project.surfaces ?? []), copy] },
      `SURFCOMPOSE (${copy.name})`,
    );
  },
};

/**
 * PASTE IN PLACE: Target keeps id/name/layer/style; its definition is
 * replaced by the composed explicit topology (old point authority,
 * breaklines, boundaries, and the edit stack are flattened into the payload).
 * Source is byte-identical. The target layer lock blocks (destructive edit).
 * Dependents go stale through the new source revision. One undo entry; redo
 * restores the snapshot stored here (no recompute).
 */
const surfaceComposePasteCommand: CadCommandDefinition<ComposePasteCommand> = {
  key: 'SURFCOMPOSEPASTE',
  execute: (snapshot, command) => {
    const sources = resolveComposeSources(
      snapshot.project,
      command.targetSurfaceId,
      command.targetExpectedRevision,
      command.sourceSurfaceId,
      command.sourceExpectedRevision,
      command.sessionCurrent === true,
    );
    if (!sources) return null;
    if (isSurfaceLayerLocked(snapshot.project, sources.base)) return null;
    const payload = createComposedPayload(
      command.vertices,
      command.faces,
      sources.base,
      sources.overlay,
      sources.baseRevision,
      sources.overlayRevision,
    );
    if (!payload) return null;
    const next: CadSurface = {
      ...sources.base,
      definition: bakedSurfaceDefinition(payload),
      cachedRevision: null,
      buildDiagnostic: undefined,
    };
    return commitSurface(
      'SURFCOMPOSEPASTE',
      snapshot,
      {
        ...snapshot.project,
        surfaces: (snapshot.project.surfaces ?? []).map((entry) =>
          entry.id === sources.base.id ? next : entry,
        ),
      },
      `SURFCOMPOSEPASTE (${sources.base.name})`,
    );
  },
};

export const surfaceComposeCommandDefinitions = {
  SURFCOMPOSE: surfaceComposeCopyCommand,
  SURFCOMPOSEPASTE: surfaceComposePasteCommand,
};
