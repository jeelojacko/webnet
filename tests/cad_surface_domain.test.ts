import { describe, expect, it } from 'vitest';
import type {
  CadEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import {
  buildCadSurface,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaces';
import {
  applySurfaceBuildSuccess,
  createCadSurfaceCache,
} from '../src/engine/cad/cadSurfaceCache';
import { queryMeshElevation } from '../src/engine/cad/cadSurfaceView';
import { pointInRing } from '../src/engine/cad/tin/tinPredicates';
import { validateTinMesh } from '../src/engine/cad/tin/tinTopology';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;

const pt = (
  stationId: string,
  x: number,
  y: number,
  z: number,
): CadSurveyPointEntity => ({
  id: `pt:${stationId}:${(seq += 1)}`,
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

const projectOf = (entities: CadEntity[]): CadProject =>
  ({
    version: 2,
    id: 'proj-domain',
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
  id: `dom${(seq += 1)}`,
  name: 'domain surface',
  definition: { pointSource: { kind: 'points', pointEntityIds }, ...overrides },
});

const ringEntity = (id: string, coords: Array<[number, number]>): CadEntity =>
  ({
    id,
    type: 'polyline',
    layerId: 'general',
    visible: true,
    locked: false,
    vertices: coords.map(([x, y]) => ({ x, y })),
    vertexLabels: [],
    closed: true,
  }) as unknown as CadEntity;

const gridEntities = (n: number, z: number): CadSurveyPointEntity[] => {
  const out: CadSurveyPointEntity[] = [];
  for (let x = 0; x < n; x += 1) {
    for (let y = 0; y < n; y += 1) {
      out.push(pt(`${x}-${y}`, x, y, z));
    }
  }
  return out;
};

const shoelace = (ring: Array<[number, number]>): number => {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
};

const closeToArea = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected)).toBeLessThan(1e-6);
};

/** Rebuild long-form constraint segments (corner-to-corner) from a build. */
const segmentsOfBuild = (
  build: ReturnType<typeof buildCadSurface>,
  rings: Array<{ coords: Array<[number, number]>; kind: 'outer' | 'void' }>,
  breaklines: string[][],
): Array<{ a: number; b: number; kind: 'breakline' | 'outer' | 'void' }> => {
  const indexOfXy = (x: number, y: number): number =>
    build.points.findIndex((p) => p.x === x && p.y === y);
  const indexOfId = (id: string): number => build.points.findIndex((p) => p.entityId === id);
  const segs: Array<{ a: number; b: number; kind: 'breakline' | 'outer' | 'void' }> = [];
  for (const { coords, kind } of rings) {
    for (let i = 0; i < coords.length; i += 1) {
      const [x1, y1] = coords[i];
      const [x2, y2] = coords[(i + 1) % coords.length];
      segs.push({ a: indexOfXy(x1, y1), b: indexOfXy(x2, y2), kind });
    }
  }
  for (const chain of breaklines) {
    for (let i = 0; i + 1 < chain.length; i += 1) {
      segs.push({ a: indexOfId(chain[i]), b: indexOfId(chain[i + 1]), kind: 'breakline' });
    }
  }
  return segs;
};

const expectValidMesh = (
  build: ReturnType<typeof buildCadSurface>,
  rings: Array<{ coords: Array<[number, number]>; kind: 'outer' | 'void' }>,
  breaklines: string[][] = [],
): void => {
  if (build.outcome !== 'ok') throw new Error(`expected ok, got ${build.outcome}`);
  const result = validateTinMesh({
    points: build.points,
    triangles: build.triangles,
    adjacency: build.adjacency,
    edgeKinds: build.edgeKinds,
    segments: segmentsOfBuild(build, rings, breaklines),
  });
  expect(result.errors).toEqual([]);
  expect(result.ok).toBe(true);
};

// ---------------------------------------------------------------------------
// Concave outer oracle
// ---------------------------------------------------------------------------

describe('concave outer oracle', () => {
  // L-shaped outer (notch = top-right 3x3 of a 6x6 square).
  const outer: Array<[number, number]> = [[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6]];
  const setup = () => {
    const entities: CadEntity[] = [...gridEntities(7, 7)];
    entities.push(ringEntity('outerL', outer));
    const project = projectOf(entities);
    const ids = entities.filter((e) => e.type === 'survey-point').map((e) => e.id);
    return { project, ids };
  };

  it('retains exactly the L domain: no outside triangles, no holes, exact area', () => {
    const { project, ids } = setup();
    const build = buildCadSurface(
      project,
      surfaceOf(ids, { boundaries: [{ type: 'outer', sourceEntityId: 'outerL' }] }),
    );
    expect(build.outcome).toBe('ok');
    if (build.outcome !== 'ok') return;
    const ringXy = outer.map(([x, y]) => ({ x, y }));
    for (const tri of build.triangles) {
      const cx = (build.points[tri[0]].x + build.points[tri[1]].x + build.points[tri[2]].x) / 3;
      const cy = (build.points[tri[0]].y + build.points[tri[1]].y + build.points[tri[2]].y) / 3;
      expect(pointInRing(cx, cy, ringXy)).toBe(true);
    }
    const used = new Set<number>();
    for (const tri of build.triangles) for (const v of tri) used.add(v);
    for (const v of used) {
      const p = build.points[v];
      // Every retained vertex is inside-or-on the outer (boundary vertices on it).
      expect(pointInRing(p.x, p.y, ringXy)).toBe(true);
    }
    closeToArea(build.stats.planimetricArea, shoelace(outer));
    expect(getSurfaceElevationAt(build, 4.5, 4.5)).toBeNull(); // in the notch
    expect(getSurfaceElevationAt(build, 1, 1)).toBeCloseTo(7, 9);
    expect(getSurfaceElevationAt(build, 1, 5)).toBeCloseTo(7, 9);
    expectValidMesh(build, [{ coords: outer, kind: 'outer' }]);
  });
});

// ---------------------------------------------------------------------------
// Narrow void + two disjoint voids
// ---------------------------------------------------------------------------

describe('void oracles', () => {
  it('narrow void: zero retained inside, null in void, outer unaffected', () => {
    const entities: CadEntity[] = [...gridEntities(9, 4)];
    const outer: Array<[number, number]> = [[0, 0], [8, 0], [8, 8], [0, 8]];
    // Thin sliver between grid lines (0.2 wide — sub-cell classification).
    const voidRing: Array<[number, number]> = [[2.4, 2], [2.6, 2], [2.6, 6], [2.4, 6]];
    entities.push(ringEntity('outer1', outer), ringEntity('void1', voidRing));
    const project = projectOf(entities);
    const ids = entities.filter((e) => e.type === 'survey-point').map((e) => e.id);
    const build = buildCadSurface(
      project,
      surfaceOf(ids, {
        boundaries: [
          { type: 'outer', sourceEntityId: 'outer1' },
          { type: 'void', sourceEntityId: 'void1' },
        ],
      }),
    );
    expect(build.outcome).toBe('ok');
    if (build.outcome !== 'ok') return;
    const voidXy = voidRing.map(([x, y]) => ({ x, y }));
    let insideCount = 0;
    for (const tri of build.triangles) {
      const cx = (build.points[tri[0]].x + build.points[tri[1]].x + build.points[tri[2]].x) / 3;
      const cy = (build.points[tri[0]].y + build.points[tri[1]].y + build.points[tri[2]].y) / 3;
      if (pointInRing(cx, cy, voidXy)) insideCount += 1;
    }
    expect(insideCount).toBe(0);
    expect(getSurfaceElevationAt(build, 2.5, 4)).toBeNull();
    expect(getSurfaceElevationAt(build, 1, 1)).toBeCloseTo(4, 9);
    expect(getSurfaceElevationAt(build, 7.5, 7.5)).toBeCloseTo(4, 9);
    closeToArea(build.stats.planimetricArea, shoelace(outer) - shoelace(voidRing));
    expectValidMesh(build, [
      { coords: outer, kind: 'outer' },
      { coords: voidRing, kind: 'void' },
    ]);
  });

  it('two disjoint voids both cut, area subtracts both', () => {
    const entities: CadEntity[] = [...gridEntities(9, 4)];
    const outer: Array<[number, number]> = [[0, 0], [8, 0], [8, 8], [0, 8]];
    const voidA: Array<[number, number]> = [[1.5, 1.5], [2.5, 1.5], [2.5, 2.5], [1.5, 2.5]];
    const voidB: Array<[number, number]> = [[5.5, 5.5], [6.5, 5.5], [6.5, 6.5], [5.5, 6.5]];
    entities.push(ringEntity('outer1', outer), ringEntity('voidA', voidA), ringEntity('voidB', voidB));
    const project = projectOf(entities);
    const ids = entities.filter((e) => e.type === 'survey-point').map((e) => e.id);
    const build = buildCadSurface(
      project,
      surfaceOf(ids, {
        boundaries: [
          { type: 'outer', sourceEntityId: 'outer1' },
          { type: 'void', sourceEntityId: 'voidA' },
          { type: 'void', sourceEntityId: 'voidB' },
        ],
      }),
    );
    expect(build.outcome).toBe('ok');
    if (build.outcome !== 'ok') return;
    expect(getSurfaceElevationAt(build, 2, 2)).toBeNull();
    expect(getSurfaceElevationAt(build, 6, 6)).toBeNull();
    expect(getSurfaceElevationAt(build, 4, 4)).toBeCloseTo(4, 9);
    closeToArea(build.stats.planimetricArea, shoelace(outer) - shoelace(voidA) - shoelace(voidB));
    expectValidMesh(build, [
      { coords: outer, kind: 'outer' },
      { coords: voidA, kind: 'void' },
      { coords: voidB, kind: 'void' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Breakline terminating on a boundary (shared vertex, no false crossing)
// ---------------------------------------------------------------------------

describe('breakline-on-boundary oracle', () => {
  it('breakline ending at an outer corner and a void corner builds clean', () => {
    const entities: CadEntity[] = [...gridEntities(7, 3)];
    const outer: Array<[number, number]> = [[1, 1], [5, 1], [5, 5], [1, 5]];
    const voidRing: Array<[number, number]> = [[2.5, 2.5], [3.5, 2.5], [3.5, 3.5], [2.5, 3.5]];
    // Survey point exactly on the void corner (shared vertex).
    const corner = pt('corner', 2.5, 2.5, 9);
    entities.push(corner, ringEntity('outer1', outer), ringEntity('void1', voidRing));
    const project = projectOf(entities);
    const byXy = new Map(
      entities.filter((e) => e.type === 'survey-point').map((e) => [`${(e as CadSurveyPointEntity).x},${(e as CadSurveyPointEntity).y}`, e.id]),
    );
    const at = (x: number, y: number): string => byXy.get(`${x},${y}`) as string;
    const ids = [...byXy.values()];
    // Breakline from the outer corner (1,1) to the void corner (2.5,2.5).
    const chain = [at(1, 1), at(2, 2), corner.id];
    const build = buildCadSurface(
      project,
      surfaceOf(ids, {
        breaklines: [{ id: 'bl', source: { kind: 'point-chain', pointEntityIds: chain }, type: 'standard' }],
        boundaries: [
          { type: 'outer', sourceEntityId: 'outer1' },
          { type: 'void', sourceEntityId: 'void1' },
        ],
      }),
    );
    expect(build.outcome).toBe('ok');
    if (build.outcome !== 'ok') return;
    const byId = new Map(build.points.map((p, i) => [p.entityId, i]));
    const edges = new Set<string>();
    for (const tri of build.triangles) {
      for (const [p, q] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
        edges.add(`${Math.min(p, q)}>${Math.max(p, q)}`);
      }
    }
    for (let i = 0; i + 1 < chain.length; i += 1) {
      const a = byId.get(chain[i]) as number;
      const b = byId.get(chain[i + 1]) as number;
      expect(edges.has(`${Math.min(a, b)}>${Math.max(a, b)}`)).toBe(true);
    }
    expect(getSurfaceElevationAt(build, 3, 3)).toBeNull(); // void interior
    expectValidMesh(
      build,
      [
        { coords: outer, kind: 'outer' },
        { coords: voidRing, kind: 'void' },
      ],
      [chain],
    );
  });
});

// ---------------------------------------------------------------------------
// Invalid relations fail closed with stable diagnostics
// ---------------------------------------------------------------------------

describe('invalid boundary relations', () => {
  const setup2 = () => {
    const entities: CadEntity[] = [...gridEntities(6, 1)];
    const project = projectOf(entities);
    const ids = entities.map((e) => e.id);
    return { project, ids, entities };
  };

  it('void crossing the outer is SURFACE_VOID_INVALID', () => {
    const { project, ids, entities } = setup2();
    entities.push(
      ringEntity('outer1', [[0, 0], [4, 0], [4, 4], [0, 4]]),
      ringEntity('void1', [[3, 3], [5, 3], [5, 5], [3, 5]]),
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

  it('overlapping voids are SURFACE_VOID_INVALID', () => {
    const { project, ids, entities } = setup2();
    entities.push(
      ringEntity('outer1', [[0, 0], [5, 0], [5, 5], [0, 5]]),
      ringEntity('voidA', [[1, 1], [3, 1], [3, 3], [1, 3]]),
      ringEntity('voidB', [[2, 2], [4, 2], [4, 4], [2, 4]]),
    );
    const build = buildCadSurface(
      project,
      surfaceOf(ids, {
        boundaries: [
          { type: 'outer', sourceEntityId: 'outer1' },
          { type: 'void', sourceEntityId: 'voidA' },
          { type: 'void', sourceEntityId: 'voidB' },
        ],
      }),
    );
    expect(build.outcome).toBe('blocked');
    expect(build.reasonCodes).toContain('SURFACE_VOID_INVALID');
  });

  it('self-intersecting (bowtie) outer is SURFACE_BOUNDARY_INVALID', () => {
    const { project, ids, entities } = setup2();
    entities.push(ringEntity('outer1', [[0, 0], [4, 4], [4, 0], [0, 4]]));
    const build = buildCadSurface(
      project,
      surfaceOf(ids, { boundaries: [{ type: 'outer', sourceEntityId: 'outer1' }] }),
    );
    expect(build.outcome).toBe('blocked');
    expect(build.reasonCodes).toContain('SURFACE_BOUNDARY_INVALID');
  });

  it('breakline crossing a void without a vertex is SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX', () => {
    const { project, ids, entities } = setup2();
    entities.push(
      ringEntity('outer1', [[0, 0], [5, 0], [5, 5], [0, 5]]),
      ringEntity('void1', [[2, 2], [3, 2], [3, 3], [2, 3]]),
    );
    const byXy = new Map(
      entities.filter((e) => e.type === 'survey-point').map((e) => [`${(e as CadSurveyPointEntity).x},${(e as CadSurveyPointEntity).y}`, e.id]),
    );
    const build = buildCadSurface(
      project,
      surfaceOf(ids, {
        breaklines: [{
          id: 'bl',
          source: { kind: 'point-chain', pointEntityIds: [byXy.get('0,0') as string, byXy.get('5,5') as string] },
          type: 'standard',
        }],
        boundaries: [
          { type: 'outer', sourceEntityId: 'outer1' },
          { type: 'void', sourceEntityId: 'void1' },
        ],
      }),
    );
    expect(build.outcome).toBe('blocked');
    expect(build.reasonCodes).toContain('SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX');
  });

  it('breakline T-touching a boundary mid-edge (no shared vertex) stays blocked', () => {
    const { project, ids, entities } = setup2();
    entities.push(ringEntity('outer1', [[1, 1], [4, 1], [4, 4], [1, 4]]));
    const byXy = new Map(
      entities.filter((e) => e.type === 'survey-point').map((e) => [`${(e as CadSurveyPointEntity).x},${(e as CadSurveyPointEntity).y}`, e.id]),
    );
    // Vertical chain x=2.5? No grid point there — use x=2 from y=0 to y=5,
    // crossing the outer bottom edge mid-edge (no shared vertex).
    const build = buildCadSurface(
      project,
      surfaceOf(ids, {
        breaklines: [{
          id: 'bl',
          source: { kind: 'point-chain', pointEntityIds: [byXy.get('2,0') as string, byXy.get('2,5') as string] },
          type: 'standard',
        }],
        boundaries: [{ type: 'outer', sourceEntityId: 'outer1' }],
      }),
    );
    expect(build.outcome).toBe('blocked');
    expect(build.reasonCodes).toContain('SURFACE_BREAKLINES_INTERSECT_WITHOUT_VERTEX');
  });
});

// ---------------------------------------------------------------------------
// Analytic area checks
// ---------------------------------------------------------------------------

describe('analytic area checks', () => {
  it('square / L-shape / square-with-square-void match polygon areas', () => {
    const square: Array<[number, number]> = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const ell: Array<[number, number]> = [[0, 0], [10, 0], [10, 4], [4, 4], [4, 10], [0, 10]];
    const hole: Array<[number, number]> = [[2, 2], [5, 2], [5, 5], [2, 5]];
    const entities: CadEntity[] = [];
    for (let x = 0; x <= 10; x += 1) {
      for (let y = 0; y <= 10; y += 1) {
        entities.push(pt(`${x}-${y}`, x, y, x + y));
      }
    }
    entities.push(
      ringEntity('sq', square),
      ringEntity('ell', ell),
      ringEntity('hole', hole),
    );
    const project = projectOf(entities);
    const ids = entities.filter((e) => e.type === 'survey-point').map((e) => e.id);
    const sq = buildCadSurface(project, surfaceOf(ids, { boundaries: [{ type: 'outer', sourceEntityId: 'sq' }] }));
    expect(sq.outcome).toBe('ok');
    if (sq.outcome === 'ok') closeToArea(sq.stats.planimetricArea, 100);
    const l = buildCadSurface(project, surfaceOf(ids, { boundaries: [{ type: 'outer', sourceEntityId: 'ell' }] }));
    expect(l.outcome).toBe('ok');
    if (l.outcome === 'ok') closeToArea(l.stats.planimetricArea, shoelace(ell));
    const h = buildCadSurface(
      project,
      surfaceOf(ids, {
        boundaries: [
          { type: 'outer', sourceEntityId: 'sq' },
          { type: 'void', sourceEntityId: 'hole' },
        ],
      }),
    );
    expect(h.outcome).toBe('ok');
    if (h.outcome === 'ok') closeToArea(h.stats.planimetricArea, 100 - 9);
  });
});

// ---------------------------------------------------------------------------
// Translation + shuffle invariance with boundaries
// ---------------------------------------------------------------------------

describe('boundary invariance oracles', () => {
  const outer: Array<[number, number]> = [[1, 1], [5, 1], [5, 5], [1, 5]];
  const voidRing: Array<[number, number]> = [[2.5, 2.5], [3.5, 2.5], [3.5, 3.5], [2.5, 3.5]];
  const boundaries = [
    { type: 'outer', sourceEntityId: 'outer1' } as const,
    { type: 'void', sourceEntityId: 'void1' } as const,
  ];
  const setup = (dx: number, dy: number) => {
    const entities: CadEntity[] = [];
    for (let x = 0; x < 7; x += 1) {
      for (let y = 0; y < 7; y += 1) {
        entities.push(pt(`${x}-${y}`, x + dx, y + dy, x + 2 * y));
      }
    }
    const shift = (ring: Array<[number, number]>): Array<[number, number]> =>
      ring.map(([x, y]) => [x + dx, y + dy]);
    entities.push(ringEntity('outer1', shift(outer)), ringEntity('void1', shift(voidRing)));
    const project = projectOf(entities);
    const ids = entities.filter((e) => e.type === 'survey-point').map((e) => e.id);
    return { project, ids };
  };

  it('boundaries + voids shifted by millions keep canonical topology', () => {
    const a = setup(0, 0);
    const b = setup(2e6, 7e6);
    const ra = buildCadSurface(a.project, surfaceOf(a.ids, { boundaries: [...boundaries] }));
    const rb = buildCadSurface(b.project, surfaceOf(b.ids, { boundaries: [...boundaries] }));
    expect(ra.outcome).toBe('ok');
    expect(rb.outcome).toBe('ok');
    if (ra.outcome !== 'ok' || rb.outcome !== 'ok') return;
    expect(rb.triangles).toEqual(ra.triangles);
    expect(rb.adjacency).toEqual(ra.adjacency);
    expect(rb.edgeKinds).toEqual(ra.edgeKinds);
    closeToArea(rb.stats.planimetricArea, ra.stats.planimetricArea);
    expect(getSurfaceElevationAt(rb, 2e6 + 1.5, 7e6 + 2.5)).toBeCloseTo(
      getSurfaceElevationAt(ra, 1.5, 2.5) as number,
      6,
    );
    expect(getSurfaceElevationAt(rb, 2e6 + 3, 7e6 + 3)).toBeNull();
  });

  it('permuted points / breaklines / rings keep canonical output', () => {
    const { project, ids } = setup(0, 0);
    const byXy = new Map(
      project.entities
        .filter((e) => e.type === 'survey-point')
        .map((e) => [`${(e as CadSurveyPointEntity).x},${(e as CadSurveyPointEntity).y}`, e.id]),
    );
    const chainA = [byXy.get('0,0') as string, byXy.get('0,6') as string];
    const chainB = [byXy.get('6,0') as string, byXy.get('6,6') as string];
    const fwd = buildCadSurface(
      project,
      surfaceOf(ids, {
        breaklines: [
          { id: 'a', source: { kind: 'point-chain', pointEntityIds: chainA }, type: 'standard' },
          { id: 'b', source: { kind: 'point-chain', pointEntityIds: chainB }, type: 'standard' },
        ],
        boundaries: [...boundaries],
      }),
    );
    const rev = buildCadSurface(
      project,
      surfaceOf([...ids].reverse(), {
        breaklines: [
          { id: 'b', source: { kind: 'point-chain', pointEntityIds: chainB }, type: 'standard' },
          { id: 'a', source: { kind: 'point-chain', pointEntityIds: chainA }, type: 'standard' },
        ],
        boundaries: [...boundaries].reverse(),
      }),
    );
    expect(fwd.outcome).toBe('ok');
    expect(rev.outcome).toBe('ok');
    if (fwd.outcome !== 'ok' || rev.outcome !== 'ok') return;
    // Canonical equality: same triangles, same XYZ (ids may differ textually
    // only via boundary-tail order — asserted XYZ-equal here).
    expect(rev.triangles).toEqual(fwd.triangles);
    expect(rev.points.map((p) => [p.x, p.y, p.z])).toEqual(
      fwd.points.map((p) => [p.x, p.y, p.z]),
    );
    expect(rev.adjacency).toEqual(fwd.adjacency);
  });
});

// ---------------------------------------------------------------------------
// Plane preserved under boundaries (18F oracle held + Z interp exactness)
// ---------------------------------------------------------------------------

describe('plane oracle with boundaries', () => {
  it('z = 2x + 3y + 5 reproduces exactly inside an inset outer', () => {
    const zOf = (x: number, y: number): number => 2 * x + 3 * y + 5;
    const entities: CadEntity[] = [];
    for (let x = 0; x < 7; x += 1) {
      for (let y = 0; y < 7; y += 1) {
        entities.push(pt(`${x}-${y}`, x, y, zOf(x, y)));
      }
    }
    entities.push(ringEntity('outer1', [[1, 1], [5, 1], [5, 5], [1, 5]]));
    const project = projectOf(entities);
    const ids = entities.filter((e) => e.type === 'survey-point').map((e) => e.id);
    const build = buildCadSurface(
      project,
      surfaceOf(ids, { boundaries: [{ type: 'outer', sourceEntityId: 'outer1' }] }),
    );
    expect(build.outcome).toBe('ok');
    if (build.outcome !== 'ok') return;
    for (const [x, y] of [[1.5, 1.5], [2.3, 1.7], [3.9, 3.1], [4.5, 4.5]]) {
      expect(getSurfaceElevationAt(build, x, y)).toBeCloseTo(zOf(x, y), 9);
    }
    expect(getSurfaceElevationAt(build, 0.2, 0.2)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edge/border query policy pins
// ---------------------------------------------------------------------------

describe('edge query policy', () => {
  it('shared edge / outer boundary / void boundary are deterministic and finite', () => {
    const entities: CadEntity[] = [...gridEntities(7, 7)];
    const outer: Array<[number, number]> = [[1, 1], [5, 1], [5, 5], [1, 5]];
    const voidRing: Array<[number, number]> = [[2.5, 2.5], [3.5, 2.5], [3.5, 3.5], [2.5, 3.5]];
    entities.push(ringEntity('outer1', outer), ringEntity('void1', voidRing));
    const project = projectOf(entities);
    const ids = entities.filter((e) => e.type === 'survey-point').map((e) => e.id);
    const def = {
      boundaries: [
        { type: 'outer', sourceEntityId: 'outer1' } as const,
        { type: 'void', sourceEntityId: 'void1' } as const,
      ],
    };
    const a = buildCadSurface(project, surfaceOf(ids, def));
    const b = buildCadSurface(project, surfaceOf(ids, def));
    expect(a.outcome).toBe('ok');
    if (a.outcome !== 'ok' || b.outcome !== 'ok') return;
    // Interior shared-edge midpoint: bit-identical across rebuilds.
    const e1 = getSurfaceElevationAt(a, 1.5, 2);
    expect(e1).not.toBeNull();
    expect(getSurfaceElevationAt(b, 1.5, 2)).toBe(e1);
    expect(e1).toBeCloseTo(7, 9);
    // Outer boundary midpoint: inclusive (finite).
    expect(getSurfaceElevationAt(a, 3, 1)).toBeCloseTo(7, 9);
    // Void boundary midpoint: inclusive of the surface (finite, continuous).
    expect(getSurfaceElevationAt(a, 3, 2.5)).toBeCloseTo(7, 9);
    // Void interior + exterior: null.
    expect(getSurfaceElevationAt(a, 3, 3)).toBeNull();
    expect(getSurfaceElevationAt(a, 0.2, 0.2)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Grid wired through the cache boundary
// ---------------------------------------------------------------------------

describe('inquiry index passthrough', () => {
  it('cached mesh carries the grid and answers identically to the engine', () => {
    const entities: CadEntity[] = [...gridEntities(7, 7)];
    const outer: Array<[number, number]> = [[1, 1], [5, 1], [5, 5], [1, 5]];
    const voidRing: Array<[number, number]> = [[2.5, 2.5], [3.5, 2.5], [3.5, 3.5], [2.5, 3.5]];
    entities.push(ringEntity('outer1', outer), ringEntity('void1', voidRing));
    const project = projectOf(entities);
    const surface: CadSurface = {
      id: 'grid-seam',
      name: 'grid seam',
      definition: {
        pointSource: {
          kind: 'points',
          pointEntityIds: entities.filter((e) => e.type === 'survey-point').map((e) => e.id),
        },
        boundaries: [
          { type: 'outer', sourceEntityId: 'outer1' },
          { type: 'void', sourceEntityId: 'void1' },
        ],
      },
    };
    const build = buildCadSurface(project, surface);
    expect(build.outcome).toBe('ok');
    if (build.outcome !== 'ok') return;
    project.surfaces = [surface];
    const cache = createCadSurfaceCache('seam');
    const applied = applySurfaceBuildSuccess(project, cache, surface.id, build.revision, build);
    expect(applied).not.toBe(project);
    const mesh = cache.get(surface.id, build.revision);
    expect(mesh).toBeDefined();
    expect(mesh!.grid.cells.size).toBeGreaterThan(0);
    expect(mesh!.adjacency).toEqual(build.adjacency);
    for (const [x, y] of [[1.5, 1.5], [4.2, 3.7], [3, 3], [0.2, 0.2], [3, 1], [3, 2.5]]) {
      expect(queryMeshElevation(mesh!, x, y)).toBe(getSurfaceElevationAt(build, x, y));
    }
  });
});

// ---------------------------------------------------------------------------
// validateTinMesh unit pins
// ---------------------------------------------------------------------------

describe('validateTinMesh', () => {
  const square = (): {
    points: Array<{ x: number; y: number }>;
    triangles: Array<[number, number, number]>;
    adjacency: Array<[number, number, number]>;
    edgeKinds: Array<[0 | 1 | 2 | 3, 0 | 1 | 2 | 3, 0 | 1 | 2 | 3]>;
    segments: Array<{ a: number; b: number; kind: 'breakline' | 'outer' | 'void' }>;
  } => ({
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    triangles: [[0, 1, 2], [0, 2, 3]] as Array<[number, number, number]>,
    // Edge opposite 0/1/2: tri0 (0,1,2): (1,2)→tri? shared (1,2)? tri1 has (0,2),(2,3),(3,0).
    // Shared edge (0,2): tri0 opposite vertex 1 → neighbor 1; tri1 opposite vertex 1 → neighbor 0.
    adjacency: [[-1, 1, -1], [-1, -1, 0]] as Array<[number, number, number]>,
    edgeKinds: [[[0, 0, 0]], [[0, 0, 0]]].map((r) => r[0]) as Array<[0 | 1 | 2 | 3, 0 | 1 | 2 | 3, 0 | 1 | 2 | 3]>,
    segments: [{ a: 0, b: 2, kind: 'breakline' as const }],
  });
  it('accepts a valid mesh with the diagonal constrained', () => {
    const m = square();
    // Diagonal (0,2): tri0 edge opposite vertex 1 → kind 1; tri1 edge opposite 2 → kind 1.
    m.edgeKinds = [[0, 1, 0], [0, 0, 1]];
    expect(validateTinMesh(m).ok).toBe(true);
  });

  it('rejects asymmetric adjacency, duplicates, flipped winding, and bad flags', () => {
    const asym = square();
    asym.adjacency = [[-1, 1, -1], [-1, -1, -1]];    expect(validateTinMesh(asym).ok).toBe(false);
    expect(validateTinMesh(asym).errors.some((e) => e.includes('asymmetric'))).toBe(true);

    const dupe = square();
    dupe.triangles = [[0, 1, 2], [0, 1, 2]];
    dupe.adjacency = [[-1, -1, -1], [-1, -1, -1]];
    expect(validateTinMesh(dupe).errors.some((e) => e.includes('duplicate'))).toBe(true);

    const flipped = square();
    flipped.triangles = [[0, 2, 1], [0, 2, 3]];
    expect(validateTinMesh(flipped).errors.some((e) => e.includes('CCW'))).toBe(true);

    const badFlag = square();
    badFlag.edgeKinds = [[0, 0, 0], [0, 0, 1]];
    expect(validateTinMesh(badFlag).errors.some((e) => e.includes('flag'))).toBe(true);

    const missing = square();
    missing.edgeKinds = [[0, 1, 0], [0, 0, 1]];
    missing.segments = [{ a: 1, b: 3, kind: 'breakline' }];
    const result = validateTinMesh(missing);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('flag') || e.includes('not covered'))).toBe(true);
  });

  it('rejects a triangle edge crossing a constrained segment', () => {
    const m = square();
    m.points = [...m.points, { x: 5, y: -1 }, { x: 5, y: 11 }];
    m.segments = [{ a: 4, b: 5, kind: 'outer' }];
    m.edgeKinds = [[0, 1, 0], [0, 0, 1]];
    // The (4,5) vertical crosses every horizontal mesh edge without contact.
    const result = validateTinMesh(m);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('crosses') || e.includes('not covered'))).toBe(true);
  });
});

describe('large-scale stack regression (18G spread fix)', () => {
  it('builds a 50k-point surface without argument-spread stack overflow', () => {
    // Pins the tinBase/isCollinearWorld loop fix: Math.min/max(...n)
    // throws RangeError above ~100k args (smaller worker stacks overflow
    // at 50k points = 100k args). Deterministic jitter, no RNG.
    const COUNT = 50000;
    const cols = Math.ceil(Math.sqrt(COUNT));
    const entities: CadSurveyPointEntity[] = [];
    let index = 0;
    for (let row = 0; entities.length < COUNT; row += 1) {
      for (let col = 0; col < cols && entities.length < COUNT; col += 1) {
        index += 1;
        entities.push(
          pt(`L${index}`, col * 10 + ((index * 37) % 10) * 0.1, row * 10 + ((index * 53) % 10) * 0.1, 100 + col * 0.5 + row * 0.3),
        );
      }
    }
    const ids = entities.map((e) => e.id);
    const project = projectOf(entities);
    const surface: CadSurface = {
      id: 's-large',
      name: 'large',
      definition: { pointSource: { kind: 'points', pointEntityIds: ids } },
    };
    project.surfaces = [surface];
    const result = buildCadSurface(project, surface);
    expect(result.outcome).toBe('ok');
    expect(result.triangles.length).toBeGreaterThan(90000);
    expect(result.stats.planimetricArea).toBeGreaterThan(0);
    expect(validateTinMesh({
      points: result.points.map((p) => ({ x: p.x, y: p.y })),
      triangles: result.triangles,
      adjacency: result.adjacency,
      edgeKinds: result.edgeKinds,
      segments: [],
    }).ok).toBe(true);
  });
});
