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

export type GradingTopologyCertificateScope = 'standalone' | 'group';

export interface GradingTopologyCertificate {
  version: typeof GRADING_TOPOLOGY_CERTIFICATE_VERSION;
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
 * Product-side revalidation: null when the certificate proves the mesh, else
 * a stable failure code. Empty meshes need no certificate (nothing to
 * export topologically); every nonempty mesh requires one.
 */
export const gradingTopologyCertificateError = (
  certificate: GradingTopologyCertificate | undefined,
  scope: GradingTopologyCertificateScope,
  mesh: { points: readonly number[]; triangles: readonly number[] },
): string | null => {
  if (mesh.triangles.length === 0) return null;
  if (!certificate || certificate.version !== GRADING_TOPOLOGY_CERTIFICATE_VERSION) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_MISSING';
  }
  if (certificate.scope !== scope) return 'GRADING_TOPOLOGY_CERTIFICATE_SCOPE';
  if (digestTopologyMesh(mesh.points, mesh.triangles) !== certificate.meshDigest) {
    return 'GRADING_TOPOLOGY_CERTIFICATE_DIGEST';
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
export const gradingTopologyCertificateProductError = (
  certificate: GradingTopologyCertificate | undefined,
  scope: GradingTopologyCertificateScope,
  mesh: { points: readonly number[]; triangles: readonly number[] },
): string | null => {
  const base = gradingTopologyCertificateError(certificate, scope, mesh);
  if (base) return base;
  // More than one edge-component = multiple positive-width regions: the
  // daylight boundary collapses at the tie and one FeatureLine cannot
  // represent it.
  if (certificate && certificate.components > 1) {
    return 'GRADING_TOPOLOGY_MULTI_REGION_NOT_EXPORTABLE';
  }
  return null;
};
