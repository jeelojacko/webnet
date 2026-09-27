/**
 * Phase 20C Wave-1A — shared grading compute types.
 *
 * Snapshot + outcome contracts for the grading kernel, moved verbatim from
 * `src/workers/surfaceGradingCompute.ts` (zero numerical change; types only).
 */
import type {
  CadGradingResult,
  GradingDiagnosticCode,
  ResolvedGradingSource,
} from './gradingTypes';

export interface GradingTargetMeshSnapshot {
  /** Flat [x,y,z,...]. */
  points: number[];
  /** Flat CCW index triples. */
  triangles: number[];
}

export interface GradingComputeSource extends ResolvedGradingSource {
  // ResolvedGradingSource numbers only (start/end XYZ + length + isArc);
  // arc circle params ride along when the resolving course carried them.
}

export type GradingComputeOutcome =
  | { ok: true; result: CadGradingResult }
  | { ok: false; code: GradingDiagnosticCode; detail?: string };

export interface TargetQuery {
  elevationAt: (_x: number, _y: number) => number | null;
  queryCount: number;
}
