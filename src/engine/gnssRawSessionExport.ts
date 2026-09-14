/**
 * Phase 12J.9 Track C — deterministic session JSON contract (no math, no UI).
 *
 * A processed session is the set of per-edge ProcessedRawGnssBaseline
 * results plus the graph, window, options, and provenance that produced
 * them. Reopen is parse-only: it NEVER reprocesses. Per-baseline export
 * reuses buildRawBaselineExport so baseline semantics are never forked.
 *
 * Determinism: stations, baselines, groups, and hashes are sorted on
 * build; serialization uses stable key order. Reordered uploads give
 * identical semantic bytes (see sessionSemanticBytes); raw exported JSON
 * still carries two wall-clock marks — envelope `exportedAt` and
 * per-baseline `provenance.processedAt` — which are excluded from the
 * semantic comparison, never from the archive.
 */
import { buildRawBaselineExport, type RawBaselineExport } from './gnssRawExport';
import type { RawGnssProcessingOptions, RawGnssFileMetadata } from './gnssRawTypes';
import type { ProcessedRawGnssBaseline } from './gnssRawTypes';
import type { SessionAntennaTable } from './gnssRawSessionModel';
import type { SessionGraph } from './gnssRawSessionGraph';

export const RAW_SESSION_EXPORT_KIND = 'webnet-raw-static-session/1' as const;

export type RawSessionStatus = 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'CANCELLED';

export interface RawSessionDependencyGroup {
  readonly edge: string;
  readonly group: string;
}

export interface RawSessionEphemerisAssessment {
  readonly requested: 'BROADCAST' | 'PRECISE';
  readonly used: 'BROADCAST' | 'PRECISE';
  readonly sp3Label: string | null;
}

export interface RawSessionProvenance {
  readonly obsSha256: readonly string[];
  readonly navSha256: readonly string[];
  readonly sp3Sha256: string | null;
  readonly antexSourceSha256: string | null;
  readonly antexSubsetSha256: string | null;
  readonly processor: string;
  readonly optionsHash: string;
  readonly treePolicy: string;
  readonly base: string;
  readonly windowStart: string | null;
  readonly windowStop: string | null;
  readonly intervalResolved: number | null;
}

export interface ProcessedRawGnssSession {
  readonly sessionId: string;
  readonly stations: readonly string[];
  readonly commonWindow: { readonly start: string; readonly stop: string } | null;
  readonly options: RawGnssProcessingOptions;
  readonly graph: SessionGraph;
  readonly baselines: readonly ProcessedRawGnssBaseline[];
  readonly dependencyGroups: readonly RawSessionDependencyGroup[];
  readonly antennaAssessment: SessionAntennaTable;
  readonly ephemerisAssessment: RawSessionEphemerisAssessment;
  readonly stationFiles: readonly RawGnssFileMetadata[];
  readonly status: RawSessionStatus;
  readonly provenance: RawSessionProvenance;
}

export interface RawSessionExport {
  readonly kind: typeof RAW_SESSION_EXPORT_KIND;
  /** Nonsemantic wall-clock mark; excluded from identity comparisons. */
  readonly exportedAt: string;
  readonly session: ProcessedRawGnssSession;
}

const sorted = (values: readonly string[]): string[] => [...values].sort();

const edgeLabel = (from: string, to: string): string => `${from}->${to}`;

const stableClone = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableClone);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stableClone((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
};

export interface BuildRawSessionInput {
  readonly sessionId: string;
  readonly stations: readonly string[];
  readonly commonWindow: { readonly start: string; readonly stop: string } | null;
  readonly options: RawGnssProcessingOptions;
  readonly graph: SessionGraph;
  readonly baselines: readonly ProcessedRawGnssBaseline[];
  readonly dependencyGroups: readonly RawSessionDependencyGroup[];
  readonly antennaAssessment: SessionAntennaTable;
  readonly ephemerisAssessment: RawSessionEphemerisAssessment;
  readonly stationFiles: readonly RawGnssFileMetadata[];
  readonly status: RawSessionStatus;
  readonly provenance: RawSessionProvenance;
}

/** Normalized build: every list sorted, so upload order cannot leak in. */
export const buildRawSession = (input: BuildRawSessionInput): ProcessedRawGnssSession => ({
  sessionId: input.sessionId,
  stations: sorted(input.stations),
  commonWindow: input.commonWindow,
  options: input.options,
  graph: {
    ...input.graph,
    markers: sorted(input.graph.markers),
    edges: [...input.graph.edges].sort((a, b) =>
      edgeLabel(a.from, a.to) < edgeLabel(b.from, b.to) ? -1 : 1),
    provenance: [...input.graph.provenance].sort(),
  },
  baselines: [...input.baselines].sort((a, b) =>
    edgeLabel(a.from, a.to) < edgeLabel(b.from, b.to) ? -1 : 1),
  dependencyGroups: [...input.dependencyGroups].sort((a, b) => (a.edge < b.edge ? -1 : 1)),
  antennaAssessment: {
    ...input.antennaAssessment,
    stations: [...input.antennaAssessment.stations].sort((a, b) => (a.marker < b.marker ? -1 : 1)),
    baselineNotes: sorted(input.antennaAssessment.baselineNotes),
  },
  ephemerisAssessment: input.ephemerisAssessment,
  stationFiles: [...input.stationFiles].sort((a, b) => {
    const ma = a.marker ?? a.fileName;
    const mb = b.marker ?? b.fileName;
    return ma < mb ? -1 : 1;
  }),
  status: input.status,
  provenance: {
    ...input.provenance,
    obsSha256: sorted(input.provenance.obsSha256),
    navSha256: sorted(input.provenance.navSha256),
  },
});

export const buildRawSessionExport = (session: ProcessedRawGnssSession): RawSessionExport => ({
  kind: RAW_SESSION_EXPORT_KIND,
  exportedAt: new Date().toISOString(),
  session,
});

/** Deterministic bytes: stable key order, sorted lists. Semantic
 * comparison excludes the two wall-clock marks (envelope exportedAt and
 * per-baseline provenance.processedAt); see sessionSemanticBytes. */
export const serializeRawSessionExport = (doc: RawSessionExport): string =>
  JSON.stringify(stableClone(doc), null, 2);

/** Version-validated parse; throws fail-closed on kind drift or missing core. */
export const parseRawSessionExport = (text: string): RawSessionExport => {
  const doc = JSON.parse(text) as Partial<RawSessionExport>;
  if (doc.kind !== RAW_SESSION_EXPORT_KIND) {
    throw new Error(`Not a raw static-session export (kind ${String(doc.kind)}).`);
  }
  if (!doc.session || !doc.session.sessionId || !doc.session.baselines || !doc.session.provenance) {
    throw new Error('Raw static-session export is missing session/baselines/provenance.');
  }
  return doc as RawSessionExport;
};

/**
 * Reopen a stored session WITHOUT reprocessing: parse-only, returns the
 * recorded baselines verbatim. Any recompute must go through the pool.
 */
export const reopenRawSession = (text: string): ProcessedRawGnssSession =>
  parseRawSessionExport(text).session;

/** Semantic bytes: everything except nonsemantic wall-clock stamps.
 * exportedAt (envelope) and per-baseline provenance.processedAt are
 * redacted: both are run-time marks, never solution content. Solution
 * epoch start/stop stay semantic. */
export const sessionSemanticBytes = (doc: RawSessionExport): string =>
  JSON.stringify(stableClone({
    kind: doc.kind,
    session: {
      ...doc.session,
      baselines: doc.session.baselines.map((b) => ({
        ...b,
        provenance: { ...b.provenance, processedAt: '<processed-at>' },
      })),
    },
  }));

const stationFileFor = (
  session: ProcessedRawGnssSession,
  marker: string,
): RawGnssFileMetadata => {
  const found = session.stationFiles.find(
    (f) => (f.marker ?? f.fileName) === marker,
  );
  if (!found) throw new Error(`Session ${session.sessionId} has no file metadata for ${marker}.`);
  return found;
};

/**
 * Each baseline stays representable as webnet-raw-static-baseline/1 via
 * the single-baseline builder — no forked semantics.
 */
export const sessionBaselineDoc = (
  session: ProcessedRawGnssSession,
  from: string,
  to: string,
): RawBaselineExport => {
  const baseline = session.baselines.find((b) => b.from === from && b.to === to);
  if (!baseline) throw new Error(`Session ${session.sessionId} has no baseline ${from}->${to}.`);
  return buildRawBaselineExport(
    stationFileFor(session, from),
    stationFileFor(session, to),
    session.options,
    baseline,
  );
};

export const sessionBaselineDocs = (session: ProcessedRawGnssSession): RawBaselineExport[] =>
  session.baselines.map((b) => sessionBaselineDoc(session, b.from, b.to));
