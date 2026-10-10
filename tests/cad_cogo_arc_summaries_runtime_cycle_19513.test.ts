/**
 * STRUCT-195.13 — COGO parcel-arc summaries import-cycle guard.
 *
 * Pins the Worker A one-specifier repoint: `cadParcelArcGeometry.ts` now
 * binds `buildCadInverseSummary` / `formatCadBearing` from the
 * `cadCogoSummaries` implementation leaf instead of the broad `cadCogoMath`
 * facade, breaking the 5-node VALUE SCC
 * {cadCogoEntityIntersections, cadCogoMath, cadParcelArcGeometry,
 *  cadPolylineCourses, cadPolylineGeometry}.
 *
 * Coverage:
 *  1. direct helper identity + frozen `cadCogoSummaries` runtime export
 *     surface; unchanged helper signatures (typeck-enforced);
 *  2. static TS-AST proof that the parcel-arc module binds both names
 *     exclusively via the `./cadCogoSummaries` specifier;
 *  3. cold-load order safety (`vi.resetModules`): Summaries-, CogoMath-,
 *     ParcelArc-first all resolve one function instance with no TDZ;
 *  4. exact one-edge graph multiset delta (repo-relative POSIX from\to, the
 *     1957/19512 canonicalization) over src/engine/cad +
 *     src/engine/fieldToFinish built in-process via
 *     scripts/cadTypeImportGraph.mjs: exactly one REMOVED value edge
 *     cadParcelArcGeometry->cadCogoMath and one ADDED
 *     cadParcelArcGeometry->cadCogoSummaries, VALUE nontrivial SCCs
 *     2/12 -> 1/7, the 5 arc/polyline modules singletons, TYPE 0. (A later
 *     STRUCT-195.14 downstream roll-forward dissolved the remaining geometry
 *     septet too: current graph is VALUE 0/0. The 195.13 repoint proved below
 *     is byte-identical; only the global SCC tally moved 1/7 -> 0/0.) The
 *     negative control rebuilds the graph with the import reverted in
 *     memory and recreates the exact historical 5-node SCC;
 *  5. fixed hand-checked numeric oracles for the arc/polyline/intersection
 *     behavior that consumes the repointed helpers (no ad-hoc reimplement,
 *     no relaxed snapshots) plus no-in-place-mutation checks.
 *
 * Agent tier: deterministic, no Adjustment solve. The first cold graph case
 * carries a 30s timeout (full-scope parse); later cases reuse the cache.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { buildGraphs, collectTypeScriptFiles, findCycles, tarjanSCC } from '../scripts/cadTypeImportGraph.mjs';

import * as summaries from '../src/engine/cad/cadCogoSummaries';
import * as cogoMath from '../src/engine/cad/cadCogoMath';
import * as parcelArc from '../src/engine/cad/cadParcelArcGeometry';
import { buildCadInverseSummary, formatCadBearing } from '../src/engine/cad/cadCogoSummaries';
import {
  describeParcelArcCourse,
  parcelArcBoundsPoints,
  parcelBulgeFromArcDefinition,
  parcelCourseCanonicalKind,
  splitParcelArcCourse,
  validateParcelCourseGeometry,
  checkParcelCourseTangency,
} from '../src/engine/cad/cadParcelArcGeometry';
import {
  cadPolylineCourseMidpoint,
  resolveCadPolylineCourses,
} from '../src/engine/cad/cadPolylineCourses';
import {
  cadIntersectLineArcEntity,
  cadIntersectLineLikeEntities,
} from '../src/engine/cad/cadCogoEntityIntersections';
import type { CadInverseSummary } from '../src/engine/cad/cadCogoSummaries';
import type { CadWorldPoint } from '../src/engine/cad/cadGeometry';
import type {
  CadArcEntity,
  CadLineEntity,
  CadPolylineEntity,
} from '../src/engine/cad/cadTypes';

// ---------------------------------------------------------------------------
// Paths, module names, and the frozen graph expectations.
// ---------------------------------------------------------------------------
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative);
const rel = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

const PARCEL_ARC = 'src/engine/cad/cadParcelArcGeometry.ts';
const COGO_MATH = 'src/engine/cad/cadCogoMath.ts';
const COGO_SUMMARIES = 'src/engine/cad/cadCogoSummaries.ts';
const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish'];

/** The historical 5-node arc/polyline VALUE SCC broken by this refactor. */
const HISTORICAL_ARC_SCC = [
  'src/engine/cad/cadCogoEntityIntersections.ts',
  'src/engine/cad/cadCogoMath.ts',
  PARCEL_ARC,
  'src/engine/cad/cadPolylineCourses.ts',
  'src/engine/cad/cadPolylineGeometry.ts',
] as const;

const EXPECTED_SUMMARIES_RUNTIME_EXPORTS = [
  'buildCadDistanceSummary',
  'buildCadInverseSummary',
  'buildCadMultiInverseSummary',
  'buildCadNamedPoint',
  'cadAdjustTraverse',
  'formatCadBearing',
  'formatCadNorthAzimuthDms',
  'formatCadSweepDms',
] as const;

// ===========================================================================
// 1. Direct helper identity + API surface.
// ===========================================================================
describe('STRUCT-195.13 direct helper identity + API surface', () => {
  it('exposes the two repointed helpers as one function instance via both paths', () => {
    expect(summaries.buildCadInverseSummary).toBe(cogoMath.buildCadInverseSummary);
    expect(summaries.formatCadBearing).toBe(cogoMath.formatCadBearing);
    expect(summaries.buildCadInverseSummary).toBe(buildCadInverseSummary);
    expect(summaries.formatCadBearing).toBe(formatCadBearing);
    expect(typeof summaries.buildCadInverseSummary).toBe('function');
    expect(typeof summaries.formatCadBearing).toBe('function');
  });

  it('keeps the cadCogoSummaries runtime export surface frozen and re-exported unchanged', () => {
    expect(Object.keys(summaries).sort()).toEqual([...EXPECTED_SUMMARIES_RUNTIME_EXPORTS].sort());
    for (const name of EXPECTED_SUMMARIES_RUNTIME_EXPORTS) {
      expect((summaries as Record<string, unknown>)[name]).toBe(
        (cogoMath as Record<string, unknown>)[name],
      );
    }
  });

  it('keeps the repointed helper signatures and return types unchanged', () => {
    expectTypeOf(summaries.buildCadInverseSummary).toEqualTypeOf<
      (_from: CadWorldPoint, _to: CadWorldPoint) => CadInverseSummary
    >();
    expectTypeOf(summaries.formatCadBearing).toEqualTypeOf<(_azimuthDeg: number) => string>();
    expectTypeOf<typeof summaries.buildCadInverseSummary>().toEqualTypeOf<
      typeof cogoMath.buildCadInverseSummary
    >();
    expectTypeOf<typeof summaries.formatCadBearing>().toEqualTypeOf<
      typeof cogoMath.formatCadBearing
    >();
  });
});

// ===========================================================================
// 2. Static AST boundary proof (parcel-arc binds via Summaries specifier).
// ===========================================================================
const namedImportsBySpecifier = (file: string): Map<string, string[]> => {
  const source = ts.createSourceFile(
    abs(file),
    fs.readFileSync(abs(file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const bySpecifier = new Map<string, string[]>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const names = bySpecifier.get(statement.moduleSpecifier.text) ?? [];
    for (const element of bindings.elements) names.push(element.name.text);
    bySpecifier.set(statement.moduleSpecifier.text, names);
  }
  return bySpecifier;
};

describe('STRUCT-195.13 parcel-arc binding is static-AST verified', () => {
  const repointed = ['buildCadInverseSummary', 'formatCadBearing'];

  it('binds both names from the ./cadCogoSummaries specifier', () => {
    const bySpecifier = namedImportsBySpecifier(PARCEL_ARC);
    const fromSummaries = bySpecifier.get('./cadCogoSummaries') ?? [];
    for (const name of repointed) expect(fromSummaries).toContain(name);
  });

  it('never binds either name from ./cadCogoMath (or any other specifier)', () => {
    const bySpecifier = namedImportsBySpecifier(PARCEL_ARC);
    for (const specifier of bySpecifier.keys()) {
      if (specifier === './cadCogoSummaries') continue;
      for (const name of repointed) {
        expect(bySpecifier.get(specifier), `${name} from ${specifier}`).not.toContain(name);
      }
    }
    const owners = [...bySpecifier.entries()]
      .filter(([, names]) => repointed.some((name) => names.includes(name)))
      .map(([specifier]) => specifier);
    expect(owners).toEqual(['./cadCogoSummaries']);
  });
});

// ===========================================================================
// 3. Cold-load order safety.
// ===========================================================================
const expectColdLoad = (
  moduleSummaries: typeof summaries,
  moduleCogoMath: typeof cogoMath,
  moduleParcelArc: typeof parcelArc,
): void => {
  expect(typeof moduleSummaries.buildCadInverseSummary).toBe('function');
  expect(typeof moduleSummaries.formatCadBearing).toBe('function');
  expect(moduleSummaries.buildCadInverseSummary).toBe(moduleCogoMath.buildCadInverseSummary);
  expect(moduleSummaries.formatCadBearing).toBe(moduleCogoMath.formatCadBearing);
  // Calling through the parcel-arc consumer proves the binding is live (no TDZ).
  const metrics = moduleParcelArc.describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
  expect(metrics).not.toBeNull();
  expect(metrics!.center).toEqual({ x: 5, y: 0 });
  expect(metrics!.radius).toBeCloseTo(5, 12);
  expect(moduleCogoMath.buildCadInverseSummary({ x: 0, y: 0 }, { x: 10, y: 0 }).bearing)
    .toBe('N90-00-00.00E');
};

describe('STRUCT-195.13 cold-load import-order safety', () => {
  it('resolves one instance when Summaries loads first', async () => {
    vi.resetModules();
    const s = await import('../src/engine/cad/cadCogoSummaries');
    const m = await import('../src/engine/cad/cadCogoMath');
    const p = await import('../src/engine/cad/cadParcelArcGeometry');
    expectColdLoad(s, m, p);
  });

  it('resolves one instance when CogoMath loads first', async () => {
    vi.resetModules();
    const m = await import('../src/engine/cad/cadCogoMath');
    const s = await import('../src/engine/cad/cadCogoSummaries');
    const p = await import('../src/engine/cad/cadParcelArcGeometry');
    expectColdLoad(s, m, p);
  });

  it('resolves one instance when ParcelArc loads first', async () => {
    vi.resetModules();
    const p = await import('../src/engine/cad/cadParcelArcGeometry');
    const m = await import('../src/engine/cad/cadCogoMath');
    const s = await import('../src/engine/cad/cadCogoSummaries');
    expectColdLoad(s, m, p);
  });
});

// ===========================================================================
// 4. Graph guard.
// ===========================================================================
type ScopeGraph = ReturnType<typeof buildGraphs>;
type EdgeKind = 'value' | 'type' | 'mixed';
interface RelEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}

const buildScopeGraph = (overrides: Map<string, string>): ScopeGraph => {
  const files = GRAPH_DIRS.flatMap((dir) => collectTypeScriptFiles(path.join(REPO_ROOT, dir)));
  return buildGraphs(
    files.map((file) => ({ path: file, source: overrides.get(file) ?? fs.readFileSync(file, 'utf8') })),
  );
};

const revertedParcelArcSource = (): string => {
  const original = fs.readFileSync(abs(PARCEL_ARC), 'utf8');
  const reverted = original.replace("from './cadCogoSummaries'", "from './cadCogoMath'");
  expect(reverted).not.toBe(original);
  return reverted;
};

let currentCache: ScopeGraph | undefined;
let revertedCache: ScopeGraph | undefined;
const currentGraph = (): ScopeGraph => (currentCache ??= buildScopeGraph(new Map()));
const revertedGraph = (): ScopeGraph =>
  (revertedCache ??= buildScopeGraph(new Map([[abs(PARCEL_ARC), revertedParcelArcSource()]])));

const relEdges = (graph: ScopeGraph): RelEdge[] =>
  graph.edges.map((edge) => ({ from: rel(edge.from), to: rel(edge.to), kind: edge.kind as EdgeKind }));

const multisetDelta = (
  base: RelEdge[],
  current: RelEdge[],
): { removed: string[]; added: string[] } => {
  const key = (edge: RelEdge): string => `${edge.kind}|${edge.from}|${edge.to}`;
  const counts = (edges: RelEdge[]): Map<string, number> => {
    const map = new Map<string, number>();
    for (const edge of edges) map.set(key(edge), (map.get(key(edge)) ?? 0) + 1);
    return map;
  };
  const before = counts(base);
  const after = counts(current);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [edgeKey, count] of before) {
    for (let i = 0; i < count - (after.get(edgeKey) ?? 0); i += 1) removed.push(edgeKey);
  }
  for (const [edgeKey, count] of after) {
    for (let i = 0; i < count - (before.get(edgeKey) ?? 0); i += 1) added.push(edgeKey);
  }
  return { removed: removed.sort(), added: added.sort() };
};

describe('STRUCT-195.13 cogo/arc graph guard', () => {
  // First cold graph build parses the whole CAD + Field-to-Finish scope; warm
  // BOTH the current and reverted graphs here so only this case pays the cost.
  it('breaks the arc SCC to VALUE 0/0 (195.14 downstream; this-refactor baseline 2/12), TYPE 0', () => {
    const graph = currentGraph();
    const baseline = revertedGraph();

    // STRUCT-195.14 downstream roll-forward: the primitive-core split
    // dissolved the geometry septet that survived this refactor, so the
    // current graph is VALUE 0 SCC / 0 nodes. The 195.13 repoint below is
    // byte-identical; only this global tally moved 1/7 -> 0/0.
    const valueCycles = findCycles(graph.nodes, graph.value);
    expect(valueCycles.cyclic.length, 'current VALUE SCC count').toBe(0);
    expect(valueCycles.cyclicNodes.size, 'current VALUE cyclic nodes').toBe(0);
    expect(tarjanSCC(graph.nodes, graph.value).filter((c) => c.length > 1)).toEqual([]);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect(typeCycles.cyclic.length, 'TYPE SCC count').toBe(0);
    expect(typeCycles.cyclicNodes.size, 'TYPE cyclic nodes').toBe(0);

    // Reverted baseline: only the parcel-arc specifier is restored in
    // memory, so the 195.14 geometry split stays in BOTH graphs — the revert
    // recreates just the historical 5-node arc SCC (1 SCC / 5 nodes), not
    // the pre-195.14 2/12 shape. The full 7-node geometry restoration is
    // proved in tests/cad_geometry_primitives_runtime_cycle_19514.test.ts.
    const baselineValue = findCycles(baseline.nodes, baseline.value);
    expect(baselineValue.cyclic.length, 'baseline VALUE SCC count').toBe(1);
    expect(baselineValue.cyclicNodes.size, 'baseline VALUE cyclic nodes').toBe(5);
    expect(baselineValue.largest).toEqual([...HISTORICAL_ARC_SCC.map(abs)].sort());
    expect(findCycles(baseline.nodes, baseline.type).cyclic.length, 'baseline TYPE SCC').toBe(0);
  }, 30_000);

  it('makes all 5 historical arc/polyline modules non-cyclic singletons', () => {
    const graph = currentGraph();
    const cyclic = findCycles(graph.nodes, graph.value).cyclic;
    for (const member of HISTORICAL_ARC_SCC) {
      expect(graph.nodes).toContain(abs(member));
      expect((graph.value.get(abs(member)) ?? []).length, `${member} VALUE out-degree`).toBeGreaterThan(0);
      expect(
        cyclic.some((component) => component.includes(abs(member))),
        `${member} still cyclic`,
      ).toBe(false);
      // A singleton has no self-loop either.
      expect((graph.value.get(abs(member)) ?? []).includes(abs(member))).toBe(false);
    }
  });

  it('removes/creates exactly the one repointed VALUE edge (no other change)', () => {
    const { removed, added } = multisetDelta(
      relEdges(revertedGraph()),
      relEdges(currentGraph()),
    );
    expect(removed).toEqual([`value|${PARCEL_ARC}|${COGO_MATH}`]);
    expect(added).toEqual([`value|${PARCEL_ARC}|${COGO_SUMMARIES}`]);
    // Same declaration kind (value) and multiplicity (one each).
    expect(removed[0]!.split('|')[0]).toBe(added[0]!.split('|')[0]);
    expect(revertedGraph().edges.length).toBe(currentGraph().edges.length);
    expect(revertedGraph().nodes.length).toBe(currentGraph().nodes.length);
  });

  it('negative control: reverting the import recreates the exact 5-node SCC', () => {
    const baseline = revertedGraph();
    const valueCycles = findCycles(baseline.nodes, baseline.value);
    // Fails the post-refactor 0/0 assertion by construction: the revert
    // restores the 5-node arc SCC on top of the still-split geometry core.
    expect(valueCycles.cyclic.length).not.toBe(0);
    expect(valueCycles.cyclicNodes.size).not.toBe(0);
    const five = valueCycles.cyclic.find((component) => component.length === 5);
    expect(five, 'historical 5-node arc SCC missing').toBeDefined();
    expect(five).toEqual([...HISTORICAL_ARC_SCC.map(abs)].sort());
    expect(tarjanSCC(baseline.nodes, baseline.value).some((c) => c.length === 5)).toBe(true);
  });
});

// ===========================================================================
// 5. Fixed deterministic numeric oracles.
// ===========================================================================
describe('STRUCT-195.13 inverse/bearing oracles', () => {
  it('pins quadrant-boundary bearings and the floating carry branch', () => {
    expect(formatCadBearing(0)).toBe('N00-00-00.00E');
    expect(formatCadBearing(90)).toBe('N90-00-00.00E');
    expect(formatCadBearing(135)).toBe('S45-00-00.00E');
    expect(formatCadBearing(180)).toBe('S00-00-00.00E');
    expect(formatCadBearing(225)).toBe('S45-00-00.00W');
    expect(formatCadBearing(270)).toBe('S90-00-00.00W');
    expect(formatCadBearing(315)).toBe('N45-00-00.00W');
    expect(formatCadBearing(360)).toBe('N00-00-00.00E');
    expect(formatCadBearing(-90)).toBe('S90-00-00.00W');
    // 0.016666 deg is 0deg 0' 59.9976": the seconds carry must advance minutes.
    expect(formatCadBearing(0.016666)).toBe('N00-01-00.00E');
  });

  it('builds exact cardinal inverse summaries', () => {
    expect(buildCadInverseSummary({ x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({
      distance: 10, azimuthDeg: 90, bearing: 'N90-00-00.00E',
    });
    expect(buildCadInverseSummary({ x: 0, y: 0 }, { x: 0, y: 10 })).toEqual({
      distance: 10, azimuthDeg: 0, bearing: 'N00-00-00.00E',
    });
    expect(buildCadInverseSummary({ x: 0, y: 0 }, { x: 0, y: -10 })).toEqual({
      distance: 10, azimuthDeg: 180, bearing: 'S00-00-00.00E',
    });
    expect(buildCadInverseSummary({ x: 0, y: 0 }, { x: -10, y: 0 })).toEqual({
      distance: 10, azimuthDeg: 270, bearing: 'S90-00-00.00W',
    });
  });
});

describe('STRUCT-195.13 parcel-arc oracles', () => {
  it('derives bulge -> center/radius/signed sweep/chord/tangents/true midpoint', () => {
    const metrics = describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)!;
    expect(metrics.center).toEqual({ x: 5, y: 0 });
    expect(metrics.radius).toBeCloseTo(5, 12);
    expect(metrics.signedSweepDeg).toBeCloseTo(180, 12);
    expect(metrics.deltaDeg).toBeCloseTo(180, 12);
    expect(metrics.direction).toBe('left');
    expect(metrics.arcLength).toBeCloseTo(5 * Math.PI, 12);
    expect(metrics.chordLength).toBe(10);
    expect(metrics.chordAzimuthDeg).toBeCloseTo(90, 12);
    expect(metrics.chordBearing).toBe('N90-00-00.00E');
    expect(metrics.startAngleDeg).toBeCloseTo(180, 12);
    expect(metrics.endAngleDeg).toBeCloseTo(360, 12);
    expect(metrics.startTangentAzimuthDeg).toBeCloseTo(180, 12);
    expect(metrics.endTangentAzimuthDeg).toBeCloseTo(0, 12);
    expect(metrics.startTangentBearing).toBe('S00-00-00.00E');
    expect(metrics.endTangentBearing).toBe('N00-00-00.00E');
    // TRUE arc midpoint (5,-5), never the chord midpoint (5,0).
    expect(metrics.midpoint.x).toBeCloseTo(5, 9);
    expect(metrics.midpoint.y).toBeCloseTo(-5, 12);
  });

  it('orients the semicircle by traversal and flips sign for CW bulges', () => {
    const reversed = describeParcelArcCourse({ x: 20, y: 0 }, { x: 0, y: 0 }, 1)!;
    expect(reversed.center).toEqual({ x: 10, y: 0 });
    expect(reversed.chordBearing).toBe('S90-00-00.00W');
    expect(reversed.midpoint.x).toBeCloseTo(10, 9);
    expect(reversed.midpoint.y).toBeCloseTo(10, 9);

    const cw = describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, -0.5)!;
    expect(cw.center.x).toBeCloseTo(5, 12);
    expect(cw.center.y).toBeCloseTo(-3.75, 12);
    expect(cw.radius).toBeCloseTo(6.25, 12);
    expect(cw.signedSweepDeg).toBeCloseTo(-106.26020470831196, 9);
    expect(cw.direction).toBe('right');
    expect(cw.startTangentBearing).toBe('N36-52-11.63E');
    expect(cw.endTangentBearing).toBe('S36-52-11.63E');
  });

  it('splits an arc at an on-arc point into exact sub-bulges summing to the parent', () => {
    const split = splitParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, { x: 5, y: -5 })!;
    expect(split.signedSweepBeforeDeg).toBeCloseTo(90, 12);
    expect(split.signedSweepAfterDeg).toBeCloseTo(90, 12);
    expect(split.bulgeBefore).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    expect(split.bulgeAfter).toBeCloseTo(Math.tan(Math.PI / 8), 12);
    expect(split.bulgeBefore).toBeCloseTo(Math.SQRT2 - 1, 12);
    // Off-arc and endpoint points fail closed.
    expect(splitParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, { x: 5, y: 0 })).toBeNull();
    expect(splitParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, { x: 0, y: 0 })).toBeNull();
  });

  it('fails closed on near-degenerate arc definitions', () => {
    expect(describeParcelArcCourse({ x: 0, y: 0 }, { x: 0, y: 0 }, 1)).toBeNull();
    expect(describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeNull();
    expect(describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, 1e9)).toBeNull();
    expect(describeParcelArcCourse({ x: 0, y: 0 }, { x: 10, y: 0 }, Number.NaN)).toBeNull();
    expect(parcelBulgeFromArcDefinition({ from: { x: 0, y: 0 }, to: { x: 0, y: 0 }, center: { x: 5, y: 0 }, radius: 5, signedSweepDeg: 180 })).toBeNull();
    expect(parcelBulgeFromArcDefinition({ from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, center: { x: 100, y: 100 }, radius: 5, signedSweepDeg: 180 })).toBeNull();
    expect(parcelCourseCanonicalKind(undefined)).toBe('line');
    expect(parcelCourseCanonicalKind({ kind: 'arc', bulge: 1e-15 })).toBe('line');
    expect(parcelCourseCanonicalKind({ kind: 'arc', bulge: 1 })).toBe('arc');
  });

  it('validates course geometry and blocks zero-chord arcs fail-closed', () => {
    const square = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ];
    expect(validateParcelCourseGeometry(square, undefined).ok).toBe(true);
    expect(validateParcelCourseGeometry(square, [{ kind: 'line' }, { kind: 'arc', bulge: 1e-15 }, { kind: 'line' }, { kind: 'line' }]).ok).toBe(true);
    const degenerate = validateParcelCourseGeometry([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }], [{ kind: 'arc', bulge: 1 }, { kind: 'line' }, { kind: 'line' }, { kind: 'line' }]);
    expect(degenerate.ok).toBe(false);
    expect(degenerate.issues[0]!.code).toBe('ZERO_CHORD_ARC');
  });

  it('bounds and tangency consume the same arc metrics', () => {
    const bounds = parcelArcBoundsPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 1);
    expect(bounds).toHaveLength(5);
    expect(bounds[0]).toEqual({ x: 0, y: 0 });
    expect(bounds[1]).toEqual({ x: 10, y: 0 });
    expect(bounds.at(-1)!.x).toBeCloseTo(5, 9);
    expect(bounds.at(-1)!.y).toBeCloseTo(-5, 12);

    const reports = checkParcelCourseTangency([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], [{ kind: 'line' }, { kind: 'arc', bulge: 1 }, { kind: 'line' }, { kind: 'line' }]);
    expect(reports.map((report) => report.status)).toEqual([
      'NON_TANGENT', 'TANGENT', 'TANGENT', 'NON_TANGENT',
    ]);
    expect(reports[0]!.deviationDeg).toBeCloseTo(90, 9);
    expect(reports[1]!.deviationDeg).toBeCloseTo(0, 9);
  });
});

// ---------------------------------------------------------------------------
// Shared entity fixtures for the polyline + intersection oracles.
// ---------------------------------------------------------------------------
const polylineEntity = (): CadPolylineEntity => ({
  id: 'pl-19513',
  type: 'polyline',
  layerId: 'general',
  visible: true,
  locked: false,
  vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
  vertexLabels: ['A', 'B', 'C'],
  closed: false,
  segmentGeometry: [{ kind: 'arc', bulge: 1 }, { kind: 'line' }],
  segmentWidths: [{ startWidth: 0, endWidth: 2 }, { startWidth: 2, endWidth: 4 }],
});

const horizontalLine = (): CadLineEntity => ({
  id: 'L-19513',
  type: 'line',
  layerId: 'general',
  visible: true,
  locked: false,
  fromStationId: 'A',
  toStationId: 'B',
  fromX: -10,
  fromY: 0,
  toX: 10,
  toY: 0,
  sourceObservationIds: [],
});

const fullCircleArc = (): CadArcEntity => ({
  id: 'ARC-19513',
  type: 'arc',
  layerId: 'general',
  visible: true,
  locked: false,
  centerX: 0,
  centerY: 0,
  radius: 5,
  startAngleDeg: 0,
  endAngleDeg: 360,
});

describe('STRUCT-195.13 polyline resolved-course oracles', () => {
  it('resolves true arc/line courses preserving geometry and widths', () => {
    const courses = resolveCadPolylineCourses(polylineEntity())!;
    expect(courses.map((course) => course.kind)).toEqual(['arc', 'line']);
    expect(courses[0]!.geometry).toEqual({ kind: 'arc', bulge: 1 });
    expect(courses[0]!.metrics!.center).toEqual({ x: 5, y: 0 });
    expect(courses[0]!.metrics!.radius).toBeCloseTo(5, 12);
    expect(courses[1]!.geometry).toEqual({ kind: 'line' });
    // Widths preserved per course (never dropped or straightened).
    expect(courses.map((course) => course.width)).toEqual([
      { startWidth: 0, endWidth: 2 },
      { startWidth: 2, endWidth: 4 },
    ]);
    const arcMidpoint = cadPolylineCourseMidpoint(courses[0]!);
    expect(arcMidpoint.x).toBeCloseTo(5, 9);
    expect(arcMidpoint.y).toBeCloseTo(-5, 12);
    expect(cadPolylineCourseMidpoint(courses[1]!)).toEqual({ x: 10, y: 5 });
  });

  it('fails closed on malformed geometry/width metadata', () => {
    const base = polylineEntity();
    expect(resolveCadPolylineCourses({ ...base, segmentGeometry: [{ kind: 'arc', bulge: 1 }] })).toBeNull();
    expect(resolveCadPolylineCourses({ ...base, segmentWidths: [{ startWidth: 0, endWidth: 2 }] })).toBeNull();
    expect(resolveCadPolylineCourses({ ...base, segmentWidths: [{ startWidth: 0, endWidth: -2 }, { startWidth: 2, endWidth: 4 }] })).toBeNull();
    expect(resolveCadPolylineCourses({ ...base, segmentWidths: [undefined, { startWidth: 2, endWidth: 4 }] as never })).toBeNull();
    expect(resolveCadPolylineCourses({ ...base, segmentGeometry: [undefined, { kind: 'line' }] as never })).toBeNull();
    // Absent metadata is a valid all-line zero-width legacy polyline.
    const legacy = resolveCadPolylineCourses({ ...base, segmentGeometry: undefined, segmentWidths: undefined })!;
    expect(legacy.map((course) => course.kind)).toEqual(['line', 'line']);
    expect(legacy.every((course) => course.width.startWidth === 0 && course.width.endWidth === 0)).toBe(true);
  });
});

describe('STRUCT-195.13 line/arc intersection oracles', () => {
  it('intersects a line with a full circle deterministically (x, then y)', () => {
    expect(cadIntersectLineArcEntity(horizontalLine(), fullCircleArc())).toEqual([
      { point: { x: -5, y: 0 }, label: 'A-B x ARC-19513' },
      { point: { x: 5, y: 0 }, label: 'A-B x ARC-19513' },
    ]);
  });

  it('intersects two line-like entities at the shared point', () => {
    const vertical = { ...horizontalLine(), id: 'L2', fromX: 0, fromY: -10, toX: 0, toY: 10 };
    expect(cadIntersectLineLikeEntities(horizontalLine(), vertical)).toEqual({
      point: { x: 0, y: 0 },
      label: 'A-B x A-B',
    });
  });
});

describe('STRUCT-195.13 no in-place input mutation', () => {
  it('leaves arc, polyline, and intersection inputs byte-identical', () => {
    const from: CadWorldPoint = { x: 0, y: 0 };
    const to: CadWorldPoint = { x: 10, y: 0 };
    const entity = polylineEntity();
    const line = horizontalLine();
    const arc = fullCircleArc();
    const before = JSON.stringify({ from, to, entity, line, arc });
    describeParcelArcCourse(from, to, 1);
    splitParcelArcCourse(from, to, 1, { x: 5, y: -5 });
    parcelArcBoundsPoints(from, to, 1);
    resolveCadPolylineCourses(entity);
    cadIntersectLineArcEntity(line, arc);
    expect(JSON.stringify({ from, to, entity, line, arc })).toBe(before);
  });
});
