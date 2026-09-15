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

/**
 * Deterministic code-unit comparator (UTF-16 `<`/`>`), local to this
 * module. Station/sideshot canonicalization must not depend on the
 * runtime locale: `String.localeCompare` with `numeric: true` orders
 * e.g. `P2` before `P10` and folds case per locale, so the same result
 * could hash differently across environments. Code-unit order is stable
 * everywhere. Deliberately local — shared `buildValueFingerprint` is
 * untouched.
 */
const compareCodeUnits = (a: string, b: string): number => {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
};

const num = (value: number | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const buildAdjustmentResultFingerprint = (result: AdjustmentResult): string => {
  const stations = Object.entries(result.stations ?? {})
    .sort(([a], [b]) => compareCodeUnits(a, b))
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
      compareCodeUnits(a.from, b.from)
      || compareCodeUnits(a.to, b.to)
      || compareCodeUnits(a.id, b.id));
  return buildValueFingerprint({
    version: ADJUSTMENT_RESULT_FINGERPRINT_VERSION,
    coordMode: result.parseState?.coordMode ?? null,
    stations,
    sideshots,
  });
};
