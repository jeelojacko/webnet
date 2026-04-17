import React from 'react';
import type {
  ComparisonSelection,
  RunComparisonSummary,
  RunSnapshot,
  SavedRunSnapshot,
} from '../engine/qaWorkflow';

interface SavedRunRowProps<TSettingsSnapshot = unknown, TRunDiagnostics = unknown> {
  snapshot: SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>;
  isCurrent: boolean;
  canCompare: boolean;
  onRestore: (_snapshotId: string) => void;
  onCompare: (_snapshotId: string) => void;
  onRename: (_snapshotId: string, _label: string) => void;
  onNotesChange: (_snapshotId: string, _notes: string) => void;
  onDelete: (_snapshotId: string) => void;
}

const SavedRunRow = <TSettingsSnapshot, TRunDiagnostics>({
  snapshot,
  isCurrent,
  canCompare,
  onRestore,
  onCompare,
  onRename,
  onNotesChange,
  onDelete,
}: SavedRunRowProps<TSettingsSnapshot, TRunDiagnostics>) => {
  const [labelDraft, setLabelDraft] = React.useState(snapshot.label);
  const [notesDraft, setNotesDraft] = React.useState(snapshot.notes);

  React.useEffect(() => {
    setLabelDraft(snapshot.label);
    setNotesDraft(snapshot.notes);
  }, [snapshot.label, snapshot.notes]);

  return (
    <div
      className={`rounded border p-3 ${
        isCurrent
          ? 'border-cyan-500/70 bg-cyan-950/20'
          : 'border-slate-800 bg-slate-950/40'
      }`}
    >
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              type="text"
              value={labelDraft}
              onChange={(event) => setLabelDraft(event.target.value)}
              onBlur={() => onRename(snapshot.id, labelDraft)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950/60 px-3 py-2 font-mono text-sm text-slate-100"
              aria-label={`Saved run label ${snapshot.label}`}
            />
            <div className="text-xs text-slate-400">
              {snapshot.summary.converged ? 'Converged' : 'Not converged'} {' | '}SEUW{' '}
              {snapshot.summary.seuw.toFixed(4)} {' | '}Obs {snapshot.summary.observationCount}
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Saved {new Date(snapshot.savedAt).toLocaleString()}
          </div>
          <input
            type="text"
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            onBlur={() => onNotesChange(snapshot.id, notesDraft)}
            className="mt-2 w-full rounded border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs text-slate-300"
            placeholder="Add saved-run notes"
            aria-label={`Saved run notes ${snapshot.label}`}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isCurrent && (
            <span className="rounded border border-cyan-700 bg-cyan-950/40 px-2 py-1 text-[11px] uppercase tracking-wide text-cyan-100">
              Current
            </span>
          )}
          <button
            type="button"
            onClick={() => onRestore(snapshot.id)}
            className="rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-xs uppercase tracking-wide text-slate-100 hover:border-cyan-400"
          >
            Restore
          </button>
          <button
            type="button"
            onClick={() => onCompare(snapshot.id)}
            disabled={!canCompare}
            className={`rounded border px-3 py-2 text-xs uppercase tracking-wide ${
              canCompare
                ? 'border-slate-700 bg-slate-950/60 text-slate-100 hover:border-cyan-400'
                : 'border-slate-800 bg-slate-950/40 text-slate-600'
            }`}
          >
            Compare
          </button>
          <button
            type="button"
            onClick={() => onDelete(snapshot.id)}
            className="rounded border border-rose-900/70 bg-rose-950/30 px-3 py-2 text-xs uppercase tracking-wide text-rose-200 hover:border-rose-500"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

interface RunComparisonPanelProps<TSettingsSnapshot = unknown, TRunDiagnostics = unknown> {
  currentSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics> | null;
  baselineSnapshot: RunSnapshot<TSettingsSnapshot, TRunDiagnostics> | null;
  comparisonCandidates: Array<RunSnapshot<TSettingsSnapshot, TRunDiagnostics>>;
  savedRunSnapshots: Array<SavedRunSnapshot<TSettingsSnapshot, TRunDiagnostics>>;
  currentSavedRunId: string | null;
  isCurrentSnapshotSaved: boolean;
  comparisonSelection: ComparisonSelection;
  comparisonSummary: RunComparisonSummary | null;
  onSaveCurrentSnapshot: () => void;
  onRestoreSavedRun: (_snapshotId: string) => void;
  onCompareWithSavedRun: (_snapshotId: string) => void;
  onRenameSavedRun: (_snapshotId: string, _label: string) => void;
  onUpdateSavedRunNotes: (_snapshotId: string, _notes: string) => void;
  onDeleteSavedRun: (_snapshotId: string) => void;
  onSelectBaseline: (_snapshotId: string) => void;
  onTogglePinBaseline: () => void;
  onStationThresholdChange: (_value: number) => void;
  onResidualThresholdChange: (_value: number) => void;
  onSelectStation: (_stationId: string) => void;
  onSelectObservation: (_observationId: number) => void;
  reviewActionsContent?: React.ReactNode;
}

const RunComparisonPanel = <TSettingsSnapshot, TRunDiagnostics>({
  currentSnapshot,
  baselineSnapshot,
  comparisonCandidates,
  savedRunSnapshots,
  currentSavedRunId,
  isCurrentSnapshotSaved,
  comparisonSelection,
  comparisonSummary,
  onSaveCurrentSnapshot,
  onRestoreSavedRun,
  onCompareWithSavedRun,
  onRenameSavedRun,
  onUpdateSavedRunNotes,
  onDeleteSavedRun,
  onSelectBaseline,
  onTogglePinBaseline,
  onStationThresholdChange,
  onResidualThresholdChange,
  onSelectStation,
  onSelectObservation,
  reviewActionsContent = null,
}: RunComparisonPanelProps<TSettingsSnapshot, TRunDiagnostics>) => {
  const [isCollapsed, setIsCollapsed] = React.useState(true);
  const hasCurrentSnapshot = currentSnapshot != null;
  const canExpand = hasCurrentSnapshot || savedRunSnapshots.length > 0;

  return (
    <div className="border-b border-slate-800 bg-slate-900/70 px-4 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <div
          className="text-[11px] uppercase tracking-[0.2em] text-cyan-300"
          title="Compare the current run against a recent baseline, review moved stations and residual deltas, and reopen saved run artifacts."
        >
          Run Comparison
        </div>
        <button
          type="button"
          onClick={() => setIsCollapsed((current) => !current)}
          disabled={!canExpand}
          aria-label={isCollapsed ? 'Expand run comparison panel' : 'Collapse run comparison panel'}
          title={
            !canExpand
              ? 'Restore or run a current solution before opening the comparison workspace.'
              : isCollapsed
                ? 'Expand the comparison workspace and QA review actions.'
                : 'Collapse the comparison workspace and QA review actions.'
          }
          className={`inline-flex h-6 w-6 items-center justify-center rounded border text-sm ${
            canExpand
              ? 'border-slate-700 bg-slate-950/60 text-slate-200 hover:border-cyan-400'
              : 'border-slate-800 bg-slate-950/40 text-slate-600'
          }`}
        >
          {isCollapsed ? '+' : '-'}
        </button>
      </div>

      {!isCollapsed && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-slate-200">
                {currentSnapshot ? (
                  <>
                    Current: <span className="font-mono">{currentSnapshot.label}</span>
                    {baselineSnapshot ? (
                      <>
                        {' '}vs baseline <span className="font-mono">{baselineSnapshot.label}</span>
                      </>
                    ) : (
                      ' (save or restore another run to compare)'
                    )}
                  </>
                ) : (
                  'No active run restored. Restore a saved run or run adjustment to reopen comparison.'
                )}
              </div>
              <div className="mt-1 text-xs text-slate-400">
                {currentSnapshot && comparisonSummary
                  ? `${comparisonSummary.movedStations.length} moved stations, ${comparisonSummary.residualChanges.length} residual deltas`
                  : savedRunSnapshots.length > 0
                    ? 'Saved runs remain available through browser recovery and portable project exports.'
                    : 'No saved runs yet. Save the current run after a solve to persist it.'}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded border border-slate-800 bg-slate-950/40 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400">
                Saved runs {savedRunSnapshots.length}
              </div>
              <button
                type="button"
                onClick={onSaveCurrentSnapshot}
                disabled={!currentSnapshot || isCurrentSnapshotSaved}
                title={
                  !currentSnapshot
                    ? 'Run adjustment or restore a saved run before saving the current snapshot.'
                    : isCurrentSnapshotSaved
                      ? 'The current run is already stored in the saved-run snapshot list.'
                      : 'Store the current run as a persisted saved snapshot for this workspace or project file.'
                }
                className={`rounded border px-3 py-2 text-xs uppercase tracking-wide ${
                  !currentSnapshot || isCurrentSnapshotSaved
                    ? 'border-slate-800 bg-slate-950/40 text-slate-600'
                    : 'border-slate-700 bg-slate-950/60 text-slate-200 hover:border-cyan-400'
                }`}
              >
                {isCurrentSnapshotSaved ? 'Saved' : 'Save current run'}
              </button>
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-950/30 p-3">
            <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-500">Saved Runs</div>
            {savedRunSnapshots.length === 0 ? (
              <div className="text-xs text-slate-500">
                Saved snapshots will appear here after `Save current run`.
              </div>
            ) : (
              <div className="space-y-2">
                {savedRunSnapshots.map((snapshot) => (
                  <SavedRunRow
                    key={snapshot.id}
                    snapshot={snapshot}
                    isCurrent={currentSavedRunId === snapshot.id}
                    canCompare={
                      currentSnapshot != null &&
                      comparisonCandidates.some((candidate) => candidate.id === snapshot.id)
                    }
                    onRestore={onRestoreSavedRun}
                    onCompare={onCompareWithSavedRun}
                    onRename={onRenameSavedRun}
                    onNotesChange={onUpdateSavedRunNotes}
                    onDelete={onDeleteSavedRun}
                  />
                ))}
              </div>
            )}
          </div>

          {currentSnapshot && (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-4 lg:w-auto">
                <label className="text-xs text-slate-400">
                  <div
                    className="mb-1 uppercase tracking-wide text-slate-500"
                    title="Select which previous successful run or saved snapshot to use as the comparison baseline."
                  >
                    Baseline
                  </div>
                  <select
                    value={baselineSnapshot?.id ?? ''}
                    onChange={(event) => onSelectBaseline(event.target.value)}
                    title="Choose the baseline run used for move/residual comparisons."
                    className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="">Latest previous run</option>
                    {comparisonCandidates.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  <div
                    className="mb-1 uppercase tracking-wide text-slate-500"
                    title="Minimum station horizontal movement required before a station appears in the moved-stations review list."
                  >
                    Move threshold
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={comparisonSelection.stationMovementThreshold}
                    onChange={(event) =>
                      onStationThresholdChange(Number.parseFloat(event.target.value) || 0)
                    }
                    title="Set the minimum horizontal station shift that will be flagged in the comparison results."
                    className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <label className="text-xs text-slate-400">
                  <div
                    className="mb-1 uppercase tracking-wide text-slate-500"
                    title="Minimum absolute change in standardized residual before an observation appears in the residual-delta review list."
                  >
                    Residual threshold
                  </div>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={comparisonSelection.residualDeltaThreshold}
                    onChange={(event) =>
                      onResidualThresholdChange(Number.parseFloat(event.target.value) || 0)
                    }
                    title="Set the minimum standardized-residual change that will be shown in the comparison results."
                    className="w-full rounded border border-slate-700 bg-slate-950/60 px-3 py-2 text-sm text-slate-100"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    disabled={!baselineSnapshot}
                    onClick={onTogglePinBaseline}
                    title="Pin the current baseline so it stays selected while newer runs are added."
                    className={`w-full rounded border px-3 py-2 text-xs uppercase tracking-wide ${
                      baselineSnapshot
                        ? comparisonSelection.pinnedBaselineRunId === baselineSnapshot.id
                          ? 'border-cyan-500 bg-cyan-950/40 text-cyan-100'
                          : 'border-slate-700 bg-slate-950/60 text-slate-200 hover:border-cyan-400'
                        : 'border-slate-800 bg-slate-950/40 text-slate-600'
                    }`}
                  >
                    {comparisonSelection.pinnedBaselineRunId === baselineSnapshot?.id
                      ? 'Pinned baseline'
                      : 'Pin baseline'}
                  </button>
                </div>
              </div>
              {reviewActionsContent ? (
                <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
                  {reviewActionsContent}
                </div>
              ) : null}
            </div>
          )}

          {comparisonSummary && currentSnapshot && (
            <div className="grid gap-3 xl:grid-cols-[1.1fr_1fr_1fr]">
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <div
              className="mb-2 text-[11px] uppercase tracking-wide text-slate-500"
              title="High-level differences between the current run and the selected baseline."
            >
              Summary
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {comparisonSummary.summaryRows.map((row) => (
                <div
                  key={row.label}
                  className="rounded border border-slate-800/60 bg-slate-950/50 px-3 py-2 text-xs"
                >
                  <div className="text-slate-500">{row.label}</div>
                  <div className="mt-1 text-slate-100">
                    {row.baseline} {'->'} {row.current}
                  </div>
                  <div className="text-cyan-300">{row.delta}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-slate-400">
              Exclusions +{comparisonSummary.exclusionChanges.added.length} / -
              {comparisonSummary.exclusionChanges.removed.length}
              {' | '}Overrides +{comparisonSummary.overrideChanges.added.length} / -
              {comparisonSummary.overrideChanges.removed.length}
              {' | '}Cluster merges{' '}
              {comparisonSummary.clusterMergeDelta >= 0 ? '+' : ''}
              {comparisonSummary.clusterMergeDelta}
            </div>
            {comparisonSummary.settingsDiffs.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">
                  Settings
                </div>
                <div className="flex flex-wrap gap-2">
                  {comparisonSummary.settingsDiffs.slice(0, 6).map((diff) => (
                    <span
                      key={diff}
                      className="rounded border border-slate-800 bg-slate-950/60 px-2 py-1 text-[11px] text-slate-300"
                    >
                      {diff}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <div
              className="mb-2 text-[11px] uppercase tracking-wide text-slate-500"
              title="Stations whose horizontal movement exceeds the configured move threshold."
            >
              Moved Stations
            </div>
            {comparisonSummary.movedStations.length === 0 ? (
              <div className="text-xs text-slate-500">
                No stations exceeded the movement threshold.
              </div>
            ) : (
              <div className="space-y-2">
                {comparisonSummary.movedStations.slice(0, 8).map((row) => (
                  <button
                    key={row.stationId}
                    type="button"
                    data-run-compare-station={row.stationId}
                    onClick={() => onSelectStation(row.stationId)}
                    className="flex w-full items-center justify-between rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-left text-xs hover:border-cyan-400"
                  >
                    <span className="font-mono text-slate-100">{row.stationId}</span>
                    <span className="text-cyan-300">{row.deltaHorizontal.toFixed(4)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            <div
              className="mb-2 text-[11px] uppercase tracking-wide text-slate-500"
              title="Observations whose absolute standardized-residual change exceeds the configured residual threshold."
            >
              Residual Deltas
            </div>
            {comparisonSummary.residualChanges.length === 0 ? (
              <div className="text-xs text-slate-500">
                No residual deltas exceeded the threshold.
              </div>
            ) : (
              <div className="space-y-2">
                {comparisonSummary.residualChanges.slice(0, 8).map((row) => (
                  <button
                    key={`${row.type}-${row.observationId}`}
                    type="button"
                    data-run-compare-observation={row.observationId}
                    onClick={() => onSelectObservation(row.observationId)}
                    className="flex w-full items-center justify-between rounded border border-slate-800 bg-slate-950/60 px-3 py-2 text-left text-xs hover:border-cyan-400"
                  >
                    <span className="min-w-0 truncate text-slate-100">
                      {row.type.toUpperCase()} {row.stationsLabel}
                    </span>
                    <span className="ml-3 whitespace-nowrap text-cyan-300">
                      {row.deltaAbsStdRes.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default RunComparisonPanel;
