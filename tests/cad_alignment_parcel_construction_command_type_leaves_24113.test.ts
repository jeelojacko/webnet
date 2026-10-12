/**
 * STRUCT-241.13 — CAD alignment + parcel-construction command payload type leaves.
 *
 * Pins `src/engine/cad/cadTransactionsAlignmentCommandTypes.ts`, which
 * extracts the six alignment command payloads out of the `CadCommand` union
 * as one public union, and
 * `src/engine/cad/cadTransactionsParcelConstructionCommandTypes.ts`, which
 * extracts the nine parcel construction/split/course/layout payloads as one
 * public union, so the hub splices both back into their original contiguous
 * positions:
 *  - `CadAlignmentCommandPayload` (6): ALIGNMENT_CREATE,
 *    ALIGNMENT_OFFSET_CREATE, ALIGNMENT_STATION_REPORT,
 *    ALIGNMENT_STATION_EQUATION, ALIGNMENT_OFFSET_POINT,
 *    ALIGNMENT_INTERVAL_POINTS — between TANGENT_CURVE and PARCEL_CREATE.
 *  - `CadParcelConstructionCommandPayload` (9): PARCEL_CREATE, PARCEL_SPLIT,
 *    PARCEL_SPLIT_BEARING, PARCEL_SPLIT_AREA, PARCEL_SPLIT_SLIDE,
 *    PARCEL_SPLIT_SWING, PARCELCOURSEARC, PARCELCOURSELINE,
 *    PARCEL_LAYOUT_AUTO — between ALIGNMENT_INTERVAL_POINTS and the
 *    LINETABLE table intersection.
 *
 * Covers: hand-transcribed pre-refactor `Base*` shapes + AST property pins
 * (key literals, property order, optionality, `| null` nullability on the
 * frontage fields, the `'start' | 'end'` / `'slide' | 'swing'` literal
 * unions, required `settings: CadParcelLayoutSettings`); per-key
 * `Extract<CadCommand>` equivalence in both directions (all 15 members are
 * single-keyed, so plain single-literal selectors apply — no double-key
 * documentation needed); the byte-identical `CadCommandKey` (248 literals /
 * 241 unique / 7 legacy duplicate BLOCK keys kept, plus the ordered-list
 * digest); both splice sentinels (TANGENT_CURVE before, LINETABLE
 * intersection after, the six table intersections + TABLESTYLE +
 * SURVEYTABLE_EDIT + seven Parcel* management aliases untouched) + 89
 * top-level + 168 flattened effective members; public transaction types;
 * type-only emit pins; CAD+F2F and full-`src` graph pins with an explicit
 * +2 node / +5 type-edge allowlist (2 hub imports + 1 alignment out-edge +
 * 2 parcel out-edges; zero retired module edges — the hub keeps its
 * `./cadTypes` barrel edge and never imported `./cadParcelLayoutTypes`
 * directly); in-memory negative controls; and alignment / parcel regression
 * neighbours by import existence only.
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
import type { CadEntityId } from '../src/engine/cad/cadCorePrimitiveTypes';
import type { CadParcelLayoutSettings } from '../src/engine/cad/cadParcelLayoutTypes';
import type { CadAlignmentCommandPayload } from '../src/engine/cad/cadTransactionsAlignmentCommandTypes';
import type { CadParcelConstructionCommandPayload } from '../src/engine/cad/cadTransactionsParcelConstructionCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const AL_LEAF = path.join(CAD_DIR, 'cadTransactionsAlignmentCommandTypes.ts');
const PC_LEAF = path.join(CAD_DIR, 'cadTransactionsParcelConstructionCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');
const AL_ALIAS = 'CadAlignmentCommandPayload';
const PC_ALIAS = 'CadParcelConstructionCommandPayload';
// STRUCT-241.16 roll-forward: the two new leaf paths/aliases.
const SV_LEAF24116 = path.join(CAD_DIR, 'cadTransactionsSheetViewportCommandTypes.ts');
const PL_LEAF24116 = path.join(CAD_DIR, 'cadTransactionsPolylineTopologyCommandTypes.ts');
const SV_ALIAS24116 = 'CadSheetViewportCommandPayload';
const PL_ALIAS24116 = 'CadPolylineTopologyCommandPayload';

const abs = (relative: string): string => path.join(REPO_ROOT, relative);
const relPosix = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// TypeScript compiler helpers (same shape as the STRUCT-241.12 guard).
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
  // STRUCT-241.13: expand both new aliases per-member (all single-keyed:
  // 6 + 9, no widening).
  const alignment = leafMemberDescriptors(AL_LEAF, 'alignment', AL_ALIAS);
  const parcelConstruction = leafMemberDescriptors(PC_LEAF, 'parcel', PC_ALIAS);
  // STRUCT-241.14 roll-forward: expand the primitive-draw (13) +
  // basic-curve (6) aliases per-member (all single-keyed, no widening).
  const primitive = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes.ts'), 'primitive', 'CadPrimitiveDrawCommandPayload');
  const basiccurve = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsBasicCurveCommandTypes.ts'), 'basiccurve', 'CadBasicCurveCommandPayload');
  // STRUCT-241.15 roll-forward: expand the planar-transform (6) +
  // geometry-edit (7) aliases per-member (all single-keyed, no widening).
  const planar = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsPlanarTransformCommandTypes.ts'), 'planar', 'CadPlanarTransformCommandPayload');
  const geometryedit = leafMemberDescriptors(
    abs('src/engine/cad/cadTransactionsGeometryEditCommandTypes.ts'), 'geometryedit', 'CadGeometryEditCommandPayload');
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
      else if (name === AL_ALIAS) members.push(...alignment);
      else if (name === PC_ALIAS) members.push(...parcelConstruction);
      else if (name === 'CadPrimitiveDrawCommandPayload') members.push(...primitive);
      else if (name === 'CadBasicCurveCommandPayload') members.push(...basiccurve);
      else if (name === 'CadPlanarTransformCommandPayload') members.push(...planar);
      else if (name === 'CadGeometryEditCommandPayload') members.push(...geometryedit);
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
// baseline (/tmp/struct24113-baseline/cadTransactions.types.ts.baseline,
// hub CadCommand block). They import no leaf type, so leaf drift cannot move
// both sides of an assertion.
// ---------------------------------------------------------------------------

type BaseAlignmentCreate = {
  key: 'ALIGNMENT_CREATE';
  sourceEntityIds: CadEntityId[];
  name?: string;
  startStation?: number;
};

type BaseAlignmentOffsetCreate = {
  key: 'ALIGNMENT_OFFSET_CREATE';
  alignmentEntityId: CadEntityId;
  offset: number;
  name?: string;
};

type BaseAlignmentStationReport = {
  key: 'ALIGNMENT_STATION_REPORT';
  alignmentEntityId: CadEntityId;
  pointEntityId: CadEntityId;
};

type BaseAlignmentStationEquation = {
  key: 'ALIGNMENT_STATION_EQUATION';
  alignmentEntityId: CadEntityId;
  backStation: number;
  aheadStation: number;
};

type BaseAlignmentOffsetPoint = {
  key: 'ALIGNMENT_OFFSET_POINT';
  alignmentEntityId: CadEntityId;
  station: number;
  offset: number;
  label?: string;
};

type BaseAlignmentIntervalPoints = {
  key: 'ALIGNMENT_INTERVAL_POINTS';
  alignmentEntityId: CadEntityId;
  interval: number;
  startStation?: number;
  endStation?: number;
  labelPrefix?: string;
};

type BaseParcelCreate = {
  key: 'PARCEL_CREATE';
  sourceEntityIds: CadEntityId[];
};

type BaseParcelSplit = {
  key: 'PARCEL_SPLIT';
  parcelEntityId: CadEntityId;
  splitLineEntityId: CadEntityId;
};

type BaseParcelSplitBearing = {
  key: 'PARCEL_SPLIT_BEARING';
  parcelEntityId: CadEntityId;
  throughPointX: number;
  throughPointY: number;
  throughPointLabel?: string;
  bearing: string;
};

type BaseParcelSplitArea = {
  key: 'PARCEL_SPLIT_AREA';
  parcelEntityId: CadEntityId;
  throughPointX: number;
  throughPointY: number;
  throughPointLabel?: string;
  targetAreaSquareMeters: number;
};

type BaseParcelSplitSlide = {
  key: 'PARCEL_SPLIT_SLIDE';
  parcelEntityId: CadEntityId;
  frontageEntityId?: CadEntityId | null;
  frontageParcelSegmentIds?: string[] | null;
  targetAreaSquareMeters: number;
  minFrontageMeters: number;
  alternative: 'start' | 'end';
  settings: CadParcelLayoutSettings;
};

type BaseParcelSplitSwing = {
  key: 'PARCEL_SPLIT_SWING';
  parcelEntityId: CadEntityId;
  frontageEntityId?: CadEntityId | null;
  frontageParcelSegmentIds?: string[] | null;
  targetAreaSquareMeters: number;
  minFrontageMeters: number;
  alternative: 'start' | 'end';
  settings: CadParcelLayoutSettings;
};

type BaseParcelCourseArc = {
  key: 'PARCELCOURSEARC';
  parcelEntityId: CadEntityId;
  courseId: string;
  arcEntityId: CadEntityId;
};

type BaseParcelCourseLine = {
  key: 'PARCELCOURSELINE';
  parcelEntityId: CadEntityId;
  courseId: string;
};

type BaseParcelLayoutAuto = {
  key: 'PARCEL_LAYOUT_AUTO';
  parcelEntityId: CadEntityId;
  frontageEntityId?: CadEntityId | null;
  frontageParcelSegmentIds?: string[] | null;
  tool: 'slide' | 'swing';
  settings: CadParcelLayoutSettings;
};

/** One descriptor per leaf member, in declaration order (all single-keyed). */
const EXPECTED_ALIGNMENT_DESCRIPTORS = [
  'ALIGNMENT_CREATE',
  'ALIGNMENT_OFFSET_CREATE',
  'ALIGNMENT_STATION_REPORT',
  'ALIGNMENT_STATION_EQUATION',
  'ALIGNMENT_OFFSET_POINT',
  'ALIGNMENT_INTERVAL_POINTS',
] as const;

const EXPECTED_PARCEL_DESCRIPTORS = [
  'PARCEL_CREATE',
  'PARCEL_SPLIT',
  'PARCEL_SPLIT_BEARING',
  'PARCEL_SPLIT_AREA',
  'PARCEL_SPLIT_SLIDE',
  'PARCEL_SPLIT_SWING',
  'PARCELCOURSEARC',
  'PARCELCOURSELINE',
  'PARCEL_LAYOUT_AUTO',
] as const;

/** Every moved literal. */
const EXPECTED_MOVED_LITERALS = [
  ...EXPECTED_ALIGNMENT_DESCRIPTORS,
  ...EXPECTED_PARCEL_DESCRIPTORS,
] as const;

const EXPECTED_ALIGNMENT_SHAPES: Record<string, string[]> = {
  ALIGNMENT_CREATE: [
    "key: 'ALIGNMENT_CREATE'",
    'sourceEntityIds: CadEntityId[]',
    'name?: string',
    'startStation?: number',
  ],
  ALIGNMENT_OFFSET_CREATE: [
    "key: 'ALIGNMENT_OFFSET_CREATE'",
    'alignmentEntityId: CadEntityId',
    'offset: number',
    'name?: string',
  ],
  ALIGNMENT_STATION_REPORT: [
    "key: 'ALIGNMENT_STATION_REPORT'",
    'alignmentEntityId: CadEntityId',
    'pointEntityId: CadEntityId',
  ],
  ALIGNMENT_STATION_EQUATION: [
    "key: 'ALIGNMENT_STATION_EQUATION'",
    'alignmentEntityId: CadEntityId',
    'backStation: number',
    'aheadStation: number',
  ],
  ALIGNMENT_OFFSET_POINT: [
    "key: 'ALIGNMENT_OFFSET_POINT'",
    'alignmentEntityId: CadEntityId',
    'station: number',
    'offset: number',
    'label?: string',
  ],
  ALIGNMENT_INTERVAL_POINTS: [
    "key: 'ALIGNMENT_INTERVAL_POINTS'",
    'alignmentEntityId: CadEntityId',
    'interval: number',
    'startStation?: number',
    'endStation?: number',
    'labelPrefix?: string',
  ],
};

const EXPECTED_PARCEL_SHAPES: Record<string, string[]> = {
  PARCEL_CREATE: [
    "key: 'PARCEL_CREATE'",
    'sourceEntityIds: CadEntityId[]',
  ],
  PARCEL_SPLIT: [
    "key: 'PARCEL_SPLIT'",
    'parcelEntityId: CadEntityId',
    'splitLineEntityId: CadEntityId',
  ],
  PARCEL_SPLIT_BEARING: [
    "key: 'PARCEL_SPLIT_BEARING'",
    'parcelEntityId: CadEntityId',
    'throughPointX: number',
    'throughPointY: number',
    'throughPointLabel?: string',
    'bearing: string',
  ],
  PARCEL_SPLIT_AREA: [
    "key: 'PARCEL_SPLIT_AREA'",
    'parcelEntityId: CadEntityId',
    'throughPointX: number',
    'throughPointY: number',
    'throughPointLabel?: string',
    'targetAreaSquareMeters: number',
  ],
  PARCEL_SPLIT_SLIDE: [
    "key: 'PARCEL_SPLIT_SLIDE'",
    'parcelEntityId: CadEntityId',
    'frontageEntityId?: CadEntityId | null',
    'frontageParcelSegmentIds?: string[] | null',
    'targetAreaSquareMeters: number',
    'minFrontageMeters: number',
    "alternative: 'start' | 'end'",
    'settings: CadParcelLayoutSettings',
  ],
  PARCEL_SPLIT_SWING: [
    "key: 'PARCEL_SPLIT_SWING'",
    'parcelEntityId: CadEntityId',
    'frontageEntityId?: CadEntityId | null',
    'frontageParcelSegmentIds?: string[] | null',
    'targetAreaSquareMeters: number',
    'minFrontageMeters: number',
    "alternative: 'start' | 'end'",
    'settings: CadParcelLayoutSettings',
  ],
  PARCELCOURSEARC: [
    "key: 'PARCELCOURSEARC'",
    'parcelEntityId: CadEntityId',
    'courseId: string',
    'arcEntityId: CadEntityId',
  ],
  PARCELCOURSELINE: [
    "key: 'PARCELCOURSELINE'",
    'parcelEntityId: CadEntityId',
    'courseId: string',
  ],
  PARCEL_LAYOUT_AUTO: [
    "key: 'PARCEL_LAYOUT_AUTO'",
    'parcelEntityId: CadEntityId',
    'frontageEntityId?: CadEntityId | null',
    'frontageParcelSegmentIds?: string[] | null',
    "tool: 'slide' | 'swing'",
    'settings: CadParcelLayoutSettings',
  ],
};

/**
 * Per-variant member JSDoc/comment counts in the leaves. The hub carried no
 * comments on these fifteen members, so both leaves carry none either.
 */
const EXPECTED_ALIGNMENT_COMMENT_COUNTS: Record<string, number> = {};

const EXPECTED_PARCEL_COMMENT_COUNTS: Record<string, number> = {};

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

/** The seven parcel-management aliases that stay in the hub (never moved). */
const EXPECTED_PARCEL_MANAGEMENT_REFS = [
  'ParcelDesignateCommand',
  'ParcelNumberCommand',
  'ParcelLinkCommand',
  'ParcelUnlinkCommand',
  'ParcelSharedEditCommand',
  'ParcelCheckCommand',
  'ParcelScheduleCommand',
] as const;

// Compile-time leaf <-> hub round trip (enforced by project typecheck).
const leafToHub = (payload: CadAlignmentCommandPayload | CadParcelConstructionCommandPayload): CadCommand => payload;

describe('STRUCT-241.13 leaf presence and key order', () => {
  it('both command type leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(AL_LEAF), `leaf missing: ${relPosix(AL_LEAF)}`).toBe(true);
    expect(fs.existsSync(PC_LEAF), `leaf missing: ${relPosix(PC_LEAF)}`).toBe(true);
  });

  it('pins the 6 alignment keys in order with no duplicates', () => {
    expect(leafMemberDescriptors(AL_LEAF, 'alignment', AL_ALIAS)).toEqual([...EXPECTED_ALIGNMENT_DESCRIPTORS]);
    expect(unionKeysInOrder(AL_LEAF, 'alignment', AL_ALIAS)).toEqual([...EXPECTED_ALIGNMENT_DESCRIPTORS]);
  });

  it('pins the 9 parcel-construction keys in order with no duplicates', () => {
    expect(leafMemberDescriptors(PC_LEAF, 'parcel', PC_ALIAS)).toEqual([...EXPECTED_PARCEL_DESCRIPTORS]);
    expect(unionKeysInOrder(PC_LEAF, 'parcel', PC_ALIAS)).toEqual([...EXPECTED_PARCEL_DESCRIPTORS]);
  });

  it('invents no Phase section header in either leaf (the hub runs had none)', () => {
    for (const leaf of [AL_LEAF, PC_LEAF]) {
      expect(fs.readFileSync(leaf, 'utf8')).not.toContain('// Phase');
    }
    // The hub splice region (TANGENT_CURVE through LINETABLE) carries no
    // line or block comments either.
    const hubText = fs.readFileSync(HUB, 'utf8');
    const region = hubText.slice(
      hubText.indexOf("key: 'TANGENT_CURVE'"),
      hubText.indexOf("key: 'LINETABLE'"),
    );
    expect(region).not.toContain('//');
    expect(region).not.toContain('/*');
  });
});

describe('STRUCT-241.13 baseline shapes: Extract<CadCommand> vs leaf vs Base*', () => {
  it('keeps alignment members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_CREATE' }>>()
      .toEqualTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_CREATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_CREATE' }>>().toEqualTypeOf<BaseAlignmentCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_OFFSET_CREATE' }>>()
      .toEqualTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_OFFSET_CREATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_OFFSET_CREATE' }>>().toEqualTypeOf<BaseAlignmentOffsetCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_STATION_REPORT' }>>()
      .toEqualTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_STATION_REPORT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_STATION_REPORT' }>>().toEqualTypeOf<BaseAlignmentStationReport>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_STATION_EQUATION' }>>()
      .toEqualTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_STATION_EQUATION' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_STATION_EQUATION' }>>().toEqualTypeOf<BaseAlignmentStationEquation>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_OFFSET_POINT' }>>()
      .toEqualTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_OFFSET_POINT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_OFFSET_POINT' }>>().toEqualTypeOf<BaseAlignmentOffsetPoint>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_INTERVAL_POINTS' }>>()
      .toEqualTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_INTERVAL_POINTS' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'ALIGNMENT_INTERVAL_POINTS' }>>().toEqualTypeOf<BaseAlignmentIntervalPoints>();
  });

  it('keeps parcel-construction members identical across hub, leaf, and transcription', () => {
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_CREATE' }>>()
      .toEqualTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_CREATE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_CREATE' }>>().toEqualTypeOf<BaseParcelCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT' }>>()
      .toEqualTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT' }>>().toEqualTypeOf<BaseParcelSplit>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT_BEARING' }>>()
      .toEqualTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_BEARING' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT_BEARING' }>>().toEqualTypeOf<BaseParcelSplitBearing>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT_AREA' }>>()
      .toEqualTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_AREA' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT_AREA' }>>().toEqualTypeOf<BaseParcelSplitArea>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT_SLIDE' }>>()
      .toEqualTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_SLIDE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT_SLIDE' }>>().toEqualTypeOf<BaseParcelSplitSlide>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT_SWING' }>>()
      .toEqualTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_SWING' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_SPLIT_SWING' }>>().toEqualTypeOf<BaseParcelSplitSwing>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELCOURSEARC' }>>()
      .toEqualTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCELCOURSEARC' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELCOURSEARC' }>>().toEqualTypeOf<BaseParcelCourseArc>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELCOURSELINE' }>>()
      .toEqualTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCELCOURSELINE' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELCOURSELINE' }>>().toEqualTypeOf<BaseParcelCourseLine>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_LAYOUT_AUTO' }>>()
      .toEqualTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_LAYOUT_AUTO' }>>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCEL_LAYOUT_AUTO' }>>().toEqualTypeOf<BaseParcelLayoutAuto>();
  });

  it('keeps both whole-leaf unions identical to their transcribed counterparts', () => {
    expectTypeOf<CadAlignmentCommandPayload>().toEqualTypeOf<
      | BaseAlignmentCreate | BaseAlignmentOffsetCreate | BaseAlignmentStationReport
      | BaseAlignmentStationEquation | BaseAlignmentOffsetPoint | BaseAlignmentIntervalPoints
    >();
    expectTypeOf<CadParcelConstructionCommandPayload>().toEqualTypeOf<
      | BaseParcelCreate | BaseParcelSplit | BaseParcelSplitBearing | BaseParcelSplitArea
      | BaseParcelSplitSlide | BaseParcelSplitSwing | BaseParcelCourseArc
      | BaseParcelCourseLine | BaseParcelLayoutAuto
    >();
  });

  it('matches the transcribed AST property shapes and order (no member comments)', () => {
    const alignment = variantShapes(AL_LEAF, 'alignment', AL_ALIAS);
    const parcel = variantShapes(PC_LEAF, 'parcel', PC_ALIAS);
    expect(alignment.map((v) => v.key)).toEqual([...EXPECTED_ALIGNMENT_DESCRIPTORS]);
    expect(parcel.map((v) => v.key)).toEqual([...EXPECTED_PARCEL_DESCRIPTORS]);
    for (const variant of alignment) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_ALIGNMENT_SHAPES[variant.key]!.map(pinShape),
      );
      expect(variant.comments, `${variant.key} comment drift`).toEqual([]);
      expect(EXPECTED_ALIGNMENT_COMMENT_COUNTS[variant.key] ?? 0).toBe(0);
    }
    for (const variant of parcel) {
      expect(variant.props, `${variant.key} property drift`).toEqual(
        EXPECTED_PARCEL_SHAPES[variant.key]!.map(pinShape),
      );
      expect(variant.comments, `${variant.key} comment drift`).toEqual([]);
      expect(EXPECTED_PARCEL_COMMENT_COUNTS[variant.key] ?? 0).toBe(0);
    }
  });

  it('keeps required fields required, optionals optional, and nullability exact', () => {
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_CREATE' }>['sourceEntityIds']>()
      .toEqualTypeOf<CadEntityId[]>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_CREATE' }>['name']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_CREATE' }>['startStation']>()
      .toEqualTypeOf<number | undefined>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_OFFSET_CREATE' }>['offset']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_STATION_REPORT' }>['pointEntityId']>()
      .toEqualTypeOf<CadEntityId>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_STATION_EQUATION' }>['backStation']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_STATION_EQUATION' }>['aheadStation']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_OFFSET_POINT' }>['station']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_OFFSET_POINT' }>['label']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_INTERVAL_POINTS' }>['interval']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadAlignmentCommandPayload, { key: 'ALIGNMENT_INTERVAL_POINTS' }>['labelPrefix']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_CREATE' }>['sourceEntityIds']>()
      .toEqualTypeOf<CadEntityId[]>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT' }>['splitLineEntityId']>()
      .toEqualTypeOf<CadEntityId>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_BEARING' }>['throughPointLabel']>()
      .toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_BEARING' }>['bearing']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_AREA' }>['targetAreaSquareMeters']>()
      .toEqualTypeOf<number>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_SLIDE' }>['frontageEntityId']>()
      .toEqualTypeOf<CadEntityId | null | undefined>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_SLIDE' }>['frontageParcelSegmentIds']>()
      .toEqualTypeOf<string[] | null | undefined>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_SLIDE' }>['alternative']>()
      .toEqualTypeOf<'start' | 'end'>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_SLIDE' }>['settings']>()
      .toEqualTypeOf<CadParcelLayoutSettings>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_SWING' }>['frontageEntityId']>()
      .toEqualTypeOf<CadEntityId | null | undefined>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_SWING' }>['alternative']>()
      .toEqualTypeOf<'start' | 'end'>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_SPLIT_SWING' }>['settings']>()
      .toEqualTypeOf<CadParcelLayoutSettings>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCELCOURSEARC' }>['courseId']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCELCOURSEARC' }>['arcEntityId']>()
      .toEqualTypeOf<CadEntityId>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCELCOURSELINE' }>['courseId']>()
      .toEqualTypeOf<string>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_LAYOUT_AUTO' }>['tool']>()
      .toEqualTypeOf<'slide' | 'swing'>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'PARCEL_LAYOUT_AUTO' }>['settings']>()
      .toEqualTypeOf<CadParcelLayoutSettings>();
    expectTypeOf<Extract<CadParcelConstructionCommandPayload, { key: 'NOPE' }>>().toEqualTypeOf<never>();
    expectTypeOf<Extract<CadCommand, { key: 'NOPE' }>>().toEqualTypeOf<never>();
  });

  it('compiles full-field samples through the hub round trip', () => {
    const alignmentSamples: CadAlignmentCommandPayload[] = [
      { key: 'ALIGNMENT_CREATE', sourceEntityIds: ['e-1'], name: 'Main', startStation: 100 },
      { key: 'ALIGNMENT_OFFSET_CREATE', alignmentEntityId: 'a-1', offset: 5 },
      { key: 'ALIGNMENT_STATION_REPORT', alignmentEntityId: 'a-1', pointEntityId: 'p-1' },
      { key: 'ALIGNMENT_STATION_EQUATION', alignmentEntityId: 'a-1', backStation: 100, aheadStation: 200 },
      { key: 'ALIGNMENT_OFFSET_POINT', alignmentEntityId: 'a-1', station: 150, offset: -2, label: 'OP1' },
      { key: 'ALIGNMENT_INTERVAL_POINTS', alignmentEntityId: 'a-1', interval: 25, startStation: 100, endStation: 200, labelPrefix: 'IP' },
    ];
    const parcelSamples: CadParcelConstructionCommandPayload[] = [
      { key: 'PARCEL_CREATE', sourceEntityIds: ['e-2'] },
      { key: 'PARCEL_SPLIT', parcelEntityId: 'pc-1', splitLineEntityId: 'l-1' },
      { key: 'PARCEL_SPLIT_BEARING', parcelEntityId: 'pc-1', throughPointX: 1, throughPointY: 2, bearing: 'N45E' },
      { key: 'PARCEL_SPLIT_AREA', parcelEntityId: 'pc-1', throughPointX: 1, throughPointY: 2, throughPointLabel: 'TP', targetAreaSquareMeters: 500 },
      {
        key: 'PARCEL_SPLIT_SLIDE', parcelEntityId: 'pc-1', frontageEntityId: null,
        frontageParcelSegmentIds: null, targetAreaSquareMeters: 500, minFrontageMeters: 10,
        alternative: 'start', settings: { minAreaSquareMeters: 100 } as unknown as CadParcelLayoutSettings,
      },
      {
        key: 'PARCEL_SPLIT_SWING', parcelEntityId: 'pc-1', targetAreaSquareMeters: 500,
        minFrontageMeters: 10, alternative: 'end', settings: { minAreaSquareMeters: 100 } as unknown as CadParcelLayoutSettings,
      },
      { key: 'PARCELCOURSEARC', parcelEntityId: 'pc-1', courseId: 'c-1', arcEntityId: 'a-9' },
      { key: 'PARCELCOURSELINE', parcelEntityId: 'pc-1', courseId: 'c-2' },
      {
        key: 'PARCEL_LAYOUT_AUTO', parcelEntityId: 'pc-1', tool: 'swing',
        settings: { minAreaSquareMeters: 100 } as unknown as CadParcelLayoutSettings,
      },
    ];
    for (const sample of [...alignmentSamples, ...parcelSamples]) {
      expect(leafToHub(sample)).toBe(sample);
    }
    expect(Object.keys(parcelSamples[4]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_PARCEL_SHAPES.PARCEL_SPLIT_SLIDE!)].sort(),
    );
    expect(Object.keys(alignmentSamples[5]!).sort()).toEqual(
      [...expectedFieldNames(EXPECTED_ALIGNMENT_SHAPES.ALIGNMENT_INTERVAL_POINTS!)].sort(),
    );
  });
});

describe('STRUCT-241.13 hub union splice order and member counts', () => {
  it('measures 55 top-level members and documents the 61 -> 55 extraction', () => {
    const counts = hubTopLevelCounts();
    expect(counts).toEqual({ total: 55, inline: 11, refs: 37, intersections: 7 });
    // Re-inlining the two 241.13 leaves plus the 241.15 + 241.16 leaves restores
    // 85 = 55 + 6 + 9 + 6 + 7 + 6 + 2 - 6;
    // re-inlining the two 241.14 leaves on top restores the 241.12 shape
    // 102 = 85 + 13 + 6 - 2.
    expect(leafMemberDescriptors(AL_LEAF, 'alignment', AL_ALIAS).length).toBe(6);
    expect(leafMemberDescriptors(PC_LEAF, 'parcel', PC_ALIAS).length).toBe(9);
    expect(counts.total + 6 + 9 + 6 + 7 + 6 + 2 - 6).toBe(85);
    expect(leafMemberDescriptors(
      abs('src/engine/cad/cadTransactionsPrimitiveDrawCommandTypes.ts'), 'primitive', 'CadPrimitiveDrawCommandPayload').length).toBe(13);
    expect(leafMemberDescriptors(
      abs('src/engine/cad/cadTransactionsBasicCurveCommandTypes.ts'), 'basiccurve', 'CadBasicCurveCommandPayload').length).toBe(6);
    expect(counts.total + 6 + 9 + 13 + 6 + 6 + 7 + 6 + 2 - 8).toBe(102);
  });

  it('splices both groups with neighbor sentinels in the original position', () => {
    const seq = hubMemberSequence();
    // STRUCT-241.14 roll-forward: TANGENT_CURVE now arrives via the
    // basic-curve alias, so the run anchors on that alias reference.
    const basiccurve = seq.findIndex((m) => m.kind === 'ref' && m.label === 'CadBasicCurveCommandPayload');
    expect(seq[basiccurve]).toEqual({ kind: 'ref', label: 'CadBasicCurveCommandPayload' });
    // Alignment group sits immediately after the basic-curve group; parcel
    // group immediately after alignment; LINETABLE intersection immediately
    // after.
    expect(seq[basiccurve + 1]).toEqual({ kind: 'ref', label: AL_ALIAS });
    expect(seq[basiccurve + 2]).toEqual({ kind: 'ref', label: PC_ALIAS });
    expect(seq[basiccurve + 3]).toEqual({ kind: 'intersection', label: 'LINETABLE' });
  });

  it('keeps the six table intersections, seven parcel-management refs, and styles in order', () => {
    const seq = hubMemberSequence();
    const linetable = seq.findIndex((m) => m.kind === 'intersection' && m.label === 'LINETABLE');
    expect(seq.slice(linetable, linetable + 6)).toEqual([
      { kind: 'intersection', label: 'LINETABLE' },
      { kind: 'intersection', label: 'CURVETABLE' },
      { kind: 'intersection', label: 'PARCELTABLE' },
      { kind: 'intersection', label: 'POINTTABLE' },
      { kind: 'intersection', label: 'PARCELREPORT' },
      { kind: 'intersection', label: 'PARCELDESC' },
    ]);
    expect(seq.slice(linetable + 6, linetable + 13)).toEqual(
      [...EXPECTED_PARCEL_MANAGEMENT_REFS].map((label) => ({ kind: 'ref', label })),
    );
    expect(seq[linetable + 13]).toEqual({ kind: 'intersection', label: 'TABLESTYLE' });
    expect(seq[linetable + 14]).toEqual({ kind: 'inline', label: 'SURVEYTABLE_EDIT' });
  });

  it('flattens to the exact 168 effective members in the original sequence', () => {
    const flat = hubFlattenedKeys();
    expect(flat.length).toBe(168);
    // TANGENT_CURVE anchors the run at flattened index 23.
    expect(flat[23]).toBe('TANGENT_CURVE');
    expect(flat.slice(24, 30)).toEqual([...EXPECTED_ALIGNMENT_DESCRIPTORS]);
    expect(flat.slice(30, 39)).toEqual([...EXPECTED_PARCEL_DESCRIPTORS]);
    expect(flat[39]).toBe('LINETABLE');
    expect(flat.slice(39, 45)).toEqual([
      'LINETABLE', 'CURVETABLE', 'PARCELTABLE', 'POINTTABLE', 'PARCELREPORT', 'PARCELDESC',
    ]);
    expect(flat.slice(45, 52)).toEqual([...EXPECTED_PARCEL_MANAGEMENT_REFS]);
    expect(flat[52]).toBe('TABLESTYLE');
    expect(flat[53]).toBe('SURVEYTABLE_EDIT');
  });

  it('leaves no inline alignment/parcel-construction key behind in the hub union', () => {
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
    for (const probe of ["key: 'ALIGNMENT_CREATE'", "key: 'ALIGNMENT_STATION_EQUATION'", "key: 'PARCEL_SPLIT_SLIDE'", "key: 'PARCELCOURSEARC'", "key: 'PARCEL_LAYOUT_AUTO'"]) {
      expect(hubText, `hub still carries ${probe}`).not.toContain(probe);
    }
  });

  it('retires the CadParcelLayoutSettings specifier from the hub', () => {
    const hubText = fs.readFileSync(HUB, 'utf8');
    expect(hubText.split('CadParcelLayoutSettings').length - 1).toBe(0);
    // The hub still references the primitive identity alias elsewhere.
    expect(hubText).toContain('CadEntityId');
  });
});

describe('STRUCT-241.13 CadCommandKey unchanged', () => {
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

  it('keeps the alignment and parcel-construction key runs in their original positions', () => {
    const keys = hubKeyOrder();
    expect(keys.slice(keys.indexOf('ALIGNMENT_CREATE'), keys.indexOf('ALIGNMENT_CREATE') + 6)).toEqual(
      [...EXPECTED_ALIGNMENT_DESCRIPTORS],
    );
    expect(keys[keys.indexOf('TANGENT_CURVE') + 1]).toBe('ALIGNMENT_CREATE');
    expect(keys[keys.indexOf('ALIGNMENT_INTERVAL_POINTS') + 1]).toBe('PARCEL_CREATE');
    expect(keys.slice(keys.indexOf('PARCEL_CREATE'), keys.indexOf('PARCEL_CREATE') + 9)).toEqual(
      [...EXPECTED_PARCEL_DESCRIPTORS],
    );
    expect(keys[keys.indexOf('PARCEL_LAYOUT_AUTO') + 1]).toBe('LINETABLE');
  });
});

describe('STRUCT-241.13 public transaction types unchanged', () => {
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
    const definitionProbe: CadCommandDefinition<CadCommand> = { key: 'PARCEL_SPLIT_SLIDE', execute: () => null };
    const transactionProbe: CadTransaction = {
      id: 't-1', sequence: 1, commandKey: 'ALIGNMENT_CREATE', label: 'create',
      beforeSelectionIds: [], afterSelectionIds: [], addedEntityIds: [], removedEntityIds: [],
    };
    expect([definitionProbe.key, transactionProbe.commandKey]).toEqual(['PARCEL_SPLIT_SLIDE', 'ALIGNMENT_CREATE']);
    expectTypeOf<CadCommand extends { key: string } ? true : false>().toEqualTypeOf<true>();
  });
});

describe('STRUCT-241.13 type-only leaves and emit parity', () => {
  it('alignment leaf imports exactly the allow-listed type module', () => {
    expect(runtimeImportSpecifiers(AL_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(AL_LEAF)).toBe(true);
    expect(valueStatementKinds(AL_LEAF)).toEqual([]);
    expect(allImportSpecifiers(AL_LEAF)).toEqual(['./cadCorePrimitiveTypes']);
    expect(importBindingsBySpecifier(AL_LEAF)).toEqual([
      { specifier: './cadCorePrimitiveTypes', names: ['CadEntityId'] },
    ]);
  });

  it('parcel-construction leaf imports exactly the allow-listed type modules', () => {
    expect(runtimeImportSpecifiers(PC_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(PC_LEAF)).toBe(true);
    expect(valueStatementKinds(PC_LEAF)).toEqual([]);
    expect(allImportSpecifiers(PC_LEAF)).toEqual([
      './cadCorePrimitiveTypes',
      './cadParcelLayoutTypes',
    ]);
    expect(importBindingsBySpecifier(PC_LEAF)).toEqual([
      { specifier: './cadCorePrimitiveTypes', names: ['CadEntityId'] },
      { specifier: './cadParcelLayoutTypes', names: ['CadParcelLayoutSettings'] },
    ]);
  });

  it('transpiled emit is marker-only for the hub and both leaves', () => {
    expect(strippedEmit(HUB)).toBe('export {};');
    expect(strippedEmit(AL_LEAF)).toBe('export {};');
    expect(strippedEmit(PC_LEAF)).toBe('export {};');
    expect(createHash('sha256').update(strippedEmit(HUB)).digest('hex'))
      .toBe(EXPECTED_HUB_EMIT_SHA256);
  });
});

describe('STRUCT-241.13 alignment/parcel regression neighbours covered by import existence', () => {
  it.each([
    'cad_parcel_command_payload_1954',
    'cad_cogo_parcel_runtime_cycle_19512',
    'cad_parcel_layout_grip_snap_type_leaves_2417',
    'cad_linear_design_parcel_entity_type_leaves_2416',
    'landxml_import_alignments_18l',
    'cad_parcel_curved_splits_19c',
    'cad_parcel_network_19d',
    'cad_parcel_shared_edit_19d',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });

  it('alignment and parcel command engine modules exist', () => {
    for (const relative of [
      'src/engine/cad/cadTransactionsAlignmentCommands.ts',
      'src/engine/cad/cadTransactionsParcelBasicCommands.ts',
      'src/engine/cad/cadTransactionsParcelLayoutCommands.ts',
      'src/engine/cad/cadTransactionsParcelCourseCommands.ts',
      'src/engine/cad/cadTransactionsParcelAutoLayoutCommand.ts',
    ]) {
      expect(fs.existsSync(abs(relative)), `engine module missing: ${relative}`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.13 extraction is type-only: +2 nodes / +5 type edges (2 hub
// imports + 1 alignment out-edge + 2 parcel out-edges; zero retired module
// edges — the hub keeps its ./cadTypes barrel edge and never imported
// ./cadParcelLayoutTypes directly). Both historical value/mixed digests stay
// identical.
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

describe('STRUCT-241.13 CAD+F2F graph pins', () => {
  // First cold graph parse in this file; allow headroom under full-suite CI contention.
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // Post-241.13 baseline 507 / 2475; the two type-only leaves add +2 nodes
    // and +3 type edges (2 hub imports + 2 primitive-draw out-edges + 0
    // basic-curve out-edges - 1 retired hub tangent-solver edge).
    // STRUCT-241.16 roll-forward: 513 / 2486 (+2 nodes, +3 type edges:
    // 2 hub imports + 1 polyline out-edge + 0 sheet out-edges).
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
    const alLeaf = path.resolve(AL_LEAF);
    const pcLeaf = path.resolve(PC_LEAF);
    expect(graph.edges.filter((edge) => edge.from === alLeaf).map((edge) => edge.specifier).sort()).toEqual([
      './cadCorePrimitiveTypes',
    ]);
    expect(graph.edges.filter((edge) => edge.from === pcLeaf).map((edge) => edge.specifier).sort()).toEqual([
      './cadCorePrimitiveTypes',
      './cadParcelLayoutTypes',
    ]);
    expect(graph.edges.filter((edge) => edge.to === alLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: alLeaf,
        specifier: './cadTransactionsAlignmentCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter((edge) => edge.to === pcLeaf)).toEqual([
      {
        from: path.resolve(HUB), to: pcLeaf,
        specifier: './cadTransactionsParcelConstructionCommandTypes', kind: 'type',
      },
    ]);
    expect(graph.edges.filter(
      (edge) => (edge.from === alLeaf || edge.to === alLeaf || edge.from === pcLeaf || edge.to === pcLeaf)
        && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('keeps the ./cadTypes barrel edge and never routes the hub through cadParcelLayoutTypes', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    // The hub still imports identities and project types from the barrel.
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadTypes.ts')),
    ).length).toBeGreaterThan(0);
    // The hub never imported the layout leaf directly (settings arrived via
    // the barrel); the parcel leaf now owns that edge instead.
    expect(graph.edges.filter(
      (edge) => edge.from === hub && edge.to === path.resolve(path.join(CAD_DIR, 'cadParcelLayoutTypes.ts')),
    )).toEqual([]);
  });

  it('has no leaf back-edge to the transaction hub or command executors', () => {
    const graph = cadF2fGraph();
    const hub = path.resolve(HUB);
    for (const leaf of [path.resolve(AL_LEAF), path.resolve(PC_LEAF)]) {
      for (const target of [
        hub,
        path.resolve(path.join(CAD_DIR, 'cadTransactions.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsAlignmentCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsParcelBasicCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsParcelLayoutCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsParcelCourseCommands.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactionsParcelAutoLayoutCommand.ts')),
      ]) {
        expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
      }
      expect(graph.edges.filter((edge) => edge.from === leaf && edge.kind !== 'type')).toEqual([]);
    }
  });
});

describe('STRUCT-241.13 full-src graph pins', () => {
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
    // STRUCT-241.16 roll-forward: 1685 / 7597 (same +2 / +3).
    expect(graph.nodes.length).toBe(1686);
    expect(graph.edges.length).toBe(7600);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4447,
      uniqPairs: 4388,
      sha: 'e1bad92e1864e6093b9399f95e08464d1fa3e1bbb94f3767bbaa6017205bc410',
    });
  }, 120_000);
});

describe('STRUCT-241.13 negative controls (in-memory mutations only)', () => {
  const alSource = (): string => fs.readFileSync(AL_LEAF, 'utf8');
  const pcSource = (): string => fs.readFileSync(PC_LEAF, 'utf8');
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('fails the shape pin when ALIGNMENT_CREATE sourceEntityIds widens to string[]', () => {
    const mutated = alSource().replace(
      '      sourceEntityIds: CadEntityId[];',
      '      sourceEntityIds: string[];',
    );
    expect(mutated).not.toBe(alSource());
    const create = variantShapesFromSource(parseText('m.ts', mutated), 'm', AL_ALIAS)
      .find((v) => v.key === 'ALIGNMENT_CREATE')!;
    expect(() => expect(create.props).toEqual(EXPECTED_ALIGNMENT_SHAPES.ALIGNMENT_CREATE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when ALIGNMENT_CREATE name becomes required', () => {
    const mutated = alSource().replace(
      "      sourceEntityIds: CadEntityId[];\n      name?: string;\n      startStation?: number;",
      "      sourceEntityIds: CadEntityId[];\n      name: string;\n      startStation?: number;",
    );
    expect(mutated).not.toBe(alSource());
    const create = variantShapesFromSource(parseText('m.ts', mutated), 'm', AL_ALIAS)
      .find((v) => v.key === 'ALIGNMENT_CREATE')!;
    expect(() => expect(create.props).toEqual(EXPECTED_ALIGNMENT_SHAPES.ALIGNMENT_CREATE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when STATION_EQUATION backStation becomes optional', () => {
    const mutated = alSource().replace(
      '      backStation: number;\n      aheadStation: number;',
      '      backStation?: number;\n      aheadStation: number;',
    );
    expect(mutated).not.toBe(alSource());
    const equation = variantShapesFromSource(parseText('m.ts', mutated), 'm', AL_ALIAS)
      .find((v) => v.key === 'ALIGNMENT_STATION_EQUATION')!;
    expect(() => expect(equation.props).toEqual(EXPECTED_ALIGNMENT_SHAPES.ALIGNMENT_STATION_EQUATION!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when STATION_EQUATION aheadStation is dropped', () => {
    const mutated = alSource().replace(
      '      backStation: number;\n      aheadStation: number;',
      '      backStation: number;',
    );
    expect(mutated).not.toBe(alSource());
    const equation = variantShapesFromSource(parseText('m.ts', mutated), 'm', AL_ALIAS)
      .find((v) => v.key === 'ALIGNMENT_STATION_EQUATION')!;
    expect(() => expect(equation.props).toEqual(EXPECTED_ALIGNMENT_SHAPES.ALIGNMENT_STATION_EQUATION!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when INTERVAL_POINTS startStation becomes required', () => {
    const mutated = alSource().replace(
      '      interval: number;\n      startStation?: number;',
      '      interval: number;\n      startStation: number;',
    );
    expect(mutated).not.toBe(alSource());
    const points = variantShapesFromSource(parseText('m.ts', mutated), 'm', AL_ALIAS)
      .find((v) => v.key === 'ALIGNMENT_INTERVAL_POINTS')!;
    expect(() => expect(points.props).toEqual(EXPECTED_ALIGNMENT_SHAPES.ALIGNMENT_INTERVAL_POINTS!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when PARCEL_CREATE sourceEntityIds becomes optional', () => {
    const mutated = pcSource().replace(
      "      key: 'PARCEL_CREATE';\n      sourceEntityIds: CadEntityId[];",
      "      key: 'PARCEL_CREATE';\n      sourceEntityIds?: CadEntityId[];",
    );
    expect(mutated).not.toBe(pcSource());
    const create = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCEL_CREATE')!;
    expect(() => expect(create.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCEL_CREATE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when PARCEL_SPLIT splitLineEntityId weakens to string', () => {
    const mutated = pcSource().replace(
      '      splitLineEntityId: CadEntityId;',
      '      splitLineEntityId: string;',
    );
    expect(mutated).not.toBe(pcSource());
    const split = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCEL_SPLIT')!;
    expect(() => expect(split.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCEL_SPLIT!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when SPLIT_BEARING throughPointLabel becomes required', () => {
    const mutated = pcSource().replace(
      '      throughPointY: number;\n      throughPointLabel?: string;\n      bearing: string;',
      '      throughPointY: number;\n      throughPointLabel: string;\n      bearing: string;',
    );
    expect(mutated).not.toBe(pcSource());
    const bearing = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCEL_SPLIT_BEARING')!;
    expect(() => expect(bearing.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCEL_SPLIT_BEARING!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when SPLIT_AREA targetAreaSquareMeters becomes optional', () => {
    const mutated = pcSource().replace(
      '      throughPointLabel?: string;\n      targetAreaSquareMeters: number;\n    }\n  | {\n      key: \'PARCEL_SPLIT_SLIDE\';',
      '      throughPointLabel?: string;\n      targetAreaSquareMeters?: number;\n    }\n  | {\n      key: \'PARCEL_SPLIT_SLIDE\';',
    );
    expect(mutated).not.toBe(pcSource());
    const area = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCEL_SPLIT_AREA')!;
    expect(() => expect(area.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCEL_SPLIT_AREA!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when SLIDE frontageEntityId loses its nullability', () => {
    const mutated = pcSource().replace(
      "      parcelEntityId: CadEntityId;\n      frontageEntityId?: CadEntityId | null;\n      frontageParcelSegmentIds?: string[] | null;\n      targetAreaSquareMeters: number;\n      minFrontageMeters: number;\n      alternative: 'start' | 'end';\n      settings: CadParcelLayoutSettings;\n    }\n  | {\n      key: 'PARCEL_SPLIT_SWING';",
      "      parcelEntityId: CadEntityId;\n      frontageEntityId?: CadEntityId;\n      frontageParcelSegmentIds?: string[] | null;\n      targetAreaSquareMeters: number;\n      minFrontageMeters: number;\n      alternative: 'start' | 'end';\n      settings: CadParcelLayoutSettings;\n    }\n  | {\n      key: 'PARCEL_SPLIT_SWING';",
    );
    expect(mutated).not.toBe(pcSource());
    const slide = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCEL_SPLIT_SLIDE')!;
    expect(() => expect(slide.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCEL_SPLIT_SLIDE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when SWING frontageParcelSegmentIds loses its nullability', () => {
    const mutated = pcSource().replace(
      "      key: 'PARCEL_SPLIT_SWING';\n      parcelEntityId: CadEntityId;\n      frontageEntityId?: CadEntityId | null;\n      frontageParcelSegmentIds?: string[] | null;",
      "      key: 'PARCEL_SPLIT_SWING';\n      parcelEntityId: CadEntityId;\n      frontageEntityId?: CadEntityId | null;\n      frontageParcelSegmentIds?: string[];",
    );
    expect(mutated).not.toBe(pcSource());
    const swing = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCEL_SPLIT_SWING')!;
    expect(() => expect(swing.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCEL_SPLIT_SWING!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when the slide/swing alternative literal order swaps', () => {
    const mutated = pcSource().replace(
      "      alternative: 'start' | 'end';\n      settings: CadParcelLayoutSettings;\n    }\n  | {\n      key: 'PARCEL_SPLIT_SWING';",
      "      alternative: 'end' | 'start';\n      settings: CadParcelLayoutSettings;\n    }\n  | {\n      key: 'PARCEL_SPLIT_SWING';",
    );
    expect(mutated).not.toBe(pcSource());
    const slide = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCEL_SPLIT_SLIDE')!;
    expect(() => expect(slide.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCEL_SPLIT_SLIDE!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when LAYOUT_AUTO tool loses the swing discriminator', () => {
    const mutated = pcSource().replace(
      "      tool: 'slide' | 'swing';",
      "      tool: 'slide';",
    );
    expect(mutated).not.toBe(pcSource());
    const auto = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCEL_LAYOUT_AUTO')!;
    expect(() => expect(auto.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCEL_LAYOUT_AUTO!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when LAYOUT_AUTO settings weakens off CadParcelLayoutSettings', () => {
    const mutated = pcSource().replace(
      "      tool: 'slide' | 'swing';\n      settings: CadParcelLayoutSettings;",
      "      tool: 'slide' | 'swing';\n      settings: unknown;",
    );
    expect(mutated).not.toBe(pcSource());
    const auto = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCEL_LAYOUT_AUTO')!;
    expect(() => expect(auto.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCEL_LAYOUT_AUTO!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when PARCELCOURSEARC arcEntityId is dropped', () => {
    const mutated = pcSource().replace(
      "      courseId: string;\n      arcEntityId: CadEntityId;\n    }\n  | {\n      key: 'PARCELCOURSELINE';",
      "      courseId: string;\n    }\n  | {\n      key: 'PARCELCOURSELINE';",
    );
    expect(mutated).not.toBe(pcSource());
    const arc = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCELCOURSEARC')!;
    expect(() => expect(arc.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCELCOURSEARC!.map(pinShape)))
      .toThrow();
  });

  it('fails the shape pin when PARCELCOURSELINE courseId widens to number', () => {
    const mutated = pcSource().replace(
      "      key: 'PARCELCOURSELINE';\n      parcelEntityId: CadEntityId;\n      courseId: string;",
      "      key: 'PARCELCOURSELINE';\n      parcelEntityId: CadEntityId;\n      courseId: number;",
    );
    expect(mutated).not.toBe(pcSource());
    const line = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS)
      .find((v) => v.key === 'PARCELCOURSELINE')!;
    expect(() => expect(line.props).toEqual(EXPECTED_PARCEL_SHAPES.PARCELCOURSELINE!.map(pinShape)))
      .toThrow();
  });

  it('fails the splice guard when the hub drops the alignment splice', () => {
    const source = hubSource();
    const refLine = `  | ${AL_ALIAS}\n`;
    expect(source).toContain(refLine);
    const mutated = source.replace(refLine, '');
    expect(mutated).not.toBe(source);
    const counts = hubTopLevelCounts(parseText('mutated-hub.ts', mutated));
    expect(() => expect(counts).toEqual({ total: 55, inline: 11, refs: 37, intersections: 7 })).toThrow();
    const flat = hubFlattenedKeys(parseText('mutated-hub.ts', mutated));
    expect(() => expect(flat.length).toBe(168)).toThrow();
  });

  it('fails the splice guard when the hub drops the parcel splice', () => {
    const source = hubSource();
    const refLine = `  | ${PC_ALIAS}\n`;
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
      .replace(`  | ${AL_ALIAS}\n`, '__SWAP_AL__\n')
      .replace(`  | ${PC_ALIAS}\n`, `  | ${AL_ALIAS}\n`)
      .replace('__SWAP_AL__\n', `  | ${PC_ALIAS}\n`);
    expect(mutated).not.toBe(source);
    const seq = hubMemberSequence(parseText('mutated-hub.ts', mutated));
    const basiccurve = seq.findIndex((m) => m.kind === 'ref' && m.label === 'CadBasicCurveCommandPayload');
    expect(() => expect(seq[basiccurve + 1]).toEqual({ kind: 'ref', label: AL_ALIAS })).toThrow();
  });

  it('fails the ordering guard when parcel variants reorder', () => {
    const source = pcSource();
    const shapes = variantShapesFromSource(parseText('leaf.ts', source), 'leaf', PC_ALIAS);
    const slide = shapes.find((v) => v.key === 'PARCEL_SPLIT_SLIDE')!.text;
    const swing = shapes.find((v) => v.key === 'PARCEL_SPLIT_SWING')!.text;
    const mutated = source.replace(slide, '__SWAP__').replace(swing, slide).replace('__SWAP__', swing);
    expect(mutated).not.toBe(source);
    const swapped = variantShapesFromSource(parseText('m.ts', mutated), 'm', PC_ALIAS);
    expect(swapped.map((v) => v.key)).toHaveLength(9);
    expect(() => expect(swapped.map((v) => v.key)).toEqual([...EXPECTED_PARCEL_DESCRIPTORS])).toThrow();
  });

  it('fails the acyclicity guard on a synthetic TYPE back-edge to the hub', () => {
    const mutated = `${alSource()}\nimport type { CadCommand } from './cadTransactions.types';\ntype BackEdge = CadCommand;\n`;
    expect(mutated).not.toBe(alSource());
    // Extract the specifier list from the MUTATED text (not the pristine
    // file): the back-edge must be visible to the same helper the allowlist
    // pin uses, and the allowlist pin must reject it.
    const mutatedSpecs = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(allImportSpecifiers(AL_LEAF)).not.toContain('./cadTransactions.types');
    expect(mutatedSpecs).toContain('./cadTransactions.types');
    expect(() => expect(mutatedSpecs).toEqual(allImportSpecifiers(AL_LEAF))).toThrow();
  });

  it('fails the type-only guard on a synthetic VALUE import from a runtime module', () => {
    const mutated = pcSource().replace(
      "import type { CadParcelLayoutSettings } from './cadParcelLayoutTypes';",
      "import { CadParcelLayoutSettings } from './cadParcelLayoutTypes';",
    );
    expect(mutated).not.toBe(pcSource());
    const runtime = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt))
      .filter((stmt) => stmt.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword)
      .map((stmt) => stmt.moduleSpecifier.getText());
    expect(runtime).toContain("'./cadParcelLayoutTypes'");
    expect(() => expect(runtime).toEqual([])).toThrow();
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(AL_LEAF, 'utf8')).toBe(alSource());
    expect(fs.readFileSync(PC_LEAF, 'utf8')).toBe(pcSource());
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
