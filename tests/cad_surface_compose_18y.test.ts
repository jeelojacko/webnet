/**
 * Phase 18Y exact two-surface composition transaction pins (agent tier).
 *
 * Covers SURFCOMPOSE (composite copy) + SURFCOMPOSEPASTE (paste in place):
 * same-source / CURRENT / revision-race / empty-result / layer-lock gates,
 * source immutability, target identity, provenance, one undo entry,
 * native-definition undo + precomputed redos, and dependent staleness.
 */
import { describe, expect, it } from 'vitest';

import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
} from '../src/engine/cad/cadSurfaces';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { computeAnalysisGeometryRevision } from '../src/engine/cad/cadAnalysisRevision';
import { deriveAnalysisStatus } from '../src/engine/cad/cadAnalysisStatus';
import { deriveCadSectionStatus } from '../src/engine/cad/cadSectionStatus';
import { deriveSurfaceProfileStatus } from '../src/engine/cad/cadProfileStatus';
import { deriveSurfaceContourStatus } from '../src/engine/cad/surfaceContourStatus';
import {
  computeVolumeSurfaceRevision,
  deriveVolumeSurfaceStatus,
} from '../src/engine/cad/cadVolumeSurfaces';
import {
  SURFACE_COMPOSE_SAME_SOURCE,
} from '../src/engine/cad/cadTransactionsSurfaceComposeCommands';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const POINTS: CadSurveyPointEntity[] = [
  { id: 'b1', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B1', x: 0, y: 0, z: 10, pointClass: 'free', source: 'parsed-input' },
  { id: 'b2', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B2', x: 10, y: 0, z: 11, pointClass: 'free', source: 'parsed-input' },
  { id: 'b3', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B3', x: 10, y: 10, z: 12, pointClass: 'free', source: 'parsed-input' },
  { id: 'b4', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'B4', x: 0, y: 10, z: 13, pointClass: 'free', source: 'parsed-input' },
  { id: 'o1', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'O1', x: 20, y: 0, z: 20, pointClass: 'free', source: 'parsed-input' },
  { id: 'o2', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'O2', x: 30, y: 0, z: 21, pointClass: 'free', source: 'parsed-input' },
  { id: 'o3', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'O3', x: 30, y: 10, z: 22, pointClass: 'free', source: 'parsed-input' },
  { id: 'o4', type: 'survey-point', layerId: 'points', visible: true, locked: false, stationId: 'O4', x: 20, y: 10, z: 23, pointClass: 'free', source: 'parsed-input' },
];

const projectWithTwoSurfaces = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Compose 18Y', units: 'm' });
  return {
    ...drawing.project,
    entities: POINTS,
    surfaces: [
      {
        id: 'base-1',
        name: 'Base',
        layerId: 'general',
        styleId: 'style-base',
        definition: { pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3', 'b4'] } },
        cachedRevision: null,
      },
      {
        id: 'overlay-1',
        name: 'Overlay',
        layerId: 'general',
        definition: { pointSource: { kind: 'points', pointEntityIds: ['o1', 'o2', 'o3', 'o4'] } },
        cachedRevision: null,
      },
    ],
  };
};

const surfaceOf = (project: CadProject, id: string) =>
  project.surfaces!.find((entry) => entry.id === id)!;

const revOf = (project: CadProject, id: string): string =>
  computeCadSurfaceSourceRevision(project, surfaceOf(project, id));

/** Valid CCW triangle the transaction stores verbatim. */
const COMPOSED_VERTICES = [0, 0, 10.5, 10, 0, 11, 0, 10, 12.5];
const COMPOSED_FACES = [0, 1, 2];

const composeCopy = (
  project: CadProject,
  overrides: Partial<Extract<CadCommand, { key: 'SURFCOMPOSE' }>> = {},
): Extract<CadCommand, { key: 'SURFCOMPOSE' }> => ({
  key: 'SURFCOMPOSE',
  baseSurfaceId: 'base-1',
  baseExpectedRevision: revOf(project, 'base-1'),
  overlaySurfaceId: 'overlay-1',
  overlayExpectedRevision: revOf(project, 'overlay-1'),
  vertices: [...COMPOSED_VERTICES],
  faces: [...COMPOSED_FACES],
  policy: 'overlay-coverage-wins',
  sessionCurrent: true,
  ...overrides,
});

const composePaste = (
  project: CadProject,
  overrides: Partial<Extract<CadCommand, { key: 'SURFCOMPOSEPASTE' }>> = {},
): Extract<CadCommand, { key: 'SURFCOMPOSEPASTE' }> => ({
  key: 'SURFCOMPOSEPASTE',
  targetSurfaceId: 'base-1',
  targetExpectedRevision: revOf(project, 'base-1'),
  sourceSurfaceId: 'overlay-1',
  sourceExpectedRevision: revOf(project, 'overlay-1'),
  vertices: [...COMPOSED_VERTICES],
  faces: [...COMPOSED_FACES],
  policy: 'overlay-coverage-wins',
  sessionCurrent: true,
  ...overrides,
});

const withPersistedCurrent = (project: CadProject): CadProject => ({
  ...project,
  surfaces: project.surfaces!.map((surf) => ({
    ...surf,
    cachedRevision: computeCadSurfaceSourceRevision(project, surf),
  })),
});

// ---------------------------------------------------------------------------
// SURFCOMPOSE (composite copy)
// ---------------------------------------------------------------------------

describe('18Y SURFCOMPOSE copy', () => {
  it('appends a uniquely named explicit composite and mutates neither source', () => {
    const project = projectWithTwoSurfaces();
    const history = createCadHistoryState(project);
    const baseBefore = JSON.stringify(surfaceOf(project, 'base-1'));
    const overlayBefore = JSON.stringify(surfaceOf(project, 'overlay-1'));

    const next = runCadCommand(history, composeCopy(project));
    expect(next).not.toBe(history);
    const surfaces = next.present.project.surfaces!;
    expect(surfaces).toHaveLength(3);
    const copy = surfaces.find((entry) => entry.id !== 'base-1' && entry.id !== 'overlay-1')!;
    expect(copy.name).toBe('Base + Overlay - Composite');
    expect(copy.definition.sourceKind).toBe('explicit-tin');
    expect(copy.definition.pointSource).toEqual({ kind: 'points', pointEntityIds: [] });
    expect(copy.definition.importedTin!.vertices).toEqual(COMPOSED_VERTICES);
    expect(copy.definition.importedTin!.faces).toEqual(COMPOSED_FACES);
    expect(copy.definition.importedTin!.provenance).toMatchObject({
      kind: 'webnet-compose',
      baseSurfaceId: 'base-1',
      baseSurfaceName: 'Base',
      overlaySurfaceId: 'overlay-1',
      overlaySurfaceName: 'Overlay',
      policy: 'overlay-coverage-wins',
    });
    // Layer/style come from Base.
    expect(copy.layerId).toBe('general');
    expect(copy.styleId).toBe('style-base');
    expect(copy.cachedRevision).toBeNull();
    // Sources byte-identical.
    expect(JSON.stringify(surfaceOf(next.present.project, 'base-1'))).toBe(baseBefore);
    expect(JSON.stringify(surfaceOf(next.present.project, 'overlay-1'))).toBe(overlayBefore);
    // One undo entry restores the pre-copy project exactly.
    expect(next.undoStack).toHaveLength(1);
    expect(undoCadHistory(next).present.project).toEqual(project);
  });

  it('rebuilds the stored composite to the composed topology', () => {
    const project = projectWithTwoSurfaces();
    const history = createCadHistoryState(project);
    const next = runCadCommand(history, composeCopy(project));
    const copy = next.present.project.surfaces!.find(
      (entry) => entry.id !== 'base-1' && entry.id !== 'overlay-1',
    )!;
    const built = buildCadSurface(next.present.project, copy);
    expect(built.outcome).toBe('ok');
    expect(built.triangles).toHaveLength(1);
    expect(built.points.map((point) => [point.x, point.y, point.z])).toEqual([
      [0, 0, 10.5],
      [10, 0, 11],
      [0, 10, 12.5],
    ]);
  });

  it('deconflicts a repeated composite name', () => {
    const project = projectWithTwoSurfaces();
    const first = runCadCommand(createCadHistoryState(project), composeCopy(project));
    const second = runCadCommand(first, composeCopy(first.present.project));
    const names = second.present.project.surfaces!.map((entry) => entry.name);
    expect(names).toContain('Base + Overlay - Composite');
    expect(names).toContain('Base + Overlay - Composite (2)');
  });
});

// ---------------------------------------------------------------------------
// SURFCOMPOSEPASTE (paste in place)
// ---------------------------------------------------------------------------

describe('18Y SURFCOMPOSEPASTE', () => {
  it('keeps target identity, replaces its definition, and leaves the source byte-identical', () => {
    const project = projectWithTwoSurfaces();
    const history = createCadHistoryState(project);
    const targetBefore = surfaceOf(project, 'base-1');
    const sourceBefore = JSON.stringify(surfaceOf(project, 'overlay-1'));

    const next = runCadCommand(history, composePaste(project));
    expect(next).not.toBe(history);
    const target = surfaceOf(next.present.project, 'base-1');
    expect(target.id).toBe('base-1');
    expect(target.name).toBe('Base');
    expect(target.layerId).toBe('general');
    expect(target.styleId).toBe('style-base');
    expect(target.definition.sourceKind).toBe('explicit-tin');
    expect(target.definition.pointSource).toEqual({ kind: 'points', pointEntityIds: [] });
    expect(target.definition.breaklines).toBeUndefined();
    expect(target.definition.edits).toBeUndefined();
    expect(target.definition.importedTin!.faces).toEqual(COMPOSED_FACES);
    expect(target.definition.importedTin!.provenance.kind).toBe('webnet-compose');
    expect(target.cachedRevision).toBeNull();
    expect(JSON.stringify(surfaceOf(next.present.project, 'overlay-1'))).toBe(sourceBefore);

    // Undo restores the full native definition; redo restores the stored payload (no recompute).
    const undone = undoCadHistory(next);
    expect(undone.present.project).toEqual(project);
    expect(surfaceOf(undone.present.project, 'base-1')).toEqual(targetBefore);
    const redone = redoCadHistory(undone);
    expect(redone.present.project).toEqual(next.present.project);
  });
});

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe('18Y compose gates', () => {
  it('rejects the same surface used as both sources', () => {
    const project = projectWithTwoSurfaces();
    const history = createCadHistoryState(project);
    expect(
      runCadCommand(history, composeCopy(project, { overlaySurfaceId: 'base-1' })),
    ).toBe(history);
    expect(
      runCadCommand(history, composePaste(project, { sourceSurfaceId: 'base-1' })),
    ).toBe(history);
    expect(SURFACE_COMPOSE_SAME_SOURCE).toContain('different surfaces');
  });

  it('requires CURRENT (persisted or session-owned) for both sources', () => {
    const project = projectWithTwoSurfaces();
    const history = createCadHistoryState(project);
    // Neither persisted CURRENT nor sessionCurrent -> UNBUILT, fail closed.
    expect(
      runCadCommand(history, composeCopy(project, { sessionCurrent: undefined })),
    ).toBe(history);
    // Persisted CURRENT is enough without the session assertion.
    const current = withPersistedCurrent(project);
    const currentHistory = createCadHistoryState(current);
    const committed = runCadCommand(
      currentHistory,
      composeCopy(current, { sessionCurrent: undefined }),
    );
    expect(committed).not.toBe(currentHistory);
  });

  it('discards a worker result whose source revision moved (race gate)', () => {
    const project = projectWithTwoSurfaces();
    const staleBase = revOf(project, 'base-1');
    // Worker ran against `staleBase`; the base definition then moved.
    const moved: CadProject = {
      ...project,
      surfaces: project.surfaces!.map((entry) =>
        entry.id === 'base-1'
          ? { ...entry, definition: { pointSource: { kind: 'points', pointEntityIds: ['b1', 'b2', 'b3'] } } }
          : entry,
      ),
    };
    const movedHistory = createCadHistoryState(moved);
    expect(
      runCadCommand(
        movedHistory,
        composeCopy(moved, {
          baseSurfaceId: 'base-1',
          baseExpectedRevision: staleBase,
          sessionCurrent: true,
        }),
      ),
    ).toBe(movedHistory);
  });

  it('rejects an empty composed result', () => {
    const project = projectWithTwoSurfaces();
    const history = createCadHistoryState(project);
    expect(runCadCommand(history, composeCopy(project, { faces: [] }))).toBe(history);
    expect(runCadCommand(history, composePaste(project, { faces: [] }))).toBe(history);
  });

  it('blocks paste when the target layer is locked', () => {
    const project = projectWithTwoSurfaces();
    const locked: CadProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'general' ? { ...layer, locked: true } : layer,
      ),
    };
    expect(runCadCommand(createCadHistoryState(locked), composePaste(locked))).toEqual(
      createCadHistoryState(locked),
    );
  });
});

// ---------------------------------------------------------------------------
// Dependent staleness after paste
// ---------------------------------------------------------------------------

describe('18Y dependent staleness after paste', () => {
  it('stales profile/section/contours/volume/analysis via the new target revision', () => {
    const bands = [
      { id: 'low', lower: 0, upper: 12, color: '#111111' },
      { id: 'high', lower: 12, upper: 60, color: '#222222' },
    ];
    const project = projectWithTwoSurfaces();
    const oldRevision = revOf(project, 'base-1');
    const next = runCadCommand(createCadHistoryState(project), composePaste(project));
    const pasted = next.present.project;
    const target = surfaceOf(pasted, 'base-1');
    const newRevision = computeCadSurfaceSourceRevision(pasted, target);
    expect(newRevision).not.toBe(oldRevision);
    expect(deriveSurfaceStatus(pasted, target)).toBe('UNBUILT');

    expect(
      deriveSurfaceContourStatus({ tinCurrent: false, building: false, cacheHit: true, hasStale: true }).stale,
    ).toBe(true);
    expect(
      deriveSurfaceProfileStatus({
        profileExists: true,
        alignmentExists: true,
        surfaceStatus: 'UNBUILT',
        surfaceRevisionAtBuild: oldRevision,
        currentSurfaceRevision: newRevision,
        hasResult: true,
        building: false,
      }),
    ).toBe('SOURCE_NOT_CURRENT');
    expect(
      deriveCadSectionStatus({
        groupExists: true,
        lineExists: true,
        alignmentExists: true,
        surfaceExists: true,
        surfaceStatus: 'UNBUILT',
        surfaceRevisionAtBuild: oldRevision,
        currentSurfaceRevision: newRevision,
        hasResult: true,
        building: false,
        outOfRange: false,
      }),
    ).toBe('SOURCE_NOT_CURRENT');

    const volSurface = {
      id: 'vol-1',
      name: 'Earthwork',
      baseSurfaceId: 'base-1',
      comparisonSurfaceId: 'overlay-1',
    };
    const volRevision = computeVolumeSurfaceRevision({
      baseId: 'base-1',
      baseRev: oldRevision,
      cmpId: 'overlay-1',
      cmpRev: revOf(project, 'overlay-1'),
    });
    expect(
      deriveVolumeSurfaceStatus(pasted, volSurface, {
        building: false,
        result: { revision: volRevision } as never,
      }),
    ).toBe('SOURCE_NOT_CURRENT');

    const map = {
      id: 'amap',
      name: 'Elevation',
      source: { kind: 'surface', surfaceId: 'base-1', metric: 'elevation' },
      bands,
      opacity: 0.5,
    } as never;
    const geometryRevision = computeAnalysisGeometryRevision(map, { surfaceRevision: oldRevision });
    expect(
      deriveAnalysisStatus(map, { found: true, status: 'UNBUILT' }, true, geometryRevision, geometryRevision),
    ).toBe('SOURCE_NOT_CURRENT');
  });
});
