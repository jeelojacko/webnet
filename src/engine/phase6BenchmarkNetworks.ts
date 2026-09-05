/**
 * Deterministic large-network specs for the Phase 6 sparse-only benchmark.
 *
 * Reuses the Phase 5 seeded 2D chain/GPS generator so large cases stay valid
 * WebNet inputs, then applies small directive variants (GPS covariance
 * weighting, robust + TS correlation) using existing parser syntax.
 * Test-only helper: production defaults and parsers are untouched.
 */
import {
  decimalDegreesToBearingDms,
  generatePhase5BenchmarkInput,
  type Phase5NetworkSpec,
} from './phase5BenchmarkNetworks';

export type Phase6LargeCaseVariant = 'plain' | 'gps-covariance' | 'robust-tscorr';

export type Phase6LargeDimension = '2d' | '3d';

export interface Phase6LargeNetworkSpec extends Phase5NetworkSpec {
  variant: Phase6LargeCaseVariant;
  dimension: Phase6LargeDimension;
}

export interface Phase6LargeNetworkCase extends Phase6LargeNetworkSpec {
  input: string;
  stationCount: number;
}

/** Default cap for the sparse-only large benchmark (unknown stations per case). */
export const PHASE6_SPARSE_LARGE_DEFAULT_MAX_UNKNOWN_COUNT = 1000;

/** Default total wall-clock budget (ms) for the sparse-only large benchmark. */
export const PHASE6_SPARSE_LARGE_DEFAULT_MAX_TOTAL_MS = 480000;

/** Default RSS cap (MiB) checked before each large case; exceeded stops the run. */
export const PHASE6_SPARSE_LARGE_DEFAULT_MAX_RSS_MB = 3072;

/**
 * Fails-closed size guard for large cases: returns a skip reason when the
 * case exceeds the unknown-station budget, otherwise null. Unlike the Phase 5
 * guard this route never builds a dense TS reference or dense Qxx, so the
 * budget only bounds sparse solve cost, not O(n^2) dense memory.
 */
export const phase6LargeSizeSkipReason = (
  spec: Phase5NetworkSpec,
  maxUnknowns: number,
): string | null =>
  spec.unknownCount > maxUnknowns
    ? `size guard: ${spec.unknownCount} unknowns exceed SPARSE_LARGE_MAX_UNKNOWN_COUNT=${maxUnknowns}`
    : null;

/** Case list for the sparse-only large benchmark; quick mode keeps two small cases. */
export const listPhase6LargeBenchmarkCases = (quick: boolean): Phase6LargeNetworkSpec[] => {
  if (quick) {
    return [
      { id: 'chain-2d-16', family: 'chain-2d', unknownCount: 16, seed: 1116, variant: 'plain', dimension: '2d' },
      { id: 'gps-2d-16', family: 'gps-2d', unknownCount: 16, seed: 2216, variant: 'plain', dimension: '2d' },
      { id: 'gps-3d-16', family: 'gps-2d', unknownCount: 16, seed: 2316, variant: 'gps-covariance', dimension: '3d' },
    ];
  }
  return [
    { id: 'chain-2d-256', family: 'chain-2d', unknownCount: 256, seed: 1256, variant: 'plain', dimension: '2d' },
    { id: 'chain-2d-512', family: 'chain-2d', unknownCount: 512, seed: 1512, variant: 'plain', dimension: '2d' },
    { id: 'chain-2d-1000', family: 'chain-2d', unknownCount: 1000, seed: 1100, variant: 'plain', dimension: '2d' },
    { id: 'gps-2d-128', family: 'gps-2d', unknownCount: 128, seed: 2128, variant: 'plain', dimension: '2d' },
    { id: 'gps-2d-256', family: 'gps-2d', unknownCount: 256, seed: 2256, variant: 'plain', dimension: '2d' },
    { id: 'gps-2d-cov-08', family: 'gps-2d', unknownCount: 8, seed: 2202, variant: 'gps-covariance', dimension: '2d' },
    {
      id: 'chain-2d-robust-tscorr-16',
      family: 'chain-2d',
      unknownCount: 16,
      seed: 1116,
      variant: 'robust-tscorr',
      dimension: '2d',
    },
    { id: 'gps-3d-cov-08',
      family: 'gps-2d',
      unknownCount: 8,
      seed: 2308,
      variant: 'gps-covariance',
      dimension: '3d',
    },
    { id: 'gps-3d-16', family: 'gps-2d', unknownCount: 16, seed: 2316, variant: 'gps-covariance', dimension: '3d' },
    { id: 'gps-3d-32', family: 'gps-2d', unknownCount: 32, seed: 2332, variant: 'gps-covariance', dimension: '3d' },
    { id: 'gps-3d-64', family: 'gps-2d', unknownCount: 64, seed: 2364, variant: 'gps-covariance', dimension: '3d' },
    { id: 'gps-3d-128', family: 'gps-2d', unknownCount: 128, seed: 2381, variant: 'gps-covariance', dimension: '3d' },
  ];
};

/**
 * Applies the case variant by inserting directives after `.DELTA ON` using
 * only existing parser syntax (`.GPS WEIGHT COVARIANCE`, `.ROBUST HUBER`,
 * `.TSCORR ON`). Falls back to appending when the anchor is absent.
 */
export const applyPhase6LargeVariant = (
  input: string,
  variant: Phase6LargeCaseVariant,
): string => {
  if (variant === 'plain') return input;
  const extra =
    variant === 'gps-covariance' ? ['.GPS WEIGHT COVARIANCE'] : ['.ROBUST HUBER 1.5', '.TSCORR ON'];
  const anchor = '.DELTA ON';
  if (input.includes(anchor)) {
    return input.replace(anchor, `${anchor}\n${extra.join('\n')}`);
  }
  return `${extra.join('\n')}\n${input}`;
};

/** Builds generator cases with rendered inputs for the benchmark and tests. */
export const buildPhase6LargeBenchmarkCases = (quick: boolean): Phase6LargeNetworkCase[] =>
  listPhase6LargeBenchmarkCases(quick).map((spec) => ({
    ...spec,
    input:
      spec.dimension === '3d'
        ? generatePhase6Large3dInput(spec)
        : applyPhase6LargeVariant(generatePhase5BenchmarkInput(spec), spec.variant),
    stationCount: spec.unknownCount + 2,
  }));

const CHAIN_SPACING_M = 60;

/**
 * Regenerates the ground-truth chain coordinates used by the Phase 5
 * generator (0-based unknown index). Lets the sparse-only route check
 * adjusted coordinates against generated truth without a dense reference.
 */
export const phase6ChainTruth = (unknownIndex: number): { e: number; n: number } => {
  const i = unknownIndex + 1;
  return {
    e: CHAIN_SPACING_M * i,
    n: 25 * Math.sin(i * 0.7) + 12 * Math.sin(i * 0.23 + 1.1),
  };
};

/** Easting of the far fixed control for a case with this many unknowns. */
export const phase6FarControlEasting = (unknownCount: number): number =>
  CHAIN_SPACING_M * (unknownCount + 1);

/**
 * Ground-truth height profile for the 3D case (position index along the
 * chain: 0 is CTRLA, unknownCount + 1 is CTRLB). Gentle deterministic
 * undulation around 10 m.
 */
export const phase6HeightTruth = (positionIndex: number): number =>
  10 + 1.5 * Math.sin(positionIndex * 0.45);

const fnvSeed = (seed: number, label: string): number => {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32Local = (state: number): (() => number) => {
  let current = state >>> 0;
  return () => {
    current = (current + 0x6d2b79f5) >>> 0;
    let mixed = current;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

/**
 * Generates a modest valid 3D WebNet input: the same seeded horizontal
 * chain truth as the 2D generator plus a deterministic height profile,
 * distance+bearing legs, leveling (V) height-difference legs, GPS vectors
 * from the first control, and GPS covariance weighting for the
 * gps-covariance variant. Approximate coordinates carry a small
 * deterministic offset so the adjustment iterates from a realistic start.
 */
export const generatePhase6Large3dInput = (spec: Phase6LargeNetworkSpec): string => {
  const random = mulberry32Local(fnvSeed(spec.seed, `${spec.id}:${spec.family}:3d`));
  const unknowns = Array.from({ length: spec.unknownCount }, (_, i) => `U${i + 1}`);
  const truth = new Map<string, { e: number; n: number; h: number }>();
  truth.set('CTRLA', { e: 0, n: 0, h: phase6HeightTruth(0) });
  truth.set('CTRLB', {
    e: phase6FarControlEasting(spec.unknownCount),
    n: 0,
    h: phase6HeightTruth(spec.unknownCount + 1),
  });
  unknowns.forEach((name, i) => {
    const horizontal = phase6ChainTruth(i);
    truth.set(name, { e: horizontal.e, n: horizontal.n, h: phase6HeightTruth(i + 1) });
  });
  const at = (name: string): { e: number; n: number; h: number } => {
    const point = truth.get(name);
    if (!point) throw new Error(`Unknown benchmark station ${name}.`);
    return point;
  };
  const noise = (scale: number): number => (random() * 2 - 1) * scale;
  const offset = (): number => (random() * 2 - 1) * 0.35;

  const lines = [
    `# Phase 6 deterministic 3D benchmark network ${spec.id} (seed ${spec.seed})`,
    '.3D',
    '.UNITS METERS',
    '.ORDER EN',
    '.DELTA ON',
    'I GPS1 Phase6-GNSS 0.5 0.002 2.0 0.010 4.0',
  ];
  if (spec.variant === 'gps-covariance') lines.push('.GPS WEIGHT COVARIANCE');
  const origin = at('CTRLA');
  lines.push(`C CTRLA ${origin.e.toFixed(4)} ${origin.n.toFixed(4)} ${origin.h.toFixed(4)} ! ! !`);
  unknowns.forEach((name) => {
    const point = at(name);
    lines.push(
      `C ${name} ${(point.e + offset()).toFixed(4)} ${(point.n + offset()).toFixed(4)} ${(point.h + offset()).toFixed(4)}`,
    );
  });
  const far = at('CTRLB');
  lines.push(`C CTRLB ${far.e.toFixed(4)} ${far.n.toFixed(4)} ${far.h.toFixed(4)} ! ! !`);

  const order = ['CTRLA', ...unknowns, 'CTRLB'];
  const observeHorizontal = (from: string, to: string): void => {
    const a = at(from);
    const b = at(to);
    const dE = b.e - a.e;
    const dN = b.n - a.n;
    const distance = Math.hypot(dE, dN) + noise(0.0015);
    const bearing = decimalDegreesToBearingDms((Math.atan2(dE, dN) * 180) / Math.PI + noise(0.0004));
    lines.push(`D ${from}-${to} ${distance.toFixed(4)} 0.003`);
    lines.push(`B ${from}-${to} ${bearing} 2.0`);
  };
  const observeHeight = (from: string, to: string): void => {
    const dh = at(to).h - at(from).h + noise(0.0015);
    lines.push(`V ${from}-${to} ${dh.toFixed(4)} 0.003`);
  };
  for (let i = 0; i < order.length - 1; i += 1) {
    observeHorizontal(order[i] ?? 'CTRLA', order[i + 1] ?? 'CTRLB');
    observeHeight(order[i] ?? 'CTRLA', order[i + 1] ?? 'CTRLB');
  }
  unknowns.forEach((name, i) => {
    const anchor = i % 2 === 0 ? 'CTRLA' : 'CTRLB';
    observeHorizontal(name, anchor);
    observeHeight(name, anchor);
  });
  unknowns.forEach((name) => {
    const point = at(name);
    lines.push(
      `G GPS1 CTRLA ${name} ${(point.e - origin.e + noise(0.004)).toFixed(4)} ${(point.n - origin.n + noise(0.004)).toFixed(4)} 0.010 0.010 0.35`,
    );
  });
  return `${lines.join('\n')}\n`;
};

/**
 * Split generated-truth agreement into horizontal vs height maxima.
 * Pure helper over an adjusted stations map: horizontal covers x/y
 * against the chain truth, height covers z/h against the height profile
 * (3D cases only; 2D reports height 0). Non-finite/missing stations yield
 * positive infinity so fail-closed callers reject the case.
 */
export const phase6TruthDiffs = (
  stations: Record<string, { x: number; y: number; z?: number; h?: number } | undefined>,
  spec: { unknownCount: number; dimension: Phase6LargeDimension },
): { horizontalM: number; heightM: number } => {
  let horizontalM = 0;
  let heightM = 0;
  for (let i = 0; i < spec.unknownCount; i += 1) {
    const station = stations[`U${i + 1}`];
    const truth = phase6ChainTruth(i);
    if (!station || !Number.isFinite(station.x) || !Number.isFinite(station.y)) {
      return { horizontalM: Number.POSITIVE_INFINITY, heightM: Number.POSITIVE_INFINITY };
    }
    horizontalM = Math.max(horizontalM, Math.abs(station.x - truth.e), Math.abs(station.y - truth.n));
    if (spec.dimension === '3d') {
      const height = station.z ?? station.h;
      if (height == null || !Number.isFinite(height)) {
        return { horizontalM, heightM: Number.POSITIVE_INFINITY };
      }
      heightM = Math.max(heightM, Math.abs(height - phase6HeightTruth(i + 1)));
    }
  }
  return { horizontalM, heightM };
};

export interface Phase6SparseStorageInput {
  equationRows: number;
  paramCount: number;
  designNnz: number;
  weightNnz: number;
  normalNnz: number;
  factorNnz: number;
}

export interface Phase6SparseStorageEstimate {
  densePBytes: number;
  denseNBytes: number;
  denseQxxBytes: number;
  sparseDesignBytes: number;
  sparseWeightBytes: number;
  sparseNormalBytes: number;
  sparseFactorBytes: number;
  sparseTotalBytes: number;
  denseTotalBytes: number;
}

const INDEX_BYTES = 4;
const VALUE_BYTES = 8;

/**
 * Estimates dense P/N/Qxx storage (which this route never allocates) versus
 * the structured/sparse storage implied by WASM factor metadata. Pure helper
 * for reporting only; sparse entries count one value plus one int32 index,
 * except the factor which is reported as values.
 */
export const estimatePhase6SparseStorage = (
  input: Phase6SparseStorageInput,
): Phase6SparseStorageEstimate => {
  const densePBytes = input.equationRows * input.equationRows * VALUE_BYTES;
  const denseNBytes = input.paramCount * input.paramCount * VALUE_BYTES;
  const denseQxxBytes = input.paramCount * input.paramCount * VALUE_BYTES;
  const sparseDesignBytes = input.designNnz * (VALUE_BYTES + INDEX_BYTES);
  const sparseWeightBytes = input.weightNnz * (VALUE_BYTES + INDEX_BYTES);
  const sparseNormalBytes = input.normalNnz * (VALUE_BYTES + INDEX_BYTES);
  const sparseFactorBytes = input.factorNnz * VALUE_BYTES;
  const sparseTotalBytes =
    sparseDesignBytes + sparseWeightBytes + sparseNormalBytes + sparseFactorBytes;
  return {
    densePBytes,
    denseNBytes,
    denseQxxBytes,
    sparseDesignBytes,
    sparseWeightBytes,
    sparseNormalBytes,
    sparseFactorBytes,
    sparseTotalBytes,
    denseTotalBytes: densePBytes + denseNBytes + denseQxxBytes,
  };
};
