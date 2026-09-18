import { describe, expect, it } from 'vitest';
import Delaunator from 'delaunator';
import { orient2d } from 'robust-predicates';
import type {
  CadEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaces';
import { buildTinBase } from '../src/engine/cad/tin/tinBase';
import { recoverConstrainedEdges } from '../src/engine/cad/tin/tinConstraintRecovery';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;

const pt = (
  stationId: string,
  x: number,
  y: number,
  z?: number,
): CadSurveyPointEntity => ({
  id: `pt:${stationId}`,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  ...(z === undefined ? {} : { z }),
  pointClass: 'free',
  source: 'parsed-input',
});

const projectOf = (entities: CadEntity[]): CadProject =>
  ({
    version: 2,
    id: 'proj-test',
    name: 'test',
    metadata: {
      source: 'parsed-input',
      runMode: 'unknown',
      units: 'meters',
      stationCount: 0,
      observationCount: 0,
      adjustedStationCount: 0,
    },
    layers: [],
    styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
    pointGroups: [],
    entities,
    cogoComputations: [],
    bounds: null,
  }) as unknown as CadProject;

const surfaceOf = (
  pointEntityIds: string[],
  overrides?: Partial<CadSurface['definition']>,
): CadSurface => ({
  id: `s${(seq += 1)}`,
  name: 'test surface',
  definition: { pointSource: { kind: 'points', pointEntityIds }, ...overrides },
});

const edgeSetOf = (triangles: Array<[number, number, number]>): Set<string> => {
  const set = new Set<string>();
  for (const tri of triangles) {
    for (const [p, q] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      set.add(`${Math.min(p, q)}>${Math.max(p, q)}`);
    }
  }
  return set;
};

const gridProject = (n: number, zOf: (_x: number, _y: number) => number): { project: CadProject; ids: string[] } => {
  const entities: CadSurveyPointEntity[] = [];
  for (let x = 0; x < n; x += 1) {
    for (let y = 0; y < n; y += 1) {
      entities.push(pt(`${x}-${y}`, x, y, zOf(x, y)));
    }
  }
  return { project: projectOf(entities), ids: entities.map((e) => e.id) };
};

// ---------------------------------------------------------------------------
// Library gotcha pins
// ---------------------------------------------------------------------------

describe('library gotcha pins', () => {
  it('orient2d returns positive for math-clockwise triples (README convention is flipped)', () => {
    // (0,0),(1,0),(0,1) is math-CCW (cross product +1); the library returns -1.
    expect(orient2d(0, 0, 1, 0, 0, 1)).toBeLessThan(0);
    // (0,0),(0,1),(1,0) is math-clockwise; the library returns +1.
    expect(orient2d(0, 0, 0, 1, 1, 0)).toBeGreaterThan(0);
  });

  it('delaunator emits clockwise triangles despite .d.ts claiming CCW; tinBase normalizes', () => {
    const raw = Delaunator.from([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
      [5, 5],
    ]);
    const signed = (a: number, b: number, c: number): number => {
      const ax = raw.coords[2 * a];
      const ay = raw.coords[2 * a + 1];
      return (raw.coords[2 * b] - ax) * (raw.coords[2 * c + 1] - ay) -
        (raw.coords[2 * b + 1] - ay) * (raw.coords[2 * c] - ax);
    };
    let sawClockwise = false;
    for (let i = 0; i < raw.triangles.length; i += 3) {
      if (signed(raw.triangles[i], raw.triangles[i + 1], raw.triangles[i + 2]) < 0) {
        sawClockwise = true;
      }
    }
    expect(sawClockwise).toBe(true);

    const base = buildTinBase([
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 10, z: 0 },
      { x: 0, y: 10, z: 0 },
      { x: 5, y: 5, z: 0 },
    ]);
    for (const tri of base.triangles) {
      const a = base.points[tri.a];
      const b = base.points[tri.b];
      const c = base.points[tri.c];
      expect((b.u - a.u) * (c.v - a.v) - (b.v - a.v) * (c.u - a.u)).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------

describe('plane oracle', () => {
  it('reproduces z = 2x + 3y + 5 exactly at interior queries', () => {
    const zOf = (x: number, y: number): number => 2 * x + 3 * y + 5;
    const { project, ids } = gridProject(5, zOf);
    const build = buildCadSurface(project, surfaceOf(ids));
    expect(build.outcome).toBe('ok');
    expect(build.reasonCodes).toEqual([]);
    for (const [x, y] of [[0.5, 0.5], [2.3, 1.7], [3.9, 3.1], [1.2, 3.8]]) {
      expect(getSurfaceElevationAt(build, x, y)).toBeCloseTo(zOf(x, y), 9);
    }
    expect(getSurfaceElevationAt(build, -5, -5)).toBeNull();
  });
});

describe('ridge breakline oracle', () => {
  it('keeps every ridge segment as a mesh edge and honors ridge height', () => {
    const ridgeZ = 10;
    const entities: CadSurveyPointEntity[] = [];
    for (let x = 0; x <= 4; x += 1) {
      for (let y = 0; y <= 4; y += 1) {
        entities.push(pt(`${x}-${y}`, x, y, x === 2 ? ridgeZ : x));
      }
    }
    const project = projectOf(entities);
    const ridgeIds = [0, 1, 2, 3, 4].map((y) => `pt:2-${y}`);
    const build = buildCadSurface(
      project,
      surfaceOf(entities.map((e) => e.id), {
        breaklines: [{ id: 'bl1', source: { kind: 'point-chain', pointEntityIds: ridgeIds }, type: 'standard' }],
      }),
    );
    expect(build.outcome).toBe('ok');
    const byId = new Map(build.points.map((p, i) => [p.entityId, i]));
    const edges = edgeSetOf(build.triangles);
    for (let i = 0; i + 1 < ridgeIds.length; i += 1) {
      const a = byId.get(ridgeIds[i]) as number;
      const b = byId.get(ridgeIds[i + 1]) as number;
      expect(edges.has(`${Math.min(a, b)}>${Math.max(a, b)}`)).toBe(true);
    }
    expect(getSurfaceElevationAt(build, 2, 2.5)).toBeCloseTo(ridgeZ, 9);
  });
});

describe('translation oracle', () => {
  it('identical topology at +2e6/+7e6 (local-frame conditioning)', () => {
    const zOf = (x: number, y: number): number => x + 2 * y;
    const { ids } = gridProject(5, zOf);
    const mk = (dx: number, dy: number): CadProject => {
      const { project } = gridProject(5, zOf);
      for (const e of project.entities) {
        if (e.type === 'survey-point') {
          e.x += dx;
          e.y += dy;
        }
      }
      return project;
    };
    const a = buildCadSurface(mk(0, 0), surfaceOf(ids));
    const b = buildCadSurface(mk(2e6, 7e6), surfaceOf(ids));
    expect(a.outcome).toBe('ok');
    expect(b.outcome).toBe('ok');
    expect(b.triangles).toEqual(a.triangles);
    expect(getSurfaceElevationAt(b, 2e6 + 1.5, 7e6 + 2.5)).toBeCloseTo(
      getSurfaceElevationAt(a, 1.5, 2.5) as number,
      6,
    );
  });
});

describe('input-order stability', () => {
  it('shuffled point-entity order yields identical topology + revision', () => {
    const zOf = (x: number, y: number): number => x * y - x + y;
    const { project, ids } = gridProject(5, zOf);
    const shuffled = [...ids].reverse();
    const a = buildCadSurface(project, surfaceOf(ids));
    const b = buildCadSurface(project, surfaceOf(shuffled));
    expect(a.outcome).toBe('ok');
    expect(b.triangles).toEqual(a.triangles);
    expect(computeCadSurfaceSourceRevision(project, surfaceOf(ids))).toBe(
      computeCadSurfaceSourceRevision(project, surfaceOf(shuffled)),
    );
  });
});

// ---------------------------------------------------------------------------
// Degenerate corpus + policies
// ---------------------------------------------------------------------------

describe('degenerate corpus', () => {
  it('0/1/2 points are INSUFFICIENT with SURFACE_TOO_FEW_POINTS', () => {
    const two = projectOf([pt('1', 0, 0, 1), pt('2', 10, 0, 2)]);
    for (const ids of [[], ['pt:1'], ['pt:1', 'pt:2']] as string[][]) {
      const build = buildCadSurface(two, surfaceOf(ids));
      expect(build.outcome).toBe('insufficient');
      expect(build.reasonCodes).toContain('SURFACE_TOO_FEW_POINTS');
      expect(deriveSurfaceStatus(two, surfaceOf(ids))).toBe('INSUFFICIENT_DATA');
    }
  });

  it('collinear points are INSUFFICIENT with SURFACE_COLLINEAR_POINTS', () => {
    const project = projectOf([pt('1', 0, 0, 1), pt('2', 5, 0, 2), pt('3', 10, 0, 3)]);
    const build = buildCadSurface(project, surfaceOf(['pt:1', 'pt:2', 'pt:3']));
    expect(build.outcome).toBe('insufficient');
    expect(build.reasonCodes).toContain('SURFACE_COLLINEAR_POINTS');
  });

  it('cocircular square builds deterministically', () => {
    const project = projectOf([
      pt('1', 0, 0, 10),
      pt('2', 10, 0, 20),
      pt('3', 10, 10, 30),
      pt('4', 0, 10, 40),
    ]);
    const ids = ['pt:1', 'pt:2', 'pt:3', 'pt:4'];
    const a = buildCadSurface(project, surfaceOf(ids));
    const b = buildCadSurface(project, surfaceOf(ids));
    expect(a.outcome).toBe('ok');
    expect(a.triangles).toEqual(b.triangles);
    expect(a.triangles).toHaveLength(2);
  });

  it('same-XY + differing-Z blocks; equal-Z dedupes; missing-Z skips with warning (never 0)', () => {
    const conflict = projectOf([pt('1', 0, 0, 1), pt('2', 10, 0, 2), pt('3', 5, 5, 3), pt('4', 0, 0, 99)]);
    const blocked = buildCadSurface(conflict, surfaceOf(['pt:1', 'pt:2', 'pt:3', 'pt:4']));
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.reasonCodes).toContain('SURFACE_DUPLICATE_XY_CONFLICT');
    expect(deriveSurfaceStatus(conflict, surfaceOf(['pt:1', 'pt:2', 'pt:3', 'pt:4']))).toBe('FAILED');

    const equalZ = projectOf([pt('1', 0, 0, 1), pt('2', 10, 0, 2), pt('3', 5, 5, 3), pt('4', 0, 0, 1)]);
    const deduped = buildCadSurface(equalZ, surfaceOf(['pt:1', 'pt:2', 'pt:3', 'pt:4']));
    expect(deduped.outcome).toBe('ok');
    expect(deduped.stats.usedPointCount).toBe(3);

    const missing = projectOf([pt('1', 0, 0, 1), pt('2', 10, 0, 2), pt('3', 5, 8, 3), pt('4', 5, 4)]);
    const skipped = buildCadSurface(missing, surfaceOf(['pt:1', 'pt:2', 'pt:3', 'pt:4']));
    expect(skipped.outcome).toBe('ok');
    expect(skipped.reasonCodes).toContain('SURFACE_POINT_MISSING_Z');
    expect(skipped.stats.skippedMissingZCount).toBe(1);
    expect(skipped.points.find((p) => p.entityId === 'pt:4')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Boundaries, breakline crossing, F2F chain
// ---------------------------------------------------------------------------

describe('boundary and void clipping', () => {
  const ringOf = (ids: string[], coords: Array<[number, number]>): CadEntity => ({
    id: ids[0],
    type: 'polyline',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: coords.map(([x, y]) => ({ x, y })),
    vertexLabels: [],
    closed: true,
  });

  it('outer clips and void cuts a query hole', () => {
    const zOf = (): number => 7;
    const { project, ids } = gridProject(7, zOf);
    const outer = ringOf(['outer1'], [[1, 1], [5, 1], [5, 5], [1, 5]]);
    // Void well clear of mesh vertices so centroid-clipped edges stay ragged-free at the probe.
    const hole = ringOf(['void1'], [[1.5, 1.5], [4.5, 1.5], [4.5, 4.5], [1.5, 4.5]]);
    (project.entities as CadEntity[]).push(outer, hole);
    const plain = buildCadSurface(project, surfaceOf(ids));
    const clipped = buildCadSurface(
      project,
      surfaceOf(ids, {
        boundaries: [
          { type: 'outer', sourceEntityId: 'outer1' },
          { type: 'void', sourceEntityId: 'void1' },
        ],
      }),
    );
    expect(plain.outcome).toBe('ok');
    expect(clipped.outcome).toBe('ok');
    expect(clipped.triangles.length).toBeLessThan(plain.triangles.length);
    expect(getSurfaceElevationAt(clipped, 3, 3)).toBeNull(); // inside void
    expect(getSurfaceElevationAt(clipped, 1.5, 1.5)).toBeCloseTo(7, 9);
    expect(getSurfaceElevationAt(plain, 3, 3)).toBeCloseTo(7, 9); // contrast: no hole
    expect(getSurfaceElevationAt(clipped, 0.2, 0.2)).toBeNull(); // outside outer
  });

  it('void outside the outer is SURFACE_VOID_INVALID', () => {
    const { project, ids } = gridProject(5, () => 1);
    (project.entities as CadEntity[]).push(
      ringOf(['outer1'], [[0, 0], [2, 0], [2, 2], [0, 2]]),
      ringOf(['void1'], [[3, 3], [3.9, 3], [3.9, 3.9], [3, 3.9]]),
    );
    const build = buildCadSurface(
      project,
      surfaceOf(ids, {
        boundaries: [
          { type: 'outer', sourceEntityId: 'outer1' },
          { type: 'void', sourceEntityId: 'void1' },
        ],
      }),
    );
    expect(build.outcome).toBe('blocked');
    expect(build.reasonCodes).toContain('SURFACE_VOID_INVALID');
  });
});

describe('breakline rules', () => {
  it('crossing breaklines without a shared vertex block', () => {
    const project = projectOf([
      pt('1', 0, 0, 1),
      pt('2', 4, 0, 2),
      pt('3', 0, 4, 3),
      pt('4', 4, 4, 4),
      pt('5', 2, -1, 5),
      pt('6', 2, 5, 6),
    ]);
    const build = buildCadSurface(
      project,
      surfaceOf(['pt:1', 'pt:2', 'pt:3', 'pt:4', 'pt:5', 'pt:6'], {
        breaklines: [
          { id: 'h', source: { kind: 'point-chain', pointEntityIds: ['pt:1', 'pt:2'] }, type: 'standard' },
          { id: 'v', source: { kind: 'point-chain', pointEntityIds: ['pt:5', 'pt:6'] }, type: 'standard' },
        ],
      }),
    );
    expect(build.outcome).toBe('blocked');
    expect(build.reasonCodes).toContain('SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX');
  });

  it('entity-backed F2F breakline resolves Z via station refs; unresolvable Z blocks', () => {
    const line = (id: string, stations: string[], sourcePointIds?: string[]): CadEntity => ({
      id,
      type: 'polyline',
      layerId: 'general',
      visible: true,
      locked: false,
      vertices: stations.map(() => ({ x: 0, y: 0 })),
      vertexLabels: stations,
      closed: false,
      ...(sourcePointIds ? { metadata: { sourcePointIds } } : {}),
    });
    const project = projectOf([
      pt('10', 0, 0, 100),
      pt('11', 10, 0, 101),
      pt('12', 10, 10, 102),
      pt('13', 0, 10, 103),
      line('lw1', ['10', '11', '12'], ['10', '11', '12']),
      line('lw-bad', ['10', '11'], ['10', 'ghost-station']),
    ]);
    const ok = buildCadSurface(
      project,
      surfaceOf(['pt:10', 'pt:11', 'pt:12', 'pt:13'], {
        breaklines: [{ id: 'f2f', source: { kind: 'entity', entityId: 'lw1' }, type: 'standard' }],
      }),
    );
    expect(ok.outcome).toBe('ok');
    const bad = buildCadSurface(
      project,
      surfaceOf(['pt:10', 'pt:11', 'pt:12', 'pt:13'], {
        breaklines: [{ id: 'f2f', source: { kind: 'entity', entityId: 'lw-bad' }, type: 'standard' }],
      }),
    );
    expect(bad.outcome).toBe('blocked');
    expect(bad.reasonCodes).toContain('SURFACE_BREAKLINE_MISSING_Z');
  });
});

describe('Steiner fallback', () => {
  it('requests a Steiner midpoint for a non-convex quad (unit)', () => {
    const points = [
      { u: 0, v: 0, z: 1 }, // 0 = A
      { u: 4, v: 0, z: 2 }, // 1 = B
      { u: 2, v: 2, z: 3 }, // 2 = P
      { u: 2, v: -2, z: 4 }, // 3 = Q
      { u: 1, v: 0, z: 5 }, // 4 = S (reflex: quad A,P,S,Q non-convex)
    ];
    const result = recoverConstrainedEdges(
      points,
      [
        { a: 2, b: 3, c: 0 },
        { a: 3, b: 2, c: 4 },
      ],
      [{ a: 0, b: 1 }],
    );
    expect(result.ok).toBe(false);
    expect(result.steiner).toHaveLength(1);
    expect(result.steiner[0].u).toBeCloseTo(2, 12);
    expect(result.steiner[0].v).toBeCloseTo(0, 12);
    expect(result.steinerFor).toEqual([{ a: 0, b: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Revision + status
// ---------------------------------------------------------------------------

describe('revision and status', () => {
  it('revision is deterministic and excludes display styling', () => {
    const { project, ids } = gridProject(4, (x, y) => x + y);
    const a = surfaceOf(ids);
    const b = surfaceOf(ids);
    b.styleId = 'other-style';
    b.layerId = 'other-layer';
    expect(computeCadSurfaceSourceRevision(project, a)).toBe(
      computeCadSurfaceSourceRevision(project, b),
    );
    expect(computeCadSurfaceSourceRevision(project, a)).toMatch(/^srev1:[0-9a-f]{8}$/);
  });

  it('derives UNBUILT → CURRENT → NEEDS_REBUILD → BROKEN_REFERENCE', () => {
    const { project, ids } = gridProject(4, (x, y) => x + y);
    const surface = surfaceOf(ids);
    expect(deriveSurfaceStatus(project, surface)).toBe('UNBUILT');
    const built = { ...surface, cachedRevision: computeCadSurfaceSourceRevision(project, surface) };
    expect(deriveSurfaceStatus(project, built)).toBe('CURRENT');
    const moved = projectOf(
      (project.entities as CadSurveyPointEntity[]).map((e) =>
        e.id === ids[0] ? { ...e, x: e.x + 0.5 } : { ...e },
      ),
    );
    expect(deriveSurfaceStatus(moved, built)).toBe('NEEDS_REBUILD');
    expect(deriveSurfaceStatus(project, surfaceOf(['missing-id', ...ids.slice(1)]))).toBe(
      'BROKEN_REFERENCE',
    );
    expect(deriveSurfaceStatus(project, surface, { building: true })).toBe('BUILDING');
  });

  it('never creates triangle entities and leaves the project untouched', () => {
    const { project, ids } = gridProject(4, (x, y) => x + y);
    const before = project.entities.length;
    const build = buildCadSurface(project, surfaceOf(ids));
    expect(build.outcome).toBe('ok');
    expect(project.entities.length).toBe(before);
    expect(project.entities.every((e) => (e.type as string) !== 'triangle')).toBe(true);
  });

  it('point-group sources resolve via membership', () => {
    const { project, ids } = gridProject(4, (x, y) => x + y);
    project.pointGroups = [{ id: 'g-all', name: 'All', query: {}, priority: 0 }];
    const build = buildCadSurface(project, {
      id: 'sg',
      name: 'group surface',
      definition: { pointSource: { kind: 'point-group', pointGroupId: 'g-all' } },
    });
    expect(build.outcome).toBe('ok');
    expect(build.stats.usedPointCount).toBe(ids.length);
    const missing = buildCadSurface(project, {
      id: 'sg2',
      name: 'bad group',
      definition: { pointSource: { kind: 'point-group', pointGroupId: 'nope' } },
    });
    expect(missing.outcome).toBe('blocked');
    expect(missing.reasonCodes).toContain('SURFACE_REFERENCE_MISSING');
  });
});

// ---------------------------------------------------------------------------
// Multi-group surface sources (18F fix-up: ordered list, union + dedupe)
// ---------------------------------------------------------------------------

describe('multi-group surface sources', () => {
  const groupedProject = (): { project: CadProject; ids: string[] } => {
    const { project, ids } = gridProject(4, (x, y) => x + y);
    // Two partial, overlapping groups over z = x + y (0..6): g-lo (z<=3,
    // 10 pts) + g-hi (z>=2, 13 pts); overlap 7, union all 16.
    project.pointGroups = [
      { id: 'g-lo', name: 'Low', query: { elevationMax: 3 }, priority: 0 },
      { id: 'g-hi', name: 'High', query: { elevationMin: 2 }, priority: 1 },
    ];
    return { project, ids };
  };

  it('unions TOPO + ALL with overlapping membership and no duplicate TIN vertices', () => {
    const { project, ids } = groupedProject();
    const build = buildCadSurface(project, {
      id: 'sm',
      name: 'multi',
      definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g-lo', 'g-hi'] } },
    });
    expect(build.outcome).toBe('ok');
    // Union resolves every grid point exactly once (overlap deduped).
    expect(build.stats.usedPointCount).toBe(ids.length);
    expect(build.stats.resolvedPointCount).toBe(ids.length);
    const seen = new Set(build.points.map((p) => p.entityId));
    expect(seen.size).toBe(build.points.length);
  });

  it('is order-invariant across group-id order (canonical sorted build)', () => {
    const { project } = groupedProject();
    const fwd = buildCadSurface(project, {
      id: 'sm',
      name: 'multi',
      definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g-lo', 'g-hi'] } },
    });
    const rev = buildCadSurface(project, {
      id: 'sm',
      name: 'multi',
      definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g-hi', 'g-lo'] } },
    });
    expect(fwd.outcome).toBe('ok');
    expect(rev.triangles).toEqual(fwd.triangles);
    expect(rev.revision).toBe(fwd.revision);
  });

  it('changes revision when any group membership changes (NEEDS_REBUILD)', () => {
    const { project } = groupedProject();
    const surface: CadSurface = {
      id: 'sm',
      name: 'multi',
      definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g-lo', 'g-hi'] } },
    };
    const built = { ...surface, cachedRevision: computeCadSurfaceSourceRevision(project, surface) };
    expect(deriveSurfaceStatus(project, built)).toBe('CURRENT');
    // Narrow g-hi to z>=5 (3 pts): membership changes => NEEDS_REBUILD.
    const narrowed = {
      ...project,
      pointGroups: [
        { id: 'g-lo', name: 'Low', query: { elevationMax: 3 }, priority: 0 },
        { id: 'g-hi', name: 'High', query: { elevationMin: 5 }, priority: 1 },
      ],
    } as CadProject;
    expect(deriveSurfaceStatus(narrowed, built)).toBe('NEEDS_REBUILD');
    expect(computeCadSurfaceSourceRevision(narrowed, surface)).not.toBe(built.cachedRevision);
  });

  it('backfills the legacy single-group source to a one-element list with identical builds', () => {
    const { project } = groupedProject();
    const legacy: CadSurface = {
      id: 'sm',
      name: 'multi',
      definition: { pointSource: { kind: 'point-group', pointGroupId: 'g-hi' } },
    };
    const canonical: CadSurface = {
      id: 'sm',
      name: 'multi',
      definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g-hi'] } },
    };
    const a = buildCadSurface(project, legacy);
    const b = buildCadSurface(project, canonical);
    expect(a.outcome).toBe('ok');
    expect(a.triangles).toEqual(b.triangles);
    expect(a.revision).toBe(b.revision);
  });

  it('reports every missing group id as a broken ref', () => {
    const { project } = groupedProject();
    const build = buildCadSurface(project, {
      id: 'sm',
      name: 'multi',
      definition: { pointSource: { kind: 'point-group', pointGroupIds: ['g-lo', 'g-gone'] } },
    });
    expect(build.outcome).toBe('blocked');
    expect(build.reasonCodes).toContain('SURFACE_REFERENCE_MISSING');
  });
});
