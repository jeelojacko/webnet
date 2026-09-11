import { useMemo, useState } from 'react';
import { useDevMountTiming } from '../studyDevTiming';
import { backupByteLength } from '../studyFileInteractions';
import type { OfficialContentPreview } from '../studyOfficialContent';
import type { StudyDataSnapshot } from '../studyTypes';
import {
  buildCurrentOfficialPackageDiagnostics,
  compactCorpusFingerprint,
  describePreviewDifference,
} from './StudyManagePage.utils';

type StudyManagePageProps = {
  data: StudyDataSnapshot;
  exportText: string;
  importText: string;
  onImportTextChange: (_text: string) => void;
  onImport: () => Promise<void>;
  onDeleteAllData: () => Promise<void>;
  nativeBackupAvailable?: boolean;
  onImportBackupFromFile?: () => Promise<void>;
  onExportBackupToFile?: () => Promise<void>;
  officialPackageText: string;
  onOfficialPackageTextChange: (_text: string) => void;
  officialPackagePreview: OfficialContentPreview | null;
  onPreviewOfficialPackage: () => void;
  onImportOfficialPackage: () => Promise<void>;
  statusMessage: string;
};

const StudyManagePage = ({
  data,
  exportText,
  importText,
  onImportTextChange,
  onImport,
  onDeleteAllData,
  nativeBackupAvailable = false,
  onImportBackupFromFile,
  onExportBackupToFile,
  officialPackageText,
  onOfficialPackageTextChange,
  officialPackagePreview,
  onPreviewOfficialPackage,
  onImportOfficialPackage,
  statusMessage,
}: StudyManagePageProps) => {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const currentPackage = useMemo(() => buildCurrentOfficialPackageDiagnostics(data), [data]);
  const previewDifference = describePreviewDifference(currentPackage, officialPackagePreview);
  // Raw JSON/package textareas stay out of the DOM until expanded, so a
  // large export no longer pays full raw-text DOM cost on every visit.
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showPackage, setShowPackage] = useState(false);
  useDevMountTiming('StudyManagePage');

  const confirmDeleteAllData = async () => {
    setDeleting(true);
    try {
      await onDeleteAllData();
      setConfirmingDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
  <div className="space-y-5">
    <div>
      <h2 className="text-xl font-semibold text-white">Manage</h2>
      <p className="text-sm text-slate-500">Import, export, and content-management data.</p>
    </div>
    {statusMessage ? (
      <div className="rounded border border-emerald-800 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
        {statusMessage}
      </div>
    ) : null}
    <section className="grid gap-3 sm:grid-cols-3">
      <div className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="text-lg font-semibold text-white">{data.documents.length}</div>
        <div className="text-xs uppercase tracking-wide text-slate-500">Documents</div>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="text-lg font-semibold text-white">{data.units.length}</div>
        <div className="text-xs uppercase tracking-wide text-slate-500">Units</div>
      </div>
      <div className="rounded border border-slate-800 bg-slate-900 p-4">
        <div className="text-lg font-semibold text-white">{data.attempts.length}</div>
        <div className="text-xs uppercase tracking-wide text-slate-500">Attempts</div>
      </div>
    </section>
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-rose-300">Testing Reset</div>
      <p className="text-sm text-slate-400">
        Delete every local Study record and return to an empty valid Study database.
      </p>
      {!confirmingDelete ? (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          className="mt-3 rounded bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600"
        >
          Delete All Data
        </button>
      ) : (
        <div className="mt-3 rounded border border-rose-800 bg-rose-950/30 p-3">
          <div className="text-sm font-semibold text-rose-100">Delete all Study data?</div>
          <p className="mt-1 text-sm text-rose-200">
            This removes documents, official imports, study units, attempts, drafts, progress, rubrics, and import history.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirmDeleteAllData}
              disabled={deleting}
              className="rounded bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:bg-slate-700"
            >
              {deleting ? 'Deleting...' : 'Confirm Delete All Data'}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={deleting}
              className="rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:text-slate-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Current Official Package</div>
      {!currentPackage ? (
        <div className="space-y-2 text-sm text-slate-500">
          <div>No official packages imported.</div>
          {previewDifference === 'first-import' ? (
            <div className="rounded border border-sky-800 bg-sky-950/40 px-3 py-2 text-sky-200">
              No current import — this validated preview would be the first import.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2 text-sm text-slate-300">
          <div>Package ID: {currentPackage.packageIds.join(', ') || '—'}</div>
          <div>Manifest: {currentPackage.manifestIds.join(', ') || '—'}</div>
          <div>Package date: {currentPackage.packageCreatedAt ?? '—'}</div>
          <div>
            Corpus fingerprint:{' '}
            {currentPackage.packageHash ? (
              <span className="font-mono text-xs" title="Compact alias — open for the full value">
                {compactCorpusFingerprint(currentPackage.packageHash)}
              </span>
            ) : (
              '—'
            )}
          </div>
          {currentPackage.packageHash ? (
            <details>
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                Show full fingerprint
              </summary>
              <div className="mt-1 break-all rounded bg-slate-950 p-2 font-mono text-xs text-slate-300">
                {currentPackage.packageHash}
              </div>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(currentPackage.packageHash)}
                aria-label="Copy full corpus fingerprint"
                className="mt-1 rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                Copy fingerprint
              </button>
            </details>
          ) : null}
          <div>Imported: {currentPackage.importedAt ?? '—'}</div>
          <div>Documents: {currentPackage.documentCount}</div>
          <div>Components: {currentPackage.componentCount ?? 'unknown (legacy import)'}</div>
          {currentPackage.lastImport ? (
            <div>
              Components (last import): +{currentPackage.lastImport.addedComponents} new · ~
              {currentPackage.lastImport.changedComponents} changed · −
              {currentPackage.lastImport.removedComponents} removed
            </div>
          ) : null}
          {currentPackage.documents.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">
                Per-document hashes ({currentPackage.documents.length})
              </summary>
              <div className="mt-1 max-h-44 overflow-auto rounded bg-slate-950 p-3 font-mono text-xs">
                {currentPackage.documents.map((document) => (
                  <div key={document.id} className="break-all">
                    {document.id} · {document.contentHash}
                  </div>
                ))}
              </div>
            </details>
          ) : null}
          {previewDifference === 'differs-from-current' ? (
            <div className="rounded border border-amber-800 bg-amber-950/40 px-3 py-2 text-amber-200">
              The validated preview differs from the current import — review before importing. No
              automatic migration or overwrite happens.
            </div>
          ) : null}
          {previewDifference === 'matches-current' ? (
            <div className="rounded border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-emerald-200">
              The validated preview matches the current import.
            </div>
          ) : null}
        </div>
      )}
    </section>
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Import Official Content Package</div>
      {!showPackage ? (
        <button
          type="button"
          onClick={() => setShowPackage(true)}
          className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          {officialPackageText
            ? `Show package text (${backupByteLength(officialPackageText)} bytes)`
            : 'Paste or choose package text'}
        </button>
      ) : (
      <textarea
        value={officialPackageText}
        onChange={(event) => onOfficialPackageTextChange(event.target.value)}
        placeholder="Paste nb-law-pilot.content-package.json here."
        className="min-h-44 w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-300"
      />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <label className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
          Choose Package
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              file.text().then(onOfficialPackageTextChange);
            }}
          />
        </label>
        <button
          onClick={onPreviewOfficialPackage}
          disabled={!officialPackageText.trim()}
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-800"
        >
          Validate Preview
        </button>
        <button
          onClick={onImportOfficialPackage}
          disabled={!officialPackagePreview?.valid}
          className="rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
        >
          Confirm Import
        </button>
      </div>
      {officialPackagePreview ? (
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded bg-slate-950 p-3 text-slate-300">
            <div className="font-semibold text-white">Documents</div>
            <div>New: {officialPackagePreview.newDocuments.length}</div>
            <div>Updated: {officialPackagePreview.updatedDocuments.length}</div>
            <div>Unchanged: {officialPackagePreview.unchangedDocuments.length}</div>
            <div>Absent existing: {officialPackagePreview.absentExistingDocuments.length}</div>
          </div>
          <div className="rounded bg-slate-950 p-3 text-slate-300">
            <div className="font-semibold text-white">Components</div>
            <div>New: {officialPackagePreview.newComponents.length}</div>
            <div>Changed: {officialPackagePreview.changedComponents.length}</div>
            <div>Removed: {officialPackagePreview.removedComponents.length}</div>
            <div>Unchanged: {officialPackagePreview.unchangedComponents.length}</div>
          </div>
          <div className="rounded bg-slate-950 p-3 text-slate-300">
            <div className="font-semibold text-white">Warnings</div>
            <div>Reference-only forms: {officialPackagePreview.referenceOnlyForms.length}</div>
            <div>Units needing review: {officialPackagePreview.unitsRequiringSourceReview.length}</div>
            <div className={officialPackagePreview.valid ? 'text-emerald-300' : 'text-rose-300'}>
              {officialPackagePreview.valid ? 'Valid package' : 'Invalid package'}
            </div>
          </div>
          {officialPackagePreview.errors.length > 0 ? (
            <pre className="max-h-44 overflow-auto rounded bg-rose-950/40 p-3 text-xs text-rose-200 md:col-span-3">
              {officialPackagePreview.errors.join('\n')}
            </pre>
          ) : null}
        </div>
      ) : null}
    </section>
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Official Import History</div>
      <div className="space-y-2">
        {data.importHistory.length === 0 ? (
          <div className="text-sm text-slate-500">No official packages imported.</div>
        ) : (
          data.importHistory.slice().reverse().map((entry) => (
            <div key={entry.id} className="rounded bg-slate-950 px-3 py-2 text-xs text-slate-300">
              {entry.packageId} · {entry.importedAt} · documents +{entry.addedDocuments}/~{entry.changedDocuments} ·
              components +{entry.addedComponents}/~{entry.changedComponents} · reference-only forms {entry.referenceOnlyForms}
            </div>
          ))
        )}
      </div>
    </section>
    {nativeBackupAvailable ? (
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Backup File</div>
      <p className="text-sm text-slate-400">
        Open a backup JSON file or save the current export with native dialogs.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onImportBackupFromFile}
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600"
        >
          Open Backup File…
        </button>
        <button
          type="button"
          onClick={onExportBackupToFile}
          disabled={!exportText}
          className="rounded bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-800"
        >
          Save Backup to File…
        </button>
      </div>
    </section>
    ) : null}
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Export JSON</div>
      {!showExport ? (
        <button
          type="button"
          onClick={() => setShowExport(true)}
          className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          {exportText
            ? `Show export text (${backupByteLength(exportText)} bytes)`
            : 'No export available'}
        </button>
      ) : (
        <textarea
          readOnly
          value={exportText}
          className="min-h-72 w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-300"
        />
      )}
    </section>
    <section className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">Import JSON</div>
      {!showImport ? (
        <button
          type="button"
          onClick={() => setShowImport(true)}
          className="rounded border border-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          {importText ? `Show import text (${backupByteLength(importText)} bytes)` : 'Paste import text'}
        </button>
      ) : (
        <>
          <textarea
            value={importText}
            onChange={(event) => onImportTextChange(event.target.value)}
            className="min-h-44 w-full rounded border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-300"
          />
          <button
            onClick={onImport}
            disabled={!importText.trim()}
            className="mt-3 rounded bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            Import Data
          </button>
        </>
      )}
    </section>
  </div>
  );
};

export default StudyManagePage;
