import type { GeoidGridModel } from './geoid';
import { interpolateGeoidUndulation } from './geoid';
import type {
  CoordSystemDiagnosticCode,
  ParseOptions,
  Station,
  StationMap,
} from '../types';

type LogFn = (_message: string) => void;
type AddDiagnosticFn = (_code: CoordSystemDiagnosticCode, _warning?: string) => void;

export const applyGeoidHeightConversions = ({
  geoidInterpolation,
  geoidOutputHeightDatum,
  log,
  model,
  parseState,
  stations,
}: {
  geoidInterpolation: ParseOptions['geoidInterpolation'];
  geoidOutputHeightDatum: ParseOptions['geoidOutputHeightDatum'];
  log: LogFn;
  model: GeoidGridModel;
  parseState?: ParseOptions;
  stations: StationMap;
}): void => {
  const interpolation = geoidInterpolation ?? 'bilinear';
  const targetDatum = geoidOutputHeightDatum === 'ellipsoid' ? 'ellipsoid' : 'orthometric';
  let convertedCount = 0;
  let skippedCount = 0;
  let alreadyTargetCount = 0;
  let missingGeodeticCount = 0;
  let outsideCoverageCount = 0;

  Object.values(stations).forEach((station) => {
    if (!Number.isFinite(station.h)) return;
    const sourceDatum = station.heightType ?? 'orthometric';
    if (sourceDatum === targetDatum) {
      alreadyTargetCount += 1;
      return;
    }
    if (
      !Number.isFinite(station.latDeg ?? Number.NaN) ||
      !Number.isFinite(station.lonDeg ?? Number.NaN)
    ) {
      skippedCount += 1;
      missingGeodeticCount += 1;
      return;
    }

    const undulation = interpolateGeoidUndulation(
      model,
      station.latDeg as number,
      station.lonDeg as number,
      interpolation,
    );
    if (undulation == null || !Number.isFinite(undulation)) {
      skippedCount += 1;
      outsideCoverageCount += 1;
      return;
    }

    const delta = targetDatum === 'orthometric' ? -undulation : undulation;
    station.h += delta;
    if (Number.isFinite(station.constraintH ?? Number.NaN)) {
      station.constraintH = (station.constraintH ?? 0) + delta;
    }
    station.heightType = targetDatum;
    convertedCount += 1;
  });

  if (parseState) {
    parseState.geoidHeightConversionEnabled = true;
    parseState.geoidOutputHeightDatum = targetDatum;
    parseState.geoidConvertedStationCount = convertedCount;
    parseState.geoidSkippedStationCount = skippedCount;
  }
  log(
    `Geoid height conversion: ON (target=${targetDatum.toUpperCase()}, converted=${convertedCount}, skipped=${skippedCount}, already=${alreadyTargetCount})`,
  );
  if (missingGeodeticCount > 0) {
    log(
      `Geoid height conversion skipped ${missingGeodeticCount} station(s): missing geodetic lat/lon.`,
    );
  }
  if (outsideCoverageCount > 0) {
    log(
      `Geoid height conversion skipped ${outsideCoverageCount} station(s): outside geoid/grid coverage.`,
    );
  }
};

export const applyAverageGeoidHeightConversions = ({
  addCoordSystemDiagnostic,
  averageGeoidHeight,
  geoidOutputHeightDatum,
  log,
  parseState,
  stations,
}: {
  addCoordSystemDiagnostic: AddDiagnosticFn;
  averageGeoidHeight: number;
  geoidOutputHeightDatum: ParseOptions['geoidOutputHeightDatum'];
  log: LogFn;
  parseState?: ParseOptions;
  stations: StationMap;
}): void => {
  const undulation = averageGeoidHeight;
  if (!Number.isFinite(undulation) || Math.abs(undulation) <= 0) {
    log(
      'Warning: geoid height conversion requested but fallback average geoid height is zero/invalid; conversion skipped.',
    );
    return;
  }
  addCoordSystemDiagnostic(
    'GEOID_FALLBACK',
    `Geoid model unavailable; fallback average geoid height used (${undulation.toFixed(4)}m).`,
  );
  const targetDatum = geoidOutputHeightDatum === 'ellipsoid' ? 'ellipsoid' : 'orthometric';
  let convertedCount = 0;
  Object.values(stations).forEach((station) => {
    const currentType = station.heightType === 'ellipsoid' ? 'ellipsoid' : 'orthometric';
    if (currentType === targetDatum) return;
    const delta = targetDatum === 'orthometric' ? -undulation : undulation;
    station.h += delta;
    if (Number.isFinite(station.constraintH ?? Number.NaN)) {
      station.constraintH = (station.constraintH ?? 0) + delta;
    }
    station.heightType = targetDatum;
    convertedCount += 1;
  });
  if (parseState) {
    parseState.geoidHeightConversionEnabled = true;
    parseState.geoidOutputHeightDatum = targetDatum;
    parseState.geoidConvertedStationCount = convertedCount;
    parseState.geoidSkippedStationCount = 0;
  }
  log(
    `Geoid height conversion fallback: ON (target=${targetDatum.toUpperCase()}, avgN=${undulation.toFixed(4)}m, converted=${convertedCount})`,
  );
};

export const resolveStationEllipsoidHeight = ({
  activeGeoidModel,
  addCoordSystemDiagnostic,
  averageGeoidHeight,
  geoidInterpolation,
  station,
}: {
  activeGeoidModel: GeoidGridModel | null;
  addCoordSystemDiagnostic: AddDiagnosticFn;
  averageGeoidHeight: number;
  geoidInterpolation: ParseOptions['geoidInterpolation'];
  station: Station;
}): {
  ellipsoidHeightUsed: number;
  source: 'perStationGeoid+H' | 'avgGeoid+H' | 'providedEllipsoid' | 'assumed0';
} => {
  if (station.heightType === 'ellipsoid') {
    station.ellipsoidHeightUsed = station.h;
    station.ellipsoidHeightSource = 'providedEllipsoid';
    return { ellipsoidHeightUsed: station.h, source: 'providedEllipsoid' };
  }

  if (
    activeGeoidModel &&
    Number.isFinite(station.latDeg ?? Number.NaN) &&
    Number.isFinite(station.lonDeg ?? Number.NaN)
  ) {
    const undulation = interpolateGeoidUndulation(
      activeGeoidModel,
      station.latDeg as number,
      station.lonDeg as number,
      geoidInterpolation ?? 'bilinear',
    );
    if (Number.isFinite(undulation ?? Number.NaN)) {
      const ellipsoidHeightUsed = station.h + (undulation as number);
      station.ellipsoidHeightUsed = ellipsoidHeightUsed;
      station.ellipsoidHeightSource = 'perStationGeoid+H';
      return { ellipsoidHeightUsed, source: 'perStationGeoid+H' };
    }
  }

  if (Number.isFinite(averageGeoidHeight) && Math.abs(averageGeoidHeight) > 0) {
    const ellipsoidHeightUsed = station.h + averageGeoidHeight;
    station.ellipsoidHeightUsed = ellipsoidHeightUsed;
    station.ellipsoidHeightSource = 'avgGeoid+H';
    addCoordSystemDiagnostic(
      'GEOID_FALLBACK',
      `Station geoid fallback to average N (${averageGeoidHeight.toFixed(4)}m) applied while resolving ellipsoid heights.`,
    );
    return { ellipsoidHeightUsed, source: 'avgGeoid+H' };
  }

  station.ellipsoidHeightUsed = station.h;
  station.ellipsoidHeightSource = 'assumed0';
  addCoordSystemDiagnostic(
    'GEOID_FALLBACK',
    'Average geoid height fallback is zero/invalid while ellipsoid height is required; orthometric heights used as-is.',
  );
  return { ellipsoidHeightUsed: station.h, source: 'assumed0' };
};
