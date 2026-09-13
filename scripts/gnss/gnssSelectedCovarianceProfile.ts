/**
 * Phase 12F.2 §1 — R2 selected-covariance cost profile (EVIDENCE ONLY).
 *
 * Runs the R2 path (TS setup+preflight+assembly, native sparse correction
 * iterations, single native selected-covariance bridge call with the exact
 * per-edge R2 query builder) against the REAL WASM build over synthetic
 * corpus networks and records per-case factorization/solve/bridge/pack/
 * mirror timings, query counts, and heap deltas.
 *
 * No production routing, no math/tolerance changes, no UI. R1 default OFF
 * is untouched. Large cases (1500/2000) are attempted with graceful
 * OOM/timeout capture: a failing case is recorded, never aborts the run.
 *
 * CLI: npm run gnss:selected-profile [-- --sizes=100,250 --topologies=chain
 *        --seed=7 --timeout-ms=120000 --out=reports/gnss/phase12f2-profile]
 *      npm run gnss:selected-profile -- --help
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import {
  applyAdjustmentCorrections,
  solveAdjustmentIteration,
} from '../../src/engine/adjustmentIteration';
import { buildSolveParameterIndex } from '../../src/engine/adjustmentPreprocessing';
import { solveNormalEquations } from '../../src/engine/adjustNormalEquationHelpers';
import { applyGnssSetupUncertainty } from '../../src/engine/gnssBaselineSetupUncertainty';
import { runGnssBaselinePreflight } from '../../src/engine/gnssBaselinePreflight';
import { buildGnssSelectedBlockPlan } from '../../src/engine/gnssSelectedBlockPlan';
import {
  packSparseDesignRows,
  packUpperTriangleWeights,
} from '../../src/engine/sparseEquationPacking';
import { loadWebNetWasm } from '../../src/engine/wasm/wasmModule';
import { WasmSparseNormalEquationSolver } from '../../src/engine/wasm/wasmSparseNormalSolver';
import { WasmSparseSelectedCovariance } from '../../src/engine/wasm/wasmSparseCovariance';
import type { WebNetWasmFactory, WebNetWasmModule } from '../../src/engine/wasm/wasmTypes';
import type { StationMap } from '../../src/types';
import {
  generateAuditNetwork,
  type AuditNetwork,
  type AuditTopology,
} from './gnssNativeAuditCorpus';
import {
  gnssAssemblyContext,
  selectedBlockQueries,
} from './gnssNativeArchitectureAudit';

type ProfileTopology = AuditTopology;

const DEFAULT_SIZES = [100, 250, 500, 750, 1000];
const LARGE_SIZES = [1500, 2000];
const DEFAULT_TOPOLOGIES: ProfileTopology[] = ['chain', 'sparse-mesh'];
const EXTRA_TOPOLOGIES: { topology: ProfileTopology; size: number }[] = [
  { topology: 'ring', size: 250 },
  { topology: 'hub-spoke', size: 250 },
];

/** Dominant-cost classes: A/B native solve, C bridge, D alloc-copy, E result, F factor, G TS assembly. */
export type DominantCost = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export const DOMINANT_COST_LABELS: Record<DominantCost, string> = {
  A: 'repeated triangular solves (~full inverse: unique queried columns ~= parameter count)',
  B: 'selected-inverse work (solve phase dominates on a genuinely sparse query set)',
  C: 'bridge overhead (pack/query wrapper + native assembly/equilibration)',
  D: 'buffer alloc-copy (TS-side design/weight packing)',
  E: 'result representation (TS dense Qxx mirror fill)',
  F: 'factorization (single analyze+factorize per call; duplication is zero)',
  G: 'TS-side equation assembly (outside the native query)',
};

export interface ProfileCaseResult {
  readonly topology: string;
  readonly stations: number;
  readonly seed: number;
  readonly status: 'ok' | 'error' | 'timeout-skipped';
  readonly error?: string;
  readonly params?: number;
  readonly edges?: number;
  readonly queryCalls?: number;
  readonly queryArrayLength?: number;
  readonly uniqueColumnCount?: number;
  readonly nativeAnalyzeMs?: number;
  readonly nativeFactorizeMs?: number;
  readonly nativeSolveMs?: number;
  readonly nativeAssemblyMs?: number;
  readonly nativeEquilibrationMs?: number;
  readonly bridgeWrapperMs?: number;
  readonly packMs?: number;
  readonly mirrorMs?: number;
  readonly tsAssemblyMs?: number;
  readonly tsSolveLoopMs?: number;
  readonly queryWallMs?: number;
  readonly totalWallMs: number;
  readonly jsHeapDeltaBytes?: number;
  readonly nativeHeapDeltaBytes?: number;
  readonly resultStorageBytes?: number;
  readonly normalNnz?: number;
  readonly factorNnz?: number;
  readonly canonicalBlocks?: number;
  readonly canonicalScalars?: number;
  readonly rawScalarQueries?: number;
  readonly dominant?: DominantCost;
}

const denseWeightedQuadratic = (P: number[][], v: number[][]): number => {
  let sum = 0;
  for (let row = 0; row < v.length; row += 1) {
    const residual = v[row]?.[0] ?? 0;
    for (let column = 0; column < v.length; column += 1) {
      sum += residual * (P[row]?.[column] ?? 0) * (v[column]?.[0] ?? 0);
    }
  }
  return sum;
};

const estimateCondition = (N: number[][]): number => {
  let rowMax = 0;
  for (let i = 0; i < N.length; i += 1) {
    let rsum = 0;
    for (let j = 0; j < N.length; j += 1) rsum += Math.abs(N[i]?.[j] ?? 0);
    rowMax = Math.max(rowMax, rsum);
  }
  return rowMax * rowMax;
};

const iterationOptions = (): Parameters<typeof solveAdjustmentIteration>[0] => ({
  robustMode: 'none',
  sparseCorrectionSolver: undefined,
  experimentalSparseDiagnostics: undefined,
  solveNormalEquations: (N, U, options) =>
    solveNormalEquations(N, U, { log: () => {}, recoverCovariance: options?.recoverCovariance }),
  estimateCondition,
  recordConditionEstimate: () => {},
  captureRobustWeightBase: (): never => {
    throw new Error('Profile reached unexpected robust helper.');
  },
  applyRobustWeightFactors: (): never => {
    throw new Error('Profile reached unexpected robust helper.');
  },
  computeRobustWeightSummary: (): never => {
    throw new Error('Profile reached unexpected robust helper.');
  },
  maxRobustWeightDelta: (): never => {
    throw new Error('Profile reached unexpected robust helper.');
  },
  recordRobustDiagnostics: (): void => {},
  weightedQuadratic: denseWeightedQuadratic,
});

const classifyDominant = (args: {
  solveMs: number;
  factorMs: number;
  bridgeMs: number;
  packMs: number;
  mirrorMs: number;
  assemblyMs: number;
  uniqueColumns: number;
  params: number;
}): DominantCost => {
  const components: { cost: DominantCost; ms: number }[] = [
    { cost: 'B', ms: args.solveMs },
    { cost: 'F', ms: args.factorMs },
    { cost: 'C', ms: args.bridgeMs },
    { cost: 'D', ms: args.packMs },
    { cost: 'E', ms: args.mirrorMs },
    { cost: 'G', ms: args.assemblyMs },
  ];
  components.sort((a, b) => b.ms - a.ms);
  const winner = components[0]!.cost;
  if (winner === 'B') return args.uniqueColumns / Math.max(1, args.params) >= 0.9 ? 'A' : 'B';
  return winner;
};

const loadWasm = async (): Promise<WebNetWasmModule> => {
  const built = join(process.cwd(), 'cpp/build-wasm/webnet_core.js');
  const imported = (await import(pathToFileURL(built).href)) as { default: WebNetWasmFactory };
  const module = await loadWebNetWasm(imported.default);
  if (!module) throw new Error(`WASM module failed to initialize (${built}).`);
  return module;
};

const runCase = async (
  module: WebNetWasmModule,
  topology: ProfileTopology,
  size: number,
  seed: number,
  timeoutMs: number,
): Promise<ProfileCaseResult> => {
  const total0 = performance.now();
  const jsHeapBefore = process.memoryUsage().heapUsed;
  const nativeHeapBefore = module.HEAPU8.byteLength;
  try {
    const network: AuditNetwork = generateAuditNetwork(topology, size, seed);
    const stations: StationMap = Object.fromEntries(
      Object.entries(network.stations).map(([id, s]) => [id, { ...s }]),
    );
    const setupApplied = applyGnssSetupUncertainty({
      stations,
      baselines: network.baselines,
      setup: undefined,
      ellipsoid: undefined,
    });
    const effectiveBaselines = setupApplied.baselines;
    const preflight = runGnssBaselinePreflight({ stations, baselines: effectiveBaselines });
    const unknowns = preflight.components
      .flat()
      .filter((id) => {
        const station = stations[id];
        return !!station && !(station.fixedX && station.fixedY && station.fixedH);
      })
      .sort();
    const { paramIndex, stationParamCount } = buildSolveParameterIndex(stations, unknowns, false);
    const numParams = stationParamCount;
    const numObsEquations = preflight.equationCount;
    if (numObsEquations - numParams < 0) throw new Error('Profile network is under-determined.');
    const assemblyObservations = effectiveBaselines as unknown[] as Parameters<
      typeof assembleAdjustmentEquations
    >[1];
    // Converge with the native sparse correction solver (mirrors R2 §1-2 legs).
    const correction = new WasmSparseNormalEquationSolver(module);
    let correctionCalls = 0;
    const solve0 = performance.now();
    for (let iteration = 1; iteration <= 10; iteration += 1) {
      const assembled = assembleAdjustmentEquations(
        gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
        assemblyObservations,
        [],
        numObsEquations,
        numParams,
        iteration,
      );
      const base = iterationOptions();
      const computed = solveAdjustmentIteration(
        { ...base, sparseCorrectionSolver: correction },
        assembled.A ?? [],
        assembled.L,
        assembled.P,
        assembled.rowInfo,
        iteration,
        { sparseRows: assembled.sparseRows, numParams },
      );
      correctionCalls += 1;
      const maxCorrection = applyAdjustmentCorrections(stations, paramIndex, false, {}, {}, computed.correction);
      if (maxCorrection < 1e-9) break;
    }
    const tsSolveLoopMs = performance.now() - solve0;
    if (timeoutMs > 0 && performance.now() - total0 > timeoutMs) {
      return { topology, stations: size, seed, status: 'timeout-skipped', totalWallMs: performance.now() - total0 };
    }
    const asm0 = performance.now();
    const finalAssembly = assembleAdjustmentEquations(
      gnssAssemblyContext(stations, paramIndex) as Parameters<typeof assembleAdjustmentEquations>[0],
      assemblyObservations,
      [],
      numObsEquations,
      numParams,
      11,
    );
    const tsAssemblyMs = performance.now() - asm0;
    const qb0 = performance.now();
    const blocks = selectedBlockQueries(paramIndex, effectiveBaselines, numParams);
    const queryRows = blocks.rows;
    const queryColumns = blocks.columns;
    const queryBuildMs = performance.now() - qb0;
    const uniqueColumnCount = new Set(Array.from(queryColumns)).size;
    const pk0 = performance.now();
    const packedDesign = packSparseDesignRows(finalAssembly.sparseRows);
    const packedWeights = packUpperTriangleWeights(finalAssembly.P ?? [], finalAssembly.L.length);
    const packMs = performance.now() - pk0;
    const selected = new WasmSparseSelectedCovariance(module);
    const q0 = performance.now();
    const result = selected.querySelected({
      design: packedDesign,
      weights: packedWeights,
      observationEquationCount: finalAssembly.L.length,
      parameterCount: numParams,
      queryRows,
      queryColumns,
    });
    const queryWallMs = performance.now() - q0;
    const native = result.timings;
    const nativeAssemblyMs = native?.assemblyMs ?? 0;
    const nativeEquilibrationMs = native?.equilibrationMs ?? 0;
    const nativeAnalyzeMs = native?.analyzeMs ?? 0;
    const nativeFactorizeMs = native?.factorizeMs ?? 0;
    const nativeSolveMs = native?.solveMs ?? 0;
    const nativeSum = nativeAssemblyMs + nativeEquilibrationMs
      + nativeAnalyzeMs + nativeFactorizeMs + nativeSolveMs;
    const m0 = performance.now();
    const qxx: number[][] = Array.from({ length: numParams }, () => new Array<number>(numParams).fill(0));
    for (let k = 0; k < queryRows.length; k += 1) {
      const r = queryRows[k]!;
      const c = queryColumns[k]!;
      qxx[r]![c] = result.covariance[k]!;
      qxx[c]![r] = result.covariance[k]!;
    }
    const mirrorMs = performance.now() - m0;
    void qxx;
    // Canonical §2 request set over the same edges (evidence-only comparison).
    const plan = buildGnssSelectedBlockPlan(paramIndex, effectiveBaselines, numParams);
    const bridgeWrapperMs = Math.max(0, queryWallMs - nativeSum) + queryBuildMs;
    const dominant = classifyDominant({
      solveMs: nativeSolveMs,
      factorMs: nativeAnalyzeMs + nativeFactorizeMs,
      bridgeMs: bridgeWrapperMs + nativeAssemblyMs + nativeEquilibrationMs,
      packMs,
      mirrorMs,
      assemblyMs: tsAssemblyMs,
      uniqueColumns: uniqueColumnCount,
      params: numParams,
    });
    return {
      topology,
      stations: size,
      seed,
      status: 'ok',
      params: numParams,
      edges: effectiveBaselines.length,
      queryCalls: correctionCalls + 1,
      queryArrayLength: queryRows.length,
      uniqueColumnCount,
      nativeAnalyzeMs: native?.analyzeMs,
      nativeFactorizeMs: native?.factorizeMs,
      nativeSolveMs: native?.solveMs,
      nativeAssemblyMs: native?.assemblyMs,
      nativeEquilibrationMs: native?.equilibrationMs,
      bridgeWrapperMs,
      packMs,
      mirrorMs,
      tsAssemblyMs,
      tsSolveLoopMs,
      queryWallMs,
      totalWallMs: performance.now() - total0,
      jsHeapDeltaBytes: process.memoryUsage().heapUsed - jsHeapBefore,
      nativeHeapDeltaBytes: module.HEAPU8.byteLength - nativeHeapBefore,
      resultStorageBytes: queryRows.length * 8 + numParams * numParams * 8,
      normalNnz: result.normalNnz,
      factorNnz: result.factorNnz,
      canonicalBlocks: plan.counts.uniqueBlocks,
      canonicalScalars: plan.counts.scalarEntries,
      rawScalarQueries: queryRows.length,
      dominant,
    };
  } catch (error) {
    return {
      topology,
      stations: size,
      seed,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      totalWallMs: performance.now() - total0,
    };
  }
};

const fmt = (value: number | undefined, digits = 1): string =>
  value === undefined || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);

const shortError = (c: ProfileCaseResult): string =>
  (c.error ?? c.status).split('\n')[0]!.replace(/\s+/g, ' ').slice(0, 140);

export const toMarkdown = (cases: ProfileCaseResult[]): string => {
  const lines = [
    '# Phase 12F.2 §1 — R2 selected-covariance profile (evidence only)',
    '',
    'Real-WASM `querySelected` over the exact R2 per-edge query builder (21 scalar queries/edge, no cross-edge dedup).',
    'One native factorization + one bridge call per run; one triangular solve per unique queried column.',
    '',
    '| case | params | edges | queries | uniqCols | analyze+factor (ms) | solve (ms) | bridge (ms) | pack (ms) | mirror (ms) | query wall (ms) | total (s) | dominant |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
  ];
  cases.forEach((c) => {
    if (c.status !== 'ok') {
      lines.push(`| ${c.topology}@${c.stations} | ${shortError(c)} | | | | | | | | | | | |`);
      return;
    }
    lines.push(
      `| ${c.topology}@${c.stations} | ${c.params} | ${c.edges} | ${c.queryArrayLength} | ${c.uniqueColumnCount} |`
      + ` ${fmt((c.nativeAnalyzeMs ?? 0) + (c.nativeFactorizeMs ?? 0))} | ${fmt(c.nativeSolveMs)} |`
      + ` ${fmt(c.bridgeWrapperMs)} | ${fmt(c.packMs)} | ${fmt(c.mirrorMs)} | ${fmt(c.queryWallMs)} |`
      + ` ${fmt((c.totalWallMs ?? 0) / 1000)} | ${c.dominant} |`,
    );
  });
  lines.push(
    '',
    '| case | bridge calls | normal nnz | factor nnz | result bytes | JS heap Δ (MB) | native heap Δ (KB) | canonical blocks | canonical scalars | raw scalars |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  cases.forEach((c) => {
    if (c.status !== 'ok') {
      lines.push(`| ${c.topology}@${c.stations} | ${c.status} | | | | | | | | |`);
      return;
    }
    lines.push(
      `| ${c.topology}@${c.stations} | ${c.queryCalls} | ${c.normalNnz} | ${c.factorNnz} | ${c.resultStorageBytes} |`
      + ` ${fmt((c.jsHeapDeltaBytes ?? 0) / 1048576)} | ${fmt((c.nativeHeapDeltaBytes ?? 0) / 1024)} |`
      + ` ${c.canonicalBlocks} | ${c.canonicalScalars} | ${c.rawScalarQueries} |`,
    );
  });
  lines.push('', 'Notes:', '');
  lines.push(...Object.entries(DOMINANT_COST_LABELS).map(([key, label]) => `- ${key}: ${label}.`));
  lines.push('- F duplication is zero by construction (single factorization per run).');
  lines.push('- 1500/2000 rows document the scaling gate; TS dense assembly is the known OOM source.');
  return `${lines.join('\n')}\n`;
};

const printHelp = (): void => {
  console.log(`gnss:selected-profile — Phase 12F.2 §1 R2 cost profile (evidence only, real WASM).

Usage: npm run gnss:selected-profile [-- --sizes=100,250 --topologies=chain,sparse-mesh
       --seed=7 --timeout-ms=0 --out=reports/gnss/phase12f2-profile]

  --sizes       station counts (default ${[...DEFAULT_SIZES, ...LARGE_SIZES].join(',')})
  --topologies  corpus topologies (default ${DEFAULT_TOPOLOGIES.join(',')}; ring/hub-spoke@250 always added)
  --seed        base seed; per-case seed = base + size*131 + topologyIndex*17 (default 7)
  --timeout-ms  hard per-case wall budget (child kill), 0 disables (default 0)
  --out         report basename for .json/.md (default reports/gnss/phase12f2-profile)
  --case        internal single-case mode <topology>@<size> (one WASM load per
                child so a large-case OOM kills only the child, never the run)
  --help        this text`);
};

const parseList = (name: string, fallback: string[]): string[] => {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.split('=')[1]!.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
};

const main = async (): Promise<void> => {
  if (process.argv.includes('--help')) {
    printHelp();
    return;
  }
  const seedArg = process.argv.find((a) => a.startsWith('--seed='))?.split('=')[1];
  const seedBase = seedArg ? Number(seedArg) : 7;
  const timeoutArg = process.argv.find((a) => a.startsWith('--timeout-ms='))?.split('=')[1];
  const timeoutMs = timeoutArg ? Number(timeoutArg) : 0;
  const caseArg = process.argv.find((a) => a.startsWith('--case='))?.split('=')[1];
  if (caseArg) {
    // Single-case child mode: one WASM load, JSON on stdout, then exit.
    const [topology, sizeText] = caseArg.split('@');
    const caseIndex = Number(process.argv.find((a) => a.startsWith('--case-index='))?.split('=')[1] ?? 0);
    const module = await loadWasm();
    const result = await runCase(
      module, topology as ProfileTopology, Number(sizeText), seedBase + Number(sizeText) * 131 + caseIndex * 17, 0,
    );
    console.log(`PROFILE_CASE_JSON:${JSON.stringify(result)}`);
    return;
  }
  const sizes = [...parseList('sizes', [...DEFAULT_SIZES, ...LARGE_SIZES].map(String)).map(Number)];
  const topologies = parseList('topologies', DEFAULT_TOPOLOGIES) as ProfileTopology[];
  const outArg = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1];
  const outBase = outArg ?? 'reports/gnss/phase12f2-profile';
  const plan: { topology: ProfileTopology; size: number }[] = [];
  topologies.forEach((topology) => sizes.forEach((size) => plan.push({ topology, size })));
  if (topologies.includes('chain' as ProfileTopology) || topologies.includes('sparse-mesh' as ProfileTopology)) {
    EXTRA_TOPOLOGIES.forEach((extra) => {
      if (!plan.some((p) => p.topology === extra.topology && p.size === extra.size)) plan.push(extra);
    });
  }
  // Each case runs in its own child (one WASM load each) so a large-case
  // OOM or timeout kills only the child; the run always completes.
  const { execFile } = await import('node:child_process');
  const tsxBin = join(process.cwd(), 'node_modules/.bin/tsx');
  const scriptFile = join('scripts/gnss/gnssSelectedCovarianceProfile.ts');
  const runChild = (topology: ProfileTopology, size: number, index: number): Promise<ProfileCaseResult> =>
    new Promise((resolve) => {
      execFile(
        tsxBin,
        [scriptFile, `--case=${topology}@${size}`, `--case-index=${index}`, `--seed=${seedBase}`],
        { timeout: timeoutMs > 0 ? timeoutMs : undefined, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const marker = 'PROFILE_CASE_JSON:';
          const line = stdout.split('\n').find((l) => l.startsWith(marker));
          if (line) {
            try {
              resolve(JSON.parse(line.slice(marker.length)) as ProfileCaseResult);
              return;
            } catch { /* fall through to error record */ }
          }
          const tail = `${error?.message ?? 'child failed'} | ${stderr.trim().split('\n').slice(-3).join(' / ')}`;
          const killed = (error as { killed?: boolean } | null)?.killed === true;
          resolve({
            topology, stations: size, seed: seedBase + size * 131 + index * 17,
            status: killed ? 'timeout-skipped' : 'error', error: tail.slice(0, 500), totalWallMs: 0,
          });
        },
      );
    });
  const cases: ProfileCaseResult[] = [];
  for (const [index, item] of plan.entries()) {
    const seed = seedBase + item.size * 131 + index * 17;
    console.log(`profile [${index + 1}/${plan.length}]: ${item.topology}@${item.size} (seed ${seed})`);
    const result = await runChild(item.topology, item.size, index);
    console.log(`  -> ${result.status} in ${(result.totalWallMs / 1000).toFixed(1)}s`
      + `${result.status === 'ok' ? ` dominant=${result.dominant}` : ` ${result.error ?? ''}`}`);
    cases.push(result);
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    note: 'Phase 12F.2 §1 evidence only: real-WASM R2 selected-covariance profile; no production routing.',
    config: { sizes, topologies, seedBase, timeoutMs },
    dominantCostLabels: DOMINANT_COST_LABELS,
    cases,
  };
  mkdirSync(dirname(outBase), { recursive: true });
  writeFileSync(`${outBase}.json`, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(`${outBase}.md`, toMarkdown(cases));
  console.log(`profile: wrote ${outBase}.json/.md (${cases.filter((c) => c.status === 'ok').length}/${cases.length} ok)`);
};

if ((process.argv[1] ?? '').endsWith('gnssSelectedCovarianceProfile.ts')) await main();
