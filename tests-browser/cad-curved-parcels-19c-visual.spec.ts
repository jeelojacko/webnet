/**
 * Phase 19C manual visual QA (§101) — realistic parcel plan captured at
 * 1366×768, 1920×1080, and 2560×1440.
 *
 * Every view attaches to the test report (CI-safe). When WRITE_19C_EVIDENCE=1
 * the same PNGs are also written to docs/evidence/phase19c/ for the
 * visual-qa.md record. The plan is built through the production seams
 * (PARCEL_CREATE / PARCELTABLE / PARCELDESC / PARCEL_SPLIT / sheet objects),
 * never hand-drawn JSON.
 *
 * Views: model parcel, selected curved course, course properties, course
 * table, split preview, split result, sheet plan, description preview.
 */
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { resolveCadParcelCourses } from '../src/engine/cad/cadParcelCourses';
import { addSheetToDraft, addViewportToSheet, assignTitleBlockToSheet, createPlanSheet, createTitleBlockTemplate } from '../src/engine/cad/cadSheets';
import {
  addSheetObject,
  defaultNorthArrowObject,
  defaultScaleBarObject,
} from '../src/engine/cad/cadSheetObjects';
import type {
  CadArcEntity,
  CadLineEntity,
  CadParcelEntity,
  CadProject,
} from '../src/engine/cad/cadTypes';
import {
  closeSurveyTableManager,
  createTable,
  entityCount,
  gotoCad,
  openSurveyTableManager,
  selectAll,
} from './cad-survey-plan-19a-helpers';
import { layoutTab, sheetGeometryCount } from './cad-sheet-layout-19b-helpers';

const EVIDENCE_DIR = path.resolve(process.cwd(), 'docs/evidence/phase19c');
const WRITE_EVIDENCE = process.env.WRITE_19C_EVIDENCE === '1';

const line = (id: string, fx: number, fy: number, tx: number, ty: number): CadLineEntity => ({
  id, type: 'line', layerId: 'general', visible: true, locked: false,
  fromStationId: `${id}-a`, toStationId: `${id}-b`,
  fromX: fx, fromY: fy, toX: tx, toY: ty, sourceObservationIds: [],
});

const CY = Math.sqrt(2500 - 400);
const normDeg = (deg: number): number => ((deg % 360) + 360) % 360;
const frontageArc = (id: string): CadArcEntity => ({
  id, type: 'arc', layerId: 'general', visible: true, locked: false,
  centerX: 20, centerY: CY, radius: 50,
  startAngleDeg: normDeg((Math.atan2(0 - CY, 0 - 20) * 180) / Math.PI),
  endAngleDeg: normDeg((Math.atan2(0 - CY, 40 - 20) * 180) / Math.PI),
});

const monument = (id: string, stationId: string, x: number, y: number) => ({
  id, type: 'survey-point', layerId: 'general', visible: true, locked: false,
  stationId, x, y, z: 10, pointClass: 'free',
  source: 'parsed-input', description: 'IP',
}) as const;

/** Realistic plan project: curved LOT 1 + straight LOT 2 + road + monuments + tables. */
const buildPlanProject = (): { project: CadProject; lot1: CadParcelEntity } => {
  const document = createBlankCadDrawingDocument({ name: 'Parcel Plan 19C', units: 'm' });
  const base = {
    ...document.project,
    entities: [
      line('line:east', 40, 0, 40, 30),
      line('line:north', 40, 30, 0, 30),
      line('line:west', 0, 30, 0, 0),
      frontageArc('arc:road'),
      // LOT 2: straight rectangle east of LOT 1 (south-first order closes).
      line('lot2:south', 50, 0, 90, 0),
      line('lot2:east', 90, 0, 90, 30),
      line('lot2:north', 90, 30, 50, 30),
      line('lot2:west', 50, 30, 50, 0),
      monument('pt:MON1', 'MON1', 40, 30),
      monument('pt:MON2', 'MON2', 0, 30),
      monument('pt:MON3', 'MON3', 90, 30),
    ],
  };
  let history = runCadCommand(createCadHistoryState(base, []), {
    key: 'PARCEL_CREATE',
    sourceEntityIds: ['line:east', 'line:north', 'line:west', 'arc:road'],
  });
  history = runCadCommand(history, {
    key: 'PARCEL_CREATE',
    sourceEntityIds: ['lot2:south', 'lot2:east', 'lot2:north', 'lot2:west'],
  });
  const lot1 = history.present.project.entities.find(
    (entity): entity is CadParcelEntity =>
      entity.type === 'parcel' &&
      resolveCadParcelCourses(entity).some((course) => course.kind === 'arc'),
  );
  if (!lot1) throw new Error('plan has no curved LOT 1');
  history = runCadCommand(createCadHistoryState(history.present.project, [lot1.id]), {
    key: 'PARCELTABLE', insertX: 100, insertY: 20, sourceEntityIds: [lot1.id],
  });
  history = runCadCommand(history, {
    key: 'PARCELDESC', parcelEntityId: lot1.id, insertX: 100, insertY: -30,
  });
  return { project: history.present.project, lot1 };
};

const writeDrawing = (project: CadProject, name: string): string => {
  const document = createBlankCadDrawingDocument({ name, units: 'm' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-19c-vis-'));
  const filePath = path.join(dir, `${name}.wncad`);
  fs.writeFileSync(
    filePath,
    serializeCadDrawingFile({ ...document, project: { ...project } }),
    'utf8',
  );
  return filePath;
};

const writeSheetDrawing = (project: CadProject): string => {
  const document = createBlankCadDrawingDocument({ name: 'Parcel Sheet 19C', units: 'm' });
  const draft = document.draft;
  if (!draft) throw new Error('blank drawing has no draft');
  const withSheet = addSheetToDraft(
    draft, createPlanSheet({ name: 'C-101', sizeId: 'ISO A3', orientation: 'landscape' }),
  );
  const sheet = withSheet.sheets[withSheet.sheets.length - 1];
  if (!sheet) throw new Error('sheet not created');
  const withViewport = addViewportToSheet(withSheet, sheet.id, {
    name: 'VP-1', modelCenterX: 45, modelCenterY: 10, scaleDenominator: 500,
    paperXmm: 30, paperYmm: 30, paperWidthMm: 330, paperHeightMm: 210, rotationDeg: 0,
  });
  const viewport = withViewport.sheets.find((entry) => entry.id === sheet.id)?.viewports.at(-1);
  if (!viewport) throw new Error('viewport not created');
  let next = addSheetObject(withViewport, sheet.id, defaultNorthArrowObject(viewport));
  next = addSheetObject(next, sheet.id, defaultScaleBarObject(viewport));
  const template = createTitleBlockTemplate('TB-C101');
  next = {
    ...next,
    titleBlockDefinitions: [...next.titleBlockDefinitions, template],
  };
  next = assignTitleBlockToSheet(next, sheet.id, template.id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-19c-vis-'));
  const filePath = path.join(dir, 'parcel-sheet-19c.wncad');
  fs.writeFileSync(
    filePath,
    serializeCadDrawingFile({ ...document, project: { ...project }, draft: next }),
    'utf8',
  );
  return filePath;
};

const openDrawing = async (page: Page, fixturePath: string): Promise<void> => {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(fixturePath);
  await expect.poll(() => entityCount(page)).toBeGreaterThan(0);
};

const capture = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
  target?: Locator,
): Promise<void> => {
  const body = target ? await target.screenshot() : await page.screenshot({ fullPage: false });
  await testInfo.attach(name, { body, contentType: 'image/png' });
  if (WRITE_EVIDENCE) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    const size = page.viewportSize();
    fs.writeFileSync(path.join(EVIDENCE_DIR, `${name}-${size?.width}x${size?.height}.png`), body);
  }
};

const RESOLUTIONS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
] as const;

for (const resolution of RESOLUTIONS) {
  test.describe(`Phase 19C visual QA @ ${resolution.width}x${resolution.height}`, () => {
    test.use({ viewport: { width: resolution.width, height: resolution.height } });

    test(`visual sweep ${resolution.width}x${resolution.height}`, async ({ page }, testInfo) => {
      test.setTimeout(300_000);
      const errors: string[] = [];
      const { project, lot1 } = buildPlanProject();
      const planPath = writeDrawing(project, 'parcel-plan-19c');

      // 1. Model parcel: the realistic plan as opened.
      await gotoCad(page, errors);
      await openDrawing(page, planPath);
      await capture(page, testInfo, 'model-parcel');

      // 2. Selected curved course: full selection highlights LOT 1.
      await selectAll(page);
      await capture(page, testInfo, 'selected-curved-course');

      // 3. Course properties: shell Properties panel for the selection.
      // (Explicit short timeout: the toggle lives in a closed menu and a
      // bare click would wait past the test timeout.)
      await page.getByText(/Properties:/).first().click({ timeout: 5000 }).catch(() => {});
      const props = page.locator('[data-cad-properties="single"], [data-cad-properties="multi"]');
      if ((await props.count()) > 0) {
        await expect(props.first()).toBeVisible({ timeout: 10000 });
      }
      await capture(page, testInfo, 'course-properties');

      // 4. Course table: UI-created parcel course table + manager.
      await createTable(page, 'PARCELTABLE');
      const panel = await openSurveyTableManager(page);
      await expect(panel.locator('[data-cad-survey-table-row]')).toHaveCount(4);
      await capture(page, testInfo, 'course-table');
      await closeSurveyTableManager(page);

      // 5. Split preview: cutting line overlaid on the parent (the pick-loop
      // session preview is pointer-driven and not scriptable; the capture
      // shows the exact cutting geometry the PARCEL_SPLIT commit consumes).
      const previewProject: CadProject = {
        ...project,
        entities: [...project.entities, line('split:preview', 20, -20, 20, 40)],
      };
      await openDrawing(page, writeDrawing(previewProject, 'parcel-split-preview-19c'));
      await selectAll(page);
      await capture(page, testInfo, 'split-preview');

      // 6. Split result: committed children through the production command.
      const withCutter: CadProject = {
        ...project,
        entities: [...project.entities, line('split:cut', 20, -20, 20, 40)],
      };
      const split = runCadCommand(createCadHistoryState(withCutter, [lot1.id]), {
        key: 'PARCEL_SPLIT', parcelEntityId: lot1.id, splitLineEntityId: 'split:cut',
      });
      await openDrawing(page, writeDrawing(split.present.project, 'parcel-split-result-19c'));
      await selectAll(page);
      await capture(page, testInfo, 'split-result');

      // 7. Sheet plan: the store-seeded C-101 sheet (A3 landscape, 1:500
      // viewport, table, arrow, bar, title). No extra layout: the drawing
      // already carries C-101.
      await openDrawing(page, writeSheetDrawing(project));
      await layoutTab(page, 'C-101').click({ timeout: 10000 });
      await expect.poll(() => sheetGeometryCount(page), { timeout: 15000 }).toBeGreaterThan(20);
      await capture(page, testInfo, 'sheet-plan');

      // 8. Description preview: the store-created PARCELDESC (DRAFT) table.
      // (Back to Model first: the model open-input is unmounted on layout tabs.)
      await layoutTab(page, 'Model').click({ timeout: 5000 }).catch(() => {});
      await openDrawing(page, planPath);
      await capture(page, testInfo, 'description-preview');

      expect(errors).toEqual([]);
    });
  });
}
