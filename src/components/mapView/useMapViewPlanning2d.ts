import { useCallback, useMemo } from 'react';

import { inverseENToGeodetic } from '../../engine/geodesy';
import type { AdjustmentResult, PlanningMapState, StationMap } from '../../types';
import { isPointInsidePolygon } from './mapViewInteraction';
import type { MapBounds2d, Projection2d, View2dState } from './mapView2d';
import type { PlanningFetchExtent, PlanningGeorefContext } from './mapViewObstacles';

export interface BracePreviewPoint2d {
  stationId: string;
  scenarioId: string;
  templateLabel: string;
  x: number;
  y: number;
  active: boolean;
}

export interface ScenarioPreviewSegment2d {
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

export interface PlanningInputPoint2d {
  stationId: string;
  x: number;
  y: number;
}

export interface PlanningPolygon2d {
  id: string;
  source: 'user' | 'osm';
  kind: 'blocked-area' | 'building' | 'wooded';
  label: string;
  vertices: Array<{ x: number; y: number }>;
  pointsAttr: string;
}

export interface UseMapViewPlanning2dOptions {
  bbox: MapBounds2d;
  draftBlockedPolygon: Array<{ x: number; y: number }>;
  planningMap: PlanningMapState;
  projectPoint: (_x: number, _y: number) => { x: number; y: number };
  result: AdjustmentResult;
  stations: StationMap;
  view2d: View2dState;
  fetchBufferM: number;
}

export interface MapViewPlanning2dState {
  bracePreviewPoints2d: BracePreviewPoint2d[];
  findPlanningPolygonAtSvgPoint: (_svgPoint: { x: number; y: number }) => {
    polygonId: string;
    polygonSource: 'user' | 'osm';
    polygonLabel: string;
  } | null;
  planningFetchExtent: PlanningFetchExtent | null;
  planningGeorefContext: PlanningGeorefContext | null;
  planningInputPoints2d: PlanningInputPoint2d[];
  planningPolygons2d: PlanningPolygon2d[];
  planningExtentPoints: Array<{ stationId: string; x: number; y: number }>;
  scenarioPreviewSegments2d: ScenarioPreviewSegment2d[];
}

const buildObservedStationIds = (result: AdjustmentResult): Set<string> => {
  const ids = new Set<string>();
  result.observations.forEach((observation) => {
    if ('from' in observation && typeof observation.from === 'string') ids.add(observation.from);
    if ('to' in observation && typeof observation.to === 'string') ids.add(observation.to);
    if ('at' in observation && typeof observation.at === 'string') ids.add(observation.at);
  });
  return ids;
};

export const useMapViewPlanning2d = (
  options: UseMapViewPlanning2dOptions,
): MapViewPlanning2dState => {
  const { bbox, draftBlockedPolygon, fetchBufferM, planningMap, projectPoint, result, stations, view2d } =
    options;

  const bracePreviewPoints2d = useMemo(
    () =>
      (result.preanalysisImpactDiagnostics?.scenarioPreviewPoints ?? [])
        .map((point) => {
          const projected = projectPoint(point.x, point.y);
          return {
            stationId: point.stationId,
            scenarioId: point.stationId,
            templateLabel: point.stationId,
            x: projected.x,
            y: projected.y,
            active: point.active,
          };
        })
        .sort(
          (left, right) =>
            Number(right.active) - Number(left.active) ||
            left.stationId.localeCompare(right.stationId, undefined, { numeric: true }),
        ),
    [projectPoint, result.preanalysisImpactDiagnostics?.scenarioPreviewPoints],
  );

  const scenarioPreviewSegments2d = useMemo(
    () =>
      (result.preanalysisImpactDiagnostics?.scenarioPreviewSegments ?? [])
        .map((segment) => {
          const fromStation = stations[segment.fromStationId];
          const toStation =
            stations[segment.toStationId] ??
            result.preanalysisImpactDiagnostics?.scenarioPreviewPoints.find(
              (point) => point.stationId === segment.toStationId,
            );
          if (!fromStation || !toStation) return null;
          const fromProjected = projectPoint(fromStation.x, fromStation.y);
          const toProjected = projectPoint(toStation.x, toStation.y);
          return {
            scenarioId: `${segment.fromStationId}-${segment.toStationId}`,
            fromStationId: segment.fromStationId,
            toStationId: segment.toStationId,
            x1: fromProjected.x,
            y1: fromProjected.y,
            x2: toProjected.x,
            y2: toProjected.y,
            kind: segment.kind,
            active: segment.active,
          };
        })
        .filter((segment): segment is ScenarioPreviewSegment2d => segment != null),
    [
      projectPoint,
      result.preanalysisImpactDiagnostics?.scenarioPreviewPoints,
      result.preanalysisImpactDiagnostics?.scenarioPreviewSegments,
      stations,
    ],
  );

  const planningInputPoints2d = useMemo(
    () =>
      planningMap.showInputPoints
        ? (result.parseState?.inputStationSnapshots ?? [])
            .map((point) => {
              const projected = projectPoint(point.x, point.y);
              return { stationId: point.stationId, x: projected.x, y: projected.y };
            })
            .sort((left, right) =>
              left.stationId.localeCompare(right.stationId, undefined, { numeric: true }),
            )
        : [],
    [planningMap.showInputPoints, projectPoint, result.parseState?.inputStationSnapshots],
  );

  const observedStationIdsForPlanning = useMemo(() => buildObservedStationIds(result), [result]);

  const planningExtentPoints = useMemo(() => {
    const snapshots = result.parseState?.inputStationSnapshots ?? [];
    const filtered =
      observedStationIdsForPlanning.size > 0
        ? snapshots.filter((snapshot) => observedStationIdsForPlanning.has(snapshot.stationId))
        : snapshots;
    const source =
      filtered.length > 0
        ? filtered
        : snapshots.length > 0
          ? snapshots
          : Object.entries(stations).map(([stationId, station]) => ({
              stationId,
              x: station.x,
              y: station.y,
            }));
    return source.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  }, [observedStationIdsForPlanning, result.parseState?.inputStationSnapshots, stations]);

  const planningPolygons2d = useMemo(
    () =>
      [
        ...(planningMap.showObstacleLayer ? planningMap.obstaclePolygons : []),
        ...(planningMap.showBlockedAreas ? planningMap.blockedPolygons : []),
        ...(draftBlockedPolygon.length >= 2
          ? [
              {
                id: 'draft-blocked-polygon',
                source: 'user' as const,
                kind: 'blocked-area' as const,
                label: 'Draft blocked area',
                vertices: draftBlockedPolygon,
              },
            ]
          : []),
      ].map((polygon) => ({
        id: polygon.id,
        source: polygon.source,
        kind: polygon.kind,
        label: polygon.label,
        vertices: polygon.vertices.map((vertex) => projectPoint(vertex.x, vertex.y)),
        pointsAttr: polygon.vertices
          .map((vertex) => {
            const projected = projectPoint(vertex.x, vertex.y);
            return `${projected.x},${projected.y}`;
          })
          .join(' '),
      })),
    [
      draftBlockedPolygon,
      planningMap.blockedPolygons,
      planningMap.obstaclePolygons,
      planningMap.showBlockedAreas,
      planningMap.showObstacleLayer,
      projectPoint,
    ],
  );

  const findPlanningPolygonAtSvgPoint = useCallback(
    (svgPoint: { x: number; y: number }) => {
      const projectedPoint = {
        x: (svgPoint.x - view2d.panX) / Math.max(view2d.zoom, 1e-9),
        y: (svgPoint.y - view2d.panY) / Math.max(view2d.zoom, 1e-9),
      };
      for (let index = planningPolygons2d.length - 1; index >= 0; index -= 1) {
        const polygon = planningPolygons2d[index]!;
        if (polygon.id === 'draft-blocked-polygon' || polygon.vertices.length < 3) continue;
        if (isPointInsidePolygon(projectedPoint, polygon.vertices)) {
          return {
            polygonId: polygon.id,
            polygonSource: polygon.source,
            polygonLabel: polygon.label || polygon.kind,
          };
        }
      }
      return null;
    },
    [planningPolygons2d, view2d.panX, view2d.panY, view2d.zoom],
  );

  const planningGeorefContext = useMemo(() => {
    const parseState = result.parseState;
    if (!parseState) return null;
    const fallbackPoint =
      planningExtentPoints.length > 0
        ? planningExtentPoints[Math.floor(planningExtentPoints.length / 2)]!
        : { x: bbox.minX + bbox.width * 0.5, y: bbox.minY + bbox.height * 0.5 };
    const inverse = inverseENToGeodetic({
      east: fallbackPoint.x,
      north: fallbackPoint.y,
      originLatDeg: parseState.originLatDeg,
      originLonDeg: parseState.originLonDeg,
      model: parseState.crsProjectionModel ?? 'legacy-equirectangular',
      coordSystemMode: parseState.coordSystemMode,
      crsId: parseState.crsId,
    });
    if ('failureReason' in inverse) return null;
    return {
      originLatDeg: parseState.originLatDeg ?? inverse.latDeg,
      originLonDeg: parseState.originLonDeg ?? inverse.lonDeg,
      model: parseState.crsProjectionModel ?? 'legacy-equirectangular',
      coordSystemMode: parseState.coordSystemMode,
      crsId: parseState.crsId,
    };
  }, [bbox.height, bbox.minX, bbox.minY, bbox.width, planningExtentPoints, result.parseState]);

  const planningFetchExtent = useMemo(() => {
    if (planningExtentPoints.length === 0) return null;
    const xs = planningExtentPoints.map((point) => point.x);
    const ys = planningExtentPoints.map((point) => point.y);
    return {
      minX: Math.min(...xs) - fetchBufferM,
      maxX: Math.max(...xs) + fetchBufferM,
      minY: Math.min(...ys) - fetchBufferM,
      maxY: Math.max(...ys) + fetchBufferM,
    };
  }, [fetchBufferM, planningExtentPoints]);

  return {
    bracePreviewPoints2d,
    findPlanningPolygonAtSvgPoint,
    planningFetchExtent,
    planningGeorefContext,
    planningInputPoints2d,
    planningPolygons2d,
    planningExtentPoints,
    scenarioPreviewSegments2d,
  };
};
