// Phase 18R — PROJECTTRANSFORM command wrapper.
//
// Whole-drawing scope (never selection). Reuses the 18Q transform-submit
// discipline: solve/preflight before commit, exactly ONE undo entry. The
// heavy lifting lives in the engine kernel `cadProjectTransform.ts`
// (engine-owned); this file only adapts it to the command registry.

import {
  applyCadProjectTransform,
  type ProjectTransformRequest,
} from './cadProjectTransform';
import { createCadSelectionState } from './cadSelection';
import type {
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';

const commitProjectTransform = (
  snapshot: CadWorkspaceSnapshot,
  request: ProjectTransformRequest,
): CadCommandExecutionResult | null => {
  const applied = applyCadProjectTransform(snapshot.project, request);
  if (!applied.ok) return null;
  const label =
    applied.outcome.kind === 'HELMERT_2D'
      ? `PROJECTTRANSFORM HELMERT ${applied.outcome.helmertMode ?? ''}`.trim()
      : `PROJECTTRANSFORM GRIDGROUND ${
          applied.outcome.direction === 'GRID_TO_GROUND' ? 'Grid->Ground' : 'Ground->Grid'
        }`;
  return {
    nextSnapshot: {
      project: applied.project,
      // Whole-drawing scope leaves the operator selection untouched; filter
      // to ids that still exist so a removed entity cannot linger selected.
      selection: createCadSelectionState(
        applied.project,
        snapshot.selection.selectedEntityIds,
      ),
    },
    commandState: { key: 'PROJECTTRANSFORM', phase: 'committed', prompt: `${label} committed.` },
    transactionLabel: label,
    addedEntityIds: [],
    removedEntityIds: [],
  };
};

export const projectTransformCommand: CadCommandDefinition<{
  key: 'PROJECTTRANSFORM';
  request: ProjectTransformRequest;
}> = {
  key: 'PROJECTTRANSFORM',
  execute: (snapshot, command) => commitProjectTransform(snapshot, command.request),
};
