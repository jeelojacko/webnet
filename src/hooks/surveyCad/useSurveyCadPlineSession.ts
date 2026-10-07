import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import {
  countDistinctPlinePositions,
  sanitizeCadPolylineVertices,
} from '../../engine/cad/cadPolylineGeometry';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';

export type PlineCommandSession = Extract<CommandSession, { key: 'PLINE' }>;

export type PlineSessionOption = 'close' | 'undo';

export type ReplacePlineSession = (_nextSession: CommandSession | null) => void;
export type ApplyPlineHistoryUpdate = (
  _updater: (_history: CadHistoryState) => CadHistoryState,
) => void;

export const PLINE_CLOSE_MIN_VERTICES_MESSAGE =
  'PLINE Close needs at least 3 distinct vertices.';
export const PLINE_OPEN_MIN_VERTICES_MESSAGE =
  'PLINE needs at least 2 distinct vertices to finish.';
export const PLINE_NOTHING_TO_UNDO_MESSAGE = 'PLINE nothing to undo.';

/**
 * C1 session keyboard law: `C`/`CLOSE` and `U`/`UNDO`/`BACKSTEP` are the
 * only reserved tokens, matched whole and case-insensitively BEFORE any
 * point parse. No `B` alias (coordinate/bearing strings are never stolen).
 */
export const parsePlineSessionOption = (raw: string): PlineSessionOption | null => {
  const token = raw.trim();
  if (token.length === 0) return null;
  const upper = token.toUpperCase();
  if (upper === 'C' || upper === 'CLOSE') return 'close';
  if (upper === 'U' || upper === 'UNDO' || upper === 'BACKSTEP') return 'undo';
  return null;
};

/** Retained (dedupe law) vertices used for the C<3 / Enter<2 gates. */
export const plineRetainedVertices = (
  points: readonly CommandPoint[],
  closed: boolean,
): CommandPoint[] => sanitizeCadPolylineVertices(points, closed);

export const canClosePlineSession = (points: readonly CommandPoint[]): boolean => {
  const retained = plineRetainedVertices(points, true);
  return retained.length >= 3 && countDistinctPlinePositions(retained) >= 3;
};

/** Session-local one-step backstep: drops the newest captured vertex. */
export const backstepPlineSession = (session: PlineCommandSession): PlineCommandSession =>
  session.points.length === 0
    ? {
        ...session,
        inputValue: '',
        resultText: PLINE_NOTHING_TO_UNDO_MESSAGE,
      }
    : {
        ...session,
        points: session.points.slice(0, -1),
        inputValue: '',
        resultText: undefined,
      };

/**
 * Commit the live draft as one PLINE transaction. Open commits need 2+
 * retained vertices; closed commits need 3+ retained distinct vertices
 * (and never persist a duplicate closure vertex — the engine strips it).
 * Returns false (session stays active with a message) when the gate fails.
 */
export const commitPlineSession = ({
  applyHistoryUpdate,
  closed,
  replaceSession,
  session,
}: {
  applyHistoryUpdate: ApplyPlineHistoryUpdate;
  closed: boolean;
  replaceSession: ReplacePlineSession;
  session: PlineCommandSession;
}): boolean => {
  const retained = plineRetainedVertices(session.points, closed);
  const minimum = closed ? 3 : 2;
  if (
    retained.length < minimum ||
    (closed && countDistinctPlinePositions(retained) < 3)
  ) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: closed ? PLINE_CLOSE_MIN_VERTICES_MESSAGE : PLINE_OPEN_MIN_VERTICES_MESSAGE,
    });
    return false;
  }
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'PLINE',
      vertices: session.points,
      closed,
    }),
  );
  replaceSession(null);
  return true;
};

/**
 * Typed-submit branch for a PLINE session. Runs before the default point
 * parser so `C`/`U` never reach coordinate/bearing parsing. Returns true
 * when the input was consumed (commit or session-local action).
 */
export const handleSurveyCadPlineSubmit = ({
  applyHistoryUpdate,
  replaceSession,
  session,
}: {
  applyHistoryUpdate: ApplyPlineHistoryUpdate;
  replaceSession: ReplacePlineSession;
  session: CommandSession;
}): boolean => {
  if (session.key !== 'PLINE') return false;
  const option = parsePlineSessionOption(session.inputValue);
  if (option === 'undo') {
    replaceSession(backstepPlineSession(session));
    return true;
  }
  if (option === 'close') {
    commitPlineSession({ applyHistoryUpdate, closed: true, replaceSession, session });
    return true;
  }
  return false;
};
