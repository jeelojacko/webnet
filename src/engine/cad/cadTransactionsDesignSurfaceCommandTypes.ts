/**
 * STRUCT-241.12 CAD design-surface command payload type leaf.
 *
 * Type-only module. It owns the five Phase 20D design-surface workflow command
 * payload variants (SURFPURPOSE (1), DESIGNSURFACE (2), DESIGNAPPLY (3),
 * DESIGNVOLUME (4), DESIGNPATCH (5)) extracted verbatim (key literals, field
 * names, optionality, property order, and comments unchanged) from the
 * `CadCommand` union in `cadTransactions.types.ts`.
 *
 * Position: the group sits immediately after the Phase 20C grading-group
 * command payload and immediately before the Phase C3 polyline vertex topology
 * group, so the hub can splice `CadDesignSurfaceCommandPayload` back into that
 * exact slot. This shrinks the hub without changing the command contract;
 * these inline members were not a separate dependency cycle, so no SCC
 * reduction is claimed.
 *
 * Contract: type-only imports only. It imports the primitive identity alias
 * from the zero-import core leaf, the surface-purpose enum from the surface
 * model/style leaf, and the grading-group result snapshot from the grading
 * group types leaf. It must never import a value, a command definition, a
 * runtime service, `cadTransactions.ts`, `cadTransactions.types.ts`, or any
 * barrel that cycles back, and it declares no runtime exports.
 */

import type { CadLayerId } from './cadCorePrimitiveTypes';
import type { CadSurfacePurpose } from './cadSurfaceModelStyleTypes';
import type { CadGradingGroupResult } from './grading/gradingGroupTypes';

export type CadDesignSurfaceCommandPayload =
  // Phase 20D Wave-1A — design surface workflow (engine only).
  | {
      key: 'SURFPURPOSE';
      surfaceId: string;
      /** Explicit role; null/undefined clears back to legacy neutral. */
      purpose?: CadSurfacePurpose | null;
    }
  | {
      key: 'DESIGNSURFACE';
      sourceSurfaceId: string;
      name: string;
      /** Current source revision; a stale value rejects the copy. */
      expectedRevision: string;
      /** Session-owned CURRENT assertion (see SURFBAKE). */
      sessionCurrent?: boolean;
      layerId?: CadLayerId;
      /** Undefined = keep the source style; null = clear. */
      styleId?: string | null;
    }
  | {
      key: 'DESIGNAPPLY';
      /** Design target (keeps id/name/layer/style/purpose; never existing-ground). */
      targetSurfaceId: string;
      /** Current target revision; a stale value rejects the apply. */
      targetExpectedRevision: string;
      /** Patch source (contributes topology only; byte-identical). */
      patchSurfaceId: string;
      /** Current patch revision; a stale value rejects the apply. */
      patchExpectedRevision: string;
      /** Session-owned CURRENT assertion (see SURFBAKE). */
      sessionCurrent?: boolean;
    }
  | {
      key: 'DESIGNVOLUME';
      baseSurfaceId: string;
      comparisonSurfaceId: string;
      name?: string;
      layerId?: CadLayerId;
      styleId?: string;
    }
  | {
      key: 'DESIGNPATCH';
      groupId: string;
      /** Cached CURRENT result snapshot (never recomputed here). */
      result: CadGradingGroupResult;
      expectedRevision: string;
      sessionCurrent?: boolean;
      name?: string;
      layerId?: CadLayerId;
      /** Undefined = keep the group style; null = clear. */
      styleId?: string | null;
    };
