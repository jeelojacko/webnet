/**
 * Phase 7B.7 multi-iteration strategy verdict (pure, test-only, no routing).
 *
 * Evaluates one strategy level over a TS reference, a sparse candidate,
 * per-correction-iteration oracle evidence, and a static-preflight result.
 * Final-result agreement reuses the Phase 7B.6 handshake with evidence
 * waived; per-system oracle gates (correction agreement, undamped factor,
 * finite condition evidence) apply to the strategy's required prefix.
 * Condition threshold excess warns exactly like production, never rejects.
 */
import type { AdjustmentResult } from '../typesAdjustmentResult';
import {
  evaluatePhase7b6CorrectionHandshake,
  type Phase7b6ConditionSource,
} from './phase7b6CorrectionHandshake';
import {
  PHASE7B7_MAX_CAPTURED_SYSTEMS,
  phase7b7StrategyById,
  phase7b7Tolerances,
  type Phase7b7StrategyId,
} from './phase7b7SafetyStrategies';
import { SPARSE_CONDITION_THRESHOLD } from './sparseNormalCondition';

export interface Phase7b7OracleSystemEvidence {
  parameterCount: number;
  /** Dense-TS rebuild of this iteration's system; null when rebuild threw. */
  denseCorrection: number[] | null;
  /** Sparse backend's correction; null when that call threw. */
  sparseCorrection: number[] | null;
  /** Captured sparse damping for this iteration. */
  sparseDamping: number;
  conditionEstimate?: number;
  conditionSource?: Phase7b6ConditionSource;
}

export interface Phase7b7PreflightResult {
  eligible: boolean;
  reasons: string[];
}

export interface Phase7b7StrategyVerdictInput {
  strategy: Phase7b7StrategyId;
  reference: AdjustmentResult;
  candidate: AdjustmentResult;
  /** One entry per captured correction iteration, in iteration order. */
  systems: Phase7b7OracleSystemEvidence[];
  /** Truncated capture sets are never silently accepted. */
  captureTruncated: boolean;
  preflight: Phase7b7PreflightResult | null;
  correctionTolerance?: number;
  coordToleranceM?: number;
  conditionThreshold?: number;
}

export interface Phase7b7StrategyVerdict {
  accepted: boolean;
  reasons: string[];
  warnings: string[];
  /** Correction systems the oracle actually gated. */
  oracledSystemCount: number;
  maxCorrectionDiff: number;
  worstSystemIndex: number | null;
  worstParamIndex: number | null;
  maxCoordDiffM: number;
  worstStationId: string | null;
}

/** Pure fail-closed strategy verdict; reasons append in fixed gate order. */
export const evaluatePhase7b7StrategyVerdict = (
  input: Phase7b7StrategyVerdictInput,
): Phase7b7StrategyVerdict => {
  const strategy = phase7b7StrategyById(input.strategy);
  const defaults = phase7b7Tolerances();
  const correctionTolerance = input.correctionTolerance ?? defaults.correctionTolerance;
  const coordTolerance = input.coordToleranceM ?? defaults.coordToleranceM;
  const conditionThreshold = input.conditionThreshold ?? SPARSE_CONDITION_THRESHOLD;
  const reasons: string[] = [];
  const warnings: string[] = [];

  // Gate 1: static-preflight admission (every strategy level).
  if (!strategy.requiresPreflight) {
    reasons.push(`${strategy.id}: strategy requires no preflight (unexpected table entry)`);
  } else if (!input.preflight) {
    reasons.push('preflight gate: no preflight result supplied (fail-closed)');
  } else if (!input.preflight.eligible) {
    for (const reason of input.preflight.reasons) {
      reasons.push(`preflight: ${reason}`);
    }
  }

  // Gate 2: final-result agreement (handshake with evidence waived, so only
  // the trajectory/convergence screen applies).
  const final = evaluatePhase7b6CorrectionHandshake({
    reference: input.reference,
    candidate: input.candidate,
    firstSystem: null,
    allowMissingFirstSystem: true,
    allowUnknownCondition: true,
    correctionTolerance,
    coordToleranceM: coordTolerance,
  });
  reasons.push(...final.reasons);

  // Gate 3: per-iteration dense oracle over the required prefix.
  const required =
    strategy.oracleSystemCount === 'all'
      ? input.systems.length
      : strategy.oracleSystemCount;
  if (input.captureTruncated) {
    reasons.push(
      `oracle bound: capture truncated at ${PHASE7B7_MAX_CAPTURED_SYSTEMS} systems (fail-closed; S3 coverage unproven)`,
    );
  }
  if (strategy.oracleSystemCount === 'all') {
    if (input.systems.length === 0) {
      reasons.push('s3: no correction systems captured (fail-closed)');
    } else if (input.systems.length !== (input.candidate.iterations ?? -1)) {
      reasons.push(
        `s3: captured ${input.systems.length} systems != ${input.candidate.iterations ?? 'unknown'} iterations (every-iteration unproven)`,
      );
    }
  } else if (input.systems.length < required) {
    reasons.push(
      `${strategy.id.toLowerCase()}: only ${input.systems.length} system(s) captured, ${required} required (fail-closed)`,
    );
  }

  let oracledSystemCount = 0;
  let maxCorrectionDiff = 0;
  let worstSystemIndex: number | null = null;
  let worstParamIndex: number | null = null;
  const gated = Math.min(required, input.systems.length);
  for (let index = 0; index < gated; index += 1) {
    const system = input.systems[index];
    if (!system) continue;
    oracledSystemCount += 1;
    const tag = `iteration ${index + 1}`;
    if (!system.sparseCorrection) {
      reasons.push(`${tag}: sparse backend produced no correction (it threw; fail-closed)`);
      continue;
    }
    if (!system.denseCorrection) {
      reasons.push(`${tag}: dense rebuild produced no correction (fail-closed)`);
      continue;
    }
    if (
      system.denseCorrection.length !== system.parameterCount ||
      system.sparseCorrection.length !== system.parameterCount
    ) {
      reasons.push(
        `${tag}: correction length mismatch (dense=${system.denseCorrection.length}, sparse=${system.sparseCorrection.length}, params=${system.parameterCount})`,
      );
      continue;
    }
    for (let param = 0; param < system.parameterCount; param += 1) {
      const diff = Math.abs(
        (system.denseCorrection[param] ?? Number.NaN) -
          (system.sparseCorrection[param] ?? Number.NaN),
      );
      if (!Number.isFinite(diff)) {
        maxCorrectionDiff = Number.POSITIVE_INFINITY;
        worstSystemIndex = index;
        worstParamIndex = param;
        break;
      }
      if (diff > maxCorrectionDiff) {
        maxCorrectionDiff = diff;
        worstSystemIndex = index;
        worstParamIndex = param;
      }
    }
    if (!Number.isFinite(maxCorrectionDiff) || maxCorrectionDiff > correctionTolerance) {
      reasons.push(
        `${tag}: correction agreement max diff ${maxCorrectionDiff.toExponential(2)} exceeds ${correctionTolerance} (worst param ${worstParamIndex ?? 'none'})`,
      );
    }
    if (!Number.isFinite(system.sparseDamping) || system.sparseDamping !== 0) {
      reasons.push(`${tag}: damping=${system.sparseDamping} (undamped required)`);
    }
    if (strategy.requiresConditionEvidence) {
      if (system.conditionEstimate == null || !Number.isFinite(system.conditionEstimate)) {
        reasons.push(`${tag}: no finite condition estimate (fail-closed)`);
      } else if (system.conditionEstimate > conditionThreshold) {
        warnings.push(
          `${tag}: normal matrix appears ill-conditioned (estimate=${system.conditionEstimate.toExponential(3)}, threshold=${conditionThreshold.toExponential(3)}, source=${system.conditionSource ?? 'unknown'}).`,
        );
      }
    }
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    warnings,
    oracledSystemCount,
    maxCorrectionDiff,
    worstSystemIndex,
    worstParamIndex,
    maxCoordDiffM: final.maxCoordDiffM,
    worstStationId: final.worstStationId,
  };
};
