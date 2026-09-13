/**
 * Phase 12F.0 — deterministic synthetic corpus (evidence-only).
 *
 * PRNG + ECEF geometry + SPD correlated covariances + topology edge lists
 * + survey-like network generator. No production imports beyond pure
 * engine types; never imported by production code.
 */
import type {
  GnssBaselineCovariance,
  GnssBaselineObservation,
} from '../../src/engine/gnssBaselineTypes';
import type { StationMap } from '../../src/types';

// ---------------------------------------------------------------------------
// Deterministic PRNG + ECEF geometry.
// ---------------------------------------------------------------------------

/** Mulberry32: deterministic stream per (topology, size, seed). */
export const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const gaussian = (rand: () => number): number => {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

/** GRS80 lat/lon/h -> ECEF metres (audit harness only; ~mm exact). */
export const latLonToEcef = (latDeg: number, lonDeg: number, h: number): [number, number, number] => {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const e2 = 2 * f - f * f;
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return [
    (n + h) * Math.cos(lat) * Math.cos(lon),
    (n + h) * Math.cos(lat) * Math.sin(lon),
    (n * (1 - e2) + h) * Math.sin(lat),
  ];
};

/**
 * Random SPD 3x3 via C = L L^T (natural correlations, incl. negative).
 * sigmaRange sets the 1-sigma scale in metres (survey mm-level by default).
 */
export const randomSpdCovariance = (
  rand: () => number,
  sigmaMin: number,
  sigmaMax: number,
): GnssBaselineCovariance => {
  const s = [
    sigmaMin + rand() * (sigmaMax - sigmaMin),
    sigmaMin + rand() * (sigmaMax - sigmaMin),
    sigmaMin + rand() * (sigmaMax - sigmaMin),
  ];
  const l10 = (rand() * 2 - 1) * 0.9 * s[1]!;
  const l20 = (rand() * 2 - 1) * 0.9 * s[2]!;
  const l21 = (rand() * 2 - 1) * 0.9 * s[2]!;
  const c: number[][] = [
    [s[0]! * s[0]!, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  c[1]![0] = l10 * s[0]!;
  c[1]![1] = l10 * l10 + s[1]! * s[1]!;
  c[2]![0] = l20 * s[0]!;
  c[2]![1] = l20 * l10 + l21 * s[1]!;
  c[2]![2] = l20 * l20 + l21 * l21 + s[2]! * s[2]!;
  c[0]![1] = c[1]![0]!;
  c[0]![2] = c[2]![0]!;
  c[1]![2] = c[2]![1]!;
  return { xx: c[0]![0]!, xy: c[0]![1]!, xz: c[0]![2]!, yy: c[1]![1]!, yz: c[1]![2]!, zz: c[2]![2]! };
};

/** Correlated noise draw v = L z for covariance C = L L^T (harness mirror). */
const correlatedNoise = (
  rand: () => number,
  cov: GnssBaselineCovariance,
): [number, number, number] => {
  const z = [gaussian(rand), gaussian(rand), gaussian(rand)];
  // Cholesky of the 3x3 (C already SPD by construction).
  const l00 = Math.sqrt(cov.xx);
  const l10 = cov.xy / l00;
  const l11 = Math.sqrt(Math.max(cov.yy - l10 * l10, 1e-30));
  const l20 = cov.xz / l00;
  const l21 = (cov.yz - l20 * l10) / l11;
  const l22 = Math.sqrt(Math.max(cov.zz - l20 * l20 - l21 * l21, 1e-30));
  return [
    l00 * z[0]!,
    l10 * z[0]! + l11 * z[1]!,
    l20 * z[0]! + l21 * z[1]! + l22 * z[2]!,
  ];
};

// ---------------------------------------------------------------------------
// Corpus generators.
// ---------------------------------------------------------------------------

export type AuditTopology =
  | 'chain'
  | 'tree'
  | 'ring'
  | 'sparse-mesh'
  | 'survey'
  | 'hub-spoke'
  | 'repeated-edge';

export const AUDIT_TOPOLOGIES: AuditTopology[] = [
  'chain',
  'tree',
  'ring',
  'sparse-mesh',
  'survey',
  'hub-spoke',
  'repeated-edge',
];

export interface AuditNetwork {
  readonly stations: StationMap;
  readonly baselines: GnssBaselineObservation[];
}

const stationId = (index: number): string => `S${String(index).padStart(4, '0')}`;

interface EdgeSpec {
  from: number;
  to: number;
  duplicate: boolean;
}

/** Topology edge lists over station indices 0..n-1 (deterministic). */
export const topologyEdges = (topology: AuditTopology, n: number, rand: () => number): EdgeSpec[] => {
  const edges: EdgeSpec[] = [];
  const push = (from: number, to: number, duplicate = false): void => {
    if (from !== to) edges.push({ from, to, duplicate });
  };
  switch (topology) {
    case 'chain':
      for (let i = 0; i < n - 1; i += 1) push(i, i + 1);
      break;
    case 'tree':
      for (let i = 1; i < n; i += 1) push(Math.floor((i - 1) / 2), i);
      break;
    case 'ring':
      for (let i = 0; i < n; i += 1) push(i, (i + 1) % n);
      if (n >= 6) for (let i = 0; i < n; i += 3) push(i, (i + 2) % n);
      break;
    case 'sparse-mesh': {
      // Ring backbone first: guarantees a bridgeless (2-edge-connected)
      // base, so the oracle's Qvv eigen gate (finding F-BRIDGE) never sees
      // a cut-edge. Random mates add redundancy on top.
      for (let i = 0; i < n; i += 1) push(i, (i + 1) % n);
      for (let i = 0; i < n; i += 1) {
        const mates = new Set<number>();
        while (mates.size < Math.min(3, n - 1)) {
          const j = Math.floor(rand() * n);
          if (j !== i) mates.add(j);
        }
        mates.forEach((j) => {
          if (!edges.some((e) =>
            (e.from === i && e.to === j) || (e.from === j && e.to === i))) push(i, j);
        });
      }
      break;
    }
    case 'survey': {
      const hubs = Math.max(1, Math.floor(n / 8));
      for (let i = hubs; i < n; i += 1) push(i % hubs, i);
      for (let h = 0; h + 1 < hubs; h += 1) push(h, h + 1);
      for (let i = hubs; i + 1 < n; i += 2) push(i, i + 1);
      break;
    }
    case 'hub-spoke':
      for (let i = 1; i < n; i += 1) push(0, i);
      break;
    case 'repeated-edge':
      for (let i = 0; i < n - 1; i += 1) push(i, i + 1);
      for (let i = 0; i < n - 1; i += 2) push(i + 1, i, true);
      if (n >= 4) push(0, n - 1, true);
      break;
  }
  return edges;
};

/** Topologies whose graphs are bridgeless by construction (oracle-safe). */
export const BRIDGELESS_TOPOLOGIES: AuditTopology[] = ['ring', 'sparse-mesh', 'repeated-edge'];

/**
 * Topologies that inherently contain bridges (cut-edges): chain, tree,
 * survey (rays + hub chain), hub-spoke (spokes). A bridge carries
 * ~zero redundancy, so once dof > 0 its Qvv block sits at roundoff scale
 * and production's eigen PSD gate verdict is a coin flip (finding
 * F-BRIDGE). These topologies are inventoried but excluded from solve
 * legs; see the F-BRIDGE pin in the fast audit test.
 */
export const BRIDGE_TOPOLOGIES: AuditTopology[] = ['chain', 'tree', 'survey', 'hub-spoke'];

/**
 * Deterministic survey-like network: stations scattered over a ~40 km
 * patch (realistic ~6.3e6 m ECEF magnitudes), baselines observed with
 * mm-level correlated noise drawn from per-edge SPD covariances.
 */
export const generateAuditNetwork = (
  topology: AuditTopology,
  stationCount: number,
  seed: number,
  options?: { fixedIndices?: number[]; sigmaMin?: number; sigmaMax?: number },
): AuditNetwork => {
  const rand = mulberry32(seed);
  const sigmaMin = options?.sigmaMin ?? 0.002;
  const sigmaMax = options?.sigmaMax ?? 0.01;
  const baseLat = 45 + rand() * 4;
  const baseLon = -75 + rand() * 4;
  const trueXyz: [number, number, number][] = [];
  for (let i = 0; i < stationCount; i += 1) {
    // ~40 km patch: 0.36 deg ~ 40 km.
    trueXyz.push(latLonToEcef(
      baseLat + (rand() - 0.5) * 0.36,
      baseLon + (rand() - 0.5) * 0.36,
      100 + rand() * 200,
    ));
  }
  const stations: StationMap = {};
  const fixed = new Set(options?.fixedIndices ?? [0]);
  for (let i = 0; i < stationCount; i += 1) {
    const isFixed = fixed.has(i);
    // A-priori = truth + cm-level perturbation (free stations only).
    const [tx, ty, tz] = trueXyz[i]!;
    stations[stationId(i)] = {
      x: tx + (isFixed ? 0 : gaussian(rand) * 0.02),
      y: ty + (isFixed ? 0 : gaussian(rand) * 0.02),
      h: tz + (isFixed ? 0 : gaussian(rand) * 0.02),
      fixed: isFixed,
      fixedX: isFixed,
      fixedY: isFixed,
      fixedH: isFixed,
    };
  }
  const edges = topologyEdges(topology, stationCount, rand);
  // Scaling-campaign guard: every free station needs degree >= 2. A pure
  // ray (degree-1 spur, normal survey practice) leaves its edge with
  // ~zero redundancy, and production's Qvv eigen PSD gate then trips on
  // ~1e-21 roundoff (tau scales with lambda_max ~= 0, far stricter than
  // the 1e-9 diagonal floor). That orthogonal gate is recorded as audit
  // finding F-PSD with a minimal repro; the corpus tops rays to degree 2
  // so parity/perf legs measure the architecture, not the gate.
  const degree = new Array<number>(stationCount).fill(0);
  edges.forEach((edge) => {
    degree[edge.from]! += 1;
    degree[edge.to]! += 1;
  });
  const dist2 = (i: number, j: number): number => {
    const a = trueXyz[i]!;
    const b = trueXyz[j]!;
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  };
  for (let i = 0; i < stationCount; i += 1) {
    if (fixed.has(i)) continue;
    while (degree[i]! < 2) {
      let best = -1;
      for (let j = 0; j < stationCount; j += 1) {
        if (j === i) continue;
        if (best === -1 || dist2(i, j) < dist2(i, best)) best = j;
      }
      edges.push({ from: i, to: best, duplicate: false });
      degree[i]! += 1;
      degree[best]! += 1;
    }
  }
  let nextId = 1;
  const baselines: GnssBaselineObservation[] = edges.map((edge) => {
    const [fx, fy, fz] = trueXyz[edge.from]!;
    const [tx, ty, tz] = trueXyz[edge.to]!;
    const cov = randomSpdCovariance(rand, sigmaMin, sigmaMax);
    const [nx, ny, nz] = correlatedNoise(rand, cov);
    return {
      type: 'gnssBaseline' as const,
      id: nextId++,
      from: stationId(edge.from),
      to: stationId(edge.to),
      vector: { x: tx - fx + nx, y: ty - fy + ny, z: tz - fz + nz },
      covariance: cov,
      frame: 'ecef' as const,
      referenceFrame: 'ITRF2020@2020.0',
      epoch: '2020.0',
      ellipsoid: 'GRS80',
    };
  });
  baselines.sort((a, b) => a.id - b.id);
  return { stations, baselines };
};

// ---------------------------------------------------------------------------
