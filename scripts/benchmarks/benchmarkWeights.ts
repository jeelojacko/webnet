import { performance } from 'node:perf_hooks';
import { SparseWeightWriter } from '../../src/engine/sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from '../../src/engine/sparseWeightRepresentation';
import { structuredWeightsToPackedUpper } from '../../src/engine/sparseWeightRepresentation';
import {
  applyRobustWeightFactorsToStructured,
  captureRobustWeightBaseFromStructured,
} from '../../src/engine/adjustRobustWeights';

/**
 * Weight-transfer benchmark (Phase 4).
 *
 * Builds deterministic structured symmetric weight matrices directly through
 * SparseWeightWriter (no dense m x m allocation on the sparse path) and
 * reports sparsity, theoretical dense bytes, packed transfer bytes, and
 * build/finalize/pack/robust-update timings.
 */
type Pattern = 'diag-only' | 'chain' | 'groups';

const patterns: Pattern[] = ['diag-only', 'chain', 'groups'];

const quick = process.argv.includes('--quick');
const sizes = quick ? [500, 2000] : [1000, 8000, 32000];
const warmups = Number(process.env.BENCH_WARMUPS ?? (quick ? 1 : 2));
const runs = Number(process.env.BENCH_RUNS ?? (quick ? 3 : 5));

/** Deterministic diagonal weight in (0, 8]; zero diagonal is omitted downstream. */
const diagonalAt = (row: number): number => 1 + ((row * 37) % 71) / 10;

/** Deterministic correlation weight in [-0.4, 0.4]; exact zero pairs are skipped. */
const pairAt = (row: number, column: number): number => (((row * 131 + column * 57) % 81) - 40) / 100;

const fillWriter = (size: number, pattern: Pattern): SparseWeightWriter => {
  const writer = new SparseWeightWriter(size);
  for (let row = 0; row < size; row += 1) {
    writer.setDiagonal(row, diagonalAt(row));
  }
  if (pattern === 'chain') {
    for (let row = 0; row + 1 < size; row += 1) {
      const value = pairAt(row, row + 1);
      if (value !== 0) writer.setOffDiagonal(row, row + 1, value);
    }
  } else if (pattern === 'groups') {
    const groupSize = 8;
    for (let base = 0; base < size; base += groupSize) {
      const end = Math.min(base + groupSize, size);
      for (let row = base; row < end; row += 1) {
        for (let column = row + 1; column < end; column += 1) {
          const value = pairAt(row, column);
          if (value !== 0) writer.setOffDiagonal(row, column, value);
        }
      }
    }
  }
  return writer;
};

const buildWeights = (size: number, pattern: Pattern): StructuredSymmetricWeights =>
  fillWriter(size, pattern).finalize();

/** Deterministic Huber factors in [0.5, 1.0]. */
const huberFactors = (size: number): number[] =>
  Array.from({ length: size }, (_, row) => 0.5 + (0.5 * ((row * 37) % 11)) / 10);

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const measure = (run: () => void): number => {
  for (let warm = 0; warm < warmups; warm += 1) run();
  return median(Array.from({ length: runs }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }));
};

const countDiagonalNnz = (weights: StructuredSymmetricWeights): number => {
  let count = 0;
  for (let row = 0; row < weights.size; row += 1) {
    if ((weights.diagonal[row] ?? 0) !== 0) count += 1;
  }
  return count;
};

console.log(`Weight benchmark ${quick ? '(quick)' : '(full)'}: warmups=${warmups} runs=${runs}`);
console.log('| Case | m | Diag NNZ | Offdiag NNZ | Total NNZ | Dense MiB (theoretical) | Packed KiB | Savings | Build ms | Finalize ms | Pack ms | Robust capture ms | Robust apply+repack ms |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const size of sizes) {
  for (const pattern of patterns) {
    // Build once for structure; per-repeat build timing uses a fresh writer.
    const weights = buildWeights(size, pattern);
    const diagNnz = countDiagonalNnz(weights);
    const offNnz = weights.offRows.length;
    const totalNnz = diagNnz + offNnz;
    const denseBytes = size * size * Float64Array.BYTES_PER_ELEMENT;
    const packedBytes = totalNnz * (Float64Array.BYTES_PER_ELEMENT + 2 * Int32Array.BYTES_PER_ELEMENT);
    const buildMs = measure(() => {
      fillWriter(size, pattern);
    });
    const finalizeWriter = fillWriter(size, pattern);
    const finalizeMs = measure(() => {
      finalizeWriter.finalize();
    });
    const packMs = measure(() => {
      structuredWeightsToPackedUpper(weights);
    });
    const factors = huberFactors(size);
    // Repeat capture/apply on the live structure (values evolve, sparsity is fixed).
    const captureMs = measure(() => {
      captureRobustWeightBaseFromStructured(weights, [], { robustCorrelationRowGroups: () => [] });
    });
    const base = captureRobustWeightBaseFromStructured(weights, [], { robustCorrelationRowGroups: () => [] });
    const applyMs = measure(() => {
      applyRobustWeightFactorsToStructured(weights, base, factors);
      structuredWeightsToPackedUpper(weights);
    });
    console.log(
      `| ${pattern}-${size} | ${size} | ${diagNnz} | ${offNnz} | ${totalNnz} `
      + `| ${(denseBytes / 1048576).toFixed(2)} | ${(packedBytes / 1024).toFixed(2)} `
      + `| ${(denseBytes / Math.max(packedBytes, 1)).toFixed(1)}x `
      + `| ${buildMs.toFixed(2)} | ${finalizeMs.toFixed(2)} | ${packMs.toFixed(3)} | ${captureMs.toFixed(3)} | ${applyMs.toFixed(3)} |`,
    );
  }
}
