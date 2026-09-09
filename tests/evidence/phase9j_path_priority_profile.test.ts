/**
 * Phase 9J path-priority profile (EVIDENCE ONLY, manual).
 *
 * Profile-first pass for buildPathPrioritySummary on the exact camp
 * fixture: exact internal counters/timers per phase (graph, station
 * majors, adjacency, anchors, frontier push/pop/sort, final
 * diagnostics, ordering, prioritized pairs, weak cues, edges.find and
 * pair-key calls), reported for the base result plus each alt result.
 *
 * Test-only counted mirror: the mirror replicates
 * src/engine/preanalysisPathPriority.ts instrumented with counters,
 * and every mirrored build is asserted deep-equal to the actual
 * production build (parity assertion fails loudly on drift, so the
 * counters always describe current production logic). No production
 * changes. Timings recorded only, never gated. No optimizations.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';

import type { AdjustmentResult } from '../../src/types';
import type {
  PreanalysisAddedSetPairRef,
  StationId,
  StationMap,
  WeakGeometrySeverity,
} from '../../src/types';
import type {
  PathGraphEdge,
  PathPrioritySummary,
  StationPathDiagnostics,
} from '../../src/engine/preanalysisPathPriority';

vi.mock('../../src/engine/preanalysisPathPriority', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/engine/preanalysisPathPriority')>();
  return {
    ...actual,
    buildPathPrioritySummary: (result: AdjustmentResult) => {
      const counter = globalThis as { __phase9jSummaryBuilds?: number };
      counter.__phase9jSummaryBuilds = (counter.__phase9jSummaryBuilds ?? 0) + 1;
      return actual.buildPathPrioritySummary(result);
    },
  };
});

const { buildPathPrioritySummary, stationFixedRank } = await import(
  '../../src/engine/preanalysisPathPriority'
);
const {
  buildPreanalysisPlanningDiagnostics,
  buildPreanalysisSyntheticSetTemplates,
  resolveAppliedPreanalysisActionState,
} = await import('../../src/engine/preanalysisPlanning');
const { resolveCandidateTemplates } = await import(
  '../../src/engine/preanalysisPlanningRecommendations'
);
const { runAdjustmentSession } = await import('../../src/engine/runSession');
const { createRunSessionRequest } = await import('../helpers/runSessionRequest');

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

const summaryBuilds = (): number =>
  (globalThis as { __phase9jSummaryBuilds?: number }).__phase9jSummaryBuilds ?? 0;
const resetSummaryBuilds = (): void => {
  (globalThis as { __phase9jSummaryBuilds?: number }).__phase9jSummaryBuilds = 0;
};

/** Per-build counters, reset for every mirrored build. */
type MirrorCounters = {
  pairKeyCalls: number;
  edgesFindCalls: number;
  mapGets: number;
  mapBuildKeys: number;
  frontierPush: number;
  frontierPop: number;
  frontierSorts: number;
  frontierTotalSorted: number;
  frontierMax: number;
  frontierSizes: number[];
};

type MirrorTimings = {
  graphMs: number;
  stationMajorsMs: number;
  adjacencyMs: number;
  anchorsMs: number;
  frontierMs: number;
  finalDiagnosticsMs: number;
  orderingMs: number;
  prioritizedPairsMs: number;
  weakCueMs: number;
  totalMs: number;
};

const now = (): number => performance.now();

const medianOf = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/**
 * Instrumented replica of buildPathPrioritySummary internals, in two arms:
 * legacy (per-pair linear edges.find, per-pair worst-pair keys — the exact
 * pre-9J production logic) and optimized (keyed edge-metric map, hoisted
 * worst-pair key — the current production logic). Both arms assert
 * structural parity with production per build, so the legacy arm proves
 * the optimization preserved semantics while the counters/timings compare
 * before vs after. Test-only; production is untouched.
 */
type MirrorMode = 'legacy' | 'optimized';
const mirrorBuildPathPrioritySummary = (
  base: AdjustmentResult,
  mode: MirrorMode,
): {
  summary: PathPrioritySummary;
  counters: MirrorCounters;
  timings: MirrorTimings;
  structure: {
    builtEdgeCount: number;
    adjacencyNodes: number;
    adjacencyEdgeRefs: number;
    anchorCount: number;
    fallbackAnchorCount: number;
    usedFallbackAnchors: boolean;
    prioritizedPairIterations: number;
    weakCueCount: number;
    weakCueAdded: number;
  };
} => {
  const counters: MirrorCounters = {
    pairKeyCalls: 0,
    edgesFindCalls: 0,
    mapGets: 0,
    mapBuildKeys: 0,
    frontierPush: 0,
    frontierPop: 0,
    frontierSorts: 0,
    frontierTotalSorted: 0,
    frontierMax: 0,
    frontierSizes: [],
  };
  const timings = {
    graphMs: 0,
    stationMajorsMs: 0,
    adjacencyMs: 0,
    anchorsMs: 0,
    frontierMs: 0,
    finalDiagnosticsMs: 0,
    orderingMs: 0,
    prioritizedPairsMs: 0,
    weakCueMs: 0,
    totalMs: 0,
  };
  const totalStartedAt = now();

  const severityWeight = (severity: WeakGeometrySeverity): number =>
    severity === 'weak' ? 2 : severity === 'watch' ? 1 : 0;
  const sortStationIds = (left: StationId, right: StationId): number =>
    left.localeCompare(right, undefined, { numeric: true });
  // Legacy arm keeps the array-sort construction; optimized arm uses the
  // direct two-element ordering (current production). Call counts stay
  // comparable; the win is the removed per-key array allocation.
  const buildPairKey = (from: StationId, to: StationId): string => {
    counters.pairKeyCalls += 1;
    if (mode === 'optimized') {
      return sortStationIds(from, to) <= 0 ? `${from}|${to}` : `${to}|${from}`;
    }
    return [from, to].sort(sortStationIds).join('|');
  };
  const compareStationIdArrays = (left: StationId[], right: StationId[]): number => {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const cmp = sortStationIds(left[index]!, right[index]!);
      if (cmp !== 0) return cmp;
    }
    return left.length - right.length;
  };
  const stationMajorById = (res: AdjustmentResult): Map<StationId, number> =>
    new Map(
      (res.stationCovariances ?? []).map((row) => [
        row.stationId,
        row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
      ]),
    );
  const resolveRelativeMetric = (
    row: NonNullable<AdjustmentResult['relativeCovariances']>[number] | undefined,
    fallback = Number.NaN,
  ): number =>
    row != null
      ? row.sigmaDist ?? row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN)
      : fallback;

  let startedAt = now();
  const majorsForGraph = stationMajorById(base);
  const edges = new Map<string, PathGraphEdge>();
  (base.relativeCovariances ?? []).forEach((row) => {
    const metric = resolveRelativeMetric(row);
    if (!Number.isFinite(metric) || metric <= 0) return;
    const key = buildPairKey(row.from, row.to);
    edges.set(key, { from: row.from, to: row.to, metric });
  });
  (base.observations ?? []).forEach((obs) => {
    const from = 'at' in obs ? obs.at : 'from' in obs ? obs.from : undefined;
    const to = 'to' in obs ? obs.to : undefined;
    if (!from || !to) return;
    const key = buildPairKey(from, to);
    if (edges.has(key)) return;
    const fromMajor = majorsForGraph.get(from);
    const toMajor = majorsForGraph.get(to);
    const metricCandidates = [fromMajor, toMajor].filter(
      (value): value is number => Number.isFinite(value),
    );
    const metric =
      metricCandidates.length > 0 ? Math.max(...metricCandidates) : Number.NaN;
    if (!Number.isFinite(metric) || metric <= 0) return;
    edges.set(key, { from, to, metric });
  });
  const edgeList = [...edges.values()];
  timings.graphMs = now() - startedAt;

  startedAt = now();
  const stationMajorsById = stationMajorById(base);
  timings.stationMajorsMs = now() - startedAt;

  startedAt = now();
  const adjacency = new Map<StationId, PathGraphEdge[]>();
  edgeList.forEach((edge) => {
    const fromList = adjacency.get(edge.from) ?? [];
    const toList = adjacency.get(edge.to) ?? [];
    fromList.push(edge);
    toList.push(edge);
    adjacency.set(edge.from, fromList);
    adjacency.set(edge.to, toList);
  });
  const adjacencyEdgeRefs = [...adjacency.values()].reduce(
    (total, list) => total + list.length,
    0,
  );
  timings.adjacencyMs = now() - startedAt;

  startedAt = now();
  const anchors = Object.entries(base.stations)
    .filter(([, station]) => stationFixedRank(station) === 2)
    .map(([stationId]) => stationId)
    .sort(sortStationIds);
  const fallbackAnchors =
    anchors.length > 0
      ? anchors
      : Object.entries(base.stations)
          .filter(([, station]) => stationFixedRank(station) === 1)
          .map(([stationId]) => stationId)
          .sort(sortStationIds);
  timings.anchorsMs = now() - startedAt;

  type FrontierNode = {
    stationId: StationId;
    anchorStationId: StationId;
    pathWorstEdgeMetric: number;
    pathTotalMetric: number;
    hopCount: number;
    pathStationIds: StationId[];
    pathPairRefs: PreanalysisAddedSetPairRef[];
  };
  const comparePathCandidates = (
    current: StationPathDiagnostics | undefined,
    next: StationPathDiagnostics,
  ): number => {
    if (!current) return 1;
    const currentWorst = current.pathWorstEdgeMetric ?? Number.POSITIVE_INFINITY;
    const nextWorst = next.pathWorstEdgeMetric ?? Number.POSITIVE_INFINITY;
    if (nextWorst !== currentWorst) return currentWorst - nextWorst;
    const currentTotal = current.pathTotalMetric ?? Number.POSITIVE_INFINITY;
    const nextTotal = next.pathTotalMetric ?? Number.POSITIVE_INFINITY;
    if (nextTotal !== currentTotal) return currentTotal - nextTotal;
    if (next.anchorPathPairRefs.length !== current.anchorPathPairRefs.length) {
      return current.anchorPathPairRefs.length - next.anchorPathPairRefs.length;
    }
    const pathCmp = compareStationIdArrays(
      current.anchorPathStationIds,
      next.anchorPathStationIds,
    );
    if (pathCmp !== 0) return pathCmp;
    return current.anchorStationId != null && next.anchorStationId != null
      ? sortStationIds(current.anchorStationId, next.anchorStationId)
      : 0;
  };

  startedAt = now();
  const frontier: FrontierNode[] = fallbackAnchors.map((anchorId) => ({
    stationId: anchorId,
    anchorStationId: anchorId,
    pathWorstEdgeMetric: 0,
    pathTotalMetric: 0,
    hopCount: 0,
    pathStationIds: [anchorId],
    pathPairRefs: [],
  }));
  counters.frontierPush += frontier.length;
  counters.frontierMax = Math.max(counters.frontierMax, frontier.length);
  const bestByStation = new Map<StationId, FrontierNode>();
  while (frontier.length > 0) {
    counters.frontierSizes.push(frontier.length);
    counters.frontierTotalSorted += frontier.length;
    counters.frontierSorts += 1;
    counters.frontierMax = Math.max(counters.frontierMax, frontier.length);
    frontier.sort((left, right) => {
      if (left.pathWorstEdgeMetric !== right.pathWorstEdgeMetric) {
        return left.pathWorstEdgeMetric - right.pathWorstEdgeMetric;
      }
      if (left.pathTotalMetric !== right.pathTotalMetric) {
        return left.pathTotalMetric - right.pathTotalMetric;
      }
      if (left.hopCount !== right.hopCount) return left.hopCount - right.hopCount;
      const pathCmp = compareStationIdArrays(left.pathStationIds, right.pathStationIds);
      if (pathCmp !== 0) return pathCmp;
      return sortStationIds(left.anchorStationId, right.anchorStationId);
    });
    const current = frontier.shift()!;
    counters.frontierPop += 1;
    const known = bestByStation.get(current.stationId);
    if (known) {
      const currentKey: StationPathDiagnostics = {
        stationId: current.stationId,
        anchorStationId: current.anchorStationId,
        anchorPathStationIds: current.pathStationIds,
        anchorPathPairRefs: current.pathPairRefs,
        pathWorstEdgeMetric: current.pathWorstEdgeMetric,
        pathTotalMetric: current.pathTotalMetric,
        stationMajor: stationMajorsById.get(current.stationId),
        fixedRank: stationFixedRank(base.stations[current.stationId]),
      };
      const knownKey: StationPathDiagnostics = {
        stationId: known.stationId,
        anchorStationId: known.anchorStationId,
        anchorPathStationIds: known.pathStationIds,
        anchorPathPairRefs: known.pathPairRefs,
        pathWorstEdgeMetric: known.pathWorstEdgeMetric,
        pathTotalMetric: known.pathTotalMetric,
        stationMajor: stationMajorsById.get(known.stationId),
        fixedRank: stationFixedRank(base.stations[known.stationId]),
      };
      if (comparePathCandidates(knownKey, currentKey) <= 0) continue;
    }
    bestByStation.set(current.stationId, current);
    (adjacency.get(current.stationId) ?? []).forEach((edge) => {
      const nextStationId = edge.from === current.stationId ? edge.to : edge.from;
      if (current.pathStationIds.includes(nextStationId)) return;
      frontier.push({
        stationId: nextStationId,
        anchorStationId: current.anchorStationId,
        pathWorstEdgeMetric: Math.max(current.pathWorstEdgeMetric, edge.metric),
        pathTotalMetric: current.pathTotalMetric + edge.metric,
        hopCount: current.hopCount + 1,
        pathStationIds: [...current.pathStationIds, nextStationId],
        pathPairRefs: [...current.pathPairRefs, { from: current.stationId, to: nextStationId }],
      });
      counters.frontierPush += 1;
    });
  }
  timings.frontierMs = now() - startedAt;

  const edgeMetricByKey =
    mode === 'optimized'
      ? new Map(edgeList.map((edge) => [buildPairKey(edge.from, edge.to), edge.metric]))
      : undefined;
  if (edgeMetricByKey) counters.mapBuildKeys += edgeMetricByKey.size;

  startedAt = now();
  const diagnostics = new Map<StationId, StationPathDiagnostics>();
  const stationEntries = Object.entries(base.stations) as Array<
    [StationId, StationMap[StationId]]
  >;
  stationEntries.forEach(([stationId, station]) => {
    const best = bestByStation.get(stationId);
    const fixedRank = stationFixedRank(station);
    const pathPairMetrics = (best?.pathPairRefs ?? []).map((pair) => {
      if (edgeMetricByKey) {
        counters.mapGets += 1;
        return edgeMetricByKey.get(buildPairKey(pair.from, pair.to)) ?? 0;
      }
      counters.edgesFindCalls += 1;
      return (
        edgeList.find(
          (edge) => buildPairKey(edge.from, edge.to) === buildPairKey(pair.from, pair.to),
        )?.metric ?? 0
      );
    });
    const worstPairIndex =
      pathPairMetrics.length > 0
        ? pathPairMetrics.reduce(
            (bestIndex, metric, index, metrics) =>
              metric > metrics[bestIndex]! ? index : bestIndex,
            0,
          )
        : -1;
    diagnostics.set(stationId, {
      stationId,
      anchorStationId: best?.anchorStationId,
      anchorPathStationIds: best?.pathStationIds ?? [stationId],
      anchorPathPairRefs: best?.pathPairRefs ?? [],
      pathWorstEdgeMetric: best?.pathWorstEdgeMetric,
      pathTotalMetric: best?.pathTotalMetric,
      pathWorstEdgePair: worstPairIndex >= 0 ? best?.pathPairRefs[worstPairIndex] : undefined,
      stationMajor: stationMajorsById.get(stationId),
      fixedRank,
    });
  });
  timings.finalDiagnosticsMs = now() - startedAt;

  startedAt = now();
  const stationOrder = [...diagnostics.values()]
    .sort((left, right) => {
      const rightMajor = right.stationMajor ?? Number.NEGATIVE_INFINITY;
      const leftMajor = left.stationMajor ?? Number.NEGATIVE_INFINITY;
      if (rightMajor !== leftMajor) return rightMajor - leftMajor;
      const rightWorst = right.pathWorstEdgeMetric ?? Number.NEGATIVE_INFINITY;
      const leftWorst = left.pathWorstEdgeMetric ?? Number.NEGATIVE_INFINITY;
      if (rightWorst !== leftWorst) return rightWorst - leftWorst;
      const rightTotal = right.pathTotalMetric ?? Number.NEGATIVE_INFINITY;
      const leftTotal = left.pathTotalMetric ?? Number.NEGATIVE_INFINITY;
      if (rightTotal !== leftTotal) return rightTotal - leftTotal;
      return left.stationId.localeCompare(right.stationId, undefined, { numeric: true });
    })
    .map((row) => row.stationId);
  timings.orderingMs = now() - startedAt;

  startedAt = now();
  const prioritizedPairs: PreanalysisAddedSetPairRef[] = [];
  const prioritizedPairKeys = new Set<string>();
  const prioritizedStations = new Set<StationId>();
  let prioritizedPairIterations = 0;
  stationOrder.slice(0, 5).forEach((stationId) => {
    const diagnosticsRow = diagnostics.get(stationId);
    if (!diagnosticsRow) return;
    diagnosticsRow.anchorPathStationIds.forEach((id) => prioritizedStations.add(id));
    const pathPairs = diagnosticsRow.anchorPathPairRefs;
    const worstEdgeKey =
      mode === 'optimized' && diagnosticsRow.pathWorstEdgePair
        ? buildPairKey(
            diagnosticsRow.pathWorstEdgePair.from,
            diagnosticsRow.pathWorstEdgePair.to,
          )
        : undefined;
    const orderedPairs = diagnosticsRow.pathWorstEdgePair
      ? [
          diagnosticsRow.pathWorstEdgePair,
          ...pathPairs.filter(
            (pair) =>
              worstEdgeKey !== undefined
                ? buildPairKey(pair.from, pair.to) !== worstEdgeKey
                : buildPairKey(pair.from, pair.to) !==
                  buildPairKey(
                    diagnosticsRow.pathWorstEdgePair!.from,
                    diagnosticsRow.pathWorstEdgePair!.to,
                  ),
          ),
        ]
      : pathPairs;
    orderedPairs.forEach((pair) => {
      prioritizedPairIterations += 1;
      const key = buildPairKey(pair.from, pair.to);
      if (prioritizedPairKeys.has(key)) return;
      prioritizedPairKeys.add(key);
      prioritizedPairs.push(pair);
    });
  });
  timings.prioritizedPairsMs = now() - startedAt;

  startedAt = now();
  const weakCues = [...(base.weakGeometryDiagnostics?.relativeCues ?? [])].sort((left, right) => {
    const severityDelta = severityWeight(right.severity) - severityWeight(left.severity);
    if (severityDelta !== 0) return severityDelta;
    return (right.distanceMetric ?? 0) - (left.distanceMetric ?? 0);
  });
  let weakCueAdded = 0;
  weakCues.forEach((cue) => {
    const key = buildPairKey(cue.from, cue.to);
    if (prioritizedPairKeys.has(key)) return;
    prioritizedPairKeys.add(key);
    prioritizedPairs.push({ from: cue.from, to: cue.to });
    weakCueAdded += 1;
  });
  timings.weakCueMs = now() - startedAt;
  timings.totalMs = now() - totalStartedAt;

  return {
    summary: {
      stationOrder,
      stationDiagnostics: diagnostics,
      prioritizedPairs,
      prioritizedStations,
      prioritizedPairKeys,
    },
    counters,
    timings,
    structure: {
      builtEdgeCount: edgeList.length,
      adjacencyNodes: adjacency.size,
      adjacencyEdgeRefs,
      anchorCount: anchors.length,
      fallbackAnchorCount: fallbackAnchors.length,
      usedFallbackAnchors: anchors.length === 0,
      prioritizedPairIterations,
      weakCueCount: weakCues.length,
      weakCueAdded,
    },
  };
};

/** Parity: mirror must equal production exactly, else counters are void. */
const assertMirrorParity = (label: string, actual: PathPrioritySummary, mirrored: PathPrioritySummary): void => {
  expect(mirrored.stationOrder, `${label}: stationOrder`).toEqual(actual.stationOrder);
  expect(
    [...mirrored.stationDiagnostics.entries()],
    `${label}: stationDiagnostics`,
  ).toEqual([...actual.stationDiagnostics.entries()]);
  expect(mirrored.prioritizedPairs, `${label}: prioritizedPairs`).toEqual(
    actual.prioritizedPairs,
  );
  expect(
    [...mirrored.prioritizedStations].sort(),
    `${label}: prioritizedStations`,
  ).toEqual([...actual.prioritizedStations].sort());
  expect(
    [...mirrored.prioritizedPairKeys].sort(),
    `${label}: prioritizedPairKeys`,
  ).toEqual([...actual.prioritizedPairKeys].sort());
};

const reportArm = (
  result: AdjustmentResult,
  label: string,
  mode: MirrorMode,
  actual: PathPrioritySummary,
) => {
  const mirrored = mirrorBuildPathPrioritySummary(result, mode);
  assertMirrorParity(`${label}:${mode}`, actual, mirrored.summary);
  const { counters, timings } = mirrored;
  return {
    timings,
    frontier: {
      push: counters.frontierPush,
      pop: counters.frontierPop,
      sorts: counters.frontierSorts,
      totalSorted: counters.frontierTotalSorted,
      maxSize: counters.frontierMax,
      medianSize: medianOf(counters.frontierSizes),
    },
    edgesFindCalls: counters.edgesFindCalls,
    mapGets: counters.mapGets,
    mapBuildKeys: counters.mapBuildKeys,
    pairKeyCalls: counters.pairKeyCalls,
    structure: mirrored.structure,
  };
};

const reportBuild = (
  result: AdjustmentResult,
  label: string,
) => {
  const productionStartedAt = performance.now();
  const actual = buildPathPrioritySummary(result);
  const productionMs = performance.now() - productionStartedAt;
  return {
    label,
    productionMs,
    legacy: reportArm(result, label, 'legacy', actual),
    optimized: reportArm(result, label, 'optimized', actual),
    stationOrderLength: actual.stationOrder.length,
    diagnosticsSize: actual.stationDiagnostics.size,
    prioritizedPairCount: actual.prioritizedPairs.length,
    prioritizedStationCount: actual.prioritizedStations.size,
    inputSizes: {
      stations: Object.keys(result.stations).length,
      observations: result.observations?.length ?? 0,
      relativeCovariances: result.relativeCovariances?.length ?? 0,
      stationCovariances: result.stationCovariances?.length ?? 0,
      weakRelativeCues: result.weakGeometryDiagnostics?.relativeCues?.length ?? 0,
    },
  };
};

const stat3 = (values: number[]): { min: number; median: number; max: number } => {
  const sorted = [...values].sort((left, right) => left - right);
  return { min: sorted[0] ?? 0, median: sorted[1] ?? 0, max: sorted[2] ?? 0 };
};
const savedPct = (legacyMs: number, optimizedMs: number): { savedMs: number; pctFaster: number } => ({
  savedMs: legacyMs - optimizedMs,
  pctFaster: legacyMs > 0 ? ((legacyMs - optimizedMs) / legacyMs) * 100 : 0,
});

describe('phase 9J path-priority profile (camp fixture, evidence-only)', () => {
  it('benchmarks legacy vs optimized mirrors over 1 warm-up + 3 measured runs without gating', () => {
    const baseRequest = createRunSessionRequest({
      input: CAMP_INPUT,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        runMode: 'preanalysis',
        preanalysisMode: true,
        coordMode: '2D',
      },
    });

    const runOnce = (label: string) => {
      const sessionStartedAt = performance.now();
      const session = runAdjustmentSession(baseRequest);
      const sessionWallMs = performance.now() - sessionStartedAt;
      const base = session.result;
      const stageOf = (id: string): { durationMs: number; solveCount: number } => {
        const stage = session.profile.stages.find((entry) => entry.id === id);
        return { durationMs: stage?.durationMs ?? 0, solveCount: stage?.solveCount ?? 0 };
      };

      const templatesStartedAt = performance.now();
      const templates = buildPreanalysisSyntheticSetTemplates(
        CAMP_INPUT,
        base,
        baseRequest.planningMap,
        [],
      );
      const templatesMs = performance.now() - templatesStartedAt;
      const candidatesStartedAt = performance.now();
      const candidates = resolveCandidateTemplates(templates, base, []);
      const candidatesMs = performance.now() - candidatesStartedAt;

      const solveMemo = new Map<string, AdjustmentResult>();
      const solveAlt = (nextIds: string[]): AdjustmentResult => {
        const normalized = resolveAppliedPreanalysisActionState(templates, nextIds)
          .normalizedScenarioIds;
        const key = JSON.stringify(normalized);
        const cached = solveMemo.get(key);
        if (cached) return cached;
        const solveInput = `${CAMP_INPUT.trimEnd()}\n\n${normalized
          .map((id, index) => {
            const template = templates.find((entry) => entry.id === id);
            return `# WEBNET_PREANALYSIS_ADDED_SET ${id} ${index + 1}\n${template?.blockText ?? ''}`;
          })
          .join('\n\n')}\n`;
        const alt = runAdjustmentSession(
          createRunSessionRequest({
            ...baseRequest,
            input: solveInput,
            parseSettings: {
              ...baseRequest.parseSettings,
              runMode: 'adjustment',
              preanalysisMode: false,
            },
          }),
        ).result;
        solveMemo.set(key, alt);
        return alt;
      };
      const solvesStartedAt = performance.now();
      const alts = candidates.map((template) => solveAlt([template.id]));
      const recommendationSolvesMs = performance.now() - solvesStartedAt;

      resetSummaryBuilds();
      const baseReport = reportBuild(base, `${label}:base`);
      const altReports = alts.map((alt, index) =>
        reportBuild(alt, `${label}:alt[${candidates[index]?.id ?? index}]`),
      );
      const profiledBuilds = summaryBuilds();

      resetSummaryBuilds();
      const planningStartedAt = performance.now();
      const full = buildPreanalysisPlanningDiagnostics({
        base,
        input: CAMP_INPUT,
        planningMap: baseRequest.planningMap,
        activeTemplateIds: [],
        targetThresholdMeters: baseRequest.parseSettings.preanalysisAccuracyThresholdMeters,
        maxAddedSets: baseRequest.parseSettings.preanalysisMaxAddedSets,
        solveScenario: solveAlt,
      });
      const planningWallMs = performance.now() - planningStartedAt;
      const fullSummaryBuilds = summaryBuilds();

      const altCompact = altReports.map((report) => ({
        label: report.label,
        legacyMs: report.legacy.timings.totalMs,
        optimizedMs: report.optimized.timings.totalMs,
        legacyKeys: report.legacy.pairKeyCalls,
        optimizedKeys: report.optimized.pairKeyCalls,
        finds: report.legacy.edgesFindCalls,
        gets: report.optimized.mapGets,
      }));
      return {
        candidateCount: candidates.length,
        distinctAltSolves: solveMemo.size,
        sessionSplitMs: {
          sessionWallMs,
          mainSolve: stageOf('main-solve'),
          preanalysisImpact: stageOf('preanalysis-impact'),
          templatesMs,
          candidatesMs,
          recommendationSolvesMs,
          planningWallMs,
        },
        base: baseReport,
        altCompact,
        altTotals: {
          legacyMs: altCompact.reduce((total, alt) => total + alt.legacyMs, 0),
          optimizedMs: altCompact.reduce((total, alt) => total + alt.optimizedMs, 0),
          legacyKeys: altCompact.reduce((total, alt) => total + alt.legacyKeys, 0),
          optimizedKeys: altCompact.reduce((total, alt) => total + alt.optimizedKeys, 0),
          finds: altCompact.reduce((total, alt) => total + alt.finds, 0),
          gets: altCompact.reduce((total, alt) => total + alt.gets, 0),
        },
        profiledBuilds,
        fullRun: {
          summaryBuilds: fullSummaryBuilds,
          thresholdSteps: full.thresholdPlan.steps.length,
          recommendationRows: full.rows.length,
        },
      };
    };

    runOnce('warmup');
    const measured = [runOnce('measured1'), runOnce('measured2'), runOnce('measured3')];
    const first = measured[0]!;
    expect(first.candidateCount).toBeGreaterThan(0);
    measured.forEach((run) => {
      expect(run.candidateCount).toBe(first.candidateCount);
      expect(run.distinctAltSolves).toBe(first.distinctAltSolves);
    });

    const baseLegacy = measured.map((run) => run.base.legacy.timings.totalMs);
    const baseOptimized = measured.map((run) => run.base.optimized.timings.totalMs);
    const baseLegacyKeys = measured.map((run) => run.base.legacy.pairKeyCalls);
    const baseOptimizedKeys = measured.map((run) => run.base.optimized.pairKeyCalls);
    const altLegacyTotals = measured.map((run) => run.altTotals.legacyMs);
    const altOptimizedTotals = measured.map((run) => run.altTotals.optimizedMs);
    const planningWalls = measured.map((run) => run.sessionSplitMs.planningWallMs);
    const mainSolves = measured.map((run) => run.sessionSplitMs.mainSolve.durationMs);
    const preImpacts = measured.map((run) => run.sessionSplitMs.preanalysisImpact.durationMs);
    const recSolves = measured.map((run) => run.sessionSplitMs.recommendationSolvesMs);
    const baseFinalDx = (arm: 'legacy' | 'optimized'): number[] =>
      measured.map((run) => run.base[arm].timings.finalDiagnosticsMs);

    console.log(
      `[phase9j-profile] ${JSON.stringify({
        warmupRuns: 1,
        measuredRuns: 3,
        candidateCount: first.candidateCount,
        distinctAltSolves: first.distinctAltSolves,
        baseSummaryMs: {
          legacy: stat3(baseLegacy),
          optimized: stat3(baseOptimized),
          ...savedPct(medianOf(baseLegacy), medianOf(baseOptimized)),
        },
        baseFinalDiagnosticsMs: {
          legacy: stat3(baseFinalDx('legacy')),
          optimized: stat3(baseFinalDx('optimized')),
        },
        baseKeyCalls: { legacy: stat3(baseLegacyKeys), optimized: stat3(baseOptimizedKeys) },
        baseScansVsGets: {
          finds: first.base.legacy.edgesFindCalls,
          gets: first.base.optimized.mapGets,
          mapBuildKeys: first.base.optimized.mapBuildKeys,
        },
        altSummaryTotalsMs: {
          legacy: stat3(altLegacyTotals),
          optimized: stat3(altOptimizedTotals),
          ...savedPct(medianOf(altLegacyTotals), medianOf(altOptimizedTotals)),
        },
        altSummaryEachMs: {
          legacy: stat3(
            measured.flatMap((run) => run.altCompact.map((alt) => alt.legacyMs)),
          ),
          optimized: stat3(
            measured.flatMap((run) => run.altCompact.map((alt) => alt.optimizedMs)),
          ),
        },
        sessionSplitMs: {
          mainSolve: stat3(mainSolves),
          preanalysisImpactStage: stat3(preImpacts),
          templates: stat3(measured.map((run) => run.sessionSplitMs.templatesMs)),
          candidates: stat3(measured.map((run) => run.sessionSplitMs.candidatesMs)),
          recommendationSolves: stat3(recSolves),
          planningWall: stat3(planningWalls),
        },
        stageTotals: {
          mainSolveSolves: measured.map((run) => run.sessionSplitMs.mainSolve.solveCount),
          preanalysisImpactSolves: measured.map(
            (run) => run.sessionSplitMs.preanalysisImpact.solveCount,
          ),
          planningSummaryBuilds: measured.map((run) => run.fullRun.summaryBuilds),
          recommendationRows: measured.map((run) => run.fullRun.recommendationRows),
          thresholdSteps: measured.map((run) => run.fullRun.thresholdSteps),
        },
        measuredBaseDetail: measured.map((run) => run.base),
      })}`,
    );
  }, 300000);
});
