import {
  buildCadDistanceSummary,
  buildCadInverseSummary,
  type CadTraverseAdjustmentMethod,
} from '../../engine/cad/cadCogo';
import type {
  CommandSession,
  TraverseDraftMode,
  TraverseSideshotDraft,
} from './useSurveyCadCommandTypes';
import {
  buildTraverseClosureTarget,
  recalculateTraverseSideshotPoint,
} from './useSurveyCadCommandSession';

export interface ActiveBatchCogoDraftView {
  inputValue: string;
  startPoint: { label: string; x: number; y: number } | null;
  startPointSource: 'selected' | 'input' | null;
  endPoint: { label: string; x: number; y: number } | null;
  previewRows: Array<{
    lineNumber: number;
    input: string;
    kind: 'start' | 'line' | 'curve';
    status: 'ok' | 'warning' | 'error';
    summary: string;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    severity: 'info' | 'warning' | 'error';
  }>;
  generatedPointCount: number;
  generatedLineCount: number;
  generatedArcCount: number;
  canCommit: boolean;
}

export interface ActiveTraverseDraftView {
  points: Array<{ label: string; x: number; y: number }>;
  mode: TraverseDraftMode;
  closePoint: { label: string; x: number; y: number } | null;
  legs: Array<{
    fromLabel: string;
    toLabel: string;
    bearing: string;
    distance: number;
    inputValue: string;
  }>;
  sideshots: TraverseSideshotDraft[];
  totalLength: number;
  closureTargetLabel: string | null;
  closureDeltaX: number | null;
  closureDeltaY: number | null;
  closureDistance: number | null;
  closureBearing: string | null;
  closureRatio: number | null;
  adjustment: {
    method: CadTraverseAdjustmentMethod;
    targetLabel: string;
    rawClosureDistance: number;
    adjustedClosureDistance: number;
    rawClosureBearing: string | null;
    adjustedClosureBearing: string | null;
    angularCorrectionPerLegSec: number | null;
  } | null;
}

type TraverseSession = Extract<CommandSession, { key: 'TRAVERSE' }>;

const buildTraverseAdjustmentView = (
  session: TraverseSession,
): ActiveTraverseDraftView['adjustment'] =>
  session.adjustment == null
    ? null
    : {
        method: session.adjustment.method,
        targetLabel: session.adjustment.summary.targetLabel,
        rawClosureDistance: session.adjustment.summary.rawClosureDistanceMeters,
        adjustedClosureDistance: session.adjustment.summary.adjustedClosureDistanceMeters,
        rawClosureBearing: session.adjustment.summary.rawClosureBearing,
        adjustedClosureBearing: session.adjustment.summary.adjustedClosureBearing,
        angularCorrectionPerLegSec: session.adjustment.summary.angularCorrectionPerLegSec,
      };

const buildBaseTraverseDraftView = (
  session: TraverseSession,
): Pick<
  ActiveTraverseDraftView,
  'points' | 'closePoint' | 'legs' | 'sideshots' | 'totalLength' | 'closureTargetLabel'
> => {
  const points = session.points.map((point) => ({
    label: point.label,
    x: point.x,
    y: point.y,
  }));
  const legs = session.points.slice(1).map((point, index) => {
    const fromPoint = session.points[index]!;
    const inverse = buildCadInverseSummary(fromPoint, point);
    return {
      fromLabel: fromPoint.label,
      toLabel: point.label,
      bearing: inverse.bearing,
      distance: inverse.distance,
      inputValue: session.legInputs[index] ?? `${inverse.bearing},${inverse.distance.toFixed(3)}`,
    };
  });
  const totalLength = legs.reduce((sum, leg) => sum + leg.distance, 0);
  const closureTarget = buildTraverseClosureTarget(session.mode, session.inputPoints, session.closePoint);
  return {
    points,
    closePoint: session.closePoint
      ? { label: session.closePoint.label, x: session.closePoint.x, y: session.closePoint.y }
      : null,
    legs,
    sideshots: session.sideshots.map((sideshot) => recalculateTraverseSideshotPoint(session.points, sideshot)),
    totalLength,
    closureTargetLabel: closureTarget?.label ?? null,
  };
};

export const buildActiveTraverseDraftView = (
  session: CommandSession | null,
): ActiveTraverseDraftView | null => {
  if (session?.key !== 'TRAVERSE') return null;
  const base = buildBaseTraverseDraftView(session);
  const adjustment = buildTraverseAdjustmentView(session);
  if (session.points.length < 2) {
    return {
      ...base,
      mode: session.mode,
      closureDeltaX: null,
      closureDeltaY: null,
      closureDistance: null,
      closureBearing: null,
      closureRatio: null,
      adjustment,
    };
  }
  const closureTargetPoint = buildTraverseClosureTarget(session.mode, session.inputPoints, session.closePoint);
  const lastPoint = session.points[session.points.length - 1]!;
  const closureDistance =
    closureTargetPoint == null ? null : buildCadDistanceSummary(lastPoint, closureTargetPoint).distance2d;
  const closureDelta =
    closureTargetPoint == null ? null : buildCadDistanceSummary(lastPoint, closureTargetPoint);
  const closureBearing =
    closureTargetPoint && closureDistance != null && closureDistance > 1e-9
      ? buildCadInverseSummary(lastPoint, closureTargetPoint).bearing
      : null;
  return {
    ...base,
    mode: session.mode,
    closureTargetLabel: closureTargetPoint?.label ?? null,
    closureDeltaX: closureDelta?.deltaX ?? null,
    closureDeltaY: closureDelta?.deltaY ?? null,
    closureDistance,
    closureBearing,
    closureRatio:
      closureDistance != null && closureDistance > 1e-9 && base.totalLength > 0
        ? base.totalLength / closureDistance
        : null,
    adjustment,
  };
};

export const buildActiveBatchCogoDraftView = (
  session: CommandSession | null,
): ActiveBatchCogoDraftView | null => {
  if (!session || session.key !== 'BATCH_COGO') return null;
  return {
    inputValue: session.inputValue,
    startPoint: session.draft.startPoint,
    startPointSource: session.draft.startPointSource,
    endPoint: session.draft.endPoint,
    previewRows: session.draft.previewRows,
    warnings: session.draft.warnings,
    generatedPointCount: session.draft.generatedPointCount,
    generatedLineCount: session.draft.generatedLineCount,
    generatedArcCount: session.draft.generatedArcCount,
    canCommit: session.draft.canCommit,
  };
};
