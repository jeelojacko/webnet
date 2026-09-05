/**
 * Phase 7B.7 deterministic corpus perturbations (test-only, no routing).
 *
 * Pure string-level input transforms used to expand the Phase 7B.6
 * adversarial corpus toward actual-worker closure:
 *
 * - `dopeResectionWithDistances` — adds metric `D` legs to an angular-only
 *   resection so the static preflight can clear a previously weak case.
 * - `shiftFreeStartCoords` — deterministically shifts every non-fixed `C`
 *   start coordinate by (deltaN, deltaE) metres; topology and truth are
 *   untouched, only the solver start point moves.
 * - `addExtraDistanceLeg` — appends one metric cross-tie (topology change).
 *
 * All helpers are byte-deterministic: same input plus same arguments always
 * yields the same output. No production routing, tolerance, or baseline
 * changes.
 */

export interface Phase7b7MetricLeg {
  from: string;
  to: string;
  distanceM: number;
  /** Optional explicit distance sigma (m); omitted keeps the file default. */
  sigmaM?: number;
}

/** Plane distance between two (easting, northing) positions in metres. */
export const stationDistanceM = (
  eastingA: number,
  northingA: number,
  eastingB: number,
  northingB: number,
): number => Math.hypot(eastingA - eastingB, northingA - northingB);

/** Appends metric distance legs (`D from-to dist [sigma]`) to an input. */
export const dopeResectionWithDistances = (
  input: string,
  legs: Phase7b7MetricLeg[],
): string => {
  const trimmed = input.replace(/\s+$/, '');
  const records = legs.map((leg) =>
    leg.sigmaM == null
      ? `D ${leg.from}-${leg.to} ${leg.distanceM.toFixed(2)}`
      : `D ${leg.from}-${leg.to} ${leg.distanceM.toFixed(4)} ${leg.sigmaM.toFixed(4)}`,
  );
  return `${trimmed}\n\n# Phase 7B.7 metric doping (test-only)\n${records.join('\n')}\n`;
};

/**
 * Shifts every non-fixed `C` start coordinate by the given column deltas.
 * Fixed lines (carrying `!`) are left byte-identical; free-station lines
 * keep their shape with 6-decimal reserialization. Column semantics depend
 * on the file's `.ORDER` directive, so callers pass raw column deltas.
 */
export const shiftFreeStartCoords = (
  input: string,
  deltaSecond: number,
  deltaThird: number,
): string => {
  const pattern = /^(\s*C\s+\S+\s+)([+-]?(?:\d+(?:\.\d+)?|\.\d+))(\s+)([+-]?(?:\d+(?:\.\d+)?|\.\d+))(.*)$/;
  return input
    .split('\n')
    .map((line) => {
      const match = pattern.exec(line);
      if (!match) return line;
      const [, prefix, north, gap, east, rest] = match;
      if ((rest ?? '').includes('!')) return line;
      const shiftedSecond = Number(north) + deltaSecond;
      const shiftedThird = Number(east) + deltaThird;
      return `${prefix}${shiftedSecond.toFixed(6)}${gap}${shiftedThird.toFixed(6)}${rest}`;
    })
    .join('\n');
};

/** Appends a single metric cross-tie leg (deterministic topology change). */
export const addExtraDistanceLeg = (
  input: string,
  from: string,
  to: string,
  distanceM: number,
  sigmaM?: number,
): string => {
  const trimmed = input.replace(/\s+$/, '');
  const record =
    sigmaM == null
      ? `D ${from}-${to} ${distanceM.toFixed(2)}`
      : `D ${from}-${to} ${distanceM.toFixed(4)} ${sigmaM.toFixed(4)}`;
  return `${trimmed}\n\n# Phase 7B.7 extra geometry leg (test-only)\n${record}\n`;
};
