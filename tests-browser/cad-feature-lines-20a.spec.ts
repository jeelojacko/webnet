/**
 * Phase 20A browser QA — 3D feature lines through the real /cad app plus
 * store-level pins on the production engine seams (one letter per mission
 * §104 item).
 *
 * Letter map (mission §104):
 *   A create from ordered survey points snapshots exact XYZ (source Z)
 *   B constant elevation (ribbon create with a prompted Z)
 *   C "From Surface" method (vertex XY query, all-or-nothing)
 *   D set elevation single vertex + multi-vertex subset
 *   E set grade across intermediates by cumulative plan station
 *   F interpolate a mixed line/arc line by station, NOT vertex index
 *   G arc station/grade + inquiry curve metrics
 *   H insert a vertex on a line and on an arc (sub-arcs stay on-circle)
 *   I reverse (path kept, stations/grades/bulges flipped)
 *   J MOVE / ROTATE / MIRROR / uniform SCALE / GridGround (Z rides verbatim)
 *   K surface breakline live -> stale on edit -> rebuild
 *   L one feature line feeding two surfaces -> both stale, per-surface rebuild
 *   M Save Drawing round-trips ids, XYZ and bulges exactly (browser)
 *   N SVG/PDF plan FULL; DXF 3D POLYLINE (FULL straight, arc approximated);
 *     LandXML 3D PlanFeature (arc linearized + warned)
 *   O undo/redo restores the untouched project and replays
 *
 * Browser flows drive the production shell (Survey Toolspace node,
 * Properties, Home ribbon Feature Line group, Save Drawing). Every other
 * letter is pinned at the store level on the exact seams the UI commits
 * through. Zero page/console errors per browser test.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import {
  getFeatureLineElevationAtStation,
  getFeatureLinePointAtStation,
  resolveCadFeatureLine,
} from '../src/engine/cad/cadFeatureLines';
import {
  insertFeatureLineVertex,
  reverseFeatureLine,
} from '../src/engine/cad/cadFeatureLineEdits';
import { buildFeatureLineInquiry } from '../src/engine/cad/cadFeatureLineInquiry';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import {
  classifyTransform,
  reflectionAboutLine,
  rotationAbout,
  translation,
  uniformScaleAbout,
} from '../src/engine/cad/cadTransform2D';
import {
  breaklineEntityRefs,
  collectSources,
  computeCadSurfaceSourceRevision,
} from '../src/engine/cad/cadSurfaceRevision';
import { buildCadSurface, deriveSurfaceStatus, getSurfaceElevationAt } from '../src/engine/cad/cadSurfaces';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { serializeDxfModel } from '../src/engine/cad/dxf/dxfSerializer';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import type {
  CadEntity,
  CadFeatureLineEntity,
  CadFeatureLineSegmentGeometry,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import {
  entityCount,
  gotoCad,
  openSurveyPlanDrawing,
  saveDrawingText,
  selectAll,
  selectionCount,
} from './cad-survey-plan-19a-helpers';

// ---------------------------------------------------------------------------
// Deterministic fixtures
// ---------------------------------------------------------------------------

const QUARTER_BULGE = Math.tan(Math.PI / 8);

type VertexInput = { x: number; y: number; z: number };

const surveyPoint = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const featureLine = (
  id: string,
  name: string,
  vertices: VertexInput[],
  segmentGeometry?: CadFeatureLineSegmentGeometry[],
  closed = false,
): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'feature-lines',
  visible: true,
  locked: false,
  name,
  vertices: vertices.map((vertex, index) => ({ id: `feature-vertex:${id}:v${index + 1}`, ...vertex })),
  ...(segmentGeometry != null ? { segmentGeometry: segmentGeometry.map((entry) => ({ ...entry })) } : {}),
  ...(closed ? { closed: true } : {}),
});

/** Four corners with distinct Z (surface source for letters C/K/L). */
const gridPoints = (): CadEntity[] => [
  surveyPoint('pt-1', 'A', 0, 0, 0),
  surveyPoint('pt-2', 'B', 10, 0, 10),
  surveyPoint('pt-3', 'C', 10, 10, 20),
  surveyPoint('pt-4', 'D', 0, 10, 10),
];

const QA_POINTS: CadSurveyPointEntity[] = [
  surveyPoint('qa-p1', 'QA1', 0, 0, 100),
  surveyPoint('qa-p2', 'QA2', 10, 0, 100.5),
  surveyPoint('qa-p3', 'QA3', 10, 10, 101),
  surveyPoint('qa-p4', 'QA4', 0, 10, 100.5),
  surveyPoint('qa-p5', 'QA5', 100, 100, 200),
];

const QA_STRAIGHT = featureLine('fl-qa-straight', 'Straight Grade', [
  { x: 0, y: 0, z: 100 },
  { x: 50, y: 0, z: 101 },
  { x: 100, y: 0, z: 102 },
]);

/** Line + quarter arc + line: plan/station fractions differ from index fractions. */
const QA_MIXED = featureLine(
  'fl-qa-mixed',
  'Line + Arc',
  [
    { x: 0, y: 50, z: 200 },
    { x: 60, y: 50, z: 200 },
    { x: 60, y: 110, z: 206 },
    { x: 140, y: 110, z: 206 },
  ],
  [{ kind: 'line' }, { kind: 'arc', bulge: QUARTER_BULGE }, { kind: 'line' }],
);

const cloneFl = (entity: CadFeatureLineEntity): CadFeatureLineEntity => structuredClone(entity);

const qaSurface = (featureLineId: string, id = 's-qa', name = 'QA Surface'): CadSurface => ({
  id,
  name,
  definition: {
    pointSource: { kind: 'points', pointEntityIds: ['qa-p1', 'qa-p2', 'qa-p3', 'qa-p4'] },
    breaklines: [{ id: `bl-${id}`, type: 'standard', source: { kind: 'entity', entityId: featureLineId } }],
  },
});

const projectWith = (entities: CadEntity[], surfaces: CadSurface[] = []): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Feature Line QA 20A', units: 'm' });
  return { ...drawing.project, entities, ...(surfaces.length > 0 ? { surfaces } : {}) };
};

const qaBrowserProject = (): CadProject =>
  projectWith([...QA_POINTS, cloneFl(QA_STRAIGHT), cloneFl(QA_MIXED)], [qaSurface(QA_STRAIGHT.id)]);

const writeFixture = (project: CadProject, stem: string): string => {
  const document = createBlankCadDrawingDocument({ name: project.name, units: 'm' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-20a-'));
  const filePath = path.join(dir, `${stem}.wncad`);
  fs.writeFileSync(filePath, serializeCadDrawingFile({ ...document, project }), 'utf8');
  return filePath;
};

const featureLineOf = (project: CadProject, id?: string): CadFeatureLineEntity => {
  const entity = project.entities.find(
    (candidate): candidate is CadFeatureLineEntity =>
      candidate.type === 'feature-line' && (id == null || candidate.id === id),
  );
  if (!entity) throw new Error('feature line not found');
  return entity;
};

const featureLinesOf = (project: CadProject): CadFeatureLineEntity[] =>
  project.entities.filter((entity): entity is CadFeatureLineEntity => entity.type === 'feature-line');

const createFromPoints = (
  project: CadProject,
  sourceEntityIds: string[],
  elevation: { method: 'source' } | { method: 'constant'; z: number },
) =>
  runCadCommand(createCadHistoryState(project), {
    key: 'FEATURELINE',
    sourceEntityIds,
    sourceKind: 'survey-points',
    elevation,
  });

const surveyTab = async (page: Page): Promise<void> => {
  await page.locator('[data-cad-toolspace] [role="tab"]', { hasText: 'Survey' }).click();
};

const acceptPrompt = (page: Page, value: string): void => {
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'prompt') void dialog.accept(value);
  });
};

const draftWithViewport = (project: CadProject, centerX: number, centerY: number, scaleDenominator = 500) => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'Survey', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]!.id;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'View',
    modelCenterX: centerX,
    modelCenterY: centerY,
    scaleDenominator,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 250,
    paperHeightMm: 150,
  });
  return { draft, sheetId };
};

// ---------------------------------------------------------------------------
// Browser flows
// ---------------------------------------------------------------------------

test.describe('Phase 20A feature lines (browser flows)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('B(browser): ribbon create from survey points at a constant elevation', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeFixture(projectWith(QA_POINTS), 'points-only-20a'));
    expect(await entityCount(page)).toBe(5);

    await selectAll(page, 5);
    acceptPrompt(page, '150.5');
    await page.locator('[data-cad-feature-line="FEATURELINECREATE"]').click();
    await expect.poll(() => entityCount(page)).toBe(6);

    const { text } = await saveDrawingText(page);
    const parsed = parseCadDrawingFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const created = featureLineOf(parsed.drawing.project);
    expect(created.name).toBe('Feature Line 1');
    expect(created.vertices.map((vertex) => [vertex.x, vertex.y, vertex.z])).toEqual(
      QA_POINTS.map((point) => [point.x, point.y, 150.5]),
    );
    expect(errors).toEqual([]);
  });

  test('Survey Toolspace node + Properties expose exact feature-line data', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeFixture(qaBrowserProject(), 'feature-lines-20a'));
    expect(await entityCount(page)).toBe(7);
    await surveyTab(page);

    await expect(page.locator('[data-cad-toolspace]', { hasText: 'Feature Lines (2)' })).toBeVisible();
    const summary = page.locator('[data-cad-feature-line-summary="fl-qa-straight"]');
    await expect(summary).toContainText('3 verts');
    await expect(summary).toContainText('Z 100.000 … 102.000');
    await expect(summary).toContainText('Surface uses: QA Surface');

    await page
      .locator('button[title="Select this feature line."]', { hasText: 'Straight Grade' })
      .click();
    await expect.poll(() => selectionCount(page)).toBe(1);
    const courses = page.locator('[data-cad-feature-line-courses="fl-qa-straight"]');
    await expect(courses).toBeVisible();
    await expect(courses.locator('[data-cad-feature-line-course="0"]')).toContainText('line');
    await expect(courses.locator('[data-cad-feature-line-course="0"]')).toContainText('ahead 2.00%');

    const props = page.locator('[data-cad-properties="single"]');
    await expect(props).toContainText('Start station');
    await expect(props).toContainText('0+00.000');
    await expect(props).toContainText('1+00.000');
    await expect(props).toContainText('Min Z');
    await expect(props).toContainText('100.000');
    await expect(props).toContainText('Max Z');
    await expect(props).toContainText('102.000');
    expect(errors).toEqual([]);
  });

  test('Home ribbon Feature Line group is bounded and gated on selection', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeFixture(qaBrowserProject(), 'ribbon-20a'));
    await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();

    const create = page.locator('[data-cad-feature-line="FEATURELINECREATE"]');
    await expect(create).toBeVisible();
    // No feature line selected: edit buttons stay disabled.
    await expect(page.locator('[data-cad-feature-line="FLSETZ"]')).toBeDisabled();
    await expect(page.locator('[data-cad-feature-line="FLGRADE"]')).toBeDisabled();

    await selectAll(page, 7);
    await expect(create).toBeEnabled();
    expect(errors).toEqual([]);
  });

  test('M(browser): Save Drawing round-trips ids, XYZ and bulges exactly', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openSurveyPlanDrawing(page, writeFixture(qaBrowserProject(), 'roundtrip-20a'));
    const { text } = await saveDrawingText(page);
    const parsed = parseCadDrawingFile(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const straight = featureLineOf(parsed.drawing.project, QA_STRAIGHT.id);
    const mixed = featureLineOf(parsed.drawing.project, QA_MIXED.id);
    expect(straight.vertices).toEqual(QA_STRAIGHT.vertices);
    expect(mixed.vertices).toEqual(QA_MIXED.vertices);
    expect(mixed.segmentGeometry).toEqual(QA_MIXED.segmentGeometry);
    expect(parsed.drawing.project.entities.map((entity) => entity.id)).toEqual(
      qaBrowserProject().entities.map((entity) => entity.id),
    );
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Store-level flows (production engine seams the UI commits through)
// ---------------------------------------------------------------------------

test.describe('Phase 20A feature lines (store-level flows)', () => {
  test('A: create from ordered survey points snapshots exact XYZ (no live dependency)', () => {
    const project = projectWith(QA_POINTS.map((point) => ({ ...point })));
    const history = createFromPoints(project, ['qa-p1', 'qa-p2', 'qa-p3'], { method: 'source' });
    const created = featureLineOf(history.present.project);
    expect(created.vertices.map((vertex) => [vertex.x, vertex.y, vertex.z])).toEqual([
      [0, 0, 100],
      [10, 0, 100.5],
      [10, 10, 101],
    ]);

    // Snapshot: moving a source point afterwards leaves the feature line alone.
    const moved = history.present.project.entities.map((entity) =>
      entity.id === 'qa-p2' && entity.type === 'survey-point' ? { ...entity, z: 999 } : entity,
    );
    expect(featureLineOf(history.present.project).vertices[1]!.z).toBe(100.5);
    expect(featureLineOf(projectWith(moved)).vertices[1]!.z).toBe(100.5);
  });

  test('C: "From Surface" method sets every vertex Z from CURRENT surface, all-or-nothing', () => {
    let history = runCadCommand(createCadHistoryState(projectWith(gridPoints())), {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const surfaceId = history.present.project.surfaces![0]!.id;
    const created = runCadCommand(history, {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-1', 'pt-2', 'pt-3'],
      sourceKind: 'survey-points',
      elevation: { method: 'surface', surfaceId },
    });
    const fl = featureLineOf(created.present.project);
    // Vertices coincide with the surface corners, so Z is the corner Z.
    expect(fl.vertices.map((vertex) => vertex.z)).toEqual([0, 10, 20]);
    const build = buildCadSurface(created.present.project, created.present.project.surfaces![0]!);
    fl.vertices.forEach((vertex) => {
      expect(getSurfaceElevationAt(build, vertex.x, vertex.y)).toBeCloseTo(vertex.z, 9);
    });

    // An off-surface vertex blocks the whole commit (no partial line).
    const outside = projectWith([...gridPoints(), surveyPoint('pt-out', 'OUT', 100, 100, 0)]);
    history = runCadCommand(createCadHistoryState(outside), {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const outSurfaceId = history.present.project.surfaces![0]!.id;
    const rejected = runCadCommand(history, {
      key: 'FEATURELINE',
      sourceEntityIds: ['pt-1', 'pt-2', 'pt-out'],
      sourceKind: 'survey-points',
      elevation: { method: 'surface', surfaceId: outSurfaceId },
    });
    expect(rejected).toBe(history);
  });

  test('D: set elevation on a single vertex and a multi-vertex subset (Z only)', () => {
    let history = createFromPoints(projectWith(gridPoints()), ['pt-1', 'pt-2', 'pt-3'], { method: 'source' });
    const fl = featureLineOf(history.present.project);
    const [v1, v2, v3] = fl.vertices;
    const planBefore = fl.vertices.map((vertex) => [vertex.x, vertex.y]);

    history = runCadCommand(history, { key: 'FLSETZ', entityId: fl.id, z: 55, vertexIds: [v2!.id] });
    expect(featureLineOf(history.present.project).vertices.map((vertex) => vertex.z)).toEqual([0, 55, 20]);

    history = runCadCommand(history, {
      key: 'FLSETZ',
      entityId: fl.id,
      z: 60,
      vertexIds: [v1!.id, v3!.id],
    });
    const next = featureLineOf(history.present.project);
    expect(next.vertices.map((vertex) => vertex.z)).toEqual([60, 55, 60]);
    expect(next.vertices.map((vertex) => [vertex.x, vertex.y])).toEqual(planBefore);
  });

  test('E: set grade drives intermediates by plan station (0/30/70/100 -> 100/100.6/101.4/102)', () => {
    const chain = projectWith([
      surveyPoint('g-1', 'G1', 0, 0, 100),
      surveyPoint('g-2', 'G2', 30, 0, 100),
      surveyPoint('g-3', 'G3', 70, 0, 100),
      surveyPoint('g-4', 'G4', 100, 0, 100),
    ]);
    let history = createFromPoints(chain, ['g-1', 'g-2', 'g-3', 'g-4'], { method: 'source' });
    const fl = featureLineOf(history.present.project);
    history = runCadCommand(history, { key: 'FLGRADE', entityId: fl.id, gradePercent: 2 });
    expect(featureLineOf(history.present.project).vertices.map((vertex) => vertex.z)).toEqual([
      100, 100.6, 101.4, 102,
    ]);

    // set-end-only leaves intermediates untouched and honours a falling grade.
    const endOnly = runCadCommand(createCadHistoryState(history.present.project), {
      key: 'FLGRADE',
      entityId: fl.id,
      gradePercent: -1,
      mode: 'set-end-only',
    });
    const graded = featureLineOf(endOnly.present.project);
    expect(graded.vertices.map((vertex) => vertex.z)).toEqual([100, 100.6, 101.4, 99]);
  });

  test('F: interpolate a mixed line/arc line by station, not vertex index', () => {
    const fl = cloneFl(QA_MIXED);
    const resolved = resolveCadFeatureLine(fl)!;
    const stations = resolved.stations;
    let history = createCadHistoryState(projectWith([fl]));
    // Endpoints 100 / 300, intermediate Z zeroed so interpolation must fill.
    history = runCadCommand(history, { key: 'FLSETZ', entityId: fl.id, z: 0 });
    history = runCadCommand(history, {
      key: 'FLSETZ',
      entityId: fl.id,
      z: 100,
      vertexIds: [fl.vertices[0]!.id],
    });
    history = runCadCommand(history, {
      key: 'FLSETZ',
      entityId: fl.id,
      z: 300,
      vertexIds: [fl.vertices[3]!.id],
    });
    history = runCadCommand(history, { key: 'FLINTERPOLATE', entityId: fl.id });
    const next = featureLineOf(history.present.project);
    const byStation = (index: number) => 100 + 200 * (stations[index]! / resolved.planLength);
    expect(next.vertices[1]!.z).toBeCloseTo(byStation(1), 9);
    expect(next.vertices[2]!.z).toBeCloseTo(byStation(2), 9);
    // Station-based and index-based results genuinely differ here.
    expect(next.vertices[1]!.z).not.toBeCloseTo(100 + 200 / 3, 6);
    expect(next.vertices[2]!.z).not.toBeCloseTo(100 + 400 / 3, 6);
  });

  test('G: arc station/grade ride the true circle; inquiry reports curve metrics', () => {
    // Quarter arc, R = 100 (chord 100*sqrt(2), 90 deg), graded 100 -> 200.
    const fl = featureLine('fl-arc-g', 'Arc Grade', [
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 100, z: 200 },
    ], [{ kind: 'arc', bulge: QUARTER_BULGE }]);
    const resolved = resolveCadFeatureLine(fl)!;
    const course = resolved.courses[0]!;
    expect(course.kind).toBe('arc');
    expect(course.radius).toBeCloseTo(100, 6);
    expect(Math.abs(course.signedSweepDeg!)).toBeCloseTo(90, 6);
    expect(resolved.planLength).toBeCloseTo((100 * Math.PI) / 2, 6);
    expect(course.gradePercent).toBeCloseTo((100 / ((100 * Math.PI) / 2)) * 100, 6);

    const mid = resolved.planLength / 2;
    expect(getFeatureLineElevationAtStation(resolved, mid)).toBeCloseTo(150, 9);
    const point = getFeatureLinePointAtStation(resolved, mid)!;
    expect(course.center).not.toBeNull();
    expect(Math.hypot(point.x - course.center!.x, point.y - course.center!.y)).toBeCloseTo(100, 6);
    expect(point.z).toBeCloseTo(150, 9);

    const inquiry = buildFeatureLineInquiry(fl)!;
    expect(inquiry.curve?.radius).toBeCloseTo(100, 6);
    expect(Math.abs(inquiry.curve?.signedSweepDeg ?? 0)).toBeCloseTo(90, 6);
    expect(inquiry.gradePercent).toBeCloseTo(course.gradePercent, 9);
  });

  test('H: insert a vertex on a line and on an arc (sub-arcs stay on-circle)', () => {
    const line = featureLine('fl-h-line', 'Line Insert', [
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 0, z: 102 },
    ]);
    const lineInsert = insertFeatureLineVertex(line, 0, 25);
    expect(lineInsert.ok).toBe(true);
    if (lineInsert.ok) {
      const next = lineInsert.entity;
      expect(next.vertices).toHaveLength(3);
      expect(next.vertices[1]!.z).toBeCloseTo(100.5, 9);
      expect(next.vertices[1]!.x).toBeCloseTo(25, 9);
      const resolved = resolveCadFeatureLine(next)!;
      expect(resolved.courses.map((course) => course.planLength)).toEqual([25, 75]);
      expect(resolved.planLength).toBeCloseTo(100, 9);
    }

    const arc = featureLine('fl-h-arc', 'Arc Insert', [
      { x: 0, y: 0, z: 100 },
      { x: 100, y: 100, z: 200 },
    ], [{ kind: 'arc', bulge: QUARTER_BULGE }]);
    const arcResolved = resolveCadFeatureLine(arc)!;
    const arcInsert = insertFeatureLineVertex(arc, 0, arcResolved.planLength / 4);
    expect(arcInsert.ok).toBe(true);
    if (arcInsert.ok) {
      const next = arcInsert.entity;
      expect(next.segmentGeometry).toHaveLength(2);
      expect(next.segmentGeometry!.every((entry) => entry.kind === 'arc')).toBe(true);
      const resolved = resolveCadFeatureLine(next)!;
      expect(resolved.courses[0]!.planLength).toBeCloseTo(arcResolved.planLength / 4, 6);
      expect(resolved.courses[1]!.planLength).toBeCloseTo((arcResolved.planLength * 3) / 4, 6);
      // Both sub-arcs keep the same centre + radius (on-circle split).
      resolved.courses.forEach((course) => {
        expect(course.center!.x).toBeCloseTo(arcResolved.courses[0]!.center!.x, 6);
        expect(course.center!.y).toBeCloseTo(arcResolved.courses[0]!.center!.y, 6);
        expect(course.radius).toBeCloseTo(100, 6);
      });
    }
    // Inserting at an endpoint fails closed.
    expect(insertFeatureLineVertex(arc, 0, 0).ok).toBe(false);
  });

  test('I: reverse keeps the path and flips stations, grades and bulge signs', () => {
    const original = cloneFl(QA_MIXED);
    const before = resolveCadFeatureLine(original)!;
    const reversed = reverseFeatureLine(original);
    const after = resolveCadFeatureLine(reversed)!;

    expect(after.planLength).toBeCloseTo(before.planLength, 9);
    expect(reversed.vertices.map((vertex) => [vertex.x, vertex.y, vertex.z])).toEqual(
      [...original.vertices].reverse().map((vertex) => [vertex.x, vertex.y, vertex.z]),
    );
    expect(after.courses[0]!.kind).toBe('line');
    expect(after.courses[1]!.kind).toBe('arc');
    const beforeArc = before.courses.find((course) => course.kind === 'arc')!;
    const afterArc = after.courses.find((course) => course.kind === 'arc')!;
    expect(afterArc.signedSweepDeg).toBeCloseTo(-beforeArc.signedSweepDeg!, 9);
    const expectedGrades = [...before.courses].reverse().map((course) => -course.gradePercent);
    after.courses.forEach((course, index) => {
      expect(course.gradePercent).toBeCloseTo(expectedGrades[index]!, 9);
    });
  });

  test('J: MOVE/ROTATE/MIRROR/SCALE/GridGround move XY only, Z rides verbatim', () => {
    const fl = cloneFl(QA_MIXED);
    const before = resolveCadFeatureLine(fl)!;
    const expectGradesCloseTo = (entity: CadFeatureLineEntity, expected: number[]) => {
      const courses = resolveCadFeatureLine(entity)!.courses;
      expect(courses).toHaveLength(expected.length);
      courses.forEach((course, index) => expect(course.gradePercent).toBeCloseTo(expected[index]!, 9));
    };
    const originalGrades = before.courses.map((course) => course.gradePercent);
    const apply = (transform: Parameters<typeof transformCadEntityGeometry>[1]) => {
      const classification = classifyTransform(transform);
      expect(classification).not.toBeNull();
      const result = transformCadEntityGeometry(fl, transform, classification!);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.reason);
      return result.entity as CadFeatureLineEntity;
    };

    const moved = apply(translation(1000, 500));
    expect(moved.vertices.map((vertex) => vertex.z)).toEqual(fl.vertices.map((vertex) => vertex.z));
    expectGradesCloseTo(moved, originalGrades);

    const rotated = apply(rotationAbout(0, 0, 90));
    expect(rotated.vertices.map((vertex) => vertex.z)).toEqual(fl.vertices.map((vertex) => vertex.z));
    expect(rotated.segmentGeometry).toEqual(fl.segmentGeometry);
    expectGradesCloseTo(rotated, originalGrades);

    const mirror = reflectionAboutLine({ x: 0, y: 0 }, { x: 1, y: 0 })!;
    const mirrored = apply(mirror);
    expect(mirrored.vertices.map((vertex) => vertex.z)).toEqual(fl.vertices.map((vertex) => vertex.z));
    const beforeBulge = fl.segmentGeometry!.find((entry) => entry.kind === 'arc') as { bulge: number };
    const mirrorBulge = mirrored.segmentGeometry!.find((entry) => entry.kind === 'arc') as { bulge: number };
    expect(mirrorBulge.bulge).toBeCloseTo(-beforeBulge.bulge, 12);
    expectGradesCloseTo(mirrored, originalGrades);

    // Uniform SCALE is XY-only: horizontal distance doubles, grade halves.
    const scaled = apply(uniformScaleAbout(0, 0, 2));
    expect(scaled.vertices.map((vertex) => vertex.z)).toEqual(fl.vertices.map((vertex) => vertex.z));
    expect(resolveCadFeatureLine(scaled)!.planLength).toBeCloseTo(before.planLength * 2, 6);
    expectGradesCloseTo(scaled, originalGrades.map((grade) => grade / 2));

    // GridGround (similarity about an origin) shares the SCALE semantics.
    const history = runCadCommand(createCadHistoryState(projectWith([cloneFl(fl)])), {
      key: 'GRIDGROUND',
      originE: 0,
      originN: 0,
      combinedScaleFactor: 1,
      direction: 'GRID_TO_GROUND',
    });
    expect(featureLineOf(history.present.project).vertices.map((vertex) => vertex.z)).toEqual(
      fl.vertices.map((vertex) => vertex.z),
    );
  });

  test('K: surface breakline is live, goes stale on edit, and rebuilds', () => {
    const fl = featureLine('fl-k', 'Ridge', [
      { x: 0, y: 0, z: 100 },
      { x: 50, y: 0, z: 105 },
      { x: 100, y: 0, z: 100 },
    ]);
    const surface = {
      id: 's-k',
      name: 'Ridge Surface',
      definition: {
        pointSource: { kind: 'points' as const, pointEntityIds: ['pt-sw', 'pt-se', 'pt-ne', 'pt-nw'] },
        breaklines: [{ id: 'bl-k', type: 'standard' as const, source: { kind: 'entity' as const, entityId: fl.id } }],
      },
    };
    const corners = [
      surveyPoint('pt-sw', 'SW', 0, 0, 100),
      surveyPoint('pt-se', 'SE', 100, 0, 100),
      surveyPoint('pt-ne', 'NE', 100, 100, 112),
      surveyPoint('pt-nw', 'NW', 0, 100, 112),
    ];
    const project = projectWith([...corners, fl], [surface]);
    expect(breaklineEntityRefs(fl)).toEqual([`feature-line:${fl.id}`]);

    const collected = collectSources(project, surface);
    expect(collected.breaklineError).toBeNull();
    expect(collected.breaklines[0]).toHaveLength(3);
    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
    expect(getSurfaceElevationAt(built, 50, 0)).toBeCloseTo(105, 6);

    // Edit the ridge: revision changes and the surface is stale.
    const editedFl: CadFeatureLineEntity = {
      ...fl,
      vertices: fl.vertices.map((vertex, index) => (index === 1 ? { ...vertex, z: 110 } : vertex)),
    };
    const editedProject = projectWith([...corners, editedFl], [surface]);
    expect(computeCadSurfaceSourceRevision(editedProject, surface)).not.toBe(
      computeCadSurfaceSourceRevision(project, surface),
    );
    const staleSurface = { ...surface, cachedRevision: built.revision };
    expect(deriveSurfaceStatus(editedProject, staleSurface)).toBe('NEEDS_REBUILD');

    // Rebuild carries the new ridge.
    const rebuilt = buildCadSurface(editedProject, staleSurface);
    expect(rebuilt.outcome).toBe('ok');
    expect(getSurfaceElevationAt(rebuilt, 50, 0)).toBeCloseTo(110, 6);
    expect(deriveSurfaceStatus(editedProject, { ...staleSurface, cachedRevision: rebuilt.revision })).toBe(
      'CURRENT',
    );
  });

  test('L: one feature line feeding two surfaces staleness is per-surface', () => {
    const fl = featureLine('fl-l', 'Shared Ridge', [
      { x: 0, y: 0, z: 100 },
      { x: 50, y: 0, z: 105 },
      { x: 100, y: 0, z: 100 },
    ]);
    const corners = [
      surveyPoint('pt-sw', 'SW', 0, 0, 100),
      surveyPoint('pt-se', 'SE', 100, 0, 100),
      surveyPoint('pt-ne', 'NE', 100, 100, 112),
      surveyPoint('pt-nw', 'NW', 0, 100, 112),
    ];
    const surfaceA: CadSurface = {
      id: 's-l-a',
      name: 'Surface A',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: ['pt-sw', 'pt-se', 'pt-ne', 'pt-nw'] },
        breaklines: [{ id: 'bl-a', type: 'standard', source: { kind: 'entity', entityId: fl.id } }],
      },
    };
    const surfaceB: CadSurface = {
      id: 's-l-b',
      name: 'Surface B',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: ['pt-sw', 'pt-se', 'pt-ne', 'pt-nw'] },
        breaklines: [{ id: 'bl-b', type: 'standard', source: { kind: 'entity', entityId: fl.id } }],
      },
    };
    const project = projectWith([...corners, fl], [surfaceA, surfaceB]);
    const builtA = buildCadSurface(project, surfaceA);
    const builtB = buildCadSurface(project, surfaceB);
    expect(builtA.outcome).toBe('ok');
    expect(builtB.outcome).toBe('ok');
    const currentA = { ...surfaceA, cachedRevision: builtA.revision };
    const currentB = { ...surfaceB, cachedRevision: builtB.revision };

    const editedFl: CadFeatureLineEntity = {
      ...fl,
      vertices: fl.vertices.map((vertex, index) => (index === 1 ? { ...vertex, z: 110 } : vertex)),
    };
    const editedProject = projectWith([...corners, editedFl], [currentA, currentB]);
    // Both surfaces see the same source change.
    expect(deriveSurfaceStatus(editedProject, currentA)).toBe('NEEDS_REBUILD');
    expect(deriveSurfaceStatus(editedProject, currentB)).toBe('NEEDS_REBUILD');

    // Rebuilding only A leaves B stale (no cross-surface coupling).
    const rebuiltA = buildCadSurface(editedProject, currentA);
    const rebuiltProject = projectWith(
      [...corners, editedFl],
      [{ ...currentA, cachedRevision: rebuiltA.revision }, currentB],
    );
    expect(deriveSurfaceStatus(rebuiltProject, { ...currentA, cachedRevision: rebuiltA.revision })).toBe('CURRENT');
    expect(deriveSurfaceStatus(rebuiltProject, currentB)).toBe('NEEDS_REBUILD');
  });

  test('N: SVG/PDF plan FULL; DXF 3D POLYLINE; LandXML 3D PlanFeature (arcs warned)', () => {
    const straightProject = projectWith([cloneFl(QA_STRAIGHT)]);
    const dxfStraight = buildDxfExportModelWithResult({ project: straightProject });
    const straightPoly = dxfStraight.output.polylines3d!.find((entry) => entry.sourceId === QA_STRAIGHT.id)!;
    expect(straightPoly.vertices.map((vertex) => vertex.z)).toEqual([100, 101, 102]);
    expect(dxfStraight.approximatedEntityIds).not.toContain(QA_STRAIGHT.id);
    const dxfText = serializeDxfModel(dxfStraight.output);
    expect(dxfText).toContain('\nPOLYLINE\n');
    expect(dxfText).toContain('\nVERTEX\n');
    expect(dxfText).toContain('30\n102');

    const mixedProject = projectWith([cloneFl(QA_MIXED)]);
    const dxfMixed = buildDxfExportModelWithResult({ project: mixedProject });
    expect(dxfMixed.exportedEntityIds).toContain(QA_MIXED.id);
    expect(dxfMixed.approximatedEntityIds).toContain(QA_MIXED.id);
    expect(
      dxfMixed.warnings.some((warning) => warning.entityId === QA_MIXED.id && /tessellated 3D polyline/.test(warning.message)),
    ).toBe(true);

    const landXml = buildLandXmlProjectExportWithResult(mixedProject, { units: 'm', projectName: '20a' });
    expect(landXml.exportedEntityIds).toContain(QA_MIXED.id);
    expect(landXml.output).toContain('<PlanFeature');
    expect(landXml.approximatedEntityIds).toContain(QA_MIXED.id);
    expect(
      landXml.warnings.some((warning) => warning.entityId === QA_MIXED.id && /linearized/.test(warning.message)),
    ).toBe(true);

    const { draft, sheetId } = draftWithViewport(mixedProject, 70, 80);
    const scene = buildExportSheetSceneWithResult({
      draft,
      sheetId,
      project: mixedProject,
      featureLineLabels: true,
    });
    expect(scene.exportedEntityIds).toContain(QA_MIXED.id);
    const svg = serializeExportSceneToSvgWithResult(scene.output).output;
    expect(svg).toContain('200.000');
    const pdfText = new TextDecoder().decode(exportScenesToPdfWithResult([scene.output]).output);
    expect(pdfText).toContain('200.000');
  });

  test('O: undo/redo restores the untouched project and replays the transactions', () => {
    let history = createFromPoints(projectWith(QA_POINTS), ['qa-p1', 'qa-p2'], { method: 'constant', z: 100 });
    const flId = featureLineOf(history.present.project).id;
    // 10 m plan span at +4% => end elevation 100.4.
    history = runCadCommand(history, { key: 'FLGRADE', entityId: flId, gradePercent: 4 });
    expect(featureLineOf(history.present.project).vertices.map((vertex) => vertex.z)).toEqual([100, 100.4]);

    const afterGradeUndo = undoCadHistory(history);
    expect(featureLineOf(afterGradeUndo.present.project).vertices.map((vertex) => vertex.z)).toEqual([100, 100]);

    const afterCreateUndo = undoCadHistory(afterGradeUndo);
    expect(featureLinesOf(afterCreateUndo.present.project)).toHaveLength(0);
    expect(afterCreateUndo.present.project.entities.map((entity) => entity.id)).toEqual(
      QA_POINTS.map((point) => point.id),
    );

    const afterCreateRedo = redoCadHistory(afterCreateUndo);
    expect(featureLineOf(afterCreateRedo.present.project).id).toBe(flId);
    const afterGradeRedo = redoCadHistory(afterCreateRedo);
    expect(featureLineOf(afterGradeRedo.present.project).vertices.map((vertex) => vertex.z)).toEqual([100, 100.4]);
  });
});
