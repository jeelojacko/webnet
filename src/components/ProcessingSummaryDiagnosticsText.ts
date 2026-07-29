import type { AdjustmentResult, ReductionUsageSummary, RunMode } from '../types';
import { buildReductionUsageSignature } from '../engine/plainData';
import type { ProcessingSummaryViewProps } from './ProcessingSummaryView.types';

const formatUsageSummary = (summary?: ReductionUsageSummary): string => {
  if (!summary) return 'unavailable';
  return [
    `bearing[g=${summary.bearing.grid},m=${summary.bearing.measured}]`,
    `angle[g=${summary.angle.grid},m=${summary.angle.measured}]`,
    `direction[g=${summary.direction.grid},m=${summary.direction.measured}]`,
    `distance[ground=${summary.distance.ground},grid=${summary.distance.grid},ellip=${summary.distance.ellipsoidal}]`,
    `total=${summary.total}`,
  ].join('; ');
};

export const appendRunDiagnosticsSummaryLines = ({
  linearUnit,
  lines,
  result,
  runDiagnostics,
  runMode,
  unitScale,
}: {
  linearUnit: string;
  lines: string[];
  result: AdjustmentResult;
  runDiagnostics: NonNullable<ProcessingSummaryViewProps['runDiagnostics']>;
  runMode: RunMode;
  unitScale: number;
}): void => {
  lines.push(
    `Run Profile: ${runDiagnostics.solveProfile.toUpperCase()} (dirSets=${runDiagnostics.directionSetMode}, profileFallback=${runDiagnostics.profileDefaultInstrumentFallback ? 'ON' : 'OFF'})`,
  );
  lines.push(`Run Mode: ${runMode.toUpperCase()}`);
  lines.push(
    `Plan Rotation: ${((runDiagnostics.rotationAngleRad * 180) / Math.PI).toFixed(6)} deg`,
  );
  lines.push(
    `Coordinate System: ${(runDiagnostics.coordSystemMode ?? 'local').toUpperCase()} (CRS=${runDiagnostics.crsId ?? '-'})`,
  );
  if ((runDiagnostics.coordSystemMode ?? 'local') === 'local') {
    lines.push(
      `Local Datum Scheme: ${String(runDiagnostics.localDatumScheme ?? 'average-scale').toUpperCase()} (scale=${(runDiagnostics.averageScaleFactor ?? 1).toFixed(8)}, commonElev=${((runDiagnostics.commonElevation ?? 0) * unitScale).toFixed(4)}${linearUnit})`,
    );
  } else {
    appendGridContextLines(lines, result, runDiagnostics);
  }
  appendDatumAndCrsLines(lines, result, runDiagnostics, unitScale, linearUnit);
  appendGeoidAndGpsHeightLines(lines, runDiagnostics, unitScale, linearUnit);
};

const appendGridContextLines = (
  lines: string[],
  result: AdjustmentResult,
  runDiagnostics: NonNullable<ProcessingSummaryViewProps['runDiagnostics']>,
): void => {
  lines.push(
    `Directive Context (End of File): bearing=${String(runDiagnostics.gridBearingMode ?? 'grid').toUpperCase()}, distance=${String(runDiagnostics.gridDistanceMode ?? 'measured').toUpperCase()}, angle=${String(runDiagnostics.gridAngleMode ?? 'measured').toUpperCase()}, direction=${String(runDiagnostics.gridDirectionMode ?? 'measured').toUpperCase()}`,
  );
  lines.push(
    `.SCALE Override: ${
      (runDiagnostics.scaleOverrideActive ?? result.parseState?.scaleOverrideActive ?? false)
        ? `ON (k=${(runDiagnostics.averageScaleFactor ?? 1).toFixed(8)})`
        : 'OFF'
    }`,
  );
  lines.push(
    `GNSS Frame Default: ${
      runDiagnostics.gnssVectorFrameDefault ??
      result.parseState?.gnssVectorFrameDefault ??
      'gridNEU'
    } (confirmed=${
      (runDiagnostics.gnssFrameConfirmed ?? result.parseState?.gnssFrameConfirmed) ? 'YES' : 'NO'
    })`,
  );
  lines.push(
    `Applied Reduction Modes (Parsed): ${formatUsageSummary(runDiagnostics.parsedUsageSummary)}`,
  );
  lines.push(
    `Applied Reduction Modes (Used In Solve): ${formatUsageSummary(
      runDiagnostics.usedInSolveUsageSummary,
    )}`,
  );
  const hasDirectiveContextDelta =
    buildReductionUsageSignature(runDiagnostics.parsedUsageSummary) !==
    buildReductionUsageSignature(runDiagnostics.usedInSolveUsageSummary);
  if (hasDirectiveContextDelta) {
    lines.push(
      'Note: parsed reduction usage differs from used-in-solve usage due to filtering/exclusions.',
    );
  }
  (runDiagnostics.directiveNoEffectWarnings ?? []).forEach((warning) => {
    lines.push(
      `Directive no-effect warning: ${warning.directive} at line ${warning.line} (${warning.reason})`,
    );
  });
  (runDiagnostics.directiveTransitions ?? []).forEach((transition) => {
    lines.push(
      `Directive range: ${transition.directive} line ${transition.effectiveFromLine}${transition.effectiveToLine != null ? `-${transition.effectiveToLine}` : '-EOF'} (obs=${transition.obsCountInRange})`,
    );
  });
};

const appendDatumAndCrsLines = (
  lines: string[],
  result: AdjustmentResult,
  runDiagnostics: NonNullable<ProcessingSummaryViewProps['runDiagnostics']>,
  unitScale: number,
  linearUnit: string,
): void => {
  const datumSufficiency =
    runDiagnostics.datumSufficiencyReport ?? result.parseState?.datumSufficiencyReport;
  if (datumSufficiency) {
    lines.push(
      `Datum Sufficiency: ${datumSufficiency.status.toUpperCase()} (${datumSufficiency.reasons.length} reason${datumSufficiency.reasons.length === 1 ? '' : 's'})`,
    );
    datumSufficiency.reasons.forEach((reason) => lines.push(`Reason: ${reason}`));
    datumSufficiency.suggestions.forEach((suggestion) => lines.push(`Suggestion: ${suggestion}`));
  }
  lines.push(
    `Average Geoid Height Fallback: ${((runDiagnostics.averageGeoidHeight ?? 0) * unitScale).toFixed(4)}${linearUnit}`,
  );
  lines.push(
    `CRS Grid-Ground Scale: ${runDiagnostics.crsGridScaleEnabled ? `ON (${(runDiagnostics.crsGridScaleFactor ?? 1).toFixed(8)})` : 'OFF'}`,
  );
  lines.push(
    `CRS Convergence: ${runDiagnostics.crsConvergenceEnabled ? `ON (${(((runDiagnostics.crsConvergenceAngleRad ?? 0) * 180) / Math.PI).toFixed(6)} deg)` : 'OFF'}`,
  );
  if ((runDiagnostics.coordSystemMode ?? 'local') === 'grid') {
    lines.push(
      `CRS Datum Operation: ${runDiagnostics.crsDatumOpId ?? '-'}${runDiagnostics.crsDatumFallbackUsed ? ' (fallback)' : ''}`,
    );
    lines.push(
      `CRS Area-of-Use: ${String(runDiagnostics.crsAreaOfUseStatus ?? 'unknown').toUpperCase()}${runDiagnostics.crsAreaOfUseStatus === 'outside' ? ` (outside=${runDiagnostics.crsOutOfAreaStationCount ?? 0})` : ''}`,
    );
  }
  if ((runDiagnostics.coordSystemDiagnostics?.length ?? 0) > 0) {
    lines.push(`CRS Diagnostics: ${runDiagnostics.coordSystemDiagnostics?.join(', ')}`);
  }
  if ((runDiagnostics.coordSystemWarningMessages?.length ?? 0) > 0) {
    lines.push(`CRS Warning Count: ${runDiagnostics.coordSystemWarningMessages?.length ?? 0}`);
  }
};

const appendGeoidAndGpsHeightLines = (
  lines: string[],
  runDiagnostics: NonNullable<ProcessingSummaryViewProps['runDiagnostics']>,
  unitScale: number,
  linearUnit: string,
): void => {
  lines.push(
    `Geoid/Grid Model: ${runDiagnostics.geoidModelEnabled ? `ON (${runDiagnostics.geoidModelId ?? 'NGS-DEMO'}, ${String(runDiagnostics.geoidInterpolation ?? 'bilinear').toUpperCase()}, loaded=${runDiagnostics.geoidModelLoaded ? 'YES' : 'NO'})` : 'OFF'}`,
  );
  if (runDiagnostics.geoidModelEnabled) {
    lines.push(
      `Geoid Metadata: ${runDiagnostics.geoidModelMetadata || 'unavailable'}${runDiagnostics.geoidSampleUndulationM != null ? `; sampleN=${runDiagnostics.geoidSampleUndulationM.toFixed(4)}m` : ''}`,
    );
  }
  lines.push(
    `Geoid Height Conversion: ${runDiagnostics.geoidHeightConversionEnabled ? `ON (${String(runDiagnostics.geoidOutputHeightDatum ?? 'orthometric').toUpperCase()}, converted=${runDiagnostics.geoidConvertedStationCount ?? 0}, skipped=${runDiagnostics.geoidSkippedStationCount ?? 0})` : 'OFF'}`,
  );
  lines.push(
    `GPS AddHiHt Defaults: ${runDiagnostics.gpsAddHiHtEnabled ? `ON (HI=${((runDiagnostics.gpsAddHiHtHiM ?? 0) * unitScale).toFixed(4)}${linearUnit}, HT=${((runDiagnostics.gpsAddHiHtHtM ?? 0) * unitScale).toFixed(4)}${linearUnit})` : 'OFF'}`,
  );
  if (runDiagnostics.gpsAddHiHtEnabled) {
    lines.push(
      `GPS AddHiHt Preprocess: vectors=${runDiagnostics.gpsAddHiHtVectorCount ?? 0}, adjusted=${runDiagnostics.gpsAddHiHtAppliedCount ?? 0} (+${runDiagnostics.gpsAddHiHtPositiveCount ?? 0}/-${runDiagnostics.gpsAddHiHtNegativeCount ?? 0}/neutral=${runDiagnostics.gpsAddHiHtNeutralCount ?? 0}), defaultZero=${runDiagnostics.gpsAddHiHtDefaultZeroCount ?? 0}, missingHeight=${runDiagnostics.gpsAddHiHtMissingHeightCount ?? 0}, scale=[${(runDiagnostics.gpsAddHiHtScaleMin ?? 1).toFixed(8)}, ${(runDiagnostics.gpsAddHiHtScaleMax ?? 1).toFixed(8)}]`,
    );
  }
};
