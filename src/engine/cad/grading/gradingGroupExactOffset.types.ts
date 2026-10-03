/**
 * Phase 20L.2 — exact-offset group builder types (production, R0 whole-route only).
 *
 * Session-only result extensions: `curveGeometryMode` provenance and the
 * per-corner built join `exactOffsetJoinXyz` ride the result only — never
 * persisted, never hashed into `ggrev1:`, no schema change, no toggle.
 */
import type {
  CadGradingGroupResult,
  GroupCornerResult,
} from './gradingGroupTypes';
import type {
  GradingCriterion,
  GradingSide,
  ResolvedGradingSource,
} from './gradingTypes';

/** Open-route exact-offset attempt input (closed groups never route exact). */
export interface ExactOffsetGroupInput {
  groupId: string;
  revision: string;
  /** Ordered persisted traversal, A->B oriented (exact-shared joints). */
  members: ResolvedGradingSource[];
  side: GradingSide;
  criterion: GradingCriterion;
  /** Per-member effective criterion in traversal order (absent = shared). */
  memberCriteria?: GradingCriterion[];
  maxSearchDistance: number;
  curveChordTolerance: number;
}

/**
 * Per-corner built node. `tiePointXyz` is deliberately omitted on the exact
 * route (never overload it with the join) — the built node is always the
 * admitted offset join J, carried here; the analytic tie stays provenance
 * in `miterRay`/`miterExtent` only.
 */
export interface ExactOffsetGroupCorner extends GroupCornerResult {
  /** Built offset join J as a flat XYZ triplet (session-only). */
  exactOffsetJoinXyz?: [number, number, number];
}

/** Exact-route result: the production shape plus session-only provenance. */
export interface ExactOffsetGroupResult extends CadGradingGroupResult {
  /** Always EXACT_OFFSET_RADIUS on this path (session-only, never persisted). */
  curveGeometryMode?: 'EXACT_OFFSET_RADIUS';
  corners: ExactOffsetGroupCorner[];
}

export type ExactOffsetAttempt =
  | { kind: 'exact'; result: ExactOffsetGroupResult; d: number }
  | { kind: 'fallback'; reason: string; detail?: string };
