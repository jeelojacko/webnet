/**
 * STRUCT-241.10 — CAD surface definition + surface model/style type leaves.
 *
 * Pins `src/engine/cad/cadSurfaceDefinitionTypes.ts` (6 surface-source /
 * definition contracts) and `src/engine/cad/cadSurfaceModelStyleTypes.ts`
 * (2 status/purpose unions + `CadSurface` + 2 display-style contracts),
 * extracted verbatim out of `src/engine/cad/cadTypes.ts` so the hub keeps
 * every historic `from './cadTypes'` consumer compiling via `export type`
 * re-exports:
 *
 * Definition leaf (6, original source order):
 * - `CadSurfacePointSource` — point-group (legacy pointGroupId vs canonical
 *   pointGroupIds) vs explicit points union.
 * - `CadSurfaceBreaklineSource` — point-chain vs entity discriminant union.
 * - `CadSurfaceBreakline` — standard-only breakline with optional name.
 * - `CadSurfaceBoundary` — outer/void boundary with source entity ref.
 * - `CadSurfaceBuildOptions` — optional maxEdgeLength + Phase 20A
 *   breaklineChordTolerance (finite positive, 0.001 m fallback).
 * - `CadSurfaceDefinition` — required pointSource, optional
 *   breaklines/boundaries/buildOptions, Phase 18S ordered edits stack,
 *   Phase 18L/18X sourceKind ('native' | 'imported-tin' | 'explicit-tin')
 *   plus importedTin payload, in exact key order.
 *
 * Model/style leaf (5, original source order):
 * - `CadSurfaceStatus` — 7-variant build status (BROKEN_REFERENCE,
 *   INSUFFICIENT_DATA).
 * - `CadSurfacePurpose` — 5-variant operator-authored purpose
 *   ('design-patch'), never inferred.
 * - `CadSurface` — definition link, purpose/styleId, cachedRevision
 *   (string | null), layerId, buildDiagnostic in exact order.
 * - `CadContourAppearance` — optional color/lineweight/opacity 0..1.
 * - `CadSurfaceStyle` — display-only styling: color/opacity, seed extras,
 *   majorContourEvery + contour-base/elevation intervals, two contour
 *   kinds, labelMajorOnly/showContourLabels/spacing/precision.
 *
 * Covers: hand-transcribed pre-refactor interface shape pins (ordered
 * props, optionality, normalized type text) for the 7 interfaces; exact
 * union branch orders for all 4 unions (2 literal, 2 object-literal);
 * JSDoc parity markers (point-group legacy precedence, standard-only,
 * post-build filter, Phase 20A tolerance, 18S ordered edits, 18L/18X
 * source kinds, 20D operator-authored purpose, geometry-only revision,
 * ByLayer default, 18H contour intent travel with the declarations; hub
 * keeps none); both-direction facade-vs-leaf `expectTypeOf` equality for
 * all 11; all 11 historic public re-exports with no leftover original
 * declarations in the hub; `CadProject` surfaces/surfaceStyles tables,
 * `CadDrawingDocument`, survey persisted state, and all 5 runtime value
 * exports stay in the hub; the exact `CadEntity` 19-union and
 * `CadBlockChild` 6-union orders; type-only + emit pins (hub emit
 * byte-identical 680 B / sha 37445357, each leaf `export {};`); CAD+F2F
 * and full-`src` graph pins rolled forward by the measured type-only
 * delta (+2 nodes / +9 scoped edges: definition leaf 3 out-edges to core
 * primitives/surface-edit/TIN-provenance + hub import + hub export,
 * model/style leaf 1 out-edge to core primitives + 1 one-way edge to the
 * definition leaf + hub import + hub export; no retired hub edge) with
 * both historical value/mixed digests unchanged and full TYPE 7/38; and
 * in-memory negative controls.
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
  CadContourAppearance as HubContourAppearance,
  CadSurface as HubSurface,
  CadSurfaceBoundary as HubSurfaceBoundary,
  CadSurfaceBreakline as HubSurfaceBreakline,
  CadSurfaceBreaklineSource as HubSurfaceBreaklineSource,
  CadSurfaceBuildOptions as HubSurfaceBuildOptions,
  CadSurfaceDefinition as HubSurfaceDefinition,
  CadSurfacePointSource as HubSurfacePointSource,
  CadSurfacePurpose as HubSurfacePurpose,
  CadSurfaceStatus as HubSurfaceStatus,
  CadSurfaceStyle as HubSurfaceStyle,
} from '../src/engine/cad/cadTypes';
import type {
  CadSurfaceBoundary as DefBoundary,
  CadSurfaceBreakline as DefBreakline,
  CadSurfaceBreaklineSource as DefBreaklineSource,
  CadSurfaceBuildOptions as DefBuildOptions,
  CadSurfaceDefinition as DefDefinition,
  CadSurfacePointSource as DefPointSource,
} from '../src/engine/cad/cadSurfaceDefinitionTypes';
import type {
  CadContourAppearance as ModelContourAppearance,
  CadSurface as ModelSurface,
  CadSurfacePurpose as ModelPurpose,
  CadSurfaceStatus as ModelStatus,
  CadSurfaceStyle as ModelStyle,
} from '../src/engine/cad/cadSurfaceModelStyleTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const HUB = path.join(CAD_DIR, 'cadTypes.ts');
const DEF_LEAF = path.join(CAD_DIR, 'cadSurfaceDefinitionTypes.ts');
const MODEL_LEAF = path.join(CAD_DIR, 'cadSurfaceModelStyleTypes.ts');

/** The six definition contracts, in original source order. */
const MOVED_DEFINITION = [
  'CadSurfacePointSource',
  'CadSurfaceBreaklineSource',
  'CadSurfaceBreakline',
  'CadSurfaceBoundary',
  'CadSurfaceBuildOptions',
  'CadSurfaceDefinition',
];

/** The five model/style contracts, in original source order. */
const MOVED_MODEL_STYLE = [
  'CadSurfaceStatus',
  'CadSurfacePurpose',
  'CadSurface',
  'CadContourAppearance',
  'CadSurfaceStyle',
];

/** All eleven moved contracts, family order preserved. */
const MOVED_11 = [...MOVED_DEFINITION, ...MOVED_MODEL_STYLE];

/** Definition interfaces pinned by ordered props (unions separate). */
const DEFINITION_INTERFACES = [
  'CadSurfaceBreakline',
  'CadSurfaceBoundary',
  'CadSurfaceBuildOptions',
  'CadSurfaceDefinition',
];

/** Model/style interfaces pinned by ordered props (unions separate). */
const MODEL_INTERFACES = [
  'CadSurface',
  'CadContourAppearance',
  'CadSurfaceStyle',
];

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
const runtimeImportSpecifiers = (file: string): string[] => {
  const source = parse(file);
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

// ---------------------------------------------------------------------------
// Hand-transcribed pre-refactor shape pins (from the exact-main baseline;
// parent-verified against cadTypes.ts before extraction).
// ---------------------------------------------------------------------------

/** Interface pins: ordered `name[?]:type` with whitespace collapsed. */
const EXPECTED_INTERFACE_PROPS: Record<string, string[]> = {
  CadSurfaceBreakline: [
    'id:string',
    'source:CadSurfaceBreaklineSource',
    "type:'standard'",
    'name?:string',
  ],
  CadSurfaceBoundary: [
    "type:'outer'|'void'",
    'sourceEntityId:CadEntityId',
  ],
  CadSurfaceBuildOptions: [
    'maxEdgeLength?:number',
    'breaklineChordTolerance?:number',
  ],
  CadSurfaceDefinition: [
    'pointSource:CadSurfacePointSource',
    'breaklines?:CadSurfaceBreakline[]',
    'boundaries?:CadSurfaceBoundary[]',
    'buildOptions?:CadSurfaceBuildOptions',
    'edits?:CadSurfaceEdit[]',
    "sourceKind?:'native'|'imported-tin'|'explicit-tin'",
    'importedTin?:ImportedTinPayload',
  ],
  CadSurface: [
    'id:string',
    'name:string',
    'definition:CadSurfaceDefinition',
    'purpose?:CadSurfacePurpose',
    'styleId?:string',
    'cachedRevision?:string|null',
    'layerId?:CadLayerId',
    'buildDiagnostic?:string',
  ],
  CadContourAppearance: [
    'color?:string',
    'lineweight?:number',
    'opacity?:number',
  ],
  CadSurfaceStyle: [
    'id:string',
    'name:string',
    'color?:string',
    'opacity?:number',
    'showTriangles?:boolean',
    'showContours?:boolean',
    'showPoints?:boolean',
    'showBoundary?:boolean',
    'description?:string',
    'minorContourInterval?:number',
    'majorContourEvery?:number',
    'contourBaseElevation?:number',
    'minorContour?:CadContourAppearance',
    'majorContour?:CadContourAppearance',
    'showContourLabels?:boolean',
    'labelMajorOnly?:boolean',
    'contourLabelSpacing?:number',
    'contourLabelPrecision?:number',
  ],
};

/** Union branch order pins (whitespace collapsed; object-literal members kept whole). */
const EXPECTED_UNION_BRANCHES: Record<string, string[]> = {
  CadSurfacePointSource: [
    "{kind:'point-group';pointGroupIds?:string[];pointGroupId?:string}",
    '{kind:\'points\';pointEntityIds:CadEntityId[]}',
  ],
  CadSurfaceBreaklineSource: [
    "{kind:'point-chain';pointEntityIds:CadEntityId[]}",
    "{kind:'entity';entityId:CadEntityId}",
  ],
  CadSurfaceStatus: [
    "'UNBUILT'",
    "'CURRENT'",
    "'NEEDS_REBUILD'",
    "'BUILDING'",
    "'FAILED'",
    "'BROKEN_REFERENCE'",
    "'INSUFFICIENT_DATA'",
  ],
  CadSurfacePurpose: [
    "'existing-ground'",
    "'design'",
    "'design-patch'",
    "'reference'",
    "'other'",
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

/** `CadProject` surface tables: name + required optionality. */
const EXPECTED_PROJECT_TABLES: Array<[string, string]> = [
  ['surfaces', 'surfaces?:CadSurface[]'],
  ['surfaceStyles', 'surfaceStyles?:CadSurfaceStyle[]'],
];

/** Distinctive moved definition JSDoc markers that must travel with the declarations. */
const DEFINITION_JSDOC_MARKERS = [
  'canonical list is pointGroupIds',
  'legacy single-source shape, migrated on load',
  "Only 'standard' in 18F",
  'Post-build filter: drop triangles',
  'Phase 20A: max plan deviation',
  'absent/invalid reads as 0.001',
  'Never touches TIN numerics',
  'Phase 18S: ordered TIN edit stack',
  'Absent = no edits (legacy behavior)',
  "absent/'native' = entity-derived TIN",
  "'imported-tin'",
  "'explicit-tin'",
];

/** Distinctive moved model/style JSDoc markers that must travel. */
const MODEL_JSDOC_MARKERS = [
  'Phase 20D workflow role',
  'Operator-authored metadata ONLY',
  'excluded',
  'from the geometry revision',
  'Geometry-only revision of the last successful build',
  'ByLayer-default',
  'derived status stays authoritative',
  'per-kind contour line appearance',
  'surface display styling ONLY',
  'Major model is major-every-N minor',
  'Default true: label major contours only',
  'Along-path label spacing',
  'Decimals for label text',
];

/** Moved JSDoc bodies the hub must no longer contain. */
const MOVED_JSDOC_ABSENT_FROM_HUB = [
  'canonical list is pointGroupIds',
  'legacy single-source shape, migrated on load',
  "Only 'standard' in 18F",
  'Post-build filter: drop triangles',
  'Phase 20A: max plan deviation',
  'Phase 18S: ordered TIN edit stack',
  "absent/'native' = entity-derived TIN",
  'Phase 20D workflow role',
  'Operator-authored metadata ONLY',
  'Geometry-only revision of the last successful build',
  'per-kind contour line appearance',
  'surface display styling ONLY',
  'Major model is major-every-N minor',
];

const DEF_SPECIFIER = './cadSurfaceDefinitionTypes';
const MODEL_SPECIFIER = './cadSurfaceModelStyleTypes';
const CORE_SPECIFIER = './cadCorePrimitiveTypes';
const EDIT_SPECIFIER = './cadSurfaceEditTypes';
const PROVENANCE_SPECIFIER = './cadTinProvenanceTypes';

const hubSource = (): string => fs.readFileSync(HUB, 'utf8');
const defSource = (): string => fs.readFileSync(DEF_LEAF, 'utf8');
const modelSource = (): string => fs.readFileSync(MODEL_LEAF, 'utf8');

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

/** Facade exhaustiveness assertion shared by the positive pin and the negative control. */
const assertFacadeExhaustive = (exportBlock: string, names: string[]): void => {
  for (const name of names) {
    expect(exportBlock).toContain(`  ${name},`);
  }
};

/** Back-edge assertion shared by the positive pin and the negative control. */
const assertNoHubBackEdge = (specifiers: string[]): void => {
  expect(specifiers).not.toContain('./cadTypes');
  for (const specifier of specifiers) {
    expect(specifier.endsWith('cadTypes')).toBe(false);
  }
};

/** Hub-duplicate assertion shared by the positive pin and the negative control. */
const assertNoHubDuplicates = (source: string, names: string[]): void => {
  for (const name of names) {
    expect(source).not.toContain(`export interface ${name} `);
    expect(source).not.toContain(`export interface ${name}{`);
    expect(source).not.toContain(`export type ${name} =`);
  }
};

// ---------------------------------------------------------------------------
// Leaf presence, order, and verbatim shapes.
// ---------------------------------------------------------------------------

describe('STRUCT-241.10 leaf presence and declaration order', () => {
  it('both leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(DEF_LEAF)).toBe(true);
    expect(fs.existsSync(MODEL_LEAF)).toBe(true);
  });

  it('definition leaf declares exactly the 6 contracts in original order', () => {
    expect(exportedDeclNames(parse(DEF_LEAF))).toEqual(MOVED_DEFINITION);
  });

  it('model/style leaf declares exactly the 5 contracts in original order', () => {
    expect(exportedDeclNames(parse(MODEL_LEAF))).toEqual(MOVED_MODEL_STYLE);
  });

  it('the two leaves own disjoint name sets with a one-way B->A edge only', () => {
    expect(new Set(MOVED_11).size).toBe(11);
    expect(allImportSpecifiers(DEF_LEAF)).not.toContain(MODEL_SPECIFIER);
    expect(allImportSpecifiers(MODEL_LEAF)).toContain(DEF_SPECIFIER);
  });
});

describe('STRUCT-241.10 baseline definition interface shapes pinned verbatim', () => {
  it.each(DEFINITION_INTERFACES)('definition leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(DEF_LEAF), 'definition leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.10 baseline model/style interface shapes pinned verbatim', () => {
  it.each(MODEL_INTERFACES)('model leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(MODEL_LEAF), 'model leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.10 baseline union shapes pinned verbatim', () => {
  it.each(Object.keys(EXPECTED_UNION_BRANCHES))('leaf union %s keeps its branch order', (name) => {
    const file = MOVED_DEFINITION.includes(name) ? parse(DEF_LEAF) : parse(MODEL_LEAF);
    const label = MOVED_DEFINITION.includes(name) ? 'definition leaf' : 'model leaf';
    expect(unionMembers(file, label, name)).toEqual(EXPECTED_UNION_BRANCHES[name]);
  });
});

describe('STRUCT-241.10 JSDoc parity (comments travel with the declarations)', () => {
  it.each(DEFINITION_JSDOC_MARKERS)('definition leaf keeps marker %s', (marker) => {
    expect(defSource()).toContain(marker);
  });

  it.each(MODEL_JSDOC_MARKERS)('model leaf keeps marker %s', (marker) => {
    expect(modelSource()).toContain(marker);
  });

  it('keeps the point-group legacy precedence note adjacent to the point source', () => {
    const source = defSource();
    const note = source.indexOf('legacy single-source shape, migrated on load');
    const decl = source.indexOf('export type CadSurfacePointSource');
    expect(note).toBeGreaterThan(-1);
    expect(decl).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(decl);
  });

  it('keeps the 0.001 m fallback note inside the build options', () => {
    expect(defSource()).toContain('absent/invalid reads as 0.001');
  });

  it('keeps the sourceKind legacy-absent note inside the surface definition', () => {
    expect(defSource()).toContain('legacy');
    expect(defSource()).toContain('migration is idempotent');
  });

  it('hub keeps none of the moved definition or model/style JSDoc bodies', () => {
    const hub = hubSource();
    for (const marker of MOVED_JSDOC_ABSENT_FROM_HUB) {
      expect(hub).not.toContain(marker);
    }
  });
});

// ---------------------------------------------------------------------------
// Facade contract: hub re-exports all 11, keeps no originals.
// ---------------------------------------------------------------------------

describe('STRUCT-241.10 hub facade re-exports', () => {
  it('re-exports all 6 definition names from the new definition leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${DEF_SPECIFIER}';`);
    assertFacadeExhaustive(facadeBlockTextOf(source, DEF_SPECIFIER, 'export'), MOVED_DEFINITION);
  });

  it('re-exports all 5 model/style names from the new model leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${MODEL_SPECIFIER}';`);
    assertFacadeExhaustive(facadeBlockTextOf(source, MODEL_SPECIFIER, 'export'), MOVED_MODEL_STYLE);
  });

  it('keeps no original interface/alias declaration for any moved name', () => {
    assertNoHubDuplicates(hubSource(), MOVED_11);
  });

  it('imports both new leaves type-only for local use', () => {
    const hub = parse(HUB);
    const typeImports = hub.statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)
        && stmt.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword)
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(typeImports).toContain(DEF_SPECIFIER);
    expect(typeImports).toContain(MODEL_SPECIFIER);
  });

  it('keeps CadProject surface tables with names and optionality', () => {
    const projectProps = propsOf(parse(HUB), 'hub', 'CadProject');
    for (const [, pin] of EXPECTED_PROJECT_TABLES) {
      expect(projectProps).toContain(pin);
    }
  });

  it('keeps CadDrawingDocument with its project binding', () => {
    const hub = hubSource();
    expect(hub).toContain('export interface CadDrawingDocument {');
    expect(hub).toContain('project: CadProject;');
  });

  it('keeps survey persisted state in the hub', () => {
    const hub = hubSource();
    expect(hub).toContain('export interface CadSurveyPointEntity extends CadBaseEntity {');
    expect(hub).toContain(`} from './cadSurveyTableEntityTypes';`);
    expect(hub).toContain('CadSurveyTableEntity');
  });

  it('keeps all 5 runtime surface value exports in the hub', () => {
    const hub = hubSource();
    for (const decl of [
      'export const surfacePointGroupIds',
      'export const isExplicitTopologyDefinition',
      'export const isExplicitSurfaceDefinition',
      'export const isNativeSurfaceDefinition',
      'export const isImportedTinDefinition',
    ]) {
      expect(hub).toContain(decl);
    }
  });

  it('keeps the 5 runtime value functions in original source order', () => {
    const hub = hubSource();
    const order = [
      'export const surfacePointGroupIds',
      'export const isExplicitTopologyDefinition',
      'export const isExplicitSurfaceDefinition',
      'export const isNativeSurfaceDefinition',
      'export const isImportedTinDefinition',
    ].map((decl) => hub.indexOf(decl));
    for (const index of order) expect(index).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps MlightcadSpike contracts and block/entity unions in the hub', () => {
    const hub = hubSource();
    expect(hub).toContain('export interface MlightcadSpikeScene {');
    expect(hub).toContain('export type CadBlockChildType =');
  });
});

// ---------------------------------------------------------------------------
// Facade-vs-leaf type equality, bidirectional (all 11).
// ---------------------------------------------------------------------------

describe('STRUCT-241.10 definition facade vs leaf type equality', () => {
  it('CadSurfacePointSource equality holds both directions', () => {
    expectTypeOf<DefPointSource>().toEqualTypeOf<HubSurfacePointSource>();
    expectTypeOf<HubSurfacePointSource>().toEqualTypeOf<DefPointSource>();
  });
  it('CadSurfaceBreaklineSource equality holds both directions', () => {
    expectTypeOf<DefBreaklineSource>().toEqualTypeOf<HubSurfaceBreaklineSource>();
    expectTypeOf<HubSurfaceBreaklineSource>().toEqualTypeOf<DefBreaklineSource>();
  });
  it('CadSurfaceBreakline equality holds both directions', () => {
    expectTypeOf<DefBreakline>().toEqualTypeOf<HubSurfaceBreakline>();
    expectTypeOf<HubSurfaceBreakline>().toEqualTypeOf<DefBreakline>();
  });
  it('CadSurfaceBoundary equality holds both directions', () => {
    expectTypeOf<DefBoundary>().toEqualTypeOf<HubSurfaceBoundary>();
    expectTypeOf<HubSurfaceBoundary>().toEqualTypeOf<DefBoundary>();
  });
  it('CadSurfaceBuildOptions equality holds both directions', () => {
    expectTypeOf<DefBuildOptions>().toEqualTypeOf<HubSurfaceBuildOptions>();
    expectTypeOf<HubSurfaceBuildOptions>().toEqualTypeOf<DefBuildOptions>();
  });
  it('CadSurfaceDefinition equality holds both directions', () => {
    expectTypeOf<DefDefinition>().toEqualTypeOf<HubSurfaceDefinition>();
    expectTypeOf<HubSurfaceDefinition>().toEqualTypeOf<DefDefinition>();
  });
});

describe('STRUCT-241.10 model/style facade vs leaf type equality', () => {
  it('CadSurfaceStatus equality holds both directions', () => {
    expectTypeOf<ModelStatus>().toEqualTypeOf<HubSurfaceStatus>();
    expectTypeOf<HubSurfaceStatus>().toEqualTypeOf<ModelStatus>();
  });
  it('CadSurfacePurpose equality holds both directions', () => {
    expectTypeOf<ModelPurpose>().toEqualTypeOf<HubSurfacePurpose>();
    expectTypeOf<HubSurfacePurpose>().toEqualTypeOf<ModelPurpose>();
  });
  it('CadSurface equality holds both directions', () => {
    expectTypeOf<ModelSurface>().toEqualTypeOf<HubSurface>();
    expectTypeOf<HubSurface>().toEqualTypeOf<ModelSurface>();
  });
  it('CadContourAppearance equality holds both directions', () => {
    expectTypeOf<ModelContourAppearance>().toEqualTypeOf<HubContourAppearance>();
    expectTypeOf<HubContourAppearance>().toEqualTypeOf<ModelContourAppearance>();
  });
  it('CadSurfaceStyle equality holds both directions', () => {
    expectTypeOf<ModelStyle>().toEqualTypeOf<HubSurfaceStyle>();
    expectTypeOf<HubSurfaceStyle>().toEqualTypeOf<ModelStyle>();
  });
});

// ---------------------------------------------------------------------------
// Unaffected hub unions: CadEntity order, CadBlockChild order, child type.
// ---------------------------------------------------------------------------

describe('STRUCT-241.10 unaffected hub unions', () => {
  it('keeps the 19-member CadEntity union order exact', () => {
    expect(unionMembers(parse(HUB), 'hub', 'CadEntity')).toEqual(EXPECTED_CAD_ENTITY_ORDER);
  });

  it('keeps the CadBlockChild union member order exact and excludes parabolas', () => {
    const members = unionMembers(parse(HUB), 'hub', 'CadBlockChild');
    expect(members).toEqual(EXPECTED_CAD_BLOCK_CHILD_ORDER);
    expect(members).not.toContain('CadParabolaEntity');
  });

  it('keeps CadBlockChildType as the CadBlockChild discriminant index', () => {
    const hub = parse(HUB);
    const decl = findDecl(hub, 'hub', 'CadBlockChildType');
    if (!ts.isTypeAliasDeclaration(decl)) throw new Error('hub: CadBlockChildType is not a type alias');
    expect(norm(decl.type.getText())).toBe("CadBlockChild['type']");
  });
});

// ---------------------------------------------------------------------------
// Type-only leaves and runtime emit parity.
// ---------------------------------------------------------------------------

describe('STRUCT-241.10 type-only leaves and emit parity', () => {
  it('definition leaf imports exactly the allow-listed low-level type leaves', () => {
    expect(allImportSpecifiers(DEF_LEAF)).toEqual([CORE_SPECIFIER, EDIT_SPECIFIER, PROVENANCE_SPECIFIER]);
    expect(hasOnlyTypeImports(DEF_LEAF)).toBe(true);
    expect(valueStatementKinds(DEF_LEAF)).toEqual([]);
  });

  it('model leaf imports exactly the definition leaf plus core primitives', () => {
    expect(allImportSpecifiers(MODEL_LEAF)).toEqual([DEF_SPECIFIER, CORE_SPECIFIER]);
    expect(hasOnlyTypeImports(MODEL_LEAF)).toBe(true);
    expect(valueStatementKinds(MODEL_LEAF)).toEqual([]);
  });

  it('neither leaf imports cadTypes, a barrel, transactions, or a runtime module', () => {
    for (const file of [DEF_LEAF, MODEL_LEAF]) {
      assertNoHubBackEdge(allImportSpecifiers(file));
      const specifiers = allImportSpecifiers(file);
      expect(specifiers).not.toContain('./cadTypes');
      expect(specifiers).not.toContain('./cadTransactions.types');
      for (const specifier of specifiers) {
        expect(specifier.endsWith('cadTransactions.types')).toBe(false);
      }
    }
    expect(allImportSpecifiers(DEF_LEAF)).not.toContain(MODEL_SPECIFIER);
    expect(runtimeImportSpecifiers(DEF_LEAF)).toEqual([]);
    expect(runtimeImportSpecifiers(MODEL_LEAF)).toEqual([]);
  });

  it('both transpiled leaf emits are marker-only', () => {
    expect(strippedEmit(DEF_LEAF)).toBe('export {};');
    expect(strippedEmit(MODEL_LEAF)).toBe('export {};');
  });

  it('hub runtime emit is byte-identical to the exact-main baseline', () => {
    expect(strippedEmit(HUB).length).toBe(680);
    expect(createHash('sha256').update(strippedEmit(HUB)).digest('hex'))
      .toBe('3744535788de61cc48666898669382da2312a59764ce06a96dc017936319d454');
  });

  it('hub runtime emit still exports all 5 surface value functions', () => {
    const emit = ts.transpileModule(fs.readFileSync(HUB, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, removeComments: true },
    }).outputText;
    for (const name of [
      'surfacePointGroupIds',
      'isExplicitTopologyDefinition',
      'isExplicitSurfaceDefinition',
      'isNativeSurfaceDefinition',
      'isImportedTinDefinition',
    ]) {
      expect(emit).toContain(name);
    }
  });
});

// ---------------------------------------------------------------------------
// Dependency-graph pins. Canonical digest: value|mixed edges only; pairs are
// sorted-unique `<relPosix(from)>\n<relPosix(to)>`; sha256(JSON.stringify).
// The 241.10 extraction is type-only; the definition leaf adds 3 out-edges
// (core primitives + surface-edit + TIN provenance) and the model leaf adds
// 2 (one-way B->A + core primitives), so the scoped delta is +2 nodes /
// +9 type edges (per leaf: hub import-type + hub export-type; no retired
// hub edge) and the full-scope delta matches (+2 / +9: every 241.10 edge
// resolves inside `src`). Both historical value/mixed digests stay
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

describe('STRUCT-241.10 CAD+F2F graph pins', () => {
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph(); // first/cold scoped build; 30 s tolerates full-suite CI load
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // 241.9 baseline 499 / 2450; the type-only 241.10 leaves add +2 nodes
    // and +9 type edges (definition leaf: 3 out-edges + hub import + hub
    // export; model leaf: one-way B->A + core out-edge + hub import + hub
    // export; no retired hub edge).
    expect(graph.nodes.length).toBe(501);
    expect(graph.edges.length).toBe(2459);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  }, 30_000);

  it('adds exactly the allow-listed TYPE edges incident to the definition leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(DEF_LEAF);
    const core = path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts'));
    const edit = path.resolve(path.join(CAD_DIR, 'cadSurfaceEditTypes.ts'));
    const provenance = path.resolve(path.join(CAD_DIR, 'cadTinProvenanceTypes.ts'));
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: core, specifier: CORE_SPECIFIER, kind: 'type' },
      { from: leaf, to: edit, specifier: EDIT_SPECIFIER, kind: 'type' },
      { from: leaf, to: provenance, specifier: PROVENANCE_SPECIFIER, kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge, after
    // the one-way model->definition edge in graph (from-path) order.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: DEF_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([
      { from: path.resolve(MODEL_LEAF), to: leaf, specifier: DEF_SPECIFIER, kind: 'type' },
      hubToLeaf,
      hubToLeaf,
    ]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('adds exactly the allow-listed TYPE edges incident to the model leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(MODEL_LEAF);
    const core = path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts'));
    const def = path.resolve(DEF_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: core, specifier: CORE_SPECIFIER, kind: 'type' },
      { from: leaf, to: def, specifier: DEF_SPECIFIER, kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: MODEL_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('has no leaf back-edge to the hub, the sibling leaf (A->B), or engine runtime modules', () => {
    const graph = cadF2fGraph();
    const def = path.resolve(DEF_LEAF);
    const model = path.resolve(MODEL_LEAF);
    for (const target of [
      path.resolve(HUB),
      model,
      path.resolve(path.join(CAD_DIR, 'cadTransactions.types.ts')),
    ]) {
      expect(graph.edges.filter((edge) => edge.from === def && edge.to === target)).toEqual([]);
    }
    for (const target of [
      path.resolve(HUB),
      path.resolve(path.join(CAD_DIR, 'cadTransactions.types.ts')),
    ]) {
      expect(graph.edges.filter((edge) => edge.from === model && edge.to === target)).toEqual([]);
    }
  });
});

describe('STRUCT-241.10 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // 241.9 baseline 1671 / 7561; the 241.10 leaves add +2 nodes and +9
    // type edges (same allowlist as the scoped pin; every 241.10 edge
    // resolves inside `src`).
    expect(graph.nodes.length).toBe(1673);
    expect(graph.edges.length).toBe(7570);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 4444,
      uniqPairs: 4385,
      sha: '415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448',
    });
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Negative controls (in-memory mutations only). Each one makes a real pin
// FAIL (proven by expecting the pin assertion to throw), so a silently
// weakened pin cannot pass unnoticed.
// ---------------------------------------------------------------------------

describe('STRUCT-241.10 negative controls (in-memory mutations only)', () => {
  it('fails the shape pin when the legacy pointGroupId member is dropped', () => {
    const mutated = defSource().replace('pointGroupIds?: string[]; pointGroupId?: string', 'pointGroupIds?: string[]');
    expect(mutated).not.toBe(defSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadSurfacePointSource'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadSurfacePointSource'])).toThrow();
  });

  it('fails the shape pin when a point-group member is swapped for points', () => {
    const mutated = defSource().replace(
      "| { kind: 'points'; pointEntityIds: CadEntityId[] };",
      "| { kind: 'point-group'; pointGroupIds?: string[]; pointGroupId?: string };",
    );
    expect(mutated).not.toBe(defSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadSurfacePointSource'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadSurfacePointSource'])).toThrow();
  });

  it('fails the shape pin when the breakline source discriminant changes', () => {
    const mutated = defSource().replace("kind: 'point-chain'", "kind: 'chain'");
    expect(mutated).not.toBe(defSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadSurfaceBreaklineSource'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadSurfaceBreaklineSource'])).toThrow();
  });

  it('fails the shape pin when the boundary source becomes optional', () => {
    const mutated = defSource().replace('  sourceEntityId: CadEntityId;', '  sourceEntityId?: CadEntityId;');
    expect(mutated).not.toBe(defSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceBoundary'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceBoundary'])).toThrow();
  });

  it('fails the shape pin when breaklineChordTolerance is removed', () => {
    const mutated = defSource().replace('  breaklineChordTolerance?: number;\n', '');
    expect(mutated).not.toBe(defSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceBuildOptions'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceBuildOptions'])).toThrow();
  });

  it('fails the shape pin when breaklineChordTolerance becomes required', () => {
    const mutated = defSource().replace('  breaklineChordTolerance?: number;', '  breaklineChordTolerance: number;');
    expect(mutated).not.toBe(defSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceBuildOptions'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceBuildOptions'])).toThrow();
  });

  it('fails the shape pin when the definition loses its edits stack', () => {
    const mutated = defSource().replace('  edits?: CadSurfaceEdit[];\n', '');
    expect(mutated).not.toBe(defSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceDefinition'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceDefinition'])).toThrow();
  });

  it('fails the shape pin when the definition loses its importedTin payload', () => {
    const mutated = defSource().replace('  importedTin?: ImportedTinPayload;\n', '');
    expect(mutated).not.toBe(defSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceDefinition'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceDefinition'])).toThrow();
  });

  it('fails the shape pin when a sourceKind branch is dropped', () => {
    const mutated = defSource().replace("sourceKind?: 'native' | 'imported-tin' | 'explicit-tin'", "sourceKind?: 'native' | 'imported-tin'");
    expect(mutated).not.toBe(defSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceDefinition'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceDefinition'])).toThrow();
  });

  it('fails the shape pin when the status union loses BROKEN_REFERENCE', () => {
    const mutated = modelSource().replace("  | 'BROKEN_REFERENCE'\n", '');
    expect(mutated).not.toBe(modelSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadSurfaceStatus'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadSurfaceStatus'])).toThrow();
  });

  it('fails the shape pin when the purpose union gains an inferred branch', () => {
    const mutated = modelSource().replace("  | 'other';", "  | 'other'\n  | 'auto';");
    expect(mutated).not.toBe(modelSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadSurfacePurpose'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadSurfacePurpose'])).toThrow();
  });

  it('fails the shape pin when cachedRevision loses its nullability', () => {
    const mutated = modelSource().replace('  cachedRevision?: string | null;', '  cachedRevision?: string;');
    expect(mutated).not.toBe(modelSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurface'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurface'])).toThrow();
  });

  it('fails the shape pin when CadSurface layerId becomes required', () => {
    const mutated = modelSource().replace('  layerId?: CadLayerId;', '  layerId: CadLayerId;');
    expect(mutated).not.toBe(modelSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurface'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurface'])).toThrow();
  });

  it('fails the shape pin when the contour major-every-N field is removed', () => {
    const mutated = modelSource().replace('  majorContourEvery?: number;\n', '');
    expect(mutated).not.toBe(modelSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceStyle'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceStyle'])).toThrow();
  });

  it('fails the shape pin when a contour label option becomes required', () => {
    const mutated = modelSource().replace('  showContourLabels?: boolean;', '  showContourLabels: boolean;');
    expect(mutated).not.toBe(modelSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceStyle'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceStyle'])).toThrow();
  });

  it('fails facade exhaustiveness when ONLY the re-export is removed but the import stays', () => {
    const block = facadeBlockTextOf(hubSource(), DEF_SPECIFIER, 'export');
    expect(block).toContain('  CadSurfaceDefinition,');
    const mutated = block.replace('  CadSurfaceDefinition,\n', '');
    expect(mutated).not.toBe(block);
    // The local `import type` still names the contract, so only the
    // re-export assertion can catch the lost legacy path.
    expect(facadeBlockTextOf(hubSource(), DEF_SPECIFIER, 'import')).toContain('CadSurfaceDefinition');
    expect(() => assertFacadeExhaustive(mutated, MOVED_DEFINITION)).toThrow();
  });

  it('fails the no-duplicate pin when a moved declaration lingers in the hub', () => {
    const mutated = `${hubSource()}\nexport interface CadSurfaceStyle {\n  id: string;\n}\n`;
    expect(() => assertNoHubDuplicates(mutated, MOVED_11)).toThrow();
  });

  it('fails the back-edge pin when a leaf gains a TYPE import of the hub', () => {
    const specifiers = [...allImportSpecifiers(MODEL_LEAF), './cadTypes'];
    expect(() => assertNoHubBackEdge(specifiers)).toThrow();
  });

  it('fails the one-way pin when the definition leaf gains an A->B cycle edge', () => {
    const specifiers = [...allImportSpecifiers(DEF_LEAF), MODEL_SPECIFIER];
    expect(specifiers).toContain(MODEL_SPECIFIER);
    expect(() => expect(specifiers).not.toContain(MODEL_SPECIFIER)).toThrow();
  });

  it('fails the type-only pin when a leaf gains a runtime VALUE import', () => {
    const mutated = `import { surfacePointGroupIds } from './cadTypes';\n${defSource()}`;
    expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(false);
    expect(() => expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(true)).toThrow();
  });

  it('fails the emit pin when a leaf gains a runtime value export', () => {
    const mutated = `${modelSource()}\nexport const marker = 1;\n`;
    const emit = ts.transpileModule(mutated, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, removeComments: true },
    }).outputText.trim();
    expect(emit).not.toBe('export {};');
    expect(() => expect(emit).toBe('export {};')).toThrow();
  });
});
