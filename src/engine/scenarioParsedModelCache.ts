import { parseInput } from './parse';
import {
  buildSolvePreparation,
  cloneSolvePreparationResult,
  collectActiveObservationsForSolve,
} from './adjustmentPreprocessing';
import type { SolvePreparationResult } from './adjustmentPreprocessing';
import type { ParseResult } from '../types';
import type { ScenarioRunRequest, ScenarioRunServiceStats } from './scenarioRunModels';

const MAX_CACHED_PARSED_MODELS = 8;
const MAX_CACHED_SOLVE_PREPARATIONS = 16;

const parsedModelCache = new Map<string, ParseResult>();
const solvePreparationCache = new Map<string, SolvePreparationResult>();

let parseCacheHits = 0;
let parseCacheMisses = 0;
let planningCacheHits = 0;
let planningCacheMisses = 0;
let solveCount = 0;

const normalizeCacheValue = (value: unknown): unknown => {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
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

const normalizeExcludeIds = (excludeIds: Set<number> | undefined): number[] =>
  excludeIds
    ? [...excludeIds].filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
    : [];

const buildSolvePreparationCacheKey = (
  request: ScenarioRunRequest,
  parsedModelCacheKey: string,
): string =>
  JSON.stringify({
    parsedModelCacheKey,
    // Current override paths only change values/weights, not the active-equation topology.
    excludeIds: normalizeExcludeIds(request.excludeIds),
  });

const cloneParsedModelValue = <T>(value: T): T => {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => cloneParsedModelValue(entry)) as T;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as T;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      cloneParsedModelValue(entryValue),
    ]),
  ) as T;
};

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

const rememberSolvePreparation = (
  cacheKey: string,
  solvePreparation: SolvePreparationResult,
): SolvePreparationResult => {
  if (solvePreparationCache.has(cacheKey)) {
    solvePreparationCache.delete(cacheKey);
  }
  solvePreparationCache.set(cacheKey, cloneSolvePreparationResult(solvePreparation));
  while (solvePreparationCache.size > MAX_CACHED_SOLVE_PREPARATIONS) {
    const oldestKey = solvePreparationCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    solvePreparationCache.delete(oldestKey);
  }
  return solvePreparation;
};

export const getCachedParsedModel = (request: ScenarioRunRequest): ParseResult => {
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

export const getCachedSolvePreparation = (
  request: ScenarioRunRequest,
  parsedModel: ParseResult,
): SolvePreparationResult => {
  const parsedModelCacheKey = buildParsedModelCacheKey(request);
  const cacheKey = buildSolvePreparationCacheKey(request, parsedModelCacheKey);
  const cached = solvePreparationCache.get(cacheKey);
  if (cached) {
    planningCacheHits += 1;
    solvePreparationCache.delete(cacheKey);
    solvePreparationCache.set(cacheKey, cached);
    return cloneSolvePreparationResult(cached);
  }

  planningCacheMisses += 1;
  const clonedParsedModel = cloneParsedModelValue(parsedModel);
  const is2D =
    (clonedParsedModel.parseState?.coordMode ?? request.parseOptions?.coordMode ?? '3D') === '2D';
  const activeObservations = collectActiveObservationsForSolve(
    clonedParsedModel.observations,
    request.excludeIds,
    is2D,
  );
  const solvePreparation = buildSolvePreparation(
    clonedParsedModel.stations,
    clonedParsedModel.unknowns,
    activeObservations,
    is2D,
  );
  return rememberSolvePreparation(cacheKey, solvePreparation);
};

export const recordScenarioSolve = (): void => {
  solveCount += 1;
};

export const getScenarioRunServiceStats = (): ScenarioRunServiceStats => ({
  cachedScenarioCount: parsedModelCache.size,
  cachedPlanningCount: solvePreparationCache.size,
  parseCacheHits,
  parseCacheMisses,
  planningCacheHits,
  planningCacheMisses,
  solveCount,
});

export const resetScenarioRunServiceCache = (): void => {
  parsedModelCache.clear();
  solvePreparationCache.clear();
  parseCacheHits = 0;
  parseCacheMisses = 0;
  planningCacheHits = 0;
  planningCacheMisses = 0;
  solveCount = 0;
};
