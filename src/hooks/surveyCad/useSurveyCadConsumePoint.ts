import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import { buildTraverseLegInputFromPoints } from './useSurveyCadCommandSession';
import { normalizeDraftPoint } from './useSurveyCadCommandParsing';
import { handleSurveyCadArcPointPick } from './useSurveyCadArcPointPick';
import type {
  HandleSurveyCadConsumePointOptions,
  ReplaceSession,
} from './useSurveyCadConsumePoint.types';
import { handleSurveyCadEditPointPick } from './useSurveyCadEditPointPick';
import { handleSurveyCadParcelSplitPointPick } from './useSurveyCadParcelSplitPointPick';
import {
  handleInversePointPick,
  handlePerpendicularPointPick,
  handleReportPointPick,
} from './useSurveyCadReportPointPick';

const handleStagedPointPick = (
  current: CommandSession,
  point: CommandPoint,
  replaceSession: ReplaceSession,
): boolean => {
  if (current.key === 'TURNED_POINT') {
    if (!current.occupyPoint) {
      replaceSession({
        ...current,
        occupyPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (!current.backsightPoint) {
      replaceSession({
        ...current,
        backsightPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  if (current.key === 'PI_CURVE') {
    if (!current.piPoint) {
      replaceSession({
        ...current,
        piPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (!current.backTangentPoint) {
      replaceSession({
        ...current,
        backTangentPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  if (current.key === 'CHORD_BEARING_CURVE') {
    if (!current.startPoint) {
      replaceSession({
        ...current,
        startPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  return false;
};

const handleIntersectionPointPick = (
  current: CommandSession,
  point: CommandPoint,
  replaceSession: ReplaceSession,
): boolean => {
  if (
    current.key === 'BEARING_BEARING_INTX' ||
    current.key === 'BEARING_DISTANCE_INTX' ||
    current.key === 'DISTANCE_DISTANCE_INTX'
  ) {
    if (!current.firstPoint) {
      replaceSession({
        ...current,
        firstPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (!current.secondPoint) {
      replaceSession({
        ...current,
        secondPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  if (current.key === 'LINE_CIRCLE_INTX' || current.key === 'SKEW_INTX') {
    if (!current.targetPoint) {
      replaceSession({
        ...current,
        targetPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  return false;
};

const handlePolylineOrTraversePointPick = ({
  current,
  point,
  projectStationIds,
  replaceSession,
}: Pick<
  HandleSurveyCadConsumePointOptions,
  'current' | 'point' | 'projectStationIds' | 'replaceSession'
>): boolean => {
  if (current.key !== 'PLINE' && current.key !== 'TRAVERSE') return false;
  const draftPoint =
    current.key === 'TRAVERSE'
      ? normalizeDraftPoint(point, current.inputPoints, projectStationIds)
      : normalizeDraftPoint(point, current.points, projectStationIds);
  replaceSession(
    current.key === 'TRAVERSE'
      ? {
          ...current,
          points: [...current.inputPoints, draftPoint],
          inputPoints: [...current.inputPoints, draftPoint],
          legInputs:
            current.inputPoints.length === 0
              ? current.legInputs
              : [
                  ...current.legInputs,
                  buildTraverseLegInputFromPoints(
                    current.inputPoints[current.inputPoints.length - 1]!,
                    draftPoint,
                  ),
                ],
          adjustment: null,
          inputValue: '',
          resultText: undefined,
        }
      : {
          ...current,
          points: [...current.points, draftPoint],
          inputValue: '',
          resultText: undefined,
        },
  );
  return true;
};

export const handleSurveyCadConsumePoint = (
  options: HandleSurveyCadConsumePointOptions,
): void => {
  const { applyHistoryUpdate, current, point, replaceSession } = options;
  if (current.key === 'POINT') {
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'POINT',
        x: point.x,
        y: point.y,
        label: options.suppressPointLabel ? undefined : point.label,
      }),
    );
    replaceSession(null);
    return;
  }

  if (current.key === 'COGO_POINT') {
    if (!current.startPoint) {
      replaceSession({
        ...current,
        startPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return;
    }
    const directionLabel = current.inputValue.trim() || point.label;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'COGO_POINT',
        x: point.x,
        y: point.y,
        basisLabel: current.startPoint!.label,
        directionLabel,
      }),
    );
    replaceSession(null);
    return;
  }

  if (current.key === 'MULTI_INVERSE' || current.key === 'AREA') {
    replaceSession({
      ...current,
      points: [...current.points, point],
      inputValue: '',
      resultText: undefined,
    });
    return;
  }

  if (
    handleReportPointPick(options) ||
    handleStagedPointPick(current, point, replaceSession) ||
    handleIntersectionPointPick(current, point, replaceSession) ||
    handlePerpendicularPointPick(options) ||
    handlePolylineOrTraversePointPick(options) ||
    handleSurveyCadArcPointPick(options) ||
    handleLinePointPick(options) ||
    handleSurveyCadEditPointPick(options) ||
    handleSurveyCadParcelSplitPointPick({ current, point, replaceSession }) ||
    handleInversePointPick(options)
  ) {
    return;
  }
};

const handleLinePointPick = ({
  applyHistoryUpdate,
  current,
  point,
  replaceSession,
}: Pick<
  HandleSurveyCadConsumePointOptions,
  'applyHistoryUpdate' | 'current' | 'point' | 'replaceSession'
>): boolean => {
  if (current.key !== 'LINE') return false;
  if (!current.startPoint) {
    replaceSession({
      ...current,
      startPoint: point,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'LINE',
      start: current.startPoint!,
      end: point,
    }),
  );
  replaceSession(null);
  return true;
};
