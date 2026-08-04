import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

export type HarnessPerfSnapshot = {
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

export type HarnessState = {
  showLabels: boolean;
  basemapMode: 'none' | 'osm';
  showInputPoints: boolean;
  showObstacleLayer: boolean;
  showBlockedAreas: boolean;
};

export type ToggleState = {
  labels: boolean;
  osm: boolean;
  inputPoints: boolean;
  obstacles: boolean;
  blockedAreas: boolean;
};

export type SweepSummary = {
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

export const TEST_TILE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn4xXkAAAAASUVORK5CYII=';

export const mockOsmTiles = async (page: Page) => {
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

export const getHarnessState = async (page: Page): Promise<HarnessState> =>
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

export const resetPerfCapture = async (
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

export const getPerfCapture = async (page: Page): Promise<HarnessPerfSnapshot> =>
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

export const waitForMapIdle = async (page: Page) => {
  const map = page.locator('[data-map-interaction-phase]');
  await expect(map).toHaveAttribute('data-map-interaction-phase', 'idle');
};

export const waitForOsmTilesReady = async (page: Page) => {
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

export const setToggle = async (page: Page, testId: string, checked: boolean) => {
  const locator = page.getByTestId(testId);
  if (checked) {
    await locator.check();
  } else {
    await locator.uncheck();
  }
};

export const applyToggleState = async (page: Page, state: ToggleState) => {
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

export const dispatchMiddleMouse = async (
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

export const runPanSweep = async (
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

export const runZoomSweep = async (
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

export const buildTopTimings = (capture: HarnessPerfSnapshot): SweepSummary['topTimings'] => {
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

export const measureAction = async (
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

export const attachJson = async (testInfo: TestInfo, name: string, data: unknown) => {
  const body = Buffer.from(JSON.stringify(data, null, 2));
  await testInfo.attach(name, {
    body,
    contentType: 'application/json',
  });
  await writeFile(testInfo.outputPath(`${name}.json`), body);
};

export const findScenarioAction = (
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
