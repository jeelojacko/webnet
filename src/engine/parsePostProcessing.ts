import {
  finalizeDirectiveTransitions,
  normalizeObservationModeState,
} from './parseDirectiveState';
import { summarizeReductionUsage } from './reductionUsageSummary';
import type { ParseInputLineEntry } from './parseIncludes';
import type {
  AliasTraceEntry,
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

type ResolveAlias = (_id: StationId) => { canonicalId: StationId; reference?: string };
type AddAliasTrace = (
  _sourceId: StationId,
  _canonicalId: StationId,
  _context: AliasTraceEntry['context'],
  _sourceLine?: number,
  _detail?: string,
  _reference?: string,
) => void;
type ApplyFixities = (
  _station: StationMap[string],
  _fix: { x?: boolean; y?: boolean; h?: boolean },
  _coordMode: ParseOptions['coordMode'],
) => void;

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
  if (explicitAliasCount > 0 || aliasRuleCount > 0) {
    const remapObservation = (obs: Observation): void => {
      if (obs.type === 'angle') {
        const at = resolveAlias(obs.at);
        addAliasTrace(obs.at, at.canonicalId, 'observation', obs.sourceLine, `${obs.type}.at`, at.reference);
        obs.at = at.canonicalId;
        const from = resolveAlias(obs.from);
        addAliasTrace(
          obs.from,
          from.canonicalId,
          'observation',
          obs.sourceLine,
          `${obs.type}.from`,
          from.reference,
        );
        obs.from = from.canonicalId;
        const to = resolveAlias(obs.to);
        addAliasTrace(obs.to, to.canonicalId, 'observation', obs.sourceLine, `${obs.type}.to`, to.reference);
        obs.to = to.canonicalId;
      } else if (obs.type === 'direction') {
        const at = resolveAlias(obs.at);
        addAliasTrace(obs.at, at.canonicalId, 'observation', obs.sourceLine, `${obs.type}.at`, at.reference);
        obs.at = at.canonicalId;
        const to = resolveAlias(obs.to);
        addAliasTrace(obs.to, to.canonicalId, 'observation', obs.sourceLine, `${obs.type}.to`, to.reference);
        obs.to = to.canonicalId;
      } else if (
        obs.type === 'dist' ||
        obs.type === 'bearing' ||
        obs.type === 'dir' ||
        obs.type === 'gps' ||
        obs.type === 'lev' ||
        obs.type === 'zenith'
      ) {
        const from = resolveAlias(obs.from);
        addAliasTrace(
          obs.from,
          from.canonicalId,
          'observation',
          obs.sourceLine,
          `${obs.type}.from`,
          from.reference,
        );
        obs.from = from.canonicalId;
        const to = resolveAlias(obs.to);
        addAliasTrace(obs.to, to.canonicalId, 'observation', obs.sourceLine, `${obs.type}.to`, to.reference);
        obs.to = to.canonicalId;
      }
      if (obs.calc != null && typeof obs.calc === 'object') {
        const calcMeta = obs.calc as { backsightId?: StationId };
        if (calcMeta.backsightId) {
          const bs = resolveAlias(calcMeta.backsightId);
          addAliasTrace(
            calcMeta.backsightId,
            bs.canonicalId,
            'sideshot-backsight',
            obs.sourceLine,
            `${obs.type}.backsight`,
            bs.reference,
          );
          calcMeta.backsightId = bs.canonicalId;
        }
      }
    };

    observations.forEach(remapObservation);
    state.gpsTopoShots?.forEach((shot) => {
      const target = resolveAlias(shot.pointId);
      addAliasTrace(shot.pointId, target.canonicalId, 'observation', shot.sourceLine, 'GS.point', target.reference);
      shot.pointId = target.canonicalId;
      if (shot.fromId) {
        const from = resolveAlias(shot.fromId);
        addAliasTrace(shot.fromId, from.canonicalId, 'observation', shot.sourceLine, 'GS.from', from.reference);
        shot.fromId = from.canonicalId;
      }
    });
    directionRejectDiagnostics.forEach((diag) => {
      const occupy = resolveAlias(diag.occupy);
      addAliasTrace(
        diag.occupy,
        occupy.canonicalId,
        'direction-reject',
        diag.sourceLine,
        `${diag.recordType ?? 'UNKNOWN'}.occupy`,
        occupy.reference,
      );
      diag.occupy = occupy.canonicalId;
      if (diag.target) {
        const target = resolveAlias(diag.target);
        addAliasTrace(
          diag.target,
          target.canonicalId,
          'direction-reject',
          diag.sourceLine,
          `${diag.recordType ?? 'UNKNOWN'}.target`,
          target.reference,
        );
        diag.target = target.canonicalId;
      }
    });

    const isPlaceholderStation = (station: StationMap[string]): boolean =>
      Math.abs(station.x) <= 1e-12 &&
      Math.abs(station.y) <= 1e-12 &&
      Math.abs(station.h) <= 1e-12 &&
      (station.sx == null || Math.abs(station.sx) <= 1e-12) &&
      (station.sy == null || Math.abs(station.sy) <= 1e-12) &&
      (station.sh == null || Math.abs(station.sh) <= 1e-12) &&
      station.constraintCorrXY == null &&
      station.constraintX == null &&
      station.constraintY == null &&
      station.constraintH == null &&
      !(station.fixedX ?? false) &&
      !(station.fixedY ?? false) &&
      !(station.fixedH ?? false);

    const mergeStation = (
      target: StationMap[string],
      incoming: StationMap[string],
      incomingId: StationId,
      canonicalId: StationId,
    ): void => {
      const targetPlaceholder = isPlaceholderStation(target);
      const incomingPlaceholder = isPlaceholderStation(incoming);
      if (targetPlaceholder && !incomingPlaceholder) {
        Object.assign(target, incoming);
      } else {
        const hasConflict =
          !incomingPlaceholder &&
          (Math.abs(target.x - incoming.x) > 1e-6 ||
            Math.abs(target.y - incoming.y) > 1e-6 ||
            (state.coordMode === '3D' && Math.abs(target.h - incoming.h) > 1e-6));
        if (hasConflict) {
          logs.push(
            `Warning: alias merge ${incomingId} -> ${canonicalId} has conflicting coordinates; keeping first station definition.`,
          );
        }
      }
      const fixedX = (target.fixedX ?? false) || (incoming.fixedX ?? false);
      const fixedY = (target.fixedY ?? false) || (incoming.fixedY ?? false);
      const fixedH = (target.fixedH ?? false) || (incoming.fixedH ?? false);
      applyFixities(target, { x: fixedX, y: fixedY, h: fixedH }, state.coordMode);
      if (target.sx == null && incoming.sx != null) target.sx = incoming.sx;
      else if (target.sx != null && incoming.sx != null) target.sx = Math.min(target.sx, incoming.sx);
      if (target.sy == null && incoming.sy != null) target.sy = incoming.sy;
      else if (target.sy != null && incoming.sy != null) target.sy = Math.min(target.sy, incoming.sy);
      if (target.sh == null && incoming.sh != null) target.sh = incoming.sh;
      else if (target.sh != null && incoming.sh != null) target.sh = Math.min(target.sh, incoming.sh);
      if (target.constraintX == null && incoming.constraintX != null) target.constraintX = incoming.constraintX;
      if (target.constraintY == null && incoming.constraintY != null) target.constraintY = incoming.constraintY;
      if (target.constraintH == null && incoming.constraintH != null) target.constraintH = incoming.constraintH;
      if (target.constraintCorrXY == null && incoming.constraintCorrXY != null) {
        target.constraintCorrXY = incoming.constraintCorrXY;
      }
      if (target.constraintModeX == null && incoming.constraintModeX != null) target.constraintModeX = incoming.constraintModeX;
      if (target.constraintModeY == null && incoming.constraintModeY != null) target.constraintModeY = incoming.constraintModeY;
      if (target.constraintModeH == null && incoming.constraintModeH != null) target.constraintModeH = incoming.constraintModeH;
      if (target.heightType == null && incoming.heightType != null) target.heightType = incoming.heightType;
      if (target.latDeg == null && incoming.latDeg != null) target.latDeg = incoming.latDeg;
      if (target.lonDeg == null && incoming.lonDeg != null) target.lonDeg = incoming.lonDeg;
    };

    const remappedStations: StationMap = {};
    let renamedStationCount = 0;
    Object.entries(stations).forEach(([id, station]) => {
      const stationAlias = resolveAlias(id);
      const canonicalId = stationAlias.canonicalId;
      if (canonicalId !== id) renamedStationCount += 1;
      addAliasTrace(id, canonicalId, 'station', undefined, 'station.id', stationAlias.reference);
      const existing = remappedStations[canonicalId];
      if (!existing) remappedStations[canonicalId] = { ...station };
      else mergeStation(existing, station, id, canonicalId);
    });
    Object.keys(stations).forEach((id) => delete stations[id]);
    Object.assign(stations, remappedStations);
    logs.push(
      `Alias canonicalization applied (explicit=${explicitAliasCount}, rules=${aliasRuleCount}, station remaps=${renamedStationCount}).`,
    );
  }

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
