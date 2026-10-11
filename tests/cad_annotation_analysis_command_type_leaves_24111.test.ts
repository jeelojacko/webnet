/**
 * STRUCT-241.11 — CAD annotation + analysis command payload type leaves.
 *
 * Pins `src/engine/cad/cadTransactionsAnnotationCommandTypes.ts`, which
 * extracts the eleven Phase 18O annotation command payloads out of the
 * `CadCommand` union as one public union, and
 * `src/engine/cad/cadTransactionsAnalysisCommandTypes.ts`, which extracts
 * the eight Phase 18U analysis map/legend payloads as one public union, so
 * the hub splices both back into their original contiguous positions:
 *  - `CadAnnotationCommandPayload` (11): CREATE_MTEXT, CREATE_LEADER,
 *    CREATE_DIMENSION, CREATE_BEARING_LABEL, CREATE_CURVE_LABEL,
 *    UPDATE_DIMENSION_PLACEMENT, REATTACH_ANNOTATION, SET_TEXT_OVERRIDE,
 *    CLEAR_TEXT_OVERRIDE, SET_ANNOTATION_SCALE, ANNOTATION_COMMIT — between
 *    CadBlockDefinitionCommandPayload and the Phase 18U group.
 *  - `CadAnalysisCommandPayload` (8): ANALYSIS_MAP_CREATE,
 *    ANALYSIS_MAP_UPDATE_BANDS, ANALYSIS_MAP_UPDATE_APPEARANCE,
 *    ANALYSIS_MAP_DELETE, ANALYSIS_LEGEND_CREATE, ANALYSIS_LEGEND_UPDATE,
 *    ANALYSIS_LEGEND_MOVE, ANALYSIS_LEGEND_DELETE — between the annotation
 *    group and the Phase 20A FEATURELINE group.
 *
 * Covers: hand-transcribed pre-refactor `Base*` shapes + AST property pins
 * (incl. the two annotation JSDoc notes, the nullable UPDATE textPoint, the
 * four REATTACH slots, and the Phase 18U section comment); per-key
 * `Extract<CadCommand>` equivalence in both directions; optionality
 * precision; the byte-identical `CadCommandKey` (248 literals / 241 unique /
 * 7 legacy duplicate BLOCK keys kept); both splice sentinels + 89 top-level
 * (241.11: 133->116; 241.12 roll-forward: 116->102; 241.13 roll-forward:
 * 102->89) + 168 flattened; public
 * transaction types; type-only emit pins;
 * CAD+F2F and full-`src` graph pins with an explicit +2 node / +5 type-edge
 * roll-forward allowlist (241.11: +2/+6 with +10 new type edges and -4
 * retired hub edges; 241.12: +2/+5 with +7 new type edges and -2 retired hub
 * edges); in-memory negative
 * controls; and annotation/analysis regression neighbours by import
 * existence only.
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
import type { CadEntityId, CadLayerId, CadTextStyleId } from '../src/engine/cad/cadCorePrimitiveTypes';
import type {
  CadDimensionKind,
  CadMTextAttachment,
} from '../src/engine/cad/cadAnnotationEntityStyleTypes';
import type { CadAnnotationAnchor } from '../src/engine/cad/annotation/cadAnnotationAnchorTypes';
import type { CadProject } from '../src/engine/cad/cadTypes';
import type {
  CadAnalysisBand,
  CadAnalysisLegend,
  CadAnalysisSource,
} from '../src/engine/cad/cadAnalysisTypes';
import type { CadAnalysisAppearancePatch } from '../src/engine/cad/cadAnalysisMaps';
import type { CadAnalysisLegendPatch } from '../src/engine/cad/cadAnalysisLegends';
import type { CadAnnotationCommandPayload } from '../src/engine/cad/cadTransactionsAnnotationCommandTypes';
import type { CadAnalysisCommandPayload } from '../src/engine/cad/cadTransactionsAnalysisCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const ANN_LEAF = path.join(CAD_DIR, 'cadTransactionsAnnotationCommandTypes.ts');
const ANL_LEAF = path.join(CAD_DIR, 'cadTransactionsAnalysisCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');
const ANN_ALIAS = 'CadAnnotationCommandPayload';
const ANL_ALIAS = 'CadAnalysisCommandPayload';

const abs = (relative: string): string => path.join(REPO_ROOT, relative);
const relPosix = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// TypeScript compiler helpers (same shape as the STRUCT-241.2 guard).
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

/**
 * STRUCT-241.12 roll-forward: one descriptor per object member of the alias
 * union, in declaration order. Multi-literal keys keep their normalized
 * union text as a single descriptor, so expanding the feature-line leaf
 * (11 members incl. 2 double-key objects) + design-surface leaf (5) keeps
 * the exact 168 effective members without widening/splitting semantics.
 */
const unionMemberDescriptorsFromSource = (
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
    const keyType = keyPropOf(flat)?.type;
    if (!keyType) throw new Error(`${label}: ${aliasName} member without a key`);
    out.push(ts.isLiteralTypeNode(keyType) && ts.isStringLiteral(keyType.literal) ? keyType.literal.text : norm(keyType.getText()));
  }
  return out;
};

const unionMemberDescriptors = (file: string, label: string, aliasName: string): string[] =>
  unionMemberDescriptorsFromSource(parse(file), label, aliasName);

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

/** Flattened effective member keys, resolving the extracted leaf unions. */
const hubFlattenedKeys = (source?: ts.SourceFile): string[] => {
  const hub = source ?? parse(HUB);
  const annotation = unionKeysInOrder(ANN_LEAF, 'annotation', ANN_ALIAS);
  const analysis = unionKeysInOrder(ANL_LEAF, 'analysis', ANL_ALIAS);
  // STRUCT-241.12 roll-forward: expand the feature-line (11 members, both
  // double-key objects kept whole) + design-surface (5) leaves.
  const featureline = unionMemberDescriptors(
    abs('src/engine/cad/cadTransactionsFeatureLineCommandTypes.ts'), 'featureline', 'CadFeatureLineCommandPayload');
  const designsurface = unionMemberDescriptors(
    abs('src/engine/cad/cadTransactionsDesignSurfaceCommandTypes.ts'), 'designsurface', 'CadDesignSurfaceCommandPayload');
  // STRUCT-241.13 roll-forward: expand the alignment (6) + parcel-
  // construction (9) leaves (all single-keyed, no widening).
  const alignment = unionMemberDescriptors(
    abs('src/engine/cad/cadTransactionsAlignmentCommandTypes.ts'), 'alignment', 'CadAlignmentCommandPayload');
  const parcelConstruction = unionMemberDescriptors(
    abs('src/engine/cad/cadTransactionsParcelConstructionCommandTypes.ts'), 'parcel', 'CadParcelConstructionCommandPayload');
  // STRUCT-241.14 roll-forward: expand the primitive-draw (13) +
  // basic-curve (6) leaves (all single-keyed, no widening).
  const primitive = unionMemberDescriptors(
    abs('src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes.ts'), 'primitive', 'CadPrimitiveDrawCommandPayload');
  const basiccurve = unionMemberDescriptors(
    abs('src/engine/cad/cadTransactionsBasicCurveCommandTypes.ts'), 'basiccurve', 'CadBasicCurveCommandPayload');
  // STRUCT-241.15 roll-forward: expand the planar-transform (6) +
  // geometry-edit (7) leaves (all single-keyed, no widening).
  const planar = unionMemberDescriptors(
    abs('src/engine/cad/cadTransactionsPlanarTransformCommandTypes.ts'), 'planar', 'CadPlanarTransformCommandPayload');
  const geometryedit = unionMemberDescriptors(
    abs('src/engine/cad/cadTransactionsGeometryEditCommandTypes.ts'), 'geometryedit', 'CadGeometryEditCommandPayload');
  const blockPrelude = unionKeysInOrder(
    abs('src/engine/cad/cadTransactionsBlockCommandTypes.ts'), 'block', 'CadBlockPreludeCommandPayload');
  const blockDefinition = unionKeysInOrder(
    abs('src/engine/cad/cadTransactionsBlockCommandTypes.ts'), 'block', 'CadBlockDefinitionCommandPayload');
  const layer = unionKeysInOrder(
    abs('src/engine/cad/cadTransactionsLayerCommandTypes.ts'), 'layer', 'CadLayerCommandPayload');
  const survey = unionKeysInOrder(
    abs('src/engine/cad/cadTransactionsSurveyCommandTypes.ts'), 'survey', 'CadSurveyCommandPayload');
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
      if (name === ANN_ALIAS) members.push(...annotation);
      else if (name === ANL_ALIAS) members.push(...analysis);
      else if (name === 'CadFeatureLineCommandPayload') members.push(...featureline);
      else if (name === 'CadDesignSurfaceCommandPayload') members.push(...designsurface);
      else if (name === 'CadAlignmentCommandPayload') members.push(...alignment);
      else if (name === 'CadParcelConstructionCommandPayload') members.push(...parcelConstruction);
      else if (name === 'CadPrimitiveDrawCommandPayload') members.push(...primitive);
      else if (name === 'CadBasicCurveCommandPayload') members.push(...basiccurve);
      else if (name === 'CadPlanarTransformCommandPayload') members.push(...planar);
      else if (name === 'CadGeometryEditCommandPayload') members.push(...geometryedit);
      else if (name === 'CadBlockPreludeCommandPayload') members.push(...blockPrelude);
      else if (name === 'CadBlockDefinitionCommandPayload') members.push(...blockDefinition);
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
// 0ce916c6 (hub annotation block ~line 810, analysis block ~line 894). They
// import no leaf type, so leaf drift cannot move both sides of an assertion.
// ---------------------------------------------------------------------------

type BaseCreateMText = {
  key: 'CREATE_MTEXT';
  x: number;
  y: number;
  text: string;
  textStyleId?: CadTextStyleId;
  rotationDeg?: number;
  attachment?: CadMTextAttachment;
};

type BaseCreateLeader = {
  key: 'CREATE_LEADER';
  arrowAnchor: CadAnnotationAnchor;
  vertices: { x: number; y: number }[];
  text: string;
  leaderStyleId?: string;
  textStyleId?: CadTextStyleId;
  textAttachment?: CadMTextAttachment;
};

type BaseCreateDimension = {
  key: 'CREATE_DIMENSION';
  dimensionKind: CadDimensionKind;
  anchors: CadAnnotationAnchor[];
  orientation?: 'horizontal' | 'vertical' | 'aligned';
  dimLinePoint: { x: number; y: number };
  textPoint?: { x: number; y: number };
  dimensionStyleId?: string;
  textOverride?: string;
};

type BaseCreateBearingLabel = {
  key: 'CREATE_BEARING_LABEL';
  sourceEntityId: CadEntityId;
  labelStyleId?: string;
  offset?: { x: number; y: number };
  side?: 'left' | 'right' | 'auto';
  manualTextOverride?: string;
};

type BaseCreateCurveLabel = {
  key: 'CREATE_CURVE_LABEL';
  sourceEntityId: CadEntityId;
  labelStyleId?: string;
  offset?: { x: number; y: number };
  manualTextOverride?: string;
};

type BaseUpdateDimensionPlacement = {
  key: 'UPDATE_DIMENSION_PLACEMENT';
  entityId: CadEntityId;
  dimLinePoint?: { x: number; y: number };
  textPoint?: { x: number; y: number } | null;
};

type BaseReattachAnnotation = {
  key: 'REATTACH_ANNOTATION';
  entityId: CadEntityId;
  slot: 'leader-arrow' | 'dimension-anchor' | 'dimension-def-point-1' | 'dimension-def-point-2';
  index?: number;
  /** Omitted = convert the slot to a frozen point at its resolved position. */
  anchor?: CadAnnotationAnchor;
};

type BaseSetTextOverride = { key: 'SET_TEXT_OVERRIDE'; entityId: CadEntityId; text: string };
type BaseClearTextOverride = { key: 'CLEAR_TEXT_OVERRIDE'; entityId: CadEntityId };
type BaseSetAnnotationScale = { key: 'SET_ANNOTATION_SCALE'; scaleDenominator: number };

type BaseAnnotationCommit = {
  key: 'ANNOTATION_COMMIT';
  /** Validated project from the annotation UI op applier (hook-owned). */
  project: CadProject;
  label: string;
};

type BaseAnalysisMapCreate = {
  key: 'ANALYSIS_MAP_CREATE';
  name?: string;
  source: CadAnalysisSource;
  bands: CadAnalysisBand[];
  layerId?: CadLayerId;
  opacity?: number;
  description?: string;
};

type BaseAnalysisMapUpdateBands = {
  key: 'ANALYSIS_MAP_UPDATE_BANDS';
  analysisId: string;
  bands?: CadAnalysisBand[];
  source?: CadAnalysisSource;
};

type BaseAnalysisMapUpdateAppearance = {
  key: 'ANALYSIS_MAP_UPDATE_APPEARANCE';
  analysisId: string;
  patch: CadAnalysisAppearancePatch;
};

type BaseAnalysisMapDelete = {
  key: 'ANALYSIS_MAP_DELETE';
  analysisId: string;
  /** True removes the map + every referencing legend atomically. */
  deleteLegendsToo?: boolean;
};

type BaseAnalysisLegendCreate = { key: 'ANALYSIS_LEGEND_CREATE'; legend: CadAnalysisLegend };

type BaseAnalysisLegendUpdate = {
  key: 'ANALYSIS_LEGEND_UPDATE';
  legendId: string;
  patch: CadAnalysisLegendPatch;
};

type BaseAnalysisLegendMove = {
  key: 'ANALYSIS_LEGEND_MOVE';
  legendId: string;
  x: number;
  y: number;
};

type BaseAnalysisLegendDelete = { key: 'ANALYSIS_LEGEND_DELETE'; legendId: string };

const EXPECTED_ANNOTATION_KEYS = [
  'CREATE_MTEXT', 'CREATE_LEADER', 'CREATE_DIMENSION', 'CREATE_BEARING_LABEL',
  'CREATE_CURVE_LABEL', 'UPDATE_DIMENSION_PLACEMENT', 'REATTACH_ANNOTATION',
  'SET_TEXT_OVERRIDE', 'CLEAR_TEXT_OVERRIDE', 'SET_ANNOTATION_SCALE', 'ANNOTATION_COMMIT',
] as const;

const EXPECTED_ANALYSIS_KEYS = [
  'ANALYSIS_MAP_CREATE', 'ANALYSIS_MAP_UPDATE_BANDS', 'ANALYSIS_MAP_UPDATE_APPEARANCE',
  'ANALYSIS_MAP_DELETE', 'ANALYSIS_LEGEND_CREATE', 'ANALYSIS_LEGEND_UPDATE',
  'ANALYSIS_LEGEND_MOVE', 'ANALYSIS_LEGEND_DELETE',
] as const;

/** The seven `CadCommandKey` literals that legitimately repeat (kept, never fixed). */
const EXPECTED_DUPLICATE_BLOCK_KEYS = [
  'BLOCK_CREATE', 'BLOCK_INSERT', 'BLOCK_EXPLODE', 'BLOCK_REDEFINE',
  'BLOCK_RENAME', 'BLOCK_DUPLICATE', 'BLOCK_DELETE',
] as const;

const EXPECTED_ANNOTATION_SHAPES: Record<string, string[]> = {
  CREATE_MTEXT: [
    "key: 'CREATE_MTEXT'", 'x: number', 'y: number', 'text: string',
    'textStyleId?: CadTextStyleId', 'rotationDeg?: number', 'attachment?: CadMTextAttachment',
  ],
  CREATE_LEADER: [
    "key: 'CREATE_LEADER'", 'arrowAnchor: CadAnnotationAnchor',
    'vertices: { x: number; y: number }[]', 'text: string', 'leaderStyleId?: string',
    'textStyleId?: CadTextStyleId', 'textAttachment?: CadMTextAttachment',
  ],
  CREATE_DIMENSION: [
    "key: 'CREATE_DIMENSION'", 'dimensionKind: CadDimensionKind',
    'anchors: CadAnnotationAnchor[]', "orientation?: 'horizontal' | 'vertical' | 'aligned'",
    'dimLinePoint: { x: number; y: number }', 'textPoint?: { x: number; y: number }',
    'dimensionStyleId?: string', 'textOverride?: string',
  ],
  CREATE_BEARING_LABEL: [
    "key: 'CREATE_BEARING_LABEL'", 'sourceEntityId: CadEntityId', 'labelStyleId?: string',
    'offset?: { x: number; y: number }', "side?: 'left' | 'right' | 'auto'",
    'manualTextOverride?: string',
  ],
  CREATE_CURVE_LABEL: [
    "key: 'CREATE_CURVE_LABEL'", 'sourceEntityId: CadEntityId', 'labelStyleId?: string',
    'offset?: { x: number; y: number }', 'manualTextOverride?: string',
  ],
  UPDATE_DIMENSION_PLACEMENT: [
    "key: 'UPDATE_DIMENSION_PLACEMENT'", 'entityId: CadEntityId',
    'dimLinePoint?: { x: number; y: number }', 'textPoint?: { x: number; y: number } | null',
  ],
  REATTACH_ANNOTATION: [
    "key: 'REATTACH_ANNOTATION'", 'entityId: CadEntityId',
    "slot: 'leader-arrow' | 'dimension-anchor' | 'dimension-def-point-1' | 'dimension-def-point-2'",
    'index?: number', 'anchor?: CadAnnotationAnchor',
  ],
  SET_TEXT_OVERRIDE: ["key: 'SET_TEXT_OVERRIDE'", 'entityId: CadEntityId', 'text: string'],
  CLEAR_TEXT_OVERRIDE: ["key: 'CLEAR_TEXT_OVERRIDE'", 'entityId: CadEntityId'],
  SET_ANNOTATION_SCALE: ["key: 'SET_ANNOTATION_SCALE'", 'scaleDenominator: number'],
  ANNOTATION_COMMIT: ["key: 'ANNOTATION_COMMIT'", 'project: CadProject', 'label: string'],
};

const EXPECTED_ANALYSIS_SHAPES: Record<string, string[]> = {
  ANALYSIS_MAP_CREATE: [
    "key: 'ANALYSIS_MAP_CREATE'", 'name?: string', 'source: CadAnalysisSource',
    'bands: CadAnalysisBand[]', 'layerId?: CadLayerId', 'opacity?: number', 'description?: string',
  ],
  ANALYSIS_MAP_UPDATE_BANDS: [
    "key: 'ANALYSIS_MAP_UPDATE_BANDS'", 'analysisId: string',
    'bands?: CadAnalysisBand[]', 'source?: CadAnalysisSource',
  ],
  ANALYSIS_MAP_UPDATE_APPEARANCE: [
    "key: 'ANALYSIS_MAP_UPDATE_APPEARANCE'", 'analysisId: string',
    'patch: CadAnalysisAppearancePatch',
  ],
  ANALYSIS_MAP_DELETE: [
    "key: 'ANALYSIS_MAP_DELETE'", 'analysisId: string', 'deleteLegendsToo?: boolean',
  ],
  ANALYSIS_LEGEND_CREATE: ["key: 'ANALYSIS_LEGEND_CREATE'", 'legend: CadAnalysisLegend'],
  ANALYSIS_LEGEND_UPDATE: [
    "key: 'ANALYSIS_LEGEND_UPDATE'", 'legendId: string', 'patch: CadAnalysisLegendPatch',
  ],
  ANALYSIS_LEGEND_MOVE: [
    "key: 'ANALYSIS_LEGEND_MOVE'", 'legendId: string', 'x: number', 'y: number',
  ],
  ANALYSIS_LEGEND_DELETE: ["key: 'ANALYSIS_LEGEND_DELETE'", 'legendId: string'],
};

/** Per-variant JSDoc/comment counts in the leaves (all other variants carry none). */
const EXPECTED_ANNOTATION_COMMENT_COUNTS: Record<string, number> = {
  REATTACH_ANNOTATION: 1,
  ANNOTATION_COMMIT: 1,
};

const EXPECTED_ANALYSIS_COMMENT_COUNTS: Record<string, number> = {
  ANALYSIS_MAP_DELETE: 1,
};

/** Raw SHA256 of the `CadCommandKey` alias slice (unchanged since STRUCT-241.2). */
const EXPECTED_CAD_COMMAND_KEY_RAW_SHA256 =
  '4ff8cd4aa25d062cf2abb729482ec4145cfc50098759327e992dd3f4beca1502';

/** Original Phase 18U section documentation, preserved at the analysis leaf. */
const PHASE_18U_COMMENT_LINES = [
  '// Phase 18U — analysis maps + legends (definitions only; derived band',
  '// quantities are session-only and never dirty the drawing).',
] as const;

// Compile-time leaf <-> hub round trip (enforced by project typecheck).
const leafToHub = (payload: CadAnnotationCommandPayload | CadAnalysisCommandPayload): CadCommand => payload;

// ---------------------------------------------------------------------------

describe('STRUCT-241.11 leaf presence and key order', () => {
  it('both command type leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(ANN_LEAF), `leaf missing: ${relPosix(ANN_LEAF)}`).toBe(true);
    expect(fs.existsSync(ANL_LEAF), `leaf missing: ${relPosix(ANL_LEAF)}`).toBe(true);
  });

  it('pins the 11 annotation keys in order with no duplicates', () => {
    expect(unionKeysInOrder(ANN_LEAF, 'annotation', ANN_ALIAS)).toEqual([...EXPECTED_ANNOTATION_KEYS]);
    expect(new Set(unionKeysInOrder(ANN_LEAF, 'annotation', ANN_ALIAS)).size).toBe(11);
  });

  it('pins the 8 analysis keys in order with no duplicates', () => {
    expect(unionKeysInOrder(ANL_LEAF, 'analysis', ANL_ALIAS)).toEqual([...EXPECTED_ANALYSIS_KEYS]);
    expect(new Set(unionKeysInOrder(ANL_LEAF, 'analysis', ANL_ALIAS)).size).toBe(8);
  });

  it('keeps the original Phase 18U section comment at the analysis leaf', () => {
    const text = fs.readFileSync(ANL_LEAF, 'utf8');
    for (const line of PHASE_18U_COMMENT_LINES) expect(text).toContain(line);
    const firstBranch = text.indexOf("key: 'ANALYSIS_MAP_CREATE'");
    expect(Math.max(...PHASE_18U_COMMENT_LINES.map((line) => text.indexOf(line)))).toBeLessThan(firstBranch);
    expect(fs.readFileSync(HUB, 'utf8')).not.toContain(PHASE_18U_COMMENT_LINES[0]);
  });
});

describe('STRUCT-241.11 baseline shapes: Extract<CadCommand> vs leaf vs Base*', () => {
  it('keeps annotation members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_MTEXT' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'CREATE_MTEXT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_MTEXT' }>>().toEqualTypeOf<BaseCreateMText>();
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_LEADER' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'CREATE_LEADER' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_LEADER' }>>().toEqualTypeOf<BaseCreateLeader>();
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_DIMENSION' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'CREATE_DIMENSION' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_DIMENSION' }>>().toEqualTypeOf<BaseCreateDimension>();
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_BEARING_LABEL' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'CREATE_BEARING_LABEL' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_BEARING_LABEL' }>>().toEqualTypeOf<BaseCreateBearingLabel>();
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_CURVE_LABEL' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'CREATE_CURVE_LABEL' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CREATE_CURVE_LABEL' }>>().toEqualTypeOf<BaseCreateCurveLabel>();
    expectTypeOf<Extract<CadCommand, { key: 'UPDATE_DIMENSION_PLACEMENT' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'UPDATE_DIMENSION_PLACEMENT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'UPDATE_DIMENSION_PLACEMENT' }>>()
      .toEqualTypeOf<BaseUpdateDimensionPlacement>();
    expectTypeOf<Extract<CadCommand, { key: 'REATTACH_ANNOTATION' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'REATTACH_ANNOTATION' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'REATTACH_ANNOTATION' }>>().toEqualTypeOf<BaseReattachAnnotation>();
    expectTypeOf<Extract<CadCommand, { key: 'SET_TEXT_OVERRIDE' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'SET_TEXT_OVERRIDE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'SET_TEXT_OVERRIDE' }>>().toEqualTypeOf<BaseSetTextOverride>();
    expectTypeOf<Extract<CadCommand, { key: 'CLEAR_TEXT_OVERRIDE' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'CLEAR_TEXT_OVERRIDE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'CLEAR_TEXT_OVERRIDE' }>>().toEqualTypeOf<BaseClearTextOverride>();
    expectTypeOf<Extract<CadCommand, { key: 'SET_ANNOTATION_SCALE' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'SET_ANNOTATION_SCALE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'SET_ANNOTATION_SCALE' }>>().toEqualTypeOf<BaseSetAnnotationScale>();
    expectTypeOf<Extract<CadCommand, { key: 'ANNOTATION_COMMIT' }>>()
      .toEqualTypeOf<Extract<CadAnnotationCommandPayload, { key: 'ANNOTATION_COMMIT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ANNOTATION_COMMIT' }>>().toEqualTypeOf<BaseAnnotationCommit>();
  });

  it('keeps analysis members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_MAP_CREATE' }>>()
      .toEqualTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_MAP_CREATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_MAP_CREATE' }>>().toEqualTypeOf<BaseAnalysisMapCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_MAP_UPDATE_BANDS' }>>()
      .toEqualTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_MAP_UPDATE_BANDS' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_MAP_UPDATE_BANDS' }>>()
      .toEqualTypeOf<BaseAnalysisMapUpdateBands>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_MAP_UPDATE_APPEARANCE' }>>()
      .toEqualTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_MAP_UPDATE_APPEARANCE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_MAP_UPDATE_APPEARANCE' }>>()
      .toEqualTypeOf<BaseAnalysisMapUpdateAppearance>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_MAP_DELETE' }>>()
      .toEqualTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_MAP_DELETE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_MAP_DELETE' }>>().toEqualTypeOf<BaseAnalysisMapDelete>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_LEGEND_CREATE' }>>()
      .toEqualTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_LEGEND_CREATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_LEGEND_CREATE' }>>().toEqualTypeOf<BaseAnalysisLegendCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_LEGEND_UPDATE' }>>()
      .toEqualTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_LEGEND_UPDATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_LEGEND_UPDATE' }>>().toEqualTypeOf<BaseAnalysisLegendUpdate>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_LEGEND_MOVE' }>>()
      .toEqualTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_LEGEND_MOVE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_LEGEND_MOVE' }>>().toEqualTypeOf<BaseAnalysisLegendMove>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_LEGEND_DELETE' }>>()
      .toEqualTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_LEGEND_DELETE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ANALYSIS_LEGEND_DELETE' }>>().toEqualTypeOf<BaseAnalysisLegendDelete>();
  });

  it('rejects invalid key widening on both leaves', () => {
    expectTypeOf<Extract<CadAnnotationCommandPayload, { key: 'NOPE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadAnalysisCommandPayload, { key: 'NOPE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadCommand, { key: 'NOPE' }>>().toEqualTypeOf<never>();
  });

  it('matches the transcribed AST property shapes, order, and comment counts', () => {
    const annotation = variantShapes(ANN_LEAF, 'annotation', ANN_ALIAS);
    const analysis = variantShapes(ANL_LEAF, 'analysis', ANL_ALIAS);
    expect(annotation.map((v) => v.key)).toEqual([...EXPECTED_ANNOTATION_KEYS]);
    expect(analysis.map((v) => v.key)).toEqual([...EXPECTED_ANALYSIS_KEYS]);
    for (const variant of annotation) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_ANNOTATION_SHAPES[variant.key]!.map(pinShape),
      );
      expect(variant.comments.length, `${variant.key} comment drift`).toBe(
        EXPECTED_ANNOTATION_COMMENT_COUNTS[variant.key] ?? 0,
      );
    }
    for (const variant of analysis) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_ANALYSIS_SHAPES[variant.key]!.map(pinShape),
      );
      expect(variant.comments.length, `${variant.key} comment drift`).toBe(
        EXPECTED_ANALYSIS_COMMENT_COUNTS[variant.key] ?? 0,
      );
    }
  });

  it('keeps the exact member JSDoc text on the three documented fields', () => {
    const annotation = variantShapes(ANN_LEAF, 'annotation', ANN_ALIAS);
    const reattach = annotation.find((v) => v.key === 'REATTACH_ANNOTATION')!;
    expect(reattach.comments).toEqual([
      '/** Omitted = convert the slot to a frozen point at its resolved position. */',
    ]);
    const commit = annotation.find((v) => v.key === 'ANNOTATION_COMMIT')!;
    expect(commit.comments).toEqual([
      '/** Validated project from the annotation UI op applier (hook-owned). */',
    ]);
    const analysis = variantShapes(ANL_LEAF, 'analysis', ANL_ALIAS);
    const mapDelete = analysis.find((v) => v.key === 'ANALYSIS_MAP_DELETE')!;
    expect(mapDelete.comments).toEqual([
      '/** True removes the map + every referencing legend atomically. */',
    ]);
  });

  it('keeps required fields required, optionals optional, and the nullable textPoint', () => {
    expectTypeOf<Extract<CadAnnotationCommandPayload, { key: 'CREATE_LEADER' }>['arrowAnchor']>()
      .toEqualTypeOf<CadAnnotationAnchor>();
    expectTypeOf<Extract<CadAnnotationCommandPayload, { key: 'CREATE_LEADER' }>['leaderStyleId']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadAnnotationCommandPayload, { key: 'CREATE_DIMENSION' }>['orientation']>()
      .toEqualTypeOf<'horizontal' | 'vertical' | 'aligned' | undefined>();
    expectTypeOf<Extract<CadAnnotationCommandPayload, { key: 'UPDATE_DIMENSION_PLACEMENT' }>['textPoint']>()
      .toEqualTypeOf<{ x: number; y: number } | null | undefined>();
    expectTypeOf<Extract<CadAnnotationCommandPayload, { key: 'REATTACH_ANNOTATION' }>['slot']>()
      .toEqualTypeOf<'leader-arrow' | 'dimension-anchor' | 'dimension-def-point-1' | 'dimension-def-point-2'>();
    expectTypeOf<Extract<CadAnnotationCommandPayload, { key: 'REATTACH_ANNOTATION' }>['anchor']>()
      .toEqualTypeOf<CadAnnotationAnchor | undefined>();
    expectTypeOf<Extract<CadAnnotationCommandPayload, { key: 'ANNOTATION_COMMIT' }>['project']>()
      .toEqualTypeOf<CadProject>();
    expectTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_MAP_CREATE' }>['bands']>()
      .toEqualTypeOf<CadAnalysisBand[]>();
    expectTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_MAP_CREATE' }>['source']>()
      .toEqualTypeOf<CadAnalysisSource>();
    expectTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_MAP_DELETE' }>['deleteLegendsToo']>()
      .toEqualTypeOf<boolean | undefined>();
    expectTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_LEGEND_UPDATE' }>['patch']>()
      .toEqualTypeOf<CadAnalysisLegendPatch>();
    expectTypeOf<Extract<CadAnalysisCommandPayload, { key: 'ANALYSIS_LEGEND_UPDATE' }>['legendId']>()
      .toEqualTypeOf<string>();
  });

  it('compiles full-field samples through the hub round trip', () => {
    const annotationSamples: CadAnnotationCommandPayload[] = [
      {
        key: 'CREATE_DIMENSION', dimensionKind: 'aligned' as CadDimensionKind,
        anchors: [], dimLinePoint: { x: 0, y: 0 },
      },
      { key: 'UPDATE_DIMENSION_PLACEMENT', entityId: 'e-1', dimLinePoint: { x: 0, y: 0 }, textPoint: null },
      { key: 'SET_ANNOTATION_SCALE', scaleDenominator: 500 },
    ];
    const analysisSamples: CadAnalysisCommandPayload[] = [
      { key: 'ANALYSIS_MAP_DELETE', analysisId: 'a-1', deleteLegendsToo: true },
      { key: 'ANALYSIS_LEGEND_MOVE', legendId: 'l-1', x: 1, y: 2 },
    ];
    for (const sample of [...annotationSamples, ...analysisSamples]) {
      expect(leafToHub(sample)).toBe(sample);
    }
    expect(Object.keys(annotationSamples[1]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_ANNOTATION_SHAPES.UPDATE_DIMENSION_PLACEMENT!)].sort(),
    );
  });
});

describe('STRUCT-241.11 hub union splice order and member counts', () => {
  it('measures 61 top-level members and documents the 72 -> 61 extraction', () => {
    const counts = hubTopLevelCounts();
    // STRUCT-241.13 roll-forward: 15 alignment + parcel-construction inline
    // members replaced by 2 alias references (51 inline, 31 refs, 7 intersections).
    // STRUCT-241.14 roll-forward: 19 primitive-draw + basic-curve inline
    // members replaced by 2 alias references (32 inline, 33 refs, 7 intersections).
    // STRUCT-241.15 roll-forward: 13 planar-transform + geometry-edit inline
    // members replaced by 2 alias references (19 inline, 35 refs, 7 intersections).
    expect(counts).toEqual({ total: 61, inline: 19, refs: 35, intersections: 7 });
    // Re-inlining the annotation + analysis + 241.15 leaves restores the 241.13 shape
    // 89 = 61 + 11 + 8 + 6 + 7 - 4 ...
    expect(unionKeysInOrder(ANN_LEAF, 'annotation', ANN_ALIAS).length).toBe(11);
    expect(unionKeysInOrder(ANL_LEAF, 'analysis', ANL_ALIAS).length).toBe(8);
    expect(counts.total + 11 + 8 + 6 + 7 - 4).toBe(89);
    // ... and re-inlining the 241.12 + 241.13 leaves on top restores the pre-241.11 133.
    expect(unionMemberDescriptors(
      abs('src/engine/cad/cadTransactionsFeatureLineCommandTypes.ts'), 'featureline', 'CadFeatureLineCommandPayload').length).toBe(11);
    expect(unionMemberDescriptors(
      abs('src/engine/cad/cadTransactionsDesignSurfaceCommandTypes.ts'), 'designsurface', 'CadDesignSurfaceCommandPayload').length).toBe(5);
    expect(unionMemberDescriptors(
      abs('src/engine/cad/cadTransactionsAlignmentCommandTypes.ts'), 'alignment', 'CadAlignmentCommandPayload').length).toBe(6);
    expect(unionMemberDescriptors(
      abs('src/engine/cad/cadTransactionsParcelConstructionCommandTypes.ts'), 'parcel', 'CadParcelConstructionCommandPayload').length).toBe(9);
    // ... and re-inlining the 241.12 + 241.13 + 241.14 + 241.15 leaves on top
    // restores the pre-241.11 133.
    expect(unionMemberDescriptors(
      abs('src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes.ts'), 'primitive', 'CadPrimitiveDrawCommandPayload').length).toBe(13);
    expect(unionMemberDescriptors(
      abs('src/engine/cad/cadTransactionsBasicCurveCommandTypes.ts'), 'basiccurve', 'CadBasicCurveCommandPayload').length).toBe(6);
    expect(counts.total + 11 + 8 + 11 + 5 + 6 + 9 + 13 + 6 + 6 + 7 - 10).toBe(133);
  });

  it('splices both groups with neighbor sentinels in the original position', () => {
    const seq = hubMemberSequence();
    const definition = seq.findIndex((m) => m.label === 'CadBlockDefinitionCommandPayload');
    expect(seq[definition]).toEqual({ kind: 'ref', label: 'CadBlockDefinitionCommandPayload' });
    expect(seq[definition + 1]).toEqual({ kind: 'ref', label: ANN_ALIAS });
    expect(seq[definition + 2]).toEqual({ kind: 'ref', label: ANL_ALIAS });
    // STRUCT-241.12 roll-forward: the feature-line group now splices here,
    // still contiguous, ahead of the Phase 20B grading group.
    expect(seq[definition + 3]).toEqual({ kind: 'ref', label: 'CadFeatureLineCommandPayload' });
    expect(seq[definition + 4]).toEqual({ kind: 'ref', label: 'CadGradingCommandPayload' });
  });

  it('flattens to the exact 168 effective members in the original sequence', () => {
    const flat = hubFlattenedKeys();
    expect(flat.length).toBe(168);
    // BLOCK_DELETE is the last member of the definition group (each BLOCK
    // key occurs once in the flattened 168); the 11 annotation + 8 analysis
    // keys follow it contiguously, then the FEATURELINE group.
    const at = flat.indexOf('BLOCK_DELETE');
    expect(flat.slice(at + 1, at + 12)).toEqual([...EXPECTED_ANNOTATION_KEYS]);
    expect(flat.slice(at + 12, at + 20)).toEqual([...EXPECTED_ANALYSIS_KEYS]);
    expect(flat[at + 20]).toBe("'FEATURELINE'|'FEATURELINECREATE'");
  });

  it('leaves no inline annotation/analysis block key behind in the hub union', () => {
    const inlineSets = hubInlineKeySets();
    // STRUCT-241.13 roll-forward: 66 -> 51 inline (15 alignment +
    // parcel-construction members moved to leaves).
    // STRUCT-241.14 roll-forward: 51 -> 32 inline (19 primitive-draw +
    // basic-curve members moved to leaves).
    expect(inlineSets.length).toBe(19);
    const moved: Set<string> = new Set([...EXPECTED_ANNOTATION_KEYS, ...EXPECTED_ANALYSIS_KEYS]);
    for (const set of inlineSets) {
      for (const key of set) {
        expect(moved.has(key), `inline ${key} still in hub`).toBe(false);
      }
    }
  });
});

describe('STRUCT-241.11 CadCommandKey unchanged', () => {
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

  it('keeps the annotation and analysis key runs in their original positions', () => {
    const keys = hubKeyOrder();
    // Annotation run: after the BLOCK definition run, before Phase 20A.
    expect(keys.slice(keys.indexOf('CREATE_MTEXT'), keys.indexOf('CREATE_MTEXT') + 11)).toEqual([
      ...EXPECTED_ANNOTATION_KEYS,
    ]);
    expect(keys[keys.indexOf('BLOCK_DELETE', keys.indexOf('SECTION_VIEW_DELETE')) + 1]).toBe('CREATE_MTEXT');
    expect(keys[keys.indexOf('ANNOTATION_COMMIT') + 1]).toBe('FEATURELINE');
    // Analysis run: historical position inside the VOLUME_STYLE run.
    expect(keys.slice(keys.indexOf('ANALYSIS_MAP_CREATE'), keys.indexOf('ANALYSIS_MAP_CREATE') + 8)).toEqual([
      ...EXPECTED_ANALYSIS_KEYS,
    ]);
    expect(keys[keys.indexOf('ANALYSIS_MAP_CREATE') - 1]).toBe('VOLUME_STYLE_CREATE');
    expect(keys[keys.indexOf('ANALYSIS_LEGEND_DELETE') + 1]).toBe('VOLUME_STYLE_DUPLICATE');
  });
});

describe('STRUCT-241.11 public transaction types unchanged', () => {
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
    const definitionProbe: CadCommandDefinition<CadCommand> = { key: 'CREATE_MTEXT', execute: () => null };
    const transactionProbe: CadTransaction = {
      id: 't-1', sequence: 1, commandKey: 'ANALYSIS_MAP_CREATE', label: 'map',
      beforeSelectionIds: [], afterSelectionIds: [], addedEntityIds: [], removedEntityIds: [],
    };
    expect([definitionProbe.key, transactionProbe.commandKey]).toEqual(['CREATE_MTEXT', 'ANALYSIS_MAP_CREATE']);
    expectTypeOf<CadCommand extends { key: string } ? true : false>().toEqualTypeOf<true>();
  });
});

describe('STRUCT-241.11 type-only leaves and emit parity', () => {
  it('annotation leaf imports exactly the allow-listed type modules', () => {
    expect(runtimeImportSpecifiers(ANN_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(ANN_LEAF)).toBe(true);
    expect(valueStatementKinds(ANN_LEAF)).toEqual([]);
    expect(allImportSpecifiers(ANN_LEAF)).toEqual([
      './cadCorePrimitiveTypes',
      './cadAnnotationEntityStyleTypes',
      './annotation/cadAnnotationAnchorTypes',
      './cadTypes',
    ]);
  });

  it('analysis leaf imports exactly the allow-listed type modules', () => {
    expect(runtimeImportSpecifiers(ANL_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(ANL_LEAF)).toBe(true);
    expect(valueStatementKinds(ANL_LEAF)).toEqual([]);
    expect(allImportSpecifiers(ANL_LEAF)).toEqual([
      './cadCorePrimitiveTypes',
      './cadAnalysisTypes',
      './cadAnalysisMaps',
      './cadAnalysisLegends',
    ]);
  });

  it('transpiled emit is marker-only for the hub and both leaves', () => {
    expect(strippedEmit(HUB)).toBe('export {};');
    expect(strippedEmit(ANN_LEAF)).toBe('export {};');
    expect(strippedEmit(ANL_LEAF)).toBe('export {};');
  });
});

describe('STRUCT-241.11 annotation/analysis regression neighbours covered by import existence', () => {
  it.each([
    'cad_annotation_persistence',
    'cad_annotation_workspace_seam',
    'cad_analysis_model_18u',
    'cad_analysis_service_18u',
    'cad_analysis_reconciliation_18u',
    'cad_analysis_ui_18u',
    'cad_surface_analysis_bands_18u',
    'cad_block_command_type_leaf_2412',
    'cad_survey_layer_command_type_leaves_2411',
    'cad_profile_section_command_types_1955',
    'cad_grading_command_types_1956',
    'cad_annotation_cogo_type_cycle_1957',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });

  it('annotation command engine suite exists', () => {
    expect(fs.existsSync(
      path.join(REPO_ROOT, 'src', 'engine', 'cad', 'annotation', '__tests__', 'cadAnnotationCommands.test.ts'),
    )).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.11 extraction is type-only: +2 nodes / +6 type edges (+10 new type
// edges — 2 hub imports + 8 leaf out-edges — minus 4 retired hub edges to the
// anchor barrel and the three analysis source modules). STRUCT-241.12
// roll-forward: +2 nodes / +5 type edges (+7 new type edges — 2 hub imports +
// 5 leaf out-edges — minus 2 retired hub edges to cadFeatureLineCreate +
// gradingGroupTypes). Both historical value/mixed digests stay identical.
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

describe('STRUCT-241.11 CAD+F2F graph pins', () => {
  // First cold graph parse in this file; allow headroom under full-suite CI contention.
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // Pre-241.11 baseline 501 / 2459; the 241.11 leaves add +2 / +6
    // (annotation leaf: 4 out-edges + hub import; analysis leaf: 4 out-edges
    // + hub import; 4 retired hub edges to the anchor barrel +
    // analysis maps/legends/types modules). STRUCT-241.12 roll-forward:
    // +2 / +5 (feature-line leaf: 2 out-edges + hub import; design-surface
    // leaf: 3 out-edges + hub import; 2 retired hub edges). STRUCT-241.13
    // roll-forward: +2 / +5 (alignment leaf: 1 out-edge + hub import;
    // parcel leaf: 2 out-edges + hub import; no retired module edge).
    // STRUCT-241.14 roll-forward: +2 / +3 (primitive-draw leaf: 2
    // out-edges + hub import; basic-curve leaf: 0 out-edges + hub import;
    // 1 retired hub tangent-solver edge).
    // STRUCT-241.15 roll-forward: +2 / +5 (geometry-edit leaf: 3
    // out-edges + hub import; planar leaf: 0 out-edges + hub import;
    // no retired edge).
    expect(graph.nodes.length).toBe(511);
    expect(graph.edges.length).toBe(2483);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  }, 30_000);

  it('adds exactly the allow-listed TYPE edges incident to the two leaves', () => {
    const graph = cadF2fGraph();
    const annLeaf = path.resolve(ANN_LEAF);
    const anlLeaf = path.resolve(ANL_LEAF);
    expect(graph.edges.filter((edge) => edge.from === annLeaf).map((edge) => edge.specifier).sort()).toEqual([
      './annotation/cadAnnotationAnchorTypes',
      './cadAnnotationEntityStyleTypes',
      './cadCorePrimitiveTypes',
      './cadTypes',
    ]);
    expect(graph.edges.filter((edge) => edge.from === anlLeaf).map((edge) => edge.specifier).sort()).toEqual([
      './cadAnalysisLegends',
      './cadAnalysisMaps',
      './cadAnalysisTypes',
      './cadCorePrimitiveTypes',
    ]);
    expect(graph.edges.filter((edge) => edge.to === annLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: annLeaf,
        specifier: './cadTransactionsAnnotationCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter((edge) => edge.to === anlLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: anlLeaf,
        specifier: './cadTransactionsAnalysisCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter(
      (edge) => (edge.from === annLeaf || edge.to === annLeaf || edge.from === anlLeaf || edge.to === anlLeaf)
        && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('retires the four hub edges into the extracted source modules', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    for (const target of [
      path.resolve(path.join(CAD_DIR, 'annotation', 'cadAnnotationAnchors.ts')),
      path.resolve(path.join(CAD_DIR, 'cadAnalysisMaps.ts')),
      path.resolve(path.join(CAD_DIR, 'cadAnalysisLegends.ts')),
      path.resolve(path.join(CAD_DIR, 'cadAnalysisTypes.ts')),
    ]) {
      expect(graph.edges.filter((edge) => edge.from === hub && edge.to === target)).toEqual([]);
    }
  });

  it('has no leaf back-edge to the transaction hub or command executors', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    for (const leaf of [path.resolve(ANN_LEAF), path.resolve(ANL_LEAF)]) {
      // The analysis leaf legitimately holds type-only edges into the two
      // runtime patch modules (pinned above); only value/mixed edges and
      // hub/executor edges are forbidden here.
      for (const target of [
        hub,
        path.resolve(path.join(CAD_DIR, 'cadTransactions.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsAnnotationCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsAnalysisCommands.ts')),
      ]) {
        expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
      }
      expect(graph.edges.filter((edge) => edge.from === leaf && edge.kind !== 'type')).toEqual([]);
    }
  });
});

describe('STRUCT-241.11 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // Pre-241.11 baseline 1673 / 7570; the 241.11 leaves add +2 / +6 and the
    // 241.12 leaves add +2 / +5 and the 241.13 leaves add +2 / +5 and the
    // 241.14 leaves add +2 / +3 (every 241.11/241.12/241.13/241.14 edge
    // resolves inside `src`).
    // STRUCT-241.15 roll-forward: the 241.15 leaves add +2 / +5 (same
    // allowlist as the scoped pin; every 241.15 edge resolves inside `src`).
    expect(graph.nodes.length).toBe(1683);
    expect(graph.edges.length).toBe(7594);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4444,
      uniqPairs: 4385,
      sha: '415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448',
    });
  }, 120_000);
});

describe('STRUCT-241.11 negative controls (in-memory mutations only)', () => {
  const annSource = (): string => fs.readFileSync(ANN_LEAF, 'utf8');
  const anlSource = (): string => fs.readFileSync(ANL_LEAF, 'utf8');
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('fails the shape pin when CREATE_LEADER arrowAnchor is dropped', () => {
    const mutated = annSource().replace('      arrowAnchor: CadAnnotationAnchor;\n', '');
    expect(mutated).not.toBe(annSource());
    const leader = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANN_ALIAS)
      .find((v) => v.key === 'CREATE_LEADER')!;
    expect(() => expect(leader.props).toEqual(EXPECTED_ANNOTATION_SHAPES.CREATE_LEADER!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when the CREATE_MTEXT attachment literal changes', () => {
    const mutated = annSource().replace('attachment?: CadMTextAttachment;', 'attachment?: string;');
    expect(mutated).not.toBe(annSource());
    const mtext = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANN_ALIAS)
      .find((v) => v.key === 'CREATE_MTEXT')!;
    expect(() => expect(mtext.props).toEqual(EXPECTED_ANNOTATION_SHAPES.CREATE_MTEXT!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when CREATE_DIMENSION orientation loses a literal', () => {
    const mutated = annSource().replace(
      "orientation?: 'horizontal' | 'vertical' | 'aligned';",
      "orientation?: 'horizontal' | 'vertical';",
    );
    expect(mutated).not.toBe(annSource());
    const dimension = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANN_ALIAS)
      .find((v) => v.key === 'CREATE_DIMENSION')!;
    expect(() => expect(dimension.props).toEqual(EXPECTED_ANNOTATION_SHAPES.CREATE_DIMENSION!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when the nullable UPDATE textPoint becomes required non-null', () => {
    const mutated = annSource().replace(
      'textPoint?: { x: number; y: number } | null;',
      'textPoint: { x: number; y: number };',
    );
    expect(mutated).not.toBe(annSource());
    const update = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANN_ALIAS)
      .find((v) => v.key === 'UPDATE_DIMENSION_PLACEMENT')!;
    expect(() => expect(update.props).toEqual(EXPECTED_ANNOTATION_SHAPES.UPDATE_DIMENSION_PLACEMENT!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when a REATTACH slot literal is removed', () => {
    const mutated = annSource().replace(" | 'dimension-def-point-2'", '');
    expect(mutated).not.toBe(annSource());
    const reattach = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANN_ALIAS)
      .find((v) => v.key === 'REATTACH_ANNOTATION')!;
    expect(() => expect(reattach.props).toEqual(EXPECTED_ANNOTATION_SHAPES.REATTACH_ANNOTATION!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when REATTACH anchor? becomes required', () => {
    const mutated = annSource().replace('anchor?: CadAnnotationAnchor;', 'anchor: CadAnnotationAnchor;');
    expect(mutated).not.toBe(annSource());
    const reattach = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANN_ALIAS)
      .find((v) => v.key === 'REATTACH_ANNOTATION')!;
    expect(() => expect(reattach.props).toEqual(EXPECTED_ANNOTATION_SHAPES.REATTACH_ANNOTATION!.map(pinShape))).toThrow();
  });

  it('fails the JSDoc pin when the REATTACH anchor note is dropped', () => {
    const mutated = annSource().replace(
      '      /** Omitted = convert the slot to a frozen point at its resolved position. */\n',
      '',
    );
    expect(mutated).not.toBe(annSource());
    const reattach = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANN_ALIAS)
      .find((v) => v.key === 'REATTACH_ANNOTATION')!;
    expect(reattach.comments).toEqual([]);
    expect(() => expect(reattach.comments).toEqual([
      '/** Omitted = convert the slot to a frozen point at its resolved position. */',
    ])).toThrow();
  });

  it('fails the shape pin when ANNOTATION_COMMIT project widens to unknown', () => {
    const mutated = annSource().replace('project: CadProject;', 'project: unknown;');
    expect(mutated).not.toBe(annSource());
    const commit = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANN_ALIAS)
      .find((v) => v.key === 'ANNOTATION_COMMIT')!;
    expect(() => expect(commit.props).toEqual(EXPECTED_ANNOTATION_SHAPES.ANNOTATION_COMMIT!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when ANALYSIS_MAP_CREATE bands becomes optional', () => {
    const mutated = anlSource().replace('bands: CadAnalysisBand[];', 'bands?: CadAnalysisBand[];');
    expect(mutated).not.toBe(anlSource());
    const create = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANL_ALIAS)
      .find((v) => v.key === 'ANALYSIS_MAP_CREATE')!;
    expect(() => expect(create.props).toEqual(EXPECTED_ANALYSIS_SHAPES.ANALYSIS_MAP_CREATE!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when ANALYSIS_MAP_CREATE source becomes optional', () => {
    const mutated = anlSource().replace('source: CadAnalysisSource;', 'source?: CadAnalysisSource;');
    expect(mutated).not.toBe(anlSource());
    const create = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANL_ALIAS)
      .find((v) => v.key === 'ANALYSIS_MAP_CREATE')!;
    expect(() => expect(create.props).toEqual(EXPECTED_ANNOTATION_SHAPES.CREATE_MTEXT!.map(pinShape))).not.toBe(null);
    expect(() => expect(create.props).toEqual(EXPECTED_ANALYSIS_SHAPES.ANALYSIS_MAP_CREATE!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when ANALYSIS_MAP_DELETE deleteLegendsToo? becomes required', () => {
    const mutated = anlSource().replace('deleteLegendsToo?: boolean;', 'deleteLegendsToo: boolean;');
    expect(mutated).not.toBe(anlSource());
    const del = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANL_ALIAS)
      .find((v) => v.key === 'ANALYSIS_MAP_DELETE')!;
    expect(() => expect(del.props).toEqual(EXPECTED_ANALYSIS_SHAPES.ANALYSIS_MAP_DELETE!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when ANALYSIS_LEGEND_UPDATE patch widens', () => {
    const mutated = anlSource().replace('patch: CadAnalysisLegendPatch;', 'patch: Record<string, unknown>;');
    expect(mutated).not.toBe(anlSource());
    const update = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANL_ALIAS)
      .find((v) => v.key === 'ANALYSIS_LEGEND_UPDATE')!;
    expect(() => expect(update.props).toEqual(EXPECTED_ANALYSIS_SHAPES.ANALYSIS_LEGEND_UPDATE!.map(pinShape))).toThrow();
  });

  it('fails the shape pin when ANALYSIS_LEGEND_UPDATE legendId narrows', () => {
    const mutated = anlSource().replace(
      "key: 'ANALYSIS_LEGEND_UPDATE';\n      legendId: string;",
      "key: 'ANALYSIS_LEGEND_UPDATE';\n      legendId: `legend-${string}`;",
    );
    expect(mutated).not.toBe(anlSource());
    const update = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANL_ALIAS)
      .find((v) => v.key === 'ANALYSIS_LEGEND_UPDATE')!;
    expect(() => expect(update.props).toEqual(EXPECTED_ANALYSIS_SHAPES.ANALYSIS_LEGEND_UPDATE!.map(pinShape))).toThrow();
  });

  it('fails the comment guard when the Phase 18U section note goes missing', () => {
    const mutated = anlSource().replace(`${PHASE_18U_COMMENT_LINES[0]}\n`, '');
    expect(mutated).not.toBe(anlSource());
    for (const line of PHASE_18U_COMMENT_LINES) {
      if (line === PHASE_18U_COMMENT_LINES[0]) {
        expect(mutated).not.toContain(line);
      } else {
        expect(mutated).toContain(line);
      }
    }
    expect(() => {
      for (const line of PHASE_18U_COMMENT_LINES) expect(mutated).toContain(line);
    }).toThrow();
  });

  it('fails the splice guard when the hub drops one alias splice', () => {
    const source = hubSource();
    const refLine = `  | ${ANL_ALIAS}\n`;
    expect(source).toContain(refLine);
    const mutated = source.replace(refLine, '');
    expect(mutated).not.toBe(source);
    const counts = hubTopLevelCounts(parseText('mutated-hub.ts', mutated));
    expect(() => expect(counts).toEqual({ total: 61, inline: 19, refs: 35, intersections: 7 })).toThrow();
    const flat = hubFlattenedKeys(parseText('mutated-hub.ts', mutated));
    expect(() => expect(flat.length).toBe(168)).toThrow();
  });

  it('fails the ordering guard when annotation variants reorder', () => {
    const source = annSource();
    const shapes = variantShapesFromSource(parseText('leaf.ts', source), 'leaf', ANN_ALIAS);
    const mtext = shapes.find((v) => v.key === 'CREATE_MTEXT')!.text;
    const commit = shapes.find((v) => v.key === 'ANNOTATION_COMMIT')!.text;
    const mutated = source.replace(mtext, '__SWAP__').replace(commit, mtext).replace('__SWAP__', commit);
    expect(mutated).not.toBe(source);
    const swapped = variantShapesFromSource(parseText('m.ts', mutated), 'm', ANN_ALIAS);
    expect(swapped.map((v) => v.key)).toHaveLength(11);
    expect(() => expect(swapped.map((v) => v.key)).toEqual([...EXPECTED_ANNOTATION_KEYS])).toThrow();
  });

  it('fails the acyclicity guard on a synthetic TYPE back-edge to the hub', () => {
    const mutated = `${annSource()}\nimport type { CadCommand } from './cadTransactions.types';\ntype BackEdge = CadCommand;\n`;
    expect(mutated).not.toBe(annSource());
    // Extract the specifier list from the MUTATED text (not the pristine
    // file): the back-edge must be visible to the same helper the allowlist
    // pin uses, and the allowlist pin must reject it.
    const mutatedSpecs = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(allImportSpecifiers(ANN_LEAF)).not.toContain('./cadTransactions.types');
    expect(mutatedSpecs).toContain('./cadTransactions.types');
    expect(() => expect(mutatedSpecs).toEqual(allImportSpecifiers(ANN_LEAF))).toThrow();
  });

  it('fails the type-only guard on a synthetic VALUE import from a runtime module', () => {
    const mutated = anlSource().replace(
      "import type { CadAnalysisAppearancePatch } from './cadAnalysisMaps';",
      "import { CadAnalysisAppearancePatch } from './cadAnalysisMaps';",
    );
    expect(mutated).not.toBe(anlSource());
    const runtime = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt))
      .filter((stmt) => stmt.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword)
      .map((stmt) => stmt.moduleSpecifier.getText());
    expect(runtime).toContain("'./cadAnalysisMaps'");
    expect(() => expect(runtime).toEqual([])).toThrow();
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(ANN_LEAF, 'utf8')).toBe(annSource());
    expect(fs.readFileSync(ANL_LEAF, 'utf8')).toBe(anlSource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
    // Static proof: every mutation above goes through in-memory parseText;
    // this file performs no filesystem writes (patterns split so this
    // assertion cannot match its own source text).
    const selfText = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8');
    for (const probe of ['write' + 'FileSync', 'append' + 'FileSync', 'fs.' + 'openSync']) {
      expect(selfText.includes(probe), `self write call ${probe}`).toBe(false);
    }
  });
});
