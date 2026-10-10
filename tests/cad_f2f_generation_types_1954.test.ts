/**
 * STRUCT-195.4 (Worker A) — F2F generation type leaf + link/provenance seam.
 *
 * Pins `src/engine/fieldToFinish/fieldToFinishGenerationTypes.ts`:
 *  - verbatim extraction of `FieldToFinishEntityState` /
 *    `FieldToFinishProvenance` / `FieldToFinishCadPayload` (from
 *    cadGeneration) and `LinkOfPayloadSource` (from linkedSync);
 *  - zero runtime imports (type-only references to cadTypes,
 *    resultIntegrity, fieldToFinishLinkTypes) and no back-edge to
 *    cadGeneration / linkedSync / cadTransactions;
 *  - `generatedBy` pinned to the runtime generator literal `'FIELD_TO_FINISH'`
 *    (not `typeof`-imported) so the leaf stays cycle-free;
 *  - old public paths re-export the moved names unchanged;
 *  - the hub + linkedSync type edges to cadGeneration are severed (and
 *    re-pointed at the leaf) while the value graph stays byte-identical.
 *
 * Type assignability is enforced by project typecheck; AST checks enforce the
 * structural contract; behavior suites prove the runtime builders/links are
 * unchanged.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  buildGraphs,
  collectTypeScriptFiles,
  findCycles,
} from '../scripts/cadTypeImportGraph.mjs';

import {
  FIELD_TO_FINISH_GENERATOR,
  buildFieldToFinishPayload,
  buildFieldToFinishProject,
  type FieldToFinishCadArgs,
  type FieldToFinishCadPayload as PayloadFromGenerator,
  type FieldToFinishCadPoint,
  type FieldToFinishEntityState as StateFromGenerator,
  type FieldToFinishProvenance as ProvenanceFromGenerator,
} from '../src/engine/fieldToFinish/cadGeneration';
import type {
  FieldToFinishCadPayload as PayloadFromLeaf,
  FieldToFinishEntityState as StateFromLeaf,
  FieldToFinishProvenance as ProvenanceFromLeaf,
  LinkOfPayloadSource as LinkSourceFromLeaf,
} from '../src/engine/fieldToFinish/fieldToFinishGenerationTypes';
import {
  buildSourceRevision,
  computeSyncStatus,
  linkOfPayload,
  type LinkOfPayloadSource as LinkSourceFromLinkedSync,
} from '../src/engine/fieldToFinish/linkedSync';
import { computeFeatureCatalogRevision } from '../src/engine/fieldToFinish/catalogRevision';
import type { FeatureCodeCatalog } from '../src/engine/fieldToFinish/featureCatalog';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';

// ---------------------------------------------------------------------------
// Static AST + graph helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative);

const GEN_LEAF = 'src/engine/fieldToFinish/fieldToFinishGenerationTypes.ts';
const CAD_GENERATION = 'src/engine/fieldToFinish/cadGeneration.ts';
const LINKED_SYNC = 'src/engine/fieldToFinish/linkedSync.ts';
const TRANSACTION_TYPES = 'src/engine/cad/cadTransactions.types.ts';
const PARCEL_LEAF = 'src/engine/cad/cadTransactionsParcelCommandTypes.ts';

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Module specifiers reached by a runtime (non-`import type`/`export type`) edge. */
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

/** Locally declared interfaces/type aliases (not re-exports). */
const localTypeNames = (file: string): string[] => {
  const out: string[] = [];
  for (const stmt of parse(file).statements) {
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) out.push(stmt.name.text);
  }
  return out;
};

/** Names in a local `export type { ... }` (no module specifier). */
const locallyExportedTypeNames = (file: string): string[] => {
  const out: string[] = [];
  for (const stmt of parse(file).statements) {
    if (
      ts.isExportDeclaration(stmt)
      && stmt.isTypeOnly
      && stmt.moduleSpecifier === undefined
      && stmt.exportClause
      && ts.isNamedExports(stmt.exportClause)
    ) {
      for (const element of stmt.exportClause.elements) out.push(element.name.text);
    }
  }
  return out;
};

/** Specifier a named import resolves from. */
const importSourceOf = (file: string, name: string): string | undefined => {
  for (const stmt of parse(file).statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const bindings = stmt.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings) && bindings.elements.some((el) => el.name.text === name)) {
      return stmt.moduleSpecifier.text;
    }
  }
  return undefined;
};

const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish'];
const loadGraph = () => {
  const files = GRAPH_DIRS.flatMap((dir) => collectTypeScriptFiles(path.join(REPO_ROOT, dir)));
  return buildGraphs(files.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
};

const kindsBetween = (
  graph: ReturnType<typeof buildGraphs>,
  from: string,
  to: string,
): string[] => graph.edges.filter((edge) => edge.from === abs(from) && edge.to === abs(to)).map((edge) => edge.kind);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const catalog: FeatureCodeCatalog = {
  id: 'test-catalog',
  name: 'Test',
  version: '3',
  definitions: [
    {
      id: 'ep', code: 'EP', description: 'Edge pavement', layer: 'RD-EP',
      pointBehavior: 'point', lineworkBehavior: { enabled: true, implicitContinuation: false },
    },
  ],
  aliases: [],
};
const revision = computeFeatureCatalogRevision(catalog);

const pt = (stationId: string, x: number, y: number, order: number): FieldToFinishCadPoint => ({
  stationId, x, y, sourceOrder: order,
  sourceLine: order,
  codes: [{ code: 'EP' }],
  rawCodeText: 'EP',
  sourceImportId: 'import-1',
});

const seedPoints = [pt('P1', 0, 0, 1), pt('P2', 10, 0, 2), pt('P3', 20, 0, 3)];
const blank = () => createBlankCadProject({ name: 'F2F', units: 'm' });
const argsOf = (source?: LinkSourceFromLeaf): FieldToFinishCadArgs => ({
  points: seedPoints, catalog, generationRunId: 'run-1', ...(source ? { source } : {}),
});

// Compile-time bidirectional identity (old public paths <-> new leaf).
const leafToHub = (payload: PayloadFromLeaf): PayloadFromGenerator => payload;
const hubToLeaf = (payload: PayloadFromGenerator): PayloadFromLeaf => payload;

// ---------------------------------------------------------------------------
// Leaf structure
// ---------------------------------------------------------------------------

describe('STRUCT-195.4 F2F generation leaf structure', () => {
  it('is runtime-import-free and declares only the four moved types', () => {
    expect(runtimeImportSpecifiers(abs(GEN_LEAF))).toEqual([]);
    expect(localTypeNames(abs(GEN_LEAF)).sort()).toEqual([
      'FieldToFinishCadPayload',
      'FieldToFinishEntityState',
      'FieldToFinishProvenance',
      'LinkOfPayloadSource',
    ]);
    const valueKinds = parse(abs(GEN_LEAF)).statements.filter((stmt) =>
      ts.isFunctionDeclaration(stmt)
      || ts.isVariableStatement(stmt)
      || ts.isClassDeclaration(stmt)
      || ts.isEnumDeclaration(stmt));
    expect(valueKinds).toEqual([]);
  });

  it('keeps cycle-free type imports and never imports the generator/link runtime', () => {
    const specifiers = parse(abs(GEN_LEAF)).statements
      .filter((stmt): stmt is ts.ImportDeclaration => ts.isImportDeclaration(stmt))
      .map((stmt) => (stmt.moduleSpecifier as ts.StringLiteral).text)
      .sort();
    expect(specifiers).toEqual(['../cad/cadTypes', '../resultIntegrity', './fieldToFinishLinkTypes']);
  });

  it('re-exports the moved names from their original public paths only', () => {
    expect(locallyExportedTypeNames(abs(CAD_GENERATION)).sort()).toEqual([
      'FieldToFinishCadPayload',
      'FieldToFinishEntityState',
      'FieldToFinishProvenance',
    ]);
    expect(locallyExportedTypeNames(abs(LINKED_SYNC))).toContain('LinkOfPayloadSource');
    for (const name of ['FieldToFinishCadPayload', 'FieldToFinishEntityState', 'FieldToFinishProvenance']) {
      expect(localTypeNames(abs(CAD_GENERATION))).not.toContain(name);
    }
    expect(localTypeNames(abs(LINKED_SYNC))).not.toContain('LinkOfPayloadSource');
  });

  it('points the hub F2F payload at the leaf and the parcel payloads at the parcel leaf', () => {
    expect(importSourceOf(abs(TRANSACTION_TYPES), 'FieldToFinishCadPayload'))
      .toBe('../fieldToFinish/fieldToFinishGenerationTypes');
    if (fs.existsSync(abs(PARCEL_LEAF))) {
      for (const name of [
        'ParcelDesignateCommand', 'ParcelNumberCommand', 'ParcelLinkCommand',
        'ParcelUnlinkCommand', 'ParcelSharedEditCommand', 'ParcelCheckCommand', 'ParcelScheduleCommand',
      ]) {
        expect(importSourceOf(abs(TRANSACTION_TYPES), name)).toBe('./cadTransactionsParcelCommandTypes');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Type identity + cycle severance
// ---------------------------------------------------------------------------

describe('STRUCT-195.4 type identity (enforced at typecheck)', () => {
  it('keeps every old public path identical to the leaf', () => {
    expectTypeOf<StateFromGenerator>().toEqualTypeOf<StateFromLeaf>();
    expectTypeOf<ProvenanceFromGenerator>().toEqualTypeOf<ProvenanceFromLeaf>();
    expectTypeOf<PayloadFromGenerator>().toEqualTypeOf<PayloadFromLeaf>();
    expectTypeOf<LinkSourceFromLinkedSync>().toEqualTypeOf<LinkSourceFromLeaf>();
  });

  it('pins generatedBy to the runtime generator literal without a type back-edge', () => {
    expectTypeOf<ProvenanceFromLeaf['generatedBy']>().toEqualTypeOf<typeof FIELD_TO_FINISH_GENERATOR>();
    expectTypeOf<ProvenanceFromLeaf['generatedBy']>().toEqualTypeOf<'FIELD_TO_FINISH'>();
    expectTypeOf<typeof FIELD_TO_FINISH_GENERATOR>().toEqualTypeOf<'FIELD_TO_FINISH'>();
  });

  it('round-trips payloads across the seam', () => {
    const payload = buildFieldToFinishPayload(blank(), argsOf()).payload;
    expect(leafToHub(payload)).toBe(payload);
    expect(hubToLeaf(payload)).toBe(payload);
  });
});

describe('STRUCT-195.4 F2F type-edge severance (AST graph)', () => {
  const graph = loadGraph();

  it('removes the hub->cadGeneration and linkedSync->cadGeneration type edges', () => {
    expect(kindsBetween(graph, TRANSACTION_TYPES, CAD_GENERATION)).toEqual([]);
    expect(kindsBetween(graph, LINKED_SYNC, CAD_GENERATION)).toEqual([]);
  });

  it('re-points those type edges at the leaf', () => {
    expect(kindsBetween(graph, TRANSACTION_TYPES, GEN_LEAF)).toContain('type');
    expect(kindsBetween(graph, LINKED_SYNC, GEN_LEAF)).toContain('type');
    expect(kindsBetween(graph, CAD_GENERATION, GEN_LEAF)).toContain('type');
  });

  it('keeps cadGeneration->linkedSync value-only and the leaf value-free', () => {
    expect(kindsBetween(graph, CAD_GENERATION, LINKED_SYNC)).toEqual(['value']);
    const leafValueEdges = graph.edges.filter(
      (edge) => (edge.kind === 'value' || edge.kind === 'mixed') && [edge.from, edge.to].includes(abs(GEN_LEAF)),
    );
    expect(leafValueEdges).toEqual([]);
  });

  // STRUCT-195.11 roll-forward: the project-transform kernel split dissolved
  // the 2-node projectTransform VALUE SCC, so the cumulative VALUE graph was
  // 3 SCCs / 16 nodes (geometry 7 + cogo-arc 5 + parcel-diagnostics 4).
  // STRUCT-195.12 roll-forward: the parcel-diagnostics cycle break dissolved
  // the 4-node parcel VALUE SCC (helpers moved to cadCogoParcelLineworkTopology;
  // Diagnostics imports the geometry leaves directly), so the cumulative VALUE
  // graph is now 2 SCCs / 12 nodes (geometry 7 + cogo-arc 5). This 195.4 leaf
  // still adds no runtime value cycle of its own — the 195.11 authorized delta
  // is proved in tests/cad_project_transform_runtime_cycle_19511.test.ts and
  // the 195.12 authorized delta in
  // tests/cad_cogo_parcel_runtime_cycle_19512.test.ts.
  //
  // STRUCT-195.13 roll-forward (2026-10-10, THIRD authorized runtime
  // value-graph change): cadParcelArcGeometry.ts repoints
  // { buildCadInverseSummary, formatCadBearing } from './cadCogoMath' to
  // './cadCogoSummaries', removing exactly one VALUE edge
  // (src/engine/cad/cadParcelArcGeometry.ts -> src/engine/cad/cadCogoMath.ts)
  // and adding exactly one (src/engine/cad/cadParcelArcGeometry.ts ->
  // src/engine/cad/cadCogoSummaries.ts). That dissolves the 5-node cogo-arc
  // VALUE SCC (cadCogoEntityIntersections, cadCogoMath, cadParcelArcGeometry,
  // cadPolylineCourses, cadPolylineGeometry now all singletons), leaving only
  // the 7-node geometry group: the cumulative VALUE graph is now 1 SCC / 7
  // nodes. Node/edge/pair totals are unchanged (482/2400/1584/1566); the
  // independent 195.13 authorization and exact removed+added edge are proved
  // in tests/cad_project_transform_runtime_cycle_19511.test.ts.
  it('adds no runtime value cycle (1 SCC / 7 nodes after 195.13 dissolved the cogo-arc quintet)', () => {
    const cycles = findCycles(graph.nodes, graph.value);
    expect(cycles.cyclic).toHaveLength(1);
    expect(cycles.cyclicNodes.size).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Runtime behavior unchanged
// ---------------------------------------------------------------------------

describe('STRUCT-195.4 runtime behavior unchanged', () => {
  it('stamps generatedBy with the runtime literal and keeps provenance fields', () => {
    const built = buildFieldToFinishPayload(blank(), argsOf());
    const point = built.payload.upsertEntities.find((entity) => entity.id === 'pt:P1');
    const provenance = (point?.metadata as Record<string, unknown> | undefined)?.['provenance'];
    expect(provenance).toMatchObject({
      generatedBy: FIELD_TO_FINISH_GENERATOR,
      catalogId: 'test-catalog',
      catalogRevision: revision,
      generationRunId: 'run-1',
      sourceStationId: 'P1',
      state: 'GENERATED',
    });
  });

  it('linkOfPayload filters label derivatives and keeps station/source identity', () => {
    const built = buildFieldToFinishPayload(blank(), argsOf({
      sourceKind: 'adjustment',
      resultFingerprint: 'adjustment-result/v1:abc',
    }));
    const link = linkOfPayload(built.payload);
    expect(link).toBeDefined();
    expect(link?.sourceKind).toBe('adjustment');
    expect(link?.sourceRevision).toBe('adjustment-result/v1:abc');
    expect(link?.stationIds).toEqual(['P1', 'P2', 'P3']);
    // Authoritative survey-point record ids only: `<record>:label` is dropped.
    expect(link?.sourceRecordIds).toEqual(['1', '2', '3']);
    expect(link?.sourceRecordIds.some((id) => id.includes(':label'))).toBe(false);
    expect(link?.resultFingerprint).toBe('adjustment-result/v1:abc');
  });

  it('preserves the prior source revision when no fingerprints are supplied', () => {
    const built = buildFieldToFinishPayload(blank(), argsOf());
    const link = linkOfPayload(built.payload, 'adjustment-result/v1:prior');
    expect(link?.sourceRevision).toBe('adjustment-result/v1:prior');
  });

  it('returns undefined for an empty payload so the existing link is untouched', () => {
    expect(linkOfPayload({
      layersToAdd: [], stylesToAdd: [], upsertEntities: [], removeEntityIds: [], label: 'empty',
    })).toBeUndefined();
  });

  it('evaluates CURRENT vs stale result fingerprints fail-closed', () => {
    const link = linkOfPayload(
      buildFieldToFinishPayload(blank(), argsOf({
        sourceKind: 'adjustment', resultFingerprint: 'adjustment-result/v1:abc',
      })).payload,
    );
    expect(computeSyncStatus(link, { sourceRevision: 'adjustment-result/v1:abc' })).toBe('CURRENT');
    expect(computeSyncStatus(link, { sourceRevision: 'adjustment-result/v1:stale' })).toBe('COORDINATES_CHANGED');
    // A legacy composite never reads CURRENT against a result snapshot.
    expect(buildSourceRevision({ inputFingerprint: 'in-1', settingsFingerprint: 'set-1' })).toBe('in-1:set-1');
  });

  it('keeps catalog identity and classifies catalog revision changes', () => {
    const link = linkOfPayload(buildFieldToFinishPayload(blank(), argsOf()).payload);
    expect(link?.catalogId).toBe('test-catalog');
    expect(link?.catalogRevision).toBe(revision);
    expect(computeSyncStatus(link, { catalogRevision: revision })).toBe('CURRENT');
    expect(computeSyncStatus(link, { catalogRevision: 'other-revision' })).toBe('CATALOG_CHANGED');
  });

  it('applies F2F_GENERATE as exactly one undoable transaction', () => {
    const project = blank();
    const built = buildFieldToFinishPayload(project, argsOf());
    const next = runCadCommand(createCadHistoryState(project), { key: 'F2F_GENERATE', payload: built.payload });
    expect(next.undoStack).toHaveLength(1);
    expect(next.redoStack).toHaveLength(0);
    expect(next.undoStack[0]?.transaction.commandKey).toBe('F2F_GENERATE');
    expect(next.present.project.entities.some((entity) => entity.id === 'pt:P1')).toBe(true);

    const undone = undoCadHistory(next);
    expect(undone.present.project.entities).toEqual(project.entities);
    expect(undone.redoStack).toHaveLength(1);
  });

  it('round-trips the generated project and provenance through WNCAD JSON', () => {
    const { project } = buildFieldToFinishProject(blank(), argsOf());
    const document = { ...createBlankCadDrawingDocument({ name: 'F2F', units: 'm' }), project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.metadata.fieldToFinishLink).toEqual(project.metadata.fieldToFinishLink);
    const point = parsed.drawing.project.entities.find((entity) => entity.id === 'pt:P1');
    expect((point?.metadata as Record<string, unknown> | undefined)?.['provenance'])
      .toMatchObject({ generatedBy: 'FIELD_TO_FINISH', state: 'GENERATED' });
  });
});
