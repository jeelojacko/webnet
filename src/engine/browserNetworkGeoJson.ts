import { buildStationPairKey } from './resultDerivedModels';
import { getRelativePrecisionRows, getStationPrecision } from './resultPrecision';
import {
  formatArcSeconds,
  formatNumber,
  FT_PER_M,
} from './browserExportFormatting';
import type { AdjustmentResult, Observation, PrecisionReportingMode, Station } from '../types';

type GeoJsonGeometry =
  | { type: 'Point'; coordinates: [number, number, number] }
  | { type: 'LineString'; coordinates: [[number, number, number], [number, number, number]] };

interface GeoJsonFeature {
  type: 'Feature';
  id: string;
  geometry: GeoJsonGeometry;
  properties: Record<string, unknown>;
}

const buildStationKind = (station: Station): 'adjusted' | 'fixed' | 'lost' =>
  station.lost ? 'lost' : station.fixed ? 'fixed' : 'adjusted';

const activeObservationConnectionPairs = (
  obs: Observation,
): Array<{ from: string; to: string; type: string }> => {
  if (obs.type === 'angle') {
    return [
      { from: obs.at, to: obs.from, type: 'angle-ray' },
      { from: obs.at, to: obs.to, type: 'angle-ray' },
    ];
  }
  if (obs.type === 'direction') {
    return [{ from: obs.at, to: obs.to, type: 'direction' }];
  }
  if (
    obs.type === 'dist' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'gps' ||
    obs.type === 'lev' ||
    obs.type === 'zenith'
  ) {
    return [{ from: obs.from, to: obs.to, type: obs.type }];
  }
  return [];
};

const isSideshotObservation = (obs: Observation): boolean =>
  (typeof obs.calc === 'object' &&
    obs.calc != null &&
    'sideshot' in obs.calc &&
    Boolean((obs.calc as { sideshot?: boolean }).sideshot)) ||
  (obs.type === 'gps' && obs.gpsMode === 'sideshot');

const isActiveObservation = (result: AdjustmentResult, obs: Observation): boolean =>
  result.preanalysisMode ? obs.calc != null || obs.planned === true : obs.residual != null || obs.calc != null;

export const buildNetworkGeoJsonText = (params: {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  precisionReportingMode?: PrecisionReportingMode;
  includeLostStations?: boolean;
}): string => {
  const { result, units, precisionReportingMode = 'industry-standard', includeLostStations = true } = params;
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const descriptions = result.parseState?.reconciledDescriptions ?? {};
  const visibleStationIds = Object.entries(result.stations)
    .filter(([, station]) => includeLostStations || !station.lost)
    .map(([stationId]) => stationId)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const visibleStationSet = new Set(visibleStationIds);
  const stationFeatures: GeoJsonFeature[] = visibleStationIds.map((stationId) => {
    const station = result.stations[stationId];
    const precision = getStationPrecision(result, stationId, precisionReportingMode);
    return {
      type: 'Feature',
      id: `station:${stationId}`,
      geometry: {
        type: 'Point',
        coordinates: [station.x * unitScale, station.y * unitScale, station.h * unitScale],
      },
      properties: {
        featureType: 'station',
        stationId,
        description: descriptions[stationId] ?? '',
        kind: buildStationKind(station),
        fixed: station.fixed,
        lost: station.lost === true,
        sigmaN: precision.sigmaN != null ? Number(formatNumber(precision.sigmaN * unitScale, 4)) : null,
        sigmaE: precision.sigmaE != null ? Number(formatNumber(precision.sigmaE * unitScale, 4)) : null,
        sigmaH: precision.sigmaH != null ? Number(formatNumber(precision.sigmaH * unitScale, 4)) : null,
        ellipseSemiMajor:
          precision.ellipse?.semiMajor != null
            ? Number(formatNumber(precision.ellipse.semiMajor * unitScale, 4))
            : null,
        ellipseSemiMinor:
          precision.ellipse?.semiMinor != null
            ? Number(formatNumber(precision.ellipse.semiMinor * unitScale, 4))
            : null,
        ellipseAzimuthDeg:
          precision.ellipse?.theta != null
            ? Number(formatNumber(precision.ellipse.theta, 4))
            : null,
      },
    };
  });

  const relativePrecisionMap = new Map(
    getRelativePrecisionRows(result, precisionReportingMode).flatMap((row) => {
      const forward = [`${row.from}|${row.to}`, row] as const;
      const reverse = [`${row.to}|${row.from}`, row] as const;
      return [forward, reverse];
    }),
  );
  const connectionMap = new Map<
    string,
    {
      from: string;
      to: string;
      observationTypes: Set<string>;
      sourceLines: Set<number>;
      sigmaDist?: number;
      sigmaAz?: number;
    }
  >();

  (result.observations ?? []).forEach((obs) => {
    if (isSideshotObservation(obs) || !isActiveObservation(result, obs)) return;
    activeObservationConnectionPairs(obs).forEach((pair) => {
      if (!visibleStationSet.has(pair.from) || !visibleStationSet.has(pair.to)) return;
      const pairKey = buildStationPairKey(pair.from, pair.to);
      const [from, to] = pairKey.split('|');
      const existing = connectionMap.get(pairKey) ?? {
        from,
        to,
        observationTypes: new Set<string>(),
        sourceLines: new Set<number>(),
      };
      existing.observationTypes.add(pair.type);
      if (obs.sourceLine != null) existing.sourceLines.add(obs.sourceLine);
      if (existing.sigmaDist == null || existing.sigmaAz == null) {
        const relative = relativePrecisionMap.get(`${pair.from}|${pair.to}`);
        if (relative) {
          existing.sigmaDist =
            relative.sigmaDist != null ? relative.sigmaDist * unitScale : existing.sigmaDist;
          existing.sigmaAz = relative.sigmaAz;
        }
      }
      connectionMap.set(pairKey, existing);
    });
  });

  const connectionFeatures: GeoJsonFeature[] = [...connectionMap.values()]
    .sort(
      (a, b) =>
        a.from.localeCompare(b.from, undefined, { numeric: true }) ||
        a.to.localeCompare(b.to, undefined, { numeric: true }),
    )
    .map((connection) => {
      const fromStation = result.stations[connection.from];
      const toStation = result.stations[connection.to];
      return {
        type: 'Feature',
        id: `connection:${connection.from}|${connection.to}`,
        geometry: {
          type: 'LineString',
          coordinates: [
            [fromStation.x * unitScale, fromStation.y * unitScale, fromStation.h * unitScale],
            [toStation.x * unitScale, toStation.y * unitScale, toStation.h * unitScale],
          ],
        },
        properties: {
          featureType: 'connection',
          from: connection.from,
          to: connection.to,
          observationTypes: [...connection.observationTypes].sort(),
          sourceLines: [...connection.sourceLines].sort((a, b) => a - b),
          sigmaDist:
            connection.sigmaDist != null ? Number(formatNumber(connection.sigmaDist, 4)) : null,
          sigmaAzArcSec:
            connection.sigmaAz != null
              ? Number(formatArcSeconds(connection.sigmaAz))
              : null,
        },
      };
    });

  return JSON.stringify(
    {
      type: 'FeatureCollection',
      name: 'WebNet Adjustment Network',
      properties: {
        generatedAt: new Date().toISOString(),
        units,
        coordMode: result.parseState?.coordMode ?? '3D',
        preanalysis: result.preanalysisMode === true,
        stationCount: stationFeatures.length,
        connectionCount: connectionFeatures.length,
        includeLostStations,
      },
      features: [...stationFeatures, ...connectionFeatures],
    },
    null,
    2,
  );
};
