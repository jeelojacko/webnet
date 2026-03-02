import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ReportView from '../src/components/ReportView';
import { LSAEngine } from '../src/engine/adjust';

describe('ReportView preanalysis sections', () => {
  it('renders planning-specific covariance sections and hides residual tables', () => {
    const input = [
      '.2D',
      'C A 0 0 0 ! !',
      'C B 100 0 0 ! !',
      'C P 60 40 0',
      'D A-P ? 0.003',
      'D B-P ? 0.003',
      'A P-A-B ? 1.0',
    ].join('\n');
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
    }).solve();

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

    expect(html).toContain('Preanalysis Planning Summary');
    expect(html).toContain('Station Covariance Blocks');
    expect(html).toContain('Predicted Relative Precision (Connected Pairs)');
    expect(html).toContain('Weak Geometry Cues');
    expect(html).not.toContain('Observations &amp; Residuals');
    expect(html).not.toContain('Top Suspects');
  });
});
