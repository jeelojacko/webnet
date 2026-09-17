import React from 'react';
import { useCadAppController } from './useCadAppController';
import {
  buildAdjustmentUrl,
  hasCadMigrationRequest,
  readCadSourceIdFromLocation,
} from './cadNavigation';
import { CadApplicationShell } from './shell/CadApplicationShell';

class CadErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown): { error: string } {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div className="flex h-full items-center justify-center bg-slate-950 p-6 text-center text-sm text-red-300">
          WebNet CAD hit an error: {this.state.error}. Reload to continue with a blank drawing.
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Phase 18B — standalone CAD app: adjustment-source banners + the
 * professional shell (menu/ribbon/tabs/docks/command dock/statusbar).
 * The shell owns the chrome; SurveyCadWorkspace stays the viewport.
 */
const CadApp: React.FC = () => {
  const controller = useCadAppController({
    initialSourceId:
      typeof window !== 'undefined' ? readCadSourceIdFromLocation(window.location.search) : null,
    initialMigrationRequested:
      typeof window !== 'undefined' ? hasCadMigrationRequest(window.location.search) : false,
  });
  const {
    notice,
    pendingSnapshot,
    invalidSourceId,
    migrationCandidate,
    handleImportPendingSource,
    handleDismissPendingSource,
    handleOpenMigrationCandidate,
    handleDismissMigrationCandidate,
    requireCleanOrConfirm,
  } = controller;

  const handleBackToAdjustment = (): void => {
    if (!requireCleanOrConfirm('Leave WebNet CAD')) return;
    window.location.href = buildAdjustmentUrl();
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-slate-900 text-slate-100 font-sans overflow-hidden">
      {invalidSourceId ? (
        <div className="border-b border-amber-800 bg-amber-950 px-3 py-2 text-xs text-amber-200">
          Adjustment source “{invalidSourceId}” is not available (unknown or expired). The CAD drawing
          loaded unchanged — create, open, or import from a fresh Send to CAD instead.
        </div>
      ) : null}
      {pendingSnapshot ? (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-sky-800 bg-sky-950 px-3 py-2 text-xs text-sky-100"
          data-cad-pending-source
        >
          <span>
            Adjustment source ready: {pendingSnapshot.projectName ?? pendingSnapshot.projectId} —{' '}
            {pendingSnapshot.stationCount} stations, {pendingSnapshot.coordinateContext.units}, generated{' '}
            {pendingSnapshot.generatedAt}. Nothing is imported until you choose Import.
          </span>
          <button
            type="button"
            onClick={handleImportPendingSource}
            className="px-2 py-1 border border-sky-500 rounded bg-sky-900 hover:bg-sky-800"
          >
            Import / Refresh
          </button>
          <button
            type="button"
            onClick={handleDismissPendingSource}
            className="px-2 py-1 border border-slate-600 rounded hover:bg-slate-800"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {migrationCandidate ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-violet-800 bg-violet-950 px-3 py-2 text-xs text-violet-100">
          <span>
            Legacy CAD drawing “{migrationCandidate.name}” is available from the adjustment project. Open
            it as the current drawing, or dismiss to keep working on a blank drawing.
          </span>
          <button
            type="button"
            onClick={handleOpenMigrationCandidate}
            className="px-2 py-1 border border-violet-500 rounded bg-violet-900 hover:bg-violet-800"
          >
            Open legacy drawing
          </button>
          <button
            type="button"
            onClick={handleDismissMigrationCandidate}
            className="px-2 py-1 border border-slate-600 rounded hover:bg-slate-800"
          >
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="border-b border-slate-800 bg-slate-900 px-3 py-1 text-[11px] text-slate-400">
          {notice}
        </div>
      ) : null}
      <div className="flex-1 min-h-0">
        <CadErrorBoundary>
          <React.Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-slate-400">
                Loading CAD workspace...
              </div>
            }
          >
            <CadApplicationShell controller={controller} onBackToAdjustment={handleBackToAdjustment} />
          </React.Suspense>
        </CadErrorBoundary>
      </div>
    </div>
  );
};

export default CadApp;
