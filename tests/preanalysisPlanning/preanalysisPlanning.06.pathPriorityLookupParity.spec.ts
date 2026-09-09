/**
 * Phase 9J path-priority lookup parity (agent tier, fast).
 *
 * The keyed edge-metric lookup and hoisted worst-pair key preserve exact
 * comparator semantics: summaries must be structurally identical across
 * repeated builds and input insertion-order permutations, on the camp
 * base + 16 alts, synthetic fixtures, and adversarial tie cases. The
 * exported legacy sort comparator doubles as the frontier tie-break
 * oracle. No timing gates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type { AdjustmentResult } from '../../src/types';
import {
  buildPathPrioritySummary,
  compareFrontierNodes,
  type PathPrioritySummary,
} from '../../src/engine/preanalysisPathPriority';
import {
  buildPreanalysisSyntheticSetTemplates,
  resolveAppliedPreanalysisActionState,
} from '../../src/engine/preanalysisPlanning';
import { resolveCandidateTemplates } from '../../src/engine/preanalysisPlanningRecommendations';
import { runAdjustmentSession } from '../../src/engine/runSession';
import { createRunSessionRequest } from '../helpers/runSessionRequest';
import {
  buildChainResult,
  buildMultiRouteResult,
  buildPartiallyFixedChainResult,
  buildResult,
} from './preanalysisPlanningTestSupport';

const CAMP_INPUT = fs.readFileSync(
  path.join(process.cwd(), 'tests/fixtures/camp_design_preanalysis_traverse_only.dat'),
  'utf-8',
);

// Diagnostics map entry order follows input insertion order by design (the
// sorted stationOrder is the canonical order), so entries sort by key here.
const structuralOf = (summary: PathPrioritySummary) => ({
  stationOrder: summary.stationOrder,
  stationDiagnostics: [...summary.stationDiagnostics.entries()].sort(([left], [right]) =>
    left.localeCompare(right, undefined, { numeric: true }),
  ),
  prioritizedPairs: summary.prioritizedPairs,
  prioritizedStations: [...summary.prioritizedStations].sort(),
  prioritizedPairKeys: [...summary.prioritizedPairKeys].sort(),
});

const expectStructuralEqual = (left: PathPrioritySummary, right: PathPrioritySummary): void => {
  expect(structuralOf(right)).toEqual(structuralOf(left));
};

/** Permute insertion order without renaming: reversed arrays/keys. */
const permuteInsertionOrder = (result: AdjustmentResult): AdjustmentResult => {
  const clone = JSON.parse(JSON.stringify(result)) as AdjustmentResult;
  clone.observations = [...(clone.observations ?? [])].reverse();
  clone.relativeCovariances = [...(clone.relativeCovariances ?? [])].reverse();
  clone.stationCovariances = [...(clone.stationCovariances ?? [])].reverse();
  const stations = clone.stations as Record<string, unknown>;
  clone.stations = Object.fromEntries(Object.entries(stations).reverse()) as typeof clone.stations;
  if (clone.weakGeometryDiagnostics) {
    clone.weakGeometryDiagnostics = {
      ...clone.weakGeometryDiagnostics,
      relativeCues: [...(clone.weakGeometryDiagnostics.relativeCues ?? [])].reverse(),
    };
  }
  return clone;
};

const expectDeterministicUnderPermutation = (result: AdjustmentResult): void => {
  const first = buildPathPrioritySummary(result);
  expectStructuralEqual(first, buildPathPrioritySummary(result));
  expectStructuralEqual(first, buildPathPrioritySummary(permuteInsertionOrder(result)));
};

describe('phase 9J path-priority lookup parity', () => {
  it('keeps camp base + 16 alt summaries structurally stable', () => {
    const baseRequest = createRunSessionRequest({
      input: CAMP_INPUT,
      parseSettings: {
        ...createRunSessionRequest().parseSettings,
        runMode: 'preanalysis',
        preanalysisMode: true,
        coordMode: '2D',
      },
    });
    const base = runAdjustmentSession(baseRequest).result;
    const templates = buildPreanalysisSyntheticSetTemplates(
      CAMP_INPUT,
      base,
      baseRequest.planningMap,
      [],
    );
    const candidates = resolveCandidateTemplates(templates, base, []);
    expect(candidates).toHaveLength(16);

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

    expectDeterministicUnderPermutation(base);
    const baseSummary = buildPathPrioritySummary(base);
    expect(baseSummary.stationOrder).toHaveLength(Object.keys(base.stations).length);
    expect(baseSummary.stationDiagnostics.size).toBe(Object.keys(base.stations).length);

    candidates.forEach((template) => {
      expectDeterministicUnderPermutation(solveAlt([template.id]));
    });
    expect(solveMemo.size).toBe(16);
  });

  it('keeps synthetic fixtures structurally stable', () => {
    [buildChainResult(), buildMultiRouteResult(), buildPartiallyFixedChainResult(), buildResult(0.01)].forEach(
      (result) => expectDeterministicUnderPermutation(result),
    );
  });

  it('breaks symmetric-route ties deterministically', () => {
    // B and C are fully symmetric (equal majors, equal leg metrics), so the
    // A-B-D vs A-C-D route choice exercises every frontier tie-break level.
    const summary = buildPathPrioritySummary(buildMultiRouteResult());
    // B sorts before C at every frontier tie-break level, so A-B-D wins.
    expect(summary.stationDiagnostics.get('D')?.anchorPathStationIds).toEqual(['A', 'B', 'D']);
    expectStructuralEqual(summary, buildPathPrioritySummary(buildMultiRouteResult()));
    expect(summary.stationOrder[0]).toBe('D');
    const bottleneck = summary.stationDiagnostics.get('D')?.pathWorstEdgePair;
    expect(bottleneck).toBeDefined();
  });

  it('orders tied frontier nodes by path then anchor', () => {
    const node = (anchorStationId: string, pathStationIds: string[]) => ({
      stationId: 'D',
      anchorStationId,
      pathWorstEdgeMetric: 0.007,
      pathTotalMetric: 0.011,
      hopCount: 2,
      pathStationIds,
      pathPairRefs: [],
    });
    // 'B' sorts before 'C', so the B-path pops first (negative sorts first).
    expect(compareFrontierNodes(node('B', ['A', 'B', 'D']), node('A', ['A', 'C', 'D']))).toBeLessThan(0);
    expect(compareFrontierNodes(node('A', ['A', 'C', 'D']), node('B', ['A', 'B', 'D']))).toBeGreaterThan(0);
    // Identical paths fall through to the anchor tie-break.
    expect(compareFrontierNodes(node('B', ['A', 'B', 'D']), node('A', ['A', 'B', 'D']))).toBeGreaterThan(0);
    // Numerically ordered station ids, not lexicographic ('10' after '9').
    expect(
      compareFrontierNodes(node('10', ['A', 'X']), node('9', ['A', 'X'])),
    ).toBeGreaterThan(0);
  });
});
