/**
 * Phase 7B.6 geometry preflight tests (pure + parse-derived, no routing).
 *
 * Covers static fact derivation (fixed controls, unknowns, DOF,
 * connectivity, metric/angular-only, direction setups), fail-closed
 * preflight gates, and integration with the production eligibility
 * classifier. No solver, worker, WASM, or routing involved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  buildSolvePreparation,
  collectActiveObservationsForSolve,
} from '../src/engine/adjustmentPreprocessing';
import { parseInput } from '../src/engine/parseInputCore';
import {
  deriveSparseGeometryFacts,
  evaluateSparseGeometryPreflight,
  evaluateSparsePreflightEligibility,
  type SparseGeometryPreflightInput,
} from '../src/engine/sparseGeometryPreflight';
import type { StationMap } from '../src/typesObservations';

const readExample = (file: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'public/examples', file), 'utf-8');

const TRIANGULATION = readExample('ts_triangulation_trilateration_2d.dat');
const RESECTION = readExample('industry_resection_pillars.dat');

const toPreflightInput = (input: string): SparseGeometryPreflightInput => {
  const parsed = parseInput(input);
  const is2D = (parsed.parseState?.coordMode ?? '2D') === '2D';
  const active = collectActiveObservationsForSolve(parsed.observations, undefined, is2D);
  const prep = buildSolvePreparation(parsed.stations, parsed.unknowns, active, is2D);
  return {
    stations: parsed.stations,
    observations: parsed.observations,
    unknowns: parsed.unknowns,
    is2D,
    numParams: prep.numParams,
    numObsEquations: prep.numObsEquations,
    directionSetIds: prep.directionSetIds,
  };
};

const productionBase = {
  dimension: '2d' as const,
  unknownCount: 8,
  maxUnknownCount: 128,
  runMode: 'adjustment' as const,
  robustWeighting: false,
  tsCorrelation: false,
  gpsCovarianceWeighting: false,
  wasmAvailable: true,
  workerAvailable: true,
  rankRisk: 'none' as const,
};

describe('phase 7B.6 sparse geometry preflight', () => {
  it('derives connected metric facts for the triangulation fixture', () => {
    const facts = deriveSparseGeometryFacts(toPreflightInput(TRIANGULATION));
    expect(facts.fixedControlCount).toBeGreaterThanOrEqual(2);
    expect(facts.unknownCount).toBeGreaterThan(0);
    expect(facts.dof).toBeGreaterThan(0);
    expect(facts.dof).toBe(facts.equationCount - facts.paramCount);
    expect(facts.hasMetricObservation).toBe(true);
    expect(facts.angularOnly).toBe(false);
    expect(facts.singleSetupResection).toBe(false);
    expect(facts.componentCount).toBe(1);
    expect(facts.isolatedFreeStations).toEqual([]);
  });

  it('derives angular-only facts for the weak resection fixture', () => {
    const facts = deriveSparseGeometryFacts(toPreflightInput(RESECTION));
    expect(facts.fixedControlCount).toBeGreaterThanOrEqual(2);
    expect(facts.hasMetricObservation).toBe(false);
    expect(facts.angularOnly).toBe(true);
    expect(facts.directionSetupCount).toBeGreaterThan(0);
  });

  it('clears the triangulation preflight with no reasons', () => {
    const verdict = evaluateSparseGeometryPreflight(toPreflightInput(TRIANGULATION));
    expect(verdict.eligible).toBe(true);
    expect(verdict.reasons).toEqual([]);
  });

  it('rejects the weak resection before any sparse result', () => {
    const verdict = evaluateSparseGeometryPreflight(toPreflightInput(RESECTION));
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/angular-only|resection|direction setups/);
  });

  it('rejects weak control (fewer than 2 fixed stations)', () => {
    const parsed = parseInput(TRIANGULATION);
    const stations: StationMap = {};
    for (const [id, station] of Object.entries(parsed.stations)) {
      stations[id] = { ...station, fixed: false, fixedX: false, fixedY: false };
    }
    const firstId = Object.keys(stations).sort()[0] as string;
    stations[firstId] = { ...(stations[firstId] as object), fixed: true, fixedX: true, fixedY: true } as StationMap[string];
    const input: SparseGeometryPreflightInput = {
      stations,
      observations: parsed.observations,
      unknowns: parsed.unknowns,
      is2D: true,
      numParams: 4,
      numObsEquations: 10,
      directionSetIds: [],
    };
    const verdict = evaluateSparseGeometryPreflight(input);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/weak control/);
  });

  it('rejects zero unknowns and non-positive DOF', () => {
    const parsed = parseInput(TRIANGULATION);
    const noUnknowns: SparseGeometryPreflightInput = {
      stations: parsed.stations,
      observations: parsed.observations,
      unknowns: [],
      is2D: true,
      numParams: 0,
      numObsEquations: 0,
      directionSetIds: [],
    };
    const verdict = evaluateSparseGeometryPreflight(noUnknowns);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/no unknown stations/);
    expect(verdict.reasons.join(' ')).toMatch(/no redundancy/);
  });

  it('rejects a disconnected network with isolated free stations', () => {
    const parsed = parseInput(TRIANGULATION);
    const verdict = evaluateSparseGeometryPreflight({
      stations: parsed.stations,
      observations: [],
      unknowns: parsed.unknowns,
      is2D: true,
      numParams: 4,
      numObsEquations: 0,
      directionSetIds: [],
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/disconnected|isolated/);
  });

  it('flags a single-setup angular-only resection explicitly', () => {
    const parsed = parseInput(RESECTION);
    const singleSetup = parsed.observations.filter(
      (observation) =>
        observation.type === 'direction' &&
        (observation as { at?: string }).at === 'S1',
    );
    expect(singleSetup.length).toBeGreaterThan(0);
    const verdict = evaluateSparseGeometryPreflight({
      stations: parsed.stations,
      observations: singleSetup,
      unknowns: parsed.unknowns,
      is2D: true,
      numParams: 4,
      numObsEquations: singleSetup.length,
      directionSetIds: ['S1-set'],
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reasons.join(' ')).toMatch(/single-setup|angular-only/);
  });

  it('is deterministic across repeated derivations', () => {
    const first = deriveSparseGeometryFacts(toPreflightInput(TRIANGULATION));
    const second = deriveSparseGeometryFacts(toPreflightInput(TRIANGULATION));
    expect(second).toEqual(first);
  });

  it('matches prepared solve counts and the TS reference equation budget', () => {
    const preflightInput = toPreflightInput(TRIANGULATION);
    const facts = deriveSparseGeometryFacts(preflightInput);
    expect(facts.equationCount).toBe(preflightInput.numObsEquations);
    expect(facts.paramCount).toBe(preflightInput.numParams);
    const reference = new LSAEngine({ input: TRIANGULATION }).solve();
    expect(reference.success).toBe(true);
    expect(facts.unknownCount).toBeLessThanOrEqual(Object.keys(reference.stations).length);
  });

  it('integrates preflight with production eligibility fail-closed', () => {
    const integrated = evaluateSparsePreflightEligibility(
      toPreflightInput(TRIANGULATION),
      { ...productionBase },
    );
    expect(integrated.eligible).toBe(true);
    expect(integrated.reasons).toEqual([]);

    const weakIntegrated = evaluateSparsePreflightEligibility(
      toPreflightInput(RESECTION),
      { ...productionBase },
    );
    expect(weakIntegrated.eligible).toBe(false);
    expect(weakIntegrated.production.eligible).toBe(true);
    expect(weakIntegrated.reasons.join(' ')).toMatch(/angular-only|resection|direction setups/);

    const robustIntegrated = evaluateSparsePreflightEligibility(
      toPreflightInput(TRIANGULATION),
      { ...productionBase, robustWeighting: true },
    );
    expect(robustIntegrated.eligible).toBe(false);
    expect(robustIntegrated.reasons.join(' ')).toMatch(/robust/i);
  });
});
