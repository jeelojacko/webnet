import {
  finalizeDirectiveTransitions,
  normalizeObservationModeState,
} from './parseDirectiveState';
import {
  applyAliasPostProcessing,
  type AddAliasTrace,
  type ApplyFixities,
  type ResolveAlias,
} from './parsePostProcessingAliases';
import { summarizeReductionUsage } from './reductionUsageSummary';
import type { ParseInputLineEntry } from './parseIncludes';
import type {
  DescriptionTraceEntry,
  DirectionRejectDiagnostic,
  DirectionSetTreatmentDiagnostic,
  GpsObservation,
  Observation,
  ParseCompatibilityDiagnostic,
  ParseCompatibilityMode,
  ParseOptions,
  StationMap,
  StationId,
} from '../types';

const normalizeDescriptionKey = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();

export interface FinalizeParsePostProcessingArgs {
  stations: StationMap;
  observations: Observation[];
  state: ParseOptions;
  logs: string[];
  resolveAlias: ResolveAlias;
  addAliasTrace: AddAliasTrace;
  applyFixities: ApplyFixities;
  lostStationIds: Set<StationId>;
  explicitAliasCount: number;
  aliasRuleCount: number;
  directionRejectDiagnostics: DirectionRejectDiagnostic[];
  aliasTraceEntries: NonNullable<ParseOptions['aliasTrace']>;
  descriptionTraceEntries: NonNullable<ParseOptions['descriptionTrace']>;
  orderExplicit: boolean;
  preanalysisMode: boolean;
  compatibilityMode: ParseCompatibilityMode;
  compatibilityAcceptedNoOps: Set<string>;
  compatibilityDiagnostics: ParseCompatibilityDiagnostic[];
  ambiguousCount: number;
  legacyFallbackCount: number;
  strictRejectCount: number;
  rewriteSuggestionCount: number;
  directiveTransitions: NonNullable<ParseOptions['directiveTransitions']>;
  directiveNoEffectWarnings: NonNullable<ParseOptions['directiveNoEffectWarnings']>;
  inputLines: ParseInputLineEntry[];
  splitInlineCommentAndDescription: (_line: string) => { line: string; description?: string };
  directionSetTreatmentDiagnostics: DirectionSetTreatmentDiagnostic[];
  defaultDescriptionReconcileMode: 'first' | 'append';
  defaultDescriptionAppendDelimiter: string;
}

export interface FinalizeParsePostProcessingResult {
  unknowns: StationId[];
}

export const finalizeParsePostProcessing = ({
  stations,
  observations,
  state,
  logs,
  resolveAlias,
  addAliasTrace,
  applyFixities,
  lostStationIds,
  explicitAliasCount,
  aliasRuleCount,
  directionRejectDiagnostics,
  aliasTraceEntries,
  descriptionTraceEntries,
  orderExplicit,
  preanalysisMode,
  compatibilityMode,
  compatibilityAcceptedNoOps,
  compatibilityDiagnostics,
  ambiguousCount,
  legacyFallbackCount,
  strictRejectCount,
  rewriteSuggestionCount,
  directiveTransitions,
  directiveNoEffectWarnings,
  inputLines,
  splitInlineCommentAndDescription,
  directionSetTreatmentDiagnostics,
  defaultDescriptionReconcileMode,
  defaultDescriptionAppendDelimiter,
}: FinalizeParsePostProcessingArgs): FinalizeParsePostProcessingResult => {
  applyAliasPostProcessing({
    stations,
    observations,
    state,
    logs,
    resolveAlias,
    addAliasTrace,
    applyFixities,
    explicitAliasCount,
    aliasRuleCount,
    directionRejectDiagnostics,
  });

  if (lostStationIds.size > 0) {
    const canonicalLost = new Set<StationId>();
    lostStationIds.forEach((id) => {
      const resolved = resolveAlias(id);
      if (resolved.canonicalId) canonicalLost.add(resolved.canonicalId);
    });
    lostStationIds.clear();
    canonicalLost.forEach((id) => lostStationIds.add(id));
  }
  Object.entries(stations).forEach(([id, station]) => {
    if (lostStationIds.has(id)) station.lost = true;
    else if (station.lost) delete station.lost;
  });
  state.lostStationIds = [...lostStationIds].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (state.lostStationIds.length > 0) {
    logs.push(`Lost stations flagged: ${state.lostStationIds.join(', ')}`);
  }

  state.aliasTrace = aliasTraceEntries
    .slice()
    .sort(
      (a, b) =>
        (a.sourceLine ?? Number.MAX_SAFE_INTEGER) - (b.sourceLine ?? Number.MAX_SAFE_INTEGER) ||
        a.context.localeCompare(b.context) ||
        a.sourceId.localeCompare(b.sourceId),
    );
  state.descriptionTrace = descriptionTraceEntries
    .map((entry) => ({
      ...entry,
      stationId: resolveAlias(entry.stationId).canonicalId || entry.stationId,
    }))
    .sort((a, b) => a.sourceLine - b.sourceLine || a.stationId.localeCompare(b.stationId));

  const descriptionSummaryMap = new Map<
    StationId,
    { recordCount: number; sourceLines: number[]; uniqueDescriptions: Map<string, string> }
  >();
  state.descriptionTrace.forEach((entry) => {
    const row = descriptionSummaryMap.get(entry.stationId) ?? {
      recordCount: 0,
      sourceLines: [],
      uniqueDescriptions: new Map<string, string>(),
    };
    row.recordCount += 1;
    row.sourceLines.push(entry.sourceLine);
    const key = normalizeDescriptionKey(entry.description);
    if (key && !row.uniqueDescriptions.has(key)) {
      row.uniqueDescriptions.set(key, entry.description);
    }
    descriptionSummaryMap.set(entry.stationId, row);
  });
  state.descriptionScanSummary = [...descriptionSummaryMap.entries()]
    .map(([stationId, row]) => ({
      stationId,
      recordCount: row.recordCount,
      uniqueCount: row.uniqueDescriptions.size,
      conflict: row.uniqueDescriptions.size > 1,
      descriptions: [...row.uniqueDescriptions.values()],
      sourceLines: row.sourceLines.slice().sort((a, b) => a - b),
    }))
    .sort((a, b) => a.stationId.localeCompare(b.stationId, undefined, { numeric: true }));
  state.descriptionRepeatedStationCount = state.descriptionScanSummary.filter((row) => row.recordCount > 1).length;
  state.descriptionConflictCount = state.descriptionScanSummary.filter((row) => row.conflict).length;
  const descriptionReconcileMode =
    (state.descriptionReconcileMode ?? defaultDescriptionReconcileMode) as 'first' | 'append';
  const descriptionDelimiter = state.descriptionAppendDelimiter ?? defaultDescriptionAppendDelimiter;
  state.descriptionReconcileMode = descriptionReconcileMode;
  state.descriptionAppendDelimiter = descriptionDelimiter;
  const reconciledDescriptions: Record<StationId, string> = {};
  state.descriptionScanSummary.forEach((row) => {
    if (row.descriptions.length === 0) return;
    reconciledDescriptions[row.stationId] =
      descriptionReconcileMode === 'append'
        ? row.descriptions.join(descriptionDelimiter)
        : row.descriptions[0];
  });
  state.reconciledDescriptions = reconciledDescriptions;
  if (state.descriptionTrace.length > 0) {
    logs.push(
      `Description scan: records=${state.descriptionTrace.length}, stations=${state.descriptionScanSummary.length}, repeated=${state.descriptionRepeatedStationCount}, conflicts=${state.descriptionConflictCount}.`,
    );
    logs.push(
      `Description reconciliation: mode=${descriptionReconcileMode.toUpperCase()} delimiter="${descriptionDelimiter}"`,
    );
    state.descriptionScanSummary
      .filter((row) => row.conflict)
      .slice(0, 10)
      .forEach((row) => {
        logs.push(
          `Description conflict ${row.stationId} at lines ${row.sourceLines.join(', ')}: ${row.descriptions.join(' | ')}`,
        );
      });
    if ((state.descriptionConflictCount ?? 0) > 10) {
      logs.push(`Description conflicts not shown: ${(state.descriptionConflictCount ?? 0) - 10}`);
    }
  }

  const unknowns = Object.keys(stations).filter((id) => {
    const station = stations[id];
    if (!station) return false;
    const fixedX = station.fixedX ?? false;
    const fixedY = station.fixedY ?? false;
    const fixedH = station.fixedH ?? false;
    return state.coordMode === '2D' ? !(fixedX && fixedY) : !(fixedX && fixedY && fixedH);
  });
  const typeSummary = observations.reduce<Record<string, number>>((acc, observation) => {
    acc[observation.type] = (acc[observation.type] ?? 0) + 1;
    return acc;
  }, {});

  if (!orderExplicit) {
    logs.push(
      `Warning: .ORDER not specified; using ${state.order}. If your coordinates are North East, add ".ORDER NE".`,
    );
  }
  if (directionRejectDiagnostics.length > 0) {
    logs.push(`Direction rejects: ${directionRejectDiagnostics.length}`);
  }
  if (directionSetTreatmentDiagnostics.length > 0) {
    logs.push(`Direction set treatment diagnostics: ${directionSetTreatmentDiagnostics.length}`);
  }
  if (preanalysisMode) {
    logs.push(`Preanalysis parsing: mode=ON, planned observations=${state.plannedObservationCount ?? 0}`);
  }
  state.gpsOffsetObservationCount = observations.filter(
    (observation): observation is GpsObservation =>
      observation.type === 'gps' && observation.gpsOffsetDistanceM != null,
  ).length;
  if ((state.gpsOffsetObservationCount ?? 0) > 0) {
    logs.push(`GPS rover offsets parsed: ${state.gpsOffsetObservationCount}`);
  }

  normalizeObservationModeState(state);
  directiveNoEffectWarnings.push(
    ...finalizeDirectiveTransitions({
      directiveTransitions,
      observations,
      lines: inputLines,
      splitInlineCommentAndDescription,
    }),
  );
  state.directiveTransitions = directiveTransitions;
  state.directiveNoEffectWarnings = directiveNoEffectWarnings;
  state.parsedUsageSummary = summarizeReductionUsage(observations);
  state.usedInSolveUsageSummary = undefined;
  state.compatibilityAcceptedNoOpDirectives = [...compatibilityAcceptedNoOps].sort();
  state.directionSetTreatmentDiagnostics = directionSetTreatmentDiagnostics
    .slice()
    .sort((a, b) => a.setId.localeCompare(b.setId) || a.occupy.localeCompare(b.occupy));
  state.parseCompatibilityDiagnostics = compatibilityDiagnostics;
  state.ambiguousCount = ambiguousCount;
  state.legacyFallbackCount = legacyFallbackCount;
  state.strictRejectCount = strictRejectCount;
  state.rewriteSuggestionCount = rewriteSuggestionCount;
  if ((state.includeErrors?.length ?? 0) > 0) {
    logs.push(
      `Include errors: ${state.includeErrors?.length} (missing/cycle/depth issues make this run invalid).`,
    );
  }
  directiveNoEffectWarnings.forEach((warning) => {
    logs.push(`Warning: ${warning.directive} at line ${warning.line} had no effect (${warning.reason}).`);
  });
  logs.push(
    `Parse compatibility: mode=${compatibilityMode}, ambiguous=${ambiguousCount}, fallbacks=${legacyFallbackCount}, strictRejects=${strictRejectCount}, rewrites=${rewriteSuggestionCount}`,
  );
  logs.push(`Counts: ${Object.entries(typeSummary).map(([key, value]) => `${key}=${value}`).join(', ')}`);
  logs.push(`Stations: ${Object.keys(stations).length} (unknown: ${unknowns.length}). Obs: ${observations.length}`);

  return { unknowns };
};
