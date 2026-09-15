/**
 * Phase 12H.2 — multi-file GNSS project wiring (DEFAULT ON via gnssMultifileFlag).
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
import { classifyGnssDatumComponents, type GnssDatumMode } from './gnssFreeNetwork';
import {
  normalizeGnssSetupUncertainty,
  type GnssSetupUncertainty,
} from './gnssBaselineSetupUncertainty';


export type GnssProjectSourceKind =
  | 'terrestrial'
  | 'gnss-gvx'
  | 'gnss-csv'
  | 'gnss-native-bl'
  | 'ignored';

export interface GnssMultifileRunOptions {
  readonly formatOverrides?: Readonly<Record<string, GnssProjectSourceKind>>;
  readonly controlOverrides?: Readonly<Record<string, boolean>>;
  /** Phase 12I.1: explicit datum opt-in, default 'constrained' (no UI). */
  readonly datumMode?: GnssDatumMode;
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
  /** Phase 12I.1: retained datum opt-in, default 'constrained' (no UI). */
  readonly datumMode: GnssDatumMode;
  readonly setup: GnssSetupUncertainty;
  readonly displayNames: Record<string, string>;
}

export const GNSS_MULTIFILE_SETTINGS_KEY = 'gnssMultifile';

export const emptyGnssMultifilePersisted = (): GnssMultifilePersistedV1 => ({
  version: 1,
  formatOverrides: {},
  controlOverrides: {},
  datumMode: 'constrained',
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
  /**
   * Control-stations-only CSV declarations. Network stays null (no
   * baselines, no frame) so composition numerics are untouched; the
   * declarations are retained here so the station trace and fixed-control
   * attribution name the control source instead of vanishing or leaking
   * onto a later baseline network.
   */
  readonly controlStations?: StationMap | null;
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
      parsed.push({ fileId: file.id, fileName: file.name, kind, format: 'delimited', network: null, controlStations: control.stations, diagnostics: [...control.diagnostics] });
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

export interface GnssProjectDatumComponent {
  readonly stations: string[];
  readonly kind: 'constrained' | 'free';
}

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
  /**
   * Phase 12I.2: per-component datum classification over the composed
   * network WITH project control overrides applied (datum is decided
   * post-compose + post-overrides, never per-source). UI reads this for
   * the Constrained/Free display; absent datumMode renders 'constrained'.
   */
  readonly datumMode: GnssDatumMode;
  readonly datumComponents: GnssProjectDatumComponent[];
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

/** Options threading the RUN-level datum choice into the summary (never per-source). */
export interface GnssProjectSummaryOptions {
  readonly controlOverrides?: Readonly<Record<string, boolean>>;
  readonly datumMode?: GnssDatumMode;
}

/** Project control overrides AFTER composition (exact station ID; sources untouched). */
const withControlOverrides = (
  stations: StationMap,
  overrides: Readonly<Record<string, boolean>> | undefined,
): StationMap => {
  let next = Object.fromEntries(
    Object.entries(stations).map(([id, station]) => [id, { ...station }]),
  );
  Object.keys(overrides ?? {})
    .sort()
    .forEach((id) => {
      if (next[id]) next = setStationFixed(next, id, overrides?.[id] ?? false);
    });
  return next;
};

/** Shared summary builder over one precomputed composition (single compose per run). */
const buildPrecompositionSummary = (
  parsed: readonly GnssProjectParsedSource[],
  totalFiles: number,
  composed: GnssMultifileResult | null,
  summaryOptions: GnssProjectSummaryOptions = {},
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
  // Fixed-control attribution prefers the control-stations-only CSV that
  // declared it (manifest order); only then the first baseline network.
  // Without this the control source vanishes from the trace and its FIXED
  // stations get misattributed to whichever later network re-declares them.
  const controlOrigin = new Map<string, string>();
  parsed.forEach((entry) => {
    if (!entry.controlStations) return;
    Object.entries(entry.controlStations).forEach(([id, station]) => {
      if (station?.fixedX && station?.fixedY && station?.fixedH && !controlOrigin.has(id)) {
        controlOrigin.set(id, entry.fileName);
      }
    });
  });
  controlOrigin.forEach((_, id) => fixedStations.add(id));
  const allBaselines = gnss.flatMap((entry) => (entry.network as GnssBaselineNetworkInput).baselines);
  // Datum classification for UI: composed stations with the project
  // control overrides applied (same effective control the solve decides
  // on), classified per baseline-connected component. No anchors leak:
  // anchors are adjust-time working state, never summary state.
  const datumMode = summaryOptions.datumMode ?? 'constrained';
  let datumComponents: GnssProjectDatumComponent[] = [];
  if (composed?.composed) {
    const effectiveStations = withControlOverrides(composed.composed.stations, summaryOptions.controlOverrides);
    const classification = classifyGnssDatumComponents(effectiveStations, composed.composed.baselines);
    const freeSet = new Set(classification.freeComponents.flat());
    datumComponents = classification.components.map((stations) => ({
      stations: [...stations],
      kind: freeSet.has(stations[0] as string) ? 'free' : 'constrained',
    }));
  }
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
    datumMode,
    datumComponents,
    controlBySource: [...fixedStations].sort().map((id) => {
      const origin = controlOrigin.get(id)
        ?? gnss.find((entry) => (entry.network as GnssBaselineNetworkInput).stations[id]?.fixedX)?.fileName
        ?? 'unknown';
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
  summaryOptions: GnssProjectSummaryOptions = {},
): GnssPrecompositionSummary => {
  const gnss = parsed.filter((entry) => entry.network != null);
  const ordered: GnssMultifileSource[] = gnss.map((entry) => ({
    network: entry.network as GnssBaselineNetworkInput,
    sourceId: entry.fileId,
    fileName: entry.fileName,
    format: entry.format,
  }));
  const composed = ordered.length > 0 ? composeGnssBaselineNetworks(ordered) : null;
  return buildPrecompositionSummary(parsed, totalFiles, composed, summaryOptions);
};

export interface GnssMultifileSolveInput {
  readonly parsed: GnssProjectParsedSource[];
  readonly summary: GnssPrecompositionSummary;
  readonly provenance: GnssMultifileProvenance[];
  readonly mergeNotes: string[];
  readonly input: GnssBaselineAdjustInput;
}

export interface GnssMultifileSolveOutput extends GnssMultifileSolveInput {
  readonly result: GnssBaselineAdjustResult;
}

/**
 * Production input builder: everything through the composed adjust input
 * (mixed-source guard, single compose, BLOCKED throws, project control
 * overrides AFTER composition). Shared by the direct solve and the
 * production worker path (which posts the built input to the existing
 * 'gnss-run' route). No math lives here beyond the frozen composer.
 */
export const buildGnssMultifileAdjustInput = (
  files: readonly ProjectManifestFileEntry[],
  sourceTexts: Readonly<Record<string, string>>,
  options: GnssMultifileRunOptions = {},
): GnssMultifileSolveInput => {
  if (!isGnssMultifileEnabled()) {
    throw new Error('GNSS multifile run blocked: flag OFF (enable to run).');
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
  const summary = buildPrecompositionSummary(parsed, files.length, composed, {
    controlOverrides: options.controlOverrides,
    datumMode: options.datumMode ?? 'constrained',
  });
  if (summary.status === 'BLOCKED') {
    throw new Error(summary.blockingErrors[0] ?? 'compose blocked');
  }
  if (!composed?.composed) throw new Error(composed?.blockingErrors[0] ?? 'compose blocked');
  // Project-level control overrides AFTER composition (exact station ID; sources untouched).
  const stations = withControlOverrides(composed.composed.stations, options.controlOverrides);
  const setup = normalizeGnssSetupUncertainty(options.setup);
  const input: GnssBaselineAdjustInput = {
    stations,
    baselines: composed.composed.baselines.map((baseline) => ({ ...baseline })),
    referenceFrame: composed.composed.frame.referenceFrame,
    epoch: composed.composed.frame.epoch,
    ellipsoid: composed.composed.frame.ellipsoid,
    setupUncertainty: setup,
    // Phase 12I.1: datum classification happens here at adjust time, hence
    // AFTER composition + the control overrides above (never per-source).
    datumMode: options.datumMode ?? 'constrained',
    nativeRuntime: options.nativeRuntime,
  };
  return { parsed, summary, provenance: composed.provenance, mergeNotes: composed.mergeNotes, input };
};

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
  const built = buildGnssMultifileAdjustInput(files, sourceTexts, options);
  const { input } = built;
  // Phase 12I.1: the standalone preflight stays the early gate for
  // constrained runs; allow-free runs with >= 1 free component skip it
  // because datum classification lives in the adjust dispatch (the gauge
  // core still runs the full preflight — frames, covariances, audit — on
  // the anchored working copy, so no check is lost).
  const projectFreeComponents = input.datumMode === 'allow-free'
    ? classifyGnssDatumComponents(input.stations, input.baselines).freeComponents
    : [];
  if (projectFreeComponents.length === 0) {
    runGnssBaselinePreflight({
      stations: input.stations,
      baselines: input.baselines,
      referenceFrame: input.referenceFrame,
      epoch: input.epoch,
      ellipsoid: input.ellipsoid,
    });
  }
  const result = runGnssBaselineAdjustment(input);
  return { ...built, result };
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
    value.toLowerCase().startsWith('file://') ||
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

/**
 * Per-station source trace from the parsed (pre-composition) sources:
 * every station id maps to its declaring files + declared control, in
 * manifest order. Deterministic: station ids sorted, sources in order.
 * Control-stations-only CSV declarations (network null) are included so
 * control provenance survives.
 */
export const buildGnssProjectStationSourceTrace = (
  parsed: readonly GnssProjectParsedSource[],
): Record<string, Array<{ sourceId: string; fileName: string; control: 'FIXED' | 'FREE' }>> => {
  const trace: Record<string, Array<{ sourceId: string; fileName: string; control: 'FIXED' | 'FREE' }>> = {};
  parsed.forEach((entry) => {
    const declared = entry.network?.stations ?? entry.controlStations ?? null;
    if (!declared) return;
    Object.keys(declared)
      .sort()
      .forEach((id) => {
        const station = declared[id];
        if (!station) return;
        const control = station.fixedX && station.fixedY && station.fixedH ? 'FIXED' : 'FREE';
        trace[id] = [
          ...(trace[id] ?? []),
          { sourceId: entry.fileId, fileName: entry.fileName, control },
        ];
      });
  });
  return trace;
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
  const datumMode = raw.datumMode;
  return {
    version: 1,
    formatOverrides: { ...(raw.formatOverrides ?? {}) },
    controlOverrides: { ...(raw.controlOverrides ?? {}) },
    datumMode: datumMode === 'allow-free' ? 'allow-free' : 'constrained',
    setup: { ...(raw.setup ?? { horizontalCenteringSigma: 0, antennaHeightSigma: 0 }) },
    displayNames: { ...(raw.displayNames ?? {}) },
  };
};

/**
 * Report/export builders live in ./gnssMultifileExport (600-line hygiene
 * split); re-exported here so existing callers are untouched.
 */
export { buildGnssMultifileJsonExport, buildGnssMultifileProvenanceSection } from './gnssMultifileExport';
