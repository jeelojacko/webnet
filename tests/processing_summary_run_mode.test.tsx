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

  it('renders full processing notes without truncating long logs', () => {
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { runMode: 'adjustment', coordMode: '2D' },
    }).solve();
    result.logs = Array.from({ length: 45 }, (_, idx) => `LOG-LINE-${idx + 1}`);

    const html = renderToStaticMarkup(
      <ProcessingSummaryView result={result} units="m" runElapsedMs={null} runDiagnostics={null} />,
    );

    expect(html).toContain('Processing Notes (45):');
    expect(html).toContain('LOG-LINE-1');
    expect(html).toContain('LOG-LINE-45');
  });

  it('suppresses the retired CRS projection line while retaining active CRS diagnostics', () => {
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { runMode: 'adjustment', coordMode: '2D' },
    }).solve();
    const html = renderToStaticMarkup(
      <ProcessingSummaryView
        result={result}
        units="m"
        runElapsedMs={null}
        runDiagnostics={{
          solveProfile: 'industry-parity',
          runMode: 'adjustment',
          directionSetMode: 'reduced',
          profileDefaultInstrumentFallback: false,
          rotationAngleRad: 0,
          coordSystemMode: 'grid',
          crsId: 'CA_NAD83_CSRS_UTM_20N',
          localDatumScheme: 'average-scale',
          averageScaleFactor: 1,
          scaleOverrideActive: false,
          commonElevation: 0,
          averageGeoidHeight: 0,
          crsGridScaleEnabled: true,
          crsGridScaleFactor: 0.99987654,
          crsConvergenceEnabled: true,
          crsConvergenceAngleRad: 0.001,
        }}
      />,
    );

    expect(html).not.toContain('CRS / Projection');
    expect(html).toContain('CRS Grid-Ground Scale');
    expect(html).toContain('CRS Convergence');
  });
});
