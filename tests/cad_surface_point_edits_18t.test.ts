import { describe, expect, it } from 'vitest';
import type {
  CadEntity,
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import {
  buildCadSurface,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaces';
import { TIN_EDGE_FREE } from '../src/engine/cad/tin/tinTypes';
import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import type { ImportedTinPayload } from '../src/engine/cad/cadTypes';

// ---------------------------------------------------------------------------
// Fixtures (mirrors tests/cad_surface_edits_18s.test.ts style)
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
    id: 'proj-18t',
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
    id: `s18t-${seq}`,
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

/** Plane z = 2x + 3y + 10 over the unit-decade quad (exact in binary). */
const planeQuad = (): { entities: CadSurveyPointEntity[]; z: number } => {
  const z = (x: number, y: number): number => 2 * x + 3 * y + 10;
  return {
    entities: [pt('A', 0, 0, z(0, 0)), pt('B', 10, 0, z(10, 0)), pt('C', 10, 10, z(10, 10)), pt('D', 0, 10, z(0, 10))],
    z: 0,
  };
};

const planeZ = (x: number, y: number): number => 2 * x + 3 * y + 10;

const interiorEdgeOf = (build: Build): [number, number] => {
  for (let i = 0; i < build.triangles.length; i += 1) {
    const tri = build.triangles[i];
    for (let k = 0; k < 3; k += 1) {
      if (build.adjacency[i][k] >= 0) return [tri[(k + 1) % 3] as number, tri[(k + 2) % 3] as number];
    }
  }
  throw new Error('no interior edge');
};

const boundaryEdgesOf = (build: Build): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < build.triangles.length; i += 1) {
    const tri = build.triangles[i];
    for (let k = 0; k < 3; k += 1) {
      if (build.adjacency[i][k] < 0) out.push([tri[(k + 1) % 3] as number, tri[(k + 2) % 3] as number]);
    }
  }
  return out;
};

const constrainedEndpointOf = (build: Build): string => {
  for (let i = 0; i < build.triangles.length; i += 1) {
    const tri = build.triangles[i];
    for (let k = 0; k < 3; k += 1) {
      if (build.edgeKinds[i][k] !== TIN_EDGE_FREE) return build.points[tri[(k + 1) % 3] as number].entityId;
    }
  }
  throw new Error('no constrained edge');
};

const gridEntities = (n: number, zOf: (_x: number, _y: number) => number): CadSurveyPointEntity[] => {
  const out: CadSurveyPointEntity[] = [];
  for (let x = 0; x < n; x += 1) {
    for (let y = 0; y < n; y += 1) {
      out.push(pt(`${x}-${y}`, x, y, zOf(x, y)));
    }
  }
  return out;
};

// ---------------------------------------------------------------------------
// Add-point oracles
// ---------------------------------------------------------------------------

describe('18T add-point', () => {
  it('plane insertion is shape-exact (inside split)', () => {
    const { entities } = planeQuad();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-add', kind: 'add-point', x: 2, y: 7, z: planeZ(2, 7) }];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.triangles).toHaveLength(4);
    expect(edited.points.find((p) => p.entityId === `edit:${surface.id}:e-add`)).toMatchObject({ x: 2, y: 7, z: 35 });
    for (const [x, y] of [[2, 7], [1, 1], [8, 2], [5, 9]] as const) {
      expect(getSurfaceElevationAt(edited, x, y)).toBeCloseTo(planeZ(x, y), 9);
    }
  });

  it('peak insertion builds 3 local tris, corners bit-identical', () => {
    const entities = [pt('A', 0, 0, 100), pt('B', 10, 0, 100), pt('C', 10, 10, 100), pt('D', 0, 10, 100)];
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-peak', kind: 'add-point', x: 2, y: 7, z: 110 }];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    const pi = edited.points.findIndex((p) => p.entityId === `edit:${surface.id}:e-peak`);
    expect(pi).toBeGreaterThanOrEqual(0);
    expect(edited.triangles.filter((t) => t.includes(pi))).toHaveLength(3);
    for (const e of entities) {
      const b = base.points.find((p) => p.entityId === e.id);
      const a = edited.points.find((p) => p.entityId === e.id);
      expect(a).toEqual(b);
    }
    expect(getSurfaceElevationAt(edited, 2, 7)).toBeCloseTo(110, 9);
    expect(getSurfaceElevationAt(edited, 8, 8)).toBeCloseTo(100, 9);
  });

  it('free interior edge splits 2 tris into 4, outer quad unchanged', () => {
    const { entities } = planeQuad();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    expect(base.triangles).toHaveLength(2);
    const [a, b] = interiorEdgeOf(base);
    const mx = (base.points[a].x + base.points[b].x) / 2;
    const my = (base.points[a].y + base.points[b].y) / 2;
    surface.definition.edits = [{ id: 'e-edge', kind: 'add-point', x: mx, y: my, z: planeZ(mx, my) }];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.triangles).toHaveLength(4);
    const outerOf = (build: Build): Set<string> => {
      const set = new Set<string>();
      for (const [u, v] of boundaryEdgesOf(build)) {
        const aId = build.points[u].entityId;
        const bId = build.points[v].entityId;
        set.add(aId < bId ? `${aId}+${bId}` : `${bId}+${aId}`);
      }
      return set;
    };
    expect(outerOf(edited)).toEqual(outerOf(base));
    expect(outerOf(base).size).toBe(4);
    expect(getSurfaceElevationAt(edited, mx, my)).toBeCloseTo(planeZ(mx, my), 9);
  });

  it('add-point on a breakline blocks with no mutation', () => {
    const entities = gridEntities(5, (x) => (x === 2 ? 10 : x));
    const ridgeIds = [0, 1, 2, 3, 4].map((y) => `pt:2-${y}`);
    const surface = surfaceOf(entities.map((e) => e.id), {
      breaklines: [{ id: 'bl1', source: { kind: 'point-chain', pointEntityIds: ridgeIds }, type: 'standard' }],
    });
    const project = projectOf(entities, [surface]);
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-bl', kind: 'add-point', x: 2, y: 0.5, z: 10 }];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-bl', reason: 'SURFACE_EDIT_BLOCKED_CONSTRAINT' });
    surface.definition.edits = undefined;
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
  });

  it('add-point on the outer boundary blocks', () => {
    const entities = gridEntities(7, () => 7);
    const surface = surfaceOf(entities.map((e) => e.id), {
      boundaries: [{ type: 'outer', sourceEntityId: 'outer1' }],
    });
    const project = projectOf([...entities, ringOf('outer1', [[1, 1], [5, 1], [5, 5], [1, 5]])], [surface]);
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-ob', kind: 'add-point', x: 2.5, y: 1, z: 7 }];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-ob', reason: 'SURFACE_EDIT_POINT_ON_BOUNDARY' });
    surface.definition.edits = undefined;
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
  });

  it('add-point inside a void blocks as outside-domain', () => {
    const entities = gridEntities(7, () => 7);
    const surface = surfaceOf(entities.map((e) => e.id), {
      boundaries: [
        { type: 'outer', sourceEntityId: 'outer1' },
        { type: 'void', sourceEntityId: 'void1' },
      ],
    });
    const project = projectOf(
      [...entities, ringOf('outer1', [[1, 1], [5, 1], [5, 5], [1, 5]]), ringOf('void1', [[1.5, 1.5], [4.5, 1.5], [4.5, 4.5], [1.5, 4.5]])],
      [surface],
    );
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-void', kind: 'add-point', x: 3.5, y: 3.5, z: 7 }];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-void', reason: 'SURFACE_EDIT_POINT_OUTSIDE_DOMAIN' });
    surface.definition.edits = undefined;
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Delete-point oracles
// ---------------------------------------------------------------------------

describe('18T delete-point', () => {
  const hexEntities = (): CadSurveyPointEntity[] => {
    const out = [pt('O', 0, 0, 5)];
    for (let k = 0; k < 6; k += 1) {
      const angle = (k * Math.PI) / 3;
      out.push(pt(`R${k}`, 10 * Math.cos(angle), 10 * Math.sin(angle), 0));
    }
    return out;
  };

  it('6-fan cavity: vertex gone, boundary preserved, no hole, area equal', () => {
    const entities = hexEntities();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    expect(base.triangles).toHaveLength(6);
    const before = new Set<string>();
    for (const [u, v] of boundaryEdgesOf(base)) {
      const a = base.points[u].entityId;
      const b = base.points[v].entityId;
      before.add(a < b ? `${a}+${b}` : `${b}+${a}`);
    }
    expect(before.size).toBe(6);
    const edit: CadSurfaceEdit = { id: 'e-del', kind: 'delete-point', vertex: { key: 'source:pt:O' } };
    surface.definition.edits = [edit];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.points.some((p) => p.entityId === 'pt:O')).toBe(false);
    expect(edited.points).toHaveLength(6);
    expect(edited.triangles).toHaveLength(4);
    const after = new Set<string>();
    for (const [u, v] of boundaryEdgesOf(edited)) {
      const a = edited.points[u].entityId;
      const b = edited.points[v].entityId;
      after.add(a < b ? `${a}+${b}` : `${b}+${a}`);
    }
    expect(after).toEqual(before);
    expect(edited.stats.planimetricArea).toBeCloseTo(base.stats.planimetricArea, 9);
    expect(getSurfaceElevationAt(edited, 0, 0)).toBeCloseTo(0, 9);
  });

  it('delete of a boundary vertex blocks', () => {
    const { entities } = planeQuad();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    const [u] = boundaryEdgesOf(base)[0] as [number, number];
    const victim = base.points[u].entityId;
    surface.definition.edits = [{ id: 'e-db', kind: 'delete-point', vertex: { key: `source:${victim}` } }];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-db', reason: 'SURFACE_EDIT_DELETE_POINT_BOUNDARY' });
  });

  it('delete of a breakline vertex blocks', () => {
    const entities = gridEntities(5, (x) => (x === 2 ? 10 : x));
    const ridgeIds = [0, 1, 2, 3, 4].map((y) => `pt:2-${y}`);
    const surface = surfaceOf(entities.map((e) => e.id), {
      breaklines: [{ id: 'bl1', source: { kind: 'point-chain', pointEntityIds: ridgeIds }, type: 'standard' }],
    });
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    const victim = constrainedEndpointOf(base);
    surface.definition.edits = [{ id: 'e-dc', kind: 'delete-point', vertex: { key: `source:${victim}` } }];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-dc', reason: 'SURFACE_EDIT_DELETE_POINT_CONSTRAINED' });
  });

  it('delete of a void-interior vertex blocks (no cavity to retriangulate)', () => {
    const entities = gridEntities(7, () => 7);
    const surface = surfaceOf(entities.map((e) => e.id), {
      boundaries: [
        { type: 'outer', sourceEntityId: 'outer1' },
        { type: 'void', sourceEntityId: 'void1' },
      ],
    });
    const project = projectOf(
      [...entities, ringOf('outer1', [[1, 1], [5, 1], [5, 5], [1, 5]]), ringOf('void1', [[1.5, 1.5], [4.5, 1.5], [4.5, 4.5], [1.5, 4.5]])],
      [surface],
    );
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    expect(getSurfaceElevationAt(base, 3, 3)).toBeNull();
    // pt:3-3 sits inside the void: no retained incident triangle, so no
    // cavity exists to retriangulate — fail closed, never a silent no-op.
    surface.definition.edits = [{ id: 'e-dv', kind: 'delete-point', vertex: { key: 'source:pt:3-3' } }];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-dv', reason: 'SURFACE_EDIT_DELETE_POINT_CAVITY_INVALID' });
  });
});

// ---------------------------------------------------------------------------
// Move-point oracles
// ---------------------------------------------------------------------------

describe('18T move-point', () => {
  const centerQuad = (): { entities: CadSurveyPointEntity[] } => ({
    entities: [
      pt('A', 0, 0, 0), pt('B', 10, 0, 0), pt('C', 10, 10, 0), pt('D', 0, 10, 0), pt('O', 5, 5, 50),
    ],
  });

  it('valid move keeps connectivity, XY exact, Z unchanged', () => {
    const { entities } = centerQuad();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-mv', kind: 'move-point', vertex: { key: 'source:pt:O' }, x: 6, y: 4 }];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.triangles).toEqual(base.triangles);
    const moved = edited.points.find((p) => p.entityId === 'pt:O');
    expect(moved).toMatchObject({ x: 6, y: 4, z: 50 });
    for (const e of entities) {
      if (e.id === 'pt:O') continue;
      expect(edited.points.find((p) => p.entityId === e.id)).toEqual(base.points.find((p) => p.entityId === e.id));
    }
    expect(getSurfaceElevationAt(edited, 6, 4)).toBeCloseTo(50, 9);
  });

  it('move outside the star blocks with no partial mutation', () => {
    const { entities } = centerQuad();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-mv', kind: 'move-point', vertex: { key: 'source:pt:O' }, x: 20, y: 20 }];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e-mv', reason: 'SURFACE_EDIT_MOVE_POINT_INVALID_STAR' });
    expect(project.entities.find((e) => e.id === 'pt:O')).toMatchObject({ x: 5, y: 5, z: 50 });
    surface.definition.edits = undefined;
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Elevation oracles
// ---------------------------------------------------------------------------

describe('18T set-elevation + raise/lower + order', () => {
  it('set-elevation: XY bit-identical, topology identical, source untouched', () => {
    const entities = [pt('A', 0, 0, 100), pt('B', 10, 0, 100), pt('C', 10, 10, 100), pt('D', 0, 10, 100)];
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-se', kind: 'set-elevation', vertex: { key: 'source:pt:A' }, z: 150 }];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.triangles).toEqual(base.triangles);
    for (const p of edited.points) {
      const b = base.points.find((q) => q.entityId === p.entityId);
      expect(p.x).toBe(b?.x);
      expect(p.y).toBe(b?.y);
    }
    expect(edited.points.find((p) => p.entityId === 'pt:A')?.z).toBe(150);
    expect(getSurfaceElevationAt(edited, 0, 0)).toBeCloseTo(150, 9);
    expect(project.entities.find((e) => e.id === 'pt:A')).toMatchObject({ z: 100 });
  });

  it('raise +2.5: probes +2.5, topology identical, slope identical, stats +2.5', () => {
    const { entities } = planeQuad();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    surface.definition.edits = [{ id: 'e-rl', kind: 'raise-lower-surface', deltaZ: 2.5 }];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.triangles).toEqual(base.triangles);
    for (const [x, y] of [[1, 1], [9, 9], [5, 5]] as const) {
      expect(getSurfaceElevationAt(edited, x, y)).toBeCloseTo((getSurfaceElevationAt(base, x, y) ?? 0) + 2.5, 9);
    }
    expect(edited.stats.meanFaceSlopeRatio).toBeCloseTo(base.stats.meanFaceSlopeRatio ?? 0, 12);
    expect(edited.stats.minFaceSlopeRatio).toBeCloseTo(base.stats.minFaceSlopeRatio ?? 0, 12);
    expect(edited.stats.maxFaceSlopeRatio).toBeCloseTo(base.stats.maxFaceSlopeRatio ?? 0, 12);
    expect(edited.stats.minZ).toBeCloseTo((base.stats.minZ ?? 0) + 2.5, 9);
    expect(edited.stats.maxZ).toBeCloseTo((base.stats.maxZ ?? 0) + 2.5, 9);
    expect(edited.stats.meanElevation).toBeCloseTo((base.stats.meanElevation ?? 0) + 2.5, 9);
  });

  it('order oracle: Add/Set/Raise -> 115 vs Raise/Add/Set -> 110', () => {
    const mk = (): { project: CadProject; surface: CadSurface } => {
      const entities = [pt('A', 0, 0, 100), pt('B', 10, 0, 100), pt('C', 10, 10, 100), pt('D', 0, 10, 100)];
      const surface = surfaceOf(entities.map((e) => e.id));
      return { project: projectOf(entities, [surface]), surface };
    };
    const first = mk();
    const add: CadSurfaceEdit = { id: 'e1', kind: 'add-point', x: 2, y: 7, z: 100 };
    const set: CadSurfaceEdit = {
      id: 'e2', kind: 'set-elevation', vertex: { key: `edit:${first.surface.id}:e1` }, z: 110,
    };
    const raise: CadSurfaceEdit = { id: 'e3', kind: 'raise-lower-surface', deltaZ: 5 };
    first.surface.definition.edits = [add, set, raise];
    const a = buildCadSurface(first.project, first.surface);
    expect(a.outcome).toBe('ok');
    expect(getSurfaceElevationAt(a, 2, 7)).toBeCloseTo(115, 9);
    const second = mk();
    const add2: CadSurfaceEdit = { id: 'e1', kind: 'add-point', x: 2, y: 7, z: 100 };
    const set2: CadSurfaceEdit = {
      id: 'e2', kind: 'set-elevation', vertex: { key: `edit:${second.surface.id}:e1` }, z: 110,
    };
    second.surface.definition.edits = [raise, add2, set2];
    const b = buildCadSurface(second.project, second.surface);
    expect(b.outcome).toBe('ok');
    expect(getSurfaceElevationAt(b, 2, 7)).toBeCloseTo(110, 9);
    expect(getSurfaceElevationAt(a, 0, 0)).toBeCloseTo(105, 9);
    expect(getSurfaceElevationAt(b, 0, 0)).toBeCloseTo(105, 9);
  });
});

// ---------------------------------------------------------------------------
// Edit-ref stability across save/reopen + source shuffle
// ---------------------------------------------------------------------------

describe('18T edit-ref stability', () => {
  const roundTrip = (project: CadProject): CadProject => {
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({
      ...createBlankCadDrawingDocument({ name: 'doc', units: 'm' }),
      project,
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('wncad parse failed');
    return parsed.drawing.project;
  };

  const incidentSetOf = (build: Build, entityId: string): string[] =>
    build.triangles
      .filter((tri) => tri.some((i) => build.points[i].entityId === entityId))
      .map((tri) => tri.map((i) => build.points[i].entityId).sort().join('+'))
      .sort();

  it('edit: refs survive WNCAD round-trip + source shuffle; later AddLine resolves same vertex', () => {
    const { entities } = planeQuad();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    surface.definition.edits = [{ id: 'e1', kind: 'add-point', x: 2, y: 7, z: planeZ(2, 7) }];
    const before = buildCadSurface(project, surface);
    expect(before.outcome).toBe('ok');
    const key = `edit:${surface.id}:e1`;
    const incident = incidentSetOf(before, key);
    expect(incident).toHaveLength(3);

    const reopened = roundTrip(project);
    const reopenedSurface = (reopened.surfaces ?? []).find((entry) => entry.id === surface.id)!;
    expect(reopenedSurface.definition.edits).toEqual(surface.definition.edits);
    const rebuilt = buildCadSurface(reopened, reopenedSurface);
    expect(rebuilt.outcome).toBe('ok');
    expect(rebuilt.points.find((p) => p.entityId === key)).toMatchObject({ x: 2, y: 7, z: 35 });
    expect(incidentSetOf(rebuilt, key)).toEqual(incident);

    // Source-point shuffle + a later AddLine consumer of the edit: key.
    const shuffled = projectOf([...entities].reverse(), [surface]);
    surface.definition.edits = [
      { id: 'e1', kind: 'add-point', x: 2, y: 7, z: planeZ(2, 7) },
      { id: 'e2', kind: 'add-line', from: { key }, to: { key: 'source:pt:C' } },
    ];
    const viaShuffle = buildCadSurface(shuffled, surface);
    expect(viaShuffle.outcome).toBe('ok');
    expect(viaShuffle.points.find((p) => p.entityId === key)).toMatchObject({ x: 2, y: 7, z: 35 });
    expect(incidentSetOf(viaShuffle, key).some((t) => t.includes(key) && t.includes('pt:C'))).toBe(true);
    const unshuffled = buildCadSurface(project, surface);
    expect(unshuffled.outcome).toBe('ok');
    expect(unshuffled.triangles).toEqual(viaShuffle.triangles);
  });
});

// ---------------------------------------------------------------------------
// Source-change precedence
// ---------------------------------------------------------------------------

describe('18T source-change precedence', () => {
  it('source XY move reapplies the set-elevation override', () => {
    const entities = [pt('A', 0, 0, 100), pt('B', 10, 0, 100), pt('C', 10, 10, 100), pt('D', 0, 10, 100)];
    const surface = surfaceOf(entities.map((e) => e.id));
    surface.definition.edits = [{ id: 'e-se', kind: 'set-elevation', vertex: { key: 'source:pt:A' }, z: 150 }];
    const moved = entities.map((e) => (e.id === 'pt:A' ? { ...e, x: 1, y: 1 } : e));
    const edited = buildCadSurface(projectOf(moved, [surface]), surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.points.find((p) => p.entityId === 'pt:A')).toMatchObject({ x: 1, y: 1, z: 150 });
    expect(getSurfaceElevationAt(edited, 1, 1)).toBeCloseTo(150, 9);
  });

  it('source delete fails the build closed', () => {
    const entities = [pt('A', 0, 0, 100), pt('B', 10, 0, 100), pt('C', 10, 10, 100), pt('D', 0, 10, 100)];
    const surface = surfaceOf(entities.map((e) => e.id));
    surface.definition.edits = [{ id: 'e-se', kind: 'set-elevation', vertex: { key: 'source:pt:A' }, z: 150 }];
    const blocked = buildCadSurface(projectOf(entities.filter((e) => e.id !== 'pt:A'), [surface]), surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.reasonCodes).toContain('SURFACE_REFERENCE_MISSING');
  });

  it('move-point absolute target beats a later source move', () => {
    const entities = [
      pt('A', 0, 0, 0), pt('B', 10, 0, 0), pt('C', 10, 10, 0), pt('D', 0, 10, 0), pt('O', 5, 5, 50),
    ];
    const surface = surfaceOf(entities.map((e) => e.id));
    surface.definition.edits = [{ id: 'e-mv', kind: 'move-point', vertex: { key: 'source:pt:O' }, x: 6, y: 4 }];
    const moved = entities.map((e) => (e.id === 'pt:O' ? { ...e, x: 7, y: 7 } : e));
    const edited = buildCadSurface(projectOf(moved, [surface]), surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.points.find((p) => p.entityId === 'pt:O')).toMatchObject({ x: 6, y: 4, z: 50 });
    expect(getSurfaceElevationAt(edited, 6, 4)).toBeCloseTo(50, 9);
  });

  it('disabled move defers to the source position', () => {
    const entities = [
      pt('A', 0, 0, 0), pt('B', 10, 0, 0), pt('C', 10, 10, 0), pt('D', 0, 10, 0), pt('O', 5, 5, 50),
    ];
    const surface = surfaceOf(entities.map((e) => e.id));
    surface.definition.edits = [
      { id: 'e-mv', kind: 'move-point', enabled: false, vertex: { key: 'source:pt:O' }, x: 6, y: 4 },
    ];
    const moved = entities.map((e) => (e.id === 'pt:O' ? { ...e, x: 7, y: 3 } : e));
    const edited = buildCadSurface(projectOf(moved, [surface]), surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.points.find((p) => p.entityId === 'pt:O')).toMatchObject({ x: 7, y: 3, z: 50 });
  });
});

// ---------------------------------------------------------------------------
// Imported-TIN point edits
// ---------------------------------------------------------------------------

describe('18T imported-TIN point edits', () => {
  const payload = (): ImportedTinPayload => ({
    vertices: [0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0, 0, 2, 0, 1, 2, 0, 2, 2, 0],
    faces: [0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 3, 4, 7, 3, 7, 6, 4, 5, 8, 4, 8, 7],
    provenance: { format: 'LandXML', fileName: 'src.xml', surfaceName: 'Imported', sourceId: 'sid-1' },
  });

  const importedSurface = (id: string): CadSurface => ({
    id,
    name: 'imported',
    definition: {
      pointSource: { kind: 'points', pointEntityIds: [] },
      sourceKind: 'imported-tin',
      importedTin: payload(),
    },
  });

  it('Set/Move keep the payload byte-identical; save/reopen rebuilds equal', () => {
    const surface = importedSurface('s18t-imp');
    const project = projectOf([], [surface]);
    expect(buildCadSurface(project, surface).outcome).toBe('ok');
    surface.definition.edits = [
      { id: 'e1', kind: 'set-elevation', vertex: { key: 'imported:s18t-imp:0' }, z: 50 },
      { id: 'e2', kind: 'move-point', vertex: { key: 'imported:s18t-imp:4' }, x: 1.2, y: 1.1 },
    ];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(getSurfaceElevationAt(edited, 0, 0)).toBeCloseTo(50, 9);
    expect(edited.points.find((p) => p.entityId === 's18t-imp:v4')).toMatchObject({ x: 1.2, y: 1.1, z: 0 });
    expect(surface.definition.importedTin?.vertices).toEqual(payload().vertices);
    expect(surface.definition.importedTin?.faces).toEqual(payload().faces);
    expect(surface.definition.importedTin).toEqual(payload());

    const parsed = parseCadDrawingFile(serializeCadDrawingFile({
      ...createBlankCadDrawingDocument({ name: 'doc', units: 'm' }),
      project,
    }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('wncad parse failed');
    const reopened = parsed.drawing.project;
    const reopenedSurface = (reopened.surfaces ?? []).find((entry) => entry.id === surface.id)!;
    expect(reopenedSurface.definition.edits).toEqual(surface.definition.edits);
    expect(reopenedSurface.definition.importedTin).toEqual(payload());
    const rebuilt = buildCadSurface(reopened, reopenedSurface);
    expect(rebuilt.outcome).toBe('ok');
    expect(rebuilt.triangles).toEqual(edited.triangles);
    expect(rebuilt.points).toEqual(edited.points);
  });
});

// ---------------------------------------------------------------------------
// Large coordinates + input-order determinism
// ---------------------------------------------------------------------------

describe('18T large coords + determinism', () => {
  it('edits at E~2e6/N~7e6 match the local-frame result', () => {
    const DX = 2e6;
    const DY = 7e6;
    const local = planeQuad().entities;
    const surface = surfaceOf(local.map((e) => e.id));
    surface.definition.edits = [{ id: 'e-big', kind: 'add-point', x: 2, y: 7, z: planeZ(2, 7) }];
    const localBuild = buildCadSurface(projectOf(local, [surface]), surface);
    expect(localBuild.outcome).toBe('ok');

    const shifted = local.map((e) => ({ ...e, x: e.x + DX, y: e.y + DY }));
    const surface2 = surfaceOf(shifted.map((e) => e.id));
    surface2.definition.edits = [{ id: 'e-big', kind: 'add-point', x: 2 + DX, y: 7 + DY, z: planeZ(2, 7) }];
    const shiftedBuild = buildCadSurface(projectOf(shifted, [surface2]), surface2);
    expect(shiftedBuild.outcome).toBe('ok');
    expect(shiftedBuild.triangles).toEqual(localBuild.triangles);
    expect(getSurfaceElevationAt(shiftedBuild, 2 + DX, 7 + DY)).toBeCloseTo(
      getSurfaceElevationAt(localBuild, 2, 7) ?? 0, 6,
    );
    expect(shiftedBuild.points.find((p) => p.entityId === `edit:${surface2.id}:e-big`)).toMatchObject({
      x: 2 + DX, y: 7 + DY, z: 35,
    });
  });

  it('shuffled source order yields the equivalent canonical mesh', () => {
    const { entities } = planeQuad();
    const surface: CadSurface = {
      id: 's18t-det',
      name: 'det',
      definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((e) => e.id) } },
    };
    const key = 'edit:s18t-det:e1';
    const edits: CadSurfaceEdit[] = [
      { id: 'e1', kind: 'add-point', x: 2, y: 7, z: planeZ(2, 7) },
      { id: 'e2', kind: 'set-elevation', vertex: { key }, z: 40 },
    ];
    surface.definition.edits = edits;
    const first = buildCadSurface(projectOf(entities, [surface]), surface);
    const second = buildCadSurface(projectOf([...entities].reverse(), [surface]), surface);
    expect(first.outcome).toBe('ok');
    expect(second.outcome).toBe('ok');
    const digest = (build: Build): string[] =>
      build.triangles.map((tri) => tri.map((i) => build.points[i].entityId).sort().join('+')).sort();
    expect(digest(second)).toEqual(digest(first));
    expect(second.points.find((p) => p.entityId === key)).toEqual(first.points.find((p) => p.entityId === key));
    expect(getSurfaceElevationAt(second, 2, 7)).toBeCloseTo(40, 9);
  });
});

// ---------------------------------------------------------------------------
// Mixed-stack smoke
// ---------------------------------------------------------------------------

describe('18T mixed-stack smoke', () => {
  const hexEntities = (): CadSurveyPointEntity[] => {
    const out = [pt('O', 0, 0, 5)];
    for (let k = 0; k < 6; k += 1) {
      const angle = (k * Math.PI) / 3;
      out.push(pt(`R${k}`, 10 * Math.cos(angle), 10 * Math.sin(angle), 0));
    }
    return out;
  };

  it('Add+AddLine+Set+Swap+Delete+Move composition resolves via edit: key', () => {
    const entities = hexEntities();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const key = `edit:${surface.id}:e1`;
    surface.definition.edits = [
      { id: 'e0', kind: 'add-line', from: { key: 'source:pt:R0' }, to: { key: 'source:pt:R2' } },
      { id: 'e1', kind: 'add-point', x: 5, y: 3, z: 30 },
      { id: 'e2', kind: 'set-elevation', vertex: { key }, z: 40 },
      { id: 'e4', kind: 'swap-edge', edge: { a: { key: 'source:pt:O' }, b: { key: 'source:pt:R3' } } },
      { id: 'e5', kind: 'delete-line', edge: { a: { key: 'source:pt:R2' }, b: { key: 'source:pt:R4' } } },
      { id: 'e6', kind: 'move-point', vertex: { key }, x: 5.5, y: 3 },
    ];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.points.find((p) => p.entityId === key)).toMatchObject({ x: 5.5, y: 3, z: 40 });
    expect(getSurfaceElevationAt(edited, 5.5, 3)).toBeCloseTo(40, 9);
    expect(edited.triangles).toHaveLength(6);
    // Forced user line survives; swapped-then-deleted region is a hole.
    const pairs = new Set<string>();
    for (const tri of edited.triangles) {
      for (const [p, q] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
        const a = edited.points[p].entityId;
        const b = edited.points[q].entityId;
        pairs.add(a < b ? `${a}+${b}` : `${b}+${a}`);
      }
    }
    expect(pairs.has('pt:R0+pt:R2')).toBe(true);
    expect(getSurfaceElevationAt(edited, -5, 0)).toBeNull();
  });

  it('Add-then-Delete removes the edit vertex entirely', () => {
    const entities = hexEntities();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const base = buildCadSurface(project, surface);
    expect(base.outcome).toBe('ok');
    const key = `edit:${surface.id}:e1`;
    surface.definition.edits = [
      { id: 'e1', kind: 'add-point', x: 5, y: 3, z: 30 },
      { id: 'e2', kind: 'delete-point', vertex: { key } },
    ];
    const edited = buildCadSurface(project, surface);
    expect(edited.outcome).toBe('ok');
    expect(edited.points.some((p) => p.entityId === key)).toBe(false);
    expect(edited.triangles).toHaveLength(6);
    expect(edited.stats.planimetricArea).toBeCloseTo(base.stats.planimetricArea, 9);
  });

  it('enabled consumer of a deleted edit vertex fails the build', () => {
    const entities = hexEntities();
    const surface = surfaceOf(entities.map((e) => e.id));
    const project = projectOf(entities, [surface]);
    const key = `edit:${surface.id}:e1`;
    surface.definition.edits = [
      { id: 'e1', kind: 'add-point', x: 5, y: 3, z: 30 },
      { id: 'e2', kind: 'delete-point', vertex: { key } },
      { id: 'e3', kind: 'set-elevation', vertex: { key }, z: 40 },
    ];
    const blocked = buildCadSurface(project, surface);
    expect(blocked.outcome).toBe('blocked');
    expect(blocked.editFailure).toEqual({ editId: 'e3', reason: 'SURFACE_EDIT_VERTEX_MISSING' });
  });
});
