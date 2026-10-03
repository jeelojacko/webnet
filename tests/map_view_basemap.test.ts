import { describe, expect, it } from 'vitest';

import {
  buildRequestedBasemapTiles,
  chooseOsmTileMeshDivisions,
  resolveInteractiveBasemapTiles,
  reusePreviousTilesForDeepFallback,
} from '../src/components/mapView/mapViewBasemap';

describe('chooseOsmTileMeshDivisions', () => {
  it('keeps distant tiles light and increases density as on-screen tile size grows', () => {
    expect(chooseOsmTileMeshDivisions(120, 140)).toBe(1);
    expect(chooseOsmTileMeshDivisions(220, 260)).toBe(2);
    expect(chooseOsmTileMeshDivisions(360, 420)).toBe(3);
    expect(chooseOsmTileMeshDivisions(520, 540)).toBe(4);
    expect(chooseOsmTileMeshDivisions(760, 760)).toBe(5);
  });

  it('drops to a lighter mesh while interacting so pan and zoom stay responsive', () => {
    expect(chooseOsmTileMeshDivisions(120, 140, true)).toBe(1);
    expect(chooseOsmTileMeshDivisions(220, 260, true)).toBe(1);
    expect(chooseOsmTileMeshDivisions(520, 540, true)).toBe(2);
    expect(chooseOsmTileMeshDivisions(760, 760, true)).toBe(2);
  });

  it('keeps the last settled basemap tile set active during live interaction when available', () => {
    const liveTiles = ['live-a', 'live-b'];
    const stableTiles = ['stable-a'];
    expect(resolveInteractiveBasemapTiles(liveTiles, stableTiles, 'interacting')).toEqual(
      stableTiles,
    );
    expect(resolveInteractiveBasemapTiles(liveTiles, stableTiles, 'settling')).toEqual(liveTiles);
    expect(resolveInteractiveBasemapTiles(liveTiles, [], 'interacting')).toEqual(liveTiles);
  });

  it('prefetches an extra basemap ring only while idle and preserves the render-tile order', () => {
    const renderTiles = [{ key: 'a' }, { key: 'b' }];
    const prefetchedTiles = [{ key: 'b' }, { key: 'c' }, { key: 'd' }];
    expect(buildRequestedBasemapTiles(renderTiles, prefetchedTiles, 'idle')).toEqual([
      { key: 'a' },
      { key: 'b' },
      { key: 'c' },
      { key: 'd' },
    ]);
    expect(buildRequestedBasemapTiles(renderTiles, prefetchedTiles, 'interacting')).toEqual(
      renderTiles,
    );
  });

  it('reuses previous tiles only for deep-fallback keys and keeps fresh exact tiles', () => {
    type FallbackTile = { key: string; fallbackPreferred?: boolean };
    const exact: FallbackTile = { key: '6-a', fallbackPreferred: true };
    const deep: FallbackTile = { key: '6-b', fallbackPreferred: false };
    const newDeep: FallbackTile = { key: '6-c', fallbackPreferred: false };
    const previousForB: FallbackTile = { key: '6-b', fallbackPreferred: true };
    const staleOffscreen: FallbackTile = { key: '6-old', fallbackPreferred: true };

    const renderTiles = reusePreviousTilesForDeepFallback(
      [exact, deep, newDeep],
      [previousForB, staleOffscreen],
    );

    expect(renderTiles).toEqual([exact, previousForB, newDeep]);
    expect(renderTiles[1]).toBe(previousForB);
    expect(renderTiles).not.toContain(staleOffscreen);
  });

  it('returns the resolved set unchanged when no deep fallback can be rehomed', () => {
    type FallbackTile = { key: string; fallbackPreferred?: boolean };
    const resolved: FallbackTile[] = [{ key: '6-a', fallbackPreferred: true }];
    expect(reusePreviousTilesForDeepFallback(resolved, [{ key: '6-x' }])).toBe(resolved);
    expect(reusePreviousTilesForDeepFallback(resolved, [])).toBe(resolved);
  });

  it('reuses a previous parent surface across a zoom-level boundary via spatial ancestry', () => {
    type SpatialTile = {
      key: string;
      zoom: number;
      tileX: number;
      tileY: number;
      fallbackPreferred?: boolean;
    };
    // floor(21 / 2) === 10 and floor(24 / 2) === 12, so z5 5-10-12 is the
    // parent of both z6 children below.
    const previousParent: SpatialTile = {
      key: '5-10-12',
      zoom: 5,
      tileX: 10,
      tileY: 12,
      fallbackPreferred: true,
    };
    const deepChildA: SpatialTile = {
      key: '6-20-24',
      zoom: 6,
      tileX: 20,
      tileY: 24,
      fallbackPreferred: false,
    };
    const deepChildB: SpatialTile = {
      key: '6-21-24',
      zoom: 6,
      tileX: 21,
      tileY: 24,
      fallbackPreferred: false,
    };
    const exact: SpatialTile = {
      key: '6-22-24',
      zoom: 6,
      tileX: 22,
      tileY: 24,
      fallbackPreferred: true,
    };

    const renderTiles = reusePreviousTilesForDeepFallback(
      [exact, deepChildA, deepChildB],
      [previousParent],
    );

    // Deduped to a single reused parent surface; no stretched child slices.
    expect(renderTiles).toEqual([exact, previousParent]);
    expect(renderTiles[1]).toBe(previousParent);
    expect(renderTiles).not.toContain(deepChildA);
    expect(renderTiles).not.toContain(deepChildB);
  });

  it('prefers the finest covering previous surface and keeps unmatched deep tiles', () => {
    type SpatialTile = {
      key: string;
      zoom: number;
      tileX: number;
      tileY: number;
      fallbackPreferred?: boolean;
      fallbackZoomDelta?: number;
    };
    const grandparent: SpatialTile = {
      key: '4-5-6',
      zoom: 4,
      tileX: 5,
      tileY: 6,
      fallbackPreferred: true,
    };
    const parent: SpatialTile = {
      key: '5-10-12',
      zoom: 5,
      tileX: 10,
      tileY: 12,
      fallbackPreferred: true,
    };
    const deep: SpatialTile = {
      key: '6-21-24',
      zoom: 6,
      tileX: 21,
      tileY: 24,
      fallbackPreferred: false,
      fallbackZoomDelta: 2,
    };
    const uncovered: SpatialTile = {
      key: '6-0-0',
      zoom: 6,
      tileX: 0,
      tileY: 0,
      fallbackPreferred: false,
      fallbackZoomDelta: 3,
    };
    const shallow: SpatialTile = {
      key: '6-22-24',
      zoom: 6,
      tileX: 22,
      tileY: 24,
      fallbackPreferred: false,
      fallbackZoomDelta: 1,
    };

    const renderTiles = reusePreviousTilesForDeepFallback(
      [deep, uncovered, shallow],
      [grandparent, parent],
    );

    // Finest (z5) parent wins; unmatched deep tile keeps offline coverage;
    // shallow (delta <= 1) fallback is left untouched.
    expect(renderTiles).toEqual([parent, uncovered, shallow]);
    expect(renderTiles[0]).toBe(parent);
  });
});
