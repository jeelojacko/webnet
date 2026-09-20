/**
 * Phase 18P — shared annotation placement math (leaders + curve labels).
 *
 * One source of truth for the renderer, spatial bounds and DXF export so the
 * screen, the sheet deliverables and the interchange file never disagree
 * about where a leader's text or a curve label lands.
 *
 * LEADER ATTACHMENT (all 9 points are honored):
 *   - the reference point is the landing endpoint advanced by `textGap` along
 *     the leader departure direction;
 *   - the horizontal component chooses the text anchor (left→start,
 *     center→middle, right→end);
 *   - the vertical component places the block relative to the reference
 *     (top→hangs below, middle→centered, bottom→sits above).
 *   The text stays unrotated, matching the display primitive and DXF TEXT.
 *
 * CURVE LABEL:
 *   - the label sits at the arc's mid-sweep point (signed sweep, so CW and CCW
 *     arcs both get the true visual midpoint);
 *   - the style + entity offsets are applied in world (E/N) coordinates,
 *     mirroring the Properties palette fields;
 *   - rotation is the local tangent at the placement, folded upright by the
 *     shared `uprightRotation` convention (never upside down).
 */
import {
  cadSignedSweepDeg,
  type CadWorldPoint,
} from '../cadGeometry';
import { uprightRotation } from '../cadSurfaceContourView';
import type { CadMTextAttachment } from '../cadTypes';

export type CadTextAnchor = 'start' | 'middle' | 'end';
export type CadTextVertical = 'top' | 'middle' | 'bottom';

/** Unknown/absent attachments fall back to the leader convention `middle-left`. */
export const normalizeTextAttachment = (
  attachment: CadMTextAttachment | undefined,
): CadMTextAttachment => attachment ?? 'middle-left';

export const attachmentTextAnchor = (attachment: CadMTextAttachment): CadTextAnchor =>
  attachment.endsWith('right') ? 'end' : attachment.endsWith('center') ? 'middle' : 'start';

export const attachmentVertical = (attachment: CadMTextAttachment): CadTextVertical =>
  attachment.startsWith('middle') ? 'middle' : attachment.startsWith('bottom') ? 'bottom' : 'top';

/**
 * Reference point of an attachment-anchored text block: the landing endpoint
 * advanced by `textGap` along the leader departure direction.
 */
export const leaderTextReferencePoint = (
  landingEnd: CadWorldPoint,
  direction: CadWorldPoint,
  textGap: number,
): CadWorldPoint => ({
  x: landingEnd.x + direction.x * textGap,
  y: landingEnd.y + direction.y * textGap,
});

/**
 * Per-line y offsets from the reference point (world y-up; rows step DOWN).
 * `top` keeps the first row at the reference, `bottom` keeps the last, and
 * `middle` centers the block. Identical to the DXF row emitter's stacking.
 */
export const attachmentRowOffsets = (
  vertical: CadTextVertical,
  lineCount: number,
  lineHeight: number,
  lineSpacingFactor = 1.2,
): number[] => {
  const step = lineHeight * lineSpacingFactor;
  return Array.from({ length: lineCount }, (_, index) => {
    if (vertical === 'top') return -index * step;
    if (vertical === 'bottom') return (lineCount - 1 - index) * step;
    return ((lineCount - 1) / 2 - index) * step;
  });
};

export interface CurveLabelPlacement {
  x: number;
  y: number;
  /** Upright along-tangent rotation in degrees. */
  rotationDeg: number;
}

/**
 * Deterministic curve label placement at the arc's mid-sweep point. Returns
 * `null` for a non-finite/degenerate radius so callers keep their existing
 * broken-annotation fallback instead of emitting NaN geometry.
 */
export const curveLabelPlacement = (input: {
  center: CadWorldPoint;
  radius: number;
  startAngleDeg: number;
  endAngleDeg: number;
  /** Position offset in world units (style + entity offsets, summed). */
  offset: CadWorldPoint;
}): CurveLabelPlacement | null => {
  const { center, radius, startAngleDeg, endAngleDeg, offset } = input;
  if (!Number.isFinite(radius) || radius <= 1e-12) return null;
  const sweepDeg = cadSignedSweepDeg(startAngleDeg, endAngleDeg);
  const midAngleRad = ((startAngleDeg + sweepDeg / 2) * Math.PI) / 180;
  const cos = Math.cos(midAngleRad);
  const sin = Math.sin(midAngleRad);
  // CCW tangent is the left normal of the radius; CW flips it.
  const tangentDeg = (Math.atan2(sweepDeg >= 0 ? cos : -cos, sweepDeg >= 0 ? -sin : sin) * 180) / Math.PI;
  return {
    x: center.x + cos * radius + offset.x,
    y: center.y + sin * radius + offset.y,
    rotationDeg: uprightRotation(tangentDeg),
  };
};

/** Sum of the label style offset and the entity offset (both world E/N). */
export const sumOffsets = (
  a: CadWorldPoint | undefined,
  b: CadWorldPoint | undefined,
): CadWorldPoint => ({ x: (a?.x ?? 0) + (b?.x ?? 0), y: (a?.y ?? 0) + (b?.y ?? 0) });
