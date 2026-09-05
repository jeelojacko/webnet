/**
 * Phase 7B.7 benchmark statistics + report builders (pure, test-only).
 *
 * Timing samples are summarized as median/min/p95/max; the Markdown/JSON
 * renderers are deterministic in row order (case size ascending, then
 * strategy S0..S3) so reruns over identical measurements are byte-stable.
 */
import type { Phase7b7StrategyId } from './phase7b7SafetyStrategies';
import { PHASE7B7_STRATEGIES } from './phase7b7SafetyStrategies';

export interface Phase7b7TimingStats {
  medianMs: number;
  minMs: number;
  p95Ms: number;
  maxMs: number;
  runs: number;
}

export const summarizePhase7b7Timings = (values: number[]): Phase7b7TimingStats => {
  if (values.length === 0) {
    return { medianMs: 0, minMs: 0, p95Ms: 0, maxMs: 0, runs: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] ?? 0;
  return {
    medianMs: at(0.5),
    minMs: sorted[0] ?? 0,
    p95Ms: at(0.95),
    maxMs: sorted[sorted.length - 1] ?? 0,
    runs: values.length,
  };
};

export interface Phase7b7CaseReport {
  caseId: string;
  unknowns: number;
  strategy: Phase7b7StrategyId;
  /** Sparse verdict under this strategy; S0 has no oracle to clear. */
  accepted: boolean;
  handshakeReasons: string[];
  /** End-to-end candidate solve (sparse-injected under every strategy). */
  endToEnd: Phase7b7TimingStats;
  /** Dense rebuilds + condition estimates over the strategy's required
   * correction systems (S1: first, S2: first two, S3: every iteration). */
  oracle: Phase7b7TimingStats | null;
  /** Correction systems the oracle actually gated. */
  oracleSystems: number;
  /** Iteration index (0-based) of the worst oracle diff, if any. */
  worstOracleSystem: number | null;
  /** Max dense-vs-sparse correction diff across oracled systems. */
  maxOracleDiff: number | null;
  maxCoordDiffM: number | null;
  sparseFallbacks: number;
  rssMb: number;
  heapUsedMb: number;
  skipReason?: string;
}

export interface Phase7b7Report {
  generatedAt: string;
  node: string;
  platform: string;
  cpu: string;
  gitCommit: string;
  warmups: number;
  quick: boolean;
  moduleInit: Phase7b7TimingStats;
  rows: Phase7b7CaseReport[];
}

const fmt = (value: number | null | undefined, digits = 2): string =>
  value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits);

const fmtStats = (stats: Phase7b7TimingStats | null): string =>
  stats == null ? '-' : `${stats.medianMs.toFixed(2)}/${stats.minMs.toFixed(2)}/${stats.p95Ms.toFixed(2)}/${stats.maxMs.toFixed(2)}`;

/** Deterministic Markdown rendering: rows sorted by unknowns, then S0..S3. */
export const renderPhase7b7ReportMarkdown = (report: Phase7b7Report): string => {
  const order = new Map(PHASE7B7_STRATEGIES.map((strategy, index) => [strategy.id, index]));
  const rows = [...report.rows].sort(
    (a, b) => a.unknowns - b.unknowns || (order.get(a.strategy) ?? 0) - (order.get(b.strategy) ?? 0),
  );
  const lines = [
    `# Phase 7B.7 safety-strategy benchmark`,
    ``,
    `Generated: ${report.generatedAt} · Node ${report.node} · ${report.platform} · ${report.cpu}`,
    `Commit: ${report.gitCommit} · warmups: ${report.warmups} · quick: ${report.quick}`,
    `Module init (WASM factory + sparse bundle, measured separately): ${fmtStats(report.moduleInit)} ms (median/min/p95/max, n=${report.moduleInit.runs}).`,
    `End-to-end is outer sparse-candidate solve() time; oracle is the dense rebuild + condition estimate over the strategy's required correction systems (S0: none, S1: first, S2: first two, S3: every iteration). Memory is post-case RSS/heap.`,
    ``,
    `| Case | Unknowns | Strategy | Accepted | End-to-end med/min/p95/max ms | Oracle med/min/p95/max ms | Oracle systems | Worst system | Max oracle diff | Coord diff m | Fallbacks | RSS MiB | Heap MiB |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
  ];
  for (const row of rows) {
    if (row.skipReason) {
      lines.push(`| ${row.caseId} | ${row.unknowns} | ${row.strategy} | skipped | - | - | - | - | - | - | - | ${row.skipReason} |`);
      continue;
    }
    lines.push(
      `| ${row.caseId} | ${row.unknowns} | ${row.strategy} | ${row.accepted} ` +
        `| ${fmtStats(row.endToEnd)} | ${fmtStats(row.oracle)} ` +
        `| ${row.oracleSystems} | ${row.worstOracleSystem ?? '-'} ` +
        `| ${row.maxOracleDiff == null ? '-' : row.maxOracleDiff.toExponential(2)} ` +
        `| ${row.maxCoordDiffM == null ? '-' : row.maxCoordDiffM.toExponential(2)} ` +
        `| ${row.sparseFallbacks} | ${fmt(row.rssMb, 1)} | ${fmt(row.heapUsedMb, 1)} |`,
    );
  }
  lines.push(``);
  return lines.join('\n');
};
