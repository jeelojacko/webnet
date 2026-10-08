import React from 'react';
import { serializeExportSceneToSvg } from '../../engine/cad/cadSvgSerializer';
import { buildPlotPreviewScene } from '../../engine/cad/exportCenter';
import type { CadDrawingDocument } from '../../engine/cad/cadTypes';

/**
 * Phase 19B §§72–73 — Plot preview.
 *
 * Renders the EXACT scene the SVG/PDF exporters serialize (same
 * `buildExportSheetSceneWithResult` path, same plot filtering, same clips,
 * same NO-PLOT exclusions). Warnings from the ExportResult (broken
 * references, unknown tokens, stale dependencies, glyph approximations) are
 * surfaced before any download. No parallel preview renderer exists: the
 * SVG bytes come from the shared serializer.
 */
export interface PlotPreviewDialogProps {
  drawing: CadDrawingDocument;
  sheetId: string;
  onClose: () => void;
}

export const PlotPreviewDialog = ({
  drawing,
  sheetId,
  onClose,
}: PlotPreviewDialogProps): React.JSX.Element => {
  const result = buildPlotPreviewScene(drawing, sheetId);
  if (!result.ok) {
    return (
      <section aria-label="Plot preview" className="relative rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100">
        <p>{result.message}</p>
        <button type="button" onClick={onClose}>Close</button>
      </section>
    );
  }
  const { preview } = result;
  const svg = serializeExportSceneToSvg(preview.scene);
  const warningCodes = [...new Set(preview.warnings.map((warning) => warning.code))];
  // SEC-182 defense in depth: the same exported SVG bytes are rendered as an
  // inert `<img>` data URI instead of active markup via
  // dangerouslySetInnerHTML. SVG loaded as an image cannot run scripts or
  // event handlers, and external resources are not fetched, while the visual
  // result stays byte-for-byte the export payload.
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

  return (
    <section
      aria-label="Plot preview"
      className="relative max-h-[85%] w-full max-w-[900px] overflow-auto rounded border border-slate-600 bg-slate-900 p-3 text-[12px] text-slate-100"
    >
      <header className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{`Plot preview — ${preview.sheetName}`}</h3>
        <button type="button" onClick={onClose} aria-label="Close plot preview">Close</button>
      </header>
      {preview.warnings.length > 0 && (
        <div role="alert" aria-label="Plot warnings" className="mb-2 rounded border border-amber-600 p-2 text-[11px] text-amber-300">
          <p>{`${preview.warnings.length} warning(s): ${warningCodes.join(', ')}`}</p>
          <ul>
            {preview.warnings.map((warning, index) => (
              <li key={`${warning.code}-${warning.entityId ?? index}`}>{`${warning.code}: ${warning.message}`}</li>
            ))}
          </ul>
        </div>
      )}
      {preview.omittedEntityIds.length > 0 && (
        <p className="text-[11px] opacity-70">{`Omitted: ${preview.omittedEntityIds.length} · Approximated: ${preview.approximatedEntityIds.length}`}</p>
      )}
      <img
        aria-label="Plot preview scene"
        data-plot-preview-sheet={preview.sheetId}
        className="bg-white"
        alt={`Plot preview of ${preview.sheetName}`}
        src={svgDataUrl}
      />
      <p className="mt-1 text-[11px] opacity-70">
        Identical scene to the SVG/PDF export path (same filters and clips). Grid North only.
      </p>
    </section>
  );
};

export default PlotPreviewDialog;
