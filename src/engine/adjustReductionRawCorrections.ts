import { DEG_TO_RAD, RAD_TO_DEG } from './angles';
import {
  computeElevationFactor,
  computeGridFactors,
  projectGeodeticToEN,
} from './geodesy';
import type { Observation, ParseOptions, StationId, StationMap } from '../types';
import type { StationFactorSnapshot } from './adjustReductionTypes';

export const measuredAngleCorrection = ({
  coordSystemMode,
  from,
  stationFactorSnapshot,
  to,
}: {
  coordSystemMode: ParseOptions['coordSystemMode'];
  from: StationId;
  stationFactorSnapshot: (_stationId: StationId) => StationFactorSnapshot;
  to: StationId;
}): number => {
  if (coordSystemMode !== 'grid') return 0;
  const convFrom = stationFactorSnapshot(from).convergenceAngleRad;
  const convTo = stationFactorSnapshot(to).convergenceAngleRad;
  return convTo - convFrom;
};

export const rawDistanceCombinedFactor = ({
  coordSystemMode,
  crsId,
  obs,
  stationEllipsoidHeight,
  stationFactorSnapshot,
  stationGeodetic,
  stations,
}: {
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsId: string;
  obs: Observation & { type: 'dist' };
  stationEllipsoidHeight: (_station: StationMap[string]) => number;
  stationFactorSnapshot: (_stationId: StationId) => StationFactorSnapshot;
  stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
  stations: StationMap;
}): number => {
  const fromF = stationFactorSnapshot(obs.from);
  const toF = stationFactorSnapshot(obs.to);
  const averageCombined = (fromF.combinedFactor + toF.combinedFactor) / 2;
  if (coordSystemMode !== 'grid') return averageCombined;

  const fromGeo = stationGeodetic(obs.from);
  const toGeo = stationGeodetic(obs.to);
  const fromStation = stations[obs.from];
  const toStation = stations[obs.to];
  if (!fromGeo || !toGeo || !fromStation || !toStation) return averageCombined;

  const midpointFactors = computeGridFactors(
    (fromGeo.latDeg + toGeo.latDeg) / 2,
    (fromGeo.lonDeg + toGeo.lonDeg) / 2,
    crsId,
  );
  if (!midpointFactors) return averageCombined;

  const meanEllipsoidHeight =
    (stationEllipsoidHeight(fromStation) + stationEllipsoidHeight(toStation)) / 2;
  return midpointFactors.gridScaleFactor * computeElevationFactor(meanEllipsoidHeight);
};

export const rawDirectionSetCorrection = ({
  coordSystemMode,
  crsId,
  obs,
  parseState,
  stationGeodetic,
  stations,
  wrapToPi,
}: {
  coordSystemMode: ParseOptions['coordSystemMode'];
  crsId: string;
  obs: Observation & { type: 'direction' };
  parseState?: ParseOptions;
  stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
  stations: StationMap;
  wrapToPi: (_value: number) => number;
}): number => {
  if (coordSystemMode !== 'grid') return 0;
  const fromStation = stations[obs.at];
  const toStation = stations[obs.to];
  const fromGeo = stationGeodetic(obs.at);
  const toGeo = stationGeodetic(obs.to);
  if (!fromStation || !toStation || !fromGeo || !toGeo) return 0;
  const lat1 = fromGeo.latDeg * DEG_TO_RAD;
  const lon1 = fromGeo.lonDeg * DEG_TO_RAD;
  const lat2 = toGeo.latDeg * DEG_TO_RAD;
  const lon2 = toGeo.lonDeg * DEG_TO_RAD;
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = Math.atan2(y, x);
  const hav =
    Math.sin((lat2 - lat1) / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  const centralAngle = 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(hav, 0))));
  if (!Number.isFinite(centralAngle) || centralAngle <= 0) return 0;
  const step = Math.min(centralAngle * 1e-2, 1e-6);
  if (!Number.isFinite(step) || step <= 0) return 0;
  const nearLat = Math.asin(
    Math.sin(lat1) * Math.cos(step) + Math.cos(lat1) * Math.sin(step) * Math.cos(bearing),
  );
  const nearLon =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(step) * Math.cos(lat1),
      Math.cos(step) - Math.sin(lat1) * Math.sin(nearLat),
    );
  const nearProjected = projectGeodeticToEN({
    latDeg: nearLat * RAD_TO_DEG,
    lonDeg: nearLon * RAD_TO_DEG,
    originLatDeg: parseState?.originLatDeg ?? fromGeo.latDeg,
    originLonDeg: parseState?.originLonDeg ?? fromGeo.lonDeg,
    model: parseState?.crsProjectionModel ?? 'legacy-equirectangular',
    coordSystemMode,
    crsId,
  });
  const tangentAz = Math.atan2(
    nearProjected.east - fromStation.x,
    nearProjected.north - fromStation.y,
  );
  const chordAz = Math.atan2(toStation.x - fromStation.x, toStation.y - fromStation.y);
  return wrapToPi(chordAz - tangentAz);
};

export const captureRawTraverseDistanceFactorSnapshots = (
  activeObservations: Observation[],
  parseState: ParseOptions | undefined,
  rawDistanceCombinedFactor: (_obs: Observation & { type: 'dist' }) => number,
): void => {
  if (!parseState) return;

  const rawDistanceCombinedFactorByObsId: Record<number, number> = {};
  activeObservations.forEach((obs) => {
    if (obs.type !== 'dist') return;
    rawDistanceCombinedFactorByObsId[obs.id] = rawDistanceCombinedFactor(obs);
  });
  parseState.rawDistanceCombinedFactorByObsId = rawDistanceCombinedFactorByObsId;
};

export const captureRawTraverseDirectionCorrections = (
  activeObservations: Observation[],
  parseState: ParseOptions | undefined,
  rawDirectionSetCorrection: (_obs: Observation & { type: 'direction' }) => number,
): void => {
  if (!parseState) return;
  const directionGroups = new Map<string, Array<Observation & { type: 'direction' }>>();
  activeObservations
    .filter((obs): obs is Observation & { type: 'direction' } => obs.type === 'direction')
    .sort((a, b) => {
      const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
      const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
      if (aLine !== bLine) return aLine - bLine;
      return a.id - b.id;
    })
    .forEach((obs) => {
      const group = directionGroups.get(obs.setId) ?? [];
      group.push(obs);
      directionGroups.set(obs.setId, group);
    });

  const rawDirectionSetCorrectionByObsId: Record<number, number> = {};
  directionGroups.forEach((group) => {
    group.forEach((obs) => {
      rawDirectionSetCorrectionByObsId[obs.id] = rawDirectionSetCorrection(obs);
    });
  });
  parseState.rawDirectionSetCorrectionByObsId = rawDirectionSetCorrectionByObsId;
};
