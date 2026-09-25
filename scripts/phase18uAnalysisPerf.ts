/**
 * Phase 18U analysis-band performance probe (measurement only).
 *
 * Deterministic synthetic grid TINs (mulberry32, fixed seeds). Three metrics:
 * - elevation: clip-per-triangle band polygons (includeDisplay true/false)
 * - slope: whole-face classification + display face rings
 * - depth: 18I clip/integrate pair pipeline with a signed-delta band partition
 *
 * Splits each metric into classification / polygon-creation / accumulation /
 * transfer (JSON payload proxy) / ingest (result → export regions) /
 * display-path generation (export items). Depth also measures the 18I
 * quantity baseline (`computeVolumeQuantities`) on the same meshes.
 *
 * Quantity-only vs display equivalence is asserted bitwise every run
 * (statistics are NEVER simplified). Timing verdicts are advisory (printed,
 * not gated); the process fails only when a compute throws or quantities
 * differ.
 *
 * Usage: `npx tsx scripts/phase18uAnalysisPerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';

import { analyzeElevationBands } from '../src/engine/cad/surfaceAnalysis/elevationBands';
import { analyzeSlopeBands } from '../src/engine/cad/surfaceAnalysis/slopeBands';
import { computeDepthBands } from '../src/engine/cad/surfaceAnalysis/depthBands';
import { generateEqualRanges } from '../src/engine/cad/surfaceAnalysis/rangeGenerator';
import type { AnalysisBand } from '../src/engine/cad/surfaceAnalysis/scalarClip';
import {
  analysisRegionsFromDepth,
  analysisRegionsFromElevation,
  analysisRegionsFromSlope,
} from '../src/engine/cad/cadAnalysisExportRegions';
import { buildAnalysisSheetItems, type CadAnalysisExportLayer } from '../src/engine/cad/cadAnalysisExportScene';
import type { CadAnalysisMap } from '../src/engine/cad/cadAnalysisTypes';
import { computeVolumeQuantities } from '../src/engine/cad/surfaces/volume/computeVolume';
import type { VolumeMesh } from '../src/engine/cad/surfaces/volume/volumeTypes';

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

interface GridMesh {
  xs: Float64Array;
  ys: Float64Array;
  zs: Float64Array;
  tris: Uint32Array;
  vertexCount: number;
}

/** Deterministic grid TIN with ~target triangle count. */
const buildGridMesh = (targetTris: number, zSeed: number, zOffset: number): GridMesh => {
  const cells = Math.max(1, Math.ceil(targetTris / 2));
  const cols = Math.ceil(Math.sqrt(cells));
  const rows = Math.ceil(cells / cols);
  const rand = mulberry32(zSeed);
  const jitter: number[] = [];
  for (let i = 0; i <= cols; i += 1) {
    for (let j = 0; j <= rows; j += 1) jitter.push(rand() * 2);
  }
  const vertexCount = (cols + 1) * (rows + 1);
  const xs = new Float64Array(vertexCount);
  const ys = new Float64Array(vertexCount);
  const zs = new Float64Array(vertexCount);
  const at = (i: number, j: number): number => i * (rows + 1) + j;
  for (let i = 0; i <= cols; i += 1) {
    for (let j = 0; j <= rows; j += 1) {
      const v = at(i, j);
      xs[v] = i * 10;
      ys[v] = j * 10;
      zs[v] = 100 + i * 0.5 + j * 0.3 + jitter[v]! + zOffset;
    }
  }
  const tris = new Uint32Array(cols * rows * 2 * 3);
  let t = 0;
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const a = at(i, j);
      const b = at(i + 1, j);
      const c = at(i + 1, j + 1);
      const d = at(i, j + 1);
      tris[t++] = a; tris[t++] = b; tris[t++] = c;
      tris[t++] = a; tris[t++] = c; tris[t++] = d;
    }
  }
  return { xs, ys, zs, tris, vertexCount };
};

const toVolumeMesh = (mesh: GridMesh): VolumeMesh => {
  const points = new Float64Array(mesh.vertexCount * 3);
  for (let i = 0; i < mesh.vertexCount; i += 1) {
    points[i * 3] = mesh.xs[i]!;
    points[i * 3 + 1] = mesh.ys[i]!;
    points[i * 3 + 2] = mesh.zs[i]!;
  }
  return { points, triangles: mesh.tris };
};

const bandsOf = (min: number, max: number, count: number): AnalysisBand[] =>
  generateEqualRanges(min, max, count).map((range) => ({ id: range.id, lower: range.lower, upper: range.upper }));

const exportMap = (id: string, bands: AnalysisBand[], metric: CadAnalysisMap['source']['metric']): CadAnalysisMap => ({
  id,
  name: id,
  source: metric === 'signed-depth'
    ? { kind: 'volume', volumeSurfaceId: 'vol-perf', metric: 'signed-depth' }
    : { kind: 'surface', surfaceId: 'surf-perf', metric },
  bands: bands.map((band, index) => ({ ...band, color: `#${(index % 10).toString(16)}${(index % 10).toString(16)}00ff` })),
});

const toPaper = (x: number, y: number): { xMm: number; yMm: number } => ({ xMm: x * 0.1, yMm: y * 0.1 });

const pathGenMs = (layer: CadAnalysisExportLayer): number => {
  const start = performance.now();
  buildAnalysisSheetItems({ layers: [layer] }, toPaper, 'clip-perf');
  return performance.now() - start;
};

const quantityView = (bands: readonly unknown[]): string =>
  JSON.stringify(bands.map((band) => {
    const { regions: _regions, ...quantities } = band as Record<string, unknown>;
    return quantities;
  }));

interface ScaleCase {
  label: string;
  tris: number;
}

const SCALES: ScaleCase[] = QUICK
  ? [{ label: '1k', tris: 1000 }, { label: '10k', tris: 10000 }]
  : [{ label: '1k', tris: 1000 }, { label: '10k', tris: 10000 }, { label: '50k', tris: 50000 }, { label: '100k', tris: 100000 }];

const BAND_COUNTS = QUICK ? [5, 10] : [5, 10, 20];

let failed = false;

console.log('metric\tscale\tbands\tclassifyMs\tdisplayMs\tpolyOverheadMs\tregionMs\tpathGenMs\tregions\theapMiB');

for (const scale of SCALES) {
  let mesh: GridMesh;
  try {
    mesh = buildGridMesh(scale.tris, 0x18b1, 0);
  } catch (error) {
    console.log(`elevation\t${scale.label}\t-\tFIXTURE FAILED: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
    failed = true;
    break;
  }
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < mesh.vertexCount; i += 1) {
    minZ = Math.min(minZ, mesh.zs[i]!);
    maxZ = Math.max(maxZ, mesh.zs[i]!);
  }
  for (const bandCount of BAND_COUNTS) {
    const bands = bandsOf(minZ, maxZ, bandCount);
    const classify: number[] = [];
    const display: number[] = [];
    const region: number[] = [];
    const path: number[] = [];
    let regions = 0;
    for (let run = 0; run < RUNS; run += 1) {
      let start = performance.now();
      const plain = analyzeElevationBands(mesh, bands, { includeDisplay: false });
      classify.push(performance.now() - start);
      start = performance.now();
      const withDisplay = analyzeElevationBands(mesh, bands, { includeDisplay: true });
      display.push(performance.now() - start);
      if (quantityView(plain.bands) !== quantityView(withDisplay.bands)) {
        console.error(`elevation ${scale.label} bands=${bandCount}: QUANTITY MISMATCH`);
        failed = true;
        break;
      }
      start = performance.now();
      const exportRegions = analysisRegionsFromElevation(withDisplay);
      region.push(performance.now() - start);
      regions = exportRegions.reduce((sum, entry) => sum + entry.rings.length, 0);
      path.push(pathGenMs({
        map: exportMap(`elev-${bandCount}`, bands, 'elevation'),
        status: 'CURRENT',
        regions: exportRegions,
      }));
    }
    if (failed) break;
    const dispMed = median(display);
    console.log([
      'elevation', scale.label, bandCount,
      median(classify).toFixed(1), dispMed.toFixed(1), (dispMed - median(classify)).toFixed(1),
      median(region).toFixed(1), median(path).toFixed(1), regions,
      (process.memoryUsage().heapUsed / 1048576).toFixed(1),
    ].join('\t'));
  }
  if (failed) break;

  for (const bandCount of BAND_COUNTS) {
    const bands = bandsOf(0, 300, bandCount);
    const classify: number[] = [];
    const region: number[] = [];
    const path: number[] = [];
    let regions = 0;
    for (let run = 0; run < RUNS; run += 1) {
      let start = performance.now();
      const result = analyzeSlopeBands(mesh, bands, 'slope-percent');
      classify.push(performance.now() - start);
      start = performance.now();
      const exportRegions = analysisRegionsFromSlope(mesh, bands, 'slope-percent');
      region.push(performance.now() - start);
      regions = exportRegions.reduce((sum, entry) => sum + entry.rings.length, 0);
      const map = exportMap(`slope-${bandCount}`, bands, 'slope-percent');
      path.push(pathGenMs({ map, status: 'CURRENT', regions: exportRegions }));
      if (run === 0 && result.totals.unclassifiedTriangles === 0 && regions === 0) {
        console.error(`slope ${scale.label} bands=${bandCount}: no classified faces`);
        failed = true;
      }
    }
    if (failed) break;
    console.log([
      'slope', scale.label, bandCount,
      median(classify).toFixed(1), median(region).toFixed(1), '-',
      median(region).toFixed(1), median(path).toFixed(1), regions,
      (process.memoryUsage().heapUsed / 1048576).toFixed(1),
    ].join('\t'));
  }
  if (failed) break;
}

const DEPTH_SCALES: ScaleCase[] = SCALES;
console.log('metric\tscale\tbands\tindexMs\tqtyMs\tdisplayMs\tpolyOverheadMs\tbaseline18iMs\tregionMs\tpathGenMs\tregions\theapMiB');
for (const scale of DEPTH_SCALES) {
  let base: GridMesh;
  let cmp: GridMesh;
  try {
    base = buildGridMesh(scale.tris, 0x18b1, 0);
    cmp = buildGridMesh(scale.tris, 0x18b2, 0.75);
  } catch (error) {
    console.log(`depth\t${scale.label}\t-\tFIXTURE FAILED: ${error instanceof Error ? error.message.slice(0, 120) : error}`);
    failed = true;
    break;
  }
  const baseVolume = toVolumeMesh(base);
  const cmpVolume = toVolumeMesh(cmp);
  for (const bandCount of BAND_COUNTS.filter((count) => count <= 10)) {
    const bands = bandsOf(-2, 2, bandCount);
    const qty: number[] = [];
    const display: number[] = [];
    const baseline: number[] = [];
    const region: number[] = [];
    const path: number[] = [];
    let regions = 0;
    for (let run = 0; run < RUNS; run += 1) {
      let start = performance.now();
      const plain = computeDepthBands(baseVolume, cmpVolume, bands, { includeDisplay: false });
      qty.push(performance.now() - start);
      start = performance.now();
      const withDisplay = computeDepthBands(baseVolume, cmpVolume, bands, { includeDisplay: true });
      display.push(performance.now() - start);
      if (quantityView(plain.bands as never) !== quantityView(withDisplay.bands as never)) {
        console.error(`depth ${scale.label} bands=${bandCount}: QUANTITY MISMATCH`);
        failed = true;
        break;
      }
      start = performance.now();
      computeVolumeQuantities(baseVolume, cmpVolume, { includeDisplay: false });
      baseline.push(performance.now() - start);
      start = performance.now();
      const exportRegions = analysisRegionsFromDepth(withDisplay);
      region.push(performance.now() - start);
      regions = exportRegions.reduce((sum, entry) => sum + entry.rings.length, 0);
      const map = exportMap(`depth-${bandCount}`, bands, 'signed-depth');
      path.push(pathGenMs({ map, status: 'CURRENT', regions: exportRegions }));
    }
    if (failed) break;
    const dispMed = median(display);
    console.log([
      'depth', scale.label, bandCount,
      '-', median(qty).toFixed(1), dispMed.toFixed(1), (dispMed - median(qty)).toFixed(1),
      median(baseline).toFixed(1), median(region).toFixed(1), median(path).toFixed(1), regions,
      (process.memoryUsage().heapUsed / 1048576).toFixed(1),
    ].join('\t'));
  }
  if (failed) break;
}

if (failed) process.exit(1);
