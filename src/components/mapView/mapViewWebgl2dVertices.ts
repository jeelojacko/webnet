import type { BasemapTileRenderSurface2d } from './mapViewTileStore';
import type {
  MapViewWebglLinePrimitive2d,
  MapViewWebglPointPrimitive2d,
} from './mapViewWebglBuffers';

export const VERTEX_FLOATS_TILE = 4;
export const VERTEX_FLOATS_LINE = 6;
export const VERTEX_FLOATS_POINT = 7;

export const buildLineVertexData = (
  lines: MapViewWebglLinePrimitive2d[],
): Float32Array => {
  const raw: number[] = [];
  lines.forEach((line) => {
    raw.push(line.x1, line.y1, ...line.color, line.x2, line.y2, ...line.color);
  });
  return new Float32Array(raw);
};

export const buildPointVertexData = (
  points: MapViewWebglPointPrimitive2d[],
): Float32Array => {
  const raw: number[] = [];
  points.forEach((point) => {
    raw.push(point.x, point.y, ...point.color, point.size);
  });
  return new Float32Array(raw);
};

export const buildTileVertexData = (tile: BasemapTileRenderSurface2d): Float32Array => {
  const sourceWidth = tile.sourceWidth || tile.image.naturalWidth || tile.image.width || 256;
  const sourceHeight = tile.sourceHeight || tile.image.naturalHeight || tile.image.height || 256;
  const imageWidth = tile.image.naturalWidth || tile.image.width || 256;
  const imageHeight = tile.image.naturalHeight || tile.image.height || 256;
  const u0 = (tile.sourceX || 0) / imageWidth;
  const v0 = (tile.sourceY || 0) / imageHeight;
  const u1 = ((tile.sourceX || 0) + sourceWidth) / imageWidth;
  const v1 = ((tile.sourceY || 0) + sourceHeight) / imageHeight;
  const stepU = (u1 - u0) / tile.meshColumns;
  const stepV = (v1 - v0) / tile.meshRows;
  const raw: number[] = [];
  const pointsPerRow = tile.meshColumns + 1;
  const pointAt = (row: number, column: number) =>
    tile.meshPoints[row * pointsPerRow + column] ?? null;
  for (let row = 0; row < tile.meshRows; row += 1) {
    for (let column = 0; column < tile.meshColumns; column += 1) {
      const topLeft = pointAt(row, column);
      const topRight = pointAt(row, column + 1);
      const bottomLeft = pointAt(row + 1, column);
      const bottomRight = pointAt(row + 1, column + 1);
      if (!topLeft || !topRight || !bottomLeft || !bottomRight) continue;
      const uvLeft = u0 + stepU * column;
      const uvRight = u0 + stepU * (column + 1);
      const uvTop = v0 + stepV * row;
      const uvBottom = v0 + stepV * (row + 1);
      raw.push(
        topLeft.x,
        topLeft.y,
        uvLeft,
        uvTop,
        topRight.x,
        topRight.y,
        uvRight,
        uvTop,
        bottomLeft.x,
        bottomLeft.y,
        uvLeft,
        uvBottom,
        bottomLeft.x,
        bottomLeft.y,
        uvLeft,
        uvBottom,
        topRight.x,
        topRight.y,
        uvRight,
        uvTop,
        bottomRight.x,
        bottomRight.y,
        uvRight,
        uvBottom,
      );
    }
  }
  return new Float32Array(raw);
};
