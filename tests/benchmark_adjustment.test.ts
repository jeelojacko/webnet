import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';

type BenchmarkCase = { id: string; fixture: string; profile: string };
const cases = JSON.parse(readFileSync('benchmarks/fixtures/adjustment-cases.json', 'utf8')) as BenchmarkCase[];

describe('adjustment benchmark harness', () => {
  it('contains deterministic production-path cases and produces finite solve summaries', () => {
    expect(cases.length).toBeGreaterThanOrEqual(3);
    const benchmarkCase = cases[0]!;
    const result = new LSAEngine({ input: readFileSync(benchmarkCase.fixture, 'utf8'), maxIterations: 15 }).solve();
    expect(Object.keys(result.stations).length).toBeGreaterThan(0);
    expect(result.observations.length).toBeGreaterThan(0);
    expect(Number.isFinite(result.dof)).toBe(true);
    expect(Number.isFinite(result.seuw)).toBe(true);
  });
});
