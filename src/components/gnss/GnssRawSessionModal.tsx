/**
 * Phase 12J.9 Track D — raw static session review modal.
 *
 * Sibling of the single-baseline raw modal: review/export only, never
 * touches the project. Remounts the panel on restart so each session run
 * gets a fresh bounded pool.
 */
import React, { useState } from 'react';
import { GnssRawSessionPanel } from './GnssRawSessionPanel';

interface GnssRawSessionModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export const GnssRawSessionModal: React.FC<GnssRawSessionModalProps> = ({ open, onClose }) => {
  const [panelKey, setPanelKey] = useState(0);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 flex items-start justify-center p-4 md:p-10"
      role="dialog"
      aria-modal="true"
      aria-label="Raw static session review"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-6xl max-h-full overflow-auto bg-slate-900 border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-2 sticky top-0">
          <div className="text-sm font-semibold tracking-wide">Raw Static Session Review</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close raw session review"
            className="text-xs px-2 py-1 border border-slate-600 rounded hover:bg-slate-700"
          >
            Close
          </button>
        </div>
        <GnssRawSessionPanel key={panelKey} onRestart={() => setPanelKey((k) => k + 1)} />
      </div>
    </div>
  );
};
