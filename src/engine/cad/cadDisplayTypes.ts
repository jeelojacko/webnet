import type { CadBounds, CadEntityId, CadPointSymbolShape } from './cadTypes';

export interface CadDisplayPoint {
  x: number;
  y: number;
}

export interface CadDisplayPrimitiveBase {
  id: string;
  layerId: string;
  sourceEntityId: CadEntityId;
  sourceSegmentId?: string;
  /** Viewport-only hover text (native SVG title). Phase 18N sets
   *  `Block: <name>` on block-expansion overlay primitives. */
  hoverTitle?: string;
  stroke: string;
  fill?: string;
  opacity?: number;
  strokeDasharray?: string;
  /**
   * Viewport-only dash pattern in drawing units (already × linetypeScale).
   * Converted to screen space at render time via `toScreenDash`; plot
   * export scales it to paper mm, while `strokeDasharray` (preview-only)
   * still passes through untouched.
   */
  dashPatternUnits?: number[];
  /** Drawing-unit phase offset for continuous polyline dashes. */
  dashOffsetUnits?: number;
}

export interface CadDisplayPointPrimitive extends CadDisplayPrimitiveBase {
  kind: 'point';
  point: CadDisplayPoint;
  radius: number;
  /** Phase 18D: effective marker shape. Absent = circle (legacy/unknown). */
  shape?: CadPointSymbolShape;
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
  /**
   * Phase 18F — derived TIN surface layers, passed ALONGSIDE the entity
   * primitives (never as CadLineEntity rows: one node per triangle would
   * collapse the SVG viewport on large TINs). Each layer buckets one
   * surface into at most three SVG nodes (triangles/boundary/vertices).
   * Export scenes ignore this field (surfaces are model-only deliverables).
   */
  surfaceLayers?: CadSurfaceDisplayLayer[];
  /**
   * Phase 18I — derived TIN-to-TIN volume layers (one aggregated CUT path
   * + one FILL path per CURRENT volume, from cached display regions —
   * never CAD entities). Export scenes ignore this field.
   */
  volumeLayers?: import('./cadVolumeView').CadVolumeDisplayLayer[];
  /**
   * Phase 18U — derived analysis band fills + legend presentations. Rendered
   * BEFORE the surface/volume passes so band fills stay under contours/edges
   * (display-only; never CAD entities, never exported geometry).
   */
  analysisLayers?: import('./cadAnalysisDisplayView').CadAnalysisDisplayLayer[];
  analysisLegendLayers?: import('./cadAnalysisDisplayView').AnalysisLegendGeometry[];
  /**
   * Phase 18J — derived profile-view layers (aggregated SVG paths per
   * profile view, from cached CURRENT results — never CAD entities).
   * Export scenes ignore this field.
   */
  profileViewLayers?: import('./cadProfileView').CadProfileViewDisplayLayer[];
  /**
   * Phase 18K — derived sample-line plan layers (one aggregated entry per
   * group; centerline + tick + label per line — never CAD entities).
   * Export scenes ignore this field.
   */
  sampleLineLayers?: import('./cadSectionView').CadSampleLineDisplayLayer[];
  /**
   * Phase 18K — derived section-view layers (grid + traces + shading per
   * view, from cached CURRENT results — never CAD entities).
   * Export scenes ignore this field.
   */
  sectionViewLayers?: import('./cadSectionView').CadSectionViewDisplayLayer[];
}

/** Phase 18H — one derived contour label (viewport-ready, display only). */
export interface CadSurfaceContourLabel {
  elevation: number;
  x: number;
  y: number;
  rotationDeg: number;
  kind: 'minor' | 'major';
  text: string;
}

/** Phase 18F — one viewport-ready bucket per built surface. */
export interface CadSurfaceDisplayLayer {
  surfaceId: string;
  surfaceName: string;
  layerId: string;
  /** Stale (NEEDS_REBUILD/FAILED/BROKEN_REFERENCE): dashed + STALE badge. */
  stale: boolean;
  statusText: string;
  stroke: string;
  opacity: number;
  showTriangles: boolean;
  showVertices: boolean;
  showBoundary: boolean;
  /** Multi-segment path data in drawing units (empty when toggled off). */
  trianglesD: string;
  boundaryD: string;
  vertices: Array<{ x: number; y: number }>;
  verticesTruncated: boolean;
  vertexCount: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /**
   * Phase 18H — derived contours. AGGREGATED: one path string per kind
   * (never per-segment nodes). Empty/absent when the style hides contours
   * or no cached set matches; OFF/FROZEN layers drop the whole layer
   * (see filterCadDisplaySceneForViewport) without recompute.
   */
  showContours?: boolean;
  minorContoursD?: string;
  majorContoursD?: string;
  minorContourStroke?: string;
  majorContourStroke?: string;
  contourLabels?: CadSurfaceContourLabel[];
  /** True when labels were capped for display (geometry stays complete). */
  contourLabelsTruncated?: boolean;
}
