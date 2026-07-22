import { FT_PER_M } from './parseTokenHelpers';
import {
  gridDistanceModeToReductionDistanceKind,
} from './parseDirectiveState';
import { parseAngleTokenRad } from './parseTokenHelpers';
import type {
  CoordInputClass,
  GridDistanceInputMode,
  GridObservationMode,
  Observation,
  ParseCompatibilityDiagnosticCode,
  ParseCompatibilityMode,
  ParseOptions,
  ReductionDistanceKind,
  ReductionInputSpace,
  StationId,
  StationMap,
} from '../types';

type ParsePosition = { lineNum: number; currentSourceFile: string; displayLineCount: number };

type CreateParseObservationHelpersOptions = {
  addCompatibilityDiagnostic: (
    _code: ParseCompatibilityDiagnosticCode,
    _line: number,
    _recordType: string,
    _message: string,
    _rewriteSuggestion?: string,
    _fallbackApplied?: boolean,
    _severity?: 'warning' | 'error',
  ) => void;
  compatibilityMode: ParseCompatibilityMode;
  getLostStationIds: () => Set<StationId>;
  logs: string[];
  observations: Observation[];
  parsePosition: ParsePosition;
  preanalysisMode: boolean;
  state: ParseOptions;
  stations: StationMap;
};

export const createParseObservationHelpers = ({
  addCompatibilityDiagnostic,
  compatibilityMode,
  getLostStationIds,
  logs,
  observations,
  parsePosition,
  preanalysisMode,
  state,
  stations,
}: CreateParseObservationHelpersOptions) => {
  const autoCreatedStations = new Set<StationId>();
  const rejectedAutoCreateTokens = new Set<string>();
  const currentGridModeForType = (
    obsType: Observation['type'],
  ): {
    gridObsMode?: GridObservationMode;
    gridDistanceMode?: GridDistanceInputMode;
    inputSpace?: ReductionInputSpace;
    distanceKind?: ReductionDistanceKind;
  } => {
    if (obsType === 'dist') {
      const distanceMode = state.gridDistanceMode ?? 'measured';
      return {
        gridObsMode: distanceMode === 'measured' ? 'measured' : 'grid',
        gridDistanceMode: distanceMode,
        inputSpace: distanceMode === 'measured' ? 'measured' : 'grid',
        distanceKind: gridDistanceModeToReductionDistanceKind(distanceMode),
      };
    }
    if (obsType === 'bearing' || obsType === 'dir') {
      const gridObsMode = state.gridBearingMode ?? 'grid';
      return { gridObsMode, inputSpace: gridObsMode };
    }
    if (obsType === 'angle') {
      const gridObsMode = state.gridAngleMode ?? 'measured';
      return { gridObsMode, inputSpace: gridObsMode };
    }
    if (obsType === 'direction') {
      const gridObsMode = state.gridDirectionMode ?? 'measured';
      return { gridObsMode, inputSpace: gridObsMode };
    }
    return {};
  };
  const looksLikeNumericMeasurement = (token: string): boolean =>
    /^[+-]?\d+\.\d+(?:[eE][+-]?\d+)?$/.test(token);
  const isPlannedToken = (token?: string): boolean => preanalysisMode && token?.trim() === '?';
  const linearToMetersFactor = (): number =>
    (state.units === 'ft' ? 1 / FT_PER_M : 1) * (state.linearMultiplier ?? 1);
  const effectiveDistanceMode = (): 'slope' | 'horiz' =>
    state.threeReduceMode && state.deltaMode === 'slope' ? 'horiz' : state.deltaMode;
  const parseObservedLinearToken = (
    token: string | undefined,
    toMeters: number,
  ): { value: number; planned: boolean; valid: boolean } => {
    if (preanalysisMode && (token == null || token.trim() === '')) {
      return { value: 0, planned: true, valid: true };
    }
    if (isPlannedToken(token)) return { value: 0, planned: true, valid: true };
    const parsed = parseFloat(token ?? '');
    if (!Number.isFinite(parsed)) return { value: 0, planned: false, valid: false };
    return { value: parsed * toMeters, planned: false, valid: true };
  };
  const parseObservedAngleToken = (
    token: string | undefined,
    fallbackMode: 'dms' | 'dd',
  ): { value: number; planned: boolean; valid: boolean } => {
    if (preanalysisMode && (token == null || token.trim() === '')) {
      return { value: 0, planned: true, valid: true };
    }
    if (isPlannedToken(token)) return { value: 0, planned: true, valid: true };
    const parsed = parseAngleTokenRad(token, state, fallbackMode);
    if (!Number.isFinite(parsed)) return { value: 0, planned: false, valid: false };
    return { value: parsed, planned: false, valid: true };
  };
  const isIntegerLikeToken = (token: string): boolean => /^[+-]?\d+$/.test(token.trim());
  const scoreDistanceCandidate = (candidate: {
    instCode: string;
    from: string;
    to: string;
    distToken: string;
    setId: string;
    explicitInst: boolean;
  }): number => {
    let score = 0;
    if (candidate.distToken.includes('.') || candidate.distToken.includes('?')) score += 2;
    if (candidate.setId) score += 1;
    if (isIntegerLikeToken(candidate.from)) score += 1;
    if (isIntegerLikeToken(candidate.to)) score += 1;
    if (candidate.setId && isIntegerLikeToken(candidate.from) && isIntegerLikeToken(candidate.to)) {
      score += 2;
    }
    if (stations[candidate.from]) score += 2;
    if (stations[candidate.to]) score += 2;
    if (candidate.explicitInst && candidate.instCode && !stations[candidate.instCode]) score += 1;
    if (
      candidate.explicitInst &&
      !candidate.setId &&
      /^[A-Za-z_]/.test(candidate.from) &&
      isIntegerLikeToken(candidate.to)
    ) {
      score -= 2;
    }
    if (looksLikeNumericMeasurement(candidate.from) || looksLikeNumericMeasurement(candidate.to)) {
      score -= 12;
    }
    return score;
  };
  const rejectNumericStationTokens = (
    recordType: string,
    sourceLine: number,
    stationTokens: Array<{ role: string; value: string }>,
  ): boolean => {
    const bad = stationTokens.find((row) => looksLikeNumericMeasurement(row.value));
    if (!bad) return false;
    addCompatibilityDiagnostic(
      'NUMERIC_STATION_TOKEN_REJECTED',
      sourceLine,
      recordType,
      `token "${bad.value}" for ${bad.role} looks like a measurement, not a station id`,
      `Rewrite ${recordType} with explicit station tokens and keep numeric values in observation fields only.`,
      false,
      compatibilityMode === 'strict' ? 'error' : 'warning',
    );
    return compatibilityMode === 'strict';
  };
  const ensureStation = (id: StationId, context: string): void => {
    if (!id) return;
    if (stations[id]) return;
    if (looksLikeNumericMeasurement(id)) {
      if (!rejectedAutoCreateTokens.has(id)) {
        rejectedAutoCreateTokens.add(id);
        logs.push(
          `Warning: skipped auto-create for token "${id}" from ${context}; looks like a numeric value, not a station id.`,
        );
      }
      return;
    }
    stations[id] = {
      x: 0,
      y: 0,
      h: 0,
      coordInputClass: 'unknown',
      lost: getLostStationIds().has(id),
      fixed: false,
      fixedX: false,
      fixedY: false,
      fixedH: false,
    };
    if (!autoCreatedStations.has(id)) {
      autoCreatedStations.add(id);
      logs.push(
        `Auto-created station ${id} from ${context} with default approximate coordinates (0,0,0).`,
      );
    }
  };
  const ensureObservationStations = (obs: Observation): void => {
    const isSideshot =
      typeof obs.calc === 'object' &&
      obs.calc != null &&
      'sideshot' in obs.calc &&
      Boolean((obs.calc as { sideshot?: boolean }).sideshot);
    const isGpsSideshot = obs.type === 'gps' && obs.gpsMode === 'sideshot';
    if (isSideshot || isGpsSideshot) return;
    if (obs.type === 'angle') {
      ensureStation(obs.at, `${obs.type} observation`);
      ensureStation(obs.from, `${obs.type} observation`);
      ensureStation(obs.to, `${obs.type} observation`);
      return;
    }
    if (obs.type === 'direction') {
      ensureStation(obs.at, `${obs.type} observation`);
      ensureStation(obs.to, `${obs.type} observation`);
      return;
    }
    if (
      obs.type === 'dist' ||
      obs.type === 'bearing' ||
      obs.type === 'dir' ||
      obs.type === 'gps' ||
      obs.type === 'lev' ||
      obs.type === 'zenith'
    ) {
      ensureStation(obs.from, `${obs.type} observation`);
      ensureStation(obs.to, `${obs.type} observation`);
    }
  };
  const assignStationCoordClass = (
    station: StationMap[string],
    stationId: StationId,
    incomingClass: CoordInputClass,
    context: string,
  ): void => {
    const existingClass = station.coordInputClass;
    if (!existingClass) {
      station.coordInputClass = incomingClass;
      return;
    }
    if (incomingClass === 'unknown') return;
    if (existingClass === 'unknown') {
      station.coordInputClass = incomingClass;
      return;
    }
    if (existingClass === incomingClass) return;
    station.coordInputClass = 'unknown';
    logs.push(
      `Warning: station ${stationId} has mixed coordinate classes (${existingClass} vs ${incomingClass}) from ${context}; marked as UNKNOWN class.`,
    );
  };
  const pushObservation = <T extends Observation>(obs: T): void => {
    ensureObservationStations(obs);
    if (obs.sourceLine == null) obs.sourceLine = parsePosition.lineNum;
    if (!obs.sourceFile) obs.sourceFile = parsePosition.currentSourceFile;
    const gridMode = currentGridModeForType(obs.type);
    if (obs.gridObsMode == null && gridMode.gridObsMode != null) {
      obs.gridObsMode = gridMode.gridObsMode;
    }
    if (obs.type === 'dist' && obs.gridDistanceMode == null && gridMode.gridDistanceMode != null) {
      obs.gridDistanceMode = gridMode.gridDistanceMode;
    }
    if (obs.inputSpace == null && gridMode.inputSpace != null) {
      obs.inputSpace = gridMode.inputSpace;
    }
    if (obs.type === 'dist' && obs.distanceKind == null && gridMode.distanceKind != null) {
      obs.distanceKind = gridMode.distanceKind;
    }
    if (obs.planned) {
      state.plannedObservationCount = (state.plannedObservationCount ?? 0) + 1;
    }
    if (obs.type === 'dist' || obs.type === 'zenith') {
      const prismEnabled = state.prismEnabled ?? false;
      const prismOffset = Number.isFinite(state.prismOffset ?? NaN) ? (state.prismOffset ?? 0) : 0;
      const prismScope: ParseOptions['prismScope'] = state.prismScope ?? 'global';
      const setScopedSetId = typeof obs.setId === 'string' ? obs.setId.trim() : '';
      const scopedBlocked = prismScope === 'set' && setScopedSetId.length === 0;
      if (prismEnabled && Math.abs(prismOffset) > 0 && !scopedBlocked) {
        obs.prismCorrectionM = prismOffset;
        obs.prismScope = prismScope;
      }
    }
    observations.push(obs);
  };


  return {
    assignStationCoordClass,
    effectiveDistanceMode,
    linearToMetersFactor,
    looksLikeNumericMeasurement,
    parseObservedAngleToken,
    parseObservedLinearToken,
    pushObservation,
    rejectNumericStationTokens,
    scoreDistanceCandidate,
  };
};

export type ParseObservationHelpers = ReturnType<typeof createParseObservationHelpers>;
