import { describe, expect, it } from 'vitest';

import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaces';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type {
  CadEntity,
  CadProject,
  CadSurface,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

const chainLine = (id: string, stations: string[]): CadEntity => ({
  id,
  type: 'polyline',
  layerId: 'general',
  visible: true,
  locked: false,
  vertices: stations.map(() => ({ x: 0, y: 0 })),
  vertexLabels: stations,
  closed: false,
}) as unknown as CadEntity;

const baseEntities = (): CadEntity[] => [
  point('pt-a', 'A', 0, 0, 105),
  point('pt-b', 'B', 5, 8, 110),
  point('pt-c', 'C', 10, 0, 105),
  point('pt-d', 'D', 10, 10, 120),
  point('pt-e', 'E', 0, 10, 115),
  point('pt-w1', 'W1', 0, 5, 100),
  point('pt-w2', 'W2', 10, 5, 101),
  point('pt-n1', 'N1', 5, 10, 102),
  point('pt-e1', 'E1', 15, 10, 103),
  point('pt-s1', 'S1', 5, 0, 104),
  point('pt-x1', 'X1', 5, 5, 105),
  point('pt-p', 'P', 20, 20, 100),
  point('pt-q', 'Q', 30, 30, 100),
  point('pt-r', 'R', 20, 30, 100),
  point('pt-s', 'S', 30, 20, 100),
];

const projectWith = (entities: CadEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Breakline 18W', units: 'm' });
  return { ...drawing.project, entities };
};

const historyWithSurface = (
  breaklines: CadSurface['definition']['breaklines'],
  entities: CadEntity[] = baseEntities(),
) => {
  let history = createCadHistoryState(projectWith(entities));
  const ids = entities
    .filter((entry): entry is CadSurveyPointEntity => entry.type === 'survey-point')
    .map((entry) => entry.id);
  history = runCadCommand(history, {
    key: 'SURFACE_CREATE',
    name: 'Site',
    pointSource: { kind: 'points', pointEntityIds: ids },
  });
  const created = history.present.project.surfaces![0]!;
  const withBreaklines: CadProject = {
    ...history.present.project,
    surfaces: [{ ...created, definition: { ...created.definition, breaklines } }],
  };
  history = createCadHistoryState(withBreaklines);
  const surfaceId = history.present.project.surfaces![0]!.id;
  return { history, surfaceId };
};

const projectOf = (history: ReturnType<typeof createCadHistoryState>): CadProject =>
  history.present.project;

const surfaceOf = (project: CadProject, surfaceId: string): CadSurface =>
  project.surfaces!.find((entry) => entry.id === surfaceId)!;

const run = (
  history: ReturnType<typeof createCadHistoryState>,
  command: CadCommand,
): ReturnType<typeof createCadHistoryState> => runCadCommand(history, command);

const edgeSetOf = (triangles: Array<[number, number, number]>): Set<string> => {
  const set = new Set<string>();
  for (const tri of triangles) {
    for (const [p, q] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      set.add(`${Math.min(p, q)}>${Math.max(p, q)}`);
    }
  }
  return set;
};

const chainOf = (project: CadProject, surfaceId: string, breaklineId: string): string[] => {
  const found = surfaceOf(project, surfaceId).definition.breaklines!.find(
    (entry) => entry.id === breaklineId,
  )!;
  if (found.source.kind !== 'point-chain') throw new Error('expected point chain');
  return [...found.source.pointEntityIds];
};

const ABC = () => [
  { id: 'bl-1', source: { kind: 'point-chain' as const, pointEntityIds: ['pt-a', 'pt-c'] }, type: 'standard' as const },
];

// ---------------------------------------------------------------------------
// Insert / remove / reverse oracles
// ---------------------------------------------------------------------------

describe('18W breakline insert/remove/reverse', () => {
  it('inserts B into A-C: A-B and B-C constrained, exact B elevation', () => {
    const { history, surfaceId } = historyWithSurface(ABC());
    const next = run(history, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityId: 'pt-b',
      insertIndex: 1,
    });
    expect(next).not.toBe(history);
    expect(chainOf(next.present.project, surfaceId, 'bl-1')).toEqual(['pt-a', 'pt-b', 'pt-c']);
    const project = next.present.project;
    const build = buildCadSurface(project, surfaceOf(project, surfaceId));
    expect(build.outcome).toBe('ok');
    const byId = new Map(build.points.map((entry, index) => [entry.entityId, index]));
    const edges = edgeSetOf(build.triangles);
    const edge = (a: string, b: string): string => {
      const x = byId.get(a)!;
      const y = byId.get(b)!;
      return `${Math.min(x, y)}>${Math.max(x, y)}`;
    };
    expect(edges.has(edge('pt-a', 'pt-b'))).toBe(true);
    expect(edges.has(edge('pt-b', 'pt-c'))).toBe(true);
    expect(getSurfaceElevationAt(build, 5, 8)).toBeCloseTo(110, 9);
  });

  it('clamps out-of-range insert indices and undoes in one entry', () => {
    const { history, surfaceId } = historyWithSurface(ABC());
    const appended = run(history, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityId: 'pt-d',
      insertIndex: 99,
    });
    expect(chainOf(appended.present.project, surfaceId, 'bl-1')).toEqual(['pt-a', 'pt-c', 'pt-d']);
    const prepended = run(history, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityId: 'pt-d',
      insertIndex: -5,
    });
    expect(chainOf(prepended.present.project, surfaceId, 'bl-1')).toEqual(['pt-d', 'pt-a', 'pt-c']);
    const undone = undoCadHistory(appended);
    expect(chainOf(undone.present.project, surfaceId, 'bl-1')).toEqual(['pt-a', 'pt-c']);
  });

  it('removes B by id: A-C constrained, B point retained, no auto-delete', () => {
    const { history, surfaceId } = historyWithSurface([
      { id: 'bl-1', source: { kind: 'point-chain', pointEntityIds: ['pt-a', 'pt-b', 'pt-c'] }, type: 'standard' },
    ]);
    const next = run(history, {
      key: 'SURFACE_BREAKLINE_REMOVE_POINT',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityId: 'pt-b',
    });
    expect(next).not.toBe(history);
    expect(chainOf(next.present.project, surfaceId, 'bl-1')).toEqual(['pt-a', 'pt-c']);
    const project = next.present.project;
    const untouched = surfaceOf(project, surfaceId).definition.breaklines!;
    expect(untouched.some((entry) => entry.id === 'bl-1')).toBe(true);
    const build = buildCadSurface(project, surfaceOf(project, surfaceId));
    expect(build.outcome).toBe('ok');
    const byId = new Map(build.points.map((entry, index) => [entry.entityId, index]));
    const edges = edgeSetOf(build.triangles);
    const edge = (a: string, b: string): boolean => {
      const x = byId.get(a)!;
      const y = byId.get(b)!;
      return edges.has(`${Math.min(x, y)}>${Math.max(x, y)}`);
    };
    // S1(5,0) lies exactly on A-C, so the engine splits the constraint A-S1-C.
    expect(edge('pt-a', 'pt-s1')).toBe(true);
    expect(edge('pt-s1', 'pt-c')).toBe(true);
    expect(byId.has('pt-b')).toBe(true);
  });

  it('removes by index and blocks a sub-2 remainder without deleting', () => {
    const { history, surfaceId } = historyWithSurface([
      { id: 'bl-1', source: { kind: 'point-chain', pointEntityIds: ['pt-a', 'pt-b', 'pt-c'] }, type: 'standard' },
    ]);
    const next = run(history, {
      key: 'SURFACE_BREAKLINE_REMOVE_POINT',
      surfaceId,
      breaklineId: 'bl-1',
      index: 0,
    });
    expect(chainOf(next.present.project, surfaceId, 'bl-1')).toEqual(['pt-b', 'pt-c']);
    const snapshot = next.present;
    expect(executeCadCommand(snapshot, {
      key: 'SURFACE_BREAKLINE_REMOVE_POINT',
      surfaceId,
      breaklineId: 'bl-1',
      index: 0,
    })).toBeNull();
    expect(chainOf(next.present.project, surfaceId, 'bl-1')).toEqual(['pt-b', 'pt-c']);
  });

  it('reverse is canonical-TIN/domain/elevation equivalent', () => {
    const { history, surfaceId } = historyWithSurface([
      { id: 'bl-1', source: { kind: 'point-chain', pointEntityIds: ['pt-a', 'pt-b', 'pt-c'] }, type: 'standard' },
    ]);
    const before = buildCadSurface(projectOf(history), surfaceOf(projectOf(history), surfaceId));
    expect(before.outcome).toBe('ok');
    const next = run(history, { key: 'SURFACE_BREAKLINE_REVERSE', surfaceId, breaklineId: 'bl-1' });
    expect(chainOf(next.present.project, surfaceId, 'bl-1')).toEqual(['pt-c', 'pt-b', 'pt-a']);
    const after = buildCadSurface(next.present.project, surfaceOf(next.present.project, surfaceId));
    expect(after.outcome).toBe('ok');
    expect(after.points).toEqual(before.points);
    const canonical = (tris: Array<[number, number, number]>): string[] =>
      tris.map((tri) => [...tri].sort((a, b) => a - b).join('>')).sort();
    expect(canonical(after.triangles)).toEqual(canonical(before.triangles));
    for (const [x, y] of [[2, 3], [7, 2], [5, 8], [3, 9]] as const) {
      expect(getSurfaceElevationAt(after, x, y)).toEqual(getSurfaceElevationAt(before, x, y));
    }
  });

  it('replace swaps the chain, preserves id/name/type, rejects short chains', () => {
    const { history, surfaceId } = historyWithSurface([
      { id: 'bl-1', source: { kind: 'point-chain', pointEntityIds: ['pt-a', 'pt-c'] }, type: 'standard', name: 'Ridge' },
    ]);
    const next = run(history, {
      key: 'SURFACE_BREAKLINE_REPLACE_CHAIN',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityIds: ['pt-a', 'pt-b', 'pt-c'],
    });
    const replaced = surfaceOf(next.present.project, surfaceId).definition.breaklines![0]!;
    expect(replaced.id).toBe('bl-1');
    expect(replaced.name).toBe('Ridge');
    expect(replaced.type).toBe('standard');
    expect(chainOf(next.present.project, surfaceId, 'bl-1')).toEqual(['pt-a', 'pt-b', 'pt-c']);
    expect(executeCadCommand(next.present, {
      key: 'SURFACE_BREAKLINE_REPLACE_CHAIN',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityIds: ['pt-a'],
    })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Point-following, Z, crossing, rename, duplicate/self-intersection
// ---------------------------------------------------------------------------

describe('18W breakline geometry oracles', () => {
  it('Survey Point move follows after rebuild with a byte-identical definition', () => {
    const { history, surfaceId } = historyWithSurface(ABC());
    const before = surfaceOf(projectOf(history), surfaceId);
    const moved: CadProject = {
      ...projectOf(history),
      entities: projectOf(history).entities.map((entry) =>
        entry.id === 'pt-b' ? { ...entry, x: 5, y: 2 } : entry,
      ),
    };
    expect(JSON.stringify(surfaceOf(moved, surfaceId).definition)).toBe(
      JSON.stringify(before.definition),
    );
    expect(computeCadSurfaceSourceRevision(moved, surfaceOf(moved, surfaceId))).not.toBe(
      computeCadSurfaceSourceRevision(projectOf(history), before),
    );
    const build = buildCadSurface(moved, surfaceOf(moved, surfaceId));
    expect(build.outcome).toBe('ok');
    expect(getSurfaceElevationAt(build, 5, 2)).toBeCloseTo(110, 9);
  });

  it('honors a Survey Point Z change 105 to 110', () => {
    const { history, surfaceId } = historyWithSurface(ABC());
    const changed: CadProject = {
      ...projectOf(history),
      entities: projectOf(history).entities.map((entry) =>
        entry.id === 'pt-a' ? { ...entry, z: 110 } : entry,
      ),
    };
    const build = buildCadSurface(changed, surfaceOf(changed, surfaceId));
    expect(build.outcome).toBe('ok');
    expect(getSurfaceElevationAt(build, 0, 0)).toBeCloseTo(110, 9);
  });

  it('blocks a crossing without a shared vertex, passes with a shared Survey Point', () => {
    const { history, surfaceId } = historyWithSurface([
      { id: 'bl-h', source: { kind: 'point-chain', pointEntityIds: ['pt-w1', 'pt-w2'] }, type: 'standard' },
      { id: 'bl-v', source: { kind: 'point-chain', pointEntityIds: ['pt-n1', 'pt-e1'] }, type: 'standard' },
    ]);
    expect(executeCadCommand(history.present, {
      key: 'SURFACE_BREAKLINE_REPLACE_CHAIN',
      surfaceId,
      breaklineId: 'bl-v',
      pointEntityIds: ['pt-n1', 'pt-s1'],
    })).toBeNull();
    const shared = run(history, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT',
      surfaceId,
      breaklineId: 'bl-h',
      pointEntityId: 'pt-x1',
      insertIndex: 1,
    });
    const crossed = run(shared, {
      key: 'SURFACE_BREAKLINE_REPLACE_CHAIN',
      surfaceId,
      breaklineId: 'bl-v',
      pointEntityIds: ['pt-n1', 'pt-x1', 'pt-s1'],
    });
    expect(crossed).not.toBe(shared);
    const build = buildCadSurface(crossed.present.project, surfaceOf(crossed.present.project, surfaceId));
    expect(build.outcome).toBe('ok');
  });

  it('rename is revision-neutral and trims (empty clears)', () => {
    const { history, surfaceId } = historyWithSurface([
      { id: 'bl-1', source: { kind: 'point-chain', pointEntityIds: ['pt-a', 'pt-c'] }, type: 'standard', name: 'Old' },
    ]);
    const revision = computeCadSurfaceSourceRevision(
      projectOf(history), surfaceOf(projectOf(history), surfaceId),
    );
    const renamed = run(history, {
      key: 'SURFACE_RENAME_BREAKLINE',
      surfaceId,
      breaklineId: 'bl-1',
      name: '  Ridge  ',
    });
    expect(surfaceOf(renamed.present.project, surfaceId).definition.breaklines![0]!.name).toBe('Ridge');
    expect(computeCadSurfaceSourceRevision(
      renamed.present.project, surfaceOf(renamed.present.project, surfaceId),
    )).toBe(revision);
    const cleared = run(renamed, {
      key: 'SURFACE_RENAME_BREAKLINE',
      surfaceId,
      breaklineId: 'bl-1',
      name: '   ',
    });
    expect('name' in surfaceOf(cleared.present.project, surfaceId).definition.breaklines![0]!).toBe(false);
    expect(computeCadSurfaceSourceRevision(
      cleared.present.project, surfaceOf(cleared.present.project, surfaceId),
    )).toBe(revision);
    expect(executeCadCommand(history.present, {
      key: 'SURFACE_RENAME_BREAKLINE',
      surfaceId,
      breaklineId: 'missing',
      name: 'X',
    })).toBeNull();
  });

  it('blocks duplicate refs and self-intersecting chains', () => {
    const { history, surfaceId } = historyWithSurface(ABC());
    expect(executeCadCommand(history.present, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityId: 'pt-a',
      insertIndex: 1,
    })).toBeNull();
    expect(executeCadCommand(history.present, {
      key: 'SURFACE_BREAKLINE_REPLACE_CHAIN',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityIds: ['pt-a', 'pt-b', 'pt-a'],
    })).toBeNull();
    // Bowtie P-Q-R-S: P(20,20)-Q(30,30) proper-crosses R(20,30)-S(30,20).
    expect(executeCadCommand(history.present, {
      key: 'SURFACE_BREAKLINE_REPLACE_CHAIN',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityIds: ['pt-p', 'pt-q', 'pt-r', 'pt-s'],
    })).toBeNull();
    expect(executeCadCommand(history.present, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT',
      surfaceId,
      breaklineId: 'bl-1',
      pointEntityId: 'ghost',
      insertIndex: 1,
    })).toBeNull();
    expect(chainOf(projectOf(history), surfaceId, 'bl-1')).toEqual(['pt-a', 'pt-c']);
  });
});

// ---------------------------------------------------------------------------
// Entity-backed conversion
// ---------------------------------------------------------------------------

describe('18W breakline conversion', () => {
  it('converts an entity-backed chain with build equivalence; entity untouched', () => {
    const entities = [...baseEntities(), chainLine('ch-1', ['A', 'B'])];
    const { history, surfaceId } = historyWithSurface(
      [{ id: 'bl-1', source: { kind: 'entity', entityId: 'ch-1' }, type: 'standard', name: 'F2F' }],
      entities,
    );
    const before = buildCadSurface(projectOf(history), surfaceOf(projectOf(history), surfaceId));
    expect(before.outcome).toBe('ok');
    const next = run(history, {
      key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN',
      surfaceId,
      breaklineId: 'bl-1',
    });
    expect(next).not.toBe(history);
    const converted = surfaceOf(next.present.project, surfaceId).definition.breaklines![0]!;
    expect(converted.id).toBe('bl-1');
    expect(converted.name).toBe('F2F');
    expect(converted.type).toBe('standard');
    expect(converted.source).toEqual({ kind: 'point-chain', pointEntityIds: ['A', 'B'] });
    const after = buildCadSurface(next.present.project, surfaceOf(next.present.project, surfaceId));
    expect(after.outcome).toBe('ok');
    expect(after.triangles).toEqual(before.triangles);
    expect(next.present.project.entities.find((entry) => entry.id === 'ch-1')).toEqual(
      projectOf(history).entities.find((entry) => entry.id === 'ch-1'),
    );
  });

  it('blocks conversion on point chains, missing entities, and unresolvable refs', () => {
    const entities = [
      ...baseEntities(),
      chainLine('ch-bad', ['A', 'ghost-station']),
      chainLine('ch-short', ['A']),
    ];
    const { history, surfaceId } = historyWithSurface(
      [
        { id: 'bl-chain', source: { kind: 'point-chain', pointEntityIds: ['pt-a', 'pt-c'] }, type: 'standard' },
        { id: 'bl-bad', source: { kind: 'entity', entityId: 'ch-bad' }, type: 'standard' },
        { id: 'bl-short', source: { kind: 'entity', entityId: 'ch-short' }, type: 'standard' },
        { id: 'bl-gone', source: { kind: 'entity', entityId: 'nope' }, type: 'standard' },
      ],
      entities,
    );
    for (const breaklineId of ['bl-chain', 'bl-bad', 'bl-short', 'bl-gone', 'missing']) {
      expect(executeCadCommand(history.present, {
        key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN',
        surfaceId,
        breaklineId,
      })).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Imported-TIN guard
// ---------------------------------------------------------------------------

describe('18W imported-TIN guard', () => {
  const importedProject = (): { project: CadProject; surfaceId: string } => {
    const history = createCadHistoryState(projectWith([]));
    const project = history.present.project;
    const surface: CadSurface = {
      id: 'surf-tin',
      name: 'Imported',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        breaklines: [
          { id: 'bl-1', source: { kind: 'point-chain', pointEntityIds: ['pt-a', 'pt-c'] }, type: 'standard' },
        ],
        sourceKind: 'imported-tin',
        importedTin: {
          vertices: [0, 0, 1, 10, 0, 2, 10, 10, 3, 0, 10, 4],
          faces: [0, 1, 2, 0, 2, 3],
          provenance: { format: 'LandXML', fileName: 't.xml', surfaceName: 's' },
        },
      },
      cachedRevision: null,
    };
    return { project: { ...project, surfaces: [surface] }, surfaceId: surface.id };
  };

  it('rejects native source-definition mutations but allows final-mesh edits', () => {
    const { project, surfaceId } = importedProject();
    const snapshot = createCadHistoryState(project).present;
    const rejected: CadCommand[] = [
      { key: 'SURFACE_ADD_POINTS', surfaceId, pointIds: ['pt-a'] },
      { key: 'SURFACE_REMOVE_SOURCE', surfaceId },
      { key: 'SURFACE_ADD_POINT_GROUP', surfaceId, pointGroupId: 'g' },
      { key: 'SURFACE_REMOVE_POINT_GROUP', surfaceId, pointGroupId: 'g' },
      { key: 'SURFACE_ADD_BREAKLINE', surfaceId, pointIds: ['pt-a', 'pt-c'] },
      { key: 'SURFACE_REMOVE_BREAKLINE', surfaceId, breaklineId: 'bl-1' },
      { key: 'SURFACE_RENAME_BREAKLINE', surfaceId, breaklineId: 'bl-1', name: 'X' },
      { key: 'SURFACE_BREAKLINE_INSERT_POINT', surfaceId, breaklineId: 'bl-1', pointEntityId: 'pt-b', insertIndex: 1 },
      { key: 'SURFACE_BREAKLINE_REMOVE_POINT', surfaceId, breaklineId: 'bl-1', pointEntityId: 'pt-a' },
      { key: 'SURFACE_BREAKLINE_REVERSE', surfaceId, breaklineId: 'bl-1' },
      { key: 'SURFACE_BREAKLINE_REPLACE_CHAIN', surfaceId, breaklineId: 'bl-1', pointEntityIds: ['pt-a', 'pt-c'] },
      { key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN', surfaceId, breaklineId: 'bl-1' },
      { key: 'SURFACE_ADD_BOUNDARY', surfaceId, kind: 'outer', sourceEntityId: 'ring' },
      { key: 'SURFACE_REMOVE_BOUNDARY', surfaceId, kind: 'outer' },
    ];
    for (const command of rejected) {
      expect(executeCadCommand(snapshot, command)).toBeNull();
    }
    const surface = surfaceOf(project, surfaceId);
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const allowed = executeCadCommand(snapshot, {
      key: 'SURFACE_ADD_EDIT',
      surfaceId,
      edit: { kind: 'add-point', x: 5, y: 5, z: 2 },
      expectedRevision: revision,
    });
    expect(allowed).not.toBeNull();
  });
});
