/**
 * Phase 19D browser QA — parcel network production wave through the real
 * /cad app plus store-level pins on the production engine seams.
 *
 * One seeded plan is reused everywhere: five 20x30 lots (600 m² each) in a
 * row, a 2000 m² remainder to the north, an easement strip overlaying
 * Lot 1/Lot 2 (300 m²), and a ROW strip along the north edge (800 m²).
 * Lots share exact whole-course edges with opposite traversal, so links are
 * geometrically exact with zero conditioning beyond machine epsilon.
 *
 * Browser flows drive the production shell (toolspace network/schedule,
 * Properties, sheet viewport, save/reopen); every other letter is pinned at
 * the store level on the exact seams the UI commits through, each naming the
 * letter it covers. Zero page/console errors per browser test.
 *
 * Letter map (mission §115): A designate/number five lots + roles +
 * Properties; B schedule exact areas; C link straight CURRENT; D link curved
 * reverse-bulge parity; E wrong-geometry link blocked; F generic one-sided
 * edit BLOCKED; G shared edit atomic both parcels; H group move all-allowed
 * / partial-blocked; I delete cleanup + undo; J copy zero-links/designation
 * policy; K network check (unlinked exact, point touch, primary overlap);
 * L easement overlay INFO not lot-conflict; M schedule live update; N
 * save/reopen links+designations exact; O transforms keep line+arc CURRENT;
 * P sheet lot plan + schedule in 19B layout (§68); Q export honesty SVG/PDF/
 * DXF/WNCAD (§§70-73).
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import {
  createCadHistoryState,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import {
  buildParcelCourseIds,
  resolveCadParcelCourses,
} from '../src/engine/cad/cadParcelCourses';
import {
  buildCadParcelSharedBoundaryId,
  deriveCadParcelSharedBoundaryStatus,
  readCadParcelSharedBoundaries,
} from '../src/engine/cad/cadParcelSharedBoundary';
import { buildParcelNetwork } from '../src/engine/cad/cadParcelNetwork';
import { buildCadParcelNetworkReport } from '../src/engine/cad/cadParcelNetworkReport';
import { buildCadParcelSchedule } from '../src/engine/cad/cadParcelSchedule';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import {
  addSheetToDraft,
  addViewportToSheet,
  createPlanSheet,
} from '../src/engine/cad/cadSheets';
import { buildExportSheetSceneWithResult } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvgWithResult } from '../src/engine/cad/cadSvgSerializer';
import { exportScenesToPdfWithResult } from '../src/engine/cad/cadPdfExport';
import { buildDxfExportModelWithResult } from '../src/engine/cad/dxf/dxfExportModel';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCadProject';
import type {
  CadDrawingDocument,
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadParcelPlanRole,
  CadProject,
} from '../src/engine/cad/cadTypes';
import {
  entityCount,
  gotoCad,
  saveDrawingText,
  selectionCount,
} from './cad-survey-plan-19a-helpers';
import {
  addLayoutSheet,
  createViewportMview,
  layoutTab,
  paperStatus,
  sheetSvg,
} from './cad-sheet-layout-19b-helpers';

// ---------------------------------------------------------------------------
// Seeded plan — five lots + remainder + easement + ROW (letter A input).
// Lots are 20x30 (600 m²); adjacent lots share one exact whole-course edge
// with opposite traversal. Lot i east edge == lot i+1 west edge, reversed.
// ---------------------------------------------------------------------------

type SeedDef = {
  id: string;
  parcelName: string;
  designation?: string;
  role?: CadParcelPlanRole;
  description?: string;
  vertices: Array<[number, number]>;
  courseGeometry?: CadParcelCourseGeometry[];
};

const SEED_DEFS: SeedDef[] = [
  { id: 'lot-1', parcelName: 'P-LOT1', designation: 'Lot 1', role: 'lot', vertices: [[0, 0], [20, 0], [20, 30], [0, 30]] },
  { id: 'lot-2', parcelName: 'P-LOT2', designation: 'Lot 2', role: 'lot', vertices: [[20, 0], [40, 0], [40, 30], [20, 30]] },
  { id: 'lot-3', parcelName: 'P-LOT3', designation: 'Lot 3', role: 'lot', vertices: [[40, 0], [60, 0], [60, 30], [40, 30]] },
  { id: 'lot-4', parcelName: 'P-LOT4', designation: 'Lot 4', role: 'lot', vertices: [[60, 0], [80, 0], [80, 30], [60, 30]] },
  { id: 'lot-5', parcelName: 'P-LOT5', designation: 'Lot 5', role: 'lot', vertices: [[80, 0], [100, 0], [100, 30], [80, 30]] },
  { id: 'remainder-a', parcelName: 'P-REM', designation: 'Remainder A', role: 'remainder', vertices: [[0, 30], [100, 30], [100, 50], [0, 50]] },
  { id: 'easement-e1', parcelName: 'P-EASE', designation: 'Easement E1', role: 'easement', vertices: [[10, 5], [30, 5], [30, 20], [10, 20]] },
  { id: 'row-r1', parcelName: 'P-ROW', designation: 'ROW R1', role: 'right-of-way', vertices: [[0, 50], [100, 50], [100, 58], [0, 58]] },
];

const EXPECTED_AREAS: Record<string, number> = {
  'lot-1': 600, 'lot-2': 600, 'lot-3': 600, 'lot-4': 600, 'lot-5': 600,
  'remainder-a': 2000, 'easement-e1': 300, 'row-r1': 800,
};

const makeSeedParcel = (def: SeedDef): CadParcelEntity => {
  const vertices = def.vertices.map(([x, y]) => ({ x, y }));
  const parcel: CadParcelEntity = {
    id: def.id,
    type: 'parcel',
    layerId: 'parcels',
    visible: true,
    locked: false,
    parcelName: def.parcelName,
    vertices,
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    courseIds: buildParcelCourseIds(def.id, vertices.length),
    ...(def.courseGeometry ? { courseGeometry: def.courseGeometry.map((entry) => ({ ...entry })) } : {}),
    ...(def.designation != null || def.role != null || def.description != null
      ? {
          planInfo: {
            ...(def.designation != null ? { designation: def.designation } : {}),
            ...(def.role != null ? { role: def.role } : {}),
            ...(def.description != null ? { description: def.description } : {}),
          },
        }
      : {}),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, {
    ...(parcel.courseGeometry ? { courseGeometry: parcel.courseGeometry } : {}),
  });
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
    parcel.closureDeltaX = metrics.closureDeltaX;
    parcel.closureDeltaY = metrics.closureDeltaY;
    parcel.closureDistanceMeters = metrics.closureDistanceMeters;
  }
  return parcel;
};

/** Seed project; `bare` drops plan info so letter A can designate via commands. */
const buildSeedProject = (bare = false): CadProject => {
  const document = createBlankCadDrawingDocument({ name: 'Parcel Network QA 19D', units: 'm' });
  const defs = bare
    ? SEED_DEFS.map((def) => ({ ...def, designation: undefined, role: undefined, description: undefined }))
    : SEED_DEFS;
  return { ...document.project, entities: defs.map(makeSeedParcel) };
};

const parcelOf = (project: CadProject, id: string): CadParcelEntity => {
  const parcel = project.entities.find(
    (entity): entity is CadParcelEntity => entity.id === id && entity.type === 'parcel',
  );
  if (!parcel) throw new Error(`seed parcel ${id} missing`);
  return parcel;
};

/** Stable course id of course `index` on `parcelId` (canonical resolver order). */
const courseIdOf = (project: CadProject, parcelId: string, index: number): string => {
  const course = resolveCadParcelCourses(parcelOf(project, parcelId))[index];
  if (!course) throw new Error(`course ${index} of ${parcelId} missing`);
  return course.courseId;
};

/** Commit a PARCELLINK through the production seam; throws when blocked. */
const linkCourses = (
  project: CadProject,
  first: { parcelId: string; courseIndex: number },
  second: { parcelId: string; courseIndex: number },
): CadProject => {
  const next = runCadCommand(createCadHistoryState(project, []), {
    key: 'PARCELLINK',
    first: { parcelId: first.parcelId, courseId: courseIdOf(project, first.parcelId, first.courseIndex) },
    second: { parcelId: second.parcelId, courseId: courseIdOf(project, second.parcelId, second.courseIndex) },
  });
  if (next.undoStack.length === 0) throw new Error('PARCELLINK blocked unexpectedly');
  return next.present.project;
};

const linkIdOf = (
  project: CadProject,
  first: { parcelId: string; courseIndex: number },
  second: { parcelId: string; courseIndex: number },
): string =>
  buildCadParcelSharedBoundaryId(
    { parcelId: first.parcelId, courseId: courseIdOf(project, first.parcelId, first.courseIndex) },
    { parcelId: second.parcelId, courseId: courseIdOf(project, second.parcelId, second.courseIndex) },
  );

const writeParcelNetworkFixture = (): string => {
  const document = createBlankCadDrawingDocument({ name: 'Parcel Network QA 19D', units: 'm' });
  // The browser fixture carries one production-committed straight link
  // (lot-1 east edge <-> lot-2 west edge, opposite traversal).
  const project = linkCourses(
    buildSeedProject(),
    { parcelId: 'lot-1', courseIndex: 1 },
    { parcelId: 'lot-2', courseIndex: 3 },
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-19d-'));
  const filePath = path.join(dir, 'parcel-network-19d.wncad');
  fs.writeFileSync(
    filePath,
    serializeCadDrawingFile({ ...document, project: { ...project, name: 'Parcel Network QA 19D' } }),
    'utf8',
  );
  return filePath;
};

const openParcelNetworkDrawing = async (page: Parameters<typeof gotoCad>[0], fixturePath: string): Promise<void> => {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(fixturePath);
  await expect.poll(() => entityCount(page)).toBeGreaterThan(0);
};

const surveyTab = async (page: Parameters<typeof gotoCad>[0]): Promise<void> => {
  await page.locator('[data-cad-toolspace] [role="tab"]', { hasText: 'Survey' }).click();
};

// ---------------------------------------------------------------------------
// Browser flows — real /cad UI at the 1366x768 minimum viewport
// ---------------------------------------------------------------------------

test.describe('Phase 19D parcel network (browser flows)', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('A(browser): five lots + roles in Toolspace; Properties shows Plan Designation', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openParcelNetworkDrawing(page, writeParcelNetworkFixture());
    expect(await entityCount(page)).toBe(8);
    await surveyTab(page);

    // Parcel Schedules node: one live row per parcel with exact areas.
    await expect(page.locator('[data-cad-toolspace]', { hasText: 'Parcel Schedules (8)' })).toBeVisible();
    const scheduleRow = page.locator('[data-cad-parcel-schedule-row="lot-1"]');
    await expect(scheduleRow).toContainText('Lot 1');
    await expect(scheduleRow).toContainText('600.000');

    // Parcel Network node: designation-first label, role line, linked neighbor.
    const node = page.locator('[data-cad-parcel-node="lot-1"]');
    await expect(node).toContainText('Lot 1');
    await expect(node).toContainText('Plan Role: Lot');
    await expect(node.locator('[data-cad-parcel-neighbor="lot-2"]')).toContainText('Linked');

    // Production select path: expand the parcel node, Toolspace SELECT
    // -> single Properties.
    await page.locator('[data-cad-parcel-node="lot-1"] > summary').click();
    await page.locator('[data-cad-parcel-actions="lot-1"] [data-cad-parcel-action="SELECT"]').click();
    await expect.poll(() => selectionCount(page)).toBe(1);
    const props = page.locator('[data-cad-properties="single"]');
    await expect(props).toContainText('Plan Designation');
    await expect(props).toContainText('Lot 1');
    expect(errors).toEqual([]);
  });

  test('P(browser): layout sheet + 1:500 viewport shows the lot plan', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openParcelNetworkDrawing(page, writeParcelNetworkFixture());
    await addLayoutSheet(page);
    await layoutTab(page, 'Layout 1').click();
    await createViewportMview(page, { centerX: '50', centerY: '29', scale: '500' });
    await expect(sheetSvg(page)).toBeVisible();
    await expect(paperStatus(page)).toHaveText('Layout1 | Viewport: 1:500');
    expect(errors).toEqual([]);
  });

  test('N(browser): Save Drawing round-trips the link and designations', async ({ page }) => {
    const errors: string[] = [];
    await gotoCad(page, errors);
    await openParcelNetworkDrawing(page, writeParcelNetworkFixture());
    const opened = await entityCount(page);

    const saved = await saveDrawingText(page);
    const parsed = parseCadDrawingFile(saved.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.sharedParcelBoundaries).toHaveLength(1);
    const reopenedLot1 = parsed.drawing.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === 'lot-1',
    );
    expect(reopenedLot1?.planInfo?.designation).toBe('Lot 1');

    await openParcelNetworkDrawing(page, path.join(saved.dir, 'drawing.wncad'));
    await expect.poll(() => entityCount(page)).toBe(opened);
    expect(errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Store-level flows — production engine seams the UI commits through.
// ---------------------------------------------------------------------------

test.describe('Phase 19D parcel network (store-level flows)', () => {
  test('A: PARCELNUMBER designates five lots; PARCELDESIGNATE sets roles + Properties', () => {
    const bare = buildSeedProject(true);
    const lotIds = ['lot-1', 'lot-2', 'lot-3', 'lot-4', 'lot-5'];
    const numbered = runCadCommand(createCadHistoryState(bare, lotIds), {
      key: 'PARCELNUMBER',
      parcelEntityIds: lotIds,
      numbering: { prefix: 'Lot', start: 1 },
      role: 'lot',
    });
    expect(numbered.undoStack.length).toBe(1);
    let project = numbered.present.project;
    for (const [index, id] of lotIds.entries()) {
      expect(parcelOf(project, id).planInfo?.designation).toBe(`Lot ${index + 1}`);
      expect(parcelOf(project, id).planInfo?.role).toBe('lot');
    }
    // Duplicate lot designation blocks fail-closed without explicit confirm.
    const duplicate = runCadCommand(createCadHistoryState(project, ['lot-2']), {
      key: 'PARCELDESIGNATE',
      parcelEntityIds: ['lot-2'],
      designation: 'Lot 1',
      role: 'lot',
    });
    expect(duplicate.undoStack.length).toBe(0);

    const remainder = runCadCommand(createCadHistoryState(project, ['remainder-a']), {
      key: 'PARCELDESIGNATE',
      parcelEntityIds: ['remainder-a'],
      designation: 'Remainder A',
      role: 'remainder',
    });
    project = remainder.present.project;
    const state = buildCadPropertiesPanelState(project, [parcelOf(project, 'lot-1')]);
    if (!state || state.mode !== 'single') throw new Error('parcel Properties missing');
    expect(state.entity.properties.find((row) => row.label === 'Plan Designation')?.value).toBe('Lot 1');
    expect(state.entity.properties.find((row) => row.label === 'Plan Role')?.value).toBe('Lot');
  });

  test('B: schedule carries exact areas per role with an arithmetic total', () => {
    const schedule = buildCadParcelSchedule(buildSeedProject(), Object.keys(EXPECTED_AREAS));
    for (const row of schedule.rows) {
      expect(row.areaSquareMeters).toBeCloseTo(EXPECTED_AREAS[row.parcelId]!, 9);
      expect(row.status).toBe('OK');
    }
    expect(schedule.totals.parcelCount).toBe(8);
    expect(schedule.totals.areaSquareMeters).toBeCloseTo(6100, 9);
    expect(schedule.totals.arithmetic).toBe(true);
    // Totals are the row sum, never a union: the overlapping easement is
    // counted once per row by contract.
    const rowSum = schedule.rows.reduce((total, row) => total + row.areaSquareMeters, 0);
    expect(schedule.totals.areaSquareMeters).toBeCloseTo(rowSum, 12);
    expect(schedule.rows.find((row) => row.parcelId === 'lot-1')?.designation).toBe('Lot 1');
    expect(schedule.rows.find((row) => row.parcelId === 'lot-1')?.role).toBe('lot');
    expect(schedule.rows.find((row) => row.parcelId === 'easement-e1')?.role).toBe('easement');
  });

  test('C: PARCELLINK on the straight shared edge resolves CURRENT', () => {
    const project = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    const boundaries = readCadParcelSharedBoundaries(project);
    expect(boundaries).toHaveLength(1);
    expect(deriveCadParcelSharedBoundaryStatus(project, boundaries[0]!)).toBe('CURRENT');
    // Deterministic id: reversed mint agrees.
    expect(
      linkIdOf(buildSeedProject(), { parcelId: 'lot-2', courseIndex: 3 }, { parcelId: 'lot-1', courseIndex: 1 }),
    ).toBe(boundaries[0]!.id);
  });

  test('D: shared-arc edit keeps reverse-bulge parity CURRENT on both sides', () => {
    const linked = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-3', courseIndex: 1 },
      { parcelId: 'lot-4', courseIndex: 3 },
    );
    const linkId = readCadParcelSharedBoundaries(linked)[0]!.id;
    const before = cadBuildParcelClosureSummary(parcelOf(linked, 'lot-3').vertices, {});
    const edited = runCadCommand(createCadHistoryState(linked, []), {
      key: 'PARCELSHAREDEDIT',
      linkId,
      edit: { kind: 'course-geometry', geometry: { kind: 'arc', bulge: 0.1 } },
    });
    expect(edited.undoStack.length).toBe(1);
    const project = edited.present.project;
    const boundaries = readCadParcelSharedBoundaries(project);
    expect(deriveCadParcelSharedBoundaryStatus(project, boundaries[0]!)).toBe('CURRENT');
    const geoA = parcelOf(project, 'lot-3').courseGeometry?.[1];
    const geoB = parcelOf(project, 'lot-4').courseGeometry?.[3];
    expect(geoA).toEqual({ kind: 'arc', bulge: 0.1 });
    expect(geoB).toEqual({ kind: 'arc', bulge: -0.1 });
    // Same physical curve: total area is conserved across the pair.
    const afterA = cadBuildParcelClosureSummary(parcelOf(project, 'lot-3').vertices, {
      courseGeometry: parcelOf(project, 'lot-3').courseGeometry,
    });
    const afterB = cadBuildParcelClosureSummary(parcelOf(project, 'lot-4').vertices, {
      courseGeometry: parcelOf(project, 'lot-4').courseGeometry,
    });
    expect(afterA!.areaSquareMeters + afterB!.areaSquareMeters).toBeCloseTo(before!.areaSquareMeters + 600, 6);
  });

  test('E: wrong-geometry, same-parcel, and duplicate links are blocked', () => {
    const project = buildSeedProject();
    const blockedSouth = runCadCommand(createCadHistoryState(project, []), {
      key: 'PARCELLINK',
      first: { parcelId: 'lot-1', courseId: courseIdOf(project, 'lot-1', 0) },
      second: { parcelId: 'lot-3', courseId: courseIdOf(project, 'lot-3', 0) },
    });
    expect(blockedSouth.undoStack.length).toBe(0);
    expect(readCadParcelSharedBoundaries(blockedSouth.present.project)).toHaveLength(0);

    const linked = linkCourses(
      project,
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    // Duplicate mint blocked (one-course-one-neighbor).
    const duplicate = runCadCommand(createCadHistoryState(linked, []), {
      key: 'PARCELLINK',
      first: { parcelId: 'lot-2', courseId: courseIdOf(linked, 'lot-2', 3) },
      second: { parcelId: 'lot-1', courseId: courseIdOf(linked, 'lot-1', 1) },
    });
    expect(duplicate.undoStack.length).toBe(0);
    // Same parcel both sides blocked.
    const sameParcel = runCadCommand(createCadHistoryState(linked, []), {
      key: 'PARCELLINK',
      first: { parcelId: 'lot-1', courseId: courseIdOf(linked, 'lot-1', 0) },
      second: { parcelId: 'lot-1', courseId: courseIdOf(linked, 'lot-1', 2) },
    });
    expect(sameParcel.undoStack.length).toBe(0);
  });

  test('F: generic one-sided grip edit on a linked course is BLOCKED', () => {
    const linked = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    // Vertex 1 (20,0) touches linked course 1: blocked, zero mutation.
    const before = JSON.stringify(parcelOf(linked, 'lot-1').vertices);
    const blocked = runCadCommand(createCadHistoryState(linked, ['lot-1']), {
      key: 'GRIP_EDIT',
      entityId: 'lot-1',
      gripKind: 'vertex',
      x: 21,
      y: 0,
      vertexIndex: 1,
    });
    expect(blocked.undoStack.length).toBe(0);
    expect(JSON.stringify(parcelOf(blocked.present.project, 'lot-1').vertices)).toBe(before);
    // Vertex 0 (0,0) touches no linked course: allowed.
    const allowed = runCadCommand(createCadHistoryState(linked, ['lot-1']), {
      key: 'GRIP_EDIT',
      entityId: 'lot-1',
      gripKind: 'vertex',
      x: -1,
      y: 0,
      vertexIndex: 0,
    });
    expect(allowed.undoStack.length).toBe(1);
    // Course conversion on a linked course is likewise blocked.
    const conversion = runCadCommand(createCadHistoryState(linked, ['lot-1']), {
      key: 'PARCELCOURSELINE',
      parcelEntityId: 'lot-1',
      courseId: courseIdOf(linked, 'lot-1', 1),
    });
    expect(conversion.undoStack.length).toBe(0);
  });

  test('G: PARCELSHAREDEDIT moves the shared endpoint on BOTH parcels atomically', () => {
    const linked = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    const linkId = readCadParcelSharedBoundaries(linked)[0]!.id;
    const edited = runCadCommand(createCadHistoryState(linked, []), {
      key: 'PARCELSHAREDEDIT',
      linkId,
      edit: { kind: 'move-endpoint', end: 'to', x: 20, y: 32 },
    });
    expect(edited.undoStack.length).toBe(1);
    const project = edited.present.project;
    // One transaction moved both sides to the same point; the link is CURRENT.
    expect(parcelOf(project, 'lot-1').vertices).toContainEqual({ x: 20, y: 32 });
    expect(parcelOf(project, 'lot-2').vertices).toContainEqual({ x: 20, y: 32 });
    const boundaries = readCadParcelSharedBoundaries(project);
    expect(boundaries).toHaveLength(1);
    expect(deriveCadParcelSharedBoundaryStatus(project, boundaries[0]!)).toBe('CURRENT');
    expect(parcelOf(project, 'lot-1').areaSquareMeters).toBeCloseTo(620, 9);
    expect(parcelOf(project, 'lot-2').areaSquareMeters).toBeCloseTo(620, 9);
    // Undo restores both parcels in one step.
    const undone = undoCadHistory(edited);
    expect(parcelOf(undone.present.project, 'lot-1').areaSquareMeters).toBeCloseTo(600, 9);
    expect(parcelOf(undone.present.project, 'lot-2').areaSquareMeters).toBeCloseTo(600, 9);
    expect(readCadParcelSharedBoundaries(undone.present.project)).toHaveLength(1);
  });

  test('H: group move needs the whole linked component; partial selection blocks', () => {
    const linked = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    const partial = runCadCommand(createCadHistoryState(linked, ['lot-1']), {
      key: 'MOVE',
      deltaX: 10,
      deltaY: 0,
    });
    expect(partial.undoStack.length).toBe(0);
    const whole = runCadCommand(createCadHistoryState(linked, ['lot-1', 'lot-2']), {
      key: 'MOVE',
      deltaX: 10,
      deltaY: 0,
    });
    expect(whole.undoStack.length).toBe(1);
    const project = whole.present.project;
    expect(parcelOf(project, 'lot-1').vertices[0]).toEqual({ x: 10, y: 0 });
    expect(parcelOf(project, 'lot-2').vertices[0]).toEqual({ x: 30, y: 0 });
    const boundaries = readCadParcelSharedBoundaries(project);
    expect(deriveCadParcelSharedBoundaryStatus(project, boundaries[0]!)).toBe('CURRENT');
  });

  test('I: ERASE drops attached links atomically; neighbor geometry untouched; undo restores', () => {
    const linked = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    const neighborBefore = JSON.stringify(parcelOf(linked, 'lot-2'));
    const erased = runCadCommand(createCadHistoryState(linked, ['lot-1']), { key: 'ERASE' });
    expect(erased.undoStack.length).toBe(1);
    expect(erased.present.project.entities.some((entity) => entity.id === 'lot-1')).toBe(false);
    expect(readCadParcelSharedBoundaries(erased.present.project)).toHaveLength(0);
    expect(JSON.stringify(parcelOf(erased.present.project, 'lot-2'))).toBe(neighborBefore);
    const undone = undoCadHistory(erased);
    expect(undone.present.project.entities.some((entity) => entity.id === 'lot-1')).toBe(true);
    const boundaries = readCadParcelSharedBoundaries(undone.present.project);
    expect(boundaries).toHaveLength(1);
    expect(deriveCadParcelSharedBoundaryStatus(undone.present.project, boundaries[0]!)).toBe('CURRENT');
  });

  test('J: COPY starts with zero links and drops the designation, keeping the role', () => {
    const linked = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    const copied = runCadCommand(createCadHistoryState(linked, ['lot-1']), {
      key: 'COPY',
      deltaX: 200,
      deltaY: 0,
    });
    expect(copied.undoStack.length).toBe(1);
    const project = copied.present.project;
    // No link minted for the clone: the source link is the only one.
    expect(readCadParcelSharedBoundaries(project)).toHaveLength(1);
    const clone = project.entities.find(
      (entity): entity is CadParcelEntity =>
        entity.type === 'parcel' && entity.id !== 'lot-1' && entity.parcelName === 'P-LOT1',
    );
    if (!clone) throw new Error('parcel copy missing');
    expect(clone.courseIds).not.toEqual(parcelOf(project, 'lot-1').courseIds);
    // Designation policy: designation never copies; role carries over.
    expect(clone.planInfo?.designation).toBeUndefined();
    expect(clone.planInfo?.role).toBe('lot');
    // A second "Lot 1" can never collide because the clone has no designation.
    expect(clone.planInfo?.designation).not.toBe('Lot 1');
  });

  test('K: PARCELCHECK reports unlinked exact, point touch, and primary overlap', () => {
    const linked = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    const checked = runCadCommand(createCadHistoryState(linked, []), { key: 'PARCELCHECK' });
    expect(checked.undoStack.length).toBe(1);
    expect(checked.commandState.prompt).toContain('PARCELCHECK');

    const network = buildParcelNetwork(linked, readCadParcelSharedBoundaries(linked).map((boundary) => ({
      first: { ...boundary.first },
      second: { ...boundary.second },
    })));
    const report = buildCadParcelNetworkReport(linked, network);
    // Unlinked exact course (lot-4 <-> lot-5) is a WARNING, never silent.
    const unlinked = network.pairs.find(
      (pair) =>
        (pair.firstParcelId === 'lot-4' && pair.secondParcelId === 'lot-5') ||
        (pair.firstParcelId === 'lot-5' && pair.secondParcelId === 'lot-4'),
    );
    expect(unlinked?.relation).toBe('GEOMETRIC_SHARED_COURSE');
    expect(unlinked?.sharedLengthMeters).toBeCloseTo(30, 9);
    expect(network.findings.some((finding) => finding.code === 'UNLINKED_SHARED_COURSE')).toBe(true);
    // Corner-only contact (lot-5 <-> remainder at (100,30)) is POINT_TOUCH.
    expect(
      network.pairs.some(
        (pair) =>
          pair.relation === 'POINT_TOUCH' &&
          ((pair.firstParcelId === 'lot-5' && pair.secondParcelId === 'remainder-a') ||
            (pair.firstParcelId === 'remainder-a' && pair.secondParcelId === 'lot-5')),
      ),
    ).toBe(true);
    // Primary overlap (a lot partially covering two lots) is an ERROR.
    const overlapProject = buildSeedProject();
    overlapProject.entities.push(
      makeSeedParcel({
        id: 'lot-x',
        parcelName: 'P-LOTX',
        designation: 'Lot X',
        role: 'lot',
        vertices: [[10, 0], [30, 0], [30, 30], [10, 30]],
      }),
    );
    const overlapNetwork = buildParcelNetwork(overlapProject);
    const primary = overlapNetwork.findings.find((finding) => finding.code === 'PRIMARY_OVERLAP');
    expect(primary?.severity).toBe('ERROR');
    expect(report.summary.linkedPairCount).toBe(1);
  });

  test('L: easement overlay is INFO, never a primary lot-conflict', () => {
    const project = buildSeedProject();
    const network = buildParcelNetwork(project);
    const pair = network.pairs.find(
      (entry) =>
        (entry.firstParcelId === 'easement-e1' && entry.secondParcelId === 'lot-1') ||
        (entry.firstParcelId === 'lot-1' && entry.secondParcelId === 'easement-e1'),
    );
    expect(pair?.relation).toBe('AREA_OVERLAP');
    expect(pair?.overlapAreaSquareMeters).toBeCloseTo(150, 9);
    const overlay = network.findings.find((finding) => finding.code === 'OVERLAY_INTERSECTION');
    expect(overlay?.severity).toBe('INFO');
    // No primary conflict is raised for the easement/lot overlap.
    expect(
      network.findings.some(
        (finding) =>
          finding.code === 'PRIMARY_OVERLAP' &&
          finding.parcelIds.includes('easement-e1'),
      ),
    ).toBe(false);
  });

  test('M: schedule derives live values after a geometry change', () => {
    const project = buildSeedProject();
    const before = buildCadParcelSchedule(project, ['lot-5']);
    expect(before.rows[0]!.areaSquareMeters).toBeCloseTo(600, 9);
    // Unlinked corner (100,30) moves out: area grows, next derive reflects it.
    const moved = runCadCommand(createCadHistoryState(project, ['lot-5']), {
      key: 'GRIP_EDIT',
      entityId: 'lot-5',
      gripKind: 'vertex',
      x: 110,
      y: 35,
      vertexIndex: 2,
    });
    expect(moved.undoStack.length).toBe(1);
    const after = buildCadParcelSchedule(moved.present.project, ['lot-5']);
    expect(after.rows[0]!.areaSquareMeters).toBeGreaterThan(600);
    const full = buildCadParcelSchedule(moved.present.project, Object.keys(EXPECTED_AREAS));
    const rowSum = full.rows.reduce((total, row) => total + row.areaSquareMeters, 0);
    expect(full.totals.areaSquareMeters).toBeCloseTo(rowSum, 12);
  });

  test('N(store): save/reopen keeps links, designations, and ids byte-exact', () => {
    const document = createBlankCadDrawingDocument({ name: 'Parcel Network QA 19D', units: 'm' });
    const project = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    const parsed = parseCadDrawingFile(
      serializeCadDrawingFile({ ...document, project }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(reopened.sharedParcelBoundaries).toEqual(readCadParcelSharedBoundaries(project));
    for (const def of SEED_DEFS) {
      const before = parcelOf(project, def.id);
      const afterParcel = parcelOf(reopened, def.id);
      expect(afterParcel.courseIds).toEqual(before.courseIds);
      expect(afterParcel.courseGeometry).toEqual(before.courseGeometry);
      expect(afterParcel.planInfo).toEqual(before.planInfo);
      expect(afterParcel.areaSquareMeters).toBeCloseTo(before.areaSquareMeters ?? 0, 9);
    }
    // WNCAD disposition is explicit: the link store and plan info are
    // authoritative fields of the round-trip, not derived views.
    expect(reopened.sharedParcelBoundaries?.[0]?.id).toContain('parcel-shared:');
  });

  test('O: MOVE/ROTATE/SCALE over the whole linked pair keep line+arc CURRENT', () => {
    const linked = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    const linkId = readCadParcelSharedBoundaries(linked)[0]!.id;
    const curved = runCadCommand(createCadHistoryState(linked, []), {
      key: 'PARCELSHAREDEDIT',
      linkId,
      edit: { kind: 'course-geometry', geometry: { kind: 'arc', bulge: 0.05 } },
    });
    const pair = ['lot-1', 'lot-2'];
    for (const command of [
      { key: 'MOVE', deltaX: 50, deltaY: 25 },
      { key: 'ROTATE', baseX: 0, baseY: 0, angleDeg: 90 },
      { key: 'SCALE', baseX: 0, baseY: 0, factor: 2 },
    ] as const) {
      const moved = runCadCommand(
        createCadHistoryState(curved.present.project, pair),
        command as unknown as Parameters<typeof runCadCommand>[1],
      );
      expect(moved.undoStack.length).toBe(1);
      const boundaries = readCadParcelSharedBoundaries(moved.present.project);
      expect(boundaries).toHaveLength(1);
      expect(deriveCadParcelSharedBoundaryStatus(moved.present.project, boundaries[0]!)).toBe('CURRENT');
    }
    const scaled = runCadCommand(
      createCadHistoryState(curved.present.project, pair),
      { key: 'SCALE', baseX: 0, baseY: 0, factor: 2 },
    );
    expect(parcelOf(scaled.present.project, 'lot-1').areaSquareMeters).toBeCloseTo(
      (parcelOf(curved.present.project, 'lot-1').areaSquareMeters ?? 0) * 4,
      6,
    );
  });

  test('P(store): lots + remainder + easement + ROW + schedule render in the 19B model scene', () => {
    const project = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    // The schedule rides the existing parcel-summary table path (the
    // dedicated parcel-schedule table kind is deferred by design): one
    // PARCELREPORT per lot plus a remainder schedule row set.
    let state = createCadHistoryState(project, ['lot-1']);
    for (const id of ['lot-1', 'lot-2', 'lot-3', 'lot-4', 'lot-5', 'remainder-a']) {
      state = runCadCommand(createCadHistoryState(state.present.project, [id]), {
        key: 'PARCELREPORT',
        parcelEntityId: id,
        insertX: 120,
        insertY: 0,
      });
    }
    const withTables = state.present.project;
    const document: CadDrawingDocument = {
      ...createBlankCadDrawingDocument({ name: 'Parcel Network QA 19D', units: 'm' }),
      project: withTables,
    };
    const draft = document.draft;
    if (!draft) throw new Error('blank drawing has no draft');
    const withSheet = addSheetToDraft(
      draft,
      createPlanSheet({ name: 'A-101', sizeId: 'ISO A3', orientation: 'landscape' }),
    );
    const sheet = withSheet.sheets[withSheet.sheets.length - 1];
    if (!sheet) throw new Error('sheet not created');
    const withViewport = addViewportToSheet(withSheet, sheet.id, {
      name: 'VP-1',
      modelCenterX: 50,
      modelCenterY: 29,
      scaleDenominator: 500,
      paperXmm: 60,
      paperYmm: 40,
      paperWidthMm: 300,
      paperHeightMm: 200,
      rotationDeg: 0,
    });
    // No paper-space topology math: the normal 19B scene path projects the
    // model parcels and their summary tables exactly as drawn.
    const scene = buildExportSheetSceneWithResult({ draft: withViewport, sheetId: sheet.id, project: withTables });
    for (const id of Object.keys(EXPECTED_AREAS)) {
      expect(scene.exportedEntityIds).toContain(id);
    }
    const tableIds = withTables.entities
      .filter((entity) => entity.type === 'survey-table')
      .map((entity) => entity.id);
    expect(tableIds.length).toBe(6);
    for (const tableId of tableIds) {
      expect(scene.exportedEntityIds).toContain(tableId);
    }
  });

  test('Q: SVG/PDF/DXF/LandXML stay honest; WNCAD is the authoritative round-trip', () => {
    const linked = linkCourses(
      buildSeedProject(),
      { parcelId: 'lot-1', courseIndex: 1 },
      { parcelId: 'lot-2', courseIndex: 3 },
    );
    // One curved edge so DXF/LandXML take the exact-arc path.
    const linkId = readCadParcelSharedBoundaries(linked)[0]!.id;
    const curved = runCadCommand(createCadHistoryState(linked, []), {
      key: 'PARCELSHAREDEDIT',
      linkId,
      edit: { kind: 'course-geometry', geometry: { kind: 'arc', bulge: 0.05 } },
    });
    const project = curved.present.project;
    const document: CadDrawingDocument = {
      ...createBlankCadDrawingDocument({ name: 'Parcel Network QA 19D', units: 'm' }),
      project,
    };
    const draft = document.draft;
    if (!draft) throw new Error('blank drawing has no draft');
    const withSheet = addSheetToDraft(
      draft,
      createPlanSheet({ name: 'A-101', sizeId: 'ISO A3', orientation: 'landscape' }),
    );
    const sheet = withSheet.sheets[withSheet.sheets.length - 1];
    if (!sheet) throw new Error('sheet not created');
    const withViewport = addViewportToSheet(withSheet, sheet.id, {
      name: 'VP-1',
      modelCenterX: 50,
      modelCenterY: 29,
      scaleDenominator: 500,
      paperXmm: 60,
      paperYmm: 40,
      paperWidthMm: 300,
      paperHeightMm: 200,
      rotationDeg: 0,
    });
    const scene = buildExportSheetSceneWithResult({ draft: withViewport, sheetId: sheet.id, project });

    // SVG/PDF: full model geometry + area labels; no relationship lines.
    const svg = serializeExportSceneToSvgWithResult(scene.output).output;
    expect(svg).toContain('m²');
    for (const id of ['lot-1', 'lot-2']) {
      expect(scene.exportedEntityIds).toContain(id);
    }
    const svgText = svg.toLowerCase();
    expect(svgText).not.toContain('parcel-shared');
    expect(svgText).not.toContain('relationship');
    const pdf = new TextDecoder().decode(exportScenesToPdfWithResult([scene.output]).output);
    expect(pdf.length).toBeGreaterThan(0);

    // DXF: exact LINE + ARC primitives via the existing parcel path with the
    // geometric-only warning; the relationship is NOT_APPLICABLE on export.
    const dxf = buildDxfExportModelWithResult({ project });
    expect(dxf.output.arcs.length).toBeGreaterThan(0);
    expect(dxf.output.polylines.length).toBeGreaterThan(0);
    expect(
      dxf.warnings.some((warning) =>
        warning.message.includes('approximated as line/arc primitives'),
      ),
    ).toBe(true);
    expect(JSON.stringify(dxf.output).toLowerCase()).not.toContain('parcel-shared');

    // LandXML: parcelName rings + exact Curve segments; the plan designation
    // has no safe schema field and is omitted (never smuggled into a legal
    // field); relationships are NOT_APPLICABLE.
    const xml = buildLandXmlProjectExportWithResult(project, {
      units: 'm',
      projectName: 'parcel-network-19d',
    });
    expect(xml.output).toContain('<Parcel');
    expect(xml.output).toContain('P-LOT1');
    expect(xml.output).not.toContain('Lot 1');
    expect(xml.output).toContain('<Curve');
    expect(xml.output.toLowerCase()).not.toContain('shared');
    expect(xml.output.toLowerCase()).not.toContain('relationship');
    expect(
      xml.warnings.some((warning) => /Parcel ring/.test(warning.message)),
    ).toBe(true);

    // WNCAD: authoritative — links + designations + ids survive exactly (N).
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.sharedParcelBoundaries).toEqual(
      readCadParcelSharedBoundaries(project),
    );
    expect(
      parsed.drawing.project.entities.find(
        (entity): entity is CadParcelEntity => entity.id === 'lot-1',
      )?.planInfo,
    ).toEqual(parcelOf(project, 'lot-1').planInfo);
  });
});
