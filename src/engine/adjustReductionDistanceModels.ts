import type { Observation, ParseOptions, StationId } from '../types';
import type { CorrectedDistanceModelResult } from './adjustReductionTypes';

export const prismCorrectionForObservation = ({
  obs,
  prismEnabled,
  prismOffset,
  prismScope,
}: {
  obs: Observation;
  prismEnabled: boolean;
  prismOffset: number;
  prismScope: ParseOptions['prismScope'];
}): number => {
  if (obs.type !== 'dist' && obs.type !== 'zenith') return 0;

  const obsOffset = Number.isFinite(obs.prismCorrectionM ?? NaN)
    ? (obs.prismCorrectionM ?? 0)
    : undefined;
  if (obsOffset != null) {
    if (obs.prismScope === 'set') {
      const setId = typeof obs.setId === 'string' ? obs.setId.trim() : '';
      if (!setId) return 0;
    }
    return obsOffset;
  }

  if (!prismEnabled || !Number.isFinite(prismOffset) || Math.abs(prismOffset) <= 0) {
    return 0;
  }
  if ((prismScope ?? 'global') === 'set') {
    const setId = typeof obs.setId === 'string' ? obs.setId.trim() : '';
    if (!setId) return 0;
  }
  return prismOffset;
};

export const correctedDistanceModel = ({
  calcDistRaw,
  centeringLineGeometry,
  coordSystemMode,
  distanceScaleForObservation,
  is2D,
  obs,
  prismCorrectionForObservation,
}: {
  calcDistRaw: number;
  centeringLineGeometry: (
    _fromId: StationId,
    _toId: StationId,
    _hi?: number,
    _ht?: number,
  ) => { horiz: number; slope: number; elev: number };
  coordSystemMode: ParseOptions['coordSystemMode'];
  distanceScaleForObservation: (_obs: Observation) => number;
  is2D: boolean;
  obs: Observation & { type: 'dist' };
  prismCorrectionForObservation: (_obs: Observation) => number;
}): CorrectedDistanceModelResult => {
  const mapScale = distanceScaleForObservation(obs);
  const prismCorrection = prismCorrectionForObservation(obs);
  if (
    coordSystemMode === 'grid' &&
    !is2D &&
    obs.mode === 'slope' &&
    Number.isFinite(mapScale) &&
    mapScale > 0
  ) {
    const geom = centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
    const groundHoriz = geom.horiz / mapScale;
    const calcDistance =
      Math.sqrt(groundHoriz * groundHoriz + geom.elev * geom.elev) + prismCorrection;
    const denom = Math.max(calcDistance - prismCorrection, 1e-12);
    return {
      calcDistance,
      mapScale,
      prismCorrection,
      horizontalDerivativeFactor: 1 / (mapScale * mapScale * denom),
      verticalDerivativeFactor: 1 / denom,
      useReducedSlopeDerivatives: true,
    };
  }
  return {
    calcDistance: (calcDistRaw + prismCorrection) * mapScale,
    mapScale,
    prismCorrection,
  };
};
