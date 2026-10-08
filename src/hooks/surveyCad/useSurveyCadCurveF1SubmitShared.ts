import type { CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CommandSession } from './useSurveyCadCommandTypes';

/**
 * Shared plumbing for the Curve F1 submit and point-pick modules. Kept small
 * and dependency-free so neither module has to import the other for these.
 */
export type ReplaceSession = (_nextSession: CommandSession | null) => void;
export type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;

/** Replace the active session with a cleared input and a result message. */
export const stay = (
  session: CommandSession,
  replaceSession: ReplaceSession,
  resultText: string,
): void => {
  replaceSession({ ...session, inputValue: '', resultText });
};
