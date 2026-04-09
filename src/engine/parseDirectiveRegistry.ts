import { parseAutoAdjustDirectiveTokens } from './autoAdjust';
import { normalizeCrsId } from './crsCatalog';
import { applyCoreDirectiveState } from './parseDirectiveState';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from './defaults';
import { normalizeGeoidModelId, parseGeoidInterpolationToken } from './geoid';
import { parseCrsProjectionModelToken } from './geodesy';
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

const FT_PER_M = 3.280839895;
const RAD_TO_DEG = 180 / Math.PI;

const parseGeoidHeightDatumToken = (token?: string): GeoidHeightDatum | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'ORTHOMETRIC' || upper === 'ORTHO') return 'orthometric';
  if (upper === 'ELLIPSOID' || upper === 'ELLIPSOIDAL' || upper === 'ELLIP') return 'ellipsoid';
  return null;
};

const parseGpsVectorModeToken = (token?: string): GpsVectorMode | null => {
  if (!token) return null;
  const upper = token.trim().toUpperCase();
  if (!upper) return null;
  if (upper === 'NETWORK' || upper === 'NET') return 'network';
  if (upper === 'SIDESHOT' || upper === 'SS') return 'sideshot';
  return null;
};

const parseGnssVectorFrameToken = (token?: string): GnssVectorFrame | null => {
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

type SpecializedDirectiveHandler = (
  _args: ParseDirectiveDispatchArgs,
) => ParseDirectiveDispatchResult;

const handled = (
  orderExplicit: boolean,
  overrides: Partial<ParseDirectiveDispatchResult> = {},
): ParseDirectiveDispatchResult => ({
  handled: true,
  orderExplicit,
  ...overrides,
});

const compareDirectiveStationIds = (a: string, b: string): number =>
  a.localeCompare(b, undefined, { numeric: true });

const directivePairKey = (from: string, to: string): string =>
  compareDirectiveStationIds(from, to) <= 0 ? `${from}::${to}` : `${to}::${from}`;

const dedupeDirectiveStationIds = (tokens: string[]): string[] => {
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

const expandDirectiveConnectionPairs = (
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

const parseRelativeLineDirectivePairs = (
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

const SPECIALIZED_DIRECTIVE_HANDLERS: Record<string, SpecializedDirectiveHandler> = {
  '.CRS': ({
    parts,
    lineNum,
    state,
    logs,
    orderExplicit,
    parseAngleTokenRad,
  }) => {
    const modeToken = (parts[1] || '').toUpperCase();
    if (!modeToken) {
      logs.push(
        `Warning: .CRS missing mode at line ${lineNum}; expected OFF, ON [model], LOCAL/GRID, SCALE, CONVERGENCE, LABEL, ID, or model token.`,
      );
      return handled(orderExplicit);
    }

    if (modeToken === 'OFF' || modeToken === 'NONE') {
      state.crsTransformEnabled = false;
      logs.push('CRS transforms set to OFF (legacy projection behavior retained).');
      return handled(orderExplicit);
    }

    if (modeToken === 'LABEL') {
      const label = parts.slice(2).join(' ').trim();
      state.crsLabel = label;
      logs.push(`CRS label set to "${label || 'unnamed'}"`);
      return handled(orderExplicit);
    }

    if (modeToken === 'LOCAL') {
      state.coordSystemMode = 'local';
      logs.push('Coordinate system mode set to LOCAL');
      return handled(orderExplicit);
    }

    if (modeToken === 'GRID' && parts[2]) {
      const gridArg = parts[2].trim();
      const gridArgUpper = gridArg.toUpperCase();
      const maybeFactor = Number.parseFloat(gridArg);
      if (
        gridArgUpper !== 'ON' &&
        gridArgUpper !== 'OFF' &&
        gridArgUpper !== 'NONE' &&
        (!Number.isFinite(maybeFactor) || maybeFactor <= 0)
      ) {
        state.coordSystemMode = 'grid';
        state.crsId = normalizeCrsId(gridArg) ?? state.crsId;
        logs.push(`Coordinate system mode set to GRID (CRS=${state.crsId})`);
        return handled(orderExplicit);
      }
    }

    if (modeToken === 'MODE' && parts[2]) {
      const mode = parts[2].trim().toUpperCase();
      if (mode === 'LOCAL') {
        state.coordSystemMode = 'local';
        logs.push('Coordinate system mode set to LOCAL');
      } else if (mode === 'GRID') {
        state.coordSystemMode = 'grid';
        logs.push(`Coordinate system mode set to GRID (CRS=${state.crsId})`);
      } else {
        logs.push(
          `Warning: invalid .CRS MODE value at line ${lineNum}; expected LOCAL or GRID.`,
        );
      }
      return handled(orderExplicit);
    }

    if (modeToken === 'ID' || modeToken === 'SYSTEM') {
      if (!parts[2]) {
        logs.push(`Warning: .CRS ${modeToken} missing id at line ${lineNum}.`);
        return handled(orderExplicit);
      }
      state.crsId = normalizeCrsId(parts[2]) ?? state.crsId;
      state.coordSystemMode = 'grid';
      logs.push(`CRS id set to ${state.crsId} (coord system mode=GRID)`);
      return handled(orderExplicit);
    }

    if (
      modeToken === 'SCALE' ||
      modeToken === 'GSCALE' ||
      modeToken === 'GRID' ||
      modeToken === 'GRIDGROUND' ||
      modeToken === 'GRID-GROUND'
    ) {
      const arg = (parts[2] || '').trim();
      const argUpper = arg.toUpperCase();
      if (!arg || argUpper === 'ON') {
        state.crsGridScaleEnabled = true;
        const factorToken = parts[3];
        if (factorToken) {
          const factor = parseFloat(factorToken);
          if (Number.isFinite(factor) && factor > 0) {
            state.crsGridScaleFactor = factor;
          } else {
            logs.push(
              `Warning: invalid .CRS SCALE factor at line ${lineNum}; expected positive number.`,
            );
          }
        }
        logs.push(
          `CRS grid-ground scale set to ON (factor=${(state.crsGridScaleFactor ?? 1).toFixed(8)})`,
        );
        return handled(orderExplicit);
      }
      if (argUpper === 'OFF' || argUpper === 'NONE') {
        state.crsGridScaleEnabled = false;
        logs.push('CRS grid-ground scale set to OFF');
        return handled(orderExplicit);
      }
      const factor = parseFloat(arg);
      if (Number.isFinite(factor) && factor > 0) {
        state.crsGridScaleEnabled = true;
        state.crsGridScaleFactor = factor;
        logs.push(`CRS grid-ground scale set to ON (factor=${factor.toFixed(8)})`);
      } else {
        logs.push(
          `Warning: invalid .CRS SCALE option at line ${lineNum}; expected OFF, ON [factor], or positive factor.`,
        );
      }
      return handled(orderExplicit);
    }

    if (
      modeToken === 'CONVERGENCE' ||
      modeToken === 'CONV' ||
      modeToken === 'GAMMA' ||
      modeToken === 'MERIDIAN'
    ) {
      const arg = (parts[2] || '').trim();
      const argUpper = arg.toUpperCase();
      if (!arg || argUpper === 'ON') {
        state.crsConvergenceEnabled = true;
        const angleToken = parts[3];
        if (angleToken) {
          const parsedAngle = parseAngleTokenRad(angleToken, state, 'dd');
          if (Number.isFinite(parsedAngle)) {
            state.crsConvergenceAngleRad = parsedAngle;
          } else {
            logs.push(
              `Warning: invalid .CRS CONVERGENCE angle at line ${lineNum}; expected DD or DMS token.`,
            );
          }
        }
        logs.push(
          `CRS convergence set to ON (angle=${((state.crsConvergenceAngleRad ?? 0) * RAD_TO_DEG).toFixed(6)} deg)`,
        );
        return handled(orderExplicit);
      }
      if (argUpper === 'OFF' || argUpper === 'NONE') {
        state.crsConvergenceEnabled = false;
        logs.push('CRS convergence set to OFF');
        return handled(orderExplicit);
      }
      const parsedAngle = parseAngleTokenRad(arg, state, 'dd');
      if (Number.isFinite(parsedAngle)) {
        state.crsConvergenceEnabled = true;
        state.crsConvergenceAngleRad = parsedAngle;
        logs.push(
          `CRS convergence set to ON (angle=${(parsedAngle * RAD_TO_DEG).toFixed(6)} deg)`,
        );
      } else {
        logs.push(
          `Warning: invalid .CRS CONVERGENCE option at line ${lineNum}; expected OFF, ON [angle], or DD/DMS angle token.`,
        );
      }
      return handled(orderExplicit);
    }

    if (modeToken === 'ON') {
      state.crsTransformEnabled = true;
      const model = parseCrsProjectionModelToken(parts[2]);
      if (model) {
        state.crsProjectionModel = model;
      }
      const labelStart = model ? 3 : 2;
      const label = parts.slice(labelStart).join(' ').trim();
      if (label) state.crsLabel = label;
      logs.push(
        `CRS transforms set to ON (model=${state.crsProjectionModel}, label="${state.crsLabel || 'unnamed'}")`,
      );
      return handled(orderExplicit);
    }

    const directModel = parseCrsProjectionModelToken(parts[1]);
    if (directModel) {
      state.crsTransformEnabled = true;
      state.crsProjectionModel = directModel;
      const label = parts.slice(2).join(' ').trim();
      if (label) state.crsLabel = label;
      logs.push(
        `CRS transforms set to ON (model=${state.crsProjectionModel}, label="${state.crsLabel || 'unnamed'}")`,
      );
      return handled(orderExplicit);
    }

    logs.push(
      `Warning: unrecognized .CRS option at line ${lineNum}; expected OFF, ON [LEGACY|ENU], LOCAL/GRID, SCALE, CONVERGENCE, LABEL, ID, or model token.`,
    );
    return handled(orderExplicit);
  },
  '.GEOID': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const modeToken = (parts[1] || '').toUpperCase();
    if (!modeToken) {
      logs.push(
        `Warning: .GEOID missing mode at line ${lineNum}; expected OFF, ON [model], MODEL, SOURCE, FILE, INTERP, or HEIGHT.`,
      );
      return handled(orderExplicit);
    }
    if (modeToken === 'OFF' || modeToken === 'NONE') {
      state.geoidModelEnabled = false;
      logs.push('Geoid/grid model set to OFF');
      return handled(orderExplicit);
    }
    if (modeToken === 'ON') {
      state.geoidModelEnabled = true;
      if (parts[2]) {
        state.geoidModelId = normalizeGeoidModelId(parts[2]);
      } else {
        state.geoidModelId = normalizeGeoidModelId(state.geoidModelId);
      }
      logs.push(`Geoid/grid model set to ON (model=${state.geoidModelId})`);
      return handled(orderExplicit);
    }
    if (modeToken === 'MODEL') {
      if (!parts[2]) {
        logs.push(`Warning: .GEOID MODEL missing id at line ${lineNum}; keeping current model.`);
        return handled(orderExplicit);
      }
      state.geoidModelId = normalizeGeoidModelId(parts[2]);
      state.geoidModelEnabled = true;
      logs.push(`Geoid/grid model set to ON (model=${state.geoidModelId})`);
      return handled(orderExplicit);
    }
    if (modeToken === 'SOURCE') {
      const formatToken = (parts[2] || '').toUpperCase();
      if (formatToken === 'BUILTIN' || formatToken === 'INTERNAL') {
        state.geoidSourceFormat = 'builtin';
        state.geoidSourcePath = '';
        logs.push('Geoid source set to BUILTIN');
        return handled(orderExplicit);
      }
      if (formatToken === 'GTX' || formatToken === 'BYN') {
        state.geoidSourceFormat = formatToken === 'GTX' ? 'gtx' : 'byn';
        const pathToken = parts.slice(3).join(' ').trim();
        state.geoidSourcePath = pathToken;
        logs.push(`Geoid source set to ${formatToken}${pathToken ? ` (${pathToken})` : ''}`);
        return handled(orderExplicit);
      }
      logs.push(
        `Warning: invalid .GEOID SOURCE option at line ${lineNum}; expected BUILTIN, GTX [path], or BYN [path].`,
      );
      return handled(orderExplicit);
    }
    if (modeToken === 'FILE' || modeToken === 'PATH') {
      const sourcePath = parts.slice(2).join(' ').trim();
      if (!sourcePath) {
        logs.push(
          `Warning: .GEOID ${modeToken} missing path at line ${lineNum}; expected a GTX/BYN file path.`,
        );
        return handled(orderExplicit);
      }
      const lowerPath = sourcePath.toLowerCase();
      if (lowerPath.endsWith('.gtx')) state.geoidSourceFormat = 'gtx';
      else if (lowerPath.endsWith('.byn')) state.geoidSourceFormat = 'byn';
      else {
        logs.push(
          `Warning: .GEOID ${modeToken} path at line ${lineNum} does not end with .gtx or .byn; keeping source format ${String(state.geoidSourceFormat ?? 'builtin').toUpperCase()}.`,
        );
      }
      state.geoidSourcePath = sourcePath;
      logs.push(
        `Geoid source path set to ${sourcePath} (format=${String(
          state.geoidSourceFormat ?? 'builtin',
        ).toUpperCase()})`,
      );
      return handled(orderExplicit);
    }
    if (modeToken === 'INTERP' || modeToken === 'INTERPOLATION' || modeToken === 'METHOD') {
      const method = parseGeoidInterpolationToken(parts[2]);
      if (!method) {
        logs.push(
          `Warning: invalid .GEOID INTERP option at line ${lineNum}; expected BILINEAR or NEAREST.`,
        );
        return handled(orderExplicit);
      }
      state.geoidInterpolation = method;
      logs.push(`Geoid interpolation set to ${method.toUpperCase()}`);
      return handled(orderExplicit);
    }
    if (modeToken === 'HEIGHT' || modeToken === 'DATUM') {
      const argToken = (parts[2] || '').toUpperCase();
      if (!argToken) {
        logs.push(
          `Warning: .GEOID HEIGHT missing option at line ${lineNum}; expected OFF, ON [ORTHOMETRIC|ELLIPSOID], or datum token.`,
        );
        return handled(orderExplicit);
      }
      if (argToken === 'OFF' || argToken === 'NONE') {
        state.geoidHeightConversionEnabled = false;
        logs.push('Geoid height conversion set to OFF');
        return handled(orderExplicit);
      }
      if (argToken === 'ON') {
        const datum = parseGeoidHeightDatumToken(parts[3]);
        if (parts[3] && !datum) {
          logs.push(
            `Warning: invalid .GEOID HEIGHT datum at line ${lineNum}; expected ORTHOMETRIC or ELLIPSOID.`,
          );
        }
        state.geoidHeightConversionEnabled = true;
        if (datum) state.geoidOutputHeightDatum = datum;
        logs.push(
          `Geoid height conversion set to ON (target=${(state.geoidOutputHeightDatum ?? 'orthometric').toUpperCase()})`,
        );
        return handled(orderExplicit);
      }
      const directDatum = parseGeoidHeightDatumToken(parts[2]);
      if (!directDatum) {
        logs.push(
          `Warning: invalid .GEOID HEIGHT option at line ${lineNum}; expected OFF, ON [ORTHOMETRIC|ELLIPSOID], or datum token.`,
        );
        return handled(orderExplicit);
      }
      state.geoidHeightConversionEnabled = true;
      state.geoidOutputHeightDatum = directDatum;
      logs.push(`Geoid height conversion set to ON (target=${directDatum.toUpperCase()})`);
      return handled(orderExplicit);
    }
    logs.push(
      `Warning: unrecognized .GEOID option at line ${lineNum}; expected OFF, ON [model], MODEL, SOURCE, FILE, INTERP, or HEIGHT.`,
    );
    return handled(orderExplicit);
  },
  '.GPS': ({
    parts,
    lineNum,
    state,
    logs,
    orderExplicit,
    parseLinearMetersToken,
  }) => {
    const modeToken = (parts[1] || '').toUpperCase();
    if (modeToken === 'WEIGHT' || modeToken === 'WEIGHTS') {
      const weightToken = (parts[2] || '').trim().toUpperCase();
      if (weightToken === 'COVARIANCE' || weightToken === 'COV') {
        state.gpsWeightingMode = 'covariance';
        logs.push('GPS weighting mode set to COVARIANCE');
      } else if (
        weightToken === 'STANDARD' ||
        weightToken === 'STDERR' ||
        weightToken === 'SIGMA' ||
        weightToken === 'OFF' ||
        weightToken === 'DEFAULT'
      ) {
        state.gpsWeightingMode = 'standard';
        logs.push('GPS weighting mode set to STANDARD');
      } else {
        logs.push(
          `Warning: invalid .GPS WEIGHT option at line ${lineNum}; expected COVARIANCE or STANDARD.`,
        );
      }
      return handled(orderExplicit);
    }

    if (modeToken === 'FACTOR') {
      const factorToken = parts[2];
      const factor = Number.parseFloat(factorToken || '');
      if (!Number.isFinite(factor) || factor <= 0) {
        logs.push(
          `Warning: invalid .GPS FACTOR option at line ${lineNum}; expected positive horizontal factor and optional VERT factor.`,
        );
        return handled(orderExplicit);
      }
      let verticalFactor = factor;
      const vertIndex = parts.findIndex((token, idx) => idx >= 3 && token.toUpperCase() === 'VERT');
      if (vertIndex >= 0) {
        const parsedVertical = Number.parseFloat(parts[vertIndex + 1] || '');
        if (!Number.isFinite(parsedVertical) || parsedVertical <= 0) {
          logs.push(
            `Warning: invalid .GPS FACTOR VERT value at line ${lineNum}; expected positive number.`,
          );
          return handled(orderExplicit);
        }
        verticalFactor = parsedVertical;
      }
      state.gpsVectorFactorHorizontal = factor;
      state.gpsVectorFactorVertical = verticalFactor;
      logs.push(
        `GPS vector factors set to horizontal=${factor.toFixed(6)}, vertical=${verticalFactor.toFixed(6)}`,
      );
      return handled(orderExplicit);
    }

    if (
      modeToken === 'VDEF' ||
      modeToken === 'VERTICALDEFLECTION' ||
      modeToken === 'VERTDEF' ||
      modeToken === 'DEFLECTION'
    ) {
      const arg1 = (parts[2] || '').trim().toUpperCase();
      if (!arg1 || arg1 === 'OFF' || arg1 === 'NONE' || arg1 === 'RESET') {
        state.verticalDeflectionNorthSec = 0;
        state.verticalDeflectionEastSec = 0;
        logs.push('GPS vertical deflection set to OFF');
        return handled(orderExplicit);
      }
      let northSec: number | null = null;
      let eastSec: number | null = null;
      for (let i = 2; i < parts.length; i += 1) {
        const token = (parts[i] || '').trim().toUpperCase();
        if (token === 'N' || token === 'NORTH') {
          const parsed = Number.parseFloat(parts[i + 1] || '');
          if (Number.isFinite(parsed)) northSec = parsed;
          i += 1;
          continue;
        }
        if (token === 'E' || token === 'EAST') {
          const parsed = Number.parseFloat(parts[i + 1] || '');
          if (Number.isFinite(parsed)) eastSec = parsed;
          i += 1;
          continue;
        }
      }
      if (northSec == null && eastSec == null && parts[2] && parts[3]) {
        const parsedNorth = Number.parseFloat(parts[2]);
        const parsedEast = Number.parseFloat(parts[3]);
        if (Number.isFinite(parsedNorth) && Number.isFinite(parsedEast)) {
          northSec = parsedNorth;
          eastSec = parsedEast;
        }
      }
      if (northSec == null || eastSec == null) {
        logs.push(
          `Warning: invalid .GPS VDEF option at line ${lineNum}; expected ".GPS VDEF <north_sec> <east_sec>" or labeled N/E values.`,
        );
        return handled(orderExplicit);
      }
      state.verticalDeflectionNorthSec = northSec;
      state.verticalDeflectionEastSec = eastSec;
      logs.push(
        `GPS vertical deflection set to N=${northSec.toFixed(3)}", E=${eastSec.toFixed(3)}"`,
      );
      return handled(orderExplicit);
    }

    if (modeToken === 'CHECK' || modeToken === 'LOOPCHECK' || modeToken === 'LOOPS') {
      const arg1 = (parts[2] || '').trim().toUpperCase();
      if (!arg1 || arg1 === 'ON' || arg1 === 'TRUE') {
        state.gpsLoopCheckEnabled = true;
        logs.push('GPS loop check set to ON');
      } else if (arg1 === 'OFF' || arg1 === 'FALSE' || arg1 === 'NONE') {
        state.gpsLoopCheckEnabled = false;
        logs.push('GPS loop check set to OFF');
      } else {
        logs.push(`Warning: invalid .GPS CHECK option at line ${lineNum}; expected OFF or ON.`);
      }
      if (parts.length > 3) {
        logs.push(
          `Warning: extra .GPS CHECK tokens ignored at line ${lineNum}; expected OFF or ON only.`,
        );
      }
      return handled(orderExplicit);
    }

    if (modeToken === 'ADDHIHT' || modeToken === 'ADDHI' || modeToken === 'HIHT') {
      const arg1 = (parts[2] || '').trim();
      const arg1Upper = arg1.toUpperCase();
      const unitLabel = state.units === 'ft' ? 'ft' : 'm';
      const toDisplayUnits = (meters: number) =>
        state.units === 'ft' ? meters * FT_PER_M : meters;
      const formatLinear = (meters: number) =>
        `${toDisplayUnits(meters).toFixed(4)} ${unitLabel}`;

      if (!arg1 || arg1Upper === 'ON') {
        state.gpsAddHiHtEnabled = true;
        if (parts[3]) {
          const parsedHi = parseLinearMetersToken(parts[3], state.units);
          if (parsedHi == null) {
            logs.push(
              `Warning: invalid .GPS AddHiHt HI value at line ${lineNum}; expected numeric value in current units.`,
            );
          } else {
            state.gpsAddHiHtHiM = parsedHi;
          }
        }
        if (parts[4]) {
          const parsedHt = parseLinearMetersToken(parts[4], state.units);
          if (parsedHt == null) {
            logs.push(
              `Warning: invalid .GPS AddHiHt HT value at line ${lineNum}; expected numeric value in current units.`,
            );
          } else {
            state.gpsAddHiHtHtM = parsedHt;
          }
        }
        if (parts.length > 5) {
          logs.push(
            `Warning: extra .GPS AddHiHt tokens ignored at line ${lineNum}; expected at most HI and HT values.`,
          );
        }
        logs.push(
          `GPS AddHiHt set to ON (HI=${formatLinear(state.gpsAddHiHtHiM ?? 0)}, HT=${formatLinear(state.gpsAddHiHtHtM ?? 0)})`,
        );
        return handled(orderExplicit);
      }

      if (arg1Upper === 'OFF' || arg1Upper === 'NONE') {
        state.gpsAddHiHtEnabled = false;
        logs.push('GPS AddHiHt set to OFF');
        return handled(orderExplicit);
      }

      const parsedHi = parseLinearMetersToken(parts[2], state.units);
      if (parsedHi == null) {
        logs.push(
          `Warning: invalid .GPS AddHiHt option at line ${lineNum}; expected OFF, ON [HI] [HT], or numeric HI [HT].`,
        );
        return handled(orderExplicit);
      }
      let parsedHt = state.gpsAddHiHtHtM ?? 0;
      if (parts[3]) {
        const htToken = parseLinearMetersToken(parts[3], state.units);
        if (htToken == null) {
          logs.push(
            `Warning: invalid .GPS AddHiHt HT value at line ${lineNum}; expected numeric value in current units.`,
          );
          return handled(orderExplicit);
        }
        parsedHt = htToken;
      }
      if (parts.length > 4) {
        logs.push(
          `Warning: extra .GPS AddHiHt tokens ignored at line ${lineNum}; expected HI and optional HT only.`,
        );
      }
      state.gpsAddHiHtEnabled = true;
      state.gpsAddHiHtHiM = parsedHi;
      state.gpsAddHiHtHtM = parsedHt;
      logs.push(
        `GPS AddHiHt set to ON (HI=${formatLinear(parsedHi)}, HT=${formatLinear(parsedHt)})`,
      );
      return handled(orderExplicit);
    }

    if (modeToken === 'FRAME' || modeToken === 'FRM') {
      const frame = parseGnssVectorFrameToken(parts[2]);
      if (!frame) {
        logs.push(
          `Warning: invalid .GPS FRAME option at line ${lineNum}; expected GRIDNEU, ENULOCAL, ECEFDELTA, LLHBASELINE, or UNKNOWN.`,
        );
        return handled(orderExplicit);
      }
      state.gnssVectorFrameDefault = frame;
      if (frame === 'unknown') {
        state.gnssFrameConfirmed = false;
      }
      const confirmToken = (parts[3] || '').trim().toUpperCase();
      if (confirmToken === 'CONFIRM' || confirmToken === 'ON' || confirmToken === 'TRUE') {
        state.gnssFrameConfirmed = true;
      } else if (
        confirmToken === 'OFF' ||
        confirmToken === 'FALSE' ||
        confirmToken === 'RESET'
      ) {
        state.gnssFrameConfirmed = false;
      }
      logs.push(
        `GPS vector frame default set to ${frame} (confirmed=${state.gnssFrameConfirmed ? 'YES' : 'NO'})`,
      );
      return handled(orderExplicit);
    }

    if (modeToken === 'CONFIRM') {
      const arg = (parts[2] || '').trim().toUpperCase();
      if (!arg || arg === 'ON' || arg === 'TRUE') {
        state.gnssFrameConfirmed = true;
        logs.push('GPS frame confirmation set to ON');
      } else if (arg === 'OFF' || arg === 'FALSE' || arg === 'RESET') {
        state.gnssFrameConfirmed = false;
        logs.push('GPS frame confirmation set to OFF');
      } else {
        logs.push(
          `Warning: invalid .GPS CONFIRM option at line ${lineNum}; expected ON or OFF.`,
        );
      }
      return handled(orderExplicit);
    }

    const mode = parseGpsVectorModeToken(parts[1]);
    if (!mode) {
      logs.push(
        `Warning: unrecognized .GPS option at line ${lineNum}; expected NETWORK, SIDESHOT, AddHiHt, CHECK, FRAME, or CONFIRM.`,
      );
      return handled(orderExplicit);
    }
    state.gpsVectorMode = mode;
    logs.push(`GPS vector mode set to ${mode.toUpperCase()}`);
    return handled(orderExplicit);
  },
  '.LWEIGHT': ({ parts, state, logs, orderExplicit }) => {
    if (parts[1]) {
      const val = parseFloat(parts[1]);
      if (!Number.isNaN(val)) {
        state.levelWeight = val;
        logs.push(`Level weight set to ${val}`);
      }
    }
    return handled(orderExplicit);
  },
  '.LEVELTOL': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const args = parts.slice(1);
    const parsePositive = (token?: string): number | undefined => {
      const parsed = parseFloat(token || '');
      if (!Number.isFinite(parsed) || parsed < 0) return undefined;
      return parsed;
    };
    if (args.length === 0) {
      logs.push(
        `Level-loop tolerance unchanged: base=${(state.levelLoopToleranceBaseMm ?? 0).toFixed(3)} mm, k=${(state.levelLoopTolerancePerSqrtKmMm ?? 4).toFixed(3)} mm/sqrt(km)`,
      );
      return handled(orderExplicit);
    }
    if (['OFF', 'NONE', 'DEFAULT', 'RESET'].includes((args[0] || '').trim().toUpperCase())) {
      state.levelLoopToleranceBaseMm = 0;
      state.levelLoopTolerancePerSqrtKmMm = 4;
      logs.push('Level-loop tolerance reset to default: base=0.000 mm, k=4.000 mm/sqrt(km)');
      return handled(orderExplicit);
    }

    let baseMm = state.levelLoopToleranceBaseMm ?? 0;
    let kMm = state.levelLoopTolerancePerSqrtKmMm ?? 4;
    let updated = false;

    if (args.length >= 2) {
      const first = parsePositive(args[0]);
      const second = parsePositive(args[1]);
      if (first != null && second != null) {
        baseMm = first;
        kMm = second;
        updated = true;
      }
    }
    for (let i = 0; i < args.length; i += 1) {
      const label = (args[i] || '').trim().toUpperCase();
      if (label === 'BASE' || label === 'B') {
        const val = parsePositive(args[i + 1]);
        if (val == null) {
          logs.push(
            `Warning: .LEVELTOL missing/invalid BASE value at line ${lineNum}; expected non-negative number in mm.`,
          );
          continue;
        }
        baseMm = val;
        updated = true;
        i += 1;
        continue;
      }
      if (label === 'K' || label === 'SQRTKM' || label === 'PERKM') {
        const val = parsePositive(args[i + 1]);
        if (val == null) {
          logs.push(
            `Warning: .LEVELTOL missing/invalid K value at line ${lineNum}; expected non-negative number in mm/sqrt(km).`,
          );
          continue;
        }
        kMm = val;
        updated = true;
        i += 1;
      }
    }
    if (!updated && args.length === 1) {
      const kOnly = parsePositive(args[0]);
      if (kOnly != null) {
        kMm = kOnly;
        updated = true;
      }
    }
    if (!updated) {
      logs.push(
        `Warning: unrecognized .LEVELTOL option at line ${lineNum}; expected ".LEVELTOL <base_mm> <k_mm_sqrt_km>" or labeled BASE/K tokens.`,
      );
      return handled(orderExplicit);
    }
    state.levelLoopToleranceBaseMm = baseMm;
    state.levelLoopTolerancePerSqrtKmMm = kMm;
    logs.push(
      `Level-loop tolerance set: base=${baseMm.toFixed(3)} mm, k=${kMm.toFixed(3)} mm/sqrt(km)`,
    );
    return handled(orderExplicit);
  },
  '.QFIX': ({ parts, lineNum, state, logs, orderExplicit, linearToMetersFactor }) => {
    const args = parts.slice(1);
    const toMeters = linearToMetersFactor();
    const unitLabel = state.units === 'ft' ? 'ft' : 'm';
    const formatSigma = (value: number) => value.toExponential(6);
    if (args.length === 0) {
      const linear = state.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M;
      const angular = state.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
      const linearDisplay = state.units === 'ft' ? linear * FT_PER_M : linear;
      logs.push(
        `QFIX unchanged: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(angular)}"`,
      );
      return handled(orderExplicit);
    }
    const mode = args[0].toUpperCase();
    if (mode === 'OFF' || mode === 'NONE' || mode === 'DEFAULT' || mode === 'RESET') {
      state.qFixLinearSigmaM = DEFAULT_QFIX_LINEAR_SIGMA_M;
      state.qFixAngularSigmaSec = DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
      const linearDisplay =
        state.units === 'ft'
          ? DEFAULT_QFIX_LINEAR_SIGMA_M * FT_PER_M
          : DEFAULT_QFIX_LINEAR_SIGMA_M;
      logs.push(
        `QFIX reset to defaults: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(DEFAULT_QFIX_ANGULAR_SIGMA_SEC)}"`,
      );
      return handled(orderExplicit);
    }
    const parsePositive = (token?: string): number | undefined => {
      const parsed = parseFloat(token || '');
      if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
      return parsed;
    };

    let linearM = state.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M;
    let angularSec = state.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC;
    let updatedLinear = false;
    let updatedAngular = false;

    if (args.length >= 2) {
      const first = parsePositive(args[0]);
      const second = parsePositive(args[1]);
      if (first != null && second != null) {
        linearM = first * toMeters;
        angularSec = second;
        updatedLinear = true;
        updatedAngular = true;
      }
    }

    for (let i = 0; i < args.length; i += 1) {
      const label = args[i].toUpperCase();
      if (label === 'LINEAR' || label === 'LIN' || label === 'DIST' || label === 'L') {
        const val = parsePositive(args[i + 1]);
        if (val == null) {
          logs.push(
            `Warning: .QFIX missing/invalid linear value at line ${lineNum}; expected positive number.`,
          );
          continue;
        }
        linearM = val * toMeters;
        updatedLinear = true;
        i += 1;
        continue;
      }
      if (label === 'ANGULAR' || label === 'ANG' || label === 'ANGLE' || label === 'A') {
        const val = parsePositive(args[i + 1]);
        if (val == null) {
          logs.push(
            `Warning: .QFIX missing/invalid angular value at line ${lineNum}; expected positive number.`,
          );
          continue;
        }
        angularSec = val;
        updatedAngular = true;
        i += 1;
      }
    }

    if (!updatedLinear && !updatedAngular && args.length === 1) {
      const both = parsePositive(args[0]);
      if (both != null) {
        linearM = both * toMeters;
        angularSec = both;
        updatedLinear = true;
        updatedAngular = true;
      }
    }
    if (!updatedLinear && !updatedAngular) {
      logs.push(
        `Warning: unrecognized .QFIX option at line ${lineNum}; expected ".QFIX <linear> <angular>" or labeled LINEAR/ANGULAR tokens.`,
      );
      return handled(orderExplicit);
    }
    state.qFixLinearSigmaM = Math.max(1e-12, linearM);
    state.qFixAngularSigmaSec = Math.max(1e-12, angularSec);
    const linearDisplay =
      state.units === 'ft' ? state.qFixLinearSigmaM * FT_PER_M : state.qFixLinearSigmaM;
    logs.push(
      `QFIX set: linear=${formatSigma(linearDisplay)} ${unitLabel}, angular=${formatSigma(
        state.qFixAngularSigmaSec,
      )}"`,
    );
    return handled(orderExplicit);
  },
  '.NORMALIZE': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (mode === 'OFF') {
      state.faceNormalizationMode = 'off';
      state.normalize = false;
    } else if (mode === 'AUTO') {
      state.faceNormalizationMode = 'auto';
      state.normalize = true;
      logs.push(
        'Warning: .NORMALIZE AUTO is a WebNet compatibility extension; native parity directives are ON/OFF.',
      );
    } else {
      state.faceNormalizationMode = 'on';
      state.normalize = true;
    }
    logs.push(
      `Normalize set to ${state.normalize} (faceNormalizationMode=${state.faceNormalizationMode?.toUpperCase()})`,
    );
    return handled(orderExplicit);
  },
  '.LONSIGN': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.lonSign = mode === 'WESTPOS' || mode === 'POSW' ? 'west-positive' : 'west-negative';
    logs.push(`Longitude sign set to ${state.lonSign}`);
    return handled(orderExplicit);
  },
  '.MULTIPLIER': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const rawValue = parts[1];
    if (!rawValue) {
      state.linearMultiplier = 1;
      logs.push('Linear multiplier reset to 1');
      return handled(orderExplicit);
    }
    const parsed = parseFloat(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      logs.push(`Warning: invalid .MULTIPLIER value at line ${lineNum}; expected positive number.`);
    } else {
      state.linearMultiplier = parsed;
      logs.push(`Linear multiplier set to ${parsed}`);
    }
    return handled(orderExplicit);
  },
  '.ELEVATION': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (!mode || mode === 'ORTHO' || mode === 'ORTHOMETRIC') {
      state.elevationInputMode = 'orthometric';
      logs.push('Elevation input mode set to ORTHOMETRIC');
    } else if (mode === 'ELLIP' || mode === 'ELLIPSOID' || mode === 'ELLIPSOIDAL') {
      state.elevationInputMode = 'ellipsoid';
      logs.push('Elevation input mode set to ELLIPSOIDAL');
    } else {
      logs.push(
        `Warning: invalid .ELEVATION mode at line ${lineNum}; expected ORTHOMETRIC or ELLIPSOIDAL.`,
      );
    }
    return handled(orderExplicit);
  },
  '.PELEVATION': ({ parts, lineNum, state, logs, orderExplicit, parseLinearMetersToken }) => {
    const token = parts[1];
    if (!token) {
      state.projectElevationMeters = 0;
      logs.push(`Project elevation reset to ${(state.projectElevationMeters ?? 0).toFixed(4)} m`);
      return handled(orderExplicit);
    }
    const parsed = parseLinearMetersToken(token, state.units);
    if (!Number.isFinite(parsed ?? Number.NaN)) {
      logs.push(`Warning: invalid .PELEVATION value at line ${lineNum}; expected numeric value.`);
    } else {
      state.projectElevationMeters = parsed as number;
      logs.push(`Project elevation set to ${(parsed as number).toFixed(4)} m`);
    }
    return handled(orderExplicit);
  },
  '.VLEVEL': ({ parts, lineNum, state, logs, orderExplicit, parseLinearMetersToken }) => {
    const token = (parts[1] || '').toUpperCase();
    if (!token || token === 'OFF') {
      logs.push('VLEVEL compatibility mode set to OFF');
      return handled(orderExplicit);
    }
    if (token.startsWith('NONE')) {
      const eqIdx = token.indexOf('=');
      const noneValueToken = eqIdx >= 0 ? token.slice(eqIdx + 1) : (parts[2] ?? '');
      const parsed = parseLinearMetersToken(noneValueToken, state.units);
      logs.push(
        `VLEVEL compatibility mode set to NONE${Number.isFinite(parsed ?? Number.NaN) && parsed != null ? ` (sigma=${parsed.toFixed(6)} m)` : ''}`,
      );
      return handled(orderExplicit);
    }
    if (token === 'FEET' || token === 'FOOT' || token === 'FT') {
      logs.push('VLEVEL compatibility mode set to FEET');
      return handled(orderExplicit);
    }
    if (token === 'MILES' || token === 'MI') {
      logs.push('VLEVEL compatibility mode set to MILES');
      return handled(orderExplicit);
    }
    if (token === 'METERS' || token === 'METER' || token === 'M') {
      logs.push('VLEVEL compatibility mode set to METERS');
      return handled(orderExplicit);
    }
    if (token === 'KILOMETERS' || token === 'KILOMETER' || token === 'KM') {
      logs.push('VLEVEL compatibility mode set to KILOMETERS');
      return handled(orderExplicit);
    }
    if (token === 'TURNS' || token === 'TURN') {
      logs.push('VLEVEL compatibility mode set to TURNS');
      return handled(orderExplicit);
    }
    logs.push(
      `Warning: invalid .VLEVEL option at line ${lineNum}; expected FEET/MILES/METERS/KILOMETERS/TURNS/NONE/OFF.`,
    );
    return handled(orderExplicit);
  },
  '.EDM': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.edmMode = mode === 'PROPAGATED' || mode === 'RSS' ? 'propagated' : 'additive';
    logs.push(`EDM mode set to ${state.edmMode}`);
    return handled(orderExplicit);
  },
  '.CENTERING': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.applyCentering = mode !== 'OFF';
    logs.push(`Centering inflation set to ${state.applyCentering}`);
    return handled(orderExplicit);
  },
  '.ADDC': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.addCenteringToExplicit = mode === 'ON';
    logs.push(`Add centering to explicit std dev set to ${state.addCenteringToExplicit}`);
    return handled(orderExplicit);
  },
  '.DEBUG': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.debug = mode !== 'OFF';
    logs.push(`Debug logging set to ${state.debug}`);
    return handled(orderExplicit);
  },
  '.CURVREF': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (mode === 'ON' || mode === 'OFF') {
      state.applyCurvatureRefraction = mode === 'ON';
      logs.push(`Curvature/refraction set to ${state.applyCurvatureRefraction}`);
    } else if (parts[1] && Number.isFinite(parseFloat(parts[1]))) {
      state.refractionCoefficient = parseFloat(parts[1]);
      state.applyCurvatureRefraction = true;
      logs.push(`Curvature/refraction enabled with k=${state.refractionCoefficient.toFixed(3)}`);
    }
    return handled(orderExplicit);
  },
  '.REFRACTION': ({ parts, state, logs, orderExplicit }) => {
    if (parts[1]) {
      const k = parseFloat(parts[1]);
      if (Number.isFinite(k)) {
        state.refractionCoefficient = k;
        logs.push(`Refraction coefficient set to ${k}`);
      }
    }
    return handled(orderExplicit);
  },
  '.VRED': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    state.verticalReduction =
      mode === 'CR' || mode === 'CURVREF' || mode === 'CURVATURE' ? 'curvref' : 'none';
    logs.push(`Vertical reduction set to ${state.verticalReduction}`);
    return handled(orderExplicit);
  },
  '.AMODE': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    let angleMode: ParseOptions['angleMode'] = 'auto';
    if (mode === 'ANGLE') angleMode = 'angle';
    if (mode === 'DIR' || mode === 'AZ' || mode === 'AZIMUTH') angleMode = 'dir';
    state.angleMode = angleMode;
    logs.push(`A-record mode set to ${angleMode}`);
    return handled(orderExplicit);
  },
  '.ROBUST': ({ parts, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    const maybeK = parseFloat(parts[2] || parts[1] || '');
    if (!mode || mode === 'OFF' || mode === 'NONE' || mode === '0') {
      state.robustMode = 'none';
      logs.push('Robust mode set to none');
    } else {
      state.robustMode = 'huber';
      if (Number.isFinite(maybeK)) {
        state.robustK = Math.max(0.5, Math.min(10, maybeK));
      }
      logs.push(`Robust mode set to huber (k=${(state.robustK ?? 1.5).toFixed(2)})`);
    }
    return handled(orderExplicit);
  },
  '.AUTOADJUST': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const directive = parseAutoAdjustDirectiveTokens(parts);
    if (!directive) {
      logs.push(
        `Warning: unrecognized .AUTOADJUST option at line ${lineNum}; expected ON/OFF and optional threshold/cycles/removals`,
      );
      return handled(orderExplicit);
    }
    if (directive.enabled != null) state.autoAdjustEnabled = directive.enabled;
    if (directive.stdResThreshold != null)
      state.autoAdjustStdResThreshold = directive.stdResThreshold;
    if (directive.maxCycles != null) state.autoAdjustMaxCycles = directive.maxCycles;
    if (directive.maxRemovalsPerCycle != null)
      state.autoAdjustMaxRemovalsPerCycle = directive.maxRemovalsPerCycle;
    logs.push(
      `Auto-adjust set to ${state.autoAdjustEnabled ? 'ON' : 'OFF'} (|t|>=${(
        state.autoAdjustStdResThreshold ?? 4
      ).toFixed(2)}, cycles=${state.autoAdjustMaxCycles ?? 3}, maxRemovals=${state.autoAdjustMaxRemovalsPerCycle ?? 1})`,
    );
    return handled(orderExplicit);
  },
  '.PRISM': ({ parts, lineNum, state, logs, orderExplicit, linearToMetersFactor }) => {
    const a1 = (parts[1] || '').toUpperCase();
    const toMeters = linearToMetersFactor();
    let scope: ParseOptions['prismScope'] = state.prismScope ?? 'global';
    let valueToken = parts[1];

    if (a1 === 'GLOBAL') {
      scope = 'global';
      valueToken = parts[2];
    } else if (a1 === 'SET' || a1 === 'LOCAL') {
      scope = 'set';
      valueToken = parts[2];
    }

    if (a1 === 'OFF' || a1 === 'NONE' || a1 === '0') {
      state.prismEnabled = false;
      state.prismOffset = 0;
      state.prismScope = scope;
      logs.push(`Prism correction set to OFF (scope=${scope})`);
      return handled(orderExplicit);
    }

    if (a1 === 'ON') {
      valueToken = parts[2];
      if (!valueToken) {
        state.prismEnabled = true;
        state.prismScope = scope;
        logs.push(
          `Prism correction set to ON (offset=${(state.prismOffset ?? 0).toFixed(4)} m, scope=${scope})`,
        );
        return handled(orderExplicit);
      }
    }

    const rawOffset = parseFloat(valueToken || '');
    if (!Number.isFinite(rawOffset)) {
      logs.push(
        `Warning: unrecognized .PRISM option at line ${lineNum}; expected ON/OFF or numeric offset value.`,
      );
      return handled(orderExplicit);
    }

    const offsetM = rawOffset * toMeters;
    state.prismEnabled = true;
    state.prismOffset = offsetM;
    state.prismScope = scope;
    logs.push(`Prism correction set to ON (offset=${offsetM.toFixed(4)} m, scope=${scope})`);
    if (Math.abs(offsetM) > 2) {
      logs.push(`Warning: large prism offset at line ${lineNum} (${offsetM.toFixed(4)} m)`);
    }
    return handled(orderExplicit);
  },
  '.ROTATION': ({ parts, lineNum, state, logs, orderExplicit, parseAngleTokenRad, wrapTo2Pi }) => {
    const token = parts[1];
    if (!token) {
      logs.push(`Warning: .ROTATION missing angle at line ${lineNum}; expected .ROTATION <angle>.`);
      return handled(orderExplicit);
    }
    const delta = parseAngleTokenRad(token, state, 'dd');
    if (!Number.isFinite(delta)) {
      logs.push(`Warning: invalid .ROTATION angle at line ${lineNum}; expected DD or DMS token.`);
      return handled(orderExplicit);
    }
    const prior = state.rotationAngleRad ?? 0;
    const next = wrapTo2Pi(prior + delta);
    state.rotationAngleRad = next;
    logs.push(
      `Plan rotation updated at line ${lineNum}: +${(delta * RAD_TO_DEG).toFixed(6)}° => ${(next * RAD_TO_DEG).toFixed(6)}°`,
    );
    return handled(orderExplicit);
  },
  '.LOSTSTATIONS': ({
    parts,
    lineNum,
    logs,
    orderExplicit,
    splitCommaTokens,
    lostStationIds,
    stations,
  }) => {
    const tokens = splitCommaTokens(parts.slice(1), true);
    if (tokens.length === 0) {
      logs.push(
        `Warning: .LOSTSTATIONS missing station IDs at line ${lineNum}; expected .LOSTSTATIONS <id...> or .LOSTSTATIONS CLEAR.`,
      );
      return handled(orderExplicit);
    }
    const clearMode = ['OFF', 'NONE', 'CLEAR', 'RESET'].includes(tokens[0].toUpperCase());
    if (clearMode) {
      lostStationIds.clear();
      Object.values(stations).forEach((st) => {
        if (st.lost) delete st.lost;
      });
      logs.push(`Lost stations cleared at line ${lineNum}.`);
      return handled(orderExplicit);
    }
    let added = 0;
    let removed = 0;
    tokens.forEach((rawToken) => {
      const removing = rawToken.startsWith('-');
      const token = removing ? rawToken.slice(1).trim() : rawToken.replace(/^\+/, '').trim();
      if (!token) return;
      if (removing) {
        if (lostStationIds.delete(token)) removed += 1;
        const station = stations[token];
        if (station?.lost) delete station.lost;
        return;
      }
      if (!lostStationIds.has(token)) added += 1;
      lostStationIds.add(token);
      const station = stations[token];
      if (station) station.lost = true;
    });
    logs.push(
      `Lost stations updated at line ${lineNum}: total=${lostStationIds.size}, added=${added}, removed=${removed}.`,
    );
    return handled(orderExplicit);
  },
  '.AUTOSIDESHOT': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (mode === 'ON' || mode === 'TRUE' || mode === '1') {
      state.autoSideshotEnabled = true;
      logs.push('Auto-sideshot detection set to ON');
    } else if (mode === 'OFF' || mode === 'FALSE' || mode === '0') {
      state.autoSideshotEnabled = false;
      logs.push('Auto-sideshot detection set to OFF');
    } else {
      logs.push(`Warning: unrecognized .AUTOSIDESHOT option at line ${lineNum}; expected ON/OFF`);
    }
    return handled(orderExplicit);
  },
  '.DESC': ({
    parts,
    lineNum,
    state,
    logs,
    orderExplicit,
    defaultDescriptionReconcileMode,
    defaultDescriptionAppendDelimiter,
  }) => {
    const mode = (parts[1] || '').toUpperCase();
    if (mode === 'FIRST' || mode === 'DEFAULT') {
      state.descriptionReconcileMode = 'first';
      state.descriptionAppendDelimiter = ' | ';
      logs.push('Description reconciliation set to FIRST');
      return handled(orderExplicit);
    }
    if (mode === 'APPEND' || mode === 'MERGE') {
      state.descriptionReconcileMode = 'append';
      const delimiter = parts.slice(2).join(' ').trim();
      if (delimiter) {
        state.descriptionAppendDelimiter = delimiter;
      }
      logs.push(
        `Description reconciliation set to APPEND (delimiter="${state.descriptionAppendDelimiter ?? ' | '}")`,
      );
      return handled(orderExplicit);
    }
    if (mode === 'RESET') {
      state.descriptionReconcileMode = defaultDescriptionReconcileMode;
      state.descriptionAppendDelimiter = defaultDescriptionAppendDelimiter;
      logs.push('Description reconciliation reset to defaults (FIRST)');
      return handled(orderExplicit);
    }
    logs.push(
      `Warning: unrecognized .DESC option at line ${lineNum}; expected FIRST or APPEND [delimiter]`,
    );
    return handled(orderExplicit);
  },
  '.TSCORR': ({ parts, lineNum, state, logs, orderExplicit }) => {
    const parseScope = (token?: string): ParseOptions['tsCorrelationScope'] | undefined => {
      const mode = (token || '').toUpperCase();
      if (mode === 'SETUP') return 'setup';
      if (mode === 'SET') return 'set';
      return undefined;
    };
    const parseRho = (token?: string): number | undefined => {
      const val = parseFloat(token || '');
      if (!Number.isFinite(val)) return undefined;
      return Math.min(0.95, Math.max(0, val));
    };
    const t1 = (parts[1] || '').toUpperCase();
    const t2 = (parts[2] || '').toUpperCase();
    let enabled = state.tsCorrelationEnabled ?? false;
    let rho = state.tsCorrelationRho ?? 0.25;
    let scope: ParseOptions['tsCorrelationScope'] = state.tsCorrelationScope ?? 'set';

    if (!t1 || t1 === 'ON' || t1 === 'TRUE') {
      enabled = true;
      const maybeScope = parseScope(t2);
      const maybeRho = parseRho(parts[2]);
      if (maybeScope) scope = maybeScope;
      else if (maybeRho != null) rho = maybeRho;
    } else if (t1 === 'OFF' || t1 === 'FALSE' || t1 === '0') {
      enabled = false;
    } else {
      const scope1 = parseScope(t1);
      const rho1 = parseRho(parts[1]);
      if (scope1) {
        enabled = true;
        scope = scope1;
        const rho2 = parseRho(parts[2]);
        if (rho2 != null) rho = rho2;
      } else if (rho1 != null) {
        enabled = true;
        rho = rho1;
        const scope2 = parseScope(t2);
        if (scope2) scope = scope2;
      } else {
        logs.push(
          `Warning: unrecognized .TSCORR option at line ${lineNum}; expected ON/OFF/SET/SETUP/rho`,
        );
      }
    }

    state.tsCorrelationEnabled = enabled;
    state.tsCorrelationRho = rho;
    state.tsCorrelationScope = scope;
    logs.push(
      `TS correlation set to ${enabled ? 'ON' : 'OFF'} (scope=${scope}, rho=${rho.toFixed(3)})`,
    );
    return handled(orderExplicit);
  },
  '.ALIAS': ({ parts, orderExplicit, aliasPipeline }) => {
    aliasPipeline.handleAliasDirective(parts.slice(1));
    return handled(orderExplicit);
  },
  '.COPYINPUT': ({ op, logs, lineNum, orderExplicit, compatibilityAcceptedNoOps }) => {
    if (!compatibilityAcceptedNoOps.has(op)) {
      compatibilityAcceptedNoOps.add(op);
      logs.push(
        `Compatibility: ${op} accepted at line ${lineNum} but behavior is not yet applied in this version.`,
      );
    }
    return handled(orderExplicit);
  },
  '.ELLIPSE': ({ parts, state, logs, lineNum, orderExplicit, splitCommaTokens }) => {
    const stationIds = dedupeDirectiveStationIds(
      splitCommaTokens(parts.slice(1), true).filter((token) => !token.trim().startsWith('/')),
    );
    state.ellipseStationIds = stationIds as StationId[];
    if (stationIds.length === 0) {
      logs.push(`Warning: .ELLIPSE at line ${lineNum} did not select any stations.`);
    } else {
      logs.push(`Error ellipse output limited to ${stationIds.length} station(s).`);
    }
    return handled(orderExplicit);
  },
  '.RELATIVE': ({ parts, state, logs, lineNum, orderExplicit, splitCommaTokens }) => {
    const parsed = parseRelativeLineDirectivePairs(splitCommaTokens(parts.slice(1), true));
    state.relativeLinePairs = parsed.pairs;
    parsed.warnings.forEach((warning) =>
      logs.push(`Warning: .RELATIVE at line ${lineNum} ${warning}.`),
    );
    if (parsed.pairs.length === 0) {
      logs.push(`Warning: .RELATIVE at line ${lineNum} did not select any station pairs.`);
    } else {
      logs.push(
        `Relative line output selected ${parsed.pairs.length} pair(s)${
          parsed.stationIds ? ` from ${parsed.stationIds.length} station(s)` : ''
        }.`,
      );
    }
    return handled(orderExplicit);
  },
  '.PTOLERANCE': ({ parts, state, logs, lineNum, orderExplicit, splitCommaTokens }) => {
    const parsed = parseRelativeLineDirectivePairs(splitCommaTokens(parts.slice(1), true));
    state.positionalTolerancePairs = parsed.pairs;
    parsed.warnings.forEach((warning) =>
      logs.push(`Warning: .PTOLERANCE at line ${lineNum} ${warning}.`),
    );
    if (parsed.pairs.length === 0) {
      logs.push(`Warning: .PTOLERANCE at line ${lineNum} did not select any station pairs.`);
    } else {
      logs.push(
        `Positional tolerance checking selected ${parsed.pairs.length} pair(s)${
          parsed.stationIds ? ` from ${parsed.stationIds.length} station(s)` : ''
        }.`,
      );
    }
    return handled(orderExplicit);
  },
  '.INCLUDE': ({ logs, lineNum, orderExplicit }) => {
    logs.push(`Include directive already expanded at line ${lineNum}.`);
    return handled(orderExplicit);
  },
  '.I': ({ parts, state, logs, orderExplicit }) => {
    if (parts[1]) {
      state.currentInstrument = parts[1];
      logs.push(`Current instrument set to ${state.currentInstrument}`);
    }
    return handled(orderExplicit);
  },
  '.TS': ({ parts, state, logs, orderExplicit }) => {
    if (parts[1]) {
      state.currentInstrument = parts[1];
      logs.push(`Current instrument set to ${state.currentInstrument}`);
    }
    return handled(orderExplicit);
  },
  '.INST': ({ parts, state, logs, orderExplicit, flushDirectionSet }) => {
    flushDirectionSet('.INST');
    if (parts[1]) {
      state.currentInstrument = parts[1];
      logs.push(`Current instrument set to ${state.currentInstrument}`);
    }
    return handled(orderExplicit);
  },
  '.END': ({ logs, orderExplicit, flushDirectionSet }) => {
    flushDirectionSet('.END');
    logs.push('END encountered; stopping parse');
    return handled(orderExplicit, { stopParse: true });
  },
};

export const dispatchParseDirective = (
  args: ParseDirectiveDispatchArgs,
): ParseDirectiveDispatchResult => {
  const coreDirectiveResult = applyCoreDirectiveState(args);
  if (coreDirectiveResult.handled) return coreDirectiveResult;
  const handler = SPECIALIZED_DIRECTIVE_HANDLERS[args.op];
  if (handler) return handler(args);
  return handled(args.orderExplicit);
};
