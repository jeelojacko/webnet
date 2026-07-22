import { buildChiSquareSummary } from './adjustmentStatisticalMath';
import { buildDirectionDiagnostics } from './adjustmentDirectionDiagnostics';
import { buildSetupDiagnostics, buildTraverseDiagnostics } from './adjustmentSetupTraverseDiagnostics';
import { buildObservationTypeSummary, buildResidualDiagnostics, buildStatisticalSummary } from './adjustmentStatisticsBuilders';
import { propagateAdjustmentPrecision } from './adjustStatisticsPrecision';
import { accumulateAdjustmentResiduals } from './adjustStatisticsResiduals';
import { computeStandardizedResidualStatistics } from './adjustStatisticsStandardizedResiduals';
import type { AdjustmentStatisticsContext } from './adjustStatisticsTypes';
import type { Observation, StationId } from '../types';

export type { AdjustmentStatisticsContext } from './adjustStatisticsTypes';

export const calculateAdjustmentStatistics = (
  ctx: AdjustmentStatisticsContext,
  paramIndex: Record<StationId, { x?: number; y?: number; h?: number }>,
  hasQxx: boolean,
  activeObservationsInput?: Observation[],
): void => {
    ctx.clearGeometryCache();
    const {
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
    } = accumulateAdjustmentResiduals(ctx, paramIndex, activeObservationsInput);
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

    computeStandardizedResidualStatistics(ctx, paramIndex, hasQxx, activeObservations, constraints);

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
      propagateAdjustmentPrecision(ctx, paramIndex, activeObservations);
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
