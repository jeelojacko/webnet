import { RAD_TO_DEG } from './angles';
import type { WeightMatrixWriter } from './adjustmentWeightWriter';
import { zeros } from './matrix';
import type { SparseMatrixRows } from './matrix';
import {
  DenseWeightWriter,
  SparseWeightWriter,
  structuredWeightsFromDense,
  structuredWeightsToDense,
} from './sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from './sparseWeightRepresentation';
import { applyCoordinateConstraintCorrelationWeightsToWriter } from './adjustmentConstraints';
import type {
  CoordinateConstraintRowPlacement,
  EquationRowInfo,
  SolveParameterIndex,
} from './adjustmentSolveTypes';
import type { Observation, StationId } from '../types';
import { appendDistanceEquationRows } from './adjustmentDistanceEquationRows';
import { appendGpsEquationRows } from './adjustmentGpsEquationRows';
import type {
  AdjustmentEquationAssemblyDependencies,
  AdjustmentEquationAssemblyOptions,
  AdjustmentEquationAssemblyResult,
  CoordinateConstraintEquation,
  EquationRowAssemblyState,
} from './adjustmentEquationAssemblyTypes';

export type {
  AdjustmentEquationAssemblyDependencies,
  AdjustmentEquationAssemblyOptions,
  AdjustmentEquationAssemblyResult,
} from './adjustmentEquationAssemblyTypes';

const setAzimuthDerivativeColumns = (
  assignCoefficient: (_row: number, _column: number | undefined, _value: number) => void,
  row: number,
  toIdx: SolveParameterIndex[StationId] | undefined,
  fromIdx: SolveParameterIndex[StationId] | undefined,
  dAz_dE_To: number,
  dAz_dN_To: number,
) => {
  assignCoefficient(row, toIdx?.x, dAz_dE_To);
  assignCoefficient(row, toIdx?.y, dAz_dN_To);
  assignCoefficient(row, fromIdx?.x, -dAz_dE_To);
  assignCoefficient(row, fromIdx?.y, -dAz_dN_To);
};

const logAngularDebug = (
  dependencies: AdjustmentEquationAssemblyDependencies,
  iterationNumber: number | undefined,
  label: string,
  details: string,
) => {
  if (!dependencies.debug || iterationNumber == null || !dependencies.logObsDebug) return;
  dependencies.logObsDebug(iterationNumber, label, details);
};

export const assembleAdjustmentEquations = (
  dependencies: AdjustmentEquationAssemblyDependencies,
  activeObservations: Observation[],
  constraints: CoordinateConstraintEquation[],
  numObsEquations: number,
  numParams: number,
  iterationNumber?: number,
  options?: AdjustmentEquationAssemblyOptions,
): AdjustmentEquationAssemblyResult => {
  const includeDenseA = options?.includeDenseA ?? true;
  const A = includeDenseA ? zeros(numObsEquations, numParams) : undefined;
  const L = zeros(numObsEquations, 1);
  const useSparseWeights = options?.weightRepresentation === 'sparse';
  let weights: WeightMatrixWriter;
  let denseP: number[][] | null = null;
  let sparseWeightWriter: SparseWeightWriter | null = null;
  if (useSparseWeights) {
    const writer = new SparseWeightWriter(numObsEquations);
    sparseWeightWriter = writer;
    weights = writer;
  } else {
    const matrix = zeros(numObsEquations, numObsEquations);
    denseP = matrix;
    const writer = new DenseWeightWriter(matrix);
    weights = writer;
  }
  const rowInfo: EquationRowInfo[] = [];
  const sparseRows: SparseMatrixRows = new Array<SparseMatrixRows[number]>(numObsEquations);
  for (let rowIndex = 0; rowIndex < numObsEquations; rowIndex += 1) {
    sparseRows[rowIndex] = [];
  }
  const assignCoefficient = (targetRow: number, column: number | undefined, value: number) => {
    if (column == null) return;
    if (A) {
      A[targetRow][column] = value;
    }
    const entries = sparseRows[targetRow];
    let existingIndex = -1;
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      if (entries[entryIndex].index === column) {
        existingIndex = entryIndex;
        break;
      }
    }
    if (value === 0) {
      if (existingIndex >= 0) {
        entries.splice(existingIndex, 1);
      }
      return;
    }
    if (existingIndex >= 0) {
      entries[existingIndex].value = value;
      return;
    }
    entries.push({ index: column, value });
  };
  let row = 0;
  const rowAssemblyState: EquationRowAssemblyState = {
    L,
    weights,
    rowInfo,
    assignCoefficient,
  };

  activeObservations.forEach((observation) => {
    if (observation.type === 'dist') {
      row = appendDistanceEquationRows({
        dependencies,
        iterationNumber,
        observation,
        row,
        state: rowAssemblyState,
      });
      return;
    }

    if (observation.type === 'angle') {
      const { at, from, to } = observation;
      if (!dependencies.stations[at] || !dependencies.stations[from] || !dependencies.stations[to]) {
        return;
      }
      const azTo = dependencies.getAzimuth(at, to);
      const azFrom = dependencies.getAzimuth(at, from);
      let calcAngle = azTo.az - azFrom.az;
      if (observation.gridObsMode !== 'grid') {
        calcAngle += dependencies.measuredAngleCorrection(at, from, to);
      }
      if (calcAngle < 0) calcAngle += 2 * Math.PI;
      const diff = dependencies.wrapToPi(observation.obs - calcAngle);
      L[row][0] = diff;
      rowInfo.push({ obs: observation });
      const sigmaUsed = dependencies.effectiveStdDev(observation);
      logAngularDebug(
        dependencies,
        iterationNumber,
        `ANGLE#${observation.id}`,
        `at=${at} from=${from} to=${to} obs=${(observation.obs * RAD_TO_DEG).toFixed(6)}°/${observation.obs.toFixed(6)}rad azTo=${(azTo.az * RAD_TO_DEG).toFixed(6)}° azFrom=${(azFrom.az * RAD_TO_DEG).toFixed(6)}° calc=${(calcAngle * RAD_TO_DEG).toFixed(6)}° w=${(diff * RAD_TO_DEG).toFixed(6)}°/${diff.toFixed(8)}rad norm=${(sigmaUsed ? diff / sigmaUsed : 0).toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad`,
      );

      const dAzTo_dE_To = Math.cos(azTo.az) / (azTo.dist || 1);
      const dAzTo_dN_To = -Math.sin(azTo.az) / (azTo.dist || 1);
      const dAzFrom_dE_From = Math.cos(azFrom.az) / (azFrom.dist || 1);
      const dAzFrom_dN_From = -Math.sin(azFrom.az) / (azFrom.dist || 1);
      const toIdx = dependencies.paramIndex[to];
      const fromIdx = dependencies.paramIndex[from];
      const atIdx = dependencies.paramIndex[at];
      assignCoefficient(row, toIdx?.x, dAzTo_dE_To);
      assignCoefficient(row, toIdx?.y, dAzTo_dN_To);
      assignCoefficient(row, fromIdx?.x, -dAzFrom_dE_From);
      assignCoefficient(row, fromIdx?.y, -dAzFrom_dN_From);
      assignCoefficient(row, atIdx?.x, -dAzTo_dE_To + dAzFrom_dE_From);
      assignCoefficient(row, atIdx?.y, -dAzTo_dN_To + dAzFrom_dN_From);
      weights.setDiagonal(row, 1 / (sigmaUsed * sigmaUsed));
      row += 1;
      return;
    }

    if (observation.type === 'gps') {
      row = appendGpsEquationRows({
        dependencies,
        observation,
        row,
        state: rowAssemblyState,
      });
      return;
    }

    if (observation.type === 'lev') {
      const fromStation = dependencies.stations[observation.from];
      const toStation = dependencies.stations[observation.to];
      if (!fromStation || !toStation) return;
      const residual = observation.obs - (toStation.h - fromStation.h);
      L[row][0] = residual;
      rowInfo.push({ obs: observation });
      const fromIdx = dependencies.paramIndex[observation.from];
      const toIdx = dependencies.paramIndex[observation.to];
      assignCoefficient(row, fromIdx?.h, -1);
      assignCoefficient(row, toIdx?.h, 1);
      const sigma = dependencies.effectiveStdDev(observation);
      weights.setDiagonal(row, 1 / (sigma * sigma));
      row += 1;
      return;
    }

    if (observation.type === 'bearing' || observation.type === 'dir') {
      const azimuth = dependencies.getAzimuth(observation.from, observation.to);
      const calc = dependencies.modeledAzimuth(
        azimuth.az,
        observation.from,
        observation.gridObsMode !== 'grid',
      );
      let residual = observation.obs - calc;
      if (residual > Math.PI) residual -= 2 * Math.PI;
      if (residual < -Math.PI) residual += 2 * Math.PI;
      if (observation.type === 'dir' && observation.flip180) {
        let flippedResidual = observation.obs + Math.PI - calc;
        if (flippedResidual > Math.PI) flippedResidual -= 2 * Math.PI;
        if (flippedResidual < -Math.PI) flippedResidual += 2 * Math.PI;
        if (Math.abs(flippedResidual) < Math.abs(residual)) {
          residual = flippedResidual;
        }
      }
      L[row][0] = residual;
      rowInfo.push({ obs: observation });
      const sigmaUsed = dependencies.effectiveStdDev(observation);
      if (observation.type === 'dir') {
        logAngularDebug(
          dependencies,
          iterationNumber,
          `DIRAZ#${observation.id}`,
          `from=${observation.from} to=${observation.to} obs=${(observation.obs * RAD_TO_DEG).toFixed(6)}°/${observation.obs.toFixed(6)}rad calc=${(calc * RAD_TO_DEG).toFixed(6)}° w=${(residual * RAD_TO_DEG).toFixed(6)}°/${residual.toFixed(8)}rad norm=${(sigmaUsed ? residual / sigmaUsed : 0).toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad`,
        );
      }
      const dAz_dE_To = Math.cos(azimuth.az) / (azimuth.dist || 1);
      const dAz_dN_To = -Math.sin(azimuth.az) / (azimuth.dist || 1);
      setAzimuthDerivativeColumns(
        assignCoefficient,
        row,
        dependencies.paramIndex[observation.to],
        dependencies.paramIndex[observation.from],
        dAz_dE_To,
        dAz_dN_To,
      );
      weights.setDiagonal(row, 1 / (sigmaUsed * sigmaUsed));
      row += 1;
      return;
    }

    if (observation.type === 'direction') {
      const azimuth = dependencies.getAzimuth(observation.at, observation.to);
      const orientation = dependencies.directionOrientations[observation.setId] ?? 0;
      let calc =
        orientation +
        dependencies.modeledAzimuth(azimuth.az, observation.at, observation.gridObsMode !== 'grid');
      calc %= 2 * Math.PI;
      if (calc < 0) calc += 2 * Math.PI;
      const residual = dependencies.wrapToPi(observation.obs - calc);
      L[row][0] = residual;
      rowInfo.push({ obs: observation });
      const sigmaUsed = dependencies.effectiveStdDev(observation);
      logAngularDebug(
        dependencies,
        iterationNumber,
        `DIR#${observation.id}`,
        `at=${observation.at} to=${observation.to} set=${observation.setId} obs=${(observation.obs * RAD_TO_DEG).toFixed(6)}°/${observation.obs.toFixed(6)}rad az=${(azimuth.az * RAD_TO_DEG).toFixed(6)}° orient=${(orientation * RAD_TO_DEG).toFixed(6)}° calc=${(calc * RAD_TO_DEG).toFixed(6)}° w=${(residual * RAD_TO_DEG).toFixed(6)}°/${residual.toFixed(8)}rad norm=${(sigmaUsed ? residual / sigmaUsed : 0).toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad`,
      );
      const dAz_dE_To = Math.cos(azimuth.az) / (azimuth.dist || 1);
      const dAz_dN_To = -Math.sin(azimuth.az) / (azimuth.dist || 1);
      const toIdx = dependencies.paramIndex[observation.to];
      const atIdx = dependencies.paramIndex[observation.at];
      assignCoefficient(row, toIdx?.x, dAz_dE_To);
      assignCoefficient(row, toIdx?.y, dAz_dN_To);
      assignCoefficient(row, atIdx?.x, -dAz_dE_To);
      assignCoefficient(row, atIdx?.y, -dAz_dN_To);
      const dirIdx = dependencies.dirParamMap[observation.setId];
      assignCoefficient(row, dirIdx, 1);
      weights.setDiagonal(row, 1 / (sigmaUsed * sigmaUsed));
      row += 1;
      return;
    }

    if (observation.type === 'zenith') {
      const fromStation = dependencies.stations[observation.from];
      const toStation = dependencies.stations[observation.to];
      if (!fromStation || !toStation) return;
      const zenith = dependencies.getModeledZenith(observation);
      const residual = dependencies.wrapToPi(observation.obs - zenith.z);
      L[row][0] = residual;
      rowInfo.push({ obs: observation });
      const sigmaUsed = dependencies.effectiveStdDev(observation);
      logAngularDebug(
        dependencies,
        iterationNumber,
        `ZEN#${observation.id}`,
        `from=${observation.from} to=${observation.to} obs=${(observation.obs * RAD_TO_DEG).toFixed(6)}°/${observation.obs.toFixed(6)}rad calc=${(zenith.z * RAD_TO_DEG).toFixed(6)}° w=${(residual * RAD_TO_DEG).toFixed(6)}°/${residual.toFixed(8)}rad norm=${(sigmaUsed ? residual / sigmaUsed : 0).toFixed(3)} sigma=${sigmaUsed.toFixed(8)}rad cr=${(zenith.crCorr * RAD_TO_DEG * 3600).toFixed(2)}"`,
      );
      const denom = Math.sqrt(Math.max(1 - (zenith.dist === 0 ? 0 : (zenith.dh / zenith.dist) ** 2), 1e-12));
      const common = zenith.dist === 0 ? 0 : 1 / (zenith.dist * zenith.dist * zenith.dist * denom);
      const horizontalScale = zenith.horizontalScale ?? 1;
      const dx = toStation.x - fromStation.x;
      const dy = toStation.y - fromStation.y;
      const dZ_dEGeom = zenith.dh * dx * common / (horizontalScale * horizontalScale);
      const dZ_dNGeom = zenith.dh * dy * common / (horizontalScale * horizontalScale);
      const dC_dHoriz = dependencies.curvatureRefractionAngle(1);
      const dHoriz_dE =
        zenith.horiz > 0 ? dx / (zenith.horiz * horizontalScale * horizontalScale) : 0;
      const dHoriz_dN =
        zenith.horiz > 0 ? dy / (zenith.horiz * horizontalScale * horizontalScale) : 0;
      const dZ_dE = dZ_dEGeom + dC_dHoriz * dHoriz_dE;
      const dZ_dN = dZ_dNGeom + dC_dHoriz * dHoriz_dN;
      const dZ_dH = -(zenith.horiz * zenith.horiz) * common;
      const toIdx = dependencies.paramIndex[observation.to];
      const fromIdx = dependencies.paramIndex[observation.from];
      assignCoefficient(row, toIdx?.x, dZ_dE);
      assignCoefficient(row, toIdx?.y, dZ_dN);
      assignCoefficient(row, toIdx?.h, dZ_dH);
      assignCoefficient(row, fromIdx?.x, -dZ_dE);
      assignCoefficient(row, fromIdx?.y, -dZ_dN);
      assignCoefficient(row, fromIdx?.h, -dZ_dH);
      weights.setDiagonal(row, 1 / (sigmaUsed * sigmaUsed));
      row += 1;
    }
  });

  const constraintPlacements: CoordinateConstraintRowPlacement[] = [];
  constraints.forEach((constraint) => {
    const station = dependencies.stations[constraint.stationId];
    if (!station) return;
    const current =
      constraint.component === 'x' ? station.x : constraint.component === 'y' ? station.y : station.h;
    L[row][0] = constraint.target - current;
    assignCoefficient(row, constraint.index, 1);
    weights.setDiagonal(row, 1 / (constraint.sigma * constraint.sigma));
    rowInfo.push(null);
    constraintPlacements.push({ row, constraint });
    row += 1;
  });

  applyCoordinateConstraintCorrelationWeightsToWriter(weights, constraintPlacements);
  let structuredWeights: StructuredSymmetricWeights | undefined;
  let P: number[][] | undefined;
  if (sparseWeightWriter) {
    if (dependencies.applyTsCorrelationToWeightWriter) {
      dependencies.applyTsCorrelationToWeightWriter(weights, rowInfo);
      structuredWeights = sparseWeightWriter.finalize();
      P = options?.omitDenseP ? undefined : structuredWeightsToDense(structuredWeights);
    } else {
      const materialized = structuredWeightsToDense(sparseWeightWriter.finalize());
      dependencies.applyTsCorrelationToWeightMatrix(materialized, rowInfo);
      structuredWeights = structuredWeightsFromDense(materialized, numObsEquations);
      P = options?.omitDenseP ? undefined : materialized;
    }
  } else {
    dependencies.applyTsCorrelationToWeightMatrix(denseP as number[][], rowInfo);
    structuredWeights = undefined;
    P = denseP as number[][];
  }
  sparseRows.forEach((entries) => entries.sort((left, right) => left.index - right.index));
  return { A, L, P, rowInfo, sparseRows, structuredWeights };
};
