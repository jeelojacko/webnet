import React, { useMemo, useState } from 'react';
import {
  buildExportCenterPreview,
  EXPORT_FORMAT_LABELS,
  type ExportCenterFormat,
  type ExportCenterPdfScope,
  type ExportCenterPreview,
} from '../../engine/cad/exportCenter';
import {
  saveBrowserBinaryFile,
  saveBrowserTextFile,
} from '../../engine/browserFileIo';
import type { CadDrawingDocument } from '../../engine/cad/cadTypes';
import type { ResultDependencyIdentity } from '../../engine/resultIntegrity';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';

const FORMATS: ExportCenterFormat[] = ['svg', 'pdf', 'dxf-r12', 'dxf-r2000', 'landxml', 'wncad', 'catalog'];

const PICKER_TYPES: Record<ExportCenterFormat, { description: string; accept: Record<string, string[]> }> = {
  svg: { description: 'SVG Files', accept: { 'image/svg+xml': ['.svg'] } },
  pdf: { description: 'PDF Files', accept: { 'application/pdf': ['.pdf'] } },
  'dxf-r12': { description: 'DXF Files', accept: { 'application/dxf': ['.dxf'] } },
  'dxf-r2000': { description: 'DXF Files', accept: { 'application/dxf': ['.dxf'] } },
  landxml: { description: 'LandXML Files', accept: { 'application/xml': ['.xml'] } },
  wncad: { description: 'WebNet CAD Drawing', accept: { 'application/json': ['.wncad', '.json'] } },
  catalog: { description: 'JSON Files', accept: { 'application/json': ['.json'] } },
};

interface PickerType { description: string; accept: Record<string, string[]> }

interface ExportCenterPanelProps {
  drawing: CadDrawingDocument;
  catalog?: FeatureCodeCatalog | null;
  activeSheetId?: string;
  /** Phase 17E deliverable gate inputs; absent = legacy behavior, unchanged. */
  resultIdentity?: ResultDependencyIdentity | null;
  stationIds?: Set<string>;
  f2fLinkStatus?: string;
  f2fLinkSourceKind?: string;
  onClose: () => void;
  saveTextFile?: (_name: string, _text: string, _picker: PickerType) => Promise<boolean>;
  saveBinaryFile?: (_name: string, _bytes: Uint8Array, _picker: PickerType) => Promise<boolean>;
}

const summarizePreview = (preview: ExportCenterPreview): string =>
  `${preview.formatLabel} — ${preview.scopeLabel} — ${preview.filename}`;

const ExportCenterPanelWarnings = ({ preview }: { preview: ExportCenterPreview }): React.JSX.Element => {
  if (preview.warningsPending) {
    return <p className="text-[12px] text-amber-300">Detailed per-entity warnings surface in progress for this format.</p>;
  }
  if (preview.warnings.length === 0) {
    return <p className="text-[12px] text-slate-400">No warnings. All in-scope entities export as drawn.</p>;
  }
  return (
    <ul aria-label="Export warnings" className="max-h-32 list-disc overflow-auto pl-5 text-[12px] text-amber-200">
      {preview.warnings.map((warning, index) => (
        <li key={`${warning.code}-${index}`}>{`[${warning.code}] ${warning.message}`}</li>
      ))}
    </ul>
  );
};

export const ExportCenterPanel = ({
  drawing,
  catalog = null,
  activeSheetId,
  resultIdentity,
  stationIds,
  f2fLinkStatus,
  f2fLinkSourceKind,
  onClose,
  saveTextFile = async (name, text, picker) => saveBrowserTextFile(name, text, [picker]),
  saveBinaryFile = async (name, bytes, picker) => saveBrowserBinaryFile(name, bytes, [picker]),
}: ExportCenterPanelProps): React.JSX.Element => {
  const sheets = drawing.draft?.sheets ?? [];
  const [format, setFormat] = useState<ExportCenterFormat>('svg');
  const [pdfScope, setPdfScope] = useState<ExportCenterPdfScope>('current');
  const [sheetId, setSheetId] = useState<string | undefined>(activeSheetId ?? sheets[0]?.id);
  const [status, setStatus] = useState('');

  const outcome = useMemo(() => {
    const depOpts = resultIdentity !== undefined || stationIds !== undefined || f2fLinkStatus !== undefined || f2fLinkSourceKind !== undefined
      ? { resultIdentity: resultIdentity ?? null, stationIds, f2fLinkStatus, f2fLinkSourceKind }
      : undefined;
    return buildExportCenterPreview(drawing, { format, pdfScope, sheetId, catalog }, depOpts);
  }, [drawing, format, pdfScope, sheetId, catalog, resultIdentity, stationIds, f2fLinkStatus, f2fLinkSourceKind]);
  const preview = outcome.ok ? outcome.preview : null;

  const handleDownload = async (): Promise<void> => {
    if (!preview) return;
    setStatus('');
    try {
      const picker = PICKER_TYPES[preview.format];
      const saved = preview.isBinary
        ? await saveBinaryFile(preview.filename, preview.payload as Uint8Array, picker)
        : await saveTextFile(preview.filename, preview.payload as string, picker);
      setStatus(saved ? `Saved ${preview.filename}.` : 'Download cancelled.');
    } catch {
      setStatus('Download failed in the browser. Check the download destination and try again.');
    }
  };

  const catalogAvailable = catalog != null;
  const showSheetPicker = format === 'svg' || (format === 'pdf' && pdfScope === 'current');
  const showPdfScope = format === 'pdf';

  return (
    <section
      aria-label="Export Center"
      className="absolute right-3 top-16 z-40 max-h-[80%] w-[520px] overflow-auto rounded border border-slate-600 bg-slate-900 p-3 text-slate-100"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">Export Center</h2>
        <button
          type="button"
          className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800"
          onClick={onClose}
          data-export-center-close
        >
          Close
        </button>
      </div>
      <div role="tablist" aria-label="Export formats" className="mb-2 flex flex-wrap gap-1">
        {FORMATS.map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={format === entry}
            aria-label={`Export format ${EXPORT_FORMAT_LABELS[entry]}`}
            disabled={entry === 'catalog' && !catalogAvailable}
            title={entry === 'catalog' && !catalogAvailable ? 'No feature catalog in this context.' : undefined}
            className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => setFormat(entry)}
          >
            {EXPORT_FORMAT_LABELS[entry]}
          </button>
        ))}
      </div>
      {showPdfScope ? (
        <label className="mb-2 flex items-center gap-2 text-[12px]">
          Scope
          <select
            aria-label="PDF scope"
            value={pdfScope}
            onChange={(event) => setPdfScope(event.target.value as ExportCenterPdfScope)}
            className="rounded border border-slate-600 bg-slate-800 px-1 py-1"
          >
            <option value="current">Current sheet</option>
            <option value="all">All sheets</option>
          </select>
        </label>
      ) : null}
      {showSheetPicker && sheets.length > 0 ? (
        <label className="mb-2 flex items-center gap-2 text-[12px]">
          Sheet
          <select
            aria-label="Export sheet"
            value={sheets.some((sheet) => sheet.id === sheetId) ? sheetId : (sheets[0]?.id ?? '')}
            onChange={(event) => setSheetId(event.target.value)}
            className="rounded border border-slate-600 bg-slate-800 px-1 py-1"
          >
            {sheets.map((sheet, index) => (
              <option key={sheet.id} value={sheet.id}>{`${index + 1}: ${sheet.name}`}</option>
            ))}
          </select>
        </label>
      ) : null}
      {outcome.ok && preview ? (
        <div className="rounded border border-slate-700 p-2" aria-label="Export preview">
          <p className="text-[12px] text-slate-300">{summarizePreview(preview)}</p>
          <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-[12px]">
            <dt className="text-slate-400">Format</dt>
            <dd>{preview.formatLabel}</dd>
            <dt className="text-slate-400">Scope</dt>
            <dd>{preview.scopeLabel}</dd>
            <dt className="text-slate-400">Sheets</dt>
            <dd>{preview.sheetNames.length > 0 ? preview.sheetNames.join(', ') : '—'}</dd>
            <dt className="text-slate-400">Filename</dt>
            <dd data-export-center-filename>{preview.filename}</dd>
            {preview.omittedEntityIds.length > 0 || preview.approximatedEntityIds.length > 0 ? (
              <>
                <dt className="text-slate-400">Entities</dt>
                <dd>
                  {`${preview.omittedEntityIds.length} omitted, ${preview.approximatedEntityIds.length} approximated`}
                </dd>
              </>
            ) : null}
          </dl>
          {preview.notice ? <p className="mt-1 text-[12px] text-slate-300">{preview.notice}</p> : null}
          <div className="mt-1">
            <ExportCenterPanelWarnings preview={preview} />
          </div>
          <button
            type="button"
            className="mt-2 rounded border border-sky-500 bg-sky-950 px-2 py-1 text-sky-100 hover:bg-sky-900"
            onClick={handleDownload}
            data-export-center-download
          >
            {`Download ${preview.filename}`}
          </button>
        </div>
      ) : (
        <p role="alert" className="rounded border border-red-800 bg-red-950 p-2 text-[12px] text-red-200">
          {!outcome.ok ? outcome.message : 'Export is unavailable.'}
        </p>
      )}
      {status ? <p className="mt-2 text-[12px] text-slate-300" data-export-center-status>{status}</p> : null}
      <p className="mt-2 text-[11px] text-slate-500">Draft plan — not a legal or certified survey document.</p>
    </section>
  );
};
