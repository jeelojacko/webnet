import { GPS_ADDHIHT_SCALE_TOL } from './adjustConstants';
import type { GpsSolveVector } from './adjustTypes';
import type { GpsObservation, Observation, ParseOptions } from '../types';

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
