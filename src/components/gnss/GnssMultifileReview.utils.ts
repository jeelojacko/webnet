/**
 * Phase 13F B2 — multifile review pure helpers (no math, no JSX).
 *
 * Review/display over the frozen composer output: baseline->source mapping,
 * per-station source trace, and the concise multi-file export block
 * (no full file dump). Used by GnssMultifileReview (component) and the
 * shared GnssResultsPanel export paths.
 */
import type { GnssMultifileProvenance } from '../../engine/gnssMultifileComposition';
import type { GnssProjectParsedSource } from '../../engine/gnssMultifileProject';

export interface GnssReviewSource {
  readonly id: string;
  readonly name: string;
  readonly hash: string;
  readonly order: number;
}

export interface GnssStationDeclaration {
  readonly sourceId: string;
  readonly fileName: string;
  readonly control: 'FIXED' | 'FREE';
}

export interface GnssMultifileReviewInfo {
  readonly projectName: string;
  readonly datumMode: string;
  readonly enabledSources: GnssReviewSource[];
  readonly warnings: string[];
  readonly mergeNotes: string[];
  readonly controlBySource: string[];
  readonly provenance: GnssMultifileProvenance[];
  readonly stationTrace: Record<string, GnssStationDeclaration[]>;
  readonly composedControl: Record<string, 'FIXED' | 'FREE'>;
}

/** Composed baseline id (1-based renumber) -> contributing source id. */
export const sourceOfBaseline = (
  provenance: readonly GnssMultifileProvenance[],
  baselineId: number,
): string | undefined => provenance[baselineId - 1]?.sourceId;

/**
 * Per-station source trace from the parsed (pre-composition) sources:
 * every station id maps to its declaring files + declared control, in
 * manifest order. Deterministic: station ids sorted, sources in order.
 */
export const buildStationSourceTrace = (
  parsed: readonly GnssProjectParsedSource[],
): Record<string, GnssStationDeclaration[]> => {
  const trace: Record<string, GnssStationDeclaration[]> = {};
  parsed.forEach((entry) => {
    if (!entry.network) return;
    Object.keys(entry.network.stations)
      .sort()
      .forEach((id) => {
        const station = entry.network?.stations[id];
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

/**
 * Concise multi-file export block: project name, enabled sources with
 * hashes in manifest order, composition warnings, datum mode. Provenance
 * detail stays in the provenance section; file contents are never dumped.
 */
export const buildGnssMultifileExportLines = (review: GnssMultifileReviewInfo): string[] => {
  const lines = [
    '',
    'MULTIFILE PROJECT',
    `project: ${review.projectName}`,
    `datum mode: ${review.datumMode}`,
    `enabled sources (${review.enabledSources.length}):`,
    ...[...review.enabledSources]
      .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((source) => `  [${source.order}] '${source.name}' [${source.id}] sha=${source.hash}`),
    ...(review.controlBySource.length > 0
      ? [`control: ${review.controlBySource.join('; ')}`]
      : []),
    ...(review.mergeNotes.length > 0
      ? ['composition notes:', ...review.mergeNotes.map((note) => `  ${note}`)]
      : []),
    ...(review.warnings.length > 0
      ? ['composition warnings:', ...review.warnings.map((warning) => `  ${warning}`)]
      : []),
  ];
  return lines;
};

/** Concise JSON-side multifile block (mirrors the text block, no contents). */
export const buildGnssMultifileExportJson = (
  review: GnssMultifileReviewInfo,
): Record<string, unknown> => ({
  projectName: review.projectName,
  datumMode: review.datumMode,
  enabledSources: [...review.enabledSources]
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((source) => ({ id: source.id, name: source.name, hash: source.hash, order: source.order })),
  controlBySource: [...review.controlBySource],
  mergeNotes: [...review.mergeNotes],
  warnings: [...review.warnings],
});
