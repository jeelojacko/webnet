/**
 * STRUCT-241.2 — CAD block command payload type leaf.
 *
 * Pins `src/engine/cad/cadTransactionsBlockCommandTypes.ts`, which extracts
 * the nine block command payloads out of the `CadCommand` union as two
 * public disjoint unions so the hub can splice them into their two original
 * positions:
 *  - `CadBlockPreludeCommandPayload` (2): BLOCK_SEED, BLOCK_EDIT — between
 *    TITLE_BLOCK_EDIT and CadLayerCommandPayload.
 *  - `CadBlockDefinitionCommandPayload` (7): BLOCK_CREATE, BLOCK_INSERT,
 *    BLOCK_EXPLODE, BLOCK_REDEFINE, BLOCK_RENAME, BLOCK_DUPLICATE,
 *    BLOCK_DELETE — between CadSectionViewDeleteCommand and CREATE_MTEXT.
 *
 * Covers: hand-transcribed pre-refactor `Base*` shapes + AST property pins;
 * `Extract<CadCommand>` per-key equivalence; optionality precision; the
 * byte-identical `CadCommandKey` (248 literals / 241 unique / 7 legacy
 * duplicates kept); both splice sentinels + 140->133 top-level + 168
 * flattened; public transaction types; type-only emit and frozen block
 * executor/reference-op bytes; CAD+F2F and full-`src` graph pins with an
 * explicit +1 node / +2 type-edge allowlist; five in-memory negative
 * controls; and block regression neighbours by import-existence only.
 *
 * CI-shallow-checkout portable: no git at runtime, negative controls mutate
 * source text in memory only, and all baselines are transcribed constants.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { buildGraphs, collectTypeScriptFiles, findCycles } from '../scripts/cadTypeImportGraph.mjs';

import type {
  CadCommand,
  CadCommandDefinition,
  CadTransaction,
} from '../src/engine/cad/cadTransactions.types';
import type { CadEntityId, CadLayerId } from '../src/engine/cad/cadCorePrimitiveTypes';
import type {
  CadBlockDefinitionCommandPayload,
  CadBlockPreludeCommandPayload,
} from '../src/engine/cad/cadTransactionsBlockCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const LEAF = path.join(CAD_DIR, 'cadTransactionsBlockCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');
const PRIMITIVE_LEAF = path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts');
const PRELUDE_ALIAS = 'CadBlockPreludeCommandPayload';
const DEFINITION_ALIAS = 'CadBlockDefinitionCommandPayload';

const abs = (relative: string): string => path.join(REPO_ROOT, relative);
const relPosix = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// TypeScript compiler helpers.
// ---------------------------------------------------------------------------

const parseText = (file: string, text: string): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const parse = (file: string): ts.SourceFile => parseText(file, fs.readFileSync(file, 'utf8'));

const findAlias = (source: ts.SourceFile, label: string, aliasName: string): ts.TypeAliasDeclaration => {
  const alias = source.statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === aliasName,
  );
  if (!alias) throw new Error(`${label}: alias ${aliasName} missing`);
  return alias;
};

const unwrap = (node: ts.TypeNode): ts.TypeNode =>
  ts.isParenthesizedTypeNode(node) ? unwrap(node.type) : node;

/** Collapse whitespace so formatting drift cannot mask (or fake) type drift. */
const norm = (text: string): string => text.replace(/\s+/g, '');
/** Pin-side normalization matching the runtime helper (drop a leading `|`). */
const pinShape = (text: string): string => norm(text).replace(/:\|/g, ':');

const keyPropOf = (node: ts.TypeLiteralNode): ts.PropertySignature | undefined =>
  node.members.find(
    (member): member is ts.PropertySignature =>
      ts.isPropertySignature(member) && member.name.getText() === 'key',
  );

/** Ordered `key` string literals of every object variant in the alias union. */
const unionKeysInOrderFromSource = (
  source: ts.SourceFile,
  label: string,
  aliasName: string,
): string[] => {
  const keys: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    const flat = unwrap(node);
    if (ts.isUnionTypeNode(flat)) {
      flat.types.forEach(visit);
      return;
    }
    if (!ts.isTypeLiteralNode(flat)) return;
    const keyProp = keyPropOf(flat);
    if (keyProp?.type && ts.isLiteralTypeNode(keyProp.type) && ts.isStringLiteral(keyProp.type.literal)) {
      keys.push(keyProp.type.literal.text);
    }
  };
  visit(findAlias(source, label, aliasName).type);
  return keys;
};

const unionKeysInOrder = (file: string, label: string, aliasName: string): string[] =>
  unionKeysInOrderFromSource(parse(file), label, aliasName);

interface VariantShape {
  key: string;
  props: string[];
  text: string;
  comments: string[];
}

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
    const literal = keyPropOf(flat)?.type;
    if (!literal || !ts.isLiteralTypeNode(literal) || !ts.isStringLiteral(literal.literal)) continue;
    const text = flat.getText(source);
    out.push({
      key: literal.literal.text,
      props: flat.members
        .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
        .map((m) => pinShape(`${m.name.getText()}${m.questionToken ? '?' : ''}: ${m.type?.getText() ?? 'never'}`)),
      text,
      comments: text.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) ?? [],
    });
  }
  return out;
};

const variantShapes = (file: string, label: string, aliasName: string): VariantShape[] =>
  variantShapesFromSource(parse(file), label, aliasName);

/** Module specifiers reached by a runtime (non-`import type`) edge. */
const runtimeImportSpecifiers = (file: string): string[] => {
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

const allImportSpecifiers = (file: string): string[] =>
  parse(file).statements
    .filter((stmt): stmt is ts.ImportDeclaration =>
      ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

/** Every import declaration must be type-only (`import type` or type-only bindings). */
const hasOnlyTypeImports = (file: string): boolean => {
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
const valueStatementKinds = (file: string): string[] =>
  parse(file).statements
    .filter((stmt) =>
      ts.isFunctionDeclaration(stmt)
      || ts.isVariableStatement(stmt)
      || ts.isClassDeclaration(stmt)
      || ts.isEnumDeclaration(stmt))
    .map((stmt) => ts.SyntaxKind[stmt.kind]);

/** Transpiled ES-module emit with comments stripped (type-only => `export {};`). */
const strippedEmit = (file: string): string =>
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, removeComments: true },
  }).outputText.trim();

const fileSha256 = (file: string): string =>
  createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** Ordered string literals of the hub `CadCommandKey` union (duplicates kept). */
const hubKeyOrder = (source?: ts.SourceFile): string[] => {
  const hub = source ?? parse(HUB);
  const keys: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(visit);
      return;
    }
    if (ts.isLiteralTypeNode(node) && ts.isStringLiteral(node.literal)) keys.push(node.literal.text);
  };
  visit(findAlias(hub, 'hub', 'CadCommandKey').type);
  if (keys.length === 0) throw new Error('CadCommandKey union parsed to zero members');
  return keys;
};

/** Raw (whitespace-preserving) source slice of the `CadCommandKey` alias. */
const cadCommandKeyRawText = (source?: ts.SourceFile): string => {
  const hub = source ?? parse(HUB);
  return findAlias(hub, 'hub', 'CadCommandKey').getText(hub);
};

interface HubMember {
  kind: 'inline' | 'ref' | 'intersection';
  label: string;
}

const keyDescriptor = (member: ts.TypeLiteralNode): string | null => {
  const keyType = keyPropOf(member)?.type;
  if (!keyType) return null;
  if (ts.isLiteralTypeNode(keyType) && ts.isStringLiteral(keyType.literal)) return keyType.literal.text;
  return norm(keyType.getText());
};

/** One descriptor per top-level hub `CadCommand` member. */
const hubMemberSequence = (source?: ts.SourceFile): HubMember[] => {
  const hub = source ?? parse(HUB);
  const alias = findAlias(hub, 'hub', 'CadCommand');
  if (!ts.isUnionTypeNode(alias.type)) throw new Error('CadCommand is not a union');
  const out: HubMember[] = [];
  for (const member of alias.type.types) {
    const flat = unwrap(member);
    if (ts.isTypeReferenceNode(flat) && ts.isIdentifier(flat.typeName)) {
      out.push({ kind: 'ref', label: flat.typeName.text });
    } else if (ts.isIntersectionTypeNode(flat)) {
      const literal = flat.types.map(unwrap).find((t): t is ts.TypeLiteralNode => ts.isTypeLiteralNode(t));
      const label = literal ? keyDescriptor(literal) : null;
      if (label) out.push({ kind: 'intersection', label });
    } else if (ts.isTypeLiteralNode(flat)) {
      const label = keyDescriptor(flat);
      if (label) out.push({ kind: 'inline', label });
    }
  }
  return out;
};

/** Flattened effective member keys, resolving the four extracted leaf unions. */
const hubFlattenedKeys = (source?: ts.SourceFile): string[] => {
  const hub = source ?? parse(HUB);
  const blockPrelude = unionKeysInOrder(LEAF, 'leaf', PRELUDE_ALIAS);
  const blockDefinition = unionKeysInOrder(LEAF, 'leaf', DEFINITION_ALIAS);
  const layer = unionKeysInOrder(abs('src/engine/cad/cadTransactionsLayerCommandTypes.ts'), 'layer', 'CadLayerCommandPayload');
  const survey = unionKeysInOrder(abs('src/engine/cad/cadTransactionsSurveyCommandTypes.ts'), 'survey', 'CadSurveyCommandPayload');
  const alias = findAlias(hub, 'hub', 'CadCommand');
  const members: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    const flat = unwrap(node);
    if (ts.isUnionTypeNode(flat)) {
      flat.types.forEach(visit);
      return;
    }
    if (ts.isTypeReferenceNode(flat) && ts.isIdentifier(flat.typeName)) {
      const name = flat.typeName.text;
      if (name === PRELUDE_ALIAS) members.push(...blockPrelude);
      else if (name === DEFINITION_ALIAS) members.push(...blockDefinition);
      else if (name === 'CadLayerCommandPayload') members.push(...layer);
      else if (name === 'CadSurveyCommandPayload') members.push(...survey);
      else members.push(name);
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

const hubTopLevelCounts = (
  source?: ts.SourceFile,
): { total: number; inline: number; refs: number; intersections: number } => {
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

/** Every string-literal key carried by each inline object member of the hub union. */
const hubInlineKeySets = (source?: ts.SourceFile): string[][] => {
  const hub = source ?? parse(HUB);
  const alias = findAlias(hub, 'hub', 'CadCommand');
  if (!ts.isUnionTypeNode(alias.type)) throw new Error('CadCommand is not a union');
  const sets: string[][] = [];
  for (const member of alias.type.types) {
    const flat = unwrap(member);
    if (!ts.isTypeLiteralNode(flat)) continue;
    const keyType = keyPropOf(flat)?.type;
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

const expectedFieldNames = (shapes: string[]): string[] =>
  shapes.map((shape) => norm(shape).split(':')[0]!.replace(/\?$/, ''));

// ---------------------------------------------------------------------------
// Independent baseline pins: hand-transcribed from pre-refactor origin/main
// 739b0de3 (hub lines ~775-788 prelude, ~820-863 later). They import no leaf
// type, so leaf drift cannot move both sides of an assertion.
// ---------------------------------------------------------------------------

type BaseBlockSeed = { key: 'BLOCK_SEED' };

type BaseBlockEdit = {
  key: 'BLOCK_EDIT';
  referenceId: CadEntityId;
  x?: number;
  y?: number;
  rotationDeg?: number;
  scaleX?: number;
  scaleY?: number;
  mirrored?: boolean;
};

type BaseBlockCreate = {
  key: 'BLOCK_CREATE';
  name: string;
  sourceEntityIds: CadEntityId[];
  basePoint?: { x: number; y: number };
  description?: string;
};

type BaseBlockInsert = {
  key: 'BLOCK_INSERT';
  definitionId: string;
  x: number;
  y: number;
  rotationDeg?: number;
  scaleX?: number;
  scaleY?: number;
  mirrored?: boolean;
  layerId?: CadLayerId;
};

type BaseBlockExplode = { key: 'BLOCK_EXPLODE'; referenceId: CadEntityId };

type BaseBlockRedefine = {
  key: 'BLOCK_REDEFINE';
  definitionId: string;
  sourceEntityIds: CadEntityId[];
};

type BaseBlockRename = { key: 'BLOCK_RENAME'; definitionId: string; name: string };
type BaseBlockDuplicate = { key: 'BLOCK_DUPLICATE'; definitionId: string; name: string };

type BaseBlockDelete = {
  key: 'BLOCK_DELETE';
  definitionId: string;
  force?: boolean;
  deleteRefs?: boolean;
};

const EXPECTED_PRELUDE_KEYS = ['BLOCK_SEED', 'BLOCK_EDIT'] as const;
const EXPECTED_DEFINITION_KEYS = [
  'BLOCK_CREATE', 'BLOCK_INSERT', 'BLOCK_EXPLODE', 'BLOCK_REDEFINE',
  'BLOCK_RENAME', 'BLOCK_DUPLICATE', 'BLOCK_DELETE',
] as const;
/** The seven `CadCommandKey` literals that legitimately repeat (kept, never fixed). */
const EXPECTED_DUPLICATE_BLOCK_KEYS = [...EXPECTED_DEFINITION_KEYS];
const EXPECTED_LAYER_KEYS = [
  'LAYER_CREATE', 'LAYER_RENAME', 'LAYER_VISIBILITY', 'LAYER_LOCKED',
  'LAYER_PRINTABLE', 'LAYER_COLOR', 'LAYER_LINETYPE', 'LAYER_LINEWEIGHT',
  'LAYER_TRANSPARENCY', 'LAYER_FROZEN', 'LAYER_DESCRIPTION', 'LAYER_SET_CURRENT',
  'LAYER_MOVE_OBJECTS', 'LAYER_DELETE',
] as const;

const EXPECTED_BLOCK_SHAPES: Record<string, string[]> = {
  BLOCK_SEED: ["key: 'BLOCK_SEED'"],
  BLOCK_EDIT: [
    "key: 'BLOCK_EDIT'", 'referenceId: CadEntityId', 'x?: number', 'y?: number',
    'rotationDeg?: number', 'scaleX?: number', 'scaleY?: number', 'mirrored?: boolean',
  ],
  BLOCK_CREATE: [
    "key: 'BLOCK_CREATE'", 'name: string', 'sourceEntityIds: CadEntityId[]',
    'basePoint?: { x: number; y: number }', 'description?: string',
  ],
  BLOCK_INSERT: [
    "key: 'BLOCK_INSERT'", 'definitionId: string', 'x: number', 'y: number',
    'rotationDeg?: number', 'scaleX?: number', 'scaleY?: number', 'mirrored?: boolean',
    'layerId?: CadLayerId',
  ],
  BLOCK_EXPLODE: ["key: 'BLOCK_EXPLODE'", 'referenceId: CadEntityId'],
  BLOCK_REDEFINE: ["key: 'BLOCK_REDEFINE'", 'definitionId: string', 'sourceEntityIds: CadEntityId[]'],
  BLOCK_RENAME: ["key: 'BLOCK_RENAME'", 'definitionId: string', 'name: string'],
  BLOCK_DUPLICATE: ["key: 'BLOCK_DUPLICATE'", 'definitionId: string', 'name: string'],
  BLOCK_DELETE: ["key: 'BLOCK_DELETE'", 'definitionId: string', 'force?: boolean', 'deleteRefs?: boolean'],
};

/** Raw SHA256 of the `CadCommandKey` alias slice from pre-refactor main. */
const EXPECTED_CAD_COMMAND_KEY_RAW_SHA256 =
  '4ff8cd4aa25d062cf2abb729482ec4145cfc50098759327e992dd3f4beca1502';

// Full-field samples: every declared field present, so drift (dropped
// optional, added required, renamed field) breaks the annotation or the
// runtime key assertion. Identity aliases are `string`, so no casts needed.
const preludeSamples: CadBlockPreludeCommandPayload[] = [
  { key: 'BLOCK_SEED' },
  {
    key: 'BLOCK_EDIT', referenceId: 'e-1', x: 1, y: 2,
    rotationDeg: 0, scaleX: 1, scaleY: 1, mirrored: false,
  },
];

const definitionSamples: CadBlockDefinitionCommandPayload[] = [
  { key: 'BLOCK_CREATE', name: 'B1', sourceEntityIds: ['e-1'], basePoint: { x: 0, y: 0 }, description: 'd' },
  {
    key: 'BLOCK_INSERT', definitionId: 'd-1', x: 0, y: 0, rotationDeg: 0,
    scaleX: 1, scaleY: 1, mirrored: false, layerId: 'L1',
  },
  { key: 'BLOCK_EXPLODE', referenceId: 'e-1' },
  { key: 'BLOCK_REDEFINE', definitionId: 'd-1', sourceEntityIds: ['e-1'] },
  { key: 'BLOCK_RENAME', definitionId: 'd-1', name: 'B2' },
  { key: 'BLOCK_DUPLICATE', definitionId: 'd-1', name: 'B3' },
  { key: 'BLOCK_DELETE', definitionId: 'd-1', force: true, deleteRefs: true },
];

// Compile-time leaf <-> hub round trip (enforced by project typecheck).
const leafToHub = (
  payload: CadBlockPreludeCommandPayload | CadBlockDefinitionCommandPayload,
): CadCommand => payload;

// ---------------------------------------------------------------------------

describe('STRUCT-241.2 leaf presence and key order', () => {
  it('the block command type leaf exists before any shape assertion runs', () => {
    expect(fs.existsSync(LEAF), `leaf missing: ${relPosix(LEAF)}`).toBe(true);
  });

  it('pins the 2 prelude and 7 definition keys in order, disjoint, no duplicates', () => {
    const prelude = unionKeysInOrder(LEAF, 'leaf', PRELUDE_ALIAS);
    const definition = unionKeysInOrder(LEAF, 'leaf', DEFINITION_ALIAS);
    expect(prelude).toEqual([...EXPECTED_PRELUDE_KEYS]);
    expect(definition).toEqual([...EXPECTED_DEFINITION_KEYS]);
    expect([...prelude, ...definition].filter((k) => definition.includes(k) && prelude.includes(k))).toEqual([]);
    expect(new Set([...prelude, ...definition]).size).toBe(9);
  });

  it('compiles one full-field sample per variant and carries every field at runtime', () => {
    expect(preludeSamples.map((s) => s.key)).toEqual([...EXPECTED_PRELUDE_KEYS]);
    expect(definitionSamples.map((s) => s.key)).toEqual([...EXPECTED_DEFINITION_KEYS]);
    for (const sample of [...preludeSamples, ...definitionSamples]) {
      expect(Object.keys(sample).sort()).toEqual(
        [...expectedFieldNames(EXPECTED_BLOCK_SHAPES[sample.key]!)].sort(),
      );
    }
    expect(leafToHub(preludeSamples[0]!)).toBe(preludeSamples[0]);
    expect(leafToHub(definitionSamples[0]!)).toBe(definitionSamples[0]);
  });
});

describe('STRUCT-241.2 baseline shapes: Extract<CadCommand> vs leaf vs Base*', () => {
  it('keeps the prelude members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_SEED' }>>()
      .toEqualTypeOf<Extract<CadBlockPreludeCommandPayload, { key: 'BLOCK_SEED' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_SEED' }>>().toEqualTypeOf<BaseBlockSeed>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_EDIT' }>>()
      .toEqualTypeOf<Extract<CadBlockPreludeCommandPayload, { key: 'BLOCK_EDIT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_EDIT' }>>().toEqualTypeOf<BaseBlockEdit>();
  });

  it('keeps the definition members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_CREATE' }>>()
      .toEqualTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_CREATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_CREATE' }>>().toEqualTypeOf<BaseBlockCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_INSERT' }>>()
      .toEqualTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_INSERT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_INSERT' }>>().toEqualTypeOf<BaseBlockInsert>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_EXPLODE' }>>()
      .toEqualTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_EXPLODE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_EXPLODE' }>>().toEqualTypeOf<BaseBlockExplode>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_REDEFINE' }>>()
      .toEqualTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_REDEFINE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_REDEFINE' }>>().toEqualTypeOf<BaseBlockRedefine>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_RENAME' }>>()
      .toEqualTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_RENAME' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_RENAME' }>>().toEqualTypeOf<BaseBlockRename>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_DUPLICATE' }>>()
      .toEqualTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_DUPLICATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_DUPLICATE' }>>().toEqualTypeOf<BaseBlockDuplicate>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_DELETE' }>>()
      .toEqualTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_DELETE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BLOCK_DELETE' }>>().toEqualTypeOf<BaseBlockDelete>();
  });

  it('matches the transcribed AST property shapes, order, and (empty) comments', () => {
    const prelude = variantShapes(LEAF, 'leaf', PRELUDE_ALIAS);
    const definition = variantShapes(LEAF, 'leaf', DEFINITION_ALIAS);
    expect(prelude.map((v) => v.key)).toEqual([...EXPECTED_PRELUDE_KEYS]);
    expect(definition.map((v) => v.key)).toEqual([...EXPECTED_DEFINITION_KEYS]);
    for (const variant of [...prelude, ...definition]) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_BLOCK_SHAPES[variant.key]!.map(pinShape),
      );
      expect(variant.comments, `${variant.key} unexpected comment`).toEqual([]);
    }
  });

  it('keeps required fields required and optional fields optional-without-null', () => {
    expectTypeOf<Extract<CadBlockPreludeCommandPayload, { key: 'BLOCK_EDIT' }>['referenceId']>()
      .toEqualTypeOf<CadEntityId>();
    expectTypeOf<Extract<CadBlockPreludeCommandPayload, { key: 'BLOCK_EDIT' }>['mirrored']>()
      .toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_INSERT' }>['layerId']>()
      .toEqualTypeOf<CadLayerId | undefined>();
    expectTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_INSERT' }>['mirrored']>()
      .toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_CREATE' }>['basePoint']>()
      .toEqualTypeOf<{ x: number; y: number } | undefined>();
    expectTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_CREATE' }>['description']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_EXPLODE' }>['referenceId']>()
      .toEqualTypeOf<CadEntityId>();
    expectTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_DELETE' }>['force']>()
      .toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Extract<CadBlockDefinitionCommandPayload, { key: 'BLOCK_DELETE' }>['deleteRefs']>()
      .toEqualTypeOf<boolean | undefined>();
  });
});

describe('STRUCT-241.2 hub union splice order and member counts', () => {
  it('measures 133 top-level members and documents the 140 -> 133 extraction', () => {
    const counts = hubTopLevelCounts();
    expect(counts).toEqual({ total: 133, inline: 101, refs: 25, intersections: 7 });
    // Re-inlining the two leaves restores the pre-refactor 140 = 110 + 23 + 7.
    const preludeSize = unionKeysInOrder(LEAF, 'leaf', PRELUDE_ALIAS).length;
    const definitionSize = unionKeysInOrder(LEAF, 'leaf', DEFINITION_ALIAS).length;
    expect([preludeSize, definitionSize]).toEqual([2, 7]);
    expect(counts.total + preludeSize + definitionSize - 2).toBe(140);
  });

  it('splices both groups with neighbor sentinels', () => {
    const seq = hubMemberSequence();
    const prelude = seq.findIndex((m) => m.label === 'TITLE_BLOCK_EDIT');
    expect(seq[prelude]).toEqual({ kind: 'inline', label: 'TITLE_BLOCK_EDIT' });
    expect(seq[prelude + 1]).toEqual({ kind: 'ref', label: PRELUDE_ALIAS });
    expect(seq[prelude + 2]).toEqual({ kind: 'ref', label: 'CadLayerCommandPayload' });
    const definition = seq.findIndex((m) => m.label === 'CadSectionViewDeleteCommand');
    expect(seq[definition]).toEqual({ kind: 'ref', label: 'CadSectionViewDeleteCommand' });
    expect(seq[definition + 1]).toEqual({ kind: 'ref', label: DEFINITION_ALIAS });
    expect(seq[definition + 2]).toEqual({ kind: 'inline', label: 'CREATE_MTEXT' });
  });

  it('flattens to the exact 168 effective members in the original sequence', () => {
    const flat = hubFlattenedKeys();
    expect(flat.length).toBe(168);
    const at = flat.indexOf('TITLE_BLOCK_EDIT');
    expect(flat.slice(at, at + 3)).toEqual(['TITLE_BLOCK_EDIT', ...EXPECTED_PRELUDE_KEYS]);
    expect(flat.slice(at + 3, at + 3 + EXPECTED_LAYER_KEYS.length)).toEqual([...EXPECTED_LAYER_KEYS]);
    const later = flat.indexOf('CadSectionViewDeleteCommand');
    expect(flat.slice(later, later + 9)).toEqual([
      'CadSectionViewDeleteCommand', ...EXPECTED_DEFINITION_KEYS, 'CREATE_MTEXT',
    ]);
    expect(flat.filter((key) => key.startsWith('BLOCK_')).length).toBe(9);
  });

  it('leaves no inline block key behind in the hub union', () => {
    const inlineSets = hubInlineKeySets();
    expect(inlineSets.length).toBe(101);
    for (const set of inlineSets) {
      for (const key of set) expect(key.startsWith('BLOCK_'), `inline ${key} still in hub`).toBe(false);
    }
  });
});

describe('STRUCT-241.2 CadCommandKey unchanged', () => {
  it('keeps the raw alias slice byte-identical and the 248/241/7 duplicate shape', () => {
    expect(createHash('sha256').update(cadCommandKeyRawText()).digest('hex'))
      .toBe(EXPECTED_CAD_COMMAND_KEY_RAW_SHA256);
    const keys = hubKeyOrder();
    expect(keys.length).toBe(248);
    expect(new Set(keys).size).toBe(241);
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    const repeated = [...counts].filter(([, n]) => n > 1).map(([k]) => k).sort();
    expect(repeated).toEqual([...EXPECTED_DUPLICATE_BLOCK_KEYS].sort());
  });

  it('keeps both block key runs in their original positions', () => {
    const keys = hubKeyOrder();
    const early = keys.indexOf('BLOCK_SEED');
    expect(keys.slice(early - 1, early + 8)).toEqual([
      'TITLE_BLOCK_EDIT', 'BLOCK_SEED', 'BLOCK_CREATE', 'BLOCK_DUPLICATE',
      'BLOCK_RENAME', 'BLOCK_REDEFINE', 'BLOCK_DELETE', 'BLOCK_INSERT', 'BLOCK_EXPLODE',
    ]);
    const later = keys.indexOf('BLOCK_CREATE', early + 2);
    // The later run repeats the seven definition keys verbatim after
    // SECTION_VIEW_DELETE and before CREATE_MTEXT.
    expect(keys.slice(later, later + 7)).toEqual([...EXPECTED_DUPLICATE_BLOCK_KEYS]);
    expect(keys[keys.indexOf('SECTION_VIEW_DELETE') + 1]).toBe('BLOCK_CREATE');
    expect(keys[keys.indexOf('BLOCK_DELETE', later) + 1]).toBe('CREATE_MTEXT');
  });
});

describe('STRUCT-241.2 public transaction types unchanged', () => {
  it('keeps the exact CadTransaction / CadCommandDefinition surfaces and usability', () => {
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
      'id', 'sequence', 'commandKey', 'label', 'beforeSelectionIds',
      'afterSelectionIds', 'addedEntityIds', 'removedEntityIds',
    ]);
    expect(memberNames('CadCommandDefinition')).toEqual(['key', 'execute']);
    const definitionProbe: CadCommandDefinition<CadCommand> = { key: 'BLOCK_SEED', execute: () => null };
    const transactionProbe: CadTransaction = {
      id: 't-1', sequence: 1, commandKey: 'BLOCK_SEED', label: 'seed',
      beforeSelectionIds: [], afterSelectionIds: [], addedEntityIds: [], removedEntityIds: [],
    };
    expect([definitionProbe.key, transactionProbe.commandKey]).toEqual(['BLOCK_SEED', 'BLOCK_SEED']);
    expectTypeOf<CadCommand extends { key: string } ? true : false>().toEqualTypeOf<true>();
  });
});

describe('STRUCT-241.2 type-only leaf, emit, and frozen block executor/API bytes', () => {
  it('block leaf has zero runtime imports, zero value declarations, no hub back-edge', () => {
    expect(runtimeImportSpecifiers(LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(LEAF)).toBe(true);
    expect(valueStatementKinds(LEAF)).toEqual([]);
    const specs = allImportSpecifiers(LEAF);
    expect(specs).toEqual(['./cadCorePrimitiveTypes']);
  });

  it('transpiled emit is marker-only for the hub and the leaf', () => {
    expect(strippedEmit(HUB)).toBe('export {};');
    expect(strippedEmit(LEAF)).toBe('export {};');
  });

  it('freezes the block executor and reference-op source bytes', () => {
    expect(fileSha256(path.join(CAD_DIR, 'cadTransactionsBlockCommands.ts')))
      .toBe('0273ff04b311b99f522f0377de0e3a5b55e43d8f5e03baeedbdef2e757b1d3eb');
    expect(fileSha256(path.join(CAD_DIR, 'cadBlocks.ts')))
      .toBe('6c398db12951ae516a7b3cf8d20abf28969012179736586bbdb3c07571b60df2');
    expect(fileSha256(path.join(REPO_ROOT, 'src', 'cad-app', 'blocks', 'cadBlockReferenceOps.ts')))
      .toBe('ab722529385bc4a145df805b70c466ee59a4ca1312634b9b20117ada5c84dd27');
  });
});

describe('STRUCT-241.2 existing block regression neighbours covered by import existence', () => {
  it.each([
    'cad_blocks_transactions', 'cad_blocks_engine', 'cad_blocks_wncad', 'cad_blocks_ui',
    'cad_blocks_mirror_18q', 'cad_block_value_cycle_1951', 'cad_survey_layer_command_type_leaves_2411',
    'cad_profile_section_command_types_1955', 'cad_grading_command_types_1956',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.2 extraction is type-only, so VALUE|mixed counts/digest are
// unchanged and the explicit TYPE allowlist adds +1 node / +2 edges.
// ---------------------------------------------------------------------------

const pairDigest = (graph: ReturnType<typeof buildGraphs>): { valueEdges: number; uniqPairs: number; sha: string } => {
  const valueEdges = graph.edges.filter((edge) => edge.kind === 'value' || edge.kind === 'mixed');
  const pairs = [...new Set(valueEdges.map((edge) => `${relPosix(edge.from)}\n${relPosix(edge.to)}`))].sort();
  return {
    valueEdges: valueEdges.length,
    uniqPairs: pairs.length,
    sha: createHash('sha256').update(JSON.stringify(pairs)).digest('hex'),
  };
};

const buildScopeGraph = (dirs: string[]): ReturnType<typeof buildGraphs> => {
  const files = dirs.flatMap((dir) => collectTypeScriptFiles(path.join(REPO_ROOT, dir)));
  return buildGraphs(files.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
};

let cadF2fCache: ReturnType<typeof buildGraphs> | undefined;
const cadF2fGraph = (): ReturnType<typeof buildGraphs> =>
  (cadF2fCache ??= buildScopeGraph(['src/engine/cad', 'src/engine/fieldToFinish']));

let fullSrcCache: ReturnType<typeof buildGraphs> | undefined;
const fullSrcGraph = (): ReturnType<typeof buildGraphs> => (fullSrcCache ??= buildScopeGraph(['src']));

describe('STRUCT-241.2 CAD+F2F graph pins', () => {
  // First cold graph parse in this file; allow headroom under full-suite CI contention.
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // Post-241.1 baseline 485 / 2404; the 241.2 leaf adds +1 node / +2 type
    // edges; STRUCT-241.3 adds +2 nodes / +6 type edges (documented roll-forward);
    // STRUCT-241.4 adds +1 node / +4 type edges (documented roll-forward);
    // STRUCT-241.5 adds +2 nodes / +8 type edges (documented roll-forward:
    // annotation 3 out + hub import + hub export, survey 2 out + hub import
    // + hub export, minus the retired hub -> anchor import-type edge).
    // STRUCT-241.6 adds +2 nodes / +9 type edges (documented roll-forward:
    // linear 3 out + hub import + hub export, parcel 2 out + hub import +
    // hub export, no retired hub edge).
    expect(graph.nodes.length).toBe(493);
    expect(graph.edges.length).toBe(2433);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  }, 30_000);

  it('adds exactly the two allow-listed TYPE edges incident to the block leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: path.resolve(PRIMITIVE_LEAF), specifier: './cadCorePrimitiveTypes', kind: 'type' },
    ]);
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([
      { from: path.resolve(HUB), to: leaf, specifier: './cadTransactionsBlockCommandTypes', kind: 'type' },
    ]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter((edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type')).toEqual([]);
  });

  it('has no leaf back-edge to the transaction hub or runtime block executor', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(LEAF);
    for (const target of [
      path.resolve(HUB),
      path.resolve(path.join(CAD_DIR, 'cadTransactions.ts')),
      path.resolve(path.join(CAD_DIR, 'cadTransactionsBlockCommands.ts')),
      path.resolve(path.join(CAD_DIR, 'cadBlocks.ts')),
    ]) {
      expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
    }
  });
});

describe('STRUCT-241.2 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // Post-241.1 baseline 1657 / 7514; 241.2 adds +1 node / +2 edges;
    // STRUCT-241.3 adds +2 nodes / +6 edges (documented roll-forward);
    // STRUCT-241.4 adds +1 node / +5 edges (documented roll-forward);
    // STRUCT-241.5 adds +2 nodes / +8 edges (documented roll-forward).
    // STRUCT-241.6 adds +2 nodes / +9 edges (documented roll-forward).
    expect(graph.nodes.length).toBe(1665);
    expect(graph.edges.length).toBe(7544);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4444,
      uniqPairs: 4385,
      sha: '415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448',
    });
  }, 120_000);
});

describe('STRUCT-241.2 negative controls (in-memory mutations only)', () => {
  const leafSource = (): string => fs.readFileSync(LEAF, 'utf8');
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('fails the shape pin when BLOCK_INSERT layerId optionality is dropped', () => {
    const mutated = leafSource().replace('layerId?: CadLayerId;', 'layerId: CadLayerId;');
    expect(mutated).not.toBe(leafSource());
    const insert = variantShapesFromSource(parseText('m.ts', mutated), 'm', DEFINITION_ALIAS)
      .find((v) => v.key === 'BLOCK_INSERT')!;
    expect(() => expect(insert.props).toEqual(EXPECTED_BLOCK_SHAPES.BLOCK_INSERT!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when BLOCK_EDIT mirrored optionality is dropped', () => {
    const source = leafSource();
    const editText = variantShapesFromSource(parseText('leaf.ts', source), 'leaf', PRELUDE_ALIAS)
      .find((v) => v.key === 'BLOCK_EDIT')!.text;
    const mutated = source.replace(editText, editText.replace('mirrored?: boolean;', 'mirrored: boolean;'));
    expect(mutated).not.toBe(source);
    const edit = variantShapesFromSource(parseText('m.ts', mutated), 'm', PRELUDE_ALIAS)
      .find((v) => v.key === 'BLOCK_EDIT')!;
    expect(() => expect(edit.props).toEqual(EXPECTED_BLOCK_SHAPES.BLOCK_EDIT!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when BLOCK_DELETE deleteRefs is dropped', () => {
    const mutated = leafSource().replace('      deleteRefs?: boolean;\n', '');
    expect(mutated).not.toBe(leafSource());
    const del = variantShapesFromSource(parseText('m.ts', mutated), 'm', DEFINITION_ALIAS)
      .find((v) => v.key === 'BLOCK_DELETE')!;
    expect(() => expect(del.props).toEqual(EXPECTED_BLOCK_SHAPES.BLOCK_DELETE!.map(pinShape))).toThrow();
  });

  it('fails the ordering guard when BLOCK_CREATE and BLOCK_INSERT swap position', () => {
    const source = leafSource();
    const shapes = variantShapesFromSource(parseText('leaf.ts', source), 'leaf', DEFINITION_ALIAS);
    const create = shapes.find((v) => v.key === 'BLOCK_CREATE')!.text;
    const insert = shapes.find((v) => v.key === 'BLOCK_INSERT')!.text;
    const mutated = source.replace(create, '__SWAP__').replace(insert, create).replace('__SWAP__', insert);
    expect(mutated).not.toBe(source);
    const swapped = variantShapesFromSource(parseText('m.ts', mutated), 'm', DEFINITION_ALIAS);
    expect(swapped.map((v) => v.key)).toHaveLength(7);
    expect(() => expect(swapped.map((v) => v.key)).toEqual([...EXPECTED_DEFINITION_KEYS])).toThrow();
  });

  it('fails the splice guard when the two disjoint groups combine into one location', () => {
    const source = hubSource();
    const preludeRefLine = `  | ${PRELUDE_ALIAS}\n`;
    const definitionRefLine = `  | ${DEFINITION_ALIAS}\n`;
    expect(source).toContain(preludeRefLine);
    expect(source).toContain(definitionRefLine);
    const mutated = source.replace(definitionRefLine, '').replace(preludeRefLine, `${preludeRefLine}${definitionRefLine}`);
    expect(mutated).not.toBe(source);
    const flat = hubFlattenedKeys(parseText('mutated-hub.ts', mutated));
    expect(flat.length).toBe(168);
    const at = flat.indexOf('TITLE_BLOCK_EDIT');
    expect(flat.slice(at, at + 3)).toEqual(['TITLE_BLOCK_EDIT', ...EXPECTED_PRELUDE_KEYS]);
    expect(() => expect(flat.slice(at + 3, at + 3 + EXPECTED_LAYER_KEYS.length)).toEqual([...EXPECTED_LAYER_KEYS])).toThrow();
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(LEAF, 'utf8')).toBe(leafSource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
  });
});
