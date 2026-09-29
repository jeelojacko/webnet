/**
 * Phase 20B visual QA — grading site plan captured at 1366×768, 1920×1080,
 * and 2560×1440.
 *
 * Every view attaches to the test report (CI-safe). When WRITE_20B_EVIDENCE=1
 * the same PNGs are also written to docs/evidence/phase20b/ for the
 * visual-qa.md record.
 *
 * The scene is built through the production seams (PARCEL_CREATE,
 * GRADING_CREATE / GRADINGBAKE commands, WNCAD file loader): flat EG surface
 * (integer corners, z=0), building-pad feature lines with integer courses, a
 * cut edge below EG, a fill edge above EG, a cut/fill definition, an arc
 * (curved) source course, a void target, parcel context, and a pre-baked
 * C-101 sheet drawing. All grading ties land on integer coordinates so the
 * worker agreement gate (zeroDelta floor) passes deterministically —
 * fractional tie nodes fail-closed on dense TINs (see phase20b perf
 * evidence); the captures below prove the success path renders.
 *
 * Views: model site, manager definitions, fill CURRENT, cut CURRENT,
 * cut/fill CURRENT, curved-source state, void FAILED, stale NEEDS_RECALC,
 * baked surface, C-101 sheet plan.
 */
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import type {
  CadFeatureLineEntity,
  CadLineEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import {
  addSheetToDraft,
  addViewportToSheet,
  assignTitleBlockToSheet,
  createPlanSheet,
  createTitleBlockTemplate,
} from '../src/engine/cad/cadSheets';
import {
  addSheetObject,
  defaultNorthArrowObject,
  defaultScaleBarObject,
} from '../src/engine/cad/cadSheetObjects';
import {
  entityCount,
  gotoCad,
  homeTab,
  openSurveyPlanDrawing,
} from './cad-survey-plan-19a-helpers';
import { layoutTab, sheetGeometryCount } from './cad-sheet-layout-19b-helpers';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/evidence/phase20b');
const WRITE_EVIDENCE = process.env.WRITE_20B_EVIDENCE === '1';
/** CAD-standard signed bulge for a 90° minor arc. */
const ARC_BULGE = Math.tan(Math.PI / 8);

const pt = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id, type: 'survey-point', layerId: 'general', visible: true, locked: false,
  stationId, x, y, z, pointClass: 'free', source: 'parsed-input',
});

const line = (id: string, fx: number, fy: number, tx: number, ty: number): CadLineEntity => ({
  id, type: 'line', layerId: 'general', visible: true, locked: false,
  fromStationId: `${id}-a`, toStationId: `${id}-b`,
  fromX: fx, fromY: fy, toX: tx, toY: ty, sourceObservationIds: [],
});

const featureLine = (
  id: string, name: string, verts: Array<{ id: string; x: number; y: number; z: number }>,
  segmentGeometry?: Array<{ kind: 'line' } | { kind: 'arc'; bulge: number }>,
): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'feature-lines', visible: true, locked: false,
  name, vertices: verts, ...(segmentGeometry ? { segmentGeometry } : {}),
});

/** Site plan project: flat EG + pad edges + curved swale + parcel + gradings. */
const buildSiteProject = (): CadProject => {
  const document = createBlankCadDrawingDocument({ name: 'Grading Site 20B', units: 'm' });
  const eg: CadSurface = {
    id: 'srf-eg', name: 'EG',
    definition: { pointSource: { kind: 'points', pointEntityIds: ['eg-sw', 'eg-se', 'eg-ne', 'eg-nw'] } },
  };
  const far: CadSurface = {
    id: 'srf-far', name: 'Far',
    definition: {
      sourceKind: 'explicit-tin',
      pointSource: { kind: 'points', pointEntityIds: [] },
      importedTin: {
        vertices: [500, 500, 0, 600, 500, 0, 600, 600, 0, 500, 600, 0],
        faces: [0, 1, 2, 0, 2, 3],
        provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
      },
    },
    cachedRevision: null,
  };
  const base: CadProject = {
    ...document.project,
    entities: [
      pt('eg-sw', 'EG1', 0, 0, 0),
      pt('eg-se', 'EG2', 120, 0, 0),
      pt('eg-ne', 'EG3', 120, 60, 0),
      pt('eg-nw', 'EG4', 0, 60, 0),
      line('lot:south', -10, -10, 130, -10),
      line('lot:east', 130, -10, 130, 70),
      line('lot:north', 130, 70, -10, 70),
      line('lot:west', -10, 70, -10, -10),
      featureLine('fl-south', 'Pad south edge', [
        { id: 'vS0', x: 30, y: 25, z: 10 }, { id: 'vS1', x: 70, y: 25, z: 10 },
      ]),
      featureLine('fl-north', 'Cut edge', [
        { id: 'vN0', x: 30, y: 35, z: -10 }, { id: 'vN1', x: 70, y: 35, z: -10 },
      ]),
      featureLine('fl-curve', 'Swale', [
        { id: 'vC0', x: 20, y: 40, z: 10 },
        { id: 'vC1', x: 60, y: 40, z: 10 },
        { id: 'vC2', x: 80, y: 20, z: 10 },
      ], [{ kind: 'line' }, { kind: 'arc', bulge: ARC_BULGE }]),
    ],
    surfaces: [eg, far],
  };
  let history = runCadCommand(createCadHistoryState(base, []), {
    key: 'PARCEL_CREATE',
    sourceEntityIds: ['lot:south', 'lot:east', 'lot:north', 'lot:west'],
  });
  const grading = (
    name: string, flId: string, a: string, b: string, target: string,
    side: 'left' | 'right', criterion: { kind: 'fixed'; gradeRatio: number } | { kind: 'cut-fill'; cutGradeRatio: number; fillGradeRatio: number },
    tolerance: number,
  ): void => {
    history = runCadCommand(history, {
      key: 'GRADING_CREATE',
      name, sourceFeatureLineId: flId, vertexAId: a, vertexBId: b,
      targetSurfaceId: target, side, criterion,
      maxSearchDistance: 30, curveChordTolerance: tolerance,
    });
  };
  // Fill: pad edge above EG, outward (right = south), -0.5 → tie y=-5.
  grading('Pad fill', 'fl-south', 'vS0', 'vS1', 'srf-eg', 'right', { kind: 'fixed', gradeRatio: -0.5 }, 0.01);
  // Cut: edge below EG, outward (left = north), +0.5 → tie y=55.
  grading('Pad cut', 'fl-north', 'vN0', 'vN1', 'srf-eg', 'left', { kind: 'fixed', gradeRatio: 0.5 }, 0.01);
  // Cut/fill on flat EG (all FILL): single-span daylight, integer nodes.
  grading('Pad cutfill', 'fl-south', 'vS0', 'vS1', 'srf-eg', 'right', { kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -0.5 }, 0.01);
  // Curved source (arc course vC1->vC2), coarse tolerance.
  grading('Swale curve', 'fl-curve', 'vC1', 'vC2', 'srf-eg', 'left', { kind: 'fixed', gradeRatio: -0.5 }, 0.5);
  // Void target: fixed grade against the far mesh → fail-closed NO_SOLUTION.
  grading('Void probe', 'fl-south', 'vS0', 'vS1', 'srf-far', 'right', { kind: 'fixed', gradeRatio: -0.5 }, 0.01);
  return history.present.project;
};

const writeDrawing = (project: CadProject, name: string): string => {
  const document = createBlankCadDrawingDocument({ name, units: 'm' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-20b-vis-'));
  const filePath = path.join(dir, `${name}.wncad`);
  fs.writeFileSync(filePath, serializeCadDrawingFile({ ...document, project }), 'utf8');
  return filePath;
};

/** Sheet drawing with a pre-baked fill strip (proves bake→surface→sheet). */
const writeSheetDrawing = (): string => {
  const project = buildSiteProject();
  const gradingId = project.gradings!.find((g) => g.name === 'Pad fill')!.id;
  const inputs = resolveGradingInputs(project, gradingId);
  if (!inputs) throw new Error('fill inputs unresolvable');
  const target = project.surfaces!.find((s) => s.id === inputs.target.id)!;
  const built = buildCadSurface(project, target);
  if (built.outcome !== 'ok') throw new Error('EG build failed');
  const outcome = computeGradingFromSnapshots({
    gradingId, revision: inputs.revision,
    source: inputs.resolvedSource, side: inputs.grading.side,
    criterion: inputs.grading.criterion, maxSearchDistance: inputs.grading.maxSearchDistance,
    curveChordTolerance: inputs.grading.curveChordTolerance,
    target: {
      points: built.points.flatMap((p) => [p.x, p.y, p.z]),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error('fill bake-season compute failed');
  const history = runCadCommand(createCadHistoryState(project), {
    key: 'GRADINGBAKE', gradingId, result: outcome.result,
    expectedRevision: inputs.revision, sessionCurrent: true,
  });
  const document = createBlankCadDrawingDocument({ name: 'Grading Sheet 20B', units: 'm' });
  const draft = document.draft;
  if (!draft) throw new Error('blank drawing has no draft');
  const withSheet = addSheetToDraft(
    draft, createPlanSheet({ name: 'C-101', sizeId: 'ISO A3', orientation: 'landscape' }),
  );
  const sheet = withSheet.sheets[withSheet.sheets.length - 1];
  if (!sheet) throw new Error('sheet not created');
  const withViewport = addViewportToSheet(withSheet, sheet.id, {
    name: 'VP-1', modelCenterX: 60, modelCenterY: 25, scaleDenominator: 500,
    paperXmm: 30, paperYmm: 30, paperWidthMm: 330, paperHeightMm: 210, rotationDeg: 0,
  });
  const viewport = withViewport.sheets.find((entry) => entry.id === sheet.id)?.viewports.at(-1);
  if (!viewport) throw new Error('viewport not created');
  let next = addSheetObject(withViewport, sheet.id, defaultNorthArrowObject(viewport));
  next = addSheetObject(next, sheet.id, defaultScaleBarObject(viewport));
  const template = createTitleBlockTemplate('TB-C101');
  next = { ...next, titleBlockDefinitions: [...next.titleBlockDefinitions, template] };
  next = assignTitleBlockToSheet(next, sheet.id, template.id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-20b-vis-'));
  const filePath = path.join(dir, 'grading-sheet-20b.wncad');
  fs.writeFileSync(
    filePath,
    serializeCadDrawingFile({ ...document, project: history.present.project, draft: next }),
    'utf8',
  );
  return filePath;
};

const capture = async (
  page: Page, testInfo: TestInfo, name: string, target?: Locator,
): Promise<void> => {
  const body = target ? await target.screenshot() : await page.screenshot({ fullPage: false });
  await testInfo.attach(name, { body, contentType: 'image/png' });
  if (WRITE_EVIDENCE) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const size = page.viewportSize();
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${size?.width}x${size?.height}.png`), body);
  }
};

const openGradingManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-command="GRADING"]').click();
  await expect(page.locator('[data-cad-grading-table]')).toBeVisible({ timeout: 15000 });
};

function ribbonTab(page: Page, name: string) {
  return page.locator('[aria-label="Ribbon tabs"]').getByRole('tab', { name });
}

function surfaceManagerScope(page: Page) {
  return page.locator('section[aria-label="Surface manager"]');
}

function toolspaceSurface(page: Page, id: string) {
  return page.locator(`[data-cad-toolspace] [data-cad-surface="${id}"]`);
}

async function surfaceStatus(page: Page, id: string): Promise<string> {
  return (await toolspaceSurface(page, id).getAttribute('data-cad-surface-status')) ?? '';
}

/** Collapse the floating properties overlay so dock clicks land. */
async function collapseFloatingPanel(page: Page): Promise<void> {
  const collapse = page.locator('button[title="Collapse panel body"]');
  if (await collapse.isVisible().catch(() => false)) await collapse.click();
}

/** Rebuild a seeded surface through the shipped Surface manager. */
async function rebuildSurface(page: Page, surfaceName: string, surfaceId: string): Promise<void> {
  await ribbonTab(page, 'Surface').click();
  // The manager opens on the Add Point Group affordance (18G pattern).
  await page.getByRole('button', { name: 'Add Point Group' }).first().click();
  const manager = surfaceManagerScope(page);
  await expect(manager).toBeVisible({ timeout: 10000 });
  await manager.locator('ul button', { hasText: surfaceName }).click();
  await manager.getByRole('button', { name: 'Rebuild', exact: true }).click();
  // Surfaces tree lives on the Survey Toolspace tab (18G pattern).
  await page.locator('[aria-label="Toolspace tabs"]').getByRole('tab', { name: 'Survey' }).click();
  await expect(toolspaceSurface(page, surfaceId)).toBeVisible({ timeout: 15000 });
  await expect.poll(() => surfaceStatus(page, surfaceId), { timeout: 60000 }).toBe('CURRENT');
}

const rowText = (page: Page, id: string): (() => Promise<string>) =>
  () => page.locator(`[data-cad-grading-row="${id}"]`).innerText();

const calculateAndWait = async (
  page: Page, gradingId: string, want: RegExp,
): Promise<string> => {
  // Row actions render for the selected row only: select it first.
  await page.locator(`[data-cad-grading-row="${gradingId}"]`).click();
  await page.locator(`[data-cad-grading-actions="${gradingId}"] [data-cad-grading-calculate]`).click();
  await expect.poll(rowText(page, gradingId), { timeout: 60000 }).toMatch(want);
  return rowText(page, gradingId)();
};

const RESOLUTIONS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

for (const resolution of RESOLUTIONS) {
  test.describe(`Phase 20B visual QA @ ${resolution.width}x${resolution.height}`, () => {
    test.use({ viewport: { width: resolution.width, height: resolution.height } });

    test(`visual sweep ${resolution.width}x${resolution.height}`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      const errors: string[] = [];
      const siteProject = buildSiteProject();
      const gid = (name: string): string => {
        const found = siteProject.gradings!.find((g) => g.name === name);
        if (!found) throw new Error(`no grading named ${name}`);
        return found.id;
      };
      const G_FILL = gid('Pad fill');
      const G_CUT = gid('Pad cut');
      const G_CUTFILL = gid('Pad cutfill');
      const G_CURVE = gid('Swale curve');
      const G_VOID = gid('Void probe');
      const sitePath = writeDrawing(siteProject, 'grading-site-20b');

      // 1. Model site as opened: EG + pad edges + parcel context.
      await gotoCad(page, errors);
      await openSurveyPlanDrawing(page, sitePath);
      await expect.poll(() => entityCount(page), { timeout: 30000 }).toBeGreaterThan(0);
      await collapseFloatingPanel(page);
      await capture(page, testInfo, 'model-site');

      // 1b. Build seeded surfaces (UNBUILT on open) so grading can calculate.
      await rebuildSurface(page, 'EG', 'srf-eg');
      await rebuildSurface(page, 'Far', 'srf-far');
      await collapseFloatingPanel(page);

      // 2. Manager definitions before any calculation.
      await openGradingManager(page);
      await capture(page, testInfo, 'manager-definitions');

      // 3-5. Fill, cut, cut/fill → CURRENT.
      await calculateAndWait(page, G_FILL, /Current/);
      await capture(page, testInfo, 'fill-current');
      await calculateAndWait(page, G_CUT, /Current/);
      await capture(page, testInfo, 'cut-current');
      await calculateAndWait(page, G_CUTFILL, /Current/);
      await capture(page, testInfo, 'cutfill-current');

      // 6. Curved source: CURRENT+APPROXIMATED or honest FAILED — capture either.
      const curveStatus = await calculateAndWait(page, G_CURVE, /Current|Curve Approximated|Failed/);
      testInfo.annotations.push({ type: 'curve-status', description: curveStatus.split('\n')[0] ?? '' });
      await capture(page, testInfo, 'curve-state');

      // 7. Void target → fail-closed FAILED.
      await calculateAndWait(page, G_VOID, /Failed/);
      await capture(page, testInfo, 'void-failed');

      // 8. Stale: edit criteria (prompt-driven) → NEEDS_RECALC on fill.
      page.on('dialog', (dialog) => {
        const message = dialog.message();
        if (message.startsWith('Criterion')) void dialog.accept('percent');
        else if (message.startsWith('Fixed')) void dialog.accept('-2');
        else void dialog.dismiss();
      });
      await page.locator(`[data-cad-grading-row="${G_FILL}"]`).click();
      await page.locator(`[data-cad-grading-actions="${G_FILL}"] [data-cad-grading-edit-criteria]`).click();
      await expect.poll(rowText(page, G_FILL), { timeout: 30000 }).toMatch(/Needs Recalc/);
      await capture(page, testInfo, 'stale-state');

      // 9. Bake cut (still CURRENT) → new surface renders in the plan.
      // (Bake creates a surface, not an entity: poll the Toolspace tree.)
      const surfaceCount = (): Promise<number> =>
        page.locator('[data-cad-toolspace] [data-cad-surface]').count();
      const surfacesBefore = await surfaceCount();
      await page.locator(`[data-cad-grading-row="${G_CUT}"]`).click();
      await page.locator(`[data-cad-grading-actions="${G_CUT}"] [data-cad-grading-bake]`).click();
      await expect.poll(surfaceCount, { timeout: 30000 }).toBeGreaterThan(surfacesBefore);
      await capture(page, testInfo, 'baked-surface');

      // 10. C-101 sheet with the pre-baked fill strip. Meshes never persist
      // (UNBUILT on open), so rebuild EG + the baked strip in-session first.
      await openSurveyPlanDrawing(page, writeSheetDrawing());
      await rebuildSurface(page, 'EG', 'srf-eg');
      await ribbonTab(page, 'Surface').click();
      await page.getByRole('button', { name: 'Add Point Group' }).first().click();
      await expect(surfaceManagerScope(page)).toBeVisible({ timeout: 10000 });
      await surfaceManagerScope(page).locator('ul button', { hasText: 'Pad fill - Baked' }).click();
      await surfaceManagerScope(page).getByRole('button', { name: 'Rebuild', exact: true }).click();
      // Baked surface id is generated: poll for any non-seed surface CURRENT.
      await expect.poll(async () => {
        const rows = await page.$$eval(
          '[data-cad-toolspace] [data-cad-surface]',
          (elements) => elements.map((element) => [
            element.getAttribute('data-cad-surface'),
            element.getAttribute('data-cad-surface-status'),
          ]),
        );
        const baked = rows.find(([id]) => id !== null && !['srf-eg', 'srf-far'].includes(id!));
        return baked ? (baked[1] ?? '') : '';
      }, { timeout: 60000 }).toBe('CURRENT');
      await layoutTab(page, 'C-101').click({ timeout: 10000 });
      // Sparse grading scene (2-tri surfaces + pad + parcel): readiness is
      // viewport + title block + baked strip, not the 19C 20-item parcel plan.
      await expect.poll(() => sheetGeometryCount(page), { timeout: 15000 }).toBeGreaterThan(5);
      await capture(page, testInfo, 'sheet-plan');

      expect(errors).toEqual([]);
    });
  });
}
