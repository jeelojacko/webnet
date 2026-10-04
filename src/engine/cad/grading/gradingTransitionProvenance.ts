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
import type { CadGradingTransition, CadGradingGroupTransitionLeg } from './gradingGroupTypes';
import type { GradingSide } from './gradingTypes';

/** Canonical persisted transition intent (persisted-model.md §1). */
export type TransitionPersistedIntent = CadGradingTransition;

/** Persisted evidence must agree with its intent; it is never geometric authority. */
export const transitionEvidenceMatchesIntent = (intent: CadGradingTransition, revision: string): boolean => {
  const evidence = intent.provenance;
  if (evidence === undefined) return true;
  return evidence !== null && typeof evidence === 'object' && !Array.isArray(evidence) &&
    evidence.jointId === intent.jointId &&
    Array.isArray(evidence.memberIds) && evidence.memberIds.length === 2 &&
    evidence.memberIds[0] === intent.memberIds[0] && evidence.memberIds[1] === intent.memberIds[1] &&
    evidence.width === intent.width && evidence.lawKind === intent.lawKind &&
    evidence.lawVersion === intent.lawVersion &&
    evidence.criterionFamily === intent.criterionFamily && evidence.side === intent.side &&
    (evidence.revision === undefined || evidence.revision === revision);
};

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
  /** Zero-based joint index (joint:<n>), canonical order across the array. */
  joint: number;
  memberIds: readonly [string, string];
  criterionFamily: TransitionFamily;
  side: GradingSide;
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
  joint: number;
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
  joint: input.joint,
  memberIds: [...input.memberIds] as [string, string],
  criterionFamily: input.family,
  side: input.intent.side,
  endpointScalars: { ...input.endpointScalars },
  jointStation: input.jointStation,
  recordedRevision: input.recordedRevision,
  agreementCode: input.agreementCode,
});

/**
 * Result-owned bake citation: cites the transition ONLY when the baked
 * result actually solved with an admitted transition (the engine sets the
 * leg; a solve without one carries no key and cites nothing). The full
 * provenance envelope — interval, joint station, endpoint scalars,
 * recorded revision, agreement code — rides verbatim, never re-derived.
 */
const citationOfLeg = (
  leg: CadGradingGroupTransitionLeg,
): GroupTransitionProvenance | null => {
  if (
    leg.criterionFamily !== 'distance' &&
    leg.criterionFamily !== 'relative-elevation' &&
    leg.criterionFamily !== 'elevation'
  ) {
    return null;
  }
  return buildTransitionProvenance({
    intent: {
      policyVersion: leg.policyVersion,
      jointId: leg.jointId,
      memberIds: [...leg.memberIds],
      width: leg.width,
      lawKind: leg.lawKind,
      lawVersion: leg.lawVersion,
      criterionFamily: leg.criterionFamily,
      side: leg.side,
    },
    joint: leg.joint,
    memberIds: [leg.memberIds[0], leg.memberIds[1]],
    family: leg.criterionFamily,
    endpointScalars: { ...leg.endpointScalars },
    interval: { ...leg.interval },
    jointStation: leg.jointStation,
    recordedRevision: leg.recordedRevision,
    agreementCode: leg.agreementCode,
  });
};

export const transitionResultBakeCitation = (
  leg: CadGradingGroupTransitionLeg | undefined,
): GroupTransitionProvenance[] | undefined => {
  if (leg === undefined) return undefined;
  const cited = citationOfLeg(leg);
  return cited === null ? undefined : [cited];
};

/**
 * Phase 20N.1 Wave G — per-joint citations in canonical joint order (one
 * entry per result-owned leg). Empty/undefined legs cite nothing (legacy
 * bytes unchanged); a single leg cites exactly like the singular wrapper.
 */
export const transitionResultBakeCitations = (
  legs: readonly CadGradingGroupTransitionLeg[] | undefined,
): GroupTransitionProvenance[] | undefined => {
  if (legs === undefined || legs.length === 0) return undefined;
  const cited: GroupTransitionProvenance[] = [];
  for (const leg of [...legs].sort((a, b) => a.joint - b.joint)) {
    const entry = citationOfLeg(leg);
    if (entry === null) return undefined;
    cited.push(entry);
  }
  return cited;
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
