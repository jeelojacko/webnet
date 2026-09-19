import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadBlockSnapshot } from './cadShellTypes';

/**
 * Phase 18N — workspace-side block facts for the Block Manager, Toolspace
 * Blocks node, and insert flows. Pure; counts precomputed once per
 * snapshot so shell renderers never import engine modules.
 */
export const buildCadBlockSnapshot = (
  project: CadProject,
  selectedEntityIds: readonly string[],
  insertPick: CadBlockSnapshot['insertPick'],
): CadBlockSnapshot => {
  const definitions = [...(project.blockDefinitions ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const referenceCounts: Record<string, number> = {};
  const selected = new Set(selectedEntityIds);
  const selectedBlockReferenceIds: string[] = [];
  for (const entity of project.entities) {
    if (entity.type !== 'block-reference') continue;
    referenceCounts[entity.blockDefinitionId] = (referenceCounts[entity.blockDefinitionId] ?? 0) + 1;
    if (selected.has(entity.id)) selectedBlockReferenceIds.push(entity.id);
  }
  const markerUseCounts: Record<string, number> = {};
  for (const style of project.pointStyles ?? []) {
    if (style.markerBlockDefinitionId) {
      markerUseCounts[style.markerBlockDefinitionId] =
        (markerUseCounts[style.markerBlockDefinitionId] ?? 0) + 1;
    }
  }
  return {
    definitions,
    referenceCounts,
    markerUseCounts,
    selectedBlockReferenceIds,
    insertPick,
  };
};
