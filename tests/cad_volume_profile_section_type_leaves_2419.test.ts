/**
 * STRUCT-241.9 — CAD volume, profile and section type leaves.
 *
 * Pins `src/engine/cad/cadVolumeSurfaceTypes.ts` (6 Phase 18I volume
 * contracts) and `src/engine/cad/cadProfileSectionTypes.ts` (4 Phase 18J
 * profile + 6 Phase 18K sample-line/section contracts), extracted verbatim
 * out of `src/engine/cad/cadTypes.ts` so the hub keeps every historic
 * `from './cadTypes'` consumer compiling via `export type` re-exports:
 *
 * Volume leaf (6, original order):
 * - `CadVolumeSurface` — Phase 18I TIN-to-TIN base/comparison refs + layer.
 * - `CadVolumeSurfaceStyle` — Phase 18I display styling (cut/fill/opacity).
 * - `VolumeSurfaceStatus` — 8-variant derived status (NEEDS_RECALC).
 * - `CadVolumeDisplayRegion` — cut|fill convex XY polygon (session-only).
 * - `CadVolumeStats` — optional counters + computeMs (session-only).
 * - `CadVolumeResult` — full result (fill-cut netVolume, vrev1, areas,
 *   depths, optional displayRegions, required stats).
 *
 * Profile/section leaf (10, original order):
 * - `CadSurfaceProfile` / `CadProfileStyle` / `CadProfileView` /
 *   `SurfaceProfileStatus` (8-variant, NEEDS_REBUILD) — Phase 18J.
 * - `CadSectionSurfaceSource` / `CadSampleLine` (RAW chainage identity,
 *   skewDeg) / `CadSampleLineGroup` (exactly one alignment, optional
 *   areaComparison) / `CadSectionStyle` / `CadSectionView` (explicit
 *   layerId, showCutFill) / `CadSectionStatus` (9-variant) — Phase 18K,
 *   including the original section separator comment.
 *
 * Covers: hand-transcribed pre-refactor interface shape pins (ordered
 * props, optionality, normalized type text) for all 13 interfaces; exact
 * union branch orders for all 3 status unions; JSDoc parity markers
 * (ref-only base/comparison, presentation-only style, derived
 * never-persisted status, RAW chainage identity, exactly-one-alignment,
 * OFF/FROZEN/LOCK travel with the declarations; hub keeps none);
 * both-direction facade-vs-leaf `expectTypeOf` equality for all 16; all 16
 * historic public re-exports with no leftover original declarations in the
 * hub; `CadProject` volume/profile/section tables, `CadDrawingDocument`,
 * survey persisted state, and all 5 runtime value exports stay in the hub;
 * the exact `CadEntity` 19-union and `CadBlockChild` 6-union orders;
 * type-only + emit pins (hub emit byte-identical 680 B / sha 37445357,
 * each leaf `export {};`); CAD+F2F and full-`src` graph pins rolled
 * forward by the measured type-only delta (+2 nodes / +6 scoped edges:
 * each leaf 1 out-edge to core primitives + hub import + hub export; no
 * retired hub edge) with both historical value/mixed digests unchanged;
 * and in-memory negative controls.
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
  CadProfileStyle as HubProfileStyle,
  CadProfileView as HubProfileView,
  CadSampleLine as HubSampleLine,
  CadSampleLineGroup as HubSampleLineGroup,
  CadSectionStatus as HubSectionStatus,
  CadSectionStyle as HubSectionStyle,
  CadSectionSurfaceSource as HubSectionSurfaceSource,
  CadSectionView as HubSectionView,
  CadSurfaceProfile as HubSurfaceProfile,
  CadVolumeDisplayRegion as HubVolumeDisplayRegion,
  CadVolumeResult as HubVolumeResult,
  CadVolumeStats as HubVolumeStats,
  CadVolumeSurface as HubVolumeSurface,
  CadVolumeSurfaceStyle as HubVolumeSurfaceStyle,
  SurfaceProfileStatus as HubSurfaceProfileStatus,
  VolumeSurfaceStatus as HubVolumeSurfaceStatus,
} from '../src/engine/cad/cadTypes';
import type {
  CadVolumeDisplayRegion as VolDisplayRegion,
  CadVolumeResult as VolResult,
  CadVolumeStats as VolStats,
  CadVolumeSurface as VolSurface,
  CadVolumeSurfaceStyle as VolSurfaceStyle,
  VolumeSurfaceStatus as VolStatus,
} from '../src/engine/cad/cadVolumeSurfaceTypes';
import type {
  CadProfileStyle as ProfStyle,
  CadProfileView as ProfView,
  CadSampleLine as ProfSampleLine,
  CadSampleLineGroup as ProfSampleLineGroup,
  CadSectionStatus as ProfSectionStatus,
  CadSectionStyle as ProfSectionStyle,
  CadSectionSurfaceSource as ProfSurfaceSource,
  CadSectionView as ProfSectionView,
  CadSurfaceProfile as ProfSurfaceProfile,
  SurfaceProfileStatus as ProfProfileStatus,
} from '../src/engine/cad/cadProfileSectionTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const HUB = path.join(CAD_DIR, 'cadTypes.ts');
const VOL_LEAF = path.join(CAD_DIR, 'cadVolumeSurfaceTypes.ts');
const PROF_LEAF = path.join(CAD_DIR, 'cadProfileSectionTypes.ts');

/** The six volume contracts, in original source order. */
const MOVED_VOLUME = [
  'CadVolumeSurface',
  'CadVolumeSurfaceStyle',
  'VolumeSurfaceStatus',
  'CadVolumeDisplayRegion',
  'CadVolumeStats',
  'CadVolumeResult',
];

/** The ten profile/section contracts, in original source order. */
const MOVED_PROFILE_SECTION = [
  'CadSurfaceProfile',
  'CadProfileStyle',
  'CadProfileView',
  'SurfaceProfileStatus',
  'CadSectionSurfaceSource',
  'CadSampleLine',
  'CadSampleLineGroup',
  'CadSectionStyle',
  'CadSectionView',
  'CadSectionStatus',
];

/** All sixteen moved contracts, family order preserved. */
const MOVED_16 = [...MOVED_VOLUME, ...MOVED_PROFILE_SECTION];

/** Volume interfaces pinned by ordered props (the status union separate). */
const VOLUME_INTERFACES = [
  'CadVolumeSurface',
  'CadVolumeSurfaceStyle',
  'CadVolumeDisplayRegion',
  'CadVolumeStats',
  'CadVolumeResult',
];

/** Profile/section interfaces pinned by ordered props (unions separate). */
const PROFILE_INTERFACES = [
  'CadSurfaceProfile',
  'CadProfileStyle',
  'CadProfileView',
  'CadSectionSurfaceSource',
  'CadSampleLine',
  'CadSampleLineGroup',
  'CadSectionStyle',
  'CadSectionView',
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
  CadVolumeSurface: [
    'id:string',
    'name:string',
    'baseSurfaceId:string',
    'comparisonSurfaceId:string',
    'layerId?:CadLayerId',
    'styleId?:string',
    'description?:string',
  ],
  CadVolumeSurfaceStyle: [
    'id:string',
    'name:string',
    'showCut:boolean',
    'showFill:boolean',
    'showZeroBoundary?:boolean',
    'cutColor:string',
    'fillColor:string',
    'opacity:number',
  ],
  CadVolumeDisplayRegion: [
    "kind:'cut'|'fill'",
    'vertices:Array<{x:number;y:number}>',
  ],
  CadVolumeStats: [
    'baseTriangleCount?:number',
    'comparisonTriangleCount?:number',
    'candidatePairCount?:number',
    'overlapPairCount?:number',
    'overlapPolygonCount?:number',
    'cutPolygonCount?:number',
    'fillPolygonCount?:number',
    'computeMs?:number',
  ],
  CadVolumeResult: [
    'baseSurfaceId:string',
    'comparisonSurfaceId:string',
    'revision:string',
    'overlapArea:number',
    'cutArea:number',
    'fillArea:number',
    'cutVolume:number',
    'fillVolume:number',
    'netVolume:number',
    'averageCutDepth:number',
    'averageFillDepth:number',
    'maxCutDepth:number',
    'maxFillDepth:number',
    'minDelta:number',
    'maxDelta:number',
    'baseArea:number',
    'comparisonArea:number',
    'displayRegions?:CadVolumeDisplayRegion[]',
    'stats:CadVolumeStats',
  ],
  CadSurfaceProfile: [
    'id:string',
    'name:string',
    'alignmentEntityId:CadEntityId',
    'surfaceId:string',
    'styleId?:string',
    'description?:string',
  ],
  CadProfileStyle: [
    'id:string',
    'name:string',
    'color:string',
    'lineweight:number',
    'opacity:number',
    'showVertices?:boolean',
  ],
  CadProfileView: [
    'id:string',
    'name:string',
    'alignmentEntityId:CadEntityId',
    'profileIds:string[]',
    'insertionX:number',
    'insertionY:number',
    'width?:number',
    'height?:number',
    'horizontalScale:number',
    'verticalExaggeration:number',
    'datumElevation?:number',
    "datumMode:'auto'|'explicit'",
    'datumStep?:number',
    'majorStationInterval?:number',
    'minorStationInterval?:number',
    'elevationGridInterval?:number',
    'styleId?:string',
  ],
  CadSectionSurfaceSource: [
    'surfaceId:string',
    'sectionStyleId?:string',
  ],
  CadSampleLine: [
    'id:string',
    'manualName?:string',
    'rawStation:number',
    'leftWidth:number',
    'rightWidth:number',
    'skewDeg:number',
  ],
  CadSampleLineGroup: [
    'id:string',
    'name:string',
    'alignmentEntityId:CadEntityId',
    'surfaceSources:CadSectionSurfaceSource[]',
    'sampleLines:CadSampleLine[]',
    'layerId?:CadLayerId',
    'areaComparison?:{baseSurfaceId:string;comparisonSurfaceId:string}',
  ],
  CadSectionStyle: [
    'id:string',
    'name:string',
    'color:string',
    'lineweight:number',
    'opacity:number',
    'showVertices?:boolean',
  ],
  CadSectionView: [
    'id:string',
    'name:string',
    'sampleLineGroupId:string',
    'sampleLineId:string',
    'sourceSurfaceIds:string[]',
    'insertionX:number',
    'insertionY:number',
    'horizontalScale:number',
    'verticalExaggeration:number',
    "datumMode:'auto'|'explicit'",
    'datumElevation?:number',
    'offsetGridInterval?:number',
    'elevationGridInterval?:number',
    'showCutFill?:boolean',
    'styleId?:string',
    'layerId?:CadLayerId',
  ],
};

/** Union literal branch order pins (whitespace collapsed). */
const EXPECTED_UNION_BRANCHES: Record<string, string[]> = {
  VolumeSurfaceStatus: [
    "'UNBUILT'",
    "'CURRENT'",
    "'NEEDS_RECALC'",
    "'BUILDING'",
    "'FAILED'",
    "'BROKEN_REFERENCE'",
    "'SOURCE_NOT_CURRENT'",
    "'NO_OVERLAP'",
  ],
  SurfaceProfileStatus: [
    "'UNBUILT'",
    "'CURRENT'",
    "'NEEDS_REBUILD'",
    "'BUILDING'",
    "'FAILED'",
    "'BROKEN_REFERENCE'",
    "'SOURCE_NOT_CURRENT'",
    "'NO_OVERLAP'",
  ],
  CadSectionStatus: [
    "'UNBUILT'",
    "'CURRENT'",
    "'NEEDS_REBUILD'",
    "'BUILDING'",
    "'FAILED'",
    "'BROKEN_REFERENCE'",
    "'SOURCE_NOT_CURRENT'",
    "'OUT_OF_RANGE'",
    "'NO_COVERAGE'",
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

/** `CadProject` volume/profile/section tables: name + required optionality. */
const EXPECTED_PROJECT_TABLES: Array<[string, string]> = [
  ['volumeSurfaces', 'volumeSurfaces?:CadVolumeSurface[]'],
  ['volumeSurfaceStyles', 'volumeSurfaceStyles?:CadVolumeSurfaceStyle[]'],
  ['surfaceProfiles', 'surfaceProfiles?:CadSurfaceProfile[]'],
  ['profileViews', 'profileViews?:CadProfileView[]'],
  ['profileStyles', 'profileStyles?:CadProfileStyle[]'],
  ['sampleLineGroups', 'sampleLineGroups?:CadSampleLineGroup[]'],
  ['sectionStyles', 'sectionStyles?:CadSectionStyle[]'],
  ['sectionViews', 'sectionViews?:CadSectionView[]'],
];

/** Distinctive moved volume JSDoc markers that must travel with the declarations. */
const VOLUME_JSDOC_MARKERS = [
  'overlap polygons, cut/fill',
  'worker status are always derived',
  'volume display styling ONLY',
  'derived volume status',
  'Convex polygon ring in world XY',
  'Positive magnitudes',
  'signed earthwork',
  'Display opacity factor',
  'Optional display-only zero-boundary',
  'ByLayer-default',
];

/** Distinctive moved profile/section JSDoc markers that must travel. */
const PROFILE_JSDOC_MARKERS = [
  'Holds ONLY the alignment + surface',
  'profile display styling ONLY',
  'Derived display',
  'derived profile status',
  'Phase 18K sample lines / cross sections',
  'Stored by RAW',
  'Skew is degrees clockwise',
  'bound to exactly ONE',
  'OFF/FROZEN/LOCK',
  'derived section status per sample-line',
  'Operator override; absent',
  'Optional pairwise cut/fill area comparison',
];

/** Moved JSDoc bodies the hub must no longer contain. */
const MOVED_JSDOC_ABSENT_FROM_HUB = [
  'overlap polygons, cut/fill',
  'worker status are always derived',
  'volume display styling ONLY',
  'derived volume status',
  'Convex polygon ring in world XY',
  'Positive magnitudes',
  'signed earthwork',
  'Stored by RAW',
  'Skew is degrees clockwise',
  'Phase 18K sample lines / cross sections',
  'Operator override; absent',
  'Optional pairwise cut/fill area comparison',
  'OFF/FROZEN/LOCK',
  'derived section status per sample-line',
];

const VOL_SPECIFIER = './cadVolumeSurfaceTypes';
const PROF_SPECIFIER = './cadProfileSectionTypes';
const CORE_SPECIFIER = './cadCorePrimitiveTypes';

const hubSource = (): string => fs.readFileSync(HUB, 'utf8');
const volSource = (): string => fs.readFileSync(VOL_LEAF, 'utf8');
const profSource = (): string => fs.readFileSync(PROF_LEAF, 'utf8');

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

// ---------------------------------------------------------------------------
// Leaf presence, order, and verbatim shapes.
// ---------------------------------------------------------------------------

describe('STRUCT-241.9 leaf presence and declaration order', () => {
  it('both leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(VOL_LEAF)).toBe(true);
    expect(fs.existsSync(PROF_LEAF)).toBe(true);
  });

  it('volume leaf declares exactly the 6 contracts in original order', () => {
    expect(exportedDeclNames(parse(VOL_LEAF))).toEqual(MOVED_VOLUME);
  });

  it('profile/section leaf declares exactly the 10 contracts in original order', () => {
    expect(exportedDeclNames(parse(PROF_LEAF))).toEqual(MOVED_PROFILE_SECTION);
  });

  it('the two leaves own disjoint name sets with no cross-import', () => {
    expect(new Set(MOVED_16).size).toBe(16);
    expect(allImportSpecifiers(VOL_LEAF)).not.toContain(PROF_SPECIFIER);
    expect(allImportSpecifiers(PROF_LEAF)).not.toContain(VOL_SPECIFIER);
  });
});

describe('STRUCT-241.9 baseline volume interface shapes pinned verbatim', () => {
  it.each(VOLUME_INTERFACES)('volume leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(VOL_LEAF), 'volume leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.9 baseline profile/section interface shapes pinned verbatim', () => {
  it.each(PROFILE_INTERFACES)('profile leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(PROF_LEAF), 'profile leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.9 baseline status union shapes pinned verbatim', () => {
  it.each(Object.keys(EXPECTED_UNION_BRANCHES))('leaf union %s keeps its branch order', (name) => {
    const file = name === 'VolumeSurfaceStatus' ? parse(VOL_LEAF) : parse(PROF_LEAF);
    const label = name === 'VolumeSurfaceStatus' ? 'volume leaf' : 'profile leaf';
    expect(unionMembers(file, label, name)).toEqual(EXPECTED_UNION_BRANCHES[name]);
  });
});

describe('STRUCT-241.9 JSDoc parity (comments travel with the declarations)', () => {
  it.each(VOLUME_JSDOC_MARKERS)('volume leaf keeps marker %s', (marker) => {
    expect(volSource()).toContain(marker);
  });

  it.each(PROFILE_JSDOC_MARKERS)('profile leaf keeps marker %s', (marker) => {
    expect(profSource()).toContain(marker);
  });

  it('keeps the original Phase 18K separator adjacent to the section sources', () => {
    const source = profSource();
    const separator = source.indexOf('Phase 18K sample lines / cross sections');
    const decl = source.indexOf('export interface CadSectionSurfaceSource');
    expect(separator).toBeGreaterThan(-1);
    expect(decl).toBeGreaterThan(-1);
    expect(separator).toBeLessThan(decl);
  });

  it('keeps the vrev1 revision note inside the volume result', () => {
    expect(volSource()).toContain('`vrev1:` revision the result was computed for.');
  });

  it('hub keeps none of the moved volume or profile/section JSDoc bodies', () => {
    const hub = hubSource();
    for (const marker of MOVED_JSDOC_ABSENT_FROM_HUB) {
      expect(hub).not.toContain(marker);
    }
  });
});

// ---------------------------------------------------------------------------
// Facade contract: hub re-exports all 16, keeps no originals.
// ---------------------------------------------------------------------------

describe('STRUCT-241.9 hub facade re-exports', () => {
  it('re-exports all 6 volume names from the new volume leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${VOL_SPECIFIER}';`);
    assertFacadeExhaustive(facadeBlockTextOf(source, VOL_SPECIFIER, 'export'), MOVED_VOLUME);
  });

  it('re-exports all 10 profile/section names from the new profile leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${PROF_SPECIFIER}';`);
    assertFacadeExhaustive(facadeBlockTextOf(source, PROF_SPECIFIER, 'export'), MOVED_PROFILE_SECTION);
  });

  it('keeps no original interface/alias declaration for any moved name', () => {
    const source = hubSource();
    for (const name of MOVED_16) {
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
    expect(typeImports).toContain(VOL_SPECIFIER);
    expect(typeImports).toContain(PROF_SPECIFIER);
  });

  it('keeps CadProject volume/profile/section tables with names and optionality', () => {
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

  it('keeps no original surface source/definition or model/style declarations in the hub (moved by STRUCT-241.10)', () => {
    // STRUCT-241.10 roll-forward: the 6 surface-definition + 5
    // surface-model/style contracts now live in cadSurfaceDefinitionTypes
    // and cadSurfaceModelStyleTypes; the hub keeps only the grouped
    // `import type` + `export type` facade so legacy paths compile.
    const hub = hubSource();
    for (const decl of [
      'export type CadSurfacePointSource',
      'export interface CadSurfaceStyle',
      'export type CadSurfaceStatus',
      'export interface CadSurfaceDefinition {',
    ]) {
      expect(hub).not.toContain(decl);
    }
    for (const specifier of ['./cadSurfaceDefinitionTypes', './cadSurfaceModelStyleTypes']) {
      expect(hub).toContain(`} from '${specifier}';`);
    }
  });
});

// ---------------------------------------------------------------------------
// Facade-vs-leaf type equality, bidirectional (all 16).
// ---------------------------------------------------------------------------

describe('STRUCT-241.9 volume facade vs leaf type equality', () => {
  it('CadVolumeSurface equality holds both directions', () => {
    expectTypeOf<VolSurface>().toEqualTypeOf<HubVolumeSurface>();
    expectTypeOf<HubVolumeSurface>().toEqualTypeOf<VolSurface>();
  });
  it('CadVolumeSurfaceStyle equality holds both directions', () => {
    expectTypeOf<VolSurfaceStyle>().toEqualTypeOf<HubVolumeSurfaceStyle>();
    expectTypeOf<HubVolumeSurfaceStyle>().toEqualTypeOf<VolSurfaceStyle>();
  });
  it('VolumeSurfaceStatus equality holds both directions', () => {
    expectTypeOf<VolStatus>().toEqualTypeOf<HubVolumeSurfaceStatus>();
    expectTypeOf<HubVolumeSurfaceStatus>().toEqualTypeOf<VolStatus>();
  });
  it('CadVolumeDisplayRegion equality holds both directions', () => {
    expectTypeOf<VolDisplayRegion>().toEqualTypeOf<HubVolumeDisplayRegion>();
    expectTypeOf<HubVolumeDisplayRegion>().toEqualTypeOf<VolDisplayRegion>();
  });
  it('CadVolumeStats equality holds both directions', () => {
    expectTypeOf<VolStats>().toEqualTypeOf<HubVolumeStats>();
    expectTypeOf<HubVolumeStats>().toEqualTypeOf<VolStats>();
  });
  it('CadVolumeResult equality holds both directions', () => {
    expectTypeOf<VolResult>().toEqualTypeOf<HubVolumeResult>();
    expectTypeOf<HubVolumeResult>().toEqualTypeOf<VolResult>();
  });
});

describe('STRUCT-241.9 profile/section facade vs leaf type equality', () => {
  it('CadSurfaceProfile equality holds both directions', () => {
    expectTypeOf<ProfSurfaceProfile>().toEqualTypeOf<HubSurfaceProfile>();
    expectTypeOf<HubSurfaceProfile>().toEqualTypeOf<ProfSurfaceProfile>();
  });
  it('CadProfileStyle equality holds both directions', () => {
    expectTypeOf<ProfStyle>().toEqualTypeOf<HubProfileStyle>();
    expectTypeOf<HubProfileStyle>().toEqualTypeOf<ProfStyle>();
  });
  it('CadProfileView equality holds both directions', () => {
    expectTypeOf<ProfView>().toEqualTypeOf<HubProfileView>();
    expectTypeOf<HubProfileView>().toEqualTypeOf<ProfView>();
  });
  it('SurfaceProfileStatus equality holds both directions', () => {
    expectTypeOf<ProfProfileStatus>().toEqualTypeOf<HubSurfaceProfileStatus>();
    expectTypeOf<HubSurfaceProfileStatus>().toEqualTypeOf<ProfProfileStatus>();
  });
  it('CadSectionSurfaceSource equality holds both directions', () => {
    expectTypeOf<ProfSurfaceSource>().toEqualTypeOf<HubSectionSurfaceSource>();
    expectTypeOf<HubSectionSurfaceSource>().toEqualTypeOf<ProfSurfaceSource>();
  });
  it('CadSampleLine equality holds both directions', () => {
    expectTypeOf<ProfSampleLine>().toEqualTypeOf<HubSampleLine>();
    expectTypeOf<HubSampleLine>().toEqualTypeOf<ProfSampleLine>();
  });
  it('CadSampleLineGroup equality holds both directions', () => {
    expectTypeOf<ProfSampleLineGroup>().toEqualTypeOf<HubSampleLineGroup>();
    expectTypeOf<HubSampleLineGroup>().toEqualTypeOf<ProfSampleLineGroup>();
  });
  it('CadSectionStyle equality holds both directions', () => {
    expectTypeOf<ProfSectionStyle>().toEqualTypeOf<HubSectionStyle>();
    expectTypeOf<HubSectionStyle>().toEqualTypeOf<ProfSectionStyle>();
  });
  it('CadSectionView equality holds both directions', () => {
    expectTypeOf<ProfSectionView>().toEqualTypeOf<HubSectionView>();
    expectTypeOf<HubSectionView>().toEqualTypeOf<ProfSectionView>();
  });
  it('CadSectionStatus equality holds both directions', () => {
    expectTypeOf<ProfSectionStatus>().toEqualTypeOf<HubSectionStatus>();
    expectTypeOf<HubSectionStatus>().toEqualTypeOf<ProfSectionStatus>();
  });
});

// ---------------------------------------------------------------------------
// Unaffected hub unions: CadEntity order, CadBlockChild order, child type.
// ---------------------------------------------------------------------------

describe('STRUCT-241.9 unaffected hub unions', () => {
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

describe('STRUCT-241.9 type-only leaves and emit parity', () => {
  it('volume leaf imports only the low-level core primitive leaf', () => {
    expect(allImportSpecifiers(VOL_LEAF)).toEqual([CORE_SPECIFIER]);
    expect(hasOnlyTypeImports(VOL_LEAF)).toBe(true);
    expect(valueStatementKinds(VOL_LEAF)).toEqual([]);
  });

  it('profile leaf imports only the low-level core primitive leaf', () => {
    expect(allImportSpecifiers(PROF_LEAF)).toEqual([CORE_SPECIFIER]);
    expect(hasOnlyTypeImports(PROF_LEAF)).toBe(true);
    expect(valueStatementKinds(PROF_LEAF)).toEqual([]);
  });

  it('neither leaf imports cadTypes, the sibling leaf, a barrel, or a runtime module', () => {
    for (const file of [VOL_LEAF, PROF_LEAF]) {
      assertNoHubBackEdge(allImportSpecifiers(file));
      const specifiers = allImportSpecifiers(file);
      expect(specifiers).not.toContain(VOL_SPECIFIER);
      expect(specifiers).not.toContain(PROF_SPECIFIER);
      expect(specifiers).not.toContain('./cadTransactions.types');
      for (const specifier of specifiers) {
        expect(specifier.endsWith('cadTransactions.types')).toBe(false);
      }
    }
    expect(runtimeImportSpecifiers(VOL_LEAF)).toEqual([]);
    expect(runtimeImportSpecifiers(PROF_LEAF)).toEqual([]);
  });

  it('both transpiled leaf emits are marker-only', () => {
    expect(strippedEmit(VOL_LEAF)).toBe('export {};');
    expect(strippedEmit(PROF_LEAF)).toBe('export {};');
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
// The 241.9 extraction is type-only; both leaves import exactly one
// low-level type edge (to cadCorePrimitiveTypes), so the scoped delta is
// +2 nodes / +6 type edges (per leaf: 1 out + hub import + hub export; no
// retired hub edge) and the full-scope delta matches (+2 / +6: every 241.9
// edge resolves inside `src`). Both historical value/mixed digests stay
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

describe('STRUCT-241.9 CAD+F2F graph pins', () => {
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph(); // first/cold scoped build; 30 s tolerates full-suite CI load
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // 241.8 baseline 497 / 2444; the type-only 241.9 leaves add +2 nodes
    // and +6 type edges (per leaf: 1 out-edge to core primitives + hub
    // import + hub export; no retired hub edge). STRUCT-241.10 adds +2
    // nodes and +9 type edges (definition leaf: 3 out-edges + hub import +
    // hub export; model leaf: one-way B->A + core out-edge + hub import +
    // hub export; no retired hub edge).
    // STRUCT-241.11 roll-forward: +2 nodes / +6 type edges (annotation leaf
    // 4 out-edges + hub import; analysis leaf 4 out-edges + hub import;
    // 4 retired hub edges to the anchor barrel + analysis modules).
    expect(graph.nodes.length).toBe(505);
    expect(graph.edges.length).toBe(2470);
    expect(pairDigest(graph)).toEqual({
      valueEdges: 1585,
      uniqPairs: 1567,
      sha: '0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7',
    });
  }, 30_000);

  it('adds exactly the allow-listed TYPE edges incident to the volume leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(VOL_LEAF);
    const core = path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts'));
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: core, specifier: CORE_SPECIFIER, kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: VOL_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('adds exactly the allow-listed TYPE edges incident to the profile leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(PROF_LEAF);
    const core = path.resolve(path.join(CAD_DIR, 'cadCorePrimitiveTypes.ts'));
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([
      { from: leaf, to: core, specifier: CORE_SPECIFIER, kind: 'type' },
    ]);
    // One `import type` edge plus one `export type ... from` edge.
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: PROF_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([hubToLeaf, hubToLeaf]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('has no leaf back-edge to the hub, the sibling leaf, or engine runtime modules', () => {
    const graph = cadF2fGraph();
    const vol = path.resolve(VOL_LEAF);
    const prof = path.resolve(PROF_LEAF);
    for (const [leaf, sibling] of [[vol, prof], [prof, vol]] as const) {
      for (const target of [
        path.resolve(HUB),
        sibling,
        path.resolve(path.join(CAD_DIR, 'cadTransactions.types.ts')),
      ]) {
        expect(graph.edges.filter((edge) => edge.from === leaf && edge.to === target)).toEqual([]);
      }
    }
  });
});

describe('STRUCT-241.9 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // 241.8 baseline 1669 / 7555; the 241.9 leaves add +2 nodes and +6
    // type edges (same allowlist as the scoped pin; every 241.9 edge
    // resolves inside `src`). STRUCT-241.10 adds +2 nodes and +9 type
    // edges (same allowlist as the scoped pin; every 241.10 edge resolves
    // inside `src`).
    // STRUCT-241.11 roll-forward: +2 nodes / +6 type edges (same
    // allowlist as the scoped pin; every 241.11 edge resolves inside `src`).
    expect(graph.nodes.length).toBe(1677);
    expect(graph.edges.length).toBe(7581);
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

describe('STRUCT-241.9 negative controls (in-memory mutations only)', () => {
  it('fails the shape pin when the volume comparison ref changes', () => {
    const mutated = volSource().replace('  comparisonSurfaceId: string;', '  comparisonSurfaceRef: string;');
    expect(mutated).not.toBe(volSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadVolumeSurface'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadVolumeSurface'])).toThrow();
  });

  it('fails the shape pin when the volume layerId becomes required', () => {
    const mutated = volSource().replace('  layerId?: CadLayerId;', '  layerId: CadLayerId;');
    expect(mutated).not.toBe(volSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadVolumeSurface'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadVolumeSurface'])).toThrow();
  });

  it('fails the shape pin when the volume showFill flag goes missing', () => {
    const mutated = volSource().replace('  showFill: boolean;\n', '');
    expect(mutated).not.toBe(volSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadVolumeSurfaceStyle'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadVolumeSurfaceStyle'])).toThrow();
  });

  it('fails the shape pin when the volume opacity becomes optional', () => {
    const mutated = volSource().replace('  opacity: number;', '  opacity?: number;');
    expect(mutated).not.toBe(volSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadVolumeSurfaceStyle'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadVolumeSurfaceStyle'])).toThrow();
  });

  it('fails the union pin when VolumeSurfaceStatus gains a branch', () => {
    const mutated = volSource().replace("  | 'NO_OVERLAP';", "  | 'NO_OVERLAP'\n  | 'STALE';");
    expect(mutated).not.toBe(volSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'VolumeSurfaceStatus'))
      .toEqual(EXPECTED_UNION_BRANCHES['VolumeSurfaceStatus'])).toThrow();
  });

  it('fails the shape pin when CadVolumeResult netVolume becomes optional', () => {
    const mutated = volSource().replace('  netVolume: number;', '  netVolume?: number;');
    expect(mutated).not.toBe(volSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadVolumeResult'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadVolumeResult'])).toThrow();
  });

  it('fails the shape pin when displayRegions stops being an array', () => {
    const mutated = volSource().replace(
      '  displayRegions?: CadVolumeDisplayRegion[];',
      '  displayRegions?: CadVolumeDisplayRegion;',
    );
    expect(mutated).not.toBe(volSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadVolumeResult'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadVolumeResult'])).toThrow();
  });

  it('fails the shape pin when the profile alignment id loses its branded type', () => {
    const mutated = profSource().replace(
      '  alignmentEntityId: CadEntityId;\n  surfaceId: string;',
      '  alignmentEntityId: string;\n  surfaceId: string;',
    );
    expect(mutated).not.toBe(profSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceProfile'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceProfile'])).toThrow();
  });

  it('fails the shape pin when the profile view datum mode gains a branch', () => {
    const mutated = profSource().replace(
      "  datumMode: 'auto' | 'explicit';\n  datumStep?: number;",
      "  datumMode: 'auto' | 'explicit' | 'manual';\n  datumStep?: number;",
    );
    expect(mutated).not.toBe(profSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadProfileView'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadProfileView'])).toThrow();
  });

  it('fails the shape pin when the sample line RAW station becomes optional', () => {
    const mutated = profSource().replace('  rawStation: number;', '  rawStation?: number;');
    expect(mutated).not.toBe(profSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSampleLine'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSampleLine'])).toThrow();
  });

  it('fails the shape pin when the sample line skewDeg goes missing', () => {
    const mutated = profSource().replace('  skewDeg: number;\n', '');
    expect(mutated).not.toBe(profSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSampleLine'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSampleLine'])).toThrow();
  });

  it('fails the shape pin when the group areaComparison becomes required', () => {
    const mutated = profSource().replace(
      '  areaComparison?: { baseSurfaceId: string; comparisonSurfaceId: string };',
      '  areaComparison: { baseSurfaceId: string; comparisonSurfaceId: string };',
    );
    expect(mutated).not.toBe(profSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSampleLineGroup'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSampleLineGroup'])).toThrow();
  });

  it('fails the shape pin when the section view layerId becomes required', () => {
    const mutated = profSource().replace('  styleId?: string;\n  layerId?: CadLayerId;', '  styleId?: string;\n  layerId: CadLayerId;');
    expect(mutated).not.toBe(profSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSectionView'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSectionView'])).toThrow();
  });

  it('fails the shape pin when the section view showCutFill becomes required', () => {
    const mutated = profSource().replace('  showCutFill?: boolean;', '  showCutFill: boolean;');
    expect(mutated).not.toBe(profSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSectionView'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSectionView'])).toThrow();
  });

  it('fails the shape pin when the section view datum mode changes', () => {
    const mutated = profSource().replace(
      "  datumMode: 'auto' | 'explicit';\n  datumElevation?: number;",
      "  datumMode: 'explicit' | 'auto';\n  datumElevation?: number;",
    );
    expect(mutated).not.toBe(profSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSectionView'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSectionView'])).toThrow();
  });

  it('fails the union pin when CadSectionStatus loses its coverage branch', () => {
    const mutated = profSource().replace("  | 'NO_COVERAGE';", ';');
    expect(mutated).not.toBe(profSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadSectionStatus'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadSectionStatus'])).toThrow();
  });

  it('fails facade exhaustiveness when a legacy export goes missing but the import stays', () => {
    const exportBlock = facadeBlockTextOf(hubSource(), VOL_SPECIFIER, 'export');
    const mutated = exportBlock.replace('  CadVolumeResult,\n', '');
    expect(mutated).not.toBe(exportBlock);
    expect(() => assertFacadeExhaustive(mutated, MOVED_VOLUME)).toThrow();
  });

  it('fails the back-edge pin when a leaf gains a TYPE import of the hub', () => {
    const mutated = volSource().replace(
      "import type { CadLayerId } from './cadCorePrimitiveTypes';",
      "import type { CadLayerId } from './cadCorePrimitiveTypes';\nimport type { CadVolumeSurface } from './cadTypes';",
    );
    expect(mutated).not.toBe(volSource());
    const specifiers = parseText('m.ts', mutated).statements
      .filter((stmt): stmt is ts.ImportDeclaration =>
        ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);
    expect(() => assertNoHubBackEdge(specifiers)).toThrow();
  });

  it('fails the type-only pin on an accidental VALUE import of the primitive leaf', () => {
    const mutated = profSource().replace(
      'import type { CadEntityId, CadLayerId }',
      'import { CadEntityId, CadLayerId }',
    );
    expect(mutated).not.toBe(profSource());
    expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(false);
    expect(() => expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(true)).toThrow();
  });
});
