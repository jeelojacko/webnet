/**
 * Phase 20K.2 — session-only grading topology certificate.
 *
 * The certificate is the worker's authoritative record of the FINAL
 * assembled mesh topology: measured edge-components, boundary cycles,
 * boundary edges, and the tied-station coordinates that legitimized any
 * extra component. It is produced only after final mesh assembly from the
 * authoritative buffers (source + daylight polylines + merged triangles),
 * never persisted, never hashed into `grev1:`/`ggrev1:`, and adds no worker
 * op — it rides the existing result as one additive field.
 *
 * Products (Extract/Bake) never guess tied stations: they revalidate the
 * certificate against the mesh digest and the recorded topology. A missing,
 * stale, forged, or mismatched certificate fails closed (null command, zero
 * mutation).
 */
import { validateGradingMeshTopology } from './gradingTopology';
import { samePlanNode } from './gradingGroupSectors';
import { isZeroWidthPair } from './gradingMesh';

export const GRADING_TOPOLOGY_CERTIFICATE_VERSION = 'gtop1';

/** Phase 20K.3 Wave B — exact binary certificate version + policy. */
export const GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION = 'gtop2';
export { GRADING_TOPOLOGY_POLICY_VERSION } from './gradingTopologyExpectation';

export type GradingTopologyCertificateScope = 'standalone' | 'group';

export interface GradingTopologyCertificate {
  version:
    | typeof GRADING_TOPOLOGY_CERTIFICATE_VERSION
    | typeof GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION;
  scope: GradingTopologyCertificateScope;
  /** Digest of the final assembled mesh (points + triangles) this cert describes. */
  meshDigest: string;
  /** Measured edge-connected components of the final mesh. */
  components: number;
  /** Traversed valid closed boundary cycles (falls back to the boundary-graph count). */
  boundaryCycles: number;
  /** Incidence-1 boundary edge count of the final mesh. */
  boundaryEdges: number;
  /** Tied-station coordinates (flat XYZ), recorded exactly once here. */
  tiedSplitCoords: number[];
  /**
   * Positive-width regions the mesh is expected to carry: for a standalone
   * strip this is the number of maximal non-tied cell runs (tied intervals
   * separate them); groups record the measured component count. Each
   * edge-component beyond this must touch a tied station.
   */
  positiveWidthRegionCount: number;
  /** Digest of the authoritative source boundary polyline. */
  sourceBoundaryDigest: string;
  /** Digest of the authoritative grading/daylight boundary polyline. */
  gradingBoundaryDigest: string;
  /**
   * Phase 20K.3 Wave B (gtop2 only): declaring policy version.
   * gtop1 certificates omit it.
   */
  policyVersion?: string;
  /**
   * Phase 20K.3 Wave B (gtop2 only): EXPECTED topology declared before
   * the mesh ran. Product revalidation requires the measured mesh to
   * equal these exactly.
   */
  expectedComponents?: number;
  expectedBoundaryCycles?: number;
  /**
   * Phase 20K.3 Wave B (gtop2 only): sorted measured boundary-cycle
   * vertex counts (MEASURED detail, rebuilt at revalidation).
   */
  cycleSizes?: number[];
}

export interface GradingTopologyCertificateInput {
  scope: GradingTopologyCertificateScope;
  points: readonly number[];
  triangles: readonly number[];
  tiedSplitCoords?: readonly number[];
  /**
   * Expected positive-width regions (standalone: counted from the strip
   * cells; groups omit it and the measured component count is used). Each
   * edge-component beyond this must touch a tied station.
   */
  expectedComponents?: number;
  sourceBoundaryPoints?: readonly number[];
  gradingBoundaryPoints?: readonly number[];
}

/**
 * Positive-width strip regions: maximal runs of cells whose two boundary
 * pairs are not both tied. This is the expected edge-component count for a
 * mesh with legitimate tied splits (zero-width cells contribute none).
 */
export const countPositiveWidthRegions = (
  sourcePts: ReadonlyArray<{ x: number; y: number; z: number }>,
  daylightPts: ReadonlyArray<{ x: number; y: number; z: number }>,
): number => {
  const count = Math.min(sourcePts.length, daylightPts.length);
  let regions = 0;
  let inRegion = false;
  for (let i = 0; i + 1 < count; i += 1) {
    const zeroWidth =
      isZeroWidthPair(sourcePts[i]!, daylightPts[i]!) &&
      isZeroWidthPair(sourcePts[i + 1]!, daylightPts[i + 1]!);
    if (zeroWidth) inRegion = false;
    else if (!inRegion) {
      regions += 1;
      inRegion = true;
    }
  }
  return regions;
};

interface TopologyLike {
  ok: boolean;
  code?: string;
  detail?: string;
  components: number;
  boundaryEdges: number;
  loops: number;
  boundaryCycles?: number;
}

const fnv1a = (text: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/** Deterministic FNV-1a digest over a coordinate buffer (12 significant digits). */
export const digestTopologyCoordinates = (values: readonly number[]): string =>
  fnv1a(values.map((value) => value.toPrecision(12)).join(','));

/** Deterministic digest over the exact mesh buffers (points + triangles). */
export const digestTopologyMesh = (
  points: readonly number[],
  triangles: readonly number[],
): string =>
  fnv1a(`${points.map((value) => value.toPrecision(12)).join(',')}|${triangles.join(',')}`);

/**
 * Boundary cycle count of a topology result: the sibling 20K.2 real-cycle
 * trace when present, else the historical boundary-graph component count.
 */
const boundaryCyclesOf = (topo: TopologyLike): number =>
  topo.ok && typeof topo.boundaryCycles === 'number' && Number.isFinite(topo.boundaryCycles)
    ? topo.boundaryCycles
    : topo.loops;

/**
 * Tied-run starts (flat XYZ): maximal runs where the daylight polyline sits
 * back on the source in plan. Mirrors the standalone arc stitch exactly;
 * used so the certificate records real tied stations, never a count.
 */
export const collectTiedRunStarts = (
  sourcePts: ReadonlyArray<{ x: number; y: number; z: number }>,
  daylightPts: ReadonlyArray<{ x: number; y: number; z: number }>,
): number[] => {
  const out: number[] = [];
  const count = Math.min(sourcePts.length, daylightPts.length);
  let inRun = false;
  for (let i = 0; i < count; i += 1) {
    const tied = samePlanNode(daylightPts[i]!, sourcePts[i]!);
    if (tied && !inRun) {
      const p = sourcePts[i]!;
      out.push(p.x, p.y, p.z);
      inRun = true;
    } else if (!tied) {
      inRun = false;
    }
  }
  return out;
};

export const buildGradingTopologyCertificate = (
  input: GradingTopologyCertificateInput,
): GradingTopologyCertificate | null => {
  const tiedSplitCoords = [...(input.tiedSplitCoords ?? [])];
  const points = [...input.points];
  const triangles = [...input.triangles];
  const scope = input.scope === 'group' ? 'group' : 'arc';
  const probe = validateGradingMeshTopology(points, triangles, {
    scope,
    tiedSplitCoords,
  }) as TopologyLike;
  // A nonempty mesh whose structural pass collapsed to zero components is
  // malformed (ragged/bad index/zero-area/fold): never certify it.
  if (triangles.length > 0 && probe.components === 0) return null;
  const expectedComponents = input.expectedComponents ?? probe.components;
  const topo = (probe.ok && probe.components === expectedComponents
    ? probe
    : validateGradingMeshTopology(points, triangles, {
        scope,
        expectedComponents,
        tiedSplitCoords,
      })) as TopologyLike;
  if (!topo.ok) return null;
  return {
    version: GRADING_TOPOLOGY_CERTIFICATE_VERSION,
    scope: input.scope,
    meshDigest: digestTopologyMesh(points, triangles),
    components: topo.components,
    boundaryCycles: boundaryCyclesOf(topo),
    boundaryEdges: topo.boundaryEdges,
    tiedSplitCoords,
    positiveWidthRegionCount: expectedComponents,
    sourceBoundaryDigest: digestTopologyCoordinates([...(input.sourceBoundaryPoints ?? [])]),
    gradingBoundaryDigest: digestTopologyCoordinates([...(input.gradingBoundaryPoints ?? [])]),
  };
};

/**
 * The authoritative boundary polylines a product is about to export. The
 * product gate re-derives both digests from these arrays at gate time and
 * never trusts the certificate's stored digest strings alone.
 */
export interface GradingCertificateBoundaries {
  /** Flat XYZ source boundary the result will export. */
  sourceBoundaryPoints?: readonly number[];
  /** Flat XYZ grading/daylight boundary the result will export. */
  gradingBoundaryPoints?: readonly number[];
}

/**
 * Product-side revalidation: null when the certificate proves the mesh, else
 * a stable failure code. Empty meshes need no certificate (nothing to
 * export topologically); every nonempty mesh requires one.
 *
 * Every certificate field that changes the verdict is re-derived here and
 * compared, never trusted:
 * - `meshDigest` over the actual mesh,
 * - `components` / `boundaryEdges` / `boundaryCycles` from the measured
 *   topology (the forged-components 2→1 hole this closes), and
 * - when `boundaries` are supplied, both boundary digests recomputed from
 *   the actual exported polylines.
 * `positiveWidthRegionCount` and `tiedSplitCoords` are inputs to the
 * topology pass, so self-consistency (never more expected regions than
 * measured components; every extra component carries tied stations) is
 * asserted before the pass and the measured component count is pinned after
 * it.
 */
export const gradingTopologyCertificateError = (
  certificate: GradingTopologyCertificate | undefined,
  scope: GradingTopologyCertificateScope,
  mesh: { points: readonly number[]; triangles: readonly number[] },
  boundaries?: GradingCertificateBoundaries,
): string | null => {
  if (mesh.triangles.length === 0) return null;
  // Phase 20K.3 Wave B: gtop2 certificates take the strict exact path;
  // gtop1 stays on the legacy self-consistency reader below.
  if (certificate?.version === GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION) {
    return gradingTopologyCertificateExactError(certificate, scope, mesh, boundaries);
  }
  if (!certificate || certificate.version !== GRADING_TOPOLOGY_CERTIFICATE_VERSION) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_MISSING';
  }
  if (certificate.scope !== scope) return 'GRADING_TOPOLOGY_CERTIFICATE_SCOPE';
  if (digestTopologyMesh(mesh.points, mesh.triangles) !== certificate.meshDigest) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_DIGEST';
  }
  if (boundaries) {
    if (
      digestTopologyCoordinates(boundaries.sourceBoundaryPoints ?? []) !== certificate.sourceBoundaryDigest ||
      digestTopologyCoordinates(boundaries.gradingBoundaryPoints ?? []) !== certificate.gradingBoundaryDigest
    ) {
      return 'GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_DIGEST';
    }
  }
  // Self-consistency of the pass inputs: a malformed tie list or an expected
  // region count above the measured components can only be a forgery, since
  // the topology pass itself would have rejected both.
  if (
    certificate.tiedSplitCoords.length % 3 !== 0 ||
    certificate.tiedSplitCoords.some((value) => !Number.isFinite(value))
  ) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_TIED_STATIONS';
  }
  if (certificate.positiveWidthRegionCount > certificate.components) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_POSITIVE_WIDTH';
  }
  if (certificate.components > certificate.positiveWidthRegionCount && certificate.tiedSplitCoords.length === 0) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_TIED_STATIONS';
  }
  const topo = validateGradingMeshTopology(mesh.points, mesh.triangles, {
    scope: scope === 'group' ? 'group' : 'arc',
    expectedComponents: certificate.positiveWidthRegionCount,
    expectedBoundaryLoops: certificate.boundaryCycles,
    tiedSplitCoords: certificate.tiedSplitCoords,
  }) as TopologyLike;
  if (!topo.ok) {
    return `GRADING_TOPOLOGY_CERTIFICATE_TOPOLOGY:${topo.code ?? ''}:${topo.detail ?? ''}`;
  }
  if (topo.components !== certificate.components) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_COMPONENTS';
  }
  if (topo.boundaryEdges !== certificate.boundaryEdges) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_EDGES';
  }
  if (boundaryCyclesOf(topo) !== certificate.boundaryCycles) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_CYCLES';
  }
  return null;
};

/**
 * Product-export revalidation: certificate validity PLUS the one-Feature-Line
 * representability bound. A multi-region tied split has no single daylight
 * polyline (the tie collapses consecutive vertices), so Extract cannot
 * represent it and both products are marked unavailable — never a silent
 * concat and never an enabled command that returns null.
 */
export const GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE =
  'GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE';

export const gradingTopologyCertificateProductError = (
  certificate: GradingTopologyCertificate | undefined,
  scope: GradingTopologyCertificateScope,
  mesh: { points: readonly number[]; triangles: readonly number[] },
  boundaries: GradingCertificateBoundaries,
): string | null => {
  const base = gradingTopologyCertificateError(certificate, scope, mesh, boundaries);
  if (base) return base;
  // More than one edge-component = multiple positive-width regions: the
  // daylight boundary collapses at the tie and one FeatureLine cannot
  // represent it.
  if (certificate && certificate.components > 1) {
    return GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE;
  }
  return null;
};

/* ---------------------------------------------------------------------------
 * Phase 20K.3 Wave B — gtop2 exact binary certificate.
 *
 * gtop1 hashed `Number#toPrecision(12)` text through 32-bit FNV-1a: two
 * coordinates differing below the 12-significant-digit quantum share a
 * digest, so a shifted mesh keeps its certificate (false-accept). gtop2
 * serializes every coordinate as exact IEEE-754 Float64 bits (DataView,
 * -0 canonicalized to +0) and every triangle index as an exact validated
 * uint32, with unambiguous length-prefixed sections, and digests the bytes
 * with SHA-256 (256 bits). NaN/Infinity never certify. The gtop1 builder
 * and reader above are untouched; Calculate paths emit gtop2, and the
 * strict revalidation below rejects stale gtop1 (no migration).
 * ------------------------------------------------------------------------- */

import {
  GRADING_TOPOLOGY_POLICY_VERSION as GTOP2_POLICY,
  type GradingTopologyExpectation,
} from './gradingTopologyExpectation';

/** Minimal pure-SHA-256 over bytes -> lowercase hex (64 chars, 256 bits). */
const sha256Hex = (data: Uint8Array): string => {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const bitLen = data.length * 8;
  const paddedLen = (((data.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  // 64-bit big-endian bit length (high word first; messages here are tiny).
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(paddedLen - 4, bitLen >>> 0);
  const w = new Array<number>(64);
  const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
    }
    let [a, b, c, d, e, f, g, h] = [h0, h1, h2, h3, h4, h5, h6, h7];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((v) => (v >>> 0).toString(16).padStart(8, '0'))
    .join('');
};

const GTOP2_TAG = [0x67, 0x74, 0x6f, 0x70, 0x32, 0x00]; // 'gtop2\0'

const pushU32 = (out: number[], value: number): void => {
  out.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
};

/** Exact Float64 bits, little-endian; -0 canonicalized to +0. */
const pushF64 = (out: number[], value: number): boolean => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const canonical = value === 0 ? 0 : value;
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, canonical, true);
  for (const byte of new Uint8Array(buf)) out.push(byte);
  return true;
};

/** Length-prefixed coordinate section; false on any non-finite value. */
const pushCoords = (out: number[], tag: number, values: readonly number[]): boolean => {
  out.push(tag);
  if (values.length % 3 !== 0) return false;
  pushU32(out, values.length / 3);
  for (const value of values) {
    if (!pushF64(out, value)) return false;
  }
  return true;
};

/** Length-prefixed triangle-index section; false on any non-uint32 index. */
const pushTris = (out: number[], tag: number, triangles: readonly number[]): boolean => {
  if (triangles.length % 3 !== 0) return false;
  out.push(tag);
  pushU32(out, triangles.length / 3);
  for (const index of triangles) {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 0xffffffff) {
      return false;
    }
    pushU32(out, index);
  }
  return true;
};

const gtop2Header = (scope: GradingTopologyCertificateScope, expectation: GradingTopologyExpectation): number[] => {
  const out: number[] = [...GTOP2_TAG, scope === 'group' ? 0x67 : 0x73];
  const policy = [...expectation.policyVersion].map((ch) => ch.charCodeAt(0));
  pushU32(out, policy.length);
  out.push(...policy);
  pushU32(out, expectation.expectedFaceComponents);
  pushU32(out, expectation.expectedBoundaryCycles);
  pushU32(out, expectation.positiveWidthRegionCount);
  return out;
};

export interface GradingTopologyExactInput {
  scope: GradingTopologyCertificateScope;
  points: readonly number[];
  triangles: readonly number[];
  /** Explicit pre-mesh declaration; missing expectation never certifies. */
  expectation: GradingTopologyExpectation;
  sourceBoundaryPoints?: readonly number[];
  gradingBoundaryPoints?: readonly number[];
}

/** Exact digest over one coordinate buffer (bits, not decimals). */
export const digestTopologyCoordinatesExact = (values: readonly number[]): string | null => {
  const out: number[] = [...GTOP2_TAG, 0x63];
  pushU32(out, values.length);
  for (const value of values) {
    if (!pushF64(out, value)) return null;
  }
  return sha256Hex(Uint8Array.from(out));
};

/** Exact digest over a mesh (points as F64 bits + indices as u32). */
export const digestTopologyMeshExact = (
  points: readonly number[],
  triangles: readonly number[],
): string | null => {
  const out: number[] = [...GTOP2_TAG, 0x6d];
  if (!pushCoords(out, 0x70, points)) return null;
  if (!pushTris(out, 0x74, triangles)) return null;
  return sha256Hex(Uint8Array.from(out));
};

/**
 * gtop2 builder: requires an explicit pre-mesh expectation. The observed
 * mesh must equal the declared budget (tied attribution for extras is the
 * validator's existing rule); anything else — including a missing
 * expectation — returns null (fail closed, never self-certified).
 */
export const buildGradingTopologyCertificateExact = (
  input: GradingTopologyExactInput,
): GradingTopologyCertificate | null => {
  const expectation = input.expectation;
  if (!expectation || expectation.policyVersion !== GTOP2_POLICY) return null;
  if (expectation.scope !== input.scope) return null;
  if (input.scope === 'standalone' && expectation.closed) return null;
  const points = [...input.points];
  const triangles = [...input.triangles];
  const tiedSplitCoords = [...expectation.tiedSplitCoords];
  // Fully-tied empty course: 0/0/0 declaration, digest of empty buffers.
  if (triangles.length === 0) {
    if (
      expectation.shape !== 'empty-tied' ||
      expectation.expectedFaceComponents !== 0 ||
      expectation.expectedBoundaryCycles !== 0
    ) {
      return null;
    }
  }
  const topo = validateGradingMeshTopology(points, triangles, {
    scope: input.scope === 'group' ? 'group' : 'arc',
    expectedComponents: expectation.expectedFaceComponents,
    expectedBoundaryLoops: expectation.expectedBoundaryCycles,
    tiedSplitCoords,
  });
  if (!topo.ok) return null;
  if (topo.components !== expectation.expectedFaceComponents) return null;
  if (topo.boundaryCycles !== expectation.expectedBoundaryCycles) return null;
  const header = gtop2Header(input.scope, expectation);
  const meshBytes: number[] = [...header, 0x6d];
  if (!pushCoords(meshBytes, 0x70, points)) return null;
  if (!pushTris(meshBytes, 0x74, triangles)) return null;
  if (!pushCoords(meshBytes, 0x69, tiedSplitCoords)) return null;
  const meshDigest = sha256Hex(Uint8Array.from(meshBytes));
  const source = [...(input.sourceBoundaryPoints ?? [])];
  const grading = [...(input.gradingBoundaryPoints ?? [])];
  const sourceBytes = [...header, 0x73];
  if (!pushCoords(sourceBytes, 0x70, source)) return null;
  const gradingBytes = [...header, 0x67];
  if (!pushCoords(gradingBytes, 0x70, grading)) return null;
  return {
    version: GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION,
    scope: input.scope,
    meshDigest,
    components: topo.components,
    boundaryCycles: topo.boundaryCycles,
    boundaryEdges: topo.boundaryEdges,
    tiedSplitCoords,
    positiveWidthRegionCount: expectation.positiveWidthRegionCount,
    sourceBoundaryDigest: sha256Hex(Uint8Array.from(sourceBytes)),
    gradingBoundaryDigest: sha256Hex(Uint8Array.from(gradingBytes)),
    policyVersion: GTOP2_POLICY,
    expectedComponents: expectation.expectedFaceComponents,
    expectedBoundaryCycles: expectation.expectedBoundaryCycles,
    cycleSizes: topo.cycles.map((c) => c.vertexCount).sort((a, b) => a - b),
  };
};

/**
 * gtop2 strict revalidation: rebuilds every digest from the presented
 * buffers and reruns topology against the certificate's EXPECTED budget.
 * A stale gtop1 certificate is rejected outright (no migration).
 */
export const gradingTopologyCertificateExactError = (
  certificate: GradingTopologyCertificate | undefined,
  scope: GradingTopologyCertificateScope,
  mesh: { points: readonly number[]; triangles: readonly number[] },
  boundaries?: GradingCertificateBoundaries,
): string | null => {
  if (mesh.triangles.length === 0) return null;
  if (!certificate || certificate.version !== GRADING_TOPOLOGY_CERTIFICATE_EXACT_VERSION) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_MISSING';
  }
  if (certificate.scope !== scope) return 'GRADING_TOPOLOGY_CERTIFICATE_SCOPE';
  if (
    certificate.policyVersion !== GTOP2_POLICY ||
    certificate.expectedComponents === undefined ||
    certificate.expectedBoundaryCycles === undefined
  ) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_POLICY';
  }
  const rebuilt = buildGradingTopologyCertificateExact({
    scope,
    points: mesh.points,
    triangles: mesh.triangles,
    expectation: {
      policyVersion: GTOP2_POLICY,
      scope,
      shape:
        certificate.expectedComponents === 0
          ? 'empty-tied'
          : scope === 'group' && certificate.expectedBoundaryCycles === 2
            ? 'closed-annulus'
            : certificate.expectedComponents > 1
              ? 'split-open-strips'
              : 'open-strip',
      expectedFaceComponents: certificate.expectedComponents,
      expectedBoundaryCycles: certificate.expectedBoundaryCycles,
      positiveWidthRegionCount: certificate.positiveWidthRegionCount,
      tiedSplitCoords: certificate.tiedSplitCoords,
      closed: scope === 'group' && certificate.expectedBoundaryCycles === 2,
      sourceBoundaryKind: 'open-path',
      gradingBoundaryKind: 'open-path',
    },
    ...(boundaries?.sourceBoundaryPoints !== undefined
      ? { sourceBoundaryPoints: boundaries.sourceBoundaryPoints }
      : {}),
    ...(boundaries?.gradingBoundaryPoints !== undefined
      ? { gradingBoundaryPoints: boundaries.gradingBoundaryPoints }
      : {}),
  });
  if (!rebuilt) return 'GRADING_TOPOLOGY_CERTIFICATE_TOPOLOGY:rebuild:failed';
  if (rebuilt.meshDigest !== certificate.meshDigest) return 'GRADING_TOPOLOGY_CERTIFICATE_EXACT_DIGEST';
  if (boundaries) {
    if (
      rebuilt.sourceBoundaryDigest !== certificate.sourceBoundaryDigest ||
      rebuilt.gradingBoundaryDigest !== certificate.gradingBoundaryDigest
    ) {
      return 'GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_DIGEST';
    }
  }
  if (rebuilt.components !== certificate.expectedComponents) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_EXPECTED_COMPONENTS';
  }
  if (rebuilt.boundaryCycles !== certificate.expectedBoundaryCycles) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_EXPECTED_CYCLES';
  }
  if (
    certificate.components !== certificate.expectedComponents ||
    certificate.boundaryCycles !== certificate.expectedBoundaryCycles
  ) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_EXPECTED_COMPONENTS';
  }
  if (rebuilt.boundaryEdges !== certificate.boundaryEdges) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_BOUNDARY_EDGES';
  }
  const rebuiltSizes = JSON.stringify(rebuilt.cycleSizes ?? []);
  if (certificate.cycleSizes !== undefined && JSON.stringify(certificate.cycleSizes) !== rebuiltSizes) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_EXPECTED_CYCLES';
  }
  return null;
};
