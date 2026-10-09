// STRUCT-195.2 — CAD core primitive type leaf identity + import-free guard.
//
// Proves the extracted leaf is structurally identical to the declarations it
// replaced (assignable both ways via `expectTypeOf` and runtime round-trips),
// that the original `cadTypes` names are preserved/re-exported, and that the
// leaf itself stays import-free and type-only (AST).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { parseImports } from '../scripts/cadTypeImportGraph.mjs';
import type {
  CadBounds as LeafBounds,
  CadEntityId as LeafEntityId,
  CadLayer as LeafLayer,
  CadLayerId as LeafLayerId,
  CadLineTypeId as LeafLineTypeId,
  CadPointSymbolId as LeafPointSymbolId,
  CadPointSymbolShape as LeafPointSymbolShape,
  CadStyleId as LeafStyleId,
  CadTextStyleId as LeafTextStyleId,
} from '../src/engine/cad/cadCorePrimitiveTypes';
import type {
  CadBounds as TypesBounds,
  CadEntityId as TypesEntityId,
  CadLayer as TypesLayer,
  CadLayerId as TypesLayerId,
  CadLineTypeId as TypesLineTypeId,
  CadPointSymbolId as TypesPointSymbolId,
  CadPointSymbolShape as TypesPointSymbolShape,
  CadStyleId as TypesStyleId,
  CadTextStyleId as TypesTextStyleId,
} from '../src/engine/cad/cadTypes';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEAF_PATH = path.join(ROOT, 'src/engine/cad/cadCorePrimitiveTypes.ts');
const CAD_TYPES_PATH = path.join(ROOT, 'src/engine/cad/cadTypes.ts');

const PRIMITIVE_NAMES = [
  'CadBounds',
  'CadEntityId',
  'CadLayer',
  'CadLayerId',
  'CadLineTypeId',
  'CadPointSymbolId',
  'CadPointSymbolShape',
  'CadStyleId',
  'CadTextStyleId',
].sort();

const FULL_LAYER: TypesLayer = {
  id: 'layer-1',
  name: 'Layer 1',
  color: '#112233',
  lineTypeId: 'continuous',
  defaultStyleId: 'style-1',
  visible: true,
  locked: false,
  frozen: false,
  transparency: 0.5,
  description: 'note',
  printable: true,
  lineweightMm: 0.25,
  role: 'points',
};

describe('STRUCT-195.2 leaf vs cadTypes primitive identity', () => {
  it('is assignable both ways (compile-time structural equality)', () => {
    expectTypeOf<LeafEntityId>().toEqualTypeOf<TypesEntityId>();
    expectTypeOf<LeafLayerId>().toEqualTypeOf<TypesLayerId>();
    expectTypeOf<LeafStyleId>().toEqualTypeOf<TypesStyleId>();
    expectTypeOf<LeafLineTypeId>().toEqualTypeOf<TypesLineTypeId>();
    expectTypeOf<LeafTextStyleId>().toEqualTypeOf<TypesTextStyleId>();
    expectTypeOf<LeafPointSymbolId>().toEqualTypeOf<TypesPointSymbolId>();
    expectTypeOf<LeafBounds>().toEqualTypeOf<TypesBounds>();
    expectTypeOf<LeafLayer>().toEqualTypeOf<TypesLayer>();
    expectTypeOf<LeafPointSymbolShape>().toEqualTypeOf<TypesPointSymbolShape>();
  });

  it('round-trips the layer shape in both directions with identical JSON', () => {
    const toLeafLayer = (layer: TypesLayer): LeafLayer => layer;
    const toTypesLayer = (layer: LeafLayer): TypesLayer => layer;
    expect(toLeafLayer(FULL_LAYER)).toEqual(FULL_LAYER);
    expect(toTypesLayer(FULL_LAYER)).toEqual(FULL_LAYER);
    expect(JSON.parse(JSON.stringify(FULL_LAYER))).toEqual(FULL_LAYER);
    // Field presence + order are part of the persisted JSON contract.
    expect(Object.keys(FULL_LAYER)).toEqual([
      'id',
      'name',
      'color',
      'lineTypeId',
      'defaultStyleId',
      'visible',
      'locked',
      'frozen',
      'transparency',
      'description',
      'printable',
      'lineweightMm',
      'role',
    ]);
  });

  it('keeps the layer role union, bounds, and symbol shape unchanged', () => {
    const roles: Array<LeafLayer['role']> = [
      'points',
      'control-points',
      'observation-lines',
      'error-ellipses',
      'labels',
      'parcels',
      'surfaces',
      'planning',
    ];
    const typesRoles: Array<TypesLayer['role']> = roles;
    expect(typesRoles).toHaveLength(8);

    const bounds: TypesBounds = { minX: 1, minY: 2, maxX: 3, maxY: 4 };
    const leafBounds: LeafBounds = bounds;
    const backBounds: TypesBounds = leafBounds;
    expect(Object.keys(backBounds)).toEqual(['minX', 'minY', 'maxX', 'maxY']);

    const shapes: LeafPointSymbolShape[] = ['circle', 'square', 'triangle', 'cross', 'x', 'dot'];
    const typesShapes: TypesPointSymbolShape[] = shapes;
    expect(typesShapes).toEqual(['circle', 'square', 'triangle', 'cross', 'x', 'dot']);
  });
});

describe('STRUCT-195.2 leaf import-free AST contract', () => {
  const source = fs.readFileSync(LEAF_PATH, 'utf8');
  const ast = ts.createSourceFile('cadCorePrimitiveTypes.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  it('has zero imports (value or type)', () => {
    expect(parseImports(source, 'cadCorePrimitiveTypes.ts')).toEqual([]);
    expect(ast.statements.filter(ts.isImportDeclaration)).toHaveLength(0);
  });

  it('exports exactly the nine primitive names as type-only declarations', () => {
    expect(ast.statements.filter(ts.isExportDeclaration)).toHaveLength(0);
    const declarations = ast.statements.filter(
      (statement) => ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement),
    );
    expect(declarations).toHaveLength(ast.statements.length);
    expect(declarations.map((statement) => statement.name.text).sort()).toEqual(PRIMITIVE_NAMES);
  });

  it('cadTypes re-exports every primitive type from the leaf', () => {
    const cadTypesSource = fs.readFileSync(CAD_TYPES_PATH, 'utf8');
    const cadTypesAst = ts.createSourceFile(
      'cadTypes.ts',
      cadTypesSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const reexports = cadTypesAst.statements
      .filter(ts.isExportDeclaration)
      .filter(
        (statement) =>
          statement.moduleSpecifier != null &&
          ts.isStringLiteral(statement.moduleSpecifier) &&
          statement.moduleSpecifier.text === './cadCorePrimitiveTypes',
      );
    expect(reexports).toHaveLength(1);
    const [reexport] = reexports;
    expect(reexport.isTypeOnly).toBe(true);
    const clause = reexport.exportClause;
    const names =
      clause != null && ts.isNamedExports(clause) ? clause.elements.map((element) => element.name.text) : [];
    expect(names.sort()).toEqual(PRIMITIVE_NAMES);
  });
});
