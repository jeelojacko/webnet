/**
 * STRUCT-195.1 (Worker A): surface runtime value-cycle break.
 *
 * Pins the 19S extraction of commitSurface/editSurface/
 * NATIVE_SOURCE_MUTATION_KEYS into cadTransactionsSurfaceCore.ts:
 *  - static TS-AST value graph: no reciprocal or transitive value path
 *    between cadTransactionsSurfaceCommands.ts and
 *    cadTransactionsSurfaceBoundaryCommands.ts (type-only edges excluded);
 *  - behavior parity for the shared edit helper across both modules:
 *    command labels/registry order, guards, boundaries, breaklines,
 *    geometry cache invalidation, undo/redo, and save/reopen.
 *
 * Dynamic imports run boundary FIRST then commands so a reintroduced value
 * cycle would surface as a TDZ/initialization failure at module load.
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type {
  CadPolygonEntity,
  CadPolylineEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

// ---------------------------------------------------------------------------
// Static value-graph assertion (TS AST, not regex)
// ---------------------------------------------------------------------------

interface ModuleGraph { value: Set<string>; typeOnly: Set<string>; }

const modulePath = (name: string): string =>
  fileURLToPath(new URL(`../src/engine/cad/${name}`, import.meta.url));

const resolveLocal = (fromFile: string, spec: string): string | null => {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  return [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]
    .find((candidate) => fs.existsSync(candidate)) ?? null;
};

const specifierOf = (node: ts.Expression | undefined): string | null =>
  node && ts.isStringLiteralLike(node) ? node.text : null;

const analyzeModule = (file: string): ModuleGraph => {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const value = new Set<string>();
  const typeOnly = new Set<string>();
  for (const stmt of source.statements) {
    if (ts.isImportDeclaration(stmt)) {
      const target = resolveLocal(file, specifierOf(stmt.moduleSpecifier) ?? '');
      const clause = stmt.importClause;
      if (!target || !clause) continue;
      if (clause.isTypeOnly) { typeOnly.add(target); continue; }
      const names = clause.namedBindings;
      if (names && ts.isNamedImports(names)) {
        if (names.elements.some((el) => !el.isTypeOnly)) value.add(target);
        if (names.elements.some((el) => el.isTypeOnly)) typeOnly.add(target);
      } else {
        value.add(target);
      }
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      const target = resolveLocal(file, specifierOf(stmt.moduleSpecifier) ?? '');
      if (!target) continue;
      if (stmt.isTypeOnly) { typeOnly.add(target); continue; }
      const clause = stmt.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        if (clause.elements.some((el) => !el.isTypeOnly)) value.add(target);
        if (clause.elements.some((el) => el.isTypeOnly)) typeOnly.add(target);
      } else {
        value.add(target);
      }
    }
  }
  return { value, typeOnly };
};
const graphCache = new Map<string, ModuleGraph>();
const moduleGraph = (file: string): ModuleGraph => {
  let graph = graphCache.get(file);
  if (!graph) { graph = analyzeModule(file); graphCache.set(file, graph); }
  return graph;
};

/** Value-import transitive closure (type-only edges never traversed). */
const valueClosure = (start: string): Set<string> => {
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of moduleGraph(file).value) queue.push(next);
  }
  return seen;
};

describe('STRUCT-195.1 surface value-import graph', () => {
  const commands = modulePath('cadTransactionsSurfaceCommands.ts');
  const boundary = modulePath('cadTransactionsSurfaceBoundaryCommands.ts');
  const core = modulePath('cadTransactionsSurfaceCore.ts');
  const transactionsTypes = modulePath('cadTransactions.types.ts');

  it('has no reciprocal or transitive value edge between commands and boundary', () => {
    expect(moduleGraph(commands).value.has(boundary)).toBe(true);
    expect(moduleGraph(commands).value.has(core)).toBe(true);
    expect(moduleGraph(boundary).value.has(core)).toBe(true);
    // The two commands modules are acyclic by value.
    expect(moduleGraph(boundary).value.has(commands)).toBe(false);
    expect(valueClosure(boundary).has(commands)).toBe(false);
    expect(valueClosure(commands).has(boundary)).toBe(true);
  });

  it('keeps the core a leaf: it never reaches either commands module', () => {
    expect(moduleGraph(core).value.has(commands)).toBe(false);
    expect(moduleGraph(core).value.has(boundary)).toBe(false);
    expect(valueClosure(core).has(commands)).toBe(false);
    expect(valueClosure(core).has(boundary)).toBe(false);
  });

  it('classifies type-only imports separately from value edges', () => {
    expect(moduleGraph(core).typeOnly.has(transactionsTypes)).toBe(true);
    expect(moduleGraph(core).value.has(transactionsTypes)).toBe(false);
    expect(moduleGraph(boundary).value.has(modulePath('cadBoundaryCandidateValidation.ts'))).toBe(true);
    expect(moduleGraph(boundary).value.has(modulePath('cadTransactionsSurfaceCore.ts'))).toBe(true);
  });

  it('loads boundary before commands without a TDZ cycle failure', async () => {
    const boundaryModule = await import('../src/engine/cad/cadTransactionsSurfaceBoundaryCommands');
    const commandsModule = await import('../src/engine/cad/cadTransactionsSurfaceCommands');
    expect(Object.keys(boundaryModule.surfaceBoundaryCommandDefinitions)).toHaveLength(5);
    expect(Object.keys(commandsModule.surfaceCommandDefinitions)).toContain('SURFACE_ADD_BOUNDARY');
  });
});

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const point = (id: string, station: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
  stationId: station, x, y, z, pointClass: 'free', source: 'parsed-input',
});

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): CadPolygonEntity => ({
  id, type: 'polygon', layerId: 'general', visible: true, locked: false,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  vertexLabels: ['', '', '', ''],
});

const chainLine = (id: string): CadPolylineEntity => ({
  id, type: 'polyline', layerId: 'general', visible: true, locked: false,
  vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }], vertexLabels: ['A', 'B'], closed: false,
});

const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'STRUCT-195.1', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('pt-1', 'A', 0, 0, 10), point('pt-2', 'B', 10, 0, 11),
      point('pt-3', 'C', 10, 10, 12), point('pt-4', 'D', 0, 10, 13),
      rect('ring-outer', 0, 0, 10, 10), rect('ring-alt', 1, 1, 9, 9), chainLine('ch-1'),
    ],
  };
};

const QUAD = { kind: 'points' as const, pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] };
type History = ReturnType<typeof createCadHistoryState>;

const run = (history: History, command: CadCommand): History => runCadCommand(history, command);

const createSite = (history: History): History =>
  run(history, { key: 'SURFACE_CREATE', name: 'Site', pointSource: QUAD });

const surfaceId = (history: History): string => history.present.project.surfaces![0]!.id;

const surfaceOf = (history: History, id = surfaceId(history)): CadSurface =>
  history.present.project.surfaces!.find((entry) => entry.id === id)!;

const boundariesOf = (history: History, kind: 'outer' | 'void') =>
  (surfaceOf(history).definition.boundaries ?? []).filter((entry) => entry.type === kind).length;

const siteHistory = (): { history: History; id: string } => {
  const history = createSite(createCadHistoryState(baseProject()));
  return { history, id: surfaceId(history) };
};

const withCachedSurface = (): { history: History; id: string } => {
  const { history, id } = siteHistory();
  const project: CadProject = {
    ...history.present.project,
    surfaces: history.present.project.surfaces!.map((surface) =>
      surface.id === id
        ? { ...surface, styleId: 'style-x', cachedRevision: 'rev-1', buildDiagnostic: 'old' }
        : surface),
  };
  return { history: createCadHistoryState(project), id };
};

const importedProject = (): CadProject => ({
  ...baseProject(),
  surfaces: [{
    id: 'surf-tin', name: 'Imported',
    definition: {
      pointSource: { kind: 'points', pointEntityIds: [] },
      sourceKind: 'imported-tin',
      importedTin: {
        vertices: [0, 0, 1, 10, 0, 2, 10, 10, 3, 0, 10, 4],
        faces: [0, 1, 2, 0, 2, 3],
        provenance: { format: 'LandXML', fileName: 't.xml', surfaceName: 's' },
      },
    },
    cachedRevision: null,
  }],
});

// ---------------------------------------------------------------------------
// Behavior parity: labels, guards, cache, boundaries, breaklines
// ---------------------------------------------------------------------------

describe('STRUCT-195.1 surface helper behavior parity', () => {
  it('keeps the boundary spread position and exact create/rename/delete labels', async () => {
    const { surfaceCommandDefinitions } = await import('../src/engine/cad/cadTransactionsSurfaceCommands');
    const keys = Object.keys(surfaceCommandDefinitions);
    const boundaryKeys = [
      'SURFACE_ADD_BOUNDARY', 'SURFACE_REMOVE_BOUNDARY', 'SURFACE_CREATE_BOUNDARY_SOURCE',
      'SURFACE_REPLACE_BOUNDARY_SOURCE', 'SURFACE_MAKE_BOUNDARY_INDEPENDENT',
    ];
    const start = keys.indexOf('SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN') + 1;
    expect(keys[0]).toBe('SURFACE_CREATE');
    expect(keys.slice(start, start + boundaryKeys.length)).toEqual(boundaryKeys);
    expect(keys[start + boundaryKeys.length]).toBe('SURFACE_ADD_EDIT');
    expect(keys.at(-1)).toBe('SURFACE_STYLE_DELETE');

    let { history, id } = siteHistory();
    expect(id.startsWith('cad-surface')).toBe(true);
    expect(history.commandState).toEqual({
      key: 'SURFACE_CREATE', phase: 'committed', prompt: 'SURFACE_CREATE (Site) committed.',
    });
    history = run(history, { key: 'SURFACE_RENAME', surfaceId: id, name: 'Renamed' });
    expect(history.commandState.prompt).toBe('SURFACE_RENAME (Renamed) committed.');
    history = run(history, { key: 'SURFACE_DELETE', surfaceId: id });
    expect(history.present.project.surfaces).toEqual([]);
    expect(history.undoStack.at(-1)!.transaction).toMatchObject({
      commandKey: 'SURFACE_DELETE', label: 'SURFACE_DELETE (Renamed)',
    });
  });

  it('rejects null mutations and invalid edits without a history entry', () => {
    const { history, id } = siteHistory();
    const depth = history.undoStack.length;
    expect(run(history, { key: 'SURFACE_RENAME', surfaceId: id, name: 'Site' })).toBe(history);
    expect(run(history, { key: 'SURFACE_RENAME', surfaceId: 'missing', name: 'X' })).toBe(history);
    expect(run(history, { key: 'SURFACE_ADD_POINTS', surfaceId: id, pointIds: [] })).toBe(history);
    expect(history.undoStack).toHaveLength(depth);
  });

  it('blocks destructive edits on a locked surface layer', () => {
    const { history, id } = siteHistory();
    const layerId = surfaceOf(history).layerId;
    const locked: CadProject = {
      ...history.present.project,
      layers: history.present.project.layers.map((layer) =>
        layer.id === layerId ? { ...layer, locked: true } : layer),
    };
    const state = createCadHistoryState(locked);
    expect(run(state, { key: 'SURFACE_RENAME', surfaceId: id, name: 'X' })).toBe(state);
    expect(run(state, { key: 'SURFACE_DELETE', surfaceId: id })).toBe(state);
    expect(run(state, { key: 'SURFACE_ADD_POINTS', surfaceId: id, pointIds: ['pt-1'] })).toBe(state);
  });

  it('rejects native source mutations on imported topology but allows mesh edits', () => {
    const project = importedProject();
    const snapshot = createCadHistoryState(project).present;
    const rejected: CadCommand[] = [
      { key: 'SURFACE_ADD_BOUNDARY', surfaceId: 'surf-tin', kind: 'outer', sourceEntityId: 'ring-outer' },
      { key: 'SURFACE_ADD_POINTS', surfaceId: 'surf-tin', pointIds: ['pt-1'] },
      { key: 'SURFACE_REMOVE_SOURCE', surfaceId: 'surf-tin' },
    ];
    for (const command of rejected) expect(executeCadCommand(snapshot, command)).toBeNull();
    const surface = project.surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(project, surface);
    expect(executeCadCommand(snapshot, {
      key: 'SURFACE_ADD_EDIT', surfaceId: 'surf-tin', expectedRevision: revision,
      edit: { kind: 'add-point', x: 5, y: 5, z: 2 },
    })).not.toBeNull();
  });

  it('clears cachedRevision/buildDiagnostic on geometry edits only', () => {
    const { history, id } = withCachedSurface();
    const geometry = run(history, { key: 'SURFACE_ADD_POINTS', surfaceId: id, pointIds: ['pt-9'] });
    expect(surfaceOf(geometry).cachedRevision).toBeNull();
    expect(surfaceOf(geometry).buildDiagnostic).toBeUndefined();
    expect(surfaceOf(geometry).styleId).toBe('style-x');
    const renamed = run(history, { key: 'SURFACE_RENAME', surfaceId: id, name: 'Renamed' });
    expect(surfaceOf(renamed).cachedRevision).toBe('rev-1');
    expect(surfaceOf(renamed).buildDiagnostic).toBe('old');
    expect(surfaceOf(renamed).styleId).toBe('style-x');
  });

  it('adds/replaces outer and void boundaries and removes by kind', () => {
    const { history, id } = siteHistory();
    let next = run(history, { key: 'SURFACE_ADD_BOUNDARY', surfaceId: id, kind: 'outer', sourceEntityId: 'ring-outer' });
    next = run(next, { key: 'SURFACE_ADD_BOUNDARY', surfaceId: id, kind: 'void', sourceEntityId: 'ring-alt' });
    expect(boundariesOf(next, 'outer')).toBe(1);
    expect(boundariesOf(next, 'void')).toBe(1);
    next = run(next, { key: 'SURFACE_ADD_BOUNDARY', surfaceId: id, kind: 'outer', sourceEntityId: 'ring-alt' });
    expect(boundariesOf(next, 'outer')).toBe(1);
    expect(surfaceOf(next).definition.boundaries!.find((entry) => entry.type === 'outer')!.sourceEntityId)
      .toBe('ring-alt');
    next = run(next, { key: 'SURFACE_REMOVE_BOUNDARY', surfaceId: id, kind: 'void' });
    expect(boundariesOf(next, 'void')).toBe(0);
    next = run(next, { key: 'SURFACE_REMOVE_BOUNDARY', surfaceId: id, kind: 'outer' });
    expect(boundariesOf(next, 'outer')).toBe(0);
  });

  it('rejects malformed boundary candidates and non-ring sources', () => {
    const { history, id } = siteHistory();
    const depth = history.undoStack.length;
    expect(run(history, {
      key: 'SURFACE_CREATE_BOUNDARY_SOURCE', surfaceId: id, kind: 'outer',
      vertices: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
    })).toBe(history);
    expect(run(history, { key: 'SURFACE_ADD_BOUNDARY', surfaceId: id, kind: 'outer', sourceEntityId: 'ghost' }))
      .toBe(history);
    expect(run(history, { key: 'SURFACE_ADD_BOUNDARY', surfaceId: id, kind: 'outer', sourceEntityId: 'pt-1' }))
      .toBe(history);
    expect(history.undoStack).toHaveLength(depth);
  });

  it('edits one dual-sourced breakline while preserving its sibling exactly', () => {
    const { history, id } = siteHistory();
    const withEntity: CadProject = {
      ...history.present.project,
      surfaces: history.present.project.surfaces!.map((surface) => surface.id === id ? {
        ...surface,
        definition: {
          ...surface.definition,
          breaklines: [
            ...(surface.definition.breaklines ?? []),
            { id: 'bl-entity', source: { kind: 'entity' as const, entityId: 'ch-1' }, type: 'standard' as const },
          ],
        },
      } : surface),
    };
    const base = run(createCadHistoryState(withEntity), {
      key: 'SURFACE_ADD_BREAKLINE', surfaceId: id, pointIds: ['pt-3', 'pt-4'], name: 'Chain',
    });
    const chainId = surfaceOf(base).definition.breaklines!.find((entry) => entry.id !== 'bl-entity')!.id;
    const edited = run(base, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT', surfaceId: id, breaklineId: chainId,
      pointEntityId: 'pt-2', insertIndex: 1,
    });
    const breaklines = surfaceOf(edited).definition.breaklines!;
    expect(breaklines.find((entry) => entry.id === 'bl-entity')).toEqual(
      surfaceOf(base).definition.breaklines!.find((entry) => entry.id === 'bl-entity'));
    const chain = breaklines.find((entry) => entry.id === chainId)!;
    expect(chain.source).toEqual({ kind: 'point-chain', pointEntityIds: ['pt-3', 'pt-2', 'pt-4'] });
  });

  it('undo/redo round-trips a single surface edit entry', () => {
    const { history, id } = siteHistory();
    const before = JSON.stringify(history.present.project.surfaces);
    const edited = run(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId: id, kind: 'outer', sourceEntityId: 'ring-outer',
    });
    expect(edited.undoStack).toHaveLength(history.undoStack.length + 1);
    const undone = undoCadHistory(edited);
    expect(JSON.stringify(undone.present.project.surfaces)).toBe(before);
    expect(JSON.stringify(redoCadHistory(undone).present.project.surfaces))
      .toBe(JSON.stringify(edited.present.project.surfaces));
  });

  it('round-trips the definition through WNCAD save/reopen', () => {
    const { history, id } = siteHistory();
    let next = run(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId: id, kind: 'outer', sourceEntityId: 'ring-outer',
    });
    next = run(next, { key: 'SURFACE_ADD_BREAKLINE', surfaceId: id, pointIds: ['pt-1', 'pt-3'], name: 'Ridge' });
    const drawing = createBlankCadDrawingDocument({ name: 'STRUCT-195.1', units: 'm' });
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project: next.present.project }));
    if (!parsed.ok) throw new Error(`roundtrip failed: ${parsed.errors.join('; ')}`);
    const reopened = parsed.drawing.project.surfaces!.find((surface) => surface.id === id)!;
    expect(reopened.definition.boundaries).toEqual(surfaceOf(next).definition.boundaries);
    expect(reopened.definition.breaklines).toEqual(surfaceOf(next).definition.breaklines);
  });
});
