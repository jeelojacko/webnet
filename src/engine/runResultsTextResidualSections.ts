import type { RunResultsTextContext } from './runResultsTextContext';
import type { AdjustmentResult } from '../types';
import { formatLocalTestPolicyLine } from './localTestPolicy';
import { buildReliabilitySummaryLine } from './reliabilityDisplay';
import { buildStochasticPointerLine, formatStochasticScale } from './stochasticDiagnosticsDisplay';
import { formatReliabilityPolicyLine } from './reliabilityPolicy';

type ResidualSectionContext = Pick<
  RunResultsTextContext,
  'linearUnit' | 'unitScale' | 'isPreanalysis'
>;

export const appendTypeAndResidualSections = ({
  lines,
  res,
  context,
}: {
  lines: string[];
  res: AdjustmentResult;
  context: ResidualSectionContext;
}): void => {
  if (context.isPreanalysis) return;

  appendTypeSummarySection({ lines, res, context });
  appendResidualDiagnosticsSection({ lines, res });
  appendReliabilitySection({ lines, res });
  appendStochasticDiagnosticsSection({ lines, res });
};

const appendReliabilitySection = ({
  lines,
  res,
}: {
  lines: string[];
  res: AdjustmentResult;
}): void => {
  const summary = res.reliabilitySummary;
  if (!summary) return;
  lines.push('--- Reliability (MDB / External) ---');
  lines.push(
    `Policy: ${formatReliabilityPolicyLine(summary.model ? { model: summary.model, alpha: summary.alpha, power: summary.power } : undefined)}` +
      (Number.isFinite(summary.delta0) ? `, delta0=${summary.delta0.toFixed(3)}` : ''),
  );
  lines.push(buildReliabilitySummaryLine(summary, res.observations ?? []));
  lines.push('');
};

/**
 * Additive STOCHASTIC MODEL DIAGNOSTICS block. Neutral wording: raw
 * redundancy DOF, no threshold verdicts; non-estimated rows keep reasons.
 * Never touches the industry listing, CSV layout, or parity paths.
 */
const appendStochasticDiagnosticsSection = ({
  lines,
  res,
}: {
  lines: string[];
  res: AdjustmentResult;
}): void => {
  const diagnostics = res.stochasticDiagnostics;
  if (!diagnostics) return;
  lines.push('--- Stochastic Model Diagnostics ---');
  lines.push(
    'Single-pass Foerstner group components (s^2 = quadform/redundancy, redundancy = tr(P.Qvv)). ' +
      'Control-constraint rows excluded; diagnostics only, no automatic reweighting.',
  );
  const pointer = buildStochasticPointerLine(res);
  if (pointer) lines.push(pointer);
  diagnostics.groups.forEach((group) => {
    const scale = group.status === 'estimated' ? formatStochasticScale(group.sigmaScale) : '-';
    const status =
      group.status === 'estimated'
        ? 'estimated'
        : `${group.status}${group.reason ? ` (${group.reason})` : ''}`;
    lines.push(
      `${group.label}: eqns=${group.equations}, redund=${Number.isFinite(group.redundancyDof) ? group.redundancyDof.toFixed(3) : '-'}, ` +
        `quadform=${Number.isFinite(group.quadForm) ? group.quadForm.toFixed(4) : '-'}, scale=${scale}, ${status}`,
    );
  });
  lines.push('');
};

const appendTypeSummarySection = ({
  lines,
  res,
  context,
}: {
  lines: string[];
  res: AdjustmentResult;
  context: ResidualSectionContext;
}): void => {
  const { linearUnit, unitScale } = context;

  if (!res.typeSummary || Object.keys(res.typeSummary).length === 0) return;

  lines.push('--- Per-Type Summary ---');
  const summaryRows = Object.entries(res.typeSummary).map(([type, s]) => ({
    type,
    count: s.count.toString(),
    rms: (s.unit === 'm' ? s.rms * unitScale : s.rms).toFixed(4),
    maxAbs: (s.unit === 'm' ? s.maxAbs * unitScale : s.maxAbs).toFixed(4),
    maxStdRes: s.maxStdRes.toFixed(3),
    over3: s.over3.toString(),
    over4: s.over4.toString(),
    unit: s.unit === 'm' ? linearUnit : s.unit,
  }));
  const header = {
    type: 'Type',
    count: 'Count',
    rms: 'RMS',
    maxAbs: 'MaxAbs',
    maxStdRes: 'MaxStdRes',
    over3: '>3σ',
    over4: '>4σ',
    unit: 'Unit',
  };
  const widths = {
    type: Math.max(header.type.length, ...summaryRows.map((r) => r.type.length)),
    count: Math.max(header.count.length, ...summaryRows.map((r) => r.count.length)),
    rms: Math.max(header.rms.length, ...summaryRows.map((r) => r.rms.length)),
    maxAbs: Math.max(header.maxAbs.length, ...summaryRows.map((r) => r.maxAbs.length)),
    maxStdRes: Math.max(header.maxStdRes.length, ...summaryRows.map((r) => r.maxStdRes.length)),
    over3: Math.max(header.over3.length, ...summaryRows.map((r) => r.over3.length)),
    over4: Math.max(header.over4.length, ...summaryRows.map((r) => r.over4.length)),
    unit: Math.max(header.unit.length, ...summaryRows.map((r) => r.unit.length)),
  };
  const pad = (value: string, size: number) => value.padEnd(size, ' ');
  lines.push(
    [
      pad(header.type, widths.type),
      pad(header.count, widths.count),
      pad(header.rms, widths.rms),
      pad(header.maxAbs, widths.maxAbs),
      pad(header.maxStdRes, widths.maxStdRes),
      pad(header.over3, widths.over3),
      pad(header.over4, widths.over4),
      pad(header.unit, widths.unit),
    ].join('  '),
  );
  summaryRows.forEach((row) => {
    lines.push(
      [
        pad(row.type, widths.type),
        pad(row.count, widths.count),
        pad(row.rms, widths.rms),
        pad(row.maxAbs, widths.maxAbs),
        pad(row.maxStdRes, widths.maxStdRes),
        pad(row.over3, widths.over3),
        pad(row.over4, widths.over4),
        pad(row.unit, widths.unit),
      ].join('  '),
    );
  });
  lines.push('');
};

const appendResidualDiagnosticsSection = ({
  lines,
  res,
}: {
  lines: string[];
  res: AdjustmentResult;
}): void => {
  const rd = res.residualDiagnostics;

  if (!rd) return;

  lines.push('--- Residual Diagnostics ---');
  lines.push(
    `Obs=${rd.observationCount}, WithStdRes=${rd.withStdResCount}, LocalFail=${rd.localFailCount}, |t|>2=${rd.over2SigmaCount}, |t|>3=${rd.over3SigmaCount}, |t|>4=${rd.over4SigmaCount}`,
  );
  lines.push(
    `Redundancy: mean=${rd.meanRedundancy != null ? rd.meanRedundancy.toFixed(4) : '-'}, min=${rd.minRedundancy != null ? rd.minRedundancy.toFixed(4) : '-'}, <0.2=${rd.lowRedundancyCount}, <0.1=${rd.veryLowRedundancyCount}`,
  );
  const localFamily = res.localTestSummary?.statisticFamily ?? 'tau';
  const localSymbol = localFamily === 'w' ? 'w' : 'τ';
  // Unavailable derivations carry criticalValue=NaN: render '-' honestly rather
  // than NaN or a fallback constant that was never derived for this policy.
  const criticalText =
    res.localTestSummary?.available === false || !Number.isFinite(rd.criticalT)
      ? '-'
      : rd.criticalT.toFixed(2);
  lines.push(`Critical |${localSymbol}| threshold: ${criticalText} (local-test policy: ${formatLocalTestPolicyLine(res.localTestSummary ?? undefined)})`);
  if (rd.worst) {
    lines.push(
      `Worst: #${rd.worst.obsId} ${rd.worst.type.toUpperCase()} ${rd.worst.stations} line=${rd.worst.sourceLine ?? '-'} |t|=${rd.worst.stdRes != null ? rd.worst.stdRes.toFixed(2) : '-'} r=${rd.worst.redundancy != null ? rd.worst.redundancy.toFixed(3) : '-'} local=${rd.worst.localPass == null ? '-' : rd.worst.localPass ? 'PASS' : 'FAIL'}`,
    );
  }
  if (rd.byType.length > 0) {
    appendResidualByTypeTable(lines, rd.byType);
  }
  lines.push('');
};

const appendResidualByTypeTable = (
  lines: string[],
  byType: NonNullable<AdjustmentResult['residualDiagnostics']>['byType'],
): void => {
  const rows = byType.map((b) => ({
    type: String(b.type).toUpperCase(),
    count: String(b.count),
    withStd: String(b.withStdResCount),
    localFail: String(b.localFailCount),
    over3: String(b.over3SigmaCount),
    maxStd: b.maxStdRes != null ? b.maxStdRes.toFixed(2) : '-',
    meanR: b.meanRedundancy != null ? b.meanRedundancy.toFixed(3) : '-',
    minR: b.minRedundancy != null ? b.minRedundancy.toFixed(3) : '-',
  }));
  const header = {
    type: 'Type',
    count: 'Count',
    withStd: 'WithStdRes',
    localFail: 'LocalFail',
    over3: '>3σ',
    maxStd: 'Max|t|',
    meanR: 'MeanRedund',
    minR: 'MinRedund',
  };
  const widths = {
    type: Math.max(header.type.length, ...rows.map((r) => r.type.length)),
    count: Math.max(header.count.length, ...rows.map((r) => r.count.length)),
    withStd: Math.max(header.withStd.length, ...rows.map((r) => r.withStd.length)),
    localFail: Math.max(header.localFail.length, ...rows.map((r) => r.localFail.length)),
    over3: Math.max(header.over3.length, ...rows.map((r) => r.over3.length)),
    maxStd: Math.max(header.maxStd.length, ...rows.map((r) => r.maxStd.length)),
    meanR: Math.max(header.meanR.length, ...rows.map((r) => r.meanR.length)),
    minR: Math.max(header.minR.length, ...rows.map((r) => r.minR.length)),
  };
  const pad = (value: string, size: number) => value.padEnd(size, ' ');
  lines.push(
    [
      pad(header.type, widths.type),
      pad(header.count, widths.count),
      pad(header.withStd, widths.withStd),
      pad(header.localFail, widths.localFail),
      pad(header.over3, widths.over3),
      pad(header.maxStd, widths.maxStd),
      pad(header.meanR, widths.meanR),
      pad(header.minR, widths.minR),
    ].join('  '),
  );
  rows.forEach((r) => {
    lines.push(
      [
        pad(r.type, widths.type),
        pad(r.count, widths.count),
        pad(r.withStd, widths.withStd),
        pad(r.localFail, widths.localFail),
        pad(r.over3, widths.over3),
        pad(r.maxStd, widths.maxStd),
        pad(r.meanR, widths.meanR),
        pad(r.minR, widths.minR),
      ].join('  '),
    );
  });
};
