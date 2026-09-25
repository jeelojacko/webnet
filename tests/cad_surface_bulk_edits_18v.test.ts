import { describe, expect, it } from 'vitest';
import type {
  CadEntity,
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { refreshEditEdges, type EditMeshState } from '../src/engine/cad/cadSurfaceEditMesh';
import { inspectSurfaceEditDependencies } from '../src/engine/cad/cadSurfaceEditDeps';
import { properlyCrosses } from '../src/engine/cad/cadSurfaceEditPointModify';
import { ensureEditEdgeSpatialIndex } from '../src/engine/cad/cadEditEdgeSpatialIndex';
import { tinEdgeKey } from '../src/engine/cad/tin/tinTopology';
import { TIN_EDGE_FREE } from '../src/engine/cad/tin/tinTypes';
import { transformCadSurfaceEdits } from '../src/engine/cad/cadSurfaceEditTransform';
import { rotationAbout } from '../src/engine/cad/cadTransform2D';

// ---------------------------------------------------------------------------
// Fixtures (mirrors tests/cad_surface_point_edits_18t.test.ts style)
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
    id: 'proj-18v',
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
    id: `s18v-${seq}`,
    name: 'test surface',
    definition: { pointSource: { kind: 'points', pointEntityIds }, ...overrides },
  };
};

const ringOf = (id: string, coords: Array<[number, number]>): CadEntity =>
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

type Build = ReturnType<typeof buildCadSurface>;

const gridEntities = (n: number, zOf: (_x: number, _y: number) => number): CadSurveyPointEntity[] => {
  const out: CadSurveyPointEntity[] = [];
  for (let x = 0; x < n; x += 1) {
    for (let y = 0; y < n; y += 1) {
      out.push(pt(`${x}-${y}`, x, y, zOf(x, y)));
    }
  }
  return out;
};

const refOf = (id: string): { key: string } => ({ key: `source:${id}` });

const byEntityId = (build: Build, id: string): { x: number; y: number; z: number } => {
  const found = build.points.find((p) => p.entityId === id);
  if (!found) throw new Error(`missing point ${id}`);
  return found;
};

/** Thin two-row strip + fat outer ring: between-row triangles are thin (0.12), ring triangles fat. */
const thinStripEntities = (): CadSurveyPointEntity[] => {
  const entities: CadSurveyPointEntity[] = [];
  for (let x = 0; x <= 6; x += 1) {
    entities.push(pt(`B${x}`, x, 0, 0));
    entities.push(pt(`T${x}`, x, 0.12, 0));
  }
  for (const [id, x, y] of [['W1', -4, -4], ['W2', -4, 4], ['W3', 10, -4], ['W4', 10, 4], ['W5', 3, -5], ['W6', 3, 5]] as const) {
    entities.push(pt(id, x, y, 0));
  }
  return entities;
};

// ---------------------------------------------------------------------------
// set-elevation-many + raise-lower-points oracles
// ---------------------------------------------------------------------------

describe('18V set-elevation-many', () => {
  it('sets exact Z on listed refs; others bit-identical, topology unchanged', () => {
    const entities = gridEntities(5, () => 5);
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    const picked = ['pt:1-1', 'pt:2-3', 'pt:3-2'];
    surface.definition.edits = [
      { id: 'e-setmany', kind: 'set-elevation-many', vertices: picked.map(refOf), z: 42 },
    ];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    if (edited.outcome !== 'ok' || base.outcome !== 'ok') throw new Error('build failed');
    expect(edited.triangles).toEqual(base.triangles);
    for (const p of edited.points) {
      const b = base.points.find((q) => q.entityId === p.entityId) as { x: number; y: number; z: number };
      expect(p.x).toBe(b.x);
      expect(p.y).toBe(b.y);
      expect(p.z).toBe(picked.includes(p.entityId) ? 42 : b.z);
    }
    // Source entities untouched (surface-only override).
    expect(project.entities.find((e) => e.id === 'pt:1-1')).toMatchObject({ z: 5 });
  });

  it('raise-lower-points touches listed refs only; reorder-vs-set pins ordered semantics', () => {
    const entities = gridEntities(5, () => 0);
    const ids = entities.map((e) => e.id);
    const mk = (): { project: CadProject; surface: CadSurface } => {
      const surface = surfaceOf(ids);
      return { project: projectOf(entities, [surface]), surface };
    };
    const run = (edits: CadSurface['definition']['edits']): Build => {
      const { project, surface } = mk();
      surface.definition.edits = edits;
      return buildCadSurface(project, surface);
    };
    // Raise {A,B} by +5, then set A=100: A=100, B=5.
    const first = run([
      { id: 'r1', kind: 'raise-lower-points', vertices: [refOf('pt:1-1'), refOf('pt:2-2')], deltaZ: 5 },
      { id: 's1', kind: 'set-elevation', vertex: refOf('pt:1-1'), z: 100 },
    ]);
    expect(first.outcome).toBe('ok');
    if (first.outcome !== 'ok') throw new Error('build failed');
    expect(byEntityId(first, 'pt:1-1').z).toBe(100);
    expect(byEntityId(first, 'pt:2-2').z).toBe(5);
    expect(byEntityId(first, 'pt:3-3').z).toBe(0);
    // Reversed: set A=100 first, then raise {A,B} by +5: A=105, B=5.
    const second = run([
      { id: 's1', kind: 'set-elevation', vertex: refOf('pt:1-1'), z: 100 },
      { id: 'r1', kind: 'raise-lower-points', vertices: [refOf('pt:1-1'), refOf('pt:2-2')], deltaZ: 5 },
    ]);
    expect(second.outcome).toBe('ok');
    if (second.outcome !== 'ok') throw new Error('build failed');
    expect(byEntityId(second, 'pt:1-1').z).toBe(105);
    expect(byEntityId(second, 'pt:2-2').z).toBe(5);
    // Raise-selected pins against set-many: raise {A,B}+5 ≡ set-many {A,B} to z+5.
    const raised = run([
      { id: 'r1', kind: 'raise-lower-points', vertices: [refOf('pt:1-1'), refOf('pt:2-2')], deltaZ: 7 },
    ]);
    const set = run([
      { id: 'm1', kind: 'set-elevation-many', vertices: [refOf('pt:1-1'), refOf('pt:2-2')], z: 7 },
    ]);
    expect(raised.outcome).toBe('ok');
    expect(set.outcome).toBe('ok');
    if (raised.outcome !== 'ok' || set.outcome !== 'ok') throw new Error('build failed');
    expect(raised.points).toEqual(set.points);
  });
});

// ---------------------------------------------------------------------------
// move-points oracles
// ---------------------------------------------------------------------------

describe('18V move-points', () => {
  it('rigid patch: identical XY shift, Z unchanged, selected-selected lengths unchanged, rest bit-identical', () => {
    const entities = gridEntities(6, (x, y) => x + y);
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    if (base.outcome !== 'ok') throw new Error('base build failed');
    const block = ['pt:2-2', 'pt:3-2', 'pt:2-3', 'pt:3-3'];
    const [dx, dy] = [0.3, 0.1];
    surface.definition.edits = [{ id: 'e-mv', kind: 'move-points', vertices: block.map(refOf), deltaX: dx, deltaY: dy }];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    if (edited.outcome !== 'ok') throw new Error('edited build failed');
    expect(edited.triangles).toEqual(base.triangles);
    const dist = (
      build: Build,
      a: string,
      b: string,
    ): number => {
      const pa = byEntityId(build, a);
      const pb = byEntityId(build, b);
      return Math.hypot(pa.x - pb.x, pa.y - pb.y);
    };
    for (const id of block) {
      const b = byEntityId(base, id);
      const a = byEntityId(edited, id);
      expect(a.x).toBe(b.x + dx);
      expect(a.y).toBe(b.y + dy);
      expect(a.z).toBe(b.z);
    }
    for (let i = 0; i < block.length; i += 1) {
      for (let j = i + 1; j < block.length; j += 1) {
        expect(dist(edited, block[i], block[j])).toBe(dist(base, block[i], block[j]));
      }
    }
    for (const p of edited.points) {
      if (block.includes(p.entityId)) continue;
      expect(p).toEqual(base.points.find((q) => q.entityId === p.entityId));
    }
  });

  it('simultaneous beats sequential: patch valid rigidly that per-vertex applyMovePoint rejects', () => {
    const entities = thinStripEntities();
    const ids = entities.map((e) => e.id);
    const block = ids.filter((id) => /^(pt:B|pt:T)/.test(id));
    const [dx, dy] = [0, 0.2];
    // Sequential: absolute targets from ORIGINAL positions, one edit per vertex.
    const seqSurface = surfaceOf(ids);
    seqSurface.definition.edits = block.map((id, i) => {
      const e = entities.find((v) => v.id === id) as CadSurveyPointEntity;
      return { id: `q${i}`, kind: 'move-point' as const, vertex: refOf(id), x: e.x + dx, y: e.y + dy };
    });
    const seqOut = buildCadSurface(projectOf(entities, [seqSurface]), seqSurface);
    expect(seqOut.outcome).toBe('blocked');
    expect(seqOut.editFailure?.reason).toBe('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    // Simultaneous: the same rigid translation validates on the proposed final state.
    const bulkSurface = surfaceOf(ids);
    bulkSurface.definition.edits = [
      { id: 'bulk', kind: 'move-points', vertices: block.map(refOf), deltaX: dx, deltaY: dy },
    ];
    const bulkOut = buildCadSurface(projectOf(entities, [bulkSurface]), bulkSurface);
    expect(bulkOut.outcome).toBe('ok');
    if (bulkOut.outcome !== 'ok') throw new Error('bulk build failed');
    for (const id of block) {
      const e = entities.find((v) => v.id === id) as CadSurveyPointEntity;
      expect(byEntityId(bulkOut, id)).toMatchObject({ x: e.x + dx, y: e.y + dy, z: 0 });
    }
  });

  it('leap over other triangles blocks with state bit-identical', () => {
    const entities = gridEntities(6, () => 0);
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    surface.definition.edits = [
      { id: 'e-leap', kind: 'move-points', vertices: [refOf('pt:2-2')], deltaX: 2.3, deltaY: 0.7 },
    ];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure?.editId).toBe('e-leap');
    expect(blocked.editFailure?.reason).toBe('SURFACE_EDIT_MOVE_POINT_INVALID_STAR');
    // Fail-closed: clearing the edit rebuilds the base mesh bit-identically.
    surface.definition.edits = undefined;
    const clean = buildCadSurface(project, surface);
    expect(clean.outcome).toBe('ok');
    if (clean.outcome !== 'ok' || base.outcome !== 'ok') throw new Error('build failed');
    expect(clean.points).toEqual(base.points);
    expect(clean.triangles).toEqual(base.triangles);
  });

  it('coincident final with an unselected vertex blocks with the same halt reason', () => {
    const entities = gridEntities(6, () => 0);
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    // (2,2) translated by exactly one cell lands bit-exactly on (3,2).
    surface.definition.edits = [
      { id: 'e-coin', kind: 'move-points', vertices: [refOf('pt:2-2')], deltaX: 1, deltaY: 0 },
    ];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-coin', reason: 'SURFACE_EDIT_MOVE_POINT_INVALID_STAR' });
    surface.definition.edits = undefined;
    const clean = buildCadSurface(project, surface);
    expect(clean.outcome).toBe('ok');
    if (clean.outcome !== 'ok' || base.outcome !== 'ok') throw new Error('build failed');
    expect(clean.points).toEqual(base.points);
  });

  it('breakline/boundary members block the entire op (all-or-nothing)', () => {
    // Breakline member: whole op blocks CONSTRAINED even with a free vertex listed.
    const grid = gridEntities(5, (x) => (x === 2 ? 10 : x));
    const ridgeIds = [0, 1, 2, 3, 4].map((y) => `pt:2-${y}`);
    const blSurface = surfaceOf(grid.map((e) => e.id), {
      breaklines: [{ id: 'bl1', source: { kind: 'point-chain', pointEntityIds: ridgeIds }, type: 'standard' }],
    });
    const blProject = projectOf(grid, [blSurface]);
    expect(buildCadSurface(blProject, blSurface).outcome).toBe('ok');
    // pt:2-2 sits mid-ridge (constrained incidence) and strictly interior (non-boundary).
    // (Listed alongside interior/free pt:1-1; canonical order still gates the ridge vertex.)
    blSurface.definition.edits = [
      { id: 'e-cx', kind: 'move-points', vertices: [refOf('pt:2-2'), refOf('pt:1-1')], deltaX: 0.1, deltaY: 0.1 },
    ];
    const blBlocked = buildCadSurface(blProject, blSurface);
    expect(blBlocked.outcome).toBe('blocked');
    expect(blBlocked.editFailure).toEqual({ editId: 'e-cx', reason: 'SURFACE_EDIT_MOVE_POINT_CONSTRAINED' });
    blSurface.definition.edits = undefined;
    expect(buildCadSurface(blProject, blSurface).outcome).toBe('ok');

    // Boundary member (vertex on the outer ring edge): whole op blocks BOUNDARY.
    const flat = gridEntities(7, () => 7);
    const bSurface = surfaceOf(flat.map((e) => e.id), {
      boundaries: [{ type: 'outer', sourceEntityId: 'outer1' }],
    });
    const bProject = projectOf(
      [...flat, ringOf('outer1', [[1, 1], [5, 1], [5, 5], [1, 5]])],
      [bSurface],
    );
    expect(buildCadSurface(bProject, bSurface).outcome).toBe('ok');
    bSurface.definition.edits = [
      { id: 'e-bx', kind: 'move-points', vertices: [refOf('pt:3-1'), refOf('pt:3-3')], deltaX: 0.1, deltaY: 0.1 },
    ];
    const bBlocked = buildCadSurface(bProject, bSurface);
    expect(bBlocked.outcome).toBe('blocked');
    expect(bBlocked.editFailure).toEqual({ editId: 'e-bx', reason: 'SURFACE_EDIT_MOVE_POINT_BOUNDARY' });
    bSurface.definition.edits = undefined;
    expect(buildCadSurface(bProject, bSurface).outcome).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Fail-closed + determinism
// ---------------------------------------------------------------------------

describe('18V bulk fail-closed + determinism', () => {
  it('empty refs reject at replay (no edit, no partial)', () => {
    const entities = gridEntities(5, () => 5);
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-empty', kind: 'set-elevation-many', vertices: [], z: 9 }];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-empty', reason: 'SURFACE_EDIT_NOT_APPLICABLE' });
    surface.definition.edits = undefined;
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
  });

  it('missing ref fails closed with SURFACE_EDIT_VERTEX_MISSING; base rebuilds bit-identical', () => {
    const entities = gridEntities(5, () => 5);
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    surface.definition.edits = [
      { id: 'e-miss', kind: 'set-elevation-many', vertices: [refOf('pt:1-1'), { key: 'source:pt:nope' }], z: 9 },
    ];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-miss', reason: 'SURFACE_EDIT_VERTEX_MISSING' });
    surface.definition.edits = undefined;
    const clean = buildCadSurface(project, surface);
    expect(clean.outcome).toBe('ok');
    if (clean.outcome !== 'ok' || base.outcome !== 'ok') throw new Error('build failed');
    expect(clean.points).toEqual(base.points);
    expect(clean.triangles).toEqual(base.triangles);
  });

  it('canonical order: shuffled + duplicated refs replay bit-identical', () => {
    const entities = gridEntities(5, () => 5);
    const ids = entities.map((e) => e.id);
    const picked = [refOf('pt:3-2'), refOf('pt:1-1'), refOf('pt:2-3')];
    const run = (vertices: Array<{ key: string }>): Build => {
      const surface = surfaceOf(ids);
      surface.definition.edits = [{ id: 'e-c', kind: 'set-elevation-many', vertices, z: 42 }];
      return buildCadSurface(projectOf(entities, [surface]), surface);
    };
    const canonical = run([...picked].sort((a, b) => (a.key < b.key ? -1 : 1)));
    const shuffledDupes = run([picked[2], picked[0], picked[2], picked[1], picked[0]]);
    expect(canonical.outcome).toBe('ok');
    expect(shuffledDupes.outcome).toBe('ok');
    if (canonical.outcome !== 'ok' || shuffledDupes.outcome !== 'ok') throw new Error('build failed');
    expect(shuffledDupes.points).toEqual(canonical.points);
    expect(shuffledDupes.triangles).toEqual(canonical.triangles);
    // Revision is order-insensitive too (describe sorts keys).
    const revOf = (vertices: Array<{ key: string }>): string => {
      const surface = surfaceOf(ids);
      surface.definition.edits = [{ id: 'e-c', kind: 'set-elevation-many', vertices, z: 42 }];
      return buildCadSurface(projectOf(entities, [surface]), surface).revision;
    };
    expect(revOf([picked[2], picked[0], picked[1]])).toBe(revOf(picked));
  });

  it('move-points delta is a vector: rotation applies, translation does not', () => {
    const edits = transformCadSurfaceEdits(
      [{ id: 'e-v', kind: 'move-points', vertices: [refOf('pt:A')], deltaX: 1, deltaY: 0 }],
      rotationAbout(100, 200, 90),
    );
    expect(edits?.[0]).toMatchObject({ kind: 'move-points' });
    const moved = edits?.[0];
    if (moved?.kind !== 'move-points') throw new Error('kind changed');
    // 90° rotation of (1,0) is (0,1) up to float dust; centre (100,200) must not leak in.
    expect(Math.abs(moved.deltaX)).toBeLessThan(1e-12);
    expect(moved.deltaY).toBeCloseTo(1, 12);
    // Absolute-carrying edits still move; Z-only bulk edits pass through bit-identical.
    const mixed = transformCadSurfaceEdits(
      [
        { id: 'e-s', kind: 'set-elevation-many', vertices: [refOf('pt:A')], z: 5 },
        { id: 'e-r', kind: 'raise-lower-points', vertices: [refOf('pt:A')], deltaZ: 2 },
      ],
      rotationAbout(100, 200, 90),
    );
    expect(mixed?.[0]).toEqual({ id: 'e-s', kind: 'set-elevation-many', vertices: [refOf('pt:A')], z: 5 });
    expect(mixed?.[1]).toEqual({ id: 'e-r', kind: 'raise-lower-points', vertices: [refOf('pt:A')], deltaZ: 2 });
  });
});

// ---------------------------------------------------------------------------
// Index agreement + mixed stacks (§9/§28/§30)
// ---------------------------------------------------------------------------

/** Assemble a live EditMeshState from an ok build (mirrors applyCadSurfaceEdits seeding). */
const assembleState = (build: Build, surfaceId: string): EditMeshState => {
  if (build.outcome !== 'ok') throw new Error('base build failed');
  const state: EditMeshState = {
    surfaceId,
    pts: build.points.map((p) => ({ id: p.entityId, x: p.x, y: p.y, z: p.z })),
    active: build.points.map(() => true),
    byId: new Map(build.points.map((p, index) => [p.entityId, index])),
    tris: new Map(build.triangles.map((t, index) => [index, [t[0], t[1], t[2]]])),
    nextTri: build.triangles.length,
    edgeMap: new Map(),
    edgeKind: new Map(),
    vertTris: new Map(),
    userLines: new Set(),
  };
  build.triangles.forEach((tri, index) => {
    const kinds = build.edgeKinds[index] ?? [TIN_EDGE_FREE, TIN_EDGE_FREE, TIN_EDGE_FREE];
    const edges = [[tri[1], tri[2]], [tri[2], tri[0]], [tri[0], tri[1]]] as const;
    edges.forEach(([u, v], k) => {
      const key = tinEdgeKey(u, v);
      const prior = state.edgeKind.get(key) ?? TIN_EDGE_FREE;
      if (kinds[k] > prior) state.edgeKind.set(key, kinds[k]);
    });
  });
  refreshEditEdges(state);
  return state;
};

describe('18V index discovery agreement', () => {
  it('index candidates cover every brute-force crosser with far fewer predicate tests', () => {
    const entities = gridEntities(12, () => 0);
    const surface = surfaceOf(entities.map((e) => e.id));
    const base = buildCadSurface(projectOf(entities, [surface]), surface);
    expect(base.outcome).toBe('ok');
    const cases: Array<{ refs: string[]; dx: number; dy: number }> = [
      { refs: ['pt:5-5', 'pt:6-5', 'pt:5-6', 'pt:6-6'], dx: 0.3, dy: 0.1 },
      { refs: ['pt:5-5'], dx: 2.3, dy: 0.7 },
      { refs: ['pt:2-2', 'pt:3-2', 'pt:4-2', 'pt:2-3', 'pt:3-3', 'pt:4-3', 'pt:2-4', 'pt:3-4', 'pt:4-4'], dx: 0, dy: 0.2 },
    ];
    let brutePairs = 0;
    let indexTests = 0;
    for (const { refs, dx, dy } of cases) {
      const state = assembleState(base, surface.id);
      const selected = new Set(refs.map((id) => state.byId.get(id) as number));
      const proposed = new Map<number, { x: number; y: number }>();
      for (const v of selected) {
        const p = state.pts[v];
        proposed.set(v, { x: p.x + dx, y: p.y + dy });
      }
      const at = (i: number): { x: number; y: number } => proposed.get(i) ?? state.pts[i];
      const movedKeys = new Set<string>();
      for (const [, tri] of state.tris) {
        for (const [u, w] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
          if (selected.has(u) || selected.has(w)) movedKeys.add(tinEdgeKey(u, w));
        }
      }
      const moved = [...movedKeys].sort().map((key) => {
        const [u, v] = key.split('>').map(Number) as [number, number];
        return { u, v, pu: at(u), pv: at(v) };
      });
      const uniqueKeys = [...state.edgeMap.keys()];
      const shares = (aU: number, aV: number, bU: number, bV: number): boolean =>
        aU === bU || aU === bV || aV === bU || aV === bV;
      // Brute force over every unique edge (verbatim predicate, proposed coords for moved).
      const bruteCrossers = new Set<string>();
      for (const m of moved) {
        for (const key of uniqueKeys) {
          const [u, v] = key.split('>').map(Number) as [number, number];
          if (shares(m.u, m.v, u, v)) continue;
          const c1 = at(u);
          const c2 = at(v);
          if (properlyCrosses(m.pu.x, m.pu.y, m.pv.x, m.pv.y, c1.x, c1.y, c2.x, c2.y)) {
            bruteCrossers.add(key);
          }
        }
      }
      brutePairs += moved.length * uniqueKeys.length;
      // Index path: candidates per proposed bbox must cover every crosser.
      const index = ensureEditEdgeSpatialIndex(state);
      const covered = new Set<string>();
      for (const m of moved) {
        const found = index.queryCandidates(
          Math.min(m.pu.x, m.pv.x),
          Math.min(m.pu.y, m.pv.y),
          Math.max(m.pu.x, m.pv.x),
          Math.max(m.pu.y, m.pv.y),
        );
        indexTests += found.length;
        for (const rec of found) covered.add(rec.edgeKey);
      }
      for (const key of bruteCrossers) {
        expect(covered.has(key), `crosser ${key} missed by index`).toBe(true);
      }
    }
    // Discovery sieve strictly narrows the predicate workload.
    expect(indexTests).toBeLessThan(brutePairs);
  });

  it('mixed single/bulk stacks replay exact geometry (no stale bboxes)', () => {
    const entities = gridEntities(6, (x, y) => x + y);
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    surface.definition.edits = [
      { id: 's1', kind: 'move-point', vertex: refOf('pt:2-2'), x: 2.2, y: 2.1 },
      { id: 'b1', kind: 'move-points', vertices: [refOf('pt:3-3'), refOf('pt:3-2')], deltaX: 0.2, deltaY: 0.1 },
      { id: 's2', kind: 'move-point', vertex: refOf('pt:4-4'), x: 4.15, y: 4.05 },
      { id: 'b2', kind: 'move-points', vertices: [refOf('pt:3-3'), refOf('pt:4-3')], deltaX: 0.1, deltaY: -0.05 },
    ];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    if (edited.outcome !== 'ok' || base.outcome !== 'ok') throw new Error('build failed');
    expect(edited.triangles).toEqual(base.triangles);
    const xy = (id: string): { x: number; y: number } => byEntityId(edited, id);
    expect(xy('pt:2-2').x).toBeCloseTo(2.2, 12);
    expect(xy('pt:2-2').y).toBeCloseTo(2.1, 12);
    expect(xy('pt:3-3').x).toBeCloseTo(3.3, 12);
    expect(xy('pt:3-3').y).toBeCloseTo(3.05, 12);
    expect(xy('pt:3-2').x).toBeCloseTo(3.2, 12);
    expect(xy('pt:3-2').y).toBeCloseTo(2.1, 12);
    expect(xy('pt:4-4').x).toBeCloseTo(4.15, 12);
    expect(xy('pt:4-4').y).toBeCloseTo(4.05, 12);
    expect(xy('pt:4-3').x).toBeCloseTo(4.1, 12);
    expect(xy('pt:4-3').y).toBeCloseTo(2.95, 12);
    for (const p of edited.points) {
      const b = base.points.find((q) => q.entityId === p.entityId) as { x: number; y: number; z: number };
      expect(p.z).toBe(b.z);
    }
  });
});

// ---------------------------------------------------------------------------
// Bulk dependency inspection (engine consumes bulk vertices[] refs)
// ---------------------------------------------------------------------------

describe('18V bulk dependency inspection', () => {
  const SID = 'sdep';
  const prodKey = `edit:${SID}:E1`;
  const stack: CadSurfaceEdit[] = [
    { id: 'E1', kind: 'add-point', x: 2.5, y: 2.5, z: 0 },
    { id: 'B1', kind: 'set-elevation-many', vertices: [{ key: prodKey }, { key: 'source:pt:0-0' }], z: 9 },
    { id: 'B2', kind: 'move-points', vertices: [{ key: prodKey }], deltaX: 0.1, deltaY: 0 },
    { id: 'B3', kind: 'raise-lower-points', vertices: [{ key: prodKey }], deltaZ: 1 },
  ];

  it('every bulk kind consumes the producer key', () => {
    const eng = inspectSurfaceEditDependencies(SID, stack);
    expect(eng[0]).toMatchObject({ creates: prodKey, consumes: [] });
    for (const dep of eng.slice(1)) {
      expect(dep.consumes).toEqual([prodKey]);
      expect(dep.missing).toEqual([]);
      expect(dep.disabledProducer).toEqual([]);
    }
  });

  it('consumer-before-producer reads missing (reorder must block)', () => {
    const swapped = [stack[1], stack[0], stack[2], stack[3]] as CadSurfaceEdit[];
    const eng = inspectSurfaceEditDependencies(SID, swapped);
    expect(eng[0]).toMatchObject({ editId: 'B1', missing: [prodKey] });
    expect(eng[1]).toMatchObject({ editId: 'E1', creates: prodKey });
  });

  it('disabled/deleted producer warns on every bulk consumer', () => {
    const disabled = stack.map((edit) => (edit.id === 'E1' ? { ...edit, enabled: false as const } : edit));
    const engOff = inspectSurfaceEditDependencies(SID, disabled);
    for (const dep of engOff.slice(1)) {
      expect(dep.missing).toEqual([]);
      expect(dep.disabledProducer).toEqual([prodKey]);
    }
    const deleted = stack.filter((edit) => edit.id !== 'E1');
    const engDel = inspectSurfaceEditDependencies(SID, deleted);
    for (const dep of engDel) {
      expect(dep.missing).toEqual([prodKey]);
    }
  });
});
