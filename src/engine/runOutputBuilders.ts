import { buildIndustryStyleListingText } from './industryListing';
import { buildLandXmlText } from './landxml';
import type { ParseSettings, RunDiagnostics, SettingsState } from '../appStateTypes';
import type { AdjustmentResult } from '../types';

interface CreateRunOutputBuildersArgs {
  settings: SettingsState;
  parseSettings: ParseSettings;
  runDiagnostics: RunDiagnostics | null;
  buildRunDiagnostics: (_base: ParseSettings, _solved?: AdjustmentResult) => RunDiagnostics;
}

export const createRunOutputBuilders = ({
  settings,
  parseSettings,
  runDiagnostics,
  buildRunDiagnostics,
}: CreateRunOutputBuildersArgs) => {
  const buildIndustryListingText = (res: AdjustmentResult): string => {
    const runDiag = runDiagnostics ?? buildRunDiagnostics(parseSettings, res);
    return buildIndustryStyleListingText(
      res,
      {
        maxIterations: settings.maxIterations,
        convergenceLimit: settings.convergenceLimit,
        precisionReportingMode: settings.precisionReportingMode,
        units: settings.units,
        listingShowLostStations: settings.listingShowLostStations,
        listingShowCoordinates: settings.listingShowCoordinates,
        listingShowObservationsResiduals: settings.listingShowObservationsResiduals,
        listingShowErrorPropagation: settings.listingShowErrorPropagation,
        listingShowProcessingNotes: settings.listingShowProcessingNotes,
        listingShowAzimuthsBearings: settings.listingShowAzimuthsBearings,
        listingSortCoordinatesBy: settings.listingSortCoordinatesBy,
        listingSortObservationsBy: settings.listingSortObservationsBy,
        listingObservationLimit: settings.listingObservationLimit,
      },
      {
        coordMode: parseSettings.coordMode,
        order: parseSettings.order,
        angleUnits: parseSettings.angleUnits,
        angleStationOrder: parseSettings.angleStationOrder,
        deltaMode: parseSettings.deltaMode,
        refractionCoefficient: parseSettings.refractionCoefficient,
        descriptionReconcileMode: parseSettings.descriptionReconcileMode,
        descriptionAppendDelimiter: parseSettings.descriptionAppendDelimiter,
        positionalToleranceEnabled: parseSettings.positionalToleranceEnabled,
        positionalToleranceConstantMm: parseSettings.positionalToleranceConstantMm,
        positionalTolerancePpm: parseSettings.positionalTolerancePpm,
        positionalToleranceConfidencePercent: parseSettings.positionalToleranceConfidencePercent,
      },
      {
        solveProfile: runDiag.solveProfile,
        angleCenteringModel: runDiag.angleCenteringModel,
        defaultSigmaCount: runDiag.defaultSigmaCount,
        defaultSigmaByType: runDiag.defaultSigmaByType,
        stochasticDefaultsSummary: runDiag.stochasticDefaultsSummary,
        rotationAngleRad: runDiag.rotationAngleRad,
        coordSystemMode: runDiag.coordSystemMode,
        crsId: runDiag.crsId,
        localDatumScheme: runDiag.localDatumScheme,
        averageScaleFactor: runDiag.averageScaleFactor,
        commonElevation: runDiag.commonElevation,
        averageGeoidHeight: runDiag.averageGeoidHeight,
        gridBearingMode: runDiag.gridBearingMode,
        gridDistanceMode: runDiag.gridDistanceMode,
        gridAngleMode: runDiag.gridAngleMode,
        gridDirectionMode: runDiag.gridDirectionMode,
        parsedUsageSummary: runDiag.parsedUsageSummary,
        usedInSolveUsageSummary: runDiag.usedInSolveUsageSummary,
        directiveTransitions: runDiag.directiveTransitions,
        directiveNoEffectWarnings: runDiag.directiveNoEffectWarnings,
        coordSystemDiagnostics: runDiag.coordSystemDiagnostics,
        coordSystemWarningMessages: runDiag.coordSystemWarningMessages,
        crsStatus: runDiag.crsStatus,
        crsOffReason: runDiag.crsOffReason,
        crsDatumOpId: runDiag.crsDatumOpId,
        crsDatumFallbackUsed: runDiag.crsDatumFallbackUsed,
        crsAreaOfUseStatus: runDiag.crsAreaOfUseStatus,
        crsOutOfAreaStationCount: runDiag.crsOutOfAreaStationCount,
        qFixLinearSigmaM: runDiag.qFixLinearSigmaM,
        qFixAngularSigmaSec: runDiag.qFixAngularSigmaSec,
        crsTransformEnabled: runDiag.crsTransformEnabled,
        crsProjectionModel: runDiag.crsProjectionModel,
        crsLabel: runDiag.crsLabel,
        crsGridScaleEnabled: runDiag.crsGridScaleEnabled,
        crsGridScaleFactor: runDiag.crsGridScaleFactor,
        crsConvergenceEnabled: runDiag.crsConvergenceEnabled,
        crsConvergenceAngleRad: runDiag.crsConvergenceAngleRad,
        geoidModelEnabled: runDiag.geoidModelEnabled,
        geoidModelId: runDiag.geoidModelId,
        geoidInterpolation: runDiag.geoidInterpolation,
        geoidHeightConversionEnabled: runDiag.geoidHeightConversionEnabled,
        geoidOutputHeightDatum: runDiag.geoidOutputHeightDatum,
        geoidModelLoaded: runDiag.geoidModelLoaded,
        geoidModelMetadata: runDiag.geoidModelMetadata,
        geoidSampleUndulationM: runDiag.geoidSampleUndulationM,
        geoidConvertedStationCount: runDiag.geoidConvertedStationCount,
        geoidSkippedStationCount: runDiag.geoidSkippedStationCount,
        gpsAddHiHtEnabled: runDiag.gpsAddHiHtEnabled,
        gpsAddHiHtHiM: runDiag.gpsAddHiHtHiM,
        gpsAddHiHtHtM: runDiag.gpsAddHiHtHtM,
        gpsAddHiHtVectorCount: runDiag.gpsAddHiHtVectorCount,
        gpsAddHiHtAppliedCount: runDiag.gpsAddHiHtAppliedCount,
        gpsAddHiHtPositiveCount: runDiag.gpsAddHiHtPositiveCount,
        gpsAddHiHtNegativeCount: runDiag.gpsAddHiHtNegativeCount,
        gpsAddHiHtNeutralCount: runDiag.gpsAddHiHtNeutralCount,
        gpsAddHiHtDefaultZeroCount: runDiag.gpsAddHiHtDefaultZeroCount,
        gpsAddHiHtMissingHeightCount: runDiag.gpsAddHiHtMissingHeightCount,
        gpsAddHiHtScaleMin: runDiag.gpsAddHiHtScaleMin,
        gpsAddHiHtScaleMax: runDiag.gpsAddHiHtScaleMax,
        currentInstrumentCode: runDiag.currentInstrumentCode,
        currentInstrumentDesc: runDiag.currentInstrumentDesc,
        currentInstrumentLevStdMmPerKm: runDiag.currentInstrumentLevStdMmPerKm,
        projectInstrumentLibrary: runDiag.projectInstrumentLibrary,
      },
    );
  };

  const buildLandXmlExportText = (solved: AdjustmentResult) =>
    buildLandXmlText(solved, {
      units: settings.units,
      precisionReportingMode: settings.precisionReportingMode,
      solveProfile: (runDiagnostics ?? buildRunDiagnostics(parseSettings, solved)).solveProfile,
      showLostStations: settings.listingShowLostStations,
      projectName: 'webnet-adjustment',
      applicationName: 'WebNet',
      applicationVersion: '0.0.0',
    });

  return {
    buildIndustryListingText,
    buildLandXmlExportText,
  };
};
