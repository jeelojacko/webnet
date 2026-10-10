/**
 * STRUCT-195.12 — COGO parcel diagnostics runtime-cycle guard (Worker B).
 *
 * Pins the Worker A split of the parcel diagnostics/linework cluster:
 *  - `cadCogoParcelLineworkTopology.ts` now owns `buildParcelLineCandidate` /
 *    `buildParcelNodeMap`; `cadCogoParcelDiagnostics.ts` imports the split
 *    geometry leaves directly instead of the broad `cadCogoParcelGeometry`
 *    facade, and `SourceDraft`/`Linework` import the moved helpers from the
 *    new topology module;
 *  - public export-path identity: the facade, Diagnostics, Linework, and the
 *    new topology module all expose the same helper function values;
 *  - module import-order safety: barrel-first and topology-first dynamic
 *    imports resolve to one helper instance;
 *  - graph guard (rebuilt in-process via scripts/cadTypeImportGraph.mjs over
 *    src/engine/cad + src/engine/fieldToFinish): the topology helper is a
 *    non-cyclic singleton in BOTH the VALUE and TYPE graphs, the old 4-node
 *    parcel SCC is gone, and the current graph is VALUE 0 SCC / 0 nodes
 *    (TYPE 0). The 195.12 parcel quad, the separate 195.13 arc-cogo quintet,
 *    and the 195.14 geometry septet are all dissolved. This file's frozen
 *    41-edge parcel slice and its parcel-local allowlists are unaffected by
 *    195.13 and 195.14.
 *  - authorized edge-delta allowlist vs the frozen baseline slice in THIS
 *    file: every removed/added edge touches only the 5 parcel modules;
 *  - negative controls (facade still export-stars Diagnostics/SourceDraft, no
 *    Diagnostics value import of the facade, SourceDraft/Linework import the
 *    helpers from topology);
 *  - helper-body fidelity and source-draft/gap/overlap exact oracles against
 *    small inline fixtures (no input mutation).
 *
 * No git-history access at runtime: the baseline is the static array frozen
 * below. Agent tier: fast, deterministic, no Adjustment solve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import { buildGraphs, collectTypeScriptFiles, findCycles, tarjanSCC } from '../scripts/cadTypeImportGraph.mjs';

import * as facade from '../src/engine/cad/cadCogoParcelGeometry';
import * as diagnostics from '../src/engine/cad/cadCogoParcelDiagnostics';
import * as linework from '../src/engine/cad/cadCogoParcelLineworkDiagnostics';
import * as topology from '../src/engine/cad/cadCogoParcelLineworkTopology';
import {
  buildParcelLineCandidate,
  buildParcelNodeMap,
} from '../src/engine/cad/cadCogoParcelLineworkTopology';
import { cadBuildParcelSourceDraft } from '../src/engine/cad/cadCogoParcelGeometrySourceDraft';
import {
  cadBuildParcelGapDiagnostics,
  cadBuildParcelOverlapDiagnostics,
  cadConvertAreaSquareMeters,
} from '../src/engine/cad/cadCogoParcelDiagnostics';
import { cadBuildParcelLineworkDiagnostics } from '../src/engine/cad/cadCogoParcelLineworkDiagnostics';
import type {
  CadArcEntity,
  CadLineEntity,
  CadPolylineEntity,
} from '../src/engine/cad/cadTypes';

// ---------------------------------------------------------------------------
// Paths and the 5 parcel modules touched by this refactor.
// ---------------------------------------------------------------------------
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative);
const rel = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

const DIAGNOSTICS = 'src/engine/cad/cadCogoParcelDiagnostics.ts';
const GEOMETRY = 'src/engine/cad/cadCogoParcelGeometry.ts';
const SOURCE_DRAFT = 'src/engine/cad/cadCogoParcelGeometrySourceDraft.ts';
const LINEWORK = 'src/engine/cad/cadCogoParcelLineworkDiagnostics.ts';
const TOPOLOGY = 'src/engine/cad/cadCogoParcelLineworkTopology.ts';
const PARCEL_MODULES = [DIAGNOSTICS, GEOMETRY, SOURCE_DRAFT, LINEWORK, TOPOLOGY] as const;
const PARCEL_SET = new Set<string>(PARCEL_MODULES);
const OLD_PARCEL_SCC = [GEOMETRY, DIAGNOSTICS, SOURCE_DRAFT, LINEWORK] as const;

const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish'];

// ---------------------------------------------------------------------------
// Frozen baseline (captured offline at the branch base, no runtime git).
// ---------------------------------------------------------------------------
type EdgeKind = 'value' | 'type' | 'mixed';
interface RelEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}
type BaselineEdge = readonly [string, string, EdgeKind];

const P = (name: string): string => `src/engine/cad/${name}`;
const BASELINE_NODE_COUNT = 481;
const BASELINE_EDGE_COUNT = 2393;

// STRUCT-241.1 measured delta (type-only leaves, no VALUE/MIXED change).
const STRUCT_2411_ADDED_NODES = 2;
const STRUCT_2411_ADDED_EDGES = 4;
// STRUCT-241.2 measured delta (one block type-only leaf, two type edges:
// hub -> leaf + leaf -> primitive types; no VALUE/MIXED change).
const STRUCT_2412_ADDED_NODES = 1;
const STRUCT_2412_ADDED_EDGES = 2;
// STRUCT-241.3 measured delta (two cadTypes type-only leaves: foundation +
// survey presentation; six type edges: hub import-type + hub export-type per
// leaf + one leaf -> primitive types per leaf; no VALUE/MIXED change).
const STRUCT_2413_ADDED_NODES = 2;
const STRUCT_2413_ADDED_EDGES = 6;
// STRUCT-241.4 measured delta (one cadTypes primitive/geometry type-only
// leaf; four scoped type edges: hub import-type + hub export-type + two
// owner-leaf edges; no VALUE/MIXED change; outside the parcel slice).
const STRUCT_2414_ADDED_NODES = 1;
const STRUCT_2414_ADDED_EDGES = 4;
// STRUCT-241.5 measured delta (two cadTypes type-only leaves: annotation +
// survey-table; eight scoped type edges: annotation 3 out + hub import-type
// + hub export-type, survey 2 out + hub import-type + hub export-type, minus
// the retired hub -> anchor import-type edge; no VALUE/MIXED change;
// outside the parcel slice).
const STRUCT_2415_ADDED_NODES = 2;
const STRUCT_2415_ADDED_EDGES = 8;

/** Every baseline edge incident to one of the 5 parcel modules (41 edges). */
const BASELINE_PARCEL_EDGES: readonly BaselineEdge[] = [
  [P('cadCogoParcelDiagnostics.ts'), P('cadCogoParcelGeometry.ts'), 'mixed'],
  [P('cadCogoParcelDiagnostics.ts'), P('cadGeometry.ts'), 'mixed'],
  [P('cadCogoParcelGeometrySourceDraft.ts'), P('cadGeometry.ts'), 'mixed'],
  [P('cadCogoParcelLineworkDiagnostics.ts'), P('cadGeometry.ts'), 'mixed'],
  [P('cadCogoParcelDiagnostics.ts'), P('cadTypes.ts'), 'type'],
  [P('cadCogoParcelGeometrySourceDraft.ts'), P('cadCogoParcelGeometryTypes.ts'), 'type'],
  [P('cadCogoParcelGeometrySourceDraft.ts'), P('cadTypes.ts'), 'type'],
  [P('cadCogoParcelLineworkDiagnostics.ts'), P('cadTypes.ts'), 'type'],
  [P('cadCogoParcel.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelAutoLayoutSingle.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelClosedBoundary.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelClosedBoundaryHelpers.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelCornerGeometry.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelDiagnostics.ts'), P('cadCogoParcelLineworkDiagnostics.ts'), 'value'],
  [P('cadCogoParcelDiagnostics.ts'), P('cadParcelContainment.ts'), 'value'],
  [P('cadCogoParcelFrontage.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelFrontageReferenceCornerHelpers.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelFrontageReferenceCornerInfill.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelGeometry.ts'), P('cadCogoParcelDiagnostics.ts'), 'value'],
  [P('cadCogoParcelGeometry.ts'), P('cadCogoParcelGeometryOverlap.ts'), 'value'],
  [P('cadCogoParcelGeometry.ts'), P('cadCogoParcelGeometryPrimitives.ts'), 'value'],
  [P('cadCogoParcelGeometry.ts'), P('cadCogoParcelGeometrySourceDraft.ts'), 'value'],
  [P('cadCogoParcelGeometry.ts'), P('cadCogoParcelGeometrySummaries.ts'), 'value'],
  [P('cadCogoParcelGeometry.ts'), P('cadCogoParcelGeometryTypes.ts'), 'value'],
  [P('cadCogoParcelGeometrySourceDraft.ts'), P('cadCogoParcelDiagnostics.ts'), 'value'],
  [P('cadCogoParcelGeometrySourceDraft.ts'), P('cadCogoParcelGeometryPrimitives.ts'), 'value'],
  [P('cadCogoParcelGeometrySourceDraft.ts'), P('cadGeometryArcPrimitives.ts'), 'value'],
  [P('cadCogoParcelGeometrySourceDraft.ts'), P('cadParcelArcGeometry.ts'), 'value'],
  [P('cadCogoParcelLayoutConflicts.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelLayoutConstraints.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelLayoutDrafts.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelLayoutEvaluation.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelLayoutGeneratedPrimitives.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelLayoutPath.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelLayoutSharedPrimitives.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelLayoutSlide.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelLayoutSwing.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelLineworkDiagnostics.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadCogoParcelSplit.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
  [P('cadLabelEngine.ts'), P('cadCogoParcelDiagnostics.ts'), 'value'],
  [P('cadParcelSchedule.ts'), P('cadCogoParcelGeometry.ts'), 'value'],
];

/** Authorized edge removals/additions, verbatim `<kind>|<from>|<to>`. */
const EXPECTED_REMOVED = [
  `mixed|${DIAGNOSTICS}|${GEOMETRY}`,
  `mixed|${LINEWORK}|${P('cadGeometry.ts')}`,
  `value|${SOURCE_DRAFT}|${DIAGNOSTICS}`,
  `value|${LINEWORK}|${GEOMETRY}`,
].sort();

const EXPECTED_ADDED = [
  `mixed|${LINEWORK}|${TOPOLOGY}`,
  `type|${DIAGNOSTICS}|${P('cadCogoParcelGeometryTypes.ts')}`,
  `type|${TOPOLOGY}|${P('cadGeometry.ts')}`,
  `type|${TOPOLOGY}|${P('cadTypes.ts')}`,
  `value|${DIAGNOSTICS}|${P('cadCogoParcelGeometryOverlap.ts')}`,
  `value|${DIAGNOSTICS}|${P('cadCogoParcelGeometryPrimitives.ts')}`,
  `value|${DIAGNOSTICS}|${P('cadCogoParcelGeometrySummaries.ts')}`,
  `value|${SOURCE_DRAFT}|${TOPOLOGY}`,
  `value|${LINEWORK}|${SOURCE_DRAFT}`,
  `value|${LINEWORK}|${P('cadGeometry.ts')}`,
  `value|${TOPOLOGY}|${P('cadCogoParcelGeometryPrimitives.ts')}`,
].sort();

// ---------------------------------------------------------------------------
// In-process graph helpers.
// ---------------------------------------------------------------------------
const edgeKey = (edge: RelEdge): string => `${edge.kind}|${edge.from}|${edge.to}`;
const multiset = (edges: RelEdge[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const edge of edges) counts.set(edgeKey(edge), (counts.get(edgeKey(edge)) ?? 0) + 1);
  return counts;
};
const multisetDelta = (base: RelEdge[], current: RelEdge[]): { removed: string[]; added: string[] } => {
  const from = multiset(base);
  const to = multiset(current);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [key, count] of from) for (let i = 0; i < count - (to.get(key) ?? 0); i += 1) removed.push(key);
  for (const [key, count] of to) for (let i = 0; i < count - (from.get(key) ?? 0); i += 1) added.push(key);
  return { removed: removed.sort(), added: added.sort() };
};

let graphCache: ReturnType<typeof buildGraphs> | undefined;
const currentGraph = (): ReturnType<typeof buildGraphs> => {
  if (!graphCache) {
    const files = GRAPH_DIRS.flatMap((dir) => collectTypeScriptFiles(path.join(REPO_ROOT, dir)));
    graphCache = buildGraphs(files.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
  }
  return graphCache;
};
const relEdges = (graph: ReturnType<typeof buildGraphs>): RelEdge[] =>
  graph.edges.map((edge) => ({ from: rel(edge.from), to: rel(edge.to), kind: edge.kind as EdgeKind }));
const baselineEdges = (): RelEdge[] => BASELINE_PARCEL_EDGES.map(([from, to, kind]) => ({ from, to, kind }));
const touchesParcel = (edge: RelEdge): boolean => PARCEL_SET.has(edge.from) || PARCEL_SET.has(edge.to);

// ---------------------------------------------------------------------------
// Static source parsing (negative controls).
// ---------------------------------------------------------------------------
const parseSource = (file: string): ts.SourceFile =>
  ts.createSourceFile(abs(file), fs.readFileSync(abs(file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const importSpecifiers = (file: string): string[] =>
  parseSource(file).statements
    .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

const exportStarSpecifiers = (file: string): string[] =>
  parseSource(file).statements
    .filter((stmt): stmt is ts.ExportDeclaration => ts.isExportDeclaration(stmt)
      && stmt.moduleSpecifier != null && ts.isStringLiteral(stmt.moduleSpecifier)
      && stmt.exportClause == null)
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

const namedImportBindings = (file: string, specifier: string): string[] => {
  const bindings: string[] = [];
  for (const stmt of parseSource(file).statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== specifier) continue;
    const named = stmt.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const element of named.elements) bindings.push(element.name.text);
  }
  return bindings;
};

// ---------------------------------------------------------------------------
// Behavior fixtures (mirror the cadCogo.03/.06/.08 and 19C suites).
// ---------------------------------------------------------------------------
const cadBase = { layerId: 'planning', visible: true, locked: false } as const;

const line = (
  id: string,
  from: string,
  to: string,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): CadLineEntity => ({
  ...cadBase,
  id,
  type: 'line',
  fromStationId: from,
  toStationId: to,
  fromX,
  fromY,
  toX,
  toY,
  sourceObservationIds: [],
});

const parcel = (id: string, parcelName: string, x: number, y: number): CadParcelEntityLike => ({
  ...cadBase,
  layerId: 'parcels',
  id,
  type: 'parcel',
  parcelName,
  vertices: [
    { x, y },
    { x: x + 10, y },
    { x: x + 10, y: y + 10 },
    { x, y: y + 10 },
  ],
  vertexLabels: ['A', 'B', 'C', 'D'],
});

type CadParcelEntityLike = {
  id: string;
  type: 'parcel';
  layerId: string;
  visible: boolean;
  locked: boolean;
  parcelName: string;
  vertices: Array<{ x: number; y: number }>;
  vertexLabels: string[];
};

const SQUARE_LINE_EDGES: CadLineEntity[] = [
  line('S1', 'A', 'B', 0, 0, 10, 0),
  line('S2', 'B', 'C', 10, 0, 10, 10),
  line('S3', 'C', 'D', 10, 10, 0, 10),
  line('S4', 'D', 'A', 0, 10, 0, 0),
];

const expectPoints = (actual: Array<{ x: number; y: number }>, expected: number[][]): void => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((point, index) => {
    expect(point.x, `x[${index}]`).toBeCloseTo(expected[index]![0]!, 9);
    expect(point.y, `y[${index}]`).toBeCloseTo(expected[index]![1]!, 9);
  });
};

// ===========================================================================
// 1. Public export identity.
// ===========================================================================
describe('STRUCT-195.12 public export identity', () => {
  it('exposes the moved helpers identically via facade, Diagnostics, Linework, and topology', () => {
    for (const namespace of [facade, diagnostics, linework] as const) {
      expect(namespace.buildParcelLineCandidate).toBe(topology.buildParcelLineCandidate);
      expect(namespace.buildParcelNodeMap).toBe(topology.buildParcelNodeMap);
    }
  });

  it('keeps the linework diagnostics value identity across facade, Diagnostics, and Linework', () => {
    expect(diagnostics.cadBuildParcelLineworkDiagnostics).toBe(linework.cadBuildParcelLineworkDiagnostics);
    expect(facade.cadBuildParcelLineworkDiagnostics).toBe(linework.cadBuildParcelLineworkDiagnostics);
  });

  it('keeps the parcel diagnostics values on the facade and the Diagnostics module', () => {
    expect(facade.cadBuildParcelGapDiagnostics).toBe(diagnostics.cadBuildParcelGapDiagnostics);
    expect(facade.cadBuildParcelOverlapDiagnostics).toBe(diagnostics.cadBuildParcelOverlapDiagnostics);
    expect(facade.cadConvertAreaSquareMeters).toBe(diagnostics.cadConvertAreaSquareMeters);
  });
});

// ===========================================================================
// 2. Module import-order safety.
// ===========================================================================
describe('STRUCT-195.12 module import-order safety', () => {
  // Each order test runs against a fresh module registry (after
  // `vi.resetModules()`), so the dynamic imports below are genuinely cold
  // loads rather than warm-cache hits on the top-of-file static imports.
  const expectOrderedSingleton = (
    namespaces: ReadonlyArray<
      Record<'buildParcelLineCandidate' | 'buildParcelNodeMap', unknown>
    >,
  ): void => {
    const reference = namespaces[0]!;
    for (const namespace of namespaces.slice(1)) {
      expect(namespace.buildParcelLineCandidate).toBe(reference.buildParcelLineCandidate);
      expect(namespace.buildParcelNodeMap).toBe(reference.buildParcelNodeMap);
    }
  };

  const smokeTestHelpers = (namespace: typeof topology): void => {
    const candidate = namespace.buildParcelLineCandidate(line('I1', 'A', 'B', 0, 0, 10, 5));
    const nodeMap = namespace.buildParcelNodeMap([candidate]);
    expect(candidate.entityId).toBe('I1');
    expect(nodeMap.size).toBe(2);
    expect(nodeMap.get(candidate.startKey)?.incidentEntityIds).toEqual(['I1']);
  };

  it('resolves one helper instance when the barrel loads before the topology module', async () => {
    vi.resetModules();
    const barrel = await import('../src/engine/cad/cadCogoParcelGeometry');
    const lineworkModule = await import('../src/engine/cad/cadCogoParcelLineworkDiagnostics');
    const topo = await import('../src/engine/cad/cadCogoParcelLineworkTopology');
    expectOrderedSingleton([barrel, lineworkModule, topo]);
    smokeTestHelpers(topo);
  });

  it('resolves one helper instance when the topology module loads before the barrel', async () => {
    vi.resetModules();
    const topo = await import('../src/engine/cad/cadCogoParcelLineworkTopology');
    const lineworkModule = await import('../src/engine/cad/cadCogoParcelLineworkDiagnostics');
    const barrel = await import('../src/engine/cad/cadCogoParcelGeometry');
    expectOrderedSingleton([topo, lineworkModule, barrel]);
    smokeTestHelpers(topo);
  });
});

// ===========================================================================
// 3. Graph guard.
// ===========================================================================
describe('STRUCT-195.12 parcel graph guard', () => {
  const cyclicComponents = (nodes: string[], adjacency: Map<string, string[]>): string[][] =>
    tarjanSCC(nodes, adjacency).filter(
      (component) => component.length > 1 || (adjacency.get(component[0]!) ?? []).includes(component[0]!),
    );

  // The first graph read parses the entire CAD/Field-to-Finish scope. CI's
  // parallel full-suite load can exceed Vitest's 5s default; do not weaken
  // the SCC assertion just to shrink the timeout.
  it('reports the expected post-refactor SCC shape (VALUE 0 SCC / 0 nodes, TYPE 0)', () => {
    // STRUCT-195.13 downstream roll-forward (2026-10-10): a separate,
    // independently authorized change in cadParcelArcGeometry.ts (repointing
    // buildCadInverseSummary/formatCadBearing from './cadCogoMath' to
    // './cadCogoSummaries', exactly one VALUE edge removed + one added)
    // dissolved the 5-node cogo-arc SCC. The 195.12 parcel work pinned below
    // is byte-identical: the frozen 41-edge parcel slice, the topology
    // singleton, and the parcel-local allowlists are untouched. Only this
    // global VALUE SCC tally moves 2 SCC / 12 nodes -> 1 SCC / 7 nodes (the
    // 7-node geometry group); the authorization is proved independently in
    // tests/cad_project_transform_runtime_cycle_19511.test.ts.
    // STRUCT-195.14 downstream roll-forward: a separate, independently
    // authorized change (new cadGeometryPrimitives.ts core; facade thinned;
    // five leaves repointed) dissolved the last 7-node geometry SCC. The
    // 195.12 parcel work pinned below is still byte-identical; only this
    // global VALUE SCC tally moves 1 SCC / 7 nodes -> 0 SCC / 0 nodes; the
    // authorization is proved independently in
    // tests/cad_geometry_primitives_runtime_cycle_19514.test.ts.
    const graph = currentGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect(valueCycles.cyclic.length, 'VALUE SCC count').toBe(0);
    expect(valueCycles.cyclicNodes.size, 'VALUE cyclic nodes').toBe(0);
    expect(typeCycles.cyclic.length, 'TYPE SCC count').toBe(0);
    expect(typeCycles.cyclicNodes.size, 'TYPE cyclic nodes').toBe(0);
  }, 30_000);

  it('keeps the topology helper as a non-cyclic singleton in both graphs', () => {
    const graph = currentGraph();
    const topo = abs(TOPOLOGY);
    expect(graph.nodes).toContain(topo);
    expect((graph.value.get(topo) ?? []).length, 'topology VALUE out-degree').toBeGreaterThan(0);
    expect((graph.type.get(topo) ?? []).length, 'topology TYPE out-degree').toBeGreaterThan(0);
    expect(cyclicComponents(graph.nodes, graph.value).some((component) => component.includes(topo))).toBe(false);
    expect(cyclicComponents(graph.nodes, graph.type).some((component) => component.includes(topo))).toBe(false);
  });

  it('dropped the old 4-node parcel SCC from both graphs', () => {
    const graph = currentGraph();
    const oldScc = new Set(OLD_PARCEL_SCC.map(abs));
    for (const adjacency of [graph.value, graph.type]) {
      for (const component of cyclicComponents(graph.nodes, adjacency)) {
        const overlap = component.filter((member) => oldScc.has(member));
        expect(overlap, `old parcel SCC member still cyclic: ${overlap.map(rel).join(', ')}`).toEqual([]);
      }
      expect(
        cyclicComponents(graph.nodes, adjacency).some((component) => component.some((member) => PARCEL_SET.has(rel(member)))),
      ).toBe(false);
    }
  });

  it('removes and adds exactly the allowlisted parcel-local edges', () => {
    const currentParcel = relEdges(currentGraph()).filter(touchesParcel);
    expect(baselineEdges()).toHaveLength(41);
    const { removed, added } = multisetDelta(baselineEdges(), currentParcel);
    expect(added).toEqual(EXPECTED_ADDED);
    expect(removed).toEqual(EXPECTED_REMOVED);
    for (const key of [...removed, ...added]) {
      const [, from, to] = key.split('|');
      expect(PARCEL_SET.has(from!) || PARCEL_SET.has(to!), `${key} escapes the 5 parcel modules`).toBe(true);
    }
  });

  it('adds exactly two nodes (topology + primitives modules) and seven edges overall', () => {
    const graph = currentGraph();
    // STRUCT-195.14 adds exactly one node (cadGeometryPrimitives.ts) with a
    // net-zero total edge delta; 195.13 was already net-zero. STRUCT-241.1
    // adds exactly two type-only leaf nodes
    // (cadTransactionsLayerCommandTypes.ts +
    // cadTransactionsSurveyCommandTypes.ts) with four type edges, all
    // outside the parcel slice. STRUCT-241.2 adds one block type-only leaf
    // with two type edges, also outside the parcel slice. STRUCT-241.4 adds
    // one primitive/geometry type-only leaf with four type edges, also
    // outside the parcel slice. STRUCT-241.5 adds two type-only leaves with
    // eight type edges, also outside the parcel slice. The frozen 41-edge
    // parcel slice and its allowlists above are untouched.
    expect(graph.nodes.length).toBe(BASELINE_NODE_COUNT + 2 + STRUCT_2411_ADDED_NODES + STRUCT_2412_ADDED_NODES + STRUCT_2413_ADDED_NODES + STRUCT_2414_ADDED_NODES + STRUCT_2415_ADDED_NODES);
    expect(graph.edges.length).toBe(BASELINE_EDGE_COUNT + 7 + STRUCT_2411_ADDED_EDGES + STRUCT_2412_ADDED_EDGES + STRUCT_2413_ADDED_EDGES + STRUCT_2414_ADDED_EDGES + STRUCT_2415_ADDED_EDGES);
    expect(graph.nodes).toContain(abs(TOPOLOGY));
  });
});

// ===========================================================================
// 4. Module boundary negative controls.
// ===========================================================================
describe('STRUCT-195.12 module boundary (static parse)', () => {
  it('facade still export-stars Diagnostics and SourceDraft', () => {
    const stars = exportStarSpecifiers(GEOMETRY);
    expect(stars).toContain('./cadCogoParcelDiagnostics');
    expect(stars).toContain('./cadCogoParcelGeometrySourceDraft');
  });

  it('Diagnostics imports the split geometry leaves directly and never the broad facade', () => {
    const specifiers = importSpecifiers(DIAGNOSTICS);
    expect(specifiers).not.toContain('./cadCogoParcelGeometry');
    for (const leaf of [
      './cadCogoParcelGeometrySummaries',
      './cadCogoParcelGeometryOverlap',
      './cadCogoParcelGeometryPrimitives',
      './cadCogoParcelGeometryTypes',
    ]) {
      expect(specifiers, leaf).toContain(leaf);
    }
  });

  it('SourceDraft and Linework import the moved helpers from the topology module', () => {
    for (const file of [SOURCE_DRAFT, LINEWORK]) {
      const bindings = namedImportBindings(file, './cadCogoParcelLineworkTopology');
      expect(bindings, file).toContain('buildParcelLineCandidate');
      expect(bindings, file).toContain('buildParcelNodeMap');
    }
  });

  it('Linework re-exports the moved helpers for its existing consumers', () => {
    expect(fs.readFileSync(abs(LINEWORK), 'utf8'))
      .toContain('export { buildParcelLineCandidate, buildParcelNodeMap }');
  });
});

// ===========================================================================
// 5. Helper-body fidelity.
// ===========================================================================
const ORACLE_LINE_1 = line('L1', 'A', 'B', 0, 0, 10, 0);
const ORACLE_LINE_2 = line('L2', 'B', 'C', 10, 0, 20, 0);

describe('STRUCT-195.12 helper-body fidelity', () => {
  it('buildParcelLineCandidate matches the hand-transcribed oracle', () => {
    expect(buildParcelLineCandidate(ORACLE_LINE_1)).toEqual({
      entityId: 'L1',
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      startLabel: 'A',
      endLabel: 'B',
      startKey: '0:0',
      endKey: '10000000:0',
    });
  });

  it('buildParcelLineCandidate is deterministic and leaves the source untouched', () => {
    const before = JSON.stringify(ORACLE_LINE_1);
    expect(buildParcelLineCandidate(ORACLE_LINE_1)).toEqual(buildParcelLineCandidate(ORACLE_LINE_1));
    expect(JSON.stringify(ORACLE_LINE_1)).toBe(before);
  });

  it('buildParcelNodeMap matches the oracle labels, pointKeys, and incident arrays', () => {
    const candidates = [buildParcelLineCandidate(ORACLE_LINE_1), buildParcelLineCandidate(ORACLE_LINE_2)];
    const nodeMap = buildParcelNodeMap(candidates);
    expect([...nodeMap.entries()]).toEqual([
      ['0:0', { key: '0:0', point: { x: 0, y: 0 }, label: 'A', incidentEntityIds: ['L1'] }],
      ['10000000:0', { key: '10000000:0', point: { x: 10, y: 0 }, label: 'B', incidentEntityIds: ['L1', 'L2'] }],
      ['20000000:0', { key: '20000000:0', point: { x: 20, y: 0 }, label: 'C', incidentEntityIds: ['L2'] }],
    ]);
  });

  it('buildParcelNodeMap is deterministic and does not mutate candidates', () => {
    const candidates = [buildParcelLineCandidate(ORACLE_LINE_1), buildParcelLineCandidate(ORACLE_LINE_2)];
    const before = JSON.stringify(candidates);
    expect([...buildParcelNodeMap(candidates).entries()]).toEqual([...buildParcelNodeMap(candidates).entries()]);
    expect(JSON.stringify(candidates)).toBe(before);
  });
});

// ===========================================================================
// 6. Source-draft and diagnostics behavior oracles.
// ===========================================================================
describe('STRUCT-195.12 source-draft and diagnostics oracles', () => {
  it('builds a closed polyline draft from a closed ring', () => {
    const polyline: CadPolylineEntity = {
      ...cadBase,
      layerId: 'general',
      id: 'poly-1',
      type: 'polyline',
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 0, y: 0 },
      ],
      vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4', 'CAD1'],
      closed: true,
    };
    expect(cadBuildParcelSourceDraft([polyline])).toEqual({
      vertices: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4'],
      sourceEntityIds: ['poly-1'],
    });
  });

  it('builds a deterministic straight-line square draft', () => {
    expect(cadBuildParcelSourceDraft(SQUARE_LINE_EDGES)).toEqual({
      vertices: [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
      ],
      vertexLabels: ['A', 'D', 'C', 'B'],
      sourceEntityIds: ['S4', 'S3', 'S2', 'S1'],
    });
  });

  it('builds a deterministic mixed line+arc draft preserving the arc course', () => {
    const arc: CadArcEntity = {
      ...cadBase,
      layerId: 'general',
      id: 'create-arc',
      type: 'arc',
      centerX: 5,
      centerY: 0,
      radius: 5,
      startAngleDeg: 180,
      endAngleDeg: 360,
    };
    const draft = cadBuildParcelSourceDraft([
      arc,
      line('create-line-1', 'B', 'C', 10, 0, 10, 10),
      line('create-line-2', 'C', 'D', 10, 10, 0, 10),
      line('create-line-3', 'D', 'A', 0, 10, 0, 0),
    ]);
    expect(draft).not.toBeNull();
    expectPoints(draft!.vertices, [[0, 0], [0, 10], [10, 10], [10, 0]]);
    expect(draft!.vertexLabels).toEqual(['ARC1A', 'D', 'C', 'B']);
    expect(draft!.sourceEntityIds).toEqual(['create-line-3', 'create-line-2', 'create-line-1', 'create-arc']);
    expect(draft!.courseGeometry).toHaveLength(4);
    expect(draft!.courseGeometry!.slice(0, 3)).toEqual([{ kind: 'line' }, { kind: 'line' }, { kind: 'line' }]);
    expect(draft!.courseGeometry![3]!.kind).toBe('arc');
    if (draft!.courseGeometry![3]!.kind !== 'arc') throw new Error('expected arc course');
    expect(draft!.courseGeometry![3]!.bulge).toBeCloseTo(-1, 12);
  });

  it('reports the enclosed gap loop for a 3x3 coverage missing its centre', () => {
    const cells: Array<[number, number, string]> = [
      [0, 0, 'BL'], [10, 0, 'BM'], [20, 0, 'BR'],
      [0, 10, 'LM'], [20, 10, 'RM'],
      [0, 20, 'TL'], [10, 20, 'TM'], [20, 20, 'TR'],
    ];
    const diagnosticsResult = cadBuildParcelGapDiagnostics(
      cells.map(([x, y, name]) => parcel(`parcel:${name}`, `Parcel ${name}`, x, y)),
    );
    expect(diagnosticsResult.isSupported).toBe(true);
    expect(diagnosticsResult.componentCount).toBe(2);
    expect(diagnosticsResult.exposedLoopCount).toBe(2);
    expect(diagnosticsResult.gapLoops).toHaveLength(1);
    expect(diagnosticsResult.gapLoops[0]!.areaSquareMeters).toBeCloseTo(100, 9);
    expect(diagnosticsResult.gapLoops[0]!.centroid.x).toBeCloseTo(15, 9);
    expect(diagnosticsResult.gapLoops[0]!.centroid.y).toBeCloseTo(15, 9);
    expect(diagnosticsResult.totalGapAreaSquareMeters).toBeCloseTo(100, 9);
  });

  it('reports the exact shared overlap area for two shifted squares', () => {
    const diagnosticsResult = cadBuildParcelOverlapDiagnostics([
      parcel('parcel:1', 'Parcel 1', 0, 0),
      parcel('parcel:2', 'Parcel 2', 5, 0),
    ]);
    expect(diagnosticsResult.parcelCount).toBe(2);
    expect(diagnosticsResult.pairCount).toBe(1);
    expect(diagnosticsResult.overlapPairs).toEqual([
      {
        firstParcelId: 'parcel:1',
        firstParcelName: 'Parcel 1',
        secondParcelId: 'parcel:2',
        secondParcelName: 'Parcel 2',
        overlapAreaSquareMeters: 50,
      },
    ]);
    expect(diagnosticsResult.totalOverlapAreaSquareMeters).toBe(50);
  });

  it('leaves draft, gap, and overlap inputs byte-identical', () => {
    const arc: CadArcEntity = {
      ...cadBase,
      layerId: 'general',
      id: 'arc-keep',
      type: 'arc',
      centerX: 5,
      centerY: 0,
      radius: 5,
      startAngleDeg: 180,
      endAngleDeg: 360,
    };
    const drafts = [arc, ...SQUARE_LINE_EDGES];
    const cells = [parcel('parcel:1', 'Parcel 1', 0, 0), parcel('parcel:2', 'Parcel 2', 5, 0)];
    const before = JSON.stringify([drafts, cells]);
    cadBuildParcelSourceDraft(drafts);
    cadBuildParcelOverlapDiagnostics(cells);
    cadBuildParcelGapDiagnostics(cells);
    cadBuildParcelLineworkDiagnostics(SQUARE_LINE_EDGES);
    cadConvertAreaSquareMeters(187.5);
    expect(JSON.stringify([drafts, cells])).toBe(before);
  });

  it('diagnoses linework branches, overlaps, and open ends via the moved helpers', () => {
    const diagnosticsResult = cadBuildParcelLineworkDiagnostics([
      line('line:A|B:1', 'A', 'B', 0, 0, 10, 0),
      line('line:B|C', 'B', 'C', 10, 0, 20, 0),
      line('line:A|B:2', 'A', 'B', 0, 0, 10, 0),
    ]);
    expect(diagnosticsResult.nodeCount).toBe(3);
    expect(diagnosticsResult.componentCount).toBe(1);
    expect(diagnosticsResult.danglingNodes.map((node) => node.label)).toEqual(['C']);
    expect(diagnosticsResult.branchNodes.map((node) => node.label)).toEqual(['B']);
    expect(diagnosticsResult.overlapSegments).toEqual([
      { firstLabel: 'A', secondLabel: 'B', segmentCount: 2, lengthMeters: 10 },
    ]);
    expect(diagnosticsResult.isClosedLoopCandidate).toBe(false);
  });
});
