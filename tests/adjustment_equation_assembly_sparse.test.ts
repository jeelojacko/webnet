import { describe, expect, it } from 'vitest';

import { assembleAdjustmentEquations } from '../src/engine/adjustmentEquationAssembly';
import type {
  AdjustmentEquationAssemblyDependencies,
} from '../src/engine/adjustmentEquationAssemblyTypes';
import type { CoordinateConstraintEquation } from '../src/engine/adjustmentSolveTypes';
import {
  applyTsCorrelationToWeightMatrix as applyTsMatrix,
  applyTsCorrelationToWeightWriter as applyTsWriter,
  tsCorrelationGroup,
} from '../src/engine/adjustTsCorrelationWeights';
import {
  applyRobustWeightFactors,
  captureRobustWeightBase,
} from '../src/engine/adjustRobustWeights';
import { buildCoordinateConstraints } from '../src/engine/adjustmentConstraints';
import { structuredWeightsToDense } from '../src/engine/sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from '../src/engine/sparseWeightRepresentation';
import type {
  DirectionObservation,
  DistanceObservation,
  GpsObservation,
  Observation,
  StationMap,
} from '../src/types';

const stations: StationMap = {
  A: { x: 0, y: 0, h: 0, fixed: true, fixedX: true, fixedY: true, fixedH: true },
  B: { x: 10, y: 0, h: 5, fixed: false, fixedX: false, fixedY: false, fixedH: false },
};

const baseDeps = ({
  is2D = false,
  paramIndex = { B: { x: 0, y: 1 } },
  dirParamMap = {},
  sigma = 0.5,
  tsRho = 0,
  gpsWeight = {},
}: {
  is2D?: boolean;
  paramIndex?: AdjustmentEquationAssemblyDependencies['paramIndex'];
  dirParamMap?: Record<string, number>;
  sigma?: number;
  tsRho?: number;
  gpsWeight?: {
    wEE?: number;
    wNN?: number;
    wEN?: number;
    wUU?: number;
    wEU?: number;
    wNU?: number;
  };
} = {}): AdjustmentEquationAssemblyDependencies => {
  const effectiveStdDev = () => sigma;
  const groupFor = (obs: Observation) =>
    tsCorrelationGroup({ enabled: tsRho > 0, obs, scope: 'set' });
  return {
    stations,
    paramIndex,
    is2D,
    debug: false,
    directionOrientations: {},
    dirParamMap,
    effectiveStdDev,
    correctedDistanceModel: (_obs, calcDistRaw) => ({
      calcDistance: calcDistRaw,
      mapScale: 1,
      prismCorrection: 0,
    }),
    getObservedHorizontalDistanceIn2D: () => ({
      observedDistance: 12,
      sigmaDistance: sigma,
      usedZenith: false,
    }),
    getAzimuth: () => ({ az: 0, dist: 10 }),
    measuredAngleCorrection: () => 0,
    modeledAzimuth: (rawAz) => rawAz,
    wrapToPi: (value) => value,
    gpsObservedVector: () => ({ dE: 1, dN: 2, dU: 3, scale: 1 }),
    gpsModeledVector: () => ({ dE: 0.9, dN: 1.9, dU: 2.9, scale: 1 }),
    gpsModeledVectorDerivatives: () => ({ from: {}, to: {} }),
    gpsWeight: () => ({
      wEE: 4,
      wNN: 9,
      wEN: 1.5,
      wUU: 16,
      wEU: 0.75,
      wNU: -0.5,
      ...gpsWeight,
    }),
    getModeledZenith: () => ({ z: 0, dist: 1, horiz: 1, dh: 0, crCorr: 0, horizontalScale: 1 }),
    curvatureRefractionAngle: () => 0,
    applyTsCorrelationToWeightMatrix: (matrix, rowInfo) => {
      applyTsMatrix({
        captureDiagnostics: false,
        effectiveStdDev,
        enabled: tsRho > 0,
        matrix,
        rho: tsRho,
        rowInfo,
        scope: 'set',
        tsCorrelationGroup: groupFor,
      });
    },
    applyTsCorrelationToWeightWriter: (weights, rowInfo) => {
      applyTsWriter({
        captureDiagnostics: false,
        effectiveStdDev,
        enabled: tsRho > 0,
        weights,
        rho: tsRho,
        rowInfo,
        scope: 'set',
        tsCorrelationGroup: groupFor,
      });
    },
  };
};

const runBoth = (
  deps: AdjustmentEquationAssemblyDependencies,
  observations: Observation[],
  constraints: CoordinateConstraintEquation[],
  numObsEquations: number,
  numParams: number,
) => {
  const dense = assembleAdjustmentEquations(
    deps,
    observations,
    constraints,
    numObsEquations,
    numParams,
  );
  const sparse = assembleAdjustmentEquations(
    deps,
    observations,
    constraints,
    numObsEquations,
    numParams,
    undefined,
    { weightRepresentation: 'sparse' },
  );
  return { dense, sparse };
};

const requireP = (result: { P?: number[][] }): number[][] => {
  if (!result.P) throw new Error('Expected a dense weight matrix in the test result.');
  return result.P;
};

const requireStructured = (result: { structuredWeights?: StructuredSymmetricWeights }): StructuredSymmetricWeights => {
  if (!result.structuredWeights) throw new Error('Expected structured weights in the test result.');
  return result.structuredWeights;
};

const expectMatricesClose = (actual: number[][], expected: number[][], precision = 10) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((row, i) => {
    expect(row.length).toBe(expected[i]?.length);
    row.forEach((value, j) => {
      expect(value).toBeCloseTo(expected[i]?.[j] ?? 0, precision);
    });
  });
};

const distObs: DistanceObservation = {
  id: 1,
  type: 'dist',
  subtype: 'ts',
  from: 'A',
  to: 'B',
  obs: 12,
  mode: 'horiz',
  instCode: 'S9',
  stdDev: 0.5,
};

describe('adjustmentEquationAssembly sparse weight parity', () => {
  it('matches dense P for scalar distance and control rows', () => {
    const { dense, sparse } = runBoth(baseDeps(), [distObs], [
      { stationId: 'B', component: 'x', index: 0, target: 11, sigma: 0.25 },
    ], 2, 2);

    expectMatricesClose(requireP(sparse), requireP(dense));
    expectMatricesClose(sparse.L, dense.L);
    expect(sparse.rowInfo).toEqual(dense.rowInfo);
    expectMatricesClose(structuredWeightsToDense(requireStructured(sparse)), requireP(dense));
    expect(requireStructured(sparse).size).toBe(2);
    expect(requireStructured(sparse).offRows.length).toBe(0);
  });

  it('matches dense P for 2D GPS rows with EN correlation', () => {
    const gps: GpsObservation = {
      id: 2,
      type: 'gps',
      from: 'A',
      to: 'B',
      obs: { dE: 10, dN: 0 },
      instCode: 'GPS',
      stdDev: 0.01,
    };
    const deps = baseDeps({ is2D: true, paramIndex: { B: { x: 0, y: 1 } } });
    const { dense, sparse } = runBoth(deps, [gps], [], 2, 2);

    expectMatricesClose(requireP(sparse), requireP(dense));
    expect(requireP(sparse)[0][1]).toBeCloseTo(1.5, 12);
    expect(requireP(sparse)[1][0]).toBeCloseTo(1.5, 12);
    expectMatricesClose(structuredWeightsToDense(requireStructured(sparse)), requireP(dense));
    expect([...requireStructured(sparse).offRows]).toEqual([0]);
    expect([...requireStructured(sparse).offColumns]).toEqual([1]);
  });

  it('matches dense P for 3D GPS rows and omits zero correlations', () => {
    const gps: GpsObservation = {
      id: 3,
      type: 'gps',
      from: 'A',
      to: 'B',
      obs: { dE: 10, dN: 0, dU: 5 },
      instCode: 'GPS',
      stdDev: 0.01,
    };
    const deps = baseDeps({ paramIndex: { B: { x: 0, y: 1, h: 2 } } });
    const { dense, sparse } = runBoth(deps, [gps], [], 3, 3);

    expectMatricesClose(requireP(sparse), requireP(dense));
    expectMatricesClose(structuredWeightsToDense(requireStructured(sparse)), requireP(dense));
    expect(requireStructured(sparse).offRows.length).toBe(3);

    const zeroCorrDeps = baseDeps({
      paramIndex: { B: { x: 0, y: 1, h: 2 } },
      gpsWeight: { wEN: 0, wEU: 0, wNU: 0 },
    });
    const zeroed = assembleAdjustmentEquations(zeroCorrDeps, [gps], [], 3, 3, undefined, {
      weightRepresentation: 'sparse',
    });
    expect(requireStructured(zeroed).offRows.length).toBe(0);
    expectMatricesClose(requireP(zeroed), structuredWeightsToDense(requireStructured(zeroed)));
  });

  it('matches dense P for correlated XY constraints', () => {
    const correlated: StationMap = {
      ...stations,
      B: {
        x: 10,
        y: 0,
        h: 5,
        fixed: false,
        fixedX: false,
        fixedY: false,
        fixedH: true,
        sx: 0.1,
        sy: 0.2,
        constraintX: 10.2,
        constraintY: -0.1,
        constraintCorrXY: 0.5,
      },
    };
    const deps = baseDeps();
    const depsWithStations = { ...deps, stations: correlated };
    const constraints = buildCoordinateConstraints(correlated, { B: { x: 0, y: 1 } }, false);
    expect(constraints).toHaveLength(2);

    const { dense, sparse } = runBoth(depsWithStations, [distObs], constraints, 3, 2);

    expectMatricesClose(requireP(sparse), requireP(dense));
    expect(requireP(sparse)[1][2]).toBeCloseTo(requireP(dense)[1][2], 12);
    expect(requireP(sparse)[1][2]).not.toBe(0);
    expectMatricesClose(structuredWeightsToDense(requireStructured(sparse)), requireP(dense));
  });

  it('matches dense P for TS-correlated direction sets', () => {
    const mkDir = (id: number): DirectionObservation => ({
      id,
      type: 'direction',
      setId: 'S1',
      at: 'A',
      to: 'B',
      obs: 0.1 * id,
      instCode: 'S9',
      stdDev: 0.001,
    });
    const deps = baseDeps({
      paramIndex: { B: { x: 0, y: 1 } },
      dirParamMap: { S1: 2 },
      sigma: 0.001,
      tsRho: 0.3,
    });
    const { dense, sparse } = runBoth(deps, [mkDir(11), mkDir(12)], [], 2, 3);

    expect(requireP(dense)[0][1]).not.toBe(0);
    expectMatricesClose(requireP(sparse), requireP(dense));
    expectMatricesClose(structuredWeightsToDense(requireStructured(sparse)), requireP(dense));
    expect(requireStructured(sparse).offRows.length).toBe(1);
  });

  it('supports robust base capture and factor writes from reconstructed P', () => {
    const mkDir = (id: number): DirectionObservation => ({
      id,
      type: 'direction',
      setId: 'S1',
      at: 'A',
      to: 'B',
      obs: 0.1 * id,
      instCode: 'S9',
      stdDev: 0.001,
    });
    const deps = baseDeps({
      paramIndex: { B: { x: 0, y: 1 } },
      dirParamMap: { S1: 2 },
      sigma: 0.001,
      tsRho: 0.3,
    });
    const observations: Observation[] = [distObs, mkDir(11), mkDir(12)];
    const { dense, sparse } = runBoth(deps, observations, [], 3, 3);

    const groupOf = (rowInfo: typeof dense.rowInfo) =>
      rowInfo.map((_, index) => index).filter((_, index) => index > 0);
    const denseBase = captureRobustWeightBase(requireP(dense), dense.rowInfo, {
      robustCorrelationRowGroups: () => [groupOf(dense.rowInfo)],
    });
    const sparseBase = captureRobustWeightBase(requireP(sparse), sparse.rowInfo, {
      robustCorrelationRowGroups: () => [groupOf(sparse.rowInfo)],
    });
    expect(sparseBase).toEqual(denseBase);

    const factors = [0.5, 0.8, 0.9];
    const denseScaled = requireP(dense).map((row) => [...row]);
    const sparseScaled = requireP(sparse).map((row) => [...row]);
    applyRobustWeightFactors(denseScaled, denseBase, factors);
    applyRobustWeightFactors(sparseScaled, sparseBase, factors);
    expectMatricesClose(sparseScaled, denseScaled);
  });

  it('avoids the dense P allocation with omitDenseP while preserving structured weights', () => {
    const deps = baseDeps({ paramIndex: { B: { x: 0, y: 1, h: 2 } } });
    const gps: GpsObservation = {
      id: 4,
      type: 'gps',
      from: 'A',
      to: 'B',
      obs: { dE: 10, dN: 0, dU: 5 },
      instCode: 'GPS',
      stdDev: 0.01,
    };
    const reference = assembleAdjustmentEquations(deps, [gps], [], 3, 3);
    const sparse = assembleAdjustmentEquations(deps, [gps], [], 3, 3, undefined, {
      weightRepresentation: 'sparse',
      omitDenseP: true,
    });

    expect(sparse.P).toBeUndefined();
    expectMatricesClose(structuredWeightsToDense(requireStructured(sparse)), requireP(reference));
    expectMatricesClose(sparse.L, reference.L);
  });

  it('omits structuredWeights on the dense path and populates them for sparse assembly', () => {
    const deps = baseDeps();
    const dense = assembleAdjustmentEquations(deps, [distObs], [], 1, 2);
    expect(dense.structuredWeights).toBeUndefined();
    const sparse = assembleAdjustmentEquations(deps, [distObs], [], 1, 2, undefined, {
      weightRepresentation: 'sparse',
    });
    expect(sparse.structuredWeights).not.toBeUndefined();
  });
});
