/**
 * Phase 16B Level-2 gates A/B/C + floating order + packing cost (evidence tier).
 *
 * Gate A (§10): structured N+rhs accumulation at m≈2000 — construction,
 * accumulation, totals, allocations vs dense. Pass bar: >=20%
 * assembly-stage improvement OR compelling memory/scalability gain with no
 * meaningful timing regression.
 * Gate B (§11): per-family structured N+rhs vs dense production — one
 * verdict per family, no inference across families.
 * Gate C (§12): GPS 2x2/3x3 and TS set/setup blocks stay A_G' P_G A_G
 * (plus a diagonal-only negative control proving the off-diagonals matter).
 * Floating order (§13): maxAbs/maxRel/ULP for the non-bitwise vTPv case
 * against the existing 16A tolerances (1e-9 N/rhs, 1e-12 vTPv/SEUW).
 * Packing cost (§24) and builder-finalize cost (§25) are recorded, not
 * redesigned. Dense extreme (§27): ts-setup shapes must route dense.
 */
import { describe, expect, it } from 'vitest';

import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import type { AdjustmentEquationAssemblyOptions } from '../../src/engine/adjustmentEquationAssemblyTypes';
import type { AdjustmentEquationAssemblyDependencies } from '../../src/engine/adjustmentEquationAssemblyTypes';
import { accumulateNormalEquationsFromSparseRows } from '../../src/engine/matrix';
import {
  accumulateNormalFromStructuredWeights,
  estimateStructuredWeightDensityUB,
  shouldAssembleStructuredWeights,
  structuredWeightDensity,
} from '../../src/engine/structuredWeightOracle';
import {
  resetStructuredWeightTelemetry,
  snapshotStructuredWeightTelemetry,
} from '../../src/engine/structuredWeightTelemetry';
import { SymmetricWeightBuilder } from '../../src/engine/sparseWeightRepresentation';
import { structuredWeightsToPackedUpper } from '../../src/engine/sparseWeightRepresentation';
import { packUpperTriangleWeights } from '../../src/engine/sparseEquationPacking';
import { structuredQuadraticForm } from '../../src/engine/sparseWeightRepresentation';
import { symmetricQuadraticForm } from '../../src/engine/matrixSparse';
import type { Observation, StationId, StationMap } from '../../src/types';
import {
  assembleBoth,
  buildChain2D,
  buildCorrelatedControls,
  buildGnssBaseline,
  buildGps2D,
  buildGps3D,
  buildMixedOverdetermined,
  buildTsAnglesBearings,
  buildTsDirections,
  buildTsSetupScope,
  buildWeightedControls,
  heapDeltaMb,
  makeDeps,
  maxDiff,
  medianWallMs,
  round4,
  type BuiltNetwork,
} from './phase16aWeightEvidenceShared';

const RUNS = 7;
const DENSE_OPTIONS: AdjustmentEquationAssemblyOptions | undefined = undefined;
const STRUCTURED_OPTIONS: AdjustmentEquationAssemblyOptions = {
  weightRepresentation: 'sparse',
  omitDenseP: true,
};

const assembleTimed = (
  network: BuiltNetwork,
  options: AdjustmentEquationAssemblyOptions | undefined,
  runs: number,
): { ms: number; denseAllocs: number; denseBytes: number; structuredBuilds: number } => {
  resetStructuredWeightTelemetry();
  const ms = medianWallMs(runs, () => {
    assembleAdjustmentEquations(
      network.deps,
      network.observations,
      network.constraints,
      network.numObsEquations,
      network.numParams,
      undefined,
      options,
    );
  });
  const telemetry = snapshotStructuredWeightTelemetry();
  return {
    ms,
    denseAllocs: telemetry.densePAllocations,
    denseBytes: telemetry.densePBytesAllocated,
    structuredBuilds: telemetry.structuredWeightBuilds,
  };
};

/** Exact ULP distance between two finite doubles via ordered bit mapping. */
const ulpDistance = (a: number, b: number): number => {
  if (a === b) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const buffer = new ArrayBuffer(8);
  const floats = new Float64Array(buffer);
  const bits = new BigUint64Array(buffer);
  const ordered = (x: number): bigint => {
    floats[0] = x;
    const raw = bits[0] as bigint;
    return raw >> 63n ? ~raw : raw ^ (1n << 63n);
  };
  const oa = ordered(a);
  const ob = ordered(b);
  const distance = oa > ob ? oa - ob : ob - oa;
  return distance <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(distance) : Number.POSITIVE_INFINITY;
};

/** Level-flight leveling loop: C0-U1-...-Un, one lev row per leg. */
const buildLev = (id: string, legs: number): BuiltNetwork => {
  const stations: StationMap = {
    C0: { x: 0, y: 0, h: 10, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  };
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  let p = 0;
  for (let i = 1; i <= legs; i += 1) {
    stations[`U${i}`] = {
      x: 50 * i, y: 0, h: 10 + 0.05 * i,
      fixed: false, fixedX: true, fixedY: true, fixedH: false,
    };
    paramIndex[`U${i}` as StationId] = { h: p };
    p += 1;
  }
  const observations: Observation[] = [];
  for (let i = 1; i <= legs; i += 1) {
    const from = i === 1 ? 'C0' : `U${i - 1}`;
    observations.push({
      id: 5000 + i, type: 'lev', from, to: `U${i}`, obs: 0.05, instCode: 'DNA', stdDev: 0.002,
    } as Observation);
  }
  const depsStations: StationMap = { ...stations };
  return {
    id, kind: 'leveling/scalar', deps: makeDeps({
      paramIndex, dirParamMap: {}, stations: depsStations, is2D: false,
      sigma: 0.002, tsRho: 0, gpsCorrelated: false,
    }),
    observations, constraints: [], numObsEquations: observations.length, numParams: p,
    expectedTsGroups: 0, orientationParams: 0, tsScope: 'set',
  };
};

/** Zenith-only star: C0 to free 3D targets, one zenith row each. */
const buildZenith = (id: string, targets: number): BuiltNetwork => {
  const stations: StationMap = {
    C0: { x: 0, y: 0, h: 10, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  };
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  let p = 0;
  for (let i = 1; i <= targets; i += 1) {
    stations[`Z${i}`] = {
      x: 60 * i, y: 8 * i, h: 10 + i,
      fixed: false, fixedX: false, fixedY: false, fixedH: false,
    };
    paramIndex[`Z${i}` as StationId] = { x: p, y: p + 1, h: p + 2 };
    p += 3;
  }
  const observations: Observation[] = [];
  for (let i = 1; i <= targets; i += 1) {
    observations.push({
      id: 6000 + i, type: 'zenith', from: 'C0', to: `Z${i}`,
      obs: 1.45, instCode: 'S9', stdDev: 0.0008,
    } as Observation);
  }
  return {
    id, kind: 'zenith/scalar', deps: makeDeps({
      paramIndex, dirParamMap: {}, stations: { ...stations }, is2D: false,
      sigma: 0.0008, tsRho: 0, gpsCorrelated: false,
    }),
    observations, constraints: [], numObsEquations: observations.length, numParams: p,
    expectedTsGroups: 0, orientationParams: 0, tsScope: 'set',
  };
};

/** Azimuth (dir-type) star: single azimuths, no orientation unknowns. */
const buildDirAzimuth = (id: string, targets: number): BuiltNetwork => {
  const stations: StationMap = {
    C0: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  };
  const paramIndex: AdjustmentEquationAssemblyDependencies['paramIndex'] = {};
  let p = 0;
  for (let i = 1; i <= targets; i += 1) {
    stations[`D${i}`] = {
      x: 40 * i, y: 6 * i, h: 0,
      fixed: false, fixedX: false, fixedY: false, fixedH: true,
    };
    paramIndex[`D${i}` as StationId] = { x: p, y: p + 1 };
    p += 2;
  }
  const observations: Observation[] = [];
  for (let i = 1; i <= targets; i += 1) {
    observations.push({
      id: 7000 + i, type: 'dir', from: 'C0', to: `D${i}`,
      obs: 0.4 + 0.01 * i, instCode: 'S9', stdDev: 0.001,
    } as Observation);
  }
  return {
    id, kind: 'dir-azimuth/scalar', deps: makeDeps({
      paramIndex, dirParamMap: {}, stations: { ...stations }, is2D: true,
      sigma: 0.001, tsRho: 0, gpsCorrelated: false,
    }),
    observations, constraints: [], numObsEquations: observations.length, numParams: p,
    expectedTsGroups: 0, orientationParams: 0, tsScope: 'set',
  };
};

const gateBfamilies = (): BuiltNetwork[] => [
  buildChain2D('gateb-dist-bearing', 8),
  buildTsDirections('gateb-direction', 2, 4),
  buildTsAnglesBearings('gateb-angle'),
  buildDirAzimuth('gateb-dir-azimuth', 6),
  buildZenith('gateb-zenith', 5),
  buildLev('gateb-level', 8),
  buildGps2D('gateb-gps', 4),
  buildGps3D('gateb-gps3', 4),
  buildGnssBaseline('gateb-gnss', 3),
  buildWeightedControls('gateb-weighted-control', 8),
  buildCorrelatedControls('gateb-correlated-control', 8),
];

describe('phase 16B gate A: m~=2000 structured accumulation', () => {
  it.each([
    { id: 'chain-1000', network: () => buildChain2D('gatea-chain', 1000) },
    { id: 'ts-250x8', network: () => buildTsDirections('gatea-ts', 250, 8) },
  ])('beats dense assembly-stage by >=20% on $id with zero solve-time dense P', ({ network }) => {
    const built = network();
    expect(built.numObsEquations).toBe(2000);
    const dense = assembleTimed(built, DENSE_OPTIONS, RUNS);
    const structured = assembleTimed(built, STRUCTURED_OPTIONS, RUNS);
    expect(structured.denseAllocs).toBe(0);
    expect(structured.structuredBuilds).toBe(RUNS + 1);
    expect(dense.denseAllocs).toBe(RUNS + 1);
    expect(dense.denseBytes).toBe((RUNS + 1) * 2000 * 2000 * 8);

    const denseAsm = assembleAdjustmentEquations(
      built.deps, built.observations, built.constraints,
      built.numObsEquations, built.numParams, undefined, DENSE_OPTIONS,
    );
    const structuredAsm = assembleAdjustmentEquations(
      built.deps, built.observations, built.constraints,
      built.numObsEquations, built.numParams, undefined, STRUCTURED_OPTIONS,
    );
    const denseAccMs = medianWallMs(RUNS, () => {
      accumulateNormalEquationsFromSparseRows(
        denseAsm.sparseRows, denseAsm.L, denseAsm.P!, built.numParams,
      );
    });
    const structuredAccMs = medianWallMs(RUNS, () => {
      accumulateNormalFromStructuredWeights(
        structuredAsm.sparseRows, structuredAsm.L, structuredAsm.structuredWeights!, built.numParams,
      );
    });
    // Bitwise N+rhs at scale (same guarantee as the small oracle tests).
    const expected = accumulateNormalEquationsFromSparseRows(
      denseAsm.sparseRows, denseAsm.L, denseAsm.P!, built.numParams,
    );
    const actual = accumulateNormalFromStructuredWeights(
      structuredAsm.sparseRows, structuredAsm.L, structuredAsm.structuredWeights!, built.numParams,
    );
    expect(maxDiff(actual.normal, expected.normal).maxAbs).toBe(0);
    expect(maxDiff(actual.rhs, expected.rhs).maxAbs).toBe(0);

    const denseTotal = dense.ms + denseAccMs;
    const structuredTotal = structured.ms + structuredAccMs;
    console.log(
      `\n16B gate A ${built.id}: asm dense=${round4(dense.ms)} structured=${round4(structured.ms)} ` +
        `acc dense=${round4(denseAccMs)} structured=${round4(structuredAccMs)} ` +
        `total speedup=${round4(denseTotal / Math.max(structuredTotal, 1e-9))}x ` +
        `dense-P bytes eliminated=${dense.denseBytes}`,
    );
    expect(structuredTotal).toBeLessThanOrEqual(denseTotal * 0.8);
  });
});

describe('phase 16B gate B: per-family N+rhs coverage', () => {
  for (const network of gateBfamilies()) {
    it(`accumulates bit-identical N+rhs for ${network.id} (${network.kind})`, () => {
      const { dense, sparse } = assembleBoth(network);
      const expected = accumulateNormalEquationsFromSparseRows(
        sparse.sparseRows,
        sparse.L,
        dense.P!,
        network.numParams,
      );
      const actual = accumulateNormalFromStructuredWeights(
        sparse.sparseRows,
        sparse.L,
        sparse.structuredWeights!,
        network.numParams,
      );
      // Existing 16A tolerance for N/rhs is 1e-9 rel; the production
      // oracle path is statement-for-statement identical, so assert exact
      // with the tolerance as the documented ceiling.
      const normalDiff = maxDiff(actual.normal, expected.normal);
      const rhsDiff = maxDiff(actual.rhs, expected.rhs);
      expect(normalDiff.maxAbs).toBe(0);
      expect(rhsDiff.maxAbs).toBe(0);
      expect(normalDiff.maxRel).toBeLessThan(1e-9);
      expect(rhsDiff.maxRel).toBeLessThan(1e-9);
    });
  }
});

describe('phase 16B gate C: correlated blocks stay coupled', () => {
  it.each([
    {
      id: 'gps-2d',
      network: () => buildGps2D('gatec-gps2', 6),
      expectedOff: 6,
      block: '2x2',
    },
    {
      id: 'gps-3d',
      network: () => buildGps3D('gatec-gps3', 6),
      expectedOff: 18,
      block: '3x3',
    },
    {
      id: 'ts-set',
      network: () => buildTsDirections('gatec-ts-set', 3, 5),
      expectedOff: 3 * 10,
      block: '5x5 set groups',
    },
    {
      id: 'ts-setup',
      network: () => buildTsSetupScope('gatec-ts-setup', 3, 5),
      expectedOff: 105,
      block: '15x15 setup group',
    },
  ])('preserves $block coupling for $id (N exact, off-diagonals present)', ({ network, expectedOff }) => {
    const built = network();
    const { dense, sparse } = assembleBoth(built);
    const weights = sparse.structuredWeights!;
    expect(weights.offValues.length).toBe(expectedOff);
    for (const value of weights.offValues) expect(value).not.toBe(0);
    const expected = accumulateNormalEquationsFromSparseRows(
      sparse.sparseRows, sparse.L, dense.P!, built.numParams,
    );
    const actual = accumulateNormalFromStructuredWeights(
      sparse.sparseRows, sparse.L, weights, built.numParams,
    );
    expect(maxDiff(actual.normal, expected.normal).maxAbs).toBe(0);
    expect(maxDiff(actual.rhs, expected.rhs).maxAbs).toBe(0);
    // Negative control: a diagonalized P gives a DIFFERENT N, so the exact
    // match above genuinely proves the blocks stayed coupled.
    const diagonalOnly = {
      size: weights.size,
      diagonal: weights.diagonal,
      offRows: new Int32Array(0),
      offColumns: new Int32Array(0),
      offValues: new Float64Array(0),
    };
    const diagonalized = accumulateNormalFromStructuredWeights(
      sparse.sparseRows, sparse.L, diagonalOnly, built.numParams,
    );
    expect(maxDiff(diagonalized.normal, expected.normal).maxAbs).toBeGreaterThan(0);
  });
});

describe('phase 16B floating order and packing costs', () => {
  it('reports vTPv maxAbs/maxRel/ULP within the existing 1e-12 ceiling', () => {
    const networks = [
      buildTsSetupScope('float-ts-setup', 4, 8),
      buildMixedOverdetermined('float-mixed'),
    ];
    for (const network of networks) {
      const { dense, sparse } = assembleBoth(network);
      const v = sparse.L.map((row) => [row[0] * 0.37 + 1e-6]);
      const expected = symmetricQuadraticForm(dense.P!, v);
      const actual = structuredQuadraticForm(sparse.structuredWeights!, v);
      const abs = Math.abs(actual - expected);
      const rel = abs / Math.max(Math.abs(expected), 1e-300);
      const ulps = ulpDistance(actual, expected);
      console.log(
        `\n16B vTPv ${network.id}: dense=${expected} structured=${actual} ` +
          `maxAbs=${abs} maxRel=${rel} ulps=${ulps}`,
      );
      expect(rel).toBeLessThan(1e-12);
    }
  });

  it('records structured creation + packing costs without shifting them', () => {
    const networks = [
      buildChain2D('pack-chain-128', 64),
      buildGps2D('pack-gps-128', 64),
      buildTsDirections('pack-ts-set', 16, 8),
      buildChain2D('pack-chain-1000', 1000),
    ];
    for (const network of networks) {
      const created = assembleAdjustmentEquations(
        network.deps, network.observations, network.constraints,
        network.numObsEquations, network.numParams, undefined, STRUCTURED_OPTIONS,
      );
      const denseCreated = assembleAdjustmentEquations(
        network.deps, network.observations, network.constraints,
        network.numObsEquations, network.numParams, undefined, DENSE_OPTIONS,
      );
      const structuredPackMs = medianWallMs(RUNS, () => {
        structuredWeightsToPackedUpper(created.structuredWeights!);
      });
      const densePackMs = medianWallMs(RUNS, () => {
        packUpperTriangleWeights(denseCreated.P!, network.numObsEquations);
      });
      const structuredPacked = structuredWeightsToPackedUpper(created.structuredWeights!);
      const densePacked = packUpperTriangleWeights(denseCreated.P!, network.numObsEquations);
      expect(structuredPacked.values.length).toBe(densePacked.values.length);
      console.log(
        `\n16B packing ${network.id} m=${network.numObsEquations}: ` +
          `structured-pack=${round4(structuredPackMs)} dense-pack=${round4(densePackMs)} ` +
          `entries=${structuredPacked.values.length}`,
      );
      // Packing is O(nnz); it must never dominate the assembly that built it.
      const assemblyMs = medianWallMs(RUNS, () => {
        assembleAdjustmentEquations(
          network.deps, network.observations, network.constraints,
          network.numObsEquations, network.numParams, undefined, STRUCTURED_OPTIONS,
        );
      });
      expect(structuredPackMs).toBeLessThanOrEqual(assemblyMs + 0.5);
    }
  });

  it('records the builder-finalize string-sort cost (§25, no redesign)', () => {
    // Isolated finalize cost for the setup-128 shape (8128 pairs) and the
    // ts-250x8 shape (7000 pairs): Map insertion + string-key sort.
    for (const pairs of [8128, 7000]) {
      const builder = new SymmetricWeightBuilder(2000);
      for (let k = 0; k < pairs; k += 1) {
        const row = Math.floor((Math.sqrt(8 * k + 1) - 1) / 2) % 2000;
        const column = Math.min(1999, row + 1 + (k % 7));
        if (column !== row) builder.setOffDiagonal(Math.min(row, column), Math.max(row, column), 0.5);
      }
      const finalizeMs = medianWallMs(RUNS, () => {
        builder.finalize();
      });
      const heapMb = heapDeltaMb(() => {
        builder.finalize();
      });
      console.log(
        `\n16B finalize pairs=${pairs}: ${round4(finalizeMs)} ms, heap delta=${round4(heapMb)} MB`,
      );
      expect(Number.isFinite(finalizeMs)).toBe(true);
    }
  });
});

describe('phase 16B dense extreme and hybrid routing at scale', () => {
  it('routes ts-setup shapes dense at m=32 and m=128 (§27)', () => {
    for (const network of [
      buildTsSetupScope('ext-setup-32', 4, 8),
      buildTsSetupScope('ext-setup-128', 16, 8),
    ]) {
      const { sparse } = assembleBoth(network);
      const density = structuredWeightDensity(sparse.structuredWeights!);
      expect(density).toBeGreaterThan(0.5);
      const ub = estimateStructuredWeightDensityUB({
        equationCount: network.numObsEquations,
        observations: network.observations,
        tsCorrelationEnabled: true,
        tsCorrelationRho: 0.5,
        tsCorrelationScope: network.tsScope,
        is2D: network.deps.is2D,
        constraintCount: network.constraints.length,
      });
      expect(ub).toBe(density);
      expect(
        shouldAssembleStructuredWeights({
          equationCount: network.numObsEquations,
          densityUB: ub,
          robustMode: 'none',
        }),
      ).toBe(false);
      const dense = assembleTimed(network, DENSE_OPTIONS, RUNS);
      const structured = assembleTimed(network, STRUCTURED_OPTIONS, RUNS);
      console.log(
        `\n16B dense-extreme ${network.id} m=${network.numObsEquations}: ` +
          `dense=${round4(dense.ms)} structured=${round4(structured.ms)} routed=dense`,
      );
      expect(structured.ms).toBeGreaterThan(dense.ms);
    }
  });
});
