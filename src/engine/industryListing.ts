import {
  appendIndustryListingAdjustedWorkflow,
} from './industryListingAdjustedWorkflow';
import { appendIndustryListingDiagnosticsSections } from './industryListingDiagnosticsSections';
import { appendPostAdjustmentListingSections } from './industryListingPostAdjustmentSections';
import { buildIndustryListingContext } from './industryListingBuildContext';
import { appendIndustryListingSummaryWorkflow } from './industryListingSummaryWorkflow';
import { appendErrorPropagationSections } from './industryListingSections';
import type {
  IndustryListingParseSettings,
  IndustryListingRunDiagnostics,
  IndustryListingSettings,
  IndustryListingSortCoordinatesBy,
  IndustryListingSortObservationsBy,
} from './industryListingTypes';
import type { AdjustmentResult } from '../types';
export {
  compareIndustryObservationsByInput,
  compareIndustryObservationsByStations,
  getIndustryObservationResidualSortMagnitude,
  getIndustryObservationStdErrorSortMagnitude,
  sortIndustryListingObservations,
} from './industryListingFormatters';
export type {
  IndustryListingParseSettings,
  IndustryListingRunDiagnostics,
  IndustryListingSettings,
  IndustryListingSortCoordinatesBy,
  IndustryListingSortObservationsBy,
} from './industryListingTypes';

const ONE_DIMENSIONAL_CONFIDENCE_95_SCALE = 1.959963984540054;

export const buildIndustryStyleListingText = (
  res: AdjustmentResult,
  settings: IndustryListingSettings,
  parseSettings: IndustryListingParseSettings,
  runDiagnostics: IndustryListingRunDiagnostics,
): string => {
  const lines: string[] = [];
  const listingContext = buildIndustryListingContext({
    lines,
    parseSettings,
    res,
    runDiagnostics,
    settings,
  });
  if ('levelingOnlyText' in listingContext && listingContext.levelingOnlyText) {
    return listingContext.levelingOnlyText;
  }
  const context = listingContext as Extract<
    ReturnType<typeof buildIndustryListingContext>,
    { stationContext: unknown }
  >;
  const {
    aliasRefsForLine,
    coordMode,
    coordSystemMode,
    descriptionAppendDelimiter,
    descriptionReconcileMode,
    gpsCoordinateSideshotsForListing,
    gpsLoopDiagnostics,
    gpsObservationRows,
    gpsOffsetObservations,
    gpsVectorSideshotsForListing,
    gridDistanceMode,
    isGnssOnlyListing,
    isPreanalysis,
    levelingLoopDiagnostics,
    linearUnit,
    observationsForListing,
    parseState,
    runMode,
    stationDescription,
    stationContext,
    traceabilityModel,
    tsSideshotsForListing,
    unitScale,
    useClassicPreanalysisListing,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
  } = context;
  const {
    classicTraverseStationOrder,
    displayFactorsForStation,
    stationEntriesForListing,
  } = stationContext;
  const {
    addCenteredHeading,
    gpsDisplayHelpers,
    hasStationDescriptions,
    hasTraverseStyleAngularFamilies,
    renderTextTable,
  } = appendIndustryListingSummaryWorkflow({
    context,
    lines,
    parseSettings,
    res,
    runDiagnostics,
    settings,
  });
  const {
    confidence95Scale,
    formatEllipseAzDm,
    gpsDirectFixedLinkedStations,
    positionalToleranceConfidencePercent,
    positionalToleranceConstantMm,
    positionalToleranceEnabled,
    positionalTolerancePpm,
    positionalToleranceRows,
    precisionReportingMode,
    relationshipRows,
    selectedEllipseStationIds,
  } = appendIndustryListingAdjustedWorkflow({
    addCenteredHeading,
    aliasRefsForLine,
    coordSystemMode,
    displayFactorsForStation,
    gpsDisplayHelpers,
    gpsObservationRows,
    gridDistanceMode,
    hasTraverseStyleAngularFamilies,
    isPreanalysis,
    linearUnit,
    lines,
    observationsForListing,
    parseSettings,
    parseState,
    renderTextTable,
    res,
    runMode,
    settings,
    unitScale,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
  });
  appendPostAdjustmentListingSections({
    addCenteredHeading,
    coordMode,
    gpsCoordinateSideshotsForListing,
    gpsLoopDiagnostics,
    gpsOffsetObservations,
    gpsVectorSideshotsForListing,
    levelingLoopDiagnostics,
    linearUnit,
    lines,
    renderTextTable,
    stationDescription,
    tsSideshotsForListing,
    unitScale,
  });

  appendErrorPropagationSections({
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
    displayFactorsForStation: (stationId, station) => displayFactorsForStation(stationId, station),
  });
  appendIndustryListingDiagnosticsSections({
    autoAdjustDiagnostics: res.autoAdjustDiagnostics,
    autoSideshotDiagnostics: res.autoSideshotDiagnostics,
    clusterDiagnostics: res.clusterDiagnostics,
    descriptionAppendDelimiter,
    descriptionReconcileMode,
    linearUnit,
    lines,
    traceabilityModel,
    unitScale,
  });
  return lines.join('\n');
};

