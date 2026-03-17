/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import ReportView from '../src/components/ReportView';
import MapView from '../src/components/MapView';
import { LSAEngine } from '../src/engine/adjust';
import { buildQaDerivedResult } from '../src/engine/qaWorkflow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 60 40 0',
  'D A-P 72.1110255 0.005',
  'D B-P 56.5685425 0.005',
  'A P-A-B 90-00-00 3',
].join('\n');

describe('report and map selection wiring', () => {
  it('emits selection callbacks from report rows and map geometry', async () => {
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();
    const derived = buildQaDerivedResult(result);
    const observationId = result.observations.find((obs) => obs.type === 'dist')?.id;
    if (observationId == null) {
      throw new Error('Expected a distance observation.');
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const stationSpy = vi.fn();
    const observationSpy = vi.fn();

    await act(async () => {
      root.render(
        <div>
          <ReportView
            result={result}
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
            selectedStationId="P"
            selectedObservationId={observationId}
            onSelectStation={stationSpy}
            onSelectObservation={observationSpy}
          />
          <MapView
            result={result}
            units="m"
            derivedResult={derived}
            selectedStationId="P"
            selectedObservationId={observationId}
            onSelectStation={stationSpy}
            onSelectObservation={observationSpy}
          />
        </div>,
      );
    });

    const stationRow = container.querySelector(
      '[data-report-station-row="P"]',
    ) as HTMLTableRowElement;
    const observationRow = container.querySelector(
      `[data-report-observation-row="${observationId}"]`,
    ) as HTMLTableRowElement;
    const mapStation = container.querySelector('[data-map-station="P"]') as SVGCircleElement;
    const mapObservation = container.querySelector(
      `[data-map-observation="${observationId}"]`,
    ) as SVGLineElement;

    await act(async () => {
      stationRow.click();
      observationRow.click();
      mapStation.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      mapObservation.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(stationSpy).toHaveBeenCalledWith('P');
    expect(observationSpy).toHaveBeenCalledWith(observationId);
    expect(stationRow.className).toContain('bg-cyan-950/30');
    expect(observationRow.className).toContain('bg-cyan-950/30');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
