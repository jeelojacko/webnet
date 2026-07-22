import { RAD_TO_DEG } from './angles';
import { getLevelLoopTolerancePresetLabel } from './levelLoopTolerance';
import {
} from './industryListingFormatters';
import { appendClassicTopProjectOptionSettings } from './industryListingTopClassicOptions';
import { appendIndustryListingTopFileSummary } from './industryListingTopFileSummary';
import { resolveTopDisplayValues } from './industryListingTopDisplayValues';
import { appendIndustryListingTopTailSections } from './industryListingTopTailSections';
import type { ReductionUsageSummary } from '../types';
import type { AdjustmentResult, Observation } from '../types';
import type {
  IndustryListingParseSettings,
  IndustryListingRunDiagnostics,
  IndustryListingSettings,
} from './industryListingTypes';
import type {
  DatumSufficiencyLike,
  ProjectInstrumentLike,
  SettingRow,
  TraceabilityModelLike,
  AppendIndustryListingTopSectionsArgs,
} from './industryListingSectionTypes';

export const appendIndustryListingTopSections = ({
  lines,
  now,
  runDiagnostics,
  runDiag,
  settings,
  parseSettings,
  parseState,
  projectName,
  projectFolder,
  projectSourceFiles,
  linearUnit,
  unitScale,
  runMode,
  runPurpose,
  coordMode,
  crsId,
  crsLabel,
  averageGeoidHeight,
  gpsObservationRows,
  gpsVectorFactorSummary,
  mapMode,
  mapScaleFactor,
  normalize,
  faceNormalizationMode,
  prismEnabled,
  prismOffset,
  prismScope,
  rotationAngleRad,
  coordSystemMode,
  localDatumScheme,
  averageScaleFactor,
  commonElevation,
  gridBearingMode,
  gridDistanceMode,
  gridAngleMode,
  gridDirectionMode,
  scaleOverrideActive,
  gnssVectorFrameDefault,
  gnssFrameConfirmed,
  parsedUsageSummary,
  usedInSolveUsageSummary,
  directiveTransitions,
  directiveNoEffectWarnings,
  datumSufficiency,
  crsStatus,
  crsOffReason,
  crsProjectionModel,
  crsGridScaleEnabled,
  crsGridScaleFactor,
  crsConvergenceEnabled,
  crsConvergenceAngleRad,
  crsDatumOpId,
  crsDatumFallbackUsed,
  crsAreaOfUseStatus,
  crsOutOfAreaStationCount,
  coordSystemDiagnostics,
  coordSystemWarningMessages,
  geoidModelEnabled,
  geoidModelId,
  geoidInterpolation,
  geoidModelLoaded,
  geoidModelMetadata,
  geoidSampleUndulationM,
  geoidHeightConversionEnabled,
  geoidOutputHeightDatum,
  geoidConvertedStationCount,
  geoidSkippedStationCount,
  gpsAddHiHtEnabled,
  gpsAddHiHtHiM,
  gpsAddHiHtHtM,
  gpsAddHiHtVectorCount,
  gpsAddHiHtAppliedCount,
  gpsAddHiHtPositiveCount,
  gpsAddHiHtNegativeCount,
  gpsAddHiHtNeutralCount,
  gpsAddHiHtDefaultZeroCount,
  gpsAddHiHtMissingHeightCount,
  gpsAddHiHtScaleMin,
  gpsAddHiHtScaleMax,
  gpsLoopCheckEnabled,
  gpsLoopDiagnostics,
  levelLoopToleranceBaseMm,
  levelLoopTolerancePerSqrtKmMm,
  gpsOffsetObservations,
  lostStationIds,
  qFixLinearSigmaM,
  qFixAngularSigmaSec,
  descriptionReconcileMode,
  descriptionAppendDelimiter,
  descriptionScanSummary,
  traceabilityModel,
  showLostStations,
  autoSideshotEnabled,
  aliasTrace,
  clusterDiagnostics,
  autoAdjustDiagnostics,
  autoSideshotDiagnostics,
  projectInstrumentLibrary,
  usedInstrumentCodes,
  hasInlineGpsFactorOverride,
  useClassicPreanalysisListing,
  usesClassicParityLayout,
  usesCompactGnssParityLayout,
  pathTokenLeaf,
  pushSettingRow,
  parseStochasticDefaultsRows,
  formatReductionUsage,
}: AppendIndustryListingTopSectionsArgs) => {
  const {
    convergenceLimit,
    displayVerticalDeflectionNorthSec,
    displayVerticalDeflectionEastSec,
  } = resolveTopDisplayValues(settings, parseState, runDiag);

  appendIndustryListingTopFileSummary({
    lines,
    now,
    runDiagnostics,
    projectName,
    projectFolder,
    projectSourceFiles,
    pathTokenLeaf,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
  });

  if (usesClassicParityLayout || usesCompactGnssParityLayout) {
    appendClassicTopProjectOptionSettings({
      lines, crsId, crsLabel, runMode, coordMode, linearUnit, parseState, parseSettings,
      averageGeoidHeight, unitScale, displayVerticalDeflectionNorthSec,
      displayVerticalDeflectionEastSec, convergenceLimit, settings, gpsObservationRows,
      gpsVectorFactorSummary,
    });
  } else {
    pushSettingRow(
      'Industry Standard Run Mode',
      runDiag.solveProfile === 'webnet' ? 'WebNet Default Profile' : 'Parity Profile (Classical)',
    );
    pushSettingRow('Run Mode', runMode.toUpperCase());
    pushSettingRow('Run Purpose', runPurpose);
    pushSettingRow('Type of Adjustment', coordMode);
    pushSettingRow(
      'Project Units',
      `${linearUnit}; ${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}`,
    );
    pushSettingRow(
      'Vertical Deflection',
      `N=${displayVerticalDeflectionNorthSec.toFixed(3)} E=${displayVerticalDeflectionEastSec.toFixed(3)} (Seconds)`,
    );
    pushSettingRow(
      'Input/Output Coordinate Order',
      (parseState?.order ?? parseSettings.order) === 'NE' ? 'North-East' : 'East-North',
    );
    pushSettingRow(
      'Angle Data Station Order',
      (parseState?.angleStationOrder ?? parseSettings.angleStationOrder) === 'atfromto'
        ? 'At-From-To'
        : 'From-At-To',
    );
    pushSettingRow(
      'Distance/Vertical Data Type',
      (parseState?.deltaMode ?? parseSettings.deltaMode) === 'horiz'
        ? 'Hor Dist/DE'
        : 'Slope Dist/Zenith',
    );
    pushSettingRow('Map Mode / Scale', `${mapMode.toUpperCase()} / ${mapScaleFactor.toFixed(8)}`);
    pushSettingRow(
      'Normalize',
      `${faceNormalizationMode.toUpperCase()} (${normalize ? 'ON' : 'OFF'})`,
    );
    pushSettingRow(
      'Convergence Limit; Max Iterations',
      `${convergenceLimit.toFixed(6)}; ${settings.maxIterations}`,
    );
    pushSettingRow(
      'Default Coefficient of Refraction',
      (parseState?.refractionCoefficient ?? parseSettings.refractionCoefficient).toFixed(6),
    );
    pushSettingRow(
      'Prism Correction',
      prismEnabled ? `ON (${prismOffset.toFixed(4)} m, scope=${prismScope})` : 'OFF',
    );
    pushSettingRow(
      'Plan Rotation',
      Math.abs(rotationAngleRad) > 1e-12
        ? `ON (${(rotationAngleRad * RAD_TO_DEG).toFixed(6)} deg)`
        : 'OFF',
    );
    pushSettingRow('Coordinate System Mode', `${coordSystemMode.toUpperCase()} (CRS=${crsId})`);
    if (coordSystemMode === 'local') {
      pushSettingRow(
        'Local Datum Scheme',
        `${localDatumScheme.toUpperCase()} (scale=${averageScaleFactor.toFixed(8)}, commonElev=${(commonElevation * unitScale).toFixed(4)} ${linearUnit})`,
      );
    } else {
      pushSettingRow(
        'Directive Context (End of File)',
        `bearing=${gridBearingMode.toUpperCase()}, distance=${gridDistanceMode.toUpperCase()}, angle=${gridAngleMode.toUpperCase()}, direction=${gridDirectionMode.toUpperCase()}`,
      );
      pushSettingRow(
        '.SCALE Override Active',
        scaleOverrideActive ? `YES (k=${averageScaleFactor.toFixed(8)})` : 'NO',
      );
      pushSettingRow(
        'GNSS Frame Default',
        `${gnssVectorFrameDefault} (confirmed=${gnssFrameConfirmed ? 'YES' : 'NO'})`,
      );
      pushSettingRow('Applied Reduction Modes (Parsed)', formatReductionUsage(parsedUsageSummary));
      pushSettingRow('Applied Reduction Modes (Used)', formatReductionUsage(usedInSolveUsageSummary));
      if (directiveTransitions.length > 0) {
        pushSettingRow('Directive Transition Count', String(directiveTransitions.length));
        directiveTransitions.slice(0, 20).forEach((transition) => {
          pushSettingRow(
            'Directive Range',
            `${transition.directive} line ${transition.effectiveFromLine}${transition.effectiveToLine != null ? `-${transition.effectiveToLine}` : '-EOF'} (obs=${transition.obsCountInRange})`,
          );
        });
        if (directiveTransitions.length > 20) {
          pushSettingRow('Directive Range Overflow', `+${directiveTransitions.length - 20} more`);
        }
      }
      directiveNoEffectWarnings.forEach((warning) => {
        pushSettingRow(
          'Directive No-Effect',
          `${warning.directive} line ${warning.line} (${warning.reason})`,
        );
      });
    }
    if (datumSufficiency) {
      pushSettingRow(
        'Datum Sufficiency',
        `${datumSufficiency.status.toUpperCase()}${datumSufficiency.reasons.length > 0 ? ` (${datumSufficiency.reasons.length} reason${datumSufficiency.reasons.length === 1 ? '' : 's'})` : ''}`,
      );
      datumSufficiency.reasons.forEach((reason) => pushSettingRow('Datum Reason', reason));
      datumSufficiency.suggestions.forEach((suggestion) =>
        pushSettingRow('Datum Suggestion', suggestion),
      );
    }
    pushSettingRow('Average Geoid Height', `${(averageGeoidHeight * unitScale).toFixed(4)} ${linearUnit}`);
    pushSettingRow(
      'CRS / Projection',
      crsStatus === 'on'
        ? `ON (${crsProjectionModel}, label="${crsLabel || 'unnamed'}")`
        : `OFF${crsOffReason ? ` (${crsOffReason})` : ''}`,
    );
    pushSettingRow(
      'CRS Grid-Ground Scale',
      crsGridScaleEnabled ? `ON (${crsGridScaleFactor.toFixed(8)})` : 'OFF',
    );
    pushSettingRow(
      'CRS Convergence',
      crsConvergenceEnabled ? `ON (${(crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)} deg)` : 'OFF',
    );
    if (coordSystemMode === 'grid') {
      pushSettingRow(
        'CRS Datum Operation',
        `${crsDatumOpId ?? '-'}${crsDatumFallbackUsed ? ' (fallback)' : ''}`,
      );
      pushSettingRow(
        'CRS Area-of-Use Status',
        `${crsAreaOfUseStatus.toUpperCase()}${crsAreaOfUseStatus === 'outside' ? ` (outside=${crsOutOfAreaStationCount})` : ''}`,
      );
    }
    if (coordSystemDiagnostics.length > 0) {
      pushSettingRow('CRS Diagnostics', coordSystemDiagnostics.join(', '));
    }
    if (coordSystemWarningMessages.length > 0) {
      pushSettingRow('CRS Warning Count', String(coordSystemWarningMessages.length));
    }
    pushSettingRow(
      'Geoid/Grid Model',
      geoidModelEnabled
        ? `ON (${geoidModelId}, ${geoidInterpolation.toUpperCase()}, loaded=${geoidModelLoaded ? 'YES' : 'NO'})`
        : 'OFF',
    );
    if (geoidModelEnabled) {
      pushSettingRow(
        'Geoid Metadata',
        `${geoidModelMetadata || 'unavailable'}${geoidSampleUndulationM != null ? `; sampleN=${geoidSampleUndulationM.toFixed(4)} m` : ''}`,
      );
    }
    pushSettingRow(
      'Geoid Height Conversion',
      geoidHeightConversionEnabled
        ? `ON (${geoidOutputHeightDatum.toUpperCase()}, converted=${geoidConvertedStationCount}, skipped=${geoidSkippedStationCount})`
        : 'OFF',
    );
    pushSettingRow(
      'GPS AddHiHt Defaults',
      gpsAddHiHtEnabled
        ? `ON (HI=${(gpsAddHiHtHiM * unitScale).toFixed(4)} ${linearUnit}, HT=${(gpsAddHiHtHtM * unitScale).toFixed(4)} ${linearUnit})`
        : 'OFF',
    );
    if (gpsAddHiHtEnabled) {
      pushSettingRow(
        'GPS AddHiHt Preprocess',
        `vectors=${gpsAddHiHtVectorCount}, adjusted=${gpsAddHiHtAppliedCount} (+${gpsAddHiHtPositiveCount}/-${gpsAddHiHtNegativeCount}/neutral=${gpsAddHiHtNeutralCount}), defaultZero=${gpsAddHiHtDefaultZeroCount}, missingHeight=${gpsAddHiHtMissingHeightCount}, scale=[${gpsAddHiHtScaleMin.toFixed(8)}, ${gpsAddHiHtScaleMax.toFixed(8)}]`,
      );
    }
    pushSettingRow(
      'GPS Loop Check',
      `${gpsLoopCheckEnabled ? 'ON' : 'OFF'}${gpsLoopDiagnostics?.enabled ? ` (vectors=${gpsLoopDiagnostics.vectorCount}, loops=${gpsLoopDiagnostics.loopCount}, pass=${gpsLoopDiagnostics.passCount}, warn=${gpsLoopDiagnostics.warnCount})` : ''}`,
    );
    pushSettingRow(
      'Level Loop Tolerance',
      `${getLevelLoopTolerancePresetLabel(levelLoopToleranceBaseMm, levelLoopTolerancePerSqrtKmMm)} (base=${levelLoopToleranceBaseMm.toFixed(2)} mm, k=${levelLoopTolerancePerSqrtKmMm.toFixed(2)} mm/sqrt(km))`,
    );
    pushSettingRow(
      'GPS Rover Offsets',
      gpsOffsetObservations.length > 0 ? `${gpsOffsetObservations.length} applied` : 'none',
    );
    pushSettingRow(
      'Lost Stations',
      lostStationIds.length > 0 ? `${lostStationIds.length} (${lostStationIds.join(', ')})` : 'none',
    );
    pushSettingRow(
      'QFIX (Linear/Angular)',
      `${(qFixLinearSigmaM * unitScale).toExponential(6)} ${linearUnit}; ${qFixAngularSigmaSec.toExponential(6)}"`,
    );
    pushSettingRow(
      'Description Reconciliation',
      `${descriptionReconcileMode.toUpperCase()}${descriptionReconcileMode === 'append' ? ` (delimiter="${descriptionAppendDelimiter}")` : ''}`,
    );
    if (descriptionScanSummary.length > 0) {
      pushSettingRow(
        'Description Scan',
        `repeated=${traceabilityModel.descriptionRepeatedStationCount}, conflicts=${traceabilityModel.descriptionConflictCount}, stations=${descriptionScanSummary.length}`,
      );
    }
    pushSettingRow('Show Lost Stations in Output', showLostStations ? 'ON' : 'OFF');
    if (clusterDiagnostics?.enabled) {
      pushSettingRow(
        'Cluster Detection Mode',
        `${clusterDiagnostics.passMode.toUpperCase()} / ${clusterDiagnostics.linkageMode.toUpperCase()} (${clusterDiagnostics.dimension}, tol=${(clusterDiagnostics.tolerance * unitScale).toFixed(4)} ${linearUnit}, merges=${clusterDiagnostics.approvedMergeCount ?? 0}, outcomes=${clusterDiagnostics.mergeOutcomes?.length ?? 0}, rejected=${clusterDiagnostics.rejectedProposals?.length ?? 0})`,
      );
    }
    if (autoAdjustDiagnostics?.enabled) {
      pushSettingRow(
        'Auto-Adjust',
        `ON (|t|>=${autoAdjustDiagnostics.threshold.toFixed(2)}, cycles=${autoAdjustDiagnostics.maxCycles}, maxRm/cycle=${autoAdjustDiagnostics.maxRemovalsPerCycle}, minRedund=${autoAdjustDiagnostics.minRedundancy.toFixed(2)}, stop=${autoAdjustDiagnostics.stopReason}, removed=${autoAdjustDiagnostics.removed.length})`,
      );
    }
    if (autoSideshotEnabled && autoSideshotDiagnostics?.enabled) {
      pushSettingRow(
        'Auto Sideshot (M-lines)',
        `ON (evaluated=${autoSideshotDiagnostics.evaluatedCount}, candidates=${autoSideshotDiagnostics.candidateCount}, excluded-control=${autoSideshotDiagnostics.excludedControlCount}, minRedund<${autoSideshotDiagnostics.threshold.toFixed(2)})`,
      );
    } else {
      pushSettingRow('Auto Sideshot (M-lines)', 'OFF');
    }
    if ((parseState?.aliasExplicitCount ?? 0) > 0 || (parseState?.aliasRuleCount ?? 0) > 0) {
      pushSettingRow(
        'Alias Canonicalization',
        `explicit=${parseState?.aliasExplicitCount ?? 0}, rules=${parseState?.aliasRuleCount ?? 0}, references=${aliasTrace.length}`,
      );
    }
  }
  appendIndustryListingTopTailSections({
    lines, usesClassicParityLayout, usesCompactGnssParityLayout, projectInstrumentLibrary,
    runDiag, usedInstrumentCodes, parseStochasticDefaultsRows, pushSettingRow, parseState,
    useClassicPreanalysisListing, hasInlineGpsFactorOverride, directiveTransitions,
    directiveNoEffectWarnings, traceabilityModel,
  });
};
