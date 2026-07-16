import type { ResultTraceabilityModel } from './resultDerivedModels';
import type { AdjustmentResult } from '../types';

type AppendIndustryListingDiagnosticsSectionsOptions = {
  autoAdjustDiagnostics: AdjustmentResult['autoAdjustDiagnostics'];
  autoSideshotDiagnostics: AdjustmentResult['autoSideshotDiagnostics'];
  clusterDiagnostics: AdjustmentResult['clusterDiagnostics'];
  descriptionAppendDelimiter: string;
  descriptionReconcileMode: string;
  linearUnit: string;
  lines: string[];
  traceabilityModel: ResultTraceabilityModel;
  unitScale: number;
};

const appendAutoAdjustDiagnostics = ({
  autoAdjustDiagnostics: ad,
  lines,
}: Pick<AppendIndustryListingDiagnosticsSectionsOptions, 'autoAdjustDiagnostics' | 'lines'>) => {
  if (!ad?.enabled) return;
  lines.push('');
  lines.push('                             Auto-Adjust Diagnostics');
  lines.push('                             =======================');
  lines.push('');
  lines.push(
    `Threshold: |t|>=${ad.threshold.toFixed(2)}   MaxCycles: ${ad.maxCycles}   MaxRemovals/Cycle: ${ad.maxRemovalsPerCycle}   MinRedund: ${ad.minRedundancy.toFixed(2)}   Stop: ${ad.stopReason}   Removed: ${ad.removed.length}`,
  );
  lines.push('Cycle      SEUW      Max|t|   Removals');
  ad.cycles.forEach((cycle) => {
    lines.push(
      `${String(cycle.cycle).padStart(5)} ${cycle.seuw.toFixed(4).padStart(10)} ${cycle.maxAbsStdRes.toFixed(2).padStart(9)} ${String(cycle.removals.length).padStart(10)}`,
    );
  });
  if (ad.removed.length === 0) return;
  lines.push('');
  lines.push('Removed Observations');
  lines.push('ObsID    Type        Stations                 Line    |t|     Redund   Reason');
  ad.removed.forEach((row) => {
    lines.push(
      `${String(row.obsId).padStart(5)}    ${row.type.toUpperCase().padEnd(10)}  ${row.stations.padEnd(22)}  ${String(row.sourceLine ?? '-').padStart(4)}  ${row.stdRes.toFixed(2).padStart(6)}  ${(row.redundancy != null ? row.redundancy.toFixed(3) : '-').padStart(7)}  ${row.reason}`,
    );
  });
};

const appendAutoSideshotDiagnostics = ({
  autoSideshotDiagnostics: sd,
  lines,
}: Pick<AppendIndustryListingDiagnosticsSectionsOptions, 'autoSideshotDiagnostics' | 'lines'>) => {
  if (!sd?.enabled || sd.candidateCount <= 0) return;
  lines.push('');
  lines.push('                         Auto Sideshot Candidates (M Records)');
  lines.push('                         =====================================');
  lines.push('');
  lines.push(
    `Evaluated: ${sd.evaluatedCount}   Candidates: ${sd.candidateCount}   Excluded Control Targets: ${sd.excludedControlCount}   Threshold: minRedund < ${sd.threshold.toFixed(2)}`,
  );
  if (sd.candidates.length === 0) {
    lines.push('(none)');
    return;
  }
  lines.push(
    'Line    Occupy       Backsight    Target      AngleObs  DistObs  AngleRed  DistRed   MinRed   Max|t|',
  );
  sd.candidates.forEach((row) => {
    lines.push(
      `${String(row.sourceLine ?? '-').padStart(4)}    ${row.occupy.padEnd(10)} ${row.backsight.padEnd(12)} ${row.target.padEnd(10)} ${String(row.angleObsId).padStart(8)} ${String(row.distObsId).padStart(8)} ${row.angleRedundancy.toFixed(3).padStart(8)} ${row.distRedundancy.toFixed(3).padStart(8)} ${row.minRedundancy.toFixed(6)} ${row.maxAbsStdRes.toFixed(2).padStart(8)}`,
    );
  });
};

const appendClusterDiagnostics = ({
  clusterDiagnostics: diagnostics,
  linearUnit,
  lines,
  unitScale,
}: Pick<
  AppendIndustryListingDiagnosticsSectionsOptions,
  'clusterDiagnostics' | 'linearUnit' | 'lines' | 'unitScale'
>) => {
  if (!diagnostics?.enabled) return;
  const outcomes = diagnostics.mergeOutcomes ?? [];
  const rejected = diagnostics.rejectedProposals ?? [];
  lines.push('');
  lines.push('                          Cluster Detection Candidates');
  lines.push('                          ============================');
  lines.push('');
  lines.push(
    `Pass: ${diagnostics.passMode.toUpperCase()}   Mode: ${diagnostics.linkageMode.toUpperCase()}   Dim: ${diagnostics.dimension}   Tol: ${(diagnostics.tolerance * unitScale).toFixed(4)} ${linearUnit}   PairHits: ${diagnostics.pairCount}   Candidates: ${diagnostics.candidateCount}   ApprovedMerges: ${diagnostics.approvedMergeCount ?? 0}   MergeOutcomes: ${outcomes.length}   Rejected: ${rejected.length}`,
  );
  if (diagnostics.candidates.length > 0) {
    lines.push(
      'Key               Rep          Members   MaxSep        MeanSep       Flags           Station IDs',
    );
    diagnostics.candidates.forEach((c) => {
      const flags = `${c.hasFixed ? 'fixed' : 'free'}${c.hasUnknown ? '+unknown' : ''}`;
      lines.push(
        `${c.key.padEnd(17)} ${c.representativeId.padEnd(12)} ${String(c.memberCount).padStart(7)} ${(c.maxSeparation * unitScale).toFixed(4).padStart(12)} ${(c.meanSeparation * unitScale).toFixed(4).padStart(12)} ${flags.padEnd(15)} ${c.stationIds.join(', ')}`,
      );
    });
  }
  if (outcomes.length > 0) {
    lines.push('');
    lines.push('                     Cluster Merge Outcomes (Delta From Retained Point)');
    lines.push('                     ====================================================');
    lines.push('');
    lines.push(
      'Alias             Canonical         dE           dN           dH           d2D          d3D          Status',
    );
    outcomes.forEach((row) => {
      lines.push(
        `${row.aliasId.padEnd(17)} ${row.canonicalId.padEnd(17)} ${(row.deltaE != null ? (row.deltaE * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaN != null ? (row.deltaN * unitScale).toFixed(4) : '-').padStart(12)} ${(row.deltaH != null ? (row.deltaH * unitScale).toFixed(4) : '-').padStart(12)} ${(row.horizontalDelta != null ? (row.horizontalDelta * unitScale).toFixed(4) : '-').padStart(12)} ${(row.spatialDelta != null ? (row.spatialDelta * unitScale).toFixed(4) : '-').padStart(12)} ${row.missing ? 'MISSING PASS1 DATA' : 'OK'}`,
      );
    });
  }
  if (rejected.length === 0) return;
  lines.push('');
  lines.push('                               Rejected Cluster Proposals');
  lines.push('                               ==========================');
  lines.push('');
  lines.push(
    'Key               Rep          Members   Retained       Station IDs                      Reason',
  );
  rejected.forEach((row) => {
    lines.push(
      `${row.key.padEnd(17)} ${row.representativeId.padEnd(12)} ${String(row.memberCount).padStart(7)} ${(row.retainedId ?? '-').padEnd(14)} ${row.stationIds.join(', ').padEnd(30)} ${row.reason}`,
    );
  });
};

const appendDescriptionReconciliationSummary = ({
  descriptionAppendDelimiter,
  descriptionReconcileMode,
  lines,
  traceabilityModel,
}: Pick<
  AppendIndustryListingDiagnosticsSectionsOptions,
  'descriptionAppendDelimiter' | 'descriptionReconcileMode' | 'lines' | 'traceabilityModel'
>) => {
  const { descriptionRefsByStation, descriptionScanSummary } = traceabilityModel;
  if (descriptionScanSummary.length === 0) return;
  lines.push('');
  lines.push('                     Description Reconciliation Summary');
  lines.push('                     ==================================');
  lines.push('');
  lines.push(
    `Mode: ${descriptionReconcileMode.toUpperCase()}${descriptionReconcileMode === 'append' ? ` (delimiter="${descriptionAppendDelimiter}")` : ''}   Stations: ${descriptionScanSummary.length}   Repeated: ${traceabilityModel.descriptionRepeatedStationCount}   Conflicts: ${traceabilityModel.descriptionConflictCount}`,
  );
  lines.push('Station      Records  Unique  Conflict  Description@Lines');
  descriptionScanSummary
    .slice()
    .sort((a, b) => a.stationId.localeCompare(b.stationId, undefined, { numeric: true }))
    .forEach((row) => {
      const details = (descriptionRefsByStation.get(row.stationId) ?? [])
        .map((detail) => {
          const linesRef = detail.lines
            .slice()
            .sort((a, b) => a - b)
            .join(',');
          return `${detail.description}[${linesRef}]`;
        })
        .join('; ');
      lines.push(
        `${row.stationId.padEnd(11)}${String(row.recordCount).padStart(8)}${String(row.uniqueCount).padStart(8)}  ${(row.conflict ? 'YES' : 'no ').padEnd(8)}  ${details || '-'}`,
      );
    });
};

const appendAliasTrace = ({
  lines,
  traceabilityModel,
}: Pick<AppendIndustryListingDiagnosticsSectionsOptions, 'lines' | 'traceabilityModel'>) => {
  if (traceabilityModel.aliasTrace.length === 0) return;
  lines.push('');
  lines.push('                          Alias Canonicalization Trace');
  lines.push('                          ============================');
  lines.push('');
  lines.push(
    'Context    Detail              Line  Source Alias         Canonical ID         Reference',
  );
  traceabilityModel.aliasTrace.forEach((entry) => {
    lines.push(
      `${entry.context.padEnd(10)}${(entry.detail ?? '-').padEnd(20)}${String(entry.sourceLine ?? '-').padStart(6)}  ${entry.sourceId.padEnd(20)}${entry.canonicalId.padEnd(20)}${entry.reference ?? '-'}`,
    );
  });
};

export const appendIndustryListingDiagnosticsSections = (
  options: AppendIndustryListingDiagnosticsSectionsOptions,
) => {
  appendAutoAdjustDiagnostics(options);
  appendAutoSideshotDiagnostics(options);
  appendClusterDiagnostics(options);
  appendDescriptionReconciliationSummary(options);
  appendAliasTrace(options);
};
