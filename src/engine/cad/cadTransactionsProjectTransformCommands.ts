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
  // Phase 18R.1 Finding A: the PROJECTTRANSFORM transaction owns project +
  // draft atomically. The draft rides the snapshot channel (optional field,
  // so CAD history is untouched and every other command keeps working); the
  // kernel maps viewport model-centers + label anchors through the same
  // CadTransform2D. One runCadCommand = one undo entry covering both, so no
  // PROJECTTRANSFORM+VIEWPORT_MOVE+LABEL_MOVE split. Rejected alternative:
  // reusing the draft-only SHEET_*/VIEWPORT_* seam would need 2+ history
  // entries and could never undo atomically; the separate cadSheets draft
  // history (runDraftSheetCommand) stays unused by production (zero src/
  // consumers) and is left alone.
  const applied = applyCadProjectTransform(snapshot.project, request, {
    ...(snapshot.draft ? { draft: snapshot.draft } : {}),
  });
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
      // Atomic draft: transformed draft commits in the SAME undo entry.
      // Absent when the snapshot carried no draft (legacy/blank drawings).
      ...(applied.draft ? { draft: applied.draft } : {}),
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
