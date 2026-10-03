/**
 * Phase 20L.2 browser QA — exact-offset groups driven through the REAL
 * /cad shell on a production build in headless Chromium (config
 * `playwright.prod.config.ts`). No mocks: every flow opens a seeded .wncad
 * and drives the live manager/worker, pinning zero page/console errors.
 * Screenshots land under docs/evidence/phase20l2/ (bounded: <=5 PNGs).
 *
 * Flows: A qualifying flat line→arc→line analytic group (exact route:
 * Current, Curve Approximated WITHOUT the corner badge, ties 5.000);
 * B non-qualifying sloped group (chord fallback: Current WITH the corner
 * badge); C maxSearch fallback (honest FAILED, products gated).
 */
import { expect, test, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createBlankCadDrawingDocument,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { CadFeatureLineEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import { entityCount, gotoCad, homeTab, openSurveyPlanDrawing } from './cad-survey-plan-19a-helpers';

const EVIDENCE = path.resolve(process.cwd(), 'docs/evidence/phase20l2');
fs.mkdirSync(EVIDENCE, { recursive: true });

let seq = 0;
const nextId = (p: string): string => `${p}-20l2-${++seq}`;

// B-shape: line (-40,0)->(0,0), CW quarter arc (0,0)->(50,50) about (50,0),
// line (50,50)->(50,90). Arc sweep -pi/2 => bulge tan(-pi/8).
const BULGE_CW_QUARTER = -Math.tan(Math.PI / 8);

const fl = (
  id: string,
  pts: Array<[number, number, number]>,
  segmentGeometry?: CadFeatureLineEntity['segmentGeometry'],
): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
  vertices: pts.map(([x, y, z], i) => ({ id: `${id}:v${i}`, x, y, z })),
  ...(segmentGeometry ? { segmentGeometry } : {}),
});

const FLAT_PTS: Array<[number, number, number]> = [[-40, 0, 0], [0, 0, 0], [50, 50, 0], [50, 90, 0]];
// Non-qualifying arc-pair: line→arc→arc (second arc CCW quarter about
// (10,50), sweep +pi/2 => mirrored bulge). Chord fallback, still Current.
const ARC_PAIR_PTS: Array<[number, number, number]> = [[-40, 0, 0], [0, 0, 0], [50, 50, 0], [10, 90, 0]];
const ARC_GEOMETRY: CadFeatureLineEntity['segmentGeometry'] = [
  { kind: 'line' },
  { kind: 'arc', bulge: BULGE_CW_QUARTER },
  { kind: 'line' },
];
const ARC_PAIR_GEOMETRY: CadFeatureLineEntity['segmentGeometry'] = [
  { kind: 'line' },
  { kind: 'arc', bulge: BULGE_CW_QUARTER },
  { kind: 'arc', bulge: -BULGE_CW_QUARTER },
];

const groupOf = (flId: string, ms: number): CadGradingGroup => ({
  id: nextId('grp'),
  name: 'ExactOffsetQA',
  sourceFeatureLineId: flId,
  sourceCourses: [0, 1, 2].map((i) => ({
    vertexAId: `${flId}:v${i}`, vertexBId: `${flId}:v${i + 1}`,
  })),
  side: 'left',
  criterion: { kind: 'distance', gradeRatio: 1, distance: 5 },
  maxSearchDistance: ms,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  closed: false,
});

const writeWorld = (
  flId: string,
  pts: Array<[number, number, number]>,
  ms: number,
  geom: CadFeatureLineEntity['segmentGeometry'] = ARC_GEOMETRY,
): string => {
  const project: CadProject = {
    ...createBlankCadDrawingDocument({ name: '20L.2 exact-offset QA', units: 'm' }).project,
    entities: [fl(flId, pts, geom)],
    surfaces: [],
    gradingGroups: [groupOf(flId, ms)],
  };
  const file = path.join(os.tmpdir(), `wn-20l2-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wncad`);
  fs.writeFileSync(file, serializeCadDrawingFile({ ...createBlankCadDrawingDocument({ name: 'q', units: 'm' }), project }), 'utf8');
  return file;
};

const openGroupManager = async (page: Page): Promise<void> => {
  await homeTab(page);
  await page.locator('[data-cad-grading-group-command="GRADINGGROUP"]').click();
  await expect(page.locator('[data-cad-grading-group-table]')).toBeVisible({ timeout: 15000 });
};

const groupRow = (page: Page) => page.locator('[data-cad-grading-group-row]').first();

const revealRowStatus = (page: Page): Promise<void> => page.evaluate(() => {
  const table = document.querySelector('[data-cad-grading-group-table]');
  if (table) table.scrollLeft = table.scrollWidth;
});

const geometry: Record<string, unknown> = {};
test.afterAll(() => {
  fs.writeFileSync(`${EVIDENCE}/geometry.json`, JSON.stringify(geometry, null, 2));
});

const shot = async (page: Page, name: string): Promise<void> => {
  geometry[name] = await page.evaluate(() => {
    const box = (sel: string): Record<string, number> | null => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    return {
      innerW: window.innerWidth, innerH: window.innerHeight,
      viewport: box('[data-cad-viewport]'), manager: box('[data-cad-grading-group-table]'),
    };
  });
  await page.screenshot({ path: `${EVIDENCE}/${name}.png` });
};

const calculateAndWait = async (page: Page, want: 'Current' | 'Failed'): Promise<void> => {
  const row = groupRow(page);
  await row.click();
  await expect(page.locator('[data-cad-grading-group-calculate]')).toBeEnabled({ timeout: 15000 });
  await page.locator('[data-cad-grading-group-calculate]').click();
  await expect(row).toContainText(want, { timeout: 60000 });
};

// ===========================================================================
// Flow A — qualifying flat line→arc→line: exact route (1366 + 1920)
// ===========================================================================
for (const viewport of [{ width: 1366, height: 768 }, { width: 1920, height: 1080 }] as const) {
  test(`20L.2 Flow A exact-route flat line-arc-line @ ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    await gotoCad(page, errors);
    const flId = nextId('fl-flat');
    const file = writeWorld(flId, FLAT_PTS, 100);
    const tag = `${viewport.width}`;
    try {
      await openSurveyPlanDrawing(page, file);
      await openGroupManager(page);
      await calculateAndWait(page, 'Current');
      const row = groupRow(page);
      // Truthful badge: tessellated mesh (Curve Approximated) but exact
      // joins — never the corner-approximation badge.
      await expect(row).toContainText('Curve Approximated');
      await expect(row).not.toContainText('(corner)');
      await revealRowStatus(page);
      await shot(page, `${tag}-exact-current`);

      // Inquiry matches the engine contract (ties 5.000 all round).
      await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
      const report = page.locator('[data-cad-grading-group-inquiry-report]');
      await expect(report).toContainText('Status: Current', { timeout: 15000 });
      await expect(report).toContainText('accuracy Curve Approximated');
      await expect(report).toContainText('min 5.000 / max 5.000 / mean 5.000');
      await expect(report).toContainText(/mesh triangles: [1-9]/);
      await report.scrollIntoViewIfNeeded();
      await shot(page, `${tag}-exact-inquiry`);
    } finally {
      fs.rmSync(file, { force: true });
    }
    expect(errors).toEqual([]);
  });
}

// ===========================================================================
// Flow B — sloped line→arc→line: chord fallback, existing behavior (1366)
// ===========================================================================
test('20L.2 Flow B arc-pair chord fallback keeps the corner badge', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const flId = nextId('fl-arcpair');
  const file = writeWorld(flId, ARC_PAIR_PTS, 100, ARC_PAIR_GEOMETRY);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await calculateAndWait(page, 'Current');
    const row = groupRow(page);
    // Chord fallback: the corner badge stays on (existing behavior).
    await expect(row).toContainText('Curve Approximated (corner)');
    await revealRowStatus(page);
    await shot(page, '1366-chord-current');
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});

// ===========================================================================
// Flow C — maxSearch fallback: honest FAILED, products gated (1366)
// ===========================================================================
test('20L.2 Flow C maxSearch fallback fails closed', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const errors: string[] = [];
  await gotoCad(page, errors);
  const flId = nextId('fl-maxsearch');
  const file = writeWorld(flId, FLAT_PTS, 4);
  try {
    await openSurveyPlanDrawing(page, file);
    await openGroupManager(page);
    await calculateAndWait(page, 'Failed');
    const row = groupRow(page);
    await expect(row).not.toContainText('Current');
    await expect(page.locator('[data-cad-grading-group-extract]')).toBeDisabled();
    await expect(page.locator('[data-cad-grading-group-bake]')).toBeDisabled();
    // Inquiry names the failure instead of showing a result.
    await page.locator('[data-cad-grading-group-tab="inquiry"]').click();
    const report = page.locator('[data-cad-grading-group-inquiry-report]');
    await expect(report).toContainText(/Failure: /, { timeout: 15000 });
    await expect(report).toContainText('No CURRENT result');
    const entitiesBefore = await entityCount(page);
    expect(entitiesBefore).toBeGreaterThan(0);
  } finally {
    fs.rmSync(file, { force: true });
  }
  expect(errors).toEqual([]);
});
