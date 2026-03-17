import type {
  BearingKind,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  DirectiveTransitionState,
  GridDistanceInputMode,
  GridObservationMode,
  MapMode,
  Observation,
  ObservationModeSettings,
  ParseOptions,
  ReductionDistanceKind,
  ReductionInputSpace,
} from '../types';
import type { ParseInputLineEntry } from './parseIncludes';

const DEFAULT_GRID_BEARING_MODE: GridObservationMode = 'grid';
const DEFAULT_GRID_DISTANCE_MODE: GridDistanceInputMode = 'measured';
const DEFAULT_GRID_ANGLE_MODE: GridObservationMode = 'measured';
const DEFAULT_GRID_DIRECTION_MODE: GridObservationMode = 'measured';
const DEFAULT_AVERAGE_SCALE_FACTOR = 1;

export const gridDistanceModeToReductionDistanceKind = (
  mode?: GridDistanceInputMode,
): ReductionDistanceKind => {
  if (mode === 'ellipsoidal') return 'ellipsoidal';
  if (mode === 'grid') return 'grid';
  return 'ground';
};

const reductionDistanceKindToGridDistanceMode = (
  kind?: ReductionDistanceKind,
  inputSpaceDefault: ReductionInputSpace = 'measured',
): GridDistanceInputMode => {
  if (kind === 'ellipsoidal') return 'ellipsoidal';
  if (kind === 'grid') return 'grid';
  return inputSpaceDefault === 'grid' ? 'grid' : 'measured';
};

const syncObservationModeFromLegacyFields = (state: ParseOptions): void => {
  state.observationMode = {
    bearing: state.gridBearingMode ?? DEFAULT_GRID_BEARING_MODE,
    distance: state.gridDistanceMode ?? DEFAULT_GRID_DISTANCE_MODE,
    angle: state.gridAngleMode ?? DEFAULT_GRID_ANGLE_MODE,
    direction: state.gridDirectionMode ?? DEFAULT_GRID_DIRECTION_MODE,
  };
};

export const syncReductionContextFromLegacyFields = (
  state: ParseOptions,
  explicitOverrideActive = false,
): void => {
  const distanceMode = state.gridDistanceMode ?? DEFAULT_GRID_DISTANCE_MODE;
  state.reductionContext = {
    inputSpaceDefault: distanceMode === 'measured' ? 'measured' : 'grid',
    distanceKind: gridDistanceModeToReductionDistanceKind(distanceMode),
    bearingKind: (state.gridBearingMode ?? DEFAULT_GRID_BEARING_MODE) as BearingKind,
    explicitOverrideActive:
      explicitOverrideActive || state.reductionContext?.explicitOverrideActive === true,
  };
};

const syncLegacyFieldsFromObservationMode = (state: ParseOptions): void => {
  const mode = state.observationMode;
  if (!mode) return;
  const normalized: ObservationModeSettings = {
    bearing: mode.bearing ?? DEFAULT_GRID_BEARING_MODE,
    distance: mode.distance ?? DEFAULT_GRID_DISTANCE_MODE,
    angle: mode.angle ?? DEFAULT_GRID_ANGLE_MODE,
    direction: mode.direction ?? DEFAULT_GRID_DIRECTION_MODE,
  };
  state.gridBearingMode = normalized.bearing;
  state.gridDistanceMode = normalized.distance;
  state.gridAngleMode = normalized.angle;
  state.gridDirectionMode = normalized.direction;
  state.observationMode = normalized;
};

const syncLegacyFieldsFromReductionContext = (state: ParseOptions): void => {
  const context = state.reductionContext;
  if (!context) return;
  state.gridBearingMode = context.bearingKind;
  state.gridDistanceMode = reductionDistanceKindToGridDistanceMode(
    context.distanceKind,
    context.inputSpaceDefault,
  );
};

export const normalizeObservationModeState = (state: ParseOptions): void => {
  if (state.reductionContext) {
    syncLegacyFieldsFromReductionContext(state);
    syncObservationModeFromLegacyFields(state);
  } else if (state.observationMode) {
    syncLegacyFieldsFromObservationMode(state);
    syncReductionContextFromLegacyFields(state, false);
  } else {
    syncObservationModeFromLegacyFields(state);
    syncReductionContextFromLegacyFields(state, false);
  }
};

export const applyGridObservationDirective = (
  state: ParseOptions,
  mode: 'grid' | 'measured',
  parts: string[],
): string => {
  const tokens = parts.slice(1).map((token) => token.toUpperCase());
  const applyAll = tokens.length === 0;
  const resetToDefaults = tokens.some(
    (token) => token === 'OFF' || token === 'NONE' || token === 'RESET' || token === 'DEFAULT',
  );

  const setBearing = () => {
    state.gridBearingMode = mode;
  };
  const setDistance = (distanceMode?: GridDistanceInputMode) => {
    state.gridDistanceMode = distanceMode ?? (mode === 'grid' ? 'grid' : 'measured');
  };
  const setAngle = () => {
    state.gridAngleMode = mode;
  };
  const setDirection = () => {
    state.gridDirectionMode = mode;
  };

  if (applyAll) {
    setBearing();
    setDistance();
    setAngle();
    setDirection();
    syncObservationModeFromLegacyFields(state);
    syncReductionContextFromLegacyFields(state, true);
    return `${mode.toUpperCase()} mode applied to bearings/distances/angles/directions`;
  }

  if (resetToDefaults) {
    state.gridBearingMode = DEFAULT_GRID_BEARING_MODE;
    state.gridDistanceMode = DEFAULT_GRID_DISTANCE_MODE;
    state.gridAngleMode = DEFAULT_GRID_ANGLE_MODE;
    state.gridDirectionMode = DEFAULT_GRID_DIRECTION_MODE;
    syncObservationModeFromLegacyFields(state);
    syncReductionContextFromLegacyFields(state, true);
    return `${mode.toUpperCase()} mode reset to defaults: bearing=${state.gridBearingMode?.toUpperCase()}, distance=${(state.gridDistanceMode ?? 'measured').toUpperCase()}, angle=${state.gridAngleMode?.toUpperCase()}, direction=${state.gridDirectionMode?.toUpperCase()}`;
  }

  tokens.forEach((token) => {
    if (token.startsWith('BEA')) setBearing();
    else if (
      token === 'DIST=ELLIP' ||
      token === 'DIST=ELLIPSOIDAL' ||
      token === 'DIST=ELLIPSOID' ||
      token === 'DISTANCE=ELLIP' ||
      token === 'DISTANCE=ELLIPSOIDAL' ||
      token === 'DISTANCE=ELLIPSOID'
    ) {
      setDistance('ellipsoidal');
    } else if (token.startsWith('DIST')) {
      setDistance();
    } else if (token.startsWith('ANG')) {
      setAngle();
    } else if (token.startsWith('DIR')) {
      setDirection();
    }
  });
  syncObservationModeFromLegacyFields(state);
  syncReductionContextFromLegacyFields(state, true);

  return `${mode.toUpperCase()} mode updated: bearing=${state.gridBearingMode?.toUpperCase()}, distance=${(state.gridDistanceMode ?? 'measured').toUpperCase()}, angle=${state.gridAngleMode?.toUpperCase()}, direction=${state.gridDirectionMode?.toUpperCase()}`;
};

export const directiveTransitionStateFromParseState = (
  state: ParseOptions,
): DirectiveTransitionState => ({
  gridBearingMode: state.gridBearingMode ?? DEFAULT_GRID_BEARING_MODE,
  gridDistanceMode: state.gridDistanceMode ?? DEFAULT_GRID_DISTANCE_MODE,
  gridAngleMode: state.gridAngleMode ?? DEFAULT_GRID_ANGLE_MODE,
  gridDirectionMode: state.gridDirectionMode ?? DEFAULT_GRID_DIRECTION_MODE,
  averageScaleFactor: state.averageScaleFactor ?? DEFAULT_AVERAGE_SCALE_FACTOR,
  scaleOverrideActive: state.scaleOverrideActive ?? false,
});

type ApplyCoreDirectiveStateArgs = {
  op: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  logs: string[];
  orderExplicit: boolean;
  recordDirectiveTransition: (_directive: string) => void;
};

type ApplyCoreDirectiveStateResult = {
  handled: boolean;
  orderExplicit: boolean;
};

export const applyCoreDirectiveState = ({
  op,
  parts,
  lineNum,
  state,
  logs,
  orderExplicit,
  recordDirectiveTransition,
}: ApplyCoreDirectiveStateArgs): ApplyCoreDirectiveStateResult => {
  let nextOrderExplicit = orderExplicit;

  if (op === '.UNITS' && parts[1]) {
    let linearChanged = false;
    let angleChanged = false;
    parts.slice(1).forEach((rawToken) => {
      const token = rawToken.toUpperCase();
      if (
        token === 'US' ||
        token === 'FT' ||
        token === 'FEET' ||
        token === 'FOOT' ||
        token === 'FOOTS'
      ) {
        state.units = 'ft';
        linearChanged = true;
        return;
      }
      if (
        token === 'M' ||
        token === 'METER' ||
        token === 'METERS' ||
        token === 'METRE' ||
        token === 'METRES'
      ) {
        state.units = 'm';
        linearChanged = true;
        return;
      }
      if (token === 'DMS') {
        state.angleUnits = 'dms';
        angleChanged = true;
        return;
      }
      if (token === 'DD' || token === 'DEG' || token === 'DEGREES') {
        state.angleUnits = 'dd';
        angleChanged = true;
      }
    });
    if (linearChanged) logs.push(`Units set to ${state.units}`);
    if (angleChanged) logs.push(`Angle units set to ${state.angleUnits?.toUpperCase()}`);
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.SCALE') {
    const factorToken = parts[1];
    if (!factorToken) {
      state.averageScaleFactor = DEFAULT_AVERAGE_SCALE_FACTOR;
      state.scaleOverrideActive = false;
      if (state.reductionContext) {
        state.reductionContext.explicitOverrideActive = false;
      }
      logs.push(`Average scale factor reset to ${state.averageScaleFactor?.toFixed(8)}`);
      recordDirectiveTransition('.SCALE');
    } else {
      const factor = Number.parseFloat(factorToken);
      if (Number.isFinite(factor) && factor > 0) {
        state.averageScaleFactor = factor;
        state.scaleOverrideActive = true;
        if (!state.reductionContext) {
          syncReductionContextFromLegacyFields(state, true);
        } else {
          state.reductionContext.explicitOverrideActive = true;
        }
        logs.push(`Average scale factor set to ${factor.toFixed(8)}`);
        recordDirectiveTransition('.SCALE');
      } else {
        logs.push(`Warning: invalid .SCALE factor at line ${lineNum}; expected positive number.`);
      }
    }
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.MEASURED') {
    logs.push(applyGridObservationDirective(state, 'measured', parts));
    recordDirectiveTransition('.MEASURED');
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.GRID') {
    logs.push(applyGridObservationDirective(state, 'grid', parts));
    recordDirectiveTransition('.GRID');
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.COORD' && parts[1]) {
    state.coordMode = parts[1].toUpperCase() === '2D' ? '2D' : '3D';
    logs.push(`Coord mode set to ${state.coordMode}`);
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.ORDER' && parts[1]) {
    let coordOrderSet = false;
    let stationOrderSet = false;
    parts.slice(1).forEach((rawToken) => {
      const token = rawToken.toUpperCase();
      if (token === 'NE' || token === 'EN') {
        state.order = token as 'NE' | 'EN';
        coordOrderSet = true;
        return;
      }
      if (token === 'ATFROMTO' || token === 'AT-FROM-TO') {
        state.angleStationOrder = 'atfromto';
        stationOrderSet = true;
        return;
      }
      if (token === 'FROMATTO' || token === 'FROM-AT-TO') {
        state.angleStationOrder = 'fromatto';
        stationOrderSet = true;
      }
    });
    if (coordOrderSet) nextOrderExplicit = true;
    if (coordOrderSet || stationOrderSet) {
      logs.push(
        `Order set to ${state.order}; angle station order ${state.angleStationOrder?.toUpperCase()}`,
      );
    }
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.2D') {
    state.coordMode = '2D';
    state.threeReduceMode = false;
    logs.push('Coord mode forced to 2D');
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.3D') {
    state.coordMode = '3D';
    state.threeReduceMode = false;
    logs.push('Coord mode forced to 3D');
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.3REDUCE') {
    state.coordMode = '3D';
    state.threeReduceMode = true;
    logs.push(
      'Coord mode forced to 3D with 3REDUCE ON (slope/zenith reduced to horizontal-only)',
    );
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.DELTA' && parts[1]) {
    state.deltaMode = parts[1].toUpperCase() === 'ON' ? 'horiz' : 'slope';
    logs.push(`Delta mode set to ${state.deltaMode}`);
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.MAPMODE') {
    const mode = (parts[1] || '').toUpperCase();
    const mapMode: MapMode =
      mode === 'ANGLECALC' ? 'anglecalc' : mode === 'ON' || mode === 'GRID' ? 'on' : 'off';
    state.mapMode = mapMode;
    logs.push(`Map mode set to ${mapMode}`);
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.MAPSCALE' && parts[1]) {
    const factor = Number.parseFloat(parts[1]);
    if (Number.isFinite(factor) && factor > 0) {
      state.mapScaleFactor = factor;
      logs.push(`Map scale factor set to ${factor}`);
    }
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.DATA') {
    const mode = (parts[1] || '').toUpperCase();
    if (mode === 'OFF' || mode === '0' || mode === 'FALSE') {
      state.dataInputEnabled = false;
      logs.push('Data input block set to OFF');
    } else if (mode === 'ON' || mode === '1' || mode === 'TRUE') {
      state.dataInputEnabled = true;
      logs.push('Data input block set to ON');
    } else {
      logs.push(`Warning: invalid .DATA option at line ${lineNum}; expected ON or OFF.`);
    }
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  if (op === '.SEPARATOR') {
    const sepToken = parts[1];
    if (!sepToken) {
      state.stationSeparator = '-';
      logs.push('Station separator reset to "-"');
    } else {
      const separator = sepToken[0];
      state.stationSeparator = separator;
      logs.push(`Station separator set to "${separator}"`);
    }
    return { handled: true, orderExplicit: nextOrderExplicit };
  }

  return { handled: false, orderExplicit: nextOrderExplicit };
};

type FinalizeDirectiveTransitionsArgs = {
  directiveTransitions: DirectiveTransition[];
  observations: Observation[];
  lines: ParseInputLineEntry[];
  splitInlineCommentAndDescription: (_line: string) => { line: string; description?: string };
};

export const finalizeDirectiveTransitions = ({
  directiveTransitions,
  observations,
  lines,
  splitInlineCommentAndDescription,
}: FinalizeDirectiveTransitionsArgs): DirectiveNoEffectWarning[] => {
  const directiveNoEffectWarnings: DirectiveNoEffectWarning[] = [];
  if (directiveTransitions.length === 0) return directiveNoEffectWarnings;

  const observationLines = observations
    .map((obs) => obs.sourceLine)
    .filter((line): line is number => Number.isFinite(line as number));
  const hasSubsequentDataLines = (sourceLine: number): boolean => {
    for (let i = 0; i < lines.length; i += 1) {
      const rawLine = lines[i];
      if (rawLine.kind !== 'line') continue;
      if (rawLine.sourceLine <= sourceLine) continue;
      const trimmed = rawLine.raw.trim();
      if (!trimmed) continue;
      const parsedInline = splitInlineCommentAndDescription(trimmed);
      if (!parsedInline.line || parsedInline.line.startsWith('#')) continue;
      return true;
    }
    return false;
  };

  directiveTransitions.forEach((transition, index) => {
    const next = directiveTransitions[index + 1];
    transition.effectiveToLine = next ? next.line - 1 : undefined;
    transition.obsCountInRange = observationLines.filter((obsLine) => {
      if (obsLine < transition.effectiveFromLine) return false;
      if (transition.effectiveToLine == null) return true;
      return obsLine <= transition.effectiveToLine;
    }).length;
    if (transition.obsCountInRange > 0) return;
    if (!hasSubsequentDataLines(transition.line)) {
      directiveNoEffectWarnings.push({
        line: transition.line,
        directive: transition.directive,
        reason: 'noSubsequentObservations',
      });
    } else {
      directiveNoEffectWarnings.push({
        line: transition.line,
        directive: transition.directive,
        reason: 'noSubsequentObsRecords',
      });
    }
  });

  return directiveNoEffectWarnings;
};
