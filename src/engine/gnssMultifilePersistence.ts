/**
 * Phase 13F fixes — durable multifile project state (no math, no parsing).
 *
 * The multifile hook owns live React state; this module maps that state to
 * and from a JSON document built on the existing project manifest/content
 * architecture: manifest entries (kind 'gnss', embedded content keyed by
 * file id, order/enabled), plus the gnssMultifile settings bag
 * (serialize/deserialize round-trip, never the composed network).
 *
 * Durability is a caller-supplied key/value store (production default:
 * localStorage keyed by named-project id). All parsing is defensive:
 * corrupt or partial documents load as null and the hook starts empty.
 */
import {
  deserializeGnssMultifilePersisted,
  serializeGnssMultifilePersisted,
  type GnssMultifilePersistedV1,
} from './gnssMultifileProject';
import type { ProjectManifestFileEntry } from './projectWorkspaceTypes';

export interface GnssMultifileProjectStore {
  getItem(_key: string): string | null;
  setItem(_key: string, _value: string): void;
}

export interface GnssMultifileProjectPersistedUi {
  readonly centeringSigma: string;
  readonly heightSigma: string;
  readonly acknowledgedHashes: string[];
}

export interface GnssMultifileProjectPersistedState {
  readonly entries: ProjectManifestFileEntry[];
  readonly texts: Record<string, string>;
  readonly settings: GnssMultifilePersistedV1;
  readonly ui: GnssMultifileProjectPersistedUi;
  /** Frozen run snapshot JSON (opaque here; validated as a snapshot on load). */
  readonly snapshot: Record<string, unknown> | null;
}

export const gnssMultifileProjectStorageKey = (projectId: string): string =>
  `webnet.gnss-multifile-project.v1.${projectId}`;

/** Production default store: localStorage, or null where unavailable (SSR/tests). */
export const defaultGnssMultifileProjectStore = (): GnssMultifileProjectStore | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    return {
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    };
  } catch {
    return null;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const sanitizeEntries = (value: unknown): ProjectManifestFileEntry[] | null => {
  if (!Array.isArray(value)) return null;
  const entries: ProjectManifestFileEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) return null;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
    if (typeof raw.order !== 'number' || !Number.isFinite(raw.order)) return null;
    entries.push({
      id: raw.id,
      name: raw.name,
      kind: 'gnss',
      path: typeof raw.path === 'string' ? raw.path : `data/${raw.id}-${raw.name}`,
      enabled: raw.enabled !== false,
      order: raw.order,
    });
  }
  return entries;
};

const sanitizeTexts = (value: unknown): Record<string, string> | null => {
  if (!isRecord(value)) return null;
  const texts: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null;
    texts[key] = entry;
  }
  return texts;
};

const sanitizeUi = (value: unknown): GnssMultifileProjectPersistedUi => {
  const ui = isRecord(value) ? value : {};
  return {
    centeringSigma: typeof ui.centeringSigma === 'string' ? ui.centeringSigma : '0.000',
    heightSigma: typeof ui.heightSigma === 'string' ? ui.heightSigma : '0.000',
    acknowledgedHashes: asStringArray(ui.acknowledgedHashes),
  };
};

const sanitizeSnapshot = (value: unknown): Record<string, unknown> | null => {
  if (value == null) return null;
  if (!isRecord(value)) return null;
  if (typeof value.fingerprint !== 'string') return null;
  // Frozen review/export context is mandatory: the panel renders review
  // exclusively from the snapshot, so a partial document must not load.
  if (!Array.isArray(value.provenance) || !isRecord(value.input) || !isRecord(value.outcome)) return null;
  if (!Array.isArray(value.enabledSources) || typeof value.datumMode !== 'string') return null;
  if (!Array.isArray(value.warnings) || !Array.isArray(value.controlBySource)) return null;
  if (!isRecord(value.stationTrace) || !isRecord(value.composedControl)) return null;
  return value;
};

export const serializeGnssMultifileProjectState = (
  state: GnssMultifileProjectPersistedState,
): string =>
  JSON.stringify({
    version: 1,
    entries: state.entries,
    texts: state.texts,
    settings: serializeGnssMultifilePersisted(state.settings),
    ui: state.ui,
    snapshot: state.snapshot,
  });

export const deserializeGnssMultifileProjectState = (
  raw: string | null | undefined,
): GnssMultifileProjectPersistedState | null => {
  if (typeof raw !== 'string' || raw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || parsed.version !== 1) return null;
  const entries = sanitizeEntries(parsed.entries);
  const texts = sanitizeTexts(parsed.texts);
  if (!entries || !texts) return null;
  return {
    entries,
    texts,
    settings: deserializeGnssMultifilePersisted(
      isRecord(parsed.settings) ? (parsed.settings as Record<string, unknown>) : undefined,
    ),
    ui: sanitizeUi(parsed.ui),
    snapshot: sanitizeSnapshot(parsed.snapshot),
  };
};

export const loadGnssMultifileProject = (
  projectId: string,
  store: GnssMultifileProjectStore | null | undefined,
): GnssMultifileProjectPersistedState | null => {
  if (!store) return null;
  try {
    return deserializeGnssMultifileProjectState(store.getItem(gnssMultifileProjectStorageKey(projectId)));
  } catch {
    return null;
  }
};

export const saveGnssMultifileProject = (
  projectId: string,
  store: GnssMultifileProjectStore | null | undefined,
  state: GnssMultifileProjectPersistedState,
): void => {
  if (!store) return;
  try {
    store.setItem(gnssMultifileProjectStorageKey(projectId), serializeGnssMultifileProjectState(state));
  } catch {
    // Durability is best-effort (quota/private mode): live state is
    // unaffected when the write fails.
  }
};
