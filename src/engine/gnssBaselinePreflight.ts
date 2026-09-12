/**
 * Phase 12B — GNSS-only ECEF datum/connectivity/frame preflight.
 *
 * Runs BEFORE any numerical solve. Every failure is a deterministic error
 * naming the affected stations/baselines; a rank-deficient network must be
 * refused here, never discovered later as a singular normal matrix.
 *
 * MVP policy (12A contract):
 * - GNSS-only: no terrestrial/gps/lev observations may be active.
 * - one fully fixed 3D station (fixedX + fixedY + fixedH) per connected
 *   component containing unknowns.
 * - all baselines + fixed control share one declared frame identity
 *   (frame kind, reference frame, epoch, ellipsoid); no transformation.
 * - no robust mode, no cross-baseline covariance, no stochastic control.
 */
import type { StationMap } from '../types';
import type { GnssBaselineObservation } from './gnssBaselineTypes';
import { gnssBaselineLabel } from './gnssBaselineEquationRows';
import { validateGnssBaselineCovariance } from './gnssBaselineCovariance';

export interface GnssBaselinePreflightInput {
  stations: StationMap;
  baselines: GnssBaselineObservation[];
  /** Declared session frame identity; every baseline/control must match. */
  referenceFrame?: string;
  epoch?: string;
  ellipsoid?: string;
}

const isFullyFixed = (stationId: string, stations: StationMap): boolean => {
  const station = stations[stationId];
  return !!station && !!station.fixedX && !!station.fixedY && !!station.fixedH;
};

const frameTag = (input: GnssBaselinePreflightInput): string =>
  `frame=${input.referenceFrame ?? 'ecef-default'} epoch=${input.epoch ?? 'unset'} ellipsoid=${input.ellipsoid ?? 'unset'}`;

/** Connected components over baseline edges (deterministic order). */
export const gnssBaselineComponents = (
  baselines: GnssBaselineObservation[],
): string[][] => {
  const adjacency = new Map<string, Set<string>>();
  const visit = (stationId: string): Set<string> => {
    let neighbors = adjacency.get(stationId);
    if (!neighbors) {
      neighbors = new Set<string>();
      adjacency.set(stationId, neighbors);
    }
    return neighbors;
  };
  const orderedStations: string[] = [];
  const note = (stationId: string): void => {
    visit(stationId);
    if (!orderedStations.includes(stationId)) orderedStations.push(stationId);
  };
  baselines.forEach((baseline) => {
    note(baseline.from);
    note(baseline.to);
    visit(baseline.from).add(baseline.to);
    visit(baseline.to).add(baseline.from);
  });
  const seen = new Set<string>();
  const components: string[][] = [];
  orderedStations.forEach((stationId) => {
    if (seen.has(stationId)) return;
    const component: string[] = [];
    const stack = [stationId];
    seen.add(stationId);
    while (stack.length > 0) {
      const current = stack.pop() as string;
      component.push(current);
      [...(adjacency.get(current) ?? [])]
        .sort()
        .forEach((neighbor) => {
          if (!seen.has(neighbor)) {
            seen.add(neighbor);
            stack.push(neighbor);
          }
        });
    }
    component.sort();
    components.push(component);
  });
  components.sort((left, right) => (left[0] ?? '').localeCompare(right[0] ?? ''));
  return components;
};

export const runGnssBaselinePreflight = (
  input: GnssBaselinePreflightInput,
): { components: string[][]; equationCount: number } => {
  const { stations, baselines } = input;
  if (baselines.length === 0) {
    throw new Error('GNSS baseline adjustment requires at least one baseline.');
  }
  const seenIds = new Set<number>();
  // Effective session frame: explicitly declared, else the unanimous
  // baseline value (baselines disagreeing with no session declaration is
  // itself a frame conflict). No transformation is ever performed.
  const unanimous = (pick: (_baseline: GnssBaselineObservation) => string | undefined): string | undefined => {
    const values = new Set(baselines.map(pick).map((value) => value ?? 'unset'));
    return values.size === 1 ? [...values][0] : undefined;
  };
  const sessionFrame = input.referenceFrame ?? unanimous((baseline) => baseline.referenceFrame);
  const sessionEpoch = input.epoch ?? unanimous((baseline) => baseline.epoch);
  const sessionEllipsoid = input.ellipsoid ?? unanimous((baseline) => baseline.ellipsoid);
  if (sessionFrame === undefined || sessionEpoch === undefined || sessionEllipsoid === undefined) {
    throw new Error(
      'GNSS baselines disagree on declared frame identity with no session frame: ' +
        `frame=${sessionFrame ?? 'CONFLICT'} epoch=${sessionEpoch ?? 'CONFLICT'} ellipsoid=${sessionEllipsoid ?? 'CONFLICT'}.`,
    );
  }
  baselines.forEach((baseline) => {
    const label = gnssBaselineLabel(baseline);
    if (baseline.frame !== 'ecef') {
      throw new Error(
        `GNSS baseline ${label} declares frame '${baseline.frame}': Phase 12B supports ECEF only.`,
      );
    }
    if (baseline.from === baseline.to) {
      throw new Error(`GNSS baseline ${label} is a self-baseline (from == to).`);
    }
    if (!stations[baseline.from]) {
      throw new Error(`GNSS baseline ${label} references missing FROM station '${baseline.from}'.`);
    }
    if (!stations[baseline.to]) {
      throw new Error(`GNSS baseline ${label} references missing TO station '${baseline.to}'.`);
    }
    if (seenIds.has(baseline.id)) {
      throw new Error(`Duplicate GNSS baseline id ${baseline.id} (${label}).`);
    }
    seenIds.add(baseline.id);
    const vector = baseline.vector;
    for (const [name, value] of [
      ['x', vector.x],
      ['y', vector.y],
      ['z', vector.z],
    ] as const) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error(`GNSS baseline ${label} has non-finite vector component ${name}.`);
      }
    }
    validateGnssBaselineCovariance(baseline.covariance, label);
    // Frame-identity consistency: exact match required, no transformation.
    if ((baseline.referenceFrame ?? 'unset') !== sessionFrame) {
      throw new Error(
        `GNSS baseline ${label} reference frame '${baseline.referenceFrame ?? 'unset'}' ` +
          `does not match session frame '${sessionFrame}'.`,
      );
    }
    if ((baseline.epoch ?? 'unset') !== sessionEpoch) {
      throw new Error(
        `GNSS baseline ${label} epoch '${baseline.epoch ?? 'unset'}' ` +
          `does not match session epoch '${sessionEpoch}'.`,
      );
    }
    if ((baseline.ellipsoid ?? 'unset') !== sessionEllipsoid) {
      throw new Error(
        `GNSS baseline ${label} ellipsoid '${baseline.ellipsoid ?? 'unset'}' ` +
          `does not match session ellipsoid '${sessionEllipsoid}'.`,
      );
    }
  });
  const components = gnssBaselineComponents(baselines);
  components.forEach((component) => {
    const fixedStations = component.filter((stationId) => isFullyFixed(stationId, stations));
    // A component is solvable only with at least one fully fixed 3D station.
    if (fixedStations.length === 0) {
      throw new Error(
        `GNSS baseline component [${component.join(', ')}] has no fully fixed 3D station ` +
          `(${frameTag(input)}): free-network adjustment is deferred; fix X/Y/Z of at least one station.`,
      );
    }
  });
  return { components, equationCount: 3 * baselines.length };
};
