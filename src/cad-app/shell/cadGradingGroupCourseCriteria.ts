/**
 * Phase 20E Wave-2A — per-course criteria UI helpers (SHELL/UI ONLY).
 *
 * Read-only use of the Wave-1A engine resolver: every course row reads its
 * effective criterion through `resolveGradingGroupCourseCriterion` (override
 * wins, otherwise the group default). Labels stay human (`Course N`,
 * V-short vertex tags); raw UUIDs never reach the table.
 */
import {
  buildCourseCriterionMap,
  resolveGradingGroupCourseCriterion,
} from '../../engine/cad/grading/gradingGroupCourseCriteria';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
} from '../../engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../../engine/cad/grading/gradingTypes';
import { formatGradingCriterion, formatSignedGradePercent } from './cadGradingShell';

/** 1-based course label (never a raw id or index). */
export const courseNumberLabel = (memberIndex: number): string => `Course ${memberIndex + 1}`;

/** V-short vertex tag: trailing segment after ':' (else the id, capped). */
export const shortVertexLabel = (vertexId: string): string => {
  const tail = vertexId.includes(':') ? vertexId.split(':').pop() ?? vertexId : vertexId;
  return tail.length > 12 ? tail.slice(0, 12) : tail;
};

/** True when this traversal course carries an override record. */
export const isCourseCriterionOverride = (
  group: CadGradingGroup,
  memberIndex: number,
): boolean => {
  const course = group.sourceCourses[memberIndex];
  if (!course) return false;
  const map = buildCourseCriterionMap(group);
  const key = `${course.vertexAId}>${course.vertexBId}`;
  const flipped = `${course.vertexBId}>${course.vertexAId}`;
  return map.has(key) || map.has(flipped);
};

/** Effective criterion for one traversal course (override or default). */
export const effectiveCourseCriterion = (
  group: CadGradingGroup,
  memberIndex: number,
): GradingCriterion => {
  const course = group.sourceCourses[memberIndex];
  if (!course) return group.criterion;
  return resolveGradingGroupCourseCriterion(group, course);
};

/** 'Default' | 'Override' provenance tag for one traversal course. */
export const courseCriterionSourceText = (group: CadGradingGroup, memberIndex: number): string =>
  isCourseCriterionOverride(group, memberIndex) ? 'Override' : 'Default';

/**
 * Truthful 4-way type tag (Phase 20F.1): surface criteria split into
 * 'Surface Fixed' / 'Surface Cut/Fill'; analytic criteria label as
 * 'Distance' / 'Elevation' (never a fake fixed/cut/fill tag).
 */
export const courseCriterionTypeText = (criterion: GradingCriterion): string => {
  if (criterion.kind === 'fixed') return 'Surface Fixed';
  if (criterion.kind === 'cut-fill') return 'Surface Cut/Fill';
  return criterion.kind === 'distance' ? 'Distance' : 'Elevation';
};

/** Joined region classifications for one member ('—' when the member never solved). */
export const memberClassificationText = (
  result: CadGradingGroupResult | null,
  memberIndex: number,
): string => {
  if (!result) return '—';
  const seen: string[] = [];
  for (const region of result.memberRegions) {
    if (region.memberIndex !== memberIndex) continue;
    if (!seen.includes(region.classification)) seen.push(region.classification);
  }
  return seen.length > 0 ? seen.join('/') : '—';
};

/** Source length for one member: summed solved station spans ('—' when unsolved). */
export const memberSourceLengthText = (
  result: CadGradingGroupResult | null,
  memberIndex: number,
): string => {
  if (!result) return '—';
  let length = 0;
  let found = false;
  for (const region of result.memberRegions) {
    if (region.memberIndex !== memberIndex) continue;
    found = true;
    length += Math.max(0, region.stationSpan[1] - region.stationSpan[0]);
  }
  return found ? length.toFixed(3) : '—';
};

/** One member row for the report/CSV member table (grading area is never per-member). */
export interface CourseMemberRow {
  course: string;
  from: string;
  to: string;
  criterionSource: string;
  criterionType: string;
  /** Fixed grade text, or '—' for cut/fill members. */
  fixedGrade: string;
  /** Cut grade text, or '—' for fixed members. */
  cutGrade: string;
  /** Fill grade text, or '—' for fixed members. */
  fillGrade: string;
  /**
   * Analytic target text ('20.000 m' distance, '98.000 m' elevation),
   * or '—' for surface members (no fake fixed/cut/fill values).
   */
  targetValue: string;
  classification: string;
  sourceLength: string;
  /** Always '—': grading area is group-level, never per-member. */
  gradingArea: string;
}

export const buildCourseMemberRows = (
  group: CadGradingGroup,
  result: CadGradingGroupResult | null,
): CourseMemberRow[] =>
  group.sourceCourses.map((course, index) => {
    const criterion = effectiveCourseCriterion(group, index);
    const fixed = criterion.kind === 'fixed' ? formatSignedGradePercent(criterion.gradeRatio) : '—';
    const cut = criterion.kind === 'cut-fill' ? formatSignedGradePercent(criterion.cutGradeRatio) : '—';
    const fill = criterion.kind === 'cut-fill' ? formatSignedGradePercent(criterion.fillGradeRatio) : '—';
    // Analytic target: distance or target elevation only; surface rows keep '—'.
    const targetValue =
      criterion.kind === 'distance'
        ? `${criterion.distance.toFixed(3)} m`
        : criterion.kind === 'elevation'
          ? `${criterion.targetElevation.toFixed(3)} m`
          : '—';
    return {
      course: courseNumberLabel(index),
      from: shortVertexLabel(course.vertexAId),
      to: shortVertexLabel(course.vertexBId),
      criterionSource: courseCriterionSourceText(group, index),
      criterionType: courseCriterionTypeText(criterion),
      fixedGrade: fixed,
      cutGrade: cut,
      fillGrade: fill,
      targetValue,
      classification: memberClassificationText(result, index),
      sourceLength: memberSourceLengthText(result, index),
      gradingArea: '—',
    };
  });

/** Effective-slope summary for inquiry ('Default/Override + effective slope'). */
export const effectiveCourseSummary = (group: CadGradingGroup, memberIndex: number): string =>
  `${courseCriterionSourceText(group, memberIndex)} · ${formatGradingCriterion(effectiveCourseCriterion(group, memberIndex))}`;
