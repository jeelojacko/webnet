import type { ParseOptions, RunMode, RunModeCompatibilityDiagnostic } from '../types';

export type RunModeCompatibilityOptions = {
  effectiveOptions: Partial<ParseOptions>;
  diagnostics: RunModeCompatibilityDiagnostic[];
};

export const resolveRunModeCompatibilityOptions = (
  requestedRunMode: RunMode,
  options: Partial<ParseOptions>,
): RunModeCompatibilityOptions => {
  const effectiveOptions: Partial<ParseOptions> = { ...(options ?? {}) };
  const diagnostics: RunModeCompatibilityDiagnostic[] = [];
  const warn = (code: string, message: string, action?: string): void => {
    diagnostics.push({ code, severity: 'warning', message, action });
  };

  const hasClusterMerges = (effectiveOptions.clusterApprovedMerges?.length ?? 0) > 0;
  const robustRequested = (effectiveOptions.robustMode ?? 'none') !== 'none';
  const autoAdjustRequested = effectiveOptions.autoAdjustEnabled === true;
  const autoSideshotRequested = effectiveOptions.autoSideshotEnabled !== false;
  const clusterRequested = effectiveOptions.clusterDetectionEnabled !== false;

  if (requestedRunMode === 'adjustment') {
    if (effectiveOptions.preanalysisMode === true) {
      warn(
        'ADJUSTMENT_IGNORES_PREANALYSIS_FLAG',
        'preanalysisMode=true is ignored when runMode=adjustment.',
        'Using preanalysisMode=false for this run.',
      );
    }
    effectiveOptions.preanalysisMode = false;
  }

  if (requestedRunMode === 'preanalysis') {
    effectiveOptions.preanalysisMode = true;
    if (autoAdjustRequested) {
      warn(
        'PREANALYSIS_DISALLOWS_AUTOADJUST',
        'Auto-adjust is not available in preanalysis mode.',
        'Disabling auto-adjust for this run.',
      );
      effectiveOptions.autoAdjustEnabled = false;
    }
    if (robustRequested) {
      warn(
        'PREANALYSIS_DISALLOWS_ROBUST',
        'Robust reweighting is not available in preanalysis mode.',
        'Using robustMode=none for this run.',
      );
      effectiveOptions.robustMode = 'none';
    }
    if (autoSideshotRequested) {
      warn(
        'PREANALYSIS_SKIPS_AUTOSIDESHOT',
        'Auto-sideshot detection is skipped in preanalysis mode.',
        'Disabling auto-sideshot diagnostics for this run.',
      );
      effectiveOptions.autoSideshotEnabled = false;
    }
    if (clusterRequested) {
      warn(
        'PREANALYSIS_SKIPS_CLUSTER',
        'Cluster detection is skipped in preanalysis mode.',
        'Disabling cluster detection for this run.',
      );
      effectiveOptions.clusterDetectionEnabled = false;
    }
    if (hasClusterMerges) {
      warn(
        'PREANALYSIS_DISALLOWS_CLUSTER_MERGES',
        'Approved cluster merges are not applied in preanalysis mode.',
        'Ignoring approved cluster merges for this run.',
      );
      effectiveOptions.clusterApprovedMerges = [];
      effectiveOptions.clusterApprovedMergeCount = 0;
      effectiveOptions.clusterDualPassRan = false;
    }
  }

  if (requestedRunMode === 'data-check') {
    effectiveOptions.preanalysisMode = false;
    if (autoAdjustRequested) {
      warn(
        'DATACHECK_DISALLOWS_AUTOADJUST',
        'Auto-adjust is not available in Data Check Only mode.',
        'Disabling auto-adjust for this run.',
      );
      effectiveOptions.autoAdjustEnabled = false;
    }
    if (robustRequested) {
      warn(
        'DATACHECK_DISALLOWS_ROBUST',
        'Robust reweighting is not available in Data Check Only mode.',
        'Using robustMode=none for this run.',
      );
      effectiveOptions.robustMode = 'none';
    }
    if (autoSideshotRequested) {
      warn(
        'DATACHECK_SKIPS_AUTOSIDESHOT',
        'Auto-sideshot detection is skipped in Data Check Only mode.',
        'Disabling auto-sideshot diagnostics for this run.',
      );
      effectiveOptions.autoSideshotEnabled = false;
    }
    if (clusterRequested) {
      warn(
        'DATACHECK_SKIPS_CLUSTER',
        'Cluster detection is skipped in Data Check Only mode.',
        'Disabling cluster detection for this run.',
      );
      effectiveOptions.clusterDetectionEnabled = false;
    }
    if (hasClusterMerges) {
      warn(
        'DATACHECK_DISALLOWS_CLUSTER_MERGES',
        'Approved cluster merges are not applied in Data Check Only mode.',
        'Ignoring approved cluster merges for this run.',
      );
      effectiveOptions.clusterApprovedMerges = [];
      effectiveOptions.clusterApprovedMergeCount = 0;
      effectiveOptions.clusterDualPassRan = false;
    }
  }

  if (requestedRunMode === 'blunder-detect') {
    effectiveOptions.preanalysisMode = false;
    if (autoAdjustRequested) {
      warn(
        'BLUNDER_DISALLOWS_AUTOADJUST',
        'Auto-adjust is not available in Blunder Detect mode.',
        'Disabling auto-adjust for this run.',
      );
      effectiveOptions.autoAdjustEnabled = false;
    }
    if (robustRequested) {
      warn(
        'BLUNDER_DISALLOWS_ROBUST',
        'Robust reweighting is not available in Blunder Detect mode.',
        'Using robustMode=none for this run.',
      );
      effectiveOptions.robustMode = 'none';
    }
    if (autoSideshotRequested) {
      warn(
        'BLUNDER_SKIPS_AUTOSIDESHOT',
        'Auto-sideshot detection is skipped in Blunder Detect mode.',
        'Disabling auto-sideshot diagnostics for this run.',
      );
      effectiveOptions.autoSideshotEnabled = false;
    }
    if (clusterRequested) {
      warn(
        'BLUNDER_SKIPS_CLUSTER',
        'Cluster detection is skipped in Blunder Detect mode.',
        'Disabling cluster detection for this run.',
      );
      effectiveOptions.clusterDetectionEnabled = false;
    }
    if (hasClusterMerges) {
      warn(
        'BLUNDER_DISALLOWS_CLUSTER_MERGES',
        'Approved cluster merges are not applied in Blunder Detect mode.',
        'Ignoring approved cluster merges for this run.',
      );
      effectiveOptions.clusterApprovedMerges = [];
      effectiveOptions.clusterApprovedMergeCount = 0;
      effectiveOptions.clusterDualPassRan = false;
    }
    if (effectiveOptions.clusterPassLabel && effectiveOptions.clusterPassLabel !== 'single') {
      warn(
        'BLUNDER_RESETS_CLUSTER_PASS_LABEL',
        `Cluster pass label ${effectiveOptions.clusterPassLabel} is not used in Blunder Detect mode.`,
        'Using clusterPassLabel=single for this run.',
      );
    }
    effectiveOptions.clusterPassLabel = 'single';
  }

  effectiveOptions.runMode = requestedRunMode;
  if (requestedRunMode !== 'preanalysis') {
    effectiveOptions.preanalysisMode = false;
  }
  return { effectiveOptions, diagnostics };
};

export const runModeCompatibilityDiagnosticLines = (
  diagnostics: RunModeCompatibilityDiagnostic[],
): string[] =>
  diagnostics.map((diag) => {
    const head =
      diag.severity === 'error'
        ? `Error: Run-mode compatibility [${diag.code}] ${diag.message}`
        : `Warning: Run-mode compatibility [${diag.code}] ${diag.message}`;
    return diag.action ? `${head} Action: ${diag.action}` : head;
  });
