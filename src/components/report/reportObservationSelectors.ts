import type { Observation, AdjustmentResult } from '../../types';
import {
  buildDataCheckDiffRows,
  buildObservationSearchText,
  groupSortedObservationsByType,
  type SortedObservation,
} from '../../engine/resultDerivedModels';

type ReportObservationTypeFilter = 'all' | Observation['type'];
type ReportExclusionFilter = 'all' | 'included' | 'excluded';
type ReportQueryMatcher = (..._parts: Array<string | number | null | undefined>) => boolean;

export interface ReportObservationSelectorModel {
  directionSetCount: number;
  filteredSortedObs: SortedObservation[];
  importedGroupOptions: string[];
  observationsByType: Map<Observation['type'], SortedObservation[]>;
  dataCheckDiffRows: ReturnType<typeof buildDataCheckDiffRows>;
  blunderCycleLines: string[];
  blunderFlaggedCount: number;
  topDirectionTargetSuspects: NonNullable<AdjustmentResult['directionTargetDiagnostics']>;
  topDirectionRepeatabilitySuspects: NonNullable<
    AdjustmentResult['directionRepeatabilityDiagnostics']
  >;
  traverseLoopSuspects: NonNullable<NonNullable<AdjustmentResult['traverseDiagnostics']>['loops']>;
  gpsLoopSuspects: NonNullable<NonNullable<AdjustmentResult['gpsLoopDiagnostics']>['loops']>;
  levelingLoopSuspects: NonNullable<
    NonNullable<AdjustmentResult['levelingLoopDiagnostics']>['loops']
  >;
  levelingSegmentSuspects: NonNullable<
    NonNullable<AdjustmentResult['levelingLoopDiagnostics']>['suspectSegments']
  >;
  highlightedLevelingSegmentLines: Set<number>;
  directionRejects: NonNullable<AdjustmentResult['directionRejectDiagnostics']>;
  directionTreatmentDiagnostics: NonNullable<
    NonNullable<AdjustmentResult['parseState']>['directionSetTreatmentDiagnostics']
  >;
}

export const buildReportObservationSelectorModel = (input: {
  result: {
    observations: AdjustmentResult['observations'];
    logs: AdjustmentResult['logs'];
    directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
    directionRepeatabilityDiagnostics?: AdjustmentResult['directionRepeatabilityDiagnostics'];
    traverseDiagnostics?: AdjustmentResult['traverseDiagnostics'];
    gpsLoopDiagnostics?: AdjustmentResult['gpsLoopDiagnostics'];
    levelingLoopDiagnostics?: AdjustmentResult['levelingLoopDiagnostics'];
    directionRejectDiagnostics?: AdjustmentResult['directionRejectDiagnostics'];
    parseState?: {
      directionSetTreatmentDiagnostics?: NonNullable<
        NonNullable<AdjustmentResult['parseState']>['directionSetTreatmentDiagnostics']
      >;
    } | null;
  };
  sortedObs: SortedObservation[];
  excludedIds: Set<number>;
  reportObservationTypeFilter: ReportObservationTypeFilter;
  reportExclusionFilter: ReportExclusionFilter;
  reviewConflictOnly: boolean;
  reviewAdjustedOnly: boolean;
  reviewImportedGroupFilter: string;
  matchesReportQuery: ReportQueryMatcher;
  isDataCheck: boolean;
  isBlunderDetect: boolean;
  unitScale: number;
  units: 'm' | 'ft';
}): ReportObservationSelectorModel => {
  const directionSetCount = new Set(
    input.result.observations
      .filter(
        (obs): obs is SortedObservation & { type: 'direction'; setId: string } =>
          obs.type === 'direction' && typeof obs.setId === 'string' && obs.setId.trim() !== '',
      )
      .map((obs) => obs.setId),
  ).size;

  const filteredSortedObs = input.sortedObs.filter((obs) => {
    if (
      input.reportObservationTypeFilter !== 'all' &&
      obs.type !== input.reportObservationTypeFilter
    ) {
      return false;
    }
    if (input.reportExclusionFilter === 'included' && input.excludedIds.has(obs.id)) return false;
    if (input.reportExclusionFilter === 'excluded' && !input.excludedIds.has(obs.id)) return false;
    if (
      input.reviewImportedGroupFilter !== 'all' &&
      (input.reviewImportedGroupFilter === '__none__'
        ? Boolean(obs.sourceFile)
        : (obs.sourceFile ?? '') !== input.reviewImportedGroupFilter)
    ) {
      return false;
    }
    if (input.reviewAdjustedOnly && (obs.calc == null || obs.residual == null)) return false;
    if (input.reviewConflictOnly) {
      const absStdRes = Math.abs(obs.stdRes ?? 0);
      const localFailed = obs.localTest?.pass === false;
      if (absStdRes < 2 && !localFailed) return false;
    }
    return input.matchesReportQuery(obs.type, obs.sourceLine, buildObservationSearchText(obs));
  });

  const importedGroupOptions = [
    ...new Set(
      input.sortedObs
        .map((obs) => obs.sourceFile)
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const observationsByType = groupSortedObservationsByType(filteredSortedObs);

  const dataCheckDiffRows = input.isDataCheck
    ? buildDataCheckDiffRows(input.result.observations, {
        unitScale: input.unitScale,
        linearUnitLabel: input.units,
        linearUnitSpacer: ' ',
        limit: 25,
      })
    : [];

  const blunderCycleLines = input.isBlunderDetect
    ? input.result.logs.filter((line) => line.startsWith('Blunder cycle ')).slice(0, 15)
    : [];

  const blunderFlaggedCount = input.result.observations.filter(
    (obs) => Math.abs(obs.stdRes ?? 0) >= 3,
  ).length;

  const topDirectionTargetSuspects = [...(input.result.directionTargetDiagnostics ?? [])]
    .filter((d) => d.localPass === false || (d.stdRes ?? 0) >= 2 || (d.rawSpreadArcSec ?? 0) >= 5)
    .slice(0, 20);

  const topDirectionRepeatabilitySuspects = [
    ...(input.result.directionRepeatabilityDiagnostics ?? []),
  ]
    .filter(
      (d) =>
        d.localFailCount > 0 || (d.maxStdRes ?? 0) >= 2 || (d.maxRawSpreadArcSec ?? 0) >= 5,
    )
    .slice(0, 20);

  const traverseLoopSuspects = (input.result.traverseDiagnostics?.loops ?? [])
    .filter(
      (loop) =>
        !loop.pass ||
        (loop.linearPpm ?? 0) >
          (input.result.traverseDiagnostics?.thresholds?.maxLinearPpm ?? 0) * 0.8,
    )
    .slice(0, 20);

  const gpsLoopSuspects = (input.result.gpsLoopDiagnostics?.loops ?? [])
    .filter((loop) => !loop.pass)
    .slice(0, 20);

  const levelingLoopSuspects = (input.result.levelingLoopDiagnostics?.loops ?? [])
    .filter((loop) => !loop.pass)
    .slice(0, 20);

  const levelingSegmentSuspects = (input.result.levelingLoopDiagnostics?.suspectSegments ?? []).slice(
    0,
    10,
  );

  const highlightedLevelingSegmentLines = new Set(
    levelingSegmentSuspects
      .map((segment) => segment.sourceLine)
      .filter((line): line is number => line != null),
  );

  const directionRejects = [...(input.result.directionRejectDiagnostics ?? [])].sort((a, b) => {
    const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
    const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    const sa = a.setId ?? '';
    const sb = b.setId ?? '';
    return sa.localeCompare(sb);
  });

  const directionTreatmentDiagnostics = [
    ...(input.result.parseState?.directionSetTreatmentDiagnostics ?? []),
  ].sort((a, b) => {
    const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
    const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
    if (la !== lb) return la - lb;
    if (a.setId !== b.setId) return a.setId.localeCompare(b.setId);
    return a.occupy.localeCompare(b.occupy);
  });

  return {
    directionSetCount,
    filteredSortedObs,
    importedGroupOptions,
    observationsByType,
    dataCheckDiffRows,
    blunderCycleLines,
    blunderFlaggedCount,
    topDirectionTargetSuspects,
    topDirectionRepeatabilitySuspects,
    traverseLoopSuspects,
    gpsLoopSuspects,
    levelingLoopSuspects,
    levelingSegmentSuspects,
    highlightedLevelingSegmentLines,
    directionRejects,
    directionTreatmentDiagnostics,
  };
};
