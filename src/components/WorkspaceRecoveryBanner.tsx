import React from 'react';

interface WorkspaceRecoveryBannerProps {
  savedAt: string;
  onRecover: () => void;
  onDiscard: () => void;
}

const WorkspaceRecoveryBanner: React.FC<WorkspaceRecoveryBannerProps> = ({
  savedAt,
  onRecover,
  onDiscard,
}) => (
  <div className="border-b border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="font-semibold uppercase tracking-wide text-[11px] text-amber-300">
          Draft Recovery Available
        </div>
        <div className="mt-1 text-xs text-amber-100/90">
          A browser-local workspace draft was found from {savedAt}. Recover it or discard it and
          continue with the current session.
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onDiscard}
          className="rounded border border-amber-700 bg-amber-950/40 px-3 py-1.5 text-xs uppercase tracking-wide text-amber-100 hover:bg-amber-900/50"
        >
          Discard Draft
        </button>
        <button
          type="button"
          onClick={onRecover}
          className="rounded border border-emerald-500/70 bg-emerald-900/40 px-3 py-1.5 text-xs uppercase tracking-wide text-emerald-100 hover:bg-emerald-800/50"
        >
          Recover Draft
        </button>
      </div>
    </div>
  </div>
);

export default WorkspaceRecoveryBanner;
