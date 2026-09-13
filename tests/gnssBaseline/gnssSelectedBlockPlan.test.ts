import { describe, expect, it } from 'vitest';
import { buildSolveParameterIndex } from '../../src/engine/adjustmentPreprocessing';
import {
  buildGnssSelectedBlockPlan,
} from '../../src/engine/gnssSelectedBlockPlan';
import type { StationMap } from '../../src/types';

const chain5 = (): { stations: StationMap; baselines: { from: string; to: string }[] } => {
  const stations: StationMap = {};
  for (let i = 0; i < 5; i += 1) {
    const fixed = i === 0;
    stations[`S${i}`] = { x: i, y: 0, h: 0, fixed, fixedX: fixed, fixedY: fixed, fixedH: fixed };
  }
  const baselines = [0, 1, 2, 3].map((i) => ({ from: `S${i}`, to: `S${i + 1}` }));
  return { stations, baselines };
};

describe('gnssSelectedBlockPlan (§12F.2 canonical request set)', () => {
  it('chain-5 dedups to 4 diagonals + 3 off-diagonals', () => {
    const { stations, baselines } = chain5();
    const { paramIndex, stationParamCount } = buildSolveParameterIndex(
      stations, ['S1', 'S2', 'S3', 'S4'], false,
    );
    const plan = buildGnssSelectedBlockPlan(paramIndex, baselines, stationParamCount);
    expect(plan.stationIds).toEqual(['S1', 'S2', 'S3', 'S4']);
    expect(plan.counts).toEqual({
      stations: 4,
      uniqueFreeFreeEdges: 3,
      repeatedObservationsSkipped: 0,
      uniqueBlocks: 7,
      scalarEntries: 4 * 6 + 3 * 9,
    });
    expect(plan.pairs).toEqual([
      { blockA: 0, blockB: 0 },
      { blockA: 0, blockB: 1 },
      { blockA: 1, blockB: 1 },
      { blockA: 1, blockB: 2 },
      { blockA: 2, blockB: 2 },
      { blockA: 2, blockB: 3 },
      { blockA: 3, blockB: 3 },
    ]);
  });

  it('repeated edges are requested once and counted as skipped', () => {
    const { stations, baselines } = chain5();
    const repeated = [
      ...baselines,
      { from: 'S1', to: 'S2' },
      { from: 'S3', to: 'S2' },
      { from: 'S0', to: 'S1' },
    ];
    const { paramIndex, stationParamCount } = buildSolveParameterIndex(
      stations, ['S1', 'S2', 'S3', 'S4'], false,
    );
    const plan = buildGnssSelectedBlockPlan(paramIndex, repeated, stationParamCount);
    expect(plan.counts.uniqueBlocks).toBe(7);
    expect(plan.counts.scalarEntries).toBe(4 * 6 + 3 * 9);
    expect(plan.counts.repeatedObservationsSkipped).toBe(3);
  });

  it('fixed/free edge requests the free diagonal only', () => {
    const { stations } = chain5();
    const { paramIndex, stationParamCount } = buildSolveParameterIndex(stations, ['S1'], false);
    const plan = buildGnssSelectedBlockPlan(
      paramIndex, [{ from: 'S0', to: 'S1' }], stationParamCount,
    );
    expect(plan.pairs).toEqual([{ blockA: 0, blockB: 0 }]);
    expect(plan.counts).toEqual({
      stations: 1,
      uniqueFreeFreeEdges: 0,
      repeatedObservationsSkipped: 0,
      uniqueBlocks: 1,
      scalarEntries: 6,
    });
  });

  it('transpose pairs never duplicate the off-diagonal block', () => {
    const { stations } = chain5();
    const { paramIndex, stationParamCount } = buildSolveParameterIndex(
      stations, ['S1', 'S2'], false,
    );
    const plan = buildGnssSelectedBlockPlan(paramIndex, [
      { from: 'S1', to: 'S2' },
      { from: 'S2', to: 'S1' },
    ], stationParamCount);
    expect(plan.pairs).toEqual([
      { blockA: 0, blockB: 0 },
      { blockA: 0, blockB: 1 },
      { blockA: 1, blockB: 1 },
    ]);
    expect(plan.counts.uniqueFreeFreeEdges).toBe(1);
    expect(plan.counts.repeatedObservationsSkipped).toBe(1);
  });

  it('ordering is deterministic under shuffled input', () => {
    const { stations, baselines } = chain5();
    const { paramIndex, stationParamCount } = buildSolveParameterIndex(
      stations, ['S1', 'S2', 'S3', 'S4'], false,
    );
    const forward = buildGnssSelectedBlockPlan(paramIndex, baselines, stationParamCount);
    const backward = buildGnssSelectedBlockPlan(paramIndex, [...baselines].reverse(), stationParamCount);
    expect(backward).toEqual(forward);
  });
});
