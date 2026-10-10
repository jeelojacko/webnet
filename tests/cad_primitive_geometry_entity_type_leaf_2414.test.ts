/**
 * STRUCT-241.4 — CAD primitive/geometry entity type leaf.
 *
 * Pins `src/engine/cad/cadPrimitiveGeometryEntityTypes.ts`, which extracts the
 * eight primitive and geometry entity contracts out of `src/engine/cad/cadTypes.ts`
 * verbatim so the hub keeps every historic `from './cadTypes'` consumer
 * compiling via `export type` re-exports:
 *
 * - `CadLineEntity` — station-to-station line with source observation ids.
 * - `CadPolylineSegmentGeometry` — per-course line/arc bulge geometry alias.
 * - `CadPolylineSegmentWidth` — per-course full centred band width.
 * - `CadPolylineEntity` — ordered vertices with optional per-course geometry/widths.
 * - `CadArcEntity` — center + radius + start/end angles arc.
 * - `CadCircleEntity` — first-class center + radius circle.
 * - `CadPolygonEntity` — ordered vertices with labels.
 * - `CadParabolaEntity` — first-class finite analytic parabola.
 *
 * Covers: hand-transcribed pre-refactor interface/alias shape pins (ordered
 * props, optionality, normalized type text) for all eight declarations;
 * declaration order in the leaf; both-direction facade-vs-leaf `expectTypeOf`
 * equality; all eight historic public re-exports with no leftover original
 * declarations in the hub; the exact `CadEntity` union order; the exact
 * `CadBlockChild` / `CadBlockChildType` shape including parabola exclusion;
 * type-only + emit pins (hub emit byte-identical, leaf `export {};`);
 * CAD+F2F and full-`src` graph pins rolled forward by the measured type-only
 * delta (+1 node / +4 scoped edges, +5 full edges) with the historical
 * value/mixed digest unchanged; and in-memory negative controls.
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
  CadArcEntity as HubArcEntity,
  CadCircleEntity as HubCircleEntity,
  CadLineEntity as HubLineEntity,
  CadParabolaEntity as HubParabolaEntity,
  CadPolygonEntity as HubPolygonEntity,
  CadPolylineEntity as HubPolylineEntity,
  CadPolylineSegmentGeometry as HubPolylineSegmentGeometry,
  CadPolylineSegmentWidth as HubPolylineSegmentWidth,
} from '../src/engine/cad/cadTypes';
import type {
  CadArcEntity as LeafArcEntity,
  CadCircleEntity as LeafCircleEntity,
  CadLineEntity as LeafLineEntity,
  CadParabolaEntity as LeafParabolaEntity,
  CadPolygonEntity as LeafPolygonEntity,
  CadPolylineEntity as LeafPolylineEntity,
  CadPolylineSegmentGeometry as LeafPolylineSegmentGeometry,
  CadPolylineSegmentWidth as LeafPolylineSegmentWidth,
} from '../src/engine/cad/cadPrimitiveGeometryEntityTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const HUB = path.join(CAD_DIR, 'cadTypes.ts');
const LEAF = path.join(CAD_DIR, 'cadPrimitiveGeometryEntityTypes.ts');
const FOUNDATION_LEAF = path.join(CAD_DIR, 'cadEntityFoundationTypes.ts');
const DISPLAY_LEAF = path.join(CAD_DIR, 'cadDisplayTypes.ts');

/** The eight extracted declarations, in original source order. */
const MOVED_8 = [
  'CadLineEntity',
  'CadPolylineSegmentGeometry',
  'CadPolylineSegmentWidth',
  'CadPolylineEntity',
  'CadArcEntity',
  'CadCircleEntity',
  'CadPolygonEntity',
  'CadParabolaEntity',
];

/** Interfaces in the leaf (the geometry alias is pinned separately). */
const MOVED_INTERFACES = MOVED_8.filter((name) => name !== 'CadPolylineSegmentGeometry');

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
  CadLineEntity: [
    "type:'line'",
    'fromStationId:StationId',
    'toStationId:StationId',
    'fromX:number',
    'fromY:number',
    'toX:number',
    'toY:number',
    'sourceObservationIds:number[]',
  ],
  CadPolylineSegmentWidth: [
    'startWidth:number',
    'endWidth:number',
  ],
  CadPolylineEntity: [
    "type:'polyline'",
    'vertices:CadDisplayPoint[]',
    'vertexLabels:string[]',
    'closed:boolean',
    'segmentGeometry?:CadPolylineSegmentGeometry[]',
    'segmentWidths?:CadPolylineSegmentWidth[]',
  ],
  CadArcEntity: [
    "type:'arc'",
    'centerX:number',
    'centerY:number',
    'radius:number',
    'startAngleDeg:number',
    'endAngleDeg:number',
  ],
  CadCircleEntity: [
    "type:'circle'",
    'centerX:number',
    'centerY:number',
    'radius:number',
  ],
  CadPolygonEntity: [
    "type:'polygon'",
    'vertices:CadDisplayPoint[]',
    'vertexLabels:string[]',
  ],
  CadParabolaEntity: [
    "type:'parabola'",
    'vertexX:number',
    'vertexY:number',
    'axisAngleDeg:number',
    'focalLength:number',
    'tStart:number',
    'tEnd:number',
  ],
};

/** Type-alias pins: whitespace-collapsed alias target text. */
const EXPECTED_ALIAS_TEXT: Record<string, string> = {
  CadPolylineSegmentGeometry: "{kind:'line'}|{kind:'arc';bulge:number}",
};

/** Entity discriminant literal pins. */
const EXPECTED_DISCRIMINANTS: Record<string, string> = {
  CadLineEntity: "'line'",
  CadPolylineEntity: "'polyline'",
  CadArcEntity: "'arc'",
  CadCircleEntity: "'circle'",
  CadPolygonEntity: "'polygon'",
  CadParabolaEntity: "'parabola'",
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

const FACADE_IMPORT_BLOCK =
  `import type {\n${MOVED_8.map((name) => `  ${name},`).join('\n')}\n} from './cadPrimitiveGeometryEntityTypes';\n`;
const FACADE_EXPORT_BLOCK =
  `export type {\n${MOVED_8.map((name) => `  ${name},`).join('\n')}\n} from './cadPrimitiveGeometryEntityTypes';\n`;

const hubSource = (): string => fs.readFileSync(HUB, 'utf8');
const leafSource = (): string => fs.readFileSync(LEAF, 'utf8');

const FACADE_SPECIFIER = './cadPrimitiveGeometryEntityTypes';

/** Hub source guaranteed to carry the 241.4 facade block (in-memory only). */
const hubWithFacade = (): string => {
  const source = hubSource();
  return source.includes(`'${FACADE_SPECIFIER}'`)
    ? source
    : `${source}\n${FACADE_IMPORT_BLOCK}${FACADE_EXPORT_BLOCK}`;
};

/** Raw source text of the hub's 241.4 facade `import type` / `export type` block. */
const facadeBlockTextOf = (source: string, kind: 'import' | 'export'): string => {
  const file = parseText('hub.ts', source);
  const stmt = file.statements.find((candidate) => {
    if (kind === 'import') {
      return ts.isImportDeclaration(candidate)
        && ts.isStringLiteral(candidate.moduleSpecifier)
        && candidate.moduleSpecifier.text === FACADE_SPECIFIER;
    }
    return ts.isExportDeclaration(candidate)
      && candidate.moduleSpecifier != null
      && ts.isStringLiteral(candidate.moduleSpecifier)
      && candidate.moduleSpecifier.text === FACADE_SPECIFIER;
  });
  if (!stmt) throw new Error(`hub facade ${kind} block for ${FACADE_SPECIFIER} missing`);
  return stmt.getText(file);
};

// ---------------------------------------------------------------------------
// Leaf presence, order, and verbatim shapes.
// ---------------------------------------------------------------------------

describe('STRUCT-241.4 leaf presence and declaration order', () => {
  it('leaf exists before any shape assertion runs', () => {
    expect(fs.existsSync(LEAF)).toBe(true);
  });

  it('leaf declares exactly the 8 contracts in original order', () => {
    expect(exportedDeclNames(parse(LEAF))).toEqual(MOVED_8);
  });

  it('leaf keeps the geometry alias at its original position (index 1)', () => {
    const decls = parse(LEAF).statements.filter(
      (stmt): stmt is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(stmt),
    );
    expect(decls.map((decl) => decl.name.text)).toEqual(['CadPolylineSegmentGeometry']);
  });
});

describe('STRUCT-241.4 baseline interface shapes pinned verbatim', () => {
  it.each(MOVED_INTERFACES)('leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(LEAF), 'leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.4 baseline alias and discriminant shapes pinned verbatim', () => {
  it.each(Object.keys(EXPECTED_ALIAS_TEXT))('leaf alias %s matches the hand-transcribed alias', (name) => {
    expect(aliasTextOf(parse(LEAF), 'leaf', name)).toBe(EXPECTED_ALIAS_TEXT[name]);
  });

  it.each(Object.keys(EXPECTED_DISCRIMINANTS))('leaf %s keeps its discriminant literal', (name) => {
    expect(discriminantOf(parse(LEAF), 'leaf', name)).toBe(EXPECTED_DISCRIMINANTS[name]);
  });
});

// ---------------------------------------------------------------------------
// Facade contract: hub re-exports all 8, keeps no originals.
// ---------------------------------------------------------------------------

describe('STRUCT-241.4 hub facade re-exports', () => {
  it('re-exports all 8 primitive/geometry names from the new leaf', () => {
    const source = hubSource();
    expect(source).toContain("} from './cadPrimitiveGeometryEntityTypes';");
    for (const name of MOVED_8) {
      expect(source).toContain(`  ${name},`);
    }
  });

  it('keeps no original interface/alias declaration for any moved name', () => {
    const source = hubSource();
    for (const name of MOVED_8) {
      expect(source).not.toContain(`export interface ${name} `);
      expect(source).not.toContain(`export interface ${name}{`);
      expect(source).not.toContain(`export type ${name} =`);
    }
  });

  it('imports the new leaf type-only for local use', () => {
    const hub = parse(HUB);
    const typeImports = hub.statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)
        && stmt.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword)
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(typeImports).toContain('./cadPrimitiveGeometryEntityTypes');
  });

  it('keeps the CadEntity union declaration in the hub', () => {
    expect(hubSource()).toContain('export type CadEntity =');
  });
});

// ---------------------------------------------------------------------------
// Facade-vs-leaf type equality, bidirectional.
// ---------------------------------------------------------------------------

describe('STRUCT-241.4 facade vs leaf type equality', () => {
  it('CadLineEntity equality holds both directions', () => {
    expectTypeOf<LeafLineEntity>().toEqualTypeOf<HubLineEntity>();
    expectTypeOf<HubLineEntity>().toEqualTypeOf<LeafLineEntity>();
  });
  it('CadPolylineSegmentGeometry equality holds both directions', () => {
    expectTypeOf<LeafPolylineSegmentGeometry>().toEqualTypeOf<HubPolylineSegmentGeometry>();
    expectTypeOf<HubPolylineSegmentGeometry>().toEqualTypeOf<LeafPolylineSegmentGeometry>();
  });
  it('CadPolylineSegmentWidth equality holds both directions', () => {
    expectTypeOf<LeafPolylineSegmentWidth>().toEqualTypeOf<HubPolylineSegmentWidth>();
    expectTypeOf<HubPolylineSegmentWidth>().toEqualTypeOf<LeafPolylineSegmentWidth>();
  });
  it('CadPolylineEntity equality holds both directions', () => {
    expectTypeOf<LeafPolylineEntity>().toEqualTypeOf<HubPolylineEntity>();
    expectTypeOf<HubPolylineEntity>().toEqualTypeOf<LeafPolylineEntity>();
  });
  it('CadArcEntity equality holds both directions', () => {
    expectTypeOf<LeafArcEntity>().toEqualTypeOf<HubArcEntity>();
    expectTypeOf<HubArcEntity>().toEqualTypeOf<LeafArcEntity>();
  });
  it('CadCircleEntity equality holds both directions', () => {
    expectTypeOf<LeafCircleEntity>().toEqualTypeOf<HubCircleEntity>();
    expectTypeOf<HubCircleEntity>().toEqualTypeOf<LeafCircleEntity>();
  });
  it('CadPolygonEntity equality holds both directions', () => {
    expectTypeOf<LeafPolygonEntity>().toEqualTypeOf<HubPolygonEntity>();
    expectTypeOf<HubPolygonEntity>().toEqualTypeOf<LeafPolygonEntity>();
  });
  it('CadParabolaEntity equality holds both directions', () => {
    expectTypeOf<LeafParabolaEntity>().toEqualTypeOf<HubParabolaEntity>();
    expectTypeOf<HubParabolaEntity>().toEqualTypeOf<LeafParabolaEntity>();
  });
});

// ---------------------------------------------------------------------------
// Unaffected hub unions: CadEntity order, CadBlockChild order, child type.
// ---------------------------------------------------------------------------

describe('STRUCT-241.4 unaffected hub unions', () => {
  it('keeps the CadEntity union member order exact', () => {
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
// Type-only leaf and runtime emit parity.
// ---------------------------------------------------------------------------

describe('STRUCT-241.4 type-only leaf and emit parity', () => {
  it('leaf has zero runtime imports, zero value declarations, three owner-leaf type edges', () => {
    expect(runtimeImportSpecifiers(LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(LEAF)).toBe(true);
    expect(valueStatementKinds(LEAF)).toEqual([]);
    expect(allImportSpecifiers(LEAF)).toEqual([
      './cadEntityFoundationTypes',
      './cadDisplayTypes',
      '../../types',
    ]);
  });

  it('leaf never imports cadTypes, a barrel, or an engine runtime module', () => {
    const specifiers = allImportSpecifiers(LEAF);
    expect(specifiers).not.toContain('./cadTypes');
    expect(specifiers).not.toContain('./cadTransactions.types');
    for (const specifier of specifiers) {
      expect(specifier.endsWith('cadTypes')).toBe(false);
      expect(specifier.endsWith('cadTransactions.types')).toBe(false);
    }
  });

  it('transpiled leaf emit is marker-only', () => {
    expect(strippedEmit(LEAF)).toBe('export {};');
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
// The 241.4 extraction is type-only, so VALUE|mixed counts/digest are
// unchanged and the explicit TYPE allowlist adds +1 node / +4 scoped edges
// (hub import-type + hub export-type + two owner-leaf edges; the station-id
// `../../types` edge stays out of the curated CAD+F2F universe).
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

describe('STRUCT-241.4 CAD+F2F graph pins', () => {
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph(); // first/cold scoped build; 30 s tolerates full-suite CI load
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // 241.3 baseline 488 / 2412; the type-only 241.4 leaf adds +1 node and
    // four type edges (hub import + hub export + two owner-leaf edges).
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

  it('adds exactly the four allow-listed TYPE edges incident to the new leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(LEAF);
    const foundation = path.resolve(FOUNDATION_LEAF);
    const display = path.resolve(DISPLAY_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: display, specifier: './cadDisplayTypes', kind: 'type' },
      { from: leaf, to: foundation, specifier: './cadEntityFoundationTypes', kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: './cadPrimitiveGeometryEntityTypes', kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('has no leaf back-edge to the hub or to engine runtime modules', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(LEAF);
    for (const target of [
      path.resolve(HUB),
      path.resolve(path.join(CAD_DIR, 'cadStyles.ts')),
      path.resolve(path.join(CAD_DIR, 'cadPointStyles.ts')),
      path.resolve(path.join(CAD_DIR, 'cadTransactions.types.ts')),
    ]) {
      expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
    }
  });
});

describe('STRUCT-241.4 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // 241.3 baseline 1660 / 7522; the 241.4 leaf adds +1 node and five type
    // edges (hub import + hub export + foundation + display + src/types).
    // STRUCT-241.5 adds +2 nodes / +8 type edges (documented roll-forward).
    // STRUCT-241.6 adds +2 nodes / +9 type edges (documented roll-forward).
    expect(graph.nodes.length).toBe(1665);
    expect(graph.edges.length).toBe(7544);
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

describe('STRUCT-241.4 negative controls (in-memory mutations only)', () => {
  it('fails the alias pin when the polyline bulge variant changes to a radius', () => {
    const mutated = leafSource().replace("{ kind: 'arc'; bulge: number }", "{ kind: 'arc'; radius: number }");
    expect(mutated).not.toBe(leafSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadPolylineSegmentGeometry'))
      .toBe(EXPECTED_ALIAS_TEXT['CadPolylineSegmentGeometry'])).toThrow();
  });

  it('fails the shape pin when the optional segment arrays become required', () => {
    const mutated = leafSource()
      .replace('segmentGeometry?: CadPolylineSegmentGeometry[];', 'segmentGeometry: CadPolylineSegmentGeometry[];')
      .replace('segmentWidths?: CadPolylineSegmentWidth[];', 'segmentWidths: CadPolylineSegmentWidth[];');
    expect(mutated).not.toBe(leafSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadPolylineEntity'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadPolylineEntity'])).toThrow();
  });

  it('fails the shape pin when CadCircleEntity radius is renamed to diameter', () => {
    const mutated = leafSource().replace(
      "  type: 'circle';\n  centerX: number;\n  centerY: number;\n  radius: number;",
      "  type: 'circle';\n  centerX: number;\n  centerY: number;\n  diameter: number;",
    );
    expect(mutated).not.toBe(leafSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadCircleEntity'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadCircleEntity'])).toThrow();
  });

  it('fails the discriminant pin when CadCircleEntity widens its discriminant', () => {
    const mutated = leafSource().replace("type: 'circle';", "type: 'circle' | 'ring';");
    expect(mutated).not.toBe(leafSource());
    expect(() => expect(discriminantOf(parseText('m.ts', mutated), 'm', 'CadCircleEntity'))
      .toBe(EXPECTED_DISCRIMINANTS['CadCircleEntity'])).toThrow();
  });

  it('fails the shape pin when the parabola finite extent becomes optional', () => {
    const mutated = leafSource().replace('tEnd: number;', 'tEnd?: number;');
    expect(mutated).not.toBe(leafSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadParabolaEntity'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadParabolaEntity'])).toThrow();
  });

  it('detects a removed public re-export from the hub facade', () => {
    const hub = hubWithFacade();
    // Withdraw ONLY the export-type entry; the local `import type` stays, so
    // the hub still typechecks locally against the leaf while the public
    // re-export surface is the thing under test.
    const exportBlock = facadeBlockTextOf(hub, 'export');
    const mutatedExportBlock = exportBlock.replace('  CadParabolaEntity,\n', '');
    expect(mutatedExportBlock).not.toBe(exportBlock);
    const mutated = hub.replace(exportBlock, mutatedExportBlock);
    expect(mutated).not.toBe(hub);
    // Import block retains the name (local resolution intact); export block
    // is where the absence must be observed, not the whole hub.
    expect(facadeBlockTextOf(mutated, 'import')).toContain('  CadParabolaEntity,');
    const mutatedExport = facadeBlockTextOf(mutated, 'export');
    expect(mutatedExport).not.toContain('  CadParabolaEntity,');
    for (const name of MOVED_8) {
      if (name === 'CadParabolaEntity') continue;
      expect(mutatedExport).toContain(`  ${name},`);
    }
  });

  it('fails the CadEntity union-order pin when two members are swapped', () => {
    const hub = hubWithFacade();
    // Swap two members that only appear adjacent in the CadEntity union (the
    // CadBlockChild union also leads with CadLineEntity -> CadPolylineEntity).
    const mutated = hub.replace(
      '  | CadSurveyTableEntity\n  | CadSurveyPointEntity\n',
      '  | CadSurveyPointEntity\n  | CadSurveyTableEntity\n',
    );
    expect(mutated).not.toBe(hub);
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadEntity'))
      .toEqual(EXPECTED_CAD_ENTITY_ORDER)).toThrow();
  });

  it('fails the CadBlockChild pin when a parabola is added to the union', () => {
    const hub = hubWithFacade();
    const mutated = hub.replace(
      '  | CadTextEntity;\n',
      '  | CadTextEntity\n  | CadParabolaEntity;\n',
    );
    expect(mutated).not.toBe(hub);
    expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadBlockChild')).toContain('CadParabolaEntity');
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadBlockChild'))
      .toEqual(EXPECTED_CAD_BLOCK_CHILD_ORDER)).toThrow();
  });

  it('catches a simulated leaf-to-hub back-edge as a new TYPE cycle', () => {
    const mutatedLeaf = `${leafSource()}\nimport type { CadProject } from './cadTypes';\nexport type CycleProbe = CadProject | null;\n`;
    const graph = buildGraphs([
      { path: path.resolve(LEAF), source: mutatedLeaf },
      { path: path.resolve(HUB), source: hubWithFacade() },
    ]);
    const typeCycles = findCycles(graph.nodes, graph.type);
    const cyclic = new Set(typeCycles.cyclic.flat());
    expect(cyclic.has(path.resolve(LEAF))).toBe(true);
    expect(cyclic.has(path.resolve(HUB))).toBe(true);
  });

  it('detects a simulated value import on the leaf as a runtime edge', () => {
    const mutated = leafSource().replace(
      "import type { CadDisplayPoint } from './cadDisplayTypes';",
      "import { CadDisplayPoint } from './cadDisplayTypes';",
    );
    expect(mutated).not.toBe(leafSource());
    expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(false);
    expect(runtimeImportSpecifiersSource(parseText('m.ts', mutated))).toEqual(['./cadDisplayTypes']);
    const graph = buildGraphs([
      { path: path.resolve(LEAF), source: mutated },
      { path: path.resolve(DISPLAY_LEAF), source: fs.readFileSync(DISPLAY_LEAF, 'utf8') },
    ]);
    expect(graph.edges.filter((edge) => edge.from === path.resolve(LEAF) && edge.kind === 'value')).toHaveLength(1);
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(LEAF, 'utf8')).toBe(leafSource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
  });
});

describe('STRUCT-241.4 prior phase guards stay green by import existence', () => {
  it.each([
    'cad_survey_layer_command_type_leaves_2411',
    'cad_block_command_type_leaf_2412',
    'cad_entity_style_presentation_type_leaves_2413',
    'cad_appearance',
    'cad_line_l1_entity',
    'cad_polyline_bulge_width_c2_consumers',
    'cad_parabola_entity_b1',
    'cad_blocks_engine',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });
});
