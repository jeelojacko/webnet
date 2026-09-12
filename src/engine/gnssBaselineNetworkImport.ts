/**
 * Phase 12C — WebNet-native static GNSS baseline text import boundary.
 *
 * Standalone syntax (never enters the legacy .dat parser):
 *
 *   FRAME ECEF <frame-id> [EPOCH <epoch>] [ELLIPSOID <ellipsoid>]
 *   FRAME ENU  <frame-id> [EPOCH <epoch>] [ELLIPSOID <ellipsoid>]
 *     ORIGIN_LAT <deg> ORIGIN_LON <deg>
 *   UNITS M | MM | CM
 *   GX <id> <X> <Y> <Z> [FIXED | FREE]
 *   BL <from> <to> <dx> <dy> <dz> [ID <code>] [SESSION <s>] [SOLUTION <q>] [SOURCE <t>]
 *   COV <xx> <xy> <xz> <yy> <yz> <zz>
 *   SIGCORR <sx> <sy> <sz> <rhoXY> <rhoXZ> <rhoYZ>
 *
 * One FRAME and one UNITS per file. Every BL is followed by exactly one
 * COV or SIGCORR block. Covariance order is xx xy xz yy yz zz.
 * Canonical output is ECEF metres / m^2 (Phase 12B observation).
 */
import type { StationMap } from '../types';
import type {
  GnssBaselineCovariance,
  GnssBaselineObservation,
} from './gnssBaselineTypes';
import { validateGnssBaselineCovariance } from './gnssBaselineCovariance';
import {
  buildEnuRotation,
  rotateEnuCovarianceToEcef,
  rotateEnuVectorToEcef,
  verifyRotationOrthonormal,
} from './gnssBaselineRotation';
import { runGnssBaselinePreflight } from './gnssBaselinePreflight';

export type GnssDiagnosticSeverity = 'error' | 'warning';

export interface GnssDiagnostic {
  severity: GnssDiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
  row?: number;
  baselineId?: string;
  stationId?: string;
}

export type GnssInputVectorFrame = 'ecef' | 'enu';
export type GnssInputUnits = 'm' | 'mm' | 'cm';

export interface GnssFrameMetadata {
  vectorFrame: GnssInputVectorFrame;
  referenceFrame: string;
  epoch?: string;
  ellipsoid?: string;
  originLatDeg?: number;
  originLonDeg?: number;
}

export interface GnssImportProvenance {
  baselineId: number;
  baselineCode?: string;
  line: number;
  originalVector: { x: number; y: number; z: number };
  originalUnits: string;
  stochasticForm: 'COV' | 'SIGCORR';
  inputFrame: GnssInputVectorFrame;
  rotationApplied: boolean;
  canonicalVector: { x: number; y: number; z: number };
  canonicalCovariance: GnssBaselineCovariance;
}

export interface GnssBaselineNetworkInput {
  stations: StationMap;
  baselines: GnssBaselineObservation[];
  frame: GnssFrameMetadata;
  inputUnits: GnssInputUnits;
  provenance: GnssImportProvenance[];
  sourceFile?: string;
}

export interface GnssParseResult {
  network: GnssBaselineNetworkInput | null;
  diagnostics: GnssDiagnostic[];
}

const MAX_LINE_LENGTH = 4096;
const MAX_TOKEN_LENGTH = 64;
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor']);

const STRICT_NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export const parseGnssStrictNumber = (
  token: string | undefined,
  what: string,
  line: number,
): number => {
  const text = (token ?? '').trim();
  if (!text || !STRICT_NUMBER.test(text)) {
    throw new Error(`Line ${line}: ${what} '${token ?? ''}' is not a strict decimal number.`);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new Error(`Line ${line}: ${what} '${token ?? ''}' is not finite.`);
  }
  return value;
};

const checkIdToken = (token: string, what: string, line: number): string => {
  const id = token.trim();
  if (!id || id.length > MAX_TOKEN_LENGTH || RESERVED_IDS.has(id)) {
    throw new Error(`Line ${line}: invalid ${what} '${token}'.`);
  }
  return id;
};

const UNIT_SCALE: Record<string, number> = { M: 1, MM: 0.001, CM: 0.01 };

/** Raw (pre-canonicalization) baseline as parsed from text. */
interface RawBaseline {
  from: string;
  to: string;
  vector: { x: number; y: number; z: number };
  covariance: GnssBaselineCovariance;
  stochasticForm: 'COV' | 'SIGCORR';
  sessionId?: string;
  solutionId?: string;
  sourceTag?: string;
  baselineCode?: string;
  line: number;
}

interface RawStation {
  id: string;
  x: number;
  y: number;
  z: number;
  fixed: boolean;
  line: number;
}

const sigCorrToCovariance = (
  sx: number,
  sy: number,
  sz: number,
  rhoXY: number,
  rhoXZ: number,
  rhoYZ: number,
  line: number,
): GnssBaselineCovariance => {
  for (const [name, value] of [
    ['sigmaX', sx],
    ['sigmaY', sy],
    ['sigmaZ', sz],
    ['rhoXY', rhoXY],
    ['rhoXZ', rhoXZ],
    ['rhoYZ', rhoYZ],
  ] as const) {
    if (!Number.isFinite(value)) {
      throw new Error(`Line ${line}: SIGCORR ${name} is not finite.`);
    }
  }
  if (sx <= 0 || sy <= 0 || sz <= 0) {
    throw new Error(`Line ${line}: SIGCORR sigmas must be positive (sx=${sx}, sy=${sy}, sz=${sz}).`);
  }
  for (const [name, value] of [
    ['rhoXY', rhoXY],
    ['rhoXZ', rhoXZ],
    ['rhoYZ', rhoYZ],
  ] as const) {
    if (value < -1 || value > 1) {
      throw new Error(`Line ${line}: SIGCORR ${name}=${value} outside [-1, 1]; no clamping applied.`);
    }
  }
  return {
    xx: sx * sx,
    yy: sy * sy,
    zz: sz * sz,
    xy: rhoXY * sx * sy,
    xz: rhoXZ * sx * sz,
    yz: rhoYZ * sy * sz,
  };
};

const LEGACY_CODES = new Set([
  'G', 'G0', 'G1', 'G2', 'G3', 'G4', 'D', 'A', 'E', 'SD', 'HD', 'VD', 'AZ',
  'BRG', 'DIST', 'HVD', 'VDIST', 'ZEN', 'VA', 'HA', 'L', 'LV', 'PL', 'GPS',
  'PH', 'DH', 'HI', 'HT', 'STN', 'NE', 'XYZ', 'GEO',
]);

const parseFrameRecord = (
  parts: string[],
  line: number,
): GnssFrameMetadata => {
  const kind = (parts[1] ?? '').toUpperCase();
  if (kind !== 'ECEF' && kind !== 'ENU') {
    throw new Error(`Line ${line}: FRAME kind must be ECEF or ENU, got '${parts[1] ?? ''}'.`);
  }
  const referenceFrame = (parts[2] ?? '').trim();
  if (!referenceFrame || referenceFrame.length > MAX_TOKEN_LENGTH) {
    throw new Error(`Line ${line}: FRAME requires a reference-frame identifier.`);
  }
  const frame: GnssFrameMetadata = {
    vectorFrame: kind.toLowerCase() as GnssInputVectorFrame,
    referenceFrame,
  };
  const rest = parts.slice(3);
  for (let i = 0; i < rest.length; i += 2) {
    const key = (rest[i] ?? '').toUpperCase();
    const value = rest[i + 1];
    if (value === undefined) {
      throw new Error(`Line ${line}: FRAME keyword '${rest[i] ?? ''}' is missing its value.`);
    }
    if (key === 'EPOCH') frame.epoch = checkIdToken(value, 'epoch', line);
    else if (key === 'ELLIPSOID') frame.ellipsoid = checkIdToken(value, 'ellipsoid', line);
    else if (key === 'ORIGIN_LAT') frame.originLatDeg = parseGnssStrictNumber(value, 'ORIGIN_LAT', line);
    else if (key === 'ORIGIN_LON') frame.originLonDeg = parseGnssStrictNumber(value, 'ORIGIN_LON', line);
    else throw new Error(`Line ${line}: unknown FRAME keyword '${rest[i] ?? ''}'.`);
  }
  if (kind === 'ENU' && (frame.originLatDeg === undefined || frame.originLonDeg === undefined)) {
    throw new Error(`Line ${line}: FRAME ENU requires ORIGIN_LAT and ORIGIN_LON.`);
  }
  return frame;
};

/**
 * Parse WebNet-native GNSS baseline text into a canonical network.
 * Never throws on malformed input: problems are returned as diagnostics
 * and network is null when any error is present. No solve is performed.
 */
export const parseGnssBaselineText = (
  text: string,
  sourceFile?: string,
): GnssParseResult => {
  const diagnostics: GnssDiagnostic[] = [];
  const error = (
    code: string,
    message: string,
    line?: number,
    extra?: Partial<GnssDiagnostic>,
  ): void => {
    diagnostics.push({ severity: 'error', code, message, line, ...extra });
  };
  const warn = (code: string, message: string, line?: number): void => {
    diagnostics.push({ severity: 'warning', code, message, line });
  };

  let frame: GnssFrameMetadata | undefined;
  let units: GnssInputUnits | undefined;
  const stations = new Map<string, RawStation>();
  const baselines: RawBaseline[] = [];
  const seenCodes = new Set<string>();
  let pending: RawBaseline | null = null;

  const finishPending = (line: number): void => {
    if (!pending) return;
    error('GNSS_MISSING_COVARIANCE', `Baseline ${pending.from}->${pending.to} has no COV/SIGCORR block before line ${line}.`, pending.line, {
      baselineId: pending.baselineCode,
    });
    pending = null;
  };

  const lines = text.split('\n');
  lines.forEach((rawLine, index) => {
    const line = index + 1;
    const cleaned = rawLine.replace(/\r$/, '');
    if (cleaned.length > MAX_LINE_LENGTH) {
      error('GNSS_LINE_TOO_LONG', `Line ${line} exceeds ${MAX_LINE_LENGTH} characters.`, line);
      return;
    }
    const trimmed = cleaned.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const parts = trimmed.split(/\s+/);
    const code = (parts[0] ?? '').toUpperCase();

    try {
      if (code === 'FRAME') {
        if (frame) {
          throw new Error(`Line ${line}: duplicate FRAME declaration.`);
        }
        frame = parseFrameRecord(parts, line);
      } else if (code === 'UNITS') {
        if (units) {
          throw new Error(`Line ${line}: duplicate UNITS declaration.`);
        }
        const unit = (parts[1] ?? '').toUpperCase();
        if (unit !== 'M' && unit !== 'MM' && unit !== 'CM' || parts.length !== 2) {
          throw new Error(`Line ${line}: UNITS must be exactly one of M, MM, CM.`);
        }
        units = unit.toLowerCase() as GnssInputUnits;
      } else if (code === 'GX') {
        if (parts.length < 5 || parts.length > 6) {
          throw new Error(`Line ${line}: GX needs '<id> <X> <Y> <Z> [FIXED|FREE]'.`);
        }
        const id = checkIdToken(parts[1] ?? '', 'station id', line);
        if (stations.has(id)) {
          throw new Error(`Line ${line}: duplicate station '${id}'.`);
        }
        const flag = (parts[5] ?? 'FREE').toUpperCase();
        if (flag !== 'FIXED' && flag !== 'FREE') {
          throw new Error(`Line ${line}: GX control flag must be FIXED or FREE.`);
        }
        stations.set(id, {
          id,
          x: parseGnssStrictNumber(parts[2], 'GX X', line),
          y: parseGnssStrictNumber(parts[3], 'GX Y', line),
          z: parseGnssStrictNumber(parts[4], 'GX Z', line),
          fixed: flag === 'FIXED',
          line,
        });
      } else if (code === 'BL') {
        finishPending(line);
        if (parts.length < 6) {
          throw new Error(`Line ${line}: BL needs '<from> <to> <dx> <dy> <dz> [options]'.`);
        }
        const from = checkIdToken(parts[1] ?? '', 'FROM station', line);
        const to = checkIdToken(parts[2] ?? '', 'TO station', line);
        const raw: RawBaseline = {
          from,
          to,
          vector: {
            x: parseGnssStrictNumber(parts[3], 'BL dx', line),
            y: parseGnssStrictNumber(parts[4], 'BL dy', line),
            z: parseGnssStrictNumber(parts[5], 'BL dz', line),
          },
          covariance: { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 },
          stochasticForm: 'COV',
          line,
        };
        const rest = parts.slice(6);
        if (rest.length % 2 !== 0) {
          throw new Error(`Line ${line}: BL trailing options must be KEY value pairs.`);
        }
        for (let i = 0; i < rest.length; i += 2) {
          const key = (rest[i] ?? '').toUpperCase();
          const value = checkIdToken(rest[i + 1] ?? '', `BL ${rest[i] ?? ''}`, line);
          if (key === 'ID') {
            if (seenCodes.has(value)) {
              throw new Error(`Line ${line}: duplicate baseline ID '${value}'.`);
            }
            seenCodes.add(value);
            raw.baselineCode = value;
          } else if (key === 'SESSION') raw.sessionId = value;
          else if (key === 'SOLUTION' || key === 'SOL') raw.solutionId = value;
          else if (key === 'SOURCE') raw.sourceTag = value;
          else throw new Error(`Line ${line}: unknown BL option '${rest[i] ?? ''}'.`);
        }
        pending = raw;
        baselines.push(raw);
      } else if (code === 'COV' || code === 'SIGCORR') {
        if (!pending) {
          throw new Error(`Line ${line}: ${code} block has no preceding BL awaiting covariance.`);
        }
        if (pending.covariance.xx !== 0 || pending.covariance.yy !== 0 || pending.covariance.zz !== 0) {
          throw new Error(`Line ${line}: duplicate covariance block for baseline ${pending.from}->${pending.to}.`);
        }
        if (code === 'COV') {
          if (parts.length !== 7) {
            throw new Error(`Line ${line}: COV needs six values '<xx> <xy> <xz> <yy> <yz> <zz>'.`);
          }
        pending.covariance = {
            xx: parseGnssStrictNumber(parts[1], 'COV xx', line),
            xy: parseGnssStrictNumber(parts[2], 'COV xy', line),
            xz: parseGnssStrictNumber(parts[3], 'COV xz', line),
            yy: parseGnssStrictNumber(parts[4], 'COV yy', line),
            yz: parseGnssStrictNumber(parts[5], 'COV yz', line),
            zz: parseGnssStrictNumber(parts[6], 'COV zz', line),
          };
          pending.stochasticForm = 'COV';
        } else {
          if (parts.length !== 7) {
            throw new Error(`Line ${line}: SIGCORR needs six values '<sx> <sy> <sz> <rhoXY> <rhoXZ> <rhoYZ>'.`);
          }
          pending.covariance = sigCorrToCovariance(
            parseGnssStrictNumber(parts[1], 'SIGCORR sx', line),
            parseGnssStrictNumber(parts[2], 'SIGCORR sy', line),
            parseGnssStrictNumber(parts[3], 'SIGCORR sz', line),
            parseGnssStrictNumber(parts[4], 'SIGCORR rhoXY', line),
            parseGnssStrictNumber(parts[5], 'SIGCORR rhoXZ', line),
            parseGnssStrictNumber(parts[6], 'SIGCORR rhoYZ', line),
            line,
          );
          pending.stochasticForm = 'SIGCORR';
        }
        pending = null;
      } else if (LEGACY_CODES.has(code)) {
        finishPending(line);
        error('GNSS_MIXED_MODE', `Line ${line}: legacy record '${code}' cannot mix with GNSS baseline input; GNSS networks are GNSS-only.`, line);
      } else {
        finishPending(line);
        error('GNSS_UNKNOWN_RECORD', `Line ${line}: unknown record code '${parts[0] ?? ''}'.`, line);
      }
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      const mapped = mapParseError(message);
      // A failed BL leaves nothing pending; a failed COV keeps the BL
      // pending so the missing-covariance error fires deterministically.
      if (code === 'BL') {
        if (pending && pending.line === line) {
          pending = null;
          baselines.pop();
        }
      }
      error(mapped.code, mapped.message, line);
    }
  });
  finishPending(lines.length + 1);

  if (!frame) error('GNSS_MISSING_FRAME', 'Missing FRAME declaration; the reference frame must be explicit.');
  if (!units) error('GNSS_MISSING_UNITS', 'Missing UNITS declaration; vector/covariance units must be explicit.');
  if (baselines.length === 0) error('GNSS_NO_BASELINES', 'No BL baseline records found.');

  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasError || !frame || !units) {
    return { network: null, diagnostics };
  }

  // Endpoint / self-baseline structural checks with line numbers.
  baselines.forEach((raw) => {
    if (raw.from === raw.to) {
      error('GNSS_SELF_BASELINE', `Baseline ${raw.from}->${raw.to} is a self-baseline (from == to).`, raw.line, {
        baselineId: raw.baselineCode,
      });
    }
    if (!stations.has(raw.from)) {
      error('GNSS_UNKNOWN_STATION', `Baseline ${raw.from}->${raw.to} references unknown FROM station '${raw.from}'.`, raw.line, {
        baselineId: raw.baselineCode,
        stationId: raw.from,
      });
    }
    if (!stations.has(raw.to)) {
      error('GNSS_UNKNOWN_STATION', `Baseline ${raw.from}->${raw.to} references unknown TO station '${raw.to}'.`, raw.line, {
        baselineId: raw.baselineCode,
        stationId: raw.to,
      });
    }
    try {
      validateGnssBaselineCovariance(raw.covariance, `${raw.from}->${raw.to}`);
    } catch (failure) {
      error('GNSS_BAD_COVARIANCE', failure instanceof Error ? failure.message : String(failure), raw.line, {
        baselineId: raw.baselineCode,
      });
    }
  });

  // Repeated-endpoint warning (independent solutions, never deduplicated).
  const endpointCounts = new Map<string, number>();
  baselines.forEach((raw) => {
    const key = `${raw.from}->${raw.to}`;
    endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
  });
  endpointCounts.forEach((count, key) => {
    if (count > 1) warn('GNSS_REPEATED_BASELINE', `Endpoints ${key} appear in ${count} independent baseline solutions.`);
  });
  baselines.forEach((raw) => {
    if (raw.vector.x === 0 && raw.vector.y === 0 && raw.vector.z === 0 && raw.from !== raw.to) {
      warn('GNSS_ZERO_LENGTH', `Baseline ${raw.from}->${raw.to} has a zero observed vector; mathematically accepted, verify intent.`, raw.line);
    }
    if (!raw.sessionId && !raw.solutionId) {
      warn('GNSS_NO_SESSION_METADATA', `Baseline ${raw.from}->${raw.to} carries no SESSION/SOLUTION metadata.`, raw.line);
    }
  });

  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return { network: null, diagnostics };
  }

  try {
    const network = canonicalizeRawNetwork(stations, baselines, frame, units, sourceFile);
    return { network, diagnostics };
  } catch (failure) {
    error('GNSS_CANONICALIZE_FAILED', failure instanceof Error ? failure.message : String(failure));
    return { network: null, diagnostics };
  }
};

const mapParseError = (message: string): { code: string; message: string } => {
  if (/no preceding BL/i.test(message)) return { code: 'GNSS_ORPHAN_COVARIANCE', message };
  if (/duplicate covariance/i.test(message)) return { code: 'GNSS_DUPLICATE_COVARIANCE', message };
  if (/SIGCORR|sigmas must be|outside \[-1, 1\]/i.test(message)) return { code: 'GNSS_BAD_SIGCORR', message };
  if (/duplicate FRAME/i.test(message)) return { code: 'GNSS_DUPLICATE_FRAME', message };
  if (/duplicate UNITS/i.test(message)) return { code: 'GNSS_DUPLICATE_UNITS', message };
  if (/FRAME/.test(message)) return { code: 'GNSS_BAD_FRAME', message };
  if (/UNITS/.test(message)) return { code: 'GNSS_UNSUPPORTED_UNITS', message };
  if (/duplicate station/i.test(message)) return { code: 'GNSS_DUPLICATE_STATION', message };
  if (/GX/.test(message)) return { code: 'GNSS_MALFORMED_STATION', message };
  if (/duplicate baseline ID/i.test(message)) return { code: 'GNSS_DUPLICATE_ID', message };
  if (/BL/.test(message)) return { code: 'GNSS_MALFORMED_BASELINE', message };
  if (/COV/.test(message)) return { code: 'GNSS_MALFORMED_COVARIANCE', message };
  if (/strict decimal|not finite/i.test(message)) return { code: 'GNSS_MALFORMED_NUMERIC', message };
  if (/invalid (FROM|TO|epoch|ellipsoid|ID|SESSION|SOLUTION|SOURCE|station)/i.test(message)) {
    return { code: 'GNSS_MALFORMED_BASELINE', message };
  }
  return { code: 'GNSS_MALFORMED_RECORD', message };
};

/**
 * Canonicalize parsed records: unit normalization (once) + shared ENU->ECEF
 * rotation (vector AND covariance) + Phase 12B observation construction.
 * Throws deterministically on failure; parser wraps into diagnostics.
 */
export const canonicalizeRawNetwork = (
  stations: Map<string, RawStation>,
  baselines: RawBaseline[],
  frame: GnssFrameMetadata,
  units: GnssInputUnits,
  sourceFile?: string,
  stationUnitScale?: number,
): GnssBaselineNetworkInput => {
  const scale = UNIT_SCALE[units.toUpperCase()] ?? 1;
  // GX station coordinates are absolute ECEF positions in file units:
  // unit-scaled only, never rotated (rotation orients baseline vectors;
  // absolute positions would need a translation origin, not just lat/lon).
  const stationScale = stationUnitScale ?? scale;
  const rotation =
    frame.vectorFrame === 'enu'
      ? buildEnuRotation(frame.originLatDeg ?? 0, frame.originLonDeg ?? 0)
      : null;
  if (rotation) {
    verifyRotationOrthonormal(rotation, 'shared ENU origin');
  }
  const stationMap: StationMap = {};
  [...stations.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((station) => {
      stationMap[station.id] = {
        x: station.x * stationScale,
        y: station.y * stationScale,
        h: station.z * stationScale,
        fixed: station.fixed,
        fixedX: station.fixed,
        fixedY: station.fixed,
        fixedH: station.fixed,
      };
    });
  const provenance: GnssImportProvenance[] = [];
  const observations: GnssBaselineObservation[] = baselines.map((raw, index) => {
    const scaledVector = {
      x: raw.vector.x * scale,
      y: raw.vector.y * scale,
      z: raw.vector.z * scale,
    };
    const scaledCovariance: GnssBaselineCovariance = {
      xx: raw.covariance.xx * scale * scale,
      xy: raw.covariance.xy * scale * scale,
      xz: raw.covariance.xz * scale * scale,
      yy: raw.covariance.yy * scale * scale,
      yz: raw.covariance.yz * scale * scale,
      zz: raw.covariance.zz * scale * scale,
    };
    // Station coordinates are absolute positions: unit-scaled only, never
    // rotated (rotation applies to baseline vectors, not positions).
    const canonicalVector = rotation ? rotateEnuVectorToEcef(rotation, scaledVector) : scaledVector;
    const canonicalCovariance = rotation
      ? rotateEnuCovarianceToEcef(rotation, scaledCovariance)
      : scaledCovariance;
    validateGnssBaselineCovariance(canonicalCovariance, `${raw.from}->${raw.to}`);
    provenance.push({
      baselineId: index + 1,
      baselineCode: raw.baselineCode,
      line: raw.line,
      originalVector: { ...raw.vector },
      originalUnits: units,
      stochasticForm: raw.stochasticForm,
      inputFrame: frame.vectorFrame,
      rotationApplied: rotation !== null,
      canonicalVector: { ...canonicalVector },
      canonicalCovariance: { ...canonicalCovariance },
    });
    return {
      type: 'gnssBaseline' as const,
      id: index + 1,
      from: raw.from,
      to: raw.to,
      vector: canonicalVector,
      covariance: canonicalCovariance,
      frame: 'ecef' as const,
      referenceFrame: frame.referenceFrame,
      epoch: frame.epoch,
      ellipsoid: frame.ellipsoid,
      sessionId: raw.sessionId,
      solutionId: raw.solutionId,
      sourceLine: raw.line,
      sourceFile,
    };
  });
  return {
    stations: stationMap,
    baselines: observations,
    frame,
    inputUnits: units,
    provenance,
    sourceFile,
  };
};

/**
 * Structural + datum data-check over a canonical network. Runs BEFORE any
 * solve: syntax/frame/covariance/datum problems surface here without
 * requiring a full adjustment. Never throws for network problems.
 */
export const validateGnssBaselineNetwork = (
  network: GnssBaselineNetworkInput,
): GnssDiagnostic[] => {
  const diagnostics: GnssDiagnostic[] = [];
  try {
    runGnssBaselinePreflight({
      stations: network.stations,
      baselines: network.baselines,
      referenceFrame: network.frame.referenceFrame,
      epoch: network.frame.epoch,
      ellipsoid: network.frame.ellipsoid,
    });
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    diagnostics.push({
      severity: 'error',
      code: mapPreflightError(message),
      message,
    });
  }
  return diagnostics;
};

const mapPreflightError = (message: string): string => {
  if (/self-baseline/i.test(message)) return 'GNSS_SELF_BASELINE';
  if (/missing FROM/i.test(message) || /missing TO/i.test(message)) return 'GNSS_UNKNOWN_STATION';
  if (/Duplicate .* baseline id/i.test(message)) return 'GNSS_DUPLICATE_ID';
  if (/covariance|positive definite|variances/i.test(message)) return 'GNSS_BAD_COVARIANCE';
  if (/does not match session/i.test(message)) {
    if (/reference frame/i.test(message)) return 'GNSS_FRAME_MISMATCH';
    if (/epoch/i.test(message)) return 'GNSS_EPOCH_MISMATCH';
    return 'GNSS_ELLIPSOID_MISMATCH';
  }
  if (/disagree on declared frame/i.test(message)) return 'GNSS_FRAME_MISMATCH';
  if (/no fully fixed/i.test(message)) return 'GNSS_UNCONTROLLED_COMPONENT';
  if (/at least one baseline/i.test(message)) return 'GNSS_NO_BASELINES';
  return 'GNSS_DATUM_FAILURE';
};

/** Serialize a canonical network back to native text (tests/exports). */
export const serializeGnssBaselineNetwork = (network: GnssBaselineNetworkInput): string => {
  const lines: string[] = ['# WebNet static GNSS baseline network (experimental import stage)'];
  const frame = network.frame;
  const frameParts = [
    'FRAME',
    frame.vectorFrame.toUpperCase(),
    frame.referenceFrame,
  ];
  if (frame.epoch) frameParts.push('EPOCH', frame.epoch);
  if (frame.ellipsoid) frameParts.push('ELLIPSOID', frame.ellipsoid);
  if (frame.vectorFrame === 'enu') {
    frameParts.push('ORIGIN_LAT', String(frame.originLatDeg ?? 0), 'ORIGIN_LON', String(frame.originLonDeg ?? 0));
  }
  lines.push(frameParts.join(' '));
  lines.push(`UNITS ${network.inputUnits.toUpperCase()}`);
  const scale = UNIT_SCALE[network.inputUnits.toUpperCase()] ?? 1;
  Object.keys(network.stations)
    .sort()
    .forEach((id) => {
      const station = network.stations[id];
      if (!station) return;
      const fixed = station.fixedX && station.fixedY && station.fixedH;
      // ENU station coordinates are absolute positions stored unrotated in
      // metres; only the unit scale is inverted for serialization.
      lines.push(`GX ${id} ${station.x / scale} ${station.y / scale} ${station.h / scale} ${fixed ? 'FIXED' : 'FREE'}`);
    });
  network.provenance.forEach((trace) => {
    const raw = network.baselines[trace.baselineId - 1];
    if (!raw) return;
    const options: string[] = [];
    if (trace.baselineCode) options.push(`ID ${trace.baselineCode}`);
    if (raw.sessionId) options.push(`SESSION ${raw.sessionId}`);
    if (raw.solutionId) options.push(`SOLUTION ${raw.solutionId}`);
    // NOTE: serializer inverts ONLY the unit scale. ENU networks are
    // serialized in canonical ECEF; ENU text output is not supported
    // (import boundary is one-way for rotated frames).
    lines.push(
      `BL ${raw.from} ${raw.to} ${trace.originalVector.x} ${trace.originalVector.y} ${trace.originalVector.z}${options.length > 0 ? ` ${options.join(' ')}` : ''}`,
    );
    if (trace.stochasticForm === 'SIGCORR') {
      lines.push('# stochastic form preserved as COV on serialize; SIGCORR round-trips via canonical covariance');
    }
    const covariance = trace.canonicalCovariance;
    const back = {
      xx: covariance.xx / (scale * scale),
      xy: covariance.xy / (scale * scale),
      xz: covariance.xz / (scale * scale),
      yy: covariance.yy / (scale * scale),
      yz: covariance.yz / (scale * scale),
      zz: covariance.zz / (scale * scale),
    };
    lines.push(`COV ${back.xx} ${back.xy} ${back.xz} ${back.yy} ${back.yz} ${back.zz}`);
  });
  return `${lines.join('\n')}\n`;
};
