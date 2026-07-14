import type { MutableRefObject } from 'react';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CommandSession } from './useSurveyCadCommandTypes';
import { recalculateTraverseSideshotPoint } from './useSurveyCadCommandSession';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;

interface UseSurveyCadCommandLifecycleOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  replaceSession: ReplaceSession;
  session: CommandSession | null;
  sessionRef: MutableRefObject<CommandSession | null>;
  submitSessionInput: () => void;
}

export interface SurveyCadCommandLifecycle {
  cancelCommand: () => void;
  commitBatchCogoDraft: () => void;
  finishCommand: () => void;
  handleEnterKey: () => void;
  handleEscapeKey: () => void;
}

const commandPointsMatch = (
  first: { x: number; y: number },
  second: { x: number; y: number },
): boolean => Math.abs(first.x - second.x) <= 1e-9 && Math.abs(first.y - second.y) <= 1e-9;

export const useSurveyCadCommandLifecycle = ({
  applyHistoryUpdate,
  replaceSession,
  session,
  sessionRef,
  submitSessionInput,
}: UseSurveyCadCommandLifecycleOptions): SurveyCadCommandLifecycle => {
  const finishPolylineSession = () => {
    if (!session || session.key !== 'PLINE' || session.points.length < 2) return;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'PLINE',
        vertices: session.points,
      }),
    );
    replaceSession(null);
  };

  const finishTraverseSession = () => {
    if (!session || session.key !== 'TRAVERSE' || session.points.length < 2) return;
    const traverseVertices =
      session.mode === 'closed'
        ? commandPointsMatch(session.points[0]!, session.points[session.points.length - 1]!)
          ? session.points
          : [...session.points, session.points[0]!]
        : session.mode === 'point-to-point' && session.closePoint
          ? commandPointsMatch(session.closePoint, session.points[session.points.length - 1]!)
            ? session.points
            : [...session.points, session.closePoint]
          : session.points;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'TRAVERSE',
        vertices: traverseVertices,
        rawVertices: session.inputPoints,
        mode: session.mode,
        closePoint:
          session.mode === 'point-to-point' && session.closePoint
            ? {
                x: session.closePoint.x,
                y: session.closePoint.y,
                label: session.closePoint.label,
              }
            : undefined,
        sideshots: session.sideshots.map((sideshot) => ({
          occupyLabel: sideshot.occupyLabel,
          backsightLabel: sideshot.backsightLabel,
          side: sideshot.side,
          angleDeg: sideshot.angleDeg,
          distance: sideshot.distance,
          point: recalculateTraverseSideshotPoint(session.points, sideshot).point,
        })),
        adjustment:
          session.adjustment == null
            ? undefined
            : {
                method: session.adjustment.method,
                targetLabel: session.adjustment.summary.targetLabel,
                rawClosureDistance: session.adjustment.summary.rawClosureDistanceMeters,
                adjustedClosureDistance: session.adjustment.summary.adjustedClosureDistanceMeters,
                rawClosureBearing: session.adjustment.summary.rawClosureBearing,
                adjustedClosureBearing: session.adjustment.summary.adjustedClosureBearing,
                angularCorrectionPerLegSec: session.adjustment.summary.angularCorrectionPerLegSec,
              },
      }),
    );
    replaceSession(null);
  };

  const commitBatchCogoDraft = () => {
    const current = sessionRef.current;
    if (!current || current.key !== 'BATCH_COGO') return;
    if (!current.draft.canCommit) {
      replaceSession({
        ...current,
        resultText:
          current.draft.previewRows.find((row) => row.status === 'error')?.summary ??
          'BATCH_COGO draft is incomplete. Add a start point and at least one valid row.',
      });
      return;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'BATCH_COGO',
        draft: current.draft,
      }),
    );
    replaceSession(null);
  };

  const handleEnterKey = () => {
    if (!session) return;
    if (session.key === 'TRIM' || session.key === 'EXTEND') {
      replaceSession(null);
      return;
    }
    if (session.key === 'FILLET' && session.inputValue.trim().length === 0) {
      replaceSession(null);
      return;
    }
    if (session.key === 'PLINE' && session.inputValue.trim().length === 0 && session.points.length >= 2) {
      finishPolylineSession();
      return;
    }
    if (session.key === 'TRAVERSE' && session.inputValue.trim().length === 0 && session.points.length >= 2) {
      if (session.mode === 'point-to-point' && session.closePoint == null) {
        replaceSession({
          ...session,
          resultText: 'Point-to-point traverse needs a selected close target before finishing.',
        });
        return;
      }
      finishTraverseSession();
      return;
    }
    if (session.key === 'MULTI_INVERSE' && session.inputValue.trim().length === 0 && session.points.length >= 2) {
      submitSessionInput();
      return;
    }
    if (session.key === 'AREA' && session.inputValue.trim().length === 0 && session.points.length >= 3) {
      submitSessionInput();
      return;
    }
    if (session.key === 'PARCEL_SPLIT_BEARING' && session.inputValue.trim().length === 0) {
      return;
    }
    if (session.key === 'PARCEL_SPLIT_AREA' && session.inputValue.trim().length === 0) {
      return;
    }
    if (session.inputValue.trim().length === 0) return;
    submitSessionInput();
  };

  const handleEscapeKey = () => {
    replaceSession(null);
  };

  const finishCommand = () => {
    if (session?.key === 'PLINE') {
      finishPolylineSession();
      return;
    }
    if (session?.key === 'TRAVERSE') {
      finishTraverseSession();
      return;
    }
    if (session?.key === 'BATCH_COGO') {
      commitBatchCogoDraft();
    }
  };

  return {
    cancelCommand: handleEscapeKey,
    commitBatchCogoDraft,
    finishCommand,
    handleEnterKey,
    handleEscapeKey,
  };
};
