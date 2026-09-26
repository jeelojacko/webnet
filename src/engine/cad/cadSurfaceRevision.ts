import type {
  CadEntity,
  CadEntityId,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from './cadTypes';
import { isImportedTinDefinition, surfacePointGroupIds } from './cadTypes';
import { fnv1a } from './cadRevisionHash';
import { importedTinRevision } from './cadImportedTin';

export { fnv1a };
import { describeEditForRevision } from './cadSurfaceEditDescribe';
import { evaluatePointGroupMembership } from './cadPointGroups';
import { dedupeTinPoints } from './tin/tinDedupe';
import { pointInRing } from './tin/tinPredicates';
import { validateRingRelations } from './tin/tinBoundaries';
import type { CadSurfaceReasonCode, CadSurfaceSourcePoint } from './cadSurfaces';

export interface CollectedSources {
  brokenRefs: string[];
  points: CadSurfaceSourcePoint[];
  /** Sorted group ids behind a group-kind source (canonical order). */
  groupIds: string[];
  skippedMissingZ: number;
  duplicateConflict: boolean;
  breaklines: number[][];
  breaklineError: CadSurfaceReasonCode | null;
  outers: Array<Array<{ x: number; y: number }>>;
  voids: Array<Array<{ x: number; y: number }>>;
  boundaryError: CadSurfaceReasonCode | null;
  buildOptions: { maxEdgeLength?: number };
}

const surveyPointsOf = (project: CadProject): CadSurveyPointEntity[] =>
  project.entities.filter((entity): entity is CadSurveyPointEntity => entity.type === 'survey-point');

export const canonicalNum = (value: number): string => {
  if (Object.is(value, -0)) return '0';
  return String(value);
};


const resolveRefId = (
  refId: string,
  byEntityId: Map<string, CadSurveyPointEntity>,
  byStationId: Map<string, CadSurveyPointEntity>,
): CadSurveyPointEntity | undefined => byEntityId.get(refId) ?? byStationId.get(refId);

const entityById = (project: CadProject, id: CadEntityId): CadEntity | undefined =>
  project.entities.find((entity) => entity.id === id);

export const breaklineEntityRefs = (entity: CadEntity): string[] => {
  const metadata = (entity.metadata ?? {}) as Record<string, unknown>;
  const fromMetadata = Array.isArray(metadata['sourcePointIds'])
    ? (metadata['sourcePointIds'] as unknown[]).filter(
        (id): id is string => typeof id === 'string',
      )
    : [];
  if (entity.type === 'line') return [...fromMetadata, entity.fromStationId, entity.toStationId];
  if (entity.type === 'polyline' || entity.type === 'polygon' || entity.type === 'parcel') {
    return [...fromMetadata, ...entity.vertexLabels];
  }
  return fromMetadata;
};

/** Entity ring XY (Z ignored); non-ring entity types resolve to null. */
export const boundaryRingOf = (entity: CadEntity): Array<{ x: number; y: number }> | null => {
  if (entity.type === 'polyline' || entity.type === 'polygon' || entity.type === 'parcel') {
    return entity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y }));
  }
  return null;
};

/** Collapse consecutive duplicate XY and drop a closing duplicate. */
export const dedupeRing = (ring: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> => {
  const out: Array<{ x: number; y: number }> = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) out.push({ ...point });
  }
  if (out.length > 1) {
    const first = out[0];
    const last = out[out.length - 1];
    if (first.x === last.x && first.y === last.y) out.pop();
  }
  return out;
};

/**
 * Source resolution ONLY (no triangulation): point-source candidates with
 * missing-Z skip, exact XY-dedupe, breakline chains (Z must resolve, never
 * invented), boundary rings + void validation. Pure + deterministic.
 */
export const collectSources = (project: CadProject, surface: CadSurface): CollectedSources => {
  // Phase 18L: imported TINs resolve straight from the stored topology —
  // no entity refs, no breaklines/boundaries, no dedupe (validated at import).
  if (isImportedTinDefinition(surface.definition) && surface.definition.importedTin) {
    const payload = surface.definition.importedTin;
    const points: CadSurfaceSourcePoint[] = [];
    for (let i = 0; i + 2 < payload.vertices.length; i += 3) {
      const x = payload.vertices[i] as number;
      const y = payload.vertices[i + 1] as number;
      const z = payload.vertices[i + 2] as number;
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        points.push({ entityId: `${surface.id}:v${i / 3}`, x, y, z });
      }
    }
    return {
      brokenRefs: [],
      points,
      groupIds: [],
      skippedMissingZ: 0,
      duplicateConflict: false,
      breaklines: [],
      breaklineError: null,
      outers: [],
      voids: [],
      boundaryError: null,
      buildOptions: {},
    };
  }
  const points = surveyPointsOf(project);
  const byEntityId = new Map(points.map((point) => [point.id, point]));
  const byStationId = new Map<string, CadSurveyPointEntity>();
  for (const point of [...points].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (!byStationId.has(point.stationId)) byStationId.set(point.stationId, point);
  }

  const collected: CollectedSources = {
    brokenRefs: [],
    points: [],
    groupIds: [],
    skippedMissingZ: 0,
    duplicateConflict: false,
    breaklines: [],
    breaklineError: null,
    outers: [],
    voids: [],
    boundaryError: null,
    buildOptions: {},
  };

  const definition = surface.definition;
  const maxEdgeLength = definition.buildOptions?.maxEdgeLength;
  if (Number.isFinite(maxEdgeLength) && (maxEdgeLength as number) > 0) {
    collected.buildOptions.maxEdgeLength = maxEdgeLength;
  }

  // --- point source ----------------------------------------------------------
  let candidates: CadSurveyPointEntity[] = [];
  if (definition.pointSource.kind === 'points') {
    for (const id of definition.pointSource.pointEntityIds) {
      const point = byEntityId.get(id);
      if (!point) {
        if (!collected.brokenRefs.includes(`point:${id}`)) collected.brokenRefs.push(`point:${id}`);
        continue;
      }
      candidates.push(point);
    }
  } else {
    // Multi-group union: sorted group ids (canonical order), members unioned
    // by point entity id (a point in several groups resolves once). Any
    // membership change re-derives NEEDS_REBUILD via the revision below.
    const groupIds = [...new Set(surfacePointGroupIds(definition.pointSource))].sort();
    const byGroupId = new Map((project.pointGroups ?? []).map((entry) => [entry.id, entry]));
    const groups = groupIds.map((id) => byGroupId.get(id)).filter((entry) => entry != null);
    for (const id of groupIds) {
      if (!byGroupId.has(id) && !collected.brokenRefs.includes(`point-group:${id}`)) {
        collected.brokenRefs.push(`point-group:${id}`);
      }
    }
    candidates = points.filter((point) =>
      groups.some((group) => evaluatePointGroupMembership(point, group)),
    );
    collected.groupIds = groupIds;
  }

  const finite = candidates.filter((point) => {
    const ok =
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
    if (!ok) collected.skippedMissingZ += 1;
    return ok;
  });
  const deduped = dedupeTinPoints(
    finite.map((point) => ({ entityId: point.id, x: point.x, y: point.y, z: point.z as number })),
  );
  collected.duplicateConflict = deduped.conflict;
  const resolved: CadSurfaceSourcePoint[] = [...deduped.unique];
  collected.points = resolved;

  // --- breaklines (world-XY chains; Z must resolve, never invented) -----------
  const indexOfEntity = new Map(resolved.map((point, index) => [point.entityId, index]));
  const indexOfStation = new Map<string, number>();
  for (const [index, point] of resolved.entries()) {
    const station = byEntityId.get(point.entityId)?.stationId;
    if (station != null && !indexOfStation.has(station)) indexOfStation.set(station, index);
  }
  const xyToZ = new Map(resolved.map((point) => [`${point.x},${point.y}`, point.z]));
  for (const breakline of definition.breaklines ?? []) {
    let refs: string[] = [];
    if (breakline.source.kind === 'point-chain') {
      refs = [...breakline.source.pointEntityIds];
    } else {
      const entity = entityById(project, breakline.source.entityId);
      if (!entity) {
        if (!collected.brokenRefs.includes(`breakline:${breakline.source.entityId}`)) {
          collected.brokenRefs.push(`breakline:${breakline.source.entityId}`);
        }
        continue;
      }
      refs = breaklineEntityRefs(entity);
    }
    const chain: number[] = [];
    let chainBlocked = false;
    for (const ref of refs) {
      const hit = indexOfEntity.get(ref) ?? indexOfStation.get(ref);
      if (hit !== undefined) {
        if (chain[chain.length - 1] !== hit) chain.push(hit);
        continue;
      }
      // Not in the surface point set: resolve the survey point directly and
      // append it (exact XY policy still applies — never Z=0, never average).
      const fallback = resolveRefId(ref, byEntityId, byStationId);
      if (
        !fallback ||
        !Number.isFinite(fallback.x) ||
        !Number.isFinite(fallback.y) ||
        !Number.isFinite(fallback.z)
      ) {
        chainBlocked = true;
        break;
      }
      const z = fallback.z as number;
      const prior = xyToZ.get(`${fallback.x},${fallback.y}`);
      if (prior !== undefined && prior !== z) {
        collected.duplicateConflict = true;
        chainBlocked = true;
        break;
      }
      const at = indexOfEntity.get(fallback.id);
      if (at !== undefined) {
        if (chain[chain.length - 1] !== at) chain.push(at);
      } else if (prior !== undefined) {
        const existing = resolved.findIndex((p) => p.x === fallback.x && p.y === fallback.y);
        if (chain[chain.length - 1] !== existing) chain.push(existing);
      } else {
        const atNew = resolved.length;
        resolved.push({ entityId: fallback.id, x: fallback.x, y: fallback.y, z });
        indexOfEntity.set(fallback.id, atNew);
        xyToZ.set(`${fallback.x},${fallback.y}`, z);
        chain.push(atNew);
      }
    }
    if (chainBlocked || chain.length < 2) {
      collected.breaklineError = chainBlocked ? 'SURFACE_BREAKLINE_MISSING_Z' : 'SURFACE_BREAKLINE_INVALID';
      continue;
    }
    collected.breaklines.push(chain);
  }

  // --- boundaries -------------------------------------------------------------
  for (const boundary of definition.boundaries ?? []) {
    const entity = entityById(project, boundary.sourceEntityId);
    const ring = entity ? boundaryRingOf(entity) : null;
    if (!entity) {
      if (!collected.brokenRefs.includes(`boundary:${boundary.sourceEntityId}`)) {
        collected.brokenRefs.push(`boundary:${boundary.sourceEntityId}`);
      }
      continue;
    }
    const distinct = ring ? dedupeRing(ring) : [];
    if (distinct.length < 3) {
      collected.boundaryError = 'SURFACE_BOUNDARY_INVALID';
      continue;
    }
    if (boundary.type === 'outer') collected.outers.push(distinct);
    else collected.voids.push(distinct);
  }
  if (!collected.boundaryError) {
    const breaklineChains = collected.breaklines.map((chain) =>
      chain.map((index) => ({
        x: collected.points[index].x,
        y: collected.points[index].y,
      })),
    );
    const problem = validateRingRelations(collected.outers, collected.voids, breaklineChains);
    if (problem === 'outer-invalid') collected.boundaryError = 'SURFACE_BOUNDARY_INVALID';
    else if (problem === 'void-invalid') collected.boundaryError = 'SURFACE_VOID_INVALID';
    else if (problem === 'breakline-crossing') {
      collected.breaklineError = 'SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX';
    }
  }
  if (!collected.boundaryError) {
    for (const ring of collected.voids) {
      const centroid = {
        x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
        y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
      };
      if (
        collected.outers.length > 0 &&
        !collected.outers.every((outer) => pointInRing(centroid.x, centroid.y, outer))
      ) {
        collected.boundaryError = 'SURFACE_VOID_INVALID';
        break;
      }
    }
  }

  return collected;
};

/**
 * Geometry-only revision: point ids + X/Y/Z (canonical order), breakline
 * vertex order + coords, boundary rings, build options, broken-ref markers.
 * Display styling (styleId/layerId) is excluded by construction.
 */
export const computeCadSurfaceSourceRevision = (project: CadProject, surface: CadSurface): string => {
  // Phase 18L: imported revision covers stored topology + provenance only.
  if (isImportedTinDefinition(surface.definition) && surface.definition.importedTin) {
    return importedTinRevision(surface.id, surface.definition.importedTin, surface.definition.edits);
  }
  const collected = collectSources(project, surface);
  const parts: string[] = [];
  const ordered = [...collected.points].sort((a, b) =>
    a.x !== b.x
      ? a.x - b.x
      : a.y !== b.y
        ? a.y - b.y
        : a.z !== b.z
          ? a.z - b.z
          : a.entityId < b.entityId
            ? -1
            : 1,
  );
  parts.push(
    `points:${ordered.map((p) => `${p.entityId}@${canonicalNum(p.x)},${canonicalNum(p.y)},${canonicalNum(p.z)}`).join(';')}`,
  );
  parts.push(`groups:${collected.groupIds.join(',')}`);
  parts.push(
    `breaklines:${collected.breaklines
      .map((chain) =>
        chain
          .map((index) => {
            const p = collected.points[index];
            return `${p.entityId}@${canonicalNum(p.x)},${canonicalNum(p.y)},${canonicalNum(p.z)}`;
          })
          .join('>'),
      )
      .join('|')}`,
  );
  const ringText = (ring: Array<{ x: number; y: number }>): string =>
    ring.map((p) => `${canonicalNum(p.x)},${canonicalNum(p.y)}`).join('>');
  parts.push(`outer:${collected.outers.map(ringText).join('|')}`);
  parts.push(`void:${collected.voids.map(ringText).join('|')}`);
  parts.push(`opt:maxEdgeLength=${collected.buildOptions.maxEdgeLength ?? 'none'}`);
  parts.push(`broken:${[...collected.brokenRefs].sort().join(',')}`);
  // Phase 18S + 18T: kind + id + coords/refs/deltaZ + order + enabled
  // (single serializer; human descriptions excluded — none exist on the
  // edit model — and style fields are excluded by construction).
  parts.push(`edits:${(surface.definition.edits ?? []).map(describeEditForRevision).join('|')}`);
  return `srev1:${fnv1a(parts.join('#'))}`;
};
