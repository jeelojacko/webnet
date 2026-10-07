/**
 * CAD Draw Phase L1 — line-construction types, result envelope, and the
 * canonical line floor.
 *
 * These modules are pure (no React, no workspace state): parsers turn operator
 * text into structured values, resolvers turn structured values into world
 * points, and the batch builder turns ordered endpoint pairs into first-class
 * `CadLineEntity` values. Session/ribbon wiring is owned elsewhere.
 */
import type { CadWorldPoint } from './cadGeometry';
import type { CadEntityId, CadLineEntity } from './cadTypes';

/**
 * Canonical degenerate-line floor for CAD Draw Phase L1.
 *
 * Mirrors the per-axis guard already used by the plain `LINE` transaction
 * (1e-9 on BOTH `|dx|` and `|dy|`), so single-segment modes routed through the
 * shared batch builder stay byte-for-byte backward compatible. Per-axis (not
 * euclidean) is deliberate: it is the existing contract, not a new epsilon.
 */
export const CAD_LINE_DEGENERATE_FLOOR = 1e-9;

export type CadLineConstructionErrorCode =
  | 'INVALID_INPUT'
  | 'NON_FINITE'
  | 'DEGENERATE'
  | 'DISTANCE_OUT_OF_RANGE'
  | 'ANGLE_OUT_OF_RANGE'
  | 'AMBIGUOUS_POINT'
  | 'AMBIGUOUS_ENDPOINT'
  | 'POINT_NOT_FOUND'
  | 'POINT_RANGE_TOO_SHORT'
  | 'POINT_RANGE_DUPLICATE'
  | 'POINT_RANGE_TOO_LARGE'
  | 'POINT_RANGE_UNSAFE_INTEGER'
  | 'OUT_OF_RANGE'
  | 'ENTITY_NOT_FOUND'
  | 'ENTITY_TYPE_UNSUPPORTED'
  | 'ENTITY_NOT_EDITABLE'
  | 'CLOSED_SOURCE_UNSUPPORTED'
  | 'OFF_SWEEP'
  | 'NO_SOLUTION'
  | 'NO_DRAWING_GRID_CONTEXT'
  | 'GRID_NE_OUT_OF_CRS'
  | 'LATLONG_OUT_OF_RANGE'
  | 'CRS_TRANSFORM_FAILED';

export interface CadLineError {
  code: CadLineConstructionErrorCode;
  message: string;
}

export type CadLineResult<T> = { ok: true; value: T } | { ok: false; error: CadLineError };

export const cadLineOk = <T>(value: T): CadLineResult<T> => ({ ok: true, value });

export const cadLineFail = (
  code: CadLineConstructionErrorCode,
  message: string,
): CadLineResult<never> => ({ ok: false, error: { code, message } });

/** A labelled world point used as a constructed line endpoint. */
export interface CadLinePointInput extends CadWorldPoint {
  label: string;
}

export interface CadLineSegmentInput {
  start: CadLinePointInput;
  end: CadLinePointInput;
}

export type CadLineSide = 'left' | 'right';

/** Ordered, validated point chain used while drafting (never mutated in place). */
export interface CadLineChainDraft {
  points: CadLinePointInput[];
}

/** Direction-mode tag for a side shot fired from a fixed occupy. */
export type CadLineSideShotMode = 'bearing' | 'azimuth' | 'turn' | 'deflection';

export interface CadLineSideShot {
  mode: CadLineSideShotMode;
  /** Bearing text (bearing mode only). */
  bearing?: string;
  /** Decimal degrees (azimuth mode only). */
  azimuthDeg?: number;
  /** Relative turn/deflection side (turn/deflection modes only). */
  side?: CadLineSide;
  /** Relative turn/deflection angle in degrees (turn/deflection modes only). */
  angleDeg?: number;
  distance: number;
}

/** Result of the extension resolver: the edited line plus which end moved. */
export interface CadLineExtensionResult {
  entity: CadLineEntity;
  endpoint: 'from' | 'to';
  entityId: CadEntityId;
}
