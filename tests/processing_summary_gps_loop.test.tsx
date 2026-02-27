import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ProcessingSummaryView from '../src/components/ProcessingSummaryView';
import { LSAEngine } from '../src/engine/adjust';

describe('ProcessingSummaryView GPS loop diagnostics', () => {
  it('renders GPS loop tolerance and ranking lines when loop check is enabled', () => {
    const input = readFileSync('tests/fixtures/gps_loop_phase2.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();

    const html = renderToStaticMarkup(
      <ProcessingSummaryView result={result} units="m" runElapsedMs={null} runDiagnostics={null} />,
    );

    expect(html).toContain('GPS Loop Check: vectors=5, loops=2, pass=1, warn=1');
    expect(html).toContain('#1 GL-');
    expect(html).toContain('#2 GL-');
    expect(html).toContain('ppm=');
    expect(html).toContain('ratio=1:');
  });
});
