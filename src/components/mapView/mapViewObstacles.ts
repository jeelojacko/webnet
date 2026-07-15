import type { CoordSystemMode, CrsProjectionModel, PlanningMapPolygon } from '../../types';
import { inverseENToGeodetic, projectGeodeticToEN } from '../../engine/geodesy';
import { createStableRuntimeId } from '../../engine/id';
import type { OverpassElement } from './mapViewInteraction';

export interface PlanningGeorefContext {
  originLatDeg: number;
  originLonDeg: number;
  model: CrsProjectionModel;
  coordSystemMode?: CoordSystemMode;
  crsId?: string;
}

export interface PlanningFetchExtent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const buildObstacleFetchSignature = (
  planningGeorefContext: PlanningGeorefContext,
  planningFetchExtent: PlanningFetchExtent,
): string =>
  [
    planningGeorefContext.originLatDeg.toFixed(8),
    planningGeorefContext.originLonDeg.toFixed(8),
    planningGeorefContext.coordSystemMode,
    planningGeorefContext.crsId ?? '',
    planningGeorefContext.model,
    planningFetchExtent.minX.toFixed(3),
    planningFetchExtent.maxX.toFixed(3),
    planningFetchExtent.minY.toFixed(3),
    planningFetchExtent.maxY.toFixed(3),
  ].join('|');

export const buildOverpassObstacleQuery = (
  planningGeorefContext: PlanningGeorefContext,
  planningFetchExtent: PlanningFetchExtent,
): string | null => {
  const cornerA = inverseENToGeodetic({
    east: planningFetchExtent.minX,
    north: planningFetchExtent.minY,
    ...planningGeorefContext,
  });
  const cornerB = inverseENToGeodetic({
    east: planningFetchExtent.maxX,
    north: planningFetchExtent.maxY,
    ...planningGeorefContext,
  });
  if ('failureReason' in cornerA || 'failureReason' in cornerB) return null;
  const minLat = Math.min(cornerA.latDeg, cornerB.latDeg);
  const maxLat = Math.max(cornerA.latDeg, cornerB.latDeg);
  const minLon = Math.min(cornerA.lonDeg, cornerB.lonDeg);
  const maxLon = Math.max(cornerA.lonDeg, cornerB.lonDeg);
  return `[out:json][timeout:20];(way["building"](${minLat},${minLon},${maxLat},${maxLon});way["landuse"="forest"](${minLat},${minLon},${maxLat},${maxLon});way["natural"="wood"](${minLat},${minLon},${maxLat},${maxLon});relation["building"](${minLat},${minLon},${maxLat},${maxLon}););out geom;`;
};

const projectOverpassGeometry = (
  element: OverpassElement,
  planningGeorefContext: PlanningGeorefContext,
): PlanningMapPolygon['vertices'] => {
  const geometry = Array.isArray(element.geometry) ? element.geometry : [];
  return geometry
    .map((vertex) => {
      if (
        typeof vertex?.lat !== 'number' ||
        !Number.isFinite(vertex.lat) ||
        typeof vertex?.lon !== 'number' ||
        !Number.isFinite(vertex.lon)
      ) {
        return null;
      }
      const projected = projectGeodeticToEN({
        latDeg: vertex.lat,
        lonDeg: vertex.lon,
        originLatDeg: planningGeorefContext.originLatDeg,
        originLonDeg: planningGeorefContext.originLonDeg,
        model: planningGeorefContext.model,
        coordSystemMode: planningGeorefContext.coordSystemMode,
        crsId: planningGeorefContext.crsId,
      });
      return { x: projected.east, y: projected.north };
    })
    .filter(
      (vertex: PlanningMapPolygon['vertices'][number] | null): vertex is PlanningMapPolygon['vertices'][number] =>
        vertex != null,
    );
};

export const parseOverpassObstaclePolygons = (
  elements: OverpassElement[],
  planningGeorefContext: PlanningGeorefContext,
): PlanningMapPolygon[] =>
  elements
    .map((element): PlanningMapPolygon | null => {
      const vertices = projectOverpassGeometry(element, planningGeorefContext);
      if (vertices.length < 3) return null;
      const isWooded = element.tags?.landuse === 'forest' || element.tags?.natural === 'wood';
      return {
        id: `osm-${String(element.id ?? createStableRuntimeId('osm'))}`,
        source: 'osm',
        kind: isWooded ? 'wooded' : 'building',
        label: isWooded ? 'OSM wooded' : 'OSM building',
        vertices,
      };
    })
    .filter((polygon): polygon is PlanningMapPolygon => polygon != null);
