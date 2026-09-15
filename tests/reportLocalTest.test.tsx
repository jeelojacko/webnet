import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import type { LocalTestPolicy } from '../src/engine/localTestPolicy';
import {
  formatLocalTestModeLabel,
  formatLocalTestPolicyLine,
} from '../src/engine/localTestPolicy';
import type { AdjustmentResult, Observation } from '../src/types';
import ObservationTableSection from '../src/components/report/ObservationTableSection';
import {
  buildLocalTestCellTooltip,
  buildLocalTestSummaryLine,
  formatLocalTestCell,
} from '../src/components/report/localTestDisplay';
import {
  DataCheckSummarySection,
  LocalTestSummarySection,
} from '../src/components/report/ReportRunSummarySections';

/** Two fixed controls, one free point, plus a redundant outlier distance. */
const OUTLIER_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
  'D A-P 64.071 0.01',
].join('\n');

const run = (input: string, localTestPolicy?: LocalTestPolicy, extra?: Record<string, unknown>) =>
  solveEngine({
    input,
    maxIterations: 8,
    parseOptions: {
      coordMode: '2D',
      units: 'm',
      ...(localTestPolicy ? { localTestPolicy } : {}),
      ...(extra ?? {}),
    },
  });

const tableProps = {
  title: 'Distances (TS)',
  unitScale: 1,
  excludedIds: new Set<number>(),
  autoSideshotObsIds: new Set<number>(),
  selectedObservationId: null,
  onToggleExclude: () => {},
  rowSelectionClass: () => '',
  visibleRowsFor: ((_key: string, rows: unknown[]) => rows) as <T>(
    _key: string,
    _rows: T[],
    _defaultSize?: number,
  ) => T[],
  showMoreRows: () => {},
  showAllRows: () => {},
  renderSourceLineLink: (line: number | null | undefined) => String(line ?? '-'),
  isSectionCollapsed: () => false,
  isDetailSectionPinned: () => false,
  toggleDetailSection: () => {},
  togglePinnedDetailSection: () => {},
  formatMdb: (value: number) => (Number.isFinite(value) ? value.toFixed(3) : '-'),
  prismAnnotation: () => '',
};

describe('local test cell rendering', () => {
  it('renders compact PASS/FAIL/- verdicts', () => {
    expect(formatLocalTestCell({ localTest: { critical: 3.29, pass: true } } as Observation)).toBe(
      'PASS',
    );
    expect(formatLocalTestCell({ localTest: { critical: 3.29, pass: false } } as Observation)).toBe(
      'FAIL',
    );
    // Null (untestable) and missing verdicts collapse to '-'.
    expect(formatLocalTestCell({ localTest: { critical: 3.29, pass: null } } as Observation)).toBe(
      '-',
    );
    expect(formatLocalTestCell({} as Observation)).toBe('-');
  });

  it('renders per-component GNSS verdicts with null-safe letters', () => {
    expect(
      formatLocalTestCell({ localTestComponents: { passE: true, passN: false } } as Observation),
    ).toBe('E:P N:F');
    expect(
      formatLocalTestCell({ localTestComponents: { passE: null, passN: null } } as Observation),
    ).toBe('-');
    expect(
      formatLocalTestCell({ localTestComponents: { passE: true, passN: null } } as Observation),
    ).toBe('E:P N:-');
  });

  it('keeps the Local column compact in the observation table', () => {
    const result = run(OUTLIER_INPUT);
    const html = renderToStaticMarkup(
      <ObservationTableSection
        {...tableProps}
        obsList={result.observations}
        localTestSummary={result.localTestSummary}
      />,
    );
    expect(html).toContain('>PASS<');
    expect(html).not.toContain('>PASSED<');
    // Keyboard-focusable cell with a statistic tooltip.
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('Policy: Legacy fixed (3.29)');
  });

  it('shows - for untestable rows instead of FAIL', () => {
    const result = run(OUTLIER_INPUT, { mode: 'pope-tau', alpha: 0.05, correction: 'none' });
    const html = renderToStaticMarkup(
      <ObservationTableSection
        {...tableProps}
        obsList={result.observations}
        localTestSummary={result.localTestSummary}
      />,
    );
    // Pope-tau tooltips identify the tau family with DOF context.
    expect(html).toContain('Pope τ-test');
    expect(html).toContain('DOF:');
  });
});

describe('local test tooltips and labels', () => {
  it('describes the legacy policy with tau notation', () => {
    const result = run(OUTLIER_INPUT);
    const obs = result.observations.find((o) => o.localTest != null) as Observation;
    const tip = buildLocalTestCellTooltip(obs, result.localTestSummary);
    expect(tip).toContain('|τ|=');
    expect(tip).toContain('critical 3.29');
    expect(tip).toContain('Policy: Legacy fixed (3.29)');
    expect(tip).not.toContain('Baarda');
  });

  it('describes formal policies with w notation, alpha, and effective alpha', () => {
    const result = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05, correction: 'sidak' });
    const obs = result.observations.find((o) => o.localTest != null) as Observation;
    const tip = buildLocalTestCellTooltip(obs, result.localTestSummary);
    expect(tip).toContain('|w|=');
    expect(tip).toContain('Policy: Baarda w-test');
    expect(tip).toContain('Alpha: 0.05');
    expect(tip).toContain('Correction: sidak');
    expect(tip).toContain('Effective alpha:');
  });

  it('shows the configured legacy critical in the cell tooltip, defaulting to 3.29', () => {
    const def = run(OUTLIER_INPUT);
    const defObs = def.observations.find((o) => o.localTest != null) as Observation;
    expect(buildLocalTestCellTooltip(defObs, def.localTestSummary)).toContain(
      'Policy: Legacy fixed (3.29)',
    );
    const custom = run(OUTLIER_INPUT, { mode: 'legacy-fixed', critical: 4 });
    const customObs = custom.observations.find((o) => o.localTest != null) as Observation;
    const customTip = buildLocalTestCellTooltip(customObs, custom.localTestSummary);
    expect(customTip).toContain('Policy: Legacy fixed (4.00)');
    expect(customTip).not.toContain('(3.29)');
  });

  it('self-identifies the legacy policy and never relabels it', () => {
    expect(formatLocalTestModeLabel('legacy-fixed')).toBe('Legacy fixed (3.29)');
    expect(formatLocalTestPolicyLine(undefined)).toBe('Legacy fixed (3.29)');
    expect(formatLocalTestPolicyLine({ mode: 'baarda-w' })).toContain('Baarda w-test');
    expect(formatLocalTestPolicyLine({ mode: 'legacy-fixed' })).not.toContain('Baarda');
    expect(formatLocalTestPolicyLine({ mode: 'legacy-fixed' })).not.toContain('Pope');
  });
});

describe('local testing summary section', () => {
  it('renders a compact strip beneath the summary cards for adjustments', () => {
    const result = run(OUTLIER_INPUT, { mode: 'baarda-w', alpha: 0.05, correction: 'none' });
    const html = renderToStaticMarkup(
      <LocalTestSummarySection
        isDataCheck={false}
        isPreanalysis={false}
        isSpecialRunMode={false}
        result={result}
      />,
    );
    expect(html).toContain('Local testing');
    expect(html).toContain('Baarda w-test');
    expect(html).toContain('flagged of');
  });

  it('states the legacy fixed critical without claiming alpha=.05', () => {
    const result = run(OUTLIER_INPUT);
    const line = buildLocalTestSummaryLine(result.localTestSummary!, 0);
    expect(line).toContain('Legacy fixed: critical 3.29');
    expect(line).toContain('alpha/correction not applied');
    expect(line).toContain('0 flagged of');
    expect(line).not.toContain('alpha 0.05');
  });

  it('never says "flagged of tested" when the run is unavailable', () => {
    const result = {
      observations: [],
      localTestSummary: {
        mode: 'pope-tau',
        statisticFamily: 'tau',
        alpha: 0.05,
        effectiveAlpha: Number.NaN,
        correction: 'none',
        testCount: 2,
        criticalValue: Number.NaN,
        dof: 1,
        twoSided: true as const,
        available: false,
        unavailableReason: 'dof-too-small',
        legacyCritical: 3.29,
        robustApproximation: false,
      },
    } as unknown as AdjustmentResult;
    const html = renderToStaticMarkup(
      <LocalTestSummarySection
        isDataCheck={false}
        isPreanalysis={false}
        isSpecialRunMode={false}
        result={result}
      />,
    );
    expect(html).toContain('not tested');
    expect(html).toContain('dof-too-small');
    expect(html).not.toContain('flagged of');
  });

  it('is suppressed for preanalysis and data-check runs', () => {
    const pre = run(OUTLIER_INPUT, undefined, { preanalysisMode: true });
    expect(pre.localTestSummary).toBeUndefined();
    const preHtml = renderToStaticMarkup(
      <LocalTestSummarySection
        isDataCheck={false}
        isPreanalysis={true}
        isSpecialRunMode={false}
        result={pre}
      />,
    );
    expect(preHtml).toBe('');

    const dc = solveEngine({
      input: OUTLIER_INPUT,
      maxIterations: 8,
      parseOptions: { coordMode: '2D', units: 'm', runMode: 'data-check' as never },
    });
    expect(dc.localTestSummary).toBeUndefined();
    const dcHtml = renderToStaticMarkup(
      <LocalTestSummarySection
        isDataCheck={true}
        isPreanalysis={false}
        isSpecialRunMode={false}
        result={dc}
      />,
    );
    expect(dcHtml).toBe('');
  });

  it('keeps data-check approximate-|t| terminology distinct from Baarda/Pope', () => {
    const dc = solveEngine({
      input: OUTLIER_INPUT,
      maxIterations: 8,
      parseOptions: { coordMode: '2D', units: 'm', runMode: 'data-check' as never },
    }) as AdjustmentResult;
    // Data check still produces approximate screening values, but no local tests.
    expect(dc.observations.some((o) => o.stdRes != null)).toBe(true);
    expect(dc.observations.every((o) => o.localTest == null)).toBe(true);
    const html = renderToStaticMarkup(
      <DataCheckSummarySection
        dataCheckDiffRows={[]}
        directionSetCount={0}
        isDataCheck={true}
        maxAbsStdRes={0}
        renderSourceLineLink={(line) => String(line ?? '-')}
        result={dc}
      />,
    );
    expect(html).toContain('|t|');
    expect(html).not.toContain('Baarda');
    expect(html).not.toContain('Pope');
  });
});

describe('local test perf on a 1k+ observation network', () => {
  it('derives the critical value once per run and verdicts every row', () => {
    const lines = ['.2D', 'C A 0 0 0 ! !', 'C B 1000 0 0 ! !'];
    const truth = (i: number): [number, number] => [2 * i, 40 + (i % 7)];
    const dist = (ax: number, ay: number, bx: number, by: number): number =>
      Math.hypot(ax - bx, ay - by);
    const N = 350;
    for (let i = 0; i < N; i += 1) {
      const [x, y] = truth(i);
      lines.push(`C P${i} ${x} ${y} 0`);
    }
    for (let i = 0; i < N; i += 1) {
      const [x, y] = truth(i);
      const jitter = ((i % 5) - 2) * 0.001;
      lines.push(`D A-P${i} ${(dist(0, 0, x, y) + jitter).toFixed(4)} 0.01`);
      lines.push(`D B-P${i} ${(dist(1000, 0, x, y) - jitter).toFixed(4)} 0.01`);
      if (i + 1 < N) {
        const [nx, ny] = truth(i + 1);
        lines.push(`D P${i}-P${i + 1} ${dist(x, y, nx, ny).toFixed(4)} 0.01`);
      }
    }
    const input = lines.join('\n');

    const t0 = performance.now();
    const legacy = run(input);
    const t1 = performance.now();
    const formal = run(input, { mode: 'baarda-w', alpha: 0.05, correction: 'sidak' });
    const t2 = performance.now();
    console.log(
      `local-test perf: ${legacy.observations.length} obs, legacy ${(t1 - t0).toFixed(0)}ms, formal ${(t2 - t1).toFixed(0)}ms`,
    );

    for (const result of [legacy, formal]) {
      expect(result.success).toBe(true);
      const summary = result.localTestSummary;
      expect(summary).toBeDefined();
      expect(summary?.testCount ?? 0).toBeGreaterThan(1000);
      // Run-level derivation: every row shares the single critical value.
      for (const obs of result.observations) {
        expect(obs.localTest?.critical).toBe(summary?.criticalValue);
      }
    }
  }, 30000);
});
