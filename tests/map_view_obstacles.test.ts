import { describe, expect, it } from 'vitest';

import {
  buildObstacleFetchSignature,
  buildOverpassObstacleQuery,
  parseOverpassObstaclePolygons,
  type PlanningFetchExtent,
  type PlanningGeorefContext,
} from '../src/components/mapView/mapViewObstacles';

const georef: PlanningGeorefContext = {
  originLatDeg: 45,
  originLonDeg: -66,
  model: 'legacy-equirectangular',
  coordSystemMode: 'local',
};

const extent: PlanningFetchExtent = {
  minX: -10,
  maxX: 25,
  minY: -5,
  maxY: 15,
};

describe('map view OSM obstacle helpers', () => {
  it('builds a deterministic fetch signature from georef and extent', () => {
    expect(buildObstacleFetchSignature(georef, extent)).toBe(
      '45.00000000|-66.00000000|local||legacy-equirectangular|-10.000|25.000|-5.000|15.000',
    );
  });

  it('builds one Overpass query for buildings and wooded areas', () => {
    const query = buildOverpassObstacleQuery(georef, extent);
    expect(query).toContain('way["building"]');
    expect(query).toContain('way["landuse"="forest"]');
    expect(query).toContain('way["natural"="wood"]');
    expect(query).toContain('relation["building"]');
  });

  it('projects Overpass building and wooded geometry into planning polygons', () => {
    const polygons = parseOverpassObstaclePolygons(
      [
        {
          id: 12,
          tags: { building: 'yes' },
          geometry: [
            { lat: 45, lon: -66 },
            { lat: 45.0001, lon: -66 },
            { lat: 45.0001, lon: -65.9999 },
          ],
        },
        {
          id: 13,
          tags: { natural: 'wood' },
          geometry: [
            { lat: 45, lon: -66 },
            { lat: 45.0002, lon: -66 },
            { lat: 45.0002, lon: -65.9998 },
          ],
        },
      ],
      georef,
    );
    expect(polygons.map((polygon) => polygon.kind)).toEqual(['building', 'wooded']);
    expect(polygons.map((polygon) => polygon.id)).toEqual(['osm-12', 'osm-13']);
    expect(polygons[0]?.vertices).toHaveLength(3);
  });
});
