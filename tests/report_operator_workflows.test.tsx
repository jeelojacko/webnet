/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import ReportView from '../src/components/ReportView';
import { LSAEngine } from '../src/engine/adjust';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const baseInput = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 100 80 0',
  'D A-C 128.0624847 0.005',
  'D B-C 80.0000000 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

describe('ReportView operator workflows', () => {
  it('shows pending rerun diffs, emits source-line callbacks, and supports pinned sections', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    const jumpSpy = vi.fn();
    const scrollSpy = vi.fn();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollSpy;

    await act(async () => {
      root.render(
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
          onJumpToSourceLine={jumpSpy}
          pendingRunSettingDiffs={['Units: m -> ft', 'Run Mode: adjustment -> data-check']}
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

    expect(container.textContent).toContain('Pending rerun settings diff');
    expect(container.textContent).toContain('Units: m -> ft');

    const jumpButton = container.querySelector(
      'button[title="Jump to line 5 in the input editor"]',
    ) as HTMLButtonElement;
    await act(async () => {
      jumpButton.click();
    });
    expect(jumpSpy).toHaveBeenCalledWith(5);

    const pinButton = container.querySelector(
      'button[title="Pin Angles (TS)"]',
    ) as HTMLButtonElement;
    await act(async () => {
      pinButton.click();
    });
    expect(container.textContent).toContain('Pinned Sections');

    const pinnedChip = container.querySelector(
      '[data-report-pinned-chip="angles-ts"]',
    ) as HTMLButtonElement;
    await act(async () => {
      pinnedChip.click();
    });
    expect(scrollSpy).toHaveBeenCalled();

    Element.prototype.scrollIntoView = originalScrollIntoView;
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('surfaces weighted-control station badges with component traceability in adjusted coordinates', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const result = new LSAEngine({
      input: [
        '.3D',
        'C A 0 0 0 0.010 0.010 0.020',
        'C B 100 0 0 ! ! !',
        'C P 60 40 10',
        'D B-P 56.5685425 0.005',
        'B B-P 123-41-24.1 2',
        'G A P 60 40 0.010 0.010',
      ].join('\n'),
      maxIterations: 8,
    }).solve();

    await act(async () => {
      root.render(
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
        />,
      );
    });

    const controlBadge = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'CTRL',
    ) as HTMLSpanElement | undefined;
    expect(controlBadge).toBeDefined();
    expect(controlBadge?.title).toContain('N:WEIGHTED');
    expect(controlBadge?.title).toContain('E:WEIGHTED');
    expect(controlBadge?.title).toContain('H:WEIGHTED');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
