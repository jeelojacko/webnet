import { orient2d } from 'robust-predicates';
import { surfaceEditRefOfPointId } from '../../engine/cad/cadSurfaceEditPicking';

/*
 * Phase 18V surface point/region selection helpers (pure, no React, no
 * geometry writes). Selection resolves to stable refs (`source:` /
 * `imported:` / `edit:`) against the CURRENT final mesh; synthetic
 * boundary/Steiner vertices are never addressable. Window/polygon/pick math
 * lives here so the session hook stays thin and the oracle is unit-testable.
 *
 * Selection is session/UI-only: it never enters WNCAD, the definition, the
 * revision, or undo history. Bulk commands read it at commit against the
 * current expected revision; any surface/source change makes it stale.
 */

export type SurfaceSelectionMode = 'window' | 'polygon' | 'all' | 'clear' | 'invert';
export type SurfaceSelectionSourceFilter = 'all' | 'source' | 'imported' | 'added';

export interface SurfaceVertexRef {
  key: string;
}

export interface SurfaceVertexSelection {
  surfaceId: string;
  revision: string;
  /** Effective refs after the source filter, canonical lexicographic order, deduped. */
  refs: SurfaceVertexRef[];
}

export interface Xy {
  x: number;
  y: number;
}

/** One addressable final-mesh point paired with its stable ref. */
export interface SelectableSurfacePoint {
  point: Xy;
  ref: SurfaceVertexRef;
}

export const SURFACE_SELECTION_STALE_MESSAGE =
  'Surface points changed since selection (SURFACE_EDIT_STALE_REVISION) — reselect points.';
export const SURFACE_SELECTION_EMPTY_MESSAGE = 'No editable surface vertices selected.';
export const SURFACE_SELECTION_POLYGON_DEGENERATE = 'SURFACE_SELECT_POLYGON_DEGENERATE';
export const SURFACE_SELECTION_POLYGON_SELF_INTERSECT = 'SURFACE_SELECT_POLYGON_SELF_INTERSECT';
export const SURFACE_SELECTION_NEEDS_SURFACE = 'Select a surface first.';

export type SurfaceSelectionCommitCheck = 'ok' | 'stale' | 'empty';

/** Canonical ref list: lexicographic key order, deduped (matches the engine reuse). */
export const canonicalRefs = (refs: ReadonlyArray<SurfaceVertexRef>): SurfaceVertexRef[] =>
  [...new Set(refs.map((ref) => ref.key))].sort().map((key) => ({ key }));

export const refSourceKind = (key: string): 'source' | 'imported' | 'added' | 'other' =>
  key.startsWith('source:') ? 'source'
    : key.startsWith('imported:') ? 'imported'
      : key.startsWith('edit:') ? 'added'
        : 'other';

export const filterRefsBySource = (
  refs: ReadonlyArray<SurfaceVertexRef>,
  filter: SurfaceSelectionSourceFilter,
): SurfaceVertexRef[] =>
  filter === 'all' ? [...refs] : refs.filter((ref) => refSourceKind(ref.key) === filter);

/** Editable (non-synthetic) final-mesh entries with stable refs. */
export const selectableSurfacePoints = (
  sourceKind: 'native' | 'imported-tin',
  surfaceId: string,
  points: ReadonlyArray<{ entityId: string; x: number; y: number }>,
): SelectableSurfacePoint[] => {
  const out: SelectableSurfacePoint[] = [];
  for (const point of points) {
    const ref = surfaceEditRefOfPointId(sourceKind, surfaceId, point.entityId);
    if (ref) out.push({ point: { x: point.x, y: point.y }, ref });
  }
  return out;
};

/** Synthetic boundary/Steiner vertices are counted but never selectable. */
export const syntheticExcludedCount = (
  sourceKind: 'native' | 'imported-tin',
  surfaceId: string,
  points: ReadonlyArray<{ entityId: string; x: number; y: number }>,
): number => points.length - selectableSurfacePoints(sourceKind, surfaceId, points).length;

/** Inclusive-rect inside test over the current final-mesh points. */
export const refsInWindow = (
  entries: ReadonlyArray<SelectableSurfacePoint>,
  a: Xy,
  b: Xy,
): SurfaceVertexRef[] => {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return canonicalRefs(
    entries
      .filter((entry) => entry.point.x >= minX && entry.point.x <= maxX && entry.point.y >= minY && entry.point.y <= maxY)
      .map((entry) => entry.ref),
  );
};

/** Strict proper crossing (exact, no epsilon) — mirrored from the engine predicate. */
const properlyCrosses = (
  a: Xy, b: Xy, c: Xy, d: Xy,
): boolean => {
  const o1 = orient2d(a.x, a.y, b.x, b.y, c.x, c.y);
  const o2 = orient2d(a.x, a.y, b.x, b.y, d.x, d.y);
  const o3 = orient2d(c.x, c.y, d.x, d.y, a.x, a.y);
  const o4 = orient2d(c.x, c.y, d.x, d.y, b.x, b.y);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
};

const withinSegment = (a: Xy, b: Xy, p: Xy): boolean =>
  p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) &&
  p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);

const onSegment = (a: Xy, b: Xy, p: Xy): boolean =>
  orient2d(a.x, a.y, b.x, b.y, p.x, p.y) === 0 && withinSegment(a, b, p);

/** True when the polygon has a proper crossing, a vertex on a non-adjacent edge, or a zero-length edge. */
export const polygonSelfIntersects = (polygon: ReadonlyArray<Xy>): boolean => {
  const n = polygon.length;
  if (n < 3) return true;
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (a.x === b.x && a.y === b.y) return true;
  }
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      const c = polygon[j];
      const d = polygon[(j + 1) % n];
      // Adjacent edges share a vertex by construction; only test non-adjacent pairs.
      const adjacent =
        j === i || (j + 1) % n === i || (i + 1) % n === j;
      if (adjacent) continue;
      if (properlyCrosses(a, b, c, d)) return true;
      if (onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return true;
    }
  }
  return false;
};

/**
 * Winding-number point-in-polygon (exact orient2d, no division): boundary
 * and vertices count as inside. Deterministic for a fixed point chain.
 */
export const pointInPolygon = (polygon: ReadonlyArray<Xy>, p: Xy): boolean => {
  const n = polygon.length;
  if (n < 3) return false;
  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    if (onSegment(polygon[j], polygon[i], p)) return true;
  }
  let winding = 0;
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    if (a.y <= p.y) {
      if (b.y > p.y && orient2d(a.x, a.y, b.x, b.y, p.x, p.y) > 0) winding += 1;
    } else if (b.y <= p.y && orient2d(a.x, a.y, b.x, b.y, p.x, p.y) < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
};

/** Deterministic selected refs for a closed point chain; [] on degenerate/self-intersecting input. */
export const refsInPolygon = (
  entries: ReadonlyArray<SelectableSurfacePoint>,
  polygon: ReadonlyArray<Xy>,
): SurfaceVertexRef[] => {
  if (polygon.length < 3 || polygonSelfIntersects(polygon)) return [];
  return canonicalRefs(
    entries.filter((entry) => pointInPolygon(polygon, entry.point)).map((entry) => entry.ref),
  );
};

/** Every editable ref not in the current selection (canonical order). */
export const invertRefs = (
  entries: ReadonlyArray<SelectableSurfacePoint>,
  current: ReadonlyArray<SurfaceVertexRef>,
): SurfaceVertexRef[] => {
  const currentKeys = new Set(current.map((ref) => ref.key));
  return canonicalRefs(entries.filter((entry) => !currentKeys.has(entry.ref.key)).map((entry) => entry.ref));
};

/**
 * Commit gate: empty selection = no edit (no undo entry); a selection bound
 * to an older revision is stale and must be replaced by a fresh selection.
 */
export const checkSelectionForCommit = (
  selection: SurfaceVertexSelection | null,
  currentRevision: string | null,
): SurfaceSelectionCommitCheck => {
  if (!selection || selection.refs.length === 0) return 'empty';
  if (currentRevision == null || selection.revision !== currentRevision) return 'stale';
  return 'ok';
};

export type SurfaceBulkEditMode = 'set-elevation' | 'raise-lower' | 'move';

export const surfaceBulkModeLabel = (mode: SurfaceBulkEditMode): string =>
  mode === 'set-elevation' ? 'Set Selected Elevation'
    : mode === 'raise-lower' ? 'Raise/Lower Selected Points'
      : 'Move Selected Points';
