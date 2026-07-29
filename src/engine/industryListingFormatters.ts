import { RAD_TO_DEG } from './angles';
import type { Observation } from '../types';

export * from './industryListingClassicFormatters';

const observationStationSortKey = (obs: Observation): string =>
  obs.type === 'angle'
    ? `${obs.at}-${obs.from}-${obs.to}`
    : obs.type === 'direction'
      ? `${obs.at}-${obs.to}`
      : `${obs.from}-${obs.to}`;

export const compareIndustryObservationsByInput = (a: Observation, b: Observation): number => {
  const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
  const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
  if (aLine !== bLine) return aLine - bLine;
  return (a.id ?? 0) - (b.id ?? 0);
};

export const compareIndustryObservationsByStations = (a: Observation, b: Observation): number => {
  const cmp = observationStationSortKey(a).localeCompare(observationStationSortKey(b), undefined, {
    numeric: true,
  });
  if (cmp !== 0) return cmp;
  return compareIndustryObservationsByInput(a, b);
};

export const getIndustryObservationResidualSortMagnitude = (obs: Observation): number => {
  if (obs.type === 'gps') {
    const gpsResidual = obs.residual as { vE?: number; vN?: number; vU?: number } | undefined;
    if (!gpsResidual || !Number.isFinite(gpsResidual.vE) || !Number.isFinite(gpsResidual.vN)) {
      return Number.NEGATIVE_INFINITY;
    }
    const vU = Number.isFinite(gpsResidual.vU) ? (gpsResidual.vU as number) : 0;
    return Math.hypot(gpsResidual.vE as number, gpsResidual.vN as number, vU);
  }
  if (typeof obs.residual !== 'number' || !Number.isFinite(obs.residual)) {
    return Number.NEGATIVE_INFINITY;
  }
  if (
    obs.type === 'angle' ||
    obs.type === 'direction' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith'
  ) {
    return -obs.residual * RAD_TO_DEG * 3600;
  }
  return -obs.residual;
};

export const getIndustryObservationStdErrorSortMagnitude = (obs: Observation): number => {
  if (obs.type === 'gps') {
    const stdDevU = Number.isFinite(obs.stdDevU) ? (obs.stdDevU as number) : 0;
    const sigmaE = Number.isFinite(obs.weightingStdDevE)
      ? (obs.weightingStdDevE as number)
      : Number.isFinite(obs.stdDevE)
        ? (obs.stdDevE as number)
        : Number.isFinite(obs.weightingStdDev)
          ? (obs.weightingStdDev as number)
          : Number.isFinite(obs.stdDev)
            ? (obs.stdDev as number)
            : Number.NaN;
    const sigmaN = Number.isFinite(obs.weightingStdDevN)
      ? (obs.weightingStdDevN as number)
      : Number.isFinite(obs.stdDevN)
        ? (obs.stdDevN as number)
        : Number.isFinite(obs.weightingStdDev)
          ? (obs.weightingStdDev as number)
          : Number.isFinite(obs.stdDev)
            ? (obs.stdDev as number)
            : Number.NaN;
    if (!Number.isFinite(sigmaE) || !Number.isFinite(sigmaN)) return Number.NEGATIVE_INFINITY;
    return Math.hypot(sigmaE, sigmaN, stdDevU);
  }
  const sigma = Number.isFinite(obs.weightingStdDev)
    ? (obs.weightingStdDev as number)
    : Number.isFinite(obs.stdDev)
      ? (obs.stdDev as number)
      : Number.NaN;
  if (!Number.isFinite(sigma)) return Number.NEGATIVE_INFINITY;
  if (
    obs.type === 'angle' ||
    obs.type === 'direction' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith'
  ) {
    return sigma * RAD_TO_DEG * 3600;
  }
  return sigma;
};

export const sortIndustryListingObservations = (
  observations: Observation[],
  mode: 'input' | 'name' | 'residual' | 'stdError' | 'stdResidual',
): Observation[] => {
  const compareByStdRes = (a: Observation, b: Observation) => {
    const aStdRes = Number.isFinite(a.stdRes) ? Math.abs(a.stdRes as number) : Number.NEGATIVE_INFINITY;
    const bStdRes = Number.isFinite(b.stdRes) ? Math.abs(b.stdRes as number) : Number.NEGATIVE_INFINITY;
    const stdResDelta = bStdRes - aStdRes;
    if (Math.abs(stdResDelta) > 1e-12) return stdResDelta;
    const stationDelta = compareIndustryObservationsByStations(a, b);
    if (stationDelta !== 0) return stationDelta;
    return compareIndustryObservationsByInput(a, b);
  };
  const compareByResidualMagnitude = (a: Observation, b: Observation) => {
    const delta =
      getIndustryObservationResidualSortMagnitude(b) -
      getIndustryObservationResidualSortMagnitude(a);
    if (Math.abs(delta) > 1e-12) return delta;
    const stationDelta = compareIndustryObservationsByStations(a, b);
    if (stationDelta !== 0) return stationDelta;
    return compareIndustryObservationsByInput(a, b);
  };
  const compareByStdErrorMagnitude = (a: Observation, b: Observation) => {
    const delta =
      getIndustryObservationStdErrorSortMagnitude(b) -
      getIndustryObservationStdErrorSortMagnitude(a);
    if (Math.abs(delta) > 1e-12) return delta;
    const stationDelta = compareIndustryObservationsByStations(a, b);
    if (stationDelta !== 0) return stationDelta;
    return compareIndustryObservationsByInput(a, b);
  };
  return [...observations].sort((a, b) => {
    if (mode === 'input') return compareIndustryObservationsByInput(a, b);
    if (mode === 'name') return compareIndustryObservationsByStations(a, b);
    if (mode === 'residual') return compareByResidualMagnitude(a, b);
    if (mode === 'stdError') return compareByStdErrorMagnitude(a, b);
    return compareByStdRes(a, b);
  });
};

export const centerIndustryLine = (text: string, width = 80): string => {
  const leftPad = Math.max(0, Math.floor((width - text.length) / 2));
  return `${' '.repeat(leftPad)}${text}`;
};

export const pathTokenLeaf = (token?: string): string => {
  const value = token?.trim() ?? '';
  if (!value) return '';
  const parts = value.split(/[\\/]+/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? value;
};

export const pathTokenParent = (token?: string): string => {
  const value = token?.trim() ?? '';
  if (!value) return '';
  const parts = value.split(/[\\/]+/).filter((part) => part.length > 0);
  if (parts.length <= 1) return value;
  return parts.slice(0, -1).join('\\');
};

export const pathTokenStem = (token?: string): string => {
  const leaf = pathTokenLeaf(token);
  if (!leaf) return '';
  return leaf.replace(/\.[^.]+$/, '') || leaf;
};

export const isConcretePathToken = (token?: string): boolean => {
  const value = token?.trim() ?? '';
  return value.length > 0 && !/^<.*>$/.test(value);
};
