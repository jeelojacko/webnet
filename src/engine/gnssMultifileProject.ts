/**
 * Phase 12H.1 — multi-file GNSS project wiring (DEFAULT OFF via gnssMultifileFlag).
 *
 * Pure helpers over the existing project manifest: detect/parse each
 * ENABLED GNSS source independently, compose in memory, apply
 * project-level control overrides AFTER composition, run the existing
 * datum preflight on the composed network, and solve ONE composed
 * network through the unchanged adjust dispatch. Never concatenates
 * text, never shares parser state, never persists the composed network.
 */
import type { StationMap } from '../types';
import type { ProjectManifestFileEntry } from './projectWorkspaceTypes';
import { sortProjectFiles } from './projectWorkspace';
import {
  parseGnssBaselineText,
  type GnssBaselineNetworkInput,
  type GnssDiagnostic,
} from './gnssBaselineNetworkImport';
import { importGnssBaselineGvx } from './gnssGvxImport';
import {
  importGnssBaselineDelimited,
  importGnssControlCsv,
} from './gnssBaselineCsvImport';
import {
  composeGnssBaselineNetworks,
  type GnssMultifileFormat,
  type GnssMultifileProvenance,
  type GnssMultifileResult,
  type GnssMultifileSource,
} from './gnssMultifileComposition';
import { isGnssMultifileEnabled } from './gnssMultifileFlag';
import { strongDuplicateBlocks } from './gnssMultifileDuplicates';
import { gnssBaselineComponents, runGnssBaselinePreflight } from './gnssBaselinePreflight';
import {
  runGnssBaselineAdjustment,
  type GnssBaselineAdjustInput,
  type GnssBaselineAdjustResult,
  type GnssBaselineNativeRuntime,
} from './gnssBaselineAdjust';
import { setStationFixed } from './gnssWorkspaceSession';
import {
  normalizeGnssSetupUncertainty,
  type GnssSetupUncertainty,
} from './gnssBaselineSetupUncertainty';
import { computeGnssLoopClosures } from './gnssBaselineLoops';

export type GnssProjectSourceKind =
  | 'terrestrial'
  | 'gnss-gvx'
  | 'gnss-csv'
  | 'gnss-native-bl'
  | 'ignored';

export interface GnssMultifileRunOptions {
  readonly formatOverrides?: Readonly<Record<string, GnssProjectSourceKind>>;
  readonly controlOverrides?: Readonly<Record<string, boolean>>;
  readonly setup?: GnssSetupUncertainty;
  readonly csvReferenceFrame?: string;
  readonly csvEpoch?: string;
  readonly csvEllipsoid?: string;
  readonly nativeRuntime?: GnssBaselineNativeRuntime;
}

export interface GnssMultifilePersistedV1 {
  readonly version: 1;
  readonly formatOverrides: Record<string, GnssProjectSourceKind>;
  readonly controlOverrides: Record<string, boolean>;
  readonly setup: GnssSetupUncertainty;
  readonly displayNames: Record<string, string>;
}

export const GNSS_MULTIFILE_SETTINGS_KEY = 'gnssMultifile';

export const emptyGnssMultifilePersisted = (): GnssMultifilePersistedV1 => ({
  version: 1,
  formatOverrides: {},
  controlOverrides: {},
  setup: { horizontalCenteringSigma: 0, antennaHeightSigma: 0 },
  displayNames: {},
});

const textOf = (value: string | undefined): string => (value ?? '').trim();

/** Content sniff: GVX XML vs native BL vs delimited GNSS vs terrestrial. */
export const detectGnssProjectSourceKind = (
  fileName: string,
  content: string,
): GnssProjectSourceKind => {
  const lower = fileName.toLowerCase();
  const body = content.trim();
  if (body === '' || lower.endsWith('.md')) return 'ignored';
  if (lower.endsWith('.gvx') || /<\s*(GVX|GNSS_VECTOR)/i.test(body.slice(0, 2000))) return 'gnss-gvx';
  const lines = body.split('\n').map((line) => line.trim()).filter((line) => line !== '' && !line.startsWith('#'));
  const head = lines.slice(0, 8).join('\n');
  if (/^FRAME\s+(ECEF|ENU)\b/im.test(head) && /^BL\s+/im.test(body)) return 'gnss-native-bl';
  const first = lines[0] ?? '';
  if (/from|to|dx|dy|dz/i.test(first) && /[,;\t|]/.test(first)) return 'gnss-csv';
  if (/^(GX|BL|COV|SIGCORR|FRAME|UNITS)\b/im.test(body)) return 'gnss-native-bl';
  return 'terrestrial';
};

export interface GnssProjectParsedSource {
  readonly fileId: string;
  readonly fileName: string;
  readonly kind: GnssProjectSourceKind;
  readonly format: GnssMultifileFormat;
  readonly network: GnssBaselineNetworkInput | null;
  readonly diagnostics: GnssDiagnostic[];
}

interface GnssCsvFallbackFrame {
  readonly referenceFrame: string;
  readonly epoch?: string;
  readonly ellipsoid?: string;
}

interface GnssProjectPass1 {
  readonly parsed: GnssProjectParsedSource[];
  readonly unionStations: StationMap;
  readonly csvFallbackFrame: GnssCsvFallbackFrame | null;
}

/** Pass 1: GVX + native BL (each parsed independently); seeds union stations + CSV frame. */
const parseGvxAndNativePass = (
  enabled: Array<{ id: string; name: string }>,
  kinds: Readonly<Map<string, GnssProjectSourceKind>>,
  sourceTexts: Readonly<Record<string, string>>,
): GnssProjectPass1 => {
  const parsed: GnssProjectParsedSource[] = [];
  const unionStations: StationMap = {};
  let csvFallbackFrame: GnssCsvFallbackFrame | null = null;
  enabled.forEach((file) => {
    const kind = kinds.get(file.id) ?? 'terrestrial';
    const content = sourceTexts[file.id] ?? '';
    if (kind === 'gnss-gvx') {
      const result = importGnssBaselineGvx(content, file.name);
      if (result.network && !csvFallbackFrame) {
        csvFallbackFrame = {
          referenceFrame: result.network.frame.referenceFrame,
          epoch: result.network.frame.epoch,
          ellipsoid: result.network.frame.ellipsoid,
        };
      }
      if (result.network) Object.assign(unionStations, result.network.stations);
      parsed.push({ fileId: file.id, fileName: file.name, kind, format: 'gvx', network: result.network, diagnostics: [...result.diagnostics] });
    } else if (kind === 'gnss-native-bl') {
      const result = parseGnssBaselineText(content, file.name);
      if (result.network && !csvFallbackFrame) {
        csvFallbackFrame = {
          referenceFrame: result.network.frame.referenceFrame,
          epoch: result.network.frame.epoch,
          ellipsoid: result.network.frame.ellipsoid,
        };
      }
      if (result.network) Object.assign(unionStations, result.network.stations);
      parsed.push({ fileId: file.id, fileName: file.name, kind, format: 'native', network: result.network, diagnostics: [...result.diagnostics] });
    }
  });
  return { parsed, unionStations, csvFallbackFrame };
};

/**
 * Pass 2: CSV (control stations first, then baselines against the union).
 * Extends unionStations in place; returns only the CSV parsed entries.
 */
const parseCsvPass = (
  enabled: Array<{ id: string; name: string }>,
  kinds: Readonly<Map<string, GnssProjectSourceKind>>,
  sourceTexts: Readonly<Record<string, string>>,
  unionStations: StationMap,
  csvFallbackFrame: GnssCsvFallbackFrame | null,
  options: GnssMultifileRunOptions,
): GnssProjectParsedSource[] => {
  const parsed: GnssProjectParsedSource[] = [];
  let frame = csvFallbackFrame;
  enabled.forEach((file) => {
    const kind = kinds.get(file.id) ?? 'terrestrial';
    if (kind !== 'gnss-csv') return;
    const content = sourceTexts[file.id] ?? '';
    const control = importGnssControlCsv(content, { units: 'm', sourceFile: file.name });
    if (control.stations) {
      Object.assign(unionStations, control.stations);
      if (!frame) {
        frame = {
          referenceFrame: options.csvReferenceFrame ?? 'unknown',
          epoch: options.csvEpoch,
          ellipsoid: options.csvEllipsoid,
        };
      }
      parsed.push({ fileId: file.id, fileName: file.name, kind, format: 'delimited', network: null, diagnostics: [...control.diagnostics] });
      return;
    }
    const resolved = {
      referenceFrame: options.csvReferenceFrame ?? frame?.referenceFrame ?? 'unknown',
      epoch: options.csvEpoch ?? frame?.epoch,
      ellipsoid: options.csvEllipsoid ?? frame?.ellipsoid,
    };
    const result = importGnssBaselineDelimited(content, unionStations, {
      units: 'm',
      vectorFrame: 'ecef',
      referenceFrame: resolved.referenceFrame,
      epoch: resolved.epoch,
      ellipsoid: resolved.ellipsoid,
      sourceFile: file.name,
    });
    if (result.network) Object.assign(unionStations, result.network.stations);
    parsed.push({ fileId: file.id, fileName: file.name, kind, format: 'delimited', network: result.network, diagnostics: [...result.diagnostics] });
  });
  return parsed;
};

/**
 * Parse each ENABLED source independently (never concatenate text, never
 * share parser state). CSV baselines resolve against control-CSV stations
 * plus already-parsed GNSS stations (two-pass); CSV frame comes from run
 * options or the first non-CSV GNSS source.
 */
export const parseGnssProjectSources = (
  files: readonly ProjectManifestFileEntry[],
  sourceTexts: Readonly<Record<string, string>>,
  options: GnssMultifileRunOptions = {},
): GnssProjectParsedSource[] => {
  const enabled = sortProjectFiles([...files]).filter((file) => file.enabled);
  const kinds = new Map<string, GnssProjectSourceKind>();
  enabled.forEach((file) => {
    const override = options.formatOverrides?.[file.id];
    const content = sourceTexts[file.id] ?? '';
    kinds.set(file.id, override ?? detectGnssProjectSourceKind(file.name, content));
  });
  const pass1 = parseGvxAndNativePass(enabled, kinds, sourceTexts);
  const parsed: GnssProjectParsedSource[] = [
    ...pass1.parsed,
    ...parseCsvPass(enabled, kinds, sourceTexts, pass1.unionStations, pass1.csvFallbackFrame, options),
  ];
  // Terrestrial + ignored entries (never parsed as GNSS).
  enabled.forEach((file) => {
    const kind = kinds.get(file.id) ?? 'terrestrial';
    if (kind === 'terrestrial' || kind === 'ignored') {
      parsed.push({ fileId: file.id, fileName: file.name, kind, format: 'unknown', network: null, diagnostics: [] });
    }
  });
  return [...parsed].sort((a, b) => {
    const orderOf = (id: string): number => enabled.find((file) => file.id === id)?.order ?? 0;
    return orderOf(a.fileId) - orderOf(b.fileId);
  });
};

export interface GnssPrecompositionSummary {
  readonly enabledFiles: number;
  readonly totalFiles: number;
  readonly sources: Array<{ sourceId: string; fileName: string; format: string; stations: number; baselines: number }>;
  readonly agreedFrame: string;
  readonly agreedEpoch: string;
  readonly agreedEllipsoid: string;
  readonly uniqueStations: number;
  readonly fixedStations: number;
  readonly freeStations: number;
  readonly baselineCount: number;
  readonly componentCount: number;
  readonly controlBySource: string[];
  readonly duplicateCandidates: number;
  readonly mergeNotes: string[];
  readonly warnings: string[];
  readonly blockingErrors: string[];
  readonly status: 'READY' | 'BLOCKED';
}

/**
 * Failed-parse blocks: importer error diagnostics and null-network GNSS
 * sources (except control-stations-only CSV) name the failed source.
 */
const failedSourceBlocks = (parsed: readonly GnssProjectParsedSource[]): string[] => {
  const blocks: string[] = [];
  parsed.forEach((entry) => {
    entry.diagnostics.forEach((diagnostic) => {
      if (diagnostic.severity === 'error') {
        blocks.push(
          `compose blocked: source '${entry.fileName}' [${entry.fileId}] failed to parse: ${diagnostic.message}`,
        );
      }
    });
    const isGnssKind =
      entry.kind === 'gnss-gvx' || entry.kind === 'gnss-native-bl' || entry.kind === 'gnss-csv';
    if (!isGnssKind || entry.network != null) return;
    // CSV control-stations-only entries legitimately carry network null.
    if (entry.kind === 'gnss-csv' && !entry.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return;
    if (entry.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) return; // already named above
    blocks.push(
      `compose blocked: source '${entry.fileName}' [${entry.fileId}] produced no network (parse failed).`,
    );
  });
  return blocks;
};

/** Shared summary builder over one precomputed composition (single compose per run). */
const buildPrecompositionSummary = (
  parsed: readonly GnssProjectParsedSource[],
  totalFiles: number,
  composed: GnssMultifileResult | null,
): GnssPrecompositionSummary => {
  const gnss = parsed.filter((entry) => entry.network != null);
  const warnings: string[] = [];
  gnss.forEach((entry) => {
    entry.diagnostics.forEach((diagnostic) => {
      if (diagnostic.severity === 'warning') warnings.push(`[${entry.fileName}] ${diagnostic.message}`);
    });
  });
  const blockingErrors = [
    ...failedSourceBlocks(parsed),
    ...(composed == null
      ? ['compose blocked: no enabled GNSS sources.']
      : [...composed.blockingErrors, ...strongDuplicateBlocks(composed.duplicateCandidates)]),
  ];
  const agreed = (pick: (_network: GnssBaselineNetworkInput) => string | undefined): string => {
    const values = new Set(gnss.map((entry) => textOf(pick(entry.network as GnssBaselineNetworkInput)) || 'unknown'));
    return values.size === 1 ? [...values][0] as string : 'unknown';
  };
  const uniqueStations = new Set<string>();
  const fixedStations = new Set<string>();
  gnss.forEach((entry) => {
    const network = entry.network as GnssBaselineNetworkInput;
    Object.entries(network.stations).forEach(([id, station]) => {
      uniqueStations.add(id);
      if (station?.fixedX && station?.fixedY && station?.fixedH) fixedStations.add(id);
    });
  });
  const allBaselines = gnss.flatMap((entry) => (entry.network as GnssBaselineNetworkInput).baselines);
  return {
    enabledFiles: parsed.filter((entry) => entry.kind !== 'ignored').length,
    totalFiles,
    sources: gnss.map((entry) => ({
      sourceId: entry.fileId,
      fileName: entry.fileName,
      format: entry.format,
      stations: Object.keys((entry.network as GnssBaselineNetworkInput).stations).length,
      baselines: (entry.network as GnssBaselineNetworkInput).baselines.length,
    })),
    agreedFrame: gnss.length > 0 ? agreed((network) => network.frame.referenceFrame) : 'unknown',
    agreedEpoch: gnss.length > 0 ? agreed((network) => network.frame.epoch) : 'unknown',
    agreedEllipsoid: gnss.length > 0 ? agreed((network) => network.frame.ellipsoid) : 'unknown',
    uniqueStations: uniqueStations.size,
    fixedStations: fixedStations.size,
    freeStations: uniqueStations.size - fixedStations.size,
    baselineCount: allBaselines.length,
    componentCount: allBaselines.length > 0 ? gnssBaselineComponents(allBaselines).length : 0,
    controlBySource: [...fixedStations].sort().map((id) => {
      const origin = gnss.find((entry) => (entry.network as GnssBaselineNetworkInput).stations[id]?.fixedX)?.fileName ?? 'unknown';
      return `${id} FIXED (${origin})`;
    }),
    duplicateCandidates: composed?.duplicateCandidates.length ?? 0,
    mergeNotes: [...(composed?.mergeNotes ?? [])],
    warnings,
    blockingErrors,
    status: blockingErrors.length > 0 ? 'BLOCKED' : 'READY',
  };
};

/** Precomposition summary: explicit agreed frame, counts, conflicts, READY/BLOCKED. */
export const summarizeGnssProjectComposition = (
  parsed: readonly GnssProjectParsedSource[],
  totalFiles: number,
): GnssPrecompositionSummary => {
  const gnss = parsed.filter((entry) => entry.network != null);
  const ordered: GnssMultifileSource[] = gnss.map((entry) => ({
    network: entry.network as GnssBaselineNetworkInput,
    sourceId: entry.fileId,
    fileName: entry.fileName,
    format: entry.format,
  }));
  const composed = ordered.length > 0 ? composeGnssBaselineNetworks(ordered) : null;
  return buildPrecompositionSummary(parsed, totalFiles, composed);
};

export interface GnssMultifileSolveOutput {
  readonly parsed: GnssProjectParsedSource[];
  readonly summary: GnssPrecompositionSummary;
  readonly provenance: GnssMultifileProvenance[];
  readonly mergeNotes: string[];
  readonly input: GnssBaselineAdjustInput;
  readonly result: GnssBaselineAdjustResult;
}

/**
 * Full project solve: mixed terrestrial+GNSS guard, compose, STRONG
 * duplicate block, project control overrides AFTER composition, existing
 * datum preflight on the composed network, ONE solve via unchanged dispatch.
 */
export const runGnssMultifileProjectSolve = (
  files: readonly ProjectManifestFileEntry[],
  sourceTexts: Readonly<Record<string, string>>,
  options: GnssMultifileRunOptions = {},
): GnssMultifileSolveOutput => {
  if (!isGnssMultifileEnabled()) {
    throw new Error('GNSS multifile run blocked: flag OFF (DEFAULT OFF; enable to run).');
  }
  const parsed = parseGnssProjectSources(files, sourceTexts, options);
  const gnss = parsed.filter((entry) => entry.network != null);
  const terrestrial = parsed.filter((entry) => entry.kind === 'terrestrial');
  const nonEmptyTerrestrial = terrestrial.filter((entry) => textOf(sourceTexts[entry.fileId] ?? '') !== '');
  if (gnss.length > 0 && nonEmptyTerrestrial.length > 0) {
    throw new Error(
      `GNSS multifile run blocked: mixed terrestrial + GNSS sources in one enabled run ` +
        `(${nonEmptyTerrestrial.map((entry) => `'${entry.fileName}'`).join(', ')} are terrestrial; ` +
        `${gnss.map((entry) => `'${entry.fileName}'`).join(', ')} are GNSS). Run them separately.`,
    );
  }
  // Single compose per run: the summary builds over this same result.
  const ordered: GnssMultifileSource[] = gnss.map((entry) => ({
    network: entry.network as GnssBaselineNetworkInput,
    sourceId: entry.fileId,
    fileName: entry.fileName,
    format: entry.format,
  }));
  const composed = ordered.length > 0 ? composeGnssBaselineNetworks(ordered) : null;
  const summary = buildPrecompositionSummary(parsed, files.length, composed);
  if (summary.status === 'BLOCKED') {
    throw new Error(summary.blockingErrors[0] ?? 'compose blocked');
  }
  if (!composed?.composed) throw new Error(composed?.blockingErrors[0] ?? 'compose blocked');
  // Project-level control overrides AFTER composition (exact station ID; sources untouched).
  let stations = Object.fromEntries(
    Object.entries(composed.composed.stations).map(([id, station]) => [id, { ...station }]),
  );
  Object.keys(options.controlOverrides ?? {})
    .sort()
    .forEach((id) => {
      if (stations[id]) stations = setStationFixed(stations, id, options.controlOverrides?.[id] ?? false);
    });
  const setup = normalizeGnssSetupUncertainty(options.setup);
  const input: GnssBaselineAdjustInput = {
    stations,
    baselines: composed.composed.baselines.map((baseline) => ({ ...baseline })),
    referenceFrame: composed.composed.frame.referenceFrame,
    epoch: composed.composed.frame.epoch,
    ellipsoid: composed.composed.frame.ellipsoid,
    setupUncertainty: setup,
    nativeRuntime: options.nativeRuntime,
  };
  runGnssBaselinePreflight({
    stations: input.stations,
    baselines: input.baselines,
    referenceFrame: input.referenceFrame,
    epoch: input.epoch,
    ellipsoid: input.ellipsoid,
  });
  const result = runGnssBaselineAdjustment(input);
  return { parsed, summary, provenance: composed.provenance, mergeNotes: composed.mergeNotes, input, result };
};

/** Machine-local absolute paths must never enter portable bundles. */
export const findNonPortableProjectPaths = (
  files: readonly ProjectManifestFileEntry[],
): string[] => {
  const offenders: string[] = [];
  // Any absolute POSIX path or leading ~/ is machine-local: portable
  // bundles carry embedded content only, never host paths.
  const machineLocal = (value: string): boolean =>
    value.startsWith('/') ||
    value === '~' ||
    value.startsWith('~/') ||
    value.startsWith('~\\') ||
    value.includes('$HOME') ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith('\\\\');
  files.forEach((file) => {
    if (machineLocal(file.path) || machineLocal(file.name)) offenders.push(file.id);
  });
  return offenders;
};

/** Save gate: throws when machine-local paths would leak into a portable bundle. */
export const assertGnssProjectPortable = (
  files: readonly ProjectManifestFileEntry[],
): void => {
  const offenders = findNonPortableProjectPaths(files);
  if (offenders.length > 0) {
    throw new Error(
      `portable save blocked: machine-local path on file(s) ${offenders.join(', ')} (use embedded portable content, never ~/Downloads).`,
    );
  }
};

/** Persisted helpers: settings-bag round-trip (never persists the composed network). */
export const serializeGnssMultifilePersisted = (
  persisted: GnssMultifilePersistedV1,
): Record<string, unknown> => ({ [GNSS_MULTIFILE_SETTINGS_KEY]: { ...persisted } });

export const deserializeGnssMultifilePersisted = (
  settings: Readonly<Record<string, unknown>> | undefined,
): GnssMultifilePersistedV1 => {
  const raw = settings?.[GNSS_MULTIFILE_SETTINGS_KEY] as Partial<GnssMultifilePersistedV1> | undefined;
  if (!raw || typeof raw !== 'object') return emptyGnssMultifilePersisted();
  return {
    version: 1,
    formatOverrides: { ...(raw.formatOverrides ?? {}) },
    controlOverrides: { ...(raw.controlOverrides ?? {}) },
    setup: { ...(raw.setup ?? { horizontalCenteringSigma: 0, antennaHeightSigma: 0 }) },
    displayNames: { ...(raw.displayNames ?? {}) },
  };
};

/** Report provenance section (no math recomputation): per-baseline origin + loop origins + warnings. */
export const buildGnssMultifileProvenanceSection = (
  provenance: readonly GnssMultifileProvenance[],
  baselines: GnssBaselineAdjustInput['baselines'],
  mergeNotes: readonly string[],
  blockingErrors: readonly string[],
): string[] => {
  const lines: string[] = ['Multifile composition provenance:'];
  provenance.forEach((entry, index) => {
    const baseline = baselines[index];
    lines.push(
      `  BL ${index + 1} (${baseline?.from ?? '?'}->${baseline?.to ?? '?'}) from '${entry.fileName}' [${entry.sourceId}] original ID ${entry.originalId} (${entry.format}).`,
    );
  });
  try {
    const loops = computeGnssLoopClosures(baselines.map((baseline) => ({ ...baseline })));
    loops.loops.forEach((loop, index) => {
      const origins = [...new Set(loop.members.map((member) => provenance[member.baselineId - 1]?.sourceId ?? '?'))];
      lines.push(`  loop ${index + 1}: members span ${origins.join('+')}.`);
    });
  } catch {
    lines.push('  loop QC unavailable (backend error).');
  }
  if (mergeNotes.length > 0) {
    lines.push('Composition notes:');
    mergeNotes.forEach((note) => lines.push(`  note: ${note}`));
  }
  if (blockingErrors.length > 0) {
    lines.push('Composition conflicts:');
    blockingErrors.forEach((error) => lines.push(`  BLOCKED: ${error}`));
  }
  return lines;
};

/** JSON export: sources, frame, provenance, diagnostics, setup, overrides, results. */
export const buildGnssMultifileJsonExport = (output: GnssMultifileSolveOutput): Record<string, unknown> => ({
  kind: 'webnet-gnss-multifile-export',
  version: 1,
  sources: output.parsed
    .filter((entry) => entry.network != null)
    .map((entry) => ({
      sourceId: entry.fileId,
      fileName: entry.fileName,
      format: entry.format,
      stations: Object.keys((entry.network as GnssBaselineNetworkInput).stations).length,
      baselines: (entry.network as GnssBaselineNetworkInput).baselines.length,
      diagnostics: entry.diagnostics,
    })),
  composedFrame: {
    referenceFrame: output.input.referenceFrame,
    epoch: output.input.epoch,
    ellipsoid: output.input.ellipsoid,
  },
  stationProvenance: output.summary.controlBySource,
  baselineProvenance: output.provenance,
  compositionNotes: output.mergeNotes,
  setup: output.input.setupUncertainty,
  controlOverrides: output.input.stations,
  result: {
    varianceFactor: output.result.varianceFactor,
    weightedResidualSum: output.result.weightedResidualSum,
    dof: output.result.dof,
    iterations: output.result.iterations,
    converged: output.result.converged,
    stations: output.result.stations,
    residuals: output.result.residuals,
    statistics: output.result.statistics,
    routeProvenance: output.result.routeProvenance,
  },
});
