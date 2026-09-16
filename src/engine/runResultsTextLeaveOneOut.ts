import type { AdjustmentResult } from '../types';
import type { SuspectImpactRow } from '../typesAdjustmentResult';

const fmt = (value: number | undefined, digits: number): string =>
  value != null && Number.isFinite(value) ? value.toFixed(digits) : '-';

const chiPass = (pass: boolean | undefined): string =>
  pass == null ? '-' : pass ? 'PASS' : 'FAIL';

const failureText = (row: SuspectImpactRow): string => {
  switch (row.failureReason) {
    case 'singular':
      return 're-solve singular';
    case 'insufficient-observations':
      return 'too few observations left';
    case 'invalid-after-removal':
      return 'invalid after removal';
    case 'cancelled':
      return 're-solve cancelled';
    case 'unsupported':
      return 'exclusion unsupported';
    default:
      return 're-solve failed';
  }
};

/**
 * Phase 14D leave-one-out text export. Comparison only: per candidate the
 * source line/stations, base StdRes/local, SEUW and chi-square before/after
 * (T/DOF/p + PASS/FAIL), local-fail counts before/after, max coordinate
 * shift with most-affected station (or the unavailable/failed reason), and
 * status. No score column; ordering is the row order (transparent sort).
 */
export const appendLeaveOneOutInfluenceSection = ({
  lines,
  res,
  linearUnit,
  unitScale,
}: {
  lines: string[];
  res: AdjustmentResult;
  linearUnit: string;
  unitScale: number;
}): void => {
  if (!res.suspectImpactDiagnostics || res.suspectImpactDiagnostics.length === 0) return;
  lines.push('--- Leave-One-Out Influence / What-if Exclusion ---');
  res.suspectImpactDiagnostics.forEach((d, idx) => {
    const head =
      `#${idx + 1} ${d.type.toUpperCase()} ${d.stations} ` +
      `(obs #${d.obsId}, line ${d.sourceLine ?? '-'}): ` +
      `base |StdRes|=${fmt(d.baseStdRes, 2)} local=${d.baseLocalFail ? 'FAIL' : '-'}` +
      (d.robustReSolve ? ' [robust re-solve]' : '');
    if (d.status !== 'ok') {
      lines.push(`${head}; ${failureText(d)}; status FAILED`);
      return;
    }
    const chi = `chi ${chiPass(d.baseChiPass)}->${chiPass(d.altChiPass)} ` +
      `(T=${fmt(d.baseChi?.T, 3)}/${fmt(d.altChi?.T, 3)} ` +
      `DOF=${d.baseDof ?? '-'}/${d.altDof ?? '-'} ` +
      `p=${fmt(d.baseChi?.p, 4)}/${fmt(d.altChi?.p, 4)})`;
    lines.push(
      `${head}; SEUW ${fmt(d.baseSeuw, 4)}->${fmt(d.altSeuw, 4)}; ${chi}; ` +
        `max|StdRes| ${fmt(d.baseMaxStdRes, 2)}->${fmt(d.altMaxStdRes, 2)}; ` +
        `local fails ${d.baseLocalFails ?? '-'}` +
        `->${d.altLocalFails ?? '-'}`,
    );
    const shift =
      d.shiftStatus === 'free-network-unavailable'
        ? 'shift unavailable (free-network datum)'
        : d.maxCoordShift == null || d.mostAffectedStation == null
          ? 'shift unavailable'
          : `max shift ${(d.maxCoordShift * unitScale).toFixed(4)} ${linearUnit} @ ${d.mostAffectedStation.id}`;
    lines.push(`  ${shift}; status OK`);
  });
  lines.push('');
};
