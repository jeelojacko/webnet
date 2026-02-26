import React, { useMemo } from 'react';
import type { AdjustmentResult, Observation } from '../types';

interface ProcessingSummaryViewProps {
  result: AdjustmentResult;
  runElapsedMs: number | null;
  runDiagnostics: {
    solveProfile: 'webnet' | 'industry-parity';
    directionSetMode: 'reduced' | 'raw';
    profileDefaultInstrumentFallback: boolean;
  } | null;
}

type SummaryRow = {
  label: string;
  count: number;
  sumSquares: number;
  errorFactor: number;
};

const classifyRow = (obs: Observation): string => {
  if (obs.type === 'angle') return 'Angles';
  if (obs.type === 'dist') return 'Distances';
  if (obs.type === 'direction' || obs.type === 'dir' || obs.type === 'bearing') return 'Az/Bearings';
  if (obs.type === 'gps') return 'GPS';
  if (obs.type === 'lev') return 'Leveling';
  if (obs.type === 'zenith') return 'Zenith';
  return obs.type.toUpperCase();
};

const elapsedStr = (ms: number | null): string => {
  if (!ms || !Number.isFinite(ms) || ms < 0) return '00:00:00';
  const seconds = Math.round(ms / 1000);
  const hh = Math.floor(seconds / 3600);
  const mm = Math.floor((seconds % 3600) / 60);
  const ss = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
};

const padRight = (value: string, width: number) => value.padEnd(width, ' ');
const padLeft = (value: string, width: number) => value.padStart(width, ' ');

const ProcessingSummaryView: React.FC<ProcessingSummaryViewProps> = ({
  result,
  runElapsedMs,
  runDiagnostics,
}) => {
  const text = useMemo(() => {
    let summaryRows: SummaryRow[] = [];
    let totalCount = 0;
    if (result.statisticalSummary?.byGroup?.length) {
      summaryRows = result.statisticalSummary.byGroup.map((row) => ({
        label: row.label,
        count: row.count,
        sumSquares: row.sumSquares,
        errorFactor: row.errorFactor,
      }));
      totalCount = result.statisticalSummary.totalCount;
    } else {
      const rowsMap = new Map<string, { count: number; sumSquares: number }>();
      result.observations.forEach((obs) => {
        if (!Number.isFinite(obs.stdRes)) return;
        const key = classifyRow(obs);
        const sumSq = (obs.stdRes ?? 0) * (obs.stdRes ?? 0);
        const row = rowsMap.get(key) ?? { count: 0, sumSquares: 0 };
        row.count += 1;
        row.sumSquares += sumSq;
        rowsMap.set(key, row);
        totalCount += 1;
      });
      summaryRows = [...rowsMap.entries()]
        .map(([label, row]) => ({
          label,
          count: row.count,
          sumSquares: row.sumSquares,
          errorFactor: row.count > 0 ? Math.sqrt(row.sumSquares / row.count) : 0,
        }))
        .sort((a, b) => a.label.localeCompare(b.label));
    }

    const lines: string[] = [];
    lines.push('Loading Network Data ...');
    lines.push('Checking Network Data ...');
    lines.push('');
    lines.push('Performing Network Adjustment ...');
    for (let i = 1; i <= result.iterations; i += 1) {
      lines.push(`  Iteration # ${i}`);
    }
    lines.push(
      result.converged
        ? `Solution has converged in ${result.iterations} iterations`
        : `Solution did not fully converge after ${result.iterations} iterations`,
    );
    lines.push('');
    lines.push('Statistical Summary');
    lines.push(`${padRight('Observation', 18)}${padLeft('Count', 7)}${padLeft('Error Factor', 14)}`);
    summaryRows.forEach((row) => {
      lines.push(
        `${padRight(row.label, 18)}${padLeft(row.count.toString(), 7)}${padLeft(
          row.errorFactor.toFixed(3),
          14,
        )}`,
      );
    });
    if (totalCount > 0) {
      lines.push(
        `${padRight('Total', 18)}${padLeft(totalCount.toString(), 7)}${padLeft(result.seuw.toFixed(3), 14)}`,
      );
    }
    lines.push('');
    if (result.chiSquare) {
      lines.push(
        result.chiSquare.pass95
          ? 'Adjustment Passed Chi Square Test at 5% Level'
          : 'Adjustment Failed Chi Square Test at 5% Level',
      );
      lines.push(
        `Variance Factor Bounds (${result.chiSquare.varianceFactorLower.toFixed(3)}/${result.chiSquare.varianceFactorUpper.toFixed(3)})`,
      );
      lines.push(
        `Error Factor Bounds (${Math.sqrt(result.chiSquare.varianceFactorLower).toFixed(3)}/${Math.sqrt(result.chiSquare.varianceFactorUpper).toFixed(3)})`,
      );
    }
    if (runDiagnostics) {
      lines.push(
        `Run Profile: ${runDiagnostics.solveProfile.toUpperCase()} (dirSets=${runDiagnostics.directionSetMode}, profileFallback=${runDiagnostics.profileDefaultInstrumentFallback ? 'ON' : 'OFF'})`,
      );
    }
    if (result.autoAdjustDiagnostics?.enabled) {
      const ad = result.autoAdjustDiagnostics;
      lines.push(
        `Auto-Adjust: ON (|t|>=${ad.threshold.toFixed(2)}, maxCycles=${ad.maxCycles}, maxRemovalsPerCycle=${ad.maxRemovalsPerCycle}, minRedund=${ad.minRedundancy.toFixed(2)}, stop=${ad.stopReason}, removed=${ad.removed.length})`,
      );
      ad.cycles.forEach((cycle) => {
        lines.push(
          `  Cycle ${cycle.cycle}: seuw=${cycle.seuw.toFixed(4)}, max|t|=${cycle.maxAbsStdRes.toFixed(2)}, removals=${cycle.removals.length}`,
        );
      });
      ad.removed.slice(0, 30).forEach((row) => {
        lines.push(
          `  Removed obs#${row.obsId} ${row.type.toUpperCase()} ${row.stations} line=${row.sourceLine ?? '-'} |t|=${row.stdRes.toFixed(2)} reason=${row.reason}${row.redundancy != null ? ` redund=${row.redundancy.toFixed(3)}` : ''}`,
        );
      });
      if (ad.removed.length > 30) {
        lines.push(`  ... ${ad.removed.length - 30} more removed observations`);
      }
    }
    const aliasTrace = result.parseState?.aliasTrace ?? [];
    if ((result.parseState?.aliasExplicitCount ?? 0) > 0 || (result.parseState?.aliasRuleCount ?? 0) > 0) {
      lines.push(
        `Alias Canonicalization: explicit=${result.parseState?.aliasExplicitCount ?? 0}, rules=${result.parseState?.aliasRuleCount ?? 0}, remaps=${aliasTrace.length}`,
      );
      const sample = aliasTrace.slice(0, 15);
      sample.forEach((entry) => {
        lines.push(
          `  ${entry.context} line=${entry.sourceLine ?? '-'} ${entry.detail ?? '-'}: ${entry.sourceId} -> ${entry.canonicalId}`,
        );
      });
      if (aliasTrace.length > sample.length) {
        lines.push(`  ... ${aliasTrace.length - sample.length} more alias references`);
      }
    }
    if (result.clusterDiagnostics?.enabled) {
      lines.push(
        `Cluster Detection: pass=${result.clusterDiagnostics.passMode.toUpperCase()}, mode=${result.clusterDiagnostics.linkageMode.toUpperCase()}, dim=${result.clusterDiagnostics.dimension}, tol=${result.clusterDiagnostics.tolerance.toFixed(4)}m, pairHits=${result.clusterDiagnostics.pairCount}, candidates=${result.clusterDiagnostics.candidateCount}, approvedMerges=${result.clusterDiagnostics.approvedMergeCount ?? 0}`,
      );
      result.clusterDiagnostics.candidates.slice(0, 10).forEach((c) => {
        lines.push(
          `  ${c.key}: rep=${c.representativeId}, members=${c.stationIds.join(',')}, maxSep=${c.maxSeparation.toFixed(4)}m`,
        );
      });
      if (result.clusterDiagnostics.candidates.length > 10) {
        lines.push(
          `  ... ${result.clusterDiagnostics.candidates.length - 10} more cluster candidates`,
        );
      }
      const outcomes = result.clusterDiagnostics.mergeOutcomes ?? [];
      if (outcomes.length > 0) {
        lines.push(`Cluster Merge Outcomes: ${outcomes.length}`);
        outcomes.slice(0, 15).forEach((row) => {
          lines.push(
            `  ${row.aliasId}->${row.canonicalId}: dE=${row.deltaE != null ? row.deltaE.toFixed(4) : '-'}m dN=${row.deltaN != null ? row.deltaN.toFixed(4) : '-'}m dH=${row.deltaH != null ? `${row.deltaH.toFixed(4)}m` : '-'} d2D=${row.horizontalDelta != null ? `${row.horizontalDelta.toFixed(4)}m` : '-'} d3D=${row.spatialDelta != null ? `${row.spatialDelta.toFixed(4)}m` : '-'}${row.missing ? ' (missing pass1 data)' : ''}`,
          );
        });
        if (outcomes.length > 15) {
          lines.push(`  ... ${outcomes.length - 15} more merge outcomes`);
        }
      }
      const rejected = result.clusterDiagnostics.rejectedProposals ?? [];
      if (rejected.length > 0) {
        lines.push(`Rejected Cluster Proposals: ${rejected.length}`);
        rejected.slice(0, 15).forEach((row) => {
          lines.push(
            `  ${row.key}: rep=${row.representativeId}, members=${row.stationIds.join(',')}, retained=${row.retainedId ?? '-'}, reason=${row.reason}`,
          );
        });
        if (rejected.length > 15) {
          lines.push(`  ... ${rejected.length - 15} more rejected proposals`);
        }
      }
    }
    lines.push('');
    lines.push('Performing Error Propagation ...');
    lines.push('Writing Output Files ...');
    lines.push('');
    lines.push('Network Processing Completed');
    lines.push(`Elapsed Time = ${elapsedStr(runElapsedMs)}`);
    lines.push('');
    lines.push('Processing Notes:');
    result.logs.slice(0, 30).forEach((line) => lines.push(`  ${line}`));
    return lines.join('\n');
  }, [result, runElapsedMs, runDiagnostics]);

  return (
    <div className="h-full p-4 bg-slate-950 text-slate-100">
      <div className="h-full border border-slate-700 bg-slate-900 overflow-auto rounded">
        <pre className="text-xs leading-5 font-mono p-3 whitespace-pre-wrap">{text}</pre>
      </div>
    </div>
  );
};

export default ProcessingSummaryView;

