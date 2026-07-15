import { clamp } from './mapView2d';

const VIEW_W = 1000;
const VIEW_H = 700;

export type MapInteractionPhase = 'idle' | 'interacting' | 'settling';
export type MapInteractionKind = 'none' | 'pan' | 'wheel';

export type OverpassGeometryVertex = { lat: number; lon: number };
export type OverpassElement = {
  id?: number | string;
  geometry?: OverpassGeometryVertex[];
  tags?: Record<string, string>;
};
export type PlanningPolygonTarget = {
  polygonId: string;
  polygonSource: 'user' | 'osm';
  polygonLabel: string;
};
export type ScreenSelectionBox = {
  anchorX: number;
  anchorY: number;
  currentX: number;
  currentY: number;
};

export type SelectionBoxMode = 'window' | 'crossing';
export type RenderSurfaceLayout = {
  width: number;
  height: number;
  left: number;
  top: number;
};

export const OSM_TILE_SIZE_PX = 256;
export const OSM_MAX_ZOOM = 19;
export const OSM_MIN_ZOOM = 0;
export const OSM_FETCH_BUFFER_M = 100;

const OSM_VISIBLE_TILE_BUFFER = 1;
const OSM_INTERACTION_TILE_BUFFER = 0;
const OSM_INTERACTION_ZOOM_DELTA = 1;
const OSM_VISIBLE_TILE_CAP = 72;
const OSM_INTERACTION_TILE_CAP = 42;

export const DEFAULT_RENDER_SURFACE_LAYOUT: RenderSurfaceLayout = {
  width: VIEW_W,
  height: VIEW_H,
  left: 0,
  top: 0,
};

export const buildRenderSurfaceLayout = (
  containerWidth: number,
  containerHeight: number,
): RenderSurfaceLayout => {
  if (!(containerWidth > 0) || !(containerHeight > 0)) {
    return DEFAULT_RENDER_SURFACE_LAYOUT;
  }
  const scale = Math.max(containerWidth / VIEW_W, containerHeight / VIEW_H);
  const width = Math.max(1, VIEW_W * scale);
  const height = Math.max(1, VIEW_H * scale);
  return {
    width,
    height,
    left: (containerWidth - width) * 0.5,
    top: (containerHeight - height) * 0.5,
  };
};

export const renderSurfaceLayoutEquals = (
  left: RenderSurfaceLayout,
  right: RenderSurfaceLayout,
): boolean =>
  Math.abs(left.width - right.width) < 0.5 &&
  Math.abs(left.height - right.height) < 0.5 &&
  Math.abs(left.left - right.left) < 0.5 &&
  Math.abs(left.top - right.top) < 0.5;

const clampLatitudeForTiles = (latDeg: number): number =>
  Math.min(85.05112878, Math.max(-85.05112878, latDeg));

export const longitudeToTileX = (lonDeg: number, zoom: number): number =>
  ((lonDeg + 180) / 360) * 2 ** zoom;

export const latitudeToTileY = (latDeg: number, zoom: number): number => {
  const latRad = (clampLatitudeForTiles(latDeg) * Math.PI) / 180;
  return (
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    2 ** zoom
  );
};

export const tileXToLongitude = (tileX: number, zoom: number): number =>
  (tileX / 2 ** zoom) * 360 - 180;

export const tileYToLatitude = (tileY: number, zoom: number): number => {
  const n = Math.PI - (2 * Math.PI * tileY) / 2 ** zoom;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const countOsmTileDescriptorsAtZoom = (
  minLon: number,
  maxLon: number,
  minLat: number,
  maxLat: number,
  zoom: number,
  tileBuffer: number,
): number => {
  const minTileX = Math.floor(longitudeToTileX(minLon, zoom)) - tileBuffer;
  const maxTileX = Math.floor(longitudeToTileX(maxLon, zoom)) + tileBuffer;
  const minTileY = Math.floor(latitudeToTileY(maxLat, zoom)) - tileBuffer;
  const maxTileY = Math.floor(latitudeToTileY(minLat, zoom)) + tileBuffer;
  return Math.max(0, maxTileX - minTileX + 1) * Math.max(0, maxTileY - minTileY + 1);
};

type OsmDescriptorBucket = {
  descriptorZoom: number;
  descriptorCount: number;
  signature: string;
};

export const buildOsmDescriptorBucket = ({
  minLon,
  maxLon,
  minLat,
  maxLat,
  centerLat,
  metersPerPixelX,
  interactionPhase,
}: {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
  centerLat: number;
  metersPerPixelX: number;
  interactionPhase: MapInteractionPhase;
}): OsmDescriptorBucket => {
  const tileBuffer =
    interactionPhase === 'interacting' ? OSM_INTERACTION_TILE_BUFFER : OSM_VISIBLE_TILE_BUFFER;
  const tileCap =
    interactionPhase === 'interacting' ? OSM_INTERACTION_TILE_CAP : OSM_VISIBLE_TILE_CAP;
  const tileMetersAtZoom0 =
    156543.03392804097 * Math.cos((clampLatitudeForTiles(centerLat) * Math.PI) / 180);
  let descriptorZoom = Math.round(
    Math.log2(Math.max(1e-9, tileMetersAtZoom0) / Math.max(1e-9, metersPerPixelX)),
  );
  if (!Number.isFinite(descriptorZoom)) descriptorZoom = 18;
  descriptorZoom = clamp(descriptorZoom, OSM_MIN_ZOOM, OSM_MAX_ZOOM);
  if (interactionPhase === 'interacting') {
    descriptorZoom = clamp(
      descriptorZoom - OSM_INTERACTION_ZOOM_DELTA,
      OSM_MIN_ZOOM,
      OSM_MAX_ZOOM,
    );
  }
  let descriptorCount = countOsmTileDescriptorsAtZoom(
    minLon,
    maxLon,
    minLat,
    maxLat,
    descriptorZoom,
    tileBuffer,
  );
  while (descriptorZoom > OSM_MIN_ZOOM && descriptorCount > tileCap) {
    descriptorZoom -= 1;
    descriptorCount = countOsmTileDescriptorsAtZoom(
      minLon,
      maxLon,
      minLat,
      maxLat,
      descriptorZoom,
      tileBuffer,
    );
  }
  return {
    descriptorZoom,
    descriptorCount,
    signature: `${descriptorZoom}:${descriptorCount}:${tileBuffer}:${tileCap}`,
  };
};

export const isPointInsideRect = (
  point: { x: number; y: number },
  rect: { left: number; right: number; top: number; bottom: number },
): boolean =>
  point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;

const segmentsIntersect = (
  a1: { x: number; y: number },
  a2: { x: number; y: number },
  b1: { x: number; y: number },
  b2: { x: number; y: number },
): boolean => {
  const cross = (
    origin: { x: number; y: number },
    p1: { x: number; y: number },
    p2: { x: number; y: number },
  ) => (p1.x - origin.x) * (p2.y - origin.y) - (p1.y - origin.y) * (p2.x - origin.x);
  const onSegment = (
    start: { x: number; y: number },
    point: { x: number; y: number },
    end: { x: number; y: number },
  ) =>
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y);

  const d1 = cross(a1, a2, b1);
  const d2 = cross(a1, a2, b2);
  const d3 = cross(b1, b2, a1);
  const d4 = cross(b1, b2, a2);

  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(a1, b1, a2)) return true;
  if (d2 === 0 && onSegment(a1, b2, a2)) return true;
  if (d3 === 0 && onSegment(b1, a1, b2)) return true;
  if (d4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
};

export const isPointInsidePolygon = (
  point: { x: number; y: number },
  polygon: Array<{ x: number; y: number }>,
): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
};

export const doesPolygonTouchRect = (
  polygon: Array<{ x: number; y: number }>,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean => {
  if (polygon.some((vertex) => isPointInsideRect(vertex, rect))) return true;
  const rectCorners = [
    { x: rect.left, y: rect.top },
    { x: rect.right, y: rect.top },
    { x: rect.right, y: rect.bottom },
    { x: rect.left, y: rect.bottom },
  ];
  if (rectCorners.some((corner) => isPointInsidePolygon(corner, polygon))) return true;
  const rectEdges = [
    [rectCorners[0]!, rectCorners[1]!],
    [rectCorners[1]!, rectCorners[2]!],
    [rectCorners[2]!, rectCorners[3]!],
    [rectCorners[3]!, rectCorners[0]!],
  ] as const;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index]!;
    const end = polygon[(index + 1) % polygon.length]!;
    if (rectEdges.some(([edgeStart, edgeEnd]) => segmentsIntersect(start, end, edgeStart, edgeEnd))) {
      return true;
    }
  }
  return false;
};

export const isPolygonInsideRect = (
  polygon: Array<{ x: number; y: number }>,
  rect: { left: number; right: number; top: number; bottom: number },
): boolean => polygon.every((vertex) => isPointInsideRect(vertex, rect));

export const canRenderCanvasLayers = (): boolean => {
  const isJsdom =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? /jsdom/i.test(navigator.userAgent)
      : false;
  const allowJsdomCanvas =
    typeof globalThis !== 'undefined' &&
    (globalThis as { __WEBNET_ENABLE_CANVAS_RENDER_TEST__?: boolean })
      .__WEBNET_ENABLE_CANVAS_RENDER_TEST__ === true;
  return !isJsdom || allowJsdomCanvas;
};

export const canRenderWebglLayers = (): boolean => {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
  const isJsdom =
    typeof navigator !== 'undefined' && typeof navigator.userAgent === 'string'
      ? /jsdom/i.test(navigator.userAgent)
      : false;
  const allowJsdomWebgl =
    typeof globalThis !== 'undefined' &&
    (globalThis as { __WEBNET_ENABLE_WEBGL_RENDER_TEST__?: boolean })
      .__WEBNET_ENABLE_WEBGL_RENDER_TEST__ === true;
  return !isJsdom || allowJsdomWebgl;
};
