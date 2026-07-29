import { projectGeodeticToEN } from './geodesy';
import type { HandleControlRecordArgs } from './parseControlRecordTypes';
import {
  createEmptyStation,
  logFixityWarnings,
  parseControlFixityTail,
  parseNumericSlot,
} from './parseControlRecordUtils';

export const handleGeodeticControlRecord = ({
  code,
  parts,
  lineNum,
  state,
  stations,
  logs,
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
  if (code !== 'P' && code !== 'PH') return false;

  const id = parts[1];
  const latDeg = toDegrees(parts[2]);
  let lonDeg = toDegrees(parts[3]);
  if (state.lonSign === 'west-positive') {
    lonDeg = -lonDeg;
  }
  const valueTokens = parts.slice(4);
  const coordCount = state.coordMode === '3D' ? 3 : 2;
  const elev = state.coordMode === '3D' ? (parseNumericSlot(valueTokens[0]) ?? 0) : 0;
  const constraintTokens = state.coordMode === '3D' ? valueTokens.slice(1) : valueTokens;
  const sigmaTokens = constraintTokens.slice(0, coordCount);
  const seN =
    state.coordMode === '3D'
      ? (parseNumericSlot(sigmaTokens[0]) ?? 0)
      : (parseNumericSlot(sigmaTokens[0]) ?? 0);
  const seE =
    state.coordMode === '3D'
      ? (parseNumericSlot(sigmaTokens[1]) ?? 0)
      : (parseNumericSlot(sigmaTokens[1]) ?? 0);
  const seH = state.coordMode === '3D' ? (parseNumericSlot(sigmaTokens[2]) ?? 0) : 0;
  const corrXY = parseConstraintCorrToken(
    parseNumericSlot(constraintTokens[coordCount]),
  );
  const fixityState = parseControlFixityTail(constraintTokens, coordCount, parseFixityTokens);
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
};
