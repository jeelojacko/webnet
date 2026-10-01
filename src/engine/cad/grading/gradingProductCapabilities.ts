/**
 * Phase 20K.3 Wave E1 — independent grading product capabilities.
 *
 * Extract, Bake, and Design Patch are three DISTINCT products with distinct
 * representability rules, so availability is derived per product, never as
 * one shared `exportable` boolean:
 *
 *  - EXTRACT emits one continuous boundary Feature Line. A multi-region
 *    (tied/disjoint) mesh collapses its daylight boundary at the tie, so one
 *    Feature Line cannot represent it: Extract is unavailable with a bounded
 *    notice and a stable code (never a silent concat, never enabled-and-null).
 *  - BAKE emits one explicit-TIN surface. The engine materializes arbitrary
 *    validated face sets 1:1 (`materializeExplicitTin`), so multiple valid
 *    components ARE representable: Bake is allowed for a multi-region mesh
 *    that Extract cannot represent. Bake is unavailable only for an empty
 *    (fully tied) mesh or a topology the explicit-TIN model rejects.
 *  - DESIGN PATCH requires one closed connected annular shell (1 component /
 *    2 boundary cycles). A tied multi-region or open shell is unavailable.
 *
 * Every unavailable capability carries a stable `code` and a bounded
 * user-readable `notice`; the snapshot and the product commands share this
 * derivation so an enabled control always executes (no enabled-null).
 */
import { designPatchPreflightForCaptured } from './designPatchPreflight';
import {
  GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE,
  gradingTopologyCertificateProductionError,
} from './gradingTopologyCertificate';
import type { GradingTopologyCertificate } from './gradingTopologyCertificate';
import type { GradingMesh } from './gradingTypes';

export const GRADING_PRODUCT_NOT_CURRENT = 'GRADING_PRODUCT_NOT_CURRENT';
export const GRADING_PRODUCT_EXTRACT_MULTI_REGION = 'GRADING_PRODUCT_EXTRACT_MULTI_REGION';
export const GRADING_PRODUCT_EXTRACT_CERTIFICATE = 'GRADING_PRODUCT_EXTRACT_CERTIFICATE';
export const GRADING_PRODUCT_BAKE_EMPTY = 'GRADING_PRODUCT_BAKE_EMPTY';
export const GRADING_PRODUCT_BAKE_MODEL_LIMIT = 'GRADING_PRODUCT_BAKE_MODEL_LIMIT';
export const GRADING_PRODUCT_BAKE_CERTIFICATE = 'GRADING_PRODUCT_BAKE_CERTIFICATE';
export const GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED = 'GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED';
export const GRADING_PRODUCT_DESIGN_PATCH_NON_ANNULUS = 'GRADING_PRODUCT_DESIGN_PATCH_NON_ANNULUS';
export const GRADING_PRODUCT_DESIGN_PATCH_CERTIFICATE = 'GRADING_PRODUCT_DESIGN_PATCH_CERTIFICATE';
export const GRADING_PRODUCT_DESIGN_PATCH_RING = 'GRADING_PRODUCT_DESIGN_PATCH_RING';
export const GRADING_PRODUCT_DESIGN_PATCH_INTERIOR = 'GRADING_PRODUCT_DESIGN_PATCH_INTERIOR';
export const GRADING_PRODUCT_DESIGN_PATCH_MERGE = 'GRADING_PRODUCT_DESIGN_PATCH_MERGE';

export type GradingProductScope = 'standalone' | 'group';

export interface GradingProductCapability {
  available: boolean;
  /** Stable machine code (diagnostics); null when available. */
  code: string | null;
  /** Bounded user-readable sentence; null when available. */
  notice: string | null;
}

export interface GradingProductCapabilities {
  extract: GradingProductCapability;
  bake: GradingProductCapability;
  /** Group scope only; null for a standalone grading (no interior pad). */
  designPatch: GradingProductCapability | null;
}

export interface GradingProductCapabilityResult {
  topologyCertificate?: GradingTopologyCertificate;
  gradingMesh: GradingMesh;
  sourceBoundaryPoints?: readonly number[];
  daylightPoints: readonly number[];
}

export interface GradingProductCapabilityInput {
  scope: GradingProductScope;
  /** True only while the result is the CURRENT revision (never stale/FAILED). */
  current: boolean;
  result: GradingProductCapabilityResult | null;
  /** Group definition closed flag (design patch interior precondition). */
  closed?: boolean;
}

const available = (): GradingProductCapability => ({ available: true, code: null, notice: null });

const unavailable = (code: string, notice: string): GradingProductCapability => ({
  available: false,
  code,
  notice,
});

const notCurrent = (product: string): GradingProductCapability =>
  unavailable(
    GRADING_PRODUCT_NOT_CURRENT,
    `${product} unavailable — the grading result is not CURRENT. Recalculate the grading first.`,
  );

const certificateNotice = (product: string, error: string): string => {
  if (error === GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE) {
    return `${product} unavailable — the calculated surface has multiple regions and one Feature Line cannot represent a disjoint boundary.`;
  }
  if (error.startsWith('GRADING_TOPOLOGY_CERTIFICATE_TOPOLOGY')) {
    return `${product} unavailable — the engine cannot represent this surface topology as one explicit TIN (${error}).`;
  }
  return `${product} unavailable — the topology certificate rejected the calculated result (${error}).`;
};

const boundaries = (result: GradingProductCapabilityResult) => ({
  sourceBoundaryPoints: result.sourceBoundaryPoints,
  gradingBoundaryPoints: result.daylightPoints,
});

/** Replicates `gradingTopologyCertificateProductError` from a base error. */
const extractError = (
  baseError: string | null,
  certificate: GradingTopologyCertificate | undefined,
): string | null => {
  if (baseError !== null) return baseError;
  return certificate != null && certificate.components > 1
    ? GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE
    : null;
};

const deriveExtract = (
  baseError: string | null,
  result: GradingProductCapabilityResult,
): GradingProductCapability => {
  const error = extractError(baseError, result.topologyCertificate);
  if (error === null) return available();
  if (error === GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE) {
    return unavailable(GRADING_PRODUCT_EXTRACT_MULTI_REGION, certificateNotice('Extract', error));
  }
  return unavailable(GRADING_PRODUCT_EXTRACT_CERTIFICATE, certificateNotice('Extract', error));
};

const deriveBake = (
  baseError: string | null,
  result: GradingProductCapabilityResult,
): GradingProductCapability => {
  if (result.gradingMesh.triangles.length === 0) {
    return unavailable(
      GRADING_PRODUCT_BAKE_EMPTY,
      'Bake unavailable — the calculated surface is fully tied (no triangles to bake).',
    );
  }
  if (baseError === null) return available();
  const modelLimit = baseError.startsWith('GRADING_TOPOLOGY_CERTIFICATE_TOPOLOGY');
  return unavailable(
    modelLimit ? GRADING_PRODUCT_BAKE_MODEL_LIMIT : GRADING_PRODUCT_BAKE_CERTIFICATE,
    certificateNotice('Bake', baseError),
  );
};

const deriveDesignPatch = (
  input: GradingProductCapabilityInput,
  baseError: string | null,
  result: GradingProductCapabilityResult,
): GradingProductCapability => {
  if (input.closed !== true) {
    return unavailable(
      GRADING_PRODUCT_DESIGN_PATCH_NOT_CLOSED,
      'Design Patch unavailable — only a closed grading group carries an interior pad.',
    );
  }
  if (baseError !== null) {
    return unavailable(
      GRADING_PRODUCT_DESIGN_PATCH_CERTIFICATE,
      certificateNotice('Design Patch', baseError),
    );
  }
  const cert = result.topologyCertificate;
  if (cert != null && (cert.components !== 1 || cert.boundaryCycles !== 2)) {
    return unavailable(
      GRADING_PRODUCT_DESIGN_PATCH_NON_ANNULUS,
      'Design Patch unavailable — the grading shell must be one closed annulus (1 component / 2 boundary cycles); a tied multi-region or open shell has no single interior.',
    );
  }
  // Same pure gates the command enforces (ring -> interior -> mesh ->
  // merge): a certified annulus whose source is non-flat/non-planar, whose
  // ring misses the mesh, or whose pad cannot merge is disabled here —
  // never enabled-and-null at execution.
  const preflight = designPatchPreflightForCaptured(
    result.sourceBoundaryPoints,
    result.gradingMesh,
    result.topologyCertificate?.tiedSplitCoords ?? [],
  );
  if (!preflight.ok) return designPatchPreflightUnavailable(preflight.code, preflight.detail);
  return available();
};

const designPatchPreflightUnavailable = (
  code: 'DESIGN_PATCH_NON_SIMPLE_RING' | 'DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED' | 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED' | 'DESIGN_PATCH_RING_MESH_MISMATCH' | 'DESIGN_PATCH_MERGE_FAILED',
  detail?: string,
): GradingProductCapability => {
  const suffix = detail !== undefined ? ` (${detail})` : '';
  if (code === 'DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED' || code === 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED') {
    return unavailable(
      GRADING_PRODUCT_DESIGN_PATCH_INTERIOR,
      `Design Patch unavailable — the closed source boundary is not a flat or planar interior (${code})${suffix}.`,
    );
  }
  if (code === 'DESIGN_PATCH_RING_MESH_MISMATCH') {
    return unavailable(
      GRADING_PRODUCT_DESIGN_PATCH_RING,
      `Design Patch unavailable — the source boundary does not match the calculated mesh (${code})${suffix}.`,
    );
  }
  if (code === 'DESIGN_PATCH_MERGE_FAILED') {
    return unavailable(
      GRADING_PRODUCT_DESIGN_PATCH_MERGE,
      `Design Patch unavailable — the pad interior cannot merge with the calculated shell (${code})${suffix}.`,
    );
  }
  return unavailable(
    GRADING_PRODUCT_DESIGN_PATCH_RING,
    `Design Patch unavailable — the closed source boundary is not a simple ring (${code})${suffix}.`,
  );
};

/**
 * Derive the three capabilities from one CURRENT (or absent) result. The
 * certificate is revalidated ONCE (not once per product) and shared by both
 * snapshots and the product command wrappers, so availability and execution
 * read the same authority without a publish-time performance regression.
 */
export const deriveGradingProductCapabilities = (
  input: GradingProductCapabilityInput,
): GradingProductCapabilities => {
  const result = input.current ? input.result : null;
  if (result == null) {
    return {
      extract: notCurrent('Extract'),
      bake: notCurrent('Bake'),
      designPatch: input.scope === 'group' ? notCurrent('Design Patch') : null,
    };
  }
  const baseError = gradingTopologyCertificateProductionError(
    result.topologyCertificate,
    input.scope,
    result.gradingMesh,
    boundaries(result),
  );
  return {
    extract: deriveExtract(baseError, result),
    bake: deriveBake(baseError, result),
    designPatch: input.scope === 'group' ? deriveDesignPatch(input, baseError, result) : null,
  };
};
