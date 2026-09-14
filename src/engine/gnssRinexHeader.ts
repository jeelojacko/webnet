/**
 * Phase 12J.4 — pure RINEX 2.10/2.11/3.x OBS header + epoch-scan parser.
 *
 * Produces RawGnssFileMetadata minus fileName/sha256 (filled by the caller
 * from the hashed bytes). No I/O, no WASM, no adjustment math.
 */

import type { RawGnssFileMetadata } from './gnssRawTypes';
import {
  MAX_LINE_LENGTH,
  RinexParseError,
  epochIso,
  fullYear,
  parseObs2Epoch,
  parseObs3Epoch,
  rinexLabel,
  strictFloat,
  strictInt,
} from './gnssRinexHeader.utils';

export { RinexParseError };

/** Epoch times kept for AUTO interval derivation (first N only). */
const KEPT_EPOCHS = 64;
/** Hard stop on body epoch records; file is rejected past this. */
const MAX_EPOCHS = 200000;

export interface ParsedRinexObs {
  readonly metadata: Omit<RawGnssFileMetadata, 'fileName' | 'sha256' | 'role'>;
  /** First KEPT_EPOCHS epoch times (ms) for interval derivation. */
  readonly epochTimesMs: number[];
  readonly firstEpochMs: number | null;
  readonly lastEpochMs: number | null;
  readonly epochCount: number;
}

export interface ParseRinexObsOptions {
  readonly maxEpochs?: number;
}

interface HeaderState {
  version: string | null;
  marker: string | null;
  approx: [number, number, number] | null;
  antennaModel: string;
  antH: number | null;
  antE: number | null;
  antN: number | null;
  receiver: string | null;
  firstIso: string | null;
  lastIso: string | null;
  interval: number | null;
  constellations: Set<string>;
  signals: Set<string>;
}

const emptyHeader = (): HeaderState => ({
  version: null,
  marker: null,
  approx: null,
  antennaModel: '',
  antH: null,
  antE: null,
  antN: null,
  receiver: null,
  firstIso: null,
  lastIso: null,
  interval: null,
  constellations: new Set<string>(),
  signals: new Set<string>(),
});

const parseHeaderEpoch = (line: string, context: string): string => {
  const y = strictInt(line.slice(0, 6), `${context} year`);
  const year = line.trim().length > 0 && y < 100 ? fullYear(y) : y;
  const { iso } = epochIso({
    year,
    month: strictInt(line.slice(6, 12), `${context} month`),
    day: strictInt(line.slice(12, 18), `${context} day`),
    hour: strictInt(line.slice(18, 24), `${context} hour`),
    minute: strictInt(line.slice(24, 30), `${context} minute`),
    second: strictFloat(line.slice(30, 43), `${context} second`),
  });
  return iso;
};

const addObsTypes = (
  line: string,
  out: Set<string>,
  count: number,
  width: number,
): void => {
  for (let i = 0; i < count; i += 1) {
    const code = line.slice(i * width, i * width + width).trim();
    if (code) out.add(code);
  }
};

function parseHeaderLine(
  line: string,
  label: string,
  st: HeaderState,
  continuation: { sys: string | null; remaining: number },
): void {
  switch (label) {
    case 'RINEX VERSION / TYPE': {
      const v = line.slice(0, 9).trim();
      st.version = v === '' ? null : v;
      break;
    }
    case 'MARKER NAME':
      st.marker = line.slice(0, 60).trim() || null;
      break;
    case 'APPROX POSITION XYZ':
      st.approx = [
        strictFloat(line.slice(0, 14), 'approx X'),
        strictFloat(line.slice(14, 28), 'approx Y'),
        strictFloat(line.slice(28, 42), 'approx Z'),
      ];
      break;
    case 'ANT # / TYPE':
      st.antennaModel = line.slice(20, 60).trim();
      break;
    case 'REC # / TYPE / VERS':
      st.receiver = line.slice(20, 40).trim() || null;
      break;
    case 'ANTENNA: DELTA H/E/N': {
      const h = strictFloat(line.slice(0, 14), 'antenna H');
      const e = strictFloat(line.slice(14, 28), 'antenna E');
      const n = strictFloat(line.slice(28, 42), 'antenna N');
      st.antH = h;
      st.antE = e;
      st.antN = n;
      break;
    }
    case '# / TYPES OF OBSERV': {
      const n = strictInt(line.slice(0, 6), 'obs type count');
      addObsTypes(line.slice(6, 60), st.signals, n, 6);
      break;
    }
    case 'SYS / # / OBS TYPES': {
      const sys = line.slice(0, 1).trim();
      if (sys) {
        st.constellations.add(sys);
        const n = strictInt(line.slice(3, 6), 'sys obs type count');
        addObsTypes(line.slice(7, 60), st.signals, Math.min(n, 13), 4);
        continuation.sys = sys;
        continuation.remaining = Math.max(0, n - 13);
      }
      break;
    }
    case 'SYS / PHASE SHIFT':
      break;
    case 'TIME OF FIRST OBS':
      st.firstIso = parseHeaderEpoch(line, 'first obs');
      break;
    case 'TIME OF LAST OBS':
      st.lastIso = parseHeaderEpoch(line, 'last obs');
      break;
    case 'INTERVAL':
      st.interval = strictFloat(line.slice(0, 10), 'interval');
      break;
    default:
      if (label === '' && continuation.remaining > 0 && continuation.sys) {
        addObsTypes(line.slice(7, 60), st.signals, Math.min(continuation.remaining, 13), 4);
        continuation.remaining = Math.max(0, continuation.remaining - 13);
      }
      break;
  }
}

/**
 * Parse RINEX OBS text. Throws RinexParseError on malformed content
 * (bad numerics, missing END OF HEADER, over-long lines, epoch cap).
 */
export function parseRinexObs(
  text: string,
  options: ParseRinexObsOptions = {},
): ParsedRinexObs {
  const maxEpochs = options.maxEpochs ?? MAX_EPOCHS;
  const lines = text.split('\n');
  const st = emptyHeader();
  const continuation = { sys: null as string | null, remaining: 0 };
  let endIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.length > MAX_LINE_LENGTH) {
      throw new RinexParseError(`Line ${i + 1} exceeds length cap.`);
    }
    const label = rinexLabel(line);
    if (label === 'END OF HEADER') {
      endIndex = i;
      break;
    }
    if (i === 0) {
      const v = line.slice(0, 9).trim();
      st.version = v === '' ? null : v;
    } else {
      parseHeaderLine(line, label, st, continuation);
    }
  }
  if (endIndex < 0) throw new RinexParseError('Missing END OF HEADER.');

  // RINEX 4 keeps the RINEX 3 `>` epoch records; 12J.10 proved this on
  // real RINEX 4.01 Belgian files (native + browser intake). Anything else
  // stays on the legacy RINEX 2 epoch path and fails closed on mismatch.
  const v = st.version ?? '';
  const isRinex3 = v.startsWith('3') || v.startsWith('4');
  const epochTimesMs: number[] = [];
  let firstMs: number | null = null;
  let lastMs: number | null = null;
  let count = 0;
  for (let i = endIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    if (isRinex3) {
      if (line.startsWith('>')) {
        const e = parseObs3Epoch(line);
        if (e) {
          if (firstMs === null) firstMs = e.ms;
          lastMs = e.ms;
          count += 1;
          if (epochTimesMs.length < KEPT_EPOCHS) epochTimesMs.push(e.ms);
          if (count > maxEpochs) {
            throw new RinexParseError('Too many epochs for the browser MVP.');
          }
        }
      } else {
        const id = line.slice(0, 3).trim();
        if (/^[A-Z][0-9]{2}$/.test(id)) st.constellations.add(id[0]!);
      }
    } else {
      const e = parseObs2Epoch(line);
      if (e) {
        if (firstMs === null) firstMs = e.ms;
        lastMs = e.ms;
        count += 1;
        if (epochTimesMs.length < KEPT_EPOCHS) epochTimesMs.push(e.ms);
        for (const s of e.sats) st.constellations.add(s[0]!);
        if (count > maxEpochs) {
          throw new RinexParseError('Too many epochs for the browser MVP.');
        }
      }
    }
  }

  const firstIso = firstMs !== null ? new Date(firstMs).toISOString() : st.firstIso;
  const lastIso = lastMs !== null ? new Date(lastMs).toISOString() : st.lastIso;
  const sorted = (s: Set<string>): string[] => [...s].sort();
  return {
    metadata: {
      rinexVersion: st.version,
      marker: st.marker,
      approxXyz: st.approx,
      antennaModel: st.antennaModel,
      antennaHeight: st.antH,
      antennaEast: st.antE,
      antennaNorth: st.antN,
      receiverModel: st.receiver,
      firstEpoch: firstIso,
      lastEpoch: lastIso,
      intervalSeconds: st.interval,
      constellations: sorted(st.constellations),
      signals: sorted(st.signals),
    },
    epochTimesMs,
    firstEpochMs: firstMs,
    lastEpochMs: lastMs,
    epochCount: count,
  };
}
