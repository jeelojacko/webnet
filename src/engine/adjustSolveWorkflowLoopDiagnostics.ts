import {
  EPS,
  GPS_LOOP_BASE_TOLERANCE_M,
  GPS_LOOP_TOLERANCE_PPM,
} from './adjustConstants';
import { buildGpsLoopDiagnostics, buildLevelingLoopDiagnostics } from './adjustmentLoopDiagnostics';
import type { AdjustmentSolveWorkflowContext } from './adjustSolveWorkflowSettings';
import type { GpsObservation, LevelObservation, Observation } from '../types';

export const runSolveWorkflowLoopDiagnostics = (
  ctx: AdjustmentSolveWorkflowContext,
  activeObservations: Observation[],
  gpsLoopCheckEnabled: boolean,
): void => {
  if (gpsLoopCheckEnabled) {
    const gpsNetworkRows = activeObservations.filter(
      (obs: Observation): obs is GpsObservation =>
        obs.type === 'gps' && obs.gpsMode !== 'sideshot',
    );
    ctx.gpsLoopDiagnostics = buildGpsLoopDiagnostics({
      gpsObservations: gpsNetworkRows,
      observedVector: (obs: GpsObservation) => ctx.gpsObservedVector(obs),
      baseToleranceM: GPS_LOOP_BASE_TOLERANCE_M,
      ppmTolerance: GPS_LOOP_TOLERANCE_PPM,
      eps: EPS,
    });
    ctx.log(
      `GPS loop check: vectors=${ctx.gpsLoopDiagnostics.vectorCount}, loops=${ctx.gpsLoopDiagnostics.loopCount}, pass=${ctx.gpsLoopDiagnostics.passCount}, warn=${ctx.gpsLoopDiagnostics.warnCount}, tolerance=${ctx.gpsLoopDiagnostics.thresholds.baseToleranceM.toFixed(3)}m+${ctx.gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist`,
    );
    ctx.gpsLoopDiagnostics.loops.slice(0, 10).forEach((loop: any) => {
      ctx.log(
        `  #${loop.rank} ${loop.key}: path=${loop.stationPath.join('->')} closure(dE=${loop.closureE.toFixed(4)}m,dN=${loop.closureN.toFixed(4)}m,|d|=${loop.closureMag.toFixed(4)}m) tol=${loop.toleranceM.toFixed(4)}m ppm=${loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-'} sev=${loop.severity.toFixed(2)} status=${loop.pass ? 'PASS' : 'WARN'} lines=${loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}`,
      );
    });
  }
  const levelingRows = activeObservations.filter(
    (obs: Observation): obs is LevelObservation => obs.type === 'lev',
  );
  if (levelingRows.length > 0) {
    ctx.levelingLoopDiagnostics = buildLevelingLoopDiagnostics({
      levelingObservations: levelingRows,
      baseMm: ctx.levelLoopToleranceBaseMm,
      perSqrtKmMm: ctx.levelLoopTolerancePerSqrtKmMm,
      eps: EPS,
    });
    ctx.log(
      `Leveling loop check: observations=${ctx.levelingLoopDiagnostics.observationCount}, loops=${ctx.levelingLoopDiagnostics.loopCount}, totalLength=${ctx.levelingLoopDiagnostics.totalLengthKm.toFixed(3)}km, tolerance=${ctx.levelingLoopDiagnostics.thresholds.baseMm.toFixed(3)}mm+${ctx.levelingLoopDiagnostics.thresholds.perSqrtKmMm.toFixed(3)}mm*sqrt(km)`,
    );
    ctx.levelingLoopDiagnostics.loops.slice(0, 10).forEach((loop: any) => {
      ctx.log(
        `  #${loop.rank} ${loop.key}: path=${loop.stationPath.join('->')} closure=${loop.closure.toFixed(4)}m |closure|=${loop.absClosure.toFixed(4)}m len=${loop.loopLengthKm.toFixed(3)}km tol=${loop.toleranceMm.toFixed(2)}mm mm/sqrt(km)=${loop.closurePerSqrtKmMm.toFixed(2)} status=${loop.pass ? 'PASS' : 'WARN'} lines=${loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}`,
      );
    });
    ctx.levelingLoopDiagnostics.suspectSegments.slice(0, 5).forEach((segment: any) => {
      ctx.log(
        `  suspect #${segment.rank} ${segment.from}->${segment.to}: line=${segment.sourceLine ?? '-'} warnLoops=${segment.warnLoopCount} score=${segment.suspectScore.toFixed(2)} worst=${segment.worstLoopKey ?? '-'}`,
      );
    });
  }
};
