/**
 * Phase 19A browser QA — shared seed + UI helpers for the standalone /cad app.
 *
 * The drawing is generated from the real `createBlankCadDrawingDocument`
 * (never hand-written JSON), so every open path runs the production sanitize/
 * backfill seams. It carries the exact geometry the spec needs: four straight
 * lines with cardinal bearings, three arcs with round radius/delta values,
 * three rectangle parcels (stable course ids pre-seeded) and three survey
 * points (P2 deliberately has no elevation).
 */
import { expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type {
  CadArcEntity,
  CadEntity,
  CadLineEntity,
  CadParcelEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { buildParcelCourseIds } from '../src/engine/cad/cadParcelCourses';

export const LINE_IDS = ['line:1', 'line:2', 'line:3', 'line:4'] as const;
export const ARC_IDS = ['arc:1', 'arc:2', 'arc:3'] as const;
export const POINT_IDS = ['pt:P1', 'pt:P2', 'pt:P3'] as const;
export const PARCEL_IDS = ['parcel:lot1', 'parcel:lot2', 'parcel:lot3'] as const;
const base = (
  id: string,
  layerId = 'general',
): Pick<CadEntity, 'id' | 'layerId' | 'visible' | 'locked'> => ({
  id,
  layerId,
  visible: true,
  locked: false,
});

const line = (
  id: string,
  fromStationId: string,
  toStationId: string,
  from: [number, number],
  to: [number, number],
): CadLineEntity => ({
  ...base(id),
  type: 'line',
  fromStationId,
  toStationId,
  fromX: from[0],
  fromY: from[1],
  toX: to[0],
  toY: to[1],
  sourceObservationIds: [],
});

const arc = (
  id: string,
  center: [number, number],
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadArcEntity => ({
  ...base(id),
  type: 'arc',
  centerX: center[0],
  centerY: center[1],
  radius,
  startAngleDeg,
  endAngleDeg,
});

const parcel = (
  id: string,
  parcelName: string,
  vertices: Array<[number, number]>,
  vertexLabels: string[],
): CadParcelEntity => ({
  ...base(id),
  type: 'parcel',
  parcelName,
  vertices: vertices.map(([x, y]) => ({ x, y })),
  vertexLabels,
  courseIds: buildParcelCourseIds(id, vertices.length),
});

const surveyPoint = (
  id: string,
  stationId: string,
  x: number,
  y: number,
  z: number | undefined,
  description: string,
): CadSurveyPointEntity => ({
  ...base(id),
  type: 'survey-point',
  stationId,
  x,
  y,
  ...(z != null ? { z } : {}),
  pointClass: 'free',
  source: 'parsed-input',
  description,
});

/** Deterministic entity set (parcel first so `select all` starts with it). */
export const buildSurveyPlanEntities = (): CadEntity[] => [
  parcel('parcel:lot1', 'LOT 1', [[0, 0], [40, 0], [40, 30], [0, 30]], ['A', 'B', 'C', 'D']),
  parcel('parcel:lot2', 'LOT 2', [[60, 0], [100, 0], [100, 30], [60, 30]], ['E', 'F', 'G', 'H']),
  parcel('parcel:lot3', 'LOT 3', [[120, 0], [160, 0], [160, 30], [120, 30]], ['I', 'J', 'K', 'L']),
  line('line:1', 'L1A', 'L1B', [300, 0], [300, 5]),
  line('line:2', 'L2A', 'L2B', [300, 5], [310, 5]),
  line('line:3', 'L3A', 'L3B', [310, 5], [310, 1]),
  line('line:4', 'L4A', 'L4B', [310, 1], [300, 1]),
  arc('arc:1', [400, 0], 100, 0, 90),
  arc('arc:2', [400, 200], 50, 0, 90),
  arc('arc:3', [400, 400], 25, 90, 180),
  surveyPoint('pt:P1', 'P1', 500, 100, 50, 'IP'),
  surveyPoint('pt:P2', 'P2', 510, 110, undefined, ''),
  surveyPoint('pt:P3', 'P3', 520, 120, 55, 'MH'),
];

export const buildSurveyPlanProject = (): CadProject => {
  const document = createBlankCadDrawingDocument({ name: 'Survey Plan QA 19A', units: 'm' });
  const project: CadProject = {
    ...document.project,
    name: 'Survey Plan QA 19A',
    entities: buildSurveyPlanEntities(),
  };
  return project;
};

/** Serialize the deterministic drawing to a temp `.wncad` and return the path. */
export const writeSurveyPlanFixture = (): string => {
  const document = createBlankCadDrawingDocument({ name: 'Survey Plan QA 19A', units: 'm' });
  const withEntities: typeof document = {
    ...document,
    project: { ...document.project, entities: buildSurveyPlanEntities() },
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wn-19a-'));
  const filePath = path.join(dir, 'survey-plan-19a.wncad');
  fs.writeFileSync(filePath, serializeCadDrawingFile(withEntities), 'utf8');
  return filePath;
};

// ---------------------------------------------------------------------------
// App chrome / navigation
// ---------------------------------------------------------------------------

export async function gotoCad(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('dialog', (dialog) => {
    if (dialog.type() === 'confirm') void dialog.accept();
  });
  await page.addInitScript(() => {
    const record = window as unknown as Record<string, unknown>;
    delete record.showSaveFilePicker;
    delete record.showOpenFilePicker;
  });
  await page.goto('/cad', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('[data-cad-viewport]')).toBeVisible({ timeout: 30000 });
}

/** Load the deterministic 19A drawing through the real Open Drawing input. */
export async function openSurveyPlanDrawing(page: Page, fixturePath: string): Promise<void> {
  const fileInput = page.locator('[data-survey-cad-open-drawing-input]');
  await fileInput.evaluate((element: HTMLInputElement) => element.classList.remove('hidden')).catch(() => {});
  await fileInput.setInputFiles(fixturePath);
  await expect.poll(() => entityCount(page)).toBeGreaterThan(0);
}

export async function homeTab(page: Page): Promise<void> {
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Home' }).click();
}

export async function annotateTab(page: Page): Promise<void> {
  await page.locator('[data-cad-ribbon] [role="tab"]', { hasText: 'Annotate' }).click();
}

export async function entityCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-entity-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

export async function selectionCount(page: Page): Promise<number> {
  const text = (await page.locator('[data-survey-cad-selection-count]').textContent()) ?? '';
  return Number.parseInt(text, 10);
}

export async function selectAll(page: Page, expected?: number): Promise<void> {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_SELECT_ALL"]').click();
  if (expected != null) await expect.poll(() => selectionCount(page)).toBe(expected);
}

export async function clearSelection(page: Page): Promise<void> {
  await homeTab(page);
  await page.locator('[data-cad-command="SHELL_CLEAR_SELECTION"]').click();
  await expect.poll(() => selectionCount(page)).toBe(0);
}

/** Click a fraction of the viewport svg (table insertion picks, canvas picks). */
export async function canvasClick(page: Page, fx: number, fy: number): Promise<void> {
  const box = await page.locator('[data-cad-viewport] svg').first().boundingBox();
  if (!box) throw new Error('viewport svg has no bounding box');
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
}

/**
 * Run a survey table creation command from the ribbon and pick an insertion
 * point. Returns after the insertion session commits.
 */
export async function createTable(
  page: Page,
  command: 'LINETABLE' | 'CURVETABLE' | 'PARCELTABLE' | 'POINTTABLE',
): Promise<void> {
  await annotateTab(page);
  const button = page.locator(`[data-cad-annotation-command="${command}"]`);
  await expect(button).toBeEnabled();
  await button.click();
  await canvasClick(page, 0.2, 0.2);
}

/** Open the survey table manager (row editor) and return the panel locator. */
export async function openSurveyTableManager(page: Page) {
  await annotateTab(page);
  await page.locator('[data-cad-annotation-command="TABLESTYLE"]').click();
  const panel = page.locator('[data-cad-survey-table-panel="true"]');
  await expect(panel).toBeVisible({ timeout: 10000 });
  return panel;
}

export async function closeSurveyTableManager(page: Page): Promise<void> {
  await page.locator('[data-cad-survey-table-manager-close]').click();
  await expect(page.locator('[data-cad-survey-table-manager]')).toBeHidden();
}

/** Row code inputs (in row order) from the open manager panel. */
export async function tableRowCodes(page: Page): Promise<string[]> {
  return page.locator('[data-cad-survey-table-row-code]').evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value),
  );
}

/** Download and return the saved drawing text (Save Drawing chrome action). */
export async function saveDrawingText(page: Page): Promise<{ text: string; dir: string }> {
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 });
  await page.getByRole('button', { name: 'Save Drawing' }).first().click();
  const download = await downloadPromise;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'wn-19a-save-'));
  const savedPath = path.join(dir, 'drawing.wncad');
  await download.saveAs(savedPath);
  return { text: fs.readFileSync(savedPath, 'utf8'), dir: path.dirname(savedPath) };
}
