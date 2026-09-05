/**
 * Phase 6 sparse shadow parity (developer tooling only).
 *
 * Compares the authoritative TypeScript result against the injected
 * experimental full sparse selected-network route for one local .dat file.
 * Production defaults and routing are untouched; the sparse route is only
 * injected inside this script. Selected mode intentionally omits legacy
 * all-pairs relativePrecision (0 rows expected).
 *
 * Usage:
 *   npm run parity:sparse-shadow -- --input <path.dat> [--tolerance 1e-6]
 *     [--json out.json] [--markdown out.md]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

import { LSAEngine } from '../src/engine/adjust';
import type { AdjustmentResult } from '../src/typesAdjustmentResult';
import {
  buildExperimentalSparseEngineOptions,
  createExperimentalSparseNumericalBundle,
} from '../src/engine/wasm/experimentalSparseNumericalBundle';
import { createExperimentalSparseRouteDiagnostics } from '../src/engine/experimentalSparseDiagnostics';
import {
  compareSparseShadowResults,
  formatSparseShadowSummaryLine,
} from '../src/engine/phase6SparseShadowCompare';
import type { WebNetWasmFactory } from '../src/engine/wasm/wasmTypes';

const argValue = (flag: string, fallback?: string): string | undefined => {
  const index = process.argv.indexOf(flag);
  if (index < 0) return fallback;
  return process.argv[index + 1] ?? fallback;
};

const inputPath = argValue('--input');
if (!inputPath) {
  console.error('Usage: npm run parity:sparse-shadow -- --input <path.dat> [--tolerance 1e-6] [--json out.json] [--markdown out.md]');
  process.exit(1);
}
const tolerance = Number(argValue('--tolerance', '0.000001'));
const jsonOut = argValue('--json');
const markdownOut = argValue('--markdown');

const input = readFileSync(inputPath, 'utf8');
const imported = (await import(
  pathToFileURL(`${process.cwd()}/cpp/build-wasm/webnet_core.js`).href
)) as { default: WebNetWasmFactory };
const bundle = await createExperimentalSparseNumericalBundle(imported.default);

const tsStart = performance.now();
const reference = new LSAEngine({ input }).solve() as AdjustmentResult;
const tsMs = performance.now() - tsStart;

const diagnostics = createExperimentalSparseRouteDiagnostics();
const sparseStart = performance.now();
const candidate = new LSAEngine({
  input,
  ...buildExperimentalSparseEngineOptions(bundle, diagnostics, true),
}).solve() as AdjustmentResult;
const sparseMs = performance.now() - sparseStart;

const comparison = compareSparseShadowResults(reference, candidate, tolerance);
const fallbacks =
  diagnostics.sparseCorrectionFallbacks +
  diagnostics.rowProductsFallbacks +
  diagnostics.selectedCovarianceFallbacks;
const unknownCount = Object.values(reference.stations).filter((station) => !station.fixed).length;

const summary = {
  tool: 'parity:sparse-shadow',
  inputFile: basename(inputPath),
  generatedAt: new Date().toISOString(),
  node: process.version,
  toleranceM: tolerance,
  authoritative: {
    success: reference.success,
    converged: reference.converged,
    iterations: reference.iterations,
    dof: reference.dof,
    stations: Object.keys(reference.stations).length,
    unknowns: unknownCount,
    observations: reference.observations.length,
    seuw: reference.seuw,
    wallMs: tsMs,
    timing: reference.solveTimingProfile ?? null,
  },
  sparseSelectedNetwork: {
    success: candidate.success,
    converged: candidate.converged,
    iterations: candidate.iterations,
    dof: candidate.dof,
    seuw: candidate.seuw,
    wallMs: sparseMs,
    timing: candidate.solveTimingProfile ?? null,
    relativePrecisionRows: (candidate.relativePrecision ?? []).length,
    referenceRelativePrecisionRows: (reference.relativePrecision ?? []).length,
    diagnostics: {
      sparseCorrectionCalls: diagnostics.sparseCorrectionCalls,
      sparseCorrectionFallbacks: diagnostics.sparseCorrectionFallbacks,
      rowProductsCalls: diagnostics.rowProductsCalls,
      rowProductsFallbacks: diagnostics.rowProductsFallbacks,
      selectedCovarianceCalls: diagnostics.selectedCovarianceCalls,
      selectedCovarianceFallbacks: diagnostics.selectedCovarianceFallbacks,
      fallbackReasons: [
        ...diagnostics.sparseCorrectionFallbackReasons,
        ...diagnostics.rowProductsFallbackReasons,
        ...diagnostics.selectedCovarianceFallbackReasons,
      ],
    },
  },
  maxima: {
    maxCoordDiffM: comparison.maxCoordDiffM,
    maxHeightDiffM: comparison.maxHeightDiffM,
    maxResidualDiff: comparison.maxResidualDiff,
    maxStdResDiff: comparison.maxStdResDiff,
    seuwDiff: comparison.seuwDiff,
    worstStationId: comparison.worstStationId,
    worstObservationIndex: comparison.worstObservationIndex,
  },
  pass: comparison.pass && fallbacks === 0,
  passReasons: [
    ...comparison.passReasons,
    ...(fallbacks === 0 ? [] : [`${fallbacks} sparse fallback(s) recorded`]),
  ],
};

const markdown = [
  `# Sparse shadow parity`,
  ``,
  `Input: \`${summary.inputFile}\` · tolerance: ${tolerance} m · ${summary.generatedAt}`,
  `Authoritative TS: success=${reference.success} converged=${reference.converged} iter=${reference.iterations} dof=${reference.dof} seuw=${reference.seuw.toFixed(6)} wall=${tsMs.toFixed(2)}ms`,
  `Sparse selected-network: success=${candidate.success} converged=${candidate.converged} iter=${candidate.iterations} dof=${candidate.dof} seuw=${candidate.seuw.toFixed(6)} wall=${sparseMs.toFixed(2)}ms`,
  `Relative precision rows: TS=${(reference.relativePrecision ?? []).length} sparse-selected=${(candidate.relativePrecision ?? []).length} (0 expected by design).`,
  `Diagnostics: corr ${diagnostics.sparseCorrectionCalls}/${diagnostics.sparseCorrectionFallbacks}, rowp ${diagnostics.rowProductsCalls}/${diagnostics.rowProductsFallbacks}, selcov ${diagnostics.selectedCovarianceCalls}/${diagnostics.selectedCovarianceFallbacks}.`,
  `Maxima: ${formatSparseShadowSummaryLine(comparison)}; worst station ${comparison.worstStationId ?? '-'}; worst obs index ${comparison.worstObservationIndex ?? '-'}.`,
  `Result: ${summary.pass ? 'PASS' : 'FAIL'}${summary.passReasons.length > 0 ? ` (${summary.passReasons.join('; ')})` : ''}.`,
  ``,
].join('\n');

console.log(markdown);
if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`Wrote ${jsonOut}.`);
}
if (markdownOut) {
  mkdirSync(dirname(markdownOut), { recursive: true });
  writeFileSync(markdownOut, markdown);
  console.log(`Wrote ${markdownOut}.`);
}
if (!summary.pass) process.exit(2);
