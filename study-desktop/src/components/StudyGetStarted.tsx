// Study — compact first-run/get-started card (Phase 5F/5G/5N).
//
// Rendered only when there is something to say: an empty library (derived
// from the loaded snapshot, no persistent flag) and/or a stale official
// corpus with a known bundled update. Contains no reset/overwrite controls,
// so non-empty data is never at risk from this card.
//
// - Native (Tauri): "Import Existing Study Backup" reuses the existing
//   native dialog action (`importBackupFromFile`).
// - Browser: native dialogs are unavailable, so the card points at the
//   existing Manage textarea import (backup migration copy path).
// - Bundled update: routes to Manage for the existing Validate Preview flow;
//   never imports automatically.

type StudyGetStartedProps = {
  /** True when the loaded snapshot has a clear official library state. */
  libraryEmpty: boolean;
  /** True when no official corpus has been imported, even if seed study data exists. */
  officialLibraryEmpty?: boolean;
  /** Mirrors `fileInteractions.canUseNativeBackupDialogs`. */
  nativeBackupAvailable: boolean;
  /** Existing native backup import action (Tauri only). */
  onImportBackupFromFile?: () => Promise<void>;
  /** Navigate to Manage (browser import copy + bundled preview hook). */
  onOpenManage: () => void;
  /** Known bundled package id, or null when no bundle is wired yet. */
  bundledUpdatePackageId?: string | null;
  /** True when the bundled library is available and no official imports exist. */
  bundledFirstRunAvailable?: boolean;
  /** Mirrors the bundled install/update busy flag. */
  bundledBusy?: boolean;
  /** Explicit first-run bundled install (refuses when imports exist). */
  onInstallBundledPackage?: () => void;
};

const StudyGetStarted = ({
  libraryEmpty,
  officialLibraryEmpty = false,
  nativeBackupAvailable,
  onImportBackupFromFile,
  onOpenManage,
  bundledUpdatePackageId = null,
  bundledFirstRunAvailable = false,
  bundledBusy = false,
  onInstallBundledPackage,
}: StudyGetStartedProps) => {
  const showBundledUpdate = bundledUpdatePackageId !== null && !libraryEmpty;
  const showFirstRun = libraryEmpty || officialLibraryEmpty;
  if (!showFirstRun && !showBundledUpdate) return null;
  return (
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      {showFirstRun ? (
        <>
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Get Started</div>
          <p className="text-sm text-slate-300">
            {libraryEmpty
              ? 'No official library yet — install it or import an existing Study backup.'
              : 'Sample library loaded — install the official corpus to enable source-linked study.'}
          </p>
          {bundledFirstRunAvailable && onInstallBundledPackage ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onInstallBundledPackage}
                disabled={bundledBusy}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-slate-700"
              >
                Install Bundled Library
              </button>
              <button
                type="button"
                onClick={onOpenManage}
                className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Open Manage
              </button>
            </div>
          ) : null}
          {nativeBackupAvailable ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onImportBackupFromFile}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Import Existing Study Backup…
              </button>
              <button
                type="button"
                onClick={onOpenManage}
                className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Open Manage
              </button>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              <p className="text-sm text-slate-400">
                Moving from another browser? Copy your backup JSON and paste it under Manage →
                Import JSON.
              </p>
              <button
                type="button"
                onClick={onOpenManage}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                Open Manage Import
              </button>
            </div>
          )}
        </>
      ) : null}
      {showBundledUpdate ? (
        <div className="mt-3 rounded border border-amber-800 bg-amber-950/40 px-3 py-2">
          <p className="text-sm text-amber-200">
            A bundled official update ({bundledUpdatePackageId}) is available. Preview it in
            Manage before importing — nothing changes automatically.
          </p>
          <button
            type="button"
            onClick={onOpenManage}
            className="mt-2 rounded border border-amber-700 px-3 py-1.5 text-sm text-amber-100 hover:bg-amber-900/40"
          >
            Preview Bundled Update in Manage
          </button>
        </div>
      ) : null}
    </section>
  );
};

export default StudyGetStarted;
