import { describe, expect, it } from 'vitest';

import { buildCovarianceQueryPlan } from '../src/engine/covarianceQueryPlan';

describe('buildCovarianceQueryPlan', () => {
  it('builds deterministic station queries in unknown order', () => {
    const options = {
      paramIndex: { A: { x: 0, y: 1 }, B: { x: 2, y: 3 } },
      unknowns: ['A', 'B'],
      stationParamCount: 4,
      includeHeight: false,
    };
    const first = buildCovarianceQueryPlan({ ...options });
    const second = buildCovarianceQueryPlan({ ...options });
    expect(second.queries).toEqual(first.queries);
    expect(second.requiredColumns).toEqual(first.requiredColumns);
    // Each station contributes its 2x2 horizontal block in order.
    expect(first.queries).toEqual([
      { row: 0, column: 0 },
      { row: 0, column: 1 },
      { row: 1, column: 0 },
      { row: 1, column: 1 },
      { row: 2, column: 2 },
      { row: 2, column: 3 },
      { row: 3, column: 2 },
      { row: 3, column: 3 },
    ]);
    expect(first.requiredColumns).toEqual([0, 1, 2, 3]);
  });

  it('includes height entries only when requested', () => {
    const base = {
      paramIndex: { A: { x: 0, y: 1, h: 2 } },
      unknowns: ['A'],
      stationParamCount: 3,
    };
    const withHeight = buildCovarianceQueryPlan({ ...base, includeHeight: true });
    const withoutHeight = buildCovarianceQueryPlan({ ...base, includeHeight: false });
    // Horizontal 2x2 block is always emitted; height adds the full 3x3 block.
    expect(withHeight.queries).toHaveLength(13);
    expect(withHeight.requiredColumns).toEqual([0, 1, 2]);
    expect(withoutHeight.queries).toHaveLength(4);
    expect(withoutHeight.requiredColumns).toEqual([0, 1]);
    expect(withoutHeight.queries.every((q) => q.row !== 2 && q.column !== 2)).toBe(true);
  });

  it('deduplicates connected and requested pairs', () => {
    const plan = buildCovarianceQueryPlan({
      paramIndex: { A: { x: 0, y: 1 }, B: { x: 2, y: 3 } },
      unknowns: [],
      stationParamCount: 4,
      includeHeight: false,
      connectedPairs: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
        { from: 'A', to: 'A' },
        { from: '', to: 'B' },
      ],
      requestedPairs: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ],
    });
    expect(plan.connectedPairs).toEqual([{ from: 'A', to: 'B' }]);
    expect(plan.requestedPairs).toEqual([{ from: 'A', to: 'B' }]);
    // One 2x2 cross block per unique pair list (connected + requested).
    expect(plan.queries).toHaveLength(8);
  });

  it('orders required columns and filters out-of-range entries', () => {
    const plan = buildCovarianceQueryPlan({
      paramIndex: {
        B: { x: 3, y: 2 },
        A: { x: 0, y: 9 },
        C: {},
      },
      unknowns: ['B', 'A', 'C'],
      stationParamCount: 4,
      includeHeight: false,
    });
    // 9 (>= stationParamCount) and missing entries are excluded; rest sorted.
    expect(plan.requiredColumns).toEqual([0, 2, 3]);
    // Queries with negative indices are skipped by addQuery.
    expect(plan.queries.every((q) => q.row >= 0 && q.column >= 0)).toBe(true);
  });
});
