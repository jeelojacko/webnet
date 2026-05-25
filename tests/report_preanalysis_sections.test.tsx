import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ReportView from '../src/components/ReportView';
import { LSAEngine } from '../src/engine/adjust';

describe('ReportView preanalysis sections', () => {
  it('renders planning-specific preanalysis section headers but defers heavy table rows by default', () => {
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
      activeSyntheticAdditionCount: 1,
      candidateTemplateCount: 3,
      remainingFeasibleScenarioCount: 3,
      baseWorstStationMajor: 0.01,
      baseMedianStationMajor: 0.008,
      baseWorstPairSigmaDist: 0.012,
      baseWeakStationCount: 1,
      baseWeakPairCount: 0,
      targetThresholdMeters: 0.007,
      bracePreviewPoints: [],
      scenarioPreviewPoints: [],
      scenarioPreviewSegments: [],
      rows: [
        {
          scenarioId: 'A:set-1',
          scenarioKind: 'existing-set',
          occupyStationId: 'A',
          setupStationIds: ['A'],
          templateLabel: 'Set 1',
          affectedStations: ['A', 'P'],
          affectedPairs: [{ from: 'A', to: 'P' }],
          sourceLines: [5, 6],
          addedObservationCount: 2,
          deltaWorstStationMajor: 0.002,
          deltaMedianStationMajor: 0.001,
          deltaWorstPairSigmaDist: 0.003,
          deltaWeakStationCount: 1,
          deltaWeakPairCount: 0,
          score: 0.25,
          thresholdReached: false,
          status: 'ok',
        },
      ],
      thresholdPlan: {
        targetThresholdMeters: 0.007,
        thresholdReached: false,
        appliedStepCount: 1,
        finalWorstStationMajor: 0.008,
        unmetReason: 'Need more valid setup templates.',
        steps: [
          {
            rank: 1,
            scenarioId: 'A:set-1',
            scenarioKind: 'existing-set',
            occupyStationId: 'A',
            setupStationIds: ['A'],
            templateLabel: 'Set 1',
            addedObservationCount: 2,
            projectedWorstStationMajor: 0.008,
            thresholdReached: false,
          },
        ],
      },
    };
    result.parseState = {
      ...(result.parseState ?? {}),
      directionSetTreatmentDiagnostics: [
        {
          setId: 'SET1',
          occupy: 'P',
          sourceLine: 5,
          readingCount: 3,
          targetCount: 2,
          faceSource: 'unknown',
          treatmentDecision: 'reduced',
          policyOutcome: 'keep',
          faceNormalizationMode: 'paired',
        },
      ],
    } as any;

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
    expect(html).toContain('Preanalysis Added-Set / Brace Recommendations');
    expect(html).toContain('Locked Planned Observations');
    expect(html).toContain('Top Station');
    expect(html).toContain('Top CEE');
    expect(html).toContain('Pairs');
    expect(html).toContain('Top Pair');
    expect(html).toContain('Top σDist');
    expect(html).toContain('Median Station Major');
    expect(html).toContain('Pair Flags');
    expect(html).toContain(
      'title="Planned observations using fixed sigma weighting. They are excluded from synthetic added-set recommendations."',
    );
    expect(html).toContain(
      'title="Re-solved planning scenarios showing how predicted precision changes when one whole synthetic setup set or a bounded synthetic brace-point scenario is added near weak geometry."',
    );
    expect(html).toContain('Show');
    expect(html).not.toContain('Locked planned constraint; excluded from what-if actions.');
    expect(html).not.toContain('Add Set + Re-run');
    expect(html).not.toContain('dWorstMaj (m)');
    expect(html).not.toContain('Setup');
    expect(html).not.toContain('Action');
    expect(html).not.toContain('Direction Face Treatment Diagnostics');
    expect(html).not.toContain('Observations &amp; Residuals');
    expect(html).not.toContain('Top Suspects');
  });
});
