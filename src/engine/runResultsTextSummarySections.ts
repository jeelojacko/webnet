import { RAD_TO_DEG } from './angles';
import { appendSolveProfileDiagnostics } from './runResultsTextDiagnostics';
import type { RunResultsTextContext } from './runResultsTextContext';
import type { AdjustmentResult, CustomLevelLoopTolerancePreset } from '../types';

export const appendRunResultsHeaderAndStatus = ({
  lines,
  res,
  now,
  levelLoopCustomPresets,
  context,
}: {
  lines: string[];
  res: AdjustmentResult;
  now: Date;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
  context: RunResultsTextContext;
}): void => {
  const {
    linearUnit,
    unitScale,
    runDiag,
    outputStationCovariances,
    outputRelativeCovariances,
    isPreanalysis,
    runModeProfileText,
  } = context;
    lines.push(`# WebNet Adjustment Results`);
    lines.push(`# Generated: ${now.toLocaleString()}`);
    lines.push(`# Linear units: ${linearUnit}`);
    lines.push(
      `# Reduction: profile=${runDiag.solveProfile}, runMode=${runModeProfileText}, autoSideshot=${runDiag.autoSideshotEnabled ? 'ON' : 'OFF'}, autoAdjust=${runDiag.autoAdjustEnabled ? 'ON' : 'OFF'}(|t|>=${runDiag.autoAdjustStdResThreshold.toFixed(2)},cycles=${runDiag.autoAdjustMaxCycles},maxRm=${runDiag.autoAdjustMaxRemovalsPerCycle}), dirSets=${runDiag.directionSetMode}, mapMode=${runDiag.mapMode}, mapScale=${runDiag.mapScaleFactor.toFixed(8)}, crsScale=${runDiag.crsGridScaleEnabled ? `ON(${runDiag.crsGridScaleFactor.toFixed(8)})` : 'OFF'}, crsConv=${runDiag.crsConvergenceEnabled ? `ON(${(runDiag.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)}deg)` : 'OFF'}, geoid=${runDiag.geoidModelEnabled ? `ON(${runDiag.geoidModelId},${runDiag.geoidInterpolation.toUpperCase()})` : 'OFF'}, geoidH=${runDiag.geoidHeightConversionEnabled ? `ON(${runDiag.geoidOutputHeightDatum.toUpperCase()},conv=${runDiag.geoidConvertedStationCount},skip=${runDiag.geoidSkippedStationCount})` : 'OFF'}, gpsLoop=${runDiag.gpsLoopCheckEnabled ? 'ON' : 'OFF'}, levelLoopTol=${runDiag.levelLoopToleranceBaseMm.toFixed(2)}mm+${runDiag.levelLoopTolerancePerSqrtKmMm.toFixed(2)}mm*sqrt(km), gpsAddHiHt=${runDiag.gpsAddHiHtEnabled ? `ON(HI=${(runDiag.gpsAddHiHtHiM * unitScale).toFixed(4)}${linearUnit},HT=${(runDiag.gpsAddHiHtHtM * unitScale).toFixed(4)}${linearUnit})` : 'OFF'}, curvRef=${runDiag.applyCurvatureRefraction ? 'ON' : 'OFF'}, k=${runDiag.refractionCoefficient.toFixed(3)}, vRed=${runDiag.verticalReduction}, qfixLin=${(runDiag.qFixLinearSigmaM * unitScale).toExponential(6)}${linearUnit}, qfixAng=${runDiag.qFixAngularSigmaSec.toExponential(6)}sec, prism=${runDiag.prismEnabled ? `ON(${runDiag.prismOffset.toFixed(4)}m,${runDiag.prismScope})` : 'OFF'}, rotation=${(runDiag.rotationAngleRad * RAD_TO_DEG).toFixed(6)}deg, tsCorr=${runDiag.tsCorrelationEnabled ? 'ON' : 'OFF'}(${runDiag.tsCorrelationScope},rho=${runDiag.tsCorrelationRho.toFixed(3)}), robust=${runDiag.robustMode.toUpperCase()}(k=${runDiag.robustK.toFixed(2)})`,
    );
    lines.push(
      `# Parity: profileFallback=${runDiag.profileDefaultInstrumentFallback ? 'ON' : 'OFF'}, angleCentering=${runDiag.angleCenteringModel}, faceNormalize=${runDiag.faceNormalizationMode.toUpperCase()}(normalize=${runDiag.normalize ? 'ON' : 'OFF'}), angleMode=${runDiag.angleMode.toUpperCase()}`,
    );
    lines.push('');
    appendSolveProfileDiagnostics({
      lines,
      res,
      levelLoopCustomPresets,
      context,
    });
    lines.push(`Status: ${res.converged ? 'CONVERGED' : 'NOT CONVERGED'}`);
    lines.push(`Iterations: ${res.iterations}`);
    lines.push(
      isPreanalysis
        ? `A-priori sigma0: ${res.seuw.toFixed(4)} (predicted precision mode)`
        : `SEUW: ${res.seuw.toFixed(4)} (DOF: ${res.dof})`,
    );
    if (res.condition) {
      lines.push(
        `Normal matrix condition estimate: ${res.condition.estimate.toExponential(4)} (threshold ${res.condition.threshold.toExponential(
          2,
        )}) ${res.condition.flagged ? 'WARNING' : 'OK'}`,
      );
    }
    if (res.controlConstraints) {
      lines.push(
        `Weighted control constraints: ${res.controlConstraints.count} (E=${res.controlConstraints.x}, N=${res.controlConstraints.y}, H=${res.controlConstraints.h}, corrXY=${res.controlConstraints.xyCorrelated ?? 0})`,
      );
    }
    if (isPreanalysis) {
      lines.push(
        `Preanalysis summary: plannedObs=${res.parseState?.plannedObservationCount ?? 0}, stationCovBlocks=${outputStationCovariances.length}, connectedPairBlocks=${outputRelativeCovariances.length}`,
      );
      lines.push(
        'Residual-based QC: disabled (chi-square, suspect ranking, and exclusion workflows omitted).',
      );
    } else if (res.chiSquare) {
      lines.push(
        `Chi-square: T=${res.chiSquare.T.toFixed(4)} dof=${res.chiSquare.dof} p=${res.chiSquare.p.toFixed(
          4,
        )} (${res.chiSquare.pass95 ? 'PASS' : 'FAIL'} @95%)`,
      );
      lines.push(
        `Chi-square 95% interval: [${res.chiSquare.lower.toFixed(4)}, ${res.chiSquare.upper.toFixed(
          4,
        )}]`,
      );
      lines.push(
        `Variance factor: ${res.chiSquare.varianceFactor.toFixed(
          4,
        )} (accepted: ${res.chiSquare.varianceFactorLower.toFixed(
          4,
        )} .. ${res.chiSquare.varianceFactorUpper.toFixed(4)})`,
      );
      lines.push(
        `Error-factor bounds: ${Math.sqrt(res.chiSquare.varianceFactorLower).toFixed(4)} .. ${Math.sqrt(
          res.chiSquare.varianceFactorUpper,
        ).toFixed(4)}`,
      );
    }
    if (res.tsCorrelationDiagnostics) {
      const d = res.tsCorrelationDiagnostics;
      lines.push(
        `TS correlation: ${d.enabled ? 'ON' : 'OFF'} (scope=${d.scope}, rho=${d.rho.toFixed(3)})`,
      );
      if (d.enabled) {
        lines.push(
          `TS correlation diagnostics: groups=${d.groupCount}, equations=${d.equationCount}, pairs=${d.pairCount}, maxGroup=${d.maxGroupSize}, mean|offdiagW|=${d.meanAbsOffDiagWeight != null ? d.meanAbsOffDiagWeight.toExponential(4) : '-'}`,
        );
        const topGroups = d.groups.slice(0, 20);
        if (topGroups.length > 0) {
          lines.push('TS correlation groups (top):');
          topGroups.forEach((g) => {
            lines.push(
              `  ${g.key}: rows=${g.rows}, pairs=${g.pairCount}, mean|offdiagW|=${g.meanAbsOffDiagWeight != null ? g.meanAbsOffDiagWeight.toExponential(4) : '-'}`,
            );
          });
        }
      }
    }
    if (res.robustDiagnostics) {
      const rd = res.robustDiagnostics;
      lines.push(
        `Robust mode: ${rd.enabled ? rd.mode.toUpperCase() : 'OFF'} (k=${rd.k.toFixed(2)})`,
      );
      if (rd.enabled) {
        rd.iterations.forEach((it) => {
          lines.push(
            `  Iter ${it.iteration}: downweighted=${it.downweightedRows}, meanW=${it.meanWeight.toFixed(3)}, minW=${it.minWeight.toFixed(3)}, max|v/sigma|=${it.maxNorm.toFixed(2)}`,
          );
        });
        if (rd.topDownweightedRows.length > 0) {
          lines.push('  Top downweighted rows:');
          rd.topDownweightedRows.slice(0, 20).forEach((r, idx) => {
            lines.push(
              `    ${idx + 1}. #${r.obsId} ${r.type.toUpperCase()} ${r.stations} line=${r.sourceLine ?? '-'} w=${r.weight.toFixed(3)} |v/sigma|=${r.norm.toFixed(2)}`,
            );
          });
        }
      }
    }
    if (!isPreanalysis && res.robustComparison?.enabled) {
      lines.push(
        `Robust/classical suspect overlap: ${res.robustComparison.overlapCount}/${Math.min(
          res.robustComparison.classicalTop.length,
          res.robustComparison.robustTop.length,
        )}`,
      );
    }
    if (res.clusterDiagnostics?.enabled) {
      const cd = res.clusterDiagnostics;
      lines.push(
        `Cluster detection: pass=${cd.passMode}, mode=${cd.linkageMode}, dim=${cd.dimension}, tol=${(
          cd.tolerance * unitScale
        ).toFixed(
          4,
        )} ${linearUnit}, pairHits=${cd.pairCount}, candidates=${cd.candidateCount}, approvedMerges=${cd.approvedMergeCount ?? 0}, mergeOutcomes=${cd.mergeOutcomes?.length ?? 0}, rejected=${cd.rejectedProposals?.length ?? 0}`,
      );
    }
    if (!isPreanalysis && res.autoAdjustDiagnostics?.enabled) {
      const ad = res.autoAdjustDiagnostics;
      lines.push(
        `Auto-adjust: ON (|t|>=${ad.threshold.toFixed(2)}, maxCycles=${ad.maxCycles}, maxRemovalsPerCycle=${ad.maxRemovalsPerCycle}, minRedund=${ad.minRedundancy.toFixed(2)}, stop=${ad.stopReason}, removed=${ad.removed.length})`,
      );
    }
    if (!isPreanalysis && res.autoSideshotDiagnostics?.enabled) {
      const sd = res.autoSideshotDiagnostics;
      lines.push(
        `Auto sideshot (M-lines): evaluated=${sd.evaluatedCount}, candidates=${sd.candidateCount}, excludedControl=${sd.excludedControlCount}, threshold=${sd.threshold.toFixed(2)}`,
      );
    }
    lines.push('');
};
