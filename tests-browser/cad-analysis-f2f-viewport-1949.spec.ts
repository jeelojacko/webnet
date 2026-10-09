/**
 * STRUCT-194.9 browser QA — the extracted viewport + F2F-catalog seams through
 * the REAL /cad app in headless Chromium.
 *
 * Genuinely uncovered combinations (the rest of the 1949 surface is real in
 * the reused specs: #1942 dock/undo, #1943 drawing lifecycle, #1948 derived
 * scene, #183 pointer, #185 surface revision, #18U analysis CURRENT + export):
 *   1. the zoom/pan transform is reset by the extracted
 *      `useSurveyCadViewportLifecycle` on a drawing switch (a stale zoom must
 *      not survive a new drawing);
 *   2. a drawing that carries F2F content but no owned catalog surfaces the
 *      MISSING_LEGACY block instead of a silent sample.
 *
 * The analysis CURRENT export browser flow is already covered by
 * `cad-surface-analysis-18u.spec.ts` (18U-A Calculate CURRENT + 18U-D Export
 * Center), so it is reused rather than duplicated here. Every flow asserts
 * zero page / console errors.
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import {
  entityCount,
  gotoCad,
  homeTab,
  openSurveyPlanDrawing,
  writeSurveyPlanFixture,
} from './cad-survey-plan-19a-helpers';

test.describe.configure({ mode: 'serial' });

const viewportBox = async (page: Page) => {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('no viewport box');
  return box;
};

const renderCount = (page: Page): Promise<number> =>
  page.locator('[data-survey-cad-render-entity-id]').count();

/** A drawing carrying F2F-generated content but no owned catalog. */
const writeMissingLegacyFixture = (): string => {
  const document = createBlankCadDrawingDocument({ name: 'Missing Legacy 1949', units: 'm' });
  const generatedPoint: CadSurveyPointEntity = {
    id: 'pt:legacy',
    type: 'survey-point',
    layerId: 'general',
    visible: true,
    locked: false,
    stationId: 'LEGACY1',
    x: 5,
    y: 5,
    z: 1,
    pointClass: 'free',
    source: 'parsed-input',
    metadata: {
      provenance: { generatedBy: 'FIELD_TO_FINISH', featureDefinitionId: 'def-legacy' },
    },
  };
  const project: CadProject = { ...document.project, entities: [generatedPoint] };
  delete project.fieldToFinishCatalog;
  const withEntities = { ...document, project, showParcelLabels: true };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-1949-'));
  const filePath = path.join(dir, 'missing-legacy-1949.wncad');
  fs.writeFileSync(filePath, serializeCadDrawingFile(withEntities), 'utf8');
  return filePath;
};

test('1949-A: the viewport transform resets on a drawing switch', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const firstFixture = writeSurveyPlanFixture();
  const secondFixture = writeSurveyPlanFixture();
  await openSurveyPlanDrawing(page, firstFixture);
  await expect.poll(() => entityCount(page)).toBeGreaterThan(0);

  const box = await viewportBox(page);
  const full = await renderCount(page);
  expect(full).toBeGreaterThan(0);

  // Zoom in hard at a corner: off-viewport geometry is culled (render only).
  await page.mouse.move(box.x + 8, box.y + 8);
  for (let index = 0; index < 24; index += 1) await page.mouse.wheel(0, -120);
  await expect.poll(() => renderCount(page)).toBeLessThan(full);

  // A drawing switch (new drawing id) resets zoom/pan via the extracted
  // viewport lifecycle, so the culled geometry is visible again.
  await openSurveyPlanDrawing(page, secondFixture);
  await expect.poll(() => renderCount(page), { timeout: 20_000 }).toBe(full);
  expect(errors).toEqual([]);
});

test('1949-B: a legacy drawing without a catalog surfaces the MISSING_LEGACY block', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  await openSurveyPlanDrawing(page, writeMissingLegacyFixture());
  await homeTab(page);
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Survey' }).click();
  await page.getByRole('button', { name: 'Field to Finish', exact: true }).first().click();
  await expect(page.locator('[data-f2f-legacy-block]')).toBeVisible({ timeout: 10_000 });
  expect(errors).toEqual([]);
});
