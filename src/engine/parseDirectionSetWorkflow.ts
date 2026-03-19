import { RAD_TO_DEG } from './angles';
import type {
  DirectionFaceSource,
  DirectionRejectDiagnostic,
  DirectionSetPolicyOutcome,
  DirectionSetTreatmentDecision,
  DirectionSetTreatmentDiagnostic,
  FaceNormalizationMode,
  Observation,
  ParseCompatibilityMode,
  ParseOptions,
  SigmaSource,
  StationId,
} from '../types';

export type DirectionFace = 'face1' | 'face2';

export interface RawDirectionShot {
  to: StationId;
  obs: number;
  stdDev: number;
  sigmaSource: SigmaSource;
  sourceLine: number;
  face: DirectionFace;
  faceSource: DirectionFaceSource;
  reliableFace: boolean;
}

export interface DirectionTraverseContext {
  occupy?: string;
  backsight?: string;
  dirSetId?: string;
  dirInstCode?: string;
  dirRawShots?: RawDirectionShot[];
}

interface CreateDirectionSetWorkflowArgs {
  state: ParseOptions;
  logs: string[];
  compatibilityMode: ParseCompatibilityMode;
  getCurrentLine: () => number;
  getCurrentSourceFile: () => string;
  nextObservationId: () => number;
  pushObservation: (_observation: Observation) => void;
  directionRejectDiagnostics: DirectionRejectDiagnostic[];
  directionSetTreatmentDiagnostics: DirectionSetTreatmentDiagnostic[];
}

const wrapToPi = (val: number): number => {
  let out = val;
  while (out <= -Math.PI) out += 2 * Math.PI;
  while (out > Math.PI) out -= 2 * Math.PI;
  return out;
};

const wrapTo2Pi = (val: number): number => {
  let out = val % (2 * Math.PI);
  if (out < 0) out += 2 * Math.PI;
  return out;
};

const weightedCircularMean = (values: number[], weights?: number[]): number => {
  if (values.length === 0) return 0;
  let sumSin = 0;
  let sumCos = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = weights?.[i] ?? 1;
    sumSin += Math.sin(values[i]) * w;
    sumCos += Math.cos(values[i]) * w;
  }
  if (Math.abs(sumSin) < 1e-15 && Math.abs(sumCos) < 1e-15) {
    return wrapTo2Pi(values[0] ?? 0);
  }
  return wrapTo2Pi(Math.atan2(sumSin, sumCos));
};

const weightedCircularSpread = (values: number[], mean: number, weights?: number[]): number => {
  if (values.length === 0) return 0;
  let weightSum = 0;
  let accum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const w = weights?.[i] ?? 1;
    const residual = wrapToPi(values[i] - mean);
    accum += w * residual * residual;
    weightSum += w;
  }
  return weightSum > 0 ? Math.sqrt(accum / weightSum) : 0;
};

const directionFaceSourceRank: DirectionFaceSource[] = [
  'metadata',
  'zenith',
  'cluster',
  'fallback',
  'unresolved',
];

export const createDirectionSetWorkflow = ({
  state,
  logs,
  compatibilityMode,
  getCurrentLine,
  getCurrentSourceFile,
  nextObservationId,
  pushObservation,
  directionRejectDiagnostics,
  directionSetTreatmentDiagnostics,
}: CreateDirectionSetWorkflowArgs) => {
  const isReliableFaceSource = (source: DirectionFaceSource): boolean =>
    source === 'metadata' ||
    source === 'zenith' ||
    (source === 'cluster' && (state.directionFaceReliabilityFromCluster ?? false));

  const parseDirectionFaceHintToken = (token: string | undefined): DirectionFace | null => {
    const raw = token?.trim();
    if (!raw) return null;
    let normalized = raw.toUpperCase().replace(/[^A-Z0-9=]/g, '');
    if (!normalized) return null;
    if (normalized.startsWith('FACE=')) normalized = normalized.slice(5);
    if (normalized.startsWith('FACE')) normalized = normalized.slice(4);
    if (normalized === 'F1') normalized = '1';
    if (normalized === 'F2') normalized = '2';
    if (normalized === '1') return 'face1';
    if (normalized === '2') return 'face2';
    return null;
  };

  const stripDirectionFaceHints = (
    tokens: string[],
  ): { face: DirectionFace | null; tokens: string[] } => {
    let face: DirectionFace | null = null;
    const remaining: string[] = [];
    tokens.forEach((token) => {
      const parsed = parseDirectionFaceHintToken(token);
      if (parsed != null && face == null) {
        face = parsed;
        return;
      }
      remaining.push(token);
    });
    return { face, tokens: remaining };
  };

  const inferFaceFromZenith = (
    zenithRad?: number,
  ): { face: DirectionFace; source: DirectionFaceSource } | null => {
    if (!Number.isFinite(zenithRad as number)) return null;
    const zenithDeg = wrapTo2Pi(zenithRad as number) * RAD_TO_DEG;
    const windowDeg = Math.max(1, state.directionFaceZenithWindowDeg ?? 45);
    const distanceTo = (center: number): number => {
      let delta = Math.abs(zenithDeg - center) % 360;
      if (delta > 180) delta = 360 - delta;
      return delta;
    };
    const dFace1 = distanceTo(90);
    const dFace2 = distanceTo(270);
    if (dFace1 <= windowDeg && dFace2 > windowDeg) return { face: 'face1', source: 'zenith' };
    if (dFace2 <= windowDeg && dFace1 > windowDeg) return { face: 'face2', source: 'zenith' };
    return null;
  };

  const splitFaceByCluster = (
    shots: RawDirectionShot[],
  ): { reliable: boolean; centerSeparationDeg?: number; confidence?: number } => {
    if (!(state.directionFaceReliabilityFromCluster ?? false)) return { reliable: false };
    if (shots.length < 4) return { reliable: false };
    const fallbackShots = shots.filter((shot) => shot.faceSource === 'fallback');
    if (fallbackShots.length < 4) return { reliable: false };
    const face1Shots = fallbackShots.filter((shot) => shot.face === 'face1');
    const face2Shots = fallbackShots.filter((shot) => shot.face === 'face2');
    if (!face1Shots.length || !face2Shots.length) return { reliable: false };
    const center1 = weightedCircularMean(face1Shots.map((shot) => shot.obs));
    const center2 = weightedCircularMean(face2Shots.map((shot) => shot.obs));
    const separation = Math.abs(wrapToPi(center1 - center2)) * RAD_TO_DEG;
    const expected = Math.max(1, state.directionFaceClusterSeparationDeg ?? 180);
    const tolerance = Math.max(0.1, state.directionFaceClusterSeparationToleranceDeg ?? 20);
    const confidence = Math.min(face1Shots.length, face2Shots.length) / shots.length;
    const confidenceMin = Math.min(1, Math.max(0, state.directionFaceClusterConfidenceMin ?? 0.35));
    return {
      reliable:
        Math.abs(separation - expected) <= tolerance &&
        confidence >= confidenceMin &&
        face1Shots.length >= 2 &&
        face2Shots.length >= 2,
      centerSeparationDeg: separation,
      confidence,
    };
  };

  const combineSigmaSources = (shots: RawDirectionShot[]): SigmaSource => {
    if (!shots.length) return 'default';
    if (shots.some((shot) => shot.sigmaSource === 'fixed')) return 'fixed';
    if (shots.every((shot) => shot.sigmaSource === 'float')) return 'float';
    if (shots.every((shot) => shot.sigmaSource === 'default')) return 'default';
    return 'explicit';
  };

  const pickDirectionFaceSource = (shots: RawDirectionShot[]): DirectionFaceSource => {
    const available = new Set<DirectionFaceSource>(shots.map((shot) => shot.faceSource));
    for (const source of directionFaceSourceRank) {
      if (available.has(source)) return source;
    }
    return 'fallback';
  };

  const reduceDirectionBucket = (
    bucketSetId: string,
    occupy: StationId,
    instCode: string,
    shots: RawDirectionShot[],
    normalizeFace2: boolean,
  ): {
    reducedCount: number;
    pairedTargets: number;
    face1Total: number;
    face2Total: number;
  } => {
    const byTarget = new Map<StationId, RawDirectionShot[]>();
    shots.forEach((shot) => {
      const list = byTarget.get(shot.to) ?? [];
      list.push(shot);
      byTarget.set(shot.to, list);
    });

    let reducedCount = 0;
    let pairedTargets = 0;
    let face1Total = 0;
    let face2Total = 0;

    const targets = [...byTarget.keys()].sort((a, b) => a.localeCompare(b));
    targets.forEach((to) => {
      const targetShots = byTarget.get(to) ?? [];
      if (!targetShots.length) return;
      const face1Count = targetShots.filter((shot) => shot.face === 'face1').length;
      const face2Count = targetShots.length - face1Count;
      face1Total += face1Count;
      face2Total += face2Count;
      if (face1Count > 0 && face2Count > 0) pairedTargets += 1;

      const normalized = targetShots.map((shot) => {
        const obs =
          normalizeFace2 && shot.face === 'face2'
            ? wrapTo2Pi(shot.obs - Math.PI)
            : wrapTo2Pi(shot.obs);
        const weight = 1 / Math.max(shot.stdDev * shot.stdDev, 1e-24);
        return { ...shot, normalizedObs: obs, weight };
      });
      const obsValues = normalized.map((shot) => shot.normalizedObs);
      const obsWeights = normalized.map((shot) => shot.weight);
      const reducedObs = weightedCircularMean(obsValues, obsWeights);
      const sumW = obsWeights.reduce((acc, weight) => acc + weight, 0);
      const reducedSigma = sumW > 0 ? Math.sqrt(1 / sumW) : normalized[0].stdDev;
      const residuals = normalized.map((shot) => wrapToPi(shot.normalizedObs - reducedObs));
      const spread = weightedCircularSpread(obsValues, reducedObs, obsWeights);
      const rawMaxResidual = residuals.length ? Math.max(...residuals.map((r) => Math.abs(r))) : 0;

      const faceStats = (face: DirectionFace): { mean?: number; spread?: number } => {
        const faceShots = normalized.filter((shot) => shot.face === face);
        if (!faceShots.length) return {};
        const faceObs = faceShots.map((shot) => shot.normalizedObs);
        const faceWeights = faceShots.map((shot) => shot.weight);
        const mean = weightedCircularMean(faceObs, faceWeights);
        const faceSpread = weightedCircularSpread(faceObs, mean, faceWeights);
        return { mean, spread: faceSpread };
      };

      const face1Stats = faceStats('face1');
      const face2Stats = faceStats('face2');
      const facePairDelta =
        face1Stats.mean != null && face2Stats.mean != null
          ? Math.abs(wrapToPi(face1Stats.mean - face2Stats.mean))
          : undefined;

      pushObservation({
        id: nextObservationId(),
        type: 'direction',
        instCode,
        setId: bucketSetId,
        at: occupy,
        to,
        obs: reducedObs,
        stdDev: reducedSigma,
        sigmaSource: combineSigmaSources(targetShots),
        sourceLine: Math.min(...targetShots.map((shot) => shot.sourceLine)),
        rawCount: targetShots.length,
        rawFace1Count: face1Count,
        rawFace2Count: face2Count,
        rawSpread: spread,
        rawMaxResidual,
        facePairDelta,
        face1Spread: face1Stats.spread,
        face2Spread: face2Stats.spread,
        reducedSigma,
      });
      reducedCount += 1;
    });

    return { reducedCount, pairedTargets, face1Total, face2Total };
  };

  const pushRawDirectionBucket = (
    bucketSetId: string,
    occupy: StationId,
    instCode: string,
    shots: RawDirectionShot[],
    normalizeFace2: boolean,
  ): {
    reducedCount: number;
    pairedTargets: number;
    face1Total: number;
    face2Total: number;
  } => {
    const byTargetFaceCounts = new Map<StationId, { face1: number; face2: number }>();
    let face1Total = 0;
    let face2Total = 0;

    shots.forEach((shot) => {
      const obs =
        normalizeFace2 && shot.face === 'face2'
          ? wrapTo2Pi(shot.obs - Math.PI)
          : wrapTo2Pi(shot.obs);
      pushObservation({
        id: nextObservationId(),
        type: 'direction',
        instCode,
        setId: bucketSetId,
        at: occupy,
        to: shot.to,
        obs,
        stdDev: shot.stdDev,
        sigmaSource: shot.sigmaSource,
        sourceLine: shot.sourceLine,
        rawCount: 1,
        rawFace1Count: shot.face === 'face1' ? 1 : 0,
        rawFace2Count: shot.face === 'face2' ? 1 : 0,
        rawSpread: 0,
        rawMaxResidual: 0,
        reducedSigma: shot.stdDev,
      });
      const entry = byTargetFaceCounts.get(shot.to) ?? { face1: 0, face2: 0 };
      if (shot.face === 'face1') {
        entry.face1 += 1;
        face1Total += 1;
      } else {
        entry.face2 += 1;
        face2Total += 1;
      }
      byTargetFaceCounts.set(shot.to, entry);
    });

    const pairedTargets = [...byTargetFaceCounts.values()].filter(
      (entry) => entry.face1 > 0 && entry.face2 > 0,
    ).length;
    return {
      reducedCount: shots.length,
      pairedTargets,
      face1Total,
      face2Total,
    };
  };

  const reduceDirectionShots = (
    setId: string,
    occupy: StationId,
    instCode: string,
    shots: RawDirectionShot[],
  ): void => {
    if (!shots.length) return;

    let workingShots = shots.map((shot) => ({ ...shot }));
    const clusterSplit = splitFaceByCluster(workingShots);
    if (clusterSplit.reliable) {
      workingShots = workingShots.map((shot) =>
        shot.faceSource === 'fallback'
          ? { ...shot, faceSource: 'cluster' as DirectionFaceSource, reliableFace: true }
          : shot,
      );
    }

    const mixedFaces = new Set(workingShots.map((shot) => shot.face)).size > 1;
    const hasUnreliableFace = workingShots.some((shot) => !shot.reliableFace);
    const unresolvedMixed = mixedFaces && hasUnreliableFace;
    const mode: FaceNormalizationMode = state.faceNormalizationMode ?? 'on';
    const initialFaceSource: DirectionFaceSource = unresolvedMixed
      ? 'unresolved'
      : pickDirectionFaceSource(workingShots);

    let treatmentDecision: DirectionSetTreatmentDecision;
    if (mode === 'off') {
      treatmentDecision = 'split';
    } else if (unresolvedMixed) {
      treatmentDecision = 'unresolved';
    } else if (mode === 'auto') {
      treatmentDecision = mixedFaces ? 'normalized' : 'split';
    } else {
      treatmentDecision = 'normalized';
    }

    let policyOutcome: DirectionSetPolicyOutcome = 'accepted';
    if (treatmentDecision === 'unresolved') {
      policyOutcome = compatibilityMode === 'strict' ? 'strict-reject' : 'legacy-fallback';
      if (policyOutcome === 'strict-reject') {
        const detail = `Direction set ${setId} @ ${occupy}: unresolved mixed-face observations in strict mode (${mode.toUpperCase()})`;
        logs.push(`Error: ${detail}`);
        directionRejectDiagnostics.push({
          setId,
          occupy,
          sourceLine: Math.min(...workingShots.map((shot) => shot.sourceLine)),
          sourceFile: getCurrentSourceFile(),
          recordType: 'UNKNOWN',
          reason: 'unresolved-mixed-face',
          faceSource: initialFaceSource,
          treatmentDecision,
          policyOutcome,
          detail,
        });
        directionSetTreatmentDiagnostics.push({
          setId,
          occupy,
          sourceLine: Math.min(...workingShots.map((shot) => shot.sourceLine)),
          sourceFile: getCurrentSourceFile(),
          faceSource: initialFaceSource,
          treatmentDecision,
          policyOutcome,
          faceNormalizationMode: mode,
          parseCompatibilityMode: compatibilityMode,
          readingCount: workingShots.length,
          targetCount: new Set(workingShots.map((shot) => shot.to)).size,
          detail,
        });
        return;
      }
      logs.push(
        `Warning: direction set ${setId} @ ${occupy}: unresolved mixed-face observations; legacy fallback applied (split by face).`,
      );
      treatmentDecision = 'split';
    }

    const buckets: Array<{
      bucketSetId: string;
      normalizeFace2: boolean;
      shots: RawDirectionShot[];
    }> = [];
    if (treatmentDecision === 'normalized') {
      buckets.push({ bucketSetId: setId, normalizeFace2: true, shots: workingShots });
    } else {
      const face1Shots = workingShots.filter((shot) => shot.face === 'face1');
      const face2Shots = workingShots.filter((shot) => shot.face === 'face2');
      if (face1Shots.length > 0 && face2Shots.length > 0) {
        buckets.push({ bucketSetId: `${setId}:F1`, normalizeFace2: false, shots: face1Shots });
        buckets.push({ bucketSetId: `${setId}:F2`, normalizeFace2: false, shots: face2Shots });
      } else {
        buckets.push({
          bucketSetId: setId,
          normalizeFace2: false,
          shots: face1Shots.length > 0 ? face1Shots : face2Shots,
        });
      }
    }

    let reducedTotal = 0;
    let pairedTargets = 0;
    let face1Total = 0;
    let face2Total = 0;
    buckets.forEach((bucket) => {
      if (!bucket.shots.length) return;
      const emitted =
        state.directionSetMode === 'raw'
          ? pushRawDirectionBucket(
              bucket.bucketSetId,
              occupy,
              instCode,
              bucket.shots,
              bucket.normalizeFace2,
            )
          : reduceDirectionBucket(
              bucket.bucketSetId,
              occupy,
              instCode,
              bucket.shots,
              bucket.normalizeFace2,
            );
      reducedTotal += emitted.reducedCount;
      pairedTargets += emitted.pairedTargets;
      face1Total += emitted.face1Total;
      face2Total += emitted.face2Total;
    });

    const targetCount = new Set(workingShots.map((shot) => shot.to)).size;
    const finalFaceSource: DirectionFaceSource =
      initialFaceSource === 'unresolved' && policyOutcome === 'legacy-fallback'
        ? 'fallback'
        : initialFaceSource;
    const modeLabel = `mode=${mode.toUpperCase()} decision=${treatmentDecision.toUpperCase()} policy=${policyOutcome.toUpperCase()}`;
    const reductionMode = state.directionSetMode === 'raw' ? 'raw rows' : `reduced ${reducedTotal}`;
    logs.push(
      `Direction set ${setId} @ ${occupy}: ${reductionMode} from ${workingShots.length} shots (${modeLabel}, source=${finalFaceSource}, targets=${targetCount}, pairedTargets=${pairedTargets}, F1=${face1Total}, F2=${face2Total})`,
    );
    if (clusterSplit.centerSeparationDeg != null && clusterSplit.confidence != null) {
      logs.push(
        `Direction set ${setId} cluster check: separation=${clusterSplit.centerSeparationDeg.toFixed(2)}deg confidence=${clusterSplit.confidence.toFixed(3)} reliable=${clusterSplit.reliable ? 'YES' : 'NO'}`,
      );
    }
    directionSetTreatmentDiagnostics.push({
      setId,
      occupy,
      sourceLine: Math.min(...workingShots.map((shot) => shot.sourceLine)),
      sourceFile: getCurrentSourceFile(),
      faceSource: finalFaceSource,
      treatmentDecision,
      policyOutcome,
      faceNormalizationMode: mode,
      parseCompatibilityMode: compatibilityMode,
      readingCount: workingShots.length,
      targetCount,
      detail: `Direction set ${setId} ${treatmentDecision} (${policyOutcome})`,
    });
  };

  const flushDirectionSet = (traverseCtx: DirectionTraverseContext, reason: string): void => {
    if (!traverseCtx.dirSetId || !traverseCtx.occupy) return;
    const shots = traverseCtx.dirRawShots ?? [];
    const instCode = traverseCtx.dirInstCode ?? '';
    if (!shots.length) {
      logs.push(`Direction set ${traverseCtx.dirSetId} @ ${traverseCtx.occupy}: no directions (${reason})`);
      directionRejectDiagnostics.push({
        setId: traverseCtx.dirSetId,
        occupy: traverseCtx.occupy,
        sourceLine: getCurrentLine(),
        sourceFile: getCurrentSourceFile(),
        recordType: reason === 'DE' ? 'DE' : reason === 'new DB' ? 'DB' : 'UNKNOWN',
        reason: 'no-shots',
        detail: `No valid direction observations kept (${reason})`,
      });
    } else {
      reduceDirectionShots(traverseCtx.dirSetId, traverseCtx.occupy, instCode, shots);
    }
    traverseCtx.occupy = undefined;
    traverseCtx.backsight = undefined;
    traverseCtx.dirSetId = undefined;
    traverseCtx.dirInstCode = undefined;
    traverseCtx.dirRawShots = undefined;
  };

  return {
    flushDirectionSet,
    inferFaceFromZenith,
    isReliableFaceSource,
    parseDirectionFaceHintToken,
    reduceDirectionShots,
    stripDirectionFaceHints,
  };
};
