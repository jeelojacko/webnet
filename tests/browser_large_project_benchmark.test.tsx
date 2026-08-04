/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import MapView from '../src/components/MapView';
import ReportView from '../src/components/ReportView';
import { buildExportArtifacts } from '../src/engine/exportArtifacts';
import { buildQaDerivedResult } from '../src/engine/qaWorkflow';
import { runAdjustmentSession } from '../src/engine/runSession';
import {
  getScenarioRunServiceStats,
  resetScenarioRunServiceCache,
} from '../src/engine/solveEngine';
import {
  BENCHMARK_CASE_TIMEOUT_MS,
  benchmarkFixtures,
  buildBenchmarkInput,
  createArtifactRequest,
  ensureSectionExpanded,
  medianDurationMs,
  observationSectionKey,
  observationSectionLabel,
  REPORT_TABLE_WINDOW_SIZE,
  sortIds,
} from './browserLargeProjectBenchmark/browserLargeProjectBenchmarkTestSupport';
import { createRunSessionRequest } from './helpers/runSessionRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('browser large-project benchmark coverage', () => {
  it.each(benchmarkFixtures)(
    'keeps imported-job solve, rerun, render, and artifact work within guardrails for %s',
    async (fixture) => {
      resetScenarioRunServiceCache();
      const input = buildBenchmarkInput(fixture);
      const request = createRunSessionRequest({
        input,
        parseSettings: {
          ...createRunSessionRequest().parseSettings,
          coordMode: fixture.kind === 'imported-leveling' ? '3D' : '2D',
        },
      });

      const solveStart = performance.now();
      const outcome = runAdjustmentSession(request);
      const solveDurationMs = performance.now() - solveStart;

      expect(outcome.result.success).toBe(true);
      expect(outcome.result.converged).toBe(true);
      expect(Object.keys(outcome.result.stations)).toHaveLength(fixture.expectedStationCount);
      expect(outcome.result.observations).toHaveLength(fixture.expectedObservationCount);
      expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(solveDurationMs).toBeLessThan(fixture.solveBudgetMs);
      const firstRunStats = getScenarioRunServiceStats();
      expect(firstRunStats.parseCacheMisses).toBeGreaterThanOrEqual(1);
      expect(firstRunStats.planningCacheMisses).toBeGreaterThanOrEqual(1);

      const rerunStart = performance.now();
      const rerunOutcome = runAdjustmentSession(request);
      const rerunDurationMs = performance.now() - rerunStart;

      expect(rerunOutcome.result.success).toBe(true);
      expect(rerunOutcome.result.converged).toBe(true);
      expect(rerunDurationMs).toBeLessThan(fixture.rerunBudgetMs);
      const rerunStats = getScenarioRunServiceStats();
      expect(rerunStats.parseCacheHits).toBeGreaterThan(firstRunStats.parseCacheHits);
      expect(rerunStats.planningCacheHits).toBeGreaterThan(firstRunStats.planningCacheHits);

      const artifactStart = performance.now();
      const artifactResult = buildExportArtifacts(
        createArtifactRequest(request, outcome.result, fixture.artifactFormat),
      );
      const artifactDurationMs = performance.now() - artifactStart;

      expect(artifactDurationMs).toBeLessThan(fixture.artifactBuildBudgetMs);
      expect(artifactResult.files.length).toBeGreaterThan(0);
      expect(artifactResult.files.some((file) => file.name.endsWith('.txt'))).toBe(true);

      const qaDerivedStart = performance.now();
      const derived = buildQaDerivedResult(outcome.result);
      const qaDerivedBuildDurationMs = performance.now() - qaDerivedStart;
      expect(qaDerivedBuildDurationMs).toBeLessThan(fixture.qaDerivedBuildBudgetMs);
      const firstObservationId = outcome.result.observations[0]?.id ?? null;
      const sortedStationIds = sortIds(Object.keys(outcome.result.stations));
      const firstStationId = sortedStationIds[0] ?? null;
      const lastStationId = sortedStationIds[sortedStationIds.length - 1] ?? null;

      const BenchmarkHarness: React.FC = () => {
        const [selectedObservationId, setSelectedObservationId] = React.useState<number | null>(
          firstObservationId,
        );
        const [selectedStationId, setSelectedStationId] = React.useState<string | null>(
          firstStationId,
        );
        return (
          <div>
            <div className="hidden">
              <button
                data-benchmark-select-first
                onClick={() => {
                  setSelectedObservationId(firstObservationId);
                  setSelectedStationId(firstStationId);
                }}
                type="button"
              >
                Select first
              </button>
              <button
                data-benchmark-select-last
                onClick={() => {
                  setSelectedObservationId(firstObservationId);
                  setSelectedStationId(lastStationId);
                }}
                type="button"
              >
                Select last
              </button>
            </div>
            <div data-selection-status>
              obs:{selectedObservationId ?? '-'} station:{selectedStationId ?? '-'}
            </div>
            <ReportView
              result={outcome.result}
              units="m"
              runDiagnostics={null}
              excludedIds={new Set<number>()}
              onToggleExclude={() => {}}
              onApplyImpactExclude={() => {}}
              onApplyPreanalysisAction={() => {}}
              onReRun={() => {}}
              onClearExclusions={() => {}}
              overrides={{}}
              onOverride={() => {}}
              onResetOverrides={() => {}}
              clusterReviewDecisions={{}}
              activeClusterApprovedMerges={[]}
              onClusterDecisionStatus={() => {}}
              onClusterCanonicalSelection={() => {}}
              onApplyClusterMerges={() => {}}
              onResetClusterReview={() => {}}
              onClearClusterMerges={() => {}}
              selectedStationId={selectedStationId}
              selectedObservationId={selectedObservationId}
              onSelectStation={setSelectedStationId}
              onSelectObservation={setSelectedObservationId}
            />
            <MapView
              result={outcome.result}
              units="m"
              derivedResult={derived}
              selectedStationId={selectedStationId}
              selectedObservationId={selectedObservationId}
              onSelectStation={setSelectedStationId}
              onSelectObservation={setSelectedObservationId}
            />
          </div>
        );
      };

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root: Root = createRoot(container);
      await act(async () => {
        root.render(<BenchmarkHarness />);
      });

      const selectFirstButton = container.querySelector(
        '[data-benchmark-select-first]',
      ) as HTMLButtonElement | null;
      const selectLastButton = container.querySelector(
        '[data-benchmark-select-last]',
      ) as HTMLButtonElement | null;
      const renderSamples: number[] = [];
      for (const button of [selectLastButton, selectFirstButton, selectLastButton]) {
        const sampleStart = performance.now();
        await act(async () => {
          button?.click();
        });
        renderSamples.push(performance.now() - sampleStart);
      }
      const renderDurationMs = medianDurationMs(renderSamples);

      expect(renderDurationMs).toBeLessThan(fixture.renderBudgetMs);

      await act(async () => {
        selectFirstButton?.click();
      });
      const firstObservation = outcome.result.observations.find((obs) => obs.id === firstObservationId);
      if (!firstObservation) {
        throw new Error('Expected first observation in benchmark fixture.');
      }
      await ensureSectionExpanded(container, observationSectionLabel(firstObservation.type));
      const observationShowAllButton = container.querySelector(
        `[data-report-show-all="${observationSectionKey(firstObservation.type)}"]`,
      ) as HTMLButtonElement | null;
      await act(async () => {
        observationShowAllButton?.click();
      });

      expect(container.textContent).toContain('Adjusted Coordinates');
      expect(container.textContent).toContain(firstStationId ?? '');
      expect(container.querySelector('[data-testid="map-base-canvas"]')).not.toBeNull();
      expect(container.querySelectorAll('[data-map-label]').length).toBeLessThanOrEqual(
        fixture.expectedStationCount,
      );

      const showMoreButton = container.querySelector(
        '[data-report-load-more="adjusted-coordinates"]',
      ) as HTMLButtonElement | null;
      const showAllCoordinatesButton = container.querySelector(
        '[data-report-show-all="adjusted-coordinates"]',
      ) as HTMLButtonElement | null;
      const firstObservationRow = container.querySelector(
        `[data-report-observation-row="${firstObservationId}"]`,
      ) as HTMLTableRowElement | null;
      expect(firstObservationRow).not.toBeNull();
      const coordinateHeading = Array.from(container.querySelectorAll('h3')).find((node) =>
        node.textContent?.includes('Adjusted Coordinates'),
      );
      const coordinateSection = coordinateHeading?.parentElement?.parentElement ?? null;
      const expectedInitialRowCount =
        fixture.expectedStationCount > REPORT_TABLE_WINDOW_SIZE
          ? REPORT_TABLE_WINDOW_SIZE
          : fixture.expectedStationCount;
      expect(coordinateSection?.querySelectorAll('tbody tr').length).toBe(expectedInitialRowCount);

      await act(async () => {
        firstObservationRow?.click();
        showMoreButton?.click();
        showAllCoordinatesButton?.click();
      });

      expect(coordinateSection?.querySelectorAll('tbody tr').length).toBe(
        fixture.expectedStationCount,
      );
      expect(container.textContent).toContain(lastStationId ?? '');
      expect(container.querySelector('[data-selection-status]')?.textContent).toContain(
        `obs:${firstObservationId}`,
      );
      expect(container.querySelector(`[data-map-station-selection="${firstStationId}"]`)).not.toBeNull();

      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    BENCHMARK_CASE_TIMEOUT_MS,
  );
});
