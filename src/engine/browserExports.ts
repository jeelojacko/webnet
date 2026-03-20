import { RAD_TO_DEG } from './angles';
import { buildStationPairKey, formatObservationStationsLabel } from './resultDerivedModels';
import { getRelativePrecisionRows, getStationPrecision } from './resultPrecision';
import type {
  AdjustmentResult,
  Observation,
  PrecisionReportingMode,
  Station,
} from '../types';

const FT_PER_M = 3.280839895;

const csvEscape = (value: string): string => {
  if (value.length === 0) return '';
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
};

const csvRow = (values: Array<string | number | boolean | null | undefined>): string =>
  values
    .map((value) => {
      if (value == null) return '';
      if (typeof value === 'boolean') return value ? 'true' : 'false';
      return csvEscape(String(value));
    })
    .join(',');

const formatNumber = (value: number | null | undefined, digits: number): string => {
  if (value == null || !Number.isFinite(value)) return '';
  const normalized = Math.abs(value) < 5e-13 ? 0 : value;
  return normalized.toFixed(digits);
};

const formatLinear = (value: number | null | undefined, unitScale: number): string =>
  formatNumber(value == null ? null : value * unitScale, 4);

const formatDegrees = (value: number | null | undefined): string =>
  formatNumber(value == null ? null : value * RAD_TO_DEG, 8);

const formatArcSeconds = (value: number | null | undefined): string =>
  formatNumber(value == null ? null : value * RAD_TO_DEG * 3600, 3);

const buildObservationStatus = (obs: Observation): string => {
  const sideshot =
    (typeof obs.calc === 'object' &&
      obs.calc != null &&
      'sideshot' in obs.calc &&
      Boolean((obs.calc as { sideshot?: boolean }).sideshot)) ||
    (obs.type === 'gps' && obs.gpsMode === 'sideshot');
  if (sideshot) return 'post-adjust-only';
  if (obs.planned && obs.calc != null && obs.residual == null) return 'preanalysis';
  if (obs.planned && obs.calc == null && obs.residual == null) return 'planned';
  if (obs.calc != null || obs.residual != null) return 'active';
  return 'inactive';
};

const isAngularObservation = (obs: Observation): boolean =>
  obs.type === 'angle' ||
  obs.type === 'direction' ||
  obs.type === 'bearing' ||
  obs.type === 'dir' ||
  obs.type === 'zenith';

const observationEndpoints = (
  obs: Observation,
): { fromStation: string; atStation: string; toStation: string } => {
  if (obs.type === 'angle') {
    return {
      fromStation: obs.from,
      atStation: obs.at,
      toStation: obs.to,
    };
  }
  if (obs.type === 'direction') {
    return {
      fromStation: '',
      atStation: obs.at,
      toStation: obs.to,
    };
  }
  if ('from' in obs && 'to' in obs) {
    return {
      fromStation: obs.from,
      atStation: '',
      toStation: obs.to,
    };
  }
  return {
    fromStation: '',
    atStation: '',
    toStation: '',
  };
};

const observationMode = (obs: Observation): string => {
  if (obs.type === 'dist') return obs.mode ?? '';
  if (obs.type === 'gps') return obs.gpsMode ?? '';
  return '';
};

const observationUnits = (
  obs: Observation,
  linearUnitLabel: string,
): { observedUnit: string; residualUnit: string; sigmaUnit: string } => {
  if (obs.type === 'gps') {
    return {
      observedUnit: `${linearUnitLabel} (${linearUnitLabel} E/${linearUnitLabel} N)`,
      residualUnit: `${linearUnitLabel} (${linearUnitLabel} E/${linearUnitLabel} N)`,
      sigmaUnit: linearUnitLabel,
    };
  }
  if (isAngularObservation(obs)) {
    return {
      observedUnit: 'deg',
      residualUnit: 'arcsec',
      sigmaUnit: 'arcsec',
    };
  }
  return {
    observedUnit: linearUnitLabel,
    residualUnit: linearUnitLabel,
    sigmaUnit: linearUnitLabel,
  };
};

const buildObservationValueFields = (
  obs: Observation,
  unitScale: number,
): {
  observedValue: string;
  observedDeltaE: string;
  observedDeltaN: string;
  calculatedValue: string;
  calculatedDeltaE: string;
  calculatedDeltaN: string;
  residualValue: string;
  residualDeltaE: string;
  residualDeltaN: string;
  stdDevValue: string;
  stdDevE: string;
  stdDevN: string;
  corrEN: string;
  redundancyValue: string;
  redundancyE: string;
  redundancyN: string;
  stdResValue: string;
  stdResE: string;
  stdResN: string;
  localTestPass: string;
  localTestCritical: string;
  localTestPassE: string;
  localTestPassN: string;
  mdbValue: string;
  mdbE: string;
  mdbN: string;
  effectiveDistance: string;
} => {
  const base = {
    observedValue: '',
    observedDeltaE: '',
    observedDeltaN: '',
    calculatedValue: '',
    calculatedDeltaE: '',
    calculatedDeltaN: '',
    residualValue: '',
    residualDeltaE: '',
    residualDeltaN: '',
    stdDevValue: '',
    stdDevE: '',
    stdDevN: '',
    corrEN: '',
    redundancyValue: '',
    redundancyE: '',
    redundancyN: '',
    stdResValue: formatNumber(obs.stdRes, 3),
    stdResE: formatNumber(obs.stdResComponents?.tE, 3),
    stdResN: formatNumber(obs.stdResComponents?.tN, 3),
    localTestPass:
      typeof obs.localTest?.pass === 'boolean' ? String(obs.localTest.pass) : '',
    localTestCritical: formatNumber(obs.localTest?.critical, 3),
    localTestPassE:
      typeof obs.localTestComponents?.passE === 'boolean'
        ? String(obs.localTestComponents.passE)
        : '',
    localTestPassN:
      typeof obs.localTestComponents?.passN === 'boolean'
        ? String(obs.localTestComponents.passN)
        : '',
    mdbValue: '',
    mdbE: formatLinear(obs.mdbComponents?.mE, unitScale),
    mdbN: formatLinear(obs.mdbComponents?.mN, unitScale),
    effectiveDistance: formatLinear(obs.effectiveDistance, unitScale),
  };

  if (obs.type === 'gps') {
    return {
      ...base,
      observedDeltaE: formatLinear(obs.obs.dE, unitScale),
      observedDeltaN: formatLinear(obs.obs.dN, unitScale),
      calculatedDeltaE: formatLinear(obs.calc?.dE, unitScale),
      calculatedDeltaN: formatLinear(obs.calc?.dN, unitScale),
      residualDeltaE: formatLinear(obs.residual?.vE, unitScale),
      residualDeltaN: formatLinear(obs.residual?.vN, unitScale),
      stdDevE: formatLinear(obs.weightingStdDevE ?? obs.stdDevE, unitScale),
      stdDevN: formatLinear(obs.weightingStdDevN ?? obs.stdDevN, unitScale),
      corrEN: formatNumber(obs.corrEN, 6),
      redundancyE: formatNumber(
        typeof obs.redundancy === 'object' ? obs.redundancy.rE : null,
        3,
      ),
      redundancyN: formatNumber(
        typeof obs.redundancy === 'object' ? obs.redundancy.rN : null,
        3,
      ),
    };
  }

  const scalarObserved = 'obs' in obs && typeof obs.obs === 'number' ? obs.obs : null;
  const scalarCalculated = typeof obs.calc === 'number' ? obs.calc : null;
  const scalarResidual = typeof obs.residual === 'number' ? obs.residual : null;
  const isAngular = isAngularObservation(obs);

  return {
    ...base,
    observedValue: isAngular ? formatDegrees(scalarObserved) : formatLinear(scalarObserved, unitScale),
    calculatedValue: isAngular
      ? formatDegrees(scalarCalculated)
      : formatLinear(scalarCalculated, unitScale),
    residualValue: isAngular
      ? formatArcSeconds(scalarResidual)
      : formatLinear(scalarResidual, unitScale),
    stdDevValue: isAngular
      ? formatArcSeconds(obs.weightingStdDev ?? obs.stdDev)
      : formatLinear(obs.weightingStdDev ?? obs.stdDev, unitScale),
    redundancyValue:
      typeof obs.redundancy === 'number' ? formatNumber(obs.redundancy, 3) : '',
    mdbValue: isAngular ? formatArcSeconds(obs.mdb) : formatLinear(obs.mdb, unitScale),
  };
};

export const OBSERVATIONS_RESIDUALS_CSV_COLUMNS = [
  'obsId',
  'status',
  'type',
  'stations',
  'sourceLine',
  'sourceFile',
  'instCode',
  'setId',
  'planned',
  'sigmaSource',
  'mode',
  'fromStation',
  'atStation',
  'toStation',
  'observedValue',
  'observedDeltaE',
  'observedDeltaN',
  'calculatedValue',
  'calculatedDeltaE',
  'calculatedDeltaN',
  'residualValue',
  'residualDeltaE',
  'residualDeltaN',
  'stdDev',
  'stdDevE',
  'stdDevN',
  'corrEN',
  'stdRes',
  'stdResE',
  'stdResN',
  'redundancy',
  'redundancyE',
  'redundancyN',
  'localTestPass',
  'localTestCritical',
  'localTestPassE',
  'localTestPassN',
  'mdb',
  'mdbE',
  'mdbN',
  'effectiveDistance',
  'observedUnit',
  'residualUnit',
  'sigmaUnit',
] as const;

export const buildObservationsResidualsCsvText = (params: {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  precisionReportingMode?: PrecisionReportingMode;
}): string => {
  const { result, units } = params;
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const linearUnitLabel = units === 'ft' ? 'ft' : 'm';
  const lines = [csvRow([...OBSERVATIONS_RESIDUALS_CSV_COLUMNS])];

  [...(result.observations ?? [])]
    .sort((a, b) => a.id - b.id)
    .forEach((obs) => {
      const endpoints = observationEndpoints(obs);
      const unitsRow = observationUnits(obs, linearUnitLabel);
      const values = buildObservationValueFields(obs, unitScale);
      lines.push(
        csvRow([
          obs.id,
          buildObservationStatus(obs),
          obs.type,
          formatObservationStationsLabel(obs),
          obs.sourceLine ?? '',
          obs.sourceFile ?? '',
          obs.instCode,
          obs.setId ?? '',
          obs.planned === true,
          obs.sigmaSource ?? '',
          observationMode(obs),
          endpoints.fromStation,
          endpoints.atStation,
          endpoints.toStation,
          values.observedValue,
          values.observedDeltaE,
          values.observedDeltaN,
          values.calculatedValue,
          values.calculatedDeltaE,
          values.calculatedDeltaN,
          values.residualValue,
          values.residualDeltaE,
          values.residualDeltaN,
      values.stdDevValue,
      values.stdDevE,
      values.stdDevN,
          values.corrEN,
          values.stdResValue,
          values.stdResE,
          values.stdResN,
          values.redundancyValue,
          values.redundancyE,
          values.redundancyN,
          values.localTestPass,
          values.localTestCritical,
          values.localTestPassE,
          values.localTestPassN,
          values.mdbValue,
          values.mdbE,
          values.mdbN,
          values.effectiveDistance,
          unitsRow.observedUnit,
          unitsRow.residualUnit,
          unitsRow.sigmaUnit,
        ]),
      );
    });

  return lines.join('\n');
};

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
