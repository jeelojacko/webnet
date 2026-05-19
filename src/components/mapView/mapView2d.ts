import type { ObservationMapLink } from '../../engine/resultDerivedModels';
import type { StationMap } from '../../types';

export interface View2dState {
  zoom: number;
  panX: number;
  panY: number;
}

export interface Projection2d {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface MapBounds2d {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface ViewportBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ProjectedMapLine2D {
  key: string;
  observationId: number;
  pairKey: string;
  sourceLine: number | null;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  screenX1: number;
  screenY1: number;
  screenX2: number;
  screenY2: number;
}

export interface ProjectedPoint2D {
  id: string;
  fixed: boolean;
  x: number;
  y: number;
  screenX: number;
  screenY: number;
  ellipsoid?: {
    semiMajor: number;
    semiMinor: number;
    semiVertical: number;
    thetaDeg: number;
  };
}

export interface BaseProjectedMapLine2D {
  key: string;
  observationId: number;
  pairKey: string;
  sourceLine: number | null;
  fromId: string;
  toId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface BaseProjectedPoint2D {
  id: string;
  fixed: boolean;
  x: number;
  y: number;
  ellipsoid?: {
    semiMajor: number;
    semiMinor: number;
    semiVertical: number;
    thetaDeg: number;
  };
}

export interface ProjectablePoint2D {
  id: string;
  x: number;
  y: number;
  fixed: boolean;
  ellipsoid?: {
    semiMajor: number;
    semiMinor: number;
    semiVertical: number;
    thetaDeg: number;
  };
}

export interface MapDensitySummary {
  dense: boolean;
  labelTotal: number;
  labelSuppressed: number;
  lineSuppressed: number;
}

export interface DerivedMapState2d {
  projectedMapLines2d: ProjectedMapLine2D[];
  projectedPoints2d: ProjectedPoint2D[];
  interactionDenseMode: boolean;
  visiblePointLabels2d: Set<string>;
  filteredVisibleMapLines2d: ProjectedMapLine2D[];
  filteredVisiblePoints2d: ProjectedPoint2D[];
  unselectedCanvasLines2d: ProjectedMapLine2D[];
  mapDensitySummary: MapDensitySummary;
}

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

export const buildBaseProjectedMapLines2d = (input: {
  mapLinks: ObservationMapLink[];
  stations: StationMap;
  showLostStations: boolean;
  projectPoint: (_x: number, _y: number) => { x: number; y: number };
}): BaseProjectedMapLine2D[] =>
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

export const buildVisiblePointLabels2d = (input: {
  showLabels: boolean;
  visiblePoints2d: ProjectedPoint2D[];
  visibleMapLines2dLength: number;
  interactionDenseMode: boolean;
  selectedStationId: string | null;
  pointThreshold: number;
  edgeThreshold: number;
  labelGridPx: number;
  scorePriority: (_point: ProjectedPoint2D) => number;
}): Set<string> => {
  if (!input.showLabels) return new Set<string>();
  if (input.visiblePoints2d.length === 0) return new Set<string>();
  if (input.interactionDenseMode) {
    const selectedOnly = new Set<string>();
    if (input.selectedStationId) selectedOnly.add(input.selectedStationId);
    return selectedOnly;
  }
  const next = new Set<string>();
  const denseView =
    input.visiblePoints2d.length > input.pointThreshold ||
    input.visibleMapLines2dLength > input.edgeThreshold;
  if (!denseView) {
    input.visiblePoints2d.forEach((point) => next.add(point.id));
    return next;
  }
  const occupied = new Set<string>();
  const sortedPoints = [...input.visiblePoints2d].sort((left, right) => {
    const leftPriority = input.scorePriority(left);
    const rightPriority = input.scorePriority(right);
    if (leftPriority !== rightPriority) return rightPriority - leftPriority;
    return left.id.localeCompare(right.id, undefined, { numeric: true });
  });
  sortedPoints.forEach((point) => {
    const cellX = Math.floor(point.screenX / input.labelGridPx);
    const cellY = Math.floor(point.screenY / input.labelGridPx);
    const key = `${cellX}:${cellY}`;
    if (!occupied.has(key) || point.id === input.selectedStationId) {
      occupied.add(key);
      next.add(point.id);
    }
  });
  return next;
};

export const buildFilteredVisibleMapLines2d = (input: {
  visibleMapLines2d: ProjectedMapLine2D[];
  hideMinorGeometry: boolean;
  focusSelection: boolean;
  selectedObservationId: number | null;
  selectedObservationPairKey: string | null;
  selectedStationId: string | null;
}): ProjectedMapLine2D[] => {
  if (!input.hideMinorGeometry && !input.focusSelection) return input.visibleMapLines2d;
  return input.visibleMapLines2d.filter((line) => {
    const isSelected =
      line.observationId === input.selectedObservationId ||
      (input.selectedObservationPairKey != null && line.pairKey === input.selectedObservationPairKey);
    const touchesSelectedStation =
      input.selectedStationId != null &&
      (line.fromId === input.selectedStationId || line.toId === input.selectedStationId);
    if (isSelected || touchesSelectedStation) return true;
    if (input.focusSelection) return false;
    return !input.hideMinorGeometry || line.observationId % 2 === 0;
  });
};

export const buildFilteredVisiblePoints2d = (input: {
  visiblePoints2d: ProjectedPoint2D[];
  filteredVisibleMapLines2d: ProjectedMapLine2D[];
  focusSelection: boolean;
  selectedStationId: string | null;
}): ProjectedPoint2D[] => {
  if (!input.focusSelection || !input.selectedStationId) return input.visiblePoints2d;
  const connectedIds = new Set<string>([input.selectedStationId]);
  input.filteredVisibleMapLines2d.forEach((line) => {
    if (line.fromId === input.selectedStationId) connectedIds.add(line.toId);
    if (line.toId === input.selectedStationId) connectedIds.add(line.fromId);
  });
  return input.visiblePoints2d.filter((point) => connectedIds.has(point.id));
};

export const buildUnselectedCanvasLines2d = (input: {
  filteredVisibleMapLines2d: ProjectedMapLine2D[];
  interactionDenseMode: boolean;
  selectedObservationId: number | null;
  selectedObservationPairKey: string | null;
  selectedStationId: string | null;
}): ProjectedMapLine2D[] => {
  const base = input.filteredVisibleMapLines2d.filter(
    (line) =>
      line.observationId !== input.selectedObservationId &&
      (input.selectedObservationPairKey == null || line.pairKey !== input.selectedObservationPairKey),
  );
  if (!input.interactionDenseMode) return base;
  return base.filter((line, index) => {
    const touchesSelectedStation =
      input.selectedStationId != null &&
      (line.fromId === input.selectedStationId || line.toId === input.selectedStationId);
    return touchesSelectedStation || index % 2 === 0;
  });
};

export const buildMapDensitySummary = (input: {
  filteredVisibleMapLines2dLength: number;
  filteredVisiblePoints2dLength: number;
  totalProjectedMapLines2dLength: number;
  projectedMapLines2dLength: number;
  visiblePointLabels2dSize: number;
  denseLabelEdgeThreshold: number;
}): MapDensitySummary => {
  const labelTotal = input.visiblePointLabels2dSize;
  const labelSuppressed = input.filteredVisiblePoints2dLength - labelTotal;
  const lineSuppressed = input.totalProjectedMapLines2dLength - input.filteredVisibleMapLines2dLength;
  return {
    dense:
      labelSuppressed > 0 ||
      lineSuppressed > 0 ||
      input.projectedMapLines2dLength > input.denseLabelEdgeThreshold,
    labelTotal,
    labelSuppressed,
    lineSuppressed,
  };
};

export const buildDerivedMapState2d = (input: {
  projectedMapLines2d: ProjectedMapLine2D[];
  projectedPoints2d: ProjectedPoint2D[];
  selectedStationId: string | null;
  interactionPhaseInteracting: boolean;
  interactionDensePointThreshold: number;
  interactionDenseLineThreshold: number;
  showLabels: boolean;
  hideMinorGeometry: boolean;
  focusSelection: boolean;
  pointThreshold: number;
  edgeThreshold: number;
  labelGridPx: number;
  totalProjectedMapLines2dLength: number;
  selectedObservationId: number | null;
  selectedObservationPairKey: string | null;
  scorePriority: (_point: ProjectedPoint2D) => number;
}): DerivedMapState2d => {
  const interactionDenseMode =
    input.interactionPhaseInteracting &&
    (input.projectedPoints2d.length > input.interactionDensePointThreshold ||
      input.projectedMapLines2d.length > input.interactionDenseLineThreshold);

  const visiblePointLabels2d = buildVisiblePointLabels2d({
    showLabels: input.showLabels,
    visiblePoints2d: input.projectedPoints2d,
    visibleMapLines2dLength: input.projectedMapLines2d.length,
    interactionDenseMode,
    selectedStationId: input.selectedStationId,
    pointThreshold: input.pointThreshold,
    edgeThreshold: input.edgeThreshold,
    labelGridPx: input.labelGridPx,
    scorePriority: input.scorePriority,
  });

  const filteredVisibleMapLines2d = buildFilteredVisibleMapLines2d({
    visibleMapLines2d: input.projectedMapLines2d,
    hideMinorGeometry: input.hideMinorGeometry,
    focusSelection: input.focusSelection,
    selectedObservationId: input.selectedObservationId,
    selectedObservationPairKey: input.selectedObservationPairKey,
    selectedStationId: input.selectedStationId,
  });

  const filteredVisiblePoints2d = buildFilteredVisiblePoints2d({
    visiblePoints2d: input.projectedPoints2d,
    filteredVisibleMapLines2d,
    focusSelection: input.focusSelection,
    selectedStationId: input.selectedStationId,
  });

  const unselectedCanvasLines2d = buildUnselectedCanvasLines2d({
    filteredVisibleMapLines2d,
    interactionDenseMode,
    selectedObservationId: input.selectedObservationId,
    selectedObservationPairKey: input.selectedObservationPairKey,
    selectedStationId: input.selectedStationId,
  });

  const mapDensitySummary = buildMapDensitySummary({
    filteredVisibleMapLines2dLength: filteredVisibleMapLines2d.length,
    filteredVisiblePoints2dLength: filteredVisiblePoints2d.length,
    totalProjectedMapLines2dLength: input.totalProjectedMapLines2dLength,
    projectedMapLines2dLength: input.projectedMapLines2d.length,
    visiblePointLabels2dSize: visiblePointLabels2d.size,
    denseLabelEdgeThreshold: input.edgeThreshold,
  });

  return {
    projectedMapLines2d: input.projectedMapLines2d,
    projectedPoints2d: input.projectedPoints2d,
    interactionDenseMode,
    visiblePointLabels2d,
    filteredVisibleMapLines2d,
    filteredVisiblePoints2d,
    unselectedCanvasLines2d,
    mapDensitySummary,
  };
};
