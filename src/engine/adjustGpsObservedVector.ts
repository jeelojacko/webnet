import { ecefDeltaToLocalEnu } from './adjustGpsMath';
import type { GpsSolveVector } from './adjustTypes';
import type {
  CoordSystemDiagnosticCode,
  GnssVectorFrame,
  GpsObservation,
  ParseOptions,
  StationId,
  StationMap,
} from '../types';

type AddDiagnosticFn = (_code: CoordSystemDiagnosticCode, _warning?: string) => void;

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
