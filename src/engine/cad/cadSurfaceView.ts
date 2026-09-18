import type { CachedSurfaceMesh, CadSurfaceCache } from './cadSurfaceCache';
import type { CadSurfaceDisplayLayer } from './cadDisplayTypes';
import { computeCadSurfaceSourceRevision, deriveSurfaceStatus } from './cadSurfaces';
import { backfillCadSurfaceStyles } from './cadSurfaceStyles';
import { resolveSurfaceLayerId as resolveDefaultSurfaceLayerId } from './cadSurfaceTypes';
import type { CadProject, CadSurface, CadSurfaceStatus } from './cadTypes';
import { surfacePointGroupIds } from './cadTypes';

/**
 * Phase 18F UI — surface display adapter (UI-owned, pure).
 *
 * Consumes the converged contracts: definitions in `cadTypes`, builds in
 * `cadSurfaces`, the session mesh cache in `cadSurfaceCache`, styles in
 * `cadSurfaceStyles`. This module only adapts drawing state into
 * viewport-ready derived data:
 * - TIN triangles render as DERIVED path data, never as entity rows.
 * - One SVG path per surface component (triangles/boundary/vertices bucket).
 * - Shared interior edges are deduped (drawn once); boundary = edges used
 *   exactly once (outer ring + void holes alike).
 *
 * STALE POLICY (documented choice): a surface whose definition changed
 * since its last successful build keeps the old mesh visible with
 * `stale: true` (dashed stroke + "STALE" badge at render time) and is NEVER
 * labeled Current. Meshes never persist, so after save/reopen there is no
 * stale mesh — the surface reads NEEDS_REBUILD/UNBUILT until rebuilt.
 */

export type SurfaceStatusText =
  | 'Current'
  | 'Needs Rebuild'
  | 'Building'
  | 'Failed'
  | 'Broken Reference'
  | 'Unbuilt'
  | 'Insufficient Data';

export const surfaceStatusText = (status: CadSurfaceStatus): SurfaceStatusText => {
  switch (status) {
    case 'CURRENT': return 'Current';
    case 'NEEDS_REBUILD': return 'Needs Rebuild';
    case 'BUILDING': return 'Building';
    case 'FAILED': return 'Failed';
    case 'BROKEN_REFERENCE': return 'Broken Reference';
    case 'UNBUILT': return 'Unbuilt';
    case 'INSUFFICIENT_DATA': return 'Insufficient Data';
  }
};

export interface SurfaceRefHealth {
  brokenIds: string[];
  brokenNames: string[];
}

/**
 * UI-side broken-reference listing for display (the engine reports only the
 * status, not the ids). Compares definition refs against the live project;
 * `group:`, `point:`, `breakline:`, `boundary:` match the engine's own
 * broken-ref vocabulary.
 */
export const findSurfaceBrokenRefs = (
  project: CadProject,
  surface: CadSurface,
): SurfaceRefHealth => {
  const brokenIds: string[] = [];
  const brokenNames: string[] = [];
  const push = (id: string, name: string): void => {
    if (!brokenIds.includes(id)) {
      brokenIds.push(id);
      brokenNames.push(name);
    }
  };
  const pointIds = new Set(
    project.entities
      .filter((entity) => entity.type === 'survey-point')
      .map((entity) => entity.id),
  );
  const stationOf = new Map(
    project.entities
      .filter((entity) => entity.type === 'survey-point')
      .map((entity) => [entity.id, entity.stationId] as const),
  );
  const source = surface.definition.pointSource;
  if (source.kind === 'point-group') {
    for (const id of surfacePointGroupIds(source)) {
      if (!(project.pointGroups ?? []).some((entry) => entry.id === id)) push(`group:${id}`, id);
    }
  } else {
    for (const id of source.pointEntityIds) {
      if (!pointIds.has(id)) push(`point:${id}`, stationOf.get(id) ?? id);
    }
  }
  for (const breakline of surface.definition.breaklines ?? []) {
    const source = breakline.source;
    if (source.kind === 'point-chain') {
      for (const id of source.pointEntityIds) {
        if (!pointIds.has(id)) push(`point:${id}`, stationOf.get(id) ?? id);
      }
    } else if (!project.entities.some((entity) => entity.id === source.entityId)) {
      push(`breakline:${source.entityId}`, breakline.name ?? source.entityId);
    }
  }
  for (const boundary of surface.definition.boundaries ?? []) {
    if (!project.entities.some((entity) => entity.id === boundary.sourceEntityId)) {
      push(`boundary:${boundary.sourceEntityId}`, boundary.sourceEntityId);
    }
  }
  return { brokenIds, brokenNames };
};

export interface SurfaceDisplayStatus {
  status: CadSurfaceStatus;
  statusText: SurfaceStatusText;
  stale: boolean;
  brokenIds: string[];
  brokenNames: string[];
}

/**
 * Session truth for status: a cache hit for the CURRENT content revision
 * means Current (the mesh on screen matches the definition); otherwise the
 * engine derivation rules, except a persisted CURRENT without a session
 * mesh degrades honestly to NEEDS_REBUILD (mesh never persists).
 */
export const resolveSurfaceDisplayStatus = (
  project: CadProject,
  surface: CadSurface,
  hasFreshMesh: boolean,
  hasStaleMesh = false,
): SurfaceDisplayStatus => {
  const broken = findSurfaceBrokenRefs(project, surface);
  if (broken.brokenIds.length > 0) {
    return {
      status: 'BROKEN_REFERENCE',
      statusText: surfaceStatusText('BROKEN_REFERENCE'),
      stale: true,
      brokenIds: broken.brokenIds,
      brokenNames: broken.brokenNames,
    };
  }
  if (hasFreshMesh) {
    return {
      status: 'CURRENT',
      statusText: surfaceStatusText('CURRENT'),
      stale: false,
      brokenIds: [],
      brokenNames: [],
    };
  }
  const derived = deriveSurfaceStatus(project, surface);
  // A persisted CURRENT without a session mesh, or an UNBUILT definition
  // with a superseded session mesh, both degrade honestly to NEEDS_REBUILD
  // (the mesh never persists, and cachedRevision is never written
  // in-session, so the engine derivation alone cannot see the staleness).
  const status = derived === 'CURRENT' || (derived === 'UNBUILT' && hasStaleMesh)
    ? 'NEEDS_REBUILD'
    : derived;
  return {
    status,
    statusText: surfaceStatusText(status),
    stale: status === 'NEEDS_REBUILD' || status === 'FAILED',
    brokenIds: [],
    brokenNames: [],
  };
};

/** Content revision this session built (cache key); pure engine helper. */
export const surfaceContentRevision = (
  project: CadProject,
  surface: CadSurface,
): string => computeCadSurfaceSourceRevision(project, surface);

/**
 * Elevation at a plan point from a cached mesh via full-scan barycentric
 * interpolation. Null when outside every triangle (caller reports
 * "No surface elevation at point"). No geometry is created.
 * ponytail: full O(n) scan; reuse the engine grid index when inquiry
 * on huge TINs shows up in a profile.
 */
export const queryMeshElevation = (
  mesh: CachedSurfaceMesh,
  x: number,
  y: number,
): number | null => {
  const points = mesh.points;
  for (const tri of mesh.triangles) {
    const a = points[tri[0]];
    const b = points[tri[1]];
    const c = points[tri[2]];
    if (!a || !b || !c) continue;
    const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denom) <= 1e-12) continue;
    const wa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom;
    const wb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom;
    const wc = 1 - wa - wb;
    if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) {
      return wa * a.z + wb * b.z + wc * c.z;
    }
  }
  return null;
};

const edgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

const countMeshEdges = (
  mesh: CachedSurfaceMesh,
): Map<string, { count: number; a: number; b: number }> => {
  const counts = new Map<string, { count: number; a: number; b: number }>();
  for (const tri of mesh.triangles) {
    const [a, b, c] = tri;
    for (const [from, to] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      const key = edgeKey(from, to);
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { count: 1, a: from, b: to });
    }
  }
  return counts;
};

const edgesToPathD = (
  edges: Iterable<{ a: number; b: number }>,
  mesh: CachedSurfaceMesh,
): string => {
  let d = '';
  for (const edge of edges) {
    const pa = mesh.points[edge.a];
    const pb = mesh.points[edge.b];
    if (!pa || !pb) continue;
    d += `M${pa.x} ${pa.y}L${pb.x} ${pb.y}`;
  }
  return d;
};

/** All unique triangle edges as one multi-segment path (drawing units). */
export const surfaceTrianglesPathD = (mesh: CachedSurfaceMesh): string =>
  edgesToPathD(countMeshEdges(mesh).values(), mesh);

/** Boundary = edges used exactly once (outer ring + void holes). */
export const surfaceBoundaryPathD = (mesh: CachedSurfaceMesh): string => {
  const boundary: Array<{ a: number; b: number }> = [];
  for (const entry of countMeshEdges(mesh).values()) {
    if (entry.count === 1) boundary.push(entry);
  }
  return edgesToPathD(boundary, mesh);
};

/** Rendered-vertex cap: edges are one path, but vertices are SVG nodes. */
export const SURFACE_DISPLAY_VERTEX_CAP = 2000;

export interface CadSurfaceDisplayOptions {
  showTriangles: boolean;
  showVertices: boolean;
  showBoundary: boolean;
  stroke: string;
  opacity: number;
}

export const resolveSurfaceDisplayOptions = (
  surface: CadSurface,
  project: CadProject,
): CadSurfaceDisplayOptions => {
  const style = backfillCadSurfaceStyles(project.surfaceStyles).find(
    (entry) => entry.id === surface.styleId,
  );
  return {
    showTriangles: style?.showTriangles ?? true,
    showVertices: style?.showPoints ?? false,
    showBoundary: style?.showBoundary ?? true,
    stroke: style?.color ?? '#38bdf8',
    opacity: style?.opacity != null ? 1 - style.opacity : 0.85,
  };
};

/** Drawing layer for visibility filtering (18C owns visibility). */
export const resolveSurfaceLayerId = (surface: CadSurface, project: CadProject): string => {
  if (surface.layerId != null && project.layers.some((layer) => layer.id === surface.layerId)) {
    return surface.layerId;
  }
  return resolveDefaultSurfaceLayerId(project, surface.layerId);
};

/**
 * One display layer per surface with a fresh OR stale session mesh; null
 * when no mesh exists (definition-only). `revisionIndex` remembers which
 * revisions were built this session so an older mesh still shows stale
 * after a definition edit (meshes never persist, so this is session-only).
 */
export const buildSurfaceDisplayLayer = (
  surface: CadSurface,
  project: CadProject,
  cache: CadSurfaceCache,
  revisionIndex?: ReadonlyMap<string, readonly string[]>,
): CadSurfaceDisplayLayer | null => {
  const revision = surfaceContentRevision(project, surface);
  const fresh = cache.get(surface.id, revision);
  let mesh = fresh ?? null;
  let staleMesh = false;
  if (!mesh) {
    const built = revisionIndex?.get(surface.id) ?? [];
    for (let index = built.length - 1; index >= 0; index -= 1) {
      const candidate = cache.get(surface.id, built[index]!);
      if (candidate) {
        mesh = candidate;
        staleMesh = true;
        break;
      }
    }
  }
  if (!mesh) return null;
  const displayStatus = resolveSurfaceDisplayStatus(project, surface, fresh != null, staleMesh);
  const display = resolveSurfaceDisplayOptions(surface, project);
  const stale = staleMesh || displayStatus.stale;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const vertex of mesh.points) {
    if (vertex.x < minX) minX = vertex.x;
    if (vertex.y < minY) minY = vertex.y;
    if (vertex.x > maxX) maxX = vertex.x;
    if (vertex.y > maxY) maxY = vertex.y;
  }
  const vertices = display.showVertices ? mesh.points.slice(0, SURFACE_DISPLAY_VERTEX_CAP) : [];
  return {
    surfaceId: surface.id,
    surfaceName: surface.name,
    layerId: resolveSurfaceLayerId(surface, project),
    stale,
    statusText: displayStatus.statusText,
    stroke: display.stroke,
    opacity: display.opacity,
    showTriangles: display.showTriangles,
    showVertices: display.showVertices,
    showBoundary: display.showBoundary,
    trianglesD: display.showTriangles ? surfaceTrianglesPathD(mesh) : '',
    boundaryD: display.showBoundary ? surfaceBoundaryPathD(mesh) : '',
    vertices: vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
    verticesTruncated: mesh.points.length > SURFACE_DISPLAY_VERTEX_CAP,
    vertexCount: mesh.points.length,
    bounds: { minX, minY, maxX, maxY },
  };
};

/** Every meshed surface in deterministic (drawing) order. */
export const buildSurfaceDisplayLayers = (
  project: CadProject,
  cache: CadSurfaceCache,
  revisionIndex?: ReadonlyMap<string, readonly string[]>,
): CadSurfaceDisplayLayer[] => {
  const layers: CadSurfaceDisplayLayer[] = [];
  for (const surface of project.surfaces ?? []) {
    const layer = buildSurfaceDisplayLayer(surface, project, cache, revisionIndex);
    if (layer) layers.push(layer);
  }
  return layers;
};

export interface BreaklineChainZ {
  ok: boolean;
  vertexCount: number;
  minZ: number | null;
  maxZ: number | null;
  /** Machine reason for BLOCKED (unresolvable Z); null when enabled. */
  reason: string | null;
}

/**
 * Breakline-from-entity gate: enabled only when every vertex Z resolves via
 * `metadata.sourcePointIds`. BLOCKS otherwise — never invents Z=0. F2F
 * linework passes only with user-explicit intent (`allowF2F`); the
 * provenance marker itself (`metadata.provenance.generatedBy ===
 * 'FIELD_TO_FINISH'`) is read-only, never toggled.
 */
export const classifyBreaklineChainZ = (
  entity: { vertices: Array<{ x: number; y: number }>; metadata?: Record<string, unknown> },
  lookupZ: (_pointId: string) => number | null,
  options?: { allowF2F?: boolean },
): BreaklineChainZ => {
  const provenance = entity.metadata?.['provenance'] as Record<string, unknown> | undefined;
  const isF2F = provenance?.['generatedBy'] === 'FIELD_TO_FINISH';
  if (isF2F && options?.allowF2F !== true) {
    return { ok: false, vertexCount: entity.vertices.length, minZ: null, maxZ: null, reason: 'F2F_EXPLICIT_ONLY' };
  }
  const sourceIds = entity.metadata?.['sourcePointIds'];
  const ids = Array.isArray(sourceIds)
    ? sourceIds.filter((entry): entry is string => typeof entry === 'string')
    : null;
  if (!ids || ids.length !== entity.vertices.length) {
    return { ok: false, vertexCount: entity.vertices.length, minZ: null, maxZ: null, reason: 'UNRESOLVABLE_Z' };
  }
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const id of ids) {
    const z = lookupZ(id);
    if (z == null || !Number.isFinite(z)) {
      return { ok: false, vertexCount: entity.vertices.length, minZ: null, maxZ: null, reason: 'UNRESOLVABLE_Z' };
    }
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { ok: true, vertexCount: entity.vertices.length, minZ, maxZ, reason: null };
};

export interface BoundaryCheck {
  ok: boolean;
  reason: string | null;
}

export interface BreaklineEntityPreview {
  entityId: string;
  label: string;
  pointIds: string[];
  chain: BreaklineChainZ;
}

export interface BoundarySourcePreview {
  entityId: string;
  label: string;
  type: string;
  vertices: Array<{ x: number; y: number }>;
}

/**
 * Preview for "Add Boundary": the single selected ring entity
 * (polyline/polygon/parcel) with its vertices for closed-ness validation.
 * Null unless exactly one ring-type entity is selected.
 */
export const describeSelectedBoundaryEntity = (
  project: CadProject,
  selectedEntityIds: readonly string[],
): BoundarySourcePreview | null => {
  if (selectedEntityIds.length !== 1) return null;
  const entity = project.entities.find((entry) => entry.id === selectedEntityIds[0]);
  if (!entity || (entity.type !== 'polyline' && entity.type !== 'polygon' && entity.type !== 'parcel')) {
    return null;
  }
  return {
    entityId: entity.id,
    label: entity.id,
    type: entity.type,
    vertices: entity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y })),
  };
};

/**
 * Preview for "Add Breakline from Selected Entity": resolves the entity's
 * vertices to ordered survey-point ids (metadata.sourcePointIds, or a
 * line's from/to stations), then gates on Z resolvability. Null when the
 * selection is not a single chainable entity. F2F linework additionally
 * requires user-explicit `allowF2F`.
 */
export const describeSelectedBreaklineEntity = (
  project: CadProject,
  selectedEntityIds: readonly string[],
  options?: { allowF2F?: boolean },
): BreaklineEntityPreview | null => {
  if (selectedEntityIds.length !== 1) return null;
  const entity = project.entities.find((entry) => entry.id === selectedEntityIds[0]);
  if (!entity || (entity.type !== 'polyline' && entity.type !== 'line')) return null;
  const zByPointId = new Map<string, number>();
  const zByStation = new Map<string, number>();
  for (const point of project.entities) {
    if (point.type !== 'survey-point' || point.z == null || !Number.isFinite(point.z)) continue;
    zByPointId.set(point.id, point.z);
    if (!zByStation.has(point.stationId)) zByStation.set(point.stationId, point.z);
  }
  const lookupZ = (pointId: string): number | null => zByPointId.get(pointId) ?? null;
  if (entity.type === 'line') {
    const fromZ = zByStation.get(entity.fromStationId) ?? null;
    const toZ = zByStation.get(entity.toStationId) ?? null;
    const pointIds: string[] = [];
    // Resolve stations back to point ids for the chain command.
    for (const point of project.entities) {
      if (point.type !== 'survey-point') continue;
      if (point.stationId === entity.fromStationId && fromZ != null) pointIds[0] = point.id;
      if (point.stationId === entity.toStationId && toZ != null) pointIds[1] = point.id;
    }
    if (fromZ == null || toZ == null || pointIds[0] == null || pointIds[1] == null) {
      return {
        entityId: entity.id,
        label: `${entity.fromStationId}–${entity.toStationId}`,
        pointIds: [],
        chain: { ok: false, vertexCount: 2, minZ: null, maxZ: null, reason: 'UNRESOLVABLE_Z' },
      };
    }
    return {
      entityId: entity.id,
      label: `${entity.fromStationId}–${entity.toStationId}`,
      pointIds: [pointIds[0], pointIds[1]],
      chain: { ok: true, vertexCount: 2, minZ: Math.min(fromZ, toZ), maxZ: Math.max(fromZ, toZ), reason: null },
    };
  }
  const chain = classifyBreaklineChainZ(entity, lookupZ, options);
  const sourceIds = entity.metadata?.['sourcePointIds'];
  const pointIds = chain.ok && Array.isArray(sourceIds)
    ? (sourceIds as unknown[]).filter((entry): entry is string => typeof entry === 'string')
    : [];
  return { entityId: entity.id, label: entity.id, pointIds, chain };
}

/** Pre-commit boundary validation: ring type + closed geometry. */
export const validateBoundaryEntity = (entity: {
  type: string;
  vertices: Array<{ x: number; y: number }>;
}): BoundaryCheck => {
  if (entity.type !== 'polyline' && entity.type !== 'polygon' && entity.type !== 'parcel') {
    return { ok: false, reason: 'NOT_RING_TYPE' };
  }
  if (entity.vertices.length < 3) return { ok: false, reason: 'TOO_FEW_VERTICES' };
  if (entity.type === 'polyline') {
    const first = entity.vertices[0]!;
    const last = entity.vertices[entity.vertices.length - 1]!;
    if (Math.hypot(last.x - first.x, last.y - first.y) > 1e-9) {
      return { ok: false, reason: 'NOT_CLOSED' };
    }
  }
  return { ok: true, reason: null };
};
