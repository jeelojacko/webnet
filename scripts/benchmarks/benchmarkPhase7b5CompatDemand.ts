/**
 * Phase 7B.5 Option A vs Option B demand benchmark (test-only).
 *
 * Deterministic chain-2d cases (~25/50/100/128 unknowns): runs the TS
 * reference (Option A demand = numParams^2 dense Qxx) and the legacy compat
 * route (Option B = exact all-station selected queries, no dense Qxx) with a
 * dense-inversion answering solver, reporting query counts, equation rows,
 * wall time, and memory. No production routing changes.
 *
 * Usage: `npm run bench:phase7b5:compat-demand [-- --quick]`
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { LSAEngine } from '../../src/engine/adjust';
import { accumulateNormalEquationsFromSparseRows, zeros } from '../../src/engine/matrix';
import { invertNormalMatrixForStats } from '../../src/engine/adjustNormalEquationHelpers';
import type { SparseMatrixRows } from '../../src/engine/matrix';
import type {
  SparseSelectedCovarianceInput,
  SparseSelectedCovarianceResult,
} from '../../src/engine/numericalBackend';
import { generatePhase5BenchmarkInput } from '../../src/engine/phase5BenchmarkNetworks';

const quick = process.argv.includes('--quick');
const SPECS = quick
  ? [{ unknowns: 8, seed: 1108 }, { unknowns: 25, seed: 1125 }]
  : [
      { unknowns: 25, seed: 1125 },
      { unknowns: 50, seed: 1150 },
      { unknowns: 100, seed: 1100 },
      { unknowns: 128, seed: 1128 },
    ];
const runs = Number(process.env.BENCH_RUNS ?? (quick ? 1 : 2));

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Dense-inversion answering solver that records exact Option B demand. */
const createAnsweringSolver = (): {
  solver: { querySelected: (_request: SparseSelectedCovarianceInput) => SparseSelectedCovarianceResult };
  queries: number[];
  params: number[];
} => {
  const queries: number[] = [];
  const params: number[] = [];
  return {
    queries,
    params,
    solver: {
      querySelected: (request: SparseSelectedCovarianceInput): SparseSelectedCovarianceResult => {
        const input: SparseSelectedCovarianceInput = request;
        queries.push(input.queryRows.length);
        params.push(input.parameterCount);
        const sparseRows: SparseMatrixRows = Array.from({ length: input.observationEquationCount }, () => []);
        for (let row = 0; row < input.observationEquationCount; row += 1) {
          const start = input.design.rowOffsets[row] ?? 0;
          const end = input.design.rowOffsets[row + 1] ?? 0;
          for (let k = start; k < end; k += 1) {
            (sparseRows[row] as { index: number; value: number }[]).push({
              index: input.design.columns[k] ?? 0,
              value: input.design.values[k] ?? 0,
            });
          }
        }
        const weights = Array.from({ length: input.observationEquationCount }, () => new Array<number>(input.observationEquationCount).fill(0));
        for (let k = 0; k < input.weights.values.length; k += 1) {
          const row = input.weights.rows[k] ?? 0;
          const column = input.weights.columns[k] ?? 0;
          const value = input.weights.values[k] ?? 0;
          (weights[row] as number[])[column] = value;
          (weights[column] as number[])[row] = value;
        }
        const { normal } = accumulateNormalEquationsFromSparseRows(sparseRows, zeros(input.observationEquationCount, 1), weights, input.parameterCount);
        const inverse = invertNormalMatrixForStats(normal, () => undefined);
        const covariance = new Float64Array(input.queryRows.length);
        for (let k = 0; k < input.queryRows.length; k += 1) {
          covariance[k] = inverse[input.queryRows[k] ?? 0]?.[input.queryColumns[k] ?? 0] ?? 0;
        }
        return { covariance, normalNnz: 0, factorNnz: 0, damping: 0, dampingAttempts: 0 };
      },
    },
  };
};

const rows: unknown[] = [];
for (const spec of SPECS) {
  const id = `chain-2d-${String(spec.unknowns).padStart(2, '0')}`;
  const input = generatePhase5BenchmarkInput({ id, family: 'chain-2d', unknownCount: spec.unknowns, seed: spec.seed });
  const refWalls: number[] = [];
  let equationRows = 0;
  let paramCount = 0;
  for (let r = 0; r < runs; r += 1) {
    const startedAt = performance.now();
    const reference = new LSAEngine({ input }).solve();
    refWalls.push(performance.now() - startedAt);
    if (!reference.success) throw new Error(`${id} TS reference failed`);
    equationRows = reference.observations.length;
    paramCount = Object.keys(reference.stations).length * 2;
  }
  const answering = createAnsweringSolver();
  const compatWalls: number[] = [];
  for (let r = 0; r < runs; r += 1) {
    const startedAt = performance.now();
    const compat = new LSAEngine({
      input,
      sparseSelectedCovarianceSolver: answering.solver,
      experimentalSelectedCovarianceMode: true,
      experimentalSelectedCovarianceLegacyAllPairs: true,
    }).solve();
    compatWalls.push(performance.now() - startedAt);
    if (!compat.success) throw new Error(`${id} compat solve failed`);
  }
  const mem = process.memoryUsage();
  const optionBDemand = answering.queries[answering.queries.length - 1] ?? 0;
  const optionADemand = (answering.params[answering.params.length - 1] ?? paramCount) ** 2;
  rows.push({
    id, unknowns: spec.unknowns, equationRows, paramCount,
    optionAQueries: optionADemand, optionBQueries: optionBDemand,
    fractionBofA: optionADemand === 0 ? 0 : Number((optionBDemand / optionADemand).toFixed(4)),
    tsRefMedianMs: Number(median(refWalls).toFixed(1)),
    compatMedianMs: Number(median(compatWalls).toFixed(1)),
    rssMb: Number((mem.rss / 1048576).toFixed(1)),
    heapUsedMb: Number((mem.heapUsed / 1048576).toFixed(1)),
  });
  console.log(
    `${id}: unknowns=${spec.unknowns} rows=${equationRows} params~${paramCount} A=${optionADemand} B=${optionBDemand} B/A=${optionADemand === 0 ? 'n/a' : (optionBDemand / optionADemand).toFixed(3)} tsMs=${median(refWalls).toFixed(0)} compatMs=${median(compatWalls).toFixed(0)}`,
  );
}

const outDir = path.join(process.cwd(), 'reports/phase7b5');
mkdirSync(outDir, { recursive: true });
const stamp = quick ? 'quick' : 'full';
writeFileSync(path.join(outDir, `compat-demand-${stamp}.json`), `${JSON.stringify({ generatedAt: new Date().toISOString(), runs, rows }, null, 2)}\n`);
const md = [
  '# Phase 7B.5 Option A vs Option B demand',
  '',
  '| case | unknowns | eq rows | params~ | A (n^2) | B (queries) | B/A | TS ref ms | compat ms | RSS MB | heap MB |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((row) => {
    const r = row as Record<string, number | string>;
    return `| ${r.id} | ${r.unknowns} | ${r.equationRows} | ${r.paramCount} | ${r.optionAQueries} | ${r.optionBQueries} | ${r.fractionBofA} | ${r.tsRefMedianMs} | ${r.compatMedianMs} | ${r.rssMb} | ${r.heapUsedMb} |`;
  }),
  '',
].join('\n');
writeFileSync(path.join(outDir, `compat-demand-${stamp}.md`), md);
console.log(`wrote reports/phase7b5/compat-demand-${stamp}.json + .md`);
