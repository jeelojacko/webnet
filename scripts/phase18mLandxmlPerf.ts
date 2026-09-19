/**
 * Phase 18M LandXML production-path performance probe (measurement only).
 *
 * Generates explicit-TIN LandXML text at 10k / 50k vertices (never committed;
 * see tests/landxmlLargeTinFixtures.ts) and splits the production path into
 * the stages the browser must survive:
 *
 *   read   — fs read of the generated file (browser file-read proxy)
 *   review — buildLandXmlImportPreview (parse + review projection)
 *   commit — commitLandXmlImport ONE transaction, deferMeshBuild (no mesh)
 *   build  — buildCadSurface materialization of the imported TIN
 *   touch  — first interaction proxy: getSurfaceElevationAt on the built mesh
 *
 * Timing verdicts are advisory (printed, not gated); the process fails only
 * when a stage throws or reports an unexpected outcome. No src/ changes.
 *
 * Usage: `npx tsx scripts/phase18mLandxmlPerf.ts [--quick]`
 */
import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import { commitLandXmlImport } from '../src/engine/cad/cadLandxmlCommit';
import type { LandXmlCommitSelection } from '../src/engine/cad/cadLandxmlCommit';
import type { LandXmlImportPreview } from '../src/engine/landxmlImport';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { getSurfaceElevationAt } from '../src/engine/cad/cadSurfaceInterpolation';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { buildLargeTinXml, factorLargeTinGrid, writeLargeTinXml } from '../tests/landxmlLargeTinFixtures';

/** 18M production commit adds `deferMeshBuild` + `importedSurfaceIds`; widened to stay runnable on the 18L baseline. */
const commitDeferred = (
  state: ReturnType<typeof createCadHistoryState>,
  cache: ReturnType<typeof createCadSurfaceCache>,
  preview: LandXmlImportPreview,
  fileName: string,
  selection: LandXmlCommitSelection,
  options: { deferMeshBuild: boolean },
) =>
  (
    commitLandXmlImport as unknown as (
      _s: ReturnType<typeof createCadHistoryState>,
      _c: ReturnType<typeof createCadSurfaceCache>,
      _p: LandXmlImportPreview,
      _f: string,
      _sel?: LandXmlCommitSelection,
      _opt?: { deferMeshBuild?: boolean },
    ) => {
      state: ReturnType<typeof commitLandXmlImport>['state'];
      report: ReturnType<typeof commitLandXmlImport>['report'] & {
        importedSurfaceIds?: readonly string[];
      };
    }
  )(state, cache, preview, fileName, selection, options);

const QUICK = process.argv.includes('--quick');
const RUNS = 3;
const SCALES = QUICK ? [10_000] : [10_000, 50_000];

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const timed = <T>(run: () => T): { value: T; ms: number } => {
  const start = performance.now();
  const value = run();
  return { value, ms: performance.now() - start };
};

interface Row {
  vertices: number;
  faces: number;
  xmlKiB: number;
  readMs: number;
  reviewMs: number;
  commitMs: number;
  buildMs: number;
  touchMs: number;
  heapMiB: number;
}

const runScale = (vertexCount: number): Row => {
  const grid = factorLargeTinGrid(vertexCount);
  const generated = buildLargeTinXml(vertexCount, { surfaceName: `Large TIN ${vertexCount}` });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `webnet-18m-perf-${vertexCount}-`));
  const filePath = writeLargeTinXml(dir, vertexCount, {
    surfaceName: `Large TIN ${vertexCount}`,
    baseName: 'large',
  });

  const readTimes: number[] = [];
  const reviewTimes: number[] = [];
  const commitTimes: number[] = [];
  const buildTimes: number[] = [];
  const touchTimes: number[] = [];

  for (let run = 0; run < RUNS; run += 1) {
    const read = timed(() => fs.readFileSync(filePath, 'utf8'));
    readTimes.push(read.ms);

    const review = timed(() => buildLandXmlImportPreview(read.value, { fileName: 'large.xml' }));
    reviewTimes.push(review.ms);
    if (review.value.surfaces.length !== 1) throw new Error(`${vertexCount}: preview lost the surface`);
    if (review.value.surfaces[0]!.vertices.length !== vertexCount * 3) {
      throw new Error(`${vertexCount}: preview vertex count mismatch`);
    }

    const history = createCadHistoryState(createBlankCadProject({ name: 'perf', units: 'm' }));
    const cache = createCadSurfaceCache(`perf-${vertexCount}-${run}`);
    const committed = timed(() =>
      commitDeferred(history, cache, review.value, 'large.xml', {}, { deferMeshBuild: true }),
    );
    commitTimes.push(committed.ms);
    const { report, state } = committed.value;
    if (!report.committed) throw new Error(`${vertexCount}: commit failed`);
    const surface = state.present.project.surfaces!.find(
      (entry) => entry.id === (report.importedSurfaceIds?.[0] ?? state.present.project.surfaces![0]!.id),
    )!;

    const built = timed(() => buildCadSurface(state.present.project, surface));
    buildTimes.push(built.ms);
    if (built.value.outcome !== 'ok') throw new Error(`${vertexCount}: materialization ${built.value.outcome}`);

    touchTimes.push(timed(() => getSurfaceElevationAt(built.value, 10, 10)).ms);
  }

  const row: Row = {
    vertices: vertexCount,
    faces: grid.faceCount,
    xmlKiB: Buffer.byteLength(generated, 'utf8') / 1024,
    readMs: median(readTimes),
    reviewMs: median(reviewTimes),
    commitMs: median(commitTimes),
    buildMs: median(buildTimes),
    touchMs: median(touchTimes),
    heapMiB: process.memoryUsage().heapUsed / 1048576,
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return row;
};

console.log('vertices\tfaces\txmlKiB\treadMs\treviewMs\tcommitMs\tbuildMs\ttouchMs\theapMiB');
for (const scale of SCALES) {
  const row = runScale(scale);
  console.log(
    `${row.vertices}\t${row.faces}\t${row.xmlKiB.toFixed(0)}\t${row.readMs.toFixed(1)}\t` +
      `${row.reviewMs.toFixed(1)}\t${row.commitMs.toFixed(1)}\t${row.buildMs.toFixed(1)}\t` +
      `${row.touchMs.toFixed(3)}\t${row.heapMiB.toFixed(1)}`,
  );
}
