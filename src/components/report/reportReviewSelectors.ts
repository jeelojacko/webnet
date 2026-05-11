import {
  buildResultTraceabilityModel,
  type ResultTraceabilityModel,
} from '../../engine/resultDerivedModels';
import type {
  AdjustmentResult,
  AutoSideshotDiagnostics,
  ClusterApprovedMerge,
  GpsObservation,
} from '../../types';

type ClusterCandidate = NonNullable<NonNullable<AdjustmentResult['clusterDiagnostics']>['candidates']>[number];
type ClusterMergeOutcome = NonNullable<
  NonNullable<AdjustmentResult['clusterDiagnostics']>['mergeOutcomes']
>[number];
type ClusterRejectedProposal = NonNullable<
  NonNullable<AdjustmentResult['clusterDiagnostics']>['rejectedProposals']
>[number];
type SideshotRow = NonNullable<AdjustmentResult['sideshots']>[number];

type ClusterReviewDecision = {
  status: 'pending' | 'approve' | 'reject';
  canonicalId: string;
};

export interface ReportClusterReviewStats {
  approved: number;
  rejected: number;
  pending: number;
  plannedMerges: number;
}

export interface ReportReviewSelectorModel extends ResultTraceabilityModel {
  clusterCandidates: ClusterCandidate[];
  clusterAppliedMerges: ClusterApprovedMerge[];
  clusterMergeOutcomes: ClusterMergeOutcome[];
  clusterRejectedProposals: ClusterRejectedProposal[];
  clusterReviewStats: ReportClusterReviewStats;
  autoSideshotObsIds: Set<number>;
  tsSideshots: SideshotRow[];
  gpsSideshots: SideshotRow[];
  gpsVectorSideshots: SideshotRow[];
  gpsCoordinateSideshots: SideshotRow[];
  gpsOffsetObservations: GpsObservation[];
}

const buildClusterReviewStats = (
  clusterCandidates: ClusterCandidate[],
  clusterReviewDecisions: Record<string, ClusterReviewDecision>,
): ReportClusterReviewStats =>
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
  );

const buildAutoSideshotObsIds = (
  autoSideshotDiagnostics?: AutoSideshotDiagnostics,
): Set<number> =>
  new Set(autoSideshotDiagnostics?.candidates.flatMap((c) => [c.angleObsId, c.distObsId]) ?? []);

export const buildReportReviewSelectorModel = (input: {
  parseState: AdjustmentResult['parseState'];
  clusterDiagnostics?: AdjustmentResult['clusterDiagnostics'];
  activeClusterApprovedMerges: ClusterApprovedMerge[];
  clusterReviewDecisions: Record<string, ClusterReviewDecision>;
  autoSideshotDiagnostics?: AutoSideshotDiagnostics;
  sideshots?: AdjustmentResult['sideshots'];
  observations: AdjustmentResult['observations'];
}): ReportReviewSelectorModel => {
  const traceabilityModel = buildResultTraceabilityModel(input.parseState);
  const clusterCandidates = input.clusterDiagnostics?.candidates ?? [];
  const clusterAppliedMerges =
    input.clusterDiagnostics?.appliedMerges && input.clusterDiagnostics.appliedMerges.length > 0
      ? input.clusterDiagnostics.appliedMerges
      : input.activeClusterApprovedMerges;
  const clusterMergeOutcomes = input.clusterDiagnostics?.mergeOutcomes ?? [];
  const clusterRejectedProposals = input.clusterDiagnostics?.rejectedProposals ?? [];
  const clusterReviewStats = buildClusterReviewStats(
    clusterCandidates,
    input.clusterReviewDecisions,
  );
  const autoSideshotObsIds = buildAutoSideshotObsIds(input.autoSideshotDiagnostics);
  const tsSideshots = (input.sideshots ?? []).filter((s) => s.mode !== 'gps');
  const gpsSideshots = (input.sideshots ?? []).filter((s) => s.mode === 'gps');
  const gpsVectorSideshots = gpsSideshots.filter((s) => s.sourceType !== 'GS');
  const gpsCoordinateSideshots = gpsSideshots.filter((s) => s.sourceType === 'GS');
  const gpsOffsetObservations = input.observations.filter(
    (obs): obs is GpsObservation => obs.type === 'gps' && obs.gpsOffsetDistanceM != null,
  );

  return {
    ...traceabilityModel,
    clusterCandidates,
    clusterAppliedMerges,
    clusterMergeOutcomes,
    clusterRejectedProposals,
    clusterReviewStats,
    autoSideshotObsIds,
    tsSideshots,
    gpsSideshots,
    gpsVectorSideshots,
    gpsCoordinateSideshots,
    gpsOffsetObservations,
  };
};
