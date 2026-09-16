import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import { appendTypeAndResidualSections } from '../src/engine/runResultsTextResidualSections';
import { buildObservationsResidualsCsvText } from '../src/engine/browserObservationResidualsCsv';
import { computeStochasticGroupDiagnostics } from '../src/engine/stochasticGroupDiagnostics';
import type { AdjustmentResult } from '../src/types';
import { buildStochasticPointerLine } from '../src/engine/stochasticDiagnosticsDisplay';
import { StochasticDiagnosticsSection } from '../src/components/report/ReportRunSummarySections';

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

const run = (input: string) =>
  solveEngine({ input, maxIterations: 8, parseOptions: { coordMode: '2D', units: 'm' } });

const renderSection = (result: AdjustmentResult) =>
  renderToStaticMarkup(
    <StochasticDiagnosticsSection
      isDataCheck={false}
      isPreanalysis={false}
      isSpecialRunMode={false}
      result={result}
    />,
  );

describe('stochastic diagnostics report section', () => {
  it('renders a dedicated section with per-group rows and the chi-square-fail pointer', () => {
    const result = run(OUTLIER_INPUT) as unknown as AdjustmentResult;
    expect(result.chiSquare?.pass95).toBe(false);
    const html = renderSection(result);
    expect(html).toContain('Stochastic model diagnostics');
    expect(html).toContain('Distances');
    expect(html).toContain('Angles');
    expect(html).toContain('×2.04');
    expect(html).toContain('First-pass pointer only');
    expect(html).toContain('largest diagnostic group scale Distances ×2.04');
    expect(html).toContain('may indicate');
    // Neutral presentation: no threshold coloring classes on the table.
    expect(html).not.toContain('text-green-400');
    expect(html).not.toContain('text-red-400');
    // Scale tooltip carries the §25 neutral reading.
    expect(html).toContain('observed variation exceeds stated precision');
  });

  it('omits the pointer when the global test passes', () => {
    const result = run(OUTLIER_INPUT) as unknown as AdjustmentResult;
    const passing = {
      ...result,
      chiSquare: result.chiSquare ? { ...result.chiSquare, pass95: true } : undefined,
    } as AdjustmentResult;
    const html = renderSection(passing);
    expect(html).toContain('Stochastic model diagnostics');
    expect(html).not.toContain('Global stochastic model check failed');
  });

  it('shows unestimable and unavailable rows with reasons, never hidden', () => {
    const base = run(OUTLIER_INPUT) as unknown as AdjustmentResult;
    const patched = {
      ...base,
      stochasticDiagnostics: {
        groups: [
          {
            label: 'Zenith',
            equations: 2,
            redundancyDof: 0,
            quadForm: 0.001,
            descriptiveFactor: 0.02,
            status: 'unestimable',
            reason: 'group redundancy is zero (uncontrolled or singular)',
          },
          {
            label: 'GPS',
            equations: 6,
            redundancyDof: 3.5,
            quadForm: 4.2,
            descriptiveFactor: 0.8,
            status: 'unavailable',
            reason: 'Huber reweighting active; first-pass diagnostics inapplicable to frozen weights',
          },
        ],
      },
    } as unknown as AdjustmentResult;
    const html = renderSection(patched);
    expect(html).toContain('Zenith');
    expect(html).toContain('unestimable — group redundancy is zero (uncontrolled or singular)');
    expect(html).toContain('GPS');
    expect(html).toContain(
      'unavailable — Huber reweighting active; first-pass diagnostics inapplicable to frozen weights',
    );
  });

  it('is suppressed for preanalysis and data-check runs', () => {
    const result = run(OUTLIER_INPUT) as unknown as AdjustmentResult;
    const preHtml = renderToStaticMarkup(
      <StochasticDiagnosticsSection
        isDataCheck={false}
        isPreanalysis={true}
        isSpecialRunMode={false}
        result={result}
      />,
    );
    expect(preHtml).toBe('');
    const dcHtml = renderToStaticMarkup(
      <StochasticDiagnosticsSection
        isDataCheck={true}
        isPreanalysis={false}
        isSpecialRunMode={false}
        result={result}
      />,
    );
    expect(dcHtml).toBe('');
  });
});

describe('stochastic pointer tail direction', () => {
  const pointerResult = (varianceFactor: number, lower: number, upper: number) =>
    ({
      chiSquare: {
        T: varianceFactor * 2,
        dof: 2,
        p: 0.01,
        pass95: false,
        alpha: 0.05,
        lower: lower * 2,
        upper: upper * 2,
        varianceFactor,
        varianceFactorLower: lower,
        varianceFactorUpper: upper,
      },
      stochasticDiagnostics: {
        groups: [
          {
            label: 'Distances',
            equations: 3,
            redundancyDof: 2,
            quadForm: 8,
            descriptiveFactor: 1.63,
            varianceFactor: 4,
            sigmaScale: 2,
            status: 'estimated',
          },
          {
            label: 'Angles',
            equations: 3,
            redundancyDof: 2,
            quadForm: 0.5,
            descriptiveFactor: 0.41,
            varianceFactor: 0.25,
            sigmaScale: 0.5,
            status: 'estimated',
          },
        ],
      },
    }) as unknown as AdjustmentResult;

  it('points at the largest scale on upper-tail failure', () => {
    const line = buildStochasticPointerLine(pointerResult(4, 0.5, 2.5));
    expect(line).toContain('largest diagnostic group scale Distances ×2.00');
    expect(line).toContain('may indicate');
  });

  it('points at the smallest scale on lower-tail failure', () => {
    const line = buildStochasticPointerLine(pointerResult(0.2, 0.5, 2.5));
    expect(line).toContain('smallest diagnostic group scale Angles ×0.50');
    expect(line).toContain('may indicate');
  });

  it('renders contaminated groups without quadform/descriptive numbers', () => {
    const base = run(OUTLIER_INPUT) as unknown as AdjustmentResult;
    const patched = {
      ...base,
      stochasticDiagnostics: {
        groups: [
          {
            label: 'Angles',
            equations: 1,
            redundancyDof: 0.4,
            quadForm: null,
            descriptiveFactor: null,
            status: 'unestimable',
            reason: 'a correlated pair spans two stochastic groups; refusing to split it (fail closed)',
          },
          {
            label: 'Distances',
            equations: 3,
            redundancyDof: 4e-5,
            quadForm: 0.5,
            descriptiveFactor: 0.41,
            varianceFactor: 12500,
            sigmaScale: 111.8,
            status: 'estimated',
          },
        ],
      },
    } as unknown as AdjustmentResult;
    const html = renderSection(patched);
    // Withheld values render as '-' (dash cells), never as partial numbers.
    expect(html).toContain('Angles');
    expect(html).toContain('refusing to split it');
    // Low-redundancy estimated row is labeled indicative-only with adaptive R.
    expect(html).toContain('indicative only');
    expect(html).toContain((4e-5).toExponential(2));
  });
});

describe('stochastic diagnostics text export', () => {
  it('appends an additive diagnostics block without touching listing/CSV paths', () => {
    const result = run(OUTLIER_INPUT) as unknown as AdjustmentResult;
    const lines: string[] = [];
    appendTypeAndResidualSections({
      lines,
      res: result,
      context: { linearUnit: 'm', unitScale: 1, isPreanalysis: false },
    });
    const text = lines.join('\n');
    expect(text).toContain('--- Stochastic Model Diagnostics ---');
    expect(text).toContain('Distances: eqns=3');
    expect(text).toContain('scale=×2.04');
    expect(text).toContain('largest diagnostic group scale Distances ×2.04');
    // Reliability block still precedes it; ordering preserved.
    expect(text.indexOf('--- Reliability (MDB / External) ---')).toBeLessThan(
      text.indexOf('--- Stochastic Model Diagnostics ---'),
    );
  });

  it('leaves the per-row CSV layout untouched (no stochastic columns)', () => {
    const result = run(OUTLIER_INPUT) as unknown as AdjustmentResult;
    const text = buildObservationsResidualsCsvText({ result, units: 'm' });
    const header = text.split('\n')[0] ?? '';
    expect(header).not.toMatch(/stochastic|sForstner|varianceFactor|sigmaScale/i);
  });
});

describe('stochastic diagnostics overhead', () => {
  it('costs sub-millisecond on ~1k equations with zero extra solves', () => {
    // Perf note (2026-09-16, ~1k scalar equations): the diagnostics consume
    // the solve residuals and Qvv diagonal map directly — the module imports
    // no solver and performs no re-solve, so extra solves are 0 by
    // construction. Measured mean compute time: 0.143ms per call over 50
    // calls (vs ~2.5ms for a full 7-observation solve on the same machine).
    const scalarRows = Array.from({ length: 1000 }, (_, row) => ({
      row,
      group: row % 2 === 0 ? 'Distances' : 'Angles',
      v: 0.005 * ((row % 7) - 3),
      w: 10000,
      qvv: 0.00005,
    }));
    const start = performance.now();
    const diagnostics = computeStochasticGroupDiagnostics({
      scalarRows,
      blocks: [],
      crossTerms: [],
      crossGroupContaminatedGroups: [],
    });
    const elapsedMs = performance.now() - start;
    expect(diagnostics.groups).toHaveLength(2);
    expect(diagnostics.groups.every((g) => g.status === 'estimated')).toBe(true);
    expect(elapsedMs).toBeLessThan(100);
  });
});
