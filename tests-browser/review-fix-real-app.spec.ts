import { expect, test } from '@playwright/test';

import {
  getPerfCapture,
  mockOsmTiles,
  resetPerfCapture,
  runZoomSweep,
  setToggle,
  waitForMapIdle,
  waitForOsmTilesReady,
} from './mapBasemapPerf/mapBasemapPerfTestSupport';

/**
 * REVIEW-FIX real-app validation: actual WebNet page (not harness).
 * - Preanalysis-equivalent progress: finalizing never shows solve N/N
 *   (presentation suppression proven at unit level; here prove the live
 *   toolbar never renders a solve fraction while phase=finalizing by
 *   driving the real AppToolbar through run phases is covered via harness;
 *   this spec proves the REAL top toolbar has no overlap at mission widths
 *   and run-status readability).
 * - Real map: wheel zoom across a tile-zoom boundary with mocked OSM tiles
 *   on the REAL map component (/map-pan-harness.html), asserting non-empty
 *   tile coverage from the live perf metadata, plus a production-code-path
 *   check (real MapViewTileStore.resolveRenderTiles +
 *   reusePreviousTilesForDeepFallback) proving D1 paint order: reused
 *   previous parents and unmatched deep tiles sort BEFORE exact tiles.
 *
 * Honest scope: this proves render-list geometry/ordering, not pixels — no
 * screenshots (compositor frames are unavailable in containers). Residual
 * pixel shimmer during a zoom transition stays a documented risk.
 */
test.describe('review-fix real-app validation', () => {
  test('real top toolbar: no overlap at 1366/1280/1100/980', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const width of [1366, 1280, 1100, 980]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      const toolbar = page.getByTestId('app-toolbar');
      await expect(toolbar).toBeVisible({ timeout: 30000 });
      const overflow = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollW, `page overflow at ${width}`).toBeLessThanOrEqual(overflow.clientW + 1);
      const overlap = await toolbar.evaluate((root) => {
        const btns = [...root.querySelectorAll('button,select')].filter((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const boxes = btns.map((el) => {
          const r = (el as HTMLElement).getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        });
        let hits = 0;
        for (let i = 0; i < boxes.length; i += 1)
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i];
            const b = boxes[j];
            if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5)
              hits += 1;
          }
        return { controls: boxes.length, hits };
      });
      expect(overlap.controls).toBeGreaterThan(0);
      expect(overlap.hits, `toolbar overlap at ${width}`).toBe(0);
    }
    expect(errors).toEqual([]);
  });

  test('real map harness: wheel zoom crosses descriptor boundary without deep-stretch render', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await mockOsmTiles(page);
    await page.goto('/map-pan-harness.html', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('map-pan-harness-ready')).toHaveText('ready');

    // REAL render path: enable OSM on the live map component and wheel-zoom
    // across a descriptor zoom boundary with mocked tiles.
    await resetPerfCapture(page, 'review-fix:map-leg');
    await setToggle(page, 'toggle-osm', true);
    await waitForMapIdle(page);
    await waitForOsmTilesReady(page);
    const svg = page.locator('svg');
    const svgBox = await svg.boundingBox();
    if (!svgBox) throw new Error('Map svg not visible');
    await runZoomSweep(page, svgBox, -180, 8, 0);
    await runZoomSweep(page, svgBox, 180, 8, 0);
    await waitForMapIdle(page);

    // (c) Tile coverage is non-empty after crossing: no blank regression.
    const capture = await getPerfCapture(page);
    const resolvedCount = Number(capture?.metadata?.['tiles:last-resolved-count'] ?? 0);
    expect(resolvedCount).toBeGreaterThan(0);
    const snapshot = capture?.metadata?.['tiles:snapshot'] as
      | { loadedCount?: number; visibleCount?: number; uploadedCount?: number }
      | undefined;
    const liveTiles =
      (snapshot?.loadedCount ?? 0) +
      (snapshot?.visibleCount ?? 0) +
      (snapshot?.uploadedCount ?? 0);
    expect(liveTiles).toBeGreaterThan(0);

    // (a)+(b) Production code path, cross-zoom keys (z5 -> z6): seed z4
    // grandparent images so z6 children resolve deep, while a previously
    // rendered z5 parent spatially covers two of them. Mixed set: one exact
    // z6 child plus deep z6 children plus one unmatched deep tile.
    const probe = await page.evaluate(async () => {
      const mod = await import('/src/components/mapView/mapViewTileStore.ts');
      const store = new mod.MapViewTileStore(32);
      const mk = (zoom: number, tileX: number, tileY: number) => ({
        key: `${zoom}-${tileX}-${tileY}`,
        href: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`,
        zoom,
        tileX,
        tileY,
        meshColumns: 1,
        meshRows: 1,
        meshPoints: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
          { x: 1, y: 1 },
        ],
      });
      const grandImg = new Image();
      grandImg.src = 'https://tile.openstreetmap.org/4/5/6.png';
      await new Promise((resolve) => {
        grandImg.onload = resolve;
        grandImg.onerror = resolve;
      });
      const grandSurface =
        grandImg.complete && grandImg.naturalWidth > 0
          ? grandImg
          : ({ naturalWidth: 256, naturalHeight: 256 } as unknown as HTMLImageElement);
      (store as any).entries.set('4-5-6', {
        key: '4-5-6',
        href: 'https://tile.openstreetmap.org/4/5/6.png',
        zoom: 4,
        tileX: 5,
        tileY: 6,
        image: grandSurface,
        status: 'loaded',
        lastAccessTick: 1,
        crossOrigin: null,
      });
      // Second grandparent so 6-0-0 resolves deep (delta 2) with NO spatial
      // previous covering it: it must keep offline coverage, below exact.
      (store as any).entries.set('4-0-0', {
        key: '4-0-0',
        href: 'https://tile.openstreetmap.org/4/0/0.png',
        zoom: 4,
        tileX: 0,
        tileY: 0,
        image: grandSurface,
        status: 'loaded',
        lastAccessTick: 1,
        crossOrigin: null,
      });
      const children = [mk(6, 20, 24), mk(6, 21, 24), mk(6, 0, 0)];
      const resolved = store.resolveRenderTiles(children as any);
      const basemap = await import('/src/components/mapView/mapViewBasemap.ts');
      const prev = [
        {
          key: '5-10-12',
          zoom: 5,
          tileX: 10,
          tileY: 12,
          fallbackPreferred: true,
          fallbackZoomDelta: 0,
        },
        // Exact z6 child already rendered in a previous frame.
        {
          key: '6-22-24',
          zoom: 6,
          tileX: 22,
          tileY: 24,
          fallbackPreferred: true,
          fallbackZoomDelta: 0,
        },
      ];
      const exactChild = {
        key: '6-22-24',
        zoom: 6,
        tileX: 22,
        tileY: 24,
        fallbackPreferred: true,
        fallbackZoomDelta: 0,
      };
      const withExact = [...resolved, exactChild];
      const render = (basemap as any).reusePreviousTilesForDeepFallback(withExact, prev);
      return {
        resolvedKeys: resolved.map((t: any) => t.key),
        resolvedDeltas: resolved.map((t: any) => t.fallbackZoomDelta),
        renderKeys: render.map((t: any) => t.key),
        renderDeltas: render.map((t: any) => t.fallbackZoomDelta),
      };
    });
    // (a) Covered deep children are replaced by the previous-parent surface:
    // no rendered surface keeps a child-sliced key with fallbackZoomDelta > 1
    // while a spatial previous exists.
    expect(probe.renderKeys).toContain('5-10-12');
    expect(probe.renderKeys).not.toContain('6-20-24');
    expect(probe.renderKeys).not.toContain('6-21-24');
    const deepSliced = probe.renderKeys.filter(
      (k: string, i: number) => k.startsWith('6-') && (probe.renderDeltas[i] as number) > 1,
    );
    // Only the unmatched deep tile (no spatial previous) may remain deep.
    expect(deepSliced).toEqual(['6-0-0']);
    // (b) Paint order: reused parent AND unmatched deep sort before exact.
    expect(probe.renderKeys.indexOf('5-10-12')).toBeLessThan(
      probe.renderKeys.indexOf('6-22-24'),
    );
    expect(probe.renderKeys.indexOf('6-0-0')).toBeLessThan(
      probe.renderKeys.indexOf('6-22-24'),
    );
    expect(errors).toEqual([]);
  });
});
