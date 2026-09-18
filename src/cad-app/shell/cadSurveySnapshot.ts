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
 * Phase 18D — workspace-side survey facts for Toolspace/Properties.
 * Pure; resolver + names + source lines precomputed once per snapshot so
 * shell renderers never import engine modules.
 */
export const buildCadSurveySnapshot = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): CadSurveySnapshot => {
  const groups = backfillCadPointGroups(project.pointGroups);
  const pointStyles = backfillCadPointStyles(project.pointStyles);
  const labelStyles = backfillCadPointLabelStyles(project.labelStyles);
  const pointNames = new Map(pointStyles.map((style) => [style.id, style.name]));
  const labelNames = new Map(labelStyles.map((style) => [style.id, style.name]));
  const pointIds = pointStyles.map((style) => style.id);
  const labelIds = labelStyles.map((style) => style.id);
  const points = project.entities.filter(
    (entity): entity is CadSurveyPointEntity => entity.type === 'survey-point',
  );
  const memberCounts = new Map<string, number>(groups.map((group) => [group.id, 0]));
  const infos: CadSurveyPointDisplayInfo[] = points.map((point) => {
    const matching = matchingPointGroups(point, groups);
    for (const group of matching) {
      memberCounts.set(group.id, (memberCounts.get(group.id) ?? 0) + 1);
    }
    const resolved = resolveSurveyPointDisplay({
      point,
      groups,
      pointStyles: pointIds.map((id) => ({ id })),
      labelStyles: labelIds.map((id) => ({ id })),
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
  });
  const selectedIds = new Set(selectedEntityIds);
  return {
    pointCount: points.length,
    allPointIds: points.map((point) => point.id),
    groups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      memberCount: memberCounts.get(group.id) ?? 0,
      priority: group.priority,
    })),
    pointStyles: pointStyles.map((style) => ({ id: style.id, name: style.name })),
    labelStyles: labelStyles.map((style) => ({ id: style.id, name: style.name })),
    table: infos.slice(0, SURVEY_POINT_TABLE_CAP),
    tableTruncated: infos.length > SURVEY_POINT_TABLE_CAP,
    selected: infos.filter((info) => selectedIds.has(info.entityId)),
  };
};
