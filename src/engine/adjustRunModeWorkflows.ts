import { formatAutoAdjustLogLines, runAutoAdjustCycles, type AutoAdjustConfig } from './autoAdjust';
import { runModeCompatibilityDiagnosticLines } from './adjustmentRunModeCompatibility';
import type { AdjustmentResult, ObservationOverride, ParseOptions, RunModeCompatibilityDiagnostic } from '../types';

type AdjustmentRunModeWorkflowContext = {
  parseOptions?: Partial<ParseOptions>;
  overrides?: Record<number, ObservationOverride>;
  excludeIds?: Set<number>;
  converged: boolean;
  runMode: ParseOptions['runMode'];
  runModeCompatibilityDiagnostics: RunModeCompatibilityDiagnostic[];
  parseState?: ParseOptions;
  emitRunModeCompatibilityDiagnostics: (_diagnostics: RunModeCompatibilityDiagnostic[]) => void;
  log: (_message: string) => void;
  buildResult: () => AdjustmentResult;
  solveNestedScenario: (
    _parseOptions: Partial<ParseOptions>,
    _overrides: Record<number, ObservationOverride> | undefined,
    _excludeIds?: Set<number>,
  ) => AdjustmentResult;
};

export const runBlunderDetectWorkflow = (
  ctx: AdjustmentRunModeWorkflowContext,
  runModeDiagnostics: RunModeCompatibilityDiagnostic[],
): AdjustmentResult => {    const baseOptions: Partial<ParseOptions> = {
      ...(ctx.parseOptions ?? {}),
      runMode: 'adjustment',
      preanalysisMode: false,
      robustMode: 'none',
      autoAdjustEnabled: false,
      clusterPassLabel: ctx.parseOptions?.clusterPassLabel ?? 'single',
    };
    let workingOverrides = { ...(ctx.overrides ?? {}) };
    const cycleLogs: string[] = [];
    const maxCycles = 3;
    const threshold = 3;
    let finalResult: AdjustmentResult | null = null;

    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      const solved = ctx.solveNestedScenario(baseOptions, workingOverrides);
      finalResult = solved;
      const ranked = [...solved.observations]
        .filter((obs) => Number.isFinite(obs.stdRes))
        .sort((a, b) => Math.abs(b.stdRes ?? 0) - Math.abs(a.stdRes ?? 0));
      const top = ranked[0];
      if (!top || Math.abs(top.stdRes ?? 0) < threshold) {
        cycleLogs.push(
          `Blunder cycle ${cycle}: stop (max |t| ${Math.abs(top?.stdRes ?? 0).toFixed(3)} < ${threshold.toFixed(3)}).`,
        );
        break;
      }
      workingOverrides[top.id] = {
        ...(workingOverrides[top.id] ?? {}),
        stdDev: Math.max((top.stdDev ?? 1) * 4, 1e-9),
      };
      cycleLogs.push(
        `Blunder cycle ${cycle}: deweight obs ${top.id} (${top.type}, line=${top.sourceLine ?? '-'}) |t|=${Math.abs(top.stdRes ?? 0).toFixed(3)} newSigma=${workingOverrides[top.id].stdDev?.toExponential(6)}.`,
      );
    }

    if (!finalResult) {
      ctx.converged = false;
      ctx.runMode = 'blunder-detect';
      ctx.runModeCompatibilityDiagnostics = [...runModeDiagnostics];
      if (ctx.parseState) {
        ctx.parseState.runMode = 'blunder-detect';
        ctx.parseState.runModeCompatibilityDiagnostics = [...runModeDiagnostics];
      }
      ctx.emitRunModeCompatibilityDiagnostics(runModeDiagnostics);
      ctx.log('Error: blunder-detect workflow could not produce a solve result.');
      return ctx.buildResult();
    }
    const mergedParseState = finalResult.parseState
      ? ({
          ...finalResult.parseState,
          runMode: 'blunder-detect' as const,
          runModeCompatibilityDiagnostics: [...runModeDiagnostics],
        } as ParseOptions)
      : undefined;
    const runModeCompatibilityLines = runModeCompatibilityDiagnosticLines(runModeDiagnostics);
    return {
      ...finalResult,
      parseState: mergedParseState,
      logs: [
        ...runModeCompatibilityLines,
        'Blunder Detect mode: iterative deweighting diagnostics (not a replacement for full adjustment QA).',
        ...cycleLogs,
        ...finalResult.logs,
      ],
    };
};

export const runAutoAdjustWorkflow = (ctx: AdjustmentRunModeWorkflowContext): AdjustmentResult => {
    const requestedConfig: AutoAdjustConfig = {
      enabled: ctx.parseOptions?.autoAdjustEnabled === true,
      maxCycles: ctx.parseOptions?.autoAdjustMaxCycles ?? 3,
      maxRemovalsPerCycle: ctx.parseOptions?.autoAdjustMaxRemovalsPerCycle ?? 1,
      stdResThreshold: ctx.parseOptions?.autoAdjustStdResThreshold ?? 4,
      minRedundancy: 0.05,
    };
    const baseOptions: Partial<ParseOptions> = {
      ...(ctx.parseOptions ?? {}),
      autoAdjustEnabled: false,
    };
    const initialExcludedIds = new Set(ctx.excludeIds ?? []);
    const summary = runAutoAdjustCycles(initialExcludedIds, requestedConfig, (trialExclusions) =>
      ctx.solveNestedScenario(baseOptions, ctx.overrides, trialExclusions),
    );
    const finalResult = ctx.solveNestedScenario(
      baseOptions,
      ctx.overrides,
      summary.finalExcludedIds,
    );
    const mergedParseState = finalResult.parseState
      ? ({
          ...finalResult.parseState,
          autoAdjustEnabled: requestedConfig.enabled,
          autoAdjustMaxCycles: summary.config.maxCycles,
          autoAdjustMaxRemovalsPerCycle: summary.config.maxRemovalsPerCycle,
          autoAdjustStdResThreshold: summary.config.stdResThreshold,
        } as ParseOptions)
      : undefined;
    const autoAdjustDiagnostics = {
      enabled: true,
      threshold: summary.config.stdResThreshold,
      maxCycles: summary.config.maxCycles,
      maxRemovalsPerCycle: summary.config.maxRemovalsPerCycle,
      minRedundancy: summary.config.minRedundancy ?? 0.05,
      stopReason: summary.stopReason,
      cycles: summary.cycles.map((cycle) => ({
        cycle: cycle.cycle,
        seuw: cycle.seuw,
        maxAbsStdRes: cycle.maxAbsStdRes,
        removals: [...cycle.removals],
      })),
      removed: summary.cycles.flatMap((cycle) => cycle.removals),
    };
    return {
      ...finalResult,
      parseState: mergedParseState,
      autoAdjustDiagnostics,
      logs: [...formatAutoAdjustLogLines(summary), ...finalResult.logs],
    };
};

