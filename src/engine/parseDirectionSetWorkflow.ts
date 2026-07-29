import { RAD_TO_DEG } from './angles';
import {
  pushRawDirectionBucket,
  reduceDirectionBucket,
  weightedCircularMean,
  wrapTo2Pi,
  wrapToPi,
} from './parseDirectionSetEmission';
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
  planned?: boolean;
  stdDev: number;
  sigmaSource: SigmaSource;
  sourceLine: number;
  face: DirectionFace;
  faceSource: DirectionFaceSource;
  reliableFace: boolean;
  isOrientationReference?: boolean;
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
  obsIdRef: { current: number };
  pushObservation: (_observation: Observation) => void;
  directionRejectDiagnostics: DirectionRejectDiagnostic[];
  directionSetTreatmentDiagnostics: DirectionSetTreatmentDiagnostic[];
}

const directionFaceSourceRank: DirectionFaceSource[] = ['metadata', 'zenith', 'cluster', 'fallback', 'unresolved'];

export const createDirectionSetWorkflow = ({
  state,
  logs,
  compatibilityMode,
  getCurrentLine,
  getCurrentSourceFile,
  obsIdRef,
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

  const pickDirectionFaceSource = (shots: RawDirectionShot[]): DirectionFaceSource => {
    const available = new Set<DirectionFaceSource>(shots.map((shot) => shot.faceSource));
    for (const source of directionFaceSourceRank) {
      if (available.has(source)) return source;
    }
    return 'fallback';
  };

  const reduceDirectionShots = (
    setId: string,
    occupy: StationId,
    instCode: string,
    shots: RawDirectionShot[],
  ): void => {
    if (!shots.length) return;

    let workingShots = shots.map((shot) => ({ ...shot }));
    const faceClassifiedShots = workingShots.filter((shot) => !shot.isOrientationReference);
    const clusterSplit = splitFaceByCluster(faceClassifiedShots);
    if (clusterSplit.reliable) {
      workingShots = workingShots.map((shot) =>
        !shot.isOrientationReference && shot.faceSource === 'fallback'
          ? { ...shot, faceSource: 'cluster' as DirectionFaceSource, reliableFace: true }
          : shot,
      );
    }

    const nonOrientationTargetIds = new Set(
      workingShots.filter((shot) => !shot.isOrientationReference).map((shot) => shot.to),
    );
    const updatedFaceClassifiedShots = workingShots.filter(
      (shot) => !shot.isOrientationReference || nonOrientationTargetIds.has(shot.to),
    );
    const mixedFaces = new Set(updatedFaceClassifiedShots.map((shot) => shot.face)).size > 1;
    const hasUnreliableFace = updatedFaceClassifiedShots.some((shot) => !shot.reliableFace);
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
      policyOutcome =
        state.directionSetMode === 'raw'
          ? 'legacy-fallback'
          : compatibilityMode === 'strict'
            ? 'strict-reject'
            : 'legacy-fallback';
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
    const orientationShots = workingShots.filter((shot) => shot.isOrientationReference);
    const seedOrientationShots = (
      bucketShots: RawDirectionShot[],
      bucketFace: DirectionFace,
    ): RawDirectionShot[] => {
      if (!orientationShots.length) return bucketShots;
      if (bucketShots.some((shot) => shot.isOrientationReference)) return bucketShots;
      const bucketTargets = new Set(bucketShots.map((shot) => shot.to));
      const seededShots = orientationShots.filter((shot) => !bucketTargets.has(shot.to));
      if (!seededShots.length) return bucketShots;
      return [
        ...seededShots.map((shot) => ({
          ...shot,
          face: bucketFace,
          reliableFace: true,
        })),
        ...bucketShots,
      ];
    };
    if (treatmentDecision === 'normalized') {
      buckets.push({ bucketSetId: setId, normalizeFace2: true, shots: workingShots });
    } else {
      const face1Shots = workingShots.filter((shot) => shot.face === 'face1');
      const face2Shots = workingShots.filter((shot) => shot.face === 'face2');
      if (face1Shots.length > 0 && face2Shots.length > 0) {
        buckets.push({
          bucketSetId: `${setId}:F1`,
          normalizeFace2: false,
          shots: seedOrientationShots(face1Shots, 'face1'),
        });
        buckets.push({
          bucketSetId: `${setId}:F2`,
          normalizeFace2: true,
          shots: seedOrientationShots(face2Shots, 'face2'),
        });
      } else {
        const bucketShots = face1Shots.length > 0 ? face1Shots : face2Shots;
        const bucketFace: DirectionFace = face1Shots.length > 0 ? 'face1' : 'face2';
        buckets.push({
          bucketSetId: setId,
          normalizeFace2: bucketFace === 'face2',
          shots: seedOrientationShots(bucketShots, bucketFace),
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
          ? pushRawDirectionBucket({
              bucketSetId: bucket.bucketSetId,
              occupy,
              instCode,
              shots: bucket.shots,
              normalizeFace2: bucket.normalizeFace2,
              obsIdRef,
              pushObservation,
            })
          : reduceDirectionBucket({
              bucketSetId: bucket.bucketSetId,
              occupy,
              instCode,
              shots: bucket.shots,
              normalizeFace2: bucket.normalizeFace2,
              obsIdRef,
              pushObservation,
            });
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
