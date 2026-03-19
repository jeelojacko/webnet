/** @vitest-environment jsdom */

import React, { act, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import ReportView from '../src/components/ReportView';
import WorkspaceReviewActions from '../src/components/WorkspaceReviewActions';
import { LSAEngine } from '../src/engine/adjust';
import { buildQaDerivedResult } from '../src/engine/qaWorkflow';
import { useWorkspaceReviewState } from '../src/hooks/useWorkspaceReviewState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 100 80 0',
  'D A-C 128.0624847 0.005',
  'D B-C 80.0000000 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

const buildResult = () => {
  const result = new LSAEngine({ input, maxIterations: 8 }).solve();
  const suspects = result.observations.filter((obs) => obs.type === 'dist').slice(0, 2);
  suspects.forEach((obs, index) => {
    obs.stdRes = 3.5 - index;
  });
  return result;
};

const WorkspaceReviewHarness: React.FC<{ onJumpToSourceLine: (_line: number) => void }> = ({
  onJumpToSourceLine,
}) => {
  const result = useMemo(() => buildResult(), []);
  const derivedResult = useMemo(() => buildQaDerivedResult(result), [result]);
  const reviewState = useWorkspaceReviewState({
    derivedResult,
    result,
    excludedIds: new Set<number>(),
  });
  const [showReport, setShowReport] = useState(true);
  const [focusFilterRequestKey, setFocusFilterRequestKey] = useState(0);

  return (
    <div>
      <button data-testid="toggle-report" onClick={() => setShowReport((current) => !current)}>
        toggle report
      </button>
      <div data-testid="selected-observation">{reviewState.selection.observationId ?? '-'}</div>
      <WorkspaceReviewActions
        canNavigateSuspects={reviewState.hasSuspects}
        canJumpToInput={reviewState.selection.sourceLine != null}
        canPinSelectedObservation={reviewState.selectedObservation != null}
        isSelectedObservationPinned={
          reviewState.selectedObservation != null &&
          reviewState.pinnedObservations.some(
            (entry) => entry.id === reviewState.selectedObservation?.id,
          )
        }
        onSelectPreviousSuspect={reviewState.selectPreviousSuspect}
        onSelectNextSuspect={reviewState.selectNextSuspect}
        onJumpToInput={() => {
          if (reviewState.selection.sourceLine != null) {
            onJumpToSourceLine(reviewState.selection.sourceLine);
          }
        }}
        onTogglePinSelectedObservation={() => {
          if (reviewState.selectedObservation) {
            reviewState.togglePinnedObservation(reviewState.selectedObservation.id);
          }
        }}
        onFocusReportFilter={() => {
          setShowReport(true);
          setFocusFilterRequestKey((current) => current + 1);
        }}
      />
      {showReport && (
        <ReportView
          result={result}
          units="m"
          viewState={reviewState}
          runDiagnostics={null}
          excludedIds={new Set<number>()}
          onToggleExclude={() => {}}
          onApplyImpactExclude={() => {}}
          onApplyPreanalysisAction={() => {}}
          onReRun={() => {}}
          onClearExclusions={() => {}}
          onJumpToSourceLine={onJumpToSourceLine}
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
          selectedStationId={reviewState.selection.stationId}
          selectedObservationId={reviewState.selection.observationId}
          onSelectStation={(stationId) => reviewState.selectStation(stationId, 'report')}
          onSelectObservation={(observationId) =>
            reviewState.selectObservation(observationId, 'report')
          }
          focusFilterRequestKey={focusFilterRequestKey}
        />
      )}
    </div>
  );
};

describe('workspace review quick actions', () => {
  it('keeps review actions working across report remounts and focuses the filter on request', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const jumpSpy = vi.fn();

    await act(async () => {
      root.render(<WorkspaceReviewHarness onJumpToSourceLine={jumpSpy} />);
    });

    const getAction = (id: string) =>
      container.querySelector(`[data-qa-review-action="${id}"]`) as HTMLButtonElement;
    const reportFilter = () =>
      container.querySelector('input[aria-label="Report filter text"]') as HTMLInputElement | null;
    const selectedObservationText = () =>
      container.querySelector('[data-testid="selected-observation"]')?.textContent ?? '';

    expect(container.textContent).toContain('Adjustment Summary');

    await act(async () => {
      getAction('next-suspect').click();
      await Promise.resolve();
    });

    const selectedObservationId = selectedObservationText();
    expect(selectedObservationId).not.toBe('-');
    const selectedRow = container.querySelector(
      `[data-report-observation-row="${selectedObservationId}"]`,
    ) as HTMLTableRowElement;
    expect(selectedRow.className).toContain('bg-cyan-950/30');

    await act(async () => {
      getAction('pin-selected').click();
      getAction('jump-input').click();
      await Promise.resolve();
    });

    expect(getAction('pin-selected').textContent).toContain('Unpin selected');
    expect(jumpSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      (container.querySelector('[data-testid="toggle-report"]') as HTMLButtonElement).click();
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain('Adjustment Summary');

    await act(async () => {
      getAction('focus-filter').click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Adjustment Summary');
    expect(reportFilter()).not.toBeNull();
    expect(document.activeElement).toBe(reportFilter());
    const remountedSelectedRow = container.querySelector(
      `[data-report-observation-row="${selectedObservationId}"]`,
    ) as HTMLTableRowElement;
    expect(remountedSelectedRow.className).toContain('bg-cyan-950/30');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
