import { describe, expect, it } from 'vitest';

import {
  buildClusterMergeOutcomes,
  normalizeClusterWorkflowMerges,
  runClusterDualPassWorkflow,
} from '../src/engine/adjustmentClusterWorkflow';
import type { AdjustmentResult, ClusterApprovedMerge } from '../src/types';

const buildResult = (overrides: Partial<AdjustmentResult> = {}): AdjustmentResult =>
  ({
    success: true,
    converged: true,
    iterations: 1,
    dof: 1,
    seuw: 1,
    chiSquare: null,
    stations: {},
    observations: [],
    unknowns: [],
    covariance: [],
    normalMatrix: [],
    parameterOrder: [],
    relativePrecisions: [],
    logs: [],
    parseState: {
      units: 'm',
      coordMode: '3D',
      order: 'EN',
      deltaMode: 'slope',
      mapMode: 'off',
      normalize: true,
    },
    ...overrides,
  }) as AdjustmentResult;

describe('adjustmentClusterWorkflow', () => {
  it('normalizes merge rows and computes sorted merge outcomes', () => {
    const merges = normalizeClusterWorkflowMerges([
      { aliasId: ' P2 ', canonicalId: ' P1 ' },
      { aliasId: 'P2', canonicalId: 'P1' },
      { aliasId: 'P3', canonicalId: 'P3' },
      { aliasId: '', canonicalId: 'P1' },
      { aliasId: 'P4', canonicalId: 'P1' },
    ]);

    expect(merges).toEqual([
      { aliasId: 'P2', canonicalId: 'P1' },
      { aliasId: 'P4', canonicalId: 'P1' },
    ]);

    const outcomes = buildClusterMergeOutcomes(
      buildResult({
        parseState: {
          units: 'm',
          coordMode: '2D',
          order: 'EN',
          deltaMode: 'slope',
          mapMode: 'off',
          normalize: true,
        },
        stations: {
          P1: { x: 100, y: 100, h: 0, fixed: false },
          P2: { x: 100.008, y: 100.006, h: 0, fixed: false },
        },
      }),
      [{ aliasId: 'P2', canonicalId: 'P1' }, { aliasId: 'P9', canonicalId: 'P1' }],
    );

    expect(outcomes[0]).toMatchObject({
      aliasId: 'P2',
      canonicalId: 'P1',
      horizontalDelta: expect.closeTo(0.01, 6),
    });
    expect(outcomes[1]).toEqual({
      aliasId: 'P9',
      canonicalId: 'P1',
      missing: true,
    });
  });

  it('runs dual-pass orchestration and annotates the pass2 result', () => {
    const pass1 = buildResult({
      parseState: {
        units: 'm',
        coordMode: '2D',
        order: 'EN',
        deltaMode: 'slope',
        mapMode: 'off',
        normalize: true,
      },
      stations: {
        P1: { x: 100, y: 100, h: 0, fixed: false },
        P1_DUP: { x: 100.008, y: 100.006, h: 0, fixed: false },
      },
      clusterDiagnostics: {
        enabled: true,
        passMode: 'single-pass',
        linkageMode: 'complete',
        dimension: '2D',
        tolerance: 0.03,
        pairCount: 1,
        candidateCount: 1,
        candidates: [],
      },
      logs: ['pass1'],
    });
    const pass2 = buildResult({
      parseState: {
        units: 'm',
        coordMode: '2D',
        order: 'EN',
        deltaMode: 'slope',
        mapMode: 'off',
        normalize: true,
      },
      stations: {
        P1: { x: 100, y: 100, h: 0, fixed: false },
      },
      clusterDiagnostics: {
        enabled: true,
        passMode: 'single-pass',
        linkageMode: 'complete',
        dimension: '2D',
        tolerance: 0.03,
        pairCount: 0,
        candidateCount: 0,
        candidates: [],
      },
      logs: ['pass2'],
    });

    const calls: Array<{ merges: ClusterApprovedMerge[] | undefined; label: string | undefined }> = [];
    const result = runClusterDualPassWorkflow({
      requestedRunMode: 'adjustment',
      parseOptions: {
        clusterPassLabel: 'single',
        clusterApprovedMerges: [{ aliasId: 'P1_DUP', canonicalId: 'P1' }],
      },
      solveScenario: (parseOptions) => {
        calls.push({
          merges: parseOptions.clusterApprovedMerges,
          label: parseOptions.clusterPassLabel,
        });
        return calls.length === 1 ? pass1 : pass2;
      },
    });

    expect(calls).toEqual([
      { merges: [], label: 'pass1' },
      {
        merges: [{ aliasId: 'P1_DUP', canonicalId: 'P1' }],
        label: 'pass2',
      },
    ]);
    expect(result?.parseState?.clusterDualPassRan).toBe(true);
    expect(result?.parseState?.clusterApprovedMergeCount).toBe(1);
    expect(result?.clusterDiagnostics?.passMode).toBe('dual-pass');
    expect(result?.clusterDiagnostics?.pass1CandidateCount).toBe(1);
    expect(result?.clusterDiagnostics?.approvedMergeCount).toBe(1);
    expect(result?.clusterDiagnostics?.mergeOutcomes?.[0]?.horizontalDelta).toBeCloseTo(0.01, 6);
    expect(result?.logs[0]).toContain('Cluster dual-pass: pass1 candidates=1, approved merges=1');
  });
});
