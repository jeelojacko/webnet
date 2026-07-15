import { useCallback, useEffect, useRef, useState } from 'react';

import { createStableRuntimeId } from '../../engine/id';
import type { PlanningMapState } from '../../types';

export interface PlanningVertexDragState {
  polygonId: string;
  polygonSource: 'user' | 'osm';
  vertexIndex: number;
}

export interface UseMapViewPlanningActionsOptions {
  onPlanningMapChange?: (_value: PlanningMapState) => void;
  planningMap: PlanningMapState;
}

export const useMapViewPlanningActions = (options: UseMapViewPlanningActionsOptions) => {
  const { onPlanningMapChange, planningMap } = options;
  const [draftBlockedPolygon, setDraftBlockedPolygon] = useState<Array<{ x: number; y: number }>>(
    [],
  );
  const [selectedPlanningPolygonIds, setSelectedPlanningPolygonIds] = useState<string[]>([]);
  const planningVertexDragRef = useRef<PlanningVertexDragState | null>(null);
  const selectedPlanningPolygonId =
    selectedPlanningPolygonIds.length === 1 ? selectedPlanningPolygonIds[0] ?? null : null;

  const updatePlanningPolygonVertices = useCallback(
    (polygonId: string, polygonSource: 'user' | 'osm', vertices: Array<{ x: number; y: number }>) => {
      if (!onPlanningMapChange) return;
      const update = (polygons: PlanningMapState['blockedPolygons']) =>
        polygons.map((polygon) =>
          polygon.id === polygonId
            ? { ...polygon, vertices: vertices.map((vertex) => ({ ...vertex })) }
            : polygon,
        );
      onPlanningMapChange({
        ...planningMap,
        blockedPolygons:
          polygonSource === 'user' ? update(planningMap.blockedPolygons) : planningMap.blockedPolygons,
        obstaclePolygons:
          polygonSource === 'osm' ? update(planningMap.obstaclePolygons) : planningMap.obstaclePolygons,
      });
    },
    [onPlanningMapChange, planningMap],
  );

  const removePlanningPolygon = useCallback(
    (polygonId: string, polygonSource: 'user' | 'osm') => {
      if (!onPlanningMapChange) return;
      onPlanningMapChange({
        ...planningMap,
        blockedPolygons:
          polygonSource === 'user'
            ? planningMap.blockedPolygons.filter((polygon) => polygon.id !== polygonId)
            : planningMap.blockedPolygons,
        obstaclePolygons:
          polygonSource === 'osm'
            ? planningMap.obstaclePolygons.filter((polygon) => polygon.id !== polygonId)
            : planningMap.obstaclePolygons,
      });
      setSelectedPlanningPolygonIds((current) => current.filter((id) => id !== polygonId));
    },
    [onPlanningMapChange, planningMap],
  );

  const removeSelectedPlanningPolygons = useCallback(() => {
    if (!onPlanningMapChange || selectedPlanningPolygonIds.length === 0) return;
    const selectedIds = new Set(selectedPlanningPolygonIds);
    onPlanningMapChange({
      ...planningMap,
      blockedPolygons: planningMap.blockedPolygons.filter((polygon) => !selectedIds.has(polygon.id)),
      obstaclePolygons: planningMap.obstaclePolygons.filter((polygon) => !selectedIds.has(polygon.id)),
    });
    setSelectedPlanningPolygonIds([]);
  }, [onPlanningMapChange, planningMap, selectedPlanningPolygonIds]);

  const commitDraftBlockedPolygon = useCallback(() => {
    if (!onPlanningMapChange || draftBlockedPolygon.length < 3) return;
    onPlanningMapChange({
      ...planningMap,
      blockedPolygons: [
        ...planningMap.blockedPolygons,
        {
          id: createStableRuntimeId('block'),
          source: 'user',
          kind: 'blocked-area',
          label: `Blocked area ${planningMap.blockedPolygons.length + 1}`,
          vertices: draftBlockedPolygon.map((vertex) => ({ ...vertex })),
        },
      ],
      blockEditMode: false,
    });
    setDraftBlockedPolygon([]);
  }, [draftBlockedPolygon, onPlanningMapChange, planningMap]);

  const clearDraftBlockedPolygon = useCallback(() => {
    setDraftBlockedPolygon([]);
  }, []);

  useEffect(() => {
    if (selectedPlanningPolygonIds.length === 0) return;
    const availableIds = new Set([
      ...planningMap.blockedPolygons.map((polygon) => polygon.id),
      ...planningMap.obstaclePolygons.map((polygon) => polygon.id),
    ]);
    setSelectedPlanningPolygonIds((current) => current.filter((id) => availableIds.has(id)));
    if (selectedPlanningPolygonId != null && !availableIds.has(selectedPlanningPolygonId)) {
      planningVertexDragRef.current = null;
    }
  }, [
    planningMap.blockedPolygons,
    planningMap.obstaclePolygons,
    selectedPlanningPolygonId,
    selectedPlanningPolygonIds.length,
  ]);

  return {
    clearDraftBlockedPolygon,
    commitDraftBlockedPolygon,
    draftBlockedPolygon,
    planningVertexDragRef,
    removePlanningPolygon,
    removeSelectedPlanningPolygons,
    selectedPlanningPolygonId,
    selectedPlanningPolygonIds,
    setDraftBlockedPolygon,
    setSelectedPlanningPolygonIds,
    updatePlanningPolygonVertices,
  };
};
