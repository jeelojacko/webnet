import { useCallback, useMemo, useState } from 'react';
import type { CadDisplayPrimitive } from '../../engine/cad/cadDisplayTypes';
import {
  polygonPrimitives,
  selectedPointPrimitives,
  windowPrimitives,
  type SurfaceBulkSelectSession,
} from './surfaceBulkEditSessionUtils';
import {
  canonicalRefs,
  filterRefsBySource,
  invertRefs,
  polygonSelfIntersects,
  refsInPolygon,
  refsInWindow,
  selectableSurfacePoints,
  syntheticExcludedCount,
  SURFACE_SELECTION_NEEDS_SURFACE,
  SURFACE_SELECTION_POLYGON_DEGENERATE,
  SURFACE_SELECTION_POLYGON_SELF_INTERSECT,
  type SurfaceSelectionMode,
  type SurfaceSelectionSourceFilter,
  type SurfaceVertexRef,
  type SurfaceVertexSelection,
  type Xy,
} from './surfaceBulkSelectionUtils';
import { meshOf, SURFACE_POINT_EDIT_STALE_MESSAGE, type Deps } from './surfacePointEditSessionUtils';

/**
 * Phase 18V SURFSELECTPOINTS session (UI state only). Window = inclusive
 * rectangle over current final-mesh points; polygon = point-chain accumulate
 * with deterministic point-in-polygon (boundary included, self-intersecting
 * blocked); All = every stable editable ref; Clear = none. Synthetic
 * boundary/Steiner vertices are excluded and reported. The selection is
 * revision-bound and never persists.
 */

export interface SurfaceSelectionStateSummary {
  surfaceId: string | null;
  count: number;
  syntheticExcluded: number;
  stale: boolean;
  filter: SurfaceSelectionSourceFilter;
}

interface SelectionStore {
  surfaceId: string;
  surfaceName: string;
  revision: string;
  /** All picked refs before the source filter (canonical). */
  pool: SurfaceVertexRef[];
  filter: SurfaceSelectionSourceFilter;
}

const kindOf = (surface: { definition: { sourceKind?: string } }): 'native' | 'imported-tin' =>
  surface.definition.sourceKind === 'imported-tin' ? 'imported-tin' : 'native';

export const useSurveyCadSurfaceBulkSelection = (deps: Deps) => {
  const [store, setStore] = useState<SelectionStore | null>(null);
  const [session, setSession] = useState<SurfaceBulkSelectSession | null>(null);

  const selection: SurfaceVertexSelection | null = useMemo(
    () => (store
      ? { surfaceId: store.surfaceId, revision: store.revision, refs: filterRefsBySource(store.pool, store.filter) }
      : null),
    [store],
  );

  const cancel = useCallback((): void => setSession(null), []);

  const clearSelection = useCallback((): void => {
    setStore(null);
    setSession(null);
  }, []);

  const setFilter = useCallback((filter: SurfaceSelectionSourceFilter): void => {
    setStore((previous) => (previous ? { ...previous, filter } : previous));
  }, []);

  const startSelection = useCallback((mode: SurfaceSelectionMode): boolean => {
    const surface = (deps.project.surfaces ?? []).find((entry) => entry.id === deps.selectedSurfaceId);
    if (!surface) {
      deps.notify(SURFACE_SELECTION_NEEDS_SURFACE);
      return false;
    }
    const live = meshOf(deps, surface.id);
    if (!live) {
      deps.notify(SURFACE_POINT_EDIT_STALE_MESSAGE);
      return false;
    }
    if (mode === 'clear') {
      clearSelection();
      deps.notify('Surface point selection cleared.');
      return true;
    }
    const sourceKind = kindOf(surface);
    const entries = selectableSurfacePoints(sourceKind, surface.id, live.mesh.points);
    if (mode === 'all' || mode === 'invert') {
      const syntheticExcluded = syntheticExcludedCount(sourceKind, surface.id, live.mesh.points);
      const current = mode === 'invert' && store?.surfaceId === surface.id
        ? filterRefsBySource(store.pool, store.filter)
        : [];
      const pool = mode === 'all' ? entries.map((entry) => entry.ref) : invertRefs(entries, current);
      setStore((previous) => ({
        surfaceId: surface.id,
        surfaceName: surface.name,
        revision: live.revision,
        pool,
        filter: previous?.surfaceId === surface.id ? previous.filter : 'all',
      }));
      setSession(null);
      deps.notify(
        `${pool.length} editable surface vertices selected${syntheticExcluded > 0 ? ` (${syntheticExcluded} synthetic excluded)` : ''}.`,
      );
      return true;
    }
    const prompt = mode === 'window'
      ? `SURFSELECTPOINTS window on “${surface.name}”: pick the first corner, then the opposite corner, Enter selects, Esc ends.`
      : `SURFSELECTPOINTS polygon on “${surface.name}”: pick points around the region, Enter selects (self-intersection blocks), Esc ends.`;
    setSession({
      kind: 'select',
      mode,
      surfaceId: surface.id,
      surfaceName: surface.name,
      revision: live.revision,
      points: [],
      previewRefs: [],
      issue: null,
      prompt,
    });
    deps.notify(prompt);
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, deps.project, deps.cache, deps.selectedSurfaceId, deps.buildingSurfaceIds, deps.notify]);

  const handlePick = useCallback((worldPoint: Xy): void => {
    if (!session) return;
    const live = meshOf(deps, session.surfaceId);
    if (!live) {
      deps.notify(SURFACE_POINT_EDIT_STALE_MESSAGE);
      setSession(null);
      return;
    }
    const entries = selectableSurfacePoints(kindOf(live.surface), live.surface.id, live.mesh.points);
    if (session.mode === 'window') {
      const points = session.points.length === 0 ? [worldPoint] : [session.points[0], worldPoint];
      const previewRefs = points.length === 2 ? refsInWindow(entries, points[0], points[1]) : [];
      setSession({
        ...session,
        points,
        previewRefs,
        issue: null,
        prompt: points.length === 2
          ? `Window staged on “${session.surfaceName}” (${previewRefs.length} vertices inside) — Enter selects, click again to restage, Esc ends.`
          : session.prompt,
      });
      return;
    }
    const points = [...session.points, worldPoint];
    const selfIntersect = points.length >= 3 && polygonSelfIntersects(points);
    const previewRefs = points.length >= 3 && !selfIntersect ? refsInPolygon(entries, points) : [];
    setSession({
      ...session,
      points,
      previewRefs,
      issue: selfIntersect ? SURFACE_SELECTION_POLYGON_SELF_INTERSECT : null,
      prompt: selfIntersect
        ? `Polygon on “${session.surfaceName}” is self-intersecting (${SURFACE_SELECTION_POLYGON_SELF_INTERSECT}) — pick again or Esc.`
        : `Polygon staged on “${session.surfaceName}” (${points.length} vertices, ${previewRefs.length} inside) — Enter selects, click to add, Esc ends.`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, deps.project, deps.cache, deps.buildingSurfaceIds]);

  const handleEnter = useCallback((): boolean => {
    if (!session) return false;
    if (session.mode === 'window' && session.points.length < 2) return false;
    if (session.mode === 'polygon' && session.points.length < 3) {
      deps.notify(`Polygon needs at least three picks (${SURFACE_SELECTION_POLYGON_DEGENERATE}).`);
      return true;
    }
    if (session.issue) {
      deps.notify(`Polygon self-intersecting (${session.issue}) — no selection; pick again or Esc.`);
      return true;
    }
    const live = meshOf(deps, session.surfaceId);
    if (!live || live.revision !== session.revision) {
      deps.notify(SURFACE_POINT_EDIT_STALE_MESSAGE);
      setSession(null);
      return true;
    }
    const sourceKind = kindOf(live.surface);
    setStore((previous) => ({
      surfaceId: session.surfaceId,
      surfaceName: session.surfaceName,
      revision: session.revision,
      pool: canonicalRefs(session.previewRefs),
      filter: previous?.surfaceId === session.surfaceId ? previous.filter : 'all',
    }));
    setSession(null);
    const syntheticExcluded = syntheticExcludedCount(sourceKind, session.surfaceId, live.mesh.points);
    deps.notify(
      `${session.previewRefs.length} editable surface vertices selected${syntheticExcluded > 0 ? ` (${syntheticExcluded} synthetic excluded)` : ''}.`,
    );
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, deps.project, deps.cache, deps.buildingSurfaceIds]);

  const summary = useMemo<SurfaceSelectionStateSummary>(() => {
    const surfaceId = store?.surfaceId ?? null;
    const live = surfaceId ? meshOf(deps, surfaceId) : null;
    return {
      surfaceId,
      count: selection?.refs.length ?? 0,
      syntheticExcluded: live && surfaceId ? syntheticExcludedCount(kindOf(live.surface), surfaceId, live.mesh.points) : 0,
      stale: store != null && (live == null || live.revision !== store.revision),
      filter: store?.filter ?? 'all',
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, store, deps.project, deps.cache, deps.buildingSurfaceIds]);

  const previewPrimitives = useMemo<CadDisplayPrimitive[]>(() => {
    const surfaceId = session?.surfaceId ?? store?.surfaceId;
    const surface = (deps.project.surfaces ?? []).find((entry) => entry.id === surfaceId);
    const layerId = surface?.layerId ?? 'general';
    const live = surfaceId ? meshOf(deps, surfaceId) : null;
    if (session) {
      const primitives = session.mode === 'window'
        ? windowPrimitives(layerId, session.points)
        : polygonPrimitives(layerId, session.points);
      return [
        ...primitives,
        ...(live ? selectedPointPrimitives(layerId, live.mesh, session.previewRefs, '#22c55e') : []),
      ];
    }
    if (live && store && store.surfaceId === surfaceId) {
      return selectedPointPrimitives(layerId, live.mesh, filterRefsBySource(store.pool, store.filter), '#22d3ee');
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, store, deps.project, deps.cache]);

  return { selection, summary, session, startSelection, cancel, clearSelection, setFilter, handlePick, handleEnter, previewPrimitives };
};
