/**
 * Deterministic survey-like input generator for Phase 5 full-adjustment benchmarks.
 *
 * Produces small, valid 2D WebNet networks (chain family with distance+bearing
 * observations, plus a modest GPS-augmented family) from a seeded PRNG so every
 * benchmark case is reproducible. Test-only helper: production defaults and
 * parsers are untouched.
 */
export type Phase5BenchmarkFamily = 'chain-2d' | 'gps-2d';

export interface Phase5NetworkSpec {
  id: string;
  family: Phase5BenchmarkFamily;
  /** Number of unknown stations (controls add two fixed stations). */
  unknownCount: number;
  seed: number;
}

export interface Phase5NetworkCase extends Phase5NetworkSpec {
  input: string;
  stationCount: number;
}

/** Default cap for the dense TS reference/all-pairs benchmark guard (unknown stations per case). */
export const PHASE5_BENCHMARK_DEFAULT_MAX_UNKNOWN_COUNT = 256;

/**
 * Fails-closed size guard for benchmark cases: returns a skip reason when the
 * case exceeds the unknown-station budget, otherwise null. Dense TS reference
 * and legacy all-pairs relativePrecision scale as O(n^2) memory, so cases
 * above the budget must be skipped on every route (not just sparse routes).
 */
export const phase5BenchmarkSizeSkipReason = (
  spec: Phase5NetworkSpec,
  maxUnknowns: number,
): string | null =>
  spec.unknownCount > maxUnknowns
    ? `size guard: ${spec.unknownCount} unknowns exceed BENCH_MAX_UNKNOWN_COUNT=${maxUnknowns}`
    : null;

/** Case list for the full-adjustment benchmark; quick mode keeps two small cases. */
export const listPhase5BenchmarkCases = (quick: boolean): Phase5NetworkSpec[] => {
  if (quick) {
    return [
      { id: 'chain-2d-04', family: 'chain-2d', unknownCount: 4, seed: 1101 },
      { id: 'gps-2d-08', family: 'gps-2d', unknownCount: 8, seed: 2202 },
    ];
  }
  return [
    { id: 'chain-2d-04', family: 'chain-2d', unknownCount: 4, seed: 1101 },
    { id: 'chain-2d-08', family: 'chain-2d', unknownCount: 8, seed: 1108 },
    { id: 'chain-2d-16', family: 'chain-2d', unknownCount: 16, seed: 1116 },
    { id: 'chain-2d-32', family: 'chain-2d', unknownCount: 32, seed: 1132 },
    { id: 'chain-2d-64', family: 'chain-2d', unknownCount: 64, seed: 1164 },
    { id: 'chain-2d-128', family: 'chain-2d', unknownCount: 128, seed: 1128 },
    { id: 'gps-2d-08', family: 'gps-2d', unknownCount: 8, seed: 2202 },
    { id: 'gps-2d-16', family: 'gps-2d', unknownCount: 16, seed: 2216 },
    { id: 'gps-2d-64', family: 'gps-2d', unknownCount: 64, seed: 2264 },
  ];
};

/** FNV-1a hash mixed with the seed for a reproducible stream per case. */
const hashSeed = (seed: number, label: string): number => {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < label.length; i += 1) {
    hash ^= label.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const mulberry32 = (state: number): (() => number) => {
  let current = state >>> 0;
  return () => {
    current = (current + 0x6d2b79f5) >>> 0;
    let mixed = current;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
};

const pad2 = (value: number): string => String(value).padStart(2, '0');
const pad3 = (value: number): string => String(value).padStart(3, '0');

/** Formats decimal degrees as DDD-MM-SS.s bearing text. */
export const decimalDegreesToBearingDms = (degrees: number): string => {
  const normalized = ((degrees % 360) + 360) % 360;
  const d = Math.floor(normalized);
  const minutesFull = (normalized - d) * 60;
  const m = Math.floor(minutesFull);
  const s = (minutesFull - m) * 60;
  return `${pad3(d)}-${pad2(m)}-${pad2(Math.floor(s))}.${Math.floor((s % 1) * 10)}`;
};

/**
 * Generates a valid 2D WebNet input: two fixed controls bracket a gently
 * curving chain of unknowns with distance+bearing legs plus cross-bracing to
 * the far control; the GPS family adds vectors from the first control.
 * Approximate coordinates carry a small deterministic offset so the
 * adjustment iterates from a realistic starting point.
 */
export const generatePhase5BenchmarkInput = (spec: Phase5NetworkSpec): string => {
  const random = mulberry32(hashSeed(spec.seed, `${spec.id}:${spec.family}`));
  const spacing = 60;
  const unknowns = Array.from({ length: spec.unknownCount }, (_, i) => `U${i + 1}`);
  const truth = new Map<string, { e: number; n: number }>();
  truth.set('CTRLA', { e: 0, n: 0 });
  truth.set('CTRLB', { e: spacing * (spec.unknownCount + 1), n: 0 });
  unknowns.forEach((name, i) => {
    truth.set(name, {
      e: spacing * (i + 1),
      n: 25 * Math.sin((i + 1) * 0.7) + 12 * Math.sin((i + 1) * 0.23 + 1.1),
    });
  });
  const at = (name: string): { e: number; n: number } => {
    const point = truth.get(name);
    if (!point) throw new Error(`Unknown benchmark station ${name}.`);
    return point;
  };
  const noise = (scale: number): number => (random() * 2 - 1) * scale;

  const lines = [
    `# Phase 5 deterministic benchmark network ${spec.id} (${spec.family}, seed ${spec.seed})`,
    '.2D',
    '.UNITS METERS',
    '.ORDER EN',
    '.DELTA ON',
  ];
  if (spec.family === 'gps-2d') {
    lines.push('I GPS1 Phase5-GNSS 0.5 0.002 2.0 0.010 4.0');
  }
  const offset = (): number => (random() * 2 - 1) * 0.35;
  lines.push(`C CTRLA 0.0000 0.0000 0.0000 ! !`);
  unknowns.forEach((name) => {
    const point = at(name);
    lines.push(`C ${name} ${(point.e + offset()).toFixed(4)} ${(point.n + offset()).toFixed(4)} 0.0000`);
  });
  const far = at('CTRLB');
  lines.push(`C CTRLB ${far.e.toFixed(4)} ${far.n.toFixed(4)} 0.0000 ! !`);

  const order = ['CTRLA', ...unknowns, 'CTRLB'];
  const observe = (from: string, to: string): void => {
    const a = at(from);
    const b = at(to);
    const dE = b.e - a.e;
    const dN = b.n - a.n;
    const distance = Math.hypot(dE, dN) + noise(0.0015);
    const bearing = decimalDegreesToBearingDms((Math.atan2(dE, dN) * 180) / Math.PI + noise(0.0004));
    lines.push(`D ${from}-${to} ${distance.toFixed(4)} 0.003`);
    lines.push(`B ${from}-${to} ${bearing} 2.0`);
  };
  for (let i = 0; i < order.length - 1; i += 1) {
    observe(order[i] ?? 'CTRLA', order[i + 1] ?? 'CTRLB');
  }
  unknowns.forEach((name, i) => {
    observe(name, i % 2 === 0 ? 'CTRLA' : 'CTRLB');
  });
  if (spec.family === 'gps-2d') {
    const origin = at('CTRLA');
    unknowns.forEach((name) => {
      const point = at(name);
      lines.push(
        `G GPS1 CTRLA ${name} ${(point.e - origin.e + noise(0.004)).toFixed(4)} ${(point.n - origin.n + noise(0.004)).toFixed(4)} 0.010 0.010`,
      );
    });
  }
  return `${lines.join('\n')}\n`;
};

/** Builds generator cases with rendered inputs for benchmarks and tests. */
export const buildPhase5BenchmarkCases = (quick: boolean): Phase5NetworkCase[] =>
  listPhase5BenchmarkCases(quick).map((spec) => ({
    ...spec,
    input: generatePhase5BenchmarkInput(spec),
    stationCount: spec.unknownCount + 2,
  }));
