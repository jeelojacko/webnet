import type {
  CadPointGroup,
  CadPointGroupId,
  CadPointGroupQuery,
  CadPointLabelStyleId,
  CadPointStyleId,
  CadProject,
  CadSurveyPointEntity,
} from './cadTypes';

/**
 * Phase 18D point groups + effective survey-style resolver. Pure: no React,
 * no renderer, no persistence. Groups are DISPLAY/ORGANIZATION only — matching
 * never duplicates geometry and never mutates coordinates.
 *
 * Membership is O(N*G) by design (simple scan, deterministic order). If a
 * future evidence pass measures this as hot, index group queries here — do
 * not add caching at call sites.
 */

export const ALL_POINTS_GROUP_ID: CadPointGroupId = 'point-group-all';
export const CONTROL_POINTS_GROUP_ID: CadPointGroupId = 'point-group-control';

/** Only `*` and `?` are special; brackets/backslash are malformed (fail closed). */
const MALFORMED_PATTERN_CHARS = /[[\\\]]/;

/**
 * Editor-surfaced validation: returns one message per problem, [] when valid.
 * Malformed patterns fail closed at match time (see evaluatePointGroupMembership).
 */
export const validatePointGroupQuery = (query: CadPointGroupQuery): string[] => {
  const errors: string[] = [];
  for (const [field, pattern] of [
    ['descriptionPattern', query.descriptionPattern],
    ['featureCodePattern', query.featureCodePattern],
  ] as const) {
    if (pattern == null) continue;
    if (pattern.trim() === '') errors.push(`${field} must not be empty.`);
    else if (MALFORMED_PATTERN_CHARS.test(pattern)) {
      errors.push(`${field} supports only * and ? wildcards (no regex or brackets).`);
    }
  }
  for (const [field, value] of [
    ['elevationMin', query.elevationMin],
    ['elevationMax', query.elevationMax],
  ] as const) {
    if (value != null && !Number.isFinite(value)) errors.push(`${field} must be a finite number.`);
  }
  if (
    Number.isFinite(query.elevationMin) &&
    Number.isFinite(query.elevationMax) &&
    (query.elevationMin as number) > (query.elevationMax as number)
  ) {
    errors.push('elevationMin must not exceed elevationMax.');
  }
  return errors;
};

const escapeRegExpChar = (ch: string): string =>
  ch.replace(/[.*+?^${}()|[\]\\]/, '\\$&');

const wildcardToRegExp = (pattern: string): RegExp => {
  const source = pattern
    .split('')
    .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : escapeRegExpChar(ch)))
    .join('');
  return new RegExp(`^${source}$`, 'i');
};

/** Absent text coerces to '': `*` still matches, anything specific does not. */
const matchesWildcard = (value: string | undefined, pattern: string): boolean =>
  wildcardToRegExp(pattern).test(value ?? '');

const hasQueryConstraints = (query: CadPointGroupQuery): boolean =>
  query.descriptionPattern != null ||
  query.featureCodePattern != null ||
  query.pointClass != null ||
  query.layerId != null ||
  query.source != null ||
  query.elevationMin != null ||
  query.elevationMax != null;

const matchesQueryConstraints = (
  point: CadSurveyPointEntity,
  query: CadPointGroupQuery,
): boolean => {
  if (query.descriptionPattern != null && !matchesWildcard(point.description, query.descriptionPattern)) {
    return false;
  }
  if (query.featureCodePattern != null && !matchesWildcard(point.featureCode, query.featureCodePattern)) {
    return false;
  }
  if (query.pointClass != null && point.pointClass !== query.pointClass) return false;
  if (query.layerId != null && point.layerId !== query.layerId) return false;
  if (query.source != null && point.source !== query.source) return false;
  if (query.elevationMin != null && !(Number.isFinite(point.z) && (point.z as number) >= query.elevationMin)) {
    return false;
  }
  if (query.elevationMax != null && !(Number.isFinite(point.z) && (point.z as number) <= query.elevationMax)) {
    return false;
  }
  return true;
};

/**
 * Pure membership. Exclude wins over include and query; an empty query with
 * no includes matches every survey point. Malformed queries fail closed
 * (match nothing).
 */
export const evaluatePointGroupMembership = (
  point: CadSurveyPointEntity,
  group: CadPointGroup,
): boolean => {
  if (validatePointGroupQuery(group.query).length > 0) return false;
  if (group.query.excludePointIds?.includes(point.id) === true) return false;
  if (group.query.includePointIds?.includes(point.id) === true) return true;
  return hasQueryConstraints(group.query) ? matchesQueryConstraints(point, group.query) : true;
};

/** All matching groups in precedence order (priority asc, list order tiebreak). */
export const matchingPointGroups = (
  point: CadSurveyPointEntity,
  groups: CadPointGroup[],
): CadPointGroup[] =>
  groups
    .map((group, index) => ({ group, index }))
    .filter(({ group }) => evaluatePointGroupMembership(point, group))
    .sort((a, b) => a.group.priority - b.group.priority || a.index - b.index)
    .map(({ group }) => group);

export type SurveyPointDisplaySource = 'manual-override' | `point-group:${string}` | 'base' | 'drawing-default';

export interface SurveyPointDisplayInput {
  point: CadSurveyPointEntity;
  groups: CadPointGroup[];
  pointStyles: { id: string }[];
  labelStyles: { id: string }[];
  defaultPointStyleId: CadPointStyleId;
  defaultLabelStyleId: CadPointLabelStyleId;
}

export interface SurveyPointDisplay {
  effectivePointStyleId: CadPointStyleId;
  effectivePointLabelStyleId: CadPointLabelStyleId;
  matchingGroupIds: CadPointGroupId[];
  styleSource: SurveyPointDisplaySource;
  labelStyleSource: SurveyPointDisplaySource;
}

const resolveOneProperty = ({
  manualId,
  baseId,
  matching,
  pickOverride,
  tableIds,
  defaultId,
}: {
  manualId: string | undefined;
  baseId: string | undefined;
  matching: CadPointGroup[];
  pickOverride: (_group: CadPointGroup) => string | undefined;
  tableIds: Set<string>;
  defaultId: string;
}): { effectiveId: string; source: SurveyPointDisplaySource } => {
  // Per-property precedence, independently: manual > group > base > default.
  // Unknown ids are treated as absent (deterministic fallback, never crash).
  if (manualId != null && tableIds.has(manualId)) return { effectiveId: manualId, source: 'manual-override' };
  for (const group of matching) {
    const overrideId = pickOverride(group);
    if (overrideId != null && tableIds.has(overrideId)) {
      return { effectiveId: overrideId, source: `point-group:${group.id}` };
    }
  }
  if (baseId != null && tableIds.has(baseId)) return { effectiveId: baseId, source: 'base' };
  if (tableIds.has(defaultId)) return { effectiveId: defaultId, source: 'drawing-default' };
  const firstTableId = [...tableIds][0];
  return { effectiveId: firstTableId ?? defaultId, source: 'drawing-default' };
};

/**
 * THE single effective display resolver (do not duplicate this logic —
 * renderer/export/F2F wire to this export in later phases). Each property
 * resolves independently through manual > group > base > drawing-default.
 */
export const resolveSurveyPointDisplay = (input: SurveyPointDisplayInput): SurveyPointDisplay => {
  const matching = matchingPointGroups(input.point, input.groups);
  const pointStyleIds = new Set(input.pointStyles.map((style) => style.id));
  const labelStyleIds = new Set(input.labelStyles.map((style) => style.id));
  const marker = resolveOneProperty({
    manualId: input.point.pointStyleOverrideId,
    baseId: input.point.pointStyleId,
    matching,
    pickOverride: (group) => group.pointStyleOverrideId,
    tableIds: pointStyleIds,
    defaultId: input.defaultPointStyleId,
  });
  const label = resolveOneProperty({
    manualId: input.point.pointLabelStyleOverrideId,
    baseId: input.point.pointLabelStyleId,
    matching,
    pickOverride: (group) => group.pointLabelStyleOverrideId,
    tableIds: labelStyleIds,
    defaultId: input.defaultLabelStyleId,
  });
  return {
    effectivePointStyleId: marker.effectiveId,
    effectivePointLabelStyleId: label.effectiveId,
    matchingGroupIds: matching.map((group) => group.id),
    styleSource: marker.source,
    labelStyleSource: label.source,
  };
};

export const cloneCadPointGroups = (groups: CadPointGroup[]): CadPointGroup[] =>
  groups.map((group) => ({ ...group, query: { ...group.query } }));

/**
 * Seed groups. Both carry NO style overrides, so they are appearance-neutral
 * on legacy drawings: resolution falls through group (no override) to base /
 * drawing default exactly as before, while membership counts still work.
 */
export const createDefaultCadPointGroups = (): CadPointGroup[] => [
  {
    id: ALL_POINTS_GROUP_ID,
    name: 'All Points',
    query: {},
    priority: 0,
    description: 'Organizational default: matches every survey point, no style overrides.',
  },
  {
    id: CONTROL_POINTS_GROUP_ID,
    name: 'Control Points',
    query: { pointClass: 'control' },
    priority: 1,
    description: 'Organizational default: all control-class points, no style overrides.',
  },
];

/** Load-time backfill: missing table becomes the appearance-neutral seeds. */
export const backfillCadPointGroups = (groups: CadPointGroup[] | undefined): CadPointGroup[] =>
  groups == null ? createDefaultCadPointGroups() : cloneCadPointGroups(groups);

/** Legacy migration: drawings without the table get the seed groups (no visual change). */
export const migrateLegacyPointGroups = (project: CadProject): CadProject =>
  project.pointGroups == null
    ? { ...project, pointGroups: createDefaultCadPointGroups() }
    : project;

/**
 * Delete guard for a future group editor. Deletion is appearance-neutral
 * because seed groups carry no overrides (resolution falls through to base /
 * default), so no protected-delete is needed: every group is deletable and
 * deleting All Points only drops it from matchingGroupIds.
 */
export const canDeletePointGroup = (
  _groupId: CadPointGroupId,
): { allowed: boolean; reason?: string } => ({
  allowed: true,
  reason: 'Point groups are display-only; deletion never alters geometry or resolved appearance.',
});
