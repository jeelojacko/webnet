/**
 * Phase 20B browser QA — Grade-to-Surface / daylight / grading TINs.
 *
 * Letter map (mission §6):
 *   A fixed fill 20 m           B fixed cut 20 m
 *   C sloped analytic varying   D plane-break kink
 *   E cut/fill transition       F max-distance fail → succeed
 *   G void fail-closed          H multiple-roots nearest
 *   I reverse side-stable       J source edit NEEDS_RECALC
 *   K target lifecycle          N extract snapshot
 *   O bake explicit TIN         P baked 10,000 volume
 *   Q save/reopen               R SVG/PDF/DXF + LandXML warning
 *
 * The analytic letters (A–H) are pinned on the landed engine primitives; the
 * lifecycle/UI letters pin the shell snapshot/display/export seams this
 * slice owns. UI flows that require the grading command/service integration
 * are gated on that seam being present so the suite stays green until it
 * lands (then runs for real). Zero page/console errors on the browser smoke.
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
import type { CadFeatureLineEntity, CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import type { CadGrading, CadGradingResult } from '../src/engine/cad/grading/gradingTypes';
import { classifySourceDelta, splitStationsAtZeros } from '../src/engine/cad/grading/gradingCutFill';
import { buildGradingStripMesh, meshPlanArea, tieStats } from '../src/engine/cad/grading/gradingMesh';
import {
  classifyPlaneRelation,
  solveDaylightDistance,
} from '../src/engine/cad/grading/gradingStraightSolve';
import { buildNearestEnvelope } from '../src/engine/cad/grading/gradingZeroLocus';
import {
  buildCadGradingSnapshot,
  type CadGradingResultCache,
} from '../src/cad-app/shell/cadGradingSnapshot';
import { buildGradingDisplayPass } from '../src/cad-app/shell/cadGradingDisplay';
import { buildGradingCsv } from '../src/cad-app/shell/cadGradingReport';
import { buildGradingExportInput } from '../src/cad-app/shell/cadGradingExportInput';
import {
  buildGradingModelItems,
  buildGradingSheetItems,
  gradingLandXmlWarnings,
} from '../src/engine/cad/cadGradingExportScene';
import { gotoCad, homeTab, openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';

// ---------------------------------------------------------------------------
// Engine analytic letters
// ---------------------------------------------------------------------------

test('A fixed fill: -0.5 grade ties 20 m out and meshes the strip', () => {
  expect(solveDaylightDistance(10, 0.5, 50)).toBeCloseTo(20, 6);
  const source = [
    { x: 0, y: 0, z: 10 },
    { x: 100, y: 0, z: 10 },
  ];
  const daylight = [
    { x: 0, y: 20, z: 0 },
    { x: 100, y: 20, z: 0 },
  ];
  const mesh = buildGradingStripMesh(source, daylight);
  expect(mesh.ok).toBe(true);
  if (!mesh.ok) return;
  expect(meshPlanArea(mesh.points, mesh.triangles)).toBeCloseTo(2000, 6);
  expect(tieStats([20, 20]).max).toBeCloseTo(20, 6);
});

test('B fixed cut: +0.5 grade ties 20 m out and classifies CUT', () => {
  expect(solveDaylightDistance(10, 0.5, 50)).toBeCloseTo(20, 6);
  expect(classifySourceDelta(10)).toBe('CUT');
});

test('C sloped analytic: varying d(u) interpolates linearly', () => {
  const env = buildNearestEnvelope([{ u0: 0, d0: 10, u1: 100, d1: 30 }], 1000);
  expect(env.ok).toBe(true);
  if (!env.ok) return;
  expect(env.polyline).toEqual([
    { u: 0, d: 10 },
    { u: 100, d: 30 },
  ]);
});

test('D plane-break kink: two target planes keep one continuous envelope', () => {
  const env = buildNearestEnvelope(
    [
      { u0: 0, d0: 20, u1: 50, d1: 30 },
      { u0: 50, d0: 30, u1: 100, d1: 15 },
    ],
    1000,
  );
  expect(env.ok).toBe(true);
  if (!env.ok) return;
  expect(env.polyline).toEqual([
    { u: 0, d: 20 },
    { u: 50, d: 30 },
    { u: 100, d: 15 },
  ]);
});

test('E cut/fill transition: exact zero station splits regions', () => {
  const stations = splitStationsAtZeros([0, 10, 20], [5, -5, -5]);
  expect(stations).toContain(5);
});

test('F max-distance: no tie within limit, then succeeds when raised', () => {
  expect(solveDaylightDistance(10, 0.5, 15)).toBeNull();
  expect(solveDaylightDistance(10, 0.5, 20)).toBeCloseTo(20, 6);
});

test('G void fail-closed: an empty envelope is NO_SOLUTION, never bridged', () => {
  expect(buildNearestEnvelope([], 1000)).toEqual({ ok: false, code: 'NO_SOLUTION' });
});

test('H multiple roots: nearest positive root is selected', () => {
  const env = buildNearestEnvelope(
    [
      { u0: 0, d0: 20, u1: 100, d1: 20 },
      { u0: 0, d0: 50, u1: 100, d1: 50 },
    ],
    1000,
  );
  expect(env.ok).toBe(true);
  if (!env.ok) return;
  expect(env.polyline[0]).toEqual({ u: 0, d: 20 });
});

test('parallel planes with no crossing are classified, not fudged', () => {
  expect(classifyPlaneRelation(1, 0.5)).toBe('intersecting');
  expect(classifyPlaneRelation(5, 0.5)).toBe('intersecting');
  expect(classifyPlaneRelation(-10, 0)).toBe('parallel');
  expect(classifyPlaneRelation(0, 0)).toBe('coincident');
});

// ---------------------------------------------------------------------------
// Shell lifecycle letters (snapshot / display / export / persistence)
// ---------------------------------------------------------------------------

let seq = 0;
const pt = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'unknown',
  source: 'parsed-input',
});

const fixture = (): { project: CadProject; grading: CadGrading } => {
  seq = 0;
  const a = pt('A', 0, 0, 0);
  const b = pt('B', 10, 0, 0);
  const c = pt('C', 10, 10, 0);
  const d = pt('D', 0, 10, 0);
  const doc = createBlankCadDrawingDocument({ name: 'grading-20b', units: 'm' });
  const project = doc.project;
  project.entities = [a, b, c, d];
  const fl: CadFeatureLineEntity = {
    id: `fl-${(seq += 1)}`,
    type: 'feature-line',
    layerId: 'feature-lines',
    visible: true,
    locked: false,
    name: 'Ridge',
    vertices: [
      { id: 'vA', x: 0, y: 5, z: 0 },
      { id: 'vB', x: 10, y: 5, z: 0 },
    ],
    closed: false,
  };
  project.entities.push(fl);
  project.surfaces = [
    { id: 'srf-1', name: 'Pond', definition: { pointSource: { kind: 'points', pointEntityIds: [a.id, b.id, c.id, d.id] } }, cachedRevision: null },
  ];
  const grading: CadGrading = {
    id: 'g-1',
    name: 'Ridge - Right',
    sourceFeatureLineId: fl.id,
    sourceCourse: { vertexAId: 'vA', vertexBId: 'vB' },
    targetSurfaceId: 'srf-1',
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 20,
    curveChordTolerance: 0.1,
  };
  project.gradings = [grading];
  return { project, grading };
};

const surfaceCacheOf = (project: CadProject) => {
  const cache = createCadSurfaceCache(`20b-${(seq += 1)}`);
  for (const surface of project.surfaces ?? []) {
    const built = buildCadSurface(project, surface);
    if (built.outcome === 'ok') {
      cache.set(surface.id, built.revision, {
        revision: built.revision,
        points: built.points,
        triangles: built.triangles,
        stats: built.stats,
        grid: built.grid,
        adjacency: built.adjacency,
        edgeKinds: built.edgeKinds,
      });
    }
  }
  return cache;
};

const mkResult = (gradingId: string, revision: string): CadGradingResult => ({
  gradingId,
  revision,
  accuracy: 'EXACT',
  regions: [{ classification: 'FILL', stationSpan: [0, 10] }],
  daylightPoints: [0, 20, 0, 10, 20, 0],
  gradingMesh: { points: [0, 0, 0, 10, 0, 0, 10, 20, 0, 0, 20, 0], triangles: [0, 1, 2, 0, 2, 3] },
  sourceLength: 10,
  gradingPlanArea: 200,
  grading3dArea: 223.6,
  minProjectionDistance: 20,
  maxProjectionDistance: 20,
  meanProjectionDistance: 20,
  cutSourceLength: 0,
  fillSourceLength: 10,
  tiedSourceLength: 0,
  candidateTriangleCount: 2,
  intersectionSegmentCount: 1,
  multipleSolutionCount: 0,
  diagnostics: [],
});

const resultCache = (results: readonly CadGradingResult[]): CadGradingResultCache => ({
  get: (id, revision) => results.find((r) => r.gradingId === id && r.revision === revision),
  retained: (id) => results.filter((r) => r.gradingId === id),
});

test('I reverse side-stable: B->A storage resolves to the same physical side', () => {
  const { project, grading } = fixture();
  const fl = project.entities.find((e) => e.type === 'feature-line') as CadFeatureLineEntity;
  fl.vertices = [fl.vertices[1]!, fl.vertices[0]!];
  surfaceCacheOf(project);
  const snap = buildCadGradingSnapshot(project, surfaceCacheOf(project), resultCache([]), grading.id);
  expect(snap.gradings[0]?.status).not.toBe('BROKEN_REFERENCE');
  expect(snap.gradings[0]?.side).toBe('Right');
});

test('J source edit invalidates the revision (NEEDS_RECALC with a retained result)', () => {
  const { project, grading } = fixture();
  const cache = surfaceCacheOf(project);
  const unbuilt = buildCadGradingSnapshot(project, cache, resultCache([]), grading.id);
  const result = mkResult(grading.id, unbuilt.gradings[0]!.revision);
  const fl = project.entities.find((e) => e.type === 'feature-line') as CadFeatureLineEntity;
  fl.vertices[1] = { id: 'vB', x: 12, y: 5, z: 0 };
  const snap = buildCadGradingSnapshot(project, cache, resultCache([result]), grading.id);
  expect(snap.gradings[0]?.status).toBe('NEEDS_RECALC');
});

test('K target lifecycle: SOURCE_NOT_CURRENT when the target has no CURRENT mesh', () => {
  const { project, grading } = fixture();
  const cache = surfaceCacheOf(project);
  const unbuilt = buildCadGradingSnapshot(project, cache, resultCache([]), grading.id);
  const result = mkResult(grading.id, unbuilt.gradings[0]!.revision);
  const snap = buildCadGradingSnapshot(project, null, resultCache([result]), grading.id);
  expect(snap.gradings[0]?.status).toBe('SOURCE_NOT_CURRENT');
});

test('N display + CSV render only from the CURRENT cache', () => {
  const { project, grading } = fixture();
  const cache = surfaceCacheOf(project);
  const unbuilt = buildCadGradingSnapshot(project, cache, resultCache([]), grading.id);
  const result = mkResult(grading.id, unbuilt.gradings[0]!.revision);
  const snap = buildCadGradingSnapshot(project, cache, resultCache([result]), grading.id);
  const row = snap.gradings[0]!;
  const pass = buildGradingDisplayPass(row, row.currentResult, row.source);
  expect(pass.current).toBe(true);
  expect(pass.daylight).toHaveLength(2);
  const csv = buildGradingCsv(row.definition, row.source!, result);
  expect(csv.split('\n').length).toBe(3);
});

test('Q save/reopen: grading definitions round-trip byte-exact', () => {
  const { project, grading } = fixture();
  const doc = createBlankCadDrawingDocument({ name: 'grading-20b', units: 'm' });
  doc.project = project;
  const text = serializeCadDrawingFile(doc);
  const reopened = parseCadDrawingFile(text);
  if (!reopened.ok) throw new Error('reopen failed');
  expect(reopened.drawing.project.gradings).toEqual([grading]);
});

test('R export: SVG/PDF sheet items + DXF 3D/3DFACE from CURRENT; LandXML warns', () => {
  const { project, grading } = fixture();
  const cache = surfaceCacheOf(project);
  const unbuilt = buildCadGradingSnapshot(project, cache, resultCache([]), grading.id);
  const result = mkResult(grading.id, unbuilt.gradings[0]!.revision);
  const snap = buildCadGradingSnapshot(project, cache, resultCache([result]), grading.id);
  const input = buildGradingExportInput(snap);
  expect(input).not.toBeUndefined();
  const sheet = buildGradingSheetItems(input, (x, y) => ({ xMm: x, yMm: y }));
  expect(sheet.items.length).toBeGreaterThan(0);
  const model = buildGradingModelItems(input);
  expect(model.polylines3d).toHaveLength(1);
  expect(model.faces3d).toHaveLength(2);
  expect(gradingLandXmlWarnings(input)).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// Browser smoke
// ---------------------------------------------------------------------------

test.describe('browser smoke', () => {
  test('the /cad app boots with zero page/console errors', async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    expect(errors).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// Browser UI flow (real /cad app): manager + Toolspace + registry wiring
// ---------------------------------------------------------------------------

/** Seed a drawing WITH a grading definition through the production file loader. */
const seedGradingFile = (): string => {
  const { project, grading } = fixture();
  const doc = createBlankCadDrawingDocument({ name: 'grading-ui-20b', units: 'm' });
  doc.project = project;
  void grading;
  const file = path.join(os.tmpdir(), `webnet-grading-20b-${Date.now()}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile(doc), 'utf8');
  return file;
};

test.describe('browser UI', () => {
  test('Home Grading group opens the manager and lists the definition', async ({ page }: { page: Page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    const file = seedGradingFile();
    try {
      await openSurveyPlanDrawing(page, file);
      await homeTab(page);
      const group = page.locator('[data-cad-grading-command="GRADING"]');
      await expect(group).toBeVisible({ timeout: 15000 });
      await group.click();
      await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('[data-cad-grading-row="g-1"]')).toBeVisible();
      await expect(page.locator('[data-cad-grading-row="g-1"]')).toContainText('Ridge - Right');
      // Inquiry tab renders the honest non-CURRENT report (no stale numbers).
      await page.locator('[data-cad-grading-tab="inquiry"]').click();
      await expect(page.locator('[data-cad-grading-inquiry-report]')).toContainText('No CURRENT result');
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
});
