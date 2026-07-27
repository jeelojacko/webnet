import type { HandleFieldObservationRecordArgs } from './parseFieldObservationRecords.types';
import type { GpsTopoCoordinateShot } from '../types';

export const handleFieldGpsTopoRecord = ({
  code,
  parts,
  lineNum,
  state,
  logs,
  linearToMetersFactor,
}: HandleFieldObservationRecordArgs): boolean => {
  if (code !== 'GS') return false;

  const pointId = parts[1];
  if (!pointId) {
    logs.push(`Invalid GS record at line ${lineNum}, missing point identifier.`);
    return true;
  }
  const payload = parts.slice(2);
  let fromId: string | undefined;
  const numericTokens: string[] = [];
  payload.forEach((token) => {
    if (/^FROM=/i.test(token)) {
      const candidate = token.split('=').slice(1).join('=').trim();
      if (candidate) fromId = candidate;
      return;
    }
    numericTokens.push(token);
  });
  if (numericTokens.length < 2) {
    logs.push(`Invalid GS record at line ${lineNum}, expected at least E/N coordinates.`);
    return true;
  }
  const c1 = parseFloat(numericTokens[0]);
  const c2 = parseFloat(numericTokens[1]);
  if (!Number.isFinite(c1) || !Number.isFinite(c2)) {
    logs.push(`Invalid GS coordinate token(s) at line ${lineNum}, skipping.`);
    return true;
  }
  const tail = numericTokens.slice(2).map((token) => parseFloat(token));
  if (tail.some((value) => !Number.isFinite(value))) {
    logs.push(`Invalid GS numeric payload at line ${lineNum}, skipping.`);
    return true;
  }
  const toMeters = linearToMetersFactor();
  const east = state.order === 'EN' ? c1 * toMeters : c2 * toMeters;
  const north = state.order === 'EN' ? c2 * toMeters : c1 * toMeters;
  let height: number | undefined;
  let sigma1: number | undefined;
  let sigma2: number | undefined;
  let sigmaH: number | undefined;
  if (tail.length === 1) {
    height = tail[0] * toMeters;
  } else if (tail.length === 2) {
    sigma1 = tail[0] * toMeters;
    sigma2 = tail[1] * toMeters;
  } else if (tail.length === 3) {
    height = tail[0] * toMeters;
    sigma1 = tail[1] * toMeters;
    sigma2 = tail[2] * toMeters;
  } else if (tail.length >= 4) {
    height = tail[0] * toMeters;
    sigma1 = tail[1] * toMeters;
    sigma2 = tail[2] * toMeters;
    sigmaH = tail[3] * toMeters;
    if (tail.length > 4) {
      logs.push(`Warning: extra GS tokens ignored at line ${lineNum} (expected up to sigmaH).`);
    }
  }
  const sigmaE = state.order === 'EN' ? sigma1 : sigma2;
  const sigmaN = state.order === 'EN' ? sigma2 : sigma1;
  const shot: GpsTopoCoordinateShot = {
    pointId,
    east,
    north,
    height,
    sigmaE,
    sigmaN,
    sigmaH,
    fromId,
    sourceLine: lineNum,
  };
  state.gpsTopoShots?.push(shot);
  return true;
};
