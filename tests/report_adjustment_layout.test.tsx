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

  it('keeps suspect-impact and setup summary cards visible while deferring their detail tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.suspectImpactDiagnostics = [
      {
        obsId: 1,
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
      {
        obsId: 2,
        type: 'angle',
        stations: 'C-A-B',
        sourceLine: 7,
        baseStdRes: 1.8,
        deltaSeuw: 0,
        deltaMaxStdRes: 0,
        chiDelta: 'PASS->PASS',
        maxCoordShift: 0,
        score: 0.5,
        status: 'excluded',
      },
    ] as any;
    result.setupDiagnostics = [
      {
        station: 'C',
        directionSetCount: 1,
        directionObsCount: 2,
        angleObsCount: 1,
        distanceObsCount: 2,
        zenithObsCount: 0,
        levelingObsCount: 0,
        gpsObsCount: 0,
        traverseDistance: 120,
        orientationRmsArcSec: 1.2,
        orientationSeArcSec: 0.8,
        rmsStdRes: 1.1,
        maxStdRes: 2.2,
        localFailCount: 1,
        worstObsType: 'dist',
        worstObsStations: 'A-C',
        worstObsLine: 5,
      },
    ] as any;

    const html = renderReport(result);
    expect(html).toContain('Suspect Impact Analysis (what-if exclusion)');
    expect(html).toContain('Setup Diagnostics');
    expect(html).toContain('Candidates');
    expect(html).toContain('Actionable');
    expect(html).toContain('Excluded');
    expect(html).toContain('Setups');
    expect(html).toContain('Worst Max |t|');
    expect(html).toContain('Show');
    expect(html).not.toContain('dSEUW');
    expect(html).not.toContain('Dir Sets');
    expect(html).not.toContain('Orient RMS');
  });

  it('keeps diagnostics summary cards visible while deferring residual, robust, correlation, and loop detail tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.residualDiagnostics = {
      observationCount: 6,
      withStdResCount: 5,
      over2SigmaCount: 1,
      over3SigmaCount: 0,
      over4SigmaCount: 0,
      localFailCount: 1,
      lowRedundancyCount: 1,
      veryLowRedundancyCount: 0,
      meanRedundancy: 0.42,
      minRedundancy: 0.11,
      maxStdRes: 2.44,
      criticalT: 3,
      worst: {
        obsId: 9,
        type: 'dist',
        stations: 'A-C',
        sourceLine: 5,
        stdRes: 2.44,
        localFail: true,
        redundancy: 0.11,
      },
      byType: [
        {
          type: 'zenith',
          count: 2,
          withStdResCount: 2,
          localFailCount: 0,
          over3SigmaCount: 0,
          maxStdRes: 1.11,
          meanRedundancy: 0.51,
          minRedundancy: 0.32,
        },
      ],
    } as any;
    result.robustDiagnostics = {
      enabled: true,
      mode: 'huber',
      k: 1.5,
      iterations: [
        {
          iteration: 1,
          downweightedRows: 2,
          meanWeight: 0.91,
          minWeight: 0.5,
          maxNorm: 2.7,
          maxWeightDelta: 0.21,
        },
      ],
      topDownweightedRows: [
        {
          obsId: 9,
          type: 'dist',
          stations: 'A-C',
          sourceLine: 5,
          weight: 0.5,
          norm: 2.7,
        },
      ],
    } as any;
    result.tsCorrelationDiagnostics = {
      enabled: true,
      scope: 'setup',
      rho: 0.25,
      groupCount: 1,
      equationCount: 4,
      pairCount: 2,
      maxGroupSize: 2,
      meanAbsOffDiagWeight: 0.00123,
      groups: [
        {
          key: 'setup-1',
          station: 'A',
          setId: 'SET1',
          rows: 2,
          pairCount: 1,
          meanAbsOffDiagWeight: 0.00123,
        },
      ],
    } as any;
    result.traverseDiagnostics = {
      closureCount: 1,
      misclosureE: 0.01,
      misclosureN: 0.02,
      misclosureMag: 0.02236,
      totalTraverseDistance: 120,
      closureRatio: 12000,
      linearPpm: 83.3,
      angularMisclosureArcSec: 4.2,
      verticalMisclosure: 0.003,
      thresholds: {
        minClosureRatio: 8000,
        maxLinearPpm: 150,
        maxAngularArcSec: 10,
        maxVerticalMisclosure: 0.01,
      },
      passes: {
        overall: false,
      },
      loops: [
        {
          key: 'TRAV-LOOP-1',
          misclosureMag: 0.02236,
          traverseDistance: 120,
          closureRatio: 12000,
          linearPpm: 83.3,
          angularMisclosureArcSec: 4.2,
          verticalMisclosure: 0.003,
          severity: 1.2,
          pass: false,
        },
      ],
    } as any;
    result.gpsLoopDiagnostics = {
      enabled: true,
      vectorCount: 3,
      loopCount: 1,
      passCount: 0,
      warnCount: 1,
      thresholds: {
        baseToleranceM: 0.01,
        ppmTolerance: 5,
      },
      loops: [
        {
          rank: 1,
          key: 'GPS-LOOP-1',
          stationPath: ['A', 'B', 'A'],
          closureMag: 0.025,
          toleranceM: 0.015,
          linearPpm: 12.3,
          closureRatio: 8000,
          severity: 1.8,
          pass: false,
          sourceLines: [10, 11],
        },
      ],
    } as any;
    result.levelingLoopDiagnostics = {
      enabled: true,
      observationCount: 4,
      loopCount: 1,
      passCount: 0,
      warnCount: 1,
      totalLengthKm: 0.4,
      warnTotalLengthKm: 0.4,
      worstClosure: 0.006,
      worstClosurePerSqrtKmMm: 8.5,
      worstLoopKey: 'LL-1-A',
      thresholds: {
        baseMm: 2,
        perSqrtKmMm: 4,
      },
      suspectSegments: [
        {
          rank: 1,
          key: 'A-B',
          from: 'A',
          to: 'B',
          sourceLine: 12,
          warnLoopCount: 1,
          suspectScore: 2.2,
          maxAbsDh: 0.004,
          worstLoopKey: 'LL-1-A',
        },
      ],
      loops: [
        {
          rank: 1,
          key: 'LL-1-A',
          stationPath: ['A', 'B', 'A'],
          closure: 0.006,
          absClosure: 0.006,
          loopLengthKm: 0.4,
          toleranceMm: 4.53,
          closurePerSqrtKmMm: 8.5,
          pass: false,
          sourceLines: [12, 13],
          segments: [
            {
              from: 'A',
              to: 'B',
              observedDh: 0.004,
              lengthKm: 0.2,
              sourceLine: 12,
              closureLeg: false,
            },
          ],
        },
      ],
    } as any;

    const html = renderReport(result);
    expect(html).toContain('Residual Diagnostics');
    expect(html).toContain('Robust Diagnostics');
    expect(html).toContain('TS Correlation Diagnostics');
    expect(html).toContain('Traverse Diagnostics');
    expect(html).toContain('GPS Loop Diagnostics');
    expect(html).toContain('Leveling Loop Diagnostics');
    expect(html).toContain('With StdRes');
    expect(html).toContain('Iterations');
    expect(html).toContain('Scope');
    expect(html).toContain('Closure Count');
    expect(html).toContain('Vectors');
    expect(html).toContain('Observations');
    expect(html).toContain('Show');
    expect(html).not.toContain('ZENITH');
    expect(html).not.toContain('Mean Weight');
    expect(html).not.toContain('setup-1');
    expect(html).not.toContain('A-&gt;B-&gt;A');
  });

  it('keeps ranked suspect summary cards visible while deferring loop suspect tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.traverseDiagnostics = {
      closureCount: 1,
      misclosureE: 0.01,
      misclosureN: 0.02,
      misclosureMag: 0.02236,
      totalTraverseDistance: 120,
      closureRatio: 12000,
      linearPpm: 83.3,
      angularMisclosureArcSec: 4.2,
      verticalMisclosure: 0.003,
      thresholds: {
        minClosureRatio: 8000,
        maxLinearPpm: 150,
        maxAngularArcSec: 10,
        maxVerticalMisclosure: 0.01,
      },
      passes: {
        overall: false,
      },
      loops: [
        {
          key: 'TRAV-LOOP-1',
          misclosureMag: 0.02236,
          traverseDistance: 120,
          closureRatio: 12000,
          linearPpm: 83.3,
          angularMisclosureArcSec: 4.2,
          verticalMisclosure: 0.003,
          severity: 1.2,
          pass: false,
        },
      ],
    } as any;
    result.gpsLoopDiagnostics = {
      enabled: true,
      vectorCount: 3,
      loopCount: 1,
      passCount: 0,
      warnCount: 1,
      thresholds: {
        baseToleranceM: 0.01,
        ppmTolerance: 5,
      },
      loops: [
        {
          rank: 1,
          key: 'GPS-LOOP-1',
          stationPath: ['A', 'B', 'A'],
          closureMag: 0.025,
          toleranceM: 0.015,
          linearPpm: 12.3,
          closureRatio: 8000,
          severity: 1.8,
          pass: false,
          sourceLines: [10, 11],
        },
      ],
    } as any;
    result.levelingLoopDiagnostics = {
      enabled: true,
      observationCount: 4,
      loopCount: 1,
      passCount: 0,
      warnCount: 1,
      totalLengthKm: 0.4,
      warnTotalLengthKm: 0.4,
      worstClosure: 0.006,
      worstClosurePerSqrtKmMm: 8.5,
      worstLoopKey: 'LL-1-A',
      thresholds: {
        baseMm: 2,
        perSqrtKmMm: 4,
      },
      suspectSegments: [
        {
          rank: 1,
          key: 'A-B',
          from: 'A',
          to: 'B',
          sourceLine: 12,
          warnLoopCount: 1,
          suspectScore: 2.2,
          maxAbsDh: 0.004,
          worstLoopKey: 'LL-1-A',
        },
      ],
      loops: [
        {
          rank: 1,
          key: 'LL-1-A',
          stationPath: ['A', 'B', 'A'],
          closure: 0.006,
          absClosure: 0.006,
          loopLengthKm: 0.4,
          toleranceMm: 4.53,
          closurePerSqrtKmMm: 8.5,
          pass: false,
          sourceLines: [12, 13],
          segments: [
            {
              from: 'A',
              to: 'B',
              observedDh: 0.004,
              lengthKm: 0.2,
              sourceLine: 12,
              closureLeg: false,
            },
          ],
        },
      ],
    } as any;

    const html = renderReport(result);
    expect(html).toContain('Traverse Closure Suspects');
    expect(html).toContain('GPS Loop Suspects (ranked)');
    expect(html).toContain('Leveling Loop Suspects (ranked)');
    expect(html).toContain('Leveling Segment Suspects');
    expect(html).toContain('Warn Loops');
    expect(html).toContain('Worst Ratio');
    expect(html).toContain('Worst Severity');
    expect(html).toContain('Suspect Segments');
    expect(html).toContain('Top Score');
    expect(html).toContain('Show');
    expect(html).not.toContain('Path</th>');
    expect(html).not.toContain('Segment</th>');
    expect(html).not.toContain('A-&gt;B-&gt;A');
  });

  it('keeps direction diagnostic summary cards visible while deferring direction detail tables by default', () => {
    const result = new LSAEngine({ input: baseInput, maxIterations: 8 }).solve();
    result.directionSetDiagnostics = [
      {
        setId: 'SET1',
        occupy: 'C',
        readingCount: 4,
        targetCount: 2,
        underconstrainedOrientation: true,
        rawCount: 4,
        reducedCount: 2,
        pairedTargets: 2,
        face1Count: 2,
        face2Count: 2,
        orientationDeg: 90,
        residualRmsArcSec: 1.25,
        residualMaxArcSec: 2.3,
        meanFacePairDeltaArcSec: 0.8,
        maxFacePairDeltaArcSec: 1.6,
        meanRawMaxResidualArcSec: 0.9,
        maxRawMaxResidualArcSec: 1.8,
        orientationSeArcSec: 0.7,
      },
    ] as any;
    result.directionTargetDiagnostics = [
      {
        setId: 'SET1',
        occupy: 'C',
        target: 'B',
        sourceLine: 7,
        rawCount: 2,
        face1Count: 1,
        face2Count: 1,
        rawSpreadArcSec: 2.4,
        rawMaxResidualArcSec: 1.7,
        facePairDeltaArcSec: 1.1,
        face1SpreadArcSec: 0.8,
        face2SpreadArcSec: 0.9,
        reducedSigmaArcSec: 1.2,
        residualArcSec: 0.7,
        stdRes: 2.1,
        localPass: false,
        mdbArcSec: 3.4,
        suspectScore: 4.6,
      },
    ] as any;
    result.parseState = {
      ...(result.parseState ?? {}),
      directionSetTreatmentDiagnostics: [
        {
          setId: 'SET1',
          occupy: 'C',
          sourceLine: 7,
          readingCount: 4,
          targetCount: 2,
          faceSource: 'unknown',
          treatmentDecision: 'reduced',
          policyOutcome: 'keep',
          faceNormalizationMode: 'paired',
        },
      ],
    } as any;
    result.directionRejectDiagnostics = [
      {
        setId: 'SET1',
        occupy: 'C',
        target: 'B',
        sourceLine: 8,
        recordType: 'DN',
        expectedFace: 'F1',
        actualFace: 'F2',
        faceSource: 'computed',
        treatmentDecision: 'reject',
        policyOutcome: 'drop',
        detail: 'face mismatch',
      },
    ] as any;
    result.directionRepeatabilityDiagnostics = [
      {
        occupy: 'C',
        target: 'B',
        setCount: 2,
        localFailCount: 1,
        faceUnbalancedSets: 1,
        residualMeanArcSec: 0.4,
        residualRmsArcSec: 0.7,
        residualRangeArcSec: 2.8,
        residualMaxArcSec: 1.9,
        stdResRms: 1.6,
        maxStdRes: 2.7,
        meanRawSpreadArcSec: 1.2,
        maxRawSpreadArcSec: 3.1,
        worstSetId: 'SET1',
        worstLine: 7,
        suspectScore: 5.1,
      },
    ] as any;

    const html = renderReport(result);
    expect(html).toContain('Direction Set Diagnostics');
    expect(html).toContain('Direction Target Repeatability (ranked)');
    expect(html).toContain('Direction Face Treatment Diagnostics');
    expect(html).toContain('Direction Reject Diagnostics');
    expect(html).toContain('Direction Target Suspects (top)');
    expect(html).toContain('Direction Repeatability By Occupy-Target (multi-set)');
    expect(html).toContain('Direction Repeatability Suspects (top)');
    expect(html).toContain('Underconstrained');
    expect(html).toContain('Unknown FaceSrc');
    expect(html).toContain('Top Reason');
    expect(html).toContain('Worst Max |t|');
    expect(html).toContain('Show');
    expect(html).not.toContain('Readings</th>');
    expect(html).not.toContain('FaceSrc</th>');
    expect(html).not.toContain('Expected</th>');
    expect(html).not.toContain('Res Mean (&quot;)</th>');
    expect(html).not.toContain('Stations</th>');
  });

  it('keeps robust-comparison and observation summary cards visible while deferring their detail tables by default', () => {
    const multiUnknownInput = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C C 60 80 0',
      'C D 140 90 0',
      'D A-C 100.0000 0.005',
      'D B-C 89.4427 0.005',
      'D A-D 166.4332 0.005',
      'D B-D 98.4886 0.005',
      'D C-D 80.6226 0.005',
    ].join('\n');
    const result = new LSAEngine({ input: multiUnknownInput, maxIterations: 8 }).solve();
    result.robustComparison = {
      enabled: true,
      overlapCount: 1,
      classicalTop: [
        {
          rank: 1,
          obsId: 1,
          type: 'dist',
          stations: 'A-C',
          sourceLine: 5,
          stdRes: 2.8,
          localFail: true,
        },
      ],
      robustTop: [
        {
          rank: 1,
          obsId: 2,
          type: 'angle',
          stations: 'C-A-B',
          sourceLine: 7,
          stdRes: 2.1,
          localFail: false,
        },
      ],
    } as any;

    const html = renderReport(result);
    expect(html).toContain('Robust vs Classical Suspects (Top 10)');
    expect(html).toContain('Per-Type Summary');
    expect(html).toContain('Relative Precision (Unknowns)');
    expect(html).toContain('Classical Top');
    expect(html).toContain('Robust Top');
    expect(html).toContain('Types');
    expect(html).toContain('Pairs');
    expect(html).toContain('Top Ellipse Az');
    expect(html).toContain('Show');
    expect(html).not.toContain('Overlap:');
    expect(html).not.toContain('Unit</th>');
    expect(html).not.toContain('σAz (&quot;)</th>');
  });
});
