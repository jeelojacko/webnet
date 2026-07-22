import type { createParseAliasPipeline } from './parseAliasPipeline';
import type {
  DescriptionReconcileMode,
  GeoidHeightDatum,
  GnssVectorFrame,
  GpsVectorMode,
  ParseOptions,
  StationId,
  StationMap,
} from '../types';

export const FT_PER_M = 3.280839895;
export const RAD_TO_DEG = 180 / Math.PI;

export const parseGeoidHeightDatumToken = (token?: string): GeoidHeightDatum | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'ORTHOMETRIC' || upper === 'ORTHO') return 'orthometric';
  if (upper === 'ELLIPSOID' || upper === 'ELLIPSOIDAL' || upper === 'ELLIP') return 'ellipsoid';
  return null;
};

export const parseGpsVectorModeToken = (token?: string): GpsVectorMode | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'NETWORK' || upper === 'NET') return 'network';
  if (upper === 'SIDESHOT' || upper === 'SS') return 'sideshot';
  return null;
};

export const parseGnssVectorFrameToken = (token?: string): GnssVectorFrame | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'GRIDNEU' || upper === 'GRID' || upper === 'NEU') return 'gridNEU';
  if (upper === 'ENULOCAL' || upper === 'ENU' || upper === 'LOCALENU') return 'enuLocal';
  if (upper === 'ECEFDELTA' || upper === 'ECEF' || upper === 'DXDYDZ') return 'ecefDelta';
  if (upper === 'LLHBASELINE' || upper === 'LLH' || upper === 'GEODETICBASELINE')
    return 'llhBaseline';
  if (upper === 'UNKNOWN' || upper === 'UNSPECIFIED') return 'unknown';
  return null;
};

export type ParseDirectiveDispatchResult = {
  handled: boolean;
  orderExplicit: boolean;
  stopParse?: boolean;
};

type AliasDirectiveHandler = Pick<ReturnType<typeof createParseAliasPipeline>, 'handleAliasDirective'>;

export type ParseDirectiveDispatchArgs = {
  op: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  logs: string[];
  orderExplicit: boolean;
  recordDirectiveTransition: (_directive: string) => void;
  linearToMetersFactor: () => number;
  parseAngleTokenRad: (
    _token: string | undefined,
    _state: ParseOptions,
    _fallbackMode?: 'dms' | 'dd',
  ) => number;
  parseLinearMetersToken: (
    _token: string | undefined,
    _units: ParseOptions['units'],
  ) => number | null;
  wrapTo2Pi: (_value: number) => number;
  splitCommaTokens: (_tokens: string[], _trimSegments: boolean) => string[];
  aliasPipeline: AliasDirectiveHandler;
  compatibilityAcceptedNoOps: Set<string>;
  lostStationIds: Set<StationId>;
  stations: StationMap;
  defaultDescriptionReconcileMode: DescriptionReconcileMode;
  defaultDescriptionAppendDelimiter: string;
  flushDirectionSet: (_reason: string) => void;
};

export type SpecializedDirectiveHandler = (
  _args: ParseDirectiveDispatchArgs,
) => ParseDirectiveDispatchResult;

export const handled = (
  orderExplicit: boolean,
  overrides: Partial<ParseDirectiveDispatchResult> = {},
): ParseDirectiveDispatchResult => ({
  handled: true,
  orderExplicit,
  ...overrides,
});

export const compareDirectiveStationIds = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true });

export const directivePairKey = (from: string, to: string): string =>
  compareDirectiveStationIds(from, to) <= 0 ? `${from}::${to}` : `${to}::${from}`;

export const dedupeDirectiveStationIds = (tokens: string[]): string[] => {
  const seen = new Set<string>();
  const stationIds: string[] = [];
  tokens.forEach((token) => {
    const trimmed = token.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    stationIds.push(trimmed);
  });
  return stationIds;
};

export const expandDirectiveConnectionPairs = (
  stationIds: string[],
): Array<{ from: StationId; to: StationId }> => {
  const pairs: Array<{ from: StationId; to: StationId }> = [];
  for (let i = 0; i < stationIds.length; i += 1) {
    for (let j = i + 1; j < stationIds.length; j += 1) {
      pairs.push({
        from: stationIds[i] as StationId,
        to: stationIds[j] as StationId,
      });
    }
  }
  return pairs;
};

export const parseRelativeLineDirectivePairs = (
  tokens: string[],
): {
  stationIds?: string[];
  pairs: Array<{ from: StationId; to: StationId }>;
  warnings: string[];
} => {
  const cleaned = dedupeDirectiveStationIds(tokens);
  const warnings: string[] = [];
  if (cleaned.length === 0) {
    return { pairs: [], warnings };
  }

  const firstTokenUpper = cleaned[0].toUpperCase();
  if (firstTokenUpper === '/CON' || firstTokenUpper === 'CON') {
    const stationIds = dedupeDirectiveStationIds(cleaned.slice(1));
    return {
      stationIds,
      pairs: expandDirectiveConnectionPairs(stationIds),
      warnings,
    };
  }

  const pairs: Array<{ from: StationId; to: StationId }> = [];
  const seen = new Set<string>();
  const pushPair = (fromToken: string, toToken: string) => {
    const from = fromToken.trim();
    const to = toToken.trim();
    if (!from || !to || from === to) return;
    const key = directivePairKey(from, to);
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ from: from as StationId, to: to as StationId });
  };

  const sequentialTokens: string[] = [];
  cleaned.forEach((token) => {
    if (token.startsWith('/')) {
      warnings.push(`unsupported option "${token}"`);
      return;
    }
    const explicitPairMatch = token.match(/^(.+?)(?::|\/|->)(.+)$/);
    if (explicitPairMatch) {
      pushPair(explicitPairMatch[1], explicitPairMatch[2]);
      return;
    }
    sequentialTokens.push(token);
  });

  for (let i = 0; i < sequentialTokens.length; i += 2) {
    if (!sequentialTokens[i + 1]) {
      warnings.push(`unmatched station token "${sequentialTokens[i]}"`);
      break;
    }
    pushPair(sequentialTokens[i], sequentialTokens[i + 1]);
  }

  return { pairs, warnings };
};
