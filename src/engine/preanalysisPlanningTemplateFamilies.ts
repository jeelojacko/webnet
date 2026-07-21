import { stationHasFiniteCoords, type PathPrioritySummary } from './preanalysisPathPriority';
import type { AdjustmentResult, PlanningMapState, StationId } from '../types';
import {
  MAX_BRACE_SCENARIOS,
  MAX_BRACE_SETUPS,
  MAX_CROSS_TIE_SCENARIOS,
  MAX_PROMOTED_SETUP_SCENARIOS,
  MAX_SYNTHETIC_SETUP_SCENARIOS,
  sortStationIds,
  type PreanalysisSyntheticSetTemplate,
} from './preanalysisPlanningShared';
import {
  buildBraceBlockText,
  buildBraceTemplateId,
  buildBraceTemplateLabel,
  buildCrossTieBlockText,
  buildCrossTieTemplateId,
  buildCrossTieTemplateLabel,
  buildPreviewPoints,
  buildPreviewSegments,
  buildPromotedTemplateId,
  buildPromotedTemplateLabel,
  buildSetupBlockText,
  buildSyntheticSetupTemplateId,
  buildSyntheticSetupTemplateLabel,
  chooseBracePointCandidateWithFallback,
  createSyntheticStationAllocator,
  filterVisibleAnchorIds,
  occupiedStationIdsFromTemplates,
  resolveObstacleGroups,
  sightLineBlocked,
} from './preanalysisPlanningGeometry';

export const buildBraceTemplates = (
  base: AdjustmentResult,
  existingTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  stationAllocator: ReturnType<typeof createSyntheticStationAllocator>,
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const occupiedIds = new Set(existingTemplates.map((template) => template.occupyStationId));
  const sourceLineByOccupyId = new Map(
    existingTemplates
      .filter((template) => template.sourceLines.length > 0)
      .map((template) => [template.occupyStationId, template.sourceLines[0]]),
  );
  const usedTemplateIds = new Set(existingTemplates.map((template) => template.id));
  const braceTemplates: PreanalysisSyntheticSetTemplate[] = [];
  const seenIds = new Set<string>();
  pathSummary.prioritizedPairs.forEach((pair) => {
    if (braceTemplates.length >= MAX_BRACE_SCENARIOS) return;
    const sortedPair = [pair.from, pair.to].sort(sortStationIds);
    const [leftId, rightId] = sortedPair;
    if (!occupiedIds.has(leftId) || !occupiedIds.has(rightId)) return;
    if (!stationHasFiniteCoords(base.stations, leftId) || !stationHasFiniteCoords(base.stations, rightId)) {
      return;
    }
    const id = buildBraceTemplateId(leftId, rightId);
    if (seenIds.has(id) || usedTemplateIds.has(id)) return;
    const point = chooseBracePointCandidateWithFallback(
      base.stations,
      leftId,
      rightId,
      obstacleGroups.hard,
      obstacleGroups.soft,
    );
    if (!point) return;
    const braceStationId = stationAllocator.nextBraceId();
    if (base.stations[braceStationId] != null) return;
    const extraVisibleSetups = filterVisibleAnchorIds(
      base.stations,
      point,
      occupiedStationIdsFromTemplates(existingTemplates),
      obstacleGroups.hard,
      obstacleGroups.soft,
    )
      .filter((stationId) => stationId !== leftId && stationId !== rightId)
      .slice(0, Math.max(0, MAX_BRACE_SETUPS - 2));
    const setupStationIds = [leftId, rightId, ...extraVisibleSetups];
    seenIds.add(id);
    braceTemplates.push({
      id,
      scenarioKind: 'brace-point',
      actionMode: 'applyable-addition',
      occupyStationId: leftId,
      setupStationIds,
      templateLabel: buildBraceTemplateLabel(braceStationId, leftId, rightId),
      sourceLines: setupStationIds.map((stationId) => sourceLineByOccupyId.get(stationId)).filter(
        (line): line is number => line != null,
      ),
      blockText: buildBraceBlockText(braceStationId, point, setupStationIds),
      affectedStations: [...setupStationIds, braceStationId],
      affectedPairs: [
        ...setupStationIds.map((setupId) => ({ from: setupId, to: braceStationId })),
      ],
      corridorPairs: [{ from: leftId, to: rightId }],
      addedObservationCount: setupStationIds.length,
      existingSetCount: 0,
      rationale: `Strengthens anchor-path bottleneck ${leftId}-${rightId} with a bounded brace point.`,
      bracePreviewPoint: {
        stationId: braceStationId,
        x: point.x,
        y: point.y,
        h: point.h,
      },
      previewPoints: buildPreviewPoints(base.stations, setupStationIds, [
        { stationId: braceStationId, x: point.x, y: point.y, h: point.h, role: 'brace' },
      ]),
      previewSegments: buildPreviewSegments(setupStationIds, braceStationId),
    });
  });
  return braceTemplates.sort(
    (left, right) =>
      left.occupyStationId.localeCompare(right.occupyStationId, undefined, { numeric: true }) ||
      left.templateLabel.localeCompare(right.templateLabel, undefined, { numeric: true }),
  );
};

export const buildPromotedSetupTemplates = (
  base: AdjustmentResult,
  existingTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  stationAllocator: ReturnType<typeof createSyntheticStationAllocator>,
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  if (!planningMap.scenarioFamilies.promotedSetup) return [];
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const occupiedIds = occupiedStationIdsFromTemplates(existingTemplates);
  const usedTemplateIds = new Set(existingTemplates.map((template) => template.id));
  const templates: PreanalysisSyntheticSetTemplate[] = [];
  pathSummary.prioritizedPairs.forEach((pair) => {
    if (templates.length >= MAX_PROMOTED_SETUP_SCENARIOS) return;
    const point = chooseBracePointCandidateWithFallback(
      base.stations,
      pair.from,
      pair.to,
      obstacleGroups.hard,
      obstacleGroups.soft,
    );
    if (!point) return;
    const visibleAnchors = filterVisibleAnchorIds(
      base.stations,
      point,
      occupiedIds,
      obstacleGroups.hard,
      obstacleGroups.soft,
    ).slice(0, MAX_BRACE_SETUPS);
    if (visibleAnchors.length < 3) return;
    const setupStationId = stationAllocator.nextSetupId();
    if (base.stations[setupStationId] != null) return;
    const id = buildPromotedTemplateId(pair.from, pair.to);
    if (usedTemplateIds.has(id)) return;
    templates.push({
      id,
      scenarioKind: 'promoted-setup',
      actionMode: 'applyable-addition',
      occupyStationId: setupStationId,
      setupStationIds: [setupStationId, ...visibleAnchors],
      templateLabel: buildPromotedTemplateLabel(setupStationId, visibleAnchors),
      sourceLines: [],
      blockText: buildSetupBlockText(setupStationId, point, visibleAnchors),
      affectedStations: [setupStationId, ...visibleAnchors],
      affectedPairs: visibleAnchors.map((anchorId) => ({ from: setupStationId, to: anchorId })),
      corridorPairs: [{ from: pair.from, to: pair.to }],
      addedObservationCount: visibleAnchors.length,
      existingSetCount: 0,
      rationale: `Promotes a new setup to strengthen visibility across bottleneck pair ${pair.from}-${pair.to}.`,
      previewPoints: buildPreviewPoints(base.stations, visibleAnchors, [
        { stationId: setupStationId, x: point.x, y: point.y, h: point.h, role: 'setup' },
      ]),
      previewSegments: buildPreviewSegments(visibleAnchors, setupStationId),
    });
  });
  return templates;
};

export const buildSyntheticSetupTemplates = (
  base: AdjustmentResult,
  existingTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  stationAllocator: ReturnType<typeof createSyntheticStationAllocator>,
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  if (!planningMap.scenarioFamilies.syntheticSetup) return [];
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const occupiedIds = occupiedStationIdsFromTemplates(existingTemplates);
  const templates: PreanalysisSyntheticSetTemplate[] = [];
  pathSummary.prioritizedPairs.forEach((pair) => {
    if (templates.length >= MAX_SYNTHETIC_SETUP_SCENARIOS) return;
    const point = chooseBracePointCandidateWithFallback(
      base.stations,
      pair.from,
      pair.to,
      obstacleGroups.hard,
      obstacleGroups.soft,
    );
    if (!point) return;
    const visibleAnchors = filterVisibleAnchorIds(
      base.stations,
      point,
      occupiedIds,
      obstacleGroups.hard,
      obstacleGroups.soft,
    ).slice(0, MAX_BRACE_SETUPS);
    if (visibleAnchors.length < 3) return;
    const setupStationId = stationAllocator.nextSetupId();
    if (base.stations[setupStationId] != null) return;
    templates.push({
      id: buildSyntheticSetupTemplateId(pair.from, pair.to, templates.length + 1),
      scenarioKind: 'synthetic-setup',
      actionMode: 'applyable-addition',
      occupyStationId: setupStationId,
      setupStationIds: [setupStationId, ...visibleAnchors],
      templateLabel: buildSyntheticSetupTemplateLabel(setupStationId, visibleAnchors),
      sourceLines: [],
      blockText: buildSetupBlockText(setupStationId, point, visibleAnchors),
      affectedStations: [setupStationId, ...visibleAnchors],
      affectedPairs: visibleAnchors.map((anchorId) => ({ from: setupStationId, to: anchorId })),
      corridorPairs: [{ from: pair.from, to: pair.to }],
      addedObservationCount: visibleAnchors.length,
      existingSetCount: 0,
      rationale: `Adds a synthetic setup positioned to shorten the weak chain back to control across ${pair.from}-${pair.to}.`,
      previewPoints: buildPreviewPoints(base.stations, visibleAnchors, [
        { stationId: setupStationId, x: point.x, y: point.y, h: point.h, role: 'setup' },
      ]),
      previewSegments: buildPreviewSegments(visibleAnchors, setupStationId),
    });
  });
  return templates;
};

export const buildCrossTieTemplates = (
  base: AdjustmentResult,
  existingTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  if (!planningMap.scenarioFamilies.crossTie) return [];
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const existingPairKeys = new Set(
    existingTemplates.flatMap((template) =>
      template.affectedPairs.map((pair) => [pair.from, pair.to].sort(sortStationIds).join('|')),
    ),
  );
  const rows: PreanalysisSyntheticSetTemplate[] = [];
  pathSummary.prioritizedPairs.forEach((pair) => {
    if (rows.length >= MAX_CROSS_TIE_SCENARIOS) return;
    const key = [pair.from, pair.to].sort(sortStationIds).join('|');
    if (existingPairKeys.has(key)) return;
    const fromStation = base.stations[pair.from];
    const toStation = base.stations[pair.to];
    if (!fromStation || !toStation || sightLineBlocked(fromStation, toStation, obstacleGroups.hard)) return;
    const clearOfAllObstacles = !sightLineBlocked(fromStation, toStation, obstacleGroups.all);
    if (!clearOfAllObstacles && rows.length > 0) return;
    rows.push({
      id: buildCrossTieTemplateId(pair.from, pair.to),
      scenarioKind: 'cross-tie',
      actionMode: 'applyable-addition',
      occupyStationId: pair.from,
      setupStationIds: [pair.from],
      templateLabel: buildCrossTieTemplateLabel(pair.from, pair.to),
      sourceLines: [],
      blockText: buildCrossTieBlockText(pair.from, pair.to),
      affectedStations: [pair.from, pair.to],
      affectedPairs: [{ from: pair.from, to: pair.to }],
      corridorPairs: [{ from: pair.from, to: pair.to }],
      addedObservationCount: 1,
      existingSetCount: 0,
      rationale: `Adds a direct tie to bypass weak accumulation along the ${pair.from}-${pair.to} corridor.`,
      previewPoints: buildPreviewPoints(base.stations, [pair.from, pair.to], []),
      previewSegments: [
        {
          fromStationId: pair.from,
          toStationId: pair.to,
          kind: 'cross-tie',
          active: false,
        },
      ],
    });
  });
  return rows;
};
