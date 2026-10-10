/**
 * STRUCT-195.10 CAD surface source type leaf.
 *
 * Zero-runtime, type-only module. It holds the surface reason-code union and
 * the resolved source-point shape so that `cadSurfaceRevision.ts` and
 * `cadSurfaces.ts` can share them WITHOUT a type-only import cycle.
 *
 * Contract: this file must stay runtime-free and must export ONLY type
 * aliases / interfaces. `cadSurfaces.ts` re-exports every name here so
 * existing `from './cadSurfaces'` consumers keep compiling.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';

export type CadSurfaceReasonCode =
  | 'SURFACE_TOO_FEW_POINTS'
  | 'SURFACE_COLLINEAR_POINTS'
  | 'SURFACE_POINT_MISSING_Z'
  | 'SURFACE_DUPLICATE_XY_CONFLICT'
  | 'SURFACE_BREAKLINE_INVALID'
  | 'SURFACE_BREAKLINE_MISSING_Z'
  | 'SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX'
  | 'SURFACE_BOUNDARY_INVALID'
  | 'SURFACE_VOID_INVALID'
  | 'SURFACE_REFERENCE_MISSING'
  | 'SURFACE_TRIANGULATION_FAILED';

export interface CadSurfaceSourcePoint {
  entityId: CadEntityId;
  x: number;
  y: number;
  z: number;
}
