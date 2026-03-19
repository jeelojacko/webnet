/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import MapView from '../src/components/MapView';
import ReportView from '../src/components/ReportView';
import { buildQaDerivedResult } from '../src/engine/qaWorkflow';
import { runAdjustmentSession } from '../src/engine/runSession';
import {
  getScenarioRunServiceStats,
  resetScenarioRunServiceCache,
} from '../src/engine/solveEngine';
import { createRunSessionRequest } from './helpers/runSessionRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface BrowserBenchmarkFixture {
  id: string;
  pointCount: number;
  angleOffsetDeg: number;
  radiusBaseM: number;
  radiusStepM: number;
  expectedStationCount: number;
  expectedObservationCount: number;
  reportWindowSize: number;
  solveBudgetMs: number;
  rerunBudgetMs: number;
  renderBudgetMs: number;
}

const benchmarkFixtures = JSON.parse(
  readFileSync('tests/fixtures/browser_large_project_benchmark.json', 'utf-8'),
) as BrowserBenchmarkFixture[];

const padPointId = (index: number): string => `P${String(index + 1).padStart(3, '0')}`;

const buildBenchmarkInput = (fixture: BrowserBenchmarkFixture): string => {
  const lines = ['.2D', '.UNITS M', '.I S9', 'C A 0 0 ! !'];
  for (let index = 0; index < fixture.pointCount; index += 1) {
    const pointId = padPointId(index);
    const angleDeg = (fixture.angleOffsetDeg + index * 11.5) % 360;
    const angleRad = (angleDeg * Math.PI) / 180;
    const radius = fixture.radiusBaseM + fixture.radiusStepM * index;
    const east = radius * Math.sin(angleRad);
    const north = radius * Math.cos(angleRad);
    lines.push(`C ${pointId} ${east.toFixed(4)} ${north.toFixed(4)}`);
    lines.push(`B A-${pointId} ${angleDeg.toFixed(8)} 5`);
    lines.push(`D A-${pointId} ${radius.toFixed(4)} 0.005`);
  }
  return lines.join('\n');
};

describe('browser large-project benchmark coverage', () => {
  it.each(benchmarkFixtures)(
    'keeps the large-project run-session solve and initial report/map render within guardrails for %s',
    async (fixture) => {
      resetScenarioRunServiceCache();
      const input = buildBenchmarkInput(fixture);
      const request = createRunSessionRequest({
        input,
        parseSettings: {
          ...createRunSessionRequest().parseSettings,
          coordMode: '2D',
          angleUnits: 'dd',
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
      expect(getScenarioRunServiceStats().parseCacheMisses).toBe(1);

      const rerunStart = performance.now();
      const rerunOutcome = runAdjustmentSession(request);
      const rerunDurationMs = performance.now() - rerunStart;

      expect(rerunOutcome.result.success).toBe(true);
      expect(rerunOutcome.result.converged).toBe(true);
      expect(rerunDurationMs).toBeLessThan(fixture.rerunBudgetMs);
      expect(getScenarioRunServiceStats().parseCacheHits).toBeGreaterThanOrEqual(1);

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root: Root = createRoot(container);
      const derived = buildQaDerivedResult(outcome.result);
      const firstObservationId = outcome.result.observations[0]?.id ?? null;

      const BenchmarkHarness: React.FC = () => {
        const [selectedObservationId, setSelectedObservationId] = React.useState<number | null>(
          firstObservationId,
        );
        const [selectedStationId, setSelectedStationId] = React.useState<string | null>('P001');
        return (
          <div>
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

      const renderStart = performance.now();
      await act(async () => {
        root.render(<BenchmarkHarness />);
      });
      const renderDurationMs = performance.now() - renderStart;

      expect(renderDurationMs).toBeLessThan(fixture.renderBudgetMs);
      expect(container.textContent).toContain('Adjusted Coordinates');
      expect(container.textContent).toContain('P001');
      expect(container.querySelectorAll('[data-map-station]').length).toBe(fixture.expectedStationCount);
      expect(container.querySelectorAll('[data-map-label]').length).toBeLessThan(
        fixture.expectedStationCount,
      );

      const showMoreButton = container.querySelector(
        '[data-report-load-more="adjusted-coordinates"]',
      ) as HTMLButtonElement | null;
      const firstObservationRow = container.querySelector(
        `[data-report-observation-row="${firstObservationId}"]`,
      ) as HTMLTableRowElement | null;
      expect(showMoreButton).not.toBeNull();
      expect(firstObservationRow).not.toBeNull();
      const coordinateHeading = Array.from(container.querySelectorAll('h3')).find((node) =>
        node.textContent?.includes('Adjusted Coordinates'),
      );
      const coordinateSection = coordinateHeading?.parentElement?.parentElement ?? null;
      expect(coordinateSection?.querySelectorAll('tbody tr').length).toBe(fixture.reportWindowSize);

      await act(async () => {
        firstObservationRow?.click();
        showMoreButton?.click();
      });

      expect(coordinateSection?.querySelectorAll('tbody tr').length).toBe(
        fixture.expectedStationCount,
      );
      expect(container.textContent).toContain(padPointId(fixture.pointCount - 1));
      expect(container.querySelector('[data-selection-status]')?.textContent).toContain(
        `obs:${firstObservationId}`,
      );
      expect(
        container.querySelector(`[data-map-observation="${firstObservationId}"]`),
      ).not.toBeNull();

      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    15000,
  );
});
