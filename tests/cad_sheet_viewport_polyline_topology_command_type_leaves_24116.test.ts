/**
 * STRUCT-241.16 — CAD sheet/viewport + polyline-topology command payload type leaves.
 *
 * Pins `src/engine/cad/cadTransactionsSheetViewportCommandTypes.ts`, which
 * extracts the six sheet/viewport command payloads out of the `CadCommand`
 * union as one public union, and
 * `src/engine/cad/cadTransactionsPolylineTopologyCommandTypes.ts`, which
 * extracts the two polyline vertex-topology command payloads as one public
 * union, so the hub splices both back into their original contiguous
 * positions:
 *  - `CadSheetViewportCommandPayload` (6): SHEET_ADD, SHEET_DELETE,
 *    VIEWPORT_MOVE, VIEWPORT_SCALE, VIEWPORT_ROTATE, TITLE_BLOCK_EDIT —
 *    between CadGeometryEditCommandPayload and CadBlockPreludeCommandPayload.
 *  - `CadPolylineTopologyCommandPayload` (2): POLYLINE_INSERT_VERTEX,
 *    POLYLINE_DELETE_VERTEX — between CadDesignSurfaceCommandPayload and
 *    the CAD Curves F1 aliases.
 *
 * Covers: hand-transcribed pre-refactor `Base*` shapes + AST property pins
 * (key literals, property order, optionality, Record/Array exactness,
 * INSERT courseIndex vs DELETE vertexIndex); per-key `Extract<CadCommand>`
 * equivalence in both directions (all 8 members are single-keyed, so plain
 * single-literal selectors apply); the moved Phase C3 header (command-union
 * header travels with the polyline leaf, the F1 header and the key-union C3
 * header stay in the hub) + the header-free sheet leaf; both splice
 * sentinels + 55 top-level + 168 flattened effective members; the untouched
 * inline coordinate-system commands + GridGroundDirection; the untouched
 * Curve F1 / block-prelude / layer / design-surface neighbour aliases;
 * public transaction types; type-only emit pins; CAD+F2F and full-`src`
 * graph pins with an explicit +2 node / +3 type-edge allowlist (2 hub
 * imports + 1 polyline out-edge + 0 sheet out-edges − 0 retired edges);
 * in-memory negative controls; and sheet / polyline regression neighbours
 * by import existence only.
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
import type { CadEntityId } from '../src/engine/cad/cadCorePrimitiveTypes';
import type { CadSheetViewportCommandPayload } from '../src/engine/cad/cadTransactionsSheetViewportCommandTypes';
import type { CadPolylineTopologyCommandPayload } from '../src/engine/cad/cadTransactionsPolylineTopologyCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const SHEET_LEAF = path.join(CAD_DIR, 'cadTransactionsSheetViewportCommandTypes.ts');
const POLY_LEAF = path.join(CAD_DIR, 'cadTransactionsPolylineTopologyCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');
const SHEET_ALIAS = 'CadSheetViewportCommandPayload';
const POLY_ALIAS = 'CadPolylineTopologyCommandPayload';

const abs = (relative: string): string => path.join(REPO_ROOT, relative);
const relPosix = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// TypeScript compiler helpers (same shape as the STRUCT-241.15 guard).
// ---------------------------------------------------------------------------

const parseText = (file: string, text: string): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const parse = (file: string): ts.SourceFile => parseText(file, fs.readFileSync(file, 'utf8'));

const findAlias = (source: ts.SourceFile, label: string, aliasName: string): ts.TypeAliasDeclaration => {
  const alias = source.statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === aliasName,
  );
  if (!alias) throw new Error(`${label}: ${aliasName} missing`);
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

/** Single descriptor for one object member: literal key, or the normalized multi-literal key text. */
const memberKeyDescriptor = (node: ts.TypeLiteralNode): string | null => {
  const keyType = keyPropOf(node)?.type;
  if (!keyType) return null;
  if (ts.isLiteralTypeNode(keyType) && ts.isStringLiteral(keyType.literal)) return keyType.literal.text;
  return norm(keyType.getText());
};

/** Ordered `key` string literals of every single-key object variant in the alias union. */
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

/**
 * One descriptor per object member of the alias union, in declaration order.
 */
const leafMemberDescriptorsFromSource = (
  source: ts.SourceFile,
  label: string,
  aliasName: string,
): string[] => {
  const alias = findAlias(source, label, aliasName);
  if (!ts.isUnionTypeNode(alias.type)) throw new Error(`${label}: ${aliasName} is not a union`);
  const out: string[] = [];
  for (const member of alias.type.types) {
    const flat = unwrap(member);
    if (!ts.isTypeLiteralNode(flat)) throw new Error(`${label}: ${aliasName} has a non-literal member`);
    const descriptor = memberKeyDescriptor(flat);
    if (!descriptor) throw new Error(`${label}: ${aliasName} member without a key`);
    out.push(descriptor);
  }
  return out;
};

const leafMemberDescriptors = (file: string, label: string, aliasName: string): string[] =>
  leafMemberDescriptorsFromSource(parse(file), label, aliasName);

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
    const descriptor = memberKeyDescriptor(flat);
    if (!descriptor) continue;
    const text = flat.getText(source);
    out.push({
      key: descriptor,
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

/** `localName <- exportedName` pairs per module specifier, in source order. */
const importBindingsBySpecifier = (file: string): Array<{ specifier: string; names: string[] }> => {
  const out: Array<{ specifier: string; names: string[] }> = [];
  for (const stmt of parse(file).statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const bindings = stmt.importClause?.namedBindings;
    const names: string[] = [];
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text;
        names.push(el.name.text === imported ? imported : `${el.name.text}<-${imported}`);
      }
    }
    out.push({ specifier: stmt.moduleSpecifier.text, names });
  }
  return out;
};

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

const keyDescriptor = (member: ts.TypeLiteralNode): string | null => memberKeyDescriptor(member);

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

/** Flattened effective member keys, resolving every extracted leaf union. */
const hubFlattenedKeys = (source?: ts.SourceFile): string[] => {
  const hub = source ?? parse(HUB);
  const annotation = unionKeysInOrder(abs('src/engine/cad/cadTransactionsAnnotationCommandTypes.ts'), 'annotation', 'CadAnnotationCommandPayload');
  const analysis = unionKeysInOrder(abs('src/engine/cad/cadTransactionsAnalysisCommandTypes.ts'), 'analysis', 'CadAnalysisCommandPayload');
  const blockPrelude = unionKeysInOrder(
    abs('src/engine/cad/cadTransactionsBlockCommandTypes.ts'), 'block', 'CadBlockPreludeCommandPayload');
  const blockDefinition = unionKeysInOrder(
    abs('src/engine/cad/cadTransactionsBlockCommandTypes.ts'), 'block', 'CadBlockDefinitionCommandPayload');
  const layer = unionKeysInOrder(
    abs('src/engine/cad/cadTransactionsLayerCommandTypes.ts'), 'layer', 'CadLayerCommandPayload');
  const survey = unionKeysInOrder(
    abs('src/engine/cad/cadTransactionsSurveyCommandTypes.ts'), 'survey', 'CadSurveyCommandPayload');
  const featureline = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsFeatureLineCommandTypes.ts'), 'featureline', 'CadFeatureLineCommandPayload');
  const designsurface = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsDesignSurfaceCommandTypes.ts'), 'designsurface', 'CadDesignSurfaceCommandPayload');
  const primitive = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes.ts'), 'primitive', 'CadPrimitiveDrawCommandPayload');
  const basiccurve = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsBasicCurveCommandTypes.ts'), 'basiccurve', 'CadBasicCurveCommandPayload');
  const alignment = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsAlignmentCommandTypes.ts'), 'alignment', 'CadAlignmentCommandPayload');
  const parcelConstruction = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsParcelConstructionCommandTypes.ts'), 'parcel', 'CadParcelConstructionCommandPayload');
  const planar = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsPlanarTransformCommandTypes.ts'), 'planar', 'CadPlanarTransformCommandPayload');
  const geometryedit = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsGeometryEditCommandTypes.ts'), 'geometryedit', 'CadGeometryEditCommandPayload');
  // STRUCT-241.16: expand both new aliases per-member (6 + 2, all
  // single-keyed, no widening).
  const sheet = leafMemberDescriptors(SHEET_LEAF, 'sheet', SHEET_ALIAS);
  const polytopo = leafMemberDescriptors(POLY_LEAF, 'polytopo', POLY_ALIAS);
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
      if (name === 'CadAnnotationCommandPayload') members.push(...annotation);
      else if (name === 'CadAnalysisCommandPayload') members.push(...analysis);
      else if (name === 'CadBlockPreludeCommandPayload') members.push(...blockPrelude);
      else if (name === 'CadBlockDefinitionCommandPayload') members.push(...blockDefinition);
      else if (name === 'CadLayerCommandPayload') members.push(...layer);
      else if (name === 'CadSurveyCommandPayload') members.push(...survey);
      else if (name === 'CadFeatureLineCommandPayload') members.push(...featureline);
      else if (name === 'CadDesignSurfaceCommandPayload') members.push(...designsurface);
      else if (name === 'CadPrimitiveDrawCommandPayload') members.push(...primitive);
      else if (name === 'CadBasicCurveCommandPayload') members.push(...basiccurve);
      else if (name === 'CadAlignmentCommandPayload') members.push(...alignment);
      else if (name === 'CadParcelConstructionCommandPayload') members.push(...parcelConstruction);
      else if (name === 'CadPlanarTransformCommandPayload') members.push(...planar);
      else if (name === 'CadGeometryEditCommandPayload') members.push(...geometryedit);
      else if (name === SHEET_ALIAS) members.push(...sheet);
      else if (name === POLY_ALIAS) members.push(...polytopo);
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
// Independent baseline pins: hand-transcribed from the frozen pre-refactor
// hub `CadCommand` block (the six sheet/viewport + two polyline-topology
// inline members, in order). They import no leaf type, so leaf drift cannot
// move both sides of an assertion.
// ---------------------------------------------------------------------------

type BaseSheetAdd = {
  key: 'SHEET_ADD';
  sheetId: string;
  sheetName: string;
};

type BaseSheetDelete = {
  key: 'SHEET_DELETE';
  sheetId: string;
};

type BaseViewportMove = {
  key: 'VIEWPORT_MOVE';
  sheetId: string;
  viewportId: string;
  x: number;
  y: number;
};

type BaseViewportScale = {
  key: 'VIEWPORT_SCALE';
  sheetId: string;
  viewportId: string;
  scaleDenominator: number;
};

type BaseViewportRotate = {
  key: 'VIEWPORT_ROTATE';
  sheetId: string;
  viewportId: string;
  rotationDeg: number;
};

type BaseTitleBlockEdit = {
  key: 'TITLE_BLOCK_EDIT';
  sheetId: string;
  definitionId: string;
  values: Record<string, string>;
};

type BasePolylineInsertVertex = {
  key: 'POLYLINE_INSERT_VERTEX';
  entityId: CadEntityId;
  courseIndex: number;
  x: number;
  y: number;
};

type BasePolylineDeleteVertex = {
  key: 'POLYLINE_DELETE_VERTEX';
  entityId: CadEntityId;
  vertexIndex: number;
};

/** One descriptor per leaf member, in declaration order (all single-keyed). */
const EXPECTED_SHEET_DESCRIPTORS = [
  'SHEET_ADD',
  'SHEET_DELETE',
  'VIEWPORT_MOVE',
  'VIEWPORT_SCALE',
  'VIEWPORT_ROTATE',
  'TITLE_BLOCK_EDIT',
] as const;

const EXPECTED_POLY_DESCRIPTORS = [
  'POLYLINE_INSERT_VERTEX',
  'POLYLINE_DELETE_VERTEX',
] as const;

/** Every moved literal. */
const EXPECTED_MOVED_LITERALS = [
  ...EXPECTED_SHEET_DESCRIPTORS,
  ...EXPECTED_POLY_DESCRIPTORS,
] as const;

const EXPECTED_SHEET_SHAPES: Record<string, string[]> = {
  SHEET_ADD: [
    "key: 'SHEET_ADD'",
    'sheetId: string',
    'sheetName: string',
  ],
  SHEET_DELETE: [
    "key: 'SHEET_DELETE'",
    'sheetId: string',
  ],
  VIEWPORT_MOVE: [
    "key: 'VIEWPORT_MOVE'",
    'sheetId: string',
    'viewportId: string',
    'x: number',
    'y: number',
  ],
  VIEWPORT_SCALE: [
    "key: 'VIEWPORT_SCALE'",
    'sheetId: string',
    'viewportId: string',
    'scaleDenominator: number',
  ],
  VIEWPORT_ROTATE: [
    "key: 'VIEWPORT_ROTATE'",
    'sheetId: string',
    'viewportId: string',
    'rotationDeg: number',
  ],
  TITLE_BLOCK_EDIT: [
    "key: 'TITLE_BLOCK_EDIT'",
    'sheetId: string',
    'definitionId: string',
    'values: Record<string, string>',
  ],
};

const EXPECTED_POLY_SHAPES: Record<string, string[]> = {
  POLYLINE_INSERT_VERTEX: [
    "key: 'POLYLINE_INSERT_VERTEX'",
    'entityId: CadEntityId',
    'courseIndex: number',
    'x: number',
    'y: number',
  ],
  POLYLINE_DELETE_VERTEX: [
    "key: 'POLYLINE_DELETE_VERTEX'",
    'entityId: CadEntityId',
    'vertexIndex: number',
  ],
};

/** The moved command-union Phase C3 header (travels with the polyline leaf). */
const MOVED_C3_HEADER = '// Phase C3 — polyline vertex topology (count-changing, one undo entry).';
/** The key-union Phase C3 header (stays in the hub; never part of the move). */
const KEY_UNION_C3_HEADER = '// Phase C3 — polyline vertex topology (insert/delete are count-changing).';
/** The CAD Curves F1 header (stays in the hub, ahead of the curve aliases). */
const F1_HEADER = '// CAD Curves F1 — six atomic curve commands + atomic subdivision.';

/** Untouched neighbour aliases pinned by position. */
const CURVE_F1_ALIASES = [
  'CadCurveBetweenLinesCommand',
  'CadCurveOnLinesCommand',
  'CadCurveThroughPointCommand',
  'CadMultipleCurvesCommand',
  'CadCurveFromEndCommand',
  'CadReverseCompoundCurveCommand',
  'CadSubdivideCurveCommand',
] as const;

/** The seven `CadCommandKey` literals that legitimately repeat (kept, never fixed). */
const EXPECTED_DUPLICATE_BLOCK_KEYS = [
  'BLOCK_CREATE', 'BLOCK_INSERT', 'BLOCK_EXPLODE', 'BLOCK_REDEFINE',
  'BLOCK_RENAME', 'BLOCK_DUPLICATE', 'BLOCK_DELETE',
] as const;

/** Raw SHA256 of the `CadCommandKey` alias slice (unchanged since STRUCT-241.2). */
const EXPECTED_CAD_COMMAND_KEY_RAW_SHA256 =
  '4ff8cd4aa25d062cf2abb729482ec4145cfc50098759327e992dd3f4beca1502';

/** SHA256 of JSON.stringify(hubKeyOrder()) — the exact ordered 248-literal list. */
const EXPECTED_CAD_COMMAND_KEY_ORDER_SHA256 =
  'b2121894e8112b5f14d576bc76d4248dfeb9ff1c82b351ed5f09ef8b7df2e21e';

/** SHA256 of the hub `export {};`-only emit (comment-stripped). */
const EXPECTED_HUB_EMIT_SHA256 =
  '2e29cd9a98755c46896f7a2d56524db2d6d96b248e36db46de14c30bf47c8d05';

// Compile-time leaf <-> hub round trip (enforced by project typecheck).
const leafToHub = (payload: CadSheetViewportCommandPayload | CadPolylineTopologyCommandPayload): CadCommand => payload;

describe('STRUCT-241.16 leaf presence and key order', () => {
  it('both command type leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(SHEET_LEAF), `leaf missing: ${relPosix(SHEET_LEAF)}`).toBe(true);
    expect(fs.existsSync(POLY_LEAF), `leaf missing: ${relPosix(POLY_LEAF)}`).toBe(true);
  });

  it('pins the 6 sheet/viewport keys in order with no duplicates', () => {
    expect(leafMemberDescriptors(SHEET_LEAF, 'sheet', SHEET_ALIAS)).toEqual([...EXPECTED_SHEET_DESCRIPTORS]);
    expect(unionKeysInOrder(SHEET_LEAF, 'sheet', SHEET_ALIAS)).toEqual([...EXPECTED_SHEET_DESCRIPTORS]);
  });

  it('pins the 2 polyline-topology keys in order with no duplicates', () => {
    expect(leafMemberDescriptors(POLY_LEAF, 'polytopo', POLY_ALIAS)).toEqual([...EXPECTED_POLY_DESCRIPTORS]);
    expect(unionKeysInOrder(POLY_LEAF, 'polytopo', POLY_ALIAS)).toEqual([...EXPECTED_POLY_DESCRIPTORS]);
  });

  it('moves the command-union Phase C3 header with the polyline leaf', () => {
    const hubText = fs.readFileSync(HUB, 'utf8');
    const polyText = fs.readFileSync(POLY_LEAF, 'utf8');
    const sheetText = fs.readFileSync(SHEET_LEAF, 'utf8');
    // The moved header appears exactly once in code position (newline +
    // two-space indent) inside the polyline leaf — the leaf doc comment
    // quotes the same text inside backticks, so the pin targets the code
    // occurrence — immediately ahead of the POLYLINE_INSERT_VERTEX body.
    const codeHeader = `\n  ${MOVED_C3_HEADER}`;
    expect(polyText.split(codeHeader).length - 1).toBe(1);
    expect(polyText.indexOf(codeHeader))
      .toBeLessThan(polyText.indexOf("key: 'POLYLINE_INSERT_VERTEX'"));
    // The hub no longer carries the moved header ...
    expect(hubText).not.toContain(MOVED_C3_HEADER);
    // ... but keeps the distinct key-union C3 header in the CadCommandKey run ...
    expect(hubText.split(KEY_UNION_C3_HEADER).length - 1).toBe(1);
    expect(hubText.indexOf(KEY_UNION_C3_HEADER))
      .toBeLessThan(hubText.indexOf("| 'POLYLINE_INSERT_VERTEX'"));
    // ... and the sheet leaf carries no Phase header at all.
    expect(sheetText).not.toContain('// Phase');
  });

  it('keeps the CAD Curves F1 header in the hub at its exact positions', () => {
    const hubText = fs.readFileSync(HUB, 'utf8');
    // The F1 header legitimately appears twice in the hub: once in the
    // CadCommandKey run and once in the CadCommand run (mirroring the
    // key-union C3 header, which likewise stays).
    expect(hubText.split(F1_HEADER).length - 1).toBe(2);
    // Key-union occurrence: after BEST_FIT_PARABOLA, before the first
    // curve key literal.
    expect(hubText.indexOf(F1_HEADER)).toBeLessThan(hubText.indexOf("| 'CURVE_BETWEEN_TWO_LINES_CREATE'"));
    expect(hubText.indexOf("| 'BEST_FIT_PARABOLA'")).toBeLessThan(hubText.indexOf(F1_HEADER));
    // Command-union occurrence: after the polyline alias splice and before
    // the first curve alias; the polyline leaf carries no F1 section header
    // (its doc comment merely names the neighbouring alias run).
    expect(hubText.indexOf(`| ${POLY_ALIAS}`)).toBeLessThan(hubText.lastIndexOf(F1_HEADER));
    expect(hubText.lastIndexOf(F1_HEADER))
      .toBeLessThan(hubText.indexOf('| CadCurveBetweenLinesCommand'));
    expect(fs.readFileSync(POLY_LEAF, 'utf8').split('\n  // CAD Curves F1').length - 1).toBe(0);
    expect(fs.readFileSync(SHEET_LEAF, 'utf8')).not.toContain('// CAD Curves F1');
  });
});

describe('STRUCT-241.16 baseline shapes: Extract<CadCommand> vs leaf vs Base*', () => {
  it('keeps sheet add/delete identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'SHEET_ADD' }>>()
      .toEqualTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'SHEET_ADD' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'SHEET_ADD' }>>().toEqualTypeOf<BaseSheetAdd>();
    expectTypeOf<Extract<CadCommand, { key: 'SHEET_DELETE' }>>()
      .toEqualTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'SHEET_DELETE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'SHEET_DELETE' }>>().toEqualTypeOf<BaseSheetDelete>();
  });

  it('keeps viewport move/scale/rotate identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'VIEWPORT_MOVE' }>>()
      .toEqualTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'VIEWPORT_MOVE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'VIEWPORT_MOVE' }>>().toEqualTypeOf<BaseViewportMove>();
    expectTypeOf<Extract<CadCommand, { key: 'VIEWPORT_SCALE' }>>()
      .toEqualTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'VIEWPORT_SCALE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'VIEWPORT_SCALE' }>>().toEqualTypeOf<BaseViewportScale>();
    expectTypeOf<Extract<CadCommand, { key: 'VIEWPORT_ROTATE' }>>()
      .toEqualTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'VIEWPORT_ROTATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'VIEWPORT_ROTATE' }>>().toEqualTypeOf<BaseViewportRotate>();
  });

  it('keeps title-block edit identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'TITLE_BLOCK_EDIT' }>>()
      .toEqualTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'TITLE_BLOCK_EDIT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'TITLE_BLOCK_EDIT' }>>().toEqualTypeOf<BaseTitleBlockEdit>();
  });

  it('keeps polyline insert/delete identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'POLYLINE_INSERT_VERTEX' }>>()
      .toEqualTypeOf<Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_INSERT_VERTEX' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'POLYLINE_INSERT_VERTEX' }>>()
      .toEqualTypeOf<BasePolylineInsertVertex>();
    expectTypeOf<Extract<CadCommand, { key: 'POLYLINE_DELETE_VERTEX' }>>()
      .toEqualTypeOf<Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_DELETE_VERTEX' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'POLYLINE_DELETE_VERTEX' }>>()
      .toEqualTypeOf<BasePolylineDeleteVertex>();
  });

  it('keeps both whole-leaf unions identical to their transcribed counterparts', () => {
    expectTypeOf<CadSheetViewportCommandPayload>().toEqualTypeOf<
      | BaseSheetAdd | BaseSheetDelete | BaseViewportMove
      | BaseViewportScale | BaseViewportRotate | BaseTitleBlockEdit
    >();
    expectTypeOf<CadPolylineTopologyCommandPayload>().toEqualTypeOf<
      BasePolylineInsertVertex | BasePolylineDeleteVertex
    >();
  });

  it('matches the transcribed AST property shapes and order', () => {
    const sheet = variantShapes(SHEET_LEAF, 'sheet', SHEET_ALIAS);
    const polytopo = variantShapes(POLY_LEAF, 'polytopo', POLY_ALIAS);
    expect(sheet.map((v) => v.key)).toEqual([...EXPECTED_SHEET_DESCRIPTORS]);
    expect(polytopo.map((v) => v.key)).toEqual([...EXPECTED_POLY_DESCRIPTORS]);
    for (const variant of sheet) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_SHEET_SHAPES[variant.key]!.map(pinShape),
      );
    }
    for (const variant of polytopo) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_POLY_SHAPES[variant.key]!.map(pinShape),
      );
    }
  });

  it('pins empty member JSDoc on all 8 variants (the hub run had none)', () => {
    for (const variant of variantShapes(SHEET_LEAF, 'sheet', SHEET_ALIAS)) {
      expect(variant.comments, `${variant.key} comment drift`).toEqual([]);
    }
    for (const variant of variantShapes(POLY_LEAF, 'polytopo', POLY_ALIAS)) {
      expect(variant.comments, `${variant.key} comment drift`).toEqual([]);
    }
  });

  it('keeps required fields required, optionals absent, and Array/Record exact', () => {
    expectTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'SHEET_ADD' }>['sheetId']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'SHEET_ADD' }>['sheetName']>()
      .toEqualTypeOf<string>();
    expectTypeOf<keyof Extract<CadSheetViewportCommandPayload, { key: 'SHEET_ADD' }>>()
      .toEqualTypeOf<'key' | 'sheetId' | 'sheetName'>();
    expectTypeOf<keyof Extract<CadSheetViewportCommandPayload, { key: 'SHEET_DELETE' }>>()
      .toEqualTypeOf<'key' | 'sheetId'>();
    expectTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'VIEWPORT_MOVE' }>['viewportId']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'VIEWPORT_MOVE' }>['x']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'VIEWPORT_MOVE' }>['y']>()
      .toEqualTypeOf<number>();
    expectTypeOf<keyof Extract<CadSheetViewportCommandPayload, { key: 'VIEWPORT_MOVE' }>>()
      .toEqualTypeOf<'key' | 'sheetId' | 'viewportId' | 'x' | 'y'>();
    expectTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'VIEWPORT_SCALE' }>['scaleDenominator']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'VIEWPORT_ROTATE' }>['rotationDeg']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'TITLE_BLOCK_EDIT' }>['definitionId']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadSheetViewportCommandPayload, { key: 'TITLE_BLOCK_EDIT' }>['values']>()
      .toEqualTypeOf<Record<string, string>>();
    expectTypeOf<keyof Extract<CadSheetViewportCommandPayload, { key: 'TITLE_BLOCK_EDIT' }>>()
      .toEqualTypeOf<'key' | 'sheetId' | 'definitionId' | 'values'>();
    // INSERT carries courseIndex (not vertexIndex); DELETE carries
    // vertexIndex (not courseIndex) — the C3 field-name distinction.
    expectTypeOf<Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_INSERT_VERTEX' }>['courseIndex']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_INSERT_VERTEX' }>['entityId']>()
      .toEqualTypeOf<CadEntityId>();
    expectTypeOf<Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_INSERT_VERTEX' }>['x']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_INSERT_VERTEX' }>['y']>()
      .toEqualTypeOf<number>();
    expectTypeOf<keyof Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_INSERT_VERTEX' }>>()
      .toEqualTypeOf<'key' | 'entityId' | 'courseIndex' | 'x' | 'y'>();
    expectTypeOf<Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_DELETE_VERTEX' }>['vertexIndex']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_DELETE_VERTEX' }>['entityId']>()
      .toEqualTypeOf<CadEntityId>();
    expectTypeOf<keyof Extract<CadPolylineTopologyCommandPayload, { key: 'POLYLINE_DELETE_VERTEX' }>>()
      .toEqualTypeOf<'key' | 'entityId' | 'vertexIndex'>();
    expectTypeOf<Extract<CadPolylineTopologyCommandPayload, { key: 'NOPE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadCommand, { key: 'NOPE' }>>().toEqualTypeOf<never>();
  });

  it('compiles full-field samples through the hub round trip', () => {
    const sheetSamples: CadSheetViewportCommandPayload[] = [
      { key: 'SHEET_ADD', sheetId: 's-1', sheetName: 'A-101' },
      { key: 'SHEET_DELETE', sheetId: 's-1' },
      { key: 'VIEWPORT_MOVE', sheetId: 's-1', viewportId: 'v-1', x: 10, y: 20 },
      { key: 'VIEWPORT_SCALE', sheetId: 's-1', viewportId: 'v-1', scaleDenominator: 50 },
      { key: 'VIEWPORT_ROTATE', sheetId: 's-1', viewportId: 'v-1', rotationDeg: 90 },
      { key: 'TITLE_BLOCK_EDIT', sheetId: 's-1', definitionId: 'tb-1', values: { drawn: 'JK' } },
    ];
    const polySamples: CadPolylineTopologyCommandPayload[] = [
      { key: 'POLYLINE_INSERT_VERTEX', entityId: 'e-1', courseIndex: 2, x: 1, y: 2 },
      { key: 'POLYLINE_DELETE_VERTEX', entityId: 'e-1', vertexIndex: 3 },
    ];
    for (const sample of [...sheetSamples, ...polySamples]) {
      expect(leafToHub(sample)).toBe(sample);
    }
    expect(Object.keys(sheetSamples[2]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_SHEET_SHAPES.VIEWPORT_MOVE!)].sort(),
    );
    expect(Object.keys(sheetSamples[5]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_SHEET_SHAPES.TITLE_BLOCK_EDIT!)].sort(),
    );
    expect(Object.keys(polySamples[0]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_POLY_SHAPES.POLYLINE_INSERT_VERTEX!)].sort(),
    );
  });
});

describe('STRUCT-241.16 hub union splice order and member counts', () => {
  it('measures 55 top-level members and documents the 61 -> 55 extraction', () => {
    const counts = hubTopLevelCounts();
    // STRUCT-241.16 roll-forward: 8 sheet/viewport + polyline-topology
    // inline members replaced by 2 alias references
    // (11 inline, 37 refs, 7 intersections).
    expect(counts).toEqual({ total: 55, inline: 11, refs: 37, intersections: 7 });
    // Re-inlining the two 241.16 leaves restores the 241.15 shape
    // 61 = 55 + 6 + 2 - 2 (11 inline + 37 refs + 7 intersections at the
    // 241.16 pin; the 61 shape held 19 inline + 35 refs + 7).
    expect(leafMemberDescriptors(SHEET_LEAF, 'sheet', SHEET_ALIAS).length).toBe(6);
    expect(leafMemberDescriptors(POLY_LEAF, 'polytopo', POLY_ALIAS).length).toBe(2);
    expect(counts.total + 6 + 2 - 2).toBe(61);
  });

  it('splices the sheet/viewport group between geometry-edit and block-prelude', () => {
    const seq = hubMemberSequence();
    const geometryedit = seq.findIndex((m) => m.kind === 'ref' && m.label === 'CadGeometryEditCommandPayload');
    expect(seq[geometryedit]).toEqual({ kind: 'ref', label: 'CadGeometryEditCommandPayload' });
    expect(seq[geometryedit + 1]).toEqual({ kind: 'ref', label: SHEET_ALIAS });
    expect(seq[geometryedit + 2]).toEqual({ kind: 'ref', label: 'CadBlockPreludeCommandPayload' });
  });

  it('splices the polyline-topology group between design-surface and Curve F1', () => {
    const seq = hubMemberSequence();
    const designsurface = seq.findIndex((m) => m.kind === 'ref' && m.label === 'CadDesignSurfaceCommandPayload');
    expect(seq[designsurface]).toEqual({ kind: 'ref', label: 'CadDesignSurfaceCommandPayload' });
    expect(seq[designsurface + 1]).toEqual({ kind: 'ref', label: POLY_ALIAS });
    expect(seq[designsurface + 2]).toEqual({ kind: 'ref', label: 'CadCurveBetweenLinesCommand' });
  });

  it('keeps the Curve F1 aliases in their exact order after the polyline splice', () => {
    const seq = hubMemberSequence();
    const poly = seq.findIndex((m) => m.kind === 'ref' && m.label === POLY_ALIAS);
    for (const [offset, label] of CURVE_F1_ALIASES.map((label, index) => [index + 1, label] as const)) {
      expect(seq[poly + offset]).toEqual({ kind: 'ref', label });
    }
  });

  it('flattens to the exact 168 effective members in the original sequence', () => {
    const flat = hubFlattenedKeys();
    expect(flat.length).toBe(168);
    // SURVEYTABLE_EDIT anchors the planar run at flattened index 53.
    expect(flat[53]).toBe('SURVEYTABLE_EDIT');
    expect(flat.slice(60, 63)).toEqual(['HELMERT2D', 'GRIDGROUND', 'PROJECTTRANSFORM']);
    // The sheet run follows the geometry-edit run contiguously.
    expect(flat[63]).toBe('EXTEND');
    expect(flat[69]).toBe('GRIP_EDIT');
    expect(flat.slice(70, 76)).toEqual([...EXPECTED_SHEET_DESCRIPTORS]);
    expect(flat[76]).toBe('BLOCK_SEED');
    // The polyline run follows the design-surface run contiguously.
    const group = flat.indexOf('CadGradingGroupCommandPayload');
    expect(flat.slice(group + 1, group + 6)).toEqual(
      ['SURFPURPOSE', 'DESIGNSURFACE', 'DESIGNAPPLY', 'DESIGNVOLUME', 'DESIGNPATCH'],
    );
    expect(flat.slice(group + 6, group + 9)).toEqual([...EXPECTED_POLY_DESCRIPTORS, 'CadCurveBetweenLinesCommand']);
    // Older anchors unchanged: ERASE at 2, TRAVERSE/BATCH_COGO at 16/17.
    expect(flat[2]).toBe('ERASE');
    expect(flat[16]).toBe('TRAVERSE');
    expect(flat[17]).toBe('BATCH_COGO');
  });

  it('leaves no inline sheet/viewport/polyline key behind in the hub union', () => {
    const inlineSets = hubInlineKeySets();
    expect(inlineSets.length).toBe(11);
    const moved: Set<string> = new Set([...EXPECTED_MOVED_LITERALS]);
    for (const set of inlineSets) {
      for (const key of set) {
        expect(moved.has(key), `inline ${key} still in hub`).toBe(false);
      }
    }
    // The union bodies themselves are gone from the hub text (the
    // CadCommandKey literal runs stay).
    const hubText = fs.readFileSync(HUB, 'utf8');
    for (const probe of ["key: 'SHEET_ADD'", "key: 'SHEET_DELETE'", "key: 'VIEWPORT_MOVE'", "key: 'VIEWPORT_SCALE'", "key: 'VIEWPORT_ROTATE'", "key: 'TITLE_BLOCK_EDIT'", "key: 'POLYLINE_INSERT_VERTEX'", "key: 'POLYLINE_DELETE_VERTEX'"]) {
      expect(hubText, `hub still carries ${probe}`).not.toContain(probe);
    }
    for (const probe of ['sheetName', 'viewportId', 'scaleDenominator', 'rotationDeg', 'definitionId', 'courseIndex']) {
      expect(hubText.split(probe).length - 1, `hub still carries ${probe}`).toBe(0);
    }
    // vertexIndex survives nowhere in the hub union: GRIP_EDIT (its only
    // other carrier) already lives in the geometry-edit leaf.
    expect(hubText.split('vertexIndex').length - 1, 'hub still carries vertexIndex').toBe(0);
  });

  it('keeps the hub CadEntityId import (still used outside the moved members)', () => {
    const hubText = fs.readFileSync(HUB, 'utf8');
    expect(hubText).toContain('CadEntityId');
    expect(hubText).toContain("key: 'SURVEYTABLE_EDIT'");
    expect(hubText).toContain("from './cadTypes'");
  });
});

describe('STRUCT-241.16 CadCommandKey unchanged', () => {
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

  it('keeps the exact ordered literal list byte-identical (ordered digest)', () => {
    expect(createHash('sha256').update(JSON.stringify(hubKeyOrder())).digest('hex'))
      .toBe(EXPECTED_CAD_COMMAND_KEY_ORDER_SHA256);
    expect(hubKeyOrder()[0]).toBe('SELECT_ALL');
    expect(hubKeyOrder()[hubKeyOrder().length - 1]).toBe('SUBDIVIDE_CURVE_CREATE');
  });

  it('keeps the sheet/viewport key run in its original position', () => {
    const keys = hubKeyOrder();
    expect(keys[keys.indexOf('GRIP_EDIT') + 1]).toBe('SHEET_ADD');
    expect(keys.slice(keys.indexOf('SHEET_ADD'), keys.indexOf('SHEET_ADD') + 6)).toEqual(
      [...EXPECTED_SHEET_DESCRIPTORS],
    );
    expect(keys[keys.indexOf('TITLE_BLOCK_EDIT') + 1]).toBe('BLOCK_SEED');
  });

  it('keeps the polyline-topology key run in its original position', () => {
    const keys = hubKeyOrder();
    expect(keys.slice(keys.indexOf('DESIGNPATCH'), keys.indexOf('DESIGNPATCH') + 3)).toEqual(
      ['DESIGNPATCH', ...EXPECTED_POLY_DESCRIPTORS],
    );
    expect(keys[keys.indexOf('POLYLINE_DELETE_VERTEX') + 1]).toBe('BEST_FIT_LINE');
    expect(keys[keys.indexOf('BEST_FIT_PARABOLA') + 1]).toBe('CURVE_BETWEEN_TWO_LINES_CREATE');
  });
});

describe('STRUCT-241.16 public transaction types unchanged', () => {
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
    const definitionProbe: CadCommandDefinition<CadCommand> = { key: 'SHEET_ADD', execute: () => null };
    const transactionProbe: CadTransaction = {
      id: 't-1', sequence: 1, commandKey: 'POLYLINE_INSERT_VERTEX', label: 'insert',
      beforeSelectionIds: [], afterSelectionIds: [], addedEntityIds: [], removedEntityIds: [],
    };
    expect([definitionProbe.key, transactionProbe.commandKey]).toEqual(['SHEET_ADD', 'POLYLINE_INSERT_VERTEX']);
    expectTypeOf<CadCommand extends { key: string } ? true : false>().toEqualTypeOf<true>();
  });
});

describe('STRUCT-241.16 type-only leaves and emit parity', () => {
  it('sheet/viewport leaf imports nothing', () => {
    expect(runtimeImportSpecifiers(SHEET_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(SHEET_LEAF)).toBe(true);
    expect(valueStatementKinds(SHEET_LEAF)).toEqual([]);
    expect(allImportSpecifiers(SHEET_LEAF)).toEqual([]);
    expect(importBindingsBySpecifier(SHEET_LEAF)).toEqual([]);
  });

  it('polyline-topology leaf imports exactly the allow-listed type module', () => {
    expect(runtimeImportSpecifiers(POLY_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(POLY_LEAF)).toBe(true);
    expect(valueStatementKinds(POLY_LEAF)).toEqual([]);
    expect(allImportSpecifiers(POLY_LEAF)).toEqual(['./cadCorePrimitiveTypes']);
    expect(importBindingsBySpecifier(POLY_LEAF)).toEqual([
      { specifier: './cadCorePrimitiveTypes', names: ['CadEntityId'] },
    ]);
  });

  it('transpiled emit is marker-only for the hub and both leaves', () => {
    expect(strippedEmit(HUB)).toBe('export {};');
    expect(strippedEmit(SHEET_LEAF)).toBe('export {};');
    expect(strippedEmit(POLY_LEAF)).toBe('export {};');
    expect(createHash('sha256').update(strippedEmit(HUB)).digest('hex'))
      .toBe(EXPECTED_HUB_EMIT_SHA256);
  });
});

describe('STRUCT-241.16 sheet/polyline regression neighbours covered by import existence', () => {
  it.each([
    'cad_draft_sheets',
    'cad_draft_sheet_layout_19b',
    'cad_sheet_dialogs_19b',
    'cad_sheet_history_19b',
    'cad_sheet_scene_parity_19b',
    'cad_polyline_vertex_topology_c3',
    'cad_polyline_vertex_topology_c3_commands',
    'cad_polyline_vertex_editing_c3_commands',
    'cad_polyline_vertex_editing_c3_grips',
    'cad_polyline_vertex_c3_corrections',
    'cad_polyline_vertex_c3_label_association',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))
      || fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.tsx`))).toBe(true);
  });

  it('sheet and polyline command engine modules exist', () => {
    for (const relative of [
      'src/engine/cad/cadSheets.ts',
      'src/engine/cad/cadSheetObjects.ts',
      'src/engine/cad/cadPolylineTopology.ts',
      'src/engine/cad/cadTransactionsPolylineCommand.ts',
    ]) {
      expect(fs.existsSync(abs(relative)), `engine module missing: ${relative}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.16 extraction is type-only: +2 nodes / +3 type edges (2 hub
// imports + 1 polyline out-edge + 0 sheet out-edges − 0 retired edges).
// Both historical value/mixed digests stay identical.
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

describe('STRUCT-241.16 CAD+F2F graph pins', () => {
  // First cold graph parse in this file; allow headroom under full-suite CI contention.
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // Post-241.15 baseline 511 / 2483; the two type-only leaves add +2 nodes
    // and +3 type edges (2 hub imports + 1 polyline out-edge + 0 sheet
    // out-edges − 0 retired edges).
    expect(graph.nodes.length).toBe(514);
    expect(graph.edges.length).toBe(2489);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1588,
      uniqPairs: 1570,
      sha: 'f1ef85bbd9e6cc3f0a7d9d82407a133dc92cf8f041640626036c34a7c90552d1',
    });
  }, 30_000);

  it('adds exactly the allow-listed TYPE edges incident to the two leaves', () => {
    const graph = cadF2fGraph();
    const sheetLeaf = path.resolve(SHEET_LEAF);
    const polyLeaf = path.resolve(POLY_LEAF);
    expect(graph.edges.filter((edge) => edge.from === sheetLeaf)).toEqual([]);
    expect(graph.edges.filter((edge) => edge.from === polyLeaf)).toEqual([
      {
        from: polyLeaf,
        to: path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts')),
        specifier: './cadCorePrimitiveTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter((edge) => edge.to === sheetLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: sheetLeaf,
        specifier: './cadTransactionsSheetViewportCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter((edge) => edge.to === polyLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: polyLeaf,
        specifier: './cadTransactionsPolylineTopologyCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter(
      (edge) => (edge.from === sheetLeaf || edge.to === sheetLeaf || edge.from === polyLeaf || edge.to === polyLeaf)
        && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('keeps the ./cadTypes barrel edge and retires no hub edge', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    // The hub still imports identities and project types from the barrel.
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadTypes.ts')),
    ).length).toBeGreaterThan(0);
    // The shared entity-id alias now also arrives via the polyline leaf;
    // the hub never imports the core-primitive leaf directly.
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts')),
    )).toEqual([]);
  });

  it('has no leaf back-edge to the transaction hub or command executors', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    for (const leaf of [path.resolve(SHEET_LEAF), path.resolve(POLY_LEAF)]) {
      for (const target of [
        hub,
        path.resolve(path.join(CAD_DIR, 'cadTransactions.ts')),
        path.resolve(path.join(CAD_DIR, 'cadSheets.ts')),
        path.resolve(path.join(CAD_DIR, 'cadSheetObjects.ts')),
        path.resolve(path.join(CAD_DIR, 'cadPolylineTopology.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsPolylineCommand.ts')),
      ]) {
        expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
      }
      expect(graph.edges.filter((edge) => edge.from === leaf && edge.kind !== 'type')).toEqual([]);
    }
  });
});

describe('STRUCT-241.16 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // Post-241.15 baseline 1683 / 7594; the two leaves add the same +2 / +3
    // (every 241.16 edge resolves inside `src`).
    expect(graph.nodes.length).toBe(1686);
    expect(graph.edges.length).toBe(7600);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4447,
      uniqPairs: 4388,
      sha: 'e1bad92e1864e6093b9399f95e08464d1fa3e1bbb94f3767bbaa6017205bc410',
    });
  }, 120_000);
});

describe('STRUCT-241.16 negative controls (in-memory mutations only)', () => {
  // Pristine disk contents captured at collection time (describe bodies run
  // before any `it`), so the worktree-clean guard compares against the
  // pre-control state instead of reading the files twice at the end.
  const pristineSheet = fs.readFileSync(SHEET_LEAF, 'utf8');
  const pristinePoly = fs.readFileSync(POLY_LEAF, 'utf8');
  const pristineHub = fs.readFileSync(HUB, 'utf8');
  const sheetSource = (): string => fs.readFileSync(SHEET_LEAF, 'utf8');
  const polySource = (): string => fs.readFileSync(POLY_LEAF, 'utf8');
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('fails the shape pin when SHEET_ADD sheetName is dropped', () => {
    const mutated = sheetSource().replace(
      "      key: 'SHEET_ADD';\n      sheetId: string;\n      sheetName: string;",
      "      key: 'SHEET_ADD';\n      sheetId: string;",
    );
    expect(mutated).not.toBe(sheetSource());
    const add = variantShapesFromSource(parseText('m.ts', mutated), 'm', SHEET_ALIAS)
      .find((v) => v.key === 'SHEET_ADD')!;
    expect(() => expect(add.props).toEqual(EXPECTED_SHEET_SHAPES.SHEET_ADD!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when SHEET_DELETE sheetId is dropped', () => {
    const mutated = sheetSource().replace(
      "      key: 'SHEET_DELETE';\n      sheetId: string;",
      "      key: 'SHEET_DELETE';",
    );
    expect(mutated).not.toBe(sheetSource());
    const del = variantShapesFromSource(parseText('m.ts', mutated), 'm', SHEET_ALIAS)
      .find((v) => v.key === 'SHEET_DELETE')!;
    expect(() => expect(del.props).toEqual(EXPECTED_SHEET_SHAPES.SHEET_DELETE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when VIEWPORT_MOVE viewportId is dropped', () => {
    const mutated = sheetSource().replace(
      "      key: 'VIEWPORT_MOVE';\n      sheetId: string;\n      viewportId: string;\n      x: number;\n      y: number;",
      "      key: 'VIEWPORT_MOVE';\n      sheetId: string;\n      x: number;\n      y: number;",
    );
    expect(mutated).not.toBe(sheetSource());
    const move = variantShapesFromSource(parseText('m.ts', mutated), 'm', SHEET_ALIAS)
      .find((v) => v.key === 'VIEWPORT_MOVE')!;
    expect(() => expect(move.props).toEqual(EXPECTED_SHEET_SHAPES.VIEWPORT_MOVE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when VIEWPORT_MOVE x widens to string', () => {
    const mutated = sheetSource().replace(
      '      viewportId: string;\n      x: number;\n      y: number;',
      '      viewportId: string;\n      x: string;\n      y: number;',
    );
    expect(mutated).not.toBe(sheetSource());
    const move = variantShapesFromSource(parseText('m.ts', mutated), 'm', SHEET_ALIAS)
      .find((v) => v.key === 'VIEWPORT_MOVE')!;
    expect(() => expect(move.props).toEqual(EXPECTED_SHEET_SHAPES.VIEWPORT_MOVE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when VIEWPORT_MOVE y becomes optional', () => {
    const mutated = sheetSource().replace(
      '      viewportId: string;\n      x: number;\n      y: number;',
      '      viewportId: string;\n      x: number;\n      y?: number;',
    );
    expect(mutated).not.toBe(sheetSource());
    const move = variantShapesFromSource(parseText('m.ts', mutated), 'm', SHEET_ALIAS)
      .find((v) => v.key === 'VIEWPORT_MOVE')!;
    expect(() => expect(move.props).toEqual(EXPECTED_SHEET_SHAPES.VIEWPORT_MOVE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when VIEWPORT_SCALE scaleDenominator widens to string', () => {
    const mutated = sheetSource().replace(
      '      viewportId: string;\n      scaleDenominator: number;',
      '      viewportId: string;\n      scaleDenominator: string;',
    );
    expect(mutated).not.toBe(sheetSource());
    const scale = variantShapesFromSource(parseText('m.ts', mutated), 'm', SHEET_ALIAS)
      .find((v) => v.key === 'VIEWPORT_SCALE')!;
    expect(() => expect(scale.props).toEqual(EXPECTED_SHEET_SHAPES.VIEWPORT_SCALE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when VIEWPORT_ROTATE rotationDeg becomes optional', () => {
    const mutated = sheetSource().replace(
      '      viewportId: string;\n      rotationDeg: number;',
      '      viewportId: string;\n      rotationDeg?: number;',
    );
    expect(mutated).not.toBe(sheetSource());
    const rotate = variantShapesFromSource(parseText('m.ts', mutated), 'm', SHEET_ALIAS)
      .find((v) => v.key === 'VIEWPORT_ROTATE')!;
    expect(() => expect(rotate.props).toEqual(EXPECTED_SHEET_SHAPES.VIEWPORT_ROTATE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when TITLE_BLOCK_EDIT values weakens to Record<string, unknown>', () => {
    const mutated = sheetSource().replace(
      '      values: Record<string, string>;',
      '      values: Record<string, unknown>;',
    );
    expect(mutated).not.toBe(sheetSource());
    const edit = variantShapesFromSource(parseText('m.ts', mutated), 'm', SHEET_ALIAS)
      .find((v) => v.key === 'TITLE_BLOCK_EDIT')!;
    expect(() => expect(edit.props).toEqual(EXPECTED_SHEET_SHAPES.TITLE_BLOCK_EDIT!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when INSERT courseIndex is renamed to vertexIndex', () => {
    const mutated = polySource().replace(
      '      courseIndex: number;',
      '      vertexIndex: number;',
    );
    expect(mutated).not.toBe(polySource());
    const insert = variantShapesFromSource(parseText('m.ts', mutated), 'm', POLY_ALIAS)
      .find((v) => v.key === 'POLYLINE_INSERT_VERTEX')!;
    expect(() => expect(insert.props).toEqual(EXPECTED_POLY_SHAPES.POLYLINE_INSERT_VERTEX!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when INSERT x is dropped', () => {
    const mutated = polySource().replace(
      '      courseIndex: number;\n      x: number;\n      y: number;',
      '      courseIndex: number;\n      y: number;',
    );
    expect(mutated).not.toBe(polySource());
    const insert = variantShapesFromSource(parseText('m.ts', mutated), 'm', POLY_ALIAS)
      .find((v) => v.key === 'POLYLINE_INSERT_VERTEX')!;
    expect(() => expect(insert.props).toEqual(EXPECTED_POLY_SHAPES.POLYLINE_INSERT_VERTEX!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when INSERT entityId weakens to string', () => {
    const mutated = polySource().replace(
      "      key: 'POLYLINE_INSERT_VERTEX';\n      entityId: CadEntityId;",
      "      key: 'POLYLINE_INSERT_VERTEX';\n      entityId: string;",
    );
    expect(mutated).not.toBe(polySource());
    const insert = variantShapesFromSource(parseText('m.ts', mutated), 'm', POLY_ALIAS)
      .find((v) => v.key === 'POLYLINE_INSERT_VERTEX')!;
    expect(() => expect(insert.props).toEqual(EXPECTED_POLY_SHAPES.POLYLINE_INSERT_VERTEX!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when DELETE vertexIndex becomes optional', () => {
    const mutated = polySource().replace(
      '      vertexIndex: number;',
      '      vertexIndex?: number;',
    );
    expect(mutated).not.toBe(polySource());
    const del = variantShapesFromSource(parseText('m.ts', mutated), 'm', POLY_ALIAS)
      .find((v) => v.key === 'POLYLINE_DELETE_VERTEX')!;
    expect(() => expect(del.props).toEqual(EXPECTED_POLY_SHAPES.POLYLINE_DELETE_VERTEX!.map(pinShape)))
      .toThrow();
  });

  it('fails the header pin when the moved Phase C3 comment is edited', () => {
    const mutated = polySource().replace(
      `\n  ${MOVED_C3_HEADER}`,
      '\n  // Phase C3 — polyline vertex topology (edited).',
    );
    expect(mutated).not.toBe(polySource());
    expect(() => expect(mutated.split(`\n  ${MOVED_C3_HEADER}`).length - 1).toBe(1)).toThrow();
  });

  it('fails the header pin when the hub F1 header is removed', () => {
    const source = hubSource();
    expect(source).toContain(F1_HEADER);
    const mutated = source.replace(`\n  ${F1_HEADER}`, '');
    expect(mutated).not.toBe(source);
    expect(() => expect(mutated.split(F1_HEADER).length - 1).toBe(2)).toThrow();
  });

  it('fails the splice guard when the hub drops the sheet/viewport splice', () => {
    const source = hubSource();
    const refLine = `  | ${SHEET_ALIAS}\n`;
    expect(source).toContain(refLine);
    const mutated = source.replace(refLine, '');
    expect(mutated).not.toBe(source);
    const counts = hubTopLevelCounts(parseText('mutated-hub.ts', mutated));
    expect(() => expect(counts).toEqual({ total: 55, inline: 11, refs: 37, intersections: 7 })).toThrow();
    const flat = hubFlattenedKeys(parseText('mutated-hub.ts', mutated));
    expect(() => expect(flat.length).toBe(168)).toThrow();
  });

  it('fails the splice guard when the hub drops the polyline-topology splice', () => {
    const source = hubSource();
    const refLine = `  | ${POLY_ALIAS}\n`;
    expect(source).toContain(refLine);
    const mutated = source.replace(refLine, '');
    expect(mutated).not.toBe(source);
    const counts = hubTopLevelCounts(parseText('mutated-hub.ts', mutated));
    expect(() => expect(counts).toEqual({ total: 55, inline: 11, refs: 37, intersections: 7 })).toThrow();
    const flat = hubFlattenedKeys(parseText('mutated-hub.ts', mutated));
    expect(() => expect(flat.length).toBe(168)).toThrow();
  });

  it('fails the ordering guard when the two hub splices are reversed', () => {
    const source = hubSource();
    const mutated = source
      .replace(`  | ${SHEET_ALIAS}\n`, '__SWAP_SHEET__\n')
      .replace(`  | ${POLY_ALIAS}\n`, `  | ${SHEET_ALIAS}\n`)
      .replace('__SWAP_SHEET__\n', `  | ${POLY_ALIAS}\n`);
    expect(mutated).not.toBe(source);
    const seq = hubMemberSequence(parseText('mutated-hub.ts', mutated));
    const geometryedit = seq.findIndex((m) => m.kind === 'ref' && m.label === 'CadGeometryEditCommandPayload');
    expect(() => expect(seq[geometryedit + 1]).toEqual({ kind: 'ref', label: SHEET_ALIAS })).toThrow();
  });

  it('fails the ordering guard when sheet/viewport variants reorder', () => {
    const source = sheetSource();
    const shapes = variantShapesFromSource(parseText('leaf.ts', source), 'leaf', SHEET_ALIAS);
    const add = shapes.find((v) => v.key === 'SHEET_ADD')!.text;
    const title = shapes.find((v) => v.key === 'TITLE_BLOCK_EDIT')!.text;
    const mutated = source.replace(add, '__SWAP__').replace(title, add).replace('__SWAP__', title);
    expect(mutated).not.toBe(source);
    const swapped = variantShapesFromSource(parseText('m.ts', mutated), 'm', SHEET_ALIAS);
    expect(swapped.map((v) => v.key)).toHaveLength(6);
    expect(() => expect(swapped.map((v) => v.key)).toEqual([...EXPECTED_SHEET_DESCRIPTORS])).toThrow();
  });

  it('fails the acyclicity guard on a synthetic TYPE back-edge to the hub', () => {
    const mutated = `${polySource()}\nimport type { CadCommand } from './cadTransactions.types';\ntype BackEdge = CadCommand;\n`;
    expect(mutated).not.toBe(polySource());
    // Extract the specifier list from the MUTATED text (not the pristine
    // file): the back-edge must be visible to the same helper the allowlist
    // pin uses, and the allowlist pin must reject it.
    const mutatedSpecs = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(allImportSpecifiers(POLY_LEAF)).not.toContain('./cadTransactions.types');
    expect(mutatedSpecs).toContain('./cadTransactions.types');
    expect(() => expect(mutatedSpecs).toEqual(allImportSpecifiers(POLY_LEAF))).toThrow();
  });

  it('fails the type-only guard on a synthetic VALUE import in the leaf', () => {
    const mutated = polySource().replace(
      "import type { CadEntityId } from './cadCorePrimitiveTypes';",
      "import { CadEntityId } from './cadCorePrimitiveTypes';",
    );
    expect(mutated).not.toBe(polySource());
    const runtime = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt))
      .filter((stmt) => stmt.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword)
      .map((stmt) => stmt.moduleSpecifier.getText());
    expect(runtime).toContain("'./cadCorePrimitiveTypes'");
    expect(() => expect(runtime).toEqual([])).toThrow();
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(SHEET_LEAF, 'utf8')).toBe(pristineSheet);
    expect(fs.readFileSync(POLY_LEAF, 'utf8')).toBe(pristinePoly);
    expect(fs.readFileSync(HUB, 'utf8')).toBe(pristineHub);
    expect(sheetSource()).toBe(pristineSheet);
    expect(polySource()).toBe(pristinePoly);
    expect(hubSource()).toBe(pristineHub);
    // Static proof: every mutation above goes through in-memory parseText;
    // this file performs no filesystem writes (patterns split so this
    // assertion cannot match its own source text).
    const selfText = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    for (const probe of ['write' + 'FileSync', 'append' + 'FileSync', 'fs.' + 'openSync']) {
      expect(selfText.includes(probe), `self write call ${probe}`).toBe(false);
    }
  });
}, 30_000);
