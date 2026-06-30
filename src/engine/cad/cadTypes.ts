import type { ParseOptions, StationErrorEllipse, StationId, UnitsMode } from '../../types';
import type { CadCogoComputation } from './cadCogoTypes';

export type CadEntityId = string;
export type CadLayerId = string;
export type CadStyleId = string;
export type CadLineTypeId = string;
export type CadTextStyleId = string;
export type CadPointSymbolId = string;

export interface CadBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CadBaseEntity {
  id: CadEntityId;
  type: string;
  layerId: CadLayerId;
  styleId?: CadStyleId;
  visible: boolean;
  locked: boolean;
  metadata?: Record<string, unknown>;
}

export interface CadLayer {
  id: CadLayerId;
  name: string;
  color: string;
  lineTypeId?: CadLineTypeId;
  defaultStyleId?: CadStyleId;
  visible: boolean;
  locked: boolean;
  role:
    | 'points'
    | 'control-points'
    | 'observation-lines'
    | 'error-ellipses'
    | 'labels'
    | 'parcels'
    | 'planning';
}

export interface CadLineType {
  id: CadLineTypeId;
  name: string;
  dashPattern: number[];
}

export interface CadTextStyle {
  id: CadTextStyleId;
  name: string;
  fontFamily: string;
  fontSize: number;
}

export interface CadPointSymbol {
  id: CadPointSymbolId;
  name: string;
  radius: number;
}

export interface CadStyle {
  id: CadStyleId;
  name: string;
  color?: string;
  strokeWidth?: number;
  textStyleId?: CadTextStyleId;
  pointSymbolId?: CadPointSymbolId;
  lineTypeId?: CadLineTypeId;
}

export interface CadStyleLibrary {
  lineTypes: CadLineType[];
  textStyles: CadTextStyle[];
  pointSymbols: CadPointSymbol[];
  styles: CadStyle[];
}

export interface CadSurveyPointEntity extends CadBaseEntity {
  type: 'survey-point';
  stationId: StationId;
  x: number;
  y: number;
  z?: number;
  pointClass: 'control' | 'free' | 'unknown';
  source: 'adjustment-result' | 'parsed-input';
  description?: string;
  featureCode?: string;
  errorEllipse?: StationErrorEllipse;
}

export interface CadLineEntity extends CadBaseEntity {
  type: 'line';
  fromStationId: StationId;
  toStationId: StationId;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  sourceObservationIds: number[];
}

export interface CadPolylineEntity extends CadBaseEntity {
  type: 'polyline';
  vertices: CadDisplayPoint[];
  vertexLabels: string[];
  closed: boolean;
}

export interface CadArcEntity extends CadBaseEntity {
  type: 'arc';
  centerX: number;
  centerY: number;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
}

export type CadAlignmentElement =
  | {
      kind: 'line';
      start: CadDisplayPoint;
      end: CadDisplayPoint;
      sourceEntityId?: CadEntityId;
    }
  | {
      kind: 'arc';
      center: CadDisplayPoint;
      radius: number;
      startAngleDeg: number;
      endAngleDeg: number;
      sourceEntityId?: CadEntityId;
    };

export interface CadStationEquation {
  backStation: number;
  aheadStation: number;
  rawStation?: number;
}

export interface CadAlignmentEntity extends CadBaseEntity {
  type: 'alignment';
  name: string;
  elements: CadAlignmentElement[];
  startStation: number;
  stationEquations?: CadStationEquation[];
}

export interface CadPolygonEntity extends CadBaseEntity {
  type: 'polygon';
  vertices: CadDisplayPoint[];
  vertexLabels: string[];
}

export interface CadParcelEntity extends CadBaseEntity {
  type: 'parcel';
  vertices: CadDisplayPoint[];
  vertexLabels: string[];
  parcelName: string;
  areaSquareMeters?: number;
  perimeterMeters?: number;
  closureDeltaX?: number;
  closureDeltaY?: number;
  closureDistanceMeters?: number;
}

export interface CadTextEntity extends CadBaseEntity {
  type: 'text';
  x: number;
  y: number;
  text: string;
  anchorEntityId?: CadEntityId;
}

export interface CadErrorEllipseEntity extends CadBaseEntity {
  type: 'error-ellipse';
  stationId: StationId;
  centerX: number;
  centerY: number;
  semiMajor: number;
  semiMinor: number;
  thetaDeg: number;
}

export type CadEntity =
  | CadSurveyPointEntity
  | CadLineEntity
  | CadPolylineEntity
  | CadArcEntity
  | CadAlignmentEntity
  | CadPolygonEntity
  | CadParcelEntity
  | CadTextEntity
  | CadErrorEllipseEntity;

export interface CadProjectMetadata {
  source: 'adjustment-result' | 'parsed-input';
  runMode: ParseOptions['runMode'] | 'unknown';
  units: UnitsMode;
  stationCount: number;
  observationCount: number;
  adjustedStationCount: number;
}

export interface CadProject {
  version: 1 | 2;
  id: string;
  name: string;
  metadata: CadProjectMetadata;
  layers: CadLayer[];
  styleLibrary: CadStyleLibrary;
  entities: CadEntity[];
  cogoComputations: CadCogoComputation[];
  bounds: CadBounds | null;
}

export interface SurveyCadPersistedState {
  version: 1;
  sourceSignature: string;
  project: CadProject;
  parcelLayout?: CadParcelLayoutUiState;
  showParcelLabels?: boolean;
}

export type CadParcelLayoutSolutionPreference =
  | 'shortest_frontage'
  | 'smallest_area'
  | 'largest_area'
  | 'most_rectangular'
  | 'closest_to_target_area';

export type CadParcelLayoutAutomaticMode = 'off' | 'single_preview' | 'fill_parent';

export type CadParcelLayoutRemainderDistribution =
  | 'place_remainder_in_last_parcel'
  | 'create_parcel_from_remainder'
  | 'redistribute_remainder';

export interface CadParcelLayoutSettings {
  minAreaSquareMeters: number;
  minFrontageMeters: number;
  useFrontageAtOffset: boolean;
  frontageOffsetMeters: number;
  minWidthMeters: number;
  minDepthMeters: number;
  useMaxDepth: boolean;
  maxDepthMeters: number;
  solutionPreference: CadParcelLayoutSolutionPreference;
  automaticMode: CadParcelLayoutAutomaticMode;
  remainderDistribution: CadParcelLayoutRemainderDistribution;
}

export interface CadParcelLayoutUiState {
  open: boolean;
  collapsed: boolean;
  dock: 'floating' | 'left' | 'right';
  floatingLeftPx: number;
  floatingTopPx: number;
  activeParentParcelId: CadEntityId | null;
  activeFrontageEntityId: CadEntityId | null;
  settings: CadParcelLayoutSettings;
}

export interface CadDisplayPoint {
  x: number;
  y: number;
}

export interface CadDisplayPrimitiveBase {
  id: string;
  layerId: string;
  sourceEntityId: CadEntityId;
  sourceSegmentId?: string;
  stroke: string;
  fill?: string;
  opacity?: number;
  strokeDasharray?: string;
}

export interface CadDisplayPointPrimitive extends CadDisplayPrimitiveBase {
  kind: 'point';
  point: CadDisplayPoint;
  radius: number;
}

export interface CadDisplayLinePrimitive extends CadDisplayPrimitiveBase {
  kind: 'line';
  points: [CadDisplayPoint, CadDisplayPoint];
  strokeWidth: number;
}

export interface CadDisplayArcPrimitive extends CadDisplayPrimitiveBase {
  kind: 'arc';
  center: CadDisplayPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  strokeWidth: number;
}

export interface CadDisplayTextPrimitive extends CadDisplayPrimitiveBase {
  kind: 'text';
  point: CadDisplayPoint;
  text: string;
  fontSize: number;
  rotationDeg?: number;
  textAnchor?: 'start' | 'middle' | 'end';
}

export interface CadDisplayEllipsePrimitive extends CadDisplayPrimitiveBase {
  kind: 'ellipse';
  center: CadDisplayPoint;
  semiMajor: number;
  semiMinor: number;
  thetaDeg: number;
  strokeWidth: number;
}

export type CadDisplayPrimitive =
  | CadDisplayPointPrimitive
  | CadDisplayLinePrimitive
  | CadDisplayArcPrimitive
  | CadDisplayTextPrimitive
  | CadDisplayEllipsePrimitive;

export interface CadDisplayScene {
  bounds: CadBounds | null;
  primitives: CadDisplayPrimitive[];
}

export type CadGripHandleKind =
  | 'line-start'
  | 'line-end'
  | 'vertex'
  | 'arc-start'
  | 'arc-end'
  | 'arc-radius';

export interface CadGripHandle {
  id: string;
  entityId: CadEntityId;
  kind: CadGripHandleKind;
  x: number;
  y: number;
  vertexIndex?: number;
}

export type CadSnapKind =
  | 'point-node'
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'arc-midpoint'
  | 'quadrant'
  | 'intersection'
  | 'apparent-intersection'
  | 'extension'
  | 'perpendicular'
  | 'parallel'
  | 'direction'
  | 'tangent'
  | 'nearest';

export interface CadSnapCandidate {
  id: string;
  kind: CadSnapKind;
  sourceEntityId: CadEntityId;
  sourceSegmentId?: string;
  x: number;
  y: number;
  distance: number;
  label: string;
  guideSegments?: Array<[CadDisplayPoint, CadDisplayPoint]>;
  compoundKinds?: CadSnapKind[];
  lockGuidePoint?: CadDisplayPoint;
}

export interface CadSnapLock {
  kind: 'extension' | 'perpendicular' | 'parallel' | 'tangent';
  sourceEntityId: CadEntityId;
  sourceSegmentId?: string;
  guidePoint?: CadDisplayPoint;
}

export interface CadSnapConstructionContext {
  active: boolean;
  basePoint: CadDisplayPoint | null;
  scopeSeedSegmentId?: string | null;
  tangentSeedArcEntityId?: string | null;
  tangentSeedPoint?: CadDisplayPoint | null;
  lockedSnap?: CadSnapLock | null;
}

export interface MlightcadSpikeLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
}

export interface MlightcadSpikeEntity {
  objectId: string;
  type: 'AcDbPoint' | 'AcDbLine' | 'AcDbPolyline' | 'AcDbArc' | 'AcDbText' | 'AcDbEllipse';
  layer: string;
  visible: boolean;
  geometry: Record<string, unknown>;
  metadata: {
    nativeEntityId: CadEntityId;
    nativeType: CadEntity['type'];
  };
}

export interface MlightcadSpikeScene {
  layers: MlightcadSpikeLayer[];
  entities: MlightcadSpikeEntity[];
  extents: CadBounds | null;
}
