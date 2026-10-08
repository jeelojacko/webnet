import { backfillCadPointLabelStyles } from '../../engine/cad/cadPointLabelStyles';
import {
  backfillCadPointGroups,
  matchingPointGroups,
  resolveSurveyPointDisplay,
} from '../../engine/cad/cadPointGroups';
import { describeDisplaySource } from '../../engine/cad/cadSurveyDisplayRefs';
import { DEFAULT_CAD_POINT_LABEL_STYLE_ID } from '../../engine/cad/cadPointLabelStyles';
import { DEFAULT_CAD_POINT_STYLE_ID } from '../../engine/cad/cadPointStyles';
import { backfillCadPointStyles } from '../../engine/cad/cadPointStyles';
import type {
  CadPointGroup,
  CadProject,
  CadSurveyPointEntity,
} from '../../engine/cad/cadTypes';
import type {
  CadSurveyPointDisplayInfo,
  CadSurveySnapshot,
} from './cadShellTypes';

/** Rows kept in the Toolspace point table (no virtualization by design). */
export const SURVEY_POINT_TABLE_CAP = 500;

const styleName = (names: Map<string, string>, id: string | undefined): string => {
  if (id == null) return 'Drawing default';
  return names.get(id) ?? `Unknown style (${id})`;
};

/**
 * Lightweight descriptor arrays are built ONCE per snapshot and reused for
 * every resolver call: the resolver only needs the id, and rebuilding these
 * per point was pure allocation churn at scale.
 */
interface SurveyStyleContext {
  pointNames: Map<string, string>;
  labelNames: Map<string, string>;
  pointStyleRefs: { id: string }[];
  labelStyleRefs: { id: string }[];
}

/** Expensive per-point display materialization (resolver + names + sources). */
const buildSurveyPointInfo = (
  point: CadSurveyPointEntity,
  matching: CadPointGroup[],
  groups: CadPointGroup[],
  { pointNames, labelNames, pointStyleRefs, labelStyleRefs }: SurveyStyleContext,
): CadSurveyPointDisplayInfo => {
  const resolved = resolveSurveyPointDisplay({
    point,
    groups,
    pointStyles: pointStyleRefs,
    labelStyles: labelStyleRefs,
    defaultPointStyleId: DEFAULT_CAD_POINT_STYLE_ID,
    defaultLabelStyleId: DEFAULT_CAD_POINT_LABEL_STYLE_ID,
  });
  return {
    entityId: point.id,
    stationId: point.stationId,
    x: point.x,
    y: point.y,
    z: point.z,
    description: point.description,
    featureCode: point.featureCode,
    layerId: point.layerId,
    pointClass: point.pointClass,
    source: point.source,
    basePointStyleName: styleName(pointNames, point.pointStyleId),
    pointStyleOverrideId: point.pointStyleOverrideId ?? null,
    pointStyleOverrideName:
      point.pointStyleOverrideId == null ? null : (pointNames.get(point.pointStyleOverrideId) ?? `Unknown style (${point.pointStyleOverrideId})`),
    effectivePointStyleName: pointNames.get(resolved.effectivePointStyleId) ?? resolved.effectivePointStyleId,
    pointStyleSourceText: describeDisplaySource(resolved.styleSource, groups),
    baseLabelStyleName: styleName(labelNames, point.pointLabelStyleId),
    pointLabelStyleOverrideId: point.pointLabelStyleOverrideId ?? null,
    labelStyleOverrideName:
      point.pointLabelStyleOverrideId == null ? null : (labelNames.get(point.pointLabelStyleOverrideId) ?? `Unknown style (${point.pointLabelStyleOverrideId})`),
    effectiveLabelStyleName: labelNames.get(resolved.effectivePointLabelStyleId) ?? resolved.effectivePointLabelStyleId,
    labelStyleSourceText: describeDisplaySource(resolved.labelStyleSource, groups),
    matchingGroupNames: matching.map((group) => group.name),
  };
};

/**
 * Phase 18D — workspace-side survey facts for Toolspace/Properties.
 * Pure; resolver + names + source lines precomputed once per snapshot so
 * shell renderers never import engine modules.
 *
 * Cap-aware: one pass over ALL points accumulates the count, ids, and exact
 * group member counts, but the expensive display materialization runs only
 * for the first `SURVEY_POINT_TABLE_CAP` points plus any selected point
 * beyond the cap. A point inside the cap that is also selected is
 * materialized once and shared by `table` and `selected`.
 */
export const buildCadSurveySnapshot = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): CadSurveySnapshot => {
  const groups = backfillCadPointGroups(project.pointGroups);
  const pointStyles = backfillCadPointStyles(project.pointStyles);
  const labelStyles = backfillCadPointLabelStyles(project.labelStyles);
  const styleContext: SurveyStyleContext = {
    pointNames: new Map(pointStyles.map((style) => [style.id, style.name])),
    labelNames: new Map(labelStyles.map((style) => [style.id, style.name])),
    pointStyleRefs: pointStyles.map((style) => ({ id: style.id })),
    labelStyleRefs: labelStyles.map((style) => ({ id: style.id })),
  };
  const selectedIds = new Set(selectedEntityIds);
  const memberCounts = new Map<string, number>(groups.map((group) => [group.id, 0]));
  const allPointIds: string[] = [];
  const table: CadSurveyPointDisplayInfo[] = [];
  const selected: CadSurveyPointDisplayInfo[] = [];
  let surveyIndex = 0;
  for (const entity of project.entities) {
    if (entity.type !== 'survey-point') continue;
    allPointIds.push(entity.id);
    const matching = matchingPointGroups(entity, groups);
    for (const group of matching) {
      memberCounts.set(group.id, (memberCounts.get(group.id) ?? 0) + 1);
    }
    const inTable = surveyIndex < SURVEY_POINT_TABLE_CAP;
    const isSelected = selectedIds.has(entity.id);
    if (inTable || isSelected) {
      const info = buildSurveyPointInfo(entity, matching, groups, styleContext);
      if (inTable) table.push(info);
      if (isSelected) selected.push(info);
    }
    surveyIndex += 1;
  }
  return {
    pointCount: allPointIds.length,
    allPointIds,
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      memberCount: memberCounts.get(group.id) ?? 0,
      priority: group.priority,
    })),
    pointStyles: pointStyles.map((style) => ({ id: style.id, name: style.name })),
    labelStyles: labelStyles.map((style) => ({ id: style.id, name: style.name })),
    table,
    tableTruncated: allPointIds.length > SURVEY_POINT_TABLE_CAP,
    selected,
  };
};
