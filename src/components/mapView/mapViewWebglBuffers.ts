import type { ProjectedPoint2D } from './mapView2d';
import {
  MAP_POINT_BORDER_STROKE,
  MAP_POINT_CENTER_FILL,
} from './mapViewColors';

interface BracePreviewPoint2d {
  scenarioId: string;
  stationId: string;
  templateLabel: string;
  x: number;
  y: number;
  active: boolean;
}

interface ScenarioPreviewSegment2d {
  scenarioId: string;
  fromStationId: string;
  toStationId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: 'sight-line' | 'cross-tie';
  active: boolean;
}

export interface MapViewWebglLinePrimitive2d {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: [number, number, number, number];
}

export interface MapViewWebglPointPrimitive2d {
  x: number;
  y: number;
  size: number;
  color: [number, number, number, number];
}

export interface MapViewWebglScene2d {
  surveyHaloLineWidth: number;
  surveyLineWidth: number;
  previewLineWidth: number;
  ellipseLineWidth: number;
  surveyHaloLines: MapViewWebglLinePrimitive2d[];
  surveyLines: MapViewWebglLinePrimitive2d[];
  previewLines: MapViewWebglLinePrimitive2d[];
  ellipseLines: MapViewWebglLinePrimitive2d[];
  surveyHaloPoints: MapViewWebglPointPrimitive2d[];
  surveyPoints: MapViewWebglPointPrimitive2d[];
  previewPoints: MapViewWebglPointPrimitive2d[];
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const parseHexByte = (value: string): number => Number.parseInt(value, 16) / 255;

export const parseCssColorToWebglRgba = (
  value: string,
  alphaOverride?: number,
): [number, number, number, number] => {
  const trimmed = value.trim();
  const alpha = alphaOverride == null ? 1 : clamp01(alphaOverride);
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    const hex = trimmed.slice(1);
    if (hex.length === 3) {
      const r = parseHexByte(`${hex[0]}${hex[0]}`);
      const g = parseHexByte(`${hex[1]}${hex[1]}`);
      const b = parseHexByte(`${hex[2]}${hex[2]}`);
      return [r, g, b, alpha];
    }
    return [
      parseHexByte(hex.slice(0, 2)),
      parseHexByte(hex.slice(2, 4)),
      parseHexByte(hex.slice(4, 6)),
      alpha,
    ];
  }
  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+))?\s*\)$/i,
  );
  if (rgbaMatch) {
    const r = clamp01(Number.parseFloat(rgbaMatch[1] ?? '0') / 255);
    const g = clamp01(Number.parseFloat(rgbaMatch[2] ?? '0') / 255);
    const b = clamp01(Number.parseFloat(rgbaMatch[3] ?? '0') / 255);
    const parsedAlpha =
      alphaOverride == null
        ? clamp01(Number.parseFloat(rgbaMatch[4] ?? '1'))
        : alpha;
    return [r, g, b, parsedAlpha];
  }
  return [1, 1, 1, alpha];
};

const appendEllipseSegments = (input: {
  output: MapViewWebglLinePrimitive2d[];
  point: ProjectedPoint2D;
  color: [number, number, number, number];
  ellipseScale: number;
  projectionScale: number;
  sampleCount?: number;
}): void => {
  const ellipsoid = input.point.ellipsoid;
  if (!ellipsoid) return;
  const sampleCount = input.sampleCount ?? 24;
  const thetaRad = (ellipsoid.thetaDeg * Math.PI) / 180;
  const cosTheta = Math.cos(thetaRad);
  const sinTheta = Math.sin(thetaRad);
  const radiusX = ellipsoid.semiMajor * 100 * input.ellipseScale * input.projectionScale;
  const radiusY = ellipsoid.semiMinor * 100 * input.ellipseScale * input.projectionScale;
  const sampleAt = (t: number) => {
    const localX = Math.cos(t) * radiusX;
    const localY = Math.sin(t) * radiusY;
    return {
      x: input.point.x + localX * cosTheta - localY * sinTheta,
      y: input.point.y + localX * sinTheta + localY * cosTheta,
    };
  };
  let previous = sampleAt(0);
  for (let index = 1; index <= sampleCount; index += 1) {
    const current = sampleAt((index / sampleCount) * Math.PI * 2);
    input.output.push({
      x1: previous.x,
      y1: previous.y,
      x2: current.x,
      y2: current.y,
      color: input.color,
    });
    previous = current;
  }
};

export const buildMapViewWebglScene2d = (input: {
  originalGeometryOpacity: number;
  lineWidth2d: number;
  pointRadius2d: number;
  ellipseStroke2d: number;
  viewZoom: number;
  projectionScale: number;
  units: 'm' | 'ft';
  interactionDenseMode: boolean;
  unselectedCanvasLines2d: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  }>;
  filteredVisiblePoints2d: ProjectedPoint2D[];
  ellipseStroke: (_stationId: string) => string;
  stationFill: (_stationId: string, _fixed: boolean) => string;
  bracePreviewPoints2d?: BracePreviewPoint2d[];
  scenarioPreviewSegments2d?: ScenarioPreviewSegment2d[];
}): MapViewWebglScene2d => {
  const geometryAlpha = clamp01(input.originalGeometryOpacity);
  const zoomScale = Math.max(1e-6, input.viewZoom);
  const surveyHaloLineWidth = input.lineWidth2d * 2.2 * zoomScale;
  const surveyLineWidth = input.lineWidth2d * zoomScale;
  const previewLineWidth = input.lineWidth2d * 1.05 * zoomScale;
  const ellipseLineWidth = input.ellipseStroke2d * zoomScale;
  const surveyHaloLineColor = parseCssColorToWebglRgba('#f8fafc', 0.42 * geometryAlpha);
  const surveyLineColor = parseCssColorToWebglRgba('#0f3b82', 0.9 * geometryAlpha);
  const surveyHaloLines: MapViewWebglLinePrimitive2d[] = input.unselectedCanvasLines2d.map((line) => ({
    x1: line.x1,
    y1: line.y1,
    x2: line.x2,
    y2: line.y2,
    color: surveyHaloLineColor,
  }));
  const surveyLines: MapViewWebglLinePrimitive2d[] = input.unselectedCanvasLines2d.map((line) => ({
    x1: line.x1,
    y1: line.y1,
    x2: line.x2,
    y2: line.y2,
    color: surveyLineColor,
  }));
  const surveyHaloPoints: MapViewWebglPointPrimitive2d[] = input.filteredVisiblePoints2d.map((point) => ({
    x: point.x,
    y: point.y,
    size: input.pointRadius2d * 3.2 * zoomScale,
    color: parseCssColorToWebglRgba(MAP_POINT_BORDER_STROKE, 0.95 * geometryAlpha),
  }));
  const surveyPoints: MapViewWebglPointPrimitive2d[] = input.filteredVisiblePoints2d.map((point) => ({
    x: point.x,
    y: point.y,
    size: input.pointRadius2d * 2.25 * zoomScale,
    color: parseCssColorToWebglRgba(MAP_POINT_CENTER_FILL, geometryAlpha),
  }));
  const previewLines: MapViewWebglLinePrimitive2d[] = (input.scenarioPreviewSegments2d ?? []).map(
    (segment) => ({
      x1: segment.x1,
      y1: segment.y1,
      x2: segment.x2,
      y2: segment.y2,
      color: parseCssColorToWebglRgba(
        segment.kind === 'cross-tie'
          ? '#fda4af'
          : segment.active
            ? '#f472b6'
            : '#f9a8d4',
        0.9,
      ),
    }),
  );
  const previewPoints: MapViewWebglPointPrimitive2d[] = (input.bracePreviewPoints2d ?? []).map(
    (point) => ({
      x: point.x,
      y: point.y,
      size: input.pointRadius2d * 2.3 * zoomScale,
      color: parseCssColorToWebglRgba(point.active ? '#f472b6' : '#f9a8d4', 1),
    }),
  );
  const ellipseLines: MapViewWebglLinePrimitive2d[] = [];
  if (!input.interactionDenseMode) {
    const ellipseScale = input.units === 'ft' ? 0.0328084 : 1;
    input.filteredVisiblePoints2d.forEach((point) => {
      appendEllipseSegments({
        output: ellipseLines,
        point,
        color: parseCssColorToWebglRgba(
          input.ellipseStroke(point.id),
          0.6 * geometryAlpha,
        ),
        ellipseScale,
        projectionScale: input.projectionScale,
      });
    });
  }
  return {
    surveyHaloLineWidth,
    surveyLineWidth,
    previewLineWidth,
    ellipseLineWidth,
    surveyHaloLines,
    surveyLines,
    previewLines,
    ellipseLines,
    surveyHaloPoints,
    surveyPoints,
    previewPoints,
  };
};
