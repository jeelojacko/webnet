import { createCadSelectionState } from './cadSelection';
import { createCadIdleCommandState, executeCadCommand } from './cadTransactions';
import type {
  CadCommand,
  CadCommandState,
  CadTransaction,
  CadWorkspaceSnapshot,
} from './cadTransactions';
import type { CadProject } from './cadTypes';

export interface CadHistoryEntry {
  transaction: CadTransaction;
  before: CadWorkspaceSnapshot;
  after: CadWorkspaceSnapshot;
}

export interface CadHistoryState {
  present: CadWorkspaceSnapshot;
  undoStack: CadHistoryEntry[];
  redoStack: CadHistoryEntry[];
  nextSequence: number;
  commandState: CadCommandState;
}

export const createCadHistoryState = (
  project: CadProject,
  initialSelectionIds: readonly string[] = [],
): CadHistoryState => ({
  present: {
    project,
    selection: createCadSelectionState(project, initialSelectionIds),
  },
  undoStack: [],
  redoStack: [],
  nextSequence: 1,
  commandState: createCadIdleCommandState(),
});

const buildTransaction = (
  state: CadHistoryState,
  command: CadCommand,
  before: CadWorkspaceSnapshot,
  after: CadWorkspaceSnapshot,
  label: string,
  removedEntityIds: string[],
): CadTransaction => ({
  id: `cad-tx-${state.nextSequence}`,
  sequence: state.nextSequence,
  commandKey: command.key,
  label,
  beforeSelectionIds: before.selection.selectedEntityIds,
  afterSelectionIds: after.selection.selectedEntityIds,
  removedEntityIds,
});

export const runCadCommand = (
  state: CadHistoryState,
  command: CadCommand,
): CadHistoryState => {
  const result = executeCadCommand(state.present, command);
  if (!result) return state;

  const transaction = buildTransaction(
    state,
    command,
    state.present,
    result.nextSnapshot,
    result.transactionLabel,
    result.removedEntityIds,
  );
  const historyEntry: CadHistoryEntry = {
    transaction,
    before: state.present,
    after: result.nextSnapshot,
  };

  return {
    present: result.nextSnapshot,
    undoStack: [...state.undoStack, historyEntry],
    redoStack: [],
    nextSequence: state.nextSequence + 1,
    commandState: result.commandState,
  };
};

export const undoCadHistory = (state: CadHistoryState): CadHistoryState => {
  const entry = state.undoStack[state.undoStack.length - 1];
  if (!entry) return state;
  return {
    present: entry.before,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [entry, ...state.redoStack],
    nextSequence: state.nextSequence,
    commandState: {
      key: 'IDLE',
      phase: 'idle',
      prompt: `Undo ${entry.transaction.label}.`,
    },
  };
};

export const redoCadHistory = (state: CadHistoryState): CadHistoryState => {
  const [entry, ...remainingRedo] = state.redoStack;
  if (!entry) return state;
  return {
    present: entry.after,
    undoStack: [...state.undoStack, entry],
    redoStack: remainingRedo,
    nextSequence: state.nextSequence,
    commandState: {
      key: 'IDLE',
      phase: 'idle',
      prompt: `Redo ${entry.transaction.label}.`,
    },
  };
};
