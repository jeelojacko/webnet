import { buildDxfLayoutText, buildDxfModelSpaceText } from '../engine/cad/dxf/dxfLayoutExport';
import { buildExportSheetScene } from '../engine/cad/cadExportScene';
import { buildDraftPointTable, continuedRangesForTable, createLogicalTableFromDraftTable, addLogicalTableToDraft } from '../engine/cad/cadDraftTables';
import type { DraftDocumentLabel, DraftLogicalTable } from '../engine/cad/cadDraftTypes';
import { createDraftLabel, moveDraftLabel, type CadDraftLabel } from '../engine/cad/cadLabelEngine';
import { autoPlaceViewportLabels } from '../engine/cad/cadLabelAutoPlacement';
import {
  addSheetToDraft,
  addViewportToSheet,
  createPlanSheet,
  createTitleBlockTemplate,
  duplicateTitleBlockTemplate,
  editTitleBlockTemplateElements,
} from '../engine/cad/cadSheets';
import { serializeExportSceneToSvg } from '../engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../engine/cad/cadPdfExport';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../engine/cad/cadDrawingFile';
import type { CadDrawingDocument, CadEntity } from '../engine/cad/cadTypes';
import { buildLandXmlImportPreview, type LandXmlImportPreview } from '../engine/landxmlImport';
import { mustDraft, seedModel } from './surveyDraftingSteps';

export interface Draft13cState {
  doc: CadDrawingDocument;
  labels: CadDraftLabel[];
  table?: DraftLogicalTable;
  preview?: LandXmlImportPreview;
  exports: { svg: number; pdf: number; r12: number; layout: number; layoutWarnings: number };
  saved?: string;
  adjustmentSnapshot?: string;
  secondPlacement?: string;
}

export const initial13cState = (): Draft13cState => ({
  doc: createBlankCadDrawingDocument({ name: 'Harness 13C Plan', units: 'm' }),
  labels: [],
  exports: { svg: 0, pdf: 0, r12: 0, layout: 0, layoutWarnings: 0 },
});

export const LANDXML_13C_FIXTURE = [
  '<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" version="1.2" language="English">',
  '<Units><Metric areaUnit="squareMeter" linearUnit="meter" /></Units>',
  '<CoordinateSystem desc="NAD83 / Test" />',
  '<CgPoints>',
  '<CgPoint name="LX1" oID="LX1" desc="IP">500.000000 600.000000 10.000000</CgPoint>',
  '<CgPoint name="LX2" oID="LX2" desc="IP">500.000000 700.000000 10.500000</CgPoint>',
  '<CgPoint name="LX3" oID="LX3" desc="IP">600.000000 700.000000 11.000000</CgPoint>',
  '</CgPoints>',
  '<PlanFeatures name="Base"><PlanFeature name="LXL1"><CoordGeom>',
  '<Line><Start pntRef="LX1">500.000000 600.000000 10.000000</Start><End pntRef="LX2">500.000000 700.000000 10.500000</End></Line>',
  '</CoordGeom></PlanFeature></PlanFeatures>',
  '<Parcels><Parcel name="LX-LOT"><CoordGeom>',
  '<Line><Start pntRef="LX1">500.000000 600.000000 10.500000</Start><End pntRef="LX2">500.000000 700.000000 10.500000</End></Line>',
  '<Line><Start pntRef="LX2">500.000000 700.000000 10.500000</Start><End pntRef="LX3">600.000000 700.000000 11.000000</End></Line>',
  '<Line><Start pntRef="LX3">600.000000 700.000000 11.000000</Start><End pntRef="LX1">500.000000 600.000000 10.000000</End></Line>',
  '</CoordGeom></Parcel></Parcels>',
  '<Alignments><Alignment name="LX-CL"><CoordGeom>',
  '<Line><Start pntRef="LX1">500.000000 600.000000 10.000000</Start><End pntRef="LX2">500.000000 700.000000 10.500000</End></Line>',
  '<Spiral length="50" radiusStart="INF" radiusEnd="500" />',
  '</CoordGeom></Alignment></Alignments>',
  '</LandXML>',
].join('');

const adjustmentCoords = (doc: CadDrawingDocument): string =>
  JSON.stringify(
    doc.project.entities
      .filter((e) => e.type === 'survey-point' && (e as { source?: string }).source === 'adjustment-result')
      .map((e) => { const p = e as { id: string; x: number; y: number }; return [p.id, p.x, p.y]; }),
  );

const denseClusterEntities = (): CadEntity[] =>
  Array.from({ length: 12 }, (_, i): CadEntity => ({
    type: 'survey-point',
    id: `pt-D${i + 1}`,
    layerId: 'points',
    visible: true,
    locked: false,
    stationId: `D${i + 1}`,
    x: 24 + (i % 4) * 0.8,
    y: 19 + Math.floor(i / 4) * 0.8,
    pointClass: 'free',
    source: 'parsed-input',
  }));

const toDocLabels = (labels: CadDraftLabel[]): DraftDocumentLabel[] =>
  labels.map((label, i) => ({
    id: label.id,
    text: label.displayText,
    xModel: 24 + (i % 4) * 0.8,
    yModel: 19 + Math.floor(i / 4) * 0.8,
    layerId: 'labels',
    placement: label.placement,
    ...(label.viewportOverrides ? { viewportOverrides: { ...label.viewportOverrides } } : {}),
    ...(label.leader ? { leader: { enabled: label.leader.enabled } } : {}),
    ...(label.sourceEntityId ? { sourceEntityId: label.sourceEntityId } : {}),
  }));

const withDocLabels = (doc: CadDrawingDocument, labels: CadDraftLabel[]): CadDrawingDocument => ({
  ...doc,
  draft: { ...mustDraft(doc), labels: toDocLabels(labels) },
});

const labelInputs = (labels: CadDraftLabel[], cx: number, cy: number, w: number, h: number) =>
  labels.map((label) => ({
    label,
    anchorMm: { x: cx, y: cy },
    sizeMm: { width: w, height: h },
  }));

export interface Applied13c {
  next: Draft13cState;
  entry: string;
}

export const apply13cStep = (s: Draft13cState, step: string): Applied13c | undefined => {
  switch (step) {
    case 'A': {
      let doc = seedModel(s.doc);
      if (mustDraft(doc).sheets.length === 0) {
        doc = { ...doc, draft: addSheetToDraft(mustDraft(doc), createPlanSheet({ name: 'C1 - Plan', sizeId: 'ISO A4', orientation: 'landscape' })) };
      }
      const sheetId = mustDraft(doc).sheets[0]?.id as string;
      if ((mustDraft(doc).sheets[0]?.viewports.length ?? 0) === 0) {
        doc = {
          ...doc,
          draft: addViewportToSheet(mustDraft(doc), sheetId, {
            name: 'Plan viewport', modelCenterX: 25, modelCenterY: 20, scaleDenominator: 500,
            paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
          }),
        };
      }
      return { next: { ...s, doc, adjustmentSnapshot: adjustmentCoords(doc) }, entry: `A:sample:entities:${doc.project.entities.length}` };
    }
    case 'B': {
      const doc = { ...s.doc, project: { ...s.doc.project, entities: [...s.doc.project.entities, ...denseClusterEntities()] } };
      const fresh = denseClusterEntities().map((e, i) =>
        createDraftLabel({ id: `lbl-D${i + 1}`, labelType: 'point', provenance: 'COGO', sourceEntityId: (e as { id: string }).id }),
      );
      const placed = autoPlaceViewportLabels({
        labels: labelInputs(fresh, 100, 65, 18, 6),
        viewportId: mustDraft(doc).sheets[0]?.viewports[0]?.id as string,
        obstaclesMm: [],
        viewportMm: { xMm: 15, yMm: 15, widthMm: 200, heightMm: 130 },
      });
      const labels = fresh.map((label) => {
        const hit = placed.find((p) => p.labelId === label.id);
        return hit ? { ...label, viewportOverrides: { [hit.viewportId]: hit.override }, leader: { enabled: hit.leaderEnabled } } : label;
      });
      const leaders = placed.filter((p) => p.leaderEnabled).length;
      const docWithLabels = withDocLabels(doc, labels);
      return { next: { ...s, doc: docWithLabels, labels }, entry: `B:auto-place:${placed.length}-labels:leaders:${leaders}` };
    }
    case 'C': {
      const target = s.labels[0];
      if (!target) return { next: s, entry: 'C:manual:NO-LABELS' };
      const moved = { ...moveDraftLabel(target, { dxMm: 12, dyMm: -8 }), leader: { enabled: true, elbowMm: 2 } };
      const labels = s.labels.map((l) => (l.id === moved.id ? moved : l));
      return {
        next: { ...s, doc: withDocLabels(s.doc, labels), labels },
        entry: `C:manual:${moved.id}:placement:${moved.placement}:leader:true`,
      };
    }
    case 'D': {
      const sheetId = mustDraft(s.doc).sheets[0]?.id as string;
      const draft = addViewportToSheet(mustDraft(s.doc), sheetId, {
        name: 'Detail viewport', modelCenterX: 25, modelCenterY: 19.5, scaleDenominator: 250,
        paperXmm: 15, paperYmm: 90, paperWidthMm: 90, paperHeightMm: 55,
      });
      const doc = { ...s.doc, draft };
      const vp2 = mustDraft(doc).sheets[0]?.viewports[1]?.id as string;
      const placed = autoPlaceViewportLabels({
        labels: labelInputs(s.labels.filter((l) => l.placement !== 'MANUAL'), 45, 110, 18, 6),
        viewportId: vp2, obstaclesMm: [],
        viewportMm: { xMm: 15, yMm: 90, widthMm: 90, heightMm: 55 },
      });
      const second = placed.map((p) => `${p.labelId}@${p.candidate}`).join(',');
      const labels = s.labels.map((label) => {
        const hit = placed.find((p) => p.labelId === label.id);
        if (!hit) return label;
        const prior = label.viewportOverrides ?? {};
        return { ...label, viewportOverrides: { ...prior, [hit.viewportId]: hit.override } };
      });
      return { next: { ...s, doc: withDocLabels(doc, labels), labels, secondPlacement: second }, entry: `D:viewport2:auto:${placed.length}:manual-kept:true` };
    }
    case 'E': {
      const entries = s.doc.project.entities
        .filter((e) => e.type === 'survey-point')
        .map((e) => { const p = e as { stationId: string; id: string; x: number; y: number }; return { pointId: p.stationId, entityId: p.id, northing: p.y, easting: p.x }; });
      const table = buildDraftPointTable(entries);
      const logical = createLogicalTableFromDraftTable({
        name: 'Coordinates', headers: [...table.headers], rows: table.rows.map((r) => [...r]),
        continueMode: 'AUTO', headerRepeat: true, showContinuedMarker: true, maxRowsPerFragment: 4,
      });
      const ranges = continuedRangesForTable(logical);
      const draft = addLogicalTableToDraft(mustDraft(s.doc), logical);
      return {
        next: { ...s, doc: { ...s.doc, draft }, table: logical },
        entry: `E:table:rows:${logical.rows.length}:fragments:${ranges.length}:continued:${ranges.length > 1}`,
      };
    }
    case 'F': {
      const doc = { ...s.doc, draft: addSheetToDraft(mustDraft(s.doc), createPlanSheet({ name: 'C2 - Details', sizeId: 'ISO A4', orientation: 'landscape' })) };
      return { next: { ...s, doc }, entry: `F:sheets:${mustDraft(doc).sheets.length}` };
    }
    case 'G':
    case 'H': {
      let draft = mustDraft(s.doc);
      if (draft.titleBlockDefinitions.length === 0) {
        const created = createTitleBlockTemplate('Standard');
        draft = { ...draft, titleBlockDefinitions: [created] };
      }
      const defId = draft.titleBlockDefinitions[0]?.id as string;
      if (step === 'G') {
        draft = editTitleBlockTemplateElements(draft, defId, [
          { id: 'tb-el-1', kind: 'static-text', xMm: 5, yMm: 5, widthMm: 80, heightMm: 8, text: 'Harness Title', fontSizeMm: 3.5 },
          { id: 'tb-el-2', kind: 'token-text', xMm: 5, yMm: 14, widthMm: 80, heightMm: 8, tokenTemplate: '{SHEET_NAME} @ {SCALE}', fontSizeMm: 3 },
        ]);
        const count = draft.titleBlockDefinitions[0]?.elements?.length ?? 0;
        return { next: { ...s, doc: { ...s.doc, draft } }, entry: `G:tb-edit:elements:${count}` };
      }
      draft = duplicateTitleBlockTemplate(draft, defId);
      return { next: { ...s, doc: { ...s.doc, draft } }, entry: `H:tb-duplicate:templates:${draft.titleBlockDefinitions.length}` };
    }
    case 'I':
    case 'J': {
      const scene = buildExportSheetScene({
        draft: mustDraft(s.doc), sheetId: mustDraft(s.doc).sheets[0]?.id as string, project: s.doc.project,
      }).scene;
      if (step === 'I') {
        const svg = serializeExportSceneToSvg(scene);
        return { next: { ...s, exports: { ...s.exports, svg: svg.length } }, entry: `I:svg:${svg.length}-bytes` };
      }
      const pdf = exportScenesToPdf([scene]);
      return { next: { ...s, exports: { ...s.exports, pdf: pdf.length } }, entry: `J:pdf:${pdf.length}-bytes` };
    }
    case 'K': {
      const dxf = buildDxfModelSpaceText({ project: s.doc.project });
      return { next: { ...s, exports: { ...s.exports, r12: dxf.length } }, entry: `K:r12:${dxf.length}-bytes` };
    }
    case 'L': {
      const result = buildDxfLayoutText({ project: s.doc.project, draft: mustDraft(s.doc) });
      return {
        next: { ...s, exports: { ...s.exports, layout: result.dxf.length, layoutWarnings: result.warnings.length } },
        entry: `L:layout:${result.dxf.length}-bytes:layouts:${result.layouts.length}:warnings:${result.warnings.length}`,
      };
    }
    case 'M': {
      const preview = buildLandXmlImportPreview(LANDXML_13C_FIXTURE, { fileName: 'harness-13c.xml' });
      return {
        next: { ...s, preview },
        entry: `M:landxml:points:${preview.points.length}:warnings:${preview.warnings.length}:spirals:${preview.unsupported.spirals}`,
      };
    }
    case 'N': {
      if (!s.preview) return { next: s, entry: 'N:confirm:NO-PREVIEW' };
      const byId = new Map(s.preview.points.map((p) => [p.id, p]));
      const imported: CadEntity[] = [
        ...s.preview.points.map((p): CadEntity => ({
          type: 'survey-point', id: `pt-${p.id}`, layerId: 'points', visible: true, locked: false,
          stationId: p.id, x: p.x, y: p.y, pointClass: 'free', source: 'parsed-input',
        })),
        ...s.preview.lines.map((l, i): CadEntity => {
          const a = byId.get(l.from); const b = byId.get(l.to);
          return {
            type: 'line', id: `line-LX${i + 1}`, layerId: 'parcels', visible: true, locked: false,
            fromStationId: l.from, toStationId: l.to,
            fromX: a?.x ?? 0, fromY: a?.y ?? 0, toX: b?.x ?? 0, toY: b?.y ?? 0, sourceObservationIds: [],
          };
        }),
        ...(s.preview.parcels.length > 0 ? [{
          type: 'parcel', id: 'parcel-LX', layerId: 'parcels', visible: true, locked: false,
          vertices: (s.preview.parcels[0]?.ring ?? []).map((id) => ({ x: byId.get(id)?.x ?? 0, y: byId.get(id)?.y ?? 0 })),
          vertexLabels: [...(s.preview.parcels[0]?.ring ?? [])], parcelName: s.preview.parcels[0]?.name ?? 'LX',
        } as CadEntity] : []),
      ];
      const doc = { ...s.doc, project: { ...s.doc.project, entities: [...s.doc.project.entities, ...imported] } };
      return { next: { ...s, doc }, entry: `N:imported:+${imported.length}:entities:${doc.project.entities.length}` };
    }
    case 'O': {
      const saved = serializeCadDrawingFile(s.doc);
      return { next: { ...s, saved }, entry: `O:saved:${saved.length}-bytes` };
    }
    case 'P': {
      const saved = s.saved ?? serializeCadDrawingFile(s.doc);
      const parsed = parseCadDrawingFile(saved);
      if (!parsed.ok) return { next: s, entry: 'P:reload:FAILED' };
      return { next: { ...s, doc: parsed.drawing, saved }, entry: 'P:reloaded:ok' };
    }
    case 'Q': {
      const manual = s.labels.filter((l) => l.placement === 'MANUAL').length;
      const docLabels = mustDraft(s.doc).labels ?? [];
      const reloadedManual = docLabels.filter((l) => l.placement === 'MANUAL').length;
      const draftLabels = docLabels.length;
      const templates = mustDraft(s.doc).titleBlockDefinitions.length;
      const imported = s.doc.project.entities.filter((e) => e.id.startsWith('pt-LX') || e.id.startsWith('line-LX') || e.id === 'parcel-LX').length;
      const tableCount = mustDraft(s.doc).tables?.length ?? 0;
      return {
        next: s,
        entry: `Q:persist:manual:${manual}+doc:${reloadedManual}+draftLabels:${draftLabels}:templates:${templates}:imported:${imported}:tables:${tableCount}`,
      };
    }
    case 'R': {
      const match = adjustmentCoords(s.doc) === (s.adjustmentSnapshot ?? adjustmentCoords(s.doc));
      return { next: s, entry: `R:adjustment-unchanged:${match}` };
    }
    case 'S': {
      const sheets = mustDraft(s.doc).sheets.length;
      return {
        next: s,
        entry: `S:flow-complete:sheets:${sheets}:labels:${s.labels.length}:svg:${s.exports.svg}:pdf:${s.exports.pdf}:r12:${s.exports.r12}:layout:${s.exports.layout}`,
      };
    }
    default:
      return undefined;
  }
}
