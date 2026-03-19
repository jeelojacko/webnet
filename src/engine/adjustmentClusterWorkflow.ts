import type {
  AdjustmentResult,
  ClusterApprovedMerge,
  ClusterMergeOutcome,
  ObservationOverride,
  ParseOptions,
  RunMode,
} from '../types';

export interface ClusterDualPassWorkflowArgs {
  requestedRunMode: RunMode;
  parseOptions?: Partial<ParseOptions>;
  solveScenario: (
    _parseOptions: Partial<ParseOptions>,
    _overrides: Record<number, ObservationOverride> | undefined,
  ) => AdjustmentResult;
  overrides?: Record<number, ObservationOverride>;
}

export const normalizeClusterWorkflowMerges = (
  merges?: ClusterApprovedMerge[],
): ClusterApprovedMerge[] => {
  if (!merges || merges.length === 0) return [];
  const seen = new Set<string>();
  const cleaned = merges
    .map((merge) => ({
      aliasId: String(merge.aliasId ?? '').trim(),
      canonicalId: String(merge.canonicalId ?? '').trim(),
    }))
    .filter((merge) => merge.aliasId && merge.canonicalId && merge.aliasId !== merge.canonicalId);
  cleaned.sort(
    (a, b) =>
      a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
      a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
  );
  return cleaned.filter((merge) => {
    const key = `${merge.aliasId}|${merge.canonicalId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const buildClusterMergeOutcomes = (
  pass1Result: AdjustmentResult,
  merges: ClusterApprovedMerge[],
): ClusterMergeOutcome[] => {
  const is2D = (pass1Result.parseState?.coordMode ?? '3D') === '2D';
  return merges
    .map((merge) => {
      const alias = pass1Result.stations[merge.aliasId];
      const canonical = pass1Result.stations[merge.canonicalId];
      if (!alias || !canonical) {
        return {
          aliasId: merge.aliasId,
          canonicalId: merge.canonicalId,
          missing: true,
        };
      }
      const deltaE = alias.x - canonical.x;
      const deltaN = alias.y - canonical.y;
      const deltaH = is2D ? undefined : alias.h - canonical.h;
      const horizontalDelta = Math.hypot(deltaE, deltaN);
      const spatialDelta =
        deltaH == null
          ? horizontalDelta
          : Math.sqrt(deltaE * deltaE + deltaN * deltaN + deltaH * deltaH);
      return {
        aliasId: merge.aliasId,
        canonicalId: merge.canonicalId,
        aliasE: alias.x,
        aliasN: alias.y,
        aliasH: is2D ? undefined : alias.h,
        canonicalE: canonical.x,
        canonicalN: canonical.y,
        canonicalH: is2D ? undefined : canonical.h,
        deltaE,
        deltaN,
        deltaH,
        horizontalDelta,
        spatialDelta,
      };
    })
    .sort(
      (a, b) =>
        a.canonicalId.localeCompare(b.canonicalId, undefined, { numeric: true }) ||
        a.aliasId.localeCompare(b.aliasId, undefined, { numeric: true }),
    );
};

const formatClusterMergeOutcomeLog = (row: ClusterMergeOutcome): string => {
  if (row.missing) {
    return `  merge ${row.aliasId}->${row.canonicalId}: missing station data in pass1`;
  }
  return `  merge ${row.aliasId}->${row.canonicalId}: dE=${(row.deltaE ?? 0).toFixed(4)}m dN=${(row.deltaN ?? 0).toFixed(4)}m dH=${row.deltaH != null ? `${row.deltaH.toFixed(4)}m` : '-'} d2D=${(row.horizontalDelta ?? 0).toFixed(4)}m d3D=${row.spatialDelta != null ? `${row.spatialDelta.toFixed(4)}m` : '-'}`;
};

export const runClusterDualPassWorkflow = ({
  requestedRunMode,
  parseOptions,
  solveScenario,
  overrides,
}: ClusterDualPassWorkflowArgs): AdjustmentResult | null => {
  const passLabel = parseOptions?.clusterPassLabel ?? 'single';
  const approvedMerges = normalizeClusterWorkflowMerges(parseOptions?.clusterApprovedMerges);
  if (requestedRunMode !== 'adjustment' || approvedMerges.length === 0 || passLabel === 'pass2') {
    return null;
  }

  const pass1Options: Partial<ParseOptions> = {
    ...(parseOptions ?? {}),
    clusterApprovedMerges: [],
    clusterPassLabel: 'pass1',
    clusterDualPassRan: false,
    clusterApprovedMergeCount: 0,
  };
  const pass1Result = solveScenario(pass1Options, overrides);

  const pass2Options: Partial<ParseOptions> = {
    ...(parseOptions ?? {}),
    clusterApprovedMerges: approvedMerges,
    clusterPassLabel: 'pass2',
    clusterDualPassRan: true,
    clusterApprovedMergeCount: approvedMerges.length,
  };
  const pass2Result = solveScenario(pass2Options, overrides);
  const mergeOutcomes = buildClusterMergeOutcomes(pass1Result, approvedMerges);

  pass2Result.parseState = {
    ...(pass2Result.parseState ?? ({} as ParseOptions)),
    clusterPassLabel: 'pass2',
    clusterDualPassRan: true,
    clusterApprovedMergeCount: approvedMerges.length,
  };

  if (pass2Result.clusterDiagnostics) {
    pass2Result.clusterDiagnostics.passMode = 'dual-pass';
    pass2Result.clusterDiagnostics.pass1CandidateCount =
      pass1Result.clusterDiagnostics?.candidateCount ?? 0;
    pass2Result.clusterDiagnostics.approvedMergeCount = approvedMerges.length;
    pass2Result.clusterDiagnostics.appliedMerges = approvedMerges;
    pass2Result.clusterDiagnostics.mergeOutcomes = mergeOutcomes;
  }

  pass2Result.logs = [
    `Cluster dual-pass: pass1 candidates=${pass1Result.clusterDiagnostics?.candidateCount ?? 0}, approved merges=${approvedMerges.length}`,
    ...mergeOutcomes.slice(0, 20).map(formatClusterMergeOutcomeLog),
    ...pass2Result.logs,
  ];
  return pass2Result;
};
