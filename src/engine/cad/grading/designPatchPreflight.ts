/**
 * Phase 20K.3 Wave E1 — Design Patch pure preflight (engine only).
 *
 * The exact ring -> interior -> mesh -> merge gates `resolveDesignPatch`
 * enforces, factored so the UI capability (`deriveGradingProductCapabilities`)
 * and the command read the same authority: an enabled control always
 * executes (no enabled-null). Pure and project-free: callers supply the
 * ring (or the captured source boundary) plus the CURRENT mesh.
 *
 * Two phases: geometry (ring/interior/mesh agreement) runs first, then the
 * merge. The command runs the certificate gate between them — after the
 * established geometry codes, before any mutation — while the capability
 * uses the full composer. Import direction is one-way (ring/build only);
 * capability and command modules both import this file, never each other.
 */
import {
  mergePadWithGrading,
  resolveDesignPatchInterior,
  type DesignPatchInterior,
  type DesignPatchMesh,
} from './designPatchBuild';
import {
  normalizeCapturedRing,
  validateSourceRing,
  verifyRingAgainstMesh,
} from './designPatchRing';
import type { GradingMesh } from './gradingTypes';

export type DesignPatchPreflightBlockCode =
  | 'DESIGN_PATCH_NON_SIMPLE_RING'
  | 'DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED'
  | 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED'
  | 'DESIGN_PATCH_RING_MESH_MISMATCH'
  | 'DESIGN_PATCH_MERGE_FAILED';

export type DesignPatchPreflightFailure =
  | { ok: false; code: DesignPatchPreflightBlockCode; detail?: string };

export interface DesignPatchPreflightGeometry {
  ok: true;
  interior: DesignPatchInterior;
}

export interface DesignPatchPreflightSuccess {
  ok: true;
  interior: DesignPatchInterior;
  merged: DesignPatchMesh;
}

export type DesignPatchPreflightOutcome = DesignPatchPreflightSuccess | DesignPatchPreflightFailure;

const block = (code: DesignPatchPreflightBlockCode, detail?: string): DesignPatchPreflightFailure =>
  detail === undefined ? { ok: false, code } : { ok: false, code, detail };

/**
 * Ring -> interior -> mesh agreement, in command order and command codes.
 * Flat-or-coplanar runs before the mesh read (a non-planar ring is blocked
 * on its own terms); any other interior failure reads as a non-simple ring,
 * exactly as the command maps it.
 */
export const designPatchPreflightGeometry = (
  ring: readonly number[],
  gradingMesh: GradingMesh,
): DesignPatchPreflightGeometry | DesignPatchPreflightFailure => {
  const valid = validateSourceRing(ring);
  if (!valid.ok) return block('DESIGN_PATCH_NON_SIMPLE_RING', valid.detail);
  const interior = resolveDesignPatchInterior(ring);
  if (!interior.ok) {
    if (interior.code === 'DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED') {
      return block('DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED', interior.detail);
    }
    if (interior.code === 'DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED') {
      return block('DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED', interior.detail);
    }
    return block('DESIGN_PATCH_NON_SIMPLE_RING', interior.detail);
  }
  const verified = verifyRingAgainstMesh(ring, gradingMesh);
  if (!verified.ok) return block('DESIGN_PATCH_RING_MESH_MISMATCH', verified.detail);
  return { ok: true, interior };
};

/** Pad/shell merge with exact-XYZ interning (runs after the cert gate). */
export const designPatchPreflightMerge = (
  interior: DesignPatchInterior,
  gradingMesh: GradingMesh,
  tiedSplitCoords: readonly number[] = [],
): { ok: true; merged: DesignPatchMesh } | DesignPatchPreflightFailure => {
  const merged = mergePadWithGrading(
    interior.pad.padPoints,
    interior.pad.padTriangles,
    gradingMesh,
    tiedSplitCoords,
  );
  if (!merged.ok) return block('DESIGN_PATCH_MERGE_FAILED', merged.detail);
  return { ok: true, merged };
};

/** Full composer for the UI capability: geometry -> merge. */
export const designPatchPreflightForRing = (
  ring: readonly number[],
  gradingMesh: GradingMesh,
  tiedSplitCoords: readonly number[] = [],
): DesignPatchPreflightOutcome => {
  const geometry = designPatchPreflightGeometry(ring, gradingMesh);
  if (!geometry.ok) return geometry;
  const merge = designPatchPreflightMerge(geometry.interior, gradingMesh, tiedSplitCoords);
  if (!merge.ok) return merge;
  return { ok: true, interior: geometry.interior, merged: merge.merged };
};

/**
 * Captured-boundary entry: the capture IS the boundary authority (same
 * normalization the command uses). A missing or malformed capture
 * fail-closes as a non-simple ring — never a silent legacy drift.
 */
export const designPatchPreflightForCaptured = (
  sourceBoundaryPoints: readonly number[] | undefined,
  gradingMesh: GradingMesh,
  tiedSplitCoords: readonly number[] = [],
): DesignPatchPreflightOutcome => {
  if (sourceBoundaryPoints === undefined) {
    return block('DESIGN_PATCH_NON_SIMPLE_RING', 'captured source boundary is missing');
  }
  const ring = normalizeCapturedRing(sourceBoundaryPoints);
  if (!ring) {
    return block('DESIGN_PATCH_NON_SIMPLE_RING', 'captured source boundary is malformed');
  }
  return designPatchPreflightForRing(ring, gradingMesh, tiedSplitCoords);
};
