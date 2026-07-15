import { useMemo } from 'react';

import { scoreMapStationPriority, type ObservationMapLink } from '../../engine/resultDerivedModels';
import type { StationMap } from '../../types';
import {
  buildBaseProjectedMapLines2d,
  buildBaseProjectedPoints2d,
  buildConnectedStationIds2d,
  buildFilteredVisibleMapLines2d,
  buildFilteredVisiblePoints2d,
  buildMapDensitySummary,
  buildProjectedMapLines2d,
  buildProjectedPoints2d,
  buildProjectedViewportBounds,
  buildUnselectedCanvasLines2d,
  buildVisibleBaseProjectedMapLines2d,
  buildVisibleBaseProjectedPoints2d,
  buildVisiblePointLabels2d,
  buildViewportBounds,
  type MapDensitySummary,
  type ProjectablePoint2D,
  type ProjectedMapLine2D,
  type ProjectedPoint2D,
  type View2dState,
  type ViewportBounds,
} from './mapView2d';
import { measureMapViewPerf } from './mapViewPerf';

export interface UseMapViewDerived2dOptions {
  denseLabelEdgeThreshold: number;
  denseLabelPointThreshold: number;
  derivedView2d: View2dState;
  effectiveMode: '2d' | '3d';
  focusSelection: boolean;
  hideMinorGeometry: boolean;
  interactionDenseLineThreshold: number;
  interactionDensePointThreshold: number;
  interactionPhase: 'idle' | 'interacting' | 'settling';
  labelGridPx: number;
  mapLinks: ObservationMapLink[];
  osmFullLabelPointThreshold: number;
  planningBasemapMode: 'none' | 'osm';
  pointHitRadiusPx: number;
  points: ProjectablePoint2D[];
  projectPoint: (_x: number, _y: number) => { x: number; y: number };
  selectedObservationId: number | null;
  selectedObservationPairKey: string | null;
  selectedStationId: string | null;
  showLabels: boolean;
  showLostStations: boolean;
  stationSeverity: (_stationId: string) => 'watch' | 'weak' | null;
  stations: StationMap;
  viewportClipMarginPx: number;
  viewHeight: number;
  viewWidth: number;
}

export interface MapViewDerived2dState {
  effectiveVisiblePointLabels2d: Set<string>;
  filteredVisibleMapLines2d: ProjectedMapLine2D[];
  filteredVisiblePoints2d: ProjectedPoint2D[];
  interactionDenseMode: boolean;
  mapDensitySummary: MapDensitySummary;
  unselectedCanvasLines2d: ProjectedMapLine2D[];
}

export const useMapViewDerived2d = (options: UseMapViewDerived2dOptions): MapViewDerived2dState => {
  const {
    denseLabelEdgeThreshold,
    denseLabelPointThreshold,
    derivedView2d,
    effectiveMode,
    focusSelection,
    hideMinorGeometry,
    interactionDenseLineThreshold,
    interactionDensePointThreshold,
    interactionPhase,
    labelGridPx,
    mapLinks,
    osmFullLabelPointThreshold,
    planningBasemapMode,
    pointHitRadiusPx,
    points,
    projectPoint,
    selectedObservationId,
    selectedObservationPairKey,
    selectedStationId,
    showLabels,
    showLostStations,
    stationSeverity,
    stations,
    viewportClipMarginPx,
    viewHeight,
    viewWidth,
  } = options;

  const viewportBounds2d = useMemo<ViewportBounds>(
    () => buildViewportBounds(viewWidth, viewHeight, viewportClipMarginPx),
    [viewHeight, viewWidth, viewportClipMarginPx],
  );

  const baseProjectedMapLines2d = useMemo(
    () =>
      measureMapViewPerf('map:build-base-lines', () =>
        buildBaseProjectedMapLines2d({
          mapLinks: mapLinks,
          stations: stations,
          showLostStations: showLostStations,
          projectPoint: projectPoint,
        }),
      ),
    [mapLinks, projectPoint, showLostStations, stations],
  );

  const baseProjectedPoints2d = useMemo(
    () =>
      measureMapViewPerf('map:build-base-points', () =>
        buildBaseProjectedPoints2d({
          points: points,
          projectPoint: projectPoint,
        }),
      ),
    [points, projectPoint],
  );

  const projectedViewportBounds2d = useMemo(
    () => buildProjectedViewportBounds(viewportBounds2d, derivedView2d),
    [derivedView2d, viewportBounds2d],
  );

  const visibleBaseProjectedMapLines2d = useMemo(
    () =>
      measureMapViewPerf('map:cull-base-lines', () =>
        buildVisibleBaseProjectedMapLines2d({
          baseProjectedMapLines2d,
          selectedObservationId: selectedObservationId,
          selectedObservationPairKey: selectedObservationPairKey,
          projectedViewportBounds: projectedViewportBounds2d,
        }),
      ),
    [
      baseProjectedMapLines2d,
      selectedObservationId,
      selectedObservationPairKey,
      projectedViewportBounds2d,
    ],
  );

  const visibleBaseProjectedPoints2d = useMemo(
    () =>
      measureMapViewPerf('map:cull-base-points', () =>
        buildVisibleBaseProjectedPoints2d({
          baseProjectedPoints2d,
          selectedStationId: selectedStationId,
          projectedViewportBounds: projectedViewportBounds2d,
          selectionMarginProjected:
            pointHitRadiusPx / Math.max(derivedView2d.zoom, 1e-9),
        }),
      ),
    [
      baseProjectedPoints2d,
      derivedView2d.zoom,
      pointHitRadiusPx,
      selectedStationId,
      projectedViewportBounds2d,
    ],
  );

  const filteredVisibleBaseProjectedMapLines2d = useMemo(
    () =>
      measureMapViewPerf('map:filter-base-lines', () =>
        buildFilteredVisibleMapLines2d({
          visibleMapLines2d: visibleBaseProjectedMapLines2d,
          hideMinorGeometry: hideMinorGeometry,
          focusSelection: focusSelection,
          selectedObservationId: selectedObservationId,
          selectedObservationPairKey: selectedObservationPairKey,
          selectedStationId: selectedStationId,
        }),
      ),
    [
      focusSelection,
      hideMinorGeometry,
      selectedObservationId,
      selectedObservationPairKey,
      selectedStationId,
      visibleBaseProjectedMapLines2d,
    ],
  );

  const connectedStationIds2d = useMemo(
    () =>
      measureMapViewPerf('map:build-connected-stations', () =>
        buildConnectedStationIds2d({
          filteredVisibleMapLines2d: filteredVisibleBaseProjectedMapLines2d,
          focusSelection: focusSelection,
          selectedStationId: selectedStationId,
        }),
      ),
    [filteredVisibleBaseProjectedMapLines2d, focusSelection, selectedStationId],
  );

  const filteredVisibleBaseProjectedPoints2d = useMemo(
    () =>
      measureMapViewPerf('map:filter-base-points', () =>
        buildFilteredVisiblePoints2d({
          visiblePoints2d: visibleBaseProjectedPoints2d,
          connectedStationIds: connectedStationIds2d,
        }),
      ),
    [connectedStationIds2d, visibleBaseProjectedPoints2d],
  );

  const projectedMapLines2d = useMemo(
    () =>
      measureMapViewPerf('map:apply-view-lines', () =>
        buildProjectedMapLines2d({
          baseProjectedMapLines2d: filteredVisibleBaseProjectedMapLines2d,
          view2d: derivedView2d,
        }),
      ),
    [filteredVisibleBaseProjectedMapLines2d, derivedView2d],
  );

  const projectedPoints2d = useMemo(
    () =>
      measureMapViewPerf('map:apply-view-points', () =>
        buildProjectedPoints2d({
          baseProjectedPoints2d: filteredVisibleBaseProjectedPoints2d,
          view2d: derivedView2d,
        }),
      ),
    [filteredVisibleBaseProjectedPoints2d, derivedView2d],
  );

  const interactionDenseMode = useMemo(
    () =>
      measureMapViewPerf('map:derive-interaction-density', () =>
        effectiveMode === '2d' &&
        interactionPhase === 'interacting' &&
        (projectedPoints2d.length > interactionDensePointThreshold ||
          projectedMapLines2d.length > interactionDenseLineThreshold),
      ),
    [
      effectiveMode,
      interactionDenseLineThreshold,
      interactionDensePointThreshold,
      interactionPhase,
      projectedMapLines2d.length,
      projectedPoints2d.length,
    ],
  );

  const visiblePointLabels2d = useMemo(
    () =>
      measureMapViewPerf('map:build-visible-labels', () =>
        buildVisiblePointLabels2d({
          showLabels: showLabels,
          visiblePoints2d: projectedPoints2d,
          visibleMapLines2dLength: projectedMapLines2d.length,
          interactionDenseMode,
          selectedStationId: selectedStationId,
          pointThreshold: denseLabelPointThreshold,
          edgeThreshold: denseLabelEdgeThreshold,
          labelGridPx: labelGridPx,
          scorePriority: (point) =>
            scoreMapStationPriority({
              stationId: point.id,
              selectedStationId: selectedStationId,
              severity: stationSeverity(point.id),
              fixed: point.fixed,
            }),
        }),
      ),
    [
      interactionDenseMode,
      denseLabelEdgeThreshold,
      denseLabelPointThreshold,
      labelGridPx,
      selectedStationId,
      showLabels,
      stationSeverity,
      projectedMapLines2d.length,
      projectedPoints2d,
    ],
  );

  const unselectedCanvasLines2d = useMemo(
    () =>
      measureMapViewPerf('map:build-unselected-lines', () =>
        buildUnselectedCanvasLines2d({
          filteredVisibleMapLines2d: projectedMapLines2d,
          interactionDenseMode,
          selectedObservationId: selectedObservationId,
          selectedObservationPairKey: selectedObservationPairKey,
          selectedStationId: selectedStationId,
        }),
      ),
    [
      interactionDenseMode,
      selectedObservationId,
      selectedObservationPairKey,
      selectedStationId,
      projectedMapLines2d,
    ],
  );

  const effectiveVisiblePointLabels2d = useMemo(() => {
    if (
      effectiveMode === '2d' &&
      planningBasemapMode === 'osm' &&
      showLabels &&
      projectedPoints2d.length > 0 &&
      projectedPoints2d.length <= osmFullLabelPointThreshold
    ) {
      return new Set(projectedPoints2d.map((point) => point.id));
    }
    return visiblePointLabels2d;
  }, [
    effectiveMode,
    osmFullLabelPointThreshold,
    planningBasemapMode,
    showLabels,
    projectedPoints2d,
    visiblePointLabels2d,
  ]);

  const mapDensitySummary = useMemo(
    () =>
      measureMapViewPerf('map:build-density-summary', () =>
        buildMapDensitySummary({
          filteredVisibleMapLines2dLength: projectedMapLines2d.length,
          filteredVisiblePoints2dLength: projectedPoints2d.length,
          totalProjectedMapLines2dLength: baseProjectedMapLines2d.length,
          projectedMapLines2dLength: projectedMapLines2d.length,
          visiblePointLabels2dSize: effectiveVisiblePointLabels2d.size,
          denseLabelEdgeThreshold: denseLabelEdgeThreshold,
        }),
      ),
    [
      baseProjectedMapLines2d.length,
      effectiveVisiblePointLabels2d.size,
      denseLabelEdgeThreshold,
      projectedMapLines2d.length,
      projectedPoints2d.length,
    ],
  );

  return {
    effectiveVisiblePointLabels2d,
    filteredVisibleMapLines2d: projectedMapLines2d,
    filteredVisiblePoints2d: projectedPoints2d,
    interactionDenseMode,
    mapDensitySummary,
    unselectedCanvasLines2d,
  };
};

