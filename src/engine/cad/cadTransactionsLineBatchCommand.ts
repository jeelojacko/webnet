/**
 * CAD Draw Phase L1 — LINE_CREATE_BATCH transaction.
 *
 * One command = one history entry: every segment is validated before any
 * mutation, all created lines go on the current layer, and the created lines
 * become the selection. `createdBy` records the user-facing creation mode so
 * single-segment modes (bearing/azimuth/turn/deflection/point-chain/shots)
 * reuse the same law.
 */
import { createCadSelectionState } from './cadSelection';
import { appendCadProjectEntities } from './cadProjectState';
import { buildCadLineEntities } from './cadLineBatch';
import type { CadCommandDefinition } from './cadTransactions.types';

export const lineCreateBatchCommand: CadCommandDefinition<{
  key: 'LINE_CREATE_BATCH';
  segments: Array<{
    start: { x: number; y: number; label: string };
    end: { x: number; y: number; label: string };
  }>;
  /** User-facing creation mode recorded as metadata.createdBy. */
  createdBy: string;
}> = {
  key: 'LINE_CREATE_BATCH',
  execute: (snapshot, command) => {
    const createdBy = command.createdBy.trim() || 'LINE_CREATE_BATCH';
    const entities = buildCadLineEntities(snapshot.project, command.segments, createdBy);
    if (!entities || entities.length === 0) return null;
    const entityIds = entities.map((entity) => entity.id);
    const nextProject = appendCadProjectEntities(snapshot.project, entities);
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, entityIds),
      },
      commandState: {
        key: 'LINE_CREATE_BATCH',
        phase: 'committed',
        prompt: `LINE_CREATE_BATCH committed: ${entities.length} line${entities.length === 1 ? '' : 's'}.`,
      },
      transactionLabel: `LINE_CREATE_BATCH (${entities.length})`,
      addedEntityIds: entityIds,
      removedEntityIds: [],
    };
  },
};
