import {
  evaluateDatumSufficiency as evaluateDatumSufficiencyHelper,
  evaluateGridInputGate as evaluateGridInputGateHelper,
} from './adjustDatumChecks';
import {
  applyBootstrapApproxStation as applyBootstrapApproxStationHelper,
  bootstrapApproximateTraverseCoords as bootstrapApproximateTraverseCoordsHelper,
  buildBootstrapPairMetrics as buildBootstrapPairMetricsHelper,
  estimateBootstrapSetOrientation as estimateBootstrapSetOrientationHelper,
  stationHasBootstrapableApprox as stationHasBootstrapableApproxHelper,
  tryBootstrapDirectionSetOccupy as tryBootstrapDirectionSetOccupyHelper,
} from './adjustBootstrapHelpers';
import { LSAEngineGpsMethods } from './adjustEngineGpsMethods';
import {
  projectWeakFloatZenithLeafStationsForDisplay as projectWeakFloatZenithLeafStations,
} from './adjustmentWeakFloatZenithProjection';
import type {
  BootstrapDirectionSet,
  BootstrapPairMetrics,
} from './adjustTypes';
import type {
  DatumSufficiencyReport,
  Observation,
  StationId,
} from '../types';

export abstract class LSAEngineBootstrapMethods extends LSAEngineGpsMethods {
  protected stationHasBootstrapableApprox(stationId: StationId): boolean {
    return stationHasBootstrapableApproxHelper(this.stations, stationId);
  }

  protected buildBootstrapPairMetrics(
    activeObservations: Observation[],
  ): Map<string, BootstrapPairMetrics> {
    return buildBootstrapPairMetricsHelper(activeObservations);
  }

  protected applyBootstrapApproxStation(
    stationId: StationId,
    seed: { x: number; y: number; h?: number },
  ): boolean {
    return applyBootstrapApproxStationHelper({
      coordSystemMode: this.coordSystemMode,
      seed,
      stationFactorSnapshot: (id) => this.stationFactorSnapshot(id),
      stationGeodetic: (id) => this.stationGeodetic(id),
      stationId,
      stations: this.stations,
    });
  }

  protected estimateBootstrapSetOrientation(
    set: BootstrapDirectionSet,
    pairMetrics: Map<string, BootstrapPairMetrics>,
  ): number | null {
    return estimateBootstrapSetOrientationHelper({ pairMetrics, set, stations: this.stations });
  }

  protected tryBootstrapDirectionSetOccupy(
    set: BootstrapDirectionSet,
    pairMetrics: Map<string, BootstrapPairMetrics>,
  ): { x: number; y: number; h?: number; orientation: number } | null {
    return tryBootstrapDirectionSetOccupyHelper({ pairMetrics, set, stations: this.stations });
  }

  protected bootstrapApproximateTraverseCoords(activeObservations: Observation[]): void {
    bootstrapApproximateTraverseCoordsHelper({
      activeObservations,
      applyBootstrapApproxStationFn: (stationId, seed) =>
        this.applyBootstrapApproxStation(stationId, seed),
      log: this.log.bind(this),
      stations: this.stations,
    });
  }

  protected projectWeakFloatZenithLeafStationsForDisplay(options?: { log?: boolean }): void {
    const activeObservations = this.collectActiveObservations();
    const projected = projectWeakFloatZenithLeafStations({
      is2D: this.is2D,
      activeObservations,
      stations: this.stations,
      coordSystemMode: this.coordSystemMode,
      stationGeodetic: this.stationGeodetic.bind(this),
      stationFactorSnapshot: this.stationFactorSnapshot.bind(this),
    });
    if (projected.length > 0) {
      this.clearGeometryCache();
      if (options?.log ?? true) {
        this.logs.push(
          `Float-zenith leaf projection applied for display coordinates: ${projected.join(', ')}`,
        );
      }
    }
  }

  protected evaluateGridInputGate(activeObservations: Observation[]): {
    blocked: boolean;
    reasons: string[];
    suggestions: string[];
  } {
    if (this.coordSystemMode !== 'grid') {
      return { blocked: false, reasons: [], suggestions: [] };
    }
    return evaluateGridInputGateHelper({
      activeObservations,
      crsId: this.crsId,
      gnssFrameConfirmed: this.gnssFrameConfirmed,
      parseState: this.parseState,
      stations: this.stations,
    });
  }

  protected evaluateDatumSufficiency(
    activeObservations: Observation[],
  ): DatumSufficiencyReport {
    return evaluateDatumSufficiencyHelper({
      activeObservations,
      is2D: this.is2D,
      stations: this.stations,
    });
  }
}
