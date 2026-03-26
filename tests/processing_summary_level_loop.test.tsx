import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ProcessingSummaryView from '../src/components/ProcessingSummaryView';
import { LSAEngine } from '../src/engine/adjust';

describe('ProcessingSummaryView leveling loop diagnostics', () => {
  it('renders leveling loop ranking lines when differential leveling loops are present', () => {
    const input = readFileSync('tests/fixtures/level_loop_phase1.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();

    const html = renderToStaticMarkup(
      <ProcessingSummaryView result={result} units="m" runElapsedMs={null} runDiagnostics={null} />,
    );

    expect(html).toContain(
      'Leveling Loop Check: obs=5, loops=2, pass=0, warn=2, totalLength=0.004km, warnLength=0.005km, tolerance=0.00mm+4.00mm*sqrt(km)',
    );
    expect(html).toContain('#1 LL-');
    expect(html).toContain('#2 LL-');
    expect(html).toContain('WARN');
    expect(html).toContain('suspect #1');
    expect(html).toContain('tol=');
    expect(html).toContain('mm/sqrt(km)=');
    expect(html).toContain('path=');
  });
});
