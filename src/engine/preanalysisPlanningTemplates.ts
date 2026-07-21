import { isPreanalysisWhatIfCandidate } from './preanalysis';
import { buildPathPrioritySummary } from './preanalysisPathPriority';
import type { AdjustmentResult, Observation, PlanningMapState } from '../types';
import {
  removeInputSourceLines,
  resolveAppliedPreanalysisActionState,
  type PreanalysisSyntheticSetTemplate,
} from './preanalysisPlanningShared';
import {
  buildPreviewPoints,
  buildTemplateId,
  buildTemplateLabel,
  createSyntheticStationAllocator,
} from './preanalysisPlanningGeometry';
import { buildAdvisoryTemplates } from './preanalysisPlanningAdvisories';
import {
  buildBraceTemplates,
  buildCrossTieTemplates,
  buildPromotedSetupTemplates,
  buildSyntheticSetupTemplates,
} from './preanalysisPlanningTemplateFamilies';

export const buildPreanalysisSyntheticSetTemplates = (
  input: string,
  base: AdjustmentResult,
  planningMap: PlanningMapState,
  activeTemplateIds: string[] = [],
): PreanalysisSyntheticSetTemplate[] => {
  const lines = input.split(/\r?\n/);
  const originalLineCount = lines.length;
  const observations = base.observations.filter(
    (obs) =>
      isPreanalysisWhatIfCandidate(obs) &&
      obs.setId != null &&
      obs.sourceLine != null &&
      obs.sourceLine >= 1 &&
      obs.sourceLine <= originalLineCount,
  );
  const setGroups = new Map<string, Observation[]>();
  observations.forEach((obs) => {
    const key = String(obs.setId);
    const group = setGroups.get(key);
    if (group) group.push(obs);
    else setGroups.set(key, [obs]);
  });

  const deduped = new Map<string, PreanalysisSyntheticSetTemplate>();
  [...setGroups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .forEach(([, setObservations]) => {
      const sourceLines = [...new Set(setObservations.map((obs) => obs.sourceLine ?? 0))]
        .filter((line) => line > 0)
        .sort((left, right) => left - right);
      if (sourceLines.length === 0) return;
      let startLine = sourceLines[0];
      let endLine = sourceLines[sourceLines.length - 1];
      while (startLine > 1) {
        const prior = lines[startLine - 2]?.trim().toUpperCase() ?? '';
        if (prior.startsWith('DB ')) {
          startLine -= 1;
          break;
        }
        if (prior === 'DE') break;
        startLine -= 1;
      }
      while (endLine < originalLineCount) {
        const next = lines[endLine]?.trim().toUpperCase() ?? '';
        if (next === 'DE') {
          endLine += 1;
          break;
        }
        endLine += 1;
      }
      const blockLines = lines.slice(startLine - 1, endLine).filter((line) => line.trim().length > 0);
      if (blockLines.length === 0) return;
      const occupyStationId =
        setObservations.find((obs) => 'at' in obs)?.at ??
        setObservations.find((obs) => 'from' in obs)?.from;
      if (!occupyStationId) return;
      const targetIds = [...new Set(
        setObservations.flatMap((obs) => {
          if ('at' in obs && 'to' in obs) return [obs.to];
          if ('from' in obs && 'to' in obs && obs.from === occupyStationId) return [obs.to];
          return [];
        }),
      )];
      if (targetIds.length === 0) return;
      const affectedStations = [occupyStationId, ...targetIds];
      const affectedPairs = targetIds.map((targetId) => ({ from: occupyStationId, to: targetId }));
      const id = buildTemplateId(occupyStationId, targetIds);
      const blockText = blockLines.join('\n');
      const existing = deduped.get(id);
      if (existing) {
        existing.existingSetCount += 1;
        return;
      }
      deduped.set(id, {
        id,
        scenarioKind: 'existing-set',
        actionMode: 'applyable-addition',
        occupyStationId,
        setupStationIds: [occupyStationId],
        templateLabel: buildTemplateLabel(occupyStationId, targetIds),
        sourceLines: Array.from(
          { length: Math.max(0, endLine - startLine + 1) },
          (_, idx) => startLine + idx,
        ),
        observationSourceLines: [...sourceLines],
        blockText,
        affectedStations,
        affectedPairs,
        corridorPairs: affectedPairs.map((pair) => ({ ...pair })),
        addedObservationCount: setObservations.length,
        existingSetCount: 1,
        rationale: `Repeat the ${occupyStationId} setup set to strengthen the current control path through its existing observations.`,
        previewPoints: buildPreviewPoints(base.stations, affectedStations, []),
        previewSegments: targetIds.map((targetId) => ({
          fromStationId: occupyStationId,
          toStationId: targetId,
          kind: 'sight-line' as const,
          active: false,
        })),
      });
    });

  const repeatedSetTemplates = [...deduped.values()].sort(
    (left, right) =>
      left.occupyStationId.localeCompare(right.occupyStationId, undefined, { numeric: true }) ||
      left.templateLabel.localeCompare(right.templateLabel, undefined, { numeric: true }),
  );
  const stationAllocator = createSyntheticStationAllocator(base.stations);
  const pathSummary = buildPathPrioritySummary(base);
  const additiveTemplates = [
    ...repeatedSetTemplates,
    ...(planningMap.scenarioFamilies.bracePoint
      ? buildBraceTemplates(base, repeatedSetTemplates, planningMap, stationAllocator, pathSummary)
      : []),
    ...buildPromotedSetupTemplates(
      base,
      repeatedSetTemplates,
      planningMap,
      stationAllocator,
      pathSummary,
    ),
    ...buildSyntheticSetupTemplates(
      base,
      repeatedSetTemplates,
      planningMap,
      stationAllocator,
      pathSummary,
    ),
    ...buildCrossTieTemplates(base, repeatedSetTemplates, planningMap, pathSummary),
  ];
  return [
    ...additiveTemplates,
    ...buildAdvisoryTemplates(
      base,
      additiveTemplates,
      planningMap,
      activeTemplateIds,
      pathSummary,
    ),
  ];
};

export const buildSyntheticPreanalysisInput = (
  input: string,
  activeTemplateIds: string[],
  templates: PreanalysisSyntheticSetTemplate[],
): string => {
  if (activeTemplateIds.length === 0) return input;
  const actionState = resolveAppliedPreanalysisActionState(templates, activeTemplateIds);
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const baseInput = removeInputSourceLines(input, actionState.removedSourceLines);
  const appendedBlocks = actionState.normalizedScenarioIds
    .map((id, index) => {
      const template = templateById.get(id);
      if (
        !template ||
        (template.actionMode !== 'applyable-addition' &&
          template.actionMode !== 'applyable-transform')
      ) {
        return null;
      }
      return [
        `# WEBNET_PREANALYSIS_ADDED_SET ${template.id} ${index + 1}`,
        template.blockText,
      ].join('\n');
    })
    .filter((block): block is string => block != null);
  if (appendedBlocks.length === 0) return baseInput;
  return `${baseInput.trimEnd()}\n\n${appendedBlocks.join('\n\n')}\n`;
};
