import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ReportView from '../src/components/ReportView';
import { LSAEngine } from '../src/engine/adjust';

describe('ReportView leveling loop sections', () => {
  it('renders dedicated leveling loop diagnostics and suspect tables', () => {
    const input = readFileSync('tests/fixtures/level_loop_phase1.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();

    const html = renderToStaticMarkup(
      <ReportView
        result={result}
        units="m"
        runDiagnostics={null}
        excludedIds={new Set<number>()}
        onToggleExclude={() => {}}
        onApplyImpactExclude={() => {}}
        onApplyPreanalysisAction={() => {}}
        onReRun={() => {}}
        onClearExclusions={() => {}}
        overrides={{}}
        onOverride={() => {}}
        onResetOverrides={() => {}}
        clusterReviewDecisions={{}}
        activeClusterApprovedMerges={[]}
        onClusterDecisionStatus={() => {}}
        onClusterCanonicalSelection={() => {}}
        onApplyClusterMerges={() => {}}
        onResetClusterReview={() => {}}
        onClearClusterMerges={() => {}}
      />,
    );

    expect(html).toContain('Leveling Loop Diagnostics');
    expect(html).toContain('Tolerance Model');
    expect(html).toContain('Leveling Loop Suspects (ranked)');
    expect(html).toContain('LL-1');
    expect(html).toContain('LL-2');
    expect(html).toContain('Tol (mm)');
    expect(html).toContain('mm/sqrt(km)');
    expect(html).toContain('C-&gt;A-&gt;D-&gt;C');
    expect(html).toContain('Closure');
  });
});
