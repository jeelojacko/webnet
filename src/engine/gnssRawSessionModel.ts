/**
 * Phase 12J.9 Track A — raw GNSS session model (REVIEW_ONLY, no math).
 *
 * Deterministic multi-occupation intake for raw sessions: identity,
 * overlap, common window, duplicates, interval plan, antenna table.
 * No UI, no worker, no adjustment math. Filenames are provenance-only
 * and never enter identity hashes. Stochastic handling is frozen:
 * every output carries RTKLIB_FORMAL / UNCALIBRATED / FORMAL_UNCALIBRATED
 * with no rescaling. There is NO antenna substitution.
 */

import { classifyAntenna } from './gnssRawPreflight';
import type { RawGnssFileMetadata } from './gnssRawTypes';

/** Intake bounds: at least a pair, at most a reviewable session. */
export const SESSION_MIN_OCCUPATIONS = 2;
export const SESSION_MAX_OCCUPATIONS = 20;

/** Stochastic freeze carried by every produced record (no rescaling). */
export const SESSION_STOCHASTIC_FREEZE = {
  covarianceModel: 'RTKLIB_FORMAL',
  calibration: 'UNCALIBRATED',
  status: 'FORMAL_UNCALIBRATED',
} as const;

/** One occupation's file facts plus the epoch count the header scan saw. */
export interface RawOccupationMeta {
  readonly meta: RawGnssFileMetadata;
  readonly epochCount: number;
}

/** Multi-obs intake: 2-20 occupations + NAV + optional SP3/ANTEX label. */
export interface RawSessionIntake {
  readonly occupations: readonly RawOccupationMeta[];
  readonly navSha256: readonly string[];
  readonly sp3Sha256: string | null;
  readonly antexLabel: string | null;
}

/**
 * Deterministic occupation identity. The id hashes marker + timespan +
 * receiver/antenna metadata + input SHA-256 only; fileName is carried
 * separately as provenance and never enters the hash, so renames and
 * upload order cannot change identity.
 */
export interface OccupationIdentity {
  readonly occupationId: string;
  readonly marker: string;
  readonly firstEpoch: string | null;
  readonly lastEpoch: string | null;
  readonly inputSha256: string;
  /** Provenance only — excluded from occupationId. */
  readonly fileName: string;
}

const fnv1aHex = (text: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, '0')}`;
};

export const occupationIdentity = (input: RawOccupationMeta): OccupationIdentity => {
  const m = input.meta;
  const marker = m.marker ?? '';
  const id = fnv1aHex(
    [marker, m.firstEpoch ?? '', m.lastEpoch ?? '', m.receiverModel ?? '',
      m.antennaModel ?? '', m.sha256].join('|'),
  );
  return {
    occupationId: id,
    marker,
    firstEpoch: m.firstEpoch,
    lastEpoch: m.lastEpoch,
    inputSha256: m.sha256,
    fileName: m.fileName,
  };
};

/** Session id from sorted occupation ids — invariant under upload order. */
export const sessionIdentity = (occupations: readonly RawOccupationMeta[]): string =>
  fnv1aHex(occupations.map(occupationIdentity).map((o) => o.occupationId).sort().join('|'));

export interface IntakeSizeError {
  readonly ok: false;
  readonly code: 'SESSION_SIZE';
  readonly message: string;
}

export const validateIntakeSize = (
  occupations: readonly RawOccupationMeta[],
): { readonly ok: true } | IntakeSizeError => {
  if (occupations.length < SESSION_MIN_OCCUPATIONS || occupations.length > SESSION_MAX_OCCUPATIONS) {
    return {
      ok: false,
      code: 'SESSION_SIZE',
      message: `Session needs ${SESSION_MIN_OCCUPATIONS}-${SESSION_MAX_OCCUPATIONS} occupations, got ${occupations.length}.`,
    };
  }
  return { ok: true };
};

export interface OverlapCell {
  readonly start: string | null;
  readonly stop: string | null;
  readonly overlaps: boolean;
}

/**
 * Pairwise overlap matrix from first/last epoch headers only.
 * Cell [i][j] is the intersection of occupations i and j; the diagonal
 * is the occupation's own span. Null bounds mean a missing header epoch.
 */
export const overlapMatrix = (
  occupations: readonly RawOccupationMeta[],
): OverlapCell[][] =>
  occupations.map((a) =>
    occupations.map((b) => {
      const aStart = a.meta.firstEpoch == null ? null : Date.parse(a.meta.firstEpoch);
      const aStop = a.meta.lastEpoch == null ? null : Date.parse(a.meta.lastEpoch);
      const bStart = b.meta.firstEpoch == null ? null : Date.parse(b.meta.firstEpoch);
      const bStop = b.meta.lastEpoch == null ? null : Date.parse(b.meta.lastEpoch);
      if (aStart == null || aStop == null || bStart == null || bStart == null || bStop == null
        || !Number.isFinite(aStart) || !Number.isFinite(aStop)
        || !Number.isFinite(bStart) || !Number.isFinite(bStop)) {
        return { start: null, stop: null, overlaps: false };
      }
      const start = Math.max(aStart, bStart);
      const stop = Math.min(aStop, bStop);
      if (start > stop) return { start: null, stop: null, overlaps: false };
      return {
        start: new Date(start).toISOString(),
        stop: new Date(stop).toISOString(),
        overlaps: true,
      };
    }),
  );

export type SessionWindowOption =
  | { readonly mode: 'AUTO' }
  | { readonly mode: 'EXPLICIT'; readonly start: string; readonly stop: string };

export type SessionWindowResult =
  | { readonly ok: true; readonly start: string; readonly stop: string }
  | { readonly ok: false; readonly code: 'NO_COMMON_TIME'; readonly message: string };

/**
 * Session window: AUTO intersects every occupation span (zero overlap is a
 * fail-closed NO_COMMON_TIME, mirroring preflight); EXPLICIT clamps to the
 * caller window and still fails closed when nothing overlaps it.
 */
export const resolveSessionWindow = (
  occupations: readonly RawOccupationMeta[],
  option: SessionWindowOption,
): SessionWindowResult => {
  const starts = occupations.map((o) => (o.meta.firstEpoch == null ? NaN : Date.parse(o.meta.firstEpoch)));
  const stops = occupations.map((o) => (o.meta.lastEpoch == null ? NaN : Date.parse(o.meta.lastEpoch)));
  if (starts.some((t) => !Number.isFinite(t)) || stops.some((t) => !Number.isFinite(t))) {
    return { ok: false, code: 'NO_COMMON_TIME', message: 'An occupation is missing its timespan.' };
  }
  let start = Math.max(...starts);
  let stop = Math.min(...stops);
  if (option.mode === 'EXPLICIT') {
    const es = Date.parse(option.start);
    const ee = Date.parse(option.stop);
    if (!Number.isFinite(es) || !Number.isFinite(ee) || es > ee) {
      return { ok: false, code: 'NO_COMMON_TIME', message: 'Explicit session window is not a valid span.' };
    }
    start = Math.max(start, es);
    stop = Math.min(stop, ee);
  }
  if (start > stop) {
    return { ok: false, code: 'NO_COMMON_TIME', message: 'Occupations share no common session time.' };
  }
  return { ok: true, start: new Date(start).toISOString(), stop: new Date(stop).toISOString() };
};

/** Per-edge default window: the pairwise intersection of the two ends. */
export const edgeWindow = (
  a: RawOccupationMeta,
  b: RawOccupationMeta,
): SessionWindowResult => resolveSessionWindow([a, b], { mode: 'AUTO' });

/**
 * Duplicate scan (warnings only, never blocks). Three classes:
 * exact content duplicate (same SHA-256), same marker+timespan uploaded
 * twice, and a decimated-alternate heuristic (same marker, overlapping
 * span, epoch-count ratio near 2 with matching interval ratio).
 */
export const detectDuplicates = (
  occupations: readonly RawOccupationMeta[],
): string[] => {
  const warnings: string[] = [];
  const bySha = new Map<string, string[]>();
  occupations.forEach((o) => {
    const list = bySha.get(o.meta.sha256) ?? [];
    list.push(o.meta.fileName);
    bySha.set(o.meta.sha256, list);
  });
  for (const [sha, names] of bySha) {
    if (names.length > 1) {
      warnings.push(`duplicate input content ${sha.slice(0, 12)} in ${names.sort().join(', ')}`);
    }
  }
  for (let i = 0; i < occupations.length; i += 1) {
    for (let j = i + 1; j < occupations.length; j += 1) {
      const a = occupations[i]!;
      const b = occupations[j]!;
      const markerA = a.meta.marker ?? '';
      if (markerA === '' || markerA !== b.meta.marker) continue;
      if (a.meta.firstEpoch === b.meta.firstEpoch && a.meta.lastEpoch === b.meta.lastEpoch
        && a.meta.sha256 !== b.meta.sha256) {
        warnings.push(`duplicate occupation ${markerA} ${a.meta.firstEpoch ?? '?'}..${a.meta.lastEpoch ?? '?'}`);
      }
      const ratio = a.epochCount > 0 && b.epochCount > 0
        ? Math.max(a.epochCount, b.epochCount) / Math.min(a.epochCount, b.epochCount)
        : 0;
      const ia = a.meta.intervalSeconds;
      const ib = b.meta.intervalSeconds;
      const intervalRatio = ia != null && ib != null && ia > 0 && ib > 0
        ? Math.max(ia, ib) / Math.min(ia, ib)
        : 0;
      if (ratio >= 1.8 && ratio <= 2.2 && intervalRatio >= 1.8 && intervalRatio <= 2.2) {
        warnings.push(`possible decimated alternate for ${markerA}: epoch counts ${a.epochCount}/${b.epochCount}`);
      }
    }
  }
  return warnings.sort();
};

export interface SessionIntervalPlan {
  readonly requested: number | 'AUTO';
  readonly resolved: number | null;
  readonly perOccupation: ReadonlyArray<{ readonly marker: string; readonly interval: number | null }>;
  readonly warnings: string[];
  readonly stochastic: typeof SESSION_STOCHASTIC_FREEZE;
}

/**
 * Interval plan: an explicit request wins; AUTO takes the median of the
 * declared header intervals (null when no occupation declares one).
 * Mixed header intervals raise a warning but never rescale anything.
 */
export const planSessionInterval = (
  occupations: readonly RawOccupationMeta[],
  requested: number | 'AUTO',
): SessionIntervalPlan => {
  const perOccupation = occupations.map((o) => ({
    marker: o.meta.marker ?? o.meta.fileName,
    interval: o.meta.intervalSeconds,
  }));
  const warnings: string[] = [];
  const declared = perOccupation
    .map((p) => p.interval)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  const distinct = [...new Set(declared)];
  if (distinct.length > 1) {
    warnings.push(`mixed observation intervals: ${distinct.join(', ')}s`);
  }
  if (typeof requested === 'number') {
    return {
      requested,
      resolved: requested > 0 && Number.isFinite(requested) ? requested : null,
      perOccupation,
      warnings,
      stochastic: SESSION_STOCHASTIC_FREEZE,
    };
  }
  if (declared.length === 0) {
    return {
      requested,
      resolved: null,
      perOccupation,
      warnings: [...warnings, 'AUTO interval has no declared header interval to resolve from'],
      stochastic: SESSION_STOCHASTIC_FREEZE,
    };
  }
  const mid = Math.floor(declared.length / 2);
  const resolved = declared.length % 2 === 1
    ? declared[mid]!
    : (declared[mid - 1]! + declared[mid]!) / 2;
  return { requested, resolved, perOccupation, warnings, stochastic: SESSION_STOCHASTIC_FREEZE };
};

export type AntennaStationStatus = 'EXACT' | 'EXPLICIT_MAPPING' | 'UNAVAILABLE' | 'UNKNOWN';

export interface AntennaStationRow {
  readonly marker: string;
  readonly model: string;
  readonly status: AntennaStationStatus;
  readonly stochastic: typeof SESSION_STOCHASTIC_FREEZE;
}

export interface SessionAntennaTable {
  readonly stations: readonly AntennaStationRow[];
  /** COMPLETE when every station is calibrated, PARTIAL when some are, NONE otherwise. */
  readonly overall: 'COMPLETE' | 'PARTIAL' | 'NONE';
  /** Per affected baseline; never substituted, only flagged. */
  readonly baselineNotes: string[];
  readonly stochastic: typeof SESSION_STOCHASTIC_FREEZE;
}

const toStationStatus = (model: string): AntennaStationStatus => {
  const c = classifyAntenna(model);
  if (c === 'CALIBRATION_EXACT') return 'EXACT';
  if (c === 'CALIBRATION_EXPLICIT_MAPPING') return 'EXPLICIT_MAPPING';
  if (c === 'ANTENNA_UNKNOWN') return 'UNKNOWN';
  return 'UNAVAILABLE';
};

/**
 * Antenna resolution table. Reuses classifyAntenna per station (no ANTEX
 * bundle in this MVP, so EXACT/MAPPING are unreachable and nothing is
 * ever substituted). Baselines touching an uncalibrated station get an
 * ANTENNA CALIBRATION INCOMPLETE note.
 */
export const resolveSessionAntennas = (
  occupations: readonly RawOccupationMeta[],
  edges: ReadonlyArray<{ readonly from: string; readonly to: string }>,
): SessionAntennaTable => {
  const seen = new Map<string, AntennaStationRow>();
  for (const o of occupations) {
    const marker = o.meta.marker ?? o.meta.fileName;
    if (!seen.has(marker)) {
      seen.set(marker, {
        marker,
        model: o.meta.antennaModel,
        status: toStationStatus(o.meta.antennaModel),
        stochastic: SESSION_STOCHASTIC_FREEZE,
      });
    }
  }
  const stations = [...seen.values()].sort((a, b) => (a.marker < b.marker ? -1 : 1));
  const calibrated = stations.filter((s) => s.status === 'EXACT' || s.status === 'EXPLICIT_MAPPING');
  const overall = calibrated.length === stations.length && stations.length > 0
    ? 'COMPLETE'
    : calibrated.length > 0 ? 'PARTIAL' : 'NONE';
  const bad = new Set(
    stations.filter((s) => s.status !== 'EXACT' && s.status !== 'EXPLICIT_MAPPING').map((s) => s.marker),
  );
  const baselineNotes = edges
    .filter((e) => bad.has(e.from) || bad.has(e.to))
    .map((e) => `ANTENNA CALIBRATION INCOMPLETE: ${e.from}->${e.to}`)
    .sort();
  return { stations, overall, baselineNotes, stochastic: SESSION_STOCHASTIC_FREEZE };
};
