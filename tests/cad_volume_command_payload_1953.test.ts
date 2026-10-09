/**
 * STRUCT-195.3 (Worker B) — volume command payload type leaf.
 *
 * Pins `src/engine/cad/cadTransactionsVolumeCommandTypes.ts`:
 *  - exactly the nine ordered VOLUME_* tagged variants, verbatim bodies,
 *    comments and optionality (VOLUME_SURFACE_CREATE .. VOLUME_STYLE_DELETE);
 *  - type-only imports (no runtime value edge, no barrel aggregation);
 *  - bidirectional assignability with the `CadCommand` union slice and
 *    `Extract<CadCommand, { key: 'VOLUME_STYLE_UPDATE' }>` narrowing;
 *  - sample-command JSON serialization round-trips unchanged.
 *
 * Assignability is enforced by project typecheck; AST checks enforce the
 * structural contract; the runtime checks prove payload shapes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import type { CadVolumeCommandPayload } from '../src/engine/cad/cadTransactionsVolumeCommandTypes';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadVolumeSurfaceStyle } from '../src/engine/cad/cadTypes';
import type { CadVolumeSurfaceStylePatch } from '../src/engine/cad/cadVolumeSurfaces';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LEAF = path.join(REPO_ROOT, 'src', 'engine', 'cad', 'cadTransactionsVolumeCommandTypes.ts');

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Module specifiers reached by a runtime (non-`import type`) edge. */
const runtimeImportSpecifiers = (file: string): string[] => {
  const out: string[] = [];
  for (const stmt of parse(file).statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (!clause) { out.push(stmt.moduleSpecifier.text); continue; }
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
const volumeKeysInOrder = (file: string): string[] => {
  const alias = parse(file).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'CadVolumeCommandPayload',
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
  'VOLUME_SURFACE_CREATE',
  'VOLUME_SURFACE_DELETE',
  'VOLUME_SURFACE_UPDATE_SOURCES',
  'VOLUME_SURFACE_SET_LAYER_STYLE',
  'VOLUME_STYLE_CREATE',
  'VOLUME_STYLE_DUPLICATE',
  'VOLUME_STYLE_RENAME',
  'VOLUME_STYLE_UPDATE',
  'VOLUME_STYLE_DELETE',
] as const;

const styleSample: CadVolumeSurfaceStyle = {
  id: 'volume-style-cut-fill',
  name: 'Cut/Fill',
  showCut: true,
  showFill: true,
  cutColor: '#d64545',
  fillColor: '#3d7dd6',
  opacity: 0.5,
};

const samples: CadVolumeCommandPayload[] = [
  { key: 'VOLUME_SURFACE_CREATE', baseSurfaceId: 'base', comparisonSurfaceId: 'comp' },
  { key: 'VOLUME_SURFACE_DELETE', volumeSurfaceId: 'vol-1' },
  { key: 'VOLUME_SURFACE_UPDATE_SOURCES', volumeSurfaceId: 'vol-1', baseSurfaceId: 'base', comparisonSurfaceId: 'comp' },
  { key: 'VOLUME_SURFACE_SET_LAYER_STYLE', volumeSurfaceId: 'vol-1', styleId: null },
  { key: 'VOLUME_STYLE_CREATE', style: styleSample },
  { key: 'VOLUME_STYLE_DUPLICATE', styleId: 's1', newId: 's2', name: 'Copy' },
  { key: 'VOLUME_STYLE_RENAME', styleId: 's1', name: 'Renamed' },
  { key: 'VOLUME_STYLE_UPDATE', styleId: 's1', patch: { opacity: 0.5 } },
  { key: 'VOLUME_STYLE_DELETE', styleId: 's1', replacementId: 's2' },
];

// Compile-time bidirectional assignment (CadCommand superset <-> volume slice).
const leafToHub = (payload: CadVolumeCommandPayload): CadCommand => payload;
const hubVolumeToLeaf = (
  command: Extract<CadCommand, { key: CadVolumeCommandPayload['key'] }>,
): CadVolumeCommandPayload => command;

describe('STRUCT-195.3 volume payload leaf structure', () => {
  it('declares the nine VOLUME_* keys in original order', () => {
    expect(volumeKeysInOrder(LEAF)).toEqual([...EXPECTED_KEYS]);
  });

  it('is runtime-import-free (all edges type-only)', () => {
    expect(runtimeImportSpecifiers(LEAF)).toEqual([]);
    expect(allImportSpecifiers(LEAF).sort()).toEqual([
      './cadCorePrimitiveTypes',
      './cadTypes',
      './cadVolumeSurfaces',
    ]);
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
    expect(typeAliases).toEqual(['CadVolumeCommandPayload']);

    const interfaces = statements
      .filter((stmt): stmt is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(stmt))
      .map((stmt) => stmt.name.text);
    expect(interfaces).toEqual([]);
  });
});

type HubVolumeSlice = Extract<CadCommand, { key: CadVolumeCommandPayload['key'] }>;
type HubStyleUpdate = Extract<CadCommand, { key: 'VOLUME_STYLE_UPDATE' }>;
type LeafStyleUpdate = Extract<CadVolumeCommandPayload, { key: 'VOLUME_STYLE_UPDATE' }>;

describe('STRUCT-195.3 volume payload assignability (enforced at typecheck)', () => {
  it('keeps the leaf as the hub VOLUME slice in both directions', () => {
    // `toExtend` both ways == type equality; avoids expect-type's union
    // `toEqualTypeOf` branding limitation for the multi-variant slice.
    expectTypeOf<CadVolumeCommandPayload>().toExtend<HubVolumeSlice>();
    expectTypeOf<HubVolumeSlice>().toExtend<CadVolumeCommandPayload>();
  });

  it('narrows VOLUME_STYLE_UPDATE through the hub to the exact leaf variant', () => {
    expectTypeOf<HubStyleUpdate>().toExtend<LeafStyleUpdate>();
    expectTypeOf<LeafStyleUpdate>().toExtend<HubStyleUpdate>();
    expectTypeOf<HubStyleUpdate['patch']>().toEqualTypeOf<CadVolumeSurfaceStylePatch>();
  });

  it('keeps the style payload typed against CadVolumeSurfaceStyle', () => {
    expectTypeOf<Extract<CadVolumeCommandPayload, { key: 'VOLUME_STYLE_CREATE' }>['style']>()
      .toEqualTypeOf<CadVolumeSurfaceStyle>();
  });

  it('round-trips both assignment directions at runtime', () => {
    for (const sample of samples) {
      expect(leafToHub(sample)).toBe(sample);
      expect(hubVolumeToLeaf(sample)).toBe(sample);
    }
  });
});

describe('STRUCT-195.3 payload shapes and serialization', () => {
  it('models undefined = leave vs null = clear on the layer-style field', () => {
    const leave: Extract<CadVolumeCommandPayload, { key: 'VOLUME_SURFACE_SET_LAYER_STYLE' }> = {
      key: 'VOLUME_SURFACE_SET_LAYER_STYLE',
      volumeSurfaceId: 'vol-1',
    };
    const clear: typeof leave = { ...leave, styleId: null };
    const set: typeof leave = { ...leave, styleId: 'style-1' };
    expect('styleId' in leave).toBe(false);
    expect(clear.styleId).toBeNull();
    expect(set.styleId).toBe('style-1');
  });

  it('keeps optional create/delete replacement fields as string-only optionals', () => {
    const create: Extract<CadVolumeCommandPayload, { key: 'VOLUME_SURFACE_CREATE' }> = {
      key: 'VOLUME_SURFACE_CREATE',
      baseSurfaceId: 'base',
      comparisonSurfaceId: 'comp',
    };
    const remove: Extract<CadVolumeCommandPayload, { key: 'VOLUME_STYLE_DELETE' }> = {
      key: 'VOLUME_STYLE_DELETE',
      styleId: 'style-1',
    };
    expect('layerId' in create).toBe(false);
    expect('styleId' in create).toBe(false);
    expect('replacementId' in remove).toBe(false);
  });

  it('serializes every sample command unchanged through JSON', () => {
    for (const sample of samples) {
      expect(JSON.parse(JSON.stringify(sample))).toEqual(sample);
    }
    expect(samples.map((sample) => sample.key)).toEqual([...EXPECTED_KEYS]);
  });
});
