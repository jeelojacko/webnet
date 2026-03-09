import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ProcessingSummaryView from '../src/components/ProcessingSummaryView';
import { LSAEngine } from '../src/engine/adjust';

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0',
  'C C 100 80 0',
  'D A-B 99.800 0.005',
  'D B-C 80.300 0.005',
  'A B-A-C 90-00-20 5',
].join('\n');

describe('ProcessingSummaryView run-mode sections', () => {
  it('shows data-check differences block', () => {
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { runMode: 'data-check', coordMode: '2D' },
    }).solve();
    const html = renderToStaticMarkup(
      <ProcessingSummaryView result={result} units="m" runElapsedMs={null} runDiagnostics={null} />,
    );

    expect(html).toContain('Performing Data Check Only');
    expect(html).toContain('Data Check Only: Differences from Observations');
  });

  it('shows blunder-detect warning/cycle block', () => {
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { runMode: 'blunder-detect', coordMode: '2D' },
    }).solve();
    const html = renderToStaticMarkup(
      <ProcessingSummaryView result={result} units="m" runElapsedMs={null} runDiagnostics={null} />,
    );

    expect(html).toContain('Performing Blunder Detect Workflow');
    expect(html).toContain('Blunder Detect Mode');
    expect(html).toContain('not a replacement for full adjustment QA');
  });
});
