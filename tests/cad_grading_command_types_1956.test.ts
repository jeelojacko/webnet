/**
 * STRUCT-195.6 (test + evidence worker) — grading / grading-group command payload type leaves.
 *
 * Pins `src/engine/cad/cadTransactionsGradingCommandTypes.ts` and
 * `src/engine/cad/cadTransactionsGradingGroupCommandTypes.ts`:
 *  - exact key sets in exact union order (6 grading variants + 13
 *    grading-group variants);
 *  - `Extract<CadCommand, { key }>` payload equivalence per key for all 19
 *    keys (typecheck-enforced, plus runtime shape assertions that fail on
 *    drift: missing `?` / `| null`, readonly-array changes, literal value
 *    changes, nested GROUP_SET_TRANSITION intent drift, omitted fields);
 *  - independent baseline-shape pins: hand-written object-literal types
 *    transcribed from the pre-refactor hub source (grading variants at hub
 *    lines ~1242-1291, group variants at ~1293-1401). They deliberately
 *    import no type from either leaf under test, so leaf drift cannot move
 *    both sides of an assertion. Foreign referenced types
 *    (CadGradingResult/CadGradingGroupResult/GradingCriterion/GradingSide/
 *    GradingGroupCourse/GradingGroupCourseCriterionOverride/CadLayerId) are
 *    shared references, not part of the moved surface;
 *  - runtime AST property-shape pins per key (whitespace-normalized
 *    `name?: type` strings per variant, read from the leaf source at test
 *    time, so optionality/nullability/readonly/literal drift fails `vitest`
 *    even without a typecheck gate);
 *  - the hub `CadCommand` splice order (SURFACE_ADD_FEATURE_LINE_BREAKLINE
 *    -> CadGradingCommandPayload -> CadGradingGroupCommandPayload ->
 *    SURFPURPOSE) with no leftover inline grading keys;
 *  - `CadCommandKey` byte-identical (full ordered literal list, duplicates
 *    included);
 *  - both leaves are type-only (zero value imports/exports);
 *  - no type edge from either leaf back to `cadTransactions.types.ts` /
 *    `cadTransactions.ts` (via `scripts/cadTypeImportGraph.mjs`).
 *
 * Defensive note: the two leaf modules are owned by Workers A/B and may not
 * exist yet when this suite first runs. The static `import type` lines below
 * follow the FIXED interface exactly, so the suite compiles once both leaves
 * land; until then the file-presence precondition reports the blocked status
 * instead of failing obscurely. Only `import type` bindings reference the
 * leaves, so the runtime suite still executes under esbuild (which erases
 * type-only imports) and every AST assertion reports per-key.
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
} from '../scripts/cadTypeImportGraph.mjs';

import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadLayerId } from '../src/engine/cad/cadCorePrimitiveTypes';
import type {
  CadGradingResult,
  GradingCriterion,
  GradingSide,
} from '../src/engine/cad/grading/gradingTypes';
import type {
  CadGradingGroupResult,
  GradingGroupCourse,
  GradingGroupCourseCriterionOverride,
} from '../src/engine/cad/grading/gradingGroupTypes';
import type { CadGradingCommandPayload } from '../src/engine/cad/cadTransactionsGradingCommandTypes';
import type { CadGradingGroupCommandPayload } from '../src/engine/cad/cadTransactionsGradingGroupCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const GRADING_LEAF = path.join(CAD_DIR, 'cadTransactionsGradingCommandTypes.ts');
const GROUP_LEAF = path.join(CAD_DIR, 'cadTransactionsGradingGroupCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');

const GRADING_ALIAS = 'CadGradingCommandPayload';
const GROUP_ALIAS = 'CadGradingGroupCommandPayload';

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Throw a clear blocked-status error when a Worker A/B leaf has not landed yet. */
const requireSource = (file: string, label: string): string => {
  if (!fs.existsSync(file)) {
    throw new Error(
      `STRUCT-195.6 blocked: ${label} not present yet at ${path.relative(REPO_ROOT, file)} `
      + '(owned by Workers A/B; suite compiles green once both leaves land)',
    );
  }
  return fs.readFileSync(file, 'utf8');
};

const parseKnown = (file: string, label: string): ts.SourceFile =>
  ts.createSourceFile(file, requireSource(file, label), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

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

/** Ordered `key` string literals of every object variant in the alias union. */
const unionKeysInOrder = (file: string, label: string, aliasName: string): string[] => {
  const alias = parseKnown(file, label).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === aliasName,
  );
  if (!alias) throw new Error(`${label}: alias ${aliasName} missing`);
  const keys: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(visit);
      return;
    }
    if (!ts.isTypeLiteralNode(node)) return;
    const keyProp = node.members.find(
      (member): member is ts.PropertySignature =>
        ts.isPropertySignature(member) && member.name.getText() === 'key',
    );
    if (keyProp?.type && ts.isLiteralTypeNode(keyProp.type) && ts.isStringLiteral(keyProp.type.literal)) {
      keys.push(keyProp.type.literal.text);
    }
  };
  visit(alias.type);
  return keys;
};

/** Collapse all whitespace so formatting drift cannot mask (or fake) type drift. */
const norm = (text: string): string => text.replace(/\s+/g, '');

/**
 * Whitespace-normalized `name[?]: type` strings of the single variant with
 * the given `key` literal inside the alias union, in declaration order.
 * Returns null when the alias/key is absent (caller asserts non-null).
 */
const variantPropShapes = (
  file: string,
  label: string,
  aliasName: string,
  key: string,
): string[] | null => {
  const alias = parseKnown(file, label).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === aliasName,
  );
  if (!alias || !ts.isUnionTypeNode(alias.type)) return null;
  for (const member of alias.type.types) {
    if (!ts.isTypeLiteralNode(member)) continue;
    const keyProp = member.members.find(
      (m): m is ts.PropertySignature =>
        ts.isPropertySignature(m) && m.name.getText() === 'key',
    );
    const literal = keyProp?.type;
    const matches = literal
      && ts.isLiteralTypeNode(literal)
      && ts.isStringLiteral(literal.literal)
      && literal.literal.text === key;
    if (!matches) continue;
    return member.members
      .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
      .map((m) => norm(`${m.name.getText()}${m.questionToken ? '?' : ''}: ${m.type?.getText() ?? 'never'}`));
  }
  return null;
};

/**
 * Ordered hub `CadCommand` union members: type-alias refs stay refs, inline
 * object literals collapse to their `key` literal. Fails loudly (never
 * silently empty) so union refactors break this guard instead of passing.
 */
const hubMemberOrder = (): string[] => {
  const alias = parse(HUB).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'CadCommand',
  );
  if (!alias) throw new Error('CadCommand alias missing from hub');
  const members: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(visit);
      return;
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      members.push(node.typeName.text);
      return;
    }
    if (ts.isTypeLiteralNode(node)) {
      const keyProp = node.members.find(
        (member): member is ts.PropertySignature =>
          ts.isPropertySignature(member) && member.name.getText() === 'key',
      );
      if (keyProp?.type && ts.isLiteralTypeNode(keyProp.type) && ts.isStringLiteral(keyProp.type.literal)) {
        members.push(keyProp.type.literal.text);
      }
    }
  };
  visit(alias.type);
  if (members.length === 0) throw new Error('CadCommand union parsed to zero members');
  return members;
};

/** Ordered string literals of the hub `CadCommandKey` union (duplicates kept). */
const hubKeyOrder = (): string[] => {
  const alias = parse(HUB).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'CadCommandKey',
  );
  if (!alias) throw new Error('CadCommandKey alias missing from hub');
  const keys: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(visit);
      return;
    }
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) keys.push(node.literal.text);
  };
  visit(alias.type);
  if (keys.length === 0) throw new Error('CadCommandKey union parsed to zero members');
  return keys;
};

const EXPECTED_GRADING_KEYS = [
  'GRADING_CREATE',
  'GRADING_DELETE',
  'GRADING_EDIT_CRITERIA',
  'GRADING_REASSIGN_TARGET',
  'GRADINGEXTRACTDAYLIGHT',
  'GRADINGBAKE',
] as const;

const EXPECTED_GROUP_KEYS = [
  'GROUP_CREATE',
  'GROUP_DELETE',
  'GROUP_EDIT_CRITERIA',
  'GROUP_REASSIGN_TARGET',
  'GROUP_EDIT_SPAN',
  'GROUP_ADD_COURSE',
  'GROUP_REMOVE_END_COURSE',
  'GROUP_SET_COURSE_CRITERIA',
  'GROUP_RESET_COURSE_CRITERIA',
  'GROUP_SET_TRANSITION',
  'GROUP_CLEAR_TRANSITION',
  'GROUPEXTRACTDAYLIGHT',
  'GROUPBAKE',
] as const;

type GradingKey = (typeof EXPECTED_GRADING_KEYS)[number];
type GroupKey = (typeof EXPECTED_GROUP_KEYS)[number];

/**
 * Hand-transcribed per-variant property shapes (from the pre-refactor hub
 * baseline). Compared at runtime against the leaf source AST, so drift in
 * optionality (`?`), nullability (`| null`), readonly modifiers, literal
 * values, the nested GROUP_SET_TRANSITION intent, or omitted/added fields
 * fails `vitest` directly. Both sides are whitespace-normalized before
 * comparison; comments are AST trivia and never participate.
 */
const EXPECTED_PROP_SHAPES: Record<GradingKey | GroupKey, string[]> = {
  GRADING_CREATE: [
    "key: 'GRADING_CREATE'",
    'name?: string',
    'sourceFeatureLineId: string',
    'vertexAId: string',
    'vertexBId: string',
    'targetSurfaceId?: string',
    "side: GradingSide | 'both'",
    'criterion: GradingCriterion',
    'maxSearchDistance: number',
    'curveChordTolerance: number',
    'layerId?: CadLayerId',
  ],
  GRADING_DELETE: [
    "key: 'GRADING_DELETE'",
    'gradingId: string',
  ],
  GRADING_EDIT_CRITERIA: [
    "key: 'GRADING_EDIT_CRITERIA'",
    'gradingId: string',
    'criterion: GradingCriterion',
    'targetSurfaceId?: string | null',
  ],
  GRADING_REASSIGN_TARGET: [
    "key: 'GRADING_REASSIGN_TARGET'",
    'gradingId: string',
    'targetSurfaceId: string',
  ],
  GRADINGEXTRACTDAYLIGHT: [
    "key: 'GRADINGEXTRACTDAYLIGHT'",
    'gradingId: string',
    'result: CadGradingResult',
    'expectedRevision: string',
    'sessionCurrent?: boolean',
  ],
  GRADINGBAKE: [
    "key: 'GRADINGBAKE'",
    'gradingId: string',
    'result: CadGradingResult',
    'expectedRevision: string',
    'sessionCurrent?: boolean',
  ],
  GROUP_CREATE: [
    "key: 'GROUP_CREATE'",
    'name?: string',
    'sourceFeatureLineId: string',
    'sourceCourses: GradingGroupCourse[]',
    'targetSurfaceId?: string',
    'side: GradingSide',
    'criterion: GradingCriterion',
    'maxSearchDistance: number',
    'curveChordTolerance: number',
    "cornerMode?: 'miter'",
    'closed?: boolean',
    'layerId?: CadLayerId',
    'courseCriteria?: GradingGroupCourseCriterionOverride[]',
  ],
  GROUP_DELETE: [
    "key: 'GROUP_DELETE'",
    'groupId: string',
  ],
  GROUP_EDIT_CRITERIA: [
    "key: 'GROUP_EDIT_CRITERIA'",
    'groupId: string',
    'criterion?: GradingCriterion',
    'targetSurfaceId?: string | null',
    'maxSearchDistance?: number',
    'curveChordTolerance?: number',
  ],
  GROUP_REASSIGN_TARGET: [
    "key: 'GROUP_REASSIGN_TARGET'",
    'groupId: string',
    'targetSurfaceId: string',
  ],
  GROUP_EDIT_SPAN: [
    "key: 'GROUP_EDIT_SPAN'",
    'groupId: string',
    'sourceCourses: GradingGroupCourse[]',
    'closed?: boolean',
  ],
  GROUP_ADD_COURSE: [
    "key: 'GROUP_ADD_COURSE'",
    'groupId: string',
    'course: GradingGroupCourse',
  ],
  GROUP_REMOVE_END_COURSE: [
    "key: 'GROUP_REMOVE_END_COURSE'",
    'groupId: string',
    "which: 'first' | 'last'",
  ],
  GROUP_SET_COURSE_CRITERIA: [
    "key: 'GROUP_SET_COURSE_CRITERIA'",
    'groupId: string',
    'courses: GradingGroupCourse[]',
    'criterion: GradingCriterion',
    'targetSurfaceId?: string | null',
  ],
  GROUP_RESET_COURSE_CRITERIA: [
    "key: 'GROUP_RESET_COURSE_CRITERIA'",
    'groupId: string',
    'courses: GradingGroupCourse[]',
    'targetSurfaceId?: string | null',
  ],
  GROUP_SET_TRANSITION: [
    "key: 'GROUP_SET_TRANSITION'",
    'groupId: string',
    `intent: {
      policyVersion: string;
      jointId: string;
      memberIds: readonly string[];
      width: number;
      lawKind: string;
      lawVersion: string;
      criterionFamily: string;
      side: string;
    }`,
  ],
  GROUP_CLEAR_TRANSITION: [
    "key: 'GROUP_CLEAR_TRANSITION'",
    'groupId: string',
    'jointId?: string',
  ],
  GROUPEXTRACTDAYLIGHT: [
    "key: 'GROUPEXTRACTDAYLIGHT'",
    'groupId: string',
    'result: CadGradingGroupResult',
    'expectedRevision: string',
    'sessionCurrent?: boolean',
  ],
  GROUPBAKE: [
    "key: 'GROUPBAKE'",
    'groupId: string',
    'result: CadGradingGroupResult',
    'expectedRevision: string',
    'sessionCurrent?: boolean',
  ],
};

/** Top-level field names derived from the transcribed shapes (sample key pins). */
const expectedFieldNames = (key: GradingKey | GroupKey): string[] =>
  EXPECTED_PROP_SHAPES[key].map((shape) => norm(shape).split(':')[0]!.replace(/\?$/, ''));

// ---------------------------------------------------------------------------
// Independent baseline pins (STRUCT-195.6).
//
// Hand-transcribed from the pre-refactor hub baseline
// (`src/engine/cad/cadTransactions.types.ts`: grading variants ~1242-1291,
// group variants ~1293-1401). They import no leaf type, so leaf drift cannot
// move both sides of an assertion. Foreign referenced types are shared
// references, not part of the moved surface.
// ---------------------------------------------------------------------------

type BaseGradingCreate = {
  key: 'GRADING_CREATE';
  name?: string;
  sourceFeatureLineId: string;
  vertexAId: string;
  vertexBId: string;
  targetSurfaceId?: string;
  side: GradingSide | 'both';
  criterion: GradingCriterion;
  maxSearchDistance: number;
  curveChordTolerance: number;
  layerId?: CadLayerId;
};

type BaseGradingDelete = {
  key: 'GRADING_DELETE';
  gradingId: string;
};

type BaseGradingEditCriteria = {
  key: 'GRADING_EDIT_CRITERIA';
  gradingId: string;
  criterion: GradingCriterion;
  targetSurfaceId?: string | null;
};

type BaseGradingReassignTarget = {
  key: 'GRADING_REASSIGN_TARGET';
  gradingId: string;
  targetSurfaceId: string;
};

type BaseGradingExtractDaylight = {
  key: 'GRADINGEXTRACTDAYLIGHT';
  gradingId: string;
  result: CadGradingResult;
  expectedRevision: string;
  sessionCurrent?: boolean;
};

type BaseGradingBake = {
  key: 'GRADINGBAKE';
  gradingId: string;
  result: CadGradingResult;
  expectedRevision: string;
  sessionCurrent?: boolean;
};

type BaseGroupCreate = {
  key: 'GROUP_CREATE';
  name?: string;
  sourceFeatureLineId: string;
  sourceCourses: GradingGroupCourse[];
  targetSurfaceId?: string;
  side: GradingSide;
  criterion: GradingCriterion;
  maxSearchDistance: number;
  curveChordTolerance: number;
  cornerMode?: 'miter';
  closed?: boolean;
  layerId?: CadLayerId;
  courseCriteria?: GradingGroupCourseCriterionOverride[];
};

type BaseGroupDelete = {
  key: 'GROUP_DELETE';
  groupId: string;
};

type BaseGroupEditCriteria = {
  key: 'GROUP_EDIT_CRITERIA';
  groupId: string;
  criterion?: GradingCriterion;
  targetSurfaceId?: string | null;
  maxSearchDistance?: number;
  curveChordTolerance?: number;
};

type BaseGroupReassignTarget = {
  key: 'GROUP_REASSIGN_TARGET';
  groupId: string;
  targetSurfaceId: string;
};

type BaseGroupEditSpan = {
  key: 'GROUP_EDIT_SPAN';
  groupId: string;
  sourceCourses: GradingGroupCourse[];
  closed?: boolean;
};

type BaseGroupAddCourse = {
  key: 'GROUP_ADD_COURSE';
  groupId: string;
  course: GradingGroupCourse;
};

type BaseGroupRemoveEndCourse = {
  key: 'GROUP_REMOVE_END_COURSE';
  groupId: string;
  which: 'first' | 'last';
};

type BaseGroupSetCourseCriteria = {
  key: 'GROUP_SET_COURSE_CRITERIA';
  groupId: string;
  courses: GradingGroupCourse[];
  criterion: GradingCriterion;
  targetSurfaceId?: string | null;
};

type BaseGroupResetCourseCriteria = {
  key: 'GROUP_RESET_COURSE_CRITERIA';
  groupId: string;
  courses: GradingGroupCourse[];
  targetSurfaceId?: string | null;
};

type BaseGroupTransitionIntent = {
  policyVersion: string;
  jointId: string;
  memberIds: readonly string[];
  width: number;
  lawKind: string;
  lawVersion: string;
  criterionFamily: string;
  side: string;
};

type BaseGroupSetTransition = {
  key: 'GROUP_SET_TRANSITION';
  groupId: string;
  intent: BaseGroupTransitionIntent;
};

type BaseGroupClearTransition = {
  key: 'GROUP_CLEAR_TRANSITION';
  groupId: string;
  jointId?: string;
};

type BaseGroupExtractDaylight = {
  key: 'GROUPEXTRACTDAYLIGHT';
  groupId: string;
  result: CadGradingGroupResult;
  expectedRevision: string;
  sessionCurrent?: boolean;
};

type BaseGroupBake = {
  key: 'GROUPBAKE';
  groupId: string;
  result: CadGradingGroupResult;
  expectedRevision: string;
  sessionCurrent?: boolean;
};

// Full-field samples: every declared field present, so leaf drift (dropped
// optional, added required, renamed field) breaks either the annotation
// (typecheck) or the runtime key assertion below. Complex snapshots use
// shared-reference casts; payload-level fields stay literal.
const FIXED_CRITERION: GradingCriterion = { kind: 'fixed', gradeRatio: 2 };

const gradingSamples: CadGradingCommandPayload[] = [
  {
    key: 'GRADING_CREATE',
    name: 'grade-1',
    sourceFeatureLineId: 'fl-1',
    vertexAId: 'a',
    vertexBId: 'b',
    targetSurfaceId: 'surf-1',
    side: 'both',
    criterion: FIXED_CRITERION,
    maxSearchDistance: 50,
    curveChordTolerance: 0.1,
    layerId: 'layer-1',
  },
  { key: 'GRADING_DELETE', gradingId: 'g-1' },
  { key: 'GRADING_EDIT_CRITERIA', gradingId: 'g-1', criterion: FIXED_CRITERION, targetSurfaceId: null },
  { key: 'GRADING_REASSIGN_TARGET', gradingId: 'g-1', targetSurfaceId: 'surf-1' },
  {
    key: 'GRADINGEXTRACTDAYLIGHT',
    gradingId: 'g-1',
    result: {} as CadGradingResult,
    expectedRevision: 'rev-1',
    sessionCurrent: true,
  },
  {
    key: 'GRADINGBAKE',
    gradingId: 'g-1',
    result: {} as CadGradingResult,
    expectedRevision: 'rev-1',
    sessionCurrent: true,
  },
];

const groupSamples: CadGradingGroupCommandPayload[] = [
  {
    key: 'GROUP_CREATE',
    name: 'group-1',
    sourceFeatureLineId: 'fl-1',
    sourceCourses: [{ vertexAId: 'a', vertexBId: 'b' }],
    targetSurfaceId: 'surf-1',
    side: 'left',
    criterion: FIXED_CRITERION,
    maxSearchDistance: 50,
    curveChordTolerance: 0.1,
    cornerMode: 'miter',
    closed: true,
    layerId: 'layer-1',
    courseCriteria: [{ sourceCourse: { vertexAId: 'a', vertexBId: 'b' }, criterion: FIXED_CRITERION }],
  },
  { key: 'GROUP_DELETE', groupId: 'gg-1' },
  {
    key: 'GROUP_EDIT_CRITERIA',
    groupId: 'gg-1',
    criterion: FIXED_CRITERION,
    targetSurfaceId: null,
    maxSearchDistance: 60,
    curveChordTolerance: 0.2,
  },
  { key: 'GROUP_REASSIGN_TARGET', groupId: 'gg-1', targetSurfaceId: 'surf-1' },
  {
    key: 'GROUP_EDIT_SPAN',
    groupId: 'gg-1',
    sourceCourses: [{ vertexAId: 'a', vertexBId: 'b' }],
    closed: false,
  },
  { key: 'GROUP_ADD_COURSE', groupId: 'gg-1', course: { vertexAId: 'b', vertexBId: 'c' } },
  { key: 'GROUP_REMOVE_END_COURSE', groupId: 'gg-1', which: 'last' },
  {
    key: 'GROUP_SET_COURSE_CRITERIA',
    groupId: 'gg-1',
    courses: [{ vertexAId: 'a', vertexBId: 'b' }],
    criterion: FIXED_CRITERION,
    targetSurfaceId: null,
  },
  {
    key: 'GROUP_RESET_COURSE_CRITERIA',
    groupId: 'gg-1',
    courses: [{ vertexAId: 'a', vertexBId: 'b' }],
    targetSurfaceId: null,
  },
  {
    key: 'GROUP_SET_TRANSITION',
    groupId: 'gg-1',
    intent: {
      policyVersion: 'p1',
      jointId: 'j1',
      memberIds: ['m1', 'm2'],
      width: 2,
      lawKind: 'linear',
      lawVersion: 'v1',
      criterionFamily: 'fixed',
      side: 'left',
    },
  },
  { key: 'GROUP_CLEAR_TRANSITION', groupId: 'gg-1', jointId: 'j1' },
  {
    key: 'GROUPEXTRACTDAYLIGHT',
    groupId: 'gg-1',
    result: {} as CadGradingGroupResult,
    expectedRevision: 'rev-1',
    sessionCurrent: true,
  },
  {
    key: 'GROUPBAKE',
    groupId: 'gg-1',
    result: {} as CadGradingGroupResult,
    expectedRevision: 'rev-1',
    sessionCurrent: true,
  },
];

// Compile-time hub <-> leaf round trip (enforced by project typecheck).
const leafToHub = (payload: CadGradingCommandPayload | CadGradingGroupCommandPayload): CadCommand => payload;

// ---------------------------------------------------------------------------

describe('STRUCT-195.6 leaf presence (Workers A/B handoff)', () => {
  it('both grading leaves exist before any shape assertion runs', () => {
    for (const [label, file] of [
      ['grading leaf', GRADING_LEAF],
      ['grading-group leaf', GROUP_LEAF],
    ] as const) {
      expect(fs.existsSync(file), `${label} missing: ${path.relative(REPO_ROOT, file)}`).toBe(true);
    }
  });
});

describe('STRUCT-195.6 leaf key sets in exact union order', () => {
  it('pins the 6 grading keys in order with no duplication or gaps', () => {
    const keys = unionKeysInOrder(GRADING_LEAF, 'grading leaf', GRADING_ALIAS);
    expect(keys).toEqual([...EXPECTED_GRADING_KEYS]);
    expect(new Set(keys).size).toBe(EXPECTED_GRADING_KEYS.length);
  });

  it('pins the 13 grading-group keys in order with no duplication or gaps', () => {
    const keys = unionKeysInOrder(GROUP_LEAF, 'grading-group leaf', GROUP_ALIAS);
    expect(keys).toEqual([...EXPECTED_GROUP_KEYS]);
    expect(new Set(keys).size).toBe(EXPECTED_GROUP_KEYS.length);
  });

  it('keeps the two families disjoint with no cross-contamination', () => {
    const gradingKeys = unionKeysInOrder(GRADING_LEAF, 'grading leaf', GRADING_ALIAS);
    const groupKeys = unionKeysInOrder(GROUP_LEAF, 'grading-group leaf', GROUP_ALIAS);
    for (const key of gradingKeys) expect(groupKeys).not.toContain(key);
    for (const key of groupKeys) expect(gradingKeys).not.toContain(key);
    for (const key of [...gradingKeys, ...groupKeys]) {
      expect(key).not.toBe('SURFACE_ADD_FEATURE_LINE_BREAKLINE');
      expect(key).not.toBe('SURFPURPOSE');
    }
  });

  it('compiles one full-field sample per key (required-field probe)', () => {
    expect(gradingSamples.map((sample) => sample.key)).toEqual([...EXPECTED_GRADING_KEYS]);
    expect(groupSamples.map((sample) => sample.key)).toEqual([...EXPECTED_GROUP_KEYS]);
    expect(leafToHub(gradingSamples[0]!)).toBe(gradingSamples[0]);
    expect(leafToHub(groupSamples[0]!)).toBe(groupSamples[0]);
  });

  it('samples carry every declared field at runtime (no omitted/extra field)', () => {
    for (const sample of [...gradingSamples, ...groupSamples]) {
      const key = sample.key as GradingKey | GroupKey;
      expect(Object.keys(sample).sort()).toEqual([...expectedFieldNames(key)].sort());
    }
  });
});

describe('STRUCT-195.6 Extract<CadCommand> payload equivalence (drift-failing)', () => {
  it('matches the hub slice for every grading key', () => {
    expectTypeOf<Extract<CadCommand, { key: 'GRADING_CREATE' }>>().toEqualTypeOf<
      Extract<CadGradingCommandPayload, { key: 'GRADING_CREATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GRADING_DELETE' }>>().toEqualTypeOf<
      Extract<CadGradingCommandPayload, { key: 'GRADING_DELETE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GRADING_EDIT_CRITERIA' }>>().toEqualTypeOf<
      Extract<CadGradingCommandPayload, { key: 'GRADING_EDIT_CRITERIA' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GRADING_REASSIGN_TARGET' }>>().toEqualTypeOf<
      Extract<CadGradingCommandPayload, { key: 'GRADING_REASSIGN_TARGET' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GRADINGEXTRACTDAYLIGHT' }>>().toEqualTypeOf<
      Extract<CadGradingCommandPayload, { key: 'GRADINGEXTRACTDAYLIGHT' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GRADINGBAKE' }>>().toEqualTypeOf<
      Extract<CadGradingCommandPayload, { key: 'GRADINGBAKE' }>
    >();
  });

  it('matches the hub slice for every grading-group key', () => {
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_CREATE' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_CREATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_DELETE' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_DELETE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_EDIT_CRITERIA' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_EDIT_CRITERIA' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_REASSIGN_TARGET' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_REASSIGN_TARGET' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_EDIT_SPAN' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_EDIT_SPAN' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_ADD_COURSE' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_ADD_COURSE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_REMOVE_END_COURSE' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_REMOVE_END_COURSE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_SET_COURSE_CRITERIA' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_SET_COURSE_CRITERIA' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_RESET_COURSE_CRITERIA' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_RESET_COURSE_CRITERIA' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_SET_TRANSITION' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_SET_TRANSITION' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_CLEAR_TRANSITION' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUP_CLEAR_TRANSITION' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUPEXTRACTDAYLIGHT' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUPEXTRACTDAYLIGHT' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'GROUPBAKE' }>>().toEqualTypeOf<
      Extract<CadGradingGroupCommandPayload, { key: 'GROUPBAKE' }>
    >();
  });

  it('keeps the slice unions exactly the hub narrowing (no extra members)', () => {
    expectTypeOf<Extract<CadCommand, { key: GradingKey }>>().toEqualTypeOf<CadGradingCommandPayload>();
    expectTypeOf<Extract<CadCommand, { key: GroupKey }>>().toEqualTypeOf<CadGradingGroupCommandPayload>();
  });

  it('probes optionality, nullability, readonly, and literal drift points', () => {
    type GradingCreate = Extract<CadGradingCommandPayload, { key: 'GRADING_CREATE' }>;
    // Grading side admits 'both'; the group side does not.
    expectTypeOf<GradingCreate['side']>().toEqualTypeOf<GradingSide | 'both'>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_CREATE' }>['side']>()
      .toEqualTypeOf<GradingSide>();
    // Optional-without-null vs optional-with-null must not collapse.
    expectTypeOf<GradingCreate['targetSurfaceId']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadGradingCommandPayload, { key: 'GRADING_EDIT_CRITERIA' }>['targetSurfaceId']>()
      .toEqualTypeOf<string | null | undefined>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_EDIT_CRITERIA' }>['criterion']>()
      .toEqualTypeOf<GradingCriterion | undefined>();
    // Readonly member list: a mutable `string[]` leaf rewrite breaks this.
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_SET_TRANSITION' }>['intent']['memberIds']>()
      .toEqualTypeOf<readonly string[]>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_REMOVE_END_COURSE' }>['which']>()
      .toEqualTypeOf<'first' | 'last'>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_CREATE' }>['cornerMode']>()
      .toEqualTypeOf<'miter' | undefined>();
    expectTypeOf<Extract<CadGradingCommandPayload, { key: 'GRADINGEXTRACTDAYLIGHT' }>['result']>()
      .toEqualTypeOf<CadGradingResult>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUPBAKE' }>['result']>()
      .toEqualTypeOf<CadGradingGroupResult>();
  });
});

describe('STRUCT-195.6 independent baseline pins: grading payloads', () => {
  it('matches the pre-refactor hub shape for every grading key (hub and leaf)', () => {
    expectTypeOf<Extract<CadCommand, { key: 'GRADING_CREATE' }>>().toEqualTypeOf<BaseGradingCreate>();
    expectTypeOf<Extract<CadGradingCommandPayload, { key: 'GRADING_CREATE' }>>().toEqualTypeOf<BaseGradingCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'GRADING_DELETE' }>>().toEqualTypeOf<BaseGradingDelete>();
    expectTypeOf<Extract<CadGradingCommandPayload, { key: 'GRADING_DELETE' }>>().toEqualTypeOf<BaseGradingDelete>();
    expectTypeOf<Extract<CadCommand, { key: 'GRADING_EDIT_CRITERIA' }>>().toEqualTypeOf<BaseGradingEditCriteria>();
    expectTypeOf<Extract<CadGradingCommandPayload, { key: 'GRADING_EDIT_CRITERIA' }>>()
      .toEqualTypeOf<BaseGradingEditCriteria>();
    expectTypeOf<Extract<CadCommand, { key: 'GRADING_REASSIGN_TARGET' }>>().toEqualTypeOf<BaseGradingReassignTarget>();
    expectTypeOf<Extract<CadGradingCommandPayload, { key: 'GRADING_REASSIGN_TARGET' }>>()
      .toEqualTypeOf<BaseGradingReassignTarget>();
    expectTypeOf<Extract<CadCommand, { key: 'GRADINGEXTRACTDAYLIGHT' }>>().toEqualTypeOf<BaseGradingExtractDaylight>();
    expectTypeOf<Extract<CadGradingCommandPayload, { key: 'GRADINGEXTRACTDAYLIGHT' }>>()
      .toEqualTypeOf<BaseGradingExtractDaylight>();
    expectTypeOf<Extract<CadCommand, { key: 'GRADINGBAKE' }>>().toEqualTypeOf<BaseGradingBake>();
    expectTypeOf<Extract<CadGradingCommandPayload, { key: 'GRADINGBAKE' }>>().toEqualTypeOf<BaseGradingBake>();
  });

  it('matches the transcribed runtime property shapes for every grading key', () => {
    for (const key of EXPECTED_GRADING_KEYS) {
      const shapes = variantPropShapes(GRADING_LEAF, 'grading leaf', GRADING_ALIAS, key);
      expect(shapes, `${key} variant missing from grading leaf`).not.toBeNull();
      expect(shapes, `${key} property drift`).toEqual(EXPECTED_PROP_SHAPES[key].map(norm));
    }
  });
});

describe('STRUCT-195.6 independent baseline pins: grading-group payloads', () => {
  it('matches the pre-refactor hub shape for every grading-group key (hub and leaf)', () => {
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_CREATE' }>>().toEqualTypeOf<BaseGroupCreate>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_CREATE' }>>().toEqualTypeOf<BaseGroupCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_DELETE' }>>().toEqualTypeOf<BaseGroupDelete>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_DELETE' }>>().toEqualTypeOf<BaseGroupDelete>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_EDIT_CRITERIA' }>>().toEqualTypeOf<BaseGroupEditCriteria>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_EDIT_CRITERIA' }>>()
      .toEqualTypeOf<BaseGroupEditCriteria>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_REASSIGN_TARGET' }>>().toEqualTypeOf<BaseGroupReassignTarget>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_REASSIGN_TARGET' }>>()
      .toEqualTypeOf<BaseGroupReassignTarget>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_EDIT_SPAN' }>>().toEqualTypeOf<BaseGroupEditSpan>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_EDIT_SPAN' }>>().toEqualTypeOf<BaseGroupEditSpan>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_ADD_COURSE' }>>().toEqualTypeOf<BaseGroupAddCourse>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_ADD_COURSE' }>>()
      .toEqualTypeOf<BaseGroupAddCourse>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_REMOVE_END_COURSE' }>>().toEqualTypeOf<BaseGroupRemoveEndCourse>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_REMOVE_END_COURSE' }>>()
      .toEqualTypeOf<BaseGroupRemoveEndCourse>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_SET_COURSE_CRITERIA' }>>().toEqualTypeOf<BaseGroupSetCourseCriteria>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_SET_COURSE_CRITERIA' }>>()
      .toEqualTypeOf<BaseGroupSetCourseCriteria>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_RESET_COURSE_CRITERIA' }>>()
      .toEqualTypeOf<BaseGroupResetCourseCriteria>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_RESET_COURSE_CRITERIA' }>>()
      .toEqualTypeOf<BaseGroupResetCourseCriteria>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_SET_TRANSITION' }>>().toEqualTypeOf<BaseGroupSetTransition>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_SET_TRANSITION' }>>()
      .toEqualTypeOf<BaseGroupSetTransition>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUP_CLEAR_TRANSITION' }>>().toEqualTypeOf<BaseGroupClearTransition>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUP_CLEAR_TRANSITION' }>>()
      .toEqualTypeOf<BaseGroupClearTransition>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUPEXTRACTDAYLIGHT' }>>().toEqualTypeOf<BaseGroupExtractDaylight>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUPEXTRACTDAYLIGHT' }>>()
      .toEqualTypeOf<BaseGroupExtractDaylight>();
    expectTypeOf<Extract<CadCommand, { key: 'GROUPBAKE' }>>().toEqualTypeOf<BaseGroupBake>();
    expectTypeOf<Extract<CadGradingGroupCommandPayload, { key: 'GROUPBAKE' }>>().toEqualTypeOf<BaseGroupBake>();
  });

  it('matches the transcribed runtime property shapes for every grading-group key', () => {
    for (const key of EXPECTED_GROUP_KEYS) {
      const shapes = variantPropShapes(GROUP_LEAF, 'grading-group leaf', GROUP_ALIAS, key);
      expect(shapes, `${key} variant missing from grading-group leaf`).not.toBeNull();
      expect(shapes, `${key} property drift`).toEqual(EXPECTED_PROP_SHAPES[key].map(norm));
    }
  });
});

describe('STRUCT-195.6 hub union splice order', () => {
  it('splices grading -> grading-group between breakline and purpose with no gaps', () => {
    const members = hubMemberOrder();
    const breaklineAt = members.indexOf('SURFACE_ADD_FEATURE_LINE_BREAKLINE');
    expect(breaklineAt, 'SURFACE_ADD_FEATURE_LINE_BREAKLINE').toBeGreaterThanOrEqual(0);
    expect(members.slice(breaklineAt - 1, breaklineAt + 5)).toEqual([
      'FLDELETEVERTEX',
      'SURFACE_ADD_FEATURE_LINE_BREAKLINE',
      'CadGradingCommandPayload',
      'CadGradingGroupCommandPayload',
      'SURFPURPOSE',
      'DESIGNSURFACE',
    ]);
  });

  it('leaves no inline grading key behind in the hub union', () => {
    const members = hubMemberOrder();
    for (const key of [...EXPECTED_GRADING_KEYS, ...EXPECTED_GROUP_KEYS]) {
      expect(members, `inline ${key} still in hub`).not.toContain(key);
    }
  });
});

describe('STRUCT-195.6 CadCommandKey unchanged', () => {
  it('keeps the byte-identical ordered literal list (248 entries, duplicates kept)', () => {
    expect(hubKeyOrder()).toEqual([...EXPECTED_CAD_COMMAND_KEYS]);
  });

  it('keeps the 19 grading keys contiguous between breakline and purpose', () => {
    const keys = hubKeyOrder();
    const at = keys.indexOf('SURFACE_ADD_FEATURE_LINE_BREAKLINE');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(keys.slice(at + 1, at + 20)).toEqual([...EXPECTED_GRADING_KEYS, ...EXPECTED_GROUP_KEYS]);
    expect(keys[at + 20]).toBe('SURFPURPOSE');
  });
});

describe('STRUCT-195.6 leaves are type-only', () => {
  it.each([
    ['grading', GRADING_LEAF],
    ['grading-group', GROUP_LEAF],
  ])('%s leaf has zero runtime imports and zero value declarations', (_label, file) => {
    expect(runtimeImportSpecifiers(file, _label)).toEqual([]);
    expect(hasOnlyTypeImports(file, _label)).toBe(true);
    expect(valueStatementKinds(file, _label)).toEqual([]);
  });

  it('neither leaf touches the hub, a transaction module, or a barrel', () => {
    const forbidden = [
      './cadTransactions.types',
      './cadTransactions',
      './cadTransactionsGradingCommands',
      './cadTransactionsGradingGroupCommands',
      './index',
      '../index',
    ];
    for (const [label, file] of [
      ['grading', GRADING_LEAF],
      ['grading-group', GROUP_LEAF],
    ] as const) {
      for (const specifier of forbidden) {
        expect(allImportSpecifiers(file, label), `${label} imports ${specifier}`).not.toContain(specifier);
      }
    }
  });
});

describe('STRUCT-195.6 no leaf back-edge to the transaction hub', () => {
  const files = ['src/engine/cad', 'src/engine/fieldToFinish'].flatMap((dir) =>
    collectTypeScriptFiles(path.join(REPO_ROOT, dir)),
  );
  const graph = buildGraphs(files.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
  const kindsBetween = (from: string, to: string): string[] =>
    graph.edges
      .filter((edge) => edge.from === path.resolve(REPO_ROOT, from) && edge.to === path.resolve(REPO_ROOT, to))
      .map((edge) => edge.kind);

  it('has no edge of any kind from either leaf back to the hub', () => {
    for (const leaf of [
      'src/engine/cad/cadTransactionsGradingCommandTypes.ts',
      'src/engine/cad/cadTransactionsGradingGroupCommandTypes.ts',
    ]) {
      for (const hub of [
        'src/engine/cad/cadTransactions.types.ts',
        'src/engine/cad/cadTransactions.ts',
      ]) {
        expect(kindsBetween(leaf, hub)).toEqual([]);
      }
    }
  });

  it('emits only type edges out of either leaf', () => {
    for (const leaf of [
      'src/engine/cad/cadTransactionsGradingCommandTypes.ts',
      'src/engine/cad/cadTransactionsGradingGroupCommandTypes.ts',
    ]) {
      const outgoing = graph.edges.filter((edge) => edge.from === path.resolve(REPO_ROOT, leaf));
      expect(outgoing.length).toBeGreaterThan(0);
      for (const edge of outgoing) expect(edge.kind).toBe('type');
    }
  });
});

/**
 * Byte-identical pin of the hub `CadCommandKey` union literal order,
 * transcribed from the pre-refactor baseline (248 entries; BLOCK_CREATE and
 * friends intentionally repeat, matching the hub source).
 */
const EXPECTED_CAD_COMMAND_KEYS = [
  'SELECT_ALL', 'CLEAR_SELECTION', 'ERASE', 'POINT',
  'COGO_POINT', 'LINE', 'LINE_CREATE_BATCH', 'RECTANGLE',
  'POLYGON', 'CIRCLE', 'CIRCLECD', 'CIRCLE2P',
  'CIRCLE3P', 'CIRCLETTR', 'CIRCLETTT', 'PLINE',
  'TRAVERSE', 'BATCH_COGO', 'ARC_3PT', 'ARC_CREATE',
  'TANGENT_CURVE', 'ALIGNMENT_CREATE', 'ALIGNMENT_OFFSET_CREATE', 'ALIGNMENT_STATION_REPORT',
  'ALIGNMENT_STATION_EQUATION', 'ALIGNMENT_OFFSET_POINT', 'ALIGNMENT_INTERVAL_POINTS', 'PARCEL_CREATE',
  'PARCEL_SPLIT', 'PARCEL_SPLIT_BEARING', 'PARCEL_SPLIT_AREA', 'PARCEL_SPLIT_SLIDE',
  'PARCEL_SPLIT_SWING', 'PARCELCOURSEARC', 'PARCELCOURSELINE', 'PARCEL_LAYOUT_AUTO',
  'LINETABLE', 'CURVETABLE', 'PARCELTABLE', 'POINTTABLE',
  'PARCELREPORT', 'PARCELDESC', 'PARCELDESIGNATE', 'PARCELNUMBER',
  'PARCELLINK', 'PARCELUNLINK', 'PARCELSHAREDEDIT', 'PARCELCHECK',
  'PARCELSCHEDULE', 'TABLESTYLE', 'SURVEYTABLE_EDIT', 'MOVE',
  'COPY', 'ROTATE', 'SCALE', 'MIRROR',
  'ALIGN2D', 'HELMERT2D', 'GRIDGROUND', 'PROJECTTRANSFORM',
  'EXTEND', 'FILLET', 'PASTE', 'TRIM',
  'INTERSECT_POINT', 'EDIT_ENTITY', 'GRIP_EDIT', 'SHEET_ADD',
  'SHEET_DELETE', 'VIEWPORT_MOVE', 'VIEWPORT_SCALE', 'VIEWPORT_ROTATE',
  'TITLE_BLOCK_EDIT', 'BLOCK_SEED', 'BLOCK_CREATE', 'BLOCK_DUPLICATE',
  'BLOCK_RENAME', 'BLOCK_REDEFINE', 'BLOCK_DELETE', 'BLOCK_INSERT',
  'BLOCK_EXPLODE', 'BLOCK_EDIT', 'LAYER_CREATE', 'LAYER_RENAME',
  'LAYER_VISIBILITY', 'LAYER_LOCKED', 'LAYER_PRINTABLE', 'LAYER_COLOR',
  'LAYER_LINETYPE', 'LAYER_LINEWEIGHT', 'LAYER_TRANSPARENCY', 'LAYER_FROZEN',
  'LAYER_DESCRIPTION', 'LAYER_SET_CURRENT', 'LAYER_MOVE_OBJECTS', 'LAYER_DELETE',
  'F2F_GENERATE', 'SURVEY_POINT_OVERRIDE', 'SURVEY_STYLE_TABLE', 'SURVEY_GROUP_TABLE',
  'SURFACE_CREATE', 'SURFACE_DELETE', 'SURFACE_RENAME', 'SURFACE_SET_LAYER_STYLE',
  'SURFACE_ADD_POINT_GROUP', 'SURFACE_REMOVE_POINT_GROUP', 'SURFACE_ADD_POINTS', 'SURFACE_REMOVE_SOURCE',
  'SURFACE_ADD_BREAKLINE', 'SURFACE_REMOVE_BREAKLINE', 'SURFACE_RENAME_BREAKLINE', 'SURFACE_BREAKLINE_INSERT_POINT',
  'SURFACE_BREAKLINE_REMOVE_POINT', 'SURFACE_BREAKLINE_REVERSE', 'SURFACE_BREAKLINE_REPLACE_CHAIN', 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN',
  'SURFACE_ADD_BOUNDARY', 'SURFACE_REMOVE_BOUNDARY', 'SURFACE_CREATE_BOUNDARY_SOURCE', 'SURFACE_REPLACE_BOUNDARY_SOURCE',
  'SURFACE_MAKE_BOUNDARY_INDEPENDENT', 'SURFACE_ADD_EDIT', 'SURFACE_DELETE_EDIT', 'SURFACE_MOVE_EDIT',
  'SURFACE_SET_EDIT_ENABLED', 'SURFACE_STYLE_CREATE', 'LANDXML_IMPORT', 'SURFACE_STYLE_DUPLICATE',
  'SURFACE_STYLE_RENAME', 'SURFACE_STYLE_UPDATE', 'SURFACE_STYLE_DELETE', 'SURFBAKE',
  'SURFBAKECOPY', 'SURFCOMPOSE', 'SURFCOMPOSEPASTE', 'VOLUME_SURFACE_CREATE',
  'VOLUME_SURFACE_DELETE', 'VOLUME_SURFACE_UPDATE_SOURCES', 'VOLUME_SURFACE_SET_LAYER_STYLE', 'VOLUME_STYLE_CREATE',
  'ANALYSIS_MAP_CREATE', 'ANALYSIS_MAP_UPDATE_BANDS', 'ANALYSIS_MAP_UPDATE_APPEARANCE', 'ANALYSIS_MAP_DELETE',
  'ANALYSIS_LEGEND_CREATE', 'ANALYSIS_LEGEND_UPDATE', 'ANALYSIS_LEGEND_MOVE', 'ANALYSIS_LEGEND_DELETE',
  'VOLUME_STYLE_DUPLICATE', 'VOLUME_STYLE_RENAME', 'VOLUME_STYLE_UPDATE', 'VOLUME_STYLE_DELETE',
  'PROFILE_CREATE', 'PROFILE_REBUILD', 'PROFILE_DELETE', 'PROFILE_VIEW_CREATE',
  'PROFILE_VIEW_UPDATE', 'PROFILE_VIEW_DELETE', 'PROFILE_STYLE_CREATE', 'PROFILE_STYLE_DUPLICATE',
  'PROFILE_STYLE_RENAME', 'PROFILE_STYLE_UPDATE', 'PROFILE_STYLE_DELETE', 'SAMPLE_GROUP_CREATE',
  'SAMPLE_GROUP_RENAME', 'SAMPLE_GROUP_DELETE', 'SAMPLE_LINE_ADD', 'SAMPLE_LINE_ADD_INTERVAL',
  'SAMPLE_LINE_UPDATE', 'SAMPLE_LINE_DELETE', 'SECTION_SOURCE_ADD', 'SECTION_SOURCE_REMOVE',
  'SECTION_SOURCE_SET_STYLE', 'SECTION_AREA_COMPARISON', 'SECTION_STYLE_CREATE', 'SECTION_STYLE_RENAME',
  'SECTION_STYLE_UPDATE', 'SECTION_STYLE_DELETE', 'SECTION_VIEW_CREATE', 'SECTION_VIEW_UPDATE',
  'SECTION_VIEW_DELETE', 'BLOCK_CREATE', 'BLOCK_INSERT', 'BLOCK_EXPLODE',
  'BLOCK_REDEFINE', 'BLOCK_RENAME', 'BLOCK_DUPLICATE', 'BLOCK_DELETE',
  'CREATE_MTEXT', 'CREATE_LEADER', 'CREATE_DIMENSION', 'CREATE_BEARING_LABEL',
  'CREATE_CURVE_LABEL', 'UPDATE_DIMENSION_PLACEMENT', 'REATTACH_ANNOTATION', 'SET_TEXT_OVERRIDE',
  'CLEAR_TEXT_OVERRIDE', 'SET_ANNOTATION_SCALE', 'ANNOTATION_COMMIT', 'FEATURELINE',
  'FEATURELINECREATE', 'FEATURELINEELEV', 'FLSETZ', 'FLRAISELOWER',
  'FLGRADE', 'FLINTERPOLATE', 'FLSURFACEELEV', 'FLREVERSE',
  'FLINQUIRY', 'FLINSERTVERTEX', 'FLDELETEVERTEX', 'SURFACE_ADD_FEATURE_LINE_BREAKLINE',
  'GRADING_CREATE', 'GRADING_DELETE', 'GRADING_EDIT_CRITERIA', 'GRADING_REASSIGN_TARGET',
  'GRADINGEXTRACTDAYLIGHT', 'GRADINGBAKE', 'GROUP_CREATE', 'GROUP_DELETE',
  'GROUP_EDIT_CRITERIA', 'GROUP_REASSIGN_TARGET', 'GROUP_EDIT_SPAN', 'GROUP_ADD_COURSE',
  'GROUP_REMOVE_END_COURSE', 'GROUP_SET_COURSE_CRITERIA', 'GROUP_RESET_COURSE_CRITERIA', 'GROUP_SET_TRANSITION',
  'GROUP_CLEAR_TRANSITION', 'GROUPEXTRACTDAYLIGHT', 'GROUPBAKE', 'SURFPURPOSE',
  'DESIGNSURFACE', 'DESIGNAPPLY', 'DESIGNVOLUME', 'DESIGNPATCH',
  'POLYLINE_INSERT_VERTEX', 'POLYLINE_DELETE_VERTEX', 'BEST_FIT_LINE', 'BEST_FIT_ARC',
  'BEST_FIT_PARABOLA', 'CURVE_BETWEEN_TWO_LINES_CREATE', 'CURVE_ON_TWO_LINES_CREATE', 'CURVE_THROUGH_POINT_CREATE',
  'MULTIPLE_CURVES_CREATE', 'CURVE_FROM_END_CREATE', 'REVERSE_COMPOUND_CURVE_CREATE', 'SUBDIVIDE_CURVE_CREATE',
] as const;
