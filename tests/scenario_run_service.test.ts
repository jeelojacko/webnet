import { describe, expect, it } from 'vitest';

import {
  getScenarioRunServiceStats,
  resetScenarioRunServiceCache,
  runComparedAdjustmentScenarios,
  solveEngine,
} from '../src/engine/solveEngine';
import type { ScenarioRunRequest } from '../src/engine/scenarioRunModels';

const input = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.0 0.01',
  'D B-P 64.0 0.01',
  'A P-A-B 102-40-00.0 1.0',
].join('\n');

describe('scenario run service', () => {
  it('reuses the parsed model for exclusion scenarios with unchanged input/settings', () => {
    resetScenarioRunServiceCache();

    const baseline = solveEngine({
      input,
      maxIterations: 8,
      parseOptions: {
        coordMode: '2D',
        units: 'm',
      },
    });
    const excludedObservationId = baseline.observations[0]?.id;

    expect(excludedObservationId).toBeDefined();
    expect(getScenarioRunServiceStats().parseCacheMisses).toBe(1);
    expect(getScenarioRunServiceStats().parseCacheHits).toBe(0);

    solveEngine({
      input,
      maxIterations: 8,
      excludeIds: new Set([excludedObservationId as number]),
      parseOptions: {
        coordMode: '2D',
        units: 'm',
      },
    });

    const stats = getScenarioRunServiceStats();
    expect(stats.parseCacheMisses).toBe(1);
    expect(stats.parseCacheHits).toBe(1);
  });

  it('runs explicit comparison-scenario groups in order while reusing the parsed model', () => {
    resetScenarioRunServiceCache();

    const compared = runComparedAdjustmentScenarios([
      {
        label: 'baseline',
        request: {
          input,
          maxIterations: 8,
          parseOptions: {
            coordMode: '2D',
            units: 'm',
          },
        },
      },
      {
        label: 'current',
        request: {
          input,
          maxIterations: 8,
          parseOptions: {
            coordMode: '2D',
            units: 'm',
          },
        },
      },
    ]);

    expect(compared.map((entry) => entry.label)).toEqual(['baseline', 'current']);
    expect(compared[0]?.result.success).toBe(true);
    expect(compared[1]?.result.success).toBe(true);

    const stats = getScenarioRunServiceStats();
    expect(stats.solveCount).toBe(2);
    expect(stats.parseCacheMisses).toBe(1);
    expect(stats.parseCacheHits).toBe(1);
  });

  it('reuses cached parsed state across repeated cluster dual-pass reruns', () => {
    resetScenarioRunServiceCache();

    const clusterInput = [
      '.2D',
      'C CTRL 0 0 0 ! !',
      'C P1 100.000 100.000 0',
      'C P1_DUP 100.008 100.006 0',
      'D CTRL-P1 141.4214 0.01',
      'D CTRL-P1_DUP 141.4314 0.01',
    ].join('\n');

    const request: ScenarioRunRequest = {
      input: clusterInput,
      maxIterations: 8,
      parseOptions: {
        coordMode: '2D',
        clusterApprovedMerges: [{ aliasId: 'P1_DUP', canonicalId: 'P1' }],
      },
    };

    const first = solveEngine(request);
    const afterFirstRun = getScenarioRunServiceStats();
    const second = solveEngine(request);
    const afterSecondRun = getScenarioRunServiceStats();

    expect(first.clusterDiagnostics?.passMode).toBe('dual-pass');
    expect(second.clusterDiagnostics?.passMode).toBe('dual-pass');

    expect(afterFirstRun.solveCount).toBe(3);
    expect(afterFirstRun.parseCacheMisses).toBe(3);
    expect(afterFirstRun.parseCacheHits).toBe(0);
    expect(afterSecondRun.solveCount).toBe(6);
    expect(afterSecondRun.parseCacheMisses).toBe(3);
    expect(afterSecondRun.parseCacheHits).toBe(3);
  });
});
