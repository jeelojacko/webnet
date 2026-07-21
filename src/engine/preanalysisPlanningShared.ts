import type { PathGraphEdge } from './preanalysisPathPriority';
import type {
  AdjustmentResult,
  PlanningMapState,
  PreanalysisAddedSetPairRef,
  PreanalysisRecommendationKind,
  PreanalysisScenarioPreviewPoint,
  PreanalysisScenarioPreviewSegment,
  StationId,
} from '../types';

export type PreanalysisSyntheticSetTemplate = {
  id: string;
  scenarioKind: PreanalysisRecommendationKind;
  actionMode: 'applyable-addition' | 'applyable-transform' | 'advisory';
  occupyStationId: StationId;
  setupStationIds: StationId[];
  templateLabel: string;
  sourceLines: number[];
  observationSourceLines?: number[];
  blockText: string;
  affectedStations: StationId[];
  affectedPairs: PreanalysisAddedSetPairRef[];
  corridorPairs?: PreanalysisAddedSetPairRef[];
  addedObservationCount: number;
  existingSetCount: number;
  previewPoints: PreanalysisScenarioPreviewPoint[];
  previewSegments: PreanalysisScenarioPreviewSegment[];
  effectiveTemplateIds?: string[];
  replacesTemplateIds?: string[];
  removeSourceLines?: number[];
  rationale?: string;
  bracePreviewPoint?: {
    stationId: StationId;
    x: number;
    y: number;
    h: number;
  };
};

export type BuildPreanalysisPlanningDiagnosticsArgs = {
  base: AdjustmentResult;
  input: string;
  planningMap: PlanningMapState;
  activeTemplateIds: string[];
  targetThresholdMeters?: number;
  maxAddedSets: number;
  solveScenario: (_activeTemplateIds: string[]) => AdjustmentResult;
};

export const MAX_RECOMMENDATIONS = 5;
export const MAX_BRACE_SCENARIOS = 5;
export const MAX_SYNTHETIC_SETUP_SCENARIOS = 5;
export const MAX_PROMOTED_SETUP_SCENARIOS = 5;
export const MAX_CROSS_TIE_SCENARIOS = 8;
export const MAX_BYPASS_ADVISORIES = 4;
export const MAX_DECOMMISSION_ADVISORIES = 4;
export const MAX_MOVE_SYNTHETIC_ADVISORIES = 3;
export const MAX_RECOMMENDATION_SOLVE_CANDIDATES = 16;
export const MAX_BRACE_SETUPS = 4;
export const BRACE_OFFSET_RATIO = 0.35;
export const MIN_BRACE_ANGLE_DEG = 45;
export const MAX_BRACE_ANGLE_DEG = 120;
export const MIN_BRACE_CLEARANCE_RATIO = 0.15;
export const POLYGON_CLEARANCE_M = 1.5;

export const medianOf = (values: number[]): number | undefined => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return undefined;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : 0.5 * (sorted[mid - 1] + sorted[mid]);
};

export const stationMajors = (res: AdjustmentResult): number[] =>
  (res.stationCovariances ?? []).map(
    (row) => row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
  );

export const relativeMetrics = (res: AdjustmentResult): number[] =>
  (res.relativeCovariances ?? []).map(
    (row) => row.sigmaDist ?? row.ellipse?.semiMajor ?? Math.max(row.sigmaE, row.sigmaN),
  );

export const weakStationCount = (res: AdjustmentResult): number =>
  (res.weakGeometryDiagnostics?.stationCues ?? []).filter((cue) => cue.severity !== 'ok').length;

export const weakPairCount = (res: AdjustmentResult): number =>
  (res.weakGeometryDiagnostics?.relativeCues ?? []).filter((cue) => cue.severity !== 'ok').length;

const recommendationKindTieOrder: PreanalysisRecommendationKind[] = [
  'existing-set',
  'cross-tie',
  'brace-point',
  'promoted-setup',
  'synthetic-setup',
  'move-synthetic',
  'bypass-intermediate',
  'decommission-intermediate',
];

export const recommendationKindTieWeight = (kind: PreanalysisRecommendationKind): number =>
  recommendationKindTieOrder.indexOf(kind);

export const sortStationIds = (left: StationId, right: StationId): number =>
  left.localeCompare(right, undefined, { numeric: true });

export const buildPairKey = (from: StationId, to: StationId): string =>
  [from, to].sort(sortStationIds).join('|');

export const templateCorridorPairs = (
  template: PreanalysisSyntheticSetTemplate,
): PreanalysisAddedSetPairRef[] =>
  template.corridorPairs != null && template.corridorPairs.length > 0
    ? template.corridorPairs
    : template.affectedPairs;

export const templateEffectiveTemplateIds = (
  template: PreanalysisSyntheticSetTemplate,
): string[] =>
  template.effectiveTemplateIds != null && template.effectiveTemplateIds.length > 0
    ? template.effectiveTemplateIds
    : [template.id];

export const parseMoveScenarioId = (
  scenarioId: string,
): { fromTemplateId: string; toTemplateId: string } | null => {
  if (!scenarioId.startsWith('preanalysis-move:')) return null;
  const remainder = scenarioId.slice('preanalysis-move:'.length);
  const separatorIndex = remainder.indexOf('->');
  if (separatorIndex <= 0) return null;
  const fromTemplateId = remainder.slice(0, separatorIndex).trim();
  const toTemplateId = remainder.slice(separatorIndex + 2).trim();
  if (!fromTemplateId || !toTemplateId) return null;
  return { fromTemplateId, toTemplateId };
};

export type ResolvedPreanalysisActionState = {
  normalizedScenarioIds: string[];
  activeScenarioIds: Set<string>;
  effectiveActiveTemplateIds: Set<string>;
  removedSourceLines: Set<number>;
};

export const resolveAppliedPreanalysisActionState = (
  templates: PreanalysisSyntheticSetTemplate[],
  activeScenarioIds: string[],
): ResolvedPreanalysisActionState => {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const normalizedEntries: Array<{ scenarioId: string; template: PreanalysisSyntheticSetTemplate }> = [];
  const seenScenarioIds = new Set<string>();
  activeScenarioIds.forEach((scenarioId) => {
    if (seenScenarioIds.has(scenarioId)) return;
    const template = templateById.get(scenarioId);
    if (!template) return;
    seenScenarioIds.add(scenarioId);
    const nextEffectiveIds = new Set(templateEffectiveTemplateIds(template));
    const replacementIds = new Set(template.replacesTemplateIds ?? []);
    for (let index = normalizedEntries.length - 1; index >= 0; index -= 1) {
      const prior = normalizedEntries[index]!;
      const priorEffectiveIds = templateEffectiveTemplateIds(prior.template);
      const sameEffectiveTarget = priorEffectiveIds.some((id) => nextEffectiveIds.has(id));
      const replacedByCurrent = priorEffectiveIds.some((id) => replacementIds.has(id));
      if (sameEffectiveTarget || replacedByCurrent) {
        normalizedEntries.splice(index, 1);
      }
    }
    normalizedEntries.push({ scenarioId, template });
  });

  const normalizedScenarioIds = normalizedEntries.map((entry) => entry.scenarioId);
  const effectiveActiveTemplateIds = new Set<string>();
  const removedSourceLines = new Set<number>();
  normalizedEntries.forEach(({ template }) => {
    templateEffectiveTemplateIds(template).forEach((templateId) => {
      effectiveActiveTemplateIds.add(templateId);
    });
    (template.removeSourceLines ?? []).forEach((line) => {
      if (Number.isFinite(line) && line >= 1) removedSourceLines.add(line);
    });
  });
  return {
    normalizedScenarioIds,
    activeScenarioIds: new Set(normalizedScenarioIds),
    effectiveActiveTemplateIds,
    removedSourceLines,
  };
};

export const removeInputSourceLines = (input: string, removedSourceLines: Set<number>): string => {
  if (removedSourceLines.size === 0) return input;
  return input
    .split(/\r?\n/)
    .filter((_, index) => !removedSourceLines.has(index + 1))
    .join('\n');
};

export const isNetworkConnectedWithOptionalBypass = (
  edges: PathGraphEdge[],
  removedStationId: StationId,
  bypassPair?: PreanalysisAddedSetPairRef,
): boolean => {
  const adjacency = new Map<StationId, Set<StationId>>();
  const addLink = (from: StationId, to: StationId) => {
    if (from === removedStationId || to === removedStationId) return;
    const fromList = adjacency.get(from) ?? new Set<StationId>();
    const toList = adjacency.get(to) ?? new Set<StationId>();
    fromList.add(to);
    toList.add(from);
    adjacency.set(from, fromList);
    adjacency.set(to, toList);
  };
  edges.forEach((edge) => addLink(edge.from, edge.to));
  if (
    bypassPair &&
    bypassPair.from !== removedStationId &&
    bypassPair.to !== removedStationId
  ) {
    addLink(bypassPair.from, bypassPair.to);
  }
  const stationIds = [...adjacency.keys()].sort(sortStationIds);
  if (stationIds.length <= 1) return true;
  const visited = new Set<StationId>();
  const frontier = [stationIds[0]!];
  while (frontier.length > 0) {
    const current = frontier.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    [...(adjacency.get(current) ?? [])]
      .sort(sortStationIds)
      .forEach((nextStationId) => {
        if (!visited.has(nextStationId)) frontier.push(nextStationId);
      });
  }
  return stationIds.every((stationId) => visited.has(stationId));
};
