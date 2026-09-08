/**
 * Phase 8B bounded-sentinel guards (production modules only).
 *
 * Proves the pre-8B n^2 / full-inverse sentinel costs are gone from the
 * production route: no all-pairs query builder, no full-inverse or
 * full-matrix unscale helpers, and no n*n-sized query construction in
 * either production file. (The n x n dense normal N itself is inherent:
 * the sentinel factors dense N with n <= 256 Phase 9B runtime; the ban targets query
 * counts and materialized Qxx.) Plus deterministic bounded-column math:
 * complete-column coverage, hard k = 16, C1 agreement/rejection, and C2
 * bounded verification agreement.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  accumulatePackedNormal,
  buildBoundedVerificationQueries,
  buildDiagonalQueries,
  evaluateSentinelC1,
  evaluateSentinelC2,
  PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS,
  PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT,
  PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
  probeSelectedCovariance,
  type PreanalysisSparsePackedSystem,
} from '../src/engine/preanalysisSparseCovarianceSentinel';

const SENTINEL_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src/engine/preanalysisSparseCovarianceSentinel.ts'),
  'utf-8',
);
const ROUTE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src/workers/preanalysisSparseAutoRoute.ts'),
  'utf-8',
);
const GATE_SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'src/workers/preanalysisSparseCovarianceGate.ts'),
  'utf-8',
);

/** Deterministic SPD fixture: diagonally-dominant chain with weak links. */
const makeSystem = (n: number): PreanalysisSparsePackedSystem => {
  const rowOffsets: number[] = [0];
  const columns: number[] = [];
  const values: number[] = [];
  const m = 2 * n;
  for (let row = 0; row < m; row += 1) {
    if (row % 2 === 0) {
      const i = (row / 2) | 0;
      columns.push(i % n);
      values.push(1 + (i % 5) * 0.1);
    } else {
      const i = ((row - 1) / 2) | 0;
      columns.push(i % n);
      values.push(0.7);
      columns.push((i + 1) % n);
      values.push(-0.4);
    }
    rowOffsets.push(columns.length);
  }
  const rows: number[] = [];
  const cols: number[] = [];
  const weights: number[] = [];
  for (let row = 0; row < m; row += 1) {
    rows.push(row);
    cols.push(row);
    weights.push(1 + (row % 3) * 0.25);
  }
  return {
    design: {
      rowOffsets: Int32Array.from(rowOffsets),
      columns: Int32Array.from(columns),
      values: Float64Array.from(values),
    },
    weights: {
      rows: Int32Array.from(rows),
      columns: Int32Array.from(cols),
      values: Float64Array.from(weights),
    },
    observationEquationCount: m,
    parameterCount: n,
  };
};

describe('phase 8B bounded-sentinel source guards', () => {
  it('keeps the n^2 all-pairs builder out of production', () => {
    for (const [name, source] of [['sentinel', SENTINEL_SOURCE], ['route', ROUTE_SOURCE], ['gate', GATE_SOURCE]] as const) {
      expect(source, `${name} references buildAllPairsQueries`).not.toContain('buildAllPairsQueries');
    }
  });

  it('keeps full-inverse / full-matrix helpers out of the production route', () => {
    for (const token of ['invertSPDFromCholesky', 'unscaleNormalInverse', 'scaleNormalMatrix']) {
      expect(ROUTE_SOURCE, `route references ${token}`).not.toContain(token);
      expect(GATE_SOURCE, `gate references ${token}`).not.toContain(token);
    }
  });

  it('builds no n*n-sized query in any production file', () => {
    for (const [name, source] of [['sentinel', SENTINEL_SOURCE], ['route', ROUTE_SOURCE], ['gate', GATE_SOURCE]] as const) {
      expect(source, `${name} builds an n*n query`).not.toMatch(/\bn\s*\*\s*n\b/);
    }
  });

  it('documents the hard verification-column bound k = 16', () => {
    expect(PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT).toBe(16);
    expect(GATE_SOURCE).toContain('PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT');
  });
});

describe('phase 8B bounded verification columns', () => {
  it('emits complete deterministic columns including 0 and n-1', () => {
    const first = buildBoundedVerificationQueries(128);
    const second = buildBoundedVerificationQueries(128);
    expect(first.verifiedColumns).toEqual(second.verifiedColumns);
    expect(first.verifiedColumns.length).toBe(16);
    expect(first.verifiedColumns[0]).toBe(0);
    expect(first.verifiedColumns[first.verifiedColumns.length - 1]).toBe(127);
    expect(first.rows.length).toBe(16 * 128);
    // Every verified column carries all n rows (full columns only).
    for (const column of first.verifiedColumns) {
      const rows = Array.from(first.rows).filter((_, k) => first.columns[k] === column);
      expect(rows.length).toBe(128);
      expect(Math.min(...rows)).toBe(0);
      expect(Math.max(...rows)).toBe(127);
    }
  });

  it('verifies every column when n <= k', () => {
    const built = buildBoundedVerificationQueries(10);
    expect(built.verifiedColumns).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(built.rows.length).toBe(100);
  });

  it('fails closed on bad sizes (runtime default 256; historical 128 explicit)', () => {
    expect(() => buildBoundedVerificationQueries(0)).toThrow();
    // Production default is the Phase 9B runtime cap: 256 builds bare.
    const builtDefault = buildBoundedVerificationQueries(256);
    expect(builtDefault.verifiedColumns.length).toBe(16);
    expect(builtDefault.rows.length).toBe(16 * 256);
    expect(() => buildBoundedVerificationQueries(257)).toThrow();
    // Historical 128 bound still fails closed when passed explicitly.
    expect(() =>
      buildBoundedVerificationQueries(
        PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT + 1,
        PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
        PREANALYSIS_SPARSE_SENTINEL_MAX_UNKNOWN_COUNT,
      ),
    ).toThrow();
    // Explicit-cap 256 agrees with the default; 257 fails closed either way.
    const built256 = buildBoundedVerificationQueries(
      256,
      PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
      PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS,
    );
    expect(built256.verifiedColumns).toEqual(builtDefault.verifiedColumns);
    expect(() =>
      buildBoundedVerificationQueries(
        PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS + 1,
        PREANALYSIS_SPARSE_VERIFICATION_COLUMN_COUNT,
        PREANALYSIS_SPARSE_SENTINEL_MAX_PARAMETERS,
      ),
    ).toThrow();
    expect(() => buildBoundedVerificationQueries(32, 0)).toThrow();
  });

  it('C1 agrees on exact selected entries and rejects corruption', () => {
    const system = makeSystem(24);
    const normal = accumulatePackedNormal(system);
    const diagonal = buildDiagonalQueries(24);
    const probe = probeSelectedCovariance(normal, diagonal.rows, diagonal.columns);
    expect(probe.damped).toBe(false);
    expect(evaluateSentinelC1(probe.values, probe.values).pass).toBe(true);
    const corrupted = [...probe.values];
    corrupted[3] = corrupted[3]! * 4 + 1;
    const rejected = evaluateSentinelC1(corrupted, probe.values);
    expect(rejected.pass).toBe(false);
  });

  it('C2 passes on bounded verification columns and rejects corruption', () => {
    const system = makeSystem(40);
    const normal = accumulatePackedNormal(system);
    const bounded = buildBoundedVerificationQueries(40);
    const probe = probeSelectedCovariance(normal, bounded.rows, bounded.columns);
    expect(probe.damped).toBe(false);
    const good = evaluateSentinelC2(normal, bounded.rows, bounded.columns, probe.values);
    expect(good.pass).toBe(true);
    expect(good.perColumnResidual.length).toBe(bounded.verifiedColumns.length);
    const corrupted = [...probe.values];
    corrupted[0] = corrupted[0]! * 2 + 0.5;
    const bad = evaluateSentinelC2(normal, bounded.rows, bounded.columns, corrupted);
    expect(bad.pass).toBe(false);
  });
});
