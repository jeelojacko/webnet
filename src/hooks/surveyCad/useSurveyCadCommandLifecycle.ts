import type { MutableRefObject } from 'react';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import {
  commitAnnotationSession,
  handleAnnotationEnterKey,
} from './useSurveyCadAnnotationSessions';
import { commitBestFitSession, isBestFitSession } from './useSurveyCadBestFitSession';
import { isCurveF1Session } from './useSurveyCadCurveF1Session';
import type { CommandSession } from './useSurveyCadCommandTypes';
import type { CadLineL1SessionState } from './useSurveyCadCommandTypes';
import { isCadLineL1Key } from './useSurveyCadLineL1Keys';
import { cadLineL1CanFinish } from './useSurveyCadLineL1Session';
import type { CadProject } from '../../engine/cad/cadTypes';
import { recalculateTraverseSideshotPoint } from './useSurveyCadCommandSession';
import {
  commitPlineSession,
  plineWidthPhaseOf,
  PLINE_WIDTH_CANCELLED_MESSAGE,
} from './useSurveyCadPlineSession';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;

interface UseSurveyCadCommandLifecycleOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  project: CadProject;
  replaceSession: ReplaceSession;
  reportComputation?: (_computation: CadCogoComputation) => void;
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
  project,
  replaceSession,
  reportComputation,
  session,
  sessionRef,
  submitSessionInput,
}: UseSurveyCadCommandLifecycleOptions): SurveyCadCommandLifecycle => {
  const finishPolylineSession = () => {
    if (!session || session.key !== 'PLINE') return;
    commitPlineSession({
      applyHistoryUpdate,
      closed: false,
      replaceSession,
      session,
    });
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
    // Live ref (not render-scope state): dock text entry sets the input and
    // submits synchronously, before any re-render lands.
    const live = sessionRef.current;
    const session = live ?? null;
    if (!session) return;
    // CAD Draw L1: empty Enter commits a complete draft; typed values route to
    // the L1 handler (never the generic point parser).
    if (isCadLineL1Key(session.key)) {
      if (session.inputValue.trim().length === 0) {
        if (cadLineL1CanFinish(session as CadLineL1SessionState)) submitSessionInput();
        return;
      }
      submitSessionInput();
      return;
    }
    // Phase 18O: MTEXT/LEADER lines append per Enter; empty Enter commits.
    if (live && handleAnnotationEnterKey({ session: live, project, applyHistoryUpdate, replaceSession })) return;
    // CAD Best Fit E1: empty Enter commits once the minimum is met, else
    // refuses and stays active. Typed input routes to the U/point parser.
    if (live && isBestFitSession(live) && live.inputValue.trim().length === 0) {
      commitBestFitSession({ applyHistoryUpdate, replaceSession, reportComputation, session: live });
      return;
    }
    // CAD Curves F1: empty Enter attempts the commit when the session is
    // complete (otherwise the submit reports what is missing); Escape is the
    // only zero-mutation cancel and never commits.
    if (live && isCurveF1Session(live) && live.inputValue.trim().length === 0) {
      submitSessionInput();
      return;
    }
    if (session.key === 'TRIM' || session.key === 'EXTEND') {
      replaceSession(null);
      return;
    }
    if (session.key === 'FILLET' && session.inputValue.trim().length === 0) {
      replaceSession(null);
      return;
    }
    // Phase C2: an empty Enter while the width prompt is open cancels the
    // prompt (default unchanged) instead of finishing the draft.
    if (session.key === 'PLINE' && session.inputValue.trim().length === 0 && plineWidthPhaseOf(session)) {
      replaceSession({
        ...session,
        plineWidthPhase: false,
        inputValue: '',
        resultText: PLINE_WIDTH_CANCELLED_MESSAGE,
      });
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
    // Phase 18Q: MIRROR/ALIGN2D Yes/No answers accept empty input as the
    // documented default (No) once all picks are captured; without this the
    // empty default could never commit (the generic empty-input no-op below).
    if (session.inputValue.trim().length === 0) {
      if (session.key === 'MIRROR' && session.firstPoint && session.secondPoint) {
        submitSessionInput();
        return;
      }
      // POLYGON mode defaults to Inscribed on empty input.
      if (session.key === 'POLYGON' && session.phase === 'mode') {
        submitSessionInput();
        return;
      }
      if (
        session.key === 'ALIGN2D' &&
        session.source1 &&
        session.source2 &&
        session.target1 &&
        session.target2
      ) {
        submitSessionInput();
        return;
      }
      return;
    }
    submitSessionInput();
  };

  const handleEscapeKey = () => {
    // Phase 18O: text/label sessions commit when complete, else cancel.
    const current = sessionRef.current;
    if (current && commitAnnotationSession({ session: current, project, applyHistoryUpdate, replaceSession })) {
      return;
    }
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
