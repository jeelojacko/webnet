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
    showAllRows: () => {},
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

  it('moves active cluster and auto-adjust workflow sections ahead of lower-priority report blocks', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.clusterDiagnostics = {
      enabled: true,
      passMode: 'dual-pass',
      linkageMode: 'single',
      dimension: '2D',
      tolerance: 0.05,
      pairCount: 2,
      candidateCount: 1,
      approvedMergeCount: 0,
      candidates: [
        {
          key: 'cluster-1',
          representativeId: 'C',
          stationIds: ['C', 'C_AUX'],
          memberCount: 2,
          maxSeparation: 0.01,
          meanSeparation: 0.01,
          hasFixed: false,
          hasUnknown: true,
        },
      ],
      mergeOutcomes: [],
      rejectedProposals: [],
      appliedMerges: [],
    } as any;
    result.autoAdjustDiagnostics = {
      enabled: true,
      threshold: 3,
      maxCycles: 4,
      maxRemovalsPerCycle: 1,
      minRedundancy: 0.1,
      stopReason: 'no-candidates',
      cycles: [{ cycle: 1, seuw: 1.1, maxAbsStdRes: 3.2, removals: [] }],
      removed: [],
    } as any;

    const html = renderReport(result);
    expect(html).toMatch(/style="order:-208"[\s\S]*Cluster Detection Candidates/);
    expect(html).toMatch(/style="order:-207"[\s\S]*Auto-Adjust Diagnostics/);
    expect(html).toMatch(/style="order:-200"[\s\S]*Solve Profile Diagnostics/);
    expect(html).toMatch(/style="order:-190"[\s\S]*Adjusted Coordinates/);
  });

  it('keeps traceability and cluster summary cards visible while deferring heavy review tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.parseState = {
      ...(result.parseState ?? {}),
      aliasExplicitCount: 1,
      aliasRuleCount: 1,
      aliasRuleSummaries: [{ rule: 'RAW_C -> C', sourceLine: 2 }],
      aliasTrace: [
        {
          sourceId: 'RAW_C',
          canonicalId: 'C',
          sourceLine: 2,
          context: 'station',
          detail: 'explicit',
          reference: 'ALIAS',
        },
      ],
      descriptionRepeatedStationCount: 1,
      descriptionConflictCount: 1,
      descriptionReconcileMode: 'append',
      descriptionAppendDelimiter: ' / ',
      reconciledDescriptions: { C: 'Alpha / Bravo' },
      descriptionTrace: [
        { stationId: 'C', sourceLine: 5, recordType: 'C', description: 'Alpha' },
        { stationId: 'C', sourceLine: 6, recordType: 'C', description: 'Bravo' },
      ],
      descriptionScanSummary: [
        {
          stationId: 'C',
          recordCount: 2,
          uniqueCount: 2,
          conflict: true,
          descriptions: ['Alpha', 'Bravo'],
          sourceLines: [5, 6],
        },
      ],
      lostStationIds: [],
    } as any;

    result.clusterDiagnostics = {
      enabled: true,
      passMode: 'dual-pass',
      linkageMode: 'single',
      dimension: '2D',
      tolerance: 0.05,
      pairCount: 2,
      candidateCount: 1,
      approvedMergeCount: 0,
      candidates: [
        {
          key: 'cluster-1',
          representativeId: 'C',
          stationIds: ['C', 'C_AUX'],
          memberCount: 2,
          maxSeparation: 0.01,
          meanSeparation: 0.01,
          hasFixed: false,
          hasUnknown: true,
        },
      ],
      mergeOutcomes: [],
      rejectedProposals: [],
      appliedMerges: [],
    } as any;

    const html = renderReport(result);
    expect(html).toContain('Alias Traceability');
    expect(html).toContain('Description Reconciliation Summary');
    expect(html).toContain('Cluster Detection Candidates');
    expect(html).toContain('Rule Summary');
    expect(html).toContain('Conflicts');
    expect(html).toContain('Pending');
    expect(html).toContain('Show');
    expect(html).not.toContain('Source Alias');
    expect(html).not.toContain('Descriptions (line refs)');
    expect(html).not.toContain('Apply Approved Merges + Re-run');
    expect(html).not.toContain('Canonical ID');
  });

  it('keeps auto-adjust and auto-sideshot summary cards visible while deferring their detail tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.autoAdjustDiagnostics = {
      enabled: true,
      threshold: 3,
      maxCycles: 4,
      maxRemovalsPerCycle: 1,
      minRedundancy: 0.1,
      stopReason: 'no-candidates',
      cycles: [{ cycle: 1, seuw: 1.1, maxAbsStdRes: 3.2, removals: [] }],
      removed: [
        {
          obsId: 1,
          type: 'dist',
          stations: 'A-C',
          sourceLine: 5,
          stdRes: 3.2,
          redundancy: 0.45,
          reason: 'threshold',
        },
      ],
    } as any;
    result.autoSideshotDiagnostics = {
      enabled: true,
      evaluatedCount: 4,
      candidateCount: 1,
      excludedControlCount: 0,
      threshold: 0.2,
      candidates: [
        {
          sourceLine: 7,
          occupy: 'C',
          backsight: 'A',
          target: 'B',
          angleObsId: 1,
          distObsId: 2,
          angleRedundancy: 0.12,
          distRedundancy: 0.18,
          minRedundancy: 0.12,
          maxAbsStdRes: 2.5,
        },
      ],
    } as any;

    const html = renderReport(result);
    expect(html).toContain('Auto-Adjust Diagnostics');
    expect(html).toContain('Auto Sideshot Candidates (M Records)');
    expect(html).toContain('Threshold');
    expect(html).toContain('Total Removed');
    expect(html).toContain('Evaluated M Pairs');
    expect(html).toContain('Candidates');
    expect(html).toContain('Show');
    expect(html).not.toContain('Obs ID');
    expect(html).not.toContain('Occupy');
    expect(html).not.toContain('Backsight');
    expect(html).not.toContain('Angle Obs');
    expect(html).not.toContain('Dist Obs');
  });
});
