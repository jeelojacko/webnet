/**
 * Phase 7B.6 pure sparse geometry preflight (test-only, no routing).
 *
 * Derives static geometry facts from parsed/prepared network structures
 * (stations, observations, unknowns, solve-preparation counts) without
 * running any solve. The fail-closed preflight verdict rejects weak or
 * ambiguous geometry BEFORE any sparse result is accepted, so the known
 * weak-resection divergence (pivot-free sparse vs pivoted dense TS) can
 * never be silently admitted.
 *
 * No production routing, tolerance, or baseline changes.
 */
import type { Observation, StationMap } from '../typesObservations';
import type { StationId } from '../typesBase';
import {
  evaluateSparseProductionEligibility,
  type SparseProductionEligibility,
  type SparseProductionEligibilityInput,
} from './sparseProductionEligibility';

export interface SparseGeometryPreflightInput {
  stations: StationMap;
  observations: Observation[];
  unknowns: StationId[];
  /** True for 2D solves (lev/zenith excluded from equations). */
  is2D: boolean;
  /** Prepared counts from `buildSolvePreparation` (post auto-hold/drop). */
  numParams: number;
  numObsEquations: number;
  directionSetIds: string[];
}

export interface SparseGeometryFacts {
  stationCount: number;
  fixedControlCount: number;
  freeStationCount: number;
  unknownCount: number;
  equationCount: number;
  paramCount: number;
  /** Redundancy (degrees of freedom): equations minus parameters. */
  dof: number;
  directionSetupCount: number;
  hasMetricObservation: boolean;
  angularOnly: boolean;
  /** Connected components over the observation graph (station ids). */
  componentCount: number;
  largestComponentSize: number;
  isolatedFreeStations: StationId[];
  /** True when every equation ray leaves a single occupy (resection risk). */
  singleSetupResection: boolean;
  /** Free stations touched by fewer than 2 equations (under-observed). */
  underObservedFreeStations: StationId[];
}

export interface SparseGeometryPreflight {
  eligible: boolean;
  reasons: string[];
  facts: SparseGeometryFacts;
}

/** Fixed-order preflight gates so repeated evaluations are byte-identical. */
const collectObservationStations = (observation: Observation): StationId[] => {
  switch (observation.type) {
    case 'angle':
      return [observation.at, observation.from, observation.to];
    case 'direction':
      return [observation.at, observation.to];
    case 'dir':
    case 'dist':
    case 'bearing':
    case 'gps':
    case 'lev':
    case 'zenith':
      return [observation.from, observation.to];
    default:
      return [];
  }
};

const isMetricObservation = (observation: Observation, is2D: boolean): boolean => {
  if (observation.type === 'dist' || observation.type === 'gps') return true;
  if (observation.type === 'lev') return true;
  if (observation.type === 'zenith') return !is2D;
  return false;
};

const isActiveForPreflight = (observation: Observation, is2D: boolean): boolean => {
  if (observation.type === 'gps' && observation.gpsMode === 'sideshot') return false;
  if (is2D && (observation.type === 'lev' || observation.type === 'zenith')) return false;
  return true;
};

/** Derives deterministic static geometry facts (pure, no solve). */
export const deriveSparseGeometryFacts = (
  input: SparseGeometryPreflightInput,
): SparseGeometryFacts => {
  const stationIds = Object.keys(input.stations).sort();
  const fixedSet = new Set<StationId>();
  for (const id of stationIds) {
    const station = input.stations[id];
    if (station && (station.fixed || (station.fixedX && station.fixedY))) {
      fixedSet.add(id);
    }
  }
  const unknownSet = new Set(input.unknowns);
  const active = input.observations.filter((observation) =>
    isActiveForPreflight(observation, input.is2D),
  );
  const hasMetricObservation = active.some((observation) =>
    isMetricObservation(observation, input.is2D),
  );
  const equationCount = input.numObsEquations;
  const paramCount = input.numParams;

  // Connectivity over the observation graph (union-find, deterministic).
  const parent = new Map<StationId, StationId>();
  const find = (id: StationId): StationId => {
    let root = parent.get(id) ?? id;
    while (parent.get(root) !== root && parent.has(root)) {
      root = parent.get(root) as StationId;
    }
    return root;
  };
  for (const id of stationIds) parent.set(id, id);
  for (const observation of active) {
    const ends = collectObservationStations(observation).filter((id) => parent.has(id));
    for (let i = 1; i < ends.length; i += 1) {
      const left = find(ends[0] as StationId);
      const right = find(ends[i] as StationId);
      if (left !== right) parent.set(left, right);
    }
  }
  const components = new Map<StationId, StationId[]>();
  for (const id of stationIds) {
    const root = find(id);
    const members = components.get(root) ?? [];
    members.push(id);
    components.set(root, members);
  }
  let largestComponentSize = 0;
  for (const members of components.values()) {
    largestComponentSize = Math.max(largestComponentSize, members.length);
  }

  // Per-free-station equation coverage.
  const equationTouch = new Map<StationId, number>();
  for (const observation of active) {
    for (const id of collectObservationStations(observation)) {
      if (unknownSet.has(id)) {
        equationTouch.set(id, (equationTouch.get(id) ?? 0) + 1);
      }
    }
  }
  const underObservedFreeStations = [...unknownSet]
    .filter((id) => (equationTouch.get(id) ?? 0) < 2)
    .sort();
  const isolatedFreeStations = [...unknownSet]
    .filter((id) => (equationTouch.get(id) ?? 0) === 0)
    .sort();

  // Single-setup resection: every active equation involves one occupy
  // station and no metric leg is present.
  const occupies = new Set<StationId>();
  for (const observation of active) {
    if (observation.type === 'angle' || observation.type === 'direction') {
      occupies.add(observation.at);
    } else {
      occupies.add(observation.from);
    }
  }
  const singleSetupResection =
    active.length > 0 && occupies.size === 1 && !hasMetricObservation;

  return {
    stationCount: stationIds.length,
    fixedControlCount: fixedSet.size,
    freeStationCount: stationIds.length - fixedSet.size,
    unknownCount: input.unknowns.length,
    equationCount,
    paramCount,
    dof: equationCount - paramCount,
    directionSetupCount: input.directionSetIds.length,
    hasMetricObservation,
    angularOnly: active.length > 0 && !hasMetricObservation,
    componentCount: components.size,
    largestComponentSize,
    isolatedFreeStations,
    singleSetupResection,
    underObservedFreeStations,
  };
};

/**
 * Fail-closed static preflight. Every gate appends a reason in fixed order:
 * controls, unknowns, DOF, connectivity, angular-only/single-setup,
 * under-observed, direction setups.
 */
export const evaluateSparseGeometryPreflight = (
  input: SparseGeometryPreflightInput,
): SparseGeometryPreflight => {
  const facts = deriveSparseGeometryFacts(input);
  const reasons: string[] = [];
  if (facts.fixedControlCount < 2) {
    reasons.push(
      `weak control: ${facts.fixedControlCount} fixed stations (minimum 2 for sparse preflight)`,
    );
  }
  if (facts.unknownCount === 0) {
    reasons.push('no unknown stations to solve');
  }
  if (facts.dof < 1) {
    reasons.push(`no redundancy: dof=${facts.dof} (equations=${facts.equationCount}, params=${facts.paramCount})`);
  }
  if (facts.componentCount > 1 && facts.unknownCount > 0) {
    reasons.push(
      `disconnected network: ${facts.componentCount} components, largest=${facts.largestComponentSize}`,
    );
  }
  if (facts.isolatedFreeStations.length > 0) {
    reasons.push(`isolated free stations: ${facts.isolatedFreeStations.join(',')}`);
  }
  if (facts.singleSetupResection) {
    reasons.push('single-setup angular-only resection: weak geometry not cleared for sparse');
  } else if (facts.angularOnly) {
    reasons.push('angular-only network: no metric leg to stabilize sparse solve');
  }
  if (facts.underObservedFreeStations.length > 0) {
    reasons.push(
      `under-observed free stations: ${facts.underObservedFreeStations.join(',')}`,
    );
  }
  if (facts.directionSetupCount > 0 && !facts.hasMetricObservation) {
    reasons.push(
      `direction setups (${facts.directionSetupCount}) without metric observations`,
    );
  }
  return { eligible: reasons.length === 0, reasons, facts };
};

export interface SparsePreflightEligibility {
  eligible: boolean;
  reasons: string[];
  facts: SparseGeometryFacts;
  production: SparseProductionEligibility;
}

/**
 * Fail-closed integration: BOTH the static geometry preflight AND the
 * existing production eligibility classifier must clear. Production reasons
 * keep their deterministic order after preflight reasons.
 */
export const evaluateSparsePreflightEligibility = (
  geometry: SparseGeometryPreflightInput,
  production: SparseProductionEligibilityInput,
): SparsePreflightEligibility => {
  const preflight = evaluateSparseGeometryPreflight(geometry);
  const productionVerdict: SparseProductionEligibility =
    evaluateSparseProductionEligibility(production);
  const reasons = [...preflight.reasons, ...productionVerdict.reasons];
  return {
    eligible: reasons.length === 0,
    reasons,
    facts: preflight.facts,
    production: productionVerdict,
  };
};
