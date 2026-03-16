/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import ReportView from '../src/components/ReportView';
import { LSAEngine } from '../src/engine/adjust';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseInput = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

const createLargeResult = () => {
  const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
  const distObservation = result.observations.find((obs) => obs.type === 'dist');
  const angleObservation = result.observations.find((obs) => obs.type === 'angle');
  const sampleStation = Object.values(result.stations)[0];

  if (!distObservation || !angleObservation || !sampleStation) {
    throw new Error('Expected baseline solve to produce angle, distance, and station rows.');
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
    ...Array.from({ length: 101 }, (_, index) => ({
      ...distObservation,
      id: 1000 + index,
      sourceLine: 5000 + index,
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
    Array.from({ length: 101 }, (_, index) => [
      `P${String(index).padStart(3, '0')}`,
      {
        ...sampleStation,
        x: sampleStation.x + index,
        y: sampleStation.y + index,
        h: sampleStation.h,
        fixed: index < 2,
        errorEllipse: sampleStation.errorEllipse
          ? {
              ...sampleStation.errorEllipse,
            }
          : sampleStation.errorEllipse,
      },
    ]),
  );

  return result;
};

const mountReport = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const result = createLargeResult();

  await act(async () => {
    root.render(
      <ReportView
        result={result}
        units="m"
        runDiagnostics={null}
        excludedIds={new Set([1100])}
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

  return {
    container,
    cleanup: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const setNativeValue = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  const prototype =
    element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
};

describe('ReportView filtering and windowing', () => {
  it('filters hidden observation rows by text, type, and exclusion status', async () => {
    const mounted = await mountReport();
    const textFilter = mounted.container.querySelector(
      'input[aria-label="Report filter text"]',
    ) as HTMLInputElement;
    const typeFilter = mounted.container.querySelector(
      'select[aria-label="Observation type filter"]',
    ) as HTMLSelectElement;
    const exclusionFilter = mounted.container.querySelector(
      'select[aria-label="Observation exclusion filter"]',
    ) as HTMLSelectElement;
    const clearButton = Array.from(mounted.container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Clear filters',
    ) as HTMLButtonElement;

    expect(mounted.container.textContent).not.toContain('5100');

    await act(async () => {
      setNativeValue(textFilter, '5100');
      textFilter.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain('5100');
    expect(mounted.container.textContent).not.toContain('5000');

    await act(async () => {
      clearButton.click();
      setNativeValue(typeFilter, 'angle');
      typeFilter.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain('9000');
    expect(mounted.container.textContent).not.toContain('5000');

    await act(async () => {
      clearButton.click();
      setNativeValue(exclusionFilter, 'excluded');
      exclusionFilter.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(mounted.container.textContent).toContain('5100');
    expect(mounted.container.textContent).not.toContain('5000');

    await mounted.cleanup();
  }, 15000);

  it('expands observation and coordinate tables with show more actions', async () => {
    const mounted = await mountReport();
    const observationShowMore = mounted.container.querySelector(
      '[data-report-load-more="observations-distances-ts"]',
    ) as HTMLButtonElement;
    const coordinateShowMore = mounted.container.querySelector(
      '[data-report-load-more="adjusted-coordinates"]',
    ) as HTMLButtonElement;

    expect(mounted.container.textContent).not.toContain('5100');
    expect(mounted.container.textContent).not.toContain('P100');

    await act(async () => {
      observationShowMore.click();
    });
    expect(mounted.container.textContent).toContain('5100');

    await act(async () => {
      coordinateShowMore.click();
    });
    expect(mounted.container.textContent).toContain('P100');

    await mounted.cleanup();
  }, 15000);
});
