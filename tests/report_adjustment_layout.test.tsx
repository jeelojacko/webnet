import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ReportView from '../src/components/ReportView';
import { LSAEngine } from '../src/engine/adjust';
import type { ReportViewControls } from '../src/hooks/useReportViewState';

const baseInput = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 100 80 0',
  'D A-C 128.0624847 0.005',
  'D B-C 80.0000000 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

const baseRunDiagnostics = {
  solveProfile: 'webnet',
  runMode: 'adjustment',
  parity: false,
  directionSetMode: 'reduced',
  mapMode: 'off',
  mapScaleFactor: 1,
  normalize: false,
  faceNormalizationMode: 'off',
  angleMode: 'auto',
  verticalReduction: 'none',
  applyCurvatureRefraction: false,
  refractionCoefficient: 0.13,
  tsCorrelationEnabled: false,
  tsCorrelationScope: 'setup',
  tsCorrelationRho: 0.25,
  robustMode: 'none',
  robustK: 1.5,
  rotationAngleRad: 0,
  crsTransformEnabled: false,
  crsProjectionModel: 'legacy-equirectangular',
  crsLabel: '',
  crsGridScaleEnabled: false,
  crsGridScaleFactor: 1,
  crsConvergenceEnabled: false,
  crsConvergenceAngleRad: 0,
  geoidModelEnabled: false,
  geoidModelId: 'none',
  geoidInterpolation: 'bilinear',
  geoidHeightConversionEnabled: false,
  geoidOutputHeightDatum: 'orthometric',
  geoidModelLoaded: false,
  geoidModelMetadata: '',
  geoidConvertedStationCount: 0,
  geoidSkippedStationCount: 0,
  qFixLinearSigmaM: 0.0001,
  qFixAngularSigmaSec: 1,
  profileDefaultInstrumentFallback: false,
  angleCenteringModel: 'geometry-aware-correlated-rays',
  coordSystemMode: 'local',
  crsId: 'CA_NAD83_CSRS_UTM_20N',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  scaleOverrideActive: false,
  commonElevation: 0,
  gnssVectorFrameDefault: 'gridNEU',
  gnssFrameConfirmed: false,
  defaultSigmaCount: 0,
  defaultSigmaByType: '',
  stochasticDefaultsSummary: '',
} as const;

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
    reviewConflictOnly: false,
    setReviewConflictOnly: () => {},
    reviewAdjustedOnly: false,
    setReviewAdjustedOnly: () => {},
    reviewImportedGroupFilter: 'all',
    setReviewImportedGroupFilter: () => {},
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

const renderReport = (
  result: ReturnType<LSAEngine['solve']>,
  viewState?: ReportViewControls,
) =>
  renderToStaticMarkup(
    <ReportView
      result={result}
      units="m"
      viewState={viewState}
      runDiagnostics={baseRunDiagnostics as any}
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

describe('ReportView adjustment-layout sections', () => {
  it('applies the prioritized section order and removes redundant suspect blocks', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.suspectImpactDiagnostics = [
      {
        obsId: result.observations[0]?.id ?? 1,
        type: 'dist',
        stations: 'A-C',
        sourceLine: 5,
        baseStdRes: 2.4,
        deltaSeuw: -0.01,
        deltaMaxStdRes: -0.2,
        chiDelta: 'PASS->PASS',
        maxCoordShift: 0.001,
        score: 1.2,
        status: 'ok',
      },
    ] as any;
    result.setupDiagnostics = [
      {
        station: 'C',
        directionSetCount: 0,
        directionObsCount: 0,
        angleObsCount: 1,
        distanceObsCount: 2,
        zenithObsCount: 0,
        levelingObsCount: 0,
        gpsObsCount: 0,
        traverseDistance: 0,
        orientationRmsArcSec: null,
        orientationSeArcSec: null,
        rmsStdRes: 1.1,
        maxStdRes: 2.2,
        localFailCount: 1,
        worstObsType: 'dist',
        worstObsStations: 'A-C',
        worstObsLine: 5,
      },
    ] as any;

    const html = renderReport(result);
    expect(html).toContain('style="order:-210"');
    expect(html).toMatch(/style="order:-200"[\s\S]*Solve Profile Diagnostics/);
    expect(html).toMatch(/style="order:-190"[\s\S]*Adjusted Coordinates/);
    expect(html).toMatch(/style="order:-180"[\s\S]*Observations &amp; Residuals/);
    expect(html).toMatch(/style="order:-170"[\s\S]*Residual Diagnostics/);
    expect(html).toMatch(/style="order:-160"[\s\S]*Setup Diagnostics/);
    expect(html).toMatch(/style="order:-140"[\s\S]*Suspect Impact Analysis \(what-if exclusion\)/);
    expect(html).not.toContain('StdDev (override)');
    expect(html).not.toContain('Outlier Analysis (&gt; 2 sigma)');
    expect(html).not.toContain('Top Suspects (ranked)');
    expect(html).not.toContain('Setup Suspects (ranked)');
  });

  it('hides optional diagnostics when not applicable and suppresses CRS text in local mode', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.autoSideshotDiagnostics = {
      enabled: true,
      evaluatedCount: 0,
      candidateCount: 0,
      excludedControlCount: 0,
      threshold: 0.2,
      candidates: [],
    } as any;
    result.tsCorrelationDiagnostics = {
      enabled: true,
      scope: 'setup',
      rho: 0.25,
      groupCount: 0,
      equationCount: 0,
      pairCount: 0,
      maxGroupSize: 0,
      meanAbsOffDiagWeight: null,
      groups: [],
    } as any;
    result.levelingLoopDiagnostics = {
      enabled: true,
      loops: [],
      suspectSegments: [],
    } as any;

    const html = renderReport(
      result,
      createReportViewState({ 'solve-profile-diagnostics': false }),
    );
    expect(html).not.toContain('Auto Sideshot Candidates (M Records)');
    expect(html).not.toContain('TS Correlation Diagnostics');
    expect(html).not.toContain('Leveling Loop Diagnostics');
    expect(html).toContain('Coordinate System');
    expect(html).toContain('>LOCAL<');
    expect(html).not.toContain('LOCAL (CA_NAD83_CSRS_UTM_20N)');
  });

  it('suppresses the retired CRS projection block while keeping active grid diagnostics', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    const html = renderToStaticMarkup(
      <ReportView
        result={result}
        units="m"
        viewState={createReportViewState({ 'solve-profile-diagnostics': false })}
        runDiagnostics={{
          ...baseRunDiagnostics,
          coordSystemMode: 'grid',
          crsGridScaleEnabled: true,
          crsGridScaleFactor: 0.99987654,
          crsConvergenceEnabled: true,
          crsConvergenceAngleRad: 0.001,
          crsTransformEnabled: true,
          crsProjectionModel: 'local-enu',
          crsLabel: 'Legacy Grid',
        } as any}
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

    expect(html).not.toContain('CRS / Projection');
    expect(html).toContain('CRS Grid Scale');
    expect(html).toContain('CRS Convergence');
  });
});
