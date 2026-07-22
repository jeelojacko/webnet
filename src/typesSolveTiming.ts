export interface AdjustmentSolveTimingProfile {
  totalMs: number;
  parseAndSetupMs: number;
  equationAssemblyMs: number;
  matrixFactorizationMs: number;
  precisionAndDiagnosticsMs: number;
  precisionPropagationMs: number;
  reportDiagnosticsMs: number;
  resultPackagingMs: number;
  otherMs: number;
}
