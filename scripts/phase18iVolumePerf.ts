/**
 * Phase 18I TIN-to-TIN volume performance probe (measurement only).
 *
 * Deterministic synthetic grid TINs (mulberry32, fixed seeds — no unfixed
 * randomness). Base and comparison share the same footprint (full overlap,
 * worst case for pair count); comparison Z = base Z + tilt so both cut and
 * fill regions exist. Splits the cost into: candidate-index build+query
 * (findOverlappingPairs) / quantity-only compute (computeVolumeQuantities
 * includeDisplay:false) / display compute (includeDisplay:true) / worker
 * path (compute + toCadVolumeResult, the exact fns the volume worker op
 * runs) / result-cache ingest (createCadSurfaceVolumeCache set+get).
 *
 * No src/ behavior changes. Timing verdicts are advisory (printed, not
 * gated); the process fails only when a compute throws or quantity/display
 * quantities differ.
 *
 * Usage: `npx tsx scripts/phase18iVolumePerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { createCadSurfaceVolumeCache } from '../src/engine/cad/surfaceVolumeCache';
import { findOverlappingPairs } from '../src/engine/cad/surfaces/volume/bboxIndex';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type { VolumeMesh } from '../src/engine/cad/surfaces/volume/volumeTypes';
import { toCadVolumeResult } from '../src/workers/surfaceVolumeEngine';

const QUICK = process.argv.includes('--quick');
const RUNS = 3;

const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

/** Deterministic grid TIN with ~target triangle count; zSeed varies surface. */
const buildGridMesh = (targetTris: number, zSeed: number, zOffset: number): VolumeMesh => {
  const cells = Math.max(1, Math.ceil(targetTris / 2));
  const cols = Math.ceil(Math.sqrt(cells));
  const rows = Math.ceil(cells / cols);
  const rand = mulberry32(zSeed);
  const jitter: number[] = [];
  for (let i = 0; i <= cols; i += 1) {
    for (let j = 0; j <= rows; j += 1) {
      jitter.push(rand() * 2);
    }
  }
  const at = (i: number, j: number): number => i * (rows + 1) + j;
  const points = new Float64Array((cols + 1) * (rows + 1) * 3);
  for (let i = 0; i <= cols; i += 1) {
    for (let j = 0; j <= rows; j += 1) {
      const o = at(i, j) * 3;
      points[o] = i * 10;
      points[o + 1] = j * 10;
      // Tilted plane + jitter: comparison offset creates mixed cut/fill.
      points[o + 2] = 100 + i * 0.5 + j * 0.3 + jitter[at(i, j)] + zOffset;
    }
  }
  const triangles = new Uint32Array(cols * rows * 2 * 3);
  let t = 0;
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      triangles[t++] = a; triangles[t++] = b; triangles[t++] = c;
      triangles[t++] = a; triangles[t++] = c; triangles[t++] = d;
    }
  }
  return { points, triangles };
};

interface ScaleCase {
  label: string;
  baseTris: number;
  cmpTris: number;
}

const SCALES: ScaleCase[] = QUICK
  ? [
    { label: '1k/1k', baseTris: 1000, cmpTris: 1000 },
    { label: '10k/10k', baseTris: 10000, cmpTris: 10000 },
  ]
  : [
    { label: '1k/1k', baseTris: 1000, cmpTris: 1000 },
    { label: '10k/10k', baseTris: 10000, cmpTris: 10000 },
    { label: '50k/50k', baseTris: 50000, cmpTris: 50000 },
    { label: '1k-vs-10k', baseTris: 1000, cmpTris: 10000 },
    { label: '10k-vs-1k', baseTris: 10000, cmpTris: 1000 },
    { label: '100k/100k', baseTris: 100000, cmpTris: 100000 },
  ];

let failed = false;
console.log('scale\tindexMs\tqtyMs\tdispMs\tdispOverheadMs\tworkerMs\tingestMs\tpairs\tpolys\tcutVol\tfillVol\tregions');
for (const scale of SCALES) {
  const started = performance.now();
  let base: VolumeMesh;
  let cmp: VolumeMesh;
  try {
    base = buildGridMesh(scale.baseTris, 0x18b1, 0);
    cmp = buildGridMesh(scale.cmpTris, 0x18b2, 0.75);
  } catch (error) {
    console.log(`${scale.label}\tFIXTURE FAILED: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
    continue;
  }
  const baseCount = base.triangles.length / 3;
  const cmpCount = cmp.triangles.length / 3;
  const indexTimes: number[] = [];
  const qtyTimes: number[] = [];
  const dispTimes: number[] = [];
  const workerTimes: number[] = [];
  const ingestTimes: number[] = [];
  let pairs = 0;
  let polys = 0;
  let cutVol = 0;
  let fillVol = 0;
  let regionCount = 0;
  let qtyJson = '';
  const cache = createCadSurfaceVolumeCache('perf');
  for (let run = 0; run < RUNS; run += 1) {
    if (performance.now() - started > 60000) {
      console.log(`${scale.label}\tTIME BUDGET EXCEEDED (>60s) — partial results only`);
      break;
    }
    let start = performance.now();
    findOverlappingPairs(base, cmp);
    indexTimes.push(performance.now() - start);
    start = performance.now();
    const qty = computeVolumeQuantities(base, cmp, { includeDisplay: false });
    qtyTimes.push(performance.now() - start);
    start = performance.now();
    const disp = computeVolumeQuantities(base, cmp, { includeDisplay: true });
    dispTimes.push(performance.now() - start);
    // Quantity parity between modes (contract: identical quantities).
    const qj = JSON.stringify(disp.quantities);
    if (run === 0) qtyJson = JSON.stringify(qty.quantities);
    if (JSON.stringify(qty.quantities) !== qj) {
      console.error(`${scale.label}: QUANTITY MISMATCH qty vs display mode`);
      failed = true;
      break;
    }
    start = performance.now();
    const engineResult = computeVolumeQuantities(base, cmp, { includeDisplay: false });
    const cadResult = toCadVolumeResult(
      {
        baseSurfaceId: 's-base', comparisonSurfaceId: 's-cmp', revision: `r${run}`,
        base, comparison: cmp, includeDisplay: false,
      },
      engineResult,
    );
    workerTimes.push(performance.now() - start);
    start = performance.now();
    cache.set('v-perf', cadResult);
    cache.get('v-perf', cadResult.revision);
    ingestTimes.push(performance.now() - start);
    pairs = qty.quantities.pairCount;
    polys = qty.quantities.polygonCount;
    cutVol = qty.quantities.cutVolume;
    fillVol = qty.quantities.fillVolume;
    regionCount = disp.regions.length;
  }
  if (failed) break;
  if (indexTimes.length === 0) continue;
  const qtyMed = median(qtyTimes);
  const dispMed = median(dispTimes);
  console.log(
    `${scale.label}\t${median(indexTimes).toFixed(1)}\t${qtyMed.toFixed(1)}\t${dispMed.toFixed(1)}`
    + `\t${(dispMed - qtyMed).toFixed(1)}\t${median(workerTimes).toFixed(1)}\t${median(ingestTimes).toFixed(3)}`
    + `\t${pairs}\t${polys}\t${cutVol.toFixed(2)}\t${fillVol.toFixed(2)}\t${regionCount}`
    + `\t(base ${baseCount} tris, cmp ${cmpCount} tris, heap ${(process.memoryUsage().heapUsed / 1048576).toFixed(1)} MiB)`,
  );
  void qtyJson;
}
if (failed) process.exit(1);
