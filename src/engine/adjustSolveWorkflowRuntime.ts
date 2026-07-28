import type { AdjustmentSolveWorkflowContext } from './adjustSolveWorkflowSettings';

export const resetSolveWorkflowRuntimeState = (
  ctx: AdjustmentSolveWorkflowContext,
): void => {
  ctx.is2D = ctx.coordMode === '2D';
  ctx.condition = undefined;
  ctx.controlConstraints = undefined;
  ctx.sideshots = undefined;
  ctx.autoSideshotDiagnostics = undefined;
  ctx.tsCorrelationDiagnostics = undefined;
  ctx.robustDiagnostics = undefined;
  ctx.residualDiagnostics = undefined;
  ctx.clusterDiagnostics = undefined;
  ctx.gpsLoopDiagnostics = undefined;
  ctx.levelingLoopDiagnostics = undefined;
  ctx.chiSquare = undefined;
  ctx.statisticalSummary = undefined;
  ctx.typeSummary = undefined;
  ctx.relativePrecision = undefined;
  ctx.stationCovariances = undefined;
  ctx.relativeCovariances = undefined;
  ctx.precisionModels = undefined;
  ctx.weakGeometryDiagnostics = undefined;
  ctx.conditionWarned = false;
  ctx.initialSigmaGeometryStations = {};
  ctx.initialSigmaAzimuthCache.clear();
  ctx.initialSigmaZenithCache.clear();
  ctx.clearCoordSystemDiagnostics();
  ctx.clearGeometryCache();
  if (ctx.coordSystemMode !== 'grid') {
    ctx.setCrsOff('disabledByProfile');
  } else if (!ctx.crsId || !ctx.crsId.trim()) {
    ctx.setCrsOff('noCRSSelected', 'Grid coordinate mode is active but CRS id is missing.');
  } else {
    ctx.setCrsOff('noInverseAvailable');
  }
};
