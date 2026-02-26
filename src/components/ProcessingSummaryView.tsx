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


