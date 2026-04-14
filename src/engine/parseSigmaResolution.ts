import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from './defaults';
import type { Instrument, ParseOptions, SigmaSource } from '../types';

const FIXED_SIGMA = 1e-9;
const FLOAT_SIGMA = 1e9;
const FT_PER_M = 3.280839895;

export type SigmaToken =
  | { kind: 'default' }
  | { kind: 'numeric'; value: number }
  | { kind: 'fixed' }
  | { kind: 'float' };

export interface SigmaResolution {
  sigma: number;
  source: SigmaSource;
}

export interface ParseSigmaResolvers {
  resolveLinearSigma: (_token: SigmaToken | undefined, _defaultSigma: number) => SigmaResolution;
  resolveAngularSigma: (_token: SigmaToken | undefined, _defaultSigma: number) => SigmaResolution;
  resolveLevelingSigma: (
    _token: SigmaToken | undefined,
    _inst: Instrument | undefined,
    _spanMeters: number,
    _contextCode: string,
    _sourceLine: number,
  ) => SigmaResolution;
  levelWeightSigmaFromSpanMeters: (_spanMeters: number) => number;
}

export const parseSigmaToken = (token?: string): SigmaToken | null => {
  if (!token) return null;
  if (token === '&' || token === '?') return { kind: 'default' };
  if (token === '!') return { kind: 'fixed' };
  if (token === '*') return { kind: 'float' };
  const value = parseFloat(token);
  if (!Number.isNaN(value)) return { kind: 'numeric', value };
  return null;
};

const expandPackedSigmaToken = (token: string): string[] | null => {
  if (token.length <= 1) return null;
  if (!/^[&?!*]+$/.test(token)) return null;
  return token.split('');
};

export const extractSigmaTokens = (
  tokens: string[],
  count: number,
): { sigmas: SigmaToken[]; rest: string[] } => {
  const sigmas: SigmaToken[] = [];
  let idx = 0;
  for (; idx < tokens.length && sigmas.length < count; idx += 1) {
    const token = tokens[idx];
    if (token.includes('/')) break;
    const expanded = expandPackedSigmaToken(token);
    if (expanded) {
      const remaining = count - sigmas.length;
      expanded.slice(0, remaining).forEach((expandedToken) => {
        const parsed = parseSigmaToken(expandedToken);
        if (parsed) sigmas.push(parsed);
      });
      if (expanded.length > remaining) {
        return {
          sigmas,
          rest: [expanded.slice(remaining).join(''), ...tokens.slice(idx + 1)],
        };
      }
      continue;
    }
    const parsed = parseSigmaToken(token);
    if (!parsed) break;
    sigmas.push(parsed);
  }
  return { sigmas, rest: tokens.slice(idx) };
};

export const resolveSigma = (
  token: SigmaToken | undefined,
  defaultSigma: number,
  fixedSigma = FIXED_SIGMA,
  floatSigma = FLOAT_SIGMA,
): SigmaResolution => {
  if (!token || token.kind === 'default') return { sigma: defaultSigma, source: 'default' };
  if (token.kind === 'numeric') return { sigma: token.value, source: 'explicit' };
  if (token.kind === 'fixed') return { sigma: fixedSigma, source: 'fixed' };
  return { sigma: floatSigma, source: 'float' };
};

export const defaultDistanceSigma = (
  inst: Instrument | undefined,
  dist: number,
  edmMode: ParseOptions['edmMode'],
  fallback = 0,
): number => {
  if (!inst) return fallback;
  const ppmTerm = inst.edm_ppm * 1e-6 * dist;
  if (edmMode === 'propagated') {
    return Math.sqrt(inst.edm_const * inst.edm_const + ppmTerm * ppmTerm);
  }
  return Math.abs(inst.edm_const) + Math.abs(ppmTerm);
};

export const defaultHorizontalAngleSigmaSec = (inst: Instrument | undefined): number =>
  inst?.hzPrecision_sec ?? 0;

export const defaultDirectionSigmaSec = (inst: Instrument | undefined): number =>
  inst?.dirPrecision_sec ?? defaultHorizontalAngleSigmaSec(inst);

export const defaultAzimuthSigmaSec = (inst: Instrument | undefined): number =>
  inst?.azBearingPrecision_sec ?? defaultDirectionSigmaSec(inst);

export const defaultZenithSigmaSec = (inst: Instrument | undefined): number =>
  inst?.vaPrecision_sec ?? 0;

export const defaultElevDiffSigma = (
  inst: Instrument | undefined,
  spanMeters: number,
): number => {
  if (!inst) return 0;
  const ppmTerm = (inst.elevDiff_ppm ?? 0) * 1e-6 * Math.abs(spanMeters);
  return Math.sqrt((inst.elevDiff_const_m ?? 0) ** 2 + ppmTerm ** 2);
};

export const createParseSigmaResolvers = (
  state: ParseOptions,
  logs: string[],
): ParseSigmaResolvers => {
  const resolveLinearSigma = (
    token: SigmaToken | undefined,
    defaultSigma: number,
  ): SigmaResolution => {
    const fixedM = Math.max(1e-12, state.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M);
    const fixedInputUnits = state.units === 'ft' ? fixedM * FT_PER_M : fixedM;
    return resolveSigma(token, defaultSigma, fixedInputUnits, FLOAT_SIGMA);
  };

  const resolveAngularSigma = (
    token: SigmaToken | undefined,
    defaultSigma: number,
  ): SigmaResolution => {
    const fixedSec = Math.max(1e-12, state.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC);
    return resolveSigma(token, defaultSigma, fixedSec, FLOAT_SIGMA);
  };

  const levelWeightSigmaFromSpanMeters = (spanMeters: number): number => {
    const levelWeightMmPerKm = state.levelWeight;
    if (
      levelWeightMmPerKm == null ||
      !Number.isFinite(levelWeightMmPerKm) ||
      levelWeightMmPerKm <= 0
    ) {
      return 0;
    }
    const spanKm = Math.abs(spanMeters) / 1000;
    return (levelWeightMmPerKm * spanKm) / 1000;
  };

  const resolveLevelingSigma = (
    token: SigmaToken | undefined,
    inst: Instrument | undefined,
    spanMeters: number,
    contextCode: string,
    sourceLine: number,
  ): SigmaResolution => {
    const absSpanMeters = Math.abs(spanMeters);
    const levelWeightSigma = levelWeightSigmaFromSpanMeters(absSpanMeters);
    if (!token && levelWeightSigma > 0) {
      logs.push(
        `.LWEIGHT fallback applied for ${contextCode} at line ${sourceLine}: ${state.levelWeight} mm/km over ${(absSpanMeters / 1000).toFixed(4)} km`,
      );
    }
    const instSigma = defaultElevDiffSigma(inst, absSpanMeters);
    const defaultSigma = Math.sqrt(levelWeightSigma * levelWeightSigma + instSigma * instSigma);
    return resolveLinearSigma(token, defaultSigma);
  };

  return {
    resolveLinearSigma,
    resolveAngularSigma,
    resolveLevelingSigma,
    levelWeightSigmaFromSpanMeters,
  };
};
