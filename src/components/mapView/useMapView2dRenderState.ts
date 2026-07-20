import { useLayoutEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { AdjustmentResult, PlanningMapState, Station } from '../../types';
import type { DerivedQaResult } from '../../engine/qaWorkflow';
import type { MapViewTileStore } from './mapViewTileStore';
import type { MapViewWebgl2d } from './mapViewWebgl2d';
import { buildObservationMapLinks, buildMapLinkByPairKey, resolveSelectedObservationPairKey } from '../../engine/resultDerivedModels';
import { buildMapViewHitIndex } from './mapViewHitIndex';
import { buildMapViewWebglScene2d } from './mapViewWebglBuffers';
import {
  measureMapViewPerf,
  noteMapViewPerfCounter,
  noteMapViewPerfMetadata,
} from './mapViewPerf';
import { buildMapViewStyle2d } from './mapViewSelectors';
import type { MapInteractionPhase } from './mapViewInteraction';
import { OSM_FETCH_BUFFER_M } from './mapViewInteraction';
import { useMapViewBasemapTiles2d } from './useMapViewBasemapTiles2d';
import { useMapViewDerived2d } from './useMapViewDerived2d';
import { useFrozenMapViewOverlays } from './useFrozenMapViewOverlays';
import { useMapViewObstacleFetch } from './useMapViewObstacleFetch';
import { useMapViewPlanning2d } from './useMapViewPlanning2d';
import {
  DENSE_LABEL_EDGE_THRESHOLD,
  DENSE_LABEL_POINT_THRESHOLD,
  EMPTY_MAP_LINKS,
  INTERACTION_DENSE_LINE_THRESHOLD,
  INTERACTION_DENSE_POINT_THRESHOLD,
  LABEL_GRID_PX,
  OSM_FULL_LABEL_POINT_THRESHOLD,
  OSM_IDLE_PREFETCH_TILE_BUFFER,
  OSM_IDLE_PREFETCH_TILE_COUNT_THRESHOLD,
  OSM_INTERACTION_TILE_BUFFER,
  OSM_VISIBLE_TILE_BUFFER,
  POINT_HIT_RADIUS_PX,
  VIEWPORT_CLIP_MARGIN_PX,
  VIEW_H,
  VIEW_W,
} from './mapViewConstants';
import type { useMapViewLayerRenderer } from './useMapViewLayerRenderer';
import type { MapBounds2d, ProjectablePoint2D } from './mapView2d';

type View2dState = { zoom: number; panX: number; panY: number };

interface UseMapView2dRenderStateArgs {
  bbox: MapBounds2d;
  basemapDescriptorView2d: View2dState;
  derivedResult: DerivedQaResult | null;
  derivedView2d: View2dState;
  dragRef: MutableRefObject<{ active: boolean; mode: string; lastX: number; lastY: number }>;
  draftBlockedPolygon: Array<{ x: number; y: number }>;
  effectiveMode: '2d' | '3d';
  ellipseStroke: (_stationId: string) => string;
  focusSelection: boolean;
  hideMinorGeometry: boolean;
  idlePrefetchReady: boolean;
  interactionPhase: MapInteractionPhase;
  layerRenderer: ReturnType<typeof useMapViewLayerRenderer>;
  obstacleFetchSignatureRef: MutableRefObject<string>;
  observations: Parameters<typeof buildObservationMapLinks>[0];
  onPlanningMapChange?: (_value: PlanningMapState) => void;
  planningMap: PlanningMapState;
  points: ProjectablePoint2D[];
  project2d: (_x: number, _y: number) => { x: number; y: number };
  projection2d: Parameters<typeof useMapViewBasemapTiles2d>[0]['projection2d'];
  renderer2d: 'canvas' | 'webgl';
  result: AdjustmentResult;
  scheduleLayerRender: ReturnType<typeof useMapViewLayerRenderer>['scheduleLayerRender'];
  selectedObservationId: number | null;
  selectedPlanningPolygonIds: string[];
  selectedStationId: string | null;
  setBasemapDescriptorView2d: Dispatch<SetStateAction<View2dState>>;
  showLabels: boolean;
  showLostStations: boolean;
  stationFill: (_stationId: string, _fixed: boolean) => string;
  stationSeverity: (_stationId: string) => 'watch' | 'weak' | null;
  stations: Record<string, Station>;
  tileStoreRef: MutableRefObject<MapViewTileStore>;
  transformedOverlayActive: boolean;
  units: 'm' | 'ft';
  view2d: View2dState;
}

export const useMapView2dRenderState = ({
  bbox,
  basemapDescriptorView2d,
  derivedResult,
  derivedView2d,
  dragRef,
  draftBlockedPolygon,
  effectiveMode,
  ellipseStroke,
  focusSelection,
  hideMinorGeometry,
  idlePrefetchReady,
  interactionPhase,
  layerRenderer,
  obstacleFetchSignatureRef,
  observations,
  onPlanningMapChange,
  planningMap,
  points,
  project2d,
  projection2d,
  renderer2d,
  result,
  scheduleLayerRender,
  selectedObservationId,
  selectedPlanningPolygonIds,
  selectedStationId,
  setBasemapDescriptorView2d,
  showLabels,
  showLostStations,
  stationFill,
  stationSeverity,
  stations,
  tileStoreRef,
  transformedOverlayActive,
  units,
  view2d,
}: UseMapView2dRenderStateArgs) => {
  const {
    latestBasemapRenderInputRef,
    latestGeometryRenderInputRef,
    latestPlanningRenderInputRef,
    latestWebglRenderInputRef,
    renderLayersNow,
  } = layerRenderer;
  const style2d = useMemo(
    () => buildMapViewStyle2d({ zoom: view2d.zoom }, transformedOverlayActive),
    [transformedOverlayActive, view2d.zoom],
  );
  const planning2d = useMapViewPlanning2d({
    bbox,
    draftBlockedPolygon,
    fetchBufferM: OSM_FETCH_BUFFER_M,
    planningMap,
    projectPoint: project2d,
    result,
    stations,
    view2d,
  });
  useMapViewBasemapTiles2d({
    basemapDescriptorView2d,
    bbox,
    dragRef,
    effectiveMode,
    idlePrefetchReady,
    idlePrefetchTileBuffer: OSM_IDLE_PREFETCH_TILE_BUFFER,
    idlePrefetchTileCountThreshold: OSM_IDLE_PREFETCH_TILE_COUNT_THRESHOLD,
    interactionPhase,
    interactionTileBuffer: OSM_INTERACTION_TILE_BUFFER,
    latestBasemapRenderInputRef,
    latestWebglRenderInputRef,
    planningBasemapMode: planningMap.basemapMode,
    planningGeorefContext: planning2d.planningGeorefContext,
    projectPoint: project2d,
    projection2d,
    renderLayersNow,
    renderer2d,
    scheduleLayerRender,
    setBasemapDescriptorView2d,
    tileStoreRef,
    view2d,
    viewHeight: VIEW_H,
    viewWidth: VIEW_W,
    visibleTileBuffer: OSM_VISIBLE_TILE_BUFFER,
  });
  useMapViewObstacleFetch({
    effectiveMode,
    obstacleFetchSignatureRef,
    onPlanningMapChange,
    planningFetchExtent: planning2d.planningFetchExtent,
    planningGeorefContext: planning2d.planningGeorefContext,
    planningMap,
  });
  const fallbackMapLinks = useMemo(
    () => (derivedResult ? EMPTY_MAP_LINKS : buildObservationMapLinks(observations)),
    [derivedResult, observations],
  );
  const mapLinks = derivedResult?.mapLinks ?? fallbackMapLinks;
  const mapLinkByPairKey = useMemo(() => buildMapLinkByPairKey(mapLinks), [mapLinks]);
  const selectedObservationPairKey = useMemo(
    () => resolveSelectedObservationPairKey(derivedResult?.observationById, selectedObservationId),
    [derivedResult?.observationById, selectedObservationId],
  );
  const derived2d = useMapViewDerived2d({
    denseLabelEdgeThreshold: DENSE_LABEL_EDGE_THRESHOLD,
    denseLabelPointThreshold: DENSE_LABEL_POINT_THRESHOLD,
    derivedView2d,
    effectiveMode,
    focusSelection,
    hideMinorGeometry,
    interactionDenseLineThreshold: INTERACTION_DENSE_LINE_THRESHOLD,
    interactionDensePointThreshold: INTERACTION_DENSE_POINT_THRESHOLD,
    interactionPhase,
    labelGridPx: LABEL_GRID_PX,
    mapLinks,
    osmFullLabelPointThreshold: OSM_FULL_LABEL_POINT_THRESHOLD,
    planningBasemapMode: planningMap.basemapMode,
    pointHitRadiusPx: POINT_HIT_RADIUS_PX,
    points,
    projectPoint: project2d,
    selectedObservationId,
    selectedObservationPairKey,
    selectedStationId,
    showLabels,
    showLostStations,
    stationSeverity,
    stations,
    viewportClipMarginPx: VIEWPORT_CLIP_MARGIN_PX,
    viewHeight: VIEW_H,
    viewWidth: VIEW_W,
  });
  const frozen2d = useFrozenMapViewOverlays({
    bracePreviewPoints2d: planning2d.bracePreviewPoints2d,
    effectiveMode,
    interactionPhase,
    planningInputPoints2d: planning2d.planningInputPoints2d,
    planningPolygons2d: planning2d.planningPolygons2d,
    scenarioPreviewSegments2d: planning2d.scenarioPreviewSegments2d,
    visiblePointLabels2d: derived2d.effectiveVisiblePointLabels2d,
  });
  const webglScene2d = useMemo(
    () =>
      measureMapViewPerf('map:build-webgl-scene', () => {
        noteMapViewPerfCounter('map:webgl-scene-rebuilds');
        return buildMapViewWebglScene2d({
          originalGeometryOpacity: style2d.originalGeometryOpacity,
          lineWidth2d: style2d.lineWidth2d,
          pointRadius2d: style2d.pointRadius2d,
          ellipseStroke2d: style2d.ellipseStroke2d,
          viewZoom: view2d.zoom,
          projectionScale: projection2d.scale,
          units,
          interactionDenseMode: derived2d.interactionDenseMode,
          unselectedCanvasLines2d: derived2d.unselectedCanvasLines2d,
          filteredVisiblePoints2d: derived2d.filteredVisiblePoints2d,
          ellipseStroke,
          stationFill,
          bracePreviewPoints2d: planning2d.bracePreviewPoints2d,
          scenarioPreviewSegments2d: planning2d.scenarioPreviewSegments2d,
        });
      }),
    [
      derived2d,
      ellipseStroke,
      planning2d.bracePreviewPoints2d,
      planning2d.scenarioPreviewSegments2d,
      projection2d.scale,
      stationFill,
      style2d,
      units,
      view2d.zoom,
    ],
  );
  const mapHitIndex2d = useMemo(
    () =>
      buildMapViewHitIndex({
        points: derived2d.filteredVisiblePoints2d,
        lines: derived2d.filteredVisibleMapLines2d,
      }),
    [derived2d.filteredVisibleMapLines2d, derived2d.filteredVisiblePoints2d],
  );

  useLayoutEffect(() => {
    if (effectiveMode !== '2d') return;
    noteMapViewPerfMetadata('map:renderer2d', renderer2d);
    noteMapViewPerfMetadata('map:show-labels', showLabels);
    noteMapViewPerfMetadata('map:show-input-points', planningMap.showInputPoints);
    noteMapViewPerfMetadata('map:show-obstacles', planningMap.showObstacleLayer);
    noteMapViewPerfMetadata('map:show-blocked-areas', planningMap.showBlockedAreas);
    noteMapViewPerfMetadata('map:basemap-mode', planningMap.basemapMode);
    noteMapViewPerfMetadata('map:visible-point-count', derived2d.filteredVisiblePoints2d.length);
    noteMapViewPerfMetadata('map:visible-line-count', derived2d.filteredVisibleMapLines2d.length);
    noteMapViewPerfMetadata('map:planning-input-point-count', planning2d.planningInputPoints2d.length);
    noteMapViewPerfMetadata('map:planning-polygon-count', planning2d.planningPolygons2d.length);
    noteMapViewPerfMetadata('map:interaction-phase', interactionPhase);
  }, [derived2d, effectiveMode, interactionPhase, planning2d, planningMap, renderer2d, showLabels]);

  useLayoutEffect(() => {
    if (effectiveMode !== '2d') return;
    latestGeometryRenderInputRef.current = {
      interactionPhase,
      view2d,
      originalGeometryOpacity: style2d.originalGeometryOpacity,
      lineWidth2d: style2d.lineWidth2d,
      pointRadius2d: style2d.pointRadius2d,
      ellipseStroke2d: style2d.ellipseStroke2d,
      projectionScale: projection2d.scale,
      units,
      interactionDenseMode: derived2d.interactionDenseMode,
      unselectedCanvasLines2d: derived2d.unselectedCanvasLines2d,
      filteredVisiblePoints2d: derived2d.filteredVisiblePoints2d,
      ellipseStroke,
      stationFill,
    };
    latestWebglRenderInputRef.current = {
      interactionPhase,
      viewWidth: VIEW_W,
      viewHeight: VIEW_H,
      view2d,
      tiles: latestBasemapRenderInputRef.current?.tiles ?? [],
      ...webglScene2d,
    };
    renderLayersNow({ geometry: true });
  }, [
    derived2d,
    effectiveMode,
    ellipseStroke,
    interactionPhase,
    latestBasemapRenderInputRef,
    latestGeometryRenderInputRef,
    latestWebglRenderInputRef,
    projection2d.scale,
    renderLayersNow,
    stationFill,
    style2d,
    units,
    view2d,
    webglScene2d,
  ]);

  useLayoutEffect(() => {
    if (effectiveMode !== '2d') return;
    latestPlanningRenderInputRef.current = {
      interactionPhase,
      view2d,
      pointRadius2d: style2d.pointRadius2d,
      planningInputPoints2d: planning2d.planningInputPoints2d,
      planningPolygons2d: planning2d.planningPolygons2d.map((polygon) => ({
        id: polygon.id,
        source: polygon.source,
        kind: polygon.kind,
        label: polygon.label,
        vertices: polygon.vertices,
      })),
      selectedPlanningPolygonIds,
    };
    renderLayersNow({ planning: true });
  }, [
    effectiveMode,
    interactionPhase,
    latestPlanningRenderInputRef,
    planning2d.planningInputPoints2d,
    planning2d.planningPolygons2d,
    selectedPlanningPolygonIds,
    renderLayersNow,
    style2d.pointRadius2d,
    view2d,
  ]);

  useLayoutEffect(() => {
    if (effectiveMode !== '2d') return;
    renderLayersNow({ basemap: true, geometry: true, planning: true });
  }, [effectiveMode, renderLayersNow, renderer2d]);

  return {
    ...style2d,
    ...planning2d,
    ...derived2d,
    ...frozen2d,
    mapHitIndex2d,
    mapLinkByPairKey,
    selectedObservationPairKey,
  };
};
