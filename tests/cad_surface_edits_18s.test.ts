import { describe, expect, it } from 'vitest';
import { orient2d } from 'robust-predicates';
import type {
  CadEntity,
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  getSurfaceElevationAt,
  replaySurfaceEdits,
} from '../src/engine/cad/cadSurfaces';
import {
  applyCadSurfaceEdits,
  CadSurfaceEditFailure,
  type CadSurfaceEditBaseline,
} from '../src/engine/cad/cadSurfaceEdits';
import type { CadSurfaceEditMeshPoint } from '../src/engine/cad/cadSurfaceEditMesh';
import {
  buildSurfaceBuildRequest,
  cloneCadSurfaceDefinition,
} from '../src/engine/cad/cadSurfaceTypes';
import { TIN_EDGE_FREE, type TinEdgeKinds } from '../src/engine/cad/tin/tinTypes';
import { buildSurfaceMeshFromRequest } from '../src/workers/surfaceWorkerHandler';
import { applyCadProjectCoordinateTransform } from '../src/engine/cad/cadProjectTransform';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let seq = 0;

const pt = (stationId: string, x: number, y: number, z?: number): CadSurveyPointEntity => ({
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

const projectOf = (entities: CadEntity[], surfaces: CadSurface[] = []): CadProject =>
  ({
    version: 2,
    id: 'proj-18s',
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
    surfaces,
    cogoComputations: [],
    bounds: null,
  }) as unknown as CadProject;

const surfaceOf = (pointEntityIds: string[], overrides?: Partial<CadSurface['definition']>): CadSurface => {
  seq += 1;
  return {
    id: `s18s-${seq}`,
    name: 'test surface',
    definition: { pointSource: { kind: 'points', pointEntityIds }, ...overrides },
  };
};

const src = (id: string): { key: string } => ({ key: `source:${id}` });
const swapOf = (id: string, a: string, b: string, enabled?: boolean): CadSurfaceEdit => ({
  id,
  kind: 'swap-edge',
  ...(enabled === undefined ? {} : { enabled }),
  edge: { a: src(a), b: src(b) },
});
const delOf = (id: string, a: string, b: string, enabled?: boolean): CadSurfaceEdit => ({
  id,
  kind: 'delete-line',
  ...(enabled === undefined ? {} : { enabled }),
  edge: { a: src(a), b: src(b) },
});

/** Hand-built applicator baseline: ids p0..pn, all-FREE unless kinds given. */
const meshOf = (
  coords: Array<[number, number, number?]>,
  triangles: Array<[number, number, number]>,
  kinds?: TinEdgeKinds[],
): CadSurfaceEditBaseline => {
  const points: CadSurfaceEditMeshPoint[] = coords.map(([x, y, z], i) => ({
    id: `p${i}`,
    x,
    y,
    z: z ?? 0,
  }));
  return {
    points,
    triangles,
    edgeKinds:
      kinds ??
      triangles.map((): TinEdgeKinds => [TIN_EDGE_FREE, TIN_EDGE_FREE, TIN_EDGE_FREE]),
    constrainedKindMap: new Map(),
  };
};

const adjOf = (triangles: ReadonlyArray<readonly [number, number, number]>): Map<string, number[]> => {
  const map = new Map<string, number[]>();
  triangles.forEach((tri, i) => {
    for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const key = `${Math.min(u, v)}>${Math.max(u, v)}`;
      map.set(key, [...(map.get(key) ?? []), i]);
    }
  });
  return map;
};

const interiorEdgeOf = (triangles: ReadonlyArray<readonly [number, number, number]>): [number, number] => {
  for (const [key, list] of adjOf(triangles)) {
    if (list.length === 2) {
      const [a, b] = key.split('>').map(Number) as [number, number];
      return [a, b];
    }
  }
  throw new Error('no interior edge');
};

const boundaryEdgeOf = (triangles: ReadonlyArray<readonly [number, number, number]>): [number, number] => {
  for (const [key, list] of adjOf(triangles)) {
    if (list.length === 1) {
      const [a, b] = key.split('>').map(Number) as [number, number];
      return [a, b];
    }
  }
  throw new Error('no boundary edge');
};

const edgeKindOfBuild = (
  build: ReturnType<typeof buildCadSurface>,
  a: number,
  b: number,
): number => {
  for (let i = 0; i < build.triangles.length; i += 1) {
    const tri = build.triangles[i];
    const edges = [[tri[1], tri[2]], [tri[2], tri[0]], [tri[0], tri[1]]] as const;
    for (let k = 0; k < 3; k += 1) {
      const [u, v] = edges[k];
      if ((u === a && v === b) || (u === b && v === a)) return build.edgeKinds[i][k];
    }
  }
  throw new Error(`edge ${a}>${b} not found`);
};

const ccwAll = (points: ReadonlyArray<{ x: number; y: number }>, triangles: ReadonlyArray<readonly [number, number, number]>): boolean =>
  triangles.every(([a, b, c]) => orient2d(points[a].x, points[a].y, points[b].x, points[b].y, points[c].x, points[c].y) < 0);

/** Entity-id triangle sets (order-free) for topology comparison across rebuilds. */
const entityTriSet = (build: ReturnType<typeof buildCadSurface>): string[] =>
  build.triangles
    .map((tri) => tri.map((i) => build.points[i].entityId).sort().join('+'))
    .sort();

const planArea = (points: ReadonlyArray<{ x: number; y: number }>, triangles: ReadonlyArray<readonly [number, number, number]>): number => {
  let area = 0;
  for (const [a, b, c] of triangles) {
    area += Math.abs((points[b].x - points[a].x) * (points[c].y - points[a].y) - (points[c].x - points[a].x) * (points[b].y - points[a].y)) / 2;
  }
  return area;
};

const expectFailure = (fn: () => void, reason: string): CadSurfaceEditFailure => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(CadSurfaceEditFailure);
    expect((error as CadSurfaceEditFailure).reason).toBe(reason);
    return error as CadSurfaceEditFailure;
  }
  throw new Error(`expected ${reason}`);
};

// ---------------------------------------------------------------------------
// Swap oracles
// ---------------------------------------------------------------------------

describe('18S swap-edge', () => {
  it('saddle swap with non-coplanar Z changes the elevation probe', () => {
    const entities = [pt('A', 0, 0, 5), pt('B', 10, 0, 0), pt('C', 10, 10, 5), pt('D', 0, 10, 0)];
    const ids = entities.map((e) => e.id);
    const surface = surfaceOf(ids);
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    expect(base.triangles).toHaveLength(2);
    const [a, b] = interiorEdgeOf(base.triangles);
    expect(edgeKindOfBuild(base, a, b)).toBe(TIN_EDGE_FREE);
    const ea = base.points[a].entityId;
    const eb = base.points[b].entityId;
    surface.definition.edits = [swapOf('e-swap', ea, eb)];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.triangles).toHaveLength(2);
    expect(ccwAll(edited.points, edited.triangles)).toBe(true);
    // Diagonal changed: baseline edge gone, opposite diagonal present.
    const before = new Set(adjOf(base.triangles).keys());
    const after = new Set(adjOf(edited.triangles).keys());
    expect(after.has(`${Math.min(a, b)}>${Math.max(a, b)}`)).toBe(false);
    expect([...after].some((k) => !before.has(k))).toBe(true);
    // Non-coplanar Z: the two diagonals interpolate the center differently.
    const z0 = getSurfaceElevationAt(base, 5, 5);
    const z1 = getSurfaceElevationAt(edited, 5, 5);
    expect(z0).not.toBeNull();
    expect(z1).not.toBeNull();
    expect(Math.abs(z1! - z0!)).toBeGreaterThan(1);
  });

  it('non-convex swap fails closed NOT_APPLICABLE', () => {
    const baseline = meshOf([[0, 0], [10, 0], [2, 1], [0, 10]], [[0, 1, 2], [0, 2, 3]]);
    const err = expectFailure(
      () => applyCadSurfaceEdits(baseline, [{ id: 'e', kind: 'swap-edge', edge: { a: { key: 'source:p0' }, b: { key: 'source:p2' } } }]),
      'SURFACE_EDIT_NOT_APPLICABLE',
    );
    expect(err.status).toBe('not-applicable');
  });

  it('boundary-edge swap fails closed NOT_APPLICABLE', () => {
    const baseline = meshOf([[0, 0], [10, 0], [2, 1], [0, 10]], [[0, 1, 2], [0, 2, 3]]);
    expectFailure(
      () => applyCadSurfaceEdits(baseline, [{ id: 'e', kind: 'swap-edge', edge: { a: { key: 'source:p0' }, b: { key: 'source:p1' } } }]),
      'SURFACE_EDIT_NOT_APPLICABLE',
    );
  });

  it('swap of a constrained edge is BLOCKED_CONSTRAINT', () => {
    const kinds: TinEdgeKinds[] = [[1, 0, 0], [0, 0, 1]];
    const baseline: CadSurfaceEditBaseline = {
      ...meshOf([[0, 0], [10, 0], [10, 10], [0, 10]], [[0, 1, 2], [0, 2, 3]], kinds),
      constrainedKindMap: new Map([['0>2', 1]]),
    };
    const err = expectFailure(
      () => applyCadSurfaceEdits(baseline, [{ id: 'e', kind: 'swap-edge', edge: { a: { key: 'source:p0' }, b: { key: 'source:p2' } } }]),
      'SURFACE_EDIT_BLOCKED_CONSTRAINT',
    );
    expect(err.status).toBe('blocked-constraint');
  });

  it('non-convex quad after a source-point move fails NOT_APPLICABLE', () => {
    const edit: CadSurfaceEdit = { id: 'e', kind: 'swap-edge', edge: { a: { key: 'source:p0' }, b: { key: 'source:p2' } } };
    const convex = meshOf([[0, 0], [10, 0], [10, 10], [0, 10]], [[0, 1, 2], [0, 2, 3]]);
    expect(applyCadSurfaceEdits(convex, [edit]).results[0].status).toBe('applied');
    const moved = meshOf([[0, 0], [10, 0], [2, 1], [0, 10]], [[0, 1, 2], [0, 2, 3]]);
    expectFailure(() => applyCadSurfaceEdits(moved, [edit]), 'SURFACE_EDIT_NOT_APPLICABLE');
  });
});

// ---------------------------------------------------------------------------
// Add-line oracles
// ---------------------------------------------------------------------------

describe('18S add-line', () => {
  // Square + spur: segment p0->p4 crosses only FREE edges (1>2), cavity of 2 tris.
  const spur = (): CadSurfaceEditBaseline =>
    meshOf([[0, 0], [10, 0], [10, 10], [0, 10], [20, 5]], [[0, 1, 2], [0, 2, 3], [1, 4, 2]]);

  it('forces the edge: exists, no triangle crossed, CCW, domain/vertex-set unchanged', () => {
    const baseline = spur();
    const out = applyCadSurfaceEdits(baseline, [{ id: 'e', kind: 'add-line', from: { key: 'source:p0' }, to: { key: 'source:p4' } }]);
    expect(out.results).toEqual([{ editId: 'e', status: 'applied' }]);
    expect(out.triangles).toHaveLength(3);
    const edges = adjOf(out.triangles);
    expect((edges.get('0>4') ?? []).length).toBe(2);
    expect(ccwAll(baseline.points, out.triangles)).toBe(true);
    // The forced segment must not properly cross any result edge except at endpoints.
    const straddle = (o1: number, o2: number): boolean => o1 !== 0 && o2 !== 0 && (o1 > 0) !== (o2 > 0);
    const P = (i: number): [number, number] => [baseline.points[i].x, baseline.points[i].y];
    const [fx, fy] = P(0);
    const [tx, ty] = P(4);
    for (const tri of out.triangles) {
      for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
        if (u === 0 || v === 0 || u === 4 || v === 4) continue;
        const [ux, uy] = P(u);
        const [vx, vy] = P(v);
        const cross =
          straddle(
            orient2d(fx, fy, tx, ty, ux, uy),
            orient2d(fx, fy, tx, ty, vx, vy),
          ) &&
          straddle(orient2d(ux, uy, vx, vy, fx, fy), orient2d(ux, uy, vx, vy, tx, ty));
        expect(cross).toBe(false);
      }
    }
    // Domain preserved, vertex set untouched (same count, same coords).
    expect(planArea(baseline.points, out.triangles)).toBeCloseTo(planArea(baseline.points, baseline.triangles), 9);
    expect(baseline.points).toHaveLength(5);
  });

  it('crossing a breakline is BLOCKED_CONSTRAINT', () => {
    const baseline: CadSurfaceEditBaseline = {
      ...spur(),
      edgeKinds: [
        [1, 0, 0],
        [0, 0, 0],
        [0, 1, 0],
      ],
      constrainedKindMap: new Map([['1>2', 1]]),
    };
    const err = expectFailure(
      () => applyCadSurfaceEdits(baseline, [{ id: 'e', kind: 'add-line', from: { key: 'source:p0' }, to: { key: 'source:p4' } }]),
      'SURFACE_EDIT_BLOCKED_CONSTRAINT',
    );
    expect(err.status).toBe('blocked-constraint');
  });

  it('intermediate collinear vertex fails INTERMEDIATE_VERTEX', () => {
    const baseline = meshOf([[0, 0], [10, 0], [20, 0], [10, 10]], [[0, 1, 3], [1, 2, 3]]);
    const err = expectFailure(
      () => applyCadSurfaceEdits(baseline, [{ id: 'e', kind: 'add-line', from: { key: 'source:p0' }, to: { key: 'source:p2' } }]),
      'SURFACE_EDIT_INTERMEDIATE_VERTEX',
    );
    expect(err.status).toBe('not-applicable');
  });

  it('already-sharing edge fails NOT_APPLICABLE', () => {
    expectFailure(
      () => applyCadSurfaceEdits(spur(), [{ id: 'e', kind: 'add-line', from: { key: 'source:p0' }, to: { key: 'source:p1' } }]),
      'SURFACE_EDIT_NOT_APPLICABLE',
    );
  });
});

// ---------------------------------------------------------------------------
// Delete-line oracles
// ---------------------------------------------------------------------------

describe('18S delete-line', () => {
  const quadEntities = () => [pt('A', 0, 0, 0), pt('B', 10, 0, 0), pt('C', 10, 10, 0), pt('D', 0, 10, 0)];

  it('boundary delete retreats the exterior: triangle absent, area decreases, probe null, no insertion', () => {
    const entities = quadEntities();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    const [a, b] = boundaryEdgeOf(base.triangles);
    surface.definition.edits = [delOf('e-del', base.points[a].entityId, base.points[b].entityId)];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.triangles).toHaveLength(base.triangles.length - 1);
    // Remaining triangle matches a baseline triangle exactly (no insertion).
    const baseSet = new Set(base.triangles.map((t) => t.join(',')));
    for (const tri of edited.triangles) expect(baseSet.has(tri.join(','))).toBe(true);
    // Deleted edge fully gone; plan area decreased.
    expect(adjOf(edited.triangles).has(`${Math.min(a, b)}>${Math.max(a, b)}`)).toBe(false);
    expect(edited.stats.planimetricArea).toBeLessThan(base.stats.planimetricArea);
    // Probe at the removed triangle centroid is null (hole/exterior).
    const removed = base.triangles.find((t) => !edited.triangles.some((e) => e.join(',') === t.join(',')))!;
    const cx = (base.points[removed[0]].x + base.points[removed[1]].x + base.points[removed[2]].x) / 3;
    const cy = (base.points[removed[0]].y + base.points[removed[1]].y + base.points[removed[2]].y) / 3;
    expect(getSurfaceElevationAt(edited, cx, cy)).toBeNull();
  });

  it('interior delete removes both triangles (hole probe null, area reduced)', () => {
    const entities = quadEntities();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    const [a, b] = interiorEdgeOf(base.triangles);
    surface.definition.edits = [delOf('e-del', base.points[a].entityId, base.points[b].entityId)];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.triangles).toHaveLength(0);
    expect(edited.stats.planimetricArea).toBe(0);
    expect(getSurfaceElevationAt(edited, 5, 5)).toBeNull();
  });

  it('sequential deletes grow the hole; duplicate delete fails closed', () => {
    const baseline = meshOf(
      [[0, 0], [10, 0], [20, 0], [0, 10], [10, 10], [20, 10]],
      [[0, 1, 4], [0, 4, 3], [1, 2, 5], [1, 5, 4]],
    );
    const del = (id: string, a: number, b: number): CadSurfaceEdit => ({
      id,
      kind: 'delete-line',
      edge: { a: { key: `source:p${a}` }, b: { key: `source:p${b}` } },
    });
    const out = applyCadSurfaceEdits(baseline, [del('d1', 1, 4), del('d2', 0, 4)]);
    expect(out.results).toEqual([
      { editId: 'd1', status: 'applied' },
      { editId: 'd2', status: 'applied' },
    ]);
    expect(out.triangles).toHaveLength(1);
    expectFailure(
      () => applyCadSurfaceEdits(baseline, [del('d1', 1, 4), del('d1b', 1, 4)]),
      'SURFACE_EDIT_NOT_APPLICABLE',
    );
  });

  it('delete of a constrained edge is BLOCKED_CONSTRAINT', () => {
    const baseline: CadSurfaceEditBaseline = {
      ...meshOf([[0, 0], [10, 0], [10, 10], [0, 10]], [[0, 1, 2], [0, 2, 3]], [[1, 0, 0], [0, 0, 1]]),
      constrainedKindMap: new Map([['0>2', 1]]),
    };
    expectFailure(
      () => applyCadSurfaceEdits(baseline, [{ id: 'e', kind: 'delete-line', edge: { a: { key: 'source:p0' }, b: { key: 'source:p2' } } }]),
      'SURFACE_EDIT_BLOCKED_CONSTRAINT',
    );
  });

  it('edit order matters: swap-then-delete succeeds while delete-then-swap is invalid', () => {
    const baseline = meshOf([[0, 0], [10, 0], [10, 10], [0, 10]], [[0, 1, 2], [0, 2, 3]]);
    const swap: CadSurfaceEdit = { id: 's', kind: 'swap-edge', edge: { a: { key: 'source:p0' }, b: { key: 'source:p2' } } };
    const del: CadSurfaceEdit = { id: 'd', kind: 'delete-line', edge: { a: { key: 'source:p1' }, b: { key: 'source:p3' } } };
    const swapFirst = applyCadSurfaceEdits(baseline, [swap, del]);
    expect(swapFirst.triangles).toHaveLength(0);
    expect(swapFirst.results.map((r) => r.status)).toEqual(['applied', 'applied']);
    // Reverse: deleting (0,2) first empties the mesh, so the trailing swap
    // targets a vanished edge and fails closed.
    const err = expectFailure(
      () =>
        applyCadSurfaceEdits(baseline, [
          { id: 'd', kind: 'delete-line', edge: { a: { key: 'source:p0' }, b: { key: 'source:p2' } } },
          { id: 's', kind: 'swap-edge', edge: { a: { key: 'source:p0' }, b: { key: 'source:p2' } } },
        ]),
      'SURFACE_EDIT_EDGE_MISSING',
    );
    expect(err.editIndex).toBe(1);
    expect(swapFirst.results.map((r) => r.editId)).toEqual(['s', 'd']);
  });
});

// ---------------------------------------------------------------------------
// Replay, revision, determinism, parity
// ---------------------------------------------------------------------------

describe('18S replay + revision + parity', () => {
  const saddle = () => {
    // Non-cocircular XY (C pulled to x=9): the Delaunay diagonal is stable
    // under similarity transforms (no cocircular tie-break flip).
    const entities = [pt('A', 0, 0, 5), pt('B', 10, 0, 0), pt('C', 9, 10, 5), pt('D', 0, 10, 0)];
    const surface = surfaceOf(entities.map((e) => e.id));
    return { entities, surface, project: projectOf(entities, [surface]) };
  };

  const saddleSwap = (surface: CadSurface, project: CadProject): CadSurfaceEdit => {
    const base = buildCadSurface(project, surface);
    const [a, b] = interiorEdgeOf(base.triangles);
    return swapOf('e-swap', base.points[a].entityId, base.points[b].entityId);
  };

  it('source-point move replays the same logical topology', () => {
    const { entities, surface, project } = saddle();
    surface.definition.edits = [saddleSwap(surface, project)];
    const before = buildCadSurface(project, surface);
    expect(before.outcome).toBe('ok');
    const moved = entities.map((e) => (e.stationId === 'D' ? { ...e, z: 2 } : e));
    const after = buildCadSurface(projectOf(moved, [surface]), surface);
    expect(after.outcome).toBe('ok');
    expect(entityTriSet(after)).toEqual(entityTriSet(before));
  });

  it('missing vertex fails closed with edit diagnostic', () => {
    const { surface, project } = saddle();
    surface.definition.edits = [swapOf('e-ghost', 'pt:missing', 'pt:A')];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.reasonCodes).toContain('SURFACE_TRIANGULATION_FAILED');
    expect(blocked.editFailure).toEqual({ editId: 'e-ghost', reason: 'SURFACE_EDIT_VERTEX_MISSING' });
    const err = expectFailure(
      () =>
        applyCadSurfaceEdits(
          meshOf([[0, 0], [10, 0], [10, 10]], [[0, 1, 2]]),
          [swapOf('e-ghost', 'nope', 'p0')],
        ),
      'SURFACE_EDIT_VERTEX_MISSING',
    );
    expect(err.status).toBe('broken-reference');
  });

  it('synthetic vertices are not addressable', () => {
    const { surface, project } = saddle();
    surface.definition.edits = [swapOf('e-synth', `boundary:${surface.id}:0`, 'pt:A')];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure?.reason).toBe('SURFACE_EDIT_SYNTHETIC_VERTEX');
    for (const key of ['boundary:s:x:0', 'steiner:s:x:1']) {
      expectFailure(
        () =>
          applyCadSurfaceEdits(meshOf([[0, 0], [10, 0], [10, 10]], [[0, 1, 2]]), [
            { id: 'e', kind: 'swap-edge', edge: { a: { key }, b: { key: 'source:p0' } } },
          ]),
        'SURFACE_EDIT_SYNTHETIC_VERTEX',
      );
    }
  });

  it('disabled broken edits never block', () => {
    const { surface, project } = saddle();
    surface.definition.edits = [swapOf('e-off', 'pt:missing', 'pt:A', false)];
    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
    expect(built.triangles).toHaveLength(2);
    const out = applyCadSurfaceEdits(meshOf([[0, 0], [10, 0], [10, 10]], [[0, 1, 2]]), [
      swapOf('e-off', 'nope', 'p0', false),
    ]);
    expect(out.results).toEqual([{ editId: 'e-off', status: 'disabled' }]);
  });

  it('add/delete/enable/reorder change srev1', () => {
    const { surface, project } = saddle();
    const swap = saddleSwap(surface, project);
    const r0 = computeCadSurfaceSourceRevision(project, surface);
    surface.definition.edits = [swap];
    const r1 = computeCadSurfaceSourceRevision(project, surface);
    expect(r1).not.toBe(r0);
    surface.definition.edits = [{ ...swap, enabled: false }];
    const r2 = computeCadSurfaceSourceRevision(project, surface);
    expect(r2).not.toBe(r1);
    const second = delOf('e2', 'pt:A', 'pt:B', false);
    surface.definition.edits = [swap, second];
    const r3 = computeCadSurfaceSourceRevision(project, surface);
    surface.definition.edits = [second, swap];
    const r4 = computeCadSurfaceSourceRevision(project, surface);
    expect(r3).not.toBe(r1);
    expect(r4).not.toBe(r3);
    surface.definition.edits = undefined;
    expect(computeCadSurfaceSourceRevision(project, surface)).toBe(r0);
  });

  it('input shuffle is equivalent under edits', () => {
    const first = saddle();
    first.surface.definition.edits = [saddleSwap(first.surface, first.project)];
    const builtFirst = buildCadSurface(first.project, first.surface);
    const entities = [...first.entities].reverse();
    const surface = surfaceOf(first.entities.map((e) => e.id));
    surface.definition.edits = first.surface.definition.edits;
    const built = buildCadSurface(projectOf(entities, [surface]), surface);
    expect(built.outcome).toBe('ok');
    expect(built.triangles).toEqual(builtFirst.triangles);
    expect(built.edgeKinds).toEqual(builtFirst.edgeKinds);
  });

  it('large-coordinate parity under edits', () => {
    const first = saddle();
    first.surface.definition.edits = [saddleSwap(first.surface, first.project)];
    const before = buildCadSurface(first.project, first.surface);
    const DX = 2e6;
    const DY = 7e6;
    const entities = first.entities.map((e) => ({ ...e, x: e.x + DX, y: e.y + DY }));
    const surface = surfaceOf(first.entities.map((e) => e.id));
    surface.definition.edits = first.surface.definition.edits;
    const after = buildCadSurface(projectOf(entities, [surface]), surface);
    expect(after.outcome).toBe('ok');
    expect(entityTriSet(after)).toEqual(entityTriSet(before));
    expect(getSurfaceElevationAt(after, 5 + DX, 5 + DY)).toBeCloseTo(getSurfaceElevationAt(before, 5, 5)!, 6);
  });

  it('worker/sync parity: identical replay through the single chokepoint', () => {
    const { surface, project } = saddle();
    surface.definition.edits = [saddleSwap(surface, project)];
    const direct = buildCadSurface(project, surface);
    expect(direct.outcome).toBe('ok');
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const request = buildSurfaceBuildRequest(project, surface.id, revision)!;
    expect(request).not.toBeNull();
    expect(request.definition.edits).toEqual(surface.definition.edits);
    const viaWorker = buildSurfaceMeshFromRequest(request);
    expect(viaWorker.triangles).toEqual(direct.triangles);
    expect(viaWorker.points).toHaveLength(direct.points.length);
    expect(viaWorker.stats.triangleCount).toBe(direct.stats.triangleCount);
    // Same replay function backs both paths (no edits ⇒ baseline passthrough).
    const passthrough = replaySurfaceEdits(undefined, {
      points: direct.points,
      triangles: direct.triangles,
      adjacency: direct.adjacency,
      edgeKinds: direct.edgeKinds,
      constrained: new Map(),
    });
    expect('failure' in passthrough).toBe(false);
  });

  it('similarity PROJECTTRANSFORM preserves edits verbatim + same logical topology', () => {
    const { surface, project } = saddle();
    surface.definition.edits = [saddleSwap(surface, project)];
    const before = buildCadSurface(project, surface);
    const result = applyCadProjectCoordinateTransform(
      project,
      { a: 0, b: -2, c: 2, d: 0, tx: 100, ty: 50 },
      { mode: '18S-test' },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('transform failed');
    const moved = result.project.surfaces!.find((s) => s.id === surface.id)!;
    expect(moved.definition.edits).toEqual(surface.definition.edits);
    const after = buildCadSurface(result.project, moved);
    expect(after.outcome).toBe('ok');
    expect(entityTriSet(after)).toEqual(entityTriSet(before));
  });

  it('clone deep-copies edits; legacy backfill stays undefined', () => {
    const { surface } = saddle();
    surface.definition.edits = [swapOf('e1', 'pt:A', 'pt:B')];
    const cloned = cloneCadSurfaceDefinition(surface.definition);
    expect(cloned.edits).toEqual(surface.definition.edits);
    (surface.definition.edits![0] as { id: string }).id = 'mutated';
    expect(cloned.edits![0].id).toBe('e1');
    const legacy = cloneCadSurfaceDefinition({ pointSource: { kind: 'points', pointEntityIds: [] } });
    expect(legacy.edits).toBeUndefined();
  });

  it('imported TIN replays edits with imported refs + revision coverage', () => {
    const payload = {
      vertices: [0, 0, 0, 10, 0, 0, 10, 10, 0, 0, 10, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { format: 'LandXML' as const, fileName: 't.xml', surfaceName: 's' },
    };
    const surface: CadSurface = {
      id: 's18s-imp',
      name: 'imported',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: payload,
      },
    };
    const project = projectOf([], [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    expect(base.triangles).toHaveLength(2);
    const r0 = computeCadSurfaceSourceRevision(project, surface);
    const swap: CadSurfaceEdit = {
      id: 'e-imp',
      kind: 'swap-edge',
      edge: { a: { key: 'imported:s18s-imp:0' }, b: { key: 'imported:s18s-imp:2' } },
    };
    surface.definition.edits = [swap];
    const r1 = computeCadSurfaceSourceRevision(project, surface);
    expect(r1).not.toBe(r0);
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.triangles).toHaveLength(2);
    expect(new Set(adjOf(edited.triangles).keys()).has('0>2')).toBe(false);
    expect(ccwAll(edited.points, edited.triangles)).toBe(true);
  });
});
