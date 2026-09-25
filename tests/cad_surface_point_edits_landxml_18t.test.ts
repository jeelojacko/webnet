/**
 * Phase 18T LandXML integration pins (§75-76).
 *
 * A CURRENT edited mesh (add + move + set-elevation + raise over post-delete
 * topology) must export as ordinary Pnts/Faces — no edit history leaks into
 * the file — and must reimport mesh-equivalent (XYZ / faces / domain /
 * queries) through the real 18L/18M import path. The imported payload is the
 * flattened result and stays internally unmutated while later point edits
 * apply on top of it.
 */
import { describe, expect, it } from 'vitest';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  getSurfaceElevationAt,
} from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { commitLandXmlImport } from '../src/engine/cad/cadLandxmlCommit';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import type { CadProject, CadSurface, CadSurfaceEdit } from '../src/engine/cad/cadTypes';
import { gridFixture, planeZ } from './cadSurfacePointEdits18tFixtures';
import { parseSurfaces } from './landxmlCivilTestSupport';

const SETTINGS = { units: 'm' as const, projectName: 'Edited Site', generatedAt: new Date('2026-09-19T12:00:00Z') };

/** add + set-elev + move + raise on top of a deleted interior vertex. */
const EDITED_SURFACE_EDITS: CadSurfaceEdit[] = [
  { id: 'e-del', kind: 'delete-point', vertex: { key: 'source:pt:2-2' } },
  { id: 'e-add', kind: 'add-point', x: 5, y: 5, z: planeZ(5, 5) + 3 },
  { id: 'e-set', kind: 'set-elevation', vertex: { key: 'edit:surf-18t:e-add' }, z: planeZ(5, 5) + 7 },
  { id: 'e-move', kind: 'move-point', vertex: { key: 'edit:surf-18t:e-add' }, x: 5.5, y: 5.2 },
  { id: 'e-raise', kind: 'raise-lower-surface', deltaZ: 1.25 },
];

const editedFixture = (): { project: CadProject; surface: CadSurface; edited: CadSurface; built: ReturnType<typeof buildCadSurface>; cache: ReturnType<typeof createCadSurfaceCache>; projectWithBuild: CadProject } => {
  const { project, surface } = gridFixture({ side: 5 });
  const edited = { ...surface, definition: { ...surface.definition, edits: EDITED_SURFACE_EDITS } };
  const projectWithEdit: CadProject = { ...project, surfaces: [edited] };
  const built = buildCadSurface(projectWithEdit, edited);
  expect(built.outcome).toBe('ok');
  const cache = createCadSurfaceCache('18t-landxml');
  const revision = computeCadSurfaceSourceRevision(projectWithEdit, edited);
  const projectWithBuild = applySurfaceBuildSuccess(projectWithEdit, cache, edited.id, revision, built);
  return { project, surface, edited, built, cache, projectWithBuild };
};

const exportOf = (projectWithBuild: CadProject, cache: ReturnType<typeof createCadSurfaceCache>): string =>
  buildLandXmlProjectExportWithResult(projectWithBuild, SETTINGS, { surfaceCache: cache }).output;

describe('18T LandXML export (§75)', () => {
  it('CURRENT edited mesh exports as ordinary Pnts/Faces with no edit history', () => {
    const { edited, built, cache, projectWithBuild } = editedFixture();
    const result = buildLandXmlProjectExportWithResult(projectWithBuild, SETTINGS, { surfaceCache: cache });
    expect(result.civilEntries).toEqual([
      { class: 'surface', id: edited.id, name: edited.name, disposition: 'EXPORTED' },
    ]);
    expect(result.output).toContain('<Pnts>');
    expect(result.output).toContain('<Faces>');
    // History is flattened: no edit ids or stack markers reach the file.
    for (const id of ['e-del', 'e-add', 'e-set', 'e-move', 'e-raise']) {
      expect(result.output).not.toContain(id);
    }
    expect(result.output).not.toContain('edits');
    expect(result.output).not.toContain('delete-point');

    const parsed = parseSurfaces(result.output);
    expect(parsed).toHaveLength(1);
    const surface = parsed[0]!;
    expect(surface.points).toHaveLength(built.points.length);
    surface.points.forEach((point, index) => {
      const source = built.points[index]!;
      expect(point.id).toBe(index + 1);
      expect(point.e).toBeCloseTo(source.x, 6);
      expect(point.n).toBeCloseTo(source.y, 6);
      expect(point.z).toBeCloseTo(source.z, 6);
    });
    expect(surface.faces).toEqual(built.triangles.map((tri) => [tri[0] + 1, tri[1] + 1, tri[2] + 1]));
    expect(surface.area2D).toBeCloseTo(built.stats.planimetricArea, 4);
    expect(surface.elevMin).toBeCloseTo(built.stats.minZ as number, 6);
    expect(surface.elevMax).toBeCloseTo(built.stats.maxZ as number, 6);
    // The deleted vertex is gone and the added/moved/raised peak is present.
    expect(surface.points.some((point) => Math.abs(point.e - 20) < 1e-9 && Math.abs(point.n - 20) < 1e-9)).toBe(false);
    const peak = surface.points.find((point) => Math.abs(point.e - 5.5) < 1e-9 && Math.abs(point.n - 5.2) < 1e-9);
    expect(peak?.z).toBeCloseTo(planeZ(5, 5) + 7 + 1.25, 6);
  });

  it('export re-exports byte-identically for the same edited mesh', () => {
    const { cache, projectWithBuild } = editedFixture();
    expect(exportOf(projectWithBuild, cache)).toBe(exportOf(projectWithBuild, cache));
  });
});

describe('18T LandXML reimport equivalence (§76)', () => {
  it('real import path rebuilds the edited mesh and keeps the payload unmutated', () => {
    const { built, cache, projectWithBuild } = editedFixture();
    const output = exportOf(projectWithBuild, cache);

    const preview = buildLandXmlImportPreview(output);
    expect(preview.surfaces).toHaveLength(1);
    expect(preview.surfaces[0]!.disposition).toBe('IMPORTABLE');
    const committed = commitLandXmlImport(
      createCadHistoryState(createBlankCadProject({ name: 'imp', units: 'm' })),
      createCadSurfaceCache('18t-import'),
      preview,
      'edited.xml',
    );
    expect(committed.report.committed).toBe(true);
    const imported = committed.state.present.project.surfaces![0]!;
    // Flattened: the reimported definition carries no edit stack.
    expect(imported.definition.edits).toBeUndefined();
    expect(imported.definition.importedTin).toBeDefined();

    const importedBuild = buildCadSurface(committed.state.present.project, imported);
    expect(importedBuild.outcome).toBe('ok');

    // XYZ equivalently: same vertex multiset and same retained triangles.
    const xyz = (build: ReturnType<typeof buildCadSurface>): string[] =>
      build.points.map((p) => `${p.x.toFixed(6)},${p.y.toFixed(6)},${p.z.toFixed(6)}`).sort();
    expect(xyz(importedBuild)).toEqual(xyz(built));
    const triKey = (build: ReturnType<typeof buildCadSurface>): string[] =>
      build.triangles
        .map((tri) => tri.map((i) => `${build.points[i]!.x.toFixed(6)},${build.points[i]!.y.toFixed(6)}`).sort().join('+'))
        .sort();
    expect(triKey(importedBuild)).toEqual(triKey(built));
    expect(importedBuild.triangles).toHaveLength(built.triangles.length);
    expect(importedBuild.stats.planimetricArea).toBeCloseTo(built.stats.planimetricArea, 9);

    // Domain + queries agree with the exported edited mesh.
    for (const [x, y] of [[5.5, 5.2], [2, 12], [18, 18], [30, 30]] as const) {
      const expected = getSurfaceElevationAt(built, x, y);
      const actual = getSurfaceElevationAt(importedBuild, x, y);
      if (expected == null) expect(actual).toBeNull();
      else expect(actual).toBeCloseTo(expected, 9);
    }

    // Later point edits layer on top without mutating the imported payload.
    const payloadBefore = JSON.stringify(imported.definition.importedTin);
    const editedImported: CadSurface = {
      ...imported,
      definition: {
        ...imported.definition,
        edits: [{ id: 'e-imp', kind: 'set-elevation', vertex: { key: `imported:${imported.id}:0` }, z: 99 }],
      },
    };
    const projectAfterEdit: CadProject = { ...committed.state.present.project, surfaces: [editedImported] };
    const afterBuild = buildCadSurface(projectAfterEdit, editedImported);
    expect(afterBuild.outcome).toBe('ok');
    expect(getSurfaceElevationAt(afterBuild, built.points[0]!.x, built.points[0]!.y)).toBeCloseTo(99, 9);
    expect(JSON.stringify(editedImported.definition.importedTin)).toBe(payloadBefore);
    expect(JSON.stringify(imported.definition.importedTin)).toBe(payloadBefore);
    // Topology is untouched by a pure elevation override.
    expect(afterBuild.triangles).toEqual(importedBuild.triangles);
  });
});
