/**
 * STRUCT-241.15 — CAD planar-transform + geometry-edit command payload type leaves.
 *
 * Pins `src/engine/cad/cadTransactionsPlanarTransformCommandTypes.ts`, which
 * extracts the six planar 2D transform command payloads out of the
 * `CadCommand` union as one public union, and
 * `src/engine/cad/cadTransactionsGeometryEditCommandTypes.ts`, which extracts
 * the seven geometry-edit command payloads as one public union, so the hub
 * splices both back into their original contiguous positions:
 *  - `CadPlanarTransformCommandPayload` (6): MOVE, COPY, ROTATE, SCALE,
 *    MIRROR, ALIGN2D — between SURVEYTABLE_EDIT and HELMERT2D.
 *  - `CadGeometryEditCommandPayload` (7): EXTEND, FILLET, PASTE, TRIM,
 *    INTERSECT_POINT, EDIT_ENTITY, GRIP_EDIT — between PROJECTTRANSFORM and
 *    SHEET_ADD.
 *
 * Covers: hand-transcribed pre-refactor `Base*` shapes + AST property pins
 * (key literals, property order, optionality, the ordered nested 10-branch
 * EDIT_ENTITY `edit` discriminant, point-z nullability, MIRROR/ALIGN2D point
 * shapes, FILLET/TRIM/EXTEND segment optionality, INTERSECT_POINT labels);
 * per-key `Extract<CadCommand>` equivalence in both directions (all 13
 * members are single-keyed, so plain single-literal selectors apply — no
 * double-key documentation needed); the byte-identical `CadCommandKey`
 * (248 literals / 241 unique / 7 legacy duplicate BLOCK keys kept, plus the
 * ordered-list digest); both splice sentinels (SURVEYTABLE_EDIT before,
 * HELMERT2D after, PROJECTTRANSFORM before, SHEET_ADD after) + 61 top-level
 * + 168 flattened effective members; the untouched inline coordinate-system
 * commands (HELMERT2D, GRIDGROUND, PROJECTTRANSFORM) + GridGroundDirection;
 * public transaction types; type-only emit pins; CAD+F2F and full-`src`
 * graph pins with an explicit +2 node / +5 type-edge allowlist (2 hub
 * imports + 3 geometry-edit out-edges + 0 planar out-edges − 0 retired
 * edges; the hub keeps its `./cadTypes` barrel edge); in-memory negative
 * controls; and transform / geometry-edit regression neighbours by import
 * existence only.
 *
 * Neither run carried a Phase section header or member JSDoc in the hub, and
 * none is invented in either leaf — pinned below.
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
import type { CadEntityAppearance } from '../src/engine/cad/cadEntityFoundationTypes';
import type { CadGripHandleKind } from '../src/engine/cad/cadGripSnapTypes';
import type { CadPlanarTransformCommandPayload } from '../src/engine/cad/cadTransactionsPlanarTransformCommandTypes';
import type { CadGeometryEditCommandPayload } from '../src/engine/cad/cadTransactionsGeometryEditCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const PT_LEAF = path.join(CAD_DIR, 'cadTransactionsPlanarTransformCommandTypes.ts');
const GE_LEAF = path.join(CAD_DIR, 'cadTransactionsGeometryEditCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');
const PT_ALIAS = 'CadPlanarTransformCommandPayload';
const GE_ALIAS = 'CadGeometryEditCommandPayload';
// STRUCT-241.16 roll-forward: the two new leaf paths/aliases.
const SV_LEAF24116 = path.join(CAD_DIR, 'cadTransactionsSheetViewportCommandTypes.ts');
const PL_LEAF24116 = path.join(CAD_DIR, 'cadTransactionsPolylineTopologyCommandTypes.ts');
const SV_ALIAS24116 = 'CadSheetViewportCommandPayload';
const PL_ALIAS24116 = 'CadPolylineTopologyCommandPayload';

const abs = (relative: string): string => path.join(REPO_ROOT, relative);
const relPosix = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// TypeScript compiler helpers (same shape as the STRUCT-241.14 guard).
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

/** Ordered `kind` literals of the nested EDIT_ENTITY `edit` discriminant union. */
const editKindsInOrderFromSource = (
  source: ts.SourceFile,
  label: string,
  aliasName: string,
): string[] => {
  const alias = findAlias(source, label, aliasName);
  if (!ts.isUnionTypeNode(alias.type)) throw new Error(`${label}: ${aliasName} is not a union`);
  const editMember = alias.type.types
    .map(unwrap)
    .find((t): t is ts.TypeLiteralNode => ts.isTypeLiteralNode(t) && memberKeyDescriptor(t) === 'EDIT_ENTITY');
  if (!editMember) throw new Error(`${label}: EDIT_ENTITY member missing`);
  const editProp = editMember.members.find(
    (m): m is ts.PropertySignature => ts.isPropertySignature(m) && m.name.getText() === 'edit',
  );
  if (!editProp?.type) throw new Error(`${label}: EDIT_ENTITY edit prop missing`);
  const flat = unwrap(editProp.type);
  if (!ts.isUnionTypeNode(flat)) throw new Error(`${label}: EDIT_ENTITY edit is not a union`);
  return flat.types.map((branch) => {
    const literal = unwrap(branch);
    if (!ts.isTypeLiteralNode(literal)) throw new Error(`${label}: edit branch is not a literal`);
    const kind = literal.members.find(
      (m): m is ts.PropertySignature => ts.isPropertySignature(m) && m.name.getText() === 'kind',
    );
    const kindType = kind?.type;
    if (!kindType || !ts.isLiteralTypeNode(kindType) || !ts.isStringLiteral(kindType.literal)) {
      throw new Error(`${label}: edit branch without a kind literal`);
    }
    return kindType.literal.text;
  });
};

const editKindsInOrder = (file: string, label: string, aliasName: string): string[] =>
  editKindsInOrderFromSource(parse(file), label, aliasName);

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
  // STRUCT-241.15: expand both new aliases per-member (all single-keyed:
  // 6 + 7, no widening).
  const planar = leafMemberDescriptors(PT_LEAF, 'planar', PT_ALIAS);
  const geometryedit = leafMemberDescriptors(GE_LEAF, 'geometryedit', GE_ALIAS);
  // STRUCT-241.16 roll-forward: expand the sheet/viewport (6) +
  // polyline-topology (2) aliases per-member (all single-keyed, no widening).
  const sheetviewport = leafMemberDescriptors(SV_LEAF24116, 'sheet', SV_ALIAS24116);
  const polytopology = leafMemberDescriptors(PL_LEAF24116, 'polytopo', PL_ALIAS24116);
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
      else if (name === PT_ALIAS) members.push(...planar);
      else if (name === GE_ALIAS) members.push(...geometryedit);
      else if (name === SV_ALIAS24116) members.push(...sheetviewport);
      else if (name === PL_ALIAS24116) members.push(...polytopology);
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
// hub `CadCommand` block (the six planar-transform + seven geometry-edit
// inline members, in order). They import no leaf type, so leaf drift cannot
// move both sides of an assertion.
// ---------------------------------------------------------------------------

type PlainPoint = { x: number; y: number };

type BaseMove = {
  key: 'MOVE';
  deltaX: number;
  deltaY: number;
};

type BaseCopy = {
  key: 'COPY';
  deltaX: number;
  deltaY: number;
};

type BaseRotate = {
  key: 'ROTATE';
  baseX: number;
  baseY: number;
  angleDeg: number;
};

type BaseScale = {
  key: 'SCALE';
  baseX: number;
  baseY: number;
  factor: number;
};

type BaseMirror = {
  key: 'MIRROR';
  p1: PlainPoint;
  p2: PlainPoint;
  eraseSource: boolean;
};

type BaseAlign2D = {
  key: 'ALIGN2D';
  source1: PlainPoint;
  source2: PlainPoint;
  target1: PlainPoint;
  target2: PlainPoint;
  scaleToFit: boolean;
};

type BaseExtend = {
  key: 'EXTEND';
  boundaryEntityIds: CadEntityId[];
  targetEntityId: CadEntityId;
  targetPickPoint: PlainPoint;
  targetSegmentId?: string;
};

type BaseFillet = {
  key: 'FILLET';
  radius: number;
  firstEntityId: CadEntityId;
  firstPickPoint: PlainPoint;
  firstSegmentId?: string;
  secondEntityId: CadEntityId;
  secondPickPoint: PlainPoint;
  secondSegmentId?: string;
};

type BasePaste = {
  key: 'PASTE';
  deltaX: number;
  deltaY: number;
  entityIds: CadEntityId[];
};

type BaseTrim = {
  key: 'TRIM';
  cuttingEntityIds: CadEntityId[];
  targetEntityId: CadEntityId;
  pickPoint: PlainPoint;
  targetSegmentId?: string;
};

type BaseIntersectPoint = {
  key: 'INTERSECT_POINT';
  x: number;
  y: number;
  label?: string;
  firstLabel: string;
  secondLabel: string;
};

type BaseEntityEdit =
  | { kind: 'entity-name'; value: string }
  | { kind: 'point-x'; value: number }
  | { kind: 'point-y'; value: number }
  | { kind: 'point-z'; value: number | null }
  | { kind: 'line-end'; toX: number; toY: number }
  | { kind: 'arc-radius'; value: number }
  | { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number }
  | { kind: 'polyline-vertices'; vertices: Array<{ vertexIndex: number; x: number; y: number }> }
  | { kind: 'entity-layer'; layerId: CadLayerId }
  | { kind: 'entity-appearance'; patch: CadEntityAppearance };

type BaseEditEntity = {
  key: 'EDIT_ENTITY';
  entityId: CadEntityId;
  edit: BaseEntityEdit;
};

type BaseGripEdit = {
  key: 'GRIP_EDIT';
  entityId: CadEntityId;
  gripKind: CadGripHandleKind;
  x: number;
  y: number;
  vertexIndex?: number;
};

/** One descriptor per leaf member, in declaration order (all single-keyed). */
const EXPECTED_PLANAR_DESCRIPTORS = [
  'MOVE',
  'COPY',
  'ROTATE',
  'SCALE',
  'MIRROR',
  'ALIGN2D',
] as const;

const EXPECTED_GEOMETRYEDIT_DESCRIPTORS = [
  'EXTEND',
  'FILLET',
  'PASTE',
  'TRIM',
  'INTERSECT_POINT',
  'EDIT_ENTITY',
  'GRIP_EDIT',
] as const;

/** Every moved literal. */
const EXPECTED_MOVED_LITERALS = [
  ...EXPECTED_PLANAR_DESCRIPTORS,
  ...EXPECTED_GEOMETRYEDIT_DESCRIPTORS,
] as const;

const PLAIN_POINT_SHAPE = '{ x: number; y: number }';

const EXPECTED_PLANAR_SHAPES: Record<string, string[]> = {
  MOVE: [
    "key: 'MOVE'",
    'deltaX: number',
    'deltaY: number',
  ],
  COPY: [
    "key: 'COPY'",
    'deltaX: number',
    'deltaY: number',
  ],
  ROTATE: [
    "key: 'ROTATE'",
    'baseX: number',
    'baseY: number',
    'angleDeg: number',
  ],
  SCALE: [
    "key: 'SCALE'",
    'baseX: number',
    'baseY: number',
    'factor: number',
  ],
  MIRROR: [
    "key: 'MIRROR'",
    `p1: ${PLAIN_POINT_SHAPE}`,
    `p2: ${PLAIN_POINT_SHAPE}`,
    'eraseSource: boolean',
  ],
  ALIGN2D: [
    "key: 'ALIGN2D'",
    `source1: ${PLAIN_POINT_SHAPE}`,
    `source2: ${PLAIN_POINT_SHAPE}`,
    `target1: ${PLAIN_POINT_SHAPE}`,
    `target2: ${PLAIN_POINT_SHAPE}`,
    'scaleToFit: boolean',
  ],
};

const EXPECTED_GEOMETRYEDIT_SHAPES: Record<string, string[]> = {
  EXTEND: [
    "key: 'EXTEND'",
    'boundaryEntityIds: CadEntityId[]',
    'targetEntityId: CadEntityId',
    `targetPickPoint: ${PLAIN_POINT_SHAPE}`,
    'targetSegmentId?: string',
  ],
  FILLET: [
    "key: 'FILLET'",
    'radius: number',
    'firstEntityId: CadEntityId',
    `firstPickPoint: ${PLAIN_POINT_SHAPE}`,
    'firstSegmentId?: string',
    'secondEntityId: CadEntityId',
    `secondPickPoint: ${PLAIN_POINT_SHAPE}`,
    'secondSegmentId?: string',
  ],
  PASTE: [
    "key: 'PASTE'",
    'deltaX: number',
    'deltaY: number',
    'entityIds: CadEntityId[]',
  ],
  TRIM: [
    "key: 'TRIM'",
    'cuttingEntityIds: CadEntityId[]',
    'targetEntityId: CadEntityId',
    `pickPoint: ${PLAIN_POINT_SHAPE}`,
    'targetSegmentId?: string',
  ],
  INTERSECT_POINT: [
    "key: 'INTERSECT_POINT'",
    'x: number',
    'y: number',
    'label?: string',
    'firstLabel: string',
    'secondLabel: string',
  ],
  EDIT_ENTITY: [
    "key: 'EDIT_ENTITY'",
    'entityId: CadEntityId',
    "edit: { kind: 'entity-name'; value: string } | { kind: 'point-x'; value: number } "
      + "| { kind: 'point-y'; value: number } | { kind: 'point-z'; value: number | null } "
      + "| { kind: 'line-end'; toX: number; toY: number } | { kind: 'arc-radius'; value: number } "
      + "| { kind: 'polyline-vertex'; vertexIndex: number; x: number; y: number } "
      + "| { kind: 'polyline-vertices'; vertices: Array<{ vertexIndex: number; x: number; y: number }> } "
      + "| { kind: 'entity-layer'; layerId: CadLayerId } "
      + "| { kind: 'entity-appearance'; patch: CadEntityAppearance }",
  ],
  GRIP_EDIT: [
    "key: 'GRIP_EDIT'",
    'entityId: CadEntityId',
    'gripKind: CadGripHandleKind',
    'x: number',
    'y: number',
    'vertexIndex?: number',
  ],
};

/** Ordered nested EDIT_ENTITY `edit` kind literals, transcribed from the hub. */
const EXPECTED_EDIT_KINDS = [
  'entity-name',
  'point-x',
  'point-y',
  'point-z',
  'line-end',
  'arc-radius',
  'polyline-vertex',
  'polyline-vertices',
  'entity-layer',
  'entity-appearance',
] as const;

/** Untouched inline coordinate-system members, transcribed from the hub. */
const EXPECTED_HELMERT2D_SHAPE = [
  "key: 'HELMERT2D'",
  'pairs: HelmertControlPair[]',
  'mode: HelmertMode',
];

const EXPECTED_GRIDGROUND_SHAPE = [
  "key: 'GRIDGROUND'",
  'originE: number',
  'originN: number',
  'combinedScaleFactor: number',
  'direction: GridGroundDirection',
];

const EXPECTED_PROJECTTRANSFORM_SHAPE = [
  "key: 'PROJECTTRANSFORM'",
  'request: ProjectTransformRequest',
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
const leafToHub = (payload: CadPlanarTransformCommandPayload | CadGeometryEditCommandPayload): CadCommand => payload;

describe('STRUCT-241.15 leaf presence and key order', () => {
  it('both command type leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(PT_LEAF), `leaf missing: ${relPosix(PT_LEAF)}`).toBe(true);
    expect(fs.existsSync(GE_LEAF), `leaf missing: ${relPosix(GE_LEAF)}`).toBe(true);
  });

  it('pins the 6 planar-transform keys in order with no duplicates', () => {
    expect(leafMemberDescriptors(PT_LEAF, 'planar', PT_ALIAS)).toEqual([...EXPECTED_PLANAR_DESCRIPTORS]);
    expect(unionKeysInOrder(PT_LEAF, 'planar', PT_ALIAS)).toEqual([...EXPECTED_PLANAR_DESCRIPTORS]);
  });

  it('pins the 7 geometry-edit keys in order with no duplicates', () => {
    expect(leafMemberDescriptors(GE_LEAF, 'geometryedit', GE_ALIAS)).toEqual([...EXPECTED_GEOMETRYEDIT_DESCRIPTORS]);
    expect(unionKeysInOrder(GE_LEAF, 'geometryedit', GE_ALIAS)).toEqual([...EXPECTED_GEOMETRYEDIT_DESCRIPTORS]);
  });

  it('pins the ordered 10-branch nested EDIT_ENTITY edit discriminant', () => {
    expect(editKindsInOrder(GE_LEAF, 'geometryedit', GE_ALIAS)).toEqual([...EXPECTED_EDIT_KINDS]);
  });

  it('invents no Phase section header in either leaf (the hub runs had none)', () => {
    for (const leaf of [PT_LEAF, GE_LEAF]) {
      expect(fs.readFileSync(leaf, 'utf8')).not.toContain('// Phase');
    }
    // The hub splice regions (SURVEYTABLE_EDIT through HELMERT2D, and
    // PROJECTTRANSFORM through the sheet/viewport alias) carry no line or
    // block comments.
    const hubText = fs.readFileSync(HUB, 'utf8');
    const surveyIdx = hubText.indexOf("key: 'SURVEYTABLE_EDIT'");
    // STRUCT-241.16 roll-forward: SHEET_ADD is no longer inline, so the
    // region now ends at the sheet/viewport alias splice.
    const sheetIdx = hubText.indexOf(`| ${SV_ALIAS24116}`);
    expect(surveyIdx).toBeGreaterThanOrEqual(0);
    expect(sheetIdx).toBeGreaterThan(surveyIdx);
    const region = hubText.slice(surveyIdx, sheetIdx);
    // Positive controls so the guard below cannot pass vacuously on an
    // empty/wrong region.
    expect(region).toContain('| CadPlanarTransformCommandPayload');
    expect(region).toContain('| CadGeometryEditCommandPayload');
    expect(region).toContain("key: 'HELMERT2D'");
    expect(region).toContain("key: 'GRIDGROUND'");
    expect(region).toContain("key: 'PROJECTTRANSFORM'");
    expect(region).not.toContain('//');
    expect(region).not.toContain('/*');
  });
});

describe('STRUCT-241.15 baseline shapes: Extract<CadCommand> vs leaf vs Base*', () => {
  it('keeps planar move/copy/rotate/scale identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'MOVE' }>>()
      .toEqualTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'MOVE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'MOVE' }>>().toEqualTypeOf<BaseMove>();
    expectTypeOf<Extract<CadCommand, { key: 'COPY' }>>()
      .toEqualTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'COPY' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'COPY' }>>().toEqualTypeOf<BaseCopy>();
    expectTypeOf<Extract<CadCommand, { key: 'ROTATE' }>>()
      .toEqualTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'ROTATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ROTATE' }>>().toEqualTypeOf<BaseRotate>();
    expectTypeOf<Extract<CadCommand, { key: 'SCALE' }>>()
      .toEqualTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'SCALE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'SCALE' }>>().toEqualTypeOf<BaseScale>();
  });

  it('keeps mirror/align identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'MIRROR' }>>()
      .toEqualTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'MIRROR' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'MIRROR' }>>().toEqualTypeOf<BaseMirror>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGN2D' }>>()
      .toEqualTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'ALIGN2D' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGN2D' }>>().toEqualTypeOf<BaseAlign2D>();
  });

  it('keeps extend/fillet/paste/trim identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'EXTEND' }>>()
      .toEqualTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'EXTEND' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'EXTEND' }>>().toEqualTypeOf<BaseExtend>();
    expectTypeOf<Extract<CadCommand, { key: 'FILLET' }>>()
      .toEqualTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'FILLET' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FILLET' }>>().toEqualTypeOf<BaseFillet>();
    expectTypeOf<Extract<CadCommand, { key: 'PASTE' }>>()
      .toEqualTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'PASTE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PASTE' }>>().toEqualTypeOf<BasePaste>();
    expectTypeOf<Extract<CadCommand, { key: 'TRIM' }>>()
      .toEqualTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'TRIM' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'TRIM' }>>().toEqualTypeOf<BaseTrim>();
  });

  it('keeps intersect/entity-edit/grip identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'INTERSECT_POINT' }>>()
      .toEqualTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'INTERSECT_POINT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'INTERSECT_POINT' }>>().toEqualTypeOf<BaseIntersectPoint>();
    expectTypeOf<Extract<CadCommand, { key: 'EDIT_ENTITY' }>>()
      .toEqualTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'EDIT_ENTITY' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'EDIT_ENTITY' }>>().toEqualTypeOf<BaseEditEntity>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'EDIT_ENTITY' }>['edit']>()
      .toEqualTypeOf<BaseEntityEdit>();
    expectTypeOf<Extract<CadCommand, { key: 'GRIP_EDIT' }>>()
      .toEqualTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'GRIP_EDIT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'GRIP_EDIT' }>>().toEqualTypeOf<BaseGripEdit>();
  });

  it('keeps both whole-leaf unions identical to their transcribed counterparts', () => {
    expectTypeOf<CadPlanarTransformCommandPayload>().toEqualTypeOf<
      | BaseMove | BaseCopy | BaseRotate | BaseScale | BaseMirror | BaseAlign2D
    >();
    expectTypeOf<CadGeometryEditCommandPayload>().toEqualTypeOf<
      | BaseExtend | BaseFillet | BasePaste | BaseTrim
      | BaseIntersectPoint | BaseEditEntity | BaseGripEdit
    >();
  });

  it('matches the transcribed AST property shapes and order', () => {
    const planar = variantShapes(PT_LEAF, 'planar', PT_ALIAS);
    const geometryedit = variantShapes(GE_LEAF, 'geometryedit', GE_ALIAS);
    expect(planar.map((v) => v.key)).toEqual([...EXPECTED_PLANAR_DESCRIPTORS]);
    expect(geometryedit.map((v) => v.key)).toEqual([...EXPECTED_GEOMETRYEDIT_DESCRIPTORS]);
    for (const variant of planar) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_PLANAR_SHAPES[variant.key]!.map(pinShape),
      );
    }
    for (const variant of geometryedit) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_GEOMETRYEDIT_SHAPES[variant.key]!.map(pinShape),
      );
    }
  });

  it('pins empty member JSDoc on all 13 variants (the hub run had none)', () => {
    for (const variant of variantShapes(PT_LEAF, 'planar', PT_ALIAS)) {
      expect(variant.comments, `${variant.key} comment drift`).toEqual([]);
    }
    for (const variant of variantShapes(GE_LEAF, 'geometryedit', GE_ALIAS)) {
      expect(variant.comments, `${variant.key} comment drift`).toEqual([]);
    }
  });

  it('keeps required fields required, optionals optional, and nested kinds exact', () => {
    expectTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'MOVE' }>['deltaX']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'COPY' }>['deltaY']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'ROTATE' }>['angleDeg']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'SCALE' }>['factor']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'MIRROR' }>['p1']>()
      .toEqualTypeOf<{ x: number; y: number }>();
    expectTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'MIRROR' }>['eraseSource']>()
      .toEqualTypeOf<boolean>();
    expectTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'ALIGN2D' }>['source1']>()
      .toEqualTypeOf<{ x: number; y: number }>();
    expectTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'ALIGN2D' }>['target2']>()
      .toEqualTypeOf<{ x: number; y: number }>();
    expectTypeOf<Extract<CadPlanarTransformCommandPayload, { key: 'ALIGN2D' }>['scaleToFit']>()
      .toEqualTypeOf<boolean>();
    expectTypeOf<keyof Extract<CadPlanarTransformCommandPayload, { key: 'MOVE' }>>()
      .toEqualTypeOf<'key' | 'deltaX' | 'deltaY'>();
    expectTypeOf<keyof Extract<CadPlanarTransformCommandPayload, { key: 'ALIGN2D' }>>()
      .toEqualTypeOf<'key' | 'source1' | 'source2' | 'target1' | 'target2' | 'scaleToFit'>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'EXTEND' }>['boundaryEntityIds']>()
      .toEqualTypeOf<CadEntityId[]>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'EXTEND' }>['targetSegmentId']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'FILLET' }>['radius']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'FILLET' }>['firstSegmentId']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'FILLET' }>['secondEntityId']>()
      .toEqualTypeOf<CadEntityId>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'PASTE' }>['entityIds']>()
      .toEqualTypeOf<CadEntityId[]>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'TRIM' }>['pickPoint']>()
      .toEqualTypeOf<{ x: number; y: number }>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'TRIM' }>['targetSegmentId']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'INTERSECT_POINT' }>['label']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'INTERSECT_POINT' }>['firstLabel']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'INTERSECT_POINT' }>['secondLabel']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<Extract<CadGeometryEditCommandPayload, { key: 'EDIT_ENTITY' }>['edit'], { kind: 'point-z' }>['value']>()
      .toEqualTypeOf<number | null>();
    expectTypeOf<Extract<Extract<CadGeometryEditCommandPayload, { key: 'EDIT_ENTITY' }>['edit'], { kind: 'entity-layer' }>['layerId']>()
      .toEqualTypeOf<CadLayerId>();
    expectTypeOf<Extract<Extract<CadGeometryEditCommandPayload, { key: 'EDIT_ENTITY' }>['edit'], { kind: 'entity-appearance' }>['patch']>()
      .toEqualTypeOf<CadEntityAppearance>();
    expectTypeOf<Extract<Extract<CadGeometryEditCommandPayload, { key: 'EDIT_ENTITY' }>['edit'], { kind: 'polyline-vertices' }>['vertices']>()
      .toEqualTypeOf<Array<{ vertexIndex: number; x: number; y: number }>>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'GRIP_EDIT' }>['gripKind']>()
      .toEqualTypeOf<CadGripHandleKind>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'GRIP_EDIT' }>['vertexIndex']>()
      .toEqualTypeOf<number | undefined>();
    expectTypeOf<keyof Extract<CadGeometryEditCommandPayload, { key: 'GRIP_EDIT' }>>()
      .toEqualTypeOf<'key' | 'entityId' | 'gripKind' | 'x' | 'y' | 'vertexIndex'>();
    expectTypeOf<Extract<CadGeometryEditCommandPayload, { key: 'NOPE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadCommand, { key: 'NOPE' }>>().toEqualTypeOf<never>();
  });

  it('compiles full-field samples through the hub round trip', () => {
    const planarSamples: CadPlanarTransformCommandPayload[] = [
      { key: 'MOVE', deltaX: 1, deltaY: 2 },
      { key: 'COPY', deltaX: 3, deltaY: 4 },
      { key: 'ROTATE', baseX: 0, baseY: 0, angleDeg: 45 },
      { key: 'SCALE', baseX: 0, baseY: 0, factor: 2 },
      { key: 'MIRROR', p1: { x: 0, y: 0 }, p2: { x: 10, y: 0 }, eraseSource: false },
      {
        key: 'ALIGN2D',
        source1: { x: 0, y: 0 }, source2: { x: 1, y: 0 },
        target1: { x: 10, y: 10 }, target2: { x: 11, y: 10 }, scaleToFit: true,
      },
    ];
    const geometrySamples: CadGeometryEditCommandPayload[] = [
      {
        key: 'EXTEND', boundaryEntityIds: ['b-1'], targetEntityId: 't-1',
        targetPickPoint: { x: 1, y: 2 }, targetSegmentId: 's-1',
      },
      {
        key: 'FILLET', radius: 5, firstEntityId: 'e-1', firstPickPoint: { x: 0, y: 0 },
        firstSegmentId: 's-1', secondEntityId: 'e-2', secondPickPoint: { x: 1, y: 1 },
        secondSegmentId: 's-2',
      },
      { key: 'PASTE', deltaX: 1, deltaY: 2, entityIds: ['e-1', 'e-2'] },
      {
        key: 'TRIM', cuttingEntityIds: ['c-1'], targetEntityId: 't-1',
        pickPoint: { x: 3, y: 4 },
      },
      { key: 'INTERSECT_POINT', x: 0, y: 0, firstLabel: 'A', secondLabel: 'B' },
      { key: 'EDIT_ENTITY', entityId: 'e-1', edit: { kind: 'point-z', value: null } },
      { key: 'GRIP_EDIT', entityId: 'e-1', gripKind: 'vertex', x: 5, y: 6 },
    ];
    for (const sample of [...planarSamples, ...geometrySamples]) {
      expect(leafToHub(sample)).toBe(sample);
    }
    expect(Object.keys(planarSamples[5]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_PLANAR_SHAPES.ALIGN2D!)].sort(),
    );
    expect(Object.keys(geometrySamples[1]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_GEOMETRYEDIT_SHAPES.FILLET!)].sort(),
    );
  });
});

describe('STRUCT-241.15 hub union splice order and member counts', () => {
  it('measures 55 top-level members and documents the 61 -> 55 extraction', () => {
    const counts = hubTopLevelCounts();
    // STRUCT-241.16 roll-forward: 8 sheet/viewport + polyline-topology inline
    // members replaced by 2 alias references (11 inline, 37 refs, 7 intersections).
    expect(counts).toEqual({ total: 55, inline: 11, refs: 37, intersections: 7 });
    // Re-inlining the two 241.16 leaves restores the 241.15 shape
    // 61 = 55 + 6 + 2 - 2 (11 inline + 37 refs + 7 intersections at the
    // 241.16 pin; the 61 shape held 19 inline + 35 refs + 7).
    expect(leafMemberDescriptors(SV_LEAF24116, 'sheet', SV_ALIAS24116).length).toBe(6);
    expect(leafMemberDescriptors(PL_LEAF24116, 'polytopo', PL_ALIAS24116).length).toBe(2);
    expect(counts.total + 6 + 2 - 2).toBe(61);
    // Re-inlining the two 241.15 leaves on top restores the 241.14 shape
    // 72 = 61 + 6 + 7 - 2 (from the 241.16 pin: 72 = 55 + 6 + 2 + 6 + 7 - 4).
    expect(leafMemberDescriptors(PT_LEAF, 'planar', PT_ALIAS).length).toBe(6);
    expect(leafMemberDescriptors(GE_LEAF, 'geometryedit', GE_ALIAS).length).toBe(7);
    expect(counts.total + 6 + 2 + 6 + 7 - 4).toBe(72);
  });

  it('splices the planar group between SURVEYTABLE_EDIT and HELMERT2D', () => {
    const seq = hubMemberSequence();
    const survey = seq.findIndex((m) => m.kind === 'inline' && m.label === 'SURVEYTABLE_EDIT');
    expect(seq[survey]).toEqual({ kind: 'inline', label: 'SURVEYTABLE_EDIT' });
    expect(seq[survey + 1]).toEqual({ kind: 'ref', label: PT_ALIAS });
    expect(seq[survey + 2]).toEqual({ kind: 'inline', label: 'HELMERT2D' });
  });

  it('splices the geometry-edit group between PROJECTTRANSFORM and the sheet/viewport alias', () => {
    const seq = hubMemberSequence();
    const project = seq.findIndex((m) => m.kind === 'inline' && m.label === 'PROJECTTRANSFORM');
    expect(seq[project]).toEqual({ kind: 'inline', label: 'PROJECTTRANSFORM' });
    expect(seq[project + 1]).toEqual({ kind: 'ref', label: GE_ALIAS });
    // STRUCT-241.16 roll-forward: SHEET_ADD now arrives via the
    // sheet/viewport alias reference.
    expect(seq[project + 2]).toEqual({ kind: 'ref', label: SV_ALIAS24116 });
  });

  it('flattens to the exact 168 effective members in the original sequence', () => {
    const flat = hubFlattenedKeys();
    expect(flat.length).toBe(168);
    // SURVEYTABLE_EDIT anchors the planar run at flattened index 53.
    expect(flat[53]).toBe('SURVEYTABLE_EDIT');
    expect(flat.slice(54, 60)).toEqual([...EXPECTED_PLANAR_DESCRIPTORS]);
    // HELMERT2D/GRIDGROUND/PROJECTTRANSFORM stay inline at 60/61/62.
    expect(flat.slice(60, 63)).toEqual(['HELMERT2D', 'GRIDGROUND', 'PROJECTTRANSFORM']);
    expect(flat.slice(63, 70)).toEqual([...EXPECTED_GEOMETRYEDIT_DESCRIPTORS]);
    expect(flat[70]).toBe('SHEET_ADD');
    // Older anchors unchanged: ERASE at 2, TRAVERSE/BATCH_COGO at 16/17.
    expect(flat[2]).toBe('ERASE');
    expect(flat[16]).toBe('TRAVERSE');
    expect(flat[17]).toBe('BATCH_COGO');
  });

  it('leaves no inline planar/geometry-edit key behind in the hub union', () => {
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
    for (const probe of ["key: 'MIRROR'", "key: 'ALIGN2D'", "key: 'FILLET'", "key: 'EDIT_ENTITY'", "key: 'GRIP_EDIT'", "key: 'INTERSECT_POINT'"]) {
      expect(hubText, `hub still carries ${probe}`).not.toContain(probe);
    }
    for (const probe of ['eraseSource', 'scaleToFit', 'targetSegmentId', 'gripKind', 'firstLabel']) {
      expect(hubText.split(probe).length - 1, `hub still carries ${probe}`).toBe(0);
    }
  });

  it('keeps the coordinate-system commands inline with exact shapes', () => {
    const hub = parse(HUB);
    const shapes = variantShapesFromSource(hub, 'hub', 'CadCommand').filter(
      (v) => v.key === 'HELMERT2D' || v.key === 'GRIDGROUND' || v.key === 'PROJECTTRANSFORM',
    );
    expect(shapes.map((v) => v.key)).toEqual(['HELMERT2D', 'GRIDGROUND', 'PROJECTTRANSFORM']);
    expect(shapes[0]!.props).toEqual(EXPECTED_HELMERT2D_SHAPE.map(pinShape));
    expect(shapes[1]!.props).toEqual(EXPECTED_GRIDGROUND_SHAPE.map(pinShape));
    expect(shapes[2]!.props).toEqual(EXPECTED_PROJECTTRANSFORM_SHAPE.map(pinShape));
    const hubText = fs.readFileSync(HUB, 'utf8');
    expect(hubText).toContain("export type GridGroundDirection = 'GRID_TO_GROUND' | 'GROUND_TO_GRID';");
    // TRAVERSE/BATCH_COGO stay inline too; the sheet/viewport run now
    // arrives via its alias (STRUCT-241.16 roll-forward).
    const seq = hubMemberSequence(hub);
    for (const label of ['TRAVERSE', 'BATCH_COGO', 'SURVEYTABLE_EDIT']) {
      expect(seq.some((m) => m.kind === 'inline' && m.label === label), `${label} inline`).toBe(true);
    }
    expect(seq.some((m) => m.kind === 'ref' && m.label === SV_ALIAS24116), 'sheet alias').toBe(true);
  });

  it('retires only the proven-unused cadTypes specifiers from the hub', () => {
    const hubText = fs.readFileSync(HUB, 'utf8');
    expect(hubText.split('CadEntityAppearance').length - 1).toBe(0);
    expect(hubText.split('CadGripHandleKind').length - 1).toBe(0);
    // The hub still references the shared identity aliases elsewhere.
    expect(hubText).toContain('CadEntityId');
    expect(hubText).toContain('CadLayerId');
    expect(hubText).toContain("from './cadTypes'");
  });
});

describe('STRUCT-241.15 CadCommandKey unchanged', () => {
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

  it('keeps the planar/geometry-edit key runs in their original positions', () => {
    const keys = hubKeyOrder();
    expect(keys[keys.indexOf('SURVEYTABLE_EDIT') + 1]).toBe('MOVE');
    expect(keys.slice(keys.indexOf('MOVE'), keys.indexOf('MOVE') + 6)).toEqual(
      [...EXPECTED_PLANAR_DESCRIPTORS],
    );
    expect(keys[keys.indexOf('ALIGN2D') + 1]).toBe('HELMERT2D');
    expect(keys.slice(keys.indexOf('HELMERT2D'), keys.indexOf('HELMERT2D') + 3)).toEqual(
      ['HELMERT2D', 'GRIDGROUND', 'PROJECTTRANSFORM'],
    );
    expect(keys[keys.indexOf('PROJECTTRANSFORM') + 1]).toBe('EXTEND');
    expect(keys.slice(keys.indexOf('EXTEND'), keys.indexOf('EXTEND') + 7)).toEqual(
      [...EXPECTED_GEOMETRYEDIT_DESCRIPTORS],
    );
    expect(keys[keys.indexOf('GRIP_EDIT') + 1]).toBe('SHEET_ADD');
  });
});

describe('STRUCT-241.15 public transaction types unchanged', () => {
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
    const definitionProbe: CadCommandDefinition<CadCommand> = { key: 'MIRROR', execute: () => null };
    const transactionProbe: CadTransaction = {
      id: 't-1', sequence: 1, commandKey: 'GRIP_EDIT', label: 'edit',
      beforeSelectionIds: [], afterSelectionIds: [], addedEntityIds: [], removedEntityIds: [],
    };
    expect([definitionProbe.key, transactionProbe.commandKey]).toEqual(['MIRROR', 'GRIP_EDIT']);
    expectTypeOf<CadCommand extends { key: string } ? true : false>().toEqualTypeOf<true>();
  });
});

describe('STRUCT-241.15 type-only leaves and emit parity', () => {
  it('planar leaf imports nothing', () => {
    expect(runtimeImportSpecifiers(PT_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(PT_LEAF)).toBe(true);
    expect(valueStatementKinds(PT_LEAF)).toEqual([]);
    expect(allImportSpecifiers(PT_LEAF)).toEqual([]);
    expect(importBindingsBySpecifier(PT_LEAF)).toEqual([]);
  });

  it('geometry-edit leaf imports exactly the allow-listed type modules', () => {
    expect(runtimeImportSpecifiers(GE_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(GE_LEAF)).toBe(true);
    expect(valueStatementKinds(GE_LEAF)).toEqual([]);
    expect(allImportSpecifiers(GE_LEAF)).toEqual([
      './cadCorePrimitiveTypes',
      './cadEntityFoundationTypes',
      './cadGripSnapTypes',
    ]);
    expect(importBindingsBySpecifier(GE_LEAF)).toEqual([
      { specifier: './cadCorePrimitiveTypes', names: ['CadEntityId', 'CadLayerId'] },
      { specifier: './cadEntityFoundationTypes', names: ['CadEntityAppearance'] },
      { specifier: './cadGripSnapTypes', names: ['CadGripHandleKind'] },
    ]);
  });

  it('transpiled emit is marker-only for the hub and both leaves', () => {
    expect(strippedEmit(HUB)).toBe('export {};');
    expect(strippedEmit(PT_LEAF)).toBe('export {};');
    expect(strippedEmit(GE_LEAF)).toBe('export {};');
    expect(createHash('sha256').update(strippedEmit(HUB)).digest('hex'))
      .toBe(EXPECTED_HUB_EMIT_SHA256);
  });
});

describe('STRUCT-241.15 transform/geometry-edit regression neighbours covered by import existence', () => {
  it.each([
    'cad_transform_commands_18q',
    'cad_transform_apply_18q',
    'cad_transform_kernel_18q',
    'cad_helmert_gridground_commands_18q',
    'cad_helmert_align_grid_18q',
    'cad_project_transform_commands_18r',
    'cad_blocks_mirror_18q',
    'cad_polyline_vertex_editing_c3_grips',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });

  it('transform and geometry-edit command engine modules exist', () => {
    for (const relative of [
      'src/engine/cad/cadTransactionsTransformCommands.ts',
      'src/engine/cad/cadTransactionsEntityTransforms.ts',
      'src/engine/cad/cadTransactionsExtend.ts',
      'src/engine/cad/cadTransactionsFillet.ts',
      'src/engine/cad/cadTransactionsTrim.ts',
      'src/engine/cad/cadTransactionsEditCommands.ts',
      'src/engine/cad/cadTransactionsProjectTransformCommands.ts',
    ]) {
      expect(fs.existsSync(abs(relative)), `engine module missing: ${relative}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.15 extraction is type-only: +2 nodes / +5 type edges (2 hub
// imports + 3 geometry-edit out-edges + 0 planar out-edges − 0 retired
// edges; the hub keeps its ./cadTypes barrel edge). Both historical
// value/mixed digests stay identical.
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

describe('STRUCT-241.15 CAD+F2F graph pins', () => {
  // First cold graph parse in this file; allow headroom under full-suite CI contention.
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // STRUCT-241.16 roll-forward: +2 nodes / +3 type edges (2 hub imports +
    // 1 polyline out-edge + 0 sheet out-edges − 0 retired edges; the hub
    // keeps its ./cadTypes barrel edge).
    expect(graph.nodes.length).toBe(513);
    expect(graph.edges.length).toBe(2486);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  }, 30_000);

  it('adds exactly the allow-listed TYPE edges incident to the two leaves', () => {
    const graph = cadF2fGraph();
    const ptLeaf = path.resolve(PT_LEAF);
    const geLeaf = path.resolve(GE_LEAF);
    expect(graph.edges.filter((edge) => edge.from === ptLeaf)).toEqual([]);
    expect(graph.edges.filter((edge) => edge.from === geLeaf).map((edge) => edge.specifier).sort()).toEqual([
      './cadCorePrimitiveTypes',
      './cadEntityFoundationTypes',
      './cadGripSnapTypes',
    ]);
    expect(graph.edges.filter((edge) => edge.to === ptLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: ptLeaf,
        specifier: './cadTransactionsPlanarTransformCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter((edge) => edge.to === geLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: geLeaf,
        specifier: './cadTransactionsGeometryEditCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter(
      (edge) => (edge.from === ptLeaf || edge.to === ptLeaf || edge.from === geLeaf || edge.to === geLeaf)
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
    // The shared identity/appearance/grip aliases now also arrive via the
    // geometry-edit leaf; the hub never imports those leaves directly.
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts')),
    )).toEqual([]);
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadEntityFoundationTypes.ts')),
    )).toEqual([]);
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadGripSnapTypes.ts')),
    )).toEqual([]);
  });

  it('has no leaf back-edge to the transaction hub or command executors', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    for (const leaf of [path.resolve(PT_LEAF), path.resolve(GE_LEAF)]) {
      for (const target of [
        hub,
        path.resolve(path.join(CAD_DIR, 'cadTransactions.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsTransformCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsEntityTransforms.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsExtend.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsFillet.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsTrim.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsEditCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsProjectTransformCommands.ts')),
      ]) {
        expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
      }
      expect(graph.edges.filter((edge) => edge.from === leaf && edge.kind !== 'type')).toEqual([]);
    }
  });
});

describe('STRUCT-241.15 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // Post-241.14 baseline 1681 / 7589; the two leaves add the same +2 / +5
    // (every 241.15 edge resolves inside `src`).
    // STRUCT-241.16 roll-forward: 1685 / 7597 (same +2 / +3; every 241.16
    // edge resolves inside `src`).
    expect(graph.nodes.length).toBe(1685);
    expect(graph.edges.length).toBe(7597);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4444,
      uniqPairs: 4385,
      sha: '415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448',
    });
  }, 120_000);
});

describe('STRUCT-241.15 negative controls (in-memory mutations only)', () => {
  // Pristine disk contents captured at collection time (describe bodies run
  // before any `it`), so the worktree-clean guard compares against the
  // pre-control state instead of reading the files twice at the end.
  const pristinePt = fs.readFileSync(PT_LEAF, 'utf8');
  const pristineGe = fs.readFileSync(GE_LEAF, 'utf8');
  const pristineHub = fs.readFileSync(HUB, 'utf8');
  const ptSource = (): string => fs.readFileSync(PT_LEAF, 'utf8');
  const geSource = (): string => fs.readFileSync(GE_LEAF, 'utf8');
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('fails the shape pin when MOVE deltaX becomes optional', () => {
    const mutated = ptSource().replace(
      "      key: 'MOVE';\n      deltaX: number;\n      deltaY: number;",
      "      key: 'MOVE';\n      deltaX?: number;\n      deltaY: number;",
    );
    expect(mutated).not.toBe(ptSource());
    const move = variantShapesFromSource(parseText('m.ts', mutated), 'm', PT_ALIAS)
      .find((v) => v.key === 'MOVE')!;
    expect(() => expect(move.props).toEqual(EXPECTED_PLANAR_SHAPES.MOVE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when COPY deltaY is dropped', () => {
    const mutated = ptSource().replace(
      "      key: 'COPY';\n      deltaX: number;\n      deltaY: number;",
      "      key: 'COPY';\n      deltaX: number;",
    );
    expect(mutated).not.toBe(ptSource());
    const copy = variantShapesFromSource(parseText('m.ts', mutated), 'm', PT_ALIAS)
      .find((v) => v.key === 'COPY')!;
    expect(() => expect(copy.props).toEqual(EXPECTED_PLANAR_SHAPES.COPY!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when ROTATE angleDeg becomes optional', () => {
    const mutated = ptSource().replace(
      '      baseX: number;\n      baseY: number;\n      angleDeg: number;',
      '      baseX: number;\n      baseY: number;\n      angleDeg?: number;',
    );
    expect(mutated).not.toBe(ptSource());
    const rotate = variantShapesFromSource(parseText('m.ts', mutated), 'm', PT_ALIAS)
      .find((v) => v.key === 'ROTATE')!;
    expect(() => expect(rotate.props).toEqual(EXPECTED_PLANAR_SHAPES.ROTATE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when SCALE factor widens to string', () => {
    const mutated = ptSource().replace(
      "      key: 'SCALE';\n      baseX: number;\n      baseY: number;\n      factor: number;",
      "      key: 'SCALE';\n      baseX: number;\n      baseY: number;\n      factor: string;",
    );
    expect(mutated).not.toBe(ptSource());
    const scale = variantShapesFromSource(parseText('m.ts', mutated), 'm', PT_ALIAS)
      .find((v) => v.key === 'SCALE')!;
    expect(() => expect(scale.props).toEqual(EXPECTED_PLANAR_SHAPES.SCALE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when MIRROR eraseSource becomes optional', () => {
    const mutated = ptSource().replace(
      '      eraseSource: boolean;',
      '      eraseSource?: boolean;',
    );
    expect(mutated).not.toBe(ptSource());
    const mirror = variantShapesFromSource(parseText('m.ts', mutated), 'm', PT_ALIAS)
      .find((v) => v.key === 'MIRROR')!;
    expect(() => expect(mirror.props).toEqual(EXPECTED_PLANAR_SHAPES.MIRROR!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when MIRROR p1 loses its y coordinate', () => {
    const mutated = ptSource().replace(
      '      p1: { x: number; y: number };',
      '      p1: { x: number };',
    );
    expect(mutated).not.toBe(ptSource());
    const mirror = variantShapesFromSource(parseText('m.ts', mutated), 'm', PT_ALIAS)
      .find((v) => v.key === 'MIRROR')!;
    expect(() => expect(mirror.props).toEqual(EXPECTED_PLANAR_SHAPES.MIRROR!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when ALIGN2D scaleToFit is dropped', () => {
    const mutated = ptSource().replace(
      '      target2: { x: number; y: number };\n      scaleToFit: boolean;',
      '      target2: { x: number; y: number };',
    );
    expect(mutated).not.toBe(ptSource());
    const align = variantShapesFromSource(parseText('m.ts', mutated), 'm', PT_ALIAS)
      .find((v) => v.key === 'ALIGN2D')!;
    expect(() => expect(align.props).toEqual(EXPECTED_PLANAR_SHAPES.ALIGN2D!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when EXTEND targetSegmentId becomes required', () => {
    const mutated = geSource().replace(
      '      targetPickPoint: { x: number; y: number };\n      targetSegmentId?: string;',
      '      targetPickPoint: { x: number; y: number };\n      targetSegmentId: string;',
    );
    expect(mutated).not.toBe(geSource());
    const extend = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'EXTEND')!;
    expect(() => expect(extend.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.EXTEND!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when FILLET firstSegmentId becomes required', () => {
    const mutated = geSource().replace(
      "      firstPickPoint: { x: number; y: number };\n      firstSegmentId?: string;",
      "      firstPickPoint: { x: number; y: number };\n      firstSegmentId: string;",
    );
    expect(mutated).not.toBe(geSource());
    const fillet = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'FILLET')!;
    expect(() => expect(fillet.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.FILLET!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when FILLET radius widens to string', () => {
    const mutated = geSource().replace(
      "      key: 'FILLET';\n      radius: number;",
      "      key: 'FILLET';\n      radius: string;",
    );
    expect(mutated).not.toBe(geSource());
    const fillet = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'FILLET')!;
    expect(() => expect(fillet.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.FILLET!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when FILLET secondEntityId is dropped', () => {
    const mutated = geSource().replace(
      '      secondEntityId: CadEntityId;\n      secondPickPoint: { x: number; y: number };',
      '      secondPickPoint: { x: number; y: number };',
    );
    expect(mutated).not.toBe(geSource());
    const fillet = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'FILLET')!;
    expect(() => expect(fillet.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.FILLET!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when PASTE entityIds weakens to string[]', () => {
    const mutated = geSource().replace(
      '      entityIds: CadEntityId[];',
      '      entityIds: string[];',
    );
    expect(mutated).not.toBe(geSource());
    const paste = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'PASTE')!;
    expect(() => expect(paste.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.PASTE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when TRIM pickPoint is dropped', () => {
    const mutated = geSource().replace(
      '      targetEntityId: CadEntityId;\n      pickPoint: { x: number; y: number };',
      '      targetEntityId: CadEntityId;',
    );
    expect(mutated).not.toBe(geSource());
    const trim = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'TRIM')!;
    expect(() => expect(trim.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.TRIM!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when TRIM targetSegmentId becomes required', () => {
    const mutated = geSource().replace(
      '      pickPoint: { x: number; y: number };\n      targetSegmentId?: string;',
      '      pickPoint: { x: number; y: number };\n      targetSegmentId: string;',
    );
    expect(mutated).not.toBe(geSource());
    const trim = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'TRIM')!;
    expect(() => expect(trim.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.TRIM!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when INTERSECT_POINT label becomes required', () => {
    const mutated = geSource().replace(
      '      x: number;\n      y: number;\n      label?: string;',
      '      x: number;\n      y: number;\n      label: string;',
    );
    expect(mutated).not.toBe(geSource());
    const point = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'INTERSECT_POINT')!;
    expect(() => expect(point.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.INTERSECT_POINT!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when INTERSECT_POINT secondLabel is dropped', () => {
    const mutated = geSource().replace(
      '      firstLabel: string;\n      secondLabel: string;',
      '      firstLabel: string;',
    );
    expect(mutated).not.toBe(geSource());
    const point = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'INTERSECT_POINT')!;
    expect(() => expect(point.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.INTERSECT_POINT!.map(pinShape)))
      .toThrow();
  });

  it('fails the nested-kind pin when EDIT_ENTITY point-z loses null', () => {
    const mutated = geSource().replace(
      "        | { kind: 'point-z'; value: number | null }",
      "        | { kind: 'point-z'; value: number }",
    );
    expect(mutated).not.toBe(geSource());
    const edit = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'EDIT_ENTITY')!;
    expect(() => expect(edit.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.EDIT_ENTITY!.map(pinShape)))
      .toThrow();
  });

  it('fails the nested-kind pin when an EDIT_ENTITY branch is removed', () => {
    const mutated = geSource().replace(
      "        | { kind: 'arc-radius'; value: number }\n",
      '',
    );
    expect(mutated).not.toBe(geSource());
    expect(editKindsInOrderFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)).toHaveLength(9);
    expect(() => expect(editKindsInOrderFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS))
      .toEqual([...EXPECTED_EDIT_KINDS])).toThrow();
  });

  it('fails the nested-kind pin when two EDIT_ENTITY branches reorder', () => {
    const source = geSource();
    const layer = "        | { kind: 'entity-layer'; layerId: CadLayerId }";
    const appearance = "        | { kind: 'entity-appearance'; patch: CadEntityAppearance };";
    expect(source).toContain(layer);
    expect(source).toContain(appearance);
    const mutated = source.replace(layer, '__SWAP__').replace(appearance, `${layer};`).replace('__SWAP__', appearance.replace(/;$/, ''));
    expect(mutated).not.toBe(source);
    expect(() => expect(editKindsInOrderFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS))
      .toEqual([...EXPECTED_EDIT_KINDS])).toThrow();
  });

  it('fails the nested-kind pin when entity-layer layerId weakens to string', () => {
    const mutated = geSource().replace(
      "        | { kind: 'entity-layer'; layerId: CadLayerId }",
      "        | { kind: 'entity-layer'; layerId: string }",
    );
    expect(mutated).not.toBe(geSource());
    const edit = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'EDIT_ENTITY')!;
    expect(() => expect(edit.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.EDIT_ENTITY!.map(pinShape)))
      .toThrow();
  });

  it('fails the nested-kind pin when entity-appearance patch weakens to unknown', () => {
    const mutated = geSource().replace(
      "        | { kind: 'entity-appearance'; patch: CadEntityAppearance };",
      "        | { kind: 'entity-appearance'; patch: unknown };",
    );
    expect(mutated).not.toBe(geSource());
    const edit = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'EDIT_ENTITY')!;
    expect(() => expect(edit.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.EDIT_ENTITY!.map(pinShape)))
      .toThrow();
  });

  it('fails the nested-kind pin when polyline-vertices drops y', () => {
    const mutated = geSource().replace(
      "        | { kind: 'polyline-vertices'; vertices: Array<{ vertexIndex: number; x: number; y: number }> }",
      "        | { kind: 'polyline-vertices'; vertices: Array<{ vertexIndex: number; x: number }> }",
    );
    expect(mutated).not.toBe(geSource());
    const edit = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'EDIT_ENTITY')!;
    expect(() => expect(edit.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.EDIT_ENTITY!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when GRIP_EDIT gripKind weakens to string', () => {
    const mutated = geSource().replace(
      '      gripKind: CadGripHandleKind;',
      '      gripKind: string;',
    );
    expect(mutated).not.toBe(geSource());
    const grip = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'GRIP_EDIT')!;
    expect(() => expect(grip.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.GRIP_EDIT!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when GRIP_EDIT vertexIndex becomes required', () => {
    const mutated = geSource().replace(
      '      vertexIndex?: number;',
      '      vertexIndex: number;',
    );
    expect(mutated).not.toBe(geSource());
    const grip = variantShapesFromSource(parseText('m.ts', mutated), 'm', GE_ALIAS)
      .find((v) => v.key === 'GRIP_EDIT')!;
    expect(() => expect(grip.props).toEqual(EXPECTED_GEOMETRYEDIT_SHAPES.GRIP_EDIT!.map(pinShape)))
      .toThrow();
  });

  it('fails the splice guard when the hub drops the planar splice', () => {
    const source = hubSource();
    const refLine = `  | ${PT_ALIAS}\n`;
    expect(source).toContain(refLine);
    const mutated = source.replace(refLine, '');
    expect(mutated).not.toBe(source);
    const counts = hubTopLevelCounts(parseText('mutated-hub.ts', mutated));
    expect(() => expect(counts).toEqual({ total: 55, inline: 11, refs: 37, intersections: 7 })).toThrow();
    const flat = hubFlattenedKeys(parseText('mutated-hub.ts', mutated));
    expect(() => expect(flat.length).toBe(168)).toThrow();
  });

  it('fails the splice guard when the hub drops the geometry-edit splice', () => {
    const source = hubSource();
    const refLine = `  | ${GE_ALIAS}\n`;
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
      .replace(`  | ${PT_ALIAS}\n`, '__SWAP_PT__\n')
      .replace(`  | ${GE_ALIAS}\n`, `  | ${PT_ALIAS}\n`)
      .replace('__SWAP_PT__\n', `  | ${GE_ALIAS}\n`);
    expect(mutated).not.toBe(source);
    const seq = hubMemberSequence(parseText('mutated-hub.ts', mutated));
    const survey = seq.findIndex((m) => m.kind === 'inline' && m.label === 'SURVEYTABLE_EDIT');
    expect(() => expect(seq[survey + 1]).toEqual({ kind: 'ref', label: PT_ALIAS })).toThrow();
  });

  it('fails the ordering guard when planar variants reorder', () => {
    const source = ptSource();
    const shapes = variantShapesFromSource(parseText('leaf.ts', source), 'leaf', PT_ALIAS);
    const move = shapes.find((v) => v.key === 'MOVE')!.text;
    const align = shapes.find((v) => v.key === 'ALIGN2D')!.text;
    const mutated = source.replace(move, '__SWAP__').replace(align, move).replace('__SWAP__', align);
    expect(mutated).not.toBe(source);
    const swapped = variantShapesFromSource(parseText('m.ts', mutated), 'm', PT_ALIAS);
    expect(swapped.map((v) => v.key)).toHaveLength(6);
    expect(() => expect(swapped.map((v) => v.key)).toEqual([...EXPECTED_PLANAR_DESCRIPTORS])).toThrow();
  });

  it('fails the acyclicity guard on a synthetic TYPE back-edge to the hub', () => {
    const mutated = `${geSource()}\nimport type { CadCommand } from './cadTransactions.types';\ntype BackEdge = CadCommand;\n`;
    expect(mutated).not.toBe(geSource());
    // Extract the specifier list from the MUTATED text (not the pristine
    // file): the back-edge must be visible to the same helper the allowlist
    // pin uses, and the allowlist pin must reject it.
    const mutatedSpecs = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(allImportSpecifiers(GE_LEAF)).not.toContain('./cadTransactions.types');
    expect(mutatedSpecs).toContain('./cadTransactions.types');
    expect(() => expect(mutatedSpecs).toEqual(allImportSpecifiers(GE_LEAF))).toThrow();
  });

  it('fails the type-only guard on a synthetic VALUE import in the leaf', () => {
    const mutated = geSource().replace(
      "import type { CadEntityId, CadLayerId } from './cadCorePrimitiveTypes';",
      "import { CadEntityId, CadLayerId } from './cadCorePrimitiveTypes';",
    );
    expect(mutated).not.toBe(geSource());
    const runtime = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt))
      .filter((stmt) => stmt.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword)
      .map((stmt) => stmt.moduleSpecifier.getText());
    expect(runtime).toContain("'./cadCorePrimitiveTypes'");
    expect(() => expect(runtime).toEqual([])).toThrow();
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(PT_LEAF, 'utf8')).toBe(pristinePt);
    expect(fs.readFileSync(GE_LEAF, 'utf8')).toBe(pristineGe);
    expect(fs.readFileSync(HUB, 'utf8')).toBe(pristineHub);
    expect(ptSource()).toBe(pristinePt);
    expect(geSource()).toBe(pristineGe);
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
