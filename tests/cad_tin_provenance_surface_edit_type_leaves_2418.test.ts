/**
 * STRUCT-241.8 — CAD TIN provenance and surface-edit type leaves.
 *
 * Pins `src/engine/cad/cadTinProvenanceTypes.ts` (11 TIN provenance /
 * explicit-payload contracts) and `src/engine/cad/cadSurfaceEditTypes.ts`
 * (14 surface-edit contracts), extracted verbatim out of
 * `src/engine/cad/cadTypes.ts` so the hub keeps every historic
 * `from './cadTypes'` consumer compiling via `export type` re-exports:
 *
 * Provenance leaf (11, original order):
 * - `LandxmlTinProvenance` — Phase 18L read-tolerant (`kind` optional).
 * - `WebnetBakeTinProvenance` — Phase 18X strict bake writers.
 * - `ExplicitFormatTinProvenance` — read-only `format:'explicit'` alias.
 * - `WebnetComposeTinProvenance` — Phase 18Y compose (`overlay-coverage-wins`).
 * - `WebnetGradingBakeTinProvenance` — Phase 20B grading bake.
 * - `WebnetGradingDesignPatchTinProvenance` — design patch (incl. hybrid).
 * - `WebnetGradingGroupBakeTinProvenance` — Phase 20C group bake.
 * - `CadExplicitTinProvenance` — 7-variant discriminated union (exact order).
 * - `ImportedTinProvenance` — legacy alias of the union.
 * - `ImportedTinPayload` — compact vertex/face arrays + provenance.
 * - `ExplicitTinPayload` — alias of the payload.
 *
 * Surface-edit leaf (14, original order):
 * - `CadSurfaceVertexRef` / `CadSurfaceEdgeRef` — stable ref identity.
 * - `CadSurfaceSwapEdgeEdit` / `CadSurfaceAddLineEdit` /
 *   `CadSurfaceDeleteLineEdit` — topology edits (`enabled?` absent = true).
 * - `CadSurfaceAddPointEdit` / `CadSurfaceDeletePointEdit` /
 *   `CadSurfaceMovePointEdit` / `CadSurfaceSetElevationEdit` /
 *   `CadSurfaceRaiseLowerEdit` — Phase 18T point/elevation edits.
 * - `CadSurfaceSetElevationsEdit` / `CadSurfaceRaiseLowerVerticesEdit` /
 *   `CadSurfaceMoveVerticesEdit` — Phase 18V bulk canonical-array edits.
 * - `CadSurfaceEdit` — 11-variant union (exact order).
 *
 * Covers: hand-transcribed pre-refactor interface/alias shape pins (ordered
 * props, optionality, normalized type text) for all 25 declarations;
 * declaration order in each leaf; exact 7-variant provenance and 11-variant
 * edit union branch orders; JSDoc parity markers (read-tolerant/write-strict
 * bodies, stable-ref `source:`/`imported:`/`edit:` markers, `Absent = TRUE.`,
 * canonical-array wording travel with the declarations; hub keeps none);
 * both-direction facade-vs-leaf `expectTypeOf` equality for all 25; all 25
 * historic public re-exports with no leftover original declarations in the
 * hub; `CadSurfaceDefinition` (`edits?` / `importedTin?` / `sourceKind?`)
 * and all 5 runtime value exports stay in the hub; the exact `CadEntity`
 * 19-union order; the exact `CadBlockChild` 6-union order; type-only + emit
 * pins (hub emit byte-identical 680 B / sha 37445357, each leaf
 * `export {};`); CAD+F2F and full-`src` graph pins rolled forward by the
 * measured type-only delta (+2 nodes / +4 scoped edges, +2 nodes / +4 full
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
  CadSurfaceAddLineEdit as HubAddLineEdit,
  CadSurfaceAddPointEdit as HubAddPointEdit,
  CadSurfaceDeleteLineEdit as HubDeleteLineEdit,
  CadSurfaceDeletePointEdit as HubDeletePointEdit,
  CadSurfaceEdgeRef as HubEdgeRef,
  CadSurfaceEdit as HubSurfaceEdit,
  CadSurfaceMovePointEdit as HubMovePointEdit,
  CadSurfaceMoveVerticesEdit as HubMoveVerticesEdit,
  CadSurfaceRaiseLowerEdit as HubRaiseLowerEdit,
  CadSurfaceRaiseLowerVerticesEdit as HubRaiseLowerVerticesEdit,
  CadSurfaceSetElevationEdit as HubSetElevationEdit,
  CadSurfaceSetElevationsEdit as HubSetElevationsEdit,
  CadSurfaceSwapEdgeEdit as HubSwapEdgeEdit,
  CadSurfaceVertexRef as HubVertexRef,
  CadExplicitTinProvenance as HubExplicitTinProvenance,
  ExplicitFormatTinProvenance as HubExplicitFormatTinProvenance,
  ExplicitTinPayload as HubExplicitTinPayload,
  ImportedTinPayload as HubImportedTinPayload,
  ImportedTinProvenance as HubImportedTinProvenance,
  LandxmlTinProvenance as HubLandxmlTinProvenance,
  WebnetBakeTinProvenance as HubWebnetBakeTinProvenance,
  WebnetComposeTinProvenance as HubWebnetComposeTinProvenance,
  WebnetGradingBakeTinProvenance as HubWebnetGradingBakeTinProvenance,
  WebnetGradingDesignPatchTinProvenance as HubWebnetGradingDesignPatchTinProvenance,
  WebnetGradingGroupBakeTinProvenance as HubWebnetGradingGroupBakeTinProvenance,
} from '../src/engine/cad/cadTypes';
import type {
  CadExplicitTinProvenance as ProvExplicitTinProvenance,
  ExplicitFormatTinProvenance as ProvExplicitFormatTinProvenance,
  ExplicitTinPayload as ProvExplicitTinPayload,
  ImportedTinPayload as ProvImportedTinPayload,
  ImportedTinProvenance as ProvImportedTinProvenance,
  LandxmlTinProvenance as ProvLandxmlTinProvenance,
  WebnetBakeTinProvenance as ProvWebnetBakeTinProvenance,
  WebnetComposeTinProvenance as ProvWebnetComposeTinProvenance,
  WebnetGradingBakeTinProvenance as ProvWebnetGradingBakeTinProvenance,
  WebnetGradingDesignPatchTinProvenance as ProvWebnetGradingDesignPatchTinProvenance,
  WebnetGradingGroupBakeTinProvenance as ProvWebnetGradingGroupBakeTinProvenance,
} from '../src/engine/cad/cadTinProvenanceTypes';
import type {
  CadSurfaceAddLineEdit as EditAddLineEdit,
  CadSurfaceAddPointEdit as EditAddPointEdit,
  CadSurfaceDeleteLineEdit as EditDeleteLineEdit,
  CadSurfaceDeletePointEdit as EditDeletePointEdit,
  CadSurfaceEdgeRef as EditEdgeRef,
  CadSurfaceEdit as EditSurfaceEdit,
  CadSurfaceMovePointEdit as EditMovePointEdit,
  CadSurfaceMoveVerticesEdit as EditMoveVerticesEdit,
  CadSurfaceRaiseLowerEdit as EditRaiseLowerEdit,
  CadSurfaceRaiseLowerVerticesEdit as EditRaiseLowerVerticesEdit,
  CadSurfaceSetElevationEdit as EditSetElevationEdit,
  CadSurfaceSetElevationsEdit as EditSetElevationsEdit,
  CadSurfaceSwapEdgeEdit as EditSwapEdgeEdit,
  CadSurfaceVertexRef as EditVertexRef,
} from '../src/engine/cad/cadSurfaceEditTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const HUB = path.join(CAD_DIR, 'cadTypes.ts');
const PROV_LEAF = path.join(CAD_DIR, 'cadTinProvenanceTypes.ts');
const EDIT_LEAF = path.join(CAD_DIR, 'cadSurfaceEditTypes.ts');
// STRUCT-241.10 roll-forward: the surface-definition leaf imports both
// low-level leaves above (no hub back-edge, no cycle).
const DEF_LEAF_24110 = path.join(CAD_DIR, 'cadSurfaceDefinitionTypes.ts');

/** The eleven provenance contracts, in original source order. */
const MOVED_PROVENANCE = [
  'LandxmlTinProvenance',
  'WebnetBakeTinProvenance',
  'ExplicitFormatTinProvenance',
  'WebnetComposeTinProvenance',
  'WebnetGradingBakeTinProvenance',
  'WebnetGradingDesignPatchTinProvenance',
  'WebnetGradingGroupBakeTinProvenance',
  'CadExplicitTinProvenance',
  'ImportedTinProvenance',
  'ImportedTinPayload',
  'ExplicitTinPayload',
];

/** The fourteen surface-edit contracts, in original source order. */
const MOVED_EDITS = [
  'CadSurfaceVertexRef',
  'CadSurfaceEdgeRef',
  'CadSurfaceSwapEdgeEdit',
  'CadSurfaceAddLineEdit',
  'CadSurfaceDeleteLineEdit',
  'CadSurfaceAddPointEdit',
  'CadSurfaceDeletePointEdit',
  'CadSurfaceMovePointEdit',
  'CadSurfaceSetElevationEdit',
  'CadSurfaceRaiseLowerEdit',
  'CadSurfaceSetElevationsEdit',
  'CadSurfaceRaiseLowerVerticesEdit',
  'CadSurfaceMoveVerticesEdit',
  'CadSurfaceEdit',
];

/** All twenty-five moved contracts, family order preserved. */
const MOVED_25 = [...MOVED_PROVENANCE, ...MOVED_EDITS];

/** Provenance interfaces pinned by ordered props (unions/aliases separate). */
const PROV_INTERFACES = [
  'LandxmlTinProvenance',
  'WebnetBakeTinProvenance',
  'ExplicitFormatTinProvenance',
  'WebnetComposeTinProvenance',
  'WebnetGradingBakeTinProvenance',
  'WebnetGradingDesignPatchTinProvenance',
  'WebnetGradingGroupBakeTinProvenance',
  'ImportedTinPayload',
];

/** Surface-edit interfaces pinned by ordered props (the union separate). */
const EDIT_INTERFACES = [
  'CadSurfaceVertexRef',
  'CadSurfaceEdgeRef',
  'CadSurfaceSwapEdgeEdit',
  'CadSurfaceAddLineEdit',
  'CadSurfaceDeleteLineEdit',
  'CadSurfaceAddPointEdit',
  'CadSurfaceDeletePointEdit',
  'CadSurfaceMovePointEdit',
  'CadSurfaceSetElevationEdit',
  'CadSurfaceRaiseLowerEdit',
  'CadSurfaceSetElevationsEdit',
  'CadSurfaceRaiseLowerVerticesEdit',
  'CadSurfaceMoveVerticesEdit',
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
// parent-verified against cadTypes.ts before extraction).
// ---------------------------------------------------------------------------

/** Interface pins: ordered `name[?]:type` with whitespace collapsed. */
const EXPECTED_INTERFACE_PROPS: Record<string, string[]> = {
  LandxmlTinProvenance: [
    "kind?:'landxml-import'",
    "format:'LandXML'",
    'fileName:string',
    'surfaceName:string',
    'sourceId?:string',
  ],
  WebnetBakeTinProvenance: [
    "kind:'webnet-bake'",
    'sourceSurfaceId:string',
    'sourceSurfaceName:string',
    'sourceRevision:string',
    'sourceSourceKind?:string',
    'fileName?:string',
    'surfaceName?:string',
    'sourceId?:string',
  ],
  ExplicitFormatTinProvenance: [
    "kind?:'webnet-bake'",
    "format:'explicit'",
    'fileName:string',
    'surfaceName:string',
    'sourceId?:string',
    'sourceSurfaceId?:string',
    'sourceSurfaceName?:string',
    'sourceRevision?:string',
    'sourceSourceKind?:string',
  ],
  WebnetComposeTinProvenance: [
    "kind:'webnet-compose'",
    'baseSurfaceId:string',
    'baseSurfaceName:string',
    'baseRevision:string',
    'overlaySurfaceId:string',
    'overlaySurfaceName:string',
    'overlayRevision:string',
    "policy:'overlay-coverage-wins'",
    'resultDigest?:string',
    'fileName?:string',
    'surfaceName?:string',
    'sourceId?:string',
  ],
  WebnetGradingBakeTinProvenance: [
    "kind:'webnet-grading-bake'",
    'gradingId:string',
    'gradingName:string',
    'gradingRevision:string',
    'sourceFeatureLineId:string',
    'sourceVertexAId:string',
    'sourceVertexBId:string',
    "targetKind?:'surface'|'distance'|'elevation'|'relative-elevation'",
    'targetSurfaceId?:string',
    'criterionDistance?:number',
    'targetElevation?:number',
    'relativeElevation?:number',
    "accuracy:'EXACT'|'CURVE_APPROXIMATED'",
    'fileName?:string',
    'surfaceName?:string',
    'sourceId?:string',
  ],
  WebnetGradingDesignPatchTinProvenance: [
    "kind:'webnet-grading-design-patch'",
    'groupId:string',
    'groupName:string',
    'groupRevision:string',
    'sourceFeatureLineId:string',
    'sourceCourseRefs:string[]',
    "targetKind?:'surface'|'distance'|'elevation'|'relative-elevation'|'mixed-analytic'|'hybrid'",
    "analyticKinds?:Array<'distance'|'elevation'|'relative-elevation'>",
    "terminationKinds?:Array<'surface'|'distance'|'elevation'|'relative-elevation'>",
    'targetSurfaceId?:string',
    'targetSurfaceRevision?:string',
    'criterionDistance?:number',
    'targetElevation?:number',
    'relativeElevation?:number',
    "accuracy:'EXACT'|'CURVE_APPROXIMATED'",
    "cornerMode:'miter'",
    'includesInterior:true',
    "interiorPolicy:'flat-source'|'planar-source'",
    'fileName?:string',
    'surfaceName?:string',
    'sourceId?:string',
  ],
  WebnetGradingGroupBakeTinProvenance: [
    "kind:'webnet-grading-group-bake'",
    'groupId:string',
    'groupName:string',
    'groupRevision:string',
    'sourceFeatureLineId:string',
    'sourceCourseRefs:string[]',
    "targetKind?:'surface'|'distance'|'elevation'|'relative-elevation'|'mixed-analytic'|'hybrid'",
    "analyticKinds?:Array<'distance'|'elevation'|'relative-elevation'>",
    "terminationKinds?:Array<'surface'|'distance'|'elevation'|'relative-elevation'>",
    'targetSurfaceId?:string',
    'criterionDistance?:number',
    'targetElevation?:number',
    'relativeElevation?:number',
    "side:'left'|'right'",
    "accuracy:'EXACT'|'CURVE_APPROXIMATED'",
    "cornerMode:'miter'",
    'fileName?:string',
    'surfaceName?:string',
    'sourceId?:string',
  ],
  ImportedTinPayload: [
    'vertices:number[]',
    'faces:number[]',
    'provenance:ImportedTinProvenance',
  ],
  CadSurfaceVertexRef: ['key:string'],
  CadSurfaceEdgeRef: ['a:CadSurfaceVertexRef', 'b:CadSurfaceVertexRef'],
  CadSurfaceSwapEdgeEdit: [
    'id:string',
    "kind:'swap-edge'",
    'enabled?:boolean',
    'edge:CadSurfaceEdgeRef',
  ],
  CadSurfaceAddLineEdit: [
    'id:string',
    "kind:'add-line'",
    'enabled?:boolean',
    'from:CadSurfaceVertexRef',
    'to:CadSurfaceVertexRef',
  ],
  CadSurfaceDeleteLineEdit: [
    'id:string',
    "kind:'delete-line'",
    'enabled?:boolean',
    'edge:CadSurfaceEdgeRef',
  ],
  CadSurfaceAddPointEdit: [
    'id:string',
    "kind:'add-point'",
    'enabled?:boolean',
    'x:number',
    'y:number',
    'z:number',
  ],
  CadSurfaceDeletePointEdit: [
    'id:string',
    "kind:'delete-point'",
    'enabled?:boolean',
    'vertex:CadSurfaceVertexRef',
  ],
  CadSurfaceMovePointEdit: [
    'id:string',
    "kind:'move-point'",
    'enabled?:boolean',
    'vertex:CadSurfaceVertexRef',
    'x:number',
    'y:number',
  ],
  CadSurfaceSetElevationEdit: [
    'id:string',
    "kind:'set-elevation'",
    'enabled?:boolean',
    'vertex:CadSurfaceVertexRef',
    'z:number',
  ],
  CadSurfaceRaiseLowerEdit: [
    'id:string',
    "kind:'raise-lower-surface'",
    'enabled?:boolean',
    'deltaZ:number',
  ],
  CadSurfaceSetElevationsEdit: [
    'id:string',
    "kind:'set-elevation-many'",
    'enabled?:boolean',
    'vertices:CadSurfaceVertexRef[]',
    'z:number',
  ],
  CadSurfaceRaiseLowerVerticesEdit: [
    'id:string',
    "kind:'raise-lower-points'",
    'enabled?:boolean',
    'vertices:CadSurfaceVertexRef[]',
    'deltaZ:number',
  ],
  CadSurfaceMoveVerticesEdit: [
    'id:string',
    "kind:'move-points'",
    'enabled?:boolean',
    'vertices:CadSurfaceVertexRef[]',
    'deltaX:number',
    'deltaY:number',
  ],
};

/** Type-alias pins: whitespace-collapsed alias target text. */
const EXPECTED_ALIAS_TEXT: Record<string, string> = {
  ImportedTinProvenance: 'CadExplicitTinProvenance',
  ExplicitTinPayload: 'ImportedTinPayload',
};

/** Union literal branch order pins (whitespace collapsed). */
const EXPECTED_UNION_BRANCHES: Record<string, string[]> = {
  CadExplicitTinProvenance: [
    'LandxmlTinProvenance',
    'WebnetBakeTinProvenance',
    'WebnetGradingBakeTinProvenance',
    'WebnetGradingGroupBakeTinProvenance',
    'WebnetGradingDesignPatchTinProvenance',
    'WebnetComposeTinProvenance',
    'ExplicitFormatTinProvenance',
  ],
  CadSurfaceEdit: [
    'CadSurfaceSwapEdgeEdit',
    'CadSurfaceAddLineEdit',
    'CadSurfaceDeleteLineEdit',
    'CadSurfaceAddPointEdit',
    'CadSurfaceDeletePointEdit',
    'CadSurfaceMovePointEdit',
    'CadSurfaceSetElevationEdit',
    'CadSurfaceRaiseLowerEdit',
    'CadSurfaceSetElevationsEdit',
    'CadSurfaceRaiseLowerVerticesEdit',
    'CadSurfaceMoveVerticesEdit',
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

/** Distinctive moved provenance JSDoc markers that must travel with the declarations. */
const PROV_JSDOC_MARKERS = [
  '`kind` is optional on read',
  'Bakes ALWAYS write this shape',
  'Read alias only',
  'Composition ALWAYS writes this shape',
  "policy is\n * fixed to 'overlay-coverage-wins'",
  'Phase 20B grading-bake provenance',
  'never auto-composed',
  'discriminated explicit-TIN provenance (read-tolerant,',
  'Compact number arrays',
  'The mesh NEVER persists',
];

/** Distinctive moved surface-edit JSDoc markers that must travel with the declarations. */
const EDIT_JSDOC_MARKERS = [
  'Vertex refs address STABLE identities only',
  'Boundary (`boundary:…`) and Steiner (`steiner:…`) vertices are NOT',
  'Edit-created points get the stable key `edit:<surfaceId>:<editId>`',
  'Added to EVERY ACTIVE vertex at this replay position',
  'the persisted edit stores the canonical',
  'Bulk raise/lower-selected is distinct from whole-surface',
  'a missing ref fails the whole build closed',
];

const PROV_SPECIFIER = './cadTinProvenanceTypes';
const EDIT_SPECIFIER = './cadSurfaceEditTypes';
const DEF_SPECIFIER_24110 = './cadSurfaceDefinitionTypes';

const hubSource = (): string => fs.readFileSync(HUB, 'utf8');
const provSource = (): string => fs.readFileSync(PROV_LEAF, 'utf8');
const editSource = (): string => fs.readFileSync(EDIT_LEAF, 'utf8');

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

describe('STRUCT-241.8 leaf presence and declaration order', () => {
  it('both leaves exist before any shape assertion runs', () => {
    expect(fs.existsSync(PROV_LEAF)).toBe(true);
    expect(fs.existsSync(EDIT_LEAF)).toBe(true);
  });

  it('provenance leaf declares exactly the 11 contracts in original order', () => {
    expect(exportedDeclNames(parse(PROV_LEAF))).toEqual(MOVED_PROVENANCE);
  });

  it('surface-edit leaf declares exactly the 14 contracts in original order', () => {
    expect(exportedDeclNames(parse(EDIT_LEAF))).toEqual(MOVED_EDITS);
  });

  it('the two leaves own disjoint name sets with no cross-import', () => {
    expect(new Set(MOVED_25).size).toBe(25);
    expect(allImportSpecifiers(PROV_LEAF)).not.toContain(EDIT_SPECIFIER);
    expect(allImportSpecifiers(EDIT_LEAF)).not.toContain(PROV_SPECIFIER);
  });
});

describe('STRUCT-241.8 baseline provenance interface shapes pinned verbatim', () => {
  it.each(PROV_INTERFACES)('provenance leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(PROV_LEAF), 'provenance leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.8 baseline surface-edit interface shapes pinned verbatim', () => {
  it.each(EDIT_INTERFACES)('edit leaf %s matches the hand-transcribed shape', (name) => {
    expect(propsOf(parse(EDIT_LEAF), 'edit leaf', name)).toEqual(EXPECTED_INTERFACE_PROPS[name]);
  });
});

describe('STRUCT-241.8 baseline alias and union shapes pinned verbatim', () => {
  it.each(Object.keys(EXPECTED_ALIAS_TEXT))('leaf alias %s matches the hand-transcribed alias', (name) => {
    const file = MOVED_PROVENANCE.includes(name) ? parse(PROV_LEAF) : parse(EDIT_LEAF);
    const label = MOVED_PROVENANCE.includes(name) ? 'provenance leaf' : 'edit leaf';
    expect(aliasTextOf(file, label, name)).toBe(EXPECTED_ALIAS_TEXT[name]);
  });

  it.each(Object.keys(EXPECTED_UNION_BRANCHES))('leaf union %s keeps its branch order', (name) => {
    const file = name === 'CadExplicitTinProvenance' ? parse(PROV_LEAF) : parse(EDIT_LEAF);
    const label = name === 'CadExplicitTinProvenance' ? 'provenance leaf' : 'edit leaf';
    expect(unionMembers(file, label, name)).toEqual(EXPECTED_UNION_BRANCHES[name]);
  });
});

describe('STRUCT-241.8 JSDoc parity (comments travel with the declarations)', () => {
  it.each(PROV_JSDOC_MARKERS)('provenance leaf keeps marker %s', (marker) => {
    expect(provSource()).toContain(marker);
  });

  it.each(EDIT_JSDOC_MARKERS)('edit leaf keeps marker %s', (marker) => {
    expect(editSource()).toContain(marker);
  });

  it('overlay-coverage-wins policy wording stays inside the compose provenance', () => {
    const source = provSource();
    const policy = source.indexOf("policy: 'overlay-coverage-wins';");
    const marker = source.indexOf('the only supported ownership rule');
    expect(policy).toBeGreaterThan(-1);
    expect(marker).toBeGreaterThan(-1);
    expect(marker).toBeLessThan(policy);
  });

  it('stable-ref addressing markers stay inside the vertex-ref JSDoc', () => {
    const source = editSource();
    for (const marker of ['source:<entityId>', 'imported:<surfaceId>:<vertexIndex>', 'edit:<surfaceId>:<editId>']) {
      expect(source).toContain(marker);
    }
  });

  it('hub keeps none of the moved provenance or edit JSDoc bodies', () => {
    const hub = hubSource();
    for (const marker of [...PROV_JSDOC_MARKERS, ...EDIT_JSDOC_MARKERS]) {
      expect(hub).not.toContain(marker);
    }
    expect(hub).not.toContain('Vertex refs address STABLE identities only');
    expect(hub).not.toContain('The mesh NEVER persists');
  });
});

// ---------------------------------------------------------------------------
// Facade contract: hub re-exports all 25, keeps no originals.
// ---------------------------------------------------------------------------

describe('STRUCT-241.8 hub facade re-exports', () => {
  it('re-exports all 11 provenance names from the new provenance leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${PROV_SPECIFIER}';`);
    const exportBlock = facadeBlockTextOf(source, PROV_SPECIFIER, 'export');
    for (const name of MOVED_PROVENANCE) {
      expect(exportBlock).toContain(`  ${name},`);
    }
  });

  it('re-exports all 14 surface-edit names from the new edit leaf', () => {
    const source = hubSource();
    expect(source).toContain(`} from '${EDIT_SPECIFIER}';`);
    const exportBlock = facadeBlockTextOf(source, EDIT_SPECIFIER, 'export');
    for (const name of MOVED_EDITS) {
      expect(exportBlock).toContain(`  ${name},`);
    }
  });

  it('keeps no original interface/alias declaration for any moved name', () => {
    const source = hubSource();
    for (const name of MOVED_25) {
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
    expect(typeImports).toContain(PROV_SPECIFIER);
    expect(typeImports).toContain(EDIT_SPECIFIER);
  });

  it('keeps CadSurfaceDefinition with its edit-stack and imported-TIN fields', () => {
    // STRUCT-241.10 roll-forward: the definition now lives in
    // cadSurfaceDefinitionTypes.ts; the hub keeps only the grouped
    // `import type` + `export type` facade so legacy paths compile.
    const hub = hubSource();
    expect(hub).toContain(`} from '${DEF_SPECIFIER_24110}';`);
    expect(hub).not.toContain('export interface CadSurfaceDefinition {');
    const def = fs.readFileSync(DEF_LEAF_24110, 'utf8');
    expect(def).toContain('export interface CadSurfaceDefinition {');
    expect(def).toContain('edits?: CadSurfaceEdit[];');
    expect(def).toContain('importedTin?: ImportedTinPayload;');
    expect(def).toContain("sourceKind?: 'native' | 'imported-tin' | 'explicit-tin';");
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

  it('keeps no original surface/point-source declarations in the hub (moved by STRUCT-241.10)', () => {
    // STRUCT-241.10 roll-forward: the surface source/definition and status
    // contracts now live in cadSurfaceDefinitionTypes /
    // cadSurfaceModelStyleTypes; the hub keeps only the facades.
    const hub = hubSource();
    for (const decl of [
      'export type CadSurfacePointSource',
      'export interface CadSurfaceBreakline',
      'export interface CadSurfaceBoundary',
      'export interface CadSurfaceBuildOptions',
      'export type CadSurfaceStatus',
    ]) {
      expect(hub).not.toContain(decl);
    }
    expect(hub).toContain(`} from '${DEF_SPECIFIER_24110}';`);
  });
});

// ---------------------------------------------------------------------------
// Facade-vs-leaf type equality, bidirectional (all 25).
// ---------------------------------------------------------------------------

describe('STRUCT-241.8 provenance facade vs leaf type equality', () => {
  it('LandxmlTinProvenance equality holds both directions', () => {
    expectTypeOf<ProvLandxmlTinProvenance>().toEqualTypeOf<HubLandxmlTinProvenance>();
    expectTypeOf<HubLandxmlTinProvenance>().toEqualTypeOf<ProvLandxmlTinProvenance>();
  });
  it('WebnetBakeTinProvenance equality holds both directions', () => {
    expectTypeOf<ProvWebnetBakeTinProvenance>().toEqualTypeOf<HubWebnetBakeTinProvenance>();
    expectTypeOf<HubWebnetBakeTinProvenance>().toEqualTypeOf<ProvWebnetBakeTinProvenance>();
  });
  it('ExplicitFormatTinProvenance equality holds both directions', () => {
    expectTypeOf<ProvExplicitFormatTinProvenance>().toEqualTypeOf<HubExplicitFormatTinProvenance>();
    expectTypeOf<HubExplicitFormatTinProvenance>().toEqualTypeOf<ProvExplicitFormatTinProvenance>();
  });
  it('WebnetComposeTinProvenance equality holds both directions', () => {
    expectTypeOf<ProvWebnetComposeTinProvenance>().toEqualTypeOf<HubWebnetComposeTinProvenance>();
    expectTypeOf<HubWebnetComposeTinProvenance>().toEqualTypeOf<ProvWebnetComposeTinProvenance>();
  });
  it('WebnetGradingBakeTinProvenance equality holds both directions', () => {
    expectTypeOf<ProvWebnetGradingBakeTinProvenance>().toEqualTypeOf<HubWebnetGradingBakeTinProvenance>();
    expectTypeOf<HubWebnetGradingBakeTinProvenance>().toEqualTypeOf<ProvWebnetGradingBakeTinProvenance>();
  });
  it('WebnetGradingDesignPatchTinProvenance equality holds both directions', () => {
    expectTypeOf<ProvWebnetGradingDesignPatchTinProvenance>().toEqualTypeOf<HubWebnetGradingDesignPatchTinProvenance>();
    expectTypeOf<HubWebnetGradingDesignPatchTinProvenance>().toEqualTypeOf<ProvWebnetGradingDesignPatchTinProvenance>();
  });
  it('WebnetGradingGroupBakeTinProvenance equality holds both directions', () => {
    expectTypeOf<ProvWebnetGradingGroupBakeTinProvenance>().toEqualTypeOf<HubWebnetGradingGroupBakeTinProvenance>();
    expectTypeOf<HubWebnetGradingGroupBakeTinProvenance>().toEqualTypeOf<ProvWebnetGradingGroupBakeTinProvenance>();
  });
  it('CadExplicitTinProvenance equality holds both directions', () => {
    expectTypeOf<ProvExplicitTinProvenance>().toEqualTypeOf<HubExplicitTinProvenance>();
    expectTypeOf<HubExplicitTinProvenance>().toEqualTypeOf<ProvExplicitTinProvenance>();
  });
  it('ImportedTinProvenance equality holds both directions', () => {
    expectTypeOf<ProvImportedTinProvenance>().toEqualTypeOf<HubImportedTinProvenance>();
    expectTypeOf<HubImportedTinProvenance>().toEqualTypeOf<ProvImportedTinProvenance>();
  });
  it('ImportedTinPayload equality holds both directions', () => {
    expectTypeOf<ProvImportedTinPayload>().toEqualTypeOf<HubImportedTinPayload>();
    expectTypeOf<HubImportedTinPayload>().toEqualTypeOf<ProvImportedTinPayload>();
  });
  it('ExplicitTinPayload equality holds both directions', () => {
    expectTypeOf<ProvExplicitTinPayload>().toEqualTypeOf<HubExplicitTinPayload>();
    expectTypeOf<HubExplicitTinPayload>().toEqualTypeOf<ProvExplicitTinPayload>();
  });
});

describe('STRUCT-241.8 surface-edit facade vs leaf type equality', () => {
  it('CadSurfaceVertexRef equality holds both directions', () => {
    expectTypeOf<EditVertexRef>().toEqualTypeOf<HubVertexRef>();
    expectTypeOf<HubVertexRef>().toEqualTypeOf<EditVertexRef>();
  });
  it('CadSurfaceEdgeRef equality holds both directions', () => {
    expectTypeOf<EditEdgeRef>().toEqualTypeOf<HubEdgeRef>();
    expectTypeOf<HubEdgeRef>().toEqualTypeOf<EditEdgeRef>();
  });
  it('CadSurfaceSwapEdgeEdit equality holds both directions', () => {
    expectTypeOf<EditSwapEdgeEdit>().toEqualTypeOf<HubSwapEdgeEdit>();
    expectTypeOf<HubSwapEdgeEdit>().toEqualTypeOf<EditSwapEdgeEdit>();
  });
  it('CadSurfaceAddLineEdit equality holds both directions', () => {
    expectTypeOf<EditAddLineEdit>().toEqualTypeOf<HubAddLineEdit>();
    expectTypeOf<HubAddLineEdit>().toEqualTypeOf<EditAddLineEdit>();
  });
  it('CadSurfaceDeleteLineEdit equality holds both directions', () => {
    expectTypeOf<EditDeleteLineEdit>().toEqualTypeOf<HubDeleteLineEdit>();
    expectTypeOf<HubDeleteLineEdit>().toEqualTypeOf<EditDeleteLineEdit>();
  });
  it('CadSurfaceAddPointEdit equality holds both directions', () => {
    expectTypeOf<EditAddPointEdit>().toEqualTypeOf<HubAddPointEdit>();
    expectTypeOf<HubAddPointEdit>().toEqualTypeOf<EditAddPointEdit>();
  });
  it('CadSurfaceDeletePointEdit equality holds both directions', () => {
    expectTypeOf<EditDeletePointEdit>().toEqualTypeOf<HubDeletePointEdit>();
    expectTypeOf<HubDeletePointEdit>().toEqualTypeOf<EditDeletePointEdit>();
  });
  it('CadSurfaceMovePointEdit equality holds both directions', () => {
    expectTypeOf<EditMovePointEdit>().toEqualTypeOf<HubMovePointEdit>();
    expectTypeOf<HubMovePointEdit>().toEqualTypeOf<EditMovePointEdit>();
  });
  it('CadSurfaceSetElevationEdit equality holds both directions', () => {
    expectTypeOf<EditSetElevationEdit>().toEqualTypeOf<HubSetElevationEdit>();
    expectTypeOf<HubSetElevationEdit>().toEqualTypeOf<EditSetElevationEdit>();
  });
  it('CadSurfaceRaiseLowerEdit equality holds both directions', () => {
    expectTypeOf<EditRaiseLowerEdit>().toEqualTypeOf<HubRaiseLowerEdit>();
    expectTypeOf<HubRaiseLowerEdit>().toEqualTypeOf<EditRaiseLowerEdit>();
  });
  it('CadSurfaceSetElevationsEdit equality holds both directions', () => {
    expectTypeOf<EditSetElevationsEdit>().toEqualTypeOf<HubSetElevationsEdit>();
    expectTypeOf<HubSetElevationsEdit>().toEqualTypeOf<EditSetElevationsEdit>();
  });
  it('CadSurfaceRaiseLowerVerticesEdit equality holds both directions', () => {
    expectTypeOf<EditRaiseLowerVerticesEdit>().toEqualTypeOf<HubRaiseLowerVerticesEdit>();
    expectTypeOf<HubRaiseLowerVerticesEdit>().toEqualTypeOf<EditRaiseLowerVerticesEdit>();
  });
  it('CadSurfaceMoveVerticesEdit equality holds both directions', () => {
    expectTypeOf<EditMoveVerticesEdit>().toEqualTypeOf<HubMoveVerticesEdit>();
    expectTypeOf<HubMoveVerticesEdit>().toEqualTypeOf<EditMoveVerticesEdit>();
  });
  it('CadSurfaceEdit equality holds both directions', () => {
    expectTypeOf<EditSurfaceEdit>().toEqualTypeOf<HubSurfaceEdit>();
    expectTypeOf<HubSurfaceEdit>().toEqualTypeOf<EditSurfaceEdit>();
  });
});

// ---------------------------------------------------------------------------
// Unaffected hub unions: CadEntity order, CadBlockChild order, child type.
// ---------------------------------------------------------------------------

describe('STRUCT-241.8 unaffected hub unions', () => {
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

describe('STRUCT-241.8 type-only leaves and emit parity', () => {
  it('provenance leaf has zero imports, zero value declarations, zero out-edges', () => {
    expect(runtimeImportSpecifiers(PROV_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(PROV_LEAF)).toBe(true);
    expect(valueStatementKinds(PROV_LEAF)).toEqual([]);
    expect(allImportSpecifiers(PROV_LEAF)).toEqual([]);
  });

  it('edit leaf has zero imports, zero value declarations, zero out-edges', () => {
    expect(runtimeImportSpecifiers(EDIT_LEAF)).toEqual([]);
    expect(hasOnlyTypeImports(EDIT_LEAF)).toBe(true);
    expect(valueStatementKinds(EDIT_LEAF)).toEqual([]);
    expect(allImportSpecifiers(EDIT_LEAF)).toEqual([]);
  });

  it('neither leaf imports cadTypes, a barrel, or an engine runtime module', () => {
    for (const file of [PROV_LEAF, EDIT_LEAF]) {
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
    expect(strippedEmit(PROV_LEAF)).toBe('export {};');
    expect(strippedEmit(EDIT_LEAF)).toBe('export {};');
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
// The 241.8 extraction is type-only and both leaves are import-free, so both
// VALUE|mixed digests are unchanged; the explicit TYPE allowlist adds +2
// nodes / +4 scoped edges (each leaf: 0 out + hub import + hub export; no
// retired hub edge) and +2 nodes / +4 full edges (every 241.8 edge resolves
// inside `src`, so the full-scope delta matches the scoped delta here).
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

describe('STRUCT-241.8 CAD+F2F graph pins', () => {
  it('keeps VALUE/TYPE acyclic and the VALUE|mixed digest identical', () => {
    const graph = cadF2fGraph(); // first/cold scoped build; 30 s tolerates full-suite CI load
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect([typeCycles.cyclic.length, typeCycles.cyclicNodes.size]).toEqual([0, 0]);
    // 241.7 baseline 495 / 2440; the type-only import-free 241.8 leaves add
    // +2 nodes and +4 type edges (each leaf: 0 out + hub import + hub
    // export; no retired hub edge). STRUCT-241.9 adds +2 nodes and +6
    // type edges (per leaf: 1 out-edge to core primitives + hub import +
    // hub export; no retired hub edge). STRUCT-241.10 adds +2 nodes and
    // +9 type edges (definition leaf: 3 out-edges + hub import + hub
    // export; model leaf: one-way B->A + core out-edge + hub import +
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

  it('adds exactly the allow-listed TYPE edges incident to the provenance leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(PROV_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([]);
    // One `import type` edge plus one `export type ... from` edge, plus the
    // STRUCT-241.10 definition-leaf out-edge (graph from-path order).
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: PROV_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([
      { from: path.resolve(DEF_LEAF_24110), to: leaf, specifier: PROV_SPECIFIER, kind: 'type' },
      hubToLeaf,
      hubToLeaf,
    ]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('adds exactly the allow-listed TYPE edges incident to the edit leaf', () => {
    const graph = cadF2fGraph();
    const leaf = path.resolve(EDIT_LEAF);
    expect(graph.edges.filter((edge) => edge.from === leaf)).toEqual([]);
    // One `import type` edge plus one `export type ... from` edge, plus the
    // STRUCT-241.10 definition-leaf out-edge (graph from-path order).
    const hubToLeaf = { from: path.resolve(HUB), to: leaf, specifier: EDIT_SPECIFIER, kind: 'type' };
    expect(graph.edges.filter((edge) => edge.to === leaf)).toEqual([
      { from: path.resolve(DEF_LEAF_24110), to: leaf, specifier: EDIT_SPECIFIER, kind: 'type' },
      hubToLeaf,
      hubToLeaf,
    ]);
    expect(graph.nodes.filter((node) => node === leaf)).toHaveLength(1);
    expect(graph.edges.filter(
      (edge) => (edge.from === leaf || edge.to === leaf) && edge.kind !== 'type',
    )).toEqual([]);
  });

  it('has no leaf back-edge to the hub or to engine runtime modules', () => {
    const graph = cadF2fGraph();
    for (const leaf of [path.resolve(PROV_LEAF), path.resolve(EDIT_LEAF)]) {
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

describe('STRUCT-241.8 full-src graph pins', () => {
  // One cold full-`src` parse (~1.6k files); cached for any later case.
  it('keeps VALUE acyclic, TYPE 7 SCC / 38 nodes, and the full digest identical', () => {
    const graph = fullSrcGraph();
    const valueCycles = findCycles(graph.nodes, graph.value);
    const typeCycles = findCycles(graph.nodes, graph.type);
    expect([valueCycles.cyclic.length, valueCycles.cyclicNodes.size]).toEqual([0, 0]);
    expect(typeCycles.cyclic.length).toBe(7);
    expect(typeCycles.cyclic.reduce((sum, component) => sum + component.length, 0)).toBe(38);
    // 241.7 baseline 1667 / 7551; the 241.8 leaves add +2 nodes and +4 type
    // edges (same allowlist as the scoped pin; every 241.8 edge resolves
    // inside `src`). STRUCT-241.9 adds +2 nodes and +6 type edges (same
    // allowlist as the scoped pin; every 241.9 edge resolves inside `src`).
    // STRUCT-241.10 adds +2 nodes and +9 type edges (same allowlist as the
    // scoped pin; every 241.10 edge resolves inside `src`).
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

describe('STRUCT-241.8 negative controls (in-memory mutations only)', () => {
  it('fails the shape pin when the LandXML read-tolerant kind becomes required', () => {
    const mutated = provSource().replace("  kind?: 'landxml-import';", "  kind: 'landxml-import';");
    expect(mutated).not.toBe(provSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'LandxmlTinProvenance'))
      .toEqual(EXPECTED_INTERFACE_PROPS['LandxmlTinProvenance'])).toThrow();
  });

  it('fails the shape pin when the bake discriminant changes', () => {
    const mutated = provSource().replace("  kind: 'webnet-bake';\n  sourceSurfaceId", "  kind: 'webnet-baked';\n  sourceSurfaceId");
    expect(mutated).not.toBe(provSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'WebnetBakeTinProvenance'))
      .toEqual(EXPECTED_INTERFACE_PROPS['WebnetBakeTinProvenance'])).toThrow();
  });

  it('fails the shape pin when the compose ownership policy changes', () => {
    const mutated = provSource().replace("policy: 'overlay-coverage-wins'", "policy: 'base-coverage-wins'");
    expect(mutated).not.toBe(provSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'WebnetComposeTinProvenance'))
      .toEqual(EXPECTED_INTERFACE_PROPS['WebnetComposeTinProvenance'])).toThrow();
  });

  it('fails the shape pin when the compose resultDigest becomes required', () => {
    const mutated = provSource().replace('  resultDigest?: string;', '  resultDigest: string;');
    expect(mutated).not.toBe(provSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'WebnetComposeTinProvenance'))
      .toEqual(EXPECTED_INTERFACE_PROPS['WebnetComposeTinProvenance'])).toThrow();
  });

  it('fails the shape pin when the design-patch hybrid target-kind order flips', () => {
    const mutated = provSource().replace(
      "'relative-elevation' | 'mixed-analytic' | 'hybrid'",
      "'relative-elevation' | 'hybrid' | 'mixed-analytic'",
    );
    expect(mutated).not.toBe(provSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'WebnetGradingDesignPatchTinProvenance'))
      .toEqual(EXPECTED_INTERFACE_PROPS['WebnetGradingDesignPatchTinProvenance'])).toThrow();
  });

  it('fails the shape pin when the analytic-kinds canonical order flips', () => {
    const mutated = provSource().replace(
      "analyticKinds?: Array<'distance' | 'elevation' | 'relative-elevation'>;",
      "analyticKinds?: Array<'elevation' | 'distance' | 'relative-elevation'>;",
    );
    expect(mutated).not.toBe(provSource());
    // The line above occurs identically in both the design-patch and the
    // group-bake interfaces; `replace` flips the first (design-patch) one.
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'WebnetGradingDesignPatchTinProvenance'))
      .toEqual(EXPECTED_INTERFACE_PROPS['WebnetGradingDesignPatchTinProvenance'])).toThrow();
  });

  it('fails the shape pin when the design-patch includesInterior literal becomes optional', () => {
    const mutated = provSource().replace('  includesInterior: true;', '  includesInterior?: true;');
    expect(mutated).not.toBe(provSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'WebnetGradingDesignPatchTinProvenance'))
      .toEqual(EXPECTED_INTERFACE_PROPS['WebnetGradingDesignPatchTinProvenance'])).toThrow();
  });

  it('fails the shape pin when the imported-TIN faces array goes missing', () => {
    const mutated = provSource().replace('  faces: number[];\n', '');
    expect(mutated).not.toBe(provSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'ImportedTinPayload'))
      .toEqual(EXPECTED_INTERFACE_PROPS['ImportedTinPayload'])).toThrow();
  });

  it('fails the union pin when a provenance variant branch is removed', () => {
    const mutated = provSource().replace('  | ExplicitFormatTinProvenance;\n', ';\n');
    expect(mutated).not.toBe(provSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadExplicitTinProvenance'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadExplicitTinProvenance'])).toThrow();
  });

  it('fails the union pin when two provenance branches are swapped', () => {
    const mutated = provSource().replace(
      '  | WebnetComposeTinProvenance\n  | ExplicitFormatTinProvenance;',
      '  | ExplicitFormatTinProvenance\n  | WebnetComposeTinProvenance;',
    );
    expect(mutated).not.toBe(provSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadExplicitTinProvenance'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadExplicitTinProvenance'])).toThrow();
  });

  it('fails the shape pin when the vertex stable-ref key becomes optional', () => {
    const mutated = editSource().replace('  key: string;', '  key?: string;');
    expect(mutated).not.toBe(editSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceVertexRef'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceVertexRef'])).toThrow();
  });

  it('fails the shape pin when a topology edit enabled? becomes required', () => {
    const mutated = editSource().replace(
      "  kind: 'swap-edge';\n  /** Absent = TRUE. */\n  enabled?: boolean;",
      "  kind: 'swap-edge';\n  /** Absent = TRUE. */\n  enabled: boolean;",
    );
    expect(mutated).not.toBe(editSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceSwapEdgeEdit'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceSwapEdgeEdit'])).toThrow();
  });

  it('fails the shape pin when the move-point XY target loses a coordinate', () => {
    const mutated = editSource().replace(
      "  kind: 'move-point';\n  /** Absent = TRUE. */\n  enabled?: boolean;\n  vertex: CadSurfaceVertexRef;\n  /** XY-only target (Z unchanged). */\n  x: number;\n  y: number;",
      "  kind: 'move-point';\n  /** Absent = TRUE. */\n  enabled?: boolean;\n  vertex: CadSurfaceVertexRef;\n  /** XY-only target (Z unchanged). */\n  x: number;",
    );
    expect(mutated).not.toBe(editSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceMovePointEdit'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceMovePointEdit'])).toThrow();
  });

  it('fails the shape pin when the bulk canonical vertex array element type widens', () => {
    const mutated = editSource().replace(
      '  vertices: CadSurfaceVertexRef[];\n  deltaZ: number;',
      '  vertices: string[];\n  deltaZ: number;',
    );
    expect(mutated).not.toBe(editSource());
    expect(() => expect(propsOf(parseText('m.ts', mutated), 'm', 'CadSurfaceRaiseLowerVerticesEdit'))
      .toEqual(EXPECTED_INTERFACE_PROPS['CadSurfaceRaiseLowerVerticesEdit'])).toThrow();
  });

  it('fails the union pin when an edit variant member is removed', () => {
    const mutated = editSource().replace('  | CadSurfaceMoveVerticesEdit;\n', ';\n');
    expect(mutated).not.toBe(editSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadSurfaceEdit'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadSurfaceEdit'])).toThrow();
  });

  it('fails the union pin when two edit variant branches are swapped', () => {
    const mutated = editSource().replace(
      '  | CadSurfaceSetElevationsEdit\n  | CadSurfaceRaiseLowerVerticesEdit',
      '  | CadSurfaceRaiseLowerVerticesEdit\n  | CadSurfaceSetElevationsEdit',
    );
    expect(mutated).not.toBe(editSource());
    expect(() => expect(unionMembers(parseText('m.ts', mutated), 'm', 'CadSurfaceEdit'))
      .toEqual(EXPECTED_UNION_BRANCHES['CadSurfaceEdit'])).toThrow();
  });

  it('detects a removed public re-export from the hub facade export block only', () => {
    const hub = hubSource();
    // Withdraw ONLY the export-type entry; the local `import type` stays, so
    // the hub still typechecks locally against the leaf while the public
    // re-export surface is the thing under test.
    const exportBlock = facadeBlockTextOf(hub, PROV_SPECIFIER, 'export');
    const mutatedExportBlock = exportBlock.replace('  WebnetComposeTinProvenance,\n', '');
    expect(mutatedExportBlock).not.toBe(exportBlock);
    const mutated = hub.replace(exportBlock, mutatedExportBlock);
    expect(mutated).not.toBe(hub);
    // Import block retains the name (local resolution intact); export block
    // is where the absence must be observed, not the whole hub.
    expect(facadeBlockTextOf(mutated, PROV_SPECIFIER, 'import')).toContain('  WebnetComposeTinProvenance,');
    const mutatedExport = facadeBlockTextOf(mutated, PROV_SPECIFIER, 'export');
    expect(mutatedExport).not.toContain('  WebnetComposeTinProvenance,');
    // The positive facade pin (export-block scoped) now fails on this mutation.
    expect(() => expect(facadeBlockTextOf(mutated, PROV_SPECIFIER, 'export')).toContain('  WebnetComposeTinProvenance,')).toThrow();
    for (const name of MOVED_PROVENANCE) {
      if (name === 'WebnetComposeTinProvenance') continue;
      expect(mutatedExport).toContain(`  ${name},`);
    }
  });

  it('catches a simulated leaf-to-hub TYPE back-edge as a new TYPE cycle', () => {
    const mutatedLeaf = `${provSource()}\nimport type { CadProject } from './cadTypes';\nexport type CycleProbe = CadProject | null;\n`;
    const graph = buildGraphs([
      { path: path.resolve(PROV_LEAF), source: mutatedLeaf },
      { path: path.resolve(HUB), source: hubSource() },
    ]);
    const typeCycles = findCycles(graph.nodes, graph.type);
    const cyclic = new Set(typeCycles.cyclic.flat());
    expect(cyclic.has(path.resolve(PROV_LEAF))).toBe(true);
    expect(cyclic.has(path.resolve(HUB))).toBe(true);
  });

  it('detects a simulated value import on the edit leaf as a runtime edge', () => {
    const mutated = `${editSource()}\nimport { surfacePointGroupIds } from './cadTypes';\nconst probe = surfacePointGroupIds;\n`;
    expect(mutated).not.toBe(editSource());
    expect(hasOnlyTypeImportsSource(parseText('m.ts', mutated))).toBe(false);
    expect(runtimeImportSpecifiersSource(parseText('m.ts', mutated))).toEqual(['./cadTypes']);
    const graph = buildGraphs([
      { path: path.resolve(EDIT_LEAF), source: mutated },
      { path: path.resolve(HUB), source: hubSource() },
    ]);
    expect(graph.edges.filter((edge) => edge.from === path.resolve(EDIT_LEAF) && edge.kind === 'value')).toHaveLength(1);
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
});

describe('STRUCT-241.8 worktree hygiene (no disk writes by controls)', () => {
  it('leaves the worktree clean (mutations never touch disk)', () => {
    expect(fs.readFileSync(PROV_LEAF, 'utf8')).toBe(provSource());
    expect(fs.readFileSync(EDIT_LEAF, 'utf8')).toBe(editSource());
    expect(fs.readFileSync(HUB, 'utf8')).toBe(hubSource());
  });
});

describe('STRUCT-241.8 prior phase guards stay green by import existence', () => {
  it.each([
    'cad_survey_layer_command_type_leaves_2411',
    'cad_block_command_type_leaf_2412',
    'cad_entity_style_presentation_type_leaves_2413',
    'cad_primitive_geometry_entity_type_leaf_2414',
    'cad_annotation_survey_table_type_leaves_2415',
    'cad_linear_design_parcel_entity_type_leaves_2416',
    'cad_parcel_layout_grip_snap_type_leaves_2417',
    'cad_annotation_cogo_type_cycle_1957',
    'cad_project_transform_runtime_cycle_19511',
    'cad_cogo_parcel_runtime_cycle_19512',
    'cad_cogo_arc_summaries_runtime_cycle_19513',
    'cad_geometry_primitives_runtime_cycle_19514',
  ])('neighbour suite %s exists', (name) => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'tests', `${name}.test.ts`))).toBe(true);
  });
});
