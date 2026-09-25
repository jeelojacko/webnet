/**
 * Phase 18T display + inquiry pins (§77-78).
 *
 * The FINAL current mesh — not the source entities — must drive what the
 * operator sees and probes:
 * - showPoints renders the edited vertex set (added visible, deleted absent,
 *   moved XY, edited Z reflected in mesh stats).
 * - an Add-Point placed on the interpolated surface is query-neutral.
 * - raise/lower shifts every elevation probe by exactly ΔZ.
 *
 * Engine reads through the 18C display-layer + grid-index query entry points.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache, type CachedSurfaceMesh } from '../src/engine/cad/cadSurfaceCache';
import { buildSurfaceDisplayLayer, queryMeshElevation } from '../src/engine/cad/cadSurfaceView';
import { SURFACE_STYLE_TRIANGLES_POINTS_ID } from '../src/engine/cad/cadSurfaceStyles';
import type { CadProject, CadSurface, CadSurfaceEdit } from '../src/engine/cad/cadTypes';
import { gridFixture, planeZ } from './cadSurfacePointEdits18tFixtures';

const buildOf = (project: CadProject, surface: CadSurface) => {
  const build = buildCadSurface(project, surface);
  if (build.outcome !== 'ok') throw new Error(`fixture build ${build.outcome}`);
  return build;
};

/** Cache a surface CURRENT and return the project + cache for display/query. */
const currentMesh = (
  project: CadProject,
  surface: CadSurface,
  scope: string,
): { project: CadProject; cache: ReturnType<typeof createCadSurfaceCache> } => {
  const build = buildOf(project, surface);
  const cache = createCadSurfaceCache(scope);
  const revision = computeCadSurfaceSourceRevision(project, surface);
  return { project: applySurfaceBuildSuccess(project, cache, surface.id, revision, build), cache };
};

const withEdits = (surface: CadSurface, edits: CadSurfaceEdit[]): CadSurface => ({
  ...surface,
  styleId: SURFACE_STYLE_TRIANGLES_POINTS_ID,
  definition: { ...surface.definition, edits },
});

const editedEdits: CadSurfaceEdit[] = [
  { id: 'e-del', kind: 'delete-point', vertex: { key: 'source:pt:2-2' } },
  { id: 'e-add', kind: 'add-point', x: 5, y: 5, z: planeZ(5, 5) + 4 },
  { id: 'e-move', kind: 'move-point', vertex: { key: 'edit:surf-18t:e-add' }, x: 5.5, y: 5.25 },
  { id: 'e-set', kind: 'set-elevation', vertex: { key: 'edit:surf-18t:e-add' }, z: planeZ(5, 5) + 9 },
];

describe('18T showPoints from the final mesh (§77)', () => {
  it('renders added/moved vertices, hides the deleted one, and reports edited Z stats', () => {
    const { project, surface } = gridFixture({ side: 5 });
    const baseBuild = buildOf(project, surface);
    const editedSurface = withEdits(surface, editedEdits);
    const projectWithEdit: CadProject = { ...project, surfaces: [editedSurface] };
    const editedBuild = buildOf(projectWithEdit, editedSurface);

    const { project: current, cache } = currentMesh(projectWithEdit, editedSurface, '18t-display');
    const layer = buildSurfaceDisplayLayer(current.surfaces![0]!, current, cache);
    expect(layer).not.toBeNull();
    expect(layer!.showVertices).toBe(true);
    expect(layer!.vertexCount).toBe(editedBuild.points.length);
    expect(layer!.vertices).toHaveLength(editedBuild.points.length);
    expect(layer!.stale).toBe(false);

    const at = (x: number, y: number) => layer!.vertices.find((v) => v.x === x && v.y === y);
    // Deleted interior source vertex is no longer rendered.
    expect(at(20, 20)).toBeUndefined();
    // Added + moved vertex renders at its final XY.
    expect(at(5.5, 5.25)).toBeDefined();
    // Untouched source vertex renders unchanged.
    expect(at(0, 0)).toBeDefined();
    expect(layer!.vertices).toHaveLength(editedBuild.points.length);
    expect(layer!.vertices).toHaveLength(baseBuild.points.length - 1 + 1);

    // Stats come from the edited Z values, not the source entities.
    expect(editedBuild.stats.maxZ).toBeCloseTo(planeZ(5, 5) + 9, 9);
    expect(editedBuild.stats.minZ).toBeCloseTo(baseBuild.stats.minZ as number, 9);
  });
});

describe('18T inquiry on the final mesh (§78)', () => {
  it('add-point at the interpolated Z is query-neutral', () => {
    const { project, surface } = gridFixture({ side: 3 });
    const baseBuild = buildOf(project, surface);
    const interpolated = getSurfaceElevationAt(baseBuild, 5, 5);
    expect(interpolated).not.toBeNull();
    const editedSurface = surface;
    editedSurface.definition.edits = [{ id: 'e-flat', kind: 'add-point', x: 5, y: 5, z: interpolated as number }];
    const editedBuild = buildOf(project, editedSurface);
    // Insertion is topological only; the plane is unchanged.
    expect(editedBuild.triangles).toHaveLength(baseBuild.triangles.length + 2);
    const { project: current, cache } = currentMesh(project, editedSurface, '18t-neutral');
    const mesh = cache.get(editedSurface.id, current.surfaces![0]!.cachedRevision ?? '') as CachedSurfaceMesh;
    expect(mesh).toBeTruthy();
    for (const [x, y] of [[5, 5], [1, 1], [9.5, 8], [15, 15]] as const) {
      expect(getSurfaceElevationAt(editedBuild, x, y)).toBeCloseTo(getSurfaceElevationAt(baseBuild, x, y) as number, 9);
      expect(queryMeshElevation(mesh, x, y)).toBeCloseTo(getSurfaceElevationAt(baseBuild, x, y) as number, 9);
    }
    expect(current.surfaces![0]!.definition.edits).toHaveLength(1);
  });

  it('raise +2 shifts every elevation probe by exactly +2', () => {
    const { project, surface } = gridFixture({ side: 3 });
    const baseSurface = surface;
    const baseBuild = buildOf(project, baseSurface);
    const raisedSurface = withEdits(surface, [{ id: 'e-raise', kind: 'raise-lower-surface', deltaZ: 2 }]);
    const projectWithEdit: CadProject = { ...project, surfaces: [raisedSurface] };
    const raisedBuild = buildOf(projectWithEdit, raisedSurface);
    const { project: current, cache } = currentMesh(projectWithEdit, raisedSurface, '18t-raise');
    const mesh = cache.get(raisedSurface.id, current.surfaces![0]!.cachedRevision ?? '') as CachedSurfaceMesh;
    expect(mesh).toBeTruthy();
    const probes: Array<[number, number]> = [[0, 0], [5, 5], [10, 10], [20, 20], [3.5, 7.25]];
    for (const [x, y] of probes) {
      const base = getSurfaceElevationAt(baseBuild, x, y) as number;
      expect(getSurfaceElevationAt(raisedBuild, x, y)).toBeCloseTo(base + 2, 9);
      expect(queryMeshElevation(mesh, x, y)).toBeCloseTo(base + 2, 9);
    }
    expect(current.surfaces![0]!.definition.edits).toHaveLength(1);
  });
});
