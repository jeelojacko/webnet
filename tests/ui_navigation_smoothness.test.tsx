/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import MapView from '../src/components/MapView';
import ReportView from '../src/components/ReportView';
import WorkspaceChrome from '../src/components/WorkspaceChrome';
import { LSAEngine } from '../src/engine/adjust';
import { buildQaDerivedResult } from '../src/engine/qaWorkflow';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const benchmarkInput = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

const createLargeResult = () => {
  const result = new LSAEngine({ input: benchmarkInput, maxIterations: 8 }).solve();
  const distObservation = result.observations.find((obs) => obs.type === 'dist');
  const angleObservation = result.observations.find((obs) => obs.type === 'angle');
  const sampleStation = Object.values(result.stations)[0];

  if (!distObservation || !angleObservation || !sampleStation) {
    throw new Error('Expected baseline solve rows for benchmark test.');
  }

  result.observations = [
    {
      ...angleObservation,
      id: 9000,
      sourceLine: 9000,
      at: 'ANG',
      from: 'AA',
      to: 'BB',
    },
    ...Array.from({ length: 140 }, (_, index) => ({
      ...distObservation,
      id: 2000 + index,
      sourceLine: 7000 + index,
      from: `P${String(index).padStart(3, '0')}`,
      to: `Q${String(index).padStart(3, '0')}`,
      obs: distObservation.obs + index * 0.0001,
      calc:
        typeof distObservation.calc === 'number'
          ? distObservation.calc + index * 0.0001
          : distObservation.calc,
    })),
  ];

  result.stations = Object.fromEntries(
    Array.from({ length: 140 }, (_, index) => [
      `P${String(index).padStart(3, '0')}`,
      {
        ...sampleStation,
        x: sampleStation.x + index,
        y: sampleStation.y + index,
        h: sampleStation.h,
        fixed: index < 2,
        ...(sampleStation.errorEllipse ? { errorEllipse: { ...sampleStation.errorEllipse } } : {}),
      },
    ]),
  );

  return result;
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const clickTabByText = async (container: HTMLElement, text: string) => {
  const target = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
  if (!target) throw new Error(`Tab button "${text}" not found.`);
  await act(async () => {
    target.click();
    await Promise.resolve();
  });
};

const setSvgRect = (svg: SVGSVGElement) => {
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 1000,
      height: 700,
      right: 1000,
      bottom: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
};

const runMapInteractionBurst = async (container: HTMLElement) => {
  const svg = container.querySelector('svg') as SVGSVGElement | null;
  if (!svg) throw new Error('Map svg not found');
  setSvgRect(svg);
  await act(async () => {
    for (let i = 0; i < 8; i += 1) {
      svg.dispatchEvent(
        new WheelEvent('wheel', {
          deltaY: -80,
          clientX: 500 + i,
          clientY: 340 + i,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
    svg.dispatchEvent(
      new MouseEvent('mousedown', {
        button: 1,
        clientX: 500,
        clientY: 350,
        bubbles: true,
      }),
    );
    for (let i = 0; i < 10; i += 1) {
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          clientX: 500 + i * 3,
          clientY: 350 + i * 2,
          bubbles: true,
        }),
      );
    }
    window.dispatchEvent(new MouseEvent('mouseup', { button: 1, bubbles: true }));
    await Promise.resolve();
  });
};

const findCheckboxByLabel = (container: HTMLElement, labelText: string): HTMLInputElement => {
  const label = Array.from(container.querySelectorAll('label')).find((entry) =>
    entry.textContent?.toLowerCase().includes(labelText.toLowerCase()),
  );
  if (!label) throw new Error(`Checkbox label "${labelText}" not found.`);
  const input = label.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  if (!input) throw new Error(`Checkbox input for "${labelText}" not found.`);
  return input;
};

describe('UI navigation smoothness', () => {
  it('keeps tab-switch sequence within benchmark guardrail on dense UI content', async () => {
    const result = createLargeResult();
    const derived = buildQaDerivedResult(result);

    const Harness: React.FC = () => {
      const [activeTab, setActiveTab] = React.useState<
        'report' | 'processing-summary' | 'industry-output' | 'map'
      >('report');
      const [selectedStationId, setSelectedStationId] = React.useState<string | null>('P000');
      const [selectedObservationId, setSelectedObservationId] = React.useState<number | null>(
        result.observations[0]?.id ?? null,
      );
      const [mapSnapshot, setMapSnapshot] = React.useState<unknown>(null);

      return (
        <WorkspaceChrome
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          isSidebarOpen={true}
          onShowInput={() => {}}
          hasResult={true}
          reportContent={
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
              selectedStationId={selectedStationId}
              selectedObservationId={selectedObservationId}
              onSelectStation={setSelectedStationId}
              onSelectObservation={setSelectedObservationId}
            />
          }
          processingSummaryContent={<div className="p-2 text-xs">Processing summary</div>}
          industryOutputContent={<pre>{'INDUSTRY OUTPUT\n'.repeat(1600)}</pre>}
          mapContent={
            <MapView
              result={result}
              units="m"
              derivedResult={derived}
              selectedStationId={selectedStationId}
              selectedObservationId={selectedObservationId}
              onSelectStation={setSelectedStationId}
              onSelectObservation={setSelectedObservationId}
              snapshot={mapSnapshot as any}
              onSnapshotChange={setMapSnapshot}
            />
          }
        />
      );
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<Harness />);
    });

    const samples: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const sampleStart = performance.now();
      await clickTabByText(container, 'Map & Ellipses');
      await clickTabByText(container, 'Industry Standard Output');
      await clickTabByText(container, 'Adjustment Report');
      samples.push(performance.now() - sampleStart);
    }

    expect(median(samples)).toBeLessThan(3500);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  }, 20000);

  it('persists map UI navigation state through remount via snapshot contract', async () => {
    const result = createLargeResult();
    const derived = buildQaDerivedResult(result);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    let snapshot: unknown = null;

    await act(async () => {
      root.render(
        <MapView
          result={result}
          units="m"
          derivedResult={derived}
          snapshot={snapshot as any}
          onSnapshotChange={(next) => {
            snapshot = next;
          }}
        />,
      );
    });

    const hideMinor = findCheckboxByLabel(container, 'Hide minor geometry');
    const focusSelection = findCheckboxByLabel(container, 'Focus selection');

    await act(async () => {
      hideMinor.click();
      focusSelection.click();
    });

    const capturedSnapshot = snapshot as { hideMinorGeometry?: boolean; focusSelection?: boolean };
    expect(capturedSnapshot.hideMinorGeometry).toBe(true);
    expect(capturedSnapshot.focusSelection).toBe(true);

    await act(async () => {
      root.unmount();
    });

    const remountRoot: Root = createRoot(container);
    await act(async () => {
      remountRoot.render(
        <MapView
          result={result}
          units="m"
          derivedResult={derived}
          snapshot={snapshot as any}
          onSnapshotChange={(next) => {
            snapshot = next;
          }}
        />,
      );
    });

    const hideMinorAfterRemount = findCheckboxByLabel(container, 'Hide minor geometry');
    const focusSelectionAfterRemount = findCheckboxByLabel(container, 'Focus selection');

    expect(hideMinorAfterRemount.checked).toBe(true);
    expect(focusSelectionAfterRemount.checked).toBe(true);

    await act(async () => {
      remountRoot.unmount();
    });
    container.remove();
  });

  it('keeps report-map interaction navigation sequence within benchmark guardrail', async () => {
    const result = createLargeResult();
    const derived = buildQaDerivedResult(result);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness: React.FC = () => {
      const [activeTab, setActiveTab] = React.useState<
        'report' | 'processing-summary' | 'industry-output' | 'map'
      >('report');
      const [selectedStationId, setSelectedStationId] = React.useState<string | null>('P000');
      const [selectedObservationId, setSelectedObservationId] = React.useState<number | null>(
        result.observations[0]?.id ?? null,
      );
      const [mapSnapshot, setMapSnapshot] = React.useState<unknown>(null);

      return (
        <WorkspaceChrome
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          isSidebarOpen={true}
          onShowInput={() => {}}
          hasResult={true}
          reportContent={
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
              selectedStationId={selectedStationId}
              selectedObservationId={selectedObservationId}
              onSelectStation={setSelectedStationId}
              onSelectObservation={setSelectedObservationId}
            />
          }
          processingSummaryContent={<div className="p-2 text-xs">Processing summary</div>}
          industryOutputContent={<pre>{'INDUSTRY OUTPUT\n'.repeat(1600)}</pre>}
          mapContent={
            <MapView
              result={result}
              units="m"
              derivedResult={derived}
              selectedStationId={selectedStationId}
              selectedObservationId={selectedObservationId}
              onSelectStation={setSelectedStationId}
              onSelectObservation={setSelectedObservationId}
              snapshot={mapSnapshot as any}
              onSnapshotChange={setMapSnapshot}
            />
          }
        />
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const samples: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const sampleStart = performance.now();
      await clickTabByText(container, 'Map & Ellipses');
      await runMapInteractionBurst(container);
      await clickTabByText(container, 'Adjustment Report');
      samples.push(performance.now() - sampleStart);
    }
    expect(median(samples)).toBeLessThan(4500);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  }, 20000);
});
