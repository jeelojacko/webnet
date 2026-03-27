import { RAD_TO_DEG } from './angles';
import { zeros } from './matrix';
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
  gpsObservedVector: (_observation: GpsObservation) => { dE: number; dN: number; scale: number };
  gpsWeight: (_observation: Observation) => { wEE: number; wNN: number; wEN: number };
  getZenith: (
    _fromId: StationId,
    _toId: StationId,
    _hi: number,
    _ht: number,
  ) => ZenithGeometry;
  curvatureRefractionAngle: (_horiz: number) => number;
  applyTsCorrelationToWeightMatrix: (_P: number[][], _rowInfo: EquationRowInfo[]) => void;
  logObsDebug?: (_iteration: number, _label: string, _details: string) => void;
}

export interface AdjustmentEquationAssemblyResult {
  A: number[][];
  L: number[][];
  P: number[][];
  rowInfo: EquationRowInfo[];
}

const setAzimuthDerivativeColumns = (
  A: number[][],
  row: number,
  toIdx: SolveParameterIndex[StationId] | undefined,
  fromIdx: SolveParameterIndex[StationId] | undefined,
  dAz_dE_To: number,
  dAz_dN_To: number,
) => {
  if (toIdx?.x != null) A[row][toIdx.x] = dAz_dE_To;
  if (toIdx?.y != null) A[row][toIdx.y] = dAz_dN_To;
  if (fromIdx?.x != null) A[row][fromIdx.x] = -dAz_dE_To;
  if (fromIdx?.y != null) A[row][fromIdx.y] = -dAz_dN_To;
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
): AdjustmentEquationAssemblyResult => {
  const A = zeros(numObsEquations, numParams);
  const L = zeros(numObsEquations, 1);
  const P = zeros(numObsEquations, numObsEquations);
  const rowInfo: EquationRowInfo[] = [];
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
      if (fromIdx?.x != null) A[row][fromIdx.x] = -dD_dE;
      if (fromIdx?.y != null) A[row][fromIdx.y] = -dD_dN;
      if (!dependencies.is2D && fromIdx?.h != null) A[row][fromIdx.h] = -dD_dH;
      if (toIdx?.x != null) A[row][toIdx.x] = dD_dE;
      if (toIdx?.y != null) A[row][toIdx.y] = dD_dN;
      if (!dependencies.is2D && toIdx?.h != null) A[row][toIdx.h] = dD_dH;
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
      if (toIdx?.x != null) A[row][toIdx.x] = dAzTo_dE_To;
      if (toIdx?.y != null) A[row][toIdx.y] = dAzTo_dN_To;
      if (fromIdx?.x != null) A[row][fromIdx.x] = -dAzFrom_dE_From;
      if (fromIdx?.y != null) A[row][fromIdx.y] = -dAzFrom_dN_From;
      if (atIdx?.x != null) A[row][atIdx.x] = -dAzTo_dE_To + dAzFrom_dE_From;
      if (atIdx?.y != null) A[row][atIdx.y] = -dAzTo_dN_To + dAzFrom_dN_From;
      P[row][row] = 1 / (sigmaUsed * sigmaUsed);
      row += 1;
      return;
    }

    if (observation.type === 'gps') {
      const fromStation = dependencies.stations[observation.from];
      const toStation = dependencies.stations[observation.to];
      if (!fromStation || !toStation) return;
      const corrected = dependencies.gpsObservedVector(observation);
      const calc_dE = toStation.x - fromStation.x;
      const calc_dN = toStation.y - fromStation.y;
      const vE = corrected.dE - calc_dE;
      const vN = corrected.dN - calc_dN;
      L[row][0] = vE;
      rowInfo.push({ obs: observation, component: 'E' });
      const fromIdx = dependencies.paramIndex[observation.from];
      const toIdx = dependencies.paramIndex[observation.to];
      if (fromIdx?.x != null) A[row][fromIdx.x] = -1;
      if (toIdx?.x != null) A[row][toIdx.x] = 1;
      const weight = dependencies.gpsWeight(observation);
      P[row][row] = weight.wEE;
      P[row][row + 1] = weight.wEN;
      P[row + 1][row] = weight.wEN;
      P[row + 1][row + 1] = weight.wNN;
      L[row + 1][0] = vN;
      rowInfo.push({ obs: observation, component: 'N' });
      if (fromIdx?.y != null) A[row + 1][fromIdx.y] = -1;
      if (toIdx?.y != null) A[row + 1][toIdx.y] = 1;
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
      if (fromIdx?.h != null) A[row][fromIdx.h] = -1;
      if (toIdx?.h != null) A[row][toIdx.h] = 1;
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
        A,
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
      if (toIdx?.x != null) A[row][toIdx.x] = dAz_dE_To;
      if (toIdx?.y != null) A[row][toIdx.y] = dAz_dN_To;
      if (atIdx?.x != null) A[row][atIdx.x] = -dAz_dE_To;
      if (atIdx?.y != null) A[row][atIdx.y] = -dAz_dN_To;
      const dirIdx = dependencies.dirParamMap[observation.setId];
      if (dirIdx != null) A[row][dirIdx] = 1;
      P[row][row] = 1 / (sigmaUsed * sigmaUsed);
      row += 1;
      return;
    }

    if (observation.type === 'zenith') {
      const fromStation = dependencies.stations[observation.from];
      const toStation = dependencies.stations[observation.to];
      if (!fromStation || !toStation) return;
      const zenith = dependencies.getZenith(
        observation.from,
        observation.to,
        observation.hi ?? 0,
        observation.ht ?? 0,
      );
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
      const dx = toStation.x - fromStation.x;
      const dy = toStation.y - fromStation.y;
      const dZ_dEGeom = zenith.dh * dx * common;
      const dZ_dNGeom = zenith.dh * dy * common;
      const dC_dHoriz = dependencies.curvatureRefractionAngle(1);
      const dHoriz_dE = zenith.horiz > 0 ? dx / zenith.horiz : 0;
      const dHoriz_dN = zenith.horiz > 0 ? dy / zenith.horiz : 0;
      const dZ_dE = dZ_dEGeom + dC_dHoriz * dHoriz_dE;
      const dZ_dN = dZ_dNGeom + dC_dHoriz * dHoriz_dN;
      const dZ_dH = -(zenith.horiz * zenith.horiz) * common;
      const toIdx = dependencies.paramIndex[observation.to];
      const fromIdx = dependencies.paramIndex[observation.from];
      if (toIdx?.x != null) A[row][toIdx.x] = dZ_dE;
      if (toIdx?.y != null) A[row][toIdx.y] = dZ_dN;
      if (toIdx?.h != null) A[row][toIdx.h] = dZ_dH;
      if (fromIdx?.x != null) A[row][fromIdx.x] = -dZ_dE;
      if (fromIdx?.y != null) A[row][fromIdx.y] = -dZ_dN;
      if (fromIdx?.h != null) A[row][fromIdx.h] = -dZ_dH;
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
    A[row][constraint.index] = 1;
    P[row][row] = 1 / (constraint.sigma * constraint.sigma);
    rowInfo.push(null);
    constraintPlacements.push({ row, constraint });
    row += 1;
  });

  applyCoordinateConstraintCorrelationWeights(P, constraintPlacements);
  dependencies.applyTsCorrelationToWeightMatrix(P, rowInfo);
  return { A, L, P, rowInfo };
};
