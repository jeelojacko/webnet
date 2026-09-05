/**
 * Phase 7B.6 first-system dense-vs-sparse correction handshake (test-only).
 *
 * Gates a sparse candidate on three layers before its result may be treated
 * as authoritative:
 *
 * 1. First-system correction agreement — the exact first linear system the
 *    sparse backend solved is rebuilt through the production dense path and
 *    the two correction vectors are compared (default 1e-9 absolute;
 *    measured 1.1e-15 on chain-16, 2.2e-12 on resection pillars).
 * 2. Damping gate (captured sparse damping must be undamped) and condition
 *    evidence gate (a finite estimate is required — native preferred,
 *    TS-packed fallback — unless explicitly waived; missing/non-finite
 *    evidence rejects fail-closed).
 * 3. Final-result agreement (success/convergence/coordinates/iterations).
 *
 * Measured audit note (2026-09-05): first-system corrections AGREE even for
 * the weak resection (2.2e-12), and the raw-N condition does NOT separate
 * healthy from weak cases (healthy triangulation 1.9e50 exceeds weak
 * resection 6.0e24). The condition threshold therefore mirrors production
 * warning semantics only (recorded in `warnings`, never a rejection), and
 * weak-geometry rejection rests on the static preflight plus the final
 * agreement layer. No production routing, tolerance, or baseline changes.
 */
import type { AdjustmentResult } from '../typesAdjustmentResult';
import { SPARSE_CONDITION_THRESHOLD } from './sparseNormalCondition';

export const PHASE7B6_HANDSHAKE_TOLERANCE_M = 1e-6;

/** Evidence-based first-system correction tolerance (absolute, per-param). */
export const PHASE7B6_CORRECTION_TOLERANCE = 1e-9;

export type Phase7b6ConditionSource = 'native-sparse' | 'ts-packed';

export interface Phase7b6FirstSystemEvidence {
  parameterCount: number;
  /** Dense-TS rebuild of the captured first system (required). */
  denseCorrection: number[];
  /** Sparse backend's first-system correction; null when none (it threw). */
  sparseCorrection: number[] | null;
  /** Captured sparse damping for the first system (required). */
  sparseDamping: number;
  /** Finite condition estimate (native preferred, TS-packed fallback). */
  conditionEstimate?: number;
  conditionSource?: Phase7b6ConditionSource;
}

export interface Phase7b6HandshakeInput {
  reference: AdjustmentResult;
  candidate: AdjustmentResult;
  /** Null when no first-system evidence was captured. */
  firstSystem: Phase7b6FirstSystemEvidence | null;
  /** Default false: missing first-system evidence rejects. */
  allowMissingFirstSystem?: boolean;
  /** Default false: missing/non-finite condition evidence rejects. */
  allowUnknownCondition?: boolean;
  correctionTolerance?: number;
  coordToleranceM?: number;
  conditionThreshold?: number;
}

export interface Phase7b6HandshakeVerdict {
  accepted: boolean;
  reasons: string[];
  /** Production-mirroring condition notes; never reject by themselves. */
  warnings: string[];
  maxCorrectionDiff: number;
  worstParamIndex: number | null;
  maxCoordDiffM: number;
  worstStationId: string | null;
  /** Height agreement is gated separately so 3D authority requires it. */
  maxHeightDiffM: number;
  worstHeightStationId: string | null;
}

const isFiniteResult = (result: AdjustmentResult): boolean => {
  if (!Number.isFinite(result.seuw)) return false;
  for (const station of Object.values(result.stations)) {
    if (!Number.isFinite(station.x) || !Number.isFinite(station.y)) return false;
    if (station.h != null && !Number.isFinite(station.h)) return false;
  }
  return true;
};

/** Pure fail-closed handshake; reasons append in fixed gate order. */
export const evaluatePhase7b6CorrectionHandshake = (
  input: Phase7b6HandshakeInput,
): Phase7b6HandshakeVerdict => {
  const correctionTolerance = input.correctionTolerance ?? PHASE7B6_CORRECTION_TOLERANCE;
  const coordTolerance = input.coordToleranceM ?? PHASE7B6_HANDSHAKE_TOLERANCE_M;
  const conditionThreshold = input.conditionThreshold ?? SPARSE_CONDITION_THRESHOLD;
  const reasons: string[] = [];
  const warnings: string[] = [];
  let maxCorrectionDiff = 0;
  let worstParamIndex: number | null = null;

  // Layer 1: first-system correction agreement on the captured system.
  const evidence = input.firstSystem;
  if (!evidence) {
    if (!input.allowMissingFirstSystem) {
      reasons.push('first-system gate: no captured sparse correction system (fail-closed)');
    }
  } else {
    if (!evidence.sparseCorrection) {
      reasons.push('first-system gate: sparse backend produced no correction (it threw; fail-closed)');
    } else {
      if (evidence.denseCorrection.length !== evidence.parameterCount) {
        reasons.push(
          `first-system gate: dense correction length ${evidence.denseCorrection.length} != params ${evidence.parameterCount}`,
        );
      }
      if (evidence.sparseCorrection.length !== evidence.parameterCount) {
        reasons.push(
          `first-system gate: sparse correction length ${evidence.sparseCorrection.length} != params ${evidence.parameterCount}`,
        );
      }
      if (
        evidence.denseCorrection.length === evidence.parameterCount &&
        evidence.sparseCorrection.length === evidence.parameterCount
      ) {
        for (let i = 0; i < evidence.parameterCount; i += 1) {
          const dense = evidence.denseCorrection[i] ?? Number.NaN;
          const sparse = evidence.sparseCorrection[i] ?? Number.NaN;
          const diff = Math.abs(dense - sparse);
          if (!Number.isFinite(diff)) {
            maxCorrectionDiff = Number.POSITIVE_INFINITY;
            worstParamIndex = i;
            break;
          }
          if (diff > maxCorrectionDiff) {
            maxCorrectionDiff = diff;
            worstParamIndex = i;
          }
        }
        if (!Number.isFinite(maxCorrectionDiff) || maxCorrectionDiff > correctionTolerance) {
          reasons.push(
            `first-system correction agreement: max diff ${maxCorrectionDiff.toExponential(2)} exceeds ${correctionTolerance} (worst param ${worstParamIndex ?? 'none'})`,
          );
        }
      }
    }
    if (!Number.isFinite(evidence.sparseDamping) || evidence.sparseDamping !== 0) {
      reasons.push(`sparse damping gate: damping=${evidence.sparseDamping} (undamped required)`);
    }
    // Condition is diagnostic-only: no threshold separates the measured
    // healthy triangulation (1.9e50) from the weak resection (6.0e24), so
    // exceeding the production warning level warns exactly like production
    // instead of rejecting. Missing/non-finite evidence rejects fail-closed
    // unless the caller explicitly waives it.
    if (
      evidence.conditionEstimate == null ||
      !Number.isFinite(evidence.conditionEstimate)
    ) {
      if (!input.allowUnknownCondition) {
        reasons.push('condition gate: no finite estimate available (fail-closed; waive explicitly)');
      }
    } else if (evidence.conditionEstimate > conditionThreshold) {
      warnings.push(
        `normal matrix appears ill-conditioned (estimate=${evidence.conditionEstimate.toExponential(3)}, threshold=${conditionThreshold.toExponential(3)}, source=${evidence.conditionSource ?? 'unknown'}).`,
      );
    }
  }

  // Layer 2: final-result agreement (trajectory/convergence screen).
  if (!input.reference.success || !input.candidate.success) {
    reasons.push(
      `success mismatch (reference=${input.reference.success}, candidate=${input.candidate.success})`,
    );
  }
  if (!input.reference.converged || !input.candidate.converged) {
    reasons.push(
      `convergence mismatch (reference=${input.reference.converged}, candidate=${input.candidate.converged})`,
    );
  }
  if (!isFiniteResult(input.reference) || !isFiniteResult(input.candidate)) {
    reasons.push('non-finite coordinates or SEUW in reference/candidate');
  }

  let maxCoordDiffM = 0;
  let worstStationId: string | null = null;
  let maxHeightDiffM = 0;
  let worstHeightStationId: string | null = null;
  for (const id of Object.keys(input.reference.stations).sort()) {
    const refStation = input.reference.stations[id];
    const candStation = input.candidate.stations[id];
    if (!refStation || !candStation) {
      maxCoordDiffM = Number.POSITIVE_INFINITY;
      worstStationId = id;
      maxHeightDiffM = Number.POSITIVE_INFINITY;
      worstHeightStationId = id;
      continue;
    }
    const diff = Math.max(
      Math.abs(refStation.x - candStation.x),
      Math.abs(refStation.y - candStation.y),
    );
    if (!(diff >= 0) || !Number.isFinite(diff)) {
      maxCoordDiffM = Number.POSITIVE_INFINITY;
      worstStationId = id;
      continue;
    }
    if (diff > maxCoordDiffM) {
      maxCoordDiffM = diff;
      worstStationId = id;
    }
    // Fail-closed 3D height: both sides always carry h, so any
    // disagreement (or non-finite value) rejects; 2D runs agree trivially.
    const heightDiff = Math.abs(refStation.h - candStation.h);
    if (!Number.isFinite(heightDiff)) {
      maxHeightDiffM = Number.POSITIVE_INFINITY;
      worstHeightStationId = id;
      continue;
    }
    if (heightDiff > maxHeightDiffM) {
      maxHeightDiffM = heightDiff;
      worstHeightStationId = id;
    }
  }
  if (!Number.isFinite(maxCoordDiffM) || maxCoordDiffM > coordTolerance) {
    reasons.push(
      `coordinate agreement: max diff ${maxCoordDiffM.toExponential(2)} exceeds ${coordTolerance} m (worst=${worstStationId ?? 'none'})`,
    );
  }
  if (!Number.isFinite(maxHeightDiffM) || maxHeightDiffM > coordTolerance) {
    reasons.push(
      `height agreement: max diff ${maxHeightDiffM.toExponential(2)} exceeds ${coordTolerance} m (worst=${worstHeightStationId ?? 'none'})`,
    );
  }
  if (input.reference.iterations !== input.candidate.iterations) {
    reasons.push(
      `iteration-count mismatch (reference=${input.reference.iterations}, candidate=${input.candidate.iterations})`,
    );
  }
  return {
    accepted: reasons.length === 0,
    reasons,
    warnings,
    maxCorrectionDiff,
    worstParamIndex,
    maxCoordDiffM,
    worstStationId,
    maxHeightDiffM,
    worstHeightStationId,
  };
};
