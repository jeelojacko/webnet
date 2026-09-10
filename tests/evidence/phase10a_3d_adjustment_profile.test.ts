/**
 * Phase 10A evidence: normal 3D TypeScript adjustment timings.
 *
 * Evidence-only. Uses existing genuine 3D industry_demo plus the existing
 * deterministic mixed terrestrial/GNSS/vertical generator. No runtime seam,
 * routing, tolerances, or numerical behavior changes.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../../src/engine/adjust';
import { buildPhase6LargeBenchmarkCases } from '../../src/engine/phase6BenchmarkNetworks';

type TimingRow = {
  fixture: string;
  dimension: '3D';
  stations: number;
  fixedStations: number;
  unknownStations: number;
  coordinateParameters: number;
  orientationParameters: number;
  otherParameters: number;
  totalParameters: number;
  rawObservations: number;
  scalarEquations: number;
  dof: number;
  iterations: number;
  gpsObservations: number;
  gpsCovarianceBlocks: number;
  directionObservations: number;
  distanceObservations: number;
  zenithVerticalObservations: number;
  levelingObservations: number;
  wallMs: number;
  setupMs: number;
  equationAssemblyMs: number;
  factorizationCorrectionMs: number;
  stateUpdateMs: number;
  covarianceMs: number;
  rowProductsStatisticsMs: number;
  relativeCovarianceMs: number;
  resultConstructionMs: number;
  otherMs: number;
  success: boolean;
  converged: boolean;
};

const example3d = readFileSync(join(process.cwd(), 'public/examples/industry_demo.dat'), 'utf8');
const generated = buildPhase6LargeBenchmarkCases(false).filter((item) =>
  ['gps-3d-cov-08', 'gps-3d-16', 'gps-3d-32', 'gps-3d-64', 'gps-3d-128'].includes(item.id),
);

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const profileCase = (fixture: string, input: string): TimingRow => {
  const started = performance.now();
  const result = new LSAEngine({ input }).solve();
  const wallMs = performance.now() - started;
  const profile = result.solveTimingProfile;
  const observations = result.observations;
  const gps = observations.filter((obs) => obs.type === 'gps');
  const directions = observations.filter((obs) => obs.type === 'direction');
  const distances = observations.filter((obs) => obs.type === 'dist');
  const vertical = observations.filter((obs) => obs.type === 'zenith' || obs.type === 'lev');
  const fixedStations = Object.values(result.stations).filter((station) => station.fixed).length;
  const unknownStations = Object.keys(result.stations).length - fixedStations;
  const coordinateParameters = unknownStations * 3;
  // orientationParameters is a diagnostics-derived proxy and may understate orientation
  // parameters when diagnostics are absent; industry_demo parses direction-style lines as `angle` (no direction sets).
  const orientationParameters = result.directionSetDiagnostics?.length ?? 0;
  const totalParameters = coordinateParameters + orientationParameters;
  const scalarEquations = observations.reduce(
    (count, obs) => count + (obs.type === 'gps' ? 3 : 1),
    0,
  );
  const setupMs = profile?.parseAndSetupMs ?? 0;
  const equationAssemblyMs = profile?.equationAssemblyMs ?? 0;
  const factorizationCorrectionMs = profile?.matrixFactorizationMs ?? 0;
  const rowProductsStatisticsMs = profile?.precisionAndDiagnosticsMs ?? 0;
  const relativeCovarianceMs = profile?.precisionPropagationMs ?? 0;
  const resultConstructionMs = profile?.resultPackagingMs ?? 0;
  const classified = setupMs + equationAssemblyMs + factorizationCorrectionMs + rowProductsStatisticsMs + resultConstructionMs;
  return {
    fixture,
    dimension: '3D',
    stations: Object.keys(result.stations).length,
    fixedStations,
    unknownStations,
    coordinateParameters,
    orientationParameters,
    otherParameters: Math.max(0, totalParameters - coordinateParameters - orientationParameters),
    totalParameters,
    rawObservations: observations.length,
    scalarEquations,
    dof: result.dof,
    iterations: result.iterations,
    gpsObservations: gps.length,
    gpsCovarianceBlocks: input.includes('.GPS WEIGHT COVARIANCE') ? gps.length : 0,
    directionObservations: directions.length,
    distanceObservations: distances.length,
    zenithVerticalObservations: vertical.filter((obs) => obs.type === 'zenith').length,
    levelingObservations: vertical.filter((obs) => obs.type === 'lev').length,
    wallMs,
    setupMs,
    equationAssemblyMs,
    factorizationCorrectionMs,
    stateUpdateMs: 0,
    covarianceMs: 0,
    rowProductsStatisticsMs,
    relativeCovarianceMs,
    resultConstructionMs,
    otherMs: Math.max(0, (profile?.otherMs ?? wallMs - classified) + (wallMs - (profile?.totalMs ?? wallMs))),
    success: result.success,
    converged: result.converged,
  };
};

const runMeasured = (fixture: string, input: string): TimingRow => {
  profileCase(fixture, input);
  const rows = [profileCase(fixture, input), profileCase(fixture, input), profileCase(fixture, input)];
  const first = rows[0];
  return {
    ...first,
    wallMs: median(rows.map((row) => row.wallMs)),
    setupMs: median(rows.map((row) => row.setupMs)),
    equationAssemblyMs: median(rows.map((row) => row.equationAssemblyMs)),
    factorizationCorrectionMs: median(rows.map((row) => row.factorizationCorrectionMs)),
    stateUpdateMs: median(rows.map((row) => row.stateUpdateMs)),
    covarianceMs: median(rows.map((row) => row.covarianceMs)),
    rowProductsStatisticsMs: median(rows.map((row) => row.rowProductsStatisticsMs)),
    relativeCovarianceMs: median(rows.map((row) => row.relativeCovarianceMs)),
    resultConstructionMs: median(rows.map((row) => row.resultConstructionMs)),
    otherMs: median(rows.map((row) => row.otherMs)),
  };
};

describe('Phase 10A normal 3D adjustment profile', () => {
  it('profiles genuine existing 3D cases and writes structured evidence artifacts', () => {
    const rows = [
      runMeasured('industry_demo-3d-terrestrial-orientation', example3d),
      ...generated.map((item) => runMeasured(item.id, item.input)),
    ];
    expect(rows.slice(1).every((row) => row.success && row.converged)).toBe(true);
    expect(rows[0]?.dimension).toBe('3D');
    const outputDir = join(process.cwd(), 'artifacts/evidence/phase10a');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'normal-3d-profile.json'), `${JSON.stringify({ rows }, null, 2)}\n`);
    const markdown = [
      '# Phase 10A normal 3D adjustment profile',
      '',
      'Evidence-only TypeScript baseline. Timings: Node process, one warm-up, three measured runs; medians reported. Existing solve timing buckets do not split normal accumulation from factorization, state update, or covariance from the broader buckets; those fields are reported as zero rather than invented.',
      '',
      '| Fixture | stations | params | rows | iterations | wall ms | setup | assembly | factor/solve | precision/statistics | precision propagation | other |',
      '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
      ...rows.map((row) => `| ${row.fixture} | ${row.stations} | ${row.totalParameters} | ${row.scalarEquations} | ${row.iterations} | ${row.wallMs.toFixed(2)} | ${row.setupMs.toFixed(2)} | ${row.equationAssemblyMs.toFixed(2)} | ${row.factorizationCorrectionMs.toFixed(2)} | ${row.rowProductsStatisticsMs.toFixed(2)} | ${row.relativeCovarianceMs.toFixed(2)} | ${row.otherMs.toFixed(2)} |`),
      '',
      '## Interpretation',
      '',
      '- Normal 3D uses dense TypeScript solve path; no production sparse routing is exercised.',
      '- `matrixFactorizationMs` includes dense normal accumulation, factorization, correction solve, and recovery where applicable.',
      '- `precisionAndDiagnosticsMs` includes residual/statistical and row-product work; `precisionPropagationMs` is the closest existing relative-covariance bucket.',
      '- State-update and result-construction sub-timings are not exposed by current production timing profile; no false precision added.',
    ].join('\n');
    writeFileSync(join(outputDir, 'normal-3d-profile.md'), `${markdown}\n`);
  });
});
