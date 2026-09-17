import type { ParseOptions, StationErrorEllipse, StationId, UnitsMode } from '../../types';
import type { FieldToFinishLink } from '../fieldToFinish/linkedSync';
import type { CadCogoComputation } from './cadCogoTypes';
import type { CadDisplayPoint } from './cadDisplayTypes';
import type { DraftDocument } from './cadDraftTypes';
export type {
  CadDisplayArcPrimitive,
  CadDisplayEllipsePrimitive,
  CadDisplayLinePrimitive,
  CadDisplayPoint,
  CadDisplayPointPrimitive,
  CadDisplayPrimitive,
  CadDisplayPrimitiveBase,
  CadDisplayScene,
  CadDisplayTextPrimitive,
} from './cadDisplayTypes';

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

export interface CadEntityAppearance {
  /** Hex color; undefined = ByLayer. */
  color?: string;
  /** Undefined = ByLayer. */
  lineTypeId?: CadLineTypeId;
  /** Physical mm; undefined = ByLayer. */
  lineweightMm?: number;
  /** 0 (opaque) .. 1 (fully transparent); undefined = ByLayer. */
  transparency?: number;
}

export interface CadBaseEntity {
  id: CadEntityId;
  type: string;
  layerId: CadLayerId;
  styleId?: CadStyleId;
  visible: boolean;
  locked: boolean;
  /** Appearance intent (ByLayer-or-explicit); absent = ByLayer. Never resolved values. */
  appearance?: CadEntityAppearance;
  metadata?: Record<string, unknown>;
}

export interface CadLayer {
  id: CadLayerId;
  name: string;
  color: string;
  lineTypeId?: CadLineTypeId;
  defaultStyleId?: CadStyleId;
  /** ON meaning (unchanged). OFF hides via view-layer filters, not the display scene. */
  visible: boolean;
  locked: boolean;
  /** Frozen layers hide like OFF via the same filter path. Default false. */
  frozen?: boolean;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  transparency?: number;
  /** Free-text note. Default ''. */
  description?: string;
  printable?: boolean;
  lineweightMm?: number;
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

export type CadPointSymbolShape = 'circle' | 'square' | 'triangle' | 'cross' | 'x' | 'dot';

export interface CadPointSymbol {
  id: CadPointSymbolId;
  name: string;
  radius: number;
  /** Symbol shape (default circle). Optional so legacy files open unchanged. */
  shape?: CadPointSymbolShape;
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

export type CadPointStyleId = string;

/**
 * Phase 18D: marker presentation ONLY (symbol + scale + rotation + visibility).
 * Color/layer/coordinate ownership stays with the 18C resolver (authoritative
 * for color/transparency/visibility). Radius semantics: markerScale multiplies
 * the referenced symbol radius in drawing units (NOT paper mm; the SVG/PDF
 * paper-mm gap is a known-future item, see phase18d-point-style-notes.md).
 */
export interface CadPointStyle {
  id: CadPointStyleId;
  name: string;
  /** Ref into styleLibrary.pointSymbols. */
  markerSymbolId: CadPointSymbolId;
  /** Multiplier on the symbol radius (drawing units). Default 1. */
  markerScale?: number;
  /** Marker rotation in degrees. Default 0. */
  rotationDeg?: number;
  /** False = marker not drawn (label/layer visibility unaffected). */
  displayMarker: boolean;
  description?: string;
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
  /** Phase 18D BASE point style (marker presentation). Undefined = drawing default. */
  pointStyleId?: CadPointStyleId;
  /** Phase 18D MANUAL override (undefined = By Default). Never stores resolved output. */
  pointStyleOverrideId?: CadPointStyleId;
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
  /** Phase 13E A1: optional F2F source link (absent = legacy/UNLINKED). */
  fieldToFinishLink?: FieldToFinishLink;
}

export interface CadProject {
  version: 1 | 2;
  id: string;
  name: string;
  metadata: CadProjectMetadata;
  layers: CadLayer[];
  styleLibrary: CadStyleLibrary;
  /** Phase 18D: drawing-owned point styles (marker presentation). Optional so
   * legacy files stay schema-compatible; load paths backfill defaults. */
  pointStyles?: CadPointStyle[];
  entities: CadEntity[];
  cogoComputations: CadCogoComputation[];
  bounds: CadBounds | null;
  /** Drawing-owned current layer; absent/unusable = default (`general`). */
  currentLayerId?: CadLayerId;
  /** Global drawing linetype scale (drawing units); absent = 1.0. */
  linetypeScale?: number;
}

export interface SurveyCadPersistedState {
  version: 1;
  sourceSignature: string;
  project: CadProject;
  parcelLayout?: CadParcelLayoutUiState;
  showParcelLabels?: boolean;
}

export interface CadDrawingImportRecord {
  id: string;
  kind: 'adjusted-points';
  sourceName: string;
  importedAtIso: string;
  createdPointCount: number;
  updatedPointCount: number;
  ellipseCount: number;
  /** Phase 17E MODEL A: incoming stations skipped because F2F owns their entities. */
  skippedF2fStationIds?: string[];
}

export interface CadDrawingDocument {
  kind: 'webnet-cad-drawing';
  schemaVersion: 1 | 2;
  drawingId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  units: UnitsMode;
  project: CadProject;
  parcelLayout?: CadParcelLayoutUiState;
  showParcelLabels?: boolean;
  imports?: CadDrawingImportRecord[];
  draft?: DraftDocument;
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
  floatingWidthPx: number;
  floatingHeightPx: number;
  activeParentParcelId: CadEntityId | null;
  activeFrontageEntityId: CadEntityId | null;
  activeFrontageParcelSegmentIds?: string[] | null;
  settings: CadParcelLayoutSettings;
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
