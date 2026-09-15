import { RAD_TO_DEG } from '../../engine/angles';
import type { Observation } from '../../types';
import { getObservationWeightLabel } from './reportFormatters';

export const isAngularObservationType = (type: Observation['type']): boolean =>
  type === 'angle' ||
  type === 'direction' ||
  type === 'bearing' ||
  type === 'dir' ||
  type === 'zenith';

export type StationDisplayOptions = {
  prismTag?: string;
  autoSideshot?: boolean;
};

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const getObservationStationDetails = (
  obs: Observation,
  opts: StationDisplayOptions = {},
): string => {
  const parts: string[] = [];
  if (obs.type === 'direction') {
    if (obs.setId) parts.push(`Set ${obs.setId}`);
    if (obs.rawCount != null)
      parts.push(`raw ${obs.rawCount} (F1:${obs.rawFace1Count ?? '-'} F2:${obs.rawFace2Count ?? '-'})`);
  } else if (obs.type === 'angle') {
    if (obs.setId) parts.push(`Set ${obs.setId}`);
  } else if (obs.type === 'dist' || obs.type === 'zenith' || obs.type === 'dir') {
    if (obs.setId) parts.push(`Set ${obs.setId}`);
    if ('mode' in obs && obs.mode) parts.push(`mode ${obs.mode}`);
    const hi = 'hi' in obs ? obs.hi : undefined;
    const ht = 'ht' in obs ? obs.ht : undefined;
    if (isFiniteNumber(hi) || isFiniteNumber(ht))
      parts.push(`hi/ht ${isFiniteNumber(hi) ? hi : '-'} / ${isFiniteNumber(ht) ? ht : '-'}`);
  } else if (obs.type === 'gps') {
    if (obs.gpsVectorLabel) parts.push(obs.gpsVectorLabel);
    if (obs.gpsMode) parts.push(`mode ${obs.gpsMode}`);
  } else if (obs.type === 'lev') {
    if (obs.setId) parts.push(`Set ${obs.setId}`);
  } else if (obs.type === 'bearing') {
    if (obs.setId) parts.push(`Set ${obs.setId}`);
  }
  if (opts.prismTag) parts.push(opts.prismTag.trim().replace(/^\[|\]$/g, ''));
  if (opts.autoSideshot) parts.push('AUTO-SS');
  return parts.join(' | ');
};

export const getObservationStationDisplay = (
  obs: Observation,
  opts: StationDisplayOptions = {},
): { visible: string; title: string; ariaLabel: string } => {
  let visible = '-';
  if (obs.type === 'direction') visible = `${obs.at}-${obs.to}`;
  else if (obs.type === 'angle') visible = `${obs.at}-${obs.from}-${obs.to}`;
  else if (
    obs.type === 'dist' ||
    obs.type === 'bearing' ||
    obs.type === 'dir' ||
    obs.type === 'zenith' ||
    obs.type === 'gps' ||
    obs.type === 'lev'
  ) {
    visible = `${obs.from}-${obs.to}`;
  }
  const details = getObservationStationDetails(obs, opts);
  const title = details ? `${visible} | ${details}` : visible;
  return { visible, title, ariaLabel: title };
};

export const formatObservationLinearResidualMm = (
  obs: Observation,
): { text: string; title: string } | null => {
  if (obs.type === 'gps') return null;
  const signNote = 'Sign follows browser convention (observed minus computed).';
  if (isAngularObservationType(obs.type)) {
    const residual = obs.residual;
    const dist = obs.effectiveDistance;
    if (!isFiniteNumber(residual) || !isFiniteNumber(dist) || dist <= 0)
      return {
        text: '-',
        title: `Linear equivalent unavailable (needs finite residual and effective distance). ${signNote}`,
      };
    const mm = (residual as number) * (dist as number) * 1000;
    if (!Number.isFinite(mm)) return { text: '-', title: 'Linear equivalent unavailable.' };
    const arcsec = (residual as number) * RAD_TO_DEG * 3600;
    return {
      text: mm.toFixed(1),
      title: `Residual: ${arcsec.toFixed(2)}" | Effective distance: ${(dist as number).toFixed(4)} m | Linear equivalent: ${mm.toFixed(1)} mm. ${signNote}`,
    };
  }
  if (obs.type === 'dist' || obs.type === 'lev') {
    const residual = obs.residual;
    if (!isFiniteNumber(residual))
      return { text: '-', title: `Linear residual unavailable. ${signNote}` };
    const mm = (residual as number) * 1000;
    if (!Number.isFinite(mm)) return { text: '-', title: 'Linear residual unavailable.' };
    return {
      text: mm.toFixed(1),
      title: `Linear residual: ${mm.toFixed(1)} mm (metric diagnostic). ${signNote}`,
    };
  }
  return { text: '-', title: 'Linear equivalent not applicable to this observation type.' };
};

const formatSigmaValue = (sigma: number, angular: boolean): string =>
  angular ? `${(sigma * RAD_TO_DEG * 3600).toFixed(1)}"` : `${(sigma * 1000).toFixed(1)} mm`;

export const formatObservationSigmaDisplay = (
  obs: Observation,
): { visible: string; title: string } => {
  if (obs.type === 'gps') {
    const label = getObservationWeightLabel(obs);
    return {
      visible: label,
      title: `GNSS weighting: ${label} (per-component sigma, no scalar equivalent).`,
    };
  }
  const angular = isAngularObservationType(obs.type);
  // weightingStdDev is the post-solve capture of the true weighting sigma (effectiveStdDev);
  // fall back to raw stdDev when the capture is unavailable (e.g. pre-solve rows).
  const useFallback = !isFiniteNumber(obs.weightingStdDev);
  const sigma = useFallback ? obs.stdDev : obs.weightingStdDev;
  const source = obs.sigmaSource ?? 'explicit';
  const sourceLabel = source.toUpperCase();
  const fallbackNote = useFallback
    ? ' Input-sigma fallback (not captured effective sigma; may omit parity calibration/centering).'
    : '';
  if (!isFiniteNumber(sigma))
    return { visible: '-', title: `σ unavailable (Source: ${sourceLabel}).${fallbackNote}` };
  const value = formatSigmaValue(sigma as number, angular);
  if (source === 'default')
    return { visible: '-', title: `Default σ: ${value} (Source: default).${fallbackNote}` };
  if (source === 'fixed' || source === 'float')
    return { visible: value, title: `σ: ${value} (Source: ${sourceLabel}).${fallbackNote}` };
  return { visible: value, title: `σ: ${value} (Source: explicit).${fallbackNote}` };
};
