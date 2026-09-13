/**
 * Phase 12G — static GNSS workspace modal.
 *
 * Cheapest existing anchor: a toolbar-adjacent entry point plus automatic
 * opening when a *.gvx file is picked from normal import. Legacy
 * terrestrial flow is untouched.
 */
import React from 'react';
import { GnssWorkspacePanel, type GnssExternalImport } from './GnssWorkspacePanel';

interface GnssWorkspaceModalProps {
  open: boolean;
  onClose: () => void;
  pendingExternalImport?: GnssExternalImport | null;
  onConsumeExternalImport?: () => void;
}

export const GnssWorkspaceModal: React.FC<GnssWorkspaceModalProps> = ({ open, onClose, pendingExternalImport = null, onConsumeExternalImport }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 flex items-start justify-center p-4 md:p-10"
      role="dialog"
      aria-modal="true"
      aria-label="Static GNSS baseline workspace"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      <div className="w-full max-w-6xl max-h-full overflow-auto bg-slate-900 border border-slate-600 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-2 sticky top-0">
          <div className="text-sm font-semibold tracking-wide">Static GNSS Baseline Workspace</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close GNSS workspace"
            className="text-xs px-2 py-1 border border-slate-600 rounded hover:bg-slate-700"
          >
            Close
          </button>
        </div>
        <GnssWorkspacePanel pendingExternalImport={pendingExternalImport} onConsumePendingImport={onConsumeExternalImport} />
      </div>
    </div>
  );
};
