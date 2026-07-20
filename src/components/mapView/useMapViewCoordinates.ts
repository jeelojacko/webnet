import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  buildProjection2d,
  projectPoint2d,
  type MapBounds2d,
  type View2dState,
} from './mapView2d';
import type { PlanningPolygonTarget, ScreenSelectionBox } from './mapViewInteraction';
import type { MapToolPickTarget } from './MapViewToolOverlay';
import { VIEW_H, VIEW_W } from './mapViewConstants';

type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  planningPolygon: PlanningPolygonTarget | null;
};

interface UseMapViewCoordinatesArgs {
  bbox: MapBounds2d;
  clearToolPickTarget: () => void;
  onSelectObservation?: ((_observationId: number | null) => void) | undefined;
  onSelectStation?: ((_stationId: string | null) => void) | undefined;
  planningVertexDragRef: MutableRefObject<{
    polygonId: string;
    polygonSource: 'user' | 'osm';
    vertexIndex: number;
  } | null>;
  selectedObservationId?: number | null | undefined;
  selectedPlanningPolygonIds: string[];
  selectedStationId?: string | null | undefined;
  selectionBox: ScreenSelectionBox | null;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState>>;
  setSelectedPlanningPolygonIds: Dispatch<SetStateAction<string[]>>;
  setSelectionBox: Dispatch<SetStateAction<ScreenSelectionBox | null>>;
  svgRef: MutableRefObject<SVGSVGElement | null>;
  toolPickTarget: MapToolPickTarget | null;
  view2d: View2dState;
}

export const useMapViewCoordinates = ({
  bbox,
  clearToolPickTarget,
  onSelectObservation,
  onSelectStation,
  planningVertexDragRef,
  selectedObservationId,
  selectedPlanningPolygonIds,
  selectedStationId,
  selectionBox,
  setContextMenu,
  setSelectedPlanningPolygonIds,
  setSelectionBox,
  svgRef,
  toolPickTarget,
  view2d,
}: UseMapViewCoordinatesArgs) => {
  const projection2d = useMemo(() => buildProjection2d(bbox, VIEW_W, VIEW_H), [bbox]);

  const project2d = useCallback(
    (x: number, y: number) => projectPoint2d(x, y, bbox, projection2d, VIEW_H),
    [bbox, projection2d],
  );

  const toSvgCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((clientY - rect.top) / rect.height) * VIEW_H;
    return { x, y };
  }, [svgRef]);

  const svgToMapCoords = useCallback(
    (screenX: number, screenY: number): { x: number; y: number } => {
      const projectedX = (screenX - view2d.panX) / Math.max(view2d.zoom, 1e-9);
      const projectedY = (screenY - view2d.panY) / Math.max(view2d.zoom, 1e-9);
      const x = bbox.minX + (projectedX - projection2d.offsetX) / Math.max(projection2d.scale, 1e-9);
      const y = bbox.minY + (VIEW_H - projectedY - projection2d.offsetY) / Math.max(projection2d.scale, 1e-9);
      return { x, y };
    },
    [
      bbox.minX,
      bbox.minY,
      projection2d.offsetX,
      projection2d.offsetY,
      projection2d.scale,
      view2d.panX,
      view2d.panY,
      view2d.zoom,
    ],
  );

  const clearMapSelection = useCallback(() => {
    onSelectStation?.(null);
    onSelectObservation?.(null);
    setSelectedPlanningPolygonIds([]);
    setSelectionBox(null);
    planningVertexDragRef.current = null;
  }, [
    onSelectObservation,
    onSelectStation,
    planningVertexDragRef,
    setSelectedPlanningPolygonIds,
    setSelectionBox,
  ]);

  const clearMapSelectionBox = useCallback(() => {
    setSelectionBox(null);
  }, [setSelectionBox]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setContextMenu((prev) => ({ ...prev, open: false, planningPolygon: null }));
      if (toolPickTarget != null) {
        clearToolPickTarget();
        return;
      }
      if (selectionBox != null) {
        clearMapSelectionBox();
        return;
      }
      if (
        selectedStationId != null ||
        selectedObservationId != null ||
        selectedPlanningPolygonIds.length > 0
      ) {
        clearMapSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    clearMapSelection,
    clearMapSelectionBox,
    clearToolPickTarget,
    selectedObservationId,
    selectedPlanningPolygonIds.length,
    selectedStationId,
    selectionBox,
    setContextMenu,
    toolPickTarget,
  ]);

  return {
    clearMapSelection,
    project2d,
    projection2d,
    svgToMapCoords,
    toSvgCoords,
  };
};
