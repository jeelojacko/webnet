/**
 * STRUCT-195.8 (Workstream C: tests + evidence) — ExportBase + ExportItem leaf.
 *
 * Pins `src/engine/cad/cadExportItemTypes.ts` (Worker: ExportBase +
 * ExportItem leaf, zero imports) and the four consumer repoints
 * (cadAnalysisExportScene, cadGradingExportScene,
 * cadGradingGroupExportScene, cadSheetScene import ExportItem from the
 * leaf; the parent re-exports ExportBase/ExportItem from cadExportScene.ts
 * via `export type { ... } from './cadExportItemTypes'`):
 *  - independent baseline-shape hand pins: `BaseExportBase` + the full
 *    7-branch `BaseExportItem` below are hand-transcribed from the BASELINE
 *    source at HEAD (`git show HEAD:src/engine/cad/cadExportScene.ts`,
 *    origin/main 5fcffc46511e82c1c4e8663f0d3d492fbed28a73) and import NO
 *    type from the leaf under test, so leaf drift cannot move both sides
 *    of an assertion. Every `Base*` is compared against BOTH the old-path
 *    export and the new-leaf export via bidirectional `expectTypeOf`
 *    equality (typecheck-enforced);
 *  - complete AST shape check: the exact union branch order (line,
 *    polyline, rect, circle, ellipse, arc, text), the exact keys per branch
 *    (including the trailing-`;}` trivia of the text branch, pinned
 *    verbatim), and the exact ExportBase property list — all
 *    whitespace-normalized `name[?]: type` pins read from the leaf source
 *    at test time, so a missing `?`, changed literal/number type, or
 *    changed nested point-array shape fails `vitest` even without a
 *    typecheck gate;
 *  - explicit discriminant/optional probes (kind literals per branch,
 *    required `layer`, optional `clipId`/`anchor`/`rotationDeg`, the nested
 *    `Array<{x;y}>` point shape, the text `anchor` union);
 *  - legacy ExportWarning path: the type imported from cadExportScene
 *    equals the type from exportResult;
 *  - leaf purity: cadExportItemTypes.ts contains ZERO import statements
 *    (not even `import type`) and no runtime value exports (AST scan);
 *  - graph guard: the exact 5-node TYPE SCC [cadExportScene,
 *    cadAnalysisExportScene, cadGradingExportScene,
 *    cadGradingGroupExportScene, cadSheetScene] no longer exists as one
 *    component (each of the five is a TYPE singleton), and the VALUE edge
 *    membership is byte-identical vs baseline (pinned fingerprint, not
 *    just equal counts).
 *
 * This suite covers the INTEGRATED end state: it reads the actual leaf +
 * hub + consumers from disk and fails with a clear blocked-status message
 * when the leaf has not landed yet.
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
  ExportBase as OldExportBase,
  ExportItem as OldExportItem,
  ExportWarning as OldExportWarning,
} from '../src/engine/cad/cadExportScene';
import type {
  ExportBase as LeafExportBase,
  ExportItem as LeafExportItem,
} from '../src/engine/cad/cadExportItemTypes';
import type { ExportWarning as ResultExportWarning } from '../src/engine/cad/exportResult';

/**
 * CI-shallow-checkout-safe baseline fingerprint (STRUCT-195.7 pattern,
 * reused for 195.8).
 *
 * The committed test must NOT call loadSourcesFromGit(BASELINE_REF): CI
 * checks out shallow history without the baseline commit, so `git ls-tree
 * <sha>` fails with exit 128. Instead the baseline VALUE graph is pinned
 * here as immutable constants. Reuse of the 195.7 pin is valid because the
 * canonicalization is identical (scope GRAPH_DIRS, edge kinds value|mixed
 * with mixed counting toward both tallies, pair strings
 * `<relPosix(from)>\n<relPosix(to)>` deterministically sorted with
 * duplicates collapsed, sha256 over JSON.stringify(pairs)) AND the pin was
 * verified empirically: the BASELINE-at-HEAD graph (475 nodes, built from
 * `git show HEAD:<path>` on a full-history checkout) and the integrated
 * worktree graph both produce 1561 unique VALUE pairs / 1579 value|mixed
 * edges with SHA256 2bf1817d3978bf7a0b6e82f03008c4e10750983c293b1f7a75da60ae3fb6323f
 * (see docs/evidence/struct-1958/validation.md). The refactor moves only
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
 * all 195.8 payload/type/purity/singleton assertions intact and only rolls
 * the global golden forward; any further pair/edge/SHA change still fails.
 *
 * Pin semantics:
 *  - EXPECTED_BASELINE_VALUE_PAIRS_SHA256: sha256 over
 *    JSON.stringify(sortedUniquePairs). Pins full edge MEMBERSHIP.
 *  - EXPECTED_BASELINE_VALUE_PAIR_COUNT (1561): guards the Set size.
 *  - EXPECTED_BASELINE_VALUE_EDGE_COUNT (1579): total value|mixed edges
 *    WITH multiplicity, so collapsing two same-pair edges into one is
 *    still caught.
 * Limitations: keys are from->to pair strings, so a change that preserves
 * the pair multiset is invisible (same residual risk as the 195.7 guard).
 */
const EXPECTED_BASELINE_VALUE_PAIR_COUNT = 1562;
const EXPECTED_BASELINE_VALUE_EDGE_COUNT = 1580;
const EXPECTED_BASELINE_VALUE_PAIRS_SHA256 =
  '3d7284dbb0d33d8ba7afaad3dc2c0a7136945e98910ac026eebd03c0fbdc835e';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative);
const rel = (absolute: string): string => path.relative(REPO_ROOT, absolute);

const LEAF = 'src/engine/cad/cadExportItemTypes.ts';
const HUB = 'src/engine/cad/cadExportScene.ts';
const CONSUMERS = [
  'src/engine/cad/cadAnalysisExportScene.ts',
  'src/engine/cad/cadGradingExportScene.ts',
  'src/engine/cad/cadGradingGroupExportScene.ts',
  'src/engine/cad/cadSheetScene.ts',
] as const;
const FIVE = [HUB, ...CONSUMERS];
const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish'];

/** Throw a clear blocked-status error when the Worker leaf has not landed yet. */
const requireSource = (file: string, label: string): string => {
  const absolute = abs(file);
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `STRUCT-195.8 blocked: ${label} not present yet at ${file} `
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

const unwrapType = (node: ts.TypeNode): ts.TypeNode => {
  let current = node;
  while (ts.isParenthesizedTypeNode(current)) current = current.type;
  return current;
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

/**
 * Per-branch property shapes of a `(Base & { ... }) | ...` union alias, in
 * branch order: one `name[?]: type` array per branch. Returns null when the
 * alias is absent, not a union, or a branch has no object-literal side.
 */
const unionBranchPropShapes = (source: ts.SourceFile, aliasName: string): string[][] | null => {
  const decl = source.statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === aliasName,
  );
  if (!decl || !ts.isUnionTypeNode(decl.type)) return null;
  const branches: string[][] = [];
  for (const member of decl.type.types) {
    const unwrapped = unwrapType(member);
    const literal = ts.isIntersectionTypeNode(unwrapped)
      ? unwrapped.types.map(unwrapType).find((part): part is ts.TypeLiteralNode => ts.isTypeLiteralNode(part))
      : ts.isTypeLiteralNode(unwrapped) ? unwrapped : undefined;
    if (!literal) return null;
    branches.push(
      [...literal.members]
        .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
        .map(propShape),
    );
  }
  return branches;
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

/** Kind literal of each ExportItem union branch, in branch order. */
const exportItemBranchKinds = (source: string, fileName: string): string[] | null => {
  const branches = unionBranchPropShapes(parseSource(source, fileName), 'ExportItem');
  if (!branches) return null;
  return branches.map((props) => props[0] ?? '<missing>');
};

// ---------------------------------------------------------------------------
// Independent baseline pins (STRUCT-195.8).
//
// Hand-transcribed from the pre-refactor baseline at
// 5fcffc46511e82c1c4e8663f0d3d492fbed28a73
// (`git show HEAD:src/engine/cad/cadExportScene.ts`). They import no leaf
// type, so leaf drift cannot move both sides of an assertion.
// ---------------------------------------------------------------------------

type BaseExportBase = {
  layer: string;
  clipId?: string;
  stroke?: string;
  fill?: string;
  dash?: string;
  sourceEntityId?: string;
  widthMm?: number;
  opacity?: number;
};

type BaseExportItem =
  | (BaseExportBase & { kind: 'line'; x1: number; y1: number; x2: number; y2: number })
  | (BaseExportBase & { kind: 'polyline'; points: Array<{ x: number; y: number }>; close: boolean })
  | (BaseExportBase & { kind: 'rect'; x: number; y: number; width: number; height: number })
  | (BaseExportBase & { kind: 'circle'; cx: number; cy: number; r: number })
  | (BaseExportBase & { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; rotationDeg: number })
  | (BaseExportBase & { kind: 'arc'; cx: number; cy: number; r: number; startDeg: number; endDeg: number })
  | (BaseExportBase & {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      heightMm: number;
      anchor?: 'start' | 'middle' | 'end';
      rotationDeg?: number;
    });

/** Exact ExportBase property pins, in declaration order (`?` significant). */
const EXPECTED_BASE_PROPS = [
  'layer:string',
  'clipId?:string',
  'stroke?:string',
  'fill?:string',
  'dash?:string',
  'sourceEntityId?:string',
  'widthMm?:number',
  'opacity?:number',
];

/**
 * Exact ExportItem union member pins, in branch order. Pinned verbatim
 * from the leaf AST (whitespace-normalized, including the trailing-`;}`
 * trivia of the multi-line text branch), so branch reorder, a missing `?`,
 * a changed literal/number type, or a changed nested point-array shape
 * fails here.
 */
const EXPECTED_ITEM_MEMBERS = [
  "(ExportBase&{kind:'line';x1:number;y1:number;x2:number;y2:number})",
  "(ExportBase&{kind:'polyline';points:Array<{x:number;y:number}>;close:boolean})",
  "(ExportBase&{kind:'rect';x:number;y:number;width:number;height:number})",
  "(ExportBase&{kind:'circle';cx:number;cy:number;r:number})",
  "(ExportBase&{kind:'ellipse';cx:number;cy:number;rx:number;ry:number;rotationDeg:number})",
  "(ExportBase&{kind:'arc';cx:number;cy:number;r:number;startDeg:number;endDeg:number})",
  "(ExportBase&{kind:'text';x:number;y:number;text:string;heightMm:number;anchor?:'start'|'middle'|'end';rotationDeg?:number;})",
];

/** Exact per-branch key pins (branch order × declaration order, `?` significant). */
const EXPECTED_BRANCH_PROPS: string[][] = [
  ["kind:'line'", 'x1:number', 'y1:number', 'x2:number', 'y2:number'],
  ["kind:'polyline'", 'points:Array<{x:number;y:number}>', 'close:boolean'],
  ["kind:'rect'", 'x:number', 'y:number', 'width:number', 'height:number'],
  ["kind:'circle'", 'cx:number', 'cy:number', 'r:number'],
  ["kind:'ellipse'", 'cx:number', 'cy:number', 'rx:number', 'ry:number', 'rotationDeg:number'],
  ["kind:'arc'", 'cx:number', 'cy:number', 'r:number', 'startDeg:number', 'endDeg:number'],
  ["kind:'text'", 'x:number', 'y:number', 'text:string', 'heightMm:number', "anchor?:'start'|'middle'|'end'", 'rotationDeg?:number'],
];

const EXPECTED_BRANCH_KINDS = [
  "kind:'line'",
  "kind:'polyline'",
  "kind:'rect'",
  "kind:'circle'",
  "kind:'ellipse'",
  "kind:'arc'",
  "kind:'text'",
];

/** Full-field sample per branch (required-field probe: every key present). */
const itemSamples: LeafExportItem[] = [
  { kind: 'line', layer: 'l', x1: 0, y1: 0, x2: 1, y2: 1 },
  { kind: 'polyline', layer: 'l', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], close: true },
  { kind: 'rect', layer: 'l', x: 0, y: 0, width: 2, height: 3 },
  { kind: 'circle', layer: 'l', cx: 0, cy: 0, r: 1 },
  { kind: 'ellipse', layer: 'l', cx: 0, cy: 0, rx: 2, ry: 1, rotationDeg: 30 },
  { kind: 'arc', layer: 'l', cx: 0, cy: 0, r: 1, startDeg: 0, endDeg: 90 },
  { kind: 'text', layer: 'l', x: 0, y: 0, text: 'hi', heightMm: 2.5, anchor: 'middle', rotationDeg: 0 },
];

// ---------------------------------------------------------------------------

describe('STRUCT-195.8 leaf presence (Worker handoff)', () => {
  it('the ExportItem leaf exists before any shape assertion runs', () => {
    expect(fs.existsSync(abs(LEAF)), `leaf missing: ${LEAF}`).toBe(true);
  });

  it('the leaf declares exactly ExportBase + ExportItem', () => {
    const source = parseKnown(LEAF, 'leaf');
    const names = source.statements
      .filter((stmt): stmt is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
        (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))
        && (stmt.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false))
      .map((stmt) => stmt.name.text);
    expect(names).toEqual(['ExportBase', 'ExportItem']);
  });
});

describe('STRUCT-195.8 independent baseline pins: ExportBase + ExportItem', () => {
  it('matches the pre-refactor shape on the old path and the leaf (both directions)', () => {
    expectTypeOf<OldExportBase>().toEqualTypeOf<BaseExportBase>();
    expectTypeOf<BaseExportBase>().toEqualTypeOf<OldExportBase>();
    expectTypeOf<LeafExportBase>().toEqualTypeOf<BaseExportBase>();
    expectTypeOf<BaseExportBase>().toEqualTypeOf<LeafExportBase>();
    expectTypeOf<OldExportItem>().toEqualTypeOf<BaseExportItem>();
    expectTypeOf<BaseExportItem>().toEqualTypeOf<OldExportItem>();
    expectTypeOf<LeafExportItem>().toEqualTypeOf<BaseExportItem>();
    expectTypeOf<BaseExportItem>().toEqualTypeOf<LeafExportItem>();
  });

  it('keeps the old path and the leaf identical (both directions)', () => {
    expectTypeOf<OldExportBase>().toEqualTypeOf<LeafExportBase>();
    expectTypeOf<LeafExportBase>().toEqualTypeOf<OldExportBase>();
    expectTypeOf<OldExportItem>().toEqualTypeOf<LeafExportItem>();
    expectTypeOf<LeafExportItem>().toEqualTypeOf<OldExportItem>();
  });

  it('pins the exact ExportBase property list (a missing ? fails here)', () => {
    const leaf = parseKnown(LEAF, 'leaf');
    const actual = interfacePropShapes(leaf, 'ExportBase');
    expect(actual, 'ExportBase missing from leaf').not.toBeNull();
    expect(actual, 'ExportBase property drift').toEqual(EXPECTED_BASE_PROPS.map(norm));
  });

  it('pins the exact union branch order and member shapes', () => {
    const leaf = parseKnown(LEAF, 'leaf');
    const actual = unionMemberShapes(leaf, 'ExportItem');
    expect(actual, 'ExportItem missing from leaf').not.toBeNull();
    expect(actual, 'ExportItem branch drift').toEqual(EXPECTED_ITEM_MEMBERS.map(norm));
  });

  it('pins the exact keys per branch in declaration order', () => {
    const leaf = parseKnown(LEAF, 'leaf');
    const actual = unionBranchPropShapes(leaf, 'ExportItem');
    expect(actual, 'ExportItem branches unreadable').not.toBeNull();
    expect(actual, 'ExportItem key drift').toEqual(EXPECTED_BRANCH_PROPS.map((branch) => branch.map(norm)));
    expect(
      actual!.map((branch) => branch[0]),
      'branch kind order drift',
    ).toEqual(EXPECTED_BRANCH_KINDS.map(norm));
  });

  it('compiles one full-field sample per branch (required-field probe)', () => {
    expect(itemSamples.map((sample) => sample.kind)).toEqual([
      'line',
      'polyline',
      'rect',
      'circle',
      'ellipse',
      'arc',
      'text',
    ]);
    itemSamples.forEach((sample, index) => {
      expect(Object.keys(sample).sort()).toEqual(
        [...EXPECTED_BRANCH_PROPS[index]!.map((shape) => norm(shape).split(':')[0]!.replace(/\?$/, '')), 'layer'].sort(),
      );
    });
  });
});

describe('STRUCT-195.8 discriminant / optional probes', () => {
  it('pins kind literals, required layer, and optional base fields', () => {
    expectTypeOf<Extract<LeafExportItem, { kind: 'line' }>['kind']>().toEqualTypeOf<'line'>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'polyline' }>['kind']>().toEqualTypeOf<'polyline'>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'rect' }>['kind']>().toEqualTypeOf<'rect'>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'circle' }>['kind']>().toEqualTypeOf<'circle'>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'ellipse' }>['kind']>().toEqualTypeOf<'ellipse'>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'arc' }>['kind']>().toEqualTypeOf<'arc'>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'text' }>['kind']>().toEqualTypeOf<'text'>();
    // Required (not optional): a `layer?` rewrite widens this to `| undefined`.
    expectTypeOf<LeafExportBase['layer']>().toEqualTypeOf<string>();
    // Optional-without-null must not collapse to required or nullable.
    expectTypeOf<LeafExportBase['clipId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<LeafExportBase['widthMm']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<LeafExportBase['opacity']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'text' }>['anchor']>()
      .toEqualTypeOf<'start' | 'middle' | 'end' | undefined>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'text' }>['rotationDeg']>()
      .toEqualTypeOf<number | undefined>();
  });

  it('pins number fields and the nested polyline point-array shape', () => {
    expectTypeOf<Extract<LeafExportItem, { kind: 'line' }>['x1']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'circle' }>['r']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'ellipse' }>['rotationDeg']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'arc' }>['startDeg']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'text' }>['heightMm']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'polyline' }>['points']>()
      .toEqualTypeOf<Array<{ x: number; y: number }>>();
    expectTypeOf<Extract<LeafExportItem, { kind: 'polyline' }>['close']>().toEqualTypeOf<boolean>();
  });
});

describe('STRUCT-195.8 legacy ExportWarning path', () => {
  it('keeps the hub ExportWarning identical to exportResult (both directions)', () => {
    expectTypeOf<OldExportWarning>().toEqualTypeOf<ResultExportWarning>();
    expectTypeOf<ResultExportWarning>().toEqualTypeOf<OldExportWarning>();
    expectTypeOf<OldExportWarning['code']>().toEqualTypeOf<ResultExportWarning['code']>();
    expectTypeOf<OldExportWarning['entityId']>().toEqualTypeOf<string | undefined>();
  });

  it('keeps the hub re-exporting the legacy warning surface plus the leaf types', () => {
    const hub = requireSource(HUB, 'hub');
    expect(hub).toContain("export type { ExportBase, ExportItem } from './cadExportItemTypes'");
    expect(hub).toContain('ExportWarning');
    expect(hub).toContain('./exportResult');
  });
});

describe('STRUCT-195.8 leaf purity', () => {
  it('contains ZERO import statements (not even import type)', () => {
    const source = requireSource(LEAF, 'leaf');
    expect(importStatements(source, LEAF)).toEqual([]);
    expect(source).not.toMatch(/^\s*import[\s('"]/m);
  });

  it('exports no runtime values (type/interface surface only)', () => {
    const source = requireSource(LEAF, 'leaf');
    expect(valueExportProblems(source, LEAF)).toEqual([]);
  });
});

describe('STRUCT-195.8 consumer repoint', () => {
  it.each([...CONSUMERS])('%s imports ExportItem from the leaf, not the hub', (consumer) => {
    const source = requireSource(consumer, 'consumer');
    expect(source).toContain("from './cadExportItemTypes'");
    expect(source).not.toMatch(/import\s+type\s*\{[^}]*ExportItem[^}]*\}\s*from\s*['"]\.\/cadExportScene['"]/);
  });

  it('the hub imports ExportItem from the leaf for its own signatures', () => {
    const hub = requireSource(HUB, 'hub');
    expect(hub).toMatch(/import\s+type\s*\{[^}]*ExportItem[^}]*\}\s*from\s*['"]\.\/cadExportItemTypes['"]/);
  });
});

describe('STRUCT-195.8 cycle-break graph guard', () => {
  const workFiles = GRAPH_DIRS.flatMap((dir) => collectTypeScriptFiles(path.join(REPO_ROOT, dir)));
  const workGraph = buildGraphs(workFiles.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));

  it('no single TYPE component holds all five export modules', () => {
    const components = tarjanSCC(workGraph.nodes, workGraph.type);
    const host = components.find((component) => component.includes(abs(HUB)));
    expect(host, 'hub missing from graph').toBeDefined();
    const allFive = FIVE.every((member) => host!.includes(abs(member)));
    expect(allFive, `5-node cycle SCC still intact: ${host!.map(rel).sort().join(', ')}`).toBe(false);
  });

  it('each of the five export modules is a TYPE singleton', () => {
    const components = tarjanSCC(workGraph.nodes, workGraph.type);
    for (const member of FIVE) {
      const host = components.find((component) => component.includes(abs(member)));
      expect(host, `${member} missing from graph`).toBeDefined();
      expect(host, `${member} still shares a TYPE SCC: ${host!.map(rel).sort().join(', ')}`).toEqual([abs(member)]);
    }
  });

  it('the leaf has no path of any kind back to the hub or consumers', () => {
    const kindsBetween = (from: string, to: string): string[] =>
      workGraph.edges
        .filter((edge) => edge.from === abs(from) && edge.to === abs(to))
        .map((edge) => edge.kind);
    for (const target of FIVE) {
      expect(kindsBetween(LEAF, target)).toEqual([]);
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

describe('STRUCT-195.8 negative controls (mutated in-memory copies)', () => {
  it('control 1: a smuggled value import is flagged by the purity scan', () => {
    const clean = requireSource(LEAF, 'leaf');
    expect(importStatements(clean, LEAF)).toEqual([]);
    const withValueImport = `import { BROKEN_REFERENCE_TEXT } from './cadLabelEngine';\n${clean}`;
    expect(importStatements(withValueImport, LEAF)).toHaveLength(1);
    const withTypeImport = `import type { ExportWarning } from './exportResult';\n${clean}`;
    // Even a type-only import violates the zero-import leaf contract.
    expect(importStatements(withTypeImport, LEAF)).toHaveLength(1);
  });

  it('control 2: a smuggled runtime value export is flagged by the value scan', () => {
    const clean = requireSource(LEAF, 'leaf');
    expect(valueExportProblems(clean, LEAF)).toEqual([]);
    const withValue = `${clean}\nexport const EXPORT_KIND_ORDER = ['line'] as const;\n`;
    expect(valueExportProblems(withValue, LEAF)).not.toEqual([]);
    const withReexport = `${clean}\nexport { buildExportSheetScene } from './cadExportScene';\n`;
    expect(valueExportProblems(withReexport, LEAF)).not.toEqual([]);
  });

  it('control 3: a dropped ? is flagged by the property-shape pin', () => {
    const leaf = parseKnown(LEAF, 'leaf');
    expect(interfacePropShapes(leaf, 'ExportBase')).toEqual(EXPECTED_BASE_PROPS.map(norm));
    const mutated = requireSource(LEAF, 'leaf').replace('clipId?: string;', 'clipId: string;');
    expect(mutated).not.toBe(requireSource(LEAF, 'leaf'));
    expect(interfacePropShapes(parseSource(mutated, LEAF), 'ExportBase')).not.toEqual(
      EXPECTED_BASE_PROPS.map(norm),
    );
  });

  it('control 4: a swapped branch order is flagged by the union-order pin', () => {
    const leaf = parseKnown(LEAF, 'leaf');
    expect(exportItemBranchKinds(requireSource(LEAF, 'leaf'), LEAF)).toEqual(EXPECTED_BRANCH_KINDS.map(norm));
    expect(unionMemberShapes(leaf, 'ExportItem')).toEqual(EXPECTED_ITEM_MEMBERS.map(norm));
    // Swap the first two union members in an in-memory copy.
    const source = requireSource(LEAF, 'leaf');
    const lineBranch = "  | (ExportBase & { kind: 'line'; x1: number; y1: number; x2: number; y2: number })";
    const polyBranch = "  | (ExportBase & { kind: 'polyline'; points: Array<{ x: number; y: number }>; close: boolean })";
    expect(source).toContain(lineBranch);
    expect(source).toContain(polyBranch);
    const swapped = source.replace(lineBranch, '__LINE__').replace(polyBranch, lineBranch).replace('__LINE__', polyBranch);
    expect(exportItemBranchKinds(swapped, LEAF)).not.toEqual(EXPECTED_BRANCH_KINDS.map(norm));
    expect(unionMemberShapes(parseSource(swapped, LEAF), 'ExportItem')).not.toEqual(
      EXPECTED_ITEM_MEMBERS.map(norm),
    );
  });
});
