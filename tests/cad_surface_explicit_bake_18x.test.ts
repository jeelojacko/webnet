/**
 * Phase 18X explicit-bake pins (agent tier, fast, no worker/harness).
 *
 * Covers canonicalization, payload provenance (never LandXML), the
 * SURFBAKE / SURFBAKECOPY transactions, their gates, the single undo
 * entry, and re-bake of an edited explicit surface.
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalizeBakedTin,
  createBakedPayloadFromMesh,
} from '../src/engine/cad/cadExplicitBake';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
} from '../src/engine/cad/cadSurfaces';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadProject, CadSurface, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';

const point = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id, type: 'survey-point', layerId: 'points', visible: true, locked: false,
  stationId, x, y, z, pointClass: 'free', source: 'parsed-input',
});

const projectWithQuad = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Bake 18X', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('pt-1', 'A', 0, 0, 10),
      point('pt-2', 'B', 10, 0, 11),
      point('pt-3', 'C', 10, 10, 12),
      point('pt-4', 'D', 0, 10, 13),
    ],
  };
};

const firstSurface = (project: CadProject): CadSurface => project.surfaces![0]!;

const historyWithSurface = () => {
  let history = createCadHistoryState(projectWithQuad());
  history = runCadCommand(history, {
    key: 'SURFACE_CREATE',
    name: 'Site',
    pointSource: { kind: 'points', pointEntityIds: ['pt-1', 'pt-2', 'pt-3', 'pt-4'] },
  });
  return history;
};

/** Set cachedRevision to the source revision so the surface derives CURRENT. */
const markCurrent = (project: CadProject): CadProject => {
  const surface = firstSurface(project);
  const revision = computeCadSurfaceSourceRevision(project, surface);
  return {
    ...project,
    surfaces: project.surfaces!.map((entry) =>
      entry.id === surface.id ? { ...entry, cachedRevision: revision } : entry),
  };
};

const revisionOf = (project: CadProject): string =>
  computeCadSurfaceSourceRevision(project, firstSurface(project));

const surfaceIdOf = (project: CadProject): string => firstSurface(project).id;

const bake = (surfaceId: string, expectedRevision: string): CadCommand => ({
  key: 'SURFBAKE',
  surfaceId,
  expectedRevision,
});

// ---------------------------------------------------------------------------
// Canonicalization + payload
// ---------------------------------------------------------------------------

describe('18X canonicalizeBakedTin', () => {
  it('compacts unreferenced vertices, remaps deterministically, and deep-copies', () => {
    const vertices = [0, 0, 0, 5, 5, 5, 10, 0, 0, 10, 10, 0];
    const faces = [0, 2, 3];
    const canonical = canonicalizeBakedTin(vertices, faces);
    expect(canonical.vertices).toEqual([0, 0, 0, 10, 0, 0, 10, 10, 0]);
    expect(canonical.faces).toEqual([0, 1, 2]);
    // Deep copies: mutating the output never touches the input.
    canonical.vertices[0] = 999;
    canonical.faces[0] = 999;
    expect(vertices[0]).toBe(0);
    expect(faces[0]).toBe(0);
  });

  it('enforces CCW winding by swapping a clockwise face', () => {
    const canonical = canonicalizeBakedTin(
      [0, 0, 0, 10, 0, 0, 10, 10, 0],
      [0, 2, 1],
    );
    expect(canonical.faces).toEqual([0, 1, 2]);
  });

  it('keeps face order and is idempotent', () => {
    const once = canonicalizeBakedTin([0, 0, 0, 10, 0, 0, 10, 10, 0], [0, 1, 2]);
    expect(canonicalizeBakedTin(once.vertices, once.faces)).toEqual(once);
  });
});

describe('18X createBakedPayloadFromMesh', () => {
  it('stores exact doubles and strict webnet-bake provenance (never LandXML)', () => {
    const surface = { id: 'surf-1', name: 'Site' };
    const payload = createBakedPayloadFromMesh(
      {
        points: [
          { x: 1.2345678901234567, y: 2.0000000000000004, z: -3.5 },
          { x: 10, y: 0, z: 1 },
          { x: 0, y: 10, z: 2 },
        ],
        triangles: [[0, 1, 2] as const],
      },
      surface,
      { sourceRevision: 'srev1:imported:abc', sourceSourceKind: 'native' },
    );
    expect(payload.vertices[0]).toBe(1.2345678901234567);
    expect(payload.vertices[1]).toBe(2.0000000000000004);
    expect(payload.provenance.kind).toBe('webnet-bake');
    expect('format' in payload.provenance).toBe(false);
    expect(payload.provenance).toMatchObject({
      sourceSurfaceId: 'surf-1',
      sourceSurfaceName: 'Site',
      sourceRevision: 'srev1:imported:abc',
      sourceSourceKind: 'native',
    });
  });
});

// ---------------------------------------------------------------------------
// SURFBAKE in place
// ---------------------------------------------------------------------------

describe('18X SURFBAKE (in place)', () => {
  it('freezes the CURRENT mesh, preserves identity, and clears all sources/edits', () => {
    const base = historyWithSurface();
    const history = createCadHistoryState(markCurrent(base.present.project));
    const project = history.present.project;
    const surfaceId = surfaceIdOf(project);
    const before = firstSurface(project);
    expect(deriveSurfaceStatus(project, before)).toBe('CURRENT');
    // Give the source breaklines/boundaries so we can prove they are dropped.
    const polygon = {
      id: 'poly-1', type: 'polygon' as const, layerId: 'general', visible: true, locked: false,
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      vertexLabels: ['', '', '', ''],
    };
    const withRefs: CadProject = {
      ...project,
      entities: [...project.entities, polygon],
      surfaces: project.surfaces!.map((entry) =>
        entry.id === surfaceId
          ? {
              ...entry,
              definition: {
                ...entry.definition,
                breaklines: [{ id: 'bl-1', type: 'standard', source: { kind: 'point-chain', pointEntityIds: ['pt-1', 'pt-2'] } }],
                boundaries: [{ type: 'outer', sourceEntityId: 'poly-1' }],
              },
            }
          : entry),
    };
    const withRefsHistory = createCadHistoryState(markCurrent(withRefs));
    const refsRevision = revisionOf(withRefsHistory.present.project);

    const next = runCadCommand(withRefsHistory, bake(surfaceId, refsRevision));
    expect(next).not.toBe(withRefsHistory);
    const baked = next.present.project.surfaces!.find((entry) => entry.id === surfaceId)!;
    expect(baked.id).toBe(surfaceId);
    expect(baked.name).toBe('Site');
    expect(baked.layerId).toBe(before.layerId);
    expect(baked.styleId).toBe(before.styleId);
    expect(baked.definition.sourceKind).toBe('explicit-tin');
    expect(baked.definition.pointSource).toEqual({ kind: 'points', pointEntityIds: [] });
    expect(baked.definition.breaklines).toBeUndefined();
    expect(baked.definition.boundaries).toBeUndefined();
    expect(baked.definition.edits).toBeUndefined();
    expect(baked.definition.buildOptions).toBeUndefined();
    expect(baked.definition.importedTin!.provenance.kind).toBe('webnet-bake');
    expect(baked.definition.importedTin!.provenance).not.toHaveProperty('format');
    expect(baked.cachedRevision).toBeNull();
    expect(baked.buildDiagnostic).toBeUndefined();
    // Rebuild-required immediately after bake (dependents go stale).
    expect(deriveSurfaceStatus(next.present.project, baked)).toBe('UNBUILT');
    // Exactly one undo entry restores the full pre-bake definition.
    expect(next.undoStack).toHaveLength(withRefsHistory.undoStack.length + 1);
    expect(undoCadHistory(next).present.project).toEqual(withRefsHistory.present.project);
  });

  it('rebuilds the baked explicit payload to the same final mesh', () => {
    const base = historyWithSurface();
    const current = markCurrent(base.present.project);
    const beforeMesh = buildCadSurface(current, firstSurface(current));
    const history = createCadHistoryState(current);
    const surfaceId = surfaceIdOf(current);
    const next = runCadCommand(history, bake(surfaceId, revisionOf(current)));
    const baked = next.present.project.surfaces!.find((entry) => entry.id === surfaceId)!;
    const rebuilt = buildCadSurface(next.present.project, baked);
    expect(rebuilt.outcome).toBe('ok');
    expect(rebuilt.triangles).toHaveLength(beforeMesh.triangles.length);
    expect(rebuilt.points.map((p) => [p.x, p.y, p.z])).toEqual(
      beforeMesh.points.map((p) => [p.x, p.y, p.z]),
    );
  });
});

// ---------------------------------------------------------------------------
// SURFBAKECOPY
// ---------------------------------------------------------------------------

describe('18X SURFBAKECOPY', () => {
  it('appends a uniquely named copy and leaves the source byte-identical', () => {
    const base = historyWithSurface();
    const current = markCurrent(base.present.project);
    const history = createCadHistoryState(current);
    const surfaceId = surfaceIdOf(current);
    const sourceBefore = JSON.stringify(current.surfaces!.find((entry) => entry.id === surfaceId));

    const next = runCadCommand(history, {
      key: 'SURFBAKECOPY',
      surfaceId,
      expectedRevision: revisionOf(current),
    });
    const surfaces = next.present.project.surfaces!;
    expect(surfaces).toHaveLength(2);
    const copy = surfaces.find((entry) => entry.id !== surfaceId)!;
    expect(copy.id).not.toBe(surfaceId);
    expect(copy.name).toBe('Site - Baked');
    expect(copy.definition.sourceKind).toBe('explicit-tin');
    expect(copy.definition.importedTin!.provenance).toMatchObject({
      kind: 'webnet-bake',
      sourceSurfaceId: surfaceId,
      sourceSurfaceName: 'Site',
    });
    expect(copy.layerId).toBe(firstSurface(current).layerId);
    expect(copy.cachedRevision).toBeNull();
    expect(JSON.stringify(next.present.project.surfaces!.find((entry) => entry.id === surfaceId)))
      .toBe(sourceBefore);
    expect(next.undoStack).toHaveLength(history.undoStack.length + 1);
    expect(undoCadHistory(next).present.project).toEqual(history.present.project);
  });

  it('deconflicts a repeated copy name', () => {
    const base = historyWithSurface();
    const current = markCurrent(base.present.project);
    const history = createCadHistoryState(current);
    const surfaceId = surfaceIdOf(current);
    const rev = revisionOf(current);
    const first = runCadCommand(history, { key: 'SURFBAKECOPY', surfaceId, expectedRevision: rev });
    const second = runCadCommand(first, { key: 'SURFBAKECOPY', surfaceId, expectedRevision: rev });
    const names = second.present.project.surfaces!.map((entry) => entry.name);
    expect(names).toContain('Site - Baked');
    expect(names).toContain('Site - Baked (2)');
  });
});

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

describe('18X bake gates', () => {
  it('rejects UNBUILT and NEEDS_REBUILD surfaces', () => {
    const history = historyWithSurface();
    const surfaceId = surfaceIdOf(history.present.project);
    // UNBUILT: never built (cachedRevision null).
    expect(runCadCommand(history, bake(surfaceId, revisionOf(history.present.project)))).toBe(history);
    // NEEDS_REBUILD: cached revision does not match the source revision.
    const staleCache: CadProject = {
      ...history.present.project,
      surfaces: history.present.project.surfaces!.map((entry) =>
        entry.id === surfaceId ? { ...entry, cachedRevision: 'srev1:imported:stale' } : entry),
    };
    const staleHistory = createCadHistoryState(staleCache);
    expect(deriveSurfaceStatus(staleCache, firstSurface(staleCache))).toBe('NEEDS_REBUILD');
    expect(runCadCommand(staleHistory, bake(surfaceId, revisionOf(staleCache)))).toBe(staleHistory);
  });

  it('accepts a session-current surface that derives UNBUILT (the project never persists cachedRevision)', () => {
    // Live-app contract: rebuilds stay out of history, so `cachedRevision` is
    // never written in-session and `deriveSurfaceStatus` alone reads UNBUILT.
    // The UI passes sessionCurrent from surfaceBakeCapability; absent = reject.
    const history = historyWithSurface();
    const surfaceId = surfaceIdOf(history.present.project);
    const rev = revisionOf(history.present.project);
    expect(deriveSurfaceStatus(history.present.project, firstSurface(history.present.project))).toBe('UNBUILT');
    expect(runCadCommand(history, bake(surfaceId, rev))).toBe(history);
    const baked = runCadCommand(history, { key: 'SURFBAKE', surfaceId, expectedRevision: rev, sessionCurrent: true });
    expect(baked).not.toBe(history);
    expect(baked.present.project.surfaces!.find((entry) => entry.id === surfaceId)!.definition.sourceKind).toBe('explicit-tin');
    const copied = runCadCommand(history, { key: 'SURFBAKECOPY', surfaceId, expectedRevision: rev, sessionCurrent: true });
    expect(copied).not.toBe(history);
    expect(copied.present.project.surfaces!.some((entry) => entry.name === 'Site - Baked')).toBe(true);
  });

  it('rejects a stale expectedRevision with the surface changed', () => {
    const base = historyWithSurface();
    const history = createCadHistoryState(markCurrent(base.present.project));
    const surfaceId = surfaceIdOf(history.present.project);
    expect(runCadCommand(history, bake(surfaceId, 'srev1:imported:stale'))).toBe(history);
  });

  it('rejects a locked source layer for both paths', () => {
    const base = historyWithSurface();
    const current = markCurrent(base.present.project);
    const surface = firstSurface(current);
    const locked: CadProject = {
      ...current,
      layers: current.layers.map((layer) =>
        layer.id === surface.layerId ? { ...layer, locked: true } : layer),
    };
    const history = createCadHistoryState(locked);
    const surfaceId = surfaceIdOf(locked);
    const rev = revisionOf(locked);
    expect(runCadCommand(history, bake(surfaceId, rev))).toBe(history);
    expect(runCadCommand(history, { key: 'SURFBAKECOPY', surfaceId, expectedRevision: rev })).toBe(history);
  });
});

// ---------------------------------------------------------------------------
// Re-bake
// ---------------------------------------------------------------------------

describe('18X re-bake of an edited explicit surface', () => {
  it('produces a new explicit base with edits cleared', () => {
    const vertices = [0, 0, 10, 10, 0, 11, 10, 10, 12, 0, 10, 13];
    const faces = [0, 1, 2, 0, 2, 3];
    const surface: CadSurface = {
      id: 'surf-explicit',
      name: 'Baked',
      layerId: 'general',
      definition: {
        sourceKind: 'explicit-tin',
        pointSource: { kind: 'points', pointEntityIds: [] },
        importedTin: {
          vertices: [...vertices],
          faces: [...faces],
          provenance: {
            kind: 'webnet-bake',
            sourceSurfaceId: 'orig',
            sourceSurfaceName: 'Original',
            sourceRevision: 'srev1:imported:x',
          },
        },
        edits: [{ id: 'e-1', kind: 'raise-lower-surface', deltaZ: 1 }],
      },
      cachedRevision: null,
    };
    let project: CadProject = { ...projectWithQuad(), surfaces: [surface] };
    project = markCurrentFor(project, 'surf-explicit');
    const history = createCadHistoryState(project);
    const next = runCadCommand(history, bake('surf-explicit', revisionOfById(project, 'surf-explicit')));
    const baked = next.present.project.surfaces!.find((entry) => entry.id === 'surf-explicit')!;
    expect(baked.definition.edits).toBeUndefined();
    expect(baked.definition.sourceKind).toBe('explicit-tin');
    expect(baked.definition.importedTin!.provenance.kind).toBe('webnet-bake');
    // The replay ran before the snapshot: every baked Z is raised by 1.
    expect(baked.definition.importedTin!.vertices[2]).toBe(11);
  });
});

// Helper: mark an arbitrary surface CURRENT.
const markCurrentFor = (project: CadProject, surfaceId: string): CadProject => {
  const surface = project.surfaces!.find((entry) => entry.id === surfaceId)!;
  const revision = computeCadSurfaceSourceRevision(project, surface);
  return {
    ...project,
    surfaces: project.surfaces!.map((entry) =>
      entry.id === surfaceId ? { ...entry, cachedRevision: revision } : entry),
  };
};

const revisionOfById = (project: CadProject, surfaceId: string): string =>
  computeCadSurfaceSourceRevision(project, project.surfaces!.find((entry) => entry.id === surfaceId)!);
