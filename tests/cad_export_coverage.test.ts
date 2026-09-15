// Phase 13E §22: entity × format coverage matrix (tests side).
//
// Every CadEntity type + every drafting object × (SVG, PDF, R12, R2000,
// LandXML), classified FULL / APPROXIMATED / NOT_APPLICABLE /
// UNSUPPORTED_WITH_WARNING. Zero silent drops: every input entity id lands
// in exactly one of exported/omitted/approximated per format (or an
// adapted per-format check where the serializer has no id lists).
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import {
  buildDxfExportModelWithResult,
} from '../src/engine/cad/dxf/dxfExportModel';
import { buildDxfLayoutText } from '../src/engine/cad/dxf/dxfLayoutExport';
import {
  buildExportSheetSceneWithResult,
  buildNorthArrowItems,
  buildScaleBarItems,
  type ExportItem,
} from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { createTitleBlockTemplate } from '../src/engine/cad/cadSheets';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';

type Cell = 'FULL' | 'APPROXIMATED' | 'NOT_APPLICABLE' | 'UNSUPPORTED_WITH_WARNING';

const LAYER = 'cov-layer';

const buildCoverageProject = (): CadProject => {
  const project = createBlankCadProject({ name: 'Coverage matrix', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Coverage', color: '#123456', visible: true, locked: false, role: 'planning' }];
  const base = { layerId: LAYER, visible: true, locked: false } as const;
  const entities: CadEntity[] = [
    { ...base, id: 'cov-pt', type: 'survey-point', stationId: 'CP1', x: 5000, y: 1000, pointClass: 'control', source: 'parsed-input', description: 'cover point' },
    { ...base, id: 'cov-pt2', type: 'survey-point', stationId: 'CP2', x: 5020, y: 1010, pointClass: 'free', source: 'parsed-input' },
    { ...base, id: 'cov-line', type: 'line', fromStationId: 'CP1', toStationId: 'CP2', fromX: 5000, fromY: 1000, toX: 5020, toY: 1010, sourceObservationIds: [] },
    { ...base, id: 'cov-poly', type: 'polyline', vertices: [{ x: 5000, y: 1000 }, { x: 5010, y: 1005 }, { x: 5020, y: 1010 }], vertexLabels: ['CP1', 'V2', 'CP2'], closed: false },
    { ...base, id: 'cov-arc', type: 'arc', centerX: 5010, centerY: 1000, radius: 10, startAngleDeg: 0, endAngleDeg: 90 },
    { ...base, id: 'cov-align', type: 'alignment', name: 'AL1', startStation: 0, elements: [{ kind: 'line', start: { x: 5000, y: 1000 }, end: { x: 5020, y: 1010 } }] },
    { ...base, id: 'cov-polygon', type: 'polygon', vertices: [{ x: 5000, y: 1000 }, { x: 5020, y: 1000 }, { x: 5010, y: 1020 }], vertexLabels: ['CP1', 'CP2', 'V3'] },
    { ...base, id: 'cov-parcel', type: 'parcel', vertices: [{ x: 5000, y: 1000 }, { x: 5020, y: 1000 }, { x: 5020, y: 1020 }, { x: 5000, y: 1020 }], vertexLabels: ['CP1', 'CP2', 'V4', 'V5'], parcelName: 'LOT 1', areaSquareMeters: 400 },
    { ...base, id: 'cov-text', type: 'text', x: 5005, y: 1005, text: 'cover note' },
    { ...base, id: 'cov-ellipse', type: 'error-ellipse', stationId: 'CP1', centerX: 5000, centerY: 1000, semiMajor: 0.05, semiMinor: 0.02, thetaDeg: 30 },
  ];
  return { ...project, entities };
};

const ENTITY_IDS = ['cov-pt', 'cov-pt2', 'cov-line', 'cov-poly', 'cov-arc', 'cov-align', 'cov-polygon', 'cov-parcel', 'cov-text', 'cov-ellipse'];

const buildDraftWithObjects = (project: CadProject) => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  const template = createTitleBlockTemplate('Cover block');
  draft = { ...draft, titleBlockDefinitions: [{ ...template, id: 'tb-cover' }] };
  draft = addSheetToDraft(draft, { ...createPlanSheet({ name: 'Cover', sizeId: 'ISO A4', orientation: 'landscape' }), titleBlockId: 'tb-cover' });
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'Cover viewport', modelCenterX: 5010, modelCenterY: 1010,
    scaleDenominator: 500, paperXmm: 15, paperYmm: 15, paperWidthMm: 200, paperHeightMm: 130,
  });
  draft = {
    ...draft,
    labels: [
      { id: 'draft-pt-label', text: 'CP1 point label', xModel: 5000, yModel: 1000, layerId: LAYER, placement: 'MANUAL', leader: { enabled: true }, sourceEntityId: 'cov-pt' },
      { id: 'draft-bearing-label', text: 'B 45°00\'00"', xModel: 5010, yModel: 1005, layerId: LAYER, sourceEntityId: 'cov-line' },
      { id: 'draft-dist-label', text: 'D 28.28', xModel: 5010, yModel: 1006, layerId: LAYER, sourceEntityId: 'cov-line' },
      { id: 'draft-curve-label', text: 'R 10.00 L 15.71', xModel: 5010, yModel: 1000, layerId: LAYER, sourceEntityId: 'cov-arc' },
      { id: 'draft-area-label', text: 'A 400 m²', xModel: 5010, yModel: 1010, layerId: LAYER, sourceEntityId: 'cov-parcel' },
      { id: 'draft-free-text', text: 'free annotation', xModel: 5002, yModel: 1002, layerId: LAYER },
    ],
    tables: [{ id: 'tbl-cover', name: 'Cover table', headers: ['ID', 'E', 'N'], rows: [['CP1', '5000', '1000']], continueMode: 'MANUAL', headerRepeat: true, showContinuedMarker: false, maxRowsPerFragment: 25 }],
    tableFragments: [{ id: 'tbl-frag-1', logicalTableId: 'tbl-cover', sheetId, fragmentIndex: 0, rowRange: { start: 0, count: 1 }, paperXmm: 15, paperYmm: 160 }],
  };
  const paperExtras: ExportItem[] = [
    ...buildNorthArrowItems(270, 20, 12, 'north-arrow'),
    ...buildScaleBarItems(200, 185, 4, 10, 'scale-bar'),
  ];
  return { draft, sheetId, paperExtras };
};

/** Production CAD → LandXML adapter with per-entity disposition (no test-local mapper). */
const exportProjectToLandXml = (project: CadProject): { xml: string; warnings: { message: string; entityId?: string }[]; exported: string[]; omitted: string[]; approximated: string[] } => {
  const result = buildLandXmlProjectExportWithResult(project, { units: 'm', projectName: 'Coverage' });
  return {
    xml: result.output,
    warnings: result.warnings.map((warning) => ({ message: warning.message, entityId: warning.entityId })),
    exported: [...result.exportedEntityIds],
    omitted: [...result.omittedEntityIds],
    approximated: [...result.approximatedEntityIds],
  };
};

const assertPartition = (ids: readonly string[], exported: string[], omitted: string[], approximated: string[]): void => {
  // Engine contract (exportResult.ts): approximated is a SUBSET flag of
  // exported, not a disjoint bucket — an approximated entity appears in
  // BOTH lists. No-silent-drop therefore means: every id is in exported
  // XOR omitted, and every approximated id is also exported.
  // finalizeExportResult enforces this fail-closed (omitted wins).
  for (const id of ids) {
    const inExported = exported.includes(id);
    const inOmitted = omitted.includes(id);
    expect(inExported !== inOmitted, `entity ${id} must be exported XOR omitted`).toBe(true);
    if (approximated.includes(id)) expect(inExported, `approximated ${id} must also be exported`).toBe(true);
  }
};

describe('cad export coverage matrix (§22)', () => {
  it('classifies every entity for SVG/PDF with zero silent drops', () => {
    const project = buildCoverageProject();
    const { draft, sheetId, paperExtras } = buildDraftWithObjects(project);
    const scene = buildExportSheetSceneWithResult({ draft, sheetId, project, paperExtras });
    // SVG and PDF share the scene representation: one classification each.
    const svg = serializeExportSceneToSvgWithResult(scene.output);
    const pdf = exportScenesToPdfWithResult([scene.output]);
    const matrix: Record<string, Cell> = {
      'cov-pt': 'FULL', 'cov-pt2': 'FULL', 'cov-line': 'FULL', 'cov-poly': 'FULL',
      'cov-arc': 'FULL', 'cov-align': 'FULL', 'cov-polygon': 'FULL',
      'cov-parcel': 'FULL', 'cov-text': 'FULL', 'cov-ellipse': 'FULL',
    };
    for (const [id, cell] of Object.entries(matrix)) {
      expect(cell).toBe('FULL');
      expect(scene.output.items.some((item) => item.sourceEntityId === id), `${id} has scene geometry`).toBe(true);
      expect(scene.exportedEntityIds, id).toContain(id);
    }
    assertPartition(ENTITY_IDS, scene.exportedEntityIds, scene.omittedEntityIds, scene.approximatedEntityIds);
    // Serializers preserve the scene disposition (no extra drops on the hop).
    for (const id of ENTITY_IDS) expect(svg.exportedEntityIds).toContain(id);
    for (const id of ENTITY_IDS) expect(pdf.exportedEntityIds).toContain(id);
    // Drafting objects land in SVG/PDF: labels, table, title block, north arrow, scale bar.
    const svgText = svg.output;
    for (const marker of ['CP1 point label', 'B 45', 'D 28.28', 'R 10.00', 'free annotation', 'CP1', 'Cover']) {
      expect(svgText, `svg contains ${marker}`).toContain(marker);
    }
    expect(pdf.output.length).toBeGreaterThan(0);
    const pdfText = new TextDecoder().decode(pdf.output);
    expect(pdfText).toContain('CP1 point label');
  });

  it('classifies every entity for DXF R12 with zero silent drops', () => {
    const project = buildCoverageProject();
    const model = buildDxfExportModelWithResult({ project });
    const matrix: Record<string, Cell> = {
      'cov-pt': 'APPROXIMATED', 'cov-pt2': 'APPROXIMATED', 'cov-line': 'FULL',
      'cov-poly': 'FULL', 'cov-arc': 'FULL', 'cov-align': 'APPROXIMATED',
      'cov-polygon': 'APPROXIMATED', 'cov-parcel': 'APPROXIMATED',
      'cov-text': 'FULL', 'cov-ellipse': 'APPROXIMATED',
    };
    for (const [id, cell] of Object.entries(matrix)) {
      if (cell === 'FULL') {
        expect(model.exportedEntityIds, id).toContain(id);
        expect(model.approximatedEntityIds, id).not.toContain(id);
      } else {
        expect(model.exportedEntityIds, id).toContain(id);
        expect(model.approximatedEntityIds, id).toContain(id);
        expect(model.warnings.some((warning) => warning.entityId === id), `${id} warned`).toBe(true);
      }
    }
    assertPartition(ENTITY_IDS, model.exportedEntityIds, model.omittedEntityIds, model.approximatedEntityIds);
    // Every approximated id also appears in exported (approximation ≠ drop).
    for (const id of model.approximatedEntityIds) expect(model.exportedEntityIds).toContain(id);
  });

  it('covers model + paper in DXF R2000 with zero silent drops', () => {
    const project = buildCoverageProject();
    const { draft } = buildDraftWithObjects(project);
    const model = buildDxfExportModelWithResult({ project });
    assertPartition(ENTITY_IDS, model.exportedEntityIds, model.omittedEntityIds, model.approximatedEntityIds);
    const laid = buildDxfLayoutText({ project, draft });
    expect(laid.layouts).toContain('Cover');
    // Model survey coordinates survive in layout model space; paper objects ride layouts.
    expect(laid.dxf).toContain('5000');
    expect(laid.dxf).toContain(LAYER);
    expect(laid.dxf).toContain('Cover');
    // Paper deliverables are NOT_APPLICABLE to R12 model space but FULL in R2000 layouts.
    expect(laid.warnings.filter((warning) => warning.code === 'UNSUPPORTED_SHEET_OBJECT')).toHaveLength(0);
  });

  it('classifies every entity for LandXML with zero silent drops', () => {
    const project = buildCoverageProject();
    const exported = exportProjectToLandXml(project);
    const matrix: Record<string, Cell> = {
      'cov-pt': 'FULL', 'cov-pt2': 'FULL', 'cov-line': 'FULL', 'cov-poly': 'FULL',
      'cov-arc': 'APPROXIMATED', 'cov-align': 'FULL', 'cov-polygon': 'APPROXIMATED',
      'cov-parcel': 'APPROXIMATED', 'cov-text': 'UNSUPPORTED_WITH_WARNING', 'cov-ellipse': 'NOT_APPLICABLE',
    };
    for (const [id, cell] of Object.entries(matrix)) {
      if (cell === 'FULL') {
        expect(exported.exported, id).toContain(id);
        expect(exported.approximated, id).not.toContain(id);
      } else if (cell === 'APPROXIMATED') {
        expect(exported.exported, id).toContain(id);
        expect(exported.approximated, id).toContain(id);
        expect(exported.warnings.some((warning) => warning.entityId === id), `${id} warned`).toBe(true);
      } else {
        // UNSUPPORTED_WITH_WARNING → omitted + warning; NOT_APPLICABLE →
        // documented + warning, no geometry, no crash.
        expect(exported.omitted, id).toContain(id);
        expect(exported.warnings.some((warning) => warning.entityId === id), `${id} warned`).toBe(true);
        expect(exported.xml, `${id} contributes no geometry`).not.toContain(id);
      }
    }
    assertPartition(ENTITY_IDS, exported.exported, exported.omitted, exported.approximated);
    expect(exported.xml).toContain('CP1');
    expect(exported.xml).toContain('LOT 1');
  });

  it('never substitutes coordinates on duplicate station ids', () => {
    const project = createBlankCadProject({ name: 'Dup stations', units: 'm' });
    project.layers = [{ id: LAYER, name: 'Coverage', color: '#123456', visible: true, locked: false, role: 'planning' }];
    const base = { layerId: LAYER, visible: true, locked: false } as const;
    const entities: CadEntity[] = [
      { ...base, id: 'dup-a', type: 'survey-point', stationId: 'D1', x: 100, y: 200, pointClass: 'free', source: 'parsed-input' },
      { ...base, id: 'dup-b', type: 'survey-point', stationId: 'D1', x: 100, y: 200, pointClass: 'free', source: 'parsed-input' },
      { ...base, id: 'dup-c', type: 'survey-point', stationId: 'D1', x: 999, y: 888, pointClass: 'free', source: 'parsed-input' },
      { ...base, id: 'dup-line', type: 'line', fromStationId: 'D1', toStationId: 'D2', fromX: 500, fromY: 600, toX: 700, toY: 800, sourceObservationIds: [] },
    ];
    const result = buildLandXmlProjectExportWithResult({ ...project, entities }, { units: 'm', projectName: 'Dup' });
    // Same-coords duplicate shares the station: both exported, one CgPoint.
    expect(result.exportedEntityIds).toContain('dup-a');
    expect(result.exportedEntityIds).toContain('dup-b');
    // Conflicting duplicate is omitted + warned — never another point's coords.
    expect(result.omittedEntityIds).toContain('dup-c');
    expect(result.exportedEntityIds).not.toContain('dup-c');
    expect(result.warnings.some((warning) => warning.entityId === 'dup-c' && warning.message.includes('conflicts'))).toBe(true);
    expect(result.output).toContain('200.000000 100.000000');
    expect(result.output).not.toContain('888.000000 999.000000');
    // Colliding line endpoint keeps its ACTUAL coordinates via a synthetic
    // ref (exact geometry, renamed reference) + warning; still exported.
    expect(result.exportedEntityIds).toContain('dup-line');
    expect(result.omittedEntityIds).not.toContain('dup-line');
    expect(result.warnings.some((warning) => warning.entityId === 'dup-line' && warning.message.includes('synthetic'))).toBe(true);
    expect(result.output).toContain('pntRef="D1~2"');
    expect(result.output).toContain('600.000000 500.000000');
    expect(result.output).toContain('800.000000 700.000000');
    assertPartition(['dup-a', 'dup-b', 'dup-c', 'dup-line'], result.exportedEntityIds, result.omittedEntityIds, result.approximatedEntityIds);
  });

  it('documents paper drafting objects as NOT_APPLICABLE outside sheet formats', () => {
    const project = buildCoverageProject();
    const { draft, sheetId, paperExtras } = buildDraftWithObjects(project);
    // R12 model space deliberately excludes paper (documented, no crash).
    const model = buildDxfExportModelWithResult({ project });
    const modelText = JSON.stringify(model.output);
    expect(modelText).not.toContain('draft-pt-label');
    // Sheet formats carry them: scene items include table + title + extras.
    const scene = buildExportSheetSceneWithResult({ draft, sheetId, project, paperExtras });
    const svg = serializeExportSceneToSvgWithResult(scene.output).output;
    expect(svg).toContain('layer-paper-frame');
    expect(svg).toContain('Cover table');
  });
});
