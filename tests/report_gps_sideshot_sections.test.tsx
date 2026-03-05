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

    expect(html).toContain('GPS Loop Diagnostics');
    expect(html).toContain('GPS Loop Suspects (ranked)');
    expect(html).toContain('GL-1');
    expect(html).toContain('GL-2');
    expect(html).toContain('WARN');
    expect(html).toContain('PASS');
    expect(html).toContain('50ppm*dist');
  });

  it('renders dedicated GS coordinate section with relation labeling', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C C 20 10 0',
      'B A-C 063-26-06.0 5.0',
      'D A-C 22.3606798 0.010',
      'GS RTK1 30.000 40.000 1.500 0.020 0.030 0.040 FROM=C',
      'GS RTK2 32.000 42.000 0.030 0.040',
    ].join('\n');
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

    expect(html).toContain('Post-Adjusted GNSS Topo Coordinates (GS)');
    expect(html).toContain('RTK1');
    expect(html).toContain('RTK2');
    expect(html).toContain('FROM=C');
    expect(html).toContain('standalone');
  });
});
