// Phase 19A slice D acceptance — survey-plan tables, export disposition,
// and PARCELDESC/LEGALDESC drafting.
import { describe, expect, it } from 'vitest';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import type { CadEntity, CadParcelEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CadSurveyTableEntity, CadLineEntity } from '../src/engine/cad/cadTypes';
import { DEFAULT_CAD_SURVEY_TABLE_STYLE_ID } from '../src/engine/cad/cadSurveyTables';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildExportCenterPreview } from '../src/engine/cad/exportCenter';
import {
  addCadSurveyTableToDraft,
  cadSurveyTableToCogoReportTable,
  collectCadSurveyTablesForExport,
  deriveCadSurveyTableFromSource,
  formatCadSurveyTableCsv,
  resolveCadParcelCourses,
  CAD_SURVEY_TABLE_DXF_DISPOSITION,
  CAD_SURVEY_TABLE_LANDXML_DISPOSITION,
  type CadSurveyTable,
} from '../src/engine/cad/cadSurveyExportTables';
import {
  buildCadParcelLegalDescription,
  buildCadParcelLegalDescriptionMtextSnapshot,
  reverseCadParcelCourses,
} from '../src/engine/cad/cadParcelLegalDescription';
import { buildCadInverseSummary, formatCadBearing } from '../src/engine/cad/cadCogoSummaries';
import { cadBuildCurveMetricsSummaryFromRadiusDelta } from '../src/engine/cad/cadCogoCurveMetrics';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import { buildDxfLayoutTextWithResult } from '../src/engine/cad/dxf/dxfLayoutExport';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';

const LAYER = 'tables-layer';

const baseProject = (): CadProject => {
  const project = createBlankCadProject({ name: '19A tables', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Survey', color: '#112233', visible: true, locked: false, role: 'planning' }];
  return project;
};

const base = { layerId: LAYER, visible: true, locked: false } as const;

const squareParcel = (name: string, x0: number, y0: number, size = 100): CadParcelEntity => ({
  ...base,
  id: `parcel-${name}`,
  type: 'parcel',
  parcelName: name,
  vertices: [
    { x: x0, y: y0 },
    { x: x0 + size, y: y0 },
    { x: x0 + size, y: y0 + size },
    { x: x0, y: y0 + size },
  ],
  vertexLabels: [`${name}-A`, `${name}-B`, `${name}-C`, `${name}-D`],
});

describe('19A survey table derivation', () => {
  it('line 0,0→3,4 is distance 5 and matches the authoritative formatter', () => {
    const table = deriveCadSurveyTableFromSource(
      {
        kind: 'line',
        legs: [{ lineId: 'L1', fromId: 'P1', toId: 'P2', from: { x: 0, y: 0 }, to: { x: 3, y: 4 } }],
      },
      baseProject(),
    );
    expect(table.rows).toHaveLength(1);
    const [lineId, fromId, toId, bearing, distance] = table.rows[0]!.cells;
    expect(lineId).toBe('L1');
    expect(fromId).toBe('P1');
    expect(toId).toBe('P2');
    expect(distance).toBe('5.000');
    const inverse = buildCadInverseSummary({ x: 0, y: 0 }, { x: 3, y: 4 });
    expect(distance).toBe(inverse.distance.toFixed(3));
    expect(bearing).toBe(formatCadBearing(inverse.azimuthDeg));
    expect(bearing).toBe(inverse.bearing);
    expect(table.tagAnchors).toEqual([{ tag: 'L1', kind: 'line', point: { x: 1.5, y: 2 } }]);
  });

  it('curve R=100 Δ=90 arc/chord match the curve helper', () => {
    const table = deriveCadSurveyTableFromSource(
      { kind: 'curve', curves: [{ curveId: 'C1', radius: 100, deltaDeg: 90, anchor: { x: 10, y: 20 } }] },
      baseProject(),
    );
    const helper = cadBuildCurveMetricsSummaryFromRadiusDelta(100, 90);
    expect(helper).not.toBeNull();
    const [, radius, , arc, chord] = table.rows[0]!.cells;
    expect(radius).toBe((helper as { radius: number }).radius.toFixed(3));
    expect(arc).toBe(helper!.arcLength.toFixed(3));
    expect(chord).toBe(helper!.chordLength.toFixed(3));
    expect(table.tagAnchors).toEqual([{ tag: 'C1', kind: 'curve', point: { x: 10, y: 20 } }]);
  });

  it('point table leaves undefined elevation blank (never 0)', () => {
    const table = deriveCadSurveyTableFromSource(
      {
        kind: 'point',
        entries: [
          { pointId: 'P1', northing: 1000, easting: 500, elevation: undefined, description: 'no z' },
          { pointId: 'P2', northing: 1001, easting: 501, elevation: 12.5, description: 'has z' },
        ],
      },
      baseProject(),
    );
    const p1 = table.rows.find((row) => row.cells[0] === 'P1')!;
    const p2 = table.rows.find((row) => row.cells[0] === 'P2')!;
    expect(p1.cells[3]).toBe('');
    expect(p1.cells[3]).not.toBe('0');
    expect(p1.status).toBe('UNDEFINED_Z');
    expect(p2.cells[3]).toBe('12.500');
    expect(p2.status).toBe('OK');
  });

  it('3-parcel summary total equals the sum of rows', () => {
    const parcels = [squareParcel('A', 0, 0, 100), squareParcel('B', 200, 0, 50), squareParcel('C', 400, 0, 25)];
    const table = deriveCadSurveyTableFromSource({ kind: 'parcel-summary', parcels }, baseProject());
    const total = table.rows.find((row) => row.cells[0] === 'TOTAL')!;
    const dataRows = table.rows.filter((row) => row.cells[0] !== 'TOTAL');
    expect(dataRows).toHaveLength(3);
    const areaSum = dataRows.reduce((sum, row) => sum + Number(row.cells[2]), 0);
    const perimeterSum = dataRows.reduce((sum, row) => sum + Number(row.cells[3]), 0);
    const courseSum = dataRows.reduce((sum, row) => sum + Number(row.cells[1]), 0);
    expect(Number(total.cells[2])).toBeCloseTo(areaSum, 6);
    expect(Number(total.cells[3])).toBeCloseTo(perimeterSum, 6);
    expect(Number(total.cells[1])).toBe(courseSum);
    // 100^2 + 50^2 + 25^2 = 13125
    expect(areaSum).toBeCloseTo(13125, 6);
  });

  it('CSV escapes delimiters and states units in the heading', () => {
    const table = deriveCadSurveyTableFromSource(
      {
        kind: 'point',
        entries: [{ pointId: 'P1', northing: 1, easting: 2, description: 'A, "B"\nC' }],
      },
      baseProject(),
    );
    const csv = formatCadSurveyTableCsv(table);
    expect(csv).toContain('# Units: distance=m');
    expect(csv).toContain('"A, ""B""\nC"');
    // Report-framework adapter keeps columns + rows identical.
    const report = cadSurveyTableToCogoReportTable(table);
    expect(report.columns).toEqual(table.columns);
    expect(report.rows[0]).toEqual(table.rows[0]!.cells);
  });
});

describe('19A parcel legal description', () => {
  it('drafts 4 straight courses matching the course table and area helper', () => {
    const parcel = squareParcel('LOT 1', 0, 0, 100);
    const courses = resolveCadParcelCourses(parcel);
    expect(courses).toHaveLength(4);
    const table = deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel }, baseProject());
    const draft = buildCadParcelLegalDescription(parcel);
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.description.courses).toHaveLength(4);
    expect(draft.description.areaSquareMeters).toBeCloseTo(10000, 6);
    expect(draft.description.text).toContain('Description of LOT 1');
    expect(draft.description.text).toContain('Containing 10000.0 m².');
    expect(draft.description.text.startsWith('DRAFT — NOT FOR RECORDING')).toBe(true);
    expect(draft.description.text.trimEnd().endsWith('DRAFT — NOT FOR RECORDING')).toBe(true);
    courses.forEach((_course, index) => {
      const row = table.rows[index]!;
      expect(draft.description.courses[index]!.bearing).toBe(row.cells[3]);
      expect(draft.description.courses[index]!.distance.toFixed(3)).toBe(row.cells[4]);
    });
    // No invented jurisdiction/grantor language.
    for (const forbidden of ['grantor', 'PID', 'deed', 'adjoiner', 'monument', 'road', 'county']) {
      expect(draft.description.text.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('reverses with the authoritative inverse, not string manipulation', () => {
    const parcel = squareParcel('LOT 2', 0, 0, 100);
    const forward = resolveCadParcelCourses(parcel);
    const reversed = reverseCadParcelCourses(forward);
    expect(reversed).toHaveLength(4);
    // First reversed course is the reverse of the last forward course.
    const last = forward[3]!;
    expect(reversed[0]!.fromLabel).toBe(last.toLabel);
    expect(reversed[0]!.toLabel).toBe(last.fromLabel);
    expect(reversed[0]!.bearing).toBe(buildCadInverseSummary(last.toVertex, last.fromVertex).bearing);
    // Reverse-then-reverse returns the original direction.
    const roundTrip = reverseCadParcelCourses(reversed);
    expect(roundTrip.map((course) => course.bearing)).toEqual(forward.map((course) => course.bearing));
  });

  it('Start Course rotates traversal and reject unknown ids', () => {
    const parcel = squareParcel('LOT 3', 0, 0, 100);
    const courses = resolveCadParcelCourses(parcel);
    const draft = buildCadParcelLegalDescription(parcel, { startCourseId: courses[2]!.courseId });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    expect(draft.description.startLabel).toBe(courses[2]!.fromLabel);
    const bad = buildCadParcelLegalDescription(parcel, { startCourseId: 'nope' });
    expect(bad.ok).toBe(false);
  });

  it('fails closed on curved courses instead of emitting a chord', () => {
    const parcel = squareParcel('CURVED', 0, 0, 100);
    const curved = { ...parcel, elements: [{ kind: 'arc', radius: 50, deltaDeg: 90 }] } as CadParcelEntity;
    const draft = buildCadParcelLegalDescription(curved);
    expect(draft.ok).toBe(false);
    if (draft.ok) return;
    expect(draft.message).toContain('deferred');
  });

  it('live preview updates on vertex change while static MTEXT stays frozen', () => {
    const parcel = squareParcel('SNAP', 0, 0, 100);
    const first = buildCadParcelLegalDescription(parcel);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const snapshot = buildCadParcelLegalDescriptionMtextSnapshot(first.description);
    expect(snapshot.static).toBe(true);
    const moved: CadParcelEntity = {
      ...parcel,
      vertices: parcel.vertices.map((vertex, index) => (index === 2 ? { x: vertex.x + 50, y: vertex.y } : vertex)),
    };
    const second = buildCadParcelLegalDescription(moved);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.description.text).not.toBe(snapshot.text);
    expect(snapshot.text).toBe(first.description.text);
    expect(second.description.areaSquareMeters).not.toBeCloseTo(first.description.areaSquareMeters, 3);
  });

  it('Include Coordinates adds coordinates without inventing names', () => {
    const parcel = squareParcel('COORD', 0, 0, 100);
    const plain = buildCadParcelLegalDescription(parcel);
    const withCoords = buildCadParcelLegalDescription(parcel, { includeCoordinates: true });
    expect(plain.ok && withCoords.ok).toBe(true);
    if (!plain.ok || !withCoords.ok) return;
    expect(plain.description.text).not.toContain('(N ');
    expect(withCoords.description.text).toContain('(N ');
    expect(withCoords.description.text).toContain('COORD-A');
  });
});

describe('19A survey table export dispositions', () => {
  const table = (): CadSurveyTable =>
    deriveCadSurveyTableFromSource({ kind: 'line', legs: [{ lineId: 'L1', fromId: 'A', toId: 'B', from: { x: 0, y: 0 }, to: { x: 3, y: 4 } }] }, baseProject());

  const draftWithSheet = (project: CadProject) => {
    let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    draft = addSheetToDraft(draft, createPlanSheet({ name: 'Survey', sizeId: 'ISO A4', orientation: 'landscape' }));
    const sheetId = draft.sheets[0]!.id;
    draft = addViewportToSheet(draft, sheetId, {
      name: 'View', modelCenterX: 0, modelCenterY: 0, scaleDenominator: 100,
      paperXmm: 15, paperYmm: 15, paperWidthMm: 250, paperHeightMm: 150,
    });
    return { draft, sheetId };
  };

  it('SVG and PDF are FULL via the canonical scene renderer', () => {
    const project = baseProject();
    const { draft } = draftWithSheet(project);
    const placed = addCadSurveyTableToDraft(draft, table(), { sheetId: draft.sheets[0]!.id, paperXmm: 20, paperYmm: 180 });
    const scene = buildExportSheetSceneWithResult({ draft: placed, sheetId: draft.sheets[0]!.id, project });
    const svg = serializeExportSceneToSvgWithResult(scene.output).output;
    expect(svg).toContain('Line Table');
    expect(svg).toContain('Bearing');
    expect(svg).toContain('5.000');
    const pdf = exportScenesToPdfWithResult([scene.output]);
    const pdfText = new TextDecoder().decode(pdf.output);
    expect(pdfText).toContain('Line Table');
    expect(pdfText).toContain('5.000');
  });

  it('R12 and R2000 approximate survey tables with an explicit warning', () => {
    const project = baseProject();
    const { draft } = draftWithSheet(project);
    const model = buildDxfExportModelWithResult({ project, surveyTables: [table()] });
    expect(model.exportedEntityIds).toContain(table().id);
    expect(model.approximatedEntityIds).toContain(table().id);
    expect(model.warnings.some((warning) => warning.message.includes(CAD_SURVEY_TABLE_DXF_DISPOSITION))).toBe(true);
    const r12 = serializeDxfModel(model.output);
    expect(r12).toContain('Line Table');
    expect(r12).toContain('tables');
    const laid = buildDxfLayoutTextWithResult({ project, draft, surveyTables: [table()] });
    expect(laid.exportedEntityIds).toContain(table().id);
    expect(laid.warnings.some((warning) => warning.message.includes(CAD_SURVEY_TABLE_DXF_DISPOSITION))).toBe(true);
  });

  it('LandXML reports tables as NOT_APPLICABLE and never emits table geometry', () => {
    const project = baseProject();
    const result = buildLandXmlProjectExportWithResult(
      project,
      { units: 'm', projectName: '19A' },
      undefined,
      [table()],
    );
    expect(result.warnings.some((warning) => warning.message.includes(CAD_SURVEY_TABLE_LANDXML_DISPOSITION))).toBe(true);
    expect(result.warnings.some((warning) => warning.entityId === table().id)).toBe(true);
    expect(result.output).not.toContain('Line Table');
  });

  it('underlying parcel/point LandXML contracts are unchanged by table support', () => {
    const project = baseProject();
    const entities: CadEntity[] = [
      { ...base, id: 'pt-1', type: 'survey-point', stationId: 'P1', x: 0, y: 0, pointClass: 'free', source: 'parsed-input' },
      { ...base, id: 'parcel-1', type: 'parcel', parcelName: 'LOT X', vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], vertexLabels: ['A', 'B', 'C', 'D'] },
    ];
    const withProject: CadProject = { ...project, entities };
    const result = buildLandXmlProjectExportWithResult(withProject, { units: 'm', projectName: '19A' });
    expect(result.exportedEntityIds).toContain('parcel-1');
    expect(result.approximatedEntityIds).toContain('parcel-1');
    expect(result.output).toContain('LOT X');
    expect(result.output).toContain('P1');
  });
});

describe('19A persisted table entities reach exporters (no silent omission)', () => {
  let rowCounter = 0;
  const lineEntity = (id: string, from: [number, number], to: [number, number]): CadLineEntity => ({
    ...base,
    id,
    type: 'line',
    fromStationId: `${id}-A`,
    toStationId: `${id}-B`,
    fromX: from[0],
    fromY: from[1],
    toX: to[0],
    toY: to[1],
    sourceObservationIds: [],
  });
  const lineTableEntity = (id: string, lineIds: string[]): CadSurveyTableEntity => ({
    ...base,
    id,
    type: 'survey-table',
    tableKind: 'line',
    x: 500,
    y: 400,
    rotationDeg: 0,
    tableStyleId: DEFAULT_CAD_SURVEY_TABLE_STYLE_ID,
    rows: lineIds.map((entityId) => ({
      id: `row-${(rowCounter += 1)}`,
      source: { kind: 'line', entityId },
    })),
  });
  const drawingWithTable = () => {
    const drawing = createBlankCadDrawingDocument({ name: '19A export-center', units: 'm' });
    const a = lineEntity('line-a', [0, 0], [3, 4]);
    const b = lineEntity('line-b', [0, 0], [10, 0]);
    const tableEntity = lineTableEntity('table-1', [a.id, b.id, 'line-gone']);
    return {
      ...drawing,
      project: { ...drawing.project, entities: [a, b, tableEntity] },
    };
  };

  it('adapter preserves operator order/codes and marks broken rows', () => {
    const drawing = drawingWithTable();
    const collected = collectCadSurveyTablesForExport(drawing.project);
    expect(collected).toHaveLength(1);
    const exported = collected[0]!;
    expect(exported.columns[0]).toBe('Code');
    expect(exported.rows.map((row) => row.cells[0])).toEqual(['L1', 'L2', 'L3']);
    expect(exported.rows[0]!.cells[4]).toBe('5.000');
    expect(exported.rows[2]!.status).toBe('EMPTY');
    expect(exported.warnings.join(' ')).toMatch(/broken/i);
  });

  it('Export Center dxf-r12 approximates the table (never silently omits)', () => {
    const preview = buildExportCenterPreview(drawingWithTable(), { format: 'dxf-r12' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.approximatedEntityIds).toContain('table-1');
    expect(preview.preview.omittedEntityIds).not.toContain('table-1');
    expect(preview.preview.warnings.some((w) => w.message.includes(CAD_SURVEY_TABLE_DXF_DISPOSITION))).toBe(true);
    expect(preview.preview.payload).toContain('L1');
  });

  it('Export Center landxml marks the table NOT_APPLICABLE (never silent)', () => {
    const preview = buildExportCenterPreview(drawingWithTable(), { format: 'landxml' });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.preview.warnings.some((w) => w.message.includes(CAD_SURVEY_TABLE_LANDXML_DISPOSITION))).toBe(true);
    expect(preview.preview.payload).not.toContain('Line Table');
  });
});
