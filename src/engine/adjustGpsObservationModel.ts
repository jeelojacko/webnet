import { GPS_ADDHIHT_SCALE_TOL } from './adjustConstants';
import {
  ecefDeltaToLocalEnu,
  geodeticToEcef,
} from './adjustGpsMath';
import type {
  GpsCovariance,
  GpsSolveVector,
  GpsVectorComponents,
  GpsVectorDerivatives,
} from './adjustTypes';
import type {
  CoordSystemDiagnosticCode,
  GnssVectorFrame,
  GpsObservation,
  Observation,
  ParseOptions,
  Station,
  StationId,
  StationMap,
} from '../types';

type AddDiagnosticFn = (_code: CoordSystemDiagnosticCode, _warning?: string) => void;
type GpsWeight = {
  wEE: number;
  wNN: number;
  wEN: number;
  wUU?: number;
  wEU?: number;
  wNU?: number;
};

export const captureObservationWeightingStdDevs = (
  observations: Observation[],
  options: {
    effectiveStdDev: (_obs: Observation) => number;
    getObservedHorizontalDistanceIn2D: (_obs: Observation & { type: 'dist' }) => {
      sigmaDistance: number;
    };
    gpsCovariance: (_obs: Observation) => GpsCovariance;
  },
): void => {
  observations.forEach((obs) => {
    if (obs.type === 'gps') {
      const cov = options.gpsCovariance(obs);
      obs.weightingStdDev = undefined;
      obs.weightingStdDevE = Math.sqrt(Math.max(cov.cEE, 0));
      obs.weightingStdDevN = Math.sqrt(Math.max(cov.cNN, 0));
      return;
    }
    if (obs.type === 'dist') {
      obs.weightingStdDev = options.getObservedHorizontalDistanceIn2D(obs).sigmaDistance;
      obs.weightingStdDevE = undefined;
      obs.weightingStdDevN = undefined;
      return;
    }
    obs.weightingStdDev = options.effectiveStdDev(obs);
    obs.weightingStdDevE = undefined;
    obs.weightingStdDevN = undefined;
  });
};

export const gpsCovariance = (
  obs: Observation,
  options: {
    gpsObservedVector: (_obs: GpsObservation) => GpsSolveVector;
    transformGpsCovarianceToSolveFrame: (_obs: GpsObservation) => GpsCovariance | null;
  },
): GpsCovariance => {
  if (obs.type !== 'gps') {
    const s = Math.max(obs.stdDev || 0, 1e-12);
    return { cEE: s * s, cNN: s * s, cEN: 0, cUU: s * s, cEU: 0, cNU: 0 };
  }
  const transformed = options.transformGpsCovarianceToSolveFrame(obs);
  if (transformed) return transformed;
  const vector = options.gpsObservedVector(obs);
  const varianceScale = Math.max(vector.scale * vector.scale, 1e-12);
  const sE = Math.max(obs.stdDevE ?? obs.stdDev ?? 0, 1e-12);
  const sN = Math.max(obs.stdDevN ?? obs.stdDev ?? 0, 1e-12);
  const sU = Math.max(obs.stdDevU ?? obs.stdDev ?? 0, 1e-12);
  const corrEN = Math.max(-0.999, Math.min(0.999, obs.corrEN ?? 0));
  const corrEU = Math.max(-0.999, Math.min(0.999, obs.corrEU ?? 0));
  const corrNU = Math.max(-0.999, Math.min(0.999, obs.corrNU ?? 0));
  return {
    cEE: sE * sE * varianceScale,
    cNN: sN * sN * varianceScale,
    cEN: corrEN * sE * sN * varianceScale,
    cUU: sU * sU * varianceScale,
    cEU: corrEU * sE * sU * varianceScale,
    cNU: corrNU * sN * sU * varianceScale,
  };
};

export const gpsWeight = (
  obs: Observation,
  options: {
    gpsCovariance: (_obs: Observation) => GpsCovariance;
    is2D: boolean;
  },
): GpsWeight => {
  const cov = options.gpsCovariance(obs);
  const hasVertical =
    !options.is2D &&
    Number.isFinite(cov.cUU ?? Number.NaN) &&
    Number.isFinite(cov.cEU ?? Number.NaN) &&
    Number.isFinite(cov.cNU ?? Number.NaN);
  if (hasVertical) {
    const matrix = [
      [cov.cEE, cov.cEN, cov.cEU ?? 0],
      [cov.cEN, cov.cNN, cov.cNU ?? 0],
      [cov.cEU ?? 0, cov.cNU ?? 0, cov.cUU ?? 0],
    ];
    const det =
      matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) -
      matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0]) +
      matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]);
    if (Number.isFinite(det) && Math.abs(det) > 1e-24) {
      const inv = [
        [
          (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1]) / det,
          (matrix[0][2] * matrix[2][1] - matrix[0][1] * matrix[2][2]) / det,
          (matrix[0][1] * matrix[1][2] - matrix[0][2] * matrix[1][1]) / det,
        ],
        [
          (matrix[1][2] * matrix[2][0] - matrix[1][0] * matrix[2][2]) / det,
          (matrix[0][0] * matrix[2][2] - matrix[0][2] * matrix[2][0]) / det,
          (matrix[0][2] * matrix[1][0] - matrix[0][0] * matrix[1][2]) / det,
        ],
        [
          (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0]) / det,
          (matrix[0][1] * matrix[2][0] - matrix[0][0] * matrix[2][1]) / det,
          (matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0]) / det,
        ],
      ];
      return {
        wEE: inv[0][0],
        wNN: inv[1][1],
        wEN: inv[0][1],
        wUU: inv[2][2],
        wEU: inv[0][2],
        wNU: inv[1][2],
      };
    }
  }
  const det = cov.cEE * cov.cNN - cov.cEN * cov.cEN;
  if (!Number.isFinite(det) || det <= 1e-24) {
    return {
      wEE: 1 / Math.max(cov.cEE, 1e-24),
      wNN: 1 / Math.max(cov.cNN, 1e-24),
      wEN: 0,
    };
  }
  return {
    wEE: cov.cNN / det,
    wNN: cov.cEE / det,
    wEN: -cov.cEN / det,
  };
};

export const gpsObservedVector = (
  obs: GpsObservation,
  options: {
    addCoordSystemDiagnostic: AddDiagnosticFn;
    addCoordSystemWarning: (_warning: string) => void;
    applyGpsVerticalDeflection: (
      _vector: Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>>,
    ) => Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>>;
    gpsRoverOffsetVector: (_obs: GpsObservation) => {
      dE: number;
      dN: number;
      dH: number;
    };
    is2D: boolean;
    parseState?: ParseOptions;
    stationGeodetic: (_stationId: StationId) => { latDeg: number; lonDeg: number } | null;
    stations: StationMap;
  },
): GpsSolveVector => {
  const includeVertical = !options.is2D && Number.isFinite(obs.obs.dU ?? Number.NaN);
  const rawE = Number.isFinite(obs.obs.dE) ? obs.obs.dE : 0;
  const rawN = Number.isFinite(obs.obs.dN) ? obs.obs.dN : 0;
  const rawU = includeVertical ? (obs.obs.dU as number) : 0;
  const frame: GnssVectorFrame =
    obs.gnssVectorFrame ?? options.parseState?.gnssVectorFrameDefault ?? 'gridNEU';
  let frameE = rawE;
  let frameN = rawN;
  let frameU = rawU;
  const frameDistance = Math.hypot(rawE, rawN);

  if (frame === 'enuLocal' || frame === 'llhBaseline') {
    const deflected = options.applyGpsVerticalDeflection({ dE: rawE, dN: rawN, dU: rawU });
    frameE = deflected.dE;
    frameN = deflected.dN;
    frameU = deflected.dU;
    if (frameDistance > 200000) {
      options.addCoordSystemWarning(
        `GNSS frame sanity check: ${obs.from}-${obs.to} declared ${frame} with unusually long horizontal span ${frameDistance.toFixed(3)}m.`,
      );
    }
  } else if (frame === 'ecefDelta') {
    const geo = options.stationGeodetic(obs.from) ?? options.stationGeodetic(obs.to);
    if (geo) {
      const { dE: enuE, dN: enuN, dU: enuU } = ecefDeltaToLocalEnu(
        rawE,
        rawN,
        rawU,
        geo.latDeg,
        geo.lonDeg,
      );
      const deflected = options.applyGpsVerticalDeflection({ dE: enuE, dN: enuN, dU: enuU });
      frameE = deflected.dE;
      frameN = deflected.dN;
      frameU = deflected.dU;
    } else {
      options.addCoordSystemWarning(
        `GNSS frame ${frame} could not resolve geodetic orientation for ${obs.from}-${obs.to}; using raw component proxy.`,
      );
    }
    if (frameDistance < 0.001 || frameDistance > 1_000_000) {
      options.addCoordSystemWarning(
        `GNSS frame sanity check: ${obs.from}-${obs.to} ${frame} vector magnitude ${frameDistance.toFixed(6)}m looks inconsistent.`,
      );
    }
  } else if (frame === 'unknown') {
    options.addCoordSystemDiagnostic(
      'GNSS_FRAME_UNCONFIRMED',
      `GNSS frame UNKNOWN for ${obs.from}-${obs.to}; solve requires explicit frame confirmation.`,
    );
  }

  const offset = options.gpsRoverOffsetVector(obs);
  const horizRaw = Math.hypot(frameE, frameN);
  if (horizRaw <= 1e-12) {
    return {
      dE: offset.dE,
      dN: offset.dN,
      dU: includeVertical ? frameU + offset.dH : undefined,
      scale: 1,
    };
  }

  const hasAntennaMeta = obs.gpsAntennaHiM != null || obs.gpsAntennaHtM != null;
  if (!hasAntennaMeta) {
    return {
      dE: frameE + offset.dE,
      dN: frameN + offset.dN,
      dU: includeVertical ? frameU + offset.dH : undefined,
      scale: 1,
    };
  }

  const hi = Number.isFinite(obs.gpsAntennaHiM ?? Number.NaN) ? (obs.gpsAntennaHiM as number) : 0;
  const ht = Number.isFinite(obs.gpsAntennaHtM ?? Number.NaN) ? (obs.gpsAntennaHtM as number) : 0;
  const fromH = Number.isFinite(options.stations[obs.from]?.h ?? Number.NaN)
    ? (options.stations[obs.from]?.h as number)
    : 0;
  const toH = Number.isFinite(options.stations[obs.to]?.h ?? Number.NaN)
    ? (options.stations[obs.to]?.h as number)
    : 0;

  const deltaGround = toH - offset.dH - fromH;
  const deltaAntenna = deltaGround + (ht - hi);
  const slope = Math.hypot(horizRaw, deltaAntenna);
  const horizCorrectedSq = slope * slope - deltaGround * deltaGround;
  if (!Number.isFinite(horizCorrectedSq) || horizCorrectedSq <= 0) {
    return {
      dE: frameE + offset.dE,
      dN: frameN + offset.dN,
      dU: includeVertical ? frameU + offset.dH : undefined,
      scale: 1,
    };
  }
  const horizCorrected = Math.sqrt(horizCorrectedSq);
  if (!Number.isFinite(horizCorrected) || horizCorrected <= 1e-12) {
    return {
      dE: frameE + offset.dE,
      dN: frameN + offset.dN,
      dU: includeVertical ? frameU + offset.dH : undefined,
      scale: 1,
    };
  }
  const scale = horizCorrected / horizRaw;
  if (!Number.isFinite(scale) || scale <= 0) {
    return {
      dE: frameE + offset.dE,
      dN: frameN + offset.dN,
      dU: includeVertical ? frameU + offset.dH : undefined,
      scale: 1,
    };
  }
  return {
    dE: frameE * scale + offset.dE,
    dN: frameN * scale + offset.dN,
    dU: includeVertical ? frameU + offset.dH : undefined,
    scale,
  };
};

export const gpsModeledVectorFromStationValues = (
  obs: GpsObservation,
  fromValues: { x: number; y: number; h: number },
  toValues: { x: number; y: number; h: number },
  options: {
    applyGpsVerticalDeflection: (
      _vector: Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>>,
    ) => Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>>;
    coordSystemMode: ParseOptions['coordSystemMode'];
    gpsUsesLocalSolveFrame: (_frame: GnssVectorFrame) => boolean;
    is2D: boolean;
    parseState?: ParseOptions;
    stationEllipsoidHeightFromValues: (
      _station: Station,
      _h: number,
      _latDeg?: number,
      _lonDeg?: number,
    ) => number;
    stationGeodeticFromCoordinates: (
      _stationId: StationId,
      _x: number,
      _y: number,
    ) => { latDeg: number; lonDeg: number } | null;
    stations: StationMap;
  },
): GpsVectorComponents => {
  const includeVertical = !options.is2D && Number.isFinite(obs.obs.dU ?? Number.NaN);
  const frame: GnssVectorFrame =
    obs.gnssVectorFrame ?? options.parseState?.gnssVectorFrameDefault ?? 'gridNEU';

  if (!options.gpsUsesLocalSolveFrame(frame) || options.coordSystemMode !== 'grid') {
    return {
      dE: toValues.x - fromValues.x,
      dN: toValues.y - fromValues.y,
      dU: includeVertical ? toValues.h - fromValues.h : undefined,
    };
  }

  const fromGeo = options.stationGeodeticFromCoordinates(obs.from, fromValues.x, fromValues.y);
  const toGeo = options.stationGeodeticFromCoordinates(obs.to, toValues.x, toValues.y);
  if (!fromGeo || !toGeo) {
    return {
      dE: toValues.x - fromValues.x,
      dN: toValues.y - fromValues.y,
      dU: includeVertical ? toValues.h - fromValues.h : undefined,
    };
  }

  const fromStation = options.stations[obs.from];
  const toStation = options.stations[obs.to];
  if (!fromStation || !toStation) {
    return {
      dE: toValues.x - fromValues.x,
      dN: toValues.y - fromValues.y,
      dU: includeVertical ? toValues.h - fromValues.h : undefined,
    };
  }

  const fromEllipsoidHeight = options.stationEllipsoidHeightFromValues(
    fromStation,
    fromValues.h,
    fromGeo.latDeg,
    fromGeo.lonDeg,
  );
  const toEllipsoidHeight = options.stationEllipsoidHeightFromValues(
    toStation,
    toValues.h,
    toGeo.latDeg,
    toGeo.lonDeg,
  );
  const fromEcef = geodeticToEcef(fromGeo.latDeg, fromGeo.lonDeg, fromEllipsoidHeight);
  const toEcef = geodeticToEcef(toGeo.latDeg, toGeo.lonDeg, toEllipsoidHeight);
  const local = ecefDeltaToLocalEnu(
    toEcef.x - fromEcef.x,
    toEcef.y - fromEcef.y,
    toEcef.z - fromEcef.z,
    fromGeo.latDeg,
    fromGeo.lonDeg,
  );
  const deflected = options.applyGpsVerticalDeflection(local);
  return {
    dE: deflected.dE,
    dN: deflected.dN,
    dU: includeVertical ? deflected.dU : undefined,
  };
};

export const gpsModeledVector = (
  obs: GpsObservation,
  options: {
    gpsModeledVectorFromStationValues: (
      _obs: GpsObservation,
      _fromValues: { x: number; y: number; h: number },
      _toValues: { x: number; y: number; h: number },
    ) => GpsVectorComponents;
    stations: StationMap;
  },
): GpsSolveVector => {
  const fromStation = options.stations[obs.from];
  const toStation = options.stations[obs.to];
  if (!fromStation || !toStation) return { dE: 0, dN: 0, dU: 0, scale: 1 };
  const modeled = options.gpsModeledVectorFromStationValues(
    obs,
    { x: fromStation.x, y: fromStation.y, h: fromStation.h },
    { x: toStation.x, y: toStation.y, h: toStation.h },
  );
  return { ...modeled, scale: 1 };
};

export const gpsModeledVectorDerivatives = (
  obs: GpsObservation,
  options: {
    gpsModeledVectorFromStationValues: (
      _obs: GpsObservation,
      _fromValues: { x: number; y: number; h: number },
      _toValues: { x: number; y: number; h: number },
    ) => GpsVectorComponents;
    is2D: boolean;
    stations: StationMap;
  },
): GpsVectorDerivatives => {
  const fromStation = options.stations[obs.from];
  const toStation = options.stations[obs.to];
  const empty: GpsVectorDerivatives = { from: {}, to: {} };
  if (!fromStation || !toStation) return empty;

  const delta = 1e-4;
  const differentiate = (
    endpoint: 'from' | 'to',
    component: 'x' | 'y' | 'h',
  ): GpsVectorComponents | undefined => {
    if (component === 'h' && options.is2D) return undefined;
    const fromBase = { x: fromStation.x, y: fromStation.y, h: fromStation.h };
    const toBase = { x: toStation.x, y: toStation.y, h: toStation.h };
    const fromPlus = { ...fromBase };
    const fromMinus = { ...fromBase };
    const toPlus = { ...toBase };
    const toMinus = { ...toBase };
    if (endpoint === 'from') {
      fromPlus[component] += delta;
      fromMinus[component] -= delta;
    } else {
      toPlus[component] += delta;
      toMinus[component] -= delta;
    }
    const plus = options.gpsModeledVectorFromStationValues(obs, fromPlus, toPlus);
    const minus = options.gpsModeledVectorFromStationValues(obs, fromMinus, toMinus);
    return {
      dE: (plus.dE - minus.dE) / (2 * delta),
      dN: (plus.dN - minus.dN) / (2 * delta),
      dU:
        !options.is2D &&
        Number.isFinite(plus.dU ?? Number.NaN) &&
        Number.isFinite(minus.dU ?? Number.NaN)
          ? ((plus.dU as number) - (minus.dU as number)) / (2 * delta)
          : undefined,
    };
  };

  empty.from.x = differentiate('from', 'x');
  empty.from.y = differentiate('from', 'y');
  empty.to.x = differentiate('to', 'x');
  empty.to.y = differentiate('to', 'y');
  if (!options.is2D) {
    empty.from.h = differentiate('from', 'h');
    empty.to.h = differentiate('to', 'h');
  }
  return empty;
};

export const updateGpsAddHiHtDiagnostics = ({
  gpsObservedVector,
  log,
  observations,
  parseState,
}: {
  gpsObservedVector: (_obs: GpsObservation) => GpsSolveVector;
  log: (_message: string) => void;
  observations: Observation[];
  parseState?: ParseOptions;
}): void => {
  if (!parseState) return;

  const enabled = parseState.gpsAddHiHtEnabled ?? false;
  let vectorCount = 0;
  let appliedCount = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let neutralCount = 0;
  let defaultZeroCount = 0;
  let missingHeightCount = 0;
  let scaleMin = Number.POSITIVE_INFINITY;
  let scaleMax = 0;

  observations.forEach((obs) => {
    if (obs.type !== 'gps') return;
    vectorCount += 1;
    const hasHi = Number.isFinite(obs.gpsAntennaHiM ?? Number.NaN);
    const hasHt = Number.isFinite(obs.gpsAntennaHtM ?? Number.NaN);
    if (!hasHi || !hasHt) {
      missingHeightCount += 1;
    }
    const hi = hasHi ? (obs.gpsAntennaHiM as number) : 0;
    const ht = hasHt ? (obs.gpsAntennaHtM as number) : 0;
    if (Math.abs(hi) <= 1e-12 && Math.abs(ht) <= 1e-12) {
      defaultZeroCount += 1;
    }
    const scale = gpsObservedVector(obs).scale;
    scaleMin = Math.min(scaleMin, scale);
    scaleMax = Math.max(scaleMax, scale);
    const delta = scale - 1;
    if (Math.abs(delta) <= GPS_ADDHIHT_SCALE_TOL) {
      neutralCount += 1;
    } else {
      appliedCount += 1;
      if (delta > 0) {
        positiveCount += 1;
      } else {
        negativeCount += 1;
      }
    }
  });

  parseState.gpsAddHiHtVectorCount = vectorCount;
  parseState.gpsAddHiHtAppliedCount = appliedCount;
  parseState.gpsAddHiHtPositiveCount = positiveCount;
  parseState.gpsAddHiHtNegativeCount = negativeCount;
  parseState.gpsAddHiHtNeutralCount = neutralCount;
  parseState.gpsAddHiHtDefaultZeroCount = defaultZeroCount;
  parseState.gpsAddHiHtMissingHeightCount = missingHeightCount;
  parseState.gpsAddHiHtScaleMin = vectorCount > 0 ? scaleMin : 1;
  parseState.gpsAddHiHtScaleMax = vectorCount > 0 ? scaleMax : 1;

  if (enabled) {
    log(
      `GPS AddHiHt preprocessing: vectors=${vectorCount}, adjusted=${appliedCount} (+${positiveCount}/-${negativeCount}/neutral=${neutralCount}), defaultZero=${defaultZeroCount}, missingHeight=${missingHeightCount}, scale[min=${(parseState.gpsAddHiHtScaleMin ?? 1).toFixed(8)}, max=${(parseState.gpsAddHiHtScaleMax ?? 1).toFixed(8)}]`,
    );
  }
};
