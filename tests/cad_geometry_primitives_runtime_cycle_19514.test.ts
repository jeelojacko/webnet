/**
 * STRUCT-195.14 — final CAD geometry runtime-cycle guard (primitive core + compatible facade).
 *
 * Breaks the last 7-node VALUE SCC {cadGeometry, cadGeometryCurves,
 * cadGeometryArcBuilders, cadGeometryArcPrimitives, cadGeometryCurveCore,
 * cadGeometryCurveIntersections, cadGeometryTangentCurve} by moving the
 * low-level core (5 interfaces + 15 primitive runtime functions) verbatim
 * into dependency-light src/engine/cad/cadGeometryPrimitives.ts, thinning
 * src/engine/cad/cadGeometry.ts to a 3-line public facade, and repointing
 * the five implementation leaves' `./cadGeometry` specifiers to
 * `./cadGeometryPrimitives` with bodies byte-identical.
 *
 * Coverage:
 *  1. pinned complete public export API of the old facade (51 runtime
 *     values + 5 types = 56 names): legacy type equality, direct-owner vs
 *     facade function IDENTITY, no undefined/ambiguous exports;
 *  2. moved-body parity: SHA256 over the new core file bytes equals the
 *     genuine baseline tail bytes (`git show HEAD:cadGeometry.ts | tail -n
 *     +6`; verified by the parent, pinned here as a constant — any drift,
 *     however small, fails);
 *  3. cold-load order safety (`vi.resetModules`): facade-first,
 *     Primitives-first, Curves-first, Intersections-first, tangent-first
 *     all resolve identical values with no TDZ;
 *  4. graph guard over src/engine/cad + src/engine/fieldToFinish built
 *     in-process via scripts/cadTypeImportGraph.mjs: VALUE 0/0, TYPE 0/0,
 *     all eight geometry modules singleton, exact 6-removed + 6-added
 *     allowlist (presence/absence, not git-derived — CI-safe shallow
 *     checkout), static import guards, negative control (in-memory restore
 *     of the five leaf facade imports recreates the exact historical
 *     7-node SCC), mutation control (forbidden return import recreates a
 *     cycle; restore-clean re-verified);
 *  5. fixed hand-checked numeric oracles for the moved primitives, all
 *     eight arc builders, arc primitives, curve metrics, intersections,
 *     tangent curve, fail-closed invalid/NaN/near-tolerance behavior, and
 *     no in-place input mutation.
 *
 * Agent tier: deterministic, no Adjustment solve. The first cold graph case
 * carries a 30s timeout (full-scope parse); later cases reuse the cache.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { buildGraphs, collectTypeScriptFiles, findCycles, tarjanSCC } from '../scripts/cadTypeImportGraph.mjs';

import * as facade from '../src/engine/cad/cadGeometry';
import * as primitives from '../src/engine/cad/cadGeometryPrimitives';
import * as curves from '../src/engine/cad/cadGeometryCurves';
import * as builders from '../src/engine/cad/cadGeometryArcBuilders';
import * as arcPrimitives from '../src/engine/cad/cadGeometryArcPrimitives';
import * as curveCore from '../src/engine/cad/cadGeometryCurveCore';
import * as intersections from '../src/engine/cad/cadGeometryCurveIntersections';
import * as tangentCurve from '../src/engine/cad/cadGeometryTangentCurve';
import type {
  CadArcDefinition,
  CadCurveMetrics,
  CadNamedPoint,
  CadSegmentGeometry,
  CadWorldPoint,
} from '../src/engine/cad/cadGeometry';
import type {
  CadArcDefinition as DirectCadArcDefinition,
  CadCurveMetrics as DirectCadCurveMetrics,
  CadNamedPoint as DirectCadNamedPoint,
  CadSegmentGeometry as DirectCadSegmentGeometry,
  CadWorldPoint as DirectCadWorldPoint,
} from '../src/engine/cad/cadGeometryPrimitives';

// ---------------------------------------------------------------------------
// Paths, frozen expectations.
// ---------------------------------------------------------------------------
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative);
const rel = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

const FACADE = 'src/engine/cad/cadGeometry.ts';
const PRIMITIVES = 'src/engine/cad/cadGeometryPrimitives.ts';
const CURVES = 'src/engine/cad/cadGeometryCurves.ts';
const BUILDERS = 'src/engine/cad/cadGeometryArcBuilders.ts';
const ARC_PRIMITIVES = 'src/engine/cad/cadGeometryArcPrimitives.ts';
const CURVE_CORE = 'src/engine/cad/cadGeometryCurveCore.ts';
const INTERSECTIONS = 'src/engine/cad/cadGeometryCurveIntersections.ts';
const TANGENT_CURVE = 'src/engine/cad/cadGeometryTangentCurve.ts';
const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish'];

/** The historical 7-node VALUE SCC dissolved by this refactor. */
const HISTORICAL_GEOMETRY_SCC = [
  FACADE,
  BUILDERS,
  ARC_PRIMITIVES,
  CURVE_CORE,
  INTERSECTIONS,
  CURVES,
  TANGENT_CURVE,
] as const;

const LEAF_MODULES = [BUILDERS, ARC_PRIMITIVES, CURVE_CORE, INTERSECTIONS, TANGENT_CURVE] as const;

/**
 * SHA256 over the raw bytes of src/engine/cad/cadGeometryPrimitives.ts.
 * Parent-verified byte-identical to the genuine baseline tail
 * (`git show c7987ebc:src/engine/cad/cadGeometry.ts | tail -n +6`): the move
 * omits only the unused `import type { CadArcEntity }` line and the two old
 * facade `export *` lines. Canonicalization: none — raw file bytes.
 */
const EXPECTED_PRIMITIVES_BODY_SHA256 =
  'd7167ba2e6ccd384110492a2e085295e496cde54569d02e6e18f603651806c93';

/** Post-195.14 global VALUE fingerprint (parent-measured at integration). */
const EXPECTED_VALUE_PAIR_COUNT = 1567;
const EXPECTED_VALUE_EDGE_COUNT = 1585;
const EXPECTED_VALUE_PAIRS_SHA256 =
  '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7';
// STRUCT-241.1 adds exactly two type-only leaf nodes
// (cadTransactionsLayerCommandTypes.ts + cadTransactionsSurveyCommandTypes.ts)
// with four type edges; the golden VALUE fingerprint above is untouched.
const STRUCT_2411_ADDED_NODES = 2;
const STRUCT_2411_ADDED_EDGES = 4;
// STRUCT-241.2 adds exactly one type-only leaf node
// (cadTransactionsBlockCommandTypes.ts) with two type edges
// (hub -> leaf + leaf -> primitive types); the golden VALUE fingerprint
// above is untouched.
const STRUCT_2412_ADDED_NODES = 1;
const STRUCT_2412_ADDED_EDGES = 2;
// STRUCT-241.3 adds exactly two type-only leaf nodes
// (cadEntityFoundationTypes.ts + cadSurveyPresentationTypes.ts) with six
// type edges (hub import-type + hub export-type per leaf + one leaf ->
// primitive-types edge per leaf); the golden VALUE fingerprint above is
// untouched.
const STRUCT_2413_ADDED_NODES = 2;
const STRUCT_2413_ADDED_EDGES = 6;
// STRUCT-241.4 adds exactly one type-only leaf node
// (cadPrimitiveGeometryEntityTypes.ts) with four scoped type edges
// (hub import-type + hub export-type + two owner-leaf edges); the golden
// VALUE fingerprint above is untouched.
const STRUCT_2414_ADDED_NODES = 1;
const STRUCT_2414_ADDED_EDGES = 4;
// STRUCT-241.5 adds exactly two type-only leaf nodes
// (cadAnnotationEntityStyleTypes.ts + cadSurveyTableEntityTypes.ts) with
// eight scoped type edges (annotation 3 out + hub import-type + hub
// export-type, survey 2 out + hub import-type + hub export-type, minus the
// retired hub -> anchor import-type edge); the golden VALUE fingerprint
// above is untouched.
const STRUCT_2415_ADDED_NODES = 2;
const STRUCT_2415_ADDED_EDGES = 8;
const EXPECTED_NODE_COUNT = 483 + STRUCT_2411_ADDED_NODES + STRUCT_2412_ADDED_NODES + STRUCT_2413_ADDED_NODES + STRUCT_2414_ADDED_NODES + STRUCT_2415_ADDED_NODES;
const EXPECTED_EDGE_COUNT = 2400 + STRUCT_2411_ADDED_EDGES + STRUCT_2412_ADDED_EDGES + STRUCT_2413_ADDED_EDGES + STRUCT_2414_ADDED_EDGES + STRUCT_2415_ADDED_EDGES;

/** Independently measured STRUCT-195.14 removal allowlist (6 edges, all kinds). */
const EXPECTED_REMOVED = [
  `mixed|${BUILDERS}|${FACADE}`,
  `mixed|${ARC_PRIMITIVES}|${FACADE}`,
  `mixed|${CURVE_CORE}|${FACADE}`,
  `mixed|${INTERSECTIONS}|${FACADE}`,
  `mixed|${TANGENT_CURVE}|${FACADE}`,
  `type|${FACADE}|src/engine/cad/cadTypes.ts`,
].sort();
/** Independently measured STRUCT-195.14 addition allowlist (6 edges, all kinds). */
const EXPECTED_ADDED = [
  `mixed|${BUILDERS}|${PRIMITIVES}`,
  `mixed|${ARC_PRIMITIVES}|${PRIMITIVES}`,
  `mixed|${CURVE_CORE}|${PRIMITIVES}`,
  `mixed|${INTERSECTIONS}|${PRIMITIVES}`,
  `mixed|${TANGENT_CURVE}|${PRIMITIVES}`,
  `value|${FACADE}|${PRIMITIVES}`,
].sort();

/** The 51 runtime values the old broad facade exposed (frozen API surface). */
const EXPECTED_FACADE_RUNTIME_EXPORTS = [
  'cadAngleDegFromCenter',
  'cadArcEndPoint',
  'cadArcEndTangentAzimuthDeg',
  'cadArcMidpoint',
  'cadArcStartPoint',
  'cadAzimuthDeg',
  'cadBuildArcFromCenterAngles',
  'cadBuildArcFromCenterSweep',
  'cadBuildArcFromStartCenterAngle',
  'cadBuildArcFromStartCenterChord',
  'cadBuildArcFromStartCenterEnd',
  'cadBuildArcFromStartEndAngle',
  'cadBuildArcFromStartEndDirection',
  'cadBuildArcFromStartEndRadius',
  'cadBuildArcFromStartTangentRadiusDelta',
  'cadBuildArcFromThreePoints',
  'cadBuildContinuedArc',
  'cadBuildCurveMetricsFromArcLength',
  'cadBuildCurveMetricsFromChordLength',
  'cadBuildCurveMetricsFromRadiusDelta',
  'cadBuildCurveMetricsFromTangentLength',
  'cadBuildParallelLine',
  'cadBuildPerpendicularFoot',
  'cadBuildTangentCurve',
  'cadClosestPointOnArc',
  'cadClosestPointOnSegment',
  'cadCounterClockwiseDeltaDeg',
  'cadCreateCurveMetrics',
  'cadDistance',
  'cadInfiniteLineIntersection',
  'cadIntersectArcArc',
  'cadIntersectCircleCircle',
  'cadIntersectInfiniteLineArc',
  'cadIntersectInfiniteLineCircle',
  'cadIntersectSegmentArc',
  'cadIntersectSegmentCircle',
  'cadIsAngleOnArcSweep',
  'cadMidpoint',
  'cadNormalizeAngleDeg',
  'cadOffsetLineSegment',
  'cadParseBearingDegrees',
  'cadParseDmsDegrees',
  'cadPointFromAzimuthDistance',
  'cadPointOnCircle',
  'cadPointOnInfiniteLine',
  'cadProjectPointOntoCircle',
  'cadProjectPointOntoInfiniteLine',
  'cadSegmentIntersection',
  'cadSignedSweepDeg',
  'cadTangentPointsFromExternalPointToArc',
  'cadTangentPointsFromExternalPointToCircle',
] as const;

/** Direct owner module for each facade runtime value (identity pins). */
const OWNER_BY_EXPORT: Record<string, Record<string, unknown>> = {
  cadDistance: primitives,
  cadMidpoint: primitives,
  cadClosestPointOnSegment: primitives,
  cadPointOnInfiniteLine: primitives,
  cadProjectPointOntoInfiniteLine: primitives,
  cadPointOnCircle: primitives,
  cadSegmentIntersection: primitives,
  cadInfiniteLineIntersection: primitives,
  cadAzimuthDeg: primitives,
  cadPointFromAzimuthDistance: primitives,
  cadNormalizeAngleDeg: primitives,
  cadSignedSweepDeg: primitives,
  cadAngleDegFromCenter: primitives,
  cadParseDmsDegrees: primitives,
  cadParseBearingDegrees: primitives,
  cadBuildArcFromStartCenterEnd: builders,
  cadBuildArcFromStartCenterAngle: builders,
  cadBuildArcFromStartCenterChord: builders,
  cadBuildArcFromStartEndAngle: builders,
  cadBuildArcFromStartEndRadius: builders,
  cadBuildArcFromStartEndDirection: builders,
  cadBuildArcFromStartTangentRadiusDelta: builders,
  cadBuildContinuedArc: builders,
  cadArcStartPoint: arcPrimitives,
  cadArcEndPoint: arcPrimitives,
  cadIsAngleOnArcSweep: arcPrimitives,
  cadArcMidpoint: arcPrimitives,
  cadClosestPointOnArc: arcPrimitives,
  cadProjectPointOntoCircle: arcPrimitives,
  cadBuildArcFromThreePoints: arcPrimitives,
  cadArcEndTangentAzimuthDeg: arcPrimitives,
  cadCounterClockwiseDeltaDeg: curveCore,
  cadCreateCurveMetrics: curveCore,
  cadBuildCurveMetricsFromRadiusDelta: curveCore,
  cadBuildCurveMetricsFromArcLength: curveCore,
  cadBuildCurveMetricsFromChordLength: curveCore,
  cadBuildCurveMetricsFromTangentLength: curveCore,
  cadBuildArcFromCenterAngles: curveCore,
  cadBuildArcFromCenterSweep: curveCore,
  cadIntersectSegmentCircle: intersections,
  cadIntersectSegmentArc: intersections,
  cadIntersectInfiniteLineCircle: intersections,
  cadIntersectInfiniteLineArc: intersections,
  cadIntersectCircleCircle: intersections,
  cadIntersectArcArc: intersections,
  cadTangentPointsFromExternalPointToCircle: intersections,
  cadTangentPointsFromExternalPointToArc: intersections,
  cadOffsetLineSegment: intersections,
  cadBuildParallelLine: intersections,
  cadBuildPerpendicularFoot: intersections,
  cadBuildTangentCurve: tangentCurve,
};

// ===========================================================================
// 1. Pinned public API + value identity.
// ===========================================================================
describe('STRUCT-195.14 facade public API + value identity', () => {
  it('exposes exactly the 51 historical runtime values with no undefined export', () => {
    expect(Object.keys(facade).sort()).toEqual([...EXPECTED_FACADE_RUNTIME_EXPORTS].sort());
    for (const name of EXPECTED_FACADE_RUNTIME_EXPORTS) {
      expect((facade as Record<string, unknown>)[name], name).toBeDefined();
      expect(typeof (facade as Record<string, unknown>)[name], name).toBe('function');
    }
  });

  it('returns the SAME function object as the direct owner (no wrappers/copies)', () => {
    expect(Object.keys(OWNER_BY_EXPORT).sort()).toEqual([...EXPECTED_FACADE_RUNTIME_EXPORTS].sort());
    for (const [name, owner] of Object.entries(OWNER_BY_EXPORT)) {
      expect((facade as Record<string, unknown>)[name], `facade vs owner: ${name}`).toBe(
        (owner as Record<string, unknown>)[name],
      );
    }
  });

  it('keeps the five historical public types identical across facade and core', () => {
    expectTypeOf<CadWorldPoint>().toEqualTypeOf<DirectCadWorldPoint>();
    expectTypeOf<CadNamedPoint>().toEqualTypeOf<DirectCadNamedPoint>();
    expectTypeOf<CadSegmentGeometry>().toEqualTypeOf<DirectCadSegmentGeometry>();
    expectTypeOf<CadCurveMetrics>().toEqualTypeOf<DirectCadCurveMetrics>();
    expectTypeOf<CadArcDefinition>().toEqualTypeOf<DirectCadArcDefinition>();
  });

  it('keeps curve/intersection re-exports identical between facade and leaf paths', () => {
    expect(facade.cadIsAngleOnArcSweep).toBe(curves.cadIsAngleOnArcSweep);
    expect(facade.cadIntersectSegmentCircle).toBe(intersections.cadIntersectSegmentCircle);
    expect(facade.cadBuildTangentCurve).toBe(tangentCurve.cadBuildTangentCurve);
  });
});

// ===========================================================================
// 2. Moved-body parity (pinned SHA over raw bytes).
// ===========================================================================
describe('STRUCT-195.14 moved-body parity', () => {
  it('matches the genuine baseline primitive bytes (pinned SHA256)', () => {
    const bytes = fs.readFileSync(abs(PRIMITIVES));
    const actual = createHash('sha256').update(bytes).digest('hex');
    expect(`primitives sha256 ${actual} (want ${EXPECTED_PRIMITIVES_BODY_SHA256})`).toBe(
      `primitives sha256 ${EXPECTED_PRIMITIVES_BODY_SHA256} (want ${EXPECTED_PRIMITIVES_BODY_SHA256})`,
    );
  });

  it('preserves exact geometry math markers (atan2 order, sweep, epsilons, bearing clamp)', () => {
    const source = fs.readFileSync(abs(PRIMITIVES), 'utf8');
    expect(source).toContain('Math.atan2(east, north)');
    expect(source).toContain('Math.max(0, Math.min(90, angleDeg))');
    expect(source).toContain('minutes >= 60');
    expect(source).toContain('lengthSquared <= 1e-12');
    expect(source).toContain('Math.abs(denominator) <= 1e-12');
    expect(source).toContain('normalizeDmsToken');
  });
});

// ===========================================================================
// 3. Cold-load order safety.
// ===========================================================================
const expectColdGeometry = (freshFacade: typeof facade, freshPrimitives: typeof primitives): void => {
  expect(typeof freshFacade.cadDistance).toBe('function');
  expect(typeof freshFacade.cadBuildArcFromStartCenterEnd).toBe('function');
  expect(typeof freshFacade.cadIntersectSegmentCircle).toBe('function');
  expect(typeof freshFacade.cadBuildTangentCurve).toBe('function');
  // Same instance through both paths inside one fresh registry (no TDZ).
  expect(freshFacade.cadDistance).toBe(freshPrimitives.cadDistance);
  expect(freshFacade.cadNormalizeAngleDeg).toBe(freshPrimitives.cadNormalizeAngleDeg);
  // Live calls through the facade prove bindings are initialized.
  expect(freshFacade.cadDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  expect(
    freshFacade.cadBuildArcFromStartCenterEnd({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 })!.radius,
  ).toBeCloseTo(5, 12);
};

describe('STRUCT-195.14 cold-load import-order safety', () => {
  it('resolves identical values when the facade loads first', async () => {
    vi.resetModules();
    const f = await import('../src/engine/cad/cadGeometry');
    const p = await import('../src/engine/cad/cadGeometryPrimitives');
    await import('../src/engine/cad/cadGeometryCurves');
    expectColdGeometry(f, p);
  });

  it('resolves identical values when Primitives loads first', async () => {
    vi.resetModules();
    const p = await import('../src/engine/cad/cadGeometryPrimitives');
    const f = await import('../src/engine/cad/cadGeometry');
    await import('../src/engine/cad/cadGeometryCurves');
    expectColdGeometry(f, p);
  });

  it('resolves identical values when Curves loads first', async () => {
    vi.resetModules();
    await import('../src/engine/cad/cadGeometryCurves');
    const f = await import('../src/engine/cad/cadGeometry');
    const p = await import('../src/engine/cad/cadGeometryPrimitives');
    expectColdGeometry(f, p);
  });

  it('resolves identical values when Intersections loads first', async () => {
    vi.resetModules();
    await import('../src/engine/cad/cadGeometryCurveIntersections');
    const f = await import('../src/engine/cad/cadGeometry');
    const p = await import('../src/engine/cad/cadGeometryPrimitives');
    expect(f.cadIntersectSegmentCircle({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 5)).toEqual([
      { x: -5, y: 0 },
      { x: 5, y: 0 },
    ]);
    expectColdGeometry(f, p);
  });

  it('resolves identical values when the tangent leaf loads first', async () => {
    vi.resetModules();
    await import('../src/engine/cad/cadGeometryTangentCurve');
    const f = await import('../src/engine/cad/cadGeometry');
    const p = await import('../src/engine/cad/cadGeometryPrimitives');
    expect(
      f.cadBuildTangentCurve({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 5)!.radius,
    ).toBeCloseTo(5, 12);
    expectColdGeometry(f, p);
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

/** In-memory restore of all five leaf `./cadGeometry` imports (negative control). */
const revertedLeafSource = (file: string): string => {
  const original = fs.readFileSync(abs(file), 'utf8');
  const reverted = original.replaceAll("from './cadGeometryPrimitives'", "from './cadGeometry'");
  expect(reverted, `${file} must reference the primitives specifier`).not.toBe(original);
  return reverted;
};

const revertedOverrides = (): Map<string, string> => {
  const overrides = new Map<string, string>();
  for (const file of LEAF_MODULES) overrides.set(abs(file), revertedLeafSource(file));
  return overrides;
};

let currentCache: ScopeGraph | undefined;
let revertedCache: ScopeGraph | undefined;
const currentGraph = (): ScopeGraph => (currentCache ??= buildScopeGraph(new Map()));
const revertedGraph = (): ScopeGraph => (revertedCache ??= buildScopeGraph(revertedOverrides()));

const relEdges = (graph: ScopeGraph): RelEdge[] =>
  graph.edges.map((edge) => ({ from: rel(edge.from), to: rel(edge.to), kind: edge.kind as EdgeKind }));
const edgeKey = (edge: RelEdge): string => `${edge.kind}|${edge.from}|${edge.to}`;

const parseSource = (file: string): ts.SourceFile =>
  ts.createSourceFile(abs(file), fs.readFileSync(abs(file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const importSpecifiers = (file: string): string[] =>
  parseSource(file).statements
    .filter((stmt): stmt is ts.ImportDeclaration =>
      ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
const exportModuleSpecifiers = (file: string): string[] =>
  parseSource(file).statements
    .filter((stmt): stmt is ts.ExportDeclaration => ts.isExportDeclaration(stmt)
      && stmt.moduleSpecifier != null && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

describe('STRUCT-195.14 geometry graph guard', () => {
  // First cold graph build parses the whole CAD + Field-to-Finish scope; warm
  // BOTH the current and reverted graphs here so only this case pays the cost.
  it('dissolves the last VALUE SCC to ZERO (baseline 1/7), TYPE stays 0', () => {
    const graph = currentGraph();
    const baseline = revertedGraph();

    const valueCycles = findCycles(graph.nodes, graph.value);
    expect(valueCycles.cyclic.length, 'current VALUE SCC count').toBe(0);
    expect(valueCycles.cyclicNodes.size, 'current VALUE cyclic nodes').toBe(0);
    expect(tarjanSCC(graph.nodes, graph.value).filter((c) => c.length > 1)).toEqual([]);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect(typeCycles.cyclic.length, 'TYPE SCC count').toBe(0);
    expect(typeCycles.cyclicNodes.size, 'TYPE cyclic nodes').toBe(0);

    const baselineValue = findCycles(baseline.nodes, baseline.value);
    expect(baselineValue.cyclic.length, 'reverted VALUE SCC count').toBe(1);
    expect(baselineValue.cyclicNodes.size, 'reverted VALUE cyclic nodes').toBe(7);
    expect(baselineValue.largest).toEqual([...HISTORICAL_GEOMETRY_SCC.map(abs)].sort());
  }, 30_000);

  it('keeps all eight geometry modules present and non-cyclic singletons', () => {
    const graph = currentGraph();
    for (const member of [...HISTORICAL_GEOMETRY_SCC, PRIMITIVES]) {
      expect(graph.nodes, `${member} missing from graph`).toContain(abs(member));
    }
    const cyclic = findCycles(graph.nodes, graph.value).cyclic;
    for (const member of [...HISTORICAL_GEOMETRY_SCC, PRIMITIVES]) {
      expect(
        cyclic.some((component) => component.includes(abs(member))),
        `${member} still cyclic`,
      ).toBe(false);
    }
    // The new core is a genuine sink: no VALUE out-edges to any geometry module.
    expect(graph.value.get(abs(PRIMITIVES)) ?? []).toEqual([]);
  });

  it('matches the post-195.14 golden VALUE fingerprint and node/edge totals', () => {
    const graph = currentGraph();
    expect(graph.nodes.length, 'node count').toBe(EXPECTED_NODE_COUNT);
    expect(graph.edges.length, 'edge count').toBe(EXPECTED_EDGE_COUNT);
    const toPosix = (p: string): string => p.split(path.sep).join('/');
    const pairs = [...new Set(
      graph.edges
        .filter((edge) => edge.kind === 'value' || edge.kind === 'mixed')
        .map((edge) => `${toPosix(rel(edge.from))}\n${toPosix(rel(edge.to))}`),
    )].sort();
    const edgeCount = graph.edges.filter(
      (edge) => edge.kind === 'value' || edge.kind === 'mixed',
    ).length;
    const actualHash = createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
    expect(
      `value pairs ${pairs.length} (want ${EXPECTED_VALUE_PAIR_COUNT}), `
        + `value edges ${edgeCount} (want ${EXPECTED_VALUE_EDGE_COUNT}), `
        + `pairs sha256 ${actualHash} (want ${EXPECTED_VALUE_PAIRS_SHA256})`,
    ).toBe(
      `value pairs ${EXPECTED_VALUE_PAIR_COUNT} `
        + `(want ${EXPECTED_VALUE_PAIR_COUNT}), `
        + `value edges ${EXPECTED_VALUE_EDGE_COUNT} `
        + `(want ${EXPECTED_VALUE_EDGE_COUNT}), `
        + `pairs sha256 ${EXPECTED_VALUE_PAIRS_SHA256} `
        + `(want ${EXPECTED_VALUE_PAIRS_SHA256})`,
    );
  });

  it('carries exactly the authorized 6-removed + 6-added edge delta (all kinds)', () => {
    const keys = new Set(relEdges(currentGraph()).map(edgeKey));
    for (const removed of EXPECTED_REMOVED) {
      expect(keys.has(removed), `stale edge still present: ${removed}`).toBe(false);
    }
    for (const added of EXPECTED_ADDED) {
      expect(keys.has(added), `authorized edge missing: ${added}`).toBe(true);
    }
    // No other edge incident to the new core exists.
    const coreEdges = [...keys].filter((key) => key.includes(PRIMITIVES));
    expect(coreEdges.sort()).toEqual([...EXPECTED_ADDED].filter((key) => key.includes(PRIMITIVES)).sort());
  });

  it('static import guard: no leaf imports the facade; core imports nothing; facade is star-only', () => {
    for (const leaf of LEAF_MODULES) {
      expect(importSpecifiers(leaf), `${leaf} imports facade`).not.toContain('./cadGeometry');
      expect(importSpecifiers(leaf), `${leaf} must bind the core`).toContain('./cadGeometryPrimitives');
    }
    expect(importSpecifiers(PRIMITIVES)).toEqual([]);
    expect(exportModuleSpecifiers(PRIMITIVES)).toEqual([]);
    // Facade keeps the two original stars in original relative order plus the core star.
    expect(exportModuleSpecifiers(FACADE)).toContain('./cadGeometryPrimitives');
    expect(exportModuleSpecifiers(FACADE)).toContain('./cadGeometryCurves');
    expect(exportModuleSpecifiers(FACADE)).toContain('./cadGeometryCurveIntersections');
    const facadeSource = parseSource(FACADE);
    const localDecls = facadeSource.statements.filter((stmt) =>
      ts.isFunctionDeclaration(stmt) || ts.isVariableStatement(stmt) || ts.isClassDeclaration(stmt)
      || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt));
    expect(localDecls, 'facade must declare nothing locally').toEqual([]);
    // The Curves barrel is byte-untouched: still exactly its four historical stars.
    expect(exportModuleSpecifiers(CURVES).sort()).toEqual([
      './cadGeometryArcBuilders',
      './cadGeometryArcPrimitives',
      './cadGeometryCurveCore',
      './cadGeometryTangentCurve',
    ].sort());
  });

  it('negative control: restoring the five facade imports recreates the exact 7-node SCC', () => {
    const baseline = revertedGraph();
    const valueCycles = findCycles(baseline.nodes, baseline.value);
    // Fails the post-refactor 0/0 assertion by construction.
    expect(valueCycles.cyclic.length).not.toBe(0);
    expect(valueCycles.cyclicNodes.size).not.toBe(7 - 7);
    const seven = valueCycles.cyclic.find((component) => component.length === 7);
    expect(seven, 'historical 7-node geometry SCC missing').toBeDefined();
    expect(seven).toEqual([...HISTORICAL_GEOMETRY_SCC.map(abs)].sort());
  });

  it('mutation control: a forbidden core -> leaf return import recreates a cycle, then restores clean', () => {
    const mutatedSource = `${fs.readFileSync(abs(PRIMITIVES), 'utf8')}\nimport { cadArcStartPoint } from './cadGeometryArcPrimitives';\nvoid cadArcStartPoint;\n`;
    const mutated = buildScopeGraph(new Map([[abs(PRIMITIVES), mutatedSource]]));
    const mutatedCycles = findCycles(mutated.nodes, mutated.value);
    expect(mutatedCycles.cyclic.length).toBeGreaterThan(0);
    expect(
      mutatedCycles.cyclic.some((component) => component.includes(abs(PRIMITIVES))),
      'core must join the recreated cycle',
    ).toBe(true);
    // Restore clean: the committed graph is still 0/0.
    const clean = currentGraph();
    expect(findCycles(clean.nodes, clean.value).cyclic.length).toBe(0);
    expect(findCycles(clean.nodes, clean.type).cyclic.length).toBe(0);
  });
});

// ===========================================================================
// 5. Fixed deterministic numeric oracles.
// ===========================================================================
describe('STRUCT-195.14 primitive oracles', () => {
  it('pins distance, midpoint, azimuth, and azimuth/distance duality', () => {
    expect(primitives.cadDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(primitives.cadMidpoint({ x: 0, y: 0 }, { x: 3, y: 4 })).toEqual({ x: 1.5, y: 2 });
    expect(primitives.cadAzimuthDeg({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe(90);
    expect(primitives.cadAzimuthDeg({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe(0);
    expect(primitives.cadAzimuthDeg({ x: 0, y: 0 }, { x: -10, y: -10 })).toBe(225);
    const there = primitives.cadPointFromAzimuthDistance({ x: 0, y: 0 }, 90, 10);
    expect(there.x).toBeCloseTo(10, 12);
    expect(there.y).toBeCloseTo(0, 12);
    // Round-trip: azimuth there -> distance back.
    expect(primitives.cadAzimuthDeg({ x: 0, y: 0 }, there)).toBeCloseTo(90, 9);
    expect(primitives.cadDistance({ x: 0, y: 0 }, there)).toBeCloseTo(10, 12);
  });

  it('pins circle, angle-normalize, signed-sweep, and center-angle math', () => {
    expect(primitives.cadPointOnCircle({ x: 1, y: 2 }, 5, 0)).toEqual({ x: 6, y: 2 });
    const top = primitives.cadPointOnCircle({ x: 1, y: 2 }, 5, 90);
    expect(top.x).toBeCloseTo(1, 12);
    expect(top.y).toBeCloseTo(7, 12);
    expect(primitives.cadNormalizeAngleDeg(720)).toBe(0);
    expect(primitives.cadNormalizeAngleDeg(-90)).toBe(270);
    expect(primitives.cadNormalizeAngleDeg(360)).toBe(0);
    expect(primitives.cadSignedSweepDeg(10, 350)).toBe(340);
    expect(primitives.cadSignedSweepDeg(350, 10)).toBe(-340);
    expect(primitives.cadSignedSweepDeg(0, 720)).toBe(360);
    expect(primitives.cadAngleDegFromCenter({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(primitives.cadAngleDegFromCenter({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
  });

  it('pins segment/line intersection including parallel fail-closed', () => {
    expect(
      primitives.cadSegmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 }),
    ).toEqual({ x: 5, y: 0 });
    expect(
      primitives.cadSegmentIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 }),
    ).toBeNull();
    expect(
      primitives.cadInfiniteLineIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 10 }),
    ).toEqual({ x: 0, y: 0 });
  });

  it('pins closest-point, projection, and zero-length handling', () => {
    expect(primitives.cadClosestPointOnSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }))
      .toEqual({ x: 5, y: 0 });
    expect(primitives.cadClosestPointOnSegment({ x: 5, y: 5 }, { x: 2, y: 2 }, { x: 2, y: 2 }))
      .toEqual({ x: 2, y: 2 });
    expect(primitives.cadProjectPointOntoInfiniteLine({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 }))
      .toEqual({ point: { x: 5, y: 0 }, t: 0.5 });
    expect(primitives.cadPointOnInfiniteLine({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.25))
      .toEqual({ x: 2.5, y: 0 });
  });

  it('pins DMS/bearing parsing, quadrant mapping, clamping, and fail-closed', () => {
    expect(primitives.cadParseDmsDegrees('10-30-00')).toBe(10.5);
    expect(primitives.cadParseDmsDegrees('45.5')).toBe(45.5);
    expect(primitives.cadParseDmsDegrees('abc')).toBeNull();
    expect(primitives.cadParseDmsDegrees('10-70-00')).toBeNull();
    expect(primitives.cadParseDmsDegrees('')).toBeNull();
    expect(primitives.cadParseBearingDegrees('N45-00-00E')).toBe(45);
    expect(primitives.cadParseBearingDegrees('S30-00-00W')).toBe(210);
    expect(primitives.cadParseBearingDegrees('S45-00-00E')).toBe(135);
    expect(primitives.cadParseBearingDegrees('N45-00-00W')).toBe(315);
    expect(primitives.cadParseBearingDegrees('N90-00-00E')).toBe(90);
    // Out-of-quadrant angles clamp to 90, plain numbers normalize.
    expect(primitives.cadParseBearingDegrees('N99-00-00E')).toBe(90);
    expect(primitives.cadParseBearingDegrees('100')).toBe(100);
    expect(primitives.cadParseBearingDegrees('xx')).toBeNull();
    expect(primitives.cadParseBearingDegrees('')).toBeNull();
  });

  it('fails closed on NaN without throwing', () => {
    expect(primitives.cadDistance({ x: Number.NaN, y: 0 }, { x: 0, y: 0 })).toBeNaN();
    expect(primitives.cadNormalizeAngleDeg(Number.NaN)).toBeNaN();
  });
});

describe('STRUCT-195.14 arc-builder oracles (all eight)', () => {
  it('builds start/center/end arcs clockwise and counter-clockwise', () => {
    const cw = builders.cadBuildArcFromStartCenterEnd({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 })!;
    expect(cw.center).toEqual({ x: 0, y: 0 });
    expect(cw.radius).toBeCloseTo(5, 12);
    expect(cw.deltaDeg).toBeCloseTo(90, 12);
    const ccw = builders.cadBuildArcFromStartCenterEnd({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 5 }, true)!;
    expect(ccw.deltaDeg).toBeCloseTo(270, 12);
    expect(ccw.radius).toBeCloseTo(5, 12);
  });

  it('builds start/center/angle and start/center/chord arcs', () => {
    const angled = builders.cadBuildArcFromStartCenterAngle({ x: 5, y: 0 }, { x: 0, y: 0 }, 90)!;
    expect(angled.radius).toBeCloseTo(5, 12);
    expect(angled.deltaDeg).toBeCloseTo(90, 12);
    const chorded = builders.cadBuildArcFromStartCenterChord({ x: 0, y: 0 }, { x: 5, y: 0 }, 8)!;
    expect(chorded.radius).toBeCloseTo(5, 12);
    expect(chorded.deltaDeg).toBeCloseTo(106.26020470831196, 9);
    // Diameter chord is degenerate: fail closed.
    expect(builders.cadBuildArcFromStartCenterChord({ x: 0, y: 0 }, { x: 5, y: 0 }, 10)).toBeNull();
  });

  it('builds start/end/delta, start/end/radius, and start/end/direction arcs', () => {
    const angled = builders.cadBuildArcFromStartEndAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, 90)!;
    expect(angled.radius).toBeCloseTo(7.0710678118654755, 9);
    expect(angled.deltaDeg).toBeCloseTo(90, 12);
    expect(builders.cadBuildArcFromStartEndAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeNull();
    expect(builders.cadBuildArcFromStartEndAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, 360)).toBeNull();
    const radiused = builders.cadBuildArcFromStartEndRadius({ x: 0, y: 0 }, { x: 10, y: 0 }, 6)!;
    expect(radiused.radius).toBeCloseTo(6, 12);
    expect(radiused.deltaDeg).toBeCloseTo(112.88538047615859, 9);
    expect(builders.cadBuildArcFromStartEndRadius({ x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toBeNull();
    expect(builders.cadBuildArcFromStartEndRadius({ x: 0, y: 0 }, { x: 10, y: 0 }, -6)).toBeNull();
    const directed = builders.cadBuildArcFromStartEndDirection({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)!;
    expect(directed.radius).toBeCloseTo(5, 12);
    expect(directed.deltaDeg).toBeCloseTo(180, 12);
    // Tangent parallel to the chord is impossible: fail closed.
    expect(builders.cadBuildArcFromStartEndDirection({ x: 0, y: 0 }, { x: 10, y: 0 }, 90)).toBeNull();
  });

  it('builds start/tangent/radius/delta (both sides) and continued arcs', () => {
    const left = builders.cadBuildArcFromStartTangentRadiusDelta({ x: 0, y: 0 }, 90, 5, 90, 'left')!;
    expect(left.radius).toBeCloseTo(5, 12);
    expect(left.deltaDeg).toBeCloseTo(90, 12);
    expect(left.center.y).toBeCloseTo(5, 12);
    const right = builders.cadBuildArcFromStartTangentRadiusDelta({ x: 0, y: 0 }, 90, 5, 90, 'right')!;
    expect(right.radius).toBeCloseTo(5, 12);
    expect(right.deltaDeg).toBeCloseTo(90, 12);
    expect(right.center.y).toBeCloseTo(-5, 12);
    const continued = builders.cadBuildContinuedArc(
      { centerX: 0, centerY: 0, radius: 5, startAngleDeg: 0, endAngleDeg: 90 },
      { x: -5, y: 0 },
    )!;
    expect(continued.radius).toBeCloseTo(5, 9);
    expect(continued.deltaDeg).toBeCloseTo(90, 9);
  });
});

describe('STRUCT-195.14 arc-primitive and curve-metric oracles', () => {
  const entityArc = { centerX: 0, centerY: 0, radius: 5, startAngleDeg: 0, endAngleDeg: 90 };

  it('pins arc start/end/midpoint, sweep membership, and end-tangent azimuth', () => {
    expect(arcPrimitives.cadArcStartPoint(entityArc)).toEqual({ x: 5, y: 0 });
    const end = arcPrimitives.cadArcEndPoint(entityArc);
    expect(end.x).toBeCloseTo(0, 9);
    expect(end.y).toBe(5);
    const mid = arcPrimitives.cadArcMidpoint({ x: 0, y: 0 }, 5, 0, 90);
    expect(mid.x).toBeCloseTo(3.5355339059327373, 12);
    expect(mid.y).toBeCloseTo(3.5355339059327373, 12);
    expect(arcPrimitives.cadIsAngleOnArcSweep(45, 0, 90)).toBe(true);
    expect(arcPrimitives.cadIsAngleOnArcSweep(180, 0, 90)).toBe(false);
    expect(arcPrimitives.cadIsAngleOnArcSweep(0, 0, 90)).toBe(true);
    expect(arcPrimitives.cadIsAngleOnArcSweep(90, 0, 90)).toBe(true);
    expect(arcPrimitives.cadArcEndTangentAzimuthDeg(entityArc)).toBe(270);
  });

  it('pins closest-point-on-arc, circle projection, and three-point construction', () => {
    const closest = arcPrimitives.cadClosestPointOnArc({ x: 10, y: 10 }, { x: 0, y: 0 }, 5, 0, 90);
    expect(closest.x).toBeCloseTo(3.5355339059327373, 12);
    expect(closest.y).toBeCloseTo(3.5355339059327373, 12);
    expect(arcPrimitives.cadProjectPointOntoCircle({ x: 10, y: 0 }, { x: 0, y: 0 }, 5))
      .toEqual({ x: 10, y: 0 });
    const three = arcPrimitives.cadBuildArcFromThreePoints({ x: 0, y: 0 }, { x: 5, y: -5 }, { x: 10, y: 0 })!;
    expect(three.center).toEqual({ x: 5, y: 0 });
    expect(three.radius).toBeCloseTo(5, 12);
    expect(three.deltaDeg).toBeCloseTo(180, 12);
    expect(arcPrimitives.cadBuildArcFromThreePoints({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 })).toBeNull();
  });

  it('pins counter-clockwise delta and all four metric constructors', () => {
    expect(curveCore.cadCounterClockwiseDeltaDeg(350, 10)).toBe(20);
    expect(curveCore.cadCounterClockwiseDeltaDeg(10, 350)).toBe(340);
    const metrics = curveCore.cadCreateCurveMetrics(10, 90)!;
    expect(metrics!.radius).toBe(10);
    expect(metrics.deltaDeg).toBe(90);
    expect(metrics.arcLength).toBeCloseTo(15.707963267948966, 12);
    expect(metrics.chordLength).toBeCloseTo(14.14213562373095, 12);
    expect(curveCore.cadBuildCurveMetricsFromRadiusDelta(10, 90)).toEqual(metrics);
    expect(curveCore.cadBuildCurveMetricsFromTangentLength(10, 10)).toEqual(metrics);
    expect(curveCore.cadBuildCurveMetricsFromArcLength(10, Math.PI)!.deltaDeg).toBeCloseTo(18, 12);
    expect(curveCore.cadBuildCurveMetricsFromChordLength(10, 10)!.deltaDeg).toBeCloseTo(60, 9);
    const centered = curveCore.cadBuildArcFromCenterAngles({ x: 0, y: 0 }, 5, 0, 90)!;
    expect(centered.radius).toBeCloseTo(5, 12);
    expect(centered.deltaDeg).toBeCloseTo(90, 12);
    const swept = curveCore.cadBuildArcFromCenterSweep({ x: 0, y: 0 }, 5, 0, 90)!;
    expect(swept).toEqual(centered);
  });
});

describe('STRUCT-195.14 intersection, tangent, and offset oracles', () => {
  it('intersects segments/circles/arcs deterministically with coincident/tangent handling', () => {
    expect(
      intersections.cadIntersectSegmentCircle({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 5),
    ).toEqual([{ x: -5, y: 0 }, { x: 5, y: 0 }]);
    expect(
      intersections.cadIntersectSegmentCircle({ x: -10, y: 5.0001 }, { x: 10, y: 5.0001 }, { x: 0, y: 0 }, 5),
    ).toEqual([]);
    expect(
      intersections.cadIntersectSegmentArc({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 5, 0, 360),
    ).toEqual([{ x: -5, y: 0 }, { x: 5, y: 0 }]);
    expect(
      intersections.cadIntersectInfiniteLineCircle({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 5),
    ).toEqual([{ x: -5, y: 0 }, { x: 5, y: 0 }]);
    expect(
      intersections.cadIntersectInfiniteLineArc({ x: -10, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, 5, 0, 90),
    ).toEqual([{ x: 5, y: 0 }]);
    expect(
      intersections.cadIntersectCircleCircle({ x: 0, y: 0 }, 5, { x: 8, y: 0 }, 5),
    ).toEqual([{ x: 4, y: 3 }, { x: 4, y: -3 }]);
    expect(
      intersections.cadIntersectCircleCircle({ x: 0, y: 0 }, 5, { x: 10, y: 0 }, 5),
    ).toEqual([{ x: 5, y: 0 }]);
    expect(intersections.cadIntersectCircleCircle({ x: 0, y: 0 }, 1, { x: 10, y: 0 }, 1)).toEqual([]);
    expect(intersections.cadIntersectCircleCircle({ x: 0, y: 0 }, 5, { x: 0, y: 0 }, 5)).toEqual([]);
    expect(
      intersections.cadIntersectArcArc({ x: 0, y: 0 }, 5, 0, 360, { x: 8, y: 0 }, 5, 0, 360),
    ).toEqual([{ x: 4, y: 3 }, { x: 4, y: -3 }]);
  });

  it('pins external tangent points, offsets, parallels, feet, and the tangent curve', () => {
    const tangents = intersections.cadTangentPointsFromExternalPointToCircle({ x: 10, y: 0 }, { x: 0, y: 0 }, 5);
    expect(tangents).toHaveLength(2);
    expect(tangents[0]!.x).toBeCloseTo(2.5, 12);
    expect(tangents[0]!.y).toBeCloseTo(4.330127018922194, 12);
    expect(tangents[1]!.y).toBeCloseTo(-4.330127018922194, 12);
    expect(
      intersections.cadTangentPointsFromExternalPointToCircle({ x: 5, y: 0 }, { x: 0, y: 0 }, 5),
    ).toEqual([{ x: 5, y: 0 }]);
    expect(
      intersections.cadTangentPointsFromExternalPointToCircle({ x: 1, y: 0 }, { x: 0, y: 0 }, 5),
    ).toEqual([]);
    expect(
      intersections.cadTangentPointsFromExternalPointToArc({ x: 10, y: 0 }, { x: 0, y: 0 }, 5, 0, 360),
    ).toHaveLength(2);
    expect(intersections.cadOffsetLineSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 2)).toEqual({
      start: { x: 0, y: 2 },
      end: { x: 10, y: 2 },
    });
    expect(intersections.cadOffsetLineSegment({ x: 2, y: 2 }, { x: 2, y: 2 }, 2)).toEqual({
      start: { x: 2, y: 2 },
      end: { x: 2, y: 2 },
    });
    expect(intersections.cadBuildParallelLine({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 })).toEqual({
      start: { x: 0, y: 5 },
      end: { x: 10, y: 5 },
    });
    expect(intersections.cadBuildPerpendicularFoot({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }))
      .toEqual({ x: 5, y: 0 });
    const fillet = tangentCurve.cadBuildTangentCurve({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 5)!;
    expect(fillet.radius).toBeCloseTo(5, 12);
    expect(fillet.deltaDeg).toBeCloseTo(90, 12);
    expect(tangentCurve.cadBuildTangentCurve({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, 5)).toBeNull();
    expect(
      tangentCurve.cadBuildTangentCurve({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 10 }, Number.NaN),
    ).toBeNull();
  });
});

describe('STRUCT-195.14 no in-place input mutation', () => {
  it('leaves primitive, builder, and intersection inputs byte-identical', () => {
    const from: CadWorldPoint = { x: 0, y: 0 };
    const to: CadWorldPoint = { x: 10, y: 0 };
    const arc: CadArcDefinition = {
      center: { x: 5, y: 0 },
      radius: 5,
      startAngleDeg: 180,
      endAngleDeg: 0,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 10, y: 0 },
      deltaDeg: 180,
    };
    const before = JSON.stringify({ from, to, arc });
    primitives.cadDistance(from, to);
    primitives.cadMidpoint(from, to);
    primitives.cadSegmentIntersection(from, to, { x: 5, y: -5 }, { x: 5, y: 5 });
    primitives.cadClosestPointOnSegment(from, from, to);
    primitives.cadProjectPointOntoInfiniteLine(from, from, to);
    builders.cadBuildArcFromStartCenterEnd(from, arc.center, to);
    arcPrimitives.cadClosestPointOnArc(from, arc.center, arc.radius, 0, 90);
    intersections.cadIntersectSegmentCircle(from, to, arc.center, arc.radius);
    intersections.cadOffsetLineSegment(from, to, 2);
    expect(JSON.stringify({ from, to, arc })).toBe(before);
  });
});
