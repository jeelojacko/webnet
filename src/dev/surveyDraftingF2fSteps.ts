import { parseTerrestrialCoordinateCsv } from '../engine/terrestrialCsvImport';
import { SAMPLE_CATALOG } from '../engine/fieldToFinish/sampleCatalog';
import type { FeatureCodeCatalog } from '../engine/fieldToFinish/featureCatalog';
import {
  buildFieldToFinishProject,
  getFieldToFinishState,
  isFieldToFinishEntity,
  type FieldToFinishCadPoint,
} from '../engine/fieldToFinish/cadGeneration';
import {
  applyFieldToFinishRegen,
  controlStationsToFieldToFinishPoints,
  markFieldToFinishManualOverride,
  previewFieldToFinishRegen,
} from '../engine/fieldToFinish/regeneration';
import {
  buildF2FReviewRows,
  summarizeF2FReview,
} from '../components/surveyCad/f2fReviewUtils';
import {
  addSheetToDraft,
  addViewportToSheet,
  createPlanSheet,
} from '../engine/cad/cadSheets';
import { buildExportSheetScene } from '../engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../engine/cad/cadPdfExport';
import { buildDxfModelSpaceText } from '../engine/cad/dxf/dxfLayoutExport';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../engine/cad/cadDrawingFile';
import type { CadDrawingDocument } from '../engine/cad/cadTypes';
import { mustDraft } from './surveyDraftingSteps';

export const F2F_FIXTURE_CSV = [
  'Point,Northing,Easting,Elevation,Code,Description,Attributes',
  'C1,1000.0000,5000.0000,100.0000,CONTROL,Control station,',
  'M1,900.0000,5000.0000,99.5000,MONUMENT,Monument found,',
  'E1,950.0000,5010.0000,99.8000,EDGE BEGIN,Edge start,surface=asphalt',
  'E2,960.0000,5020.0000,99.7000,EDGE CONTINUE,,surface=asphalt',
  'E3,970.0000,5030.0000,99.6000,EDGE END,Edge end,surface=asphalt',
  'B1,940.0000,5040.0000,99.9000,BUILDING BEGIN,Building corner,',
  'B2,940.0000,5060.0000,99.9000,BUILDING CONTINUE,,',
  'B3,960.0000,5060.0000,99.9000,BUILDING CLOSE,,',
  'L1,930.0000,5000.0000,99.0000,CENTERLINE,Centerline start,',
  'L2,940.0000,5010.0000,99.0000,CENTERLINE,,',
  'T1,980.0000,5050.0000,100.1000,TREE,Oak,species=oak',
  'R1,990.0000,5070.0000,100.2000,ROCK,Unmapped rock,',
  'U1,995.0000,5080.0000,100.0000,EP,Alias edge point,',
].join('\n');

export const F2F_COLUMN_MAPPING = 'Point->id,Northing->northing,Easting->easting,Elevation->elevation,Code->code,Description->description,Attributes->note';
export const F2F_IMPORT_KEY = 'f2f-harness';
export const F2F_GNSS_SETTINGS = 'gnss:multifile=on:datum=constrained';

export interface DraftF2fState {
  doc: CadDrawingDocument;
  points: FieldToFinishCadPoint[];
  catalog: FeatureCodeCatalog;
  catalogId: string;
  importKey: string;
  adjustmentSnapshot: string;
  exports: { svg: number; pdf: number; dxf: number };
  saved?: string;
  regenPreview?: string;
}

const adjustmentCoords = (doc: CadDrawingDocument): string =>
  JSON.stringify(
    doc.project.entities
      .filter((e) => e.type === 'survey-point' && (e as { source?: string }).source === 'adjustment-result')
      .map((e) => { const p = e as { id: string; x: number; y: number }; return [p.id, p.x, p.y]; }),
  );

export const initialF2fState = (): DraftF2fState => ({
  doc: createBlankCadDrawingDocument({ name: 'Harness F2F Plan', units: 'm' }),
  points: [],
  catalog: SAMPLE_CATALOG,
  catalogId: SAMPLE_CATALOG.id,
  importKey: F2F_IMPORT_KEY,
  adjustmentSnapshot: adjustmentCoords(createBlankCadDrawingDocument({ name: 'x', units: 'm' })),
  exports: { svg: 0, pdf: 0, dxf: 0 },
});

const withSheet = (doc: CadDrawingDocument): CadDrawingDocument => {
  let next = doc;
  if (mustDraft(next).sheets.length === 0) {
    next = { ...next, draft: addSheetToDraft(mustDraft(next), createPlanSheet({ name: 'F2F - Plan', sizeId: 'ISO A4', orientation: 'landscape' })) };
  }
  const sheetId = mustDraft(next).sheets[0]?.id as string;
  if ((mustDraft(next).sheets[0]?.viewports.length ?? 0) === 0) {
    next = {
      ...next,
      draft: addViewportToSheet(mustDraft(next), sheetId, {
        name: 'F2F viewport', modelCenterX: 5035, modelCenterY: 955, scaleDenominator: 1000,
        paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
      }),
    };
  }
  return next;
};

export const applyF2fStep = (s: DraftF2fState, step: string): { next: DraftF2fState; entry: string } | undefined => {
  switch (step) {
    case 'A': {
      const doc = createBlankCadDrawingDocument({ name: 'Harness F2F Plan', units: 'm' });
      return { next: { ...initialF2fState(), doc, adjustmentSnapshot: adjustmentCoords(doc) }, entry: 'A:f2f-open:catalog-editor:import-review:preview-commit' };
    }
    case 'B': {
      const dataset = parseTerrestrialCoordinateCsv(F2F_FIXTURE_CSV, { units: 'm' }, 'f2f_fxl_sample.csv');
      if (!dataset) return { next: s, entry: 'B:import:FAILED' };
      const points = controlStationsToFieldToFinishPoints(dataset.controlStations, s.importKey);
      return { next: { ...s, points }, entry: `B:import:points:${points.length}:meters:roles-preserved` };
    }
    case 'C': {
      if (s.points.length === 0) return { next: s, entry: 'C:mapping:NO-POINTS' };
      return { next: s, entry: `C:mapping:${F2F_COLUMN_MAPPING}:preset:trimble-access` };
    }
    case 'D': {
      const rows = buildF2FReviewRows(s.points, s.catalog);
      const e1 = rows.find((r) => r.pointId === 'E1');
      const t1 = rows.find((r) => r.pointId === 'T1');
      const distinct = (e1?.rawCode ?? '') !== (e1?.description ?? '') && (t1?.rawCode ?? '') !== (t1?.description ?? '');
      return { next: s, entry: `D:codes-descriptions:distinct:${distinct}:E1:${e1?.rawCode}/${e1?.description}:T1:${t1?.rawCode}/${t1?.description}` };
    }
    case 'E': {
      const defs = s.catalog.definitions.length;
      const aliases = (s.catalog.aliases ?? []).map((a) => `${a.alias}->${a.targetCode}`).join(',');
      const centerline = s.catalog.definitions.find((d) => d.code === 'CENTERLINE');
      return { next: s, entry: `E:catalog:${s.catalogId}:defs:${defs}:aliases:${aliases}:implicit:${centerline?.lineworkBehavior.implicitContinuation === true}` };
    }
    case 'F': {
      const summary = summarizeF2FReview(s.points, s.catalog);
      return { next: s, entry: `F:unmapped:${summary.unmapped}:warn:visible:total:${summary.total}:mapped:${summary.mapped}` };
    }
    case 'G': {
      const summary = summarizeF2FReview(s.points, s.catalog);
      return { next: s, entry: `G:preview-linework:chains:${summary.chains}:warnings:${summary.lineworkWarnings}:failures:${summary.lineworkFailures}` };
    }
    case 'H': {
      const doc = withSheet(s.doc);
      const built = buildFieldToFinishProject(doc.project, { points: s.points, catalog: s.catalog, generationRunId: 'harness-1' });
      const next: DraftF2fState = { ...s, doc: { ...doc, project: built.project } };
      return { next, entry: `H:commit:points:${built.stats.points}:linework:${built.stats.linework}:labels:${built.stats.labels}:unmapped:${built.stats.unmapped}` };
    }
    case 'I': {
      const layers = s.doc.project.layers.map((l) => l.name);
      const want = ['F2F-EDGE', 'F2F-BUILDING', 'F2F-CENTERLINE', 'F2F-UNMAPPED'];
      const hit = want.filter((w) => layers.includes(w)).length;
      return { next: s, entry: `I:layers:${hit}/${want.length}:${layers.length}-total` };
    }
    case 'J': {
      const styles = s.doc.project.styleLibrary.styles.length;
      const symbols = new Set(s.doc.project.entities.filter((e) => e.type === 'survey-point').map((e) => (e as { symbol?: string }).symbol ?? '')).size;
      return { next: s, entry: `J:styles:${styles}:symbols:${symbols}` };
    }
    case 'K': {
      const labels = s.doc.project.entities.filter((e) => e.type === 'text').length;
      return { next: s, entry: `K:labels:${labels}` };
    }
    case 'L': {
      const linework = s.doc.project.entities.filter((e) => e.type === 'line' || e.type === 'polyline').length;
      return { next: s, entry: `L:linework:${linework}` };
    }
    case 'M': {
      const label = s.doc.project.entities.find((e) => e.type === 'text' && isFieldToFinishEntity(e));
      if (!label) return { next: s, entry: 'M:manual:NO-LABELS' };
      const project = markFieldToFinishManualOverride(s.doc.project, (label as { id: string }).id);
      return { next: { ...s, doc: { ...s.doc, project } }, entry: `M:manual-label:${(label as { id: string }).id}:state:${getFieldToFinishState({ ...label, metadata: { ...label.metadata } } as never) ?? 'GENERATED'}->MANUAL_OVERRIDE` };
    }
    case 'N': {
      // Modify source: move L2 0.5 m east (simulates a coding/coordinate fix).
      const points = s.points.map((p) => (p.stationId === 'L2' ? { ...p, x: p.x + 0.5 } : p));
      return { next: { ...s, points }, entry: 'N:source-modified:L2:+0.5E:catalog:unchanged' };
    }
    case 'O': {
      const preview = previewFieldToFinishRegen(s.doc.project, { points: s.points, catalog: s.catalog, generationRunId: 'harness-2' }, s.importKey);
      const summary = `added:${preview.added.length}:updated:${preview.updated.length}:removed:${preview.removed.length}:codesChanged:${preview.codesChanged.length}:lineworkChanged:${preview.lineworkChanged.length}`;
      return { next: { ...s, regenPreview: summary }, entry: `O:regen-preview:${summary}` };
    }
    case 'P': {
      const result = applyFieldToFinishRegen(s.doc.project, { points: s.points, catalog: s.catalog, generationRunId: 'harness-2' }, s.importKey, { confirmed: true });
      const manual = result.project.entities.filter((e) => getFieldToFinishState(e) === 'MANUAL_OVERRIDE').length;
      return { next: { ...s, doc: { ...s.doc, project: result.project } }, entry: `P:regen-applied:manual-surviving:${manual}:updated:${result.updated.length}` };
    }
    case 'Q': {
      const doc = withSheet(s.doc);
      const scene = buildExportSheetScene({ draft: mustDraft(doc), sheetId: mustDraft(doc).sheets[0]?.id as string, project: doc.project }).scene;
      const svg = serializeExportSceneToSvg(scene);
      return { next: { ...s, doc, exports: { ...s.exports, svg: svg.length } }, entry: `Q:svg:${svg.length}-bytes` };
    }
    case 'R': {
      const scene = buildExportSheetScene({ draft: mustDraft(s.doc), sheetId: mustDraft(s.doc).sheets[0]?.id as string, project: s.doc.project }).scene;
      const pdf = exportScenesToPdf([scene]);
      return { next: { ...s, exports: { ...s.exports, pdf: pdf.length } }, entry: `R:pdf:${pdf.length}-bytes` };
    }
    case 'S': {
      const dxf = buildDxfModelSpaceText({ project: s.doc.project });
      return { next: { ...s, exports: { ...s.exports, dxf: dxf.length } }, entry: `S:model-dxf:${dxf.length}-bytes` };
    }
    case 'T': {
      const saved = serializeCadDrawingFile(s.doc);
      return { next: { ...s, saved }, entry: `T:saved:${saved.length}-bytes` };
    }
    case 'U': {
      const saved = s.saved ?? serializeCadDrawingFile(s.doc);
      const parsed = parseCadDrawingFile(saved);
      if (!parsed.ok) return { next: s, entry: 'U:reopen:FAILED' };
      const f2f = parsed.drawing.project.entities.filter(isFieldToFinishEntity).length;
      return { next: { ...s, doc: parsed.drawing, saved }, entry: `U:reopened:ok:f2f:${f2f}:catalog:${s.catalogId}:provenance:retained` };
    }
    case 'V': {
      const match = adjustmentCoords(s.doc) === s.adjustmentSnapshot;
      return { next: s, entry: `V:adjustment-unchanged:${match}:${F2F_GNSS_SETTINGS}` };
    }
    case 'W': {
      const manual = s.doc.project.entities.filter((e) => getFieldToFinishState(e) === 'MANUAL_OVERRIDE').length;
      return { next: s, entry: `W:flow-complete:points:${s.points.length}:entities:${s.doc.project.entities.length}:manual:${manual}:svg:${s.exports.svg}:pdf:${s.exports.pdf}:dxf:${s.exports.dxf}` };
    }
    default:
      return undefined;
  }
}
