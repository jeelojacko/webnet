import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { SurveyDraftingResults } from './surveyDraftingResults';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../engine/cad/cadDrawingFile';
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
import type { DraftDocument } from '../engine/cad/cadDraftTypes';
import type { CadDrawingDocument, CadEntity } from '../engine/cad/cadTypes';

type HarnessGlobal = typeof globalThis & {
  __SURVEY_DRAFTING_HARNESS__?: {
    getSavedWncad: () => string | undefined;
    getModelCoords: () => string;
    getExports: () => { svgLength: number; pdfLength: number; dxfLength: number };
  };
};

interface HarnessState {
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

// Original sample data only: 50m x 40m parcel + one tangent curve.
const seedModel = (doc: CadDrawingDocument): CadDrawingDocument => {
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

const modelCoordsOf = (doc: CadDrawingDocument): string =>
  JSON.stringify(
    doc.project.entities.map((entity) => {
      if (entity.type === 'survey-point') return [entity.id, entity.x, entity.y];
      if (entity.type === 'line') return [entity.id, entity.fromX, entity.fromY, entity.toX, entity.toY];
      if (entity.type === 'arc') return [entity.id, entity.centerX, entity.centerY, entity.radius];
      if (entity.type === 'parcel') return [entity.id, entity.vertices];
      return [entity.id];
    }),
  );

const mustDraft = (doc: CadDrawingDocument): DraftDocument => {
  if (!doc.draft) throw new Error('harness drawing has no draft');
  return doc.draft;
};

const initialState = (): HarnessState => ({
  doc: createBlankCadDrawingDocument({ name: 'Harness Plan', units: 'm' }),
  labels: [],
  extras: [],
  titleBlocks: [],
  pointTableRows: [],
  exports: { svgLength: 0, pdfLength: 0, dxfLength: 0 },
});

const STEP_IDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S'] as const;

export const SurveyDraftingApp = (): React.JSX.Element => {
  const [state, setState] = useState<HarnessState>(initialState);
  const [log, setLog] = useState<string[]>([]);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const commit = (next: HarnessState, entry: string): void => {
    setState(next);
    setLog((current) => [...current, entry]);
  };

  const runStep = (step: (typeof STEP_IDS)[number]): void => {
    const s = stateRef.current;
    switch (step) {
      case 'A': {
        const doc = seedModel(s.doc);
        commit({ ...s, doc, modelCoordsSnapshot: modelCoordsOf(doc) }, 'A:model-seeded:8-entities');
        break;
      }
      case 'B': {
        const doc = s.doc.project.entities.length === 0 ? seedModel(s.doc) : s.doc;
        const text = deriveInverseAutoText({ x: 0, y: 0 }, { x: 50, y: 0 }, 'bearing-distance');
        const labels: ModelLabelPlacement[] = [
          ...s.labels.filter((label) => label.id !== 'label-L1'),
          { id: 'label-L1', text, xModel: 25, yModel: 0, layerId: 'labels' },
        ];
        commit({ ...s, doc, labels, modelCoordsSnapshot: s.modelCoordsSnapshot ?? modelCoordsOf(doc) }, `B:bearing-distance:${text}`);
        break;
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
        commit({ ...s, labels }, `C:point-labels:${points.length}`);
        break;
      }
      case 'D': {
        const text = deriveCurveAutoText(30, 60);
        commit(
          { ...s, labels: [...s.labels.filter((label) => label.id !== 'label-curve'), { id: 'label-curve', text, xModel: 80, yModel: 20, layerId: 'labels' }] },
          `D:curve:${text}`,
        );
        break;
      }
      case 'E': {
        if (mustDraft(s.doc).sheets.length > 0) {
          commit(s, `E:sheet:${mustDraft(s.doc).sheets[0]?.name}`);
          break;
        }
        const doc: CadDrawingDocument = { ...s.doc, draft: addSheetToDraft(mustDraft(s.doc), createPlanSheet({ name: 'C1 - Plan', sizeId: 'ISO A4', orientation: 'landscape' })) };
        commit({ ...s, doc }, `E:sheet:${mustDraft(doc).sheets[0]?.name}:297x210`);
        break;
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
        commit({ ...s, doc }, 'F:viewport:1:500');
        break;
      }
      case 'G': {
        const sheetId = mustDraft(s.doc).sheets[0]?.id as string;
        const viewportId = mustDraft(s.doc).sheets[0]?.viewports[0]?.id as string;
        const scaled = setViewportScale(mustDraft(s.doc), sheetId, viewportId, 500) ?? mustDraft(s.doc);
        const rotated = rotateViewport({ ...s.doc, draft: scaled }.draft, sheetId, viewportId, 15) ?? scaled;
        commit({ ...s, doc: { ...s.doc, draft: rotated } }, 'G:scale:1:500:rotate:15');
        break;
      }
      case 'H': {
        const viewport = asPlanViewport(mustDraft(s.doc).sheets[0]?.viewports[0] as never);
        commit(s, `H:north:${northArrowAngleDeg(viewport.rotationDeg).toFixed(1)}:grid`);
        break;
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
        commit({ ...s, extras }, `I:scalebar:${segments.length}x10m:${segments[0]?.paperLengthMm}mm`);
        break;
      }
      case 'J': {
        const sheetId = mustDraft(s.doc).sheets[0]?.id as string;
        const { text } = expandSheetTokens('{SHEET_NAME} @ {SCALE}', { SHEET_NAME: 'C1 - Plan', SCALE: '1:500' });
        const titleBlocks: TitleBlockInstance[] =
          s.titleBlocks.length > 0 ? s.titleBlocks : [{ id: 'tb-1', sheetId, definitionId: 'tb-def', values: { Title: '{SHEET_NAME} @ {SCALE}' } }];
        commit({ ...s, titleBlocks }, `J:titleblock:${text}`);
        break;
      }
      case 'K': {
        const entries = s.doc.project.entities
          .filter((entity) => entity.type === 'survey-point')
          .map((entity) => {
            const point = entity as { stationId: string; id: string; x: number; y: number };
            return { pointId: point.stationId, entityId: point.id, northing: point.y, easting: point.x };
          });
        const table = buildDraftPointTable(entries);
        commit({ ...s, pointTableRows: table.rows }, `K:point-table:${table.rows.length}-rows`);
        break;
      }
      case 'L': {
        const { scene } = buildExportSheetScene({
          draft: mustDraft(s.doc), sheetId: mustDraft(s.doc).sheets[0]?.id as string,
          project: s.doc.project, modelLabels: s.labels, paperExtras: s.extras,
        });
        const svg = serializeExportSceneToSvg(scene);
        commit({ ...s, exports: { ...s.exports, svgLength: svg.length } }, `L:svg:${svg.length}-bytes`);
        break;
      }
      case 'M': {
        const { scene } = buildExportSheetScene({
          draft: mustDraft(s.doc), sheetId: mustDraft(s.doc).sheets[0]?.id as string,
          project: s.doc.project, modelLabels: s.labels, paperExtras: s.extras,
        });
        const pdf = exportScenesToPdf([scene]);
        commit({ ...s, exports: { ...s.exports, pdfLength: pdf.length } }, `M:pdf:${pdf.length}-bytes`);
        break;
      }
      case 'N': {
        const dxf = serializeDxfModel(buildDxfExportModel({ project: s.doc.project, modelLabels: s.labels }));
        commit({ ...s, exports: { ...s.exports, dxfLength: dxf.length } }, `N:dxf:${dxf.length}-bytes`);
        break;
      }
      case 'O': {
        const savedWncad = serializeCadDrawingFile(s.doc);
        commit({ ...s, savedWncad }, `O:saved:${savedWncad.length}-bytes`);
        break;
      }
      case 'P': {
        const saved = s.savedWncad ?? serializeCadDrawingFile(s.doc);
        const parsed = parseCadDrawingFile(saved);
        if (!parsed.ok) {
          commit(s, 'P:reload:FAILED');
          break;
        }
        commit({ ...s, doc: parsed.drawing, savedWncad: saved }, 'P:reloaded:v2');
        break;
      }
      case 'Q': {
        const sheet = mustDraft(s.doc).sheets[0];
        const viewport = sheet?.viewports[0];
        commit(s, `Q:sheet-persists:${sheet?.name}:viewports:${sheet?.viewports.length}:scale:1:${viewport?.scaleDenominator}`);
        break;
      }
      case 'R': {
        const match = modelCoordsOf(s.doc) === (s.modelCoordsSnapshot ?? modelCoordsOf(s.doc));
        commit({ ...s, reloaded: { sheets: mustDraft(s.doc).sheets.length, sheetName: mustDraft(s.doc).sheets[0]?.name ?? '', coordsMatch: match } }, `R:model-coords-unchanged:${match}`);
        break;
      }
      case 'S': {
        const sheet = mustDraft(s.doc).sheets[0];
        commit(s, `S:flow-complete:sheets:${mustDraft(s.doc).sheets.length}:labels:${s.labels.length}:rows:${s.pointTableRows.length}:sheet:${sheet?.name ?? 'none'}`);
        break;
      }
    }
  };

  const harness = useMemo<HarnessGlobal['__SURVEY_DRAFTING_HARNESS__']>(
    () => ({
      getSavedWncad: () => stateRef.current.savedWncad,
      getModelCoords: () => modelCoordsOf(stateRef.current.doc),
      getExports: () => stateRef.current.exports,
    }),
    [],
  );
  useEffect(() => {
    (globalThis as HarnessGlobal).__SURVEY_DRAFTING_HARNESS__ = harness;
  }, [harness]);

  const sheet = mustDraft(state.doc).sheets[0];
  const viewport = sheet?.viewports[0];
  const reloadDrawing = (doc: CadDrawingDocument): void => {
    commit({ ...stateRef.current, doc }, 'file:reloaded:via-input');
  };
  const noteReloadFailed = (): void => {
    setLog((current) => [...current, 'file:reload:FAILED']);
  };

  return (
    <main style={{ padding: 16, fontFamily: 'sans-serif' }}>
      <h1>Survey drafting harness</h1>
      <p data-testid="draft-harness-ready">ready</p>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {STEP_IDS.map((step) => (
          <button key={step} type="button" data-testid={`draft-step-${step}`} onClick={() => runStep(step)}>
            {`Step ${step}`}
          </button>
        ))}
      </div>
      <ol data-testid="draft-flow-log">
        {log.map((entry, index) => (
          <li key={`${index}-${entry}`} data-step={entry.slice(0, 1)}>{entry}</li>
        ))}
      </ol>
      <div data-testid="draft-model-count">{`entities:${state.doc.project.entities.length}`}</div>
      <div data-testid="draft-sheet-info">
        {sheet ? `sheet:${sheet.name}:${sheet.widthMm}x${sheet.heightMm}:viewports:${sheet.viewports.length}` : 'sheet:none'}
      </div>
      <div data-testid="draft-viewport-info">
        {viewport ? `scale:1:${viewport.scaleDenominator}:rotation:${(asPlanViewport(viewport).rotationDeg ?? 0)}:north:${northArrowAngleDeg(asPlanViewport(viewport).rotationDeg ?? 0).toFixed(1)}` : 'viewport:none'}
      </div>
      <div data-testid="draft-table-info">{`table-rows:${state.pointTableRows.length}`}</div>
      <div data-testid="draft-export-info">
        {`svg:${state.exports.svgLength}:pdf:${state.exports.pdfLength}:dxf:${state.exports.dxfLength}`}
      </div>
      {state.reloaded ? <div data-testid="draft-reload-info">{`reload:sheets:${state.reloaded.sheets}:coordsMatch:${state.reloaded.coordsMatch}`}</div> : null}
      <SurveyDraftingResults
        doc={state.doc}
        draft={mustDraft(state.doc)}
        titleBlocks={state.titleBlocks}
        pointTableRows={state.pointTableRows}
        onReload={reloadDrawing}
        onReloadFailed={noteReloadFailed}
      />
    </main>
  );
};

createRoot(document.getElementById('root') as HTMLElement).render(<SurveyDraftingApp />);
