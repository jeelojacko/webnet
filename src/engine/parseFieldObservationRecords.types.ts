import type { SigmaToken } from './parseSigmaResolution';
import type {
  GpsObservation,
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

export type PendingGpsCovarianceObservation = {
  label?: string;
  sourceLine: number;
  from: string;
  to: string;
  dX: number;
  dY: number;
  dZ: number;
  cXX?: number;
  cYY?: number;
  cZZ?: number;
};

export type GpsCovarianceState = {
  pending?: PendingGpsCovarianceObservation;
};

export type HandleFieldObservationRecordArgs = {
  code: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  stations: StationMap;
  instrumentLibrary: InstrumentLibrary;
  logs: string[];
  obsIdRef: { current: number };
  compatibilityMode: ParseCompatibilityMode;
  lastGpsObservationRef: { current: GpsObservation | undefined };
  gpsCovarianceStateRef: GpsCovarianceState;
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
  parseSsStationTokens: (
    _parts: string[],
    _separator?: string,
  ) => {
    at: string;
    to: string;
    mode: 'legacy' | 'at-to' | 'at-from-to';
    angleTokenIndex: number;
    explicitBacksight?: string;
  } | null;
  parseAngleTokenRad: (
    _token: string,
    _state: ParseOptions,
    _fallbackMode: 'dms' | 'dd',
  ) => number;
  parseLinearMetersToken: (_token: string | undefined, _units: ParseOptions['units']) => number | null;
  parseObservedLinearToken: (_token: string | undefined, _toMeters: number) => ObservedParsedValue;
  parseSigmaToken: (_token?: string) => SigmaToken | null;
  extractSigmaTokens: (
    _tokens: string[],
    _count: number,
  ) => { sigmas: SigmaToken[]; rest: string[] };
  extractHiHt: (_tokens: string[]) => { hi?: number; ht?: number; rest: string[] };
  linearToMetersFactor: () => number;
  effectiveDistanceMode: () => 'slope' | 'horiz';
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
  defaultDirectionSigmaSec: (_inst: Instrument | undefined) => number;
  defaultZenithSigmaSec: (_inst: Instrument | undefined) => number;
  defaultElevDiffSigma: (_inst: Instrument | undefined, _distMeters: number) => number;
  applyPlanRotation: (_angleRad: number, _state: ParseOptions) => number;
  wrapTo2Pi: (_value: number) => number;
  pushObservation: (_observation: Observation) => void;
  ftPerM: number;
  traverseCtx: {
    occupy?: string;
    backsight?: string;
  };
};
