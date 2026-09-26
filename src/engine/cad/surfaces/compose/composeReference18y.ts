/**
 * Frozen Phase 18Y reference oracle for 18Z parity — do not optimize.
 *
 * Self-contained copy of the composeSurfaceMeshes orchestration in
 * src/engine/cad/surfaceCompose.ts (:120-291) plus its private
 * toAdjacency/mismatch helpers. Shared pure kernels (pslg, coverage,
 * tin/*, bake/provenance/zero) are imported, not copied.
 *
 * Exempt from the small-file guideline: frozen oracle, changes only by
 * deliberate 18Z parity decision.
 */
import { buildConstrainedTin } from '../../tin/tinBuild';
import { buildTinTopology } from '../../tin/tinTopology';
import { canonicalizeBakedTin } from '../../cadExplicitBake';
import {
  explicitTinTopologyDigest,
  makeWebnetComposeProvenance,
  validateExplicitTinPayload,
} from '../../cadImportedTin';
import { zeroDelta } from '../volume/zero';
import { createMeshView, locateInMesh, meshPlanimetricArea } from './coverage';
import type { ComposeMeshTriangle } from './coverage';
import { buildComposePslg, extractBoundaryEdges } from './pslg';
import type {
  ComposePolicy,
  ComposeResult,
  ComposeSeamMismatch,
  ComposeSourceMesh,
} from '../../surfaceCompose';

const toAdjacency = (
  triangles: ReadonlyArray<ComposeMeshTriangle>,
  adjacency: ReadonlyArray<readonly [number, number, number]> | undefined,
): Array<[number, number, number]> => {
  if (adjacency && adjacency.length === triangles.length) {
    return adjacency.map(([a, b, c]) => [a, b, c]);
  }
  const { adjacency: derived } = buildTinTopology(
    triangles.map(([a, b, c]) => ({ a, b, c })),
    new Map(),
  );
  return derived.map(([a, b, c]) => [a, b, c]);
};

const mismatch = (
  maxMismatch: number, x: number, y: number, baseZ: number, overlayZ: number,
): ComposeSeamMismatch => ({
  ok: false, reason: 'SURFACE_COMPOSE_SEAM_Z_MISMATCH', maxMismatch, x, y, baseZ, overlayZ,
});

/** Frozen 18Y orchestration: exact copy of composeSurfaceMeshes. */
export const composeSurfaceMeshesReference = (
  base: ComposeSourceMesh,
  overlay: ComposeSourceMesh,
  policy: ComposePolicy = 'overlay-coverage-wins',
): ComposeResult => {
  if (policy !== 'overlay-coverage-wins' || base.surfaceId === overlay.surfaceId) {
    return { ok: false, reason: 'SURFACE_COMPOSE_SAME_SOURCE' };
  }
  if (base.triangles.length === 0 || overlay.triangles.length === 0) {
    return { ok: false, reason: 'SURFACE_COMPOSE_EMPTY_SOURCE' };
  }
  const baseView = createMeshView(base.points, base.triangles);
  const overlayView = createMeshView(overlay.points, overlay.triangles);

  const overlayAdj = toAdjacency(overlay.triangles, overlay.adjacency);
  const boundary = extractBoundaryEdges(overlay.triangles, overlayAdj);
  const pslg = buildComposePslg(base.points, base.triangles, overlay.points, overlay.triangles, boundary);

  const built = buildConstrainedTin({
    points: pslg.points,
    segments: pslg.segments,
    outers: [],
    voids: [],
    surfaceId: 'compose',
  });
  if (!built.ok) return { ok: false, reason: 'SURFACE_COMPOSE_CONSTRAINT_FAILED' };

  type Owner = 'overlay' | 'base' | 'drop';
  const owners: Owner[] = built.triangles.map(([a, b, c]) => {
    const cx = (built.points[a]!.x + built.points[b]!.x + built.points[c]!.x) / 3;
    const cy = (built.points[a]!.y + built.points[b]!.y + built.points[c]!.y) / 3;
    if (locateInMesh(overlayView, cx, cy) != null) return 'overlay';
    if (locateInMesh(baseView, cx, cy) != null) return 'base';
    return 'drop';
  });

  const seenSeam = new Set<string>();
  let seamLength = 0;
  let maxSeamMismatch = 0;
  let worst = { x: 0, y: 0, baseZ: 0, overlayZ: 0 };
  const probe = (x: number, y: number): ComposeSeamMismatch | null => {
    const zo = locateInMesh(overlayView, x, y);
    const zb = locateInMesh(baseView, x, y);
    if (!zo || !zb) return null;
    const raw = Math.abs(zo.z - zb.z);
    const d = raw <= zeroDelta(zb.z, zo.z) ? 0 : raw;
    if (d > maxSeamMismatch) {
      maxSeamMismatch = d;
      worst = { x, y, baseZ: zb.z, overlayZ: zo.z };
    }
    return null;
  };
  built.triangles.forEach((tri, t) => {
    for (let k = 0; k < 3; k += 1) {
      const n = built.adjacency[t]![k]!;
      if (n < 0 || n <= t) continue;
      const pair = [owners[t], owners[n]].sort().join('|');
      if (pair !== 'base|overlay') continue;
      const p = built.points[tri[(k + 1) % 3]!]!;
      const q = built.points[tri[(k + 2) % 3]!]!;
      const key = `${Math.min(p.x, q.x)},${Math.min(p.y, q.y)}|${Math.max(p.x, q.x)},${Math.max(p.y, q.y)}`;
      if (seenSeam.has(key)) continue;
      seenSeam.add(key);
      seamLength += Math.hypot(q.x - p.x, q.y - p.y);
      probe(p.x, p.y);
      probe(q.x, q.y);
      probe((p.x + q.x) / 2, (p.y + q.y) / 2);
    }
  });
  if (maxSeamMismatch > 0) {
    return mismatch(maxSeamMismatch, worst.x, worst.y, worst.baseZ, worst.overlayZ);
  }

  const zOf: Array<number | null> = built.points.map(() => null);
  for (let i = 0; i < built.points.length; i += 1) {
    const p = built.points[i]!;
    const zo = locateInMesh(overlayView, p.x, p.y);
    if (zo) {
      zOf[i] = zo.z;
      continue;
    }
    const zb = locateInMesh(baseView, p.x, p.y);
    zOf[i] = zb ? zb.z : null;
  }
  const usedBy: Array<'overlay' | 'base' | null> = built.points.map(() => null);
  built.triangles.forEach((tri, t) => {
    const owner = owners[t];
    if (owner === 'drop') return;
    for (const v of tri) usedBy[v] = usedBy[v] === 'base' || owner === 'base' ? 'base' : 'overlay';
  });
  for (let i = 0; i < built.points.length; i += 1) {
    if (!usedBy[i]) continue;
    const p = built.points[i]!;
    if (zOf[i] == null) return { ok: false, reason: 'SURFACE_COMPOSE_CONSTRAINT_FAILED' };
    if (usedBy[i] === 'base') {
      const zb = locateInMesh(baseView, p.x, p.y);
      if (!zb) return { ok: false, reason: 'SURFACE_COMPOSE_CONSTRAINT_FAILED' };
      const raw = Math.abs(zOf[i]! - zb.z);
      if (raw > zeroDelta(zb.z, zOf[i]!)) {
        return mismatch(raw, p.x, p.y, zb.z, zOf[i]!);
      }
    }
  }

  const kept = built.triangles.filter((_, t) => owners[t] !== 'drop');
  const vertices: number[] = [];
  built.points.forEach((p, i) => vertices.push(p.x, p.y, zOf[i] ?? 0));
  const faces: number[] = [];
  let resultArea = 0;
  for (const [a, b, c] of kept) {
    faces.push(a, b, c);
    const p = built.points[a]!;
    const q = built.points[b]!;
    const r = built.points[c]!;
    resultArea += Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
  }
  const canonical = canonicalizeBakedTin(vertices, faces);
  const stubProvenance = makeWebnetComposeProvenance({
    baseSurfaceId: base.surfaceId,
    baseSurfaceName: base.surfaceName,
    baseRevision: base.revision,
    overlaySurfaceId: overlay.surfaceId,
    overlaySurfaceName: overlay.surfaceName,
    overlayRevision: overlay.revision,
  });
  if (validateExplicitTinPayload({ vertices: canonical.vertices, faces: canonical.faces, provenance: stubProvenance }) != null) {
    return { ok: false, reason: 'SURFACE_COMPOSE_CONSTRAINT_FAILED' };
  }
  const digest = explicitTinTopologyDigest({
    vertices: canonical.vertices, faces: canonical.faces, provenance: stubProvenance,
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

  const overlayArea = meshPlanimetricArea(overlayView);
  const baseArea = meshPlanimetricArea(baseView);
  return {
    ok: true,
    vertices: canonical.vertices,
    faces: canonical.faces,
    diagnostics: {
      baseOnlyArea: resultArea - overlayArea,
      overlayArea,
      overlapArea: baseArea + overlayArea - resultArea,
      resultArea,
      seamLength,
      maxSeamMismatch,
      outputVertexCount: canonical.vertices.length / 3,
      outputTriangleCount: canonical.faces.length / 3,
    },
    provenance,
    digest,
  };
};
