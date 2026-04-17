import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ReportView from '../src/components/ReportView';
import { LSAEngine } from '../src/engine/adjust';
import {
  DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  DEFAULT_QFIX_LINEAR_SIGMA_M,
} from '../src/engine/defaults';
import { buildIndustryStyleListingText } from '../src/engine/industryListing';
import type { ReportViewControls } from '../src/hooks/useReportViewState';

const buildRunDiagnostics = (result: ReturnType<LSAEngine['solve']>) => ({
  solveProfile: 'industry-parity' as const,
  runMode: result.parseState?.runMode ?? 'adjustment',
  parity: true,
  directionSetMode: result.parseState?.directionSetMode ?? 'reduced',
  mapMode: result.parseState?.mapMode ?? 'off',
  mapScaleFactor: result.parseState?.mapScaleFactor ?? 1,
  normalize: result.parseState?.normalize ?? true,
  faceNormalizationMode: result.parseState?.faceNormalizationMode ?? 'on',
  angleMode: result.parseState?.angleMode ?? 'auto',
  verticalReduction: result.parseState?.verticalReduction ?? 'none',
  applyCurvatureRefraction: result.parseState?.applyCurvatureRefraction ?? false,
  refractionCoefficient: result.parseState?.refractionCoefficient ?? 0.13,
  tsCorrelationEnabled: result.parseState?.tsCorrelationEnabled ?? false,
  tsCorrelationScope: result.parseState?.tsCorrelationScope ?? 'set',
  tsCorrelationRho: result.parseState?.tsCorrelationRho ?? 0.25,
  robustMode: result.parseState?.robustMode ?? 'none',
  robustK: result.parseState?.robustK ?? 1.5,
  rotationAngleRad: result.parseState?.rotationAngleRad ?? 0,
  crsTransformEnabled: result.parseState?.crsTransformEnabled ?? false,
  crsProjectionModel: result.parseState?.crsProjectionModel ?? 'legacy-equirectangular',
  crsLabel: result.parseState?.crsLabel ?? '',
  crsGridScaleEnabled: result.parseState?.crsGridScaleEnabled ?? false,
  crsGridScaleFactor: result.parseState?.crsGridScaleFactor ?? 1,
  crsConvergenceEnabled: result.parseState?.crsConvergenceEnabled ?? false,
  crsConvergenceAngleRad: result.parseState?.crsConvergenceAngleRad ?? 0,
  geoidModelEnabled: result.parseState?.geoidModelEnabled ?? false,
  geoidModelId: result.parseState?.geoidModelId ?? 'NGS-DEMO',
  geoidInterpolation: result.parseState?.geoidInterpolation ?? 'bilinear',
  geoidHeightConversionEnabled: result.parseState?.geoidHeightConversionEnabled ?? false,
  geoidOutputHeightDatum: result.parseState?.geoidOutputHeightDatum ?? 'orthometric',
  geoidModelLoaded: result.parseState?.geoidModelLoaded ?? false,
  geoidModelMetadata: result.parseState?.geoidModelMetadata ?? '',
  geoidSampleUndulationM: result.parseState?.geoidSampleUndulationM,
  geoidConvertedStationCount: result.parseState?.geoidConvertedStationCount ?? 0,
  geoidSkippedStationCount: result.parseState?.geoidSkippedStationCount ?? 0,
  qFixLinearSigmaM: result.parseState?.qFixLinearSigmaM ?? DEFAULT_QFIX_LINEAR_SIGMA_M,
  qFixAngularSigmaSec: result.parseState?.qFixAngularSigmaSec ?? DEFAULT_QFIX_ANGULAR_SIGMA_SEC,
  profileDefaultInstrumentFallback: false,
  angleCenteringModel: 'geometry-aware-correlated-rays' as const,
  coordSystemMode: result.parseState?.coordSystemMode ?? 'local',
  crsId: result.parseState?.crsId,
  localDatumScheme: result.parseState?.localDatumScheme,
  averageScaleFactor: result.parseState?.averageScaleFactor,
  scaleOverrideActive: result.parseState?.scaleOverrideActive,
  commonElevation: result.parseState?.commonElevation,
  averageGeoidHeight: result.parseState?.averageGeoidHeight,
  gnssVectorFrameDefault: result.parseState?.gnssVectorFrameDefault,
  gnssFrameConfirmed: result.parseState?.gnssFrameConfirmed,
  gridBearingMode: result.parseState?.gridBearingMode,
  gridDistanceMode: result.parseState?.gridDistanceMode,
  gridAngleMode: result.parseState?.gridAngleMode,
  gridDirectionMode: result.parseState?.gridDirectionMode,
  parsedUsageSummary: result.parseState?.parsedUsageSummary,
  usedInSolveUsageSummary: result.parseState?.usedInSolveUsageSummary,
  directiveTransitions: result.parseState?.directiveTransitions,
  directiveNoEffectWarnings: result.parseState?.directiveNoEffectWarnings,
  datumSufficiencyReport: result.parseState?.datumSufficiencyReport,
  coordSystemDiagnostics: result.parseState?.coordSystemDiagnostics,
  coordSystemWarningMessages: result.parseState?.coordSystemWarningMessages,
  crsStatus: result.parseState?.crsStatus,
  crsOffReason: result.parseState?.crsOffReason,
  defaultSigmaCount: 0,
  defaultSigmaByType: '',
  stochasticDefaultsSummary: 'inst=S9',
});

const createReportViewState = (
  collapsedSections: Record<string, boolean> = {},
): ReportViewControls =>
  ({
    ellipseMode: '1sigma',
    setEllipseMode: () => {},
    ellipseConfidenceScale: 1,
    reportFilterQuery: '',
    setReportFilterQuery: () => {},
    reportObservationTypeFilter: 'all',
    setReportObservationTypeFilter: () => {},
    reportExclusionFilter: 'all',
    setReportExclusionFilter: () => {},
    clearFilters: () => {},
    deferredReportFilterQuery: '',
    normalizedReportFilterQuery: '',
    pinnedDetailSections: [],
    clearPinnedDetailSections: () => {},
    isDetailSectionPinned: () => false,
    togglePinnedDetailSection: () => {},
    isSectionCollapsed: (id) => collapsedSections[id] ?? false,
    toggleDetailSection: () => {},
    allDetailSectionsCollapsed: false,
    setAllDetailSectionsCollapsed: () => {},
    visibleRowsFor: (_key, rows) => rows,
    showMoreRows: () => {},
  }) as ReportViewControls;

describe('inline option profile outputs', () => {
  it('surfaces directive state in both listing and report solve-profile outputs', () => {
    const input = readFileSync('tests/fixtures/inline_option_phase3_profile.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 8 }).solve();
    const runDiagnostics = buildRunDiagnostics(result);

    const listing = buildIndustryStyleListingText(
      result,
      {
        maxIterations: 8,
        units: 'ft',
        listingShowCoordinates: true,
        listingShowObservationsResiduals: true,
        listingShowErrorPropagation: true,
        listingShowProcessingNotes: false,
        listingShowAzimuthsBearings: true,
        listingSortCoordinatesBy: 'name',
        listingSortObservationsBy: 'input',
        listingObservationLimit: 500,
      },
      {
        coordMode: '2D',
        order: 'NE',
        angleUnits: 'dd',
        angleStationOrder: 'fromatto',
        deltaMode: 'horiz',
        refractionCoefficient: 0.13,
      },
      {
        solveProfile: 'industry-parity',
        angleCenteringModel: 'geometry-aware-correlated-rays',
        defaultSigmaCount: 0,
        defaultSigmaByType: '',
        stochasticDefaultsSummary: 'inst=S9',
        rotationAngleRad: 0,
      },
    );

    expect(listing).toMatch(/Type of Adjustment\s+:\s+2D/);
    expect(listing).toMatch(/Project Units\s+:\s+FeetUS; DD/);
    expect(listing).toMatch(/Input\/Output Coordinate Order\s+:\s+North-East/);
    expect(listing).toMatch(/Angle Data Station Order\s+:\s+From-At-To/);
    expect(listing).toMatch(/Distance\/Vertical Data Type\s+:\s+Hor Dist\/DE/);
    expect(listing).toMatch(/Map Mode \/ Scale\s+:\s+ANGLECALC \/ 1\.00000000/);
    expect(listing).toMatch(/Normalize\s+:\s+OFF \(OFF\)/);

    const html = renderToStaticMarkup(
      <ReportView
        result={result}
        units="ft"
        viewState={createReportViewState({ 'solve-profile-diagnostics': false })}
        runDiagnostics={runDiagnostics}
        excludedIds={new Set<number>()}
        onToggleExclude={() => {}}
        onApplyImpactExclude={() => {}}
        onApplyPreanalysisAction={() => {}}
        onReRun={() => {}}
        onClearExclusions={() => {}}
        overrides={{}}
        onOverride={() => {}}
        onResetOverrides={() => {}}
        clusterReviewDecisions={{}}
        activeClusterApprovedMerges={[]}
        onClusterDecisionStatus={() => {}}
        onClusterCanonicalSelection={() => {}}
        onApplyClusterMerges={() => {}}
        onResetClusterReview={() => {}}
        onClearClusterMerges={() => {}}
      />,
    );

    expect(html).toContain('Solve Profile Diagnostics');
    expect(html).toContain('ANGLECALC / 1.00000000');
    expect(html).toContain('OFF (OFF)');
  });
});
