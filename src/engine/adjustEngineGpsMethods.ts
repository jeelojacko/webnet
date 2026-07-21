import {
  applyGpsVerticalDeflection as applyGpsVerticalDeflectionHelper,
  buildGpsDisplayResidualTransform,
  gpsRoverOffsetVector as gpsRoverOffsetVectorHelper,
  gpsUsesLocalSolveFrame as gpsUsesLocalSolveFrameHelper,
  plannedGpsRawVector as plannedGpsRawVectorHelper,
  transformGpsCovarianceToSolveFrame as transformGpsCovarianceToSolveFrameHelper,
} from './adjustGpsVectorHelpers';
import {
  captureObservationWeightingStdDevs as captureObservationWeightingStdDevsHelper,
  gpsCovariance as gpsCovarianceHelper,
  gpsModeledVector as gpsModeledVectorHelper,
  gpsModeledVectorDerivatives as gpsModeledVectorDerivativesHelper,
  gpsModeledVectorFromStationValues as gpsModeledVectorFromStationValuesHelper,
  gpsObservedVector as gpsObservedVectorHelper,
  gpsWeight as gpsWeightHelper,
  updateGpsAddHiHtDiagnostics as updateGpsAddHiHtDiagnosticsHelper,
} from './adjustGpsObservationModel';
import { LSAEngineCoordinateMethods } from './adjustEngineCoordinateMethods';
import {
  stationEllipsoidHeightFromCoordinateValues,
  stationGeodeticFromCoordinateValues,
} from './adjustStationCoordinateHelpers';
import type {
  GpsCovariance,
  GpsSolveVector,
  GpsVectorComponents,
  GpsVectorDerivatives,
} from './adjustTypes';
import type {
  DistanceObservation,
  GnssVectorFrame,
  GpsObservation,
  Observation,
  Station,
  StationId,
} from '../types';

export abstract class LSAEngineGpsMethods extends LSAEngineCoordinateMethods {
  protected gpsRoverOffsetVector(obs: GpsObservation): {
    dE: number;
    dN: number;
    dH: number;
    horizDistance: number;
    applied: boolean;
  } {
    return gpsRoverOffsetVectorHelper(obs);
  }

  protected plannedGpsRawVector(obs: GpsObservation): { dE: number; dN: number; dU?: number } {
    return plannedGpsRawVectorHelper({
      is2D: this.is2D,
      obs,
      stations: this.stations,
    });
  }

  protected gpsComponentCount(obs: GpsObservation): number {
    return !this.is2D && Number.isFinite(obs.obs.dU ?? Number.NaN) ? 3 : 2;
  }

  protected gpsUsesLocalSolveFrame(frame: GnssVectorFrame): boolean {
    return gpsUsesLocalSolveFrameHelper(frame);
  }

  protected stationGeodeticFromCoordinates(
    stationId: StationId,
    x: number,
    y: number,
  ): { latDeg: number; lonDeg: number } | null {
    return stationGeodeticFromCoordinateValues({
      coordSystemMode: this.coordSystemMode,
      crsId: this.crsId,
      parseState: this.parseState,
      station: this.stations[stationId],
      x,
      y,
    });
  }

  protected stationEllipsoidHeightFromValues(
    station: Station,
    h: number,
    latDeg?: number,
    lonDeg?: number,
  ): number {
    return stationEllipsoidHeightFromCoordinateValues({
      activeGeoidModel: this.activeGeoidModel,
      averageGeoidHeight: this.averageGeoidHeight,
      geoidInterpolation: this.geoidInterpolation,
      h,
      latDeg,
      lonDeg,
      station,
    });
  }

  protected applyGpsVerticalDeflection(
    vector: Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>>,
  ): Required<Pick<GpsSolveVector, 'dE' | 'dN' | 'dU'>> {
    return applyGpsVerticalDeflectionHelper(
      vector,
      this.parseState?.verticalDeflectionNorthSec ?? 0,
      this.parseState?.verticalDeflectionEastSec ?? 0,
    );
  }

  protected gpsDisplayResidualTransform(obs: GpsObservation): number[][] | null {
    const frame: GnssVectorFrame =
      obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU';
    return buildGpsDisplayResidualTransform({
      frame,
      northSec: this.parseState?.verticalDeflectionNorthSec ?? 0,
      eastSec: this.parseState?.verticalDeflectionEastSec ?? 0,
    });
  }

  protected transformGpsCovarianceToSolveFrame(obs: GpsObservation): GpsCovariance | null {
    const frame: GnssVectorFrame =
      obs.gnssVectorFrame ?? this.parseState?.gnssVectorFrameDefault ?? 'gridNEU';
    return transformGpsCovarianceToSolveFrameHelper({
      componentCount: this.gpsComponentCount(obs),
      frame,
      obs,
      stationGeodetic: (stationId) => this.stationGeodetic(stationId),
      northSec: this.parseState?.verticalDeflectionNorthSec ?? 0,
      eastSec: this.parseState?.verticalDeflectionEastSec ?? 0,
    });
  }

  protected captureObservationWeightingStdDevs(observations: Observation[]): void {
    captureObservationWeightingStdDevsHelper(observations, {
      effectiveStdDev: (obs) => this.effectiveStdDev(obs),
      getObservedHorizontalDistanceIn2D: (obs) => this.getObservedHorizontalDistanceIn2D(obs),
      gpsCovariance: (obs) => this.gpsCovariance(obs),
    });
  }

  protected gpsCovariance(obs: Observation): GpsCovariance {
    return gpsCovarianceHelper(obs, {
      gpsObservedVector: (gps) => this.gpsObservedVector(gps),
      transformGpsCovarianceToSolveFrame: (gps) => this.transformGpsCovarianceToSolveFrame(gps),
    });
  }

  protected gpsWeight(obs: Observation): {
    wEE: number;
    wNN: number;
    wEN: number;
    wUU?: number;
    wEU?: number;
    wNU?: number;
  } {
    return gpsWeightHelper(obs, {
      gpsCovariance: (observation) => this.gpsCovariance(observation),
      is2D: this.is2D,
    });
  }

  protected gpsObservedVector(obs: GpsObservation): GpsSolveVector {
    return gpsObservedVectorHelper(obs, {
      addCoordSystemDiagnostic: this.addCoordSystemDiagnostic.bind(this),
      addCoordSystemWarning: this.addCoordSystemWarning.bind(this),
      applyGpsVerticalDeflection: (vector) => this.applyGpsVerticalDeflection(vector),
      gpsRoverOffsetVector: (gps) => this.gpsRoverOffsetVector(gps),
      is2D: this.is2D,
      parseState: this.parseState,
      stationGeodetic: (stationId) => this.stationGeodetic(stationId),
      stations: this.stations,
    });
  }

  protected gpsModeledVectorFromStationValues(
    obs: GpsObservation,
    fromValues: { x: number; y: number; h: number },
    toValues: { x: number; y: number; h: number },
  ): GpsVectorComponents {
    return gpsModeledVectorFromStationValuesHelper(obs, fromValues, toValues, {
      applyGpsVerticalDeflection: (vector) => this.applyGpsVerticalDeflection(vector),
      coordSystemMode: this.coordSystemMode,
      gpsUsesLocalSolveFrame: (frame) => this.gpsUsesLocalSolveFrame(frame),
      is2D: this.is2D,
      parseState: this.parseState,
      stationEllipsoidHeightFromValues: (station, h, latDeg, lonDeg) =>
        this.stationEllipsoidHeightFromValues(station, h, latDeg, lonDeg),
      stationGeodeticFromCoordinates: (stationId, x, y) =>
        this.stationGeodeticFromCoordinates(stationId, x, y),
      stations: this.stations,
    });
  }

  protected gpsModeledVector(obs: GpsObservation): GpsSolveVector {
    return gpsModeledVectorHelper(obs, {
      gpsModeledVectorFromStationValues: (gps, fromValues, toValues) =>
        this.gpsModeledVectorFromStationValues(gps, fromValues, toValues),
      stations: this.stations,
    });
  }

  protected gpsModeledVectorDerivatives(obs: GpsObservation): GpsVectorDerivatives {
    return gpsModeledVectorDerivativesHelper(obs, {
      gpsModeledVectorFromStationValues: (gps, fromValues, toValues) =>
        this.gpsModeledVectorFromStationValues(gps, fromValues, toValues),
      is2D: this.is2D,
      stations: this.stations,
    });
  }

  protected updateGpsAddHiHtDiagnostics(): void {
    updateGpsAddHiHtDiagnosticsHelper({
      gpsObservedVector: (gps) => this.gpsObservedVector(gps),
      log: this.log.bind(this),
      observations: this.observations,
      parseState: this.parseState,
    });
  }

  protected abstract effectiveStdDev(_obs: Observation): number;

  protected abstract getObservedHorizontalDistanceIn2D(_obs: DistanceObservation): {
    observedDistance: number;
    sigmaDistance: number;
    usedZenith: boolean;
  };
}
