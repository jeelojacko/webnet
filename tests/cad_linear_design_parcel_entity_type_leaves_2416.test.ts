/**
 * STRUCT-241.6 — CAD linear-design + parcel entity type leaves.
 *
 * Pins `src/engine/cad/cadLinearDesignEntityTypes.ts` (3 alignment +
 * feature-line contracts: alignment element/equation/entity, feature-line
 * vertex/segment-geometry/entity) and
 * `src/engine/cad/cadParcelEntityTypes.ts` (6 parcel contracts: course
 * geometry, plan role/info, shared-boundary end/relationship, parcel
 * entity), extracted verbatim out of `src/engine/cad/cadTypes.ts` so the
 * hub keeps every historic `from './cadTypes'` consumer compiling via
 * `export type` re-exports:
 *
 * - `CadAlignmentElement` — line/arc alignment-element union.
 * - `CadStationEquation` — back/ahead/raw station equation.
 * - `CadAlignmentEntity` — alignment entity.
 * - `CadFeatureLineVertex` — Phase 20A 3D feature-line vertex (z required).
 * - `CadFeatureLineSegmentGeometry` — Phase 20A per-course line/arc bulge.
 * - `CadFeatureLineEntity` — Phase 20A 3D feature line.
 * - `CadParcelCourseGeometry` — Phase 19C mixed line/arc course bulge.
 * - `CadParcelPlanRole` — Phase 19D plan-role display literal union.
 * - `CadParcelPlanInfo` — Phase 19D plan designation display metadata.
 * - `CadParcelSharedBoundaryEnd` — Phase 19D parcel-course ref end.
 * - `CadParcelSharedBoundary` — Phase 19D shared-boundary relationship.
 * - `CadParcelEntity` — parcel entity with course/closure/plan metadata.
 *
 * Covers: hand-transcribed pre-refactor interface/alias shape pins (ordered
 * props, optionality, normalized type text) for all 12 declarations;
 * declaration order in each leaf; union literal branch order; JSDoc parity
 * markers (Phase 20A/19C/19D/19A bodies moved with their declarations, hub
 * keeps none of them); both-direction facade-vs-leaf `expectTypeOf`
 * equality for all 12; all 12 historic public re-exports with no leftover
 * original declarations in the hub; the exact `CadEntity` 19-union order;
 * the exact `CadBlockChild` 6-union order; type-only + emit pins (hub emit
 * byte-identical, each leaf `export {};`); CAD+F2F and full-`src` graph
 * pins rolled forward by the measured type-only delta (+2 nodes / +9
 * scoped edges, +2 nodes / +9 full edges) with both historical
 * value/mixed digests unchanged; and in-memory negative controls.
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
  CadAlignmentElement as HubAlignmentElement,
  CadAlignmentEntity as HubAlignmentEntity,
  CadFeatureLineEntity as HubFeatureLineEntity,
  CadFeatureLineSegmentGeometry as HubFeatureLineSegmentGeometry,
  CadFeatureLineVertex as HubFeatureLineVertex,
  CadParcelCourseGeometry as HubParcelCourseGeometry,
  CadParcelEntity as HubParcelEntity,
  CadParcelPlanInfo as HubParcelPlanInfo,
  CadParcelPlanRole as HubParcelPlanRole,
  CadParcelSharedBoundary as HubParcelSharedBoundary,
  CadParcelSharedBoundaryEnd as HubParcelSharedBoundaryEnd,
  CadStationEquation as HubStationEquation,
} from '../src/engine/cad/cadTypes';
import type {
  CadAlignmentElement as LinAlignmentElement,
  CadAlignmentEntity as LinAlignmentEntity,
  CadFeatureLineEntity as LinFeatureLineEntity,
  CadFeatureLineSegmentGeometry as LinFeatureLineSegmentGeometry,
  CadFeatureLineVertex as LinFeatureLineVertex,
  CadStationEquation as LinStationEquation,
} from '../src/engine/cad/cadLinearDesignEntityTypes';
import type {
  CadParcelCourseGeometry as ParParcelCourseGeometry,
  CadParcelEntity as ParParcelEntity,
  CadParcelPlanInfo as ParParcelPlanInfo,
  CadParcelPlanRole as HubParcelPlanRoleAlias,
  CadParcelSharedBoundary as ParParcelSharedBoundary,
  CadParcelSharedBoundaryEnd as ParParcelSharedBoundaryEnd,
} from '../src/engine/cad/cadParcelEntityTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const HUB = path.join(CAD_DIR, 'cadTypes.ts');
const LIN_LEAF = path.join(CAD_DIR, 'cadLinearDesignEntityTypes.ts');
const PAR_LEAF = path.join(CAD_DIR, 'cadParcelEntityTypes.ts');
const FOUNDATION_LEAF = path.join(CAD_DIR, 'cadEntityFoundationTypes.ts');

/** The six linear-design contracts, in original source order. */
const MOVED_LINEAR = [
  'CadAlignmentElement',
  'CadStationEquation',
  'CadAlignmentEntity',
  'CadFeatureLineVertex',
  'CadFeatureLineSegmentGeometry',
  'CadFeatureLineEntity',
];

/** The six parcel contracts, in original source order. */
const MOVED_PARCEL = [
  'CadParcelCourseGeometry',
  'CadParcelPlanRole',
  'CadParcelPlanInfo',
  'CadParcelSharedBoundaryEnd',
  'CadParcelSharedBoundary',
  'CadParcelEntity',
];

/** All twelve moved contracts, family order preserved. */
const MOVED_12 = [...MOVED_LINEAR, ...MOVED_PARCEL];

/** Linear-design interfaces (the two unions are pinned separately). */
const LIN_INTERFACES = MOVED_LINEAR.filter(
  (name) => name !== 'CadAlignmentElement' && name !== 'CadFeatureLineSegmentGeometry',
);

/** Parcel interfaces (the two unions are pinned separately). */
const PAR_INTERFACES = MOVED_PARCEL.filter(
  (name) => name !== 'CadParcelCourseGeometry' && name !== 'CadParcelPlanRole',
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
  CadStationEquation: [
    'backStation:number',
    'aheadStation:number',
    'rawStation?:number',
  ],
  CadAlignmentEntity: [
    "type:'alignment'",
    'name:string',
    'elements:CadAlignmentElement[]',
    'startStation:number',
    'stationEquations?:CadStationEquation[]',
  ],
  CadFeatureLineVertex: [
    'id:string',
    'x:number',
    'y:number',
    'z:number',
  ],
  CadFeatureLineEntity: [
    "type:'feature-line'",
    'vertices:CadFeatureLineVertex[]',
    'segmentGeometry?:CadFeatureLineSegmentGeometry[]',
    'closed?:boolean',
    'name?:string',
    'description?:string',
  ],
  CadParcelPlanInfo: [
    'designation?:string',
    'role?:CadParcelPlanRole',
    'description?:string',
  ],
  CadParcelSharedBoundaryEnd: [
    'parcelId:string',
    'courseId:string',
  ],
  CadParcelSharedBoundary: [
    'id:string',
    'first:CadParcelSharedBoundaryEnd',
    'second:CadParcelSharedBoundaryEnd',
  ],
  CadParcelEntity: [
    "type:'parcel'",
    'vertices:CadDisplayPoint[]',
    'vertexLabels:string[]',
    'parcelName:string',
    'courseIds?:string[]',
    'courseGeometry?:CadParcelCourseGeometry[]',
    'areaSquareMeters?:number',
    'perimeterMeters?:number',
    'closureDeltaX?:number',
    'closureDeltaY?:number',
    'closureDistanceMeters?:number',
    'planInfo?:CadParcelPlanInfo',
  ],
};

/** Type-alias pins: whitespace-collapsed alias target text. */
const EXPECTED_ALIAS_TEXT: Record<string, string> = {
  CadAlignmentElement: "|{kind:'line';start:CadDisplayPoint;end:CadDisplayPoint;sourceEntityId?:CadEntityId;}|{kind:'arc';center:CadDisplayPoint;radius:number;startAngleDeg:number;endAngleDeg:number;sourceEntityId?:CadEntityId;}",
  CadFeatureLineSegmentGeometry: "{kind:'line'}|{kind:'arc';bulge:number}",
  CadParcelCourseGeometry: "{kind:'line'}|{kind:'arc';bulge:number}",
  CadParcelPlanRole: "|'lot'|'remainder'|'road'|'right-of-way'|'easement'|'other'",
};

/** Entity discriminant literal pins. */
const EXPECTED_DISCRIMINANTS: Record<string, string> = {
  CadAlignmentEntity: "'alignment'",
  CadFeatureLineEntity: "'feature-line'",
  CadParcelEntity: "'parcel'",
};

/** Union literal branch order pins (whitespace collapsed). */
const EXPECTED_UNION_BRANCHES: Record<string, string[]> = {
  CadAlignmentElement: [
    "{kind:'line';start:CadDisplayPoint;end:CadDisplayPoint;sourceEntityId?:CadEntityId;}",
    "{kind:'arc';center:CadDisplayPoint;radius:number;startAngleDeg:number;endAngleDeg:number;sourceEntityId?:CadEntityId;}",
  ],
  CadFeatureLineSegmentGeometry: ["{kind:'line'}", "{kind:'arc';bulge:number}"],
  CadParcelCourseGeometry: ["{kind:'line'}", "{kind:'arc';bulge:number}"],
  CadParcelPlanRole: ["'lot'", "'remainder'", "'road'", "'right-of-way'", "'easement'", "'other'"],
};

/** Distinctive moved JSDoc markers that must travel with the declarations. */
const LINEAR_JSDOC_MARKERS = [
  'feature-vertex:<featureLineId>:<stableId>',
  'same signed',
  'CAD-standard bulge convention as CadParcelCourseGeometry',
  'ADDITIVE ONLY — no',
  'segmentGeometry.length === course count',
];

const PARCEL_JSDOC_MARKERS = [
  'b = tan(sweepRad/4): sign carries left/right',
  'infer legal meaning',
  'display metadata only, never legal meaning',
  'a ref to one parcel course (never geometry)',
  'two parcel-course refs, nothing',
  'courseIds[index] names the course',
  'courseGeometry.length === vertices.length',
  'Phase 19D plan designation (display metadata only). Trailing key.',
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

const LIN_SPECIFIER = './cadLinearDesignEntityTypes';
const PAR_SPECIFIER = './cadParcelEntityTypes';

const hubSource = (): string => fs.readFileSync(HUB, 'utf8');
const linSource = (): string => fs.readFileSync(LIN_LEAF, 'utf8');
const parSource = (): string => fs.readFileSync(PAR_LEAF, 'utf8');

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

describe('STRUCT-241.6 leaf presence and declaration order', () => {
  it('both leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(LIN_LEAF)).toBe(true);
    expect(fs.existsSync(PAR_LEAF)).toBe(true);
  });

  it('linear-design leaf declares exactly the 6 contracts in original order', () => {
    expect(exportedDeclNames(parse(LIN_LEAF))).toEqual(MOVED_LINEAR);
  });

  it('parcel leaf declares exactly the 6 contracts in original order', () => {
    expect(exportedDeclNames(parse(PAR_LEAF))).toEqual(MOVED_PARCEL);
  });

  it('the two leaves own disjoint name sets with no cross-import', () => {
    expect(new Set(MOVED_12).size).toBe(12);
    expect(allImportSpecifiers(LIN_LEAF)).not.toContain(PAR_SPECIFIER);
    expect(allImportSpecifiers(PAR_LEAF)).not.toContain(LIN_SPECIFIER);
  });
});

describe('STRUCT-241.6 baseline linear-design interface shapes pinned verbatim', () => {
  it.each(LIN_INTERFACES)('linear leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(LIN_LEAF), 'linear leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.6 baseline parcel interface shapes pinned verbatim', () => {
  it.each(PAR_INTERFACES)('parcel leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(PAR_LEAF), 'parcel leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.6 baseline alias and discriminant shapes pinned verbatim', () => {
  it.each(Object.keys(EXPECTED_ALIAS_TEXT))('leaf alias %s matches the hand-transcribed alias', (name) => {
    const file = MOVED_LINEAR.includes(name) ? parse(LIN_LEAF) : parse(PAR_LEAF);
    const label = MOVED_LINEAR.includes(name) ? 'linear leaf' : 'parcel leaf';
    expect(aliasTextOf(file, label, name)).toBe(EXPECTED_ALIAS_TEXT[name]);
  });

  it.each(Object.keys(EXPECTED_DISCRIMINANTS))('leaf %s keeps its discriminant literal', (name) => {
    const file = MOVED_LINEAR.includes(name) ? parse(LIN_LEAF) : parse(PAR_LEAF);
    const label = MOVED_LINEAR.includes(name) ? 'linear leaf' : 'parcel leaf';
    expect(discriminantOf(file, label, name)).toBe(EXPECTED_DISCRIMINANTS[name]);
  });

  it.each(Object.keys(EXPECTED_UNION_BRANCHES))('leaf union %s keeps its literal branch order', (name) => {
    const file = MOVED_LINEAR.includes(name) ? parse(LIN_LEAF) : parse(PAR_LEAF);
    const label = MOVED_LINEAR.includes(name) ? 'linear leaf' : 'parcel leaf';
    expect(unionMembers(file, label, name)).toEqual(EXPECTED_UNION_BRANCHES[name]);
  });
});

describe('STRUCT-241.6 JSDoc parity (comments travel with the declarations)', () => {
  it.each(LINEAR_JSDOC_MARKERS)('linear leaf keeps marker %s', (marker) => {
    expect(linSource()).toContain(marker);
  });

  it.each(PARCEL_JSDOC_MARKERS)('parcel leaf keeps marker %s', (marker) => {
    expect(parSource()).toContain(marker);
  });

  it('hub keeps none of the moved Phase 20A / 19C / 19D / 19A contract bodies', () => {
    const hub = hubSource();
    for (const marker of [...LINEAR_JSDOC_MARKERS, ...PARCEL_JSDOC_MARKERS]) {
      expect(hub).not.toContain(marker);
    }
  });
});

// ---------------------------------------------------------------------------
// Facade contract: hub re-exports all 12, keeps no originals.
// ---------------------------------------------------------------------------

describe('STRUCT-241.6 hub facade re-exports', () => {
  it('re-exports all 6 linear-design names from the new linear leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${LIN_SPECIFIER}';`);
    for (const name of MOVED_LINEAR) {
      expect(source).toContain(`  ${name},`);
    }
  });

  it('re-exports all 6 parcel names from the new parcel leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${PAR_SPECIFIER}';`);
    for (const name of MOVED_PARCEL) {
      expect(source).toContain(`  ${name},`);
    }
  });

  it('keeps no original interface/alias declaration for any moved name', () => {
    const source = hubSource();
    for (const name of MOVED_12) {
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
    expect(typeImports).toContain(LIN_SPECIFIER);
    expect(typeImports).toContain(PAR_SPECIFIER);
  });

  it('keeps the CadEntity union declaration in the hub', () => {
    expect(hubSource()).toContain('export type CadEntity =');
  });
});

// ---------------------------------------------------------------------------
// Facade-vs-leaf type equality, bidirectional (all 12).
// ---------------------------------------------------------------------------

describe('STRUCT-241.6 linear-design facade vs leaf type equality', () => {
  it('CadAlignmentElement equality holds both directions', () => {
    expectTypeOf<LinAlignmentElement>().toEqualTypeOf<HubAlignmentElement>();
    expectTypeOf<HubAlignmentElement>().toEqualTypeOf<LinAlignmentElement>();
  });
  it('CadStationEquation equality holds both directions', () => {
    expectTypeOf<LinStationEquation>().toEqualTypeOf<HubStationEquation>();
    expectTypeOf<HubStationEquation>().toEqualTypeOf<LinStationEquation>();
  });
  it('CadAlignmentEntity equality holds both directions', () => {
    expectTypeOf<LinAlignmentEntity>().toEqualTypeOf<HubAlignmentEntity>();
    expectTypeOf<HubAlignmentEntity>().toEqualTypeOf<LinAlignmentEntity>();
  });
  it('CadFeatureLineVertex equality holds both directions', () => {
    expectTypeOf<LinFeatureLineVertex>().toEqualTypeOf<HubFeatureLineVertex>();
    expectTypeOf<HubFeatureLineVertex>().toEqualTypeOf<LinFeatureLineVertex>();
  });
  it('CadFeatureLineSegmentGeometry equality holds both directions', () => {
    expectTypeOf<LinFeatureLineSegmentGeometry>().toEqualTypeOf<HubFeatureLineSegmentGeometry>();
    expectTypeOf<HubFeatureLineSegmentGeometry>().toEqualTypeOf<LinFeatureLineSegmentGeometry>();
  });
  it('CadFeatureLineEntity equality holds both directions', () => {
    expectTypeOf<LinFeatureLineEntity>().toEqualTypeOf<HubFeatureLineEntity>();
    expectTypeOf<HubFeatureLineEntity>().toEqualTypeOf<LinFeatureLineEntity>();
  });
});

describe('STRUCT-241.6 parcel facade vs leaf type equality', () => {
  it('CadParcelCourseGeometry equality holds both directions', () => {
    expectTypeOf<ParParcelCourseGeometry>().toEqualTypeOf<HubParcelCourseGeometry>();
    expectTypeOf<HubParcelCourseGeometry>().toEqualTypeOf<ParParcelCourseGeometry>();
  });
  it('CadParcelPlanRole equality holds both directions', () => {
    expectTypeOf<HubParcelPlanRoleAlias>().toEqualTypeOf<HubParcelPlanRole>();
    expectTypeOf<HubParcelPlanRole>().toEqualTypeOf<HubParcelPlanRoleAlias>();
  });
  it('CadParcelPlanInfo equality holds both directions', () => {
    expectTypeOf<ParParcelPlanInfo>().toEqualTypeOf<HubParcelPlanInfo>();
    expectTypeOf<HubParcelPlanInfo>().toEqualTypeOf<ParParcelPlanInfo>();
  });
  it('CadParcelSharedBoundaryEnd equality holds both directions', () => {
    expectTypeOf<ParParcelSharedBoundaryEnd>().toEqualTypeOf<HubParcelSharedBoundaryEnd>();
    expectTypeOf<HubParcelSharedBoundaryEnd>().toEqualTypeOf<ParParcelSharedBoundaryEnd>();
  });
  it('CadParcelSharedBoundary equality holds both directions', () => {
    expectTypeOf<ParParcelSharedBoundary>().toEqualTypeOf<HubParcelSharedBoundary>();
    expectTypeOf<HubParcelSharedBoundary>().toEqualTypeOf<ParParcelSharedBoundary>();
  });
  it('CadParcelEntity equality holds both directions', () => {
    expectTypeOf<ParParcelEntity>().toEqualTypeOf<HubParcelEntity>();
    expectTypeOf<HubParcelEntity>().toEqualTypeOf<ParParcelEntity>();
  });
});

// ---------------------------------------------------------------------------
// Unaffected hub unions: CadEntity order, CadBlockChild order, child type.
// ---------------------------------------------------------------------------

describe('STRUCT-241.6 unaffected hub unions', () => {
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

describe('STRUCT-241.6 type-only leaves and emit parity', () => {
  it('linear leaf has zero runtime imports, zero value declarations, allowlisted type edges', () => {
    expect(runtimeImportSpecifiers(LIN_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(LIN_LEAF)).toBe(true);
    expect(valueStatementKinds(LIN_LEAF)).toEqual([]);
    expect(allImportSpecifiers(LIN_LEAF)).toEqual([
      './cadEntityFoundationTypes',
      './cadDisplayTypes',
      './cadCorePrimitiveTypes',
    ]);
  });

  it('parcel leaf has zero runtime imports, zero value declarations, allowlisted type edges', () => {
    expect(runtimeImportSpecifiers(PAR_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(PAR_LEAF)).toBe(true);
    expect(valueStatementKinds(PAR_LEAF)).toEqual([]);
    expect(allImportSpecifiers(PAR_LEAF)).toEqual([
      './cadEntityFoundationTypes',
      './cadDisplayTypes',
    ]);
  });

  it('neither leaf imports cadTypes, a barrel, or an engine runtime module', () => {
    for (const file of [LIN_LEAF, PAR_LEAF]) {
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
    expect(strippedEmit(LIN_LEAF)).toBe('export {};');
    expect(strippedEmit(PAR_LEAF)).toBe('export {};');
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
// The 241.6 extraction is type-only, so both VALUE|mixed digests are
// unchanged; the explicit TYPE allowlist adds +2 nodes / +9 scoped edges
// (linear: 3 out + hub import + hub export; parcel: 2 out + hub import +
// hub export; no retired hub edge) and +2 nodes / +9 full edges (every
// 241.6 edge resolves inside `src`, so the full-scope delta matches the
// scoped delta here).
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

describe('STRUCT-241.6 CAD+F2F graph pins', () => {
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph(); // first/cold scoped build; 30 s tolerates full-suite CI load
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // 241.5 baseline 491 / 2424; the type-only 241.6 leaves add +2 nodes and
    // +9 type edges (linear: 3 out + hub import + hub export; parcel:
    // 2 out + hub import + hub export; no retired hub edge).
    expect(graph.nodes.length).toBe(493);
    expect(graph.edges.length).toBe(2433);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  }, 30_000);

  it('adds exactly the allow-listed TYPE edges incident to the linear leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(LIN_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts')), specifier: './cadCorePrimitiveTypes', kind: 'type' },
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadDisplayTypes.ts')), specifier: './cadDisplayTypes', kind: 'type' },
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadEntityFoundationTypes.ts')), specifier: './cadEntityFoundationTypes', kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: LIN_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('adds exactly the allow-listed TYPE edges incident to the parcel leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(PAR_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadDisplayTypes.ts')), specifier: './cadDisplayTypes', kind: 'type' },
      { from: leaf, to: path.resolve(path.join(CAD_DIR, 'cadEntityFoundationTypes.ts')), specifier: './cadEntityFoundationTypes', kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: PAR_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('has no leaf back-edge to the hub or to engine runtime modules', () => {
    const graph = cadF2fGraph();
    for (const leaf of [path.resolve(LIN_LEAF), path.resolve(PAR_LEAF)]) {
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

describe('STRUCT-241.6 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // 241.5 baseline 1663 / 7535; the 241.6 leaves add +2 nodes and +9 type
    // edges (same allowlist as the scoped pin; every 241.6 edge resolves
    // inside `src`).
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

describe('STRUCT-241.6 negative controls (in-memory mutations only)', () => {
  it('fails the alias pin when a CadAlignmentElement arc discriminant changes', () => {
    const mutated = linSource().replace("kind: 'arc';", "kind: 'curve';");
    expect(mutated).not.toBe(linSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadAlignmentElement'))
      .toBe(EXPECTED_ALIAS_TEXT['CadAlignmentElement'])).toThrow();
  });

  it('fails the shape pin when the station equation rawStation becomes required', () => {
    const mutated = linSource().replace('  rawStation?: number;', '  rawStation: number;');
    expect(mutated).not.toBe(linSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadStationEquation'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadStationEquation'])).toThrow();
  });

  it('fails the shape pin when the feature-line vertex Z goes missing', () => {
    const mutated = linSource().replace('  y: number;\n  z: number;', '  y: number;');
    expect(mutated).not.toBe(linSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadFeatureLineVertex'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadFeatureLineVertex'])).toThrow();
  });

  it('fails the shape pin when feature-line segmentGeometry becomes required', () => {
    const mutated = linSource().replace(
      '  segmentGeometry?: CadFeatureLineSegmentGeometry[];',
      '  segmentGeometry: CadFeatureLineSegmentGeometry[];',
    );
    expect(mutated).not.toBe(linSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadFeatureLineEntity'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadFeatureLineEntity'])).toThrow();
  });

  it('fails the alias pin when the feature-line arc bulge widens to string', () => {
    const mutated = linSource().replace(
      'export type CadFeatureLineSegmentGeometry = { kind: \'line\' } | { kind: \'arc\'; bulge: number };',
      'export type CadFeatureLineSegmentGeometry = { kind: \'line\' } | { kind: \'arc\'; bulge: string };',
    );
    expect(mutated).not.toBe(linSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadFeatureLineSegmentGeometry'))
      .toBe(EXPECTED_ALIAS_TEXT['CadFeatureLineSegmentGeometry'])).toThrow();
  });

  it('fails the alias pin when a CadParcelPlanRole literal changes', () => {
    const mutated = parSource().replace("'right-of-way'", "'right-of-way-extra'");
    expect(mutated).not.toBe(parSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadParcelPlanRole'))
      .toBe(EXPECTED_ALIAS_TEXT['CadParcelPlanRole'])).toThrow();
  });

  it('fails the shape pin when the shared-boundary courseId becomes optional', () => {
    const mutated = parSource().replace('  courseId: string;', '  courseId?: string;');
    expect(mutated).not.toBe(parSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadParcelSharedBoundaryEnd'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadParcelSharedBoundaryEnd'])).toThrow();
  });

  it('fails the alias pin when the parcel course arc discriminant changes', () => {
    const mutated = parSource().replace(
      'export type CadParcelCourseGeometry = { kind: \'line\' } | { kind: \'arc\'; bulge: number };',
      'export type CadParcelCourseGeometry = { kind: \'line\' } | { kind: \'curve\'; bulge: number };',
    );
    expect(mutated).not.toBe(parSource());
    expect(() => expect(aliasTextOf(parseText('m.ts', mutated), 'm', 'CadParcelCourseGeometry'))
      .toBe(EXPECTED_ALIAS_TEXT['CadParcelCourseGeometry'])).toThrow();
  });

  it('fails the shape pin when parcel courseIds becomes required', () => {
    const mutated = parSource().replace('  courseIds?: string[];', '  courseIds: string[];');
    expect(mutated).not.toBe(parSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadParcelEntity'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadParcelEntity'])).toThrow();
  });

  it('fails the shape pin when parcel planInfo becomes required', () => {
    const mutated = parSource().replace('  planInfo?: CadParcelPlanInfo;', '  planInfo: CadParcelPlanInfo;');
    expect(mutated).not.toBe(parSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadParcelEntity'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadParcelEntity'])).toThrow();
  });

  it('detects a removed public re-export from the hub facade', () => {
    const hub = hubSource();
    // Withdraw ONLY the export-type entry; the local `import type` stays, so
    // the hub still typechecks locally against the leaf while the public
    // re-export surface is the thing under test.
    const exportBlock = facadeBlockTextOf(hub, PAR_SPECIFIER, 'export');
    const mutatedExportBlock = exportBlock.replace('  CadParcelEntity,\n', '');
    expect(mutatedExportBlock).not.toBe(exportBlock);
    const mutated = hub.replace(exportBlock, mutatedExportBlock);
    expect(mutated).not.toBe(hub);
    // Import block retains the name (local resolution intact); export block
    // is where the absence must be observed, not the whole hub.
    expect(facadeBlockTextOf(mutated, PAR_SPECIFIER, 'import')).toContain('  CadParcelEntity,');
    const mutatedExport = facadeBlockTextOf(mutated, PAR_SPECIFIER, 'export');
    expect(mutatedExport).not.toContain('  CadParcelEntity,');
    for (const name of MOVED_PARCEL) {
      if (name === 'CadParcelEntity') continue;
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
    const mutatedLeaf = `${parSource()}\nimport type { CadProject } from './cadTypes';\nexport type CycleProbe = CadProject | null;\n`;
    const graph = buildGraphs([
      { path: path.resolve(PAR_LEAF), source: mutatedLeaf },
      { path: path.resolve(HUB), source: hubSource() },
    ]);
    const typeCycles = findCycles(graph.nodes, graph.type);
    const cyclic = new Set(typeCycles.cyclic.flat());
    expect(cyclic.has(path.resolve(PAR_LEAF))).toBe(true);
    expect(cyclic.has(path.resolve(HUB))).toBe(true);
  });

  it('detects a simulated value import on the linear leaf as a runtime edge', () => {
    const mutated = linSource().replace(
      "import type { CadBaseEntity } from './cadEntityFoundationTypes';",
      "import { CadBaseEntity } from './cadEntityFoundationTypes';",
    );
    expect(mutated).not.toBe(linSource());
    expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(false);
    expect(runtimeImportSpecifiersSource(parseText('m.ts', mutated))).toEqual(['./cadEntityFoundationTypes']);
    const graph = buildGraphs([
      { path: path.resolve(LIN_LEAF), source: mutated },
      { path: path.resolve(FOUNDATION_LEAF), source: fs.readFileSync(FOUNDATION_LEAF, 'utf8') },
    ]);
    expect(graph.edges.filter((edge) => edge.from === path.resolve(LIN_LEAF) && edge.kind === 'value')).toHaveLength(1);
  });

  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(LIN_LEAF, 'utf8')).toBe(linSource());
    expect(fs.readFileSync(PAR_LEAF, 'utf8')).toBe(parSource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
  });
});

describe('STRUCT-241.6 prior phase guards stay green by import existence', () => {
  it.each([
    'cad_survey_layer_command_type_leaves_2411',
    'cad_block_command_type_leaf_2412',
    'cad_entity_style_presentation_type_leaves_2413',
    'cad_primitive_geometry_entity_type_leaf_2414',
    'cad_annotation_survey_table_type_leaves_2415',
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
