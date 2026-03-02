import type { Observation } from '../types';

export const isPreanalysisWhatIfCandidate = (obs: Observation): boolean =>
  obs.planned === true && obs.sigmaSource !== 'fixed';
