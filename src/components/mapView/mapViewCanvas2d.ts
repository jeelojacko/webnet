import type { ProjectedMapLine2D, ProjectedPoint2D, View2dState } from './mapView2d';

interface CanvasEllipseLookupRow {
  semiMajor: number;
  semiMinor: number;
  thetaDeg: number;
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
  unselectedCanvasLines2d: ProjectedMapLine2D[];
  filteredVisiblePoints2d: ProjectedPoint2D[];
  ellipseStroke: (_stationId: string) => string;
  stationFill: (_stationId: string, _fixed: boolean) => string;
}

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
