/** BEFORE baseline @ 4c966e4d (dev server :4175): capture the 3 known 20F.1 defects. */
import assert from 'node:assert';
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';

const EVIDENCE = '/home/jacko/Code/webnet/docs/evidence/phase20f1/before';
fs.mkdirSync(EVIDENCE, { recursive: true });
// Manual BEFORE baseline: only runs with WEBNET_BEFORE_BASE set to the 4c966e4d
// worktree dev server (production build fails there: absent @tauri-apps/api;
// dev needs a stub — see phase20f1-browser-qa.md). Skipped otherwise.
const BASE = process.env.WEBNET_BEFORE_BASE ?? '';

async function gotoOldCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`${BASE}/cad`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
}

test('BEFORE defects at 4c966e4d', async ({ page }: { page: Page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  test.skip(BASE === '', 'needs manual 4c966e4d worktree dev server (WEBNET_BEFORE_BASE)');
  const errors: string[] = [];
  assert(BASE !== '');
  await gotoOldCad(page, errors);
  const flId = 'fl-before';
  const project = {
    ...createBlankCadDrawingDocument({ name: 'before', units: 'm' }).project,
    entities: [{
      id: flId, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: 'FL',
      vertices: [{ id: `${flId}:v0`, x: 0, y: 0, z: 10 }, { id: `${flId}:v1`, x: 100, y: 0, z: 10 }, { id: `${flId}:v2`, x: 100, y: 100, z: 10 }],
    }],
    surfaces: [],
    gradingGroups: [{
      id: 'grp-before', name: 'DistBefore', sourceFeatureLineId: flId,
      sourceCourses: [
        { vertexAId: `${flId}:v0`, vertexBId: `${flId}:v1` },
        { vertexAId: `${flId}:v1`, vertexBId: `${flId}:v2` },
      ],
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.02, distance: 20 },
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter',
      courseCriteria: [{
        sourceCourse: { vertexAId: `${flId}:v0`, vertexBId: `${flId}:v1` },
        criterion: { kind: 'distance', gradeRatio: -0.02, distance: 25 },
      }],
    }],
  };
  const file = path.join(os.tmpdir(), `wn-before-${Date.now()}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project: project as never }), 'utf8');
  try {
    const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
    await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
    await fileInput.setInputFiles(file);
    await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();
    await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
    await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-cad-grading-group-row]', { hasText: 'DistBefore' }).first().click();
    // Defect 1+2: criteria composer + row type tags.
    await page.locator('[data-cad-grading-group-tab="criteria"]').click();
    const criteria = page.locator('[data-cad-grading-group-criteria]');
    await expect(criteria).toBeVisible({ timeout: 10000 });
    await criteria.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.locator('section[aria-label="Grading group manager"]').screenshot({ path: `${EVIDENCE}/before-criteria-2way-mislabel.png` });
    // Defect 3: analytic->Surface edit path.
    await page.locator('[data-cad-grading-group-tab="definition"]').click();
    await page.locator('[data-cad-grading-group-row]', { hasText: 'DistBefore' }).first().click();
    await page.locator('[data-cad-grading-group-edit-criteria]').click();
    const editPanel = page.locator('[data-cad-grading-group-edit-panel]');
    await expect(editPanel).toBeVisible({ timeout: 10000 });
    const methodSelect = editPanel.locator('[data-cad-grading-field="cad-grading-group-edit-method"]');
    if (await methodSelect.count() > 0) {
      await methodSelect.selectOption('surface');
      await page.waitForTimeout(400);
    }
    await editPanel.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    await page.locator('section[aria-label="Grading group manager"]').screenshot({ path: `${EVIDENCE}/before-edit-no-selector.png` });
    console.log('BEFORE ERRORS: ' + JSON.stringify(errors));
  } finally {
    fs.rmSync(file, { force: true });
  }
});
