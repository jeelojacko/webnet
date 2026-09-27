// Phase 20A SURFACE — feature line as associative surface breakline source.
import { describe, expect, it } from 'vitest';

import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { resolveCadFeatureLine } from '../src/engine/cad/cadFeatureLines';
import { countSurfaceDefinitionReferencesToEntity } from '../src/engine/cad/cadSurfaceDefinitionReferences';
import {
  breaklineEntityRefs,
  collectSources,
  computeCadSurfaceSourceRevision,
  featureLineArcSubdivisions,
} from '../src/engine/cad/cadSurfaceRevision';
import {
  buildCadSurface,
  deriveSurfaceStatus,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaces';
import type {
  CadEntity,
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

let seq = 0;
const makeLine = (
  vertices: Array<{ x: number; y: number; z: number }>,
  segmentGeometry?: CadFeatureLineEntity['segmentGeometry'],
): CadFeatureLineEntity => {
  seq += 1;
  const id = `fl-20a-s${seq}`;
  return {
    id,
    type: 'feature-line',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: vertices.map((vertex, index) => ({
      id: `feature-vertex:${id}:v${index + 1}`,
      ...vertex,
    })),
    ...(segmentGeometry != null ? { segmentGeometry: segmentGeometry.map((entry) => ({ ...entry })) } : {}),
  };
};

const point = (
  id: string,
  stationId: string,
  x: number,
  y: number,
  z: number,
): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const surfaceWith = (
  id: string,
  breaklineEntityId: string,
  pointIds: string[],
  breaklineChordTolerance?: number,
): CadSurface => ({
  id,
  name: id,
  definition: {
    pointSource: { kind: 'points', pointEntityIds: pointIds },
    breaklines: [{ id: `bl-${id}`, source: { kind: 'entity', entityId: breaklineEntityId }, type: 'standard' }],
    ...(breaklineChordTolerance !== undefined
      ? { buildOptions: { breaklineChordTolerance } }
      : {}),
  },
});

const projectWith = (entities: CadEntity[], surfaces: CadSurface[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'FL breakline 20A', units: 'm' });
  return { ...drawing.project, entities, surfaces };
};

// Square corners (non-collinear point source); the ridge runs along y=0.
const corners = (): CadSurveyPointEntity[] => [
  point('pt-sw', 'SW', 0, 0, 100),
  point('pt-se', 'SE', 100, 0, 100),
  point('pt-ne', 'NE', 100, 100, 112),
  point('pt-nw', 'NW', 0, 100, 112),
];
const cornerIds = () => ['pt-sw', 'pt-se', 'pt-ne', 'pt-nw'];

describe('20A feature-line surface breaklines', () => {
  it('straight oracle: exact TIN pass-through, edit mid to 110 rebuilds the ridge', () => {
    const fl = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 50, y: 0, z: 105 },
      { x: 100, y: 0, z: 100 },
    ]);
    expect(breaklineEntityRefs(fl)).toEqual([`feature-line:${fl.id}`]);
    const surface = surfaceWith('s1', fl.id, cornerIds());
    const project = projectWith([...corners(), fl], [surface]);

    const collected = collectSources(project, surface);
    expect(collected.breaklineError).toBeNull();
    expect(collected.brokenRefs).toEqual([]);
    expect(collected.buildOptions.breaklineChordTolerance).toBe(0.001);
    expect(collected.breaklines).toHaveLength(1);
    const chain = collected.breaklines[0]!;
    expect(chain).toHaveLength(3);
    const coords = chain.map((index) => {
      const p = collected.points[index]!;
      return [p.x, p.y, p.z];
    });
    expect(coords).toEqual([
      [0, 0, 100],
      [50, 0, 105],
      [100, 0, 100],
    ]);

    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
    expect(getSurfaceElevationAt(built, 50, 0)).toBeCloseTo(105, 6);

    // Feature-line edit changes the source revision via existing derivation.
    const editedFl: CadFeatureLineEntity = {
      ...fl,
      vertices: fl.vertices.map((vertex, index) => (index === 1 ? { ...vertex, z: 110 } : vertex)),
    };
    const edited = projectWith([...corners(), editedFl], [surface]);
    expect(computeCadSurfaceSourceRevision(edited, surface)).not.toBe(
      computeCadSurfaceSourceRevision(project, surface),
    );
    const current: CadSurface = { ...surface, cachedRevision: built.revision };
    expect(deriveSurfaceStatus(projectWith([...corners(), fl], [current]), current)).toBe('CURRENT');
    expect(deriveSurfaceStatus(projectWith([...corners(), editedFl], [current]), current)).toBe(
      'NEEDS_REBUILD',
    );
    const rebuilt = buildCadSurface(edited, surface);
    expect(rebuilt.outcome).toBe('ok');
    expect(getSurfaceElevationAt(rebuilt, 50, 0)).toBeCloseTo(110, 6);
    expect(
      rebuilt.points.some((p) => p.x === 50 && p.y === 0 && p.z === 110),
    ).toBe(true);
  });

  it('curved oracle: generated points on-arc with station-Z and bounded sagitta', () => {
    // Negative bulge bows the arc into the square domain (positive would
    // dip below y=0, outside the point cloud the TIN triangulates).
    const fl = makeLine(
      [
        { x: 0, y: 0, z: 100 },
        { x: 100, y: 0, z: 110 },
      ],
      [{ kind: 'arc', bulge: -Math.tan(Math.PI / 8) }],
    );
    const resolved = resolveCadFeatureLine(fl)!;
    const course = resolved.courses[0]!;
    expect(course.kind).toBe('arc');
    const center = course.center!;
    const radius = course.radius!;
    const tolerance = 0.001;
    const expectedSteps = featureLineArcSubdivisions(radius, Math.PI / 2, tolerance);
    expect(expectedSteps).toBeGreaterThan(1);

    // Corners agree with the arc endpoints (exact-XY reuse, no conflict).
    const arcCorners = [
      point('pt-sw', 'SW', 0, 0, 100),
      point('pt-se', 'SE', 100, 0, 110),
      point('pt-ne', 'NE', 100, 100, 112),
      point('pt-nw', 'NW', 0, 100, 112),
    ];
    const surface = surfaceWith('s1', fl.id, cornerIds());
    const project = projectWith([...arcCorners, fl], [surface]);
    const collected = collectSources(project, surface);
    expect(collected.breaklineError).toBeNull();
    const chain = collected.breaklines[0]!;
    expect(chain).toHaveLength(expectedSteps + 1);
    const pts = chain.map((index) => collected.points[index]!);
    // On-arc + station-Z exact.
    pts.forEach((p, step) => {
      expect(Math.hypot(p.x - center.x, p.y - center.y)).toBeCloseTo(radius, 9);
      const station = (course.planLength * step) / expectedSteps;
      expect(p.z).toBeCloseTo(100 + (10 * station) / course.planLength, 9);
    });
    // Sagitta of every chord within tolerance.
    for (let i = 0; i + 1 < pts.length; i += 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const chord = Math.hypot(b.x - a.x, b.y - a.y) / 2;
      const sagitta = radius - Math.sqrt(radius * radius - chord * chord);
      expect(sagitta).toBeLessThanOrEqual(tolerance + 1e-9);
    }
    // Coarser tolerance = fewer segments + revision change (rebuild signal).
    const coarse = surfaceWith('s1', fl.id, cornerIds(), 0.5);
    const coarseCollected = collectSources(project, coarse);
    expect(coarseCollected.breaklines[0]!.length).toBeLessThan(chain.length);
    expect(computeCadSurfaceSourceRevision(project, coarse)).not.toBe(
      computeCadSurfaceSourceRevision(project, surface),
    );
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
  });

  it('one line feeds many surfaces: shared edit stales both, no duplication', () => {
    const fl = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 50, y: 0, z: 105 },
      { x: 100, y: 0, z: 100 },
    ]);
    const s1 = surfaceWith('s1', fl.id, cornerIds());
    const s2 = surfaceWith('s2', fl.id, cornerIds());
    const project = projectWith([...corners(), fl], [s1, s2]);
    const r1 = buildCadSurface(project, s1).revision;
    const r2 = buildCadSurface(project, s2).revision;
    const current = projectWith([...corners(), fl], [
      { ...s1, cachedRevision: r1 },
      { ...s2, cachedRevision: r2 },
    ]);
    expect(deriveSurfaceStatus(current, current.surfaces![0]!)).toBe('CURRENT');
    expect(deriveSurfaceStatus(current, current.surfaces![1]!)).toBe('CURRENT');

    const editedFl: CadFeatureLineEntity = {
      ...fl,
      vertices: fl.vertices.map((vertex, index) => (index === 1 ? { ...vertex, z: 108 } : vertex)),
    };
    const stale = projectWith([...corners(), editedFl], [
      { ...s1, cachedRevision: r1 },
      { ...s2, cachedRevision: r2 },
    ]);
    expect(deriveSurfaceStatus(stale, stale.surfaces![0]!)).toBe('NEEDS_REBUILD');
    expect(deriveSurfaceStatus(stale, stale.surfaces![1]!)).toBe('NEEDS_REBUILD');
    for (const s of [s1, s2]) {
      const rebuilt = buildCadSurface(stale, s);
      expect(rebuilt.outcome).toBe('ok');
      expect(getSurfaceElevationAt(rebuilt, 50, 0)).toBeCloseTo(108, 6);
    }
    // No duplication: the shared mid vertex resolves once per surface.
    const c1 = collectSources(stale, s1);
    expect(c1.points.filter((p) => p.x === 50 && p.y === 0)).toHaveLength(1);
  });

  it('delete-source guard: missing feature line is BROKEN_REFERENCE with a use count', () => {
    const fl = makeLine([
      { x: 0, y: 0, z: 100 },
      { x: 50, y: 0, z: 105 },
      { x: 100, y: 0, z: 100 },
    ]);
    const surface = surfaceWith('s1', fl.id, cornerIds());
    const refs = countSurfaceDefinitionReferencesToEntity(projectWith([...corners(), fl], [surface]), fl.id);
    expect(refs.breaklineUses).toHaveLength(1);

    const deleted = projectWith(corners(), [surface]);
    const collected = collectSources(deleted, surface);
    expect(collected.brokenRefs).toEqual([`breakline:${fl.id}`]);
    expect(deriveSurfaceStatus(deleted, surface)).toBe('BROKEN_REFERENCE');
    const blocked = buildCadSurface(deleted, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.reasonCodes).toContain('SURFACE_REFERENCE_MISSING');
  });

  it('elevation oracle: plane exact, bad-Z blocks atomically, outside is null', () => {
    const plane = (x: number, y: number): number => 100 + 0.1 * x + 0.05 * y;
    const grid = projectWith(
      [
        point('pt-sw', 'SW', 0, 0, plane(0, 0)),
        point('pt-se', 'SE', 100, 0, plane(100, 0)),
        point('pt-ne', 'NE', 100, 100, plane(100, 100)),
        point('pt-nw', 'NW', 0, 100, plane(0, 100)),
      ],
      [],
    );
    const surface: CadSurface = {
      id: 'plane',
      name: 'plane',
      definition: { pointSource: { kind: 'points', pointEntityIds: cornerIds() } },
    };
    const withSurface = { ...grid, surfaces: [surface] };
    const built = buildCadSurface(withSurface, surface);
    expect(built.outcome).toBe('ok');
    expect(getSurfaceElevationAt(built, 30, 40)).toBeCloseTo(plane(30, 40), 9);
    expect(getSurfaceElevationAt(built, 200, 200)).toBeNull();

    // Non-finite owned Z fails closed (never Z=0): atomic block, no partial mesh.
    const bad = makeLine([
      { x: 10, y: 10, z: 100 },
      { x: 20, y: 10, z: Number.NaN },
    ]);
    const badSurface = surfaceWith('bad', bad.id, cornerIds());
    const badProject = projectWith([...grid.entities, bad], [badSurface]);
    const badBuilt = buildCadSurface(badProject, badSurface);
    expect(badBuilt.outcome).toBe('blocked');
    expect(badBuilt.reasonCodes).toContain('SURFACE_BREAKLINE_MISSING_Z');
    expect(badBuilt.points).toEqual([]);
    expect(badBuilt.triangles).toEqual([]);
  });
});
