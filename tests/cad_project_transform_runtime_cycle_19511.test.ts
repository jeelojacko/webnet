/**
 * STRUCT-195.11 — project-transform runtime + type cycle guard (Worker B).
 *
 * Pins the Worker A split of `cadProjectTransform.ts` into a narrow public
 * facade, a low-level kernel `cadProjectTransformCore.ts`, and the unchanged
 * request-level `cadProjectTransformRequest.ts`:
 *  - frozen baseline fixture verification: decodes the GENERATED 78a71ca4
 *    edge fixture (`BASELINE_NODES` + `BASELINE_EDGE_CHUNKS`), recomputes its
 *    counts/canonical value-pair hash, and spot-checks the pre-split
 *    Transform↔Request edges while confirming the kernel file did not exist;
 *  - SCC guard: no non-trivial VALUE or TYPE component contains the facade,
 *    kernel, or request module (the old project-transform pair cycle is gone);
 *  - legacy public API: all 17 historical symbols (9 runtime values + 8
 *    types) via the facade, 2+4 request symbols via the direct request module,
 *    and function identity across facade/core/request with no undefined export;
 *  - static fidelity: kernel imports neither facade nor request, request
 *    imports the kernel from core (never the facade), facade is exactly
 *    `export * from core` plus the 6 request re-exports;
 *  - graph delta allowlist vs the frozen fixture: every removed/added VALUE
 *    edge touches only the relocated trio and equals the planned relocation,
 *    with exactly one new node/edge and no new/expanded VALUE SCC;
 *  - behavior parity: Helmert + Grid/Ground determinism, dry-run/commit
 *    agreement, and malformed imported-TIN atomic blocking.
 *
 * No git-history access at runtime: the baseline is the committed fixture and
 * the current graph is rebuilt in-process via scripts/cadTypeImportGraph.mjs.
 * Agent tier: fast, deterministic, no Adjustment solve.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  BASELINE_EDGE_CHUNKS,
  BASELINE_EDGE_COUNT,
  BASELINE_NODE_COUNT,
  BASELINE_NODES,
  BASELINE_VALUE_EDGE_COUNT,
  BASELINE_VALUE_UNIQUE_PAIRS,
} from './cad_project_transform_runtime_delta_19511.guard';
import { buildGraphs, collectTypeScriptFiles, findCycles, tarjanSCC } from '../scripts/cadTypeImportGraph.mjs';

import * as facade from '../src/engine/cad/cadProjectTransform';
import * as core from '../src/engine/cad/cadProjectTransformCore';
import * as request from '../src/engine/cad/cadProjectTransformRequest';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { validateImportedTinPayload } from '../src/engine/cad/cadImportedTin';
import { rotationAbout, uniformScaleAbout } from '../src/engine/cad/cadTransform2D';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import type { CadEntity, CadProject, ImportedTinPayload } from '../src/engine/cad/cadTypes';
import type {
  ApplyCadProjectCoordinateTransformResult,
  ApplyCadProjectTransformResult,
  CadProjectTransformAffected,
  CadProjectTransformOptions,
  ProjectTransformAffectedCounts,
  ProjectTransformGridGroundDirection,
  ProjectTransformOutcome,
  ProjectTransformRequest,
} from '../src/engine/cad/cadProjectTransform';
import type {
  ApplyCadProjectTransformResult as DirectApplyCadProjectTransformResult,
  ProjectTransformGridGroundDirection as DirectProjectTransformGridGroundDirection,
  ProjectTransformOutcome as DirectProjectTransformOutcome,
  ProjectTransformRequest as DirectProjectTransformRequest,
} from '../src/engine/cad/cadProjectTransformRequest';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative);
const rel = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

const FACADE = 'src/engine/cad/cadProjectTransform.ts';
const KERNEL = 'src/engine/cad/cadProjectTransformCore.ts';
const REQUEST = 'src/engine/cad/cadProjectTransformRequest.ts';
const RELOCATED_TRIO = new Set([FACADE, KERNEL, REQUEST]);
const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish'];

/** 12 kernel dependency modules whose imports moved facade → core. */
const KERNEL_DEPS = [
  'cadAdjustmentDependency',
  'cadAnalysisLegends',
  'cadGeometry',
  'cadImportedTin',
  'cadProfileTypes',
  'cadProjectAuthoritativeBounds',
  'cadProjectTransformGrading',
  'cadSectionTypes',
  'cadSurfaceEditTransform',
  'cadSurfaceTypes',
  'cadTransformGeometry',
  'cadTypes',
];
const depPath = (name: string): string => `src/engine/cad/${name}.ts`;

// ---------------------------------------------------------------------------
// Frozen baseline fixture: decode + canonicalization.
// ---------------------------------------------------------------------------
type EdgeKind = 'value' | 'type' | 'mixed';
interface RelEdge {
  from: string;
  to: string;
  kind: EdgeKind;
}
const KIND_BY_CODE: Record<string, EdgeKind> = { v: 'value', t: 'type', m: 'mixed' };

const decodeBaselineEdges = (): { edges: RelEdge[]; outOfRange: number; invalidKind: number } => {
  const edges: RelEdge[] = [];
  let outOfRange = 0;
  let invalidKind = 0;
  for (const chunk of BASELINE_EDGE_CHUNKS) {
    for (const token of chunk.trim().split(/\s+/)) {
      if (!token) continue;
      const [fromRaw, toRaw, code] = token.split(',');
      const from = Number(fromRaw);
      const to = Number(toRaw);
      const inRange = Number.isInteger(from) && Number.isInteger(to)
        && from >= 0 && from < BASELINE_NODES.length && to >= 0 && to < BASELINE_NODES.length;
      if (!inRange) {
        outOfRange += 1;
        continue;
      }
      const kind = KIND_BY_CODE[code ?? ''];
      if (!kind) {
        invalidKind += 1;
        continue;
      }
      edges.push({ from: BASELINE_NODES[from]!, to: BASELINE_NODES[to]!, kind });
    }
  }
  return { edges, outOfRange, invalidKind };
};
const BASELINE_DECODED = decodeBaselineEdges();

const isValueEdge = (edge: RelEdge): boolean => edge.kind === 'value' || edge.kind === 'mixed';
const edgeKey = (edge: RelEdge): string => `${edge.kind}|${edge.from}|${edge.to}`;
const isValueEdgeKey = (key: string): boolean => key.startsWith('value|') || key.startsWith('mixed|');

const edgeMultiplicity = (edges: RelEdge[]): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const edge of edges) counts.set(edgeKey(edge), (counts.get(edgeKey(edge)) ?? 0) + 1);
  return counts;
};

/** Multiset (multiplicity + kind + source + target) delta of base → current. */
const multisetDelta = (base: RelEdge[], current: RelEdge[]): { removed: string[]; added: string[] } => {
  const from = edgeMultiplicity(base);
  const to = edgeMultiplicity(current);
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
const currentRelEdges = (): RelEdge[] =>
  currentGraph().edges.map((edge) => ({ from: rel(edge.from), to: rel(edge.to), kind: edge.kind }));
const kindsBetween = (graph: RelEdge[], from: string, to: string): string[] =>
  graph.filter((edge) => edge.from === from && edge.to === to).map((edge) => edge.kind);

const canonicalValuePairs = (edges: RelEdge[]): string[] =>
  [...new Set(edges.filter(isValueEdge).map((edge) => `${edge.from}\n${edge.to}`))].sort();

// ---------------------------------------------------------------------------
// Static source parsing (negative controls for the module boundary).
// ---------------------------------------------------------------------------
const parseSource = (file: string): ts.SourceFile =>
  ts.createSourceFile(abs(file), fs.readFileSync(abs(file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const importSpecifiers = (file: string): string[] =>
  parseSource(file).statements
    .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

const exportModuleSpecifiers = (file: string): string[] =>
  parseSource(file).statements
    .filter((stmt): stmt is ts.ExportDeclaration => ts.isExportDeclaration(stmt)
      && stmt.moduleSpecifier != null && ts.isStringLiteral(stmt.moduleSpecifier))
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
// Historical public surface.
// ---------------------------------------------------------------------------
const CORE_RUNTIME_VALUES = [
  'PROJECT_COORDINATE_TRANSFORM_TOOL_KEY',
  'PROJECT_TRANSFORM_MIXED_FRAME_MESSAGE',
  'PROJECT_TRANSFORM_LANDXML_WARNING',
  'PROJECT_TRANSFORM_IMPORTED_TIN_INVALID',
  'hasProjectCoordinateTransform',
  'projectTransformMixedFrameError',
  'applyCadProjectCoordinateTransform',
] as const;
const REQUEST_RUNTIME_VALUES = ['applyCadProjectTransform', 'projectTransformAffectedCounts'] as const;
/** 9 runtime values + 8 types = the 17 historical public symbols. */
const HISTORICAL_RUNTIME_VALUES = [...CORE_RUNTIME_VALUES, ...REQUEST_RUNTIME_VALUES];
const EXPECTED_REQUEST_REEXPORTS = [
  'ApplyCadProjectTransformResult',
  'ProjectTransformGridGroundDirection',
  'ProjectTransformOutcome',
  'ProjectTransformRequest',
  'applyCadProjectTransform',
  'projectTransformAffectedCounts',
];

// ---------------------------------------------------------------------------
// Behavior fixtures (mirrors the 18R/18R.1 suites).
// ---------------------------------------------------------------------------
const LAYER = 'L';
const FIXED_ISO = '2026-09-20T12:00:00.000Z';
const SURFACE_ID = 'surf-i';
const base = { layerId: LAYER, visible: true, locked: false } as const;

const projectWith = (entities: CadEntity[], extra?: Partial<CadProject>): CadProject => {
  const project = createBlankCadProject({ name: 'T19511', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.currentLayerId = LAYER;
  project.entities = entities;
  return { ...project, ...extra };
};

const point = (id: string, x: number, y: number): CadEntity => ({
  ...base, id, type: 'survey-point', stationId: id, x, y, z: 0, pointClass: 'free', source: 'parsed-input',
});

const malformedTin = (): ImportedTinPayload => ({
  vertices: [0, 0, 1, 10, 0],
  faces: [0, 1, 2, 0, 2, 3],
  provenance: { format: 'LandXML', fileName: 'i.xml', surfaceName: 'I' },
});

const projectWithTin = (payload: ImportedTinPayload): CadProject =>
  projectWith([point('pt1', 0, 0)], {
    surfaces: [{
      id: SURFACE_ID,
      name: 'I',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: payload,
      },
    }],
  });

const helmertRequest = (): ProjectTransformRequest => ({
  kind: 'HELMERT_2D',
  mode: 'SIMILARITY',
  pairs: [
    { sourceE: 0, sourceN: 0, targetE: 100, targetN: 50 },
    { sourceE: 100, sourceN: 0, targetE: 200, targetN: 50 },
  ],
});

const gridRequest = (): ProjectTransformRequest => ({
  kind: 'GRID_GROUND',
  originE: 0,
  originN: 0,
  combinedScaleFactor: 0.99995,
  direction: 'GRID_TO_GROUND',
});

// ===========================================================================
// 1. Frozen fixture verification.
// ===========================================================================
describe('STRUCT-195.11 frozen baseline fixture', () => {
  it('decodes to the declared node/edge/value counts with in-range indices', () => {
    expect(BASELINE_NODES).toHaveLength(BASELINE_NODE_COUNT);
    expect(BASELINE_DECODED.outOfRange).toBe(0);
    expect(BASELINE_DECODED.invalidKind).toBe(0);
    expect(BASELINE_DECODED.edges).toHaveLength(BASELINE_EDGE_COUNT);
    expect(BASELINE_DECODED.edges.filter(isValueEdge)).toHaveLength(BASELINE_VALUE_EDGE_COUNT);
    expect(canonicalValuePairs(BASELINE_DECODED.edges)).toHaveLength(BASELINE_VALUE_UNIQUE_PAIRS);
  });

  it('matches the canonical value-pair fingerprint relPosix(from)\\nrelPosix(to)', () => {
    const hash = createHash('sha256').update(JSON.stringify(canonicalValuePairs(BASELINE_DECODED.edges))).digest('hex');
    expect(hash).toBe('2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f');
  });

  it('contains the pre-split Transform<->Request edges and no kernel node', () => {
    const keys = new Set(BASELINE_DECODED.edges.map(edgeKey));
    expect(keys.has(`type|${FACADE}|${REQUEST}`)).toBe(true);
    expect(keys.has(`value|${FACADE}|${REQUEST}`)).toBe(true);
    expect(keys.has(`mixed|${REQUEST}|${FACADE}`)).toBe(true);
    expect(BASELINE_NODES).not.toContain(KERNEL);
    expect(BASELINE_NODES).toContain(FACADE);
    expect(BASELINE_NODES).toContain(REQUEST);
  });
});

// ===========================================================================
// 2. Graph SCC guard.
// ===========================================================================
describe('STRUCT-195.11 no project-transform SCC in VALUE or TYPE graphs', () => {
  const cyclicComponents = (nodes: string[], adjacency: Map<string, string[]>): string[][] =>
    tarjanSCC(nodes, adjacency).filter(
      (component) => component.length > 1 || (adjacency.get(component[0]!) ?? []).includes(component[0]!),
    );

  it('VALUE graph has no non-trivial component containing the relocated trio', () => {
    const graph = currentGraph();
    const offenders = cyclicComponents(graph.nodes, graph.value)
      .filter((component) => component.some((member) => RELOCATED_TRIO.has(rel(member))));
    expect(offenders, `project-transform VALUE SCC still present: ${offenders.flat().map(rel).join(', ')}`).toEqual([]);
  });

  it('TYPE graph has no non-trivial component containing the relocated trio', () => {
    const graph = currentGraph();
    const offenders = cyclicComponents(graph.nodes, graph.type)
      .filter((component) => component.some((member) => RELOCATED_TRIO.has(rel(member))));
    expect(offenders, `project-transform TYPE SCC still present: ${offenders.flat().map(rel).join(', ')}`).toEqual([]);
  });

  it('reports the expected SCC shape: VALUE 3 SCC / 16 nodes, TYPE 0', () => {
    const graph = currentGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect(valueCycles.cyclic.length, 'VALUE SCC count').toBe(3);
    expect(valueCycles.cyclicNodes.size, 'VALUE cyclic nodes').toBe(16);
    expect(valueCycles.largest.length, 'largest VALUE SCC').toBe(7);
    expect(typeCycles.cyclic.length, 'TYPE SCC count').toBe(0);
    expect(typeCycles.cyclicNodes.size, 'TYPE cyclic nodes').toBe(0);
  });
});

// ===========================================================================
// 3. Legacy public API pins.
// ===========================================================================
describe('STRUCT-195.11 legacy public API', () => {
  it('facade exposes exactly the 9 runtime values with no undefined export', () => {
    expect(Object.keys(facade).sort()).toEqual([...HISTORICAL_RUNTIME_VALUES].sort());
    for (const name of HISTORICAL_RUNTIME_VALUES) expect(facade[name], name).toBeDefined();
  });

  it('facade still exposes the 8 historical public types', () => {
    expectTypeOf<ApplyCadProjectTransformResult>().toEqualTypeOf<DirectApplyCadProjectTransformResult>();
    expectTypeOf<ProjectTransformAffectedCounts>().toEqualTypeOf<Pick<
      CadProjectTransformAffected,
      'entities' | 'surveyPoints' | 'alignments' | 'surfaces' | 'sampleLines' | 'tinVertices' | 'gradings' | 'gradingGroups'
    >>();
    expectTypeOf<ProjectTransformRequest['kind']>().toEqualTypeOf<'HELMERT_2D' | 'GRID_GROUND'>();
    expectTypeOf<ProjectTransformGridGroundDirection>().toEqualTypeOf<'GRID_TO_GROUND' | 'GROUND_TO_GRID'>();
    expectTypeOf<ProjectTransformOutcome['kind']>().toEqualTypeOf<'HELMERT_2D' | 'GRID_GROUND'>();
    expectTypeOf<ApplyCadProjectCoordinateTransformResult['ok']>().toEqualTypeOf<boolean>();
    expectTypeOf<CadProjectTransformOptions['transformId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<CadProjectTransformAffected['viewsMoved']>().toEqualTypeOf<number>();
  });

  it('keeps runtime identity across facade, core, and request', () => {
    for (const name of CORE_RUNTIME_VALUES) expect(facade[name], name).toBe(core[name]);
    expect(facade.applyCadProjectTransform).toBe(request.applyCadProjectTransform);
    expect(facade.projectTransformAffectedCounts).toBe(request.projectTransformAffectedCounts);
  });

  it('exposes the 2 request values + 4 request types via facade and direct module', () => {
    for (const name of REQUEST_RUNTIME_VALUES) expect(facade[name], name).toBe(request[name]);
    expectTypeOf<ApplyCadProjectTransformResult>().toEqualTypeOf<DirectApplyCadProjectTransformResult>();
    expectTypeOf<ProjectTransformGridGroundDirection>().toEqualTypeOf<DirectProjectTransformGridGroundDirection>();
    expectTypeOf<ProjectTransformOutcome>().toEqualTypeOf<DirectProjectTransformOutcome>();
    expectTypeOf<ProjectTransformRequest>().toEqualTypeOf<DirectProjectTransformRequest>();
  });
});

// ===========================================================================
// 4. Core fidelity + negative controls.
// ===========================================================================
describe('STRUCT-195.11 module boundary (static parse)', () => {
  it('kernel holds the implementation and imports neither facade nor request', () => {
    const source = fs.readFileSync(abs(KERNEL), 'utf8');
    for (const marker of [
      'export const applyCadProjectCoordinateTransform =',
      'export const hasProjectCoordinateTransform',
      'export const projectTransformMixedFrameError',
      'const preflightImportedTins',
      'const buildComputation',
    ]) {
      expect(source, marker).toContain(marker);
    }
    expect(importSpecifiers(KERNEL)).not.toContain('./cadProjectTransform');
    expect(importSpecifiers(KERNEL)).not.toContain('./cadProjectTransformRequest');
    expect(exportModuleSpecifiers(KERNEL)).not.toContain('./cadProjectTransform');
    expect(exportModuleSpecifiers(KERNEL)).not.toContain('./cadProjectTransformRequest');
  });

  it('request imports kernel symbols from core, never from the facade', () => {
    expect(importSpecifiers(REQUEST)).toContain('./cadProjectTransformCore');
    expect(importSpecifiers(REQUEST)).not.toContain('./cadProjectTransform');
    expect(namedImportBindings(REQUEST, './cadProjectTransformCore')).toContain('applyCadProjectCoordinateTransform');
    const source = fs.readFileSync(abs(REQUEST), 'utf8');
    expect(source).toContain('export const applyCadProjectTransform');
    expect(source).toContain('export const projectTransformAffectedCounts');
  });

  it('facade is export * from core plus exactly the 6 request re-exports', () => {
    const declarations = parseSource(FACADE).statements.filter(ts.isExportDeclaration);
    const star = declarations.find((stmt) => stmt.moduleSpecifier != null
      && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.moduleSpecifier.text === './cadProjectTransformCore');
    expect(star, 'export * from core').toBeDefined();
    expect(star!.exportClause, 'bare export *').toBeUndefined();
    expect(exportModuleSpecifiers(FACADE)).toContain('./cadProjectTransformCore');
    const requestNames = declarations
      .filter((stmt) => stmt.moduleSpecifier != null
        && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.moduleSpecifier.text === './cadProjectTransformRequest')
      .flatMap((stmt) => stmt.exportClause && ts.isNamedExports(stmt.exportClause)
        ? stmt.exportClause.elements.map((element) => element.name.text)
        : []);
    expect([...new Set(requestNames)].sort()).toEqual([...EXPECTED_REQUEST_REEXPORTS].sort());
  });
});

// ===========================================================================
// 5. Graph delta allowlist vs frozen fixture.
// ===========================================================================
describe('STRUCT-195.11 graph delta allowlist', () => {
  it('touches only the relocated trio on every removed/added VALUE edge', () => {
    const { removed, added } = multisetDelta(BASELINE_DECODED.edges, currentRelEdges());
    const movedValue = [...removed, ...added].filter(isValueEdgeKey);
    expect(movedValue.length).toBeGreaterThan(0);
    for (const key of movedValue) {
      const [, from, to] = key.split('|');
      expect(RELOCATED_TRIO.has(from!) || RELOCATED_TRIO.has(to!), `${key} escapes the trio`).toBe(true);
    }
  });

  it('removes exactly the facade kernel imports and the request->facade edge', () => {
    const removedValue = multisetDelta(BASELINE_DECODED.edges, currentRelEdges()).removed.filter(isValueEdgeKey).sort();
    const expected = [
      ...KERNEL_DEPS.map((name) => `value|${FACADE}|${depPath(name)}`),
      `mixed|${FACADE}|${depPath('cadTransform2D')}`,
      `mixed|${REQUEST}|${FACADE}`,
    ].sort();
    expect(removedValue).toEqual(expected);
  });

  it('adds exactly the core kernel imports, facade->core, and request->core edges', () => {
    const addedValue = multisetDelta(BASELINE_DECODED.edges, currentRelEdges()).added.filter(isValueEdgeKey).sort();
    const expected = [
      `value|${FACADE}|${KERNEL}`,
      ...KERNEL_DEPS.map((name) => `value|${KERNEL}|${depPath(name)}`),
      `mixed|${KERNEL}|${depPath('cadTransform2D')}`,
      `mixed|${REQUEST}|${KERNEL}`,
    ].sort();
    expect(addedValue).toEqual(expected);
  });

  it('relocates the facade type imports to core and keeps facade->request intact', () => {
    const current = currentRelEdges();
    const keys = new Set(current.map(edgeKey));
    expect(keys.has(`type|${FACADE}|${REQUEST}`)).toBe(true);
    expect(keys.has(`value|${FACADE}|${REQUEST}`)).toBe(true);
    expect(kindsBetween(current, REQUEST, FACADE)).toEqual([]);
    for (const name of KERNEL_DEPS) {
      expect(kindsBetween(current, FACADE, depPath(name)), `facade still imports ${name}`).toEqual([]);
      expect(kindsBetween(current, KERNEL, depPath(name)), `core missing ${name}`).not.toEqual([]);
    }
  });

  it('adds exactly one node/edge and forms no new or expanded VALUE SCC', () => {
    const graph = currentGraph();
    expect(graph.nodes.length).toBe(BASELINE_NODE_COUNT + 1);
    expect(graph.edges.length).toBe(BASELINE_EDGE_COUNT + 1);
    const valueCycles = findCycles(graph.nodes, graph.value);
    expect(valueCycles.cyclic.length).toBe(3);
    expect(valueCycles.cyclicNodes.size).toBe(16);
  });
});

// ===========================================================================
// 6. Behavior parity.
// ===========================================================================
describe('STRUCT-195.11 behavior parity', () => {
  it('Helmert: same project + request yields the same transformId, floats, and entities', () => {
    const project = projectWith([point('pt1', 10, 20), point('pt2', 100, 200)]);
    const first = request.applyCadProjectTransform(project, helmertRequest());
    const second = request.applyCadProjectTransform(project, helmertRequest());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('expected Helmert solve');
    expect(first.project.cogoComputations![0]!.id).toBe(second.project.cogoComputations![0]!.id);
    expect(first.outcome).toEqual(second.outcome);
    expect(first.project.entities).toEqual(second.project.entities);
    expect(first.project.bounds).toEqual(second.project.bounds);
  });

  it('Grid/Ground: same project + request yields the same floats and entities', () => {
    const project = projectWith([point('pt1', 500_100, 100_050)]);
    const first = request.applyCadProjectTransform(project, gridRequest());
    const second = request.applyCadProjectTransform(project, gridRequest());
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('expected Grid/Ground solve');
    expect(first.outcome).toEqual(second.outcome);
    expect(first.project.entities).toEqual(second.project.entities);
    expect(first.project.cogoComputations![0]!.id).toBe(second.project.cogoComputations![0]!.id);
  });

  it('kernel audit metadata is deterministic for a fixed transformId and timestamp', () => {
    const project = projectWith([point('pt1', 10, 20)]);
    const options = { transformId: 't-parity', createdAtIso: FIXED_ISO } as const;
    const first = core.applyCadProjectCoordinateTransform(project, rotationAbout(0, 0, 30), options);
    const second = core.applyCadProjectCoordinateTransform(project, rotationAbout(0, 0, 30), options);
    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('expected kernel transform');
    expect(first.computation.provenance.inputs).toMatchObject({ transformId: 't-parity', mode: 'SIMILARITY_RIGID' });
    expect(first.computation.createdAtIso).toBe(FIXED_ISO);
  });

  it('dry-run and committed command agree for Helmert and Grid/Ground', () => {
    for (const makeRequest of [helmertRequest, gridRequest]) {
      const project = projectWith([point('pt1', 10, 20), point('pt2', 100, 200)]);
      const shape = makeRequest();
      const dry = request.applyCadProjectTransform(project, shape);
      expect(dry.ok).toBe(true);
      if (!dry.ok) throw new Error('dry-run failed');
      const committed = runCadCommand(createCadHistoryState(project, []), { key: 'PROJECTTRANSFORM', request: shape });
      const committedProject = committed.present.project;
      expect(committedProject.entities).toEqual(dry.project.entities);
      expect(committedProject.surfaces).toEqual(dry.project.surfaces);
      expect(committedProject.cogoComputations![0]!.id).toBe(dry.project.cogoComputations![0]!.id);
    }
  });

  it('malformed imported-TIN blocks atomically with an identical reason and zero mutation', () => {
    const payload = malformedTin();
    const required = validateImportedTinPayload(payload);
    expect(required).not.toBeNull();
    const project = projectWithTin(payload);
    const projectBefore = JSON.stringify(project);
    const countsBefore = request.projectTransformAffectedCounts(project);
    const kernel = core.applyCadProjectCoordinateTransform(project, uniformScaleAbout(0, 0, 2), { createdAtIso: FIXED_ISO });
    const solved = request.applyCadProjectTransform(project, helmertRequest());
    expect(kernel.ok).toBe(false);
    expect(solved.ok).toBe(false);
    if (kernel.ok || solved.ok) throw new Error('expected block');
    expect(solved.reason).toBe(kernel.reason);
    expect(kernel.reason.startsWith(`${core.PROJECT_TRANSFORM_IMPORTED_TIN_INVALID}:${SURFACE_ID}: `)).toBe(true);
    expect(kernel.reason).toContain(required!);
    expect(JSON.stringify(project)).toBe(projectBefore);
    expect(request.projectTransformAffectedCounts(project)).toEqual(countsBefore);
    expect(project.cogoComputations).toHaveLength(0);
  });
});
