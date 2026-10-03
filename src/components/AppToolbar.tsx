import React from 'react';
import {
  Activity,
  Download,
  FileText,
  FolderOpen,
  GraduationCap,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Ruler,
  Save,
  Send,
  Settings,
  Square,
} from 'lucide-react';
import { EXPORT_FORMAT_OPTIONS } from '../engine/exportFormats';
import type { ProjectExportFormat } from '../types';
import type { ResultIntegrityState } from '../engine/resultIntegrity';
import { resultIntegrityBadge, type RunStatusTone } from './resultStatusPresentation';
import type { RunPipelineState } from '../hooks/useAdjustmentRunner';

interface AppToolbarProps {
  isSidebarOpen: boolean;
  showSidebarToggle?: boolean;
  onToggleSidebar: () => void;
  onOpenProjectOptions: () => void;
  onOpenSurveyCad: () => void;
  onSendToCad?: () => void;
  canSendToCad?: boolean;
  sendToCadBlockMessage?: string | null;
  onOpenStudy: () => void;
  onOpenImportFile: () => void;
  onOpenProjectFile: () => void;
  onSaveProject: () => void;
  exportFormat: ProjectExportFormat;
  onExportFormatChange: (_format: ProjectExportFormat) => void;
  exportTooltip: string;
  exportLabel: string;
  onExportResults: () => void;
  canExport: boolean;
  hasStoredDraft: boolean;
  onClearCurrentDraft: () => void;
  selectedObservationId: number | null;
  isSelectedObservationPinned: boolean;
  onTogglePinSelectedObservation: () => void;
  pipelineState: RunPipelineState;
  integrityState?: ResultIntegrityState;
  integrityBlockMessage?: string | null;
  runPhaseLabel: string | null;
  pendingRunSettingDiffs: string[];
  onCancelRun: () => void;
  onRun: () => void;
  onResetToLastRun: () => void;
}

const AppToolbar: React.FC<AppToolbarProps> = ({
  isSidebarOpen,
  showSidebarToggle = true,
  onToggleSidebar,
  onOpenProjectOptions,
  onOpenSurveyCad,
  onSendToCad,
  canSendToCad = false,
  sendToCadBlockMessage = null,
  onOpenStudy,
  onOpenImportFile,
  onOpenProjectFile,
  onSaveProject,
  exportFormat,
  onExportFormatChange,
  exportTooltip,
  exportLabel,
  onExportResults,
  canExport,
  hasStoredDraft,
  onClearCurrentDraft,
  selectedObservationId,
  isSelectedObservationPinned,
  onTogglePinSelectedObservation,
  pipelineState,
  integrityState = 'NO_RESULT',
  integrityBlockMessage = null,
  runPhaseLabel,
  pendingRunSettingDiffs,
  onCancelRun,
  onRun,
  onResetToLastRun,
}) => {
  const formatElapsed = (elapsedMs: number | null): string => {
    if (elapsedMs == null || !Number.isFinite(elapsedMs) || elapsedMs < 0) return '';
    const totalSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const runSourceLabel = pipelineState.workerBacked ? 'Worker' : 'Direct';
  const elapsedLabel = formatElapsed(pipelineState.elapsedMs);
  const integrityBadge = resultIntegrityBadge(integrityState);
  const integrityToneClass: Record<RunStatusTone, string> = {
    success: 'text-green-400',
    planning: 'text-amber-300',
    failure: 'text-red-400',
    muted: 'text-slate-400',
  };
  // Preanalysis planning depth is data-dependent: show a count, never x/y
  // over a moving denominator.
  const solveProgressLabel =
    pipelineState.stageId === 'preanalysis-impact'
      ? pipelineState.solveIndex != null
        ? `Planning checks ${pipelineState.solveIndex}`
        : null
      : pipelineState.solveIndex != null && pipelineState.solveTotalHint != null
        ? `${pipelineState.solveIndex}/${pipelineState.solveTotalHint}`
        : null;
  const iterationLabel =
    pipelineState.iteration != null && pipelineState.maxIterations != null
      ? `iter ${pipelineState.iteration}/${pipelineState.maxIterations}`
      : null;

  return (
    <header
      data-testid="app-toolbar"
      className="bg-slate-800 border-b border-slate-700 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 md:px-4 shrink-0 w-full min-w-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0 flex-1">
        {showSidebarToggle ? (
          <button
            onClick={onToggleSidebar}
            aria-label={isSidebarOpen ? 'Close Input Sidebar' : 'Open Input Sidebar'}
            className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
            title={isSidebarOpen ? 'Close Input Sidebar' : 'Open Input Sidebar'}
          >
            {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
          </button>
        ) : null}
        <div className="flex items-center space-x-2 min-w-0">
          <Activity className="text-blue-400" size={24} />
          <div className="flex flex-col min-w-0">
            <h1 className="text-lg font-bold tracking-wide text-white leading-none truncate">
              WebNet <span className="text-blue-400 font-light">Adjustment</span>
            </h1>
            <span className="text-xs text-slate-500 truncate">
              Survey LSA - TS + GPS + Leveling
            </span>
          </div>
        </div>
        <button
          onClick={onOpenProjectOptions}
          title="Open industry-style project options"
          aria-label="Open project options"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs uppercase tracking-wide bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700 shrink-0"
        >
          <Settings size={16} />
          <span className="hidden xl:inline">Project Options</span>
        </button>
        <button
          onClick={onOpenSurveyCad}
          title="Open WebNet CAD in its own workspace"
          aria-label="Open WebNet CAD"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs uppercase tracking-wide bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700 shrink-0"
        >
          <Ruler size={16} />
          <span className="hidden xl:inline">Open CAD</span>
        </button>
        <button
          onClick={onSendToCad}
          disabled={!onSendToCad || !canSendToCad}
          title={
            canSendToCad
              ? 'Publish this adjustment result as a CAD source and open WebNet CAD'
              : `Send to CAD is available after a fresh successful production run${sendToCadBlockMessage ? `: ${sendToCadBlockMessage}` : ''}`
          }
          aria-label="Send to CAD"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs uppercase tracking-wide bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 shrink-0"
        >
          <Send size={16} />
          <span className="hidden xl:inline">Send to CAD</span>
        </button>
        <button
          onClick={onOpenStudy}
          title="Open WebNet Study"
          aria-label="Open WebNet Study"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded border text-xs uppercase tracking-wide bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700 shrink-0"
        >
          <GraduationCap size={16} />
          <span className="hidden xl:inline">Study</span>
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 ml-auto min-w-0 justify-end">
        <button
          onClick={onOpenImportFile}
          title="Open data/import file"
          aria-label="Open data/import file"
          className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors shrink-0"
        >
          <FileText size={18} />
        </button>
        <button
          onClick={onOpenProjectFile}
          title="Open local project workspace or portable project import"
          aria-label="Open local project workspace"
          className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors shrink-0"
        >
          <FolderOpen size={18} />
        </button>
        <button
          onClick={onSaveProject}
          title="Save the current local browser project"
          aria-label="Save project"
          className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors shrink-0"
        >
          <Save size={18} />
        </button>
        <button
          onClick={onClearCurrentDraft}
          disabled={!hasStoredDraft}
          title={
            hasStoredDraft
              ? 'Clear the browser-local draft recovery snapshot'
              : 'No local draft to clear'
          }
          className={`p-2 rounded text-slate-300 transition-colors shrink-0 ${
            hasStoredDraft
              ? 'bg-slate-700 hover:bg-slate-600'
              : 'bg-slate-800 opacity-50 cursor-not-allowed'
          }`}
        >
          <RotateCcw size={18} />
        </button>
        <select
          value={exportFormat}
          onChange={(e) => onExportFormatChange(e.target.value as ProjectExportFormat)}
          title={exportTooltip}
          aria-label="Export format"
          className="h-9 min-w-0 max-w-full bg-slate-700 border border-slate-600 text-slate-100 text-xs rounded px-2"
        >
          {EXPORT_FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {`Export: ${option.optionLabel}`}
            </option>
          ))}
        </select>
        <button
          onClick={onExportResults}
          disabled={!canExport}
          title={
            !canExport
              ? 'Run adjustment to export results'
              : (integrityBlockMessage ?? `Export ${exportLabel}`)
          }
          aria-label={`Export ${exportLabel}`}
          className={`p-2 rounded text-slate-300 transition-colors shrink-0 ${
            canExport
              ? 'bg-slate-700 hover:bg-slate-600'
              : 'bg-slate-800 opacity-50 cursor-not-allowed'
          }`}
        >
          <Download size={18} />
        </button>
        {selectedObservationId != null && (
          <button
            onClick={onTogglePinSelectedObservation}
            title="Pin or unpin the selected observation for quick return"
            className="h-9 px-3 rounded bg-slate-700 hover:bg-slate-600 text-[11px] uppercase tracking-wide text-slate-200 transition-colors"
          >
            {isSelectedObservationPinned ? 'Unpin' : 'Pin Row'}
          </button>
        )}
        {pipelineState.status === 'running' ? (
          <button
            onClick={onCancelRun}
            className="flex items-center gap-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-amber-900/20 shrink-0"
            title="Cancel current run"
            aria-label="Cancel current run"
          >
            <Square size={14} /> <span>Cancel</span>
          </button>
        ) : (
          <button
            onClick={onRun}
            title="Run the adjustment"
            aria-label="Adjust"
            className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-green-900/20 shrink-0"
          >
            <Play size={16} /> <span>Adjust</span>
          </button>
        )}
        {pipelineState.status !== 'running' && (
          <div
            className={`rounded border px-2 py-1 text-[10px] uppercase tracking-wide ${integrityToneClass[integrityBadge.tone]}`}
            title={integrityBlockMessage ?? `Result status: ${integrityState}`}
            data-result-integrity-status={integrityState}
            data-result-integrity-tone={integrityBadge.tone}
          >
            {integrityBadge.label}
          </div>
        )}
        {pendingRunSettingDiffs.length > 0 && pipelineState.status !== 'running' && (
          <div
            className="w-full sm:w-auto sm:max-w-[320px] rounded border border-amber-700/70 bg-amber-950/25 px-2 py-1 text-[10px] text-amber-200"
            title={pendingRunSettingDiffs.join('\n')}
          >
            {pendingRunSettingDiffs.length} setting change
            {pendingRunSettingDiffs.length === 1 ? '' : 's'} since last run
          </div>
        )}
        <button
          onClick={onResetToLastRun}
          disabled={pipelineState.status === 'running'}
          className={`p-2 rounded text-slate-300 transition-colors shrink-0 ${
            pipelineState.status === 'running'
              ? 'bg-slate-800 opacity-50 cursor-not-allowed'
              : 'bg-slate-700 hover:bg-slate-600'
          }`}
          title="Restore the last-run input and clear active results"
          aria-label="Restore the last-run input"
        >
          <RefreshCw size={18} />
        </button>
        {pipelineState.status === 'running' && runPhaseLabel ? (
          <div className="w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-[26rem] rounded border border-slate-600 bg-slate-800/80 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-300">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="truncate">{runPhaseLabel}</span>
              {elapsedLabel ? (
                <span className="text-slate-400 font-mono tabular-nums">{elapsedLabel}</span>
              ) : null}
            </div>
            <div className="mt-0.5 text-[10px] tracking-normal normal-case text-slate-500 font-mono tabular-nums break-words">
              <span>{pipelineState.detail ?? runSourceLabel}</span>
              {solveProgressLabel ? (
                <span className="whitespace-nowrap">{pipelineState.stageId === 'preanalysis-impact' ? ` · ${solveProgressLabel}` : ` · solve ${solveProgressLabel}`}</span>
              ) : null}
              {iterationLabel ? <span className="whitespace-nowrap">{` · ${iterationLabel}`}</span> : null}
              <span className="whitespace-nowrap">{` · ${runSourceLabel}`}</span>
            </div>
          </div>
        ) : null}
      </div>
    </header>
  );
};

export default AppToolbar;
