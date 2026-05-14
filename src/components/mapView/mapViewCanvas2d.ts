import type { ProjectedMapLine2D, ProjectedPoint2D, View2dState } from './mapView2d';

interface CanvasEllipseLookupRow {
  semiMajor: number;
  semiMinor: number;
  thetaDeg: number;
}

export interface CanvasBasemapTile2d {
  key: string;
  image: HTMLImageElement | null;
  meshColumns: number;
  meshRows: number;
  meshPoints: Array<{ x: number; y: number }>;
}

export interface RenderMapCanvas2dOptions {
  canvas: HTMLCanvasElement;
  interactionPhase: 'idle' | 'interacting' | 'settling';
  viewWidth: number;
  viewHeight: number;
  view2d: View2dState;
  originalGeometryOpacity: number;
  lineWidth2d: number;
  pointRadius2d: number;
  ellipseStroke2d: number;
  projectionScale: number;
  units: 'm' | 'ft';
  interactionDenseMode: boolean;
  basemapTiles2d?: CanvasBasemapTile2d[];
  unselectedCanvasLines2d: ProjectedMapLine2D[];
  filteredVisiblePoints2d: ProjectedPoint2D[];
  ellipseStroke: (_stationId: string) => string;
  stationFill: (_stationId: string, _fixed: boolean) => string;
}

const WARP_SEAM_BLEED_SCREEN_PX = 0.8;

export const renderMapCanvas2d = ({
  canvas,
  interactionPhase,
  viewWidth,
  viewHeight,
  view2d,
  originalGeometryOpacity,
  lineWidth2d,
  pointRadius2d,
  ellipseStroke2d,
  projectionScale,
  units,
  interactionDenseMode,
  basemapTiles2d = [],
  unselectedCanvasLines2d,
  filteredVisiblePoints2d,
  ellipseStroke,
  stationFill,
}: RenderMapCanvas2dOptions) => {
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = canvas.getContext('2d');
  } catch {
    context = null;
  }
  if (!context) return false;

  const seamBleedWorld = WARP_SEAM_BLEED_SCREEN_PX / Math.max(0.001, view2d.zoom);

  const expandTrianglePoint = (
    point: { x: number; y: number },
    centroid: { x: number; y: number },
  ) => {
    const dx = point.x - centroid.x;
    const dy = point.y - centroid.y;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) return point;
    const scale = (length + seamBleedWorld) / length;
    return {
      x: centroid.x + dx * scale,
      y: centroid.y + dy * scale,
    };
  };

  const drawImageTriangle = (
    image: HTMLImageElement,
    sx0: number,
    sy0: number,
    sx1: number,
    sy1: number,
    sx2: number,
    sy2: number,
    dx0: number,
    dy0: number,
    dx1: number,
    dy1: number,
    dx2: number,
    dy2: number,
  ) => {
    const denom = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
    if (Math.abs(denom) <= 1e-9) return;
    const a = (dx0 * (sy1 - sy2) + dx1 * (sy2 - sy0) + dx2 * (sy0 - sy1)) / denom;
    const b = (dy0 * (sy1 - sy2) + dy1 * (sy2 - sy0) + dy2 * (sy0 - sy1)) / denom;
    const c = (dx0 * (sx2 - sx1) + dx1 * (sx0 - sx2) + dx2 * (sx1 - sx0)) / denom;
    const d = (dy0 * (sx2 - sx1) + dy1 * (sx0 - sx2) + dy2 * (sx1 - sx0)) / denom;
    const e =
      (dx0 * (sx1 * sy2 - sx2 * sy1) +
        dx1 * (sx2 * sy0 - sx0 * sy2) +
        dx2 * (sx0 * sy1 - sx1 * sy0)) /
      denom;
    const f =
      (dy0 * (sx1 * sy2 - sx2 * sy1) +
        dy1 * (sx2 * sy0 - sx0 * sy2) +
        dy2 * (sx0 * sy1 - sx1 * sy0)) /
      denom;
    const centroid = { x: (dx0 + dx1 + dx2) / 3, y: (dy0 + dy1 + dy2) / 3 };
    const clip0 = expandTrianglePoint({ x: dx0, y: dy0 }, centroid);
    const clip1 = expandTrianglePoint({ x: dx1, y: dy1 }, centroid);
    const clip2 = expandTrianglePoint({ x: dx2, y: dy2 }, centroid);

    context.save();
    context.beginPath();
    context.moveTo(clip0.x, clip0.y);
    context.lineTo(clip1.x, clip1.y);
    context.lineTo(clip2.x, clip2.y);
    context.closePath();
    context.clip();
    context.transform(a, b, c, d, e, f);
    context.drawImage(image, 0, 0);
    context.restore();
  };

  const drawWarpedBasemapTile = (tile: CanvasBasemapTile2d) => {
    if (!tile.image || tile.meshColumns <= 0 || tile.meshRows <= 0) return;
    const sourceWidth = tile.image.naturalWidth || tile.image.width || 256;
    const sourceHeight = tile.image.naturalHeight || tile.image.height || 256;
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) return;
    const stepSourceX = sourceWidth / tile.meshColumns;
    const stepSourceY = sourceHeight / tile.meshRows;
    const pointsPerRow = tile.meshColumns + 1;
    const pointAt = (row: number, column: number) => tile.meshPoints[row * pointsPerRow + column] ?? null;

    for (let row = 0; row < tile.meshRows; row += 1) {
      for (let column = 0; column < tile.meshColumns; column += 1) {
        const topLeft = pointAt(row, column);
        const topRight = pointAt(row, column + 1);
        const bottomLeft = pointAt(row + 1, column);
        const bottomRight = pointAt(row + 1, column + 1);
        if (!topLeft || !topRight || !bottomLeft || !bottomRight) continue;
        const sx0 = column * stepSourceX;
        const sy0 = row * stepSourceY;
        const sx1 = (column + 1) * stepSourceX;
        const sy1 = row * stepSourceY;
        const sx2 = column * stepSourceX;
        const sy2 = (row + 1) * stepSourceY;
        const sx3 = (column + 1) * stepSourceX;
        const sy3 = (row + 1) * stepSourceY;
        drawImageTriangle(
          tile.image,
          sx0,
          sy0,
          sx1,
          sy1,
          sx2,
          sy2,
          topLeft.x,
          topLeft.y,
          topRight.x,
          topRight.y,
          bottomLeft.x,
          bottomLeft.y,
        );
        drawImageTriangle(
          tile.image,
          sx3,
          sy3,
          sx2,
          sy2,
          sx1,
          sy1,
          bottomRight.x,
          bottomRight.y,
          bottomLeft.x,
          bottomLeft.y,
          topRight.x,
          topRight.y,
        );
      }
    }
  };

  const fullPixelRatio =
    typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio)
      ? Math.max(1, window.devicePixelRatio)
      : 1;
  const pixelRatio = interactionPhase === 'interacting' ? 1 : fullPixelRatio;
  const targetWidth = Math.max(1, Math.round(viewWidth * pixelRatio));
  const targetHeight = Math.max(1, Math.round(viewHeight * pixelRatio));
  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, viewWidth, viewHeight);
  context.save();
  context.translate(view2d.panX, view2d.panY);
  context.scale(view2d.zoom, view2d.zoom);
  context.globalAlpha = 0.92;
  context.imageSmoothingEnabled = true;
  basemapTiles2d.forEach(drawWarpedBasemapTile);
  context.globalAlpha = originalGeometryOpacity;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = '#475569';
  context.lineWidth = lineWidth2d;
  context.globalAlpha = 0.6 * originalGeometryOpacity;

  unselectedCanvasLines2d.forEach((line) => {
    context.beginPath();
    context.moveTo(line.x1, line.y1);
    context.lineTo(line.x2, line.y2);
    context.stroke();
  });

  const ellScale = units === 'ft' ? 0.0328084 : 1;
  filteredVisiblePoints2d.forEach((point) => {
    const ellipsoid = point.ellipsoid as CanvasEllipseLookupRow | undefined;
    if (!interactionDenseMode && ellipsoid) {
      context.save();
      context.translate(point.x, point.y);
      context.rotate((ellipsoid.thetaDeg * Math.PI) / 180);
      context.strokeStyle = ellipseStroke(point.id);
      context.lineWidth = ellipseStroke2d;
      context.globalAlpha = 0.6 * originalGeometryOpacity;
      context.beginPath();
      context.ellipse(
        0,
        0,
        ellipsoid.semiMajor * 100 * ellScale * projectionScale,
        ellipsoid.semiMinor * 100 * ellScale * projectionScale,
        0,
        0,
        Math.PI * 2,
      );
      context.stroke();
      context.restore();
    }
    context.beginPath();
    context.globalAlpha = originalGeometryOpacity;
    context.fillStyle = stationFill(point.id, point.fixed);
    context.arc(point.x, point.y, pointRadius2d, 0, Math.PI * 2);
    context.fill();
  });

  context.restore();
  return true;
};
