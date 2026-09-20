import { cadProjectPointOntoInfiniteLine, type CadWorldPoint } from './cadGeometry';
import { getCadEntityDisplayLabel } from './cadEntityNames';
import type {
  CadArcEntity,
  CadBlockDefinition,
  CadBlockReferenceEntity,
  CadBounds,
  CadEntity,
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
import { buildCadSpatialEntitySnapCandidates } from './cadSpatialEntityCandidates';
import { arcRefFromEntity, entitySegments } from './cadSpatialEntityRefs';
import { blockReferenceBounds, expandBlockReference } from './cadBlocks';
import { buildCadProjectLookup } from './cadProjectLookup';
import type { CadArcRef, CadSegmentRef, CadSpatialIndex } from './cadSpatialIndexTypes';
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

interface PreparedBlock {
  entity: CadBlockReferenceEntity;
  definition: CadBlockDefinition;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type SnapEntity = CadLineEntity | CadPolylineEntity | CadPolygonEntity | CadParcelEntity | CadArcEntity;

const isSnapGeometry = (entity: CadEntity): entity is SnapEntity =>
  entity.type === 'line' ||
  entity.type === 'polyline' ||
  entity.type === 'polygon' ||
  entity.type === 'parcel' ||
  entity.type === 'arc';

const segmentBounds = (ref: CadSegmentRef): PreparedSegment => ({
  ref,
  minX: Math.min(ref.start.x, ref.end.x),
  minY: Math.min(ref.start.y, ref.end.y),
  maxX: Math.max(ref.start.x, ref.end.x),
  maxY: Math.max(ref.start.y, ref.end.y),
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
  const preparedBlocks: PreparedBlock[] = [];
  const segmentById = new Map<string, CadSegmentRef>();
  const arcBySourceId = new Map<string, CadArcRef>();

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
  const blockExpansionCache = new Map<string, { segments: CadSegmentRef[]; arcs: CadArcRef[] }>();
  const expandedBlockChildren = (block: PreparedBlock): { segments: CadSegmentRef[]; arcs: CadArcRef[] } => {
    const cached = blockExpansionCache.get(block.entity.id);
    if (cached) return cached;
    const empty = { segments: [], arcs: [] as CadArcRef[] };
    let children;
    try {
      children = expandBlockReference(block.definition, block.entity);
    } catch {
      blockExpansionCache.set(block.entity.id, empty);
      return empty;
    }
    const segments: CadSegmentRef[] = [];
    const arcs: CadArcRef[] = [];
    for (const child of children) {
      if (child.type === 'line' || child.type === 'polyline' || child.type === 'polygon') {
        segments.push(...entitySegments({ ...child, id: block.entity.id }));
      } else if (child.type === 'arc') {
        const ref = arcRefFromEntity(project, { ...child, id: block.entity.id });
        arcs.push({ ...ref, sourceEntityId: block.entity.id });
      }
    }
    const expanded = { segments, arcs };
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
      for (const block of preparedBlocks) {
        if (visibleQueryBounds && !intersectsBox(block.minX, block.minY, block.maxX, block.maxY, visibleQueryBounds)) continue;
        visibleEntities.push(block.entity);
        const expanded = expandedBlockChildren(block);
        segments.push(...expanded.segments);
        arcs.push(...expanded.arcs);
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
      }
    }
    const basePoint = constructionContext.active ? constructionContext.basePoint : null;
    const scopeSeedSegmentId = constructionContext.scopeSeedSegmentId ?? null;
    const scopeSeedSegment = scopeSeedSegmentId
      ? (segments.find((segment) => segment.segmentId === scopeSeedSegmentId) ?? segmentById.get(scopeSeedSegmentId) ?? null)
      : null;
    const tangentSeedArcEntityId = constructionContext.tangentSeedArcEntityId ?? null;
    const tangentSeedPoint = constructionContext.tangentSeedPoint ?? basePoint;
    const tangentSeedArc = tangentSeedArcEntityId
      ? (arcs.find((arc) => arc.sourceEntityId === tangentSeedArcEntityId) ?? arcBySourceId.get(tangentSeedArcEntityId) ?? null)
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
      candidates.push(...buildExactIntersectionCandidates({ segments, arcs, worldPoint }));
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
          ? arcs.find((arc) => arc.sourceEntityId === constructionContext.lockedSnap?.sourceEntityId)
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
