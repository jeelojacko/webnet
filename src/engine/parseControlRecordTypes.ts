import type {
  CoordInputClass,
  ParseOptions,
  StationId,
  StationMap,
} from '../types';

export type ControlComponentMode = 'inherit' | 'fixed' | 'free';

export type FixityParseResult = {
  componentModes: ControlComponentMode[];
  fixities: boolean[];
  hasFreeMarkers: boolean;
  legacyStarFixed: boolean;
};

export type HandleControlRecordArgs = {
  code: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  stations: StationMap;
  logs: string[];
  parseFixityTokens: (_tokens: string[], _componentCount: number) => FixityParseResult;
  parseConstraintCorrToken: (_value: number | undefined) => number | undefined;
  applyFixities: (
    _station: StationMap[string],
    _fix: { x?: boolean; y?: boolean; h?: boolean },
    _coordMode: ParseOptions['coordMode'],
  ) => void;
  clearStationConstraintComponent: (
    _station: StationMap[string],
    _component: 'x' | 'y' | 'h',
  ) => void;
  setStationConstraintMode: (
    _station: StationMap[string],
    _component: 'x' | 'y' | 'h',
    _mode: StationMap[string]['constraintModeX'],
  ) => void;
  resolveStationConstraintMode: (
    _explicitMode: ControlComponentMode,
    _fixed: boolean,
    _hasConstraint: boolean,
  ) => StationMap[string]['constraintModeX'];
  assignStationCoordClass: (
    _station: StationMap[string],
    _id: StationId,
    _coordClass: CoordInputClass,
    _context: string,
  ) => void;
  linearToMetersFactor: () => number;
  toDegrees: (_token: string) => number;
  activeCrsProjectionModel: (_state: ParseOptions) => ParseOptions['crsProjectionModel'];
};
