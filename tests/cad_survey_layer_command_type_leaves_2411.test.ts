/**
 * STRUCT-241.1 — survey + layer command payload type leaves.
 *
 * Pins `src/engine/cad/cadTransactionsLayerCommandTypes.ts` and
 * `src/engine/cad/cadTransactionsSurveyCommandTypes.ts`:
 *  - exact key sets in exact union order (14 layer variants with distinct
 *    keys + 16 survey variants with intentionally repeated
 *    SURVEY_STYLE_TABLE / SURVEY_GROUP_TABLE keys);
 *  - `Extract<CadCommand, ...>` payload equivalence per variant for all 30
 *    members (typecheck-enforced; repeated survey keys narrow by their
 *    table/op discriminants, never by key alone);
 *  - independent baseline-shape pins: hand-written object-literal types
 *    transcribed from the pre-refactor hub source at exact baseline
 *    08e0b6d0 (layer variants at hub lines ~786-862, survey variants at
 *    ~868-978). They import no leaf type, so leaf drift cannot move both
 *    sides of an assertion. Foreign referenced types
 *    (CadEntityId/CadPointStyleId/CadPointLabelStyleId/CadPointStyle/
 *    CadPointLabelStyle/CadPointGroup/CadPointGroupId/CadPointGroupQuery)
 *    are shared references, not part of the moved surface;
 *  - runtime AST property-shape pins per variant (whitespace-normalized
 *    `name?: type` strings per variant, read from the leaf source at test
 *    time, so optionality/nullability/literal drift fails `vitest` even
 *    without a typecheck gate);
 *  - verbatim-body proof: the leaf bodies match the pinned transcribed
 *    shapes AND the hub `Extract` equivalence, plus source-text pins on
 *    all four documented payload comments (captured per-variant source
 *    text); full byte-verbatim equality against the pre-refactor hub
 *    slices was proven by parent-recorded baseline diff (see
 *    docs/evidence/struct-2411/validation.md section 2), since the
 *    post-splice hub holds refs instead of the inline bodies;
 *  - the hub `CadCommand` splice order (BLOCK_EDIT ->
 *    CadLayerCommandPayload -> F2F_GENERATE -> CadSurveyCommandPayload ->
 *    CadSurfaceCommandPayload ... LANDXML_IMPORT ->
 *    CadSectionViewDeleteCommand -> BLOCK_CREATE) with no leftover inline
 *    layer/survey keys, top-level member counts 168 -> 140, and an
 *    effective flattened member list of exactly 168;
 *  - `CadCommandKey` byte-identical (full ordered 248-literal list with the
 *    7 pre-existing BLOCK duplicates kept);
 *  - both leaves are type-only (zero value imports/exports; transpiled emit
 *    is `export {};`, and the hub emit is byte-identical before/after);
 *  - no type edge from either leaf back to `cadTransactions.types.ts` /
 *    `cadTransactions.ts` (via `scripts/cadTypeImportGraph.mjs`);
 *  - public transaction types (`CadTransaction`, `CadCommandState`,
 *    `CadCommandDefinition`) keep their exact member surfaces;
 *  - negative controls run IN MEMORY ONLY (mutated copies of the source
 *    text, worktree untouched): dropping `?` / `| null`, narrowing the
 *    LAYER_CREATE role union, removing one SURVEY_GROUP_TABLE op,
 *    reordering variants, and severing a hub splice ref each fail the
 *    corresponding positive guard.
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
  findCycles,
} from '../scripts/cadTypeImportGraph.mjs';

import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadEntityId } from '../src/engine/cad/cadCorePrimitiveTypes';
import type {
  CadPointGroup,
  CadPointGroupId,
  CadPointGroupQuery,
  CadPointLabelStyle,
  CadPointLabelStyleId,
  CadPointStyle,
  CadPointStyleId,
} from '../src/engine/cad/cadTypes';
import type { CadLayerCommandPayload } from '../src/engine/cad/cadTransactionsLayerCommandTypes';
import type { CadSurveyCommandPayload } from '../src/engine/cad/cadTransactionsSurveyCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const LAYER_LEAF = path.join(CAD_DIR, 'cadTransactionsLayerCommandTypes.ts');
const SURVEY_LEAF = path.join(CAD_DIR, 'cadTransactionsSurveyCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');

const LAYER_ALIAS = 'CadLayerCommandPayload';
const SURVEY_ALIAS = 'CadSurveyCommandPayload';

const parseText = (file: string, text: string): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const parse = (file: string): ts.SourceFile =>
  parseText(file, fs.readFileSync(file, 'utf8'));

const findAlias = (
  source: ts.SourceFile,
  label: string,
  aliasName: string,
): ts.TypeAliasDeclaration => {
  const alias = source.statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === aliasName,
  );
  if (!alias) throw new Error(`${label}: alias ${aliasName} missing`);
  return alias;
};

/** Unwrap parenthesized wrappers (hub intersections are parenthesized). */
const unwrap = (node: ts.TypeNode): ts.TypeNode =>
  ts.isParenthesizedTypeNode(node) ? unwrap(node.type) : node;

/** Ordered `key` string literals of every object variant in the alias union. */
const unionKeysInOrderFromSource = (
  source: ts.SourceFile,
  label: string,
  aliasName: string,
): string[] => {
  const alias = findAlias(source, label, aliasName);
  const keys: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    const flat = unwrap(node);
    if (ts.isUnionTypeNode(flat)) {
      flat.types.forEach(visit);
      return;
    }
    if (!ts.isTypeLiteralNode(flat)) return;
    const keyProp = flat.members.find(
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

const unionKeysInOrder = (file: string, label: string, aliasName: string): string[] =>
  unionKeysInOrderFromSource(parse(file), label, aliasName);

/** Collapse all whitespace so formatting drift cannot mask (or fake) type drift. */
const norm = (text: string): string => text.replace(/\s+/g, '');

/**
 * Pin-side normalization: like `norm`, but also drops a leading `|` bar of a
 * multiline union type (e.g. the LAYER_CREATE role union), matching the
 * runtime helper below so formatting cannot fake drift.
 */
const pinShape = (text: string): string => norm(text).replace(/:\|/g, ':');

interface VariantShape {
  key: string;
  table: string | null;
  op: string | null;
  props: string[];
  /** Exact variant source text (comments included, trivia excluded). */
  text: string;
}

const literalProp = (
  member: ts.TypeLiteralNode,
  name: string,
): string | null => {
  const prop = member.members.find(
    (m): m is ts.PropertySignature =>
      ts.isPropertySignature(m) && m.name.getText() === name,
  );
  if (!prop?.type || !ts.isLiteralTypeNode(prop.type) || !ts.isStringLiteral(prop.type.literal)) return null;
  return prop.type.literal.text;
};

/** Every object variant of the alias union, in declaration order. */
const variantShapesFromSource = (
  source: ts.SourceFile,
  label: string,
  aliasName: string,
): VariantShape[] => {
  const alias = findAlias(source, label, aliasName);
  if (!ts.isUnionTypeNode(alias.type)) throw new Error(`${label}: ${aliasName} is not a union`);
  const out: VariantShape[] = [];
  for (const member of alias.type.types) {
    const flat = unwrap(member);
    if (!ts.isTypeLiteralNode(flat)) continue;
    const keyProp = flat.members.find(
      (m): m is ts.PropertySignature =>
        ts.isPropertySignature(m) && m.name.getText() === 'key',
    );
    const literal = keyProp?.type;
    if (!literal || !ts.isLiteralTypeNode(literal) || !ts.isStringLiteral(literal.literal)) continue;
    out.push({
      key: literal.literal.text,
      table: literalProp(flat, 'table'),
      op: literalProp(flat, 'op'),
      props: flat.members
        .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
        .map((m) => pinShape(`${m.name.getText()}${m.questionToken ? '?' : ''}: ${m.type?.getText() ?? 'never'}`)),
      text: flat.getText(source),
    });
  }
  return out;
};

const variantShapes = (file: string, label: string, aliasName: string): VariantShape[] =>
  variantShapesFromSource(parse(file), label, aliasName);

/** Module specifiers reached by a runtime (non-`import type`) edge. */
const runtimeImportSpecifiers = (file: string, _label: string): string[] => {
  const out: string[] = [];
  for (const stmt of parse(file).statements) {
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
const allImportSpecifiers = (file: string, _label: string): string[] =>
  parse(file).statements
    .filter((stmt): stmt is ts.ImportDeclaration =>
      ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

/** Every import declaration must be type-only (`import type` or type-only bindings). */
const hasOnlyTypeImports = (file: string, _label: string): boolean => {
  for (const stmt of parse(file).statements) {
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
const valueStatementKinds = (file: string, _label: string): string[] =>
  parse(file).statements
    .filter((stmt) =>
      ts.isFunctionDeclaration(stmt)
      || ts.isVariableStatement(stmt)
      || ts.isClassDeclaration(stmt)
      || ts.isEnumDeclaration(stmt))
    .map((stmt) => ts.SyntaxKind[stmt.kind]);

/**
 * One descriptor per top-level hub `CadCommand` member: inline object
 * literals collapse to their `key` literal (multi-literal key unions keep
 * their normalized union text as a single descriptor), the two
 * STRUCT-241.1 leaf refs expand to their leaf key lists, every other ref
 * stays a ref name, and parenthesized intersections collapse to their
 * object-part `key` literal.
 */
const hubFlattenedKeys = (source?: ts.SourceFile): string[] => {
  const hub = source ?? parse(HUB);
  const alias = findAlias(hub, 'hub', 'CadCommand');
  const layerKeys = unionKeysInOrder(LAYER_LEAF, 'layer leaf', LAYER_ALIAS);
  const surveyKeys = unionKeysInOrder(SURVEY_LEAF, 'survey leaf', SURVEY_ALIAS);
  const keyDescriptor = (member: ts.TypeLiteralNode): string | null => {
    const keyProp = member.members.find(
      (m): m is ts.PropertySignature =>
        ts.isPropertySignature(m) && m.name.getText() === 'key',
    );
    const keyType = keyProp?.type;
    if (!keyType) return null;
    if (ts.isLiteralTypeNode(keyType) && ts.isStringLiteral(keyType.literal)) return keyType.literal.text;
    return norm(keyType.getText());
  };
  const members: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    const flat = unwrap(node);
    if (ts.isUnionTypeNode(flat)) {
      flat.types.forEach(visit);
      return;
    }
    if (ts.isTypeReferenceNode(flat) && ts.isIdentifier(flat.typeName)) {
      if (flat.typeName.text === LAYER_ALIAS) members.push(...layerKeys);
      else if (flat.typeName.text === SURVEY_ALIAS) members.push(...surveyKeys);
      else members.push(flat.typeName.text);
      return;
    }
    if (ts.isIntersectionTypeNode(flat)) {
      const literal = flat.types.map(unwrap).find((t): t is ts.TypeLiteralNode => ts.isTypeLiteralNode(t));
      const descriptor = literal ? keyDescriptor(literal) : null;
      if (descriptor) members.push(descriptor);
      return;
    }
    if (ts.isTypeLiteralNode(flat)) {
      const descriptor = keyDescriptor(flat);
      if (descriptor) members.push(descriptor);
    }
  };
  visit(alias.type);
  if (members.length === 0) throw new Error('CadCommand union parsed to zero members');
  return members;
};

/**
 * Every string-literal key carried by each inline object member of the hub
 * `CadCommand` union (multi-literal key unions expand to one entry per
 * literal). Intersections and refs are out of scope here.
 */
const hubInlineKeySets = (source?: ts.SourceFile): string[][] => {
  const hub = source ?? parse(HUB);
  const alias = findAlias(hub, 'hub', 'CadCommand');
  if (!ts.isUnionTypeNode(alias.type)) throw new Error('CadCommand is not a union');
  const sets: string[][] = [];
  for (const member of alias.type.types) {
    const flat = unwrap(member);
    if (!ts.isTypeLiteralNode(flat)) continue;
    const keyProp = flat.members.find(
      (m): m is ts.PropertySignature =>
        ts.isPropertySignature(m) && m.name.getText() === 'key',
    );
    const keyType = keyProp?.type;
    if (!keyType) continue;
    const literals: string[] = [];
    const collect = (node: ts.TypeNode): void => {
      if (ts.isUnionTypeNode(node)) {
        node.types.forEach(collect);
        return;
      }
      if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) literals.push(node.literal.text);
    };
    collect(keyType);
    if (literals.length > 0) sets.push(literals);
  }
  return sets;
};

/** Top-level hub `CadCommand` member counts by syntactic kind. */
const hubTopLevelCounts = (source?: ts.SourceFile): { total: number; inline: number; refs: number; intersections: number } => {
  const hub = source ?? parse(HUB);
  const alias = findAlias(hub, 'hub', 'CadCommand');
  if (!ts.isUnionTypeNode(alias.type)) throw new Error('CadCommand is not a union');
  let inline = 0;
  let refs = 0;
  let intersections = 0;
  for (const member of alias.type.types) {
    const flat = unwrap(member);
    if (ts.isTypeLiteralNode(flat)) inline += 1;
    else if (ts.isTypeReferenceNode(flat)) refs += 1;
    else if (ts.isIntersectionTypeNode(flat)) intersections += 1;
    else throw new Error(`unexpected CadCommand member kind ${ts.SyntaxKind[flat.kind]}`);
  }
  return { total: alias.type.types.length, inline, refs, intersections };
};

/** Ordered string literals of the hub `CadCommandKey` union (duplicates kept). */
const hubKeyOrder = (): string[] => {
  const alias = findAlias(parse(HUB), 'hub', 'CadCommandKey');
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

/** Transpiled ES-module emit with comments stripped (type-only => `export {};`). */
const strippedEmit = (file: string): string => {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      removeComments: true,
    },
  });
  return outputText.trim();
};

const EXPECTED_LAYER_KEYS = [
  'LAYER_CREATE',
  'LAYER_RENAME',
  'LAYER_VISIBILITY',
  'LAYER_LOCKED',
  'LAYER_PRINTABLE',
  'LAYER_COLOR',
  'LAYER_LINETYPE',
  'LAYER_LINEWEIGHT',
  'LAYER_TRANSPARENCY',
  'LAYER_FROZEN',
  'LAYER_DESCRIPTION',
  'LAYER_SET_CURRENT',
  'LAYER_MOVE_OBJECTS',
  'LAYER_DELETE',
] as const;

type LayerKey = (typeof EXPECTED_LAYER_KEYS)[number];

interface ExpectedSurveyVariant {
  key: string;
  table: string | null;
  op: string | null;
  props: string[];
}

const EXPECTED_SURVEY_VARIANTS: ExpectedSurveyVariant[] = [
  {
    key: 'SURVEY_POINT_OVERRIDE',
    table: null,
    op: null,
    props: [
      "key: 'SURVEY_POINT_OVERRIDE'",
      'entityIds: CadEntityId[]',
      'pointStyleOverrideId?: CadPointStyleId | null',
      'pointLabelStyleOverrideId?: CadPointLabelStyleId | null',
    ],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'point',
    op: 'create',
    props: ["key: 'SURVEY_STYLE_TABLE'", "table: 'point'", "op: 'create'", 'style: CadPointStyle'],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'point',
    op: 'duplicate',
    props: [
      "key: 'SURVEY_STYLE_TABLE'",
      "table: 'point'",
      "op: 'duplicate'",
      'styleId: CadPointStyleId',
      'newId: CadPointStyleId',
      'name: string',
    ],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'point',
    op: 'rename',
    props: [
      "key: 'SURVEY_STYLE_TABLE'",
      "table: 'point'",
      "op: 'rename'",
      'styleId: CadPointStyleId',
      'name: string',
    ],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'point',
    op: 'update',
    props: [
      "key: 'SURVEY_STYLE_TABLE'",
      "table: 'point'",
      "op: 'update'",
      'styleId: CadPointStyleId',
      'patch: Partial<CadPointStyle>',
    ],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'point',
    op: 'delete',
    props: [
      "key: 'SURVEY_STYLE_TABLE'",
      "table: 'point'",
      "op: 'delete'",
      'styleId: CadPointStyleId',
      'replacementId?: CadPointStyleId',
    ],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'label',
    op: 'create',
    props: ["key: 'SURVEY_STYLE_TABLE'", "table: 'label'", "op: 'create'", 'style: CadPointLabelStyle'],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'label',
    op: 'duplicate',
    props: [
      "key: 'SURVEY_STYLE_TABLE'",
      "table: 'label'",
      "op: 'duplicate'",
      'styleId: CadPointLabelStyleId',
      'newId: CadPointLabelStyleId',
      'name: string',
    ],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'label',
    op: 'rename',
    props: [
      "key: 'SURVEY_STYLE_TABLE'",
      "table: 'label'",
      "op: 'rename'",
      'styleId: CadPointLabelStyleId',
      'name: string',
    ],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'label',
    op: 'update',
    props: [
      "key: 'SURVEY_STYLE_TABLE'",
      "table: 'label'",
      "op: 'update'",
      'styleId: CadPointLabelStyleId',
      'patch: Partial<CadPointLabelStyle>',
    ],
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'label',
    op: 'delete',
    props: [
      "key: 'SURVEY_STYLE_TABLE'",
      "table: 'label'",
      "op: 'delete'",
      'styleId: CadPointLabelStyleId',
      'replacementId?: CadPointLabelStyleId',
    ],
  },
  {
    key: 'SURVEY_GROUP_TABLE',
    table: null,
    op: 'create',
    props: ["key: 'SURVEY_GROUP_TABLE'", "op: 'create'", 'group: CadPointGroup'],
  },
  {
    key: 'SURVEY_GROUP_TABLE',
    table: null,
    op: 'rename',
    props: ["key: 'SURVEY_GROUP_TABLE'", "op: 'rename'", 'groupId: CadPointGroupId', 'name: string'],
  },
  {
    key: 'SURVEY_GROUP_TABLE',
    table: null,
    op: 'update',
    props: [
      "key: 'SURVEY_GROUP_TABLE'",
      "op: 'update'",
      'groupId: CadPointGroupId',
      'query?: Partial<CadPointGroupQuery>',
      'description?: string | null',
      'pointStyleOverrideId?: CadPointStyleId | null',
      'pointLabelStyleOverrideId?: CadPointLabelStyleId | null',
    ],
  },
  {
    key: 'SURVEY_GROUP_TABLE',
    table: null,
    op: 'move',
    props: [
      "key: 'SURVEY_GROUP_TABLE'",
      "op: 'move'",
      'groupId: CadPointGroupId',
      "direction: 'up' | 'down'",
    ],
  },
  {
    key: 'SURVEY_GROUP_TABLE',
    table: null,
    op: 'delete',
    props: ["key: 'SURVEY_GROUP_TABLE'", "op: 'delete'", 'groupId: CadPointGroupId'],
  },
];

const EXPECTED_LAYER_SHAPES: Record<LayerKey, string[]> = {
  LAYER_CREATE: [
    "key: 'LAYER_CREATE'",
    'name: string',
    'color?: string',
    `role?: 'points' | 'control-points' | 'observation-lines' | 'error-ellipses' | 'labels' | 'parcels' | 'surfaces' | 'planning'`,
  ],
  LAYER_RENAME: ["key: 'LAYER_RENAME'", 'layerId: string', 'name: string'],
  LAYER_VISIBILITY: ["key: 'LAYER_VISIBILITY'", 'layerId: string', 'visible: boolean'],
  LAYER_LOCKED: ["key: 'LAYER_LOCKED'", 'layerId: string', 'locked: boolean'],
  LAYER_PRINTABLE: ["key: 'LAYER_PRINTABLE'", 'layerId: string', 'printable: boolean'],
  LAYER_COLOR: ["key: 'LAYER_COLOR'", 'layerId: string', 'color: string'],
  LAYER_LINETYPE: ["key: 'LAYER_LINETYPE'", 'layerId: string', 'lineTypeId: string'],
  LAYER_LINEWEIGHT: ["key: 'LAYER_LINEWEIGHT'", 'layerId: string', 'lineweightMm?: number'],
  LAYER_TRANSPARENCY: ["key: 'LAYER_TRANSPARENCY'", 'layerId: string', 'transparency: number'],
  LAYER_FROZEN: ["key: 'LAYER_FROZEN'", 'layerId: string', 'frozen: boolean'],
  LAYER_DESCRIPTION: ["key: 'LAYER_DESCRIPTION'", 'layerId: string', 'description: string'],
  LAYER_SET_CURRENT: ["key: 'LAYER_SET_CURRENT'", 'layerId: string'],
  LAYER_MOVE_OBJECTS: ["key: 'LAYER_MOVE_OBJECTS'", 'fromLayerId: string', 'toLayerId: string'],
  LAYER_DELETE: ["key: 'LAYER_DELETE'", 'layerId: string'],
};

/** Top-level field names derived from the transcribed shapes (sample key pins). */
const expectedFieldNames = (shapes: string[]): string[] =>
  shapes.map((shape) => norm(shape).split(':')[0]!.replace(/\?$/, ''));

// ---------------------------------------------------------------------------
// Independent baseline pins (STRUCT-241.1).
//
// Hand-transcribed from the pre-refactor hub baseline at exact origin/main
// 08e0b6d0 (`src/engine/cad/cadTransactions.types.ts`: layer variants at
// hub lines ~786-862, survey variants at ~868-978). They import no leaf
// type, so leaf drift cannot move both sides of an assertion. Foreign
// referenced types are shared references, not part of the moved surface.
// ---------------------------------------------------------------------------

type BaseLayerCreate = {
  key: 'LAYER_CREATE';
  name: string;
  color?: string;
  role?:
    | 'points'
    | 'control-points'
    | 'observation-lines'
    | 'error-ellipses'
    | 'labels'
    | 'parcels'
    | 'surfaces'
    | 'planning';
};

type BaseLayerRename = {
  key: 'LAYER_RENAME';
  layerId: string;
  name: string;
};

type BaseLayerVisibility = {
  key: 'LAYER_VISIBILITY';
  layerId: string;
  visible: boolean;
};

type BaseLayerLocked = {
  key: 'LAYER_LOCKED';
  layerId: string;
  locked: boolean;
};

type BaseLayerPrintable = {
  key: 'LAYER_PRINTABLE';
  layerId: string;
  printable: boolean;
};

type BaseLayerColor = {
  key: 'LAYER_COLOR';
  layerId: string;
  color: string;
};

type BaseLayerLineType = {
  key: 'LAYER_LINETYPE';
  layerId: string;
  lineTypeId: string;
};

type BaseLayerLineweight = {
  key: 'LAYER_LINEWEIGHT';
  layerId: string;
  /** Undefined = Default. */
  lineweightMm?: number;
};

type BaseLayerTransparency = {
  key: 'LAYER_TRANSPARENCY';
  layerId: string;
  transparency: number;
};

type BaseLayerFrozen = {
  key: 'LAYER_FROZEN';
  layerId: string;
  frozen: boolean;
};

type BaseLayerDescription = {
  key: 'LAYER_DESCRIPTION';
  layerId: string;
  description: string;
};

type BaseLayerSetCurrent = {
  key: 'LAYER_SET_CURRENT';
  layerId: string;
};

type BaseLayerMoveObjects = {
  key: 'LAYER_MOVE_OBJECTS';
  fromLayerId: string;
  toLayerId: string;
};

type BaseLayerDelete = {
  key: 'LAYER_DELETE';
  layerId: string;
};

type BaseSurveyPointOverride = {
  key: 'SURVEY_POINT_OVERRIDE';
  entityIds: CadEntityId[];
  /** undefined = leave, null = clear, id = set (must exist in its table). */
  pointStyleOverrideId?: CadPointStyleId | null;
  /** undefined = leave, null = clear, id = set (must exist in its table). */
  pointLabelStyleOverrideId?: CadPointLabelStyleId | null;
};

type BaseSurveyStylePointCreate = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'point';
  op: 'create';
  style: CadPointStyle;
};

type BaseSurveyStylePointDuplicate = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'point';
  op: 'duplicate';
  styleId: CadPointStyleId;
  newId: CadPointStyleId;
  name: string;
};

type BaseSurveyStylePointRename = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'point';
  op: 'rename';
  styleId: CadPointStyleId;
  name: string;
};

type BaseSurveyStylePointUpdate = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'point';
  op: 'update';
  styleId: CadPointStyleId;
  patch: Partial<CadPointStyle>;
};

type BaseSurveyStylePointDelete = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'point';
  op: 'delete';
  styleId: CadPointStyleId;
  /** Required when points/groups reference the style; refs rewire to it. */
  replacementId?: CadPointStyleId;
};

type BaseSurveyStyleLabelCreate = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'label';
  op: 'create';
  style: CadPointLabelStyle;
};

type BaseSurveyStyleLabelDuplicate = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'label';
  op: 'duplicate';
  styleId: CadPointLabelStyleId;
  newId: CadPointLabelStyleId;
  name: string;
};

type BaseSurveyStyleLabelRename = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'label';
  op: 'rename';
  styleId: CadPointLabelStyleId;
  name: string;
};

type BaseSurveyStyleLabelUpdate = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'label';
  op: 'update';
  styleId: CadPointLabelStyleId;
  patch: Partial<CadPointLabelStyle>;
};

type BaseSurveyStyleLabelDelete = {
  key: 'SURVEY_STYLE_TABLE';
  table: 'label';
  op: 'delete';
  styleId: CadPointLabelStyleId;
  /** Required when points/groups reference the style; refs rewire to it. */
  replacementId?: CadPointLabelStyleId;
};

type BaseSurveyGroupCreate = {
  key: 'SURVEY_GROUP_TABLE';
  op: 'create';
  group: CadPointGroup;
};

type BaseSurveyGroupRename = {
  key: 'SURVEY_GROUP_TABLE';
  op: 'rename';
  groupId: CadPointGroupId;
  name: string;
};

type BaseSurveyGroupUpdate = {
  key: 'SURVEY_GROUP_TABLE';
  op: 'update';
  groupId: CadPointGroupId;
  query?: Partial<CadPointGroupQuery>;
  description?: string | null;
  /** undefined = leave, null = clear, id = set (must exist in its table). */
  pointStyleOverrideId?: CadPointStyleId | null;
  /** undefined = leave, null = clear, id = set (must exist in its table). */
  pointLabelStyleOverrideId?: CadPointLabelStyleId | null;
};

type BaseSurveyGroupMove = {
  key: 'SURVEY_GROUP_TABLE';
  op: 'move';
  groupId: CadPointGroupId;
  direction: 'up' | 'down';
};

type BaseSurveyGroupDelete = {
  key: 'SURVEY_GROUP_TABLE';
  op: 'delete';
  groupId: CadPointGroupId;
};

type BaseSurveyPointStyleTable =
  | BaseSurveyStylePointCreate
  | BaseSurveyStylePointDuplicate
  | BaseSurveyStylePointRename
  | BaseSurveyStylePointUpdate
  | BaseSurveyStylePointDelete;

type BaseSurveyLabelStyleTable =
  | BaseSurveyStyleLabelCreate
  | BaseSurveyStyleLabelDuplicate
  | BaseSurveyStyleLabelRename
  | BaseSurveyStyleLabelUpdate
  | BaseSurveyStyleLabelDelete;

type BaseSurveyGroupTable =
  | BaseSurveyGroupCreate
  | BaseSurveyGroupRename
  | BaseSurveyGroupUpdate
  | BaseSurveyGroupMove
  | BaseSurveyGroupDelete;

// Full-field samples: every declared field present, so leaf drift (dropped
// optional, added required, renamed field) breaks either the annotation
// (typecheck) or the runtime key assertion below. Complex snapshots use
// shared-reference casts; payload-level fields stay literal.
const layerSamples: CadLayerCommandPayload[] = [
  { key: 'LAYER_CREATE', name: 'L1', color: '#fff', role: 'planning' },
  { key: 'LAYER_RENAME', layerId: 'L1', name: 'L2' },
  { key: 'LAYER_VISIBILITY', layerId: 'L1', visible: true },
  { key: 'LAYER_LOCKED', layerId: 'L1', locked: false },
  { key: 'LAYER_PRINTABLE', layerId: 'L1', printable: true },
  { key: 'LAYER_COLOR', layerId: 'L1', color: '#000' },
  { key: 'LAYER_LINETYPE', layerId: 'L1', lineTypeId: 'lt-1' },
  { key: 'LAYER_LINEWEIGHT', layerId: 'L1', lineweightMm: 0.5 },
  { key: 'LAYER_TRANSPARENCY', layerId: 'L1', transparency: 50 },
  { key: 'LAYER_FROZEN', layerId: 'L1', frozen: false },
  { key: 'LAYER_DESCRIPTION', layerId: 'L1', description: 'd' },
  { key: 'LAYER_SET_CURRENT', layerId: 'L1' },
  { key: 'LAYER_MOVE_OBJECTS', fromLayerId: 'L1', toLayerId: 'L2' },
  { key: 'LAYER_DELETE', layerId: 'L1' },
];

const surveySamples: CadSurveyCommandPayload[] = [
  {
    key: 'SURVEY_POINT_OVERRIDE',
    entityIds: ['e-1'],
    pointStyleOverrideId: null,
    pointLabelStyleOverrideId: 'ls-1',
  },
  { key: 'SURVEY_STYLE_TABLE', table: 'point', op: 'create', style: {} as CadPointStyle },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'point',
    op: 'duplicate',
    styleId: 's-1',
    newId: 's-2',
    name: 'n',
  },
  { key: 'SURVEY_STYLE_TABLE', table: 'point', op: 'rename', styleId: 's-1', name: 'n' },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'point',
    op: 'update',
    styleId: 's-1',
    patch: { name: 'n' },
  },
  { key: 'SURVEY_STYLE_TABLE', table: 'point', op: 'delete', styleId: 's-1', replacementId: 's-2' },
  { key: 'SURVEY_STYLE_TABLE', table: 'label', op: 'create', style: {} as CadPointLabelStyle },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'label',
    op: 'duplicate',
    styleId: 'ls-1',
    newId: 'ls-2',
    name: 'n',
  },
  { key: 'SURVEY_STYLE_TABLE', table: 'label', op: 'rename', styleId: 'ls-1', name: 'n' },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'label',
    op: 'update',
    styleId: 'ls-1',
    patch: { name: 'n' },
  },
  {
    key: 'SURVEY_STYLE_TABLE',
    table: 'label',
    op: 'delete',
    styleId: 'ls-1',
    replacementId: 'ls-2',
  },
  { key: 'SURVEY_GROUP_TABLE', op: 'create', group: {} as CadPointGroup },
  { key: 'SURVEY_GROUP_TABLE', op: 'rename', groupId: 'g-1', name: 'n' },
  {
    key: 'SURVEY_GROUP_TABLE',
    op: 'update',
    groupId: 'g-1',
    query: {},
    description: null,
    pointStyleOverrideId: null,
    pointLabelStyleOverrideId: 'ls-1',
  },
  { key: 'SURVEY_GROUP_TABLE', op: 'move', groupId: 'g-1', direction: 'up' },
  { key: 'SURVEY_GROUP_TABLE', op: 'delete', groupId: 'g-1' },
];

// Compile-time hub <-> leaf round trip (enforced by project typecheck).
const leafToHub = (payload: CadLayerCommandPayload | CadSurveyCommandPayload): CadCommand => payload;

// ---------------------------------------------------------------------------

describe('STRUCT-241.1 leaf presence', () => {
  it('both survey/layer leaves exist before any shape assertion runs', () => {
    for (const [label, file] of [
      ['layer leaf', LAYER_LEAF],
      ['survey leaf', SURVEY_LEAF],
    ] as const) {
      expect(fs.existsSync(file), `${label} missing: ${path.relative(REPO_ROOT, file)}`).toBe(true);
    }
  });
});

describe('STRUCT-241.1 leaf key sets in exact union order', () => {
  it('pins the 14 distinct layer keys in order with no duplication or gaps', () => {
    const keys = unionKeysInOrder(LAYER_LEAF, 'layer leaf', LAYER_ALIAS);
    expect(keys).toEqual([...EXPECTED_LAYER_KEYS]);
    expect(new Set(keys).size).toBe(EXPECTED_LAYER_KEYS.length);
  });

  it('pins the 16 survey (key, table, op) discriminants in order, repeats kept', () => {
    const variants = variantShapes(SURVEY_LEAF, 'survey leaf', SURVEY_ALIAS);
    expect(variants.map((v) => [v.key, v.table, v.op])).toEqual(
      EXPECTED_SURVEY_VARIANTS.map((v) => [v.key, v.table, v.op]),
    );
    expect(variants.map((v) => v.key)).toEqual([
      'SURVEY_POINT_OVERRIDE',
      ...Array<string>(10).fill('SURVEY_STYLE_TABLE'),
      ...Array<string>(5).fill('SURVEY_GROUP_TABLE'),
    ]);
  });

  it('keeps the two families disjoint with no cross-contamination', () => {
    const layerKeys = unionKeysInOrder(LAYER_LEAF, 'layer leaf', LAYER_ALIAS);
    const surveyKeys = unionKeysInOrder(SURVEY_LEAF, 'survey leaf', SURVEY_ALIAS);
    for (const key of layerKeys) expect(surveyKeys).not.toContain(key);
    for (const key of surveyKeys) expect(layerKeys).not.toContain(key);
    for (const key of [...layerKeys, ...new Set(surveyKeys)]) {
      expect(key).not.toBe('F2F_GENERATE');
      expect(key).not.toBe('LANDXML_IMPORT');
    }
  });

  it('compiles one full-field sample per variant (required-field probe)', () => {
    expect(layerSamples.map((sample) => sample.key)).toEqual([...EXPECTED_LAYER_KEYS]);
    expect(surveySamples.map((sample) => [sample.key, 'table' in sample ? sample.table : null, 'op' in sample ? sample.op : null])).toEqual(
      EXPECTED_SURVEY_VARIANTS.map((v) => [v.key, v.table, v.op]),
    );
    expect(leafToHub(layerSamples[0]!)).toBe(layerSamples[0]);
    expect(leafToHub(surveySamples[0]!)).toBe(surveySamples[0]);
  });

  it('samples carry every declared field at runtime (no omitted/extra field)', () => {
    for (const sample of layerSamples) {
      expect(Object.keys(sample).sort()).toEqual(
        [...expectedFieldNames(EXPECTED_LAYER_SHAPES[sample.key])].sort(),
      );
    }
    surveySamples.forEach((sample, index) => {
      expect(Object.keys(sample).sort()).toEqual(
        [...expectedFieldNames(EXPECTED_SURVEY_VARIANTS[index]!.props)].sort(),
      );
    });
  });
});

describe('STRUCT-241.1 Extract<CadCommand> payload equivalence (drift-failing)', () => {
  it('matches the hub slice for every layer key', () => {
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_CREATE' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_CREATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_RENAME' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_RENAME' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_VISIBILITY' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_VISIBILITY' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_LOCKED' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_LOCKED' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_PRINTABLE' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_PRINTABLE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_COLOR' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_COLOR' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_LINETYPE' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_LINETYPE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_LINEWEIGHT' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_LINEWEIGHT' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_TRANSPARENCY' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_TRANSPARENCY' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_FROZEN' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_FROZEN' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_DESCRIPTION' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_DESCRIPTION' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_SET_CURRENT' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_SET_CURRENT' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_MOVE_OBJECTS' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_MOVE_OBJECTS' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_DELETE' }>>().toEqualTypeOf<
      Extract<CadLayerCommandPayload, { key: 'LAYER_DELETE' }>
    >();
  });

  it('matches the hub slice for every survey variant via table/op narrowing', () => {
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_POINT_OVERRIDE' }>>().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_POINT_OVERRIDE' }>
    >();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'create' }>
    >().toEqualTypeOf<Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'create' }>>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'duplicate' }>
    >().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'duplicate' }>
    >();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'rename' }>
    >().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'rename' }>
    >();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'update' }>
    >().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'update' }>
    >();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'delete' }>
    >().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'delete' }>
    >();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'create' }>
    >().toEqualTypeOf<Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'create' }>>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'duplicate' }>
    >().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'duplicate' }>
    >();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'rename' }>
    >().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'rename' }>
    >();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'update' }>
    >().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'update' }>
    >();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'delete' }>
    >().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'delete' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'create' }>>().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'create' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'rename' }>>().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'rename' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'update' }>>().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'update' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'move' }>>().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'move' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'delete' }>>().toEqualTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'delete' }>
    >();
  });

  it('keeps key-alone narrowing at 10 style / 5 group variants (table/op split)', () => {
    // Key-alone Extract intentionally returns the repeated-key families whole;
    // the table (and op) discriminants split them into exact 5-member unions.
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point' }>
    >().toEqualTypeOf<BaseSurveyPointStyleTable>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point' }>
    >().toEqualTypeOf<BaseSurveyPointStyleTable>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label' }>
    >().toEqualTypeOf<BaseSurveyLabelStyleTable>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label' }>
    >().toEqualTypeOf<BaseSurveyLabelStyleTable>();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE' }>>().toEqualTypeOf<BaseSurveyGroupTable>();
    expectTypeOf<Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE' }>>()
      .toEqualTypeOf<BaseSurveyGroupTable>();
    expectTypeOf<Extract<CadCommand, { key: LayerKey }>>().toEqualTypeOf<CadLayerCommandPayload>();
  });

  it('probes optionality, nullability, and literal drift points', () => {
    // Optional-without-null vs optional-with-null must not collapse.
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_CREATE' }>['color']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_CREATE' }>['role']>().toEqualTypeOf<
      | 'points'
      | 'control-points'
      | 'observation-lines'
      | 'error-ellipses'
      | 'labels'
      | 'parcels'
      | 'surfaces'
      | 'planning'
      | undefined
    >();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_LINEWEIGHT' }>['lineweightMm']>()
      .toEqualTypeOf<number | undefined>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_POINT_OVERRIDE' }>['pointStyleOverrideId']
    >().toEqualTypeOf<CadPointStyleId | null | undefined>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'update' }>['description']
    >().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'move' }>['direction']
    >().toEqualTypeOf<'up' | 'down'>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'update' }>['query']
    >().toEqualTypeOf<Partial<CadPointGroupQuery> | undefined>();
  });
});

describe('STRUCT-241.1 independent baseline pins: layer payloads', () => {
  it('matches the pre-refactor hub shape for every layer key (hub and leaf)', () => {
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_CREATE' }>>().toEqualTypeOf<BaseLayerCreate>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_CREATE' }>>().toEqualTypeOf<BaseLayerCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_RENAME' }>>().toEqualTypeOf<BaseLayerRename>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_RENAME' }>>().toEqualTypeOf<BaseLayerRename>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_VISIBILITY' }>>().toEqualTypeOf<BaseLayerVisibility>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_VISIBILITY' }>>()
      .toEqualTypeOf<BaseLayerVisibility>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_LOCKED' }>>().toEqualTypeOf<BaseLayerLocked>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_LOCKED' }>>().toEqualTypeOf<BaseLayerLocked>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_PRINTABLE' }>>().toEqualTypeOf<BaseLayerPrintable>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_PRINTABLE' }>>()
      .toEqualTypeOf<BaseLayerPrintable>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_COLOR' }>>().toEqualTypeOf<BaseLayerColor>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_COLOR' }>>().toEqualTypeOf<BaseLayerColor>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_LINETYPE' }>>().toEqualTypeOf<BaseLayerLineType>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_LINETYPE' }>>().toEqualTypeOf<BaseLayerLineType>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_LINEWEIGHT' }>>().toEqualTypeOf<BaseLayerLineweight>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_LINEWEIGHT' }>>()
      .toEqualTypeOf<BaseLayerLineweight>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_TRANSPARENCY' }>>().toEqualTypeOf<BaseLayerTransparency>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_TRANSPARENCY' }>>()
      .toEqualTypeOf<BaseLayerTransparency>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_FROZEN' }>>().toEqualTypeOf<BaseLayerFrozen>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_FROZEN' }>>().toEqualTypeOf<BaseLayerFrozen>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_DESCRIPTION' }>>().toEqualTypeOf<BaseLayerDescription>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_DESCRIPTION' }>>()
      .toEqualTypeOf<BaseLayerDescription>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_SET_CURRENT' }>>().toEqualTypeOf<BaseLayerSetCurrent>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_SET_CURRENT' }>>()
      .toEqualTypeOf<BaseLayerSetCurrent>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_MOVE_OBJECTS' }>>().toEqualTypeOf<BaseLayerMoveObjects>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_MOVE_OBJECTS' }>>()
      .toEqualTypeOf<BaseLayerMoveObjects>();
    expectTypeOf<Extract<CadCommand, { key: 'LAYER_DELETE' }>>().toEqualTypeOf<BaseLayerDelete>();
    expectTypeOf<Extract<CadLayerCommandPayload, { key: 'LAYER_DELETE' }>>().toEqualTypeOf<BaseLayerDelete>();
  });

  it('matches the transcribed runtime property shapes for every layer key', () => {
    const variants = variantShapes(LAYER_LEAF, 'layer leaf', LAYER_ALIAS);
    expect(variants.map((v) => v.key)).toEqual([...EXPECTED_LAYER_KEYS]);
    variants.forEach((variant, index) => {
      const key = EXPECTED_LAYER_KEYS[index]!;
      expect(variant.props, `${key} property drift`).toEqual(EXPECTED_LAYER_SHAPES[key].map(pinShape));
    });
  });
});

describe('STRUCT-241.1 independent baseline pins: survey payloads', () => {
  it('matches the pre-refactor hub shape for the point-override variant', () => {
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_POINT_OVERRIDE' }>>()
      .toEqualTypeOf<BaseSurveyPointOverride>();
    expectTypeOf<Extract<CadSurveyCommandPayload, { key: 'SURVEY_POINT_OVERRIDE' }>>()
      .toEqualTypeOf<BaseSurveyPointOverride>();
  });

  it('matches the pre-refactor hub shape for every point style-table variant', () => {
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'create' }>
    >().toEqualTypeOf<BaseSurveyStylePointCreate>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'create' }>
    >().toEqualTypeOf<BaseSurveyStylePointCreate>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'duplicate' }>
    >().toEqualTypeOf<BaseSurveyStylePointDuplicate>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'duplicate' }>
    >().toEqualTypeOf<BaseSurveyStylePointDuplicate>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'rename' }>
    >().toEqualTypeOf<BaseSurveyStylePointRename>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'rename' }>
    >().toEqualTypeOf<BaseSurveyStylePointRename>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'update' }>
    >().toEqualTypeOf<BaseSurveyStylePointUpdate>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'update' }>
    >().toEqualTypeOf<BaseSurveyStylePointUpdate>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'delete' }>
    >().toEqualTypeOf<BaseSurveyStylePointDelete>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'point'; op: 'delete' }>
    >().toEqualTypeOf<BaseSurveyStylePointDelete>();
  });

  it('matches the pre-refactor hub shape for every label style-table variant', () => {
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'create' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelCreate>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'create' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelCreate>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'duplicate' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelDuplicate>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'duplicate' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelDuplicate>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'rename' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelRename>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'rename' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelRename>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'update' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelUpdate>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'update' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelUpdate>();
    expectTypeOf<
      Extract<CadCommand, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'delete' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelDelete>();
    expectTypeOf<
      Extract<CadSurveyCommandPayload, { key: 'SURVEY_STYLE_TABLE'; table: 'label'; op: 'delete' }>
    >().toEqualTypeOf<BaseSurveyStyleLabelDelete>();
  });

  it('matches the pre-refactor hub shape for every group-table variant', () => {
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'create' }>>()
      .toEqualTypeOf<BaseSurveyGroupCreate>();
    expectTypeOf<Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'create' }>>()
      .toEqualTypeOf<BaseSurveyGroupCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'rename' }>>()
      .toEqualTypeOf<BaseSurveyGroupRename>();
    expectTypeOf<Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'rename' }>>()
      .toEqualTypeOf<BaseSurveyGroupRename>();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'update' }>>()
      .toEqualTypeOf<BaseSurveyGroupUpdate>();
    expectTypeOf<Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'update' }>>()
      .toEqualTypeOf<BaseSurveyGroupUpdate>();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'move' }>>()
      .toEqualTypeOf<BaseSurveyGroupMove>();
    expectTypeOf<Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'move' }>>()
      .toEqualTypeOf<BaseSurveyGroupMove>();
    expectTypeOf<Extract<CadCommand, { key: 'SURVEY_GROUP_TABLE'; op: 'delete' }>>()
      .toEqualTypeOf<BaseSurveyGroupDelete>();
    expectTypeOf<Extract<CadSurveyCommandPayload, { key: 'SURVEY_GROUP_TABLE'; op: 'delete' }>>()
      .toEqualTypeOf<BaseSurveyGroupDelete>();
  });

  it('matches the transcribed runtime property shapes for all 16 survey variants', () => {
    const variants = variantShapes(SURVEY_LEAF, 'survey leaf', SURVEY_ALIAS);
    expect(variants.length).toBe(EXPECTED_SURVEY_VARIANTS.length);
    variants.forEach((variant, index) => {
      const expected = EXPECTED_SURVEY_VARIANTS[index]!;
      expect([variant.key, variant.table, variant.op]).toEqual([expected.key, expected.table, expected.op]);
      expect(variant.props, `${expected.key}/${expected.table}/${expected.op} property drift`)
        .toEqual(expected.props.map(pinShape));
    });
  });
});

describe('STRUCT-241.1 hub union splice order and member counts', () => {
  it('measures 140 top-level members (110 inline, 23 refs, 7 intersections)', () => {
    // AST-measured (pre-refactor: 168 total = 140 inline + 7 intersections + 21 refs).
    expect(hubTopLevelCounts()).toEqual({ total: 140, inline: 110, refs: 23, intersections: 7 });
  });

  it('flattens to the exact 168 effective members in the original sequence', () => {
    const flat = hubFlattenedKeys();
    expect(flat.length).toBe(168);
    const at = flat.indexOf('BLOCK_EDIT');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(flat.slice(at, at + 39)).toEqual([
      'BLOCK_EDIT',
      ...EXPECTED_LAYER_KEYS,
      'F2F_GENERATE',
      'SURVEY_POINT_OVERRIDE',
      ...Array<string>(10).fill('SURVEY_STYLE_TABLE'),
      ...Array<string>(5).fill('SURVEY_GROUP_TABLE'),
      'CadSurfaceCommandPayload',
      'CadVolumeCommandPayload',
      'CadProfileCommandPayload',
      'CadSectionCommandPayload',
      'LANDXML_IMPORT',
      'CadSectionViewDeleteCommand',
      'BLOCK_CREATE',
    ]);
  });

  it('leaves no inline layer or survey key behind in the hub union', () => {
    const flat = hubFlattenedKeys();
    // Inline object members of the hub union must not carry moved keys; the
    // flattened view above already proves the 30 payloads arrive via refs.
    // (Two pre-existing members carry multi-literal key unions, so this
    // counts members, not key literals.)
    const inlineSets = hubInlineKeySets();
    expect(inlineSets.length).toBe(110);
    for (const set of inlineSets) {
      for (const key of set) {
        expect(key.startsWith('LAYER_'), `inline ${key} still in hub`).toBe(false);
        expect(key.startsWith('SURVEY_'), `inline ${key} still in hub`).toBe(false);
      }
    }
    expect(flat.filter((key) => key.startsWith('LAYER_')).length).toBe(14);
    expect(flat.filter((key) => key.startsWith('SURVEY_')).length).toBe(16);
  });
});

describe('STRUCT-241.1 CadCommandKey unchanged', () => {
  it('keeps the byte-identical ordered literal list (248 entries, duplicates kept)', () => {
    expect(hubKeyOrder()).toEqual([...EXPECTED_CAD_COMMAND_KEYS]);
  });

  it('keeps the layer/survey keys contiguous between block-edit and surface', () => {
    // The key union carries each repeated survey literal once (unlike the
    // command union, which holds all 16 survey variants).
    const keys = hubKeyOrder();
    const at = keys.indexOf('BLOCK_EDIT');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(keys.slice(at + 1, at + 19)).toEqual([
      ...EXPECTED_LAYER_KEYS,
      'F2F_GENERATE',
      'SURVEY_POINT_OVERRIDE',
      'SURVEY_STYLE_TABLE',
      'SURVEY_GROUP_TABLE',
    ]);
  });
});

describe('STRUCT-241.1 public transaction types unchanged', () => {
  it('keeps the exact CadTransaction / CadCommandState / CadCommandDefinition surfaces', () => {
    const hub = parse(HUB);
    const memberNames = (name: string): string[] => {
      const decl = hub.statements.find(
        (stmt): stmt is ts.InterfaceDeclaration =>
          ts.isInterfaceDeclaration(stmt) && stmt.name.text === name,
      );
      if (!decl) throw new Error(`${name} missing from hub`);
      return decl.members
        .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
        .map((m) => `${m.name.getText()}${m.questionToken ? '?' : ''}`);
    };
    expect(memberNames('CadTransaction')).toEqual([
      'id',
      'sequence',
      'commandKey',
      'label',
      'beforeSelectionIds',
      'afterSelectionIds',
      'addedEntityIds',
      'removedEntityIds',
    ]);
    expect(memberNames('CadCommandState')).toEqual(['key', 'phase', 'prompt']);
    expect(memberNames('CadCommandDefinition')).toEqual(['key', 'execute']);
  });
});

describe('STRUCT-241.1 documented payload comments preserved verbatim', () => {
  const countOccurrences = (text: string, needle: string): number =>
    text.split(needle).length - 1;

  it('keeps the LAYER_LINEWEIGHT default comment in its variant text', () => {
    const variants = variantShapes(LAYER_LEAF, 'layer leaf', LAYER_ALIAS);
    const lineweight = variants.find((v) => v.key === 'LAYER_LINEWEIGHT')!;
    expect(lineweight.text).toContain('/** Undefined = Default. */');
    expect(countOccurrences(lineweight.text, 'Undefined = Default.')).toBe(1);
    for (const variant of variants) {
      if (variant.key === 'LAYER_LINEWEIGHT') continue;
      expect(variant.text).not.toContain('Undefined = Default.');
    }
  });

  it('keeps the override leave/clear/set comments in both override carriers', () => {
    const variants = variantShapes(SURVEY_LEAF, 'survey leaf', SURVEY_ALIAS);
    const needle = 'undefined = leave, null = clear, id = set';
    // SURVEY_POINT_OVERRIDE carries both style-override fields.
    expect(countOccurrences(variants[0]!.text, needle)).toBe(2);
    // SURVEY_GROUP_TABLE op update carries both override fields.
    const update = variants.find((v) => v.key === 'SURVEY_GROUP_TABLE' && v.op === 'update')!;
    expect(countOccurrences(update.text, needle)).toBe(2);
    expect(variants.filter((v) => countOccurrences(v.text, needle) > 0).length).toBe(2);
  });

  it('keeps the replacement rewire comment in both style-table deletes', () => {
    const variants = variantShapes(SURVEY_LEAF, 'survey leaf', SURVEY_ALIAS);
    const needle = 'Required when points/groups reference the style; refs rewire to it.';
    const deletes = variants.filter((v) => v.key === 'SURVEY_STYLE_TABLE' && v.op === 'delete');
    expect(deletes.length).toBe(2);
    for (const variant of deletes) {
      expect(variant.text).toContain(needle);
      expect(countOccurrences(variant.text, needle)).toBe(1);
    }
    expect(variants.filter((v) => v.text.includes(needle)).length).toBe(2);
  });
});

describe('STRUCT-241.1 leaves are type-only with identical emit', () => {
  it.each([
    ['layer', LAYER_LEAF],
    ['survey', SURVEY_LEAF],
  ])('%s leaf has zero runtime imports and zero value declarations', (_label, file) => {
    expect(runtimeImportSpecifiers(file, _label)).toEqual([]);
    expect(hasOnlyTypeImports(file, _label)).toBe(true);
    expect(valueStatementKinds(file, _label)).toEqual([]);
  });

  it('neither leaf touches the hub, a transaction module, or a barrel', () => {
    const forbidden = [
      './cadTransactions.types',
      './cadTransactions',
      './cadTransactionsLayerCommands',
      './cadTransactionsSurveyCommands',
      './index',
      '../index',
    ];
    for (const [label, file] of [
      ['layer', LAYER_LEAF],
      ['survey', SURVEY_LEAF],
    ] as const) {
      for (const specifier of forbidden) {
        expect(allImportSpecifiers(file, label), `${label} imports ${specifier}`).not.toContain(specifier);
      }
    }
  });

  it('transpiled emit is marker-only for the hub and both leaves (no runtime behavior)', () => {
    expect(strippedEmit(HUB)).toBe('export {};');
    expect(strippedEmit(LAYER_LEAF)).toBe('export {};');
    expect(strippedEmit(SURVEY_LEAF)).toBe('export {};');
  });
});

describe('STRUCT-241.1 no leaf back-edge to the transaction hub', () => {
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
      'src/engine/cad/cadTransactionsLayerCommandTypes.ts',
      'src/engine/cad/cadTransactionsSurveyCommandTypes.ts',
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
    const layerOutgoing = graph.edges.filter(
      (edge) => edge.from === path.resolve(REPO_ROOT, 'src/engine/cad/cadTransactionsLayerCommandTypes.ts'),
    );
    expect(layerOutgoing.length).toBe(0);
    const surveyOutgoing = graph.edges.filter(
      (edge) => edge.from === path.resolve(REPO_ROOT, 'src/engine/cad/cadTransactionsSurveyCommandTypes.ts'),
    );
    expect(surveyOutgoing.length).toBeGreaterThan(0);
    for (const edge of surveyOutgoing) expect(edge.kind).toBe('type');
  });

  it('keeps the CAD scope value/type graphs acyclic', () => {
    const scoped = buildGraphs(files.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
    const valueCycles = findCycles(scoped.nodes, scoped.value);
    const typeCycles = findCycles(scoped.nodes, scoped.type);
    expect(valueCycles.cyclic.length).toBe(0);
    expect(valueCycles.cyclicNodes.size).toBe(0);
    expect(typeCycles.cyclic.length).toBe(0);
    expect(typeCycles.cyclicNodes.size).toBe(0);
  });
});

describe('STRUCT-241.1 negative controls (in-memory mutations only)', () => {
  const layerSource = (): string => fs.readFileSync(LAYER_LEAF, 'utf8');
  const surveySource = (): string => fs.readFileSync(SURVEY_LEAF, 'utf8');
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('fails the shape pin when the LAYER_CREATE role union narrows', () => {
    const mutated = layerSource().replace(`| 'planning';`, `| 'plan';`);
    expect(mutated).not.toBe(layerSource());
    const shapes = variantShapesFromSource(parseText('mutated.ts', mutated), 'mutated layer', LAYER_ALIAS);
    const create = shapes.find((v) => v.key === 'LAYER_CREATE')!;
    expect(() => expect(create.props).toEqual(EXPECTED_LAYER_SHAPES.LAYER_CREATE.map(pinShape))).toThrow();
  });

  it('fails the shape pin when LAYER_LINEWEIGHT loses its optionality', () => {
    const mutated = layerSource().replace('lineweightMm?: number;', 'lineweightMm: number | null;');
    expect(mutated).not.toBe(layerSource());
    const shapes = variantShapesFromSource(parseText('mutated.ts', mutated), 'mutated layer', LAYER_ALIAS);
    const lineweight = shapes.find((v) => v.key === 'LAYER_LINEWEIGHT')!;
    expect(() => expect(lineweight.props).toEqual(EXPECTED_LAYER_SHAPES.LAYER_LINEWEIGHT.map(pinShape))).toThrow();
  });

  it('fails the shape pin when SURVEY_POINT_OVERRIDE loses its null union', () => {
    const mutated = surveySource().replace(
      'pointStyleOverrideId?: CadPointStyleId | null;',
      'pointStyleOverrideId?: CadPointStyleId;',
    );
    expect(mutated).not.toBe(surveySource());
    const shapes = variantShapesFromSource(parseText('mutated.ts', mutated), 'mutated survey', SURVEY_ALIAS);
    expect(() => expect(shapes[0]!.props).toEqual(EXPECTED_SURVEY_VARIANTS[0]!.props.map(pinShape))).toThrow();
  });

  it('fails the ordering guard when one SURVEY_GROUP_TABLE op is removed', () => {
    const moveBlock = `  | {
      key: 'SURVEY_GROUP_TABLE';
      op: 'move';
      groupId: CadPointGroupId;
      direction: 'up' | 'down';
    }
`;
    expect(surveySource()).toContain(moveBlock);
    const mutated = surveySource().replace(moveBlock, '');
    const shapes = variantShapesFromSource(parseText('mutated.ts', mutated), 'mutated survey', SURVEY_ALIAS);
    expect(shapes.length).toBe(15);
    expect(() => expect(shapes.map((v) => [v.key, v.table, v.op])).toEqual(
      EXPECTED_SURVEY_VARIANTS.map((v) => [v.key, v.table, v.op]),
    )).toThrow();
  });

  it('fails the ordering guard when two layer variants swap position', () => {
    const renameBlock = `  | {
      key: 'LAYER_RENAME';
      layerId: string;
      name: string;
    }
`;
    const visibilityBlock = `  | {
      key: 'LAYER_VISIBILITY';
      layerId: string;
      visible: boolean;
    }
`;
    const mutated = layerSource().replace(renameBlock, '__SWAP__').replace(visibilityBlock, renameBlock).replace(
      '__SWAP__',
      visibilityBlock,
    );
    const keys = unionKeysInOrderFromSource(parseText('mutated.ts', mutated), 'mutated layer', LAYER_ALIAS);
    expect(keys.length).toBe(EXPECTED_LAYER_KEYS.length);
    expect(() => expect(keys).toEqual([...EXPECTED_LAYER_KEYS])).toThrow();
  });

  it('fails the splice guard when the hub survey ref is severed', () => {
    const refLine = '  | CadSurveyCommandPayload\n';
    expect(hubSource()).toContain(refLine);
    const mutated = hubSource().replace(refLine, '');
    const flat = hubFlattenedKeys(parseText('mutated-hub.ts', mutated));
    expect(flat.length).toBe(168 - 16);
    const at = flat.indexOf('BLOCK_EDIT');
    expect(() => expect(flat.slice(at, at + 39)).toEqual([
      'BLOCK_EDIT',
      ...EXPECTED_LAYER_KEYS,
      'F2F_GENERATE',
      'SURVEY_POINT_OVERRIDE',
      ...Array<string>(10).fill('SURVEY_STYLE_TABLE'),
      ...Array<string>(5).fill('SURVEY_GROUP_TABLE'),
      'CadSurfaceCommandPayload',
      'CadVolumeCommandPayload',
      'CadProfileCommandPayload',
      'CadSectionCommandPayload',
      'LANDXML_IMPORT',
      'CadSectionViewDeleteCommand',
      'BLOCK_CREATE',
    ])).toThrow();
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(LAYER_LEAF, 'utf8')).toBe(layerSource());
    expect(fs.readFileSync(SURVEY_LEAF, 'utf8')).toBe(surveySource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
  });
});

/**
 * Byte-identical pin of the hub `CadCommandKey` union literal order,
 * transcribed from the exact pre-refactor baseline at origin/main 08e0b6d0
 * (248 entries; BLOCK_CREATE and friends intentionally repeat, matching the
 * hub source; verified programmatically equal to the baseline extraction).
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
