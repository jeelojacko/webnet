#!/usr/bin/env node
/**
 * STRUCT-195.2 reusable TypeScript-Compiler-API import-graph tool.
 *
 * Parses every static import/reexport statement with the TypeScript compiler
 * API and classifies each module edge as a JS runtime VALUE edge, a
 * type-only TYPE edge, or MIXED (a single `import`/`export` clause with both
 * runtime and type-only bindings). It resolves relative `.ts`/`.tsx`/index
 * specifiers (plus `.js` → `.ts` bundler-style specifiers) and tsconfig
 * `paths` aliases, builds sorted adjacency maps, and exposes a deterministic
 * Tarjan SCC/cyclic-component classifier.
 *
 * Input is either an in-memory entry list (`{ path, source }`), a filesystem
 * walk, or a READ-ONLY `git show <ref>:<path>` snapshot (`loadSourcesFromGit`
 * never checks out, applies stashes, or mutates the work tree).
 *
 * Zero new dependencies: `typescript` is already installed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

/** Candidate source extensions probed in this deterministic order. */
export const MODULE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Directory-ish basenames probed for index resolution, in order. */
export const INDEX_BASENAMES = ['index'];

const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-webnet',
  '.git',
  'cpp',
  'emsdk',
  'study-content',
  'coverage',
  'artifacts',
]);

const toPosix = (filePath) => path.resolve(filePath).split(path.sep).join('/');

const scriptKindFor = (filePath) => {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js') || filePath.endsWith('.mjs') || filePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
};

/**
 * Classify one import/export declaration. Returns `{ specifier, kind }`
 * where kind is 'value' | 'type' | 'mixed', or `null` when the statement is
 * not a module edge (e.g. a local re-export with no module specifier).
 */
const classifyClause = (statement) => {
  if (ts.isImportDeclaration(statement)) {
    if (!ts.isStringLiteral(statement.moduleSpecifier)) return null;
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (!clause) return { specifier, kind: 'value' };
    if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword || clause.isTypeOnly) {
      return { specifier, kind: 'type' };
    }
    let hasValue = clause.name != null;
    let hasType = false;
    const bindings = clause.namedBindings;
    if (bindings != null) {
      if (ts.isNamespaceImport(bindings)) {
        hasValue = true;
      } else if (ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (element.isTypeOnly) hasType = true;
          else hasValue = true;
        }
      }
    }
    return { specifier, kind: hasValue && hasType ? 'mixed' : hasType ? 'type' : 'value' };
  }
  if (ts.isExportDeclaration(statement)) {
    if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return null;
    const specifier = statement.moduleSpecifier.text;
    if (statement.isTypeOnly) return { specifier, kind: 'type' };
    const clause = statement.exportClause;
    if (clause != null && ts.isNamedExports(clause)) {
      let hasValue = false;
      let hasType = false;
      for (const element of clause.elements) {
        if (element.isTypeOnly) hasType = true;
        else hasValue = true;
      }
      return { specifier, kind: hasValue && hasType ? 'mixed' : hasType ? 'type' : 'value' };
    }
    // `export *` / `export * as ns` are runtime edges.
    return { specifier, kind: 'value' };
  }
  return null;
};

/**
 * Parse the module edges of one source string, in source order.
 * @returns {Array<{ specifier: string, kind: 'value'|'type'|'mixed' }>}
 */
export function parseImports(sourceText, fileName = 'input.ts') {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, false, scriptKindFor(fileName));
  const edges = [];
  for (const statement of source.statements) {
    const classified = classifyClause(statement);
    if (classified) edges.push(classified);
  }
  return edges;
}

/** Read tsconfig `baseUrl` + `paths` for alias resolution. */
export function loadTsconfigAliases(tsconfigPath) {
  const read = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config ?? {}, ts.sys, path.dirname(tsconfigPath));
  return {
    baseUrl: parsed.options.baseUrl ?? path.dirname(tsconfigPath),
    paths: parsed.options.paths ?? {},
  };
}

const aliasCandidates = (specifier, aliases) => {
  if (!aliases) return [];
  const out = [];
  for (const [pattern, targets] of Object.entries(aliases.paths)) {
    const star = pattern.indexOf('*');
    if (star === -1) {
      if (pattern === specifier) for (const target of targets) out.push(path.resolve(aliases.baseUrl, target));
      continue;
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
      const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const target of targets) out.push(path.resolve(aliases.baseUrl, target.replace('*', middle)));
    }
  }
  return out;
};

const probeCandidate = (candidate, fileSet) => {
  // Snapshot runs supply the full source set (e.g. via `git show <ref>:<path>`);
  // resolve purely against those in-memory keys so files removed since the
  // ref still resolve. Filesystem probing applies only to live mode
  // (`fileSet == null`), where no curated universe was supplied.
  const snapshotMode = fileSet != null;
  const present = (p) => (snapshotMode ? fileSet.has(toPosix(p)) : fs.existsSync(p));
  if (MODULE_EXTENSIONS.some((ext) => candidate.endsWith(ext)) && present(candidate)) {
    return toPosix(candidate);
  }
  // Bundler-style `./foo.js` may actually be `./foo.ts`.
  for (const ext of ['.js', '.mjs', '.cjs']) {
    if (candidate.endsWith(ext)) {
      const stem = candidate.slice(0, -ext.length);
      for (const replacement of ['.ts', '.tsx']) {
        const mapped = stem + replacement;
        if (present(mapped)) return toPosix(mapped);
      }
    }
  }
  for (const ext of MODULE_EXTENSIONS) {
    const withExt = candidate + ext;
    if (present(withExt)) return toPosix(withExt);
  }
  for (const base of INDEX_BASENAMES) {
    for (const ext of MODULE_EXTENSIONS) {
      const index = path.join(candidate, base + ext);
      if (present(index)) return toPosix(index);
    }
  }
  return null;
};

/**
 * Resolve a specifier from `fromFile` to an absolute posix path (or null
 * for bare/node_modules specifiers or unresolved paths). When `options.files`
 * is provided (a collection of known paths) only those files resolve, which
 * lets SCC runs treat a curated subset as the universe.
 */
export function resolveModule(fromFile, specifier, options = {}) {
  const fileSet = options.files ? new Set(Array.from(options.files, toPosix)) : null;
  if (specifier.startsWith('.')) {
    return probeCandidate(path.resolve(path.dirname(fromFile), specifier), fileSet);
  }
  for (const candidate of aliasCandidates(specifier, options.aliases)) {
    const resolved = probeCandidate(candidate, fileSet);
    if (resolved) return resolved;
  }
  return null;
}

/** Normalize an entries argument into a sorted `Array<{ path, source }>`. */
const normalizeEntries = (entries) => {
  if (Array.isArray(entries)) {
    return entries.map((entry) =>
      typeof entry === 'string'
        ? { path: toPosix(entry), source: fs.readFileSync(entry, 'utf8') }
        : { path: toPosix(entry.path), source: entry.source },
    );
  }
  return Object.entries(entries).map(([file, source]) => ({ path: toPosix(file), source }));
};

const emptyAdjacency = () => new Map();

const addEdge = (adjacency, from, to) => {
  if (!adjacency.has(from)) adjacency.set(from, new Set());
  adjacency.get(from).add(to);
};

const freezeAdjacency = (nodes, adjacency) => {
  const frozen = new Map();
  for (const node of nodes) {
    frozen.set(node, [...(adjacency.get(node) ?? [])].sort());
  }
  return frozen;
};

/**
 * Build the sorted value/type adjacency maps for a set of source entries.
 * A MIXED edge contributes to BOTH graphs (it has runtime bindings and
 * type-only bindings).
 */
export function buildGraphs(entries, options = {}) {
  const sources = normalizeEntries(entries).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const fileSet = new Set(sources.map((entry) => entry.path));
  const nodeSet = new Set(fileSet);
  const valueRaw = emptyAdjacency();
  const typeRaw = emptyAdjacency();
  const edges = [];
  const unresolved = [];
  for (const { path: file, source } of sources) {
    for (const { specifier, kind } of parseImports(source, file)) {
      const resolved = resolveModule(file, specifier, { ...options, files: fileSet });
      if (!resolved) {
        unresolved.push({ from: file, specifier, kind });
        continue;
      }
      nodeSet.add(resolved);
      edges.push({ from: file, to: resolved, specifier, kind });
      if (kind === 'value' || kind === 'mixed') addEdge(valueRaw, file, resolved);
      if (kind === 'type' || kind === 'mixed') addEdge(typeRaw, file, resolved);
    }
  }
  const nodes = [...nodeSet].sort();
  return {
    nodes,
    value: freezeAdjacency(nodes, valueRaw),
    type: freezeAdjacency(nodes, typeRaw),
    edges: edges.sort((a, b) => (a.from + a.to + a.specifier < b.from + b.to + b.specifier ? -1 : 1)),
    unresolved,
  };
}

/**
 * Deterministic iterative Tarjan SCC. `nodes` is the full node list;
 * `adjacency` is a Map<string, string[]>. Returns components sorted by their
 * smallest member, each component's members sorted.
 */
export function tarjanSCC(nodes, adjacency) {
  const sortedNodes = [...nodes].sort();
  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const stack = [];
  const components = [];
  let counter = 0;

  for (const root of sortedNodes) {
    if (index.has(root)) continue;
    const work = [{ node: root, neighborIndex: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const { node } = frame;
      if (frame.neighborIndex === 0) {
        index.set(node, counter);
        lowlink.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
      }
      const neighbors = adjacency.get(node) ?? [];
      if (frame.neighborIndex < neighbors.length) {
        const next = neighbors[frame.neighborIndex];
        frame.neighborIndex += 1;
        if (!index.has(next)) {
          work.push({ node: next, neighborIndex: 0 });
        } else if (onStack.has(next)) {
          lowlink.set(node, Math.min(lowlink.get(node), index.get(next)));
        }
        continue;
      }
      if (lowlink.get(node) === index.get(node)) {
        const component = [];
        let member;
        do {
          member = stack.pop();
          onStack.delete(member);
          component.push(member);
        } while (member !== node);
        components.push(component.sort());
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        lowlink.set(parent, Math.min(lowlink.get(parent), lowlink.get(node)));
      }
    }
  }
  return components.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

/** All cyclic components (multi-node or self-loop). */
export function findCycles(nodes, adjacency) {
  const components = tarjanSCC(nodes, adjacency);
  const cyclic = components.filter(
    (component) => component.length > 1 || (adjacency.get(component[0]) ?? []).includes(component[0]),
  );
  const cyclicNodes = new Set(cyclic.flat());
  const largest = cyclic.reduce((best, component) => (component.length > best.length ? component : best), []);
  return { components, cyclic, cyclicNodes, largest };
}

/** True when `target` is reachable from `start` along the adjacency map. */
export function reachableFrom(start, target, adjacency) {
  if (start === target) return true;
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift();
    for (const next of adjacency.get(node) ?? []) {
      if (next === target) return true;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return false;
}

/** Recursively collect source files under `rootDir` (deterministic order). */
export function collectTypeScriptFiles(rootDir, options = {}) {
  const excluded = new Set(options.excludeDirs ?? DEFAULT_EXCLUDED_DIRS);
  const results = [];
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        visit(absolute);
      } else if (MODULE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
        results.push(toPosix(absolute));
      }
    }
  };
  visit(rootDir);
  return results;
}

/**
 * READ-ONLY snapshot of sources at a git ref via `git show <ref>:<path>`.
 * Never applies stashes, checks out, resets, or mutates the work tree.
 */
export function loadSourcesFromGit(ref, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const prefixes = options.paths ?? [];
  const listed = execFileSync('git', ['ls-tree', '-r', '--name-only', ref], { cwd, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((file) => MODULE_EXTENSIONS.some((ext) => file.endsWith(ext)))
    .filter((file) => prefixes.length === 0 || prefixes.some((prefix) => file.startsWith(prefix)))
    .sort();
  return listed.map((file) => ({
    path: file,
    source: execFileSync('git', ['show', `${ref}:${file}`], { cwd, encoding: 'utf8' }),
  }));
}

const main = () => {
  const root = process.argv[2] ?? 'src/engine/cad';
  const files = collectTypeScriptFiles(root);
  const graphs = buildGraphs(files.map((file) => ({ path: file, source: fs.readFileSync(file, 'utf8') })));
  const valueCycles = findCycles(graphs.nodes, graphs.value);
  const typeCycles = findCycles(graphs.nodes, graphs.type);
  const report = {
    root,
    nodes: graphs.nodes.length,
    edges: graphs.edges.length,
    value: { cyclicComponents: valueCycles.cyclic.length, cyclicNodes: valueCycles.cyclicNodes.size, largest: valueCycles.largest },
    type: { cyclicComponents: typeCycles.cyclic.length, cyclicNodes: typeCycles.cyclicNodes.size, largest: typeCycles.largest },
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
