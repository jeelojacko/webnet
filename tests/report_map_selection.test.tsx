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

const VIEW_W = 1000;
const VIEW_H = 700;

const setSvgRect = (svg: SVGSVGElement) => {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: VIEW_W,
      height: VIEW_H,
      right: VIEW_W,
      bottom: VIEW_H,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
};

const projectStation2d = (stations: Record<string, { x: number; y: number }>, stationId: string) => {
  const rows = Object.values(stations);
  const xs = rows.map((station) => station.x);
  const ys = rows.map((station) => station.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1);
  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const scale = Math.min(VIEW_W / width, VIEW_H / height);
  const offsetX = (VIEW_W - width * scale) * 0.5;
  const offsetY = (VIEW_H - height * scale) * 0.5;
  const station = stations[stationId];
  if (!station) throw new Error(`Missing station ${stationId}`);
  return {
    x: offsetX + (station.x - (minX - pad)) * scale,
    y: VIEW_H - (offsetY + (station.y - (minY - pad)) * scale),
  };
};

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
    const svg = container.querySelector('svg') as SVGSVGElement | null;
    if (!svg) throw new Error('Expected map svg');
    setSvgRect(svg);
    const stationPoint = projectStation2d(result.stations, 'P');
    const lineObservation = result.observations.find((obs) => obs.id === observationId);
    if (
      !lineObservation ||
      !('from' in lineObservation) ||
      !('to' in lineObservation) ||
      !result.stations[lineObservation.from] ||
      !result.stations[lineObservation.to]
    ) {
      throw new Error('Expected selected line observation');
    }
    const fromPoint = projectStation2d(result.stations, lineObservation.from);
    const toPoint = projectStation2d(result.stations, lineObservation.to);
    const midPoint = { x: (fromPoint.x + toPoint.x) * 0.5, y: (fromPoint.y + toPoint.y) * 0.5 };

    await act(async () => {
      stationRow.click();
      observationRow.click();
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: stationPoint.x + 1,
          clientY: stationPoint.y + 1,
        }),
      );
      svg.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: midPoint.x,
          clientY: midPoint.y,
        }),
      );
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
