import type { SigmaToken } from './parseSigmaResolution';
import type {
  Instrument,
  InstrumentLibrary,
  Observation,
  ParseCompatibilityMode,
  ParseOptions,
  SigmaSource,
  StationMap,
} from '../types';

export type ObservedParsedValue = {
  value: number;
  planned: boolean;
  valid: boolean;
};

export type DistanceCandidate = {
  from: string;
  to: string;
  nextIndex: number;
  instCode: string;
  setId: string;
  explicitInst: boolean;
};

export type AngleCandidate = {
  instCode: string;
  setId: string;
  s1: string;
  s2: string;
  s3: string;
  stdTokenIndex: number;
  explicitInst: boolean;
  angleParsed: ObservedParsedValue;
};

export type HandleConventionalPrimitiveRecordArgs = {
  code: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  stations: StationMap;
  instrumentLibrary: InstrumentLibrary;
  logs: string[];
  obsIdRef: { current: number };
  compatibilityMode: ParseCompatibilityMode;
  preanalysisMode: boolean;
  addCompatibilityDiagnostic: (
    _code: 'ROLE_AMBIGUITY',
    _line: number,
    _recordType: string,
    _message: string,
    _rewriteSuggestion?: string,
    _fallbackApplied?: boolean,
    _severity?: 'warning' | 'error',
  ) => void;
  rejectNumericStationTokens: (
    _recordType: string,
    _sourceLine: number,
    _stationTokens: Array<{ role: string; value: string }>,
  ) => boolean;
  parseFromTo: (
    _parts: string[],
    _startIndex: number,
    _separator?: string,
  ) => { from: string; to: string; nextIndex: number };
  splitStationPairToken: (_token: string, _separator?: string) => string[];
  extractSigmaTokens: (
    _tokens: string[],
    _count: number,
  ) => { sigmas: SigmaToken[]; rest: string[] };
  extractHiHt: (_tokens: string[]) => { hi?: number; ht?: number; rest: string[] };
  parseObservedLinearToken: (_token: string | undefined, _toMeters: number) => ObservedParsedValue;
  parseObservedAngleToken: (
    _token: string | undefined,
    _fallbackMode: 'dms' | 'dd',
  ) => ObservedParsedValue;
  linearToMetersFactor: () => number;
  effectiveDistanceMode: () => 'slope' | 'horiz';
  scoreDistanceCandidate: (_candidate: {
    instCode: string;
    from: string;
    to: string;
    distToken: string;
    setId: string;
    explicitInst: boolean;
  }) => number;
  looksLikeNumericMeasurement: (_token: string) => boolean;
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
  azimuthFromTo: (
    _stations: StationMap,
    _from: string,
    _to: string,
  ) => { az: number; dist: number } | null;
  wrapToPi: (_value: number) => number;
  applyPlanRotation: (_angleRad: number, _state: ParseOptions) => number;
  pushObservation: (_observation: Observation) => void;
  face2Weight: number;
  amodeAutoMaxDirRad: number;
  amodeAutoMarginRad: number;
};
