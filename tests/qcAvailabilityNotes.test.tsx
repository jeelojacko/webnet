import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  formatQcAvailability,
  formatQcSummaryMissing,
} from '../src/engine/qcAvailability';
import { QC_RESTRICTION_NOTES } from '../src/engine/qcRestrictionNotes';
import {
  LocalTestSummarySection,
  ReliabilitySummarySection,
  StochasticDiagnosticsSection,
} from '../src/components/report/ReportRunSummarySections';
import type { AdjustmentResult } from '../src/types';

describe('14F §§16-17 QC availability taxonomy and restriction language', () => {
  it('covers the six-category unavailable vocabulary with reasons', () => {
    for (const category of [
      'unavailable',
      'unestimable',
      'insufficient-data',
      'not-analyzed',
      'not-applicable',
      'cancelled',
    ] as const) {
      const line = formatQcAvailability('Local testing', category, 'dof too small');
      expect(line).toContain('Local testing');
      expect(line).toContain(category);
      expect(line).toContain('dof too small');
    }
  });

  it('missing run summaries report not-analyzed with a reason', () => {
    expect(formatQcSummaryMissing('Reliability')).toContain('not-analyzed');
    expect(formatQcSummaryMissing('Reliability')).toContain('not reported for this run');
  });

  it('centralizes the eight canonical restriction notes (§17)', () => {
    expect(Object.keys(QC_RESTRICTION_NOTES).sort()).toEqual(
      [
        'freeNetworkDatum',
        'orientationAbsorbsOffsets',
        'popeApproximation',
        'robustFrozenWeights',
        'sequenceNotTime',
        'sparseRoute',
        'stochasticNotVce',
        'systematicDescriptive',
      ].sort(),
    );
    for (const note of Object.values(QC_RESTRICTION_NOTES)) {
      expect(note.length).toBeGreaterThan(20);
    }
  });

  it('strips without summaries state the category instead of a bare line', () => {
    const result = {} as AdjustmentResult;
    const local = renderToStaticMarkup(
      <LocalTestSummarySection
        isDataCheck={false}
        isPreanalysis={false}
        isSpecialRunMode={false}
        result={result}
      />,
    );
    expect(local).toContain('not-analyzed');
    const reliability = renderToStaticMarkup(
      <ReliabilitySummarySection
        isDataCheck={false}
        isPreanalysis={false}
        isSpecialRunMode={false}
        result={result}
      />,
    );
    expect(reliability).toContain('not-analyzed');
    const stochastic = renderToStaticMarkup(
      <StochasticDiagnosticsSection
        isDataCheck={false}
        isPreanalysis={false}
        isSpecialRunMode={false}
        result={result}
      />,
    );
    expect(stochastic).toContain('not-analyzed');
  });
});
