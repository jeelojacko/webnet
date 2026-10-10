/**
 * STRUCT-195.10 — surface-revision reason/source-point + profile-sample type leaves.
 *
 * Pins `src/engine/cad/cadSurfaceSourceTypes.ts` (11-member
 * CadSurfaceReasonCode union + CadSurfaceSourcePoint, one `import type`
 * from cadCorePrimitiveTypes) and
 * `src/engine/cad/profiles/profileSampleTypes.ts` (ProfileSampleEventKind
 * + ProfileSample + ProfileExtractionMesh, two `import type` statements),
 * plus the consumer repoints (cadSurfaceRevision, profileSampling) and hub
 * re-exports (cadSurfaces, profileExtraction):
 *  - independent baseline-shape hand pins: `BaseReasonCode` (11 literals
 *    hand-transcribed from the BASELINE source at 0da0708e via
 *    `git show 0da0708e:src/engine/cad/cadSurfaces.ts`) and
 *    `BaseSourcePoint` / `BaseEventKind` / `BaseSample` / `BaseMesh`
 *    (hand-transcribed from BASELINE cadSurfaces.ts and
 *    profileExtraction.ts; TinAdjacency/TinEdgeKinds imported from their
 *    canonical tinTypes home, never from a leaf). They import NO leaf
 *    type, so leaf drift cannot move both sides of an assertion. Every
 *    `Base*` is compared against BOTH the old-path export and the
 *    new-leaf export via bidirectional `expectTypeOf` equality
 *    (typecheck-enforced);
 *  - complete AST shape checks: exact union literal order (both unions),
 *    exact interface prop shapes incl. `?` and `| null` markers (source
 *    point, sample, mesh), and the tuple/array spellings
 *    (`Array<[...]>`, `TinAdjacency[]`) — all whitespace-normalized, so a
 *    missing `?`, dropped literal, or widened tuple fails `vitest` even
 *    without a typecheck gate;
 *  - compatibility pins: CadSurfaceBuildResult / CollectedSources /
 *    ProfileSegment / CadSurfaceProfileResult / ExtractSurfaceProfileInput
 *    still reference the moved types field-by-field (no weaker casts);
 *  - legacy-path checks: old-path CadSurfaceReasonCode /
 *    CadSurfaceSourcePoint still exported from cadSurfaces; old-path
 *    ProfileSampleEventKind / ProfileSample / ProfileExtractionMesh still
 *    exported from profileExtraction;
 *  - leaf purity: both leaves contain ONLY `import type` statements (zero
 *    value imports) and no runtime value exports (AST scan);
 *  - graph guard: both exact 2-node TYPE components dissolve into
 *    singletons (TYPE 3 SCC/6 nodes -> 1 SCC/2 nodes: only the untouched
 *    projectTransform pair remains), and the VALUE edge membership is
 *    byte-identical vs baseline (pinned fingerprint, not just counts).
 *
 * This suite covers the INTEGRATED end state: it reads the actual leaves +
 * hubs + consumers from disk and fails with a clear blocked-status message
 * when a leaf has not landed yet.
 *
 * Uses only the TypeScript compiler API + the repo graph script (no new deps).
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  buildGraphs,
  collectTypeScriptFiles,
  tarjanSCC,
} from '../scripts/cadTypeImportGraph.mjs';

import type {
  CadSurfaceBuildResult,
  CadSurfaceReasonCode as OldReasonCode,
  CadSurfaceSourcePoint as OldSourcePoint,
} from '../src/engine/cad/cadSurfaces';
import type {
  CadSurfaceReasonCode as LeafReasonCode,
  CadSurfaceSourcePoint as LeafSourcePoint,
} from '../src/engine/cad/cadSurfaceSourceTypes';
import type { CollectedSources } from '../src/engine/cad/cadSurfaceRevision';
import type {
  CadSurfaceProfileResult,
  ExtractSurfaceProfileInput,
  ProfileExtractionMesh as OldMesh,
  ProfileSample as OldSample,
  ProfileSampleEventKind as OldEventKind,
  ProfileSegment,
} from '../src/engine/cad/profiles/profileExtraction';
import type {
  ProfileExtractionMesh as LeafMesh,
  ProfileSample as LeafSample,
  ProfileSampleEventKind as LeafEventKind,
} from '../src/engine/cad/profiles/profileSampleTypes';
import type { TinAdjacency, TinEdgeKinds } from '../src/engine/cad/tin/tinTypes';

/**
 * CI-shallow-checkout-safe baseline fingerprint (STRUCT-195.7/195.8/195.9
 * pattern, reused for 195.10).
 *
 * The committed test must NOT call loadSourcesFromGit(BASELINE_REF): CI
 * checks out shallow history without the baseline commit, so `git ls-tree
 * <sha>` fails with exit 128. Instead the baseline VALUE graph is pinned
 * here as immutable constants. Reuse of the 195.9 pin is valid because the
 * canonicalization is identical (scope GRAPH_DIRS, edge kinds value|mixed
 * with mixed counting toward both tallies, pair strings
 * `<relPosix(from)>\n<relPosix(to)>` deterministically sorted with
 * duplicates collapsed, sha256 over JSON.stringify(pairs)) AND the pin was
 * re-measured empirically on the CURRENT 195.10 tree (480 nodes /
 * 2392 edges; 1561 unique VALUE pairs / 1579 value|mixed edges with SHA256
 * 2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f —
 * identical to the 195.9 baseline at origin/main 658f4c7e, since the
 * refactor moves only type-only bindings; see
 * docs/evidence/struct-19510/validation.md). The refactor moves only
 * type-only bindings, so VALUE membership is untouched by construction.
 *
 * STRUCT-195.11 roll-forward (FIRST authorized runtime value-graph change
 * after the type-only 195.7-195.10 series): the project-transform kernel
 * split (new src/engine/cad/cadProjectTransformCore.ts; facade + request
 * repoint to core) removes 14 value edges and adds 15, every one incident
 * to {cadProjectTransform, cadProjectTransformCore,
 * cadProjectTransformRequest} — nodes 480->481, value|mixed 1579->1580,
 * unique pairs 1561->1562, SHA 2bf1817d…->3d7284db…. The pre-split golden
 * (1561/1579/2bf1817d…) survives frozen in
 * tests/cad_project_transform_runtime_delta_19511.guard.ts and the complete
 * removal/addition allowlist is proved in
 * tests/cad_project_transform_runtime_cycle_19511.test.ts. This guard keeps
 * all 195.10 payload/type/purity/singleton assertions intact and only rolls
 * the global golden forward; any further pair/edge/SHA change still fails.
 *
 * STRUCT-195.12 roll-forward (SECOND authorized runtime value-graph change):
 * the parcel-diagnostics cycle break (new
 * src/engine/cad/cadCogoParcelLineworkTopology.ts owning
 * buildParcelLineCandidate/buildParcelNodeMap; SourceDraft + Linework import
 * helpers from topology; Diagnostics imports summaries/overlap/primitives/
 * types leaves directly, dropping the broad facade edge) removes 4 value
 * edges and adds 11, every one incident to {cadCogoParcelDiagnostics,
 * cadCogoParcelGeometry, cadCogoParcelGeometrySourceDraft,
 * cadCogoParcelLineworkDiagnostics, cadCogoParcelLineworkTopology} — nodes
 * 481->482, value|mixed 1580->1584, unique pairs 1562->1566, SHA
 * 3d7284db…->0feb1dc8…. The 195.11 golden (1562/1580/3d7284db…) survives in
 * git history at c132c428 and the complete removal/addition allowlist is
 * proved in tests/cad_cogo_parcel_runtime_cycle_19512.test.ts. This guard
 * keeps all 195.10 payload/type/purity/singleton assertions intact and only
 * rolls the global golden forward; any further pair/edge/SHA change fails.
 *
 * STRUCT-195.13 roll-forward (2026-10-10, THIRD authorized runtime value-graph
 * change): cadParcelArcGeometry.ts repoints { buildCadInverseSummary,
 * formatCadBearing } from './cadCogoMath' to './cadCogoSummaries', removing
 * exactly one VALUE edge
 * (src/engine/cad/cadParcelArcGeometry.ts -> src/engine/cad/cadCogoMath.ts)
 * and adding exactly one (src/engine/cad/cadParcelArcGeometry.ts ->
 * src/engine/cad/cadCogoSummaries.ts). Node/edge/pair totals are unchanged
 * (482 / 1584 / 1566), but the VALUE SCC tally drops 2 SCC / 12 nodes ->
 * 1 SCC / 7 nodes as the 5-node cogo-arc cycle dissolves; SHA
 * 0feb1dc8…->76838237…. The 195.12 golden (1566/1584/0feb1dc8…) survives in
 * git history and the complete removal/addition allowlist is proved in
 * tests/cad_project_transform_runtime_cycle_19511.test.ts. This guard keeps
 * all 195.10 payload/type/purity/singleton assertions intact and only rolls
 * the global golden forward; any further pair/edge/SHA change fails.
 */
const EXPECTED_BASELINE_VALUE_PAIR_COUNT = 1566;
const EXPECTED_BASELINE_VALUE_EDGE_COUNT = 1584;
const EXPECTED_BASELINE_VALUE_PAIRS_SHA256 =
  '76838237ec49987ae9c64b11b97a3d72537b2fda2b806b1bcf73a4a22e1300f0';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative);
const rel = (absolute: string): string => path.relative(REPO_ROOT, absolute);

const LEAF_A = 'src/engine/cad/cadSurfaceSourceTypes.ts';
const HUB_A = 'src/engine/cad/cadSurfaces.ts';
const CONSUMER_A = 'src/engine/cad/cadSurfaceRevision.ts';
const LEAF_B = 'src/engine/cad/profiles/profileSampleTypes.ts';
const HUB_B = 'src/engine/cad/profiles/profileExtraction.ts';
const CONSUMER_B = 'src/engine/cad/profiles/profileSampling.ts';
const PAIR_A = [HUB_A, CONSUMER_A];
const PAIR_B = [HUB_B, CONSUMER_B];
const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish'];

/** Throw a clear blocked-status error when a Worker leaf has not landed yet. */
const requireSource = (file: string, label: string): string => {
  const absolute = abs(file);
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `STRUCT-195.10 blocked: ${label} not present yet at ${file} `
      + '(owned by the leaf Worker; suite covers the integrated end state once it lands)',
    );
  }
  return fs.readFileSync(absolute, 'utf8');
};

const parseSource = (source: string, fileName: string): ts.SourceFile =>
  ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const parseKnown = (file: string, label: string): ts.SourceFile =>
  parseSource(requireSource(file, label), abs(file));

/** Collapse all whitespace so formatting drift cannot mask (or fake) type drift. */
const norm = (text: string): string => text.replace(/\s+/g, '');

const propShape = (member: ts.PropertySignature): string =>
  norm(`${member.name.getText()}${member.questionToken ? '?' : ''}: ${member.type?.getText() ?? 'never'}`);

/**
 * Whitespace-normalized `name[?]: type` strings of an interface in
 * declaration order. Returns null when absent.
 */
const interfacePropShapes = (source: ts.SourceFile, typeName: string): string[] | null => {
  const decl = source.statements.find(
    (stmt): stmt is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName,
  );
  if (!decl) return null;
  return [...decl.members]
    .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
    .map(propShape);
};

/**
 * Whitespace-normalized member texts of a union type alias, in order.
 * Returns null when the alias is absent or not a union.
 */
const unionMemberShapes = (source: ts.SourceFile, aliasName: string): string[] | null => {
  const decl = source.statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === aliasName,
  );
  if (!decl || !ts.isUnionTypeNode(decl.type)) return null;
  return decl.type.types.map((member) => norm(member.getText()));
};

/** `import ...` statement texts (any kind) found in a source string. */
const importStatements = (source: string, fileName: string): string[] =>
  parseSource(source, fileName).statements
    .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt))
    .map((stmt) => norm(stmt.getText()));

/**
 * Non-type-only `import` statements (value imports, mixed clauses, and
 * side-effect-only imports). Empty = the leaf imports types only.
 */
const nonTypeOnlyImports = (source: string, fileName: string): string[] =>
  parseSource(source, fileName).statements
    .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt))
    .filter((stmt) => stmt.importClause == null || !stmt.importClause.isTypeOnly)
    .map((stmt) => norm(stmt.getText()));

/**
 * Runtime value-export problems in a source string: non-type-only export
 * declarations plus value declarations (function/var/class/enum). Empty =
 * type-only surface.
 */
const valueExportProblems = (source: string, fileName: string): string[] => {
  const problems: string[] = [];
  for (const stmt of parseSource(source, fileName).statements) {
    if (ts.isExportDeclaration(stmt)) {
      if (!stmt.isTypeOnly) problems.push(`non-type export: ${norm(stmt.getText()).slice(0, 80)}`);
      continue;
    }
    if (
      ts.isFunctionDeclaration(stmt)
      || ts.isVariableStatement(stmt)
      || ts.isClassDeclaration(stmt)
      || ts.isEnumDeclaration(stmt)
    ) {
      problems.push(`value declaration: ${ts.SyntaxKind[stmt.kind]}`);
    }
  }
  return problems;
};

// ---------------------------------------------------------------------------
// Independent baseline pins (STRUCT-195.10).
//
// Hand-transcribed from the pre-refactor baseline at
// 0da0708e9b26b72d49cdf87d7954b79d9a76c79a
// (`git show 0da0708e:src/engine/cad/cadSurfaces.ts` and
// `git show 0da0708e:src/engine/cad/profiles/profileExtraction.ts`).
// They import no leaf type (TinAdjacency/TinEdgeKinds come from their
// canonical tinTypes home), so leaf drift cannot move both sides of an
// assertion.
// ---------------------------------------------------------------------------

type BaseReasonCode =
  | 'SURFACE_TOO_FEW_POINTS'
  | 'SURFACE_COLLINEAR_POINTS'
  | 'SURFACE_POINT_MISSING_Z'
  | 'SURFACE_DUPLICATE_XY_CONFLICT'
  | 'SURFACE_BREAKLINE_INVALID'
  | 'SURFACE_BREAKLINE_MISSING_Z'
  | 'SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX'
  | 'SURFACE_BOUNDARY_INVALID'
  | 'SURFACE_VOID_INVALID'
  | 'SURFACE_REFERENCE_MISSING'
  | 'SURFACE_TRIANGULATION_FAILED';

interface BaseSourcePoint {
  entityId: string;
  x: number;
  y: number;
  z: number;
}

type BaseEventKind =
  | 'edge-crossing'
  | 'vertex'
  | 'boundary-entry'
  | 'boundary-exit'
  | 'void-entry'
  | 'void-exit'
  | 'plane-break';

interface BaseSample {
  rawChainage: number;
  displayStation: number | null;
  x: number;
  y: number;
  elevation: number;
  alignmentElementIndex?: number;
  surfaceTriangleIndex?: number;
  eventKind?: BaseEventKind;
}

interface BaseGrid {
  minX: number;
  minY: number;
  cellSize: number;
  cells: Map<string, number[]>;
}

interface BaseMesh {
  points: Array<{ x: number; y: number; z: number }>;
  triangles: Array<[number, number, number]>;
  grid: BaseGrid;
  adjacency?: TinAdjacency[];
  edgeKinds?: TinEdgeKinds[];
}

/** Exact reason-code union member pins, in declaration order. */
const EXPECTED_REASON_MEMBERS = [
  "'SURFACE_TOO_FEW_POINTS'",
  "'SURFACE_COLLINEAR_POINTS'",
  "'SURFACE_POINT_MISSING_Z'",
  "'SURFACE_DUPLICATE_XY_CONFLICT'",
  "'SURFACE_BREAKLINE_INVALID'",
  "'SURFACE_BREAKLINE_MISSING_Z'",
  "'SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX'",
  "'SURFACE_BOUNDARY_INVALID'",
  "'SURFACE_VOID_INVALID'",
  "'SURFACE_REFERENCE_MISSING'",
  "'SURFACE_TRIANGULATION_FAILED'",
];

/** Exact CadSurfaceSourcePoint property pins (`?`-free: all required). */
const EXPECTED_SOURCE_POINT_PROPS = ['entityId:CadEntityId', 'x:number', 'y:number', 'z:number'];

/** Exact ProfileSampleEventKind member pins, in declaration order. */
const EXPECTED_EVENT_MEMBERS = [
  "'edge-crossing'",
  "'vertex'",
  "'boundary-entry'",
  "'boundary-exit'",
  "'void-entry'",
  "'void-exit'",
  "'plane-break'",
];

/** Exact ProfileSample property pins (`?` and `| null` significant). */
const EXPECTED_SAMPLE_PROPS = [
  'rawChainage:number',
  'displayStation:number|null',
  'x:number',
  'y:number',
  'elevation:number',
  'alignmentElementIndex?:number',
  'surfaceTriangleIndex?:number',
  'eventKind?:ProfileSampleEventKind',
];

/** Exact ProfileExtractionMesh property pins (tuple/array/optional precision). */
const EXPECTED_MESH_PROPS = [
  'points:Array<{x:number;y:number;z:number}>',
  'triangles:Array<[number,number,number]>',
  'grid:CadSurfaceGrid',
  'adjacency?:TinAdjacency[]',
  'edgeKinds?:TinEdgeKinds[]',
];

/** Leaf A imports exactly one type-only binding (the entity-id alias). */
const EXPECTED_LEAF_A_IMPORTS = [
  "importtype{CadEntityId}from'./cadCorePrimitiveTypes';",
];

/** Leaf B imports exactly two type-only bindings (grid + tin shapes). */
const EXPECTED_LEAF_B_IMPORTS = [
  "importtype{CadSurfaceGrid}from'../cadSurfaces';",
  "importtype{TinAdjacency,TinEdgeKinds}from'../tin/tinTypes';",
];

/** Sample probes: one value per reason literal + event literal + key shapes. */
const reasonSamples: LeafReasonCode[] = [...EXPECTED_REASON_MEMBERS.map(
  (literal) => literal.slice(1, -1) as LeafReasonCode,
)];
const eventSamples: LeafEventKind[] = [...EXPECTED_EVENT_MEMBERS.map(
  (literal) => literal.slice(1, -1) as LeafEventKind,
)];
const sourcePointSample: LeafSourcePoint = { entityId: 'pt-1', x: 1.5, y: -2.5, z: 10 };
const sampleSample: LeafSample = {
  rawChainage: 12.5,
  displayStation: null,
  x: 1,
  y: 2,
  elevation: 3,
  eventKind: 'vertex',
};
const meshSample: LeafMesh = {
  points: [{ x: 0, y: 0, z: 0 }],
  triangles: [[0, 0, 0]],
  grid: { minX: 0, minY: 0, cellSize: 1, cells: new Map() },
};

// ---------------------------------------------------------------------------

describe('STRUCT-195.10 leaf presence (Worker handoff)', () => {
  it('both leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(abs(LEAF_A)), `leaf missing: ${LEAF_A}`).toBe(true);
    expect(fs.existsSync(abs(LEAF_B)), `leaf missing: ${LEAF_B}`).toBe(true);
  });

  it('the source leaf declares exactly CadSurfaceReasonCode + CadSurfaceSourcePoint', () => {
    const source = parseKnown(LEAF_A, 'source leaf');
    const names = source.statements
      .filter((stmt): stmt is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
        (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt))
        && (stmt.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false))
      .map((stmt) => stmt.name.text);
    expect(names).toEqual(['CadSurfaceReasonCode', 'CadSurfaceSourcePoint']);
  });

  it('the profile leaf declares exactly ProfileSampleEventKind + ProfileSample + ProfileExtractionMesh', () => {
    const source = parseKnown(LEAF_B, 'profile leaf');
    const names = source.statements
      .filter((stmt): stmt is ts.TypeAliasDeclaration | ts.InterfaceDeclaration =>
        (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt))
        && (stmt.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false))
      .map((stmt) => stmt.name.text);
    expect(names).toEqual(['ProfileSampleEventKind', 'ProfileSample', 'ProfileExtractionMesh']);
  });
});

describe('STRUCT-195.10 independent baseline pins: reason code + source point', () => {
  it('matches the pre-refactor shape on the old path and the leaf (both directions)', () => {
    expectTypeOf<OldReasonCode>().toEqualTypeOf<BaseReasonCode>();
    expectTypeOf<BaseReasonCode>().toEqualTypeOf<OldReasonCode>();
    expectTypeOf<LeafReasonCode>().toEqualTypeOf<BaseReasonCode>();
    expectTypeOf<BaseReasonCode>().toEqualTypeOf<LeafReasonCode>();
    expectTypeOf<OldSourcePoint>().toEqualTypeOf<BaseSourcePoint>();
    expectTypeOf<BaseSourcePoint>().toEqualTypeOf<OldSourcePoint>();
    expectTypeOf<LeafSourcePoint>().toEqualTypeOf<BaseSourcePoint>();
    expectTypeOf<BaseSourcePoint>().toEqualTypeOf<LeafSourcePoint>();
  });

  it('keeps the old path and the leaf identical (both directions)', () => {
    expectTypeOf<OldReasonCode>().toEqualTypeOf<LeafReasonCode>();
    expectTypeOf<LeafReasonCode>().toEqualTypeOf<OldReasonCode>();
    expectTypeOf<OldSourcePoint>().toEqualTypeOf<LeafSourcePoint>();
    expectTypeOf<LeafSourcePoint>().toEqualTypeOf<OldSourcePoint>();
  });

  it('pins the exact 11 literals in declaration order', () => {
    const leaf = parseKnown(LEAF_A, 'source leaf');
    const actual = unionMemberShapes(leaf, 'CadSurfaceReasonCode');
    expect(actual, 'CadSurfaceReasonCode missing from leaf').not.toBeNull();
    expect(actual, 'reason literal drift').toEqual(EXPECTED_REASON_MEMBERS.map(norm));
    expect(actual, 'reason member count drift').toHaveLength(11);
  });

  it('pins the exact CadSurfaceSourcePoint props (all required, entity id first)', () => {
    const leaf = parseKnown(LEAF_A, 'source leaf');
    expect(interfacePropShapes(leaf, 'CadSurfaceSourcePoint'), 'CadSurfaceSourcePoint missing from leaf')
      .toEqual(EXPECTED_SOURCE_POINT_PROPS.map(norm));
  });

  it('compiles one sample per literal plus a source-point probe', () => {
    expect(reasonSamples).toHaveLength(11);
    expect(new Set<string>(reasonSamples).size).toBe(11);
    expect([sourcePointSample.entityId, sourcePointSample.x, sourcePointSample.z]).toEqual(['pt-1', 1.5, 10]);
  });

  it('Extract narrowing still discriminates single literals', () => {
    expectTypeOf<Extract<LeafReasonCode, 'SURFACE_TRIANGULATION_FAILED'>>()
      .toEqualTypeOf<'SURFACE_TRIANGULATION_FAILED'>();
    expectTypeOf<Extract<LeafReasonCode, 'SURFACE_POINT_MISSING_Z'>>()
      .toEqualTypeOf<'SURFACE_POINT_MISSING_Z'>();
  });
});

describe('STRUCT-195.10 independent baseline pins: profile sample types', () => {
  it('matches the pre-refactor shapes on the old path and the leaf (both directions)', () => {
    expectTypeOf<OldEventKind>().toEqualTypeOf<BaseEventKind>();
    expectTypeOf<BaseEventKind>().toEqualTypeOf<OldEventKind>();
    expectTypeOf<LeafEventKind>().toEqualTypeOf<BaseEventKind>();
    expectTypeOf<BaseEventKind>().toEqualTypeOf<LeafEventKind>();
    expectTypeOf<OldSample>().toEqualTypeOf<BaseSample>();
    expectTypeOf<BaseSample>().toEqualTypeOf<OldSample>();
    expectTypeOf<LeafSample>().toEqualTypeOf<BaseSample>();
    expectTypeOf<BaseSample>().toEqualTypeOf<LeafSample>();
    expectTypeOf<OldMesh>().toEqualTypeOf<BaseMesh>();
    expectTypeOf<BaseMesh>().toEqualTypeOf<OldMesh>();
    expectTypeOf<LeafMesh>().toEqualTypeOf<BaseMesh>();
    expectTypeOf<BaseMesh>().toEqualTypeOf<LeafMesh>();
  });

  it('keeps the old path and the leaf identical (both directions)', () => {
    expectTypeOf<OldEventKind>().toEqualTypeOf<LeafEventKind>();
    expectTypeOf<LeafEventKind>().toEqualTypeOf<OldEventKind>();
    expectTypeOf<OldSample>().toEqualTypeOf<LeafSample>();
    expectTypeOf<LeafSample>().toEqualTypeOf<OldSample>();
    expectTypeOf<OldMesh>().toEqualTypeOf<LeafMesh>();
    expectTypeOf<LeafMesh>().toEqualTypeOf<OldMesh>();
  });

  it('pins the exact 7 event literals in declaration order', () => {
    const leaf = parseKnown(LEAF_B, 'profile leaf');
    const actual = unionMemberShapes(leaf, 'ProfileSampleEventKind');
    expect(actual, 'ProfileSampleEventKind missing from leaf').not.toBeNull();
    expect(actual, 'event literal drift').toEqual(EXPECTED_EVENT_MEMBERS.map(norm));
    expect(actual, 'event member count drift').toHaveLength(7);
  });

  it('pins the exact ProfileSample props incl. optional markers + `| null` station', () => {
    const leaf = parseKnown(LEAF_B, 'profile leaf');
    expect(interfacePropShapes(leaf, 'ProfileSample'), 'ProfileSample missing from leaf')
      .toEqual(EXPECTED_SAMPLE_PROPS.map(norm));
  });

  it('pins the exact ProfileExtractionMesh props incl. tuple/array/optional precision', () => {
    const leaf = parseKnown(LEAF_B, 'profile leaf');
    expect(interfacePropShapes(leaf, 'ProfileExtractionMesh'), 'ProfileExtractionMesh missing from leaf')
      .toEqual(EXPECTED_MESH_PROPS.map(norm));
  });

  it('pins required chainage/position vs optional index/event metadata (a missing ? fails here)', () => {
    expectTypeOf<LeafSample['rawChainage']>().toEqualTypeOf<number>();
    expectTypeOf<LeafSample['displayStation']>().toEqualTypeOf<number | null>();
    expectTypeOf<LeafSample['alignmentElementIndex']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LeafSample['surfaceTriangleIndex']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LeafSample['eventKind']>().toEqualTypeOf<LeafEventKind | undefined>();
    expectTypeOf<LeafMesh['adjacency']>().toEqualTypeOf<TinAdjacency[] | undefined>();
    expectTypeOf<LeafMesh['edgeKinds']>().toEqualTypeOf<TinEdgeKinds[] | undefined>();
  });

  it('compiles event/sample/mesh probes incl. a null display station', () => {
    expect(eventSamples).toHaveLength(7);
    expect(new Set<string>(eventSamples).size).toBe(7);
    expect(sampleSample.displayStation).toBeNull();
    expect(meshSample.triangles).toEqual([[0, 0, 0]]);
  });
});

describe('STRUCT-195.10 compatibility: consumers still reference the moved types', () => {
  it('CadSurfaceBuildResult still fields reasonCodes/points with the moved types (no weaker casts)', () => {
    expectTypeOf<CadSurfaceBuildResult['reasonCodes']>().toEqualTypeOf<LeafReasonCode[]>();
    expectTypeOf<CadSurfaceBuildResult['reasonCodes']>().toEqualTypeOf<BaseReasonCode[]>();
    expectTypeOf<CadSurfaceBuildResult['points']>().toEqualTypeOf<LeafSourcePoint[]>();
    expectTypeOf<CadSurfaceBuildResult['points']>().toEqualTypeOf<BaseSourcePoint[]>();
    const hub = requireSource(HUB_A, 'surface hub');
    expect(hub).toContain('reasonCodes: CadSurfaceReasonCode[]');
    expect(hub).toContain('points: CadSurfaceSourcePoint[]');
  });

  it('CollectedSources still fields points/breaklineError/boundaryError with the moved types', () => {
    expectTypeOf<CollectedSources['points']>().toEqualTypeOf<LeafSourcePoint[]>();
    expectTypeOf<CollectedSources['breaklineError']>().toEqualTypeOf<LeafReasonCode | null>();
    expectTypeOf<CollectedSources['boundaryError']>().toEqualTypeOf<LeafReasonCode | null>();
    const consumer = requireSource(CONSUMER_A, 'surface consumer');
    expect(consumer).toContain('points: CadSurfaceSourcePoint[]');
    expect(consumer).toContain('breaklineError: CadSurfaceReasonCode | null');
    expect(consumer).toContain('boundaryError: CadSurfaceReasonCode | null');
  });

  it('ProfileSegment still fields samples with the moved sample type', () => {
    expectTypeOf<ProfileSegment['samples']>().toEqualTypeOf<LeafSample[]>();
    expectTypeOf<ProfileSegment['samples']>().toEqualTypeOf<BaseSample[]>();
    const hub = requireSource(HUB_B, 'profile hub');
    expect(hub).toContain('samples: ProfileSample[]');
  });

  it('CadSurfaceProfileResult still fields segments with ProfileSegment', () => {
    expectTypeOf<CadSurfaceProfileResult['segments']>().toEqualTypeOf<ProfileSegment[]>();
    const hub = requireSource(HUB_B, 'profile hub');
    expect(hub).toContain('segments: ProfileSegment[]');
  });

  it('ExtractSurfaceProfileInput still fields mesh with the moved mesh type', () => {
    expectTypeOf<ExtractSurfaceProfileInput['mesh']>().toEqualTypeOf<LeafMesh>();
    expectTypeOf<ExtractSurfaceProfileInput['mesh']>().toEqualTypeOf<BaseMesh>();
    const hub = requireSource(HUB_B, 'profile hub');
    expect(hub).toContain('mesh: ProfileExtractionMesh');
  });
});

describe('STRUCT-195.10 legacy hub re-exports', () => {
  it('cadSurfaces still exports CadSurfaceReasonCode + CadSurfaceSourcePoint for every existing caller', () => {
    const hub = requireSource(HUB_A, 'surface hub');
    expect(hub).toContain("export type { CadSurfaceReasonCode, CadSurfaceSourcePoint } from './cadSurfaceSourceTypes'");
    expect(hub).toMatch(/import\s+type\s*\{[^}]*CadSurfaceSourcePoint[^}]*\}\s*from\s*['"]\.\/cadSurfaceSourceTypes['"]/);
  });

  it('profileExtraction still exports ProfileExtractionMesh + ProfileSample + ProfileSampleEventKind', () => {
    const hub = requireSource(HUB_B, 'profile hub');
    expect(hub).toContain("export type { ProfileExtractionMesh, ProfileSample, ProfileSampleEventKind } from './profileSampleTypes'");
    expect(hub).toMatch(/import\s+type\s*\{[^}]*ProfileSample[^}]*\}\s*from\s*['"]\.\/profileSampleTypes['"]/);
  });
});

describe('STRUCT-195.10 leaf purity (import-type-only)', () => {
  it('the source leaf imports exactly one type-only binding (no value imports)', () => {
    const source = requireSource(LEAF_A, 'source leaf');
    expect(nonTypeOnlyImports(source, LEAF_A)).toEqual([]);
    expect(importStatements(source, LEAF_A)).toEqual(EXPECTED_LEAF_A_IMPORTS.map(norm));
  });

  it('the profile leaf imports exactly two type-only bindings (no value imports)', () => {
    const source = requireSource(LEAF_B, 'profile leaf');
    expect(nonTypeOnlyImports(source, LEAF_B)).toEqual([]);
    expect(importStatements(source, LEAF_B)).toEqual(EXPECTED_LEAF_B_IMPORTS.map(norm));
  });

  it.each([LEAF_A, LEAF_B])('%s exports no runtime values (type/interface surface only)', (leafFile) => {
    const source = requireSource(leafFile, 'leaf');
    expect(valueExportProblems(source, leafFile)).toEqual([]);
  });
});

describe('STRUCT-195.10 consumer repoint', () => {
  it('cadSurfaceRevision imports the source types from the leaf, not the hub', () => {
    const source = requireSource(CONSUMER_A, 'surface consumer');
    expect(source).toContain("from './cadSurfaceSourceTypes'");
    expect(source).not.toMatch(/import\s+type\s*\{[^}]*CadSurfaceReasonCode[^}]*\}\s*from\s*['"]\.\/cadSurfaces['"]/);
    expect(source).not.toMatch(/import\s+type\s*\{[^}]*CadSurfaceSourcePoint[^}]*\}\s*from\s*['"]\.\/cadSurfaces['"]/);
  });

  it('profileSampling imports the sample types from the leaf, not the hub', () => {
    const source = requireSource(CONSUMER_B, 'profile consumer');
    expect(source).toContain("from './profileSampleTypes'");
    expect(source).not.toMatch(/import\s+type\s*\{[^}]*ProfileSample[^}]*\}\s*from\s*['"]\.\/profileExtraction['"]/);
  });
});

describe('STRUCT-195.10 cycle-break graph guard', () => {
  const workFiles = GRAPH_DIRS.flatMap((dir) => collectTypeScriptFiles(path.join(REPO_ROOT, dir)));
  const workGraph = buildGraphs(workFiles.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));

  it.each([...PAIR_A, ...PAIR_B])('%s is a TYPE singleton (pair SCC dissolved)', (member) => {
    const components = tarjanSCC(workGraph.nodes, workGraph.type);
    const host = components.find((component) => component.includes(abs(member)));
    expect(host, `${member} missing from graph`).toBeDefined();
    expect(host, `${member} still shares a TYPE SCC: ${host!.map(rel).sort().join(', ')}`).toEqual([abs(member)]);
  });

  it('neither pair shares a TYPE component anymore', () => {
    const components = tarjanSCC(workGraph.nodes, workGraph.type);
    for (const pair of [PAIR_A, PAIR_B]) {
      const host = components.find((component) => component.includes(abs(pair[0]!)));
      expect(host, `${pair[0]} missing from graph`).toBeDefined();
      expect(host!.includes(abs(pair[1]!)), `pair SCC still intact: ${host!.map(rel).sort().join(', ')}`).toBe(false);
    }
  });

  it('the TYPE graph drops to ZERO nontrivial SCCs (195.11 dissolved the projectTransform pair)', () => {
    const components = tarjanSCC(workGraph.nodes, workGraph.type);
    const cyclic = components.filter((component) => component.length > 1);
    const cyclicNodes = cyclic.reduce((sum, component) => sum + component.length, 0);
    expect(
      `type SCCs ${cyclic.length} (want 0), cyclic nodes ${cyclicNodes} (want 0)`,
    ).toBe('type SCCs 0 (want 0), cyclic nodes 0 (want 0)');
  });

  it('the former projectTransform pair members are now TYPE singletons (facade, core, request)', () => {
    const components = tarjanSCC(workGraph.nodes, workGraph.type);
    for (const member of [
      'src/engine/cad/cadProjectTransform.ts',
      'src/engine/cad/cadProjectTransformCore.ts',
      'src/engine/cad/cadProjectTransformRequest.ts',
    ]) {
      const host = components.find((component) => component.includes(abs(member)));
      expect(host, `${member} missing from graph`).toBeDefined();
      expect(host, `${member} still shares a TYPE SCC: ${host!.map(rel).sort().join(', ')}`).toEqual([abs(member)]);
    }
  });

  it('each leaf has no edges of any kind back to its hub or consumer', () => {
    const kindsBetween = (from: string, to: string): string[] =>
      workGraph.edges
        .filter((edge) => edge.from === abs(from) && edge.to === abs(to))
        .map((edge) => edge.kind);
    for (const target of [...PAIR_A]) {
      expect(kindsBetween(LEAF_A, target)).toEqual([]);
    }
    for (const target of [...PAIR_B]) {
      expect(kindsBetween(LEAF_B, target)).toEqual([]);
    }
  });

  it('every edge touching either leaf is type-only (no value/mixed incident edges)', () => {
    const incident = workGraph.edges.filter(
      (edge) => edge.from === abs(LEAF_A) || edge.to === abs(LEAF_A)
        || edge.from === abs(LEAF_B) || edge.to === abs(LEAF_B),
    );
    expect(incident.length).toBeGreaterThan(0);
    expect(incident.map((edge) => edge.kind)).toEqual(incident.map(() => 'type'));
  });

  it('matches the post-195.11 golden VALUE fingerprint (pre-split baseline frozen in the 19511 guard fixture)', () => {
    const toPosix = (p: string): string => p.split(path.sep).join('/');
    const pairs = [...new Set(
      workGraph.edges
        .filter((edge) => edge.kind === 'value' || edge.kind === 'mixed')
        .map((edge) => `${toPosix(rel(edge.from))}\n${toPosix(rel(edge.to))}`),
    )].sort();
    const edgeCount = workGraph.edges.filter(
      (edge) => edge.kind === 'value' || edge.kind === 'mixed',
    ).length;
    const actualHash = createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
    expect(
      `value pairs ${pairs.length} (want ${EXPECTED_BASELINE_VALUE_PAIR_COUNT}), `
        + `value edges ${edgeCount} (want ${EXPECTED_BASELINE_VALUE_EDGE_COUNT}), `
        + `pairs sha256 ${actualHash} (want ${EXPECTED_BASELINE_VALUE_PAIRS_SHA256})`,
    ).toBe(
      `value pairs ${EXPECTED_BASELINE_VALUE_PAIR_COUNT} `
        + `(want ${EXPECTED_BASELINE_VALUE_PAIR_COUNT}), `
        + `value edges ${EXPECTED_BASELINE_VALUE_EDGE_COUNT} `
        + `(want ${EXPECTED_BASELINE_VALUE_EDGE_COUNT}), `
        + `pairs sha256 ${EXPECTED_BASELINE_VALUE_PAIRS_SHA256} `
        + `(want ${EXPECTED_BASELINE_VALUE_PAIRS_SHA256})`,
    );
  });
});

describe('STRUCT-195.10 negative controls (mutated in-memory copies)', () => {
  it('control 1: a removed reason literal is flagged by the union-order pin', () => {
    const leaf = parseKnown(LEAF_A, 'source leaf');
    expect(unionMemberShapes(leaf, 'CadSurfaceReasonCode')).toEqual(EXPECTED_REASON_MEMBERS.map(norm));
    const clean = requireSource(LEAF_A, 'source leaf');
    const mutated = clean.replace(
      "  | 'SURFACE_TRIANGULATION_FAILED';",
      "  | 'SURFACE_TRIANGULATION_WRONG';",
    );
    expect(mutated, 'control mutation did not apply; restore check void').not.toBe(clean);
    expect(unionMemberShapes(parseSource(mutated, LEAF_A), 'CadSurfaceReasonCode')).not.toEqual(
      EXPECTED_REASON_MEMBERS.map(norm),
    );
    // Restore check: the on-disk source still pins clean.
    expect(unionMemberShapes(parseKnown(LEAF_A, 'source leaf'), 'CadSurfaceReasonCode'))
      .toEqual(EXPECTED_REASON_MEMBERS.map(norm));
  });

  it('control 2: a smuggled value import edge is flagged by the type-only scan', () => {
    const clean = requireSource(LEAF_A, 'source leaf');
    expect(nonTypeOnlyImports(clean, LEAF_A)).toEqual([]);
    const withValueImport = `import { collectSources } from './cadSurfaces';\n${clean}`;
    // A value backedge to the hub violates the import-type-only leaf contract.
    expect(nonTypeOnlyImports(withValueImport, LEAF_A)).toHaveLength(1);
    const withSideEffect = `import './cadSurfaces';\n${clean}`;
    expect(nonTypeOnlyImports(withSideEffect, LEAF_A)).toHaveLength(1);
    // Restore check: the on-disk source still imports types only.
    expect(nonTypeOnlyImports(requireSource(LEAF_A, 'source leaf'), LEAF_A)).toEqual([]);
    expect(importStatements(requireSource(LEAF_A, 'source leaf'), LEAF_A))
      .toEqual(EXPECTED_LEAF_A_IMPORTS.map(norm));
  });
});
