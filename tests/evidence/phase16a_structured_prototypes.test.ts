/**
 * Phase 16A evidence (part 2): structured-weight accumulation prototypes.
 *
 * EVIDENCE ONLY — no production behavior changes. The shared in-test prototype
 * (scalar N += w_i a_i'a_i, block N += w_ij (a_i'a_j + a_j'a_i) per canonical
 * triplet) runs on the same sparse design rows as the dense baseline
 * (accumulateNormalEquationsFromSparseRows over dense P). Every N entry, rhs
 * entry, v'Pv, SEUW, and chi-square value is compared against the dense
 * baseline; max abs/rel differences are recorded. iterateNonzeroColumn is
 * verified against dense P columns. The production structured robust path
 * (captureRobustWeightBaseFromStructured + applyRobustWeightFactorsToStructured
 * with the production robustCorrelationRowGroups keys) is cross-checked
 * against the dense robust path.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { assembleAdjustmentEquations } from '../../src/engine/adjustmentEquationAssembly';
import { solveNormalEquations } from '../../src/engine/adjustNormalEquationHelpers';
import { accumulateNormalEquationsFromSparseRows, symmetricQuadraticForm } from '../../src/engine/matrixSparse';
import {
  structuredQuadraticForm,
  structuredWeightsToDense,
} from '../../src/engine/sparseWeightRepresentation';
import type { StructuredSymmetricWeights } from '../../src/engine/sparseWeightRepresentation';
import {
  applyRobustWeightFactors,
  applyRobustWeightFactorsToStructured,
  captureRobustWeightBase,
  captureRobustWeightBaseFromStructured,
  computeRobustWeightSummary,
  robustCorrelationRowGroups,
} from '../../src/engine/adjustRobustWeights';
import {
  isTsCorrelationObservation,
  tsCorrelationGroup,
} from '../../src/engine/adjustTsCorrelationWeights';
import type { EquationRowInfo } from '../../src/engine/adjustmentSolveTypes';
import {
  assembleBoth,
  buildChain2D,
  buildCorrelatedControls,
  buildGnssBaseline,
  buildGps2D,
  buildGps3D,
  buildMixed,
  buildMixedOverdetermined,
  buildTsAnglesBearings,
  buildTsDirections,
  buildTsDirectionsFixedTargets,
  buildTsSetupScope,
  buildWeightedControls,
  maxDiff,
  protoAccumulate,
  protoQuadraticForm,
  round4,
  type BuiltNetwork,
} from './phase16aWeightEvidenceShared';

/** Production robust row groups for a network (production helper + production TS grouping). */
const productionGroups = (network: BuiltNetwork) => (rowInfo: EquationRowInfo[]): number[][] =>
  robustCorrelationRowGroups(rowInfo, {
    rowSigma: (info) => network.deps.effectiveStdDev(info.obs),
    tsCorrelationEnabled: network.observations.some(isTsCorrelationObservation),
    tsCorrelationGroup: (obs) =>
      tsCorrelationGroup({ enabled: true, obs, scope: network.tsScope }),
  });

/** Column iterator over structured weights: diagonal + every triplet touching column i. */
const iterateNonzeroColumn = (
  weights: StructuredSymmetricWeights,
  column: number,
): Array<{ row: number; value: number }> => {
  const out: Array<{ row: number; value: number }> = [];
  const diag = weights.diagonal[column] ?? 0;
  if (diag !== 0) out.push({ row: column, value: diag });
  for (let k = 0; k < weights.offValues.length; k += 1) {
    const row = weights.offRows[k] as number;
    const col = weights.offColumns[k] as number;
    const value = weights.offValues[k] as number;
    if (col === column) out.push({ row, value });
    else if (row === column) out.push({ row: col, value });
  }
  out.sort((a, b) => a.row - b.row);
  return out;
};

interface ParityRow {
  caseId: string;
  m: number;
  n: number;
  residualMode: 'solve' | 'l-proxy';
  normalMaxAbs: number;
  normalMaxRel: number;
  rhsMaxAbs: number;
  rhsMaxRel: number;
  vtpvDense: number;
  vtpvStructured: number;
  vtpvProto: number;
  vtpvMaxRel: number;
  seuwDense: number | null;
  seuwStructured: number | null;
  seuwMaxRel: number | null;
  chiSquareDense: number;
  chiSquareStructured: number;
  bitIdenticalN: boolean;
  bitIdenticalRhs: boolean;
}

const solveResiduals = (
  network: BuiltNetwork,
  dense: { A?: number[][]; L: number[][] },
  normal: number[][],
  rhs: number[][],
): { v: number[][]; mode: 'solve' | 'l-proxy' } => {
  const m = dense.L.length;
  const n = network.numParams;
  if (m > n && dense.A) {
    try {
      const { correction } = solveNormalEquations(normal, rhs, { log: () => {} });
      const v = dense.L.map((row, i) => {
        let modeled = 0;
        const aRow = dense.A?.[i] ?? [];
        for (let k = 0; k < aRow.length; k += 1) modeled += (aRow[k] ?? 0) * (correction[k]?.[0] ?? 0);
        return [(row[0] ?? 0) - modeled];
      });
      return { v, mode: 'solve' };
    } catch {
      // Fall through to proxy.
    }
  }
  return { v: dense.L.map((row) => [row[0] ?? 0]), mode: 'l-proxy' };
};

const checkParity = (network: BuiltNetwork, robust: boolean): ParityRow => {
  const { dense, sparse } = assembleBoth(network);
  const denseP = (dense.P as number[][]).map((row) => [...row]);
  const weights = sparse.structuredWeights as StructuredSymmetricWeights;
  const { sparseRows } = dense;
  if (robust) {
    const residuals = dense.L.map((row) => row[0] ?? 0);
    const summary = computeRobustWeightSummary(residuals, dense.rowInfo, {
      robustK: 1.5,
      rowSigma: (info) => network.deps.effectiveStdDev(info.obs),
    });
    const base = captureRobustWeightBase(denseP, dense.rowInfo, {
      robustCorrelationRowGroups: productionGroups(network),
    });
    applyRobustWeightFactors(denseP, base, summary.factors);
  }
  const baseline = accumulateNormalEquationsFromSparseRows(sparseRows, dense.L, denseP, network.numParams);
  const weightsForProto: StructuredSymmetricWeights = robust
    ? (() => {
        const rebuilt = denseP.map((row) => [...row]);
        const diag = Float64Array.from(rebuilt.map((row, i) => row[i] ?? 0));
        const offR: number[] = [];
        const offC: number[] = [];
        const offV: number[] = [];
        for (let i = 0; i < rebuilt.length; i += 1) {
          for (let j = i + 1; j < rebuilt.length; j += 1) {
            if ((rebuilt[i]?.[j] ?? 0) !== 0) {
              offR.push(i);
              offC.push(j);
              offV.push(rebuilt[i]?.[j] ?? 0);
            }
          }
        }
        return {
          size: rebuilt.length, diagonal: diag,
          offRows: Int32Array.from(offR), offColumns: Int32Array.from(offC), offValues: Float64Array.from(offV),
        };
      })()
    : weights;
  const proto = protoAccumulate(sparseRows, dense.L, weightsForProto, network.numParams);
  const normalDiff = maxDiff(proto.normal, baseline.normal);
  const rhsDiff = maxDiff(proto.rhs, baseline.rhs);

  const { v, mode } = solveResiduals(network, dense, baseline.normal, baseline.rhs);
  const m = denseP.length;
  const n = network.numParams;
  const vtpvDense = symmetricQuadraticForm(denseP, v);
  const vtpvStructured = structuredQuadraticForm(weightsForProto, v);
  const vtpvProto = protoQuadraticForm(weightsForProto, v);
  const vtpvMaxRel = Math.max(
    Math.abs(vtpvDense - vtpvStructured) / Math.max(1e-300, Math.abs(vtpvDense)),
    Math.abs(vtpvDense - vtpvProto) / Math.max(1e-300, Math.abs(vtpvDense)),
  );
  const dof = m - n;
  const seuwDense = dof > 0 ? vtpvDense / dof : null;
  const seuwStructured = dof > 0 ? vtpvStructured / dof : null;
  const seuwMaxRel =
    seuwDense != null && seuwStructured != null
      ? Math.abs(seuwDense - seuwStructured) / Math.max(1e-300, Math.abs(seuwDense))
      : null;
  return {
    caseId: `${network.id}${robust ? '+robust' : ''}`, m, n, residualMode: mode,
    normalMaxAbs: normalDiff.maxAbs, normalMaxRel: normalDiff.maxRel,
    rhsMaxAbs: rhsDiff.maxAbs, rhsMaxRel: rhsDiff.maxRel,
    vtpvDense, vtpvStructured, vtpvProto, vtpvMaxRel,
    seuwDense, seuwStructured, seuwMaxRel,
    chiSquareDense: vtpvDense, chiSquareStructured: vtpvStructured,
    bitIdenticalN: normalDiff.maxAbs === 0, bitIdenticalRhs: rhsDiff.maxAbs === 0,
  };
};

interface StructuredRobustRow {
  caseId: string;
  baseDiagonalMaxAbs: number;
  basePairsMatch: boolean;
  rescaledMaxAbs: number;
  rescaledMaxRel: number;
}

/** Production structured robust path vs production dense robust path, same factors. */
const checkStructuredRobust = (network: BuiltNetwork): StructuredRobustRow => {
  const { dense, sparse } = assembleBoth(network);
  const groups = productionGroups(network);
  const denseP = (dense.P as number[][]).map((row) => [...row]);
  const residuals = dense.L.map((row) => row[0] ?? 0);
  const summary = computeRobustWeightSummary(residuals, dense.rowInfo, {
    robustK: 1.5,
    rowSigma: (info) => network.deps.effectiveStdDev(info.obs),
  });
  const baseDense = captureRobustWeightBase(denseP, dense.rowInfo, {
    robustCorrelationRowGroups: groups,
  });
  applyRobustWeightFactors(denseP, baseDense, summary.factors);

  const source = sparse.structuredWeights as StructuredSymmetricWeights;
  const structured: StructuredSymmetricWeights = {
    size: source.size,
    diagonal: Float64Array.from(source.diagonal),
    offRows: Int32Array.from(source.offRows),
    offColumns: Int32Array.from(source.offColumns),
    offValues: Float64Array.from(source.offValues),
  };
  const baseStructured = captureRobustWeightBaseFromStructured(structured, dense.rowInfo, {
    robustCorrelationRowGroups: groups,
  });
  applyRobustWeightFactorsToStructured(structured, baseStructured, summary.factors);

  let baseDiagonalMaxAbs = 0;
  baseDense.diagonal.forEach((value, i) => {
    baseDiagonalMaxAbs = Math.max(baseDiagonalMaxAbs, Math.abs(value - (baseStructured.diagonal[i] ?? 0)));
  });
  const pairKey = (pairs: { i: number; j: number; base: number }[]) =>
    pairs.map(({ i, j, base }) => `${i}:${j}=${base}`).sort().join(',');
  const basePairsMatch = pairKey(baseDense.correlatedPairs) === pairKey(baseStructured.correlatedPairs);
  const fromStructured = structuredWeightsToDense(structured);
  const rescaled = maxDiff(fromStructured, denseP);
  return {
    caseId: `${network.id}+structured-robust`,
    baseDiagonalMaxAbs, basePairsMatch,
    rescaledMaxAbs: rescaled.maxAbs, rescaledMaxRel: rescaled.maxRel,
  };
};

describe('Phase 16A structured accumulation prototype parity', () => {
  it('matches dense N, rhs, vTPv, SEUW, and chi-square on every required case', () => {
    const cases: BuiltNetwork[] = [
      buildChain2D('proto-scalar-terrestrial', 16),
      buildGps2D('proto-gps-2d', 16),
      buildGps3D('proto-gps-3d', 8),
      buildGnssBaseline('proto-gnss-baseline', 4),
      buildTsDirections('proto-ts-correlation', 4, 8),
      buildTsSetupScope('proto-ts-setup', 2, 4),
      buildTsAnglesBearings('proto-ts-angles'),
      buildCorrelatedControls('proto-correlated-controls', 8),
      buildWeightedControls('proto-weighted-controls', 16),
      buildMixed('proto-mixed'),
      // Overdetermined: real LS solves with genuine vTPv/SEUW parity.
      buildTsDirectionsFixedTargets('proto-ts-fixed-od', 4, 8),
      buildMixedOverdetermined('proto-mixed-od'),
    ];
    const rows: ParityRow[] = [
      ...cases.map((network) => checkParity(network, false)),
      checkParity(buildMixed('proto-mixed'), true),
      checkParity(buildWeightedControls('proto-weighted-controls', 16), true),
      checkParity(buildMixedOverdetermined('proto-mixed-od'), true),
    ];
    rows.forEach((row) => {
      expect(row.normalMaxRel).toBeLessThan(1e-9);
      expect(row.rhsMaxRel).toBeLessThan(1e-9);
      expect(row.vtpvMaxRel).toBeLessThan(1e-12);
      if (row.seuwMaxRel != null) expect(row.seuwMaxRel).toBeLessThan(1e-12);
    });
    // Overdetermined rows must carry genuine solve-based SEUW parity (no proxy).
    ['proto-ts-fixed-od', 'proto-mixed-od', 'proto-weighted-controls', 'proto-mixed-od+robust'].forEach((id) => {
      const row = rows.find((item) => item.caseId === id);
      expect(row?.residualMode).toBe('solve');
      expect(row?.seuwMaxRel).not.toBeNull();
    });

    // Production structured robust path vs production dense robust path.
    const robustRows: StructuredRobustRow[] = [
      buildMixed('proto-mixed'),
      buildTsDirections('proto-ts-correlation', 4, 8),
      buildWeightedControls('proto-weighted-controls', 16),
      buildMixedOverdetermined('proto-mixed-od'),
    ].map(checkStructuredRobust);
    robustRows.forEach((row) => {
      expect(row.basePairsMatch).toBe(true);
      expect(row.baseDiagonalMaxAbs).toBe(0);
      expect(row.rescaledMaxRel).toBeLessThan(1e-12);
    });

    // iterateNonzeroColumn: every column of every case matches the dense P column.
    cases.forEach((network) => {
      const { dense, sparse } = assembleBoth(network);
      const denseP = dense.P as number[][];
      const weights = sparse.structuredWeights as StructuredSymmetricWeights;
      for (let col = 0; col < weights.size; col += 1) {
        const iterated = iterateNonzeroColumn(weights, col);
        const expected: Array<{ row: number; value: number }> = [];
        for (let row = 0; row < weights.size; row += 1) {
          const value = denseP[row]?.[col] ?? 0;
          if (value !== 0) expected.push({ row, value });
        }
        expect(iterated).toEqual(expected);
      }
    });

    // OmitDenseP path carries identical structured weights (no dense allocation needed).
    cases.forEach((network) => {
      const reference = assembleBoth(network);
      const lean = assembleAdjustmentEquations(
        network.deps, network.observations, network.constraints,
        network.numObsEquations, network.numParams, undefined,
        { weightRepresentation: 'sparse', omitDenseP: true },
      );
      expect(lean.P).toBeUndefined();
      const refW = reference.sparse.structuredWeights as StructuredSymmetricWeights;
      const leanW = lean.structuredWeights as StructuredSymmetricWeights;
      expect([...leanW.diagonal]).toEqual([...refW.diagonal]);
      expect([...leanW.offRows]).toEqual([...refW.offRows]);
      expect([...leanW.offColumns]).toEqual([...refW.offColumns]);
      expect([...leanW.offValues]).toEqual([...refW.offValues]);
    });

    const machine = {
      method: 'shared protoAccumulate vs dense baseline; residuals from real LS solve when m>n else labeled L-proxy; structured robust via production helpers vs dense robust',
      rows: rows.map((row) => ({ ...row, vtpvDense: round4(row.vtpvDense), vtpvStructured: round4(row.vtpvStructured), vtpvProto: round4(row.vtpvProto) })),
      structuredRobust: robustRows,
    };
    const machineDir = join(process.cwd(), 'artifacts/evidence/phase16a');
    mkdirSync(machineDir, { recursive: true });
    writeFileSync(join(machineDir, 'phase16a-prototypes.json'), `${JSON.stringify(machine, null, 1)}\n`);
  }, 600000);
});
