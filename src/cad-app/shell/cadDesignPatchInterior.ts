/**
 * Phase 20E Wave-2A — Design Patch interior badge (inquiry-only, SHELL/UI ONLY).
 *
 * Flat (pad Z) | Planar (derived slope/percent/angle + downslope aspect) |
 * Undefined (blocked with the engine code). The plane is re-derived from the
 * captured source boundary; nothing is persisted or transformed here.
 */
import { checkFlatRing } from '../../engine/cad/grading/designPatchRing';
import { deriveDesignPatchPlane, designPatchPlaneSlope } from '../../engine/cad/grading/designPatchPlane';

export const designPatchInteriorText = (boundary: readonly number[] | undefined): string => {
  if (!boundary) return '— (Calculate the group first)';
  const flat = checkFlatRing(boundary);
  if (flat.ok) return `Flat (z = ${flat.padZ.toFixed(3)} m)`;
  const plane = deriveDesignPatchPlane(boundary);
  if (!plane.ok) return `Undefined — blocked (${plane.code})`;
  const slope = designPatchPlaneSlope(plane);
  const aspect = slope.downslopeAspectDeg == null ? 'level' : `${slope.downslopeAspectDeg.toFixed(1)}°`;
  return `Planar (slope ${slope.slopePercent.toFixed(3)}% · ${slope.slopeAngleDeg.toFixed(3)}° · aspect ${aspect})`;
};
