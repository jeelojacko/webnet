import { readFileSync } from 'node:fs';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ReportView from '../src/components/ReportView';
import { LSAEngine } from '../src/engine/adjust';

describe('ReportView GPS sideshot sections', () => {
  it('renders dedicated GPS sideshot section for mixed GPS NETWORK/SIDESHOT datasets', () => {
    const input = readFileSync('tests/fixtures/gps_network_sideshot_phase3.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();

    const html = renderToStaticMarkup(
      <ReportView
        result={result}
        units="m"
        runDiagnostics={null}
        excludedIds={new Set<number>()}
        onToggleExclude={() => {}}
        onApplyImpactExclude={() => {}}
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

    expect(html).toContain('Post-Adjusted GPS Sideshot Vectors');
    expect(html).toContain('RTK1');
    expect(html).toContain('vector');
    expect(html).not.toContain('Post-Adjusted Sideshots (TS)');
  });

  it('renders GPS loop diagnostics section with ranked pass/warn rows', () => {
    const input = readFileSync('tests/fixtures/gps_loop_phase2.dat', 'utf-8');
    const result = new LSAEngine({ input, maxIterations: 10 }).solve();

    const html = renderToStaticMarkup(
      <ReportView
        result={result}
        units="m"
        runDiagnostics={null}
        excludedIds={new Set<number>()}
        onToggleExclude={() => {}}
        onApplyImpactExclude={() => {}}
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

    expect(html).toContain('GPS Loop Diagnostics');
    expect(html).toContain('GPS Loop Suspects (ranked)');
    expect(html).toContain('GL-1');
    expect(html).toContain('GL-2');
    expect(html).toContain('WARN');
    expect(html).toContain('PASS');
    expect(html).toContain('50ppm*dist');
  });
});
