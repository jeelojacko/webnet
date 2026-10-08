import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCadSpatialIndex } from '../../engine/cad/cadSpatialIndex';
import {
  cadSnapCandidateEqual,
  cadSnapListEqual,
  cadSnapLockEqual,
} from './cadSnapEquality';
import { getCadEntitySubpartDisplayLabel } from '../../engine/cad/cadEntityNames';
import type {
  CadBounds,
  CadGripHandle,
  CadProject,
  CadSnapCandidate,
  CadSnapConstructionContext,
  CadSnapLock,
  CadSnapKind,
} from '../../engine/cad/cadTypes';

const FALLBACK_TOLERANCE_RATIO = 0.01;
const SNAP_KIND_ORDER: CadSnapKind[] = [
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
  'direction',
  'tangent',
  'nearest',
];

export type CadSnapPreferences = Record<CadSnapKind, boolean>;

const DEFAULT_SNAP_PREFERENCES: CadSnapPreferences = {
  'point-node': true,
  endpoint: true,
  midpoint: true,
  center: true,
  'arc-midpoint': true,
  quadrant: true,
  intersection: true,
  'apparent-intersection': true,
  extension: true,
  perpendicular: true,
  parallel: true,
  direction: true,
  tangent: true,
  nearest: true,
};

const toleranceFromBounds = (project: CadProject): number => {
  if (!project.bounds) return 1;
  return Math.max(
    Math.max(project.bounds.maxX - project.bounds.minX, project.bounds.maxY - project.bounds.minY) *
      FALLBACK_TOLERANCE_RATIO,
    0.5,
  );
};

interface UseSurveyCadSnappingResult {
  activeSnap: CadSnapCandidate | null;
  nearbySnaps: readonly CadSnapCandidate[];
  /** Reactive pointer state committed only while a command needs a live preview. */
  pointerWorldPoint: { x: number; y: number } | null;
  /** Always-fresh pointer (updated imperatively on every move, never stale). */
  pointerWorldPointRef: { current: { x: number; y: number } | null };
  /** Imperative cursor channel for leaf consumers (shell readout) without root commits. */
  subscribePointerWorldPoint: (
    _listener: (_point: { x: number; y: number } | null) => void,
  ) => () => void;
  snapPreferences: CadSnapPreferences;
  updatePointerWorldPoint: (
    _worldPoint: { x: number; y: number } | null,
    _toleranceWorld?: number,
    _options?: {
      lockConstruction?: boolean;
      visibleBounds?: CadBounds | null;
      restrictedGripHandles?: readonly CadGripHandle[];
      /** Commit narrow pointer state for live command previews. */
      reactivePreview?: boolean;
    },
  ) => void;
  cycleActiveSnap: () => void;
  setSnapPreference: (_kind: CadSnapKind, _enabled: boolean) => void;
}

const CONSTRUCTION_LOCK_KINDS = new Set<CadSnapKind>(['extension', 'perpendicular', 'parallel', 'tangent']);
const isConstructionLockKind = (
  kind: CadSnapKind,
): kind is CadSnapLock['kind'] => CONSTRUCTION_LOCK_KINDS.has(kind);

/**
 * Purely additive stamp: annotate a snap candidate with the world tolerance
 * (viewport-scale proxy) and viewport generation it was computed at. Existing
 * consumers ignore the extra optional fields; the corrected L1 on-source pick
 * uses the generation to reject a candidate computed before ANY viewport
 * transform (zoom, pan, extents, programmatic reset) and the tolerance for the
 * distance/radius revalidation.
 */
export const withCadSnapViewportStamp = (
  candidate: CadSnapCandidate,
  computedScale: number,
  viewportGeneration: number,
): CadSnapCandidate => ({ ...candidate, computedScale, viewportGeneration });

export const useSurveyCadSnapping = (
  project: CadProject,
  constructionContext: CadSnapConstructionContext,
  viewportGenerationRef?: { current: number },
): UseSurveyCadSnappingResult => {
  const spatialIndex = useMemo(() => buildCadSpatialIndex(project), [project]);
  const [activeSnap, setActiveSnap] = useState<CadSnapCandidate | null>(null);
  const [nearbySnaps, setNearbySnaps] = useState<CadSnapCandidate[]>([]);
  const [pointerWorldPoint, setPointerWorldPoint] = useState<{ x: number; y: number } | null>(null);
  const [snapPreferences, setSnapPreferences] = useState<CadSnapPreferences>(DEFAULT_SNAP_PREFERENCES);
  const [lockedConstructionSnap, setLockedConstructionSnap] = useState<CadSnapLock | null>(null);
  const pointerWorldPointRef = useRef<{ x: number; y: number } | null>(null);
  const pointerWorldPointListenersRef = useRef(
    new Set<(_point: { x: number; y: number } | null) => void>(),
  );
  const notifyPointerWorldPoint = useCallback(
    (worldPoint: { x: number; y: number } | null) => {
      pointerWorldPointRef.current = worldPoint;
      pointerWorldPointListenersRef.current.forEach((listener) => listener(worldPoint));
    },
    [],
  );
  const subscribePointerWorldPoint = useCallback(
    (listener: (_point: { x: number; y: number } | null) => void) => {
      pointerWorldPointListenersRef.current.add(listener);
      return () => {
        pointerWorldPointListenersRef.current.delete(listener);
      };
    },
    [],
  );
  const toleranceWorld = useMemo(() => toleranceFromBounds(project), [project]);
  const allowedKinds = useMemo(
    () => SNAP_KIND_ORDER.filter((kind) => snapPreferences[kind]),
    [snapPreferences],
  );
  useEffect(() => {
    notifyPointerWorldPoint(null);
    setActiveSnap((current) => (current == null ? current : null));
    setNearbySnaps((current) => (cadSnapListEqual(current, []) ? current : []));
    setPointerWorldPoint((current) => (current == null ? current : null));
    setLockedConstructionSnap((current) => (current == null ? current : null));
  }, [project, constructionContext.basePoint?.x, constructionContext.basePoint?.y, notifyPointerWorldPoint]);

  return {
    activeSnap,
    nearbySnaps,
    pointerWorldPoint,
    pointerWorldPointRef,
    subscribePointerWorldPoint,
    snapPreferences,
    updatePointerWorldPoint: (worldPoint, dynamicToleranceWorld, options) => {
      notifyPointerWorldPoint(worldPoint);
      if (options?.reactivePreview || worldPoint == null) {
        setPointerWorldPoint(worldPoint);
      }
      if (!worldPoint) {
        setActiveSnap((current) => (current == null ? current : null));
        setNearbySnaps((current) => (cadSnapListEqual(current, []) ? current : []));
        if (!options?.lockConstruction) {
          setLockedConstructionSnap((current) => (current == null ? current : null));
        }
        return;
      }
      const transientConstructionLock =
        !options?.lockConstruction && activeSnap && isConstructionLockKind(activeSnap.kind)
          ? {
              kind: activeSnap.kind,
              sourceEntityId: activeSnap.sourceEntityId.split('|')[0] ?? activeSnap.sourceEntityId,
              sourceSegmentId: activeSnap.sourceSegmentId,
              guidePoint: activeSnap.lockGuidePoint ?? { x: activeSnap.x, y: activeSnap.y },
            }
          : null;
      const restrictedGripCandidates: CadSnapCandidate[] = (options?.restrictedGripHandles ?? []).map((handle) => ({
        id: `grip-snap:${handle.id}`,
        kind:
          handle.kind === 'line-start' ||
          handle.kind === 'line-end' ||
          handle.kind === 'arc-start' ||
          handle.kind === 'arc-end'
            ? 'endpoint'
            : 'point-node',
        sourceEntityId: handle.entityId,
        x: handle.x,
        y: handle.y,
        distance: 0,
        label:
          handle.kind === 'line-start'
            ? getCadEntitySubpartDisplayLabel(project, handle.entityId, 'line-start')
            : handle.kind === 'line-end'
              ? getCadEntitySubpartDisplayLabel(project, handle.entityId, 'line-end')
              : handle.kind === 'arc-start'
                ? getCadEntitySubpartDisplayLabel(project, handle.entityId, 'arc-start')
                : handle.kind === 'arc-end'
                  ? getCadEntitySubpartDisplayLabel(project, handle.entityId, 'arc-end')
                  : handle.kind === 'arc-radius'
                    ? getCadEntitySubpartDisplayLabel(project, handle.entityId, 'arc-radius')
                    : getCadEntitySubpartDisplayLabel(project, handle.entityId, 'vertex', {
                        vertexIndex: handle.vertexIndex,
                      }),
      }));
      if (restrictedGripCandidates.length > 0) {
        const gripTolerance = dynamicToleranceWorld ?? toleranceWorld;
        const nextNearbySnaps = restrictedGripCandidates
          .filter((candidate) => allowedKinds.includes(candidate.kind))
          .map((candidate) =>
            withCadSnapViewportStamp(
              {
                ...candidate,
                distance: Math.hypot(candidate.x - worldPoint.x, candidate.y - worldPoint.y),
              },
              gripTolerance,
              viewportGenerationRef?.current ?? 0,
            ),
          )
          .filter((candidate) => candidate.distance <= gripTolerance)
          .sort((left, right) => {
            if (SNAP_KIND_ORDER.indexOf(left.kind) !== SNAP_KIND_ORDER.indexOf(right.kind)) {
              return SNAP_KIND_ORDER.indexOf(left.kind) - SNAP_KIND_ORDER.indexOf(right.kind);
            }
            if (Math.abs(left.distance - right.distance) > 1e-9) return left.distance - right.distance;
            return left.id.localeCompare(right.id, undefined, { numeric: true });
          });
        const nextActive = nextNearbySnaps[0] ?? null;
        setNearbySnaps((current) =>
          cadSnapListEqual(current, nextNearbySnaps) ? current : nextNearbySnaps,
        );
        setActiveSnap((current) =>
          cadSnapCandidateEqual(current, nextActive) ? current : nextActive,
        );
        if (!options?.lockConstruction) {
          setLockedConstructionSnap((current) => (current == null ? current : null));
        }
        return;
      }
      const snapTolerance = dynamicToleranceWorld ?? toleranceWorld;
      const nextNearbySnaps = spatialIndex
        .querySnapCandidates(
          worldPoint,
          snapTolerance,
          allowedKinds,
          {
            ...constructionContext,
            lockedSnap: options?.lockConstruction ? lockedConstructionSnap : transientConstructionLock,
          },
          options?.visibleBounds ?? null,
        )
        .map((candidate) =>
          withCadSnapViewportStamp(
            candidate,
            snapTolerance,
            viewportGenerationRef?.current ?? 0,
          ),
        );
      setNearbySnaps((current) =>
        cadSnapListEqual(current, nextNearbySnaps) ? current : nextNearbySnaps,
      );
      const nextSnapRaw = spatialIndex.queryNearestSnap(
        worldPoint,
        snapTolerance,
        allowedKinds,
        {
          ...constructionContext,
          lockedSnap: options?.lockConstruction ? lockedConstructionSnap : transientConstructionLock,
        },
        options?.visibleBounds ?? null,
      );
      const nextSnap = nextSnapRaw
        ? withCadSnapViewportStamp(
            nextSnapRaw,
            snapTolerance,
            viewportGenerationRef?.current ?? 0,
          )
        : null;
      setActiveSnap((current) => (cadSnapCandidateEqual(current, nextSnap) ? current : nextSnap));
      if (options?.lockConstruction) {
        const nextLock =
          lockedConstructionSnap ??
          (nextSnap && isConstructionLockKind(nextSnap.kind)
            ? {
                kind: nextSnap.kind,
                sourceEntityId: nextSnap.sourceEntityId.split('|')[0] ?? nextSnap.sourceEntityId,
                sourceSegmentId: nextSnap.sourceSegmentId,
                guidePoint: nextSnap.lockGuidePoint ?? { x: nextSnap.x, y: nextSnap.y },
              }
            : null);
        setLockedConstructionSnap((current) =>
          cadSnapLockEqual(current, nextLock) ? current : nextLock,
        );
        return;
      }
      setLockedConstructionSnap((current) => (current == null ? current : null));
    },
    cycleActiveSnap: () => {
      setActiveSnap((current) => {
        if (nearbySnaps.length <= 1) return current;
        const currentIndex = current ? nearbySnaps.findIndex((candidate) => candidate.id === current.id) : -1;
        return nearbySnaps[(currentIndex + 1 + nearbySnaps.length) % nearbySnaps.length] ?? current;
      });
    },
    setSnapPreference: (kind, enabled) => {
      setSnapPreferences((current) => {
        const next = { ...current, [kind]: enabled };
        if (!Object.values(next).some(Boolean)) {
          return current;
        }
        return next;
      });
      setActiveSnap((current) => (current?.kind === kind && !enabled ? null : current));
      setNearbySnaps((current) => current.filter((candidate) => candidate.kind !== kind || enabled));
    },
  };
};
