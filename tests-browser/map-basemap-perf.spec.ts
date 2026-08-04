import { expect, test } from '@playwright/test';

import {
  applyToggleState,
  attachJson,
  findScenarioAction,
  getHarnessState,
  measureAction,
  mockOsmTiles,
  resetPerfCapture,
  runPanSweep,
  runZoomSweep,
  setToggle,
  type SweepSummary,
  type ToggleState,
  waitForMapIdle,
} from './mapBasemapPerf/mapBasemapPerfTestSupport';

test.describe('Map basemap browser harness', () => {
  test('profiles OSM-on map actions and isolates basemap hotspots', async ({ page }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await mockOsmTiles(page);

    const runScenario = async (
      scenarioId: string,
      toggleState: ToggleState,
    ): Promise<{ scenarioId: string; state: ToggleState; actions: SweepSummary[] }> => {
      await page.goto('/map-pan-harness.html');
      await expect(page.getByTestId('map-pan-harness-ready')).toHaveText('ready');
      await resetPerfCapture(page, `${scenarioId}:warmup`, { scenarioId, phase: 'warmup' });
      await applyToggleState(page, toggleState);
      const map = page.locator('[data-map-interaction-phase]');
      const svg = page.locator('svg');
      const svgBox = await svg.boundingBox();
      if (!svgBox) throw new Error('Map svg not visible');
      await expect(page.getByTestId('map-renderer-badge')).toContainText('Renderer:');
      await expect(map).toHaveAttribute('data-map-interaction-phase', 'idle');
      const actions: SweepSummary[] = [];
      actions.push(
        await measureAction(page, `${scenarioId}:pan-fast`, () =>
          runPanSweep(page, svgBox, 36, 14, 8, 0),
        ),
      );
      actions.push(
        await measureAction(page, `${scenarioId}:pan-medium`, () =>
          runPanSweep(page, svgBox, 22, 10, 8, 18),
        ),
      );
      actions.push(
        await measureAction(page, `${scenarioId}:pan-slow`, () =>
          runPanSweep(page, svgBox, 12, 5, 8, 36),
        ),
      );
      actions.push(
        await measureAction(page, `${scenarioId}:zoom-in-fast`, () =>
          runZoomSweep(page, svgBox, -180, 8, 0),
        ),
      );
      actions.push(
        await measureAction(page, `${scenarioId}:zoom-out-fast`, () =>
          runZoomSweep(page, svgBox, 180, 8, 0),
        ),
      );
      actions.push(
        await measureAction(page, `${scenarioId}:toggle-labels`, async () => {
          const next = !(await getHarnessState(page)).showLabels;
          await setToggle(page, 'toggle-labels', next);
          await waitForMapIdle(page);
          await setToggle(page, 'toggle-labels', !next);
          await waitForMapIdle(page);
        }),
      );
      actions.push(
        await measureAction(page, `${scenarioId}:toggle-obstacles`, async () => {
          const next = !(await getHarnessState(page)).showObstacleLayer;
          await setToggle(page, 'toggle-obstacles', next);
          await waitForMapIdle(page);
          await setToggle(page, 'toggle-obstacles', !next);
          await waitForMapIdle(page);
        }),
      );
      return { scenarioId, state: toggleState, actions };
    };

    const results = [
      await runScenario('osm-off-all-overlays', {
        labels: true,
        osm: false,
        inputPoints: true,
        obstacles: true,
        blockedAreas: true,
      }),
      await runScenario('osm-on-all-overlays', {
        labels: true,
        osm: true,
        inputPoints: true,
        obstacles: true,
        blockedAreas: true,
      }),
      await runScenario('osm-on-minimal-overlays', {
        labels: false,
        osm: true,
        inputPoints: false,
        obstacles: false,
        blockedAreas: false,
      }),
    ];

    const warmPan = findScenarioAction(results, 'osm-on-all-overlays', ':pan-fast');
    expect(warmPan.metadata['map:basemap-mode']).toBe('osm');
    expect(
      Number(warmPan.counters['tiles:loaded'] ?? 0) +
        Number(warmPan.counters['tiles:request-reused'] ?? 0),
    ).toBeGreaterThan(0);
    expect(Number(warmPan.counters['tiles:resolved'] ?? 0)).toBeGreaterThan(0);

    const minimalPanMedium = findScenarioAction(
      results,
      'osm-on-minimal-overlays',
      ':pan-medium',
    );
    expect(Number(minimalPanMedium.counters['svg:renders'] ?? 0)).toBeLessThanOrEqual(56);
    expect(Number(minimalPanMedium.counters['tiles:descriptor-rebuilds'] ?? 0)).toBeLessThanOrEqual(5);
    expect(Number(minimalPanMedium.counters['tiles:resolve-cache-misses'] ?? 0)).toBeLessThanOrEqual(20);

    const minimalZoomInFast = findScenarioAction(
      results,
      'osm-on-minimal-overlays',
      ':zoom-in-fast',
    );
    expect(Number(minimalZoomInFast.counters['tiles:resolved'] ?? 0)).toBeLessThanOrEqual(4000);
    expect(Number(minimalZoomInFast.counters['map:schedule-layer-render'] ?? 0)).toBeLessThanOrEqual(50);
    expect(Number(minimalZoomInFast.counters['tiles:descriptor-rebuilds'] ?? 0)).toBeLessThanOrEqual(5);
    expect(Number(minimalZoomInFast.counters['webgl:renders'] ?? 0)).toBeLessThanOrEqual(40);

    const artifact = {
      capturedAt: new Date().toISOString(),
      pageErrors,
      results,
    };
    console.log(JSON.stringify(artifact, null, 2));
    await attachJson(testInfo, 'map-basemap-profile', artifact);
    expect(pageErrors).toEqual([]);
  });
});
