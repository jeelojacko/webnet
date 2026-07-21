import {
  captureInitialSigmaGeometrySnapshot as captureInitialSigmaGeometrySnapshotHelper,
  effectiveStdDev as effectiveStdDevHelper,
  getSigmaGeometryAzimuth as getSigmaGeometryAzimuthHelper,
  getSigmaGeometryZenith as getSigmaGeometryZenithHelper,
  shouldApplyIndustryParityAngularSigmaCalibration as shouldApplyIndustryParityAngularSigmaCalibrationHelper,
} from './adjustObservationWeighting';
import {
  applyRobustWeightFactors as applyRobustWeightFactorsHelper,
  captureRobustWeightBase as captureRobustWeightBaseHelper,
  computeRobustWeightSummary as computeRobustWeightSummaryHelper,
  maxRobustWeightDelta as maxRobustWeightDeltaHelper,
  observationStations as observationStationsHelper,
  recordRobustDiagnostics as recordRobustDiagnosticsHelper,
  robustCorrelationRowGroups as robustCorrelationRowGroupsHelper,
  weightedQuadratic as weightedQuadraticHelper,
} from './adjustRobustWeights';
import {
  computeDirectionSetPrefit as computeDirectionSetPrefitHelper,
  logNetworkDiagnostics as logNetworkDiagnosticsHelper,
} from './adjustNetworkDiagnostics';
import {
  applyTsCorrelationToWeightMatrix as applyTsCorrelationToWeightMatrixHelper,
  tsCorrelationGroup as tsCorrelationGroupHelper,
} from './adjustTsCorrelationWeights';
import { LSAEngineBootstrapMethods } from './adjustEngineBootstrapMethods';
import { populatePreanalysisObservations as populatePreanalysisObservationsHelper } from './adjustPreanalysisObservationPopulation';
import type {
  BootstrapPairMetrics,
} from './adjustTypes';
import type {
  EquationRowInfo,
  RobustWeightMatrixBase,
  RobustWeightSummary,
} from './adjustmentSolveTypes';
import type {
  DistanceObservation,
  Instrument,
  LevelObservation,
  Observation,
  SigmaSource,
  StationId,
} from '../types';

export abstract class LSAEngineObservationMethods extends LSAEngineBootstrapMethods {
  protected getInstrument(obs: Observation): Instrument | undefined {
    if (!obs.instCode) return undefined;
    return this.instrumentLibrary[obs.instCode];
  }

  protected findPairedVerticalObservation(
    obs: DistanceObservation,
  ): LevelObservation | Observation | undefined {
    return this.observations.find(
      (candidate) =>
        candidate.sourceLine === obs.sourceLine &&
        candidate.type === 'zenith' &&
        'from' in candidate &&
        'to' in candidate &&
        candidate.from === obs.from &&
        candidate.to === obs.to,
    );
  }

  protected getObservedHorizontalDistanceIn2D(obs: DistanceObservation): {
    observedDistance: number;
    sigmaDistance: number;
    usedZenith: boolean;
  } {
    const sigmaDistance = this.effectiveStdDev(obs);
    if (!this.is2D || obs.mode !== 'slope') {
      return {
        observedDistance: obs.obs,
        sigmaDistance,
        usedZenith: false,
      };
    }
    const pairedVertical = this.findPairedVerticalObservation(obs);
    if (!pairedVertical || pairedVertical.type !== 'zenith') {
      return {
        observedDistance: obs.obs,
        sigmaDistance,
        usedZenith: false,
      };
    }
    const z = pairedVertical.obs;
    const sigmaZ = this.effectiveStdDev(pairedVertical);
    return {
      observedDistance: obs.obs * Math.sin(z),
      sigmaDistance: Math.sqrt(
        (Math.sin(z) * sigmaDistance) ** 2 + (obs.obs * Math.cos(z) * sigmaZ) ** 2,
      ),
      usedZenith: true,
    };
  }

  protected defaultDistanceSigmaMeters(obs: DistanceObservation): number {
    const inst = this.getInstrument(obs);
    if (!inst) return 0;
    const geom = this.centeringLineGeometry(obs.from, obs.to, obs.hi ?? 0, obs.ht ?? 0);
    const modeledDistance = this.is2D ? geom.horiz : obs.mode === 'slope' ? geom.slope : geom.horiz;
    const ppmTerm = inst.edm_ppm * 1e-6 * modeledDistance;
    const edmMode = this.parseState?.edmMode ?? this.parseOptions?.edmMode ?? 'additive';
    if (edmMode === 'propagated') {
      return Math.sqrt(inst.edm_const * inst.edm_const + ppmTerm * ppmTerm);
    }
    return Math.abs(inst.edm_const) + Math.abs(ppmTerm);
  }

  protected populatePreanalysisObservations(): void {
    populatePreanalysisObservationsHelper({
      centeringLineGeometry: (fromId, toId, hi, ht) =>
        this.centeringLineGeometry(fromId, toId, hi, ht),
      correctedDistanceModel: (obs, rawDistance) =>
        this.correctedDistanceModel(obs, rawDistance),
      defaultDistanceSigmaMeters: (obs) => this.defaultDistanceSigmaMeters(obs),
      getAzimuth: (fromId, toId) => this.getAzimuth(fromId, toId),
      getModeledZenith: (obs) => this.getModeledZenith(obs),
      is2D: this.is2D,
      log: (msg) => this.log(msg),
      modeledAzimuth: (rawAz, atStationId, applyConvergence) =>
        this.modeledAzimuth(rawAz, atStationId, applyConvergence),
      observations: this.observations,
      parseState: this.parseState,
      plannedGpsRawVector: (obs) => this.plannedGpsRawVector(obs),
      stations: this.stations,
    });
  }

  protected centeringLineGeometry(
    fromID: StationId,
    toID: StationId,
    hi = 0,
    ht = 0,
  ): { horiz: number; slope: number; elev: number } {
    const geom = this.getZenith(fromID, toID, hi, ht);
    return {
      horiz: Math.max(geom.horiz, 0),
      slope: Math.max(geom.dist, 0),
      elev: geom.dh,
    };
  }

  protected captureInitialSigmaGeometrySnapshot(): void {
    this.initialSigmaGeometryStations = captureInitialSigmaGeometrySnapshotHelper({
      azimuthCache: this.initialSigmaAzimuthCache,
      geometryDependentSigmaReference: this.geometryDependentSigmaReference,
      stations: this.stations,
      zenithCache: this.initialSigmaZenithCache,
    });
  }

  protected getSigmaGeometryAzimuth(
    fromID: StationId,
    toID: StationId,
  ): { az: number; dist: number } {
    return getSigmaGeometryAzimuthHelper({
      cache: this.initialSigmaAzimuthCache,
      currentGeometryAzimuth: (fromId, toId) => this.getAzimuth(fromId, toId),
      fromID,
      geometryDependentSigmaReference: this.geometryDependentSigmaReference,
      initialSigmaGeometryStations: this.initialSigmaGeometryStations,
      toID,
    });
  }

  protected getSigmaGeometryZenith(
    fromID: StationId,
    toID: StationId,
    hi = 0,
    ht = 0,
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number } {
    return getSigmaGeometryZenithHelper({
      cache: this.initialSigmaZenithCache,
      currentGeometryZenith: (fromId, toId, fromHi, toHt) =>
        this.getZenith(fromId, toId, fromHi, toHt),
      curvatureRefractionAngle: (horiz) => this.curvatureRefractionAngle(horiz),
      fromID,
      geometryDependentSigmaReference: this.geometryDependentSigmaReference,
      hi,
      ht,
      initialSigmaGeometryStations: this.initialSigmaGeometryStations,
      toID,
    });
  }

  protected shouldApplyIndustryParityAngularSigmaCalibration(
    obs: Observation,
    source: SigmaSource,
  ): boolean {
    return shouldApplyIndustryParityAngularSigmaCalibrationHelper(
      obs,
      source,
      this.geometryDependentSigmaReference,
    );
  }

  protected effectiveStdDev(obs: Observation): number {
    return effectiveStdDevHelper({
      addCenteringToExplicit: this.addCenteringToExplicit,
      applyCentering: this.applyCentering,
      centeringLineGeometry: (fromId, toId, hi, ht) =>
        this.centeringLineGeometry(fromId, toId, hi, ht),
      geometryDependentSigmaReference: this.geometryDependentSigmaReference,
      getSigmaGeometryAzimuth: (fromId, toId) => this.getSigmaGeometryAzimuth(fromId, toId),
      instrument: this.getInstrument(obs),
      is2D: this.is2D,
      obs,
      wrapToPi: (value) => this.wrapToPi(value),
    });
  }

  protected tsCorrelationGroup(
    obs: Observation,
  ): { key: string; station: StationId; setId?: string } | null {
    return tsCorrelationGroupHelper({
      enabled: this.tsCorrelationEnabled,
      obs,
      scope: this.tsCorrelationScope,
    });
  }

  protected applyTsCorrelationToWeightMatrix(
    P: number[][],
    rowInfo: EquationRowInfo[],
    captureDiagnostics = false,
  ): void {
    const diagnostics = applyTsCorrelationToWeightMatrixHelper({
      captureDiagnostics,
      effectiveStdDev: (obs) => this.effectiveStdDev(obs),
      enabled: this.tsCorrelationEnabled,
      matrix: P,
      rho: this.tsCorrelationRho,
      rowInfo,
      scope: this.tsCorrelationScope,
      tsCorrelationGroup: (obs) => this.tsCorrelationGroup(obs),
    });
    if (captureDiagnostics) this.tsCorrelationDiagnostics = diagnostics;
  }

  protected weightedQuadratic(P: number[][], v: number[][]): number {
    return weightedQuadraticHelper(P, v);
  }

  protected observationStations(obs: Observation): string {
    return observationStationsHelper(obs);
  }

  protected rowSigma(info: NonNullable<EquationRowInfo>): number {
    if (info.obs.type === 'gps') {
      const cov = this.gpsCovariance(info.obs);
      const variance =
        info.component === 'N'
          ? cov.cNN
          : info.component === 'U'
            ? (cov.cUU ?? cov.cNN)
            : cov.cEE;
      return Math.sqrt(Math.max(variance, 1e-24));
    }
    return Math.max(this.effectiveStdDev(info.obs), 1e-12);
  }

  protected robustCorrelationRowGroups(rowInfo: EquationRowInfo[]): number[][] {
    return robustCorrelationRowGroupsHelper(rowInfo, {
      rowSigma: (info) => this.rowSigma(info),
      tsCorrelationEnabled: this.tsCorrelationEnabled,
      tsCorrelationGroup: (obs) => this.tsCorrelationGroup(obs),
    });
  }

  protected captureRobustWeightBase(P: number[][], rowInfo: EquationRowInfo[]): RobustWeightMatrixBase {
    return captureRobustWeightBaseHelper(P, rowInfo, {
      robustCorrelationRowGroups: (info) => this.robustCorrelationRowGroups(info),
    });
  }

  protected applyRobustWeightFactors(
    P: number[][],
    base: RobustWeightMatrixBase,
    factors: number[],
  ): void {
    applyRobustWeightFactorsHelper(P, base, factors);
  }

  protected computeRobustWeightSummary(
    residuals: number[],
    rowInfo: EquationRowInfo[],
  ): RobustWeightSummary {
    return computeRobustWeightSummaryHelper(residuals, rowInfo, {
      robustK: this.robustK,
      rowSigma: (info) => this.rowSigma(info),
    });
  }

  protected recordRobustDiagnostics(
    iteration: number,
    summary: RobustWeightSummary,
    maxWeightDelta: number,
  ): void {
    recordRobustDiagnosticsHelper({
      iteration,
      log: (message) => this.log(message),
      maxWeightDelta,
      robustDiagnostics: this.robustDiagnostics,
      robustMode: this.robustMode,
      summary,
    });
  }

  protected maxRobustWeightDelta(a: number[], b: number[]): number {
    return maxRobustWeightDeltaHelper(a, b);
  }

  protected computeDirectionSetPrefit(
    activeObservations: Observation[],
    directionSetIds: string[],
  ): void {
    computeDirectionSetPrefitHelper({
      activeObservations,
      directionOrientations: this.directionOrientations,
      directionSetIds,
      getAzimuth: (fromId, toId) => this.getAzimuth(fromId, toId),
      logs: this.logs,
      modeledAzimuth: (rawAz, atStationId, applyConvergence) =>
        this.modeledAzimuth(rawAz, atStationId, applyConvergence),
      stations: this.stations,
    });
  }

  protected logNetworkDiagnostics(activeObservations: Observation[]) {
    logNetworkDiagnosticsHelper({
      activeObservations,
      log: this.log.bind(this),
      unknowns: this.unknowns,
    });
  }
}
