import { createStableRuntimeId } from '../id';
import { bakedSurfaceDefinition, createBakedPayloadFromMesh } from './cadExplicitBake';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
} from './cadSurfaces';
import { isSurfaceLayerLocked } from './cadSurfaceTypes';
import { checkSurfaceEditRevision, commitSurface } from './cadTransactionsSurfaceCommands';
import type { CadCommand, CadCommandDefinition } from './cadTransactions.types';
import type { CadProject, CadSurface } from './cadTypes';

/**
 * Phase 18X explicit bake transactions (SURFBAKE / SURFBAKECOPY).
 *
 * Both snapshot the FINAL post-replay mesh into a stored explicit TIN.
 * Gates: CURRENT status required, `expectedRevision` re-read at commit,
 * locked layer blocked. One history entry each; the source surface is
 * never mutated on the copy path.
 */

/** Status gate message (UI surfaces this; a null result carries no text). */
export const SURFACE_BAKE_NOT_CURRENT = 'Rebuild the Surface before baking.';
/** Stale-revision gate message (UI surfaces this). */
export const SURFACE_BAKE_STALE_REVISION = 'Surface changed — rebuild/retry Bake.';
/** In-place bake confirmation summary (flatten list, geometry preserved, Undo recovery). */
export const SURFACE_BAKE_WARNING_SUMMARY =
  'Baking replaces this surface with its final explicit TIN: point sources, breaklines, ' +
  'boundaries, and TIN edits are cleared, while the current mesh geometry is preserved ' +
  'exactly. Undo restores the pre-bake definition.';

type BakeCommand = Extract<CadCommand, { key: 'SURFBAKE' }>;
type BakeCopyCommand = Extract<CadCommand, { key: 'SURFBAKECOPY' }>;

const findSurface = (project: CadProject, surfaceId: string): CadSurface | null =>
  (project.surfaces ?? []).find((entry) => entry.id === surfaceId) ?? null;

/** Unique "<Source> - Baked" name (suffix only on collision). */
const uniqueBakedSurfaceName = (project: CadProject, sourceName: string): string => {
  const taken = new Set((project.surfaces ?? []).map((entry) => entry.name));
  const base = `${sourceName} - Baked`;
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base} (${index})`)) index += 1;
  return `${base} (${index})`;
};

/**
 * Resolve the CURRENT final mesh and stored payload. Null = reject
 * (fail-closed): not found, locked layer, not CURRENT, stale revision, or
 * a build that does not produce triangles.
 *
 * `sessionCurrent` is the caller's assertion that the session TIN cache holds
 * a fresh mesh at the current revision — the project never persists
 * `cachedRevision`, so the persisted-revision derivation alone reads UNBUILT
 * in-session. The UI sets it from `surfaceBakeCapability`; absent = fail-closed.
 */
const resolveBakePayload = (
  project: CadProject,
  surface: CadSurface,
  expectedRevision: string,
  sessionCurrent: boolean,
) => {
  if (isSurfaceLayerLocked(project, surface)) return null;
  if (!sessionCurrent && deriveSurfaceStatus(project, surface) !== 'CURRENT') return null;
  if (checkSurfaceEditRevision(project, surface.id, expectedRevision) !== 'ok') return null;
  const built = buildCadSurface(project, surface);
  if (built.outcome !== 'ok' || built.triangles.length === 0) return null;
  return createBakedPayloadFromMesh(
    { points: built.points, triangles: built.triangles },
    surface,
    {
      sourceRevision: computeCadSurfaceSourceRevision(project, surface),
      sourceSourceKind: surface.definition.sourceKind,
    },
  );
};

const surfaceBakeCommand: CadCommandDefinition<BakeCommand> = {
  key: 'SURFBAKE',
  execute: (snapshot, command) => {
    const surface = findSurface(snapshot.project, command.surfaceId);
    if (!surface) return null;
    const payload = resolveBakePayload(snapshot.project, surface, command.expectedRevision, command.sessionCurrent === true);
    if (!payload) return null;
    const next: CadSurface = {
      ...surface,
      definition: bakedSurfaceDefinition(payload),
      cachedRevision: null,
      buildDiagnostic: undefined,
    };
    return commitSurface('SURFBAKE', snapshot, {
      ...snapshot.project,
      surfaces: (snapshot.project.surfaces ?? []).map((entry) =>
        entry.id === surface.id ? next : entry),
    }, `SURFBAKE (${surface.name})`);
  },
};

const surfaceBakeCopyCommand: CadCommandDefinition<BakeCopyCommand> = {
  key: 'SURFBAKECOPY',
  execute: (snapshot, command) => {
    const surface = findSurface(snapshot.project, command.surfaceId);
    if (!surface) return null;
    const payload = resolveBakePayload(snapshot.project, surface, command.expectedRevision, command.sessionCurrent === true);
    if (!payload) return null;
    // Source stays byte-identical; the copy carries no edit stack and no
    // dependent surfaces (new id referenced by nothing).
    const copy: CadSurface = {
      id: createStableRuntimeId('cad-surface'),
      name: uniqueBakedSurfaceName(snapshot.project, surface.name),
      definition: bakedSurfaceDefinition(payload),
      ...(surface.styleId != null ? { styleId: surface.styleId } : {}),
      ...(surface.layerId != null ? { layerId: surface.layerId } : {}),
      cachedRevision: null,
    };
    return commitSurface('SURFBAKECOPY', snapshot, {
      ...snapshot.project,
      surfaces: [...(snapshot.project.surfaces ?? []), copy],
    }, `SURFBAKECOPY (${copy.name})`);
  },
};

export const surfaceBakeCommandDefinitions = {
  SURFBAKE: surfaceBakeCommand,
  SURFBAKECOPY: surfaceBakeCopyCommand,
};
