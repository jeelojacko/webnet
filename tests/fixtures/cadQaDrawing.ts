// Phase 18C visual-QA + export-comparison fixture (deterministic).
//
// One drawing exercising every 18C layer semantic: 9 layers (colors,
// continuous/dashed/center/dotted, 4 lineweights, transparency, locked,
// no-plot, OFF, frozen), explicit + ByLayer entities, text, parcel, point,
// ellipse. Screenshots and export goldens build from this single source.
import { createBlankDraftDocument } from '../../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../../src/engine/cad/cadSheets';
import type { CadEntity, CadLayer, CadProject } from '../../src/engine/cad/cadTypes';

export const QA_LAYER_IDS = [
  'qa-red',
  'qa-green-dashed',
  'qa-center-heavy',
  'qa-dotted-thin',
  'qa-transparent',
  'qa-locked',
  'qa-noplot',
  'qa-off',
  'qa-frozen',
] as const;

const layer = (entry: CadLayer): CadLayer => entry;

export const buildCadQaProject = (): CadProject => {
  const layers: CadLayer[] = [
    layer({ id: 'qa-red', name: 'QA Red', color: '#ff0000', lineTypeId: 'continuous', visible: true, locked: false, printable: true, lineweightMm: 0.25, role: 'observation-lines' }),
    layer({ id: 'qa-green-dashed', name: 'QA Green Dashed', color: '#22c55e', lineTypeId: 'dashed', visible: true, locked: false, printable: true, lineweightMm: 0.5, role: 'observation-lines' }),
    layer({ id: 'qa-center-heavy', name: 'QA Center Heavy', color: '#38bdf8', lineTypeId: 'center', visible: true, locked: false, printable: true, lineweightMm: 1.0, role: 'parcels' }),
    layer({ id: 'qa-dotted-thin', name: 'QA Dotted Thin', color: '#f59e0b', lineTypeId: 'dotted', visible: true, locked: false, printable: true, lineweightMm: 0.13, role: 'error-ellipses' }),
    layer({ id: 'qa-transparent', name: 'QA Transparent', color: '#a78bfa', lineTypeId: 'continuous', visible: true, locked: false, printable: true, lineweightMm: 0.25, transparency: 0.5, role: 'planning' }),
    layer({ id: 'qa-locked', name: 'QA Locked', color: '#e2e8f0', lineTypeId: 'continuous', visible: true, locked: true, printable: true, lineweightMm: 0.25, role: 'planning' }),
    layer({ id: 'qa-noplot', name: 'QA NoPlot', color: '#f472b6', lineTypeId: 'continuous', visible: true, locked: false, printable: false, lineweightMm: 0.25, role: 'planning' }),
    layer({ id: 'qa-off', name: 'QA Off', color: '#94a3b8', lineTypeId: 'continuous', visible: false, locked: false, printable: true, lineweightMm: 0.25, role: 'planning' }),
    layer({ id: 'qa-frozen', name: 'QA Frozen', color: '#94a3b8', lineTypeId: 'continuous', visible: true, locked: false, frozen: true, printable: true, lineweightMm: 0.25, role: 'planning' }),
  ];
  const entities: CadEntity[] = [
    {
      type: 'line', id: 'qa-bylayer', layerId: 'qa-red', visible: true, locked: false,
      fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: 0, toX: 100, toY: 0,
      sourceObservationIds: [],
    },
    {
      type: 'line', id: 'qa-explicit', layerId: 'qa-red', visible: true, locked: false,
      fromStationId: 'B', toStationId: 'C', fromX: 100, fromY: 0, toX: 100, toY: 60,
      sourceObservationIds: [],
      appearance: { color: '#0000ff', lineTypeId: 'center', lineweightMm: 0.7, transparency: 0.25 },
    },
    {
      type: 'survey-point', id: 'qa-pt-1', layerId: 'qa-green-dashed', visible: true, locked: false,
      stationId: 'QA1', x: 10, y: 10, pointClass: 'free', source: 'parsed-input',
    },
    {
      type: 'text', id: 'qa-text-1', layerId: 'qa-red', visible: true, locked: false,
      x: 50, y: 50, text: 'QA text',
    },
    {
      type: 'text', id: 'qa-text-hidden', layerId: 'qa-red', visible: false, locked: false,
      x: 60, y: 60, text: 'hidden text',
    },
    {
      type: 'parcel', id: 'qa-parcel-1', layerId: 'qa-center-heavy', visible: true, locked: false,
      vertices: [{ x: 10, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 50 }, { x: 10, y: 50 }],
      vertexLabels: ['P1', 'P2', 'P3', 'P4'], parcelName: 'QA LOT',
    },
    {
      type: 'error-ellipse', id: 'qa-ellipse-1', layerId: 'qa-dotted-thin', visible: true, locked: false,
      stationId: 'QA1', centerX: 70, centerY: 30, semiMajor: 4, semiMinor: 2, thetaDeg: 15,
    },
    {
      type: 'polyline', id: 'qa-poly-1', layerId: 'qa-transparent', visible: true, locked: false,
      vertices: [{ x: 0, y: 70 }, { x: 30, y: 90 }, { x: 60, y: 70 }],
      vertexLabels: [], closed: false,
    },
    {
      type: 'arc', id: 'qa-arc-1', layerId: 'qa-locked', visible: true, locked: false,
      centerX: 80, centerY: 80, radius: 10, startAngleDeg: 0, endAngleDeg: 180,
    },
    {
      type: 'line', id: 'qa-noplot-line', layerId: 'qa-noplot', visible: true, locked: false,
      fromStationId: 'X', toStationId: 'Y', fromX: 0, fromY: 95, toX: 100, toY: 95,
      sourceObservationIds: [],
    },
    {
      type: 'line', id: 'qa-off-line', layerId: 'qa-off', visible: true, locked: false,
      fromStationId: 'X', toStationId: 'Y', fromX: 0, fromY: 5, toX: 100, toY: 5,
      sourceObservationIds: [],
    },
    {
      type: 'line', id: 'qa-frozen-line', layerId: 'qa-frozen', visible: true, locked: false,
      fromStationId: 'X', toStationId: 'Y', fromX: 0, fromY: 15, toX: 100, toY: 15,
      sourceObservationIds: [],
    },
  ];
  return {
    version: 2,
    id: 'project-cad-qa',
    name: 'CAD QA',
    metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 1, observationCount: 0, adjustedStationCount: 0 },
    layers,
    styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
    entities,
    cogoComputations: [],
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    currentLayerId: 'qa-red',
    linetypeScale: 1.0,
  };
};

export const buildCadQaDraft = (project: CadProject): { draft: ReturnType<typeof createBlankDraftDocument>; sheetId: string } => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'QA Sheet', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheet = draft.sheets[0] as { id: string };
  sheet.id = 'sheet-cad-qa';
  draft = addViewportToSheet(draft, sheet.id, {
    name: 'QA viewport',
    modelCenterX: 50,
    modelCenterY: 50,
    scaleDenominator: 1000,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 200,
    paperHeightMm: 130,
  });
  const viewport = draft.sheets[0]?.viewports[0] as { id: string };
  viewport.id = 'viewport-cad-qa';
  return { draft, sheetId: sheet.id };
};
