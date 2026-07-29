import type { FactorComputationMethod } from '../types';

export type StationFactorSnapshot = {
  convergenceAngleRad: number;
  gridScaleFactor: number;
  elevationFactor: number;
  combinedFactor: number;
  source: 'projection-formula' | 'numerical-fallback';
  factorComputationMethod: FactorComputationMethod;
};

export type ZenithGeometry = {
  z: number;
  dist: number;
  horiz: number;
  dh: number;
  crCorr: number;
};

export type CorrectedDistanceModelResult = {
  calcDistance: number;
  mapScale: number;
  prismCorrection: number;
  horizontalDerivativeFactor?: number;
  verticalDerivativeFactor?: number;
  useReducedSlopeDerivatives?: boolean;
};
