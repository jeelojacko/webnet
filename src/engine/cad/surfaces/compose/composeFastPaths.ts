/**
 * Phase 18Z — exact composition fast paths (pure, worker-safe).
 *
 * The 18Y pipeline retriangulates the union of both surfaces through one
 * global constrained TIN. Two exact shapes have closed-form answers that
 * avoid it entirely, and both are proven here, never assumed:
 *
 *  - Full overlay: overlay retained coverage contains the whole base
 *    retained domain → the composition domain IS the overlay domain, so the
 *    result is the canonical overlay topology (no seam can exist because no
 *    base-only cell survives). Void exposure is impossible by construction:
 *    coverage is verified per base triangle by overlap area, so an overlay
 *    void over the base fails the proof.
 *  - Strictly disjoint: no area overlap AND no edge/vertex touch → the
 *    result is the concatenation of both topologies. Touch of any kind is a
 *    seam candidate and is delegated to the normal path.
 *
 * Predicates are exact (`orient2d` zero tests, no tolerance merge, no
 * rounded keys); the only floating comparison is the full-coverage area
 * bound, relative to the base triangle's own area.
 */
import { orient2d } from 'robust-predicates';
import { canonicalizeBakedTin } from '../../cadExplicitBake';
import {
  explicitTinTopologyDigest,
  makeWebnetComposeProvenance,
  validateExplicitTinPayload,
} from '../../cadImportedTin';
import type { ComposeDiagnostics, ComposeSourceMesh, ComposeSuccess } from '../../surfaceCompose';
import { createMeshView, meshPlanimetricArea } from './coverage';
import type { ComposeMeshPoint, ComposeMeshTriangle, ComposeMeshView } from './coverage';
import { clipTrianglePair } from '../volume/overlap';

/** Relative area slack for the full-coverage proof (float summation only). */
const COVERAGE_REL_EPS = 1e-9;
/** Grid cells scanned before falling back to a whole-view triangle scan. */
const MAX_CELLS_PER_QUERY = 4096;

export interface RetainedComponentBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RetainedComponent {
  bbox: RetainedComponentBox;
  /** Planimetric (XY) area of the component's retained triangles. */
  area: number;
  /** Indices into the input triangle array, ascending. */
  triangles: number[];
}

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const meshBox = (points: ReadonlyArray<ComposeMeshPoint>): Box => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
};

const triangleBox = (view: ComposeMeshView, tri: ComposeMeshTriangle): Box => {
  const a = view.points[tri[0]]!;
  const b = view.points[tri[1]]!;
  const c = view.points[tri[2]]!;
  return {
    minX: Math.min(a.x, b.x, c.x),
    minY: Math.min(a.y, b.y, c.y),
    maxX: Math.max(a.x, b.x, c.x),
    maxY: Math.max(a.y, b.y, c.y),
  };
};

const boxesOverlapClosed = (a: Box, b: Box): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

const boxesSeparated = (a: Box, b: Box): boolean =>
  a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY;

/**
 * Candidate triangles whose indexed cells intersect the query box. Falls
 * back to every triangle when the query spans too many cells (degenerate
 * index granularity), never narrowing the candidate set.
 */
const candidatesInBox = (
  view: ComposeMeshView,
  box: Box,
): number[] => {
  if (view.triangles.length === 0) return [];
  if (view.cells.size === 0) return view.triangles.map((_, index) => index);
  const x0 = Math.floor((box.minX - view.minX) / view.cellSize);
  const x1 = Math.floor((box.maxX - view.minX) / view.cellSize);
  const y0 = Math.floor((box.minY - view.minY) / view.cellSize);
  const y1 = Math.floor((box.maxY - view.minY) / view.cellSize);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS_PER_QUERY) {
    return view.triangles.map((_, index) => index);
  }
  const seen = new Set<number>();
  const out: number[] = [];
  for (let ix = x0; ix <= x1; ix += 1) {
    for (let iy = y0; iy <= y1; iy += 1) {
      const list = view.cells.get(`${ix},${iy}`);
      if (!list) continue;
      for (const index of list) {
        if (!seen.has(index)) {
          seen.add(index);
          out.push(index);
        }
      }
    }
  }
  return out;
};

/** Polygon area of a clip result's local-frame ring. */
const polygonArea = (local: ReadonlyArray<number>): number => {
  const count = local.length / 2;
  let sum = 0;
  for (let i = 0; i < count; i += 1) {
    const j = (i + 1) % count;
    sum += local[i * 2]! * local[j * 2 + 1]! - local[j * 2]! * local[i * 2 + 1]!;
  }
  return Math.abs(sum) / 2;
};

const flatTriangle = (
  view: ComposeMeshView,
  tri: ComposeMeshTriangle,
): [number, number, number, number, number, number] => {
  const a = view.points[tri[0]]!;
  const b = view.points[tri[1]]!;
  const c = view.points[tri[2]]!;
  return [a.x, a.y, b.x, b.y, c.x, c.y];
};

/**
 * Exact coverage proof: every base retained triangle is fully covered by
 * overlay retained triangles. Each base triangle's overlap area is summed
 * over candidates (exact `orient2d` clipping); a single uncovered base
 * triangle — an overlay void, notch, or missing island — rejects.
 */
export const overlayCoversBase = (
  baseView: ComposeMeshView,
  overlayView: ComposeMeshView,
): boolean => {
  for (const tri of baseView.triangles) {
    const flat = flatTriangle(baseView, tri);
    const area = Math.abs(
      (flat[2] - flat[0]) * (flat[5] - flat[1]) - (flat[4] - flat[0]) * (flat[3] - flat[1]),
    ) / 2;
    if (area === 0) continue;
    const box = triangleBox(baseView, tri);
    let covered = 0;
    for (const candidate of candidatesInBox(overlayView, box)) {
      if (!boxesOverlapClosed(box, triangleBox(overlayView, overlayView.triangles[candidate]!))) continue;
      const clip = clipTrianglePair(flat, flatTriangle(overlayView, overlayView.triangles[candidate]!));
      if (clip) covered += polygonArea(clip.local);
    }
    if (covered + area * COVERAGE_REL_EPS < area) return false;
  }
  return true;
};

const provenanceStub = (base: ComposeSourceMesh, overlay: ComposeSourceMesh): ReturnType<typeof makeWebnetComposeProvenance> =>
  makeWebnetComposeProvenance({
    baseSurfaceId: base.surfaceId,
    baseSurfaceName: base.surfaceName,
    baseRevision: base.revision,
    overlaySurfaceId: overlay.surfaceId,
    overlaySurfaceName: overlay.surfaceName,
    overlayRevision: overlay.revision,
  });

/** Canonicalize + validate + digest, exactly like the 18Y tail. */
const finalizeCompose = (
  vertices: number[],
  faces: number[],
  base: ComposeSourceMesh,
  overlay: ComposeSourceMesh,
  diagnostics: Omit<ComposeDiagnostics, 'outputVertexCount' | 'outputTriangleCount'>,
): ComposeSuccess | null => {
  const canonical = canonicalizeBakedTin(vertices, faces);
  const stub = provenanceStub(base, overlay);
  if (validateExplicitTinPayload({ vertices: canonical.vertices, faces: canonical.faces, provenance: stub }) != null) {
    return null;
  }
  const digest = explicitTinTopologyDigest({
    vertices: canonical.vertices, faces: canonical.faces, provenance: stub,
  });
  const provenance = makeWebnetComposeProvenance({
    baseSurfaceId: base.surfaceId,
    baseSurfaceName: base.surfaceName,
    baseRevision: base.revision,
    overlaySurfaceId: overlay.surfaceId,
    overlaySurfaceName: overlay.surfaceName,
    overlayRevision: overlay.revision,
    resultDigest: digest,
  });
  return {
    ok: true,
    vertices: canonical.vertices,
    faces: canonical.faces,
    diagnostics: {
      ...diagnostics,
      outputVertexCount: canonical.vertices.length / 3,
      outputTriangleCount: canonical.faces.length / 3,
    },
    provenance,
    digest,
  };
};

/**
 * Full-overlay fast path: when overlay coverage contains the whole base
 * retained domain the composed surface is exactly the overlay surface
 * (overlay owns every cell; no base-only cell → no seam). Unproven → null.
 */
export const tryFullOverlayFastPath = (
  base: ComposeSourceMesh,
  overlay: ComposeSourceMesh,
  baseView: ComposeMeshView,
  overlayView: ComposeMeshView,
): ComposeSuccess | null => {
  if (baseView.triangles.length === 0 || overlayView.triangles.length === 0) return null;
  const baseArea = meshPlanimetricArea(baseView);
  const overlayArea = meshPlanimetricArea(overlayView);
  // Necessary bounds before the exact per-triangle proof.
  if (boxesSeparated(meshBox(overlay.points), meshBox(base.points))) return null;
  if (overlayArea + baseArea * COVERAGE_REL_EPS < baseArea) return null;
  if (!overlayCoversBase(baseView, overlayView)) return null;

  const vertices: number[] = [];
  for (const p of overlay.points) vertices.push(p.x, p.y, p.z);
  const faces = overlay.triangles
    .map((tri): [number, number, number] => [tri[0], tri[1], tri[2]])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const flatFaces: number[] = [];
  for (const face of faces) flatFaces.push(face[0], face[1], face[2]);
  return finalizeCompose(vertices, flatFaces, base, overlay, {
    baseOnlyArea: 0,
    overlayArea,
    overlapArea: baseArea,
    resultArea: overlayArea,
    seamLength: 0,
    maxSeamMismatch: 0,
  });
};

const orient = (a: ComposeMeshPoint, b: ComposeMeshPoint, p: ComposeMeshPoint): number =>
  orient2d(a.x, a.y, b.x, b.y, p.x, p.y);

/** Closed (boundary-inclusive) containment via exact orientation signs. */
const pointInTriangleClosed = (
  p: ComposeMeshPoint,
  t0: ComposeMeshPoint,
  t1: ComposeMeshPoint,
  t2: ComposeMeshPoint,
): boolean => {
  const d1 = orient(t0, t1, p);
  const d2 = orient(t1, t2, p);
  const d3 = orient(t2, t0, p);
  return (d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0);
};

const edgesProperlyCross = (
  a1: ComposeMeshPoint, a2: ComposeMeshPoint,
  b1: ComposeMeshPoint, b2: ComposeMeshPoint,
): boolean => {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0
    && ((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0));
};

/**
 * Exact closed-triangle intersection: shared vertices/edges, edge touches,
 * edge crossings, and area overlap all count. Complete for two triangles
 * (a boundary entry requires either a vertex inside or a proper crossing).
 */
const trianglesInteractClosed = (
  a: readonly [ComposeMeshPoint, ComposeMeshPoint, ComposeMeshPoint],
  b: readonly [ComposeMeshPoint, ComposeMeshPoint, ComposeMeshPoint],
): boolean => {
  for (const v of a) if (pointInTriangleClosed(v, b[0], b[1], b[2])) return true;
  for (const v of b) if (pointInTriangleClosed(v, a[0], a[1], a[2])) return true;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      if (edgesProperlyCross(a[i]!, a[(i + 1) % 3]!, b[j]!, b[(j + 1) % 3]!)) return true;
    }
  }
  return false;
};

const triPoints = (
  view: ComposeMeshView,
  tri: ComposeMeshTriangle,
): readonly [ComposeMeshPoint, ComposeMeshPoint, ComposeMeshPoint] =>
  [view.points[tri[0]]!, view.points[tri[1]]!, view.points[tri[2]]!];

/** True when any base triangle touches or overlaps any overlay triangle. */
const meshesInteractClosed = (baseView: ComposeMeshView, overlayView: ComposeMeshView): boolean => {
  for (const tri of baseView.triangles) {
    const box = triangleBox(baseView, tri);
    const pa = triPoints(baseView, tri);
    for (const candidate of candidatesInBox(overlayView, box)) {
      const obox = triangleBox(overlayView, overlayView.triangles[candidate]!);
      if (!boxesOverlapClosed(box, obox)) continue;
      if (trianglesInteractClosed(pa, triPoints(overlayView, overlayView.triangles[candidate]!))) {
        return true;
      }
    }
  }
  return false;
};

/**
 * Strictly-disjoint fast path: AABB separation accepts immediately; when
 * AABBs overlap, exact triangle predicates must prove no area overlap and
 * no edge/vertex touch. Any touch → null (the normal path owns the seam).
 */
export const tryStrictDisjointFastPath = (
  base: ComposeSourceMesh,
  overlay: ComposeSourceMesh,
): ComposeSuccess | null => {
  const baseView = createMeshView(base.points, base.triangles);
  const overlayView = createMeshView(overlay.points, overlay.triangles);
  if (baseView.triangles.length === 0 || overlayView.triangles.length === 0) return null;
  const baseBox = meshBox(base.points);
  const overlayBox = meshBox(overlay.points);
  if (!boxesSeparated(baseBox, overlayBox) && meshesInteractClosed(baseView, overlayView)) return null;

  // Concatenated topology, interned in the same base-then-overlay order the
  // PSLG uses, faces sorted like buildConstrainedTin so the canonical digest
  // matches the normal engine byte for byte.
  const indexOf = new Map<string, number>();
  const vertices: number[] = [];
  const intern = (p: ComposeMeshPoint): number => {
    const key = `${p.x},${p.y}`;
    const known = indexOf.get(key);
    if (known !== undefined) return known;
    const at = vertices.length / 3;
    vertices.push(p.x, p.y, p.z);
    indexOf.set(key, at);
    return at;
  };
  // Intern every point in base-then-overlay input order BEFORE mapping
  // faces, so vertex order never depends on triangle permutation (PSLG order).
  for (const p of base.points) intern(p);
  for (const p of overlay.points) intern(p);
  const mapFaces = (
    points: ReadonlyArray<ComposeMeshPoint>,
    triangles: ReadonlyArray<ComposeMeshTriangle>,
  ): number[][] =>
    triangles.map((tri) => [intern(points[tri[0]]!), intern(points[tri[1]]!), intern(points[tri[2]]!)]);
  const faces = [...mapFaces(base.points, base.triangles), ...mapFaces(overlay.points, overlay.triangles)]
    .sort((x, y) => x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!);
  const flatFaces: number[] = [];
  for (const face of faces) flatFaces.push(face[0]!, face[1]!, face[2]!);

  const baseArea = meshPlanimetricArea(baseView);
  const overlayArea = meshPlanimetricArea(overlayView);
  return finalizeCompose(vertices, flatFaces, base, overlay, {
    baseOnlyArea: baseArea,
    overlayArea,
    overlapArea: 0,
    resultArea: baseArea + overlayArea,
    seamLength: 0,
    maxSeamMismatch: 0,
  });
};

/**
 * Connected components of a retained TIN (edge adjacency). Islands, holes,
 * and voids surface as separate components; vertex-only contact stays
 * separate (exact mesh-edge connectivity). Deterministic: components are
 * ordered by smallest triangle index, triangle lists ascending.
 */
export const extractRetainedComponents = (
  points: ReadonlyArray<ComposeMeshPoint>,
  triangles: ReadonlyArray<ComposeMeshTriangle>,
  adjacency: ReadonlyArray<readonly [number, number, number]>,
): RetainedComponent[] => {
  const count = triangles.length;
  const parent = Array.from({ length: count }, (_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    while (parent[index] !== root) {
      const next = parent[index]!;
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (ra < rb) parent[rb] = ra;
    else parent[ra] = rb;
  };
  for (let t = 0; t < count; t += 1) {
    const neighbors = adjacency[t];
    if (!neighbors) continue;
    for (const n of neighbors) if (n >= 0 && n < count) union(t, n);
  }

  const byRoot = new Map<number, number[]>();
  const order: number[] = [];
  for (let t = 0; t < count; t += 1) {
    const root = find(t);
    const list = byRoot.get(root);
    if (list) list.push(t);
    else {
      byRoot.set(root, [t]);
      order.push(root);
    }
  }

  return order.map((root) => {
    const list = byRoot.get(root)!;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let area = 0;
    for (const t of list) {
      const a = points[triangles[t]![0]]!;
      const b = points[triangles[t]![1]]!;
      const c = points[triangles[t]![2]]!;
      if (a.x < minX) minX = a.x;
      if (b.x < minX) minX = b.x;
      if (c.x < minX) minX = c.x;
      if (a.y < minY) minY = a.y;
      if (b.y < minY) minY = b.y;
      if (c.y < minY) minY = c.y;
      if (a.x > maxX) maxX = a.x;
      if (b.x > maxX) maxX = b.x;
      if (c.x > maxX) maxX = c.x;
      if (a.y > maxY) maxY = a.y;
      if (b.y > maxY) maxY = b.y;
      if (c.y > maxY) maxY = c.y;
      area += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    }
    return { bbox: { minX, minY, maxX, maxY }, area, triangles: list };
  });
};
