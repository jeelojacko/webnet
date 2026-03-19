import { LSAEngine } from './adjust';
import { parseInput } from './parse';
import type {
  AdjustmentResult,
  InstrumentLibrary,
  ObservationOverride,
  ParseOptions,
  ParseResult,
} from '../types';

export interface ScenarioRunRequest {
  input: string;
  maxIterations: number;
  convergenceThreshold?: number;
  instrumentLibrary?: InstrumentLibrary;
  excludeIds?: Set<number>;
  overrides?: Record<number, ObservationOverride>;
  parseOptions?: Partial<ParseOptions>;
  geoidSourceData?: ArrayBuffer | Uint8Array;
}

export interface ScenarioRunServiceStats {
  cachedScenarioCount: number;
  parseCacheHits: number;
  parseCacheMisses: number;
  solveCount: number;
}

const MAX_CACHED_PARSED_MODELS = 8;

const parsedModelCache = new Map<string, ParseResult>();

let parseCacheHits = 0;
let parseCacheMisses = 0;
let solveCount = 0;

const normalizeCacheValue = (value: unknown): unknown => {
  if (value == null) return value;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'function') {
    return `[function:${value.name || 'anonymous'}]`;
  }
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCacheValue(entry));
  }
  if (value instanceof Set) {
    return [...value].map((entry) => normalizeCacheValue(entry));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeCacheValue(entryValue)]),
    );
  }
  return String(value);
};

const buildParsedModelCacheKey = (request: ScenarioRunRequest): string =>
  JSON.stringify(
    normalizeCacheValue({
      input: request.input,
      instrumentLibrary: request.instrumentLibrary ?? {},
      parseOptions: request.parseOptions ?? {},
    }),
  );

const rememberParsedModel = (cacheKey: string, parsedModel: ParseResult): ParseResult => {
  if (parsedModelCache.has(cacheKey)) {
    parsedModelCache.delete(cacheKey);
  }
  parsedModelCache.set(cacheKey, parsedModel);
  while (parsedModelCache.size > MAX_CACHED_PARSED_MODELS) {
    const oldestKey = parsedModelCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    parsedModelCache.delete(oldestKey);
  }
  return parsedModel;
};

const getParsedModel = (request: ScenarioRunRequest): ParseResult => {
  const cacheKey = buildParsedModelCacheKey(request);
  const cached = parsedModelCache.get(cacheKey);
  if (cached) {
    parseCacheHits += 1;
    parsedModelCache.delete(cacheKey);
    parsedModelCache.set(cacheKey, cached);
    return cached;
  }

  parseCacheMisses += 1;
  const parsedModel = parseInput(
    request.input,
    request.instrumentLibrary ?? {},
    request.parseOptions,
  );
  return rememberParsedModel(cacheKey, parsedModel);
};

export const runAdjustmentScenario = (request: ScenarioRunRequest): AdjustmentResult => {
  solveCount += 1;
  const engine = new LSAEngine({
    input: request.input,
    maxIterations: request.maxIterations,
    convergenceThreshold: request.convergenceThreshold,
    instrumentLibrary: request.instrumentLibrary,
    excludeIds: request.excludeIds,
    overrides: request.overrides,
    parseOptions: request.parseOptions,
    geoidSourceData: request.geoidSourceData,
    parsedResult: getParsedModel(request),
  });
  return engine.solve();
};

export const getScenarioRunServiceStats = (): ScenarioRunServiceStats => ({
  cachedScenarioCount: parsedModelCache.size,
  parseCacheHits,
  parseCacheMisses,
  solveCount,
});

export const resetScenarioRunServiceCache = (): void => {
  parsedModelCache.clear();
  parseCacheHits = 0;
  parseCacheMisses = 0;
  solveCount = 0;
};
