import React from 'react';
import type { PinnedDetailSection } from '../../hooks/useReportViewState';

interface PinnedSectionsPanelProps {
  pinnedDetailSections: PinnedDetailSection[];
  onClearPins: () => void;
  onJumpToPinnedSection: (_id: PinnedDetailSection['id']) => void;
}

const PinnedSectionsPanel: React.FC<PinnedSectionsPanelProps> = ({
  pinnedDetailSections,
  onClearPins,
  onJumpToPinnedSection,
}) => {
  if (pinnedDetailSections.length === 0) return null;

  return (
    <div
      className="mb-4 rounded border border-blue-900/50 bg-slate-900/50 px-4 py-3 text-xs text-slate-300"
      style={{ order: -205 }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="font-semibold uppercase tracking-wide text-blue-300">Pinned Sections</div>
        <button
          type="button"
          onClick={onClearPins}
          className="rounded border border-slate-700 px-2 py-1 text-[10px] uppercase tracking-wide text-slate-300 hover:bg-slate-800"
        >
          Clear Pins
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {pinnedDetailSections.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => onJumpToPinnedSection(entry.id)}
            className="rounded border border-blue-700/50 bg-blue-900/20 px-2 py-1 text-blue-200 hover:bg-blue-900/35"
            data-report-pinned-chip={entry.id}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
};

export default PinnedSectionsPanel;
