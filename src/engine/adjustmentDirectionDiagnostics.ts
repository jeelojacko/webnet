import { RAD_TO_DEG } from './angles';
import type { AdjustmentResult, DirectionObservation, Observation, StationId } from '../types';

export type DirectionSetStat = {
  count: number;
  rawCount: number;
  reducedCount: number;
  face1Count: number;
  face2Count: number;
  pairedTargets: number;
  sum: number;
  sumSq: number;
  maxAbs: number;
  pairDeltaCount: number;
  pairDeltaSum: number;
  pairDeltaMax: number;
  rawMaxResidualCount: number;
  rawMaxResidualSum: number;
  rawMaxResidualMax: number;
  targetIds: Set<StationId>;
  occupy: StationId;
  orientation: number;
};

export type DirectionDiagnosticsResult = {
  directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
  directionTargetDiagnostics?: AdjustmentResult['directionTargetDiagnostics'];
  directionRepeatabilityDiagnostics?: AdjustmentResult['directionRepeatabilityDiagnostics'];
  logs: string[];
};

export const buildDirectionDiagnostics = (
  observations: Observation[],
  stats: Map<string, DirectionSetStat>,
): DirectionDiagnosticsResult => {
  let directionSetDiagnostics: AdjustmentResult['directionSetDiagnostics'];
  let directionTargetDiagnostics: AdjustmentResult['directionTargetDiagnostics'];
  let directionRepeatabilityDiagnostics: AdjustmentResult['directionRepeatabilityDiagnostics'];
  const logs: string[] = [];
      if (stats.size > 0) {
        const summaries = Array.from(stats.entries()).sort((a, b) =>
          a[0].localeCompare(b[0]),
        );
        directionSetDiagnostics = summaries.map(([setId, stat]) => {
          const mean = stat.sum / Math.max(stat.count, 1);
          const rms = Math.sqrt(stat.sumSq / Math.max(stat.count, 1));
          const orientDeg = (((stat.orientation * RAD_TO_DEG) % 360) + 360) % 360;
          const orientationSeArcSec = stat.count > 0 ? rms / Math.sqrt(stat.count) : undefined;
          const targetCount = stat.targetIds.size;
          const readingCount = stat.rawCount;
          const underconstrainedOrientation = stat.count < 2 || targetCount < 2;
          return {
            setId,
            occupy: stat.occupy,
            readingCount,
            targetCount,
            rawCount: stat.rawCount,
            reducedCount: stat.reducedCount,
            face1Count: stat.face1Count,
            face2Count: stat.face2Count,
            pairedTargets: stat.pairedTargets,
            underconstrainedOrientation,
            orientationDeg: orientDeg,
            residualMeanArcSec: mean,
            residualRmsArcSec: rms,
            residualMaxArcSec: stat.maxAbs,
            orientationSeArcSec,
            meanFacePairDeltaArcSec:
              stat.pairDeltaCount > 0 ? stat.pairDeltaSum / stat.pairDeltaCount : undefined,
            maxFacePairDeltaArcSec: stat.pairDeltaCount > 0 ? stat.pairDeltaMax : undefined,
            meanRawMaxResidualArcSec:
              stat.rawMaxResidualCount > 0
                ? stat.rawMaxResidualSum / stat.rawMaxResidualCount
                : undefined,
            maxRawMaxResidualArcSec:
              stat.rawMaxResidualCount > 0 ? stat.rawMaxResidualMax : undefined,
          };
        });

        logs.push('Direction set summary (arcsec residuals):');
        directionSetDiagnostics.forEach((stat) => {
          logs.push(
            `  ${stat.setId} @ ${stat.occupy}: readings=${stat.readingCount}, targets=${stat.targetCount}, under=${stat.underconstrainedOrientation ? 'YES' : 'NO'}, raw=${stat.rawCount}, reduced=${stat.reducedCount}, pairs=${stat.pairedTargets}, F1=${stat.face1Count}, F2=${stat.face2Count}, mean=${(stat.residualMeanArcSec ?? 0).toFixed(2)}", rms=${(stat.residualRmsArcSec ?? 0).toFixed(2)}", max=${(stat.residualMaxArcSec ?? 0).toFixed(2)}", pairDeltaMax=${(stat.maxFacePairDeltaArcSec ?? 0).toFixed(2)}", rawMax=${(stat.maxRawMaxResidualArcSec ?? 0).toFixed(2)}", orient=${(stat.orientationDeg ?? 0).toFixed(4)}°, orientSE=${(stat.orientationSeArcSec ?? 0).toFixed(2)}"`,
          );
        });
      }

      {
        const directionTargets = observations
          .filter((obs): obs is DirectionObservation => obs.type === 'direction')
          .map((dir) => {
            const rawCount = typeof dir.rawCount === 'number' && dir.rawCount > 0 ? dir.rawCount : 1;
            const face1Count =
              typeof dir.rawFace1Count === 'number'
                ? dir.rawFace1Count
                : dir.obs >= Math.PI
                  ? 0
                  : rawCount;
            const face2Count =
              typeof dir.rawFace2Count === 'number'
                ? dir.rawFace2Count
                : Math.max(0, rawCount - face1Count);
            const faceBalanced = rawCount <= 1 ? true : Math.abs(face1Count - face2Count) <= 1;
            const rawSpreadArcSec =
              typeof dir.rawSpread === 'number'
                ? Math.abs(dir.rawSpread) * RAD_TO_DEG * 3600
                : undefined;
            const rawMaxResidualArcSec =
              typeof dir.rawMaxResidual === 'number'
                ? Math.abs(dir.rawMaxResidual) * RAD_TO_DEG * 3600
                : undefined;
            const facePairDeltaArcSec =
              typeof dir.facePairDelta === 'number'
                ? Math.abs(dir.facePairDelta) * RAD_TO_DEG * 3600
                : undefined;
            const face1SpreadArcSec =
              typeof dir.face1Spread === 'number'
                ? Math.abs(dir.face1Spread) * RAD_TO_DEG * 3600
                : undefined;
            const face2SpreadArcSec =
              typeof dir.face2Spread === 'number'
                ? Math.abs(dir.face2Spread) * RAD_TO_DEG * 3600
                : undefined;
            const reducedSigmaArcSec =
              typeof dir.reducedSigma === 'number'
                ? Math.abs(dir.reducedSigma) * RAD_TO_DEG * 3600
                : Math.abs(dir.stdDev) * RAD_TO_DEG * 3600;
            const residualArcSec =
              typeof dir.residual === 'number' ? dir.residual * RAD_TO_DEG * 3600 : undefined;
            const stdResAbs = Number.isFinite(dir.stdRes) ? Math.abs(dir.stdRes ?? 0) : undefined;
            const localPass = dir.localTest?.pass;
            const mdbArcSec = dir.mdb != null ? dir.mdb * RAD_TO_DEG * 3600 : undefined;

            let suspectScore = 0;
            if (localPass === false) suspectScore += 100;
            suspectScore += (stdResAbs ?? 0) * 10;
            suspectScore += Math.min((rawSpreadArcSec ?? 0) / 2, 50);
            suspectScore += Math.min((rawMaxResidualArcSec ?? 0) / 2, 50);
            suspectScore += Math.min((facePairDeltaArcSec ?? 0) / 2, 40);
            suspectScore += Math.min(
              Math.max(face1SpreadArcSec ?? 0, face2SpreadArcSec ?? 0) / 2,
              35,
            );
            if (!faceBalanced) suspectScore += 8;
            if (rawCount < 2) suspectScore += 4;

            return {
              setId: String(dir.setId ?? ''),
              occupy: dir.at,
              target: dir.to,
              sourceLine: dir.sourceLine,
              rawCount,
              face1Count,
              face2Count,
              faceBalanced,
              rawSpreadArcSec,
              rawMaxResidualArcSec,
              facePairDeltaArcSec,
              face1SpreadArcSec,
              face2SpreadArcSec,
              reducedSigmaArcSec,
              residualArcSec,
              stdRes: stdResAbs,
              localPass,
              mdbArcSec,
              suspectScore,
            };
          })
          .sort((a, b) => {
            if (b.suspectScore !== a.suspectScore) return b.suspectScore - a.suspectScore;
            const bStd = b.stdRes ?? 0;
            const aStd = a.stdRes ?? 0;
            if (bStd !== aStd) return bStd - aStd;
            const bSpread = b.rawSpreadArcSec ?? 0;
            const aSpread = a.rawSpreadArcSec ?? 0;
            if (bSpread !== aSpread) return bSpread - aSpread;
            const bRawMax = b.rawMaxResidualArcSec ?? 0;
            const aRawMax = a.rawMaxResidualArcSec ?? 0;
            if (bRawMax !== aRawMax) return bRawMax - aRawMax;
            const setCmp = a.setId.localeCompare(b.setId);
            if (setCmp !== 0) return setCmp;
            return a.target.localeCompare(b.target);
          });

        if (directionTargets.length > 0) {
          directionTargetDiagnostics = directionTargets;
          logs.push('Direction target repeatability (top suspects):');
          directionTargets.slice(0, 8).forEach((d) => {
            logs.push(
              `  ${d.setId} ${d.occupy}->${d.target}: raw=${d.rawCount}, F1=${d.face1Count}, F2=${d.face2Count}, spread=${d.rawSpreadArcSec != null ? `${d.rawSpreadArcSec.toFixed(2)}"` : '-'}, stdRes=${d.stdRes != null ? d.stdRes.toFixed(2) : '-'}, local=${d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}, score=${d.suspectScore.toFixed(1)}`,
            );
          });

          const repeatMap = new Map<
            string,
            {
              occupy: StationId;
              target: StationId;
              setCount: number;
              localFailCount: number;
              faceUnbalancedSets: number;
              resCount: number;
              resSum: number;
              resSumSq: number;
              resMin: number;
              resMax: number;
              resMaxAbs: number;
              stdCount: number;
              stdSumSq: number;
              maxStdRes: number;
              spreadCount: number;
              spreadSum: number;
              maxSpread: number;
              worstSetId?: string;
              worstLine?: number;
              worstMetric: number;
            }
          >();
          directionTargets.forEach((d) => {
            const key = `${d.occupy}>>${d.target}`;
            const existing = repeatMap.get(key);
            const entry = existing ?? {
              occupy: d.occupy,
              target: d.target,
              setCount: 0,
              localFailCount: 0,
              faceUnbalancedSets: 0,
              resCount: 0,
              resSum: 0,
              resSumSq: 0,
              resMin: Number.POSITIVE_INFINITY,
              resMax: Number.NEGATIVE_INFINITY,
              resMaxAbs: 0,
              stdCount: 0,
              stdSumSq: 0,
              maxStdRes: 0,
              spreadCount: 0,
              spreadSum: 0,
              maxSpread: 0,
              worstSetId: undefined,
              worstLine: undefined,
              worstMetric: Number.NEGATIVE_INFINITY,
            };
            entry.setCount += 1;
            if (d.localPass === false) entry.localFailCount += 1;
            if (!d.faceBalanced) entry.faceUnbalancedSets += 1;
            if (d.residualArcSec != null && Number.isFinite(d.residualArcSec)) {
              const absRes = Math.abs(d.residualArcSec);
              entry.resCount += 1;
              entry.resSum += d.residualArcSec;
              entry.resSumSq += d.residualArcSec * d.residualArcSec;
              entry.resMin = Math.min(entry.resMin, d.residualArcSec);
              entry.resMax = Math.max(entry.resMax, d.residualArcSec);
              entry.resMaxAbs = Math.max(entry.resMaxAbs, absRes);
            }
            if (d.stdRes != null && Number.isFinite(d.stdRes)) {
              entry.stdCount += 1;
              entry.stdSumSq += d.stdRes * d.stdRes;
              entry.maxStdRes = Math.max(entry.maxStdRes, d.stdRes);
            }
            if (d.rawSpreadArcSec != null && Number.isFinite(d.rawSpreadArcSec)) {
              entry.spreadCount += 1;
              entry.spreadSum += d.rawSpreadArcSec;
              entry.maxSpread = Math.max(entry.maxSpread, d.rawSpreadArcSec);
            }
            const worstMetric = (d.stdRes ?? 0) * 100 + (d.rawSpreadArcSec ?? 0);
            if (worstMetric > entry.worstMetric) {
              entry.worstMetric = worstMetric;
              entry.worstSetId = d.setId;
              entry.worstLine = d.sourceLine;
            }
            repeatMap.set(key, entry);
          });

          const repeatRows = Array.from(repeatMap.values())
            .map((entry) => {
              const residualMeanArcSec =
                entry.resCount > 0 ? entry.resSum / entry.resCount : undefined;
              const residualRmsArcSec =
                entry.resCount > 0 ? Math.sqrt(entry.resSumSq / entry.resCount) : undefined;
              const residualRangeArcSec =
                entry.resCount > 0 ? Math.abs(entry.resMax - entry.resMin) : undefined;
              const stdResRms =
                entry.stdCount > 0 ? Math.sqrt(entry.stdSumSq / entry.stdCount) : undefined;
              const meanRawSpreadArcSec =
                entry.spreadCount > 0 ? entry.spreadSum / entry.spreadCount : undefined;
              const maxRawSpreadArcSec = entry.spreadCount > 0 ? entry.maxSpread : undefined;

              let suspectScore = 0;
              suspectScore += entry.localFailCount * 80;
              suspectScore += entry.maxStdRes * 12;
              suspectScore += Math.min((maxRawSpreadArcSec ?? 0) / 2, 45);
              suspectScore += entry.faceUnbalancedSets * 8;
              if (entry.setCount > 1 && residualRangeArcSec != null) {
                suspectScore += Math.min(residualRangeArcSec / 2, 35);
              }
              if (entry.setCount <= 1) suspectScore -= 5;

              return {
                occupy: entry.occupy,
                target: entry.target,
                setCount: entry.setCount,
                localFailCount: entry.localFailCount,
                faceUnbalancedSets: entry.faceUnbalancedSets,
                residualMeanArcSec,
                residualRmsArcSec,
                residualRangeArcSec,
                residualMaxArcSec: entry.resCount > 0 ? entry.resMaxAbs : undefined,
                stdResRms,
                maxStdRes: entry.stdCount > 0 ? entry.maxStdRes : undefined,
                meanRawSpreadArcSec,
                maxRawSpreadArcSec,
                worstSetId: entry.worstSetId,
                worstLine: entry.worstLine,
                suspectScore,
              };
            })
            .sort((a, b) => {
              if (b.suspectScore !== a.suspectScore) return b.suspectScore - a.suspectScore;
              const bLocal = b.localFailCount;
              const aLocal = a.localFailCount;
              if (bLocal !== aLocal) return bLocal - aLocal;
              const bStd = b.maxStdRes ?? 0;
              const aStd = a.maxStdRes ?? 0;
              if (bStd !== aStd) return bStd - aStd;
              const bSpread = b.maxRawSpreadArcSec ?? 0;
              const aSpread = a.maxRawSpreadArcSec ?? 0;
              if (bSpread !== aSpread) return bSpread - aSpread;
              const stnCmp = a.occupy.localeCompare(b.occupy);
              if (stnCmp !== 0) return stnCmp;
              return a.target.localeCompare(b.target);
            });

          if (repeatRows.length > 0) {
            directionRepeatabilityDiagnostics = repeatRows;
            logs.push('Direction repeatability by occupy-target (top suspects):');
            repeatRows.slice(0, 8).forEach((d) => {
              logs.push(
                `  ${d.occupy}->${d.target}: sets=${d.setCount}, range=${d.residualRangeArcSec != null ? `${d.residualRangeArcSec.toFixed(2)}"` : '-'}, max|t|=${d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-'}, spreadMax=${d.maxRawSpreadArcSec != null ? `${d.maxRawSpreadArcSec.toFixed(2)}"` : '-'}, localFail=${d.localFailCount}, score=${d.suspectScore.toFixed(1)}`,
              );
            });
          }
        }
      }

  return {
    directionSetDiagnostics,
    directionTargetDiagnostics,
    directionRepeatabilityDiagnostics,
    logs,
  };
};
