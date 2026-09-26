/**
 * Phase 18Y — exact two-surface composition engine (pure, worker-safe).
 *
 * Hard XY ownership partition under the single policy
 * 'overlay-coverage-wins': every output face has exactly one owner, Z comes
 * from that owner's plane, no blending/rasterization. Pipeline:
 *
 *   boundary extraction → PSLG → buildConstrainedTin retriangulation
 *     → centroid ownership → seam Z gate → owner-plane Z → canonical output
 *
 * No new triangulator: retriangulation reuses buildTinBase /
 * recoverConstrainedEdges / legalizeTin / buildTinTopology through
 * buildConstrainedTin (domain filter disabled — ownership classifies cells,
 * so islands/holes/voids need no ring bookkeeping). Inputs are never
 * mutated; no project state is touched.
 *
 * Seam epsilon policy (numerical only, zeroDelta precedent from
 * surfaces/volume/zero.ts): two evaluations of structurally identical
 * planes can differ by a few ulps of |Z| (plane fit + barycentric rounding
 * after local-frame conditioning), so a probe delta at or below
 * `4·ε·max(1, |zBase|, |zOverlay|)` snaps to exactly 0. At |Z| ≈ 100 m the
 * threshold is ≈ 9e-14 m — orders of magnitude below survey noise — so it
 * cannot hide real earthwork. There is no user tolerance and no invented Z:
 * anything above the numerical floor fails closed with
 * SURFACE_COMPOSE_SEAM_Z_MISMATCH.
 */
import { buildConstrainedTin } from './tin/tinBuild';
import { buildTinTopology } from './tin/tinTopology';
import { canonicalizeBakedTin } from './cadExplicitBake';
import {
  explicitTinTopologyDigest,
  makeWebnetComposeProvenance,
  validateExplicitTinPayload,
} from './cadImportedTin';
import type { WebnetComposeTinProvenance } from './cadTypes';
import { zeroDelta } from './surfaces/volume/zero';
import { createMeshView, locateInMesh, meshPlanimetricArea } from './surfaces/compose/coverage';
import type { ComposeMeshPoint, ComposeMeshTriangle } from './surfaces/compose/coverage';
import { buildComposePslg, extractBoundaryEdges } from './surfaces/compose/pslg';

/** The only supported ownership rule (recorded verbatim in provenance). */
export type ComposePolicy = 'overlay-coverage-wins';

export interface ComposeSourceMesh {
  surfaceId: string;
  surfaceName: string;
  revision: string;
  points: ReadonlyArray<ComposeMeshPoint>;
  triangles: ReadonlyArray<ComposeMeshTriangle>;
  /** Retained-TIN adjacency (derived via buildTinTopology when absent). */
  adjacency?: ReadonlyArray<readonly [number, number, number]>;
}

export interface ComposeDiagnostics {
  baseOnlyArea: number;
  overlayArea: number;
  overlapArea: number;
  resultArea: number;
  seamLength: number;
  maxSeamMismatch: number;
  outputVertexCount: number;
  outputTriangleCount: number;
}

export interface ComposeSuccess {
  ok: true;
  /** Flat [x,y,z,...] (exact owner-plane doubles, CCW faces). */
  vertices: number[];
  faces: number[];
  diagnostics: ComposeDiagnostics;
  provenance: WebnetComposeTinProvenance;
  digest: string;
}

export interface ComposeSeamMismatch {
  ok: false;
  reason: 'SURFACE_COMPOSE_SEAM_Z_MISMATCH';
  maxMismatch: number;
  x: number;
  y: number;
  baseZ: number;
  overlayZ: number;
}

export interface ComposeRejected {
  ok: false;
  reason:
    | 'SURFACE_COMPOSE_SAME_SOURCE'
    | 'SURFACE_COMPOSE_EMPTY_SOURCE'
    | 'SURFACE_COMPOSE_CONSTRAINT_FAILED';
}

export type ComposeResult = ComposeSuccess | ComposeSeamMismatch | ComposeRejected;

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

/**
 * Compose two CURRENT final meshes. Overlay coverage wins every owned
 * face; shared seam vertices take the overlay value after the Z gate
 * proves base/overlay agreement within the numerical floor.
 */
export const composeSurfaceMeshes = (
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

  // Cell ownership: robust interior point (centroid) → overlay wins, else
  // base, else exterior (dropped). Constraints guarantee no cell straddles
  // the overlay boundary, so the centroid is strictly on one side.
  type Owner = 'overlay' | 'base' | 'drop';
  const owners: Owner[] = built.triangles.map(([a, b, c]) => {
    const cx = (built.points[a]!.x + built.points[b]!.x + built.points[c]!.x) / 3;
    const cy = (built.points[a]!.y + built.points[b]!.y + built.points[c]!.y) / 3;
    if (locateInMesh(overlayView, cx, cy) != null) return 'overlay';
    if (locateInMesh(baseView, cx, cy) != null) return 'base';
    return 'drop';
  });

  // True seam: mesh edges with a retained overlay-owned cell on one side
  // and a base-owned cell on the other. Probes at endpoints + edge
  // midpoint through both owner planes; deltas within the numerical floor
  // snap to 0, anything above fails closed.
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

  // Z assignment from owning planes (seam vertices take overlay after the
  // gate). Fail-closed pinch check: any vertex claimed by a base-owned
  // cell must agree with the base plane within the floor — a touch point
  // where overlay and base disagree is a step, not a seam, and blocks.
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
