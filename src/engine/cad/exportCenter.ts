/**
 * Export Center orchestration (Phase 13E Bucket B2, §§18,19,39,40,43).
 *
 * Thin orchestration only: calls existing engine serializers and merges
 * their ExportResult warnings so the UI can show them BEFORE download.
 * No math, tolerance, importer, or serializer changes live here.
 */
import {
  buildExportSheetSceneWithResult,
  type ExportSheetScene,
} from './cadExportScene';
import { serializeExportSceneToSvgWithResult } from './cadSvgSerializer';
import { exportScenesToPdfWithResult } from './cadPdfExport';
import { buildDxfLayoutTextWithResult, buildDxfModelSpaceTextWithResult } from './dxf/dxfLayoutExport';
import { buildLandXmlProjectExportWithResult } from '../landxmlCad';
import type { CadLandXmlCivilSources } from '../landxmlCivilSource';
import { buildLandXmlClassSummary, type ExportCenterClassSummary } from './landxmlExportSummary';
import {
  buildCadDrawingFileName,
  serializeCadDrawingFile,
} from './cadDrawingFile';
import {
  decideCadDeliverableVerdict,
  summarizeDrawingDependency,
} from './cadAdjustmentDependency';
import {
  buildDraftLabelEntityStatusMap,
  evaluateDraftLabelDependencies,
  hasStaleDerivedDraftLabel,
} from './cadDraftLabelDependency';
import type { ResultDependencyIdentity } from '../resultIntegrity';
import { exportCatalog } from '../fieldToFinish/catalogIo';
import type { FeatureCodeCatalog } from '../fieldToFinish/featureCatalog';
import type { CadDrawingDocument } from './cadTypes';
import {
  finalizeExportResult,
  type ExportResult,
  type ExportWarning,
} from './exportResult';

export type ExportCenterFormat =
  | 'svg'
  | 'pdf'
  | 'dxf-r12'
  | 'dxf-r2000'
  | 'landxml'
  | 'wncad'
  | 'catalog';

export type ExportCenterPdfScope = 'current' | 'all';

export interface ExportCenterSelection {
  format: ExportCenterFormat;
  pdfScope?: ExportCenterPdfScope;
  sheetId?: string;
  catalog?: FeatureCodeCatalog | null;
}

export interface ExportCenterPreview {
  format: ExportCenterFormat;
  formatLabel: string;
  scopeLabel: string;
  sheetNames: string[];
  filename: string;
  mimeType: string;
  isBinary: boolean;
  warnings: ExportWarning[];
  omittedEntityIds: string[];
  approximatedEntityIds: string[];
  /** Shown when real warnings are unavailable for this row. */
  warningsPending: boolean;
  notice?: string;
  /** Phase 18L per-class LandXML dispositions (nothing silently omitted). */
  classSummary?: readonly ExportCenterClassSummary[];
  payload: string | Uint8Array;
}

export type ExportCenterOutcome =
  | { ok: true; preview: ExportCenterPreview }
  | { ok: false; message: string };

/**
 * Phase 17E deliverable gate (opt-in). Absent = legacy behavior, unchanged.
 * Present = coordinate-bearing deliverables block when the drawing is not
 * backed by the current adjustment result. MANUAL_ONLY / CURRENT pass
 * through; the `.wncad` native save path and catalog export never block.
 * (Exact format keys live in ExportCenterFormat — there is no `cad-csv`
 * deliverable; the gated set is svg/pdf/dxf-r12/dxf-r2000/landxml.)
 */
export interface ExportDependencyOptions {
  resultIdentity?: ResultDependencyIdentity | null;
  stationIds?: Set<string>;
  f2fLinkStatus?: string;
  /** Phase 17E: coordinate-import F2F stays exportable (MANUAL-ish). */
  f2fLinkSourceKind?: string;
}

/** Coordinate-bearing deliverables gated on adjustment freshness. */
const COORDINATE_DELIVERABLES: ReadonlySet<ExportCenterFormat> = new Set([
  'svg',
  'pdf',
  'dxf-r12',
  'dxf-r2000',
  'landxml',
]);

const blockedDeliverable = (format: ExportCenterFormat, reason: string, blockMessage: string): ExportCenterOutcome => ({
  ok: false,
  message: `[${reason}] ${EXPORT_FORMAT_LABELS[format]} export blocked: ${blockMessage}`,
});

/** Null = deliverable gate passes; non-null = blocked outcome to return. */
const checkDeliverableDependency = (
  drawing: CadDrawingDocument,
  format: ExportCenterFormat,
  depOpts: ExportDependencyOptions,
): ExportCenterOutcome | null => {
  const identity = depOpts.resultIdentity ?? null;
  const evalOpts = { stationIds: depOpts.stationIds, f2fLinkStatus: depOpts.f2fLinkStatus, f2fLinkSourceKind: depOpts.f2fLinkSourceKind };
  const summary = summarizeDrawingDependency(drawing.project, identity, evalOpts);
  // Manual-only drawings carry no adjustment dependency: always exportable.
  if (summary.status === 'MANUAL_ONLY') return null;
  if (COORDINATE_DELIVERABLES.has(format)) {
    const verdict = decideCadDeliverableVerdict(summary);
    if (!verdict.allowed) {
      return blockedDeliverable(format, verdict.reason ?? 'CAD_OWNER_CONFLICT', verdict.blockMessage ?? 'Resolve CAD dependencies before delivery.');
    }
  }
  // Production sheet exports additionally block on stale derived
  // annotations, even when model entities are current.
  if (format === 'svg' || format === 'pdf') {
    const labels = drawing.draft?.labels ?? [];
    if (labels.length > 0) {
      const statusMap = buildDraftLabelEntityStatusMap(drawing.project.entities, identity, evalOpts);
      if (hasStaleDerivedDraftLabel(evaluateDraftLabelDependencies(labels, statusMap))) {
        return blockedDeliverable(format, 'CAD_DERIVED_LABEL_STALE', 'Refresh derived annotations before delivery.');
      }
    }
  }
  return null;
};

export const EXPORT_FORMAT_LABELS: Record<ExportCenterFormat, string> = {
  svg: 'SVG (current sheet)',
  pdf: 'PDF (sheet)',
  'dxf-r12': 'DXF R12 (model space)',
  'dxf-r2000': 'DXF R2000 (layouts)',
  landxml: 'LandXML (CAD geometry)',
  wncad: '.wncad (drawing)',
  catalog: 'Feature Catalog JSON',
};

export const EXPORT_SCOPE_LABELS: Record<ExportCenterFormat, string> = {
  svg: 'Current sheet',
  pdf: 'Current sheet or all sheets',
  'dxf-r12': 'Model space (survey coordinates)',
  'dxf-r2000': 'Paper layouts (all sheets)',
  landxml: 'Model / CAD geometry',
  wncad: 'Full drawing document',
  catalog: 'Active feature catalog',
};

/** Same stem rule as buildCadDrawingFileName: spaces→_, strip the rest. */
export const sanitizeExportStem = (name: string): string =>
  name
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]+/g, '')
    .replace(/^_+|_+$/g, '')
    .replace(/\.[^.]+$/, '') || 'drawing';

export const buildExportCenterFileName = (
  projectName: string,
  format: ExportCenterFormat,
  sheetName?: string,
  pdfScope?: ExportCenterPdfScope,
): string => {
  const stem = sanitizeExportStem(projectName);
  const sheetStem = sheetName ? sanitizeExportStem(sheetName) : '';
  switch (format) {
    case 'svg':
      return `${stem}${sheetStem ? `-${sheetStem}` : ''}.svg`;
    case 'pdf':
      return pdfScope === 'all' || !sheetStem ? `${stem}.pdf` : `${stem}-${sheetStem}.pdf`;
    case 'dxf-r12':
      return `${stem}-model.dxf`;
    case 'dxf-r2000':
      return `${stem}-layouts.dxf`;
    case 'landxml':
      return `${stem}.xml`;
    case 'wncad':
      return buildCadDrawingFileName(projectName);
    case 'catalog':
      return `${stem}-catalog.json`;
  }
};

type DispositionLists = Pick<ExportResult<unknown>, 'warnings' | 'exportedEntityIds' | 'omittedEntityIds' | 'approximatedEntityIds'>;

// Merge per-stage dispositions for the preview. Exported ids must ride
// along: finalizing with exportedEntityIds=[] would convert every valid
// scene approximation into omitted (fail-closed repair on an incomplete
// contract). The preview exposes omitted/approximated only.
const mergeWarnings = (results: Array<DispositionLists>): DispositionLists => {
  const warnings: ExportWarning[] = [];
  const exported: string[] = [];
  const omitted: string[] = [];
  const approximated: string[] = [];
  results.forEach((result) => {
    warnings.push(...result.warnings);
    exported.push(...result.exportedEntityIds);
    omitted.push(...result.omittedEntityIds);
    approximated.push(...result.approximatedEntityIds);
  });
  return finalizeExportResult({
    output: undefined,
    warnings,
    errors: [],
    exportedEntityIds: exported,
    omittedEntityIds: omitted,
    approximatedEntityIds: approximated,
  });
};

interface SheetRef { id: string; name: string }

type SheetResolution = { ok: true; sheets: SheetRef[] } | { ok: false; message: string };

const resolveSheets = (drawing: CadDrawingDocument, selection: ExportCenterSelection): SheetResolution => {
  const draft = drawing.draft;
  if (!draft || draft.sheets.length === 0) {
    return { ok: false, message: 'No sheets yet. Create a sheet before exporting a sheet deliverable.' };
  }
  if (selection.format === 'pdf' && (selection.pdfScope ?? 'current') === 'all') {
    return { ok: true, sheets: draft.sheets.map((sheet) => ({ id: sheet.id, name: sheet.name })) };
  }
  const sheetId = selection.sheetId ?? draft.sheets[0]?.id;
  const sheet = draft.sheets.find((entry) => entry.id === sheetId);
  if (!sheet) {
    return { ok: false, message: `Sheet not found. Pick one of the ${draft.sheets.length} available sheet(s).` };
  }
  return { ok: true, sheets: [{ id: sheet.id, name: sheet.name }] };
};

type SceneDisposition = DispositionLists;

type SceneBuild = { ok: true; scenes: ExportSheetScene[]; merged: SceneDisposition } | { ok: false; message: string };

const buildSceneResults = (drawing: CadDrawingDocument, sheetIds: string[]): SceneBuild => {
  const draft = drawing.draft;
  if (!draft) return { ok: false, message: 'No draft yet. Sheets live on the draft document.' };
  try {
    const sceneResults = sheetIds.map((sheetId) =>
      buildExportSheetSceneWithResult({ draft, sheetId, project: drawing.project }),
    );
    return {
      ok: true,
      scenes: sceneResults.map((result) => result.output),
      merged: mergeWarnings(sceneResults),
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};

const describeSvg = (drawing: CadDrawingDocument, selection: ExportCenterSelection): ExportCenterOutcome => {
  const resolved = resolveSheets(drawing, selection);
  if (!resolved.ok) return resolved;
  const sheets = resolved.sheets as { id: string; name: string }[];
  const built = buildSceneResults(drawing, [sheets[0]?.id as string]);
  if (!built.ok) return built;
  const serialized = serializeExportSceneToSvgWithResult(built.scenes[0] as ExportSheetScene);
  const merged = mergeWarnings([built.merged, serialized]);
  const sheetName = sheets[0]?.name ?? 'sheet';
  return {
    ok: true,
    preview: {
      format: 'svg',
      formatLabel: EXPORT_FORMAT_LABELS.svg,
      scopeLabel: `Current sheet: ${sheetName}`,
      sheetNames: [sheetName],
      filename: buildExportCenterFileName(drawing.project.name, 'svg', sheetName),
      mimeType: 'image/svg+xml',
      isBinary: false,
      warnings: merged.warnings,
      omittedEntityIds: merged.omittedEntityIds,
      approximatedEntityIds: merged.approximatedEntityIds,
      warningsPending: false,
      payload: serialized.output,
    },
  };
};

const describePdf = (drawing: CadDrawingDocument, selection: ExportCenterSelection): ExportCenterOutcome => {
  const scope = selection.pdfScope ?? 'current';
  const resolved = resolveSheets(drawing, { ...selection, pdfScope: scope });
  if (!resolved.ok) return resolved;
  const sheets = resolved.sheets as { id: string; name: string }[];
  const built = buildSceneResults(drawing, sheets.map((sheet) => sheet.id));
  if (!built.ok) return built;
  const serialized = exportScenesToPdfWithResult(built.scenes);
  const merged = mergeWarnings([built.merged, serialized]);
  const sheetName = scope === 'all' ? undefined : (sheets[0]?.name ?? 'sheet');
  return {
    ok: true,
    preview: {
      format: 'pdf',
      formatLabel: EXPORT_FORMAT_LABELS.pdf,
      scopeLabel: scope === 'all' ? `All sheets (${sheets.length})` : `Current sheet: ${sheetName}`,
      sheetNames: sheets.map((sheet) => sheet.name),
      filename: buildExportCenterFileName(drawing.project.name, 'pdf', sheetName, scope),
      mimeType: 'application/pdf',
      isBinary: true,
      warnings: merged.warnings,
      omittedEntityIds: merged.omittedEntityIds,
      approximatedEntityIds: merged.approximatedEntityIds,
      warningsPending: false,
      payload: serialized.output,
    },
  };
};

const describeDxfR12 = (drawing: CadDrawingDocument): ExportCenterOutcome => {
  if (drawing.project.entities.length === 0) {
    return { ok: false, message: 'No model geometry to export. Import or draw entities first.' };
  }
  // Result-aware path: model + serializer warnings (unknown linetypes,
  // R12 lineweights) surface pre-download; the payload is the downloaded
  // bytes exactly.
  const result = buildDxfModelSpaceTextWithResult({ project: drawing.project });
  return {
    ok: true,
    preview: {
      format: 'dxf-r12',
      formatLabel: EXPORT_FORMAT_LABELS['dxf-r12'],
      scopeLabel: EXPORT_SCOPE_LABELS['dxf-r12'],
      sheetNames: [],
      filename: buildExportCenterFileName(drawing.project.name, 'dxf-r12'),
      mimeType: 'application/dxf',
      isBinary: false,
      warnings: result.warnings,
      omittedEntityIds: result.omittedEntityIds,
      approximatedEntityIds: result.approximatedEntityIds,
      warningsPending: false,
      payload: result.output,
    },
  };
};

const describeDxfR2000 = (drawing: CadDrawingDocument): ExportCenterOutcome => {
  if (!drawing.draft || drawing.draft.sheets.length === 0) {
    return { ok: false, message: 'No sheets yet. Create a sheet before exporting layouts.' };
  }
  // WithResult path: model warnings/dispositions plus mapped paper
  // warnings surface pre-download; the payload is the downloaded bytes.
  const result = buildDxfLayoutTextWithResult({ project: drawing.project, draft: drawing.draft });
  return {
    ok: true,
    preview: {
      format: 'dxf-r2000',
      formatLabel: EXPORT_FORMAT_LABELS['dxf-r2000'],
      scopeLabel: `${EXPORT_SCOPE_LABELS['dxf-r2000']}: ${result.output.layouts.join(', ')}`,
      sheetNames: drawing.draft.sheets.map((sheet) => sheet.name),
      filename: buildExportCenterFileName(drawing.project.name, 'dxf-r2000'),
      mimeType: 'application/dxf',
      isBinary: false,
      warnings: result.warnings,
      omittedEntityIds: result.omittedEntityIds,
      approximatedEntityIds: result.approximatedEntityIds,
      warningsPending: false,
      payload: result.output.dxf,
    },
  };
};

const describeLandxml = (
  drawing: CadDrawingDocument,
  civilSources?: CadLandXmlCivilSources,
): ExportCenterOutcome => {
  // Production CAD→LandXML adapter with per-entity disposition: every
  // project entity is exported XOR omitted, approximated ⊆ exported —
  // no silent drops, no warningsPending. Civil sources (runtime caches) are
  // optional: absent = surfaces/profiles/sections are blocked with reason.
  const result = buildLandXmlProjectExportWithResult(
    drawing.project,
    {
      units: drawing.units === 'ft' ? 'ft' : 'm',
      projectName: drawing.project.name,
    },
    civilSources,
  );
  if (result.exportedEntityIds.length === 0) {
    return { ok: false, message: 'No exportable geometry. Import or draw points first.' };
  }
  return {
    ok: true,
    preview: {
      format: 'landxml',
      formatLabel: EXPORT_FORMAT_LABELS.landxml,
      scopeLabel: `${EXPORT_SCOPE_LABELS.landxml} (${result.exportedEntityIds.length} entities, ${result.omittedEntityIds.length} omitted)`,
      sheetNames: [],
      filename: buildExportCenterFileName(drawing.project.name, 'landxml'),
      mimeType: 'application/xml',
      isBinary: false,
      warnings: result.warnings,
      omittedEntityIds: result.omittedEntityIds,
      approximatedEntityIds: result.approximatedEntityIds,
      warningsPending: false,
      classSummary: buildLandXmlClassSummary(drawing.project, result),
      payload: result.output,
    },
  };
};

/** Friendly failure mapping: serialization/support errors become messages, never stacks. */
export const buildExportCenterPreview = (
  drawing: CadDrawingDocument,
  selection: ExportCenterSelection,
  depOpts?: ExportDependencyOptions,
  civilSources?: CadLandXmlCivilSources,
): ExportCenterOutcome => {
  try {
    const gate = depOpts !== undefined
      ? checkDeliverableDependency(drawing, selection.format, depOpts)
      : null;
    if (gate) return gate;
    switch (selection.format) {
      case 'svg':
        return describeSvg(drawing, selection);
      case 'pdf':
        return describePdf(drawing, selection);
      case 'dxf-r12':
        return describeDxfR12(drawing);
      case 'dxf-r2000':
        return describeDxfR2000(drawing);
      case 'landxml':
        return describeLandxml(drawing, civilSources);
      case 'wncad':
        return {
          ok: true,
          preview: {
            format: 'wncad',
            formatLabel: EXPORT_FORMAT_LABELS.wncad,
            scopeLabel: EXPORT_SCOPE_LABELS.wncad,
            sheetNames: drawing.draft?.sheets.map((sheet) => sheet.name) ?? [],
            filename: buildExportCenterFileName(drawing.project.name, 'wncad'),
            mimeType: 'application/json',
            isBinary: false,
            warnings: [],
            omittedEntityIds: [],
            approximatedEntityIds: [],
            warningsPending: false,
            payload: serializeCadDrawingFile(drawing),
          },
        };
      case 'catalog': {
        const catalog = selection.catalog ?? null;
        if (!catalog) return { ok: false, message: 'No feature catalog in this context.' };
        return {
          ok: true,
          preview: {
            format: 'catalog',
            formatLabel: EXPORT_FORMAT_LABELS.catalog,
            scopeLabel: `${EXPORT_SCOPE_LABELS.catalog}: ${catalog.name || catalog.id}`,
            sheetNames: [],
            filename: buildExportCenterFileName(drawing.project.name, 'catalog'),
            mimeType: 'application/json',
            isBinary: false,
            warnings: [],
            omittedEntityIds: [],
            approximatedEntityIds: [],
            warningsPending: false,
            payload: exportCatalog(catalog),
          },
        };
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { ok: false, message: `Export failed: ${detail}` };
  }
};
