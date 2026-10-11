/**
 * STRUCT-241.12 — CAD feature-line + design-surface command payload type leaves.
 *
 * Pins `src/engine/cad/cadTransactionsFeatureLineCommandTypes.ts`, which
 * extracts the eleven Phase 20A 3D feature-line command payloads out of the
 * `CadCommand` union as one public union, and
 * `src/engine/cad/cadTransactionsDesignSurfaceCommandTypes.ts`, which
 * extracts the five Phase 20D design-surface workflow payloads as one public
 * union, so the hub splices both back into their original contiguous
 * positions:
 *  - `CadFeatureLineCommandPayload` (11 object members, 13 key literals):
 *    FEATURELINE/FEATURELINECREATE (1 double-key object), FEATURELINEELEV/
 *    FLSETZ (1 double-key object), FLRAISELOWER, FLGRADE, FLINTERPOLATE,
 *    FLSURFACEELEV, FLREVERSE, FLINQUIRY, FLINSERTVERTEX, FLDELETEVERTEX,
 *    SURFACE_ADD_FEATURE_LINE_BREAKLINE — between CadAnalysisCommandPayload
 *    and the Phase 20B grading group.
 *  - `CadDesignSurfaceCommandPayload` (5): SURFPURPOSE, DESIGNSURFACE,
 *    DESIGNAPPLY, DESIGNVOLUME, DESIGNPATCH — between
 *    CadGradingGroupCommandPayload and the Phase C3 polyline vertex group.
 *
 * Covers: hand-transcribed pre-refactor `Base*` shapes + AST property pins
 * (incl. the two double-key objects, the FLGRADE mode literal, the nullable
 * SURFPURPOSE purpose / styleId nullability, the DESIGN* revision + session
 * JSDoc notes, and the Phase 20A / Phase 20D section comments); per-key
 * `Extract<CadCommand>` equivalence in both directions with explicitly
 * type-correct selectors for both literals of each double-key object (a
 * single-literal `{ key: 'FEATURELINE' }` selector matches `never` because
 * the variant key is the union — pinned below as documentation); optionality
 * precision; the byte-identical `CadCommandKey` (248 literals / 241 unique /
 * 7 legacy duplicate BLOCK keys kept, plus the ordered-list digest); both
 * splice sentinels + 89 top-level + 168 flattened effective members; public
 * transaction types; type-only emit pins; CAD+F2F and full-`src` graph pins
 * with an explicit +2 node / +5 type-edge allowlist (+7 new type edges — 2
 * hub imports + 5 leaf out-edges — minus 2 retired hub edges to
 * cadFeatureLineCreate + gradingGroupTypes); in-memory negative controls;
 * and feature-line / grading-group / design-workflow regression neighbours
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
import type { CadEntityId, CadLayerId } from '../src/engine/cad/cadCorePrimitiveTypes';
import type { FeatureLineElevationMethod } from '../src/engine/cad/cadFeatureLineCreate';
import type { CadSurfacePurpose } from '../src/engine/cad/cadSurfaceModelStyleTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { CadFeatureLineCommandPayload } from '../src/engine/cad/cadTransactionsFeatureLineCommandTypes';
import type { CadDesignSurfaceCommandPayload } from '../src/engine/cad/cadTransactionsDesignSurfaceCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const FL_LEAF = path.join(CAD_DIR, 'cadTransactionsFeatureLineCommandTypes.ts');
const DS_LEAF = path.join(CAD_DIR, 'cadTransactionsDesignSurfaceCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');
const FL_ALIAS = 'CadFeatureLineCommandPayload';
const DS_ALIAS = 'CadDesignSurfaceCommandPayload';

const abs = (relative: string): string => path.join(REPO_ROOT, relative);
const relPosix = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// TypeScript compiler helpers (same shape as the STRUCT-241.11 guard).
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
 * Double-key objects keep their normalized union text as a single descriptor
 * (e.g. `'FEATURELINE'|'FEATURELINECREATE'`), so expanding a leaf preserves
 * the exact pre-refactor effective member sequence without widening or
 * splitting payload semantics.
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

/** Every object variant of the alias union, in declaration order (multi-literal keys kept whole). */
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
  // STRUCT-241.12: expand both new aliases per-member so the two double-key
  // objects stay single combined descriptors (11 + 5 = 16, no widening).
  const featureline = leafMemberDescriptors(FL_LEAF, 'featureline', FL_ALIAS);
  const designsurface = leafMemberDescriptors(DS_LEAF, 'designsurface', DS_ALIAS);
  // STRUCT-241.13: expand both new aliases per-member so the fifteen
  // single-keyed bodies stay exact (6 + 9, no widening).
  const alignment = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsAlignmentCommandTypes.ts'), 'alignment', 'CadAlignmentCommandPayload');
  const parcelConstruction = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsParcelConstructionCommandTypes.ts'), 'parcel', 'CadParcelConstructionCommandPayload');
  // STRUCT-241.14 roll-forward: expand the primitive-draw (13) + basic-
  // curve (6) aliases per-member (all single-keyed, no widening).
  const primitive = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes.ts'), 'primitive', 'CadPrimitiveDrawCommandPayload');
  const basiccurve = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsBasicCurveCommandTypes.ts'), 'basiccurve', 'CadBasicCurveCommandPayload');
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
      else if (name === FL_ALIAS) members.push(...featureline);
      else if (name === DS_ALIAS) members.push(...designsurface);
      else if (name === 'CadAlignmentCommandPayload') members.push(...alignment);
      else if (name === 'CadParcelConstructionCommandPayload') members.push(...parcelConstruction);
      else if (name === 'CadPrimitiveDrawCommandPayload') members.push(...primitive);
      else if (name === 'CadBasicCurveCommandPayload') members.push(...basiccurve);
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
// baseline (/tmp/struct24112-baseline/cadTransactions.types.ts.baseline,
// hub CadCommand block). They import no leaf type, so leaf drift cannot move
// both sides of an assertion.
// ---------------------------------------------------------------------------

type BaseFeatureLineCreate = {
  key: 'FEATURELINE' | 'FEATURELINECREATE';
  sourceEntityIds: CadEntityId[];
  sourceKind: 'survey-points' | 'chain';
  elevation: FeatureLineElevationMethod;
  name?: string;
  description?: string;
  closed?: boolean;
};

type BaseFeatureLineElev = {
  key: 'FEATURELINEELEV' | 'FLSETZ';
  entityId: CadEntityId;
  z: number;
  vertexIds?: string[];
};

type BaseFlRaiseLower = {
  key: 'FLRAISELOWER';
  entityId: CadEntityId;
  deltaZ: number;
  vertexIds?: string[];
};

type BaseFlGrade = {
  key: 'FLGRADE';
  entityId: CadEntityId;
  startVertexId?: string;
  endVertexId?: string;
  startStation?: number;
  endStation?: number;
  gradePercent: number;
  mode?: 'set-end-only' | 'grade-all-intermediates';
};

type BaseFlInterpolate = {
  key: 'FLINTERPOLATE';
  entityId: CadEntityId;
  startVertexId?: string;
  endVertexId?: string;
  startStation?: number;
  endStation?: number;
};

type BaseFlSurfaceElev = {
  key: 'FLSURFACEELEV';
  entityId: CadEntityId;
  surfaceId: string;
};

type BaseFlReverse = {
  key: 'FLREVERSE';
  entityId: CadEntityId;
};

type BaseFlInquiry = {
  key: 'FLINQUIRY';
  entityId: CadEntityId;
  startStation?: number;
  endStation?: number;
};

type BaseFlInsertVertex = {
  key: 'FLINSERTVERTEX';
  entityId: CadEntityId;
  courseIndex: number;
  station: number;
};

type BaseFlDeleteVertex = {
  key: 'FLDELETEVERTEX';
  entityId: CadEntityId;
  vertexIndex: number;
};

type BaseFlBreakline = {
  key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE';
  surfaceId: string;
  entityId: CadEntityId;
  name?: string;
};

type BaseSurfPurpose = {
  key: 'SURFPURPOSE';
  surfaceId: string;
  /** Explicit role; null/undefined clears back to legacy neutral. */
  purpose?: CadSurfacePurpose | null;
};

type BaseDesignSurface = {
  key: 'DESIGNSURFACE';
  sourceSurfaceId: string;
  name: string;
  /** Current source revision; a stale value rejects the copy. */
  expectedRevision: string;
  /** Session-owned CURRENT assertion (see SURFBAKE). */
  sessionCurrent?: boolean;
  layerId?: CadLayerId;
  /** Undefined = keep the source style; null = clear. */
  styleId?: string | null;
};

type BaseDesignApply = {
  key: 'DESIGNAPPLY';
  /** Design target (keeps id/name/layer/style/purpose; never existing-ground). */
  targetSurfaceId: string;
  /** Current target revision; a stale value rejects the apply. */
  targetExpectedRevision: string;
  /** Patch source (contributes topology only; byte-identical). */
  patchSurfaceId: string;
  /** Current patch revision; a stale value rejects the apply. */
  patchExpectedRevision: string;
  /** Session-owned CURRENT assertion (see SURFBAKE). */
  sessionCurrent?: boolean;
};

type BaseDesignVolume = {
  key: 'DESIGNVOLUME';
  baseSurfaceId: string;
  comparisonSurfaceId: string;
  name?: string;
  layerId?: CadLayerId;
  styleId?: string;
};

type BaseDesignPatch = {
  key: 'DESIGNPATCH';
  groupId: string;
  /** Cached CURRENT result snapshot (never recomputed here). */
  result: CadGradingGroupResult;
  expectedRevision: string;
  sessionCurrent?: boolean;
  name?: string;
  layerId?: CadLayerId;
  /** Undefined = keep the group style; null = clear. */
  styleId?: string | null;
};

/** One descriptor per leaf member, in declaration order (double-key objects stay whole). */
const EXPECTED_FEATURELINE_DESCRIPTORS = [
  "'FEATURELINE'|'FEATURELINECREATE'",
  "'FEATURELINEELEV'|'FLSETZ'",
  'FLRAISELOWER',
  'FLGRADE',
  'FLINTERPOLATE',
  'FLSURFACEELEV',
  'FLREVERSE',
  'FLINQUIRY',
  'FLINSERTVERTEX',
  'FLDELETEVERTEX',
  'SURFACE_ADD_FEATURE_LINE_BREAKLINE',
] as const;

const EXPECTED_DESIGN_DESCRIPTORS = [
  'SURFPURPOSE',
  'DESIGNSURFACE',
  'DESIGNAPPLY',
  'DESIGNVOLUME',
  'DESIGNPATCH',
] as const;

/** Every moved literal (both halves of each double-key object). */
const EXPECTED_MOVED_LITERALS = [
  'FEATURELINE', 'FEATURELINECREATE',
  'FEATURELINEELEV', 'FLSETZ',
  'FLRAISELOWER', 'FLGRADE', 'FLINTERPOLATE', 'FLSURFACEELEV',
  'FLREVERSE', 'FLINQUIRY', 'FLINSERTVERTEX', 'FLDELETEVERTEX',
  'SURFACE_ADD_FEATURE_LINE_BREAKLINE',
  'SURFPURPOSE', 'DESIGNSURFACE', 'DESIGNAPPLY', 'DESIGNVOLUME', 'DESIGNPATCH',
] as const;

const EXPECTED_FEATURELINE_SHAPES: Record<string, string[]> = {
  "'FEATURELINE'|'FEATURELINECREATE'": [
    "key: 'FEATURELINE' | 'FEATURELINECREATE'",
    'sourceEntityIds: CadEntityId[]',
    "sourceKind: 'survey-points' | 'chain'",
    'elevation: FeatureLineElevationMethod',
    'name?: string',
    'description?: string',
    'closed?: boolean',
  ],
  "'FEATURELINEELEV'|'FLSETZ'": [
    "key: 'FEATURELINEELEV' | 'FLSETZ'",
    'entityId: CadEntityId',
    'z: number',
    'vertexIds?: string[]',
  ],
  FLRAISELOWER: [
    "key: 'FLRAISELOWER'",
    'entityId: CadEntityId',
    'deltaZ: number',
    'vertexIds?: string[]',
  ],
  FLGRADE: [
    "key: 'FLGRADE'",
    'entityId: CadEntityId',
    'startVertexId?: string',
    'endVertexId?: string',
    'startStation?: number',
    'endStation?: number',
    'gradePercent: number',
    "mode?: 'set-end-only' | 'grade-all-intermediates'",
  ],
  FLINTERPOLATE: [
    "key: 'FLINTERPOLATE'",
    'entityId: CadEntityId',
    'startVertexId?: string',
    'endVertexId?: string',
    'startStation?: number',
    'endStation?: number',
  ],
  FLSURFACEELEV: [
    "key: 'FLSURFACEELEV'",
    'entityId: CadEntityId',
    'surfaceId: string',
  ],
  FLREVERSE: [
    "key: 'FLREVERSE'",
    'entityId: CadEntityId',
  ],
  FLINQUIRY: [
    "key: 'FLINQUIRY'",
    'entityId: CadEntityId',
    'startStation?: number',
    'endStation?: number',
  ],
  FLINSERTVERTEX: [
    "key: 'FLINSERTVERTEX'",
    'entityId: CadEntityId',
    'courseIndex: number',
    'station: number',
  ],
  FLDELETEVERTEX: [
    "key: 'FLDELETEVERTEX'",
    'entityId: CadEntityId',
    'vertexIndex: number',
  ],
  SURFACE_ADD_FEATURE_LINE_BREAKLINE: [
    "key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE'",
    'surfaceId: string',
    'entityId: CadEntityId',
    'name?: string',
  ],
};

const EXPECTED_DESIGN_SHAPES: Record<string, string[]> = {
  SURFPURPOSE: [
    "key: 'SURFPURPOSE'",
    'surfaceId: string',
    'purpose?: CadSurfacePurpose | null',
  ],
  DESIGNSURFACE: [
    "key: 'DESIGNSURFACE'",
    'sourceSurfaceId: string',
    'name: string',
    'expectedRevision: string',
    'sessionCurrent?: boolean',
    'layerId?: CadLayerId',
    'styleId?: string | null',
  ],
  DESIGNAPPLY: [
    "key: 'DESIGNAPPLY'",
    'targetSurfaceId: string',
    'targetExpectedRevision: string',
    'patchSurfaceId: string',
    'patchExpectedRevision: string',
    'sessionCurrent?: boolean',
  ],
  DESIGNVOLUME: [
    "key: 'DESIGNVOLUME'",
    'baseSurfaceId: string',
    'comparisonSurfaceId: string',
    'name?: string',
    'layerId?: CadLayerId',
    'styleId?: string',
  ],
  DESIGNPATCH: [
    "key: 'DESIGNPATCH'",
    'groupId: string',
    'result: CadGradingGroupResult',
    'expectedRevision: string',
    'sessionCurrent?: boolean',
    'name?: string',
    'layerId?: CadLayerId',
    'styleId?: string | null',
  ],
};

/** Per-variant JSDoc/comment counts in the leaves (the feature-line leaf carries none). */
const EXPECTED_FEATURELINE_COMMENT_COUNTS: Record<string, number> = {};

const EXPECTED_DESIGN_COMMENT_COUNTS: Record<string, number> = {
  SURFPURPOSE: 1,
  DESIGNSURFACE: 3,
  DESIGNAPPLY: 5,
  DESIGNPATCH: 2,
};

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

/** SHA256 of the hub `export {};`-only emit (10 bytes). */
const EXPECTED_HUB_EMIT_SHA256 =
  '2e29cd9a98755c46896f7a2d56524db2d6d96b248e36db46de14c30bf47c8d05';

/** Original Phase 20A section documentation, preserved at the feature-line leaf. */
const PHASE_20A_COMMENT = '// Phase 20A — 3D feature lines (create + edit + report).';

/** Original Phase 20D section documentation, preserved at the design-surface leaf. */
const PHASE_20D_COMMENT = '// Phase 20D Wave-1A — design surface workflow (engine only).';

// Compile-time leaf <-> hub round trip (enforced by project typecheck).
const leafToHub = (payload: CadFeatureLineCommandPayload | CadDesignSurfaceCommandPayload): CadCommand => payload;

describe('STRUCT-241.12 leaf presence and key order', () => {
  it('both command type leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(FL_LEAF), `leaf missing: ${relPosix(FL_LEAF)}`).toBe(true);
    expect(fs.existsSync(DS_LEAF), `leaf missing: ${relPosix(DS_LEAF)}`).toBe(true);
  });

  it('pins the 11 feature-line member descriptors in order (double-key objects whole)', () => {
    expect(leafMemberDescriptors(FL_LEAF, 'featureline', FL_ALIAS)).toEqual([...EXPECTED_FEATURELINE_DESCRIPTORS]);
    // Exactly the two double-key objects; every other member is single-keyed.
    expect(unionKeysInOrder(FL_LEAF, 'featureline', FL_ALIAS)).toHaveLength(9);
  });

  it('pins the 5 design-surface keys in order with no duplicates', () => {
    expect(leafMemberDescriptors(DS_LEAF, 'designsurface', DS_ALIAS)).toEqual([...EXPECTED_DESIGN_DESCRIPTORS]);
    expect(unionKeysInOrder(DS_LEAF, 'designsurface', DS_ALIAS)).toEqual([...EXPECTED_DESIGN_DESCRIPTORS]);
  });

  it('keeps the original Phase 20A section comment at the feature-line leaf', () => {
    const text = fs.readFileSync(FL_LEAF, 'utf8');
    expect(text).toContain(PHASE_20A_COMMENT);
    expect(text.indexOf(PHASE_20A_COMMENT)).toBeLessThan(text.indexOf("key: 'FEATURELINE'"));
    // The union-body comment left the hub: the hub keeps only the shorter
    // CadCommandKey run header `// Phase 20A — 3D feature lines.`.
    expect(fs.readFileSync(HUB, 'utf8')).not.toContain(PHASE_20A_COMMENT);
  });

  it('keeps the original Phase 20D section comment at the design-surface leaf', () => {
    const text = fs.readFileSync(DS_LEAF, 'utf8');
    expect(text).toContain(PHASE_20D_COMMENT);
    expect(text.indexOf(PHASE_20D_COMMENT)).toBeLessThan(text.indexOf("key: 'SURFPURPOSE'"));
    // The identical string survives exactly once in the hub as the
    // CadCommandKey run header; the CadCommand union body no longer carries it.
    const occurrences = fs.readFileSync(HUB, 'utf8').split(PHASE_20D_COMMENT).length - 1;
    expect(occurrences).toBe(1);
  });
});

describe('STRUCT-241.12 baseline shapes: Extract<CadCommand> vs leaf vs Base*', () => {
  it('keeps feature-line members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'FEATURELINE' | 'FEATURELINECREATE' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FEATURELINE' | 'FEATURELINECREATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FEATURELINE' | 'FEATURELINECREATE' }>>()
      .toEqualTypeOf<BaseFeatureLineCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'FEATURELINEELEV' | 'FLSETZ' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FEATURELINEELEV' | 'FLSETZ' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FEATURELINEELEV' | 'FLSETZ' }>>()
      .toEqualTypeOf<BaseFeatureLineElev>();
    expectTypeOf<Extract<CadCommand, { key: 'FLRAISELOWER' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLRAISELOWER' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FLRAISELOWER' }>>().toEqualTypeOf<BaseFlRaiseLower>();
    expectTypeOf<Extract<CadCommand, { key: 'FLGRADE' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLGRADE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FLGRADE' }>>().toEqualTypeOf<BaseFlGrade>();
    expectTypeOf<Extract<CadCommand, { key: 'FLINTERPOLATE' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLINTERPOLATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FLINTERPOLATE' }>>().toEqualTypeOf<BaseFlInterpolate>();
    expectTypeOf<Extract<CadCommand, { key: 'FLSURFACEELEV' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLSURFACEELEV' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FLSURFACEELEV' }>>().toEqualTypeOf<BaseFlSurfaceElev>();
    expectTypeOf<Extract<CadCommand, { key: 'FLREVERSE' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLREVERSE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FLREVERSE' }>>().toEqualTypeOf<BaseFlReverse>();
    expectTypeOf<Extract<CadCommand, { key: 'FLINQUIRY' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLINQUIRY' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FLINQUIRY' }>>().toEqualTypeOf<BaseFlInquiry>();
    expectTypeOf<Extract<CadCommand, { key: 'FLINSERTVERTEX' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLINSERTVERTEX' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FLINSERTVERTEX' }>>().toEqualTypeOf<BaseFlInsertVertex>();
    expectTypeOf<Extract<CadCommand, { key: 'FLDELETEVERTEX' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLDELETEVERTEX' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'FLDELETEVERTEX' }>>().toEqualTypeOf<BaseFlDeleteVertex>();
    expectTypeOf<Extract<CadCommand, { key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE' }>>()
      .toEqualTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE' }>>()
      .toEqualTypeOf<BaseFlBreakline>();
  });

  it('keeps design-surface members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'SURFPURPOSE' }>>()
      .toEqualTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'SURFPURPOSE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'SURFPURPOSE' }>>().toEqualTypeOf<BaseSurfPurpose>();
    expectTypeOf<Extract<CadCommand, { key: 'DESIGNSURFACE' }>>()
      .toEqualTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'DESIGNSURFACE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'DESIGNSURFACE' }>>().toEqualTypeOf<BaseDesignSurface>();
    expectTypeOf<Extract<CadCommand, { key: 'DESIGNAPPLY' }>>()
      .toEqualTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'DESIGNAPPLY' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'DESIGNAPPLY' }>>().toEqualTypeOf<BaseDesignApply>();
    expectTypeOf<Extract<CadCommand, { key: 'DESIGNVOLUME' }>>()
      .toEqualTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'DESIGNVOLUME' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'DESIGNVOLUME' }>>().toEqualTypeOf<BaseDesignVolume>();
    expectTypeOf<Extract<CadCommand, { key: 'DESIGNPATCH' }>>()
      .toEqualTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'DESIGNPATCH' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'DESIGNPATCH' }>>().toEqualTypeOf<BaseDesignPatch>();
  });

  it('keeps both whole-leaf unions identical to their transcribed counterparts', () => {
    expectTypeOf<CadFeatureLineCommandPayload>().toEqualTypeOf<
      | BaseFeatureLineCreate | BaseFeatureLineElev | BaseFlRaiseLower | BaseFlGrade
      | BaseFlInterpolate | BaseFlSurfaceElev | BaseFlReverse | BaseFlInquiry
      | BaseFlInsertVertex | BaseFlDeleteVertex | BaseFlBreakline
    >();
    expectTypeOf<CadDesignSurfaceCommandPayload>().toEqualTypeOf<
      BaseSurfPurpose | BaseDesignSurface | BaseDesignApply | BaseDesignVolume | BaseDesignPatch
    >();
  });

  it('documents why double-key objects need combined selectors (single-literal Extract is never)', () => {
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FEATURELINE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FEATURELINECREATE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FEATURELINEELEV' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLSETZ' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadCommand, { key: 'NOPE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'NOPE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'NOPE' }>>().toEqualTypeOf<never>();
  });

  it('accepts both literals of each double-key object through leaf and hub', () => {
    const createA: CadFeatureLineCommandPayload = {
      key: 'FEATURELINE', sourceEntityIds: [], sourceKind: 'survey-points',
      elevation: { method: 'constant', z: 3 },
    };
    const createB: CadFeatureLineCommandPayload = {
      key: 'FEATURELINECREATE', sourceEntityIds: ['e-1'], sourceKind: 'chain',
      elevation: { method: 'source' }, name: 'fl', closed: true,
    };
    const elevA: CadFeatureLineCommandPayload = { key: 'FEATURELINEELEV', entityId: 'e-1', z: 5 };
    const elevB: CadFeatureLineCommandPayload = { key: 'FLSETZ', entityId: 'e-1', z: 5, vertexIds: ['v-1'] };
    for (const sample of [createA, createB, elevA, elevB]) {
      const viaHub: CadCommand = sample;
      expect(leafToHub(sample)).toBe(viaHub);
    }
    expect(createB.key).toBe('FEATURELINECREATE');
    expect(elevB.key).toBe('FLSETZ');
  });

  it('matches the transcribed AST property shapes, order, and comment counts', () => {
    const featureline = variantShapes(FL_LEAF, 'featureline', FL_ALIAS);
    const designsurface = variantShapes(DS_LEAF, 'designsurface', DS_ALIAS);
    expect(featureline.map((v) => v.key)).toEqual([...EXPECTED_FEATURELINE_DESCRIPTORS]);
    expect(designsurface.map((v) => v.key)).toEqual([...EXPECTED_DESIGN_DESCRIPTORS]);
    for (const variant of featureline) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_FEATURELINE_SHAPES[variant.key]!.map(pinShape),
      );
      expect(variant.comments.length, `${variant.key} comment drift`).toBe(
        EXPECTED_FEATURELINE_COMMENT_COUNTS[variant.key] ?? 0,
      );
    }
    for (const variant of designsurface) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_DESIGN_SHAPES[variant.key]!.map(pinShape),
      );
      expect(variant.comments.length, `${variant.key} comment drift`).toBe(
        EXPECTED_DESIGN_COMMENT_COUNTS[variant.key] ?? 0,
      );
    }
  });

  it('keeps the exact member JSDoc text on the documented design fields', () => {
    const designsurface = variantShapes(DS_LEAF, 'designsurface', DS_ALIAS);
    expect(designsurface.find((v) => v.key === 'SURFPURPOSE')!.comments).toEqual([
      '/** Explicit role; null/undefined clears back to legacy neutral. */',
    ]);
    expect(designsurface.find((v) => v.key === 'DESIGNSURFACE')!.comments).toEqual([
      '/** Current source revision; a stale value rejects the copy. */',
      '/** Session-owned CURRENT assertion (see SURFBAKE). */',
      '/** Undefined = keep the source style; null = clear. */',
    ]);
    expect(designsurface.find((v) => v.key === 'DESIGNAPPLY')!.comments).toEqual([
      '/** Design target (keeps id/name/layer/style/purpose; never existing-ground). */',
      '/** Current target revision; a stale value rejects the apply. */',
      '/** Patch source (contributes topology only; byte-identical). */',
      '/** Current patch revision; a stale value rejects the apply. */',
      '/** Session-owned CURRENT assertion (see SURFBAKE). */',
    ]);
    expect(designsurface.find((v) => v.key === 'DESIGNVOLUME')!.comments).toEqual([]);
    expect(designsurface.find((v) => v.key === 'DESIGNPATCH')!.comments).toEqual([
      '/** Cached CURRENT result snapshot (never recomputed here). */',
      '/** Undefined = keep the group style; null = clear. */',
    ]);
  });

  it('keeps each design JSDoc note adjacent to its documented field', () => {
    const designsurface = variantShapes(DS_LEAF, 'designsurface', DS_ALIAS);
    const adjacent = (descriptor: string, jsdoc: string, field: string): void => {
      const text = designsurface.find((v) => v.key === descriptor)!.text;
      const docAt = text.indexOf(jsdoc);
      const fieldAt = text.indexOf(field);
      expect(docAt, `${descriptor} JSDoc present`).toBeGreaterThanOrEqual(0);
      expect(fieldAt, `${descriptor} field present`).toBeGreaterThanOrEqual(0);
      expect(docAt, `${descriptor} JSDoc adjacency`).toBeLessThan(fieldAt);
      expect(text.slice(docAt + jsdoc.length, fieldAt).trim().length).toBe(0);
    };
    adjacent('SURFPURPOSE', '/** Explicit role; null/undefined clears back to legacy neutral. */', 'purpose?');
    adjacent('DESIGNSURFACE', '/** Current source revision; a stale value rejects the copy. */', 'expectedRevision:');
    adjacent('DESIGNSURFACE', '/** Session-owned CURRENT assertion (see SURFBAKE). */', 'sessionCurrent?');
    adjacent('DESIGNSURFACE', '/** Undefined = keep the source style; null = clear. */', 'styleId?');
    adjacent('DESIGNAPPLY', '/** Design target (keeps id/name/layer/style/purpose; never existing-ground). */', 'targetSurfaceId:');
    adjacent('DESIGNAPPLY', '/** Current target revision; a stale value rejects the apply. */', 'targetExpectedRevision:');
    adjacent('DESIGNAPPLY', '/** Patch source (contributes topology only; byte-identical). */', 'patchSurfaceId:');
    adjacent('DESIGNAPPLY', '/** Current patch revision; a stale value rejects the apply. */', 'patchExpectedRevision:');
    adjacent('DESIGNPATCH', '/** Cached CURRENT result snapshot (never recomputed here). */', 'result:');
    adjacent('DESIGNPATCH', '/** Undefined = keep the group style; null = clear. */', 'styleId?');
  });

  it('keeps required fields required, optionals optional, and nullability exact', () => {
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FEATURELINE' | 'FEATURELINECREATE' }>['elevation']>()
      .toEqualTypeOf<FeatureLineElevationMethod>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FEATURELINE' | 'FEATURELINECREATE' }>['sourceKind']>()
      .toEqualTypeOf<'survey-points' | 'chain'>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FEATURELINE' | 'FEATURELINECREATE' }>['name']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLGRADE' }>['gradePercent']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLGRADE' }>['mode']>()
      .toEqualTypeOf<'set-end-only' | 'grade-all-intermediates' | undefined>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLINSERTVERTEX' }>['courseIndex']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLINSERTVERTEX' }>['station']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'FLDELETEVERTEX' }>['vertexIndex']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadFeatureLineCommandPayload, { key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE' }>['surfaceId']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'SURFPURPOSE' }>['purpose']>()
      .toEqualTypeOf<CadSurfacePurpose | null | undefined>();
    expectTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'DESIGNSURFACE' }>['expectedRevision']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'DESIGNSURFACE' }>['sessionCurrent']>()
      .toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'DESIGNSURFACE' }>['styleId']>()
      .toEqualTypeOf<string | null | undefined>();
    expectTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'DESIGNPATCH' }>['result']>()
      .toEqualTypeOf<CadGradingGroupResult>();
    expectTypeOf<Extract<CadDesignSurfaceCommandPayload, { key: 'DESIGNPATCH' }>['styleId']>()
      .toEqualTypeOf<string | null | undefined>();
  });

  it('compiles full-field samples through the hub round trip', () => {
    const featurelineSamples: CadFeatureLineCommandPayload[] = [
      {
        key: 'FLGRADE', entityId: 'e-1', startVertexId: 'v-1', endVertexId: 'v-2',
        startStation: 0, endStation: 12,
        gradePercent: 2.5, mode: 'grade-all-intermediates',
      },
      { key: 'FLINSERTVERTEX', entityId: 'e-1', courseIndex: 0, station: 4.5 },
      { key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE', surfaceId: 's-1', entityId: 'e-1', name: 'b' },
    ];
    const designSamples: CadDesignSurfaceCommandPayload[] = [
      { key: 'SURFPURPOSE', surfaceId: 's-1', purpose: 'design' satisfies CadSurfacePurpose },
      {
        key: 'DESIGNSURFACE', sourceSurfaceId: 's-1', name: 'd', expectedRevision: 'r1',
        sessionCurrent: true, styleId: null,
      },
      {
        key: 'DESIGNAPPLY', targetSurfaceId: 't', targetExpectedRevision: 'r2',
        patchSurfaceId: 'p', patchExpectedRevision: 'r3',
      },
      {
        key: 'DESIGNPATCH', groupId: 'g',
        result: { groupId: 'g', revision: 'r' } as CadGradingGroupResult,
        expectedRevision: 'r', sessionCurrent: true, name: 'p', layerId: 'l-1', styleId: null,
      },
    ];
    for (const sample of [...featurelineSamples, ...designSamples]) {
      expect(leafToHub(sample)).toBe(sample);
    }
    expect(Object.keys(featurelineSamples[0]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_FEATURELINE_SHAPES.FLGRADE!)].sort(),
    );
    expect(Object.keys(designSamples[3]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_DESIGN_SHAPES.DESIGNPATCH!)].sort(),
    );
  });
});

describe('STRUCT-241.12 hub union splice order and member counts', () => {
  it('measures 72 top-level members and documents the 89 -> 72 extraction', () => {
    const counts = hubTopLevelCounts();
    expect(counts).toEqual({ total: 72, inline: 32, refs: 33, intersections: 7 });
    // Re-inlining the two 241.12 leaves restores 86 = 72 + 11 + 5 bodies -
    // 2 alias references; re-inlining the 241.13 leaves on top restores 99 =
    // 86 + 6 + 9 - 2; re-inlining the 241.14 leaves on top restores the
    // 241.12 shape 116 = 99 + 13 + 6 - 2.
    expect(leafMemberDescriptors(FL_LEAF, 'featureline', FL_ALIAS).length).toBe(11);
    expect(leafMemberDescriptors(DS_LEAF, 'designsurface', DS_ALIAS).length).toBe(5);
    expect(counts.total + 11 + 5 - 2).toBe(86);
    expect(leafMemberDescriptors(
      abs('src/engine/cad/cadTransactionsAlignmentCommandTypes.ts'), 'alignment', 'CadAlignmentCommandPayload').length).toBe(6);
    expect(leafMemberDescriptors(
      abs('src/engine/cad/cadTransactionsParcelConstructionCommandTypes.ts'), 'parcel', 'CadParcelConstructionCommandPayload').length).toBe(9);
    expect(counts.total + 11 + 5 + 6 + 9 - 4).toBe(99);
    expect(leafMemberDescriptors(
      abs('src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes.ts'), 'primitive', 'CadPrimitiveDrawCommandPayload').length).toBe(13);
    expect(leafMemberDescriptors(
      abs('src/engine/cad/cadTransactionsBasicCurveCommandTypes.ts'), 'basiccurve', 'CadBasicCurveCommandPayload').length).toBe(6);
    expect(counts.total + 11 + 5 + 6 + 9 + 13 + 6 - 6).toBe(116);
  });

  it('splices both groups with neighbor sentinels in the original position', () => {
    const seq = hubMemberSequence();
    const analysis = seq.findIndex((m) => m.label === 'CadAnalysisCommandPayload');
    expect(seq[analysis]).toEqual({ kind: 'ref', label: 'CadAnalysisCommandPayload' });
    // Feature-line group sits immediately after the analysis group and
    // immediately before the Phase 20B grading group.
    expect(seq[analysis + 1]).toEqual({ kind: 'ref', label: FL_ALIAS });
    expect(seq[analysis + 2]).toEqual({ kind: 'ref', label: 'CadGradingCommandPayload' });
    const gradingGroup = seq.findIndex((m) => m.label === 'CadGradingGroupCommandPayload');
    expect(seq[gradingGroup]).toEqual({ kind: 'ref', label: 'CadGradingGroupCommandPayload' });
    // Design-surface group sits immediately after the Phase 20C grading-group
    // payload and immediately before the Phase C3 polyline vertex topology.
    expect(seq[gradingGroup + 1]).toEqual({ kind: 'ref', label: DS_ALIAS });
    expect(seq[gradingGroup + 2]).toEqual({ kind: 'inline', label: 'POLYLINE_INSERT_VERTEX' });
  });

  it('keeps the Phase 20B / 20C / C3 group headers adjacent to their splices', () => {
    const text = fs.readFileSync(HUB, 'utf8');
    const b20 = text.indexOf('// Phase 20B — grade-to-surface definitions (results/meshes never in history).');
    const c20 = text.indexOf('// Phase 20C — grading groups (single side only; definitions + snapshots).');
    const c3 = text.indexOf('// Phase C3 — polyline vertex topology (count-changing, one undo entry).');
    expect(Math.min(b20, c20, c3)).toBeGreaterThanOrEqual(0);
    expect(b20).toBeLessThan(text.indexOf('| CadGradingCommandPayload'));
    expect(text.indexOf('| CadGradingCommandPayload')).toBeLessThan(c20);
    expect(c20).toBeLessThan(text.indexOf('| CadGradingGroupCommandPayload'));
    expect(text.indexOf('| CadGradingGroupCommandPayload')).toBeLessThan(text.indexOf(`| ${DS_ALIAS}`));
    expect(text.indexOf(`| ${DS_ALIAS}`)).toBeLessThan(c3);
    expect(c3).toBeLessThan(text.indexOf("key: 'POLYLINE_INSERT_VERTEX'"));
  });

  it('flattens to the exact 168 effective members in the original sequence', () => {
    const flat = hubFlattenedKeys();
    expect(flat.length).toBe(168);
    const at = flat.indexOf('BLOCK_DELETE');
    expect(flat.slice(at + 1, at + 12)).toEqual([
      'CREATE_MTEXT', 'CREATE_LEADER', 'CREATE_DIMENSION', 'CREATE_BEARING_LABEL',
      'CREATE_CURVE_LABEL', 'UPDATE_DIMENSION_PLACEMENT', 'REATTACH_ANNOTATION',
      'SET_TEXT_OVERRIDE', 'CLEAR_TEXT_OVERRIDE', 'SET_ANNOTATION_SCALE', 'ANNOTATION_COMMIT',
    ]);
    expect(flat.slice(at + 12, at + 20)).toEqual([
      'ANALYSIS_MAP_CREATE', 'ANALYSIS_MAP_UPDATE_BANDS', 'ANALYSIS_MAP_UPDATE_APPEARANCE',
      'ANALYSIS_MAP_DELETE', 'ANALYSIS_LEGEND_CREATE', 'ANALYSIS_LEGEND_UPDATE',
      'ANALYSIS_LEGEND_MOVE', 'ANALYSIS_LEGEND_DELETE',
    ]);
    // The feature-line run follows contiguously with both double-key objects whole.
    expect(flat.slice(at + 20, at + 31)).toEqual([...EXPECTED_FEATURELINE_DESCRIPTORS]);
    // The design-surface run follows the grading-group ref contiguously.
    const group = flat.indexOf('CadGradingGroupCommandPayload');
    expect(flat.slice(group + 1, group + 6)).toEqual([...EXPECTED_DESIGN_DESCRIPTORS]);
    expect(flat[group + 6]).toBe('POLYLINE_INSERT_VERTEX');
  });

  it('leaves no inline feature-line/design-surface key behind in the hub union', () => {
    const inlineSets = hubInlineKeySets();
    expect(inlineSets.length).toBe(32);
    const moved: Set<string> = new Set([...EXPECTED_MOVED_LITERALS]);
    for (const set of inlineSets) {
      for (const key of set) {
        expect(moved.has(key), `inline ${key} still in hub`).toBe(false);
      }
    }
    // The union bodies themselves are gone from the hub text (the
    // CadCommandKey literal runs and their short section headers stay).
    const hubText = fs.readFileSync(HUB, 'utf8');
    for (const probe of ["key: 'FLGRADE'", "key: 'FLINSERTVERTEX'", "key: 'DESIGNPATCH'", "key: 'DESIGNSURFACE'"]) {
      expect(hubText, `hub still carries ${probe}`).not.toContain(probe);
    }
  });

  it('retires the three pre-refactor value-type imports from the hub', () => {
    const hubText = fs.readFileSync(HUB, 'utf8');
    for (const name of ['FeatureLineElevationMethod', 'CadGradingGroupResult', 'CadSurfacePurpose']) {
      const occurrences = hubText.split(name).length - 1;
      expect(occurrences, `hub still references ${name}`).toBe(0);
    }
  });
});

describe('STRUCT-241.12 CadCommandKey unchanged', () => {
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

  it('keeps the feature-line and design-surface key runs in their original positions', () => {
    const keys = hubKeyOrder();
    const flLiterals = [
      'FEATURELINE', 'FEATURELINECREATE', 'FEATURELINEELEV', 'FLSETZ',
      'FLRAISELOWER', 'FLGRADE', 'FLINTERPOLATE', 'FLSURFACEELEV',
      'FLREVERSE', 'FLINQUIRY', 'FLINSERTVERTEX', 'FLDELETEVERTEX',
      'SURFACE_ADD_FEATURE_LINE_BREAKLINE',
    ];
    expect(keys.slice(keys.indexOf('FEATURELINE'), keys.indexOf('FEATURELINE') + 13)).toEqual(flLiterals);
    expect(keys[keys.indexOf('ANNOTATION_COMMIT') + 1]).toBe('FEATURELINE');
    expect(keys[keys.indexOf('SURFACE_ADD_FEATURE_LINE_BREAKLINE') + 1]).toBe('GRADING_CREATE');
    const dsLiterals = ['SURFPURPOSE', 'DESIGNSURFACE', 'DESIGNAPPLY', 'DESIGNVOLUME', 'DESIGNPATCH'];
    expect(keys.slice(keys.indexOf('SURFPURPOSE'), keys.indexOf('SURFPURPOSE') + 5)).toEqual(dsLiterals);
    expect(keys[keys.indexOf('GROUPBAKE') + 1]).toBe('SURFPURPOSE');
    expect(keys[keys.indexOf('DESIGNPATCH') + 1]).toBe('POLYLINE_INSERT_VERTEX');
  });
});

describe('STRUCT-241.12 public transaction types unchanged', () => {
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
    const definitionProbe: CadCommandDefinition<CadCommand> = { key: 'FLGRADE', execute: () => null };
    const transactionProbe: CadTransaction = {
      id: 't-1', sequence: 1, commandKey: 'DESIGNPATCH', label: 'patch',
      beforeSelectionIds: [], afterSelectionIds: [], addedEntityIds: [], removedEntityIds: [],
    };
    expect([definitionProbe.key, transactionProbe.commandKey]).toEqual(['FLGRADE', 'DESIGNPATCH']);
    expectTypeOf<CadCommand extends { key: string } ? true : false>().toEqualTypeOf<true>();
  });
});

describe('STRUCT-241.12 type-only leaves and emit parity', () => {
  it('feature-line leaf imports exactly the allow-listed type modules', () => {
    expect(runtimeImportSpecifiers(FL_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(FL_LEAF)).toBe(true);
    expect(valueStatementKinds(FL_LEAF)).toEqual([]);
    expect(allImportSpecifiers(FL_LEAF)).toEqual([
      './cadCorePrimitiveTypes',
      './cadFeatureLineCreate',
    ]);
    expect(importBindingsBySpecifier(FL_LEAF)).toEqual([
      { specifier: './cadCorePrimitiveTypes', names: ['CadEntityId'] },
      { specifier: './cadFeatureLineCreate', names: ['FeatureLineElevationMethod'] },
    ]);
  });

  it('design-surface leaf imports exactly the allow-listed type modules', () => {
    expect(runtimeImportSpecifiers(DS_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(DS_LEAF)).toBe(true);
    expect(valueStatementKinds(DS_LEAF)).toEqual([]);
    expect(allImportSpecifiers(DS_LEAF)).toEqual([
      './cadCorePrimitiveTypes',
      './cadSurfaceModelStyleTypes',
      './grading/gradingGroupTypes',
    ]);
    expect(importBindingsBySpecifier(DS_LEAF)).toEqual([
      { specifier: './cadCorePrimitiveTypes', names: ['CadLayerId'] },
      { specifier: './cadSurfaceModelStyleTypes', names: ['CadSurfacePurpose'] },
      { specifier: './grading/gradingGroupTypes', names: ['CadGradingGroupResult'] },
    ]);
  });

  it('transpiled emit is marker-only for the hub and both leaves', () => {
    expect(strippedEmit(HUB)).toBe('export {};');
    expect(strippedEmit(FL_LEAF)).toBe('export {};');
    expect(strippedEmit(DS_LEAF)).toBe('export {};');
    expect(createHash('sha256').update(strippedEmit(HUB)).digest('hex'))
      .toBe(EXPECTED_HUB_EMIT_SHA256);
  });
});

describe('STRUCT-241.12 feature-line/design regression neighbours covered by import existence', () => {
  it.each([
    'cad_feature_line_20a',
    'cad_feature_line_commands_20a',
    'cad_feature_line_geometry_20a',
    'cad_feature_line_snapshot_20a',
    'cad_feature_line_20a_export',
    'cad_surface_feature_line_breakline_20a',
    'cad_grading_course_20b',
    'cad_grading_persist_20b',
    'cad_grading_group_commands_20c',
    'cad_grading_group_model_20c',
    'cad_grading_group_persist_20c',
    'cad_grading_command_types_1956',
    'cad_design_surface_20d',
    'cad_design_patch_20d',
    'cad_design_patch_apply_20d',
    'cad_design_patch_preflight',
    'cad_blocks_transactions',
    'cad_persistence_and_entities',
    'blank_project_persistence_roundtrip',
    'cad_shell_registry',
    'cad_surface_definition_model_style_type_leaves_24110',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });

  it('tsx neighbours exist', () => {
    for (const name of ['cad_feature_line_ui_20a', 'cad_design_workflow_ui_20d']) {
      expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.tsx`))).toBe(true);
    }
  });

  it('feature-line and design-surface command engine modules exist', () => {
    for (const relative of [
      'src/engine/cad/cadTransactionsFeatureLineCommands.ts',
      'src/engine/cad/cadTransactionsDesignSurfaceCommands.ts',
    ]) {
      expect(fs.existsSync(abs(relative)), `engine module missing: ${relative}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.12 extraction is type-only: +2 nodes / +5 type edges (+7 new type
// edges — 2 hub imports + 5 leaf out-edges — minus 2 retired hub edges to
// cadFeatureLineCreate + gradingGroupTypes; the CadSurfacePurpose barrel edge
// via ./cadTypes stays because the hub still imports from that barrel).
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

describe('STRUCT-241.12 CAD+F2F graph pins', () => {
  // First cold graph parse in this file; allow headroom under full-suite CI contention.
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // Post-241.11 baseline 503 / 2465; the two type-only leaves add +2 nodes
    // and +5 type edges (feature-line leaf: 2 out-edges + hub import;
    // design-surface leaf: 3 out-edges + hub import; 2 retired hub edges to
    // cadFeatureLineCreate + gradingGroupTypes). STRUCT-241.13 roll-forward:
    // +2 / +5 (alignment leaf: 1 out-edge + hub import; parcel leaf:
    // 2 out-edges + hub import; no retired module edge).
    // STRUCT-241.14 roll-forward: +2 / +3 (primitive-draw leaf: 2
    // out-edges + hub import; basic-curve leaf: 0 out-edges + hub import;
    // 1 retired hub tangent-solver edge).
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
    const flLeaf = path.resolve(FL_LEAF);
    const dsLeaf = path.resolve(DS_LEAF);
    expect(graph.edges.filter((edge) => edge.from === flLeaf).map((edge) => edge.specifier).sort()).toEqual([
      './cadCorePrimitiveTypes',
      './cadFeatureLineCreate',
    ]);
    expect(graph.edges.filter((edge) => edge.from === dsLeaf).map((edge) => edge.specifier).sort()).toEqual([
      './cadCorePrimitiveTypes',
      './cadSurfaceModelStyleTypes',
      './grading/gradingGroupTypes',
    ]);
    expect(graph.edges.filter((edge) => edge.to === flLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: flLeaf,
        specifier: './cadTransactionsFeatureLineCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter((edge) => edge.to === dsLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: dsLeaf,
        specifier: './cadTransactionsDesignSurfaceCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter(
      (edge) => (edge.from === flLeaf || edge.to === flLeaf || edge.from === dsLeaf || edge.to === dsLeaf)
        && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('retires the two hub edges into the extracted source modules', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    for (const target of [
      path.resolve(path.join(CAD_DIR, 'cadFeatureLineCreate.ts')),
      path.resolve(path.join(CAD_DIR, 'grading', 'gradingGroupTypes.ts')),
    ]) {
      expect(graph.edges.filter((edge) => edge.from === hub && edge.to === target)).toEqual([]);
    }
    // The ./cadTypes barrel edge stays: the hub still imports identities and
    // project types from it (CadSurfacePurpose was only one of many names).
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadTypes.ts')),
    ).length).toBeGreaterThan(0);
  });

  it('has no leaf back-edge to the transaction hub or command executors', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    for (const leaf of [path.resolve(FL_LEAF), path.resolve(DS_LEAF)]) {
      for (const target of [
        hub,
        path.resolve(path.join(CAD_DIR, 'cadTransactions.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsFeatureLineCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsDesignSurfaceCommands.ts')),
      ]) {
        expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
      }
      expect(graph.edges.filter((edge) => edge.from === leaf && edge.kind !== 'type')).toEqual([]);
    }
  });
});

describe('STRUCT-241.12 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // Post-241.11 baseline 1675 / 7576; the two leaves add the same +2 / +5
    // (every 241.12 edge resolves inside `src`). STRUCT-241.13 roll-forward:
    // +2 / +5 (every 241.13 edge resolves inside `src`). STRUCT-241.14
    // roll-forward: +2 / +3 (every 241.14 edge resolves inside `src`).
    expect(graph.nodes.length).toBe(1681);
    expect(graph.edges.length).toBe(7589);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4444,
      uniqPairs: 4385,
      sha: '415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448',
    });
  }, 120_000);
});

describe('STRUCT-241.12 negative controls (in-memory mutations only)', () => {
  const flSource = (): string => fs.readFileSync(FL_LEAF, 'utf8');
  const dsSource = (): string => fs.readFileSync(DS_LEAF, 'utf8');
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('fails the shape pin when the feature-line elevation becomes optional', () => {
    const mutated = flSource().replace(
      '      elevation: FeatureLineElevationMethod;',
      '      elevation?: FeatureLineElevationMethod;',
    );
    expect(mutated).not.toBe(flSource());
    const create = variantShapesFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS)
      .find((v) => v.key === "'FEATURELINE'|'FEATURELINECREATE'")!;
    expect(() => expect(create.props).toEqual(EXPECTED_FEATURELINE_SHAPES["'FEATURELINE'|'FEATURELINECREATE'"]!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when the elevation method type is swapped', () => {
    const mutated = flSource().replace(
      '      elevation: FeatureLineElevationMethod;',
      '      elevation: string;',
    );
    expect(mutated).not.toBe(flSource());
    const create = variantShapesFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS)
      .find((v) => v.key === "'FEATURELINE'|'FEATURELINECREATE'")!;
    expect(() => expect(create.props).toEqual(EXPECTED_FEATURELINE_SHAPES["'FEATURELINE'|'FEATURELINECREATE'"]!.map(pinShape)))
      .toThrow();
  });

  it('fails the descriptor pin when a double-key object is split to one literal', () => {
    const mutated = flSource().replace(
      "      key: 'FEATURELINE' | 'FEATURELINECREATE';",
      "      key: 'FEATURELINE';",
    );
    expect(mutated).not.toBe(flSource());
    const descriptors = leafMemberDescriptorsFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS);
    expect(descriptors).toHaveLength(11);
    expect(() => expect(descriptors).toEqual([...EXPECTED_FEATURELINE_DESCRIPTORS])).toThrow();
  });

  it('fails the descriptor pin when the second double-key object loses FLSETZ', () => {
    const mutated = flSource().replace(
      "      key: 'FEATURELINEELEV' | 'FLSETZ';",
      "      key: 'FEATURELINEELEV';",
    );
    expect(mutated).not.toBe(flSource());
    const descriptors = leafMemberDescriptorsFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS);
    expect(() => expect(descriptors).toEqual([...EXPECTED_FEATURELINE_DESCRIPTORS])).toThrow();
  });

  it('fails the shape pin when FLGRADE mode loses a literal', () => {
    const mutated = flSource().replace(
      "      mode?: 'set-end-only' | 'grade-all-intermediates';",
      "      mode?: 'set-end-only';",
    );
    expect(mutated).not.toBe(flSource());
    const grade = variantShapesFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS)
      .find((v) => v.key === 'FLGRADE')!;
    expect(() => expect(grade.props).toEqual(EXPECTED_FEATURELINE_SHAPES.FLGRADE!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when FLGRADE gradePercent becomes optional', () => {
    const mutated = flSource().replace(
      '      gradePercent: number;',
      '      gradePercent?: number;',
    );
    expect(mutated).not.toBe(flSource());
    const grade = variantShapesFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS)
      .find((v) => v.key === 'FLGRADE')!;
    expect(() => expect(grade.props).toEqual(EXPECTED_FEATURELINE_SHAPES.FLGRADE!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when FLINSERTVERTEX courseIndex/station is swapped to vertexIndex', () => {
    const mutated = flSource().replace(
      '      courseIndex: number;\n      station: number;',
      '      vertexIndex: number;',
    );
    expect(mutated).not.toBe(flSource());
    const insert = variantShapesFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS)
      .find((v) => v.key === 'FLINSERTVERTEX')!;
    expect(() => expect(insert.props).toEqual(EXPECTED_FEATURELINE_SHAPES.FLINSERTVERTEX!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when FLDELETEVERTEX vertexIndex is swapped to courseIndex/station', () => {
    const mutated = flSource().replace(
      '      vertexIndex: number;',
      '      courseIndex: number;\n      station: number;',
    );
    expect(mutated).not.toBe(flSource());
    const del = variantShapesFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS)
      .find((v) => v.key === 'FLDELETEVERTEX')!;
    expect(() => expect(del.props).toEqual(EXPECTED_FEATURELINE_SHAPES.FLDELETEVERTEX!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when the breakline loses its entity reference', () => {
    const mutated = flSource().replace(
      "      key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE';\n      surfaceId: string;\n      entityId: CadEntityId;",
      "      key: 'SURFACE_ADD_FEATURE_LINE_BREAKLINE';\n      surfaceId: string;",
    );
    expect(mutated).not.toBe(flSource());
    const breakline = variantShapesFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS)
      .find((v) => v.key === 'SURFACE_ADD_FEATURE_LINE_BREAKLINE')!;
    expect(() => expect(breakline.props).toEqual(EXPECTED_FEATURELINE_SHAPES.SURFACE_ADD_FEATURE_LINE_BREAKLINE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when DESIGNSURFACE expectedRevision becomes optional', () => {
    const mutated = dsSource().replace(
      '      expectedRevision: string;\n      /** Session-owned CURRENT assertion (see SURFBAKE). */\n      sessionCurrent?: boolean;\n      layerId?: CadLayerId;',
      '      expectedRevision?: string;\n      /** Session-owned CURRENT assertion (see SURFBAKE). */\n      sessionCurrent?: boolean;\n      layerId?: CadLayerId;',
    );
    expect(mutated).not.toBe(dsSource());
    const design = variantShapesFromSource(parseText('m.ts', mutated), 'm', DS_ALIAS)
      .find((v) => v.key === 'DESIGNSURFACE')!;
    expect(() => expect(design.props).toEqual(EXPECTED_DESIGN_SHAPES.DESIGNSURFACE!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when DESIGNAPPLY sessionCurrent becomes required', () => {
    const mutated = dsSource().replace(
      "      patchExpectedRevision: string;\n      /** Session-owned CURRENT assertion (see SURFBAKE). */\n      sessionCurrent?: boolean;",
      "      patchExpectedRevision: string;\n      /** Session-owned CURRENT assertion (see SURFBAKE). */\n      sessionCurrent: boolean;",
    );
    expect(mutated).not.toBe(dsSource());
    const apply = variantShapesFromSource(parseText('m.ts', mutated), 'm', DS_ALIAS)
      .find((v) => v.key === 'DESIGNAPPLY')!;
    expect(() => expect(apply.props).toEqual(EXPECTED_DESIGN_SHAPES.DESIGNAPPLY!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when SURFPURPOSE purpose loses its nullability', () => {
    const mutated = dsSource().replace(
      '      purpose?: CadSurfacePurpose | null;',
      '      purpose?: CadSurfacePurpose;',
    );
    expect(mutated).not.toBe(dsSource());
    const purpose = variantShapesFromSource(parseText('m.ts', mutated), 'm', DS_ALIAS)
      .find((v) => v.key === 'SURFPURPOSE')!;
    expect(() => expect(purpose.props).toEqual(EXPECTED_DESIGN_SHAPES.SURFPURPOSE!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when DESIGNPATCH styleId loses its nullability', () => {
    const mutated = dsSource().replace(
      "      name?: string;\n      layerId?: CadLayerId;\n      /** Undefined = keep the group style; null = clear. */\n      styleId?: string | null;\n    };",
      "      name?: string;\n      layerId?: CadLayerId;\n      /** Undefined = keep the group style; null = clear. */\n      styleId?: string;\n    };",
    );
    expect(mutated).not.toBe(dsSource());
    const patch = variantShapesFromSource(parseText('m.ts', mutated), 'm', DS_ALIAS)
      .find((v) => v.key === 'DESIGNPATCH')!;
    expect(() => expect(patch.props).toEqual(EXPECTED_DESIGN_SHAPES.DESIGNPATCH!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when DESIGNPATCH result is swapped off CadGradingGroupResult', () => {
    const mutated = dsSource().replace(
      '      result: CadGradingGroupResult;',
      '      result: unknown;',
    );
    expect(mutated).not.toBe(dsSource());
    const patch = variantShapesFromSource(parseText('m.ts', mutated), 'm', DS_ALIAS)
      .find((v) => v.key === 'DESIGNPATCH')!;
    expect(() => expect(patch.props).toEqual(EXPECTED_DESIGN_SHAPES.DESIGNPATCH!.map(pinShape))).toThrow();
  });

  it('fails the JSDoc pin when the DESIGNPATCH snapshot note is dropped', () => {
    const mutated = dsSource().replace(
      '      /** Cached CURRENT result snapshot (never recomputed here). */\n',
      '',
    );
    expect(mutated).not.toBe(dsSource());
    const patch = variantShapesFromSource(parseText('m.ts', mutated), 'm', DS_ALIAS)
      .find((v) => v.key === 'DESIGNPATCH')!;
    expect(patch.comments).toEqual(['/** Undefined = keep the group style; null = clear. */']);
    expect(() => expect(patch.comments).toEqual([
      '/** Cached CURRENT result snapshot (never recomputed here). */',
      '/** Undefined = keep the group style; null = clear. */',
    ])).toThrow();
  });

  it('fails the comment guard when the Phase 20A section note goes missing', () => {
    const mutated = flSource().replace(`${PHASE_20A_COMMENT}\n`, '');
    expect(mutated).not.toBe(flSource());
    expect(mutated).not.toContain(PHASE_20A_COMMENT);
    expect(() => expect(mutated).toContain(PHASE_20A_COMMENT)).toThrow();
  });

  it('fails the comment guard when the Phase 20D section note goes missing', () => {
    const mutated = dsSource().replace(`${PHASE_20D_COMMENT}\n`, '');
    expect(mutated).not.toBe(dsSource());
    expect(mutated).not.toContain(PHASE_20D_COMMENT);
    expect(() => expect(mutated).toContain(PHASE_20D_COMMENT)).toThrow();
  });

  it('fails the splice guard when the hub drops one alias splice', () => {
    const source = hubSource();
    const refLine = `  | ${FL_ALIAS}\n`;
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
      .replace(`  | ${FL_ALIAS}\n`, '__SWAP_FL__\n')
      .replace(`  | ${DS_ALIAS}\n`, `  | ${FL_ALIAS}\n`)
      .replace('__SWAP_FL__\n', `  | ${DS_ALIAS}\n`);
    expect(mutated).not.toBe(source);
    const seq = hubMemberSequence(parseText('mutated-hub.ts', mutated));
    const analysis = seq.findIndex((m) => m.label === 'CadAnalysisCommandPayload');
    expect(() => expect(seq[analysis + 1]).toEqual({ kind: 'ref', label: FL_ALIAS })).toThrow();
  });

  it('fails the ordering guard when feature-line variants reorder', () => {
    const source = flSource();
    const shapes = variantShapesFromSource(parseText('leaf.ts', source), 'leaf', FL_ALIAS);
    const grade = shapes.find((v) => v.key === 'FLGRADE')!.text;
    const reverse = shapes.find((v) => v.key === 'FLREVERSE')!.text;
    const mutated = source.replace(grade, '__SWAP__').replace(reverse, grade).replace('__SWAP__', reverse);
    expect(mutated).not.toBe(source);
    const swapped = variantShapesFromSource(parseText('m.ts', mutated), 'm', FL_ALIAS);
    expect(swapped.map((v) => v.key)).toHaveLength(11);
    expect(() => expect(swapped.map((v) => v.key)).toEqual([...EXPECTED_FEATURELINE_DESCRIPTORS])).toThrow();
  });

  it('fails the acyclicity guard on a synthetic TYPE back-edge to the hub', () => {
    const mutated = `${flSource()}\nimport type { CadCommand } from './cadTransactions.types';\ntype BackEdge = CadCommand;\n`;
    expect(mutated).not.toBe(flSource());
    // Extract the specifier list from the MUTATED text (not the pristine
    // file): the back-edge must be visible to the same helper the allowlist
    // pin uses, and the allowlist pin must reject it.
    const mutatedSpecs = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(allImportSpecifiers(FL_LEAF)).not.toContain('./cadTransactions.types');
    expect(mutatedSpecs).toContain('./cadTransactions.types');
    expect(() => expect(mutatedSpecs).toEqual(allImportSpecifiers(FL_LEAF))).toThrow();
  });

  it('fails the type-only guard on a synthetic VALUE import from a runtime module', () => {
    const mutated = dsSource().replace(
      "import type { CadSurfacePurpose } from './cadSurfaceModelStyleTypes';",
      "import { CadSurfacePurpose } from './cadSurfaceModelStyleTypes';",
    );
    expect(mutated).not.toBe(dsSource());
    const runtime = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt))
      .filter((stmt) => stmt.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword)
      .map((stmt) => stmt.moduleSpecifier.getText());
    expect(runtime).toContain("'./cadSurfaceModelStyleTypes'");
    expect(() => expect(runtime).toEqual([])).toThrow();
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(FL_LEAF, 'utf8')).toBe(flSource());
    expect(fs.readFileSync(DS_LEAF, 'utf8')).toBe(dsSource());
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
