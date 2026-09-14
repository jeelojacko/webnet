import { createBlankDraftDocument, type DraftDocument } from '../../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../../src/engine/cad/cadSheets';
import { buildNorthArrowItems, buildScaleBarItems, type ExportItem, type ModelLabelPlacement } from '../../src/engine/cad/cadExportScene';
import { deriveInverseAutoText, deriveParcelAreaAutoText } from '../../src/engine/cad/cadLabelEngine';
import type { CadProject } from '../../src/engine/cad/cadTypes';

// ~50m square parcel fixture shared by the SVG/PDF/DXF golden tests.
export interface SmallParcelFixture {
  draft: DraftDocument;
  sheetId: string;
  project: CadProject;
  modelLabels: ModelLabelPlacement[];
  paperExtras: ExportItem[];
}

const layer = (id: string, name: string, role: 'points' | 'parcels' | 'labels' | 'planning') => ({
  id, name, color: '#ffffff', visible: true, locked: false, role,
});

export const buildSmallParcelFixture = (): SmallParcelFixture => {
  // 50m x 40m parcel: P1(0,0) P2(50,0) P3(50,40) P4(0,40).
  const corners = [
    { id: 'P1', x: 0, y: 0 },
    { id: 'P2', x: 50, y: 0 },
    { id: 'P3', x: 50, y: 40 },
    { id: 'P4', x: 0, y: 40 },
  ];
  const project: CadProject = {
    version: 2,
    id: 'project-small-parcel',
    name: 'Small Parcel',
    metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 4, observationCount: 0, adjustedStationCount: 0 },
    layers: [layer('points', 'Points', 'points'), layer('parcels', 'Parcels', 'parcels')],
    styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
    entities: [
      ...corners.map((corner) => ({
        type: 'survey-point' as const,
        id: `pt-${corner.id}`,
        layerId: 'points',
        visible: true,
        locked: false,
        stationId: corner.id,
        x: corner.x,
        y: corner.y,
        pointClass: 'free' as const,
        source: 'parsed-input' as const,
      })),
      ...corners.map((corner, index) => {
        const next = corners[(index + 1) % corners.length] as { id: string; x: number; y: number };
        return {
          type: 'line' as const,
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
          sourceObservationIds: [] as number[],
        };
      }),
      {
        type: 'parcel' as const,
        id: 'parcel-A',
        layerId: 'parcels',
        visible: true,
        locked: false,
        vertices: corners.map((c) => ({ x: c.x, y: c.y })),
        vertexLabels: corners.map((c) => c.id),
        parcelName: 'Lot A',
      },
    ],
    cogoComputations: [],
    bounds: { minX: 0, minY: 0, maxX: 50, maxY: 40 },
  };

  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'C1 - Parcel', sizeId: 'ISO A4', orientation: 'landscape' }));
  // Pinned ids: clip ids derive from the viewport id, so the byte-identical
  // SVG golden needs deterministic ids (runtime ids are random per build).
  const sheet = draft.sheets[0] as { id: string };
  sheet.id = 'sheet-small-parcel';
  const sheetId = sheet.id;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'Parcel viewport',
    modelCenterX: 25,
    modelCenterY: 20,
    scaleDenominator: 500,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 200,
    paperHeightMm: 130,
  });
  const goldenViewport = draft.sheets[0]?.viewports[0] as { id: string };
  goldenViewport.id = 'viewport-small-parcel';

  const modelLabels: ModelLabelPlacement[] = corners.flatMap((corner, index) => {
    const next = corners[(index + 1) % corners.length] as { id: string; x: number; y: number };
    return [
      {
        id: `label-L${index + 1}`,
        text: deriveInverseAutoText({ x: corner.x, y: corner.y }, { x: next.x, y: next.y }, 'bearing-distance'),
        xModel: (corner.x + next.x) / 2,
        yModel: (corner.y + next.y) / 2,
        layerId: 'labels',
      },
    ];
  });
  modelLabels.push({
    id: 'label-area',
    text: deriveParcelAreaAutoText(corners.map((c) => ({ x: c.x, y: c.y }))),
    xModel: 25,
    yModel: 20,
    layerId: 'labels',
  });

  const paperExtras: ExportItem[] = [
    ...buildNorthArrowItems(270, 40, 12, 'paper-symbols', 0),
    ...buildScaleBarItems(220, 175, 4, 10, 'paper-symbols'),
  ];

  return { draft, sheetId, project, modelLabels, paperExtras };
};
