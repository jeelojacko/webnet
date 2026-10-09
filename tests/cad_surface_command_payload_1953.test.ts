/**
 * STRUCT-195.3 (Worker A) — surface/bake/compose command payload type leaf.
 *
 * Pins `src/engine/cad/cadTransactionsSurfaceCommandTypes.ts`:
 *  - exactly the 34 ordered SURFACE_* / SURFBAKE_* / SURFCOMPOSE_* tagged
 *    variants (SURFACE_CREATE .. SURFCOMPOSEPASTE), verbatim bodies, comments
 *    and optionality extracted from the `CadCommand` union;
 *  - type-only imports (no runtime value edge, no barrel aggregation);
 *  - bidirectional assignability with the `CadCommand` union slice and
 *    `Extract<CadCommand, { key }>` narrowing for the edit/bake/compose keys;
 *  - payload shapes: nested `Omit<Extract<CadSurfaceEdit, …>, 'id'>` union,
 *    `CadSurfaceStyle` Pick patch + nullable description, optional
 *    `sessionCurrent` / `*ExpectedRevision` gates, compose topology arrays.
 *
 * Assignability is enforced by project typecheck; AST checks enforce the
 * structural contract; the runtime checks prove payload shapes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { CadSurfaceCommandPayload } from '../src/engine/cad/cadTransactionsSurfaceCommandTypes';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type {
  CadSurfaceBoundary,
  CadSurfaceDefinition,
  CadSurfaceEdit,
  CadSurfaceStyle,
} from '../src/engine/cad/cadTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEAF = path.join(REPO_ROOT, 'src', 'engine', 'cad', 'cadTransactionsSurfaceCommandTypes.ts');

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

/** Import specifiers (any kind) for the leaf, in source order. */
const allImportSpecifiers = (file: string): string[] =>
  parse(file).statements
    .filter((stmt): stmt is ts.ImportDeclaration =>
      ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

/** Ordered `key` string literals of every object variant in the alias union. */
const surfaceKeysInOrder = (file: string): string[] => {
  const alias = parse(file).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'CadSurfaceCommandPayload',
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

const EXPECTED_KEYS = [
  'SURFACE_CREATE',
  'SURFACE_DELETE',
  'SURFACE_RENAME',
  'SURFACE_SET_LAYER_STYLE',
  'SURFACE_ADD_POINT_GROUP',
  'SURFACE_REMOVE_POINT_GROUP',
  'SURFACE_ADD_POINTS',
  'SURFACE_REMOVE_SOURCE',
  'SURFACE_ADD_BREAKLINE',
  'SURFACE_REMOVE_BREAKLINE',
  'SURFACE_RENAME_BREAKLINE',
  'SURFACE_BREAKLINE_INSERT_POINT',
  'SURFACE_BREAKLINE_REMOVE_POINT',
  'SURFACE_BREAKLINE_REVERSE',
  'SURFACE_BREAKLINE_REPLACE_CHAIN',
  'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN',
  'SURFACE_ADD_BOUNDARY',
  'SURFACE_REMOVE_BOUNDARY',
  'SURFACE_CREATE_BOUNDARY_SOURCE',
  'SURFACE_REPLACE_BOUNDARY_SOURCE',
  'SURFACE_MAKE_BOUNDARY_INDEPENDENT',
  'SURFACE_ADD_EDIT',
  'SURFACE_DELETE_EDIT',
  'SURFACE_MOVE_EDIT',
  'SURFACE_SET_EDIT_ENABLED',
  'SURFACE_STYLE_CREATE',
  'SURFACE_STYLE_DUPLICATE',
  'SURFACE_STYLE_RENAME',
  'SURFACE_STYLE_UPDATE',
  'SURFACE_STYLE_DELETE',
  'SURFBAKE',
  'SURFBAKECOPY',
  'SURFCOMPOSE',
  'SURFCOMPOSEPASTE',
] as const;

const styleSample: CadSurfaceStyle = {
  id: 'surface-style-eg',
  name: 'Existing Ground',
  color: '#4c9f70',
  opacity: 0.75,
  showTriangles: true,
  showContours: true,
  contourLabelPrecision: 2,
};

type SurfaceVariant<K extends CadSurfaceCommandPayload['key']> = Extract<CadSurfaceCommandPayload, { key: K }>;

// Compile-time bidirectional assignment (CadCommand superset <-> surface slice).
const leafToHub = (payload: CadSurfaceCommandPayload): CadCommand => payload;
const hubSurfaceToLeaf = (
  command: Extract<CadCommand, { key: CadSurfaceCommandPayload['key'] }>,
): CadSurfaceCommandPayload => command;

// One shape-typed sample per key proves every variant compiles and serializes.
const samples: CadSurfaceCommandPayload[] = [
  { key: 'SURFACE_CREATE', name: 'EG', pointSource: { kind: 'points', pointEntityIds: ['p1'] } },
  { key: 'SURFACE_DELETE', surfaceId: 's1' },
  { key: 'SURFACE_RENAME', surfaceId: 's1', name: 'Ground' },
  { key: 'SURFACE_SET_LAYER_STYLE', surfaceId: 's1', styleId: null },
  { key: 'SURFACE_ADD_POINT_GROUP', surfaceId: 's1', pointGroupId: 'pg1' },
  { key: 'SURFACE_REMOVE_POINT_GROUP', surfaceId: 's1', pointGroupId: 'pg1' },
  { key: 'SURFACE_ADD_POINTS', surfaceId: 's1', pointIds: ['p1', 'p2'] },
  { key: 'SURFACE_REMOVE_SOURCE', surfaceId: 's1' },
  { key: 'SURFACE_ADD_BREAKLINE', surfaceId: 's1', pointIds: ['p1', 'p2'], name: 'ridge' },
  { key: 'SURFACE_REMOVE_BREAKLINE', surfaceId: 's1', breaklineId: 'bl1' },
  { key: 'SURFACE_RENAME_BREAKLINE', surfaceId: 's1', breaklineId: 'bl1', name: 'edge' },
  {
    key: 'SURFACE_BREAKLINE_INSERT_POINT',
    surfaceId: 's1',
    breaklineId: 'bl1',
    pointEntityId: 'p3',
    insertIndex: 1,
  },
  { key: 'SURFACE_BREAKLINE_REMOVE_POINT', surfaceId: 's1', breaklineId: 'bl1', index: 1 },
  { key: 'SURFACE_BREAKLINE_REVERSE', surfaceId: 's1', breaklineId: 'bl1' },
  {
    key: 'SURFACE_BREAKLINE_REPLACE_CHAIN',
    surfaceId: 's1',
    breaklineId: 'bl1',
    pointEntityIds: ['p1', 'p2', 'p3'],
  },
  { key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN', surfaceId: 's1', breaklineId: 'bl1' },
  { key: 'SURFACE_ADD_BOUNDARY', surfaceId: 's1', kind: 'outer', sourceEntityId: 'e1' },
  { key: 'SURFACE_REMOVE_BOUNDARY', surfaceId: 's1', kind: 'void', sourceEntityId: 'e2' },
  {
    key: 'SURFACE_CREATE_BOUNDARY_SOURCE',
    surfaceId: 's1',
    kind: 'void',
    vertices: [{ x: 1, y: 2 }],
    replaceVoidSourceEntityId: 'e3',
  },
  { key: 'SURFACE_REPLACE_BOUNDARY_SOURCE', surfaceId: 's1', kind: 'outer', sourceEntityId: 'e4' },
  { key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT', surfaceId: 's1', kind: 'outer' },
  {
    key: 'SURFACE_ADD_EDIT',
    surfaceId: 's1',
    edit: { kind: 'add-point', x: 1, y: 2, z: 3 },
    expectedRevision: 'rev-1',
  },
  { key: 'SURFACE_DELETE_EDIT', surfaceId: 's1', editId: 'ed1', expectedRevision: 'rev-1' },
  { key: 'SURFACE_MOVE_EDIT', surfaceId: 's1', editId: 'ed1', direction: 'up', expectedRevision: 'rev-1' },
  { key: 'SURFACE_SET_EDIT_ENABLED', surfaceId: 's1', editId: 'ed1', enabled: false, expectedRevision: 'rev-1' },
  { key: 'SURFACE_STYLE_CREATE', style: styleSample },
  { key: 'SURFACE_STYLE_DUPLICATE', styleId: 's1', newId: 's2', name: 'Copy' },
  { key: 'SURFACE_STYLE_RENAME', styleId: 's1', name: 'Renamed' },
  { key: 'SURFACE_STYLE_UPDATE', styleId: 's1', patch: { showContours: false, description: null } },
  { key: 'SURFACE_STYLE_DELETE', styleId: 's1', replacementId: 's2' },
  { key: 'SURFBAKE', surfaceId: 's1', expectedRevision: 'rev-1' },
  { key: 'SURFBAKECOPY', surfaceId: 's1', expectedRevision: 'rev-1', sessionCurrent: true },
  {
    key: 'SURFCOMPOSE',
    baseSurfaceId: 's1',
    baseExpectedRevision: 'rev-1',
    overlaySurfaceId: 's2',
    overlayExpectedRevision: 'rev-2',
    vertices: [0, 0, 1, 1, 0, 1, 0, 1, 1],
    faces: [0, 1, 2],
    policy: 'overlay-wins',
  },
  {
    key: 'SURFCOMPOSEPASTE',
    targetSurfaceId: 's1',
    targetExpectedRevision: 'rev-1',
    sourceSurfaceId: 's2',
    sourceExpectedRevision: 'rev-2',
    vertices: [0, 0, 1, 1, 0, 1, 0, 1, 1],
    faces: [0, 1, 2],
    policy: 'paste-replace',
    sessionCurrent: true,
  },
];

describe('STRUCT-195.3 surface payload leaf structure', () => {
  it('declares the 34 SURFACE_*/SURFBAKE*/SURFCOMPOSE* keys in original order', () => {
    expect(EXPECTED_KEYS).toHaveLength(34);
    expect(surfaceKeysInOrder(LEAF)).toEqual([...EXPECTED_KEYS]);
  });

  it('is runtime-import-free (all edges type-only)', () => {
    expect(runtimeImportSpecifiers(LEAF)).toEqual([]);
    expect(allImportSpecifiers(LEAF)).toEqual(['./cadCorePrimitiveTypes', './cadTypes']);
  });

  it('declares only the single exported payload alias (no values/interfaces)', () => {
    const statements = parse(LEAF).statements;
    const valueKinds = statements.filter((stmt) =>
      ts.isFunctionDeclaration(stmt)
      || ts.isVariableStatement(stmt)
      || ts.isClassDeclaration(stmt)
      || ts.isEnumDeclaration(stmt));
    expect(valueKinds.map((stmt) => ts.SyntaxKind[stmt.kind])).toEqual([]);

    const typeAliases = statements
      .filter((stmt): stmt is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(stmt))
      .map((stmt) => stmt.name.text);
    expect(typeAliases).toEqual(['CadSurfaceCommandPayload']);

    const interfaces = statements
      .filter((stmt): stmt is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(stmt))
      .map((stmt) => stmt.name.text);
    expect(interfaces).toEqual([]);
  });
});

describe('STRUCT-195.3 surface payload assignability (enforced at typecheck)', () => {
  it('keeps the leaf as the hub SURFACE slice in both directions', () => {
    expectTypeOf<CadSurfaceCommandPayload>().toExtend<CadCommand>();
    expectTypeOf<Extract<CadCommand, { key: CadSurfaceCommandPayload['key'] }>>()
      .toEqualTypeOf<CadSurfaceCommandPayload>();
  });

  it('narrows SURFACE_ADD_EDIT / SURFBAKE / SURFCOMPOSEPASTE through the hub', () => {
    expectTypeOf<Extract<CadCommand, { key: 'SURFACE_ADD_EDIT' }>>()
      .toEqualTypeOf<SurfaceVariant<'SURFACE_ADD_EDIT'>>();
    expectTypeOf<Extract<CadCommand, { key: 'SURFBAKE' }>>()
      .toEqualTypeOf<SurfaceVariant<'SURFBAKE'>>();
    expectTypeOf<Extract<CadCommand, { key: 'SURFCOMPOSEPASTE' }>>()
      .toEqualTypeOf<SurfaceVariant<'SURFCOMPOSEPASTE'>>();
  });

  it('round-trips both assignment directions at runtime', () => {
    for (const sample of samples) {
      expect(leafToHub(sample)).toBe(sample);
      expect(hubSurfaceToLeaf(sample)).toBe(sample);
    }
  });
});

describe('STRUCT-195.3 surface payload shapes', () => {
  it('models SURFACE_ADD_EDIT as an id-less CadSurfaceEdit union (11 kinds)', () => {
    type EditPayload = SurfaceVariant<'SURFACE_ADD_EDIT'>['edit'];
    type ExpectedEditPayload =
      | Omit<Extract<CadSurfaceEdit, { kind: 'swap-edge' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'add-line' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'delete-line' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'add-point' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'delete-point' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'move-point' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'set-elevation' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'raise-lower-surface' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'set-elevation-many' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'raise-lower-points' }>, 'id'>
      | Omit<Extract<CadSurfaceEdit, { kind: 'move-points' }>, 'id'>;
    expectTypeOf<EditPayload>().toEqualTypeOf<ExpectedEditPayload>();
    type EditHasId = 'id' extends keyof EditPayload ? true : false;
    expectTypeOf<EditHasId>().toEqualTypeOf<false>();
    expectTypeOf<SurfaceVariant<'SURFACE_ADD_EDIT'>['expectedRevision']>().toEqualTypeOf<string>();
  });

  it('keeps the stale-revision gate required on bake and edit commands', () => {
    for (const key of ['SURFBAKE', 'SURFBAKECOPY', 'SURFACE_DELETE_EDIT', 'SURFACE_MOVE_EDIT', 'SURFACE_SET_EDIT_ENABLED'] as const) {
      expectTypeOf<SurfaceVariant<typeof key>['expectedRevision']>().toEqualTypeOf<string>();
    }
    expectTypeOf<SurfaceVariant<'SURFCOMPOSE'>['baseExpectedRevision']>().toEqualTypeOf<string>();
    expectTypeOf<SurfaceVariant<'SURFCOMPOSE'>['overlayExpectedRevision']>().toEqualTypeOf<string>();
    expectTypeOf<SurfaceVariant<'SURFCOMPOSEPASTE'>['targetExpectedRevision']>().toEqualTypeOf<string>();
    expectTypeOf<SurfaceVariant<'SURFCOMPOSEPASTE'>['sourceExpectedRevision']>().toEqualTypeOf<string>();
  });

  it('keeps sessionCurrent an optional boolean on all four bake/compose keys', () => {
    for (const key of ['SURFBAKE', 'SURFBAKECOPY', 'SURFCOMPOSE', 'SURFCOMPOSEPASTE'] as const) {
      expectTypeOf<NonNullable<SurfaceVariant<typeof key>['sessionCurrent']>>().toEqualTypeOf<boolean>();
    }
    const omitted: SurfaceVariant<'SURFBAKE'> = { key: 'SURFBAKE', surfaceId: 's1', expectedRevision: 'rev-1' };
    expect('sessionCurrent' in omitted).toBe(false);
    const asserted: SurfaceVariant<'SURFBAKECOPY'> = {
      key: 'SURFBAKECOPY',
      surfaceId: 's1',
      expectedRevision: 'rev-1',
      sessionCurrent: false,
    };
    expect(asserted.sessionCurrent).toBe(false);
  });

  it('keeps compose topology arrays as flat number arrays with a string policy', () => {
    for (const key of ['SURFCOMPOSE', 'SURFCOMPOSEPASTE'] as const) {
      expectTypeOf<SurfaceVariant<typeof key>['vertices']>().toEqualTypeOf<number[]>();
      expectTypeOf<SurfaceVariant<typeof key>['faces']>().toEqualTypeOf<number[]>();
      expectTypeOf<SurfaceVariant<typeof key>['policy']>().toEqualTypeOf<string>();
    }
    const compose = samples.find(
      (sample): sample is SurfaceVariant<'SURFCOMPOSE'> => sample.key === 'SURFCOMPOSE',
    );
    expect(compose?.vertices.length).toBe(9);
    expect(compose?.faces).toEqual([0, 1, 2]);
  });

  it('types SURFACE_CREATE against the CadSurfaceDefinition sub-shapes', () => {
    type Create = SurfaceVariant<'SURFACE_CREATE'>;
    expectTypeOf<NonNullable<Create['pointSource']>>().toEqualTypeOf<CadSurfaceDefinition['pointSource']>();
    expectTypeOf<NonNullable<Create['buildOptions']>>().toEqualTypeOf<NonNullable<CadSurfaceDefinition['buildOptions']>>();
    const minimal: Create = { key: 'SURFACE_CREATE' };
    expect('pointSource' in minimal).toBe(false);
    expect('layerId' in minimal).toBe(false);
  });

  it('types SURFACE_ADD_BOUNDARY kind against the CadSurfaceBoundary union', () => {
    type BoundaryKind = SurfaceVariant<'SURFACE_ADD_BOUNDARY'>['kind'];
    expectTypeOf<BoundaryKind>().toEqualTypeOf<CadSurfaceBoundary['type']>();
    expectTypeOf<BoundaryKind>().toEqualTypeOf<'outer' | 'void'>();
    type IndependentSource = SurfaceVariant<'SURFACE_MAKE_BOUNDARY_INDEPENDENT'>['sourceEntityId'];
    expectTypeOf<NonNullable<IndependentSource>>().toEqualTypeOf<string>();
  });

  it('types SURFACE_STYLE_CREATE against CadSurfaceStyle and the UPDATE patch as a Pick + nullable description', () => {
    expectTypeOf<SurfaceVariant<'SURFACE_STYLE_CREATE'>['style']>().toEqualTypeOf<CadSurfaceStyle>();
    type StylePatch = SurfaceVariant<'SURFACE_STYLE_UPDATE'>['patch'];
    type ExpectedPatch = Pick<
      CadSurfaceStyle,
      | 'color'
      | 'opacity'
      | 'showTriangles'
      | 'showContours'
      | 'showPoints'
      | 'showBoundary'
      | 'minorContourInterval'
      | 'majorContourEvery'
      | 'contourBaseElevation'
      | 'minorContour'
      | 'majorContour'
      | 'showContourLabels'
      | 'labelMajorOnly'
      | 'contourLabelSpacing'
      | 'contourLabelPrecision'
    > & { description?: string | null };
    expectTypeOf<StylePatch>().toEqualTypeOf<ExpectedPatch>();
    // `id`/`name` are intentionally NOT patchable.
    type PatchHasId = 'id' extends keyof StylePatch ? true : false;
    type PatchHasName = 'name' extends keyof StylePatch ? true : false;
    expectTypeOf<PatchHasId>().toEqualTypeOf<false>();
    expectTypeOf<PatchHasName>().toEqualTypeOf<false>();
    const nullable: StylePatch = { description: null };
    const omitted: StylePatch = { color: '#fff' };
    expect(nullable.description).toBeNull();
    expect('description' in omitted).toBe(false);
  });

  it('models undefined = leave vs null = clear on SURFACE_SET_LAYER_STYLE', () => {
    type LayerStyle = SurfaceVariant<'SURFACE_SET_LAYER_STYLE'>;
    expectTypeOf<NonNullable<LayerStyle['styleId']>>().toEqualTypeOf<string>();
    const leave: LayerStyle = { key: 'SURFACE_SET_LAYER_STYLE', surfaceId: 's1' };
    const clear: LayerStyle = { ...leave, styleId: null };
    const set: LayerStyle = { ...leave, styleId: 'style-1' };
    expect('styleId' in leave).toBe(false);
    expect(clear.styleId).toBeNull();
    expect(set.styleId).toBe('style-1');
  });

  it('serializes every sample command unchanged through JSON', () => {
    for (const sample of samples) {
      expect(JSON.parse(JSON.stringify(sample))).toEqual(sample);
    }
    expect(samples.map((sample) => sample.key)).toEqual([...EXPECTED_KEYS]);
  });
});
