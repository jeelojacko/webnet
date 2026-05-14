import { RAD_TO_DEG, radToDmsStr } from '../../engine/angles';
import type {
  Observation,
  ReductionUsageSummary,
  SigmaSource,
  Station,
} from '../../types';
import { PREANALYSIS_LABEL_TOOLTIPS } from './reportTooltips';

export const formatReductionUsage = (summary?: ReductionUsageSummary): string => {
  if (!summary) return 'unavailable';
  return [
    `bearing[g=${summary.bearing.grid},m=${summary.bearing.measured}]`,
    `angle[g=${summary.angle.grid},m=${summary.angle.measured}]`,
    `direction[g=${summary.direction.grid},m=${summary.direction.measured}]`,
    `distance[ground=${summary.distance.ground},grid=${summary.distance.grid},ellip=${summary.distance.ellipsoidal}]`,
    `total=${summary.total}`,
  ].join('; ');
};

export const formatPrismAnnotation = (
  obs: Observation,
  unitScale: number,
  units: 'm' | 'ft',
): string => {
  if (obs.type !== 'dist' && obs.type !== 'zenith') return '';
  const correction = obs.prismCorrectionM ?? 0;
  if (!Number.isFinite(correction) || Math.abs(correction) <= 0) return '';
  const sign = correction >= 0 ? '+' : '';
  const scope = obs.prismScope ?? 'global';
  return ` [PRISM ${scope} ${sign}${(correction * unitScale).toFixed(4)}${units}]`;
};

export const formatMdb = (value: number, angular: boolean, unitScale: number): string => {
  if (!Number.isFinite(value)) return 'inf';
  return angular ? `${(value * RAD_TO_DEG * 3600).toFixed(2)}"` : (value * unitScale).toFixed(4);
};

export const formatEffectiveDistance = (value: number | undefined, unitScale: number): string => {
  if (value == null || !Number.isFinite(value) || value <= 0) return '-';
  return (value * unitScale).toFixed(4);
};

export const formatFixedOrScientific = (
  value: number | undefined,
  decimals: number,
  exponentialDigits = 3,
): string => {
  if (value == null || !Number.isFinite(value)) return '-';
  const fixed = value.toFixed(decimals);
  return value !== 0 && Number.parseFloat(fixed) === 0 ? value.toExponential(exponentialDigits) : fixed;
};

export const buildStationConstraintModeSummary = (
  station: Station,
  coordMode: '2D' | '3D' | undefined,
): string => {
  const modeLabels: Array<[string, Station['constraintModeX'] | undefined]> = [
    ['N', station.constraintModeY],
    ['E', station.constraintModeX],
  ];
  if (coordMode === '3D') {
    modeLabels.push(['H', station.constraintModeH]);
  }
  const parts = modeLabels
    .filter(([, mode]) => mode != null)
    .map(([label, mode]) => `${label}:${String(mode).toUpperCase()}`);
  return parts.length > 0 ? parts.join(' | ') : 'Adjusted station';
};

export const buildStationTypeBadge = (
  station: Station,
  coordMode: '2D' | '3D' | undefined,
): { label: 'FIXED' | 'CTRL' | 'ADJ'; className: string; title: string } => {
  const summary = buildStationConstraintModeSummary(station, coordMode);
  const hasConstraint =
    station.constraintX != null || station.constraintY != null || station.constraintH != null;
  if (station.fixed) {
    return {
      label: 'FIXED',
      className: 'text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded',
      title: summary,
    };
  }
  if (hasConstraint) {
    return {
      label: 'CTRL',
      className: 'text-xs bg-sky-900/70 text-sky-200 px-1.5 py-0.5 rounded',
      title: summary,
    };
  }
  return {
    label: 'ADJ',
    className: 'text-xs text-slate-500',
    title: summary,
  };
};

export const getPreanalysisLabelTooltip = (label: string): string | undefined =>
  PREANALYSIS_LABEL_TOOLTIPS[label];

export const getObservationStationsLabel = (obs: Observation): string => {
  if (obs.type === 'angle') return `${obs.at}-${obs.from}-${obs.to}`;
  if (obs.type === 'direction') return `${obs.at}-${obs.to} (${obs.setId})`;
  if (
    obs.type === 'dist' ||
    obs.type === 'gps' ||
    obs.type === 'lev' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith'
  ) {
    return `${obs.from}-${obs.to}`;
  }
  return '-';
};

export const getObservationValueLabel = (obs: Observation, unitScale: number): string => {
  if (
    obs.type === 'angle' ||
    obs.type === 'direction' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith'
  ) {
    return radToDmsStr(obs.obs);
  }
  if (obs.type === 'dist' || obs.type === 'lev') return (obs.obs * unitScale).toFixed(4);
  if (obs.type === 'gps') {
    return `dE=${(obs.obs.dE * unitScale).toFixed(4)}, dN=${(obs.obs.dN * unitScale).toFixed(4)}`;
  }
  return '-';
};

export const getFixedSigmaLabel = (
  obs: Observation,
  unitScale: number,
  units: 'm' | 'ft',
): string => {
  if (
    obs.type === 'angle' ||
    obs.type === 'direction' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith'
  ) {
    return `${(obs.stdDev * RAD_TO_DEG * 3600).toExponential(3)}"`;
  }
  if (obs.type === 'gps') {
    const sigmaE = obs.stdDevE ?? obs.stdDev;
    const sigmaN = obs.stdDevN ?? obs.stdDev;
    return `E=${(sigmaE * unitScale).toExponential(3)}, N=${(sigmaN * unitScale).toExponential(3)}`;
  }
  return `${(obs.stdDev * unitScale).toExponential(3)} ${units}`;
};

export const getSigmaSourceLabel = (source?: SigmaSource): string => {
  switch (source ?? 'explicit') {
    case 'default':
      return 'DEFAULT';
    case 'fixed':
      return 'FIXED';
    case 'float':
      return 'FLOAT';
    default:
      return 'EXPLICIT';
  }
};

export const getObservationWeightLabel = (obs: Observation): string => {
  if (obs.type === 'gps') {
    const east = getSigmaSourceLabel(obs.sigmaSourceE ?? obs.sigmaSource);
    const north = getSigmaSourceLabel(obs.sigmaSourceN ?? obs.sigmaSource);
    return east === north ? east : `E=${east} N=${north}`;
  }
  return getSigmaSourceLabel(obs.sigmaSource);
};
