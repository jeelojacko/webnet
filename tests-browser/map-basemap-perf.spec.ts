import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type HarnessPerfSnapshot = {
  label: string;
  metadata: Record<string, unknown>;
  counters: Record<string, number>;
  timings: Record<
    string,
    {
      count: number;
      totalMs: number;
      maxMs: number;
      minMs: number;
      lastMs: number;
      samplesMs: number[];
    }
  >;
} | null;

type HarnessState = {
  showLabels: boolean;
  basemapMode: 'none' | 'osm';
  showInputPoints: boolean;
  showObstacleLayer: boolean;
  showBlockedAreas: boolean;
};

type ToggleState = {
  labels: boolean;
  osm: boolean;
  inputPoints: boolean;
  obstacles: boolean;
  blockedAreas: boolean;
};

type SweepSummary = {
  actionId: string;
  elapsedMs: number;
  state: HarnessState;
  counters: Record<string, number>;
  metadata: Record<string, unknown>;
  topTimings: Array<{
    name: string;
    totalMs: number;
    count: number;
    maxMs: number;
  }>;
};

const TEST_TILE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn4xXkAAAAASUVORK5CYII=';

const mockOsmTiles = async (page: Page) => {
  await page.route('https://tile.openstreetmap.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from(TEST_TILE_PNG_BASE64, 'base64'),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=604800',
        ETag: '"webnet-playwright-osm-tile"',
      },
    });
  });
};

const getHarnessState = async (page: Page): Promise<HarnessState> =>
  page.evaluate(() => {
    const harness = (
      window as typeof window & {
        __WEBNET_MAP_HARNESS__?: { getState: () => HarnessState };
      }
    ).__WEBNET_MAP_HARNESS__;
    if (!harness) {
      throw new Error('map harness API not found');
    }
    return harness.getState();
  });

const resetPerfCapture = async (
  page: Page,
  label: string,
  metadata: Record<string, unknown> = {},
) => {
  await page.evaluate(
    ({ captureLabel, captureMetadata }) => {
      const harness = (
        window as typeof window & {
          __WEBNET_MAP_HARNESS__?: {
            setPerfCaptureEnabled: (_enabled: boolean) => void;
            resetPerf: (_label: string, _metadata?: Record<string, unknown>) => void;
          };
        }
      ).__WEBNET_MAP_HARNESS__;
      if (!harness) {
        throw new Error('map harness API not found');
      }
      harness.setPerfCaptureEnabled(true);
      harness.resetPerf(captureLabel, captureMetadata);
    },
    { captureLabel: label, captureMetadata: metadata },
  );
};

const getPerfCapture = async (page: Page): Promise<HarnessPerfSnapshot> =>
  page.evaluate(() => {
    const harness = (
      window as typeof window & {
        __WEBNET_MAP_HARNESS__?: { getPerf: () => HarnessPerfSnapshot };
      }
    ).__WEBNET_MAP_HARNESS__;
    if (!harness) {
      throw new Error('map harness API not found');
    }
    return harness.getPerf();
  });

const waitForMapIdle = async (page: Page) => {
  const map = page.locator('[data-map-interaction-phase]');
  await expect(map).toHaveAttribute('data-map-interaction-phase', 'idle');
};

const waitForOsmTilesReady = async (page: Page) => {
  await expect
    .poll(async () => {
      const capture = await getPerfCapture(page);
      const snapshot = capture?.metadata?.['tiles:snapshot'];
      if (
        !snapshot ||
        typeof snapshot !== 'object' ||
        snapshot === null ||
        !('loadedCount' in snapshot) ||
        !('visibleCount' in snapshot) ||
        !('uploadedCount' in snapshot)
      ) {
        return 0;
      }
      const tileSnapshot = snapshot as {
        loadedCount?: number;
        visibleCount?: number;
        uploadedCount?: number;
      };
      return (
        (tileSnapshot.loadedCount ?? 0) +
        (tileSnapshot.visibleCount ?? 0) +
        (tileSnapshot.uploadedCount ?? 0)
      );
    })
    .toBeGreaterThan(0);
};

const setToggle = async (page: Page, testId: string, checked: boolean) => {
  const locator = page.getByTestId(testId);
  if (checked) {
    await locator.check();
  } else {
    await locator.uncheck();
  }
};

const applyToggleState = async (page: Page, state: ToggleState) => {
  await setToggle(page, 'toggle-labels', state.labels);
  await setToggle(page, 'toggle-input-points', state.inputPoints);
  await setToggle(page, 'toggle-obstacles', state.obstacles);
  await setToggle(page, 'toggle-blocked', state.blockedAreas);
  await setToggle(page, 'toggle-osm', state.osm);
  await waitForMapIdle(page);
  if (state.osm) {
    await waitForOsmTilesReady(page);
  }
};

const dispatchMiddleMouse = async (
  page: Page,
  type: 'mousedown' | 'mousemove' | 'mouseup',
  clientX: number,
  clientY: number,
) => {
  await page.evaluate(
    ({ eventType, x, y }) => {
      const svgNode = document.querySelector('svg');
      if (!(svgNode instanceof SVGSVGElement)) {
        throw new Error('map svg not found');
      }
      const event = new MouseEvent(eventType, {
        button: 1,
        buttons: eventType === 'mouseup' ? 0 : 4,
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'which', {
        configurable: true,
        value: 2,
      });
      (eventType === 'mousedown' ? svgNode : window).dispatchEvent(event);
    },
    { eventType: type, x: clientX, y: clientY },
  );
};

const runPanSweep = async (
  page: Page,
  svgBox: { x: number; y: number; width: number; height: number },
  dxPerStep: number,
  dyPerStep: number,
  stepCount: number,
  pauseMs: number,
) => {
  const startX = svgBox.x + svgBox.width * 0.45;
  const startY = svgBox.y + svgBox.height * 0.45;
  await dispatchMiddleMouse(page, 'mousedown', startX, startY);
  for (let step = 1; step <= stepCount; step += 1) {
    await dispatchMiddleMouse(page, 'mousemove', startX + dxPerStep * step, startY + dyPerStep * step);
    if (pauseMs > 0) {
      await page.waitForTimeout(pauseMs);
    }
  }
  await dispatchMiddleMouse(
    page,
    'mouseup',
    startX + dxPerStep * stepCount,
    startY + dyPerStep * stepCount,
  );
  await waitForMapIdle(page);
};

const runZoomSweep = async (
  page: Page,
  svgBox: { x: number; y: number; width: number; height: number },
  deltaY: number,
  stepCount: number,
  pauseMs: number,
) => {
  const anchorX = svgBox.x + svgBox.width * 0.55;
  const anchorY = svgBox.y + svgBox.height * 0.45;
  for (let step = 0; step < stepCount; step += 1) {
    await page.evaluate(
      ({ x, y, wheelDeltaY }) => {
        const svgNode = document.querySelector('svg');
        if (!(svgNode instanceof SVGSVGElement)) {
          throw new Error('map svg not found');
        }
        svgNode.dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: wheelDeltaY,
            clientX: x,
            clientY: y,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { x: anchorX + (step % 3) * 10, y: anchorY + (step % 2) * 8, wheelDeltaY: deltaY },
    );
    if (pauseMs > 0) {
      await page.waitForTimeout(pauseMs);
    }
  }
  await waitForMapIdle(page);
};

const buildTopTimings = (capture: HarnessPerfSnapshot): SweepSummary['topTimings'] => {
  if (!capture) return [];
  return Object.entries(capture.timings)
    .map(([name, stat]) => ({
      name,
      totalMs: Number(stat.totalMs.toFixed(3)),
      count: stat.count,
      maxMs: Number(stat.maxMs.toFixed(3)),
    }))
    .sort((left, right) => right.totalMs - left.totalMs)
    .slice(0, 8);
};

const measureAction = async (
  page: Page,
  actionId: string,
  action: () => Promise<void>,
): Promise<SweepSummary> => {
  await resetPerfCapture(page, actionId, { actionId });
  const startedAt = Date.now();
  await action();
  await page.waitForTimeout(100);
  const capture = await getPerfCapture(page);
  return {
    actionId,
    elapsedMs: Date.now() - startedAt,
    state: await getHarnessState(page),
    counters: { ...(capture?.counters ?? {}) },
    metadata: { ...(capture?.metadata ?? {}) },
    topTimings: buildTopTimings(capture),
  };
};

const attachJson = async (testInfo: TestInfo, name: string, data: unknown) => {
  const body = Buffer.from(JSON.stringify(data, null, 2));
  await testInfo.attach(name, {
    body,
    contentType: 'application/json',
  });
  await writeFile(testInfo.outputPath(`${name}.json`), body);
};

const findScenarioAction = (
  results: Array<{ scenarioId: string; actions: SweepSummary[] }>,
  scenarioId: string,
  suffix: string,
): SweepSummary => {
  const scenario = results.find((result) => result.scenarioId === scenarioId);
  if (!scenario) {
    throw new Error(`missing ${scenarioId} result`);
  }
  const action = scenario.actions.find((entry) => entry.actionId.endsWith(suffix));
  if (!action) {
    throw new Error(`missing ${scenarioId} ${suffix} result`);
  }
  return action;
};

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
    expect(Number(minimalPanMedium.counters['tiles:descriptor-rebuilds'] ?? 0)).toBe(0);
    expect(Number(minimalPanMedium.counters['tiles:resolve-cache-misses'] ?? 0)).toBeLessThanOrEqual(16);

    const minimalZoomInFast = findScenarioAction(
      results,
      'osm-on-minimal-overlays',
      ':zoom-in-fast',
    );
    expect(Number(minimalZoomInFast.counters['tiles:resolved'] ?? 0)).toBeLessThanOrEqual(1950);
    expect(Number(minimalZoomInFast.counters['map:schedule-layer-render'] ?? 0)).toBeLessThanOrEqual(45);
    expect(Number(minimalZoomInFast.counters['tiles:descriptor-rebuilds'] ?? 0)).toBeLessThanOrEqual(5);
    expect(Number(minimalZoomInFast.counters['webgl:renders'] ?? 0)).toBeLessThanOrEqual(27);

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
