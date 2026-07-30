import type { ProjectedMapLine2D, ProjectedPoint2D, View2dState } from './mapView2d';
import {
  MAP_POINT_BORDER_STROKE,
  MAP_POINT_CENTER_FILL,
} from './mapViewColors';
import { measureMapViewPerf } from './mapViewPerf';
import { prepareCanvas } from './mapViewCanvasPrepare';
import { renderBasemapCanvas2d } from './mapViewCanvasBasemap2d';
export { renderBasemapCanvas2d } from './mapViewCanvasBasemap2d';

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
  sourceX?: number;
  sourceY?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  fallbackZoomDelta?: number;
}

export interface RenderMapCanvas2dOptions {
  interactionPhase: 'idle' | 'interacting' | 'settling';
  viewWidth: number;
  viewHeight: number;
  view2d: View2dState;
  projectionScale: number;
  units: 'm' | 'ft';
}

export interface RenderBasemapCanvas2dOptions extends RenderMapCanvas2dOptions {
  canvas: HTMLCanvasElement;
  basemapTiles2d?: CanvasBasemapTile2d[];
}

export interface RenderGeometryCanvas2dOptions extends RenderMapCanvas2dOptions {
  canvas: HTMLCanvasElement;
  originalGeometryOpacity: number;
  lineWidth2d: number;
  pointRadius2d: number;
  ellipseStroke2d: number;
  interactionDenseMode: boolean;
  unselectedCanvasLines2d: ProjectedMapLine2D[];
  filteredVisiblePoints2d: ProjectedPoint2D[];
  ellipseStroke: (_stationId: string) => string;
  stationFill: (_stationId: string, _fixed: boolean) => string;
}

export interface CanvasPlanningPolygon2d {
  id: string;
  source: 'user' | 'osm';
  kind: 'blocked-area' | 'building' | 'wooded';
  label: string;
  vertices: Array<{ x: number; y: number }>;
}

export interface CanvasPlanningInputPoint2d {
  stationId: string;
  x: number;
  y: number;
}

export interface RenderPlanningOverlayCanvas2dOptions extends RenderMapCanvas2dOptions {
  canvas: HTMLCanvasElement;
  pointRadius2d: number;
  planningInputPoints2d: CanvasPlanningInputPoint2d[];
  planningPolygons2d: CanvasPlanningPolygon2d[];
  selectedPlanningPolygonIds?: string[];
}

export const renderGeometryCanvas2d = ({
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
  unselectedCanvasLines2d,
  filteredVisiblePoints2d,
  ellipseStroke,
  stationFill: _stationFill,
}: RenderGeometryCanvas2dOptions) => {
  return measureMapViewPerf('canvas:geometry', () => {
    const { context } = prepareCanvas({ canvas, interactionPhase, viewWidth, viewHeight });
    if (!context) return false;
    context.save();
    context.translate(view2d.panX, view2d.panY);
    context.scale(view2d.zoom, view2d.zoom);
    context.globalAlpha = originalGeometryOpacity;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = 'rgba(248,250,252,0.42)';
    context.lineWidth = lineWidth2d * 2.2;
    context.globalAlpha = 0.85 * originalGeometryOpacity;

    unselectedCanvasLines2d.forEach((line) => {
      context.beginPath();
      context.moveTo(line.x1, line.y1);
      context.lineTo(line.x2, line.y2);
      context.stroke();
    });

    context.strokeStyle = '#0f3b82';
    context.lineWidth = lineWidth2d;
    context.globalAlpha = 0.9 * originalGeometryOpacity;

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
      context.fillStyle = MAP_POINT_BORDER_STROKE;
      context.arc(point.x, point.y, pointRadius2d * 1.55, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.fillStyle = MAP_POINT_CENTER_FILL;
      context.arc(point.x, point.y, pointRadius2d, 0, Math.PI * 2);
      context.fill();
    });

    context.restore();
    return true;
  });
};

export const renderPlanningOverlayCanvas2d = ({
  canvas,
  interactionPhase,
  viewWidth,
  viewHeight,
  view2d,
  projectionScale: _projectionScale,
  units: _units,
  pointRadius2d,
  planningInputPoints2d,
  planningPolygons2d,
  selectedPlanningPolygonIds = [],
}: RenderPlanningOverlayCanvas2dOptions) => {
  return measureMapViewPerf('canvas:planning', () => {
    const { context } = prepareCanvas({ canvas, interactionPhase, viewWidth, viewHeight });
    if (!context) return false;
    const selectedIds = new Set(selectedPlanningPolygonIds);
    context.save();
    context.translate(view2d.panX, view2d.panY);
    context.scale(view2d.zoom, view2d.zoom);

    planningPolygons2d.forEach((polygon) => {
      if (selectedIds.has(polygon.id) || polygon.vertices.length < 3) return;
      context.beginPath();
      context.moveTo(polygon.vertices[0]!.x, polygon.vertices[0]!.y);
      for (let index = 1; index < polygon.vertices.length; index += 1) {
        const vertex = polygon.vertices[index]!;
        context.lineTo(vertex.x, vertex.y);
      }
      context.closePath();
      context.fillStyle =
        polygon.source === 'user'
          ? 'rgba(244,114,182,0.20)'
          : polygon.kind === 'wooded'
            ? 'rgba(74,222,128,0.16)'
            : 'rgba(148,163,184,0.16)';
      context.strokeStyle =
        polygon.source === 'user'
          ? '#f9a8d4'
          : polygon.kind === 'wooded'
            ? '#86efac'
            : '#cbd5e1';
      context.lineWidth = pointRadius2d * 0.18;
      context.fill();
      context.stroke();
    });

    planningInputPoints2d.forEach((point) => {
      context.beginPath();
      context.arc(point.x, point.y, pointRadius2d * 0.45, 0, Math.PI * 2);
      context.fillStyle = '#fef3c7';
      context.strokeStyle = '#f59e0b';
      context.lineWidth = pointRadius2d * 0.12;
      context.fill();
      context.stroke();
    });

    context.restore();
    return true;
  });
};

export const renderMapCanvas2d = (input: RenderGeometryCanvas2dOptions & { basemapTiles2d?: CanvasBasemapTile2d[] }) => {
  const basemapRendered = renderBasemapCanvas2d(input);
  const geometryRendered = renderGeometryCanvas2d(input);
  return basemapRendered || geometryRendered;
};
