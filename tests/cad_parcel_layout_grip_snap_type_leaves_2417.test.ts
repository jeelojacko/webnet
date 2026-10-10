/**
 * STRUCT-241.7 — CAD parcel-layout and grip/snap type leaves.
 *
 * Pins `src/engine/cad/cadParcelLayoutTypes.ts` (5 parcel-layout contracts:
 * solution preference, automatic mode, remainder distribution, settings, UI
 * state) and `src/engine/cad/cadGripSnapTypes.ts` (6 grip/snap contracts:
 * grip handle kind/handle, snap kind/candidate/lock/construction context),
 * extracted verbatim out of `src/engine/cad/cadTypes.ts` so the hub keeps
 * every historic `from './cadTypes'` consumer compiling via `export type`
 * re-exports:
 *
 * - `CadParcelLayoutSolutionPreference` — solver preferred-solution ranking.
 * - `CadParcelLayoutAutomaticMode` — automatic layout trigger mode union.
 * - `CadParcelLayoutRemainderDistribution` — remainder placement strategy.
 * - `CadParcelLayoutSettings` — solver settings (frontage/area/width/depth).
 * - `CadParcelLayoutUiState` — panel UI state (dock/float, active ids).
 * - `CadGripHandleKind` — grip kind union (incl. Phase C3 polyline-insert).
 * - `CadGripHandle` — draggable grip handle (incl. optional courseIndex).
 * - `CadSnapKind` — snap kind literal union.
 * - `CadSnapCandidate` — computed snap candidate (incl. computedScale,
 *   viewportGeneration, guides, compound kinds).
 * - `CadSnapLock` — locked construction snap.
 * - `CadSnapConstructionContext` — construction/snap seed context (incl.
 *   tangent-seed and locked-snap nullables).
 *
 * Covers: hand-transcribed pre-refactor interface/alias shape pins (ordered
 * props, optionality, normalized type text) for all 11 declarations;
 * declaration order in each leaf; union literal branch order; JSDoc parity
 * markers (the Phase C3 polyline-insert inline comment, courseIndex,
 * computedScale/viewportGeneration, and Phase C2 tangent-seed bodies move
 * with their declarations, hub keeps none of them, with position checks);
 * both-direction facade-vs-leaf `expectTypeOf` equality for all 11; all 11
 * historic public re-exports with no leftover original declarations in the
 * hub; the exact `CadEntity` 19-union order; the exact `CadBlockChild`
 * 6-union order; type-only + emit pins (hub emit byte-identical, each leaf
 * `export {};`); CAD+F2F and full-`src` graph pins rolled forward by the
 * measured type-only delta (+2 nodes / +7 scoped edges, +2 nodes / +7 full
 * edges) with both historical value/mixed digests unchanged; and in-memory
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
  CadGripHandle as HubGripHandle,
  CadGripHandleKind as HubGripHandleKind,
  CadParcelLayoutAutomaticMode as HubParcelLayoutAutomaticMode,
  CadParcelLayoutRemainderDistribution as HubParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings as HubParcelLayoutSettings,
  CadParcelLayoutSolutionPreference as HubParcelLayoutSolutionPreference,
  CadParcelLayoutUiState as HubParcelLayoutUiState,
  CadSnapCandidate as HubSnapCandidate,
  CadSnapConstructionContext as HubSnapConstructionContext,
  CadSnapKind as HubSnapKind,
  CadSnapLock as HubSnapLock,
} from '../src/engine/cad/cadTypes';
import type {
  CadParcelLayoutAutomaticMode as LayParcelLayoutAutomaticMode,
  CadParcelLayoutRemainderDistribution as LayParcelLayoutRemainderDistribution,
  CadParcelLayoutSettings as LayParcelLayoutSettings,
  CadParcelLayoutSolutionPreference as LayParcelLayoutSolutionPreference,
  CadParcelLayoutUiState as LayParcelLayoutUiState,
} from '../src/engine/cad/cadParcelLayoutTypes';
import type {
  CadGripHandle as GripGripHandle,
  CadGripHandleKind as GripGripHandleKind,
  CadSnapCandidate as GripSnapCandidate,
  CadSnapConstructionContext as GripSnapConstructionContext,
  CadSnapKind as GripSnapKind,
  CadSnapLock as GripSnapLock,
} from '../src/engine/cad/cadGripSnapTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const HUB = path.join(CAD_DIR, 'cadTypes.ts');
const LAY_LEAF = path.join(CAD_DIR, 'cadParcelLayoutTypes.ts');
const GRIP_LEAF = path.join(CAD_DIR, 'cadGripSnapTypes.ts');
const CORE_LEAF = path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts');
const DISPLAY_LEAF = path.join(CAD_DIR, 'cadDisplayTypes.ts');

/** The five parcel-layout contracts, in original source order. */
const MOVED_LAYOUT = [
  'CadParcelLayoutSolutionPreference',
  'CadParcelLayoutAutomaticMode',
  'CadParcelLayoutRemainderDistribution',
  'CadParcelLayoutSettings',
  'CadParcelLayoutUiState',
];

/** The six grip/snap contracts, in original source order. */
const MOVED_GRIP_SNAP = [
  'CadGripHandleKind',
  'CadGripHandle',
  'CadSnapKind',
  'CadSnapCandidate',
  'CadSnapLock',
  'CadSnapConstructionContext',
];

/** All eleven moved contracts, family order preserved. */
const MOVED_11 = [...MOVED_LAYOUT, ...MOVED_GRIP_SNAP];

/** Parcel-layout interfaces (the three unions are pinned separately). */
const LAY_INTERFACES = ['CadParcelLayoutSettings', 'CadParcelLayoutUiState'];

/** Grip/snap interfaces (the two unions are pinned separately). */
const GRIP_INTERFACES = ['CadGripHandle', 'CadSnapCandidate', 'CadSnapLock', 'CadSnapConstructionContext'];

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
  CadParcelLayoutSettings: [
    'minAreaSquareMeters:number',
    'minFrontageMeters:number',
    'useFrontageAtOffset:boolean',
    'frontageOffsetMeters:number',
    'minWidthMeters:number',
    'minDepthMeters:number',
    'useMaxDepth:boolean',
    'maxDepthMeters:number',
    'solutionPreference:CadParcelLayoutSolutionPreference',
    'automaticMode:CadParcelLayoutAutomaticMode',
    'remainderDistribution:CadParcelLayoutRemainderDistribution',
  ],
  CadParcelLayoutUiState: [
    'open:boolean',
    'collapsed:boolean',
    "dock:'floating'|'left'|'right'",
    'floatingLeftPx:number',
    'floatingTopPx:number',
    'floatingWidthPx:number',
    'floatingHeightPx:number',
    'activeParentParcelId:CadEntityId|null',
    'activeFrontageEntityId:CadEntityId|null',
    'activeFrontageParcelSegmentIds?:string[]|null',
    'settings:CadParcelLayoutSettings',
  ],
  CadGripHandle: [
    'id:string',
    'entityId:CadEntityId',
    'kind:CadGripHandleKind',
    'x:number',
    'y:number',
    'vertexIndex?:number',
    'courseIndex?:number',
  ],
  CadSnapCandidate: [
    'id:string',
    'kind:CadSnapKind',
    'sourceEntityId:CadEntityId',
    'sourceSegmentId?:string',
    'x:number',
    'y:number',
    'distance:number',
    'label:string',
    'computedScale?:number',
    'viewportGeneration?:number',
    'guideSegments?:Array<[CadDisplayPoint,CadDisplayPoint]>',
    'compoundKinds?:CadSnapKind[]',
    'lockGuidePoint?:CadDisplayPoint',
  ],
  CadSnapLock: [
    "kind:'extension'|'perpendicular'|'parallel'|'tangent'",
    'sourceEntityId:CadEntityId',
    'sourceSegmentId?:string',
    'guidePoint?:CadDisplayPoint',
  ],
  CadSnapConstructionContext: [
    'active:boolean',
    'basePoint:CadDisplayPoint|null',
    'scopeSeedSegmentId?:string|null',
    'tangentSeedArcEntityId?:string|null',
    'tangentSeedArcSegmentId?:string|null',
    'tangentSeedPoint?:CadDisplayPoint|null',
    'lockedSnap?:CadSnapLock|null',
  ],
};

/** Type-alias pins: whitespace-collapsed alias target text (clean unions). */
const EXPECTED_ALIAS_TEXT: Record<string, string> = {
  CadParcelLayoutSolutionPreference: "|'shortest_frontage'|'smallest_area'|'largest_area'|'most_rectangular'|'closest_to_target_area'",
  CadParcelLayoutAutomaticMode: "'off'|'single_preview'|'fill_parent'",
  CadParcelLayoutRemainderDistribution: "|'place_remainder_in_last_parcel'|'create_parcel_from_remainder'|'redistribute_remainder'",
  CadSnapKind: "|'point-node'|'endpoint'|'midpoint'|'center'|'arc-midpoint'|'quadrant'|'intersection'|'apparent-intersection'|'extension'|'perpendicular'|'parallel'|'direction'|'tangent'|'nearest'",
};

/** Union literal branch order pins (whitespace collapsed). */
const EXPECTED_UNION_BRANCHES: Record<string, string[]> = {
  CadParcelLayoutSolutionPreference: ["'shortest_frontage'", "'smallest_area'", "'largest_area'", "'most_rectangular'", "'closest_to_target_area'"],
  CadParcelLayoutAutomaticMode: ["'off'", "'single_preview'", "'fill_parent'"],
  CadParcelLayoutRemainderDistribution: ["'place_remainder_in_last_parcel'", "'create_parcel_from_remainder'", "'redistribute_remainder'"],
  CadGripHandleKind: ["'line-start'", "'line-end'", "'vertex'", "'arc-start'", "'arc-end'", "'arc-radius'", "'circle-center'", "'circle-radius'", "'insertion'", "'polyline-insert'"],
  CadSnapKind: ["'point-node'", "'endpoint'", "'midpoint'", "'center'", "'arc-midpoint'", "'quadrant'", "'intersection'", "'apparent-intersection'", "'extension'", "'perpendicular'", "'parallel'", "'direction'", "'tangent'", "'nearest'"],
};

/** Distinctive moved JSDoc markers that must travel with the declarations. */
const GRIP_JSDOC_MARKERS = [
  'secondary hollow grip',
  'POLYLINE_INSERT_VERTEX',
  'Present on `polyline-insert` grips only',
  'World-unit snap tolerance in effect',
  'Monotonic viewport transform generation',
  'Phase C2: exact course id',
];

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

const LAY_SPECIFIER = './cadParcelLayoutTypes';
const GRIP_SPECIFIER = './cadGripSnapTypes';

const hubSource = (): string => fs.readFileSync(HUB, 'utf8');
const laySource = (): string => fs.readFileSync(LAY_LEAF, 'utf8');
const gripSource = (): string => fs.readFileSync(GRIP_LEAF, 'utf8');

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

describe('STRUCT-241.7 leaf presence and declaration order', () => {
  it('both leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(LAY_LEAF)).toBe(true);
    expect(fs.existsSync(GRIP_LEAF)).toBe(true);
  });

  it('parcel-layout leaf declares exactly the 5 contracts in original order', () => {
    expect(exportedDeclNames(parse(LAY_LEAF))).toEqual(MOVED_LAYOUT);
  });

  it('grip/snap leaf declares exactly the 6 contracts in original order', () => {
    expect(exportedDeclNames(parse(GRIP_LEAF))).toEqual(MOVED_GRIP_SNAP);
  });

  it('the two leaves own disjoint name sets with no cross-import', () => {
    expect(new Set(MOVED_11).size).toBe(11);
    expect(allImportSpecifiers(LAY_LEAF)).not.toContain(GRIP_SPECIFIER);
    expect(allImportSpecifiers(GRIP_LEAF)).not.toContain(LAY_SPECIFIER);
  });
});

describe('STRUCT-241.7 baseline parcel-layout interface shapes pinned verbatim', () => {
  it.each(LAY_INTERFACES)('layout leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(LAY_LEAF), 'layout leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.7 baseline grip/snap interface shapes pinned verbatim', () => {
  it.each(GRIP_INTERFACES)('grip leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(GRIP_LEAF), 'grip leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.7 baseline alias and union shapes pinned verbatim', () => {
  it.each(Object.keys(EXPECTED_ALIAS_TEXT))('leaf alias %s matches the hand-transcribed alias', (name) => {
    const file = MOVED_LAYOUT.includes(name) ? parse(LAY_LEAF) : parse(GRIP_LEAF);
    const label = MOVED_LAYOUT.includes(name) ? 'layout leaf' : 'grip leaf';
    expect(aliasTextOf(file, label, name)).toBe(EXPECTED_ALIAS_TEXT[name]);
  });

  it.each(Object.keys(EXPECTED_UNION_BRANCHES))('leaf union %s keeps its literal branch order', (name) => {
    const file = MOVED_LAYOUT.includes(name) ? parse(LAY_LEAF) : parse(GRIP_LEAF);
    const label = MOVED_LAYOUT.includes(name) ? 'layout leaf' : 'grip leaf';
    expect(unionMembers(file, label, name)).toEqual(EXPECTED_UNION_BRANCHES[name]);
  });
});

describe('STRUCT-241.7 JSDoc parity (comments travel with the declarations)', () => {
  it.each(GRIP_JSDOC_MARKERS)('grip leaf keeps marker %s', (marker) => {
    expect(gripSource()).toContain(marker);
  });

  it('polyline-insert inline JSDoc stays inside the grip-kind union in position', () => {
    const source = gripSource();
    const insertion = source.indexOf("| 'insertion'");
    const comment = source.indexOf('secondary hollow grip');
    const polyInsert = source.indexOf("'polyline-insert'");
    expect(insertion).toBeGreaterThan(-1);
    expect(comment).toBeGreaterThan(insertion);
    expect(polyInsert).toBeGreaterThan(comment);
  });

  it('courseIndex JSDoc immediately precedes the courseIndex prop', () => {
    const source = gripSource();
    const marker = source.indexOf('Present on `polyline-insert` grips only');
    const prop = source.indexOf('courseIndex?: number;');
    expect(marker).toBeGreaterThan(-1);
    expect(prop).toBeGreaterThan(marker);
    expect(prop - marker).toBeLessThan(200);
  });

  it('computedScale/viewportGeneration JSDocs precede their optional props', () => {
    const source = gripSource();
    for (const [marker, prop] of [
      ['World-unit snap tolerance in effect', 'computedScale?: number;'],
      ['Monotonic viewport transform generation', 'viewportGeneration?: number;'],
    ] as const) {
      const markerAt = source.indexOf(marker);
      const propAt = source.indexOf(prop);
      expect(markerAt).toBeGreaterThan(-1);
      expect(propAt).toBeGreaterThan(markerAt);
    }
  });

  it('hub keeps none of the moved grip/snap JSDoc bodies', () => {
    const hub = hubSource();
    for (const marker of GRIP_JSDOC_MARKERS) {
      expect(hub).not.toContain(marker);
    }
    expect(hub).not.toContain('secondary hollow grip');
  });
});

// ---------------------------------------------------------------------------
// Facade contract: hub re-exports all 11, keeps no originals.
// ---------------------------------------------------------------------------

describe('STRUCT-241.7 hub facade re-exports', () => {
  it('re-exports all 5 parcel-layout names from the new layout leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${LAY_SPECIFIER}';`);
    for (const name of MOVED_LAYOUT) {
      expect(source).toContain(`  ${name},`);
    }
  });

  it('re-exports all 6 grip/snap names from the new grip leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${GRIP_SPECIFIER}';`);
    for (const name of MOVED_GRIP_SNAP) {
      expect(source).toContain(`  ${name},`);
    }
  });

  it('keeps no original interface/alias declaration for any moved name', () => {
    const source = hubSource();
    for (const name of MOVED_11) {
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
    expect(typeImports).toContain(LAY_SPECIFIER);
    expect(typeImports).toContain(GRIP_SPECIFIER);
  });

  it('keeps the CadEntity union declaration in the hub', () => {
    expect(hubSource()).toContain('export type CadEntity =');
  });

  it('keeps the persisted project/drawing parcel-layout surface on the old path', () => {
    const hub = hubSource();
    expect(hub).toContain('parcelLayout?: CadParcelLayoutUiState;');
    expect(hub).toContain('export interface CadProject {');
    expect(hub).toContain('export interface CadDrawingDocument {');
    expect(hub).toContain('export interface SurveyCadPersistedState {');
  });
});

// ---------------------------------------------------------------------------
// Facade-vs-leaf type equality, bidirectional (all 11).
// ---------------------------------------------------------------------------

describe('STRUCT-241.7 parcel-layout facade vs leaf type equality', () => {
  it('CadParcelLayoutSolutionPreference equality holds both directions', () => {
    expectTypeOf<LayParcelLayoutSolutionPreference>().toEqualTypeOf<HubParcelLayoutSolutionPreference>();
    expectTypeOf<HubParcelLayoutSolutionPreference>().toEqualTypeOf<LayParcelLayoutSolutionPreference>();
  });
  it('CadParcelLayoutAutomaticMode equality holds both directions', () => {
    expectTypeOf<LayParcelLayoutAutomaticMode>().toEqualTypeOf<HubParcelLayoutAutomaticMode>();
    expectTypeOf<HubParcelLayoutAutomaticMode>().toEqualTypeOf<LayParcelLayoutAutomaticMode>();
  });
  it('CadParcelLayoutRemainderDistribution equality holds both directions', () => {
    expectTypeOf<LayParcelLayoutRemainderDistribution>().toEqualTypeOf<HubParcelLayoutRemainderDistribution>();
    expectTypeOf<HubParcelLayoutRemainderDistribution>().toEqualTypeOf<LayParcelLayoutRemainderDistribution>();
  });
  it('CadParcelLayoutSettings equality holds both directions', () => {
    expectTypeOf<LayParcelLayoutSettings>().toEqualTypeOf<HubParcelLayoutSettings>();
    expectTypeOf<HubParcelLayoutSettings>().toEqualTypeOf<LayParcelLayoutSettings>();
  });
  it('CadParcelLayoutUiState equality holds both directions', () => {
    expectTypeOf<LayParcelLayoutUiState>().toEqualTypeOf<HubParcelLayoutUiState>();
    expectTypeOf<HubParcelLayoutUiState>().toEqualTypeOf<LayParcelLayoutUiState>();
  });
});

describe('STRUCT-241.7 grip/snap facade vs leaf type equality', () => {
  it('CadGripHandleKind equality holds both directions', () => {
    expectTypeOf<GripGripHandleKind>().toEqualTypeOf<HubGripHandleKind>();
    expectTypeOf<HubGripHandleKind>().toEqualTypeOf<GripGripHandleKind>();
  });
  it('CadGripHandle equality holds both directions', () => {
    expectTypeOf<GripGripHandle>().toEqualTypeOf<HubGripHandle>();
    expectTypeOf<HubGripHandle>().toEqualTypeOf<GripGripHandle>();
  });
  it('CadSnapKind equality holds both directions', () => {
    expectTypeOf<GripSnapKind>().toEqualTypeOf<HubSnapKind>();
    expectTypeOf<HubSnapKind>().toEqualTypeOf<GripSnapKind>();
  });
  it('CadSnapCandidate equality holds both directions', () => {
    expectTypeOf<GripSnapCandidate>().toEqualTypeOf<HubSnapCandidate>();
    expectTypeOf<HubSnapCandidate>().toEqualTypeOf<GripSnapCandidate>();
  });
  it('CadSnapLock equality holds both directions', () => {
    expectTypeOf<GripSnapLock>().toEqualTypeOf<HubSnapLock>();
    expectTypeOf<HubSnapLock>().toEqualTypeOf<GripSnapLock>();
  });
  it('CadSnapConstructionContext equality holds both directions', () => {
    expectTypeOf<GripSnapConstructionContext>().toEqualTypeOf<HubSnapConstructionContext>();
    expectTypeOf<HubSnapConstructionContext>().toEqualTypeOf<GripSnapConstructionContext>();
  });
});

// ---------------------------------------------------------------------------
// Unaffected hub unions: CadEntity order, CadBlockChild order, child type.
// ---------------------------------------------------------------------------

describe('STRUCT-241.7 unaffected hub unions', () => {
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

describe('STRUCT-241.7 type-only leaves and emit parity', () => {
  it('layout leaf has zero runtime imports, zero value declarations, allowlisted type edges', () => {
    expect(runtimeImportSpecifiers(LAY_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(LAY_LEAF)).toBe(true);
    expect(valueStatementKinds(LAY_LEAF)).toEqual([]);
    expect(allImportSpecifiers(LAY_LEAF)).toEqual(['./cadCorePrimitiveTypes']);
  });

  it('grip leaf has zero runtime imports, zero value declarations, allowlisted type edges', () => {
    expect(runtimeImportSpecifiers(GRIP_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(GRIP_LEAF)).toBe(true);
    expect(valueStatementKinds(GRIP_LEAF)).toEqual([]);
    expect(allImportSpecifiers(GRIP_LEAF)).toEqual(['./cadCorePrimitiveTypes', './cadDisplayTypes']);
  });

  it('neither leaf imports cadTypes, a barrel, or an engine runtime module', () => {
    for (const file of [LAY_LEAF, GRIP_LEAF]) {
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
    expect(strippedEmit(LAY_LEAF)).toBe('export {};');
    expect(strippedEmit(GRIP_LEAF)).toBe('export {};');
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
// The 241.7 extraction is type-only, so both VALUE|mixed digests are
// unchanged; the explicit TYPE allowlist adds +2 nodes / +7 scoped edges
// (layout: 1 out + hub import + hub export; grip: 2 out + hub import + hub
// export; no retired hub edge) and +2 nodes / +7 full edges (every 241.7
// edge resolves inside `src`, so the full-scope delta matches the scoped
// delta here).
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

describe('STRUCT-241.7 CAD+F2F graph pins', () => {
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph(); // first/cold scoped build; 30 s tolerates full-suite CI load
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // 241.6 baseline 493 / 2433; the type-only 241.7 leaves add +2 nodes and
    // +7 type edges (layout: 1 out + hub import + hub export; grip:
    // 2 out + hub import + hub export; no retired hub edge).
    expect(graph.nodes.length).toBe(495);
    expect(graph.edges.length).toBe(2440);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  }, 30_000);

  it('adds exactly the allow-listed TYPE edges incident to the layout leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(LAY_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts')), specifier: './cadCorePrimitiveTypes', kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: LAY_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('adds exactly the allow-listed TYPE edges incident to the grip leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(GRIP_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts')), specifier: './cadCorePrimitiveTypes', kind: 'type' },
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadDisplayTypes.ts')), specifier: './cadDisplayTypes', kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: GRIP_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('has no leaf back-edge to the hub or to engine runtime modules', () => {
    const graph = cadF2fGraph();
    for (const leaf of [path.resolve(LAY_LEAF), path.resolve(GRIP_LEAF)]) {
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

describe('STRUCT-241.7 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // 241.6 baseline 1665 / 7544; the 241.7 leaves add +2 nodes and +7 type
    // edges (same allowlist as the scoped pin; every 241.7 edge resolves
    // inside `src`).
    expect(graph.nodes.length).toBe(1667);
    expect(graph.edges.length).toBe(7551);
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

describe('STRUCT-241.7 negative controls (in-memory mutations only)', () => {
  it('fails the alias pin when a parcel solution-preference literal changes', () => {
    const mutated = laySource().replace("'smallest_area'", "'smallest-area'");
    expect(mutated).not.toBe(laySource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadParcelLayoutSolutionPreference'))
      .toBe(EXPECTED_ALIAS_TEXT['CadParcelLayoutSolutionPreference'])).toThrow();
  });

  it('fails the alias pin when a remainder-distribution literal changes', () => {
    const mutated = laySource().replace("'redistribute_remainder'", "'redistribute-all'");
    expect(mutated).not.toBe(laySource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadParcelLayoutRemainderDistribution'))
      .toBe(EXPECTED_ALIAS_TEXT['CadParcelLayoutRemainderDistribution'])).toThrow();
  });

  it('fails the shape pin when the nullable activeParentParcelId loses its null', () => {
    const mutated = laySource().replace(
      '  activeParentParcelId: CadEntityId | null;',
      '  activeParentParcelId: CadEntityId;',
    );
    expect(mutated).not.toBe(laySource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadParcelLayoutUiState'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadParcelLayoutUiState'])).toThrow();
  });

  it('fails the shape pin when the optional frontage segment list becomes required', () => {
    const mutated = laySource().replace(
      '  activeFrontageParcelSegmentIds?: string[] | null;',
      '  activeFrontageParcelSegmentIds: string[] | null;',
    );
    expect(mutated).not.toBe(laySource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadParcelLayoutUiState'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadParcelLayoutUiState'])).toThrow();
  });

  it('fails the union pin when the polyline-insert grip kind goes missing', () => {
    const mutated = gripSource().replace("  | 'polyline-insert';", ';');
    expect(mutated).not.toBe(gripSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadGripHandleKind'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadGripHandleKind'])).toThrow();
  });

  it('fails the shape pin when the polyline courseIndex becomes required', () => {
    const mutated = gripSource().replace('  courseIndex?: number;', '  courseIndex: number;');
    expect(mutated).not.toBe(gripSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadGripHandle'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadGripHandle'])).toThrow();
  });

  it('fails the alias pin when a snap-kind literal changes', () => {
    const mutated = gripSource().replace("'apparent-intersection'", "'apparent-crossing'");
    expect(mutated).not.toBe(gripSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadSnapKind'))
      .toBe(EXPECTED_ALIAS_TEXT['CadSnapKind'])).toThrow();
  });

  it('fails the shape pin when computedScale goes missing', () => {
    const mutated = gripSource().replace('  computedScale?: number;\n', '');
    expect(mutated).not.toBe(gripSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSnapCandidate'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSnapCandidate'])).toThrow();
  });

  it('fails the shape pin when viewportGeneration goes missing', () => {
    const mutated = gripSource().replace('  viewportGeneration?: number;\n', '');
    expect(mutated).not.toBe(gripSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSnapCandidate'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSnapCandidate'])).toThrow();
  });

  it('fails the shape pin when the tangent-seed arc segment id goes missing', () => {
    const mutated = gripSource().replace('  tangentSeedArcSegmentId?: string | null;\n', '');
    expect(mutated).not.toBe(gripSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSnapConstructionContext'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSnapConstructionContext'])).toThrow();
  });

  it('fails the shape pin when the locked snap nullability is dropped', () => {
    const mutated = gripSource().replace(
      '  lockedSnap?: CadSnapLock | null;',
      '  lockedSnap?: CadSnapLock;',
    );
    expect(mutated).not.toBe(gripSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSnapConstructionContext'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSnapConstructionContext'])).toThrow();
  });

  it('detects a removed public re-export from the hub facade', () => {
    const hub = hubSource();
    // Withdraw ONLY the export-type entry; the local `import type` stays, so
    // the hub still typechecks locally against the leaf while the public
    // re-export surface is the thing under test.
    const exportBlock = facadeBlockTextOf(hub, GRIP_SPECIFIER, 'export');
    const mutatedExportBlock = exportBlock.replace('  CadSnapKind,\n', '');
    expect(mutatedExportBlock).not.toBe(exportBlock);
    const mutated = hub.replace(exportBlock, mutatedExportBlock);
    expect(mutated).not.toBe(hub);
    // Import block retains the name (local resolution intact); export block
    // is where the absence must be observed, not the whole hub.
    expect(facadeBlockTextOf(mutated, GRIP_SPECIFIER, 'import')).toContain('  CadSnapKind,');
    const mutatedExport = facadeBlockTextOf(mutated, GRIP_SPECIFIER, 'export');
    expect(mutatedExport).not.toContain('  CadSnapKind,');
    for (const name of MOVED_GRIP_SNAP) {
      if (name === 'CadSnapKind') continue;
      expect(mutatedExport).toContain(`  ${name},`);
    }
  });

  it('fails the CadEntity union-order pin when two members are swapped', () => {
    const hub = hubSource();
    const mutated = hub.replace(
      '  | CadParcelEntity\n  | CadTextEntity\n',
      '  | CadTextEntity\n  | CadParcelEntity\n',
    );
    expect(mutated).not.toBe(hub);
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadEntity'))
      .toEqual(EXPECTED_CAD_ENTITY_ORDER)).toThrow();
  });

  it('catches a simulated leaf-to-hub TYPE back-edge as a new TYPE cycle', () => {
    const mutatedLeaf = `${gripSource()}\nimport type { CadProject } from './cadTypes';\nexport type CycleProbe = CadProject | null;\n`;
    const graph = buildGraphs([
      { path: path.resolve(GRIP_LEAF), source: mutatedLeaf },
      { path: path.resolve(HUB), source: hubSource() },
    ]);
    const typeCycles = findCycles(graph.nodes, graph.type);
    const cyclic = new Set(typeCycles.cyclic.flat());
    expect(cyclic.has(path.resolve(GRIP_LEAF))).toBe(true);
    expect(cyclic.has(path.resolve(HUB))).toBe(true);
  });

  it('detects a simulated value import on the layout leaf as a runtime edge', () => {
    const mutated = laySource().replace(
      "import type { CadEntityId } from './cadCorePrimitiveTypes';",
      "import { CadEntityId } from './cadCorePrimitiveTypes';",
    );
    expect(mutated).not.toBe(laySource());
    expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(false);
    expect(runtimeImportSpecifiersSource(parseText('m.ts', mutated))).toEqual(['./cadCorePrimitiveTypes']);
    const graph = buildGraphs([
      { path: path.resolve(LAY_LEAF), source: mutated },
      { path: path.resolve(CORE_LEAF), source: fs.readFileSync(CORE_LEAF, 'utf8') },
    ]);
    expect(graph.edges.filter((edge) => edge.from === path.resolve(LAY_LEAF) && edge.kind === 'value')).toHaveLength(1);
  });

  it('detects a simulated value import on the grip leaf as a runtime edge', () => {
    const mutated = gripSource().replace(
      "import type { CadDisplayPoint } from './cadDisplayTypes';",
      "import { CadDisplayPoint } from './cadDisplayTypes';",
    );
    expect(mutated).not.toBe(gripSource());
    expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(false);
    expect(runtimeImportSpecifiersSource(parseText('m.ts', mutated))).toEqual(['./cadDisplayTypes']);
    const graph = buildGraphs([
      { path: path.resolve(GRIP_LEAF), source: mutated },
      { path: path.resolve(DISPLAY_LEAF), source: fs.readFileSync(DISPLAY_LEAF, 'utf8') },
    ]);
    expect(graph.edges.filter((edge) => edge.from === path.resolve(GRIP_LEAF) && edge.kind === 'value')).toHaveLength(1);
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(LAY_LEAF, 'utf8')).toBe(laySource());
    expect(fs.readFileSync(GRIP_LEAF, 'utf8')).toBe(gripSource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
  });
});

describe('STRUCT-241.7 prior phase guards stay green by import existence', () => {
  it.each([
    'cad_survey_layer_command_type_leaves_2411',
    'cad_block_command_type_leaf_2412',
    'cad_entity_style_presentation_type_leaves_2413',
    'cad_primitive_geometry_entity_type_leaf_2414',
    'cad_annotation_survey_table_type_leaves_2415',
    'cad_linear_design_parcel_entity_type_leaves_2416',
    'cad_annotation_cogo_type_cycle_1957',
    'cad_annotation_persistence',
    'cad_annotation_renderer',
    'cad_feature_line_geometry_20a',
    'cad_parcel_shared_boundary_19d',
    'cad_parcel_plan_designation_19d',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });
});
