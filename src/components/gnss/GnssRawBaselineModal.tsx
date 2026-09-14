/**
 * Phase 12J.4 — raw static baseline processing modal.
 *
 * Sibling of the processed-baseline workspace modal: review/export only,
 * never touches the project.
 */
import React from 'react';
import { GnssRawBaselinePanel } from './GnssRawBaselinePanel';

interface GnssRawBaselineModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export const GnssRawBaselineModal: React.FC<GnssRawBaselineModalProps> = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 flex items-start justify-center p-4 md:p-10"
      role="dialog"
      aria-modal="true"
      aria-label="Raw static baseline processing"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-6xl max-h-full overflow-auto bg-slate-900 border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-2 sticky top-0">
          <div className="text-sm font-semibold tracking-wide">Raw Static Baseline Processing</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close raw baseline processing"
            className="text-xs px-2 py-1 border border-slate-600 rounded hover:bg-slate-700"
          >
            Close
          </button>
        </div>
        <GnssRawBaselinePanel />
      </div>
    </div>
  );
};
