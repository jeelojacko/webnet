/**
 * STRUCT-195.4 (Worker B) — parcel command payload type leaf.
 *
 * Pins `src/engine/cad/cadTransactionsParcelCommandTypes.ts`:
 *  - exactly the seven parcel command payload interfaces (designate, number,
 *    link, unlink, shared edit, check, schedule) plus the shared-edit edit
 *    union, extracted verbatim from their execution modules;
 *  - type-only imports (no runtime value edge, no backpath to the hub);
 *  - bidirectional assignability between the ORIGINAL exec-module import paths
 *    and the new leaf, plus exact equality with the `CadCommand` union slice;
 *  - the original hub union alias ordering (designate → number → link →
 *    unlink → shared edit → check → schedule);
 *  - real behavior through the re-exported payloads: designation/numbering,
 *    duplicate fail-closed, link/unlink, atomic two-side PARCELSHAREDEDIT +
 *    undo, PARCELCHECK/PARCELSCHEDULE output + selection — with no geometry
 *    inference and no extra mutation.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { cadBuildParcelClosureSummary } from '../src/engine/cad/cadCogoParcelGeometrySummaries';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { buildParcelCourseIds } from '../src/engine/cad/cadParcelCourses';
import {
  applyParcelSharedEdit,
  commitParcelSharedEditResult,
} from '../src/engine/cad/cadParcelSharedEdit';
import { setParcelPlanInfo } from '../src/engine/cad/cadParcelPlanDesignation';
import { createCadHistoryState, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import {
  parcelLinkCommand,
  parcelUnlinkCommand,
} from '../src/engine/cad/cadTransactionsParcelLinkCommands';
import {
  parcelCheckCommand,
  parcelScheduleCommand,
} from '../src/engine/cad/cadTransactionsParcelNetworkCommands';
import {
  parcelDesignateCommand,
  parcelNumberCommand,
} from '../src/engine/cad/cadTransactionsParcelPlanCommands';

import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadParcelCourseGeometry, CadParcelEntity, CadProject } from '../src/engine/cad/cadTypes';
// New leaf paths.
import type {
  ParcelDesignateCommand as LeafDesignateCommand,
  ParcelNumberCommand as LeafNumberCommand,
  ParcelLinkCommand as LeafLinkCommand,
  ParcelUnlinkCommand as LeafUnlinkCommand,
  ParcelSharedEditCommand as LeafSharedEditCommand,
  ParcelSharedEditEdit as LeafSharedEditEdit,
  ParcelCheckCommand as LeafCheckCommand,
  ParcelScheduleCommand as LeafScheduleCommand,
} from '../src/engine/cad/cadTransactionsParcelCommandTypes';
// Original exec-module paths (must keep working via the leaves' re-exports).
import type {
  ParcelDesignateCommand,
  ParcelNumberCommand,
} from '../src/engine/cad/cadTransactionsParcelPlanCommands';
import type {
  ParcelLinkCommand,
  ParcelUnlinkCommand,
} from '../src/engine/cad/cadTransactionsParcelLinkCommands';
import type { ParcelSharedEditCommand } from '../src/engine/cad/cadParcelSharedEdit';
import type { ParcelSharedEditEdit } from '../src/engine/cad/cadParcelSharedEdit';
import type {
  ParcelCheckCommand,
  ParcelScheduleCommand,
} from '../src/engine/cad/cadTransactionsParcelNetworkCommands';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAD_DIR = path.join(REPO_ROOT, 'src', 'engine', 'cad');
const LEAF = path.join(CAD_DIR, 'cadTransactionsParcelCommandTypes.ts');
const HUB = path.join(CAD_DIR, 'cadTransactions.types.ts');
const PLAN = path.join(CAD_DIR, 'cadTransactionsParcelPlanCommands.ts');
const LINK = path.join(CAD_DIR, 'cadTransactionsParcelLinkCommands.ts');
const NETWORK = path.join(CAD_DIR, 'cadTransactionsParcelNetworkCommands.ts');
const SHARED_EDIT = path.join(CAD_DIR, 'cadParcelSharedEdit.ts');

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const allImportSpecifiers = (file: string): string[] =>
  parse(file).statements
    .filter((stmt): stmt is ts.ImportDeclaration =>
      ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier))
    .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text);

/** Module specifiers reached by a runtime (non-`import type`) edge. */
const runtimeImportSpecifiers = (file: string): string[] => {
  const out: string[] = [];
  for (const stmt of parse(file).statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const clause = stmt.importClause;
    if (!clause || clause.phaseModifier === ts.SyntaxKind.TypeKeyword) continue;
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings) && bindings.elements.every((el) => el.isTypeOnly)) continue;
    out.push(stmt.moduleSpecifier.text);
  }
  return out;
};

const interfaceNames = (file: string): string[] =>
  parse(file).statements
    .filter((stmt): stmt is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(stmt))
    .map((stmt) => stmt.name.text);

const typeAliasNames = (file: string): string[] =>
  parse(file).statements
    .filter((stmt): stmt is ts.TypeAliasDeclaration => ts.isTypeAliasDeclaration(stmt))
    .map((stmt) => stmt.name.text);

const valueStatementKinds = (file: string): string[] =>
  parse(file).statements
    .filter((stmt) =>
      ts.isFunctionDeclaration(stmt)
      || ts.isVariableStatement(stmt)
      || ts.isClassDeclaration(stmt)
      || ts.isEnumDeclaration(stmt))
    .map((stmt) => ts.SyntaxKind[stmt.kind]);

/** Named type-only re-exports from `specifier`, in source order. */
const typeReexportsFrom = (file: string, specifier: string): string[] => {
  const out: string[] = [];
  for (const stmt of parse(file).statements) {
    if (!ts.isExportDeclaration(stmt) || !stmt.moduleSpecifier || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== specifier) continue;
    expect(stmt.isTypeOnly).toBe(true);
    if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
      for (const el of stmt.exportClause.elements) out.push(el.name.text);
    }
  }
  return out;
};

const PARCEL_ALIASES = new Set([
  'ParcelDesignateCommand',
  'ParcelNumberCommand',
  'ParcelLinkCommand',
  'ParcelUnlinkCommand',
  'ParcelSharedEditCommand',
  'ParcelCheckCommand',
  'ParcelScheduleCommand',
]);

/** Parcel payload aliases in the hub `CadCommand` union, in source order. */
const hubParcelAliasOrder = (): string[] => {
  const alias = parse(HUB).statements.find(
    (stmt): stmt is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(stmt) && stmt.name.text === 'CadCommand',
  );
  if (!alias) return [];
  const names: string[] = [];
  const visit = (node: ts.TypeNode): void => {
    if (ts.isUnionTypeNode(node)) {
      node.types.forEach(visit);
      return;
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const name = node.typeName.text;
      if (PARCEL_ALIASES.has(name)) names.push(name);
    }
  };
  visit(alias.type);
  return names;
};

const EXPECTED_HUB_ORDER = [
  'ParcelDesignateCommand',
  'ParcelNumberCommand',
  'ParcelLinkCommand',
  'ParcelUnlinkCommand',
  'ParcelSharedEditCommand',
  'ParcelCheckCommand',
  'ParcelScheduleCommand',
] as const;

// ---------------------------------------------------------------------------
// Fixtures (pure geometry, no legal inference).
// ---------------------------------------------------------------------------

const makeParcel = (
  id: string,
  vertices: Array<{ x: number; y: number }>,
  courseGeometry?: CadParcelCourseGeometry[],
): CadParcelEntity => {
  const parcel: CadParcelEntity = {
    id,
    type: 'parcel',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex) => ({ ...vertex })),
    vertexLabels: vertices.map((_, index) => `P${index + 1}`),
    parcelName: `Parcel ${id}`,
    courseIds: buildParcelCourseIds(id, vertices.length),
    ...(courseGeometry != null ? { courseGeometry: courseGeometry.map((entry) => ({ ...entry })) } : {}),
  };
  const metrics = cadBuildParcelClosureSummary(parcel.vertices, { courseGeometry });
  if (metrics) {
    parcel.areaSquareMeters = metrics.areaSquareMeters;
    parcel.perimeterMeters = metrics.perimeterMeters;
  }
  return parcel;
};

const makeProject = (parcels: CadParcelEntity[]): CadProject => {
  const project = createBlankCadProject({ name: 'parcel-1954', units: 'm' });
  project.entities.push(...parcels);
  return project;
};

const snapshot = (project: CadProject) => createCadHistoryState(project).present;

// A.1 is (10,0)->(10,10); B.0 is (10,10)->(10,0): an exact opposite traversal.
const squareA = (): CadParcelEntity =>
  makeParcel('A', [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]);
const squareB = (): CadParcelEntity =>
  makeParcel('B', [
    { x: 10, y: 10 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
  ]);

const linkedProject = (): { project: CadProject; boundaryId: string } => {
  const project = makeProject([squareA(), squareB()]);
  project.sharedParcelBoundaries = [
    {
      id: 'link-1954',
      first: { parcelId: 'A', courseId: 'parcel-course:A:1' },
      second: { parcelId: 'B', courseId: 'parcel-course:B:0' },
    },
  ];
  return { project, boundaryId: 'link-1954' };
};

const parcelById = (project: CadProject, id: string): CadParcelEntity => {
  const parcel = project.entities.find(
    (entity): entity is CadParcelEntity => entity.id === id && entity.type === 'parcel',
  );
  if (!parcel) throw new Error(`missing parcel ${id}`);
  return parcel;
};

const hasVertex = (parcel: CadParcelEntity, x: number, y: number): boolean =>
  parcel.vertices.some((vertex) => Math.abs(vertex.x - x) <= 1e-9 && Math.abs(vertex.y - y) <= 1e-9);

// Compile-time bidirectional assignment (leaf <-> original exec-module paths).
const leafToOriginalDesignate = (command: LeafDesignateCommand): ParcelDesignateCommand => command;
const originalToLeafDesignate = (command: ParcelDesignateCommand): LeafDesignateCommand => command;

// ---------------------------------------------------------------------------

describe('STRUCT-195.4 parcel payload leaf structure', () => {
  it('declares the seven interfaces + shared-edit union in payload order', () => {
    expect(interfaceNames(LEAF)).toEqual([...EXPECTED_HUB_ORDER]);
    expect(typeAliasNames(LEAF)).toEqual(['ParcelSharedEditEdit']);
  });

  it('is runtime-import-free with exactly the three allowed type modules', () => {
    expect(runtimeImportSpecifiers(LEAF)).toEqual([]);
    expect(allImportSpecifiers(LEAF)).toEqual([
      './cadCorePrimitiveTypes',
      './cadTypes',
      './cadParcelPlanDesignation',
    ]);
    expect(valueStatementKinds(LEAF)).toEqual([]);
  });

  it('never imports the hub, an exec module, or cadParcelSharedEdit', () => {
    const forbidden = [
      './cadTransactions.types',
      './cadTransactionsParcelPlanCommands',
      './cadTransactionsParcelLinkCommands',
      './cadTransactionsParcelNetworkCommands',
      './cadParcelSharedEdit',
    ];
    for (const specifier of forbidden) {
      expect(allImportSpecifiers(LEAF)).not.toContain(specifier);
    }
  });

  it('keeps every exec module re-exporting its payloads from the leaf', () => {
    expect(typeReexportsFrom(PLAN, './cadTransactionsParcelCommandTypes')).toEqual([
      'ParcelDesignateCommand',
      'ParcelNumberCommand',
    ]);
    expect(typeReexportsFrom(LINK, './cadTransactionsParcelCommandTypes')).toEqual([
      'ParcelLinkCommand',
      'ParcelUnlinkCommand',
    ]);
    expect(typeReexportsFrom(NETWORK, './cadTransactionsParcelCommandTypes')).toEqual([
      'ParcelCheckCommand',
      'ParcelScheduleCommand',
    ]);
    expect(typeReexportsFrom(SHARED_EDIT, './cadTransactionsParcelCommandTypes')).toEqual([
      'ParcelSharedEditCommand',
      'ParcelSharedEditEdit',
    ]);
    for (const file of [PLAN, LINK, NETWORK, SHARED_EDIT]) {
      for (const name of EXPECTED_HUB_ORDER) expect(interfaceNames(file)).not.toContain(name);
    }
  });

  it('pins the original hub union alias ordering', () => {
    expect(hubParcelAliasOrder()).toEqual([...EXPECTED_HUB_ORDER]);
  });
});

describe('STRUCT-195.4 parcel payload assignability (enforced at typecheck)', () => {
  it('matches each original exec-module path in both directions', () => {
    expectTypeOf<LeafDesignateCommand>().toEqualTypeOf<ParcelDesignateCommand>();
    expectTypeOf<LeafNumberCommand>().toEqualTypeOf<ParcelNumberCommand>();
    expectTypeOf<LeafLinkCommand>().toEqualTypeOf<ParcelLinkCommand>();
    expectTypeOf<LeafUnlinkCommand>().toEqualTypeOf<ParcelUnlinkCommand>();
    expectTypeOf<LeafSharedEditCommand>().toEqualTypeOf<ParcelSharedEditCommand>();
    expectTypeOf<LeafSharedEditEdit>().toEqualTypeOf<ParcelSharedEditEdit>();
    expectTypeOf<LeafCheckCommand>().toEqualTypeOf<ParcelCheckCommand>();
    expectTypeOf<LeafScheduleCommand>().toEqualTypeOf<ParcelScheduleCommand>();
  });

  it('is exactly the hub CadCommand parcel slice for every key', () => {
    expectTypeOf<Extract<CadCommand, { key: 'PARCELDESIGNATE' }>>().toEqualTypeOf<LeafDesignateCommand>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELNUMBER' }>>().toEqualTypeOf<LeafNumberCommand>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELLINK' }>>().toEqualTypeOf<LeafLinkCommand>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELUNLINK' }>>().toEqualTypeOf<LeafUnlinkCommand>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELSHAREDEDIT' }>>().toEqualTypeOf<LeafSharedEditCommand>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELCHECK' }>>().toEqualTypeOf<LeafCheckCommand>();
    expectTypeOf<Extract<CadCommand, { key: 'PARCELSCHEDULE' }>>().toEqualTypeOf<LeafScheduleCommand>();
  });

  it('keeps the shared-edit union kind/end/geometry shape', () => {
    type MoveEnd = Extract<LeafSharedEditEdit, { kind: 'move-endpoint' }>;
    expectTypeOf<MoveEnd['end']>().toEqualTypeOf<'from' | 'to'>();
    expectTypeOf<MoveEnd['x']>().toEqualTypeOf<number>();
    expectTypeOf<MoveEnd['y']>().toEqualTypeOf<number>();
    type CourseGeometry = Extract<LeafSharedEditEdit, { kind: 'course-geometry' }>;
    expectTypeOf<CourseGeometry['geometry']>().toEqualTypeOf<CadParcelCourseGeometry>();
  });

  it('round-trips the designate payload across old and new paths', () => {
    const command: LeafDesignateCommand = {
      key: 'PARCELDESIGNATE',
      parcelEntityIds: ['A'],
      designation: 'Lot 1',
      role: 'lot',
    };
    expect(leafToOriginalDesignate(command)).toBe(command);
    expect(originalToLeafDesignate(command)).toBe(command);
  });
});

describe('STRUCT-195.4 parcel designation/numbering + duplicate fail-closed', () => {
  it('PARCELNUMBER commits designations without touching geometry', () => {
    const project = makeProject([squareA(), squareB()]);
    const before = project.entities.map((entity) => JSON.stringify(entity));
    const result = parcelNumberCommand.execute(snapshot(project), {
      key: 'PARCELNUMBER',
      parcelEntityIds: ['A', 'B'],
      numbering: { prefix: 'Lot', start: 1, separator: ' ' },
      role: 'lot',
    });
    expect(result).not.toBeNull();
    expect(parcelById(result!.nextSnapshot.project, 'A').planInfo?.designation).toBe('Lot 1');
    expect(parcelById(result!.nextSnapshot.project, 'B').planInfo?.designation).toBe('Lot 2');
    expect([...result!.nextSnapshot.selection.selectedEntityIds]).toEqual(['A', 'B']);
    // Geometry + identity unchanged; only planInfo changed.
    expect(parcelById(result!.nextSnapshot.project, 'A').vertices).toEqual(squareA().vertices);
    expect(parcelById(result!.nextSnapshot.project, 'A').courseIds).toEqual(squareA().courseIds);
    expect(project.entities.map((entity) => JSON.stringify(entity))).toEqual(before);
  });

  it('PARCELDESIGNATE fails closed on lot duplicates unless confirmed', () => {
    const a = setParcelPlanInfo(squareA(), { designation: 'Lot 1', role: 'lot' });
    const project = makeProject([a, squareB()]);
    const blocked = parcelDesignateCommand.execute(snapshot(project), {
      key: 'PARCELDESIGNATE',
      parcelEntityIds: ['B'],
      designation: 'Lot 1',
      role: 'lot',
    });
    expect(blocked).toBeNull();
    const confirmed = parcelDesignateCommand.execute(snapshot(project), {
      key: 'PARCELDESIGNATE',
      parcelEntityIds: ['B'],
      designation: 'Lot 1',
      role: 'lot',
      allowLotDuplicates: true,
    });
    expect(confirmed).not.toBeNull();
    expect(parcelById(confirmed!.nextSnapshot.project, 'B').planInfo?.designation).toBe('Lot 1');
  });
});

describe('STRUCT-195.4 shared-boundary link/unlink', () => {
  it('PARCELLINK changes only the relationship collection', () => {
    const project = makeProject([squareA(), squareB()]);
    const result = parcelLinkCommand.execute(snapshot(project), {
      key: 'PARCELLINK',
      first: { parcelId: 'A', courseId: 'parcel-course:A:1' },
      second: { parcelId: 'B', courseId: 'parcel-course:B:0' },
    });
    expect(result).not.toBeNull();
    expect(result!.nextSnapshot.project.sharedParcelBoundaries).toHaveLength(1);
    expect(result!.nextSnapshot.project.entities).toEqual(project.entities);
    expect(result!.addedEntityIds).toEqual([]);
    expect(result!.removedEntityIds).toEqual([]);
    expect(result!.transactionLabel).toContain('PARCELLINK');
  });

  it('PARCELUNLINK removes only the relationship; unknown ids fail closed', () => {
    const { project, boundaryId } = linkedProject();
    const result = parcelUnlinkCommand.execute(snapshot(project), { key: 'PARCELUNLINK', boundaryId });
    expect(result).not.toBeNull();
    expect(result!.nextSnapshot.project.sharedParcelBoundaries).toEqual([]);
    expect(result!.nextSnapshot.project.entities).toEqual(project.entities);
    expect(
      parcelUnlinkCommand.execute(snapshot(project), { key: 'PARCELUNLINK', boundaryId: 'nope' }),
    ).toBeNull();
  });
});

describe('STRUCT-195.4 atomic two-side PARCELSHAREDEDIT + undo', () => {
  it('moves the shared endpoint on both parcels in one undo entry', () => {
    const { project, boundaryId } = linkedProject();
    const applied = applyParcelSharedEdit(project, {
      key: 'PARCELSHAREDEDIT',
      linkId: boundaryId,
      edit: { kind: 'move-endpoint', end: 'from', x: 10, y: -5 },
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(hasVertex(parcelById(applied.project, 'A'), 10, -5)).toBe(true);
    expect(hasVertex(parcelById(applied.project, 'B'), 10, -5)).toBe(true);
    expect(hasVertex(parcelById(applied.project, 'A'), 10, 0)).toBe(false);
    expect(hasVertex(parcelById(applied.project, 'B'), 10, 0)).toBe(false);
    expect([...applied.selectionIds]).toEqual(['A', 'B']);
    expect(applied.transactionLabel).toContain('PARCELSHAREDEDIT');
    // The link store survives the identity/geometry edit untouched.
    expect(applied.project.sharedParcelBoundaries).toEqual(project.sharedParcelBoundaries);

    const history = commitParcelSharedEditResult(createCadHistoryState(project), applied);
    expect(history.undoStack).toHaveLength(1);
    expect(history.undoStack[0]!.transaction.commandKey).toBe('PARCELSHAREDEDIT');
    expect(undoCadHistory(history).present.project).toBe(project);
  });
});

describe('STRUCT-195.4 PARCELCHECK/PARCELSCHEDULE output + selection', () => {
  it('PARCELCHECK reports the network and selects the scoped parcels', () => {
    const { project } = linkedProject();
    const result = parcelCheckCommand.execute(snapshot(project), { key: 'PARCELCHECK' });
    expect(result).not.toBeNull();
    expect(result!.transactionLabel.startsWith('PARCELCHECK')).toBe(true);
    expect(result!.commandState.prompt).toContain('PARCELCHECK');
    expect([...result!.nextSnapshot.selection.selectedEntityIds]).toEqual(['A', 'B']);
    expect(result!.addedEntityIds).toEqual([]);
    expect(result!.removedEntityIds).toEqual([]);
    expect(result!.nextSnapshot.project).toBe(project);
  });

  it('PARCELSCHEDULE derives live areas, selects the ids, and rejects an empty scope', () => {
    const { project } = linkedProject();
    const result = parcelScheduleCommand.execute(snapshot(project), {
      key: 'PARCELSCHEDULE',
      parcelEntityIds: ['A', 'B'],
    });
    expect(result).not.toBeNull();
    expect(result!.transactionLabel.startsWith('PARCELSCHEDULE')).toBe(true);
    expect(result!.commandState.prompt).toContain('PARCELSCHEDULE');
    expect(result!.commandState.prompt).toContain('m²');
    expect([...result!.nextSnapshot.selection.selectedEntityIds]).toEqual(['A', 'B']);
    expect(result!.nextSnapshot.project).toBe(project);
    expect(
      parcelScheduleCommand.execute(snapshot(project), {
        key: 'PARCELSCHEDULE',
        parcelEntityIds: ['missing'],
      }),
    ).toBeNull();
  });
});
