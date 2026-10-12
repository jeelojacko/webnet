/**
 * PERF-CAD-RENDER.1 — per-pass CAD render/lookup hot-path measurement.
 *
 * Measures, independently and with an equal harness:
 *   - `lookup`          buildCadProjectLookup(project)
 *   - `rawBuild`        buildCadDisplayScene(project, { lookup })  (flatten only)
 *   - `materialize`     filterCadDisplaySceneForViewport(project, rawBuild)
 *   - `fullPass`        filterCadDisplaySceneForViewport(project, buildCadDisplayScene(project))
 *                       (the real workspace per-render pass, lookup built inside)
 *   - `commit`/`undo`/`redo`  real history commands (MOVE on selected lines) followed
 *                       by the real full pass on the resulting project
 *
 * Fixtures are generated once per scale, strictly OUTSIDE every timed window.
 * Each operation is warmed up `WARMUP` times, then sampled across `SERIES`
 * interleaved series (operations rotate inside each series) so drift does not
 * favour one operation. Results are medians + spread, never gates.
 *
 * To isolate a single candidate, revert only that source file (the script
 * imports the real modules) and re-run; see
 * `docs/evidence/perf-cad-render-per-pass-1/validation.md`.
 *
 * Usage: `npx tsx scripts/perfCadRenderPerPassHotpath.ts [--quick] [--out <file>] [--tag <name>]`
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildCadProjectLookup } from '../src/engine/cad/cadProjectLookup';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { filterCadDisplaySceneForViewport } from '../src/engine/cad/cadViewportAppearance';
import type {
  CadBlockDefinition,
  CadDisplayPoint,
  CadEntity,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const QUICK = process.argv.includes('--quick');
const outArgIndex = process.argv.indexOf('--out');
const OUT = outArgIndex >= 0 ? process.argv[outArgIndex + 1] : undefined;
const tagArgIndex = process.argv.indexOf('--tag');
const TAG = tagArgIndex >= 0 ? process.argv[tagArgIndex + 1] : 'run';

const SCALES = QUICK ? [1_000, 10_000] : [1_000, 10_000];
const SERIES = QUICK ? 3 : 5;
const ITER = QUICK ? 3 : 4;
const WARMUP = 2;
const EDIT_SELECTION = 20;

const MIXED_BLOCK: CadBlockDefinition = {
  id: 'perf-mixed-block',
  name: 'Perf Mixed Block',
  basePoint: { x: 0, y: 0 },
  entities: [
    {
      id: 'perf-block-line',
      type: 'line',
      layerId: '0',
      visible: true,
      locked: false,
      fromStationId: 'A',
      toStationId: 'B',
      fromX: 0,
      fromY: 0,
      toX: 2,
      toY: 0,
      sourceObservationIds: [],
    },
    {
      id: 'perf-block-circle',
      type: 'circle',
      layerId: '0',
      visible: true,
      locked: false,
      centerX: 1,
      centerY: 1,
      radius: 0.5,
    },
  ],
};

const baseProject = (): CadProject =>
  createBlankCadDrawingDocument({ name: 'perf-cad-render', units: 'm' }).project;

const lineHeavyProject = (count: number): CadProject => {
  const project = baseProject();
  const entities: CadEntity[] = [];
  for (let index = 0; index < count; index += 1) {
    const x = (index % 100) * 10;
    const y = Math.floor(index / 100) * 10;
    entities.push({
      id: `line-${index}`,
      type: 'line',
      layerId: index % 7 === 0 ? 'observation-lines' : 'general',
      visible: index % 25 !== 0,
      locked: false,
      fromStationId: `L${index}A`,
      toStationId: `L${index}B`,
      fromX: x,
      fromY: y,
      toX: x + 8,
      toY: y + 3,
      sourceObservationIds: [],
    });
  }
  return { ...project, entities };
};

const pointAt = (index: number): CadDisplayPoint => ({
  x: (index % 100) * 10,
  y: Math.floor(index / 100) * 10,
});

const mixedProject = (count: number): CadProject => {
  const project = { ...baseProject(), blockDefinitions: [MIXED_BLOCK] };
  const entities: CadEntity[] = [];
  for (let index = 0; index < count; index += 1) {
    const p = pointAt(index);
    const id = `mixed-${index}`;
    const kind = index % 10;
    const visible = index % 25 !== 0;
    if (kind < 4) {
      entities.push({
        id,
        type: 'line',
        layerId: 'general',
        visible,
        locked: false,
        fromStationId: `${id}A`,
        toStationId: `${id}B`,
        fromX: p.x,
        fromY: p.y,
        toX: p.x + 8,
        toY: p.y + 3,
        sourceObservationIds: [],
      });
    } else if (kind < 6) {
      entities.push({
        id,
        type: 'polyline',
        layerId: 'general',
        visible,
        locked: false,
        vertices: [p, { x: p.x + 4, y: p.y }, { x: p.x + 4, y: p.y + 4 }],
        vertexLabels: ['A', 'B', 'C'],
        closed: false,
      });
    } else if (kind < 7) {
      entities.push({
        id,
        type: 'arc',
        layerId: 'general',
        visible,
        locked: false,
        centerX: p.x,
        centerY: p.y,
        radius: 4,
        startAngleDeg: 0,
        endAngleDeg: 120,
      });
    } else if (kind < 8) {
      entities.push({
        id,
        type: 'circle',
        layerId: 'general',
        visible,
        locked: false,
        centerX: p.x,
        centerY: p.y,
        radius: 2,
      });
    } else if (kind < 9) {
      const point: CadSurveyPointEntity = {
        id,
        type: 'survey-point',
        layerId: 'points',
        visible,
        locked: false,
        stationId: id,
        x: p.x,
        y: p.y,
        pointClass: 'free',
        source: 'parsed-input',
      };
      entities.push(point);
      entities.push({
        id: `${id}-label`,
        type: 'mtext',
        layerId: 'labels',
        visible,
        locked: false,
        x: p.x,
        y: p.y,
        text: `P${index}\nELEV`,
        textStyleId: 'label-default',
        rotationDeg: 0,
        attachment: 'middle-center',
      });
    } else {
      entities.push({
        id,
        type: 'block-reference',
        layerId: 'general',
        visible,
        locked: false,
        blockDefinitionId: MIXED_BLOCK.id,
        x: p.x,
        y: p.y,
        rotationDeg: 0,
        scaleX: 1,
        scaleY: 1,
      });
    }
  }
  return { ...project, entities };
};

type OpContext = unknown;

interface OpSpec {
  name: string;
  setup: () => OpContext;
  run: (_ctx: OpContext) => void;
}

const fullPass = (project: CadProject): number =>
  filterCadDisplaySceneForViewport(project, buildCadDisplayScene(project)).primitives.length;

const editSelectionIds = (project: CadProject): string[] =>
  project.entities
    .filter((entity) => entity.type === 'line' && entity.visible)
    .slice(0, EDIT_SELECTION)
    .map((entity) => entity.id);

const buildOps = (project: CadProject): OpSpec[] => {
  const lookup = buildCadProjectLookup(project);
  const selection = editSelectionIds(project);
  const baseHistory = createCadHistoryState(project, selection);
  const committed = runCadCommand(baseHistory, { key: 'MOVE', deltaX: 1, deltaY: 0 });
  const undone = undoCadHistory(committed);
  if (committed === baseHistory) throw new Error('MOVE rejected during fixture setup');

  return [
    {
      name: 'lookup',
      setup: () => null,
      run: () => {
        buildCadProjectLookup(project);
      },
    },
    {
      name: 'rawBuild',
      setup: () => lookup,
      run: (ctx) => {
        buildCadDisplayScene(project, { lookup: ctx as typeof lookup });
      },
    },
    {
      name: 'materialize',
      setup: () => {
        const built = buildCadDisplayScene(project, { lookup });
        return { built };
      },
      run: (ctx) => {
        filterCadDisplaySceneForViewport(project, (ctx as { built: ReturnType<typeof buildCadDisplayScene> }).built);
      },
    },
    {
      name: 'fullPass',
      setup: () => null,
      run: () => {
        fullPass(project);
      },
    },
    {
      name: 'commit',
      setup: () => createCadHistoryState(project, selection),
      run: (ctx) => {
        const next = runCadCommand(ctx as ReturnType<typeof createCadHistoryState>, {
          key: 'MOVE',
          deltaX: 1,
          deltaY: 0,
        });
        fullPass(next.present.project);
      },
    },
    {
      name: 'undo',
      setup: () => committed,
      run: (ctx) => {
        const next = undoCadHistory(ctx as typeof committed);
        fullPass(next.present.project);
      },
    },
    {
      name: 'redo',
      setup: () => undone,
      run: (ctx) => {
        const next = redoCadHistory(ctx as typeof undone);
        fullPass(next.present.project);
      },
    },
  ];
};

interface Summary {
  n: number;
  median: number;
  p25: number;
  p75: number;
  min: number;
  max: number;
  seriesMedians: number[];
}

const percentile = (sorted: readonly number[], fraction: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * fraction)));
  return sorted[index]!;
};

const summarize = (samples: number[], seriesMedians: number[]): Summary => {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: sorted.length,
    median: percentile(sorted, 0.5),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    seriesMedians,
  };
};

const measure = (project: CadProject, label: string): Record<string, Summary> => {
  const ops = buildOps(project);
  const samples = new Map<string, number[]>(ops.map((op) => [op.name, []]));
  const seriesMedians = new Map<string, number[]>(ops.map((op) => [op.name, []]));

  for (let warm = 0; warm < WARMUP; warm += 1) {
    for (const op of ops) op.run(op.setup());
  }
  for (let series = 0; series < SERIES; series += 1) {
    const perSeries = new Map<string, number[]>(ops.map((op) => [op.name, []]));
    for (let iter = 0; iter < ITER; iter += 1) {
      for (const op of ops) {
        const ctx = op.setup();
        const start = performance.now();
        op.run(ctx);
        const elapsed = performance.now() - start;
        samples.get(op.name)!.push(elapsed);
        perSeries.get(op.name)!.push(elapsed);
      }
    }
    for (const [name, values] of perSeries) {
      const sorted = [...values].sort((a, b) => a - b);
      seriesMedians.get(name)!.push(percentile(sorted, 0.5));
    }
  }

  const result: Record<string, Summary> = {};
  for (const op of ops) {
    const summary = summarize(samples.get(op.name)!, seriesMedians.get(op.name)!);
    result[op.name] = summary;
    console.log(
      `${label.padEnd(12)} ${op.name.padEnd(12)} median=${summary.median.toFixed(3)}ms ` +
        `p25=${summary.p25.toFixed(3)} p75=${summary.p75.toFixed(3)} ` +
        `spread=${(summary.max - summary.min).toFixed(3)}ms n=${summary.n}`,
    );
  }
  return result;
};

const fixtures: Record<string, CadProject> = {};
for (const scale of SCALES) {
  fixtures[`${scale}_line`] = lineHeavyProject(scale);
  fixtures[`${scale}_mixed`] = mixedProject(scale);
}

const output: { tag: string; fixtures: Record<string, Record<string, Summary>> } = {
  tag: TAG,
  fixtures: {},
};
for (const [label, project] of Object.entries(fixtures)) {
  output.fixtures[label] = measure(project, label);
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ ...output, generatedAt: new Date().toISOString() }, null, 2));
  console.log(`[${TAG}] wrote ${OUT}`);
}
