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
import { canonicalCourseCriteria } from './gradingGroupCourseCriteria';
import { gradingCriterionRequiresSurface } from './gradingTypes';
import type { GradingCriterion, GradingSide, ResolvedGradingSource } from './gradingTypes';
import type { GradingCornerMode, GradingGroupCourseCriterionOverride } from './gradingGroupTypes';

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
  /** Omitted for target-free (analytic) criteria — hashes as `tgt:none`. */
  targetSurfaceId?: string;
  /** Omitted for target-free (analytic) criteria — hashes as `tgt:none`. */
  targetRevision?: string;
  side: GradingSide;
  criterion: GradingCriterion;
  /** Phase 20E sparse overrides; absent/empty = legacy hash byte-identical. */
  courseCriteria?: GradingGroupCourseCriterionOverride[];
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
  // Phase 20F: additive branches only — fixed/cut-fill bytes unchanged.
  if (criterion.kind === 'distance') {
    return `distance:${canonicalGradingNum(criterion.gradeRatio)}/${canonicalGradingNum(criterion.distance)}`;
  }
  if (criterion.kind === 'elevation') {
    return `elevation:${canonicalGradingNum(criterion.gradeRatio)}/${canonicalGradingNum(criterion.targetElevation)}`;
  }
  if (criterion.kind === 'relative-elevation') {
    return `relative-elevation:${canonicalGradingNum(criterion.gradeRatio)}/${canonicalGradingNum(criterion.relativeElevation)}`;
  }
  if (criterion.kind === 'fixed') {
    return `fixed:${canonicalGradingNum(criterion.gradeRatio)}`;
  }
  return 'unknown';
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

/**
 * Phase 20E: canonical sparse override text in traversal order. Empty when
 * no effective overrides exist, so the legacy hash is byte-identical.
 */
const overrideText = (
  criterion: GradingCriterion,
  courses: GroupRevisionCourse[],
  courseCriteria: GradingGroupCourseCriterionOverride[] | undefined,
): string => {
  if (!courseCriteria || courseCriteria.length === 0) return '';
  const canonical = canonicalCourseCriteria({
    criterion,
    sourceCourses: courses.map((course) => ({ vertexAId: course.vertexAId, vertexBId: course.vertexBId })),
    courseCriteria,
  });
  return canonical
    .map((entry) => `override:${entry.sourceCourse.vertexAId}>${entry.sourceCourse.vertexBId}:${criterionText(entry.criterion)}`)
    .join('#');
};

/** Deterministic `ggrev1:<fnv1a-hex>` over the canonical group content. */
export const buildGroupRevision = (input: GroupRevisionInput): string => {
  const overrides = overrideText(input.criterion, input.courses, input.courseCriteria);
  // Analytic (distance/elevation) groups carry no target: hash `tgt:none` so
  // a dormant legacy id can never move the revision. Surface bytes unchanged.
  const surfaceFamily = gradingCriterionRequiresSurface(input.criterion);
  const targetText =
    !surfaceFamily || input.targetSurfaceId === undefined || input.targetRevision === undefined
      ? 'tgt:none'
      : `tgt:${input.targetSurfaceId}@${input.targetRevision}`;
  const parts = [
    `src:${input.sourceFeatureLineId}`,
    ...input.courses.map(courseText),
    targetText,
    `side:${input.side}`,
    `crit:${criterionText(input.criterion)}`,
    ...(overrides.length > 0 ? [overrides] : []),
    `search:${canonicalGradingNum(input.maxSearchDistance)}`,
    `chord:${canonicalGradingNum(input.curveChordTolerance)}`,
    `corner:${input.cornerMode}`,
    `shape:${input.closed ? 'closed' : 'open'}`,
  ];
  return `ggrev1:${fnv1a(parts.join('#'))}`;
};
