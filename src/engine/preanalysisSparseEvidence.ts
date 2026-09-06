/**
 * Phase 8A preanalysis sparse evidence helpers (TEST/EVIDENCE ONLY).
 *
 * Pure functions used by the Phase 8A evidence test to classify corpus cases
 * and compare the full preanalysis contract between the actual-worker sparse
 * result (real WASM, legacy-all-pairs selected covariance) and the direct
 * TypeScript reference. Nothing in production imports this module; it adds
 * no routing, no defaults, and no tolerance changes.
 */
import { parseInput } from './parseInputCore';
import type { AdjustmentResult } from '../typesAdjustmentResult';

export type PreanalysisEvidenceKind =
  | 'eligible-2d'
  | 'experimental-3d'
  | 'experimental-gps-covariance'
  | 'ineligible-robust'
  | 'ineligible-ts-correlation';

export interface PreanalysisEvidenceEligibility {
  eligible: boolean;
  kind: PreanalysisEvidenceKind;
  reasons: string[];
  unknownCount: number | null;
}

/** Evidence unknown cap: keeps the worker corpus bounded and deterministic. */
export const PREANALYSIS_EVIDENCE_MAX_UNKNOWN_COUNT = 128;

/** Absolute tolerance for condition-estimate agreement. */
export const PREANALYSIS_EVIDENCE_VALUE_TOLERANCE = 1e-9;

/**
 * Relative tolerance for covariance-derived sigma agreement (station
 * sigmas, relative-precision sigmas). The worker uses WASM selected
 * inversion while the reference uses the dense TypeScript inverse, so these
 * quantities agree to solver precision rather than bit-exactly; 1e-6
 * relative mirrors the Phase 7B shadow-proof grade. Coordinates stay exactly equal
 * (the correction is discarded, never applied).
 */
export const PREANALYSIS_EVIDENCE_PRECISION_RELATIVE_TOLERANCE = 1e-6;

/**
 * Classifies one preanalysis corpus case for sparse evidence. Reasons append
 * in fixed gate order so repeated evaluations are byte-identical. This is
 * independent of (and stricter-or-equal to what matters here)
 * `deriveSparseAutoRouteEligibility`; production routing is untouched.
 */
export const classifyPreanalysisSparseEvidence = (
  input: string,
  options: {
    coordMode: '2D' | '3D';
    robustMode: string;
    tsCorrelationEnabled: boolean;
  },
): PreanalysisEvidenceEligibility => {
  const reasons: string[] = [];
  if (options.coordMode !== '2D') {
    reasons.push(`dimension '${options.coordMode}': 3D preanalysis is experimental evidence only`);
    return { eligible: false, reasons, kind: 'experimental-3d', unknownCount: null };
  }
  if (options.robustMode !== 'none') {
    reasons.push(`robustMode '${options.robustMode}': robust preanalysis is ineligible for sparse evidence`);
    return { eligible: false, reasons, kind: 'ineligible-robust', unknownCount: null };
  }
  if (options.tsCorrelationEnabled) {
    reasons.push('TS correlation: correlated preanalysis is ineligible for sparse evidence');
    return { eligible: false, reasons, kind: 'ineligible-ts-correlation', unknownCount: null };
  }
  try {
    const parsed = parseInput(input);
    const unknownCount = parsed.unknowns.length;
    const gpsCovariance = parsed.observations.some(
      (observation) => observation.type === 'gps' && observation.gpsCovariance3d != null,
    );
    if (gpsCovariance) {
      reasons.push('GPS covariance weighting: covariance-weighted preanalysis is experimental evidence only');
      return { eligible: false, reasons, kind: 'experimental-gps-covariance', unknownCount };
    }
    if (unknownCount > PREANALYSIS_EVIDENCE_MAX_UNKNOWN_COUNT) {
      reasons.push(
        `unknownCount ${unknownCount} exceeds evidence cap ${PREANALYSIS_EVIDENCE_MAX_UNKNOWN_COUNT}`,
      );
      return { eligible: false, reasons, kind: 'eligible-2d', unknownCount };
    }
    return { eligible: true, reasons, kind: 'eligible-2d', unknownCount };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    reasons.push(`eligibility parse failed: ${detail}`.slice(0, 300));
    return { eligible: false, reasons, kind: 'eligible-2d', unknownCount: null };
  }
};

export interface PreanalysisContractComparison {
  pass: boolean;
  reasons: string[];
  maxCoordDiff: number;
  maxCovarianceDiff: number;
  maxCovarianceRelativeDiff: number;
  maxRelativeCovarianceDiff: number;
  maxRelativeCovarianceRelativeDiff: number;
  maxRelativePrecisionDiff: number;
  maxRelativePrecisionRelativeDiff: number;
}

const diffOr = (a: number, b: number): number => {
  const diff = Math.abs(a - b);
  return Number.isFinite(diff) ? diff : Number.POSITIVE_INFINITY;
};

/**
 * Compares the full meaningful preanalysis contract between the direct
 * TypeScript reference and the actual-worker sparse candidate.
 */
export const comparePreanalysisContract = (
  reference: AdjustmentResult,
  candidate: AdjustmentResult,
): PreanalysisContractComparison => {
  const reasons: string[] = [];
  let maxCoordDiff = 0;
  let maxCovarianceDiff = 0;
  let maxCovarianceRelativeDiff = 0;
  let maxRelativeCovarianceDiff = 0;
  let maxRelativeCovarianceRelativeDiff = 0;
  let maxRelativePrecisionDiff = 0;
  let maxRelativePrecisionRelativeDiff = 0;
  const precisionAllowed = (expected: number): number =>
    PREANALYSIS_EVIDENCE_PRECISION_RELATIVE_TOLERANCE * Math.max(1, Math.abs(expected));

  if (reference.success !== candidate.success) {
    reasons.push(`success mismatch: ref=${reference.success} cand=${candidate.success}`);
  }
  if (candidate.converged !== true) reasons.push('candidate converged !== true');
  if (candidate.iterations !== 1) reasons.push(`candidate iterations=${candidate.iterations} !== 1`);
  if (reference.iterations !== 1) reasons.push(`reference iterations=${reference.iterations} !== 1`);
  if (reference.dof !== candidate.dof) {
    reasons.push(`dof mismatch: ref=${reference.dof} cand=${candidate.dof}`);
  }
  if (candidate.seuw !== 1) reasons.push(`candidate seuw=${candidate.seuw} !== 1`);
  if (reference.seuw !== 1) reasons.push(`reference seuw=${reference.seuw} !== 1`);

  const refCond = reference.condition?.estimate;
  const candCond = candidate.condition?.estimate;
  if (refCond == null || candCond == null) {
    reasons.push('missing condition estimate on reference or candidate');
  } else {
    const allowed = PREANALYSIS_EVIDENCE_VALUE_TOLERANCE * Math.max(1, Math.abs(refCond));
    if (diffOr(refCond, candCond) > allowed) {
      reasons.push(`condition estimate mismatch: ref=${refCond} cand=${candCond}`);
    }
  }

  const refIds = Object.keys(reference.stations).sort();
  const candIds = Object.keys(candidate.stations).sort();
  if (refIds.join('|') !== candIds.join('|')) {
    reasons.push('station id sets differ');
  }
  for (const id of refIds) {
    const ref = reference.stations[id];
    const cand = candidate.stations[id];
    if (!ref || !cand) continue;
    for (const key of ['x', 'y', 'h'] as const) {
      const a = ref[key];
      const b = cand[key];
      if (a == null && b == null) continue;
      if (a == null || b == null) {
        reasons.push(`station ${id}.${key}: presence mismatch`);
        continue;
      }
      maxCoordDiff = Math.max(maxCoordDiff, diffOr(a, b));
      if (a !== b) reasons.push(`station ${id}.${key}: not exactly unchanged (${a} vs ${b})`);
    }
    if ((ref.errorEllipse == null) !== (cand.errorEllipse == null)) {
      reasons.push(`station ${id}: errorEllipse mirror presence mismatch`);
    }
  }

  const refCov = reference.stationCovariances ?? [];
  const candCov = candidate.stationCovariances ?? [];
  if (refCov.length !== candCov.length) {
    reasons.push(`stationCovariances length: ref=${refCov.length} cand=${candCov.length}`);
  } else {
    refCov.forEach((row, index) => {
      const other = candCov[index];
      if (!other) return;
      if (row.stationId !== other.stationId) {
        reasons.push(`stationCovariances[${index}] order: ref=${row.stationId} cand=${other.stationId}`);
        return;
      }
      for (const key of ['sigmaE', 'sigmaN', 'sigmaH'] as const) {
        const a = row[key];
        const b = other[key];
        if (a == null && b == null) continue;
        if (a == null || b == null) {
          reasons.push(`stationCovariances[${row.stationId}].${key}: presence mismatch`);
          continue;
        }
        const diff = diffOr(a, b);
        maxCovarianceDiff = Math.max(maxCovarianceDiff, diff);
        const scale = Math.max(1, Math.abs(a));
        maxCovarianceRelativeDiff = Math.max(maxCovarianceRelativeDiff, diff / scale);
        if (diff > precisionAllowed(a)) {
          reasons.push(`stationCovariances[${row.stationId}].${key}: diff=${diff}`);
        }
      }
      if ((row.ellipse == null) !== (other.ellipse == null)) {
        reasons.push(`stationCovariances[${row.stationId}]: ellipse presence mismatch`);
      }
    });
  }

  const refRel = reference.relativePrecision ?? [];
  const candRel = candidate.relativePrecision ?? [];
  if (refRel.length !== candRel.length) {
    reasons.push(`relativePrecision length: ref=${refRel.length} cand=${candRel.length}`);
  } else {
    refRel.forEach((row, index) => {
      const other = candRel[index];
      if (!other) return;
      if (row.from !== other.from || row.to !== other.to) {
        reasons.push(`relativePrecision[${index}] order: ref=${row.from}-${row.to} cand=${other.from}-${other.to}`);
        return;
      }
      for (const key of ['sigmaN', 'sigmaE', 'sigmaDist', 'sigmaAz'] as const) {
        const a = row[key];
        const b = other[key];
        if (a == null && b == null) continue;
        if (a == null || b == null) {
          reasons.push(`relativePrecision[${row.from}-${row.to}].${key}: presence mismatch`);
          continue;
        }
        const diff = diffOr(a, b);
        maxRelativePrecisionDiff = Math.max(maxRelativePrecisionDiff, diff);
        const scale = Math.max(1, Math.abs(a));
        maxRelativePrecisionRelativeDiff = Math.max(maxRelativePrecisionRelativeDiff, diff / scale);
        if (diff > precisionAllowed(a)) {
          reasons.push(`relativePrecision[${row.from}-${row.to}].${key}: diff=${diff}`);
        }
      }
      if ((row.ellipse == null) !== (other.ellipse == null)) {
        reasons.push(`relativePrecision[${row.from}-${row.to}]: ellipse presence mismatch`);
      }
    });
  }

  const refPairs = reference.relativeCovariances ?? [];
  const candPairs = candidate.relativeCovariances ?? [];
  if (refPairs.length !== candPairs.length) {
    reasons.push(`relativeCovariances length: ref=${refPairs.length} cand=${candPairs.length}`);
  } else {
    refPairs.forEach((row, index) => {
      const other = candPairs[index];
      if (!other) return;
      if (row.from !== other.from || row.to !== other.to) {
        reasons.push(`relativeCovariances[${index}] order: ref=${row.from}-${row.to} cand=${other.from}-${other.to}`);
        return;
      }
      if (row.connected !== other.connected) {
        reasons.push(`relativeCovariances[${row.from}-${row.to}]: connected mismatch`);
      }
      if (row.connectionTypes.join('|') !== other.connectionTypes.join('|')) {
        reasons.push(`relativeCovariances[${row.from}-${row.to}]: connectionTypes mismatch`);
      }
      for (const key of ['cEE', 'cEN', 'cEH', 'cNN', 'cNH', 'cHH', 'sigmaE', 'sigmaN', 'sigmaH', 'sigmaDist', 'sigmaAz'] as const) {
        const a = row[key];
        const b = other[key];
        if (a == null && b == null) continue;
        if (a == null || b == null) {
          reasons.push(`relativeCovariances[${row.from}-${row.to}].${key}: presence mismatch`);
          continue;
        }
        const diff = diffOr(a, b);
        maxRelativeCovarianceDiff = Math.max(maxRelativeCovarianceDiff, diff);
        const pairScale = Math.max(1, Math.abs(a));
        maxRelativeCovarianceRelativeDiff = Math.max(maxRelativeCovarianceRelativeDiff, diff / pairScale);
        if (diff > precisionAllowed(a)) {
          reasons.push(`relativeCovariances[${row.from}-${row.to}].${key}: diff=${diff}`);
        }
      }
      if ((row.ellipse == null) !== (other.ellipse == null)) {
        reasons.push(`relativeCovariances[${row.from}-${row.to}]: ellipse presence mismatch`);
      }
    });
  }

  if (candidate.preanalysisMode !== true) reasons.push('candidate preanalysisMode !== true');
  if (candidate.preanalysisImpactDiagnostics == null) {
    reasons.push('candidate preanalysisImpactDiagnostics missing');
  }
  if (candidate.chiSquare != null) reasons.push('candidate chiSquare should be absent');
  if (candidate.statisticalSummary != null) reasons.push('candidate statisticalSummary should be absent');
  if (candidate.residualDiagnostics != null) reasons.push('candidate residualDiagnostics should be absent');
  const refObsById = new Map(reference.observations.map((obs) => [obs.id, obs]));
  for (const obs of candidate.observations) {
    // Standardized-residual QC fields are never assigned in preanalysis;
    // raw residual/stdRes (=|v|/sigma at planning geometry) must match exactly.
    if (
      obs.redundancy != null ||
      obs.localTest != null ||
      obs.localTestComponents != null ||
      obs.mdb != null ||
      obs.mdbComponents != null ||
      obs.stdResComponents != null
    ) {
      reasons.push(`obs ${obs.id}: standardized residual QC fields should be absent in preanalysis`);
      break;
    }
    const refObs = refObsById.get(obs.id);
    if (refObs && (refObs.stdRes ?? null) !== (obs.stdRes ?? null)) {
      reasons.push(`obs ${obs.id}: raw stdRes differs (ref=${refObs.stdRes} cand=${obs.stdRes})`);
      break;
    }
  }

  return {
    pass: reasons.length === 0,
    reasons,
    maxCoordDiff,
    maxCovarianceDiff,
    maxCovarianceRelativeDiff,
    maxRelativeCovarianceDiff,
    maxRelativeCovarianceRelativeDiff,
    maxRelativePrecisionDiff,
    maxRelativePrecisionRelativeDiff,
  };
};

export type PreanalysisStrategyId = 'S0' | 'S1' | 'S2' | 'S3';

export interface PreanalysisOracleSummary {
  maxCorrectionDiff: number;
  damping: number;
  conditionEstimate: number | undefined;
}

export interface PreanalysisStrategyResult {
  id: PreanalysisStrategyId;
  pass: boolean;
  reasons: string[];
}

/**
 * Evaluates the S0-S3 strategy ladder for one admitted case from final
 * agreement plus per-system dense-oracle summaries. Condition threshold
 * excess warns exactly like production semantics (never rejects here; the
 * evidence records it).
 */
export const evaluatePreanalysisStrategies = (args: {
  contractPass: boolean;
  contractReasons: string[];
  solveCount: number;
  capturedSystemCount: number;
  truncated: boolean;
  oracles: PreanalysisOracleSummary[];
  correctionTolerance?: number;
}): PreanalysisStrategyResult[] => {
  const tolerance = args.correctionTolerance ?? 1e-9;
  const oraclePass = (summary: PreanalysisOracleSummary | undefined, tag: string): string[] => {
    const failures: string[] = [];
    if (!summary) {
      failures.push(`${tag}: no oracle summary (fail-closed)`);
      return failures;
    }
    if (!Number.isFinite(summary.maxCorrectionDiff)) {
      failures.push(`${tag}: non-finite correction agreement (fail-closed)`);
    } else if (summary.maxCorrectionDiff > tolerance) {
      failures.push(`${tag}: correction diff ${summary.maxCorrectionDiff} exceeds ${tolerance}`);
    }
    if (!Number.isFinite(summary.damping) || summary.damping !== 0) {
      failures.push(`${tag}: damping=${summary.damping} (undamped required)`);
    }
    if (summary.conditionEstimate == null || !Number.isFinite(summary.conditionEstimate)) {
      failures.push(`${tag}: no finite condition estimate (fail-closed)`);
    }
    return failures;
  };

  const countGate: string[] = [];
  if (args.truncated) countGate.push('capture truncated (fail-closed)');
  if (args.capturedSystemCount !== args.solveCount) {
    countGate.push(
      `captured ${args.capturedSystemCount} systems != ${args.solveCount} solves (every-iteration unproven)`,
    );
  }

  const s0Reasons = args.contractPass ? [] : [...args.contractReasons];
  const s1Reasons = [...s0Reasons, ...oraclePass(args.oracles[0], 'system 1')];
  const s2Reasons = [
    ...s1Reasons,
    ...oraclePass(args.oracles[1], 'system 2'),
  ];
  const s3Reasons = [
    ...s0Reasons,
    ...countGate,
    ...args.oracles.flatMap((summary, index) => oraclePass(summary, `system ${index + 1}`)),
  ];
  return [
    { id: 'S0', pass: s0Reasons.length === 0, reasons: s0Reasons },
    { id: 'S1', pass: s1Reasons.length === 0, reasons: s1Reasons },
    { id: 'S2', pass: s2Reasons.length === 0, reasons: s2Reasons },
    { id: 'S3', pass: s3Reasons.length === 0, reasons: s3Reasons },
  ];
};
