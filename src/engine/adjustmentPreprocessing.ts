import type { Observation, StationId, StationMap } from '../types';
import { buildCoordinateConstraints, summarizeCoordinateConstraints } from './adjustmentConstraints';
import type {
  ControlConstraintSummary,
  CoordinateConstraintEquation,
  SolveParameterIndex,
} from './adjustmentSolveTypes';

export interface SolvePreparationResult {
  directionSetIds: string[];
  paramIndex: SolveParameterIndex;
  stationParamCount: number;
  constraints: CoordinateConstraintEquation[];
  controlConstraints: ControlConstraintSummary;
  numParams: number;
  numObsEquations: number;
  dirParamMap: Record<string, number>;
  autoDroppedHeights: StationId[];
}

export const collectDirectionSetIds = (activeObservations: Observation[]): string[] =>
  Array.from(
    new Set(
      activeObservations
        .filter((observation) => observation.type === 'direction')
        .map((observation) => observation.setId),
    ),
  ).filter((setId): setId is string => typeof setId === 'string' && setId.length > 0);

const collectVerticalSensitiveStations = (
  activeObservations: Observation[],
  is2D: boolean,
): Set<StationId> => {
  const hasVertical = new Set<StationId>();
  if (is2D) return hasVertical;
  const mark = (stationId?: StationId) => {
    if (stationId) hasVertical.add(stationId);
  };
  activeObservations.forEach((observation) => {
    if (observation.type === 'lev' || observation.type === 'zenith') {
      mark(observation.from);
      mark(observation.to);
      return;
    }
    if (observation.type === 'dist' && observation.mode === 'slope') {
      mark(observation.from);
      mark(observation.to);
    }
  });
  return hasVertical;
};

export const applyAutomaticHeightHolds = (
  stations: StationMap,
  unknowns: StationId[],
  activeObservations: Observation[],
  is2D: boolean,
): StationId[] => {
  if (is2D) return [];
  const hasVertical = collectVerticalSensitiveStations(activeObservations, is2D);
  const autoDropped: StationId[] = [];
  unknowns.forEach((stationId) => {
    const station = stations[stationId];
    if (!station) return;
    if (station.fixedH) return;
    if (hasVertical.has(stationId)) return;
    station.fixedH = true;
    station.fixed = !!station.fixedX && !!station.fixedY && !!station.fixedH;
    autoDropped.push(stationId);
  });
  return autoDropped;
};

export const buildSolveParameterIndex = (
  stations: StationMap,
  unknowns: StationId[],
  is2D: boolean,
): { paramIndex: SolveParameterIndex; stationParamCount: number } => {
  const paramIndex: SolveParameterIndex = {};
  let stationParamCount = 0;
  unknowns.forEach((stationId) => {
    const station = stations[stationId];
    if (!station) return;
    const indexEntry: SolveParameterIndex[StationId] = {};
    if (!station.fixedX) {
      indexEntry.x = stationParamCount;
      stationParamCount += 1;
    }
    if (!station.fixedY) {
      indexEntry.y = stationParamCount;
      stationParamCount += 1;
    }
    if (!is2D && !station.fixedH) {
      indexEntry.h = stationParamCount;
      stationParamCount += 1;
    }
    if (indexEntry.x != null || indexEntry.y != null || indexEntry.h != null) {
      paramIndex[stationId] = indexEntry;
    }
  });
  return { paramIndex, stationParamCount };
};

export const buildSolvePreparation = (
  stations: StationMap,
  unknowns: StationId[],
  activeObservations: Observation[],
  is2D: boolean,
): SolvePreparationResult => {
  const autoDroppedHeights = applyAutomaticHeightHolds(
    stations,
    unknowns,
    activeObservations,
    is2D,
  );
  const directionSetIds = collectDirectionSetIds(activeObservations);
  const { paramIndex, stationParamCount } = buildSolveParameterIndex(stations, unknowns, is2D);
  const constraints = buildCoordinateConstraints(stations, paramIndex, is2D);
  const controlConstraints = summarizeCoordinateConstraints(constraints);
  const numParams = stationParamCount + directionSetIds.length;
  const numObsEquations =
    activeObservations.reduce(
      (count, observation) => count + (observation.type === 'gps' ? 2 : 1),
      0,
    ) + constraints.length;
  const dirParamMap: Record<string, number> = {};
  directionSetIds.forEach((setId, index) => {
    dirParamMap[setId] = stationParamCount + index;
  });
  return {
    directionSetIds,
    paramIndex,
    stationParamCount,
    constraints,
    controlConstraints,
    numParams,
    numObsEquations,
    dirParamMap,
    autoDroppedHeights,
  };
};
