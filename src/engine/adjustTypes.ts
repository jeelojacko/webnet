import type { NormalEquationSolver, SparseCorrectionSolver, SparseRowProductsSolver, SparseSelectedCovarianceSolver } from './numericalBackend';
import type { DetailedSolveProfiler, IterationSystemProbeInput } from './adjustDetailedSolveProfile';
import type { QxxReuseProbe } from './qxxReuseEvidence';
import type { ExperimentalSparseRouteDiagnostics } from './experimentalSparseDiagnostics';
import type { SolveProgressEvent } from './scenarioRunModels';
import type { SolvePreparationResult } from './adjustmentPreprocessing';
import type {
  InstrumentLibrary,
  ObservationOverride,
  ParseOptions,
  ParseResult,
  StationId,
} from '../types';

export type GpsSolveVector = {
  dE: number;
  dN: number;
  dU?: number;
  scale: number;
};

export type GpsCovariance = {
  cEE: number;
  cNN: number;
  cEN: number;
  cUU?: number;
  cEU?: number;
  cNU?: number;
};

export type GpsVectorComponents = {
  dE: number;
  dN: number;
  dU?: number;
};

export type GpsVectorDerivatives = {
  from: { x?: GpsVectorComponents; y?: GpsVectorComponents; h?: GpsVectorComponents };
  to: { x?: GpsVectorComponents; y?: GpsVectorComponents; h?: GpsVectorComponents };
};

export type BootstrapDirectionSet = {
  setId: string;
  occupy: StationId;
  directions: { to: StationId; obs: number }[];
};

export type BootstrapPairMetrics = {
  slopeDistance: number;
  horizDistance: number;
  zenith?: number;
  hi?: number;
  ht?: number;
};

export interface EngineOptions {
  input: string;
  maxIterations?: number;
  instrumentLibrary?: InstrumentLibrary;
  convergenceThreshold?: number;
  excludeIds?: Set<number>;
  overrides?: Record<number, ObservationOverride>;
  options?: Partial<ParseOptions>;
  parseOptions?: Partial<ParseOptions>;
  geoidSourceData?: ArrayBuffer | Uint8Array;
  parsedResult?: ParseResult;
  solvePreparation?: SolvePreparationResult;
  progressCallback?: (_event: SolveProgressEvent) => void;
  /** Test-only experimental correction backend; undefined keeps the TS solver. */
  normalEquationSolver?: NormalEquationSolver;
  /** Test-only experimental sparse correction backend; undefined keeps TS. */
  sparseCorrectionSolver?: SparseCorrectionSolver;
  /** Test-only experimental row-product backend for standardized residuals; undefined keeps dense. */
  sparseRowProductsSolver?: SparseRowProductsSolver;
  /** Test-only experimental selected-covariance backend for Qxx recovery; undefined keeps dense. */
  sparseSelectedCovarianceSolver?: SparseSelectedCovarianceSolver;
  /** Test-only route diagnostics for the experimental sparse paths; undefined disables counting. */
  experimentalSparseDiagnostics?: ExperimentalSparseRouteDiagnostics;
  /**
   * Test-only selected-network covariance mode: with an injected
   * selected-covariance solver, query only plan entries and skip the dense
   * all-entry Qxx reconstruction plus legacy all-pairs relativePrecision.
   */
  experimentalSelectedCovarianceMode?: boolean;
  /**
   * Phase 7B.5 test-only legacy compat: with selected mode plus an injected
   * solver, also query exact all-station pairs (Option B) so legacy
   * all-pairs relativePrecision resolves without dense Qxx. Default
   * undefined/false preserves selected-network omission/scaling.
   */
  experimentalSelectedCovarianceLegacyAllPairs?: boolean;
  /**
   * Phase 10B test-only internal detailed stage profiler; undefined keeps
   * the production coarse timing only. Never persisted or exposed in UI.
   */
  detailedSolveProfiler?: DetailedSolveProfiler;
  /**
   * Phase 10B test-only per-iteration packed-system probe for Level 1
   * identical-system native comparison. Undefined disables capture.
   */
  iterationSystemProbe?: (_system: IterationSystemProbeInput) => void;
  /**
   * Phase 10E test-only oracle: true forces the legacy statistics
   * rebuild-and-invert path even when final-Qxx reuse is eligible.
   * Undefined/false runs automatic production reuse on the eligible
   * cohort. Never persisted or exposed in UI.
   */
  forceLegacyStatisticsQxx?: boolean;
   /**
   * Phase 10D test-only Qxx comparison probe: receives final-covariance
   * and statistics normals/Qxx plus reuse decisions and call counts.
   * Undefined disables capture.
   */
  qxxReuseProbe?: QxxReuseProbe;
  /**
   * Phase 9E test-only oracle switch: false forces the legacy preanalysis
   * correction loop even when the fast path is eligible. Undefined (default)
   * runs the fast path when eligible. Threaded through AdjustmentRuntime;
   * never persisted or exposed in UI.
   */
  preanalysisCorrectionFastPath?: boolean;
}

export const cloneParsedResultValue = <T>(value: T): T => {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((entry) => cloneParsedResultValue(entry)) as T;
  }
  if (value instanceof Uint8Array) {
    return new Uint8Array(value) as T;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      cloneParsedResultValue(entryValue),
    ]),
  ) as T;
};
