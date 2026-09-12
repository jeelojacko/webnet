/**
 * Phase 12B test-only builders: programmatic construction of GNSS baseline
 * sessions. No text syntax exists yet (12C owns BL/import); fixtures build
 * canonical observations directly.
 */
import type { StationMap } from '../../src/types';
import type {
  GnssBaselineCovariance,
  GnssBaselineObservation,
} from '../../src/engine/gnssBaselineTypes';

export interface TestStationSpec {
  id: string;
  x: number;
  y: number;
  z: number;
  fixed?: boolean;
}

export interface TestBaselineSpec {
  from: string;
  to: string;
  dx: number;
  dy: number;
  dz: number;
  covariance?: GnssBaselineCovariance;
  sessionId?: string;
  solutionId?: string;
  referenceFrame?: string;
  epoch?: string;
  ellipsoid?: string;
  frame?: 'ecef' | 'projectLocal' | string;
}

export const DEFAULT_ECEF_FRAME = 'ITRF2020@2020.0';

export const isotropicCovariance = (sigmaM: number): GnssBaselineCovariance => {
  const variance = sigmaM * sigmaM;
  return { xx: variance, xy: 0, xz: 0, yy: variance, yz: 0, zz: variance };
};

let nextBaselineId = 1;

export const resetBaselineIds = (): void => {
  nextBaselineId = 1;
};

export const buildStations = (specs: TestStationSpec[]): StationMap => {
  const stations: StationMap = {};
  specs.forEach((spec) => {
    stations[spec.id] = {
      x: spec.x,
      y: spec.y,
      h: spec.z,
      fixed: !!spec.fixed,
      fixedX: spec.fixed,
      fixedY: spec.fixed,
      fixedH: spec.fixed,
    };
  });
  return stations;
};

export const buildBaselines = (
  specs: TestBaselineSpec[],
  defaults?: { referenceFrame?: string; epoch?: string; ellipsoid?: string },
): GnssBaselineObservation[] =>
  specs.map((spec) => ({
    type: 'gnssBaseline' as const,
    id: nextBaselineId++,
    from: spec.from,
    to: spec.to,
    vector: { x: spec.dx, y: spec.dy, z: spec.dz },
    covariance: spec.covariance ?? isotropicCovariance(0.005),
    frame: (spec.frame ?? 'ecef') as 'ecef',
    referenceFrame: spec.referenceFrame ?? defaults?.referenceFrame ?? DEFAULT_ECEF_FRAME,
    epoch: spec.epoch ?? defaults?.epoch ?? '2020.0',
    ellipsoid: spec.ellipsoid ?? defaults?.ellipsoid ?? 'GRS80',
    sessionId: spec.sessionId,
    solutionId: spec.solutionId,
  }));

/** Baseline vector derived from endpoint coordinates (closing geometry). */
export const vectorBetween = (
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
): { dx: number; dy: number; dz: number } => ({
  dx: to.x - from.x,
  dy: to.y - from.y,
  dz: to.z - from.z,
});
