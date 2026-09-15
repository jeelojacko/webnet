/**
 * Phase 13F Part A — canonical adjustment-result fingerprint.
 *
 * Identifies solved RESULT geometry (not inputs+settings). Inputs stay
 * covered by `inputFingerprint`, settings by `settingsFingerprint`; this
 * hash answers "did the solved coordinates change?" so F2F links stamp the
 * authoritative revision instead of the input composite.
 *
 * Algorithm: canonical JSON (sorted ids, finite-float repr) hashed with
 * FNV-1a, `fnv1a:` prefix — same convention as `buildValueFingerprint`
 * (reused directly, no second hash implementation).
 *
 * Included (geometry-material only):
 * - version tag (bumps the hash on canonicalization changes)
 * - dimensional mode (`result.parseState.coordMode`, when present)
 * - per station (sorted by id): x/y/h + fixed, fixedX/Y/H,
 *   constraintModeX/Y/H, lost
 * - per sideshot (sorted by from/to/id): from, to, mode,
 *   easting/northing/height
 *
 * Excluded (deliberately): success/converged/iterations/stats/seuw/dof,
 * observations + residuals/stdRes (inputs, covered by inputFingerprint),
 * covariances/ellipses/diagnostics, logs, timestamps, solve-timing and all
 * other runtime/presentation instrumentation. Two runs that solve identical
 * geometry under different QC instrumentation share one fingerprint.
 *
 * Float repr: `String(value)` round-trips doubles; `String(-0)` is `"0"`,
 * so -0/+0 canonicalize together. Non-finite coords hash as `null`
 * (fail-visible: a NaN station never collides with a solved one silently).
 */
import type { AdjustmentResult } from '../typesAdjustmentResult';
import { buildValueFingerprint } from './qaWorkflowSnapshots';

export const ADJUSTMENT_RESULT_FINGERPRINT_VERSION = 'adjustment-result/v1';

const num = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const buildAdjustmentResultFingerprint = (result: AdjustmentResult): string => {
  const stations = Object.entries(result.stations ?? {})
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([id, station]) => ({
      id,
      x: num(station.x),
      y: num(station.y),
      h: num(station.h),
      fixed: station.fixed === true,
      fixedX: station.fixedX === true,
      fixedY: station.fixedY === true,
      fixedH: station.fixedH === true,
      constraintModeX: station.constraintModeX ?? null,
      constraintModeY: station.constraintModeY ?? null,
      constraintModeH: station.constraintModeH ?? null,
      lost: station.lost === true,
    }));
  const sideshots = (result.sideshots ?? [])
    .map((shot) => ({
      id: shot.id,
      from: shot.from,
      to: shot.to,
      mode: shot.mode,
      easting: num(shot.easting),
      northing: num(shot.northing),
      height: num(shot.height),
    }))
    .sort((a, b) =>
      a.from.localeCompare(b.from, undefined, { numeric: true })
      || a.to.localeCompare(b.to, undefined, { numeric: true })
      || a.id.localeCompare(b.id, undefined, { numeric: true }));
  return buildValueFingerprint({
    version: ADJUSTMENT_RESULT_FINGERPRINT_VERSION,
    coordMode: result.parseState?.coordMode ?? null,
    stations,
    sideshots,
  });
};
