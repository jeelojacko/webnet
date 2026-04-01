import type { Observation, StationId, StationMap } from '../types';
import {
  buildCoordinateConstraints,
  summarizeCoordinateConstraints,
} from './adjustmentConstraints';
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

export const isObservationActiveForSolve = (
  observation: Observation,
  excludeIds: Set<number> | undefined,
  is2D: boolean,
): boolean => {
  if (excludeIds?.has(observation.id)) return false;
  if (observation.type === 'gps' && observation.gpsMode === 'sideshot') return false;
  if (
    typeof observation.calc === 'object' &&
    (observation.calc as { sideshot?: boolean }).sideshot
  ) {
    return false;
  }
  if (is2D && (observation.type === 'lev' || observation.type === 'zenith')) return false;
  return true;
};

export const collectActiveObservationsForSolve = (
  observations: Observation[],
  excludeIds: Set<number> | undefined,
  is2D: boolean,
): Observation[] =>
  observations.filter((observation) => isObservationActiveForSolve(observation, excludeIds, is2D));

export const applyAutoDroppedHeightHolds = (
  stations: StationMap,
  autoDroppedHeights: StationId[],
): void => {
  autoDroppedHeights.forEach((stationId) => {
    const station = stations[stationId];
    if (!station || station.fixedH) return;
    station.fixedH = true;
    station.fixed = !!station.fixedX && !!station.fixedY && !!station.fixedH;
  });
};

export const cloneSolvePreparationResult = (
  solvePreparation: SolvePreparationResult,
): SolvePreparationResult => ({
  directionSetIds: [...solvePreparation.directionSetIds],
  paramIndex: Object.fromEntries(
    Object.entries(solvePreparation.paramIndex).map(([stationId, entry]) => [
      stationId,
      { ...entry },
    ]),
  ),
  stationParamCount: solvePreparation.stationParamCount,
  constraints: solvePreparation.constraints.map((constraint) => ({ ...constraint })),
  controlConstraints: { ...solvePreparation.controlConstraints },
  numParams: solvePreparation.numParams,
  numObsEquations: solvePreparation.numObsEquations,
  dirParamMap: { ...solvePreparation.dirParamMap },
  autoDroppedHeights: [...solvePreparation.autoDroppedHeights],
});

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
    if (observation.type === 'gps' && Number.isFinite(observation.obs.dU ?? Number.NaN)) {
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

const collectHorizontalSensitiveStations = (activeObservations: Observation[]): Set<StationId> => {
  const hasHorizontal = new Set<StationId>();
  const mark = (stationId?: StationId) => {
    if (stationId) hasHorizontal.add(stationId);
  };
  activeObservations.forEach((observation) => {
    if (observation.type === 'lev' || observation.type === 'zenith') {
      return;
    }
    if (observation.type === 'angle') {
      mark(observation.at);
      mark(observation.from);
      mark(observation.to);
      return;
    }
    if (observation.type === 'direction' || observation.type === 'dir') {
      if (observation.type === 'direction') {
        mark(observation.at);
        mark(observation.to);
      } else {
        mark(observation.from);
        mark(observation.to);
      }
      return;
    }
    mark((observation as Observation & { from?: StationId }).from);
    mark((observation as Observation & { to?: StationId }).to);
  });
  return hasHorizontal;
};

const applyAutomaticHorizontalHolds = (
  stations: StationMap,
  unknowns: StationId[],
  activeObservations: Observation[],
): void => {
  const hasHorizontal = collectHorizontalSensitiveStations(activeObservations);
  unknowns.forEach((stationId) => {
    const station = stations[stationId];
    if (!station || hasHorizontal.has(stationId)) return;
    if (!station.fixedX) station.fixedX = true;
    if (!station.fixedY) station.fixedY = true;
    station.fixed = !!station.fixedX && !!station.fixedY && !!station.fixedH;
  });
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
  applyAutomaticHorizontalHolds(stations, unknowns, activeObservations);
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
      (count, observation) =>
        count +
        (observation.type === 'gps' && !is2D && Number.isFinite(observation.obs.dU ?? Number.NaN)
          ? 3
          : observation.type === 'gps'
            ? 2
            : 1),
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
