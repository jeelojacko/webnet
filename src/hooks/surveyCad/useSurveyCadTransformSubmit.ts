// Phase 18Q transform typed submit: ROTATE angle, SCALE factor, MIRROR and
// ALIGN2D Yes/No answers. Runs in the submit chain before the default point
// fallback, so typed `x,y` input still falls through and routes back as a
// pick. Yes/No answers accept an empty input as the documented default (No).

import { checkCadEntityEditable } from '../../engine/cad/cadAppearance';
import {
  deriveAlign2DTransform,
  gridGroundTransform,
  solveHelmert2D,
  type HelmertControlPair,
} from '../../engine/cad/cadHelmert2D';
import { classifyTransform, type CadTransform2D } from '../../engine/cad/cadTransform2D';
import { preflightCadSelectionTransform } from '../../engine/cad/cadTransformApply';
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

/** Dry-run the atomic preflight so blocks (locks, scale dependencies) surface
 * verbatim pre-mutation; the engine command re-checks identically on commit. */
const selectionTransformBlockReason = (
  history: CadHistoryState,
  transform: CadTransform2D,
): string | null => {
  const classification = classifyTransform(transform);
  if (!classification) return 'CAD_TRANSFORM_SINGULAR: transform is degenerate.';
  const preflight = preflightCadSelectionTransform(
    history.present.project,
    history.present.selection.selectedEntityIds,
    classification,
    { transform },
  );
  return preflight.ok ? null : preflight.reason;
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

const helmertPairsForCommand = (session: Extract<CommandSession, { key: 'HELMERT2D' }>): HelmertControlPair[] =>
  session.pairs.map((pair) => ({
    sourceE: pair.source.x,
    sourceN: pair.source.y,
    targetE: pair.target.x,
    targetN: pair.target.y,
  }));

/** Four finite numbers `sx,sy,tx,ty` (comma/space/semicolon separated). Null = not a pair. */
const parseHelmertPairInput = (rawInput: string): HelmertControlPair | null => {
  const tokens = rawInput.trim().split(/[,;\s]+/).filter((token) => token.length > 0);
  if (tokens.length !== 4) return null;
  const values = tokens.map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  return { sourceE: values[0]!, sourceN: values[1]!, targetE: values[2]!, targetN: values[3]! };
};

const handleHelmert2DSubmit = ({
  applyHistoryUpdate,
  history,
  replaceSession,
  session,
}: HandleSurveyCadTransformSubmitOptions): boolean => {
  if (session.key !== 'HELMERT2D') return false;
  const raw = session.inputValue.trim();
  if (raw.length === 0) return false;
  const upper = raw.toUpperCase();
  if (upper === 'RIGID' || upper === 'MODE RIGID') {
    replaceSession({ ...session, mode: 'RIGID', inputValue: '', resultText: undefined });
    return true;
  }
  if (upper === 'SIMILARITY' || upper === 'MODE SIMILARITY') {
    replaceSession({ ...session, mode: 'SIMILARITY', inputValue: '', resultText: undefined });
    return true;
  }
  if (upper === 'CLEAR') {
    replaceSession({ ...session, pairs: [], pendingSource: null, inputValue: '', resultText: undefined });
    return true;
  }
  if (upper === 'REMOVE LAST') {
    if (session.pairs.length === 0) {
      replaceSession({ ...session, inputValue: '', resultText: 'HELMERT2D has no pairs to remove.' });
      return true;
    }
    replaceSession({ ...session, pairs: session.pairs.slice(0, -1), inputValue: '', resultText: undefined });
    return true;
  }
  const removeMatch = /^REMOVE\s+(\d+)$/.exec(upper);
  if (removeMatch) {
    const index = Number(removeMatch[1]) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= session.pairs.length) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: `HELMERT2D REMOVE invalid: enter 1-${session.pairs.length}, REMOVE LAST, or CLEAR.`,
      });
      return true;
    }
    replaceSession({
      ...session,
      pairs: session.pairs.filter((_, pairIndex) => pairIndex !== index),
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  if (upper === 'PREVIEW') {
    // Fit report in the command line; the ghost already shows the solved
    // transform while authoritative geometry stays unchanged.
    const solved = solveHelmert2D(helmertPairsForCommand(session), session.mode);
    if (!solved.ok) {
      replaceSession({ ...session, inputValue: '', resultText: solved.reason });
      return true;
    }
    replaceSession({
      ...session,
      inputValue: '',
      resultText:
        `HELMERT2D ${session.mode} fit: rot ${solved.rotationDeg.toFixed(4)} deg, ` +
        `scale ${solved.scale.toFixed(9)}, RMS residual ${solved.rmsResidual.toFixed(4)}, ` +
        `max ${solved.maxResidual.toFixed(4)} (${session.pairs.length} pairs).`,
    });
    return true;
  }
  if (upper === 'APPLY') {
    // Pre-solve so degeneracy surfaces verbatim and fails closed pre-mutation;
    // the engine command re-solves identically on commit.
    const solved = solveHelmert2D(helmertPairsForCommand(session), session.mode);
    if (!solved.ok) {
      replaceSession({ ...session, inputValue: '', resultText: `${solved.reason} Add or re-pick pairs.` });
      return true;
    }
    const blockReason = selectionTransformBlockReason(history, solved.transform);
    if (blockReason) {
      replaceSession({ ...session, inputValue: '', resultText: blockReason });
      return true;
    }
    const committed = commitTransform(applyHistoryUpdate, {
      key: 'HELMERT2D',
      pairs: helmertPairsForCommand(session),
      mode: session.mode,
    });
    if (!committed) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: blockedReasonText(history, 'HELMERT2D') ?? 'HELMERT2D ignored: nothing to transform.',
      });
      return true;
    }
    replaceSession(null);
    return true;
  }
  const typedPair = parseHelmertPairInput(raw);
  if (typedPair) {
    const pairIndex = session.pairs.length + 1;
    replaceSession({
      ...session,
      pairs: [
        ...session.pairs,
        {
          source: { x: typedPair.sourceE, y: typedPair.sourceN, label: `HS${pairIndex}` },
          target: { x: typedPair.targetE, y: typedPair.targetN, label: `HT${pairIndex}` },
        },
      ],
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  // Anything else (single `x,y`, labels, bearings) falls through to the
  // default point path, which routes back as a source/target pick.
  return false;
};

const handleGridGroundSubmit = ({
  applyHistoryUpdate,
  history,
  replaceSession,
  session,
}: HandleSurveyCadTransformSubmitOptions): boolean => {
  if (session.key !== 'GRIDGROUND') return false;
  const raw = session.inputValue.trim();
  if (raw.length === 0) return false;
  const squashed = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (squashed === 'GRIDTOGROUND') {
    replaceSession({ ...session, direction: 'GRID_TO_GROUND', inputValue: '', resultText: undefined });
    return true;
  }
  if (squashed === 'GROUNDTOGRID') {
    replaceSession({ ...session, direction: 'GROUND_TO_GRID', inputValue: '', resultText: undefined });
    return true;
  }
  if (squashed === 'PREVIEW') {
    if (!session.origin || session.combinedScaleFactor == null) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: 'GRIDGROUND preview needs an origin and a factor first.',
      });
      return true;
    }
    const derived = gridGroundTransform(
      session.origin.x,
      session.origin.y,
      session.combinedScaleFactor,
      session.direction,
    );
    replaceSession({
      ...session,
      inputValue: '',
      resultText: derived.ok
        ? `GRIDGROUND preview: ${derived.formula}, effective ${derived.effectiveFactor.toFixed(12)}.`
        : derived.reason,
    });
    return true;
  }
  if (squashed === 'APPLY') {
    if (!session.origin) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: 'GRIDGROUND needs an origin first. Click the origin, then type the factor.',
      });
      return true;
    }
    if (session.combinedScaleFactor == null) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: 'GRIDGROUND needs a combined scale factor first. Type a positive number.',
      });
      return true;
    }
    const derived = gridGroundTransform(
      session.origin.x,
      session.origin.y,
      session.combinedScaleFactor,
      session.direction,
    );
    if (!derived.ok) {
      replaceSession({ ...session, inputValue: '', resultText: derived.reason });
      return true;
    }
    const blockReason = selectionTransformBlockReason(history, derived.transform);
    if (blockReason) {
      replaceSession({ ...session, inputValue: '', resultText: blockReason });
      return true;
    }
    const committed = commitTransform(applyHistoryUpdate, {
      key: 'GRIDGROUND',
      originE: session.origin.x,
      originN: session.origin.y,
      combinedScaleFactor: session.combinedScaleFactor,
      direction: session.direction,
    });
    if (!committed) {
      replaceSession({
        ...session,
        inputValue: '',
        resultText: blockedReasonText(history, 'GRIDGROUND') ?? 'GRIDGROUND ignored: nothing to transform.',
      });
      return true;
    }
    replaceSession(null);
    return true;
  }
  const factor = Number(raw);
  if (!Number.isFinite(factor)) return false;
  if (!session.origin) {
    replaceSession({
      ...session,
      resultText: 'GRIDGROUND needs an origin first. Click the origin, then type the factor.',
    });
    return true;
  }
  if (!(factor > 0)) {
    replaceSession({
      ...session,
      inputValue: '',
      resultText: `GRIDGROUND factor invalid (${raw}): enter a positive finite number.`,
    });
    return true;
  }
  replaceSession({ ...session, combinedScaleFactor: factor, inputValue: '', resultText: undefined });
  return true;
};

export const handleSurveyCadTransformSubmit = (
  options: HandleSurveyCadTransformSubmitOptions,
): boolean =>
  handleRotateSubmit(options) ||
  handleScaleSubmit(options) ||
  handleMirrorSubmit(options) ||
  handleAlign2DSubmit(options) ||
  handleHelmert2DSubmit(options) ||
  handleGridGroundSubmit(options);
