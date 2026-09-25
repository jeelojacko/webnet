import { describe, expect, it } from 'vitest';
import {
  canonicalRefs,
  checkSelectionForCommit,
  filterRefsBySource,
  invertRefs,
  pointInPolygon,
  polygonSelfIntersects,
  refsInPolygon,
  refsInWindow,
  selectableSurfacePoints,
  syntheticExcludedCount,
  SURFACE_SELECTION_EMPTY_MESSAGE,
  type SurfaceVertexSelection,
} from '../src/hooks/surveyCad/surfaceBulkSelectionUtils';

/*
 * Phase 18V selection oracles (pure): window/polygon resolution to stable
 * refs, synthetic exclusion, deterministic canonical order, the commit gate
 * (empty ⇒ no edit, stale ⇒ reselect), and source-kind filtering.
 */

type Pt = { entityId: string; x: number; y: number };

const sourcePoint = (id: string, x: number, y: number): Pt => ({ entityId: `pt:${id}`, x, y });
const importedPoint = (payload: string, index: number, x: number, y: number): Pt => ({
  entityId: `${payload}:v${index}`,
  x,
  y,
});
const keyword = (key: string): { key: string } => ({ key });

const meshOf = (points: Pt[]): Pt[] => points;

describe('18V selection — window', () => {
  it('inclusive-rect includes boundary points on the current final mesh', () => {
    const points = meshOf([sourcePoint('a', 0, 0), sourcePoint('b', 5, 5), sourcePoint('c', 10, 0)]);
    const entries = selectableSurfacePoints('native', 'surf', points);
    const inWindow = refsInWindow(entries, { x: 5, y: 5 }, { x: 0, y: 0 });
    expect(inWindow.map((ref) => ref.key)).toEqual(['source:pt:a', 'source:pt:b']);
  });
});

describe('18V selection — polygon oracle', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('inside / boundary / vertex / outside are classified deterministically', () => {
    expect(pointInPolygon(square, { x: 5, y: 5 })).toBe(true);
    expect(pointInPolygon(square, { x: 5, y: 0 })).toBe(true); // edge
    expect(pointInPolygon(square, { x: 0, y: 0 })).toBe(true); // vertex
    expect(pointInPolygon(square, { x: 15, y: 5 })).toBe(false);
    expect(pointInPolygon(square, { x: -1, y: 5 })).toBe(false);
  });

  it('resolves refs in canonical lexicographic order regardless of input order', () => {
    const points = meshOf([
      sourcePoint('z', 9, 9),
      sourcePoint('a', 1, 1),
      sourcePoint('m', 5, 5),
      sourcePoint('out', 50, 50),
    ]);
    const entries = selectableSurfacePoints('native', 'surf', points);
    const poly = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(refsInPolygon(entries, poly).map((ref) => ref.key)).toEqual([
      'source:pt:a',
      'source:pt:m',
      'source:pt:z',
    ]);
    // Reversing the mesh point order does not change the canonical result.
    expect(refsInPolygon([...entries].reverse(), poly).map((ref) => ref.key)).toEqual([
      'source:pt:a',
      'source:pt:m',
      'source:pt:z',
    ]);
  });

  it('self-intersecting (bowtie) polygon blocks and selects nothing', () => {
    const bowtie = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(polygonSelfIntersects(bowtie)).toBe(true);
    const entries = selectableSurfacePoints('native', 'surf', meshOf([sourcePoint('a', 5, 5)]));
    expect(refsInPolygon(entries, bowtie)).toEqual([]);
    // A valid convex polygon over the same point is not flagged.
    expect(polygonSelfIntersects(square)).toBe(false);
    expect(refsInPolygon(entries, square).map((ref) => ref.key)).toEqual(['source:pt:a']);
  });
});

describe('18V selection — synthetic exclusion + filters', () => {
  it('excludes synthetic boundary/Steiner vertices and reports the count', () => {
    const nativePoints: Pt[] = [
      sourcePoint('a', 0, 0),
      { entityId: 'boundary:ring', x: 2, y: 2 },
      { entityId: 'steiner:0', x: 3, y: 3 },
    ];
    const nativeEntries = selectableSurfacePoints('native', 'surf', nativePoints);
    expect(nativeEntries.map((entry) => entry.ref.key)).toEqual(['source:pt:a']);
    expect(syntheticExcludedCount('native', 'surf', nativePoints)).toBe(2);
    // Synthetic vertices never appear in an All/window/polygon selection.
    expect(refsInWindow(nativeEntries, { x: -1, y: -1 }, { x: 10, y: 10 }).map((ref) => ref.key)).toEqual(['source:pt:a']);
    // Imported TIN meshes resolve `<payload>:v<index>` ids to imported refs.
    const importedPoints: Pt[] = [importedPoint('imp', 0, 1, 1), { entityId: 'boundary:ring', x: 2, y: 2 }];
    expect(selectableSurfacePoints('imported-tin', 'surf', importedPoints).map((entry) => entry.ref.key)).toEqual([
      'imported:imp:0',
    ]);
    expect(syntheticExcludedCount('imported-tin', 'surf', importedPoints)).toBe(1);
  });

  it('source-kind filter keeps only the requested producer kind', () => {
    const pool = [
      keyword('source:pt:a'),
      keyword('imported:imp:v0'),
      keyword('edit:surf:e1'),
      keyword('source:pt:b'),
    ];
    expect(filterRefsBySource(pool, 'all')).toHaveLength(4);
    expect(filterRefsBySource(pool, 'source').map((ref) => ref.key)).toEqual(['source:pt:a', 'source:pt:b']);
    expect(filterRefsBySource(pool, 'imported').map((ref) => ref.key)).toEqual(['imported:imp:v0']);
    expect(filterRefsBySource(pool, 'added').map((ref) => ref.key)).toEqual(['edit:surf:e1']);
  });

  it('canonical refs dedupe and sort lexicographically', () => {
    expect(canonicalRefs([keyword('b'), keyword('a'), keyword('b'), keyword('c')]).map((ref) => ref.key)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('invert selects the editable complement of the current selection', () => {
    const entries = selectableSurfacePoints('native', 'surf', [
      sourcePoint('a', 0, 0),
      sourcePoint('b', 1, 1),
      sourcePoint('c', 2, 2),
    ]);
    expect(invertRefs(entries, [keyword('source:pt:b')]).map((ref) => ref.key)).toEqual([
      'source:pt:a',
      'source:pt:c',
    ]);
  });
});

describe('18V selection — commit gate (§101/§102)', () => {
  const selection = (revision: string, keys: string[]): SurfaceVertexSelection => ({
    surfaceId: 'surf',
    revision,
    refs: keys.map(keyword),
  });

  it('empty selection ⇒ empty (no edit, no undo entry, reported)', () => {
    expect(checkSelectionForCommit(selection('r1', []), 'r1')).toBe('empty');
    expect(checkSelectionForCommit(null, 'r1')).toBe('empty');
    expect(SURFACE_SELECTION_EMPTY_MESSAGE).toBe('No editable surface vertices selected.');
  });

  it('stale selection blocks and demands a reselect', () => {
    // §101 — a source/surface change bumps the revision after selection.
    expect(checkSelectionForCommit(selection('r1', ['source:pt:a']), 'r2')).toBe('stale');
    // Missing current revision is stale too (never applied against a missing mesh).
    expect(checkSelectionForCommit(selection('r1', ['source:pt:a']), null)).toBe('stale');
  });

  it('a selection matching the current revision is committable', () => {
    expect(checkSelectionForCommit(selection('r2', ['source:pt:a']), 'r2')).toBe('ok');
  });
});
