/**
 * First-class finite CadParabolaEntity (best-fit E1, Worker B): persistence,
 * analytic bounds, renderer tessellation error bound, spatial snaps/closest,
 * half-length midpoint, exact line intersection, transforms (incl. nonuniform
 * fail-closed), COPY/MOVE/ERASE, DXF approximation warning, LandXML omission,
 * block rejection, and trim/fillet refusal.
 */
import { describe, expect, it } from 'vitest';

import { createBlankCadProject, createBlankCadDrawingDocument, parseCadDrawingFile, serializeCadDrawingFile } from '../src/engine/cad/cadDrawingFile';
import { cloneCadEntity, cloneCadProject } from '../src/engine/cad/cadPersistence';
import { replaceCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { entityIntersectsBounds } from '../src/engine/cad/cadSpatialBounds';
import {
  buildCadSpatialEntitySnapCandidates,
  type CadSpatialEntityCandidateContext,
} from '../src/engine/cad/cadSpatialEntityCandidates';
import { buildCadSpatialIndex } from '../src/engine/cad/cadSpatialIndex';
import { buildExactIntersectionCandidates } from '../src/engine/cad/cadSpatialIntersectionCandidates';
import type { CadSegmentRef } from '../src/engine/cad/cadSpatialIndexTypes';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { buildMlightcadSpikeScene } from '../src/engine/cad/cadMlightcadAdapter';
import { classifyBlockSources } from '../src/engine/cad/cadBlockSources';
import { cadIntersectLineParabola } from '../src/engine/cad/cadCogoEntityIntersections';
import { isTrimmableEntity } from '../src/engine/cad/cadTransactionsTrimCommon';
import { buildCadTrimPreview } from '../src/engine/cad/cadTransactionsTrim';
import { buildCadExtendPreview } from '../src/engine/cad/cadTransactionsExtend';
import { buildCadFilletPreview } from '../src/engine/cad/cadTransactionsFilletPreview';
import {
  classifyTransform,
  reflectionAboutLine,
  rotationAbout,
  translation,
  uniformScaleAbout,
  type CadTransform2D,
} from '../src/engine/cad/cadTransform2D';
import { transformCadEntityGeometry } from '../src/engine/cad/cadTransformGeometry';
import {
  cadParabolaArcLength,
  cadParabolaAxisBasis,
  cadParabolaLineIntersection,
  cadParabolaParamPoint,
  type CanonicalParabola,
} from '../src/engine/cad/cadParabolaGeometry';
import {
  CAD_PARABOLA_TESSELLATION_CHORD_TOLERANCE,
  CAD_PARABOLA_TESSELLATION_MAX_SEGMENTS,
  cadParabolaAxisAzimuthDeg,
  cadParabolaEntityBounds,
  cadParabolaEntityClosestPoint,
  cadParabolaEntityEndpoints,
  cadParabolaEntityLength,
  cadParabolaEntityMidpoint,
  cadParabolaTessellatePoints,
  parabolaToCanonical,
  transformParabolaEntity,
} from '../src/engine/cad/cadParabola';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadLineEntity, CadParabolaEntity, CadPolylineEntity, CadProject } from '../src/engine/cad/cadTypes';

const PARABOLA: CadParabolaEntity = {
  id: 'cad-parabola:test',
  type: 'parabola',
  layerId: 'planning',
  visible: true,
  locked: false,
  vertexX: 0,
  vertexY: 0,
  axisAngleDeg: 0,
  focalLength: 1,
  tStart: -3,
  tEnd: 3,
};

const withParabola = (entity: CadParabolaEntity = PARABOLA): CadProject =>
  replaceCadProjectEntities(createBlankCadProject({ name: 'parabola', units: 'm' }), [entity]);

const canonical = (entity: CadParabolaEntity): CanonicalParabola => parabolaToCanonical(entity);

const sampleMany = (entity: CadParabolaEntity, count: number) => {
  const value = canonical(entity);
  return Array.from({ length: count + 1 }, (_unused, index) =>
    cadParabolaParamPoint(value, entity.tStart + ((entity.tEnd - entity.tStart) * index) / count),
  );
};

/** Perpendicular distance from a point to chord (a, b); degenerate chords read 0. */
const pointChordDistance = (
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point.x - (a.x + dx * clamped), point.y - (a.y + dy * clamped));
};

describe('parabola persistence and clone', () => {
  it('clones, round-trips through the drawing file, and preserves geometry verbatim', () => {
    const entity: CadParabolaEntity = { ...PARABOLA, axisAngleDeg: 37.5, focalLength: 2.25, tStart: -1.5, tEnd: 4.5 };
    const projected = withParabola(entity);
    expect(cloneCadEntity(entity)).toEqual(entity);
    expect(cloneCadProject(projected).entities).toEqual([entity]);

    const document = createBlankCadDrawingDocument({ name: 'roundtrip', units: 'm' });
    const text = serializeCadDrawingFile({
      ...document,
      project: replaceCadProjectEntities(document.project, [entity]),
    });
    const parsed = parseCadDrawingFile(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const restored = parsed.drawing.project.entities.find(
        (candidate): candidate is CadParabolaEntity => candidate.type === 'parabola',
      );
      expect(restored).toEqual(entity);
    }
  });

  it('rejects malformed persisted geometry (non-finite, sub-floor focal, collapsed range)', () => {
    expect(() => cloneCadEntity({ ...PARABOLA, focalLength: 0 })).toThrow();
    expect(() => cloneCadEntity({ ...PARABOLA, vertexX: Number.NaN })).toThrow();
    expect(() => cloneCadEntity({ ...PARABOLA, tStart: 2, tEnd: 2 })).toThrow();
  });
});

describe('parabola analytic bounds', () => {
  it('captures finite endpoints plus in-range dx/dt=0 and dy/dt=0 extrema', () => {
    const entity: CadParabolaEntity = { ...PARABOLA, axisAngleDeg: 30, focalLength: 2, tStart: -5, tEnd: 5 };
    const box = cadParabolaEntityBounds(entity)!;
    const samples = sampleMany(entity, 20000);
    expect(Math.abs(box.minX - Math.min(...samples.map((point) => point.x)))).toBeLessThan(1e-3);
    expect(Math.abs(box.maxX - Math.max(...samples.map((point) => point.x)))).toBeLessThan(1e-3);
    expect(Math.abs(box.minY - Math.min(...samples.map((point) => point.y)))).toBeLessThan(1e-3);
    expect(Math.abs(box.maxY - Math.max(...samples.map((point) => point.y)))).toBeLessThan(1e-3);
  });

  it('reduces to the endpoint box when no extremum is in range', () => {
    const entity: CadParabolaEntity = { ...PARABOLA, axisAngleDeg: 30, focalLength: 2, tStart: 4, tEnd: 5 };
    const box = cadParabolaEntityBounds(entity)!;
    const endpoints = cadParabolaEntityEndpoints(entity);
    expect(box.minX).toBeCloseTo(Math.min(endpoints.start.x, endpoints.end.x), 9);
    expect(box.maxY).toBeCloseTo(Math.max(endpoints.start.y, endpoints.end.y), 9);
  });

  it('feeds analytic bounds into entityIntersectsBounds', () => {
    const project = withParabola();
    const entity = project.entities[0] as CadParabolaEntity;
    const box = cadParabolaEntityBounds(entity)!;
    expect(entityIntersectsBounds(project, entity, box)).toBe(true);
    expect(entityIntersectsBounds(project, entity, {
      minX: box.maxX + 10, minY: box.maxY + 10, maxX: box.maxX + 20, maxY: box.maxY + 20,
    })).toBe(false);
  });
});

describe('parabola renderer tessellation', () => {
  it('emits bounded LINE primitives (never a single chord) within chord tolerance', () => {
    const project = withParabola();
    const entity = project.entities[0] as CadParabolaEntity;
    const primitives = buildCadDisplayScene(project).primitives.filter(
      (primitive) => primitive.sourceEntityId === entity.id,
    );
    expect(primitives.length).toBeGreaterThan(2);
    expect(primitives.every((primitive) => primitive.kind === 'line')).toBe(true);

    const points = cadParabolaTessellatePoints(entity)!;
    const dense = sampleMany(entity, 6000);
    const chordDistance = (point: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSquared = dx * dx + dy * dy;
      const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
      const clamped = Math.max(0, Math.min(1, t));
      return Math.hypot(point.x - (a.x + dx * clamped), point.y - (a.y + dy * clamped));
    };
    let maxDeviation = 0;
    for (const point of dense) {
      let nearest = Number.POSITIVE_INFINITY;
      for (let index = 0; index < points.length - 1; index += 1) {
        nearest = Math.min(nearest, chordDistance(point, points[index]!, points[index + 1]!));
      }
      maxDeviation = Math.max(maxDeviation, nearest);
    }
    expect(maxDeviation).toBeLessThanOrEqual(CAD_PARABOLA_TESSELLATION_CHORD_TOLERANCE * 1.05);
    expect(points[0]).toEqual(cadParabolaEntityEndpoints(entity).start);
    expect(points.at(-1)).toEqual(cadParabolaEntityEndpoints(entity).end);
  });
});

describe('parabola tessellation cap completeness', () => {
  it('keeps both exact endpoints and the cap when demand exceeds the segment budget', () => {
    const extreme: CadParabolaEntity = { ...PARABOLA, focalLength: 100, tStart: -10, tEnd: 10 };
    const endpoints = cadParabolaEntityEndpoints(extreme);
    const points = cadParabolaTessellatePoints(extreme)!;
    expect(points.length - 1).toBeLessThanOrEqual(CAD_PARABOLA_TESSELLATION_MAX_SEGMENTS);
    expect(points.length).toBe(CAD_PARABOLA_TESSELLATION_MAX_SEGMENTS + 1);
    expect(points[0]).toEqual(endpoints.start);
    expect(points.at(-1)).toEqual(endpoints.end);
    expect(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it('closes the renderer and DXF approximations at P(tEnd) for the capped curve', async () => {
    const extreme: CadParabolaEntity = { ...PARABOLA, focalLength: 100, tStart: -10, tEnd: 10 };
    const end = cadParabolaEntityEndpoints(extreme).end;
    const primitives = buildCadDisplayScene(withParabola(extreme)).primitives.filter(
      (primitive) => primitive.sourceEntityId === extreme.id,
    );
    const lastPrimitive = primitives.at(-1)!;
    expect(lastPrimitive.kind).toBe('line');
    if (lastPrimitive.kind === 'line') {
      expect(lastPrimitive.points.at(-1)).toEqual(end);
    }
    const { buildDxfExportModelWithResult } = await import('../src/engine/cad/dxf/dxfExportModel');
    const result = buildDxfExportModelWithResult({ project: withParabola(extreme) });
    const polyline = result.output.polylines.find((entry) => entry.vertices.length > 2)!;
    expect(polyline.vertices.at(-1)).toEqual(end);
  });

  it('meets chord tolerance for a normal sub-cap entity', () => {
    const entity: CadParabolaEntity = { ...PARABOLA, focalLength: 2, tStart: -2, tEnd: 2 };
    const points = cadParabolaTessellatePoints(entity)!;
    expect(points.length - 1).toBeLessThan(CAD_PARABOLA_TESSELLATION_MAX_SEGMENTS);
    let maxDeviation = 0;
    for (const point of sampleMany(entity, 2000)) {
      let nearest = Number.POSITIVE_INFINITY;
      for (let index = 0; index < points.length - 1; index += 1) {
        nearest = Math.min(nearest, pointChordDistance(point, points[index]!, points[index + 1]!));
      }
      maxDeviation = Math.max(maxDeviation, nearest);
    }
    expect(maxDeviation).toBeLessThanOrEqual(CAD_PARABOLA_TESSELLATION_CHORD_TOLERANCE * 1.05);
  });
});

describe('parabola closest and midpoint', () => {
  it('returns the true finite closest point (matches a dense oracle)', () => {
    const entity: CadParabolaEntity = { ...PARABOLA, axisAngleDeg: 25, focalLength: 1.5, tStart: -2, tEnd: 4 };
    const query = { x: 3.5, y: -1.25 };
    const nearest = cadParabolaEntityClosestPoint(entity, query)!;
    const oracle = sampleMany(entity, 40000).reduce((best, point) => {
      const distance = Math.hypot(point.x - query.x, point.y - query.y);
      return distance < best.distance ? { point, distance } : best;
    }, { point: nearest, distance: Number.POSITIVE_INFINITY });
    expect(Math.hypot(nearest.x - query.x, nearest.y - query.y)).toBeLessThanOrEqual(oracle.distance + 1e-6);
  });

  it('midpoint splits the curve into equal arc lengths (never the t-average)', () => {
    const entity: CadParabolaEntity = { ...PARABOLA, axisAngleDeg: 20, focalLength: 2, tStart: -1, tEnd: 5 };
    const value = canonical(entity);
    const midpoint = cadParabolaEntityMidpoint(entity)!;
    const arc = (t0: number, t1: number): number => cadParabolaArcLength(value, t0, t1) ?? Number.NaN;
    const half = arc(entity.tStart, (entity.tStart + entity.tEnd) / 2);
    const quarter = arc(entity.tStart, entity.tStart + (entity.tEnd - entity.tStart) / 4);
    expect(half).not.toBeCloseTo(quarter, 6);
    const length = cadParabolaEntityLength(entity) ?? Number.NaN;
    const tAverage = cadParabolaParamPoint(value, (entity.tStart + entity.tEnd) / 2);
    expect(Math.hypot(midpoint.x - tAverage.x, midpoint.y - tAverage.y)).toBeGreaterThan(1e-3);
    // The half-length point sits at the arc-length centroid of the curve.
    let low = entity.tStart;
    let high = entity.tEnd;
    for (let iteration = 0; iteration < 200; iteration += 1) {
      const mid = (low + high) / 2;
      if (arc(entity.tStart, mid) < length / 2) low = mid;
      else high = mid;
    }
    const exactT = (low + high) / 2;
    const exact = cadParabolaParamPoint(value, exactT);
    expect(Math.hypot(midpoint.x - exact.x, midpoint.y - exact.y)).toBeLessThan(1e-6);
  });
});

describe('parabola spatial snaps', () => {
  it('emits endpoint, half-length midpoint, and nearest candidates only', () => {
    const project = withParabola();
    const entity = project.entities[0] as CadParabolaEntity;
    const context: CadSpatialEntityCandidateContext = {
      project,
      visibleEntities: [entity],
      segments: [],
      worldPoint: { x: 1, y: 0.25 },
      allowed: new Set(['endpoint', 'midpoint', 'nearest', 'center', 'tangent', 'perpendicular']),
      constructionContext: { active: false, basePoint: null },
      basePoint: null,
      hasPerpendicularStartSeed: false,
      parallelScope: null,
      extensionScope: null,
      requireExplicitScope: false,
    };
    const candidates = buildCadSpatialEntitySnapCandidates(context);
    const kinds = new Set(candidates.map((candidate) => candidate.kind));
    expect(kinds.has('endpoint')).toBe(true);
    expect(kinds.has('midpoint')).toBe(true);
    expect(kinds.has('nearest')).toBe(true);
    expect(kinds.has('center')).toBe(false);
    expect(kinds.has('tangent')).toBe(false);
    expect(kinds.has('perpendicular')).toBe(false);
    const endpoints = cadParabolaEntityEndpoints(entity);
    expect(candidates.some((candidate) => candidate.x === endpoints.start.x && candidate.y === endpoints.start.y)).toBe(true);
    expect(candidates.some((candidate) => candidate.x === endpoints.end.x && candidate.y === endpoints.end.y)).toBe(true);
  });

  it('indexes the analytic AABB so cursor-box culling sees the curve', () => {
    const project = withParabola({ ...PARABOLA, tStart: -5, tEnd: 5 });
    const index = buildCadSpatialIndex(project);
    const candidates = index.querySnapCandidates({ x: 0, y: 0 }, 1, ['nearest']);
    expect(candidates.some((candidate) => candidate.sourceEntityId === PARABOLA.id)).toBe(true);
  });
});

describe('parabola exact line intersection', () => {
  it('solves the quadratic in the canonical frame and clamps to both finite ranges', () => {
    const project = withParabola();
    const entity = project.entities[0] as CadParabolaEntity;
    const line: CadLineEntity = {
      id: 'line:secant', type: 'line', layerId: 'observation-lines', visible: true, locked: false,
      fromStationId: 'A', toStationId: 'B', fromX: 4, fromY: -10, toX: 4, toY: 10,
      sourceObservationIds: [],
    };
    const hits = cadIntersectLineParabola(line, entity).map((hit) => hit.point);
    expect(hits).toHaveLength(2);
    expect(hits[0]!.x).toBeCloseTo(4, 9);
    expect(hits[0]!.y).toBeCloseTo(-4, 9);
    expect(hits[1]!.y).toBeCloseTo(4, 9);

    const short: CadLineEntity = { ...line, fromY: 3, toY: 10 };
    expect(cadIntersectLineParabola(short, entity)).toHaveLength(1);
    const beyond: CadLineEntity = { ...line, fromY: 5, toY: 10, fromX: 100, toX: 100 };
    expect(cadIntersectLineParabola(beyond, entity)).toHaveLength(0);
  });
});

describe('parabola tangent root law', () => {
  it('returns exactly one point at a vertex tangent (double root deduped)', () => {
    const hits = cadParabolaLineIntersection(canonical(PARABOLA), { x: 0, y: -5 }, { x: 0, y: 5 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.x).toBeCloseTo(0, 9);
    expect(hits[0]!.y).toBeCloseTo(0, 9);
  });

  it('returns exactly one point at a non-vertex tangent', () => {
    const hits = cadParabolaLineIntersection(canonical(PARABOLA), { x: -4, y: 3 }, { x: 6, y: -7 });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.x).toBeCloseTo(1, 9);
    expect(hits[0]!.y).toBeCloseTo(-2, 9);
  });

  it('keeps two distinct points for a secant and none for a miss', () => {
    const secant = cadParabolaLineIntersection(canonical(PARABOLA), { x: 4, y: -10 }, { x: 4, y: 10 });
    expect(secant.map((hit) => hit.y).sort((left, right) => left - right)).toEqual([-4, 4]);
    const miss = cadParabolaLineIntersection(canonical(PARABOLA), { x: -1, y: -10 }, { x: -1, y: 10 });
    expect(miss).toHaveLength(0);
  });

  it('keeps two distinct hits for a nanometre-grazing secant (R4 gray-zone secant)', () => {
    const offset = 1e-9;
    const start = { x: -4 + offset, y: 3 };
    const end = { x: 6 + offset, y: -7 };
    const secant = cadParabolaLineIntersection(canonical(PARABOLA), start, end);
    expect(secant).toHaveLength(2);
    // Closed form for f = 1, axis 0 (x = y^2 / 4 meets x = -1 + offset - y,
    // i.e. (y + 2)^2 = 4 * offset): the penetration is ~1 nm yet the roots
    // sit ~0.18 mm apart, so they must never collapse.
    const expectedY = [-2 - 2 * Math.sqrt(offset), -2 + 2 * Math.sqrt(offset)];
    const ordered = [...secant].sort((left, right) => left.y - right.y);
    ordered.forEach((hit, index) => {
      const y = expectedY[index]!;
      expect(hit.y).toBeCloseTo(y, 9);
      expect(hit.x).toBeCloseTo((y * y) / 4, 9);
    });
    expect(
      Math.hypot(ordered[1]!.x - ordered[0]!.x, ordered[1]!.y - ordered[0]!.y),
    ).toBeGreaterThan(1e-4);
    // COGO and OSNAP inherit the two-hit law through the shared seam.
    const entity = withParabola().entities[0] as CadParabolaEntity;
    const line: CadLineEntity = {
      id: 'line:graze-secant', type: 'line', layerId: 'observation-lines', visible: true, locked: false,
      fromStationId: 'A', toStationId: 'B', fromX: start.x, fromY: start.y, toX: end.x, toY: end.y,
      sourceObservationIds: [],
    };
    expect(cadIntersectLineParabola(line, entity)).toHaveLength(2);
    expect(buildExactIntersectionCandidates({
      segments: [{
        segmentId: 'line:graze-secant#0', sourceEntityId: 'line:graze-secant',
        start, end, startLabel: 'A', endLabel: 'B', label: 'A-B',
      }],
      arcs: [],
      parabolas: [PARABOLA],
      worldPoint: { x: 1, y: -2 },
    })).toHaveLength(2);
  });

  it('returns zero for the mirrored nanometre miss (R4 gray-zone miss)', () => {
    const offset = 1e-9;
    const start = { x: -4 - offset, y: 3 };
    const end = { x: 6 - offset, y: -7 };
    expect(cadParabolaLineIntersection(canonical(PARABOLA), start, end)).toHaveLength(0);
    // COGO and OSNAP inherit the miss through the shared seam.
    const entity = withParabola().entities[0] as CadParabolaEntity;
    const line: CadLineEntity = {
      id: 'line:graze-miss', type: 'line', layerId: 'observation-lines', visible: true, locked: false,
      fromStationId: 'A', toStationId: 'B', fromX: start.x, fromY: start.y, toX: end.x, toY: end.y,
      sourceObservationIds: [],
    };
    expect(cadIntersectLineParabola(line, entity)).toHaveLength(0);
    expect(buildExactIntersectionCandidates({
      segments: [{
        segmentId: 'line:graze-miss#0', sourceEntityId: 'line:graze-miss',
        start, end, startLabel: 'A', endLabel: 'B', label: 'A-B',
      }],
      arcs: [],
      parabolas: [PARABOLA],
      worldPoint: { x: 1, y: -2 },
    })).toHaveLength(0);
  });

  it('dedupes a numerically-tangent line on a rotated parabola (roundoff discriminant)', () => {
    const rotated: CadParabolaEntity = {
      ...PARABOLA, vertexX: 5, vertexY: -2, axisAngleDeg: 37, focalLength: 2, tStart: -2, tEnd: 2,
    };
    const value = canonical(rotated);
    const t0 = 0.7;
    const point = cadParabolaParamPoint(value, t0);
    const { aX, aY, bX, bY } = cadParabolaAxisBasis(rotated.axisAngleDeg);
    const tangent = { x: bX + aX * t0, y: bY + aY * t0 };
    const length = Math.hypot(tangent.x, tangent.y);
    const unit = { x: tangent.x / length, y: tangent.y / length };
    const hits = cadParabolaLineIntersection(
      value,
      { x: point.x - unit.x * 5, y: point.y - unit.y * 5 },
      { x: point.x + unit.x * 5, y: point.y + unit.y * 5 },
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]!.x).toBeCloseTo(point.x, 6);
    expect(hits[0]!.y).toBeCloseTo(point.y, 6);
  });

  it('propagates the tangent law through the COGO line-entity wrapper', () => {
    const entity = withParabola().entities[0] as CadParabolaEntity;
    const tangent: CadLineEntity = {
      id: 'line:tangent', type: 'line', layerId: 'observation-lines', visible: true, locked: false,
      fromStationId: 'A', toStationId: 'B', fromX: 0, fromY: -5, toX: 0, toY: 5, sourceObservationIds: [],
    };
    expect(cadIntersectLineParabola(tangent, entity)).toHaveLength(1);
  });
});

describe('parabola exact segment intersection candidates (OSNAP wiring)', () => {
  const segmentRef = (
    start: { x: number; y: number },
    end: { x: number; y: number },
  ): CadSegmentRef => ({
    segmentId: 'line:probe#0',
    sourceEntityId: 'line:probe',
    start,
    end,
    startLabel: 'A',
    endLabel: 'B',
    label: 'A-B',
  });

  const exactCandidates = (segment: CadSegmentRef) =>
    buildExactIntersectionCandidates({
      segments: [segment],
      arcs: [],
      parabolas: [PARABOLA],
      worldPoint: { x: 0, y: 0 },
    });

  it('emits two exact candidates for a secant with both-entity attribution', () => {
    const candidates = exactCandidates(segmentRef({ x: 4, y: -10 }, { x: 4, y: 10 }));
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.y).sort((left, right) => left - right)).toEqual([-4, 4]);
    expect(candidates.every((candidate) => candidate.kind === 'intersection')).toBe(true);
    expect(candidates.every((candidate) => candidate.sourceEntityId === `line:probe|${PARABOLA.id}`)).toBe(true);
    expect(candidates.every((candidate) => candidate.label === 'A-B x Parabola')).toBe(true);
    expect(candidates.every((candidate) => candidate.sourceSegmentId == null)).toBe(true);
  });

  it('emits exactly one candidate for vertex and off-vertex tangents', () => {
    expect(exactCandidates(segmentRef({ x: 0, y: -5 }, { x: 0, y: 5 }))).toHaveLength(1);
    expect(exactCandidates(segmentRef({ x: -4, y: 3 }, { x: 6, y: -7 }))).toHaveLength(1);
  });

  it('emits none for a miss and omits crossings outside the finite t-range', () => {
    expect(exactCandidates(segmentRef({ x: -1, y: -10 }, { x: -1, y: 10 }))).toHaveLength(0);
    // x = 16 meets the infinite parabola at t = +/-4, outside [-3, 3].
    expect(exactCandidates(segmentRef({ x: 16, y: -10 }, { x: 16, y: 10 }))).toHaveLength(0);
  });

  it('does not fabricate circle/arc/parabola-pair intersections', () => {
    const circle = { sourceEntityId: 'circle:one', center: { x: 0, y: 0 }, radius: 1, label: 'circle' };
    expect(buildExactIntersectionCandidates({
      segments: [], arcs: [], circles: [circle], parabolas: [PARABOLA], worldPoint: { x: 0, y: 0 },
    })).toHaveLength(0);
    const arc = {
      sourceEntityId: 'arc:one', center: { x: 0, y: 0 }, radius: 1, startAngleDeg: 0, endAngleDeg: 180,
      startPoint: { x: 1, y: 0 }, endPoint: { x: -1, y: 0 }, label: 'arc',
    };
    expect(buildExactIntersectionCandidates({
      segments: [], arcs: [arc], parabolas: [PARABOLA], worldPoint: { x: 0, y: 0 },
    })).toHaveLength(0);
    expect(buildExactIntersectionCandidates({
      segments: [], arcs: [], parabolas: [PARABOLA, { ...PARABOLA, id: 'cad-parabola:other' }], worldPoint: { x: 0, y: 0 },
    })).toHaveLength(0);
  });

  it('wires straight CadPolylineEntity courses into the exact intersection pass', () => {
    const polyline: CadPolylineEntity = {
      id: 'polyline:secant', type: 'polyline', layerId: 'general', visible: true, locked: false,
      vertices: [{ x: 4, y: -10 }, { x: 4, y: 10 }], vertexLabels: ['A', 'B'], closed: false,
    };
    const project = replaceCadProjectEntities(
      createBlankCadProject({ name: 'parabola-polyline', units: 'm' }),
      [PARABOLA, polyline],
    );
    const candidates = buildCadSpatialIndex(project).querySnapCandidates({ x: 4, y: 4 }, 1, ['intersection']);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.sourceEntityId).toBe(`${polyline.id}|${PARABOLA.id}`);
    expect(candidates[0]!.x).toBeCloseTo(4, 9);
    expect(candidates[0]!.y).toBeCloseTo(4, 9);
  });

  it('keeps a bulged polyline arc course out of the segment list (never chorded)', () => {
    const polyline: CadPolylineEntity = {
      id: 'polyline:arc', type: 'polyline', layerId: 'general', visible: true, locked: false,
      vertices: [{ x: 4, y: -10 }, { x: 4, y: 10 }], vertexLabels: ['A', 'B'], closed: false,
      segmentGeometry: [{ kind: 'arc', bulge: 1 }],
    };
    const project = replaceCadProjectEntities(
      createBlankCadProject({ name: 'parabola-arc', units: 'm' }),
      [PARABOLA, polyline],
    );
    // Chord x = 4 would cross the parabola at (4, +/-4); the true
    // semicircular arc bows to x >= 4 and must not fabricate that hit.
    expect(
      buildCadSpatialIndex(project).querySnapCandidates({ x: 4, y: 4 }, 1, ['intersection']),
    ).toHaveLength(0);
  });
});

describe('parabola transforms', () => {
  const assertPointMaps = (
    original: CadParabolaEntity,
    transformed: CadParabolaEntity,
    transform: CadTransform2D,
    reflection: boolean,
  ) => {
    const from = canonical(original);
    const to = canonical(transformed);
    for (const t of [-3, -1.25, 0, 0.75, 3]) {
      const world = cadParabolaParamPoint(from, t);
      const expected = { x: transform.a * world.x + transform.c * world.y + transform.tx, y: transform.b * world.x + transform.d * world.y + transform.ty };
      const actual = cadParabolaParamPoint(to, reflection ? -t : t);
      expect(actual.x).toBeCloseTo(expected.x, 7);
      expect(actual.y).toBeCloseTo(expected.y, 7);
    }
  };

  it.each([
    ['translation', translation(4, -7), false],
    ['rotation', rotationAbout(1, 2, 33), false],
    ['uniform scale', uniformScaleAbout(0, 0, 2.5), false],
  ] as const)('%s carries the analytic model exactly', (_name, transform, reflection) => {
    const transformed = transformParabolaEntity(PARABOLA, transform, classifyTransform(transform)!);
    expect(transformed.ok).toBe(true);
    if (transformed.ok) assertPointMaps(PARABOLA, transformed.entity, transform, reflection);
  });

  it('reflection re-parameterizes t -> -t and preserves the curve as a point set', () => {
    const transform = reflectionAboutLine({ x: 0, y: 0 }, { x: 1, y: 1 })!;
    const transformed = transformParabolaEntity(PARABOLA, transform, classifyTransform(transform)!);
    expect(transformed.ok).toBe(true);
    if (transformed.ok) {
      expect(transformed.entity.tStart).toBe(-PARABOLA.tEnd);
      expect(transformed.entity.tEnd).toBe(-PARABOLA.tStart);
      assertPointMaps(PARABOLA, transformed.entity, transform, true);
    }
  });

  it('fails closed with a named reason for nonuniform/affine transforms', () => {
    const transform: CadTransform2D = { a: 2, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const classification = classifyTransform(transform)!;
    expect(classification.kind).toBe('GENERAL_AFFINE');
    const result = transformCadEntityGeometry(PARABOLA, transform, classification);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('CAD_TRANSFORM_PARABOLA_NON_UNIFORM_UNSUPPORTED');
  });
});

describe('parabola MOVE / COPY / ERASE', () => {
  it('moves, copies with a fresh id, and erases the entity', () => {
    const project = withParabola();
    const moved = runCadCommand(createCadHistoryState(project, [PARABOLA.id]), {
      key: 'MOVE', deltaX: 5, deltaY: -2,
    } as CadCommand);
    const movedEntity = moved.present.project.entities.find((entity) => entity.id === PARABOLA.id) as CadParabolaEntity;
    expect(movedEntity.vertexX).toBeCloseTo(5, 9);
    expect(movedEntity.vertexY).toBeCloseTo(-2, 9);

    const copied = runCadCommand(createCadHistoryState(project, [PARABOLA.id]), {
      key: 'COPY', deltaX: 1, deltaY: 2,
    } as CadCommand);
    const parabolaCopies = copied.present.project.entities.filter(
      (entity): entity is CadParabolaEntity => entity.type === 'parabola',
    );
    expect(parabolaCopies).toHaveLength(2);
    const copy = parabolaCopies.find((entity) => entity.id !== PARABOLA.id)!;
    expect(copy.vertexX).toBeCloseTo(1, 9);
    expect(copy.vertexY).toBeCloseTo(2, 9);
    expect(copy.focalLength).toBe(PARABOLA.focalLength);

    const erased = runCadCommand(createCadHistoryState(project, [PARABOLA.id]), { key: 'ERASE' } as CadCommand);
    expect(erased.present.project.entities.some((entity) => entity.id === PARABOLA.id)).toBe(false);
  });
});

describe('parabola exports and refusals', () => {
  it('DXF approximates as a warned LWPOLYLINE, never claimed as FULL', async () => {
    const { buildDxfExportModelWithResult } = await import('../src/engine/cad/dxf/dxfExportModel');
    const project = withParabola();
    const result = buildDxfExportModelWithResult({ project });
    expect(result.exportedEntityIds).toContain(PARABOLA.id);
    expect(result.approximatedEntityIds).toContain(PARABOLA.id);
    expect(result.omittedEntityIds).not.toContain(PARABOLA.id);
    const warnings = result.warnings.filter((warning) => warning.entityId === PARABOLA.id);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]!.code).toBe('SKIPPED_ENTITY');
    const polyline = result.output.polylines.find((entry) => entry.vertices.length > 2);
    expect(polyline).toBeDefined();
    expect(polyline!.closed).toBe(false);
  });

  it('LandXML omits the parabola as NOT_APPLICABLE', async () => {
    const { buildLandXmlProjectExportWithResult } = await import('../src/engine/landxmlCadProject');
    const project = withParabola();
    const result = buildLandXmlProjectExportWithResult(project, {
      includePoints: true, includeAlignments: true, includeSurfaces: false, includeParcels: true,
    } as never);
    expect(result.omittedEntityIds ?? []).toContain(PARABOLA.id);
    const text = JSON.stringify(result);
    expect(text).toContain('NOT_APPLICABLE');
  });

  it('blocks are explicitly rejected at creation (never silent omission)', () => {
    const project = withParabola();
    const entity = project.entities[0] as CadParabolaEntity;
    const classified = classifyBlockSources(project, [entity]);
    expect(classified.eligible).toHaveLength(0);
    expect(classified.ineligible).toEqual([{ id: entity.id, code: 'CAD_BLOCK_SEMANTIC_UNSUPPORTED' }]);
  });

  it('TRIM/EXTEND/FILLET refuse a parabola (no false trim/fillet)', () => {
    const project = withParabola();
    const entity = project.entities[0] as CadParabolaEntity;
    const boundary: CadLineEntity = {
      id: 'line:boundary', type: 'line', layerId: 'observation-lines', visible: true, locked: false,
      fromStationId: 'A', toStationId: 'B', fromX: -10, fromY: 0, toX: 10, toY: 0, sourceObservationIds: [],
    };
    const withBoundary = replaceCadProjectEntities(project, [entity, boundary]);
    expect(isTrimmableEntity(entity)).toBe(false);
    expect(buildCadTrimPreview(withBoundary, [boundary.id], entity.id, { x: 1, y: 0 })).toBeNull();
    expect(buildCadExtendPreview(withBoundary, boundary.id, entity.id, { x: 1, y: 0 })).toBeNull();
    expect(buildCadFilletPreview(withBoundary, 2, entity.id, { x: 1, y: 0 }, undefined, boundary.id, { x: 0, y: 0 })).toBeNull();
  });

  it('exposes read-only analytic property rows', () => {
    const project = withParabola();
    const state = buildCadPropertiesPanelState(project, project.entities);
    expect(state?.mode).toBe('single');
    if (!state || state.mode !== 'single') return;
    const rows = state.entity.properties;
    const keys = new Set(rows.map((row) => row.key));
    for (const key of ['vertex-e', 'vertex-n', 'axis-azimuth', 'focal-length', 't-start', 't-end', 'curve-length']) {
      expect(keys.has(key)).toBe(true);
    }
    const analyticKeys = new Set(['vertex-e', 'vertex-n', 'axis-azimuth', 'focal-length', 't-start', 't-end', 'curve-length']);
    expect(rows.filter((row) => analyticKeys.has(row.key)).every((row) => row.editableField == null)).toBe(true);
  });

  it('mlightcad carries a truthful tessellation, not a native claim', () => {
    const scene = buildMlightcadSpikeScene(withParabola());
    const spike = scene.entities.find((entity) => entity.metadata.nativeEntityId === PARABOLA.id)!;
    expect(spike.type).toBe('AcDbPolyline');
    expect((spike.geometry as { approximation?: string }).approximation).toBe('parabola-tessellation');
  });

  it('reports axis azimuth as degrees clockwise from north', () => {
    expect(cadParabolaAxisAzimuthDeg({ ...PARABOLA, axisAngleDeg: 0 })).toBeCloseTo(90, 9);
  });
});

describe('best-fit result projection', () => {
  it('projects a Worker A canonical result into a first-class entity', async () => {
    const { cadBestFitParabola } = await import('../src/engine/cad/cadBestFitParabola');
    const { cadParabolaEntityFromCanonical } = await import('../src/engine/cad/cadParabola');
    const samples = Array.from({ length: 9 }, (_unused, index) => {
      const t = index - 4;
      return { x: 2 + 1.5 * t * t, y: -3 - 3 * t };
    });
    const fit = cadBestFitParabola(samples);
    expect(fit).not.toBeNull();
    const entity = cadParabolaEntityFromCanonical(fit!.canonical, {
      id: 'cad-parabola:fit', layerId: 'planning', metadata: { source: 'BEST_FIT_PARABOLA' },
    });
    expect(entity).not.toBeNull();
    expect(entity!.type).toBe('parabola');
    expect(entity!.focalLength).toBeCloseTo(fit!.canonical.focalLength, 9);
    expect(entity!.visible).toBe(true);
    expect(entity!.locked).toBe(false);
    expect(cadParabolaEntityFromCanonical(
      { ...fit!.canonical, focalLength: 0 },
      { id: 'cad-parabola:bad', layerId: 'planning' },
    )).toBeNull();
  });
});
