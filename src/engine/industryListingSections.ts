import { RAD_TO_DEG, radToDmsStr } from './angles';
import { getLevelLoopTolerancePresetLabel } from './levelLoopTolerance';
import { getStationPrecision } from './resultPrecision';
import {
  centerIndustryLine,
  formatClassicCoordinateSystemLabel,
  formatClassicInstrumentRows,
  formatClassicRunModeLabel,
  formatClassicSettingRow,
  formatClassicTraverseDirectionSigmaArcSec,
  formatClassicTraverseFileLine,
  formatClassicTraverseSetLabel,
  formatClassicTraverseSignedDms,
  formatClassicTraverseStdRes,
  formatClassicTraverseZenithSigmaArcSec,
  formatDmsHundredths,
  formatQuadrantBearing,
} from './industryListingFormatters';
import type {
  IndustryListingParseSettings,
  IndustryListingRunDiagnostics,
  IndustryListingSettings,
} from './industryListingTypes';
import type { AdjustmentResult, Observation, ReductionUsageSummary, Station } from '../types';

const ONE_DIMENSIONAL_CONFIDENCE_95_SCALE = 1.959963984540054;

type TraceabilityModelLike = {
  descriptionConflictCount: number;
  descriptionRepeatedStationCount: number;
};

type DatumSufficiencyLike = {
  status: string;
  reasons: string[];
  suggestions: string[];
};

type RelationshipRow = {
  from: string;
  to: string;
  azimuth: string;
  distance: string;
  sigmaAz95: string;
  sigmaDist95: string;
  ppm95: string;
  sigmaDist?: number;
  sigmaH?: number;
  ellipse?: {
    semiMajor: number;
    semiMinor: number;
    theta: number;
  };
};

type PositionalToleranceRow = {
  from: string;
  to: string;
  distanceMeters: number;
  toleranceMeters: number;
  checkMeters: number;
  passes: boolean;
};

type DisplayFactors = {
  convergenceAngleRad: number;
};

type ProjectInstrumentLike = {
  code: string;
};

type RenderTextTable = (
  _headers: string[],
  _rows: string[][],
  _numericColumnIndexes?: number[],
) => void;

type RenderAdjustedSection = (
  _title: string,
  _rows: string[][],
  _headers: string[],
  _numericColumnIndexes: number[],
  _preface?: string[],
) => void;

type SettingRow = { label: string; value: string };

export interface AppendIndustryListingTopSectionsArgs {
  lines: string[];
  now: Date;
  runDiagnostics: IndustryListingRunDiagnostics;
  runDiag: IndustryListingRunDiagnostics;
  settings: IndustryListingSettings;
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  projectName?: string;
  projectFolder?: string;
  projectSourceFiles: string[];
  linearUnit: string;
  unitScale: number;
  runMode: string;
  runPurpose: string;
  coordMode: string;
  crsId: string;
  crsLabel: string;
  averageGeoidHeight: number;
  gpsObservationRows: Observation[];
  gpsVectorFactorSummary: string;
  mapMode: string;
  mapScaleFactor: number;
  normalize: boolean;
  faceNormalizationMode: string;
  prismEnabled: boolean;
  prismOffset: number;
  prismScope: string;
  rotationAngleRad: number;
  coordSystemMode: string;
  localDatumScheme: string;
  averageScaleFactor: number;
  commonElevation: number;
  gridBearingMode: string;
  gridDistanceMode: string;
  gridAngleMode: string;
  gridDirectionMode: string;
  scaleOverrideActive: boolean;
  gnssVectorFrameDefault: string;
  gnssFrameConfirmed: boolean;
  parsedUsageSummary?: ReductionUsageSummary;
  usedInSolveUsageSummary?: ReductionUsageSummary;
  directiveTransitions: Array<{
    directive: string;
    effectiveFromLine: number;
    effectiveToLine?: number;
    obsCountInRange: number;
  }>;
  directiveNoEffectWarnings: Array<{
    directive: string;
    line: number;
    reason: string;
  }>;
  datumSufficiency?: DatumSufficiencyLike;
  crsStatus: string;
  crsOffReason?: string;
  crsProjectionModel: string;
  crsGridScaleEnabled: boolean;
  crsGridScaleFactor: number;
  crsConvergenceEnabled: boolean;
  crsConvergenceAngleRad: number;
  crsDatumOpId?: string;
  crsDatumFallbackUsed: boolean;
  crsAreaOfUseStatus: string;
  crsOutOfAreaStationCount: number;
  coordSystemDiagnostics: string[];
  coordSystemWarningMessages: string[];
  geoidModelEnabled: boolean;
  geoidModelId: string;
  geoidInterpolation: string;
  geoidModelLoaded: boolean;
  geoidModelMetadata?: string;
  geoidSampleUndulationM?: number | null;
  geoidHeightConversionEnabled: boolean;
  geoidOutputHeightDatum: string;
  geoidConvertedStationCount: number;
  geoidSkippedStationCount: number;
  gpsAddHiHtEnabled: boolean;
  gpsAddHiHtHiM: number;
  gpsAddHiHtHtM: number;
  gpsAddHiHtVectorCount: number;
  gpsAddHiHtAppliedCount: number;
  gpsAddHiHtPositiveCount: number;
  gpsAddHiHtNegativeCount: number;
  gpsAddHiHtNeutralCount: number;
  gpsAddHiHtDefaultZeroCount: number;
  gpsAddHiHtMissingHeightCount: number;
  gpsAddHiHtScaleMin: number;
  gpsAddHiHtScaleMax: number;
  gpsLoopCheckEnabled: boolean;
  gpsLoopDiagnostics?: {
    enabled: boolean;
    vectorCount: number;
    loopCount: number;
    passCount: number;
    warnCount: number;
  };
  levelLoopToleranceBaseMm: number;
  levelLoopTolerancePerSqrtKmMm: number;
  gpsOffsetObservations: Observation[];
  lostStationIds: string[];
  qFixLinearSigmaM: number;
  qFixAngularSigmaSec: number;
  descriptionReconcileMode: string;
  descriptionAppendDelimiter: string;
  descriptionScanSummary: unknown[];
  traceabilityModel: TraceabilityModelLike;
  showLostStations: boolean;
  autoSideshotEnabled: boolean;
  aliasTrace: Array<unknown>;
  clusterDiagnostics?: {
    enabled: boolean;
    passMode: string;
    linkageMode: string;
    dimension: string;
    tolerance: number;
    approvedMergeCount?: number;
    mergeOutcomes?: unknown[];
    rejectedProposals?: unknown[];
  };
  autoAdjustDiagnostics?: {
    enabled: boolean;
    threshold: number;
    maxCycles: number;
    maxRemovalsPerCycle: number;
    minRedundancy: number;
    stopReason: string;
    removed: unknown[];
  };
  autoSideshotDiagnostics?: {
    enabled: boolean;
    evaluatedCount: number;
    candidateCount: number;
    excludedControlCount: number;
    threshold: number;
  };
  projectInstrumentLibrary?: Record<string, ProjectInstrumentLike>;
  usedInstrumentCodes: Set<string>;
  hasInlineGpsFactorOverride: boolean;
  useClassicPreanalysisListing: boolean;
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
  centerIndustryLine: typeof centerIndustryLine;
  pathTokenLeaf: (_pathToken: string) => string;
  pushSettingRow: (_label: string, _value: string) => void;
  parseStochasticDefaultsRows: (_summary: string) => SettingRow[];
  formatReductionUsage: (_summary?: ReductionUsageSummary) => string;
}

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
  const convergenceLimit =
    typeof settings.convergenceLimit === 'number' &&
    Number.isFinite(settings.convergenceLimit) &&
    settings.convergenceLimit > 0
      ? settings.convergenceLimit
      : 0.01;
  const displayVerticalDeflectionNorthSec =
    parseState?.verticalDeflectionNorthSec ?? runDiag.verticalDeflectionNorthSec ?? 0;
  const displayVerticalDeflectionEastSec =
    parseState?.verticalDeflectionEastSec ?? runDiag.verticalDeflectionEastSec ?? 0;

  if (usesClassicParityLayout || usesCompactGnssParityLayout) {
    lines.push(centerIndustryLine(`Run Date: ${now.toLocaleString()}`));
  } else {
    lines.push('INDUSTRY-STANDARD-STYLE Listing (WebNet Emulation)');
    lines.push(`Run Date: ${now.toLocaleString()}`);
  }
  lines.push('');
  lines.push(
    runDiagnostics.solveProfile !== 'webnet'
      ? centerIndustryLine('Summary of Files Used and Option Settings')
      : 'Summary of Files Used and Option Settings',
  );
  lines.push(
    runDiagnostics.solveProfile !== 'webnet'
      ? centerIndustryLine('=========================================')
      : '=========================================',
  );
  lines.push('');
  if (runDiagnostics.solveProfile !== 'webnet') {
    lines.push(centerIndustryLine('Project Folder and Data Files'));
    lines.push('');
    if (projectName) lines.push(`      ${'Project Name'.padEnd(18)} ${projectName}`);
    if (projectFolder) lines.push(`      ${'Project Folder'.padEnd(18)} ${projectFolder}`);
    projectSourceFiles.forEach((sourceFile, index) => {
      lines.push(
        `      ${(index === 0 ? 'Data File List' : '').padEnd(18)} ${index + 1}. ${pathTokenLeaf(sourceFile)}`,
      );
    });
    if (projectName || projectFolder || projectSourceFiles.length > 0) lines.push('');
  }
  lines.push(
    runDiagnostics.solveProfile !== 'webnet'
      ? centerIndustryLine('Project Option Settings')
      : 'Project Option Settings',
  );
  lines.push('');

  if (usesClassicParityLayout || usesCompactGnssParityLayout) {
    const coordSystemLabel = formatClassicCoordinateSystemLabel(crsId, crsLabel);
    lines.push(formatClassicSettingRow('STAR*NET Run Mode', formatClassicRunModeLabel(runMode as never)));
    lines.push(formatClassicSettingRow('Type of Adjustment', coordMode));
    lines.push(
      formatClassicSettingRow(
        'Project Units',
        `${linearUnit}; ${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}`,
      ),
    );
    lines.push(formatClassicSettingRow('Coordinate System', coordSystemLabel));
    lines.push(
      formatClassicSettingRow(
        'Geoid Height',
        `${(averageGeoidHeight * unitScale).toFixed(4)} (Default, ${linearUnit})`,
      ),
    );
    if (
      Math.abs(displayVerticalDeflectionNorthSec) > 1e-12 ||
      Math.abs(displayVerticalDeflectionEastSec) > 1e-12
    ) {
      lines.push(
        formatClassicSettingRow(
          'Vertical Deflection',
          `N=${displayVerticalDeflectionNorthSec.toFixed(3)} E=${displayVerticalDeflectionEastSec.toFixed(3)} (Seconds)`,
        ),
      );
    }
    lines.push(
      formatClassicSettingRow(
        'Longitude Sign Convention',
        (parseState?.lonSign ?? 'west-negative') === 'west-positive'
          ? 'Positive West'
          : 'Negative West',
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Input/Output Coordinate Order',
        (parseState?.order ?? parseSettings.order) === 'NE' ? 'North-East' : 'East-North',
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Angle Data Station Order',
        (parseState?.angleStationOrder ?? parseSettings.angleStationOrder) === 'atfromto'
          ? 'At-From-To'
          : 'From-At-To',
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Distance/Vertical Data Type',
        (parseState?.deltaMode ?? parseSettings.deltaMode) === 'horiz'
          ? 'Horizontal/DE'
          : 'Slope/Zenith',
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Convergence Limit; Max Iterations',
        `${convergenceLimit.toFixed(6)}; ${settings.maxIterations}`,
      ),
    );
    lines.push(
      formatClassicSettingRow(
        'Default Coefficient of Refraction',
        (parseState?.refractionCoefficient ?? parseSettings.refractionCoefficient).toFixed(6),
      ),
    );
    lines.push(formatClassicSettingRow('Create Coordinate File', 'Yes'));
    lines.push(formatClassicSettingRow('Create Geodetic Position File', 'No'));
    lines.push(formatClassicSettingRow('Create Ground Scale Coordinate File', 'No'));
    lines.push(formatClassicSettingRow('Create Dump File', 'No'));
    if (gpsObservationRows.length > 0) {
      lines.push(
        formatClassicSettingRow('GPS Vector Standard Error Factors', gpsVectorFactorSummary),
      );
      lines.push(formatClassicSettingRow('GPS Vector Centering (Meters)', 'None'));
      lines.push(formatClassicSettingRow('GPS Vector Transformations', 'None'));
    }
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
  if (!usesCompactGnssParityLayout) {
    lines.push('');
    lines.push(
      usesClassicParityLayout
        ? centerIndustryLine('Instrument Standard Error Settings')
        : 'Instrument Standard Error Settings',
    );
    lines.push('');
    if (usesClassicParityLayout) {
      const instrumentEntries = Object.entries(projectInstrumentLibrary ?? {});
      const currentInstrumentCode =
        runDiag.currentInstrumentCode && projectInstrumentLibrary?.[runDiag.currentInstrumentCode]
          ? runDiag.currentInstrumentCode
          : instrumentEntries[0]?.[0];
      const defaultInstrument =
        currentInstrumentCode != null ? projectInstrumentLibrary?.[currentInstrumentCode] : undefined;
      if (defaultInstrument) {
        formatClassicInstrumentRows(lines, 'Project Default Instrument', defaultInstrument as never, true);
      }
      instrumentEntries
        .filter(([code]) => code !== currentInstrumentCode && usedInstrumentCodes.has(code))
        .forEach(([, instrument]) => {
          formatClassicInstrumentRows(
            lines,
            `Project Library Instrument ${instrument.code}`,
            instrument as never,
            false,
          );
        });
    } else {
      lines.push('Active Project Instrument Defaults');
      const stochasticRows = parseStochasticDefaultsRows(runDiag.stochasticDefaultsSummary);
      if (stochasticRows.length === 0) {
        pushSettingRow('Defaults Summary', '-');
      } else {
        stochasticRows.forEach((row) => pushSettingRow(row.label, row.value));
      }
      pushSettingRow('Centering Model', runDiag.angleCenteringModel);
      pushSettingRow(
        'Default Sigma Usage',
        `${runDiag.defaultSigmaCount} default-sigma obs${runDiag.defaultSigmaByType ? ` (${runDiag.defaultSigmaByType})` : ''}`,
      );
      if ((parseState?.aliasExplicitMappings?.length ?? 0) > 0) {
        lines.push('Explicit Alias Mappings');
        parseState?.aliasExplicitMappings?.forEach((m: { sourceId: string; canonicalId: string; sourceLine?: number }) => {
          lines.push(`${m.sourceId} -> ${m.canonicalId}${m.sourceLine != null ? ` (line ${m.sourceLine})` : ''}`);
        });
      }
      if ((parseState?.aliasRuleSummaries?.length ?? 0) > 0) {
        lines.push('Alias Rules');
        parseState?.aliasRuleSummaries?.forEach((r: { rule: string; sourceLine: number }) => {
          lines.push(`${r.rule} (line ${r.sourceLine})`);
        });
      }
    }
    if (useClassicPreanalysisListing) lines.push('\f');
  }
  if (!usesClassicParityLayout || useClassicPreanalysisListing) {
    if (hasInlineGpsFactorOverride || directiveTransitions.length > 0 || directiveNoEffectWarnings.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine('Inline Option Usage Notes'));
      lines.push('');
      if (hasInlineGpsFactorOverride) {
        lines.push('      GPS Vector Factor Default Modified by Inline Option');
      }
      directiveNoEffectWarnings.forEach((warning) => {
        lines.push(`      ${warning.directive} line ${warning.line} had no effect (${warning.reason})`);
      });
      directiveTransitions.forEach((transition) => {
        lines.push(
          `      ${transition.directive} line ${transition.effectiveFromLine}${transition.effectiveToLine != null ? `-${transition.effectiveToLine}` : '-EOF'} (obs=${transition.obsCountInRange})`,
        );
      });
    }
    lines.push('');
    lines.push(centerIndustryLine('Summary of Inconsistent Descriptions'));
    lines.push(centerIndustryLine('===================================='));
    lines.push('');
    lines.push('');
    lines.push(centerIndustryLine(`Number of Occurrences = ${traceabilityModel.descriptionConflictCount}`));
    lines.push('');
    lines.push('Network Stations');
    lines.push('Point ID         Description                     File:Line                     ');
    lines.push('');
    lines.push('Sideshots');
    lines.push('Point ID         Description                     File:Line                     ');
    lines.push(useClassicPreanalysisListing ? '\f' : '');
  }
};

export interface AppendAdjustedObservationSectionsArgs {
  lines: string[];
  res: { stations: Record<string, Station> };
  settings: IndustryListingSettings;
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  sortedListingObservations: Observation[];
  gpsObservationRows: Observation[];
  relationshipRows: RelationshipRow[];
  isPreanalysis: boolean;
  linearUnit: string;
  unitScale: number;
  coordSystemMode: string;
  confidence95Scale: number;
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
  hasTraverseStyleAngularFamilies: boolean;
  renderAdjustedGnssVectorSection: () => void;
  addCenteredHeading: (_title: string) => void;
  renderAdjustedSection: RenderAdjustedSection;
  formatLinear: (_value: number | undefined) => string;
  formatResidualLinear: (_value: number | undefined) => string;
  formatAngularLinearResidual: (_residualRad: number | undefined, _effectiveDistanceM: number | undefined) => string;
  formatAngularStdErrArcSec: (_value: number | undefined) => string;
  formatIndustryStdRes: (_obs: Observation) => string;
  sortSelectedMode: <T extends Observation>(_rows: T[]) => T[];
  pairDisplayCombinedFactor: (_from: string, _to: string) => number;
  aliasRefsForLine: (_sourceLine?: number) => string;
  autoSideshotSuffix: (_obs: Observation) => string;
  prismSuffix: (_obs: Observation) => string;
}

export const appendAdjustedObservationSections = ({
  lines,
  res,
  settings,
  parseSettings,
  parseState,
  sortedListingObservations,
  gpsObservationRows,
  relationshipRows,
  isPreanalysis,
  linearUnit,
  unitScale,
  coordSystemMode,
  confidence95Scale,
  usesClassicParityLayout,
  usesCompactGnssParityLayout,
  hasTraverseStyleAngularFamilies,
  renderAdjustedGnssVectorSection,
  addCenteredHeading,
  renderAdjustedSection,
  formatLinear,
  formatResidualLinear,
  formatAngularLinearResidual,
  formatAngularStdErrArcSec,
  formatIndustryStdRes,
  sortSelectedMode,
  pairDisplayCombinedFactor,
  aliasRefsForLine,
  autoSideshotSuffix,
  prismSuffix,
}: AppendAdjustedObservationSectionsArgs) => {
  const shouldRenderAdjustedObservationSections =
    !isPreanalysis &&
    settings.listingShowObservationsResiduals &&
    sortedListingObservations.length > 0;
  const shouldRenderAdjustedGnssVectorSection =
    !isPreanalysis &&
    gpsObservationRows.length > 0 &&
    (settings.listingShowObservationsResiduals || usesCompactGnssParityLayout);

  if (!shouldRenderAdjustedObservationSections && !shouldRenderAdjustedGnssVectorSection) return;
  if (!usesClassicParityLayout) {
    lines.push('');
    addCenteredHeading('Adjusted Observations and Residuals');
  }

  if (usesClassicParityLayout && shouldRenderAdjustedObservationSections) {
    const angleUnitLabel = (parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase();
    const distanceRows = sortSelectedMode(
      sortedListingObservations.filter(
        (obs): obs is Observation & { type: 'dist' } => obs.type === 'dist',
      ),
    );
    if (distanceRows.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Measured Distance Observations (${linearUnit})`));
      lines.push('');
      lines.push('           From       To              Distance      Residual   StdErr StdRes File:Line');
      distanceRows.forEach((obs) => {
        const adjustedDistance = formatLinear((obs.calc as number | undefined) ?? obs.obs);
        const residual = formatResidualLinear(obs.residual as number | undefined);
        const sigma = formatLinear(obs.weightingStdDev ?? obs.stdDev);
        const stdRes = formatClassicTraverseStdRes(obs);
        const fileLine = formatClassicTraverseFileLine(parseState, obs.sourceLine);
        lines.push(
          `           ${obs.from.padEnd(11)}${obs.to.padEnd(15)}${adjustedDistance.padStart(10)}${residual.padStart(14)}${sigma.padStart(9)}${stdRes.padStart(6)}${fileLine.padStart(10)}`,
        );
      });
    }
    const zenithRows = sortSelectedMode(
      sortedListingObservations.filter(
        (obs): obs is Observation & { type: 'zenith' } => obs.type === 'zenith',
      ),
    );
    if (zenithRows.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Zenith Observations (${angleUnitLabel})`));
      lines.push('');
      lines.push('           From       To              Zenith        Residual     Distance   StdErr StdRes File:Line');
      zenithRows.forEach((obs) => {
        const adjustedZenith = formatDmsHundredths((obs.calc as number | undefined) ?? obs.obs);
        const residual = formatClassicTraverseSignedDms(
          typeof obs.residual === 'number' ? -obs.residual : undefined,
        );
        const distance = formatAngularLinearResidual(
          obs.residual as number | undefined,
          obs.effectiveDistance,
        );
        const sigma = formatClassicTraverseZenithSigmaArcSec(
          (obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600,
        );
        const stdRes = formatClassicTraverseStdRes(obs);
        const fileLine = formatClassicTraverseFileLine(parseState, obs.sourceLine);
        lines.push(
          `           ${obs.from.padEnd(11)}${obs.to.padEnd(11)}${adjustedZenith.padStart(13)}${residual.padStart(15)}${distance.padStart(13)}${sigma.padStart(9)}${stdRes.padStart(6)}${fileLine.padStart(10)}`,
        );
      });
    }
    const directionRows = sortSelectedMode(
      sortedListingObservations.filter(
        (obs): obs is Observation & { type: 'direction' } => obs.type === 'direction',
      ),
    );
    if (directionRows.length > 0) {
      const groupedDirections = new Map<string, Array<Observation & { type: 'direction' }>>();
      directionRows.forEach((obs) => {
        const key = String(obs.setId ?? 'UNKNOWN');
        const group = groupedDirections.get(key) ?? [];
        group.push(obs);
        groupedDirections.set(key, group);
      });
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Measured Direction Observations (${angleUnitLabel})`));
      lines.push('');
      lines.push('           From       To            Direction        Residual     Distance   StdErr StdRes File:Line');
      [...groupedDirections.entries()].forEach(([setId, group], groupIndex) => {
        lines.push('');
        lines.push(`           Set ${formatClassicTraverseSetLabel(setId, groupIndex + 1)}`);
        sortSelectedMode(group).forEach((obs) => {
          const adjustedDirection = formatDmsHundredths((obs.calc as number | undefined) ?? obs.obs);
          const residual = formatClassicTraverseSignedDms(
            typeof obs.residual === 'number' ? -obs.residual : undefined,
          );
          const distance = formatAngularLinearResidual(
            obs.residual as number | undefined,
            obs.effectiveDistance,
          );
          const sigma = formatClassicTraverseDirectionSigmaArcSec(
            (obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600,
          );
          const stdRes = formatClassicTraverseStdRes(obs);
          const fileLine = formatClassicTraverseFileLine(parseState, obs.sourceLine);
          lines.push(
            `           ${obs.at.padEnd(11)}${obs.to.padEnd(10)}${adjustedDirection.padStart(14)}${residual.padStart(15)}${distance.padStart(13)}${sigma.padStart(9)}${stdRes.padStart(6)}${fileLine.padStart(10)}`,
          );
        });
      });
    }
    const bearingRows = sortSelectedMode(
      sortedListingObservations.filter(
        (obs): obs is Observation & { type: 'bearing' } => obs.type === 'bearing',
      ),
    );
    if (bearingRows.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Grid Azimuth/Bearing Observations (${angleUnitLabel})`));
      lines.push('');
      lines.push('           From       To            Bearing         Residual     Distance   StdErr StdRes File:Line');
      bearingRows.forEach((obs) => {
        const adjustedBearing = formatQuadrantBearing((obs.calc as number | undefined) ?? obs.obs);
        const residualRad = typeof obs.residual === 'number' ? -obs.residual : undefined;
        const residual =
          obs.sigmaSource === 'fixed' && (residualRad == null || Math.abs(residualRad) < 1e-12)
            ? '-0-00-00.00'
            : formatClassicTraverseSignedDms(residualRad);
        const distance =
          obs.sigmaSource === 'fixed' && (obs.residual == null || Math.abs(obs.residual) < 1e-12)
            ? '-0.0000'
            : formatAngularLinearResidual(obs.residual as number | undefined, obs.effectiveDistance);
        const sigma =
          obs.sigmaSource === 'fixed'
            ? 'FIXED'
            : ((obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600).toFixed(2);
        const stdRes = formatClassicTraverseStdRes(obs);
        const fileLine = formatClassicTraverseFileLine(parseState, obs.sourceLine);
        lines.push(
          `           ${obs.from.padEnd(11)}${obs.to.padEnd(11)}${adjustedBearing.padStart(13)}${residual.padStart(15)}${distance.padStart(13)}${sigma.padStart(9)}${stdRes.padStart(6)}${fileLine.padStart(10)}`,
        );
      });
    }
    renderAdjustedGnssVectorSection();
    if (relationshipRows.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Bearings (${angleUnitLabel}) and Horizontal Distances (${linearUnit})`));
      lines.push(centerIndustryLine('========================================================='));
      lines.push(centerIndustryLine('(Relative Confidence of Bearing is in Seconds)'));
      lines.push('');
      lines.push('From       To          Grid Bearing   Grid Dist       95% RelConfidence');
      lines.push('                                      Grnd Dist     Brg    Dist       PPM');
      relationshipRows.forEach((row) => {
        const fromStation = res.stations[row.from];
        const toStation = res.stations[row.to];
        const gridDistMeters =
          fromStation && toStation ? Math.hypot(toStation.x - fromStation.x, toStation.y - fromStation.y) : Number.NaN;
        const avgCombined = pairDisplayCombinedFactor(row.from, row.to);
        const relationshipLinearDisplayScale =
          coordSystemMode === 'grid' && Number.isFinite(avgCombined) && avgCombined > 0 ? 1 / avgCombined : 1;
        const groundDistMeters =
          Number.isFinite(gridDistMeters) && avgCombined > 0 ? gridDistMeters / avgCombined : Number.NaN;
        const azRad =
          fromStation && toStation ? Math.atan2(toStation.x - fromStation.x, toStation.y - fromStation.y) : Number.NaN;
        const sigmaDistDisplay = row.sigmaDist != null ? row.sigmaDist * relationshipLinearDisplayScale : undefined;
        const sigmaDist95 =
          sigmaDistDisplay != null ? (sigmaDistDisplay * unitScale * confidence95Scale).toFixed(4) : '-';
        const ppm95 =
          sigmaDistDisplay != null && Number.isFinite(gridDistMeters)
            ? ((sigmaDistDisplay * confidence95Scale * 1_000_000) / Math.max(1e-12, Math.abs(gridDistMeters))).toFixed(4)
            : '-';
        lines.push(
          `${row.from.padEnd(11)}${row.to.padEnd(12)}${formatQuadrantBearing(azRad).padStart(13)}${(Number.isFinite(gridDistMeters) ? (gridDistMeters * unitScale).toFixed(4) : '-').padStart(12)}${row.sigmaAz95.padStart(8)}${sigmaDist95.padStart(8)}${ppm95.padStart(10)}`,
        );
        lines.push(`${''.padEnd(36)}${(Number.isFinite(groundDistMeters) ? (groundDistMeters * unitScale).toFixed(4) : '-').padStart(12)}`);
      });
    }
    return;
  }

  if (shouldRenderAdjustedObservationSections) {
    const angleRows = sortedListingObservations
      .filter((obs) => obs.type === 'angle')
      .map((obs) => [
        `${obs.at}-${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`,
        radToDmsStr((obs.calc as number | undefined) ?? obs.obs),
        formatAngularLinearResidual(obs.residual as number | undefined, undefined).replace(/^-/, ''),
        obs.effectiveDistance != null && Number.isFinite(obs.effectiveDistance) && obs.effectiveDistance > 0
          ? (obs.effectiveDistance * unitScale).toFixed(4)
          : '-',
        formatAngularStdErrArcSec(obs.weightingStdDev ?? obs.stdDev),
        formatIndustryStdRes(obs),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `Adjusted Angle Observations (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()})`,
      angleRows,
      ['Stations', 'Angle', 'Residual', 'Distance', 'StdErr', 'StdRes', 'File:Line'],
      [5],
    );

    const distanceRows = sortedListingObservations
      .filter((obs) => obs.type === 'dist')
      .map((obs) => [
        `${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}${prismSuffix(obs)}`,
        formatLinear((obs.calc as number | undefined) ?? obs.obs),
        formatResidualLinear(obs.residual as number | undefined),
        formatLinear(obs.weightingStdDev ?? obs.stdDev),
        formatIndustryStdRes(obs),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `${hasTraverseStyleAngularFamilies ? 'Adjusted Measured Distance Observations' : 'Adjusted Distance Observations'} (${linearUnit})`,
      distanceRows,
      ['Stations', 'Distance', 'Residual', 'StdErr', 'StdRes', 'File:Line'],
      [1, 2, 3, 4],
    );

    const directionRows = sortedListingObservations
      .filter((obs) => obs.type === 'direction')
      .map((obs) => [
        `${obs.at}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`,
        radToDmsStr((obs.calc as number | undefined) ?? obs.obs),
        ((obs.residual != null && Number.isFinite(obs.residual)) ? ((-obs.residual) * RAD_TO_DEG * 3600).toFixed(2) : '-'),
        formatAngularLinearResidual(obs.residual as number | undefined, obs.effectiveDistance),
        formatAngularStdErrArcSec(obs.weightingStdDev ?? obs.stdDev),
        formatIndustryStdRes(obs),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `${hasTraverseStyleAngularFamilies ? 'Adjusted Measured Direction Observations' : 'Adjusted Direction Observations'} (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()})`,
      directionRows,
      ['Stations', 'Direction', 'Residual', 'Distance', 'StdErr', 'StdRes', 'File:Line'],
      [5],
    );
  }

  renderAdjustedGnssVectorSection();
  if (shouldRenderAdjustedObservationSections && relationshipRows.length > 0) {
    lines.push('');
    const isGridBearingSection = coordSystemMode === 'grid';
    const useCompactGnssRelationshipLayout = usesCompactGnssParityLayout && isGridBearingSection;
    const azTitle = isGridBearingSection
      ? `Adjusted Bearings (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}) and Horizontal Distances (${linearUnit})`
      : `Adjusted Azimuths (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}) and Horizontal Distances (${linearUnit})`;
    if (useCompactGnssRelationshipLayout) {
      lines.push(centerIndustryLine(azTitle));
      lines.push(centerIndustryLine('========================================================='));
    } else {
      addCenteredHeading(azTitle);
    }
    lines.push(
      isGridBearingSection
        ? '                 (Relative Confidence of Bearing is in Seconds)'
        : '                 (Relative Confidence of Azimuth is in Seconds)',
    );
    lines.push('');
    if (isGridBearingSection) {
      lines.push('From       To          Grid Bearing   Grid Dist       95% RelConfidence');
      lines.push('                                      Grnd Dist     Brg    Dist       PPM');
      relationshipRows.forEach((row) => {
        const fromStation = res.stations[row.from];
        const toStation = res.stations[row.to];
        const gridDistMeters =
          fromStation && toStation ? Math.hypot(toStation.x - fromStation.x, toStation.y - fromStation.y) : Number.NaN;
        const avgCombined = pairDisplayCombinedFactor(row.from, row.to);
        const relationshipLinearDisplayScale =
          Number.isFinite(avgCombined) && avgCombined > 0 ? 1 / avgCombined : 1;
        const groundDistMeters =
          Number.isFinite(gridDistMeters) && avgCombined > 0 ? gridDistMeters / avgCombined : Number.NaN;
        const azRad =
          fromStation && toStation ? Math.atan2(toStation.x - fromStation.x, toStation.y - fromStation.y) : Number.NaN;
        const sigmaDistDisplay = row.sigmaDist != null ? row.sigmaDist * relationshipLinearDisplayScale : undefined;
        const sigmaDist95 =
          sigmaDistDisplay != null ? (sigmaDistDisplay * confidence95Scale * unitScale).toFixed(4) : '-';
        const ppm95 =
          sigmaDistDisplay != null && Number.isFinite(gridDistMeters)
            ? ((sigmaDistDisplay * confidence95Scale * 1_000_000) / Math.max(1e-12, Math.abs(gridDistMeters))).toFixed(4)
            : '-';
        lines.push(
          useCompactGnssRelationshipLayout
            ? `${row.from.padEnd(11)}${row.to.padEnd(11)}${formatQuadrantBearing(azRad).padStart(13)}${(Number.isFinite(gridDistMeters) ? (gridDistMeters * unitScale).toFixed(4) : '-').padStart(12)}${row.sigmaAz95.padStart(8)}${sigmaDist95.padStart(9)}${ppm95.padStart(10)}`
            : `${row.from.padEnd(11)}${row.to.padEnd(12)}${formatQuadrantBearing(azRad).padStart(13)}${(Number.isFinite(gridDistMeters) ? (gridDistMeters * unitScale).toFixed(4) : '-').padStart(12)}${row.sigmaAz95.padStart(8)}${sigmaDist95.padStart(8)}${ppm95.padStart(10)}`,
        );
        lines.push(`${''.padEnd(useCompactGnssRelationshipLayout ? 35 : 36)}${(Number.isFinite(groundDistMeters) ? (groundDistMeters * unitScale).toFixed(4) : '-').padStart(12)}`);
      });
    } else {
      lines.push('From       To               Azimuth    Distance       95% RelConfidence');
      lines.push('                                                    Azi    Dist       PPM');
      relationshipRows.forEach((row) => {
        lines.push(
          `${row.from.padEnd(10)} ${row.to.padEnd(10)} ${row.azimuth.padStart(14)} ${row.distance.padStart(10)} ${row.sigmaAz95.padStart(7)} ${row.sigmaDist95.padStart(8)} ${row.ppm95.padStart(10)}`,
        );
      });
    }
  }
};

export interface AppendErrorPropagationSectionsArgs {
  lines: string[];
  res: AdjustmentResult;
  settings: IndustryListingSettings;
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  stationEntriesForListing: Array<[string, Station]>;
  classicTraverseStationOrder: string[];
  relationshipRows: RelationshipRow[];
  selectedEllipseStationIds: Set<string>;
  gpsDirectFixedLinkedStations: Set<string>;
  positionalToleranceRows: PositionalToleranceRow[];
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
  isGnssOnlyListing: boolean;
  hasStationDescriptions: boolean;
  isPreanalysis: boolean;
  useClassicPreanalysisListing: boolean;
  coordMode: string;
  linearUnit: string;
  unitScale: number;
  coordSystemMode: string;
  precisionReportingMode: NonNullable<IndustryListingSettings['precisionReportingMode']>;
  confidence95Scale: number;
  positionalToleranceEnabled: boolean;
  positionalToleranceConfidencePercent: number;
  positionalToleranceConstantMm: number;
  positionalTolerancePpm: number;
  addCenteredHeading: (_title: string) => void;
  renderTextTable: RenderTextTable;
  stationDescription: (_stationId: string) => string;
  formatEllipseAzDm: (
    _thetaDeg?: number,
    _semiMajor?: number,
    _semiMinor?: number,
    _convergenceCorrectionDeg?: number,
  ) => string;
  displayFactorsForStation: (_stationId: string, _station: Station) => DisplayFactors;
}

export const appendErrorPropagationSections = ({
  lines,
  res,
  settings,
  parseSettings,
  parseState,
  stationEntriesForListing,
  classicTraverseStationOrder,
  relationshipRows,
  selectedEllipseStationIds,
  gpsDirectFixedLinkedStations,
  positionalToleranceRows,
  usesClassicParityLayout,
  usesCompactGnssParityLayout,
  isGnssOnlyListing,
  hasStationDescriptions,
  isPreanalysis,
  useClassicPreanalysisListing,
  coordMode,
  linearUnit,
  unitScale,
  coordSystemMode,
  precisionReportingMode,
  confidence95Scale,
  positionalToleranceEnabled,
  positionalToleranceConfidencePercent,
  positionalToleranceConstantMm,
  positionalTolerancePpm,
  addCenteredHeading,
  renderTextTable,
  stationDescription,
  formatEllipseAzDm,
  displayFactorsForStation,
}: AppendErrorPropagationSectionsArgs) => {
  if (!settings.listingShowErrorPropagation) return;
  lines.push('');
  addCenteredHeading('Error Propagation');
  lines.push('');
  lines.push(
    `${useClassicPreanalysisListing || !isPreanalysis ? 'Station Coordinate Standard Deviations' : 'Predicted Station Coordinate Standard Deviations'} (${linearUnit})`,
  );
  lines.push('');
  if (useClassicPreanalysisListing) {
    const firstCoordLabel = (parseState?.order ?? parseSettings.order) === 'NE' ? 'N' : 'E';
    const secondCoordLabel = (parseState?.order ?? parseSettings.order) === 'NE' ? 'E' : 'N';
    lines.push(
      coordMode === '3D'
        ? `Station                     ${firstCoordLabel}             ${secondCoordLabel}             Elev`
        : `Station                     ${firstCoordLabel}             ${secondCoordLabel}`,
    );
    const classicPrecisionStationEntries =
      classicTraverseStationOrder.length > 0
        ? classicTraverseStationOrder
            .map((stationId) => [stationId, res.stations[stationId]] as const)
            .filter((entry): entry is [string, Station] => entry[1] != null)
        : stationEntriesForListing;
    classicPrecisionStationEntries.forEach(([id]) => {
      const precision = getStationPrecision(res as never, id, precisionReportingMode);
      const firstSigmaValue =
        (((parseState?.order ?? parseSettings.order) === 'NE' ? precision.sigmaN : precision.sigmaE) ?? 0) * unitScale;
      const secondSigmaValue =
        (((parseState?.order ?? parseSettings.order) === 'NE' ? precision.sigmaE : precision.sigmaN) ?? 0) * unitScale;
      const firstSigma = firstSigmaValue.toFixed(6).padStart(14);
      const secondSigma = secondSigmaValue.toFixed(6).padStart(14);
      const base = `${id.padEnd(18)}${firstSigma}${secondSigma}`;
      lines.push(coordMode === '3D' ? `${base}${((precision.sigmaH ?? 0) * unitScale).toFixed(6).padStart(14)}` : base);
    });
  } else if (isGnssOnlyListing && !hasStationDescriptions) {
    lines.push(coordMode === '3D' ? 'Station                     N             E             Elev' : 'Station                     N             E');
    stationEntriesForListing.forEach(([id]) => {
      const precision = getStationPrecision(res as never, id, precisionReportingMode);
      const base = `${id.padEnd(18)}${((precision.sigmaN ?? 0) * unitScale).toFixed(6).padStart(14)}${((precision.sigmaE ?? 0) * unitScale).toFixed(6).padStart(14)}`;
      lines.push(coordMode === '3D' ? `${base}${((precision.sigmaH ?? 0) * unitScale).toFixed(6).padStart(14)}` : base);
    });
  } else {
    const stdRows = stationEntriesForListing.map(([id]) => {
      const precision = getStationPrecision(res as never, id, precisionReportingMode);
      const row = [id, stationDescription(id) || '-', ((precision.sigmaN ?? 0) * unitScale).toFixed(6), ((precision.sigmaE ?? 0) * unitScale).toFixed(6)];
      if (coordMode === '3D') row.push(((precision.sigmaH ?? 0) * unitScale).toFixed(6));
      return row;
    });
    renderTextTable(
      coordMode === '3D' ? ['Station', 'Description', 'N', 'E', 'Elev'] : ['Station', 'Description', 'N', 'E'],
      stdRows,
      coordMode === '3D' ? [2, 3, 4] : [2, 3],
    );
  }

  lines.push('');
  lines.push(
    `${useClassicPreanalysisListing || !isPreanalysis ? 'Station Coordinate Error Ellipses' : 'Predicted Station Coordinate Error Ellipses'} (${linearUnit})`,
  );
  lines.push('                            Confidence Region = 95%');
  lines.push('');
  const stationEllipseRows = stationEntriesForListing
    .map(([id]) => {
      const precision = getStationPrecision(res as never, id, precisionReportingMode);
      const station = res.stations[id];
      const hasZeroPrecisionRow =
        station?.fixed &&
        (precision.sigmaN == null || Math.abs(precision.sigmaN) <= 1e-15) &&
        (precision.sigmaE == null || Math.abs(precision.sigmaE) <= 1e-15) &&
        (coordMode !== '3D' || precision.sigmaH == null || Math.abs(precision.sigmaH) <= 1e-15);
      if (selectedEllipseStationIds.size > 0 && !selectedEllipseStationIds.has(id) && !hasZeroPrecisionRow) {
        return null;
      }
      if (!precision.ellipse && !hasZeroPrecisionRow) return null;
      const row = [
        id,
        ((precision.ellipse?.semiMajor ?? 0) * confidence95Scale * unitScale).toFixed(6),
        ((precision.ellipse?.semiMinor ?? 0) * confidence95Scale * unitScale).toFixed(6),
        hasZeroPrecisionRow
          ? '0-00'
          : formatEllipseAzDm(
              precision.ellipse?.theta,
              precision.ellipse?.semiMajor,
              precision.ellipse?.semiMinor,
              usesCompactGnssParityLayout && gpsDirectFixedLinkedStations.has(id)
                ? displayFactorsForStation(id, station ?? res.stations[id]).convergenceAngleRad * RAD_TO_DEG
                : 0,
            ),
      ];
      if (coordMode === '3D') row.push(((precision.sigmaH ?? 0) * ONE_DIMENSIONAL_CONFIDENCE_95_SCALE * unitScale).toFixed(6));
      return row;
    })
    .filter((row): row is string[] => row != null);
  if (stationEllipseRows.length > 0) {
    lines.push(coordMode === '3D' ? 'Station                 Semi-Major    Semi-Minor   Azimuth of       Elev' : 'Station                 Semi-Major    Semi-Minor   Azimuth of');
    lines.push(coordMode === '3D' ? '                            Axis          Axis     Major Axis' : '                            Axis          Axis     Major Axis');
    stationEllipseRows.forEach((row) => {
      const base = `${row[0].padEnd(20)} ${row[1].padStart(13)} ${row[2].padStart(13)} ${row[3].padStart(10)}`;
      lines.push(coordMode === '3D' ? `${base} ${row[4].padStart(14)}` : base);
    });
  } else {
    lines.push('(none)');
  }

  lines.push('');
  lines.push(
    `${useClassicPreanalysisListing || !isPreanalysis ? 'Relative Error Ellipses' : 'Predicted Relative Error Ellipses'} (${linearUnit})`,
  );
  lines.push('                            Confidence Region = 95%');
  lines.push('');
  const relativeEllipseRows = relationshipRows
    .filter((row) => row.ellipse != null)
    .map((row) => {
      const avgCombined =
        res.stations[row.from] && res.stations[row.to]
          ? ((res.stations[row.from]?.combinedFactor ?? 1) + (res.stations[row.to]?.combinedFactor ?? 1)) / 2
          : 1;
      const ellipseLinearDisplayScale =
        usesClassicParityLayout && coordSystemMode === 'grid' && Number.isFinite(avgCombined) && avgCombined > 0
          ? 1 / avgCombined
          : 1;
      const semiMajor = (row.ellipse?.semiMajor ?? 0) * ellipseLinearDisplayScale;
      const semiMinor = (row.ellipse?.semiMinor ?? 0) * ellipseLinearDisplayScale;
      const semiMajor95Display = semiMajor * confidence95Scale * unitScale;
      const horizontalDistanceDisplay =
        Number.isFinite(Number(row.distance)) ? Number(row.distance) : Number.NaN;
      const rla2d =
        Number.isFinite(horizontalDistanceDisplay) && semiMajor95Display > 0
          ? `1:${(horizontalDistanceDisplay / semiMajor95Display).toLocaleString('en-US', {
              maximumFractionDigits: 0,
            })}`
          : '-';
      const ppm2d =
        Number.isFinite(horizontalDistanceDisplay) && horizontalDistanceDisplay > 0
          ? ((semiMajor95Display / horizontalDistanceDisplay) * 1_000_000).toFixed(2)
          : '-';
      const ellipseAzimuthCorrectionDeg =
        usesCompactGnssParityLayout &&
        ((res.stations[row.from]?.fixed === true && gpsDirectFixedLinkedStations.has(row.to)) ||
          (res.stations[row.to]?.fixed === true && gpsDirectFixedLinkedStations.has(row.from)))
          ? ((displayFactorsForStation(row.from, res.stations[row.from]).convergenceAngleRad +
              displayFactorsForStation(row.to, res.stations[row.to]).convergenceAngleRad) *
              RAD_TO_DEG) /
            2
          : 0;
      return [
        row.from,
        row.to,
        semiMajor95Display.toFixed(6),
        (semiMinor * confidence95Scale * unitScale).toFixed(6),
        formatEllipseAzDm(row.ellipse?.theta, semiMajor, semiMinor, ellipseAzimuthCorrectionDeg),
        row.sigmaH != null ? (row.sigmaH * ONE_DIMENSIONAL_CONFIDENCE_95_SCALE * unitScale).toFixed(6) : '-',
        rla2d,
        ppm2d,
      ];
    });
  if (relativeEllipseRows.length > 0) {
    const includeRelativeVertical = coordMode === '3D' && relativeEllipseRows.some((row) => row[5] !== '-');
    lines.push(
      includeRelativeVertical
        ? 'Stations                Semi-Major    Semi-Minor   Azimuth of     Vertical          RLA(2D)        PPM'
        : 'Stations                Semi-Major    Semi-Minor   Azimuth of          RLA(2D)        PPM',
    );
    lines.push(
      includeRelativeVertical
        ? 'From       To               Axis          Axis     Major Axis                            1:____'
        : 'From       To               Axis          Axis     Major Axis                            1:____',
    );
    relativeEllipseRows.forEach((row) => {
      const base = `${row[0].padEnd(10)} ${row[1].padEnd(9)} ${row[2].padStart(13)} ${row[3].padStart(13)} ${row[4].padStart(10)}`;
      lines.push(
        includeRelativeVertical
          ? `${base} ${row[5].padStart(14)} ${row[6].padStart(15)} ${row[7].padStart(10)}`
          : `${base} ${row[6].padStart(15)} ${row[7].padStart(10)}`,
      );
    });
  } else {
    lines.push('(none)');
  }

  if (positionalToleranceEnabled) {
    lines.push('');
    lines.push(`Positional Tolerance Checks (${linearUnit})`);
    lines.push(`    Tolerance = ${(positionalToleranceConstantMm / 1000 * unitScale).toFixed(6)} ${linearUnit} + ${positionalTolerancePpm.toFixed(3)} PPM`);
    lines.push(`    Confidence Region = ${positionalToleranceConfidencePercent.toFixed(2)}%`);
    lines.push('');
    if (positionalToleranceRows.length > 0) {
      lines.push('Stations                   Distance     Allowable    Check Value   Status');
      lines.push('From       To');
      positionalToleranceRows.forEach((row) => {
        lines.push(
          `${row.from.padEnd(10)} ${row.to.padEnd(9)} ${(row.distanceMeters * unitScale).toFixed(4).padStart(12)} ${(row.toleranceMeters * unitScale).toFixed(6).padStart(13)} ${(row.checkMeters * unitScale).toFixed(6).padStart(13)} ${row.passes ? 'PASS' : 'FAIL'}`,
        );
      });
    } else {
      lines.push('(none)');
    }
  }

  if (isPreanalysis && !useClassicPreanalysisListing && res.weakGeometryDiagnostics) {
    const flaggedStations = res.weakGeometryDiagnostics.stationCues.filter((cue) => cue.severity !== 'ok');
    const flaggedPairs = res.weakGeometryDiagnostics.relativeCues.filter((cue) => cue.severity !== 'ok');
    lines.push('');
    lines.push('Weak Geometry Cues');
    lines.push('');
    lines.push(
      `stationMedian=${(res.weakGeometryDiagnostics.stationMedianHorizontal * unitScale).toFixed(6)} ${linearUnit}; pairMedian=${res.weakGeometryDiagnostics.relativeMedianDistance != null ? `${(res.weakGeometryDiagnostics.relativeMedianDistance * unitScale).toFixed(6)} ${linearUnit}` : '-'}`,
    );
    if (flaggedStations.length === 0 && flaggedPairs.length === 0) {
      lines.push('(none)');
    } else {
      flaggedStations.forEach((cue) => {
        lines.push(
          `  Station ${cue.stationId}: ${cue.severity.toUpperCase()} metric=${(cue.horizontalMetric * unitScale).toFixed(6)} ${linearUnit} ratio=${cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'} shape=${cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'} ${cue.note}`,
        );
      });
      flaggedPairs.forEach((cue) => {
        lines.push(
          `  Pair ${cue.from}-${cue.to}: ${cue.severity.toUpperCase()} metric=${cue.distanceMetric != null ? `${(cue.distanceMetric * unitScale).toFixed(6)} ${linearUnit}` : '-'} ratio=${cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'} shape=${cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'} ${cue.note}`,
        );
      });
    }
  }
};
