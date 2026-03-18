import React from 'react';
import {
  Activity,
  Download,
  FileText,
  FolderOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Square,
} from 'lucide-react';
import type { ProjectExportFormat } from '../types';
import type { RunPipelineState } from '../hooks/useAdjustmentRunner';

interface AppToolbarProps {
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onOpenProjectOptions: () => void;
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
  runPhaseLabel: string | null;
  onCancelRun: () => void;
  onRun: () => void;
  onResetToLastRun: () => void;
}

const AppToolbar: React.FC<AppToolbarProps> = ({
  isSidebarOpen,
  onToggleSidebar,
  onOpenProjectOptions,
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
  runPhaseLabel,
  onCancelRun,
  onRun,
  onResetToLastRun,
}) => (
  <header className="h-16 bg-slate-800 border-b border-slate-700 flex items-center px-3 md:px-4 shrink-0 w-full gap-3">
    <div className="flex items-center gap-3 min-w-0 flex-1">
      <button
        onClick={onToggleSidebar}
        className="p-1.5 hover:bg-slate-700 rounded text-slate-400 hover:text-white transition-colors"
        title={isSidebarOpen ? 'Close Input Sidebar' : 'Open Input Sidebar'}
      >
        {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
      </button>
      <div className="flex items-center space-x-2 min-w-0">
        <Activity className="text-blue-400" size={24} />
        <div className="flex flex-col min-w-0">
          <h1 className="text-lg font-bold tracking-wide text-white leading-none truncate">
            WebNet <span className="text-blue-400 font-light">Adjustment</span>
          </h1>
          <span className="text-xs text-slate-500 truncate">Survey LSA - TS + GPS + Leveling</span>
        </div>
      </div>
      <button
        onClick={onOpenProjectOptions}
        title="Open industry-style project options"
        className="flex items-center space-x-2 px-3 py-1.5 rounded border text-xs uppercase tracking-wide bg-slate-900/60 border-slate-700 text-slate-300 hover:bg-slate-700"
      >
        <Settings size={14} />
        <span>Project Options</span>
      </button>
    </div>

    <div className="flex items-center gap-2 ml-auto shrink-0">
      <button
        onClick={onOpenImportFile}
        title="Open data/import file"
        className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
      >
        <FileText size={18} />
      </button>
      <button
        onClick={onOpenProjectFile}
        title="Open project file"
        className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
      >
        <FolderOpen size={18} />
      </button>
      <button
        onClick={onSaveProject}
        title="Save project file"
        className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300 transition-colors"
      >
        <Save size={18} />
      </button>
      <button
        onClick={onClearCurrentDraft}
        disabled={!hasStoredDraft}
        title={hasStoredDraft ? 'Clear the browser-local draft recovery snapshot' : 'No local draft to clear'}
        className={`p-2 rounded text-slate-300 transition-colors ${
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
        className="h-9 bg-slate-700 border border-slate-600 text-slate-100 text-xs rounded px-2"
      >
        <option value="points">Export: points</option>
        <option value="webnet">Export: WebNet</option>
        <option value="industry-style">Export: industry-style</option>
        <option value="landxml">Export: LandXML</option>
        <option value="bundle-qa-standard">Export: QA bundle</option>
        <option value="bundle-qa-standard-with-landxml">Export: QA bundle + LandXML</option>
      </select>
      <button
        onClick={onExportResults}
        disabled={!canExport}
        title={canExport ? `Export ${exportLabel}` : 'Run adjustment to export results'}
        className={`p-2 rounded text-slate-300 transition-colors ${
          canExport ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-800 opacity-50 cursor-not-allowed'
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
          className="flex items-center space-x-2 bg-amber-600 hover:bg-amber-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-amber-900/20"
          title="Cancel current run"
        >
          <Square size={14} /> <span>Cancel</span>
        </button>
      ) : (
        <button
          onClick={onRun}
          className="flex items-center space-x-2 bg-green-600 hover:bg-green-500 text-white px-4 py-1.5 rounded text-sm font-medium transition-colors shadow-lg shadow-green-900/20"
        >
          <Play size={16} /> <span>Adjust</span>
        </button>
      )}
      <button
        onClick={onResetToLastRun}
        disabled={pipelineState.status === 'running'}
        className={`p-2 rounded text-slate-300 transition-colors ${
          pipelineState.status === 'running'
            ? 'bg-slate-800 opacity-50 cursor-not-allowed'
            : 'bg-slate-700 hover:bg-slate-600'
        }`}
        title="Restore the last-run input and clear active results"
      >
        <RefreshCw size={18} />
      </button>
      {runPhaseLabel ? (
        <div className="rounded border border-slate-600 bg-slate-800/80 px-2 py-1 text-[11px] uppercase tracking-wide text-slate-300">
          {runPhaseLabel}
          <span className="ml-2 text-slate-500">
            {pipelineState.workerBacked ? 'Worker' : 'Direct'}
          </span>
        </div>
      ) : null}
    </div>
  </header>
);

export default AppToolbar;
