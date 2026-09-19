// Phase 18O — annotation UI shell contract.
//
// The shell chrome (ribbon Annotate tab, Toolspace Settings managers,
// Properties blocks) never touches the drawing project directly. The live
// workspace publishes a `CadAnnotationSnapshot` (style tables + the selected
// annotation entity details) and exposes `runAnnotationOp` for every
// mutation. Both are OPTIONAL on the shell contracts: an embedded workspace
// without annotation wiring renders disabled controls, never fake data.
//
// This file is the single source of truth for the shape those two seams
// exchange; it is pure UI-side typing (no engine imports beyond types).

import type {
  CadBearingLabelStyle,
  CadCurveLabelField,
  CadCurveLabelStyle,
  CadDimensionKind,
  CadDimensionStyle,
  CadLeaderStyle,
  CadMTextAttachment,
  CadTextStyle,
} from '../../engine/cad/cadTypes';

/** Style tables the manager + Toolspace expose. Split survey labels stay split. */
export type CadAnnotationStyleTable = 'text' | 'dimension' | 'leader' | 'bearing-label' | 'curve-label';

export type CadAnnotationManagerTab = CadAnnotationStyleTable;

export const CAD_ANNOTATION_MANAGER_TABS: Array<{ id: CadAnnotationStyleTable; label: string }> = [
  { id: 'text', label: 'Text Styles' },
  { id: 'dimension', label: 'Dimension Styles' },
  { id: 'leader', label: 'Leader Styles' },
  { id: 'bearing-label', label: 'Bearing Labels' },
  { id: 'curve-label', label: 'Curve Labels' },
];

/** Per-table reference counts drive the referenced-delete block. */
export interface CadAnnotationReferenceCounts {
  textStyles: Record<string, number>;
  dimensionStyles: Record<string, number>;
  leaderStyles: Record<string, number>;
  bearingLabelStyles: Record<string, number>;
  curveLabelStyles: Record<string, number>;
}

export interface CadAnnotationArrowDefinition {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Selected-entity detail (Properties palette). All values are precomputed by
// the workspace so the palette stays a dumb renderer (no raw JSON, no engine
// geometry re-derivation in React).
// ---------------------------------------------------------------------------

export interface CadMTextSelectionInfo {
  kind: 'mtext';
  entityId: string;
  layerId: string;
  layerName: string;
  text: string;
  textStyleId: string;
  x: number;
  y: number;
  rotationDeg: number;
  attachment: CadMTextAttachment;
}

export interface CadLeaderSelectionInfo {
  kind: 'leader';
  entityId: string;
  layerId: string;
  layerName: string;
  text: string;
  leaderStyleId: string;
  textStyleId: string | null;
  targetStatus: 'attached' | 'broken' | 'fixed';
  targetLabel: string;
  vertices: Array<{ x: number; y: number }>;
}

export interface CadDimensionSelectionInfo {
  kind: 'dimension';
  entityId: string;
  layerId: string;
  layerName: string;
  dimensionKind: CadDimensionKind;
  dimensionStyleId: string;
  /** Read-only measurement rendered from the definition geometry. */
  measuredText: string;
  /** What the drawing currently shows (override wins). */
  displayedText: string;
  textOverride: string | null;
  placement: string;
  sourceText: string;
  broken: boolean;
}

export interface CadSurveyLabelSelectionInfo {
  kind: 'bearing-label' | 'curve-label';
  entityId: string;
  layerId: string;
  layerName: string;
  labelStyleId: string;
  sourceEntityId: string;
  sourceLabel: string;
  statusText: string;
  /** Derived bearing/distance or radius/delta/length/chord rows. */
  derived: Array<{ label: string; value: string }>;
  offset: { x: number; y: number };
  manualTextOverride: string | null;
  broken: boolean;
}

export type CadAnnotationSelectionInfo =
  | CadMTextSelectionInfo
  | CadLeaderSelectionInfo
  | CadDimensionSelectionInfo
  | CadSurveyLabelSelectionInfo;

/** Slow-changing annotation facts published by the workspace. */
export interface CadAnnotationSnapshot {
  annotationScaleDenominator: number;
  textStyles: CadTextStyle[];
  dimensionStyles: CadDimensionStyle[];
  leaderStyles: CadLeaderStyle[];
  bearingLabelStyles: CadBearingLabelStyle[];
  curveLabelStyles: CadCurveLabelStyle[];
  referenceCounts: CadAnnotationReferenceCounts;
  /** Arrowhead block definitions usable by dimension/leader styles. */
  arrowDefinitions: CadAnnotationArrowDefinition[];
  /** Full details for the selected annotation entities (0..n). */
  selected: CadAnnotationSelectionInfo[];
}

// ---------------------------------------------------------------------------
// UI ops. The workspace applies + commits each as one undoable entry.
// ---------------------------------------------------------------------------

/** Patches are narrow per table so the workspace never receives free-form JSON. */
export type CadTextStylePatch = Partial<
  Pick<
    CadTextStyle,
    | 'name'
    | 'fontFamily'
    | 'fontSize'
    | 'heightMode'
    | 'modelHeight'
    | 'paperHeightMm'
    | 'widthFactor'
    | 'lineSpacingFactor'
    | 'fontWeight'
    | 'fontStyle'
  >
>;

export type CadDimensionStylePatch = Partial<Omit<CadDimensionStyle, 'id'>>;
export type CadLeaderStylePatch = Partial<Omit<CadLeaderStyle, 'id'>>;
export type CadBearingLabelStylePatch = Partial<Omit<CadBearingLabelStyle, 'id' | 'offset'>> & {
  offset?: { x: number; y: number };
};
export type CadCurveLabelStylePatch = Partial<Omit<CadCurveLabelStyle, 'id' | 'offset' | 'fields'>> & {
  offset?: { x: number; y: number };
  fields?: CadCurveLabelField[];
};

export type CadAnnotationUiOp =
  | { kind: 'annotation-scale'; scaleDenominator: number }
  | { kind: 'text-style-create'; name: string }
  | { kind: 'text-style-duplicate'; styleId: string }
  | { kind: 'text-style-rename'; styleId: string; name: string }
  | { kind: 'text-style-delete'; styleId: string }
  | { kind: 'text-style-update'; styleId: string; patch: CadTextStylePatch }
  | { kind: 'dimension-style-create'; name: string }
  | { kind: 'dimension-style-duplicate'; styleId: string }
  | { kind: 'dimension-style-rename'; styleId: string; name: string }
  | { kind: 'dimension-style-delete'; styleId: string }
  | { kind: 'dimension-style-update'; styleId: string; patch: CadDimensionStylePatch }
  | { kind: 'leader-style-create'; name: string }
  | { kind: 'leader-style-duplicate'; styleId: string }
  | { kind: 'leader-style-rename'; styleId: string; name: string }
  | { kind: 'leader-style-delete'; styleId: string }
  | { kind: 'leader-style-update'; styleId: string; patch: CadLeaderStylePatch }
  | { kind: 'bearing-label-style-create'; name: string }
  | { kind: 'bearing-label-style-duplicate'; styleId: string }
  | { kind: 'bearing-label-style-rename'; styleId: string; name: string }
  | { kind: 'bearing-label-style-delete'; styleId: string }
  | { kind: 'bearing-label-style-update'; styleId: string; patch: CadBearingLabelStylePatch }
  | { kind: 'curve-label-style-create'; name: string }
  | { kind: 'curve-label-style-duplicate'; styleId: string }
  | { kind: 'curve-label-style-rename'; styleId: string; name: string }
  | { kind: 'curve-label-style-delete'; styleId: string }
  | { kind: 'curve-label-style-update'; styleId: string; patch: CadCurveLabelStylePatch }
  // Entity edits from Properties (MText/Leader/Dimension/survey labels).
  | { kind: 'mtext-update'; entityId: string; patch: Partial<Pick<CadMTextSelectionInfo, 'text' | 'rotationDeg' | 'attachment' | 'textStyleId' | 'x' | 'y'>> & { layerId?: string } }
  | { kind: 'leader-update'; entityId: string; patch: Partial<Pick<CadLeaderSelectionInfo, 'text' | 'leaderStyleId' | 'textStyleId'>> & { layerId?: string; landingLength?: number } }
  | { kind: 'dimension-update'; entityId: string; patch: Partial<Pick<CadDimensionSelectionInfo, 'dimensionStyleId' | 'textOverride'>> & { layerId?: string } }
  | { kind: 'survey-label-update'; entityId: string; patch: Partial<Pick<CadSurveyLabelSelectionInfo, 'labelStyleId' | 'manualTextOverride'>> & { layerId?: string; offset?: { x: number; y: number } } }
  /** Re-resolve the leader arrow anchor against the current drawing. */
  | { kind: 'leader-reattach'; entityId: string }
  /** Freeze the leader anchor at its last resolved point (drop associativity). */
  | { kind: 'leader-convert-fixed'; entityId: string };

export interface CadAnnotationOpResult {
  applied: boolean;
  reason?: string;
}
