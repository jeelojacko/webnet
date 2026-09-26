import { buildSurfaceGrid } from './cadSurfaceInterpolation';
import { computeSurfaceFaceStats } from './surfaceAnalysis';
import { describeEditForRevision } from './cadSurfaceEditDescribe';
import { fnv1a } from './cadRevisionHash';
import { buildTinTopology } from './tin/tinTopology';
import type { CadSurfaceGrid, CadSurfaceSourcePoint } from './cadSurfaces';
import type { CadSurfaceEdit, CadExplicitTinProvenance, ImportedTinPayload, WebnetBakeTinProvenance, WebnetComposeTinProvenance } from './cadTypes';
import type { TinAdjacency, TinEdgeKinds } from './tin/tinTypes';

/**
 * Phase 18L — imported-TIN materialization (engine only).
 *
 * An ImportedTinDefinition carries explicit file topology, so the mesh is
 * rebuilt WITHOUT Delaunay: vertices map 1:1 to source points, faces map
 * 1:1 to retained triangles. Adjacency/edge-flags/grid/stats derive through
 * the same contracts as native builds (so contours/elevation/slope/
 * profiles/volumes/sample-lines work unchanged), but the domain is exactly
 * the imported faces — never a convex hull — and outside-faces queries
 * return null via the face-indexed grid.
 */

export interface MaterializedImportedTin {
  points: CadSurfaceSourcePoint[];
  triangles: Array<[number, number, number]>;
  adjacency: TinAdjacency[];
  edgeKinds: TinEdgeKinds[];
  grid: CadSurfaceGrid;
}

/** Fail-closed payload check (re-run on reopen — no trust in stored arrays). */
export const validateExplicitTinPayload = (payload: ImportedTinPayload): string | null => {
  const { vertices, faces } = payload;
  if (!Array.isArray(vertices) || vertices.length % 3 !== 0 || vertices.length < 9) {
    return 'imported TIN needs ≥3 [x,y,z] vertices.';
  }
  if (vertices.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    return 'imported TIN vertices must be finite numbers.';
  }
  if (!Array.isArray(faces) || faces.length % 3 !== 0 || faces.length === 0) {
    return 'imported TIN needs ≥1 [a,b,c] face.';
  }
  const count = vertices.length / 3;
  for (let i = 0; i < faces.length; i += 3) {
    const [a, b, c] = [faces[i] as number, faces[i + 1] as number, faces[i + 2] as number];
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) {
      return `imported TIN face #${i / 3 + 1} has non-integer indices.`;
    }
    if (a < 0 || b < 0 || c < 0 || a >= count || b >= count || c >= count) {
      return `imported TIN face #${i / 3 + 1} references missing vertex.`;
    }
    if (a === b || b === c || c === a) {
      return `imported TIN face #${i / 3 + 1} is degenerate.`;
    }
    const ax = vertices[a * 3] as number;
    const ay = vertices[a * 3 + 1] as number;
    const bx = vertices[b * 3] as number;
    const by = vertices[b * 3 + 1] as number;
    const cx = vertices[c * 3] as number;
    const cy = vertices[c * 3 + 1] as number;
    if (!((bx - ax) * (cy - ay) - (cx - ax) * (by - ay) > 0)) {
      return `imported TIN face #${i / 3 + 1} is not CCW / has zero XY area.`;
    }
  }
  return null;
};

/**
 * Phase 18L validator preserved verbatim (no weakened rules): delegates to
 * the shared explicit-topology seam so both kinds validate identically.
 */
export const validateImportedTinPayload = (payload: ImportedTinPayload): string | null =>
  validateExplicitTinPayload(payload);

/** Phase 18X provenance kind: legacy (kind omitted + format 'LandXML') reads as landxml-import. */
export const tinProvenanceKind = (
  provenance: CadExplicitTinProvenance,
): 'landxml-import' | 'webnet-bake' | 'webnet-compose' => {
  if (provenance.kind === 'webnet-compose') return 'webnet-compose';
  return provenance.kind === 'webnet-bake' || provenance.format === 'explicit'
    ? 'webnet-bake'
    : 'landxml-import';
}

/** Canonical normalized provenance (read-tolerant in, strict out). */
export const normalizeTinProvenance = (
  provenance: CadExplicitTinProvenance,
):
  | { kind: 'landxml-import'; format: 'LandXML'; fileName: string; surfaceName: string; sourceId?: string }
  | { kind: 'webnet-bake'; sourceSurfaceId: string; sourceSurfaceName: string; sourceRevision: string; sourceSourceKind?: string }
  | { kind: 'webnet-compose'; baseSurfaceId: string; baseSurfaceName: string; baseRevision: string; overlaySurfaceId: string; overlaySurfaceName: string; overlayRevision: string; policy: 'overlay-coverage-wins'; resultDigest?: string } => {
  if (tinProvenanceKind(provenance) === 'webnet-compose') {
    const composed = provenance as WebnetComposeTinProvenance;
    return {
      kind: 'webnet-compose',
      baseSurfaceId: composed.baseSurfaceId,
      baseSurfaceName: composed.baseSurfaceName,
      baseRevision: composed.baseRevision,
      overlaySurfaceId: composed.overlaySurfaceId,
      overlaySurfaceName: composed.overlaySurfaceName,
      overlayRevision: composed.overlayRevision,
      policy: 'overlay-coverage-wins',
      ...(composed.resultDigest != null ? { resultDigest: composed.resultDigest } : {}),
    };
  }
  if (tinProvenanceKind(provenance) === 'webnet-bake') {
    const baked = provenance as WebnetBakeTinProvenance & { format?: string };
    return {
      kind: 'webnet-bake',
      sourceSurfaceId: baked.sourceSurfaceId ?? baked.sourceId ?? '',
      sourceSurfaceName: baked.sourceSurfaceName ?? baked.surfaceName ?? '',
      sourceRevision: baked.sourceRevision ?? '',
      ...(baked.sourceSourceKind != null ? { sourceSourceKind: baked.sourceSourceKind } : {}),
    };
  }
  const landxml = provenance as Extract<CadExplicitTinProvenance, { format: 'LandXML' }>;
  return {
    kind: 'landxml-import',
    format: 'LandXML',
    fileName: landxml.fileName,
    surfaceName: landxml.surfaceName,
    ...(landxml.sourceId != null ? { sourceId: landxml.sourceId } : {}),
  };
};

/**
 * Phase 18X bake-provenance builder (owned by 18x-bake transactions):
 * always the strict kind:'webnet-bake' shape, never format:'LandXML'.
 */
export const makeWebnetBakeProvenance = (options: {
  sourceSurfaceId: string;
  sourceSurfaceName: string;
  sourceRevision: string;
  sourceSourceKind?: string;
}): WebnetBakeTinProvenance => ({
  kind: 'webnet-bake',
  sourceSurfaceId: options.sourceSurfaceId,
  sourceSurfaceName: options.sourceSurfaceName,
  sourceRevision: options.sourceRevision,
  ...(options.sourceSourceKind != null ? { sourceSourceKind: options.sourceSourceKind } : {}),
});

/**
 * Phase 18Y compose-provenance builder (owned by compose transactions):
 * always the strict kind:'webnet-compose' shape. resultDigest fills in
 * once the composed payload digest is known (revision part namespaces it).
 */
export const makeWebnetComposeProvenance = (options: {
  baseSurfaceId: string;
  baseSurfaceName: string;
  baseRevision: string;
  overlaySurfaceId: string;
  overlaySurfaceName: string;
  overlayRevision: string;
  resultDigest?: string;
}): WebnetComposeTinProvenance => ({
  kind: 'webnet-compose',
  baseSurfaceId: options.baseSurfaceId,
  baseSurfaceName: options.baseSurfaceName,
  baseRevision: options.baseRevision,
  overlaySurfaceId: options.overlaySurfaceId,
  overlaySurfaceName: options.overlaySurfaceName,
  overlayRevision: options.overlayRevision,
  policy: 'overlay-coverage-wins',
  ...(options.resultDigest != null ? { resultDigest: options.resultDigest } : {}),
});

/**
 * Provenance revision part: LandXML serializes the legacy
 * `format|fileName|surfaceName|sourceId` (byte-identical inputs — LandXML
 * construction sites write no `kind`); baked serializes its own namespace;
 * composed serializes `webnet-compose|baseId|baseRev|overlayId|overlayRev|digest`.
 * The `srev1:imported:` prefix stays frozen for all kinds.
 */
export const tinProvenanceRevisionPart = (provenance: CadExplicitTinProvenance): string => {
  const normalized = normalizeTinProvenance(provenance);
  if (normalized.kind === 'webnet-compose') {
    return `webnet-compose|${normalized.baseSurfaceId}|${normalized.baseRevision}|${normalized.overlaySurfaceId}|${normalized.overlayRevision}|${normalized.resultDigest ?? ''}`;
  }
  return normalized.kind === 'webnet-bake'
    ? `webnet-bake|${normalized.sourceSurfaceId}|${normalized.sourceSurfaceName}|${normalized.sourceRevision}|${normalized.sourceSourceKind ?? ''}`
    : `${normalized.format}|${normalized.fileName}|${normalized.surfaceName}|${normalized.sourceId ?? ''}`;
};

/** Content revision: vertices + faces + provenance (never entity state). Phase 18S adds the edit stack. */
export const importedTinRevision = (
  surfaceId: string,
  payload: ImportedTinPayload,
  edits?: CadSurfaceEdit[],
): string => {
  const parts = [
    `id:${surfaceId}`,
    `v:${payload.vertices.join(',')}`,
    `f:${payload.faces.join(',')}`,
    `prov:${tinProvenanceRevisionPart(payload.provenance)}`,
    `edits:${(edits ?? []).map(describeEditForRevision).join('|')}`,
  ];
  return `srev1:imported:${fnv1a(parts.join('#'))}`;
};

/**
 * Materialize the validated mesh. Returns null on invalid payload (caller
 * maps to blocked/FAILED — never a partial mesh). No Delaunay, no hull:
 * every imported face is retained exactly once.
 */
export const materializeExplicitTin = (
  surfaceId: string,
  payload: ImportedTinPayload,
): (MaterializedImportedTin & { stats: ReturnType<typeof computeSurfaceFaceStats> }) | null => {
  if (validateExplicitTinPayload(payload) != null) return null;
  const points: CadSurfaceSourcePoint[] = [];
  for (let i = 0; i < payload.vertices.length; i += 3) {
    points.push({
      entityId: `${surfaceId}:v${i / 3}`,
      x: payload.vertices[i] as number,
      y: payload.vertices[i + 1] as number,
      z: payload.vertices[i + 2] as number,
    });
  }
  const triangles: Array<[number, number, number]> = [];
  for (let i = 0; i < payload.faces.length; i += 3) {
    triangles.push([payload.faces[i] as number, payload.faces[i + 1] as number, payload.faces[i + 2] as number]);
  }
  // No constrained edges on the import path (topology already encodes
  // breaklines/boundaries/voids as faces) — all flags stay FREE and the
  // exterior is simply adjacency -1.
  const { adjacency, edgeKinds } = buildTinTopology(
    triangles.map(([a, b, c]) => ({ a, b, c })),
    new Map(),
  );
  return {
    points,
    triangles,
    adjacency,
    edgeKinds,
    grid: buildSurfaceGrid(points, triangles),
    stats: computeSurfaceFaceStats(points, triangles),
  };
};

/**
 * Phase 18L materializer preserved verbatim: delegates to the shared
 * explicit-topology seam (1:1 vertices/faces, no Delaunay, no hull).
 */
export const materializeImportedTin = (
  surfaceId: string,
  payload: ImportedTinPayload,
): (MaterializedImportedTin & { stats: ReturnType<typeof computeSurfaceFaceStats> }) | null =>
  materializeExplicitTin(surfaceId, payload);

/**
 * Phase 18X deterministic explicit-topology digest: canonical exact-double
 * XYZ + face-index hash (FNV-1a). Provenance excluded — same mesh baked
 * from any source digests identically.
 */
export const explicitTinTopologyDigest = (payload: ImportedTinPayload): string =>
  `etin1:${fnv1a(`v:${payload.vertices.join(',')}#f:${payload.faces.join(',')}`)}`;
