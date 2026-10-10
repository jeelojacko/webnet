/**
 * STRUCT-241.10: extracted Phase 18F/18L/18S/18X TIN surface definition leaf
 * types. The cadTypes.ts hub re-exports these for legacy import paths.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';
import type { CadSurfaceEdit } from './cadSurfaceEditTypes';
import type { ImportedTinPayload } from './cadTinProvenanceTypes';

export type CadSurfacePointSource =
  /* Multi-group: canonical list is pointGroupIds (added order); pointGroupId
     is the legacy single-source shape, migrated on load. */
  | { kind: 'point-group'; pointGroupIds?: string[]; pointGroupId?: string }
  | { kind: 'points'; pointEntityIds: CadEntityId[] };

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
