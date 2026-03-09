import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ReportView from '../src/components/ReportView';
import { LSAEngine } from '../src/engine/adjust';

const baseInput = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0',
  'C C 100 80 0',
  'D A-B 99.800 0.005',
  'D B-C 80.300 0.005',
  'A B-A-C 90-00-20 5',
].join('\n');

const renderReport = (result: ReturnType<LSAEngine['solve']>) =>
  renderToStaticMarkup(
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

describe('ReportView run-mode sections', () => {
  it('renders Data Check differences section when run mode is data-check', () => {
    const result = new LSAEngine({
      input: baseInput,
      maxIterations: 6,
      parseOptions: { runMode: 'data-check', coordMode: '2D' },
    }).solve();

    const html = renderReport(result);
    expect(html).toContain('Data Check Only: Differences from Observations');
    expect(html).toContain('Approximate-geometry check only');
  });

  it('renders blunder-detect warning section when run mode is blunder-detect', () => {
    const result = new LSAEngine({
      input: baseInput,
      maxIterations: 6,
      parseOptions: { runMode: 'blunder-detect', coordMode: '2D' },
    }).solve();

    const html = renderReport(result);
    expect(html).toContain('Blunder Detect Mode');
    expect(html).toContain('not a replacement for full adjustment QA');
  });
});
