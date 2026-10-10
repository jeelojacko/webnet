/**
 * STRUCT-241.8: extracted TIN provenance/explicit-payload leaf types.
 * The cadTypes.ts hub re-exports these for legacy import paths.
 */

/**
 * Phase 18L LandXML provenance. `kind` is optional on read — legacy
 * payloads omit it and normalize to 'landxml-import' (format 'LandXML').
 * LandXML construction sites keep writing this shape with no `kind`, so
 * revision inputs stay byte-identical.
 */
export interface LandxmlTinProvenance {
  kind?: 'landxml-import';
  format: 'LandXML';
  fileName: string;
  surfaceName: string;
  sourceId?: string;
}

/**
 * Phase 18X bake provenance. Bakes ALWAYS write this shape — never
 * format:'LandXML'. fileName/surfaceName/sourceId are read-tolerance only
 * (optional so shared readers keep compiling); bake writers omit them.
 */
export interface WebnetBakeTinProvenance {
  kind: 'webnet-bake';
  sourceSurfaceId: string;
  sourceSurfaceName: string;
  sourceRevision: string;
  sourceSourceKind?: string;
  fileName?: string;
  surfaceName?: string;
  sourceId?: string;
}

/**
 * Read alias only: early `format:'explicit'` payloads (if encountered)
 * normalize to baked. Never written — writers emit kind:'webnet-bake'.
 */
export interface ExplicitFormatTinProvenance {
  kind?: 'webnet-bake';
  format: 'explicit';
  fileName: string;
  surfaceName: string;
  sourceId?: string;
  sourceSurfaceId?: string;
  sourceSurfaceName?: string;
  sourceRevision?: string;
  sourceSourceKind?: string;
}

/**
 * Phase 18Y compose provenance. Composition ALWAYS writes this shape.
 * fileName/surfaceName/sourceId are read-tolerance only (optional so
 * shared readers keep compiling); compose writers omit them. policy is
 * fixed to 'overlay-coverage-wins' (the only supported ownership rule).
 * resultDigest is the explicitTinTopologyDigest of the composed payload
 * (empty until the payload is built).
 */
export interface WebnetComposeTinProvenance {
  kind: 'webnet-compose';
  baseSurfaceId: string;
  baseSurfaceName: string;
  baseRevision: string;
  overlaySurfaceId: string;
  overlaySurfaceName: string;
  overlayRevision: string;
  policy: 'overlay-coverage-wins';
  resultDigest?: string;
  fileName?: string;
  surfaceName?: string;
  sourceId?: string;
}

/**
 * Phase 20B grading-bake provenance. Bake ALWAYS writes this shape — never
 * LandXML/compose/generic-bake. Informational snapshot (grading id/name/
 * revision, source FL id + A/B vertex ids, target id, accuracy); the baked
 * surface is fully independent post-bake (never auto-composed).
 */
export interface WebnetGradingBakeTinProvenance {
  kind: 'webnet-grading-bake';
  gradingId: string;
  gradingName: string;
  gradingRevision: string;
  sourceFeatureLineId: string;
  sourceVertexAId: string;
  sourceVertexBId: string;
  /** Phase 20F/20G additive termination family; legacy files omit it (surface). */
  targetKind?: 'surface' | 'distance' | 'elevation' | 'relative-elevation';
  /** Surface-family bakes (legacy files always carry this). */
  targetSurfaceId?: string;
  /** Distance-family bakes: the criterion offset (never a derived limit point). */
  criterionDistance?: number;
  /** Elevation-family bakes: the criterion target elevation. */
  targetElevation?: number;
  /** Phase 20G relative-elevation bakes: signed ΔZ from the source profile. */
  relativeElevation?: number;
  accuracy: 'EXACT' | 'CURVE_APPROXIMATED';
  fileName?: string;
  surfaceName?: string;
  sourceId?: string;
}

export interface WebnetGradingDesignPatchTinProvenance {
  kind: 'webnet-grading-design-patch';
  groupId: string;
  groupName: string;
  groupRevision: string;
  sourceFeatureLineId: string;
  sourceCourseRefs: string[];
  /** Phase 20F/20G additive termination family; phase 20H adds `mixed-analytic` for mixed analytic groups; phase 20J adds `hybrid` for surface+analytic groups. Legacy files omit it (surface). */
  targetKind?: 'surface' | 'distance' | 'elevation' | 'relative-elevation' | 'mixed-analytic' | 'hybrid';
  /** Phase 20H: distinct analytic kinds in a mixed-analytic group, canonical order; absent otherwise. */
  analyticKinds?: Array<'distance' | 'elevation' | 'relative-elevation'>;
  /** Phase 20J: distinct termination kinds effectively present in a hybrid group, canonical surface → distance → elevation → relative-elevation order; absent otherwise. */
  terminationKinds?: Array<'surface' | 'distance' | 'elevation' | 'relative-elevation'>;
  /** Surface-family and hybrid patches (legacy files always carry this). */
  targetSurfaceId?: string;
  targetSurfaceRevision?: string;
  /** Distance-family patches: the criterion offset (never a derived limit point). */
  criterionDistance?: number;
  /** Elevation-family patches: the criterion target elevation. */
  targetElevation?: number;
  /** Phase 20G relative-elevation patches: signed ΔZ from the source profile. */
  relativeElevation?: number;
  accuracy: 'EXACT' | 'CURVE_APPROXIMATED';
  cornerMode: 'miter';
  includesInterior: true;
  /** Phase 20E: `flat-source` (bit-flat) or `planar-source` (exactly coplanar). */
  interiorPolicy: 'flat-source' | 'planar-source';
  fileName?: string;
  surfaceName?: string;
  sourceId?: string;
}

/**
 * Phase 20C grading-group bake provenance. Bake ALWAYS writes this shape —
 * never LandXML/compose/generic-bake/single-grading-bake. Informational
 * snapshot (group id/name/revision, source FL id + `A>B` course refs,
 * target id, side, accuracy, corner mode); the baked surface is fully
 * independent post-bake (never auto-composed).
 */
export interface WebnetGradingGroupBakeTinProvenance {
  kind: 'webnet-grading-group-bake';
  groupId: string;
  groupName: string;
  groupRevision: string;
  sourceFeatureLineId: string;
  sourceCourseRefs: string[];
  /** Phase 20F/20G additive termination family; phase 20H adds `mixed-analytic` for mixed analytic groups; phase 20J adds `hybrid` for surface+analytic groups. Legacy files omit it (surface). */
  targetKind?: 'surface' | 'distance' | 'elevation' | 'relative-elevation' | 'mixed-analytic' | 'hybrid';
  /** Phase 20H: distinct analytic kinds in a mixed-analytic group, canonical order; absent otherwise. */
  analyticKinds?: Array<'distance' | 'elevation' | 'relative-elevation'>;
  /** Phase 20J: distinct termination kinds effectively present in a hybrid group, canonical order; absent otherwise. */
  terminationKinds?: Array<'surface' | 'distance' | 'elevation' | 'relative-elevation'>;
  /** Surface-family and hybrid bakes (legacy files always carry this). */
  targetSurfaceId?: string;
  /** Distance-family bakes: the criterion offset (never a derived limit point). */
  criterionDistance?: number;
  /** Elevation-family bakes: the criterion target elevation. */
  targetElevation?: number;
  /** Phase 20G relative-elevation bakes: signed ΔZ from the source profile. */
  relativeElevation?: number;
  side: 'left' | 'right';
  accuracy: 'EXACT' | 'CURVE_APPROXIMATED';
  cornerMode: 'miter';
  fileName?: string;
  surfaceName?: string;
  sourceId?: string;
}

/**
 * Phase 18X discriminated explicit-TIN provenance (read-tolerant,
 * write-strict). Every member carries fileName/surfaceName (required or
 * optional) so shared readers compile without narrowing.
 */
export type CadExplicitTinProvenance =
  | LandxmlTinProvenance
  | WebnetBakeTinProvenance
  | WebnetGradingBakeTinProvenance
  | WebnetGradingGroupBakeTinProvenance
  | WebnetGradingDesignPatchTinProvenance
  | WebnetComposeTinProvenance
  | ExplicitFormatTinProvenance;

/** Legacy alias (read path); new code prefers CadExplicitTinProvenance. */
export type ImportedTinProvenance = CadExplicitTinProvenance;

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

/**
 * Phase 18X: baked explicit-TIN payloads reuse the 18L stored-topology
 * shape verbatim (no new persisted key). Alias only — no rename.
 */
export type ExplicitTinPayload = ImportedTinPayload;
