import type { Map3DCamera, Map3DScene, Map3DStationNode, Vec3 } from '../../engine/map3d';

const DEG_TO_RAD = Math.PI / 180;

export interface ProjectedPoint3D {
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

export interface ProjectedStation3D {
  node: Map3DStationNode;
  p: ProjectedPoint3D;
}

export const projectPoint3d = (
  camera3d: Map3DCamera | null,
  point: Vec3,
  viewWidth: number,
  viewHeight: number,
): ProjectedPoint3D => {
  if (!camera3d) {
    return { x: viewWidth / 2, y: viewHeight / 2, depth: 1, visible: false };
  }
  const target = {
    x: camera3d.target.x + camera3d.panX,
    y: camera3d.target.y + camera3d.panY,
    z: camera3d.target.z,
  };
  const relX = point.x - target.x;
  const relY = point.y - target.y;
  const relZ = point.z - target.z;
  const yaw = camera3d.yawDeg * DEG_TO_RAD;
  const pitch = camera3d.pitchDeg * DEG_TO_RAD;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const xYaw = relX * cosYaw - relY * sinYaw;
  const yYaw = relX * sinYaw + relY * cosYaw;
  const yPitch = yYaw * cosPitch - relZ * sinPitch;
  const zPitch = yYaw * sinPitch + relZ * cosPitch;
  const depth = camera3d.distance - yPitch;
  const safeDepth = Math.max(0.2, depth);
  const focal = 420 * camera3d.zoom;
  const perspective = focal / safeDepth;
  return {
    x: viewWidth / 2 + xYaw * perspective,
    y: viewHeight / 2 - zPitch * perspective,
    depth: safeDepth,
    visible: depth > 0,
  };
};

export const buildProjectedStations3d = (
  scene3d: Map3DScene,
  camera3d: Map3DCamera | null,
  viewWidth: number,
  viewHeight: number,
): ProjectedStation3D[] =>
  scene3d.stations
    .map((node) => ({ node, p: projectPoint3d(camera3d, node.position, viewWidth, viewHeight) }))
    .filter((row) => row.p.visible)
    .sort((a, b) => b.p.depth - a.p.depth);

export const buildProjectedStationLookup3d = (projected3d: ProjectedStation3D[]) => {
  const map = new Map<string, ProjectedPoint3D>();
  projected3d.forEach((row) => map.set(row.node.id, row.p));
  return map;
};

export const buildVisiblePointLabels3d = (
  projected3d: ProjectedStation3D[],
  selectedStationId: string | null,
  denseLabelPointThreshold: number,
  labelGridPx: number,
) => {
  if (projected3d.length === 0) return new Set<string>();
  if (projected3d.length <= denseLabelPointThreshold) {
    return new Set(projected3d.map((row) => row.node.id));
  }
  const next = new Set<string>();
  const occupied = new Set<string>();
  projected3d.forEach((row) => {
    const key = `${Math.floor(row.p.x / labelGridPx)}:${Math.floor(row.p.y / labelGridPx)}`;
    if (!occupied.has(key) || row.node.id === selectedStationId) {
      occupied.add(key);
      next.add(row.node.id);
    }
  });
  return next;
};

export const buildEllipsoidRings3d = (
  center: Vec3,
  ellipsoid: { semiMajor: number; semiMinor: number; semiVertical: number; thetaDeg: number },
  sceneRadius: number,
  project3d: (_point: Vec3) => ProjectedPoint3D,
  maxSamples: number,
) => {
  const theta = ellipsoid.thetaDeg * DEG_TO_RAD;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const exaggeration = Math.max(1, sceneRadius * 0.01);
  const a = Math.max(0, ellipsoid.semiMajor * exaggeration * 80);
  const b = Math.max(0, ellipsoid.semiMinor * exaggeration * 80);
  const c = Math.max(0, ellipsoid.semiVertical * exaggeration * 80);
  if (a <= 0 && b <= 0 && c <= 0) return [] as string[];

  const ring = (builder: (_t: number) => Vec3) => {
    const coords: string[] = [];
    for (let i = 0; i <= maxSamples; i += 1) {
      const t = (i / maxSamples) * Math.PI * 2;
      const p = project3d(builder(t));
      if (!p.visible) continue;
      coords.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
    }
    return coords.join(' ');
  };

  const xy = ring((t) => {
    const lx = a * Math.cos(t);
    const ly = b * Math.sin(t);
    return {
      x: center.x + lx * cosT - ly * sinT,
      y: center.y + lx * sinT + ly * cosT,
      z: center.z,
    };
  });
  const xz = ring((t) => ({
    x: center.x + a * Math.cos(t) * cosT,
    y: center.y + a * Math.cos(t) * sinT,
    z: center.z + c * Math.sin(t),
  }));
  const yz = ring((t) => ({
    x: center.x - b * Math.cos(t) * sinT,
    y: center.y + b * Math.cos(t) * cosT,
    z: center.z + c * Math.sin(t),
  }));
  return [xy, xz, yz].filter((poly) => poly.length > 0);
};
