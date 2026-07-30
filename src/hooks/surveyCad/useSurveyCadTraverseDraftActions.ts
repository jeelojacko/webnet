import {
  cadAdjustTraverse,
  cadComputeTurnedAnglePoint,
  buildCadInverseSummary,
  type CadTraverseAdjustmentMethod,
} from '../../engine/cad/cadCogo';
import type { CommandPoint, TraverseDraftMode } from './useSurveyCadCommandTypes';
import {
  buildTraverseClosureTarget,
  buildTraverseLegInputFromPoints,
} from './useSurveyCadCommandSession';
import {
  normalizeDraftPoint,
  parseAbsolutePoint,
  parseInputPoint,
  parseLeftRightAngleDistance,
} from './useSurveyCadCommandParsing';
import type { SurveyCadTraverseDraftActions, TraverseSession, UseSurveyCadTraverseDraftActionsOptions } from './useSurveyCadTraverseDraftActions.types';
import {
  commandPointsMatch,
  filterTraverseSideshotsForPoints,
  getTraverseSession,
} from './useSurveyCadTraverseDraftActions.utils';
export type { SurveyCadTraverseDraftActions } from './useSurveyCadTraverseDraftActions.types';

export const useSurveyCadTraverseDraftActions = ({
  projectStationIds,
  replaceSession,
  sessionRef,
}: UseSurveyCadTraverseDraftActionsOptions): SurveyCadTraverseDraftActions => {
  const rebuildTraverseDraftFromLegInputs = (
    current: TraverseSession,
    legInputs: string[],
    resultText?: string,
  ): TraverseSession | null => {
    const startPoint = current.points[0] ?? null;
    if (!startPoint) return current;
    const nextPoints: CommandPoint[] = [startPoint];
    for (const legInput of legInputs) {
      const parsedPoint = parseInputPoint(legInput, nextPoints[nextPoints.length - 1] ?? null);
      if (!parsedPoint) {
        replaceSession({
          ...current,
          resultText:
            'Traverse row update failed because one of the leg inputs is invalid. Use coordinates or bearing-distance values.',
        });
        return null;
      }
      nextPoints.push(
        normalizeDraftPoint(parsedPoint, nextPoints, projectStationIds, {
          rawInput: legInput,
        }),
      );
    }
    return {
      ...current,
      points: nextPoints,
      inputPoints: nextPoints,
      legInputs,
      sideshots: filterTraverseSideshotsForPoints(nextPoints, current.sideshots),
      adjustment: null,
      inputValue: '',
      resultText,
    };
  };

  const setTraverseDraftMode = (mode: TraverseDraftMode) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return;
    const isExplicitlyClosed =
      current.inputPoints.length >= 2 &&
      commandPointsMatch(current.inputPoints[0]!, current.inputPoints[current.inputPoints.length - 1]!) &&
      current.legInputs.length === current.inputPoints.length - 1;
    const nextInputPoints =
      mode !== 'closed' && isExplicitlyClosed
        ? current.inputPoints.slice(0, -1)
        : current.inputPoints;
    replaceSession({
      ...current,
      points: nextInputPoints,
      inputPoints: nextInputPoints,
      legInputs:
        mode !== 'closed' && isExplicitlyClosed
          ? current.legInputs.slice(0, -1)
          : current.legInputs,
      mode,
      closePoint: mode === 'point-to-point' ? current.closePoint : null,
      adjustment: null,
      inputValue: '',
      resultText: undefined,
    });
  };

  const setTraverseDraftClosePoint = (point: CommandPoint | null) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return;
    replaceSession({
      ...current,
      closePoint: point,
      adjustment: null,
      resultText:
        point == null
          ? 'Cleared traverse close target.'
          : `Traverse will close onto ${point.label}.`,
    });
  };

  const addTraverseDraftSideshot = (occupyPointIndex: number, inputValue: string) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return false;
    const occupyPoint = current.points[occupyPointIndex];
    const backsightPoint = current.points[occupyPointIndex - 1];
    if (!occupyPoint || !backsightPoint) return false;
    const parsed = parseLeftRightAngleDistance(inputValue);
    if (!parsed) {
      replaceSession({
        ...current,
        resultText: 'Sideshot input invalid. Use `Langle,distance` or `Rangle,distance`.',
      });
      return false;
    }
    const point = cadComputeTurnedAnglePoint({
      occupyPoint,
      backsightPoint,
      angleDeg: parsed.angleDeg,
      distance: parsed.distance,
      side: parsed.side,
    });
    replaceSession({
      ...current,
      sideshots: [
        ...current.sideshots,
        {
          occupyLabel: occupyPoint.label,
          backsightLabel: backsightPoint.label,
          side: parsed.side,
          angleDeg: parsed.angleDeg,
          distance: parsed.distance,
          inputValue,
          point: {
            label:
              parsed.label ??
              `${occupyPoint.label}-SS${(current.sideshots.filter((shot) => shot.occupyLabel === occupyPoint.label).length + 1).toString()}`,
            x: point.x,
            y: point.y,
          },
        },
      ],
      adjustment: current.adjustment
        ? {
            ...current.adjustment,
            summary: {
              ...current.adjustment.summary,
              adjustedPoints: current.adjustment.summary.adjustedPoints,
            },
          }
        : null,
      resultText: `Added sideshot from ${occupyPoint.label} with backsight ${backsightPoint.label}.`,
    });
    return true;
  };

  const removeTraverseDraftSideshot = (sideshotIndex: number) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return;
    replaceSession({
      ...current,
      sideshots: current.sideshots.filter((_, index) => index !== sideshotIndex),
      resultText: undefined,
    });
  };

  const rewindTraverseDraftToPointCount = (pointCount: number) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return;
    const nextCount = Math.max(0, Math.min(pointCount, current.inputPoints.length));
    const nextPoints = current.inputPoints.slice(0, nextCount);
    replaceSession({
      ...current,
      points: nextPoints,
      inputPoints: nextPoints,
      legInputs: current.legInputs.slice(0, Math.max(0, nextCount - 1)),
      sideshots: filterTraverseSideshotsForPoints(nextPoints, current.sideshots),
      adjustment: null,
      inputValue: '',
      resultText: undefined,
    });
  };

  const editTraverseDraftLeg = (legIndex: number) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return;
    const fromPoint = current.points[legIndex];
    const toPoint = current.points[legIndex + 1];
    if (!fromPoint || !toPoint) return;
    const inverse = buildCadInverseSummary(fromPoint, toPoint);
    replaceSession({
      ...current,
      points: current.inputPoints.slice(0, legIndex + 1),
      inputPoints: current.inputPoints.slice(0, legIndex + 1),
      legInputs: current.legInputs.slice(0, legIndex),
      inputValue: current.legInputs[legIndex] ?? `${inverse.bearing},${inverse.distance.toFixed(3)}`,
      adjustment: null,
      resultText: `Editing leg ${fromPoint.label} -> ${toPoint.label}. Update the command value and press Enter to replace downstream traverse geometry.`,
    });
  };

  const replaceTraverseDraftLeg = (legIndex: number, inputValue: string) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return false;
    const nextLegInputs = current.legInputs.map((legInput, index) =>
      index === legIndex ? inputValue : legInput,
    );
    const rebuilt = rebuildTraverseDraftFromLegInputs(
      current,
      nextLegInputs,
      `Replaced leg ${legIndex + 1}. Continue editing rows or press Enter on blank input to finish.`,
    );
    if (!rebuilt) {
      replaceSession({
        ...current,
        resultText:
          'Traverse leg input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
      });
      return false;
    }
    replaceSession(rebuilt);
    return true;
  };

  const appendTraverseDraftPoint = (inputValue: string) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return false;
    const parsedPoint =
      current.points.length === 0
        ? parseAbsolutePoint(inputValue)
        : parseInputPoint(inputValue, current.points[current.points.length - 1] ?? null);
    if (!parsedPoint) {
      replaceSession({
        ...current,
        resultText:
          current.points.length === 0
            ? 'Traverse start input invalid. Use `x,y` or `LABEL=x,y`.'
            : 'Traverse leg input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
      });
      return false;
    }
    const normalizedPoint = normalizeDraftPoint(parsedPoint, current.inputPoints, projectStationIds, {
      rawInput: inputValue,
    });
    replaceSession({
      ...current,
      points: [...current.inputPoints, normalizedPoint],
      inputPoints: [...current.inputPoints, normalizedPoint],
      legInputs:
        current.inputPoints.length === 0
          ? current.legInputs
          : [...current.legInputs, inputValue],
      adjustment: null,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  };

  const insertTraverseDraftLeg = (legIndex: number, inputValue: string) => {
    const current = getTraverseSession(sessionRef);
    if (!current || current.points.length === 0) return false;
    const nextLegInputs = [...current.legInputs];
    nextLegInputs.splice(legIndex, 0, inputValue);
    const rebuilt = rebuildTraverseDraftFromLegInputs(
      current,
      nextLegInputs,
      `Inserted leg ${legIndex + 1}. Downstream traverse rows were rebuilt from the updated sequence.`,
    );
    if (!rebuilt) {
      replaceSession({
        ...current,
        resultText:
          'Traverse leg input invalid. Use `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100`.',
      });
      return false;
    }
    replaceSession(rebuilt);
    return true;
  };

  const moveTraverseDraftLeg = (legIndex: number, direction: -1 | 1) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return false;
    const swapIndex = legIndex + direction;
    if (legIndex < 0 || legIndex >= current.legInputs.length || swapIndex < 0 || swapIndex >= current.legInputs.length) {
      return false;
    }
    const nextLegInputs = [...current.legInputs];
    const [moved] = nextLegInputs.splice(legIndex, 1);
    nextLegInputs.splice(swapIndex, 0, moved!);
    const rebuilt = rebuildTraverseDraftFromLegInputs(
      current,
      nextLegInputs,
      `Moved leg ${legIndex + 1} ${direction < 0 ? 'up' : 'down'} and rebuilt downstream traverse geometry.`,
    );
    if (!rebuilt) return false;
    replaceSession(rebuilt);
    return true;
  };

  const applyTraverseDraftAdjustment = (method: CadTraverseAdjustmentMethod) => {
    const current = getTraverseSession(sessionRef);
    if (!current) return false;
    const targetPoint = buildTraverseClosureTarget(current.mode, current.inputPoints, current.closePoint);
    if (!targetPoint || current.inputPoints.length < 2) {
      replaceSession({
        ...current,
        resultText: 'Traverse adjustment needs at least two stations and a closure target.',
      });
      return false;
    }
    const summary = cadAdjustTraverse({
      points: current.inputPoints,
      targetPoint,
      method,
    });
    if (!summary) {
      replaceSession({
        ...current,
        resultText: 'Traverse adjustment could not be computed from the current draft.',
      });
      return false;
    }
    const adjustedPoints = summary.adjustedPoints.map((point, index) => ({
      ...point,
      snapSourceEntityId: current.inputPoints[index]?.snapSourceEntityId,
      snapSourceSegmentId: current.inputPoints[index]?.snapSourceSegmentId,
      snapKind: current.inputPoints[index]?.snapKind,
    }));
    replaceSession({
      ...current,
      points: adjustedPoints,
      adjustment: {
        method,
        summary,
      },
      resultText:
        method === 'angular'
          ? `Applied angular balance. Remaining closure ${summary.adjustedClosureDistanceMeters.toFixed(3)} m.`
          : `Applied ${method === 'bowditch' ? 'Bowditch' : 'transit'} adjustment. Closure ${summary.adjustedClosureDistanceMeters.toFixed(3)} m.`,
    });
    return true;
  };

  const clearTraverseDraftAdjustment = () => {
    const current = getTraverseSession(sessionRef);
    if (!current || current.adjustment == null) return;
    replaceSession({
      ...current,
      points: current.inputPoints,
      adjustment: null,
      resultText: 'Cleared traverse adjustment and restored entered geometry.',
    });
  };

  const closeTraverseDraftLoop = () => {
    const current = getTraverseSession(sessionRef);
    if (!current || current.inputPoints.length < 3) return;
    const firstPoint = current.inputPoints[0]!;
    const lastPoint = current.inputPoints[current.inputPoints.length - 1]!;
    if (commandPointsMatch(firstPoint, lastPoint)) {
      return;
    }
    const nextInputPoints = [...current.inputPoints, firstPoint];
    replaceSession({
      ...current,
      mode: 'closed',
      points: nextInputPoints,
      inputPoints: nextInputPoints,
      legInputs: [...current.legInputs, buildTraverseLegInputFromPoints(lastPoint, firstPoint)],
      adjustment: null,
      inputValue: '',
      resultText: undefined,
    });
  };

  return {
    setTraverseDraftMode,
    setTraverseDraftClosePoint,
    addTraverseDraftSideshot,
    removeTraverseDraftSideshot,
    rewindTraverseDraftToPointCount,
    editTraverseDraftLeg,
    replaceTraverseDraftLeg,
    appendTraverseDraftPoint,
    insertTraverseDraftLeg,
    moveTraverseDraftLeg,
    applyTraverseDraftAdjustment,
    clearTraverseDraftAdjustment,
    closeTraverseDraftLoop,
  };
};
