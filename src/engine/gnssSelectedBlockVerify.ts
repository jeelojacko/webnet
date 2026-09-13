import type { GnssSelectedBlockPlan } from './gnssSelectedBlockPlan';
import {
  readGnssBlock,
  type GnssSelectedBlockStore,
} from './gnssSelectedBlockQuery';

/**
 * Phase 12F.3 — production selected-block verifier (pure, fail-closed).
 *
 * Throws on ANY violation; the engine R2B branch lets it propagate so the
 * route wrapper reruns clean TypeScript. Thresholds mirror the 12F.2
 * evidence validators exactly: symmetry within 2e-9 (evidence ABS_TOL*2),
 * strict positive station variances, bitwise transpose consistency, strict
 * Cholesky-diagonal PSD spot on the first free-free edge. NO dense Qxx,
 * NO TS oracle inside — the only cross-check is the engine-level
 * redundancy-identity gate (|sum trace(R) - dof| < 1e-9) after statistics.
 */
const SYMMETRY_TOL = 2e-9;

export const verifyGnssSelectedBlocks = (
  store: GnssSelectedBlockStore,
  plan: GnssSelectedBlockPlan,
): void => {
  const stride = 9;
  const fail = (detail: string): never => {
    throw new Error(`GNSS selected-block verification rejected: ${detail}.`);
  };
  const diagCount = plan.pairs.filter((pair) => pair.blockA === pair.blockB).length;
  if (
    store.diag.length !== plan.stationIds.length * stride ||
    store.offDiag.length !== (plan.pairs.length - diagCount) * stride ||
    store.offIndex.size !== plan.pairs.length - diagCount
  ) {
    fail('dims/cardinality mismatch with the request plan');
  }
  if (store.blockSize !== 3) fail('block size is not 3');
  const sortedIds = [...plan.stationIds].sort();
  if (plan.stationIds.some((id, index) => id !== sortedIds[index])) {
    fail('station ordering is not canonical');
  }
  plan.pairs.forEach((pair, slot) => {
    if (pair.blockA > pair.blockB) fail(`pair ${slot} is not canonical`);
    const next = plan.pairs[slot + 1];
    if (
      next &&
      (next.blockA < pair.blockA ||
        (next.blockA === pair.blockA && next.blockB <= pair.blockB))
    ) {
      fail('pair ordering is not canonical');
    }
  });
  for (const value of [...store.diag, ...store.offDiag]) {
    if (!Number.isFinite(value)) fail('non-finite block value');
  }
  const out = new Float64Array(9);
  plan.pairs.forEach((pair) => {
    if (pair.blockA !== pair.blockB) return;
    readGnssBlock(store, pair.blockA, pair.blockB, out);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        if (Math.abs((out[i * 3 + j] ?? 0) - (out[j * 3 + i] ?? 0)) > SYMMETRY_TOL) {
          fail(`diagonal block ${pair.blockA} asymmetric`);
        }
      }
      if (!((out[i * 3 + i] ?? 0) > 0)) fail(`diagonal block ${pair.blockA} non-positive variance`);
    }
  });
  // Transpose self-consistency of the TS accessor (both directions derive
  // from the same stored chunk by construction, so this cannot fire on a
  // native payload — it pins the accessor wiring only). Native transpose
  // correctness rests on canonical request orientation + native transpose
  // memoization + full-oracle parity tests on CI-sized nets, never on this
  // check or any runtime dense oracle.
  const fwd = new Float64Array(9);
  const rev = new Float64Array(9);
  plan.pairs.forEach((pair) => {
    if (pair.blockA === pair.blockB) return;
    readGnssBlock(store, pair.blockA, pair.blockB, fwd);
    readGnssBlock(store, pair.blockB, pair.blockA, rev);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        if (rev[i * 3 + j] !== fwd[j * 3 + i]) {
          fail(`transpose contract violated on blocks ${pair.blockA}:${pair.blockB}`);
        }
      }
    }
  });
  const freeFree = plan.pairs.find((pair) => pair.blockA !== pair.blockB);
  if (freeFree) {
    const aa = new Float64Array(9);
    const ab = new Float64Array(9);
    const bb = new Float64Array(9);
    readGnssBlock(store, freeFree.blockA, freeFree.blockA, aa);
    readGnssBlock(store, freeFree.blockA, freeFree.blockB, ab);
    readGnssBlock(store, freeFree.blockB, freeFree.blockB, bb);
    const joint: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        joint[i]![j] = aa[i * 3 + j] ?? 0;
        joint[i]![j + 3] = ab[i * 3 + j] ?? 0;
        joint[i + 3]![j] = ab[j * 3 + i] ?? 0;
        joint[i + 3]![j + 3] = bb[i * 3 + j] ?? 0;
      }
    }
    const lower: number[][] = Array.from({ length: 6 }, () => new Array<number>(6).fill(0));
    for (let k = 0; k < 6; k += 1) {
      let diag = joint[k]?.[k] ?? 0;
      for (let i = 0; i < k; i += 1) diag -= (lower[k]?.[i] ?? 0) ** 2;
      if (!(diag > 0)) fail('6x6 principal-block PSD spot failed');
      lower[k]![k] = Math.sqrt(diag);
      for (let r = k + 1; r < 6; r += 1) {
        let off = joint[r]?.[k] ?? 0;
        for (let i = 0; i < k; i += 1) off -= (lower[r]?.[i] ?? 0) * (lower[k]?.[i] ?? 0);
        lower[r]![k] = off / (lower[k]?.[k] ?? 1);
      }
    }
  }
};
