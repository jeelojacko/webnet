import type { GpsObservation } from '../types';
import type {
  AdjustmentEquationAssemblyDependencies,
  EquationRowAssemblyState,
} from './adjustmentEquationAssemblyTypes';

export const appendGpsEquationRows = ({
  dependencies,
  observation,
  row,
  state,
}: {
  dependencies: AdjustmentEquationAssemblyDependencies;
  observation: GpsObservation;
  row: number;
  state: EquationRowAssemblyState;
}): number => {
  const fromStation = dependencies.stations[observation.from];
  const toStation = dependencies.stations[observation.to];
  if (!fromStation || !toStation) return row;
  const corrected = dependencies.gpsObservedVector(observation);
  const modeled = dependencies.gpsModeledVector(observation);
  const jacobian = dependencies.gpsModeledVectorDerivatives(observation);
  const vE = corrected.dE - modeled.dE;
  const vN = corrected.dN - modeled.dN;
  state.L[row][0] = vE;
  state.rowInfo.push({ obs: observation, component: 'E' });
  const fromIdx = dependencies.paramIndex[observation.from];
  const toIdx = dependencies.paramIndex[observation.to];
  const weight = dependencies.gpsWeight(observation);
  state.assignCoefficient(row, fromIdx?.x, jacobian.from.x?.dE ?? -1);
  state.assignCoefficient(row, fromIdx?.y, jacobian.from.y?.dE ?? 0);
  if (!dependencies.is2D) state.assignCoefficient(row, fromIdx?.h, jacobian.from.h?.dE ?? 0);
  state.assignCoefficient(row, toIdx?.x, jacobian.to.x?.dE ?? 1);
  state.assignCoefficient(row, toIdx?.y, jacobian.to.y?.dE ?? 0);
  if (!dependencies.is2D) state.assignCoefficient(row, toIdx?.h, jacobian.to.h?.dE ?? 0);
  state.weights.setDiagonal(row, weight.wEE);
  state.weights.set(row, row + 1, weight.wEN);
  state.weights.setDiagonal(row + 1, weight.wNN);
  state.L[row + 1][0] = vN;
  state.rowInfo.push({ obs: observation, component: 'N' });
  state.assignCoefficient(row + 1, fromIdx?.x, jacobian.from.x?.dN ?? 0);
  state.assignCoefficient(row + 1, fromIdx?.y, jacobian.from.y?.dN ?? -1);
  if (!dependencies.is2D) state.assignCoefficient(row + 1, fromIdx?.h, jacobian.from.h?.dN ?? 0);
  state.assignCoefficient(row + 1, toIdx?.x, jacobian.to.x?.dN ?? 0);
  state.assignCoefficient(row + 1, toIdx?.y, jacobian.to.y?.dN ?? 1);
  if (!dependencies.is2D) state.assignCoefficient(row + 1, toIdx?.h, jacobian.to.h?.dN ?? 0);
  if (
    !dependencies.is2D &&
    Number.isFinite(corrected.dU ?? Number.NaN) &&
    Number.isFinite(modeled.dU ?? Number.NaN)
  ) {
    const vU = (corrected.dU as number) - (modeled.dU as number);
    state.L[row + 2][0] = vU;
    state.rowInfo.push({ obs: observation, component: 'U' });
    state.assignCoefficient(row + 2, fromIdx?.x, jacobian.from.x?.dU ?? 0);
    state.assignCoefficient(row + 2, fromIdx?.y, jacobian.from.y?.dU ?? 0);
    state.assignCoefficient(row + 2, fromIdx?.h, jacobian.from.h?.dU ?? -1);
    state.assignCoefficient(row + 2, toIdx?.x, jacobian.to.x?.dU ?? 0);
    state.assignCoefficient(row + 2, toIdx?.y, jacobian.to.y?.dU ?? 0);
    state.assignCoefficient(row + 2, toIdx?.h, jacobian.to.h?.dU ?? 1);
    state.weights.set(row, row + 2, weight.wEU ?? 0);
    state.weights.set(row + 1, row + 2, weight.wNU ?? 0);
    state.weights.setDiagonal(row + 2, weight.wUU ?? 0);
    return row + 3;
  }
  return row + 2;
};
