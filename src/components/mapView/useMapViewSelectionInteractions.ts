import {
  useCallback,
  useMemo,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { PlanningMapState } from '../../types';
import {
  clamp,
  pointToSegmentDistancePx,
} from './mapView2d';
import type { MapViewHitIndex } from './mapViewHitIndex';
import {
  doesPolygonTouchRect,
  isPolygonInsideRect,
  type PlanningPolygonTarget,
  type ScreenSelectionBox,
  type SelectionBoxMode,
} from './mapViewInteraction';
import type { MapToolPickTarget } from './MapViewToolOverlay';
import { LINE_HIT_RADIUS_PX, POINT_HIT_RADIUS_PX } from './mapViewConstants';

type Point2d = { x: number; y: number };
type View2dState = { zoom: number; panX: number; panY: number };
type PlanningPolygon2d = { id: string; vertices: Point2d[] };
type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  planningPolygon: PlanningPolygonTarget | null;
};

interface UseMapViewSelectionInteractionsArgs {
  applyPickedToolStation: (_stationId: string) => void;
  beginDrag: (_modeName: 'planning-vertex', _clientX: number, _clientY: number) => void;
  clearMapSelection: () => void;
  closeContextMenu: () => void;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  contextMenu: ContextMenuState;
  effectiveMode: '2d' | '3d';
  findPlanningPolygonAtSvgPoint: (_point: Point2d) => PlanningPolygonTarget | null;
  mapHitIndex2d: MapViewHitIndex;
  onSelectObservation?: ((_observationId: number | null) => void) | undefined;
  onSelectStation?: ((_stationId: string | null) => void) | undefined;
  planningMap: PlanningMapState;
  planningPolygons2d: PlanningPolygon2d[];
  planningVertexDragRef: MutableRefObject<{
    polygonId: string;
    polygonSource: 'user' | 'osm';
    vertexIndex: number;
  } | null>;
  removePlanningPolygon: (_polygonId: string, _polygonSource: 'user' | 'osm') => void;
  removeSelectedPlanningPolygons: () => void;
  selectedObservationId?: number | null | undefined;
  selectedPlanningPolygonIds: string[];
  selectedStationId?: string | null | undefined;
  selectionBox: ScreenSelectionBox | null;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState>>;
  setDraftBlockedPolygon: Dispatch<SetStateAction<Point2d[]>>;
  setSelectedPlanningPolygonIds: Dispatch<SetStateAction<string[]>>;
  setSelectionBox: Dispatch<SetStateAction<ScreenSelectionBox | null>>;
  svgToMapCoords: (_screenX: number, _screenY: number) => Point2d;
  toSvgCoords: (_clientX: number, _clientY: number) => Point2d | null;
  toolPickTarget: MapToolPickTarget | null;
  view2d: View2dState;
}

const toSelectionRect = (
  selectionBox: ScreenSelectionBox,
  pointer: Point2d,
): { x: number; y: number; width: number; height: number; mode: SelectionBoxMode } => ({
  x: Math.min(selectionBox.anchorX, pointer.x),
  y: Math.min(selectionBox.anchorY, pointer.y),
  width: Math.abs(pointer.x - selectionBox.anchorX),
  height: Math.abs(pointer.y - selectionBox.anchorY),
  mode: pointer.x >= selectionBox.anchorX ? 'window' : 'crossing',
});

export const useMapViewSelectionInteractions = ({
  applyPickedToolStation,
  beginDrag,
  clearMapSelection,
  closeContextMenu,
  containerRef,
  contextMenu,
  effectiveMode,
  findPlanningPolygonAtSvgPoint,
  mapHitIndex2d,
  onSelectObservation,
  onSelectStation,
  planningMap,
  planningPolygons2d,
  planningVertexDragRef,
  removePlanningPolygon,
  removeSelectedPlanningPolygons,
  selectedObservationId,
  selectedPlanningPolygonIds,
  selectedStationId,
  selectionBox,
  setContextMenu,
  setDraftBlockedPolygon,
  setSelectedPlanningPolygonIds,
  setSelectionBox,
  svgToMapCoords,
  toSvgCoords,
  toolPickTarget,
  view2d,
}: UseMapViewSelectionInteractionsArgs) => {
  const selectionBoxRect = useMemo(() => {
    if (selectionBox == null) return null;
    return toSelectionRect(selectionBox, {
      x: selectionBox.currentX,
      y: selectionBox.currentY,
    });
  }, [selectionBox]);

  const applySelectionBoxToPlanningPolygons = useCallback(
    (rect: { x: number; y: number; width: number; height: number; mode: SelectionBoxMode }) => {
      const bounds = {
        left: rect.x,
        right: rect.x + rect.width,
        top: rect.y,
        bottom: rect.y + rect.height,
      };
      const hits = planningPolygons2d
        .filter((polygon) => polygon.id !== 'draft-blocked-polygon')
        .filter((polygon) => {
          const screenVertices = polygon.vertices.map((vertex) => ({
            x: vertex.x * view2d.zoom + view2d.panX,
            y: vertex.y * view2d.zoom + view2d.panY,
          }));
          return rect.mode === 'window'
            ? isPolygonInsideRect(screenVertices, bounds)
            : doesPolygonTouchRect(screenVertices, bounds);
        })
        .map((polygon) => polygon.id);
      setSelectedPlanningPolygonIds(hits);
      onSelectStation?.(null);
      onSelectObservation?.(null);
      setSelectionBox(null);
    },
    [
      onSelectObservation,
      onSelectStation,
      planningPolygons2d,
      setSelectedPlanningPolygonIds,
      setSelectionBox,
      view2d.panX,
      view2d.panY,
      view2d.zoom,
    ],
  );

  const openContextMenu = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      event.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const pointer = toSvgCoords(event.clientX, event.clientY);
      const polygonHit =
        effectiveMode === '2d' && pointer != null
          ? findPlanningPolygonAtSvgPoint(pointer)
          : null;
      const polygonId = polygonHit?.polygonId ?? null;
      const polygonSource = polygonHit?.polygonSource ?? null;
      const polygonLabel = polygonHit?.polygonLabel ?? 'Planning obstacle';
      const preserveMultiSelection = selectedPlanningPolygonIds.length > 1;
      if (polygonId && !preserveMultiSelection) {
        setSelectedPlanningPolygonIds([polygonId]);
      }
      const showMultiDelete = !polygonId && selectedPlanningPolygonIds.length > 1;
      const effectiveMultiDelete = preserveMultiSelection || showMultiDelete;
      const menuWidth = 240;
      const menuHeight =
        effectiveMultiDelete && !polygonId
          ? 172
          : preserveMultiSelection && polygonId
            ? 172
            : polygonId
              ? 232
              : 126;
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      setContextMenu({
        open: true,
        x: clamp(localX, 8, Math.max(8, rect.width - menuWidth - 8)),
        y: clamp(localY, 8, Math.max(8, rect.height - menuHeight - 8)),
        planningPolygon:
          !preserveMultiSelection &&
          polygonId &&
          (polygonSource === 'user' || polygonSource === 'osm')
            ? { polygonId, polygonSource, polygonLabel }
            : null,
      });
    },
    [
      containerRef,
      effectiveMode,
      findPlanningPolygonAtSvgPoint,
      selectedPlanningPolygonIds.length,
      setContextMenu,
      setSelectedPlanningPolygonIds,
      toSvgCoords,
    ],
  );

  const handleEditPlanningPolygon = useCallback(() => {
    const polygon = contextMenu.planningPolygon;
    if (!polygon) return;
    setSelectedPlanningPolygonIds([polygon.polygonId]);
    setContextMenu((current) => ({ ...current, open: false, planningPolygon: null }));
  }, [contextMenu.planningPolygon, setContextMenu, setSelectedPlanningPolygonIds]);

  const handleDeletePlanningPolygon = useCallback(() => {
    const polygon = contextMenu.planningPolygon;
    if (!polygon) return;
    removePlanningPolygon(polygon.polygonId, polygon.polygonSource);
    closeContextMenu();
  }, [closeContextMenu, contextMenu.planningPolygon, removePlanningPolygon]);

  const handleRemoveSelectedPlanningPolygons = useCallback(() => {
    removeSelectedPlanningPolygons();
    closeContextMenu();
  }, [closeContextMenu, removeSelectedPlanningPolygons]);

  const handlePlanningVertexMouseDown = useCallback(
    (polygonId: string, vertexIndex: number, event: ReactMouseEvent<SVGCircleElement>) => {
      const polygonSource = planningMap.obstaclePolygons.some((polygon) => polygon.id === polygonId)
        ? ('osm' as const)
        : ('user' as const);
      planningVertexDragRef.current = { polygonId, polygonSource, vertexIndex };
      setSelectedPlanningPolygonIds([polygonId]);
      beginDrag('planning-vertex', event.clientX, event.clientY);
      event.preventDefault();
      event.stopPropagation();
    },
    [beginDrag, planningMap.obstaclePolygons, planningVertexDragRef, setSelectedPlanningPolygonIds],
  );

  const handleSvgClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (effectiveMode === '3d') {
        const target = event.target as HTMLElement | null;
        const stationId = target?.getAttribute('data-map-station');
        if (toolPickTarget != null && stationId) {
          applyPickedToolStation(stationId);
          return;
        }
        if (!target?.closest('[data-map-observation],[data-map-station]')) {
          clearMapSelection();
        }
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-map-observation],[data-map-station]')) return;
      const pointer = toSvgCoords(event.clientX, event.clientY);
      if (!pointer) return;
      const pointCandidates = mapHitIndex2d.pointCandidates(
        pointer.x,
        pointer.y,
        POINT_HIT_RADIUS_PX,
      );
      let nearestPointId: string | null = null;
      let nearestPointDistance = Number.POSITIVE_INFINITY;
      pointCandidates.forEach((point) => {
        const distance = Math.hypot(pointer.x - point.screenX, pointer.y - point.screenY);
        if (distance <= POINT_HIT_RADIUS_PX && distance < nearestPointDistance) {
          nearestPointDistance = distance;
          nearestPointId = point.id;
        }
      });
      if (toolPickTarget != null) {
        if (nearestPointId) applyPickedToolStation(nearestPointId);
        return;
      }
      if (planningMap.blockEditMode) {
        setDraftBlockedPolygon((current) => [...current, svgToMapCoords(pointer.x, pointer.y)]);
        return;
      }
      if (selectionBox != null) {
        applySelectionBoxToPlanningPolygons(toSelectionRect(selectionBox, pointer));
        return;
      }
      if (nearestPointId) {
        setSelectedPlanningPolygonIds([]);
        onSelectStation?.(nearestPointId);
        return;
      }
      const lineCandidates = mapHitIndex2d.lineCandidates(
        pointer.x,
        pointer.y,
        LINE_HIT_RADIUS_PX,
      );
      let nearestLineObservationId: number | null = null;
      let nearestLineDistance = Number.POSITIVE_INFINITY;
      lineCandidates.forEach((line) => {
        const distance = pointToSegmentDistancePx(
          pointer.x,
          pointer.y,
          line.screenX1,
          line.screenY1,
          line.screenX2,
          line.screenY2,
        );
        if (distance <= LINE_HIT_RADIUS_PX && distance < nearestLineDistance) {
          nearestLineDistance = distance;
          nearestLineObservationId = line.observationId;
        }
      });
      if (nearestLineObservationId != null) {
        setSelectedPlanningPolygonIds([]);
        onSelectObservation?.(nearestLineObservationId);
        return;
      }
      const polygonHit = findPlanningPolygonAtSvgPoint(pointer);
      if (polygonHit != null) {
        setSelectedPlanningPolygonIds([polygonHit.polygonId]);
        onSelectStation?.(null);
        onSelectObservation?.(null);
        setSelectionBox(null);
        return;
      }
      if (
        selectedStationId != null ||
        selectedObservationId != null ||
        selectedPlanningPolygonIds.length > 0
      ) {
        clearMapSelection();
        return;
      }
      setSelectionBox({
        anchorX: pointer.x,
        anchorY: pointer.y,
        currentX: pointer.x,
        currentY: pointer.y,
      });
    },
    [
      applyPickedToolStation,
      applySelectionBoxToPlanningPolygons,
      clearMapSelection,
      effectiveMode,
      findPlanningPolygonAtSvgPoint,
      mapHitIndex2d,
      onSelectObservation,
      onSelectStation,
      planningMap.blockEditMode,
      selectedObservationId,
      selectedPlanningPolygonIds.length,
      selectedStationId,
      selectionBox,
      setDraftBlockedPolygon,
      setSelectedPlanningPolygonIds,
      setSelectionBox,
      svgToMapCoords,
      toSvgCoords,
      toolPickTarget,
    ],
  );

  return {
    handleDeletePlanningPolygon,
    handleEditPlanningPolygon,
    handlePlanningVertexMouseDown,
    handleRemoveSelectedPlanningPolygons,
    handleSvgClick,
    openContextMenu,
    selectionBoxRect,
  };
};
