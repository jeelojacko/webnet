// STRUCT-195.2 — CAD core primitive type-leaf dependency-graph guard.
//
// Pins the four agreed system edges severed by the primitive leaf split and
// proves no new runtime VALUE cycle was introduced among the touched modules
// (the #195.1 value acyclicity stays intact). Type-level residual SCCs are
// tracked separately in docs/evidence/struct-1952/architecture.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildGraphs,
  collectTypeScriptFiles,
  findCycles,
  parseImports,
  reachableFrom,
  tarjanSCC,
} from '../scripts/cadTypeImportGraph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abs = (relative: string): string => path.resolve(ROOT, relative);
const exists = (relative: string): boolean => fs.existsSync(abs(relative));

const GRAPH_DIRS = ['src/engine/cad', 'src/engine/fieldToFinish', 'src/cad-app/blocks'];

const loadGraph = () => {
  const files = GRAPH_DIRS.flatMap((dir) => collectTypeScriptFiles(path.join(ROOT, dir)));
  return buildGraphs(files.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
};

const kindsBetween = (
  graph: ReturnType<typeof buildGraphs>,
  from: string,
  to: string,
): string[] =>
  graph.edges.filter((edge) => edge.from === abs(from) && edge.to === abs(to)).map((edge) => edge.kind);

const PRIMITIVE_LEAF = 'src/engine/cad/cadCorePrimitiveTypes.ts';
const CAD_TYPES = 'src/engine/cad/cadTypes.ts';

const TOUCHED_MODULES = [
  PRIMITIVE_LEAF,
  CAD_TYPES,
  'src/engine/cad/cadDisplayTypes.ts',
  'src/engine/cad/cadDraftTypes.ts',
  'src/engine/cad/cadTransactions.types.ts',
  'src/engine/cad/cadSelection.ts',
  'src/engine/fieldToFinish/linkedSync.ts',
  'src/engine/fieldToFinish/fieldToFinishLinkTypes.ts',
];

describe('STRUCT-195.2 CAD primitive leaves sever the agreed type edges', () => {
  const graph = loadGraph();

  it('display/draft primitives point at the leaf, never at cadTypes', () => {
    expect(kindsBetween(graph, 'src/engine/cad/cadDisplayTypes.ts', CAD_TYPES)).toEqual([]);
    expect(kindsBetween(graph, 'src/engine/cad/cadDisplayTypes.ts', PRIMITIVE_LEAF)).toContain('type');

    expect(kindsBetween(graph, 'src/engine/cad/cadDraftTypes.ts', CAD_TYPES)).toEqual([]);
    expect(kindsBetween(graph, 'src/engine/cad/cadDraftTypes.ts', PRIMITIVE_LEAF)).toContain('type');
    // Draft keeps its real runtime dependencies (id + styles constants).
    const draftImports = parseImports(
      fs.readFileSync(abs('src/engine/cad/cadDraftTypes.ts'), 'utf8'),
      'cadDraftTypes.ts',
    );
    expect(draftImports).toContainEqual({ specifier: '../id', kind: 'value' });
    expect(draftImports).toContainEqual({ specifier: './cadStyles', kind: 'value' });
  });

  it('cadTypes re-exports the primitives from the leaf instead of linkedSync', () => {
    expect(kindsBetween(graph, CAD_TYPES, 'src/engine/fieldToFinish/linkedSync.ts')).toEqual([]);
    expect(kindsBetween(graph, CAD_TYPES, 'src/engine/fieldToFinish/fieldToFinishLinkTypes.ts')).toContain('type');
    // The re-export contract keeps a type edge to the leaf.
    expect(kindsBetween(graph, CAD_TYPES, PRIMITIVE_LEAF)).toContain('type');
  });

  it('transaction types depend on the selection type leaf', () => {
    // Opportunistic fourth edge: Worker B owns cadSelectionTypes.ts.
    if (!exists('src/engine/cad/cadSelectionTypes.ts')) return;
    expect(kindsBetween(graph, 'src/engine/cad/cadTransactions.types.ts', 'src/engine/cad/cadSelection.ts')).toEqual([]);
    expect(kindsBetween(graph, 'src/engine/cad/cadTransactions.types.ts', 'src/engine/cad/cadSelectionTypes.ts')).toContain(
      'type',
    );
  });

  it('introduces no runtime value SCC among the touched modules', () => {
    const components = tarjanSCC(graph.nodes, graph.value);
    for (const mod of TOUCHED_MODULES) {
      if (!exists(mod)) continue;
      const component = components.find((entry) => entry.includes(abs(mod)));
      expect(component).toEqual([abs(mod)]);
    }
  });

  it('has no value path between the severed primitive pairs', () => {
    expect(reachableFrom(abs(CAD_TYPES), abs('src/engine/cad/cadDisplayTypes.ts'), graph.value)).toBe(false);
    expect(reachableFrom(abs('src/engine/cad/cadDisplayTypes.ts'), abs(CAD_TYPES), graph.value)).toBe(false);
    expect(reachableFrom(abs(CAD_TYPES), abs('src/engine/cad/cadDraftTypes.ts'), graph.value)).toBe(false);
    expect(reachableFrom(abs('src/engine/cad/cadDraftTypes.ts'), abs(CAD_TYPES), graph.value)).toBe(false);
  });

  it('keeps the #195.1 runtime acyclicity fixed (surface + block value SCCs)', () => {
    const cycles = findCycles(graph.nodes, graph.value);
    const acyclic = (mod: string): void => expect(cycles.cyclicNodes.has(abs(mod))).toBe(false);

    // Block UI/reference split (STRUCT-195.1 Worker B).
    acyclic('src/cad-app/blocks/cadBlockUiCommands.ts');
    acyclic('src/cad-app/blocks/cadBlockReferenceOps.ts');
    acyclic('src/cad-app/blocks/cadBlockUiCommon.ts');
    expect(
      reachableFrom(
        abs('src/cad-app/blocks/cadBlockReferenceOps.ts'),
        abs('src/cad-app/blocks/cadBlockUiCommands.ts'),
        graph.value,
      ),
    ).toBe(false);

    // Surface transaction split (STRUCT-195.1 Worker A).
    acyclic('src/engine/cad/cadTransactionsSurfaceCommands.ts');
    acyclic('src/engine/cad/cadTransactionsSurfaceBoundaryCommands.ts');
    acyclic('src/engine/cad/cadTransactionsSurfaceCore.ts');
    expect(
      reachableFrom(
        abs('src/engine/cad/cadTransactionsSurfaceBoundaryCommands.ts'),
        abs('src/engine/cad/cadTransactionsSurfaceCommands.ts'),
        graph.value,
      ),
    ).toBe(false);
  });

  it('keeps the blocks slice type-acyclic (STRUCT-195.15 audit pin)', () => {
    // Cheap reuse of the already-built GRAPH_DIRS graph (cad + fieldToFinish
    // + cad-app/blocks): no TYPE SCC anywhere in this scope at HEAD.
    expect(findCycles(graph.nodes, graph.type).cyclic).toEqual([]);
  });

  it('resolves historical snapshot edges purely from the supplied in-memory set', () => {
    // Regression pin: snapshot entries (e.g. from `git show <ref>:<path>`)
    // may reference files since removed from the working tree, so none of
    // these paths exist on the live filesystem. Resolution must succeed via
    // the supplied key set alone: relative, `.js` -> `.ts`, index, and
    // tsconfig-alias forms.
    const graph = buildGraphs(
      {
        '/snapshot/a.ts': "import type { X } from './removed';\nimport { y } from './b.js';\nimport { z } from './dir';\nimport { w } from '@/aliased';",
        '/snapshot/removed.ts': 'export type X = string;',
        '/snapshot/b.ts': 'export const y = 1;',
        '/snapshot/dir/index.ts': 'export const z = 2;',
        '/snapshot/aliased.ts': 'export const w = 3;',
      },
      { aliases: { baseUrl: '/snapshot', paths: { '@/*': ['*'] } } },
    );
    expect(graph.unresolved).toEqual([]);
    const targets = graph.edges.map((edge) => edge.to).sort();
    expect(targets).toEqual([
      '/snapshot/aliased.ts',
      '/snapshot/b.ts',
      '/snapshot/dir/index.ts',
      '/snapshot/removed.ts',
    ]);
  });
});
