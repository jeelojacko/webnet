import WorkspaceReviewActions from '../WorkspaceReviewActions';
import type { WorkspaceTabKey } from '../../appStateTypes';

type SelectedObservation = {
  id: number;
  type: string;
  stationsLabel: string;
  sourceLine?: number | null;
};

type SelectedStation = {
  id: string;
};

type PinnedObservation = {
  id: number;
  type: string;
};

export const AppWorkspaceReviewActions = ({
  hasSuspects,
  selectedObservation,
  pinnedObservations,
  sourceLine,
  selectPreviousSuspect,
  selectNextSuspect,
  togglePinnedObservation,
  handleJumpToSourceLine,
  handleFocusReportFilter,
  setActiveTab,
}: {
  hasSuspects: boolean;
  selectedObservation: SelectedObservation | null;
  pinnedObservations: PinnedObservation[];
  sourceLine: number | null;
  selectPreviousSuspect: () => void;
  selectNextSuspect: () => void;
  togglePinnedObservation: (_id: number) => void;
  handleJumpToSourceLine: (_sourceLine: number) => void;
  handleFocusReportFilter: () => void;
  setActiveTab: (_tab: WorkspaceTabKey) => void;
}) => (
  <WorkspaceReviewActions
    canNavigateSuspects={hasSuspects}
    canJumpToInput={sourceLine != null}
    canPinSelectedObservation={selectedObservation != null}
    isSelectedObservationPinned={
      selectedObservation != null &&
      pinnedObservations.some((entry) => entry.id === selectedObservation.id)
    }
    onSelectPreviousSuspect={() => {
      selectPreviousSuspect();
      setActiveTab('report');
    }}
    onSelectNextSuspect={() => {
      selectNextSuspect();
      setActiveTab('report');
    }}
    onJumpToInput={() => {
      if (sourceLine != null) handleJumpToSourceLine(sourceLine);
    }}
    onTogglePinSelectedObservation={() => {
      if (selectedObservation) togglePinnedObservation(selectedObservation.id);
    }}
    onFocusReportFilter={handleFocusReportFilter}
  />
);

export const AppWorkspaceSelectionBar = ({
  selectedObservation,
  selectedStation,
  pinnedObservations,
  selectObservation,
  clearSelection,
  setActiveTab,
}: {
  selectedObservation: SelectedObservation | null;
  selectedStation: SelectedStation | null;
  pinnedObservations: PinnedObservation[];
  selectObservation: (_id: number, _origin: 'report') => void;
  clearSelection: () => void;
  setActiveTab: (_tab: WorkspaceTabKey) => void;
}) => {
  if (!selectedObservation && !selectedStation && pinnedObservations.length === 0) return null;

  return (
    <div className="border-b border-slate-800 bg-slate-950/90 px-4 py-2 text-xs text-slate-300">
      <div className="flex flex-wrap items-center gap-2">
        {selectedObservation && (
          <span className="rounded border border-cyan-800 bg-cyan-950/30 px-2 py-1">
            Selected obs: {selectedObservation.type.toUpperCase()} {selectedObservation.stationsLabel}
            {selectedObservation.sourceLine != null ? ` @${selectedObservation.sourceLine}` : ''}
          </span>
        )}
        {selectedStation && (
          <span className="rounded border border-amber-800 bg-amber-950/30 px-2 py-1">
            Selected station: {selectedStation.id}
          </span>
        )}
        {pinnedObservations.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-qa-pinned-observation={entry.id}
            onClick={() => {
              selectObservation(entry.id, 'report');
              setActiveTab('report');
            }}
            className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] hover:border-cyan-400"
          >
            Pinned #{entry.id} {entry.type.toUpperCase()}
          </button>
        ))}
        {(selectedObservation || selectedStation) && (
          <button
            type="button"
            onClick={clearSelection}
            className="rounded border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] hover:border-slate-500"
          >
            Clear selection
          </button>
        )}
      </div>
    </div>
  );
};
