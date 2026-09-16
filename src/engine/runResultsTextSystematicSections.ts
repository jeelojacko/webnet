import type { AdjustmentResult } from '../types';

const fmt = (v: number | null | undefined, digits: number): string =>
  v != null && Number.isFinite(v) ? v.toFixed(digits) : '-';

/** Additive systematic-pattern text block; per-observation output unchanged. */
export const appendSystematicPatternSections = ({
  lines,
  res,
}: {
  lines: string[];
  res: AdjustmentResult;
}): void => {
  const sys = res.systematicDiagnostics;
  if (!sys) return;
  lines.push('--- Systematic Pattern Diagnostics ---');
  lines.push('Descriptive only: no formal tests, no significance claims.');
  if (!sys.available) {
    lines.push(`Status: unavailable (${sys.unavailableReason ?? 'no residuals'})`);
    lines.push('');
    return;
  }
  if (sys.setupFamilies.length > 0) {
    lines.push('Setup family residual summary (by family; never averaged across units):');
    sys.setupFamilies.forEach((f) => {
      lines.push(
        `  ${f.station} ${f.family}: n=${f.count}, mean=${fmt(f.meanResidual, 4)}, rms=${fmt(f.rmsResidual, 4)}, maxAbs=${fmt(f.maxAbsResidual, 4)}, meanStdRes=${fmt(f.meanStdRes, 2)} (${f.stdResNote ?? ''}), +-${f.posCount}/${f.negCount} zero=${f.zeroUntestableCount}, localFail=${f.localFailCount}`,
      );
    });
  }
  const dt = sys.distanceTrend;
  lines.push(
    `Distance trend: n=${dt.count}, range=${fmt(dt.minDist, 2)}-${fmt(dt.maxDist, 2)}m ` +
      `slope=${fmt(dt.slopeMmPerKm, 3)}mm/km intercept=${fmt(dt.interceptMm, 3)}mm ` +
      `corr=${fmt(dt.corrInterceptSlope, 3)} identifiable=${dt.identifiable ? 'YES' : 'NO'} ` +
      `status=${dt.status}${dt.reason ? ` (${dt.reason})` : ''}`,
  );
  if (dt.identifiable) {
    lines.push(
      '  Possible systematic pattern in distance residuals; intercept pattern / slope pattern wording only; review recommended.',
    );
  }
  if (sys.worstDirectionSet) {
    lines.push(
      `Worst direction set: ${sys.worstDirectionSet.setId} @ ${sys.worstDirectionSet.occupy} ` +
        `rms=${fmt(sys.worstDirectionSet.residualRmsArcSec, 2)}" (per-set means absorb orientation unknowns; descriptive only)`,
    );
  }
  const fb = sys.directionFaceBalance;
  lines.push(
    `Face balance: balanced=${fb.balancedSets} unbalanced=${fb.unbalancedSets} ` +
      `largestPairDelta=${fmt(fb.largestFacePairDeltaArcSec, 2)}"` +
      `${fb.largestFacePairSetId ? ` (${fb.largestFacePairSetId}${fb.largestFacePairTarget ? ` ${fb.largestFacePairTarget}` : ''})` : ''} ` +
      `status=${fb.status}${fb.reason ? ` (${fb.reason})` : ''}`,
  );
  const repeats = sys.directionRepeatSameSign.filter((r) => r.status === 'descriptive');
  if (repeats.length > 0) {
    lines.push('Repeated-target same-sign (descriptive, no p-value):');
    repeats.slice(0, 10).forEach((r) => {
      lines.push(
        `  ${r.occupy}->${r.target}: sets=${r.setCount} sameSign=${r.sameSignCount} dominant=${r.dominantSign}`,
      );
    });
  }
  const zp = sys.zenithPatterns;
  lines.push(
    `Zenith residual vs distance: n=${zp.count} slope=${fmt(zp.slopeVsDistanceArcSecPerKm, 3)}"/km ` +
      `+-${zp.posCount}/${zp.negCount} status=${zp.status}${zp.reason ? ` (${zp.reason})` : ''}`,
  );
  const lp = sys.levelingPatterns;
  lines.push(
    `Leveling input-sequence: n=${lp.count} km=${fmt(lp.cumulativeKm, 3)} ` +
      `drift=${fmt(lp.driftMmPerKm, 3)}mm/km +-${lp.posCount}/${lp.negCount} ` +
      `longest=${lp.longestPos}/${lp.longestNeg} changes=${lp.signChanges} ` +
      `status=${lp.status}${lp.reason ? ` (${lp.reason})` : ''}`,
  );
  const gp = sys.gnssPatterns;
  lines.push(
    `GNSS means: n=${gp.count} E=${fmt(gp.meanEMm, 2)}mm N=${fmt(gp.meanNMm, 2)}mm U=${fmt(gp.meanUMm, 2)}mm ` +
      `rms=${fmt(gp.rmsEMm, 2)}/${fmt(gp.rmsNMm, 2)}/${fmt(gp.rmsUMm, 2)}mm status=${gp.status}${gp.reason ? ` (${gp.reason})` : ''}`,
  );
  if (sys.signRuns.length > 0) {
    lines.push('Sign runs (descriptive counts only, no runs-test p-value):');
    sys.signRuns.forEach((r) => {
      lines.push(
        `  ${r.key}: n=${r.count} +-${r.pos}/${r.neg} longest=${r.longestPos}/${r.longestNeg} changes=${r.signChanges} status=${r.status}`,
      );
    });
  }
  sys.warnings.forEach((w) => {
    lines.push(`Warning: ${w}`);
  });
  if (sys.robustNote) lines.push(`Robust: ${sys.robustNote}`);
  if (sys.freeNetworkNote) lines.push(`Datum: ${sys.freeNetworkNote}`);
  lines.push('');
};
