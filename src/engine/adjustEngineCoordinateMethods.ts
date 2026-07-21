import {
  applyAverageGeoidHeightConversions as applyAverageGeoidHeightConversionsHelper,
  applyGeoidHeightConversions as applyGeoidHeightConversionsHelper,
  resolveStationEllipsoidHeight as resolveStationEllipsoidHeightHelper,
} from './adjustGeoidHeightHelpers';
import {
  captureRawTraverseDirectionCorrections as captureRawTraverseDirectionCorrectionsHelper,
  captureRawTraverseDistanceFactorSnapshots as captureRawTraverseDistanceFactorSnapshotsHelper,
  correctedDistanceModel as correctedDistanceModelHelper,
  crsDistanceScaleForObservation as crsDistanceScaleForObservationHelper,
  curvatureRefractionAngle as curvatureRefractionAngleHelper,
  effectiveDistanceForAngularObservation as effectiveDistanceForAngularObservationHelper,
  getModeledZenith as getModeledZenithHelper,
  getZenith as getZenithHelper,
  mapDistanceScaleForObservation as mapDistanceScaleForObservationHelper,
  measuredAngleCorrection as measuredAngleCorrectionHelper,
  modeledAzimuth as modeledAzimuthHelper,
  prismCorrectionForObservation as prismCorrectionForObservationHelper,
  rawDirectionSetCorrection as rawDirectionSetCorrectionHelper,
  rawDistanceCombinedFactor as rawDistanceCombinedFactorHelper,
  zenithScaleForObservation as zenithScaleForObservationHelper,
} from './adjustReductionHelpers';
import { LSAEngineLifecycle } from './adjustEngineLifecycle';
import {
  buildStationFactorSnapshot,
  evaluateCrsAreaOfUseCoverage as evaluateCrsAreaOfUseCoverageHelper,
  resolveStationGeodetic,
  type StationFactorSnapshot,
} from './adjustStationCoordinateHelpers';
import type { GeoidGridModel } from './geoid';
import type {
  DatumSufficiencyReport,
  DistanceObservation,
  Observation,
  Station,
  StationId,
  ZenithObservation,
} from '../types';

export abstract class LSAEngineCoordinateMethods extends LSAEngineLifecycle {
  protected getAzimuth(fromID: StationId, toID: StationId): { az: number; dist: number } {
    const cacheKey = `${fromID}|${toID}`;
    const cached = this.azimuthCache.get(cacheKey);
    if (cached) return cached;
    const s1 = this.stations[fromID];
    const s2 = this.stations[toID];
    if (!s1 || !s2) return { az: 0, dist: 0 };
    const dx = s2.x - s1.x;
    const dy = s2.y - s1.y;
    let az = Math.atan2(dx, dy);
    if (az < 0) az += 2 * Math.PI;
    const result = { az, dist: Math.sqrt(dx * dx + dy * dy) };
    this.azimuthCache.set(cacheKey, result);
    return result;
  }

  protected applyGeoidHeightConversions(model: GeoidGridModel): void {
    applyGeoidHeightConversionsHelper({
      geoidInterpolation: this.geoidInterpolation,
      geoidOutputHeightDatum: this.geoidOutputHeightDatum,
      log: this.log.bind(this),
      model,
      parseState: this.parseState,
      stations: this.stations,
    });
  }

  protected applyAverageGeoidHeightConversions(): void {
    applyAverageGeoidHeightConversionsHelper({
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      averageGeoidHeight: this.averageGeoidHeight,
      geoidOutputHeightDatum: this.geoidOutputHeightDatum,
      log: this.log.bind(this),
      parseState: this.parseState,
      stations: this.stations,
    });
  }

  protected resolveStationEllipsoidHeight(station: Station): {
    ellipsoidHeightUsed: number;
    source: 'perStationGeoid+H' | 'avgGeoid+H' | 'providedEllipsoid' | 'assumed0';
  } {
    return resolveStationEllipsoidHeightHelper({
      activeGeoidModel: this.activeGeoidModel,
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      averageGeoidHeight: this.averageGeoidHeight,
      geoidInterpolation: this.geoidInterpolation,
      station,
    });
  }

  protected stationEllipsoidHeight(station: Station): number {
    return this.resolveStationEllipsoidHeight(station).ellipsoidHeightUsed;
  }

  protected stationGeodetic(stationId: StationId): { latDeg: number; lonDeg: number } | null {
    return resolveStationGeodetic({
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
      markDatumFallbackUsed: () => {
        this.crsDatumFallbackUsed = true;
      },
      parseState: this.parseState,
      setCrsDatumOpId: (datumOpId) => {
        if (!this.crsDatumOpId) this.crsDatumOpId = datumOpId;
      },
      setCrsOff: this.setCrsOff.bind(this),
      setCrsOn: this.setCrsOn.bind(this),
      stationId,
      stations: this.stations,
    });
  }

  protected stationFactorSnapshot(stationId: StationId): StationFactorSnapshot {
    return buildStationFactorSnapshot({
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      averageGeoidHeight: this.averageGeoidHeight,
      coordSystemMode: this.coordSystemMode,
      crsConvergenceAngleRad: this.crsConvergenceAngleRad,
      crsConvergenceEnabled: this.crsConvergenceEnabled,
      crsGridScaleEnabled: this.crsGridScaleEnabled,
      crsGridScaleFactor: this.crsGridScaleFactor,
      crsId: this.crsId,
      markDatumFallbackUsed: () => {
        this.crsDatumFallbackUsed = true;
      },
      setCrsDatumOpId: (datumOpId) => {
        if (!this.crsDatumOpId) this.crsDatumOpId = datumOpId;
      },
      stationEllipsoidHeight: (station) => this.stationEllipsoidHeight(station),
      stationFactorCache: this.stationFactorCache,
      stationGeodetic: (id) => this.stationGeodetic(id),
      stationId,
      stations: this.stations,
    });
  }

  protected evaluateCrsAreaOfUseCoverage(): void {
    const result = evaluateCrsAreaOfUseCoverageHelper({
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
      stationGeodetic: (stationId) => this.stationGeodetic(stationId),
      stations: this.stations,
    });
    this.crsAreaOfUseStatus = result.status;
    this.crsOutOfAreaStationCount = result.outOfAreaStationCount;
  }

  protected measuredAngleCorrection(at: StationId, from: StationId, to: StationId): number {
    if (!this.stations[at]) return 0;
    return measuredAngleCorrectionHelper({
      coordSystemMode: this.coordSystemMode,
      from,
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
      to,
    });
  }

  protected rawDistanceCombinedFactor(obs: Observation & { type: 'dist' }): number {
    return rawDistanceCombinedFactorHelper({
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
      obs,
      stationEllipsoidHeight: (station) => this.stationEllipsoidHeight(station),
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
      stationGeodetic: (stationId) => this.stationGeodetic(stationId),
      stations: this.stations,
    });
  }

  protected rawDirectionSetCorrection(obs: Observation & { type: 'direction' }): number {
    return rawDirectionSetCorrectionHelper({
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
      obs,
      parseState: this.parseState,
      stationGeodetic: (stationId) => this.stationGeodetic(stationId),
      stations: this.stations,
      wrapToPi: (value) => this.wrapToPi(value),
    });
  }

  protected captureRawTraverseDistanceFactorSnapshots(activeObservations: Observation[]): void {
    captureRawTraverseDistanceFactorSnapshotsHelper(
      activeObservations,
      this.parseState,
      (obs) => this.rawDistanceCombinedFactor(obs),
    );
  }

  protected captureRawTraverseDirectionCorrections(activeObservations: Observation[]): void {
    captureRawTraverseDirectionCorrectionsHelper(
      activeObservations,
      this.parseState,
      (obs) => this.rawDirectionSetCorrection(obs),
    );
  }

  protected modeledAzimuth(rawAz: number, atStationId?: StationId, applyConvergence = true): number {
    return modeledAzimuthHelper({
      applyConvergence,
      atStationId,
      crsConvergenceAngleRad: this.crsConvergenceAngleRad,
      crsConvergenceEnabled: this.crsConvergenceEnabled,
      rawAz,
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
    });
  }

  protected wrapToPi(val: number): number {
    let v = val;
    if (v > Math.PI) v -= 2 * Math.PI;
    if (v < -Math.PI) v += 2 * Math.PI;
    return v;
  }

  protected logObsDebug(iteration: number, label: string, details: string) {
    if (!this.debug) return;
    this.logs.push(`Iter ${iteration} ${label}: ${details}`);
  }

  protected mapDistanceScaleForObservation(obs: Observation): number {
    return mapDistanceScaleForObservationHelper({
      is2D: this.is2D,
      mapMode: this.mapMode,
      mapScaleFactor: this.mapScaleFactor,
      obs,
    });
  }

  protected crsDistanceScaleForObservation(obs: Observation): number {
    return crsDistanceScaleForObservationHelper({
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      averageScaleFactor: this.averageScaleFactor,
      commonElevation: this.commonElevation,
      coordSystemMode: this.coordSystemMode,
      crsGridScaleEnabled: this.crsGridScaleEnabled,
      crsGridScaleFactor: this.crsGridScaleFactor,
      localDatumScheme: this.localDatumScheme,
      obs,
      scaleOverrideActive: this.scaleOverrideActive,
      stationEllipsoidHeight: (station) => this.stationEllipsoidHeight(station),
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
      stations: this.stations,
    });
  }

  protected distanceScaleForObservation(obs: Observation): number {
    return this.mapDistanceScaleForObservation(obs) * this.crsDistanceScaleForObservation(obs);
  }

  protected prismCorrectionForObservation(obs: Observation): number {
    return prismCorrectionForObservationHelper({
      obs,
      prismEnabled: this.prismEnabled,
      prismOffset: this.prismOffset,
      prismScope: this.prismScope,
    });
  }

  protected correctedDistanceModel(
    obs: DistanceObservation,
    calcDistRaw: number,
  ): {
    calcDistance: number;
    mapScale: number;
    prismCorrection: number;
    horizontalDerivativeFactor?: number;
    verticalDerivativeFactor?: number;
    useReducedSlopeDerivatives?: boolean;
  } {
    return correctedDistanceModelHelper({
      calcDistRaw,
      centeringLineGeometry: (fromId, toId, hi, ht) =>
        this.centeringLineGeometry(fromId, toId, hi, ht),
      coordSystemMode: this.coordSystemMode,
      distanceScaleForObservation: (distanceObs) => this.distanceScaleForObservation(distanceObs),
      is2D: this.is2D,
      obs,
      prismCorrectionForObservation: (prismObs) => this.prismCorrectionForObservation(prismObs),
    });
  }

  protected curvatureRefractionAngle(horiz: number): number {
    return curvatureRefractionAngleHelper({
      applyCurvatureRefraction: this.applyCurvatureRefraction,
      horiz,
      refractionCoefficient: this.refractionCoefficient,
      verticalReduction: this.verticalReduction,
    });
  }

  protected zenithScaleForObservation(obs: ZenithObservation): number {
    return zenithScaleForObservationHelper({
      averageScaleFactor: this.averageScaleFactor,
      commonElevation: this.commonElevation,
      coordSystemMode: this.coordSystemMode,
      crsGridScaleEnabled: this.crsGridScaleEnabled,
      crsGridScaleFactor: this.crsGridScaleFactor,
      localDatumScheme: this.localDatumScheme,
      obs,
      scaleOverrideActive: this.scaleOverrideActive,
      stationEllipsoidHeight: (station) => this.stationEllipsoidHeight(station),
      stationFactorSnapshot: (stationId) => this.stationFactorSnapshot(stationId),
      stations: this.stations,
    });
  }

  protected getZenith(
    fromID: StationId,
    toID: StationId,
    hi = 0,
    ht = 0,
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number } {
    return getZenithHelper({
      curvatureRefractionAngle: (horiz) => this.curvatureRefractionAngle(horiz),
      fromID,
      hi,
      ht,
      stations: this.stations,
      toID,
      zenithCache: this.zenithCache,
    });
  }

  protected getModeledZenith(
    obs: ZenithObservation,
  ): { z: number; dist: number; horiz: number; dh: number; crCorr: number; horizontalScale: number } {
    return getModeledZenithHelper({
      coordSystemMode: this.coordSystemMode,
      curvatureRefractionAngle: (horiz) => this.curvatureRefractionAngle(horiz),
      getZenith: (fromId, toId, hi, ht) => this.getZenith(fromId, toId, hi, ht),
      is2D: this.is2D,
      obs,
      zenithScaleForObservation: (zenithObs) => this.zenithScaleForObservation(zenithObs),
    });
  }

  protected effectiveDistanceForAngularObservation(obs: Observation): number | undefined {
    return effectiveDistanceForAngularObservationHelper({
      getAzimuth: (fromId, toId) => this.getAzimuth(fromId, toId),
      getModeledZenith: (zenithObs) => this.getModeledZenith(zenithObs),
      obs,
    });
  }

  protected abstract centeringLineGeometry(
    _fromID: StationId,
    _toID: StationId,
    _hi?: number,
    _ht?: number,
  ): { horiz: number; slope: number; elev: number };
}
