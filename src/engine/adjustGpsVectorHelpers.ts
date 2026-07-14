import { DEG_TO_RAD } from './angles';
import {
  transformFactoredEcefDeltaCovarianceToLocalEnu,
} from './geodesy';
import {
  invertMatrix3,
  transformSymmetricCovariance3,
} from './adjustGpsMath';
import type {
  GpsCovariance,
  GpsSolveVector,
} from './adjustTypes';
import type {
  GnssVectorFrame,
  GpsObservation,
  StationId,
  StationMap,
} from '../types';

export const gpsRoverOffsetVector = (
  obs: GpsObservation,
): {
  dE: number;
  dN: number;
  dH: number;
  horizDistance: number;
  applied: boolean;
} => {
  const dE = Number.isFinite(obs.gpsOffsetDeltaE ?? Number.NaN)
    ? (obs.gpsOffsetDeltaE as number)
    : 0;
  const dN = Number.isFinite(obs.gpsOffsetDeltaN ?? Number.NaN)
    ? (obs.gpsOffsetDeltaN as number)
    : 0;
  const dH = Number.isFinite(obs.gpsOffsetDeltaH ?? Number.NaN)
    ? (obs.gpsOffsetDeltaH as number)
    : 0;
  const horizDistance = Math.hypot(dE, dN);
  return {
    dE,
    dN,
    dH,
    horizDistance,
    applied: horizDistance > 1e-12 || Math.abs(dH) > 1e-12,
  };
};

export const plannedGpsRawVector = ({
  is2D,
  obs,
  stations,
}: {
  is2D: boolean;
  obs: GpsObservation;
  stations: StationMap;
}): { dE: number; dN: number; dU?: number } => {
  const from = stations[obs.from];
  const to = stations[obs.to];
  if (!from || !to) return { dE: 0, dN: 0, dU: 0 };
  const offset = gpsRoverOffsetVector(obs);
  const dE = to.x - from.x - offset.dE;
  const dN = to.y - from.y - offset.dN;
  const dU = !is2D ? to.h - from.h - offset.dH : undefined;
  const horizGround = Math.hypot(dE, dN);
  if (horizGround <= 1e-12) return { dE, dN, dU };

  const hi = Number.isFinite(obs.gpsAntennaHiM ?? Number.NaN) ? (obs.gpsAntennaHiM as number) : 0;
  const ht = Number.isFinite(obs.gpsAntennaHtM ?? Number.NaN) ? (obs.gpsAntennaHtM as number) : 0;
  const deltaGround = to.h - offset.dH - from.h;
  const deltaAntenna = deltaGround + (ht - hi);
  const rawHorizSq =
    horizGround * horizGround + deltaGround * deltaGround - deltaAntenna * deltaAntenna;
  if (!Number.isFinite(rawHorizSq) || rawHorizSq <= 1e-12) {
    return { dE, dN, dU };
  }
  const rawHoriz = Math.sqrt(rawHorizSq);
  const scale = rawHoriz / horizGround;
  if (!Number.isFinite(scale) || scale <= 0) return { dE, dN, dU };
  return { dE: dE * scale, dN: dN * scale, dU };
};

export const gpsUsesLocalSolveFrame = (frame: GnssVectorFrame): boolean =>
  frame === 'enuLocal' || frame === 'llhBaseline' || frame === 'ecefDelta';

export const applyGpsVerticalDeflection = (
  vector: Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>>,
  northSec = 0,
  eastSec = 0,
): Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>> => {
  const xi = (northSec / 3600) * DEG_TO_RAD;
  const eta = (eastSec / 3600) * DEG_TO_RAD;
  if (
    (!Number.isFinite(xi) || Math.abs(xi) <= 1e-16) &&
    (!Number.isFinite(eta) || Math.abs(eta) <= 1e-16)
  ) {
    return vector;
  }
  return {
    dE: vector.dE - eta * vector.dU,
    dN: vector.dN - xi * vector.dU,
    dU: vector.dU + eta * vector.dE + xi * vector.dN,
  };
};

export const buildGpsDisplayResidualTransform = ({
  eastSec = 0,
  frame,
  northSec = 0,
}: {
  eastSec?: number;
  frame: GnssVectorFrame;
  northSec?: number;
}): number[][] | null => {
  const xi = (northSec / 3600) * DEG_TO_RAD;
  const eta = (eastSec / 3600) * DEG_TO_RAD;
  const needsDeflectionUndo =
    gpsUsesLocalSolveFrame(frame) && (Math.abs(xi) > 1e-16 || Math.abs(eta) > 1e-16);
  const deflectionInverse = needsDeflectionUndo
    ? invertMatrix3([
        [1, 0, -eta],
        [0, 1, -xi],
        [eta, xi, 1],
      ])
    : null;
  return gpsUsesLocalSolveFrame(frame) ? deflectionInverse : null;
};

export const transformGpsCovarianceToSolveFrame = ({
  componentCount,
  eastSec = 0,
  frame,
  obs,
  stationGeodetic,
  northSec = 0,
}: {
  componentCount: number;
  eastSec?: number;
  frame: GnssVectorFrame;
  obs: GpsObservation;
  stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
  northSec?: number;
}): GpsCovariance | null => {
  if (componentCount < 3 || !obs.gpsCovariance3d) return null;
  const { cXX, cYY, cZZ, cXY, cXZ, cYZ } = obs.gpsCovariance3d;
  let cEE = cXX;
  let cNN = cYY;
  let cUU = cZZ;
  let cEN = cXY;
  let cEU = cXZ;
  let cNU = cYZ;

  if (frame === 'ecefDelta') {
    const geo = stationGeodetic(obs.from) ?? stationGeodetic(obs.to);
    if (!geo) return null;
    const transformed = transformFactoredEcefDeltaCovarianceToLocalEnu(
      obs.gpsCovariance3d,
      geo.latDeg,
      geo.lonDeg,
      obs.gpsVectorHorizontalFactor,
      obs.gpsVectorVerticalFactor,
    );
    cEE = transformed.cEE;
    cEN = transformed.cEN;
    cEU = transformed.cEU;
    cNN = transformed.cNN;
    cNU = transformed.cNU;
    cUU = transformed.cUU;
  }

  const xi = (northSec / 3600) * DEG_TO_RAD;
  const eta = (eastSec / 3600) * DEG_TO_RAD;
  if (Math.abs(xi) > 1e-16 || Math.abs(eta) > 1e-16) {
    const d = [
      [1, 0, -eta],
      [0, 1, -xi],
      [eta, xi, 1],
    ];
    const q = [
      [cEE, cEN, cEU],
      [cEN, cNN, cNU],
      [cEU, cNU, cUU],
    ];
    const transformed = transformSymmetricCovariance3(d, q);
    cEE = transformed[0][0];
    cEN = transformed[0][1];
    cEU = transformed[0][2];
    cNN = transformed[1][1];
    cNU = transformed[1][2];
    cUU = transformed[2][2];
  }

  return { cEE, cNN, cEN, cUU, cEU, cNU };
};
