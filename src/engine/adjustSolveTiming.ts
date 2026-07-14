import type { AdjustmentResult } from '../types';
import type { SolveProgressEvent } from './scenarioRunModels';

export type SolveTimingBuckets = {
  parseAndSetupMs: number;
  equationAssemblyMs: number;
  matrixFactorizationMs: number;
  precisionAndDiagnosticsMs: number;
  precisionPropagationMs: number;
  resultPackagingMs: number;
};

export const createEmptySolveTiming = (): SolveTimingBuckets => ({
  parseAndSetupMs: 0,
  equationAssemblyMs: 0,
  matrixFactorizationMs: 0,
  precisionAndDiagnosticsMs: 0,
  precisionPropagationMs: 0,
  resultPackagingMs: 0,
});

export const buildSolveProgressEvent = ({
  converged,
  iterations,
  maxIterations,
  phase,
  solveStartedAt,
}: {
  converged: boolean;
  iterations: number;
  maxIterations: number;
  phase: SolveProgressEvent['phase'];
  solveStartedAt: number;
}): SolveProgressEvent => ({
  phase,
  iteration: iterations,
  maxIterations,
  elapsedMs: Math.max(0, Date.now() - solveStartedAt),
  converged,
});

export const buildSolveTimingProfile = ({
  solveStartedAt,
  solveTiming,
}: {
  solveStartedAt: number;
  solveTiming: SolveTimingBuckets;
}): NonNullable<AdjustmentResult['solveTimingProfile']> => {
  const totalMs = Math.max(0, Date.now() - solveStartedAt);
  const reportDiagnosticsMs = Math.max(
    0,
    solveTiming.precisionAndDiagnosticsMs - solveTiming.precisionPropagationMs,
  );
  const classifiedMs =
    solveTiming.parseAndSetupMs +
    solveTiming.equationAssemblyMs +
    solveTiming.matrixFactorizationMs +
    solveTiming.precisionAndDiagnosticsMs +
    solveTiming.resultPackagingMs;
  return {
    totalMs,
    parseAndSetupMs: solveTiming.parseAndSetupMs,
    equationAssemblyMs: solveTiming.equationAssemblyMs,
    matrixFactorizationMs: solveTiming.matrixFactorizationMs,
    precisionAndDiagnosticsMs: solveTiming.precisionAndDiagnosticsMs,
    precisionPropagationMs: solveTiming.precisionPropagationMs,
    reportDiagnosticsMs,
    resultPackagingMs: solveTiming.resultPackagingMs,
    otherMs: Math.max(0, totalMs - classifiedMs),
  };
};

export const formatSolveTimingLogLine = (
  profile: NonNullable<AdjustmentResult['solveTimingProfile']>,
): string =>
  `Solve timing (ms): total=${profile.totalMs.toFixed(1)}, setup=${profile.parseAndSetupMs.toFixed(1)}, assembly=${profile.equationAssemblyMs.toFixed(1)}, factor=${profile.matrixFactorizationMs.toFixed(1)}, precision+diag=${profile.precisionAndDiagnosticsMs.toFixed(1)}, precision=${profile.precisionPropagationMs.toFixed(1)}, report=${profile.reportDiagnosticsMs.toFixed(1)}, packaging=${profile.resultPackagingMs.toFixed(1)}, other=${profile.otherMs.toFixed(1)}`;
