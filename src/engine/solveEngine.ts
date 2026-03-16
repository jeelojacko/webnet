import { LSAEngine } from './adjust';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  InstrumentLibrary,
  ObservationOverride,
  ParseOptions,
} from '../types';

export interface SolveEngineRequest {
  input: string;
  maxIterations: number;
  convergenceThreshold?: number;
  instrumentLibrary?: InstrumentLibrary;
  excludeIds?: Set<number>;
  overrides?: Record<number, ObservationOverride>;
  parseOptions?: Partial<ParseOptions>;
  geoidSourceData?: ArrayBuffer | Uint8Array;
}

export const solveEngine = (request: SolveEngineRequest): AdjustmentResult => {
  const engine = new LSAEngine({
    input: request.input,
    maxIterations: request.maxIterations,
    convergenceThreshold: request.convergenceThreshold,
    instrumentLibrary: request.instrumentLibrary,
    excludeIds: request.excludeIds,
    overrides: request.overrides,
    parseOptions: request.parseOptions,
    geoidSourceData: request.geoidSourceData,
  });
  return engine.solve();
};

export const normalizeClusterApprovedMerges = (
  merges: ClusterApprovedMerge[],
): ClusterApprovedMerge[] => {
  const byAlias = new Map<string, string>();
  merges
    .map((merge) => ({
      aliasId: String(merge.aliasId ?? '').trim(),
      canonicalId: String(merge.canonicalId ?? '').trim(),
    }))
    .filter((merge) => merge.aliasId && merge.canonicalId && merge.aliasId !== merge.canonicalId)
    .sort(
      (a, b) =>
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }) ||
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }),
    )
    .forEach((merge) => {
      const prior = byAlias.get(merge.aliasId);
      if (!prior) {
        byAlias.set(merge.aliasId, merge.canonicalId);
        return;
      }
      if (merge.canonicalId.localeCompare(prior, undefined, { numeric: true }) < 0) {
        byAlias.set(merge.aliasId, merge.canonicalId);
      }
    });
  return [...byAlias.entries()]
    .map(([aliasId, canonicalId]) => ({ aliasId, canonicalId }))
    .sort(
      (a, b) =>
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
    );
};
