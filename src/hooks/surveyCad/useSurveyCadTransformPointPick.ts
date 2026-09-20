// Phase 18Q transform point capture: ROTATE / SCALE / MIRROR / ALIGN2D pick
// flows. Mirrors the MOVE/COPY pick discipline in useSurveyCadEditPointPick
// (commit via runCadCommand, locked-reject keeps the session with a readable
// reason). Typed values (angle/factor/Yes-No) live in
// useSurveyCadTransformSubmit; unparsable input falls through to the default
// submit path, which routes typed `x,y` points back here as picks.

import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import { getExpandedSelectedEntities } from '../../engine/cad/cadTransactionsSelection';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;

interface TransformPointPickOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  current: CommandSession;
  history: CadHistoryState;
  point: CommandPoint;
  replaceSession: ReplaceSession;
}

const COINCIDENT_TOLERANCE = 1e-9;

const pointsCoincide = (
  first: { x: number; y: number },
  second: { x: number; y: number },
): boolean =>
  Math.abs(first.x - second.x) <= COINCIDENT_TOLERANCE &&
  Math.abs(first.y - second.y) <= COINCIDENT_TOLERANCE;

const blockedReasonText = (history: CadHistoryState, commandKey: string): string | null => {
  const blocker = getExpandedSelectedEntities(history.present).find(
    (entity) => !checkCadEntityEditable(history.present.project, entity).editable,
  );
  if (!blocker) return null;
  const reason = checkCadEntityEditable(history.present.project, blocker).reason;
  return reason === 'LAYER_LOCKED'
    ? `${commandKey} blocked: selection is locked (LAYER_LOCKED). Unlock the layer and try again.`
    : reason === 'ENTITY_HIDDEN'
      ? `${commandKey} blocked: selection is hidden (ENTITY_HIDDEN). Show or thaw the layer and try again.`
      : `${commandKey} blocked: selection is not editable (${reason}).`;
};

/** Run the engine command; false when the central gate rejected it (no mutation). */
const commitTransform = (
  applyHistoryUpdate: ApplyHistoryUpdate,
  command: Parameters<typeof runCadCommand>[1],
): boolean => {
  let committed = false;
  applyHistoryUpdate((existing) => {
    const next = runCadCommand(existing, command);
    committed = next !== existing;
    return next;
  });
  return committed;
};

const pickedAngleDeg = (
  base: { x: number; y: number },
  ref: { x: number; y: number },
  third: { x: number; y: number },
): number => {
  const refAngle = Math.atan2(ref.y - base.y, ref.x - base.x);
  const thirdAngle = Math.atan2(third.y - base.y, third.x - base.x);
  return ((thirdAngle - refAngle) * 180) / Math.PI;
};

const handleRotatePick = (options: TransformPointPickOptions): boolean => {
  const { current, point, replaceSession } = options;
  if (current.key !== 'ROTATE') return false;
  if (!current.basePoint) {
    replaceSession({ ...current, basePoint: point, inputValue: '', resultText: undefined });
    return true;
  }
  if (!current.refPoint) {
    if (pointsCoincide(current.basePoint, point)) {
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'ROTATE reference coincides with the base point. Pick a different reference point.',
      });
      return true;
    }
    replaceSession({ ...current, refPoint: point, inputValue: '', resultText: undefined });
    return true;
  }
  const angleDeg = pickedAngleDeg(current.basePoint, current.refPoint, point);
  if (Math.abs(angleDeg) <= 1e-9) {
    replaceSession({
      ...current,
      inputValue: '',
      resultText: 'ROTATE ignored: picked angle is zero. Pick a different point or type an angle in degrees.',
    });
    return true;
  }
  const committed = commitTransform(options.applyHistoryUpdate, {
    key: 'ROTATE',
    baseX: current.basePoint.x,
    baseY: current.basePoint.y,
    angleDeg,
  });
  if (!committed) {
    replaceSession({
      ...current,
      inputValue: '',
      resultText: blockedReasonText(options.history, 'ROTATE') ?? 'ROTATE ignored: nothing to transform.',
    });
    return true;
  }
  replaceSession(null);
  return true;
};

const handleScalePick = (options: TransformPointPickOptions): boolean => {
  const { current, point, replaceSession } = options;
  if (current.key !== 'SCALE') return false;
  if (!current.basePoint) {
    replaceSession({ ...current, basePoint: point, inputValue: '', resultText: undefined });
    return true;
  }
  // The base is captured; the factor is typed. Swallow further picks so a
  // stray click cannot re-anchor mid-command.
  replaceSession({
    ...current,
    inputValue: '',
    resultText: 'SCALE base captured. Type a positive scale factor and press Enter.',
  });
  return true;
};

const handleMirrorPick = (options: TransformPointPickOptions): boolean => {
  const { current, point, replaceSession } = options;
  if (current.key !== 'MIRROR') return false;
  if (!current.firstPoint) {
    replaceSession({ ...current, firstPoint: point, inputValue: '', resultText: undefined });
    return true;
  }
  if (!current.secondPoint) {
    if (pointsCoincide(current.firstPoint, point)) {
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'MIRROR axis points coincide. Pick a different second axis point.',
      });
      return true;
    }
    replaceSession({
      ...current,
      secondPoint: point,
      inputValue: '',
      resultText: 'MIRROR axis captured. Erase source objects? [Yes/No] <No>.',
    });
    return true;
  }
  replaceSession({
    ...current,
    inputValue: '',
    resultText: 'MIRROR axis captured. Erase source objects? [Yes/No] <No>.',
  });
  return true;
};

const handleAlign2DPick = (options: TransformPointPickOptions): boolean => {
  const { current, point, replaceSession } = options;
  if (current.key !== 'ALIGN2D') return false;
  if (!current.source1) {
    replaceSession({ ...current, source1: point, inputValue: '', resultText: undefined });
    return true;
  }
  if (!current.source2) {
    if (pointsCoincide(current.source1, point)) {
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'ALIGN2D source points coincide. Pick a different second source point.',
      });
      return true;
    }
    replaceSession({ ...current, source2: point, inputValue: '', resultText: undefined });
    return true;
  }
  if (!current.target1) {
    replaceSession({ ...current, target1: point, inputValue: '', resultText: undefined });
    return true;
  }
  if (!current.target2) {
    replaceSession({ ...current, target2: point, inputValue: '', resultText: undefined });
    return true;
  }
  replaceSession({
    ...current,
    inputValue: '',
    resultText: 'ALIGN2D points captured. Scale objects based on alignment points? [Yes/No] <No>.',
  });
  return true;
};

export const handleSurveyCadTransformPointPick = (options: TransformPointPickOptions): boolean =>
  handleRotatePick(options) ||
  handleScalePick(options) ||
  handleMirrorPick(options) ||
  handleAlign2DPick(options);
