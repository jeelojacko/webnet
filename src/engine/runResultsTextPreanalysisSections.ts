import type { RunResultsTextContext } from './runResultsTextContext';
import type { AdjustmentResult } from '../types';

type PreanalysisSectionContext = Pick<
  RunResultsTextContext,
  'linearUnit' | 'unitScale' | 'isPreanalysis'
>;

export const appendPreanalysisGeometrySections = ({
  lines,
  res,
  context,
}: {
  lines: string[];
  res: AdjustmentResult;
  context: PreanalysisSectionContext;
}): void => {
  const { isPreanalysis } = context;

  if (!isPreanalysis) return;

  appendWeakGeometrySection({ lines, res, context });
  appendPreanalysisImpactSection({ lines, res, context });
};

const appendWeakGeometrySection = ({
  lines,
  res,
  context,
}: {
  lines: string[];
  res: AdjustmentResult;
  context: PreanalysisSectionContext;
}): void => {
  const { linearUnit, unitScale } = context;
  const diagnostics = res.weakGeometryDiagnostics;

  if (!diagnostics) return;

  const flaggedStationCues = diagnostics.stationCues.filter((cue) => cue.severity !== 'ok');
  const flaggedRelativeCues = diagnostics.relativeCues.filter((cue) => cue.severity !== 'ok');
  lines.push('--- Weak Geometry Cues ---');
  lines.push(
    `Median station major=${(diagnostics.stationMedianHorizontal * unitScale).toFixed(
      4,
    )} ${linearUnit}; median pair sigmaDist=${
      diagnostics.relativeMedianDistance != null
        ? `${(diagnostics.relativeMedianDistance * unitScale).toFixed(4)} ${linearUnit}`
        : '-'
    }`,
  );
  if (flaggedStationCues.length === 0 && flaggedRelativeCues.length === 0) {
    lines.push('No weak-geometry cues flagged.');
  } else {
    flaggedStationCues.forEach((cue) => {
      lines.push(
        `Station ${cue.stationId}: ${cue.severity.toUpperCase()} metric=${(
          cue.horizontalMetric * unitScale
        ).toFixed(4)} ${linearUnit} ratio=${
          cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'
        } shape=${cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'} ${cue.note}`,
      );
    });
    flaggedRelativeCues.forEach((cue) => {
      lines.push(
        `Pair ${cue.from}-${cue.to}: ${cue.severity.toUpperCase()} metric=${
          cue.distanceMetric != null
            ? `${(cue.distanceMetric * unitScale).toFixed(4)} ${linearUnit}`
            : '-'
        } ratio=${cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'} shape=${
          cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'
        } ${cue.note}`,
      );
    });
  }
  lines.push('');
};

const appendPreanalysisImpactSection = ({
  lines,
  res,
  context,
}: {
  lines: string[];
  res: AdjustmentResult;
  context: PreanalysisSectionContext;
}): void => {
  const { linearUnit, unitScale } = context;
  const diagnostics = res.preanalysisImpactDiagnostics;

  if (!diagnostics) return;

  const formatPreanalysisValue = (value?: number): string => {
    if (value == null || !Number.isFinite(value)) return '-';
    const scaled = value * unitScale;
    const fixed = scaled.toFixed(4);
    return scaled !== 0 && Number.parseFloat(fixed) === 0 ? scaled.toExponential(3) : fixed;
  };

  lines.push('--- Preanalysis Added-Set / Brace Recommendations ---');
  lines.push(
    `appliedScenarios=${diagnostics.activeSyntheticAdditionCount}, candidateScenarios=${diagnostics.candidateTemplateCount}, worstStationMajor=${
      diagnostics.baseWorstStationMajor != null
        ? `${formatPreanalysisValue(diagnostics.baseWorstStationMajor)} ${linearUnit}`
        : '-'
    }, worstPairSigmaDist=${
      diagnostics.baseWorstPairSigmaDist != null
        ? `${formatPreanalysisValue(diagnostics.baseWorstPairSigmaDist)} ${linearUnit}`
        : '-'
    }, weakStations=${diagnostics.baseWeakStationCount}, weakPairs=${diagnostics.baseWeakPairCount}, targetThreshold=${
      diagnostics.targetThresholdMeters != null
        ? `${formatPreanalysisValue(diagnostics.targetThresholdMeters)} ${linearUnit}`
        : '-'
    }`,
  );
  lines.push(
    `thresholdPlan: reached=${diagnostics.thresholdPlan.thresholdReached ? 'yes' : 'no'}, steps=${diagnostics.thresholdPlan.appliedStepCount}, finalWorstMajor=${
      diagnostics.thresholdPlan.finalWorstStationMajor != null
        ? `${formatPreanalysisValue(diagnostics.thresholdPlan.finalWorstStationMajor)} ${linearUnit}`
        : '-'
    }, note=${diagnostics.thresholdPlan.unmetReason ?? '-'}`,
  );
  lines.push(
    'Setup\tSet\tAffected\tLine\tAddedObs\tdWorstMaj\tdMedianMaj\tdWorstPair\tdWeakStn\tdWeakPair\tScore\tThreshold\tStatus',
  );
  diagnostics.rows.forEach((row) => {
    lines.push(
      `${row.setupStationIds.join(',')}\t${row.templateLabel}\t${row.affectedStations.join(',')}\t${row.sourceLines[0] ?? '-'}\t${row.addedObservationCount}\t${formatPreanalysisValue(row.deltaWorstStationMajor)}\t${formatPreanalysisValue(row.deltaMedianStationMajor)}\t${formatPreanalysisValue(row.deltaWorstPairSigmaDist)}\t${row.deltaWeakStationCount ?? '-'}\t${row.deltaWeakPairCount ?? '-'}\t${
        row.score != null ? row.score.toFixed(2) : '-'
      }\t${row.thresholdReached ? 'yes' : 'no'}\t${row.status}`,
    );
  });
  lines.push('');
};
