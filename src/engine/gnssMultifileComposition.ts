/**
 * Phase 12H.1 — production multi-file static-GNSS composer (frozen H.0 semantics).
 *
 * Post-parse merge of independently-parsed canonical networks. No math,
 * no transforms, no averaging, no dedup: every baseline retained.
 * Datum preflight stays downstream AFTER composition.
 */
import type { StationMap } from '../types';
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import type { GnssBaselineNetworkInput } from './gnssBaselineNetworkImport';
import { isGnssMultifileEnabled } from './gnssMultifileFlag';
import {
  classifyGnssDuplicates,
  type GnssDuplicateCandidate,
} from './gnssMultifileDuplicates';

export type GnssMultifileFormat = 'native' | 'gvx' | 'delimited' | 'sample' | 'unknown';

export interface GnssMultifileSource {
  readonly network: GnssBaselineNetworkInput;
  readonly sourceId: string;
  readonly fileName: string;
  readonly format: GnssMultifileFormat;
  readonly session?: string;
  readonly solution?: string;
}

export interface GnssMultifileProvenance {
  readonly sourceId: string;
  readonly fileName: string;
  readonly format: GnssMultifileFormat;
  readonly originalId: number;
  readonly index: number;
}

export interface GnssMultifileSourceDiagnostic {
  readonly sourceId: string;
  readonly fileName: string;
  readonly format: GnssMultifileFormat;
  readonly stations: number;
  readonly baselines: number;
  readonly referenceFrame: string;
  readonly epoch: string;
  readonly ellipsoid: string;
}

export interface GnssMultifileSummary {
  readonly sources: number;
  readonly stations: number;
  readonly baselines: number;
  readonly fixedStations: number;
  readonly freeStations: number;
  readonly mergeNotes: number;
  readonly duplicateCandidates: number;
}

/** Fixed H.0 rounding contract: sub-tolerance diffs accepted, never averaged. */
export const GNSS_MULTIFILE_ROUND_TOL_M = 1e-9;

const UNKNOWN = 'unknown';
const tag = (value: string | undefined): string =>
  (value ?? '').trim() === '' ? UNKNOWN : (value as string);

export interface GnssMultifileResult {
  readonly blockingErrors: string[];
  readonly composed: GnssBaselineNetworkInput | null;
  readonly provenance: GnssMultifileProvenance[];
  readonly stationSources: Record<string, string[]>;
  readonly mergeNotes: string[];
  readonly sourceDiagnostics: GnssMultifileSourceDiagnostic[];
  readonly duplicateCandidates: GnssDuplicateCandidate[];
  readonly summary: GnssMultifileSummary;
}

const emptySummary = (): GnssMultifileSummary => ({
  sources: 0,
  stations: 0,
  baselines: 0,
  fixedStations: 0,
  freeStations: 0,
  mergeNotes: 0,
  duplicateCandidates: 0,
});

const isFullyFixedStation = (stationId: string, stations: StationMap): boolean => {
  const station = stations[stationId];
  return !!station && !!station.fixedX && !!station.fixedY && !!station.fixedH;
};

/** Fail-closed frame/epoch/ellipsoid agreement check (names both sides). */
const checkFrameAgreement = (sources: readonly GnssMultifileSource[]): string[] => {
  const errors: string[] = [];
  const first = sources[0]!.network.frame;
  const firstRef = tag(first.referenceFrame);
  const firstEpoch = tag(first.epoch);
  const firstEllipsoid = tag(first.ellipsoid);
  sources.forEach((source) => {
    const frame = source.network.frame;
    const ref = tag(frame.referenceFrame);
    const epoch = tag(frame.epoch);
    const ellipsoid = tag(frame.ellipsoid);
    if (ref !== firstRef) {
      errors.push(
        `compose blocked: referenceFrame mismatch (${source.sourceId} '${source.fileName}'='${ref}' vs ${sources[0]!.sourceId} '${sources[0]!.fileName}'='${firstRef}').`,
      );
    }
    if (epoch !== firstEpoch) {
      errors.push(
        `compose blocked: epoch mismatch (${source.sourceId} '${source.fileName}'='${epoch}' vs ${sources[0]!.sourceId} '${sources[0]!.fileName}'='${firstEpoch}').`,
      );
    }
    if (ellipsoid !== firstEllipsoid) {
      errors.push(
        `compose blocked: ellipsoid mismatch (${source.sourceId} '${source.fileName}'='${ellipsoid}' vs ${sources[0]!.sourceId} '${sources[0]!.fileName}'='${firstEllipsoid}').`,
      );
    }
  });
  return errors;
};

/** Per-source station/baseline counts plus agreed frame strings. */
const describeSources = (sources: readonly GnssMultifileSource[]): GnssMultifileSourceDiagnostic[] =>
  sources.map((source) => ({
    sourceId: source.sourceId,
    fileName: source.fileName,
    format: source.format,
    stations: Object.keys(source.network.stations).length,
    baselines: source.network.baselines.length,
    referenceFrame: tag(source.network.frame.referenceFrame),
    epoch: tag(source.network.frame.epoch),
    ellipsoid: tag(source.network.frame.ellipsoid),
  }));

interface MergedStations {
  readonly stations: StationMap;
  readonly stationSources: Record<string, string[]>;
  readonly mergeNotes: string[];
  readonly blockingErrors: string[];
}

/**
 * Station merge phase: first-seen wins, sub-tolerance diffs accepted with
 * a note, material conflicts fail closed naming the actual first
 * contributor (from stationSources) versus the conflicting source.
 */
const mergeMultifileStations = (sources: readonly GnssMultifileSource[]): MergedStations => {
  const stations: StationMap = {};
  const stationSources: Record<string, string[]> = {};
  const mergeNotes: string[] = [];
  const blockingErrors: string[] = [];
  const fileNameOf = (sourceId: string): string =>
    sources.find((source) => source.sourceId === sourceId)?.fileName ?? sourceId;
  sources.forEach((source) => {
    Object.entries(source.network.stations).forEach(([id, station]) => {
      if (!station) return;
      const prior = stations[id];
      const contributors = stationSources[id] ?? [];
      if (!contributors.includes(source.sourceId)) contributors.push(source.sourceId);
      stationSources[id] = contributors;
      if (!prior) {
        stations[id] = { ...station };
        return;
      }
      const worst = Math.max(
        Math.abs(prior.x - station.x),
        Math.abs(prior.y - station.y),
        Math.abs(prior.h - station.h),
      );
      if (worst > GNSS_MULTIFILE_ROUND_TOL_M) {
        const firstId = contributors[0] ?? sources[0]!.sourceId;
        blockingErrors.push(
          `compose blocked: material station conflict '${id}' ` +
            `(${firstId} '${fileNameOf(firstId)}' vs ${source.sourceId} '${source.fileName}', diff=${worst} m).`,
        );
        return;
      }
      if (worst > 0) {
        mergeNotes.push(`rounding diff accepted for '${id}' diff=${worst}`);
      }
      // Control merge: order never decides; FIXED wins with provenance note.
      const priorFixed = !!(prior.fixedX && prior.fixedY && prior.fixedH);
      const nextFixed = !!(station.fixedX && station.fixedY && station.fixedH);
      if (priorFixed || nextFixed) {
        if (priorFixed !== nextFixed) {
          mergeNotes.push(`fixed+free => fixed for '${id}' from ${source.sourceId}`);
        }
        stations[id] = { ...prior, fixed: true, fixedX: true, fixedY: true, fixedH: true };
        return;
      }
      stations[id] = { ...prior };
    });
  });
  return { stations, stationSources, mergeNotes, blockingErrors };
};

/** Baseline assembly phase: retain every baseline, renumber, record provenance. */
const assembleComposedBaselines = (sources: readonly GnssMultifileSource[]): {
  readonly baselines: GnssBaselineObservation[];
  readonly provenance: GnssMultifileProvenance[];
} => {
  const baselines: GnssBaselineObservation[] = [];
  const provenance: GnssMultifileProvenance[] = [];
  sources.forEach((source) => {
    source.network.baselines.forEach((baseline, index) => {
      const id = baselines.length + 1;
      baselines.push({ ...baseline, id });
      provenance.push({
        sourceId: source.sourceId,
        fileName: source.fileName,
        format: source.format,
        originalId: baseline.id,
        index,
      });
    });
  });
  return { baselines, provenance };
};

/**
 * Compose ordered canonical sources. Fail-closed: the flag gate throws
 * when OFF; any frame/epoch/ellipsoid mismatch or material
 * station conflict yields blockingErrors with composed=null. Never throws
 * for composition problems (empty input throws: caller contract violation).
 */
export const composeGnssBaselineNetworks = (
  sources: readonly GnssMultifileSource[],
): GnssMultifileResult => {
  if (!isGnssMultifileEnabled()) {
    throw new Error('GNSS multifile composition blocked: flag OFF (enable to run).');
  }
  if (sources.length === 0) throw new Error('compose: no sources');
  const blockingErrors: string[] = checkFrameAgreement(sources);
  const sourceDiagnostics = describeSources(sources);
  if (blockingErrors.length > 0) {
    return {
      blockingErrors,
      composed: null,
      provenance: [],
      stationSources: {},
      mergeNotes: [],
      sourceDiagnostics,
      duplicateCandidates: [],
      summary: { ...emptySummary(), sources: sources.length },
    };
  }
  const merged = mergeMultifileStations(sources);
  if (merged.blockingErrors.length > 0) {
    return {
      blockingErrors: merged.blockingErrors,
      composed: null,
      provenance: [],
      stationSources: merged.stationSources,
      mergeNotes: merged.mergeNotes,
      sourceDiagnostics,
      duplicateCandidates: [],
      summary: { ...emptySummary(), sources: sources.length },
    };
  }
  const { baselines, provenance } = assembleComposedBaselines(sources);
  const duplicateCandidates = classifyGnssDuplicates(baselines, provenance);
  const stationIds = Object.keys(merged.stations).sort();
  const fixedStations = stationIds.filter((id) => isFullyFixedStation(id, merged.stations)).length;
  const first = sources[0]!.network;
  const composed: GnssBaselineNetworkInput = {
    stations: merged.stations,
    baselines,
    frame: { ...first.frame },
    inputUnits: first.inputUnits,
    // Per-baseline import traces do not survive renumbering: the
    // multifile provenance array (sourceId/originalId/index) is the
    // origin record. Never fabricate per-baseline import lines here.
    provenance: [],
    sourceFile: sources.map((source) => source.fileName).join('+'),
  };
  return {
    blockingErrors: [],
    composed,
    provenance,
    stationSources: merged.stationSources,
    mergeNotes: merged.mergeNotes,
    sourceDiagnostics,
    duplicateCandidates,
    summary: {
      sources: sources.length,
      stations: stationIds.length,
      baselines: baselines.length,
      fixedStations,
      freeStations: stationIds.length - fixedStations,
      mergeNotes: merged.mergeNotes.length,
      duplicateCandidates: duplicateCandidates.length,
    },
  };
};
