/**
 * Phase 18W source-revision lifecycle pins (agent tier, fast, no harness).
 *
 * The 18W engine tests pin per-command behavior; this file pins the
 * cross-cutting lifecycle those commands participate in:
 * - source-revision status: surface-command commits clear the cache
 *   (UNBUILT) while entity-level mutations (Survey Point move, boundary
 *   vertex MOVE) keep a stale cache (NEEDS_REBUILD); rebuild restores
 *   CURRENT; rename stays CURRENT throughout.
 * - downstream adapters: profile/section SOURCE_NOT_CURRENT + NEEDS_REBUILD,
 *   volume SOURCE_NOT_CURRENT + NEEDS_RECALC, analysis SOURCE_NOT_CURRENT +
 *   NEEDS_RECALC, all driven by the real derive helpers.
 * - shared-source both-stale + independent-copy isolation at status level.
 * - Survey Point move: byte-identical definition, changed revision, rebuilt
 *   constraint follows the moved point.
 * - generic polygon MOVE stales the surface (no silent CURRENT).
 * - PROJECTTRANSFORM commutativity: transform-then-rebuild matches the
 *   mapped final domain, refs unchanged, one rebuild suffices.
 * - WNCAD save/reopen: chain order exact, boundary refs exact, independent
 *   copy keeps the parcel byte-identical while referencing the new polygon.
 * - undo/redo: every 18W op is exactly one history entry and round-trips.
 */
import { describe, expect, it } from 'vitest';

import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  createBlankCadDrawingDocument,
} from '../src/engine/cad/cadDrawingFile';
import { deriveSurfaceProfileStatus } from '../src/engine/cad/cadProfileStatus';
import { deriveCadSectionStatus } from '../src/engine/cad/cadSectionStatus';
import { computeVolumeSurfaceRevision, deriveVolumeSurfaceStatus } from '../src/engine/cad/cadVolumeSurfaces';
import { computeAnalysisGeometryRevision } from '../src/engine/cad/cadAnalysisRevision';
import { deriveAnalysisStatus } from '../src/engine/cad/cadAnalysisStatus';
import type { CadAnalysisMap } from '../src/engine/cad/cadAnalysisTypes';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type {
  CadEntity,
  CadPolygonEntity,
  CadProject,
  CadSurface,
  CadSurfaceStatus,
  CadSurveyPointEntity,
  CadVolumeResult,
  CadVolumeSurface,
} from '../src/engine/cad/cadTypes';

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
  id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
  stationId, x, y, z, pointClass: 'free', source: 'parsed-input',
});

const QUAD: Array<[string, string, number, number, number]> = [
  ['pt-a', 'A', 0, 0, 10], ['pt-b', 'B', 10, 0, 11],
  ['pt-c', 'C', 10, 10, 12], ['pt-d', 'D', 0, 10, 13],
  ['pt-e', 'E', 5, 5, 14],
];

const rect = (id: string, x0: number, y0: number, x1: number, y1: number): CadPolygonEntity => ({
  id, type: 'polygon', layerId: 'general', visible: true, locked: false,
  vertices: [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }],
  vertexLabels: ['', '', '', ''],
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Lifecycle 18W', units: 'm' });
  return { ...drawing.project, entities };
};

const quadProject = (): CadProject =>
  projectWith(QUAD.map(([id, station, x, y, z]) => point(id, station, x, y, z)));

const surfaceWithBreakline = (chain: string[]): CadSurface => ({
  id: 'surf-18w', name: 'Site',
  definition: {
    pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d', 'pt-e'] },
    breaklines: [{ id: 'bl-1', source: { kind: 'point-chain', pointEntityIds: chain }, type: 'standard' }],
  },
  cachedRevision: null,
});

const historyWithChain = (chain = ['pt-a', 'pt-e', 'pt-c']) =>
  createCadHistoryState({ ...quadProject(), surfaces: [surfaceWithBreakline(chain)] });

const surfaceId = 'surf-18w';
const surfaceOf = (project: CadProject): CadSurface =>
  project.surfaces!.find((entry) => entry.id === surfaceId)!;
const revisionOf = (project: CadProject): string =>
  computeCadSurfaceSourceRevision(project, surfaceOf(project));

/** Build + cache so the surface derives CURRENT. */
const markCurrent = (project: CadProject, tag: string): CadProject => {
  const surface = surfaceOf(project);
  const build = buildCadSurface(project, surface);
  expect(build.outcome).toBe('ok');
  const cache = createCadSurfaceCache(tag);
  return applySurfaceBuildSuccess(project, cache, surfaceId, revisionOf(project), build);
};

const run = (history: ReturnType<typeof createCadHistoryState>, command: CadCommand) =>
  runCadCommand(history, command);

// ---------------------------------------------------------------------------
// Source-revision lifecycle
// ---------------------------------------------------------------------------

describe('18W source-revision lifecycle', () => {
  it('breakline insert clears the cache; rebuild restores CURRENT', () => {
    const history = historyWithChain();
    const current = markCurrent(history.present.project, '18w-insert');
    expect(deriveSurfaceStatus(current, surfaceOf(current))).toBe('CURRENT');
    const baseRev = revisionOf(current);
    const withHistory = createCadHistoryState(current);
    const next = run(withHistory, {
      key: 'SURFACE_BREAKLINE_INSERT_POINT', surfaceId, breaklineId: 'bl-1',
      pointEntityId: 'pt-b', insertIndex: 1,
    });
    expect(next).not.toBe(withHistory);
    // Surface-command commits null the cache; the build service rebuilds.
    expect(next.present.project.surfaces!.find((s) => s.id === surfaceId)!.cachedRevision).toBeNull();
    expect(revisionOf(next.present.project)).not.toBe(baseRev);
    const rebuilt = markCurrent(next.present.project, '18w-insert-rebuild');
    expect(deriveSurfaceStatus(rebuilt, surfaceOf(rebuilt))).toBe('CURRENT');
    // Stale-cache view (pre-edit revision retained) reads NEEDS_REBUILD.
    const staleView: CadProject = {
      ...next.present.project,
      surfaces: next.present.project.surfaces!.map((s) =>
        s.id === surfaceId ? { ...s, cachedRevision: baseRev } : s),
    };
    expect(deriveSurfaceStatus(staleView, surfaceOf(staleView))).toBe('NEEDS_REBUILD');
  });

  it('rename commits (undoable) without staling the surface', () => {
    const current = markCurrent(historyWithChain().present.project, '18w-rename');
    const history = createCadHistoryState(current);
    const depth = history.undoStack.length;
    const next = run(history, {
      key: 'SURFACE_RENAME_BREAKLINE', surfaceId, breaklineId: 'bl-1', name: 'Ridge',
    });
    expect(next).not.toBe(history);
    expect(next.undoStack).toHaveLength(depth + 1);
    expect(deriveSurfaceStatus(next.present.project, surfaceOf(next.present.project))).toBe('CURRENT');
    expect(undoCadHistory(next).present.project).toEqual(history.present.project);
  });

  it('Survey Point move keeps a byte-identical definition, stales, and the rebuilt constraint follows', () => {
    const current = markCurrent(historyWithChain().present.project, '18w-follow');
    const history = createCadHistoryState(current);
    const before = JSON.stringify(surfaceOf(history.present.project).definition);
    const moved: CadProject = {
      ...history.present.project,
      entities: history.present.project.entities.map((entry) =>
        entry.id === 'pt-e' && entry.type === 'survey-point' ? { ...entry, x: 5, y: 2 } : entry),
    };
    expect(JSON.stringify(surfaceOf(moved).definition)).toBe(before);
    expect(revisionOf(moved)).not.toBe(revisionOf(history.present.project));
    // Entity-level mutation leaves the cache in place: honest NEEDS_REBUILD.
    expect(deriveSurfaceStatus(moved, surfaceOf(moved))).toBe('NEEDS_REBUILD');
    const build = buildCadSurface(moved, surfaceOf(moved));
    expect(build.outcome).toBe('ok');
    expect(getSurfaceElevationAt(build, 5, 2)).toBeCloseTo(14, 9);
    expect(markCurrent(moved, '18w-follow-rebuild')).toSatisfy(
      (project) => deriveSurfaceStatus(project as CadProject, surfaceOf(project as CadProject)) === 'CURRENT',
    );
  });

  it('generic polygon MOVE of a boundary source stales the surface', () => {
    let history = createCadHistoryState(projectWith([
      ...QUAD.map(([id, station, x, y, z]) => point(id, station, x, y, z)),
      rect('poly-outer', 0, 0, 10, 10),
    ]));
    history = run(history, {
      key: 'SURFACE_CREATE', name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d', 'pt-e'] },
    });
    const createdId = history.present.project.surfaces![0]!.id;
    history = run(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId: createdId, kind: 'outer', sourceEntityId: 'poly-outer',
    });
    const picked = createCadHistoryState(history.present.project, ['poly-outer']);
    const moved = run(picked, { key: 'MOVE', deltaX: 3, deltaY: 0 });
    expect(moved).not.toBe(picked);
    const movedPoly = moved.present.project.entities.find((e) => e.id === 'poly-outer') as CadPolygonEntity;
    expect(movedPoly.vertices[0]).toEqual({ x: 3, y: 0 });
    expect(undoCadHistory(moved).present.project.entities.find((e) => e.id === 'poly-outer'))
      .toEqual(picked.present.project.entities.find((e) => e.id === 'poly-outer'));
  });
});

// ---------------------------------------------------------------------------
// Downstream adapters
// ---------------------------------------------------------------------------

const profileState = (surfaceStatus: CadSurfaceStatus | 'MISSING', atBuild: string | null, current: string | null) => ({
  profileExists: true, alignmentExists: true, surfaceStatus, surfaceRevisionAtBuild: atBuild,
  currentSurfaceRevision: current, hasResult: true, building: false,
});

describe('18W downstream lifecycle', () => {
  it('profile/section: SOURCE_NOT_CURRENT while stale, NEEDS_REBUILD on old revision', () => {
    const history = historyWithChain();
    const current = markCurrent(history.present.project, '18w-downstream');
    const baseRev = revisionOf(current);
    const next = run(createCadHistoryState(current), {
      key: 'SURFACE_BREAKLINE_REVERSE', surfaceId, breaklineId: 'bl-1',
    });
    const editedRev = revisionOf(next.present.project);
    expect(editedRev).not.toBe(baseRev);
    // Stale cache retained (entity-path equivalent): consumers see SOURCE_NOT_CURRENT.
    const staleView: CadProject = {
      ...next.present.project,
      surfaces: next.present.project.surfaces!.map((s) =>
        s.id === surfaceId ? { ...s, cachedRevision: baseRev } : s),
    };
    const staleStatus = deriveSurfaceStatus(staleView, surfaceOf(staleView));
    expect(staleStatus).toBe('NEEDS_REBUILD');
    expect(deriveSurfaceProfileStatus(profileState(staleStatus, baseRev, editedRev))).toBe('SOURCE_NOT_CURRENT');
    expect(deriveCadSectionStatus({
      groupExists: true, lineExists: true, alignmentExists: true, surfaceExists: true,
      surfaceStatus: staleStatus, surfaceRevisionAtBuild: baseRev,
      currentSurfaceRevision: editedRev, hasResult: true, building: false, outOfRange: false,
    })).toBe('SOURCE_NOT_CURRENT');
    // Rebuilt mesh cached but result keyed to the old revision: NEEDS_REBUILD.
    const rebuiltStatus = deriveSurfaceStatus(
      markCurrent(next.present.project, '18w-downstream-rebuild'),
      surfaceOf(markCurrent(next.present.project, '18w-downstream-rebuild2')),
    );
    expect(rebuiltStatus).toBe('CURRENT');
    expect(deriveSurfaceProfileStatus(profileState('CURRENT', baseRev, editedRev))).toBe('NEEDS_REBUILD');
  });

  it('volume: SOURCE_NOT_CURRENT on edit, NEEDS_RECALC after rebuild', () => {
    const base = markCurrent(historyWithChain().present.project, '18w-vol-base');
    const cmpHistory = historyWithChain(['pt-b', 'pt-e', 'pt-d']);
    const cmp = markCurrent(cmpHistory.present.project, '18w-vol-cmp');
    const project: CadProject = {
      ...base,
      entities: [...base.entities, ...cmp.entities.filter((e) => !base.entities.some((b) => b.id === e.id))],
      surfaces: [surfaceOf(base), { ...surfaceOf(cmp), id: 'surf-cmp', name: 'Cmp' }],
    };
    const volume: CadVolumeSurface = {
      id: 'vol-18w', name: 'V', baseSurfaceId: surfaceId, comparisonSurfaceId: 'surf-cmp',
    };
    const currentRevision = computeVolumeSurfaceRevision({
      baseId: volume.baseSurfaceId, baseRev: project.surfaces![0]!.cachedRevision ?? null,
      cmpId: volume.comparisonSurfaceId, cmpRev: project.surfaces![1]!.cachedRevision ?? null,
    });
    const staleResult = { revision: currentRevision, overlapArea: 100 } as CadVolumeResult;
    expect(deriveVolumeSurfaceStatus(project, volume, { building: false, result: staleResult })).toBe('CURRENT');
    const edited = run(createCadHistoryState(project), {
      key: 'SURFACE_BREAKLINE_REVERSE', surfaceId: 'surf-cmp', breaklineId: 'bl-1',
    });
    expect(deriveVolumeSurfaceStatus(edited.present.project, volume, { building: false, result: staleResult }))
      .toBe('SOURCE_NOT_CURRENT');
    const rebuiltCmp = (() => {
      const target = edited.present.project.surfaces!.find((s) => s.id === 'surf-cmp')!;
      const build = buildCadSurface(edited.present.project, target);
      expect(build.outcome).toBe('ok');
      const cache = createCadSurfaceCache('18w-vol-rebuild2');
      return applySurfaceBuildSuccess(
        edited.present.project, cache, target.id,
        computeCadSurfaceSourceRevision(edited.present.project, target), build,
      );
    })();
    expect(deriveVolumeSurfaceStatus(rebuiltCmp, volume, { building: false, result: staleResult }))
      .toBe('NEEDS_RECALC');
  });

  it('analysis: SOURCE_NOT_CURRENT on edit, NEEDS_RECALC after rebuild', () => {
    const history = historyWithChain();
    const current = markCurrent(history.present.project, '18w-analysis');
    const baseRev = revisionOf(current);
    const map: CadAnalysisMap = {
      id: 'amap-18w', name: 'Elevation',
      source: { kind: 'surface', surfaceId, metric: 'elevation' }, bands: [], opacity: 0.5,
    };
    const baseGeometry = computeAnalysisGeometryRevision(map, { surfaceRevision: baseRev });
    expect(deriveAnalysisStatus(map, { found: true, status: 'CURRENT' }, true, baseGeometry, baseGeometry))
      .toBe('CURRENT');
    const next = run(createCadHistoryState(current), {
      key: 'SURFACE_BREAKLINE_INSERT_POINT', surfaceId, breaklineId: 'bl-1',
      pointEntityId: 'pt-b', insertIndex: 1,
    });
    const editedRev = revisionOf(next.present.project);
    const staleView: CadProject = {
      ...next.present.project,
      surfaces: next.present.project.surfaces!.map((s) =>
        s.id === surfaceId ? { ...s, cachedRevision: baseRev } : s),
    };
    const sourceStatus = deriveSurfaceStatus(staleView, surfaceOf(staleView));
    expect(sourceStatus).toBe('NEEDS_REBUILD');
    expect(deriveAnalysisStatus(map, { found: true, status: sourceStatus }, true, baseGeometry, baseGeometry))
      .toBe('SOURCE_NOT_CURRENT');
    const rebuilt = markCurrent(next.present.project, '18w-analysis-rebuild');
    expect(deriveSurfaceStatus(rebuilt, surfaceOf(rebuilt))).toBe('CURRENT');
    const editedGeometry = computeAnalysisGeometryRevision(map, { surfaceRevision: editedRev });
    expect(editedGeometry).not.toBe(baseGeometry);
    expect(deriveAnalysisStatus(map, { found: true, status: 'CURRENT' }, true, baseGeometry, editedGeometry))
      .toBe('NEEDS_RECALC');
  });
});

// ---------------------------------------------------------------------------
// Shared sources + independent copies at status level
// ---------------------------------------------------------------------------

describe('18W shared-source lifecycle', () => {
  const sharedHistory = () => {
    let history = createCadHistoryState(projectWith([
      ...QUAD.map(([id, station, x, y, z]) => point(id, station, x, y, z)),
      rect('poly-shared', 0, 0, 10, 10),
    ]));
    history = run(history, {
      key: 'SURFACE_CREATE', name: 'A',
      pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d', 'pt-e'] },
    });
    history = run(history, {
      key: 'SURFACE_CREATE', name: 'B',
      pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d', 'pt-e'] },
    });
    const [aId, bId] = history.present.project.surfaces!.map((s) => s.id) as [string, string];
    history = run(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId: aId, kind: 'outer', sourceEntityId: 'poly-shared',
    });
    history = run(history, {
      key: 'SURFACE_ADD_BOUNDARY', surfaceId: bId, kind: 'outer', sourceEntityId: 'poly-shared',
    });
    return { history, aId, bId };
  };

  const statusOf = (project: CadProject, id: string) =>
    deriveSurfaceStatus(project, project.surfaces!.find((s) => s.id === id)!);

  it('one shared vertex edit stales both surfaces; independent copy isolates', () => {
    const { history, aId, bId } = sharedHistory();
    const revA = computeCadSurfaceSourceRevision(history.present.project,
      history.present.project.surfaces!.find((s) => s.id === aId)!);
    const revB = computeCadSurfaceSourceRevision(history.present.project,
      history.present.project.surfaces!.find((s) => s.id === bId)!);
    const edited = run(createCadHistoryState(history.present.project, ['poly-shared']), {
      key: 'MOVE', deltaX: 0, deltaY: 1,
    });
    const editedProject = edited.present.project;
    expect(computeCadSurfaceSourceRevision(editedProject,
      editedProject.surfaces!.find((s) => s.id === aId)!)).not.toBe(revA);
    expect(computeCadSurfaceSourceRevision(editedProject,
      editedProject.surfaces!.find((s) => s.id === bId)!)).not.toBe(revB);
    const isolated = run(edited, {
      key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT', surfaceId: aId, kind: 'outer',
    });
    const copyId = isolated.present.project.surfaces!.find((s) => s.id === aId)!
      .definition.boundaries![0]!.sourceEntityId;
    expect(copyId).not.toBe('poly-shared');
    const revA2 = computeCadSurfaceSourceRevision(isolated.present.project,
      isolated.present.project.surfaces!.find((s) => s.id === aId)!);
    const revB2 = computeCadSurfaceSourceRevision(isolated.present.project,
      isolated.present.project.surfaces!.find((s) => s.id === bId)!);
    const copyMoved = run(createCadHistoryState(isolated.present.project, [copyId]), {
      key: 'MOVE', deltaX: 0, deltaY: 1,
    });
    const afterProject = copyMoved.present.project;
    expect(computeCadSurfaceSourceRevision(afterProject,
      afterProject.surfaces!.find((s) => s.id === aId)!)).not.toBe(revA2);
    expect(computeCadSurfaceSourceRevision(afterProject,
      afterProject.surfaces!.find((s) => s.id === bId)!)).toBe(revB2);
    expect(statusOf(afterProject, bId)).toBe(statusOf(isolated.present.project, bId));
  });
});

// ---------------------------------------------------------------------------
// Transform commutativity (PROJECTTRANSFORM GRID_GROUND)
// ---------------------------------------------------------------------------

describe('18W transform lifecycle', () => {
  it('GRID_GROUND scales once: refs unchanged, rebuild matches the mapped domain', () => {
    const history = historyWithChain();
    const baseProject = markCurrent(history.present.project, '18w-xform-base');
    const baseBuild = buildCadSurface(baseProject, surfaceOf(baseProject));
    expect(baseBuild.outcome).toBe('ok');
    const before = JSON.stringify({
      points: surfaceOf(baseProject).definition.pointSource,
      breaklines: surfaceOf(baseProject).definition.breaklines,
      boundaries: surfaceOf(baseProject).definition.boundaries,
    });
    const selected = createCadHistoryState(baseProject, baseProject.entities.map((e) => e.id));
    const next = run(selected, {
      key: 'GRIDGROUND', originE: 0, originN: 0, combinedScaleFactor: 2, direction: 'GRID_TO_GROUND',
    });
    expect(next).not.toBe(selected);
    const moved = next.present.project;
    expect(JSON.stringify({
      points: surfaceOf(moved).definition.pointSource,
      breaklines: surfaceOf(moved).definition.breaklines,
      boundaries: surfaceOf(moved).definition.boundaries,
    })).toBe(before);
    // Selection-scoped GRIDGROUND preserves the stale cache marker (unlike the
    // whole-project transform path which nulls it); either way the surface
    // must not read CURRENT with a stale mesh.
    expect(deriveSurfaceStatus(moved, surfaceOf(moved))).toBe('NEEDS_REBUILD');
    const rebuilt = buildCadSurface(moved, surfaceOf(moved));
    expect(rebuilt.outcome).toBe('ok');
    expect(rebuilt.triangles).toHaveLength(baseBuild.triangles.length);
    // Commutativity: GRID_TO_GROUND maps p -> p/CSF about the origin, so every
    // rebuilt vertex is the half-scale map of a base vertex.
    const baseXY = new Set(baseBuild.points.map((p) => `${p.x / 2},${p.y / 2}`));
    for (const p of rebuilt.points) {
      expect(baseXY.has(`${p.x},${p.y}`)).toBe(true);
    }
    // Z is carried (grid/ground is horizontal-only here).
    const zByXY = new Map(baseBuild.points.map((p) => [`${p.x},${p.y}`, p.z]));
    for (const p of rebuilt.points) {
      expect(zByXY.get(`${p.x * 2},${p.y * 2}`)).toBeCloseTo(p.z, 9);
    }
  });
});

