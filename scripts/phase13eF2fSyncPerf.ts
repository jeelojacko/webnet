/**
 * Phase 13E §52 — F2F coordinate-only sync performance probe (measurement only).
 *
 * Builds synthetic linked F2F docs at 1k and 10k points with substantial
 * linework, moves ONE station, and times rerun propagation
 * (applyAdjustmentRerunToLinkedF2f) against a full payload rebuild
 * (buildFieldToFinishPayload). Asserts the partial-update property: only
 * dependents of the moved station are touched (updated ≪ total).
 *
 * No src/ behavior changes, no tier wiring (per repo rules long campaigns
 * stay out of test:agent). Timing verdicts are advisory (printed, not
 * gated); the process fails only when the partial-update property breaks.
 *
 * Usage: `tsx scripts/phase13eF2fSyncPerf.ts [--quick]`
 *   --quick trims scales to 1k only and reduces reps (smoke check).
 */
import { performance } from 'node:perf_hooks';

import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import type { AdjustmentResult } from '../src/types';
import type { Station } from '../src/typesObservations';
import {
  buildFieldToFinishPayload,
  buildFieldToFinishProject,
  type FieldToFinishCadPoint,
} from '../src/engine/fieldToFinish/cadGeneration';
import { applyAdjustmentRerunToLinkedF2f } from '../src/engine/fieldToFinish/regeneration';
import { FieldLineworkControl } from '../src/engine/fieldToFinish/featureMetadata';
import { SAMPLE_CATALOG } from '../src/engine/fieldToFinish/sampleCatalog';

const QUICK = process.argv.includes('--quick');
const SCALES = QUICK ? [1000] : [1000, 10000];
const WARMUPS = QUICK ? 1 : 2;
const RUNS = QUICK ? 3 : 7;
const MOVE_DX = 0.5;
const MOVE_DY = 0.25;

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
};

const CHAIN_LEN = 20;

/**
 * Serpentine grid with BEGIN/CONTINUE/END EDGE chains of CHAIN_LEN points
 * (substantial linework) plus every 50th point a TREE isolate.
 */
const buildPoints = (n: number): FieldToFinishCadPoint[] => {
  const points: FieldToFinishCadPoint[] = [];
  const cols = Math.ceil(Math.sqrt(n));
  for (let i = 0; i < n; i += 1) {
    const row = Math.floor(i / cols);
    const col = row % 2 === 0 ? i % cols : cols - 1 - (i % cols);
    const id = `S${String(i).padStart(6, '0')}`;
    const tree = i % 50 === 49;
    const slot = i % CHAIN_LEN;
    const control = tree
      ? undefined
      : slot === 0
        ? FieldLineworkControl.BEGIN
        : slot === CHAIN_LEN - 1
          ? FieldLineworkControl.END
          : FieldLineworkControl.CONTINUE;
    points.push({
      stationId: id,
      x: col * 10,
      y: row * 10,
      z: (i % 7) * 0.1,
      sourceOrder: i + 1,
      sourceLine: i + 1,
      rawCodeText: tree ? 'TREE' : 'EDGE',
      codes: control !== undefined
        ? [{ code: 'EDGE', rawCode: 'EDGE', controls: [control] }]
        : [{ code: 'TREE', rawCode: 'TREE' }],
      sourceImportId: 'perf13e',
    });
  }
  return points;
};

const toStations = (points: FieldToFinishCadPoint[]): Record<string, Station> => {
  const stations: Record<string, Station> = {};
  for (const point of points) {
    stations[point.stationId] = { x: point.x, y: point.y, h: point.z ?? 0, fixed: false };
  }
  return stations;
};

const fakeResult = (stations: Record<string, Station>): AdjustmentResult =>
  ({ success: true, stations, observations: [], logs: [] }) as unknown as AdjustmentResult;

const time = (fn: () => void): number => {
  const start = performance.now();
  fn();
  return performance.now() - start;
};

interface ScaleReport {
  points: number;
  entities: number;
  linework: number;
  fullMedianMs: number;
  partialMedianMs: number;
  updated: number;
  affected: number;
  movedStation: string;
}

const failures: string[] = [];

const measureScale = (n: number): ScaleReport => {
  const points = buildPoints(n);
  const project = buildFieldToFinishProject(createBlankCadProject({ name: `Perf13E-${n}`, units: 'm' }), {
    points,
    catalog: SAMPLE_CATALOG,
    generationRunId: `perf13e-${n}`,
  }).project;
  const link = project.metadata.fieldToFinishLink;
  if (!link || link.status !== 'CURRENT') {
    failures.push(`scale ${n}: expected CURRENT link, got ${link?.status ?? 'none'}`);
  }

  const movedStation = points[Math.floor(n / 2)]?.stationId as string;
  const stations = toStations(points);
  stations[movedStation] = {
    ...stations[movedStation] as Station,
    x: (stations[movedStation] as Station).x + MOVE_DX,
    y: (stations[movedStation] as Station).y + MOVE_DY,
  };
  const result = fakeResult(stations);

  // Full rebuild baseline: fresh payload from (moved) points.
  const movedPoints = points.map((point) =>
    point.stationId === movedStation
      ? { ...point, x: point.x + MOVE_DX, y: point.y + MOVE_DY }
      : point,
  );
  for (let i = 0; i < WARMUPS; i += 1) buildFieldToFinishPayload(project, { points: movedPoints, catalog: SAMPLE_CATALOG, generationRunId: `perf13e-${n}` });
  const fullTimes: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    fullTimes.push(time(() => {
      buildFieldToFinishPayload(project, { points: movedPoints, catalog: SAMPLE_CATALOG, generationRunId: `perf13e-${n}` });
    }));
  }

  // Partial sync: rerun propagation touches only moved-station dependents.
  for (let i = 0; i < WARMUPS; i += 1) applyAdjustmentRerunToLinkedF2f(project, { result });
  const partialTimes: number[] = [];
  let probe = applyAdjustmentRerunToLinkedF2f(project, { result });
  for (let i = 0; i < RUNS; i += 1) {
    partialTimes.push(time(() => {
      probe = applyAdjustmentRerunToLinkedF2f(project, { result });
    }));
  }

  // Partial-update property: exactly the moved station updates; affected
  // dependents ≪ total entities; unrelated geometry byte-identical.
  if (probe.updated.length !== 1 || probe.updated[0] !== movedStation) {
    failures.push(`scale ${n}: expected updated=[${movedStation}], got [${probe.updated.join(',')}]`);
  }
  if (!probe.changed || probe.status !== 'CURRENT') {
    failures.push(`scale ${n}: expected changed=true/CURRENT, got changed=${probe.changed} status=${probe.status}`);
  }
  const total = probe.project.entities.length;
  const linework = probe.project.entities.filter((e) => e.type === 'line' || e.type === 'polyline').length;
  if (probe.affectedEntityIds.length > 12) {
    failures.push(`scale ${n}: affected ${probe.affectedEntityIds.length} entities for one station move (expected small dependent set)`);
  }
  if (probe.affectedEntityIds.length >= total) {
    failures.push(`scale ${n}: affected (${probe.affectedEntityIds.length}) >= total (${total}) — not partial`);
  }
  const movedAfter = probe.project.entities.find((e) => e.type === 'survey-point' && e.stationId === movedStation);
  if (movedAfter?.type !== 'survey-point' || movedAfter.x !== stations[movedStation]?.x) {
    failures.push(`scale ${n}: moved station coords not applied`);
  }
  const untouched = probe.project.entities.filter(
    (e) => e.type === 'survey-point' && e.stationId !== movedStation
      && (e.x !== points.find((p) => p.stationId === e.stationId)?.x
        || e.y !== points.find((p) => p.stationId === e.stationId)?.y),
  );
  if (untouched.length > 0) {
    failures.push(`scale ${n}: ${untouched.length} unrelated points moved`);
  }

  return {
    points: n,
    entities: total,
    linework,
    fullMedianMs: percentile(fullTimes, 0.5),
    partialMedianMs: percentile(partialTimes, 0.5),
    updated: probe.updated.length,
    affected: probe.affectedEntityIds.length,
    movedStation,
  };
};

const reports = SCALES.map(measureScale);

console.log('# Phase 13E §52 — F2F sync performance probe');
console.log('');
console.log(`Node ${process.version} · warmups ${WARMUPS} · runs ${RUNS}${QUICK ? ' · QUICK' : ''}`);
console.log('');
console.log('| Scale (pts) | Entities | Linework | Full rebuild median ms | Partial sync median ms | Updated | Affected / Total |');
console.log('| ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const report of reports) {
  console.log(
    `| ${report.points} | ${report.entities} | ${report.linework} | ${report.fullMedianMs.toFixed(2)} | ${report.partialMedianMs.toFixed(2)} | ${report.updated} | ${report.affected} / ${report.entities} |`,
  );
}
console.log('');
if (reports.length >= 2) {
  const [small, large] = [reports[0] as ScaleReport, reports[reports.length - 1] as ScaleReport];
  const pointRatio = large.points / small.points;
  const partialRatio = large.partialMedianMs / Math.max(small.partialMedianMs, 1e-9);
  const fullRatio = large.fullMedianMs / Math.max(small.fullMedianMs, 1e-9);
  console.log(`Scaling: points ×${pointRatio.toFixed(0)} → partial ×${partialRatio.toFixed(2)}, full ×${fullRatio.toFixed(2)}.`);
  // Quadratic (all x all) would read ~x100 here; linear-or-better proves
  // the dependency index holds (remaining linear passes are whole-array
  // maps: bounds rebuild, entity array copies). Threshold x20 rules out
  // quadratic with headroom for machine noise.
  const scalingOk = partialRatio <= 20;
  console.log(`Partial ${scalingOk ? 'scales ~linearly (dependency index holds)' : 'scales superlinearly — INVESTIGATE for O(n²)'}.`);
  if (!scalingOk) failures.push(`partial scaling x${partialRatio.toFixed(1)} for x${pointRatio.toFixed(0)} points (quadratic suspect)`);
}
const slow1k = reports[0] !== undefined && (reports[0] as ScaleReport).partialMedianMs >= 1000;
console.log(`Verdict: ${failures.length > 0 ? 'INVESTIGATE' : slow1k ? 'INVESTIGATE (1k partial ≥1s)' : 'PASS'} — partial-update property ${failures.length > 0 ? 'BROKEN' : 'holds (1 station updated per scale)'}.`);
for (const failure of failures) console.error(`FAIL: ${failure}`);
if (failures.length > 0) process.exitCode = 1;
