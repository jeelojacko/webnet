import type { CadEntity, CadProject } from '../../engine/cad/cadTypes';
import type { DrawingCatalogStatus } from '../../engine/fieldToFinish/drawingCatalog';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';
import type { UnitsMode } from '../../types';
import type { CadWorkspaceSnapshot } from '../../cad-app/shell/cadShellTypes';
import { buildCadSurveySnapshot } from '../../cad-app/shell/cadSurveySnapshot';
import { buildCadSurveyTableSnapshot } from '../../cad-app/shell/cadSurveyTableSnapshot';
import { buildCadParcelSnapshot } from '../../cad-app/shell/cadParcelSnapshot';
import { buildCadFeatureLineSnapshot } from '../../cad-app/shell/cadFeatureLineSnapshot';
import { buildCadBlockSnapshot } from '../../cad-app/shell/cadBlockSnapshot';
import { buildCadGradingSnapshot } from '../../cad-app/shell/cadGradingSnapshot';
import { buildCadGradingGroupSnapshot } from '../../cad-app/shell/cadGradingGroupSnapshot';
import { buildCadSurfaceSnapshot } from '../../cad-app/shell/cadSurfaceSnapshot';
import { buildCadVolumeSnapshot } from '../../cad-app/shell/cadVolumeSnapshot';
import { buildCadProfileSnapshot } from '../../cad-app/shell/cadProfileSnapshot';
import { buildCadSectionSnapshot } from '../../cad-app/shell/cadSectionSnapshot';
import { getCadEntityDisplayLabel } from '../../engine/cad/cadEntityNames';
import { resolveCurrentCadLayerId } from '../../engine/cad/cadLayers';
import { buildCadF2FSnapshot } from './f2fGeneratedSummary';

/**
 * STRUCT-194.7 — domain-grouped inputs for the pure shell-snapshot builder.
 *
 * Every field is either a live root value or a small pre-typed options object.
 * The context object is constructed INSIDE the root `useMemo` callback, so its
 * identity never becomes a memo dependency; the memo keeps its original
 * individual dependency array verbatim (see `SurveyCadWorkspace.tsx`).
 *
 * Option types are derived from the sub-builder signatures (`Parameters<...>`)
 * so a builder contract change fails typecheck here rather than silently
 * drifting.
 */
export interface SurveyCadShellSnapshotContext {
  drawing: {
    id: string;
    name: string;
    sheets: CadWorkspaceSnapshot['sheets'];
  };
  units: UnitsMode;
  project: CadProject;
  surfaceCache: Parameters<typeof buildCadSurfaceSnapshot>[1];
  catalog: {
    catalog: FeatureCodeCatalog;
    status: DrawingCatalogStatus;
  };
  selection: {
    count: number;
    entityIds: string[];
    entities: CadEntity[];
  };
  properties: CadWorkspaceSnapshot['properties'];
  command: {
    activeKey: string | null;
    prompt: string;
    inputValue: string;
  };
  history: {
    canUndo: boolean;
    canRedo: boolean;
    historyDepth: number;
    redoDepth: number;
  };
  snap: {
    preferences: CadWorkspaceSnapshot['snapPreferences'];
    stationCount: number;
  };
  dependencyStatus: string;
  annotation: CadWorkspaceSnapshot['annotation'];
  grading: {
    cache: Parameters<typeof buildCadGradingSnapshot>[2];
    selectedId: Parameters<typeof buildCadGradingSnapshot>[3];
    options: NonNullable<Parameters<typeof buildCadGradingSnapshot>[4]>;
  };
  gradingGroups: {
    cache: Parameters<typeof buildCadGradingGroupSnapshot>[2];
    selectedId: Parameters<typeof buildCadGradingGroupSnapshot>[3];
    options: NonNullable<Parameters<typeof buildCadGradingGroupSnapshot>[4]>;
  };
  blocks: {
    insertPick: Parameters<typeof buildCadBlockSnapshot>[2];
  };
  surface: {
    selectedId: Parameters<typeof buildCadSurfaceSnapshot>[2];
    options: NonNullable<Parameters<typeof buildCadSurfaceSnapshot>[3]>;
  };
  volume: {
    cache: Parameters<typeof buildCadVolumeSnapshot>[2];
    selectedId: Parameters<typeof buildCadVolumeSnapshot>[3];
    options: NonNullable<Parameters<typeof buildCadVolumeSnapshot>[4]>;
  };
  analysis: CadWorkspaceSnapshot['analysis'];
  profile: {
    cache: Parameters<typeof buildCadProfileSnapshot>[2];
    selectedId: Parameters<typeof buildCadProfileSnapshot>[3];
    viewId: Parameters<typeof buildCadProfileSnapshot>[4];
    options: NonNullable<Parameters<typeof buildCadProfileSnapshot>[5]>;
  };
  section: {
    deps: Parameters<typeof buildCadSectionSnapshot>[1];
    groupId: Parameters<typeof buildCadSectionSnapshot>[2];
    lineId: Parameters<typeof buildCadSectionSnapshot>[3];
    viewId: Parameters<typeof buildCadSectionSnapshot>[4];
  };
  availableCommands: string[];
}

/**
 * STRUCT-194.7 — deterministic body of the Phase 18B shell snapshot.
 *
 * Pure: no hooks, no caches, no cloning/stringify, no render-time side effects.
 * The twelve sub-builders are invoked in the exact original call order
 * (survey, surveyTable, parcel, featureLine, grading, gradingGroups, blocks,
 * f2f, surface, volume, profile, section); `annotation` and `analysis` are
 * passed through from the context (they are already derived snapshots). The
 * `null`-when-no-shellLink guard stays in the root memo.
 */
export const buildSurveyCadShellSnapshot = (
  context: SurveyCadShellSnapshotContext,
): CadWorkspaceSnapshot => {
  const { project, selection, drawing, command, history, snap } = context;
  const enabledSnaps = Object.entries(snap.preferences)
    .filter(([, enabled]) => enabled)
    .map(([kind]) => kind);
  const layerEntityCounts: Record<string, number> = {};
  for (const entity of project.entities) {
    layerEntityCounts[entity.layerId] = (layerEntityCounts[entity.layerId] ?? 0) + 1;
  }
  return {
    drawingId: drawing.id,
    drawingName: drawing.name,
    units: context.units,
    entityCount: project.entities.length,
    selectionCount: selection.count,
    selectedEntityIds: selection.entityIds,
    selectionPreview: selection.entities
      .slice(0, 200)
      .map((entity) => ({ id: entity.id, type: entity.type, label: getCadEntityDisplayLabel(entity) })),
    layers: project.layers,
    layerEntityCounts,
    currentLayerId: resolveCurrentCadLayerId(project),
    lineTypes: project.styleLibrary.lineTypes,
    sheets: drawing.sheets,
    properties: context.properties,
    activeCommandKey: command.activeKey,
    commandPrompt: command.prompt,
    commandInputValue: command.inputValue,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    historyDepth: history.historyDepth,
    redoDepth: history.redoDepth,
    snapPreferences: snap.preferences,
    snapStatusText: enabledSnaps.length > 0 ? `SNAP: ${enabledSnaps.join(', ')}` : 'OSNAP off',
    stationCount: snap.stationCount,
    dependencyStatus: context.dependencyStatus,
    survey: buildCadSurveySnapshot(project, selection.entityIds),
    surveyTable: buildCadSurveyTableSnapshot(project, selection.entityIds),
    parcel: buildCadParcelSnapshot(project, selection.entityIds),
    featureLine: buildCadFeatureLineSnapshot(project, selection.entityIds),
    grading: buildCadGradingSnapshot(
      project,
      context.surfaceCache,
      context.grading.cache,
      context.grading.selectedId,
      context.grading.options,
    ),
    gradingGroups: buildCadGradingGroupSnapshot(
      project,
      context.surfaceCache,
      context.gradingGroups.cache,
      context.gradingGroups.selectedId,
      context.gradingGroups.options,
    ),
    blocks: buildCadBlockSnapshot(project, selection.entityIds, context.blocks.insertPick),
    annotation: context.annotation,
    f2f: buildCadF2FSnapshot(project, context.catalog.catalog, context.catalog.status),
    surface: buildCadSurfaceSnapshot(
      project,
      context.surfaceCache,
      context.surface.selectedId,
      context.surface.options,
    ),
    volume: buildCadVolumeSnapshot(
      project,
      context.surfaceCache,
      context.volume.cache,
      context.volume.selectedId,
      context.volume.options,
    ),
    analysis: context.analysis,
    profile: buildCadProfileSnapshot(
      project,
      context.surfaceCache,
      context.profile.cache,
      context.profile.selectedId,
      context.profile.viewId,
      context.profile.options,
    ),
    section: buildCadSectionSnapshot(
      project,
      context.section.deps,
      context.section.groupId,
      context.section.lineId,
      context.section.viewId,
    ),
    availableCommands: context.availableCommands,
  };
};
