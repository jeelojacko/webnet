/**
 * Phase 12B — internal static GNSS baseline observation type.
 *
 * Mathematical core metadata only (adjustment frame, vector, covariance,
 * grouping identifiers). No processor-specific fields (TBC solution flags,
 * satellite counts, durations) belong here; those are importer/reporting
 * concerns for later phases.
 */
import type { StationId } from '../typesBase';

/** Solve frame kind. Only 'ecef' is implemented in Phase 12B. */
export type GnssAdjustmentFrameKind = 'ecef';

/** Upper-triangle symmetric 3x3 covariance in m^2. */
export interface GnssBaselineCovariance {
  xx: number;
  xy: number;
  xz: number;
  yy: number;
  yz: number;
  zz: number;
}

/** Baseline vector components in metres, in the declared frame. */
export interface GnssBaselineVector {
  x: number;
  y: number;
  z: number;
}

export interface GnssBaselineObservation {
  readonly type: 'gnssBaseline';
  /** Test/programmatic identifier; unique within a session when present. */
  readonly id: number;
  readonly from: StationId;
  readonly to: StationId;
  /** Observed vector b_obs = X_TO - X_FROM, metres. */
  readonly vector: GnssBaselineVector;
  /** Full symmetric 3x3 covariance, m^2. */
  readonly covariance: GnssBaselineCovariance;
  /** Internal coordinate frame of vector + covariance. */
  readonly frame: GnssAdjustmentFrameKind;
  /**
   * Declared reference-frame identity, e.g. 'ITRF2020@2020.0'.
   * Baselines and fixed control must agree exactly; no transformation
   * is performed in Phase 12B.
   */
  readonly referenceFrame?: string;
  /** Frame epoch tag, e.g. '2020.0'. Compared exactly when present. */
  readonly epoch?: string;
  /** Ellipsoid identity tag. Compared exactly when present. */
  readonly ellipsoid?: string;
  /** Grouping/reporting metadata only; never enters the mathematics. */
  readonly sessionId?: string;
  readonly solutionId?: string;
  readonly sourceLine?: number;
  readonly sourceFile?: string;
}

/** Discriminator guard; accepts any observation-shaped value. */
export const isGnssBaselineObservation = (
  observation: { type: string },
): observation is GnssBaselineObservation => observation.type === 'gnssBaseline';

export interface GnssBaselineResidual {
  vX: number;
  vY: number;
  vZ: number;
  /** Descriptive 3D magnitude; ignores correlation. */
  magnitude: number;
  /** Descriptive weighted contribution v^T P v; not a statistical test. */
  quadraticForm: number;
}
