/**
 * STRUCT-241.7 CAD grip/snap type leaf.
 *
 * Type-only module. It owns the six grip/snap contracts extracted verbatim
 * from `cadTypes.ts`:
 *
 * - `CadGripHandleKind` — grip handle kind union (incl. Phase C3
 *   polyline-insert).
 * - `CadGripHandle` — a draggable grip handle.
 * - `CadSnapKind` — the snap kind union.
 * - `CadSnapCandidate` — a computed snap candidate.
 * - `CadSnapLock` — a locked construction snap.
 * - `CadSnapConstructionContext` — construction/snap seed context.
 *
 * Bodies, comments, property order, discriminants, unions, optionality, and
 * whitespace are copied verbatim from `cadTypes.ts`; the only change is that
 * `CadEntityId` and `CadDisplayPoint` now come from their leaves instead of
 * the `cadTypes` hub. The `cadTypes` hub re-exports these declarations to
 * preserve its existing public surface.
 *
 * Contract: type-only imports only, and only from
 * `./cadCorePrimitiveTypes` (`CadEntityId`) and `./cadDisplayTypes`
 * (`CadDisplayPoint`). It must never import `cadTypes`, a barrel, an engine
 * runtime module, or `cadTransactions`, must not cross-import another leaf,
 * and declares no runtime exports.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';
import type { CadDisplayPoint } from './cadDisplayTypes';

export type CadGripHandleKind =
  | 'line-start'
  | 'line-end'
  | 'vertex'
  | 'arc-start'
  | 'arc-end'
  | 'arc-radius'
  | 'circle-center'
  | 'circle-radius'
  | 'insertion'
  /**
   * Phase C3 — secondary hollow grip at one polyline course midpoint. It
   * NEVER moves a vertex: drag-release projects the cursor back onto the
   * ORIGINAL course and dispatches POLYLINE_INSERT_VERTEX, which splits the
   * course in place (count-changing, one undo entry). `courseIndex` is the
   * resolved course the grip belongs to.
   */
  | 'polyline-insert';

export interface CadGripHandle {
  id: string;
  entityId: CadEntityId;
  kind: CadGripHandleKind;
  x: number;
  y: number;
  vertexIndex?: number;
  /** Present on `polyline-insert` grips only: the target course index. */
  courseIndex?: number;
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
  /**
   * World-unit snap tolerance in effect when this candidate was computed (a
   * viewport-scale proxy). Optional and additive — consumers that ignore it
   * are unaffected. The corrected L1 tangent/perp on-source pick uses it to
   * reject a candidate computed at a different viewport scale than the pick
   * (e.g. after a zoom without a pointer move).
   */
  computedScale?: number;
  /**
   * Monotonic viewport transform generation when this candidate was computed
   * (bumped on zoom, pan, extents, and programmatic viewport sets). Optional
   * and additive; the corrected L1 on-source pick rejects a stamped candidate
   * whose generation differs from the live generation.
   */
  viewportGeneration?: number;
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
  /** Phase C2: exact course id of the tangent-seed arc (multi-arc entities). */
  tangentSeedArcSegmentId?: string | null;
  tangentSeedPoint?: CadDisplayPoint | null;
  lockedSnap?: CadSnapLock | null;
}
