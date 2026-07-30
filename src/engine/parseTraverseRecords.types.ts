import type { SigmaToken } from './parseSigmaResolution';
import type {
  Instrument,
  InstrumentLibrary,
  Observation,
  ParseOptions,
  SigmaSource,
} from '../types';

export type ObservedParsedValue = {
  value: number;
  planned: boolean;
  valid: boolean;
};

export type TraverseContext = {
  occupy?: string;
  backsight?: string;
  backsightRefAngle?: number;
};

export type HandleTraverseRecordArgs = {
  code: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  instrumentLibrary: InstrumentLibrary;
  logs: string[];
  obsIdRef: { current: number };
  traverseCtx: TraverseContext;
  faceModeRef: { current: 'unknown' | 'face1' | 'face2' };
  parseAngleTokenRad: (
    _token: string | undefined,
    _state: ParseOptions,
    _fallbackMode?: 'dms' | 'dd',
  ) => number;
  parseObservedLinearToken: (_token: string | undefined, _toMeters: number) => ObservedParsedValue;
  parseObservedAngleToken: (
    _token: string | undefined,
    _fallbackMode: 'dms' | 'dd',
  ) => ObservedParsedValue;
  linearToMetersFactor: () => number;
  effectiveDistanceMode: () => 'slope' | 'horiz';
  extractSigmaTokens: (
    _tokens: string[],
    _count: number,
  ) => { sigmas: SigmaToken[]; rest: string[] };
  resolveLinearSigma: (
    _token: SigmaToken | undefined,
    _defaultSigma: number,
  ) => { sigma: number; source: SigmaSource };
  resolveAngularSigma: (
    _token: SigmaToken | undefined,
    _defaultSigma: number,
  ) => { sigma: number; source: SigmaSource };
  resolveLevelingSigma: (
    _token: SigmaToken | undefined,
    _inst: Instrument | undefined,
    _spanMeters: number,
    _contextCode: string,
    _sourceLine: number,
  ) => { sigma: number; source: SigmaSource };
  defaultDistanceSigma: (
    _inst: Instrument | undefined,
    _dist: number,
    _edmMode: ParseOptions['edmMode'],
    _fallback?: number,
  ) => number;
  defaultHorizontalAngleSigmaSec: (_inst: Instrument | undefined) => number;
  defaultAzimuthSigmaSec: (_inst: Instrument | undefined) => number;
  defaultZenithSigmaSec: (_inst: Instrument | undefined) => number;
  applyPlanRotation: (_angleRad: number, _state: ParseOptions) => number;
  wrapTo2Pi: (_value: number) => number;
  pushObservation: (_observation: Observation) => void;
  face2Weight: number;
};
