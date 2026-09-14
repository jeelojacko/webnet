/**
 * Phase 12J.9 Track D — pure helpers for the raw session panel.
 *
 * Duration/coverage text, MANUAL leg parsing, per-edge worker-job specs,
 * and processed-session assembly. No React, no workers, no project state.
 */
import { assignDependencyGroup } from '../../engine/gnssRawSession';
import { sha256Hex } from '../../engine/gnssRawHash';
import {
  buildAntexSubset,
  storeAntexSubset,
  type GnssAntexSubsetCache,
  type GnssAntexSubsetResult,
} from '../../engine/gnssAntexSubset';
import { parseRinexObs } from '../../engine/gnssRinexHeader';
import type { SessionGraph } from '../../engine/gnssRawSessionGraph';
import {
  sessionIdentity,
  type RawOccupationMeta,
  type SessionAntennaTable,
} from '../../engine/gnssRawSessionModel';
import {
  buildRawSession,
  type ProcessedRawGnssSession,
} from '../../engine/gnssRawSessionExport';
import type { GnssRawRnx2rtkpJob } from '../../engine/gnssRawRnx2rtkp';
import type { RawGnssFileMetadata } from '../../engine/gnssRawTypes';
import type { RawBaselineOptions, RawFileEntry } from '../../hooks/useGnssRawBaseline';
import type { SessionEdgeSpec } from '../../hooks/useGnssRawSession';

export const durationText = (start: string | null, stop: string | null): string => {
  if (!start || !stop) return '—';
  const ms = Date.parse(stop) - Date.parse(start);
  return Number.isFinite(ms) && ms >= 0 ? `${Math.round(ms / 1000)} s` : '—';
};

export const coverageText = (
  start: string | null, stop: string | null, winStart: string, winStop: string,
): string => {
  if (!start || !stop) return '—';
  const a = Date.parse(start);
  const b = Date.parse(stop);
  const ws = Date.parse(winStart);
  const we = Date.parse(winStop);
  if (![a, b, ws, we].every(Number.isFinite) || b <= a) return '—';
  const overlap = Math.max(0, Math.min(b, we) - Math.max(a, ws));
  return `${Math.round((100 * overlap) / (b - a))}%`;
};

export const parseManualPairs = (text: string): Array<{ from: string; to: string }> =>
  text.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [from = '', to = ''] = line.split('>').map((s) => s.trim().replace(/-$/, ''));
    return { from, to };
  }).filter((p) => p.from !== '' && p.to !== '');

export type OccupationEntry = RawOccupationMeta & { fileName: string; bytes: Uint8Array };

const invalidMeta = (entry: RawFileEntry): RawGnssFileMetadata => ({
  role: 'ROVER', fileName: entry.fileName, sha256: entry.sha256,
  rinexVersion: null, marker: null, approxXyz: null, antennaModel: '',
  antennaHeight: null, antennaEast: null, antennaNorth: null,
  receiverModel: null, firstEpoch: null, lastEpoch: null,
  intervalSeconds: null, constellations: [], signals: [],
});

/** Header-parse every staged obs file; unparseable files get null-span metadata. */
export const parseOccupations = (entries: readonly RawFileEntry[]): OccupationEntry[] =>
  entries.map((entry) => {
    try {
      const parsed = parseRinexObs(entry.text);
      return {
        meta: {
          ...parsed.metadata, role: 'ROVER' as const, fileName: entry.fileName, sha256: entry.sha256,
        },
        epochCount: parsed.epochCount, fileName: entry.fileName, bytes: entry.bytes,
      };
    } catch {
      return { meta: invalidMeta(entry), epochCount: 0, fileName: entry.fileName, bytes: entry.bytes };
    }
  });

export const entryByMarker = (
  occupations: readonly OccupationEntry[], marker: string,
): OccupationEntry | null =>
  occupations.filter((o) => (o.meta.marker ?? o.fileName) === marker)
    .sort((a, b) => (a.meta.sha256 < b.meta.sha256 ? -1 : 1))[0] ?? null;

export interface EdgeSpecArgs {
  readonly graph: SessionGraph;
  readonly occupations: readonly OccupationEntry[];
  readonly nav: readonly RawFileEntry[];
  readonly sp3: RawFileEntry | null;
  readonly options: RawBaselineOptions;
  readonly windowStart: string;
  readonly windowStop: string;
  readonly resolvedInterval: number;
  /** Absent/null = legacy path (no antexSubset staged, byte-identical jobs). */
  readonly antex?: GnssAntexSubsetResult | null;
}

/** One worker job per planned tree leg; skips legs with missing endpoints. */
export const buildSessionEdgeSpecs = (args: EdgeSpecArgs): SessionEdgeSpec[] => {
  const specs: SessionEdgeSpec[] = [];
  for (const edge of args.graph.edges) {
    const a = entryByMarker(args.occupations, edge.from);
    const b = entryByMarker(args.occupations, edge.to);
    if (!a || !b) continue;
    const job: GnssRawRnx2rtkpJob = {
      baseObs: a.bytes,
      roverObs: b.bytes,
      nav: args.nav.map((e) => e.bytes),
      ...(args.sp3 ? { sp3: args.sp3.bytes } : {}),
      baseXyz: a.meta.approxXyz ?? [0, 0, 0],
      options: {
        elevationMaskDegrees: args.options.elevationMaskDegrees,
        intervalSeconds: args.options.intervalMode === 'AUTO' ? 'AUTO' : args.options.intervalSeconds,
        resolvedIntervalSeconds: args.resolvedInterval,
        windowStart: args.windowStart,
        windowStop: args.windowStop,
        precise: args.options.ephemeris === 'PRECISE',
        // One cached subset object shared by every edge; absent => legacy key shape.
        ...(args.antex ? {
          antexSubset: {
            bytes: args.antex.subsetBytes,
            sourceSha256: args.antex.sourceSha256,
            subsetSha256: args.antex.subsetSha256,
          },
        } : {}),
      },
      from: edge.from,
      to: edge.to,
      baseAntenna: {
        marker: edge.from, antennaModel: a.meta.antennaModel,
        height: a.meta.antennaHeight ?? 0, east: a.meta.antennaEast ?? 0, north: a.meta.antennaNorth ?? 0,
      },
      roverAntenna: {
        marker: edge.to, antennaModel: b.meta.antennaModel,
        height: b.meta.antennaHeight ?? 0, east: b.meta.antennaEast ?? 0, north: b.meta.antennaNorth ?? 0,
      },
      hashes: {
        baseObsSha256: a.meta.sha256, roverObsSha256: b.meta.sha256,
        navSha256: args.nav.map((e) => e.sha256), sp3Sha256: args.sp3 ? args.sp3.sha256 : null,
      },
    };
    specs.push({ edgeId: `${edge.from}->${edge.to}`, from: edge.from, to: edge.to, job });
  }
  return specs;
};

export interface ProcessedSessionArgs {
  readonly graph: SessionGraph;
  readonly occupations: readonly OccupationEntry[];
  readonly markers: readonly string[];
  readonly stationFiles: readonly RawGnssFileMetadata[];
  readonly baselines: ReturnType<typeof buildRawSession>['baselines'];
  readonly options: RawBaselineOptions;
  readonly windowStart: string;
  readonly windowStop: string;
  readonly windowExplicit: boolean;
  readonly intervalResolved: number | null;
  readonly treePolicy: string;
  readonly antennaAssessment: SessionAntennaTable;
  readonly base: string;
  readonly obsSha256: readonly string[];
  readonly navSha256: readonly string[];
  readonly sp3: RawFileEntry | null;
  readonly failedCount: number;
  /** Absent/null = legacy path (both ANTEX provenance hashes stay null). */
  readonly antex?: GnssAntexSubsetResult | null;
}

/** Normalized processed-session assembly (sorted by buildRawSession). */
export const buildProcessedSession = (
  args: ProcessedSessionArgs,
): ProcessedRawGnssSession | null => {
  if (args.baselines.length === 0) return null;
  const first = args.baselines[0]!.provenance;
  return buildRawSession({
    sessionId: sessionIdentity(args.occupations),
    stations: args.markers,
    commonWindow: { start: args.windowStart, stop: args.windowStop },
    options: {
      elevationMaskDegrees: args.options.elevationMaskDegrees,
      intervalRequested: args.options.intervalMode === 'AUTO' ? 'AUTO' : args.options.intervalSeconds,
      ephemerisRequested: args.options.ephemeris,
      windowStart: args.windowExplicit ? args.windowStart : null,
      windowStop: args.windowExplicit ? args.windowStop : null,
    },
    graph: args.graph,
    baselines: args.baselines,
    dependencyGroups: args.baselines.map((b) => ({
      edge: `${b.from}->${b.to}`,
      group: assignDependencyGroup({
        baseObsSha: b.provenance.baseObsSha256, roverObsSha: b.provenance.roverObsSha256,
      }),
    })),
    antennaAssessment: args.antennaAssessment,
    ephemerisAssessment: {
      requested: args.options.ephemeris,
      used: args.baselines.some((b) => b.provenance.ephemerisUsed === 'PRECISE') ? 'PRECISE' : 'BROADCAST',
      sp3Label: args.sp3 ? args.sp3.fileName : null,
    },
    stationFiles: args.stationFiles,
    status: args.failedCount > 0 ? 'PARTIAL' : 'COMPLETE',
    provenance: {
      obsSha256: args.obsSha256,
      navSha256: args.navSha256,
      sp3Sha256: args.sp3 ? args.sp3.sha256 : null,
      antexSourceSha256: args.antex ? args.antex.sourceSha256 : null,
      antexSubsetSha256: args.antex ? args.antex.subsetSha256 : null,
      processor: first.processor,
      optionsHash: first.optionsHash,
      treePolicy: args.treePolicy,
      base: args.base === '' ? (args.graph.edges[0]?.from ?? '') : args.base,
      windowStart: args.windowStart,
      windowStop: args.windowStop,
      intervalResolved: args.intervalResolved,
    },
  });
};

/**
 * Session-scope ANTEX staging. Collects the distinct receiver antenna
 * identities declared by the resolved occupations, builds one subset over
 * the common-window date, and canonicalizes it through the cache so every
 * edge shares a single object. Never throws: a missing identity (or
 * oversize subset) becomes a session-level ANTENNA CALIBRATION INCOMPLETE
 * warning and the affected baselines still process on the legacy path.
 */
export interface AntexSubsetPlan {
  readonly result: GnssAntexSubsetResult | null;
  readonly warning: string | null;
}

export const requiredAntennaSerials = (
  occupations: readonly OccupationEntry[],
): string[] => [...new Set(
  occupations
    .map((o) => o.meta.antennaModel.trim().split(/\s+/).join(' '))
    .filter((s) => s !== ''),
)].sort();

export const prepareAntexSubset = async (args: {
  readonly sourceText: string;
  readonly occupations: readonly OccupationEntry[];
  readonly validAt: string | null;
  readonly cache?: GnssAntexSubsetCache;
}): Promise<AntexSubsetPlan> => {
  const required = requiredAntennaSerials(args.occupations);
  // No declared identities => nothing to stage; stay on the legacy path.
  if (required.length === 0) return { result: null, warning: null };
  try {
    const built = await buildAntexSubset({
      sourceText: args.sourceText, requiredReceiverSerials: required, validAt: args.validAt,
    });
    return {
      result: args.cache ? storeAntexSubset(args.cache, built) : built,
      warning: null,
    };
  } catch (e) {
    return {
      result: null,
      warning: `ANTENNA CALIBRATION INCOMPLETE: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
};

/**
 * Fail-closed duplicate-marker gate: two staged obs files resolving to the
 * same marker would diverge planning (entryByMarker picks first-by-sha)
 * from processing, so intake blocks with both filenames named. Returns
 * the blocker message, or null when every marker maps to one file.
 */
export const duplicateMarkerBlocker = (
  occupations: readonly OccupationEntry[],
): string | null => {
  const byMarker = new Map<string, string[]>();
  for (const o of occupations) {
    const marker = o.meta.marker;
    if (!marker) continue;
    const list = byMarker.get(marker) ?? [];
    list.push(o.fileName);
    byMarker.set(marker, list);
  }
  for (const marker of [...byMarker.keys()].sort()) {
    const files = [...byMarker.get(marker)!].sort();
    if (files.length > 1) {
      return `Duplicate marker ${marker} in files ${files.join(', ')}: ` +
        'keep one file per station before processing.';
    }
  }
  return null;
};

/**
 * Deterministic §27 repair suggestion: union-find over the kept edges
 * (failed leg removed) splits the tree into two components; the
 * lexicographically first marker pair reconnecting them — oriented
 * min-first, excluding the failed pair itself — is the prefill. Null
 * when no alternative pair exists (e.g. a two-station session) or the
 * kept edges still connect the failed endpoints.
 */
export const suggestReplacementPair = (
  graph: SessionGraph,
  failedEdge: { readonly from: string; readonly to: string },
): { readonly from: string; readonly to: string } | null => {
  const kept = graph.edges.filter(
    (e) => !(e.from === failedEdge.from && e.to === failedEdge.to),
  );
  const parent = new Map(graph.markers.map((m) => [m, m] as const));
  const find = (m: string): string => {
    let r = m;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  for (const e of kept) {
    const ra = find(e.from);
    const rb = find(e.to);
    if (ra === rb) continue;
    if (ra < rb) parent.set(rb, ra);
    else parent.set(ra, rb);
  }
  const norm = (a: string, b: string): string => (a < b ? `${a}->${b}` : `${b}->${a}`);
  const failedNorm = norm(failedEdge.from, failedEdge.to);
  if (find(failedEdge.from) === find(failedEdge.to)) return null;
  const compF = find(failedEdge.from);
  const compT = find(failedEdge.to);
  let best: string | null = null;
  for (const m of graph.markers) {
    for (const n of graph.markers) {
      if (m >= n) continue;
      const label = `${m}->${n}`;
      if (label === failedNorm) continue;
      const cm = find(m);
      const cn = find(n);
      if ((cm === compF && cn === compT) || (cm === compT && cn === compF)) {
        if (best === null || label < best) best = label;
      }
    }
  }
  if (!best) return null;
  const [from = '', to = ''] = best.split('->');
  return { from, to };
};

/**
 * Session ANTEX slot bound (100 MiB), independent of the 32 MiB per-file
 * staging cap enforced by readFileEntry for obs/NAV/SP3 (unchanged) and
 * the ≤4 MiB ANTEX subset target (GNSS_ANTEX_SUBSET_MAX_BYTES): only the
 * extracted subset is ever staged into the worker, never the full upload.
 */
export const MAX_SESSION_ANTEX_BYTES = 100 * 1024 * 1024;

/** ANTEX-slot reader: same shape as readFileEntry, 100 MiB fail-closed cap. */
export const readSessionAntexEntry = async (file: File): Promise<RawFileEntry> => {
  if (file.size > MAX_SESSION_ANTEX_BYTES) {
    throw new Error(
      `ANTEX ${file.name} exceeds the 100 MiB session calibration cap (${file.size} bytes).`,
    );
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > MAX_SESSION_ANTEX_BYTES) {
    throw new Error(
      `ANTEX ${file.name} exceeds the 100 MiB session calibration cap (${bytes.byteLength} bytes).`,
    );
  }
  return {
    fileName: file.name,
    bytes,
    text: new TextDecoder().decode(bytes),
    sha256: await sha256Hex(bytes),
  };
};
