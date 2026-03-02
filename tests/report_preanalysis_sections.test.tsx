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
      'B A-P ? !',
    ].join('\n');
    const result = new LSAEngine({
      input,
      maxIterations: 6,
      parseOptions: { preanalysisMode: true, coordMode: '2D' },
    }).solve();
    result.preanalysisImpactDiagnostics = {
      enabled: true,
      activePlannedCount: 3,
      excludedPlannedCount: 0,
      baseWorstStationMajor: 0.01,
      baseMedianStationMajor: 0.008,
      baseWorstPairSigmaDist: 0.012,
      baseWeakStationCount: 1,
      baseWeakPairCount: 0,
      rows: [
        {
          obsId: 1,
          type: 'dist',
          stations: 'A -> P',
          sourceLine: 5,
          plannedActive: true,
          action: 'remove',
          deltaWorstStationMajor: 0.002,
          deltaMedianStationMajor: 0.001,
          deltaWorstPairSigmaDist: 0.003,
          deltaWeakStationCount: 1,
          deltaWeakPairCount: 0,
          score: 0.25,
          status: 'ok',
        },
      ],
    };

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

    expect(html).toContain('Preanalysis Planning Summary');
    expect(html).toContain('Station Covariance Blocks');
    expect(html).toContain('Predicted Relative Precision (Connected Pairs)');
    expect(html).toContain('Weak Geometry Cues');
    expect(html).toContain('Planned Observation What-If Analysis');
    expect(html).toContain('Locked Planned Observations');
    expect(html).toContain('Locked planned constraint; excluded from what-if actions.');
    expect(html).toContain(
      'title="Planned observations using fixed sigma weighting. They are excluded from what-if removal actions."',
    );
    expect(html).toContain(
      'title="Re-solved planning scenarios showing how predicted precision changes when each removable planned observation is removed or added back."',
    );
    expect(html).toContain('Remove + Re-run');
    expect(html).not.toContain('Observations &amp; Residuals');
    expect(html).not.toContain('Top Suspects');
  });
});
