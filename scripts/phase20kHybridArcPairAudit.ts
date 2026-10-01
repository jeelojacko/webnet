/**
 * Phase 20K — independent group-mesh topology audit (STUDY, evidence only).
 *
 * Extracted from `phase20kHybridArcPairGroups.ts` to keep both modules under
 * the repo file-size warning. Pure geometry/topology: no production routing,
 * no `src/` changes. The audit checks finite XYZ, indices, +plan area, no
 * duplicate triangle, no interior overlap (O(n²) plan intersection beyond
 * shared edges/vertices), edge incidence ≤ 2, component counts,
 * open-continuous / closed-simple daylight, no bridge/pinch, and
 * self-consistent plan area.
 */
import { zeroDelta } from '../src/engine/cad/surfaces/volume/zero';
import { ringIsSimple, type MergePoint, type MergedGroupMesh } from '../src/engine/cad/grading/gradingGroupMerge';

// §29 independent topology audit (beyond validateExplicitTinPayload).

export interface TopologyAudit {
  pass: boolean;
  checks: Record<string, boolean>;
  issues: string[];
  boundaryEdges: number;
  /** Vertex-connected triangle components (a chord-pinched strip is one). */
  components: number;
  /** Edge-connected triangle components (arc chord seams pinch this > 1). */
  edgeComponents: number;
  triangleCount: number;
  outerShellArea: number | null;
  meshArea: number;
  planAreaConsistent: boolean;
}

type XY = { x: number; y: number };

const polyArea = (poly: XY[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
};

/** Sutherland–Hodgman clip of a CCW polygon to the left of a→b. */
const clipToLeft = (poly: XY[], a: XY, b: XY): XY[] => {
  const inside = (p: XY): number => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  const out: XY[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = inside(p);
    const sq = inside(q);
    if (sp >= 0) out.push(p);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
    }
  }
  return out;
};

const triXY = (mesh: MergedGroupMesh, f: number): XY[] =>
  [0, 1, 2].map((k) => {
    const i = mesh.triangles[f * 3 + k]!;
    return { x: mesh.points[i * 3]!, y: mesh.points[i * 3 + 1]! };
  });

/** Plan intersection area of two CCW triangles (shared edge/vertex → 0). */
const triangleIntersectionArea = (a: XY[], b: XY[]): number => {
  let poly = a;
  for (let k = 0; k < 3 && poly.length > 0; k += 1) {
    poly = clipToLeft(poly, b[k]!, b[(k + 1) % 3]!);
  }
  return poly.length < 3 ? 0 : Math.abs(polyArea(poly));
};

/**
 * Independent topology audit: finite XYZ, valid indices, positive plan area,
 * no duplicate triangle, no interior overlap (O(n²) plan intersection beyond
 * shared edges/vertices), edge incidence ≤ 2, one edge-connected component
 * (vertex-connected alone masks the arc chord-seam pinch; edgeComponents > 1
 * fails buildability for open AND closed), open-continuous / closed-simple daylight, no
 * bridge/pinch, no self-crossing offset, and self-consistent plan area
 * (independently summed triangle plan area == the engine's reported shell
 * area when supplied; the outer daylight-ring shoelace is recorded as
 * `outerShellArea`).
 */
export const auditMesh = (
  mesh: MergedGroupMesh,
  daylight: MergePoint[],
  closed: boolean,
  expectedPlanArea?: number,
): TopologyAudit => {
  const issues: string[] = [];
  const checks: Record<string, boolean> = {};
  const nVerts = mesh.points.length / 3;
  const nTris = mesh.triangles.length / 3;
  checks.finite = mesh.points.every((v) => Number.isFinite(v));
  if (!checks.finite) issues.push('non-finite vertex');
  checks.indices = mesh.triangles.length % 3 === 0 &&
    mesh.triangles.every((i) => Number.isInteger(i) && i >= 0 && i < nVerts);
  if (!checks.indices) issues.push('bad index');
  checks.faces = nTris > 0;
  let positiveArea = true;
  let meshArea = 0;
  const seenFaces = new Set<string>();
  let duplicate = false;
  for (let f = 0; f < nTris; f += 1) {
    const tri = [mesh.triangles[f * 3]!, mesh.triangles[f * 3 + 1]!, mesh.triangles[f * 3 + 2]!];
    const [a, b, c] = triXY(mesh, f);
    const area2 = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if (!(area2 > 0)) positiveArea = false;
    meshArea += Math.abs(area2) / 2;
    const key = [...tri].sort((p, q) => p - q).join('|');
    if (seenFaces.has(key)) duplicate = true;
    seenFaces.add(key);
  }
  checks.positivePlanArea = positiveArea;
  if (!positiveArea) issues.push('non-positive triangle plan area');
  checks.noDuplicateTriangle = !duplicate;
  if (duplicate) issues.push('duplicate triangle');

  // Edge incidence + connectivity.
  const edgeCount = new Map<string, number>();
  const adj = new Map<number, Set<number>>();
  const addEdge = (i: number, j: number, f: number): void => {
    const key = i < j ? `${i}|${j}` : `${j}|${i}`;
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
    if (!adj.has(i)) adj.set(i, new Set());
    adj.get(i)!.add(f);
  };
  for (let f = 0; f < nTris; f += 1) {
    const tri = [mesh.triangles[f * 3]!, mesh.triangles[f * 3 + 1]!, mesh.triangles[f * 3 + 2]!];
    addEdge(tri[0]!, tri[1]!, f);
    addEdge(tri[1]!, tri[2]!, f);
    addEdge(tri[2]!, tri[0]!, f);
  }
  let boundaryEdges = 0;
  let maxIncidence = 0;
  for (const count of edgeCount.values()) {
    maxIncidence = Math.max(maxIncidence, count);
    if (count === 1) boundaryEdges += 1;
  }
  checks.edgeIncidence = maxIncidence <= 2;
  if (maxIncidence > 2) issues.push('non-manifold edge');

  // Components: vertex-connected (a chord-pinched strip is one sheet) and
  // edge-connected (arc chord seams pinch this above 1).
  const parent = new Map<number, number>();
  for (let f = 0; f < nTris; f += 1) parent.set(f, f);
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const edgeFaces = new Map<string, number[]>();
  const vertexFace = new Map<number, number>();
  for (let f = 0; f < nTris; f += 1) {
    const tri = [mesh.triangles[f * 3]!, mesh.triangles[f * 3 + 1]!, mesh.triangles[f * 3 + 2]!];
    for (const v of tri) {
      const prev = vertexFace.get(v);
      if (prev === undefined) vertexFace.set(v, f);
      else union(f, prev);
    }
    for (const [i, j] of [[tri[0]!, tri[1]!], [tri[1]!, tri[2]!], [tri[2]!, tri[0]!]] as Array<[number, number]>) {
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      if (!edgeFaces.has(key)) edgeFaces.set(key, []);
      edgeFaces.get(key)!.push(f);
    }
  }
  const vertexRoots = new Set<number>();
  for (let f = 0; f < nTris; f += 1) vertexRoots.add(find(f));
  const components = nTris === 0 ? 0 : vertexRoots.size;
  checks.oneComponent = components <= 1;
  if (components > 1) issues.push('multiple components');

  // Edge-connected components (informational + arc pinch detection).
  const eparent = new Map<number, number>();
  for (let f = 0; f < nTris; f += 1) eparent.set(f, f);
  const efind = (x: number): number => {
    let r = x;
    while (eparent.get(r) !== r) r = eparent.get(r)!;
    while (eparent.get(x) !== r) { const nx = eparent.get(x)!; eparent.set(x, r); x = nx; }
    return r;
  };
  for (const faces of edgeFaces.values()) {
    if (faces.length === 2) {
      const ra = efind(faces[0]!);
      const rb = efind(faces[1]!);
      if (ra !== rb) eparent.set(ra, rb);
    }
  }
  const edgeRoots = new Set<number>();
  for (let f = 0; f < nTris; f += 1) edgeRoots.add(efind(f));
  const edgeComponents = nTris === 0 ? 0 : edgeRoots.size;
  // Hard gate for open AND closed: a vertex-pinched mesh (edgeComponents > 1)
  // is not a 2-manifold usable surface even when the production validator
  // passes it (`validateGroupMesh` delegates to `validateExplicitTinPayload`,
  // which passes this vertex-pinched/edge-disconnected mesh — edge
  // connectivity is not enforced there).
  checks.edgeConnected = edgeComponents <= 1;
  if (edgeComponents > 1) issues.push('edge-disconnected mesh (vertex pinch)');

  // Interior overlap (O(n²) study meshes; production validator does not check this).
  let overlap = false;
  const areaTol = 1e-9;
  for (let f = 0; f < nTris && !overlap; f += 1) {
    const a = triXY(mesh, f);
    const limit = Math.max(1, meshArea / Math.max(1, nTris)) * areaTol;
    for (let g = f + 1; g < nTris; g += 1) {
      const area = triangleIntersectionArea(a, triXY(mesh, g));
      if (area > limit) { overlap = true; break; }
    }
  }
  checks.noInteriorOverlap = !overlap;
  if (overlap) issues.push('interior triangle overlap');

  // Daylight continuity (open) / simplicity (closed) and bridging.
  // Closed rings use the production predicate AND a local collinear-overlap
  // sweep: quantized orientations alone miss all-zero (collinear) overlap.
  const ring = closed ? daylight : daylight.slice();
  const ringSimple = closed ? closedRingSimple(ring) : !hasRepeatOrCrossing(ring);
  checks.daylight = closed ? ringSimple : daylightContinuous(daylight);
  if (closed && !ringSimple) issues.push('self-crossing closed ring');
  if (!closed && !daylightContinuous(daylight)) issues.push('discontinuous open daylight');
  checks.noBridge = closed ? ringSimple : daylightContinuous(daylight);
  if (!checks.noBridge) issues.push('bridge/pinch in daylight');

  const outerShellArea = closed && daylight.length >= 3 ? Math.abs(polyArea(daylight)) : null;
  const planAreaConsistent = expectedPlanArea === undefined
    ? true
    : Math.abs(meshArea - expectedPlanArea) <= 1e-6 * Math.max(1, expectedPlanArea);
  checks.planArea = planAreaConsistent;
  if (!planAreaConsistent) issues.push('mesh area != reported plan area');

  const pass = Object.values(checks).every(Boolean);
  return {
    pass, checks, issues,
    boundaryEdges, components, edgeComponents, triangleCount: nTris,
    outerShellArea, meshArea, planAreaConsistent,
  };
};

/** Open daylight is a single simple polyline (no repeated interior vertex). */
const daylightContinuous = (path: MergePoint[]): boolean => {
  if (path.length < 2) return false;
  const seen = new Set<string>();
  for (let i = 0; i < path.length; i += 1) {
    const p = path[i]!;
    const key = `${p.x}|${p.y}|${p.z}`;
    if (seen.has(key)) return false;
    seen.add(key);
  }
  for (let i = 0; i + 1 < path.length; i += 1) {
    for (let j = i + 2; j + 1 < path.length; j += 1) {
      if (segmentsCross(path[i]!, path[i + 1]!, path[j]!, path[j + 1]!)) return false;
    }
  }
  return true;
};

const hasRepeatOrCrossing = (path: MergePoint[]): boolean => !daylightContinuous(path);

/**
 * Robust orientation predicate: -1/0/+1 with the shared Phase 18I
 * `zeroDelta` floor (reused, no new tolerance). Matches the production
 * `segmentsCross` in `gradingGroupMerge.ts`.
 */
export const orient = (p: MergePoint, q: MergePoint, r: MergePoint): number => {
  const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (Math.abs(v) <= zeroDelta(v, 0)) return 0;
  return v > 0 ? 1 : -1;
};

/** True when r is collinear with pq and inside its bbox (zeroDelta-slop). */
const onSegment = (p: MergePoint, q: MergePoint, r: MergePoint): boolean =>
  r.x >= Math.min(p.x, q.x) - zeroDelta(r.x, Math.min(p.x, q.x)) &&
  r.x <= Math.max(p.x, q.x) + zeroDelta(r.x, Math.max(p.x, q.x)) &&
  r.y >= Math.min(p.y, q.y) - zeroDelta(r.y, Math.min(p.y, q.y)) &&
  r.y <= Math.max(p.y, q.y) + zeroDelta(r.y, Math.max(p.y, q.y));

/**
 * Segment intersection for audit purposes. General case (including a
 * non-adjacent shared endpoint, i.e. a pinch) counts; collinear overlap
 * and collinear touching also count as self-intersection. Adjacent daylight
 * segments sharing their expected endpoint do NOT count — the caller skips
 * adjacent pairs and never calls this for them.
 */
export const segmentsCross = (a: MergePoint, b: MergePoint, c: MergePoint, d: MergePoint): boolean => {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && onSegment(a, b, c)) ||
    (o2 === 0 && onSegment(a, b, d)) ||
    (o3 === 0 && onSegment(c, d, a)) ||
    (o4 === 0 && onSegment(c, d, b));
};

/**
 * Closed-ring simplicity: production `ringIsSimple` (general case, closing
 * edge included, adjacent pairs skipped) AND a local sweep with the
 * corrected predicate so non-adjacent collinear overlap/touching also fail.
 */
export const closedRingSimple = (ring: MergePoint[]): boolean => {
  if (!ringIsSimple(ring)) return false;
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!)) return false;
    }
  }
  return true;
};

/** Independent chord-offset shoelace check on the boundary polyline. */
export const shoelaceBoundary = (daylight: MergePoint[]): number =>
  daylight.length < 3 ? 0 : Math.abs(polyArea(daylight));

/** Index-vs-geometric topology diagnostic (evidence only, read-only). */
export interface GeometricDiagnostic {
  indexEdgeComponents: number;
  exactDuplicateSets: number[][];
  coincidentSets: number[][];
  coincidentNonSharedEdges: number;
  weldedEdgeComponents: number;
  weldedDegenerateTriangles: number;
  summary: string;
}

const sameVertex = (points: number[], i: number, j: number): boolean =>
  Math.abs(points[i * 3]! - points[j * 3]!) <= zeroDelta(points[i * 3]!, points[j * 3]!) &&
  Math.abs(points[i * 3 + 1]! - points[j * 3 + 1]!) <= zeroDelta(points[i * 3 + 1]!, points[j * 3 + 1]!) &&
  Math.abs(points[i * 3 + 2]! - points[j * 3 + 2]!) <= zeroDelta(points[i * 3 + 2]!, points[j * 3 + 2]!);

const edgeComponentsOf = (triangles: number[]): number => {
  const nTris = triangles.length / 3;
  if (nTris === 0) return 0;
  const parent = new Map<number, number>();
  for (let f = 0; f < nTris; f += 1) parent.set(f, f);
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; }
    return r;
  };
  const edgeFaces = new Map<string, number[]>();
  for (let f = 0; f < nTris; f += 1) {
    const tri = [triangles[f * 3]!, triangles[f * 3 + 1]!, triangles[f * 3 + 2]!];
    for (const [i, j] of [[tri[0]!, tri[1]!], [tri[1]!, tri[2]!], [tri[2]!, tri[0]!]] as Array<[number, number]>) {
      const key = i < j ? `${i}|${j}` : `${j}|${i}`;
      if (!edgeFaces.has(key)) edgeFaces.set(key, []);
      edgeFaces.get(key)!.push(f);
    }
  }
  for (const faces of edgeFaces.values()) {
    if (faces.length === 2) {
      const ra = find(faces[0]!);
      const rb = find(faces[1]!);
      if (ra !== rb) parent.set(ra, rb);
    }
  }
  const roots = new Set<number>();
  for (let f = 0; f < nTris; f += 1) roots.add(find(f));
  return roots.size;
};

/**
 * Index edge-components plus the geometric coincidence picture: exact
 * duplicate vertices, zeroDelta-coincident vertex sets, index edges that
 * coincide geometrically without sharing an index, and edge-components
 * before/after a diagnostic-only weld (degenerate-after-weld triangles
 * dropped, input untouched). All output sorted for determinism.
 */
export const geometricDiagnostic = (mesh: MergedGroupMesh): GeometricDiagnostic => {
  const nVerts = mesh.points.length / 3;
  const indexEdgeComponents = edgeComponentsOf(mesh.triangles);
  const exact = new Map<string, number[]>();
  for (let i = 0; i < nVerts; i += 1) {
    const key = `${mesh.points[i * 3]}|${mesh.points[i * 3 + 1]}|${mesh.points[i * 3 + 2]}`;
    if (!exact.has(key)) exact.set(key, []);
    exact.get(key)!.push(i);
  }
  const exactDuplicateSets = [...exact.values()].filter((s) => s.length > 1).sort((a, b) => a[0]! - b[0]!);
  const parent = new Map<number, number>();
  for (let i = 0; i < nVerts; i += 1) parent.set(i, i);
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) { const nx = parent.get(x)!; parent.set(x, r); x = nx; }
    return r;
  };
  // ponytail: O(n²) scan, study-size meshes only; spatial hash if reused at scale.
  for (let i = 0; i < nVerts; i += 1) {
    for (let j = i + 1; j < nVerts; j += 1) {
      if (sameVertex(mesh.points, i, j)) {
        const ri = find(i);
        const rj = find(j);
        if (ri !== rj) parent.set(ri, rj);
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < nVerts; i += 1) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(i);
  }
  const coincidentSets = [...groups.values()].filter((s) => s.length > 1)
    .map((s) => [...s].sort((a, b) => a - b)).sort((a, b) => a[0]! - b[0]!);
  const edges: Array<[number, number]> = [];
  for (let f = 0; f < mesh.triangles.length / 3; f += 1) {
    const tri = [mesh.triangles[f * 3]!, mesh.triangles[f * 3 + 1]!, mesh.triangles[f * 3 + 2]!];
    for (const [i, j] of [[tri[0]!, tri[1]!], [tri[1]!, tri[2]!], [tri[2]!, tri[0]!]] as Array<[number, number]>) {
      if (i !== j) edges.push(i < j ? [i, j] : [j, i]);
    }
  }
  const edgeGeom = (e: [number, number]): [number, number] => [find(e[0]!), find(e[1]!)];
  let coincidentNonSharedEdges = 0;
  for (let a = 0; a < edges.length; a += 1) {
    for (let b = a + 1; b < edges.length; b += 1) {
      const e = edges[a]!;
      const f = edges[b]!;
      if (e[0] === f[0] || e[0] === f[1] || e[1] === f[0] || e[1] === f[1]) continue;
      const ge = edgeGeom(e);
      const gf = edgeGeom(f);
      if ((ge[0] === gf[0] && ge[1] === gf[1]) || (ge[0] === gf[1] && ge[1] === gf[0])) coincidentNonSharedEdges += 1;
    }
  }
  const canon = (i: number): number => Math.min(...groups.get(find(i))!);
  const welded: number[] = [];
  let weldedDegenerateTriangles = 0;
  for (let f = 0; f < mesh.triangles.length / 3; f += 1) {
    const tri = [canon(mesh.triangles[f * 3]!), canon(mesh.triangles[f * 3 + 1]!), canon(mesh.triangles[f * 3 + 2]!)];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[2] === tri[0]) weldedDegenerateTriangles += 1;
    else welded.push(tri[0]!, tri[1]!, tri[2]!);
  }
  const weldedEdgeComponents = edgeComponentsOf(welded);
  const summary = `edgeComponents=${indexEdgeComponents} exactDupSets=${exactDuplicateSets.length} ` +
    `coincidentSets=${coincidentSets.length} nonSharedCoincidentEdges=${coincidentNonSharedEdges} ` +
    `weldedEdgeComponents=${weldedEdgeComponents} weldedDegenerate=${weldedDegenerateTriangles}`;
  return {
    indexEdgeComponents, exactDuplicateSets, coincidentSets, coincidentNonSharedEdges,
    weldedEdgeComponents, weldedDegenerateTriangles, summary,
  };
};

