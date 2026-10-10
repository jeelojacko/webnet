/**
 * STRUCT-195.5 (test + evidence worker) — profile/section command payload type leaves.
 *
 * Pins `src/engine/cad/cadTransactionsProfileCommandTypes.ts` and
 * `src/engine/cad/cadTransactionsSectionCommandTypes.ts`:
 *  - exact key sets in exact union order (11 profile variants +
 *    `CadProfileViewUpdatePatch`; 17 section variants +
 *    `CadSectionViewDeleteCommand`, with LANDXML_IMPORT intentionally absent
 *    from the section leaf because it stays inline in the hub);
 *  - `Extract<CadCommand, { key }>` payload equivalence per key for all 29
 *    keys (fails on drift, not just on compile);
 *  - independent baseline-shape pins: hand-written object-literal types
 *    transcribed from the pre-refactor hub source, compared against both the
 *    hub `Extract` and the leaf `Extract` per key (plus the full
 *    `CadProfileViewUpdatePatch` interface). These do not import the leaf
 *    types under test, so leaf drift cannot move both sides of an assertion;
 *  - the literal hub `CadCommand` union order (surface -> volume ->
 *    profile -> section -> LANDXML_IMPORT -> SECTION_VIEW_DELETE ->
 *    BLOCK_CREATE);
 *  - `CadProfileViewUpdatePatch` importable from BOTH the leaf and the hub
 *    with an identical shape;
 *  - both leaves are type-only (zero value imports/exports);
 *  - no type edge from either leaf back to `cadTransactions.types.ts` /
 *    `cadTransactions.ts` (via `scripts/cadTypeImportGraph.mjs`).
 *
 * Uses only the TypeScript compiler API + the repo graph script (no new deps).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  buildGraphs,
  collectTypeScriptFiles,
} from '../scripts/cadTypeImportGraph.mjs';

import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadLayerId } from '../src/engine/cad/cadCorePrimitiveTypes';
import type { CadProfileStyle, CadSectionStyle } from '../src/engine/cad/cadTypes';
import type { CadProfileStylePatch } from '../src/engine/cad/cadProfileTypes';
import type {
  CadSampleLinePatch,
  CadSectionStylePatch,
  CadSectionViewPatch,
} from '../src/engine/cad/cadSectionTypes';
import type {
  CadProfileCommandPayload,
  CadProfileViewUpdatePatch as LeafProfileViewUpdatePatch,
} from '../src/engine/cad/cadTransactionsProfileCommandTypes';
import type { CadProfileViewUpdatePatch as HubProfileViewUpdatePatch } from '../src/engine/cad/cadTransactions.types';
import type {
  CadSectionCommandPayload,
  CadSectionViewDeleteCommand,
} from '../src/engine/cad/cadTransactionsSectionCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const PROFILE_LEAF = path.join(CAD_DIR, 'cadTransactionsProfileCommandTypes.ts');
const SECTION_LEAF = path.join(CAD_DIR, 'cadTransactionsSectionCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

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

/** Import specifiers (any kind) for the file, in source order. */
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

/** Ordered `key` string literals of every object variant in the alias union. */
const unionKeysInOrder = (file: string, aliasName: string): string[] => {
  const alias = parse(file).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === aliasName,
  );
  if (!alias) return [];
  const keys: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(visit);
      return;
    }
    if (!ts.isTypeLiteralNode(node)) return;
    const keyProp = node.members.find(
      (member): member is ts.PropertySignature =>
        ts.isPropertySignature(member) && member.name.getText() === 'key',
    );
    if (keyProp?.type && ts.isLiteralTypeNode(keyProp.type) && ts.isStringLiteral(keyProp.type.literal)) {
      keys.push(keyProp.type.literal.text);
    }
  };
  visit(alias.type);
  return keys;
};

/** The `key` literal of a single-variant interface (e.g. section view delete). */
const interfaceKeyLiteral = (file: string, interfaceName: string): string | null => {
  const declaration = parse(file).statements.find(
    (stmt): stmt is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(stmt) && stmt.name.text === interfaceName,
  );
  const keyProp = declaration?.members.find(
    (member): member is ts.PropertySignature =>
      ts.isPropertySignature(member) && member.name.getText() === 'key',
  );
  const literal = keyProp?.type;
  return literal && ts.isLiteralTypeNode(literal) && ts.isStringLiteral(literal.literal)
    ? literal.literal.text
    : null;
};

/**
 * Ordered hub `CadCommand` union members: type-alias refs stay refs, inline
 * object literals collapse to their `key` literal. Fails loudly (never
 * silently empty) so union refactors break this guard instead of passing.
 */
const hubMemberOrder = (): string[] => {
  const alias = parse(HUB).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'CadCommand',
  );
  if (!alias) throw new Error('CadCommand alias missing from hub');
  const members: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(visit);
      return;
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      members.push(node.typeName.text);
      return;
    }
    if (ts.isTypeLiteralNode(node)) {
      const keyProp = node.members.find(
        (member): member is ts.PropertySignature =>
          ts.isPropertySignature(member) && member.name.getText() === 'key',
      );
      if (keyProp?.type && ts.isLiteralTypeNode(keyProp.type) && ts.isStringLiteral(keyProp.type.literal)) {
        members.push(keyProp.type.literal.text);
      }
    }
  };
  visit(alias.type);
  if (members.length === 0) throw new Error('CadCommand union parsed to zero members');
  return members;
};

const EXPECTED_PROFILE_KEYS = [
  'PROFILE_CREATE',
  'PROFILE_REBUILD',
  'PROFILE_DELETE',
  'PROFILE_VIEW_CREATE',
  'PROFILE_VIEW_UPDATE',
  'PROFILE_VIEW_DELETE',
  'PROFILE_STYLE_CREATE',
  'PROFILE_STYLE_DUPLICATE',
  'PROFILE_STYLE_RENAME',
  'PROFILE_STYLE_UPDATE',
  'PROFILE_STYLE_DELETE',
] as const;

const EXPECTED_SECTION_KEYS = [
  'SAMPLE_GROUP_CREATE',
  'SAMPLE_GROUP_RENAME',
  'SAMPLE_GROUP_DELETE',
  'SAMPLE_LINE_ADD',
  'SAMPLE_LINE_ADD_INTERVAL',
  'SAMPLE_LINE_UPDATE',
  'SAMPLE_LINE_DELETE',
  'SECTION_SOURCE_ADD',
  'SECTION_SOURCE_REMOVE',
  'SECTION_SOURCE_SET_STYLE',
  'SECTION_AREA_COMPARISON',
  'SECTION_STYLE_CREATE',
  'SECTION_STYLE_RENAME',
  'SECTION_STYLE_UPDATE',
  'SECTION_STYLE_DELETE',
  'SECTION_VIEW_CREATE',
  'SECTION_VIEW_UPDATE',
] as const;

type ProfileKey = (typeof EXPECTED_PROFILE_KEYS)[number];
type SectionKey = (typeof EXPECTED_SECTION_KEYS)[number];

// ---------------------------------------------------------------------------
// Independent baseline pins (STRUCT-195.5 review correction P2-2).
//
// These object-literal shapes are transcribed BY HAND from the pre-refactor
// hub (`git show 7127c5f4:src/engine/cad/cadTransactions.types.ts`): profile
// variants at lines ~998-1075, sample-line/section variants at ~1077-1191 and
// the standalone SECTION_VIEW_DELETE at ~1212-1215, plus the
// CadProfileViewUpdatePatch interface at ~84-95. They deliberately import no
// type from either leaf under test, so a drifted leaf (dropped optional,
// removed `| null`, renamed/added/removed field, changed union) can no longer
// move both sides of an assertion and stay green. Foreign referenced types
// (CadLayerId/CadProfileStyle/CadProfileStylePatch/CadSampleLinePatch/
// CadSectionStyle/CadSectionStylePatch/CadSectionViewPatch) are shared
// references, not part of the moved surface.
// ---------------------------------------------------------------------------

type BaseProfileCreate = {
  key: 'PROFILE_CREATE';
  name?: string;
  layerId?: CadLayerId;
  styleId?: string;
  alignmentEntityId: string;
  surfaceId: string;
  description?: string;
};

type BaseProfileRebuild = {
  key: 'PROFILE_REBUILD';
  profileId: string;
  name?: string;
  styleId?: string | null;
  alignmentEntityId?: string;
  surfaceId?: string;
  description?: string | null;
};

type BaseProfileDelete = {
  key: 'PROFILE_DELETE';
  profileId: string;
};

type BaseProfileViewCreate = {
  key: 'PROFILE_VIEW_CREATE';
  name?: string;
  alignmentEntityId: string;
  profileIds?: string[];
  insertionX?: number;
  insertionY?: number;
  width?: number;
  height?: number;
  horizontalScale?: number;
  verticalExaggeration?: number;
  datumElevation?: number;
  datumMode?: 'auto' | 'explicit';
  datumStep?: number;
  majorStationInterval?: number;
  minorStationInterval?: number;
  elevationGridInterval?: number;
  styleId?: string;
};

type BaseProfileViewUpdate = {
  key: 'PROFILE_VIEW_UPDATE';
  viewId: string;
  patch: BaseProfileViewUpdatePatch;
};

type BaseProfileViewDelete = {
  key: 'PROFILE_VIEW_DELETE';
  viewId: string;
};

type BaseProfileStyleCreate = {
  key: 'PROFILE_STYLE_CREATE';
  style: CadProfileStyle;
};

type BaseProfileStyleDuplicate = {
  key: 'PROFILE_STYLE_DUPLICATE';
  styleId: string;
  newId: string;
  name: string;
};

type BaseProfileStyleRename = {
  key: 'PROFILE_STYLE_RENAME';
  styleId: string;
  name: string;
};

type BaseProfileStyleUpdate = {
  key: 'PROFILE_STYLE_UPDATE';
  styleId: string;
  patch: CadProfileStylePatch;
};

type BaseProfileStyleDelete = {
  key: 'PROFILE_STYLE_DELETE';
  styleId: string;
  replacementId?: string;
};

interface BaseProfileViewUpdatePatch {
  horizontalScale?: number;
  verticalExaggeration?: number;
  datumMode?: 'auto' | 'explicit';
  datumElevation?: number;
  datumStep?: number;
  majorStationInterval?: number;
  minorStationInterval?: number;
  elevationGridInterval?: number;
  styleId?: string | null;
  name?: string;
}

type BaseSampleGroupCreate = {
  key: 'SAMPLE_GROUP_CREATE';
  name?: string;
  alignmentEntityId: string;
  layerId?: CadLayerId;
};

type BaseSampleGroupRename = {
  key: 'SAMPLE_GROUP_RENAME';
  groupId: string;
  name: string;
};

type BaseSampleGroupDelete = {
  key: 'SAMPLE_GROUP_DELETE';
  groupId: string;
};

type BaseSampleLineAdd = {
  key: 'SAMPLE_LINE_ADD';
  groupId: string;
  rawStation?: number;
  stationText?: string;
  leftWidth: number;
  rightWidth: number;
  skewDeg?: number;
  manualName?: string;
};

type BaseSampleLineAddInterval = {
  key: 'SAMPLE_LINE_ADD_INTERVAL';
  groupId: string;
  rawStart: number;
  rawEnd: number;
  interval: number;
  leftWidth: number;
  rightWidth: number;
  skewDeg?: number;
};

type BaseSampleLineUpdate = {
  key: 'SAMPLE_LINE_UPDATE';
  groupId: string;
  lineId: string;
  patch: CadSampleLinePatch;
};

type BaseSampleLineDelete = {
  key: 'SAMPLE_LINE_DELETE';
  groupId: string;
  lineId: string;
};

type BaseSectionSourceAdd = {
  key: 'SECTION_SOURCE_ADD';
  groupId: string;
  surfaceId: string;
  sectionStyleId?: string;
};

type BaseSectionSourceRemove = {
  key: 'SECTION_SOURCE_REMOVE';
  groupId: string;
  surfaceId: string;
};

type BaseSectionSourceSetStyle = {
  key: 'SECTION_SOURCE_SET_STYLE';
  groupId: string;
  surfaceId: string;
  sectionStyleId: string | null;
};

type BaseSectionAreaComparison = {
  key: 'SECTION_AREA_COMPARISON';
  groupId: string;
  baseSurfaceId?: string;
  comparisonSurfaceId?: string;
};

type BaseSectionStyleCreate = {
  key: 'SECTION_STYLE_CREATE';
  style: CadSectionStyle;
};

type BaseSectionStyleRename = {
  key: 'SECTION_STYLE_RENAME';
  styleId: string;
  name: string;
};

type BaseSectionStyleUpdate = {
  key: 'SECTION_STYLE_UPDATE';
  styleId: string;
  patch: CadSectionStylePatch;
};

type BaseSectionStyleDelete = {
  key: 'SECTION_STYLE_DELETE';
  styleId: string;
  replacementId?: string;
};

type BaseSectionViewCreate = {
  key: 'SECTION_VIEW_CREATE';
  sampleLineGroupId: string;
  sampleLineId: string;
  name?: string;
  sourceSurfaceIds?: string[];
  insertionX?: number;
  insertionY?: number;
  horizontalScale?: number;
  verticalExaggeration?: number;
  datumMode?: 'auto' | 'explicit';
  datumElevation?: number;
  offsetGridInterval?: number;
  elevationGridInterval?: number;
  showCutFill?: boolean;
  styleId?: string;
  layerId?: CadLayerId;
};

type BaseSectionViewUpdate = {
  key: 'SECTION_VIEW_UPDATE';
  viewId: string;
  patch: CadSectionViewPatch;
};

type BaseSectionViewDelete = {
  key: 'SECTION_VIEW_DELETE';
  viewId: string;
};

// Minimal samples proving every variant compiles with its required fields.
const profileSamples: CadProfileCommandPayload[] = [
  { key: 'PROFILE_CREATE', alignmentEntityId: 'align-1', surfaceId: 'surf-1' },
  { key: 'PROFILE_REBUILD', profileId: 'prof-1' },
  { key: 'PROFILE_DELETE', profileId: 'prof-1' },
  { key: 'PROFILE_VIEW_CREATE', alignmentEntityId: 'align-1' },
  { key: 'PROFILE_VIEW_UPDATE', viewId: 'view-1', patch: { name: 'renamed' } },
  { key: 'PROFILE_VIEW_DELETE', viewId: 'view-1' },
  {
    key: 'PROFILE_STYLE_CREATE',
    style: { id: 'st-1', name: 'S', color: '#000000', lineweight: 1, opacity: 0 },
  },
  { key: 'PROFILE_STYLE_DUPLICATE', styleId: 'st-1', newId: 'st-2', name: 'copy' },
  { key: 'PROFILE_STYLE_RENAME', styleId: 'st-1', name: 'renamed' },
  { key: 'PROFILE_STYLE_UPDATE', styleId: 'st-1', patch: { color: '#ffffff' } },
  { key: 'PROFILE_STYLE_DELETE', styleId: 'st-1' },
];

const sectionSamples: CadSectionCommandPayload[] = [
  { key: 'SAMPLE_GROUP_CREATE', alignmentEntityId: 'align-1' },
  { key: 'SAMPLE_GROUP_RENAME', groupId: 'g-1', name: 'renamed' },
  { key: 'SAMPLE_GROUP_DELETE', groupId: 'g-1' },
  { key: 'SAMPLE_LINE_ADD', groupId: 'g-1', leftWidth: 5, rightWidth: 5 },
  {
    key: 'SAMPLE_LINE_ADD_INTERVAL',
    groupId: 'g-1',
    rawStart: 0,
    rawEnd: 100,
    interval: 10,
    leftWidth: 5,
    rightWidth: 5,
  },
  { key: 'SAMPLE_LINE_UPDATE', groupId: 'g-1', lineId: 'l-1', patch: { leftWidth: 7 } },
  { key: 'SAMPLE_LINE_DELETE', groupId: 'g-1', lineId: 'l-1' },
  { key: 'SECTION_SOURCE_ADD', groupId: 'g-1', surfaceId: 'surf-1' },
  { key: 'SECTION_SOURCE_REMOVE', groupId: 'g-1', surfaceId: 'surf-1' },
  { key: 'SECTION_SOURCE_SET_STYLE', groupId: 'g-1', surfaceId: 'surf-1', sectionStyleId: null },
  { key: 'SECTION_AREA_COMPARISON', groupId: 'g-1' },
  {
    key: 'SECTION_STYLE_CREATE',
    style: { id: 'st-1', name: 'S', color: '#000000', lineweight: 1, opacity: 0 },
  },
  { key: 'SECTION_STYLE_RENAME', styleId: 'st-1', name: 'renamed' },
  { key: 'SECTION_STYLE_UPDATE', styleId: 'st-1', patch: { color: '#ffffff' } },
  { key: 'SECTION_STYLE_DELETE', styleId: 'st-1' },
  { key: 'SECTION_VIEW_CREATE', sampleLineGroupId: 'g-1', sampleLineId: 'l-1' },
  { key: 'SECTION_VIEW_UPDATE', viewId: 'view-1', patch: { showCutFill: true } },
];

const sectionViewDeleteSample: CadSectionViewDeleteCommand = {
  key: 'SECTION_VIEW_DELETE',
  viewId: 'view-1',
};

// Compile-time hub <-> leaf round trip (enforced by project typecheck).
const leafToHub = (
  payload: CadProfileCommandPayload | CadSectionCommandPayload | CadSectionViewDeleteCommand,
): CadCommand => payload;

// ---------------------------------------------------------------------------

describe('STRUCT-195.5 profile/section leaf key sets in exact union order', () => {
  it('pins the 11 profile keys in order with no duplication or gaps', () => {
    const keys = unionKeysInOrder(PROFILE_LEAF, 'CadProfileCommandPayload');
    expect(keys).toEqual([...EXPECTED_PROFILE_KEYS]);
    expect(new Set(keys).size).toBe(EXPECTED_PROFILE_KEYS.length);
  });

  it('pins the 17 section keys in order with no duplication or gaps', () => {
    const keys = unionKeysInOrder(SECTION_LEAF, 'CadSectionCommandPayload');
    expect(keys).toEqual([...EXPECTED_SECTION_KEYS]);
    expect(new Set(keys).size).toBe(EXPECTED_SECTION_KEYS.length);
  });

  it('keeps SECTION_VIEW_DELETE separate with its own key literal', () => {
    expect(interfaceKeyLiteral(SECTION_LEAF, 'CadSectionViewDeleteCommand')).toBe('SECTION_VIEW_DELETE');
    expect(unionKeysInOrder(SECTION_LEAF, 'CadSectionCommandPayload')).not.toContain('SECTION_VIEW_DELETE');
    expect(unionKeysInOrder(SECTION_LEAF, 'CadSectionCommandPayload')).not.toContain('LANDXML_IMPORT');
    expect(unionKeysInOrder(PROFILE_LEAF, 'CadProfileCommandPayload')).not.toContain('LANDXML_IMPORT');
  });

  it('compiles one minimal sample per key (required-field probe)', () => {
    expect(profileSamples.map((sample) => sample.key)).toEqual([...EXPECTED_PROFILE_KEYS]);
    expect(sectionSamples.map((sample) => sample.key)).toEqual([...EXPECTED_SECTION_KEYS]);
    expect(sectionViewDeleteSample.key).toBe('SECTION_VIEW_DELETE');
    expect(leafToHub(profileSamples[0]!)).toBe(profileSamples[0]);
    expect(leafToHub(sectionSamples[0]!)).toBe(sectionSamples[0]);
    expect(leafToHub(sectionViewDeleteSample)).toBe(sectionViewDeleteSample);
  });
});

describe('STRUCT-195.5 Extract<CadCommand> payload equivalence (drift-failing)', () => {
  it('matches the hub slice for every profile key', () => {
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_CREATE' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_CREATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_REBUILD' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_REBUILD' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_DELETE' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_DELETE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_VIEW_CREATE' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_VIEW_CREATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_VIEW_UPDATE' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_VIEW_UPDATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_VIEW_DELETE' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_VIEW_DELETE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_CREATE' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_CREATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_DUPLICATE' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_DUPLICATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_RENAME' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_RENAME' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_UPDATE' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_UPDATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_DELETE' }>>().toEqualTypeOf<
      Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_DELETE' }>
    >();
  });

  it('matches the hub slice for every section key plus the split delete', () => {
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_GROUP_CREATE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SAMPLE_GROUP_CREATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_GROUP_RENAME' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SAMPLE_GROUP_RENAME' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_GROUP_DELETE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SAMPLE_GROUP_DELETE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_LINE_ADD' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SAMPLE_LINE_ADD' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_LINE_ADD_INTERVAL' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SAMPLE_LINE_ADD_INTERVAL' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_LINE_UPDATE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SAMPLE_LINE_UPDATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_LINE_DELETE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SAMPLE_LINE_DELETE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_SOURCE_ADD' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_SOURCE_ADD' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_SOURCE_REMOVE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_SOURCE_REMOVE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_SOURCE_SET_STYLE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_SOURCE_SET_STYLE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_AREA_COMPARISON' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_AREA_COMPARISON' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_STYLE_CREATE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_STYLE_CREATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_STYLE_RENAME' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_STYLE_RENAME' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_STYLE_UPDATE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_STYLE_UPDATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_STYLE_DELETE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_STYLE_DELETE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_VIEW_CREATE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_VIEW_CREATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_VIEW_UPDATE' }>>().toEqualTypeOf<
      Extract<CadSectionCommandPayload, { key: 'SECTION_VIEW_UPDATE' }>
    >();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_VIEW_DELETE' }>>().toEqualTypeOf<CadSectionViewDeleteCommand>();
  });

  it('keeps the slice unions exactly the hub narrowing (no extra members)', () => {
    expectTypeOf<Extract<CadCommand, { key: ProfileKey }>>().toEqualTypeOf<CadProfileCommandPayload>();
    expectTypeOf<Extract<CadCommand, { key: SectionKey }>>().toEqualTypeOf<CadSectionCommandPayload>();
  });

  it('probes required fields that must survive extraction', () => {
    type ProfileCreate = Extract<CadProfileCommandPayload, { key: 'PROFILE_CREATE' }>;
    expectTypeOf<ProfileCreate['alignmentEntityId']>().toEqualTypeOf<string>();
    expectTypeOf<ProfileCreate['surfaceId']>().toEqualTypeOf<string>();
    type ViewUpdate = Extract<CadProfileCommandPayload, { key: 'PROFILE_VIEW_UPDATE' }>;
    expectTypeOf<ViewUpdate['viewId']>().toEqualTypeOf<string>();
    expectTypeOf<ViewUpdate['patch']>().toEqualTypeOf<LeafProfileViewUpdatePatch>();
    type Interval = Extract<CadSectionCommandPayload, { key: 'SAMPLE_LINE_ADD_INTERVAL' }>;
    expectTypeOf<Interval['rawStart']>().toEqualTypeOf<number>();
    expectTypeOf<Interval['interval']>().toEqualTypeOf<number>();
    type SetStyle = Extract<CadSectionCommandPayload, { key: 'SECTION_SOURCE_SET_STYLE' }>;
    expectTypeOf<SetStyle['sectionStyleId']>().toEqualTypeOf<string | null>();
  });
});

describe('STRUCT-195.5 independent baseline pins: profile payloads', () => {
  it('matches the pre-refactor hub shape for every profile key (hub and leaf)', () => {
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_CREATE' }>>().toEqualTypeOf<BaseProfileCreate>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_CREATE' }>>().toEqualTypeOf<BaseProfileCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_REBUILD' }>>().toEqualTypeOf<BaseProfileRebuild>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_REBUILD' }>>().toEqualTypeOf<BaseProfileRebuild>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_DELETE' }>>().toEqualTypeOf<BaseProfileDelete>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_DELETE' }>>().toEqualTypeOf<BaseProfileDelete>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_VIEW_CREATE' }>>().toEqualTypeOf<BaseProfileViewCreate>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_VIEW_CREATE' }>>().toEqualTypeOf<BaseProfileViewCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_VIEW_UPDATE' }>>().toEqualTypeOf<BaseProfileViewUpdate>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_VIEW_UPDATE' }>>().toEqualTypeOf<BaseProfileViewUpdate>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_VIEW_DELETE' }>>().toEqualTypeOf<BaseProfileViewDelete>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_VIEW_DELETE' }>>().toEqualTypeOf<BaseProfileViewDelete>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_CREATE' }>>().toEqualTypeOf<BaseProfileStyleCreate>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_CREATE' }>>().toEqualTypeOf<BaseProfileStyleCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_DUPLICATE' }>>().toEqualTypeOf<BaseProfileStyleDuplicate>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_DUPLICATE' }>>().toEqualTypeOf<BaseProfileStyleDuplicate>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_RENAME' }>>().toEqualTypeOf<BaseProfileStyleRename>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_RENAME' }>>().toEqualTypeOf<BaseProfileStyleRename>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_UPDATE' }>>().toEqualTypeOf<BaseProfileStyleUpdate>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_UPDATE' }>>().toEqualTypeOf<BaseProfileStyleUpdate>();
    expectTypeOf<Extract<CadCommand, { key: 'PROFILE_STYLE_DELETE' }>>().toEqualTypeOf<BaseProfileStyleDelete>();
    expectTypeOf<Extract<CadProfileCommandPayload, { key: 'PROFILE_STYLE_DELETE' }>>().toEqualTypeOf<BaseProfileStyleDelete>();
  });
});

describe('STRUCT-195.5 independent baseline pins: section payloads', () => {
  it('matches the pre-refactor hub shape for every section key (hub and leaf)', () => {
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_GROUP_CREATE' }>>().toEqualTypeOf<BaseSampleGroupCreate>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SAMPLE_GROUP_CREATE' }>>().toEqualTypeOf<BaseSampleGroupCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_GROUP_RENAME' }>>().toEqualTypeOf<BaseSampleGroupRename>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SAMPLE_GROUP_RENAME' }>>().toEqualTypeOf<BaseSampleGroupRename>();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_GROUP_DELETE' }>>().toEqualTypeOf<BaseSampleGroupDelete>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SAMPLE_GROUP_DELETE' }>>().toEqualTypeOf<BaseSampleGroupDelete>();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_LINE_ADD' }>>().toEqualTypeOf<BaseSampleLineAdd>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SAMPLE_LINE_ADD' }>>().toEqualTypeOf<BaseSampleLineAdd>();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_LINE_ADD_INTERVAL' }>>().toEqualTypeOf<BaseSampleLineAddInterval>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SAMPLE_LINE_ADD_INTERVAL' }>>().toEqualTypeOf<BaseSampleLineAddInterval>();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_LINE_UPDATE' }>>().toEqualTypeOf<BaseSampleLineUpdate>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SAMPLE_LINE_UPDATE' }>>().toEqualTypeOf<BaseSampleLineUpdate>();
    expectTypeOf<Extract<CadCommand, { key: 'SAMPLE_LINE_DELETE' }>>().toEqualTypeOf<BaseSampleLineDelete>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SAMPLE_LINE_DELETE' }>>().toEqualTypeOf<BaseSampleLineDelete>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_SOURCE_ADD' }>>().toEqualTypeOf<BaseSectionSourceAdd>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_SOURCE_ADD' }>>().toEqualTypeOf<BaseSectionSourceAdd>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_SOURCE_REMOVE' }>>().toEqualTypeOf<BaseSectionSourceRemove>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_SOURCE_REMOVE' }>>().toEqualTypeOf<BaseSectionSourceRemove>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_SOURCE_SET_STYLE' }>>().toEqualTypeOf<BaseSectionSourceSetStyle>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_SOURCE_SET_STYLE' }>>().toEqualTypeOf<BaseSectionSourceSetStyle>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_AREA_COMPARISON' }>>().toEqualTypeOf<BaseSectionAreaComparison>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_AREA_COMPARISON' }>>().toEqualTypeOf<BaseSectionAreaComparison>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_STYLE_CREATE' }>>().toEqualTypeOf<BaseSectionStyleCreate>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_STYLE_CREATE' }>>().toEqualTypeOf<BaseSectionStyleCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_STYLE_RENAME' }>>().toEqualTypeOf<BaseSectionStyleRename>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_STYLE_RENAME' }>>().toEqualTypeOf<BaseSectionStyleRename>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_STYLE_UPDATE' }>>().toEqualTypeOf<BaseSectionStyleUpdate>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_STYLE_UPDATE' }>>().toEqualTypeOf<BaseSectionStyleUpdate>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_STYLE_DELETE' }>>().toEqualTypeOf<BaseSectionStyleDelete>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_STYLE_DELETE' }>>().toEqualTypeOf<BaseSectionStyleDelete>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_VIEW_CREATE' }>>().toEqualTypeOf<BaseSectionViewCreate>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_VIEW_CREATE' }>>().toEqualTypeOf<BaseSectionViewCreate>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_VIEW_UPDATE' }>>().toEqualTypeOf<BaseSectionViewUpdate>();
    expectTypeOf<Extract<CadSectionCommandPayload, { key: 'SECTION_VIEW_UPDATE' }>>().toEqualTypeOf<BaseSectionViewUpdate>();
    expectTypeOf<Extract<CadCommand, { key: 'SECTION_VIEW_DELETE' }>>().toEqualTypeOf<BaseSectionViewDelete>();
    expectTypeOf<CadSectionViewDeleteCommand>().toEqualTypeOf<BaseSectionViewDelete>();
  });
});

describe('STRUCT-195.5 literal hub CadCommand union order', () => {
  it('orders profile -> section -> LANDXML -> delete -> block with no gaps', () => {
    const members = hubMemberOrder();
    const profileAt = members.indexOf('CadProfileCommandPayload');
    const sectionAt = members.indexOf('CadSectionCommandPayload');
    const landxmlAt = members.indexOf('LANDXML_IMPORT');
    const deleteAt = members.indexOf('CadSectionViewDeleteCommand');
    const blockAt = members.indexOf('BLOCK_CREATE');
    for (const [name, at] of [
      ['CadProfileCommandPayload', profileAt],
      ['CadSectionCommandPayload', sectionAt],
      ['LANDXML_IMPORT', landxmlAt],
      ['CadSectionViewDeleteCommand', deleteAt],
      ['BLOCK_CREATE', blockAt],
    ] as const) {
      expect(at, name).toBeGreaterThanOrEqual(0);
    }
    expect(sectionAt).toBe(profileAt + 1);
    expect(landxmlAt).toBe(sectionAt + 1);
    expect(deleteAt).toBe(landxmlAt + 1);
    expect(blockAt).toBe(deleteAt + 1);
  });

  it('keeps surface -> volume immediately before the profile slice', () => {
    const members = hubMemberOrder();
    const surfaceAt = members.indexOf('CadSurfaceCommandPayload');
    const volumeAt = members.indexOf('CadVolumeCommandPayload');
    const profileAt = members.indexOf('CadProfileCommandPayload');
    expect(surfaceAt).toBeGreaterThanOrEqual(0);
    expect(volumeAt).toBe(surfaceAt + 1);
    expect(profileAt).toBe(volumeAt + 1);
  });
});

describe('STRUCT-195.5 CadProfileViewUpdatePatch dual-path import', () => {
  it('is re-exported from the hub with an identical shape', () => {
    expectTypeOf<HubProfileViewUpdatePatch>().toEqualTypeOf<LeafProfileViewUpdatePatch>();
    expectTypeOf<HubProfileViewUpdatePatch>().toEqualTypeOf<BaseProfileViewUpdatePatch>();
    expectTypeOf<LeafProfileViewUpdatePatch>().toEqualTypeOf<BaseProfileViewUpdatePatch>();
    const patch: LeafProfileViewUpdatePatch = {
      horizontalScale: 50,
      verticalExaggeration: 5,
      datumMode: 'explicit',
      datumElevation: 100,
      styleId: null,
      name: 'view',
    };
    const viaHub: HubProfileViewUpdatePatch = patch;
    const viaLeaf: LeafProfileViewUpdatePatch = viaHub;
    expect(viaLeaf).toBe(patch);
    expectTypeOf<LeafProfileViewUpdatePatch['datumMode']>().toEqualTypeOf<'auto' | 'explicit' | undefined>();
    expectTypeOf<LeafProfileViewUpdatePatch['styleId']>().toEqualTypeOf<string | null | undefined>();
  });
});

describe('STRUCT-195.5 leaves are type-only', () => {
  it.each([
    ['profile', PROFILE_LEAF],
    ['section', SECTION_LEAF],
  ])('%s leaf has zero runtime imports and zero value declarations', (_label, file) => {
    expect(runtimeImportSpecifiers(file)).toEqual([]);
    expect(hasOnlyTypeImports(file)).toBe(true);
    expect(valueStatementKinds(file)).toEqual([]);
  });

  it('profile leaf imports only the three allowed type modules', () => {
    expect(allImportSpecifiers(PROFILE_LEAF)).toEqual([
      './cadCorePrimitiveTypes',
      './cadTypes',
      './cadProfileTypes',
    ]);
  });

  it('section leaf imports only the three allowed type modules', () => {
    expect(allImportSpecifiers(SECTION_LEAF)).toEqual([
      './cadCorePrimitiveTypes',
      './cadTypes',
      './cadSectionTypes',
    ]);
  });

  it('neither leaf touches the hub, a transaction module, or a barrel', () => {
    const forbidden = [
      './cadTransactions.types',
      './cadTransactions',
      './cadTransactionsProfileCommands',
      './cadTransactionsSectionCommands',
    ];
    for (const file of [PROFILE_LEAF, SECTION_LEAF]) {
      for (const specifier of forbidden) {
        expect(allImportSpecifiers(file)).not.toContain(specifier);
      }
    }
  });
});

describe('STRUCT-195.5 no leaf back-edge to the transaction hub', () => {
  const files = ['src/engine/cad', 'src/engine/fieldToFinish'].flatMap((dir) =>
    collectTypeScriptFiles(path.join(REPO_ROOT, dir)),
  );
  const graph = buildGraphs(files.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
  const kindsBetween = (from: string, to: string): string[] =>
    graph.edges
      .filter((edge) => edge.from === path.resolve(REPO_ROOT, from) && edge.to === path.resolve(REPO_ROOT, to))
      .map((edge) => edge.kind);

  it('has no edge of any kind from either leaf back to the hub', () => {
    for (const leaf of [
      'src/engine/cad/cadTransactionsProfileCommandTypes.ts',
      'src/engine/cad/cadTransactionsSectionCommandTypes.ts',
    ]) {
      for (const hub of [
        'src/engine/cad/cadTransactions.types.ts',
        'src/engine/cad/cadTransactions.ts',
      ]) {
        expect(kindsBetween(leaf, hub)).toEqual([]);
      }
    }
  });

  it('emits only type edges out of either leaf', () => {
    for (const leaf of [
      'src/engine/cad/cadTransactionsProfileCommandTypes.ts',
      'src/engine/cad/cadTransactionsSectionCommandTypes.ts',
    ]) {
      const outgoing = graph.edges.filter((edge) => edge.from === path.resolve(REPO_ROOT, leaf));
      expect(outgoing.length).toBeGreaterThan(0);
      for (const edge of outgoing) expect(edge.kind).toBe('type');
    }
  });
});
