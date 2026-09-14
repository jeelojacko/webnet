import { buildDxfExportModel } from '../engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../engine/cad/dxf/dxfSerializer';
import {
  buildExportSheetScene,
  buildNorthArrowItems,
  buildScaleBarItems,
  type ExportItem,
  type ModelLabelPlacement,
} from '../engine/cad/cadExportScene';
import { deriveCurveAutoText, deriveInverseAutoText, derivePointAutoText } from '../engine/cad/cadLabelEngine';
import { buildDraftPointTable } from '../engine/cad/cadDraftTables';
import {
  addSheetToDraft,
  addViewportToSheet,
  asPlanViewport,
  buildScaleBar,
  createPlanSheet,
  expandSheetTokens,
  northArrowAngleDeg,
  rotateViewport,
  setViewportScale,
  type TitleBlockInstance,
} from '../engine/cad/cadSheets';
import { serializeExportSceneToSvg } from '../engine/cad/cadSvgSerializer';
import { exportScenesToPdf } from '../engine/cad/cadPdfExport';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../engine/cad/cadDrawingFile';
import type { DraftDocument } from '../engine/cad/cadDraftTypes';
import type { CadDrawingDocument, CadEntity } from '../engine/cad/cadTypes';

export interface HarnessState {
  doc: CadDrawingDocument;
  labels: ModelLabelPlacement[];
  extras: ExportItem[];
  titleBlocks: TitleBlockInstance[];
  pointTableRows: string[][];
  exports: { svgLength: number; pdfLength: number; dxfLength: number };
  savedWncad?: string;
  modelCoordsSnapshot?: string;
  reloaded?: { sheets: number; sheetName: string; coordsMatch: boolean };
}

export const STEP_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'] as const;
export type HarnessStep = (typeof STEP_IDS)[number];

export const initialHarnessState = (): HarnessState => ({
  doc: createBlankCadDrawingDocument({ name: 'Harness Plan', units: 'm' }),
  labels: [],
  extras: [],
  titleBlocks: [],
  pointTableRows: [],
  exports: { svgLength: 0, pdfLength: 0, dxfLength: 0 },
});

// Original sample data only: 50m x 40m parcel + one tangent curve.
export const seedModel = (doc: CadDrawingDocument): CadDrawingDocument => {
  const corners = [
    { id: 'P1', x: 0, y: 0 },
    { id: 'P2', x: 50, y: 0 },
    { id: 'P3', x: 50, y: 40 },
    { id: 'P4', x: 0, y: 40 },
  ];
  const entities: CadEntity[] = [
    ...corners.map(
      (corner, index): CadEntity => ({
        type: 'survey-point',
        id: `pt-${corner.id}`,
        layerId: 'points',
        visible: true,
        locked: false,
        stationId: corner.id,
        x: corner.x,
        y: corner.y,
        pointClass: index < 2 ? 'control' : 'free',
        source: index < 2 ? 'adjustment-result' : 'parsed-input',
      }),
    ),
    {
      type: 'survey-point',
      id: 'pt-C1',
      layerId: 'points',
      visible: true,
      locked: false,
      stationId: 'C1',
      x: 80,
      y: 20,
      pointClass: 'free',
      source: 'parsed-input',
    },
    ...corners.map((corner, index): CadEntity => {
      const next = corners[(index + 1) % corners.length] as { id: string; x: number; y: number };
      return {
        type: 'line',
        id: `line-L${index + 1}`,
        layerId: 'parcels',
        visible: true,
        locked: false,
        fromStationId: corner.id,
        toStationId: next.id,
        fromX: corner.x,
        fromY: corner.y,
        toX: next.x,
        toY: next.y,
        sourceObservationIds: [],
      };
    }),
    {
      type: 'arc',
      id: 'arc-C1',
      layerId: 'parcels',
      visible: true,
      locked: false,
      centerX: 80,
      centerY: 20,
      radius: 30,
      startAngleDeg: 0,
      endAngleDeg: 60,
    },
    {
      type: 'parcel',
      id: 'parcel-A',
      layerId: 'parcels',
      visible: true,
      locked: false,
      vertices: corners.map((c) => ({ x: c.x, y: c.y })),
      vertexLabels: corners.map((c) => c.id),
      parcelName: 'Lot A',
    },
  ];
  return {
    ...doc,
    project: { ...doc.project, entities, bounds: { minX: 0, minY: 0, maxX: 110, maxY: 50 } },
  };
};

export const modelCoordsOf = (doc: CadDrawingDocument): string =>
  JSON.stringify(
    doc.project.entities.map((entity) => {
      if (entity.type === 'survey-point') return [entity.id, entity.x, entity.y];
      if (entity.type === 'line') return [entity.id, entity.fromX, entity.fromY, entity.toX, entity.toY];
      if (entity.type === 'arc') return [entity.id, entity.centerX, entity.centerY, entity.radius];
      if (entity.type === 'parcel') return [entity.id, entity.vertices];
      return [entity.id];
    }),
  );

export const mustDraft = (doc: CadDrawingDocument): DraftDocument => {
  if (!doc.draft) throw new Error('harness drawing has no draft');
  return doc.draft;
};

export interface AppliedStep {
  next: HarnessState;
  entry: string;
}

// Model + label derivation steps (A-D).
const applyModelStep = (s: HarnessState, step: HarnessStep): AppliedStep | undefined => {
  switch (step) {
    case 'A': {
      const doc = seedModel(s.doc);
      return { next: { ...s, doc, modelCoordsSnapshot: modelCoordsOf(doc) }, entry: 'A:model-seeded:8-entities' };
    }
    case 'B': {
      const doc = s.doc.project.entities.length === 0 ? seedModel(s.doc) : s.doc;
      const text = deriveInverseAutoText({ x: 0, y: 0 }, { x: 50, y: 0 }, 'bearing-distance');
      const labels: ModelLabelPlacement[] = [
        ...s.labels.filter((label) => label.id !== 'label-L1'),
        { id: 'label-L1', text, xModel: 25, yModel: 0, layerId: 'labels' },
      ];
      return {
        next: { ...s, doc, labels, modelCoordsSnapshot: s.modelCoordsSnapshot ?? modelCoordsOf(doc) },
        entry: `B:bearing-distance:${text}`,
      };
    }
    case 'C': {
      const points = s.doc.project.entities.filter((entity) => entity.type === 'survey-point');
      const labels: ModelLabelPlacement[] = [
        ...s.labels.filter((label) => !label.id.startsWith('label-pt-')),
        ...points.map((entity: CadEntity) => {
          const point = entity as { id: string; stationId: string; x: number; y: number };
          return {
            id: `label-pt-${point.stationId}`,
            text: `${point.stationId} ${derivePointAutoText({ x: point.x, y: point.y })}`,
            xModel: point.x,
            yModel: point.y,
            layerId: 'labels',
          } satisfies ModelLabelPlacement;
        }),
      ];
      return { next: { ...s, labels }, entry: `C:point-labels:${points.length}` };
    }
    case 'D': {
      const text = deriveCurveAutoText(30, 60);
      return {
        next: {
          ...s,
          labels: [...s.labels.filter((label) => label.id !== 'label-curve'), { id: 'label-curve', text, xModel: 80, yModel: 20, layerId: 'labels' }],
        },
        entry: `D:curve:${text}`,
      };
    }
    default:
      return undefined;
  }
};

// Sheet + viewport + annotation steps (E-K).
const applySheetStep = (s: HarnessState, step: HarnessStep): AppliedStep | undefined => {
  switch (step) {
    case 'E': {
      if (mustDraft(s.doc).sheets.length > 0) {
        return { next: s, entry: `E:sheet:${mustDraft(s.doc).sheets[0]?.name}` };
      }
      const doc: CadDrawingDocument = { ...s.doc, draft: addSheetToDraft(mustDraft(s.doc), createPlanSheet({ name: 'C1 - Plan', sizeId: 'ISO A4', orientation: 'landscape' })) };
      return { next: { ...s, doc }, entry: `E:sheet:${mustDraft(doc).sheets[0]?.name}:297x210` };
    }
    case 'F': {
      let doc = s.doc;
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
      return { next: { ...s, doc }, entry: 'F:viewport:1:500' };
    }
    case 'G': {
      const sheetId = mustDraft(s.doc).sheets[0]?.id as string;
      const viewportId = mustDraft(s.doc).sheets[0]?.viewports[0]?.id as string;
      const scaled = setViewportScale(mustDraft(s.doc), sheetId, viewportId, 500) ?? mustDraft(s.doc);
      const rotated = rotateViewport({ ...s.doc, draft: scaled }.draft, sheetId, viewportId, 15) ?? scaled;
      return { next: { ...s, doc: { ...s.doc, draft: rotated } }, entry: 'G:scale:1:500:rotate:15' };
    }
    case 'H': {
      const viewport = asPlanViewport(mustDraft(s.doc).sheets[0]?.viewports[0] as never);
      return { next: s, entry: `H:north:${northArrowAngleDeg(viewport.rotationDeg).toFixed(1)}:grid` };
    }
    case 'I': {
      const segments = buildScaleBar({ scaleDenominator: 500, divisions: 4, modelPerDivisionM: 10 });
      // Rotation-consistent arrow: same helper + viewport rotation the
      // export scene uses, so the arrow never detaches from the content.
      const rotation = asPlanViewport(mustDraft(s.doc).sheets[0]?.viewports[0] as never).rotationDeg;
      const extras: ExportItem[] = [
        ...s.extras.filter((item) => item.layer !== 'paper-symbols'),
        ...buildNorthArrowItems(270, 40, 12, 'paper-symbols', rotation),
        ...buildScaleBarItems(220, 175, 4, 10, 'paper-symbols'),
      ];
      return { next: { ...s, extras }, entry: `I:scalebar:${segments.length}x10m:${segments[0]?.paperLengthMm}mm` };
    }
    case 'J': {
      const sheetId = mustDraft(s.doc).sheets[0]?.id as string;
      const { text } = expandSheetTokens('{SHEET_NAME} @ {SCALE}', { SHEET_NAME: 'C1 - Plan', SCALE: '1:500' });
      const titleBlocks: TitleBlockInstance[] =
        s.titleBlocks.length > 0 ? s.titleBlocks : [{ id: 'tb-1', sheetId, definitionId: 'tb-def', values: { Title: '{SHEET_NAME} @ {SCALE}' } }];
      return { next: { ...s, titleBlocks }, entry: `J:titleblock:${text}` };
    }
    case 'K': {
      const entries = s.doc.project.entities
        .filter((entity) => entity.type === 'survey-point')
        .map((entity) => {
          const point = entity as { stationId: string; id: string; x: number; y: number };
          return { pointId: point.stationId, entityId: point.id, northing: point.y, easting: point.x };
        });
      const table = buildDraftPointTable(entries);
      return { next: { ...s, pointTableRows: table.rows }, entry: `K:point-table:${table.rows.length}-rows` };
    }
    default:
      return undefined;
  }
};

// Export + persistence verification steps (L-S).
const applyDeliverableStep = (s: HarnessState, step: HarnessStep): AppliedStep | undefined => {
  const sceneOf = (state: HarnessState): ReturnType<typeof buildExportSheetScene> =>
    buildExportSheetScene({
      draft: mustDraft(state.doc), sheetId: mustDraft(state.doc).sheets[0]?.id as string,
      project: state.doc.project, modelLabels: state.labels, paperExtras: state.extras,
    });
  switch (step) {
    case 'L': {
      const svg = serializeExportSceneToSvg(sceneOf(s).scene);
      return { next: { ...s, exports: { ...s.exports, svgLength: svg.length } }, entry: `L:svg:${svg.length}-bytes` };
    }
    case 'M': {
      const pdf = exportScenesToPdf([sceneOf(s).scene]);
      return { next: { ...s, exports: { ...s.exports, pdfLength: pdf.length } }, entry: `M:pdf:${pdf.length}-bytes` };
    }
    case 'N': {
      const dxf = serializeDxfModel(buildDxfExportModel({ project: s.doc.project, modelLabels: s.labels }));
      return { next: { ...s, exports: { ...s.exports, dxfLength: dxf.length } }, entry: `N:dxf:${dxf.length}-bytes` };
    }
    case 'O': {
      const savedWncad = serializeCadDrawingFile(s.doc);
      return { next: { ...s, savedWncad }, entry: `O:saved:${savedWncad.length}-bytes` };
    }
    case 'P': {
      const saved = s.savedWncad ?? serializeCadDrawingFile(s.doc);
      const parsed = parseCadDrawingFile(saved);
      if (!parsed.ok) return { next: s, entry: 'P:reload:FAILED' };
      return { next: { ...s, doc: parsed.drawing, savedWncad: saved }, entry: 'P:reloaded:v2' };
    }
    case 'Q': {
      const sheet = mustDraft(s.doc).sheets[0];
      const viewport = sheet?.viewports[0];
      return { next: s, entry: `Q:sheet-persists:${sheet?.name}:viewports:${sheet?.viewports.length}:scale:1:${viewport?.scaleDenominator}` };
    }
    case 'R': {
      const match = modelCoordsOf(s.doc) === (s.modelCoordsSnapshot ?? modelCoordsOf(s.doc));
      return {
        next: { ...s, reloaded: { sheets: mustDraft(s.doc).sheets.length, sheetName: mustDraft(s.doc).sheets[0]?.name ?? '', coordsMatch: match } },
        entry: `R:model-coords-unchanged:${match}`,
      };
    }
    case 'S': {
      const sheet = mustDraft(s.doc).sheets[0];
      return {
        next: s,
        entry: `S:flow-complete:sheets:${mustDraft(s.doc).sheets.length}:labels:${s.labels.length}:rows:${s.pointTableRows.length}:sheet:${sheet?.name ?? 'none'}`,
      };
    }
    default:
      return undefined;
  }
};

export const applyHarnessStep = (s: HarnessState, step: HarnessStep): AppliedStep | undefined =>
  applyModelStep(s, step) ?? applySheetStep(s, step) ?? applyDeliverableStep(s, step);
