import type { CurrentOfficialPackageDiagnostics } from './StudyManagePage.utils';
import { describePreviewDifference } from './StudyManagePage.utils';
import type { BundledOfficialPackageStatus } from '../studyBundledOfficialContent';
import type { OfficialContentPreview } from '../studyOfficialContent';

type StudyBundledOfficialSectionProps = {
  bundledStatus: BundledOfficialPackageStatus;
  bundledFirstRunAvailable: boolean;
  bundledPreview: OfficialContentPreview | null;
  bundledPreviewError: string | null;
  bundledBusy: boolean;
  currentPackage: CurrentOfficialPackageDiagnostics | null;
  onLoadBundledPreview: () => void;
  onInstallBundledPackage: () => void;
  onInstallBundledUpdate: () => void;
};

const formatBytes = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MiB`;

/**
 * Bundled-library surface for Manage. Renders nothing when the resource is
 * unavailable (browser/dev fallback). Otherwise: explicit first-run Install
 * on genuinely empty official imports, match/different preview against the
 * current import with explicit Install Update only, and fail-closed errors.
 * Never auto-migrates or overwrites.
 */
const StudyBundledOfficialSection = ({
  bundledStatus,
  bundledFirstRunAvailable,
  bundledPreview,
  bundledPreviewError,
  bundledBusy,
  currentPackage,
  onLoadBundledPreview,
  onInstallBundledPackage,
  onInstallBundledUpdate,
}: StudyBundledOfficialSectionProps) => {
  if (!bundledStatus.available) return null;
  const previewDifference = describePreviewDifference(currentPackage, bundledPreview);

  return (
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
        Bundled Official Library ({formatBytes(bundledStatus.byteLength)})
      </div>
      {bundledFirstRunAvailable && !bundledPreview ? (
        <div className="space-y-3 text-sm text-slate-300">
          <p>
            No official packages imported. The desktop bundle ships the current official library —
            install it explicitly, or import a package manually below.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onLoadBundledPreview}
              disabled={bundledBusy}
              className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:text-slate-600"
            >
              Preview Bundled Library
            </button>
            <button
              type="button"
              onClick={onInstallBundledPackage}
              disabled={bundledBusy}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:bg-slate-700"
            >
              Install Bundled Library
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 text-sm text-slate-300">
          {previewDifference === 'first-import' ? (
            <p>
              No official packages imported. The desktop bundle ships the current official
              library — install it explicitly, or import a package manually below.
            </p>
          ) : null}
          {previewDifference === 'matches-current' ? (
            <div className="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-emerald-200">
              The bundled library matches the current import — no update needed.
            </div>
          ) : null}
          {previewDifference === 'differs-from-current' ? (
            <div className="rounded border border-amber-800 bg-amber-950/40 px-3 py-2 text-amber-200">
              The bundled library differs from the current import — review the preview, then install
              the update explicitly. Nothing changes until then.
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onLoadBundledPreview}
              disabled={bundledBusy}
              className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:text-slate-600"
            >
              Preview Bundled Library
            </button>
            {previewDifference === 'first-import' ? (
              <button
                type="button"
                onClick={onInstallBundledPackage}
                disabled={bundledBusy || !bundledPreview?.valid}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                Install Bundled Library
              </button>
            ) : null}
            {previewDifference === 'differs-from-current' ? (
              <button
                type="button"
                onClick={onInstallBundledUpdate}
                disabled={bundledBusy || !bundledPreview?.valid}
                className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                Install Update
              </button>
            ) : null}
          </div>
        </div>
      )}
      {bundledPreview ? (
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded bg-slate-950 p-3 text-slate-300">
            <div className="font-semibold text-white">Documents</div>
            <div>New: {bundledPreview.newDocuments.length}</div>
            <div>Updated: {bundledPreview.updatedDocuments.length}</div>
            <div>Unchanged: {bundledPreview.unchangedDocuments.length}</div>
          </div>
          <div className="rounded bg-slate-950 p-3 text-slate-300">
            <div className="font-semibold text-white">Components</div>
            <div>New: {bundledPreview.newComponents.length}</div>
            <div>Changed: {bundledPreview.changedComponents.length}</div>
            <div>Removed: {bundledPreview.removedComponents.length}</div>
          </div>
          <div className="rounded bg-slate-950 p-3 text-slate-300">
            <div className="font-semibold text-white">Review</div>
            <div>Reference-only forms: {bundledPreview.referenceOnlyForms.length}</div>
            <div>Units needing review: {bundledPreview.unitsRequiringSourceReview.length}</div>
          </div>
        </div>
      ) : null}
      {bundledPreviewError ? (
        <pre className="mt-3 max-h-44 overflow-auto rounded bg-rose-950/40 p-3 text-xs text-rose-200">
          {bundledPreviewError}
        </pre>
      ) : null}
    </section>
  );
};

export default StudyBundledOfficialSection;
