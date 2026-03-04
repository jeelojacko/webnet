import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import type { AdjustmentResult, ClusterApprovedMerge, GpsObservation, Observation } from '../types';
import { RAD_TO_DEG, radToDmsStr } from '../engine/angles';
import { isLockedPreanalysisObservation } from '../engine/preanalysis';

const FT_PER_M = 3.280839895;

const PREANALYSIS_LABEL_TOOLTIPS: Record<string, string> = {
  'Preanalysis Planning Summary':
    'Overview of predicted precision for the current planned network. Values are derived from approximate geometry with sigma0^2 fixed to 1.0.',
  'Planned Observations':
    'Total planned observations in this preanalysis run, including removable and locked planned rows.',
  'Removable Planned':
    'Planned observations that can participate in what-if remove/add-back trials.',
  'Locked Planned':
    'Planned observations held with fixed sigma weighting. They are shown for context only and are not removable from the what-if workflow.',
  'Station Covariance Blocks':
    'Count of station covariance matrices available in the predicted-precision output.',
  'Connected Pair Blocks':
    'Count of connected-pair relative covariance and precision blocks available in the predicted-precision output.',
  'Weak Stations': 'Number of stations currently flagged by the weak-geometry heuristics.',
  'Weak Pairs': 'Number of connected pairs currently flagged by the weak-geometry heuristics.',
  'Locked Planned Observations':
    'Planned observations using fixed sigma weighting. They are excluded from what-if removal actions.',
  'Planned Observation What-If Analysis':
    'Re-solved planning scenarios showing how predicted precision changes when each removable planned observation is removed or added back.',
  'Active Removable': 'Removable planned observations currently active in the preanalysis design.',
  'Excluded Removable':
    'Removable planned observations currently excluded from the preanalysis design and available to add back.',
  'Worst Station Major':
    'Largest station error-ellipse semi-major axis in the current preanalysis result.',
  'Worst Pair SigmaDist':
    'Largest predicted inter-point distance standard deviation among connected pairs in the current preanalysis result.',
  'Station Covariance Blocks Section':
    'Predicted coordinate covariance matrix entries for each station reported by the preanalysis run.',
  'Predicted Relative Precision (Connected Pairs)':
    'Predicted relative precision and covariance values for connected station pairs only.',
  'Weak Geometry Cues':
    'Heuristic warnings for stations or connected pairs whose predicted precision is weak relative to the rest of the planned network.',
  'Median Station Major':
    'Median station error-ellipse semi-major axis used as the weak-geometry comparison baseline.',
  'Median Pair SigmaDist':
    'Median connected-pair distance standard deviation used as the weak-geometry comparison baseline.',
  'Station Flags': 'Number of station-level weak-geometry cues with severity watch or weak.',
  'Pair Flags': 'Number of pair-level weak-geometry cues with severity watch or weak.',
};

const REPORT_STATIC_TOOLTIPS: Record<string, string> = {
  'Adjustment Summary':
    'High-level run summary showing convergence status, global precision statistics, and observation-family counts.',
  STATUS:
    'Overall solve outcome for the current run. Converged means the iterative correction process satisfied the stopping criteria.',
  'OBSERVATION BREAKDOWN': 'Count of observations by family included in the current result set.',
  'Solve Profile Diagnostics':
    'Pinned run-profile settings that affected weighting, reductions, CRS behavior, and stochastic modeling for this solve.',
  Profile:
    'Selected solve profile used for this run, such as WebNet defaults or industry-parity behavior.',
  'Direction Sets': 'Direction-set processing mode used for the solve: reduced or raw.',
  'Profile Fallback':
    'Whether the industry-parity profile fallback behavior for default instruments was active.',
  'Angle Centering':
    'Angular centering model used when inflating angle precision from centering uncertainties.',
  'TS Correlation':
    'Whether TS angular correlation modeling was enabled, and if so which scope and rho were used.',
  Robust: 'Robust adjustment mode active for the solve, if any.',
  'Map / Scale': 'Map-mode setting and associated map-scale factor used for horizontal reductions.',
  'Vertical / CurvRef':
    'Vertical reduction mode and whether curvature/refraction corrections were enabled.',
  Normalize: 'Whether mixed-face direction/traverse observations were normalized before solving.',
  'A-Mode': 'Interpretation mode for A records during parsing and solve row construction.',
  'Plan Rotation': 'Cumulative plan rotation applied to azimuth-bearing style observations.',
  'CRS / Projection': 'CRS transform state and projection model used for geodetic positions.',
  'CRS Grid Scale': 'Whether CRS grid-ground scale correction was enabled and the factor used.',
  'CRS Convergence':
    'Whether CRS convergence correction was enabled and the convergence angle used.',
  'Geoid/Grid Model':
    'Geoid/grid-model enablement state, selected model, and interpolation method.',
  'Geoid Height Conversion':
    'Whether geoid-based height conversion was enabled and how many stations were converted or skipped.',
  'QFIX (Linear/Angular)':
    'Configured fixed sigma constants used when observation sigma tokens are marked fixed.',
  'Geoid Metadata':
    'Metadata string reported by the active geoid/grid model, plus any sample undulation details.',
  'Lost Stations':
    'Stations tagged by .LOSTSTATIONS and whether they are present in the current run metadata.',
  'Description Reconciliation':
    'Policy used to handle repeated station descriptions across input records.',
  'Default Sigmas':
    'Count of observations that used default stochastic values rather than explicit or fixed sigmas.',
  'Stochastic Defaults':
    'Summary of the active default instrument and stochastic-model values used for weighting.',
};

interface ReportViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  runDiagnostics: {
    solveProfile: 'webnet' | 'industry-parity';
    parity: boolean;
    directionSetMode: 'reduced' | 'raw';
    mapMode: 'off' | 'on' | 'anglecalc';
    mapScaleFactor: number;
    normalize: boolean;
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
    crsTransformEnabled: boolean;
    crsProjectionModel: 'legacy-equirectangular' | 'local-enu';
    crsLabel: string;
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
    defaultSigmaCount: number;
    defaultSigmaByType: string;
    stochasticDefaultsSummary: string;
  } | null;
  excludedIds: Set<number>;
  onToggleExclude: (_id: number) => void;
  onApplyImpactExclude: (_id: number) => void;
  onApplyPreanalysisAction: (_id: number) => void;
  onReRun: () => void;
  onClearExclusions: () => void;
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
}

type SortedObservation = Observation & { originalIndex: number };

const ReportView: React.FC<ReportViewProps> = ({
  result,
  units,
  runDiagnostics,
  excludedIds,
  onToggleExclude,
  onApplyImpactExclude,
  onApplyPreanalysisAction,
  onReRun,
  onClearExclusions,
  overrides: _overrides,
  onOverride,
  onResetOverrides,
  clusterReviewDecisions,
  activeClusterApprovedMerges,
  onClusterDecisionStatus,
  onClusterCanonicalSelection,
  onApplyClusterMerges,
  onResetClusterReview,
  onClearClusterMerges,
}) => {
  const reportRootRef = useRef<HTMLDivElement | null>(null);
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const ellipseUnit = units === 'm' ? 'cm' : 'in';
  const ellipseScale = units === 'm' ? 100 : 12;
  const covarianceScale = unitScale * unitScale;
  const isPreanalysis = result.preanalysisMode === true;
  const [ellipseMode, setEllipseMode] = useState<'1sigma' | '95'>('1sigma');
  const ellipseConfidenceScale = ellipseMode === '95' ? 2.4477 : 1;

  const sortedObs = useMemo<SortedObservation[]>(
    () =>
      [...result.observations]
        .map((obs, index) => ({ ...obs, originalIndex: index }))
        .sort((a, b) => Math.abs(b.stdRes || 0) - Math.abs(a.stdRes || 0)),
    [result.observations],
  );
  const observationsByType = useMemo(() => {
    const byTypeMap = new Map<Observation['type'], SortedObservation[]>();
    sortedObs.forEach((obs) => {
      const list = byTypeMap.get(obs.type) ?? [];
      list.push(obs);
      byTypeMap.set(obs.type, list);
    });
    return byTypeMap;
  }, [sortedObs]);
  const byType = (type: Observation['type']): SortedObservation[] =>
    observationsByType.get(type) ?? [];

  const analysis = useMemo(
    () => sortedObs.filter((obs) => Math.abs(obs.stdRes || 0) > 2),
    [sortedObs],
  );
  const topSuspects = useMemo(
    () =>
      sortedObs
        .filter(
          (obs) => (obs.localTest != null && !obs.localTest.pass) || Math.abs(obs.stdRes || 0) >= 2,
        )
        .slice(0, 20),
    [sortedObs],
  );
  const topDirectionTargetSuspects = useMemo(
    () =>
      [...(result.directionTargetDiagnostics ?? [])]
        .filter(
          (d) => d.localPass === false || (d.stdRes ?? 0) >= 2 || (d.rawSpreadArcSec ?? 0) >= 5,
        )
        .slice(0, 20),
    [result.directionTargetDiagnostics],
  );
  const topDirectionRepeatabilitySuspects = useMemo(
    () =>
      [...(result.directionRepeatabilityDiagnostics ?? [])]
        .filter(
          (d) =>
            d.localFailCount > 0 || (d.maxStdRes ?? 0) >= 2 || (d.maxRawSpreadArcSec ?? 0) >= 5,
        )
        .slice(0, 20),
    [result.directionRepeatabilityDiagnostics],
  );
  const setupSuspects = useMemo(
    () =>
      [...(result.setupDiagnostics ?? [])]
        .filter((s) => s.localFailCount > 0 || (s.maxStdRes ?? 0) >= 2)
        .sort((a, b) => {
          if (b.localFailCount !== a.localFailCount) return b.localFailCount - a.localFailCount;
          const bMax = b.maxStdRes ?? 0;
          const aMax = a.maxStdRes ?? 0;
          if (bMax !== aMax) return bMax - aMax;
          const bRms = b.rmsStdRes ?? 0;
          const aRms = a.rmsStdRes ?? 0;
          if (bRms !== aRms) return bRms - aRms;
          return a.station.localeCompare(b.station);
        })
        .slice(0, 20),
    [result.setupDiagnostics],
  );
  const traverseLoops = result.traverseDiagnostics?.loops ?? [];
  const traverseLoopSuspects = traverseLoops
    .filter(
      (l) =>
        !l.pass ||
        (l.linearPpm ?? 0) > (result.traverseDiagnostics?.thresholds?.maxLinearPpm ?? 0) * 0.8,
    )
    .slice(0, 20);
  const gpsLoopDiagnostics = result.gpsLoopDiagnostics;
  const gpsLoopSuspects = useMemo(
    () =>
      (gpsLoopDiagnostics?.loops ?? [])
        .filter((loop) => !loop.pass)
        .slice(0, 20),
    [gpsLoopDiagnostics],
  );
  const levelingLoopDiagnostics = result.levelingLoopDiagnostics;
  const levelingLoopSuspects = useMemo(
    () =>
      (levelingLoopDiagnostics?.loops ?? [])
        .filter((loop) => !loop.pass)
        .slice(0, 20),
    [levelingLoopDiagnostics],
  );
  const levelingSegmentSuspects = useMemo(
    () => (levelingLoopDiagnostics?.suspectSegments ?? []).slice(0, 10),
    [levelingLoopDiagnostics],
  );
  const highlightedLevelingSegmentLines = useMemo(
    () =>
      new Set(
        levelingSegmentSuspects
          .map((segment) => segment.sourceLine)
          .filter((line): line is number => line != null),
      ),
    [levelingSegmentSuspects],
  );
  const directionRejects = useMemo(
    () =>
      [...(result.directionRejectDiagnostics ?? [])].sort((a, b) => {
        const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
        const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
        if (la !== lb) return la - lb;
        const sa = a.setId ?? '';
        const sb = b.setId ?? '';
        return sa.localeCompare(sb);
      }),
    [result.directionRejectDiagnostics],
  );
  const aliasTrace = useMemo(
    () =>
      [...(result.parseState?.aliasTrace ?? [])].sort((a, b) => {
        const la = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
        const lb = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
        if (la !== lb) return la - lb;
        const ca = a.context ?? '';
        const cb = b.context ?? '';
        if (ca !== cb) return ca.localeCompare(cb);
        return a.sourceId.localeCompare(b.sourceId);
      }),
    [result.parseState?.aliasTrace],
  );
  const descriptionTrace = useMemo(
    () =>
      [...(result.parseState?.descriptionTrace ?? [])].sort((a, b) => {
        if (a.sourceLine !== b.sourceLine) return a.sourceLine - b.sourceLine;
        return a.stationId.localeCompare(b.stationId, undefined, { numeric: true });
      }),
    [result.parseState?.descriptionTrace],
  );
  const descriptionScanSummary = useMemo(
    () =>
      [...(result.parseState?.descriptionScanSummary ?? [])].sort((a, b) =>
        a.stationId.localeCompare(b.stationId, undefined, { numeric: true }),
      ),
    [result.parseState?.descriptionScanSummary],
  );
  const descriptionConflicts = useMemo(
    () => descriptionScanSummary.filter((row) => row.conflict),
    [descriptionScanSummary],
  );
  const descriptionRefsByStation = useMemo(
    () =>
      descriptionTrace.reduce<Map<string, { key: string; description: string; lines: number[] }[]>>(
        (acc, entry) => {
          const key = entry.stationId;
          const rows = acc.get(key) ?? [];
          const normalized = entry.description.replace(/\s+/g, ' ').trim().toUpperCase();
          const existing = rows.find((row) => row.key === normalized);
          if (existing) {
            if (!existing.lines.includes(entry.sourceLine)) existing.lines.push(entry.sourceLine);
          } else {
            rows.push({ key: normalized, description: entry.description, lines: [entry.sourceLine] });
          }
          acc.set(key, rows);
          return acc;
        },
        new Map(),
      ),
    [descriptionTrace],
  );
  const clusterDiagnostics = result.clusterDiagnostics;
  const clusterCandidates = useMemo(
    () => clusterDiagnostics?.candidates ?? [],
    [clusterDiagnostics],
  );
  const clusterAppliedMerges =
    clusterDiagnostics?.appliedMerges && clusterDiagnostics.appliedMerges.length > 0
      ? clusterDiagnostics.appliedMerges
      : activeClusterApprovedMerges;
  const clusterMergeOutcomes = clusterDiagnostics?.mergeOutcomes ?? [];
  const clusterRejectedProposals = clusterDiagnostics?.rejectedProposals ?? [];
  const autoAdjustDiagnostics = result.autoAdjustDiagnostics;
  const autoSideshotDiagnostics = result.autoSideshotDiagnostics;
  const autoSideshotObsIds = useMemo(
    () =>
      new Set(autoSideshotDiagnostics?.candidates.flatMap((c) => [c.angleObsId, c.distObsId]) ?? []),
    [autoSideshotDiagnostics],
  );
  const tsSideshots = useMemo(
    () => (result.sideshots ?? []).filter((s) => s.mode !== 'gps'),
    [result.sideshots],
  );
  const gpsSideshots = useMemo(
    () => (result.sideshots ?? []).filter((s) => s.mode === 'gps'),
    [result.sideshots],
  );
  const gpsOffsetObservations = useMemo(
    () =>
      result.observations.filter(
        (obs): obs is GpsObservation => obs.type === 'gps' && obs.gpsOffsetDistanceM != null,
      ),
    [result.observations],
  );
  const lostStationIds = useMemo(
    () =>
      [...(result.parseState?.lostStationIds ?? [])].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [result.parseState?.lostStationIds],
  );
  const descriptionReconcileMode = result.parseState?.descriptionReconcileMode ?? 'first';
  const descriptionAppendDelimiter = result.parseState?.descriptionAppendDelimiter ?? ' | ';
  const reconciledDescriptions = result.parseState?.reconciledDescriptions ?? {};
  const stationDescription = (stationId: string): string =>
    reconciledDescriptions[stationId] ?? '-';
  const stationCovariances = result.stationCovariances ?? [];
  const relativeCovariances = result.relativeCovariances ?? [];
  const weakGeometryDiagnostics = result.weakGeometryDiagnostics;
  const preanalysisImpactDiagnostics = result.preanalysisImpactDiagnostics;
  const lockedPreanalysisObservations = useMemo(
    () => (isPreanalysis ? result.observations.filter(isLockedPreanalysisObservation) : []),
    [isPreanalysis, result.observations],
  );
  const flaggedStationCues = useMemo(
    () => (weakGeometryDiagnostics?.stationCues ?? []).filter((cue) => cue.severity !== 'ok'),
    [weakGeometryDiagnostics],
  );
  const flaggedRelativeCues = useMemo(
    () => (weakGeometryDiagnostics?.relativeCues ?? []).filter((cue) => cue.severity !== 'ok'),
    [weakGeometryDiagnostics],
  );
  const clusterReviewStats = useMemo(
    () =>
      clusterCandidates.reduce(
        (acc, candidate) => {
          const decision = clusterReviewDecisions[candidate.key];
          const status = decision?.status ?? 'pending';
          const canonicalId =
            decision && candidate.stationIds.includes(decision.canonicalId)
              ? decision.canonicalId
              : candidate.representativeId;
          if (status === 'approve') {
            acc.approved += 1;
            acc.plannedMerges += candidate.stationIds.filter((id) => id !== canonicalId).length;
          } else if (status === 'reject') {
            acc.rejected += 1;
          } else {
            acc.pending += 1;
          }
          return acc;
        },
        { approved: 0, rejected: 0, pending: 0, plannedMerges: 0 },
      ),
    [clusterCandidates, clusterReviewDecisions],
  );
  const isAngularType = (type: Observation['type']) =>
    type === 'angle' ||
    type === 'direction' ||
    type === 'bearing' ||
    type === 'dir' ||
    type === 'zenith';
  const prismAnnotation = (obs: Observation): string => {
    if (obs.type !== 'dist' && obs.type !== 'zenith') return '';
    const correction = obs.prismCorrectionM ?? 0;
    if (!Number.isFinite(correction) || Math.abs(correction) <= 0) return '';
    const sign = correction >= 0 ? '+' : '';
    const scope = obs.prismScope ?? 'global';
    return ` [PRISM ${scope} ${sign}${(correction * unitScale).toFixed(4)}${units}]`;
  };
  const formatMdb = (value: number, angular: boolean): string => {
    if (!Number.isFinite(value)) return 'inf';
    return angular ? `${(value * RAD_TO_DEG * 3600).toFixed(2)}"` : (value * unitScale).toFixed(4);
  };
  const formatEffectiveDistance = (value?: number): string => {
    if (value == null || !Number.isFinite(value) || value <= 0) return '-';
    return (value * unitScale).toFixed(4);
  };
  const preanalysisLabelTooltip = (label: string): string | undefined =>
    PREANALYSIS_LABEL_TOOLTIPS[label];
  const observationStationsLabel = (obs: Observation): string => {
    if (obs.type === 'angle') return `${obs.at}-${obs.from}-${obs.to}`;
    if (obs.type === 'direction') return `${obs.at}-${obs.to} (${obs.setId})`;
    if (
      obs.type === 'dist' ||
      obs.type === 'gps' ||
      obs.type === 'lev' ||
      obs.type === 'bearing' ||
      obs.type === 'dir' ||
      obs.type === 'zenith'
    ) {
      return `${obs.from}-${obs.to}`;
    }
    return '-';
  };
  const observationValueLabel = (obs: Observation): string => {
    if (
      obs.type === 'angle' ||
      obs.type === 'direction' ||
      obs.type === 'bearing' ||
      obs.type === 'dir' ||
      obs.type === 'zenith'
    ) {
      return radToDmsStr(obs.obs);
    }
    if (obs.type === 'dist' || obs.type === 'lev') return (obs.obs * unitScale).toFixed(4);
    if (obs.type === 'gps') {
      return `dE=${(obs.obs.dE * unitScale).toFixed(4)}, dN=${(obs.obs.dN * unitScale).toFixed(4)}`;
    }
    return '-';
  };
  const fixedSigmaLabel = (obs: Observation): string => {
    if (
      obs.type === 'angle' ||
      obs.type === 'direction' ||
      obs.type === 'bearing' ||
      obs.type === 'dir' ||
      obs.type === 'zenith'
    ) {
      return `${(obs.stdDev * RAD_TO_DEG * 3600).toExponential(3)}"`;
    }
    if (obs.type === 'gps') {
      const sigmaE = obs.stdDevE ?? obs.stdDev;
      const sigmaN = obs.stdDevN ?? obs.stdDev;
      return `E=${(sigmaE * unitScale).toExponential(3)}, N=${(sigmaN * unitScale).toExponential(3)}`;
    }
    return `${(obs.stdDev * unitScale).toExponential(3)} ${units}`;
  };
  const renderSideshotSection = (
    title: string,
    rows: NonNullable<AdjustmentResult['sideshots']>,
  ) => {
    if (rows.length === 0) return null;
    return (
      <div className="mb-8 border border-slate-800 rounded overflow-hidden">
        <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
          {title}
        </div>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800">
                <th className="py-2 px-3 font-semibold">From</th>
                <th className="py-2 px-3 font-semibold">To</th>
                <th className="py-2 px-3 font-semibold text-right">Line</th>
                <th className="py-2 px-3 font-semibold text-right">Mode</th>
                <th className="py-2 px-3 font-semibold text-right">Az</th>
                <th className="py-2 px-3 font-semibold text-right">Az Src</th>
                <th className="py-2 px-3 font-semibold text-right">HD ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">Northing ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">Easting ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">Height ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">σN ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">σE ({units})</th>
                <th className="py-2 px-3 font-semibold text-right">σH ({units})</th>
                <th className="py-2 px-3 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {rows.map((s) => (
                <tr key={s.id} className="border-b border-slate-800/50">
                  <td className="py-1 px-3">{s.from}</td>
                  <td className="py-1 px-3">{s.to}</td>
                  <td className="py-1 px-3 text-right">{s.sourceLine ?? '-'}</td>
                  <td className="py-1 px-3 text-right">{s.mode}</td>
                  <td className="py-1 px-3 text-right">
                    {s.azimuth != null ? radToDmsStr(s.azimuth) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">{s.azimuthSource ?? '-'}</td>
                  <td className="py-1 px-3 text-right">
                    {(s.horizDistance * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.deltaH != null ? (s.deltaH * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.northing != null ? (s.northing * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.easting != null ? (s.easting * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.height != null ? (s.height * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.sigmaN != null ? (s.sigmaN * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.sigmaE != null ? (s.sigmaE * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {s.sigmaH != null ? (s.sigmaH * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-slate-500">{s.note ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const headerTooltip = (rawLabel: string): string | undefined => {
    const label = rawLabel.replace(/\s+/g, ' ').trim();
    const clean = label.replace(/\([^)]*\)/g, '').trim();
    const upper = clean.toUpperCase();
    if (!clean) return undefined;

    const tips: Record<string, string> = {
      '#': 'Ranking index within this table.',
      USE: 'Toggle observation inclusion in the next adjustment run.',
      TYPE: 'Observation or diagnostic record type.',
      STATIONS: 'Station IDs used by this observation or diagnostic row.',
      LOOP: 'Traverse closure loop identifier (from->to closure leg).',
      LINE: 'Original source line number from the input data file.',
      OBS: 'Observed value from input data (converted to display units).',
      CALC: 'Computed value from adjusted coordinates and model.',
      RESIDUAL: 'Observed minus computed value (v).',
      EFFDIST: 'Effective distance used as angular geometry context for this residual row.',
      STDRES: 'Standardized residual: residual scaled by its uncertainty.',
      REDUND:
        'Redundancy number (checkability); higher generally means better blunder detectability.',
      LOCAL: 'Local statistical test result for blunder detection (PASS/FAIL).',
      MDB: 'Minimal Detectable Bias for this observation at the configured local-test level.',
      ACTION: 'Quick action available for this row.',
      APPLY: 'Apply the listed remove/add-back scenario and re-run preanalysis.',
      RAW: 'Number of raw shots contributing to a reduced direction/target estimate.',
      REC: 'Record code that triggered this diagnostic/rejection (for example DN/DM).',
      EXPECTED: 'Expected face/order based on prior accepted shots in the set.',
      ACTUAL: 'Observed face/order for the rejected shot.',
      REASON: 'Structured reason why this row was rejected or flagged.',
      REDUCED: 'Number of reduced observations after face/set reduction.',
      PAIRS: 'Count of targets observed in both face 1 and face 2.',
      F1: 'Count of face-1 observations.',
      F2: 'Count of face-2 observations.',
      SET: 'Direction/traverse set identifier.',
      SCOPE: 'Correlation grouping scope used for TS angular covariance blocks.',
      RHO: 'Common correlation coefficient used in TS angular correlation groups.',
      GROUPS: 'Number of TS correlation groups formed from angular equations.',
      EQUATIONS: 'Number of angular equations participating in TS correlation groups.',
      KEY: 'Internal TS correlation group key (setup and optionally set/type).',
      ROWS: 'Number of equations inside this TS correlation group.',
      ITER: 'Adjustment iteration number.',
      DOWNWEIGHTED: 'Number of rows that received robust downweighting (weight < 1).',
      OCCUPY: 'Instrument setup station where observations were made.',
      WEIGHT: 'Robust weight applied to this equation row (1=no downweighting).',
      NORM: 'Normalized residual magnitude |v/sigma| used for robust weighting.',
      TARGET: 'Observed foresight/target station.',
      SCORE: 'Ranking score used to prioritize likely suspect rows.',
      STATUS: 'Pass/warn classification against configured closure thresholds.',
      SEVERITY: 'Relative closure-risk score used to rank suspect loops.',
      SETS: 'Number of repeated sets contributing to trend diagnostics.',
      SETUP: 'Instrument setup station summary row.',
      WITH: 'Count of rows where the listed statistic is available/computed.',
      ANGLES: 'Count of turned-angle observations from this setup.',
      DIST: 'Count of distance observations from this setup.',
      ZEN: 'Count of zenith/vertical-angle observations from this setup.',
      LEV: 'Count of leveling observations from this setup.',
      GPS: 'Count of GNSS vector observations from this setup.',
      FROM: 'Start station for the row.',
      TO: 'End station for the row.',
      MODE: 'Observation reduction/interpretation mode used for this row.',
      AZ: 'Azimuth/bearing direction value.',
      STN: 'Station identifier.',
      NORTHING: 'Adjusted northing coordinate.',
      EASTING: 'Adjusted easting coordinate.',
      HEIGHT: 'Adjusted elevation/height coordinate.',
      UNIT: 'Display unit used for the corresponding metric.',
    };

    if (tips[upper]) return tips[upper];
    if (upper.startsWith('STDDEV'))
      return 'Editable standard deviation (weight) override for this observation.';
    if (upper.startsWith('BASE |T|'))
      return 'Original standardized residual before what-if exclusion.';
    if (upper.startsWith('DSEUW'))
      return 'Change in SEUW when this suspect is excluded (negative is generally better).';
    if (upper.startsWith('MAX GROUP')) return 'Largest TS correlation group size (equation count).';
    if (upper.startsWith('PAIR COUNT'))
      return 'Number of off-diagonal correlated equation pairs in this group.';
    if (upper.startsWith('MEAN|OFFDIAGW|'))
      return 'Mean absolute off-diagonal weight magnitude across TS correlation pairs.';
    if (upper.startsWith('MEAN|W'))
      return 'Mean absolute off-diagonal correlation weight inside this group.';
    if (upper.startsWith('LINEAR'))
      return 'Linear closure misclosure expressed in parts per million.';
    if (upper.startsWith('ANG MISCL')) return 'Angular closure misclosure in arcseconds.';
    if (upper.startsWith('VERT MISCL')) return 'Vertical closure misclosure in linear units.';
    if (upper.startsWith('MEAN WEIGHT')) return 'Average robust weight for the iteration.';
    if (upper.startsWith('MIN WEIGHT'))
      return 'Minimum robust weight in the iteration (smaller indicates stronger downweighting).';
    if (upper.startsWith('MAX |V/SIGMA|'))
      return 'Maximum normalized residual magnitude used by robust weighting.';
    if (upper.startsWith('DMAX|T|'))
      return 'Change in maximum absolute standardized residual after exclusion.';
    if (upper.startsWith('CHI')) return 'Chi-square model test change after what-if exclusion.';
    if (upper.startsWith('MAX SHIFT'))
      return 'Maximum coordinate shift among unknown points under what-if exclusion.';
    if (upper.startsWith('ORIENT')) return 'Direction-set orientation parameter quality/statistic.';
    if (upper.includes('RAWMAX'))
      return 'Maximum absolute raw-shot residual from the reduced target mean.';
    if (upper.includes('PAIRDELTA'))
      return 'Absolute difference between face-1 and face-2 reduced means.';
    if (upper.startsWith('F1SPREAD')) return 'Within-face repeatability spread for face-1 shots.';
    if (upper.startsWith('F2SPREAD')) return 'Within-face repeatability spread for face-2 shots.';
    if (upper.startsWith('RMS')) return 'Root-mean-square statistic for the listed metric.';
    if (upper.startsWith('MAX |T|'))
      return 'Maximum absolute standardized residual in this summary row.';
    if (upper.startsWith('MAX')) return 'Maximum absolute value for the listed metric.';
    if (upper.startsWith('SPREAD'))
      return 'Within-target shot spread (repeatability) expressed in arcseconds.';
    if (upper.startsWith('RES MEAN'))
      return 'Mean residual across repeated sets for this occupy-target pair.';
    if (upper.startsWith('RES RMS'))
      return 'RMS residual across repeated sets for this occupy-target pair.';
    if (upper.startsWith('RES RANGE')) return 'Range (max-min) of residuals across repeated sets.';
    if (upper.startsWith('RES MAX')) return 'Maximum absolute residual across repeated sets.';
    if (upper.startsWith('FACE UNBAL'))
      return 'Number of sets with face-count imbalance (F1 vs F2).';
    if (upper.startsWith('LOCAL FAIL'))
      return 'Count of failed local statistical tests in this summary row.';
    if (upper.startsWith('MEAN REDUND'))
      return 'Mean redundancy number (lower means weaker detectability).';
    if (upper.startsWith('MIN REDUND')) return 'Minimum redundancy number in this summary row.';
    if (upper.startsWith('WITH STDRES'))
      return 'Count of observations with computed standardized residuals.';
    if (upper.startsWith('WORST SET'))
      return 'Set ID containing the worst contributing metric in this trend row.';
    if (upper.startsWith('WORST OBS'))
      return 'Observation type/stations with worst standardized residual for this setup.';
    if (upper.startsWith('DIR SETS')) return 'Number of direction sets associated with this setup.';
    if (upper.startsWith('DIR OBS'))
      return 'Number of reduced direction observations from this setup.';
    if (upper.startsWith('TRAV DIST')) return 'Total traverse distance observed from this setup.';
    if (upper.startsWith('AZ SRC'))
      return 'Source used to derive sideshot azimuth (target, explicit, setup-based, or GPS vector).';
    if (upper.startsWith('HD')) return 'Horizontal distance component.';
    if (upper.startsWith('DH')) return 'Height difference component.';
    if (upper.startsWith('ΣN')) return 'Estimated standard deviation in northing.';
    if (upper.startsWith('ΣE')) return 'Estimated standard deviation in easting.';
    if (upper.startsWith('ΣH')) return 'Estimated standard deviation in height.';
    if (upper.startsWith('ELLIPSE')) return 'Error ellipse axes in display units (major, minor).';
    if (upper.startsWith('AZ '))
      return 'Azimuth of the listed ellipse or bearing statistic in degrees.';
    if (upper.startsWith('COUNT'))
      return 'Number of observations included in this type summary row.';
    if (upper === 'CEE') return 'Covariance of the easting component with itself.';
    if (upper === 'CEN') return 'Covariance between easting and northing components.';
    if (upper === 'CNN') return 'Covariance of the northing component with itself.';
    if (upper === 'CHH') return 'Covariance of the height component with itself.';
    if (upper.startsWith('FIXED SIGMA'))
      return 'Configured fixed standard deviation applied to this locked planned observation.';
    if (upper.startsWith('DWORSTMAJ'))
      return 'Change in the worst station semi-major axis under this what-if scenario.';
    if (upper.startsWith('DMEDIANMAJ'))
      return 'Change in the median station semi-major axis under this what-if scenario.';
    if (upper.startsWith('DWORSTPAIR'))
      return 'Change in the worst connected-pair distance standard deviation under this what-if scenario.';
    if (upper.startsWith('DWEAKSTN'))
      return 'Change in the number of weak station cues under this what-if scenario.';
    if (upper.startsWith('DWEAKPAIR'))
      return 'Change in the number of weak pair cues under this what-if scenario.';
    if (upper.startsWith('METRIC'))
      return 'Primary weak-geometry metric: station ellipse major axis or pair distance standard deviation.';
    if (upper.startsWith('MEDIAN RATIO'))
      return 'Ratio between the listed metric and the median metric for the same cue family.';
    if (upper.startsWith('SHAPE RATIO'))
      return 'Ellipse major/minor ratio when shape information is available.';
    if (upper.startsWith('MAX |RES|'))
      return 'Maximum absolute residual for this observation type.';
    if (upper.startsWith('MAX |STDRES|'))
      return 'Maximum absolute standardized residual for this observation type.';
    if (upper.startsWith('>3Σ')) return 'Count of rows with |StdRes| > 3.';
    if (upper.startsWith('>4Σ')) return 'Count of rows with |StdRes| > 4.';
    if (upper.startsWith('ΣDIST')) return 'Estimated standard deviation of inter-point distance.';
    if (upper.startsWith('ΣAZ')) return 'Estimated standard deviation of inter-point azimuth.';
    if (upper.startsWith('NOTE')) return 'Additional notes, warnings, or limitations for this row.';
    if (upper.startsWith('TAG'))
      return 'Annotation tag for derived diagnostics, such as AUTO-SS and prism-correction markers.';
    return undefined;
  };

  useEffect(() => {
    const root = reportRootRef.current;
    if (!root) return;
    const headers = root.querySelectorAll('th');
    headers.forEach((th) => {
      const label = th.textContent ?? '';
      const tip = headerTooltip(label);
      if (tip) th.setAttribute('title', tip);
    });
  });

  const renderTable = (obsList: Observation[], title: string) => {
    if (!obsList.length) return null;
    return (
      <div className="mb-6 bg-slate-900/30 border border-slate-800/50 rounded overflow-hidden">
        <div className="bg-slate-800/50 px-4 py-2 border-b border-slate-700 flex items-center justify-between">
          <span className="text-blue-400 font-bold uppercase tracking-wider text-xs">{title}</span>
          <span className="text-[10px] text-slate-500">
            Toggle exclusions below and click Re-run
          </span>
        </div>
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500 border-b border-slate-800/50">
              <th className="py-2 px-4">Use</th>
              <th className="py-2">Type</th>
              <th className="py-2">Stations</th>
              <th className="py-2 text-right">Line</th>
              <th className="py-2 text-right">Obs</th>
              <th className="py-2 text-right">Calc</th>
              <th className="py-2 text-right">Residual</th>
              <th className="py-2 text-right">EffDist ({units})</th>
              <th className="py-2 text-right">StdRes</th>
              <th className="py-2 text-right">Redund</th>
              <th className="py-2 text-right">Local</th>
              <th className="py-2 text-right">MDB</th>
              <th className="py-2 text-right px-4">StdDev (override)</th>
            </tr>
          </thead>
          <tbody className="text-slate-300">
            {obsList.map((obs, i) => {
              const isFail = Math.abs(obs.stdRes || 0) > 3;
              const isWarn = Math.abs(obs.stdRes || 0) > 1 && !isFail;
              const excluded = excludedIds.has(obs.id);
              let stationsLabel = '';
              let obsStr = '';
              let calcStr = '';
              let resStr = '';
              let stdResStr = '-';
              let redundancyStr = '-';
              let localStr = '-';
              let mdbStr = '-';
              let effectiveDistanceStr = '-';
              let stdDevVal = obs.stdDev * unitScale;
              const sigmaSource = obs.sigmaSource || 'explicit';
              const sigmaPlaceholder =
                sigmaSource === 'default'
                  ? 'auto'
                  : sigmaSource === 'fixed'
                    ? 'fixed'
                    : sigmaSource === 'float'
                      ? 'float'
                      : '';
              const angular = isAngularType(obs.type);

              if (obs.type === 'angle') {
                stationsLabel = `${obs.at}-${obs.from}-${obs.to}`;
                obsStr = radToDmsStr(obs.obs);
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-';
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600; // arcseconds
              } else if (obs.type === 'direction') {
                const reductionLabel =
                  obs.rawCount != null
                    ? ` [raw ${obs.rawCount}->1, F1:${obs.rawFace1Count ?? '-'} F2:${obs.rawFace2Count ?? '-'}]`
                    : '';
                stationsLabel = `${obs.at}-${obs.to} (${obs.setId})${reductionLabel}`;
                obsStr = radToDmsStr(obs.obs);
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-';
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600; // arcseconds
              } else if (obs.type === 'dist') {
                stationsLabel = `${obs.from}-${obs.to}`;
                obsStr = (obs.obs * unitScale).toFixed(4);
                calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
                resStr =
                  obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
              } else if (obs.type === 'gps') {
                stationsLabel = `${obs.from}-${obs.to}`;
                obsStr = `dE=${(obs.obs.dE * unitScale).toFixed(3)}, dN=${(
                  obs.obs.dN * unitScale
                ).toFixed(3)}`;
                calcStr =
                  obs.calc != null
                    ? `dE=${((obs.calc as { dE: number }).dE * unitScale).toFixed(3)}, dN=${(
                        obs.calc as { dN: number; dE: number }
                      ).dN.toFixed(3)}`
                    : '-';
                resStr =
                  obs.residual != null
                    ? `vE=${((obs.residual as { vE: number }).vE * unitScale).toFixed(3)}, vN=${(
                        obs.residual as { vN: number; vE: number }
                      ).vN.toFixed(3)}`
                    : '-';
              } else if (obs.type === 'lev') {
                stationsLabel = `${obs.from}-${obs.to}`;
                obsStr = (obs.obs * unitScale).toFixed(4);
                calcStr = obs.calc != null ? ((obs.calc as number) * unitScale).toFixed(4) : '-';
                resStr =
                  obs.residual != null ? ((obs.residual as number) * unitScale).toFixed(4) : '-';
              } else if (obs.type === 'bearing') {
                stationsLabel = `${obs.from}-${obs.to}`;
                obsStr = radToDmsStr(obs.obs);
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-';
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600;
              } else if (obs.type === 'dir') {
                stationsLabel = `${obs.from}-${obs.to}`;
                obsStr = radToDmsStr(obs.obs);
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-';
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600;
              } else if (obs.type === 'zenith') {
                stationsLabel = `${obs.from}-${obs.to}`;
                obsStr = radToDmsStr(obs.obs);
                calcStr = obs.calc != null ? radToDmsStr(obs.calc as number) : '-';
                resStr =
                  obs.residual != null
                    ? `${((obs.residual as number) * RAD_TO_DEG * 3600).toFixed(2)}"`
                    : '-';
                stdDevVal = obs.stdDev * RAD_TO_DEG * 3600;
              }

              const stdDevDisplay =
                sigmaSource === 'default' || sigmaSource === 'fixed' || sigmaSource === 'float'
                  ? ''
                  : stdDevVal.toFixed(4);

              if (obs.stdResComponents) {
                stdResStr = `${obs.stdResComponents.tE.toFixed(2)}/${obs.stdResComponents.tN.toFixed(2)}`;
              } else if (obs.stdRes != null) {
                stdResStr = obs.stdRes.toFixed(2);
              }

              if (typeof obs.redundancy === 'object' && obs.redundancy) {
                redundancyStr = `${obs.redundancy.rE.toFixed(2)}/${obs.redundancy.rN.toFixed(2)}`;
              } else if (typeof obs.redundancy === 'number') {
                redundancyStr = obs.redundancy.toFixed(2);
              }
              if (obs.localTestComponents) {
                localStr = `E:${obs.localTestComponents.passE ? 'P' : 'F'} N:${
                  obs.localTestComponents.passN ? 'P' : 'F'
                }`;
              } else if (obs.localTest) {
                localStr = obs.localTest.pass ? 'PASS' : 'FAIL';
              }
              if (obs.mdbComponents) {
                mdbStr = `E=${formatMdb(obs.mdbComponents.mE, angular)} N=${formatMdb(
                  obs.mdbComponents.mN,
                  angular,
                )}`;
              } else if (obs.mdb != null) {
                mdbStr = formatMdb(obs.mdb, angular);
              }
              if (angular) {
                effectiveDistanceStr = formatEffectiveDistance(obs.effectiveDistance);
              }
              if (autoSideshotObsIds.has(obs.id)) {
                stationsLabel = `${stationsLabel} [AUTO-SS]`;
              }
              const prismTag = prismAnnotation(obs);
              if (prismTag) {
                stationsLabel = `${stationsLabel}${prismTag}`;
              }

              return (
                <tr
                  key={i}
                  className={`border-b border-slate-800/30 ${excluded ? 'opacity-50' : ''}`}
                >
                  <td className="py-1 px-4">
                    <input
                      type="checkbox"
                      checked={!excluded}
                      onChange={() => onToggleExclude(obs.id)}
                      className="accent-blue-500"
                    />
                  </td>
                  <td className="py-1 uppercase text-slate-500">
                    {obs.type === 'dir' ? 'dir' : obs.type}
                  </td>
                  <td className="py-1">{stationsLabel}</td>
                  <td className="py-1 text-right font-mono text-slate-500">
                    {obs.sourceLine != null ? obs.sourceLine : '-'}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-400">{obsStr || '-'}</td>
                  <td className="py-1 text-right font-mono text-slate-500">{calcStr}</td>
                  <td
                    className={`py-1 text-right font-bold font-mono ${
                      isFail ? 'text-red-500' : isWarn ? 'text-yellow-500' : 'text-green-500'
                    }`}
                  >
                    {resStr}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-400">
                    {effectiveDistanceStr}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-400">{stdResStr}</td>
                  <td className="py-1 text-right font-mono text-slate-500">{redundancyStr}</td>
                  <td
                    className={`py-1 text-right font-mono ${
                      localStr.includes('F') || localStr === 'FAIL'
                        ? 'text-red-400'
                        : 'text-slate-400'
                    }`}
                  >
                    {localStr}
                  </td>
                  <td className="py-1 text-right font-mono text-slate-500">{mdbStr}</td>
                  <td className="py-1 px-4 text-right font-mono text-slate-400">
                    <input
                      type="number"
                      className="bg-slate-800 border border-slate-700 rounded px-1 w-20 text-right text-xs"
                      defaultValue={stdDevDisplay}
                      placeholder={sigmaPlaceholder}
                      onBlur={(e) =>
                        onOverride(obs.id, {
                          stdDev:
                            e.target.value.trim() === ''
                              ? undefined
                              : obs.type === 'angle' ||
                                  obs.type === 'direction' ||
                                  obs.type === 'bearing' ||
                                  obs.type === 'dir' ||
                                  obs.type === 'zenith'
                                ? parseFloat(e.target.value) / (RAD_TO_DEG * 3600)
                                : parseFloat(e.target.value) / unitScale,
                        })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div ref={reportRootRef} className="p-6 font-mono text-sm w-full">
      <div className="flex items-center justify-between mb-4 text-xs text-slate-400">
        <div className="space-x-3">
          <button
            onClick={onReRun}
            className="px-3 py-1 bg-green-700 hover:bg-green-600 text-white rounded"
          >
            Re-run with exclusions
          </button>
          <button onClick={onClearExclusions} className="px-3 py-1 bg-slate-700 rounded">
            Reset exclusions
          </button>
          <button onClick={onResetOverrides} className="px-3 py-1 bg-slate-700 rounded">
            Reset overrides
          </button>
          <button
            onClick={onClearClusterMerges}
            disabled={clusterAppliedMerges.length === 0}
            className={`px-3 py-1 rounded ${
              clusterAppliedMerges.length === 0
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed'
                : 'bg-amber-700 hover:bg-amber-600 text-white'
            }`}
          >
            Revert cluster merges
          </button>
        </div>
        <div className="space-x-2 text-slate-500">
          <span>
            Unit scale: {unitScale.toFixed(4)} ({units})
          </span>
        </div>
      </div>

      {analysis.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xl font-bold text-white mb-4">Outlier Analysis (&gt; 2 sigma)</h2>
          <div className="bg-red-900/10 border border-red-800/50 rounded p-3 flex items-start space-x-2 mb-4">
            <AlertTriangle className="text-red-400 mt-0.5" size={18} />
            <div className="text-xs text-red-100">
              Residuals above 2.0 sigma are highlighted. Toggle them off and re-run to test
              re-weighting.
            </div>
          </div>
        </div>
      )}
      {!isPreanalysis && topSuspects.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Top Suspects (ranked)
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Type</th>
                <th className="py-2">Stations</th>
                <th className="py-2 text-right">Line</th>
                <th className="py-2 text-right">StdRes</th>
                <th className="py-2 text-right">Local</th>
                <th className="py-2 text-right px-3">MDB</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {topSuspects.map((obs, idx) => {
                const angular = isAngularType(obs.type);
                const local =
                  obs.localTestComponents != null
                    ? `E:${obs.localTestComponents.passE ? 'P' : 'F'} N:${
                        obs.localTestComponents.passN ? 'P' : 'F'
                      }`
                    : obs.localTest != null
                      ? obs.localTest.pass
                        ? 'PASS'
                        : 'FAIL'
                      : '-';
                const mdb =
                  obs.mdbComponents != null
                    ? `E=${formatMdb(obs.mdbComponents.mE, angular)} N=${formatMdb(
                        obs.mdbComponents.mN,
                        angular,
                      )}`
                    : obs.mdb != null
                      ? formatMdb(obs.mdb, angular)
                      : '-';
                return (
                  <tr key={`sus-${obs.id}-${idx}`} className="border-b border-slate-800/30">
                    <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-1 uppercase text-slate-400">{obs.type}</td>
                    <td className="py-1">
                      {'at' in obs && 'from' in obs && 'to' in obs
                        ? `${obs.at}-${obs.from}-${obs.to}`
                        : 'at' in obs && 'to' in obs
                          ? `${obs.at}-${obs.to}`
                          : 'from' in obs && 'to' in obs
                            ? `${obs.from}-${obs.to}`
                            : '-'}
                    </td>
                    <td className="py-1 text-right font-mono text-slate-500">
                      {obs.sourceLine != null ? obs.sourceLine : '-'}
                    </td>
                    <td className="py-1 text-right font-mono">{(obs.stdRes ?? 0).toFixed(2)}</td>
                    <td
                      className={`py-1 text-right font-mono ${
                        local.includes('F') || local === 'FAIL' ? 'text-red-400' : 'text-slate-300'
                      }`}
                    >
                      {local}
                    </td>
                    <td className="py-1 px-3 text-right font-mono text-slate-400">{mdb}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!isPreanalysis &&
        result.suspectImpactDiagnostics &&
        result.suspectImpactDiagnostics.length > 0 && (
          <div className="mb-8 border border-slate-800 rounded overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
              Suspect Impact Analysis (what-if exclusion)
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800/60">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Stations</th>
                  <th className="py-2 text-right">Line</th>
                  <th className="py-2 text-right">Base |t|</th>
                  <th className="py-2 text-right">dSEUW</th>
                  <th className="py-2 text-right">dMax|t|</th>
                  <th className="py-2 text-right">Chi</th>
                  <th className="py-2 text-right">Max Shift ({units})</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2 text-right px-3">Action</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {result.suspectImpactDiagnostics.map((d, idx) => {
                  const alreadyExcluded = excludedIds.has(d.obsId);
                  return (
                    <tr key={`impact-${d.obsId}-${idx}`} className="border-b border-slate-800/30">
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1 uppercase text-slate-400">{d.type}</td>
                      <td className="py-1">{d.stations}</td>
                      <td className="py-1 text-right font-mono text-slate-500">
                        {d.sourceLine ?? '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {d.baseStdRes != null ? d.baseStdRes.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {d.deltaSeuw != null ? d.deltaSeuw.toFixed(4) : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {d.deltaMaxStdRes != null ? d.deltaMaxStdRes.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">{d.chiDelta}</td>
                      <td className="py-1 text-right font-mono">
                        {d.maxCoordShift != null ? (d.maxCoordShift * unitScale).toFixed(4) : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {d.score != null ? d.score.toFixed(1) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        <button
                          onClick={() => onApplyImpactExclude(d.obsId)}
                          disabled={alreadyExcluded || d.status !== 'ok'}
                          className={`px-2 py-0.5 rounded border text-[10px] ${
                            alreadyExcluded || d.status !== 'ok'
                              ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                              : 'border-blue-600 text-blue-300 hover:bg-blue-900/30'
                          }`}
                        >
                          {alreadyExcluded
                            ? 'Excluded'
                            : d.status !== 'ok'
                              ? 'N/A'
                              : 'Exclude + Re-run'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      <div className="mb-8 border-b border-slate-800 pb-6">
        <h2
          className="text-xl font-bold text-white mb-4"
          title={REPORT_STATIC_TOOLTIPS['Adjustment Summary']}
        >
          Adjustment Summary
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900 p-4 rounded border border-slate-800">
            <span
              className="block text-slate-500 text-xs mb-1"
              title={REPORT_STATIC_TOOLTIPS.STATUS}
            >
              STATUS
            </span>
            <div
              className={`flex items-center space-x-2 ${result.success ? 'text-green-400' : 'text-yellow-500'}`}
            >
              {result.success ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
              <span className="font-bold">
                {result.success ? 'CONVERGED' : 'NOT CONVERGED / WARNING'}
              </span>
            </div>
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800">
            <span
              className="block text-slate-500 text-xs mb-1"
              title={
                isPreanalysis
                  ? 'Preanalysis uses the a-priori variance factor sigma0^2 = 1.0 and reports predicted precision only.'
                  : 'SEUW = sqrt(vTPv / DOF). Values near 1 usually indicate realistic stochastic modeling.'
              }
            >
              {isPreanalysis ? 'A-PRIORI SIGMA0' : 'STD ERROR UNIT WEIGHT (SEUW)'}
            </span>
            <span
              className={`font-bold text-lg ${result.seuw > 1.5 ? 'text-yellow-400' : 'text-blue-400'}`}
            >
              {result.seuw.toFixed(4)}
            </span>
            <span className="text-slate-600 text-xs ml-2">
              {isPreanalysis ? '(predicted precision)' : `(DOF: ${result.dof})`}
            </span>
            {result.controlConstraints && (
              <div className="text-[10px] text-slate-500 mt-1">
                constraints: {result.controlConstraints.count} (E:{result.controlConstraints.x} N:
                {result.controlConstraints.y} H:{result.controlConstraints.h} corrXY:
                {result.controlConstraints.xyCorrelated ?? 0})
              </div>
            )}
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
            <span
              className="block text-slate-500 text-xs mb-1"
              title={
                isPreanalysis
                  ? 'Residual-based quality-control statistics are disabled in preanalysis mode.'
                  : 'Global model test against expected variance at 95% confidence. PASS means SEUW is statistically consistent with stated precisions.'
              }
            >
              {isPreanalysis ? 'RESIDUAL QC' : 'CHI-SQUARE (95%)'}
            </span>
            {!isPreanalysis && result.chiSquare ? (
              <>
                <div
                  className={`font-bold text-lg ${result.chiSquare.pass95 ? 'text-green-400' : 'text-red-400'}`}
                >
                  {result.chiSquare.pass95 ? 'PASS' : 'FAIL'}
                </div>
                <div className="text-xs text-slate-500">
                  T={result.chiSquare.T.toFixed(2)} p={result.chiSquare.p.toFixed(3)}
                </div>
                <div className="text-[10px] text-slate-500">
                  [{result.chiSquare.lower.toFixed(2)}, {result.chiSquare.upper.toFixed(2)}]
                </div>
                <div className="text-[10px] text-slate-500">
                  vf={result.chiSquare.varianceFactor.toFixed(3)} (
                  {result.chiSquare.varianceFactorLower.toFixed(3)}..
                  {result.chiSquare.varianceFactorUpper.toFixed(3)})
                </div>
                <div className="text-[10px] text-slate-500">
                  ef=(
                  {Math.sqrt(result.chiSquare.varianceFactorLower).toFixed(3)}..
                  {Math.sqrt(result.chiSquare.varianceFactorUpper).toFixed(3)})
                </div>
                {result.condition && (
                  <div
                    className={`text-[10px] ${result.condition.flagged ? 'text-red-400' : 'text-slate-500'}`}
                  >
                    cond={result.condition.estimate.toExponential(2)} /{' '}
                    {result.condition.threshold.toExponential(2)}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-slate-500">
                {isPreanalysis ? 'Disabled for planning runs' : '-'}
              </div>
            )}
          </div>
          <div className="bg-slate-900 p-4 rounded border border-slate-800 hidden md:block">
            <span
              className="block text-slate-500 text-xs mb-1"
              title={REPORT_STATIC_TOOLTIPS['OBSERVATION BREAKDOWN']}
            >
              OBSERVATION BREAKDOWN
            </span>
            <div className="text-xs text-slate-300 space-y-0.5">
              <div>Distances: {byType('dist').length}</div>
              <div>Angles: {byType('angle').length}</div>
              <div>Directions: {byType('direction').length}</div>
              <div>GPS: {byType('gps').length}</div>
              <div>Leveling: {byType('lev').length}</div>
              <div>Bearings: {byType('bearing').length}</div>
              <div>Dirs: {byType('dir').length}</div>
              <div>Zenith: {byType('zenith').length}</div>
              {isPreanalysis && (
                <div>Planned: {result.parseState?.plannedObservationCount ?? 0}</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {runDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div
            className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40"
            title={REPORT_STATIC_TOOLTIPS['Solve Profile Diagnostics']}
          >
            Solve Profile Diagnostics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300">
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS.Profile}>
                Profile
              </div>
              <div className={runDiagnostics.parity ? 'text-blue-300' : ''}>
                {runDiagnostics.solveProfile.toUpperCase()}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Direction Sets']}>
                Direction Sets
              </div>
              <div>{runDiagnostics.directionSetMode.toUpperCase()}</div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Profile Fallback']}>
                Profile Fallback
              </div>
              <div>{runDiagnostics.profileDefaultInstrumentFallback ? 'ON' : 'OFF'}</div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Angle Centering']}>
                Angle Centering
              </div>
              <div>{runDiagnostics.angleCenteringModel}</div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['TS Correlation']}>
                TS Correlation
              </div>
              <div>
                {runDiagnostics.tsCorrelationEnabled
                  ? `ON (${runDiagnostics.tsCorrelationScope}, rho=${runDiagnostics.tsCorrelationRho.toFixed(3)})`
                  : 'OFF'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS.Robust}>
                Robust
              </div>
              <div>
                {runDiagnostics.robustMode.toUpperCase()} (k={runDiagnostics.robustK.toFixed(2)})
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Map / Scale']}>
                Map / Scale
              </div>
              <div>
                {runDiagnostics.mapMode.toUpperCase()} / {runDiagnostics.mapScaleFactor.toFixed(8)}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Vertical / CurvRef']}>
                Vertical / CurvRef
              </div>
              <div>
                {runDiagnostics.verticalReduction.toUpperCase()} /{' '}
                {runDiagnostics.applyCurvatureRefraction
                  ? `ON (k=${runDiagnostics.refractionCoefficient.toFixed(3)})`
                  : 'OFF'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS.Normalize}>
                Normalize
              </div>
              <div>{runDiagnostics.normalize ? 'ON' : 'OFF'}</div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['A-Mode']}>
                A-Mode
              </div>
              <div>{runDiagnostics.angleMode.toUpperCase()}</div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Plan Rotation']}>
                Plan Rotation
              </div>
              <div>{`${(runDiagnostics.rotationAngleRad * RAD_TO_DEG).toFixed(6)}°`}</div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['CRS / Projection']}>
                CRS / Projection
              </div>
              <div>
                {runDiagnostics.crsTransformEnabled
                  ? `ON (${runDiagnostics.crsProjectionModel}, label="${runDiagnostics.crsLabel || 'unnamed'}")`
                  : 'OFF'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['CRS Grid Scale']}>
                CRS Grid Scale
              </div>
              <div>
                {runDiagnostics.crsGridScaleEnabled
                  ? `ON (${runDiagnostics.crsGridScaleFactor.toFixed(8)})`
                  : 'OFF'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['CRS Convergence']}>
                CRS Convergence
              </div>
              <div>
                {runDiagnostics.crsConvergenceEnabled
                  ? `ON (${(runDiagnostics.crsConvergenceAngleRad * RAD_TO_DEG).toFixed(6)}°)`
                  : 'OFF'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Geoid/Grid Model']}>
                Geoid/Grid Model
              </div>
              <div>
                {runDiagnostics.geoidModelEnabled
                  ? `ON (${runDiagnostics.geoidModelId}, ${runDiagnostics.geoidInterpolation.toUpperCase()}, loaded=${runDiagnostics.geoidModelLoaded ? 'YES' : 'NO'})`
                  : 'OFF'}
              </div>
            </div>
            <div>
              <div
                className="text-slate-500"
                title={REPORT_STATIC_TOOLTIPS['Geoid Height Conversion']}
              >
                Geoid Height Conversion
              </div>
              <div>
                {runDiagnostics.geoidHeightConversionEnabled
                  ? `ON (${runDiagnostics.geoidOutputHeightDatum.toUpperCase()}, converted=${runDiagnostics.geoidConvertedStationCount}, skipped=${runDiagnostics.geoidSkippedStationCount})`
                  : 'OFF'}
              </div>
            </div>
            <div>
              <div
                className="text-slate-500"
                title={REPORT_STATIC_TOOLTIPS['QFIX (Linear/Angular)']}
              >
                QFIX (Linear/Angular)
              </div>
              <div>
                {(runDiagnostics.qFixLinearSigmaM * unitScale).toExponential(6)} {units} /{' '}
                {runDiagnostics.qFixAngularSigmaSec.toExponential(6)}"
              </div>
            </div>
            {runDiagnostics.geoidModelEnabled && (
              <div className="col-span-2">
                <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Geoid Metadata']}>
                  Geoid Metadata
                </div>
                <div className="break-words">
                  {runDiagnostics.geoidModelMetadata || 'unavailable'}
                  {runDiagnostics.geoidSampleUndulationM != null
                    ? `; sampleN=${runDiagnostics.geoidSampleUndulationM.toFixed(4)}m`
                    : ''}
                </div>
              </div>
            )}
            <div className="col-span-2">
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Lost Stations']}>
                Lost Stations
              </div>
              <div className="break-words">
                {lostStationIds.length > 0
                  ? `${lostStationIds.length} (${lostStationIds.join(', ')})`
                  : 'none'}
              </div>
            </div>
            <div className="col-span-2">
              <div
                className="text-slate-500"
                title={REPORT_STATIC_TOOLTIPS['Description Reconciliation']}
              >
                Description Reconciliation
              </div>
              <div className="break-words">
                {descriptionReconcileMode.toUpperCase()}
                {descriptionReconcileMode === 'append'
                  ? ` (delimiter="${descriptionAppendDelimiter}")`
                  : ''}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Default Sigmas']}>
                Default Sigmas
              </div>
              <div>
                {runDiagnostics.defaultSigmaCount}
                {runDiagnostics.defaultSigmaByType ? ` (${runDiagnostics.defaultSigmaByType})` : ''}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500" title={REPORT_STATIC_TOOLTIPS['Stochastic Defaults']}>
                Stochastic Defaults
              </div>
              <div className="break-words">{runDiagnostics.stochasticDefaultsSummary}</div>
            </div>
          </div>
        </div>
      )}

      {isPreanalysis && (
        <div className="mb-6 border border-cyan-900/70 rounded overflow-hidden">
          <div
            className="px-3 py-2 text-xs text-cyan-200 uppercase tracking-wider border-b border-cyan-900/60 bg-cyan-950/30"
            title={preanalysisLabelTooltip('Preanalysis Planning Summary')}
          >
            Preanalysis Planning Summary
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300 border-b border-cyan-900/30">
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Planned Observations')}
              >
                Planned Observations
              </div>
              <div>{result.parseState?.plannedObservationCount ?? 0}</div>
            </div>
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Station Covariance Blocks')}
              >
                Station Covariance Blocks
              </div>
              <div>{stationCovariances.length}</div>
            </div>
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Connected Pair Blocks')}
              >
                Connected Pair Blocks
              </div>
              <div>{relativeCovariances.length}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Stations')}>
                Weak Stations
              </div>
              <div>{flaggedStationCues.length}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Pairs')}>
                Weak Pairs
              </div>
              <div>{flaggedRelativeCues.length}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Locked Planned')}>
                Locked Planned
              </div>
              <div>{lockedPreanalysisObservations.length}</div>
            </div>
          </div>
          <div className="px-3 py-2 text-xs text-cyan-100/90 bg-cyan-950/20">
            Predicted covariance uses sigma0^2 = 1.0. Residual-based QC, chi-square, suspect
            ranking, and exclusion workflows are disabled in this mode.
          </div>
        </div>
      )}

      {isPreanalysis && lockedPreanalysisObservations.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden opacity-75">
          <div
            className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40"
            title={preanalysisLabelTooltip('Locked Planned Observations')}
          >
            Locked Planned Observations
          </div>
          <div className="px-3 py-2 text-xs text-slate-500 bg-slate-950/30 border-b border-slate-800/60">
            These planned rows use fixed sigma weighting, remain visible for context, and are not
            removable from what-if actions.
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Type</th>
                <th className="py-2">Stations</th>
                <th className="py-2 text-right">Line</th>
                <th className="py-2 text-right">Obs</th>
                <th className="py-2 text-right">Fixed Sigma</th>
                <th className="py-2 px-3">Note</th>
              </tr>
            </thead>
            <tbody className="text-slate-500">
              {lockedPreanalysisObservations.map((obs, idx) => (
                <tr
                  key={`locked-preanalysis-${obs.id}-${idx}`}
                  className="border-b border-slate-800/40 bg-slate-950/20"
                >
                  <td className="py-1 px-3">{idx + 1}</td>
                  <td className="py-1 uppercase">{obs.type}</td>
                  <td className="py-1">{observationStationsLabel(obs)}</td>
                  <td className="py-1 text-right font-mono">{obs.sourceLine ?? '-'}</td>
                  <td className="py-1 text-right font-mono">{observationValueLabel(obs)}</td>
                  <td className="py-1 text-right font-mono">{fixedSigmaLabel(obs)}</td>
                  <td className="py-1 px-3">
                    Locked planned constraint; excluded from what-if actions.
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isPreanalysis &&
        preanalysisImpactDiagnostics &&
        preanalysisImpactDiagnostics.rows.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            <div
              className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40"
              title={preanalysisLabelTooltip('Planned Observation What-If Analysis')}
            >
              Planned Observation What-If Analysis
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
              <div>
                <div
                  className="text-slate-500"
                  title={preanalysisLabelTooltip('Removable Planned')}
                >
                  Active Removable
                </div>
                <div>{preanalysisImpactDiagnostics.activePlannedCount}</div>
              </div>
              <div>
                <div
                  className="text-slate-500"
                  title={preanalysisLabelTooltip('Excluded Removable')}
                >
                  Excluded Removable
                </div>
                <div>{preanalysisImpactDiagnostics.excludedPlannedCount}</div>
              </div>
              <div>
                <div
                  className="text-slate-500"
                  title={preanalysisLabelTooltip('Worst Station Major')}
                >
                  Worst Station Major
                </div>
                <div>
                  {preanalysisImpactDiagnostics.baseWorstStationMajor != null
                    ? `${(preanalysisImpactDiagnostics.baseWorstStationMajor * unitScale).toFixed(4)} ${units}`
                    : '-'}
                </div>
              </div>
              <div>
                <div
                  className="text-slate-500"
                  title={preanalysisLabelTooltip('Worst Pair SigmaDist')}
                >
                  Worst Pair SigmaDist
                </div>
                <div>
                  {preanalysisImpactDiagnostics.baseWorstPairSigmaDist != null
                    ? `${(preanalysisImpactDiagnostics.baseWorstPairSigmaDist * unitScale).toFixed(4)} ${units}`
                    : '-'}
                </div>
              </div>
              <div>
                <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Stations')}>
                  Weak Stations
                </div>
                <div>{preanalysisImpactDiagnostics.baseWeakStationCount}</div>
              </div>
              <div>
                <div className="text-slate-500" title={preanalysisLabelTooltip('Weak Pairs')}>
                  Weak Pairs
                </div>
                <div>{preanalysisImpactDiagnostics.baseWeakPairCount}</div>
              </div>
            </div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800/60">
                  <th className="py-2 px-3">#</th>
                  <th className="py-2">Action</th>
                  <th className="py-2">Type</th>
                  <th className="py-2">Stations</th>
                  <th className="py-2 text-right">Line</th>
                  <th className="py-2 text-right">dWorstMaj ({units})</th>
                  <th className="py-2 text-right">dMedianMaj ({units})</th>
                  <th className="py-2 text-right">dWorstPair ({units})</th>
                  <th className="py-2 text-right">dWeakStn</th>
                  <th className="py-2 text-right">dWeakPair</th>
                  <th className="py-2 text-right">Score</th>
                  <th className="py-2 text-right px-3">Apply</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {preanalysisImpactDiagnostics.rows.map((row, idx) => {
                  const alreadyExcluded = excludedIds.has(row.obsId);
                  return (
                    <tr
                      key={`preanalysis-impact-${row.obsId}-${idx}`}
                      className="border-b border-slate-800/30"
                    >
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1 uppercase text-slate-400">
                        {row.action === 'remove' ? 'REMOVE' : 'ADD BACK'}
                      </td>
                      <td className="py-1 uppercase text-slate-400">{row.type}</td>
                      <td className="py-1">{row.stations}</td>
                      <td className="py-1 text-right font-mono text-slate-500">
                        {row.sourceLine ?? '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {row.deltaWorstStationMajor != null
                          ? (row.deltaWorstStationMajor * unitScale).toFixed(4)
                          : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {row.deltaMedianStationMajor != null
                          ? (row.deltaMedianStationMajor * unitScale).toFixed(4)
                          : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {row.deltaWorstPairSigmaDist != null
                          ? (row.deltaWorstPairSigmaDist * unitScale).toFixed(4)
                          : '-'}
                      </td>
                      <td className="py-1 text-right font-mono">
                        {row.deltaWeakStationCount ?? '-'}
                      </td>
                      <td className="py-1 text-right font-mono">{row.deltaWeakPairCount ?? '-'}</td>
                      <td className="py-1 text-right font-mono">
                        {row.score != null ? row.score.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        <button
                          onClick={() => onApplyPreanalysisAction(row.obsId)}
                          disabled={row.status !== 'ok'}
                          className={`px-2 py-0.5 rounded border text-[10px] ${
                            row.status !== 'ok'
                              ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                              : 'border-cyan-700 text-cyan-200 hover:bg-cyan-950/30'
                          }`}
                        >
                          {row.action === 'remove'
                            ? alreadyExcluded
                              ? 'Removed'
                              : 'Remove + Re-run'
                            : alreadyExcluded
                              ? 'Add Back + Re-run'
                              : 'Added'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {aliasTrace.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Alias Traceability
          </div>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Explicit Maps</div>
              <div>{result.parseState?.aliasExplicitCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-500">Pattern Rules</div>
              <div>{result.parseState?.aliasRuleCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-500">Remap References</div>
              <div>{aliasTrace.length}</div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500">Rule Summary</div>
              <div className="truncate">
                {(result.parseState?.aliasRuleSummaries ?? [])
                  .map((r) => `${r.rule} @${r.sourceLine}`)
                  .join('; ') || '-'}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">Context</th>
                  <th className="py-2 px-3 font-semibold">Detail</th>
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                  <th className="py-2 px-3 font-semibold">Source Alias</th>
                  <th className="py-2 px-3 font-semibold">Canonical ID</th>
                  <th className="py-2 px-3 font-semibold">Reference</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {aliasTrace.slice(0, 200).map((entry, idx) => (
                  <tr
                    key={`alias-trace-${entry.context}-${entry.sourceLine ?? 'na'}-${entry.sourceId}-${entry.canonicalId}-${idx}`}
                    className="border-b border-slate-800/50"
                  >
                    <td className="py-1 px-3 uppercase">{entry.context}</td>
                    <td className="py-1 px-3">{entry.detail ?? '-'}</td>
                    <td className="py-1 px-3 text-right text-slate-500">
                      {entry.sourceLine ?? '-'}
                    </td>
                    <td className="py-1 px-3 font-mono">{entry.sourceId}</td>
                    <td className="py-1 px-3 font-mono">{entry.canonicalId}</td>
                    <td className="py-1 px-3">{entry.reference ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {aliasTrace.length > 200 && (
            <div className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-800">
              Showing first 200 rows of {aliasTrace.length}. Full trace available in export output.
            </div>
          )}
        </div>
      )}

      {descriptionScanSummary.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Description Reconciliation Summary
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Mode</div>
              <div>
                {descriptionReconcileMode.toUpperCase()}
                {descriptionReconcileMode === 'append' ? ` ("${descriptionAppendDelimiter}")` : ''}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Stations</div>
              <div>{descriptionScanSummary.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Repeated IDs</div>
              <div>{result.parseState?.descriptionRepeatedStationCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-500">Conflicts</div>
              <div className={descriptionConflicts.length > 0 ? 'text-amber-300' : ''}>
                {descriptionConflicts.length}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">Station</th>
                  <th className="py-2 px-3 font-semibold text-right">Records</th>
                  <th className="py-2 px-3 font-semibold text-right">Unique</th>
                  <th className="py-2 px-3 font-semibold text-center">Conflict</th>
                  <th className="py-2 px-3 font-semibold">Descriptions (line refs)</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {descriptionScanSummary.map((row) => {
                  const details = (descriptionRefsByStation.get(row.stationId) ?? [])
                    .map((detail) => {
                      const lines = detail.lines
                        .slice()
                        .sort((a, b) => a - b)
                        .join(', ');
                      return `${detail.description} [${lines}]`;
                    })
                    .join(' ; ');
                  return (
                    <tr
                      key={`desc-summary-${row.stationId}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 font-mono">{row.stationId}</td>
                      <td className="py-1 px-3 text-right">{row.recordCount}</td>
                      <td className="py-1 px-3 text-right">{row.uniqueCount}</td>
                      <td className="py-1 px-3 text-center">
                        {row.conflict ? (
                          <span className="text-amber-300 font-semibold">YES</span>
                        ) : (
                          <span className="text-slate-500">no</span>
                        )}
                      </td>
                      <td className="py-1 px-3 text-slate-400">{details || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {clusterDiagnostics?.enabled && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Cluster Detection Candidates
          </div>
          <div className="grid grid-cols-2 md:grid-cols-12 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Pass</div>
              <div>{clusterDiagnostics.passMode.toUpperCase()}</div>
            </div>
            <div>
              <div className="text-slate-500">Mode</div>
              <div>{clusterDiagnostics.linkageMode.toUpperCase()}</div>
            </div>
            <div>
              <div className="text-slate-500">Dimension</div>
              <div>{clusterDiagnostics.dimension}</div>
            </div>
            <div>
              <div className="text-slate-500">Tolerance</div>
              <div>
                {(clusterDiagnostics.tolerance * unitScale).toFixed(4)} {units}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Pair Hits</div>
              <div>{clusterDiagnostics.pairCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Candidates</div>
              <div>{clusterDiagnostics.candidateCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Approved Merges</div>
              <div>{clusterDiagnostics.approvedMergeCount ?? 0}</div>
            </div>
            <div>
              <div className="text-slate-500">Coverage</div>
              <div>{clusterCandidates.length > 0 ? 'Needs Review' : 'No Clusters'}</div>
            </div>
            <div>
              <div className="text-slate-500">Pending</div>
              <div>{clusterReviewStats.pending}</div>
            </div>
            <div>
              <div className="text-slate-500">Approved</div>
              <div>{clusterReviewStats.approved}</div>
            </div>
            <div>
              <div className="text-slate-500">Rejected</div>
              <div>{clusterReviewStats.rejected}</div>
            </div>
            <div>
              <div className="text-slate-500">Planned Merges</div>
              <div>{clusterReviewStats.plannedMerges}</div>
            </div>
            <div>
              <div className="text-slate-500">Merge Outcomes</div>
              <div>{clusterMergeOutcomes.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Rejected Proposals</div>
              <div>{clusterRejectedProposals.length}</div>
            </div>
          </div>
          {clusterCandidates.length > 0 ? (
            <div className="overflow-x-auto w-full">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 text-xs bg-slate-900/20">
                <button
                  onClick={onApplyClusterMerges}
                  disabled={clusterReviewStats.plannedMerges === 0}
                  className={`px-3 py-1 rounded border ${
                    clusterReviewStats.plannedMerges === 0
                      ? 'border-slate-700 text-slate-600 cursor-not-allowed'
                      : 'border-blue-600 text-blue-300 hover:bg-blue-900/30'
                  }`}
                >
                  Apply Approved Merges + Re-run
                </button>
                <button
                  onClick={onResetClusterReview}
                  className="px-3 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800/60"
                >
                  Reset Review
                </button>
                {clusterAppliedMerges.length > 0 && (
                  <button
                    onClick={onClearClusterMerges}
                    className="px-3 py-1 rounded border border-amber-600 text-amber-300 hover:bg-amber-900/30"
                  >
                    Clear Applied Merges + Re-run
                  </button>
                )}
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">Key</th>
                    <th className="py-2 px-3 font-semibold">Representative</th>
                    <th className="py-2 px-3 font-semibold">Action</th>
                    <th className="py-2 px-3 font-semibold">Retain</th>
                    <th className="py-2 px-3 font-semibold text-right">Members</th>
                    <th className="py-2 px-3 font-semibold text-right">Max Sep ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Mean Sep ({units})</th>
                    <th className="py-2 px-3 font-semibold">Flags</th>
                    <th className="py-2 px-3 font-semibold">Station IDs</th>
                    <th className="py-2 px-3 font-semibold text-right">Planned Merges</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {clusterCandidates.map((c) => {
                    const decision = clusterReviewDecisions[c.key];
                    const action = decision?.status ?? 'pending';
                    const retainId =
                      decision && c.stationIds.includes(decision.canonicalId)
                        ? decision.canonicalId
                        : c.representativeId;
                    const plannedMerges =
                      action === 'approve'
                        ? c.stationIds.filter((id) => id !== retainId).length
                        : 0;
                    return (
                      <tr key={c.key} className="border-b border-slate-800/50">
                        <td className="py-1 px-3 font-mono">{c.key}</td>
                        <td className="py-1 px-3 font-mono">{c.representativeId}</td>
                        <td className="py-1 px-3">
                          <select
                            value={action}
                            onChange={(e) =>
                              onClusterDecisionStatus(
                                c.key,
                                e.target.value as 'pending' | 'approve' | 'reject',
                              )
                            }
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs"
                          >
                            <option value="pending">Pending</option>
                            <option value="approve">Approve</option>
                            <option value="reject">Reject</option>
                          </select>
                        </td>
                        <td className="py-1 px-3">
                          <select
                            value={retainId}
                            onChange={(e) => onClusterCanonicalSelection(c.key, e.target.value)}
                            disabled={action === 'reject'}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-0.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {c.stationIds.map((stationId) => (
                              <option key={`${c.key}-retain-${stationId}`} value={stationId}>
                                {stationId}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="py-1 px-3 text-right">{c.memberCount}</td>
                        <td className="py-1 px-3 text-right">
                          {(c.maxSeparation * unitScale).toFixed(4)}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {(c.meanSeparation * unitScale).toFixed(4)}
                        </td>
                        <td className="py-1 px-3">
                          {c.hasFixed ? 'fixed' : 'free'}
                          {c.hasUnknown ? ' + unknown' : ''}
                        </td>
                        <td className="py-1 px-3 font-mono">{c.stationIds.join(', ')}</td>
                        <td className="py-1 px-3 text-right font-mono">{plannedMerges}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-3 text-xs text-slate-500">
              No stations fell inside the current cluster tolerance.
            </div>
          )}
          {clusterAppliedMerges.length > 0 && (
            <div className="border-t border-slate-800">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/20">
                Applied Cluster Merges
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 px-3 font-semibold">Alias</th>
                      <th className="py-2 px-3 font-semibold">Canonical</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {clusterAppliedMerges.map((merge, idx) => (
                      <tr
                        key={`cluster-merge-${merge.aliasId}-${merge.canonicalId}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3 font-mono">{merge.aliasId}</td>
                        <td className="py-1 px-3 font-mono">{merge.canonicalId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {clusterMergeOutcomes.length > 0 && (
            <div className="border-t border-slate-800">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/20">
                Cluster Merge Outcomes (Delta From Retained Point)
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 px-3 font-semibold">Alias</th>
                      <th className="py-2 px-3 font-semibold">Canonical</th>
                      <th className="py-2 px-3 font-semibold text-right">dE ({units})</th>
                      <th className="py-2 px-3 font-semibold text-right">dN ({units})</th>
                      <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
                      <th className="py-2 px-3 font-semibold text-right">d2D ({units})</th>
                      <th className="py-2 px-3 font-semibold text-right">d3D ({units})</th>
                      <th className="py-2 px-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {clusterMergeOutcomes.map((row, idx) => (
                      <tr
                        key={`cluster-merge-outcome-${row.aliasId}-${row.canonicalId}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3 font-mono">{row.aliasId}</td>
                        <td className="py-1 px-3 font-mono">{row.canonicalId}</td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.deltaE != null ? (row.deltaE * unitScale).toFixed(4) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.deltaN != null ? (row.deltaN * unitScale).toFixed(4) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.horizontalDelta != null
                            ? (row.horizontalDelta * unitScale).toFixed(4)
                            : '-'}
                        </td>
                        <td className="py-1 px-3 text-right font-mono">
                          {row.spatialDelta != null
                            ? (row.spatialDelta * unitScale).toFixed(4)
                            : '-'}
                        </td>
                        <td className="py-1 px-3">{row.missing ? 'Missing pass1 data' : 'OK'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {clusterRejectedProposals.length > 0 && (
            <div className="border-t border-slate-800">
              <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/20">
                Rejected Cluster Proposals
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 px-3 font-semibold">Key</th>
                      <th className="py-2 px-3 font-semibold">Representative</th>
                      <th className="py-2 px-3 font-semibold text-right">Members</th>
                      <th className="py-2 px-3 font-semibold">Retained</th>
                      <th className="py-2 px-3 font-semibold">Station IDs</th>
                      <th className="py-2 px-3 font-semibold">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {clusterRejectedProposals.map((row, idx) => (
                      <tr
                        key={`cluster-reject-${row.key}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3 font-mono">{row.key}</td>
                        <td className="py-1 px-3 font-mono">{row.representativeId}</td>
                        <td className="py-1 px-3 text-right">{row.memberCount}</td>
                        <td className="py-1 px-3 font-mono">{row.retainedId ?? '-'}</td>
                        <td className="py-1 px-3 font-mono">{row.stationIds.join(', ')}</td>
                        <td className="py-1 px-3">{row.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {autoAdjustDiagnostics?.enabled && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Auto-Adjust Diagnostics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Threshold</div>
              <div>|t| &gt;= {autoAdjustDiagnostics.threshold.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-slate-500">Max Cycles</div>
              <div>{autoAdjustDiagnostics.maxCycles}</div>
            </div>
            <div>
              <div className="text-slate-500">Max Removals/Cycle</div>
              <div>{autoAdjustDiagnostics.maxRemovalsPerCycle}</div>
            </div>
            <div>
              <div className="text-slate-500">Min Redundancy</div>
              <div>{autoAdjustDiagnostics.minRedundancy.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-slate-500">Stop Reason</div>
              <div>{autoAdjustDiagnostics.stopReason}</div>
            </div>
            <div>
              <div className="text-slate-500">Total Removed</div>
              <div>{autoAdjustDiagnostics.removed.length}</div>
            </div>
          </div>
          <div className="overflow-x-auto w-full border-b border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold text-right">Cycle</th>
                  <th className="py-2 px-3 font-semibold text-right">SEUW</th>
                  <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Removals</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {autoAdjustDiagnostics.cycles.map((cycle) => (
                  <tr key={`auto-cycle-${cycle.cycle}`} className="border-b border-slate-800/50">
                    <td className="py-1 px-3 text-right">{cycle.cycle}</td>
                    <td className="py-1 px-3 text-right font-mono">{cycle.seuw.toFixed(4)}</td>
                    <td className="py-1 px-3 text-right font-mono">
                      {cycle.maxAbsStdRes.toFixed(2)}
                    </td>
                    <td className="py-1 px-3 text-right">{cycle.removals.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {autoAdjustDiagnostics.removed.length > 0 && (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold text-right">Obs ID</th>
                    <th className="py-2 px-3 font-semibold">Type</th>
                    <th className="py-2 px-3 font-semibold">Stations</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold text-right">|t|</th>
                    <th className="py-2 px-3 font-semibold text-right">Redund</th>
                    <th className="py-2 px-3 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {autoAdjustDiagnostics.removed.map((row, idx) => (
                    <tr
                      key={`auto-removed-${row.obsId}-${row.sourceLine ?? 'na'}-${idx}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 text-right font-mono">{row.obsId}</td>
                      <td className="py-1 px-3 uppercase">{row.type}</td>
                      <td className="py-1 px-3 font-mono">{row.stations}</td>
                      <td className="py-1 px-3 text-right">{row.sourceLine ?? '-'}</td>
                      <td className="py-1 px-3 text-right font-mono">{row.stdRes.toFixed(2)}</td>
                      <td className="py-1 px-3 text-right font-mono">
                        {row.redundancy != null ? row.redundancy.toFixed(3) : '-'}
                      </td>
                      <td className="py-1 px-3">{row.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {autoSideshotDiagnostics?.enabled && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Auto Sideshot Candidates (M Records)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
            <div>
              <div className="text-slate-500">Evaluated M Pairs</div>
              <div>{autoSideshotDiagnostics.evaluatedCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Candidates</div>
              <div>{autoSideshotDiagnostics.candidateCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Excluded Control Targets</div>
              <div>{autoSideshotDiagnostics.excludedControlCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Min Redundancy Threshold</div>
              <div>{autoSideshotDiagnostics.threshold.toFixed(2)}</div>
            </div>
          </div>
          {autoSideshotDiagnostics.candidates.length > 0 ? (
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold">Occupy</th>
                    <th className="py-2 px-3 font-semibold">Backsight</th>
                    <th className="py-2 px-3 font-semibold">Target</th>
                    <th className="py-2 px-3 font-semibold text-right">Angle Obs</th>
                    <th className="py-2 px-3 font-semibold text-right">Dist Obs</th>
                    <th className="py-2 px-3 font-semibold text-right">Angle Red</th>
                    <th className="py-2 px-3 font-semibold text-right">Dist Red</th>
                    <th className="py-2 px-3 font-semibold text-right">Min Red</th>
                    <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {autoSideshotDiagnostics.candidates.map((row, idx) => (
                    <tr
                      key={`auto-sideshot-${row.sourceLine ?? 'na'}-${row.target}-${idx}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 text-right font-mono">{row.sourceLine ?? '-'}</td>
                      <td className="py-1 px-3 font-mono">{row.occupy}</td>
                      <td className="py-1 px-3 font-mono">{row.backsight}</td>
                      <td className="py-1 px-3 font-mono">{row.target}</td>
                      <td className="py-1 px-3 text-right font-mono">{row.angleObsId}</td>
                      <td className="py-1 px-3 text-right font-mono">{row.distObsId}</td>
                      <td className="py-1 px-3 text-right font-mono">
                        {row.angleRedundancy.toFixed(3)}
                      </td>
                      <td className="py-1 px-3 text-right font-mono">
                        {row.distRedundancy.toFixed(3)}
                      </td>
                      <td className="py-1 px-3 text-right font-mono">
                        {row.minRedundancy.toFixed(3)}
                      </td>
                      <td className="py-1 px-3 text-right font-mono">
                        {row.maxAbsStdRes.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-slate-500">
              No non-redundant M-record sideshot candidates met the current threshold.
            </div>
          )}
        </div>
      )}

      {!isPreanalysis && result.residualDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Residual Diagnostics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300">
            <div>
              <div className="text-slate-500">Obs</div>
              <div>{result.residualDiagnostics.observationCount}</div>
            </div>
            <div>
              <div className="text-slate-500">With StdRes</div>
              <div>{result.residualDiagnostics.withStdResCount}</div>
            </div>
            <div>
              <div className="text-slate-500">|t| &gt; 2 / &gt;3 / &gt;4</div>
              <div>
                {result.residualDiagnostics.over2SigmaCount} /{' '}
                {result.residualDiagnostics.over3SigmaCount} /{' '}
                {result.residualDiagnostics.over4SigmaCount}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Local Fail</div>
              <div className={result.residualDiagnostics.localFailCount > 0 ? 'text-red-400' : ''}>
                {result.residualDiagnostics.localFailCount}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Redundancy (&lt;0.2 / &lt;0.1)</div>
              <div>
                {result.residualDiagnostics.lowRedundancyCount} /{' '}
                {result.residualDiagnostics.veryLowRedundancyCount}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Mean Redund</div>
              <div>
                {result.residualDiagnostics.meanRedundancy != null
                  ? result.residualDiagnostics.meanRedundancy.toFixed(3)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Min Redund</div>
              <div>
                {result.residualDiagnostics.minRedundancy != null
                  ? result.residualDiagnostics.minRedundancy.toFixed(3)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Max |t|</div>
              <div>
                {result.residualDiagnostics.maxStdRes != null
                  ? result.residualDiagnostics.maxStdRes.toFixed(2)
                  : '-'}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500">Worst Observation</div>
              <div className="truncate">
                {result.residualDiagnostics.worst
                  ? `#${result.residualDiagnostics.worst.obsId} ${result.residualDiagnostics.worst.type.toUpperCase()} ${result.residualDiagnostics.worst.stations} line=${result.residualDiagnostics.worst.sourceLine ?? '-'} |t|=${result.residualDiagnostics.worst.stdRes?.toFixed(2) ?? '-'}`
                  : '-'}
              </div>
            </div>
          </div>
          {result.residualDiagnostics.byType.length > 0 && (
            <div className="overflow-x-auto w-full border-t border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">Type</th>
                    <th className="py-2 px-3 font-semibold text-right">Count</th>
                    <th className="py-2 px-3 font-semibold text-right">With StdRes</th>
                    <th className="py-2 px-3 font-semibold text-right">Local Fail</th>
                    <th className="py-2 px-3 font-semibold text-right">&gt;3σ</th>
                    <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                    <th className="py-2 px-3 font-semibold text-right">Mean Redund</th>
                    <th className="py-2 px-3 font-semibold text-right">Min Redund</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {result.residualDiagnostics.byType.map((r) => (
                    <tr key={`resdiag-${r.type}`} className="border-b border-slate-800/50">
                      <td className="py-1 px-3 uppercase">{r.type}</td>
                      <td className="py-1 px-3 text-right">{r.count}</td>
                      <td className="py-1 px-3 text-right">{r.withStdResCount}</td>
                      <td
                        className={`py-1 px-3 text-right ${r.localFailCount > 0 ? 'text-red-400' : ''}`}
                      >
                        {r.localFailCount}
                      </td>
                      <td
                        className={`py-1 px-3 text-right ${r.over3SigmaCount > 0 ? 'text-yellow-300' : ''}`}
                      >
                        {r.over3SigmaCount}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {r.maxStdRes != null ? r.maxStdRes.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {r.meanRedundancy != null ? r.meanRedundancy.toFixed(3) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {r.minRedundancy != null ? r.minRedundancy.toFixed(3) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {result.robustDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Robust Diagnostics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300">
            <div>
              <div className="text-slate-500">Mode</div>
              <div>
                {result.robustDiagnostics.enabled
                  ? result.robustDiagnostics.mode.toUpperCase()
                  : 'OFF'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">k</div>
              <div>{result.robustDiagnostics.k.toFixed(2)}</div>
            </div>
            <div>
              <div className="text-slate-500">Iterations</div>
              <div>{result.robustDiagnostics.iterations.length}</div>
            </div>
            <div>
              <div className="text-slate-500">Final Downweighted</div>
              <div>
                {result.robustDiagnostics.iterations.length > 0
                  ? result.robustDiagnostics.iterations[
                      result.robustDiagnostics.iterations.length - 1
                    ].downweightedRows
                  : 0}
              </div>
            </div>
          </div>
          {result.robustDiagnostics.enabled && result.robustDiagnostics.iterations.length > 0 && (
            <div className="overflow-x-auto w-full border-t border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">Iter</th>
                    <th className="py-2 px-3 font-semibold text-right">Downweighted</th>
                    <th className="py-2 px-3 font-semibold text-right">Mean Weight</th>
                    <th className="py-2 px-3 font-semibold text-right">Min Weight</th>
                    <th className="py-2 px-3 font-semibold text-right">Max |v/sigma|</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {result.robustDiagnostics.iterations.map((it) => (
                    <tr key={`rob-it-${it.iteration}`} className="border-b border-slate-800/50">
                      <td className="py-1 px-3">{it.iteration}</td>
                      <td className="py-1 px-3 text-right">{it.downweightedRows}</td>
                      <td className="py-1 px-3 text-right">{it.meanWeight.toFixed(3)}</td>
                      <td className="py-1 px-3 text-right">{it.minWeight.toFixed(3)}</td>
                      <td className="py-1 px-3 text-right">{it.maxNorm.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.robustDiagnostics.enabled &&
            result.robustDiagnostics.topDownweightedRows.length > 0 && (
              <div className="overflow-x-auto w-full border-t border-slate-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 px-3 font-semibold">#</th>
                      <th className="py-2 px-3 font-semibold">Type</th>
                      <th className="py-2 px-3 font-semibold">Stations</th>
                      <th className="py-2 px-3 font-semibold text-right">Line</th>
                      <th className="py-2 px-3 font-semibold text-right">Weight</th>
                      <th className="py-2 px-3 font-semibold text-right">Norm</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {result.robustDiagnostics.topDownweightedRows.map((r, idx) => (
                      <tr
                        key={`rob-row-${r.obsId}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                        <td className="py-1 px-3 uppercase text-slate-400">{r.type}</td>
                        <td className="py-1 px-3">{r.stations}</td>
                        <td className="py-1 px-3 text-right text-slate-500">
                          {r.sourceLine ?? '-'}
                        </td>
                        <td className="py-1 px-3 text-right">{r.weight.toFixed(3)}</td>
                        <td className="py-1 px-3 text-right">{r.norm.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {!isPreanalysis && result.robustComparison?.enabled && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Robust vs Classical Suspects (Top 10)
          </div>
          <div className="px-3 py-2 text-xs text-slate-400 border-b border-slate-800">
            Overlap: {result.robustComparison.overlapCount}/
            {Math.min(
              result.robustComparison.classicalTop.length,
              result.robustComparison.robustTop.length,
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
            <div className="border-r border-slate-800">
              <div className="px-3 py-2 text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
                Classical
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Type</th>
                    <th className="py-2 px-3 font-semibold">Stations</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold text-right">StdRes</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {result.robustComparison.classicalTop.map((r) => (
                    <tr key={`c-${r.obsId}-${r.rank}`} className="border-b border-slate-800/40">
                      <td className="py-1 px-3 text-slate-500">{r.rank}</td>
                      <td className="py-1 px-3 uppercase text-slate-400">{r.type}</td>
                      <td className="py-1 px-3">{r.stations}</td>
                      <td className="py-1 px-3 text-right text-slate-500">{r.sourceLine ?? '-'}</td>
                      <td className={`py-1 px-3 text-right ${r.localFail ? 'text-red-400' : ''}`}>
                        {r.stdRes != null ? r.stdRes.toFixed(2) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="px-3 py-2 text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
                Robust
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Type</th>
                    <th className="py-2 px-3 font-semibold">Stations</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold text-right">StdRes</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {result.robustComparison.robustTop.map((r) => (
                    <tr key={`r-${r.obsId}-${r.rank}`} className="border-b border-slate-800/40">
                      <td className="py-1 px-3 text-slate-500">{r.rank}</td>
                      <td className="py-1 px-3 uppercase text-slate-400">{r.type}</td>
                      <td className="py-1 px-3">{r.stations}</td>
                      <td className="py-1 px-3 text-right text-slate-500">{r.sourceLine ?? '-'}</td>
                      <td className={`py-1 px-3 text-right ${r.localFail ? 'text-red-400' : ''}`}>
                        {r.stdRes != null ? r.stdRes.toFixed(2) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {result.tsCorrelationDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            TS Correlation Diagnostics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300">
            <div>
              <div className="text-slate-500">Enabled</div>
              <div>{result.tsCorrelationDiagnostics.enabled ? 'ON' : 'OFF'}</div>
            </div>
            <div>
              <div className="text-slate-500">Scope</div>
              <div>{result.tsCorrelationDiagnostics.scope.toUpperCase()}</div>
            </div>
            <div>
              <div className="text-slate-500">Rho</div>
              <div>{result.tsCorrelationDiagnostics.rho.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-slate-500">Groups</div>
              <div>{result.tsCorrelationDiagnostics.groupCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Equations</div>
              <div>{result.tsCorrelationDiagnostics.equationCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Pairs</div>
              <div>{result.tsCorrelationDiagnostics.pairCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Max Group</div>
              <div>{result.tsCorrelationDiagnostics.maxGroupSize}</div>
            </div>
            <div>
              <div className="text-slate-500">Mean|OffDiagW|</div>
              <div>
                {result.tsCorrelationDiagnostics.meanAbsOffDiagWeight != null
                  ? result.tsCorrelationDiagnostics.meanAbsOffDiagWeight.toExponential(3)
                  : '-'}
              </div>
            </div>
          </div>
          {result.tsCorrelationDiagnostics.enabled &&
            result.tsCorrelationDiagnostics.groups.length > 0 && (
              <div className="overflow-x-auto w-full border-t border-slate-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 px-3 font-semibold">#</th>
                      <th className="py-2 px-3 font-semibold">Key</th>
                      <th className="py-2 px-3 font-semibold">Setup</th>
                      <th className="py-2 px-3 font-semibold">Set</th>
                      <th className="py-2 px-3 font-semibold text-right">Rows</th>
                      <th className="py-2 px-3 font-semibold text-right">Pair Count</th>
                      <th className="py-2 px-3 font-semibold text-right">Mean|W|</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {result.tsCorrelationDiagnostics.groups.slice(0, 20).map((g, idx) => (
                      <tr key={`${g.key}-${idx}`} className="border-b border-slate-800/50">
                        <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                        <td className="py-1 px-3 font-mono text-[11px]">{g.key}</td>
                        <td className="py-1 px-3">{g.station}</td>
                        <td className="py-1 px-3">{g.setId ?? '-'}</td>
                        <td className="py-1 px-3 text-right">{g.rows}</td>
                        <td className="py-1 px-3 text-right">{g.pairCount}</td>
                        <td className="py-1 px-3 text-right">
                          {g.meanAbsOffDiagWeight != null
                            ? g.meanAbsOffDiagWeight.toExponential(3)
                            : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}

      {!isPreanalysis && result.traverseDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Traverse Diagnostics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300">
            <div>
              <div className="text-slate-500">Closure Count</div>
              <div>{result.traverseDiagnostics.closureCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Status</div>
              <div
                className={
                  result.traverseDiagnostics.passes?.overall ? 'text-green-400' : 'text-yellow-400'
                }
              >
                {result.traverseDiagnostics.passes?.overall ? 'PASS' : 'WARN'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Misclosure dE ({units})</div>
              <div>{(result.traverseDiagnostics.misclosureE * unitScale).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-slate-500">Misclosure dN ({units})</div>
              <div>{(result.traverseDiagnostics.misclosureN * unitScale).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-slate-500">Misclosure Mag ({units})</div>
              <div>{(result.traverseDiagnostics.misclosureMag * unitScale).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-slate-500">Traverse Dist ({units})</div>
              <div>{(result.traverseDiagnostics.totalTraverseDistance * unitScale).toFixed(4)}</div>
            </div>
            <div>
              <div className="text-slate-500">Closure Ratio</div>
              <div>
                {result.traverseDiagnostics.closureRatio != null
                  ? `1:${result.traverseDiagnostics.closureRatio.toFixed(0)}`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Linear (ppm)</div>
              <div>
                {result.traverseDiagnostics.linearPpm != null
                  ? result.traverseDiagnostics.linearPpm.toFixed(1)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Angular Miscl (")</div>
              <div>
                {result.traverseDiagnostics.angularMisclosureArcSec != null
                  ? result.traverseDiagnostics.angularMisclosureArcSec.toFixed(2)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Vertical Miscl ({units})</div>
              <div>
                {result.traverseDiagnostics.verticalMisclosure != null
                  ? (result.traverseDiagnostics.verticalMisclosure * unitScale).toFixed(4)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Thresholds</div>
              <div className="text-[10px] text-slate-500 leading-tight">
                ratio{' '}
                {result.traverseDiagnostics.thresholds?.minClosureRatio != null
                  ? `1:${result.traverseDiagnostics.thresholds.minClosureRatio}`
                  : '-'}
                , ppm {result.traverseDiagnostics.thresholds?.maxLinearPpm ?? '-'}
              </div>
              <div className="text-[10px] text-slate-500 leading-tight">
                ang {result.traverseDiagnostics.thresholds?.maxAngularArcSec ?? '-'}", dH{' '}
                {result.traverseDiagnostics.thresholds?.maxVerticalMisclosure != null
                  ? (
                      result.traverseDiagnostics.thresholds.maxVerticalMisclosure * unitScale
                    ).toFixed(4)
                  : '-'}
              </div>
            </div>
          </div>
          {traverseLoops.length > 0 && (
            <div className="overflow-x-auto w-full border-t border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Loop</th>
                    <th className="py-2 px-3 font-semibold text-right">Mag ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Dist ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Ratio</th>
                    <th className="py-2 px-3 font-semibold text-right">Linear (ppm)</th>
                    <th className="py-2 px-3 font-semibold text-right">Ang Miscl (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Vert Miscl ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Severity</th>
                    <th className="py-2 px-3 font-semibold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {traverseLoops.map((l, idx) => (
                    <tr key={`trav-loop-${l.key}-${idx}`} className="border-b border-slate-800/50">
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1 px-3">{l.key}</td>
                      <td className="py-1 px-3 text-right">
                        {(l.misclosureMag * unitScale).toFixed(4)}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {(l.traverseDistance * unitScale).toFixed(4)}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {l.closureRatio != null ? `1:${l.closureRatio.toFixed(0)}` : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {l.linearPpm != null ? l.linearPpm.toFixed(1) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {l.angularMisclosureArcSec != null
                          ? l.angularMisclosureArcSec.toFixed(2)
                          : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {l.verticalMisclosure != null
                          ? (l.verticalMisclosure * unitScale).toFixed(4)
                          : '-'}
                      </td>
                      <td className="py-1 px-3 text-right font-mono">{l.severity.toFixed(1)}</td>
                      <td
                        className={`py-1 px-3 text-right ${l.pass ? 'text-green-400' : 'text-yellow-400'}`}
                      >
                        {l.pass ? 'PASS' : 'WARN'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!isPreanalysis && traverseLoopSuspects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Traverse Closure Suspects
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Loop</th>
                <th className="py-2 text-right">Ratio</th>
                <th className="py-2 text-right">Linear (ppm)</th>
                <th className="py-2 text-right">Ang Miscl (")</th>
                <th className="py-2 text-right">Vert Miscl ({units})</th>
                <th className="py-2 text-right">Severity</th>
                <th className="py-2 text-right px-3">Status</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {traverseLoopSuspects.map((l, idx) => (
                <tr key={`trav-suspect-${l.key}-${idx}`} className="border-b border-slate-800/30">
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1">{l.key}</td>
                  <td className="py-1 text-right font-mono">
                    {l.closureRatio != null ? `1:${l.closureRatio.toFixed(0)}` : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {l.linearPpm != null ? l.linearPpm.toFixed(1) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {l.angularMisclosureArcSec != null ? l.angularMisclosureArcSec.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {l.verticalMisclosure != null
                      ? (l.verticalMisclosure * unitScale).toFixed(4)
                      : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">{l.severity.toFixed(1)}</td>
                  <td
                    className={`py-1 px-3 text-right font-mono ${l.pass ? 'text-green-400' : 'text-yellow-400'}`}
                  >
                    {l.pass ? 'PASS' : 'WARN'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gpsLoopDiagnostics?.enabled && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            GPS Loop Diagnostics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300">
            <div>
              <div className="text-slate-500">Vectors</div>
              <div>{gpsLoopDiagnostics.vectorCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Loop Count</div>
              <div>{gpsLoopDiagnostics.loopCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Status</div>
              <div
                className={gpsLoopDiagnostics.warnCount > 0 ? 'text-yellow-400' : 'text-green-400'}
              >
                {gpsLoopDiagnostics.warnCount > 0 ? 'WARN' : 'PASS'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Pass</div>
              <div>{gpsLoopDiagnostics.passCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Warn</div>
              <div>{gpsLoopDiagnostics.warnCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Tolerance</div>
              <div className="font-mono text-[11px]">
                {(gpsLoopDiagnostics.thresholds.baseToleranceM * unitScale).toFixed(4)}
                {units} + {gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist
              </div>
            </div>
          </div>
          {gpsLoopDiagnostics.loops.length > 0 && (
            <div className="overflow-x-auto w-full border-t border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Loop</th>
                    <th className="py-2 px-3 font-semibold">Path</th>
                    <th className="py-2 px-3 font-semibold text-right">Mag ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Tol ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Linear (ppm)</th>
                    <th className="py-2 px-3 font-semibold text-right">Ratio</th>
                    <th className="py-2 px-3 font-semibold text-right">Severity</th>
                    <th className="py-2 px-3 font-semibold text-right">Status</th>
                    <th className="py-2 px-3 font-semibold text-right">Lines</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {gpsLoopDiagnostics.loops.map((loop) => (
                    <tr
                      key={`gps-loop-${loop.key}-${loop.rank}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 text-slate-500">{loop.rank}</td>
                      <td className="py-1 px-3">{loop.key}</td>
                      <td className="py-1 px-3 text-slate-400 font-mono text-[11px]">
                        {loop.stationPath.join('->')}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {(loop.closureMag * unitScale).toFixed(4)}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {(loop.toleranceM * unitScale).toFixed(4)}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-'}
                      </td>
                      <td className="py-1 px-3 text-right font-mono">{loop.severity.toFixed(2)}</td>
                      <td
                        className={`py-1 px-3 text-right ${loop.pass ? 'text-green-400' : 'text-yellow-400'}`}
                      >
                        {loop.pass ? 'PASS' : 'WARN'}
                      </td>
                      <td className="py-1 px-3 text-right text-slate-500">
                        {loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!isPreanalysis && levelingLoopDiagnostics?.enabled && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Leveling Loop Diagnostics
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 p-3 text-xs text-slate-300">
            <div>
              <div className="text-slate-500">Observations</div>
              <div>{levelingLoopDiagnostics.observationCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Loop Count</div>
              <div>{levelingLoopDiagnostics.loopCount}</div>
            </div>
            <div>
              <div className="text-slate-500">Pass / Warn</div>
              <div>
                {levelingLoopDiagnostics.passCount} / {levelingLoopDiagnostics.warnCount}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Total Length (km)</div>
              <div>{levelingLoopDiagnostics.totalLengthKm.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-slate-500">Warn Length (km)</div>
              <div>{levelingLoopDiagnostics.warnTotalLengthKm.toFixed(3)}</div>
            </div>
            <div>
              <div className="text-slate-500">Worst |dH| ({units})</div>
              <div>
                {levelingLoopDiagnostics.worstClosure != null
                  ? (levelingLoopDiagnostics.worstClosure * unitScale).toFixed(4)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Worst mm/sqrt(km)</div>
              <div>
                {levelingLoopDiagnostics.worstClosurePerSqrtKmMm != null
                  ? levelingLoopDiagnostics.worstClosurePerSqrtKmMm.toFixed(2)
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Tolerance Model</div>
              <div className="font-mono text-[11px]">
                {levelingLoopDiagnostics.thresholds.baseMm.toFixed(2)}mm +{' '}
                {levelingLoopDiagnostics.thresholds.perSqrtKmMm.toFixed(2)}mm*sqrt(km)
              </div>
            </div>
            <div>
              <div className="text-slate-500">Worst Loop</div>
              <div className="font-mono">{levelingLoopDiagnostics.worstLoopKey ?? '-'}</div>
            </div>
            <div>
              <div className="text-slate-500">Top Suspect Segment</div>
              <div className="font-mono">
                {levelingLoopDiagnostics.suspectSegments[0]
                  ? `${levelingLoopDiagnostics.suspectSegments[0].from}->${levelingLoopDiagnostics.suspectSegments[0].to}`
                  : '-'}
              </div>
            </div>
          </div>
          {levelingLoopDiagnostics.loops.length > 0 && (
            <div className="overflow-x-auto w-full border-t border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Loop</th>
                    <th className="py-2 px-3 font-semibold">Path</th>
                    <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">|dH| ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Len (km)</th>
                    <th className="py-2 px-3 font-semibold text-right">Tol (mm)</th>
                    <th className="py-2 px-3 font-semibold text-right">mm/sqrt(km)</th>
                    <th className="py-2 px-3 font-semibold text-right">Status</th>
                    <th className="py-2 px-3 font-semibold text-right">Lines</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {levelingLoopDiagnostics.loops.map((loop) => (
                    <tr key={loop.key} className="border-b border-slate-800/50">
                      <td className="py-1 px-3 text-slate-500">{loop.rank}</td>
                      <td className="py-1 px-3">{loop.key}</td>
                      <td className="py-1 px-3">{loop.stationPath.join('->')}</td>
                      <td className="py-1 px-3 text-right">{(loop.closure * unitScale).toFixed(4)}</td>
                      <td className="py-1 px-3 text-right">{(loop.absClosure * unitScale).toFixed(4)}</td>
                      <td className="py-1 px-3 text-right">{loop.loopLengthKm.toFixed(3)}</td>
                      <td className="py-1 px-3 text-right">{loop.toleranceMm.toFixed(2)}</td>
                      <td className="py-1 px-3 text-right">{loop.closurePerSqrtKmMm.toFixed(2)}</td>
                      <td
                        className={`py-1 px-3 text-right ${loop.pass ? 'text-green-400' : 'text-yellow-400'}`}
                      >
                        {loop.pass ? 'PASS' : 'WARN'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {levelingLoopDiagnostics.loops.length > 0 && (
            <div className="overflow-x-auto w-full border-t border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">Loop</th>
                    <th className="py-2 px-3 font-semibold text-right">Seg</th>
                    <th className="py-2 px-3 font-semibold">From</th>
                    <th className="py-2 px-3 font-semibold">To</th>
                    <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Len (km)</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold text-right">Role</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {levelingLoopDiagnostics.loops.flatMap((loop) =>
                    loop.segments.map((segment, index) => (
                      <tr
                        key={`${loop.key}-${index}-${segment.from}-${segment.to}`}
                        className={`border-b border-slate-800/50 ${
                          segment.sourceLine != null &&
                          highlightedLevelingSegmentLines.has(segment.sourceLine)
                            ? 'bg-yellow-950/20'
                            : ''
                        }`}
                      >
                        <td className="py-1 px-3">{loop.key}</td>
                        <td className="py-1 px-3 text-right">{index + 1}</td>
                        <td className="py-1 px-3">{segment.from}</td>
                        <td className="py-1 px-3">{segment.to}</td>
                        <td className="py-1 px-3 text-right">
                          {(segment.observedDh * unitScale).toFixed(4)}
                        </td>
                        <td className="py-1 px-3 text-right">{segment.lengthKm.toFixed(3)}</td>
                        <td className="py-1 px-3 text-right">{segment.sourceLine ?? '-'}</td>
                        <td className="py-1 px-3 text-right">
                          {segment.closureLeg ? 'Closure' : 'Traverse'}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!isPreanalysis && levelingLoopSuspects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Leveling Loop Suspects (ranked)
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Loop</th>
                <th className="py-2">Path</th>
                <th className="py-2 text-right">|dH| ({units})</th>
                <th className="py-2 text-right">Len (km)</th>
                <th className="py-2 text-right">Tol (mm)</th>
                <th className="py-2 text-right">mm/sqrt(km)</th>
                <th className="py-2 text-right px-3">Lines</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {levelingLoopSuspects.map((loop) => (
                <tr key={`level-suspect-${loop.key}`} className="border-b border-slate-800/30">
                  <td className="py-1 px-3 text-slate-500">{loop.rank}</td>
                  <td className="py-1">{loop.key}</td>
                  <td className="py-1">{loop.stationPath.join('->')}</td>
                  <td className="py-1 text-right font-mono">
                    {(loop.absClosure * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 text-right font-mono">{loop.loopLengthKm.toFixed(3)}</td>
                  <td className="py-1 text-right font-mono">{loop.toleranceMm.toFixed(2)}</td>
                  <td className="py-1 text-right font-mono">
                    {loop.closurePerSqrtKmMm.toFixed(2)}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">
                    {loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isPreanalysis && levelingSegmentSuspects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Leveling Segment Suspects
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Segment</th>
                <th className="py-2 text-right">Line</th>
                <th className="py-2 text-right">Warn Loops</th>
                <th className="py-2 text-right">Score</th>
                <th className="py-2 text-right">Max |dH| ({units})</th>
                <th className="py-2 text-right">Worst Loop</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {levelingSegmentSuspects.map((segment) => (
                <tr
                  key={`level-segment-suspect-${segment.key}`}
                  className="border-b border-slate-800/30"
                >
                  <td className="py-1 px-3 text-slate-500">{segment.rank}</td>
                  <td className="py-1 font-mono">
                    {segment.from}
                    {'->'}
                    {segment.to}
                  </td>
                  <td className="py-1 text-right font-mono">{segment.sourceLine ?? '-'}</td>
                  <td className="py-1 text-right font-mono">{segment.warnLoopCount}</td>
                  <td className="py-1 text-right font-mono">{segment.suspectScore.toFixed(2)}</td>
                  <td className="py-1 text-right font-mono">
                    {(segment.maxAbsDh * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 text-right font-mono">{segment.worstLoopKey ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {gpsLoopSuspects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            GPS Loop Suspects (ranked)
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Loop</th>
                <th className="py-2 text-right">Mag ({units})</th>
                <th className="py-2 text-right">Tol ({units})</th>
                <th className="py-2 text-right">Linear (ppm)</th>
                <th className="py-2 text-right">Ratio</th>
                <th className="py-2 text-right">Severity</th>
                <th className="py-2 text-right px-3">Status</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {gpsLoopSuspects.map((loop, idx) => (
                <tr
                  key={`gps-loop-suspect-${loop.key}-${idx}`}
                  className="border-b border-slate-800/30"
                >
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1">{loop.key}</td>
                  <td className="py-1 text-right font-mono">
                    {(loop.closureMag * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {(loop.toleranceM * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">{loop.severity.toFixed(2)}</td>
                  <td className="py-1 px-3 text-right font-mono text-yellow-400">WARN</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isPreanalysis &&
        result.directionSetDiagnostics &&
        result.directionSetDiagnostics.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
              Direction Set Diagnostics
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">Set</th>
                    <th className="py-2 px-3 font-semibold">Occupy</th>
                    <th className="py-2 px-3 font-semibold text-right">Raw</th>
                    <th className="py-2 px-3 font-semibold text-right">Reduced</th>
                    <th className="py-2 px-3 font-semibold text-right">Pairs</th>
                    <th className="py-2 px-3 font-semibold text-right">F1</th>
                    <th className="py-2 px-3 font-semibold text-right">F2</th>
                    <th className="py-2 px-3 font-semibold text-right">Orient (deg)</th>
                    <th className="py-2 px-3 font-semibold text-right">RMS (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Max (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Mean PairDelta (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Max PairDelta (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Mean RawMax (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Max RawMax (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Orient SE (")</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {result.directionSetDiagnostics.map((d) => (
                    <tr key={`${d.setId}-${d.occupy}`} className="border-b border-slate-800/50">
                      <td className="py-1 px-3">{d.setId}</td>
                      <td className="py-1 px-3">{d.occupy}</td>
                      <td className="py-1 px-3 text-right">{d.rawCount}</td>
                      <td className="py-1 px-3 text-right">{d.reducedCount}</td>
                      <td className="py-1 px-3 text-right">{d.pairedTargets}</td>
                      <td className="py-1 px-3 text-right">{d.face1Count}</td>
                      <td className="py-1 px-3 text-right">{d.face2Count}</td>
                      <td className="py-1 px-3 text-right">
                        {d.orientationDeg != null ? d.orientationDeg.toFixed(4) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.meanFacePairDeltaArcSec != null
                          ? d.meanFacePairDeltaArcSec.toFixed(2)
                          : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.maxFacePairDeltaArcSec != null
                          ? d.maxFacePairDeltaArcSec.toFixed(2)
                          : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.meanRawMaxResidualArcSec != null
                          ? d.meanRawMaxResidualArcSec.toFixed(2)
                          : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.maxRawMaxResidualArcSec != null
                          ? d.maxRawMaxResidualArcSec.toFixed(2)
                          : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.orientationSeArcSec != null ? d.orientationSeArcSec.toFixed(2) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {!isPreanalysis &&
        result.directionTargetDiagnostics &&
        result.directionTargetDiagnostics.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
              Direction Target Repeatability (ranked)
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Set</th>
                    <th className="py-2 px-3 font-semibold">Occupy</th>
                    <th className="py-2 px-3 font-semibold">Target</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold text-right">Raw</th>
                    <th className="py-2 px-3 font-semibold text-right">F1</th>
                    <th className="py-2 px-3 font-semibold text-right">F2</th>
                    <th className="py-2 px-3 font-semibold text-right">Spread (")</th>
                    <th className="py-2 px-3 font-semibold text-right">RawMax (")</th>
                    <th className="py-2 px-3 font-semibold text-right">PairDelta (")</th>
                    <th className="py-2 px-3 font-semibold text-right">F1Spread (")</th>
                    <th className="py-2 px-3 font-semibold text-right">F2Spread (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Red Sigma (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Residual (")</th>
                    <th className="py-2 px-3 font-semibold text-right">StdRes</th>
                    <th className="py-2 px-3 font-semibold text-right">Local</th>
                    <th className="py-2 px-3 font-semibold text-right">MDB (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {result.directionTargetDiagnostics.map((d, idx) => (
                    <tr
                      key={`${d.setId}-${d.occupy}-${d.target}-${idx}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1 px-3">{d.setId}</td>
                      <td className="py-1 px-3">{d.occupy}</td>
                      <td className="py-1 px-3">{d.target}</td>
                      <td className="py-1 px-3 text-right text-slate-500">{d.sourceLine ?? '-'}</td>
                      <td className="py-1 px-3 text-right">{d.rawCount}</td>
                      <td className="py-1 px-3 text-right">{d.face1Count}</td>
                      <td className="py-1 px-3 text-right">{d.face2Count}</td>
                      <td className="py-1 px-3 text-right">
                        {d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.rawMaxResidualArcSec != null ? d.rawMaxResidualArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.facePairDeltaArcSec != null ? d.facePairDeltaArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.face1SpreadArcSec != null ? d.face1SpreadArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.face2SpreadArcSec != null ? d.face2SpreadArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.reducedSigmaArcSec != null ? d.reducedSigmaArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.residualArcSec != null ? d.residualArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.stdRes != null ? d.stdRes.toFixed(2) : '-'}
                      </td>
                      <td
                        className={`py-1 px-3 text-right ${d.localPass === false ? 'text-red-400' : ''}`}
                      >
                        {d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.mdbArcSec != null ? d.mdbArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right font-mono">
                        {d.suspectScore.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {directionRejects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Direction Reject Diagnostics
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">#</th>
                  <th className="py-2 px-3 font-semibold">Set</th>
                  <th className="py-2 px-3 font-semibold">Occupy</th>
                  <th className="py-2 px-3 font-semibold">Target</th>
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                  <th className="py-2 px-3 font-semibold">Rec</th>
                  <th className="py-2 px-3 font-semibold">Expected</th>
                  <th className="py-2 px-3 font-semibold">Actual</th>
                  <th className="py-2 px-3 font-semibold">Reason</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {directionRejects.map((r, idx) => (
                  <tr
                    key={`d-rej-${r.setId}-${r.target ?? 'set'}-${r.sourceLine ?? idx}-${idx}`}
                    className="border-b border-slate-800/50"
                  >
                    <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-1 px-3">{r.setId}</td>
                    <td className="py-1 px-3">{r.occupy}</td>
                    <td className="py-1 px-3">{r.target ?? '-'}</td>
                    <td className="py-1 px-3 text-right text-slate-500">{r.sourceLine ?? '-'}</td>
                    <td className="py-1 px-3">{r.recordType ?? '-'}</td>
                    <td className="py-1 px-3">{r.expectedFace ?? '-'}</td>
                    <td className="py-1 px-3">{r.actualFace ?? '-'}</td>
                    <td className="py-1 px-3 text-yellow-300">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isPreanalysis && topDirectionTargetSuspects.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Direction Target Suspects (top)
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Set</th>
                <th className="py-2">Stations</th>
                <th className="py-2 text-right">Spread (")</th>
                <th className="py-2 text-right">StdRes</th>
                <th className="py-2 text-right">Local</th>
                <th className="py-2 text-right px-3">Score</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {topDirectionTargetSuspects.map((d, idx) => (
                <tr
                  key={`dts-${d.setId}-${d.occupy}-${d.target}-${idx}`}
                  className="border-b border-slate-800/30"
                >
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1">{d.setId}</td>
                  <td className="py-1">{`${d.occupy}-${d.target}`}</td>
                  <td className="py-1 text-right font-mono">
                    {d.rawSpreadArcSec != null ? d.rawSpreadArcSec.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {d.stdRes != null ? d.stdRes.toFixed(2) : '-'}
                  </td>
                  <td
                    className={`py-1 text-right font-mono ${d.localPass === false ? 'text-red-400' : ''}`}
                  >
                    {d.localPass == null ? '-' : d.localPass ? 'PASS' : 'FAIL'}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">{d.suspectScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isPreanalysis &&
        result.directionRepeatabilityDiagnostics &&
        result.directionRepeatabilityDiagnostics.length > 0 && (
          <div className="mb-6 border border-slate-800 rounded overflow-hidden">
            <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
              Direction Repeatability By Occupy-Target (multi-set)
            </div>
            <div className="overflow-x-auto w-full">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-800">
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Occupy</th>
                    <th className="py-2 px-3 font-semibold">Target</th>
                    <th className="py-2 px-3 font-semibold text-right">Sets</th>
                    <th className="py-2 px-3 font-semibold text-right">Local Fail</th>
                    <th className="py-2 px-3 font-semibold text-right">Face Unbal</th>
                    <th className="py-2 px-3 font-semibold text-right">Res Mean (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Res RMS (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Res Range (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Res Max (")</th>
                    <th className="py-2 px-3 font-semibold text-right">RMS |t|</th>
                    <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                    <th className="py-2 px-3 font-semibold text-right">Spread Mean (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Spread Max (")</th>
                    <th className="py-2 px-3 font-semibold">Worst Set</th>
                    <th className="py-2 px-3 font-semibold text-right">Line</th>
                    <th className="py-2 px-3 font-semibold text-right">Score</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {result.directionRepeatabilityDiagnostics.map((d, idx) => (
                    <tr
                      key={`dr-${d.occupy}-${d.target}-${idx}`}
                      className="border-b border-slate-800/50"
                    >
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1 px-3">{d.occupy}</td>
                      <td className="py-1 px-3">{d.target}</td>
                      <td className="py-1 px-3 text-right">{d.setCount}</td>
                      <td
                        className={`py-1 px-3 text-right ${d.localFailCount > 0 ? 'text-red-400' : ''}`}
                      >
                        {d.localFailCount}
                      </td>
                      <td className="py-1 px-3 text-right">{d.faceUnbalancedSets}</td>
                      <td className="py-1 px-3 text-right">
                        {d.residualMeanArcSec != null ? d.residualMeanArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.residualRmsArcSec != null ? d.residualRmsArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.residualRangeArcSec != null ? d.residualRangeArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.residualMaxArcSec != null ? d.residualMaxArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.stdResRms != null ? d.stdResRms.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.meanRawSpreadArcSec != null ? d.meanRawSpreadArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {d.maxRawSpreadArcSec != null ? d.maxRawSpreadArcSec.toFixed(2) : '-'}
                      </td>
                      <td className="py-1 px-3 text-slate-400">{d.worstSetId ?? '-'}</td>
                      <td className="py-1 px-3 text-right text-slate-500">{d.worstLine ?? '-'}</td>
                      <td className="py-1 px-3 text-right font-mono">
                        {d.suspectScore.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

      {!isPreanalysis && topDirectionRepeatabilitySuspects.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Direction Repeatability Suspects (top)
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Stations</th>
                <th className="py-2 text-right">Sets</th>
                <th className="py-2 text-right">Res Range (")</th>
                <th className="py-2 text-right">Max |t|</th>
                <th className="py-2 text-right">Spread Max (")</th>
                <th className="py-2 text-right">Local Fail</th>
                <th className="py-2 text-right px-3">Score</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {topDirectionRepeatabilitySuspects.map((d, idx) => (
                <tr
                  key={`drs-${d.occupy}-${d.target}-${idx}`}
                  className="border-b border-slate-800/30"
                >
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1">{`${d.occupy}-${d.target}`}</td>
                  <td className="py-1 text-right font-mono">{d.setCount}</td>
                  <td className="py-1 text-right font-mono">
                    {d.residualRangeArcSec != null ? d.residualRangeArcSec.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {d.maxStdRes != null ? d.maxStdRes.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {d.maxRawSpreadArcSec != null ? d.maxRawSpreadArcSec.toFixed(2) : '-'}
                  </td>
                  <td
                    className={`py-1 text-right font-mono ${d.localFailCount > 0 ? 'text-red-400' : ''}`}
                  >
                    {d.localFailCount}
                  </td>
                  <td className="py-1 px-3 text-right font-mono">{d.suspectScore.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!isPreanalysis && result.setupDiagnostics && result.setupDiagnostics.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            Setup Diagnostics
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">Setup</th>
                  <th className="py-2 px-3 font-semibold text-right">Dir Sets</th>
                  <th className="py-2 px-3 font-semibold text-right">Dir Obs</th>
                  <th className="py-2 px-3 font-semibold text-right">Angles</th>
                  <th className="py-2 px-3 font-semibold text-right">Dist</th>
                  <th className="py-2 px-3 font-semibold text-right">Zen</th>
                  <th className="py-2 px-3 font-semibold text-right">Lev</th>
                  <th className="py-2 px-3 font-semibold text-right">GPS</th>
                  <th className="py-2 px-3 font-semibold text-right">Trav Dist ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">Orient RMS (")</th>
                  <th className="py-2 px-3 font-semibold text-right">Orient SE (")</th>
                  <th className="py-2 px-3 font-semibold text-right">RMS |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                  <th className="py-2 px-3 font-semibold text-right">Local Fail</th>
                  <th className="py-2 px-3 font-semibold">Worst Obs</th>
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {result.setupDiagnostics.map((s) => (
                  <tr key={s.station} className="border-b border-slate-800/50">
                    <td className="py-1 px-3">{s.station}</td>
                    <td className="py-1 px-3 text-right">{s.directionSetCount}</td>
                    <td className="py-1 px-3 text-right">{s.directionObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.angleObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.distanceObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.zenithObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.levelingObsCount}</td>
                    <td className="py-1 px-3 text-right">{s.gpsObsCount}</td>
                    <td className="py-1 px-3 text-right">
                      {(s.traverseDistance * unitScale).toFixed(3)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.orientationRmsArcSec != null ? s.orientationRmsArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.orientationSeArcSec != null ? s.orientationSeArcSec.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">{s.localFailCount}</td>
                    <td className="py-1 px-3 text-slate-400">
                      {s.worstObsType != null
                        ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
                        : '-'}
                    </td>
                    <td className="py-1 px-3 text-right text-slate-500">{s.worstObsLine ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isPreanalysis && setupSuspects.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider text-slate-400">
            Setup Suspects (ranked)
          </div>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800/60">
                <th className="py-2 px-3">#</th>
                <th className="py-2">Setup</th>
                <th className="py-2 text-right">Local Fail</th>
                <th className="py-2 text-right">Max |t|</th>
                <th className="py-2 text-right">RMS |t|</th>
                <th className="py-2">Worst Obs</th>
                <th className="py-2 text-right px-3">Line</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {setupSuspects.map((s, idx) => (
                <tr key={`ss-${s.station}-${idx}`} className="border-b border-slate-800/30">
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1">{s.station}</td>
                  <td
                    className={`py-1 text-right font-mono ${s.localFailCount > 0 ? 'text-red-400' : ''}`}
                  >
                    {s.localFailCount}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {s.maxStdRes != null ? s.maxStdRes.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {s.rmsStdRes != null ? s.rmsStdRes.toFixed(2) : '-'}
                  </td>
                  <td className="py-1 text-slate-400">
                    {s.worstObsType != null
                      ? `${s.worstObsType.toUpperCase()} ${s.worstObsStations ?? ''}`.trim()
                      : '-'}
                  </td>
                  <td className="py-1 px-3 text-right font-mono text-slate-500">
                    {s.worstObsLine ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(tsSideshots.length > 0 || gpsSideshots.length > 0) && (
        <>
          {renderSideshotSection('Post-Adjusted Sideshots (TS)', tsSideshots)}
          {renderSideshotSection('Post-Adjusted GPS Sideshot Vectors', gpsSideshots)}
        </>
      )}

      {gpsOffsetObservations.length > 0 && (
        <div className="mb-8 border border-slate-800 rounded overflow-hidden">
          <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800 bg-slate-900/40">
            GPS Rover Offsets
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">From</th>
                  <th className="py-2 px-3 font-semibold">To</th>
                  <th className="py-2 px-3 font-semibold text-right">G Line</th>
                  <th className="py-2 px-3 font-semibold text-right">G4 Line</th>
                  <th className="py-2 px-3 font-semibold text-right">Az</th>
                  <th className="py-2 px-3 font-semibold text-right">Slope ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">Zenith</th>
                  <th className="py-2 px-3 font-semibold text-right">dE ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">dN ({units})</th>
                  <th className="py-2 px-3 font-semibold text-right">dH ({units})</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {gpsOffsetObservations.map((obs) => (
                  <tr
                    key={`gps-offset-${obs.id}-${obs.gpsOffsetSourceLine ?? obs.sourceLine ?? obs.id}`}
                    className="border-b border-slate-800/30"
                  >
                    <td className="py-1 px-3">{obs.from}</td>
                    <td className="py-1 px-3">{obs.to}</td>
                    <td className="py-1 px-3 text-right">{obs.sourceLine ?? '-'}</td>
                    <td className="py-1 px-3 text-right">{obs.gpsOffsetSourceLine ?? '-'}</td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetAzimuthRad != null ? radToDmsStr(obs.gpsOffsetAzimuthRad) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetDistanceM != null
                        ? (obs.gpsOffsetDistanceM * unitScale).toFixed(4)
                        : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetZenithRad != null ? radToDmsStr(obs.gpsOffsetZenithRad) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetDeltaE != null
                        ? (obs.gpsOffsetDeltaE * unitScale).toFixed(4)
                        : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetDeltaN != null
                        ? (obs.gpsOffsetDeltaN * unitScale).toFixed(4)
                        : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {obs.gpsOffsetDeltaH != null
                        ? (obs.gpsOffsetDeltaH * unitScale).toFixed(4)
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-blue-400 font-bold text-base uppercase tracking-wider">
            {isPreanalysis
              ? `Predicted Coordinates & Precision (${units})`
              : `Adjusted Coordinates (${units})`}
          </h3>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Ellipse</span>
            <div className="flex rounded border border-slate-700 overflow-hidden">
              <button
                onClick={() => setEllipseMode('1sigma')}
                className={`px-2 py-0.5 ${ellipseMode === '1sigma' ? 'bg-slate-700 text-white' : 'bg-slate-900/60 text-slate-400'}`}
              >
                1σ
              </button>
              <button
                onClick={() => setEllipseMode('95')}
                className={`px-2 py-0.5 ${ellipseMode === '95' ? 'bg-slate-700 text-white' : 'bg-slate-900/60 text-slate-400'}`}
              >
                95%
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="text-slate-500 border-b border-slate-800 text-xs">
                <th className="py-2 font-semibold w-20">Stn</th>
                <th className="py-2 font-semibold">Description</th>
                <th className="py-2 font-semibold text-right">Northing</th>
                <th className="py-2 font-semibold text-right">Easting</th>
                <th className="py-2 font-semibold text-right">Height</th>
                <th className="py-2 font-semibold text-right">σN</th>
                <th className="py-2 font-semibold text-right">σE</th>
                <th className="py-2 font-semibold text-right">σH</th>
                <th className="py-2 font-semibold text-center">Type</th>
                <th className="py-2 font-semibold text-right w-32">Ellipse ({ellipseUnit})</th>
                <th className="py-2 font-semibold text-right w-20">Az (deg)</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {Object.entries(result.stations).map(([id, stn]) => (
                <tr
                  key={id}
                  className="border-b border-slate-800/50 hover:bg-slate-900/50 transition-colors"
                >
                  <td className="py-1 font-medium text-white">{id}</td>
                  <td className="py-1 text-xs text-slate-400">{stationDescription(id)}</td>
                  <td className="py-1 text-right text-yellow-100/90">
                    {(stn.y * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 text-right text-yellow-100/90">
                    {(stn.x * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 text-right text-yellow-100/90">
                    {(stn.h * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.sN != null ? (stn.sN * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.sE != null ? (stn.sE * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.sH != null ? (stn.sH * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 text-center">
                    {stn.fixed ? (
                      <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                        FIXED
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">ADJ</span>
                    )}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.errorEllipse
                      ? `${(
                          stn.errorEllipse.semiMajor *
                          ellipseConfidenceScale *
                          ellipseScale *
                          (units === 'ft' ? 0.0328084 : 1)
                        ).toFixed(1)} / ${(
                          stn.errorEllipse.semiMinor *
                          ellipseConfidenceScale *
                          ellipseScale *
                          (units === 'ft' ? 0.0328084 : 1)
                        ).toFixed(1)}`
                      : '-'}
                  </td>
                  <td className="py-1 text-right text-xs text-slate-400">
                    {stn.errorEllipse ? stn.errorEllipse.theta.toFixed(2) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {isPreanalysis && stationCovariances.length > 0 && (
        <div className="mb-4 border border-slate-800 rounded">
          <div
            className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800"
            title={preanalysisLabelTooltip('Station Covariance Blocks Section')}
          >
            Station Covariance Blocks ({units}^2)
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">Station</th>
                  <th className="py-2 px-3 font-semibold text-right">CEE</th>
                  <th className="py-2 px-3 font-semibold text-right">CEN</th>
                  <th className="py-2 px-3 font-semibold text-right">CNN</th>
                  {!result.parseState?.coordMode || result.parseState.coordMode === '3D' ? (
                    <th className="py-2 px-3 font-semibold text-right">CHH</th>
                  ) : null}
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {stationCovariances.map((block) => (
                  <tr
                    key={`station-cov-${block.stationId}`}
                    className="border-b border-slate-800/50"
                  >
                    <td className="py-1 px-3">{block.stationId}</td>
                    <td className="py-1 px-3 text-right">
                      {(block.cEE * covarianceScale).toExponential(4)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(block.cEN * covarianceScale).toExponential(4)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(block.cNN * covarianceScale).toExponential(4)}
                    </td>
                    {!result.parseState?.coordMode || result.parseState.coordMode === '3D' ? (
                      <td className="py-1 px-3 text-right">
                        {block.cHH != null ? (block.cHH * covarianceScale).toExponential(4) : '-'}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isPreanalysis && relativeCovariances.length > 0 && (
        <div className="mb-4 border border-slate-800 rounded">
          <div
            className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800"
            title={preanalysisLabelTooltip('Predicted Relative Precision (Connected Pairs)')}
          >
            Predicted Relative Precision (Connected Pairs)
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">From</th>
                  <th className="py-2 px-3 font-semibold">To</th>
                  <th className="py-2 px-3 font-semibold">Types</th>
                  <th className="py-2 px-3 font-semibold text-right">σN</th>
                  <th className="py-2 px-3 font-semibold text-right">σE</th>
                  <th className="py-2 px-3 font-semibold text-right">σDist</th>
                  <th className="py-2 px-3 font-semibold text-right">σAz (")</th>
                  <th className="py-2 px-3 font-semibold text-right">CEE</th>
                  <th className="py-2 px-3 font-semibold text-right">CEN</th>
                  <th className="py-2 px-3 font-semibold text-right">CNN</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {relativeCovariances.map((rel, idx) => (
                  <tr
                    key={`preanalysis-rel-${rel.from}-${rel.to}-${idx}`}
                    className="border-b border-slate-800/50"
                  >
                    <td className="py-1 px-3">{rel.from}</td>
                    <td className="py-1 px-3">{rel.to}</td>
                    <td className="py-1 px-3 text-slate-400">{rel.connectionTypes.join(', ')}</td>
                    <td className="py-1 px-3 text-right">{(rel.sigmaN * unitScale).toFixed(4)}</td>
                    <td className="py-1 px-3 text-right">{(rel.sigmaE * unitScale).toFixed(4)}</td>
                    <td className="py-1 px-3 text-right">
                      {rel.sigmaDist != null ? (rel.sigmaDist * unitScale).toFixed(4) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {rel.sigmaAz != null ? (rel.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-'}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(rel.cEE * covarianceScale).toExponential(4)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(rel.cEN * covarianceScale).toExponential(4)}
                    </td>
                    <td className="py-1 px-3 text-right">
                      {(rel.cNN * covarianceScale).toExponential(4)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {isPreanalysis && weakGeometryDiagnostics && (
        <div className="mb-8 border border-amber-900/60 rounded overflow-hidden">
          <div
            className="px-3 py-2 text-xs text-amber-200 uppercase tracking-wider border-b border-amber-900/40 bg-amber-950/30"
            title={preanalysisLabelTooltip('Weak Geometry Cues')}
          >
            Weak Geometry Cues
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-amber-900/30">
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Median Station Major')}
              >
                Median Station Major
              </div>
              <div>
                {(weakGeometryDiagnostics.stationMedianHorizontal * unitScale).toFixed(4)} {units}
              </div>
            </div>
            <div>
              <div
                className="text-slate-500"
                title={preanalysisLabelTooltip('Median Pair SigmaDist')}
              >
                Median Pair SigmaDist
              </div>
              <div>
                {weakGeometryDiagnostics.relativeMedianDistance != null
                  ? `${(weakGeometryDiagnostics.relativeMedianDistance * unitScale).toFixed(4)} ${units}`
                  : '-'}
              </div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Station Flags')}>
                Station Flags
              </div>
              <div>{flaggedStationCues.length}</div>
            </div>
            <div>
              <div className="text-slate-500" title={preanalysisLabelTooltip('Pair Flags')}>
                Pair Flags
              </div>
              <div>{flaggedRelativeCues.length}</div>
            </div>
          </div>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 px-3 font-semibold">Scope</th>
                  <th className="py-2 px-3 font-semibold">ID</th>
                  <th className="py-2 px-3 font-semibold">Severity</th>
                  <th className="py-2 px-3 font-semibold text-right">Metric</th>
                  <th className="py-2 px-3 font-semibold text-right">Median Ratio</th>
                  <th className="py-2 px-3 font-semibold text-right">Shape Ratio</th>
                  <th className="py-2 px-3 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {[...flaggedStationCues, ...flaggedRelativeCues].map((cue, idx) => {
                  const isStationCue = 'stationId' in cue;
                  const severityClass =
                    cue.severity === 'weak'
                      ? 'text-red-300'
                      : cue.severity === 'watch'
                        ? 'text-amber-300'
                        : 'text-slate-300';
                  const metric =
                    'horizontalMetric' in cue ? cue.horizontalMetric : cue.distanceMetric;
                  const id = isStationCue ? cue.stationId : `${cue.from}-${cue.to}`;
                  return (
                    <tr key={`weak-geometry-${id}-${idx}`} className="border-b border-slate-800/50">
                      <td className="py-1 px-3 uppercase text-slate-500">
                        {isStationCue ? 'station' : 'pair'}
                      </td>
                      <td className="py-1 px-3">{id}</td>
                      <td className={`py-1 px-3 uppercase font-semibold ${severityClass}`}>
                        {cue.severity}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {metric != null ? `${(metric * unitScale).toFixed(4)} ${units}` : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {cue.relativeToMedian != null ? `${cue.relativeToMedian.toFixed(2)}x` : '-'}
                      </td>
                      <td className="py-1 px-3 text-right">
                        {cue.ellipseRatio != null ? `${cue.ellipseRatio.toFixed(2)}x` : '-'}
                      </td>
                      <td className="py-1 px-3 text-slate-400">{cue.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isPreanalysis && (
        <div className="mb-8">
          <h3 className="text-blue-400 font-bold mb-3 text-base uppercase tracking-wider">
            Observations & Residuals
          </h3>
          <div className="bg-slate-800/50 rounded p-2 mb-2 text-xs text-slate-400 flex items-center justify-between">
            <span>Sorted by |StdRes|</span>
            <span>
              MDB: arcsec (angular) / {units} (linear). Toggle rows to exclude and press Re-run
            </span>
          </div>
          {result.typeSummary && Object.keys(result.typeSummary).length > 0 && (
            <div className="mb-4 border border-slate-800 rounded">
              <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800">
                Per-Type Summary
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 px-3 font-semibold">Type</th>
                      <th className="py-2 px-3 font-semibold text-right">Count</th>
                      <th className="py-2 px-3 font-semibold text-right">RMS</th>
                      <th className="py-2 px-3 font-semibold text-right">Max |Res|</th>
                      <th className="py-2 px-3 font-semibold text-right">Max |StdRes|</th>
                      <th className="py-2 px-3 font-semibold text-right">&gt;3σ</th>
                      <th className="py-2 px-3 font-semibold text-right">&gt;4σ</th>
                      <th className="py-2 px-3 font-semibold text-right">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {Object.entries(result.typeSummary).map(([type, summary]) => (
                      <tr key={type} className="border-b border-slate-800/50">
                        <td className="py-1 px-3 uppercase text-slate-400">{type}</td>
                        <td className="py-1 px-3 text-right">{summary.count}</td>
                        <td className="py-1 px-3 text-right">{summary.rms.toFixed(4)}</td>
                        <td className="py-1 px-3 text-right">{summary.maxAbs.toFixed(4)}</td>
                        <td className="py-1 px-3 text-right">{summary.maxStdRes.toFixed(3)}</td>
                        <td className="py-1 px-3 text-right">{summary.over3}</td>
                        <td className="py-1 px-3 text-right">{summary.over4}</td>
                        <td className="py-1 px-3 text-right">{summary.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {result.relativePrecision && result.relativePrecision.length > 0 && (
            <div className="mb-4 border border-slate-800 rounded">
              <div className="px-3 py-2 text-xs text-slate-400 uppercase tracking-wider border-b border-slate-800">
                Relative Precision (Unknowns)
              </div>
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-800">
                      <th className="py-2 px-3 font-semibold">From</th>
                      <th className="py-2 px-3 font-semibold">To</th>
                      <th className="py-2 px-3 font-semibold text-right">σN</th>
                      <th className="py-2 px-3 font-semibold text-right">σE</th>
                      <th className="py-2 px-3 font-semibold text-right">σDist</th>
                      <th className="py-2 px-3 font-semibold text-right">σAz (")</th>
                      <th className="py-2 px-3 font-semibold text-right">
                        Ellipse ({ellipseUnit})
                      </th>
                      <th className="py-2 px-3 font-semibold text-right">Az (deg)</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-300">
                    {result.relativePrecision.map((rel, idx) => (
                      <tr
                        key={`${rel.from}-${rel.to}-${idx}`}
                        className="border-b border-slate-800/50"
                      >
                        <td className="py-1 px-3">{rel.from}</td>
                        <td className="py-1 px-3">{rel.to}</td>
                        <td className="py-1 px-3 text-right">
                          {(rel.sigmaN * unitScale).toFixed(4)}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {(rel.sigmaE * unitScale).toFixed(4)}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {rel.sigmaDist != null ? (rel.sigmaDist * unitScale).toFixed(4) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {rel.sigmaAz != null ? (rel.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {rel.ellipse
                            ? `${(
                                rel.ellipse.semiMajor *
                                ellipseConfidenceScale *
                                ellipseScale *
                                (units === 'ft' ? 0.0328084 : 1)
                              ).toFixed(1)} / ${(
                                rel.ellipse.semiMinor *
                                ellipseConfidenceScale *
                                ellipseScale *
                                (units === 'ft' ? 0.0328084 : 1)
                              ).toFixed(1)}`
                            : '-'}
                        </td>
                        <td className="py-1 px-3 text-right">
                          {rel.ellipse ? rel.ellipse.theta.toFixed(2) : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {renderTable(byType('angle'), 'Angles (TS)')}
          {renderTable(byType('direction'), 'Directions (DB/DN)')}
          {renderTable(byType('dist'), 'Distances (TS)')}
          {renderTable(byType('bearing'), 'Bearings/Azimuths')}
          {renderTable(byType('dir'), 'Directions (Azimuth)')}
          {renderTable(byType('zenith'), 'Zenith/Vertical Angles')}
          {renderTable(byType('gps'), 'GPS Vectors')}
          {renderTable(byType('lev'), 'Leveling dH')}
        </div>
      )}

      <div className="mt-8 bg-slate-900 p-4 rounded border border-slate-800 font-mono text-xs text-slate-400">
        <div className="font-bold text-slate-300 mb-2 uppercase">Processing Log</div>
        {result.logs.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  );
};

export default ReportView;
