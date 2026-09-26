/**
 * Phase 18W edit-stack replay / export / imported-TIN pins (agent tier, fast).
 *
 * 18W adds no CadSurfaceEdit kinds: source rebuilds replay the persisted
 * 18S/T/V stack in order, unchanged. Pins:
 * - a valid source rebuild (breakline reverse) preserves an 18S swap-edge +
 *   an 18T add-point (topology + payload survive, diagonal stays flipped);
 * - a boundary edit that removes an edit's region fails closed with the
 *   precise existing reason (SURFACE_EDIT_POINT_OUTSIDE_DOMAIN), never a
 *   silent drop;
 * - the edited final mesh exports as ordinary LandXML Pnts/Faces with no
 *   edit history leaking into the file;
 * - imported-TIN definitions reject every 18W native source command while
 *   SURFACE_ADD_EDIT stays allowed and the payload stays byte-identical.
 */
import { describe, expect, it } from 'vitest';

import {
  buildCadSurface,
  type CadSurfaceBuildResult,
  computeCadSurfaceSourceRevision,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaces';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type {
  CadEntity,
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

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

const projectWith = (entities: CadEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Replay 18W', units: 'm' });
  return { ...drawing.project, entities };
};

/** Bare saddle quad: the base diagonal is flippable (18S saddle pattern). No
 * center point: a center fan makes every interior swap NOT_APPLICABLE. */
const saddleProject = (): CadProject => projectWith([
  point('pt-a', 'A', 0, 0, 5), point('pt-b', 'B', 10, 0, 0),
  point('pt-c', 'C', 10, 10, 5), point('pt-d', 'D', 0, 10, 0),
]);

/** First edge shared by two triangles, as source entity-id keys. */
const interiorEdgeKeys = (build: CadSurfaceBuildResult): [{ key: string }, { key: string }] => {
  const counts = new Map<string, number>();
  for (const tri of build.triangles) {
    for (const [p, q] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const key = `${Math.min(p, q)}>${Math.max(p, q)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of counts) {
    if (count !== 2) continue;
    const [a, b] = key.split('>').map(Number) as [number, number];
    const ea = build.points[a]!.entityId;
    const eb = build.points[b]!.entityId;
    // Skip the hull breakline A-B: only the free interior diagonal is swappable.
    if ((ea === 'pt-a' && eb === 'pt-b') || (ea === 'pt-b' && eb === 'pt-a')) continue;
    return [{ key: `source:${ea}` }, { key: `source:${eb}` }];
  }
  throw new Error('no swappable interior edge');
};

describe('18W edit-stack replay after source rebuild', () => {
  const stackedFixture = () => {
    let history = createCadHistoryState(saddleProject());
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE', name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d'] },
    });
    const surfaceId = history.present.project.surfaces![0]!.id;
    history = runCadCommand(history, {
      key: 'SURFACE_ADD_BREAKLINE', surfaceId, pointIds: ['pt-a', 'pt-b'], name: 'Toe',
    });
    const blId = history.present.project.surfaces![0]!.definition.breaklines![0]!.id;
    const base = buildCadSurface(history.present.project, history.present.project.surfaces![0]!);
    expect(base.outcome).toBe('ok');
    if (base.outcome !== 'ok') throw new Error('base build failed');
    const [a, b] = interiorEdgeKeys(base);
    const edits: CadSurfaceEdit[] = [
      { id: 'e-swap', kind: 'swap-edge', edge: { a, b } },
      { id: 'e-add', kind: 'add-point', x: 5, y: 2, z: 3 },
    ];
    const stacked: CadProject = {
      ...history.present.project,
      surfaces: history.present.project.surfaces!.map((s) =>
        s.id === surfaceId ? { ...s, definition: { ...s.definition, edits } } : s),
    };
    const built = buildCadSurface(stacked, stacked.surfaces![0]!);
    expect(built.outcome).toBe('ok');
    return { history, surfaceId, blId, edits, stacked, basePointCount: base.points.length };
  };

  it('swap + add-point survive a valid source rebuild (reverse)', () => {
    const { history, surfaceId, blId, stacked, basePointCount } = stackedFixture();
    const editedBuild = buildCadSurface(stacked, stacked.surfaces![0]!);
    expect(editedBuild.outcome).toBe('ok');
    if (editedBuild.outcome !== 'ok') throw new Error('stacked build failed');
    expect(editedBuild.points).toHaveLength(basePointCount + 1);
    expect(getSurfaceElevationAt(editedBuild, 5, 2)).toBeCloseTo(3, 9);
    // Control: same definition without the stack (diagonal unflipped).
    const control = buildCadSurface(history.present.project, history.present.project.surfaces![0]!);
    expect(control.outcome).toBe('ok');
    // Source rebuild: reverse the hull chain (valid, revision-changing).
    const reversed = runCadCommand(history, {
      key: 'SURFACE_BREAKLINE_REVERSE', surfaceId, breaklineId: blId,
    });
    expect(reversed).not.toBe(history);
    const replayed: CadProject = {
      ...reversed.present.project,
      surfaces: reversed.present.project.surfaces!.map((s) =>
        s.id === surfaceId
          ? { ...s, definition: { ...s.definition, edits: stacked.surfaces![0]!.definition.edits } } : s),
    };
    const rebuilt = buildCadSurface(replayed, replayed.surfaces![0]!);
    expect(rebuilt.outcome).toBe('ok');
    if (rebuilt.outcome !== 'ok' || control.outcome !== 'ok') throw new Error('rebuild failed');
    // Swap survived: flipped diagonal differs from the unswapped control.
    const canonical = (tris: Array<[number, number, number]>): string[] =>
      tris.map((tri) => [...tri].sort((x, y) => x - y).join('>')).sort();
    expect(canonical(rebuilt.triangles)).toEqual(canonical(editedBuild.triangles));
    expect(canonical(rebuilt.triangles)).not.toEqual(canonical(control.triangles));
    // Add-point survived: payload + probe.
    expect(rebuilt.points).toHaveLength(basePointCount + 1);
    expect(getSurfaceElevationAt(rebuilt, 5, 2)).toBeCloseTo(3, 9);
  });

  it('a boundary that removes the edit region fails closed with the precise reason', () => {
    const entities: CadEntity[] = [];
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        entities.push(point(`pt-${row}${col}`, `G${row}${col}`, col * 10, row * 10, col + row));
      }
    }
    let history = createCadHistoryState(projectWith(entities));
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE', name: 'Site',
      pointSource: { kind: 'points', pointEntityIds: entities.map((e) => e.id) },
    });
    const surfaceId = history.present.project.surfaces![0]!.id;
    const revision = computeCadSurfaceSourceRevision(
      history.present.project, history.present.project.surfaces![0]!);
    history = runCadCommand(history, {
      key: 'SURFACE_ADD_EDIT', surfaceId,
      edit: { kind: 'add-point', x: 15, y: 15, z: 99 },
      expectedRevision: revision,
    });
    // Outer covering everything, then a shrink that excludes (15,15) but keeps
    // the bottom two point rows (6 source points: still a valid TIN).
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE_BOUNDARY_SOURCE', surfaceId, kind: 'outer',
      vertices: [{ x: -1, y: -1 }, { x: 21, y: -1 }, { x: 21, y: 21 }, { x: -1, y: 21 }],
    });
    history = runCadCommand(history, {
      key: 'SURFACE_CREATE_BOUNDARY_SOURCE', surfaceId, kind: 'outer',
      vertices: [{ x: -1, y: -1 }, { x: 21, y: -1 }, { x: 21, y: 11 }, { x: -1, y: 11 }],
    });
    const build = buildCadSurface(history.present.project, history.present.project.surfaces![0]!);
    expect(build.outcome).toBe('blocked');
    if (build.outcome !== 'blocked') throw new Error('expected a blocked build');
    expect(build.editFailure?.reason).toBe('SURFACE_EDIT_POINT_OUTSIDE_DOMAIN');
  });
});

describe('18W LandXML export of the edited final mesh', () => {
  it('exports ordinary Pnts/Faces: one P per final vertex, no edit history', () => {
    const { stacked } = (() => {
      let history = createCadHistoryState(saddleProject());
      history = runCadCommand(history, {
        key: 'SURFACE_CREATE', name: 'Site',
        pointSource: { kind: 'points', pointEntityIds: ['pt-a', 'pt-b', 'pt-c', 'pt-d'] },
      });
      const surfaceId = history.present.project.surfaces![0]!.id;
      history = runCadCommand(history, {
        key: 'SURFACE_ADD_BREAKLINE', surfaceId, pointIds: ['pt-a', 'pt-b'], name: 'Toe',
      });
      const revision = computeCadSurfaceSourceRevision(
        history.present.project, history.present.project.surfaces![0]!);
      history = runCadCommand(history, {
        key: 'SURFACE_ADD_EDIT', surfaceId,
        edit: { kind: 'add-point', x: 5, y: 2, z: 3 },
        expectedRevision: revision,
      });
      return { stacked: history.present.project };
    })();
    const surface = stacked.surfaces![0]!;
    const built = buildCadSurface(stacked, surface);
    expect(built.outcome).toBe('ok');
    if (built.outcome !== 'ok') throw new Error('edited build failed');
    const cache = createCadSurfaceCache('18w-landxml');
    const projectWithBuild = applySurfaceBuildSuccess(
      stacked, cache, surface.id, computeCadSurfaceSourceRevision(stacked, surface), built);
    const output = buildLandXmlProjectExportWithResult(projectWithBuild, {
      units: 'm' as const, projectName: 'Edited 18W', generatedAt: new Date('2026-09-25T00:00:00Z'),
    }, { surfaceCache: cache }).output;
    expect(output).toContain('<Pnts>');
    expect(output).toContain('<Faces>');
    const pnts = output.slice(output.indexOf('<Pnts>'), output.indexOf('</Pnts>'));
    expect(pnts.match(/<P id="/g)).toHaveLength(built.points.length);
    expect(output).not.toContain('add-point');
    expect(output).not.toContain('swap-edge');
  });
});

describe('18W imported-TIN exclusion', () => {
  const importedFixture = (): { project: CadProject; surfaceId: string; payload: string } => {
    const history = createCadHistoryState(projectWith([]));
    const surface: CadSurface = {
      id: 'surf-tin', name: 'Imported',
      definition: {
        pointSource: { kind: 'points', pointEntityIds: [] },
        sourceKind: 'imported-tin',
        importedTin: {
          vertices: [0, 0, 1, 10, 0, 2, 10, 10, 3, 0, 10, 4],
          faces: [0, 1, 2, 0, 2, 3],
          provenance: { format: 'LandXML', fileName: 't.xml', surfaceName: 's' },
        },
      },
      cachedRevision: null,
    };
    const project = { ...history.present.project, surfaces: [surface] };
    return { project, surfaceId: surface.id, payload: JSON.stringify(surface.definition.importedTin) };
  };

  it('rejects every 18W native source command; mesh edits stay allowed, payload identical', () => {
    const { project, surfaceId, payload } = importedFixture();
    const snapshot = createCadHistoryState(project).present;
    const rejected: CadCommand[] = [
      { key: 'SURFACE_RENAME_BREAKLINE', surfaceId, breaklineId: 'bl-1', name: 'X' },
      { key: 'SURFACE_BREAKLINE_INSERT_POINT', surfaceId, breaklineId: 'bl-1', pointEntityId: 'pt-b', insertIndex: 1 },
      { key: 'SURFACE_BREAKLINE_REMOVE_POINT', surfaceId, breaklineId: 'bl-1', pointEntityId: 'pt-a' },
      { key: 'SURFACE_BREAKLINE_REVERSE', surfaceId, breaklineId: 'bl-1' },
      { key: 'SURFACE_BREAKLINE_REPLACE_CHAIN', surfaceId, breaklineId: 'bl-1', pointEntityIds: ['pt-a', 'pt-c'] },
      { key: 'SURFACE_BREAKLINE_CONVERT_TO_POINT_CHAIN', surfaceId, breaklineId: 'bl-1' },
      {
        key: 'SURFACE_CREATE_BOUNDARY_SOURCE', surfaceId, kind: 'outer',
        vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      },
      { key: 'SURFACE_REPLACE_BOUNDARY_SOURCE', surfaceId, kind: 'outer', sourceEntityId: 'ring' },
      { key: 'SURFACE_MAKE_BOUNDARY_INDEPENDENT', surfaceId, kind: 'outer' },
    ];
    for (const command of rejected) {
      expect(executeCadCommand(snapshot, command)).toBeNull();
    }
    const surface = project.surfaces![0]!;
    const revision = computeCadSurfaceSourceRevision(project, surface);
    const allowed = executeCadCommand(snapshot, {
      key: 'SURFACE_ADD_EDIT',
      surfaceId,
      edit: { kind: 'add-point', x: 5, y: 5, z: 2 },
      expectedRevision: revision,
    });
    expect(allowed).not.toBeNull();
    expect(JSON.stringify(project.surfaces![0]!.definition.importedTin)).toBe(payload);
  });
});
