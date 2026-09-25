import type { CadAnnotationAnchor } from './annotation/cadAnnotationAnchors';
import type { CadAnnotationSettings } from './annotation/cadAnnotationSettings';
import type { ParseOptions, StationErrorEllipse, StationId, UnitsMode } from '../../types';
import type { FieldToFinishSettings } from '../fieldToFinish/catalogIo';
import type { FeatureCodeCatalog } from '../fieldToFinish/featureCatalog';
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
    | 'surfaces'
    | 'planning';
}

export interface CadLineType {
  id: CadLineTypeId;
  name: string;
  dashPattern: number[];
}

export type CadTextHeightMode = 'legacy-screen' | 'model' | 'paper';

export interface CadTextStyle {
  id: CadTextStyleId;
  name: string;
  fontFamily: string;
  fontSize: number;
  /** Phase 18O professional text fields (all optional; absent = legacy). */
  heightMode?: CadTextHeightMode;
  modelHeight?: number;
  paperHeightMm?: number;
  widthFactor?: number;
  lineSpacingFactor?: number;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
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
export type CadPointLabelStyleId = string;
export type CadPointGroupId = string;

/**
 * Phase 18D point-group query. DISPLAY/ORGANIZATION ONLY: matching never
 * duplicates geometry and never mutates coordinates. Wildcards `*` (any run)
 * and `?` (exactly one char) are supported ONLY in descriptionPattern and
 * featureCodePattern, matched case-INSENSITIVELY. Regex/bracket syntax is
 * not supported: any pattern containing `[`, `]` or `\` is malformed and
 * fails closed (matches nothing; see validatePointGroupQuery). Entity-id
 * lists match exactly (case-sensitive); excludePointIds always wins over
 * includePointIds and query constraints.
 */
export interface CadPointGroupQuery {
  /** Entity ids (point.id) explicitly included (OR with query constraints). */
  includePointIds?: string[];
  /** Entity ids always excluded; wins over include and query. */
  excludePointIds?: string[];
  descriptionPattern?: string;
  featureCodePattern?: string;
  pointClass?: 'control' | 'free' | 'unknown';
  layerId?: string;
  source?: 'adjustment-result' | 'parsed-input';
  elevationMin?: number;
  elevationMax?: number;
}

/**
 * Phase 18D point group: a named, ordered query rule carrying optional
 * per-property style overrides. Overrides are display-only references;
 * unknown style ids fall back deterministically at resolve time.
 */
export interface CadPointGroup {
  id: CadPointGroupId;
  name: string;
  query: CadPointGroupQuery;
  pointStyleOverrideId?: CadPointStyleId;
  pointLabelStyleOverrideId?: CadPointLabelStyleId;
  /** Lower = higher precedence; list order is the tiebreak. */
  priority: number;
  description?: string;
}

export type CadPointLabelComponent = 'pointNumber' | 'description' | 'elevation' | 'featureCode';

/**
 * Phase 18D: point label content/layout ONLY (which components, order,
 * separator, elevation decimals, placement offset, visibility). Color/font
 * stay with the label's own layer/style; no annotation scale yet (future).
 */
export interface CadPointLabelStyle {
  id: CadPointLabelStyleId;
  name: string;
  components: {
    pointNumber?: boolean;
    description?: boolean;
    elevation?: boolean;
    featureCode?: boolean;
    prefix?: string;
    suffix?: string;
  };
  componentOrder: CadPointLabelComponent[];
  separator: string;
  /** Elevation decimals, 0-4. Drawing units; never the global precision. */
  elevationDecimals: number;
  textStyleId: CadTextStyleId;
  /** Base placement offset in drawing units (point + offset). */
  offsetX: number;
  offsetY: number;
  rotationDeg?: number;
  /** False = label not drawn (point/layer visibility unaffected). */
  visible: boolean;
  description?: string;
}

/**
 * Phase 18D: associative binding on a text label. x/y/text remain compat
 * snapshots; the binding is the associative source of truth. offsetOverride
 * WINS over the style offset (not additive); the label keeps its own layer
 * (no visibility coupling to the point).
 */
export interface CadPointLabelBinding {
  pointEntityId: CadEntityId;
  labelStyleId: CadPointLabelStyleId;
  offsetOverride?: { dx: number; dy: number };
  rotationOverrideDeg?: number;
  content: { mode: 'derived' } | { mode: 'manual'; text: string };
}

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
  /**
   * Phase 18N: block marker ref (into project.blockDefinitions). Mutually
   * exclusive with markerSymbolId via validateCadPointStyle — when set (and
   * known) the marker renders the block at the point (scale =
   * markerScale, rotation = rotationDeg); markerSymbolId stays as the
   * legacy fallback. Absent on legacy styles = unchanged rendering.
   */
  markerBlockDefinitionId?: string;
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
  /** Phase 18D BASE label style (content/layout). Undefined = drawing default. */
  pointLabelStyleId?: CadPointLabelStyleId;
  /** Phase 18D MANUAL label override (undefined = By Default). Never stores resolved output. */
  pointLabelStyleOverrideId?: CadPointLabelStyleId;
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
  /** Phase 18D associative label binding. Absent = free (legacy baked) text. */
  pointLabel?: CadPointLabelBinding;
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

/**
 * Phase 18N: reusable block child shapes. Existing entity interfaces are
 * reused verbatim; inside a block definition ids are block-local
 * (namespaced to the definition) and MUST NOT collide with top-level
 * entity ids. Text children MUST NOT carry a pointLabel binding.
 */
export type CadBlockChild =
  | CadLineEntity
  | CadPolylineEntity
  | CadArcEntity
  | CadPolygonEntity
  | CadTextEntity;

/** Phase 18N: named reusable geometry library entry (block-local space). */
export interface CadBlockDefinition {
  id: string;
  name: string;
  basePoint: { x: number; y: number };
  entities: CadBlockChild[];
  description?: string;
}

/**
 * Phase 18N: block instance. rotationDeg follows the geometry convention
 * (degrees CCW from +X, y-up); scaleX/scaleY must be finite and > 0.
 * Phase 18Q: optional `mirrored` flag (absent = false). Reflection lives
 * ONLY in this flag — scale signs never encode mirroring and nonpositive
 * scales are still rejected. When true, child geometry is reflected
 * across the block-local Y axis (M = diag(-1,1)) BEFORE scale+rotation;
 * text glyphs stay readable (anchor transforms, glyphs never mirrored).
 */
export interface CadBlockReferenceEntity extends CadBaseEntity {
  type: 'block-reference';
  blockDefinitionId: string;
  x: number;
  y: number;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
  mirrored?: boolean;
}

export type CadBlockChildType = CadBlockChild['type'];

// ---------------------------------------------------------------------------
// Phase 18O professional annotation entities + style tables (all additive)
// ---------------------------------------------------------------------------

/** 9-point mtext attachment. */
export type CadMTextAttachment =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'middle-center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface CadMTextEntity extends CadBaseEntity {
  type: 'mtext';
  x: number;
  y: number;
  text: string;
  textStyleId: CadTextStyleId;
  rotationDeg: number;
  attachment: CadMTextAttachment;
}

export interface CadLeaderEntity extends CadBaseEntity {
  type: 'leader';
  arrowAnchor: CadAnnotationAnchor;
  vertices: { x: number; y: number }[];
  text: string;
  leaderStyleId: string;
  textStyleId?: CadTextStyleId;
  textAttachment?: CadMTextAttachment;
}

export type CadDimensionKind = 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter';

export interface CadDimensionEntity extends CadBaseEntity {
  type: 'dimension';
  dimensionKind: CadDimensionKind;
  anchors: CadAnnotationAnchor[];
  /** Definition-point pair for linear/aligned (anchor pair). */
  defPoint1?: CadAnnotationAnchor;
  defPoint2?: CadAnnotationAnchor;
  orientation?: 'horizontal' | 'vertical' | 'aligned';
  dimLinePoint: { x: number; y: number };
  textPoint?: { x: number; y: number };
  dimensionStyleId: string;
  textOverride?: string;
}

export interface CadBearingDistanceLabelEntity extends CadBaseEntity {
  type: 'bearing-label';
  sourceEntityId: CadEntityId;
  labelStyleId: string;
  offset: { x: number; y: number };
  side?: 'left' | 'right' | 'auto';
  manualTextOverride?: string;
}

export interface CadCurveLabelEntity extends CadBaseEntity {
  type: 'curve-label';
  sourceEntityId: CadEntityId;
  labelStyleId: string;
  offset: { x: number; y: number };
  manualTextOverride?: string;
}

export interface CadDimensionStyle {
  id: string;
  name: string;
  textStyleId: CadTextStyleId;
  arrowBlockDefinitionId: string;
  arrowSize: number;
  arrowSizeMode?: 'model' | 'paper';
  textGap: number;
  extensionOffset: number;
  extensionOvershoot: number;
  decimalPrecision: number;
  prefix?: string;
  suffix?: string;
}

export interface CadLeaderStyle {
  id: string;
  name: string;
  textStyleId: CadTextStyleId;
  arrowBlockDefinitionId: string;
  arrowSize: number;
  arrowSizeMode?: 'model' | 'paper';
  landingLength: number;
  textGap: number;
}

export interface CadBearingLabelStyle {
  id: string;
  name: string;
  textStyleId: CadTextStyleId;
  content: 'bearing' | 'distance' | 'bearing-distance' | 'distance-bearing';
  separator: 'newline' | 'space' | 'slash';
  offset: { x: number; y: number };
  decimalPrecision: number;
}

export type CadCurveLabelField = 'radius' | 'delta' | 'length' | 'chord';

export interface CadCurveLabelStyle {
  id: string;
  name: string;
  textStyleId: CadTextStyleId;
  fields: CadCurveLabelField[];
  offset: { x: number; y: number };
  decimalPrecision: number;
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
  | CadErrorEllipseEntity
  | CadBlockReferenceEntity
  | CadMTextEntity
  | CadLeaderEntity
  | CadDimensionEntity
  | CadBearingDistanceLabelEntity
  | CadCurveLabelEntity;

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
  /** Phase 18D: drawing-owned point label styles (content/layout). Optional
   * so legacy files stay schema-compatible; load paths backfill defaults. */
  labelStyles?: CadPointLabelStyle[];
  /** Phase 18D: drawing-owned point groups (display/organization rules).
   * Optional so legacy files stay schema-compatible; load paths backfill
   * the two seed groups. Array order is the priority tiebreak. */
  pointGroups?: CadPointGroup[];
  /**
   * Phase 18E: drawing-owned F2F feature catalog (authoritative; workspace
   * state never persists). Optional so legacy files open; load paths seed
   * the starter catalog, or leave MISSING_LEGACY when F2F content exists
   * without a catalog. Trailing: clone/migrate keep this last — project
   * signatures are key-order-sensitive JSON.stringify.
   */
  fieldToFinishCatalog?: FeatureCodeCatalog;
  /**
   * Phase 18E: drawing-owned F2F settings (control-token aliases).
   * Optional; load paths backfill {}. Never part of the catalog revision.
   */
  fieldToFinishSettings?: FieldToFinishSettings;
  /**
   * Phase 18F: drawing-owned TIN surfaces (model only; no triangle entities).
   * Optional so legacy files open; load paths leave absent as absent.
   * Trailing: clone keeps this last — project signatures are
   * key-order-sensitive JSON.stringify.
   */
  surfaces?: CadSurface[];
  /** Phase 18F: drawing-owned surface display styles (display only). */
  surfaceStyles?: CadSurfaceStyle[];
  /**
   * Phase 18I: drawing-owned TIN-to-TIN volume relationships (base +
   * comparison refs only; derived quantities/geometry never persist).
   * Trailing: clone/migrate keep volume tables last — project signatures
   * are key-order-sensitive JSON.stringify.
   */
  volumeSurfaces?: CadVolumeSurface[];
  /** Phase 18I: drawing-owned volume display styles (display only). */
  volumeSurfaceStyles?: CadVolumeSurfaceStyle[];
  /**
   * Phase 18J: drawing-owned surface-profile definitions (alignment +
   * surface refs only; samples/revisions/statuses never persist).
   * Trailing: clone/migrate keep profile tables last — project signatures
   * are key-order-sensitive JSON.stringify.
   */
  surfaceProfiles?: CadSurfaceProfile[];
  /** Phase 18J: drawing-owned profile view presentation objects. */
  profileViews?: CadProfileView[];
  /** Phase 18J: drawing-owned profile display styles (display only). */
  profileStyles?: CadProfileStyle[];
  /**
   * Phase 18K: drawing-owned sample-line groups (one alignment each; sample
   * line definitions only — extracted sections/revisions/statuses never
   * persist). Trailing: clone/migrate keep section tables last — project
   * signatures are key-order-sensitive JSON.stringify.
   */
  sampleLineGroups?: CadSampleLineGroup[];
  /** Phase 18K: drawing-owned section display styles (display only). */
  sectionStyles?: CadSectionStyle[];
  /** Phase 18K: drawing-owned section view presentation objects. */
  sectionViews?: CadSectionView[];
  /**
   * Phase 18N: drawing-owned block definitions (reusable symbol library).
   * Optional trailing table (additive, schema 2); clone keeps this last —
   * project signatures are key-order-sensitive JSON.stringify.
   */
  blockDefinitions?: CadBlockDefinition[];
  /** Phase 18O professional dimension styles (display only). Trailing table. */
  dimensionStyles?: CadDimensionStyle[];
  /** Phase 18O professional leader styles (display only). Trailing table. */
  leaderStyles?: CadLeaderStyle[];
  /** Phase 18O bearing/distance label styles (display only). Trailing table. */
  bearingLabelStyles?: CadBearingLabelStyle[];
  /** Phase 18O curve label styles (display only). Trailing table. */
  curveLabelStyles?: CadCurveLabelStyle[];
  /** Phase 18O annotation scale settings. Trailing (key-order-sensitive signatures). */
  annotationSettings?: CadAnnotationSettings;
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
  | 'arc-radius'
  | 'insertion';

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

/** Phase 18F: TIN surface model (engine only; never triangle entities). */

export type CadSurfacePointSource =
  /* Multi-group: canonical list is pointGroupIds (added order); pointGroupId
     is the legacy single-source shape, migrated on load. */
  | { kind: 'point-group'; pointGroupIds?: string[]; pointGroupId?: string }
  | { kind: 'points'; pointEntityIds: CadEntityId[] };

/** Canonical group ids for a surface point source (legacy -> one-element list). */
export const surfacePointGroupIds = (source: CadSurfacePointSource): string[] => {
  if (source.kind !== 'point-group') return [];
  if (source.pointGroupIds != null) return [...source.pointGroupIds];
  return source.pointGroupId != null ? [source.pointGroupId] : [];
};

export type CadSurfaceBreaklineSource =
  | { kind: 'point-chain'; pointEntityIds: CadEntityId[] }
  | { kind: 'entity'; entityId: CadEntityId };

export interface CadSurfaceBreakline {
  id: string;
  source: CadSurfaceBreaklineSource;
  /** Only 'standard' in 18F; future types (proximity/wall) are out of scope. */
  type: 'standard';
  name?: string;
}

export interface CadSurfaceBoundary {
  type: 'outer' | 'void';
  sourceEntityId: CadEntityId;
}

export interface CadSurfaceBuildOptions {
  /** Post-build filter: drop triangles with any edge longer than this (drawing units). */
  maxEdgeLength?: number;
}

export interface ImportedTinProvenance {
  format: 'LandXML';
  fileName: string;
  surfaceName: string;
  sourceId?: string;
}

/**
 * Phase 18L additive imported-TIN payload. Compact number arrays:
 * vertices = [x0,y0,z0, x1,y1,z1, ...] (metres, E/N/Z), faces = [a0,b0,c0, ...]
 * (CCW index triples). The mesh NEVER persists — reopen rebuilds it from
 * these arrays via buildCadSurface (no Delaunay, no source XML needed).
 */
export interface ImportedTinPayload {
  vertices: number[];
  faces: number[];
  provenance: ImportedTinProvenance;
}

export interface CadSurfaceDefinition {
  pointSource: CadSurfacePointSource;
  breaklines?: CadSurfaceBreakline[];
  boundaries?: CadSurfaceBoundary[];
  buildOptions?: CadSurfaceBuildOptions;
  /**
   * Phase 18S: ordered TIN edit stack (array order authoritative, no
   * canonical sort). Absent = no edits (legacy behavior). Additive.
   */
  edits?: CadSurfaceEdit[];
  /**
   * Phase 18L: absent/'native' = entity-derived TIN (18F model); 'imported-tin'
   * = explicit imported topology (importedTin required). Additive — legacy
   * drawings load as native, migration is idempotent.
   */
  sourceKind?: 'native' | 'imported-tin';
  importedTin?: ImportedTinPayload;
}

/** True only for validated imported-TIN definitions (never for native). */
export const isImportedTinDefinition = (
  definition: Pick<CadSurfaceDefinition, 'sourceKind' | 'importedTin'> | undefined,
): boolean =>
  definition?.sourceKind === 'imported-tin' && definition.importedTin != null;

/**
 * Phase 18S TIN edit stack (ENGINE ONLY — no UI/manager/toolspace).
 *
 * Vertex refs address STABLE identities only: native `source:<entityId>`
 * (survey-point entity id), imported `imported:<surfaceId>:<vertexIndex>`
 * (positional index i/3 into ImportedTinPayload.vertices), and edit-created
 * `edit:<surfaceId>:<editId>` (from the creating add-point edit id).
 * Boundary (`boundary:…`) and Steiner (`steiner:…`) vertices are NOT
 * addressable. Edge endpoints are canonicalized (sorted key order) for
 * identity.
 */
export interface CadSurfaceVertexRef {
  key: string;
}

export interface CadSurfaceEdgeRef {
  a: CadSurfaceVertexRef;
  b: CadSurfaceVertexRef;
}

export interface CadSurfaceSwapEdgeEdit {
  id: string;
  kind: 'swap-edge';
  /** Absent = TRUE. */
  enabled?: boolean;
  edge: CadSurfaceEdgeRef;
}

export interface CadSurfaceAddLineEdit {
  id: string;
  kind: 'add-line';
  /** Absent = TRUE. */
  enabled?: boolean;
  from: CadSurfaceVertexRef;
  to: CadSurfaceVertexRef;
}

export interface CadSurfaceDeleteLineEdit {
  id: string;
  kind: 'delete-line';
  /** Absent = TRUE. */
  enabled?: boolean;
  edge: CadSurfaceEdgeRef;
}

/**
 * Phase 18T surface-local point/elevation edits (ENGINE ONLY — no UI).
 *
 * Edit-created points get the stable key `edit:<surfaceId>:<editId>` derived
 * from the EDIT id (never index/XY), so later edits address them via the
 * same resolver and save/reopen shuffles keep refs stable. Topology edits
 * (swap/add-line/delete-line) are untouched.
 */
export interface CadSurfaceAddPointEdit {
  id: string;
  kind: 'add-point';
  /** Absent = TRUE. */
  enabled?: boolean;
  x: number;
  y: number;
  z: number;
}

export interface CadSurfaceDeletePointEdit {
  id: string;
  kind: 'delete-point';
  /** Absent = TRUE. */
  enabled?: boolean;
  vertex: CadSurfaceVertexRef;
}

export interface CadSurfaceMovePointEdit {
  id: string;
  kind: 'move-point';
  /** Absent = TRUE. */
  enabled?: boolean;
  vertex: CadSurfaceVertexRef;
  /** XY-only target (Z unchanged). */
  x: number;
  y: number;
}

export interface CadSurfaceSetElevationEdit {
  id: string;
  kind: 'set-elevation';
  /** Absent = TRUE. */
  enabled?: boolean;
  vertex: CadSurfaceVertexRef;
  z: number;
}

export interface CadSurfaceRaiseLowerEdit {
  id: string;
  kind: 'raise-lower-surface';
  /** Absent = TRUE. */
  enabled?: boolean;
  /** Added to EVERY ACTIVE vertex at this replay position (incl. synthetic). */
  deltaZ: number;
}

export type CadSurfaceEdit =
  | CadSurfaceSwapEdgeEdit
  | CadSurfaceAddLineEdit
  | CadSurfaceDeleteLineEdit
  | CadSurfaceAddPointEdit
  | CadSurfaceDeletePointEdit
  | CadSurfaceMovePointEdit
  | CadSurfaceSetElevationEdit
  | CadSurfaceRaiseLowerEdit;

export type CadSurfaceStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_REBUILD'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'INSUFFICIENT_DATA';

export interface CadSurface {
  id: string;
  name: string;
  definition: CadSurfaceDefinition;
  styleId?: string;
  /** Geometry-only revision of the last successful build; absent = never built. */
  cachedRevision?: string | null;
  /** Display/lock layer; absent = ByLayer-default (visible, unlocked). */
  layerId?: CadLayerId;
  /** Last worker/transport failure; derived status stays authoritative. */
  buildDiagnostic?: string;
}

/** Phase 18H: per-kind contour line appearance (display only, never geometry). */
export interface CadContourAppearance {
  color?: string;
  lineweight?: number;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  opacity?: number;
}

/** Phase 18F: surface display styling ONLY (never affects geometry/revision). */
export interface CadSurfaceStyle {
  id: string;
  name: string;
  color?: string;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  opacity?: number;
  showTriangles?: boolean;
  showContours?: boolean;
  /** Display-only extras for the seed styles (never affect geometry). */
  showPoints?: boolean;
  showBoundary?: boolean;
  description?: string;
  /**
   * Phase 18H contour display intent. Major model is major-every-N minor
   * levels (NOT an explicit major interval): a level with index k is major
   * when k is a multiple of majorContourEvery (mirrors computeContourLevels).
   * Absent on legacy styles = no contour display (display-time default).
   */
  minorContourInterval?: number;
  majorContourEvery?: number;
  contourBaseElevation?: number;
  minorContour?: CadContourAppearance;
  majorContour?: CadContourAppearance;
  showContourLabels?: boolean;
  /** Default true: label major contours only. */
  labelMajorOnly?: boolean;
  /** Along-path label spacing in drawing units. */
  contourLabelSpacing?: number;
  /** Decimals for label text (elevation in drawing units, no suffix). */
  contourLabelPrecision?: number;
}

/**
 * Phase 18I: TIN-to-TIN volume relationship. Holds ONLY the base and
 * comparison surface refs plus display binding; overlap polygons, cut/fill
 * cache, and worker status are always derived and never serialized.
 */
export interface CadVolumeSurface {
  id: string;
  name: string;
  baseSurfaceId: string;
  comparisonSurfaceId: string;
  /** Display/lock layer; absent = ByLayer-default (visible, unlocked). */
  layerId?: CadLayerId;
  styleId?: string;
  description?: string;
}

/** Phase 18I: volume display styling ONLY (never affects geometry/revision). */
export interface CadVolumeSurfaceStyle {
  id: string;
  name: string;
  showCut: boolean;
  showFill: boolean;
  /** Optional display-only zero-boundary lines (never affects quantities). */
  showZeroBoundary?: boolean;
  cutColor: string;
  fillColor: string;
  /** Display opacity factor (0 fully transparent .. 1 fully opaque). */
  opacity: number;
}

/** Phase 18I: derived volume status (never persisted; never a trusted flag). */
export type VolumeSurfaceStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_RECALC'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'SOURCE_NOT_CURRENT'
  | 'NO_OVERLAP';

/** Phase 18I: display-only derived overlap polygon (session-only). */
export interface CadVolumeDisplayRegion {
  kind: 'cut' | 'fill';
  /** Convex polygon ring in world XY (planimetric), deterministic winding. */
  vertices: Array<{ x: number; y: number }>;
}

/** Phase 18I: derived quantity/display payload (session-only, NEVER persisted). */
export interface CadVolumeStats {
  baseTriangleCount?: number;
  comparisonTriangleCount?: number;
  candidatePairCount?: number;
  overlapPairCount?: number;
  overlapPolygonCount?: number;
  cutPolygonCount?: number;
  fillPolygonCount?: number;
  computeMs?: number;
}

export interface CadVolumeResult {
  baseSurfaceId: string;
  comparisonSurfaceId: string;
  /** `vrev1:` revision the result was computed for. */
  revision: string;
  overlapArea: number;
  cutArea: number;
  fillArea: number;
  /** Positive magnitudes (m³ or ft³). */
  cutVolume: number;
  fillVolume: number;
  /** fill − cut (signed earthwork). */
  netVolume: number;
  averageCutDepth: number;
  averageFillDepth: number;
  maxCutDepth: number;
  maxFillDepth: number;
  minDelta: number;
  maxDelta: number;
  baseArea: number;
  comparisonArea: number;
  /** Derived cut/fill polygons; omitted when display was not requested. */
  displayRegions?: CadVolumeDisplayRegion[];
  stats: CadVolumeStats;
}

/**
 * Phase 18J: surface profile definition. Holds ONLY the alignment + surface
 * refs plus display binding; samples, revisions, and statuses are always
 * derived and never serialized.
 */
export interface CadSurfaceProfile {
  id: string;
  name: string;
  alignmentEntityId: CadEntityId;
  surfaceId: string;
  styleId?: string;
  description?: string;
}

/** Phase 18J: profile display styling ONLY (never affects geometry/revision). */
export interface CadProfileStyle {
  id: string;
  name: string;
  color: string;
  lineweight: number;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  opacity: number;
  showVertices?: boolean;
}

/**
 * Phase 18J: profile view presentation object (insertion XY, scales, datum,
 * grid intervals) — NOT thousands of CadEntity primitives. Derived display
 * geometry is session-only and never persisted.
 */
export interface CadProfileView {
  id: string;
  name: string;
  alignmentEntityId: CadEntityId;
  profileIds: string[];
  insertionX: number;
  insertionY: number;
  width?: number;
  height?: number;
  horizontalScale: number;
  verticalExaggeration: number;
  datumElevation?: number;
  datumMode: 'auto' | 'explicit';
  datumStep?: number;
  majorStationInterval?: number;
  minorStationInterval?: number;
  elevationGridInterval?: number;
  styleId?: string;
}

/** Phase 18J: derived profile status (never persisted; never a trusted flag). */
export type SurfaceProfileStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_REBUILD'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'SOURCE_NOT_CURRENT'
  | 'NO_OVERLAP';

// ---------------------------------------------------------------------------
// Phase 18K sample lines / cross sections
// ---------------------------------------------------------------------------

/** One surface a sample-line group extracts from (+ optional display style). */
export interface CadSectionSurfaceSource {
  surfaceId: string;
  sectionStyleId?: string;
}

/**
 * Phase 18K: one straight sample line across an alignment. Stored by RAW
 * chainage (geometry truth) plus widths and skew — display station text is
 * presentation only and NEVER the identity. Skew is degrees clockwise from
 * the alignment-perpendicular (0 = square to the alignment).
 */
export interface CadSampleLine {
  id: string;
  /** Operator override; absent = derived station label. */
  manualName?: string;
  rawStation: number;
  leftWidth: number;
  rightWidth: number;
  skewDeg: number;
}

/**
 * Phase 18K: a drawing-owned sample-line group bound to exactly ONE
 * alignment. Holds source surfaces + ordered sample lines only — no TIN
 * data, no extracted sections, no revisions, no statuses.
 */
export interface CadSampleLineGroup {
  id: string;
  name: string;
  alignmentEntityId: CadEntityId;
  surfaceSources: CadSectionSurfaceSource[];
  sampleLines: CadSampleLine[];
  layerId?: CadLayerId;
  /** Optional pairwise cut/fill area comparison (base vs comparison surface). */
  areaComparison?: { baseSurfaceId: string; comparisonSurfaceId: string };
}

/** Phase 18K: section display styling ONLY (never affects geometry/revision). */
export interface CadSectionStyle {
  id: string;
  name: string;
  color: string;
  lineweight: number;
  /** 0 (opaque) .. 1 (fully transparent). Default 0. */
  opacity: number;
  showVertices?: boolean;
}

/**
 * Phase 18K: section view presentation object (one sample line per view).
 * Unlike CadProfileView this carries an explicit layerId so OFF/FROZEN/LOCK
 * apply per view without a rebuild. Derived display geometry never persists.
 */
export interface CadSectionView {
  id: string;
  name: string;
  sampleLineGroupId: string;
  sampleLineId: string;
  sourceSurfaceIds: string[];
  insertionX: number;
  insertionY: number;
  horizontalScale: number;
  verticalExaggeration: number;
  datumMode: 'auto' | 'explicit';
  datumElevation?: number;
  offsetGridInterval?: number;
  elevationGridInterval?: number;
  showCutFill?: boolean;
  styleId?: string;
  layerId?: CadLayerId;
}

/** Phase 18K: derived section status per sample-line x source (never persisted). */
export type CadSectionStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_REBUILD'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'SOURCE_NOT_CURRENT'
  | 'OUT_OF_RANGE'
  | 'NO_COVERAGE';
