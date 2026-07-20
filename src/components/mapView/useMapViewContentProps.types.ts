import type {
  Dispatch,
  MouseEventHandler,
  MutableRefObject,
  SetStateAction,
  WheelEventHandler,
} from 'react';
import type { Map3DCamera, Map3DScene } from '../../engine/map3d';
import type { DerivedQaResult } from '../../engine/qaWorkflow';
import type { AdjustmentResult, PlanningMapState } from '../../types';
import type { MapViewContentProps } from './MapViewContent';
import type { MapToolPanel } from './MapViewContextMenu';
import type { MapToolPickTarget } from './MapViewToolOverlay';
import type { useMapViewLayerRenderer } from './useMapViewLayerRenderer';
import type { MapBounds2d, Projection2d, View2dState } from './mapView2d';
import type { PlanningPolygonTarget, ScreenSelectionBox } from './mapViewInteraction';
import type { MapViewTileStore } from './mapViewTileStore';

type ContentRefProps = Pick<
  MapViewContentProps,
  | 'basemapCanvasRef'
  | 'containerRef'
  | 'contextMenuRef'
  | 'geometryCanvasRef'
  | 'planningCanvasRef'
  | 'renderSurfaceRef'
  | 'svgRef'
  | 'webglCanvasRef'
>;

type ToolStateProps = {
  activeTool: MapToolPanel;
  angleBetween: NonNullable<MapViewContentProps['toolOverlayProps']>['angleBetween'];
  angleFromId: string | null;
  angleFromInput: string;
  anglePivotId: string | null;
  anglePivotInput: string;
  angleToId: string | null;
  angleToInput: string;
  applyPickedToolStation: (_stationId: string) => void;
  clearToolPickTarget: () => void;
  closeTool: () => void;
  highlightedToolSegments: MapViewContentProps['svg2dProps']['highlightedToolSegments'];
  highlightedToolStationIds: MapViewContentProps['svg2dProps']['highlightedToolStationIds'];
  inverse: NonNullable<MapViewContentProps['toolOverlayProps']>['inverse'];
  inverseFromId: string | null;
  inverseFromInput: string;
  inverseToId: string | null;
  inverseToInput: string;
  openTool: NonNullable<MapViewContentProps['contextMenuProps']['onOpenTool']>;
  setAngleFromInput: (_value: string) => void;
  setAnglePivotInput: (_value: string) => void;
  setAngleToInput: (_value: string) => void;
  setInverseFromInput: (_value: string) => void;
  setInverseToInput: (_value: string) => void;
  toggleToolPickTarget: (_target: MapToolPickTarget) => void;
  toolPickTarget: MapToolPickTarget | null;
};

export interface UseMapViewContentPropsArgs extends ContentRefProps, ToolStateProps {
  basemapDescriptorView2d: View2dState;
  beginDrag: (_modeName: 'planning-vertex', _clientX: number, _clientY: number) => void;
  bbox: MapBounds2d;
  camera3d: Map3DCamera | null;
  clearDraftBlockedPolygon: () => void;
  clearMapSelection: () => void;
  closeContextMenu: () => void;
  commitDraftBlockedPolygon: () => void;
  contextMenu: {
    open: boolean;
    x: number;
    y: number;
    planningPolygon: PlanningPolygonTarget | null;
  };
  derivedResult: DerivedQaResult | null;
  derivedView2d: View2dState;
  dragRef: MutableRefObject<{ active: boolean; mode: string; lastX: number; lastY: number }>;
  draftBlockedPolygon: Array<{ x: number; y: number }>;
  draftBlockedPolygonLength: number;
  effectiveMode: '2d' | '3d';
  ellipseStroke: (_stationId: string) => string;
  fallbackReason: string | null;
  focusSelection: boolean;
  handleMouseDown: MouseEventHandler<SVGSVGElement>;
  handleMouseUp: MouseEventHandler<SVGSVGElement>;
  handleWheel: WheelEventHandler<SVGSVGElement>;
  hideMinorGeometry: boolean;
  idlePrefetchReady: boolean;
  inputPointsLoaded: boolean;
  interactionPhase: MapViewContentProps['interactionPhase'];
  isDragging: boolean;
  isPreanalysis: boolean;
  layerRenderer: ReturnType<typeof useMapViewLayerRenderer>;
  mode: '2d' | '3d';
  obstacleFetchSignatureRef: MutableRefObject<string>;
  observations: AdjustmentResult['observations'];
  onLoadInputPoints: (() => void) | null;
  onPlanningMapChange?: ((_value: PlanningMapState) => void) | undefined;
  onSelectObservation?: ((_observationId: number | null) => void) | undefined;
  onSelectStation?: ((_stationId: string | null) => void) | undefined;
  planningMap: PlanningMapState;
  planningVertexDragRef: MutableRefObject<{
    polygonId: string;
    polygonSource: 'user' | 'osm';
    vertexIndex: number;
  } | null>;
  points: Array<{ id: string; x: number; y: number; fixed: boolean }>;
  project2d: (_x: number, _y: number) => { x: number; y: number };
  projection2d: Projection2d;
  removePlanningPolygon: (_polygonId: string, _source: 'user' | 'osm') => void;
  removeSelectedPlanningPolygons: () => void;
  renderSurfaceLayout: MapViewContentProps['renderSurfaceLayout'];
  renderer2d: 'canvas' | 'webgl';
  result: AdjustmentResult;
  scene3d: Map3DScene;
  selectedObservationId: number | null;
  selectedPlanningPolygonIds: string[];
  selectedStationId: string | null;
  selectionBox: ScreenSelectionBox | null;
  setBasemapDescriptorView2d: Dispatch<SetStateAction<View2dState>>;
  setCamera3d: Dispatch<SetStateAction<Map3DCamera | null>>;
  setContextMenu: Dispatch<
    SetStateAction<{
      open: boolean;
      x: number;
      y: number;
      planningPolygon: PlanningPolygonTarget | null;
    }>
  >;
  setDraftBlockedPolygon: Dispatch<SetStateAction<Array<{ x: number; y: number }>>>;
  setFocusSelection: (_value: boolean) => void;
  setHideMinorGeometry: (_value: boolean) => void;
  setSelectedPlanningPolygonIds: Dispatch<SetStateAction<string[]>>;
  setSelectionBox: Dispatch<SetStateAction<ScreenSelectionBox | null>>;
  setShowLabels: (_value: boolean) => void;
  setShowTransformedCoordinates: (_value: boolean) => void;
  showLabels: boolean;
  showLostStations: boolean;
  showTransformToggle: boolean;
  stationFill: (_stationId: string, _fixed: boolean) => string;
  stationSeverity: (_stationId: string) => 'watch' | 'weak' | null;
  stations: AdjustmentResult['stations'];
  svgToMapCoords: (_screenX: number, _screenY: number) => { x: number; y: number };
  tileStoreRef: MutableRefObject<MapViewTileStore>;
  toSvgCoords: (_clientX: number, _clientY: number) => { x: number; y: number } | null;
  transformedLines2d: MapViewContentProps['svg2dProps']['transformedLines2d'];
  transformedOverlayActive: boolean;
  transformedOverlayConfig: MapViewContentProps['transformedOverlayConfig'];
  transformedPoints2d: MapViewContentProps['svg2dProps']['transformedPoints2d'];
  unitScale: number;
  units: 'm' | 'ft';
  updatePlanningPolygonVertices: (
    _polygonId: string,
    _source: 'user' | 'osm',
    _vertices: Array<{ x: number; y: number }>,
  ) => void;
  view2d: View2dState;
  visibleStationRows: NonNullable<MapViewContentProps['toolOverlayProps']>['visibleStationRows'];
  webglEligible: boolean;
}
