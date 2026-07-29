import { handleGeodeticControlRecord } from './parseGeodeticControlRecords';
import type { HandleControlRecordArgs } from './parseControlRecordTypes';
import {
  createEmptyStation,
  logFixityWarnings,
  parseControlFixityTail,
  parseNumericSlot,
  shouldSkipLegacyPlanarHeightPlaceholder,
} from './parseControlRecordUtils';

export const handleControlRecord = (args: HandleControlRecordArgs): boolean => {
  const {
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
  } = args;
  if (code === 'C') {
    const id = parts[1];
    const tokens = parts.slice(2);
    const is3D = state.coordMode === '3D';
    const coordCount = is3D ? 3 : 2;
    const coordTokens = tokens.slice(0, coordCount);
    const rawConstraintTokens = tokens.slice(coordCount);
    const constraintTokens =
      !is3D && shouldSkipLegacyPlanarHeightPlaceholder(rawConstraintTokens)
        ? rawConstraintTokens.slice(1)
        : rawConstraintTokens;
    const sigmaTokens = constraintTokens.slice(0, coordCount);
    const coords = coordTokens.map((token) => Number.parseFloat(token));
    const north = state.order === 'NE' ? (coords[0] ?? 0) : (coords[1] ?? 0);
    const east = state.order === 'NE' ? (coords[1] ?? 0) : (coords[0] ?? 0);
    const h = is3D ? (coords[2] ?? 0) : 0;
    const fixityState = parseControlFixityTail(constraintTokens, coordCount, parseFixityTokens);
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

    const seN =
      state.order === 'NE' ? parseNumericSlot(sigmaTokens[0]) : parseNumericSlot(sigmaTokens[1]);
    const seE =
      state.order === 'NE' ? parseNumericSlot(sigmaTokens[1]) : parseNumericSlot(sigmaTokens[0]);
    const seH = is3D ? parseNumericSlot(sigmaTokens[2]) : undefined;
    const corrXY = parseConstraintCorrToken(parseNumericSlot(constraintTokens[coordCount]));
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

  if (handleGeodeticControlRecord(args)) return true;

  if (code === 'CH' || code === 'EH') {
    const id = parts[1];
    const tokens = parts.slice(2);
    const is3D = state.coordMode === '3D';
    const coordCount = is3D ? 3 : 2;
    const coordTokens = tokens.slice(0, coordCount);
    const rawConstraintTokens = tokens.slice(coordCount);
    const constraintTokens =
      !is3D && shouldSkipLegacyPlanarHeightPlaceholder(rawConstraintTokens)
        ? rawConstraintTokens.slice(1)
        : rawConstraintTokens;
    const sigmaTokens = constraintTokens.slice(0, coordCount);
    const coords = coordTokens.map((token) => Number.parseFloat(token));
    const north = state.order === 'NE' ? (coords[0] ?? 0) : (coords[1] ?? 0);
    const east = state.order === 'NE' ? (coords[1] ?? 0) : (coords[0] ?? 0);
    const h = is3D ? (coords[2] ?? 0) : (coords[0] ?? 0);
    const fixityState = parseControlFixityTail(constraintTokens, coordCount, parseFixityTokens);
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

    const seN =
      state.order === 'NE' ? parseNumericSlot(sigmaTokens[0]) : parseNumericSlot(sigmaTokens[1]);
    const seE =
      state.order === 'NE' ? parseNumericSlot(sigmaTokens[1]) : parseNumericSlot(sigmaTokens[0]);
    const seH = is3D ? parseNumericSlot(sigmaTokens[2]) : undefined;
    const corrXY = parseConstraintCorrToken(parseNumericSlot(constraintTokens[coordCount]));
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
    const elev = parseNumericSlot(tokens[0]) ?? 0;
    const constraintTokens = tokens.slice(1);
    const stdErr = parseNumericSlot(constraintTokens[0]) ?? 0;
    const fixityState = parseFixityTokens(constraintTokens, 1);
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
