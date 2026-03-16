/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import ReportView from '../src/components/ReportView';
import { runAdjustmentSession } from '../src/engine/runSession';
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
    'keeps the large-project run-session solve and initial report render within guardrails for %s',
    async (fixture) => {
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

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root: Root = createRoot(container);

      const renderStart = performance.now();
      await act(async () => {
        root.render(
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
          />,
        );
      });
      const renderDurationMs = performance.now() - renderStart;

      expect(renderDurationMs).toBeLessThan(fixture.renderBudgetMs);
      expect(container.textContent).toContain('Adjusted Coordinates');
      expect(container.textContent).toContain('P001');

      const showMoreButton = container.querySelector(
        '[data-report-load-more="adjusted-coordinates"]',
      ) as HTMLButtonElement | null;
      expect(showMoreButton).not.toBeNull();
      const coordinateHeading = Array.from(container.querySelectorAll('h3')).find((node) =>
        node.textContent?.includes('Adjusted Coordinates'),
      );
      const coordinateSection = coordinateHeading?.parentElement?.parentElement ?? null;
      expect(coordinateSection?.querySelectorAll('tbody tr').length).toBe(fixture.reportWindowSize);

      await act(async () => {
        showMoreButton?.click();
      });

      expect(coordinateSection?.querySelectorAll('tbody tr').length).toBe(
        fixture.expectedStationCount,
      );
      expect(container.textContent).toContain(padPointId(fixture.pointCount - 1));

      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
    15000,
  );
});
