import type { CoordSystemMode, CrsProjectionModel } from '../../types';
import { inverseENToGeodetic, projectGeodeticToEN } from '../../engine/geodesy';
import {
  buildOsmDescriptorBucket,
  latitudeToTileY,
  longitudeToTileX,
  OSM_TILE_SIZE_PX,
  tileXToLongitude,
  tileYToLatitude,
  type MapInteractionPhase,
} from './mapViewInteraction';
import type { BasemapTileDescriptor2d } from './mapViewTileStore';

interface PlanningGeorefContext {
  originLatDeg: number;
  originLonDeg: number;
  model: CrsProjectionModel;
  coordSystemMode?: CoordSystemMode;
  crsId?: string;
}

interface BasemapTileBufferOptions {
  bbox: { minX: number; minY: number };
  descriptorView: { zoom: number; panX: number; panY: number };
  interactionPhase: MapInteractionPhase;
  planningGeorefContext: PlanningGeorefContext;
  projectPoint: (_x: number, _y: number) => { x: number; y: number };
  projection: { offsetX: number; offsetY: number; scale: number };
  tileBuffer: number;
  viewHeight: number;
  viewWidth: number;
}

type BasemapDescriptorViewOptions = Pick<
  BasemapTileBufferOptions,
  | 'bbox'
  | 'descriptorView'
  | 'interactionPhase'
  | 'planningGeorefContext'
  | 'projection'
  | 'viewHeight'
  | 'viewWidth'
>;

export const chooseOsmTileMeshDivisions = (
  tileWidthPx: number,
  tileHeightPx: number,
  interacting = false,
): number => {
  const maxSpanPx = Math.max(0, Math.abs(tileWidthPx), Math.abs(tileHeightPx));
  if (interacting) {
    if (maxSpanPx <= 320) return 1;
    return 2;
  }
  if (maxSpanPx <= 180) return 1;
  if (maxSpanPx <= 300) return 2;
  if (maxSpanPx <= 440) return 3;
  if (maxSpanPx <= 620) return 4;
  return 5;
};

export const resolveInteractiveBasemapTiles = <Tile>(
  liveTiles: Tile[],
  stableTiles: Tile[],
  interactionPhase: 'idle' | 'interacting' | 'settling',
  reuseStableDuringInteraction = true,
): Tile[] => {
  if (
    interactionPhase === 'interacting' &&
    reuseStableDuringInteraction &&
    stableTiles.length > 0
  ) {
    return stableTiles;
  }
  return liveTiles;
};

/**
 * E3(d): while a transform is in flight, a descriptor that only resolves to a
 * deep cached parent would stretch one text tile over several levels. Reuse a
 * previously rendered surface that spatially covers just those deep-fallback
 * tiles, so freshly resolved exact/current-level tiles are never discarded
 * along with them. Coverage is ancestry-based (tile keys embed the zoom, so
 * exact-key matching misses cross-zoom cases): a previous surface at zoom zp
 * covers requested (z, x, y) iff zp <= z, floor(x / 2^(z-zp)) == prev.tileX
 * (modulo 2^zp for wrapped X) and floor(y / 2^(z-zp)) == prev.tileY. The
 * previous surface is reused as-is; the per-frame map transform
 * scales/positions it naturally. One previous parent covering several current
 * children is emitted once (deduped by previous key). Tiles without a
 * spatial previous surface keep their resolved deep fallback (offline
 * coverage) instead of blanking.
 *
 * Paint-order contract: canvas and WebGL renderers both paint tiles in array
 * order, so later entries cover earlier ones. Reused previous parents (and
 * unmatched deep tiles, which are equally stale) are therefore emitted FIRST
 * as the under-layer, with exact/preferred tiles after them — otherwise a
 * stale parent painted after a fresh exact child would cover it. Within the
 * under-layer, reused parents are sorted by key (deterministic) and unmatched
 * deep tiles keep their original relative order; exact tiles keep theirs.
 */
interface DeepFallbackTile {
  key: string;
  fallbackPreferred?: boolean;
  fallbackZoomDelta?: number;
  zoom?: number;
  tileX?: number;
  tileY?: number;
}

const parseTileKeyCoords = (key: string): { zoom: number; tileX: number; tileY: number } | null => {
  const [zoom, tileX, tileY] = key.split('-').map(Number);
  if (
    !Number.isInteger(zoom) ||
    !Number.isInteger(tileX) ||
    !Number.isInteger(tileY)
  ) {
    return null;
  }
  return { zoom, tileX, tileY };
};

const resolveTileCoords = (
  tile: DeepFallbackTile,
): { zoom: number; tileX: number; tileY: number } | null => {
  if (Number.isInteger(tile.zoom) && Number.isInteger(tile.tileX) && Number.isInteger(tile.tileY)) {
    return { zoom: tile.zoom as number, tileX: tile.tileX as number, tileY: tile.tileY as number };
  }
  return parseTileKeyCoords(tile.key);
};

const isDeepFallbackTile = (tile: DeepFallbackTile): boolean => {
  if (tile.fallbackPreferred !== false) return false;
  return (
    typeof tile.fallbackZoomDelta !== 'number' || tile.fallbackZoomDelta > 1
  );
};

const findCoveringPreviousTile = <Tile extends DeepFallbackTile>(
  requested: DeepFallbackTile,
  previousTiles: Tile[],
): Tile | null => {
  const coords = resolveTileCoords(requested);
  if (!coords) {
    return previousTiles.find((previous) => previous.key === requested.key) ?? null;
  }
  const count = 2 ** coords.zoom;
  const wrappedX = ((coords.tileX % count) + count) % count;
  let best: Tile | null = null;
  let bestZoom = -1;
  for (const previous of previousTiles) {
    const prevCoords = resolveTileCoords(previous);
    if (!prevCoords) {
      if (previous.key === requested.key && bestZoom < 0) {
        best = previous;
        bestZoom = Number.POSITIVE_INFINITY;
      }
      continue;
    }
    if (prevCoords.zoom > coords.zoom || prevCoords.zoom < bestZoom) continue;
    const scale = 2 ** (coords.zoom - prevCoords.zoom);
    const prevCount = 2 ** prevCoords.zoom;
    const prevWrappedX = ((prevCoords.tileX % prevCount) + prevCount) % prevCount;
    if (Math.floor(wrappedX / scale) % prevCount !== prevWrappedX) continue;
    if (Math.floor(coords.tileY / scale) !== prevCoords.tileY) continue;
    best = previous;
    bestZoom = prevCoords.zoom;
  }
  return best;
};

export const reusePreviousTilesForDeepFallback = <Tile extends DeepFallbackTile>(
  resolvedTiles: Tile[],
  previousTiles: Tile[],
): Tile[] => {
  if (previousTiles.length === 0) return resolvedTiles;
  const hasReusableFallback = resolvedTiles.some(
    (tile) =>
      isDeepFallbackTile(tile) && findCoveringPreviousTile(tile, previousTiles) != null,
  );
  if (!hasReusableFallback) return resolvedTiles;
  const reusedByKey = new Map<string, Tile>();
  const unmatchedDeep: Tile[] = [];
  const exact: Tile[] = [];
  for (const tile of resolvedTiles) {
    if (!isDeepFallbackTile(tile)) {
      exact.push(tile);
      continue;
    }
    const covering = findCoveringPreviousTile(tile, previousTiles);
    if (!covering) {
      unmatchedDeep.push(tile);
      continue;
    }
    if (!reusedByKey.has(covering.key)) reusedByKey.set(covering.key, covering);
  }
  if (reusedByKey.size === 0) return resolvedTiles;
  // Stale under-layer first (parents sorted by key, then unmatched deep in
  // original order), exact tiles last so they paint on top.
  const under = [...reusedByKey.values()].sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );
  return [...under, ...unmatchedDeep, ...exact];
};

export const buildRequestedBasemapTiles = <Tile extends { key: string }>(
  renderTiles: Tile[],
  prefetchedTiles: Tile[],
  interactionPhase: 'idle' | 'interacting' | 'settling',
): Tile[] => {
  if (interactionPhase !== 'idle') return renderTiles;
  if (prefetchedTiles.length === 0) return renderTiles;
  const seen = new Set(renderTiles.map((tile) => tile.key));
  const merged = [...renderTiles];
  prefetchedTiles.forEach((tile) => {
    if (seen.has(tile.key)) return;
    seen.add(tile.key);
    merged.push(tile);
  });
  return merged;
};

const svgToMapCoordsAtView = (
  screenX: number,
  screenY: number,
  options: Pick<
    BasemapTileBufferOptions,
    'bbox' | 'descriptorView' | 'projection' | 'viewHeight'
  >,
): { x: number; y: number } => {
  const { bbox, descriptorView, projection, viewHeight } = options;
  const projectedX = (screenX - descriptorView.panX) / Math.max(descriptorView.zoom, 1e-9);
  const projectedY = (screenY - descriptorView.panY) / Math.max(descriptorView.zoom, 1e-9);
  return {
    x: bbox.minX + (projectedX - projection.offsetX) / Math.max(projection.scale, 1e-9),
    y:
      bbox.minY +
      (viewHeight - projectedY - projection.offsetY) / Math.max(projection.scale, 1e-9),
  };
};

const projectOsmTileCorner = (
  latDeg: number,
  lonDeg: number,
  planningGeorefContext: PlanningGeorefContext,
): { east: number; north: number } =>
  projectGeodeticToEN({
    latDeg,
    lonDeg,
    originLatDeg: planningGeorefContext.originLatDeg,
    originLonDeg: planningGeorefContext.originLonDeg,
    model: planningGeorefContext.model,
    coordSystemMode: planningGeorefContext.coordSystemMode,
    crsId: planningGeorefContext.crsId,
  });

export const buildOsmDescriptorBucketForView = (
  options: BasemapDescriptorViewOptions,
): ReturnType<typeof buildOsmDescriptorBucket> | null => {
  const viewportCorners = [
    svgToMapCoordsAtView(0, 0, options),
    svgToMapCoordsAtView(options.viewWidth, 0, options),
    svgToMapCoordsAtView(0, options.viewHeight, options),
    svgToMapCoordsAtView(options.viewWidth, options.viewHeight, options),
  ];
  const geodeticCorners = viewportCorners
    .map((corner) =>
      inverseENToGeodetic({
        east: corner.x,
        north: corner.y,
        ...options.planningGeorefContext,
      }),
    )
    .filter((corner): corner is { latDeg: number; lonDeg: number } => !('failureReason' in corner));
  if (geodeticCorners.length !== 4) return null;
  const lats = geodeticCorners.map((corner) => corner.latDeg);
  const lons = geodeticCorners.map((corner) => corner.lonDeg);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const centerLat = (minLat + maxLat) * 0.5;
  const metersPerPixelX =
    Math.abs(
      svgToMapCoordsAtView(OSM_TILE_SIZE_PX, options.viewHeight * 0.5, options).x -
        svgToMapCoordsAtView(0, options.viewHeight * 0.5, options).x,
    ) / OSM_TILE_SIZE_PX;
  if (!(metersPerPixelX > 0)) return null;
  return buildOsmDescriptorBucket({
    minLon,
    maxLon,
    minLat,
    maxLat,
    centerLat,
    metersPerPixelX,
    interactionPhase: options.interactionPhase,
  });
};

const buildOsmTileMeshPoints = (
  options: BasemapTileBufferOptions & {
    meshColumns: number;
    meshRows: number;
    tileX: number;
    tileY: number;
    zoom: number;
  },
): Array<{ x: number; y: number }> | null => {
  const meshPoints: Array<{ x: number; y: number }> = [];
  for (let row = 0; row <= options.meshRows; row += 1) {
    const sampleLat = tileYToLatitude(options.tileY + row / options.meshRows, options.zoom);
    for (let column = 0; column <= options.meshColumns; column += 1) {
      const sampleLon = tileXToLongitude(options.tileX + column / options.meshColumns, options.zoom);
      const sampleProjected = projectOsmTileCorner(
        sampleLat,
        sampleLon,
        options.planningGeorefContext,
      );
      const sampleScreen = options.projectPoint(sampleProjected.east, sampleProjected.north);
      if (!Number.isFinite(sampleScreen.x) || !Number.isFinite(sampleScreen.y)) return null;
      meshPoints.push({ x: sampleScreen.x, y: sampleScreen.y });
    }
  }
  return meshPoints;
};

export const buildBasemapTiles2dForBuffer = (
  options: BasemapTileBufferOptions,
): BasemapTileDescriptor2d[] => {
  const { descriptorView, interactionPhase, planningGeorefContext, tileBuffer, viewHeight, viewWidth } =
    options;
  const viewportCorners = [
    svgToMapCoordsAtView(0, 0, options),
    svgToMapCoordsAtView(viewWidth, 0, options),
    svgToMapCoordsAtView(0, viewHeight, options),
    svgToMapCoordsAtView(viewWidth, viewHeight, options),
  ];
  const geodeticCorners = viewportCorners
    .map((corner) =>
      inverseENToGeodetic({
        east: corner.x,
        north: corner.y,
        ...planningGeorefContext,
      }),
    )
    .filter((corner): corner is { latDeg: number; lonDeg: number } => !('failureReason' in corner));
  if (geodeticCorners.length !== 4) return [];
  const lats = geodeticCorners.map((corner) => corner.latDeg);
  const lons = geodeticCorners.map((corner) => corner.lonDeg);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  const centerLat = (minLat + maxLat) * 0.5;
  const metersPerPixelX =
    Math.abs(
      svgToMapCoordsAtView(OSM_TILE_SIZE_PX, viewHeight * 0.5, options).x -
        svgToMapCoordsAtView(0, viewHeight * 0.5, options).x,
    ) / OSM_TILE_SIZE_PX;
  if (!(metersPerPixelX > 0)) return [];
  const { descriptorZoom: zoom } = buildOsmDescriptorBucket({
    minLon,
    maxLon,
    minLat,
    maxLat,
    centerLat,
    metersPerPixelX,
    interactionPhase,
  });
  const tileCount = 2 ** zoom;
  const minTileX = Math.floor(longitudeToTileX(minLon, zoom)) - tileBuffer;
  const maxTileX = Math.floor(longitudeToTileX(maxLon, zoom)) + tileBuffer;
  const minTileY = Math.floor(latitudeToTileY(maxLat, zoom)) - tileBuffer;
  const maxTileY = Math.floor(latitudeToTileY(minLat, zoom)) + tileBuffer;
  const centerTileX = (minTileX + maxTileX) * 0.5;
  const centerTileY = (minTileY + maxTileY) * 0.5;
  const tiles: BasemapTileDescriptor2d[] = [];
  for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
    for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
      const wrappedTileX = ((tileX % tileCount) + tileCount) % tileCount;
      if (tileY < 0 || tileY >= tileCount) continue;
      const northWest = projectOsmTileCorner(
        tileYToLatitude(tileY, zoom),
        tileXToLongitude(tileX, zoom),
        planningGeorefContext,
      );
      const southEast = projectOsmTileCorner(
        tileYToLatitude(tileY + 1, zoom),
        tileXToLongitude(tileX + 1, zoom),
        planningGeorefContext,
      );
      const southEastScreen = options.projectPoint(southEast.east, southEast.north);
      const northWestScreen = options.projectPoint(northWest.east, northWest.north);
      if (
        !Number.isFinite(northWestScreen.x) ||
        !Number.isFinite(northWestScreen.y) ||
        !Number.isFinite(southEastScreen.x) ||
        !Number.isFinite(southEastScreen.y)
      ) {
        continue;
      }
      const tileWidthPx = Math.abs(southEastScreen.x - northWestScreen.x) * descriptorView.zoom;
      const tileHeightPx = Math.abs(southEastScreen.y - northWestScreen.y) * descriptorView.zoom;
      const meshColumns = chooseOsmTileMeshDivisions(
        tileWidthPx,
        tileHeightPx,
        interactionPhase === 'interacting',
      );
      const meshRows = meshColumns;
      const meshPoints = buildOsmTileMeshPoints({
        ...options,
        meshColumns,
        meshRows,
        tileX,
        tileY,
        zoom,
      });
      if (!meshPoints || meshPoints.length !== (meshColumns + 1) * (meshRows + 1)) continue;
      tiles.push({
        key: `${zoom}-${wrappedTileX}-${tileY}`,
        href: `https://tile.openstreetmap.org/${zoom}/${wrappedTileX}/${tileY}.png`,
        zoom,
        tileX: wrappedTileX,
        tileY,
        meshColumns,
        meshRows,
        meshPoints,
      });
    }
  }
  return tiles.sort((left, right) => {
    const [leftZoom, leftX, leftY] = left.key.split('-').map(Number);
    const [rightZoom, rightX, rightY] = right.key.split('-').map(Number);
    const zoomDelta = (rightZoom ?? zoom) - (leftZoom ?? zoom);
    if (zoomDelta !== 0) return zoomDelta;
    const leftDistance = Math.hypot((leftX ?? 0) - centerTileX, (leftY ?? 0) - centerTileY);
    const rightDistance = Math.hypot((rightX ?? 0) - centerTileX, (rightY ?? 0) - centerTileY);
    return leftDistance - rightDistance;
  });
};
