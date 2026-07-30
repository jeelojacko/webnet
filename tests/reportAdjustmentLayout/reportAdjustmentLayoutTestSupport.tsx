/* eslint-disable react-refresh/only-export-components */

import { renderToStaticMarkup } from 'react-dom/server';
import ReportView from '../../src/components/ReportView';
import { LSAEngine } from '../../src/engine/adjust';
import type { ReportViewControls } from '../../src/hooks/useReportViewState';

export { renderToStaticMarkup, ReportView, LSAEngine };
export type { ReportViewControls };

export const baseInput = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C C 100 80 0',
  'D A-C 128.0624847 0.005',
  'D B-C 80.0000000 0.005',
  'A C-A-B 90-00-00 3',
].join('\n');

export const baseRunDiagnostics = {
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

export const createReportViewState = (
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

export const renderReport = (
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

