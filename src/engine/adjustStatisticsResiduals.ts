import { RAD_TO_DEG } from './angles';
import { buildCoordinateConstraints, coordinateConstraintWeightedSum } from './adjustmentConstraints';
import type { DirectionSetStat } from './adjustmentDirectionDiagnostics';
import { buildTsCorrelationDiagnostics, type TsCorrelationResidualGroups } from './adjustmentTsCorrelationDiagnostics';
import { getObservationSetId } from './observationMetadata';
import type { AdjustmentStatisticsContext } from './adjustStatisticsTypes';
import type { Observation, StationId } from '../types';
type StationParamIndex = Record<StationId, { x?: number; y?: number; h?: number }>;
type ClosureVector = { from: StationId; to: StationId; dE: number; dN: number };
type WeightedGroupStats = { count: number; sumSquares: number };
export type AdjustmentResidualAccumulation = {
  vtpv: number;
  closureResiduals: string[];
  closureVectors: ClosureVector[];
  loopVectors: Record<string, { dE: number; dN: number }>;
  loopAngleArcSec: Map<string, number>;
  loopVerticalMisclosure: Map<string, number>;
  hasClosureObs: boolean;
  coordClosureVectors: ClosureVector[];
  totalTraverseDistance: number;
  directionStats: Map<string, DirectionSetStat>;
  activeObservations: Observation[];
  constraints: ReturnType<typeof buildCoordinateConstraints>;
  weightedByGroup: Map<string, WeightedGroupStats>;
  groupOrder: string[];
};
export const accumulateAdjustmentResiduals = (
  ctx: AdjustmentStatisticsContext,
  paramIndex: StationParamIndex,
  activeObservationsInput?: Observation[],
): AdjustmentResidualAccumulation => {
  let vtpv = 0;
  const closureResiduals: string[] = [];
  const closureVectors: ClosureVector[] = [];
  const loopVectors: Record<string, { dE: number; dN: number }> = {};
  const loopAngleArcSec = new Map<string, number>();
  const loopVerticalMisclosure = new Map<string, number>();
  const hasClosureObs = ctx.observations.some(
    (o) => String(getObservationSetId(o) ?? '').toUpperCase() === 'TE',
  );
  const coordClosureVectors: ClosureVector[] = [];
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


  return {
    vtpv,
    closureResiduals,
    closureVectors,
    loopVectors,
    loopAngleArcSec,
    loopVerticalMisclosure,
    hasClosureObs,
    coordClosureVectors,
    totalTraverseDistance,
    directionStats,
    activeObservations,
    constraints,
    weightedByGroup,
    groupOrder,
  };
};
