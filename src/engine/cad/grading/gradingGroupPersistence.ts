import { createGroupDefinition } from './gradingGroupAuthoring';
import { validateGradingCriterion } from './gradingAuthoring';
import { validateGroupTermination } from './gradingGroupTermination';
import type { CadGradingGroup } from './gradingGroupTypes';

/**
 * Phase 20C Wave-3 group definition persistence (ENGINE ONLY — no UI).
 *
 * Definitions persist; derived daylight/mesh/status/results never do.
 * Additive + optional (still schema v2, no bump — same precedent as every
 * 18F–20B table): legacy files backfill [] and reopen UNBUILT. The key
 * trails `gradings` (key-order discipline: project signatures are
 * key-order-sensitive JSON.stringify).
 */

export const cloneCadGradingGroup = (group: CadGradingGroup): CadGradingGroup => ({
  id: group.id,
  name: group.name,
  sourceFeatureLineId: group.sourceFeatureLineId,
  sourceCourses: group.sourceCourses.map((course) => ({ ...course })),
  ...(group.targetSurfaceId !== undefined ? { targetSurfaceId: group.targetSurfaceId } : {}),
  side: group.side,
  criterion: { ...group.criterion },
  ...(group.courseCriteria !== undefined
    ? {
        courseCriteria: group.courseCriteria.map((entry) => ({
          sourceCourse: { ...entry.sourceCourse },
          criterion: { ...entry.criterion },
        })),
      }
    : {}),
  maxSearchDistance: group.maxSearchDistance,
  curveChordTolerance: group.curveChordTolerance,
  cornerMode: group.cornerMode,
  ...(group.closed === true ? { closed: true as const } : {}),
  ...(group.layerId !== undefined ? { layerId: group.layerId } : {}),
  ...(group.styleId !== undefined ? { styleId: group.styleId } : {}),
});

export const cloneCadGradingGroups = (groups: CadGradingGroup[] | undefined): CadGradingGroup[] =>
  (groups ?? []).map(cloneCadGradingGroup);

/** Load-time backfill: legacy drawings (field absent) open with no groups. */
export const backfillCadGradingGroups = (groups: CadGradingGroup[] | undefined): CadGradingGroup[] =>
  cloneCadGradingGroups(groups);

/**
 * Key-order discipline (mirror `withoutGradingsKey`): strip the key first
 * so callers re-append it canonically after `gradings`. Chain with
 * `withoutGradingsKey` when both keys are re-appended.
 */
export const withoutGradingGroupsKey = <T extends object>(project: T): Omit<T, 'gradingGroups'> => {
  const { gradingGroups: _dropped, ...rest } = project as T & { gradingGroups?: unknown };
  return rest;
};

/**
 * Fail-closed definition validation: a raw entry round-trips through the
 * Wave-1B authoring constructor (identity/criterion/scalar/chain rules);
 * malformed entries are dropped, valid ones are kept verbatim (never
 * rebound). Results/status/mesh can never persist — the definition shape
 * carries none of them, so nothing needs stripping.
 */
export const sanitizeCadGradingGroups = (groups: unknown): CadGradingGroup[] =>
  sanitizeCadGradingGroupsDetailed(groups).groups;

export interface CourseCriteriaDrop {
  groupId: string;
  ref: string;
  reason: 'orphan' | 'duplicate' | 'invalid-criterion';
}

/**
 * Phase 20E: load-time override scrub. Entries whose course left the span
 * (insert splits, span edits), duplicates, or invalid criteria are dropped
 * with a diagnostic record; the group itself still loads. Legacy groups
 * (field absent) pass through untouched.
 */
export const sanitizeCadGradingGroupsDetailed = (
  groups: unknown,
): { groups: CadGradingGroup[]; dropped: CourseCriteriaDrop[] } => {
  if (!Array.isArray(groups)) return { groups: [], dropped: [] };
  const kept: CadGradingGroup[] = [];
  const dropped: CourseCriteriaDrop[] = [];
  for (const entry of groups) {
    if (entry === null || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const built = createGroupDefinition({
      id: candidate['id'] as string,
      name: candidate['name'] as string,
      sourceFeatureLineId: candidate['sourceFeatureLineId'] as string,
      sourceCourses: (candidate['sourceCourses'] ?? []) as CadGradingGroup['sourceCourses'],
      ...(typeof candidate['targetSurfaceId'] === 'string'
        ? { targetSurfaceId: candidate['targetSurfaceId'] as string }
        : {}),
      side: candidate['side'] as CadGradingGroup['side'],
      criterion: candidate['criterion'] as CadGradingGroup['criterion'],
      maxSearchDistance: candidate['maxSearchDistance'] as number,
      curveChordTolerance: candidate['curveChordTolerance'] as number,
      cornerMode: candidate['cornerMode'] as CadGradingGroup['cornerMode'],
      ...(candidate['closed'] === true ? { closed: true as const } : {}),
      ...(typeof candidate['layerId'] === 'string' ? { layerId: candidate['layerId'] } : {}),
      ...(typeof candidate['styleId'] === 'string' ? { styleId: candidate['styleId'] } : {}),
    });
    if (built.ok) {
      const scrubbed = scrubCourseCriteria(built.value, candidate['courseCriteria']);
      dropped.push(...scrubbed.dropped);
      // Phase 20F: fail the family gate at sanitize. A hand-mixed file would
      // otherwise fail closed only at resolve; instead load the group on its
      // default criterion and report each stripped override.
      let group = scrubbed.group;
      if (group.courseCriteria !== undefined && validateGroupTermination(group) !== null) {
        for (const override of group.courseCriteria) {
          dropped.push({
            groupId: group.id,
            ref: `${override.sourceCourse.vertexAId}>${override.sourceCourse.vertexBId}`,
            reason: 'invalid-criterion',
          });
        }
        const { courseCriteria: _stripped, ...rest } = group;
        group = rest;
      }
      kept.push(cloneCadGradingGroup(group));
    }
  }
  return { groups: kept, dropped };
};

/** Drop orphan/duplicate/invalid override records, reporting each drop. */
const scrubCourseCriteria = (
  group: CadGradingGroup,
  raw: unknown,
): { group: CadGradingGroup; dropped: CourseCriteriaDrop[] } => {
  const dropped: CourseCriteriaDrop[] = [];
  const strip = (): { group: CadGradingGroup; dropped: CourseCriteriaDrop[] } => {
    const { courseCriteria: _stripped, ...rest } = group;
    return { group: rest, dropped };
  };
  if (raw === undefined) return { group, dropped };
  if (!Array.isArray(raw)) return strip();
  const members = new Set(
    group.sourceCourses.flatMap((c) => [`${c.vertexAId}>${c.vertexBId}`, `${c.vertexBId}>${c.vertexAId}`]),
  );
  const seen = new Set<string>();
  const kept: NonNullable<CadGradingGroup['courseCriteria']> = [];
  for (const entry of raw) {
    const course = (entry as { sourceCourse?: unknown } | null)?.sourceCourse as
      | { vertexAId?: unknown; vertexBId?: unknown }
      | undefined;
    const ref =
      typeof course?.vertexAId === 'string' && typeof course?.vertexBId === 'string'
        ? `${course.vertexAId}>${course.vertexBId}`
        : '?';
    const canon =
      typeof course?.vertexAId === 'string' && typeof course?.vertexBId === 'string'
        ? [course.vertexAId, course.vertexBId].sort().join('>')
        : null;
    if (canon === null || !members.has(ref)) {
      dropped.push({ groupId: group.id, ref, reason: 'orphan' });
      continue;
    }
    const vertexAId = course?.vertexAId as string;
    const vertexBId = course?.vertexBId as string;
    if (seen.has(canon)) {
      dropped.push({ groupId: group.id, ref, reason: 'duplicate' });
      continue;
    }
    const criterion = (entry as { criterion?: unknown })?.criterion as CadGradingGroup['criterion'];
    if (validateGradingCriterion(criterion) !== null) {
      dropped.push({ groupId: group.id, ref, reason: 'invalid-criterion' });
      continue;
    }
    seen.add(canon);
    kept.push({
      sourceCourse: { vertexAId, vertexBId },
      criterion: { ...criterion },
    });
  }
  if (kept.length === 0) return strip();
  return { group: { ...group, courseCriteria: kept }, dropped };
};
