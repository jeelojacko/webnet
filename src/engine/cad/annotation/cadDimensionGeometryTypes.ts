/**
 * Phase 18O — public contract for the pure dimension geometry resolver.
 *
 * Kept separate from `cadDimensionGeometry.ts` so the resolver file stays
 * focused on geometry; re-exported from there for single-path imports.
 */
import type { CadWorldPoint } from '../cadGeometry';

export type CadDimensionGeometryPoint = CadWorldPoint;

export type CadDimensionKind =
  | 'linear-horizontal'
  | 'linear-vertical'
  | 'aligned'
  | 'angular'
  | 'radius'
  | 'diameter';

export interface CadDimensionGeometryInput {
  kind: CadDimensionKind;
  /** Measured points for the linear/aligned kinds (angular/radial ray fallback). */
  p1: CadDimensionGeometryPoint;
  p2: CadDimensionGeometryPoint;
  /** Angular: angle vertex; `ray1Point`/`ray2Point` default to p1/p2. */
  vertex?: CadDimensionGeometryPoint;
  ray1Point?: CadDimensionGeometryPoint;
  ray2Point?: CadDimensionGeometryPoint;
  /** Radial: circle center; `radius` is the measured radius; `arcPoint` aims the leader. */
  center?: CadDimensionGeometryPoint;
  radius?: number;
  arcPoint?: CadDimensionGeometryPoint;
  /** Point the dimension line passes through. */
  dimLinePoint: CadDimensionGeometryPoint;
  /**
   * Manual text location in absolute model coordinates. When present the
   * measurement still comes from the definition geometry, but the text is
   * placed exactly here and the automatic inside/outside fit is skipped.
   */
  textPoint?: CadDimensionGeometryPoint;
  textGap: number;
  arrowSize: number;
  extensionOffset: number;
  extensionOvershoot: number;
  /** Used only for the documented `chars * 0.6 * textHeight` width estimate. */
  textHeight: number;
  decimalPrecision: number;
  prefix?: string;
  suffix?: string;
}

export interface CadDimensionGeometrySegment {
  from: CadDimensionGeometryPoint;
  to: CadDimensionGeometryPoint;
}

/** Arrowhead placement matching the `cadAnnotationArrowheads` block convention. */
export interface CadDimensionArrowTransform {
  x: number;
  y: number;
  rotationDeg: number;
  size: number;
}

export interface CadDimensionGeometryBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type CadDimensionTextSide = 'inside' | 'outside' | 'manual';

export interface CadDimensionGeometry {
  /** Kind-specific measured value: model length, interior angle (deg), or radius. */
  measurement: number;
  formattedText: string;
  extensionSegments: CadDimensionGeometrySegment[];
  dimensionSegments: CadDimensionGeometrySegment[];
  arrowTransforms: CadDimensionArrowTransform[];
  textPosition: CadDimensionGeometryPoint;
  textRotationDeg: number;
  textSide: CadDimensionTextSide;
  bounds: CadDimensionGeometryBounds;
  status: 'ok';
}
