import { computeInverse2D, computePivotAngles } from '../../engine/mapTools';
import type { Map3DCamera, Map3DScene } from '../../engine/map3d';
import type { Observation, StationMap } from '../../types';
import type { ProjectablePoint2D, View2dState } from './mapView2d';
import {
  buildProjectedStationLookup3d,
  buildProjectedStations3d,
  buildVisiblePointLabels3d,
  type ProjectedPoint3D,
  type ProjectedStation3D,
} from './mapView3d';

export interface MapScenePointBounds2d {
  points: ProjectablePoint2D[];
  bbox: {
    minX: number;
    minY: number;
    width: number;
    height: number;
  };
}

export interface MapViewStyle2d {
  pointRadius2d: number;
  lineWidth2d: number;
  ellipseStroke2d: number;
  labelFont2d: number;
  labelStroke2d: number;
  labelOffset2d: number;
  marker2d: number;
  originalGeometryOpacity: number;
}

export interface TransformedOverlayGeometry2d {
  transformedLines2d: Array<{ key: string; x1: number; y1: number; x2: number; y2: number }>;
  transformedPoints2d: Array<{ id: string; x: number; y: number; fixed: boolean }>;
}

export interface ProjectedMapState3d {
  projected3d: ProjectedStation3D[];
  projected3dById: Map<string, ProjectedPoint3D>;
  visiblePointLabels3d: Set<string>;
}

export interface MapToolMetrics {
  inverse: ReturnType<typeof computeInverse2D> | null;
  angleBetween: ReturnType<typeof computePivotAngles> | null;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const buildMapScenePointBounds2d = (
  scene3d: Pick<Map3DScene, 'stations'>,
): MapScenePointBounds2d => {
  if (scene3d.stations.length === 0) {
    return {
      points: [],
      bbox: { minX: 0, minY: 0, width: 1, height: 1 },
    };
  }

  const xs = scene3d.stations.map((station) => station.position.x);
  const ys = scene3d.stations.map((station) => station.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1);

  return {
    points: scene3d.stations.map((station) => ({
      id: station.id,
      x: station.position.x,
      y: station.position.y,
      h: station.position.z,
      fixed: station.fixed,
      ellipsoid: station.ellipsoid,
    })),
    bbox: {
      minX: minX - pad,
      minY: minY - pad,
      width: maxX - minX + pad * 2,
      height: maxY - minY + pad * 2,
    },
  };
};

export const buildMapViewStyle2d = (
  view2d: Pick<View2dState, 'zoom'>,
  transformedOverlayActive: boolean,
): MapViewStyle2d => {
  const safeZoom = Math.max(view2d.zoom, 1e-6);
  const zoomLog2 = Math.max(0, Math.log2(safeZoom));
  const pointRadius2dPx = clamp(6.4 + zoomLog2 * 0.6, 6.4, 10.2);
  const lineWidth2dPx = clamp(1.8 + zoomLog2 * 0.22, 1.8, 3);
  const ellipseStroke2dPx = clamp(1.2 + zoomLog2 * 0.14, 1.2, 2.1);
  const labelFont2dPx = clamp(12 + Math.max(0, Math.log2(view2d.zoom)) * 3, 12, 26);
  const labelStroke2dPx = clamp(labelFont2dPx * 0.12, 1.2, 2.8);
  const labelOffset2dPx = clamp(labelFont2dPx * 0.85, 9, 22);
  const marker2dPx = clamp(5.4 + zoomLog2 * 0.45, 5.4, 8.2);
  const invZoom2d = 1 / safeZoom;

  return {
    pointRadius2d: pointRadius2dPx * invZoom2d,
    lineWidth2d: lineWidth2dPx * invZoom2d,
    ellipseStroke2d: ellipseStroke2dPx * invZoom2d,
    labelFont2d: labelFont2dPx * invZoom2d,
    labelStroke2d: labelStroke2dPx * invZoom2d,
    labelOffset2d: labelOffset2dPx * invZoom2d,
    marker2d: marker2dPx * invZoom2d,
    originalGeometryOpacity: transformedOverlayActive ? 0.25 : 1,
  };
};

export const buildTransformedOverlayGeometry2d = (input: {
  transformedOverlayActive: boolean;
  observations: Observation[];
  stations: StationMap;
  showLostStations: boolean;
  transformedByStationId: Map<string, { east: number; north: number }>;
  points: ProjectablePoint2D[];
}): TransformedOverlayGeometry2d => {
  if (!input.transformedOverlayActive) {
    return {
      transformedLines2d: [],
      transformedPoints2d: [],
    };
  }

  const transformedLines2d = input.observations
    .map((obs, index) => {
      if (obs.type !== 'dist' && obs.type !== 'gps') return null;
      const fromStation = input.stations[obs.from];
      const toStation = input.stations[obs.to];
      if (!fromStation || !toStation) return null;
      if (!input.showLostStations && (fromStation.lost || toStation.lost)) return null;
      const from = input.transformedByStationId.get(obs.from);
      const to = input.transformedByStationId.get(obs.to);
      if (!from || !to) return null;
      return {
        key: `tx-line-${index}`,
        x1: from.east,
        y1: from.north,
        x2: to.east,
        y2: to.north,
      };
    })
    .filter(
      (
        line,
      ): line is {
        key: string;
        x1: number;
        y1: number;
        x2: number;
        y2: number;
      } => line != null,
    );

  const transformedPoints2d = input.points
    .map((point) => {
      const transformed = input.transformedByStationId.get(point.id);
      if (!transformed) return null;
      return {
        id: point.id,
        x: transformed.east,
        y: transformed.north,
        fixed: point.fixed,
      };
    })
    .filter(
      (
        point,
      ): point is {
        id: string;
        x: number;
        y: number;
        fixed: boolean;
      } => point != null,
    );

  return { transformedLines2d, transformedPoints2d };
};

export const buildProjectedMapState3d = (input: {
  effectiveMode: '2d' | '3d';
  camera3d: Map3DCamera | null;
  scene3d: Map3DScene;
  selectedStationId: string | null;
  denseLabelPointThreshold: number;
  labelGridPx: number;
  viewWidth: number;
  viewHeight: number;
}): ProjectedMapState3d => {
  if (input.effectiveMode !== '3d' || !input.camera3d) {
    return {
      projected3d: [],
      projected3dById: new Map<string, ProjectedPoint3D>(),
      visiblePointLabels3d: new Set<string>(),
    };
  }

  const projected3d = buildProjectedStations3d(
    input.scene3d,
    input.camera3d,
    input.viewWidth,
    input.viewHeight,
  );
  return {
    projected3d,
    projected3dById: buildProjectedStationLookup3d(projected3d),
    visiblePointLabels3d: buildVisiblePointLabels3d(
      projected3d,
      input.selectedStationId,
      input.denseLabelPointThreshold,
      input.labelGridPx,
    ),
  };
};

export const buildMapToolMetrics = (input: {
  stations: StationMap;
  inverseFromId: string | null;
  inverseToId: string | null;
  anglePivotId: string | null;
  angleFromId: string | null;
  angleToId: string | null;
}): MapToolMetrics => {
  let inverse: ReturnType<typeof computeInverse2D> | null = null;
  if (input.inverseFromId && input.inverseToId) {
    const from = input.stations[input.inverseFromId];
    const to = input.stations[input.inverseToId];
    if (from && to) {
      inverse = computeInverse2D({ x: from.x, y: from.y }, { x: to.x, y: to.y });
    }
  }

  let angleBetween: ReturnType<typeof computePivotAngles> | null = null;
  if (input.anglePivotId && input.angleFromId && input.angleToId) {
    const pivot = input.stations[input.anglePivotId];
    const from = input.stations[input.angleFromId];
    const to = input.stations[input.angleToId];
    if (pivot && from && to) {
      angleBetween = computePivotAngles(
        { x: pivot.x, y: pivot.y },
        { x: from.x, y: from.y },
        { x: to.x, y: to.y },
      );
    }
  }

  return { inverse, angleBetween };
};
