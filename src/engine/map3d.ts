import type { AdjustmentResult } from '../types';

export type Vec3 = { x: number; y: number; z: number };

export interface Map3DStationNode {
  id: string;
  position: Vec3;
  fixed: boolean;
  lost: boolean;
  ellipsoid?: {
    semiMajor: number;
    semiMinor: number;
    semiVertical: number;
    thetaDeg: number;
  };
}

export interface Map3DEdge {
  from: string;
  to: string;
}

export interface Map3DScene {
  stations: Map3DStationNode[];
  edges: Map3DEdge[];
  extents: {
    min: Vec3;
    max: Vec3;
    center: Vec3;
    span: Vec3;
    radius: number;
  };
}

export interface Map3DCamera {
  yawDeg: number;
  pitchDeg: number;
  distance: number;
  target: Vec3;
  panX: number;
  panY: number;
  zoom: number;
}

const ZERO_EXTENTS: Map3DScene['extents'] = {
  min: { x: 0, y: 0, z: 0 },
  max: { x: 0, y: 0, z: 0 },
  center: { x: 0, y: 0, z: 0 },
  span: { x: 1, y: 1, z: 1 },
  radius: 1,
};

export const buildMap3DScene = (
  result: AdjustmentResult,
  showLostStations = true,
): Map3DScene => {
  const stations = Object.entries(result.stations)
    .filter(([, st]) => showLostStations || !st.lost)
    .map(([id, st]) => ({
      id,
      position: { x: st.x, y: st.y, z: st.h },
      fixed: st.fixed,
      lost: st.lost ?? false,
      ellipsoid:
        st.errorEllipse || st.sH != null
          ? {
              semiMajor: st.errorEllipse?.semiMajor ?? 0,
              semiMinor: st.errorEllipse?.semiMinor ?? 0,
              semiVertical: st.sH ?? 0,
              thetaDeg: st.errorEllipse?.theta ?? 0,
            }
          : undefined,
    }));

  if (stations.length === 0) {
    return { stations: [], edges: [], extents: ZERO_EXTENTS };
  }

  const stationIdSet = new Set(stations.map((s) => s.id));
  const edgeSeen = new Set<string>();
  const edges: Map3DEdge[] = [];
  result.observations.forEach((obs) => {
    if ((obs.type !== 'dist' && obs.type !== 'gps') || !stationIdSet.has(obs.from) || !stationIdSet.has(obs.to)) {
      return;
    }
    const key =
      obs.from.localeCompare(obs.to, undefined, { numeric: true }) <= 0
        ? `${obs.from}|${obs.to}`
        : `${obs.to}|${obs.from}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push({ from: obs.from, to: obs.to });
  });

  const xs = stations.map((s) => s.position.x);
  const ys = stations.map((s) => s.position.y);
  const zs = stations.map((s) => s.position.z);
  const min = {
    x: Math.min(...xs),
    y: Math.min(...ys),
    z: Math.min(...zs),
  };
  const max = {
    x: Math.max(...xs),
    y: Math.max(...ys),
    z: Math.max(...zs),
  };
  const span = {
    x: Math.max(1, max.x - min.x),
    y: Math.max(1, max.y - min.y),
    z: Math.max(1, max.z - min.z),
  };
  const center = {
    x: (min.x + max.x) * 0.5,
    y: (min.y + max.y) * 0.5,
    z: (min.z + max.z) * 0.5,
  };
  const radius = Math.max(span.x, span.y, span.z) * 0.5;

  return { stations, edges, extents: { min, max, center, span, radius } };
};

export const createDefaultMap3DCamera = (scene: Map3DScene): Map3DCamera => ({
  yawDeg: -35,
  pitchDeg: 25,
  distance: Math.max(5, scene.extents.radius * 3),
  target: { ...scene.extents.center },
  panX: 0,
  panY: 0,
  zoom: 1,
});
