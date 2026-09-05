/**
 * Phase 7B.7 first-system dense N/U oracle (test-only, no routing).
 *
 * Rebuilds the EXACT first correction system the sparse backend saw
 * (packed design/weights unpacked to sparse rows + dense P, assembled
 * with the production `accumulateNormalEquationsFromSparseRows` +
 * `solveNormalEquations` helpers) and estimates the raw-N condition
 * from the packed inputs. Single implementation reused by the Phase 7B.6
 * capture driver and the Phase 7B.7 safety benchmark. The pure rebuild
 * lives in `phase7b7DenseRebuild` (browser-safe); this module adds only
 * wall-clock timing for benchmark reporting.
 */
import { performance } from 'node:perf_hooks';

import { estimateSparseNormalCondition } from './sparseNormalCondition';
import {
  solvePhase7b7DenseSystem,
  type Phase7b7CapturedSystem,
} from './phase7b7DenseRebuild';
import type { Phase7b6ConditionSource } from './phase7b6CorrectionHandshake';

export type {
  Phase7b7CapturedSystem,
  Phase7b7DenseOracleEvidence,
} from './phase7b7DenseRebuild';
export {
  solvePhase7b7DenseSystem as solvePhase7b7DenseFirstSystem,
  unpackPhase7b7DenseWeights,
  unpackPhase7b7DesignRows,
} from './phase7b7DenseRebuild';

export interface Phase7b7OracleMeasurement {
  denseCorrection: number[] | null;
  conditionEstimate: number | undefined;
  conditionSource: Phase7b6ConditionSource | undefined;
  /** Wall time for the dense rebuild alone. */
  rebuildMs: number;
  /** Wall time for the TS-packed condition estimate alone (0 when native). */
  conditionMs: number;
}

/**
 * Times the oracle: dense rebuild always runs; the TS-packed condition
 * estimate runs only when no finite native estimate is supplied.
 */
export const measurePhase7b7FirstSystemOracle = (
  captured: Phase7b7CapturedSystem,
  nativeEstimate: number | undefined,
): Phase7b7OracleMeasurement => {
  const rebuildStart = performance.now();
  let denseCorrection: number[] | null = null;
  try {
    denseCorrection = solvePhase7b7DenseSystem(captured);
  } catch {
    denseCorrection = null;
  }
  const rebuildMs = performance.now() - rebuildStart;
  if (typeof nativeEstimate === 'number' && Number.isFinite(nativeEstimate)) {
    return {
      denseCorrection,
      conditionEstimate: nativeEstimate,
      conditionSource: 'native-sparse',
      rebuildMs,
      conditionMs: 0,
    };
  }
  const conditionStart = performance.now();
  let conditionEstimate: number | undefined;
  try {
    const packed = estimateSparseNormalCondition(
      captured.design,
      captured.weights,
      captured.parameterCount,
    );
    if (Number.isFinite(packed)) conditionEstimate = packed;
  } catch {
    conditionEstimate = undefined;
  }
  return {
    denseCorrection,
    conditionEstimate,
    conditionSource: conditionEstimate === undefined ? undefined : 'ts-packed',
    rebuildMs,
    conditionMs: performance.now() - conditionStart,
  };
};
