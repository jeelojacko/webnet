import React from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import { saveBrowserTextFile } from '../../engine/browserFileIo';
import {
  exportCatalog,
  validateCatalogStyleReferences,
} from '../../engine/fieldToFinish/catalogIo';
import { diffFeatureCatalogs } from '../../engine/fieldToFinish/catalogRevision';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';

/** File Import/Export Catalog with comparison preview before replace. */
export const CatalogFileIo: React.FC<{
  catalog: FeatureCodeCatalog;
  catalogNotice: string;
  importPreview: { catalog: FeatureCodeCatalog; fileName: string } | null;
  importDiff: ReturnType<typeof diffFeatureCatalogs> | null;
  importError: string;
  linkStatus: string;
  project: CadProject;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onPickFile: (_file: File | undefined) => void;
  onReplace: () => void;
  onCancelImport: () => void;
}> = ({
  catalog,
  catalogNotice,
  importPreview,
  importDiff,
  importError,
  linkStatus,
  project,
  fileInputRef,
  onPickFile,
  onReplace,
  onCancelImport,
}) => (
  <div className="grid gap-1 text-[12px]" data-f2f-catalog-io>
    <span className="font-semibold">Catalog file (webnet.feature-catalog JSON, schema v1)</span>
    <div className="flex items-center gap-1">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={(event) => void onPickFile(event.target.files?.[0])}
        data-f2f-catalog-file
      />
      <button
        type="button"
        className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800"
        onClick={() => fileInputRef.current?.click()}
        data-f2f-catalog-import
      >
        Import catalog…
      </button>
      <button
        type="button"
        className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800"
        onClick={() => void saveBrowserTextFile(`${catalog.id || 'catalog'}.feature-catalog.json`, exportCatalog(catalog), [{ description: 'WebNet feature catalog', accept: { 'application/json': ['.json'] } }])}
        data-f2f-catalog-export
      >
        Export catalog
      </button>
      {catalogNotice ? <span className="text-[11px] text-sky-300">{catalogNotice}</span> : null}
    </div>
    {importError ? <p className="text-[11px] text-red-300" data-f2f-import-error>{importError}</p> : null}
    {importPreview && importDiff ? (
      <div className="rounded border border-amber-600 px-2 py-1" data-f2f-import-preview>
        <p>
          {importPreview.fileName}: {catalog.definitions.length}→{importPreview.catalog.definitions.length} definitions ·{' '}
          +{importDiff.added.length} added · −{importDiff.removed.length} removed · ~
          {importDiff.changed.length} changed · ={importDiff.unchanged.length} unchanged · link {linkStatus}→CATALOG_CHANGED on replace
        </p>
        {importDiff.added.length > 0 ? <p className="font-mono text-[11px]">+ {importDiff.added.join(', ')}</p> : null}
        {importDiff.removed.length > 0 ? <p className="font-mono text-[11px]">− {importDiff.removed.join(', ')}</p> : null}
        {importDiff.changed.length > 0 ? (
          <p className="font-mono text-[11px]">~ {importDiff.changed.map((entry) => `${entry.id}(${entry.fields.join('/')})`).join(', ')}</p>
        ) : null}
        <ImportStyleRefs catalog={importPreview.catalog} project={project} />
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            className="rounded border border-red-700 bg-red-950 px-2 py-0.5 hover:bg-red-900"
            onClick={onReplace}
            data-f2f-import-replace
          >
            Replace active catalog
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-800"
            onClick={onCancelImport}
          >
            Cancel
          </button>
        </div>
      </div>
    ) : null}
  </div>
);

const ImportStyleRefs: React.FC<{ catalog: FeatureCodeCatalog; project: CadProject }> = ({ catalog, project }) => {
  const refs = validateCatalogStyleReferences(catalog, {
    pointStyles: project.pointStyles,
    labelStyles: project.labelStyles,
    pointSymbols: project.styleLibrary.pointSymbols,
  });
  if (refs.length === 0) return null;
  return (
    <ul className="text-[11px] text-amber-300">
      {refs.map((issue, index) => (
        <li key={index}>{issue.message}</li>
      ))}
    </ul>
  );
};
