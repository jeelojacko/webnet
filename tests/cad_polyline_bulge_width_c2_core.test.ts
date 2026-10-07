import { describe, expect, it } from 'vitest';
import {
  CAD_PARCEL_BULGE_LINE_FLOOR,
  describeParcelArcCourse,
} from '../src/engine/cad/cadParcelArcGeometry';
import { cadDistance } from '../src/engine/cad/cadGeometry';
import {
  cadPolylineBulgeFromThreePoints,
  cadPolylineCourseCount,
  cadPolylineWidthAtFraction,
  revalidateCadPolylineVertexMove,
  sanitizeCadPolylinePath,
  validateCadPolylineSegmentMetadata,
} from '../src/engine/cad/cadPolylineGeometry';
import { cloneCadEntity } from '../src/engine/cad/cadPersistence';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import type { CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type {
  CadEntity,
  CadPolylineEntity,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
} from '../src/engine/cad/cadTypes';
import { buildBaseCadPropertiesProject } from './cadPropertiesTestSupport';

const A = { x: 0, y: 0 };
const B = { x: 10, y: 0 };
const C = { x: 10, y: 10 };

const AL = { ...A, label: 'A' };
const BL = { ...B, label: 'B' };
const CL = { ...C, label: 'C' };

const lineGeom: CadPolylineSegmentGeometry = { kind: 'line' };
const zeroWidth: CadPolylineSegmentWidth = { startWidth: 0, endWidth: 0 };

const base = (): CadHistoryState => createCadHistoryState(buildBaseCadPropertiesProject());

const onlyPolyline = (state: CadHistoryState): CadPolylineEntity => {
  const entity = state.present.project.entities.find(
    (candidate): candidate is CadPolylineEntity => candidate.type === 'polyline',
  );
  if (!entity) throw new Error('polyline missing');
  return entity;
};

const polylineEntity = (overrides: Partial<CadPolylineEntity> = {}): CadPolylineEntity => ({
  id: 'polyline:c2',
  type: 'polyline',
  layerId: 'observation-lines',
  visible: true,
  locked: false,
  vertices: [A, B, C].map(({ x, y }) => ({ x, y })),
  vertexLabels: ['A', 'B', 'C'],
  closed: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Schema + normalizer matrix
// ---------------------------------------------------------------------------

describe('C2 normalizer: legacy plain paths keep the C1 law', () => {
  it('open absent-metadata path stays byte-clean (no new keys)', () => {
    const result = sanitizeCadPolylinePath([AL, BL, CL], false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vertices).toEqual([A, B, C]);
    expect(result.vertexLabels).toEqual(['A', 'B', 'C']);
    expect(result.closed).toBe(false);
    expect('segmentGeometry' in result).toBe(false);
    expect('segmentWidths' in result).toBe(false);
  });

  it('closed absent-metadata path stores no duplicate closure vertex', () => {
    const result = sanitizeCadPolylinePath([AL, BL, CL, { ...AL }], true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vertices).toEqual([A, B, C]);
    expect(result.closed).toBe(true);
  });

  it('open adjacent duplicate dedupes with label alignment (legacy)', () => {
    const result = sanitizeCadPolylinePath([AL, { ...AL }, BL, { ...BL }, CL], false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vertices).toEqual([A, B, C]);
    expect(result.vertexLabels).toEqual(['A', 'B', 'C']);
  });

  it('open [A,B,A] keeps current open semantics', () => {
    const result = sanitizeCadPolylinePath([AL, BL, { ...AL }], false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vertices).toHaveLength(3);
    expect(result.vertexLabels).toEqual(['A', 'B', 'A']);
  });

  it('rejects below minimum retained vertices and closed <3 distinct', () => {
    expect(sanitizeCadPolylinePath([AL], false).ok).toBe(false);
    expect(sanitizeCadPolylinePath([AL, { ...AL }], false).ok).toBe(false);
    expect(sanitizeCadPolylinePath([AL, BL, { ...AL }], true).ok).toBe(false);
  });

  it('accepts a separate labels array and rejects a length mismatch', () => {
    const ok = sanitizeCadPolylinePath([A, B, C], false, undefined, undefined, ['a', 'b', 'c']);
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.vertexLabels).toEqual(['a', 'b', 'c']);
    expect(sanitizeCadPolylinePath([A, B, C], false, undefined, undefined, ['a']).ok).toBe(false);
  });
});

describe('C2 normalizer: metadata length + shape law', () => {
  it('open mixed array has exactly n-1 entries and is preserved', () => {
    const result = sanitizeCadPolylinePath(
      [AL, BL, CL],
      false,
      [{ kind: 'arc', bulge: 1 }, lineGeom],
      [{ startWidth: 0.2, endWidth: 0.2 }, zeroWidth],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.segmentGeometry).toEqual([{ kind: 'arc', bulge: 1 }, { kind: 'line' }]);
    expect(result.segmentWidths).toEqual([
      { startWidth: 0.2, endWidth: 0.2 },
      { startWidth: 0, endWidth: 0 },
    ]);
  });

  it('closed mixed array has exactly n entries', () => {
    const result = sanitizeCadPolylinePath(
      [AL, BL, CL],
      true,
      [lineGeom, lineGeom, { kind: 'arc', bulge: 1 }],
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.segmentGeometry).toHaveLength(3);
  });

  it('rejects short/long geometry and width arrays', () => {
    expect(sanitizeCadPolylinePath([AL, BL, CL], false, [lineGeom]).ok).toBe(false);
    expect(sanitizeCadPolylinePath([AL, BL, CL], false, [lineGeom, lineGeom, lineGeom]).ok).toBe(false);
    expect(
      sanitizeCadPolylinePath([AL, BL, CL], false, undefined, [zeroWidth]).ok,
    ).toBe(false);
    expect(
      sanitizeCadPolylinePath([AL, BL, CL], false, undefined, [zeroWidth, zeroWidth, zeroWidth]).ok,
    ).toBe(false);
  });

  it('rejects NaN/Inf/zero/sub-floor bulges and boolean-cast widths', () => {
    const arc = (bulge: number): CadPolylineSegmentGeometry => ({ kind: 'arc', bulge });
    for (const bulge of [NaN, Infinity, -Infinity, 0, CAD_PARCEL_BULGE_LINE_FLOOR / 10]) {
      expect(sanitizeCadPolylinePath([AL, BL, CL], false, [arc(bulge), lineGeom]).ok).toBe(false);
    }
    expect(
      sanitizeCadPolylinePath([AL, BL, CL], false, undefined, [{ startWidth: -1, endWidth: 0 }, zeroWidth]).ok,
    ).toBe(false);
    expect(
      sanitizeCadPolylinePath([AL, BL, CL], false, undefined, [{ startWidth: NaN, endWidth: 0 }, zeroWidth]).ok,
    ).toBe(false);
  });

  it('rejects interior adjacent duplicates rather than dedupe-shifting metadata', () => {
    const result = sanitizeCadPolylinePath([AL, { ...AL }, BL], false, [lineGeom, lineGeom]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('adjacent duplicate');
  });

  it('canonicalizes all-line geometry and all-zero widths to absent', () => {
    const result = sanitizeCadPolylinePath(
      [AL, BL, CL],
      false,
      [lineGeom, lineGeom],
      [zeroWidth, zeroWidth],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect('segmentGeometry' in result).toBe(false);
    expect('segmentWidths' in result).toBe(false);
  });
});

describe('C2 normalizer: redundant-final strip owns its metadata entry', () => {
  it('strips the zero-length outgoing entry and preserves the real closing course', () => {
    const result = sanitizeCadPolylinePath(
      [AL, BL, CL, { ...AL }],
      true,
      [lineGeom, lineGeom, { kind: 'arc', bulge: 1 }, lineGeom],
      [zeroWidth, zeroWidth, { startWidth: 0.2, endWidth: 0.2 }, zeroWidth],
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.vertices).toEqual([A, B, C]);
    expect(result.segmentGeometry).toEqual([lineGeom, lineGeom, { kind: 'arc', bulge: 1 }]);
    expect(result.segmentWidths).toEqual([
      { startWidth: 0, endWidth: 0 },
      { startWidth: 0, endWidth: 0 },
      { startWidth: 0.2, endWidth: 0.2 },
    ]);
  });

  it('fails closed when the stripped outgoing entry carries an arc or a nonzero width', () => {
    const arcOut = sanitizeCadPolylinePath(
      [AL, BL, CL, { ...AL }],
      true,
      [lineGeom, lineGeom, { kind: 'arc', bulge: 1 }, { kind: 'arc', bulge: 1 }],
    );
    expect(arcOut.ok).toBe(false);
    const widthOut = sanitizeCadPolylinePath(
      [AL, BL, CL, { ...AL }],
      true,
      undefined,
      [zeroWidth, zeroWidth, zeroWidth, { startWidth: 0.5, endWidth: 0.5 }],
    );
    expect(widthOut.ok).toBe(false);
  });
});

describe('C2 metadata validator: course-count law and direct numeric checks', () => {
  it('course count is n-1 open and n closed', () => {
    expect(cadPolylineCourseCount(3, false)).toBe(2);
    expect(cadPolylineCourseCount(3, true)).toBe(3);
  });

  it('detects zero-chord and near-full-circle arcs directly', () => {
    const zeroChord = validateCadPolylineSegmentMetadata(
      [A, { ...A }],
      false,
      [{ kind: 'arc', bulge: 1 }],
    );
    expect(zeroChord.ok).toBe(false);
    expect(zeroChord.issues.map((entry) => entry.code)).toContain('ZERO_CHORD_ARC');

    const nearFull = validateCadPolylineSegmentMetadata(
      [A, B],
      false,
      [{ kind: 'arc', bulge: 1e12 }],
    );
    expect(nearFull.ok).toBe(false);
    expect(nearFull.issues.map((entry) => entry.code)).toContain('SWEEP_NEAR_FULL_CIRCLE');
  });

  it('fails closed on sparse geometry/widths arrays (holes are not skipped)', () => {
    const sparseGeometry = new Array<CadPolylineSegmentGeometry>(2);
    sparseGeometry[1] = { kind: 'line' };
    const geometryResult = validateCadPolylineSegmentMetadata([A, B, C], false, sparseGeometry);
    expect(geometryResult.ok).toBe(false);
    expect(geometryResult.issues.map((entry) => entry.code)).toContain('INVALID_GEOMETRY_ENTRY');

    const sparseWidths = new Array<CadPolylineSegmentWidth>(2);
    sparseWidths[0] = { startWidth: 1, endWidth: 1 };
    const widthsResult = validateCadPolylineSegmentMetadata([A, B, C], false, undefined, sparseWidths);
    expect(widthsResult.ok).toBe(false);
    expect(widthsResult.issues.map((entry) => entry.code)).toContain('INVALID_WIDTH_ENTRY');
  });

  it('rejects a sparse metadata array through the path normalizer', () => {
    const sparseGeometry = new Array<CadPolylineSegmentGeometry>(2);
    sparseGeometry[1] = { kind: 'line' };
    expect(sanitizeCadPolylinePath([AL, BL, CL], false, sparseGeometry).ok).toBe(false);

    const sparseWidths = new Array<CadPolylineSegmentWidth>(2);
    sparseWidths[1] = zeroWidth;
    expect(sanitizeCadPolylinePath([AL, BL, CL], false, undefined, sparseWidths).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Arc math
// ---------------------------------------------------------------------------

describe('C2 arc math: shared parcel bulge seam', () => {
  it('positive bulge is CCW (left), negative is CW (right)', () => {
    const ccw = describeParcelArcCourse(A, B, 1);
    expect(ccw?.signedSweepDeg).toBeCloseTo(180, 9);
    expect(ccw?.direction).toBe('left');
    const cw = describeParcelArcCourse(A, B, -1);
    expect(cw?.signedSweepDeg).toBeCloseTo(-180, 9);
    expect(cw?.direction).toBe('right');
  });

  it('|b| = 1 is a semicircle (radius = half chord, center = midpoint)', () => {
    const metrics = describeParcelArcCourse(A, B, 1);
    expect(metrics?.deltaDeg).toBeCloseTo(180, 9);
    expect(metrics?.radius).toBeCloseTo(5, 9);
    expect(metrics?.center.x).toBeCloseTo(5, 9);
    expect(metrics?.center.y).toBeCloseTo(0, 9);
  });

  it('|b| > 1 is a major arc', () => {
    const metrics = describeParcelArcCourse(A, B, 2);
    expect(metrics).not.toBeNull();
    expect(metrics!.deltaDeg).toBeGreaterThan(180);
    expect(metrics!.deltaDeg).toBeLessThan(360);
  });

  it('3-point -> bulge -> metrics rides the circle through all three points', () => {
    const start = { x: 0, y: 0 };
    const through = { x: 5, y: -2 };
    const end = { x: 10, y: 0 };
    const bulge = cadPolylineBulgeFromThreePoints(start, through, end);
    expect(bulge).not.toBeNull();
    expect(bulge!).toBeGreaterThan(0);
    const metrics = describeParcelArcCourse(start, end, bulge!);
    expect(metrics).not.toBeNull();
    expect(cadDistance(metrics!.center, start)).toBeCloseTo(metrics!.radius, 6);
    expect(cadDistance(metrics!.center, through)).toBeCloseTo(metrics!.radius, 6);
    expect(cadDistance(metrics!.center, end)).toBeCloseTo(metrics!.radius, 6);
  });

  it('3-point collinear/coincident triples reject deterministically', () => {
    expect(cadPolylineBulgeFromThreePoints({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 })).toBeNull();
    expect(cadPolylineBulgeFromThreePoints({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBeNull();
  });

  it('near-full-circle bulges are blocked by the guard', () => {
    expect(describeParcelArcCourse(A, B, 1e12)).toBeNull();
    expect(describeParcelArcCourse(A, B, -1e12)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Width math
// ---------------------------------------------------------------------------

describe('C2 width math: zero / constant / tapered', () => {
  it('zero and constant widths are flat', () => {
    expect(cadPolylineWidthAtFraction({ startWidth: 0, endWidth: 0 }, 0.5)).toBe(0);
    expect(cadPolylineWidthAtFraction({ startWidth: 0.5, endWidth: 0.5 }, 0)).toBe(0.5);
    expect(cadPolylineWidthAtFraction({ startWidth: 0.5, endWidth: 0.5 }, 0.5)).toBe(0.5);
    expect(cadPolylineWidthAtFraction({ startWidth: 0.5, endWidth: 0.5 }, 1)).toBe(0.5);
  });

  it('tapered widths interpolate linearly at 0 / 0.5 / 1', () => {
    expect(cadPolylineWidthAtFraction({ startWidth: 0, endWidth: 1 }, 0)).toBe(0);
    expect(cadPolylineWidthAtFraction({ startWidth: 0, endWidth: 1 }, 0.5)).toBe(0.5);
    expect(cadPolylineWidthAtFraction({ startWidth: 0, endWidth: 1 }, 1)).toBe(1);
  });

  it('rejects non-finite widths and out-of-range fractions', () => {
    expect(cadPolylineWidthAtFraction({ startWidth: NaN, endWidth: 1 }, 0.5)).toBeNull();
    expect(cadPolylineWidthAtFraction({ startWidth: 0, endWidth: Infinity }, 0.5)).toBeNull();
    expect(cadPolylineWidthAtFraction({ startWidth: 0, endWidth: 1 }, -0.1)).toBeNull();
    expect(cadPolylineWidthAtFraction({ startWidth: 0, endWidth: 1 }, 1.1)).toBeNull();
    expect(cadPolylineWidthAtFraction({ startWidth: 0, endWidth: 1 }, NaN)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transaction atomicity
// ---------------------------------------------------------------------------

describe('C2 PLINE transaction: validation before mutation', () => {
  const runPline = (
    state: CadHistoryState,
    command: Parameters<typeof runCadCommand>[1],
  ): CadHistoryState => runCadCommand(state, command);

  it('malformed metadata mutates nothing (identity state, no history)', () => {
    const state = base();
    const next = runPline(state, {
      key: 'PLINE',
      vertices: [AL, BL, CL],
      segmentGeometry: [lineGeom],
    });
    expect(next).toBe(state);
    expect(next.undoStack).toHaveLength(0);
    expect(next.present.project.entities.some((entity) => entity.type === 'polyline')).toBe(false);
  });

  it('a sub-floor arc bulge rejects without mutation', () => {
    const state = base();
    const next = runPline(state, {
      key: 'PLINE',
      vertices: [AL, BL, CL],
      segmentGeometry: [{ kind: 'arc', bulge: 1e-15 }, lineGeom],
    });
    expect(next).toBe(state);
  });

  it('valid open mixed metadata commits one entity + one undo entry', () => {
    const state = runPline(base(), {
      key: 'PLINE',
      vertices: [AL, BL, CL],
      segmentGeometry: [{ kind: 'arc', bulge: 1 }, lineGeom],
      segmentWidths: [{ startWidth: 0.2, endWidth: 0.2 }, { startWidth: 0, endWidth: 0 }],
    });
    expect(state.undoStack).toHaveLength(1);
    const entity = onlyPolyline(state);
    expect(entity.closed).toBe(false);
    expect(entity.segmentGeometry).toEqual([{ kind: 'arc', bulge: 1 }, { kind: 'line' }]);
    expect(entity.segmentWidths).toEqual([
      { startWidth: 0.2, endWidth: 0.2 },
      { startWidth: 0, endWidth: 0 },
    ]);
    expect(state.present.selection.selectedEntityIds).toEqual([entity.id]);
    expect(state.commandState.prompt).toBe('PLINE committed with 3 vertices.');
    // Trailing key order: new fields after `closed`, before metadata.
    const keys = Object.keys(entity);
    expect(keys.indexOf('segmentGeometry')).toBeGreaterThan(keys.indexOf('closed'));
    expect(keys.indexOf('segmentWidths')).toBeGreaterThan(keys.indexOf('segmentGeometry'));
    expect(keys.indexOf('metadata')).toBeGreaterThan(keys.indexOf('segmentWidths'));
  });

  it('valid closed metadata stores no duplicate closure vertex and round-trips undo/redo', () => {
    const state = runPline(base(), {
      key: 'PLINE',
      vertices: [AL, BL, CL, { ...AL }],
      closed: true,
      segmentGeometry: [lineGeom, lineGeom, { kind: 'arc', bulge: 1 }, lineGeom],
    });
    expect(state.undoStack).toHaveLength(1);
    const entity = onlyPolyline(state);
    expect(entity.closed).toBe(true);
    expect(entity.vertices).toHaveLength(3);
    expect(entity.segmentGeometry).toEqual([lineGeom, lineGeom, { kind: 'arc', bulge: 1 }]);
    const undone = undoCadHistory(state);
    expect(undone.present.project.entities.some((candidate) => candidate.type === 'polyline')).toBe(false);
    const redone = redoCadHistory(undone);
    expect(onlyPolyline(redone).segmentGeometry).toHaveLength(3);
  });

  it('legacy PLINE still commits byte-shape compatible (no metadata keys)', () => {
    const state = runPline(base(), { key: 'PLINE', vertices: [AL, BL, CL] });
    const entity = onlyPolyline(state);
    expect('segmentGeometry' in entity).toBe(false);
    expect('segmentWidths' in entity).toBe(false);
    expect(entity.closed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Clone / persistence
// ---------------------------------------------------------------------------

describe('C2 clone: verbatim deep copy + fail-closed malformed load', () => {
  it('deep-copies geometry/width arrays and closed flag', () => {
    const entity = polylineEntity({
      closed: true,
      vertices: [A, B, C],
      segmentGeometry: [{ kind: 'arc', bulge: 1 }, lineGeom, lineGeom],
      segmentWidths: [{ startWidth: 0.1, endWidth: 0.2 }, zeroWidth, zeroWidth],
    });
    const cloned = cloneCadEntity(entity);
    if (cloned.type !== 'polyline') throw new Error('clone changed type');
    expect(cloned).toEqual(entity);
    expect(cloned.vertices[0]).not.toBe(entity.vertices[0]);
    expect(cloned.segmentGeometry?.[0]).not.toBe(entity.segmentGeometry?.[0]);
    expect(cloned.segmentWidths?.[0]).not.toBe(entity.segmentWidths?.[0]);
    cloned.segmentGeometry![0] = { kind: 'arc', bulge: 2 };
    cloned.segmentWidths![0]!.startWidth = 9;
    cloned.vertices[0]!.x = 99;
    expect(entity.segmentGeometry![0]).toEqual({ kind: 'arc', bulge: 1 });
    expect(entity.segmentWidths![0]!.startWidth).toBe(0.1);
    expect(entity.vertices[0]!.x).toBe(0);
  });

  it('legacy polyline clones byte-for-byte with no new keys', () => {
    const entity = polylineEntity();
    const cloned = cloneCadEntity(entity) as CadEntity;
    if (cloned.type !== 'polyline') throw new Error('clone changed type');
    expect('segmentGeometry' in cloned).toBe(false);
    expect('segmentWidths' in cloned).toBe(false);
    expect(JSON.stringify(cloned)).toBe(JSON.stringify(entity));
  });

  it('throws on malformed geometry length, sub-floor arc, and negative width', () => {
    const badLength = polylineEntity({ segmentGeometry: [lineGeom] });
    expect(() => cloneCadEntity(badLength)).toThrow();
    const badArc = polylineEntity({ segmentGeometry: [{ kind: 'arc', bulge: 1e-15 }, lineGeom] });
    expect(() => cloneCadEntity(badArc)).toThrow();
    const badWidth = polylineEntity({ segmentWidths: [{ startWidth: -0.1, endWidth: 0 }, zeroWidth] });
    expect(() => cloneCadEntity(badWidth)).toThrow();
  });

  it('throws the typed validation error on sparse metadata arrays (no uncaught hole skip)', () => {
    const sparseGeometry = new Array<CadPolylineSegmentGeometry>(2);
    sparseGeometry[1] = lineGeom;
    expect(() => cloneCadEntity(polylineEntity({ segmentGeometry: sparseGeometry }))).toThrow();
    const sparseWidths = new Array<CadPolylineSegmentWidth>(2);
    sparseWidths[0] = zeroWidth;
    expect(() => cloneCadEntity(polylineEntity({ segmentWidths: sparseWidths }))).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Grip/transform-core handoff seam
// ---------------------------------------------------------------------------

describe('C2 moved-vertex revalidation seam', () => {
  it('keeps valid metadata after a move but fails closed when an arc collapses', () => {
    const geometry: CadPolylineSegmentGeometry[] = [{ kind: 'arc', bulge: 1 }, lineGeom];
    const widths: CadPolylineSegmentWidth[] = [
      { startWidth: 0.1, endWidth: 0.1 },
      { startWidth: 0, endWidth: 0 },
    ];
    expect(revalidateCadPolylineVertexMove([A, { x: 10, y: 5 }, C], false, geometry, widths)).toEqual([]);
    const collapsed = revalidateCadPolylineVertexMove([A, { ...A }, C], false, geometry, widths);
    expect(collapsed.length).toBeGreaterThan(0);
  });
});
