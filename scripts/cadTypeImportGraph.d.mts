/** STRUCT-195.2 reusable CAD type import-graph tool (declarations). */

export type ImportKind = 'value' | 'type' | 'mixed';

export interface ParsedImport {
  specifier: string;
  kind: ImportKind;
}

export interface GraphAliases {
  baseUrl: string;
  paths: Record<string, string[]>;
}

export interface GraphOptions {
  files?: Iterable<string> | string[];
  aliases?: GraphAliases;
}

export type SourceEntry = string | { path: string; source: string };

export interface GraphEdge {
  from: string;
  to: string;
  specifier: string;
  kind: ImportKind;
}

export interface UnresolvedEdge {
  from: string;
  specifier: string;
  kind: ImportKind;
}

export interface ImportGraph {
  nodes: string[];
  value: Map<string, string[]>;
  type: Map<string, string[]>;
  edges: GraphEdge[];
  unresolved: UnresolvedEdge[];
}

export interface CycleReport {
  components: string[][];
  cyclic: string[][];
  cyclicNodes: Set<string>;
  largest: string[];
}

export const MODULE_EXTENSIONS: string[];
export const INDEX_BASENAMES: string[];

export function parseImports(sourceText: string, fileName?: string): ParsedImport[];

export function loadTsconfigAliases(tsconfigPath: string): GraphAliases;

export function resolveModule(
  fromFile: string,
  specifier: string,
  options?: GraphOptions,
): string | null;

export function buildGraphs(
  entries: SourceEntry[] | Record<string, string>,
  options?: GraphOptions,
): ImportGraph;

export function tarjanSCC(nodes: Iterable<string>, adjacency: Map<string, string[]>): string[][];

export function findCycles(nodes: Iterable<string>, adjacency: Map<string, string[]>): CycleReport;

export function reachableFrom(start: string, target: string, adjacency: Map<string, string[]>): boolean;

export function collectTypeScriptFiles(rootDir: string, options?: { excludeDirs?: Iterable<string> }): string[];

export function loadSourcesFromGit(
  ref: string,
  options?: { cwd?: string; paths?: string[] },
): Array<{ path: string; source: string }>;
