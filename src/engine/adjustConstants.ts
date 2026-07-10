import { DEG_TO_RAD } from './angles';

export const EPS = 1e-10;
export const EARTH_RADIUS_M = 6378137;
export const GPS_ADDHIHT_SCALE_TOL = 1e-9;
export const GPS_LOOP_BASE_TOLERANCE_M = 0.02;
export const GPS_LOOP_TOLERANCE_PPM = 50;
export const LEVEL_LOOP_DEFAULT_BASE_MM = 0;
export const LEVEL_LOOP_DEFAULT_PER_SQRT_KM_MM = 4;
export const INDUSTRY_PARITY_ANGULAR_SIGMA_SCALE = 1.0001;
export const FLOAT_ZENITH_COVARIANCE_SIGMA_SEC = 1e8;
export const ARCSEC_TO_RAD = DEG_TO_RAD / 3600;
export const DATA_CHECK_PROVISIONAL_DIRECTION_TRUST_MAX_RAD = (5 / 60) * DEG_TO_RAD;
