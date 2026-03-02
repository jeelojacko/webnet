import type { Observation } from '../types';

export const isLockedPreanalysisObservation = (obs: Observation): boolean =>
  obs.planned === true && obs.sigmaSource === 'fixed';

export const isPreanalysisWhatIfCandidate = (obs: Observation): boolean =>
  obs.planned === true && !isLockedPreanalysisObservation(obs);
