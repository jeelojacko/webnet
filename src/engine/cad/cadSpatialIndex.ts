import { cadProjectPointOntoInfiniteLine, type CadWorldPoint } from './cadGeometry';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import type {
  CadArcEntity,
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadBounds,
  CadCircleEntity,
  CadEntity,
  CadFeatureLineEntity,
  CadLineEntity,
  CadParcelEntity,
  CadPolygonEntity,
  CadPolylineEntity,
  CadProject,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapKind,
} from './cadTypes';
import { expandBounds } from './cadSpatialBounds';
import {
  parcelArcBoundsPoints,
  parcelCourseCanonicalKind,
  validateParcelCourseGeometry,
} from './cadParcelArcGeometry';
import { resolveCadFeatureLine } from './cadFeatureLines';
import { resolveCadPolylineCourses } from './cadPolylineCourses';
import { buildCadSpatialEntitySnapCandidates } from './cadSpatialEntityCandidates';
import { arcRefFromEntity, circleRefFromEntity, entitySegments, featureLineCourseArcs, featureLineCourseSegments, parcelCourseArcs, polylineCourseArcs, polylineCourseSegments } from './cadSpatialEntityRefs';
import { blockReferenceBounds, expandBlockReference } from './cadBlocks';
import { buildCadProjectLookup } from './cadProjectLookup';
import type { CadArcRef, CadCircleRef, CadSegmentRef, CadSpatialIndex } from './cadSpatialIndexTypes';
import {
  buildApparentIntersectionCandidates,
  buildExactIntersectionCandidates,
} from './cadSpatialIntersectionCandidates';
import {
  CONSTRUCTION_LOCK_KINDS,
  DIRECTION_SNAPS,
  SNAP_RANGE_MULTIPLIER,
} from './cadSpatialSnapConstants';
import {
  buildCandidate,
  buildCompoundConstructionCandidate,
  candidateSort,
  compoundCandidateSort,
  dedupeCandidates,
  pointOnCandidateLine,
} from './cadSpatialSnapCandidates';

import {
  buildDirectionCandidate,
  buildLockedConstructionPoint,
  buildLockedLineIntersectionCandidates,
  buildPerpendicularThroughBaseCandidate,
  buildPerpendicularThroughTangentSeedCandidate,
  buildScopedSegmentIds,
  buildTangentThroughArcPointCandidate,
  candidateMatchesLockedSnap,
} from './cadSpatialConstruction';

// ---------------------------------------------------------------------------
// Phase 18P lifecycle / invalidation policy.
//
// One index = one project object. The workspace replaces the project
// wholesale on edit/undo/redo/drawing-switch, and the snapping hook memos
// the index on [project], so a new index (with fresh prepared bounds) is
// built exactly on geometry change. Pan/zoom only changes the visibleBounds
// QUERY argument per pointer move and never rebuilds the index: viewport
// culling reads prepared bounds, geometry is prepared once. No incremental
// invalidation: rebuild on project identity change is the whole policy.
// ---------------------------------------------------------------------------

interface PreparedEntry {
  entity: CadEntity;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PreparedSegment {
  ref: CadSegmentRef;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PreparedArc {
  ref: CadArcRef;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PreparedCircle {
  ref: CadCircleRef;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PreparedBlock {
  entity: CadBlockReferenceEntity;
  definition: CadBlockDefinition;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type SnapEntity =
  | CadLineEntity
  | CadPolylineEntity
  | CadPolygonEntity
  | CadParcelEntity
  | CadArcEntity
  | CadCircleEntity
  | CadFeatureLineEntity;

const isSnapGeometry = (entity: CadEntity): entity is SnapEntity =>
  entity.type === 'line' ||
  entity.type === 'polyline' ||
  entity.type === 'polygon' ||
  entity.type === 'parcel' ||
  entity.type === 'arc' ||
  entity.type === 'circle' ||
  entity.type === 'feature-line';

const segmentBounds = (ref: CadSegmentRef): PreparedSegment => ({
  ref,
  minX: Math.min(ref.start.x, ref.end.x),
  minY: Math.min(ref.start.y, ref.end.y),
  maxX: Math.max(ref.start.x, ref.end.x),
  maxY: Math.max(ref.start.y, ref.end.y),
});

/**
 * Phase 19C: extra bound points for a parcel's arc courses (in-sweep
 * quadrant extrema outside the chord box), reusing the single arc seam.
 * Empty for legacy/all-line/invalid geometry (chord bounds rule there).
 */
const parcelArcExtraBoundsPoints = (entity: CadParcelEntity): CadWorldPoint[] => {
  const geometry = entity.courseGeometry;
  if (geometry == null || geometry.length !== entity.vertices.length) return [];
  if (!validateParcelCourseGeometry(entity.vertices, geometry).ok) return [];
  return geometry.flatMap((entry, index) => {
    if (parcelCourseCanonicalKind(entry) !== 'arc' || entry?.kind !== 'arc') return [];
    const from = entity.vertices[index]!;
    const to = entity.vertices[(index + 1) % entity.vertices.length]!;
    return parcelArcBoundsPoints(from, to, entry.bulge);
  });
};

/** Phase 20A: feature-line arc-course extrema for cursor-box culling. */
const featureLineArcExtraBoundsPoints = (entity: CadFeatureLineEntity): CadWorldPoint[] => {
  const resolved = resolveCadFeatureLine(entity);
  if (!resolved) return [];
  return resolved.courses.flatMap((course) => {
    if (course.kind !== 'arc' || course.center == null) return [];
    const entry = entity.segmentGeometry?.[course.index];
    if (entry?.kind !== 'arc') return [];
    // Arc center joins the box so center snaps are never culled by the
    // tight in-sweep extrema (the center can sit outside the sweep).
    return [{ x: course.center.x, y: course.center.y }, ...parcelArcBoundsPoints(course.from, course.to, entry.bulge)];
  });
};

/** Phase C2: polyline arc-course extrema (+ center) for cursor-box culling. */
const polylineArcExtraBoundsPoints = (entity: CadPolylineEntity): CadWorldPoint[] => {
  const courses = resolveCadPolylineCourses(entity);
  if (!courses) return [];
  return courses.flatMap((course) => {
    if (course.kind !== 'arc' || course.metrics == null) return [];
    return [
      { x: course.metrics.center.x, y: course.metrics.center.y },
      ...parcelArcBoundsPoints(course.from, course.to, (course.geometry as { bulge: number }).bulge),
    ];
  });
};

const circleBounds = (ref: CadCircleRef): PreparedCircle => ({
  ref,
  minX: ref.center.x - ref.radius,
  minY: ref.center.y - ref.radius,
  maxX: ref.center.x + ref.radius,
  maxY: ref.center.y + ref.radius,
});

const arcBounds = (ref: CadArcRef): PreparedArc => ({
  ref,
  minX: ref.center.x - ref.radius,
  minY: ref.center.y - ref.radius,
  maxX: ref.center.x + ref.radius,
  maxY: ref.center.y + ref.radius,
});

const intersectsBox = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  box: CadBounds,
): boolean => !(maxX < box.minX || minX > box.maxX || maxY < box.minY || minY > box.maxY);

const pointBox = (point: CadWorldPoint, pad: number): CadBounds => ({
  minX: point.x - pad,
  minY: point.y - pad,
  maxX: point.x + pad,
  maxY: point.y + pad,
});

const maxRangeMultiplier = (allowed: Set<CadSnapKind>): number => {
  let max = 0;
  allowed.forEach((kind) => {
    const multiplier = SNAP_RANGE_MULTIPLIER[kind] ?? 1;
    if (multiplier > max) max = multiplier;
  });
  return max > 0 ? max : 1;
};

export const buildCadSpatialIndex = (project: CadProject): CadSpatialIndex => {
  // One derived index per spatial-index build; every per-entity bounds/style
  // scan below reads O(1) maps instead of re-scanning the arrays.
  const lookup = buildCadProjectLookup(project);

  // ---- Prepared once per index (never per query) ----
  // Only snap-relevant types are retained: annotation entities (text, mtext,
  // leaders, dimensions, labels, …) never produce snap candidates (the entity
  // candidate switch ignores them) and never contribute segments/arcs, so
  // excluding them is behavior-preserving while keeping the per-query scan
  // to geometry only.
  const preparedEntities: PreparedEntry[] = [];
  const preparedSegments: PreparedSegment[] = [];
  const preparedArcs: PreparedArc[] = [];
  const preparedCircles: PreparedCircle[] = [];
  const preparedBlocks: PreparedBlock[] = [];
  const segmentById = new Map<string, CadSegmentRef>();
  const arcBySourceId = new Map<string, CadArcRef>();
  const arcBySegmentId = new Map<string, CadArcRef>();

  for (const entity of project.entities) {
    if (!entity.visible) continue;
    if (entity.type === 'survey-point') {
      preparedEntities.push({ entity, minX: entity.x, minY: entity.y, maxX: entity.x, maxY: entity.y });
    } else if (isSnapGeometry(entity)) {
      if (entity.type === 'arc') {
        const ref = arcRefFromEntity(project, entity);
        const prepared = arcBounds(ref);
        preparedArcs.push(prepared);
        arcBySourceId.set(entity.id, ref);
        preparedEntities.push({ entity, ...prepared });
      } else if (entity.type === 'circle') {
        const ref = circleRefFromEntity(project, entity);
        const prepared = circleBounds(ref);
        preparedCircles.push(prepared);
        preparedEntities.push({ entity, ...prepared });
      } else if (entity.type === 'feature-line') {
        // Phase 20A: line courses join the segment set, arc courses the arc
        // set (plan-only; Z is intentionally absent from snap math).
        const refs = featureLineCourseSegments(entity);
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const ref of refs) {
          const prepared = segmentBounds(ref);
          preparedSegments.push(prepared);
          segmentById.set(ref.segmentId, ref);
          minX = Math.min(minX, prepared.minX);
          minY = Math.min(minY, prepared.minY);
          maxX = Math.max(maxX, prepared.maxX);
          maxY = Math.max(maxY, prepared.maxY);
        }
        for (const ref of featureLineCourseArcs(entity)) {
          const prepared = arcBounds(ref);
          preparedArcs.push(prepared);
          arcBySourceId.set(ref.sourceEntityId, ref);
          if (ref.segmentId != null) arcBySegmentId.set(ref.segmentId, ref);
        }
        for (const point of featureLineArcExtraBoundsPoints(entity)) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
        if (Number.isFinite(minX) && Number.isFinite(minY)) {
          preparedEntities.push({ entity, minX, minY, maxX, maxY });
        }
      } else if (entity.type === 'polyline') {
        // Phase C2: line courses join the segment set, arc courses the arc
        // set (a bulged course is NEVER indexed as its chord). Extra
        // in-sweep extrema keep cursor-box culling honest for bulges that
        // reach outside the chord box.
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const ref of polylineCourseSegments(entity)) {
          const prepared = segmentBounds(ref);
          preparedSegments.push(prepared);
          segmentById.set(ref.segmentId, ref);
          minX = Math.min(minX, prepared.minX);
          minY = Math.min(minY, prepared.minY);
          maxX = Math.max(maxX, prepared.maxX);
          maxY = Math.max(maxY, prepared.maxY);
        }
        for (const ref of polylineCourseArcs(entity)) {
          const prepared = arcBounds(ref);
          preparedArcs.push(prepared);
          arcBySourceId.set(ref.sourceEntityId, ref);
          if (ref.segmentId != null) arcBySegmentId.set(ref.segmentId, ref);
        }
        for (const point of polylineArcExtraBoundsPoints(entity)) {
          minX = Math.min(minX, point.x);
          minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x);
          maxY = Math.max(maxY, point.y);
        }
        if (Number.isFinite(minX) && Number.isFinite(minY)) {
          preparedEntities.push({ entity, minX, minY, maxX, maxY });
        }
      } else if (entity.type === 'parcel') {
        // Phase C2 correction: parcel arc courses join the arc set as true
        // refs (a bulged course is NEVER indexed as its chord) so a locked
        // tangent/perp on a parcel arc resolves the arc geometry by its
        // explicit `${id}#i` course id, mirroring polyline/feature-line.
        // Line courses and legacy/all-line/invalid geometry keep the exact
        // chord-segment path. In-sweep extrema keep cursor-box culling honest
        // for bulges that reach outside the chord box.
        const parcelArcs = parcelCourseArcs(entity);
        const arcCourseIds = new Set(parcelArcs.map((ref) => ref.segmentId));
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const ref of entitySegments(entity)) {
          if (ref.segmentId != null && arcCourseIds.has(ref.segmentId)) continue;
          const prepared = segmentBounds(ref);
          preparedSegments.push(prepared);
          segmentById.set(ref.segmentId, ref);
          if (prepared.minX < minX) minX = prepared.minX;
          if (prepared.minY < minY) minY = prepared.minY;
          if (prepared.maxX > maxX) maxX = prepared.maxX;
          if (prepared.maxY > maxY) maxY = prepared.maxY;
        }
        for (const ref of parcelArcs) {
          const prepared = arcBounds(ref);
          preparedArcs.push(prepared);
          arcBySourceId.set(ref.sourceEntityId, ref);
          if (ref.segmentId != null) arcBySegmentId.set(ref.segmentId, ref);
        }
        // Phase 19C: arc-course extrema join the entity bounds so cursor-box
        // culling never hides a curved parcel whose bulge reaches outside
        // its chords (segment boxes stay chord-based).
        for (const point of parcelArcExtraBoundsPoints(entity)) {
          if (point.x < minX) minX = point.x;
          if (point.y < minY) minY = point.y;
          if (point.x > maxX) maxX = point.x;
          if (point.y > maxY) maxY = point.y;
        }
        if (Number.isFinite(minX) && Number.isFinite(minY)) {
          preparedEntities.push({ entity, minX, minY, maxX, maxY });
        }
      } else {
        const refs = entitySegments(entity);
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const ref of refs) {
          const prepared = segmentBounds(ref);
          preparedSegments.push(prepared);
          segmentById.set(ref.segmentId, ref);
          if (prepared.minX < minX) minX = prepared.minX;
          if (prepared.minY < minY) minY = prepared.minY;
          if (prepared.maxX > maxX) maxX = prepared.maxX;
          if (prepared.maxY > maxY) maxY = prepared.maxY;
        }
        if (refs.length > 0) preparedEntities.push({ entity, minX, minY, maxX, maxY });
      }
    } else if (entity.type === 'block-reference') {
      // Phase 18N bounds-first: record the instance bounds + definition only.
      // Child expansion stays lazy per query (see expandedBlockChildren) so a
      // drawing with thousands of block instances never eagerly expands them.
      const definition = lookup.blockDefinitionById.get(entity.blockDefinitionId);
      if (!definition) continue;
      let bounds: CadBounds | null = null;
      try {
        bounds = blockReferenceBounds(definition, entity);
      } catch {
        bounds = null;
      }
      preparedBlocks.push({
        entity,
        definition,
        minX: bounds?.minX ?? entity.x,
        minY: bounds?.minY ?? entity.y,
        maxX: bounds?.maxX ?? entity.x,
        maxY: bounds?.maxY ?? entity.y,
      });
    }
  }

  // Per-index expansion cache: same project object ⇒ same instance transform,
  // so a cached expansion can never go stale within this index's lifetime.
  const blockExpansionCache = new Map<string, { segments: CadSegmentRef[]; arcs: CadArcRef[]; circles: CadCircleRef[] }>();
  const expandedBlockChildren = (block: PreparedBlock): { segments: CadSegmentRef[]; arcs: CadArcRef[]; circles: CadCircleRef[] } => {
    const cached = blockExpansionCache.get(block.entity.id);
    if (cached) return cached;
    const empty = { segments: [], arcs: [] as CadArcRef[], circles: [] as CadCircleRef[] };
    let children;
    try {
      children = expandBlockReference(block.definition, block.entity);
    } catch {
      blockExpansionCache.set(block.entity.id, empty);
      return empty;
    }
    const segments: CadSegmentRef[] = [];
    const arcs: CadArcRef[] = [];
    const circles: CadCircleRef[] = [];
    for (const child of children) {
      if (child.type === 'line' || child.type === 'polygon') {
        segments.push(...entitySegments({ ...child, id: block.entity.id }));
      } else if (child.type === 'polyline') {
        // Phase C2: line courses as segments, arc courses as true arcs (the
        // chord is never indexed). Metadata arrays ride on the child copy.
        const childPolyline = { ...child, id: block.entity.id };
        segments.push(...entitySegments(childPolyline));
        arcs.push(...polylineCourseArcs(childPolyline));
      } else if (child.type === 'arc') {
        const ref = arcRefFromEntity(project, { ...child, id: block.entity.id });
        arcs.push({ ...ref, sourceEntityId: block.entity.id });
      } else if (child.type === 'circle') {
        const ref = circleRefFromEntity(project, { ...child, id: block.entity.id });
        circles.push({ ...ref, sourceEntityId: block.entity.id });
      }
    }
    const expanded = { segments, arcs, circles };
    for (const ref of arcs) {
      if (ref.segmentId != null) arcBySegmentId.set(ref.segmentId, ref);
    }
    blockExpansionCache.set(block.entity.id, expanded);
    return expanded;
  };

  const querySnapCandidates = (
    worldPoint: CadWorldPoint,
    toleranceWorld: number,
    allowedKinds: readonly CadSnapKind[] = [
      'point-node',
      'endpoint',
      'midpoint',
      'center',
      'arc-midpoint',
      'quadrant',
      'intersection',
      'apparent-intersection',
      'extension',
      'perpendicular',
      'parallel',
      'tangent',
      'nearest',
    ],
    constructionContext: CadSnapConstructionContext = { active: false, basePoint: null },
    visibleBounds: CadBounds | null = null,
  ): CadSnapCandidate[] => {
    const allowed = new Set(allowedKinds);
    const candidates: CadSnapCandidate[] = [];
    const visibleQueryBounds = visibleBounds ? expandBounds(visibleBounds, toleranceWorld * 1.5) : null;
    const constructionActive = constructionContext.active || constructionContext.lockedSnap != null;

    // Hot hover path (no construction): cursor-box broad phase over prepared
    // bounds. Every candidate kind reachable here is distance-filtered at the
    // end (tolerance × kind multiplier ≤ tolerance × maxMultiplier), so any
    // entity/segment/arc whose AABB misses the cursor box cannot produce a
    // surviving candidate — including exact intersections, whose point lies
    // on both parents (each parent's AABB then meets the box). Construction
    // snaps (extension/perpendicular/parallel/tangent/apparent/locked) are
    // infinite-line projections that CAN reach far from their parents, so
    // the construction path below keeps the full prepared sets.
    // No uniform grid: the per-query scan is one O(entities) AABB pass plus
    // O(nearby²) intersections; see phase18p-spatial-index-decision.md.
    let visibleEntities: CadEntity[];
    let segments: CadSegmentRef[];
    let arcs: CadArcRef[];
    let circles: CadCircleRef[];
    if (constructionActive) {
      visibleEntities = [];
      for (const prepared of preparedEntities) {
        if (!visibleQueryBounds || intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, visibleQueryBounds)) {
          visibleEntities.push(prepared.entity);
        }
      }
      segments = preparedSegments
        .filter((prepared) => !visibleQueryBounds || intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, visibleQueryBounds))
        .map((prepared) => prepared.ref);
      arcs = preparedArcs
        .filter((prepared) => !visibleQueryBounds || intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, visibleQueryBounds))
        .map((prepared) => prepared.ref);
      circles = preparedCircles
        .filter((prepared) => !visibleQueryBounds || intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, visibleQueryBounds))
        .map((prepared) => prepared.ref);
      for (const block of preparedBlocks) {
        if (visibleQueryBounds && !intersectsBox(block.minX, block.minY, block.maxX, block.maxY, visibleQueryBounds)) continue;
        visibleEntities.push(block.entity);
        const expanded = expandedBlockChildren(block);
        segments.push(...expanded.segments);
        arcs.push(...expanded.arcs);
        circles.push(...expanded.circles);
      }
    } else {
      const cursorBox = pointBox(worldPoint, toleranceWorld * maxRangeMultiplier(allowed));
      visibleEntities = [];
      for (const prepared of preparedEntities) {
        if (visibleQueryBounds && !intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, visibleQueryBounds)) continue;
        if (!intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, cursorBox)) continue;
        visibleEntities.push(prepared.entity);
      }
      segments = [];
      for (const prepared of preparedSegments) {
        if (visibleQueryBounds && !intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, visibleQueryBounds)) continue;
        if (!intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, cursorBox)) continue;
        segments.push(prepared.ref);
      }
      arcs = [];
      for (const prepared of preparedArcs) {
        if (visibleQueryBounds && !intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, visibleQueryBounds)) continue;
        if (!intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, cursorBox)) continue;
        arcs.push(prepared.ref);
      }
      circles = [];
      for (const prepared of preparedCircles) {
        if (visibleQueryBounds && !intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, visibleQueryBounds)) continue;
        if (!intersectsBox(prepared.minX, prepared.minY, prepared.maxX, prepared.maxY, cursorBox)) continue;
        circles.push(prepared.ref);
      }
      for (const block of preparedBlocks) {
        if (visibleQueryBounds && !intersectsBox(block.minX, block.minY, block.maxX, block.maxY, visibleQueryBounds)) continue;
        if (!intersectsBox(block.minX, block.minY, block.maxX, block.maxY, cursorBox)) continue;
        visibleEntities.push(block.entity);
        const expanded = expandedBlockChildren(block);
        for (const ref of expanded.segments) {
          const bounds = segmentBounds(ref);
          if (intersectsBox(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, cursorBox)) segments.push(ref);
        }
        for (const ref of expanded.arcs) {
          const bounds = arcBounds(ref);
          if (intersectsBox(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, cursorBox)) arcs.push(ref);
        }
        for (const ref of expanded.circles) {
          const bounds = circleBounds(ref);
          if (intersectsBox(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, cursorBox)) circles.push(ref);
        }
      }
    }
    const basePoint = constructionContext.active ? constructionContext.basePoint : null;
    // A polyline/feature-line arc course id is a valid snap identity but not a
    // segment scope seed: dropping it here matches the pre-C2 law where arc
    // snaps carried no segment id, while a genuinely missing id still filters
    // (see cadSpatialIndex.03 'line:missing#0').
    const rawScopeSeedSegmentId = constructionContext.scopeSeedSegmentId ?? null;
    const scopeSeedSegmentId =
      rawScopeSeedSegmentId != null && arcBySegmentId.has(rawScopeSeedSegmentId)
        ? null
        : rawScopeSeedSegmentId;
    const scopeSeedSegment = scopeSeedSegmentId
      ? (segments.find((segment) => segment.segmentId === scopeSeedSegmentId) ?? segmentById.get(scopeSeedSegmentId) ?? null)
      : null;
    const tangentSeedArcEntityId = constructionContext.tangentSeedArcEntityId ?? null;
    const tangentSeedArcSegmentId = constructionContext.tangentSeedArcSegmentId ?? null;
    const tangentSeedPoint = constructionContext.tangentSeedPoint ?? basePoint;
    const tangentSeedArc = tangentSeedArcEntityId
      ? (tangentSeedArcSegmentId != null
          ? arcs.find((arc) => arc.segmentId === tangentSeedArcSegmentId) ??
            arcBySegmentId.get(tangentSeedArcSegmentId) ??
            null
          : null) ??
        arcs.find((arc) => arc.sourceEntityId === tangentSeedArcEntityId) ??
        arcBySourceId.get(tangentSeedArcEntityId) ??
        null
      : null;
    const hasPerpendicularStartSeed = scopeSeedSegment != null || tangentSeedArc != null;
    const parallelScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 1) : null;
    const extensionScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 2) : null;
    const apparentScope = constructionContext.active ? buildScopedSegmentIds(segments, basePoint, scopeSeedSegmentId, 2) : null;
    const requireExplicitScope = constructionContext.active && scopeSeedSegmentId != null;

    candidates.push(
      ...buildCadSpatialEntitySnapCandidates({
        project,
        visibleEntities,
        segments,
        worldPoint,
        allowed,
        constructionContext,
        basePoint,
        hasPerpendicularStartSeed,
        parallelScope,
        extensionScope,
        requireExplicitScope,
      }),
    );

    if (constructionContext.active && basePoint && scopeSeedSegment && allowed.has('perpendicular')) {
      const startPerpendicularPoint = buildPerpendicularThroughBaseCandidate(scopeSeedSegment, basePoint, worldPoint);
      if (startPerpendicularPoint) {
        candidates.push(
          buildCandidate(
            'perpendicular',
            scopeSeedSegment.sourceEntityId,
            startPerpendicularPoint,
            worldPoint,
            `${scopeSeedSegment.label} start perp`,
            [
              [basePoint, startPerpendicularPoint],
              [scopeSeedSegment.start, scopeSeedSegment.end],
            ],
            scopeSeedSegment.segmentId,
            undefined,
            cadProjectPointOntoInfiniteLine(basePoint, scopeSeedSegment.start, scopeSeedSegment.end).point,
          ),
        );
      }
    }

    if (constructionContext.active && tangentSeedArc && tangentSeedPoint && allowed.has('perpendicular')) {
      const curveStartPerpendicularPoint = buildPerpendicularThroughTangentSeedCandidate(
        tangentSeedArc,
        tangentSeedPoint,
        worldPoint,
      );
      if (curveStartPerpendicularPoint) {
        candidates.push(
          buildCandidate(
            'perpendicular',
            tangentSeedArc.sourceEntityId,
            curveStartPerpendicularPoint,
            worldPoint,
            `${tangentSeedArc.label} start perp`,
            [
              [tangentSeedPoint, curveStartPerpendicularPoint],
              [tangentSeedArc.center, tangentSeedPoint],
            ],
            undefined,
            undefined,
            tangentSeedArc.center,
          ),
        );
      }
    }

    if (constructionContext.active && basePoint && tangentSeedArc && allowed.has('tangent')) {
      const tangentPoint = buildTangentThroughArcPointCandidate(tangentSeedArc, basePoint, worldPoint);
      if (tangentPoint) {
        candidates.push(
          buildCandidate(
            'tangent',
            tangentSeedArc.sourceEntityId,
            tangentPoint,
            worldPoint,
            `${tangentSeedArc.label} tangent`,
            [
              [basePoint, tangentPoint],
              [tangentSeedArc.center, basePoint],
            ],
            undefined,
            undefined,
            tangentPoint,
          ),
        );
      }
    }

    if (constructionContext.active && basePoint && allowed.has('direction')) {
      const directionSnap = buildDirectionCandidate(basePoint, worldPoint);
      if (directionSnap) {
        candidates.push(
          buildCandidate(
            'direction',
            'direction-guide',
            directionSnap.point,
            worldPoint,
            `${directionSnap.label} ${directionSnap.azimuthDeg.toString().padStart(3, '0')}°`,
            [[basePoint, directionSnap.point]],
          ),
        );
      }
    }

    if (allowed.has('intersection')) {
      candidates.push(...buildExactIntersectionCandidates({ segments, arcs, circles, worldPoint }));
    }
    if (constructionContext.active && allowed.has('apparent-intersection')) {
      candidates.push(
        ...buildApparentIntersectionCandidates({
          segments,
          arcs,
          apparentScope,
          requireExplicitScope,
          worldPoint,
        }),
      );
    }

    if (constructionContext.lockedSnap && basePoint) {
      const lockedSegment = segments.find(
        (segment) =>
          (constructionContext.lockedSnap?.sourceSegmentId != null &&
            segment.segmentId === constructionContext.lockedSnap.sourceSegmentId) ||
          segment.sourceEntityId === constructionContext.lockedSnap?.sourceEntityId,
      ) ?? (constructionContext.lockedSnap.sourceSegmentId != null
        ? segmentById.get(constructionContext.lockedSnap.sourceSegmentId) ?? null
        : null);
      const lockedArc =
        constructionContext.lockedSnap.kind === 'tangent' ||
        constructionContext.lockedSnap.kind === 'perpendicular'
          ? // Segment-addressed locks (arc courses of a multi-course entity)
            // resolve their exact course first; the entity-id fallback is only
            // for legacy/standalone arcs that carry no segment identity.
            (constructionContext.lockedSnap.sourceSegmentId != null
              ? arcs.find(
                  (arc) =>
                    arc.segmentId === constructionContext.lockedSnap?.sourceSegmentId,
                ) ??
                arcBySegmentId.get(constructionContext.lockedSnap.sourceSegmentId) ??
                null
              : null) ??
            arcs.find((arc) => arc.sourceEntityId === constructionContext.lockedSnap?.sourceEntityId)
            ?? arcBySourceId.get(constructionContext.lockedSnap.sourceEntityId) ?? null
          : null;
      const tangentGuidePoint = constructionContext.lockedSnap.guidePoint ?? null;
      const lockedPoint =
        lockedArc && tangentGuidePoint
          ? cadProjectPointOntoInfiniteLine(worldPoint, basePoint, tangentGuidePoint).point
          : lockedSegment && constructionContext.lockedSnap.kind !== 'tangent'
            ? buildLockedConstructionPoint(
                constructionContext.lockedSnap.kind,
                lockedSegment,
                basePoint,
                worldPoint,
              )
            : null;
      if (lockedPoint) {
        const lockedSourceEntityId =
          constructionContext.lockedSnap.kind === 'tangent'
            ? lockedArc?.sourceEntityId ?? constructionContext.lockedSnap.sourceEntityId
            : lockedSegment?.sourceEntityId ?? constructionContext.lockedSnap.sourceEntityId;
        const lockedSourceEntity =
          lookup.entityById.get(lockedSourceEntityId) ?? null;
        const lockedSourceLabel = lockedArc?.label ?? (lockedSourceEntity ? getCadEntityDisplayLabel(lockedSourceEntity) : lockedSourceEntityId);
        const explicitLockedConstructionCandidate = buildCandidate(
          constructionContext.lockedSnap.kind,
          lockedSourceEntityId,
          lockedPoint,
          worldPoint,
          constructionContext.lockedSnap.kind === 'tangent'
            ? `${lockedSourceLabel} tangent`
            : `${lockedSegment?.label ?? lockedSourceLabel} ${
                constructionContext.lockedSnap.kind === 'extension'
                  ? 'ext'
                  : constructionContext.lockedSnap.kind === 'parallel'
                    ? 'parallel'
                    : 'perp'
              }`,
          constructionContext.lockedSnap.kind === 'tangent'
            ? [
                [basePoint, lockedPoint],
                ...(lockedArc ? [[lockedArc.center, tangentGuidePoint ?? lockedPoint] as [CadWorldPoint, CadWorldPoint]] : []),
              ]
            : lockedArc
              ? [
                  [basePoint, lockedPoint],
                  [lockedArc.center, basePoint],
                ]
              : [
                  [basePoint, lockedPoint],
                  [lockedSegment!.start, lockedSegment!.end],
                ],
          constructionContext.lockedSnap.sourceSegmentId,
          undefined,
          tangentGuidePoint ?? undefined,
        );
        candidates.push(explicitLockedConstructionCandidate);
        if (constructionContext.lockedSnap.kind !== 'extension') {
          candidates.push(
            ...buildLockedLineIntersectionCandidates(
              basePoint,
              lockedPoint,
              worldPoint,
              segments,
              arcs,
              constructionContext.lockedSnap.kind,
              lockedSourceEntityId,
            ),
          );
        }
      }
    }

    return dedupeCandidates(candidates)
      .filter(
        (candidate) =>
          candidate.distance <= toleranceWorld * SNAP_RANGE_MULTIPLIER[candidate.kind] ||
          candidateMatchesLockedSnap(candidate, constructionContext.lockedSnap),
      )
      .sort(candidateSort);
  };

  return {
    querySnapCandidates,
    queryNearestSnap: (
    worldPoint: CadWorldPoint,
    toleranceWorld: number,
    allowedKinds: readonly CadSnapKind[] = [
      'point-node',
      'endpoint',
      'midpoint',
      'center',
      'arc-midpoint',
      'quadrant',
      'intersection',
      'apparent-intersection',
      'extension',
      'perpendicular',
      'parallel',
      'tangent',
      'nearest',
    ],
    constructionContext: CadSnapConstructionContext = { active: false, basePoint: null },
    visibleBounds: CadBounds | null = null,
  ) => {
    const viable = querySnapCandidates(
      worldPoint,
      toleranceWorld,
      allowedKinds,
      constructionContext,
      visibleBounds,
    );
    const lockedConstructionCandidate =
      ((constructionContext.lockedSnap
        ? viable.find(
            (candidate) =>
              candidate.kind === constructionContext.lockedSnap?.kind &&
              candidateMatchesLockedSnap(candidate, constructionContext.lockedSnap),
          ) ?? null
        : null) ??
      viable.find((candidate) =>
        CONSTRUCTION_LOCK_KINDS.includes(candidate.kind),
      ) ??
      null);
    if (lockedConstructionCandidate) {
      const compoundCandidate = viable
        .filter((candidate) =>
          candidate.id !== lockedConstructionCandidate.id &&
          candidate.kind !== 'nearest' &&
          !CONSTRUCTION_LOCK_KINDS.includes(candidate.kind) &&
          pointOnCandidateLine(candidate, lockedConstructionCandidate, toleranceWorld),
        )
        .sort(compoundCandidateSort)[0];
      if (compoundCandidate) {
        return buildCompoundConstructionCandidate(lockedConstructionCandidate, compoundCandidate);
      }
    }
    return viable[0] ?? null;
  },
  };
};
