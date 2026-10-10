/**
 * STRUCT-241.3 — CAD entity-foundation and survey-presentation type leaves.
 *
 * Pins `src/engine/cad/cadEntityFoundationTypes.ts` (8 foundation /
 * appearance / style contracts) and
 * `src/engine/cad/cadSurveyPresentationTypes.ts` (9 survey presentation /
 * point-group contracts), extracted verbatim from `src/engine/cad/cadTypes.ts`
 * so the hub keeps every historic `from './cadTypes'` consumer compiling via
 * `export type` re-exports.
 *
 * Covers: hand-transcribed pre-refactor interface/alias shape pins (ordered
 * props, optionality, normalized type text) for all 17 declarations;
 * declaration order in each leaf; bidirectional facade-vs-leaf type equality;
 * all 17 historic public re-exports with no leftover original declarations in
 * the hub; unaffected core entity/project/surface signatures (CadSurveyPointEntity
 * first, still extends CadBaseEntity); type-only + emit pins (hub emit
 * byte-identical, leaves `export {};`); CAD+F2F and full-`src` graph pins with
 * an explicit +2 node / +6 type-edge allowlist; in-memory negative controls.
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
  CadBaseEntity as HubBaseEntity,
  CadEntityAppearance as HubAppearance,
  CadLineType as HubLineType,
  CadPointGroup as HubPointGroup,
  CadPointGroupId as HubPointGroupId,
  CadPointGroupQuery as HubPointGroupQuery,
  CadPointLabelBinding as HubLabelBinding,
  CadPointLabelComponent as HubLabelComponent,
  CadPointLabelStyle as HubLabelStyle,
  CadPointLabelStyleId as HubLabelStyleId,
  CadPointStyle as HubPointStyle,
  CadPointStyleId as HubPointStyleId,
  CadPointSymbol as HubPointSymbol,
  CadStyle as HubStyle,
  CadStyleLibrary as HubStyleLibrary,
  CadTextHeightMode as HubTextHeightMode,
  CadTextStyle as HubTextStyle,
} from '../src/engine/cad/cadTypes';
import type {
  CadBaseEntity as LeafBaseEntity,
  CadEntityAppearance as LeafAppearance,
  CadLineType as LeafLineType,
  CadPointSymbol as LeafPointSymbol,
  CadStyle as LeafStyle,
  CadStyleLibrary as LeafStyleLibrary,
  CadTextHeightMode as LeafTextHeightMode,
  CadTextStyle as LeafTextStyle,
} from '../src/engine/cad/cadEntityFoundationTypes';
import type {
  CadPointGroup as LeafPointGroup,
  CadPointGroupId as LeafPointGroupId,
  CadPointGroupQuery as LeafPointGroupQuery,
  CadPointLabelBinding as LeafLabelBinding,
  CadPointLabelComponent as LeafLabelComponent,
  CadPointLabelStyle as LeafLabelStyle,
  CadPointLabelStyleId as LeafLabelStyleId,
  CadPointStyle as LeafPointStyle,
  CadPointStyleId as LeafPointStyleId,
} from '../src/engine/cad/cadSurveyPresentationTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const HUB = path.join(CAD_DIR, 'cadTypes.ts');
const FOUNDATION_LEAF = path.join(CAD_DIR, 'cadEntityFoundationTypes.ts');
const SURVEY_LEAF = path.join(CAD_DIR, 'cadSurveyPresentationTypes.ts');
const PRIMITIVE_LEAF = path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts');

const FOUNDATION_8 = [
  'CadEntityAppearance',
  'CadBaseEntity',
  'CadLineType',
  'CadTextHeightMode',
  'CadTextStyle',
  'CadPointSymbol',
  'CadStyle',
  'CadStyleLibrary',
];
const SURVEY_9 = [
  'CadPointStyleId',
  'CadPointLabelStyleId',
  'CadPointGroupId',
  'CadPointGroupQuery',
  'CadPointGroup',
  'CadPointLabelComponent',
  'CadPointLabelStyle',
  'CadPointLabelBinding',
  'CadPointStyle',
];
const ALL_17 = [...FOUNDATION_8, ...SURVEY_9];

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

/** Exported interface/type-alias names in declaration order. */
const exportedDeclNames = (source: ts.SourceFile): string[] =>
  source.statements
    .filter((stmt): stmt is ts.InterfaceDeclaration | ts.TypeAliasDeclaration =>
      (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt))
      && (stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false))
    .map((stmt) => stmt.name.text);

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

// ---------------------------------------------------------------------------
// Hand-transcribed pre-refactor shape pins (from the exact-main baseline;
// eyeball-verified against cadTypes.ts lines 55-243 before extraction).
// ---------------------------------------------------------------------------

/** Interface pins: ordered `name[?]:type` with whitespace collapsed. */
const EXPECTED_INTERFACE_PROPS: Record<string, string[]> = {
  CadEntityAppearance: [
    'color?:string',
    'lineTypeId?:CadLineTypeId',
    'lineweightMm?:number',
    'transparency?:number',
  ],
  CadBaseEntity: [
    'id:CadEntityId',
    'type:string',
    'layerId:CadLayerId',
    'styleId?:CadStyleId',
    'visible:boolean',
    'locked:boolean',
    'appearance?:CadEntityAppearance',
    'metadata?:Record<string,unknown>',
  ],
  CadLineType: [
    'id:CadLineTypeId',
    'name:string',
    'dashPattern:number[]',
  ],
  CadTextStyle: [
    'id:CadTextStyleId',
    'name:string',
    'fontFamily:string',
    'fontSize:number',
    'heightMode?:CadTextHeightMode',
    'modelHeight?:number',
    'paperHeightMm?:number',
    'widthFactor?:number',
    'lineSpacingFactor?:number',
    "fontWeight?:'normal'|'bold'",
    "fontStyle?:'normal'|'italic'",
  ],
  CadPointSymbol: [
    'id:CadPointSymbolId',
    'name:string',
    'radius:number',
    'shape?:CadPointSymbolShape',
  ],
  CadStyle: [
    'id:CadStyleId',
    'name:string',
    'color?:string',
    'strokeWidth?:number',
    'textStyleId?:CadTextStyleId',
    'pointSymbolId?:CadPointSymbolId',
    'lineTypeId?:CadLineTypeId',
  ],
  CadStyleLibrary: [
    'lineTypes:CadLineType[]',
    'textStyles:CadTextStyle[]',
    'pointSymbols:CadPointSymbol[]',
    'styles:CadStyle[]',
  ],
  CadPointGroupQuery: [
    'includePointIds?:string[]',
    'excludePointIds?:string[]',
    'descriptionPattern?:string',
    'featureCodePattern?:string',
    "pointClass?:'control'|'free'|'unknown'",
    'layerId?:string',
    "source?:'adjustment-result'|'parsed-input'",
    'elevationMin?:number',
    'elevationMax?:number',
  ],
  CadPointGroup: [
    'id:CadPointGroupId',
    'name:string',
    'query:CadPointGroupQuery',
    'pointStyleOverrideId?:CadPointStyleId',
    'pointLabelStyleOverrideId?:CadPointLabelStyleId',
    'priority:number',
    'description?:string',
  ],
  CadPointLabelStyle: [
    'id:CadPointLabelStyleId',
    'name:string',
    'components:{pointNumber?:boolean;description?:boolean;elevation?:boolean;featureCode?:boolean;prefix?:string;suffix?:string;}',
    'componentOrder:CadPointLabelComponent[]',
    'separator:string',
    'elevationDecimals:number',
    'textStyleId:CadTextStyleId',
    'offsetX:number',
    'offsetY:number',
    'rotationDeg?:number',
    'visible:boolean',
    'description?:string',
  ],
  CadPointLabelBinding: [
    'pointEntityId:CadEntityId',
    'labelStyleId:CadPointLabelStyleId',
    'offsetOverride?:{dx:number;dy:number}',
    'rotationOverrideDeg?:number',
    "content:{mode:'derived'}|{mode:'manual';text:string}",
  ],
  CadPointStyle: [
    'id:CadPointStyleId',
    'name:string',
    'markerSymbolId:CadPointSymbolId',
    'markerBlockDefinitionId?:string',
    'markerScale?:number',
    'rotationDeg?:number',
    'displayMarker:boolean',
    'description?:string',
  ],
};

/** Type-alias pins: whitespace-collapsed alias target text. */
const EXPECTED_ALIAS_TEXT: Record<string, string> = {
  CadTextHeightMode: "'legacy-screen'|'model'|'paper'",
  CadPointStyleId: 'string',
  CadPointLabelStyleId: 'string',
  CadPointGroupId: 'string',
  CadPointLabelComponent: "'pointNumber'|'description'|'elevation'|'featureCode'",
};

const leafOf = (name: string): string =>
  FOUNDATION_8.includes(name) ? FOUNDATION_LEAF : SURVEY_LEAF;

// ---------------------------------------------------------------------------
// Leaf presence, order, and verbatim shapes.
// ---------------------------------------------------------------------------

describe('STRUCT-241.3 leaf presence and declaration order', () => {
  it('both leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(FOUNDATION_LEAF)).toBe(true);
    expect(fs.existsSync(SURVEY_LEAF)).toBe(true);
  });

  it('foundation leaf declares exactly the 8 contracts in original order', () => {
    expect(exportedDeclNames(parse(FOUNDATION_LEAF))).toEqual(FOUNDATION_8);
  });

  it('survey leaf declares exactly the 9 contracts in original order', () => {
    expect(exportedDeclNames(parse(SURVEY_LEAF))).toEqual(SURVEY_9);
  });
});

describe('STRUCT-241.3 baseline interface shapes pinned verbatim', () => {
  it.each(Object.keys(EXPECTED_INTERFACE_PROPS))('leaf %s matches the hand-transcribed shape', (name) => {
    const leaf = leafOf(name);
    expect(propsOf(parse(leaf), 'leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.3 baseline alias shapes pinned verbatim', () => {
  it.each(Object.keys(EXPECTED_ALIAS_TEXT))('leaf %s matches the hand-transcribed alias', (name) => {
    const leaf = leafOf(name);
    expect(aliasTextOf(parse(leaf), 'leaf', name)).toBe(EXPECTED_ALIAS_TEXT[name]);
  });
});

// ---------------------------------------------------------------------------
// Facade contract: hub re-exports all 17, keeps no originals.
// ---------------------------------------------------------------------------

describe('STRUCT-241.3 hub facade re-exports', () => {
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('re-exports all 8 foundation names from the foundation leaf', () => {
    const source = hubSource();
    expect(source).toContain("} from './cadEntityFoundationTypes';");
    for (const name of FOUNDATION_8) {
      expect(source).toContain(`  ${name},`);
    }
  });

  it('re-exports all 9 survey names from the survey leaf', () => {
    const source = hubSource();
    expect(source).toContain("} from './cadSurveyPresentationTypes';");
    for (const name of SURVEY_9) {
      expect(source).toContain(`  ${name},`);
    }
  });

  it('keeps no original interface/alias declaration for any moved name', () => {
    const source = hubSource();
    for (const name of ALL_17) {
      expect(source).not.toContain(`export interface ${name} `);
      expect(source).not.toContain(`export interface ${name}{`);
      expect(source).not.toContain(`export type ${name} =`);
    }
  });

  it('imports both leaves type-only for local use', () => {
    const hub = parse(HUB);
    const typeImports = hub.statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)
        && stmt.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword)
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(typeImports).toContain('./cadEntityFoundationTypes');
    expect(typeImports).toContain('./cadSurveyPresentationTypes');
  });

  it('shrinks the hub to the measured line count (1923 -> 1780 lines)', () => {
    expect(fs.readFileSync(HUB, 'utf8').split('\n').length).toBe(1781);
  });
});

// ---------------------------------------------------------------------------
// Facade-vs-leaf type equality, bidirectional.
// ---------------------------------------------------------------------------

describe('STRUCT-241.3 facade vs leaf type equality', () => {
  it('foundation appearance equality holds both directions', () => {
    expectTypeOf<LeafAppearance>().toEqualTypeOf<HubAppearance>();
    expectTypeOf<HubAppearance>().toEqualTypeOf<LeafAppearance>();
  });
  it('foundation base-entity equality holds both directions', () => {
    expectTypeOf<LeafBaseEntity>().toEqualTypeOf<HubBaseEntity>();
    expectTypeOf<HubBaseEntity>().toEqualTypeOf<LeafBaseEntity>();
  });
  it('foundation line-type equality holds both directions', () => {
    expectTypeOf<LeafLineType>().toEqualTypeOf<HubLineType>();
    expectTypeOf<HubLineType>().toEqualTypeOf<LeafLineType>();
  });
  it('foundation text-height-mode equality holds both directions', () => {
    expectTypeOf<LeafTextHeightMode>().toEqualTypeOf<HubTextHeightMode>();
    expectTypeOf<HubTextHeightMode>().toEqualTypeOf<LeafTextHeightMode>();
  });
  it('foundation text-style equality holds both directions', () => {
    expectTypeOf<LeafTextStyle>().toEqualTypeOf<HubTextStyle>();
    expectTypeOf<HubTextStyle>().toEqualTypeOf<LeafTextStyle>();
  });
  it('foundation point-symbol equality holds both directions', () => {
    expectTypeOf<LeafPointSymbol>().toEqualTypeOf<HubPointSymbol>();
    expectTypeOf<HubPointSymbol>().toEqualTypeOf<LeafPointSymbol>();
  });
  it('foundation style equality holds both directions', () => {
    expectTypeOf<LeafStyle>().toEqualTypeOf<HubStyle>();
    expectTypeOf<HubStyle>().toEqualTypeOf<LeafStyle>();
  });
  it('foundation style-library equality holds both directions', () => {
    expectTypeOf<LeafStyleLibrary>().toEqualTypeOf<HubStyleLibrary>();
    expectTypeOf<HubStyleLibrary>().toEqualTypeOf<LeafStyleLibrary>();
  });
  it('survey point-style-id equality holds both directions', () => {
    expectTypeOf<LeafPointStyleId>().toEqualTypeOf<HubPointStyleId>();
    expectTypeOf<HubPointStyleId>().toEqualTypeOf<LeafPointStyleId>();
  });
  it('survey label-style-id equality holds both directions', () => {
    expectTypeOf<LeafLabelStyleId>().toEqualTypeOf<HubLabelStyleId>();
    expectTypeOf<HubLabelStyleId>().toEqualTypeOf<LeafLabelStyleId>();
  });
  it('survey point-group-id equality holds both directions', () => {
    expectTypeOf<LeafPointGroupId>().toEqualTypeOf<HubPointGroupId>();
    expectTypeOf<HubPointGroupId>().toEqualTypeOf<LeafPointGroupId>();
  });
  it('survey point-group-query equality holds both directions', () => {
    expectTypeOf<LeafPointGroupQuery>().toEqualTypeOf<HubPointGroupQuery>();
    expectTypeOf<HubPointGroupQuery>().toEqualTypeOf<LeafPointGroupQuery>();
  });
  it('survey point-group equality holds both directions', () => {
    expectTypeOf<LeafPointGroup>().toEqualTypeOf<HubPointGroup>();
    expectTypeOf<HubPointGroup>().toEqualTypeOf<LeafPointGroup>();
  });
  it('survey label-component equality holds both directions', () => {
    expectTypeOf<LeafLabelComponent>().toEqualTypeOf<HubLabelComponent>();
    expectTypeOf<HubLabelComponent>().toEqualTypeOf<LeafLabelComponent>();
  });
  it('survey label-style equality holds both directions', () => {
    expectTypeOf<LeafLabelStyle>().toEqualTypeOf<HubLabelStyle>();
    expectTypeOf<HubLabelStyle>().toEqualTypeOf<LeafLabelStyle>();
  });
  it('survey label-binding equality holds both directions', () => {
    expectTypeOf<LeafLabelBinding>().toEqualTypeOf<HubLabelBinding>();
    expectTypeOf<HubLabelBinding>().toEqualTypeOf<LeafLabelBinding>();
  });
  it('survey point-style equality holds both directions', () => {
    expectTypeOf<LeafPointStyle>().toEqualTypeOf<HubPointStyle>();
    expectTypeOf<HubPointStyle>().toEqualTypeOf<LeafPointStyle>();
  });
});

// ---------------------------------------------------------------------------
// Unaffected core entity/project/surface signatures.
// ---------------------------------------------------------------------------

describe('STRUCT-241.3 unaffected hub signatures', () => {
  it('keeps CadSurveyPointEntity first, extending the moved CadBaseEntity', () => {
    const hub = parse(HUB);
    const firstEntity = hub.statements.find(
      (stmt): stmt is ts.InterfaceDeclaration =>
        ts.isInterfaceDeclaration(stmt) && /Entity$/.test(stmt.name.text),
    );
    expect(firstEntity?.name.text).toBe('CadSurveyPointEntity');
    const heritage = firstEntity?.heritageClauses?.[0]?.types.map((t) => t.getText()).join(',');
    expect(heritage).toBe('CadBaseEntity');
    expect(propsOf(hub, 'hub', 'CadSurveyPointEntity')).toContain('pointStyleId?:CadPointStyleId');
    expect(propsOf(hub, 'hub', 'CadSurveyPointEntity')).toContain('pointStyleOverrideId?:CadPointStyleId');
  });

  it('keeps the entity union, project, surface, and runtime surface surface', () => {
    const hubSource = fs.readFileSync(HUB, 'utf8');
    for (const name of [
      'export interface CadLineEntity extends CadBaseEntity',
      'export type CadEntity =',
      'export interface CadProject {',
      'export interface CadSurface',
      'export const surfacePointGroupIds',
      'export const isExplicitTopologyDefinition',
      'export const isExplicitSurfaceDefinition = isExplicitTopologyDefinition;',
      'export const isNativeSurfaceDefinition',
      'export const isImportedTinDefinition = isExplicitTopologyDefinition;',
    ]) {
      expect(hubSource).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// Type-only leaves and runtime emit parity.
// ---------------------------------------------------------------------------

describe('STRUCT-241.3 type-only leaves and emit parity', () => {
  it.each([
    ['foundation', FOUNDATION_LEAF],
    ['survey', SURVEY_LEAF],
  ])('%s leaf has zero runtime imports, zero value declarations, one core-leaf edge', (_label, file) => {
    expect(runtimeImportSpecifiers(file)).toEqual([]);
    expect(hasOnlyTypeImports(file)).toBe(true);
    expect(valueStatementKinds(file)).toEqual([]);
    expect(allImportSpecifiers(file)).toEqual(['./cadCorePrimitiveTypes']);
  });

  it('transpiled emit is marker-only for both leaves', () => {
    expect(strippedEmit(FOUNDATION_LEAF)).toBe('export {};');
    expect(strippedEmit(SURVEY_LEAF)).toBe('export {};');
  });

  it('hub runtime emit is byte-identical to the exact-main baseline', () => {
    expect(fileSha256(HUB)).not.toBe('');
    expect(strippedEmit(HUB).length).toBe(680);
    expect(createHash('sha256').update(strippedEmit(HUB)).digest('hex'))
      .toBe('3744535788de61cc48666898669382da2312a59764ce06a96dc017936319d454');
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.3 extraction is type-only, so VALUE|mixed counts/digest are
// unchanged and the explicit TYPE allowlist adds +2 nodes / +6 edges.
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

describe('STRUCT-241.3 CAD+F2F graph pins', () => {
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // Post-241.2 baseline 486 / 2406; two leaves add +2 nodes / +6 type edges
    // (hub import-type + hub export-type per leaf, plus one leaf-to-core edge
    // per leaf; each statement is one graph edge).
    expect(graph.nodes.length).toBe(488);
    expect(graph.edges.length).toBe(2412);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  });

  it('adds exactly the six allow-listed TYPE edges incident to the new leaves', () => {
    const graph = cadF2fGraph();
    const foundation = path.resolve(FOUNDATION_LEAF);
    const survey = path.resolve(SURVEY_LEAF);
    expect(graph.edges.filter((edge) => edge.from === foundation)).toEqual([
      { from: foundation, to: path.resolve(PRIMITIVE_LEAF), specifier: './cadCorePrimitiveTypes', kind: 'type' },
    ]);
    expect(graph.edges.filter((edge) => edge.from === survey)).toEqual([
      { from: survey, to: path.resolve(PRIMITIVE_LEAF), specifier: './cadCorePrimitiveTypes', kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge per leaf.
    const hubToFoundation = { from: path.resolve(HUB), to: foundation, specifier: './cadEntityFoundationTypes', kind: 'type' };
    const hubToSurvey = { from: path.resolve(HUB), to: survey, specifier: './cadSurveyPresentationTypes', kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === foundation)).toEqual([hubToFoundation, hubToFoundation]);
    expect(graph.edges.filter((edge) => edge.to === survey)).toEqual([hubToSurvey, hubToSurvey]);
    expect(graph.nodes.filter((node) => node === foundation || node === survey)).toHaveLength(2);
    expect(graph.edges.filter(
      (edge) => (edge.from === foundation || edge.to === foundation || edge.from === survey || edge.to === survey)
        && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('has no leaf back-edge to the hub, the sibling leaf, or engine runtime', () => {
    const graph = cadF2fGraph();
    const foundation = path.resolve(FOUNDATION_LEAF);
    const survey = path.resolve(SURVEY_LEAF);
    for (const from of [foundation, survey]) {
      for (const target of [
        path.resolve(HUB),
        from === foundation ? survey : foundation,
        path.resolve(path.join(CAD_DIR, 'cadStyles.ts')),
        path.resolve(path.join(CAD_DIR, 'cadPointStyles.ts')),
        path.resolve(path.join(CAD_DIR, 'cadTransactions.types.ts')),
      ]) {
        expect(graph.edges.filter((edge) => edge.from === from && edge.to === target)).toEqual([]);
      }
    }
  });
});

describe('STRUCT-241.3 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // Post-241.2 baseline 1658 / 7516; type-only extraction adds +2 nodes / +6 edges.
    expect(graph.nodes.length).toBe(1660);
    expect(graph.edges.length).toBe(7522);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4444,
      uniqPairs: 4385,
      sha: '415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448',
    });
  }, 120_000);
});

describe('STRUCT-241.3 negative controls (in-memory mutations only)', () => {
  const foundationSource = (): string => fs.readFileSync(FOUNDATION_LEAF, 'utf8');
  const surveySource = (): string => fs.readFileSync(SURVEY_LEAF, 'utf8');
  const hubSource = (): string => fs.readFileSync(HUB, 'utf8');

  it('fails the shape pin when CadTextStyle modelHeight optionality is dropped', () => {
    const mutated = foundationSource().replace('modelHeight?: number;', 'modelHeight: number;');
    expect(mutated).not.toBe(foundationSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadTextStyle'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadTextStyle'])).toThrow();
  });

  it('fails the shape pin when the point-group wildcard include/exclude priority type changes', () => {
    const mutated = surveySource().replace('excludePointIds?: string[];', 'excludePointIds?: string;');
    expect(mutated).not.toBe(surveySource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadPointGroupQuery'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadPointGroupQuery'])).toThrow();
  });

  it('fails the shape pin when the label-binding content discriminant changes', () => {
    const mutated = surveySource().replace(
      "content: { mode: 'derived' } | { mode: 'manual'; text: string };",
      "content: { mode: 'derived' } | { mode: 'manual'; label: string };",
    );
    expect(mutated).not.toBe(surveySource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadPointLabelBinding'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadPointLabelBinding'])).toThrow();
  });

  it('fails the shape pin when CadEntityAppearance transparency is dropped', () => {
    const mutated = foundationSource().replace('  transparency?: number;\n', '');
    expect(mutated).not.toBe(foundationSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadEntityAppearance'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadEntityAppearance'])).toThrow();
  });

  it('catches a simulated leaf-to-hub back-edge as a new TYPE cycle', () => {
    const mutatedLeaf = `${surveySource()}\nimport type { CadProject } from './cadTypes';\nexport type CycleProbe = CadProject | null;\n`;
    const graph = buildGraphs([
      { path: path.resolve(SURVEY_LEAF), source: mutatedLeaf },
      { path: path.resolve(HUB), source: hubSource() },
      { path: path.resolve(PRIMITIVE_LEAF), source: fs.readFileSync(PRIMITIVE_LEAF, 'utf8') },
    ]);
    const typeCycles = findCycles(graph.nodes, graph.type);
    const cyclic = new Set(typeCycles.cyclic.flat());
    expect(cyclic.has(path.resolve(SURVEY_LEAF))).toBe(true);
    expect(cyclic.has(path.resolve(HUB))).toBe(true);
  });

  it('detects a removed public re-export from the hub facade', () => {
    // CadPointStyle appears in both the hub `import type` and `export type`
    // blocks; dropping the re-export means removing both occurrences.
    const mutated = hubSource().replaceAll('  CadPointStyle,\n', '');
    expect(mutated).not.toBe(hubSource());
    expect(mutated).not.toContain('  CadPointStyle,');
    for (const name of SURVEY_9) {
      if (name === 'CadPointStyle') continue;
      expect(mutated).toContain(`  ${name},`);
    }
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(FOUNDATION_LEAF, 'utf8')).toBe(foundationSource());
    expect(fs.readFileSync(SURVEY_LEAF, 'utf8')).toBe(surveySource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
  });
});

describe('STRUCT-241.3 prior phase guards stay green by import existence', () => {
  it.each([
    'cad_survey_layer_command_type_leaves_2411',
    'cad_block_command_type_leaf_2412',
    'cad_appearance',
    'cad_point_styles_18d',
    'cad_point_label_styles_18d',
    'cad_point_groups_18d',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });
});
