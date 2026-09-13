/**
 * Phase 12E.3 — production GNSS endpoint setup-uncertainty augmentation.
 *
 * Optional network-level stochastic model for tripod centering and antenna-
 * height setup error. Each baseline endpoint contributes an independent
 * local-ENU covariance C_local = diag(sc^2, sc^2, sh^2), rotated to ECEF
 * with that endpoint's OWN fixed local frame (never a shared import
 * origin, never iteration-dependent):
 *
 *   C_ecef(endpoint) = R(endpoint)^T . C_local . R(endpoint)
 *   C_eff            = C_raw + C_from + C_to
 *
 * Orientation frames are built ONCE from the a-priori input station ECEF
 * coordinates before iteration. Fixed (control) endpoints are augmented
 * exactly like free endpoints: control uncertainty is stochastic, not a
 * datum defect.
 *
 * IMPORT-shared-ENU vs SETUP-per-endpoint-ENU: the Phase 12C text import
 * rotates whole FILE vectors/covariances through ONE shared origin R.
 * This module instead builds one R PER ENDPOINT from that endpoint's own
 * position, because setup error is local (plumb/vertical at the tripod),
 * not a network-wide frame rotation. The two must never be confused.
 *
 * Raw covariance is preserved on each augmented observation
 * (`rawCovariance`); the effective covariance drives the solve weights.
 * Zero setup (absent, or both sigmas 0) returns the input observations
 * untouched — bitwise identical solve behavior, no new requirements.
 */
import type { StationMap } from '../types';
import { WGS84_A, WGS84_E2 } from './geodesyConstants';
import { validateGnssBaselineCovariance } from './gnssBaselineCovariance';
import {
  rotateEnuCovarianceToEcef,
  type Matrix3x3,
} from './gnssBaselineRotation';
import type {
  GnssBaselineCovariance,
  GnssBaselineObservation,
} from './gnssBaselineTypes';
import { gnssBaselineLabel } from './gnssBaselineEquationRows';

/**
 * Network-level endpoint setup uncertainty, metres, 1-sigma.
 * Generic names only — never processor/vendor field names.
 */
export interface GnssSetupUncertainty {
  readonly horizontalCenteringSigma?: number;
  readonly antennaHeightSigma?: number;
}

export interface NormalizedGnssSetupUncertainty {
  readonly horizontalCenteringSigma: number;
  readonly antennaHeightSigma: number;
}

/** Resolved setup model carried on adjust results and reports. */
export interface GnssSetupModel extends NormalizedGnssSetupUncertainty {
  readonly ellipsoid: string;
  /** Orientation convention; always this literal (provenance tag). */
  readonly orientation: 'independent-endpoint-local-ENU';
}

export interface GnssSetupContribution {
  readonly baselineId: number;
  readonly from: string;
  readonly to: string;
  readonly rawCovariance: GnssBaselineCovariance;
  /** Summed endpoint contribution C_from + C_to (ECEF, m^2). */
  readonly setupCovariance: GnssBaselineCovariance;
  readonly effectiveCovariance: GnssBaselineCovariance;
}

/** Ellipsoid tags accepted as orientation provenance (case-insensitive). */
const KNOWN_ELLIPSOIDS = new Set(['WGS84', 'GRS80']);

/** Validate + default a setup request. Throws pre-solve on bad sigma. */
export const normalizeGnssSetupUncertainty = (
  setup: GnssSetupUncertainty | undefined,
): NormalizedGnssSetupUncertainty => {
  const pick = (value: number | undefined, name: string): number => {
    const sigma = value ?? 0;
    if (typeof sigma !== 'number' || !Number.isFinite(sigma) || sigma < 0) {
      throw new Error(
        `Invalid GNSS setup uncertainty: ${name}=${String(value)} must be a finite number >= 0 m (1-sigma).`,
      );
    }
    return sigma;
  };
  return {
    horizontalCenteringSigma: pick(setup?.horizontalCenteringSigma, 'horizontalCenteringSigma'),
    antennaHeightSigma: pick(setup?.antennaHeightSigma, 'antennaHeightSigma'),
  };
};

/** True when at least one sigma is nonzero (augmentation required). */
export const isGnssSetupActive = (setup: NormalizedGnssSetupUncertainty): boolean =>
  setup.horizontalCenteringSigma > 0 || setup.antennaHeightSigma > 0;

/**
 * Closed-form Bowring ECEF -> geodetic (WGS84, radians out).
 * Orientation ONLY — no projections, no datum shifts. Throws fail-closed
 * on non-finite input or degenerate polar geometry (p == 0: ENU undefined).
 */
export const ecefToGeodeticLatLon = (
  x: number,
  y: number,
  z: number,
  label: string,
): { lat: number; lon: number } => {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`GNSS setup orientation failed for ${label}: a-priori ECEF coords are not finite.`);
  }
  const p = Math.hypot(x, y);
  if (!(p > 0)) {
    throw new Error(`GNSS setup orientation failed for ${label}: polar/degenerate ECEF position has no local ENU frame.`);
  }
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  for (let i = 0; i < 4; i += 1) {
    const sin = Math.sin(lat);
    const prime = WGS84_A / Math.sqrt(1 - WGS84_E2 * sin * sin);
    lat = Math.atan2(z + WGS84_E2 * prime * sin, p);
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error(`GNSS setup orientation failed for ${label}: non-finite geodetic result.`);
  }
  return { lat, lon };
};

/**
 * ECEF -> ENU rotation from geodetic radians. Same convention as
 * Phase 12A/12C `buildEnuRotation` (rows are E/N/U in X/Y/Z); takes
 * radians directly so endpoint orientation never round-trips degrees.
 */
export const buildSetupEndpointRotation = (lat: number, lon: number): Matrix3x3 => {
  const sinPhi = Math.sin(lat);
  const cosPhi = Math.cos(lat);
  const sinLambda = Math.sin(lon);
  const cosLambda = Math.cos(lon);
  return [
    [-sinLambda, cosLambda, 0],
    [-sinPhi * cosLambda, -sinPhi * sinLambda, cosPhi],
    [cosPhi * cosLambda, cosPhi * sinLambda, sinPhi],
  ];
};

/** One endpoint's setup covariance in ECEF (m^2). */
export const setupEndpointCovariance = (
  x: number,
  y: number,
  z: number,
  setup: NormalizedGnssSetupUncertainty,
  label: string,
): GnssBaselineCovariance => {
  const { lat, lon } = ecefToGeodeticLatLon(x, y, z, label);
  const rotation = buildSetupEndpointRotation(lat, lon);
  const sc2 = setup.horizontalCenteringSigma * setup.horizontalCenteringSigma;
  const sh2 = setup.antennaHeightSigma * setup.antennaHeightSigma;
  return rotateEnuCovarianceToEcef(rotation, { xx: sc2, xy: 0, xz: 0, yy: sc2, yz: 0, zz: sh2 });
};

const addCovariance = (
  a: GnssBaselineCovariance,
  b: GnssBaselineCovariance,
): GnssBaselineCovariance => ({
  xx: a.xx + b.xx,
  xy: a.xy + b.xy,
  xz: a.xz + b.xz,
  yy: a.yy + b.yy,
  yz: a.yz + b.yz,
  zz: a.zz + b.zz,
});

/** Clean an ellipsoid tag: empty/'unset' counts as missing. */
const cleanEllipsoidTag = (value: string | undefined): string | undefined => {
  const trimmed = (value ?? '').trim();
  return trimmed === '' || trimmed.toLowerCase() === 'unset' ? undefined : trimmed;
};

/**
 * Resolve the effective ellipsoid tag (session, else unanimous baseline).
 * Missing/conflicting tags yield undefined — never silently oriented.
 */
export const resolveSetupEllipsoid = (
  sessionEllipsoid: string | undefined,
  baselines: readonly GnssBaselineObservation[],
): string | undefined => {
  const session = cleanEllipsoidTag(sessionEllipsoid);
  if (session) return session;
  const tags = new Set(baselines.map((baseline) => cleanEllipsoidTag(baseline.ellipsoid) ?? 'unset'));
  if (tags.size === 1 && !tags.has('unset')) return [...tags][0];
  return undefined;
};

export interface ApplyGnssSetupInput {
  stations: StationMap;
  baselines: GnssBaselineObservation[];
  setup: GnssSetupUncertainty | undefined;
  ellipsoid: string | undefined;
}

export interface ApplyGnssSetupResult {
  /** Effective observations (untouched refs when setup is inactive). */
  baselines: GnssBaselineObservation[];
  /** Null when setup is inactive (zero adds no new requirement). */
  setupModel: GnssSetupModel | null;
  contributions: GnssSetupContribution[];
}

/**
 * Augment raw covariances with per-endpoint setup error, once, from the
 * a-priori station coordinates. Throws pre-solve (never mid-iteration):
 * invalid sigma, missing/unrecognized ellipsoid with active setup,
 * missing/non-finite endpoint coords, orientation failure, non-finite or
 * non-SPD effective covariance (existing SPD gate, no jitter repair).
 */
export const applyGnssSetupUncertainty = (input: ApplyGnssSetupInput): ApplyGnssSetupResult => {
  const normalized = normalizeGnssSetupUncertainty(input.setup);
  if (!isGnssSetupActive(normalized)) {
    return { baselines: input.baselines, setupModel: null, contributions: [] };
  }
  const ellipsoid = resolveSetupEllipsoid(input.ellipsoid, input.baselines);
  if (!ellipsoid) {
    throw new Error(
      'Invalid GNSS setup uncertainty: nonzero setup requires a declared ellipsoid for endpoint orientation ' +
        '(session or unanimous baseline tag); none is present.',
    );
  }
  if (!KNOWN_ELLIPSOIDS.has(ellipsoid.toUpperCase())) {
    throw new Error(
      `Invalid GNSS setup uncertainty: unrecognized ellipsoid '${ellipsoid}' for endpoint orientation ` +
        '(supported: WGS84, GRS80).',
    );
  }
  const contributions: GnssSetupContribution[] = [];
  const baselines = input.baselines.map((baseline) => {
    const label = gnssBaselineLabel(baseline);
    const fromStation = input.stations[baseline.from];
    const toStation = input.stations[baseline.to];
    if (!fromStation || !toStation) {
      throw new Error(`GNSS setup orientation failed for ${label}: missing endpoint station coords.`);
    }
    const fromC = setupEndpointCovariance(
      fromStation.x, fromStation.y, fromStation.h, normalized, `FROM ${label}`,
    );
    const toC = setupEndpointCovariance(
      toStation.x, toStation.y, toStation.h, normalized, `TO ${label}`,
    );
    const setupCovariance = addCovariance(fromC, toC);
    const effectiveCovariance = addCovariance(baseline.covariance, setupCovariance);
    for (const value of Object.values(effectiveCovariance)) {
      if (!Number.isFinite(value)) {
        throw new Error(`GNSS setup augmentation failed for ${label}: non-finite effective covariance.`);
      }
    }
    validateGnssBaselineCovariance(effectiveCovariance, `${label} (setup-augmented)`);
    contributions.push({
      baselineId: baseline.id,
      from: baseline.from,
      to: baseline.to,
      rawCovariance: { ...baseline.covariance },
      setupCovariance,
      effectiveCovariance: { ...effectiveCovariance },
    });
    return {
      ...baseline,
      covariance: effectiveCovariance,
      rawCovariance: { ...baseline.covariance },
      // Declare the run's ellipsoid on tagless effective observations so
      // the downstream frame-identity gate sees the operator's explicit
      // declaration. Present tags are never overwritten: a conflicting
      // tag still fails closed at preflight, as before.
      ellipsoid: cleanEllipsoidTag(baseline.ellipsoid) ?? ellipsoid,
    };
  });
  return {
    baselines,
    setupModel: {
      horizontalCenteringSigma: normalized.horizontalCenteringSigma,
      antennaHeightSigma: normalized.antennaHeightSigma,
      ellipsoid,
      orientation: 'independent-endpoint-local-ENU',
    },
    contributions,
  };
};

export interface GnssSetupReadinessProblem {
  code: string;
  message: string;
}

/**
 * Non-throwing import-stage data-check for a setup request. Mirrors the
 * throwing apply-path gates so bad sigma / missing ellipsoid / orientation
 * failure / non-finite C_eff surface without requiring a full solve.
 */
export const checkGnssSetupReadiness = (input: ApplyGnssSetupInput): GnssSetupReadinessProblem[] => {
  try {
    applyGnssSetupUncertainty(input);
    return [];
  } catch (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    if (/must be a finite number/.test(message)) {
      return [{ code: 'GNSS_BAD_SETUP_SIGMA', message }];
    }
    if (/requires a declared ellipsoid/.test(message)) {
      return [{ code: 'GNSS_SETUP_MISSING_ELLIPSOID', message }];
    }
    if (/unrecognized ellipsoid/.test(message)) {
      return [{ code: 'GNSS_SETUP_UNKNOWN_ELLIPSOID', message }];
    }
    if (/orientation failed/.test(message)) {
      return [{ code: 'GNSS_SETUP_ORIENTATION_FAILURE', message }];
    }
    return [{ code: 'GNSS_SETUP_AUGMENT_FAILURE', message }];
  }
};
