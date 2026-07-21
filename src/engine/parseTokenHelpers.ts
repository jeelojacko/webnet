import { dmsToRad, RAD_TO_DEG } from './angles';
import type { CrsProjectionModel, ParseOptions, StationMap, StationId } from '../types';

export const FT_PER_M = 3.280839895;
export const FACE2_WEIGHT = 1 / Math.SQRT2; // exact face-2 weighting factor
export const DEG_TO_RAD = Math.PI / 180;
export const AMODE_AUTO_MAX_DIR_RAD = 3 * DEG_TO_RAD;
export const AMODE_AUTO_MARGIN_RAD = 0.5 * DEG_TO_RAD;
export const DESCRIPTION_RECORD_TYPES = new Set(['C', 'P', 'PH', 'CH', 'EH', 'E']);
export const normalizeDescriptionText = (value: string): string => value.replace(/\s+/g, ' ').trim();
export const splitInlineCommentAndDescription = (line: string): { line: string; description?: string } => {
  const hash = line.indexOf('#');
  const quote = line.indexOf("'");
  let cut = -1;
  if (hash >= 0) cut = hash;
  if (quote >= 0) cut = cut >= 0 ? Math.min(cut, quote) : quote;
  const parsedLine = cut >= 0 ? line.slice(0, cut).trim() : line.trim();
  const description =
    quote >= 0 && (hash < 0 || quote < hash) ? normalizeDescriptionText(line.slice(quote + 1)) : '';
  return description ? { line: parsedLine, description } : { line: parsedLine };
};

export const isWhitespaceCharCode = (code: number): boolean =>
  code === 32 || code === 9 || code === 10 || code === 11 || code === 12 || code === 13;

export const splitWhitespaceTokens = (line: string): string[] => {
  const tokens: string[] = [];
  let start = -1;
  for (let i = 0; i < line.length; i += 1) {
    if (isWhitespaceCharCode(line.charCodeAt(i))) {
      if (start >= 0) {
        tokens.push(line.slice(start, i));
        start = -1;
      }
    } else if (start < 0) {
      start = i;
    }
  }
  if (start >= 0) tokens.push(line.slice(start));
  return tokens;
};

export const splitCommaTokens = (tokens: string[], trimSegments: boolean): string[] => {
  const expanded: string[] = [];
  tokens.forEach((token) => {
    let start = 0;
    for (let i = 0; i <= token.length; i += 1) {
      if (i === token.length || token.charCodeAt(i) === 44) {
        const segment = token.slice(start, i);
        const normalized = trimSegments ? segment.trim() : segment;
        if (normalized.length > 0) expanded.push(normalized);
        start = i + 1;
      }
    }
  });
  return expanded;
};

export const isNumericToken = (token: string): boolean => {
  if (!token) return false;
  if (token === '!' || token === '*') return false;
  return !Number.isNaN(Number(token));
};

type ControlComponentMode = 'inherit' | 'fixed' | 'free';

export const parseFixityTokens = (
  tokens: string[],
  componentCount: number,
): {
  componentModes: ControlComponentMode[];
  fixities: boolean[];
  hasTokens: boolean;
  hasFreeMarkers: boolean;
  legacyStarFixed: boolean;
} => {
  const raw = tokens.flatMap((token) =>
    token === '!' || token === '*'
      ? [token]
      : /^[!*]+$/.test(token)
        ? token.split('')
        : [],
  );
  if (!raw.length) {
    return {
      componentModes: new Array(componentCount).fill('inherit'),
      fixities: new Array(componentCount).fill(false),
      hasTokens: false,
      hasFreeMarkers: false,
      legacyStarFixed: false,
    };
  }
  if (raw.length === 1 && raw[0] === '!') {
    return {
      componentModes: new Array(componentCount).fill('fixed'),
      fixities: new Array(componentCount).fill(true),
      hasTokens: true,
      hasFreeMarkers: false,
      legacyStarFixed: false,
    };
  }
  if (raw.length === 1 && raw[0] === '*') {
    return {
      componentModes: new Array(componentCount).fill('fixed'),
      fixities: new Array(componentCount).fill(true),
      hasTokens: true,
      hasFreeMarkers: false,
      legacyStarFixed: true,
    };
  }
  const componentModes = new Array(componentCount).fill('inherit') as ControlComponentMode[];
  const fixities = new Array(componentCount).fill(false);
  for (let i = 0; i < componentCount && i < raw.length; i += 1) {
    const mode = raw[i] === '!' ? 'fixed' : 'free';
    componentModes[i] = mode;
    fixities[i] = mode === 'fixed';
  }
  return {
    componentModes,
    fixities,
    hasTokens: true,
    hasFreeMarkers: componentModes.includes('free'),
    legacyStarFixed: false,
  };
};

export const parseConstraintCorrToken = (value: number | undefined): number | undefined => {
  if (!Number.isFinite(value as number)) return undefined;
  return Math.max(-0.999, Math.min(0.999, value as number));
};

export const applyFixities = (
  station: StationMap[string],
  fix: { x?: boolean; y?: boolean; h?: boolean },
  coordMode: ParseOptions['coordMode'],
): void => {
  if (fix.x != null) station.fixedX = fix.x;
  if (fix.y != null) station.fixedY = fix.y;
  if (fix.h != null) station.fixedH = fix.h;
  const fx = station.fixedX ?? false;
  const fy = station.fixedY ?? false;
  const fh = station.fixedH ?? false;
  station.fixed = coordMode === '2D' ? fx && fy : fx && fy && fh;
};

export const clearStationConstraintComponent = (
  station: StationMap[string],
  component: 'x' | 'y' | 'h',
): void => {
  if (component === 'x') {
    delete station.sx;
    delete station.constraintX;
  } else if (component === 'y') {
    delete station.sy;
    delete station.constraintY;
  } else {
    delete station.sh;
    delete station.constraintH;
  }
  if (component === 'x' || component === 'y') {
    delete station.constraintCorrXY;
  }
};

export const setStationConstraintMode = (
  station: StationMap[string],
  component: 'x' | 'y' | 'h',
  mode: StationMap[string]['constraintModeX'],
): void => {
  if (component === 'x') station.constraintModeX = mode;
  else if (component === 'y') station.constraintModeY = mode;
  else station.constraintModeH = mode;
};

export const resolveStationConstraintMode = (
  explicitMode: ControlComponentMode,
  fixed: boolean,
  hasConstraint: boolean,
): StationMap[string]['constraintModeX'] => {
  if (explicitMode === 'free') return 'free';
  if (fixed) return 'fixed';
  if (hasConstraint) return 'weighted';
  return 'approximate';
};

export const wrapToPi = (val: number): number => {
  let v = val;
  if (v > Math.PI) v -= 2 * Math.PI;
  if (v < -Math.PI) v += 2 * Math.PI;
  return v;
};

export const wrapTo2Pi = (val: number): number => {
  let v = val % (2 * Math.PI);
  if (v < 0) v += 2 * Math.PI;
  return v;
};

export const azimuthFromTo = (
  stations: StationMap,
  from: StationId,
  to: StationId,
): { az: number; dist: number } | null => {
  const s1 = stations[from];
  const s2 = stations[to];
  if (!s1 || !s2) return null;
  const dx = s2.x - s1.x;
  const dy = s2.y - s1.y;
  let az = Math.atan2(dx, dy);
  if (az < 0) az += 2 * Math.PI;
  return { az, dist: Math.sqrt(dx * dx + dy * dy) };
};

export const splitStationPairToken = (token: string, separator = '-'): string[] => {
  if (!token) return [];
  if (separator === '-') return token.split('-');
  return token.split(separator);
};

export const parseFromTo = (
  parts: string[],
  startIndex: number,
  separator = '-',
): { from: string; to: string; nextIndex: number } => {
  const token = parts[startIndex];
  if (!token) return { from: '', to: '', nextIndex: startIndex + 1 };
  if (token.includes(separator)) {
    const [from, to] = splitStationPairToken(token, separator);
    return { from, to, nextIndex: startIndex + 1 };
  }
  const from = token;
  const to = parts[startIndex + 1] ?? '';
  return { from, to, nextIndex: startIndex + 2 };
};

export type SsStationTokens =
  | {
      mode: 'legacy';
      at: string;
      to: string;
      explicitBacksight?: undefined;
      angleTokenIndex: number;
    }
  | {
      mode: 'at-to';
      at: string;
      to: string;
      explicitBacksight?: undefined;
      angleTokenIndex: number;
    }
  | {
      mode: 'at-from-to';
      at: string;
      to: string;
      explicitBacksight: string;
      angleTokenIndex: number;
    };

export const parseSsStationTokens = (parts: string[], separator = '-'): SsStationTokens | null => {
  const first = parts[1] ?? '';
  if (!first) return null;
  if (first.includes(separator)) {
    const stations = splitStationPairToken(first, separator)
      .map((token) => token.trim())
      .filter(Boolean);
    if (stations.length === 2) {
      return {
        mode: 'at-to',
        at: stations[0],
        to: stations[1],
        angleTokenIndex: 2,
      };
    }
    if (stations.length === 3) {
      return {
        mode: 'at-from-to',
        at: stations[0],
        explicitBacksight: stations[1],
        to: stations[2],
        angleTokenIndex: 2,
      };
    }
    return null;
  }
  return {
    mode: 'legacy',
    at: first,
    to: parts[2] ?? '',
    angleTokenIndex: 3,
  };
};

export const parseQuadrantBearingTokenToRad = (token: string): number | null => {
  const cleaned = token.trim().toUpperCase().replace(/\s+/g, '');
  const match = cleaned.match(/^([NS])(.+)([EW])$/);
  if (!match) return null;
  const ns = match[1];
  const body = match[2];
  const ew = match[3];
  const bodyDeg = body.includes('-') ? dmsToRad(body) * RAD_TO_DEG : Number.parseFloat(body);
  if (!Number.isFinite(bodyDeg)) return null;
  const clamped = Math.max(0, Math.min(90, bodyDeg));
  let azDeg = clamped;
  if (ns === 'N' && ew === 'E') azDeg = clamped;
  else if (ns === 'S' && ew === 'E') azDeg = 180 - clamped;
  else if (ns === 'S' && ew === 'W') azDeg = 180 + clamped;
  else if (ns === 'N' && ew === 'W') azDeg = 360 - clamped;
  return wrapTo2Pi(azDeg * DEG_TO_RAD);
};

export const extractHiHt = (tokens: string[]): { hi?: number; ht?: number; rest: string[] } => {
  const idx = tokens.findIndex((t) => t.includes('/'));
  if (idx < 0) return { rest: tokens };
  const token = tokens[idx];
  const [hiStr, htStr] = token.split('/');
  const hi = parseFloat(hiStr);
  const ht = parseFloat(htStr);
  const rest = tokens.filter((_, i) => i !== idx);
  return {
    hi: Number.isNaN(hi) ? undefined : hi,
    ht: Number.isNaN(ht) ? undefined : ht,
    rest,
  };
};

export const toDegrees = (token: string): number => {
  if (!token) return Number.NaN;
  const quadrant = parseQuadrantBearingTokenToRad(token);
  if (quadrant != null) return quadrant * RAD_TO_DEG;
  if (token.includes('-')) return dmsToRad(token) * RAD_TO_DEG;
  return parseFloat(token);
};

export const parseAngleTokenRad = (
  token: string | undefined,
  state: ParseOptions,
  fallbackMode: 'dms' | 'dd' = 'dms',
): number => {
  if (!token) return Number.NaN;
  const trimmed = token.trim();
  if (!trimmed) return Number.NaN;
  const quadrant = parseQuadrantBearingTokenToRad(trimmed);
  if (quadrant != null) return quadrant;
  if (trimmed.includes('-')) return dmsToRad(trimmed);
  const val = parseFloat(trimmed);
  if (Number.isNaN(val)) return Number.NaN;
  const mode = state.angleUnits ?? fallbackMode;
  if (mode === 'dd') return val * DEG_TO_RAD;
  return dmsToRad(trimmed);
};

export const applyPlanRotation = (angleRad: number, state: ParseOptions): number => {
  if (!Number.isFinite(angleRad)) return angleRad;
  const rotation = state.rotationAngleRad ?? 0;
  if (!Number.isFinite(rotation) || Math.abs(rotation) <= 0) return wrapTo2Pi(angleRad);
  return wrapTo2Pi(angleRad + rotation);
};

export const activeCrsProjectionModel = (state: ParseOptions): CrsProjectionModel =>
  state.crsTransformEnabled
    ? (state.crsProjectionModel ?? 'legacy-equirectangular')
    : 'legacy-equirectangular';

export const parseLinearMetersToken = (
  token: string | undefined,
  units: ParseOptions['units'],
): number | null => {
  if (!token) return null;
  const parsed = parseFloat(token);
  if (!Number.isFinite(parsed)) return null;
  return units === 'ft' ? parsed / FT_PER_M : parsed;
};

