/**
 * Phase 12B — equation rows for one static GNSS baseline observation.
 *
 * Linear shared-Cartesian model (12A contract):
 *
 *   b_calc = X_TO - X_FROM
 *   w      = b_obs - b_calc        (WebNet observed-minus-computed sign)
 *   A      = [-I3 +I3]             (FROM -1, TO +1, zero cross-partials)
 *
 * One logical baseline always contributes exactly 3 equations with one
 * correlated 3x3 structured weight block P = C^-1. No mode conversions,
 * no reductions, no angular normalization: the Jacobian is constant.
 */
import type {
  EquationRowAssemblyState,
} from './adjustmentEquationAssemblyTypes';
import type { SolveParameterIndex } from './adjustmentSolveTypes';
import type { StationMap } from '../types';
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import { invertGnssBaselineCovariance } from './gnssBaselineCovariance';

export const gnssBaselineLabel = (
  observation: GnssBaselineObservation,
): string => `${observation.from}->${observation.to}#${observation.id}`;

export const appendGnssBaselineEquationRows = ({
  stations,
  paramIndex,
  observation,
  row,
  state,
}: {
  stations: StationMap;
  paramIndex: SolveParameterIndex;
  observation: GnssBaselineObservation;
  row: number;
  state: EquationRowAssemblyState;
}): number => {
  const fromStation = stations[observation.from];
  const toStation = stations[observation.to];
  if (!fromStation || !toStation) return row;
  const label = gnssBaselineLabel(observation);
  const inverse = invertGnssBaselineCovariance(observation.covariance, label);
  const calcX = toStation.x - fromStation.x;
  const calcY = toStation.y - fromStation.y;
  const calcZ = toStation.h - fromStation.h;
  const components = [
    { obs: observation.vector.x, calc: calcX },
    { obs: observation.vector.y, calc: calcY },
    { obs: observation.vector.z, calc: calcZ },
  ] as const;
  const componentTags = ['X', 'Y', 'Z'] as const;
  const fromIdx = paramIndex[observation.from];
  const toIdx = paramIndex[observation.to];
  const fromParams = [fromIdx?.x, fromIdx?.y, fromIdx?.h] as const;
  const toParams = [toIdx?.x, toIdx?.y, toIdx?.h] as const;
  components.forEach((component, position) => {
    const targetRow = row + position;
    state.L[targetRow][0] = component.obs - component.calc;
    state.rowInfo.push({
      obs: observation as unknown as import('../types').Observation,
      component: componentTags[position],
    });
    state.assignCoefficient(targetRow, fromParams[position], -1);
    state.assignCoefficient(targetRow, toParams[position], 1);
  });
  // Correlated 3x3 weight block (symmetric; writer mirrors entries).
  state.weights.setDiagonal(row, inverse[0][0]);
  state.weights.setDiagonal(row + 1, inverse[1][1]);
  state.weights.setDiagonal(row + 2, inverse[2][2]);
  state.weights.set(row, row + 1, inverse[0][1]);
  state.weights.set(row, row + 2, inverse[0][2]);
  state.weights.set(row + 1, row + 2, inverse[1][2]);
  return row + 3;
};
