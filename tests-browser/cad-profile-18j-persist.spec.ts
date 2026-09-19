/**
 * Phase 18J browser QA — persistence + worker protocol through /cad.
 *
 * Playwright (dev-server + Chromium), NOT vitest. Fixtures/helpers live in
 * cad-profile-18j-helpers.ts. Zero page/console errors per test.
 *
 * - 18J-C persistence + worker protocol: save/reopen (UNBUILT, no false
 *   CURRENT) -> rebuild chain CURRENT + inquiry reproduces -> profile
 *   extractor latest-wins (late-A discarded) through the production
 *   surfaceWorkerHandler with an injected controllable extractor.
 */
import { expect, test } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SHOT_DIR,
  SURFACE_ID,
  createProfile,
  downloadToTemp,
  gotoCad,
  makeProfileDrawing,
  openDrawing,
  openProfileManager,
  profileManagerScope,
  profileStatus,
  queryProfileStation,
  rebuildAllSurfaces,
  rebuildProfile,
  ribbonTab,
  showSurveyTab,
} from './cad-profile-18j-helpers';

test('18J-C: save/reopen reproduces after rebuild + profile worker latest-wins', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  await gotoCad(page, errors);
  const drawingPath = makeProfileDrawing();
  await openDrawing(page, drawingPath, 33);
  await showSurveyTab(page);
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${SURFACE_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');
  await openProfileManager(page);
  const profileId = await createProfile(page, 'J-CL-EG');
  await profileManagerScope(page).locator(`[data-profile-list] [data-cad-profile="${profileId}"]`).click();
  await rebuildProfile(page);
  await expect.poll(() => profileStatus(page, profileId), { timeout: 60000 }).toBe('CURRENT');
  await profileManagerScope(page).locator('[data-profile-detail]').getByRole('button', { name: 'Create Profile View' }).click();
  await expect.poll(() => page.locator('[data-profile-view-layer]').count()).toBe(1);

  // Save/reopen: definitions persist, derived samples never do.
  await ribbonTab(page, 'Home').click();
  const savedPath = await downloadToTemp(
    page,
    () => page.getByRole('button', { name: 'Save Drawing' }).first().click(),
    '.wncad',
  );
  expect(fs.readFileSync(savedPath, 'utf8')).toContain('J-CL-EG');
  await page.goto('/cad', { waitUntil: 'networkidle' });
  await expect(page.getByText('WebNet CAD', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await openDrawing(page, savedPath, 33);
  await showSurveyTab(page);
  await expect.poll(() => profileStatus(page, profileId)).toMatch(/SOURCE_NOT_CURRENT|UNBUILT/);
  await openProfileManager(page);
  await rebuildAllSurfaces(page);
  await expect.poll(
    () => page.locator(`[data-cad-toolspace] [data-cad-surface="${SURFACE_ID}"]`).getAttribute('data-cad-surface-status'),
    { timeout: 60000 },
  ).toBe('CURRENT');
  await profileManagerScope(page).locator(`[data-profile-list] [data-cad-profile="${profileId}"]`).click();
  await rebuildProfile(page);
  await expect.poll(() => profileStatus(page, profileId), { timeout: 60000 }).toBe('CURRENT');
  expect(await queryProfileStation(page, '20')).toContain('elevation 102.000');
  await expect.poll(() => page.locator('[data-profile-view-layer]').count()).toBe(1);
  await page.screenshot({ path: `${SHOT_DIR}/18j-C-reopened.png` });

  // Worker protocol: the exact profile extractor runs in-page; handler
  // latest-wins discards the late loser (injected controllable extractor,
  // never timing-flaky).
  const verdict = await page.evaluate(async (urls: string[]) => {
    const handlerUrl = urls[0] as string;
    const extractUrl = urls[1] as string;
    const handlerMod = await import(handlerUrl) as {
      createSurfaceWorkerHandler: (_deps: {
        loadBuilder: () => Promise<unknown>;
        loadProfileExtractor?: () => Promise<unknown>;
        postMessage: (_message: { type: string; requestId: string }) => void;
        defer: (_callback: () => void) => void;
      }) => { handleMessage: (_message: unknown) => void };
    };
    const extractMod = await import(extractUrl) as {
      extractSurfaceProfile: (_input: Record<string, unknown>) => { segments: unknown[]; coveredLength: number };
    };
    const direct = extractMod.extractSurfaceProfile({
      profileId: 'p-direct',
      revision: 'prev1:p@aregx',
      alignmentElements: [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
      startStation: 0,
      mesh: {
        points: [{ x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 12 }, { x: 10, y: 10, z: 14 }, { x: 0, y: 10, z: 11 }],
        triangles: [[0, 1, 2], [0, 2, 3]],
        grid: { minX: 0, minY: 0, cellSize: 5, cells: new Map() },
      },
    });
    const posted: Array<{ type: string; requestId: string }> = [];
    const defers: Array<() => void> = [];
    const resolvers: Record<string, (_value: unknown) => void> = {};
    const extractor = (input: { revision: string }) =>
      new Promise((_resolve) => {
        resolvers[input.revision] = _resolve as (_value: unknown) => void;
      });
    const handler = handlerMod.createSurfaceWorkerHandler({
      loadBuilder: async () => async () => { throw new Error('unused'); },
      loadProfileExtractor: async () => extractor as unknown,
      postMessage: (message) => posted.push({ type: message.type, requestId: message.requestId }),
      defer: (callback) => defers.push(callback),
    });
    const requestFor = (revision: string) => ({
      profileId: 'p-late',
      profileRevision: revision,
      surfaceRevision: 'srev1:surf@abc',
      alignmentElements: [{ kind: 'line', start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
      startStation: 0,
      mesh: {
        points: [0, 0, 10, 10, 0, 12, 10, 10, 14, 0, 10, 11],
        triangles: [0, 1, 2, 0, 2, 3],
        grid: { minX: 0, minY: 0, cellSize: 5, cells: {} },
      },
    });
    handler.handleMessage({ type: 'profile', requestId: 'reqA', request: requestFor('revA') });
    handler.handleMessage({ type: 'profile', requestId: 'reqB', request: requestFor('revB') });
    for (const callback of defers.splice(0)) callback();
    const tick = async (): Promise<void> => {
      for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await tick();
    resolvers['revB']!({ ok: 'B' });
    await tick();
    // Late loser resolves after supersession: must be discarded silently.
    resolvers['revA']!({ ok: 'A' });
    await tick();
    return {
      directSegments: direct.segments.length,
      directCovered: direct.coveredLength,
      successes: posted.filter((entry) => entry.type === 'profile-success').map((entry) => entry.requestId),
    };
  }, ['/src/workers/surfaceWorkerHandler.ts', '/src/engine/cad/profiles/profileExtraction.ts']);
  expect(verdict.directSegments).toBeGreaterThan(0);
  expect(verdict.directCovered).toBeGreaterThan(0);
  expect(verdict.successes).toEqual(['reqB']);
  fs.rmSync(path.dirname(drawingPath), { recursive: true, force: true });
  fs.rmSync(path.dirname(savedPath), { recursive: true, force: true });
  expect(errors).toEqual([]);
});
