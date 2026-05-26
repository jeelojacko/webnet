import {
  clearCadSelection,
  createCadSelectionState,
  getSelectedCadEntities,
  selectAllCadEntities,
} from './cadSelection';
import { replaceCadProjectEntities } from './cadProjectState';
import type { CadSelectionState } from './cadSelection';
import type { CadEntityId, CadProject } from './cadTypes';

export type CadCommandKey = 'SELECT_ALL' | 'CLEAR_SELECTION' | 'ERASE';
export type CadCommandPhase = 'idle' | 'committed';

export interface CadCommandState {
  key: CadCommandKey | 'IDLE';
  phase: CadCommandPhase;
  prompt: string;
}

export type CadCommand =
  | {
      key: 'SELECT_ALL';
    }
  | {
      key: 'CLEAR_SELECTION';
    }
  | {
      key: 'ERASE';
    };

export interface CadTransaction {
  id: string;
  sequence: number;
  commandKey: CadCommandKey;
  label: string;
  beforeSelectionIds: CadEntityId[];
  afterSelectionIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
}

export interface CadWorkspaceSnapshot {
  project: CadProject;
  selection: CadSelectionState;
}

export interface CadCommandExecutionResult {
  nextSnapshot: CadWorkspaceSnapshot;
  commandState: CadCommandState;
  transactionLabel: string;
  removedEntityIds: CadEntityId[];
}

interface CadCommandDefinition<TCommand extends CadCommand> {
  key: TCommand['key'];
  execute: (_snapshot: CadWorkspaceSnapshot, _command: TCommand) => CadCommandExecutionResult | null;
}

const createIdleCommandState = (): CadCommandState => ({
  key: 'IDLE',
  phase: 'idle',
  prompt: 'Ready. Use Select All, Clear Selection, or ERASE to exercise command history.',
});

const selectAllCommand: CadCommandDefinition<{ key: 'SELECT_ALL' }> = {
  key: 'SELECT_ALL',
  execute: (snapshot) => {
    const nextSelection = selectAllCadEntities(snapshot.project);
    if (nextSelection.selectedEntityIds.length === snapshot.selection.selectedEntityIds.length) {
      const same =
        nextSelection.selectedEntityIds.every(
          (entityId, index) => snapshot.selection.selectedEntityIds[index] === entityId,
        );
      if (same) return null;
    }
    return {
      nextSnapshot: {
        project: snapshot.project,
        selection: nextSelection,
      },
      commandState: {
        key: 'SELECT_ALL',
        phase: 'committed',
        prompt: 'SELECT_ALL committed. All visible entities selected.',
      },
      transactionLabel: `SELECT_ALL (${nextSelection.selectedEntityIds.length})`,
      removedEntityIds: [],
    };
  },
};

const clearSelectionCommand: CadCommandDefinition<{ key: 'CLEAR_SELECTION' }> = {
  key: 'CLEAR_SELECTION',
  execute: (snapshot) => {
    if (snapshot.selection.selectedEntityIds.length === 0) return null;
    return {
      nextSnapshot: {
        project: snapshot.project,
        selection: clearCadSelection(),
      },
      commandState: {
        key: 'CLEAR_SELECTION',
        phase: 'committed',
        prompt: 'CLEAR_SELECTION committed. Selection set cleared.',
      },
      transactionLabel: 'CLEAR_SELECTION',
      removedEntityIds: [],
    };
  },
};

const eraseCommand: CadCommandDefinition<{ key: 'ERASE' }> = {
  key: 'ERASE',
  execute: (snapshot) => {
    const selectedEntities = getSelectedCadEntities(snapshot.project, snapshot.selection).filter(
      (entity) => !entity.locked,
    );
    if (selectedEntities.length === 0) return null;
    const removedEntityIds = selectedEntities.map((entity) => entity.id);
    const removedEntityIdSet = new Set(removedEntityIds);
    const nextProject = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.filter((entity) => !removedEntityIdSet.has(entity.id)),
    );
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject),
      },
      commandState: {
        key: 'ERASE',
        phase: 'committed',
        prompt: `ERASE committed. Removed ${removedEntityIds.length} entr${removedEntityIds.length === 1 ? 'y' : 'ies'}.`,
      },
      transactionLabel: `ERASE (${removedEntityIds.length})`,
      removedEntityIds,
    };
  },
};

export const CAD_COMMAND_REGISTRY: Record<CadCommandKey, CadCommandDefinition<CadCommand>> = {
  SELECT_ALL: selectAllCommand as CadCommandDefinition<CadCommand>,
  CLEAR_SELECTION: clearSelectionCommand as CadCommandDefinition<CadCommand>,
  ERASE: eraseCommand as CadCommandDefinition<CadCommand>,
};

export const createCadIdleCommandState = createIdleCommandState;

export const executeCadCommand = (
  snapshot: CadWorkspaceSnapshot,
  command: CadCommand,
): CadCommandExecutionResult | null => CAD_COMMAND_REGISTRY[command.key].execute(snapshot, command);
