import proj4 from 'proj4';

import { getCanadianCrsDefinitionForTest } from './canadianCrsTestCatalog';

export type SyntheticCanadianNetworkTemplate =
  | 'braced-quadrilateral'
  | 'short-traverse'
  | 'loop'
  | 'mixed-3d';
export type SyntheticCanadianNetworkCoordinateMode = '2D' | '3D';

export interface TrueStation {
  id: string;
  northing: number;
  easting: number;
  elevation: number;
  role: 'fixed' | 'main' | 'leaf' | 'side';
}

export interface SyntheticCanadianNetwork {
  crsId: string;
  seed: number;
  template: SyntheticCanadianNetworkTemplate;
  coordMode: SyntheticCanadianNetworkCoordinateMode;
  centerLatDeg: number;
  centerLonDeg: number;
  stations: TrueStation[];
}

type TemplateStationSeed = {
  id: string;
  role: TrueStation['role'];
  east: number;
  north: number;
  elevation: number;
};

const NETWORK_TEMPLATE_BASES: Record<
  SyntheticCanadianNetworkTemplate,
  {
    coordMode: SyntheticCanadianNetworkCoordinateMode;
    stations: TemplateStationSeed[];
  }
> = {
  'braced-quadrilateral': {
    coordMode: '2D',
    stations: [
      { id: 'A', role: 'fixed', east: -120, north: -80, elevation: 100 },
      { id: 'B', role: 'fixed', east: 130, north: -70, elevation: 100.2 },
      { id: 'C', role: 'main', east: -30, north: 120, elevation: 100.8 },
      { id: 'D', role: 'main', east: 160, north: 110, elevation: 101.1 },
      { id: 'L', role: 'leaf', east: 80, north: 260, elevation: 102.4 },
    ],
  },
  'short-traverse': {
    coordMode: '2D',
    stations: [
      { id: 'A', role: 'fixed', east: -180, north: -60, elevation: 100 },
      { id: 'B', role: 'fixed', east: 200, north: -50, elevation: 100.1 },
      { id: 'C', role: 'main', east: -70, north: 35, elevation: 100.7 },
      { id: 'D', role: 'main', east: 60, north: 95, elevation: 101.2 },
      { id: 'L', role: 'leaf', east: 150, north: 180, elevation: 102.1 },
    ],
  },
  loop: {
    coordMode: '2D',
    stations: [
      { id: 'A', role: 'fixed', east: -170, north: -60, elevation: 100 },
      { id: 'B', role: 'fixed', east: 180, north: -70, elevation: 100.1 },
      { id: 'C', role: 'main', east: -110, north: 110, elevation: 100.9 },
      { id: 'D', role: 'main', east: 40, north: 180, elevation: 101.5 },
      { id: 'E', role: 'side', east: 190, north: 70, elevation: 101.0 },
      { id: 'L', role: 'leaf', east: 70, north: 290, elevation: 102.6 },
    ],
  },
  'mixed-3d': {
    coordMode: '3D',
    stations: [
      { id: 'A', role: 'fixed', east: -170, north: -110, elevation: 98.4 },
      { id: 'B', role: 'fixed', east: 185, north: -85, elevation: 101.7 },
      { id: 'E', role: 'fixed', east: 35, north: 210, elevation: 103.2 },
      { id: 'C', role: 'main', east: -60, north: 25, elevation: 126.4 },
      { id: 'D', role: 'main', east: 115, north: 70, elevation: 82.8 },
      { id: 'L', role: 'leaf', east: 85, north: 205, elevation: 118.6 },
    ],
  },
};

const createMulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const rotate = (east: number, north: number, radians: number): { east: number; north: number } => ({
  east: east * Math.cos(radians) - north * Math.sin(radians),
  north: east * Math.sin(radians) + north * Math.cos(radians),
});

const midpoint = (min: number, max: number): number => min + (max - min) * 0.5;

const pickInteriorCenter = (
  bounds: { westLon: number; southLat: number; eastLon: number; northLat: number },
  random: () => number,
): { latDeg: number; lonDeg: number } => {
  const latSpan = bounds.northLat - bounds.southLat;
  const lonSpan = bounds.eastLon - bounds.westLon;
  const latMargin = latSpan * 0.2;
  const lonMargin = lonSpan * 0.2;
  const south = bounds.southLat + latMargin;
  const north = bounds.northLat - latMargin;
  const west = bounds.westLon + lonMargin;
  const east = bounds.eastLon - lonMargin;
  return {
    latDeg: latSpan > 0.5 ? south + (north - south) * random() : midpoint(bounds.southLat, bounds.northLat),
    lonDeg: lonSpan > 0.5 ? west + (east - west) * random() : midpoint(bounds.westLon, bounds.eastLon),
  };
};

export const generateSyntheticCanadianNetwork = ({
  crsId,
  seed,
  template = 'braced-quadrilateral',
}: {
  crsId: string;
  seed: number;
  template?: SyntheticCanadianNetworkTemplate;
}): SyntheticCanadianNetwork => {
  const def = getCanadianCrsDefinitionForTest(crsId);
  const random = createMulberry32(seed);
  const templateSeed = NETWORK_TEMPLATE_BASES[template];
  if (!templateSeed) {
    throw new Error(`Unsupported synthetic network template: ${template}`);
  }
  const center = pickInteriorCenter(
    {
      westLon: def.areaOfUseBounds?.minLonDeg ?? -120,
      southLat: def.areaOfUseBounds?.minLatDeg ?? 45,
      eastLon: def.areaOfUseBounds?.maxLonDeg ?? -60,
      northLat: def.areaOfUseBounds?.maxLatDeg ?? 60,
    },
    random,
  );
  const [centerEast, centerNorth] = proj4('WGS84', def.proj4, [center.lonDeg, center.latDeg]);
  if (!Number.isFinite(centerEast) || !Number.isFinite(centerNorth)) {
    throw new Error(`Failed to project synthetic center for ${crsId}`);
  }
  const scale = 0.85 + random() * 0.4;
  const rotation = random() * Math.PI * 2;
  const stations: TrueStation[] = templateSeed.stations.map((row, index) => {
    const rotated = rotate(row.east * scale, row.north * scale, rotation);
    const elevationNoise =
      templateSeed.coordMode === '3D' && row.role !== 'fixed' ? (random() - 0.5) * 1.2 : 0;
    return {
      id: row.id,
      easting: centerEast + rotated.east,
      northing: centerNorth + rotated.north,
      elevation: row.elevation + elevationNoise + index * 0.05,
      role: row.role,
    };
  });
  return {
    crsId,
    seed,
    template,
    coordMode: templateSeed.coordMode,
    centerLatDeg: center.latDeg,
    centerLonDeg: center.lonDeg,
    stations,
  };
};
