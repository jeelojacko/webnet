// STRUCT-240.1 — surveyCad command-session 3-node TYPE cycle regression.
//
// BEFORE (final pre-fix shape, reproduced in-memory by the negative control):
//   useSurveyCadCommandTypes      --type--> useSurveyCadCurveF1Session
//                                 (CadCurveF1ExtentMode alias lived in the session)
//   useSurveyCadCurveF1Session    --type--> useSurveyCadCommandTypes
//                                 (CommandPoint / CommandSession)
//   useSurveyCadCurveF1Session    --type--> useSurveyCadCommandPreview
//                                 (CadCommandPreviewState)
//   useSurveyCadCommandPreview    --type--> useSurveyCadCommandTypes
//                                 (CommandSession / CadLineL1SessionState)
//   => the exact 3-node TYPE SCC
//      {useSurveyCadCommandTypes, useSurveyCadCurveF1Session, useSurveyCadCommandPreview}
//
// AFTER (Worker A production state this suite pins):
//   - the alias moves to the type-only leaf
//     src/hooks/surveyCad/useSurveyCadCurveF1ExtentTypes.ts
//     (`export type CadCurveF1ExtentMode = Exclude<CadCurveMetricMode, 'radius'>`
//      + verbatim comment, engine import only);
//   - useSurveyCadCommandTypes imports the alias from the leaf (no session import);
//   - useSurveyCadCurveF1Session imports the alias from the leaf and keeps the
//     historic old-path re-export `export type { CadCurveF1ExtentMode } from ...`;
//   - useSurveyCadCommandPreview stays byte-identical (it never imported the leaf);
//   => the session<->types alias edge is gone, so the TYPE SCC dissolves.
//
// This suite is deliberately self-contained and in-process: it reads the
// ACTUAL file sources via fs and uses scripts/cadTypeImportGraph.mjs
// (buildGraphs/parseImports/tarjanSCC/findCycles) over a CURATED 5-node scoped
// universe (4 hooks + the cadCurveMetricsSolver engine leaf for resolution).
// No subprocess, no network, no git show / loadSourcesFromGit, no full-src
// graph, no fixtures/snapshots. Runtime is ~tens of milliseconds.
//
// Existing F1 oracle suites (NOT edited here, presence asserted below):
//   tests/cad_curves_f1_sessions.test.ts
//   tests/cadCogo/cadCurvesF1.transactions.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { buildGraphs, collectTypeScriptFiles, findCycles, parseImports, tarjanSCC } from '../scripts/cadTypeImportGraph.mjs';

import type { CadCurveMetricMode } from '../src/engine/cad/cadCurveMetricsSolver';
import type { CadCurveF1ExtentMode as LeafExtentMode } from '../src/hooks/surveyCad/useSurveyCadCurveF1ExtentTypes';
import type { CadCurveF1ExtentMode as OldPathExtentMode } from '../src/hooks/surveyCad/useSurveyCadCurveF1Session';
import type { CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
// Posix-normalized absolute paths: buildGraphs/collectTypeScriptFiles return
// posix keys, so every comparison below is separator-stable cross-platform.
const abs = (relative: string): string => path.resolve(REPO_ROOT, relative).split(path.sep).join('/');

const LEAF = 'src/hooks/surveyCad/useSurveyCadCurveF1ExtentTypes.ts';
const TYPES = 'src/hooks/surveyCad/useSurveyCadCommandTypes.ts';
const SESSION = 'src/hooks/surveyCad/useSurveyCadCurveF1Session.ts';
const PREVIEW = 'src/hooks/surveyCad/useSurveyCadCommandPreview.ts';
const ENGINE_METRICS = 'src/engine/cad/cadCurveMetricsSolver.ts';

const LEAF_SPECIFIER = './useSurveyCadCurveF1ExtentTypes';
const SESSION_SPECIFIER = './useSurveyCadCurveF1Session';
const TYPES_SPECIFIER = './useSurveyCadCommandTypes';
const PREVIEW_SPECIFIER = './useSurveyCadCommandPreview';

const SCOPED_SOURCES = [LEAF, TYPES, SESSION, PREVIEW, ENGINE_METRICS];
const SCC_TRIO = [TYPES, SESSION, PREVIEW];

/** Curated in-process graph universe: the 4 hooks + the resolving engine leaf. */
const SCOPED_ENTRIES = SCOPED_SOURCES.map((relative) => ({ path: abs(relative), source: readSource(relative) }));

const ORACLE_SESSION_SUITE = 'tests/cad_curves_f1_sessions.test.ts';
const ORACLE_TRANSACTION_SUITE = 'tests/cadCogo/cadCurvesF1.transactions.test.ts';

function readSource(relative: string): string {
  const absolute = abs(relative);
  if (!fs.existsSync(absolute)) {
    throw new Error(
      `STRUCT-240.1 blocked: expected source ${relative} (Worker A leaf/splice) is not present yet`,
    );
  }
  return fs.readFileSync(absolute, 'utf8');
}

const sourceOf = (relative: string): string => readSource(relative);
const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim();
const countOccurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

const parse = (relative: string): ts.SourceFile =>
  ts.createSourceFile(abs(relative), sourceOf(relative), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/** Type-level `IsExact`: mutual assignability in both directions. */
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type IsExact<A, B> = IsAssignable<A, B> extends true ? IsAssignable<B, A> : false;

type ExtentModeOf<S> = S extends { extentMode: infer M } ? M : never;
type CurveFromEndSession = Extract<CommandSession, { key: 'CURVE_FROM_END' }>;
type ReverseOrCompoundSession = Extract<CommandSession, { key: 'REVERSE_OR_COMPOUND' }>;
type BaselineExtentMode = Exclude<CadCurveMetricMode, 'radius'>;
/** In-memory mutation for the negative control: the `'radius'` exclusion is dropped. */
type MutatedExtentMode = CadCurveMetricMode;

// Const-level (typecheck-enforced) verdicts. A drift in any direction flips one
// of these to the other boolean and fails `tsc`; the runtime `expect`s below
// also surface the polarity so the control can never pass silently.
const LEAF_EXACT_BASELINE: IsExact<LeafExtentMode, BaselineExtentMode> = true;
const OLD_PATH_EXACT_LEAF: IsExact<OldPathExtentMode, LeafExtentMode> = true;
const OLD_PATH_EXACT_BASELINE: IsExact<OldPathExtentMode, BaselineExtentMode> = true;
const RADIUS_ASSIGNABLE_TO_REAL: IsAssignable<'radius', LeafExtentMode> = false;
const RADIUS_ASSIGNABLE_TO_MUTATED: IsAssignable<'radius', MutatedExtentMode> = true;
const MUTATED_EXACT_LEAF: IsExact<MutatedExtentMode, LeafExtentMode> = false;
const CFE_EXTENT_MODE: IsExact<ExtentModeOf<CurveFromEndSession>, LeafExtentMode | null> = true;
const ROC_EXTENT_MODE: IsExact<ExtentModeOf<ReverseOrCompoundSession>, LeafExtentMode | null> = true;

interface ExtentModePin {
  keyText: string;
  text: string;
  optional: boolean;
}

const commandSessionExtentModePins = (): ExtentModePin[] => {
  const file = parse(TYPES);
  const alias = file.statements.find(
    (statement): statement is ts.TypeAliasDeclaration =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === 'CommandSession',
  );
  if (!alias) throw new Error('CommandSession type alias not found in useSurveyCadCommandTypes.ts');
  const members = ts.isUnionTypeNode(alias.type) ? alias.type.types : [];
  const pins: ExtentModePin[] = [];
  for (const member of members) {
    if (!ts.isTypeLiteralNode(member)) continue;
    const keyProp = member.members.find(
      (candidate): candidate is ts.PropertySignature =>
        ts.isPropertySignature(candidate) && candidate.name.getText() === 'key',
    );
    const keyText = keyProp?.type ? keyProp.type.getText() : '';
    if (keyText === '') continue;
    const keys = keyText.split('|').map((part) => part.trim().replace(/^['"]|['"]$/g, ''));
    if (!keys.includes('CURVE_FROM_END') && !keys.includes('REVERSE_OR_COMPOUND')) continue;
    const extent = member.members.find(
      (candidate): candidate is ts.PropertySignature =>
        ts.isPropertySignature(candidate) && candidate.name.getText() === 'extentMode',
    );
    if (!extent) throw new Error(`extentMode property missing from CommandSession variant ${keyText}`);
    const question = extent.questionToken ? '?' : '';
    const typeText = extent.type ? extent.type.getText() : '<missing-type>';
    pins.push({ keyText, text: normalize(`extentMode${question}: ${typeText};`), optional: extent.questionToken != null });
  }
  return pins;
};

const hasTypeOnlyNamedImport = (relative: string, specifier: string, name: string): boolean => {
  for (const statement of parse(relative).statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== specifier) continue;
    const clause = statement.importClause;
    if (!clause) continue;
    const named = clause.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    const typeOnlyClause = clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
    if (named.elements.some((element) => element.name.text === name && (typeOnlyClause || element.isTypeOnly))) {
      return true;
    }
  }
  return false;
};

const hasTypeOnlyNamedReexport = (relative: string, specifier: string, name: string): boolean => {
  for (const statement of parse(relative).statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== specifier) continue;
    const clause = statement.exportClause;
    if (!clause || !ts.isNamedExports(clause)) continue;
    if (clause.elements.some((element) => element.name.text === name && (statement.isTypeOnly || element.isTypeOnly))) {
      return true;
    }
  }
  return false;
};

const typeComponents = (entries: Array<{ path: string; source: string }>) => {
  const graphs = buildGraphs(entries);
  return { graphs, components: tarjanSCC(graphs.nodes, graphs.type), cycles: findCycles(graphs.nodes, graphs.type) };
};

const scopedEntries = (): Array<{ path: string; source: string }> =>
  SCOPED_SOURCES.map((relative) => ({ path: abs(relative), source: sourceOf(relative) }));

const scopedEntry = (entries: Array<{ path: string; source: string }>, relative: string) => {
  const entry = entries.find((candidate) => candidate.path === abs(relative));
  if (!entry) throw new Error(`scoped entry missing: ${relative}`);
  return entry;
};

describe('STRUCT-240.1 surveyCad command-session TYPE cycle', () => {
  it('leaf pins the alias, comment, and engine import verbatim', () => {
    const source = sourceOf(LEAF);
    expect(source).toContain("import type { CadCurveMetricMode } from '../../engine/cad/cadCurveMetricsSolver';");
    expect(source).toContain('/** Extent metric modes (radius excluded: the radius is carried separately). */');
    expect(source).toContain("export type CadCurveF1ExtentMode = Exclude<CadCurveMetricMode, 'radius'>;");

    const leafEdges = parseImports(source, abs(LEAF));
    expect(leafEdges).toEqual([{ specifier: '../../engine/cad/cadCurveMetricsSolver', kind: 'type' }]);
  });

  it('leaf alias is exactly the old-path re-export and the Exclude baseline (bidirectional)', () => {
    expect(LEAF_EXACT_BASELINE).toBe(true);
    expect(OLD_PATH_EXACT_LEAF).toBe(true);
    expect(OLD_PATH_EXACT_BASELINE).toBe(true);

    expectTypeOf<LeafExtentMode>().toEqualTypeOf<BaselineExtentMode>();
    expectTypeOf<BaselineExtentMode>().toEqualTypeOf<LeafExtentMode>();
    expectTypeOf<OldPathExtentMode>().toEqualTypeOf<LeafExtentMode>();
    expectTypeOf<LeafExtentMode>().toEqualTypeOf<OldPathExtentMode>();
    expectTypeOf<OldPathExtentMode>().toEqualTypeOf<BaselineExtentMode>();
  });

  it('negative control: dropping the radius exclusion admits radius and breaks the pin', () => {
    // The real alias rejects `'radius'`; the in-memory mutated alias accepts it.
    expect(RADIUS_ASSIGNABLE_TO_REAL).toBe(false);
    expect(RADIUS_ASSIGNABLE_TO_MUTATED).toBe(true);
    expect(MUTATED_EXACT_LEAF).toBe(false);

    expectTypeOf<'radius'>().not.toEqualTypeOf<LeafExtentMode>();
    expectTypeOf<LeafExtentMode>().not.toEqualTypeOf<MutatedExtentMode>();

    // Same mutation expressed over the pinned source text: removing the
    // exclusion changes the exact alias line, so the string pin above would
    // fail for a mutated leaf.
    const realLeaf = sourceOf(LEAF);
    const mutatedLeaf = realLeaf.replace("Exclude<CadCurveMetricMode, 'radius'>", 'CadCurveMetricMode');
    expect(mutatedLeaf).not.toBe(realLeaf);
    expect(mutatedLeaf).not.toContain("Exclude<CadCurveMetricMode, 'radius'>");
    expect(realLeaf).toContain("Exclude<CadCurveMetricMode, 'radius'>");
  });

  it('CURVE_FROM_END + REVERSE_OR_COMPOUND keep extentMode: CadCurveF1ExtentMode | null', () => {
    const normalized = normalize(sourceOf(TYPES));
    expect(countOccurrences(normalized, 'extentMode: CadCurveF1ExtentMode | null;')).toBe(2);

    const pins = commandSessionExtentModePins();
    expect(pins.map((pin) => pin.keyText)).toEqual(["'CURVE_FROM_END'", "'REVERSE_OR_COMPOUND'"]);
    for (const pin of pins) {
      expect(pin.optional).toBe(false);
      expect(pin.text).toBe('extentMode: CadCurveF1ExtentMode | null;');
    }

    expectTypeOf<ExtentModeOf<CurveFromEndSession>>().toEqualTypeOf<LeafExtentMode | null>();
    expectTypeOf<ExtentModeOf<ReverseOrCompoundSession>>().toEqualTypeOf<LeafExtentMode | null>();
    expect(CFE_EXTENT_MODE).toBe(true);
    expect(ROC_EXTENT_MODE).toBe(true);
  });

  it('import direction: Types -> leaf only; session keeps the historic re-export; leaf stays type-only', () => {
    const typesEdges = parseImports(sourceOf(TYPES), abs(TYPES));
    expect(typesEdges.every((edge) => edge.specifier !== SESSION_SPECIFIER)).toBe(true);
    expect(normalize(sourceOf(TYPES))).not.toContain('useSurveyCadCurveF1Session');
    expect(hasTypeOnlyNamedImport(TYPES, LEAF_SPECIFIER, 'CadCurveF1ExtentMode')).toBe(true);

    expect(hasTypeOnlyNamedReexport(SESSION, LEAF_SPECIFIER, 'CadCurveF1ExtentMode')).toBe(true);
    expect(normalize(sourceOf(SESSION))).toContain(
      `export type { CadCurveF1ExtentMode } from '${LEAF_SPECIFIER}';`,
    );

    const leafEdges = parseImports(sourceOf(LEAF), abs(LEAF));
    for (const forbidden of [SESSION_SPECIFIER, TYPES_SPECIFIER, PREVIEW_SPECIFIER]) {
      expect(leafEdges.every((edge) => edge.specifier !== forbidden)).toBe(true);
    }

    // No runtime value import of the leaf anywhere under src/.
    const leafBasename = path.basename(LEAF, '.ts');
    const referencing = collectTypeScriptFiles(abs('src')).filter((file) => fs.readFileSync(file, 'utf8').includes(leafBasename));
    expect(referencing.sort()).toEqual([abs(SESSION), abs(TYPES)].sort());
    for (const file of referencing) {
      const source = fs.readFileSync(file, 'utf8');
      for (const edge of parseImports(source, file)) {
        if (edge.specifier.includes(leafBasename)) expect(edge.kind).toBe('type');
      }
    }
  });

  it('scoped TYPE graph has no SCC; each SCC-trio node is its own singleton', () => {
    const { components, cycles } = typeComponents(SCOPED_ENTRIES);
    expect(cycles.cyclic).toEqual([]);
    for (const relative of SCC_TRIO) {
      const component = components.find((candidate) => candidate.includes(abs(relative)));
      expect(component).toEqual([abs(relative)]);
    }
    expect(components.find((candidate) => candidate.includes(abs(LEAF)))).toEqual([abs(LEAF)]);
  });

  it('negative control: restoring Types -> F1 type import recreates the exact 3-node SCC', () => {
    const entries = scopedEntries();
    const typesEntry = scopedEntry(entries, TYPES);
    const variant = entries.map((entry) =>
      entry.path === typesEntry.path
        ? { ...entry, source: `import type { CadCurveF1ExtentMode } from '${SESSION_SPECIFIER}';\n${entry.source}` }
        : entry,
    );

    const restored = typeComponents(variant);
    const expected = [abs(TYPES), abs(SESSION), abs(PREVIEW)].sort();
    expect(expected).toHaveLength(3);
    expect(restored.cycles.cyclic).toEqual([expected]);
    expect(restored.graphs.type.get(abs(TYPES))).toContain(abs(SESSION));

    // The real graph does not have the session edge that closes the cycle.
    const real = typeComponents(entries);
    expect(real.graphs.type.get(abs(TYPES))).not.toContain(abs(SESSION));
    expect(real.cycles.cyclic).toEqual([]);
  });

  it('existing F1 oracle suites remain present (not edited here)', () => {
    expect(fs.existsSync(abs(ORACLE_SESSION_SUITE))).toBe(true);
    expect(fs.existsSync(abs(ORACLE_TRANSACTION_SUITE))).toBe(true);
  });
});
