import type { AdjustedPointsExportSettings, AdjustmentResult, PlanningMapState } from '../../types';
import type { DerivedQaResult } from '../../engine/qaWorkflow';
import type { Map3DCamera } from '../../engine/map3d';
import type { MapToolPanel } from './MapViewContextMenu';

export interface MapViewSnapshot {
  view2d: { zoom: number; panX: number; panY: number };
  camera3d: Map3DCamera | null;
  activeTool: MapToolPanel;
  inverseFromInput: string;
  inverseToInput: string;
  anglePivotInput: string;
  angleFromInput: string;
  angleToInput: string;
  showTransformedCoordinates: boolean;
  showLabels: boolean;
  hideMinorGeometry: boolean;
  focusSelection: boolean;
}

export interface MapViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  planningMap?: PlanningMapState;
  onPlanningMapChange?: (_value: PlanningMapState) => void;
  inputPointsLoaded?: boolean;
  onLoadInputPoints?: (() => void) | null;
  showLostStations?: boolean;
  mode?: '2d' | '3d';
  viewportWidthOverride?: number;
  adjustedPointsExportSettings?: AdjustedPointsExportSettings;
  derivedResult?: DerivedQaResult | null;
  selectedStationId?: string | null;
  selectedObservationId?: number | null;
  onSelectStation?: (_stationId: string | null) => void;
  onSelectObservation?: (_observationId: number | null) => void;
  snapshot?: MapViewSnapshot | null;
  onSnapshotChange?: (_snapshot: MapViewSnapshot) => void;
}

export type DragMode = 'none' | 'pan2d' | 'orbit3d' | 'pan3d' | 'planning-vertex';
