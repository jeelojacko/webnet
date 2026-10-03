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
});
