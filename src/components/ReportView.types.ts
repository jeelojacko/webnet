import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  CoordSystemDiagnosticCode,
  CrsOffReason,
  CrsStatus,
  DatumSufficiencyReport,
  DirectiveNoEffectWarning,
  DirectiveTransition,
  GnssVectorFrame,
  PrecisionReportingMode,
  ReductionUsageSummary,
  RunMode,
} from '../types';
import type { ReportViewControls } from '../hooks/useReportViewState';

export interface ReportViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  precisionReportingMode?: PrecisionReportingMode;
  viewState?: ReportViewControls;
  runDiagnostics: {
    solveProfile:
      | 'webnet'
      | 'industry-parity-current'
      | 'industry-parity-legacy'
      | 'legacy-compat'
      | 'industry-parity';
    runMode?: RunMode;
    parity: boolean;
    directionSetMode: 'reduced' | 'raw';
    mapMode: 'off' | 'on' | 'anglecalc';
    mapScaleFactor: number;
    normalize: boolean;
    faceNormalizationMode: 'on' | 'off' | 'auto';
    angleMode: 'auto' | 'angle' | 'dir';
    verticalReduction: 'none' | 'curvref';
    applyCurvatureRefraction: boolean;
    refractionCoefficient: number;
    tsCorrelationEnabled: boolean;
    tsCorrelationScope: 'setup' | 'set';
    tsCorrelationRho: number;
    robustMode: 'none' | 'huber';
    robustK: number;
    rotationAngleRad: number;
    crsGridScaleEnabled: boolean;
    crsGridScaleFactor: number;
    crsConvergenceEnabled: boolean;
    crsConvergenceAngleRad: number;
    geoidModelEnabled: boolean;
    geoidModelId: string;
    geoidInterpolation: 'bilinear' | 'nearest';
    geoidHeightConversionEnabled: boolean;
    geoidOutputHeightDatum: 'orthometric' | 'ellipsoid';
    geoidModelLoaded: boolean;
    geoidModelMetadata: string;
    geoidSampleUndulationM?: number;
    geoidConvertedStationCount: number;
    geoidSkippedStationCount: number;
    qFixLinearSigmaM: number;
    qFixAngularSigmaSec: number;
    profileDefaultInstrumentFallback: boolean;
    angleCenteringModel: 'geometry-aware-correlated-rays';
    coordSystemMode?: 'local' | 'grid';
    crsId?: string;
    localDatumScheme?: 'average-scale' | 'common-elevation';
    averageScaleFactor?: number;
    scaleOverrideActive?: boolean;
    commonElevation?: number;
    averageGeoidHeight?: number;
    gnssVectorFrameDefault?: GnssVectorFrame;
    gnssFrameConfirmed?: boolean;
    gridBearingMode?: 'measured' | 'grid';
    gridDistanceMode?: 'measured' | 'grid' | 'ellipsoidal';
    gridAngleMode?: 'measured' | 'grid';
    gridDirectionMode?: 'measured' | 'grid';
    parsedUsageSummary?: ReductionUsageSummary;
    usedInSolveUsageSummary?: ReductionUsageSummary;
    directiveTransitions?: DirectiveTransition[];
    directiveNoEffectWarnings?: DirectiveNoEffectWarning[];
    datumSufficiencyReport?: DatumSufficiencyReport;
    coordSystemDiagnostics?: CoordSystemDiagnosticCode[];
    coordSystemWarningMessages?: string[];
    crsStatus?: CrsStatus;
    crsOffReason?: CrsOffReason;
    defaultSigmaCount: number;
    defaultSigmaByType: string;
    stochasticDefaultsSummary: string;
  } | null;
  excludedIds: Set<number>;
  onToggleExclude: (_id: number) => void;
  onApplyImpactExclude: (_id: number) => void;
  onApplyPreanalysisAction: (_id: string) => void;
  onApplyAllPreanalysisActions?: (_ids: string[]) => void;
  onReRun: () => void;
  onClearExclusions: () => void;
  onJumpToSourceLine?: (_sourceLine: number) => void;
  pendingRunSettingDiffs?: string[];
  overrides: Record<number, { obs?: number | { dE: number; dN: number }; stdDev?: number }>;
  onOverride: (
    _id: number,
    _payload: { obs?: number | { dE: number; dN: number }; stdDev?: number },
  ) => void;
  onResetOverrides: () => void;
  clusterReviewDecisions: Record<
    string,
    { status: 'pending' | 'approve' | 'reject'; canonicalId: string }
  >;
  activeClusterApprovedMerges: ClusterApprovedMerge[];
  onClusterDecisionStatus: (_clusterKey: string, _status: 'pending' | 'approve' | 'reject') => void;
  onClusterCanonicalSelection: (_clusterKey: string, _canonicalId: string) => void;
  onApplyClusterMerges: () => void;
  onResetClusterReview: () => void;
  onClearClusterMerges: () => void;
  selectedStationId?: string | null;
  selectedObservationId?: number | null;
  onSelectStation?: (_stationId: string) => void;
  onSelectObservation?: (_observationId: number) => void;
  focusFilterRequestKey?: number;
}
