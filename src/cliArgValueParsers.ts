import type { SolveProfile } from './cliArgs';
import type { ParseOptions } from './types';

export const parseRunModeArg = (value: string): ParseOptions['runMode'] => {
  const token = value.trim().toLowerCase();
  if (token === 'adjustment') return 'adjustment';
  if (token === 'preanalysis') return 'preanalysis';
  if (token === 'data-check' || token === 'datacheck') return 'data-check';
  if (token === 'blunder-detect' || token === 'blunderdetect') return 'blunder-detect';
  return undefined;
};

export const parseGnssVectorFrameArg = (
  value: string,
): ParseOptions['gnssVectorFrameDefault'] => {
  const token = value.trim().toLowerCase();
  if (token === 'gridneu' || token === 'grid' || token === 'neu') return 'gridNEU';
  if (token === 'enulocal' || token === 'enu') return 'enuLocal';
  if (token === 'ecefdelta' || token === 'ecef') return 'ecefDelta';
  if (token === 'llhbaseline' || token === 'llh') return 'llhBaseline';
  if (token === 'unknown') return 'unknown';
  return undefined;
};

export const parseParseModeArg = (value: string): ParseOptions['parseCompatibilityMode'] => {
  const token = value.trim().toLowerCase();
  if (token === 'legacy' || token === 'strict') return token;
  return undefined;
};

export const parseFaceNormalizationModeArg = (
  value: string,
): ParseOptions['faceNormalizationMode'] => {
  const token = value.trim().toLowerCase();
  if (token === 'on' || token === 'off' || token === 'auto') return token;
  return undefined;
};

export const normalizeSolveProfile = (_profile: SolveProfile): SolveProfile => 'industry-parity';

export const parseGeoidSourceFormatArg = (
  value: string,
): ParseOptions['geoidSourceFormat'] => {
  const token = value.trim().toLowerCase();
  if (token === 'builtin' || token === 'gtx' || token === 'byn') return token;
  return undefined;
};

export const parseGeoidInterpolationArg = (
  value: string,
): ParseOptions['geoidInterpolation'] => {
  const token = value.trim().toLowerCase();
  if (token === 'bilinear' || token === 'nearest') return token;
  return undefined;
};
