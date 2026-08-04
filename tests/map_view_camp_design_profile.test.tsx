/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  matrix,
  printProfileSummary,
  profileScenarioSweep,
  type SweepSummary,
} from './mapViewCampDesignProfileTestSupport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MapView Camp Design performance profiling harness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    (globalThis as { __WEBNET_ENABLE_MAP_PERF_CAPTURE__?: boolean }).__WEBNET_ENABLE_MAP_PERF_CAPTURE__ =
      false;
    (globalThis as { __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean }).__WEBNET_ENABLE_WEBGL_RENDER_TEST__ =
      false;
    (globalThis as { __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean }).__WEBNET_ENABLE_CANVAS_RENDER_TEST__ =
      false;
  });

  it(
    'profiles Camp Design map pan/zoom sweeps across feature toggles and renderer modes',
    async () => {
      const rows: SweepSummary[] = [];
      for (const renderer of ['webgl', 'canvas'] as const) {
        for (const scenario of matrix.scenarios) {
          for (const sweep of matrix.sweeps) {
            rows.push(await profileScenarioSweep(renderer, scenario, sweep));
          }
        }
      }

      printProfileSummary(rows);

      expect(rows).toHaveLength(2 * matrix.scenarios.length * matrix.sweeps.length);
      expect(rows.every((row) => row.topTimingNames.length > 0)).toBe(true);
      expect(
        rows.every(
          (row) =>
            typeof row.metadata['map:renderer2d'] === 'string' &&
            typeof row.metadata['map:visible-point-count'] === 'number' &&
            typeof row.metadata['map:visible-line-count'] === 'number',
        ),
      ).toBe(true);

      const allOnWebglPan = rows.find(
        (row) => row.renderer === 'webgl' && row.scenarioId === 'all_on' && row.sweepId === 'pan_fast',
      );
      const basemapOffWebglPan = rows.find(
        (row) =>
          row.renderer === 'webgl' && row.scenarioId === 'basemap_off' && row.sweepId === 'pan_fast',
      );
      const minimalWebglPan = rows.find(
        (row) => row.renderer === 'webgl' && row.scenarioId === 'minimal' && row.sweepId === 'pan_fast',
      );
      const allOnCanvasZoom = rows.find(
        (row) => row.renderer === 'canvas' && row.scenarioId === 'all_on' && row.sweepId === 'zoom_fast',
      );

      expect(allOnWebglPan).toBeTruthy();
      expect(basemapOffWebglPan).toBeTruthy();
      expect(minimalWebglPan).toBeTruthy();
      expect(allOnCanvasZoom).toBeTruthy();
      if (!allOnWebglPan || !basemapOffWebglPan || !minimalWebglPan || !allOnCanvasZoom) {
        throw new Error('Expected profiling reference rows');
      }

      expect(allOnWebglPan.metadata['map:renderer2d']).toBe('webgl');
      expect(allOnCanvasZoom.metadata['map:renderer2d']).toBe('canvas');
      expect((allOnWebglPan.counters['tiles:requested-descriptors'] ?? 0)).toBeGreaterThan(0);
      expect((basemapOffWebglPan.counters['tiles:requested-descriptors'] ?? 0)).toBe(0);
      expect((allOnWebglPan.metadata['map:planning-polygon-count'] as number) ?? 0).toBeGreaterThan(
        (minimalWebglPan.metadata['map:planning-polygon-count'] as number) ?? 0,
      );
      expect((allOnCanvasZoom.counters['map:wheel-events'] ?? 0)).toBeGreaterThan(0);
      expect(
        rows.some(
          (row) =>
            row.topTimingNames.includes('svg:render') ||
            row.topTimingNames.includes('map:build-visible-labels') ||
            row.topTimingNames.includes('map:filter-base-lines') ||
            row.topTimingNames.includes('map:filter-base-points') ||
            row.topTimingNames.includes('webgl:render') ||
            row.topTimingNames.includes('canvas:planning'),
        ),
      ).toBe(true);
    },
    120000,
  );
});
