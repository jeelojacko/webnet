import type { ClusterReviewDecision } from '../appStateTypes';
import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  ClusterRejectedProposal,
} from '../types';

export type ClusterCandidate = NonNullable<
  AdjustmentResult['clusterDiagnostics']
>['candidates'][number];

export type RunReviewContext = {
  candidates: ClusterCandidate[];
  decisions: Record<string, ClusterReviewDecision>;
};

const normalizeClusterApprovedMerges = (
  merges: ClusterApprovedMerge[],
): ClusterApprovedMerge[] => {
  const byAlias = new Map<string, string>();
  merges
    .map((merge) => ({
      aliasId: String(merge.aliasId ?? '').trim(),
      canonicalId: String(merge.canonicalId ?? '').trim(),
    }))
    .filter((merge) => merge.aliasId && merge.canonicalId && merge.aliasId !== merge.canonicalId)
    .sort(
      (a, b) =>
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }) ||
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }),
    )
    .forEach((merge) => {
      const prior = byAlias.get(merge.aliasId);
      if (!prior) {
        byAlias.set(merge.aliasId, merge.canonicalId);
        return;
      }
      if (merge.canonicalId.localeCompare(prior, undefined, { numeric: true }) < 0) {
        byAlias.set(merge.aliasId, merge.canonicalId);
      }
    });
  return [...byAlias.entries()]
    .map(([aliasId, canonicalId]) => ({ aliasId, canonicalId }))
    .sort(
      (a, b) =>
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
    );
};

export const buildApprovedClusterMerges = (
  result: AdjustmentResult | null,
  decisions: Record<string, ClusterReviewDecision>,
): ClusterApprovedMerge[] => {
  const candidates = result?.clusterDiagnostics?.candidates ?? [];
  const merges: ClusterApprovedMerge[] = [];
  candidates.forEach((candidate) => {
    const decision = decisions[candidate.key];
    if (!decision || decision.status !== 'approve') return;
    const canonicalId = candidate.stationIds.includes(decision.canonicalId)
      ? decision.canonicalId
      : candidate.representativeId;
    candidate.stationIds.forEach((stationId) => {
      if (stationId === canonicalId) return;
      merges.push({ aliasId: stationId, canonicalId });
    });
  });
  return normalizeClusterApprovedMerges(merges);
};

export const buildPendingClusterReviewDecisions = (
  candidates: ClusterCandidate[],
  priorDecisions: Record<string, ClusterReviewDecision> = {},
): Record<string, ClusterReviewDecision> => {
  const next: Record<string, ClusterReviewDecision> = {};
  candidates.forEach((candidate) => {
    const prior = priorDecisions[candidate.key];
    const canonicalId =
      prior && candidate.stationIds.includes(prior.canonicalId)
        ? prior.canonicalId
        : candidate.representativeId;
    next[candidate.key] = {
      status: prior?.status ?? 'pending',
      canonicalId,
    };
  });
  return next;
};

export const buildRejectedClusterProposals = (
  candidates: ClusterCandidate[],
  decisions: Record<string, ClusterReviewDecision>,
): ClusterRejectedProposal[] => {
  const rows: ClusterRejectedProposal[] = [];
  candidates.forEach((candidate) => {
    const decision = decisions[candidate.key];
    if (!decision || decision.status !== 'reject') return;
    const retainedId =
      decision.canonicalId && candidate.stationIds.includes(decision.canonicalId)
        ? decision.canonicalId
        : undefined;
    rows.push({
      key: candidate.key,
      representativeId: candidate.representativeId,
      stationIds: [...candidate.stationIds],
      memberCount: candidate.memberCount,
      retainedId,
      reason: 'Rejected by user review',
    });
  });
  return rows.sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
};

export const buildClusterReviewDecisionsFromState = (
  result: AdjustmentResult,
  approvedMerges: ClusterApprovedMerge[],
): Record<string, ClusterReviewDecision> => {
  const decisions: Record<string, ClusterReviewDecision> = {};
  const approvedByAlias = new Map<string, string>();
  approvedMerges.forEach((merge) => {
    approvedByAlias.set(merge.aliasId, merge.canonicalId);
  });
  const rejectedKeys = new Map(
    (result.clusterDiagnostics?.rejectedProposals ?? []).map((entry) => [entry.key, entry]),
  );
  (result.clusterDiagnostics?.candidates ?? []).forEach((candidate) => {
    const rejected = rejectedKeys.get(candidate.key);
    if (rejected) {
      decisions[candidate.key] = {
        status: 'reject',
        canonicalId:
          rejected.retainedId && candidate.stationIds.includes(rejected.retainedId)
            ? rejected.retainedId
            : candidate.representativeId,
      };
      return;
    }
    const approvedCanonicalId = candidate.stationIds.find(
      (stationId) => approvedByAlias.get(stationId) != null,
    );
    const canonicalId =
      candidate.stationIds.find(
        (stationId) =>
          candidate.stationIds.includes(stationId) &&
          candidate.stationIds.some((memberId) => approvedByAlias.get(memberId) === stationId),
      ) ?? approvedCanonicalId ?? candidate.representativeId;
    const isApproved = candidate.stationIds.some(
      (stationId) => approvedByAlias.get(stationId) === canonicalId,
    );
    decisions[candidate.key] = {
      status: isApproved ? 'approve' : 'pending',
      canonicalId,
    };
  });
  return decisions;
};
