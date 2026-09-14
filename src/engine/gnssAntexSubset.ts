/**
 * Phase 12J.9 Track B — production ANTEX subset utility (no stochastic changes).
 *
 * Deterministic port of scripts/gnss/gnss12j7AntexSubset.mjs. Keeps the file
 * header, receiver blocks whose TYPE/SERIAL matches a required identity
 * EXACTLY, and satellite blocks of the requested systems. No fuzzy
 * substitution: a required "TYPE RADOME" serial absent from the source fails
 * closed instead of silently falling back to a nearby radome variant.
 *
 * Byte-determinism: lines are never reordered or reformatted; output is
 * header + kept blocks (source order) + footer joined with LF, exactly like
 * the script. The processing date (`validAt`) is recorded in provenance for
 * traceability only — selection is identity-exact, never date-filtered, so a
 * stale validity window can never silently drop an entry the processor needs
 * (RTKLIB tolerates extra satellite blocks; missing ones lose PCV silently).
 *
 * Node+worker portable: no node builtins; hashing goes through gnssRawHash.
 */

/** Subset cap: comfortably below the 32 MiB per-file staging cap (never raised). */
export const GNSS_ANTEX_SUBSET_MAX_BYTES = 4 * 1024 * 1024;

export interface GnssAntexSubsetRequest {
  /** Full ANTEX file text (UTF-8). */
  readonly sourceText: string;
  /** Exact "TYPE RADOME" serials, e.g. "TRM59800.00 NONE". Whitespace-normalized. */
  readonly requiredReceiverSerials: readonly string[];
  /** Satellite systems to keep, by PRN prefix letter (default GPS only). */
  readonly satelliteSystems?: readonly string[];
  /** Processing epoch (ISO); recorded in provenance, never filters. */
  readonly validAt?: string | null;
  /** Override for tests; defaults to GNSS_ANTEX_SUBSET_MAX_BYTES. */
  readonly maxBytes?: number;
}

export interface GnssAntexSubsetResult {
  readonly subsetText: string;
  readonly subsetBytes: Uint8Array;
  readonly sourceSha256: string;
  readonly subsetSha256: string;
  readonly sourceSizeBytes: number;
  readonly subsetSizeBytes: number;
  readonly receiverSerials: string[];
  readonly satelliteBlockCount: number;
  readonly satelliteSystems: string[];
  readonly validAt: string | null;
}

/** Session-scope reuse cache: immutable results keyed by subset SHA256. */
export type GnssAntexSubsetCache = Map<string, GnssAntexSubsetResult>;

export const createAntexSubsetCache = (): GnssAntexSubsetCache => new Map();

const SAT_PRN = /^[GREJCIS]\d{2}$/;

const tagOf = (line: string): string => (line.length > 60 ? line.slice(60).trim() : '');

const serialOf = (block: string[]): string => {
  for (const line of block) {
    if (tagOf(line).startsWith('TYPE / SERIAL')) return line.slice(0, 60).trim();
  }
  return '';
};

const normalizeSerial = (serial: string): string => serial.trim().split(/\s+/).join(' ');

const isSatelliteSerial = (serial: string): boolean => {
  const toks = normalizeSerial(serial).split(' ');
  return toks.length > 1 && toks[0] === 'BLOCK' && toks.slice(1).some((t) => SAT_PRN.test(t));
};

const satSystemsOf = (serial: string): string[] => {
  const systems = new Set<string>();
  for (const tok of normalizeSerial(serial).split(' ').slice(1)) {
    if (SAT_PRN.test(tok)) systems.add(tok[0]!);
  }
  return [...systems];
};

interface SplitAntex {
  readonly header: string[];
  readonly blocks: string[][];
  readonly footer: string[];
}

const splitAntex = (sourceText: string): SplitAntex => {
  const lines = sourceText.split('\n');
  const header: string[] = [];
  const blocks: string[][] = [];
  let cur: string[] | null = null;
  for (const line of lines) {
    const t = tagOf(line);
    if (t === 'START OF ANTENNA') cur = [line];
    else if (t === 'END OF ANTENNA') {
      cur!.push(line);
      blocks.push(cur!);
      cur = null;
    } else if (cur) cur.push(line);
    else if (blocks.length === 0) header.push(line);
  }
  const lastEnd = lines.findLastIndex((line) => tagOf(line) === 'END OF ANTENNA');
  return { header, blocks, footer: lastEnd >= 0 ? lines.slice(lastEnd + 1) : [] };
};

/**
 * Pure extraction (no hashing): returns subset text plus what was kept.
 * Throws when a required receiver serial is absent (no fuzzy fallback) or
 * the subset exceeds the byte bound.
 */
export const extractAntexSubsetText = (
  request: GnssAntexSubsetRequest,
): {
  readonly subsetText: string;
  readonly receiverSerials: string[];
  readonly satelliteBlockCount: number;
} => {
  const systems = request.satelliteSystems ?? ['G'];
  const wanted = new Set(request.requiredReceiverSerials.map(normalizeSerial));
  const { header, blocks, footer } = splitAntex(request.sourceText);
  const kept: string[][] = [];
  const found = new Set<string>();
  let sat = 0;
  for (const block of blocks) {
    const serial = normalizeSerial(serialOf(block));
    if (!serial) continue;
    if (isSatelliteSerial(serial)) {
      if (satSystemsOf(serial).some((s) => systems.includes(s))) {
        kept.push(block);
        sat += 1;
      }
    } else if (wanted.has(serial)) {
      kept.push(block);
      found.add(serial);
    }
  }
  const missing = [...wanted].filter((s) => !found.has(s));
  if (missing.length > 0) {
    throw new Error(
      `ANTEX subset missing required receiver antenna(s): ${missing.join(', ')}. ` +
        'Refusing fuzzy substitution.',
    );
  }
  const subsetText = [...header, ...kept.flat(), ...footer].join('\n');
  const size = new TextEncoder().encode(subsetText).byteLength;
  const cap = request.maxBytes ?? GNSS_ANTEX_SUBSET_MAX_BYTES;
  if (size > cap) {
    throw new Error(`ANTEX subset of ${size} bytes exceeds the ${cap}-byte bound.`);
  }
  return { subsetText, receiverSerials: [...found].sort(), satelliteBlockCount: sat };
};

/** Full build with SHA256 provenance (source + subset). */
export const buildAntexSubset = async (
  request: GnssAntexSubsetRequest,
): Promise<GnssAntexSubsetResult> => {
  const { sha256Hex } = await import('./gnssRawHash');
  const sourceBytes = new TextEncoder().encode(request.sourceText);
  const extracted = extractAntexSubsetText(request);
  const subsetBytes = new TextEncoder().encode(extracted.subsetText);
  const systems = request.satelliteSystems ?? ['G'];
  return {
    subsetText: extracted.subsetText,
    subsetBytes,
    sourceSha256: await sha256Hex(sourceBytes),
    subsetSha256: await sha256Hex(subsetBytes),
    sourceSizeBytes: sourceBytes.byteLength,
    subsetSizeBytes: subsetBytes.byteLength,
    receiverSerials: extracted.receiverSerials,
    satelliteBlockCount: extracted.satelliteBlockCount,
    satelliteSystems: [...systems],
    validAt: request.validAt ?? null,
  };
};

/**
 * Cache put-or-reuse: stores the result under its subset SHA256 and returns
 * the canonical cached instance, so repeat jobs share one object.
 */
export const storeAntexSubset = (
  cache: GnssAntexSubsetCache,
  result: GnssAntexSubsetResult,
): GnssAntexSubsetResult => {
  const hit = cache.get(result.subsetSha256);
  if (hit) return hit;
  cache.set(result.subsetSha256, result);
  return result;
};

export const getCachedAntexSubset = (
  cache: GnssAntexSubsetCache,
  subsetSha256: string,
): GnssAntexSubsetResult | undefined => cache.get(subsetSha256);
