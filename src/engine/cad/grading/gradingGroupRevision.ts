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
import { hasTransitionIntent } from './gradingTransitionPolicy';
import { canonicalCourseCriteria, effectiveCriteriaForCourses } from './gradingGroupCourseCriteria';
import { gradingCriterionRequiresSurface } from './gradingTypes';import type { GradingCriterion, GradingSide, ResolvedGradingSource } from './gradingTypes';
import type { GradingCornerMode, GradingGroupCourseCriterionOverride } from './gradingGroupTypes';
import type { CadGradingTransition } from './gradingGroupTypes';

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
  /**
   * Phase 20M.2 Wave B: transition canonical fields (law/width/refs +
   * family/side). Absent/empty = legacy hash byte-identical. Recorded
   * revision/evidence outputs never participate (no circularity).
   */
  transitions?: CadGradingTransition[];
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

// Phase 20Q.1: transitioned groups hash source Z at full precision so a
// sub-nanometre flat-to-sloped edit moves the revision (the 1nm quantizer
// below would keep a stale CURRENT via the service cache). No-transition
// groups keep the legacy quantizer byte-identical.
const exactSourceZ = (value: number): string =>
  Number.isFinite(value) ? String(value) : 'non-finite';

// Straight and legacy arc sources hash exactly as before; arc circle params
// join only when present so a bulge edit under identical endpoints still flips
// the revision.
const sourceText = (src: ResolvedGradingSource, exactZ: boolean): string => {
  const zOf = exactZ ? exactSourceZ : canonicalGradingNum;
  const base = [
    canonicalGradingNum(src.startX),
    canonicalGradingNum(src.startY),
    canonicalGradingNum(src.endX),
    canonicalGradingNum(src.endY),
    zOf(src.startZ),
    zOf(src.endZ),
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

const courseText = (course: GroupRevisionCourse, index: number, exactZ: boolean): string =>
  `course${index}:${course.vertexAId}>${course.vertexBId}:${sourceText(course.resolvedSource, exactZ)}`;

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

/**
 * Phase 20J Wave C1: the target participates when ANY effective member
 * is surface-terminated (Wave C4: EFFECTIVE-only — the stored default
 * counts only for traversal courses it still covers; a fully-overridden
 * default is invisible). All-analytic groups hash `tgt:none`, so a
 * dormant legacy id can never move the revision. Pre-20J homogeneous
 * inputs (no effective surface override) hash byte-identically.
 */
const effectiveRequiresSurface = (
  criterion: GradingCriterion,
  courses: GroupRevisionCourse[],
  courseCriteria: GradingGroupCourseCriterionOverride[] | undefined,
): boolean => {
  if (courses.length === 0) return gradingCriterionRequiresSurface(criterion);
  return effectiveCriteriaForCourses(criterion, courses, courseCriteria)
    .some((entry) => gradingCriterionRequiresSurface(entry));
};

/**
 * Exact numeric encoding for the transition width ONLY. The 1e-9
 * quantization below the engineering floor is kept for every other field,
 * but a width edit must always invalidate: 40 vs 40.0000000001 straddle
 * the exact `W <= 2*min(LL,LR)` boundary, so collapsing them would keep a
 * stale CURRENT across a feasibility change. Full-precision repr keeps
 * legacy no-transition hashes byte-identical (empty text when absent).
 */
const exactTransitionWidth = (value: number): string =>
  Number.isFinite(value) ? String(value) : 'non-finite';

/**
 * Phase 20M.2 Wave B: canonical transition text over the persisted
 * canonical fields only (policyVersion/jointId/memberIds/width/lawKind/
 * lawVersion/family/side). Endpoint evidence values + provenance revision
 * are outputs and never hash. Empty when no transitions exist, so the
 * legacy hash is byte-identical.
 */
const transitionText = (transitions: CadGradingTransition[] | undefined): string => {
  if (!transitions || transitions.length === 0) return '';
  return transitions
    .map((t) => [
      `trp:${String(t.policyVersion)}`,
      `joint:${String(t.jointId)}`,
      `members:${(t.memberIds ?? []).join('+')}`,
      // ponytail: full-precision width repr; 1e-9 quant for all other fields.
      `width:${exactTransitionWidth(t.width)}`,
      `law:${String(t.lawKind)}/${String(t.lawVersion)}`,
      `family:${String(t.criterionFamily)}`,
      `side:${String(t.side)}`,
    ].join(','))
    .join('#');
};

/** Deterministic `ggrev1:<fnv1a-hex>` over the canonical group content. */
export const buildGroupRevision = (input: GroupRevisionInput): string => {
  const overrides = overrideText(input.criterion, input.courses, input.courseCriteria);
  const exactZ = hasTransitionIntent(input.transitions);
  const surfaceFamily = effectiveRequiresSurface(input.criterion, input.courses, input.courseCriteria);
  const targetText =
    !surfaceFamily || input.targetSurfaceId === undefined || input.targetRevision === undefined
      ? 'tgt:none'
      : `tgt:${input.targetSurfaceId}@${input.targetRevision}`;
  const parts = [
    `src:${input.sourceFeatureLineId}`,
    ...input.courses.map((course, index) => courseText(course, index, exactZ)),
    targetText,
    `side:${input.side}`,
    `crit:${criterionText(input.criterion)}`,
    ...(overrides.length > 0 ? [overrides] : []),
    ...(transitionText(input.transitions).length > 0 ? [transitionText(input.transitions)] : []),
    `search:${canonicalGradingNum(input.maxSearchDistance)}`,
    `chord:${canonicalGradingNum(input.curveChordTolerance)}`,
    `corner:${input.cornerMode}`,
    `shape:${input.closed ? 'closed' : 'open'}`,
  ];
  return `ggrev1:${fnv1a(parts.join('#'))}`;
};
