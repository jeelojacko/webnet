/**
 * STRUCT-241.5 — CAD annotation + survey-table type leaves.
 *
 * Pins `src/engine/cad/cadAnnotationEntityStyleTypes.ts` (12 Phase 18O
 * professional annotation entity/style contracts) and
 * `src/engine/cad/cadSurveyTableEntityTypes.ts` (7 Phase 19A drawing survey
 * table contracts), extracted verbatim out of `src/engine/cad/cadTypes.ts`
 * so the hub keeps every historic `from './cadTypes'` consumer compiling
 * via `export type` re-exports:
 *
 * - `CadMTextAttachment` — 9-point mtext attachment union.
 * - `CadMTextEntity` — mtext annotation entity.
 * - `CadLeaderEntity` — leader annotation entity.
 * - `CadDimensionKind` — dimension kind union.
 * - `CadDimensionEntity` — dimension annotation entity.
 * - `CadBearingDistanceLabelEntity` — bearing/distance label entity.
 * - `CadCurveLabelEntity` — curve label entity.
 * - `CadDimensionStyle` — dimension style table entry.
 * - `CadLeaderStyle` — leader style table entry.
 * - `CadBearingLabelStyle` — bearing/distance label style table entry.
 * - `CadCurveLabelField` — curve label field union.
 * - `CadCurveLabelStyle` — curve label style table entry.
 * - `CadSurveyTableKind` — survey table kind union.
 * - `CadSurveyTableRowSource` — discriminated row source reference union.
 * - `CadSurveyTableRow` — row identity + source + tag overrides.
 * - `CadSurveyTableTagSettings` — tag visibility/prefix/style/offset.
 * - `CadSurveyTableColumnOverride` — per-column visibility + heading.
 * - `CadSurveyTableEntity` — placement + style + row list entity.
 * - `CadSurveyTableStyle` — display-only survey table style.
 *
 * Covers: hand-transcribed pre-refactor interface/alias shape pins (ordered
 * props, optionality, normalized type text) for all 19 declarations;
 * declaration order in each leaf; union literal branch order; both-direction
 * facade-vs-leaf `expectTypeOf` equality for all 19; all 19 historic public
 * re-exports with no leftover original declarations in the hub; the exact
 * `CadEntity` 19-union order; the exact `CadBlockChild` 6-union order;
 * type-only + emit pins (hub emit byte-identical, each leaf `export {};`);
 * CAD+F2F and full-`src` graph pins rolled forward by the measured
 * type-only delta (+2 nodes / +8 scoped edges, +2 nodes / +8 full edges)
 * with both historical value/mixed digests unchanged; and in-memory
 * negative controls.
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
  CadBearingDistanceLabelEntity as HubBearingDistanceLabelEntity,
  CadBearingLabelStyle as HubBearingLabelStyle,
  CadCurveLabelEntity as HubCurveLabelEntity,
  CadCurveLabelField as HubCurveLabelField,
  CadCurveLabelStyle as HubCurveLabelStyle,
  CadDimensionEntity as HubDimensionEntity,
  CadDimensionKind as HubDimensionKind,
  CadDimensionStyle as HubDimensionStyle,
  CadLeaderEntity as HubLeaderEntity,
  CadLeaderStyle as HubLeaderStyle,
  CadMTextAttachment as HubMTextAttachment,
  CadMTextEntity as HubMTextEntity,
  CadSurveyTableColumnOverride as HubSurveyTableColumnOverride,
  CadSurveyTableEntity as HubSurveyTableEntity,
  CadSurveyTableKind as HubSurveyTableKind,
  CadSurveyTableRow as HubSurveyTableRow,
  CadSurveyTableRowSource as HubSurveyTableRowSource,
  CadSurveyTableStyle as HubSurveyTableStyle,
  CadSurveyTableTagSettings as HubSurveyTableTagSettings,
} from '../src/engine/cad/cadTypes';
import type {
  CadBearingDistanceLabelEntity as AnnBearingDistanceLabelEntity,
  CadBearingLabelStyle as AnnBearingLabelStyle,
  CadCurveLabelEntity as AnnCurveLabelEntity,
  CadCurveLabelField as AnnCurveLabelField,
  CadCurveLabelStyle as AnnCurveLabelStyle,
  CadDimensionEntity as AnnDimensionEntity,
  CadDimensionKind as AnnDimensionKind,
  CadDimensionStyle as AnnDimensionStyle,
  CadLeaderEntity as AnnLeaderEntity,
  CadLeaderStyle as AnnLeaderStyle,
  CadMTextAttachment as AnnMTextAttachment,
  CadMTextEntity as AnnMTextEntity,
} from '../src/engine/cad/cadAnnotationEntityStyleTypes';
import type {
  CadSurveyTableColumnOverride as TabSurveyTableColumnOverride,
  CadSurveyTableEntity as TabSurveyTableEntity,
  CadSurveyTableKind as TabSurveyTableKind,
  CadSurveyTableRow as TabSurveyTableRow,
  CadSurveyTableRowSource as TabSurveyTableRowSource,
  CadSurveyTableStyle as TabSurveyTableStyle,
  CadSurveyTableTagSettings as TabSurveyTableTagSettings,
} from '../src/engine/cad/cadSurveyTableEntityTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const HUB = path.join(CAD_DIR, 'cadTypes.ts');
const ANN_LEAF = path.join(CAD_DIR, 'cadAnnotationEntityStyleTypes.ts');
const TAB_LEAF = path.join(CAD_DIR, 'cadSurveyTableEntityTypes.ts');
const FOUNDATION_LEAF = path.join(CAD_DIR, 'cadEntityFoundationTypes.ts');
const ANCHOR_LEAF = path.join(CAD_DIR, 'annotation', 'cadAnnotationAnchorTypes.ts');

/** The twelve annotation contracts, in original source order. */
const MOVED_ANNOTATION = [
  'CadMTextAttachment',
  'CadMTextEntity',
  'CadLeaderEntity',
  'CadDimensionKind',
  'CadDimensionEntity',
  'CadBearingDistanceLabelEntity',
  'CadCurveLabelEntity',
  'CadDimensionStyle',
  'CadLeaderStyle',
  'CadBearingLabelStyle',
  'CadCurveLabelField',
  'CadCurveLabelStyle',
];

/** The seven survey-table contracts, in original source order. */
const MOVED_SURVEY_TABLE = [
  'CadSurveyTableKind',
  'CadSurveyTableRowSource',
  'CadSurveyTableRow',
  'CadSurveyTableTagSettings',
  'CadSurveyTableColumnOverride',
  'CadSurveyTableEntity',
  'CadSurveyTableStyle',
];

/** All nineteen moved contracts, family order preserved. */
const MOVED_19 = [...MOVED_ANNOTATION, ...MOVED_SURVEY_TABLE];

/** Annotation interfaces (the three unions are pinned separately). */
const ANN_INTERFACES = MOVED_ANNOTATION.filter(
  (name) => name !== 'CadMTextAttachment' && name !== 'CadDimensionKind' && name !== 'CadCurveLabelField',
);

/** Survey-table interfaces (the two unions are pinned separately). */
const TAB_INTERFACES = MOVED_SURVEY_TABLE.filter(
  (name) => name !== 'CadSurveyTableKind' && name !== 'CadSurveyTableRowSource',
);

const relPosix = (absolute: string): string => path.relative(REPO_ROOT, absolute).split(path.sep).join('/');

// ---------------------------------------------------------------------------
// TypeScript compiler helpers.
// ---------------------------------------------------------------------------

const parseText = (file: string, text: string): ts.SourceFile =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const parse = (file: string): ts.SourceFile => parseText(file, fs.readFileSync(file, 'utf8'));

/** Collapse whitespace so formatting drift cannot mask (or fake) type drift. */
const norm = (text: string): string => text.replace(/\s+/g, '');

const findDecl = (source: ts.SourceFile, label: string, name: string): ts.InterfaceDeclaration | ts.TypeAliasDeclaration => {
  const decl = source.statements.find(
    (stmt): stmt is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) && stmt.name.text === name,
  );
  if (!decl) throw new Error(`${label}: declaration ${name} missing`);
  return decl;
};

/** Ordered `name?: type` pins for an interface declaration. */
const propsOf = (source: ts.SourceFile, label: string, name: string): string[] => {
  const decl = findDecl(source, label, name);
  if (!ts.isInterfaceDeclaration(decl)) throw new Error(`${label}: ${name} is not an interface`);
  return decl.members
    .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
    .map((m) => norm(`${m.name.getText()}${m.questionToken ? '?' : ''}:${m.type?.getText() ?? 'never'}`));
};

const aliasTextOf = (source: ts.SourceFile, label: string, name: string): string => {
  const decl = findDecl(source, label, name);
  if (!ts.isTypeAliasDeclaration(decl)) throw new Error(`${label}: ${name} is not a type alias`);
  return norm(decl.type.getText());
};

/** The `type` discriminant literal text of an entity interface. */
const discriminantOf = (source: ts.SourceFile, label: string, name: string): string => {
  const decl = findDecl(source, label, name);
  if (!ts.isInterfaceDeclaration(decl)) throw new Error(`${label}: ${name} is not an interface`);
  const prop = decl.members.find(
    (m): m is ts.PropertySignature => ts.isPropertySignature(m) && m.name.getText() === 'type',
  );
  if (!prop?.type) throw new Error(`${label}: ${name} has no type discriminant`);
  return norm(prop.type.getText());
};

/** Ordered union member texts (flattening nested parenthesized unions). */
const unionMembers = (source: ts.SourceFile, label: string, name: string): string[] => {
  const decl = findDecl(source, label, name);
  if (!ts.isTypeAliasDeclaration(decl)) throw new Error(`${label}: ${name} is not a type alias`);
  const out: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    const flat = ts.isParenthesizedTypeNode(node) ? node.type : node;
    if (ts.isUnionTypeNode(flat)) {
      flat.types.forEach(visit);
      return;
    }
    out.push(norm(flat.getText()));
  };
  visit(decl.type);
  return out;
};

/** Exported interface/type-alias names in declaration order. */
const exportedDeclNames = (source: ts.SourceFile): string[] =>
  source.statements
    .filter((stmt): stmt is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))
      && (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false))
    .map((stmt) => stmt.name.text);

/** Module specifiers reached by a runtime (non-`import type`) edge. */
const runtimeImportSpecifiersSource = (source: ts.SourceFile): string[] => {
  const out: string[] = [];
  for (const stmt of source.statements) {
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

const runtimeImportSpecifiers = (file: string): string[] => runtimeImportSpecifiersSource(parse(file));

const allImportSpecifiers = (file: string): string[] =>
  parse(file).statements
    .filter((stmt): stmt is ts.ImportDeclaration =>
      ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

/** Every import declaration must be type-only (`import type` or type-only bindings). */
const hasOnlyTypeImportsSource = (source: ts.SourceFile): boolean => {
  for (const stmt of source.statements) {
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

const hasOnlyTypeImports = (file: string): boolean => hasOnlyTypeImportsSource(parse(file));

/** Non-type statement kinds (value declarations leak a runtime export surface). */
const valueStatementKindsSource = (source: ts.SourceFile): string[] =>
  source.statements
    .filter((stmt) =>
      ts.isFunctionDeclaration(stmt)
      || ts.isVariableStatement(stmt)
      || ts.isClassDeclaration(stmt)
      || ts.isEnumDeclaration(stmt))
    .map((stmt) => ts.SyntaxKind[stmt.kind]);

const valueStatementKinds = (file: string): string[] => valueStatementKindsSource(parse(file));

/** Transpiled ES-module emit with comments stripped (type-only => `export {};`). */
const strippedEmit = (file: string): string =>
  ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, removeComments: true },
  }).outputText.trim();

// ---------------------------------------------------------------------------
// Hand-transcribed pre-refactor shape pins (from the exact-main baseline;
// eyeball-verified against cadTypes.ts before extraction).
// ---------------------------------------------------------------------------

/** Interface pins: ordered `name[?]:type` with whitespace collapsed. */
const EXPECTED_INTERFACE_PROPS: Record<string, string[]> = {
  CadMTextEntity: [
    "type:'mtext'",
    'x:number',
    'y:number',
    'text:string',
    'textStyleId:CadTextStyleId',
    'rotationDeg:number',
    'attachment:CadMTextAttachment',
  ],
  CadLeaderEntity: [
    "type:'leader'",
    'arrowAnchor:CadAnnotationAnchor',
    'vertices:{x:number;y:number}[]',
    'text:string',
    'leaderStyleId:string',
    'textStyleId?:CadTextStyleId',
    'textAttachment?:CadMTextAttachment',
  ],
  CadDimensionEntity: [
    "type:'dimension'",
    'dimensionKind:CadDimensionKind',
    'anchors:CadAnnotationAnchor[]',
    'defPoint1?:CadAnnotationAnchor',
    'defPoint2?:CadAnnotationAnchor',
    "orientation?:'horizontal'|'vertical'|'aligned'",
    'dimLinePoint:{x:number;y:number}',
    'textPoint?:{x:number;y:number}',
    'dimensionStyleId:string',
    'textOverride?:string',
  ],
  CadBearingDistanceLabelEntity: [
    "type:'bearing-label'",
    'sourceEntityId:CadEntityId',
    'labelStyleId:string',
    'offset:{x:number;y:number}',
    "side?:'left'|'right'|'auto'",
    'manualTextOverride?:string',
  ],
  CadCurveLabelEntity: [
    "type:'curve-label'",
    'sourceEntityId:CadEntityId',
    'labelStyleId:string',
    'offset:{x:number;y:number}',
    'manualTextOverride?:string',
  ],
  CadDimensionStyle: [
    'id:string',
    'name:string',
    'textStyleId:CadTextStyleId',
    'arrowBlockDefinitionId:string',
    'arrowSize:number',
    "arrowSizeMode?:'model'|'paper'",
    'textGap:number',
    'extensionOffset:number',
    'extensionOvershoot:number',
    'decimalPrecision:number',
    'prefix?:string',
    'suffix?:string',
  ],
  CadLeaderStyle: [
    'id:string',
    'name:string',
    'textStyleId:CadTextStyleId',
    'arrowBlockDefinitionId:string',
    'arrowSize:number',
    "arrowSizeMode?:'model'|'paper'",
    'landingLength:number',
    'textGap:number',
  ],
  CadBearingLabelStyle: [
    'id:string',
    'name:string',
    'textStyleId:CadTextStyleId',
    "content:'bearing'|'distance'|'bearing-distance'|'distance-bearing'",
    "separator:'newline'|'space'|'slash'",
    'offset:{x:number;y:number}',
    'decimalPrecision:number',
  ],
  CadCurveLabelStyle: [
    'id:string',
    'name:string',
    'textStyleId:CadTextStyleId',
    'fields:CadCurveLabelField[]',
    'offset:{x:number;y:number}',
    'decimalPrecision:number',
  ],
  CadSurveyTableRow: [
    'id:string',
    'source:CadSurveyTableRowSource',
    'customCode?:string',
    'tagOffset?:{dx:number;dy:number}',
    'showTag?:boolean',
  ],
  CadSurveyTableTagSettings: [
    'showTags?:boolean',
    'tagPrefix?:string',
    'tagTextStyleId?:CadTextStyleId',
    'tagOffset?:{dx:number;dy:number}',
  ],
  CadSurveyTableColumnOverride: [
    'key:string',
    'visible?:boolean',
    'heading?:string',
  ],
  CadSurveyTableEntity: [
    "type:'survey-table'",
    'tableKind:CadSurveyTableKind',
    'x:number',
    'y:number',
    'rotationDeg:number',
    'tableStyleId:string',
    'rows:CadSurveyTableRow[]',
    'title?:string',
    'prefix?:string',
    'startNumber?:number',
    'showHeader?:boolean',
    'showTitle?:boolean',
    'tagSettings?:CadSurveyTableTagSettings',
    'columnOverrides?:CadSurveyTableColumnOverride[]',
  ],
  CadSurveyTableStyle: [
    'id:string',
    'name:string',
    'textStyleId:CadTextStyleId',
    'headerTextStyleId?:CadTextStyleId',
    'rowHeight:number',
    "rowHeightMode:'model'|'paper'",
    'cellPadding:number',
    "cellPaddingMode:'model'|'paper'",
    'borderWidth:number',
    'showOuterBorder:boolean',
    'showInnerGrid:boolean',
    "headerAlignment:'left'|'center'|'right'",
    "bodyAlignment:'left'|'center'|'right'",
    'titleGap:number',
    'description?:string',
  ],
};

/** Type-alias pins: whitespace-collapsed alias target text. */
const EXPECTED_ALIAS_TEXT: Record<string, string> = {
  CadMTextAttachment: "|'top-left'|'top-center'|'top-right'|'middle-left'|'middle-center'|'middle-right'|'bottom-left'|'bottom-center'|'bottom-right'",
  CadDimensionKind: "'linear'|'aligned'|'angular'|'radius'|'diameter'",
  CadCurveLabelField: "'radius'|'delta'|'length'|'chord'",
  CadSurveyTableKind: "'line'|'curve'|'parcel-course'|'parcel-summary'|'point'",
  CadSurveyTableRowSource: "|{kind:'line';entityId:CadEntityId}|{kind:'arc';entityId:CadEntityId}|{kind:'parcel-course';parcelId:CadEntityId;courseId:string}|{kind:'parcel';parcelId:CadEntityId}|{kind:'survey-point';entityId:CadEntityId}",
};

/** Entity discriminant literal pins. */
const EXPECTED_DISCRIMINANTS: Record<string, string> = {
  CadMTextEntity: "'mtext'",
  CadLeaderEntity: "'leader'",
  CadDimensionEntity: "'dimension'",
  CadBearingDistanceLabelEntity: "'bearing-label'",
  CadCurveLabelEntity: "'curve-label'",
  CadSurveyTableEntity: "'survey-table'",
};

/** Union literal branch order pins (whitespace collapsed). */
const EXPECTED_UNION_BRANCHES: Record<string, string[]> = {
  CadMTextAttachment: [
    "'top-left'", "'top-center'", "'top-right'",
    "'middle-left'", "'middle-center'", "'middle-right'",
    "'bottom-left'", "'bottom-center'", "'bottom-right'",
  ],
  CadDimensionKind: ["'linear'", "'aligned'", "'angular'", "'radius'", "'diameter'"],
  CadCurveLabelField: ["'radius'", "'delta'", "'length'", "'chord'"],
  CadSurveyTableKind: ["'line'", "'curve'", "'parcel-course'", "'parcel-summary'", "'point'"],
  CadSurveyTableRowSource: [
    "{kind:'line';entityId:CadEntityId}",
    "{kind:'arc';entityId:CadEntityId}",
    "{kind:'parcel-course';parcelId:CadEntityId;courseId:string}",
    "{kind:'parcel';parcelId:CadEntityId}",
    "{kind:'survey-point';entityId:CadEntityId}",
  ],
};

/** Exact `CadEntity` union order (unchanged by the type-only extraction). */
const EXPECTED_CAD_ENTITY_ORDER = [
  'CadSurveyTableEntity',
  'CadSurveyPointEntity',
  'CadLineEntity',
  'CadPolylineEntity',
  'CadArcEntity',
  'CadCircleEntity',
  'CadAlignmentEntity',
  'CadPolygonEntity',
  'CadParcelEntity',
  'CadTextEntity',
  'CadErrorEllipseEntity',
  'CadParabolaEntity',
  'CadBlockReferenceEntity',
  'CadMTextEntity',
  'CadLeaderEntity',
  'CadDimensionEntity',
  'CadBearingDistanceLabelEntity',
  'CadCurveLabelEntity',
  'CadFeatureLineEntity',
];

/** Exact `CadBlockChild` union order — parabolas are deliberately excluded. */
const EXPECTED_CAD_BLOCK_CHILD_ORDER = [
  'CadLineEntity',
  'CadPolylineEntity',
  'CadArcEntity',
  'CadCircleEntity',
  'CadPolygonEntity',
  'CadTextEntity',
];

const ANN_SPECIFIER = './cadAnnotationEntityStyleTypes';
const TAB_SPECIFIER = './cadSurveyTableEntityTypes';

const hubSource = (): string => fs.readFileSync(HUB, 'utf8');
const annSource = (): string => fs.readFileSync(ANN_LEAF, 'utf8');
const tabSource = (): string => fs.readFileSync(TAB_LEAF, 'utf8');

/** Raw source text of a hub facade `import type` / `export type` block. */
const facadeBlockTextOf = (source: string, specifier: string, kind: 'import' | 'export'): string => {
  const file = parseText('hub.ts', source);
  const stmt = file.statements.find((candidate) => {
    if (kind === 'import') {
      return ts.isImportDeclaration(candidate)
        && ts.isStringLiteral(candidate.moduleSpecifier)
        && candidate.moduleSpecifier.text === specifier;
    }
    return ts.isExportDeclaration(candidate)
      && candidate.moduleSpecifier != null
      && ts.isStringLiteral(candidate.moduleSpecifier)
      && candidate.moduleSpecifier.text === specifier;
  });
  if (!stmt) throw new Error(`hub facade ${kind} block for ${specifier} missing`);
  return stmt.getText(file);
};

// ---------------------------------------------------------------------------
// Leaf presence, order, and verbatim shapes.
// ---------------------------------------------------------------------------

describe('STRUCT-241.5 leaf presence and declaration order', () => {
  it('both leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(ANN_LEAF)).toBe(true);
    expect(fs.existsSync(TAB_LEAF)).toBe(true);
  });

  it('annotation leaf declares exactly the 12 contracts in original order', () => {
    expect(exportedDeclNames(parse(ANN_LEAF))).toEqual(MOVED_ANNOTATION);
  });

  it('survey-table leaf declares exactly the 7 contracts in original order', () => {
    expect(exportedDeclNames(parse(TAB_LEAF))).toEqual(MOVED_SURVEY_TABLE);
  });

  it('the two leaves own disjoint name sets with no cross-import', () => {
    expect(new Set([...MOVED_ANNOTATION, ...MOVED_SURVEY_TABLE]).size).toBe(19);
    expect(allImportSpecifiers(ANN_LEAF)).not.toContain(TAB_SPECIFIER);
    expect(allImportSpecifiers(TAB_LEAF)).not.toContain(ANN_SPECIFIER);
  });
});

describe('STRUCT-241.5 baseline annotation interface shapes pinned verbatim', () => {
  it.each(ANN_INTERFACES)('annotation leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(ANN_LEAF), 'annotation leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.5 baseline survey-table interface shapes pinned verbatim', () => {
  it.each(TAB_INTERFACES)('survey-table leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(TAB_LEAF), 'survey-table leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.5 baseline alias and discriminant shapes pinned verbatim', () => {
  it.each(Object.keys(EXPECTED_ALIAS_TEXT))('leaf alias %s matches the hand-transcribed alias', (name) => {
    const file = MOVED_ANNOTATION.includes(name) ? parse(ANN_LEAF) : parse(TAB_LEAF);
    const label = MOVED_ANNOTATION.includes(name) ? 'annotation leaf' : 'survey-table leaf';
    expect(aliasTextOf(file, label, name)).toBe(EXPECTED_ALIAS_TEXT[name]);
  });

  it.each(Object.keys(EXPECTED_DISCRIMINANTS))('leaf %s keeps its discriminant literal', (name) => {
    const file = MOVED_ANNOTATION.includes(name) ? parse(ANN_LEAF) : parse(TAB_LEAF);
    const label = MOVED_ANNOTATION.includes(name) ? 'annotation leaf' : 'survey-table leaf';
    expect(discriminantOf(file, label, name)).toBe(EXPECTED_DISCRIMINANTS[name]);
  });

  it.each(Object.keys(EXPECTED_UNION_BRANCHES))('leaf union %s keeps its literal branch order', (name) => {
    const file = MOVED_ANNOTATION.includes(name) ? parse(ANN_LEAF) : parse(TAB_LEAF);
    const label = MOVED_ANNOTATION.includes(name) ? 'annotation leaf' : 'survey-table leaf';
    expect(unionMembers(file, label, name)).toEqual(EXPECTED_UNION_BRANCHES[name]);
  });
});

// ---------------------------------------------------------------------------
// Facade contract: hub re-exports all 19, keeps no originals.
// ---------------------------------------------------------------------------

describe('STRUCT-241.5 hub facade re-exports', () => {
  it('re-exports all 12 annotation names from the new annotation leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${ANN_SPECIFIER}';`);
    for (const name of MOVED_ANNOTATION) {
      expect(source).toContain(`  ${name},`);
    }
  });

  it('re-exports all 7 survey-table names from the new survey-table leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${TAB_SPECIFIER}';`);
    for (const name of MOVED_SURVEY_TABLE) {
      expect(source).toContain(`  ${name},`);
    }
  });

  it('keeps no original interface/alias declaration for any moved name', () => {
    const source = hubSource();
    for (const name of MOVED_19) {
      expect(source).not.toContain(`export interface ${name} `);
      expect(source).not.toContain(`export interface ${name}{`);
      expect(source).not.toContain(`export type ${name} =`);
    }
  });

  it('imports both new leaves type-only for local use', () => {
    const hub = parse(HUB);
    const typeImports = hub.statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)
        && stmt.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword)
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(typeImports).toContain(ANN_SPECIFIER);
    expect(typeImports).toContain(TAB_SPECIFIER);
  });

  it('keeps the CadEntity union declaration in the hub', () => {
    expect(hubSource()).toContain('export type CadEntity =');
  });
});

// ---------------------------------------------------------------------------
// Facade-vs-leaf type equality, bidirectional (all 19).
// ---------------------------------------------------------------------------

describe('STRUCT-241.5 annotation facade vs leaf type equality', () => {
  it('CadMTextAttachment equality holds both directions', () => {
    expectTypeOf<AnnMTextAttachment>().toEqualTypeOf<HubMTextAttachment>();
    expectTypeOf<HubMTextAttachment>().toEqualTypeOf<AnnMTextAttachment>();
  });
  it('CadMTextEntity equality holds both directions', () => {
    expectTypeOf<AnnMTextEntity>().toEqualTypeOf<HubMTextEntity>();
    expectTypeOf<HubMTextEntity>().toEqualTypeOf<AnnMTextEntity>();
  });
  it('CadLeaderEntity equality holds both directions', () => {
    expectTypeOf<AnnLeaderEntity>().toEqualTypeOf<HubLeaderEntity>();
    expectTypeOf<HubLeaderEntity>().toEqualTypeOf<AnnLeaderEntity>();
  });
  it('CadDimensionKind equality holds both directions', () => {
    expectTypeOf<AnnDimensionKind>().toEqualTypeOf<HubDimensionKind>();
    expectTypeOf<HubDimensionKind>().toEqualTypeOf<AnnDimensionKind>();
  });
  it('CadDimensionEntity equality holds both directions', () => {
    expectTypeOf<AnnDimensionEntity>().toEqualTypeOf<HubDimensionEntity>();
    expectTypeOf<HubDimensionEntity>().toEqualTypeOf<AnnDimensionEntity>();
  });
  it('CadBearingDistanceLabelEntity equality holds both directions', () => {
    expectTypeOf<AnnBearingDistanceLabelEntity>().toEqualTypeOf<HubBearingDistanceLabelEntity>();
    expectTypeOf<HubBearingDistanceLabelEntity>().toEqualTypeOf<AnnBearingDistanceLabelEntity>();
  });
  it('CadCurveLabelEntity equality holds both directions', () => {
    expectTypeOf<AnnCurveLabelEntity>().toEqualTypeOf<HubCurveLabelEntity>();
    expectTypeOf<HubCurveLabelEntity>().toEqualTypeOf<AnnCurveLabelEntity>();
  });
  it('CadDimensionStyle equality holds both directions', () => {
    expectTypeOf<AnnDimensionStyle>().toEqualTypeOf<HubDimensionStyle>();
    expectTypeOf<HubDimensionStyle>().toEqualTypeOf<AnnDimensionStyle>();
  });
  it('CadLeaderStyle equality holds both directions', () => {
    expectTypeOf<AnnLeaderStyle>().toEqualTypeOf<HubLeaderStyle>();
    expectTypeOf<HubLeaderStyle>().toEqualTypeOf<AnnLeaderStyle>();
  });
  it('CadBearingLabelStyle equality holds both directions', () => {
    expectTypeOf<AnnBearingLabelStyle>().toEqualTypeOf<HubBearingLabelStyle>();
    expectTypeOf<HubBearingLabelStyle>().toEqualTypeOf<AnnBearingLabelStyle>();
  });
  it('CadCurveLabelField equality holds both directions', () => {
    expectTypeOf<AnnCurveLabelField>().toEqualTypeOf<HubCurveLabelField>();
    expectTypeOf<HubCurveLabelField>().toEqualTypeOf<AnnCurveLabelField>();
  });
  it('CadCurveLabelStyle equality holds both directions', () => {
    expectTypeOf<AnnCurveLabelStyle>().toEqualTypeOf<HubCurveLabelStyle>();
    expectTypeOf<HubCurveLabelStyle>().toEqualTypeOf<AnnCurveLabelStyle>();
  });
});

describe('STRUCT-241.5 survey-table facade vs leaf type equality', () => {
  it('CadSurveyTableKind equality holds both directions', () => {
    expectTypeOf<TabSurveyTableKind>().toEqualTypeOf<HubSurveyTableKind>();
    expectTypeOf<HubSurveyTableKind>().toEqualTypeOf<TabSurveyTableKind>();
  });
  it('CadSurveyTableRowSource equality holds both directions', () => {
    expectTypeOf<TabSurveyTableRowSource>().toEqualTypeOf<HubSurveyTableRowSource>();
    expectTypeOf<HubSurveyTableRowSource>().toEqualTypeOf<TabSurveyTableRowSource>();
  });
  it('CadSurveyTableRow equality holds both directions', () => {
    expectTypeOf<TabSurveyTableRow>().toEqualTypeOf<HubSurveyTableRow>();
    expectTypeOf<HubSurveyTableRow>().toEqualTypeOf<TabSurveyTableRow>();
  });
  it('CadSurveyTableTagSettings equality holds both directions', () => {
    expectTypeOf<TabSurveyTableTagSettings>().toEqualTypeOf<HubSurveyTableTagSettings>();
    expectTypeOf<HubSurveyTableTagSettings>().toEqualTypeOf<TabSurveyTableTagSettings>();
  });
  it('CadSurveyTableColumnOverride equality holds both directions', () => {
    expectTypeOf<TabSurveyTableColumnOverride>().toEqualTypeOf<HubSurveyTableColumnOverride>();
    expectTypeOf<HubSurveyTableColumnOverride>().toEqualTypeOf<TabSurveyTableColumnOverride>();
  });
  it('CadSurveyTableEntity equality holds both directions', () => {
    expectTypeOf<TabSurveyTableEntity>().toEqualTypeOf<HubSurveyTableEntity>();
    expectTypeOf<HubSurveyTableEntity>().toEqualTypeOf<TabSurveyTableEntity>();
  });
  it('CadSurveyTableStyle equality holds both directions', () => {
    expectTypeOf<TabSurveyTableStyle>().toEqualTypeOf<HubSurveyTableStyle>();
    expectTypeOf<HubSurveyTableStyle>().toEqualTypeOf<TabSurveyTableStyle>();
  });
});

// ---------------------------------------------------------------------------
// Unaffected hub unions: CadEntity order, CadBlockChild order, child type.
// ---------------------------------------------------------------------------

describe('STRUCT-241.5 unaffected hub unions', () => {
  it('keeps the 19-member CadEntity union order exact', () => {
    expect(unionMembers(parse(HUB), 'hub', 'CadEntity')).toEqual(EXPECTED_CAD_ENTITY_ORDER);
  });

  it('keeps the CadBlockChild union member order exact and excludes parabolas', () => {
    const members = unionMembers(parse(HUB), 'hub', 'CadBlockChild');
    expect(members).toEqual(EXPECTED_CAD_BLOCK_CHILD_ORDER);
    expect(members).not.toContain('CadParabolaEntity');
  });

  it('keeps CadBlockChildType as the CadBlockChild discriminant index', () => {
    expect(aliasTextOf(parse(HUB), 'hub', 'CadBlockChildType')).toBe("CadBlockChild['type']");
  });
});

// ---------------------------------------------------------------------------
// Type-only leaves and runtime emit parity.
// ---------------------------------------------------------------------------

describe('STRUCT-241.5 type-only leaves and emit parity', () => {
  it('annotation leaf has zero runtime imports, zero value declarations, allowlisted type edges', () => {
    expect(runtimeImportSpecifiers(ANN_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(ANN_LEAF)).toBe(true);
    expect(valueStatementKinds(ANN_LEAF)).toEqual([]);
    expect(allImportSpecifiers(ANN_LEAF)).toEqual([
      './cadEntityFoundationTypes',
      './annotation/cadAnnotationAnchorTypes',
      './cadCorePrimitiveTypes',
    ]);
  });

  it('survey-table leaf has zero runtime imports, zero value declarations, allowlisted type edges', () => {
    expect(runtimeImportSpecifiers(TAB_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(TAB_LEAF)).toBe(true);
    expect(valueStatementKinds(TAB_LEAF)).toEqual([]);
    expect(allImportSpecifiers(TAB_LEAF)).toEqual([
      './cadEntityFoundationTypes',
      './cadCorePrimitiveTypes',
    ]);
  });

  it('neither leaf imports cadTypes, a barrel, or an engine runtime module', () => {
    for (const file of [ANN_LEAF, TAB_LEAF]) {
      const specifiers = allImportSpecifiers(file);
      expect(specifiers).not.toContain('./cadTypes');
      expect(specifiers).not.toContain('./cadTransactions.types');
      for (const specifier of specifiers) {
        expect(specifier.endsWith('cadTypes')).toBe(false);
        expect(specifier.endsWith('cadTransactions.types')).toBe(false);
      }
    }
  });

  it('both transpiled leaf emits are marker-only', () => {
    expect(strippedEmit(ANN_LEAF)).toBe('export {};');
    expect(strippedEmit(TAB_LEAF)).toBe('export {};');
  });

  it('hub runtime emit is byte-identical to the exact-main baseline', () => {
    expect(strippedEmit(HUB).length).toBe(680);
    expect(createHash('sha256').update(strippedEmit(HUB)).digest('hex'))
      .toBe('3744535788de61cc48666898669382da2312a59764ce06a96dc017936319d454');
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.5 extraction is type-only, so both VALUE|mixed digests are
// unchanged; the explicit TYPE allowlist adds +2 nodes / +8 scoped edges
// (per leaf: hub import-type + hub export-type + owner-leaf out-edges;
// minus the retired hub -> anchor import-type edge) and +2 nodes / +8 full
// edges (every 241.5 edge resolves inside `src`, so the full-scope delta
// matches the scoped delta here).
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

describe('STRUCT-241.5 CAD+F2F graph pins', () => {
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph(); // first/cold scoped build; 30 s tolerates full-suite CI load
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // 241.4 baseline 489 / 2416; the type-only 241.5 leaves add +2 nodes and
    // +8 type edges (annotation: 3 out + hub import + hub export; survey:
    // 2 out + hub import + hub export; minus the retired hub -> anchor
    // import-type edge whose local uses all moved to the annotation leaf).
    expect(graph.nodes.length).toBe(491);
    expect(graph.edges.length).toBe(2424);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  }, 30_000);

  it('adds exactly the allow-listed TYPE edges incident to the annotation leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(ANN_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: path.resolve(ANCHOR_LEAF), specifier: './annotation/cadAnnotationAnchorTypes', kind: 'type' },
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts')), specifier: './cadCorePrimitiveTypes', kind: 'type' },
      { from: leaf, to: path.resolve(FOUNDATION_LEAF), specifier: './cadEntityFoundationTypes', kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: ANN_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('adds exactly the allow-listed TYPE edges incident to the survey-table leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(TAB_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts')), specifier: './cadCorePrimitiveTypes', kind: 'type' },
      { from: leaf, to: path.resolve(FOUNDATION_LEAF), specifier: './cadEntityFoundationTypes', kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: TAB_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('has no leaf back-edge to the hub or to engine runtime modules', () => {
    const graph = cadF2fGraph();
    for (const leaf of [path.resolve(ANN_LEAF), path.resolve(TAB_LEAF)]) {
      for (const target of [
        path.resolve(HUB),
        path.resolve(path.join(CAD_DIR, 'cadStyles.ts')),
        path.resolve(path.join(CAD_DIR, 'cadPointStyles.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactions.types.ts')),
      ]) {
        expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
      }
    }
  });
});

describe('STRUCT-241.5 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // 241.4 baseline 1661 / 7527; the 241.5 leaves add +2 nodes and +8 type
    // edges (same allowlist as the scoped pin; every 241.5 edge resolves
    // inside `src`, including the retired hub -> anchor edge).
    expect(graph.nodes.length).toBe(1663);
    expect(graph.edges.length).toBe(7535);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4444,
      uniqPairs: 4385,
      sha: '415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448',
    });
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Negative controls (in-memory mutations only).
// ---------------------------------------------------------------------------

describe('STRUCT-241.5 negative controls (in-memory mutations only)', () => {
  it('fails the alias pin when a CadMTextAttachment member changes', () => {
    const mutated = annSource().replace("'middle-center' | 'middle-right'", "'middle-center' | 'center-right'");
    expect(mutated).not.toBe(annSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadMTextAttachment'))
      .toBe(EXPECTED_ALIAS_TEXT['CadMTextAttachment'])).toThrow();
  });

  it('fails the alias pin when CadDimensionKind gains a sixth branch', () => {
    const mutated = annSource().replace(
      "export type CadDimensionKind = 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter';",
      "export type CadDimensionKind = 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter' | 'oblique';",
    );
    expect(mutated).not.toBe(annSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadDimensionKind'))
      .toBe(EXPECTED_ALIAS_TEXT['CadDimensionKind'])).toThrow();
  });

  it('fails the shape pin when the optional leader text attachment becomes required', () => {
    const mutated = annSource().replace('  textAttachment?: CadMTextAttachment;', '  textAttachment: CadMTextAttachment;');
    expect(mutated).not.toBe(annSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadLeaderEntity'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadLeaderEntity'])).toThrow();
  });

  it('fails the shape pin when the optional dimension anchor becomes required', () => {
    const mutated = annSource().replace('  defPoint1?: CadAnnotationAnchor;', '  defPoint1: CadAnnotationAnchor;');
    expect(mutated).not.toBe(annSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadDimensionEntity'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadDimensionEntity'])).toThrow();
  });

  it('fails the alias pin when a CadSurveyTableRowSource discriminant changes', () => {
    const mutated = tabSource().replace(
      "  | { kind: 'parcel-course'; parcelId: CadEntityId; courseId: string }",
      "  | { kind: 'parcel-leg'; parcelId: CadEntityId; courseId: string }",
    );
    expect(mutated).not.toBe(tabSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadSurveyTableRowSource'))
      .toBe(EXPECTED_ALIAS_TEXT['CadSurveyTableRowSource'])).toThrow();
  });

  it('fails the alias pin when parcel/course ids widen to plain strings', () => {
    const mutated = tabSource().replace(
      "  | { kind: 'parcel'; parcelId: CadEntityId }",
      "  | { kind: 'parcel'; parcelId: string }",
    );
    expect(mutated).not.toBe(tabSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadSurveyTableRowSource'))
      .toBe(EXPECTED_ALIAS_TEXT['CadSurveyTableRowSource'])).toThrow();
  });

  it('fails the shape pin when the row course id becomes optional', () => {
    const mutated = tabSource().replace(
      "  | { kind: 'parcel-course'; parcelId: CadEntityId; courseId: string }",
      "  | { kind: 'parcel-course'; parcelId: CadEntityId; courseId?: string }",
    );
    expect(mutated).not.toBe(tabSource());
    // Object-member optionality lives inside the union text, so the alias
    // pin (not the row interface pin) is the detector here.
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadSurveyTableRowSource'))
      .toBe(EXPECTED_ALIAS_TEXT['CadSurveyTableRowSource'])).toThrow();
  });

  it('fails the shape pin when tag override optionality changes', () => {
    const mutated = tabSource().replace('  tagTextStyleId?: CadTextStyleId;', '  tagTextStyleId: CadTextStyleId;');
    expect(mutated).not.toBe(tabSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurveyTableTagSettings'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurveyTableTagSettings'])).toThrow();
  });

  it('detects a removed public re-export from the hub facade', () => {
    const hub = hubSource();
    // Withdraw ONLY the export-type entry; the local `import type` stays, so
    // the hub still typechecks locally against the leaf while the public
    // re-export surface is the thing under test.
    const exportBlock = facadeBlockTextOf(hub, TAB_SPECIFIER, 'export');
    const mutatedExportBlock = exportBlock.replace('  CadSurveyTableEntity,\n', '');
    expect(mutatedExportBlock).not.toBe(exportBlock);
    const mutated = hub.replace(exportBlock, mutatedExportBlock);
    expect(mutated).not.toBe(hub);
    // Import block retains the name (local resolution intact); export block
    // is where the absence must be observed, not the whole hub.
    expect(facadeBlockTextOf(mutated, TAB_SPECIFIER, 'import')).toContain('  CadSurveyTableEntity,');
    const mutatedExport = facadeBlockTextOf(mutated, TAB_SPECIFIER, 'export');
    expect(mutatedExport).not.toContain('  CadSurveyTableEntity,');
    for (const name of MOVED_SURVEY_TABLE) {
      if (name === 'CadSurveyTableEntity') continue;
      expect(mutatedExport).toContain(`  ${name},`);
    }
  });

  it('fails the CadEntity union-order pin when two members are swapped', () => {
    const hub = hubSource();
    const mutated = hub.replace(
      '  | CadSurveyTableEntity\n  | CadSurveyPointEntity\n',
      '  | CadSurveyPointEntity\n  | CadSurveyTableEntity\n',
    );
    expect(mutated).not.toBe(hub);
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadEntity'))
      .toEqual(EXPECTED_CAD_ENTITY_ORDER)).toThrow();
  });

  it('catches a simulated leaf-to-hub TYPE back-edge as a new TYPE cycle', () => {
    const mutatedLeaf = `${annSource()}\nimport type { CadProject } from './cadTypes';\nexport type CycleProbe = CadProject | null;\n`;
    const graph = buildGraphs([
      { path: path.resolve(ANN_LEAF), source: mutatedLeaf },
      { path: path.resolve(HUB), source: hubSource() },
    ]);
    const typeCycles = findCycles(graph.nodes, graph.type);
    const cyclic = new Set(typeCycles.cyclic.flat());
    expect(cyclic.has(path.resolve(ANN_LEAF))).toBe(true);
    expect(cyclic.has(path.resolve(HUB))).toBe(true);
  });

  it('detects a simulated value import on the survey leaf as a runtime edge', () => {
    const mutated = tabSource().replace(
      "import type { CadBaseEntity } from './cadEntityFoundationTypes';",
      "import { CadBaseEntity } from './cadEntityFoundationTypes';",
    );
    expect(mutated).not.toBe(tabSource());
    expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(false);
    expect(runtimeImportSpecifiersSource(parseText('m.ts', mutated))).toEqual(['./cadEntityFoundationTypes']);
    const graph = buildGraphs([
      { path: path.resolve(TAB_LEAF), source: mutated },
      { path: path.resolve(FOUNDATION_LEAF), source: fs.readFileSync(FOUNDATION_LEAF, 'utf8') },
    ]);
    expect(graph.edges.filter((edge) => edge.from === path.resolve(TAB_LEAF) && edge.kind === 'value')).toHaveLength(1);
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(ANN_LEAF, 'utf8')).toBe(annSource());
    expect(fs.readFileSync(TAB_LEAF, 'utf8')).toBe(tabSource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
  });
});

describe('STRUCT-241.5 prior phase guards stay green by import existence', () => {
  it.each([
    'cad_survey_layer_command_type_leaves_2411',
    'cad_block_command_type_leaf_2412',
    'cad_entity_style_presentation_type_leaves_2413',
    'cad_primitive_geometry_entity_type_leaf_2414',
    'cad_annotation_cogo_type_cycle_1957',
    'cad_annotation_persistence',
    'cad_annotation_renderer',
    'cad_survey_table_19a',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });
});
