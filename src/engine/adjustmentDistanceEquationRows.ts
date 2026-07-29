import type { DistanceObservation } from '../types';
import type {
  AdjustmentEquationAssemblyDependencies,
  EquationRowAssemblyState,
} from './adjustmentEquationAssemblyTypes';

const logDistanceDebug = (
  dependencies: AdjustmentEquationAssemblyDependencies,
  iterationNumber: number | undefined,
  observation: DistanceObservation,
  observedDistance: number,
  calcDistance: number,
  sigmaDistance: number,
  usedZenith: boolean,
  prismCorrection: number,
  residual: number,
) => {
  if (!dependencies.debug || iterationNumber == null || !dependencies.logObsDebug) return;
  const norm = sigmaDistance ? residual / sigmaDistance : 0;
  dependencies.logObsDebug(
    iterationNumber,
    `DIST#${observation.id}`,
    `from=${observation.from} to=${observation.to} obs=${observedDistance.toFixed(4)}m calc=${calcDistance.toFixed(4)}m w=${residual.toFixed(6)}m norm=${norm.toFixed(3)} sigma=${sigmaDistance.toFixed(6)}m mode=${observation.mode}${dependencies.is2D && usedZenith ? ' 2D-reduced' : ''} prism=${prismCorrection.toFixed(4)}m`,
  );
};

export const appendDistanceEquationRows = ({
  dependencies,
  iterationNumber,
  observation,
  row,
  state,
}: {
  dependencies: AdjustmentEquationAssemblyDependencies;
  iterationNumber?: number;
  observation: DistanceObservation;
  row: number;
  state: EquationRowAssemblyState;
}): number => {
  const { from, to } = observation;
  const fromStation = dependencies.stations[from];
  const toStation = dependencies.stations[to];
  if (!fromStation || !toStation) return row;
  const dx = toStation.x - fromStation.x;
  const dy = toStation.y - fromStation.y;
  const dz = toStation.h + (observation.ht ?? 0) - (fromStation.h + (observation.hi ?? 0));
  const horiz = Math.sqrt(dx * dx + dy * dy);
  const calcDistRaw = dependencies.is2D
    ? horiz
    : observation.mode === 'slope'
      ? Math.sqrt(horiz * horiz + dz * dz)
      : horiz;
  const corrected = dependencies.correctedDistanceModel(observation, calcDistRaw);
  const observed2dDistance = dependencies.getObservedHorizontalDistanceIn2D(observation);
  const residual = observed2dDistance.observedDistance - corrected.calcDistance;
  state.L[row][0] = residual;
  state.rowInfo.push({ obs: observation });
  logDistanceDebug(
    dependencies,
    iterationNumber,
    observation,
    observed2dDistance.observedDistance,
    corrected.calcDistance,
    observed2dDistance.sigmaDistance,
    observed2dDistance.usedZenith,
    corrected.prismCorrection,
    residual,
  );

  const denom = calcDistRaw || 1;
  const dD_dE = corrected.useReducedSlopeDerivatives
    ? dx * (corrected.horizontalDerivativeFactor ?? 0)
    : (dx / denom) * corrected.mapScale;
  const dD_dN = corrected.useReducedSlopeDerivatives
    ? dy * (corrected.horizontalDerivativeFactor ?? 0)
    : (dy / denom) * corrected.mapScale;
  const dD_dH =
    !dependencies.is2D && observation.mode === 'slope'
      ? corrected.useReducedSlopeDerivatives
        ? dz * (corrected.verticalDerivativeFactor ?? 0)
        : (dz / denom) * corrected.mapScale
      : 0;
  const fromIdx = dependencies.paramIndex[from];
  const toIdx = dependencies.paramIndex[to];
  state.assignCoefficient(row, fromIdx?.x, -dD_dE);
  state.assignCoefficient(row, fromIdx?.y, -dD_dN);
  if (!dependencies.is2D) state.assignCoefficient(row, fromIdx?.h, -dD_dH);
  state.assignCoefficient(row, toIdx?.x, dD_dE);
  state.assignCoefficient(row, toIdx?.y, dD_dN);
  if (!dependencies.is2D) state.assignCoefficient(row, toIdx?.h, dD_dH);
  state.P[row][row] = 1 / (observed2dDistance.sigmaDistance * observed2dDistance.sigmaDistance);
  return row + 1;
};
