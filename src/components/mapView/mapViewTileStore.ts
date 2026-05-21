import {
  measureMapViewPerf,
  noteMapViewPerfCounter,
  noteMapViewPerfMetadata,
} from './mapViewPerf';

export type BasemapTileLifecycleState =
  | 'requested'
  | 'loaded'
  | 'uploaded'
  | 'visible'
  | 'evictable';

export interface BasemapTileDescriptor2d {
  key: string;
  href: string;
  zoom: number;
  tileX: number;
  tileY: number;
  meshColumns: number;
  meshRows: number;
  meshPoints: Array<{ x: number; y: number }>;
}

export interface BasemapTileRenderSurface2d extends BasemapTileDescriptor2d {
  image: HTMLImageElement;
  sourceX: number;
  sourceY: number;
  sourceWidth: number;
  sourceHeight: number;
  fallbackZoomDelta: number;
}

interface TileStoreEntry {
  key: string;
  href: string;
  zoom: number;
  tileX: number;
  tileY: number;
  crossOrigin: string | null;
  status: BasemapTileLifecycleState;
  image: HTMLImageElement | null;
  lastAccessTick: number;
}

const DEFAULT_MAX_TILE_ENTRIES = 384;

const buildParentKey = (zoom: number, tileX: number, tileY: number): string =>
  `${zoom}-${tileX}-${tileY}`;

const buildDescriptorSignature = (descriptors: BasemapTileDescriptor2d[]): string =>
  descriptors
    .map(
      (descriptor) =>
        `${descriptor.key}:${descriptor.meshColumns}:${descriptor.meshRows}:${descriptor.meshPoints.length}`,
    )
    .join('|');

export class MapViewTileStore {
  private readonly maxEntries: number;

  private readonly entries = new Map<string, TileStoreEntry>();

  private readonly resolvedCache = new Map<
    string,
    { version: number; tiles: BasemapTileRenderSurface2d[] }
  >();

  private tick = 0;

  private version = 0;

  constructor(maxEntries = DEFAULT_MAX_TILE_ENTRIES) {
    this.maxEntries = Math.max(16, maxEntries);
  }

  clear(): void {
    this.entries.clear();
    this.resolvedCache.clear();
    this.version += 1;
  }

  markAllEvictable(): void {
    let mutated = false;
    this.entries.forEach((entry) => {
      if (entry.status === 'visible' || entry.status === 'uploaded') {
        entry.status = 'evictable';
        mutated = true;
      }
    });
    if (mutated) this.version += 1;
  }

  markUploaded(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.status = 'uploaded';
    entry.lastAccessTick = this.tick;
    this.version += 1;
  }

  requestTiles(
    descriptors: BasemapTileDescriptor2d[],
    onTileReady: (_key: string) => void,
    options?: { crossOrigin?: 'anonymous' | null },
  ): void {
    measureMapViewPerf('tiles:request', () => {
      if (typeof Image === 'undefined') return;
      this.tick += 1;
      noteMapViewPerfCounter('tiles:request-batches');
      noteMapViewPerfCounter('tiles:requested-descriptors', descriptors.length);
      noteMapViewPerfMetadata('tiles:last-requested-descriptor-count', descriptors.length);
      const requestedCrossOrigin = options?.crossOrigin ?? null;
      descriptors.forEach((descriptor) => {
        const existing = this.entries.get(descriptor.key);
        if (existing && existing.crossOrigin === requestedCrossOrigin) {
          existing.lastAccessTick = this.tick;
          if (
            existing.status === 'evictable' ||
            existing.status === 'loaded' ||
            existing.status === 'uploaded'
          ) {
            existing.status = 'visible';
          }
          noteMapViewPerfCounter('tiles:request-reused');
          return;
        }
        if (existing && existing.crossOrigin !== requestedCrossOrigin) {
          this.entries.delete(descriptor.key);
          noteMapViewPerfCounter('tiles:request-replaced');
          this.version += 1;
        }
        const image = new Image();
        image.decoding = 'async';
        if ('loading' in image) {
          (image as HTMLImageElement & { loading?: string }).loading = 'eager';
        }
        if ('fetchPriority' in image) {
          (image as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'high';
        }
        image.crossOrigin = requestedCrossOrigin;
        const entry: TileStoreEntry = {
          key: descriptor.key,
          href: descriptor.href,
          zoom: descriptor.zoom,
          tileX: descriptor.tileX,
          tileY: descriptor.tileY,
          crossOrigin: requestedCrossOrigin,
          status: 'requested',
          image: null,
          lastAccessTick: this.tick,
        };
        this.entries.set(descriptor.key, entry);
        this.version += 1;
        image.onload = () => {
          const current = this.entries.get(descriptor.key);
          if (!current) return;
          current.image = image;
          current.status = 'loaded';
          current.lastAccessTick = this.tick;
          this.version += 1;
          noteMapViewPerfCounter('tiles:loaded');
          onTileReady(descriptor.key);
        };
        image.onerror = () => {
          const current = this.entries.get(descriptor.key);
          if (!current) return;
          current.status = 'evictable';
          current.lastAccessTick = this.tick;
          this.version += 1;
          noteMapViewPerfCounter('tiles:error');
        };
        image.src = descriptor.href;
      });
      this.evictIfNeeded();
    });
  }

  resolveRenderTiles(
    descriptors: BasemapTileDescriptor2d[],
  ): BasemapTileRenderSurface2d[] {
    return measureMapViewPerf('tiles:resolve', () => {
      this.tick += 1;
      const signature = buildDescriptorSignature(descriptors);
      const cached = this.resolvedCache.get(signature);
      if (cached && cached.version === this.version) {
        noteMapViewPerfCounter('tiles:resolve-cache-hits');
        noteMapViewPerfMetadata('tiles:last-resolve-cache', 'hit');
        return cached.tiles;
      }
      noteMapViewPerfCounter('tiles:resolve-cache-misses');
      noteMapViewPerfMetadata('tiles:last-resolve-cache', 'miss');
      let fallbackCount = 0;
      const resolved = descriptors
        .map((descriptor) => {
          const exact = this.entries.get(descriptor.key);
          if (exact?.image) {
            exact.status = 'visible';
            exact.lastAccessTick = this.tick;
            return {
              ...descriptor,
              image: exact.image,
              sourceX: 0,
              sourceY: 0,
              sourceWidth: exact.image.naturalWidth || exact.image.width || 256,
              sourceHeight: exact.image.naturalHeight || exact.image.height || 256,
              fallbackZoomDelta: 0,
            };
          }
          const fallback = this.resolveParentFallback(descriptor);
          if (fallback) fallbackCount += 1;
          return fallback;
        })
        .filter((tile): tile is BasemapTileRenderSurface2d => tile != null);
      noteMapViewPerfCounter('tiles:resolved', resolved.length);
      noteMapViewPerfCounter('tiles:fallback-resolved', fallbackCount);
      noteMapViewPerfMetadata('tiles:last-fallback-resolved', fallbackCount);
      this.resolvedCache.set(signature, {
        version: this.version,
        tiles: resolved,
      });
      return resolved;
    });
  }

  snapshotMetrics(): {
    requestedCount: number;
    loadedCount: number;
    uploadedCount: number;
    visibleCount: number;
    evictableCount: number;
  } {
    let requestedCount = 0;
    let loadedCount = 0;
    let uploadedCount = 0;
    let visibleCount = 0;
    let evictableCount = 0;
    this.entries.forEach((entry) => {
      if (entry.status === 'requested') requestedCount += 1;
      if (entry.status === 'loaded') loadedCount += 1;
      if (entry.status === 'uploaded') uploadedCount += 1;
      if (entry.status === 'visible') visibleCount += 1;
      if (entry.status === 'evictable') evictableCount += 1;
    });
    return { requestedCount, loadedCount, uploadedCount, visibleCount, evictableCount };
  }

  private resolveParentFallback(
    descriptor: BasemapTileDescriptor2d,
  ): BasemapTileRenderSurface2d | null {
    for (let parentZoom = descriptor.zoom - 1; parentZoom >= 0; parentZoom -= 1) {
      const zoomDelta = descriptor.zoom - parentZoom;
      const scale = 2 ** zoomDelta;
      const parentTileX = Math.floor(descriptor.tileX / scale);
      const parentTileY = Math.floor(descriptor.tileY / scale);
      const parent = this.entries.get(buildParentKey(parentZoom, parentTileX, parentTileY));
      if (!parent?.image) continue;
      parent.status = 'visible';
      parent.lastAccessTick = this.tick;
      const imageWidth = parent.image.naturalWidth || parent.image.width || 256;
      const imageHeight = parent.image.naturalHeight || parent.image.height || 256;
      const sectionWidth = imageWidth / scale;
      const sectionHeight = imageHeight / scale;
      const localX = ((descriptor.tileX % scale) + scale) % scale;
      const localY = ((descriptor.tileY % scale) + scale) % scale;
      return {
        ...descriptor,
        image: parent.image,
        sourceX: localX * sectionWidth,
        sourceY: localY * sectionHeight,
        sourceWidth: sectionWidth,
        sourceHeight: sectionHeight,
        fallbackZoomDelta: zoomDelta,
      };
    }
    return null;
  }

  private evictIfNeeded(): void {
    if (this.entries.size <= this.maxEntries) return;
    const removable = [...this.entries.values()]
      .filter(
        (entry) =>
          entry.status === 'evictable' ||
          entry.status === 'loaded' ||
          entry.status === 'uploaded',
      )
      .sort((left, right) => left.lastAccessTick - right.lastAccessTick);
    for (const entry of removable) {
      if (this.entries.size <= this.maxEntries) break;
      this.entries.delete(entry.key);
      this.version += 1;
    }
  }
}
