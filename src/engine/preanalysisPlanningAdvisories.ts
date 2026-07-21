import { isPreanalysisWhatIfCandidate } from './preanalysis';
import { buildPathGraph, stationFixedRank, type PathPrioritySummary } from './preanalysisPathPriority';
import type { AdjustmentResult, Observation, PlanningMapState, StationId } from '../types';
import {
  buildPairKey,
  isNetworkConnectedWithOptionalBypass,
  MAX_BYPASS_ADVISORIES,
  MAX_DECOMMISSION_ADVISORIES,
  MAX_MOVE_SYNTHETIC_ADVISORIES,
  parseMoveScenarioId,
  templateCorridorPairs,
  type PreanalysisSyntheticSetTemplate,
} from './preanalysisPlanningShared';
import {
  buildCrossTieBlockText,
  buildCrossTieTemplateId,
  buildPreviewPoints,
  resolveObstacleGroups,
  sightLineBlocked,
} from './preanalysisPlanningGeometry';

const observationTouchesStation = (obs: Observation, stationId: StationId): boolean => {
  if ('at' in obs && obs.at === stationId) return true;
  if ('from' in obs && obs.from === stationId) return true;
  if ('to' in obs && obs.to === stationId) return true;
  return false;
};

export const buildAdvisoryTemplates = (
  base: AdjustmentResult,
  additiveTemplates: PreanalysisSyntheticSetTemplate[],
  planningMap: PlanningMapState,
  activeTemplateIds: string[],
  pathSummary: PathPrioritySummary,
): PreanalysisSyntheticSetTemplate[] => {
  const obstacleGroups = resolveObstacleGroups(planningMap);
  const existingPairKeys = new Set(
    additiveTemplates.flatMap((template) =>
      template.affectedPairs.map((pair) => buildPairKey(pair.from, pair.to)),
    ),
  );
  const graphEdges = buildPathGraph(base);
  const degreeByStation = new Map<StationId, number>();
  graphEdges.forEach((edge) => {
    degreeByStation.set(edge.from, (degreeByStation.get(edge.from) ?? 0) + 1);
    degreeByStation.set(edge.to, (degreeByStation.get(edge.to) ?? 0) + 1);
  });
  const advisoryTemplates: PreanalysisSyntheticSetTemplate[] = [];
  const additiveTemplateById = new Map(additiveTemplates.map((template) => [template.id, template]));
  pathSummary.stationOrder.slice(0, 4).forEach((stationId) => {
    const diagnostics = pathSummary.stationDiagnostics.get(stationId);
    if (!diagnostics || diagnostics.anchorPathStationIds.length < 3) return;
    for (let index = 0; index <= diagnostics.anchorPathStationIds.length - 3; index += 1) {
      if (advisoryTemplates.filter((row) => row.scenarioKind === 'bypass-intermediate').length >= MAX_BYPASS_ADVISORIES) {
        break;
      }
      const left = diagnostics.anchorPathStationIds[index]!;
      const middle = diagnostics.anchorPathStationIds[index + 1]!;
      const right = diagnostics.anchorPathStationIds[index + 2]!;
      const bypassKey = buildPairKey(left, right);
      if (existingPairKeys.has(bypassKey)) continue;
      const leftStation = base.stations[left];
      const rightStation = base.stations[right];
      if (!leftStation || !rightStation || sightLineBlocked(leftStation, rightStation, obstacleGroups.hard)) {
        continue;
      }
      const bypassTemplateId = `preanalysis-bypass:${left}|${middle}|${right}`;
      advisoryTemplates.push({
        id: bypassTemplateId,
        scenarioKind: 'bypass-intermediate',
        actionMode: 'applyable-transform',
        occupyStationId: left,
        setupStationIds: [left],
        templateLabel: `Bypass ${middle} via ${left} -> ${right}`,
        sourceLines: [],
        blockText: buildCrossTieBlockText(left, right),
        affectedStations: [left, middle, right],
        affectedPairs: [{ from: left, to: right }],
        corridorPairs: [{ from: left, to: right }],
        addedObservationCount: 1,
        existingSetCount: 0,
        effectiveTemplateIds: [bypassTemplateId, buildCrossTieTemplateId(left, right)],
        rationale: `Directly tie ${left} to ${right} to bypass bottleneck accumulation through ${middle}.`,
        previewPoints: buildPreviewPoints(base.stations, [left, middle, right], []),
        previewSegments: [
          {
            fromStationId: left,
            toStationId: right,
            kind: 'cross-tie',
            active: false,
          },
        ],
      });
      const middleStation = base.stations[middle];
      if (
        advisoryTemplates.filter((row) => row.scenarioKind === 'decommission-intermediate').length <
          MAX_DECOMMISSION_ADVISORIES &&
        stationFixedRank(middleStation) === 0 &&
        (degreeByStation.get(middle) ?? 0) === 2 &&
        isNetworkConnectedWithOptionalBypass(graphEdges, middle, { from: left, to: right })
      ) {
        const removeSourceLines = new Set<number>();
        base.observations.forEach((obs) => {
          if (!isPreanalysisWhatIfCandidate(obs) || obs.sourceLine == null) return;
          if (observationTouchesStation(obs, middle)) {
            removeSourceLines.add(obs.sourceLine);
          }
        });
        additiveTemplates.forEach((template) => {
          const observationSourceLines = template.observationSourceLines ?? [];
          if (
            observationSourceLines.length > 0 &&
            observationSourceLines.every((line) => removeSourceLines.has(line))
          ) {
            template.sourceLines.forEach((line) => removeSourceLines.add(line));
          }
        });
        const replacedTemplateIds = additiveTemplates
          .filter((template) => template.affectedStations.includes(middle))
          .map((template) => template.id);
        advisoryTemplates.push({
          id: `preanalysis-decommission:${left}|${middle}|${right}`,
          scenarioKind: 'decommission-intermediate',
          actionMode: 'applyable-transform',
          occupyStationId: middle,
          setupStationIds: [middle],
          templateLabel: `Decommission ${middle} after ${left} -> ${right}`,
          sourceLines: [],
          blockText: buildCrossTieBlockText(left, right),
          affectedStations: [left, middle, right],
          affectedPairs: [{ from: left, to: right }],
          corridorPairs: [{ from: left, to: right }],
          addedObservationCount: 1,
          existingSetCount: 0,
          effectiveTemplateIds: [
            `preanalysis-decommission:${left}|${middle}|${right}`,
            buildCrossTieTemplateId(left, right),
          ],
          replacesTemplateIds: replacedTemplateIds,
          removeSourceLines: [...removeSourceLines].sort((a, b) => a - b),
          rationale: `If ${left} -> ${right} is added, ${middle} can be removed from the weak chain without disconnecting control.`,
          previewPoints: buildPreviewPoints(base.stations, [left, middle, right], []),
          previewSegments: [
            {
              fromStationId: left,
              toStationId: right,
              kind: 'cross-tie',
              active: false,
            },
          ],
        });
      }
    }
  });
  const isSyntheticScenario = (template: PreanalysisSyntheticSetTemplate | undefined): boolean =>
    template != null &&
    (template.scenarioKind === 'brace-point' ||
      template.scenarioKind === 'promoted-setup' ||
      template.scenarioKind === 'synthetic-setup');
  const effectiveActiveSyntheticIds = (() => {
    const activeIds = new Set<string>();
    activeTemplateIds.forEach((id) => {
      if (additiveTemplateById.has(id)) activeIds.add(id);
      const move = parseMoveScenarioId(id);
      if (!move) return;
      activeIds.delete(move.fromTemplateId);
      if (additiveTemplateById.has(move.toTemplateId)) activeIds.add(move.toTemplateId);
    });
    return [...activeIds];
  })();
  const activeSyntheticTemplates = effectiveActiveSyntheticIds
    .map((id) => additiveTemplateById.get(id))
    .filter((template): template is PreanalysisSyntheticSetTemplate => isSyntheticScenario(template));
  const moveRowCandidates: Array<PreanalysisSyntheticSetTemplate | null> = activeSyntheticTemplates
    .map((activeTemplate) => {
      const activePairKeys = new Set(
        templateCorridorPairs(activeTemplate).map((pair) => buildPairKey(pair.from, pair.to)),
      );
      const preferredCandidate = additiveTemplates.find(
        (template) =>
          isSyntheticScenario(template) &&
          template.id !== activeTemplate.id &&
          !activeTemplateIds.includes(template.id) &&
          templateCorridorPairs(template).some((pair) =>
            pathSummary.prioritizedPairKeys.has(buildPairKey(pair.from, pair.to)),
          ) &&
          templateCorridorPairs(template).some(
            (pair) => !activePairKeys.has(buildPairKey(pair.from, pair.to)),
          ),
      );
      if (!preferredCandidate) return null;
      return {
        ...preferredCandidate,
        id: `preanalysis-move:${activeTemplate.id}->${preferredCandidate.id}`,
        scenarioKind: 'move-synthetic' as const,
        actionMode: 'applyable-transform' as const,
        occupyStationId: activeTemplate.occupyStationId,
        setupStationIds: [...activeTemplate.setupStationIds],
        effectiveTemplateIds: [preferredCandidate.id],
        replacesTemplateIds: [activeTemplate.id],
        templateLabel: `Move ${activeTemplate.templateLabel} -> ${preferredCandidate.templateLabel}`,
        rationale: `Move active synthetic geometry from ${activeTemplate.templateLabel} to ${preferredCandidate.templateLabel} so it strengthens the current bottleneck corridor first.`,
      } satisfies PreanalysisSyntheticSetTemplate;
    });
  const moveRows = moveRowCandidates
    .filter((template): template is PreanalysisSyntheticSetTemplate => template != null)
    .slice(0, MAX_MOVE_SYNTHETIC_ADVISORIES);
  return [...advisoryTemplates, ...moveRows];
};
