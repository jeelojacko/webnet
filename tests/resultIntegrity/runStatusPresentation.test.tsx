import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import AppToolbar from '../../src/components/AppToolbar';
import ReportView from '../../src/components/ReportView';
import {
  adjustmentSummaryStatus,
  resultIntegrityBadge,
} from '../../src/components/resultStatusPresentation';
import { LSAEngine } from '../../src/engine/adjust';
import type { ResultIntegrityState } from '../../src/engine/resultIntegrity';
import type { RunPipelineState } from '../../src/hooks/useAdjustmentRunner';
import type { AdjustmentResult } from '../../src/typesAdjustmentResult';

const successfulInput = readFileSync('tests/fixtures/alias_phase4_mixed.dat', 'utf-8');

const solve = (runMode: 'adjustment' | 'preanalysis'): AdjustmentResult =>
  new LSAEngine({
    input: successfulInput,
    maxIterations: 15,
    parseOptions: { runMode },
  }).solve() as AdjustmentResult;

const renderReport = (result: AdjustmentResult): string =>
  renderToStaticMarkup(
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

const idlePipeline: RunPipelineState = {
  status: 'idle',
  runId: null,
  phase: null,
  error: null,
  workerBacked: false,
  elapsedMs: null,
  detail: null,
  stageId: null,
  solveIndex: null,
  solveTotalHint: null,
  iteration: null,
  maxIterations: null,
};

const renderToolbar = (integrityState: ResultIntegrityState): string =>
  renderToStaticMarkup(
    <AppToolbar
      isSidebarOpen
      onToggleSidebar={() => {}}
      onOpenProjectOptions={() => {}}
      onOpenSurveyCad={() => {}}
      onOpenStudy={() => {}}
      onOpenImportFile={() => {}}
      onOpenProjectFile={() => {}}
      onSaveProject={() => {}}
      exportFormat="webnet"
      onExportFormatChange={() => {}}
      exportTooltip="export"
      exportLabel="WebNet"
      onExportResults={() => {}}
      canExport
      hasStoredDraft={false}
      onClearCurrentDraft={() => {}}
      selectedObservationId={null}
      isSelectedObservationPinned={false}
      onTogglePinSelectedObservation={() => {}}
      pipelineState={idlePipeline}
      integrityState={integrityState}
      runPhaseLabel={null}
      pendingRunSettingDiffs={[]}
      onCancelRun={() => {}}
      onRun={() => {}}
      onResetToLastRun={() => {}}
    />,
  );

describe('run status presentation (summary vs badge)', () => {
  it('presents a deliverable production solve as a green success in both surfaces', () => {
    const result = solve('adjustment');
    expect(result.success).toBe(true);
    expect(result.converged).toBe(true);
    expect(result.preanalysisMode).not.toBe(true);

    const summary = adjustmentSummaryStatus({
      success: result.success,
      preanalysisMode: result.preanalysisMode === true,
    });
    const badge = resultIntegrityBadge('FRESH_SUCCESS');
    expect(summary).toMatchObject({ label: 'CONVERGED', tone: 'success' });
    expect(badge).toMatchObject({ label: '● Current', tone: 'success' });
    expect(renderReport(result)).toContain('>CONVERGED<');
  });

  it('presents a successful preanalysis run as planning-only, never as convergence or failure', () => {
    const result = solve('preanalysis');
    expect(result.success).toBe(true);
    expect(result.preanalysisMode).toBe(true);

    const summary = adjustmentSummaryStatus({
      success: result.success,
      preanalysisMode: true,
    });
    const badge = resultIntegrityBadge('FRESH_NOT_DELIVERABLE_MODE');
    expect(summary).toMatchObject({
      label: 'PRE-ANALYSIS COMPLETE',
      secondary: 'PLANNING ONLY',
      tone: 'planning',
    });
    expect(badge.tone).toBe('planning');
    expect(badge.label).not.toMatch(/Run failed|Current/);

    const html = renderReport(result);
    // The Adjustment Summary card block (including the PRE-ANALYSIS COMPLETE /
    // A-PRIORI SIGMA0 / RESIDUAL QC cards) is hidden for planning runs; the
    // planning sections carry the preanalysis report instead.
    expect(html).not.toContain('Adjustment Summary');
    expect(html).not.toContain('PRE-ANALYSIS COMPLETE');
    expect(html).not.toContain('PLANNING ONLY');
    expect(html).not.toContain('A-PRIORI SIGMA0');
    expect(html).not.toContain('RESIDUAL QC');
    expect(html).toContain('Preanalysis Planning Summary');
    expect(html).not.toContain('>CONVERGED<');
  });

  it('keeps a failed solve as a failure in both surfaces', () => {
    const result = solve('adjustment');
    const failed: AdjustmentResult = { ...result, success: false, converged: false };

    const summary = adjustmentSummaryStatus({ success: failed.success, preanalysisMode: false });
    const badge = resultIntegrityBadge('FRESH_FAILED');
    expect(summary).toMatchObject({ label: 'NOT CONVERGED / WARNING', tone: 'failure' });
    expect(badge).toMatchObject({ label: '✖ Run failed', tone: 'failure' });
    expect(renderReport(failed)).toContain('NOT CONVERGED / WARNING');
    expect(renderReport(failed)).not.toContain('>CONVERGED<');
  });

  it('never shows a planning-only badge as current or failed', () => {
    const planning = renderToolbar('FRESH_NOT_DELIVERABLE_MODE');
    expect(planning).toContain('Planning only');
    expect(planning).toContain('data-result-integrity-tone="planning"');
    expect(planning).not.toContain('Current');
    expect(planning).not.toContain('Run failed');
    expect(planning).not.toContain('data-result-integrity-tone="success"');
  });

  it('keeps the stale badge honest about freshness without claiming failure', () => {
    const stale = renderToolbar('STALE_SUCCESS');
    expect(stale).toContain('Stale — re-run');
    expect(stale).toContain('data-result-integrity-tone="planning"');
    expect(stale).not.toContain('Run failed');
    expect(stale).not.toContain('Current');
  });
});
