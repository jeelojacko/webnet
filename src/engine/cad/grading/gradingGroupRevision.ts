/**
 * Phase 20C Wave-1B — grading-group content revision (`ggrev1:`).
 *
 * Hashes exactly the inputs a group result depends on: source Feature Line
 * id, the ordered A->B course chain, every oriented course geometry (XYZ +
 * arc params), target id + target source revision, side, criterion,
 * search/chord parameters, corner mode, and closed/open state. Appearance
 * (name/layer/style) is deliberately excluded, so a pure rename or layer
 * move never forces a recalculation.
 *
 * Reuses the 20B `fnv1a` helper and 1e-9 number quantization verbatim.
 */
import { fnv1a } from '../cadRevisionHash';
import { canonicalGradingNum } from './gradingRevision';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from './gradingTypes';
import type { GradingCornerMode } from './gradingGroupTypes';

export interface GroupRevisionCourse {
  vertexAId: string;
  vertexBId: string;
  /** Already oriented A->B by the resolve phase. */
  resolvedSource: ResolvedGradingSource;
}

export interface GroupRevisionInput {
  sourceFeatureLineId: string;
  /** Ordered traversal; order participates in the hash. */
  courses: GroupRevisionCourse[];
  targetSurfaceId: string;
  targetRevision: string;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  curveChordTolerance: number;
  cornerMode: GradingCornerMode;
  closed: boolean;
}

const criterionText = (criterion: GradingCriterion): string => {
  if (criterion.kind === 'cut-fill') {
    const cut = canonicalGradingNum(criterion.cutGradeRatio);
    const fill = canonicalGradingNum(criterion.fillGradeRatio);
    return `cut-fill:${cut}/${fill}`;
  }
  return `fixed:${canonicalGradingNum(criterion.gradeRatio)}`;
};

// Straight and legacy arc sources hash exactly as before; arc circle params
// join only when present so a bulge edit under identical endpoints still flips
// the revision.
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

const courseText = (course: GroupRevisionCourse, index: number): string =>
  `course${index}:${course.vertexAId}>${course.vertexBId}:${sourceText(course.resolvedSource)}`;

/** Deterministic `ggrev1:<fnv1a-hex>` over the canonical group content. */
export const buildGroupRevision = (input: GroupRevisionInput): string => {
  const parts = [
    `src:${input.sourceFeatureLineId}`,
    ...input.courses.map(courseText),
    `tgt:${input.targetSurfaceId}@${input.targetRevision}`,
    `side:${input.side}`,
    `crit:${criterionText(input.criterion)}`,
    `search:${canonicalGradingNum(input.maxSearchDistance)}`,
    `chord:${canonicalGradingNum(input.curveChordTolerance)}`,
    `corner:${input.cornerMode}`,
    `shape:${input.closed ? 'closed' : 'open'}`,
  ];
  return `ggrev1:${fnv1a(parts.join('#'))}`;
};
