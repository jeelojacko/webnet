import type {
  CadEntity,
  CadEntityId,
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
  CadSurfaceBuildOptions,
  CadSurveyPointEntity,
} from './cadTypes';
import { isExplicitTopologyDefinition, surfacePointGroupIds } from './cadTypes';
import { fnv1a } from './cadRevisionHash';
import { importedTinRevision } from './cadImportedTin';

export { fnv1a };
import { describeEditForRevision } from './cadSurfaceEditDescribe';
import { getFeatureLinePointAtStation, resolveCadFeatureLine } from './cadFeatureLines';
import { evaluatePointGroupMembership } from './cadPointGroups';
import { dedupeTinPoints } from './tin/tinDedupe';
import { pointInRing } from './tin/tinPredicates';
import { validateRingRelations } from './tin/tinBoundaries';
import type { CadSurfaceReasonCode, CadSurfaceSourcePoint } from './cadSurfaceSourceTypes';

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
  buildOptions: { maxEdgeLength?: number; breaklineChordTolerance?: number };
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

/**
 * Phase 20A explicit Surface Breakline Chord Tolerance (metres): max plan
 * deviation when linearizing feature-line arc courses into breakline
 * segments. Conservative 0.001 default; absent/non-finite/non-positive
 * reads as the default (same contract as maxEdgeLength); floored at 1e-6
 * so a pathological tolerance cannot explode segment counts. Always
 * resolved to an effective value so it joins the source revision.
 */
export const DEFAULT_SURFACE_BREAKLINE_CHORD_TOLERANCE = 0.001;
const MIN_SURFACE_BREAKLINE_CHORD_TOLERANCE = 1e-6;

export const resolveSurfaceBreaklineChordTolerance = (
  buildOptions?: CadSurfaceBuildOptions,
): number => {
  const raw = buildOptions?.breaklineChordTolerance;
  if (!Number.isFinite(raw) || (raw as number) <= 0) return DEFAULT_SURFACE_BREAKLINE_CHORD_TOLERANCE;
  return Math.max(raw as number, MIN_SURFACE_BREAKLINE_CHORD_TOLERANCE);
};

/** Segment count so arc sagitta r*(1-cos(sweep/(2n))) stays within tolerance. */
export const featureLineArcSubdivisions = (
  radius: number,
  sweepRad: number,
  tolerance: number,
): number => {
  if (!Number.isFinite(radius) || !(radius > 0)) return 1;
  if (!Number.isFinite(sweepRad) || !(sweepRad > 0)) return 1;
  if (!Number.isFinite(tolerance) || !(tolerance > 0)) return 1;
  // Whole-arc sagitta already within tolerance (or tolerance covers the
  // diameter): a single chord suffices.
  if (tolerance >= 2 * radius) return 1;
  const halfStep = Math.acos(Math.min(1, Math.max(-1, 1 - tolerance / radius)));
  if (!(halfStep > 0)) return 1;
  return Math.max(1, Math.ceil(sweepRad / (2 * halfStep)));
};

interface OwnedBreaklineAppendCtx {
  collected: CollectedSources;
  resolved: CadSurfaceSourcePoint[];
  indexOfEntity: Map<string, number>;
  /** XY key -> index in `resolved` (O(1) shared-vertex reuse; a linear
   *  findIndex here is quadratic in breakline vertex count). */
  xyToIndex: Map<string, number>;
}

/**
 * Append an owned-Z breakline vertex under the exact-XY policy: same XY +
 * same Z reuses the existing point, same XY + different Z conflicts
 * (SURFACE_DUPLICATE_XY_CONFLICT downstream), never Z=0. Returns the
 * point index, or null when blocked (caller fail-closes the chain).
 */
const appendOwnedBreaklinePoint = (
  ctx: OwnedBreaklineAppendCtx,
  x: number,
  y: number,
  z: number,
  entityId: string,
): number | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const known = ctx.indexOfEntity.get(entityId);
  if (known !== undefined) return known;
  const key = `${x},${y}`;
  const priorIndex = ctx.xyToIndex.get(key);
  if (priorIndex !== undefined) {
    if (ctx.resolved[priorIndex]!.z !== z) {
      ctx.collected.duplicateConflict = true;
      return null;
    }
    return priorIndex;
  }
  const at = ctx.resolved.length;
  ctx.resolved.push({ entityId, x, y, z });
  ctx.indexOfEntity.set(entityId, at);
  ctx.xyToIndex.set(key, at);
  return at;
};

/**
 * Phase 20A direct-Z leg: feature-line courses resolve to exact XYZ
 * breakline segments consuming the line's OWN vertex Z (finite-Z required,
 * fail-closed, never Z=0). Straight courses pass through exactly; arc
 * courses linearize within the chord tolerance — every generated vertex
 * sits on the exact arc with Z from exact station interpolation
 * (getFeatureLinePointAtStation; reuse the course resolver only, never
 * display tessellation). Derived at build time; nothing persists.
 * Returns null when blocked (caller raises SURFACE_BREAKLINE_MISSING_Z).
 */
const collectFeatureLineBreakline = (
  ctx: OwnedBreaklineAppendCtx,
  entity: CadFeatureLineEntity,
  chordTolerance: number,
): number[] | null => {
  const resolvedLine = resolveCadFeatureLine(entity);
  if (!resolvedLine) return null;
  const chain: number[] = [];
  const push = (index: number | null): boolean => {
    if (index == null) return false;
    if (chain[chain.length - 1] !== index) chain.push(index);
    return true;
  };
  for (const course of resolvedLine.courses) {
    if (course.kind === 'arc' && course.radius != null && course.signedSweepDeg != null) {
      const subdivisions = featureLineArcSubdivisions(
        course.radius,
        (Math.abs(course.signedSweepDeg) * Math.PI) / 180,
        chordTolerance,
      );
      for (let step = 0; step <= subdivisions; step += 1) {
        // Endpoints are exact (never circle-sampled): the breakline passes
        // precisely through the feature-line vertices, so exact-XY reuse
        // applies and no epsilon twin shadows a corner. Interior steps ride
        // the exact arc with Z from exact station interpolation.
        if (step === 0) {
          if (!push(appendOwnedBreaklinePoint(ctx, course.from.x, course.from.y, course.from.z, `${entity.id}:c${course.index}:from`))) {
            return null;
          }
          continue;
        }
        if (step === subdivisions) {
          if (!push(appendOwnedBreaklinePoint(ctx, course.to.x, course.to.y, course.to.z, `${entity.id}:c${course.index}:to`))) {
            return null;
          }
          continue;
        }
        // Interior station: (plan*step)/n can round 1 ulp above the end
        // station and the station query fail-closes outside range — but
        // interior steps never touch the boundary, so no clamp is needed.
        const station = course.startStation + (course.planLength * step) / subdivisions;
        const at = getFeatureLinePointAtStation(resolvedLine, station);
        if (!at) return null;
        if (!push(appendOwnedBreaklinePoint(ctx, at.x, at.y, at.z, `${entity.id}:arc${course.index}:${step}`))) {
          return null;
        }
      }
    } else {
      if (!push(appendOwnedBreaklinePoint(ctx, course.from.x, course.from.y, course.from.z, `${entity.id}:c${course.index}:from`))) {
        return null;
      }
      if (!push(appendOwnedBreaklinePoint(ctx, course.to.x, course.to.y, course.to.z, `${entity.id}:c${course.index}:to`))) {
        return null;
      }
    }
  }
  return chain;
};

export const breaklineEntityRefs = (entity: CadEntity): string[] => {
  // Phase 20A: a feature line owns its XYZ — it is never a bag of
  // survey-point refs. The marker keeps chain-detail/convert callers honest
  // (fail closed downstream); collectSources consumes feature lines via the
  // dedicated direct-Z rule below, never via this ref list.
  if (entity.type === 'feature-line') return [`feature-line:${entity.id}`];
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
  // Phase 18X: baked explicit TINs share this leg via the explicit predicate.
  if (isExplicitTopologyDefinition(surface.definition) && surface.definition.importedTin) {
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
  // Phase 20A: effective chord tolerance always resolves (default 0.001)
  // so tolerance changes join the source revision (NEEDS_REBUILD).
  const chordTolerance = resolveSurfaceBreaklineChordTolerance(definition.buildOptions);
  collected.buildOptions.breaklineChordTolerance = chordTolerance;

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
  const xyToIndex = new Map(resolved.map((point, index) => [`${point.x},${point.y}`, index]));
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
      // Phase 20A direct-Z leg: a feature line contributes its OWN vertex
      // Z (never a survey-point ref, never Z=0). Deleting it falls into
      // the missing-entity branch above (BROKEN_REFERENCE downstream).
      if (entity.type === 'feature-line') {
        const chain = collectFeatureLineBreakline(
          { collected, resolved, indexOfEntity, xyToIndex },
          entity,
          chordTolerance,
        );
        if (!chain) {
          collected.breaklineError = 'SURFACE_BREAKLINE_MISSING_Z';
          continue;
        }
        if (chain.length < 2) {
          collected.breaklineError = 'SURFACE_BREAKLINE_INVALID';
          continue;
        }
        collected.breaklines.push(chain);
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
      const key = `${fallback.x},${fallback.y}`;
      const priorIndex = xyToIndex.get(key);
      if (priorIndex !== undefined && resolved[priorIndex]!.z !== z) {
        collected.duplicateConflict = true;
        chainBlocked = true;
        break;
      }
      const at = indexOfEntity.get(fallback.id);
      if (at !== undefined) {
        if (chain[chain.length - 1] !== at) chain.push(at);
      } else if (priorIndex !== undefined) {
        if (chain[chain.length - 1] !== priorIndex) chain.push(priorIndex);
      } else {
        const atNew = resolved.length;
        resolved.push({ entityId: fallback.id, x: fallback.x, y: fallback.y, z });
        indexOfEntity.set(fallback.id, atNew);
        xyToIndex.set(key, atNew);
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
  // Phase 18X: baked explicit TINs share the frozen `srev1:imported:` prefix.
  if (isExplicitTopologyDefinition(surface.definition) && surface.definition.importedTin) {
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
  parts.push(`opt:maxEdgeLength=${collected.buildOptions.maxEdgeLength ?? 'none'};breaklineChordTolerance=${collected.buildOptions.breaklineChordTolerance ?? 'none'}`);
  parts.push(`broken:${[...collected.brokenRefs].sort().join(',')}`);
  // Phase 18S + 18T: kind + id + coords/refs/deltaZ + order + enabled
  // (single serializer; human descriptions excluded — none exist on the
  // edit model — and style fields are excluded by construction).
  parts.push(`edits:${(surface.definition.edits ?? []).map(describeEditForRevision).join('|')}`);
  return `srev1:${fnv1a(parts.join('#'))}`;
};
