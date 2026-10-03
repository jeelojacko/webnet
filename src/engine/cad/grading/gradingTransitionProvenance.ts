/**
 * Phase 20M.2 WAVE G — transition product + provenance (additive).
 *
 * Provenance records policy/law version, width + measure, interval,
 * joint/member identities, family/native refs, transition stations, and
 * admission/agreement metadata. Extract/Bake stay available only when the
 * existing capability/topology rules permit and then truthfully carry the
 * transition geometry/provenance; Design Patch stays unavailable for the
 * open route; FAILED/stale blocks every product.
 *
 * TODO(20M.2 sibling): repoint TransitionPersistedIntent to the canonical
 * `CadGradingTransition` once gradingGroupTypes lands it (persisted-model.md
 * §1); this local shape is intentionally minimal, never a second canonical.
 */
import {
  GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED,
  GRADING_PRODUCT_NOT_CURRENT,
  type GradingProductCapabilities,
  type GradingProductCapability,
} from './gradingProductCapabilities';
import type { TransitionFamily } from './gradingTransitionPolicy';
import type { CadGradingTransition } from './gradingGroupTypes';

/** Canonical persisted transition intent (persisted-model.md §1). */
export type TransitionPersistedIntent = CadGradingTransition;

/** Session provenance for one admitted transition build. */
export interface GroupTransitionProvenance {
  policyVersion: string;
  lawKind: string;
  lawVersion: string;
  /** Explicit total symmetric width W, source-line meters. */
  widthMeters: number;
  widthMeasure: 'source-line';
  /** Joint-local source-line interval [sL, sR], s = 0 at the joint. */
  interval: { sL: number; sR: number };
  jointId: string;
  memberIds: readonly [string, string];
  criterionFamily: TransitionFamily;
  /** Re-resolved native endpoint scalars (evidence, never input). */
  endpointScalars: { vL: number; vR: number; gL: number; gR: number };
  /** Persisted joint station origin. */
  jointStation: number;
  /** `ggrev1:` the evidence was pinned at. */
  recordedRevision: string;
  /** Null when the producing build agreed, else the bounded reject code. */
  agreementCode: string | null;
}

export const buildTransitionProvenance = (input: {
  intent: TransitionPersistedIntent;
  memberIds: readonly [string, string];
  family: TransitionFamily;
  endpointScalars: { vL: number; vR: number; gL: number; gR: number };
  interval: { sL: number; sR: number };
  jointStation: number;
  recordedRevision: string;
  agreementCode: string | null;
}): GroupTransitionProvenance => ({
  policyVersion: input.intent.policyVersion,
  lawKind: input.intent.lawKind,
  lawVersion: input.intent.lawVersion,
  widthMeters: input.intent.width,
  widthMeasure: 'source-line',
  interval: { ...input.interval },
  jointId: input.intent.jointId,
  memberIds: [...input.memberIds] as [string, string],
  criterionFamily: input.family,
  endpointScalars: { ...input.endpointScalars },
  jointStation: input.jointStation,
  recordedRevision: input.recordedRevision,
  agreementCode: input.agreementCode,
});

/** Verbatim bake citation of persisted transition intent (no re-derivation). */
export const transitionBakeCitation = (
  transitions: readonly TransitionPersistedIntent[] | undefined,
): Array<{
  policyVersion: string;
  jointId: string;
  memberIds: readonly string[];
  widthMeters: number;
  widthMeasure: 'source-line';
  lawKind: string;
  lawVersion: string;
  criterionFamily: string;
}> | undefined => {
  if (!Array.isArray(transitions) || transitions.length === 0) return undefined;
  return transitions.map((entry) => ({
    policyVersion: entry.policyVersion,
    jointId: entry.jointId,
    memberIds: [...entry.memberIds],
    widthMeters: entry.width,
    widthMeasure: 'source-line' as const,
    lawKind: entry.lawKind,
    lawVersion: entry.lawVersion,
    criterionFamily: entry.criterionFamily,
  }));
};

export interface TransitionProductStatus {
  /** Group FAILED (bounded agreement/topology code) — blocks everything. */
  failed: boolean;
  /** Result revision no longer matches `ggrev1:` — blocks everything. */
  stale: boolean;
  /** Group definition closed flag (open route keeps Design Patch off). */
  closed: boolean;
}

const blocked = (product: string): GradingProductCapability => ({
  available: false,
  code: GRADING_PRODUCT_NOT_CURRENT,
  notice: `${product} unavailable — the grading result is not CURRENT. Recalculate the grading first.`,
});

/**
 * Layer the transition product rule over the existing capability
 * derivation (caller passes `deriveGradingProductCapabilities` output):
 * FAILED/stale blocks Extract/Bake/Design Patch; the open transition route
 * keeps Design Patch unavailable (never widened); Extract/Bake otherwise
 * ride the existing rules unchanged and carry transition geometry (the
 * daylight interval is transition-owned mesh) plus the bake citation.
 */
export const applyTransitionProductGate = (
  base: GradingProductCapabilities,
  status: TransitionProductStatus,
): GradingProductCapabilities => {
  if (status.failed || status.stale) {
    return {
      extract: blocked('Extract'),
      bake: blocked('Bake'),
      designPatch: base.designPatch === null ? null : blocked('Design Patch'),
    };
  }
  if (status.closed !== true && base.designPatch !== null) {
    return {
      ...base,
      designPatch: {
        available: false,
        code: GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED,
        notice:
          'Design Patch unavailable — only a closed grading group carries an interior pad.',
      },
    };
  }
  return base;
};
