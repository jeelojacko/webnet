/**
 * Phase 12G — original synthetic static-GNSS sample network.
 *
 * Clearly synthetic ECEF fixtures (SYN_ stations, SYNTH- frame tags) for
 * workspace demos and structural tests: 1 fixed + 5 free stations,
 * correlated 3x3 covariances, one repeated vector (independent solutions).
 * Structural expectations only — backend goldens own all numerics.
 */
import type { StationMap } from '../types';
import type {
  GnssBaselineCovariance,
  GnssBaselineObservation,
} from './gnssBaselineTypes';
import type {
  GnssBaselineNetworkInput,
  GnssImportProvenance,
} from './gnssBaselineNetworkImport';

const SYN_ELLIPSOID = 'WGS84';

const correlated = (
  sx: number,
  sy: number,
  sz: number,
  rhoXY: number,
  rhoXZ: number,
  rhoYZ: number,
): GnssBaselineCovariance => ({
  xx: sx * sx,
  yy: sy * sy,
  zz: sz * sz,
  xy: rhoXY * sx * sy,
  xz: rhoXZ * sx * sz,
  yz: rhoYZ * sy * sz,
});

interface SyntheticVectorSpec {
  from: string;
  to: string;
  dx: number;
  dy: number;
  dz: number;
  covariance: GnssBaselineCovariance;
  solutionId: string;
  sessionId: string;
}

const VECTORS: SyntheticVectorSpec[] = [
  { from: 'SYN_A', to: 'SYN_B', dx: 1000.004, dy: 999.997, dz: 500.002, covariance: correlated(0.005, 0.005, 0.008, 0.3, 0.1, 0.2), solutionId: 'SYN-SOL-01', sessionId: 'SYN-DAY1-AM' },
  { from: 'SYN_B', to: 'SYN_C', dx: 1500.003, dy: 1499.998, dz: -699.995, covariance: correlated(0.006, 0.005, 0.009, 0.25, -0.1, 0.15), solutionId: 'SYN-SOL-02', sessionId: 'SYN-DAY1-AM' },
  { from: 'SYN_C', to: 'SYN_D', dx: -699.996, dy: 1500.005, dz: -1300.003, covariance: correlated(0.005, 0.007, 0.008, 0.2, 0.15, -0.2), solutionId: 'SYN-SOL-03', sessionId: 'SYN-DAY1-PM' },
  { from: 'SYN_D', to: 'SYN_E', dx: -1300.002, dy: -999.998, dz: 500.004, covariance: correlated(0.007, 0.006, 0.009, -0.15, 0.1, 0.25), solutionId: 'SYN-SOL-04', sessionId: 'SYN-DAY1-PM' },
  { from: 'SYN_E', to: 'SYN_F', dx: -999.997, dy: -1500.001, dz: 1199.998, covariance: correlated(0.006, 0.006, 0.01, 0.3, 0.2, 0.1), solutionId: 'SYN-SOL-05', sessionId: 'SYN-DAY2-AM' },
  { from: 'SYN_F', to: 'SYN_A', dx: 499.998, dy: -1500.003, dz: -199.996, covariance: correlated(0.006, 0.005, 0.009, 0.2, -0.15, 0.1), solutionId: 'SYN-SOL-06', sessionId: 'SYN-DAY2-AM' },
  { from: 'SYN_A', to: 'SYN_C', dx: 2500.006, dy: 2499.995, dz: -199.997, covariance: correlated(0.008, 0.008, 0.012, 0.2, 0.1, 0.3), solutionId: 'SYN-SOL-07', sessionId: 'SYN-DAY2-AM' },
  { from: 'SYN_A', to: 'SYN_B', dx: 1000.001, dy: 1000.002, dz: 499.999, covariance: correlated(0.004, 0.004, 0.007, 0.35, 0.15, 0.2), solutionId: 'SYN-SOL-08', sessionId: 'SYN-DAY2-PM' },
];

const STATION_COORDS: Array<{ id: string; x: number; y: number; z: number; fixed: boolean }> = [
  { id: 'SYN_A', x: 4020000, y: 500000, z: 4900000, fixed: true },
  { id: 'SYN_B', x: 4021000, y: 501000, z: 4900500, fixed: false },
  { id: 'SYN_C', x: 4022500, y: 502500, z: 4899800, fixed: false },
  { id: 'SYN_D', x: 4021800, y: 504000, z: 4898500, fixed: false },
  { id: 'SYN_E', x: 4020500, y: 503000, z: 4899000, fixed: false },
  { id: 'SYN_F', x: 4019500, y: 501500, z: 4900200, fixed: false },
];

/**
 * Structural contract: 6 stations, 1 fixed, 8 baselines (closed ring +
 * diagonal + one repeated vector), 24 equations, 15 unknowns, DOF 9.
 * Every free station has degree >= 2: degree-1 spurs carry zero
 * redundancy and trip the backend Qvv PSD gate, so the ring closes.
 */
export const GNSS_SAMPLE_EXPECTATIONS = {
  stationCount: 6,
  fixedStationCount: 1,
  baselineCount: 8,
  equationCount: 24,
  unknownCount: 15,
  degreesOfFreedom: 9,
} as const;

/** Build the synthetic sample network (fresh objects per call). */
export const buildGnssSampleNetwork = (): GnssBaselineNetworkInput => {
  const stations: StationMap = {};
  STATION_COORDS.forEach((station) => {
    stations[station.id] = {
      x: station.x,
      y: station.y,
      h: station.z,
      fixed: station.fixed,
      fixedX: station.fixed,
      fixedY: station.fixed,
      fixedH: station.fixed,
    };
  });
  const baselines: GnssBaselineObservation[] = VECTORS.map((spec, index) => ({
    type: 'gnssBaseline' as const,
    id: index + 1,
    from: spec.from,
    to: spec.to,
    vector: { x: spec.dx, y: spec.dy, z: spec.dz },
    covariance: { ...spec.covariance },
    frame: 'ecef' as const,
    referenceFrame: 'SYNTH-WGS84(G2139)',
    epoch: '2026.0',
    ellipsoid: SYN_ELLIPSOID,
    sessionId: spec.sessionId,
    solutionId: spec.solutionId,
    sourceFile: 'synthetic-sample',
  }));
  const provenance: GnssImportProvenance[] = VECTORS.map((spec, index) => ({
    baselineId: index + 1,
    line: index + 1,
    originalVector: { x: spec.dx, y: spec.dy, z: spec.dz },
    originalUnits: 'm',
    stochasticForm: 'SIGCORR' as const,
    inputFrame: 'ecef' as const,
    rotationApplied: false,
    canonicalVector: { x: spec.dx, y: spec.dy, z: spec.dz },
    canonicalCovariance: { ...spec.covariance },
  }));
  return {
    stations,
    baselines,
    frame: {
      vectorFrame: 'ecef',
      referenceFrame: 'SYNTH-WGS84(G2139)',
      epoch: '2026.0',
      ellipsoid: SYN_ELLIPSOID,
    },
    inputUnits: 'm',
    provenance,
    sourceFile: 'synthetic-sample',
  };
};
