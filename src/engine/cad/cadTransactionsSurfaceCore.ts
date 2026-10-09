import { isSurfaceLayerLocked } from './cadSurfaceTypes';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import { isNativeSurfaceDefinition } from './cadTypes';
import type {
  CadCommand,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadProject, CadSurface } from './cadTypes';

/**
 * STRUCT-195.1 surface transaction VALUE core.
 *
 * Leaf-only helpers shared by the Surface and Surface-Boundary command
 * modules. Extracted verbatim so the two modules no longer value-import
 * each other in a cycle: this module must never import a transaction
 * command module (Commands, Boundary, or the cadTransactions barrel).
 */

export const commitSurface = (
  key: CadCommand['key'],
  snapshot: CadWorkspaceSnapshot,
  nextProject: CadProject,
  label: string,
): CadCommandExecutionResult =>
  commitLayerProject(key, snapshot, nextProject, label);

/**
 * Native source-definition mutations: rejected on explicit-topology
 * definitions (imported or baked — topology is the stored payload, never
 * entity refs). Positive capability check: only native definitions may
 * mutate sources. 18S/T/V final-mesh edits (SURFACE_*_EDIT) stay allowed —
 * they are not listed here.
 */
const NATIVE_SOURCE_MUTATION_KEYS: ReadonlySet<CadCommand['key']> = new Set([
  'SURFACE_ADD_POINT_GROUP',
  'SURFACE_REMOVE_POINT_GROUP',
  'SURFACE_ADD_POINTS',
  'SURFACE_REMOVE_SOURCE',
  'SURFACE_ADD_BREAKLINE',
  'SURFACE_REMOVE_BREAKLINE',
  'SURFACE_RENAME_BREAKLINE',
  'SURFACE_BREAKLINE_INSERT_POINT',
  'SURFACE_BREAKLINE_REMOVE_POINT',
  'SURFACE_BREAKLINE_REVERSE',
  'SURFACE_BREAKLINE_REPLACE_CHAIN',
  'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN',
  'SURFACE_ADD_BOUNDARY',
  'SURFACE_REMOVE_BOUNDARY',
]);

/** Geometry edits clear the cached build; renames/binding leave it. */
export const editSurface = (
  snapshot: CadWorkspaceSnapshot,
  key: CadCommand['key'],
  surfaceId: string,
  label: string,
  mutate: (_surface: CadSurface) => CadSurface | null,
  geometry: boolean,
): CadCommandExecutionResult | null => {
  const surfaces = snapshot.project.surfaces ?? [];
  const surface = surfaces.find((entry) => entry.id === surfaceId);
  if (!surface) return null;
  if (isSurfaceLayerLocked(snapshot.project, surface)) return null;
  if (!isNativeSurfaceDefinition(surface.definition) && NATIVE_SOURCE_MUTATION_KEYS.has(key)) {
    return null;
  }
  const next = mutate({ ...surface });
  if (!next) return null;
  const touched: CadSurface =
    geometry && next.cachedRevision != null
      ? { ...next, cachedRevision: null, buildDiagnostic: undefined }
      : next;
  return commitSurface(key, snapshot, {
    ...snapshot.project,
    surfaces: surfaces.map((entry) => (entry.id === surfaceId ? touched : entry)),
  }, label);
};
