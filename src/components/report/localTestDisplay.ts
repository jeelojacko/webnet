import type { Observation } from '../../types';
import { semanticTooltip } from '../../engine/statisticalSemantics';
import type { LocalTestSummary } from '../../engine/localTestPolicy';
import {
  formatLocalTestModeLabel,
  LEGACY_LOCAL_TEST_CRITICAL,
} from '../../engine/localTestPolicy';

/** Compact Local-column verdict: PASS / FAIL / - (null or unavailable). */
export const formatLocalTestCell = (obs: Observation): string => {
  const comps = obs.localTestComponents;
  if (comps) {
    const e = comps.passE;
    const n = comps.passN;
    const u = comps.passU;
    if (e == null && n == null && u == null) return '-';
    const letter = (pass: boolean | null | undefined): string => (pass == null ? '-' : pass ? 'P' : 'F');
    return u != null ? `E:${letter(e)} N:${letter(n)} U:${letter(u)}` : `E:${letter(e)} N:${letter(n)}`;
  }
  const test = obs.localTest;
  if (!test || test.pass == null) return '-';
  return test.pass ? 'PASS' : 'FAIL';
};

const statisticSymbol = (family: 'w' | 'tau' | undefined): string =>
  family === 'w' ? 'w' : 'τ';

const formatStat = (value: number | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? Math.abs(value).toFixed(2) : '-';

/**
 * Tooltip/focus text for a Local cell: statistic + critical + result + policy.
 * Never labels a statistic "t" — the symbol follows statisticFamily (w vs τ).
 */
export const buildLocalTestCellTooltip = (
  obs: Observation,
  summary?: LocalTestSummary | null,
): string => {
  const test = obs.localTest;
  const family = test?.statisticFamily ?? summary?.statisticFamily ?? 'tau';
  const symbol = statisticSymbol(family);
  const stat = formatStat(test?.statistic);
  const critical =
    test?.critical != null && Number.isFinite(test.critical)
      ? test.critical.toFixed(2)
      : summary && Number.isFinite(summary.criticalValue)
        ? summary.criticalValue.toFixed(2)
        : '-';
  const verdict = formatLocalTestCell(obs);
  const result = verdict === '-' ? 'not tested' : verdict;
  const mode = summary?.mode ?? 'legacy-fixed';
  const policyLine =
    mode === 'legacy-fixed'
      ? `Policy: Legacy fixed (${critical})`
      : `Policy: ${formatLocalTestModeLabel(mode)}; Alpha: ${summary?.alpha ?? 0.05}; ` +
        `Correction: ${summary?.correction ?? 'none'}; Tests: ${summary?.testCount ?? '-'}; ` +
        `Effective alpha: ${summary && Number.isFinite(summary.effectiveAlpha) ? summary.effectiveAlpha.toExponential(2) : '-'}` +
        (family === 'tau' && summary ? `; DOF: ${summary.dof}` : '');
  return `|${symbol}|=${stat} vs critical ${critical}: ${result}. ${policyLine}.`;
};

/** Compact one-line run summary for the LOCAL TESTING subsection. */
export const buildLocalTestSummaryLine = (
  summary: LocalTestSummary,
  flaggedCount: number,
): string => {
  const eff = Number.isFinite(summary.effectiveAlpha)
    ? summary.effectiveAlpha.toExponential(2)
    : '-';
  const crit = Number.isFinite(summary.criticalValue) ? summary.criticalValue.toFixed(2) : '-';
  if (!summary.available) {
    return `Local testing unavailable (${summary.unavailableReason ?? 'unknown reason'}).`;
  }
  if (summary.mode === 'legacy-fixed') {
    const approxNote =
      summary.criticalValue === LEGACY_LOCAL_TEST_CRITICAL ? ' (≈ two-sided .001)' : '';
    return (
      `Legacy fixed: critical ${crit}${approxNote} (alpha/correction not applied), ` +
      `${flaggedCount} flagged of ${summary.testCount} tested.`
    );
  }
  const dofPart = summary.statisticFamily === 'tau' ? ` DOF ${summary.dof}.` : '.';
  return (
    `${formatLocalTestModeLabel(summary.mode)}: alpha ${summary.alpha} ` +
    `(${summary.correction} over ${summary.testCount} tests, effective ${eff}), ` +
    `critical ${crit}, ${flaggedCount} flagged of ${summary.testCount} tested${dofPart}`
  );
};

/** Local column header tooltip: canonical definition plus the actual run policy. */
export const buildLocalTestHeaderTooltip = (
  summary?: LocalTestSummary | null,
): string => {
  const base = semanticTooltip('localTest');
  if (!summary || !summary.available) return base;
  const crit = Number.isFinite(summary.criticalValue)
    ? summary.criticalValue.toFixed(2)
    : '-';
  if (summary.mode === 'legacy-fixed')
    return `${base} Run policy: legacy fixed critical ${crit}.`;
  const eff = Number.isFinite(summary.effectiveAlpha)
    ? summary.effectiveAlpha.toExponential(2)
    : '-';
  return (
    `${base} Run policy: ${formatLocalTestModeLabel(summary.mode)}; ` +
    `alpha ${summary.alpha} (${summary.correction} over ${summary.testCount} tests, effective ${eff}); critical ${crit}.`
  );
};
