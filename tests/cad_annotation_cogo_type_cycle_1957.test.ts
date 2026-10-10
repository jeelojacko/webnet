/**
 * STRUCT-195.7 (Workstream C: tests + evidence) — annotation-anchor + COGO
 * record type leaves.
 *
 * Pins `src/engine/cad/annotation/cadAnnotationAnchorTypes.ts` (Worker A)
 * and `src/engine/cad/cadCogoRecordTypes.ts` (Worker B):
 *  - independent baseline-shape hand pins: the 9 anchor types and 8 COGO
 *    DTOs below (`Base*`) are hand-transcribed from the BASELINE source at
 *    ref `517de78af6b151d0cd6776ec768d21c2668ea8cf` (anchor interfaces from
 *    `src/engine/cad/annotation/cadAnnotationAnchors.ts`, COGO DTOs from
 *    `src/engine/cad/cadCogoTypes.ts`, via `git show <ref>:<path>`), and
 *    import NO type from either leaf under test, so leaf drift cannot move
 *    both sides of an assertion. Foreign referenced types (`CadEntityId`,
 *    `CadDisplayPoint`) are shared references, not part of the moved
 *    surface. Every `Base*` is compared against BOTH the old-path export
 *    and the new-leaf export via bidirectional `expectTypeOf` equality
 *    (typecheck-enforced);
 *  - complete AST field check: EVERY one of the 17 moved types has a
 *    whitespace-normalized `name[?]: type` (interfaces) or member-text
 *    (unions) pin read from the leaf source at test time, so
 *    optionality/nullability/readonly/literal drift fails `vitest` even
 *    without a typecheck gate. All 17 with full pins is NOT unwieldy here
 *    (13 small interfaces + 4 unions), so no representative-subset sampling
 *    is needed — coverage is exhaustive by construction;
 *  - explicit nullable/optional/readonly/discriminant probes (kind
 *    literals, endpoint/point unions, required fallbackX/Y, the
 *    `BROKEN_REFERENCE` reason, the COGO `(string & {})` escape hatch,
 *    report/table shapes);
 *  - old-path vs new-leaf export identity: every historical name is
 *    importable from both paths with identical shape; `CadProject` entity
 *    anchor fields (`arrowAnchor`, `anchors`, `defPoint1/2`) and
 *    `cogoComputations` accept the leaf structures;
 *  - AST pins: both leaves are type-only (zero value imports/exports);
 *    neither leaf imports `cadTypes` (nor re-imports its original module)
 *    and neither has a value/type path back to `cadTypes.ts` (via
 *    `scripts/cadTypeImportGraph.mjs`); `CadCogoResult` stays exported from
 *    `cadCogoTypes.ts` and is NOT re-declared in the leaf;
 *  - graph guard: the exact 4-node TYPE SCC
 *    [`annotation/cadAnnotationAnchors.ts`, `cadCogoTypes.ts`,
 *    `cadProjectLookup.ts`, `cadTypes.ts`] no longer exists as one
 *    component, the hub repoints its 2 type imports to the leaves, and the
 *    VALUE edge membership is byte-identical vs baseline (added/removed
 *    sets empty, not just equal counts).
 *
 * Defensive note: the two leaf modules are owned by Workers A/B and the hub
 * splice by the parent, and may not all have landed when this suite first
 * runs. The static `import type` lines below follow the FIXED interface
 * exactly, so the suite compiles once both leaves land; until then the
 * file-presence precondition reports the blocked status instead of failing
 * obscurely. Only `import type` bindings reference the leaves, so the
 * runtime suite still executes under esbuild (which erases type-only
 * imports). Hub-splice assertions (SCC split, hub repoint) assert the
 * POST-integration graph and stay red until the parent lands the
 * `cadTypes.ts` repoint — recorded honestly in
 * `docs/evidence/struct-1957/validation.md`, mirroring the 195.6 precedent.
 *
 * Uses only the TypeScript compiler API + the repo graph script (no new deps).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  buildGraphs,
  collectTypeScriptFiles,
  loadSourcesFromGit,
  reachableFrom,
  tarjanSCC,
} from '../scripts/cadTypeImportGraph.mjs';

import type { CadDimensionEntity, CadLeaderEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { CadEntityId } from '../src/engine/cad/cadCorePrimitiveTypes';
import type { CadDisplayPoint } from '../src/engine/cad/cadDisplayTypes';
import type {
  CadAnnotationAnchor as OldCadAnnotationAnchor,
  CadAnnotationAnchorPoint as OldCadAnnotationAnchorPoint,
  CadAnnotationAnchorRef as OldCadAnnotationAnchorRef,
  CadAnnotationAnchorResolution as OldCadAnnotationAnchorResolution,
  CadAnnotationArcPointAnchor as OldCadAnnotationArcPointAnchor,
  CadAnnotationBlockInsertionAnchor as OldCadAnnotationBlockInsertionAnchor,
  CadAnnotationFixedAnchor as OldCadAnnotationFixedAnchor,
  CadAnnotationLineEndpointAnchor as OldCadAnnotationLineEndpointAnchor,
  CadAnnotationSurveyPointAnchor as OldCadAnnotationSurveyPointAnchor,
} from '../src/engine/cad/annotation/cadAnnotationAnchors';
import type {
  CadAnnotationAnchor as LeafCadAnnotationAnchor,
  CadAnnotationAnchorPoint as LeafCadAnnotationAnchorPoint,
  CadAnnotationAnchorRef as LeafCadAnnotationAnchorRef,
  CadAnnotationAnchorResolution as LeafCadAnnotationAnchorResolution,
  CadAnnotationArcPointAnchor as LeafCadAnnotationArcPointAnchor,
  CadAnnotationBlockInsertionAnchor as LeafCadAnnotationBlockInsertionAnchor,
  CadAnnotationFixedAnchor as LeafCadAnnotationFixedAnchor,
  CadAnnotationLineEndpointAnchor as LeafCadAnnotationLineEndpointAnchor,
  CadAnnotationSurveyPointAnchor as LeafCadAnnotationSurveyPointAnchor,
} from '../src/engine/cad/annotation/cadAnnotationAnchorTypes';
import type {
  CadCogoAlternative as OldCadCogoAlternative,
  CadCogoComputation as OldCadCogoComputation,
  CadCogoProvenance as OldCadCogoProvenance,
  CadCogoReport as OldCadCogoReport,
  CadCogoReportRow as OldCadCogoReportRow,
  CadCogoReportTable as OldCadCogoReportTable,
  CadCogoResult as OldCadCogoResult,
  CadCogoToolKey as OldCadCogoToolKey,
  CadCogoWarning as OldCadCogoWarning,
} from '../src/engine/cad/cadCogoTypes';
import type {
  CadCogoAlternative as LeafCadCogoAlternative,
  CadCogoComputation as LeafCadCogoComputation,
  CadCogoProvenance as LeafCadCogoProvenance,
  CadCogoReport as LeafCadCogoReport,
  CadCogoReportRow as LeafCadCogoReportRow,
  CadCogoReportTable as LeafCadCogoReportTable,
  CadCogoToolKey as LeafCadCogoToolKey,
  CadCogoWarning as LeafCadCogoWarning,
} from '../src/engine/cad/cadCogoRecordTypes';

const BASELINE_REF = '517de78af6b151d0cd6776ec768d21c2668ea8cf';
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative);
const rel = (absolute: string): string => path.relative(REPO_ROOT, absolute);

const OLD_ANCHORS = 'src/engine/cad/annotation/cadAnnotationAnchors.ts';
const LEAF_ANCHORS = 'src/engine/cad/annotation/cadAnnotationAnchorTypes.ts';
const OLD_COGO = 'src/engine/cad/cadCogoTypes.ts';
const LEAF_COGO = 'src/engine/cad/cadCogoRecordTypes.ts';
const HUB = 'src/engine/cad/cadTypes.ts';
const LOOKUP = 'src/engine/cad/cadProjectLookup.ts';
const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish'];

/** Throw a clear blocked-status error when a Worker A/B leaf has not landed yet. */
const requireSource = (file: string, label: string): string => {
  const absolute = abs(file);
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `STRUCT-195.7 blocked: ${label} not present yet at ${file} `
      + '(owned by Workers A/B; suite compiles green once both leaves land)',
    );
  }
  return fs.readFileSync(absolute, 'utf8');
};

const parseKnown = (file: string, label: string): ts.SourceFile =>
  ts.createSourceFile(abs(file), requireSource(file, label), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Module specifiers reached by a runtime (non-`import type`) edge. */
const runtimeImportSpecifiers = (file: string, label: string): string[] => {
  const out: string[] = [];
  for (const stmt of parseKnown(file, label).statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (!clause) {
      out.push(stmt.moduleSpecifier.text);
      continue;
    }
    if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings) && bindings.elements.every((el) => el.isTypeOnly)) continue;
    out.push(stmt.moduleSpecifier.text);
  }
  return out;
};

/** Import specifiers (any kind) for the file, in source order. */
const allImportSpecifiers = (file: string, label: string): string[] =>
  parseKnown(file, label).statements
    .filter((stmt): stmt is ts.ImportDeclaration =>
      ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

/** Every import declaration must be type-only (`import type` or type-only bindings). */
const hasOnlyTypeImports = (file: string, label: string): boolean => {
  for (const stmt of parseKnown(file, label).statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (stmt.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (stmt.importClause?.name) return false;
    if (bindings && ts.isNamespaceImport(bindings)) return false;
    if (bindings && ts.isNamedImports(bindings) && bindings.elements.every((el) => el.isTypeOnly)) continue;
    return false;
  }
  return true;
};

/** Non-type statement kinds (value declarations leak a runtime export surface). */
const valueStatementKinds = (file: string, label: string): string[] =>
  parseKnown(file, label).statements
    .filter((stmt) =>
      ts.isFunctionDeclaration(stmt)
      || ts.isVariableStatement(stmt)
      || ts.isClassDeclaration(stmt)
      || ts.isEnumDeclaration(stmt))
    .map((stmt) => ts.SyntaxKind[stmt.kind]);

/** Exported top-level type/interface alias names, in declaration order. */
const exportedTypeNames = (file: string, label: string): string[] =>
  parseKnown(file, label).statements
    .filter((stmt): stmt is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))
      && (stmt.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) ?? false))
    .map((stmt) => stmt.name.text);

/** Collapse all whitespace so formatting drift cannot mask (or fake) type drift. */
const norm = (text: string): string => text.replace(/\s+/g, '');

/**
 * Whitespace-normalized `name[?]: type` strings of an interface (or a
 * single-object type alias) in declaration order. Returns null when absent.
 */
const interfacePropShapes = (file: string, label: string, typeName: string): string[] | null => {
  const decl = parseKnown(file, label).statements.find(
    (stmt): stmt is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name.text === typeName,
  );
  if (!decl) return null;
  const members = ts.isInterfaceDeclaration(decl)
    ? [...decl.members]
    : ts.isTypeLiteralNode(decl.type) ? [...decl.type.members] : null;
  if (!members) return null;
  return members
    .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
    .map((m) => norm(`${m.name.getText()}${m.questionToken ? '?' : ''}: ${m.type?.getText() ?? 'never'}`));
};

/**
 * Whitespace-normalized member texts of a union type alias, in order.
 * Returns null when the alias is absent or not a union.
 */
const unionMemberShapes = (file: string, label: string, aliasName: string): string[] | null => {
  const decl = parseKnown(file, label).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === aliasName,
  );
  if (!decl || !ts.isUnionTypeNode(decl.type)) return null;
  return decl.type.types.map((member) => norm(member.getText()));
};

// ---------------------------------------------------------------------------
// Independent baseline pins (STRUCT-195.7).
//
// Hand-transcribed from the pre-refactor baseline at
// 517de78af6b151d0cd6776ec768d21c2668ea8cf (`git show <ref>:<path>`):
// anchor shapes from annotation/cadAnnotationAnchors.ts, COGO DTOs from
// cadCogoTypes.ts. They import no leaf type, so leaf drift cannot move both
// sides of an assertion. CadEntityId / CadDisplayPoint are shared
// references, not part of the moved surface.
// ---------------------------------------------------------------------------

type BaseFixedAnchor = {
  kind: 'fixed';
  x: number;
  y: number;
};

type BaseSurveyPointAnchor = {
  kind: 'survey-point';
  entityId: CadEntityId;
  fallbackX: number;
  fallbackY: number;
};

type BaseLineEndpointAnchor = {
  kind: 'line-endpoint';
  entityId: CadEntityId;
  endpoint: 'start' | 'end';
  fallbackX: number;
  fallbackY: number;
};

type BaseArcPointAnchor = {
  kind: 'arc-point';
  entityId: CadEntityId;
  point: 'center' | 'start' | 'end';
  fallbackX: number;
  fallbackY: number;
};

type BaseBlockInsertionAnchor = {
  kind: 'block-insertion';
  entityId: CadEntityId;
  fallbackX: number;
  fallbackY: number;
};

type BaseAnchorRef =
  | BaseSurveyPointAnchor
  | BaseLineEndpointAnchor
  | BaseArcPointAnchor
  | BaseBlockInsertionAnchor;

type BaseAnchor = BaseFixedAnchor | BaseAnchorRef;

type BaseAnchorPoint = {
  x: number;
  y: number;
};

type BaseAnchorResolution =
  | { ok: true; x: number; y: number }
  | { ok: false; fallbackX: number; fallbackY: number; reason: 'BROKEN_REFERENCE' };

type BaseCogoToolKey =
  | 'INVERSE'
  | 'MULTI_INVERSE'
  | 'AREA'
  | 'PARCEL_CHECK'
  | 'PARCEL_GAP'
  | 'PARCEL_OVERLAP'
  | 'PARCEL_SPLIT'
  | 'PARCEL_SPLIT_BEARING'
  | 'PARCEL_SPLIT_AREA'
  | 'PARCEL_SPLIT_SLIDE'
  | 'PARCEL_SPLIT_SWING'
  | 'PARCEL_LAYOUT_AUTO'
  | 'COGO_POINT'
  | 'INTERSECT_POINT'
  | 'CURVE_CALCULATOR'
  | 'ARC_CREATE'
  | 'TANGENT_CURVE'
  | 'TRAVERSE'
  | 'PARCEL_CREATE'
  | 'OFFSET'
  | 'ALIGNMENT'
  | (string & {});

type BaseCogoReportRow = {
  label: string;
  value: string;
  unit?: string;
};

type BaseCogoReportTable = {
  title: string;
  columns: string[];
  rows: string[][];
};

type BaseCogoReport = {
  title: string;
  summary: string;
  rows: BaseCogoReportRow[];
  tables?: BaseCogoReportTable[];
};

type BaseCogoWarning = {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
};

type BaseCogoAlternative = {
  id: string;
  label: string;
  point?: CadDisplayPoint;
  report?: BaseCogoReport;
};

type BaseCogoProvenance = {
  id: string;
  toolKey: BaseCogoToolKey;
  inputs: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  sourceEntityIds?: CadEntityId[];
  sourcePointIds?: string[];
  resultSummary: string;
  createdAtIso?: string;
};

type BaseCogoComputation = {
  id: string;
  toolKey: BaseCogoToolKey;
  createdAtIso?: string;
  provenance: BaseCogoProvenance;
  report: BaseCogoReport;
  warnings: BaseCogoWarning[];
  alternatives?: BaseCogoAlternative[];
  createdEntityIds: CadEntityId[];
  updatedEntityIds: CadEntityId[];
  removedEntityIds: CadEntityId[];
};

/** Leaf export surface: exactly the 9 moved anchor names, no more, no less. */
const EXPECTED_ANCHOR_EXPORTS = [
  'CadAnnotationFixedAnchor',
  'CadAnnotationSurveyPointAnchor',
  'CadAnnotationLineEndpointAnchor',
  'CadAnnotationArcPointAnchor',
  'CadAnnotationBlockInsertionAnchor',
  'CadAnnotationAnchorRef',
  'CadAnnotationAnchor',
  'CadAnnotationAnchorPoint',
  'CadAnnotationAnchorResolution',
];

/** Leaf export surface: exactly the 8 moved COGO DTOs (`CadCogoResult` stays behind). */
const EXPECTED_COGO_EXPORTS = [
  'CadCogoToolKey',
  'CadCogoReportRow',
  'CadCogoReportTable',
  'CadCogoReport',
  'CadCogoWarning',
  'CadCogoAlternative',
  'CadCogoProvenance',
  'CadCogoComputation',
];

/**
 * Hand-transcribed per-interface property shapes (from the baseline files).
 * Compared at runtime against the leaf source AST, so drift in
 * optionality (`?`), nullability (`| null`), literal values, union members,
 * or omitted/added fields fails `vitest` directly. Both sides are
 * whitespace-normalized before comparison; comments are AST trivia and never
 * participate.
 */
const EXPECTED_ANCHOR_INTERFACE_SHAPES: Record<string, string[]> = {
  CadAnnotationFixedAnchor: ["kind: 'fixed'", 'x: number', 'y: number'],
  CadAnnotationSurveyPointAnchor: [
    "kind: 'survey-point'",
    'entityId: CadEntityId',
    'fallbackX: number',
    'fallbackY: number',
  ],
  CadAnnotationLineEndpointAnchor: [
    "kind: 'line-endpoint'",
    'entityId: CadEntityId',
    "endpoint: 'start' | 'end'",
    'fallbackX: number',
    'fallbackY: number',
  ],
  CadAnnotationArcPointAnchor: [
    "kind: 'arc-point'",
    'entityId: CadEntityId',
    "point: 'center' | 'start' | 'end'",
    'fallbackX: number',
    'fallbackY: number',
  ],
  CadAnnotationBlockInsertionAnchor: [
    "kind: 'block-insertion'",
    'entityId: CadEntityId',
    'fallbackX: number',
    'fallbackY: number',
  ],
  CadAnnotationAnchorPoint: ['x: number', 'y: number'],
};

const EXPECTED_ANCHOR_UNION_SHAPES: Record<string, string[]> = {
  CadAnnotationAnchorRef: [
    'CadAnnotationSurveyPointAnchor',
    'CadAnnotationLineEndpointAnchor',
    'CadAnnotationArcPointAnchor',
    'CadAnnotationBlockInsertionAnchor',
  ],
  CadAnnotationAnchor: ['CadAnnotationFixedAnchor', 'CadAnnotationAnchorRef'],
  CadAnnotationAnchorResolution: [
    '{ok:true;x:number;y:number}',
    "{ok:false;fallbackX:number;fallbackY:number;reason:'BROKEN_REFERENCE'}",
  ],
};

const EXPECTED_COGO_INTERFACE_SHAPES: Record<string, string[]> = {
  CadCogoReportRow: ['label: string', 'value: string', 'unit?: string'],
  CadCogoReportTable: ['title: string', 'columns: string[]', 'rows: string[][]'],
  CadCogoReport: [
    'title: string',
    'summary: string',
    'rows: CadCogoReportRow[]',
    'tables?: CadCogoReportTable[]',
  ],
  CadCogoWarning: ['code: string', 'message: string', "severity: 'info' | 'warning' | 'error'"],
  CadCogoAlternative: ['id: string', 'label: string', 'point?: CadDisplayPoint', 'report?: CadCogoReport'],
  CadCogoProvenance: [
    'id: string',
    'toolKey: CadCogoToolKey',
    'inputs: Record<string,unknown>',
    'parameters?: Record<string,unknown>',
    'sourceEntityIds?: CadEntityId[]',
    'sourcePointIds?: string[]',
    'resultSummary: string',
    'createdAtIso?: string',
  ],
  CadCogoComputation: [
    'id: string',
    'toolKey: CadCogoToolKey',
    'createdAtIso?: string',
    'provenance: CadCogoProvenance',
    'report: CadCogoReport',
    'warnings: CadCogoWarning[]',
    'alternatives?: CadCogoAlternative[]',
    'createdEntityIds: CadEntityId[]',
    'updatedEntityIds: CadEntityId[]',
    'removedEntityIds: CadEntityId[]',
  ],
};

const EXPECTED_COGO_TOOL_KEY_SHAPES = [
  "'INVERSE'",
  "'MULTI_INVERSE'",
  "'AREA'",
  "'PARCEL_CHECK'",
  "'PARCEL_GAP'",
  "'PARCEL_OVERLAP'",
  "'PARCEL_SPLIT'",
  "'PARCEL_SPLIT_BEARING'",
  "'PARCEL_SPLIT_AREA'",
  "'PARCEL_SPLIT_SLIDE'",
  "'PARCEL_SPLIT_SWING'",
  "'PARCEL_LAYOUT_AUTO'",
  "'COGO_POINT'",
  "'INTERSECT_POINT'",
  "'CURVE_CALCULATOR'",
  "'ARC_CREATE'",
  "'TANGENT_CURVE'",
  "'TRAVERSE'",
  "'PARCEL_CREATE'",
  "'OFFSET'",
  "'ALIGNMENT'",
  '(string&{})',
];

/** Top-level field names derived from the transcribed shapes (sample key pins). */
const expectedFieldNames = (shapes: string[]): string[] =>
  shapes.map((shape) => norm(shape).split(':')[0]!.replace(/\?$/, ''));

// Full-field samples: every declared field present, so leaf drift (dropped
// optional, added required, renamed field) breaks either the annotation
// (typecheck) or the runtime key assertion below.
const anchorSamples: LeafCadAnnotationAnchor[] = [
  { kind: 'fixed', x: 1, y: 2 },
  { kind: 'survey-point', entityId: 'sp-1', fallbackX: 1, fallbackY: 2 },
  { kind: 'line-endpoint', entityId: 'ln-1', endpoint: 'end', fallbackX: 1, fallbackY: 2 },
  { kind: 'arc-point', entityId: 'arc-1', point: 'center', fallbackX: 1, fallbackY: 2 },
  { kind: 'block-insertion', entityId: 'blk-1', fallbackX: 1, fallbackY: 2 },
];

const resolutionSamples: LeafCadAnnotationAnchorResolution[] = [
  { ok: true, x: 1, y: 2 },
  { ok: false, fallbackX: 1, fallbackY: 2, reason: 'BROKEN_REFERENCE' },
];

const cogoReportSample: LeafCadCogoReport = {
  title: 'report',
  summary: 'summary',
  rows: [{ label: 'distance', value: '12.5', unit: 'm' }],
  tables: [{ title: 'courses', columns: ['a', 'b'], rows: [['1', '2']] }],
};

const cogoComputationSample: LeafCadCogoComputation = {
  id: 'cogo-1',
  toolKey: 'INVERSE',
  createdAtIso: '2026-01-01T00:00:00.000Z',
  provenance: {
    id: 'cogo-1',
    toolKey: 'INVERSE',
    inputs: { from: 'A' },
    parameters: { tol: 1 },
    sourceEntityIds: ['ln-1'],
    sourcePointIds: ['sp-1'],
    resultSummary: 'ok',
    createdAtIso: '2026-01-01T00:00:00.000Z',
  },
  report: cogoReportSample,
  warnings: [{ code: 'W1', message: 'note', severity: 'warning' }],
  alternatives: [{ id: 'alt-1', label: 'alt', point: { x: 1, y: 2 }, report: cogoReportSample }],
  createdEntityIds: ['e-1'],
  updatedEntityIds: ['e-2'],
  removedEntityIds: ['e-3'],
};

// Compile-time entity/project compatibility (enforced by project typecheck):
// the hub entity fields accept the leaf structures with no conversion.
const anchorToLeaderArrow = (anchor: LeafCadAnnotationAnchor): CadLeaderEntity['arrowAnchor'] => anchor;
const anchorToDimensionSlot = (anchor: LeafCadAnnotationAnchor): CadDimensionEntity['anchors'][number] => anchor;
const computationsToProject = (
  computations: LeafCadCogoComputation[],
): CadProject['cogoComputations'] => computations;

// ---------------------------------------------------------------------------

describe('STRUCT-195.7 leaf presence (Workers A/B handoff)', () => {
  it('both anchor + COGO leaves exist before any shape assertion runs', () => {
    for (const [label, file] of [
      ['anchor leaf', LEAF_ANCHORS],
      ['COGO leaf', LEAF_COGO],
    ] as const) {
      expect(fs.existsSync(abs(file)), `${label} missing: ${file}`).toBe(true);
    }
  });

  it('each leaf exports exactly its moved names (no more, no less)', () => {
    expect(exportedTypeNames(LEAF_ANCHORS, 'anchor leaf')).toEqual(EXPECTED_ANCHOR_EXPORTS);
    expect(exportedTypeNames(LEAF_COGO, 'COGO leaf')).toEqual(EXPECTED_COGO_EXPORTS);
  });
});

describe('STRUCT-195.7 independent baseline pins: anchor interfaces', () => {
  it('matches the pre-refactor shape for all 6 anchor interfaces (old path and leaf)', () => {
    expectTypeOf<OldCadAnnotationFixedAnchor>().toEqualTypeOf<BaseFixedAnchor>();
    expectTypeOf<LeafCadAnnotationFixedAnchor>().toEqualTypeOf<BaseFixedAnchor>();
    expectTypeOf<OldCadAnnotationSurveyPointAnchor>().toEqualTypeOf<BaseSurveyPointAnchor>();
    expectTypeOf<LeafCadAnnotationSurveyPointAnchor>().toEqualTypeOf<BaseSurveyPointAnchor>();
    expectTypeOf<OldCadAnnotationLineEndpointAnchor>().toEqualTypeOf<BaseLineEndpointAnchor>();
    expectTypeOf<LeafCadAnnotationLineEndpointAnchor>().toEqualTypeOf<BaseLineEndpointAnchor>();
    expectTypeOf<OldCadAnnotationArcPointAnchor>().toEqualTypeOf<BaseArcPointAnchor>();
    expectTypeOf<LeafCadAnnotationArcPointAnchor>().toEqualTypeOf<BaseArcPointAnchor>();
    expectTypeOf<OldCadAnnotationBlockInsertionAnchor>().toEqualTypeOf<BaseBlockInsertionAnchor>();
    expectTypeOf<LeafCadAnnotationBlockInsertionAnchor>().toEqualTypeOf<BaseBlockInsertionAnchor>();
    expectTypeOf<OldCadAnnotationAnchorPoint>().toEqualTypeOf<BaseAnchorPoint>();
    expectTypeOf<LeafCadAnnotationAnchorPoint>().toEqualTypeOf<BaseAnchorPoint>();
  });

  it('matches the pre-refactor shape for the anchor aliases (old path and leaf)', () => {
    expectTypeOf<OldCadAnnotationAnchorRef>().toEqualTypeOf<BaseAnchorRef>();
    expectTypeOf<LeafCadAnnotationAnchorRef>().toEqualTypeOf<BaseAnchorRef>();
    expectTypeOf<OldCadAnnotationAnchor>().toEqualTypeOf<BaseAnchor>();
    expectTypeOf<LeafCadAnnotationAnchor>().toEqualTypeOf<BaseAnchor>();
    expectTypeOf<OldCadAnnotationAnchorResolution>().toEqualTypeOf<BaseAnchorResolution>();
    expectTypeOf<LeafCadAnnotationAnchorResolution>().toEqualTypeOf<BaseAnchorResolution>();
  });

  it('matches the transcribed runtime property shapes for every anchor type', () => {
    for (const [name, shapes] of Object.entries(EXPECTED_ANCHOR_INTERFACE_SHAPES)) {
      const actual = interfacePropShapes(LEAF_ANCHORS, 'anchor leaf', name);
      expect(actual, `${name} missing from anchor leaf`).not.toBeNull();
      expect(actual, `${name} property drift`).toEqual(shapes.map(norm));
    }
    for (const [name, shapes] of Object.entries(EXPECTED_ANCHOR_UNION_SHAPES)) {
      const actual = unionMemberShapes(LEAF_ANCHORS, 'anchor leaf', name);
      expect(actual, `${name} missing from anchor leaf`).not.toBeNull();
      expect(actual, `${name} member drift`).toEqual(shapes.map(norm));
    }
  });

  it('compiles one full-field sample per concrete anchor kind (required-field probe)', () => {
    expect(anchorSamples.map((sample) => sample.kind)).toEqual([
      'fixed',
      'survey-point',
      'line-endpoint',
      'arc-point',
      'block-insertion',
    ]);
    expect(anchorToLeaderArrow(anchorSamples[0]!)).toBe(anchorSamples[0]);
    expect(anchorToDimensionSlot(anchorSamples[2]!)).toBe(anchorSamples[2]);
  });

  it('samples carry every declared field at runtime (no omitted/extra field)', () => {
    const shapeByKind: Record<string, string[]> = {
      fixed: EXPECTED_ANCHOR_INTERFACE_SHAPES['CadAnnotationFixedAnchor']!,
      'survey-point': EXPECTED_ANCHOR_INTERFACE_SHAPES['CadAnnotationSurveyPointAnchor']!,
      'line-endpoint': EXPECTED_ANCHOR_INTERFACE_SHAPES['CadAnnotationLineEndpointAnchor']!,
      'arc-point': EXPECTED_ANCHOR_INTERFACE_SHAPES['CadAnnotationArcPointAnchor']!,
      'block-insertion': EXPECTED_ANCHOR_INTERFACE_SHAPES['CadAnnotationBlockInsertionAnchor']!,
    };
    for (const sample of anchorSamples) {
      expect(Object.keys(sample).sort())
        .toEqual([...expectedFieldNames(shapeByKind[sample.kind]!)].sort());
    }
    for (const sample of resolutionSamples) {
      const shapes = sample.ok
        ? ['ok: boolean', 'x: number', 'y: number']
        : ['ok: boolean', 'fallbackX: number', 'fallbackY: number', "reason: 'BROKEN_REFERENCE'"];
      expect(Object.keys(sample).sort()).toEqual([...expectedFieldNames(shapes)].sort());
    }
  });
});

describe('STRUCT-195.7 independent baseline pins: COGO DTOs', () => {
  it('matches the pre-refactor shape for all 7 moved COGO interfaces (old path and leaf)', () => {
    expectTypeOf<OldCadCogoReportRow>().toEqualTypeOf<BaseCogoReportRow>();
    expectTypeOf<LeafCadCogoReportRow>().toEqualTypeOf<BaseCogoReportRow>();
    expectTypeOf<OldCadCogoReportTable>().toEqualTypeOf<BaseCogoReportTable>();
    expectTypeOf<LeafCadCogoReportTable>().toEqualTypeOf<BaseCogoReportTable>();
    expectTypeOf<OldCadCogoReport>().toEqualTypeOf<BaseCogoReport>();
    expectTypeOf<LeafCadCogoReport>().toEqualTypeOf<BaseCogoReport>();
    expectTypeOf<OldCadCogoWarning>().toEqualTypeOf<BaseCogoWarning>();
    expectTypeOf<LeafCadCogoWarning>().toEqualTypeOf<BaseCogoWarning>();
    expectTypeOf<OldCadCogoAlternative>().toEqualTypeOf<BaseCogoAlternative>();
    expectTypeOf<LeafCadCogoAlternative>().toEqualTypeOf<BaseCogoAlternative>();
    expectTypeOf<OldCadCogoProvenance>().toEqualTypeOf<BaseCogoProvenance>();
    expectTypeOf<LeafCadCogoProvenance>().toEqualTypeOf<BaseCogoProvenance>();
    expectTypeOf<OldCadCogoComputation>().toEqualTypeOf<BaseCogoComputation>();
    expectTypeOf<LeafCadCogoComputation>().toEqualTypeOf<BaseCogoComputation>();
  });

  it('matches the pre-refactor tool-key union and keeps CadCogoResult composing the leaf DTOs', () => {
    expectTypeOf<OldCadCogoToolKey>().toEqualTypeOf<BaseCogoToolKey>();
    expectTypeOf<LeafCadCogoToolKey>().toEqualTypeOf<BaseCogoToolKey>();
    // CadCogoResult stays in cadCogoTypes.ts and now composes the leaf DTOs.
    expectTypeOf<OldCadCogoResult['report']>().toEqualTypeOf<LeafCadCogoReport>();
    expectTypeOf<OldCadCogoResult['warnings']>().toEqualTypeOf<LeafCadCogoWarning[]>();
    expectTypeOf<OldCadCogoResult['provenance']>().toEqualTypeOf<LeafCadCogoProvenance>();
    expectTypeOf<OldCadCogoResult['alternatives']>().toEqualTypeOf<LeafCadCogoAlternative[] | undefined>();
  });

  it('matches the transcribed runtime property shapes for every COGO DTO', () => {
    for (const [name, shapes] of Object.entries(EXPECTED_COGO_INTERFACE_SHAPES)) {
      const actual = interfacePropShapes(LEAF_COGO, 'COGO leaf', name);
      expect(actual, `${name} missing from COGO leaf`).not.toBeNull();
      expect(actual, `${name} property drift`).toEqual(shapes.map(norm));
    }
    const toolKey = unionMemberShapes(LEAF_COGO, 'COGO leaf', 'CadCogoToolKey');
    expect(toolKey, 'CadCogoToolKey missing from COGO leaf').not.toBeNull();
    expect(toolKey, 'CadCogoToolKey member drift').toEqual(EXPECTED_COGO_TOOL_KEY_SHAPES.map(norm));
  });

  it('compiles full-field COGO samples accepted as project computations (required-field probe)', () => {
    expect(computationsToProject([cogoComputationSample])).toEqual([cogoComputationSample]);
    expect(Object.keys(cogoComputationSample).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_COGO_INTERFACE_SHAPES['CadCogoComputation']!)].sort(),
    );
    expect(Object.keys(cogoComputationSample.provenance).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_COGO_INTERFACE_SHAPES['CadCogoProvenance']!)].sort(),
    );
    expect(Object.keys(cogoReportSample).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_COGO_INTERFACE_SHAPES['CadCogoReport']!)].sort(),
    );
  });
});

describe('STRUCT-195.7 discriminant / nullable / optional probes', () => {
  it('pins anchor kind literals, endpoint/point unions, and required fallbacks', () => {
    expectTypeOf<LeafCadAnnotationFixedAnchor['kind']>().toEqualTypeOf<'fixed'>();
    expectTypeOf<LeafCadAnnotationSurveyPointAnchor['kind']>().toEqualTypeOf<'survey-point'>();
    expectTypeOf<LeafCadAnnotationLineEndpointAnchor['kind']>().toEqualTypeOf<'line-endpoint'>();
    expectTypeOf<LeafCadAnnotationArcPointAnchor['kind']>().toEqualTypeOf<'arc-point'>();
    expectTypeOf<LeafCadAnnotationBlockInsertionAnchor['kind']>().toEqualTypeOf<'block-insertion'>();
    expectTypeOf<Extract<LeafCadAnnotationAnchor, { kind: 'line-endpoint' }>['endpoint']>()
      .toEqualTypeOf<'start' | 'end'>();
    expectTypeOf<Extract<LeafCadAnnotationAnchor, { kind: 'arc-point' }>['point']>()
      .toEqualTypeOf<'center' | 'start' | 'end'>();
    // Required (not optional): an `X?` rewrite widens these to `| undefined`.
    expectTypeOf<LeafCadAnnotationSurveyPointAnchor['fallbackX']>().toEqualTypeOf<number>();
    expectTypeOf<LeafCadAnnotationSurveyPointAnchor['fallbackY']>().toEqualTypeOf<number>();
    expectTypeOf<LeafCadAnnotationFixedAnchor['x']>().toEqualTypeOf<number>();
    // AnchorRef excludes the fixed kind; the full anchor includes it.
    expectTypeOf<Extract<LeafCadAnnotationAnchorRef, { kind: 'fixed' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<LeafCadAnnotationAnchor, { kind: 'fixed' }>>()
      .toEqualTypeOf<LeafCadAnnotationFixedAnchor>();
    // Resolution branches: ok carries x/y, broken carries fallbacks + reason.
    expectTypeOf<Extract<LeafCadAnnotationAnchorResolution, { ok: true }>['x']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<LeafCadAnnotationAnchorResolution, { ok: false }>['reason']>()
      .toEqualTypeOf<'BROKEN_REFERENCE'>();
    expectTypeOf<Extract<LeafCadAnnotationAnchorResolution, { ok: false }>['fallbackX']>()
      .toEqualTypeOf<number>();
  });

  it('pins COGO optionality, severity, report/table shapes, and the tool-key escape hatch', () => {
    // Optional-without-null must not collapse to required or nullable.
    expectTypeOf<LeafCadCogoReportRow['unit']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<LeafCadCogoReport['tables']>().toEqualTypeOf<LeafCadCogoReportTable[] | undefined>();
    expectTypeOf<LeafCadCogoAlternative['point']>().toEqualTypeOf<CadDisplayPoint | undefined>();
    expectTypeOf<LeafCadCogoAlternative['report']>().toEqualTypeOf<LeafCadCogoReport | undefined>();
    expectTypeOf<LeafCadCogoProvenance['parameters']>().toEqualTypeOf<Record<string, unknown> | undefined>();
    expectTypeOf<LeafCadCogoProvenance['sourceEntityIds']>().toEqualTypeOf<CadEntityId[] | undefined>();
    expectTypeOf<LeafCadCogoComputation['alternatives']>().toEqualTypeOf<LeafCadCogoAlternative[] | undefined>();
    expectTypeOf<LeafCadCogoComputation['createdAtIso']>().toEqualTypeOf<string | undefined>();
    // Required collections stay required.
    expectTypeOf<LeafCadCogoReport['rows']>().toEqualTypeOf<LeafCadCogoReportRow[]>();
    expectTypeOf<LeafCadCogoComputation['createdEntityIds']>().toEqualTypeOf<CadEntityId[]>();
    expectTypeOf<LeafCadCogoProvenance['inputs']>().toEqualTypeOf<Record<string, unknown>>();
    // Literal + structural shapes.
    expectTypeOf<LeafCadCogoWarning['severity']>().toEqualTypeOf<'info' | 'warning' | 'error'>();
    expectTypeOf<LeafCadCogoReportTable['columns']>().toEqualTypeOf<string[]>();
    expectTypeOf<LeafCadCogoReportTable['rows']>().toEqualTypeOf<string[][]>();
    // `(string & {})` escape hatch: any string is a valid tool key (future
    // tools), but non-strings are not (assignability probes, typecheck-gated).
    const acceptToolKey = (key: LeafCadCogoToolKey): LeafCadCogoToolKey => key;
    const futureTool: string = 'SOME_FUTURE_TOOL';
    expect(acceptToolKey('INVERSE')).toBe('INVERSE');
    expect(acceptToolKey(futureTool)).toBe(futureTool);
    const backToString: string = acceptToolKey('INVERSE');
    expect(backToString).toBe('INVERSE');
    // @ts-expect-error a number is never a valid tool key.
    acceptToolKey(42);
  });
});

describe('STRUCT-195.7 old-path vs new-leaf export identity', () => {
  it('keeps all 9 anchor names identical across both paths', () => {
    expectTypeOf<OldCadAnnotationFixedAnchor>().toEqualTypeOf<LeafCadAnnotationFixedAnchor>();
    expectTypeOf<OldCadAnnotationSurveyPointAnchor>().toEqualTypeOf<LeafCadAnnotationSurveyPointAnchor>();
    expectTypeOf<OldCadAnnotationLineEndpointAnchor>().toEqualTypeOf<LeafCadAnnotationLineEndpointAnchor>();
    expectTypeOf<OldCadAnnotationArcPointAnchor>().toEqualTypeOf<LeafCadAnnotationArcPointAnchor>();
    expectTypeOf<OldCadAnnotationBlockInsertionAnchor>().toEqualTypeOf<LeafCadAnnotationBlockInsertionAnchor>();
    expectTypeOf<OldCadAnnotationAnchorRef>().toEqualTypeOf<LeafCadAnnotationAnchorRef>();
    expectTypeOf<OldCadAnnotationAnchor>().toEqualTypeOf<LeafCadAnnotationAnchor>();
    expectTypeOf<OldCadAnnotationAnchorPoint>().toEqualTypeOf<LeafCadAnnotationAnchorPoint>();
    expectTypeOf<OldCadAnnotationAnchorResolution>().toEqualTypeOf<LeafCadAnnotationAnchorResolution>();
  });

  it('keeps all 8 COGO DTOs identical across both paths', () => {
    expectTypeOf<OldCadCogoToolKey>().toEqualTypeOf<LeafCadCogoToolKey>();
    expectTypeOf<OldCadCogoReportRow>().toEqualTypeOf<LeafCadCogoReportRow>();
    expectTypeOf<OldCadCogoReportTable>().toEqualTypeOf<LeafCadCogoReportTable>();
    expectTypeOf<OldCadCogoReport>().toEqualTypeOf<LeafCadCogoReport>();
    expectTypeOf<OldCadCogoWarning>().toEqualTypeOf<LeafCadCogoWarning>();
    expectTypeOf<OldCadCogoAlternative>().toEqualTypeOf<LeafCadCogoAlternative>();
    expectTypeOf<OldCadCogoProvenance>().toEqualTypeOf<LeafCadCogoProvenance>();
    expectTypeOf<OldCadCogoComputation>().toEqualTypeOf<LeafCadCogoComputation>();
  });

  it('re-exports every moved name from the original modules (legacy import surface)', () => {
    const anchorsSource = requireSource(OLD_ANCHORS, 'old anchors module');
    for (const name of EXPECTED_ANCHOR_EXPORTS) {
      expect(anchorsSource, `${name} re-export`).toContain(name);
    }
    expect(anchorsSource).toContain('./cadAnnotationAnchorTypes');
    const cogoSource = requireSource(OLD_COGO, 'old COGO module');
    for (const name of EXPECTED_COGO_EXPORTS) {
      expect(cogoSource, `${name} re-export`).toContain(name);
    }
    expect(cogoSource).toContain('./cadCogoRecordTypes');
  });
});

describe('STRUCT-195.7 CadProject entity anchor + cogoComputations compatibility', () => {
  it('accepts leaf anchors in the leader/dimension entity fields', () => {
    const fixed: LeafCadAnnotationAnchor = { kind: 'fixed', x: 0, y: 0 };
    const endpoint: LeafCadAnnotationAnchor = {
      kind: 'line-endpoint',
      entityId: 'ln-1',
      endpoint: 'start',
      fallbackX: 0,
      fallbackY: 0,
    };
    const arrowAnchor: CadLeaderEntity['arrowAnchor'] = fixed;
    const anchors: CadDimensionEntity['anchors'] = [fixed, endpoint];
    const defPoint1: CadDimensionEntity['defPoint1'] = endpoint;
    const defPoint2: CadDimensionEntity['defPoint2'] = fixed;
    expect(arrowAnchor).toBe(fixed);
    expect(anchors).toHaveLength(2);
    expect(defPoint1).toBe(endpoint);
    expect(defPoint2).toBe(fixed);
  });

  it('accepts leaf computations as CadProject cogoComputations', () => {
    const computations: CadProject['cogoComputations'] = [cogoComputationSample];
    expect(computationsToProject(computations)).toBe(computations);
    expect(computations[0]!.report.rows).toHaveLength(1);
  });
});

describe('STRUCT-195.7 leaves are type-only', () => {
  it.each([
    ['anchor', LEAF_ANCHORS],
    ['COGO', LEAF_COGO],
  ])('%s leaf has zero runtime imports and zero value declarations', (_label, file) => {
    expect(runtimeImportSpecifiers(file, _label)).toEqual([]);
    expect(hasOnlyTypeImports(file, _label)).toBe(true);
    expect(valueStatementKinds(file, _label)).toEqual([]);
  });

  it('neither leaf imports cadTypes nor re-imports its original module', () => {
    const forbidden = [
      '../cadTypes',
      './cadTypes',
      './cadAnnotationAnchors',
      './cadCogoTypes',
      './index',
      '../index',
    ];
    for (const [label, file] of [
      ['anchor', LEAF_ANCHORS],
      ['COGO', LEAF_COGO],
    ] as const) {
      for (const specifier of forbidden) {
        expect(allImportSpecifiers(file, label), `${label} imports ${specifier}`).not.toContain(specifier);
      }
    }
    // The COGO leaf must not re-declare the retained CadCogoResult.
    expect(exportedTypeNames(LEAF_COGO, 'COGO leaf')).not.toContain('CadCogoResult');
  });
});

describe('STRUCT-195.7 no leaf back-edge to cadTypes', () => {
  const files = GRAPH_DIRS.flatMap((dir) => collectTypeScriptFiles(path.join(REPO_ROOT, dir)));
  const graph = buildGraphs(files.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
  const kindsBetween = (from: string, to: string): string[] =>
    graph.edges
      .filter((edge) => edge.from === abs(from) && edge.to === abs(to))
      .map((edge) => edge.kind);

  it('has no edge of any kind from either leaf to cadTypes', () => {
    for (const leaf of [LEAF_ANCHORS, LEAF_COGO]) {
      expect(kindsBetween(leaf, HUB)).toEqual([]);
    }
  });

  it('has no value or type path from either leaf back to cadTypes', () => {
    for (const leaf of [LEAF_ANCHORS, LEAF_COGO]) {
      expect(reachableFrom(abs(leaf), abs(HUB), graph.value)).toBe(false);
      expect(reachableFrom(abs(leaf), abs(HUB), graph.type)).toBe(false);
    }
  });

  it('emits only type edges out of either leaf', () => {
    for (const leaf of [LEAF_ANCHORS, LEAF_COGO]) {
      const outgoing = graph.edges.filter((edge) => edge.from === abs(leaf));
      expect(outgoing.length).toBeGreaterThan(0);
      for (const edge of outgoing) expect(edge.kind).toBe('type');
    }
  });
});

describe('STRUCT-195.7 cycle-break graph guard (parent hub splice)', () => {
  const workFiles = GRAPH_DIRS.flatMap((dir) => collectTypeScriptFiles(path.join(REPO_ROOT, dir)));
  const workGraph = buildGraphs(workFiles.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
  const kindsBetween = (
    graph: ReturnType<typeof buildGraphs>,
    from: string,
    to: string,
  ): string[] =>
    graph.edges.filter((edge) => edge.from === abs(from) && edge.to === abs(to)).map((edge) => edge.kind);

  it('splits the exact 4-node TYPE SCC (no single component holds all four)', () => {
    const components = tarjanSCC(workGraph.nodes, workGraph.type);
    const host = components.find((component) => component.includes(abs(OLD_ANCHORS)));
    expect(host, 'old anchors module missing from graph').toBeDefined();
    const allFour = [OLD_ANCHORS, OLD_COGO, LOOKUP, HUB].every((member) => host!.includes(abs(member)));
    expect(allFour, `4-node cycle SCC still intact: ${host!.map(rel).sort().join(', ')}`).toBe(false);
  });

  it('repoints the hub type imports to the two leaves', () => {
    expect(kindsBetween(workGraph, HUB, LEAF_ANCHORS)).toContain('type');
    expect(kindsBetween(workGraph, HUB, LEAF_COGO)).toContain('type');
    expect(kindsBetween(workGraph, HUB, OLD_ANCHORS)).toEqual([]);
    expect(kindsBetween(workGraph, HUB, OLD_COGO)).toEqual([]);
  });

  // NOTE (parent fix): explicit timeout — loadSourcesFromGit spawns one git
  // show per file (~470); under full-suite CPU contention it exceeds the
  // 5 s default and flakes. Assertion logic unchanged.
  it('keeps the VALUE edge membership byte-identical vs baseline (added/removed empty)', () => {
    const baseEntries = loadSourcesFromGit(BASELINE_REF, { paths: GRAPH_DIRS, cwd: REPO_ROOT })
      .map((entry) => ({ path: abs(entry.path), source: entry.source }));
    const baseGraph = buildGraphs(baseEntries);
    const pairs = (graph: ReturnType<typeof buildGraphs>): Set<string> =>
      new Set(
        graph.edges
          .filter((edge) => edge.kind === 'value' || edge.kind === 'mixed')
          .map((edge) => `${rel(edge.from)}\n${rel(edge.to)}`),
      );
    const base = pairs(baseGraph);
    const work = pairs(workGraph);
    const added = [...work].filter((pair) => !base.has(pair)).sort();
    const removed = [...base].filter((pair) => !work.has(pair)).sort();
    expect({ added, removed }).toEqual({ added: [], removed: [] });
  }, 120000);
});

