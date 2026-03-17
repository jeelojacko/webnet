import { projectGeodeticToEN } from './geodesy';
import type {
  CoordInputClass,
  ParseOptions,
  StationId,
  StationMap,
} from '../types';

type ControlComponentMode = 'inherit' | 'fixed' | 'free';

type FixityParseResult = {
  componentModes: ControlComponentMode[];
  fixities: boolean[];
  hasFreeMarkers: boolean;
  legacyStarFixed: boolean;
};

type HandleControlRecordArgs = {
  code: string;
  parts: string[];
  lineNum: number;
  state: ParseOptions;
  stations: StationMap;
  logs: string[];
  isNumericToken: (_token: string) => boolean;
  parseFixityTokens: (_tokens: string[], _componentCount: number) => FixityParseResult;
  parseConstraintCorrToken: (_value: number | undefined) => number | undefined;
  applyFixities: (
    _station: StationMap[string],
    _fix: { x?: boolean; y?: boolean; h?: boolean },
    _coordMode: ParseOptions['coordMode'],
  ) => void;
  clearStationConstraintComponent: (
    _station: StationMap[string],
    _component: 'x' | 'y' | 'h',
  ) => void;
  setStationConstraintMode: (
    _station: StationMap[string],
    _component: 'x' | 'y' | 'h',
    _mode: StationMap[string]['constraintModeX'],
  ) => void;
  resolveStationConstraintMode: (
    _explicitMode: ControlComponentMode,
    _fixed: boolean,
    _hasConstraint: boolean,
  ) => StationMap[string]['constraintModeX'];
  assignStationCoordClass: (
    _station: StationMap[string],
    _id: StationId,
    _coordClass: CoordInputClass,
    _context: string,
  ) => void;
  linearToMetersFactor: () => number;
  toDegrees: (_token: string) => number;
  activeCrsProjectionModel: (_state: ParseOptions) => ParseOptions['crsProjectionModel'];
};

const createEmptyStation = (): StationMap[string] =>
  ({
    x: 0,
    y: 0,
    h: 0,
    fixed: false,
    fixedX: false,
    fixedY: false,
    fixedH: false,
  }) as StationMap[string];

const logFixityWarnings = (
  logs: string[],
  lineNum: number,
  fixityState: Pick<FixityParseResult, 'hasFreeMarkers' | 'legacyStarFixed'>,
): void => {
  if (fixityState.legacyStarFixed) {
    logs.push(
      `Warning: legacy lone "*" fixity at line ${lineNum} treated as fixed. Prefer "!" for fixed components.`,
    );
  }
  if (fixityState.hasFreeMarkers) {
    logs.push(
      `Free-marker control components at line ${lineNum} release fixed/weighted constraints for marked coordinates.`,
    );
  }
};

export const handleControlRecord = ({
  code,
  parts,
  lineNum,
  state,
  stations,
  logs,
  isNumericToken,
  parseFixityTokens,
  parseConstraintCorrToken,
  applyFixities,
  clearStationConstraintComponent,
  setStationConstraintMode,
  resolveStationConstraintMode,
  assignStationCoordClass,
  linearToMetersFactor,
  toDegrees,
  activeCrsProjectionModel,
}: HandleControlRecordArgs): boolean => {
  if (code === 'C') {
    const id = parts[1];
    const tokens = parts.slice(2);
    const numeric = tokens.filter(isNumericToken).map((p) => Number.parseFloat(p));
    const is3D = state.coordMode === '3D';
    const coordCount = is3D ? 3 : 2;
    const coords = numeric.slice(0, coordCount);
    const stds = numeric.slice(coordCount);
    const north = state.order === 'NE' ? (coords[0] ?? 0) : (coords[1] ?? 0);
    const east = state.order === 'NE' ? (coords[1] ?? 0) : (coords[0] ?? 0);
    const h = is3D ? (coords[2] ?? 0) : 0;
    const fixityState = parseFixityTokens(tokens, coordCount);
    logFixityWarnings(logs, lineNum, fixityState);

    const fixN = state.order === 'NE' ? fixityState.fixities[0] : fixityState.fixities[1];
    const fixE = state.order === 'NE' ? fixityState.fixities[1] : fixityState.fixities[0];
    const fixH = is3D ? fixityState.fixities[2] : false;
    const modeN =
      state.order === 'NE' ? fixityState.componentModes[0] : fixityState.componentModes[1];
    const modeE =
      state.order === 'NE' ? fixityState.componentModes[1] : fixityState.componentModes[0];
    const modeH = is3D ? fixityState.componentModes[2] : 'inherit';
    const toMeters = linearToMetersFactor();
    const station = stations[id] ?? createEmptyStation();
    station.x = east * toMeters;
    station.y = north * toMeters;
    if (is3D) station.h = h * toMeters;
    assignStationCoordClass(
      station,
      id,
      state.coordSystemMode === 'grid' ? 'grid' : 'local',
      `C record line ${lineNum}`,
    );

    applyFixities(
      station,
      { x: fixE, y: fixN, h: is3D ? fixH : undefined },
      state.coordMode,
    );
    if (modeE !== 'inherit') clearStationConstraintComponent(station, 'x');
    if (modeN !== 'inherit') clearStationConstraintComponent(station, 'y');
    if (is3D && modeH !== 'inherit') clearStationConstraintComponent(station, 'h');

    const seN = state.order === 'NE' ? stds[0] : stds[1];
    const seE = state.order === 'NE' ? stds[1] : stds[0];
    const seH = is3D ? stds[2] : undefined;
    const corrXY = parseConstraintCorrToken(stds[is3D ? 3 : 2]);
    if (modeE !== 'free' && !station.fixedX && seE) {
      station.sx = seE * toMeters;
      station.constraintX = station.x;
    }
    if (modeN !== 'free' && !station.fixedY && seN) {
      station.sy = seN * toMeters;
      station.constraintY = station.y;
    }
    if (
      modeE !== 'free' &&
      modeN !== 'free' &&
      !station.fixedX &&
      !station.fixedY &&
      station.sx != null &&
      station.sy != null &&
      corrXY != null
    ) {
      station.constraintCorrXY = corrXY;
    }
    if (is3D && modeH !== 'free' && !station.fixedH && seH) {
      station.sh = seH * toMeters;
      station.constraintH = station.h;
    }
    setStationConstraintMode(
      station,
      'x',
      resolveStationConstraintMode(modeE, station.fixedX ?? false, station.constraintX != null),
    );
    setStationConstraintMode(
      station,
      'y',
      resolveStationConstraintMode(modeN, station.fixedY ?? false, station.constraintY != null),
    );
    if (is3D) {
      setStationConstraintMode(
        station,
        'h',
        resolveStationConstraintMode(modeH, station.fixedH ?? false, station.constraintH != null),
      );
    }

    stations[id] = station;
    return true;
  }

  if (code === 'P' || code === 'PH') {
    const id = parts[1];
    const latDeg = toDegrees(parts[2]);
    let lonDeg = toDegrees(parts[3]);
    if (state.lonSign === 'west-positive') {
      lonDeg = -lonDeg;
    }
    const tokens = parts.slice(2);
    const restNumeric = parts
      .slice(4)
      .filter(isNumericToken)
      .map((p) => Number.parseFloat(p));
    const coordCount = state.coordMode === '3D' ? 3 : 2;
    const elev = state.coordMode === '3D' ? (restNumeric[0] ?? 0) : 0;
    const seN = state.coordMode === '3D' ? (restNumeric[1] ?? 0) : (restNumeric[0] ?? 0);
    const seE = state.coordMode === '3D' ? (restNumeric[2] ?? 0) : (restNumeric[1] ?? 0);
    const seH = state.coordMode === '3D' ? (restNumeric[3] ?? 0) : 0;
    const corrXY = parseConstraintCorrToken(restNumeric[state.coordMode === '3D' ? 4 : 2]);
    const fixityState = parseFixityTokens(tokens, coordCount);
    logFixityWarnings(logs, lineNum, fixityState);
    const modeN = fixityState.componentModes[0];
    const modeE = fixityState.componentModes[1];
    const modeH = coordCount === 3 ? fixityState.componentModes[2] : 'inherit';

    if (state.originLatDeg == null || state.originLonDeg == null) {
      state.originLatDeg = latDeg;
      state.originLonDeg = lonDeg;
      logs.push(`P origin set to ${latDeg.toFixed(6)}, ${lonDeg.toFixed(6)}`);
    }
    const projectionModel = activeCrsProjectionModel(state) ?? 'legacy-equirectangular';
    const { east, north, model } = projectGeodeticToEN({
      latDeg,
      lonDeg,
      originLatDeg: state.originLatDeg ?? latDeg,
      originLonDeg: state.originLonDeg ?? lonDeg,
      model: projectionModel,
      coordSystemMode: state.coordSystemMode,
      crsId: state.crsId,
    });
    const toMeters = linearToMetersFactor();
    const station = stations[id] ?? createEmptyStation();
    station.x = east;
    station.y = north;
    station.h = elev * toMeters;
    station.latDeg = latDeg;
    station.lonDeg = lonDeg;
    station.heightType = code === 'PH' ? 'ellipsoid' : 'orthometric';
    assignStationCoordClass(
      station,
      id,
      state.crsId ? 'geodetic' : 'unknown',
      `${code} record line ${lineNum}`,
    );
    applyFixities(
      station,
      {
        x: fixityState.fixities[1] ?? false,
        y: fixityState.fixities[0] ?? false,
        h: coordCount === 3 ? fixityState.fixities[2] : undefined,
      },
      state.coordMode,
    );
    if (modeE !== 'inherit') clearStationConstraintComponent(station, 'x');
    if (modeN !== 'inherit') clearStationConstraintComponent(station, 'y');
    if (coordCount === 3 && modeH !== 'inherit') clearStationConstraintComponent(station, 'h');
    if (modeN !== 'free' && !station.fixedY && seN) {
      station.sy = seN * toMeters;
      station.constraintY = station.y;
    }
    if (modeE !== 'free' && !station.fixedX && seE) {
      station.sx = seE * toMeters;
      station.constraintX = station.x;
    }
    if (
      modeE !== 'free' &&
      modeN !== 'free' &&
      !station.fixedX &&
      !station.fixedY &&
      station.sx != null &&
      station.sy != null &&
      corrXY != null
    ) {
      station.constraintCorrXY = corrXY;
    }
    if (state.coordMode === '3D' && modeH !== 'free' && !station.fixedH && seH) {
      station.sh = seH * toMeters;
      station.constraintH = station.h;
    }
    setStationConstraintMode(
      station,
      'x',
      resolveStationConstraintMode(modeE, station.fixedX ?? false, station.constraintX != null),
    );
    setStationConstraintMode(
      station,
      'y',
      resolveStationConstraintMode(modeN, station.fixedY ?? false, station.constraintY != null),
    );
    if (state.coordMode === '3D') {
      setStationConstraintMode(
        station,
        'h',
        resolveStationConstraintMode(modeH, station.fixedH ?? false, station.constraintH != null),
      );
    }
    stations[id] = station;
    if (state.coordSystemMode === 'grid') {
      logs.push(
        `P record projected to grid EN (meters) for ${id} using CRS=${state.crsId ?? 'unknown'} (model=${model})`,
      );
    } else if (state.crsTransformEnabled) {
      logs.push(
        `P record projected to local EN (meters) for ${id} using ${model} (CRS="${state.crsLabel || 'unnamed'}")`,
      );
    } else {
      logs.push(`P record projected to local EN (meters) for ${id}`);
    }
    return true;
  }

  if (code === 'CH' || code === 'EH') {
    const id = parts[1];
    const tokens = parts.slice(2);
    const numeric = tokens.filter(isNumericToken).map((p) => Number.parseFloat(p));
    const is3D = state.coordMode === '3D';
    const coordCount = is3D ? 3 : 2;
    const coords = numeric.slice(0, coordCount);
    const stds = numeric.slice(coordCount);
    const north = state.order === 'NE' ? (coords[0] ?? 0) : (coords[1] ?? 0);
    const east = state.order === 'NE' ? (coords[1] ?? 0) : (coords[0] ?? 0);
    const h = is3D ? (coords[2] ?? 0) : (coords[0] ?? 0);
    const fixityState = parseFixityTokens(tokens, coordCount);
    logFixityWarnings(logs, lineNum, fixityState);
    const toMeters = linearToMetersFactor();
    const station = stations[id] ?? createEmptyStation();
    station.x = east * toMeters;
    station.y = north * toMeters;
    station.h = h * toMeters;
    station.heightType = 'ellipsoid';

    const fixN = state.order === 'NE' ? fixityState.fixities[0] : fixityState.fixities[1];
    const fixE = state.order === 'NE' ? fixityState.fixities[1] : fixityState.fixities[0];
    const fixH = is3D ? fixityState.fixities[2] : false;
    const modeN =
      state.order === 'NE' ? fixityState.componentModes[0] : fixityState.componentModes[1];
    const modeE =
      state.order === 'NE' ? fixityState.componentModes[1] : fixityState.componentModes[0];
    const modeH = is3D ? fixityState.componentModes[2] : 'inherit';
    applyFixities(
      station,
      { x: fixE, y: fixN, h: is3D ? fixH : undefined },
      state.coordMode,
    );
    if (modeE !== 'inherit') clearStationConstraintComponent(station, 'x');
    if (modeN !== 'inherit') clearStationConstraintComponent(station, 'y');
    if (is3D && modeH !== 'inherit') clearStationConstraintComponent(station, 'h');

    const seN = state.order === 'NE' ? stds[0] : stds[1];
    const seE = state.order === 'NE' ? stds[1] : stds[0];
    const seH = is3D ? stds[2] : undefined;
    const corrXY = parseConstraintCorrToken(stds[is3D ? 3 : 2]);
    if (modeE !== 'free' && !station.fixedX && seE) {
      station.sx = seE * toMeters;
      station.constraintX = station.x;
    }
    if (modeN !== 'free' && !station.fixedY && seN) {
      station.sy = seN * toMeters;
      station.constraintY = station.y;
    }
    if (
      modeE !== 'free' &&
      modeN !== 'free' &&
      !station.fixedX &&
      !station.fixedY &&
      station.sx != null &&
      station.sy != null &&
      corrXY != null
    ) {
      station.constraintCorrXY = corrXY;
    }
    if (is3D && modeH !== 'free' && !station.fixedH && seH) {
      station.sh = seH * toMeters;
      station.constraintH = station.h;
    }
    setStationConstraintMode(
      station,
      'x',
      resolveStationConstraintMode(modeE, station.fixedX ?? false, station.constraintX != null),
    );
    setStationConstraintMode(
      station,
      'y',
      resolveStationConstraintMode(modeN, station.fixedY ?? false, station.constraintY != null),
    );
    if (is3D) {
      setStationConstraintMode(
        station,
        'h',
        resolveStationConstraintMode(modeH, station.fixedH ?? false, station.constraintH != null),
      );
    }

    stations[id] = station;
    return true;
  }

  if (code === 'E') {
    const id = parts[1];
    const tokens = parts.slice(2);
    const numeric = tokens.filter(isNumericToken).map((p) => Number.parseFloat(p));
    const elev = numeric[0] ?? 0;
    const stdErr = numeric[1] ?? 0;
    const fixityState = parseFixityTokens(tokens, 1);
    logFixityWarnings(logs, lineNum, fixityState);
    const fixH = fixityState.fixities[0] ?? false;
    const modeH = fixityState.componentModes[0];
    const toMeters = linearToMetersFactor();
    const station = stations[id] ?? createEmptyStation();
    station.h = elev * toMeters;
    applyFixities(station, { h: fixH }, state.coordMode);
    if (modeH !== 'inherit') clearStationConstraintComponent(station, 'h');
    if (modeH !== 'free' && !station.fixedH && stdErr) {
      station.sh = stdErr * toMeters;
      station.constraintH = station.h;
    }
    setStationConstraintMode(
      station,
      'h',
      resolveStationConstraintMode(modeH, station.fixedH ?? false, station.constraintH != null),
    );
    stations[id] = station;
    return true;
  }

  return false;
};
