import { createGroupDefinition } from './gradingGroupAuthoring';
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
  ...group,
  sourceCourses: group.sourceCourses.map((course) => ({ ...course })),
  criterion: { ...group.criterion },
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
export const sanitizeCadGradingGroups = (groups: unknown): CadGradingGroup[] => {
  if (!Array.isArray(groups)) return [];
  const kept: CadGradingGroup[] = [];
  for (const entry of groups) {
    if (entry === null || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const built = createGroupDefinition({
      id: candidate['id'] as string,
      name: candidate['name'] as string,
      sourceFeatureLineId: candidate['sourceFeatureLineId'] as string,
      sourceCourses: (candidate['sourceCourses'] ?? []) as CadGradingGroup['sourceCourses'],
      targetSurfaceId: candidate['targetSurfaceId'] as string,
      side: candidate['side'] as CadGradingGroup['side'],
      criterion: candidate['criterion'] as CadGradingGroup['criterion'],
      maxSearchDistance: candidate['maxSearchDistance'] as number,
      curveChordTolerance: candidate['curveChordTolerance'] as number,
      cornerMode: candidate['cornerMode'] as CadGradingGroup['cornerMode'],
      ...(candidate['closed'] === true ? { closed: true as const } : {}),
      ...(typeof candidate['layerId'] === 'string' ? { layerId: candidate['layerId'] } : {}),
      ...(typeof candidate['styleId'] === 'string' ? { styleId: candidate['styleId'] } : {}),
    });
    if (built.ok) kept.push(cloneCadGradingGroup(built.value));
  }
  return kept;
};
