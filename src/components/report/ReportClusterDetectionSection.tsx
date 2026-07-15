import React from 'react';

import { confirmActionGuard } from '../../engine/actionGuards';
import type { AdjustmentResult } from '../../types';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { ReportReviewSelectorModel } from './reportReviewSelectors';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

export const ReportClusterDetectionSection: React.FC<{
  clusterAppliedMerges: ReportReviewSelectorModel['clusterAppliedMerges'];
  clusterCandidates: ReportReviewSelectorModel['clusterCandidates'];
  clusterDiagnostics?: AdjustmentResult['clusterDiagnostics'];
  clusterMergeOutcomes: ReportReviewSelectorModel['clusterMergeOutcomes'];
  clusterRejectedProposals: ReportReviewSelectorModel['clusterRejectedProposals'];
  clusterReviewDecisions: Record<
    string,
    { status: 'pending' | 'approve' | 'reject'; canonicalId: string }
  >;
  clusterReviewStats: ReportReviewSelectorModel['clusterReviewStats'];
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  onApplyClusterMerges: () => void;
  onClearClusterMerges: () => void;
  onClusterCanonicalSelection: (_clusterKey: string, _canonicalId: string) => void;
  onClusterDecisionStatus: (_clusterKey: string, _status: 'pending' | 'approve' | 'reject') => void;
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  onResetClusterReview: () => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
  unitScale: number;
  units: 'm' | 'ft';
}> = ({
  clusterAppliedMerges,
  clusterCandidates,
  clusterDiagnostics,
  clusterMergeOutcomes,
  clusterRejectedProposals,
  clusterReviewDecisions,
  clusterReviewStats,
  isDetailSectionPinned,
  isSectionCollapsed,
  onApplyClusterMerges,
  onClearClusterMerges,
  onClusterCanonicalSelection,
  onClusterDecisionStatus,
  onHeaderRef,
  onResetClusterReview,
  toggleDetailSection,
  togglePinnedDetailSection,
  unitScale,
  units,
}) => {
  if (!clusterDiagnostics?.enabled) return null;
  const sectionId: CollapsibleDetailSectionId = 'cluster-detection-candidates';
  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden" style={{ order: -208 }}>
      <CollapsibleSectionHeader
        sectionId={sectionId}
        label="Cluster Detection Candidates"
        className="px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-800 bg-slate-900/40"
        labelClassName="text-slate-400"
        collapsed={isSectionCollapsed(sectionId)}
        pinned={isDetailSectionPinned(sectionId)}
        onToggleCollapse={toggleDetailSection}
        onTogglePin={togglePinnedDetailSection}
        onHeaderRef={onHeaderRef}
      />
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
      {!isSectionCollapsed(sectionId) &&
        (clusterCandidates.length > 0 ? (
          <>
            <div className="overflow-x-auto w-full">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-800 text-xs bg-slate-900/20">
                <button
                  onClick={() => {
                    const confirmed = confirmActionGuard({
                      action: 'cluster-apply',
                      scope: `${clusterReviewStats.plannedMerges} approved merge(s)`,
                      detail:
                        'This rewrites aliases to canonical IDs for approved candidates and reruns the adjustment.',
                    });
                    if (!confirmed) return;
                    onApplyClusterMerges();
                  }}
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
                    onClick={() => {
                      const confirmed = confirmActionGuard({
                        action: 'cluster-revert',
                        scope: `${clusterAppliedMerges.length} applied merge(s)`,
                        detail:
                          'This clears applied merge decisions and reruns without cluster merge aliases.',
                      });
                      if (!confirmed) return;
                      onClearClusterMerges();
                    }}
                    className="px-3 py-1 rounded border border-amber-600 text-amber-300 hover:bg-amber-900/30"
                  >
                    Clear Applied Merges + Re-run
                  </button>
                )}
              </div>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-700">
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
            {clusterAppliedMerges.length > 0 && (
              <ClusterAppliedMergesTable clusterAppliedMerges={clusterAppliedMerges} />
            )}
            {clusterMergeOutcomes.length > 0 && (
              <ClusterMergeOutcomesTable
                clusterMergeOutcomes={clusterMergeOutcomes}
                unitScale={unitScale}
                units={units}
              />
            )}
            {clusterRejectedProposals.length > 0 && (
              <ClusterRejectedProposalsTable clusterRejectedProposals={clusterRejectedProposals} />
            )}
          </>
        ) : (
          <div className="p-3 text-xs text-slate-500">
            No stations fell inside the current cluster tolerance.
          </div>
        ))}
    </div>
  );
};

const ClusterAppliedMergesTable: React.FC<{
  clusterAppliedMerges: ReportReviewSelectorModel['clusterAppliedMerges'];
}> = ({ clusterAppliedMerges }) => (
  <div className="border-t border-slate-800">
    <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/20">
      Applied Cluster Merges
    </div>
    <div className="overflow-x-auto w-full">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="text-slate-200 border-b border-slate-700">
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
);

const ClusterMergeOutcomesTable: React.FC<{
  clusterMergeOutcomes: ReportReviewSelectorModel['clusterMergeOutcomes'];
  unitScale: number;
  units: 'm' | 'ft';
}> = ({ clusterMergeOutcomes, unitScale, units }) => (
  <div className="border-t border-slate-800">
    <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/20">
      Cluster Merge Outcomes (Delta From Retained Point)
    </div>
    <div className="overflow-x-auto w-full">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="text-slate-200 border-b border-slate-700">
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
                {row.horizontalDelta != null ? (row.horizontalDelta * unitScale).toFixed(4) : '-'}
              </td>
              <td className="py-1 px-3 text-right font-mono">
                {row.spatialDelta != null ? (row.spatialDelta * unitScale).toFixed(4) : '-'}
              </td>
              <td className="py-1 px-3">{row.missing ? 'Missing pass1 data' : 'OK'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const ClusterRejectedProposalsTable: React.FC<{
  clusterRejectedProposals: ReportReviewSelectorModel['clusterRejectedProposals'];
}> = ({ clusterRejectedProposals }) => (
  <div className="border-t border-slate-800">
    <div className="px-3 py-2 text-[11px] uppercase tracking-wider text-slate-500 bg-slate-900/20">
      Rejected Cluster Proposals
    </div>
    <div className="overflow-x-auto w-full">
      <table className="w-full text-left border-collapse text-xs">
        <thead>
          <tr className="text-slate-200 border-b border-slate-700">
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
            <tr key={`cluster-reject-${row.key}-${idx}`} className="border-b border-slate-800/50">
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
);
