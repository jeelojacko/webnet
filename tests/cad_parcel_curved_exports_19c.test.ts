// Phase 19C Round 2C — curved-parcel export matrix (DXF / LandXML / SVG / PDF / WNCAD / sheets).
import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
  createBlankCadProject,
} from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import {
  resolveCadParcelCourses as resolveCanonicalParcelCourses,
  buildParcelCourseIds,
} from '../src/engine/cad/cadParcelCourses';
import { validateParcelBoundaryTopology } from '../src/engine/cad/cadParcelArcGeometry';
import {
  addCadSurveyTableToDraft,
  deriveCadSurveyTableFromSource,
  resolveCadParcelCourses,
} from '../src/engine/cad/cadSurveyExportTables';
import { buildCadParcelLegalDescription } from '../src/engine/cad/cadParcelLegalDescription';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import { buildDxfLayoutTextWithResult } from '../src/engine/cad/dxf/dxfLayoutExport';
import { buildExportSheetSceneWithResult, modelToPaperPoint } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import type {
  CadEntity,
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';

const LAYER = '19c-export-layer';
const line: CadParcelCourseGeometry = { kind: 'line' };
const arc = (bulge: number): CadParcelCourseGeometry => ({ kind: 'arc', bulge });

let seq = 0;
const makeParcel = (
  vertices: Array<{ x: number; y: number }>,
  courseGeometry?: CadParcelCourseGeometry[],
): CadParcelEntity => {
  const id = `parcel-19c-export-${(seq += 1)}`;
  const parcel: CadParcelEntity = {
    id,
    type: 'parcel',
    layerId: LAYER,
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: `Export ${seq}`,
    courseIds: buildParcelCourseIds(id, vertices.length),
    ...(courseGeometry != null ? { courseGeometry: courseGeometry.map((entry) => ({ ...entry })) } : {}),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry });
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
  }
  return parcel;
};

const square = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];
const mixedMinorOpposite = () => makeParcel(square, [line, arc(-0.5), line, arc(0.5)]);
const majorArc = () =>
  makeParcel(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ],
    [line, arc(-Math.tan((3 * Math.PI) / 8)), line],
  );
const straight = () => makeParcel(square);

const projectWith = (...entities: CadEntity[]): CadProject => {
  const project = createBlankCadProject({ name: '19c exports', units: 'm' });
  return {
    ...project,
    layers: [{ id: LAYER, name: 'Survey', color: '#112233', visible: true, locked: false, role: 'planning' }],
    entities,
  };
};

const draftWithViewport = (project: CadProject, scaleDenominator: number) => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'Survey', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]!.id;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'View',
    modelCenterX: 5,
    modelCenterY: 5,
    scaleDenominator,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 250,
    paperHeightMm: 150,
  });
  return { draft, sheetId };
};

const placeTable = (draft: ReturnType<typeof createBlankDraftDocument>, sheetId: string, project: CadProject, parcel: CadParcelEntity) => {
  const table = deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel }, project);
  return { table, draft: addCadSurveyTableToDraft(draft, table, { sheetId, paperXmm: 20, paperYmm: 180 }) };
};

const distanceToLine = (
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-12) return Math.hypot(point.x - a.x, point.y - a.y);
  return Math.abs(dy * point.x - dx * point.y + b.x * a.y - b.y * a.x) / length;
};

describe('19C fixture topology', () => {
  it('mixed minor/opposite and major parcels are valid boundaries', () => {
    expect(mixedMinorOpposite().courseGeometry).toBeDefined();
    expect(
      validateParcelBoundaryTopology(mixedMinorOpposite().vertices, mixedMinorOpposite().courseGeometry).ok,
    ).toBe(true);
    expect(
      validateParcelBoundaryTopology(majorArc().vertices, majorArc().courseGeometry).ok,
    ).toBe(true);
    expect(resolveCadParcelCourses(mixedMinorOpposite())).toHaveLength(4);
  });
});

describe('19C DXF export (R12 + R2000)', () => {
  it('curved parcel exports native LINE + ARC and keeps the semantic warning', () => {
    const parcel = mixedMinorOpposite();
    const result = buildDxfExportModelWithResult({ project: projectWith(parcel) });
    expect(result.output.arcs.length).toBe(2);
    expect(result.output.lines.length).toBe(2);
    // No chord polyline stands in for the parcel boundary.
    expect(result.output.polylines).toHaveLength(0);
    expect(result.approximatedEntityIds).toContain(parcel.id);
    expect(
      result.warnings.some((warning) =>
        warning.message.includes(`${parcel.id} approximated as line/arc primitives`),
      ),
    ).toBe(true);
    const canonicalArcs = resolveCanonicalParcelCourses(parcel).filter(
      (course) => course.kind === 'arc',
    );
    result.output.arcs.forEach((exportedArc, index) => {
      const course = canonicalArcs[index];
      if (!course || course.kind !== 'arc') throw new Error('expected arc');
      expect(exportedArc.center.x).toBeCloseTo(course.center.x, 9);
      expect(exportedArc.center.y).toBeCloseTo(course.center.y, 9);
      expect(exportedArc.radius).toBeCloseTo(course.radius, 9);
    });
    const dxf = serializeDxfModel(result.output);
    expect(dxf).toContain('\nARC\n');
    expect(dxf).not.toContain('\nLWPOLYLINE\n');
  });

  it('all-straight parcel keeps the legacy closed LWPOLYLINE with the original warning', () => {
    const parcel = straight();
    const result = buildDxfExportModelWithResult({ project: projectWith(parcel) });
    expect(result.output.arcs).toHaveLength(0);
    expect(result.output.polylines).toHaveLength(1);
    expect(result.output.polylines[0]!.closed).toBe(true);
    expect(
      result.warnings.some((warning) => warning.message.includes('approximated as closed polyline')),
    ).toBe(true);
  });

  it('R2000 paper-layout DXF carries the same ARC primitives', () => {
    const parcel = mixedMinorOpposite();
    const project = projectWith(parcel);
    const { draft } = draftWithViewport(project, 250);
    const laid = buildDxfLayoutTextWithResult({ project, draft });
    expect(laid.output.dxf).toContain('\nARC\n');
    expect(laid.exportedEntityIds).toContain(parcel.id);
  });
});

describe('19C LandXML parcel disposition', () => {
  it('curved parcel uses the schema-supported Parcel CoordGeom Curve (exact geometry, semantic warning)', () => {
    const parcel = mixedMinorOpposite();
    const result = buildLandXmlProjectExportWithResult(projectWith(parcel), {
      units: 'm',
      projectName: '19C',
    });
    expect(result.output).toContain('<Parcel');
    expect(result.output).toContain('<Curve rot="');
    expect(result.output).toContain('radius=');
    expect(result.exportedEntityIds).toContain(parcel.id);
    // Geometry is exact; the entity still carries the "geometric only, no
    // legal parcel meaning" approximation warning.
    expect(result.approximatedEntityIds).toContain(parcel.id);
    expect(
      result.warnings.some((warning) => warning.entityId === parcel.id && /Parcel ring/.test(warning.message)),
    ).toBe(true);
    // The major arc also round-trips its sweep direction faithfully.
    const major = majorArc();
    const majorResult = buildLandXmlProjectExportWithResult(projectWith(major), {
      units: 'm',
      projectName: '19C',
    });
    expect(majorResult.output).toContain('rot="cw"');
  });

  it('all-straight parcel output is unchanged (no Curve element)', () => {
    const parcel = straight();
    const result = buildLandXmlProjectExportWithResult(projectWith(parcel), {
      units: 'm',
      projectName: '19C',
    });
    expect(result.output).toContain('<Parcel');
    expect(result.output).not.toContain('<Curve');
  });
});

describe('19C SVG/PDF + sheet viewport integration', () => {
  it('curved parcel outline reaches the paper scene as a true arc (never a chord)', () => {
    const parcel = mixedMinorOpposite();
    const project = projectWith(parcel);
    // Canonical display scene already carries native arc primitives.
    const display = buildCadDisplayScene(project);
    expect(display.primitives.some((primitive) => primitive.sourceEntityId === parcel.id && primitive.kind === 'arc')).toBe(true);

    const { draft, sheetId } = draftWithViewport(project, 250);
    const placed = placeTable(draft, sheetId, project, parcel);
    const scene = buildExportSheetSceneWithResult({ draft: placed.draft, sheetId, project });
    const arcCourse = resolveCanonicalParcelCourses(parcel)[1]!;
    if (arcCourse.kind !== 'arc') throw new Error('expected arc');
    const viewport = placed.draft.sheets[0]!.viewports[0]!;
    const plan = { ...viewport };
    const projectedFromRaw = modelToPaperPoint(arcCourse.fromVertex.x, arcCourse.fromVertex.y, plan);
    const projectedToRaw = modelToPaperPoint(arcCourse.toVertex.x, arcCourse.toVertex.y, plan);
    const projectedFrom = { x: projectedFromRaw.xMm, y: projectedFromRaw.yMm };
    const projectedTo = { x: projectedToRaw.xMm, y: projectedToRaw.yMm };
    const parcelPoints = scene.output.items
      .filter((item) => item.kind === 'polyline' && item.sourceEntityId === parcel.id)
      .flatMap((item) => (item.kind === 'polyline' ? item.points : []));
    expect(parcelPoints.length).toBeGreaterThan(2);
    const maxDeviation = Math.max(
      ...parcelPoints.map((point) => distanceToLine(point, projectedFrom, projectedTo)),
    );
    expect(maxDeviation).toBeGreaterThan(1);
    const svg = serializeExportSceneToSvgWithResult(scene.output).output;
    expect(svg).toContain(placed.table.title);
  });

  it.each([250, 500, 1000])('viewport 1:%i renders the curved parcel + table through the normal model scene', (scale) => {
    const parcel = mixedMinorOpposite();
    const project = projectWith(parcel);
    const { draft, sheetId } = draftWithViewport(project, scale);
    const placed = placeTable(draft, sheetId, project, parcel);
    const scene = buildExportSheetSceneWithResult({ draft: placed.draft, sheetId, project });
    expect(scene.exportedEntityIds).toContain(parcel.id);
    const svg = serializeExportSceneToSvgWithResult(scene.output).output;
    expect(svg).toContain(placed.table.title);
    expect(svg).toContain('ARC');
    const pdf = exportScenesToPdfWithResult([scene.output]);
    const pdfText = new TextDecoder().decode(pdf.output);
    expect(pdfText).toContain('Parcel Courses');
  });
});

describe('19C export matrix + WNCAD round-trip', () => {
  it('straight vs curved dispositions are honest across every format (never a silent chord)', () => {
    const curved = mixedMinorOpposite();
    const straightParcel = straight();
    const curvedProject = projectWith(curved);
    const straightProject = projectWith(straightParcel);

    // DXF-R12
    const curvedDxf = buildDxfExportModelWithResult({ project: curvedProject });
    const straightDxf = buildDxfExportModelWithResult({ project: straightProject });
    expect(curvedDxf.output.arcs.length).toBeGreaterThan(0);
    expect(curvedDxf.output.polylines).toHaveLength(0);
    expect(straightDxf.output.arcs).toHaveLength(0);
    expect(straightDxf.output.polylines).toHaveLength(1);

    // LandXML
    const curvedXml = buildLandXmlProjectExportWithResult(curvedProject, { units: 'm', projectName: 'm' });
    const straightXml = buildLandXmlProjectExportWithResult(straightProject, { units: 'm', projectName: 'm' });
    expect(curvedXml.output).toContain('<Curve');
    expect(straightXml.output).not.toContain('<Curve');

    // SVG / PDF via the canonical sheet scene
    const { draft, sheetId } = draftWithViewport(curvedProject, 500);
    const placed = placeTable(draft, sheetId, curvedProject, curved);
    const scene = buildExportSheetSceneWithResult({ draft: placed.draft, sheetId, project: curvedProject });
    const svg = serializeExportSceneToSvgWithResult(scene.output).output;
    expect(svg).toContain(placed.table.title);
    const pdfText = new TextDecoder().decode(exportScenesToPdfWithResult([scene.output]).output);
    expect(pdfText).toContain('Parcel Courses');

    // WNCAD persistence (below section covers exact geometry).
    const drawing = createBlankCadDrawingDocument({ name: 'matrix', units: 'm' });
    drawing.project.entities.push(structuredClone(curved));
    const reopened = parseCadDrawingFile(serializeCadDrawingFile(drawing));
    expect(reopened.ok).toBe(true);
  });

  it('save/reopen preserves mixed line/minor/major/opposite-hand geometry, ids, table and description', () => {
    const mixed = mixedMinorOpposite();
    const major = majorArc();
    const project = projectWith(mixed, major);
    const mixedTable = deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel: mixed }, project);
    const majorTable = deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel: major }, project);
    const mixedDescription = buildCadParcelLegalDescription(mixed);
    const majorDescription = buildCadParcelLegalDescription(major);

    const document = createBlankCadDrawingDocument({ name: 'mixed-19c', units: 'm' });
    document.project.entities.push(structuredClone(mixed), structuredClone(major));
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopenedMixed = parsed.drawing.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === mixed.id,
    )!;
    const reopenedMajor = parsed.drawing.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === major.id,
    )!;
    expect(reopenedMixed.courseIds).toEqual(mixed.courseIds);
    expect(reopenedMixed.courseGeometry).toEqual(mixed.courseGeometry);
    expect(reopenedMajor.courseGeometry).toEqual(major.courseGeometry);
    expect(reopenedMixed.areaSquareMeters).toBeCloseTo(mixed.areaSquareMeters!, 9);
    expect(reopenedMixed.perimeterMeters).toBeCloseTo(mixed.perimeterMeters!, 9);
    expect(JSON.stringify(resolveCadParcelCourses(reopenedMixed))).toBe(
      JSON.stringify(resolveCadParcelCourses(mixed)),
    );
    expect(JSON.stringify(resolveCadParcelCourses(reopenedMajor))).toBe(
      JSON.stringify(resolveCadParcelCourses(major)),
    );
    expect(buildCadParcelLegalDescription(reopenedMixed)).toEqual(mixedDescription);
    expect(buildCadParcelLegalDescription(reopenedMajor)).toEqual(majorDescription);
    expect(
      deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel: reopenedMixed }, project).rows,
    ).toEqual(mixedTable.rows);
    expect(
      deriveCadSurveyTableFromSource({ kind: 'parcel-course', parcel: reopenedMajor }, project).rows,
    ).toEqual(majorTable.rows);
    // Render equivalence: identical display primitives for the parcel.
    expect(
      buildCadDisplayScene(projectWith(reopenedMixed)).primitives
        .filter((primitive) => primitive.sourceEntityId === reopenedMixed.id)
        .map((primitive) => primitive.kind),
    ).toEqual(
      buildCadDisplayScene(projectWith(mixed)).primitives
        .filter((primitive) => primitive.sourceEntityId === mixed.id)
        .map((primitive) => primitive.kind),
    );
  });
});
