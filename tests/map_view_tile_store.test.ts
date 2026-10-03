import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MapViewTileStore,
  type BasemapTileDescriptor2d,
} from '../src/components/mapView/mapViewTileStore';

describe('MapViewTileStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves an exact loaded tile without fallback', () => {
    const store = new MapViewTileStore(32);
    const image = { naturalWidth: 256, naturalHeight: 256 } as HTMLImageElement;
    const descriptor: BasemapTileDescriptor2d = {
      key: '5-10-12',
      href: 'https://tile/5/10/12.png',
      zoom: 5,
      tileX: 10,
      tileY: 12,
      meshColumns: 1,
      meshRows: 1,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 256 },
        { x: 256, y: 256 },
      ],
    };
    const entryMap = store as unknown as {
      entries: Map<string, { image: HTMLImageElement | null; status: string; lastAccessTick: number }>;
    };
    entryMap.entries.set(descriptor.key, {
      key: descriptor.key,
      href: descriptor.href,
      zoom: descriptor.zoom,
      tileX: descriptor.tileX,
      tileY: descriptor.tileY,
      image,
      status: 'loaded',
      lastAccessTick: 1,
    } as never);

    const renderTiles = store.resolveRenderTiles([descriptor]);
    expect(renderTiles).toHaveLength(1);
    expect(renderTiles[0]?.image).toBe(image);
    expect(renderTiles[0]?.fallbackZoomDelta).toBe(0);
    expect(renderTiles[0]?.sourceX).toBe(0);
    expect(renderTiles[0]?.sourceY).toBe(0);
  });

  it('falls back to a loaded parent tile crop when the exact tile is unavailable', () => {
    const store = new MapViewTileStore(32);
    const parentImage = { naturalWidth: 256, naturalHeight: 256 } as HTMLImageElement;
    const childDescriptor: BasemapTileDescriptor2d = {
      key: '6-21-24',
      href: 'https://tile/6/21/24.png',
      zoom: 6,
      tileX: 21,
      tileY: 24,
      meshColumns: 1,
      meshRows: 1,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 256 },
        { x: 256, y: 256 },
      ],
    };
    const entryMap = store as unknown as {
      entries: Map<string, { image: HTMLImageElement | null; status: string; lastAccessTick: number }>;
    };
    entryMap.entries.set('5-10-12', {
      key: '5-10-12',
      href: 'https://tile/5/10/12.png',
      zoom: 5,
      tileX: 10,
      tileY: 12,
      image: parentImage,
      status: 'loaded',
      lastAccessTick: 1,
    } as never);

    const renderTiles = store.resolveRenderTiles([childDescriptor]);
    expect(renderTiles).toHaveLength(1);
    expect(renderTiles[0]?.image).toBe(parentImage);
    expect(renderTiles[0]?.fallbackZoomDelta).toBe(1);
    expect(renderTiles[0]?.sourceWidth).toBe(128);
    expect(renderTiles[0]?.sourceHeight).toBe(128);
    expect(renderTiles[0]?.sourceX).toBe(128);
    expect(renderTiles[0]?.sourceY).toBe(0);
  });

  it('prefers a one-level parent over a deeper cached parent during a transform', () => {
    const store = new MapViewTileStore(32);
    const oneLevelImage = { naturalWidth: 256, naturalHeight: 256 } as HTMLImageElement;
    const deepImage = { naturalWidth: 256, naturalHeight: 256 } as HTMLImageElement;
    const descriptor: BasemapTileDescriptor2d = {
      key: '6-21-24',
      href: 'https://tile/6/21/24.png',
      zoom: 6,
      tileX: 21,
      tileY: 24,
      meshColumns: 1,
      meshRows: 1,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 256 },
        { x: 256, y: 256 },
      ],
    };
    const entryMap = store as unknown as {
      entries: Map<string, { image: HTMLImageElement | null; status: string; lastAccessTick: number }>;
    };
    entryMap.entries.set('5-10-12', {
      key: '5-10-12',
      href: 'https://tile/5/10/12.png',
      zoom: 5,
      tileX: 10,
      tileY: 12,
      image: oneLevelImage,
      status: 'loaded',
      lastAccessTick: 1,
    } as never);
    entryMap.entries.set('4-5-6', {
      key: '4-5-6',
      href: 'https://tile/4/5/6.png',
      zoom: 4,
      tileX: 5,
      tileY: 6,
      image: deepImage,
      status: 'loaded',
      lastAccessTick: 2,
    } as never);

    const renderTiles = store.resolveRenderTiles([descriptor]);

    expect(renderTiles).toHaveLength(1);
    expect(renderTiles[0]?.image).toBe(oneLevelImage);
    expect(renderTiles[0]?.fallbackZoomDelta).toBe(1);
    expect(renderTiles[0]?.fallbackPreferred).toBe(true);
  });

  it('keeps a deep cached parent for offline coverage and flags it as not preferred', () => {
    const store = new MapViewTileStore(32);
    const deepImage = { naturalWidth: 256, naturalHeight: 256 } as HTMLImageElement;
    const descriptor: BasemapTileDescriptor2d = {
      key: '6-21-24',
      href: 'https://tile/6/21/24.png',
      zoom: 6,
      tileX: 21,
      tileY: 24,
      meshColumns: 1,
      meshRows: 1,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 256 },
        { x: 256, y: 256 },
      ],
    };
    const entryMap = store as unknown as {
      entries: Map<string, { image: HTMLImageElement | null; status: string; lastAccessTick: number }>;
    };
    entryMap.entries.set('4-5-6', {
      key: '4-5-6',
      href: 'https://tile/4/5/6.png',
      zoom: 4,
      tileX: 5,
      tileY: 6,
      image: deepImage,
      status: 'loaded',
      lastAccessTick: 2,
    } as never);

    const renderTiles = store.resolveRenderTiles([descriptor]);

    expect(renderTiles).toHaveLength(1);
    expect(renderTiles[0]?.image).toBe(deepImage);
    expect(renderTiles[0]?.fallbackZoomDelta).toBe(2);
    expect(renderTiles[0]?.fallbackPreferred).toBe(false);
    expect(renderTiles[0]?.sourceWidth).toBe(64);
    expect(renderTiles[0]?.sourceHeight).toBe(64);
  });

  it('resolves a half-level-offset descriptor crop against its one-level parent', () => {
    const store = new MapViewTileStore(32);
    const parentImage = { naturalWidth: 256, naturalHeight: 256 } as HTMLImageElement;
    const descriptor: BasemapTileDescriptor2d = {
      key: '7-42-48',
      href: 'https://tile/7/42/48.png',
      zoom: 7,
      tileX: 42,
      tileY: 48,
      meshColumns: 1,
      meshRows: 1,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 256 },
        { x: 256, y: 256 },
      ],
    };
    const entryMap = store as unknown as {
      entries: Map<string, { image: HTMLImageElement | null; status: string; lastAccessTick: number }>;
    };
    entryMap.entries.set('6-21-24', {
      key: '6-21-24',
      href: 'https://tile/6/21/24.png',
      zoom: 6,
      tileX: 21,
      tileY: 24,
      image: parentImage,
      status: 'loaded',
      lastAccessTick: 1,
    } as never);

    const renderTiles = store.resolveRenderTiles([descriptor]);

    expect(renderTiles).toHaveLength(1);
    expect(renderTiles[0]?.fallbackZoomDelta).toBe(1);
    expect(renderTiles[0]?.fallbackPreferred).toBe(true);
    expect(renderTiles[0]?.sourceWidth).toBe(128);
    expect(renderTiles[0]?.sourceHeight).toBe(128);
    expect(renderTiles[0]?.sourceX).toBe(0);
    expect(renderTiles[0]?.sourceY).toBe(0);
  });

  it('honours a zero preferred fallback delta when the caller requires exact-only during transform', () => {
    const store = new MapViewTileStore(32);
    const parentImage = { naturalWidth: 256, naturalHeight: 256 } as HTMLImageElement;
    const descriptor: BasemapTileDescriptor2d = {
      key: '6-21-24',
      href: 'https://tile/6/21/24.png',
      zoom: 6,
      tileX: 21,
      tileY: 24,
      meshColumns: 1,
      meshRows: 1,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 256 },
        { x: 256, y: 256 },
      ],
    };
    const entryMap = store as unknown as {
      entries: Map<string, { image: HTMLImageElement | null; status: string; lastAccessTick: number }>;
    };
    entryMap.entries.set('5-10-12', {
      key: '5-10-12',
      href: 'https://tile/5/10/12.png',
      zoom: 5,
      tileX: 10,
      tileY: 12,
      image: parentImage,
      status: 'loaded',
      lastAccessTick: 1,
    } as never);

    const renderTiles = store.resolveRenderTiles([descriptor], {
      preferredFallbackZoomDelta: 0,
    });

    expect(renderTiles).toHaveLength(1);
    expect(renderTiles[0]?.fallbackZoomDelta).toBe(1);
    expect(renderTiles[0]?.fallbackPreferred).toBe(false);
  });

  it('requests basemap images without anonymous CORS so canvas OSM tiles still load', () => {
    const store = new MapViewTileStore(32);
    const descriptor: BasemapTileDescriptor2d = {
      key: '6-21-24',
      href: 'https://tile/6/21/24.png',
      zoom: 6,
      tileX: 21,
      tileY: 24,
      meshColumns: 1,
      meshRows: 1,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 256 },
        { x: 256, y: 256 },
      ],
    };
    const created: Array<{ crossOrigin?: string | null; src?: string }> = [];

    class FakeImage {
      public decoding = '';

      public crossOrigin: string | null = null;

      public onload: null | (() => void) = null;

      public onerror: null | (() => void) = null;

      private _src = '';

      set src(value: string) {
        this._src = value;
      }

      get src(): string {
        return this._src;
      }

      constructor() {
        created.push(this);
      }
    }

    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
    store.requestTiles([descriptor], () => {});

    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(descriptor.href);
    expect(created[0]?.crossOrigin).toBeNull();
  });

  it('supports anonymous CORS requests for WebGL texture-backed tiles', () => {
    const store = new MapViewTileStore(32);
    const descriptor: BasemapTileDescriptor2d = {
      key: '6-21-24',
      href: 'https://tile/6/21/24.png',
      zoom: 6,
      tileX: 21,
      tileY: 24,
      meshColumns: 1,
      meshRows: 1,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 256 },
        { x: 256, y: 256 },
      ],
    };
    const created: Array<{ crossOrigin?: string | null; src?: string }> = [];

    class FakeImage {
      public decoding = '';

      public crossOrigin: string | null = null;

      public onload: null | (() => void) = null;

      public onerror: null | (() => void) = null;

      private _src = '';

      set src(value: string) {
        this._src = value;
      }

      get src(): string {
        return this._src;
      }

      constructor() {
        created.push(this);
      }
    }

    vi.stubGlobal('Image', FakeImage as unknown as typeof Image);
    store.requestTiles([descriptor], () => {}, { crossOrigin: 'anonymous' });

    expect(created).toHaveLength(1);
    expect(created[0]?.src).toBe(descriptor.href);
    expect(created[0]?.crossOrigin).toBe('anonymous');
  });

  it('reuses resolved tile surfaces from cache when descriptors and tile state are unchanged', () => {
    const store = new MapViewTileStore(32);
    const image = { naturalWidth: 256, naturalHeight: 256 } as HTMLImageElement;
    const descriptor: BasemapTileDescriptor2d = {
      key: '5-10-12',
      href: 'https://tile/5/10/12.png',
      zoom: 5,
      tileX: 10,
      tileY: 12,
      meshColumns: 1,
      meshRows: 1,
      meshPoints: [
        { x: 0, y: 0 },
        { x: 256, y: 0 },
        { x: 0, y: 256 },
        { x: 256, y: 256 },
      ],
    };
    const entryMap = store as unknown as {
      entries: Map<string, { image: HTMLImageElement | null; status: string; lastAccessTick: number }>;
    };
    entryMap.entries.set(descriptor.key, {
      key: descriptor.key,
      href: descriptor.href,
      zoom: descriptor.zoom,
      tileX: descriptor.tileX,
      tileY: descriptor.tileY,
      image,
      status: 'loaded',
      lastAccessTick: 1,
    } as never);

    const first = store.resolveRenderTiles([descriptor]);
    const second = store.resolveRenderTiles([descriptor]);

    expect(second).toBe(first);
  });

  it('keeps recently revisited tiles in memory when eviction trims older off-screen tiles', () => {
    const store = new MapViewTileStore(16);
    const entryMap = store as unknown as {
      entries: Map<string, { status: string; lastAccessTick: number }>;
      evictIfNeeded: () => void;
    };
    for (let index = 0; index < 16; index += 1) {
      entryMap.entries.set(`0-${index}-0`, {
        key: `0-${index}-0`,
        status: 'evictable',
        lastAccessTick: index + 1,
        crossOrigin: null,
      } as never);
    }
    entryMap.entries.set('0-15-0', {
      key: '0-15-0',
      status: 'visible',
      lastAccessTick: 32,
      crossOrigin: null,
    } as never);
    entryMap.entries.set('0-16-0', {
      key: '0-16-0',
      status: 'requested',
      lastAccessTick: 33,
      crossOrigin: null,
    } as never);

    entryMap.evictIfNeeded();

    expect(entryMap.entries.has('0-15-0')).toBe(true);
    expect(entryMap.entries.has('0-16-0')).toBe(true);
    expect(entryMap.entries.size).toBe(16);
    expect(
      Number(entryMap.entries.has('0-0-0')) + Number(entryMap.entries.has('0-1-0')),
    ).toBeLessThan(2);
  });
});
