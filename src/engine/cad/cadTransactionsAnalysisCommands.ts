import { createStableRuntimeId } from '../id';
import {
  createAnalysisMap,
  deleteAnalysisMap,
  updateAnalysisAppearance,
  updateAnalysisBands,
} from './cadAnalysisMaps';
import {
  createAnalysisLegend,
  deleteAnalysisLegend,
  moveAnalysisLegend,
  updateAnalysisLegend,
} from './cadAnalysisLegends';
import { isSurfaceLayerLocked, resolveSurfaceLayerId } from './cadSurfaceTypes';
import { commitLayerProject } from './cadTransactionsLayerCommands';
import type {
  CadCommand,
  CadCommandDefinition,
  CadCommandExecutionResult,
  CadCommandKey,
  CadWorkspaceSnapshot,
} from './cadTransactions.types';
import type { CadAnalysisLegend, CadAnalysisMap, CadProject } from './cadTypes';

// ---------------------------------------------------------------------------
// Phase 18U analysis maps + legends. Definitions only (band areas/percentages
// are session-derived and never persisted); every edit is one undo entry.
// LOCK-gated by the map's display layer (absent layer = default, unlocked).
// ---------------------------------------------------------------------------

const analysisMapsOf = (project: CadProject): CadAnalysisMap[] => project.analysisMaps ?? [];
const analysisLegendsOf = (project: CadProject): CadAnalysisLegend[] =>
  project.analysisLegends ?? [];

const nextAnalysisName = (project: CadProject): string => {
  const taken = new Set(analysisMapsOf(project).map((entry) => entry.name));
  let index = analysisMapsOf(project).length + 1;
  while (taken.has(`Analysis ${index}`)) index += 1;
  return `Analysis ${index}`;
};

const isMapLocked = (project: CadProject, map: CadAnalysisMap): boolean =>
  isSurfaceLayerLocked(project, { layerId: map.layerId });

const commitAnalysis = (
  key: CadCommandKey,
  snapshot: CadWorkspaceSnapshot,
  next: Pick<CadProject, 'analysisMaps' | 'analysisLegends'>,
  label: string,
): CadCommandExecutionResult =>
  commitLayerProject(key, snapshot, { ...snapshot.project, ...next }, label);

/** Lock-gated map edit shared by bands/appearance/delete paths. */
const withEditableMap = (
  snapshot: CadWorkspaceSnapshot,
  analysisId: string,
  mutate: (_map: CadAnalysisMap) => CadAnalysisMap[] | { error: string },
  key: CadCommandKey,
  label: string,
): CadCommandExecutionResult | null => {
  const maps = analysisMapsOf(snapshot.project);
  const map = maps.find((entry) => entry.id === analysisId);
  if (!map || isMapLocked(snapshot.project, map)) return null;
  const next = mutate(map);
  if (!Array.isArray(next)) return null;
  return commitAnalysis(key, snapshot, { analysisMaps: next }, label);
};

type MapCreateCommand = Extract<CadCommand, { key: 'ANALYSIS_MAP_CREATE' }>;

const analysisMapCreateCommand: CadCommandDefinition<MapCreateCommand> = {
  key: 'ANALYSIS_MAP_CREATE',
  execute: (snapshot, command) => {
    const maps = analysisMapsOf(snapshot.project);
    const name = command.name?.trim() || nextAnalysisName(snapshot.project);
    const layerId = resolveSurfaceLayerId(snapshot.project, command.layerId);
    const definition: CadAnalysisMap = {
      id: createStableRuntimeId('cad-analysis-map'),
      name,
      source: command.source,
      bands: command.bands,
      layerId,
      ...(command.opacity != null ? { opacity: command.opacity } : {}),
      ...(command.description != null ? { description: command.description } : {}),
    };
    const next = createAnalysisMap(maps, definition);
    if (!Array.isArray(next)) return null;
    return commitAnalysis('ANALYSIS_MAP_CREATE', snapshot, { analysisMaps: next }, `ANALYSIS_MAP_CREATE (${name})`);
  },
};

type MapUpdateBandsCommand = Extract<CadCommand, { key: 'ANALYSIS_MAP_UPDATE_BANDS' }>;

const analysisMapUpdateBandsCommand: CadCommandDefinition<MapUpdateBandsCommand> = {
  key: 'ANALYSIS_MAP_UPDATE_BANDS',
  execute: (snapshot, command) =>
    withEditableMap(
      snapshot,
      command.analysisId,
      (map) => {
        const maps = analysisMapsOf(snapshot.project);
        return updateAnalysisBands(maps, map.id, {
          ...(command.bands !== undefined ? { bands: command.bands } : {}),
          ...(command.source !== undefined ? { source: command.source } : {}),
        });
      },
      'ANALYSIS_MAP_UPDATE_BANDS',
      'ANALYSIS_MAP_UPDATE_BANDS',
    ),
};

type MapUpdateAppearanceCommand = Extract<CadCommand, { key: 'ANALYSIS_MAP_UPDATE_APPEARANCE' }>;

const analysisMapUpdateAppearanceCommand: CadCommandDefinition<MapUpdateAppearanceCommand> = {
  key: 'ANALYSIS_MAP_UPDATE_APPEARANCE',
  execute: (snapshot, command) =>
    withEditableMap(
      snapshot,
      command.analysisId,
      (map) =>
        updateAnalysisAppearance(analysisMapsOf(snapshot.project), map.id, {
          ...command.patch,
          ...(command.patch.layerId != null
            ? { layerId: resolveSurfaceLayerId(snapshot.project, command.patch.layerId) }
            : {}),
        }),
      'ANALYSIS_MAP_UPDATE_APPEARANCE',
      'ANALYSIS_MAP_UPDATE_APPEARANCE',
    ),
};

type MapDeleteCommand = Extract<CadCommand, { key: 'ANALYSIS_MAP_DELETE' }>;

const analysisMapDeleteCommand: CadCommandDefinition<MapDeleteCommand> = {
  key: 'ANALYSIS_MAP_DELETE',
  execute: (snapshot, command) => {
    const maps = analysisMapsOf(snapshot.project);
    const map = maps.find((entry) => entry.id === command.analysisId);
    if (!map || isMapLocked(snapshot.project, map)) return null;
    const result = deleteAnalysisMap(maps, command.analysisId, analysisLegendsOf(snapshot.project), {
      deleteLegendsToo: command.deleteLegendsToo === true,
    });
    if (!result.ok) return null;
    return commitAnalysis(
      'ANALYSIS_MAP_DELETE',
      snapshot,
      { analysisMaps: result.analysisMaps, analysisLegends: result.analysisLegends },
      `ANALYSIS_MAP_DELETE (${map.name})`,
    );
  },
};

type LegendCreateCommand = Extract<CadCommand, { key: 'ANALYSIS_LEGEND_CREATE' }>;

const analysisLegendCreateCommand: CadCommandDefinition<LegendCreateCommand> = {
  key: 'ANALYSIS_LEGEND_CREATE',
  execute: (snapshot, command) => {
    const maps = analysisMapsOf(snapshot.project);
    if (!maps.some((entry) => entry.id === command.legend.analysisId)) return null;
    const legends = analysisLegendsOf(snapshot.project);
    const next = createAnalysisLegend(legends, command.legend);
    if (!Array.isArray(next)) return null;
    return commitAnalysis(
      'ANALYSIS_LEGEND_CREATE',
      snapshot,
      { analysisLegends: next },
      `ANALYSIS_LEGEND_CREATE (${command.legend.analysisId})`,
    );
  },
};

type LegendUpdateCommand = Extract<CadCommand, { key: 'ANALYSIS_LEGEND_UPDATE' }>;

const analysisLegendUpdateCommand: CadCommandDefinition<LegendUpdateCommand> = {
  key: 'ANALYSIS_LEGEND_UPDATE',
  execute: (snapshot, command) => {
    const legends = analysisLegendsOf(snapshot.project);
    const legend = legends.find((entry) => entry.id === command.legendId);
    if (!legend) return null;
    if (
      command.patch.textStyleId != null &&
      command.patch.textStyleId !== '' &&
      !(snapshot.project.styleLibrary.textStyles ?? []).some(
        (entry) => entry.id === command.patch.textStyleId,
      )
    ) {
      return null;
    }
    const next = updateAnalysisLegend(legends, command.legendId, command.patch);
    if (!Array.isArray(next)) return null;
    return commitAnalysis('ANALYSIS_LEGEND_UPDATE', snapshot, { analysisLegends: next }, 'ANALYSIS_LEGEND_UPDATE');
  },
};

type LegendMoveCommand = Extract<CadCommand, { key: 'ANALYSIS_LEGEND_MOVE' }>;

const analysisLegendMoveCommand: CadCommandDefinition<LegendMoveCommand> = {
  key: 'ANALYSIS_LEGEND_MOVE',
  execute: (snapshot, command) => {
    const next = moveAnalysisLegend(
      analysisLegendsOf(snapshot.project),
      command.legendId,
      command.x,
      command.y,
    );
    if (!Array.isArray(next)) return null;
    return commitAnalysis('ANALYSIS_LEGEND_MOVE', snapshot, { analysisLegends: next }, 'ANALYSIS_LEGEND_MOVE');
  },
};

type LegendDeleteCommand = Extract<CadCommand, { key: 'ANALYSIS_LEGEND_DELETE' }>;

const analysisLegendDeleteCommand: CadCommandDefinition<LegendDeleteCommand> = {
  key: 'ANALYSIS_LEGEND_DELETE',
  execute: (snapshot, command) => {
    const next = deleteAnalysisLegend(analysisLegendsOf(snapshot.project), command.legendId);
    if (!Array.isArray(next)) return null;
    return commitAnalysis('ANALYSIS_LEGEND_DELETE', snapshot, { analysisLegends: next }, 'ANALYSIS_LEGEND_DELETE');
  },
};

export const analysisCommandDefinitions = {
  ANALYSIS_MAP_CREATE: analysisMapCreateCommand,
  ANALYSIS_MAP_UPDATE_BANDS: analysisMapUpdateBandsCommand,
  ANALYSIS_MAP_UPDATE_APPEARANCE: analysisMapUpdateAppearanceCommand,
  ANALYSIS_MAP_DELETE: analysisMapDeleteCommand,
  ANALYSIS_LEGEND_CREATE: analysisLegendCreateCommand,
  ANALYSIS_LEGEND_UPDATE: analysisLegendUpdateCommand,
  ANALYSIS_LEGEND_MOVE: analysisLegendMoveCommand,
  ANALYSIS_LEGEND_DELETE: analysisLegendDeleteCommand,
} as const;
