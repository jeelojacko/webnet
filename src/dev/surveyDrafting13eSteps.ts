import { LSAEngine } from '../engine/adjust';
import { createBlankCadDrawingDocument, parseCadDrawingFile, serializeCadDrawingFile } from '../engine/cad/cadDrawingFile';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../engine/cad/cadSheets';
import type { CadDrawingDocument, CadTextEntity } from '../engine/cad/cadTypes';
import { buildExportCenterPreview } from '../engine/cad/exportCenter';
import {
  buildFieldToFinishProject,
  getFieldToFinishState,
  type FieldToFinishCadPoint,
} from '../engine/fieldToFinish/cadGeneration';
import {
  adjustedStationsToFieldToFinishPoints,
  applyAdjustmentRerunToLinkedF2f,
  markFieldToFinishManualOverride,
} from '../engine/fieldToFinish/regeneration';
import { SAMPLE_CATALOG } from '../engine/fieldToFinish/sampleCatalog';
import type { AdjustmentResult, ParseOptions } from '../types';
import { mustDraft } from './surveyDraftingSteps';

export const E13_BASE_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 60 40 0',
  'D A-C 72.1110255 0.005',
  'D B-C 56.5685425 0.005',
].join('\n');

export const E13_ALTERED_INPUT = E13_BASE_INPUT.replace('D A-C 72.1110255 0.005', 'D A-C 72.6110255 0.005');

const E13_PARSE_OPTIONS: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: { bearing: 'grid', distance: 'measured', angle: 'measured', direction: 'measured' },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

export const E13_GNSS_SETTINGS = 'gnss:multifile=on:datum=constrained';
const E13_SETTINGS_FINGERPRINT = JSON.stringify(E13_PARSE_OPTIONS) + E13_GNSS_SETTINGS;

const e13BasePoints = (): FieldToFinishCadPoint[] => ([
  { stationId: 'A', x: 0, y: 0, sourceOrder: 1, rawCodeText: 'EDGE BEGIN', codes: [{ code: 'EDGE BEGIN', rawCode: 'EDGE BEGIN' }], sourceImportId: 'e13-1' },
  { stationId: 'B', x: 100, y: 0, sourceOrder: 2, rawCodeText: 'EDGE END', codes: [{ code: 'EDGE END', rawCode: 'EDGE END' }], sourceImportId: 'e13-1' },
  { stationId: 'C', x: 60, y: 40, sourceOrder: 3, rawCodeText: 'TREE', codes: [{ code: 'TREE', rawCode: 'TREE' }], description: 'Oak', sourceImportId: 'e13-1' },
]);

export interface Draft13eState {
  doc: CadDrawingDocument;
  first: AdjustmentResult | null;
  second: AdjustmentResult | null;
  moved: number;
  exports: Record<string, number>;
  svgBefore: string;
  svgAfter: string;
  saved?: string;
  settingsSnapshot: string;
}

export const initial13eState = (): Draft13eState => ({
  doc: createBlankCadDrawingDocument({ name: 'E13 Linked F2F Plan', units: 'm' }),
  first: null,
  second: null,
  moved: 0,
  exports: {},
  svgBefore: '',
  svgAfter: '',
  settingsSnapshot: E13_SETTINGS_FINGERPRINT,
});

const solve = (input: string): AdjustmentResult =>
  new LSAEngine({ input, parseOptions: E13_PARSE_OPTIONS, maxIterations: 8 }).solve() as AdjustmentResult;

const adjustedOf = (result: AdjustmentResult): Map<string, { x: number; y: number }> =>
  new Map(Object.entries(result.stations).map(([id, station]) => [id, { x: station.x, y: station.y }]));

const withSheet = (doc: CadDrawingDocument): CadDrawingDocument => {
  let next = doc;
  if (mustDraft(next).sheets.length === 0) {
    next = { ...next, draft: addSheetToDraft(mustDraft(next), createPlanSheet({ name: 'E13 - Plan', sizeId: 'ISO A4', orientation: 'landscape' })) };
  }
  const sheetId = mustDraft(next).sheets[0]?.id as string;
  if ((mustDraft(next).sheets[0]?.viewports.length ?? 0) === 0) {
    next = {
      ...next,
      draft: addViewportToSheet(mustDraft(next), sheetId, {
        name: 'E13 viewport', modelCenterX: 50, modelCenterY: 20, scaleDenominator: 500,
        paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
      }),
    };
  }
  return next;
};

const previewLength = (doc: CadDrawingDocument, format: 'svg' | 'pdf' | 'dxf-r12' | 'dxf-r2000' | 'landxml', pdfScope?: 'all'): number => {
  const outcome = buildExportCenterPreview(withSheet(doc), { format, pdfScope, catalog: SAMPLE_CATALOG });
  if (!outcome.ok) return -1;
  const payload = outcome.preview.payload;
  return typeof payload === 'string' ? payload.length : payload.length;
};

export const apply13eStep = (s: Draft13eState, step: string): { next: Draft13eState; entry: string } | undefined => {
  switch (step) {
    case 'A': {
      const doc = createBlankCadDrawingDocument({ name: 'E13 Linked F2F Plan', units: 'm' });
      return { next: { ...initial13eState(), doc }, entry: 'A:open:E13-Linked-F2F-Plan' };
    }
    case 'B': {
      const first = solve(E13_BASE_INPUT);
      if (!first.success) return { next: s, entry: 'B:adjustment:FAILED' };
      return { next: { ...s, first }, entry: `B:adjustment-backed:stations:${Object.keys(first.stations).length}:success:true` };
    }
    case 'C': {
      if (!s.first?.success) return { next: s, entry: 'C:f2f:NO-ADJUSTMENT' };
      const project = buildFieldToFinishProject(s.doc.project, {
        points: adjustedStationsToFieldToFinishPoints(e13BasePoints(), adjustedOf(s.first)),
        catalog: SAMPLE_CATALOG,
        generationRunId: 'e13-1',
      }).project;
      return { next: { ...s, doc: { ...s.doc, project } }, entry: `C:f2f-generated:link:${project.metadata.fieldToFinishLink?.status ?? 'missing'}` };
    }
    case 'D': {
      const doc = withSheet(s.doc);
      return { next: { ...s, doc }, entry: `D:sheet:${mustDraft(doc).sheets.length}:viewports:${mustDraft(doc).sheets[0]?.viewports.length ?? 0}` };
    }
    case 'E':
      return { next: s, entry: 'E:export-ui:open:Export-Center' };
    case 'F': {
      const length = previewLength(s.doc, 'svg');
      return { next: { ...s, exports: { ...s.exports, svg: length } }, entry: `F:svg:${length}-bytes` };
    }
    case 'G': {
      const length = previewLength(s.doc, 'pdf', 'all');
      return { next: { ...s, exports: { ...s.exports, pdf: length } }, entry: `G:pdf-all-sheets:${length}-bytes` };
    }
    case 'H': {
      const length = previewLength(s.doc, 'dxf-r12');
      return { next: { ...s, exports: { ...s.exports, r12: length } }, entry: `H:dxf-r12:${length}-bytes` };
    }
    case 'I': {
      const length = previewLength(s.doc, 'dxf-r2000');
      return { next: { ...s, exports: { ...s.exports, r2000: length } }, entry: `I:dxf-r2000:${length}-bytes` };
    }
    case 'J': {
      const length = previewLength(s.doc, 'landxml');
      return { next: { ...s, exports: { ...s.exports, landxml: length } }, entry: `J:landxml:${length}-bytes` };
    }
    case 'K': {
      // Warnings surface pre-download per format; count merged SVG+DXF warnings.
      const svg = buildExportCenterPreview(withSheet(s.doc), { format: 'svg', catalog: SAMPLE_CATALOG });
      const dxf = buildExportCenterPreview(withSheet(s.doc), { format: 'dxf-r12', catalog: SAMPLE_CATALOG });
      const count = (svg.ok ? svg.preview.warnings.length : 0) + (dxf.ok ? dxf.preview.warnings.length : 0);
      const pending = dxf.ok && (dxf.preview.warningsPending || svg.ok && svg.preview.warningsPending);
      return { next: s, entry: `K:warnings:${count}:pending:${pending}:visible:true` };
    }
    case 'L': {
      const styles = s.doc.project.styleLibrary.styles.length;
      const layers = s.doc.project.layers.length;
      const colored = s.doc.project.layers.filter((l) => l.color != null).length;
      return { next: s, entry: `L:colors-styles:styles:${styles}:layers:${layers}:colored:${colored}` };
    }
    case 'M': {
      const linework = s.doc.project.entities.filter((e) => e.type === 'line' || e.type === 'polyline').length;
      return { next: s, entry: `M:linework:${linework}` };
    }
    case 'N': {
      const symbols = new Set(s.doc.project.entities.filter((e) => e.type === 'survey-point').map((e) => (e as { symbol?: string }).symbol ?? '')).size;
      const dxf = buildExportCenterPreview(withSheet(s.doc), { format: 'dxf-r12', catalog: SAMPLE_CATALOG });
      const warnCount = dxf.ok ? dxf.preview.warnings.length : -1;
      return { next: s, entry: `N:symbols:${symbols}:dxf-warnings:${warnCount}` };
    }
    case 'O': {
      if (!s.first?.success) return { next: s, entry: 'O:rerun:NO-BASELINE' };
      // Drag generated C label aside + mark manual BEFORE rerun so P/Q can verify survival.
      const label = s.doc.project.entities.find((e): e is CadTextEntity => e.type === 'text' && e.id === 'label:C');
      const dragged = label
        ? s.doc.project.entities.map((e) => (e.id === 'label:C' && e.type === 'text' ? { ...e, x: e.x + 5, y: e.y - 3 } : e))
        : s.doc.project.entities;
      const withManual = label ? markFieldToFinishManualOverride({ ...s.doc.project, entities: dragged }, 'label:C') : s.doc.project;
      const second = solve(E13_ALTERED_INPUT);
      if (!second.success) return { next: { ...s, doc: { ...s.doc, project: withManual } }, entry: 'O:rerun:FAILED' };
      const moved = Math.hypot(second.stations['C']!.x - s.first.stations['C']!.x, second.stations['C']!.y - s.first.stations['C']!.y);
      const svgOutcome = buildExportCenterPreview(withSheet({ ...s.doc, project: withManual }), { format: 'svg', catalog: SAMPLE_CATALOG });
      const svgBefore = svgOutcome.ok && typeof svgOutcome.preview.payload === 'string' ? svgOutcome.preview.payload : '';
      return {
        next: { ...s, doc: { ...s.doc, project: withManual }, second, moved, svgBefore },
        entry: `O:rerun:moved-C:${moved.toFixed(4)}:manual-marked:${label ? 'label:C' : 'none'}`,
      };
    }
    case 'P': {
      if (!s.second) return { next: s, entry: 'P:autosync:NO-RERUN' };
      const outcome = applyAdjustmentRerunToLinkedF2f(s.doc.project, { result: s.second, inputFingerprint: 'e13-run-2', settingsFingerprint: 'settings-1' });
      return {
        next: { ...s, doc: { ...s.doc, project: outcome.project } },
        entry: `P:autosync:changed:${outcome.changed}:updated:${outcome.updated.join(',') || 'none'}:status:${outcome.status}`,
      };
    }
    case 'Q': {
      const label = s.doc.project.entities.find((e) => e.type === 'text' && e.id === 'label:C');
      const manual = s.doc.project.entities.filter((e) => getFieldToFinishState(e) === 'MANUAL_OVERRIDE').length;
      const pos = label && label.type === 'text' ? `${(label as CadTextEntity).x.toFixed(2)},${(label as CadTextEntity).y.toFixed(2)}` : 'missing';
      return { next: s, entry: `Q:manual-unchanged:manual:${manual}:label:C:${pos}` };
    }
    case 'R': {
      const svgOutcome = buildExportCenterPreview(withSheet(s.doc), { format: 'svg', catalog: SAMPLE_CATALOG });
      const svgAfter = svgOutcome.ok && typeof svgOutcome.preview.payload === 'string' ? svgOutcome.preview.payload : '';
      const pointC = s.doc.project.entities.find((e) => e.type === 'survey-point' && (e as { stationId?: string }).stationId === 'C') as { x: number; y: number } | undefined;
      const present = svgAfter.includes((pointC?.x ?? NaN).toFixed(2)) || svgAfter.includes('Oak');
      return {
        next: { ...s, svgAfter, exports: { ...s.exports, svgAfter: svgAfter.length } },
        entry: `R:re-export:svg:${svgAfter.length}-bytes:changed:${svgAfter !== s.svgBefore}:new-coords:${present}`,
      };
    }
    case 'S':
      return { next: s, entry: 'S:covered-by-R:re-export-verified' };
    case 'T': {
      const saved = serializeCadDrawingFile(s.doc);
      const parsed = parseCadDrawingFile(saved);
      if (!parsed.ok) return { next: s, entry: 'T:save:reopen-FAILED' };
      return { next: { ...s, doc: parsed.drawing, saved }, entry: `T:saved:${saved.length}-bytes:reopened:ok` };
    }
    case 'U': {
      const link = s.doc.project.metadata.fieldToFinishLink;
      return { next: s, entry: `U:linked:${link?.status ?? 'missing'}:catalog:${link?.catalogId ?? 'missing'}:stations:${link?.stationIds.length ?? 0}` };
    }
    case 'V': {
      const before = JSON.stringify(s.doc.project.entities);
      const failed = s.first ? { ...s.first, success: false as const } : null;
      const outcome = applyAdjustmentRerunToLinkedF2f(s.doc.project, { result: failed });
      const intact = JSON.stringify(outcome.project.entities) === before && !outcome.changed;
      return { next: s, entry: `V:failed-rerun:unchanged:${intact}:status:${outcome.status}` };
    }
    case 'W': {
      const unchanged = s.settingsSnapshot === E13_SETTINGS_FINGERPRINT;
      return { next: s, entry: `W:settings-unchanged:${unchanged}:${E13_GNSS_SETTINGS}` };
    }
    default:
      return undefined;
  }
}
