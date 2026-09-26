/**
 * Phase 19A perf evidence (§§119-120). Measurement only, no src/ changes.
 *
 * Times `deriveCadSurveyTable` / `cadSurveyTableWorldBounds` / SVG export
 * scene + serialization at 100 / 1,000 / 10,000 rows (point table is the
 * practical large case; line table too), plus the incremental source-update
 * case: 10 tables x 100 rows, edit one source, time re-derive of the
 * affected table vs all tables. Reports scaling exponents to confirm no
 * O(rows^2) blowup (relevant: row resolution does a linear entity scan per
 * row, so derive is expected ~quadratic in table size — the question for
 * §120 is whether absolute times still make memoization unnecessary).
 *
 * Usage: `npx tsx scripts/phase19aTablePerf.ts [--quick]`
 *   --quick trims to 100 / 1,000 and fewer reps.
 */
import { performance } from 'node:perf_hooks';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument } from '../src/engine/cad/cadDraftTypes';
import { addSheetToDraft, addViewportToSheet, createPlanSheet } from '../src/engine/cad/cadSheets';
import { buildExportSheetScene } from '../src/engine/cad/cadExportScene';
import { serializeExportSceneToSvg } from '../src/engine/cad/cadSvgSerializer';
import { cadSurveyTableWorldBounds, deriveCadSurveyTable } from '../src/engine/cad/cadSurveyTableDerive';
import { createCadSurveyTableRow } from '../src/engine/cad/cadSurveyTables';
import type {
  CadEntity,
  CadLineEntity,
  CadProject,
  CadSurveyPointEntity,
  CadSurveyTableEntity,
} from '../src/engine/cad/cadTypes';

const QUICK = process.argv.includes('--quick');
const SCALES = QUICK ? [100, 1_000] : [100, 1_000, 10_000];
const REPS = QUICK ? 2 : 5;

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const medianMs = (fn: () => void): number => {
  fn(); // warmup (JIT + caches) outside the measurement
  const samples: number[] = [];
  for (let i = 0; i < REPS; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  return median(samples);
};

/** Scaling exponent between two (n, ms) points: 1 = linear, 2 = quadratic. */
const exponent = (n1: number, t1: number, n2: number, t2: number): number =>
  t1 <= 0 || t2 <= 0 ? Number.NaN : Math.log(t2 / t1) / Math.log(n2 / n1);

const layerIdFor = (project: CadProject): string =>
  project.currentLayerId ?? project.layers[0]?.id ?? 'general';

const buildPointSources = (project: CadProject, count: number, tag: string): CadSurveyPointEntity[] => {
  const layerId = layerIdFor(project);
  const points: CadSurveyPointEntity[] = [];
  for (let i = 0; i < count; i += 1) {
    points.push({
      id: `${tag}-pt-${i}`,
      type: 'survey-point',
      layerId,
      visible: true,
      locked: false,
      stationId: `${tag}${i + 1}`,
      x: 5000 + (i % 100) * 10,
      y: 1000 + Math.floor(i / 100) * 10,
      z: 100 + i * 0.01,
      pointClass: 'free',
      source: 'parsed-input',
    });
  }
  return points;
};

const buildLineSources = (project: CadProject, count: number, tag: string): CadLineEntity[] => {
  const layerId = layerIdFor(project);
  const lines: CadLineEntity[] = [];
  for (let i = 0; i < count; i += 1) {
    const fromX = 5000 + (i % 100) * 10;
    const fromY = 1000 + Math.floor(i / 100) * 10;
    lines.push({
      id: `${tag}-ln-${i}`,
      type: 'line',
      layerId,
      visible: true,
      locked: false,
      fromStationId: `${tag}A${i + 1}`,
      toStationId: `${tag}B${i + 1}`,
      fromX,
      fromY,
      toX: fromX + 8,
      toY: fromY + 6,
      sourceObservationIds: [],
    });
  }
  return lines;
};

const buildTable = (
  project: CadProject,
  tableKind: CadSurveyTableEntity['tableKind'],
  rows: CadSurveyTableEntity['rows'],
  id: string,
): CadSurveyTableEntity => ({
  id,
  type: 'survey-table',
  layerId: layerIdFor(project),
  visible: true,
  locked: false,
  tableKind,
  x: 0,
  y: 0,
  rotationDeg: 0,
  tableStyleId: 'survey-table-style-standard',
  rows,
});

const buildPointTableProject = (count: number): { project: CadProject; table: CadSurveyTableEntity } => {
  const project = createBlankCadProject({ name: 'Perf 19A point', units: 'm' });
  const points = buildPointSources(project, count, 'P');
  const table = buildTable(
    project,
    'point',
    points.map((point) => createCadSurveyTableRow({ kind: 'survey-point', entityId: point.id })),
    'tbl-point',
  );
  return { project: { ...project, entities: [...points, table] as CadEntity[] }, table };
};

const buildLineTableProject = (count: number): { project: CadProject; table: CadSurveyTableEntity } => {
  const project = createBlankCadProject({ name: 'Perf 19A line', units: 'm' });
  const lines = buildLineSources(project, count, 'L');
  const table = buildTable(
    project,
    'line',
    lines.map((line) => createCadSurveyTableRow({ kind: 'line', entityId: line.id })),
    'tbl-line',
  );
  return { project: { ...project, entities: [...lines, table] as CadEntity[] }, table };
};

const buildSheet = (project: CadProject): { draft: ReturnType<typeof createBlankDraftDocument>; sheetId: string } => {
  let draft = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'Perf', sizeId: 'ISO A4', orientation: 'landscape' }));
  const sheetId = draft.sheets[0]?.id as string;
  draft = addViewportToSheet(draft, sheetId, {
    name: 'Perf viewport',
    modelCenterX: 5500,
    modelCenterY: 1500,
    scaleDenominator: 500,
    paperXmm: 15,
    paperYmm: 15,
    paperWidthMm: 200,
    paperHeightMm: 130,
  });
  return { draft, sheetId };
};

interface ScaleRow {
  rows: number;
  deriveMs: number;
  boundsMs: number;
  sceneMs: number;
  svgMs: number;
}

const measureScale = (
  build: (_count: number) => { project: CadProject; table: CadSurveyTableEntity },
  count: number,
): ScaleRow => {
  const { project, table } = build(count);
  const deriveMs = medianMs(() => {
    deriveCadSurveyTable(table, project);
  });
  const boundsMs = medianMs(() => {
    cadSurveyTableWorldBounds(table, project);
  });
  const { draft, sheetId } = buildSheet(project);
  const sceneMs = medianMs(() => {
    buildExportSheetScene({ draft, sheetId, project });
  });
  const scene = buildExportSheetScene({ draft, sheetId, project }).scene;
  const svgMs = medianMs(() => {
    serializeExportSceneToSvg(scene);
  });
  return { rows: count, deriveMs, boundsMs, sceneMs, svgMs };
};

console.log('[19A-PERF] point table (derive / bounds / export-scene / svg, ms median)');
const pointRows = SCALES.map((count) => measureScale(buildPointTableProject, count));
for (const row of pointRows) {
  console.log(
    `  rows=${row.rows.toString().padStart(5)}  derive=${row.deriveMs.toFixed(1)}` +
    `  bounds=${row.boundsMs.toFixed(1)}  scene=${row.sceneMs.toFixed(1)}  svg=${row.svgMs.toFixed(1)}`,
  );
}

console.log('[19A-PERF] line table (derive / bounds / export-scene / svg, ms median)');
const lineRows = SCALES.map((count) => measureScale(buildLineTableProject, count));
for (const row of lineRows) {
  console.log(
    `  rows=${row.rows.toString().padStart(5)}  derive=${row.deriveMs.toFixed(1)}` +
    `  bounds=${row.boundsMs.toFixed(1)}  scene=${row.sceneMs.toFixed(1)}  svg=${row.svgMs.toFixed(1)}`,
  );
}

const reportExponents = (label: string, rows: ScaleRow[]): void => {
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1]!;
    const curr = rows[i]!;
    console.log(
      `  ${label} ${prev.rows}->${curr.rows}: derive x${exponent(prev.rows, prev.deriveMs, curr.rows, curr.deriveMs).toFixed(2)}` +
      `  bounds x${exponent(prev.rows, prev.boundsMs, curr.rows, curr.boundsMs).toFixed(2)}` +
      `  scene x${exponent(prev.rows, prev.sceneMs, curr.rows, curr.sceneMs).toFixed(2)}` +
      `  svg x${exponent(prev.rows, prev.svgMs, curr.rows, curr.svgMs).toFixed(2)}`,
    );
  }
};

console.log('[19A-PERF] scaling exponents (1.00 = linear, 2.00 = quadratic)');
reportExponents('point', pointRows);
reportExponents('line', lineRows);

// ---------------------------------------------------------------------------
// Incremental source update: 10 tables x 100 rows, edit one source point.
// Derivation is stateless (read-time), so "incremental" = re-derive only
// the affected table; measure that against re-deriving all ten.
// ---------------------------------------------------------------------------
console.log('[19A-PERF] incremental update (10 tables x 100 rows, one source edited)');
const TABLE_COUNT = 10;
const ROWS_PER_TABLE = 100;
const incBase = createBlankCadProject({ name: 'Perf 19A incremental', units: 'm' });
const incPoints = buildPointSources(incBase, TABLE_COUNT * ROWS_PER_TABLE, 'I');
const incTables: CadSurveyTableEntity[] = [];
for (let t = 0; t < TABLE_COUNT; t += 1) {
  const slice = incPoints.slice(t * ROWS_PER_TABLE, (t + 1) * ROWS_PER_TABLE);
  incTables.push(buildTable(
    incBase,
    'point',
    slice.map((point) => createCadSurveyTableRow({ kind: 'survey-point', entityId: point.id })),
    `tbl-inc-${t}`,
  ));
}
const edited = incPoints[0]!;
const movedPoint: CadSurveyPointEntity = { ...edited, x: edited.x + 1.5, y: edited.y - 0.5 };
const incProject: CadProject = {
  ...incBase,
  entities: [
    ...incPoints.map((point) => (point.id === movedPoint.id ? movedPoint : point)),
    ...incTables,
  ] as CadEntity[],
};
// Sanity: the edit must actually flow through to the derived row.
const affectedBefore = deriveCadSurveyTable(incTables[0]!, {
  ...incProject,
  entities: [...incPoints, ...incTables] as CadEntity[],
}).rows[0]?.cells.join('|');
const affectedAfter = deriveCadSurveyTable(incTables[0]!, incProject).rows[0]?.cells.join('|');
if (affectedBefore === affectedAfter) throw new Error('incremental edit did not change the derived row');
const singleMs = medianMs(() => {
  deriveCadSurveyTable(incTables[0]!, incProject);
});
const allMs = medianMs(() => {
  for (const table of incTables) deriveCadSurveyTable(table, incProject);
});
console.log(`  re-derive affected table only: ${singleMs.toFixed(2)}ms`);
console.log(`  re-derive all ${TABLE_COUNT} tables: ${allMs.toFixed(2)}ms`);

console.log('[19A-PERF] JSON');
console.log(JSON.stringify({ pointRows, lineRows, incremental: { singleMs, allMs } }));
