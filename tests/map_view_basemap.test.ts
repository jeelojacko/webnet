import { describe, expect, it } from 'vitest';

import {
  buildRequestedBasemapTiles,
  chooseOsmTileMeshDivisions,
  resolveInteractiveBasemapTiles,
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
});
