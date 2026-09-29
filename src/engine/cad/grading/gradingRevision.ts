/**
 * Phase 20B — grading content revision (`grev1:`).
 *
 * Covers everything a grading result depends on: source identity +
 * oriented course geometry, target surface revision, side, criterion, and
 * search/chord parameters. The resolved source is already oriented A->B,
 * so a storage-level reversal with identical geometry hashes identically
 * (no spurious NEEDS_RECALC). Numbers use fixed 1e-9 quantization so
 * float noise below the engineering floor cannot flip the revision.
 */
import { fnv1a } from '../cadRevisionHash';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from './gradingTypes';

export interface GradingRevisionInput {
  sourceFeatureLineId: string;
  vertexAId: string;
  vertexBId: string;
  resolvedSource: ResolvedGradingSource;
  /** Omitted for target-free (analytic) criteria — hashes as `tgt:none`. */
  targetSurfaceId?: string;
  /** Omitted for target-free (analytic) criteria — hashes as `tgt:none`. */
  targetRevision?: string;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  curveChordTolerance: number;
}

/** Fixed-precision canonical number: 1nm quantization, -0 normalized. */
export const canonicalGradingNum = (value: number): string => {
  if (!Number.isFinite(value)) return 'non-finite';
  const q = Math.round(value * 1e9) / 1e9;
  if (Object.is(q, -0) || q === 0) return '0';
  return String(q);
};

const criterionText = (criterion: GradingCriterion): string => {
  if (criterion.kind === 'cut-fill') {
    return `cut-fill:${canonicalGradingNum(criterion.cutGradeRatio)}/${canonicalGradingNum(criterion.fillGradeRatio)}`;
  }
  if (criterion.kind === 'distance') {
    return `distance:${canonicalGradingNum(criterion.gradeRatio)}/${canonicalGradingNum(criterion.distance)}`;
  }
  if (criterion.kind === 'elevation') {
    return `elevation:${canonicalGradingNum(criterion.gradeRatio)}/${canonicalGradingNum(criterion.targetElevation)}`;
  }
  return `fixed:${canonicalGradingNum(criterion.gradeRatio)}`;
};

/** Target leg: `tgt:none` when the criterion carries no target. */
const targetText = (input: GradingRevisionInput): string =>
  input.targetSurfaceId === undefined || input.targetRevision === undefined
    ? 'tgt:none'
    : `tgt:${input.targetSurfaceId}@${input.targetRevision}`;

// Arc circle params join the revision when present (a bulge edit moves the
// arc under identical endpoints, so it must move the revision). Straight and
// legacy arc sources hash exactly as before (no trailing field when absent).
const sourceText = (src: ResolvedGradingSource): string => {
  const base = [
    canonicalGradingNum(src.startX),
    canonicalGradingNum(src.startY),
    canonicalGradingNum(src.endX),
    canonicalGradingNum(src.endY),
    canonicalGradingNum(src.startZ),
    canonicalGradingNum(src.endZ),
    canonicalGradingNum(src.length),
    src.isArc ? 'arc' : 'line',
  ].join(',');
  if (!src.arc) return base;
  return [
    base,
    canonicalGradingNum(src.arc.centerX),
    canonicalGradingNum(src.arc.centerY),
    canonicalGradingNum(src.arc.radius),
    canonicalGradingNum(src.arc.startAngle),
    canonicalGradingNum(src.arc.endAngle),
    src.arc.sweepCCW ? 'ccw' : 'cw',
  ].join(',');
};

/** Deterministic `grev1:<fnv1a-hex>` over the canonical grading content. */
export const buildGradingRevision = (input: GradingRevisionInput): string => {
  const parts = [
    `src:${input.sourceFeatureLineId}`,
    `course:${input.vertexAId}>${input.vertexBId}`,
    `geom:${sourceText(input.resolvedSource)}`,
    targetText(input),
    `side:${input.side}`,
    `crit:${criterionText(input.criterion)}`,
    `search:${canonicalGradingNum(input.maxSearchDistance)}`,
    `chord:${canonicalGradingNum(input.curveChordTolerance)}`,
  ];
  return `grev1:${fnv1a(parts.join('#'))}`;
};
