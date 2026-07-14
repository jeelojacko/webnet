import { RAD_TO_DEG } from './angles';
import { transformSymmetricCovariance3 } from './adjustGpsMath';
import { accumulateNormalEquationsFromSparseRows, multiplySparseRowsByDenseMatrix, zeros } from './matrix';
import { makePairKey } from './adjustMath';
import { assembleAdjustmentEquations } from './adjustmentEquationAssembly';
import { buildCoordinateConstraints, coordinateConstraintWeightedSum } from './adjustmentConstraints';
import { getObservationSetId } from './observationMetadata';
import { buildChiSquareSummary } from './adjustmentStatisticalMath';
import { buildWeakGeometryDiagnostics } from './adjustmentWeakGeometry';
import { buildDirectionDiagnostics, type DirectionSetStat } from './adjustmentDirectionDiagnostics';
import { buildTsCorrelationDiagnostics, type TsCorrelationResidualGroups } from './adjustmentTsCorrelationDiagnostics';
import { buildSetupDiagnostics, buildTraverseDiagnostics } from './adjustmentSetupTraverseDiagnostics';
import { buildObservationTypeSummary, buildResidualDiagnostics, buildStatisticalSummary } from './adjustmentStatisticsBuilders';
import { buildHorizontalErrorEllipse, buildDistanceAzimuthPrecision, buildRelativeCovarianceFromEndpoints, sqrtPrecisionComponent } from './precisionPropagation';
import { scaleRelativeCovarianceRows, scaleStationCovarianceRows } from './resultPrecision';
import type { SolveTimingBuckets } from './adjustSolveTiming';
import type { GpsCovariance, GpsSolveVector, GpsVectorDerivatives } from './adjustTypes';
import type { EquationRowInfo, RobustWeightMatrixBase, RobustWeightSummary, SolveParameterIndex } from './adjustmentSolveTypes';
import type { AdjustmentResult, GpsObservation, Observation, Station, StationId, StationMap } from '../types';

type CorrectedDistanceModelResult = {
  calcDistance: number;
  mapScale: number;
  prismCorrection: number;
  horizontalDerivativeFactor?: number;
  verticalDerivativeFactor?: number;
  useReducedSlopeDerivatives?: boolean;
};

type ModeledZenith = {
  z: number;
  dist: number;
  horiz: number;
  dh: number;
  crCorr: number;
  horizontalScale: number;
};

type AzimuthDistance = { az: number; dist: number };

type TsCorrelationGroup = { key: string; station: StationId; setId?: string };

export type AdjustmentStatisticsContext = {
  observations: Observation[];
  stations: StationMap;
  unknowns: StationId[];
  paramIndex: SolveParameterIndex;
  Qxx: number[][] | null;
  is2D: boolean;
  directionOrientations: Record<string, number>;
  dof: number;
  seuw: number;
  preanalysisMode: boolean;
  robustMode: string | undefined;
  tsCorrelationEnabled: boolean;
  tsCorrelationRho: number;
  tsCorrelationScope: 'setup' | 'set' | undefined;
  localTestCritical: number;
  maxStdRes: number;
  traverseThresholds: {
    minClosureRatio: number;
    maxLinearPpm: number;
    maxAngularArcSec: number;
    maxVerticalMisclosure: number;
  };
  parseState?: { relativeLinePairs?: Array<{ from: StationId; to: StationId }>; positionalTolerancePairs?: Array<{ from: StationId; to: StationId }> };
  solveTiming: SolveTimingBuckets;
  logs: string[];
  chiSquare?: AdjustmentResult['chiSquare'];
  statisticalSummary?: AdjustmentResult['statisticalSummary'];
  typeSummary?: AdjustmentResult['typeSummary'];
  directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
  directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
  directionRepeatabilityDiagnostics?: AdjustmentResult['directionRepeatabilityDiagnostics'];
  setupDiagnostics?: AdjustmentResult['setupDiagnostics'];
  residualDiagnostics?: AdjustmentResult['residualDiagnostics'];
  traverseDiagnostics?: AdjustmentResult['traverseDiagnostics'];
  autoSideshotDiagnostics?: AdjustmentResult['autoSideshotDiagnostics'];
  tsCorrelationDiagnostics?: AdjustmentResult['tsCorrelationDiagnostics'];
  precisionModels?: AdjustmentResult['precisionModels'];
  stationCovariances?: AdjustmentResult['stationCovariances'];
  relativePrecision?: AdjustmentResult['relativePrecision'];
  relativeCovariances?: AdjustmentResult['relativeCovariances'];
  weakGeometryDiagnostics?: AdjustmentResult['weakGeometryDiagnostics'];
  sideshots?: AdjustmentResult['sideshots'];
  clearGeometryCache: () => void;
  collectActiveObservations: () => Observation[];
  correctedDistanceModel: (_obs: Observation & { type: 'dist' }, _calcDistRaw: number) => CorrectedDistanceModelResult;
  curvatureRefractionAngle: (_horiz: number) => number;
  effectiveDistanceForAngularObservation: (_obs: Observation) => number | undefined;
  effectiveStdDev: (_obs: Observation) => number;
  getAzimuth: (_fromId: StationId, _toId: StationId) => AzimuthDistance;
  getModeledZenith: (_obs: Observation & { type: 'zenith' }) => ModeledZenith;
  getObservedHorizontalDistanceIn2D: (_obs: Observation & { type: 'dist' }) => {
    observedDistance: number;
    sigmaDistance: number;
    usedZenith: boolean;
  };
  gpsComponentCount: (_obs: GpsObservation) => number;
  gpsCovariance: (_obs: Observation) => GpsCovariance;
  gpsDisplayResidualTransform: (_obs: GpsObservation, _fromStation?: Station) => number[][] | null;
  gpsModeledVector: (_obs: GpsObservation) => GpsSolveVector;
  gpsModeledVectorDerivatives: (_obs: GpsObservation) => GpsVectorDerivatives;
  gpsObservedVector: (_obs: GpsObservation) => GpsSolveVector;
  gpsWeight: (_obs: Observation) => { wEE: number; wEN: number; wNN: number; wUU?: number; wEU?: number; wNU?: number };
  invertNormalMatrixForStats: (_normal: number[][], _useFallback?: boolean) => number[][];
  isObservationActive: (_obs: Observation) => boolean;
  measuredAngleCorrection: (_at: StationId, _from: StationId, _to: StationId) => number;
  modeledAzimuth: (_rawAz: number, _atStationId?: StationId, _applyConvergence?: boolean) => number;
  wrapToPi: (_value: number) => number;
  applyRobustWeightFactors: (_matrix: number[][], _base: RobustWeightMatrixBase, _factors: number[]) => void;
  applyTsCorrelationToWeightMatrix: (
    _matrix: number[][],
    _rowInfo: EquationRowInfo[],
    _captureDiagnostics?: boolean,
  ) => void;
  captureObservationWeightingStdDevs: (_observations: Observation[]) => void;
  captureRobustWeightBase: (_matrix: number[][], _rowInfo: EquationRowInfo[]) => RobustWeightMatrixBase;
  computeRobustWeightSummary: (_residuals: number[], _rowInfo: EquationRowInfo[]) => RobustWeightSummary;
  computeSideshotResults: () => AdjustmentResult['sideshots'];
  log: (_message: string) => void;
  tsCorrelationGroup: (_obs: Observation) => TsCorrelationGroup | null;
};

export const calculateAdjustmentStatistics = (
  ctx: AdjustmentStatisticsContext,
  paramIndex: Record<StationId, { x?: number; y?: number; h?: number }>,
  hasQxx: boolean,
  activeObservationsInput?: Observation[],
): void => {    ctx.clearGeometryCache();
    let vtpv = 0;
    const closureResiduals: string[] = [];
    const closureVectors: { from: StationId; to: StationId; dE: number; dN: number }[] = [];
    const loopVectors: Record<string, { dE: number; dN: number }> = {};
    const loopAngleArcSec = new Map<string, number>();
    const loopVerticalMisclosure = new Map<string, number>();
    const hasClosureObs = ctx.observations.some(
      (o) => String(getObservationSetId(o) ?? '').toUpperCase() === 'TE',
    );
    const coordClosureVectors: { from: StationId; to: StationId; dE: number; dN: number }[] = [];
    let totalTraverseDistance = 0;
    const directionStats = new Map<string, DirectionSetStat>();
    const activeObservations = activeObservationsInput ?? ctx.collectActiveObservations();
    const constraints = buildCoordinateConstraints(ctx.stations, paramIndex, ctx.is2D);
    const tsCorrelationRows: TsCorrelationResidualGroups = new Map();
    const groupOrder = ['Angles', 'Directions', 'Distances', 'Az/Bearings', 'GPS', 'Level Data', 'Zenith'];
    const summarizeGroup = (obs: Observation): string => {
      if (obs.type === 'angle') return 'Angles';
      if (obs.type === 'direction' || obs.type === 'dir') return 'Directions';
      if (obs.type === 'bearing') return 'Az/Bearings';
      if (obs.type === 'dist') return 'Distances';
      if (obs.type === 'gps') return 'GPS';
      if (obs.type === 'lev') return 'Level Data';
      if (obs.type === 'zenith') return 'Zenith';
      return 'Other';
    };
    const weightedByGroup = new Map<string, { count: number; sumSquares: number }>();
    const ensureGroup = (label: string): { count: number; sumSquares: number } => {
      const existing = weightedByGroup.get(label);
      if (existing) return existing;
      const init = { count: 0, sumSquares: 0 };
      weightedByGroup.set(label, init);
      return init;
    };
    const observationEquationCount = (obs: Observation): number => {
      if (obs.type !== 'gps') return 1;
      return ctx.gpsComponentCount(obs);
    };
    const addObservationContribution = (obs: Observation, contribution: number) => {
      const label = summarizeGroup(obs);
      const row = ensureGroup(label);
      row.count += observationEquationCount(obs);
      row.sumSquares += contribution;
    };
    const addGroupContribution = (label: string, contribution: number) => {
      const row = ensureGroup(label);
      row.sumSquares += contribution;
    };
    const collectTsCorrelationRow = (obs: Observation, v: number, sigma: number) => {
      const group = ctx.tsCorrelationGroup(obs);
      if (!group) return;
      if (!Number.isFinite(v) || !Number.isFinite(sigma) || sigma <= 0) return;
      const entry = tsCorrelationRows.get(group.key) ?? {
        station: group.station,
        setId: group.setId,
        rows: [],
      };
      entry.rows.push({ v, sigma, groupLabel: summarizeGroup(obs) });
      tsCorrelationRows.set(group.key, entry);
    };

    activeObservations.forEach((obs) => {
      obs.effectiveDistance = undefined;
      if (obs.type === 'dist') {
        const s1 = ctx.stations[obs.from];
        const s2 = ctx.stations[obs.to];
        if (!s1 || !s2) return;
        const dx = s2.x - s1.x;
        const dy = s2.y - s1.y;
        const dz = s2.h + (obs.ht ?? 0) - (s1.h + (obs.hi ?? 0));
        const horiz = Math.sqrt(dx * dx + dy * dy);
        const calcRaw = ctx.is2D
          ? horiz
          : obs.mode === 'slope'
            ? Math.sqrt(horiz * horiz + dz * dz)
            : horiz;
        const calc = ctx.correctedDistanceModel(obs, calcRaw).calcDistance;
        const v = obs.obs - calc;
        obs.calc = calc;
        obs.residual = v;
        const sigma = ctx.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        const setTag = String(getObservationSetId(obs) ?? '').toUpperCase();
        if (setTag === 'T' || setTag === 'TE') {
          totalTraverseDistance += Math.abs(obs.obs);
        }
      } else if (obs.type === 'angle') {
        obs.effectiveDistance = ctx.effectiveDistanceForAngularObservation(obs);
        const azTo = ctx.getAzimuth(obs.at, obs.to).az;
        const azFrom = ctx.getAzimuth(obs.at, obs.from).az;
        let calcAngle = azTo - azFrom;
        if (obs.gridObsMode !== 'grid') {
          calcAngle += ctx.measuredAngleCorrection(obs.at, obs.from, obs.to);
        }
        if (calcAngle < 0) calcAngle += 2 * Math.PI;
        let v = obs.obs - calcAngle;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = calcAngle;
        obs.residual = v;
        const sigma = ctx.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        collectTsCorrelationRow(obs, v, sigma);
      } else if (obs.type === 'gps') {
        const corrected = ctx.gpsObservedVector(obs);
        const calc = ctx.gpsModeledVector(obs);
        const vE = corrected.dE - calc.dE;
        const vN = corrected.dN - calc.dN;
        const vU =
          !ctx.is2D &&
          Number.isFinite(corrected.dU ?? Number.NaN) &&
          Number.isFinite(calc.dU ?? Number.NaN)
            ? (corrected.dU as number) - (calc.dU as number)
            : undefined;
        obs.calc = calc;
        obs.residual = { vE, vN, vU };
        const w = ctx.gpsWeight(obs);
        const quad =
          w.wEE * vE * vE +
          2 * w.wEN * vE * vN +
          w.wNN * vN * vN +
          ((vU != null && w.wUU != null ? w.wUU * vU * vU : 0) +
            (vU != null && w.wEU != null ? 2 * w.wEU * vE * vU : 0) +
            (vU != null && w.wNU != null ? 2 * w.wNU * vN * vU : 0));
        obs.stdRes = Math.sqrt(Math.max(quad, 0));
        vtpv += quad;
        addObservationContribution(obs, quad);
      } else if (obs.type === 'lev') {
        const s1 = ctx.stations[obs.from];
        const s2 = ctx.stations[obs.to];
        if (!s1 || !s2) return;
        const calc_dH = s2.h - s1.h;
        const v = obs.obs - calc_dH;
        obs.calc = calc_dH;
        obs.residual = v;
        const sigma = ctx.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
      } else if (obs.type === 'bearing') {
        obs.effectiveDistance = ctx.effectiveDistanceForAngularObservation(obs);
        const calcAz = ctx.modeledAzimuth(
          ctx.getAzimuth(obs.from, obs.to).az,
          obs.from,
          obs.gridObsMode !== 'grid',
        );
        let v = obs.obs - calcAz;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = calcAz;
        obs.residual = v;
        const sigma = ctx.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        collectTsCorrelationRow(obs, v, sigma);
      } else if (obs.type === 'dir') {
        obs.effectiveDistance = ctx.effectiveDistanceForAngularObservation(obs);
        const calcAz = ctx.modeledAzimuth(
          ctx.getAzimuth(obs.from, obs.to).az,
          obs.from,
          obs.gridObsMode !== 'grid',
        );
        let v0 = obs.obs - calcAz;
        if (v0 > Math.PI) v0 -= 2 * Math.PI;
        if (v0 < -Math.PI) v0 += 2 * Math.PI;
        let v = v0;
        if (obs.flip180) {
          let v1 = obs.obs + Math.PI - calcAz;
          if (v1 > Math.PI) v1 -= 2 * Math.PI;
          if (v1 < -Math.PI) v1 += 2 * Math.PI;
          if (Math.abs(v1) < Math.abs(v0)) v = v1;
        }
        obs.calc = calcAz;
        obs.residual = v;
        const sigma = ctx.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        collectTsCorrelationRow(obs, v, sigma);
      } else if (obs.type === 'direction') {
        obs.effectiveDistance = ctx.effectiveDistanceForAngularObservation(obs);
        const az = ctx.modeledAzimuth(
          ctx.getAzimuth(obs.at, obs.to).az,
          obs.at,
          obs.gridObsMode !== 'grid',
        );
        const setId = getObservationSetId(obs) ?? 'unknown';
        const orientation = ctx.directionOrientations[setId] ?? 0;
        let calc = orientation + az;
        calc %= 2 * Math.PI;
        if (calc < 0) calc += 2 * Math.PI;
        let v = obs.obs - calc;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = calc;
        obs.residual = v;
        const sigma = ctx.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
        collectTsCorrelationRow(obs, v, sigma);

        const stat = directionStats.get(setId) ?? {
          count: 0,
          rawCount: 0,
          reducedCount: 0,
          face1Count: 0,
          face2Count: 0,
          pairedTargets: 0,
          sum: 0,
          sumSq: 0,
          maxAbs: 0,
          pairDeltaCount: 0,
          pairDeltaSum: 0,
          pairDeltaMax: 0,
          rawMaxResidualCount: 0,
          rawMaxResidualSum: 0,
          rawMaxResidualMax: 0,
          targetIds: new Set<StationId>(),
          occupy: obs.at,
          orientation,
        };
        const arcsec = v * RAD_TO_DEG * 3600;
        const rawCount = typeof obs.rawCount === 'number' && obs.rawCount > 0 ? obs.rawCount : 1;
        const face1Count =
          typeof obs.rawFace1Count === 'number'
            ? obs.rawFace1Count
            : obs.obs >= Math.PI
              ? 0
              : rawCount;
        const face2Count =
          typeof obs.rawFace2Count === 'number'
            ? obs.rawFace2Count
            : Math.max(0, rawCount - face1Count);
        stat.count += 1;
        stat.rawCount += rawCount;
        stat.reducedCount += 1;
        stat.face1Count += face1Count;
        stat.face2Count += face2Count;
        if (face1Count > 0 && face2Count > 0) stat.pairedTargets += 1;
        stat.sum += arcsec;
        stat.sumSq += arcsec * arcsec;
        stat.maxAbs = Math.max(stat.maxAbs, Math.abs(arcsec));
        const pairDeltaArcSec =
          typeof obs.facePairDelta === 'number'
            ? Math.abs(obs.facePairDelta) * RAD_TO_DEG * 3600
            : undefined;
        if (pairDeltaArcSec != null && Number.isFinite(pairDeltaArcSec)) {
          stat.pairDeltaCount += 1;
          stat.pairDeltaSum += pairDeltaArcSec;
          stat.pairDeltaMax = Math.max(stat.pairDeltaMax, pairDeltaArcSec);
        }
        const rawMaxResidualArcSec =
          typeof obs.rawMaxResidual === 'number'
            ? Math.abs(obs.rawMaxResidual) * RAD_TO_DEG * 3600
            : undefined;
        if (rawMaxResidualArcSec != null && Number.isFinite(rawMaxResidualArcSec)) {
          stat.rawMaxResidualCount += 1;
          stat.rawMaxResidualSum += rawMaxResidualArcSec;
          stat.rawMaxResidualMax = Math.max(stat.rawMaxResidualMax, rawMaxResidualArcSec);
        }
        if (typeof obs.to === 'string' && obs.to.trim().length > 0) {
          stat.targetIds.add(obs.to);
        }
        stat.occupy = obs.at ?? stat.occupy;
        stat.orientation = orientation;
        directionStats.set(setId, stat);
      } else if (obs.type === 'zenith') {
        obs.effectiveDistance = ctx.effectiveDistanceForAngularObservation(obs);
        const zv = ctx.getModeledZenith(obs).z;
        let v = obs.obs - zv;
        if (v > Math.PI) v -= 2 * Math.PI;
        if (v < -Math.PI) v += 2 * Math.PI;
        obs.calc = zv;
        obs.residual = v;
        const sigma = ctx.effectiveStdDev(obs);
        obs.stdRes = Math.abs(v) / sigma;
        const q = (v * v) / (sigma * sigma);
        vtpv += q;
        addObservationContribution(obs, q);
      }

      if (obs.setId === 'TE' && typeof obs.residual === 'number') {
        if (obs.type === 'dist') {
          const key = `${obs.from}->${obs.to}`;
          const az = ctx.getAzimuth(obs.from, obs.to).az;
          const dE = obs.residual * Math.sin(az);
          const dN = obs.residual * Math.cos(az);
          closureVectors.push({ from: obs.from, to: obs.to, dE, dN });
          loopVectors[key] = loopVectors[key] || { dE: 0, dN: 0 };
          loopVectors[key].dE += dE;
          loopVectors[key].dN += dN;
          closureResiduals.push(
            `Traverse closure residual ${obs.from}-${obs.to}: ${obs.residual.toFixed(4)} m`,
          );
          const s1 = ctx.stations[obs.from];
          const s2 = ctx.stations[obs.to];
          if (s1 && s2) {
            coordClosureVectors.push({
              from: obs.from,
              to: obs.to,
              dE: s2.x - s1.x,
              dN: s2.y - s1.y,
            });
          }
        } else if (obs.type === 'angle') {
          const key = `${obs.from}->${obs.to}`;
          const angleArcSec = obs.residual * RAD_TO_DEG * 3600;
          loopAngleArcSec.set(key, (loopAngleArcSec.get(key) ?? 0) + angleArcSec);
          closureResiduals.push(
            `Traverse closure residual (angle) ${obs.from}-${obs.to}: ${(obs.residual * RAD_TO_DEG * 3600).toFixed(2)}"`,
          );
        } else if (obs.type === 'lev') {
          const key = `${obs.from}->${obs.to}`;
          loopVerticalMisclosure.set(key, (loopVerticalMisclosure.get(key) ?? 0) + obs.residual);
          closureResiduals.push(
            `Traverse closure residual (dH) ${obs.from}-${obs.to}: ${obs.residual.toFixed(4)} m`,
          );
        }
      }
    });

    vtpv += coordinateConstraintWeightedSum(ctx.stations, constraints);

    const tsCorrelationDiagnostics = buildTsCorrelationDiagnostics({
      enabled: ctx.tsCorrelationEnabled && ctx.tsCorrelationRho > 0,
      rho: ctx.tsCorrelationRho,
      scope: ctx.tsCorrelationScope ?? 'set',
      rows: tsCorrelationRows,
    });
    vtpv += tsCorrelationDiagnostics.vtpvDelta;
    tsCorrelationDiagnostics.groupContributions.forEach(({ label, contribution }) => {
      addGroupContribution(label, contribution);
    });
    ctx.tsCorrelationDiagnostics = tsCorrelationDiagnostics.diagnostics;
    if (tsCorrelationDiagnostics.logLine) {
      ctx.log(tsCorrelationDiagnostics.logLine);
    }
    ctx.seuw = ctx.preanalysisMode ? 1 : ctx.dof > 0 ? Math.sqrt(vtpv / ctx.dof) : 0;

    ctx.chiSquare = undefined;
    ctx.statisticalSummary = undefined;
    ctx.typeSummary = undefined;
    ctx.directionSetDiagnostics = undefined;
    ctx.directionTargetDiagnostics = undefined;
    ctx.directionRepeatabilityDiagnostics = undefined;
    ctx.setupDiagnostics = undefined;
    ctx.residualDiagnostics = undefined;
    ctx.traverseDiagnostics = undefined;
    ctx.autoSideshotDiagnostics = undefined;

    if (!ctx.preanalysisMode && ctx.dof > 0) {
      ctx.chiSquare = buildChiSquareSummary(vtpv, ctx.dof, 0.05);
    }

    if (hasQxx) {
      const stationParamCount =
        Object.values(paramIndex).reduce((max, idx) => {
          const vals = [idx.x ?? -1, idx.y ?? -1, idx.h ?? -1];
          return Math.max(max, ...vals);
        }, -1) + 1;
      const directionSetIds = Array.from(
        new Set(
          activeObservations
            .filter((o) => o.type === 'direction')
            .map((o) => getObservationSetId(o))
            .filter((setId): setId is string => typeof setId === 'string'),
        ),
      );
      const dirParamMap: Record<string, number> = {};
      directionSetIds.forEach((id, idx) => {
        dirParamMap[id] = stationParamCount + idx;
      });
      const numParams = stationParamCount + directionSetIds.length;
      const numObsEquations =
        activeObservations.reduce(
          (acc, o) =>
            acc +
            (o.type === 'gps' && !ctx.is2D && Number.isFinite(o.obs.dU ?? Number.NaN)
              ? 3
              : o.type === 'gps'
                ? 2
                : 1),
          0,
        ) +
        constraints.length;

      if (numParams > 0 && numObsEquations > 0) {
        const { L, P, rowInfo, sparseRows } = assembleAdjustmentEquations(
          {
            stations: ctx.stations,
            paramIndex: ctx.paramIndex,
            is2D: ctx.is2D,
            debug: false,
            directionOrientations: ctx.directionOrientations,
            dirParamMap,
            effectiveStdDev: ctx.effectiveStdDev.bind(this),
            correctedDistanceModel: ctx.correctedDistanceModel.bind(this),
            getObservedHorizontalDistanceIn2D: ctx.getObservedHorizontalDistanceIn2D.bind(this),
            getAzimuth: ctx.getAzimuth.bind(this),
            measuredAngleCorrection: ctx.measuredAngleCorrection.bind(this),
            modeledAzimuth: ctx.modeledAzimuth.bind(this),
            wrapToPi: ctx.wrapToPi.bind(this),
            gpsObservedVector: ctx.gpsObservedVector.bind(this),
            gpsModeledVector: ctx.gpsModeledVector.bind(this),
            gpsModeledVectorDerivatives: ctx.gpsModeledVectorDerivatives.bind(this),
            gpsWeight: ctx.gpsWeight.bind(this),
            getModeledZenith: ctx.getModeledZenith.bind(this),
            curvatureRefractionAngle: ctx.curvatureRefractionAngle.bind(this),
            applyTsCorrelationToWeightMatrix: (weightMatrix, weightRowInfo) =>
              ctx.applyTsCorrelationToWeightMatrix(weightMatrix, weightRowInfo, true),
          },
          activeObservations,
          constraints,
          numObsEquations,
          numParams,
          undefined,
          { includeDenseA: false },
        );

        if (!ctx.preanalysisMode && ctx.robustMode === 'huber') {
          const baseWeights = ctx.captureRobustWeightBase(P, rowInfo);
          const residuals = L.map((row) => -row[0]);
          const summary = ctx.computeRobustWeightSummary(residuals, rowInfo);
          ctx.applyRobustWeightFactors(P, baseWeights, summary.factors);
        }

        if (!ctx.preanalysisMode) {
          try {
            const { normal: N } = accumulateNormalEquationsFromSparseRows(
              sparseRows,
              zeros(numObsEquations, 1),
              P,
              numParams,
            );
            const QxxStats = ctx.invertNormalMatrixForStats(N);
            const B = multiplySparseRowsByDenseMatrix(sparseRows, QxxStats);
            const rowStats = new Map<
              number,
              {
                t: number[];
                r: number[];
                mdb: number[];
                pass: boolean[];
                comps: ('E' | 'N' | 'U' | undefined)[];
                rows: number[];
              }
            >();
            const s0 = ctx.seuw || 1;
            for (let i = 0; i < numObsEquations; i += 1) {
              const info = rowInfo[i];
              if (!info) continue;
              const sigma = ctx.effectiveStdDev(info.obs);
              let qll = sigma > 0 ? sigma * sigma : 0;
              if (info.obs.type === 'gps') {
                const cov = ctx.gpsCovariance(info.obs);
                qll =
                  info.component === 'N'
                    ? cov.cNN
                    : info.component === 'U'
                      ? (cov.cUU ?? cov.cNN)
                      : cov.cEE;
              }
              let diag = 0;
              const sparseRow = sparseRows[i] ?? [];
              for (let j = 0; j < sparseRow.length; j += 1) {
                const entry = sparseRow[j];
                diag += B[i][entry.index] * entry.value;
              }
              const qvv = Math.max(qll - diag, 1e-20);
              const t = L[i][0] / (s0 * Math.sqrt(qvv));
              const r = qll > 0 ? qvv / qll : 0;
              const pass = Math.abs(t) <= ctx.localTestCritical;
              const sigmaQll = Math.sqrt(Math.max(qll, 0));
              const mdb =
                r > 1e-12
                  ? (ctx.localTestCritical * s0 * sigmaQll) / Math.sqrt(r)
                  : Number.POSITIVE_INFINITY;
              const entry = rowStats.get(info.obs.id) ?? {
                t: [],
                r: [],
                mdb: [],
                pass: [],
                comps: [],
                rows: [],
              };
              entry.t.push(t);
              entry.r.push(r);
              entry.mdb.push(mdb);
              entry.pass.push(pass);
              entry.comps.push(info.component);
              entry.rows.push(i);
              rowStats.set(info.obs.id, entry);
            }

            activeObservations.forEach((obs) => {
              const entry = rowStats.get(obs.id);
              if (!entry) return;
              if (obs.type === 'gps') {
                const gpsObs = obs as GpsObservation;
                const componentOrder = entry.comps.filter(
                  (component): component is 'E' | 'N' | 'U' => component != null,
                );
                const componentIndex = new Map(componentOrder.map((component, index) => [component, index]));
                const cov = ctx.gpsCovariance(gpsObs);
                const solveQll = componentOrder.map((rowComponent) =>
                  componentOrder.map((colComponent) => {
                    if (rowComponent === 'E' && colComponent === 'E') return cov.cEE;
                    if (rowComponent === 'N' && colComponent === 'N') return cov.cNN;
                    if (rowComponent === 'U' && colComponent === 'U') return cov.cUU ?? cov.cNN;
                    if (
                      (rowComponent === 'E' && colComponent === 'N') ||
                      (rowComponent === 'N' && colComponent === 'E')
                    ) {
                      return cov.cEN;
                    }
                    if (
                      (rowComponent === 'E' && colComponent === 'U') ||
                      (rowComponent === 'U' && colComponent === 'E')
                    ) {
                      return cov.cEU ?? 0;
                    }
                    return cov.cNU ?? 0;
                  }),
                );
                const solveQvv = solveQll.map((solveRow, rowIndex) =>
                  solveRow.map((qllValue, colIndex) => {
                    let aqxxat = 0;
                    const sparseColRow = sparseRows[entry.rows[colIndex]] ?? [];
                    for (let paramEntryIndex = 0; paramEntryIndex < sparseColRow.length; paramEntryIndex += 1) {
                      const paramEntry = sparseColRow[paramEntryIndex];
                      aqxxat +=
                        B[entry.rows[rowIndex]][paramEntry.index] * paramEntry.value;
                    }
                    return Math.max(qllValue - aqxxat, 0);
                  }),
                );
                const solveResidualVector = componentOrder.map((component) =>
                  component === 'N'
                    ? (gpsObs.residual?.vN ?? 0)
                    : component === 'U'
                      ? (gpsObs.residual?.vU ?? 0)
                      : (gpsObs.residual?.vE ?? 0),
                );
                const displayTransform = ctx.gpsDisplayResidualTransform(
                  gpsObs,
                  ctx.stations[gpsObs.from],
                );
                const toDisplayVector = (values: number[]) => {
                  if (!displayTransform || values.length !== 3) return values;
                  return displayTransform.map(
                    (transformRow) =>
                      transformRow[0] * values[0] + transformRow[1] * values[1] + transformRow[2] * values[2],
                  );
                };
                const toDisplayCovariance = (covariance: number[][]) => {
                  if (!displayTransform || covariance.length !== 3) return covariance;
                  return transformSymmetricCovariance3(displayTransform, covariance);
                };
                const displayResidualVector = toDisplayVector(solveResidualVector);
                const displayQvv = toDisplayCovariance(solveQvv);
                const residualStdErr = (component: 'E' | 'N' | 'U'): number | undefined => {
                  const index = componentIndex.get(component);
                  if (index == null) return undefined;
                  return ctx.seuw * Math.sqrt(Math.max(displayQvv[index]?.[index] ?? 0, 0));
                };
                const componentStdRes = (component: 'E' | 'N' | 'U'): number | undefined => {
                  const index = componentIndex.get(component);
                  if (index == null) return undefined;
                  const sigma = residualStdErr(component);
                  if (!Number.isFinite(sigma) || (sigma ?? 0) <= 0) return undefined;
                  return Math.abs(displayResidualVector[index] ?? 0) / (sigma as number);
                };
                gpsObs.componentResidualStdErr = {
                  sE: residualStdErr('E'),
                  sN: residualStdErr('N'),
                  sU: residualStdErr('U'),
                };
                gpsObs.componentStdRes = {
                  tE: componentStdRes('E'),
                  tN: componentStdRes('N'),
                  tU: componentStdRes('U'),
                };
              }
              if (entry.t.length === 2 && entry.comps.includes('E') && entry.comps.includes('N')) {
                const idxE = entry.comps.indexOf('E');
                const idxN = entry.comps.indexOf('N');
                const tE = entry.t[idxE];
                const tN = entry.t[idxN];
                const rE = entry.r[idxE];
                const rN = entry.r[idxN];
                const mE = entry.mdb[idxE];
                const mN = entry.mdb[idxN];
                const passE = entry.pass[idxE];
                const passN = entry.pass[idxN];
                obs.stdResComponents = { tE, tN };
                obs.stdRes = Math.max(Math.abs(tE), Math.abs(tN));
                obs.redundancy = { rE, rN };
                obs.localTest = { critical: ctx.localTestCritical, pass: passE && passN };
                obs.localTestComponents = { passE, passN };
                obs.mdbComponents = { mE, mN };
              } else if (obs.type === 'gps' && entry.t.length > 2) {
                obs.stdRes = Math.max(...entry.t.map((value) => Math.abs(value)));
                obs.redundancy = Math.min(...entry.r);
                obs.localTest = {
                  critical: ctx.localTestCritical,
                  pass: entry.pass.every(Boolean),
                };
                obs.mdb = Math.min(...entry.mdb.filter((value) => Number.isFinite(value)));
              } else {
                obs.stdRes = Math.abs(entry.t[0]);
                obs.redundancy = entry.r[0];
                obs.localTest = { critical: ctx.localTestCritical, pass: entry.pass[0] };
                obs.mdb = entry.mdb[0];
              }
            });
          } catch (error) {
            const detail = error instanceof Error ? ` ${error.message}` : '';
            ctx.log(
              `Warning: standardized residuals not computed (normal matrix factorization failed).${detail}`,
            );
          }
        }
      }
    }

    if (!ctx.preanalysisMode) {
      ctx.statisticalSummary = buildStatisticalSummary(weightedByGroup, groupOrder, ctx.dof);
    }

    if (!ctx.preanalysisMode) {
      // Flag very large standardized residuals
      const flagged = ctx.observations.filter((o) => Math.abs(o.stdRes || 0) > ctx.maxStdRes);
      if (flagged.length) {
        ctx.log(
          `Warning: ${flagged.length} obs exceed ${ctx.maxStdRes} sigma (consider excluding/reweighting).`,
        );
      }
      const localFailed = ctx.observations.filter(
        (o) => ctx.isObservationActive(o) && o.localTest != null && !o.localTest.pass,
      );
      if (localFailed.length) {
        ctx.log(
          `Local test: ${localFailed.length} observation(s) exceed critical |t|>${ctx.localTestCritical.toFixed(
            2,
          )}.`,
        );
      }
    }

    if (!ctx.preanalysisMode) {
      const residualDiagnostics = buildResidualDiagnostics(
        activeObservations,
        ctx.localTestCritical,
      );
      ctx.residualDiagnostics = residualDiagnostics;
      ctx.log(
        `Residual diagnostics: |t|>2=${residualDiagnostics.over2SigmaCount}, |t|>3=${residualDiagnostics.over3SigmaCount}, localFail=${residualDiagnostics.localFailCount}, lowRedund(<0.2)=${residualDiagnostics.lowRedundancyCount}.`,
      );
    }
    if (ctx.preanalysisMode) {
      ctx.log(
        'Preanalysis statistics: using a-priori variance factor 1.0 and skipping residual-based diagnostics.',
      );
    }

    ctx.typeSummary = buildObservationTypeSummary(activeObservations);
    ctx.captureObservationWeightingStdDevs(activeObservations);

    if (hasQxx && ctx.Qxx) {
      const precisionPropagationStartedAt = Date.now();
      const posteriorScaleSq =
        ctx.dof > 0 && Number.isFinite(ctx.seuw) && ctx.seuw > 0 ? ctx.seuw * ctx.seuw : 1;
      if (ctx.dof <= 0) {
        ctx.log('DOF <= 0: using a-priori variance factor 1.0 for point precision scaling.');
      }
      const connectedPairTypes = new Map<string, Set<string>>();
      const addConnectedPair = (a: StationId, b: StationId, label: string): void => {
        if (!a || !b || a === b) return;
        const key = makePairKey(a, b);
        const types = connectedPairTypes.get(key) ?? new Set<string>();
        types.add(label);
        connectedPairTypes.set(key, types);
      };
      activeObservations.forEach((obs) => {
        if (obs.type === 'angle') {
          addConnectedPair(obs.at, obs.from, 'angle');
          addConnectedPair(obs.at, obs.to, 'angle');
          return;
        }
        if (obs.type === 'direction') {
          addConnectedPair(obs.at, obs.to, 'direction');
          return;
        }
        if ('from' in obs && 'to' in obs) {
          addConnectedPair(obs.from, obs.to, obs.type);
        }
      });

      const buildCovariance = (scaleSq: number) => (a?: number | null, b?: number | null): number => {
        if (a == null || b == null) return 0;
        if (!ctx.Qxx?.[a] || ctx.Qxx?.[a][b] == null) return 0;
        return ctx.Qxx[a][b] * scaleSq;
      };
      const sortRelativeCovariances = (
        rows: NonNullable<AdjustmentResult['relativeCovariances']>,
      ) => {
        rows.sort((a, b) => {
          const cmpFrom = a.from.localeCompare(b.from, undefined, { numeric: true });
          if (cmpFrom !== 0) return cmpFrom;
          return a.to.localeCompare(b.to, undefined, { numeric: true });
        });
        return rows;
      };
      const requestedRelativePairs = new Map<
        string,
        {
          from: StationId;
          to: StationId;
          rel: boolean;
          ptol: boolean;
        }
      >();
      const requestedPairKey = (from: StationId, to: StationId): string => {
        const canonical = makePairKey(from, to);
        const [first, second] = canonical.split('|') as [StationId, StationId];
        return `${first}::${second}`;
      };
      const registerRequestedPairs = (
        pairs: Array<{ from: StationId; to: StationId }> | undefined,
        kind: 'rel' | 'ptol',
      ) => {
        pairs?.forEach((pair) => {
          if (!pair?.from || !pair?.to || pair.from === pair.to) return;
          const key = requestedPairKey(pair.from, pair.to);
          const existing = requestedRelativePairs.get(key);
          if (existing) {
            existing.rel ||= kind === 'rel';
            existing.ptol ||= kind === 'ptol';
            return;
          }
          requestedRelativePairs.set(key, {
            from: pair.from,
            to: pair.to,
            rel: kind === 'rel',
            ptol: kind === 'ptol',
          });
        });
      };
      registerRequestedPairs(ctx.parseState?.relativeLinePairs, 'rel');
      registerRequestedPairs(ctx.parseState?.positionalTolerancePairs, 'ptol');
      const buildPrecisionModel = (scaleSq: number): NonNullable<AdjustmentResult['precisionModels']>[keyof NonNullable<AdjustmentResult['precisionModels']>] => {
        const cov = buildCovariance(scaleSq);
        const stationCovariances: NonNullable<AdjustmentResult['stationCovariances']> = [];
        ctx.unknowns.forEach((id) => {
          const idx = paramIndex[id];
          if (!idx) return;
          const hasHorizontal = idx.x != null && idx.y != null;
          const varE = hasHorizontal ? cov(idx.x, idx.x) : 0;
          const varN = hasHorizontal ? cov(idx.y, idx.y) : 0;
          const covEN = hasHorizontal ? cov(idx.x, idx.y) : 0;
          const ellipseSummary = hasHorizontal
            ? buildHorizontalErrorEllipse(varE, varN, covEN)
            : { ellipse: undefined };
          const stationBlock: NonNullable<AdjustmentResult['stationCovariances']>[number] = {
            stationId: id,
            cEE: varE,
            cEN: covEN,
            cNN: varN,
            sigmaE: sqrtPrecisionComponent(varE, Math.abs(varE)),
            sigmaN: sqrtPrecisionComponent(varN, Math.abs(varN)),
            ellipse: ellipseSummary.ellipse,
          };
          if (!ctx.is2D && idx.h != null) {
            const varH = cov(idx.h, idx.h);
            stationBlock.cEH = idx.x != null ? cov(idx.x, idx.h) : 0;
            stationBlock.cNH = idx.y != null ? cov(idx.y, idx.h) : 0;
            stationBlock.cHH = varH;
            stationBlock.sigmaH = sqrtPrecisionComponent(varH, Math.abs(varH));
          }
          stationCovariances.push(stationBlock);
        });

        const buildRelativeCovarianceRow = (
          from: StationId,
          to: StationId,
          relativeCovariance: ReturnType<typeof buildRelativeCovarianceFromEndpoints>,
          connected: boolean,
          connectionTypes: string[],
          selectedByRelativeDirective: boolean,
          selectedByPositionalToleranceDirective: boolean,
        ): NonNullable<AdjustmentResult['relativeCovariances']>[number] => {
          const fromStation = ctx.stations[from];
          const toStation = ctx.stations[to];
          const dE = (toStation?.x ?? 0) - (fromStation?.x ?? 0);
          const dN = (toStation?.y ?? 0) - (fromStation?.y ?? 0);
          const ellipseSummary = buildHorizontalErrorEllipse(
            relativeCovariance.cEE,
            relativeCovariance.cNN,
            relativeCovariance.cEN,
          );
          const { sigmaDist, sigmaAz } = buildDistanceAzimuthPrecision(dE, dN, relativeCovariance);

          const row: NonNullable<AdjustmentResult['relativeCovariances']>[number] = {
            from,
            to,
            connected,
            connectionTypes,
            selectedByRelativeDirective,
            selectedByPositionalToleranceDirective,
            cEE: relativeCovariance.cEE,
            cEN: relativeCovariance.cEN,
            cNN: relativeCovariance.cNN,
            sigmaE: sqrtPrecisionComponent(relativeCovariance.cEE, Math.abs(relativeCovariance.cEE)),
            sigmaN: sqrtPrecisionComponent(relativeCovariance.cNN, Math.abs(relativeCovariance.cNN)),
            sigmaDist,
            sigmaAz,
            ellipse: ellipseSummary.ellipse,
          };

          if (!ctx.is2D) {
            row.cEH = relativeCovariance.cEH;
            row.cNH = relativeCovariance.cNH;
            row.cHH = relativeCovariance.cHH;
            row.sigmaH = sqrtPrecisionComponent(
              relativeCovariance.cHH ?? 0,
              Math.abs(relativeCovariance.cHH ?? 0),
            );
          }

          return row;
        };

        const relativePrecision: NonNullable<AdjustmentResult['relativePrecision']> = [];
        for (let i = 0; i < ctx.unknowns.length; i += 1) {
          for (let j = i + 1; j < ctx.unknowns.length; j += 1) {
            const from = ctx.unknowns[i];
            const to = ctx.unknowns[j];
            const fromStation = ctx.stations[from];
            const toStation = ctx.stations[to];
            const idxFrom = paramIndex[from];
            const idxTo = paramIndex[to];
            if (!fromStation || !toStation || (!idxFrom && !idxTo)) continue;

            const dE = toStation.x - fromStation.x;
            const dN = toStation.y - fromStation.y;
            const horizontalCovariance = buildRelativeCovarianceFromEndpoints(cov, idxFrom, idxTo);
            const ellipseSummary = buildHorizontalErrorEllipse(
              horizontalCovariance.cEE,
              horizontalCovariance.cNN,
              horizontalCovariance.cEN,
            );
            const { sigmaDist, sigmaAz } = buildDistanceAzimuthPrecision(dE, dN, horizontalCovariance);

            relativePrecision.push({
              from,
              to,
              sigmaN: sqrtPrecisionComponent(horizontalCovariance.cNN, Math.abs(horizontalCovariance.cNN)),
              sigmaE: sqrtPrecisionComponent(horizontalCovariance.cEE, Math.abs(horizontalCovariance.cEE)),
              sigmaDist,
              sigmaAz,
              ellipse: ellipseSummary.ellipse,
            });
          }
        }

        const relativeCovariances: NonNullable<AdjustmentResult['relativeCovariances']> = [];
        connectedPairTypes.forEach((types, key) => {
          const [from, to] = key.split('|') as [StationId, StationId];
          const idxFrom = paramIndex[from];
          const idxTo = paramIndex[to];
          if ((!ctx.stations[from] || !ctx.stations[to]) || (!idxFrom && !idxTo)) return;

          const requested = requestedRelativePairs.get(requestedPairKey(from, to));
          const relativeCovariance = buildRelativeCovarianceFromEndpoints(cov, idxFrom, idxTo, !ctx.is2D);
          relativeCovariances.push(
            buildRelativeCovarianceRow(
              from,
              to,
              relativeCovariance,
              true,
              Array.from(types).sort(),
              requested?.rel ?? false,
              requested?.ptol ?? false,
            ),
          );
        });

        requestedRelativePairs.forEach((requested, key) => {
          if (connectedPairTypes.has(key.replace('::', '|'))) return;
          const fromStation = ctx.stations[requested.from];
          const toStation = ctx.stations[requested.to];
          const idxFrom = paramIndex[requested.from];
          const idxTo = paramIndex[requested.to];
          if (!fromStation || !toStation || (!idxFrom && !idxTo)) return;
          const relativeCovariance = buildRelativeCovarianceFromEndpoints(
            cov,
            idxFrom,
            idxTo,
            !ctx.is2D,
          );
          relativeCovariances.push(
            buildRelativeCovarianceRow(
              requested.from,
              requested.to,
              relativeCovariance,
              false,
              [],
              requested.rel,
              requested.ptol,
            ),
          );
        });

        return {
          stationCovariances,
          relativePrecision,
          relativeCovariances: sortRelativeCovariances(relativeCovariances),
        };
      };

      const industryStandardModel = buildPrecisionModel(1);
      const posteriorScaledModel = {
        stationCovariances: scaleStationCovarianceRows(
          industryStandardModel.stationCovariances,
          posteriorScaleSq,
        ),
        relativeCovariances: scaleRelativeCovarianceRows(
          industryStandardModel.relativeCovariances,
          posteriorScaleSq,
        ),
      };
      ctx.precisionModels = {
        'industry-standard': industryStandardModel,
        'posterior-scaled': posteriorScaledModel,
      };
      ctx.stationCovariances = industryStandardModel.stationCovariances;
      ctx.relativePrecision = industryStandardModel.relativePrecision;
      ctx.relativeCovariances = industryStandardModel.relativeCovariances;
      ctx.unknowns.forEach((id) => {
        const station = ctx.stations[id];
        if (!station) return;
        station.errorEllipse = undefined;
        station.sN = undefined;
        station.sE = undefined;
        station.sH = undefined;
      });
      industryStandardModel.stationCovariances?.forEach((row) => {
        const station = ctx.stations[row.stationId];
        if (!station) return;
        station.errorEllipse = row.ellipse;
        station.sE = row.sigmaE;
        station.sN = row.sigmaN;
        station.sH = row.sigmaH;
      });

      if (ctx.preanalysisMode) {
        ctx.weakGeometryDiagnostics = buildWeakGeometryDiagnostics(
          industryStandardModel.stationCovariances ?? [],
          industryStandardModel.relativeCovariances ?? [],
        );
        const flaggedStations = ctx.weakGeometryDiagnostics.stationCues.filter(
          (cue) => cue.severity !== 'ok',
        );
        const flaggedPairs = ctx.weakGeometryDiagnostics.relativeCues.filter(
          (cue) => cue.severity !== 'ok',
        );
        ctx.log(
          `Preanalysis covariance blocks: stations=${industryStandardModel.stationCovariances?.length ?? 0}, connectedPairs=${industryStandardModel.relativeCovariances?.length ?? 0}`,
        );
        ctx.log(
          `Preanalysis weak geometry cues: stations=${flaggedStations.length}, connectedPairs=${flaggedPairs.length}`,
        );
        flaggedStations.slice(0, 5).forEach((cue) => {
          ctx.log(`  station ${cue.stationId}: ${cue.severity.toUpperCase()} ${cue.note}`);
        });
        flaggedPairs.slice(0, 5).forEach((cue) => {
          ctx.log(`  pair ${cue.from}-${cue.to}: ${cue.severity.toUpperCase()} ${cue.note}`);
        });
      }
      ctx.solveTiming.precisionPropagationMs += Date.now() - precisionPropagationStartedAt;
    }

    const sideshots = ctx.computeSideshotResults();
    ctx.sideshots = sideshots;
    const sideshotCount = sideshots?.length ?? 0;
    if (sideshotCount > 0) {
      ctx.log(`Sideshots (post-adjust): ${sideshotCount}`);
    }

    const directionDiagnostics = buildDirectionDiagnostics(activeObservations, directionStats);
    ctx.directionSetDiagnostics = directionDiagnostics.directionSetDiagnostics;
    ctx.directionTargetDiagnostics = directionDiagnostics.directionTargetDiagnostics;
    ctx.directionRepeatabilityDiagnostics = directionDiagnostics.directionRepeatabilityDiagnostics;
    ctx.logs.push(...directionDiagnostics.logs);
    ctx.setupDiagnostics = buildSetupDiagnostics({
      activeObservations,
      directionSetDiagnostics: ctx.directionSetDiagnostics,
    });
    if (ctx.setupDiagnostics) {
      ctx.logs.push('Setup summary:');
      ctx.setupDiagnostics.forEach((s) => {
        ctx.logs.push(
          `  ${s.station}: dirSets=${s.directionSetCount}, dirObs=${s.directionObsCount}, ang=${s.angleObsCount}, dist=${s.distanceObsCount}, zen=${s.zenithObsCount}, lev=${s.levelingObsCount}, gps=${s.gpsObsCount}, travDist=${s.traverseDistance.toFixed(3)}m, orientRMS=${s.orientationRmsArcSec != null ? `${s.orientationRmsArcSec.toFixed(2)}"` : '-'}, orientSE=${s.orientationSeArcSec != null ? `${s.orientationSeArcSec.toFixed(2)}"` : '-'}, rms|t|=${s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}, max|t|=${s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}, localFail=${s.localFailCount}`,
        );
      });
    }

    if (closureResiduals.length) {
      ctx.logs.push(...closureResiduals);
      ctx.traverseDiagnostics = buildTraverseDiagnostics({
        closureVectors,
        loopVectors,
        loopAngleArcSec,
        loopVerticalMisclosure,
        totalTraverseDistance,
        thresholds: { ...ctx.traverseThresholds },
        setupDiagnostics: ctx.setupDiagnostics,
        hasClosureObs,
      });
      if (ctx.traverseDiagnostics && ctx.traverseDiagnostics.closureCount > 0) {
        const traverseDiagnostics = ctx.traverseDiagnostics;
        ctx.logs.push(
          `Traverse misclosure vector: dE=${traverseDiagnostics.misclosureE.toFixed(4)} m, dN=${traverseDiagnostics.misclosureN.toFixed(4)} m, Mag=${traverseDiagnostics.misclosureMag.toFixed(4)} m`,
        );
        if (totalTraverseDistance > 0) {
          ctx.logs.push(`Traverse distance sum: ${totalTraverseDistance.toFixed(4)} m`);
        }
        if (traverseDiagnostics.closureRatio != null) {
          ctx.logs.push(
            `Traverse closure ratio: 1:${traverseDiagnostics.closureRatio.toFixed(0)}`,
          );
        }
        if (traverseDiagnostics.linearPpm != null) {
          ctx.logs.push(
            `Traverse linear misclosure: ${traverseDiagnostics.linearPpm.toFixed(1)} ppm`,
          );
        }
        if (traverseDiagnostics.angularMisclosureArcSec != null) {
          ctx.logs.push(
            `Traverse angular misclosure: ${traverseDiagnostics.angularMisclosureArcSec.toFixed(2)}"`,
          );
        }
        if (traverseDiagnostics.verticalMisclosure != null) {
          ctx.logs.push(
            `Traverse vertical misclosure: ${traverseDiagnostics.verticalMisclosure.toFixed(4)} m`,
          );
        }
        const traverseLoops = traverseDiagnostics.loops ?? [];
        if (traverseLoops.length > 0) {
          ctx.logs.push('Traverse closure loop ranking (worst first):');
          traverseLoops.slice(0, 8).forEach((l) => {
            ctx.logs.push(
              `  ${l.key}: ratio=${l.closureRatio != null ? `1:${l.closureRatio.toFixed(0)}` : '-'}, ppm=${l.linearPpm != null ? l.linearPpm.toFixed(1) : '-'}, ang=${l.angularMisclosureArcSec != null ? `${l.angularMisclosureArcSec.toFixed(2)}"` : '-'}, dH=${l.verticalMisclosure != null ? `${l.verticalMisclosure.toFixed(4)}m` : '-'}, sev=${l.severity.toFixed(1)} ${l.pass ? 'PASS' : 'WARN'}`,
            );
          });
        }
      }
      Object.entries(loopVectors).forEach(([k, v]) => {
        const mag = Math.hypot(v.dE, v.dN);
        ctx.logs.push(
          `Closure loop ${k}: dE=${v.dE.toFixed(4)} m, dN=${v.dN.toFixed(4)} m, Mag=${mag.toFixed(4)} m`,
        );
      });
      if (coordClosureVectors.length) {
        coordClosureVectors.forEach((v) => {
          const mag = Math.hypot(v.dE, v.dN);
          ctx.logs.push(
            `Closure geometry ${v.from}-${v.to}: dE=${v.dE.toFixed(4)} m, dN=${v.dN.toFixed(4)} m, Mag=${mag.toFixed(4)} m`,
          );
        });
      }
    } else if (hasClosureObs) {
      ctx.traverseDiagnostics = buildTraverseDiagnostics({
        closureVectors,
        loopVectors,
        loopAngleArcSec,
        loopVerticalMisclosure,
        totalTraverseDistance,
        thresholds: { ...ctx.traverseThresholds },
        setupDiagnostics: ctx.setupDiagnostics,
        hasClosureObs,
      });
      ctx.logs.push('Traverse closure residual not computed (insufficient closure geometry).');
      if (totalTraverseDistance > 0) {
        ctx.logs.push(`Traverse distance sum: ${totalTraverseDistance.toFixed(4)} m`);
      }
    }
};

