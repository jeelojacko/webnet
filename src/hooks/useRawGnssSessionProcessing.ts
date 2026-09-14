import { useMemo, useRef, useState } from 'react';
import {
  buildSessionEdgeSpecs,
  buildProcessedSession,
  parseManualPairs,
  prepareAntexSubset,
  type OccupationEntry,
} from '../components/gnss/GnssRawSessionPanel.utils';
import { assignDependencyGroup } from '../engine/gnssRawSession';
import {
  createAntexSubsetCache,
  type GnssAntexSubsetResult,
} from '../engine/gnssAntexSubset';
import {
  resolveSessionAntennas,
  sessionIdentity,
  type SessionAntennaTable,
} from '../engine/gnssRawSessionModel';
import {
  reopenRawSession,
  type ProcessedRawGnssSession,
} from '../engine/gnssRawSessionExport';
import type { SessionGraph } from '../engine/gnssRawSessionGraph';
import type { RawGnssFileMetadata } from '../engine/gnssRawTypes';
import {
  type RawBaselineOptions,
  type RawFileEntry,
} from './useGnssRawBaseline';
import { useGnssRawSession, replaceSessionEdge } from './useGnssRawSession';

/**
 * Phase 12J.10 — run/repair/reimport state machine extracted from
 * GnssRawSessionPanel with zero behavior change.
 *
 * TOCTOU freeze: captured once at process-click, the ONLY source the
 * final session assembly and §27 single-edge reprocessing read. Later
 * intake/option/policy edits cannot leak into a running or settled run.
 */
export interface RunSnapshot {
  readonly sessionId: string;
  readonly occupations: OccupationEntry[];
  readonly markers: string[];
  readonly stationFiles: RawGnssFileMetadata[];
  readonly graph: SessionGraph;
  readonly options: RawBaselineOptions;
  readonly nav: RawFileEntry[];
  readonly sp3: RawFileEntry | null;
  readonly windowStart: string;
  readonly windowStop: string;
  readonly windowExplicit: boolean;
  readonly intervalResolved: number;
  readonly treePolicy: string;
  readonly base: string;
  readonly antennas: SessionAntennaTable;
  readonly obsSha256: string[];
  readonly navSha256: string[];
  readonly antex: GnssAntexSubsetResult | null;
}

/** Everything run() freezes; the ANTEX subset resolves inside (hook-owned). */
export interface RawSessionRunInput {
  readonly occupations: OccupationEntry[];
  readonly markers: string[];
  readonly stationFiles: RawGnssFileMetadata[];
  readonly graph: SessionGraph;
  readonly options: RawBaselineOptions;
  readonly nav: RawFileEntry[];
  readonly sp3: RawFileEntry | null;
  readonly windowStart: string;
  readonly windowStop: string;
  readonly windowExplicit: boolean;
  readonly intervalResolved: number;
  readonly treePolicy: string;
  readonly base: string;
  readonly antennas: SessionAntennaTable;
  readonly obsSha256: string[];
  readonly navSha256: string[];
}

export interface RawSessionAntexEntry extends RawFileEntry {
  readonly text: string;
}

export const useRawGnssSessionProcessing = () => {
  const [antexFile, setAntexFile] = useState<RawSessionAntexEntry | null>(null);
  const [antexLabel, setAntexLabel] = useState('');
  const [antexResult, setAntexResult] = useState<GnssAntexSubsetResult | null>(null);
  const [antexWarning, setAntexWarning] = useState<string | null>(null);
  const antexCache = useMemo(() => createAntexSubsetCache(), []);
  const [imported, setImported] = useState<ProcessedRawGnssSession | null>(null);
  const [reimportError, setReimportError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  // Launch race guard: set synchronously before the first await in run()
  // so a double-click cannot reach session.start() twice (pool.reset()
  // no-ops while active, then enqueue would throw Duplicate).
  const [preparing, setPreparing] = useState(false);
  const snapRef = useRef<RunSnapshot | null>(null);
  const [snapRev, setSnapRev] = useState(0);
  const [repairs, setRepairs] = useState<Readonly<Record<string, string>>>({});
  const [replaceText, setReplaceText] = useState<Readonly<Record<string, string>>>({});
  const [replaceError, setReplaceError] = useState<Readonly<Record<string, string | null>>>({});
  const session = useGnssRawSession(2);

  const settled = started && Object.values(session.snapshot).every(
    (s) => s !== 'queued' && s !== 'active',
  );
  const locked = (started && !settled) || preparing;
  // Final assembly reads ONLY the frozen snapshot — never live intake.
  const processed: ProcessedRawGnssSession | null = useMemo(() => {
    void snapRev;
    const snap = snapRef.current;
    if (!settled || !snap) return null;
    const edgeIds = snap.graph.edges.map((e) => `${e.from}->${e.to}`);
    const inGraph = new Set(edgeIds);
    const baselines = session.results.filter((b) => inGraph.has(`${b.from}->${b.to}`));
    const have = new Set(baselines.map((b) => `${b.from}->${b.to}`));
    return buildProcessedSession({
      graph: snap.graph, occupations: snap.occupations, markers: snap.markers,
      stationFiles: snap.stationFiles,
      baselines,
      options: snap.options, windowStart: snap.windowStart, windowStop: snap.windowStop,
      windowExplicit: snap.windowExplicit, intervalResolved: snap.intervalResolved,
      treePolicy: snap.treePolicy, antennaAssessment: snap.antennas, base: snap.base,
      obsSha256: snap.obsSha256, navSha256: snap.navSha256,
      sp3: snap.sp3, failedCount: edgeIds.filter((id) => !have.has(id)).length,
      antex: snap.antex,
    });
  }, [settled, snapRev, session.results]);
  const shown = imported ?? processed;

  const run = async (input: RawSessionRunInput): Promise<void> => {
    if (preparing) return;
    setPreparing(true);
    let antex: GnssAntexSubsetResult | null = null;
    if (antexFile) {
      const plan = await prepareAntexSubset({
        sourceText: antexFile.text,
        occupations: input.occupations,
        validAt: input.windowStart,
        cache: antexCache,
      });
      antex = plan.result;
      setAntexResult(plan.result);
      setAntexWarning(plan.warning);
    } else {
      setAntexResult(null);
      setAntexWarning(null);
    }
    // Freeze everything the run may read: later intake/option edits
    // cannot perturb the in-flight or settled session (TOCTOU).
    const snap: RunSnapshot = {
      sessionId: sessionIdentity(input.occupations),
      occupations: input.occupations.map((o) => ({
        ...o, bytes: o.bytes.slice(), meta: { ...o.meta },
      })),
      markers: input.markers,
      stationFiles: input.stationFiles,
      graph: { ...input.graph, markers: [...input.graph.markers], edges: [...input.graph.edges] },
      options: { ...input.options },
      nav: [...input.nav],
      sp3: input.sp3,
      windowStart: input.windowStart,
      windowStop: input.windowStop,
      windowExplicit: input.windowExplicit,
      intervalResolved: input.intervalResolved,
      treePolicy: input.treePolicy,
      base: input.base,
      antennas: input.antennas,
      obsSha256: input.obsSha256,
      navSha256: input.navSha256,
      antex,
    };
    snapRef.current = snap;
    setImported(null);
    setRepairs({});
    setReplaceText({});
    setReplaceError({});
    setStarted(true);
    try {
      session.start(snap.sessionId, buildSessionEdgeSpecs({
        graph: snap.graph, occupations: snap.occupations, nav: snap.nav, sp3: snap.sp3,
        options: snap.options, windowStart: snap.windowStart, windowStop: snap.windowStop,
        resolvedInterval: snap.intervalResolved, antex: snap.antex,
      }));
    } finally {
      // Preparation over: either locked (in-flight run) or released (throw).
      setPreparing(false);
    }
    setSnapRev((v) => v + 1);
  };

  /**
   * §27 repair: swap the failed leg for a caller-supplied pair, revalidate
   * (connected/N-1/acyclic via replaceSessionEdge), record provenance in
   * the frozen graph, and reprocess ONLY the new edge from the snapshot.
   */
  const replaceEdge = (edgeId: string, fallbackText: string): void => {
    const snap = snapRef.current;
    if (!snap || !settled) return;
    const cut = edgeId.indexOf('->');
    if (cut < 0) return;
    const from = edgeId.slice(0, cut);
    const to = edgeId.slice(cut + 2);
    const text = replaceText[edgeId] ?? fallbackText;
    const fail = (message: string): void =>
      setReplaceError((p) => ({ ...p, [edgeId]: message }));
    const pairs = parseManualPairs(text);
    if (pairs.length !== 1 || !pairs[0]) {
      fail('Enter one replacement pair as FROM->TO.');
      return;
    }
    const out = replaceSessionEdge(snap.graph, { from, to }, pairs[0]);
    if (!out.ok) {
      fail(out.errors.join('; '));
      return;
    }
    const specs = buildSessionEdgeSpecs({
      graph: out.graph, occupations: snap.occupations, nav: snap.nav, sp3: snap.sp3,
      options: snap.options, windowStart: snap.windowStart, windowStop: snap.windowStop,
      resolvedInterval: snap.intervalResolved, antex: snap.antex,
    });
    const spec = specs.find((s) => s.edgeId === `${pairs[0]!.from}->${pairs[0]!.to}`);
    if (!spec) {
      fail('Replacement endpoints match no staged occupation.');
      return;
    }
    // Commit real provenance on the repaired edge: the planned placeholder
    // carries empty hashes/marker-derived group, but the job (and the
    // exported dependencyGroups) use the true file SHAs — reconcile now.
    const patchedEdges = out.graph.edges.map((e) =>
      (e.from === pairs[0]!.from && e.to === pairs[0]!.to)
        ? {
          ...e,
          baseObsSha: spec.job.hashes.baseObsSha256,
          roverObsSha: spec.job.hashes.roverObsSha256,
          dependencyGroup: assignDependencyGroup({
            baseObsSha: spec.job.hashes.baseObsSha256,
            roverObsSha: spec.job.hashes.roverObsSha256,
          }),
        }
        : e,
    );
    const patchedGraph: SessionGraph = { ...out.graph, edges: patchedEdges };
    const antennasNext = resolveSessionAntennas(snap.occupations, patchedGraph.edges);
    if (!antennasNext) {
      fail('Antenna assessment failed for the repaired graph.');
      return;
    }
    try {
      session.requeue([spec]);
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
      return;
    }
    snapRef.current = { ...snap, graph: patchedGraph, antennas: antennasNext };
    session.forget(edgeId);
    setRepairs((p) => ({ ...p, [edgeId]: spec.edgeId }));
    setReplaceError((p) => ({ ...p, [edgeId]: null }));
    setSnapRev((v) => v + 1);
  };

  const reimport = async (file: File): Promise<void> => {
    setReimportError(null);
    try {
      setImported(reopenRawSession(await file.text()));
    } catch (e) {
      setReimportError(e instanceof Error ? e.message : String(e));
    }
  };

  const cancel = (): void => {
    session.cancel();
  };

  /** Clearing the source drops the staged subset + warning with it. */
  const clearAntex = (): void => {
    setAntexFile(null);
    setAntexResult(null);
    setAntexWarning(null);
  };

  const resetPool = (): void => {
    session.reset();
  };

  return {
    // ANTEX staging (hook-owned so run() freezes the resolved subset).
    antexFile, setAntexFile, antexLabel, setAntexLabel, antexResult, antexWarning,
    // Run state.
    imported, reimportError, started, preparing, settled, locked,
    repairs, replaceText, setReplaceText, replaceError,
    snapshot: session.snapshot,
    status: session.status,
    failed: session.failed,
    failedDetails: session.failedDetails,
    results: session.results,
    graph: snapRef.current?.graph ?? null,
    snapRev,
    processed, shown,
    // Actions.
    run, replaceEdge, reimport, cancel, resetPool, clearAntex,
  };
};

export type RawGnssSessionProcessing = ReturnType<typeof useRawGnssSessionProcessing>;
