/**
 * STRUCT-195.9 — surface-edit reason + DXF point type leaves.
 *
 * Pins `src/engine/cad/cadSurfaceEditReasonTypes.ts` (17-member
 * CadSurfaceEditReason union, zero imports) and
 * `src/engine/cad/dxf/dxfPointTypes.ts` (DxfPoint + DxfPolylineVertex,
 * zero imports), plus the consumer repoints (cadSurfaceEditMesh,
 * dxfBlockExport) and hub re-exports (cadSurfaceEdits, dxfExportModel):
 *  - independent baseline-shape hand pins: `BaseReason` (17 literals
 *    hand-transcribed from the BASELINE source at HEAD via
 *    `git show HEAD:src/engine/cad/cadSurfaceEdits.ts`, origin/main
 *    658f4c7eb42f583723b7222e6b6f927fb6c30717) and `BaseDxfPoint` /
 *    `BaseDxfPolylineVertex` (hand-transcribed from BASELINE
 *    dxfExportModel.ts). They import NO leaf type, so leaf drift cannot
 *    move both sides of an assertion. Every `Base*` is compared against
 *    BOTH the old-path export and the new-leaf export via bidirectional
 *    `expectTypeOf` equality (typecheck-enforced);
 *  - complete AST shape checks: exact union literal order (reason),
 *    exact interface prop shapes incl. `?` markers (DXF), and the
 *    `extends DxfPoint` heritage pin — all whitespace-normalized, so a
 *    missing `?`, missing literal, or broken extension fails `vitest`
 *    even without a typecheck gate;
 *  - legacy-path checks: old-path CadSurfaceEditReason / DxfPoint /
 *    DxfPolylineVertex still exported from the hubs; DxfPoint3D untouched
 *    in dxfExportModel;
 *  - leaf purity: both leaves contain ZERO import statements and no
 *    runtime value exports (AST scan);
 *  - graph guard: both exact 2-node TYPE components dissolve into
 *    singletons (TYPE 5 SCC/10 nodes -> 3 SCC/6 nodes after 195.9; the
 *    cumulative TYPE graph then fell to 1 SCC/2 nodes in 195.10, leaving
 *    only the untouched projectTransform pair), and the VALUE edge
 *    membership is byte-identical vs baseline (pinned fingerprint, not
 *    just equal counts).
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

import type { CadSurfaceEditReason as OldReason } from '../src/engine/cad/cadSurfaceEdits';
import type { CadSurfaceEditReason as LeafReason } from '../src/engine/cad/cadSurfaceEditReasonTypes';
import type {
  DxfPoint as OldDxfPoint,
  DxfPoint3D as OldDxfPoint3D,
  DxfPolylineVertex as OldDxfPolylineVertex,
} from '../src/engine/cad/dxf/dxfExportModel';
import type {
  DxfPoint as LeafDxfPoint,
  DxfPolylineVertex as LeafDxfPolylineVertex,
} from '../src/engine/cad/dxf/dxfPointTypes';

/**
 * CI-shallow-checkout-safe baseline fingerprint (STRUCT-195.7/195.8
 * pattern, reused for 195.9).
 *
 * The committed test must NOT call loadSourcesFromGit(BASELINE_REF): CI
 * checks out shallow history without the baseline commit, so `git ls-tree
 * <sha>` fails with exit 128. Instead the baseline VALUE graph is pinned
 * here as immutable constants. Reuse of the 195.8 pin is valid because the
 * canonicalization is identical (scope GRAPH_DIRS, edge kinds value|mixed
 * with mixed counting toward both tallies, pair strings
 * `<relPosix(from)>\n<relPosix(to)>` deterministically sorted with
 * duplicates collapsed, sha256 over JSON.stringify(pairs)) AND the pin was
 * verified empirically on the 195.9 baseline at origin/main 658f4c7e
 * (476 nodes / 2383 edges; 1561 unique VALUE pairs / 1579 value|mixed
 * edges with SHA256
 * 2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f;
 * see docs/evidence/struct-1959/validation.md). The refactor moves only
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
 * all 195.9 payload/type/purity/singleton assertions intact and only rolls
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
 * keeps all 195.9 payload/type/purity/singleton assertions intact and only
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
 * all 195.9 payload/type/purity/singleton assertions intact and only rolls
 * the global golden forward; any further pair/edge/SHA change fails.
 *
 * STRUCT-195.14 roll-forward (FOURTH authorized runtime value-graph change):
 * the final geometry cycle break (new dependency-light
 * src/engine/cad/cadGeometryPrimitives.ts owning the 5 interfaces + 15
 * primitive runtime functions verbatim; cadGeometry.ts thinned to a 3-line
 * public facade; the five arc/curve implementation leaves repoint their
 * './cadGeometry' specifiers to './cadGeometryPrimitives' with bodies
 * byte-identical) removes 6 edges and adds 6: five MIXED leaf->facade edges
 * become leaf->primitives, the unused TYPE facade->cadTypes edge
 * (CadArcEntity) drops, and one VALUE facade->primitives export-star edge
 * appears — nodes 482->483, total edges unchanged (2400), value|mixed
 * 1584->1585, unique pairs 1566->1567, SHA 76838237…->0bc9bae1…. The 195.13
 * golden (1566/1584/76838237…) survives in git history at c7987ebc and the
 * complete removal/addition allowlist is proved in
 * tests/cad_geometry_primitives_runtime_cycle_19514.test.ts (and cumulatively
 * in tests/cad_project_transform_runtime_cycle_19511.test.ts). This guard
 * keeps all 195.9 payload/type/purity/singleton assertions intact and only
 * rolls the global golden forward; any further pair/edge/SHA change fails.
 */
const EXPECTED_BASELINE_VALUE_PAIR_COUNT = 1567;
const EXPECTED_BASELINE_VALUE_EDGE_COUNT = 1585;
const EXPECTED_BASELINE_VALUE_PAIRS_SHA256 =
  '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative);
const rel = (absolute: string): string => path.relative(REPO_ROOT, absolute);

const LEAF_A = 'src/engine/cad/cadSurfaceEditReasonTypes.ts';
const HUB_A = 'src/engine/cad/cadSurfaceEdits.ts';
const CONSUMER_A = 'src/engine/cad/cadSurfaceEditMesh.ts';
const LEAF_B = 'src/engine/cad/dxf/dxfPointTypes.ts';
const HUB_B = 'src/engine/cad/dxf/dxfExportModel.ts';
const CONSUMER_B = 'src/engine/cad/dxf/dxfBlockExport.ts';
const PAIR_A = [HUB_A, CONSUMER_A];
const PAIR_B = [HUB_B, CONSUMER_B];
const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish'];

/** Throw a clear blocked-status error when a Worker leaf has not landed yet. */
const requireSource = (file: string, label: string): string => {
  const absolute = abs(file);
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `STRUCT-195.9 blocked: ${label} not present yet at ${file} `
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

/** Heritage clause texts of an interface (e.g. `extends DxfPoint`). Null when absent. */
const interfaceHeritage = (source: ts.SourceFile, typeName: string): string[] | null => {
  const decl = source.statements.find(
    (stmt): stmt is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName,
  );
  if (!decl) return null;
  return [...(decl.heritageClauses ?? [])].flatMap((clause) =>
    clause.types.map((t) => norm(t.getText())),
  );
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
// Independent baseline pins (STRUCT-195.9).
//
// Hand-transcribed from the pre-refactor baseline at
// 658f4c7eb42f583723b7222e6b6f927fb6c30717
// (`git show HEAD:src/engine/cad/cadSurfaceEdits.ts` and
// `git show HEAD:src/engine/cad/dxf/dxfExportModel.ts`). They import no
// leaf type, so leaf drift cannot move both sides of an assertion.
// ---------------------------------------------------------------------------

type BaseReason =
  | 'SURFACE_EDIT_VERTEX_MISSING'
  | 'SURFACE_EDIT_EDGE_MISSING'
  | 'SURFACE_EDIT_NOT_APPLICABLE'
  | 'SURFACE_EDIT_BLOCKED_CONSTRAINT'
  | 'SURFACE_EDIT_SYNTHETIC_VERTEX'
  | 'SURFACE_EDIT_INTERMEDIATE_VERTEX'
  | 'SURFACE_EDIT_POINT_OUTSIDE_DOMAIN'
  | 'SURFACE_EDIT_POINT_ON_BOUNDARY'
  | 'SURFACE_EDIT_POINT_ALREADY_EXISTS'
  | 'SURFACE_EDIT_DELETE_POINT_CONSTRAINED'
  | 'SURFACE_EDIT_DELETE_POINT_BOUNDARY'
  | 'SURFACE_EDIT_DELETE_POINT_CAVITY_INVALID'
  | 'SURFACE_EDIT_MOVE_POINT_CONSTRAINED'
  | 'SURFACE_EDIT_MOVE_POINT_BOUNDARY'
  | 'SURFACE_EDIT_MOVE_POINT_INVALID_STAR'
  | 'SURFACE_EDIT_MOVE_POINT_INTERSECTION'
  | 'SURFACE_EDIT_ELEVATION_INVALID';

type BaseDxfPoint = {
  x: number;
  y: number;
};

interface BaseDxfPolylineVertex extends BaseDxfPoint {
  bulge?: number;
  startWidth?: number;
  endWidth?: number;
}

/** Exact reason union member pins, in declaration order. */
const EXPECTED_REASON_MEMBERS = [
  "'SURFACE_EDIT_VERTEX_MISSING'",
  "'SURFACE_EDIT_EDGE_MISSING'",
  "'SURFACE_EDIT_NOT_APPLICABLE'",
  "'SURFACE_EDIT_BLOCKED_CONSTRAINT'",
  "'SURFACE_EDIT_SYNTHETIC_VERTEX'",
  "'SURFACE_EDIT_INTERMEDIATE_VERTEX'",
  "'SURFACE_EDIT_POINT_OUTSIDE_DOMAIN'",
  "'SURFACE_EDIT_POINT_ON_BOUNDARY'",
  "'SURFACE_EDIT_POINT_ALREADY_EXISTS'",
  "'SURFACE_EDIT_DELETE_POINT_CONSTRAINED'",
  "'SURFACE_EDIT_DELETE_POINT_BOUNDARY'",
  "'SURFACE_EDIT_DELETE_POINT_CAVITY_INVALID'",
  "'SURFACE_EDIT_MOVE_POINT_CONSTRAINED'",
  "'SURFACE_EDIT_MOVE_POINT_BOUNDARY'",
  "'SURFACE_EDIT_MOVE_POINT_INVALID_STAR'",
  "'SURFACE_EDIT_MOVE_POINT_INTERSECTION'",
  "'SURFACE_EDIT_ELEVATION_INVALID'",
];

/** Exact DxfPoint / DxfPolylineVertex property pins (`?` significant). */
const EXPECTED_POINT_PROPS = ['x:number', 'y:number'];
const EXPECTED_VERTEX_PROPS = ['bulge?:number', 'startWidth?:number', 'endWidth?:number'];

/** Sample probes: one value per reason literal + DXF point/vertex shapes. */
const reasonSamples: LeafReason[] = [...EXPECTED_REASON_MEMBERS.map(
  (literal) => literal.slice(1, -1) as LeafReason,
)];
const pointSample: LeafDxfPoint = { x: 1.5, y: -2.5 };
const vertexSample: LeafDxfPolylineVertex = { x: 0, y: 0, bulge: 0.5, startWidth: 1, endWidth: 2 };
const vertexBareSample: LeafDxfPolylineVertex = { x: 3, y: 4 };

// ---------------------------------------------------------------------------

describe('STRUCT-195.9 leaf presence (Worker handoff)', () => {
  it('both leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(abs(LEAF_A)), `leaf missing: ${LEAF_A}`).toBe(true);
    expect(fs.existsSync(abs(LEAF_B)), `leaf missing: ${LEAF_B}`).toBe(true);
  });

  it('the reason leaf declares exactly CadSurfaceEditReason', () => {
    const source = parseKnown(LEAF_A, 'reason leaf');
    const names = source.statements
      .filter((stmt): stmt is ts.TypeAliasDeclaration =>
        ts.isTypeAliasDeclaration(stmt)
        && (stmt.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false))
      .map((stmt) => stmt.name.text);
    expect(names).toEqual(['CadSurfaceEditReason']);
  });

  it('the DXF leaf declares exactly DxfPoint + DxfPolylineVertex', () => {
    const source = parseKnown(LEAF_B, 'DXF leaf');
    const names = source.statements
      .filter((stmt): stmt is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(stmt)
        && (stmt.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false))
      .map((stmt) => stmt.name.text);
    expect(names).toEqual(['DxfPoint', 'DxfPolylineVertex']);
  });
});

describe('STRUCT-195.9 independent baseline pins: reason union', () => {
  it('matches the pre-refactor shape on the old path and the leaf (both directions)', () => {
    expectTypeOf<OldReason>().toEqualTypeOf<BaseReason>();
    expectTypeOf<BaseReason>().toEqualTypeOf<OldReason>();
    expectTypeOf<LeafReason>().toEqualTypeOf<BaseReason>();
    expectTypeOf<BaseReason>().toEqualTypeOf<LeafReason>();
  });

  it('keeps the old path and the leaf identical (both directions)', () => {
    expectTypeOf<OldReason>().toEqualTypeOf<LeafReason>();
    expectTypeOf<LeafReason>().toEqualTypeOf<OldReason>();
  });

  it('pins the exact 17 literals in declaration order', () => {
    const leaf = parseKnown(LEAF_A, 'reason leaf');
    const actual = unionMemberShapes(leaf, 'CadSurfaceEditReason');
    expect(actual, 'CadSurfaceEditReason missing from leaf').not.toBeNull();
    expect(actual, 'reason literal drift').toEqual(EXPECTED_REASON_MEMBERS.map(norm));
    expect(actual, 'reason member count drift').toHaveLength(17);
  });

  it('compiles one sample per literal (exhaustiveness probe)', () => {
    expect(reasonSamples).toHaveLength(17);
    const seen = new Set<string>(reasonSamples);
    expect(seen.size).toBe(17);
  });

  it('Extract narrowing still discriminates single literals', () => {
    expectTypeOf<Extract<LeafReason, 'SURFACE_EDIT_ELEVATION_INVALID'>>()
      .toEqualTypeOf<'SURFACE_EDIT_ELEVATION_INVALID'>();
    expectTypeOf<Extract<LeafReason, 'SURFACE_EDIT_MOVE_POINT_INTERSECTION'>>()
      .toEqualTypeOf<'SURFACE_EDIT_MOVE_POINT_INTERSECTION'>();
  });
});

describe('STRUCT-195.9 independent baseline pins: DXF point types', () => {
  it('matches the pre-refactor shapes on the old path and the leaf (both directions)', () => {
    expectTypeOf<OldDxfPoint>().toEqualTypeOf<BaseDxfPoint>();
    expectTypeOf<BaseDxfPoint>().toEqualTypeOf<OldDxfPoint>();
    expectTypeOf<LeafDxfPoint>().toEqualTypeOf<BaseDxfPoint>();
    expectTypeOf<BaseDxfPoint>().toEqualTypeOf<LeafDxfPoint>();
    expectTypeOf<OldDxfPolylineVertex>().toEqualTypeOf<BaseDxfPolylineVertex>();
    expectTypeOf<BaseDxfPolylineVertex>().toEqualTypeOf<OldDxfPolylineVertex>();
    expectTypeOf<LeafDxfPolylineVertex>().toEqualTypeOf<BaseDxfPolylineVertex>();
    expectTypeOf<BaseDxfPolylineVertex>().toEqualTypeOf<LeafDxfPolylineVertex>();
  });

  it('keeps the old path and the leaf identical (both directions)', () => {
    expectTypeOf<OldDxfPoint>().toEqualTypeOf<LeafDxfPoint>();
    expectTypeOf<LeafDxfPoint>().toEqualTypeOf<OldDxfPoint>();
    expectTypeOf<OldDxfPolylineVertex>().toEqualTypeOf<LeafDxfPolylineVertex>();
    expectTypeOf<LeafDxfPolylineVertex>().toEqualTypeOf<OldDxfPolylineVertex>();
  });

  it('pins the exact DxfPoint props and the DxfPolylineVertex extension + optional props', () => {
    const leaf = parseKnown(LEAF_B, 'DXF leaf');
    expect(interfacePropShapes(leaf, 'DxfPoint'), 'DxfPoint missing from leaf')
      .toEqual(EXPECTED_POINT_PROPS.map(norm));
    expect(interfacePropShapes(leaf, 'DxfPolylineVertex'), 'DxfPolylineVertex missing from leaf')
      .toEqual(EXPECTED_VERTEX_PROPS.map(norm));
    expect(interfaceHeritage(leaf, 'DxfPolylineVertex'), 'extension drift')
      .toEqual(['DxfPoint']);
  });

  it('pins required x/y vs optional bulge/width metadata (a missing ? fails here)', () => {
    expectTypeOf<LeafDxfPoint['x']>().toEqualTypeOf<number>();
    expectTypeOf<LeafDxfPoint['y']>().toEqualTypeOf<number>();
    expectTypeOf<LeafDxfPolylineVertex['x']>().toEqualTypeOf<number>();
    expectTypeOf<LeafDxfPolylineVertex['bulge']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LeafDxfPolylineVertex['startWidth']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LeafDxfPolylineVertex['endWidth']>().toEqualTypeOf<number | undefined>();
  });

  it('compiles point/vertex samples incl. a bare legacy vertex', () => {
    expect([pointSample.x, pointSample.y]).toEqual([1.5, -2.5]);
    expect([vertexSample.bulge, vertexSample.startWidth, vertexSample.endWidth]).toEqual([0.5, 1, 2]);
    expect(Object.keys(vertexBareSample).sort()).toEqual(['x', 'y']);
  });

  it('leaves DxfPoint3D untouched in its original module (not moved to the leaf)', () => {
    expectTypeOf<OldDxfPoint3D>().toEqualTypeOf<{ x: number; y: number; z: number }>();
    const leaf = requireSource(LEAF_B, 'DXF leaf');
    expect(leaf).not.toContain('DxfPoint3D');
    const hub = parseKnown(HUB_B, 'DXF hub');
    expect(interfacePropShapes(hub, 'DxfPoint3D')).toEqual(['x:number', 'y:number', 'z:number'].map(norm));
  });
});

describe('STRUCT-195.9 legacy hub re-exports', () => {
  it('cadSurfaceEdits still exports CadSurfaceEditReason for every existing caller', () => {
    const hub = requireSource(HUB_A, 'surface hub');
    expect(hub).toContain("export type { CadSurfaceEditReason } from './cadSurfaceEditReasonTypes'");
    expect(hub).toMatch(/import\s+type\s*\{[^}]*CadSurfaceEditReason[^}]*\}\s*from\s*['"]\.\/cadSurfaceEditReasonTypes['"]/);
  });

  it('dxfExportModel still exports DxfPoint + DxfPolylineVertex for legacy consumers', () => {
    const hub = requireSource(HUB_B, 'DXF hub');
    expect(hub).toContain("export type { DxfPoint, DxfPolylineVertex } from './dxfPointTypes'");
    expect(hub).toMatch(/import\s+type\s*\{[^}]*DxfPoint[^}]*\}\s*from\s*['"]\.\/dxfPointTypes['"]/);
  });
});

describe('STRUCT-195.9 leaf purity', () => {
  it.each([LEAF_A, LEAF_B])('%s contains ZERO import statements (not even import type)', (leafFile) => {
    const source = requireSource(leafFile, 'leaf');
    expect(importStatements(source, leafFile)).toEqual([]);
    expect(source).not.toMatch(/^\s*import[\s('"]/m);
  });

  it.each([LEAF_A, LEAF_B])('%s exports no runtime values (type/interface surface only)', (leafFile) => {
    const source = requireSource(leafFile, 'leaf');
    expect(valueExportProblems(source, leafFile)).toEqual([]);
  });
});

describe('STRUCT-195.9 consumer repoint', () => {
  it('cadSurfaceEditMesh imports the reason type from the leaf, not the hub', () => {
    const source = requireSource(CONSUMER_A, 'surface consumer');
    expect(source).toContain("from './cadSurfaceEditReasonTypes'");
    expect(source).not.toMatch(/import\s+type\s*\{[^}]*CadSurfaceEditReason[^}]*\}\s*from\s*['"]\.\/cadSurfaceEdits['"]/);
  });

  it('dxfBlockExport imports the point types from the leaf, not the hub', () => {
    const source = requireSource(CONSUMER_B, 'DXF consumer');
    expect(source).toContain("from './dxfPointTypes'");
    expect(source).not.toMatch(/import\s+type\s*\{[^}]*DxfPoint[^}]*\}\s*from\s*['"]\.\/dxfExportModel['"]/);
  });
});

describe('STRUCT-195.9 cycle-break graph guard', () => {
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

  it('the cumulative TYPE graph is now ZERO nontrivial SCCs (195.11 dissolved the last projectTransform pair; 195.9 landed at 3 SCC / 6 nodes, 195.10 at 1 / 2)', () => {
    const components = tarjanSCC(workGraph.nodes, workGraph.type);
    const cyclic = components.filter((component) => component.length > 1);
    const cyclicNodes = cyclic.reduce((sum, component) => sum + component.length, 0);
    expect(
      `type SCCs ${cyclic.length} (want 0), cyclic nodes ${cyclicNodes} (want 0)`,
    ).toBe('type SCCs 0 (want 0), cyclic nodes 0 (want 0)');
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

describe('STRUCT-195.9 negative controls (mutated in-memory copies)', () => {
  it('control 1: a smuggled import is flagged by the purity scan (both leaves)', () => {
    for (const leafFile of [LEAF_A, LEAF_B]) {
      const clean = requireSource(leafFile, 'leaf');
      expect(importStatements(clean, leafFile)).toEqual([]);
      const withValueImport = `import { orient2d } from 'robust-predicates';\n${clean}`;
      expect(importStatements(withValueImport, leafFile)).toHaveLength(1);
      const withTypeImport = `import type { ExportWarning } from '../exportResult';\n${clean}`;
      // Even a type-only import violates the zero-import leaf contract.
      expect(importStatements(withTypeImport, leafFile)).toHaveLength(1);
    }
  });

  it('control 2: a smuggled runtime value export is flagged by the value scan', () => {
    for (const leafFile of [LEAF_A, LEAF_B]) {
      const clean = requireSource(leafFile, 'leaf');
      expect(valueExportProblems(clean, leafFile)).toEqual([]);
      const withValue = `${clean}\nexport const LEAF_SENTINEL = 1 as const;\n`;
      expect(valueExportProblems(withValue, leafFile)).not.toEqual([]);
      const withReexport = `${clean}\nexport { editStatusOfReason } from './cadSurfaceEdits';\n`;
      expect(valueExportProblems(withReexport, leafFile)).not.toEqual([]);
    }
  });

  it('control 3: a dropped reason literal is flagged by the union-order pin', () => {
    const leaf = parseKnown(LEAF_A, 'reason leaf');
    expect(unionMemberShapes(leaf, 'CadSurfaceEditReason')).toEqual(EXPECTED_REASON_MEMBERS.map(norm));
    const mutated = requireSource(LEAF_A, 'reason leaf').replace(
      "  | 'SURFACE_EDIT_ELEVATION_INVALID';",
      "  | 'SURFACE_EDIT_ELEVATION_WRONG';",
    );
    expect(mutated).not.toBe(requireSource(LEAF_A, 'reason leaf'));
    expect(unionMemberShapes(parseSource(mutated, LEAF_A), 'CadSurfaceEditReason')).not.toEqual(
      EXPECTED_REASON_MEMBERS.map(norm),
    );
  });

  it('control 4: a dropped ? on bulge is flagged by the vertex-shape pin', () => {
    const leaf = parseKnown(LEAF_B, 'DXF leaf');
    expect(interfacePropShapes(leaf, 'DxfPolylineVertex')).toEqual(EXPECTED_VERTEX_PROPS.map(norm));
    const mutated = requireSource(LEAF_B, 'DXF leaf').replace('bulge?: number;', 'bulge: number;');
    expect(mutated).not.toBe(requireSource(LEAF_B, 'DXF leaf'));
    expect(interfacePropShapes(parseSource(mutated, LEAF_B), 'DxfPolylineVertex')).not.toEqual(
      EXPECTED_VERTEX_PROPS.map(norm),
    );
  });

  it('control 5: a restored backedge import is flagged by the repoint pin', () => {
    const consumerA = requireSource(CONSUMER_A, 'surface consumer');
    expect(consumerA).toContain("from './cadSurfaceEditReasonTypes'");
    const backedge = consumerA.replace(
      "from './cadSurfaceEditReasonTypes'",
      "from './cadSurfaceEdits'",
    );
    expect(backedge).not.toBe(consumerA);
    expect(backedge).toMatch(/from\s*['"]\.\/cadSurfaceEdits['"]/);
    const consumerB = requireSource(CONSUMER_B, 'DXF consumer');
    expect(consumerB).toContain("from './dxfPointTypes'");
    const backedgeB = consumerB.replace("from './dxfPointTypes'", "from './dxfExportModel'");
    expect(backedgeB).not.toBe(consumerB);
    expect(backedgeB).toMatch(/from\s*['"]\.\/dxfExportModel['"]/);
  });
});
