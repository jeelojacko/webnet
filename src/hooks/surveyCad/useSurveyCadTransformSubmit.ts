// Phase 18Q transform typed submit: ROTATE angle, SCALE factor, MIRROR and
// ALIGN2D Yes/No answers. Runs in the submit chain before the default point
// fallback, so typed `x,y` input still falls through and routes back as a
// pick. Yes/No answers accept an empty input as the documented default (No).

import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import { deriveAlign2DTransform } from '../../engine/cad/cadHelmert2D';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import { getExpandedSelectedEntities } from '../../engine/cad/cadTransactionsSelection';
import type { CommandSession } from './useSurveyCadCommandTypes';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;

interface HandleSurveyCadTransformSubmitOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  history: CadHistoryState;
  replaceSession: ReplaceSession;
  session: CommandSession;
}

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

/** Yes/No answer: empty input means the default (No). Null = not an answer. */
const parseYesNo = (rawInput: string): boolean | null => {
  const token = rawInput.trim().toLowerCase();
  if (token === '' || token === 'n' || token === 'no') return false;
  if (token === 'y' || token === 'yes') return true;
  return null;
};

const handleRotateSubmit = ({
  applyHistoryUpdate,
  history,
  replaceSession,
  session,
}: HandleSurveyCadTransformSubmitOptions): boolean => {
  if (session.key !== 'ROTATE') return false;
  const angleDeg = Number(session.inputValue.trim());
  if (!Number.isFinite(angleDeg)) return false;
  if (!session.basePoint) {
    replaceSession({
      ...session,
      resultText: 'ROTATE needs a base point first. Click the base point, then type the angle in degrees.',
    });
    return true;
  }
  if (Math.abs(angleDeg) <= 1e-9) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: 'ROTATE ignored: angle is zero. Enter a non-zero angle in degrees (positive = counter-clockwise).',
    });
    return true;
  }
  const committed = commitTransform(applyHistoryUpdate, {
    key: 'ROTATE',
    baseX: session.basePoint.x,
    baseY: session.basePoint.y,
    angleDeg,
  });
  if (!committed) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: blockedReasonText(history, 'ROTATE') ?? 'ROTATE ignored: nothing to transform.',
    });
    return true;
  }
  replaceSession(null);
  return true;
};

const handleScaleSubmit = ({
  applyHistoryUpdate,
  history,
  replaceSession,
  session,
}: HandleSurveyCadTransformSubmitOptions): boolean => {
  if (session.key !== 'SCALE') return false;
  const factor = Number(session.inputValue.trim());
  if (!Number.isFinite(factor)) return false;
  if (!session.basePoint) {
    replaceSession({
      ...session,
      resultText: 'SCALE needs a base point first. Click the base point, then type the scale factor.',
    });
    return true;
  }
  if (!(factor > 0)) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: `SCALE factor invalid (${session.inputValue.trim()}): enter a positive finite number. Mirroring lives in MIRROR.`,
    });
    return true;
  }
  const committed = commitTransform(applyHistoryUpdate, {
    key: 'SCALE',
    baseX: session.basePoint.x,
    baseY: session.basePoint.y,
    factor,
  });
  if (!committed) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: blockedReasonText(history, 'SCALE') ?? 'SCALE ignored: nothing to transform.',
    });
    return true;
  }
  replaceSession(null);
  return true;
};

const handleMirrorSubmit = ({
  applyHistoryUpdate,
  history,
  replaceSession,
  session,
}: HandleSurveyCadTransformSubmitOptions): boolean => {
  if (session.key !== 'MIRROR') return false;
  if (!session.firstPoint || !session.secondPoint) return false;
  const eraseSource = parseYesNo(session.inputValue);
  if (eraseSource == null) {
    replaceSession({
      ...session,
      resultText: 'MIRROR answer invalid. Erase source objects? [Yes/No] <No>.',
    });
    return true;
  }
  const committed = commitTransform(applyHistoryUpdate, {
    key: 'MIRROR',
    p1: { x: session.firstPoint.x, y: session.firstPoint.y },
    p2: { x: session.secondPoint.x, y: session.secondPoint.y },
    eraseSource,
  });
  if (!committed) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: blockedReasonText(history, 'MIRROR') ?? 'MIRROR ignored: nothing to transform.',
    });
    return true;
  }
  replaceSession(null);
  return true;
};

const handleAlign2DSubmit = ({
  applyHistoryUpdate,
  history,
  replaceSession,
  session,
}: HandleSurveyCadTransformSubmitOptions): boolean => {
  if (session.key !== 'ALIGN2D') return false;
  if (!session.source1 || !session.source2 || !session.target1 || !session.target2) return false;
  const scaleToFit = parseYesNo(session.inputValue);
  if (scaleToFit == null) {
    replaceSession({
      ...session,
      resultText: 'ALIGN2D answer invalid. Scale objects based on alignment points? [Yes/No] <No>.',
    });
    return true;
  }
  // Pre-derive so degeneracy errors surface verbatim and the target pair can
  // be re-picked; the engine command re-derives identically on commit.
  const derived = deriveAlign2DTransform(
    { e: session.source1.x, n: session.source1.y },
    { e: session.source2.x, n: session.source2.y },
    { e: session.target1.x, n: session.target1.y },
    { e: session.target2.x, n: session.target2.y },
    scaleToFit,
  );
  if (!derived.ok) {
    replaceSession({
      ...session,
      target2: null,
      inputValue: '',
      resultText: `${derived.reason} Re-pick the second target point.`,
    });
    return true;
  }
  const committed = commitTransform(applyHistoryUpdate, {
    key: 'ALIGN2D',
    source1: { x: session.source1.x, y: session.source1.y },
    source2: { x: session.source2.x, y: session.source2.y },
    target1: { x: session.target1.x, y: session.target1.y },
    target2: { x: session.target2.x, y: session.target2.y },
    scaleToFit,
  });
  if (!committed) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: blockedReasonText(history, 'ALIGN2D') ?? 'ALIGN2D ignored: nothing to transform.',
    });
    return true;
  }
  replaceSession(null);
  return true;
};

export const handleSurveyCadTransformSubmit = (
  options: HandleSurveyCadTransformSubmitOptions,
): boolean =>
  handleRotateSubmit(options) ||
  handleScaleSubmit(options) ||
  handleMirrorSubmit(options) ||
  handleAlign2DSubmit(options);
