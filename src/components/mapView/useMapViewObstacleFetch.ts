import { useEffect, type MutableRefObject } from 'react';
import type { PlanningMapState } from '../../types';
import {
  buildObstacleFetchSignature,
  buildOverpassObstacleQuery,
  parseOverpassObstaclePolygons,
} from './mapViewObstacles';

interface UseMapViewObstacleFetchArgs {
  effectiveMode: '2d' | '3d';
  obstacleFetchSignatureRef: MutableRefObject<string>;
  onPlanningMapChange?: (_value: PlanningMapState) => void;
  planningFetchExtent: Parameters<typeof buildObstacleFetchSignature>[1] | null;
  planningGeorefContext: Parameters<typeof buildObstacleFetchSignature>[0] | null;
  planningMap: PlanningMapState;
}

export const useMapViewObstacleFetch = ({
  effectiveMode,
  obstacleFetchSignatureRef,
  onPlanningMapChange,
  planningFetchExtent,
  planningGeorefContext,
  planningMap,
}: UseMapViewObstacleFetchArgs) => {
  useEffect(() => {
    if (
      effectiveMode !== '2d' ||
      !planningGeorefContext ||
      !planningFetchExtent ||
      !planningMap.showObstacleLayer ||
      !onPlanningMapChange
    ) {
      return;
    }
    const fetchSignature = buildObstacleFetchSignature(
      planningGeorefContext,
      planningFetchExtent,
    );
    if (obstacleFetchSignatureRef.current === fetchSignature) return;
    obstacleFetchSignatureRef.current = fetchSignature;
    const query = buildOverpassObstacleQuery(planningGeorefContext, planningFetchExtent);
    if (query == null) return;
    const controller = new AbortController();
    void fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((json) => {
        if (!json || !Array.isArray(json.elements)) return;
        const polygons = parseOverpassObstaclePolygons(json.elements, planningGeorefContext);
        if (polygons.length === 0) return;
        onPlanningMapChange({
          ...planningMap,
          obstaclePolygons: polygons,
        });
      })
      .catch(() => {
        if (obstacleFetchSignatureRef.current === fetchSignature) {
          obstacleFetchSignatureRef.current = '';
        }
      });
    return () => controller.abort();
  }, [
    effectiveMode,
    obstacleFetchSignatureRef,
    onPlanningMapChange,
    planningFetchExtent,
    planningGeorefContext,
    planningMap,
  ]);
};
