import type {
  BaseProjectedMapLine2D,
  BaseProjectedPoint2D,
  BuildBaseProjectedMapLines2dInput,
  MapBounds2d,
  ProjectablePoint2D,
  ProjectedMapLine2D,
  ProjectedPoint2D,
  Projection2d,
  View2dState,
  ViewportBounds,
} from './mapView2d.types';

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const view2dEquals = (left: View2dState, right: View2dState): boolean =>
  left.zoom === right.zoom && left.panX === right.panX && left.panY === right.panY;

export const intersectsViewportBounds = (
  bounds: ViewportBounds,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): boolean => {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  return !(
    maxX < bounds.minX ||
    minX > bounds.maxX ||
    maxY < bounds.minY ||
    minY > bounds.maxY
  );
};

export const pointToSegmentDistancePx = (
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-12) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  const cx = x1 + dx * t;
  const cy = y1 + dy * t;
  return Math.hypot(px - cx, py - cy);
};

export const buildProjection2d = (
  bbox: MapBounds2d,
  viewWidth: number,
  viewHeight: number,
): Projection2d => {
  const safeWidth = Math.max(1e-9, bbox.width);
  const safeHeight = Math.max(1e-9, bbox.height);
  const scale = Math.min(viewWidth / safeWidth, viewHeight / safeHeight);
  const contentWidth = safeWidth * scale;
  const contentHeight = safeHeight * scale;
  const offsetX = (viewWidth - contentWidth) * 0.5;
  const offsetY = (viewHeight - contentHeight) * 0.5;
  return { scale, offsetX, offsetY };
};

export const projectPoint2d = (
  x: number,
  y: number,
  bbox: Pick<MapBounds2d, 'minX' | 'minY'>,
  projection: Projection2d,
  viewHeight: number,
): { x: number; y: number } => {
  const px = projection.offsetX + (x - bbox.minX) * projection.scale;
  const py = viewHeight - (projection.offsetY + (y - bbox.minY) * projection.scale);
  return { x: px, y: py };
};

export const buildViewportBounds = (
  viewWidth: number,
  viewHeight: number,
  clipMarginPx: number,
): ViewportBounds => ({
  minX: -clipMarginPx,
  maxX: viewWidth + clipMarginPx,
  minY: -clipMarginPx,
  maxY: viewHeight + clipMarginPx,
});

export const buildProjectedViewportBounds = (
  viewportBounds: ViewportBounds,
  view2d: View2dState,
): ViewportBounds => {
  const safeZoom = Math.max(view2d.zoom, 1e-9);
  return {
    minX: (viewportBounds.minX - view2d.panX) / safeZoom,
    maxX: (viewportBounds.maxX - view2d.panX) / safeZoom,
    minY: (viewportBounds.minY - view2d.panY) / safeZoom,
    maxY: (viewportBounds.maxY - view2d.panY) / safeZoom,
  };
};

export const buildBaseProjectedMapLines2d = (
  input: BuildBaseProjectedMapLines2dInput,
): BaseProjectedMapLine2D[] =>
  input.mapLinks
    .map((link) => {
      const from = input.stations[link.fromId];
      const to = input.stations[link.toId];
      if (!from || !to) return null;
      if (!input.showLostStations && (from.lost || to.lost)) return null;
      const p1 = input.projectPoint(from.x, from.y);
      const p2 = input.projectPoint(to.x, to.y);
      return {
        key: link.key,
        observationId: link.observationId,
        pairKey: link.pairKey,
        sourceLine: link.sourceLine,
        fromId: link.fromId,
        toId: link.toId,
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        minX: Math.min(p1.x, p2.x),
        maxX: Math.max(p1.x, p2.x),
        minY: Math.min(p1.y, p2.y),
        maxY: Math.max(p1.y, p2.y),
      };
    })
    .filter((line): line is BaseProjectedMapLine2D => line != null);

export const buildVisibleBaseProjectedMapLines2d = (input: {
  baseProjectedMapLines2d: BaseProjectedMapLine2D[];
  selectedObservationId: number | null;
  selectedObservationPairKey: string | null;
  projectedViewportBounds: ViewportBounds;
}): BaseProjectedMapLine2D[] =>
  input.baseProjectedMapLines2d.filter((line) => {
    const isSelected =
      line.observationId === input.selectedObservationId ||
      (input.selectedObservationPairKey != null && line.pairKey === input.selectedObservationPairKey);
    if (isSelected) return true;
    return !(
      line.maxX < input.projectedViewportBounds.minX ||
      line.minX > input.projectedViewportBounds.maxX ||
      line.maxY < input.projectedViewportBounds.minY ||
      line.minY > input.projectedViewportBounds.maxY
    );
  });

export const buildProjectedMapLines2d = (input: {
  baseProjectedMapLines2d: BaseProjectedMapLine2D[];
  view2d: View2dState;
}): ProjectedMapLine2D[] =>
  input.baseProjectedMapLines2d.map((line) => ({
    ...line,
    screenX1: input.view2d.panX + line.x1 * input.view2d.zoom,
    screenY1: input.view2d.panY + line.y1 * input.view2d.zoom,
    screenX2: input.view2d.panX + line.x2 * input.view2d.zoom,
    screenY2: input.view2d.panY + line.y2 * input.view2d.zoom,
  }));

export const buildBaseProjectedPoints2d = (input: {
  points: ProjectablePoint2D[];
  projectPoint: (_x: number, _y: number) => { x: number; y: number };
}): BaseProjectedPoint2D[] =>
  input.points.map((point) => {
    const projected = input.projectPoint(point.x, point.y);
    return {
      id: point.id,
      fixed: point.fixed,
      x: projected.x,
      y: projected.y,
      ellipsoid: point.ellipsoid,
    };
  });

export const buildVisibleBaseProjectedPoints2d = (input: {
  baseProjectedPoints2d: BaseProjectedPoint2D[];
  selectedStationId: string | null;
  projectedViewportBounds: ViewportBounds;
  selectionMarginProjected?: number;
}): BaseProjectedPoint2D[] => {
  const selectionMargin = input.selectionMarginProjected ?? 12;
  return input.baseProjectedPoints2d.filter((point) => {
    if (point.id === input.selectedStationId) return true;
    return (
      point.x >= input.projectedViewportBounds.minX - selectionMargin &&
      point.x <= input.projectedViewportBounds.maxX + selectionMargin &&
      point.y >= input.projectedViewportBounds.minY - selectionMargin &&
      point.y <= input.projectedViewportBounds.maxY + selectionMargin
    );
  });
};

export const buildProjectedPoints2d = (input: {
  baseProjectedPoints2d: BaseProjectedPoint2D[];
  view2d: View2dState;
}): ProjectedPoint2D[] =>
  input.baseProjectedPoints2d.map((point) => ({
    ...point,
    screenX: input.view2d.panX + point.x * input.view2d.zoom,
    screenY: input.view2d.panY + point.y * input.view2d.zoom,
  }));
