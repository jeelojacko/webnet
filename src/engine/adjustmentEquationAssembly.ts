import { RAD_TO_DEG } from './angles';
import { zeros } from './matrix';
import type { SparseMatrixRows } from './matrix';
import { applyCoordinateConstraintCorrelationWeights } from './adjustmentConstraints';
import type {
  CoordinateConstraintEquation,
  CoordinateConstraintRowPlacement,
  EquationRowInfo,
  SolveParameterIndex,
} from './adjustmentSolveTypes';
import type {
  DistanceObservation,
  GpsObservation,
  Observation,
  StationId,
  StationMap,
} from '../types';

interface DistanceModelResult {
  calcDistance: number;
  mapScale: number;
  prismCorrection: number;
  horizontalDerivativeFactor?: number;
  verticalDerivativeFactor?: number;
  useReducedSlopeDerivatives?: boolean;
}

interface HorizontalDistanceObservation {
  observedDistance: number;
  sigmaDistance: number;
  usedZenith: boolean;
}

interface ZenithGeometry {
  z: number;
  dist: number;
  horiz: number;
  dh: number;
  crCorr: number;
  horizontalScale?: number;
}

export interface AdjustmentEquationAssemblyDependencies {
  stations: StationMap;
  paramIndex: SolveParameterIndex;
  is2D: boolean;
  debug: boolean;
  directionOrientations: Record<string, number>;
  dirParamMap: Record<string, number>;
  effectiveStdDev: (_observation: Observation) => number;
  correctedDistanceModel: (
    _observation: DistanceObservation,
    _calcDistRaw: number,
  ) => DistanceModelResult;
  getObservedHorizontalDistanceIn2D: (
    _observation: DistanceObservation,
  ) => HorizontalDistanceObservation;
  getAzimuth: (_fromId: StationId, _toId: StationId) => { az: number; dist: number };
  measuredAngleCorrection: (_at: StationId, _from: StationId, _to: StationId) => number;
  modeledAzimuth: (
    _rawAz: number,
    _atStationId?: StationId,
    _applyConvergence?: boolean,
  ) => number;
  wrapToPi: (_value: number) => number;
  gpsObservedVector: (
    _observation: GpsObservation,
  ) => { dE: number; dN: number; dU?: number; scale: number };
  gpsModeledVector: (
    _observation: GpsObservation,
  ) => { dE: number; dN: number; dU?: number; scale: number };
  gpsModeledVectorDerivatives: (_observation: GpsObservation) => {
    from: { x?: { dE: number; dN: number; dU?: number }; y?: { dE: number; dN: number; dU?: number }; h?: { dE: number; dN: number; dU?: number } };
    to: { x?: { dE: number; dN: number; dU?: number }; y?: { dE: number; dN: number; dU?: number }; h?: { dE: number; dN: number; dU?: number } };
  };
  gpsWeight: (_observation: Observation) => {
    wEE: number;
    wNN: number;
    wEN: number;
    wUU?: number;
    wEU?: number;
    wNU?: number;
  };
  getModeledZenith: (_observation: Observation & { type: 'zenith' }) => ZenithGeometry;
  curvatureRefractionAngle: (_horiz: number) => number;
  applyTsCorrelationToWeightMatrix: (_P: number[][], _rowInfo: EquationRowInfo[]) => void;
  logObsDebug?: (_iteration: number, _label: string, _details: string) => void;
}

export interface AdjustmentEquationAssemblyResult {
  A?: number[][];
  L: number[][];
  P: number[][];
  rowInfo: EquationRowInfo[];
  sparseRows: SparseMatrixRows;
}

interface AdjustmentEquationAssemblyOptions {
  includeDenseA?: boolean;
}

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
  const P = zeros(numObsEquations, numObsEquations);
  const rowInfo: EquationRowInfo[] = [];
  const sparseRows: SparseMatrixRows = Array.from({ length: numObsEquations }, () => []);
  const assignCoefficient = (targetRow: number, column: number | undefined, value: number) => {
    if (column == null) return;
    if (A) {
      A[targetRow][column] = value;
    }
    const entries = sparseRows[targetRow];
    const existingIndex = entries.findIndex((entry) => entry.index === column);
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

  activeObservations.forEach((observation) => {
    if (observation.type === 'dist') {
      const { from, to } = observation;
      const fromStation = dependencies.stations[from];
      const toStation = dependencies.stations[to];
      if (!fromStation || !toStation) return;
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
      L[row][0] = residual;
      rowInfo.push({ obs: observation });
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
      assignCoefficient(row, fromIdx?.x, -dD_dE);
      assignCoefficient(row, fromIdx?.y, -dD_dN);
      if (!dependencies.is2D) assignCoefficient(row, fromIdx?.h, -dD_dH);
      assignCoefficient(row, toIdx?.x, dD_dE);
      assignCoefficient(row, toIdx?.y, dD_dN);
      if (!dependencies.is2D) assignCoefficient(row, toIdx?.h, dD_dH);
      P[row][row] = 1 / (observed2dDistance.sigmaDistance * observed2dDistance.sigmaDistance);
      row += 1;
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
      P[row][row] = 1 / (sigmaUsed * sigmaUsed);
      row += 1;
      return;
    }

    if (observation.type === 'gps') {
      const fromStation = dependencies.stations[observation.from];
      const toStation = dependencies.stations[observation.to];
      if (!fromStation || !toStation) return;
      const corrected = dependencies.gpsObservedVector(observation);
      const modeled = dependencies.gpsModeledVector(observation);
      const jacobian = dependencies.gpsModeledVectorDerivatives(observation);
      const vE = corrected.dE - modeled.dE;
      const vN = corrected.dN - modeled.dN;
      L[row][0] = vE;
      rowInfo.push({ obs: observation, component: 'E' });
      const fromIdx = dependencies.paramIndex[observation.from];
      const toIdx = dependencies.paramIndex[observation.to];
      const weight = dependencies.gpsWeight(observation);
      assignCoefficient(row, fromIdx?.x, jacobian.from.x?.dE ?? -1);
      assignCoefficient(row, fromIdx?.y, jacobian.from.y?.dE ?? 0);
      if (!dependencies.is2D) assignCoefficient(row, fromIdx?.h, jacobian.from.h?.dE ?? 0);
      assignCoefficient(row, toIdx?.x, jacobian.to.x?.dE ?? 1);
      assignCoefficient(row, toIdx?.y, jacobian.to.y?.dE ?? 0);
      if (!dependencies.is2D) assignCoefficient(row, toIdx?.h, jacobian.to.h?.dE ?? 0);
      P[row][row] = weight.wEE;
      P[row][row + 1] = weight.wEN;
      P[row + 1][row] = weight.wEN;
      P[row + 1][row + 1] = weight.wNN;
      L[row + 1][0] = vN;
      rowInfo.push({ obs: observation, component: 'N' });
      assignCoefficient(row + 1, fromIdx?.x, jacobian.from.x?.dN ?? 0);
      assignCoefficient(row + 1, fromIdx?.y, jacobian.from.y?.dN ?? -1);
      if (!dependencies.is2D) assignCoefficient(row + 1, fromIdx?.h, jacobian.from.h?.dN ?? 0);
      assignCoefficient(row + 1, toIdx?.x, jacobian.to.x?.dN ?? 0);
      assignCoefficient(row + 1, toIdx?.y, jacobian.to.y?.dN ?? 1);
      if (!dependencies.is2D) assignCoefficient(row + 1, toIdx?.h, jacobian.to.h?.dN ?? 0);
      if (
        !dependencies.is2D &&
        Number.isFinite(corrected.dU ?? Number.NaN) &&
        Number.isFinite(modeled.dU ?? Number.NaN)
      ) {
        const vU = (corrected.dU as number) - (modeled.dU as number);
        L[row + 2][0] = vU;
        rowInfo.push({ obs: observation, component: 'U' });
        assignCoefficient(row + 2, fromIdx?.x, jacobian.from.x?.dU ?? 0);
        assignCoefficient(row + 2, fromIdx?.y, jacobian.from.y?.dU ?? 0);
        assignCoefficient(row + 2, fromIdx?.h, jacobian.from.h?.dU ?? -1);
        assignCoefficient(row + 2, toIdx?.x, jacobian.to.x?.dU ?? 0);
        assignCoefficient(row + 2, toIdx?.y, jacobian.to.y?.dU ?? 0);
        assignCoefficient(row + 2, toIdx?.h, jacobian.to.h?.dU ?? 1);
        P[row][row + 2] = weight.wEU ?? 0;
        P[row + 2][row] = weight.wEU ?? 0;
        P[row + 1][row + 2] = weight.wNU ?? 0;
        P[row + 2][row + 1] = weight.wNU ?? 0;
        P[row + 2][row + 2] = weight.wUU ?? 0;
        row += 3;
        return;
      }
      row += 2;
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
      P[row][row] = 1 / (sigma * sigma);
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
      P[row][row] = 1 / (sigmaUsed * sigmaUsed);
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
      P[row][row] = 1 / (sigmaUsed * sigmaUsed);
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
      P[row][row] = 1 / (sigmaUsed * sigmaUsed);
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
    P[row][row] = 1 / (constraint.sigma * constraint.sigma);
    rowInfo.push(null);
    constraintPlacements.push({ row, constraint });
    row += 1;
  });

  applyCoordinateConstraintCorrelationWeights(P, constraintPlacements);
  dependencies.applyTsCorrelationToWeightMatrix(P, rowInfo);
  sparseRows.forEach((entries) => entries.sort((left, right) => left.index - right.index));
  return { A, L, P, rowInfo, sparseRows };
};
