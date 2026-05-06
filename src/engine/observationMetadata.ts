import type { Observation, SideshotCalcMeta } from '../types';

type ObservationWithSetId = Observation & { setId?: string | null };
type ObservationWithCalc = Observation & { calc?: unknown };

export const getObservationSetId = (obs: Observation): string | undefined => {
  const setId = (obs as ObservationWithSetId).setId;
  return typeof setId === 'string' && setId.trim().length > 0 ? setId : undefined;
};

export const isSideshotCalcMeta = (calc: unknown): calc is SideshotCalcMeta =>
  typeof calc === 'object' && calc != null && (calc as { sideshot?: unknown }).sideshot === true;

export const getObservationSideshotCalcMeta = (obs: Observation): SideshotCalcMeta | undefined => {
  const calc = (obs as ObservationWithCalc).calc;
  return isSideshotCalcMeta(calc) ? calc : undefined;
};
