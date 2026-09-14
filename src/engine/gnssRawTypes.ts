/**
 * Phase 12J.4 — raw static-GNSS baseline review object contract.
 *
 * Production boundary: RINEX files -> browser Worker -> pinned RTKLIB/WASM
 * -> ProcessedRawGnssBaseline -> review/export. This object is NOT a
 * solve observation and MUST NOT automatically enter solve state.
 * Covariance is the processor's formal internal precision, uncalibrated.
 */

import type { GnssBaselineCovariance } from './gnssBaselineTypes';

/** The ONLY accepted endpoint reference semantic. Never guess. */
export const MARKER_TO_MARKER_ECEF = 'MARKER_TO_MARKER_ECEF' as const;

/** Pinned processor identity (Phase 12J.1-3 certification). */
export const GNSS_RAW_PROCESSOR_ID = 'rnx2rtkp 2.5.1 @62d4677' as const;

/** Ambiguity outcome straight from the processor. */
export type RawGnssSolutionStatus = 'FIXED' | 'FLOAT' | 'FAILED';

/**
 * Review classification. Separate from solution status: FIXED means the
 * processor fixed ambiguities, NOT that the baseline is good enough.
 */
export type RawGnssAcceptanceStatus =
  | 'PROCESSING_ACCEPTED'
  | 'PROCESSING_WARNING'
  | 'PROCESSING_REJECTED';

/** Covariance model is always the processor's formal estimate in this MVP. */
export interface RawGnssCovarianceAssessment {
  readonly model: 'RTKLIB_FORMAL';
  readonly calibration: 'UNCALIBRATED';
  readonly status: 'FORMAL_UNCALIBRATED';
  readonly finite: boolean;
  readonly spd: boolean;
}

/** Per-endpoint antenna calibration coverage. No fuzzy fallback. */
export type RawGnssAntennaCalibrationStatus =
  | 'CALIBRATION_EXACT'
  | 'CALIBRATION_EXPLICIT_MAPPING'
  | 'CALIBRATION_UNAVAILABLE'
  | 'ANTENNA_UNKNOWN';

export interface RawGnssEndpointAntenna {
  /** Marker name from RINEX header. */
  readonly marker: string;
  /** Antenna model + radome as written in RINEX, '' when absent. */
  readonly model: string;
  readonly calibration: RawGnssAntennaCalibrationStatus;
  /** Physical antenna height/offset from RINEX header (m). */
  readonly height: number;
  readonly east: number;
  readonly north: number;
}

export interface RawGnssAntennaAssessment {
  readonly base: RawGnssEndpointAntenna;
  readonly rover: RawGnssEndpointAntenna;
  /** FULL when both ends exact/mapped, PARTIAL when one end, NONE otherwise. */
  readonly overall: 'FULL' | 'PARTIAL' | 'NONE';
  /** Generic warning when any end lacks calibration (never dataset-specific). */
  readonly warning: string | null;
}

/** Structured, user-facing processing failures. No raw numeric codes. */
export type RawGnssProcessingErrorCode =
  | 'INVALID_RINEX'
  | 'UNSUPPORTED_RINEX'
  | 'NO_GPS_OBSERVATIONS'
  | 'NO_DUAL_FREQUENCY'
  | 'NO_COMMON_TIME'
  | 'MISSING_NAV'
  | 'NAV_COVERAGE_MISSING'
  | 'PRECISE_PRODUCT_MISSING'
  | 'PRECISE_PRODUCT_INVALID'
  | 'INVALID_COVARIANCE'
  | 'PROCESSOR_FAILURE'
  | 'MEMORY_OR_SIZE_LIMIT';

export interface RawGnssProcessingError {
  readonly code: RawGnssProcessingErrorCode;
  /** User-facing sentence. */
  readonly message: string;
  /** Advanced detail (processor lines, counts). Never the primary UI. */
  readonly detail?: string;
}

/** Parsed RINEX header facts shown before processing. */
export interface RawGnssFileMetadata {
  readonly role: 'BASE' | 'ROVER' | 'NAV' | 'SP3';
  readonly fileName: string;
  readonly sha256: string;
  readonly rinexVersion: string | null;
  readonly marker: string | null;
  readonly approxXyz: [number, number, number] | null;
  readonly antennaModel: string;
  readonly antennaHeight: number | null;
  readonly antennaEast: number | null;
  readonly antennaNorth: number | null;
  readonly receiverModel: string | null;
  readonly firstEpoch: string | null;
  readonly lastEpoch: string | null;
  readonly intervalSeconds: number | null;
  readonly constellations: string[];
  readonly signals: string[];
}

export interface RawGnssProcessingOptions {
  readonly elevationMaskDegrees: number;
  /** Requested interval; 'AUTO' derives from common epochs. */
  readonly intervalRequested: number | 'AUTO';
  readonly ephemerisRequested: 'BROADCAST' | 'PRECISE';
  readonly windowStart: string | null;
  readonly windowStop: string | null;
}

export interface RawGnssProvenance {
  readonly processor: typeof GNSS_RAW_PROCESSOR_ID;
  readonly emccVersion: string;
  readonly compileFlags: string[];
  readonly baseObsSha256: string;
  readonly roverObsSha256: string;
  readonly navSha256: string[];
  readonly sp3Sha256: string | null;
  readonly optionsHash: string;
  readonly intervalRequested: number | 'AUTO';
  readonly intervalResolved: number;
  readonly elevationMaskResolved: number;
  readonly ephemerisRequested: 'BROADCAST' | 'PRECISE';
  readonly ephemerisUsed: 'BROADCAST' | 'PRECISE';
  readonly processedAt: string;
}

export interface RawGnssQuality {
  readonly ratio: number | null;
  readonly fixedEpochs: number | null;
  readonly usedEpochs: number;
  readonly satellites: number;
}

/**
 * Production review object. Authoritative export form is JSON of this.
 * coordinateReference is always MARKER_TO_MARKER_ECEF.
 */
export interface ProcessedRawGnssBaseline {
  readonly status: RawGnssSolutionStatus;
  readonly acceptance: RawGnssAcceptanceStatus;
  readonly acceptanceNotes: string[];
  readonly from: string;
  readonly to: string;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly baselineLength: number;
  readonly covariance: GnssBaselineCovariance;
  readonly covarianceAssessment: RawGnssCovarianceAssessment;
  readonly coordinateReference: typeof MARKER_TO_MARKER_ECEF;
  /** Source frame label; never inherited from project CRS. */
  readonly referenceFrame: string;
  readonly start: string;
  readonly stop: string;
  readonly solutionQuality: RawGnssQuality;
  readonly antennaAssessment: RawGnssAntennaAssessment;
  readonly provenance: RawGnssProvenance;
  readonly diagnostics: string[];
}

/** User-facing formal-precision wording (single source of truth). */
export const FORMAL_PRECISION_NOTICE =
  'Formal precision. This covariance is the processor\'s internal formal ' +
  'precision estimate. It has not yet been calibrated as survey-network ' +
  'weighting and may be optimistic.';

/** Generic no-calibration warning (never dataset-specific). */
export const NO_CALIBRATION_WARNING =
  'No authoritative antenna calibration was resolved for this endpoint. ' +
  'The processed vector may contain unmodelled antenna phase-center effects.';
