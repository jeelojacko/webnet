/**
 * STRUCT-241.14 — CAD primitive-draw + basic-curve command payload type leaves.
 *
 * Pins `src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes.ts`, which
 * extracts the thirteen primitive-draw command payloads out of the
 * `CadCommand` union as one public union, and
 * `src/engine/cad/cadTransactionsBasicCurveCommandTypes.ts`, which extracts
 * the six basic curve-creation payloads as one public union, so the hub
 * splices both back into their original contiguous positions:
 *  - `CadPrimitiveDrawCommandPayload` (13): POINT, COGO_POINT, LINE,
 *    LINE_CREATE_BATCH, RECTANGLE, POLYGON, CIRCLE, CIRCLECD, CIRCLE2P,
 *    CIRCLE3P, CIRCLETTR, CIRCLETTT, PLINE — between ERASE and TRAVERSE.
 *  - `CadBasicCurveCommandPayload` (6): ARC_3PT, ARC_CREATE, BEST_FIT_LINE,
 *    BEST_FIT_ARC, BEST_FIT_PARABOLA, TANGENT_CURVE — between BATCH_COGO and
 *    the `CadAlignmentCommandPayload` alias.
 *
 * Covers: hand-transcribed pre-refactor `Base*` shapes + AST property pins
 * (key literals, property order, optionality, the
 * `'inscribed' | 'circumscribed'` polygon literal, required
 * `createdBy: string`, the three verbatim PLINE JSDoc blocks and the
 * verbatim LINE_CREATE_BATCH JSDoc block, the nested ARC_CREATE definition
 * object, the `sourceEntityId?` best-fit samples, the tangent-source picks);
 * per-key `Extract<CadCommand>` equivalence in both directions (all 19
 * members are single-keyed, so plain single-literal selectors apply — no
 * double-key documentation needed); the byte-identical `CadCommandKey`
 * (248 literals / 241 unique / 7 legacy duplicate BLOCK keys kept, plus the
 * ordered-list digest); both splice sentinels (ERASE before, TRAVERSE after,
 * BATCH_COGO before, the alignment alias after) + 72 top-level + 168
 * flattened effective members; public transaction types; type-only emit
 * pins; CAD+F2F and full-`src` graph pins with an explicit +2 node / +3
 * type-edge allowlist (2 hub imports + 2 primitive-draw out-edges + 0
 * basic-curve out-edges − 1 retired hub tangent-solver edge; the hub keeps
 * its `./cadTypes` barrel edge and never imports the tangent-solver or
 * polyline-geometry modules directly); in-memory negative controls; and
 * primitive / curve regression neighbours by import existence only.
 *
 * There was no original Phase section header above these two runs in the hub
 * union, and none is invented in either leaf — pinned below.
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
import type { CadTangentSource } from '../src/engine/cad/cadGeometryCircleTangentSolvers';
import type {
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from '../src/engine/cad/cadPrimitiveGeometryEntityTypes';
import type { CadPrimitiveDrawCommandPayload } from '../src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes';
import type { CadBasicCurveCommandPayload } from '../src/engine/cad/cadTransactionsBasicCurveCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const PR_LEAF = path.join(CAD_DIR, 'cadTransactionsPrimitiveDrawCommandTypes.ts');
const BC_LEAF = path.join(CAD_DIR, 'cadTransactionsBasicCurveCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');
const PR_ALIAS = 'CadPrimitiveDrawCommandPayload';
const BC_ALIAS = 'CadBasicCurveCommandPayload';

const abs = (relative: string): string => path.join(REPO_ROOT, relative);
const relPosix = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// TypeScript compiler helpers (same shape as the STRUCT-241.13 guard).
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
  // STRUCT-241.14: expand both new aliases per-member (all single-keyed:
  // 13 + 6, no widening).
  const primitive = leafMemberDescriptors(PR_LEAF, 'primitive', PR_ALIAS);
  const basiccurve = leafMemberDescriptors(BC_LEAF, 'basiccurve', BC_ALIAS);
  const alignment = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsAlignmentCommandTypes.ts'), 'alignment', 'CadAlignmentCommandPayload');
  const parcelConstruction = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsParcelConstructionCommandTypes.ts'), 'parcel', 'CadParcelConstructionCommandPayload');
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
      else if (name === PR_ALIAS) members.push(...primitive);
      else if (name === BC_ALIAS) members.push(...basiccurve);
      else if (name === 'CadAlignmentCommandPayload') members.push(...alignment);
      else if (name === 'CadParcelConstructionCommandPayload') members.push(...parcelConstruction);
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
// hub `CadCommand` block (the thirteen primitive-draw + six basic-curve
// inline members, in order). They import no leaf type, so leaf drift cannot
// move both sides of an assertion.
// ---------------------------------------------------------------------------

type LabeledPoint = { x: number; y: number; label: string };

type BasePoint = {
  key: 'POINT';
  x: number;
  y: number;
  label?: string;
};

type BaseCogoPoint = {
  key: 'COGO_POINT';
  x: number;
  y: number;
  label?: string;
  basisLabel: string;
  directionLabel: string;
};

type BaseLine = {
  key: 'LINE';
  start: LabeledPoint;
  end: LabeledPoint;
};

type BaseLineCreateBatch = {
  key: 'LINE_CREATE_BATCH';
  segments: Array<{ start: LabeledPoint; end: LabeledPoint }>;
  createdBy: string;
};

type BaseRectangle = {
  key: 'RECTANGLE';
  firstCorner: LabeledPoint;
  oppositeCorner: LabeledPoint;
};

type BasePolygon = {
  key: 'POLYGON';
  center: LabeledPoint;
  through: LabeledPoint;
  sides: number;
  mode: 'inscribed' | 'circumscribed';
};

type BaseCircle = {
  key: 'CIRCLE';
  center: LabeledPoint;
  radius: number;
};

type BaseCircleCd = {
  key: 'CIRCLECD';
  center: LabeledPoint;
  diameter: number;
};

type BaseCircle2P = {
  key: 'CIRCLE2P';
  first: LabeledPoint;
  second: LabeledPoint;
};

type BaseCircle3P = {
  key: 'CIRCLE3P';
  first: LabeledPoint;
  second: LabeledPoint;
  third: LabeledPoint;
};

type BaseCircleTtr = {
  key: 'CIRCLETTR';
  first: CadTangentSource;
  second: CadTangentSource;
  radius: number;
};

type BaseCircleTtt = {
  key: 'CIRCLETTT';
  first: CadTangentSource;
  second: CadTangentSource;
  third: CadTangentSource;
};

type BasePline = {
  key: 'PLINE';
  vertices: LabeledPoint[];
  closed?: boolean;
  segmentGeometry?: CadPolylineSegmentGeometry[];
  segmentWidths?: CadPolylineSegmentWidth[];
};

type BaseArc3Pt = {
  key: 'ARC_3PT';
  start: LabeledPoint;
  through: LabeledPoint;
  end: LabeledPoint;
};

type BaseArcCreate = {
  key: 'ARC_CREATE';
  modeLabel: string;
  definition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  };
  metadata?: Record<string, unknown>;
};

type BaseBestFitLine = {
  key: 'BEST_FIT_LINE';
  samples: { x: number; y: number; label: string; sourceEntityId?: string }[];
};

type BaseBestFitArc = {
  key: 'BEST_FIT_ARC';
  samples: { x: number; y: number; label: string; sourceEntityId?: string }[];
};

type BaseBestFitParabola = {
  key: 'BEST_FIT_PARABOLA';
  samples: { x: number; y: number; label: string; sourceEntityId?: string }[];
};

type BaseTangentCurve = {
  key: 'TANGENT_CURVE';
  pi: LabeledPoint;
  backTangentPoint: LabeledPoint;
  aheadTangentPoint: LabeledPoint;
  radius: number;
};

/** One descriptor per leaf member, in declaration order (all single-keyed). */
const EXPECTED_PRIMITIVE_DESCRIPTORS = [
  'POINT',
  'COGO_POINT',
  'LINE',
  'LINE_CREATE_BATCH',
  'RECTANGLE',
  'POLYGON',
  'CIRCLE',
  'CIRCLECD',
  'CIRCLE2P',
  'CIRCLE3P',
  'CIRCLETTR',
  'CIRCLETTT',
  'PLINE',
] as const;

const EXPECTED_BASICCURVE_DESCRIPTORS = [
  'ARC_3PT',
  'ARC_CREATE',
  'BEST_FIT_LINE',
  'BEST_FIT_ARC',
  'BEST_FIT_PARABOLA',
  'TANGENT_CURVE',
] as const;

/** Every moved literal. */
const EXPECTED_MOVED_LITERALS = [
  ...EXPECTED_PRIMITIVE_DESCRIPTORS,
  ...EXPECTED_BASICCURVE_DESCRIPTORS,
] as const;

const LABELED_POINT_SHAPE = '{ x: number; y: number; label: string }';

const EXPECTED_PRIMITIVE_SHAPES: Record<string, string[]> = {
  POINT: [
    "key: 'POINT'",
    'x: number',
    'y: number',
    'label?: string',
  ],
  COGO_POINT: [
    "key: 'COGO_POINT'",
    'x: number',
    'y: number',
    'label?: string',
    'basisLabel: string',
    'directionLabel: string',
  ],
  LINE: [
    "key: 'LINE'",
    `start: ${LABELED_POINT_SHAPE}`,
    `end: ${LABELED_POINT_SHAPE}`,
  ],
  LINE_CREATE_BATCH: [
    "key: 'LINE_CREATE_BATCH'",
    `segments: Array<{ start: ${LABELED_POINT_SHAPE}; end: ${LABELED_POINT_SHAPE}; }>`,
    'createdBy: string',
  ],
  RECTANGLE: [
    "key: 'RECTANGLE'",
    `firstCorner: ${LABELED_POINT_SHAPE}`,
    `oppositeCorner: ${LABELED_POINT_SHAPE}`,
  ],
  POLYGON: [
    "key: 'POLYGON'",
    `center: ${LABELED_POINT_SHAPE}`,
    `through: ${LABELED_POINT_SHAPE}`,
    'sides: number',
    "mode: 'inscribed' | 'circumscribed'",
  ],
  CIRCLE: [
    "key: 'CIRCLE'",
    `center: ${LABELED_POINT_SHAPE}`,
    'radius: number',
  ],
  CIRCLECD: [
    "key: 'CIRCLECD'",
    `center: ${LABELED_POINT_SHAPE}`,
    'diameter: number',
  ],
  CIRCLE2P: [
    "key: 'CIRCLE2P'",
    `first: ${LABELED_POINT_SHAPE}`,
    `second: ${LABELED_POINT_SHAPE}`,
  ],
  CIRCLE3P: [
    "key: 'CIRCLE3P'",
    `first: ${LABELED_POINT_SHAPE}`,
    `second: ${LABELED_POINT_SHAPE}`,
    `third: ${LABELED_POINT_SHAPE}`,
  ],
  CIRCLETTR: [
    "key: 'CIRCLETTR'",
    'first: CadTangentSource',
    'second: CadTangentSource',
    'radius: number',
  ],
  CIRCLETTT: [
    "key: 'CIRCLETTT'",
    'first: CadTangentSource',
    'second: CadTangentSource',
    'third: CadTangentSource',
  ],
  PLINE: [
    "key: 'PLINE'",
    `vertices: ${LABELED_POINT_SHAPE}[]`,
    'closed?: boolean',
    'segmentGeometry?: CadPolylineSegmentGeometry[]',
    'segmentWidths?: CadPolylineSegmentWidth[]',
  ],
};

const EXPECTED_BASICCURVE_SHAPES: Record<string, string[]> = {
  ARC_3PT: [
    "key: 'ARC_3PT'",
    `start: ${LABELED_POINT_SHAPE}`,
    `through: ${LABELED_POINT_SHAPE}`,
    `end: ${LABELED_POINT_SHAPE}`,
  ],
  ARC_CREATE: [
    "key: 'ARC_CREATE'",
    'modeLabel: string',
    'definition: { center: { x: number; y: number }; radius: number; startAngleDeg: number; endAngleDeg: number; }',
    'metadata?: Record<string, unknown>',
  ],
  BEST_FIT_LINE: [
    "key: 'BEST_FIT_LINE'",
    'samples: { x: number; y: number; label: string; sourceEntityId?: string }[]',
  ],
  BEST_FIT_ARC: [
    "key: 'BEST_FIT_ARC'",
    'samples: { x: number; y: number; label: string; sourceEntityId?: string }[]',
  ],
  BEST_FIT_PARABOLA: [
    "key: 'BEST_FIT_PARABOLA'",
    'samples: { x: number; y: number; label: string; sourceEntityId?: string }[]',
  ],
  TANGENT_CURVE: [
    "key: 'TANGENT_CURVE'",
    `pi: ${LABELED_POINT_SHAPE}`,
    `backTangentPoint: ${LABELED_POINT_SHAPE}`,
    `aheadTangentPoint: ${LABELED_POINT_SHAPE}`,
    'radius: number',
  ],
};

/**
 * Per-variant member JSDoc blocks in the leaves, transcribed verbatim from
 * the pre-refactor hub members (only LINE_CREATE_BATCH and PLINE carried
 * inline documentation).
 */
const EXPECTED_LINE_CREATE_BATCH_COMMENTS = [
  '/** User-facing creation mode recorded as metadata.createdBy. */',
];

const EXPECTED_PLINE_COMMENTS = [
  '/** Absent/false = open polyline. True = closed ring stored without a\n'
    + '       *  duplicate closure vertex (the renderer/segment law wraps to first). */',
  '/** Phase C2 optional per-course bulge metadata; absent = all-line.\n'
    + '       *  Trailing optional (no version bump). */',
  '/** Phase C2 optional per-course full centred band widths (metres);\n'
    + '       *  absent = zero-width. Trailing optional (no version bump). */',
];

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
const leafToHub = (payload: CadPrimitiveDrawCommandPayload | CadBasicCurveCommandPayload): CadCommand => payload;

const tangentSample = (id: string): CadTangentSource => ({
  primitive: {
    kind: 'line', entityId: id, segmentId: 's-1',
    start: { x: 0, y: 0 }, end: { x: 10, y: 0 },
  },
  pickPoint: { x: 5, y: 0 },
});

describe('STRUCT-241.14 leaf presence and key order', () => {
  it('both command type leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(PR_LEAF), `leaf missing: ${relPosix(PR_LEAF)}`).toBe(true);
    expect(fs.existsSync(BC_LEAF), `leaf missing: ${relPosix(BC_LEAF)}`).toBe(true);
  });

  it('pins the 13 primitive-draw keys in order with no duplicates', () => {
    expect(leafMemberDescriptors(PR_LEAF, 'primitive', PR_ALIAS)).toEqual([...EXPECTED_PRIMITIVE_DESCRIPTORS]);
    expect(unionKeysInOrder(PR_LEAF, 'primitive', PR_ALIAS)).toEqual([...EXPECTED_PRIMITIVE_DESCRIPTORS]);
  });

  it('pins the 6 basic-curve keys in order with no duplicates', () => {
    expect(leafMemberDescriptors(BC_LEAF, 'basiccurve', BC_ALIAS)).toEqual([...EXPECTED_BASICCURVE_DESCRIPTORS]);
    expect(unionKeysInOrder(BC_LEAF, 'basiccurve', BC_ALIAS)).toEqual([...EXPECTED_BASICCURVE_DESCRIPTORS]);
  });

  it('invents no Phase section header in either leaf (the hub runs had none)', () => {
    for (const leaf of [PR_LEAF, BC_LEAF]) {
      expect(fs.readFileSync(leaf, 'utf8')).not.toContain('// Phase');
    }
    // The hub splice region (ERASE through the alignment alias) carries no
    // line or block comments either.
    const hubText = fs.readFileSync(HUB, 'utf8');
    const eraseIdx = hubText.indexOf("key: 'ERASE'");
    const alignIdx = hubText.indexOf('CadAlignmentCommandPayload', eraseIdx);
    expect(eraseIdx).toBeGreaterThanOrEqual(0);
    expect(alignIdx).toBeGreaterThan(eraseIdx);
    const region = hubText.slice(eraseIdx, alignIdx);
    // Positive control so the guard below cannot pass vacuously on an
    // empty/wrong region.
    expect(region).toContain('| CadPrimitiveDrawCommandPayload');
    expect(region).toContain('| CadBasicCurveCommandPayload');
    expect(region).not.toContain('//');
    expect(region).not.toContain('/*');
  });
});

describe('STRUCT-241.14 baseline shapes: Extract<CadCommand> vs leaf vs Base*', () => {
  it('keeps point/cogo/line/batch members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'POINT' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'POINT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'POINT' }>>().toEqualTypeOf<BasePoint>();
    expectTypeOf<Extract<CadCommand, { key: 'COGO_POINT' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'COGO_POINT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'COGO_POINT' }>>().toEqualTypeOf<BaseCogoPoint>();
    expectTypeOf<Extract<CadCommand, { key: 'LINE' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'LINE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'LINE' }>>().toEqualTypeOf<BaseLine>();
    expectTypeOf<Extract<CadCommand, { key: 'LINE_CREATE_BATCH' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'LINE_CREATE_BATCH' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'LINE_CREATE_BATCH' }>>().toEqualTypeOf<BaseLineCreateBatch>();
  });

  it('keeps rectangle/polygon/circle members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'RECTANGLE' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'RECTANGLE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'RECTANGLE' }>>().toEqualTypeOf<BaseRectangle>();
    expectTypeOf<Extract<CadCommand, { key: 'POLYGON' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'POLYGON' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'POLYGON' }>>().toEqualTypeOf<BasePolygon>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLE' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLE' }>>().toEqualTypeOf<BaseCircle>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLECD' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLECD' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLECD' }>>().toEqualTypeOf<BaseCircleCd>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLE2P' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLE2P' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLE2P' }>>().toEqualTypeOf<BaseCircle2P>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLE3P' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLE3P' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLE3P' }>>().toEqualTypeOf<BaseCircle3P>();
  });

  it('keeps tangent-circle/polyline members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLETTR' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLETTR' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLETTR' }>>().toEqualTypeOf<BaseCircleTtr>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLETTT' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLETTT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CIRCLETTT' }>>().toEqualTypeOf<BaseCircleTtt>();
    expectTypeOf<Extract<CadCommand, { key: 'PLINE' }>>()
      .toEqualTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'PLINE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PLINE' }>>().toEqualTypeOf<BasePline>();
  });

  it('keeps basic-curve members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'ARC_3PT' }>>()
      .toEqualTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'ARC_3PT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ARC_3PT' }>>().toEqualTypeOf<BaseArc3Pt>();
    expectTypeOf<Extract<CadCommand, { key: 'ARC_CREATE' }>>()
      .toEqualTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'ARC_CREATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ARC_CREATE' }>>().toEqualTypeOf<BaseArcCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'BEST_FIT_LINE' }>>()
      .toEqualTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'BEST_FIT_LINE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BEST_FIT_LINE' }>>().toEqualTypeOf<BaseBestFitLine>();
    expectTypeOf<Extract<CadCommand, { key: 'BEST_FIT_ARC' }>>()
      .toEqualTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'BEST_FIT_ARC' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BEST_FIT_ARC' }>>().toEqualTypeOf<BaseBestFitArc>();
    expectTypeOf<Extract<CadCommand, { key: 'BEST_FIT_PARABOLA' }>>()
      .toEqualTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'BEST_FIT_PARABOLA' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'BEST_FIT_PARABOLA' }>>().toEqualTypeOf<BaseBestFitParabola>();
    expectTypeOf<Extract<CadCommand, { key: 'TANGENT_CURVE' }>>()
      .toEqualTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'TANGENT_CURVE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'TANGENT_CURVE' }>>().toEqualTypeOf<BaseTangentCurve>();
  });

  it('keeps both whole-leaf unions identical to their transcribed counterparts', () => {
    expectTypeOf<CadPrimitiveDrawCommandPayload>().toEqualTypeOf<
      | BasePoint | BaseCogoPoint | BaseLine | BaseLineCreateBatch | BaseRectangle
      | BasePolygon | BaseCircle | BaseCircleCd | BaseCircle2P | BaseCircle3P
      | BaseCircleTtr | BaseCircleTtt | BasePline
    >();
    expectTypeOf<CadBasicCurveCommandPayload>().toEqualTypeOf<
      | BaseArc3Pt | BaseArcCreate | BaseBestFitLine
      | BaseBestFitArc | BaseBestFitParabola | BaseTangentCurve
    >();
  });

  it('matches the transcribed AST property shapes and order', () => {
    const primitive = variantShapes(PR_LEAF, 'primitive', PR_ALIAS);
    const basiccurve = variantShapes(BC_LEAF, 'basiccurve', BC_ALIAS);
    expect(primitive.map((v) => v.key)).toEqual([...EXPECTED_PRIMITIVE_DESCRIPTORS]);
    expect(basiccurve.map((v) => v.key)).toEqual([...EXPECTED_BASICCURVE_DESCRIPTORS]);
    for (const variant of primitive) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_PRIMITIVE_SHAPES[variant.key]!.map(pinShape),
      );
    }
    for (const variant of basiccurve) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_BASICCURVE_SHAPES[variant.key]!.map(pinShape),
      );
    }
  });

  it('pins the verbatim member JSDoc blocks (batch + all three PLINE blocks)', () => {
    const primitive = variantShapes(PR_LEAF, 'primitive', PR_ALIAS);
    const batch = primitive.find((v) => v.key === 'LINE_CREATE_BATCH')!;
    expect(batch.comments).toEqual(EXPECTED_LINE_CREATE_BATCH_COMMENTS);
    const pline = primitive.find((v) => v.key === 'PLINE')!;
    expect(pline.comments).toEqual(EXPECTED_PLINE_COMMENTS);
    for (const variant of primitive) {
      if (variant.key === 'LINE_CREATE_BATCH' || variant.key === 'PLINE') continue;
      expect(variant.comments, `${variant.key} comment drift`).toEqual([]);
    }
    const basiccurve = variantShapes(BC_LEAF, 'basiccurve', BC_ALIAS);
    for (const variant of basiccurve) {
      expect(variant.comments, `${variant.key} comment drift`).toEqual([]);
    }
  });

  it('keeps required fields required, optionals optional, and literal unions exact', () => {
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'POINT' }>['x']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'POINT' }>['label']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'COGO_POINT' }>['basisLabel']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'COGO_POINT' }>['directionLabel']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'LINE' }>['start']>()
      .toEqualTypeOf<{ x: number; y: number; label: string }>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'LINE_CREATE_BATCH' }>['segments']>()
      .toEqualTypeOf<Array<{ start: { x: number; y: number; label: string }; end: { x: number; y: number; label: string } }>>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'LINE_CREATE_BATCH' }>['createdBy']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'POLYGON' }>['sides']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'POLYGON' }>['mode']>()
      .toEqualTypeOf<'inscribed' | 'circumscribed'>();
    expectTypeOf<keyof Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLE' }>>()
      .toEqualTypeOf<'key' | 'center' | 'radius'>();
    expectTypeOf<keyof Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLECD' }>>()
      .toEqualTypeOf<'key' | 'center' | 'diameter'>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLETTR' }>['first']>()
      .toEqualTypeOf<CadTangentSource>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLETTR' }>['second']>()
      .toEqualTypeOf<CadTangentSource>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLETTR' }>['radius']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'CIRCLETTT' }>['third']>()
      .toEqualTypeOf<CadTangentSource>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'PLINE' }>['closed']>()
      .toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'PLINE' }>['segmentGeometry']>()
      .toEqualTypeOf<CadPolylineSegmentGeometry[] | undefined>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'PLINE' }>['segmentWidths']>()
      .toEqualTypeOf<CadPolylineSegmentWidth[] | undefined>();
    expectTypeOf<keyof Extract<CadPrimitiveDrawCommandPayload, { key: 'PLINE' }>>()
      .toEqualTypeOf<'key' | 'vertices' | 'closed' | 'segmentGeometry' | 'segmentWidths'>();
    expectTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'ARC_CREATE' }>['modeLabel']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'ARC_CREATE' }>['definition']>()
      .toEqualTypeOf<{
        center: { x: number; y: number };
        radius: number;
        startAngleDeg: number;
        endAngleDeg: number;
      }>();
    expectTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'ARC_CREATE' }>['metadata']>()
      .toEqualTypeOf<Record<string, unknown> | undefined>();
    expectTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'BEST_FIT_LINE' }>['samples']>()
      .toEqualTypeOf<{ x: number; y: number; label: string; sourceEntityId?: string }[]>();
    expectTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'BEST_FIT_ARC' }>['samples']>()
      .toEqualTypeOf<{ x: number; y: number; label: string; sourceEntityId?: string }[]>();
    expectTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'BEST_FIT_PARABOLA' }>['samples']>()
      .toEqualTypeOf<{ x: number; y: number; label: string; sourceEntityId?: string }[]>();
    expectTypeOf<Extract<CadBasicCurveCommandPayload, { key: 'TANGENT_CURVE' }>['radius']>()
      .toEqualTypeOf<number>();
    expectTypeOf<keyof Extract<CadBasicCurveCommandPayload, { key: 'TANGENT_CURVE' }>>()
      .toEqualTypeOf<'key' | 'pi' | 'backTangentPoint' | 'aheadTangentPoint' | 'radius'>();
    expectTypeOf<Extract<CadPrimitiveDrawCommandPayload, { key: 'NOPE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadCommand, { key: 'NOPE' }>>().toEqualTypeOf<never>();
  });

  it('pins the tangent-source pick counts (2 for CIRCLETTR, 3 for CIRCLETTT)', () => {
    const primitive = variantShapes(PR_LEAF, 'primitive', PR_ALIAS);
    const picks = (key: string): number =>
      primitive.find((v) => v.key === key)!.props
        .filter((prop) => prop === 'first:CadTangentSource'
          || prop === 'second:CadTangentSource'
          || prop === 'third:CadTangentSource').length;
    expect(picks('CIRCLETTR')).toBe(2);
    expect(picks('CIRCLETTT')).toBe(3);
    expect(primitive.find((v) => v.key === 'CIRCLETTR')!.props).toEqual(
      EXPECTED_PRIMITIVE_SHAPES.CIRCLETTR!.map(pinShape),
    );
  });

  it('compiles full-field samples through the hub round trip', () => {
    const labeled = (x: number, y: number, label: string): LabeledPoint => ({ x, y, label });
    const primitiveSamples: CadPrimitiveDrawCommandPayload[] = [
      { key: 'POINT', x: 1, y: 2 },
      { key: 'COGO_POINT', x: 1, y: 2, label: 'P1', basisLabel: 'B', directionLabel: 'N45E' },
      { key: 'LINE', start: labeled(0, 0, 'A'), end: labeled(1, 1, 'B') },
      {
        key: 'LINE_CREATE_BATCH',
        segments: [{ start: labeled(0, 0, 'A'), end: labeled(1, 1, 'B') }],
        createdBy: 'manual',
      },
      { key: 'RECTANGLE', firstCorner: labeled(0, 0, 'A'), oppositeCorner: labeled(5, 5, 'B') },
      { key: 'POLYGON', center: labeled(0, 0, 'C'), through: labeled(1, 0, 'T'), sides: 6, mode: 'inscribed' },
      { key: 'CIRCLE', center: labeled(0, 0, 'C'), radius: 5 },
      { key: 'CIRCLECD', center: labeled(0, 0, 'C'), diameter: 10 },
      { key: 'CIRCLE2P', first: labeled(0, 0, 'A'), second: labeled(1, 0, 'B') },
      { key: 'CIRCLE3P', first: labeled(0, 0, 'A'), second: labeled(1, 0, 'B'), third: labeled(0, 1, 'C') },
      { key: 'CIRCLETTR', first: tangentSample('e-1'), second: tangentSample('e-2'), radius: 3 },
      { key: 'CIRCLETTT', first: tangentSample('e-1'), second: tangentSample('e-2'), third: tangentSample('e-3') },
      {
        key: 'PLINE', vertices: [labeled(0, 0, 'A'), labeled(1, 0, 'B')], closed: true,
        segmentGeometry: [{ kind: 'line' }], segmentWidths: [],
      },
    ];
    const curveSamples: CadBasicCurveCommandPayload[] = [
      { key: 'ARC_3PT', start: labeled(0, 0, 'A'), through: labeled(1, 1, 'T'), end: labeled(2, 0, 'B') },
      {
        key: 'ARC_CREATE', modeLabel: 'center-radius',
        definition: { center: { x: 0, y: 0 }, radius: 5, startAngleDeg: 0, endAngleDeg: 90 },
        metadata: { createdBy: 'manual' },
      },
      { key: 'BEST_FIT_LINE', samples: [{ x: 0, y: 0, label: 'S1', sourceEntityId: 'e-1' }] },
      { key: 'BEST_FIT_ARC', samples: [{ x: 0, y: 0, label: 'S1' }, { x: 1, y: 1, label: 'S2' }] },
      { key: 'BEST_FIT_PARABOLA', samples: [{ x: 0, y: 0, label: 'S1', sourceEntityId: 'e-9' }] },
      {
        key: 'TANGENT_CURVE', pi: labeled(1, 1, 'PI'),
        backTangentPoint: labeled(0, 0, 'B'), aheadTangentPoint: labeled(2, 0, 'A'), radius: 10,
      },
    ];
    for (const sample of [...primitiveSamples, ...curveSamples]) {
      expect(leafToHub(sample)).toBe(sample);
    }
    expect(Object.keys(primitiveSamples[12]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_PRIMITIVE_SHAPES.PLINE!)].sort(),
    );
    expect(Object.keys(curveSamples[1]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_BASICCURVE_SHAPES.ARC_CREATE!)].sort(),
    );
  });
});

describe('STRUCT-241.14 hub union splice order and member counts', () => {
  it('measures 72 top-level members and documents the 89 -> 72 extraction', () => {
    const counts = hubTopLevelCounts();
    expect(counts).toEqual({ total: 72, inline: 32, refs: 33, intersections: 7 });
    // Re-inlining the two leaves restores the 241.13 shape 89 = 32 + 13 + 6
    // bodies + 31 old refs + 2 alias references... precisely:
    // 89 = 72 + 13 + 6 - 2.
    expect(leafMemberDescriptors(PR_LEAF, 'primitive', PR_ALIAS).length).toBe(13);
    expect(leafMemberDescriptors(BC_LEAF, 'basiccurve', BC_ALIAS).length).toBe(6);
    expect(counts.total + 13 + 6 - 2).toBe(89);
  });

  it('splices the primitive group between ERASE and TRAVERSE', () => {
    const seq = hubMemberSequence();
    const erase = seq.findIndex((m) => m.kind === 'inline' && m.label === 'ERASE');
    expect(seq[erase]).toEqual({ kind: 'inline', label: 'ERASE' });
    expect(seq[erase + 1]).toEqual({ kind: 'ref', label: PR_ALIAS });
    expect(seq[erase + 2]).toEqual({ kind: 'inline', label: 'TRAVERSE' });
  });

  it('splices the basic-curve group between BATCH_COGO and the alignment alias', () => {
    const seq = hubMemberSequence();
    const batch = seq.findIndex((m) => m.kind === 'inline' && m.label === 'BATCH_COGO');
    expect(seq[batch]).toEqual({ kind: 'inline', label: 'BATCH_COGO' });
    expect(seq[batch + 1]).toEqual({ kind: 'ref', label: BC_ALIAS });
    expect(seq[batch + 2]).toEqual({ kind: 'ref', label: 'CadAlignmentCommandPayload' });
  });

  it('flattens to the exact 168 effective members in the original sequence', () => {
    const flat = hubFlattenedKeys();
    expect(flat.length).toBe(168);
    // ERASE anchors the primitive run at flattened index 2.
    expect(flat[2]).toBe('ERASE');
    expect(flat.slice(3, 16)).toEqual([...EXPECTED_PRIMITIVE_DESCRIPTORS]);
    expect(flat[16]).toBe('TRAVERSE');
    expect(flat[17]).toBe('BATCH_COGO');
    expect(flat.slice(18, 24)).toEqual([...EXPECTED_BASICCURVE_DESCRIPTORS]);
    // TANGENT_CURVE still anchors the alignment run at flattened index 23.
    expect(flat[23]).toBe('TANGENT_CURVE');
    expect(flat.slice(24, 30)).toEqual([
      'ALIGNMENT_CREATE', 'ALIGNMENT_OFFSET_CREATE', 'ALIGNMENT_STATION_REPORT',
      'ALIGNMENT_STATION_EQUATION', 'ALIGNMENT_OFFSET_POINT', 'ALIGNMENT_INTERVAL_POINTS',
    ]);
    expect(flat.slice(30, 39)).toEqual([
      'PARCEL_CREATE', 'PARCEL_SPLIT', 'PARCEL_SPLIT_BEARING', 'PARCEL_SPLIT_AREA',
      'PARCEL_SPLIT_SLIDE', 'PARCEL_SPLIT_SWING', 'PARCELCOURSEARC',
      'PARCELCOURSELINE', 'PARCEL_LAYOUT_AUTO',
    ]);
    expect(flat[39]).toBe('LINETABLE');
  });

  it('leaves no inline primitive/basic-curve key behind in the hub union', () => {
    const inlineSets = hubInlineKeySets();
    expect(inlineSets.length).toBe(32);
    const moved: Set<string> = new Set([...EXPECTED_MOVED_LITERALS]);
    for (const set of inlineSets) {
      for (const key of set) {
        expect(moved.has(key), `inline ${key} still in hub`).toBe(false);
      }
    }
    // The union bodies themselves are gone from the hub text (the
    // CadCommandKey literal runs stay).
    const hubText = fs.readFileSync(HUB, 'utf8');
    for (const probe of ["key: 'COGO_POINT'", "key: 'LINE_CREATE_BATCH'", "key: 'CIRCLETTR'", "key: 'ARC_CREATE'", "key: 'BEST_FIT_PARABOLA'"]) {
      expect(hubText, `hub still carries ${probe}`).not.toContain(probe);
    }
  });

  it('retires the tangent-source and polyline-geometry specifiers from the hub', () => {
    const hubText = fs.readFileSync(HUB, 'utf8');
    expect(hubText.split('CadTangentSource').length - 1).toBe(0);
    expect(hubText.split('CadPolylineSegmentGeometry').length - 1).toBe(0);
    expect(hubText.split('CadPolylineSegmentWidth').length - 1).toBe(0);
    // The hub still references the primitive identity alias elsewhere.
    expect(hubText).toContain('CadEntityId');
  });
});

describe('STRUCT-241.14 CadCommandKey unchanged', () => {
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

  it('keeps the primitive and basic-curve key runs in their original positions', () => {
    const keys = hubKeyOrder();
    expect(keys.slice(keys.indexOf('POINT'), keys.indexOf('POINT') + 13)).toEqual(
      [...EXPECTED_PRIMITIVE_DESCRIPTORS],
    );
    expect(keys[keys.indexOf('ERASE') + 1]).toBe('POINT');
    expect(keys[keys.indexOf('PLINE') + 1]).toBe('TRAVERSE');
    expect(keys[keys.indexOf('BATCH_COGO') + 1]).toBe('ARC_3PT');
    expect(keys.slice(keys.indexOf('ARC_3PT'), keys.indexOf('ARC_3PT') + 3)).toEqual(
      ['ARC_3PT', 'ARC_CREATE', 'TANGENT_CURVE'],
    );
    expect(keys[keys.indexOf('TANGENT_CURVE') + 1]).toBe('ALIGNMENT_CREATE');
  });
});

describe('STRUCT-241.14 public transaction types unchanged', () => {
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
    const definitionProbe: CadCommandDefinition<CadCommand> = { key: 'CIRCLETTR', execute: () => null };
    const transactionProbe: CadTransaction = {
      id: 't-1', sequence: 1, commandKey: 'PLINE', label: 'draw',
      beforeSelectionIds: [], afterSelectionIds: [], addedEntityIds: [], removedEntityIds: [],
    };
    expect([definitionProbe.key, transactionProbe.commandKey]).toEqual(['CIRCLETTR', 'PLINE']);
    expectTypeOf<CadCommand extends { key: string } ? true : false>().toEqualTypeOf<true>();
  });
});

describe('STRUCT-241.14 type-only leaves and emit parity', () => {
  it('primitive-draw leaf imports exactly the allow-listed type modules', () => {
    expect(runtimeImportSpecifiers(PR_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(PR_LEAF)).toBe(true);
    expect(valueStatementKinds(PR_LEAF)).toEqual([]);
    expect(allImportSpecifiers(PR_LEAF)).toEqual([
      './cadGeometryCircleTangentSolvers',
      './cadPrimitiveGeometryEntityTypes',
    ]);
    expect(importBindingsBySpecifier(PR_LEAF)).toEqual([
      { specifier: './cadGeometryCircleTangentSolvers', names: ['CadTangentSource'] },
      {
        specifier: './cadPrimitiveGeometryEntityTypes',
        names: ['CadPolylineSegmentGeometry', 'CadPolylineSegmentWidth'],
      },
    ]);
  });

  it('basic-curve leaf imports nothing', () => {
    expect(runtimeImportSpecifiers(BC_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(BC_LEAF)).toBe(true);
    expect(valueStatementKinds(BC_LEAF)).toEqual([]);
    expect(allImportSpecifiers(BC_LEAF)).toEqual([]);
    expect(importBindingsBySpecifier(BC_LEAF)).toEqual([]);
  });

  it('transpiled emit is marker-only for the hub and both leaves', () => {
    expect(strippedEmit(HUB)).toBe('export {};');
    expect(strippedEmit(PR_LEAF)).toBe('export {};');
    expect(strippedEmit(BC_LEAF)).toBe('export {};');
    expect(createHash('sha256').update(strippedEmit(HUB)).digest('hex'))
      .toBe(EXPECTED_HUB_EMIT_SHA256);
  });
});

describe('STRUCT-241.14 primitive/curve regression neighbours covered by import existence', () => {
  it.each([
    'cad_best_fit_line',
    'cad_best_fit_arc',
    'cad_best_fit_parabola',
    'cad_best_fit_commands_c1',
    'cad_circle_tangent_b2',
    'cad_circle_construction_b2',
    'cad_circle_transactions_v1',
    'cad_polyline_bulge_width_c2_core',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });

  it('primitive and curve command engine modules exist', () => {
    for (const relative of [
      'src/engine/cad/cadTransactionsCurveCommands.ts',
      'src/engine/cad/cadTransactionsBestFitCommands.ts',
      'src/engine/cad/cadTransactionsLineBatchCommand.ts',
      'src/engine/cad/cadTransactionsPolylineCommand.ts',
      'src/engine/cad/cadTransactionsTraverseCommands.ts',
      'src/engine/cad/cadTransactionsBatchCogoCommand.ts',
    ]) {
      expect(fs.existsSync(abs(relative)), `engine module missing: ${relative}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.14 extraction is type-only: +2 nodes / +3 type edges (2 hub
// imports + 2 primitive-draw out-edges + 0 basic-curve out-edges − 1
// retired hub tangent-solver edge; the hub keeps its ./cadTypes barrel edge
// and never imported the polyline-geometry module directly). Both
// historical value/mixed digests stay identical.
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

describe('STRUCT-241.14 CAD+F2F graph pins', () => {
  // First cold graph parse in this file; allow headroom under full-suite CI contention.
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // Post-241.13 baseline 507 / 2475; the two type-only leaves add +2 nodes
    // and +3 type edges (2 hub imports + 2 primitive-draw out-edges + 0
    // basic-curve out-edges − 1 retired hub tangent-solver edge).
    expect(graph.nodes.length).toBe(509);
    expect(graph.edges.length).toBe(2478);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  }, 30_000);

  it('adds exactly the allow-listed TYPE edges incident to the two leaves', () => {
    const graph = cadF2fGraph();
    const prLeaf = path.resolve(PR_LEAF);
    const bcLeaf = path.resolve(BC_LEAF);
    expect(graph.edges.filter((edge) => edge.from === prLeaf).map((edge) => edge.specifier).sort()).toEqual([
      './cadGeometryCircleTangentSolvers',
      './cadPrimitiveGeometryEntityTypes',
    ]);
    expect(graph.edges.filter((edge) => edge.from === bcLeaf)).toEqual([]);
    expect(graph.edges.filter((edge) => edge.to === prLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: prLeaf,
        specifier: './cadTransactionsPrimitiveDrawCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter((edge) => edge.to === bcLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: bcLeaf,
        specifier: './cadTransactionsBasicCurveCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter(
      (edge) => (edge.from === prLeaf || edge.to === prLeaf || edge.from === bcLeaf || edge.to === bcLeaf)
        && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('retires the hub tangent-solver edge and keeps the ./cadTypes barrel edge', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    // The hub still imports identities and project types from the barrel.
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadTypes.ts')),
    ).length).toBeGreaterThan(0);
    // The tangency source alias now arrives via the primitive-draw leaf; the
    // hub never imports the solver or the polyline-geometry module directly.
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadGeometryCircleTangentSolvers.ts')),
    )).toEqual([]);
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadPrimitiveGeometryEntityTypes.ts')),
    )).toEqual([]);
  });

  it('has no leaf back-edge to the transaction hub or command executors', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    for (const leaf of [path.resolve(PR_LEAF), path.resolve(BC_LEAF)]) {
      for (const target of [
        hub,
        path.resolve(path.join(CAD_DIR, 'cadTransactions.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsCurveCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsBestFitCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsLineBatchCommand.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsPolylineCommand.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsTraverseCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsBatchCogoCommand.ts')),
      ]) {
        expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
      }
      expect(graph.edges.filter((edge) => edge.from === leaf && edge.kind !== 'type')).toEqual([]);
    }
  });
});

describe('STRUCT-241.14 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // Post-241.13 baseline 1679 / 7586; the two leaves add the same +2 / +3
    // (every 241.14 edge resolves inside `src`).
    expect(graph.nodes.length).toBe(1681);
    expect(graph.edges.length).toBe(7589);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4444,
      uniqPairs: 4385,
      sha: '415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448',
    });
  }, 120_000);
});

describe('STRUCT-241.14 negative controls (in-memory mutations only)', () => {
  const prSource = (): string => fs.readFileSync(PR_LEAF, 'utf8');
  const bcSource = (): string => fs.readFileSync(BC_LEAF, 'utf8');
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('fails the shape pin when POINT x becomes optional', () => {
    const mutated = prSource().replace(
      "      key: 'POINT';\n      x: number;\n      y: number;",
      "      key: 'POINT';\n      x?: number;\n      y: number;",
    );
    expect(mutated).not.toBe(prSource());
    const point = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'POINT')!;
    expect(() => expect(point.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.POINT!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when COGO_POINT directionLabel is dropped', () => {
    const mutated = prSource().replace(
      '      basisLabel: string;\n      directionLabel: string;',
      '      basisLabel: string;',
    );
    expect(mutated).not.toBe(prSource());
    const cogo = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'COGO_POINT')!;
    expect(() => expect(cogo.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.COGO_POINT!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when the LINE end label is dropped', () => {
    const mutated = prSource().replace(
      "      key: 'LINE';\n      start: { x: number; y: number; label: string };\n      end: { x: number; y: number; label: string };",
      "      key: 'LINE';\n      start: { x: number; y: number; label: string };\n      end: { x: number; y: number };",
    );
    expect(mutated).not.toBe(prSource());
    const line = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'LINE')!;
    expect(() => expect(line.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.LINE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when LINE_CREATE_BATCH createdBy becomes optional', () => {
    const mutated = prSource().replace(
      '      /** User-facing creation mode recorded as metadata.createdBy. */\n      createdBy: string;',
      '      /** User-facing creation mode recorded as metadata.createdBy. */\n      createdBy?: string;',
    );
    expect(mutated).not.toBe(prSource());
    const batch = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'LINE_CREATE_BATCH')!;
    expect(() => expect(batch.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.LINE_CREATE_BATCH!.map(pinShape)))
      .toThrow();
  });

  it('fails the JSDoc pin when the LINE_CREATE_BATCH block is dropped', () => {
    const mutated = prSource().replace(
      '      /** User-facing creation mode recorded as metadata.createdBy. */\n      createdBy: string;',
      '      createdBy: string;',
    );
    expect(mutated).not.toBe(prSource());
    const batch = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'LINE_CREATE_BATCH')!;
    expect(() => expect(batch.comments).toEqual(EXPECTED_LINE_CREATE_BATCH_COMMENTS)).toThrow();
  });

  it('fails the shape pin when the POLYGON mode literal widens to string', () => {
    const mutated = prSource().replace(
      "      mode: 'inscribed' | 'circumscribed';",
      '      mode: string;',
    );
    expect(mutated).not.toBe(prSource());
    const polygon = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'POLYGON')!;
    expect(() => expect(polygon.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.POLYGON!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when CIRCLECD diameter is renamed to radius', () => {
    const mutated = prSource().replace(
      "      key: 'CIRCLECD';\n      center: { x: number; y: number; label: string };\n      diameter: number;",
      "      key: 'CIRCLECD';\n      center: { x: number; y: number; label: string };\n      radius: number;",
    );
    expect(mutated).not.toBe(prSource());
    const circlecd = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'CIRCLECD')!;
    expect(() => expect(circlecd.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.CIRCLECD!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when CIRCLETTR second weakens off CadTangentSource', () => {
    const mutated = prSource().replace(
      "      key: 'CIRCLETTR';\n      first: CadTangentSource;\n      second: CadTangentSource;",
      "      key: 'CIRCLETTR';\n      first: CadTangentSource;\n      second: unknown;",
    );
    expect(mutated).not.toBe(prSource());
    const ttr = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'CIRCLETTR')!;
    expect(() => expect(ttr.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.CIRCLETTR!.map(pinShape)))
      .toThrow();
  });

  it('fails the pick-count pin when CIRCLETTT third is dropped', () => {
    const mutated = prSource().replace(
      "      key: 'CIRCLETTT';\n      first: CadTangentSource;\n      second: CadTangentSource;\n      third: CadTangentSource;",
      "      key: 'CIRCLETTT';\n      first: CadTangentSource;\n      second: CadTangentSource;",
    );
    expect(mutated).not.toBe(prSource());
    const ttt = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'CIRCLETTT')!;
    expect(() => expect(ttt.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.CIRCLETTT!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when PLINE closed becomes required', () => {
    const mutated = prSource().replace(
      '      closed?: boolean;',
      '      closed: boolean;',
    );
    expect(mutated).not.toBe(prSource());
    const pline = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'PLINE')!;
    expect(() => expect(pline.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.PLINE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when PLINE segmentGeometry is dropped', () => {
    const mutated = prSource().replace(
      '      segmentGeometry?: CadPolylineSegmentGeometry[];\n      /** Phase C2 optional per-course full centred band widths (metres);',
      '      /** Phase C2 optional per-course full centred band widths (metres);',
    );
    expect(mutated).not.toBe(prSource());
    const pline = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'PLINE')!;
    expect(() => expect(pline.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.PLINE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when PLINE segmentWidths weakens off its element type', () => {
    const mutated = prSource().replace(
      '      segmentWidths?: CadPolylineSegmentWidth[];',
      '      segmentWidths?: unknown[];',
    );
    expect(mutated).not.toBe(prSource());
    const pline = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'PLINE')!;
    expect(() => expect(pline.props).toEqual(EXPECTED_PRIMITIVE_SHAPES.PLINE!.map(pinShape)))
      .toThrow();
  });

  it('fails the JSDoc pin when a PLINE block is dropped', () => {
    const mutated = prSource().replace(
      '      /** Phase C2 optional per-course bulge metadata; absent = all-line.\n       *  Trailing optional (no version bump). */\n      segmentGeometry?: CadPolylineSegmentGeometry[];',
      '      segmentGeometry?: CadPolylineSegmentGeometry[];',
    );
    expect(mutated).not.toBe(prSource());
    const pline = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS)
      .find((v) => v.key === 'PLINE')!;
    expect(() => expect(pline.comments).toEqual(EXPECTED_PLINE_COMMENTS)).toThrow();
  });

  it('fails the shape pin when ARC_CREATE center is dropped from the definition', () => {
    const mutated = bcSource().replace(
      '      definition: {\n        center: { x: number; y: number };',
      '      definition: {',
    );
    expect(mutated).not.toBe(bcSource());
    const arc = variantShapesFromSource(parseText('m.ts', mutated), 'm', BC_ALIAS)
      .find((v) => v.key === 'ARC_CREATE')!;
    expect(() => expect(arc.props).toEqual(EXPECTED_BASICCURVE_SHAPES.ARC_CREATE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when ARC_CREATE radius widens inside the definition', () => {
    const mutated = bcSource().replace(
      '        radius: number;\n        startAngleDeg: number;',
      '        radius: string;\n        startAngleDeg: number;',
    );
    expect(mutated).not.toBe(bcSource());
    const arc = variantShapesFromSource(parseText('m.ts', mutated), 'm', BC_ALIAS)
      .find((v) => v.key === 'ARC_CREATE')!;
    expect(() => expect(arc.props).toEqual(EXPECTED_BASICCURVE_SHAPES.ARC_CREATE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when BEST_FIT_LINE sourceEntityId becomes required', () => {
    const mutated = bcSource().replace(
      "      key: 'BEST_FIT_LINE';\n      samples: { x: number; y: number; label: string; sourceEntityId?: string }[];",
      "      key: 'BEST_FIT_LINE';\n      samples: { x: number; y: number; label: string; sourceEntityId: string }[];",
    );
    expect(mutated).not.toBe(bcSource());
    const fit = variantShapesFromSource(parseText('m.ts', mutated), 'm', BC_ALIAS)
      .find((v) => v.key === 'BEST_FIT_LINE')!;
    expect(() => expect(fit.props).toEqual(EXPECTED_BASICCURVE_SHAPES.BEST_FIT_LINE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when TANGENT_CURVE radius becomes optional', () => {
    const mutated = bcSource().replace(
      '      aheadTangentPoint: { x: number; y: number; label: string };\n      radius: number;',
      '      aheadTangentPoint: { x: number; y: number; label: string };\n      radius?: number;',
    );
    expect(mutated).not.toBe(bcSource());
    const curve = variantShapesFromSource(parseText('m.ts', mutated), 'm', BC_ALIAS)
      .find((v) => v.key === 'TANGENT_CURVE')!;
    expect(() => expect(curve.props).toEqual(EXPECTED_BASICCURVE_SHAPES.TANGENT_CURVE!.map(pinShape)))
      .toThrow();
  });

  it('fails the splice guard when the hub drops the primitive splice', () => {
    const source = hubSource();
    const refLine = `  | ${PR_ALIAS}\n`;
    expect(source).toContain(refLine);
    const mutated = source.replace(refLine, '');
    expect(mutated).not.toBe(source);
    const counts = hubTopLevelCounts(parseText('mutated-hub.ts', mutated));
    expect(() => expect(counts).toEqual({ total: 72, inline: 32, refs: 33, intersections: 7 })).toThrow();
    const flat = hubFlattenedKeys(parseText('mutated-hub.ts', mutated));
    expect(() => expect(flat.length).toBe(168)).toThrow();
  });

  it('fails the splice guard when the hub drops the basic-curve splice', () => {
    const source = hubSource();
    const refLine = `  | ${BC_ALIAS}\n`;
    expect(source).toContain(refLine);
    const mutated = source.replace(refLine, '');
    expect(mutated).not.toBe(source);
    const counts = hubTopLevelCounts(parseText('mutated-hub.ts', mutated));
    expect(() => expect(counts).toEqual({ total: 72, inline: 32, refs: 33, intersections: 7 })).toThrow();
    const flat = hubFlattenedKeys(parseText('mutated-hub.ts', mutated));
    expect(() => expect(flat.length).toBe(168)).toThrow();
  });

  it('fails the ordering guard when the two hub splices are reversed', () => {
    const source = hubSource();
    const mutated = source
      .replace(`  | ${PR_ALIAS}\n`, '__SWAP_PR__\n')
      .replace(`  | ${BC_ALIAS}\n`, `  | ${PR_ALIAS}\n`)
      .replace('__SWAP_PR__\n', `  | ${BC_ALIAS}\n`);
    expect(mutated).not.toBe(source);
    const seq = hubMemberSequence(parseText('mutated-hub.ts', mutated));
    const erase = seq.findIndex((m) => m.kind === 'inline' && m.label === 'ERASE');
    expect(() => expect(seq[erase + 1]).toEqual({ kind: 'ref', label: PR_ALIAS })).toThrow();
  });

  it('fails the ordering guard when primitive variants reorder', () => {
    const source = prSource();
    const shapes = variantShapesFromSource(parseText('leaf.ts', source), 'leaf', PR_ALIAS);
    const circle = shapes.find((v) => v.key === 'CIRCLE')!.text;
    const circlecd = shapes.find((v) => v.key === 'CIRCLECD')!.text;
    const mutated = source.replace(circle, '__SWAP__').replace(circlecd, circle).replace('__SWAP__', circlecd);
    expect(mutated).not.toBe(source);
    const swapped = variantShapesFromSource(parseText('m.ts', mutated), 'm', PR_ALIAS);
    expect(swapped.map((v) => v.key)).toHaveLength(13);
    expect(() => expect(swapped.map((v) => v.key)).toEqual([...EXPECTED_PRIMITIVE_DESCRIPTORS])).toThrow();
  });

  it('fails the acyclicity guard on a synthetic TYPE back-edge to the hub', () => {
    const mutated = `${bcSource()}\nimport type { CadCommand } from './cadTransactions.types';\ntype BackEdge = CadCommand;\n`;
    expect(mutated).not.toBe(bcSource());
    // Extract the specifier list from the MUTATED text (not the pristine
    // file): the back-edge must be visible to the same helper the allowlist
    // pin uses, and the allowlist pin must reject it.
    const mutatedSpecs = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(allImportSpecifiers(BC_LEAF)).not.toContain('./cadTransactions.types');
    expect(mutatedSpecs).toContain('./cadTransactions.types');
    expect(() => expect(mutatedSpecs).toEqual(allImportSpecifiers(BC_LEAF))).toThrow();
  });

  it('fails the type-only guard on a synthetic VALUE import in the tangent link', () => {
    const mutated = prSource().replace(
      "import type { CadTangentSource } from './cadGeometryCircleTangentSolvers';",
      "import { CadTangentSource } from './cadGeometryCircleTangentSolvers';",
    );
    expect(mutated).not.toBe(prSource());
    const runtime = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt))
      .filter((stmt) => stmt.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword)
      .map((stmt) => stmt.moduleSpecifier.getText());
    expect(runtime).toContain("'./cadGeometryCircleTangentSolvers'");
    expect(() => expect(runtime).toEqual([])).toThrow();
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(PR_LEAF, 'utf8')).toBe(prSource());
    expect(fs.readFileSync(BC_LEAF, 'utf8')).toBe(bcSource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
    // Static proof: every mutation above goes through in-memory parseText;
    // this file performs no filesystem writes (patterns split so this
    // assertion cannot match its own source text).
    const selfText = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    for (const probe of ['write' + 'FileSync', 'append' + 'FileSync', 'fs.' + 'openSync']) {
      expect(selfText.includes(probe), `self write call ${probe}`).toBe(false);
    }
  });
}, 30_000);
