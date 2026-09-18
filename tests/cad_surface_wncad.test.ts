import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import {
  applySurfaceBuildFailure,
  applySurfaceBuildSuccess,
  createCadSurfaceCache,
} from '../src/engine/cad/cadSurfaceCache';
import { buildCadSurface, computeCadSurfaceSourceRevision, deriveSurfaceStatus } from '../src/engine/cad/cadSurfaces';
import { backfillCadSurfaceStyles } from '../src/engine/cad/cadSurfaceStyles';
import { isSurfaceDisplayVisible } from '../src/engine/cad/cadSurfaceTypes';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import { buildCadProjectSignature } from '../src/engine/cad/cadProjectState';
import { createCadHistoryState, redoCadHistory, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

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

const projectWithQuad = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Surface Drawing', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('pt-1', 'A', 0, 0, 10),
      point('pt-2', 'B', 10, 0, 11),
      point('pt-3', 'C', 10, 10, 12),
      point('pt-4', 'D', 0, 10, 13),
      {
        id: 'ring-outer',
        type: 'polyline',
        layerId: 'parcels',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        vertexLabels: [],
        closed: true,
      },
    ],
  };
};

const surfaceIdOf = (project: CadProject): string => {
  const surfaces = project.surfaces ?? [];
  expect(surfaces).toHaveLength(1);
  return surfaces[0]!.id;
};

const buildSurfaceWithParts = (): CadProject => {
  let history = createCadHistoryState(projectWithQuad());
  history = runCadCommand(history, {
    key: 'SURFACE_CREATE',
    name: 'Site',
    pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
  });
  const surfaceId = surfaceIdOf(history.present.project);
  history = runCadCommand(history, {
    key: 'SURFACE_ADD_POINT_GROUP',
    surfaceId,
    pointGroupId: 'point-group-all',
  });
  history = runCadCommand(history, {
    key: 'SURFACE_ADD_BREAKLINE',
    surfaceId,
    pointIds: ['pt-1', 'pt-3'],
    name: 'Ridge',
  });
  history = runCadCommand(history, {
    key: 'SURFACE_ADD_BOUNDARY',
    surfaceId,
    kind: 'outer',
    sourceEntityId: 'ring-outer',
  });
  return history.present.project;
};

describe('CAD surface WNCAD persistence', () => {
  it('round-trips surface + group source + breakline + boundary definitions identically', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Surface Drawing', units: 'm' });
    const project = buildSurfaceWithParts();
    const withProject = { ...drawing, project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(withProject));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.surfaces).toEqual(project.surfaces);
    expect(parsed.drawing.project.surfaceStyles).toEqual(project.surfaceStyles);
  });

  it('rebuilds canonical-identical meshes before and after save/reopen', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Surface Drawing', units: 'm' });
    const project = buildSurfaceWithParts();
    const surface = project.surfaces![0]!;
    const before = buildCadSurface(project, surface);
    expect(before.outcome).toBe('ok');

    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    const reopenedSurface = reopened.surfaces![0]!;
    const after = buildCadSurface(reopened, reopenedSurface);
    expect(after.outcome).toBe('ok');
    expect(after.triangles).toEqual(before.triangles);
    expect(after.points).toEqual(before.points);
    expect(computeCadSurfaceSourceRevision(reopened, reopenedSurface)).toBe(before.revision);
  });

  it('saves/reopens two group sources with canonical-identical rebuilds', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Surface Drawing', units: 'm' });
    let history = createCadHistoryState(projectWithQuad());
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const surfaceId = surfaceIdOf(history.present.project);
    history = runCadCommand(history, { key: 'SURFACE_ADD_POINT_GROUP', surfaceId, pointGroupId: 'point-group-all' });
    history = runCadCommand(history, { key: 'SURFACE_ADD_POINT_GROUP', surfaceId, pointGroupId: 'point-group-control' });
    const project = history.present.project;
    const before = buildCadSurface(project, project.surfaces![0]!);
    expect(before.outcome).toBe('ok');
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(reopened.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'point-group',
      pointGroupIds: ['point-group-all', 'point-group-control'],
    });
    const after = buildCadSurface(reopened, reopened.surfaces![0]!);
    expect(after.outcome).toBe('ok');
    expect(after.triangles).toEqual(before.triangles);
    expect(after.points).toEqual(before.points);
    expect(computeCadSurfaceSourceRevision(reopened, reopened.surfaces![0]!)).toBe(before.revision);
  });

  it('migrates a legacy single-group source to the one-element list on open', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Surface Drawing', units: 'm' });
    let history = createCadHistoryState(projectWithQuad());
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const project = history.present.project;
    // Hand-crafted legacy shape (pre-fix persisted form).
    const legacy = {
      ...project,
      surfaces: project.surfaces!.map((surface) => ({
        ...surface,
        definition: { pointSource: { kind: 'point-group' as const, pointGroupId: 'point-group-all' } },
      })),
    };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project: legacy }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(reopened.surfaces![0]!.definition.pointSource).toEqual({
      kind: 'point-group',
      pointGroupIds: ['point-group-all'],
    });
    const direct = buildCadSurface(project, project.surfaces![0]!);
    const migrated = buildCadSurface(reopened, reopened.surfaces![0]!);
    expect(migrated.triangles).toEqual(direct.triangles);
  });

  it('never persists mesh state: reopen derives UNBUILT, never false CURRENT', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Surface Drawing', units: 'm' });
    const project = buildSurfaceWithParts();
    const cache = createCadSurfaceCache('test');
    const surface = project.surfaces![0]!;
    const result = buildCadSurface(project, surface);
    expect(result.outcome).toBe('ok');
    const current = applySurfaceBuildSuccess(project, cache, surface.id, result.revision, result);
    expect(deriveSurfaceStatus(current, current.surfaces![0]!)).toBe('CURRENT');

    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project: current }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopenedSurface = parsed.drawing.project.surfaces![0]!;
    expect(reopenedSurface.cachedRevision).toBeNull();
    expect(deriveSurfaceStatus(parsed.drawing.project, reopenedSurface)).not.toBe('CURRENT');
    expect(deriveSurfaceStatus(parsed.drawing.project, reopenedSurface)).toBe('UNBUILT');
  });

  it('opens legacy drawings (no surface tables) with empty surfaces + seed styles', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Legacy', units: 'm' });
    const raw = JSON.parse(serializeCadDrawingFile(drawing)) as Record<string, unknown>;
    const project = raw['project'] as Record<string, unknown>;
    delete project['surfaces'];
    delete project['surfaceStyles'];
    const parsed = parseCadDrawingFile(JSON.stringify(raw));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.drawing.project.surfaces).toEqual([]);
    expect(backfillCadSurfaceStyles(parsed.drawing.project.surfaceStyles)).toHaveLength(4);
    expect(parsed.drawing.schemaVersion).toBe(2);
  });

  it('Save As copies share no aliases with the original drawing', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Surface Drawing', units: 'm' });
    const text = serializeCadDrawingFile({ ...drawing, project: buildSurfaceWithParts() });
    const first = parseCadDrawingFile(text);
    const second = parseCadDrawingFile(text);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    first.drawing.project.surfaces![0]!.name = 'Mutated';
    first.drawing.project.surfaces![0]!.definition.breaklines = [];
    expect(second.drawing.project.surfaces![0]!.name).toBe('Site');
    expect(second.drawing.project.surfaces![0]!.definition.breaklines).toHaveLength(1);
  });

  it('layer OFF hides the surface display without a rebuild', () => {
    const project = buildSurfaceWithParts();
    const surface = project.surfaces![0]!;
    expect(isSurfaceDisplayVisible(project, surface)).toBe(true);
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const hidden: CadProject = {
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === surface.layerId ? { ...layer, visible: false } : layer,
      ),
    };
    expect(isSurfaceDisplayVisible(hidden, surface)).toBe(false);
    expect(computeCadSurfaceSourceRevision(hidden, surface)).toBe(revision);
  });

  it('stale build results never mark the surface CURRENT', () => {
    const cache = createCadSurfaceCache('test');
    const project = buildSurfaceWithParts();
    const surface = project.surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const result = buildCadSurface(project, surface);
    const stale = applySurfaceBuildSuccess(project, cache, surface.id, `stale-${revision}`, result);
    expect(stale).toBe(project);
    expect(cache.get(surface.id, `stale-${revision}`)).toBeUndefined();
    const failed = applySurfaceBuildFailure(project, surface.id, `stale-${revision}`, 'boom');
    expect(failed).toBe(project);
    expect(failed.surfaces![0]!.buildDiagnostic).toBeUndefined();
  });

  it('supports undo/redo of breakline + boundary edits with revision following definition', () => {
    let history = createCadHistoryState(projectWithQuad());
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE',
      name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
    });
    const surfaceId = surfaceIdOf(history.present.project);
    const baseRevision = computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![0]!);
    history = runCadCommand(history, { key: 'SURFACE_ADD_BREAKLINE', surfaceId, pointIds: ['pt-1', 'pt-3'] });
    history = runCadCommand(history, { key: 'SURFACE_ADD_BOUNDARY', surfaceId, kind: 'outer', sourceEntityId: 'ring-outer' });
    const editedRevision = computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![0]!);
    expect(editedRevision).not.toBe(baseRevision);

    history = undoCadHistory(history);
    history = undoCadHistory(history);
    expect(history.present.project.surfaces![0]!.definition.breaklines ?? []).toHaveLength(0);
    expect(history.present.project.surfaces![0]!.definition.boundaries ?? []).toHaveLength(0);
    expect(computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![0]!)).toBe(baseRevision);

    history = redoCadHistory(history);
    history = redoCadHistory(history);
    expect(history.present.project.surfaces![0]!.definition.breaklines ?? []).toHaveLength(1);
    expect(history.present.project.surfaces![0]!.definition.boundaries ?? []).toHaveLength(1);
    expect(computeCadSurfaceSourceRevision(history.present.project, history.present.project.surfaces![0]!)).toBe(editedRevision);
  });

  it('blocks surface edits while the surface layer is locked', () => {
    let history = createCadHistoryState(projectWithQuad());
    history = runCadCommand(history, { key: 'SURFACE_CREATE', name: 'Site' });
    const surface = history.present.project.surfaces![0]!;
    history = runCadCommand(history, { key: 'LAYER_LOCKED', layerId: surface.layerId!, locked: true });
    const locked = history;
    const renamed = runCadCommand(locked, { key: 'SURFACE_RENAME', surfaceId: surface.id, name: 'Nope' });
    expect(renamed).toBe(locked);
    const edited = runCadCommand(locked, { key: 'SURFACE_ADD_POINTS', surfaceId: surface.id, pointIds: ['pt-1'] });
    expect(edited).toBe(locked);
    // Inspection still works while locked.
    expect(isSurfaceDisplayVisible(locked.present.project, surface)).toBe(true);
  });

  it('keeps persistence signatures settled across migrate + clone (key order)', () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Surface Drawing', units: 'm' });
    const project = buildSurfaceWithParts();
    const parsed = parseCadDrawingFile(serializeCadDrawingFile({ ...drawing, project }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    // The workspace sync guard compares JSON.stringify signatures: clone
    // must not move keys or every load looks dirty and clobbers UI state.
    expect(buildCadProjectSignature(cloneCadProject(reopened))).toBe(
      buildCadProjectSignature(reopened),
    );
    expect(Object.keys(cloneCadProject(reopened))).toEqual(Object.keys(reopened));
  });

  it('seeds the four default surface styles', () => {
    const styles = backfillCadSurfaceStyles(undefined);
    expect(styles.map((style) => style.name)).toEqual([
      'Triangles',
      'Triangles+Points',
      'Boundary',
      'No Display',
    ]);
  });
});
