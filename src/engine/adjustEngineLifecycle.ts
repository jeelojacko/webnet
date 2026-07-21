import { buildSolveProgressEvent } from './adjustSolveTiming';
import {
  buildSolveTimingProfile as buildSolveTimingProfileHelper,
  createEmptySolveTiming,
  formatSolveTimingLogLine,
} from './adjustSolveTiming';
import { addUniqueCoordSystemWarning } from './adjustCoordSystemDiagnostics';
import { collectActiveObservationsForSolve, isObservationActiveForSolve } from './adjustmentPreprocessing';
import { runModeCompatibilityDiagnosticLines } from './adjustmentRunModeCompatibility';
import type { LSAEngineState } from './adjustEngineState';
import { LSAEngineState as EngineStateBase } from './adjustEngineState';
import type { SolveProgressEvent } from './scenarioRunModels';
import type {
  AdjustmentResult,
  CoordSystemDiagnosticCode,
  CrsOffReason,
  Observation,
  RunModeCompatibilityDiagnostic,
} from '../types';

export abstract class LSAEngineLifecycle extends EngineStateBase {
  protected log(msg: string) {
    this.logs.push(msg);
  }

  protected emitSolveProgress(phase: SolveProgressEvent['phase']): void {
    if (!this.progressCallback) return;
    this.progressCallback(
      buildSolveProgressEvent({
        converged: this.converged,
        iterations: this.iterations,
        maxIterations: this.maxIterations,
        phase,
        solveStartedAt: this.solveStartedAt,
      }),
    );
  }

  protected resetSolveTiming(): void {
    this.solveTiming = createEmptySolveTiming();
    this.solveTimingLogged = false;
  }

  protected buildSolveTimingProfile(): NonNullable<AdjustmentResult['solveTimingProfile']> {
    return buildSolveTimingProfileHelper({
      solveStartedAt: this.solveStartedAt,
      solveTiming: this.solveTiming,
    });
  }

  protected logSolveTimingProfile(
    profile: NonNullable<AdjustmentResult['solveTimingProfile']>,
  ): void {
    if (this.solveTimingLogged) return;
    this.solveTimingLogged = true;
    this.logs.push(formatSolveTimingLogLine(profile));
  }

  protected finishSolve(result: AdjustmentResult): AdjustmentResult {
    this.emitSolveProgress('complete');
    return result;
  }

  protected emitRunModeCompatibilityDiagnostics(
    diagnostics: RunModeCompatibilityDiagnostic[],
  ): void {
    runModeCompatibilityDiagnosticLines(diagnostics).forEach((line) => this.log(line));
  }

  protected addCoordSystemDiagnostic(code: CoordSystemDiagnosticCode, warning?: string): void {
    this.coordSystemDiagnostics.add(code);
    if (!warning) return;
    this.addCoordSystemWarning(warning);
  }

  protected addCoordSystemWarning(warning: string): void {
    addUniqueCoordSystemWarning({
      coordSystemWarningMessages: this.coordSystemWarningMessages,
      coordWarningSeen: this.coordWarningSeen,
      log: (message) => this.log(message),
      warning,
    });
  }

  protected setCrsOff(reason: CrsOffReason, warning?: string): void {
    this.crsStatus = 'off';
    this.crsOffReason = reason;
    if (warning) this.addCoordSystemWarning(warning);
  }

  protected setCrsOn(): void {
    this.crsStatus = 'on';
    this.crsOffReason = undefined;
  }

  protected clearCoordSystemDiagnostics(): void {
    this.coordSystemDiagnostics.clear();
    this.coordSystemWarningMessages = [];
    this.coordWarningSeen.clear();
    this.crsDatumOpId = '';
    this.crsDatumFallbackUsed = false;
    this.crsAreaOfUseStatus = 'unknown';
    this.crsOutOfAreaStationCount = 0;
    this.crsStatus = 'off';
    this.crsOffReason = this.coordSystemMode === 'grid' ? 'noCRSSelected' : 'disabledByProfile';
  }

  protected clearGeometryCache() {
    this.azimuthCache.clear();
    this.zenithCache.clear();
    this.stationFactorCache.clear();
  }

  protected collectActiveObservations(): Observation[] {
    return collectActiveObservationsForSolve(this.observations, this.excludeIds, this.is2D);
  }

  protected isObservationActive(obs: Observation): boolean {
    return isObservationActiveForSolve(obs, this.excludeIds, this.is2D);
  }
}

export type LSAEngineLifecycleState = LSAEngineState;
