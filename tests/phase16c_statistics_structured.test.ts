/**
 * Phase 16C structured-weight statistics operator (agent tier, fast).
 *
 * - WeightAccess round-trip: structured.weight(i,j) === denseP[i][j]
 *   bit-identical for all m^2 on every family (zeros complete).
 * - Coupled parity: forEachCoupled visits exactly the dense nonzero
 *   column set, ascending, with identical values.
 * - Fault injection: malformed structured input yields null (fail closed).
 * - Full-result parity: structured-stats ON vs kill-switch OFF are
 *   JSON-identical (admitted chain/GPS/sparse-TS, dense-TS fallback,
 *   Huber fallback, small fixtures).
 * - External reliability: structured influence vector equals the dense
 *   baseline; zeroing one off-diagonal must change the vector.
 * - Allocation gate: admitted stats allocates 0 dense P (was 1).
 * - LOO + auto-adjust parity through nested solves.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { solveEngine } from '../src/engine/solveEngine';
import {
  computeExternalInfluences,
} from '../src/engine/adjustExternalReliability';
import {
  denseWeightAccess,
  structuredWeightAccess,
} from '../src/engine/structuredWeightAccess';
import {
  resetStructuredWeightTelemetry,
  snapshotStructuredWeightTelemetry,
} from '../src/engine/structuredWeightTelemetry';
import type { StructuredSymmetricWeights } from '../src/engine/sparseWeightRepresentation';
import type { AdjustmentResult } from '../src/types';
import {
  assembleBoth,
  buildChain2D,
  buildCorrelatedControls,
  buildGnssBaseline,
  buildGps2D,
  buildGps3D,
  buildMixed,
  buildTsDirections,
  buildTsSetupScope,
  buildWeightedControls,
  type BuiltNetwork,
} from './evidence/phase16aWeightEvidenceShared';

const families = (): BuiltNetwork[] => [
  buildChain2D('stats-chain', 8),
  buildGps2D('stats-gps2', 4),
  buildGps3D('stats-gps3', 4),
  buildGnssBaseline('stats-gnss', 3),
  buildTsDirections('stats-ts-set', 2, 4),
  buildTsSetupScope('stats-ts-setup', 2, 4),
  buildWeightedControls('stats-weighted-controls', 8),
  buildCorrelatedControls('stats-correlated-controls', 8),
  buildMixed('stats-mixed'),
];

describe('phase 16C WeightAccess round-trip and coupled parity', () => {
  for (const network of families()) {
    it(`reads bit-identical weights for ${network.id} (${network.kind})`, () => {
      const { dense, sparse } = assembleBoth(network);
      const access = structuredWeightAccess(sparse.structuredWeights!);
      expect(access).not.toBeNull();
      const size = dense.P!.length;
      expect(access!.size).toBe(size);
      for (let row = 0; row < size; row += 1) {
        expect(access!.diagonal(row)).toBe(dense.P![row]![row]);
        for (let column = 0; column < size; column += 1) {
          expect(access!.weight(row, column)).toBe(dense.P![row]![column]);
        }
      }
    });

    it(`iterates identical ascending coupled columns for ${network.id}`, () => {
      const { dense, sparse } = assembleBoth(network);
      const structured = structuredWeightAccess(sparse.structuredWeights!);
      const denseAccess = denseWeightAccess(dense.P!);
      expect(structured).not.toBeNull();
      expect(denseAccess).not.toBeNull();
      const size = dense.P!.length;
      for (let row = 0; row < size; row += 1) {
        const expected: Array<[number, number]> = [];
        for (let column = 0; column < size; column += 1) {
          const value = dense.P![row]![column]!;
          if (value !== 0) expected.push([column, value]);
        }
        const visited: Array<[number, number]> = [];
        structured!.forEachCoupled(row, (column, value) => {
          visited.push([column, value]);
        });
        expect(visited).toEqual(expected);
        const denseVisited: Array<[number, number]> = [];
        denseAccess!.forEachCoupled(row, (column, value) => {
          denseVisited.push([column, value]);
        });
        expect(denseVisited).toEqual(expected);
        const columns = visited.map(([column]) => column);
        expect([...columns].sort((a, b) => a - b)).toEqual(columns);
      }
    });
  }
});

describe('phase 16C WeightAccess fault injection', () => {
  const valid = (): StructuredSymmetricWeights => {
    const { sparse } = assembleBoth(buildGps2D('stats-fault', 2));
    return sparse.structuredWeights!;
  };

  it('returns null on missing or empty input', () => {
    expect(structuredWeightAccess(undefined)).toBeNull();
    expect(denseWeightAccess(undefined)).toBeNull();
    expect(denseWeightAccess([])).toBeNull();
  });

  it('returns null on size and diagonal mismatch', () => {
    const weights = valid();
    expect(
      structuredWeightAccess({ ...weights, size: weights.size + 1 }),
    ).toBeNull();
    expect(
      structuredWeightAccess({
        ...weights,
        diagonal: Float64Array.from({ length: weights.size - 1 }),
      }),
    ).toBeNull();
  });

  it('returns null on ragged triplets, out-of-bounds, and non-canonical entries', () => {
    const weights = valid();
    expect(weights.offValues.length).toBeGreaterThan(0);
    expect(
      structuredWeightAccess({
        ...weights,
        offColumns: Int32Array.from({ length: weights.offRows.length - 1 }),
      }),
    ).toBeNull();
    expect(
      structuredWeightAccess({
        ...weights,
        offRows: Int32Array.of(weights.size),
        offColumns: Int32Array.of(weights.size),
        offValues: Float64Array.of(1),
      }),
    ).toBeNull();
    // Swapped row/column breaks the row<col canonical rule.
    expect(
      structuredWeightAccess({
        ...weights,
        offRows: weights.offColumns,
        offColumns: weights.offRows,
      }),
    ).toBeNull();
  });

  it('returns null on duplicates, zeros, NaN, and Infinity', () => {
    const weights = valid();
    const first = {
      row: weights.offRows[0] as number,
      column: weights.offColumns[0] as number,
      value: weights.offValues[0] as number,
    };
    const duplicated: StructuredSymmetricWeights = {
      size: weights.size,
      diagonal: weights.diagonal,
      offRows: Int32Array.of(first.row, first.row),
      offColumns: Int32Array.of(first.column, first.column),
      offValues: Float64Array.of(first.value, first.value),
    };
    expect(structuredWeightAccess(duplicated)).toBeNull();
    expect(
      structuredWeightAccess({
        ...weights,
        offValues: Float64Array.from(weights.offValues, (value, index) =>
          index === 0 ? 0 : value,
        ),
      }),
    ).toBeNull();
    expect(
      structuredWeightAccess({
        ...weights,
        offValues: Float64Array.from(weights.offValues, (value, index) =>
          index === 0 ? Number.NaN : value,
        ),
      }),
    ).toBeNull();
    expect(
      structuredWeightAccess({
        ...weights,
        offValues: Float64Array.from(weights.offValues, (value, index) =>
          index === 0 ? Number.POSITIVE_INFINITY : value,
        ),
      }),
    ).toBeNull();
    const nanDiagonal = Float64Array.from(weights.diagonal);
    nanDiagonal[0] = Number.NaN;
    expect(
      structuredWeightAccess({ ...weights, diagonal: nanDiagonal }),
    ).toBeNull();
  });

  it('returns null on ragged dense input', () => {
    expect(denseWeightAccess([[1, 0], [0]])).toBeNull();
  });
});

/** Timing/routing-only fields stripped before comparison — never numerics. */
const VOLATILE_KEYS = new Set(['solveTimingProfile', 'elapsedMs']);

const stripVolatile = (value: unknown, key?: string): unknown => {
  if (Array.isArray(value)) {
    const entries =
      key === 'logs'
        ? value.filter(
            (entry) => !(typeof entry === 'string' && entry.startsWith('Solve timing (ms):')),
          )
        : value;
    return entries.map((entry) => stripVolatile(entry));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [entryKey, entry] of Object.entries(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(entryKey)) continue;
      out[entryKey] = stripVolatile(entry, entryKey);
    }
    return out;
  }
  return value;
};

const fingerprint = (result: AdjustmentResult): string => JSON.stringify(stripVolatile(result));

type EngineBase = ConstructorParameters<typeof LSAEngine>[0];

const solveBothStats = (
  input: string,
  base: EngineBase = { input },
): { candidate: AdjustmentResult; legacy: AdjustmentResult } => ({
  candidate: new LSAEngine({ ...base, input }).solve(),
  legacy: new LSAEngine({ ...base, input, structuredStatisticsWeights: false }).solve(),
});

/** Admitted scalar chain: 80 stations, dist+bearing per link, m=200. */
const buildChainInput = (stations: number): string => {
  const lines = ['.2D', 'C A 0 0 0 ! !'];
  const dms = (radians: number): string => {
    const total = (radians * 180) / Math.PI;
    const degrees = Math.floor(total);
    const minutes = Math.floor((total - degrees) * 60);
    const seconds = ((total - degrees) * 3600 - minutes * 60).toFixed(1);
    return `${String(degrees).padStart(3, '0')}-${String(minutes).padStart(2, '0')}-${seconds.padStart(4, '0')}`;
  };
  for (let i = 1; i <= stations; i += 1) {
    lines.push(`C U${i} ${(10 * i + 0.4).toFixed(4)} ${(2 * i + 0.3).toFixed(4)} 0`);
  }
  for (let i = 1; i <= stations; i += 1) {
    const from = i === 1 ? 'A' : `U${i - 1}`;
    lines.push(`D ${from}-U${i} ${Math.hypot(10, 2).toFixed(4)} 0.002`);
    lines.push(`B ${from}-U${i} ${dms(Math.atan2(10, 2))} 1.0`);
  }
  for (let i = 2; i <= stations; i += 2) {
    lines.push(`B A-U${i} ${dms(Math.atan2(10 * i, 2 * i))} 1.0`);
  }
  return lines.join('\n');
};

/** Admitted GPS network: 70 link + 14 tie baselines, m=168. */
const buildGpsInput = (): string => {
  const lines = ['.2D', 'C A 0 0 0 ! !'];
  for (let i = 1; i <= 70; i += 1) {
    lines.push(`C U${i} ${(10 * i + 0.3).toFixed(4)} ${(2 * i + 0.2).toFixed(4)} 0`);
  }
  for (let i = 1; i <= 70; i += 1) {
    const from = i === 1 ? 'A' : `U${i - 1}`;
    lines.push(`G S1 ${from} U${i} 10.0000 2.0000 0.0100 0.0100`);
  }
  for (let i = 5; i <= 70; i += 5) {
    lines.push(`G S1 A U${i} ${(10 * i).toFixed(4)} ${(2 * i).toFixed(4)} 0.0100 0.0100`);
  }
  return lines.join('\n');
};

/**
 * Admitted setup-scope TS network: two bearings per setup share one
 * station key (63 pairs, m=192, density ~0.009).
 */
const buildSparseTsInput = (): string => {
  const lines = ['.2D', 'C A 0 0 0 ! !'];
  const dms = (radians: number): string => {
    const total = (radians * 180) / Math.PI;
    const degrees = Math.floor(total);
    const minutes = Math.floor((total - degrees) * 60);
    const seconds = ((total - degrees) * 3600 - minutes * 60).toFixed(1);
    return `${String(degrees).padStart(3, '0')}-${String(minutes).padStart(2, '0')}-${seconds.padStart(4, '0')}`;
  };
  const stations = 64;
  for (let i = 1; i <= stations; i += 1) {
    lines.push(`C U${i} ${(10 * i + 0.4).toFixed(4)} ${(2 * i + 0.3).toFixed(4)} 0`);
  }
  for (let i = 1; i <= stations; i += 1) {
    const from = i === 1 ? 'A' : `U${i - 1}`;
    lines.push(`D ${from}-U${i} ${Math.hypot(10, 2).toFixed(4)} 0.002`);
  }
  for (let i = 1; i <= stations; i += 1) {
    const from = i === 1 ? 'A' : `U${i - 1}`;
    lines.push(`B ${from}-U${i} ${dms(Math.atan2(10, 2))} 1.0`);
  }
  for (let i = 1; i <= stations; i += 1) {
    const station = `U${i}`;
    // Backsight to A pairs with the foresight out of the same station.
    lines.push(
      `B ${station}-A ${dms(Math.atan2(-10 * i, -2 * i) + 2 * Math.PI)} 1.0`,
    );
  }
  return lines.join('\n');
};

const TSCORR_PARSE = {
  coordMode: '2D' as const,
  units: 'm' as const,
  tsCorrelationEnabled: true,
  tsCorrelationRho: 0.5,
  tsCorrelationScope: 'setup' as const,
};

describe('phase 16C structured-vs-dense statistics full parity', () => {
  it('solves identically on the admitted chain (m=200)', () => {
    resetStructuredWeightTelemetry();
    const { candidate, legacy } = solveBothStats(buildChainInput(80));
    const telemetry = snapshotStructuredWeightTelemetry();
    expect(candidate.converged).toBe(true);
    expect(candidate.iterations).toBe(legacy.iterations);
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
    expect(telemetry.statisticsStructuredAccesses).toBeGreaterThanOrEqual(1);
    expect(telemetry.statisticsDenseFallbacks).toBe(0);
  });

  it('solves identically on the admitted GPS network (m=168)', () => {
    resetStructuredWeightTelemetry();
    const { candidate, legacy } = solveBothStats(buildGpsInput());
    const telemetry = snapshotStructuredWeightTelemetry();
    expect(candidate.converged).toBe(true);
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
    expect(telemetry.statisticsStructuredAccesses).toBeGreaterThanOrEqual(1);
    expect(telemetry.statisticsDenseFallbacks).toBe(0);
  });

  it('solves identically on the admitted setup-scope TS network', () => {
    resetStructuredWeightTelemetry();
    const { candidate, legacy } = solveBothStats(buildSparseTsInput(), {
      input: buildSparseTsInput(),
      parseOptions: TSCORR_PARSE,
    });
    const telemetry = snapshotStructuredWeightTelemetry();
    expect(candidate.converged).toBe(true);
    expect(candidate.tsCorrelationDiagnostics).toBeDefined();
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
    expect(telemetry.statisticsStructuredAccesses).toBeGreaterThanOrEqual(1);
    expect(telemetry.statisticsDenseFallbacks).toBe(0);
  });

  it('solves identically on the dense TS-correlation fallback', () => {
    const input = readFileSync('tests/fixtures/direction_faceset.dat', 'utf-8');
    const { candidate, legacy } = solveBothStats(input, {
      input,
      parseOptions: {
        tsCorrelationEnabled: true,
        tsCorrelationRho: 0.5,
      },
    });
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
  });

  it('solves identically on the Huber fallback', () => {
    const input = buildChainInput(80);
    const { candidate, legacy } = solveBothStats(input, {
      input,
      parseOptions: { robustMode: 'huber' },
    });
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
  });

  it('solves identically on small fixtures', () => {
    for (const fixture of [
      'tests/fixtures/cli_smoke.dat',
      'tests/fixtures/traverse.dat',
      'tests/fixtures/gps_loop_phase3_pass.dat',
    ]) {
      const input = readFileSync(fixture, 'utf-8');
      const { candidate, legacy } = solveBothStats(input);
      expect(fingerprint(candidate)).toBe(fingerprint(legacy));
    }
  });

  it('matches through LOO primary and blunder-excluded alternate', () => {
    const primary = solveBothStats(buildChainInput(80));
    expect(fingerprint(primary.candidate)).toBe(fingerprint(primary.legacy));
    const ranked = [...primary.candidate.observations].sort(
      (a, b) =>
        Math.abs((b as { residual?: number }).residual ?? 0) -
        Math.abs((a as { residual?: number }).residual ?? 0),
    );
    const worst = ranked[0] as { id: number; type: string; residual?: number };
    expect(Math.abs(worst.residual ?? 0)).toBeGreaterThan(0);
    const excludeIds = new Set([worst.id]);
    const input = buildChainInput(80);
    const alternateCandidate = solveEngine({ input, maxIterations: 10, excludeIds, runtime: {} });
    const alternateLegacy = solveEngine({
      input,
      maxIterations: 10,
      excludeIds,
      runtime: { structuredStatisticsWeights: false },
    });
    expect(fingerprint(alternateCandidate)).toBe(fingerprint(alternateLegacy));
  });

  it('matches through auto-adjust cycles with a planted blunder', () => {
    const lines = ['.2D', 'C A 0 0 0 ! !'];
    for (let i = 1; i <= 70; i += 1) {
      lines.push(`C U${i} ${(10 * i + 0.3).toFixed(4)} ${(2 * i + 0.2).toFixed(4)} 0`);
    }
    for (let i = 1; i <= 70; i += 1) {
      const from = i === 1 ? 'A' : `U${i - 1}`;
      lines.push(`G S1 ${from} U${i} 10.0000 2.0000 0.0100 0.0100`);
    }
    for (let i = 5; i <= 70; i += 5) {
      const blunder = i === 40 ? 0.5 : 0;
      lines.push(`G S1 A U${i} ${(10 * i + blunder).toFixed(4)} ${(2 * i).toFixed(4)} 0.0100 0.0100`);
    }
    const gpsInput = lines.join('\n');
    const base = { input: gpsInput, parseOptions: { autoAdjustEnabled: true } };
    const { candidate, legacy } = solveBothStats(gpsInput, base);
    const diagnostics = candidate as {
      autoAdjustDiagnostics?: { removed: Array<{ obsId: number }> };
    };
    expect(diagnostics.autoAdjustDiagnostics?.removed.length).toBeGreaterThan(0);
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
  });
});

describe('phase 16C external reliability through structured weights', () => {
  it('matches the dense influence vector and moves when one off-diagonal is zeroed', () => {
    const { dense, sparse } = assembleBoth(buildGps2D('stats-ext', 4));
    const weights = sparse.structuredWeights!;
    expect(weights.offValues.length).toBeGreaterThan(0);
    const full = structuredWeightAccess(weights)!;
    expect(full).not.toBeNull();
    const zeroedValues = Float64Array.from(weights.offValues);
    zeroedValues[0] = 0;
    // A zeroed triplet is malformed structured input (zeros are omitted),
    // so drop the entry instead of storing a zero.
    const zeroed = structuredWeightAccess({
      size: weights.size,
      diagonal: weights.diagonal,
      offRows: weights.offRows.slice(1),
      offColumns: weights.offColumns.slice(1),
      offValues: zeroedValues.slice(1),
    })!;
    expect(zeroed).not.toBeNull();
    const droppedRow = weights.offRows[0] as number;
    const droppedColumn = weights.offColumns[0] as number;
    expect(full.weight(droppedRow, droppedColumn)).not.toBe(0);
    expect(zeroed.weight(droppedRow, droppedColumn)).toBe(0);

    const size = weights.size;
    const args = (weightAt: (_row: number, _column: number) => number) => ({
      is2D: true,
      B: Array.from({ length: size }, (_, row) =>
        Array.from({ length: 2 }, (_, column) => (row + 1) * (column + 1) * 0.01),
      ),
      weightAt,
      equationCount: size,
      paramColumns: [{ stationId: 'A', e: 0, n: 1 }],
      rows: Array.from({ length: size }, (_, row) => ({
        row,
        mdbNative: 0.01,
        mdbModel: 'legacy-3.29' as const,
        groupRows: [row, ...Array.from({ length: size }, (_, other) => other).filter(
          (other) => other !== row && full.weight(other, row) !== 0,
        )],
      })),
      freeNetwork: false,
      robustApproximate: false,
    });
    const fullResult = computeExternalInfluences(args((row, column) => full.weight(row, column)));
    const zeroedResult = computeExternalInfluences(
      args((row, column) => zeroed.weight(row, column)),
    );
    // Structured reads equal the dense-P baseline full vector.
    const denseResult = computeExternalInfluences({ ...args(() => 0), P: dense.P!, weightAt: undefined });
    expect(JSON.stringify(fullResult.get(droppedRow))).toBe(
      JSON.stringify(denseResult.get(droppedRow)),
    );
    // The missing off-diagonal must move the coupled influence vector.
    expect(
      JSON.stringify(fullResult.get(droppedRow)) !== JSON.stringify(zeroedResult.get(droppedRow)),
    ).toBe(true);
  });
});

describe('phase 16C statistics allocation gate', () => {
  it('allocates no statistics dense-P on the admitted chain and exactly one when forced', () => {
    const input = buildChainInput(80);
    resetStructuredWeightTelemetry();
    const candidate = new LSAEngine({ input }).solve();
    const candidateTelemetry = snapshotStructuredWeightTelemetry();
    resetStructuredWeightTelemetry();
    const legacy = new LSAEngine({ input, structuredStatisticsWeights: false }).solve();
    const legacyTelemetry = snapshotStructuredWeightTelemetry();
    expect(candidate.converged).toBe(true);
    expect(fingerprint(candidate)).toBe(fingerprint(legacy));
    expect(candidateTelemetry.statisticsDensePAllocations).toBe(0);
    expect(candidateTelemetry.statisticsStructuredAccesses).toBeGreaterThanOrEqual(1);
    expect(candidateTelemetry.statisticsDenseFallbacks).toBe(0);
    expect(candidateTelemetry.weightAtCalls).toBeGreaterThan(0);
    expect(candidateTelemetry.coupledIterationCalls).toBeGreaterThan(0);
    expect(candidateTelemetry.coupledEntriesVisited).toBeGreaterThan(0);
    expect(legacyTelemetry.statisticsDensePAllocations).toBeGreaterThanOrEqual(1);
    expect(legacyTelemetry.statisticsStructuredAccesses).toBe(0);
    // The solve route is identical in both modes, so the only dense-P
    // allocation difference is the statistics stage (was 1, now 0).
    expect(
      legacyTelemetry.densePAllocations - candidateTelemetry.densePAllocations,
    ).toBe(1);
  });
});
