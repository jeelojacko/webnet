import type { BasemapTileRenderSurface2d } from './mapViewTileStore';
import type { MapViewWebgl2dMetrics, TextureEntry, TileMeshEntry } from './mapViewWebgl2d.types';
import { buildTileVertexData, VERTEX_FLOATS_TILE } from './mapViewWebgl2dVertices';

export const resolveTileTexture = ({
  gl,
  tile,
  tileTextureByKey,
  metrics,
}: {
  gl: WebGL2RenderingContext;
  tile: BasemapTileRenderSurface2d;
  tileTextureByKey: Map<string, TextureEntry>;
  metrics: MapViewWebgl2dMetrics;
}): WebGLTexture | null => {
  const imageWidth = tile.image.naturalWidth || tile.image.width || 256;
  const imageHeight = tile.image.naturalHeight || tile.image.height || 256;
  const signature = [
    imageWidth,
    imageHeight,
    tile.sourceX,
    tile.sourceY,
    tile.sourceWidth,
    tile.sourceHeight,
    tile.fallbackZoomDelta,
  ].join(':');
  const existing = tileTextureByKey.get(tile.key);
  if (existing && existing.signature === signature) {
    return existing.texture;
  }
  const texture = existing?.texture ?? gl.createTexture();
  if (!texture) return null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile.image);
  tileTextureByKey.set(tile.key, { texture, signature });
  metrics.textureUploadCount += 1;
  return texture;
};

export const resolveTileMesh = ({
  gl,
  tile,
  tileMeshByKey,
  metrics,
}: {
  gl: WebGL2RenderingContext;
  tile: BasemapTileRenderSurface2d;
  tileMeshByKey: Map<string, TileMeshEntry>;
  metrics: MapViewWebgl2dMetrics;
}): TileMeshEntry | null => {
  const pointCount = tile.meshPoints.length;
  const firstPoint = pointCount > 0 ? tile.meshPoints[0] : null;
  const middlePoint = pointCount > 0 ? tile.meshPoints[Math.floor(pointCount * 0.5)] : null;
  const lastPoint = pointCount > 0 ? tile.meshPoints[pointCount - 1] : null;
  const signature = [
    tile.meshColumns,
    tile.meshRows,
    tile.sourceX,
    tile.sourceY,
    tile.sourceWidth,
    tile.sourceHeight,
    tile.fallbackZoomDelta,
    pointCount,
    firstPoint?.x ?? 0,
    firstPoint?.y ?? 0,
    middlePoint?.x ?? 0,
    middlePoint?.y ?? 0,
    lastPoint?.x ?? 0,
    lastPoint?.y ?? 0,
  ].join(':');
  const cached = tileMeshByKey.get(tile.key);
  if (cached && cached.signature === signature && cached.buffer) {
    return cached;
  }
  if (cached?.buffer) {
    gl.deleteBuffer(cached.buffer);
  }
  const vertices = buildTileVertexData(tile);
  const buffer = gl.createBuffer();
  if (!buffer) return null;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const entry: TileMeshEntry = {
    signature,
    vertices,
    buffer,
    vertexCount: vertices.length / VERTEX_FLOATS_TILE,
  };
  tileMeshByKey.set(tile.key, entry);
  metrics.tileMeshBuildCount += 1;
  return entry;
};
