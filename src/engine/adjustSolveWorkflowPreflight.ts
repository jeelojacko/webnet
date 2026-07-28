import { summarizeReductionUsage } from './reductionUsageSummary';
import type { AdjustmentSolveWorkflowContext } from './adjustSolveWorkflowSettings';
import type { Observation, RunModeCompatibilityDiagnostic } from '../types';

export const logSolveWorkflowAdjustmentOptions = (
  ctx: AdjustmentSolveWorkflowContext,
): void => {
  if (ctx.applyCurvatureRefraction && ctx.verticalReduction === 'curvref') {
    ctx.log(
      `Vertical reduction active: curvature/refraction (k=${ctx.refractionCoefficient.toFixed(
        3,
      )})`,
    );
  }
  if (ctx.tsCorrelationEnabled && ctx.tsCorrelationRho > 0) {
    ctx.log(
      `TS angular correlation active: scope=${ctx.tsCorrelationScope}, rho=${ctx.tsCorrelationRho.toFixed(3)}`,
    );
  }
  if (ctx.preanalysisMode) {
    ctx.log(
      'Preanalysis mode active: residual-based QC, chi-square, and robust reweighting are disabled.',
    );
  } else if (ctx.robustMode === 'huber') {
    ctx.robustDiagnostics = {
      enabled: true,
      mode: 'huber',
      k: Math.max(0.5, Math.min(10, ctx.robustK || 1.5)),
      iterations: [],
      topDownweightedRows: [],
    };
    ctx.log(
      `Robust reweighting active: mode=${ctx.robustMode}, k=${ctx.robustDiagnostics.k.toFixed(2)}`,
    );
  }
  logPrismCorrectionStatus(ctx);
};

export const prepareSolveWorkflowActiveObservations = (
  ctx: AdjustmentSolveWorkflowContext,
): Observation[] => {
  if (ctx.preanalysisMode) {
    ctx.populatePreanalysisObservations();
  }

  ctx.updateGpsAddHiHtDiagnostics();
  const activeObservations = ctx.collectActiveObservations() as Observation[];
  ctx.bootstrapApproximateTraverseCoords(activeObservations);
  ctx.captureRawTraverseDistanceFactorSnapshots(activeObservations);
  if (ctx.parseState) {
    ctx.parseState.usedInSolveUsageSummary = summarizeReductionUsage(activeObservations);
    ctx.parseState.parsedUsageSummary =
      ctx.parseState.parsedUsageSummary ?? summarizeReductionUsage(ctx.observations);
  }
  return activeObservations;
};

export const runLevelingOnlyBlunderDetectGate = (
  ctx: AdjustmentSolveWorkflowContext,
  activeObservations: Observation[],
): boolean => {
  if (
    ctx.runMode !== 'blunder-detect' ||
    activeObservations.length === 0 ||
    !activeObservations.every((obs: Observation) => obs.type === 'lev')
  ) {
    return false;
  }

  const levelingOnlyError: RunModeCompatibilityDiagnostic = {
    code: 'BLUNDER_LEVELING_ONLY',
    severity: 'error',
    message: 'Blunder Detect mode is not supported for leveling-only datasets.',
    action: 'Use adjustment or data-check mode for this dataset.',
  };
  ctx.runModeCompatibilityDiagnostics = [
    ...ctx.runModeCompatibilityDiagnostics,
    levelingOnlyError,
  ];
  if (ctx.parseState) {
    ctx.parseState.runModeCompatibilityDiagnostics = [...ctx.runModeCompatibilityDiagnostics];
  }
  ctx.emitRunModeCompatibilityDiagnostics(ctx.runModeCompatibilityDiagnostics);
  ctx.converged = false;
  return true;
};

export const runSolveWorkflowDatumGates = (
  ctx: AdjustmentSolveWorkflowContext,
  activeObservations: Observation[],
): boolean => {
  const gridInputGate = ctx.evaluateGridInputGate(activeObservations);
  if (gridInputGate.blocked) {
    ctx.addCoordSystemDiagnostic('CRS_INPUT_MIX_BLOCKED');
    if (gridInputGate.reasons.some((reason: string) => reason.toUpperCase().includes('UNKNOWN FRAME'))) {
      ctx.addCoordSystemDiagnostic('GNSS_FRAME_UNCONFIRMED');
    }
    gridInputGate.reasons.forEach((reason: string) => ctx.log(`Error: ${reason}`));
    gridInputGate.suggestions.forEach((suggestion: string) =>
      ctx.log(`Suggestion: ${suggestion}`),
    );
    ctx.datumSufficiencyReport = {
      status: 'hard-fail',
      reasons: [...gridInputGate.reasons],
      suggestions: [...gridInputGate.suggestions],
    };
    if (ctx.parseState) {
      ctx.parseState.datumSufficiencyReport = ctx.datumSufficiencyReport;
    }
    return true;
  }

  ctx.datumSufficiencyReport = ctx.evaluateDatumSufficiency(activeObservations);
  if (ctx.datumSufficiencyReport.status === 'hard-fail') {
    ctx.addCoordSystemDiagnostic('DATUM_HARD_FAIL');
    ctx.datumSufficiencyReport.reasons.forEach((reason: string) => ctx.log(`Error: ${reason}`));
    ctx.datumSufficiencyReport.suggestions.forEach((suggestion: string) =>
      ctx.log(`Suggestion: ${suggestion}`),
    );
    if (ctx.parseState) {
      ctx.parseState.datumSufficiencyReport = ctx.datumSufficiencyReport;
    }
    return true;
  }
  if (ctx.datumSufficiencyReport.status === 'soft-warn') {
    ctx.addCoordSystemDiagnostic('DATUM_SOFT_WARN');
    ctx.datumSufficiencyReport.reasons.forEach((reason: string) => ctx.log(`Warning: ${reason}`));
    ctx.datumSufficiencyReport.suggestions.forEach((suggestion: string) =>
      ctx.log(`Suggestion: ${suggestion}`),
    );
  }
  if (ctx.parseState) {
    ctx.parseState.datumSufficiencyReport = ctx.datumSufficiencyReport;
  }
  return false;
};

const logPrismCorrectionStatus = (ctx: AdjustmentSolveWorkflowContext): void => {
  let distCount = 0;
  let zenithCount = 0;
  ctx.observations.forEach((obs: Observation) => {
    const correction = ctx.prismCorrectionForObservation(obs);
    if (Math.abs(correction) <= 0) return;
    if (obs.type === 'dist') distCount += 1;
    if (obs.type === 'zenith') zenithCount += 1;
  });
  if (distCount > 0 || zenithCount > 0) {
    ctx.log(
      `Prism correction active: distRows=${distCount}, zenithRows=${zenithCount}, currentState=${ctx.prismEnabled ? `ON(${ctx.prismOffset.toFixed(4)}m,${ctx.prismScope})` : 'OFF'}`,
    );
  } else if (
    ctx.prismEnabled &&
    Number.isFinite(ctx.prismOffset) &&
    Math.abs(ctx.prismOffset) > 0
  ) {
    ctx.log(
      `Prism correction configured but no eligible rows: offset=${ctx.prismOffset.toFixed(4)}m, scope=${ctx.prismScope}`,
    );
  }
};
