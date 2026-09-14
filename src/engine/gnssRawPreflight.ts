/**
 * Phase 12J.4 — pre-WASM acceptance gate for raw static-GNSS baselines.
 *
 * Validates BASE+ROVER+NAV(+optional SP3) metadata BEFORE any WASM work.
 * Pure and synchronous: file bytes are hashed by the caller (see
 * gnssRawHash.ts), which fills fileName/sha256 on the inputs.
 *
 * NAV-coverage approximation (documented): RINEX NAV files carry no
 * end-time header, so coverage is approximated by checking that at least
 * one GPS broadcast record has a time-of-ephemeris (Toe) within
 * ±navToeToleranceSeconds (default 4 h, the broadcast fit interval) of
 * the common observation span. This proves the NAV file is the right
 * vintage; exact per-satellite health/visibility is the processor's job.
 */

import type {
  RawGnssAntennaAssessment,
  RawGnssAntennaCalibrationStatus,
  RawGnssEndpointAntenna,
  RawGnssFileMetadata,
  RawGnssProcessingError,
} from './gnssRawTypes';
import { NO_CALIBRATION_WARNING } from './gnssRawTypes';
import {
  RinexParseError,
  parseRinexObs,
} from './gnssRinexHeader';
import { gpsWeekTow, obsBand, strictFloat, strictInt } from './gnssRinexHeader.utils';

export const DEFAULT_MAX_FILE_BYTES = 32 * 1024 * 1024;
export const DEFAULT_NAV_TOE_TOLERANCE_SECONDS = 4 * 3600;

export interface PreflightInputFile {
  readonly fileName: string;
  readonly sha256: string;
  readonly text: string;
}

export interface PreflightInputOptions {
  readonly elevationMaskDegrees: number;
  readonly intervalRequested: number | 'AUTO';
  readonly ephemerisRequested: 'BROADCAST' | 'PRECISE';
  readonly windowStart: string | null;
  readonly windowStop: string | null;
  readonly maxFileBytes?: number;
  readonly navToeToleranceSeconds?: number;
}

export interface PreflightInput {
  readonly base: PreflightInputFile;
  readonly rover: PreflightInputFile;
  readonly nav: PreflightInputFile[];
  readonly sp3: PreflightInputFile | null;
  readonly options: PreflightInputOptions;
}

export interface PreflightOk {
  readonly ok: true;
  readonly base: RawGnssFileMetadata;
  readonly rover: RawGnssFileMetadata;
  readonly commonStart: string;
  readonly commonStop: string;
  readonly resolvedInterval: number;
  readonly antennaAssessment: RawGnssAntennaAssessment;
  readonly warnings: string[];
}

export interface PreflightFail {
  readonly ok: false;
  readonly error: RawGnssProcessingError;
}

export type PreflightResult = PreflightOk | PreflightFail;

/**
 * Antenna classification without ANTEX: a named model can never be better
 * than CALIBRATION_UNAVAILABLE and a blank model is ANTENNA_UNKNOWN.
 * CALIBRATION_EXACT / CALIBRATION_EXPLICIT_MAPPING are unreachable in this
 * MVP (no ANTEX bundle is loaded); they exist for the future calibrated
 * path.
 */
export function classifyAntenna(model: string): RawGnssAntennaCalibrationStatus {
  return model.trim() === '' ? 'ANTENNA_UNKNOWN' : 'CALIBRATION_UNAVAILABLE';
}

const endpointAntenna = (
  marker: string,
  model: string,
  height: number | null,
  east: number | null,
  north: number | null,
): RawGnssEndpointAntenna => ({
  marker,
  model,
  calibration: classifyAntenna(model),
  height: height ?? 0,
  east: east ?? 0,
  north: north ?? 0,
});

export function assessAntennas(
  base: Pick<RawGnssFileMetadata, 'marker' | 'antennaModel' | 'antennaHeight' | 'antennaEast' | 'antennaNorth' | 'fileName'>,
  rover: Pick<RawGnssFileMetadata, 'marker' | 'antennaModel' | 'antennaHeight' | 'antennaEast' | 'antennaNorth' | 'fileName'>,
): RawGnssAntennaAssessment {
  const b = endpointAntenna(
    base.marker ?? base.fileName,
    base.antennaModel,
    base.antennaHeight,
    base.antennaEast,
    base.antennaNorth,
  );
  const r = endpointAntenna(
    rover.marker ?? rover.fileName,
    rover.antennaModel,
    rover.antennaHeight,
    rover.antennaEast,
    rover.antennaNorth,
  );
  const score = (c: RawGnssAntennaCalibrationStatus): number =>
    c === 'CALIBRATION_EXACT' || c === 'CALIBRATION_EXPLICIT_MAPPING' ? 1 : 0;
  const total = score(b.calibration) + score(r.calibration);
  return {
    base: b,
    rover: r,
    overall: total === 2 ? 'FULL' : total === 1 ? 'PARTIAL' : 'NONE',
    warning: total === 2 ? null : NO_CALIBRATION_WARNING,
  };
}

const fail = (
  code: PreflightFail['error']['code'],
  message: string,
  detail?: string,
): PreflightFail => ({ ok: false, error: { code, message, detail } });

// RINEX 4 observation files keep RINEX 3 `>` epoch records (12J.10: proven
// on real RINEX 4.01 Belgian intake, native + production parse).
const SUPPORTED_VERSIONS = [/^2\.10/, /^2\.11/, /^3\./, /^4\./];

interface NavToe {
  readonly toeMsList: number[];
}

/** Collect GPS time-of-ephemeris values from a RINEX 2 or 3 NAV body. */
function collectNavToes(text: string): NavToe {
  const lines = text.split('\n');
  const endIndex = lines.findIndex((l) => l.slice(60).trim() === 'END OF HEADER');
  if (endIndex < 0) throw new RinexParseError('NAV file missing END OF HEADER.');
  const body = lines.slice(endIndex + 1).filter((l) => l.trim() !== '');
  if (body.length === 0) throw new RinexParseError('NAV file has an empty body.');
  const toes: number[] = [];
  const gpsEpochMs = Date.UTC(1980, 0, 6, 0, 0, 0);
  let i = 0;
  while (i < body.length) {
    const line = body[i] ?? '';
    const isRinex3Gps = /^G\d{2}\s/.test(line);
    const prn2 = strictIntSafe(line.slice(0, 2));
    if (!isRinex3Gps && prn2 === null) {
      i += 1;
      continue;
    }
    if (!isRinex3Gps && (prn2 === null || prn2 < 1 || prn2 > 32)) {
      i += 1; // Non-GPS RINEX 2 record (e.g. SBAS); skip its 8 lines.
      i += 7;
      continue;
    }
    if (body.length - i < 8) throw new RinexParseError('Truncated NAV record.');
    if (isRinex3Gps) {
      const f = line.trim().split(/\s+/);
      if (f.length < 7) throw new RinexParseError('Malformed RINEX 3 NAV record.');
      const tocMs = Date.UTC(
        strictInt(f[1]!, 'nav year'),
        strictInt(f[2]!, 'nav month') - 1,
        strictInt(f[3]!, 'nav day'),
        strictInt(f[4]!, 'nav hour'),
        strictInt(f[5]!, 'nav minute'),
        Math.floor(strictFloat(f[6]!, 'nav second')),
      );
      const { week } = gpsWeekTow(tocMs);
      const toeLine = (body[i + 3] ?? '').trim().split(/\s+/);
      const toe = strictFloat(toeLine[0] ?? '', 'nav Toe');
      toes.push(gpsEpochMs + (week * 604800 + toe) * 1000);
    } else {
      // RINEX 2 GPS record (8 lines): Toe opens the 4th line;
      // week number is the 3rd value of the 6th line.
      const toeLine = (body[i + 3] ?? '').trim().split(/\s+/);
      const toe = strictFloat(toeLine[0] ?? '', 'nav Toe');
      const weekLine = (body[i + 5] ?? '').trim().split(/\s+/);
      const week = strictFloat(weekLine[2] ?? '', 'nav week');
      if (!Number.isInteger(week) || week < 0 || week > 9999) {
        throw new RinexParseError('Malformed NAV week number.');
      }
      toes.push(gpsEpochMs + (week * 604800 + toe) * 1000);
    }
    i += 8;
  }
  return { toeMsList: toes };
}

const strictIntSafe = (token: string): number | null => {
  const t = token.trim();
  if (!/^[+-]?\d+$/.test(t)) return null;
  return Number(t);
};

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** Median of consecutive epoch deltas; null when fewer than 2 epochs. */
export function deriveInterval(timesMs: number[]): number | null {
  if (timesMs.length < 2) return null;
  const deltas: number[] = [];
  for (let i = 1; i < timesMs.length; i += 1) {
    const d = (timesMs[i]! - timesMs[i - 1]!) / 1000;
    if (d > 0 && Number.isFinite(d)) deltas.push(d);
  }
  return median(deltas);
}

export function preflightRawGnss(input: PreflightInput): PreflightResult {
  const maxBytes = input.options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const allFiles: PreflightInputFile[] = [
    input.base,
    input.rover,
    ...input.nav,
    ...(input.sp3 ? [input.sp3] : []),
  ];
  for (const f of allFiles) {
    if (f.text.length > maxBytes) {
      return fail(
        'MEMORY_OR_SIZE_LIMIT',
        `File ${f.fileName} exceeds the ${maxBytes}-byte size cap.`,
      );
    }
  }

  let baseParsed;
  let roverParsed;
  try {
    baseParsed = parseRinexObs(input.base.text);
    roverParsed = parseRinexObs(input.rover.text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return fail('INVALID_RINEX', 'An observation file is malformed.', detail);
  }

  const checked: Array<{
    tag: string;
    parsed: typeof baseParsed;
  }> = [
    { tag: 'base', parsed: baseParsed },
    { tag: 'rover', parsed: roverParsed },
  ];
  for (const { tag, parsed } of checked) {
    const v = parsed.metadata.rinexVersion;
    if (v === null) {
      return fail('INVALID_RINEX', `The ${tag} file has no RINEX version.`);
    }
    if (!SUPPORTED_VERSIONS.some((re) => re.test(v))) {
      return fail(
        'UNSUPPORTED_RINEX',
        `RINEX version ${v} in the ${tag} file is not supported (need 2.10, 2.11, 3.x, or 4.x).`,
      );
    }
    if (!parsed.metadata.constellations.includes('G')) {
      return fail(
        'NO_GPS_OBSERVATIONS',
        `The ${tag} file contains no GPS observations.`,
      );
    }
    const bands = new Set<string>();
    for (const code of parsed.metadata.signals) {
      const b = obsBand(code);
      if (b) bands.add(b);
    }
    if (!bands.has('1') || !bands.has('2')) {
      return fail(
        'NO_DUAL_FREQUENCY',
        `The ${tag} file lacks usable L1+L2 observations.`,
        `bands present: ${[...bands].sort().join(',') || 'none'}`,
      );
    }
    if (parsed.metadata.approxXyz === null) {
      return fail(
        'INVALID_RINEX',
        `The ${tag} file has no usable approximate position.`,
      );
    }
    if (parsed.epochCount === 0) {
      return fail('INVALID_RINEX', `The ${tag} file contains no epochs.`);
    }
  }

  let commonStartMs = Math.max(baseParsed.firstEpochMs!, roverParsed.firstEpochMs!);
  let commonStopMs = Math.min(baseParsed.lastEpochMs!, roverParsed.lastEpochMs!);
  if (input.options.windowStart) {
    const t = Date.parse(input.options.windowStart);
    if (!Number.isFinite(t)) return fail('INVALID_RINEX', 'windowStart is not a valid time.');
    commonStartMs = Math.max(commonStartMs, t);
  }
  if (input.options.windowStop) {
    const t = Date.parse(input.options.windowStop);
    if (!Number.isFinite(t)) return fail('INVALID_RINEX', 'windowStop is not a valid time.');
    commonStopMs = Math.min(commonStopMs, t);
  }
  if (commonStartMs > commonStopMs) {
    return fail(
      'NO_COMMON_TIME',
      'Base and rover files share no common observation time.',
      `base ${baseParsed.metadata.firstEpoch}..${baseParsed.metadata.lastEpoch}, ` +
        `rover ${roverParsed.metadata.firstEpoch}..${roverParsed.metadata.lastEpoch}`,
    );
  }

  if (input.nav.length === 0) {
    return fail('MISSING_NAV', 'No broadcast navigation file was provided.');
  }
  const tolerance = input.options.navToeToleranceSeconds ?? DEFAULT_NAV_TOE_TOLERANCE_SECONDS;
  try {
    let covered = false;
    let navRecords = 0;
    for (const n of input.nav) {
      if (n.text.trim() === '') continue;
      const { toeMsList } = collectNavToes(n.text);
      navRecords += toeMsList.length;
      for (const toe of toeMsList) {
        if (toe >= commonStartMs - tolerance * 1000 && toe <= commonStopMs + tolerance * 1000) {
          covered = true;
        }
      }
    }
    if (navRecords === 0) {
      return fail('NAV_COVERAGE_MISSING', 'The NAV files contain no GPS ephemeris records.');
    }
    if (!covered) {
      return fail(
        'NAV_COVERAGE_MISSING',
        'The NAV files do not cover the common observation span.',
      );
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (e instanceof RinexParseError) {
      return fail('NAV_COVERAGE_MISSING', 'A NAV file is malformed or empty.', detail);
    }
    return fail('NAV_COVERAGE_MISSING', 'A NAV file could not be read.', detail);
  }

  if (input.options.ephemerisRequested === 'PRECISE') {
    if (!input.sp3) {
      return fail('PRECISE_PRODUCT_MISSING', 'Precise ephemeris was requested but no SP3 file was provided.');
    }
    if (input.sp3.text.trim() === '') {
      return fail('PRECISE_PRODUCT_INVALID', 'The SP3 file is empty.');
    }
  }

  let resolvedInterval: number;
  const warnings: string[] = [];
  if (input.options.intervalRequested === 'AUTO') {
    const source =
      roverParsed.epochTimesMs.length >= 2
        ? roverParsed.epochTimesMs
        : baseParsed.epochTimesMs;
    const derived = deriveInterval(source);
    if (derived === null || !Number.isFinite(derived) || derived <= 0) {
      return fail('INVALID_RINEX', 'Too few epochs to derive the observation interval.');
    }
    resolvedInterval = derived;
    for (const { tag, parsed } of checked) {
      const declared = parsed.metadata.intervalSeconds;
      if (
        declared !== null &&
        Number.isFinite(declared) &&
        declared > 0 &&
        Math.abs(declared - derived) / derived > 0.05
      ) {
        warnings.push(
          `The ${tag} header declares INTERVAL ${declared}s but observed epochs show ${derived}s.`,
        );
      }
    }
  } else {
    const r = input.options.intervalRequested;
    if (!Number.isFinite(r) || r <= 0) {
      return fail('INVALID_RINEX', 'The requested interval is not a positive number.');
    }
    resolvedInterval = r;
  }

  if (!Number.isFinite(input.options.elevationMaskDegrees)) {
    return fail('INVALID_RINEX', 'The elevation mask is not a number.');
  }

  const base: RawGnssFileMetadata = {
    ...baseParsed.metadata,
    role: 'BASE',
    fileName: input.base.fileName,
    sha256: input.base.sha256,
  };
  const rover: RawGnssFileMetadata = {
    ...roverParsed.metadata,
    role: 'ROVER',
    fileName: input.rover.fileName,
    sha256: input.rover.sha256,
  };
  return {
    ok: true,
    base,
    rover,
    commonStart: new Date(commonStartMs).toISOString(),
    commonStop: new Date(commonStopMs).toISOString(),
    resolvedInterval,
    antennaAssessment: assessAntennas(base, rover),
    warnings,
  };
}
