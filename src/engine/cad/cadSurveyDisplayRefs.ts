import type {
  CadPointGroup,
  CadPointLabelStyleId,
  CadPointStyleId,
  CadProject,
  CadSurveyPointEntity,
} from './cadTypes';
import type { FeatureCodeCatalog } from '../fieldToFinish/featureCatalog';
import { createStableRuntimeId } from '../id';
import type { SurveyPointDisplaySource } from './cadPointGroups';

/**
 * Phase 18D survey-display refcounts + delete-guard policy (pure; no React,
 * no history). Split from cadTransactionsSurveyDisplay.ts so the command
 * file stays focused on execution.
 *
 * STYLE DELETE DECISION (documented per brief): refs across survey points
 * or point groups BLOCK deletion until a replacement is picked (the command
 * rewires every point base/override + group override to it before
 * removing). Catalog definitions are REPORTED but never block: a dangling
 * catalog ref already falls back deterministically (drawing default / F2F
 * Full compat + import warning, see catalogIo); when a replacement is
 * chosen the manager also rewires catalog defs through the existing
 * workspace catalog path (non-undoable, same as F2F panel catalog edits).
 * Deleting the last remaining style in a table is rejected (the resolver
 * needs >= 1 entry).
 */

export const surveyPointsOf = (project: CadProject): CadSurveyPointEntity[] =>
  project.entities.filter(
    (entity): entity is CadSurveyPointEntity => entity.type === 'survey-point',
  );

export interface SurveyStyleRefCounts {
  points: number;
  groups: number;
  catalogDefinitions: number;
  total: number;
}

const countRefs = (points: number, groups: number, catalogDefinitions: number): SurveyStyleRefCounts => ({
  points,
  groups,
  catalogDefinitions,
  total: points + groups + catalogDefinitions,
});

/** Refs across points (base + manual override) + groups (overrides) + catalog defs. */
export const countPointStyleRefs = (
  project: CadProject,
  catalog: FeatureCodeCatalog | undefined,
  styleId: CadPointStyleId,
): SurveyStyleRefCounts => {
  const points = surveyPointsOf(project).filter(
    (point) => point.pointStyleId === styleId || point.pointStyleOverrideId === styleId,
  ).length;
  const groups = (project.pointGroups ?? []).filter(
    (group) => group.pointStyleOverrideId === styleId,
  ).length;
  const catalogDefinitions =
    catalog?.definitions.filter((def) => def.pointStyleId === styleId).length ?? 0;
  return countRefs(points, groups, catalogDefinitions);
};

/** Same shape for label styles (catalog defs carry labelStyleId too). */
export const countLabelStyleRefs = (
  project: CadProject,
  catalog: FeatureCodeCatalog | undefined,
  styleId: CadPointLabelStyleId,
): SurveyStyleRefCounts => {
  const points = surveyPointsOf(project).filter(
    (point) => point.pointLabelStyleId === styleId || point.pointLabelStyleOverrideId === styleId,
  ).length;
  const groups = (project.pointGroups ?? []).filter(
    (group) => group.pointLabelStyleOverrideId === styleId,
  ).length;
  const catalogDefinitions =
    catalog?.definitions.filter((def) => def.labelStyleId === styleId).length ?? 0;
  return countRefs(points, groups, catalogDefinitions);
};

export interface StyleDeleteGuard {
  blocked: boolean;
  /** Stable manager-facing message (empty when allowed). */
  message: string;
}

/**
 * Points/groups refs block; catalog refs only warn. Pure so the manager can
 * surface the message before dispatching (dispatch also enforces it).
 */
export const describeStyleDeleteGuard = (
  kind: 'point' | 'label',
  styleName: string,
  refs: SurveyStyleRefCounts,
  tableSize: number,
  replacementId: string | undefined,
): StyleDeleteGuard => {
  if (tableSize <= 1) {
    return { blocked: true, message: `Cannot delete "${styleName}": it is the last ${kind} style.` };
  }
  const hardRefs = refs.points + refs.groups;
  if (hardRefs > 0 && replacementId == null) {
    const bits = [
      refs.points > 0 ? `${refs.points} point${refs.points === 1 ? '' : 's'}` : null,
      refs.groups > 0 ? `${refs.groups} group${refs.groups === 1 ? '' : 's'}` : null,
    ].filter((bit): bit is string => bit != null);
    const catalogNote =
      refs.catalogDefinitions > 0
        ? ` (plus ${refs.catalogDefinitions} catalog definition${refs.catalogDefinitions === 1 ? '' : 's'}, rewired with it)`
        : '';
    return {
      blocked: true,
      message: `"${styleName}" is used by ${bits.join(' + ')}${catalogNote}: pick a replacement style.`,
    };
  }
  return { blocked: false, message: '' };
};

/** Human source line for Properties (`Effective: X — Source: ...`). */
export const describeDisplaySource = (
  source: SurveyPointDisplaySource,
  groups: CadPointGroup[],
): string => {
  if (source === 'manual-override') return 'Manual override';
  if (source === 'base') return 'Base style';
  if (source === 'drawing-default') return 'Drawing default';
  const groupId = source.slice('point-group:'.length);
  const group = groups.find((entry) => entry.id === groupId);
  return group ? `Point Group "${group.name}"` : `Point Group "${groupId}"`;
};

export const isSurveyNameTaken = (
  names: readonly { id: string; name: string }[],
  name: string,
  exceptId?: string,
): boolean =>
  names.some((entry) => entry.id !== exceptId && entry.name.toLowerCase() === name.toLowerCase());

/** Deterministic numeric-suffix id (`prefix-1`, `prefix-2`, ...). */
export const nextSurveyTableId = (prefix: string, existingIds: readonly string[]): string => {
  let index = existingIds.length + 1;
  const taken = new Set(existingIds);
  while (taken.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
};

export const newSurveyTableUuid = (prefix: string): string => createStableRuntimeId(prefix);
