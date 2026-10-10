import type { CadAnnotationSettings } from './annotation/cadAnnotationSettings';
import type { CadAnalysisLegend, CadAnalysisMap, CadAnalysisStatus } from './cadAnalysisTypes';
// Phase 18U: re-export the analysis tables so project-level consumers can
// import them from the same module as the rest of the CadProject surface.
export type { CadAnalysisLegend, CadAnalysisMap, CadAnalysisStatus };
import type { ParseOptions, StationErrorEllipse, StationId, UnitsMode } from '../../types';
import type { FieldToFinishSettings } from '../fieldToFinish/catalogIo';
import type { FeatureCodeCatalog } from '../fieldToFinish/featureCatalog';
import type { FieldToFinishLink } from '../fieldToFinish/fieldToFinishLinkTypes';
import type { CadCogoComputation } from './cadCogoRecordTypes';
import type { CadGrading } from './grading/gradingTypes';
import type { CadGradingGroup } from './grading/gradingGroupTypes';
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

// STRUCT-195.2: the shared CAD primitive identities plus `CadBounds`,
// `CadLayer`, and `CadPointSymbolShape` live in an import-free type leaf.
// They are imported here for local use and re-exported so existing
// `from './cadTypes'` consumers keep compiling unchanged.
import type {
  CadBounds,
  CadEntityId,
  CadLayer,
  CadLayerId,
  CadLineTypeId,
  CadPointSymbolId,
  CadPointSymbolShape,
  CadStyleId,
} from './cadCorePrimitiveTypes';
export type {
  CadBounds,
  CadEntityId,
  CadLayer,
  CadLayerId,
  CadLineTypeId,
  CadPointSymbolId,
  CadPointSymbolShape,
  CadStyleId,
  CadTextStyleId,
} from './cadCorePrimitiveTypes';

// STRUCT-241.3: the eight entity-foundation / appearance / style contracts
// and the nine survey-presentation / point-group contracts live in dedicated
// type-only leaves. They are imported here for local use and re-exported so
// existing `from './cadTypes'` consumers keep compiling unchanged.
import type {
  CadBaseEntity,
  CadEntityAppearance,
  CadLineType,
  CadPointSymbol,
  CadStyle,
  CadStyleLibrary,
  CadTextHeightMode,
  CadTextStyle,
} from './cadEntityFoundationTypes';
export type {
  CadBaseEntity,
  CadEntityAppearance,
  CadLineType,
  CadPointSymbol,
  CadStyle,
  CadStyleLibrary,
  CadTextHeightMode,
  CadTextStyle,
} from './cadEntityFoundationTypes';
import type {
  CadPointGroup,
  CadPointGroupId,
  CadPointGroupQuery,
  CadPointLabelBinding,
  CadPointLabelComponent,
  CadPointLabelStyle,
  CadPointLabelStyleId,
  CadPointStyle,
  CadPointStyleId,
} from './cadSurveyPresentationTypes';
export type {
  CadPointGroup,
  CadPointGroupId,
  CadPointGroupQuery,
  CadPointLabelBinding,
  CadPointLabelComponent,
  CadPointLabelStyle,
  CadPointLabelStyleId,
  CadPointStyle,
  CadPointStyleId,
} from './cadSurveyPresentationTypes';

// STRUCT-241.4: the eight primitive CAD geometry entity contracts live in a
// dedicated type-only leaf. They are imported here for local use and
// re-exported so existing `from './cadTypes'` consumers keep compiling
// unchanged.
import type {
  CadArcEntity,
  CadCircleEntity,
  CadLineEntity,
  CadParabolaEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from './cadPrimitiveGeometryEntityTypes';
export type {
  CadArcEntity,
  CadCircleEntity,
  CadLineEntity,
  CadParabolaEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from './cadPrimitiveGeometryEntityTypes';

// STRUCT-241.5: the twelve Phase 18O professional annotation entity/style
// contracts and the seven Phase 19A survey-table contracts live in dedicated
// type-only leaves. They are imported here for local use and re-exported so
// existing `from './cadTypes'` consumers keep compiling unchanged.
import type {
  CadBearingDistanceLabelEntity,
  CadBearingLabelStyle,
  CadCurveLabelEntity,
  CadCurveLabelField,
  CadCurveLabelStyle,
  CadDimensionEntity,
  CadDimensionKind,
  CadDimensionStyle,
  CadLeaderEntity,
  CadLeaderStyle,
  CadMTextAttachment,
  CadMTextEntity,
} from './cadAnnotationEntityStyleTypes';
export type {
  CadBearingDistanceLabelEntity,
  CadBearingLabelStyle,
  CadCurveLabelEntity,
  CadCurveLabelField,
  CadCurveLabelStyle,
  CadDimensionEntity,
  CadDimensionKind,
  CadDimensionStyle,
  CadLeaderEntity,
  CadLeaderStyle,
  CadMTextAttachment,
  CadMTextEntity,
} from './cadAnnotationEntityStyleTypes';
import type {
  CadSurveyTableColumnOverride,
  CadSurveyTableEntity,
  CadSurveyTableKind,
  CadSurveyTableRow,
  CadSurveyTableRowSource,
  CadSurveyTableStyle,
  CadSurveyTableTagSettings,
} from './cadSurveyTableEntityTypes';
export type {
  CadSurveyTableColumnOverride,
  CadSurveyTableEntity,
  CadSurveyTableKind,
  CadSurveyTableRow,
  CadSurveyTableRowSource,
  CadSurveyTableStyle,
  CadSurveyTableTagSettings,
} from './cadSurveyTableEntityTypes';

// STRUCT-241.6: the six linear-design (alignment + feature-line) contracts
// and the six parcel entity contracts live in dedicated type-only leaves.
// They are imported here for local use and re-exported so existing
// `from './cadTypes'` consumers keep compiling unchanged.
import type {
  CadAlignmentElement,
  CadAlignmentEntity,
  CadFeatureLineEntity,
  CadFeatureLineSegmentGeometry,
  CadFeatureLineVertex,
  CadStationEquation,
} from './cadLinearDesignEntityTypes';
export type {
  CadAlignmentElement,
  CadAlignmentEntity,
  CadFeatureLineEntity,
  CadFeatureLineSegmentGeometry,
  CadFeatureLineVertex,
  CadStationEquation,
} from './cadLinearDesignEntityTypes';
import type {
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadParcelPlanInfo,
  CadParcelPlanRole,
  CadParcelSharedBoundary,
  CadParcelSharedBoundaryEnd,
} from './cadParcelEntityTypes';
export type {
  CadParcelCourseGeometry,
  CadParcelEntity,
  CadParcelPlanInfo,
  CadParcelPlanRole,
  CadParcelSharedBoundary,
  CadParcelSharedBoundaryEnd,
} from './cadParcelEntityTypes';

// STRUCT-241.7: the five parcel-layout contracts and the six grip/snap
// contracts live in dedicated type-only leaves. They are imported here for
// local use and re-exported so existing `from './cadTypes'` consumers keep
// compiling unchanged.
import type {
  CadParcelLayoutAutomaticMode,
  CadParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings,
  CadParcelLayoutSolutionPreference,
  CadParcelLayoutUiState,
} from './cadParcelLayoutTypes';
export type {
  CadParcelLayoutAutomaticMode,
  CadParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings,
  CadParcelLayoutSolutionPreference,
  CadParcelLayoutUiState,
} from './cadParcelLayoutTypes';
import type {
  CadGripHandle,
  CadGripHandleKind,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
  CadSnapLock,
} from './cadGripSnapTypes';
export type {
  CadGripHandle,
  CadGripHandleKind,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
  CadSnapLock,
} from './cadGripSnapTypes';
// STRUCT-241.8: the eleven TIN provenance/explicit-payload contracts and the
// fourteen surface-edit contracts live in dedicated type-only leaves. They are
// imported here for local use and re-exported so existing `from './cadTypes'`
// consumers keep compiling unchanged.
import type {
  CadExplicitTinProvenance,
  ExplicitFormatTinProvenance,
  ExplicitTinPayload,
  ImportedTinPayload,
  ImportedTinProvenance,
  LandxmlTinProvenance,
  WebnetBakeTinProvenance,
  WebnetComposeTinProvenance,
  WebnetGradingBakeTinProvenance,
  WebnetGradingDesignPatchTinProvenance,
  WebnetGradingGroupBakeTinProvenance,
} from './cadTinProvenanceTypes';
export type {
  CadExplicitTinProvenance,
  ExplicitFormatTinProvenance,
  ExplicitTinPayload,
  ImportedTinPayload,
  ImportedTinProvenance,
  LandxmlTinProvenance,
  WebnetBakeTinProvenance,
  WebnetComposeTinProvenance,
  WebnetGradingBakeTinProvenance,
  WebnetGradingDesignPatchTinProvenance,
  WebnetGradingGroupBakeTinProvenance,
} from './cadTinProvenanceTypes';
import type {
  CadSurfaceAddLineEdit,
  CadSurfaceAddPointEdit,
  CadSurfaceDeleteLineEdit,
  CadSurfaceDeletePointEdit,
  CadSurfaceEdgeRef,
  CadSurfaceEdit,
  CadSurfaceMovePointEdit,
  CadSurfaceMoveVerticesEdit,
  CadSurfaceRaiseLowerEdit,
  CadSurfaceRaiseLowerVerticesEdit,
  CadSurfaceSetElevationEdit,
  CadSurfaceSetElevationsEdit,
  CadSurfaceSwapEdgeEdit,
  CadSurfaceVertexRef,
} from './cadSurfaceEditTypes';
export type {
  CadSurfaceAddLineEdit,
  CadSurfaceAddPointEdit,
  CadSurfaceDeleteLineEdit,
  CadSurfaceDeletePointEdit,
  CadSurfaceEdgeRef,
  CadSurfaceEdit,
  CadSurfaceMovePointEdit,
  CadSurfaceMoveVerticesEdit,
  CadSurfaceRaiseLowerEdit,
  CadSurfaceRaiseLowerVerticesEdit,
  CadSurfaceSetElevationEdit,
  CadSurfaceSetElevationsEdit,
  CadSurfaceSwapEdgeEdit,
  CadSurfaceVertexRef,
} from './cadSurfaceEditTypes';

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
  | CadCircleEntity
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

export type CadEntity =
  | CadSurveyTableEntity
  | CadSurveyPointEntity
  | CadLineEntity
  | CadPolylineEntity
  | CadArcEntity
  | CadCircleEntity
  | CadAlignmentEntity
  | CadPolygonEntity
  | CadParcelEntity
  | CadTextEntity
  | CadErrorEllipseEntity
  | CadParabolaEntity
  | CadBlockReferenceEntity
  | CadMTextEntity
  | CadLeaderEntity
  | CadDimensionEntity
  | CadBearingDistanceLabelEntity
  | CadCurveLabelEntity
  | CadFeatureLineEntity;

/**
 * CAD Draw Phase L1: explicit drawing coordinate/grid context, threaded from
 * the authoritative app/source coordinate context (never inferred, never
 * rewritten as a side effect). Used only by survey-coordinate entry
 * (GRID_NE / LATLONG): when absent the drawing has no authoritative CRS/grid
 * context and those resolvers fail closed.
 *
 * Ownership/lifecycle: written once by the session/handoff when a drawing is
 * created from a source with a resolved CRS; read-only inside the engine.
 * No command mutates it. Absent (legacy drawings) is fully supported.
 */
export interface CadCoordinateContext {
  /** Authoritative CRS catalog id; null/absent means no grid context. */
  crsId: string | null;
  /** Human-readable CRS label (provenance/prompting only; never transformed). */
  crsLabel?: string | null;
}

export interface CadProjectMetadata {
  source: 'adjustment-result' | 'parsed-input';
  runMode: ParseOptions['runMode'] | 'unknown';
  units: UnitsMode;
  stationCount: number;
  observationCount: number;
  adjustedStationCount: number;
  /** Phase 13E A1: optional F2F source link (absent = legacy/UNLINKED). */
  fieldToFinishLink?: FieldToFinishLink;
  /** CAD Draw Phase L1 drawing grid context (see CadCoordinateContext). */
  coordinateContext?: CadCoordinateContext;
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
  /**
   * Phase 18U drawing-owned analysis maps (band definitions only; measured
   * areas/percentages/volumes and derived fills never persist).
   * Trailing: clone/migrate keep analysis tables last — project signatures
   * are key-order-sensitive JSON.stringify.
   */
  analysisMaps?: CadAnalysisMap[];
  /** Phase 18U drawing-owned analysis legends (presentation only). */
  analysisLegends?: CadAnalysisLegend[];
  /**
   * Phase 19A drawing-owned survey table display styles (display only).
   * Trailing: clone/migrate keep the table last — project signatures are
   * key-order-sensitive JSON.stringify.
   */
  surveyTableStyles?: CadSurveyTableStyle[];
  /** Phase 19A current survey table style id (UI default; absent = first). */
  currentSurveyTableStyleId?: CadStyleId;
  /**
   * Phase 19D: drawing-owned parcel shared-boundary relationships (refs
   * only; all geometry/lengths derived at resolve time). Optional so
   * legacy files open; load paths backfill []. Trailing key.
   */
  sharedParcelBoundaries?: CadParcelSharedBoundary[];
  /**
   * Phase 20B: drawing-owned grade-to-surface definitions (definition
   * refs + criterion only; derived daylight/mesh/status never persist).
   * Optional so legacy files open; load paths backfill []. Trailing key.
   */
  gradings?: CadGrading[];
  /**
   * Phase 20C: drawing-owned grading-group definitions (ordered course
   * chain + shared criterion; derived daylight/mesh/corners/status never
   * persist). Optional so legacy files open; load paths backfill [].
   * Trails `gradings` (key-order rule).
   */
  gradingGroups?: CadGradingGroup[];
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

export interface MlightcadSpikeLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: string;
}

export interface MlightcadSpikeEntity {
  objectId: string;
  type: 'AcDbPoint' | 'AcDbLine' | 'AcDbPolyline' | 'AcDbArc' | 'AcDbCircle' | 'AcDbText' | 'AcDbEllipse';
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
  /**
   * Phase 20A: max plan deviation (metres) when linearizing feature-line
   * arc courses into breakline segments. Effective value is always finite
   * and positive (absent/invalid reads as 0.001); it joins the source
   * revision so a tolerance change rebuilds. Never touches TIN numerics.
   */
  breaklineChordTolerance?: number;
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
   * Phase 18X: 'explicit-tin' = baked explicit topology (same importedTin
   * payload shape, provenance format 'explicit'). No new persisted key.
   */
  sourceKind?: 'native' | 'imported-tin' | 'explicit-tin';
  importedTin?: ImportedTinPayload;
}

/**
 * Phase 18X fail-closed explicit-topology predicate: any non-native
 * definition carrying a stored payload takes the explicit leg (covers both
 * 'imported-tin' and 'explicit-tin'). Unknown future kinds with a payload
 * also route here — never silently misclassified as native.
 */
export const isExplicitTopologyDefinition = (
  definition: Pick<CadSurfaceDefinition, 'sourceKind' | 'importedTin'> | undefined,
): boolean =>
  definition?.importedTin != null && definition.sourceKind !== 'native';

/** Capability alias (pure): definition carries baked/imported stored topology. */
export const isExplicitSurfaceDefinition = isExplicitTopologyDefinition;

/**
 * Phase 18X pure capability: true for entity-derived definitions (absent or
 * 'native'). Native source-definition mutations are allowed only here;
 * every explicit-topology kind is rejected by a single helper.
 */
export const isNativeSurfaceDefinition = (
  definition: Pick<CadSurfaceDefinition, 'sourceKind' | 'importedTin'> | undefined,
): boolean =>
  definition == null || definition.sourceKind == null || definition.sourceKind === 'native';

/**
 * Deprecated 18X alias of {@link isExplicitTopologyDefinition} (kept one
 * phase so 18L call sites keep compiling; migrate to the explicit predicate).
 */
export const isImportedTinDefinition = isExplicitTopologyDefinition;


export type CadSurfaceStatus =
  | 'UNBUILT'
  | 'CURRENT'
  | 'NEEDS_REBUILD'
  | 'BUILDING'
  | 'FAILED'
  | 'BROKEN_REFERENCE'
  | 'INSUFFICIENT_DATA';

export type CadSurfacePurpose =
  | 'existing-ground'
  | 'design'
  | 'design-patch'
  | 'reference'
  | 'other';

export interface CadSurface {
  id: string;
  name: string;
  definition: CadSurfaceDefinition;
  /**
   * Phase 20D workflow role (Existing Ground vs Design vs patch vs reference).
   * Operator-authored metadata ONLY — never inferred, never geometry: excluded
   * from the geometry revision by construction (revision hashes the definition).
   * Absent = legacy neutral surface.
   */
  purpose?: CadSurfacePurpose;
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
