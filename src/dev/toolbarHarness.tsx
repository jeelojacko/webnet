/* eslint-disable react-refresh/only-export-components -- dev-only browser harness, no fast refresh */
import React from 'react';
import { createRoot } from 'react-dom/client';

import '../index.css';
import AppToolbar from '../components/AppToolbar';
import ReportToolbar from '../components/report/ReportToolbar';
import type { RunPipelineState } from '../hooks/useAdjustmentRunner';

const noop = () => {};

const runningPipeline: RunPipelineState = {
  status: 'running',
  runId: 'harness-run',
  phase: 'solving',
  error: null,
  workerBacked: true,
  elapsedMs: 12_345,
  detail: 'Preanalysis planning checks',
  stageId: 'preanalysis-impact',
  solveIndex: 4,
  solveTotalHint: null,
  iteration: 2,
  maxIterations: 10,
};

const idlePipeline: RunPipelineState = {
  status: 'idle',
  runId: null,
  phase: null,
  error: null,
  workerBacked: true,
  elapsedMs: null,
  detail: null,
  stageId: null,
  solveIndex: null,
  solveTotalHint: null,
  iteration: null,
  maxIterations: null,
};

type AppToolbarExampleProps = {
  pipelineState: RunPipelineState;
  runPhaseLabel: string | null;
  selectedObservationId: number | null;
  integrityState: 'FRESH_SUCCESS' | 'STALE_SUCCESS';
};

const AppToolbarExample = ({
  pipelineState,
  runPhaseLabel,
  selectedObservationId,
  integrityState,
}: AppToolbarExampleProps) => (
  <AppToolbar
    isSidebarOpen
    onToggleSidebar={noop}
    onOpenProjectOptions={noop}
    onOpenSurveyCad={noop}
    onSendToCad={noop}
    canSendToCad={false}
    sendToCadBlockMessage={null}
    onOpenStudy={noop}
    onOpenImportFile={noop}
    onOpenProjectFile={noop}
    onSaveProject={noop}
    exportFormat="points"
    onExportFormatChange={noop}
    exportTooltip="Export tooltip"
    exportLabel="Adjusted points"
    onExportResults={noop}
    canExport
    hasStoredDraft
    onClearCurrentDraft={noop}
    selectedObservationId={selectedObservationId}
    isSelectedObservationPinned={false}
    onTogglePinSelectedObservation={noop}
    pipelineState={pipelineState}
    integrityState={integrityState}
    runPhaseLabel={runPhaseLabel}
    pendingRunSettingDiffs={[]}
    onCancelRun={noop}
    onRun={noop}
    onResetToLastRun={noop}
  />
);

const Harness = () => (
  <div data-testid="toolbar-harness" className="bg-slate-900 text-slate-100">
    <div data-testid="running-toolbar-host">
      <AppToolbarExample
        pipelineState={runningPipeline}
        runPhaseLabel="Solving"
        selectedObservationId={null}
        integrityState="STALE_SUCCESS"
      />
    </div>
    <div data-testid="idle-toolbar-host">
      <AppToolbarExample
        pipelineState={idlePipeline}
        runPhaseLabel={null}
        selectedObservationId={42}
        integrityState="FRESH_SUCCESS"
      />
    </div>
    <div data-testid="report-toolbar-host">
      <ReportToolbar
        onReRun={noop}
        onToggleCollapseAll={noop}
        allDetailSectionsCollapsed={false}
        onClearExclusions={noop}
        onResetOverrides={noop}
        showClusterMergeRevert
        clusterAppliedMergeCount={2}
        clusterRevertDisabledReason="No applied cluster merges"
        onClearClusterMerges={noop}
        unitScale={1}
        units="m"
      />
    </div>
  </div>
);

createRoot(document.getElementById('root') as HTMLElement).render(<Harness />);
