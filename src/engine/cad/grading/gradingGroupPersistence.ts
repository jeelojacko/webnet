import { createGroupDefinition, validateGroupBaseShape } from './gradingGroupAuthoring';
import { validateGradingCriterion } from './gradingAuthoring';
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
    // Phase 20J1: validate the base shape WITHOUT the target gate (a
    // fully-overridden stored default is invisible to it), scrub the raw
    // overrides against the validated courses, then run the SINGLE
    // authoring construction with the scrubbed effective set + raw target.
    // The final target rule stays owned by the authoring constructor
    // (effective criteria via effectiveCriteriaForCourses +
    // groupTerminationRequiresTarget): surface/hybrid keeps the target,
    // all-analytic sheds a dormant id (dormancy by omission). Malformed
    // defaults or target-less surface-effective groups drop fail-closed;
    // orphan/duplicate/invalid overrides drop with a report above. Never
    // invents a target, never materializes defaults.
    const base = validateGroupBaseShape(candidate);
    if (!base.ok) continue;
    const scrubbed = scrubCourseCriteria(base.value, candidate['courseCriteria']);
    dropped.push(...scrubbed.dropped);
    // Phase 20J Wave C1: every 5-kind mix is a legal hybrid (exact-
    // common-tie kernel) — cross-domain overrides survive the scrub.
    // Only orphan/duplicate/invalid records drop, each reported above.
    // Malformed defaults drop via the authoring constructor; legacy
    // valid groups pass through byte-for-byte.
    const built = createGroupDefinition({
      ...base.value,
      ...(typeof candidate['targetSurfaceId'] === 'string'
        ? { targetSurfaceId: candidate['targetSurfaceId'] as string }
        : {}),
      ...(scrubbed.group.courseCriteria !== undefined
        ? { courseCriteria: scrubbed.group.courseCriteria }
        : {}),
    });
    if (!built.ok) continue;
    kept.push(cloneCadGradingGroup(built.value));
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
