/**
 * Phase 18V bulk/region edit performance campaign — EVIDENCE tier.
 *
 * MANUAL ONLY (tests/evidence/, npm run test:evidence / direct vitest). The
 * full 10k / 50k / 100k-vertex envelope for the three bulk kernels
 * (`set-elevation-many`, `raise-lower-points`, `move-points`) plus the
 * single-move baseline, the dynamic edge-spatial-index decomposition
 * (index build / candidate query / exact crossing test), candidate counts vs
 * all-edges (architecture §98: no moves × whole-mesh scan), index memory, and
 * window/polygon selection timing.
 *
 * NO millisecond assertions: this is evidence. Correctness (outcome +
 * unchanged topology for the Z-only and rigid-move stacks) is asserted so a
 * broken run cannot masquerade as slow. Reference: Phase 18T recorded the
 * legacy O(moves × triangles) move cost in docs/evidence/phase18t-performance.md.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCadSurface,
  replaySurfaceEdits,
  type CadSurfaceBuildResult,
} from '../../src/engine/cad/cadSurfaces';
import { ensureEditEdgeSpatialIndex } from '../../src/engine/cad/cadEditEdgeSpatialIndex';
import { properlyCrosses } from '../../src/engine/cad/cadSurfaceEditPointModify';
import { tinEdgeKey } from '../../src/engine/cad/tin/tinTopology';
import {
  refsInPolygon,
  refsInWindow,
  selectableSurfacePoints,
  syntheticExcludedCount,
  type Xy,
} from '../../src/hooks/surveyCad/surfaceBulkSelectionUtils';
import type { CadProject, CadSurface, CadSurfaceEdit } from '../../src/engine/cad/cadTypes';
import { gridFixture } from '../cadSurfacePointEdits18tFixtures';
import { spacedCells } from '../cadSurfacePointEdits18tPerf';
import {
  assembleState,
  bulkMoveEdit,
  raisePointsEdit,
  setManyEdit,
  singleMoveEdit,
} from './phase18vBulkPerfShared';

const ms = (value: number): string => `${value.toFixed(1)}ms`;

interface Stack {
  name: string;
  edits: CadSurfaceEdit[];
}

const stacksFor = (side: number): Stack[] => {
  const interior = (n: number): Array<[number, number]> => spacedCells(side, n, 1, 2);
  const any = (n: number): Array<[number, number]> => spacedCells(side, n, 1, 0);
  return [
    { name: 'single1', edits: singleMoveEdit(spacedCells(side, 1, 3, 2), 's1') },
    { name: 'single10', edits: singleMoveEdit(spacedCells(side, 10, 3, 2), 's10') },
    { name: 'single100', edits: singleMoveEdit(spacedCells(side, 100, 3, 2), 's100') },
    { name: 'bulkMove10', edits: bulkMoveEdit(interior(10), 'bm10', 0.1, 0.05) },
    { name: 'bulkMove100', edits: bulkMoveEdit(interior(100), 'bm100', 0.1, 0.05) },
    { name: 'bulkMove1000', edits: bulkMoveEdit(interior(1000), 'bm1000', 0.1, 0.05) },
    { name: 'bulkSet100', edits: setManyEdit(any(100), 'bs100', 1) },
    { name: 'bulkSet1000', edits: setManyEdit(any(1000), 'bs1000', 1) },
    { name: 'bulkSet10000', edits: setManyEdit(any(10000), 'bs10000', 1) },
    { name: 'bulkRaise100', edits: raisePointsEdit(any(100), 'br100', 1) },
    { name: 'bulkRaise1000', edits: raisePointsEdit(any(1000), 'br1000', 1) },
    { name: 'bulkRaise10000', edits: raisePointsEdit(any(10000), 'br10000', 1) },
  ];
};

/**
 * Instrumented decomposition of one bulk move: the production kernel's
 * discovery loop, timed by phase (index build, candidate query, exact
 * predicate over old-index candidates + the local proposed moved-edge set).
 */
const moveBreakdown = (
  base: CadSurfaceBuildResult,
  surfaceId: string,
  cells: Array<[number, number]>,
  deltaX: number,
  deltaY: number,
): string => {
  if (base.outcome !== 'ok') throw new Error('base build failed');
  const state = assembleState(base, surfaceId);
  const indexStart = performance.now();
  const index = ensureEditEdgeSpatialIndex(state);
  const indexBuild = performance.now() - indexStart;

  const selected = new Set<number>();
  for (const [row, col] of cells) {
    const at = state.byId.get(`pt:${row}-${col}`);
    if (at !== undefined) selected.add(at);
  }
  const proposed = new Map<number, { x: number; y: number }>();
  for (const v of selected) {
    const p = state.pts[v];
    proposed.set(v, { x: p.x + deltaX, y: p.y + deltaY });
  }
  const at = (i: number): { x: number; y: number } => proposed.get(i) ?? state.pts[i];
  const movedKeys = new Set<string>();
  for (const [, tri] of state.tris) {
    for (const [u, w] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      if (selected.has(u) || selected.has(w)) movedKeys.add(tinEdgeKey(u, w));
    }
  }
  const moved = [...movedKeys].sort().map((key) => {
    const [u, v] = key.split('>').map(Number) as [number, number];
    return { u, v, pu: at(u), pv: at(v) };
  });
  const shares = (aU: number, aV: number, bU: number, bV: number): boolean =>
    aU === bU || aU === bV || aV === bU || aV === bV;

  const queryStart = performance.now();
  let candidateTests = 0;
  const packed: Array<{ m: (typeof moved)[number]; recs: ReturnType<typeof index.queryCandidates> }> = [];
  for (const m of moved) {
    const recs = index.queryCandidates(
      Math.min(m.pu.x, m.pv.x),
      Math.min(m.pu.y, m.pv.y),
      Math.max(m.pu.x, m.pv.x),
      Math.max(m.pu.y, m.pv.y),
    );
    candidateTests += recs.length;
    packed.push({ m, recs });
  }
  const candidateQuery = performance.now() - queryStart;

  const predicateStart = performance.now();
  let predicateTests = 0;
  for (const { m, recs } of packed) {
    for (const rec of recs) {
      if (shares(m.u, m.v, rec.u, rec.v)) continue;
      const c1 = at(rec.u);
      const c2 = at(rec.v);
      properlyCrosses(m.pu.x, m.pu.y, m.pv.x, m.pv.y, c1.x, c1.y, c2.x, c2.y);
      predicateTests += 1;
    }
    for (const n of moved) {
      if (n === m || shares(m.u, m.v, n.u, n.v)) continue;
      properlyCrosses(m.pu.x, m.pu.y, m.pv.x, m.pv.y, n.pu.x, n.pu.y, n.pv.x, n.pv.y);
      predicateTests += 1;
    }
  }
  const predicate = performance.now() - predicateStart;
  const allEdges = state.edgeMap.size;
  const brutePairs = moved.length * allEdges;
  return (
    `    breakdown bulkMove100: indexBuild=${ms(indexBuild)} candidateQuery=${ms(candidateQuery)} ` +
    `exactTest=${ms(predicate)} | movedEdges=${moved.length} candidateTests=${candidateTests} ` +
    `predicateTests=${predicateTests} allEdges=${allEdges} brutePairs=${brutePairs} ` +
    `candidateReduction=${(brutePairs / Math.max(1, candidateTests)).toFixed(0)}x`
  );
};

const regularPolygon = (cx: number, cy: number, radius: number, sides: number): Xy[] =>
  Array.from({ length: sides }, (_unused, i) => ({
    x: cx + radius * Math.cos((2 * Math.PI * i) / sides),
    y: cy + radius * Math.sin((2 * Math.PI * i) / sides),
  }));

const measureSize = (side: number, label: string): string[] => {
  const report: string[] = [];
  const { project, surface } = gridFixture({ side });
  const baseStart = performance.now();
  const base = buildCadSurface(project, surface);
  const baselineMs = performance.now() - baseStart;
  expect(base.outcome).toBe('ok');
  if (base.outcome !== 'ok') throw new Error('baseline build failed');
  const baseMesh = {
    points: base.points,
    triangles: base.triangles,
    adjacency: base.adjacency,
    edgeKinds: base.edgeKinds,
    constrained: new Map(),
  };
  report.push(
    `\n[18V perf] ${label}: ${base.points.length} pts / ${base.triangles.length} tris, baseline build=${ms(baselineMs)}`,
  );

  for (const stack of stacksFor(side)) {
    const edited: CadSurface = { ...surface, definition: { ...surface.definition, edits: stack.edits } };
    const editedProject: CadProject = { ...project, surfaces: [edited] };
    const totalStart = performance.now();
    const built = buildCadSurface(editedProject, edited);
    const total = performance.now() - totalStart;
    expect(built.outcome, `${label} ${stack.name}`).toBe('ok');
    expect(built.triangles.length, `${label} ${stack.name} topology`).toBe(base.triangles.length);
    const replayStart = performance.now();
    const replayed = replaySurfaceEdits(stack.edits, baseMesh, surface.id);
    const replay = performance.now() - replayStart;
    if ('failure' in replayed) throw new Error(`${label} ${stack.name} replay failed: ${replayed.failure.reason}`);
    report.push(
      `    ${stack.name.padEnd(13)} edits=${String(stack.edits.length).padStart(4)} ` +
      `replay=${ms(replay).padStart(10)} total=${ms(total).padStart(10)}`,
    );
  }

  report.push(moveBreakdown(base, surface.id, spacedCells(side, 100, 1, 2), 0.1, 0.05));

  // Index structure + approximate live memory.
  const memState = assembleState(base, surface.id);
  (globalThis as { gc?: () => void }).gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const memIndex = ensureEditEdgeSpatialIndex(memState);
  const heapAfter = process.memoryUsage().heapUsed;
  report.push(
    `    index memory: edges=${memIndex.edgeCount} cells=${memIndex.cellCount} wide=${memIndex.wideCount} ` +
    `heapDelta≈${((heapAfter - heapBefore) / 1048576).toFixed(1)}MB (approximate, no forced GC)`,
  );

  // Window + polygon selection timing on the current final mesh.
  const entriesStart = performance.now();
  const entries = selectableSurfacePoints(
    'native',
    surface.id,
    base.points.map((p) => ({ entityId: p.entityId, x: p.x, y: p.y })),
  );
  const entriesMs = performance.now() - entriesStart;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of base.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  const winStart = performance.now();
  const win = refsInWindow(entries, { x: minX, y: minY }, {
    x: minX + extent * 0.2,
    y: minY + extent * 0.2,
  });
  const windowMs = performance.now() - winStart;
  const polygon = regularPolygon(
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    extent * 0.2,
    32,
  );
  const polygonStart = performance.now();
  const polygonRefs = refsInPolygon(entries, polygon);
  const polygonMs = performance.now() - polygonStart;
  expect(win.length).toBeGreaterThan(0);
  expect(polygonRefs.length).toBeGreaterThan(0);
  expect(syntheticExcludedCount('native', surface.id, base.points)).toBe(0);
  report.push(
    `    selection: selectable=${ms(entriesMs)} (${entries.length} refs) window=${ms(windowMs)} (${win.length}) ` +
    `polygon32=${ms(polygonMs)} (${polygonRefs.length})`,
  );
  return report;
};

describe('18V bulk-edit performance campaign (10k/50k/100k)', () => {
  const sizes: Array<{ side: number; label: string }> = [
    { side: 100, label: '10k' },
    { side: 224, label: '50k' },
    { side: 317, label: '100k' },
  ];
  for (const { side, label } of sizes) {
    it(`measures ${label}`, () => {
      console.info(measureSize(side, label).join('\n'));
    }, 900_000);
  }
});
