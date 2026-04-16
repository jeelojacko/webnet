import proj4 from 'proj4';

import { getCanadianCrsDefinitionForTest } from './canadianCrsTestCatalog';

export type SyntheticCanadianNetworkTemplate = 'braced-quadrilateral';

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
  centerLatDeg: number;
  centerLonDeg: number;
  stations: TrueStation[];
}

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
  if (template !== 'braced-quadrilateral') {
    throw new Error(`Unsupported synthetic network template: ${template}`);
  }
  const scale = 0.85 + random() * 0.4;
  const rotation = random() * Math.PI * 2;
  const base = [
    { id: 'A', role: 'fixed' as const, east: -120, north: -80 },
    { id: 'B', role: 'fixed' as const, east: 130, north: -70 },
    { id: 'C', role: 'main' as const, east: -30, north: 120 },
    { id: 'D', role: 'main' as const, east: 160, north: 110 },
    { id: 'L', role: 'leaf' as const, east: 80, north: 260 },
  ];
  const stations: TrueStation[] = base.map((row, index) => {
    const rotated = rotate(row.east * scale, row.north * scale, rotation);
    const elevationNoise = row.role === 'fixed' ? 0 : (random() - 0.5) * 3;
    return {
      id: row.id,
      easting: centerEast + rotated.east,
      northing: centerNorth + rotated.north,
      elevation: 100 + elevationNoise + index * 0.2,
      role: row.role,
    };
  });
  return {
    crsId,
    seed,
    template,
    centerLatDeg: center.latDeg,
    centerLonDeg: center.lonDeg,
    stations,
  };
};
