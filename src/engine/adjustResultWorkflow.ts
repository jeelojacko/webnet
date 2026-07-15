import { buildAdjustmentResultPayload, finalizeResultParseState } from './adjustmentResultBuilder';
import { buildAutoSideshotDiagnostics, buildClusterDiagnostics } from './adjustmentReviewDiagnostics';
import { summarizeReductionUsage } from './reductionUsageSummary';
import type { AdjustmentResult } from '../types';

export type AdjustmentResultWorkflowContext = Record<string, any>;

export const buildAdjustmentResultFromContext = (
  ctx: AdjustmentResultWorkflowContext,
): AdjustmentResult => {    const resultPackagingStartedAt = Date.now();
    ctx.projectWeakFloatZenithLeafStationsForDisplay();
    if (!ctx.sideshots) {
      ctx.sideshots = ctx.computeSideshotResults();
    }
    if (ctx.coordSystemMode === 'grid') {
      Object.keys(ctx.stations).forEach((id) => {
        ctx.stationFactorSnapshot(id);
      });
    }
    ctx.captureRawTraverseDirectionCorrections(ctx.collectActiveObservations());
    ctx.parseState = finalizeResultParseState({
      parseState: ctx.parseState,
      coordSystemMode: ctx.coordSystemMode,
      coordSystemDiagnostics: ctx.coordSystemDiagnostics.values(),
      coordSystemWarningMessages: ctx.coordSystemWarningMessages,
      crsStatus: ctx.crsStatus,
      crsOffReason: ctx.crsOffReason,
      crsDatumOpId: ctx.crsDatumOpId,
      crsDatumFallbackUsed: ctx.crsDatumFallbackUsed,
      crsAreaOfUseStatus: ctx.crsAreaOfUseStatus,
      crsOutOfAreaStationCount: ctx.crsOutOfAreaStationCount,
      scaleOverrideActive: ctx.scaleOverrideActive,
      gnssFrameConfirmed: ctx.gnssFrameConfirmed,
      datumSufficiencyReport: ctx.datumSufficiencyReport,
      parsedUsageSummary: summarizeReductionUsage(ctx.observations),
      usedInSolveUsageSummary: summarizeReductionUsage(ctx.collectActiveObservations()),
    });
    const includeErrorCount = ctx.parseState?.includeErrors?.length ?? 0;
    const runMode = ctx.runMode;
    const autoSideshotEnabled =
      ctx.parseState?.autoSideshotEnabled ?? ctx.parseOptions?.autoSideshotEnabled ?? true;
    if (runMode === 'data-check') {
      ctx.autoSideshotDiagnostics = undefined;
      ctx.clusterDiagnostics = undefined;
      ctx.logs.push('Data Check Only: auto-sideshot and cluster diagnostics are skipped.');
    } else if (ctx.preanalysisMode) {
      ctx.autoSideshotDiagnostics = undefined;
      ctx.logs.push('Auto-sideshot detection (M-lines): disabled in preanalysis mode');
    } else if (autoSideshotEnabled) {
      if (!ctx.autoSideshotDiagnostics) {
        ctx.autoSideshotDiagnostics = buildAutoSideshotDiagnostics({
          observations: ctx.observations,
          stations: ctx.stations,
          redundancyScalar: (obs) => ctx.redundancyScalar(obs),
          threshold: 0.1,
        });
        ctx.logs.push(
          `Auto-sideshot detection (M-lines): evaluated=${ctx.autoSideshotDiagnostics.evaluatedCount}, candidates=${ctx.autoSideshotDiagnostics.candidateCount}, excluded-control=${ctx.autoSideshotDiagnostics.excludedControlCount}, threshold=${ctx.autoSideshotDiagnostics.threshold.toFixed(2)}`,
        );
        ctx.autoSideshotDiagnostics.candidates.slice(0, 10).forEach((c: any) => {
          ctx.logs.push(
            `  line ${c.sourceLine ?? '-'} ${c.occupy}->${c.target} (bs=${c.backsight}) minRed=${c.minRedundancy.toFixed(3)} max|t|=${c.maxAbsStdRes.toFixed(2)}`,
          );
        });
      }
    } else {
      ctx.autoSideshotDiagnostics = undefined;
      ctx.logs.push('Auto-sideshot detection (M-lines): disabled');
    }
    if (runMode !== 'data-check' && !ctx.clusterDiagnostics) {
      const dimension: '2D' | '3D' = ctx.is2D ? '2D' : '3D';
      ctx.clusterDiagnostics = buildClusterDiagnostics({
        stations: ctx.stations,
        unknowns: ctx.unknowns,
        enabled: ctx.clusterDetectionEnabled,
        linkageMode: ctx.clusterLinkageMode ?? 'single',
        dimension,
        tolerance: Math.max(
          1e-9,
          dimension === '2D' ? ctx.clusterTolerance2D : ctx.clusterTolerance3D,
        ),
        passMode:
          (ctx.parseOptions?.clusterDualPassRan ?? false) ||
          ctx.parseOptions?.clusterPassLabel === 'pass2'
            ? 'dual-pass'
            : 'single-pass',
      });
      if (ctx.clusterDiagnostics.enabled) {
        ctx.logs.push(
          `Cluster detection: pass=${ctx.clusterDiagnostics.passMode}, mode=${ctx.clusterDiagnostics.linkageMode}, dim=${ctx.clusterDiagnostics.dimension}, tol=${ctx.clusterDiagnostics.tolerance.toFixed(4)}m, pairHits=${ctx.clusterDiagnostics.pairCount}, candidates=${ctx.clusterDiagnostics.candidateCount}`,
        );
        if ((ctx.clusterDiagnostics.approvedMergeCount ?? 0) > 0) {
          ctx.logs.push(
            `  Approved merges applied: ${ctx.clusterDiagnostics.approvedMergeCount} (pass1 candidates=${ctx.clusterDiagnostics.pass1CandidateCount ?? 0})`,
          );
        }
        ctx.clusterDiagnostics.candidates.slice(0, 10).forEach((c: any) => {
          ctx.logs.push(
            `  ${c.key}: rep=${c.representativeId}, members=${c.stationIds.join(',')}, maxSep=${c.maxSeparation.toFixed(4)}m, meanSep=${c.meanSeparation.toFixed(4)}m`,
          );
        });
      }
    }
    const success = includeErrorCount === 0 && (runMode === 'data-check' ? true : ctx.converged);
    const result = buildAdjustmentResultPayload({
      success,
      converged: ctx.converged,
      iterations: ctx.iterations,
      stations: ctx.stations,
      observations: ctx.observations,
      logs: ctx.logs,
      seuw: ctx.seuw,
      dof: ctx.dof,
      preanalysisMode: ctx.preanalysisMode,
      parseState: ctx.parseState,
      condition: ctx.condition,
      controlConstraints: ctx.controlConstraints,
      stationCovariances: ctx.stationCovariances,
      relativeCovariances: ctx.relativeCovariances,
      precisionModels: ctx.precisionModels,
      weakGeometryDiagnostics: ctx.weakGeometryDiagnostics,
      chiSquare: ctx.chiSquare,
      statisticalSummary: ctx.statisticalSummary,
      typeSummary: ctx.typeSummary,
      relativePrecision: ctx.relativePrecision,
      directionSetDiagnostics: ctx.directionSetDiagnostics,
      directionTargetDiagnostics: ctx.directionTargetDiagnostics,
      directionRepeatabilityDiagnostics: ctx.directionRepeatabilityDiagnostics,
      setupDiagnostics: ctx.setupDiagnostics,
      tsCorrelationDiagnostics: ctx.tsCorrelationDiagnostics,
      robustDiagnostics: ctx.robustDiagnostics,
      residualDiagnostics: ctx.residualDiagnostics,
      traverseDiagnostics: ctx.traverseDiagnostics,
      sideshots: ctx.sideshots,
      gpsLoopDiagnostics: ctx.gpsLoopDiagnostics,
      levelingLoopDiagnostics: ctx.levelingLoopDiagnostics,
      autoSideshotDiagnostics: ctx.autoSideshotDiagnostics,
      clusterDiagnostics: ctx.clusterDiagnostics,
      directionRejectDiagnostics: ctx.directionRejectDiagnostics,
    });
    ctx.solveTiming.resultPackagingMs += Date.now() - resultPackagingStartedAt;
    const solveTimingProfile = ctx.buildSolveTimingProfile();
    result.solveTimingProfile = solveTimingProfile;
    ctx.logSolveTimingProfile(solveTimingProfile);
    return result;
};

