import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import {
  buildRunSnapshotSummary,
  buildQaDerivedResult,
  buildRunComparison,
  pushRunSnapshot,
  type RunSnapshot,
} from '../src/engine/qaWorkflow';

const buildResult = (input: string) => new LSAEngine({ input, maxIterations: 8 }).solve();

describe('qaWorkflow helpers', () => {
  it('builds shared derived observation and map-link indexes', () => {
    const result = buildResult(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C P 60 40 0',
        'D A-P 72.1110255 0.005',
        'D B-P 56.5685425 0.005',
        'A P-A-B 90-00-00 3',
      ].join('\n'),
    );

    const derived = buildQaDerivedResult(result);

    expect(derived.observationById.size).toBe(result.observations.length);
    expect(derived.stationById.get('P')?.observationIds.length).toBeGreaterThan(0);
    expect(derived.mapLinks.some((link) => link.fromId === 'A' && link.toId === 'P')).toBe(true);
    expect(derived.suspectObservationIds.length).toBeGreaterThanOrEqual(0);
  });

  it('caps in-memory run history to the latest five snapshots', () => {
    let history: Array<RunSnapshot<{ run: number }, null>> = [];
    const baseResult = buildResult(
      ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'D A-B 100 0.01'].join('\n'),
    );

    for (let index = 1; index <= 6; index += 1) {
      history = pushRunSnapshot(history, {
        id: `run-${index}`,
        createdAt: `2026-03-17T00:00:0${index}.000Z`,
        label: `Run ${index}`,
        inputFingerprint: `input-${index}`,
        settingsFingerprint: `settings-${index}`,
        summary: buildRunSnapshotSummary(baseResult),
        result: baseResult,
        runDiagnostics: null,
        settingsSnapshot: { run: index },
        excludedIds: [],
        overrideIds: [],
        overrides: {},
        approvedClusterMerges: [],
        reopenState: null,
      });
    }

    expect(history).toHaveLength(5);
    expect(history[0].id).toBe('run-6');
    expect(history.at(-1)?.id).toBe('run-2');
  });

  it('builds comparison summaries for station movement and residual deltas', () => {
    const baseline = buildResult(
      [
        '.2D',
        'C A 0 0 0 ! !',
        'C B 100 0 0 ! !',
        'C P 50 40 0',
        'D A-P 64.0312424 0.005',
        'D B-P 64.0312424 0.005',
        'A P-A-B 102-40-30 3',
      ].join('\n'),
    );
    const current = structuredClone(baseline);
    current.stations.P.x += 0.75;
    current.stations.P.y -= 0.25;
    if (current.observations[0]) current.observations[0].stdRes = 1.8;
    if (current.observations[1]) current.observations[1].stdRes = 0.2;

    const baselineSnapshot: RunSnapshot<{ name: string }, null> = {
      id: 'baseline',
      createdAt: '2026-03-17T00:00:00.000Z',
      label: 'Run 01',
      inputFingerprint: 'input-baseline',
      settingsFingerprint: 'settings-baseline',
      summary: buildRunSnapshotSummary(baseline),
      result: baseline,
      runDiagnostics: null,
      settingsSnapshot: { name: 'baseline' },
      excludedIds: [],
      overrideIds: [],
      overrides: {},
      approvedClusterMerges: [],
      reopenState: null,
    };
    const currentSnapshot: RunSnapshot<{ name: string }, null> = {
      id: 'current',
      createdAt: '2026-03-17T00:01:00.000Z',
      label: 'Run 02',
      inputFingerprint: 'input-current',
      settingsFingerprint: 'settings-current',
      summary: buildRunSnapshotSummary(current),
      result: current,
      runDiagnostics: null,
      settingsSnapshot: { name: 'current' },
      excludedIds: [1],
      overrideIds: [2],
      overrides: {},
      approvedClusterMerges: [],
      reopenState: null,
    };

    const summary = buildRunComparison(
      currentSnapshot,
      baselineSnapshot,
      {
        baselineRunId: 'baseline',
        pinnedBaselineRunId: null,
        stationMovementThreshold: 0.001,
        residualDeltaThreshold: 0.01,
      },
      ['Units: m -> ft'],
    );

    expect(summary.summaryRows.some((row) => row.label === 'SEUW')).toBe(true);
    expect(summary.movedStations.some((row) => row.stationId === 'P')).toBe(true);
    expect(summary.residualChanges.length).toBeGreaterThan(0);
    expect(summary.exclusionChanges.added).toEqual([1]);
    expect(summary.overrideChanges.added).toEqual([2]);
    expect(summary.settingsDiffs).toEqual(['Units: m -> ft']);
  });
});
