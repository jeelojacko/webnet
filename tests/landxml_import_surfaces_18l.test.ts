/**
 * Phase 18L — LandXML TIN surface import (agent-tier, fast).
 *
 * Hand-authored external-style fixtures (NOT exporter output): flat,
 * planar-slope, ridge, bowl, void, diagonal-A-vs-B, dedupe/conflict,
 * non-manifold, GRID, unit scaling, and the cross-object N/E oracle.
 * Materialization runs through buildCadSurface (no Delaunay) and the
 * commit path proves atomicity + WNCAD topology-exact reopen.
 */
import { describe, expect, it } from 'vitest';

import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import { buildCadSurface, computeCadSurfaceSourceRevision, deriveSurfaceStatus } from '../src/engine/cad/cadSurfaces';
import { getSurfaceElevationAt } from '../src/engine/cad/cadSurfaceInterpolation';
import { querySurfaceSlopeAt } from '../src/engine/cad/surfaceAnalysis';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { commitLandXmlImport } from '../src/engine/cad/cadLandxmlCommit';
import { createBlankCadProject } from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import { backfillCadSurfaces, clearSurfaceBuildCacheOnLoad } from '../src/engine/cad/cadSurfaceTypes';
import { createCadHistoryState, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import type { CadProject } from '../src/engine/cad/cadTypes';

const METRIC =
  '<Units><Metric areaUnit="squareMeter" linearUnit="meter" volumeUnit="cubicMeter" temperatureUnit="celsius" pressureUnit="HPA" /></Units>';
const FT =
  '<Units><Imperial areaUnit="squareFoot" linearUnit="foot" volumeUnit="cubicFeet" temperatureUnit="celsius" pressureUnit="HPA" /></Units>';

const doc = (body: string, units = METRIC): string =>
  `<LandXML xmlns="http://www.landxml.org/schema/LandXML-1.2" date="2026-09-19" time="12:00:00" version="1.2">${units}${body}</LandXML>`;

// N E Z points of a 10×10 square: ids arbitrary + non-contiguous (start at 7).
const squarePoints = (z: (_e: number, _n: number) => number): string =>
  [[7, 0, 0], [12, 10, 0], [25, 10, 10], [31, 0, 10]]
    .map(([id, e, n]) => `<P id="${id}">${n} ${e} ${z(e, n)}</P>`)
    .join('');

const squareDoc = (z: (_e: number, _n: number) => number, faces = '<F>7 12 25</F><F>7 25 31</F>'): string =>
  doc(`<Surfaces><Surface name="EG" desc="existing"><Definition surfType="TIN"><Pnts>${squarePoints(z)}</Pnts><Faces>${faces}</Faces></Definition></Surface></Surfaces>`);

const egOf = (preview: ReturnType<typeof buildLandXmlImportPreview>): NonNullable<ReturnType<typeof buildLandXmlImportPreview>['surfaces'][number]> =>
  preview.surfaces[0]!;

const blank = (): CadProject => createBlankCadProject({ name: 't', units: 'm' });

describe('LandXML TIN surface import', () => {
  it('imports a flat square: 4 vertices, 2 CCW faces, center elevation exact', () => {
    const preview = buildLandXmlImportPreview(squareDoc(() => 10));
    const surface = egOf(preview);
    expect(surface.disposition).toBe('IMPORTABLE');
    expect(surface.vertices).toHaveLength(12);
    expect(surface.faces).toHaveLength(6);
    const project = blank();
    const committed = commitLandXmlImport(createCadHistoryState(project), createCadSurfaceCache('t1'), preview, 'eg.xml');
    expect(committed.report.committed).toBe(true);
    expect(committed.report.surfacesAdded).toBe(1);
    expect(committed.report.meshesBuilt).toBe(1);
    const built = buildCadSurface(committed.state.present.project, committed.state.present.project.surfaces![0]!);
    expect(built.outcome).toBe('ok');
    expect(built.triangles).toHaveLength(2);
    expect(getSurfaceElevationAt(built, 5, 5)).toBeCloseTo(10, 9);
    expect(built.stats.planimetricArea).toBeCloseTo(100, 9);
    expect(built.stats.meanElevation).toBeCloseTo(10, 9);
  });

  it('imports a planar slope exactly (z = easting)', () => {
    const preview = buildLandXmlImportPreview(squareDoc((e) => e));
    const committed = commitLandXmlImport(createCadHistoryState(blank()), createCadSurfaceCache('t2'), preview, 'slope.xml');
    const built = buildCadSurface(committed.state.present.project, committed.state.present.project.surfaces![0]!);
    expect(getSurfaceElevationAt(built, 3, 7)).toBeCloseTo(3, 9);
    expect(getSurfaceElevationAt(built, 9.5, 0.5)).toBeCloseTo(9.5, 9);
    const slope = querySurfaceSlopeAt(built.points, built.triangles, 3, 7);
    expect(slope?.slopePercent).toBeCloseTo(100, 6);
  });

  it('imports a ridge and a bowl with exact peak/pit elevations', () => {
    const ridge =
      `<P id="1">0 0 0</P><P id="2">0 10 0</P><P id="3">10 10 0</P>` +
      `<P id="4">10 0 0</P><P id="5">5 5 4</P>`;
    const preview = buildLandXmlImportPreview(doc(
      `<Surfaces><Surface name="R"><Definition surfType="TIN"><Pnts>${ridge}</Pnts>` +
      `<Faces><F>1 2 5</F><F>2 3 5</F><F>3 4 5</F><F>4 1 5</F></Faces></Definition></Surface></Surfaces>`,
    ));
    expect(preview.surfaces[0]?.disposition).toBe('IMPORTABLE');
    const committed = commitLandXmlImport(createCadHistoryState(blank()), createCadSurfaceCache('t3'), preview, 'ridge.xml');
    const built = buildCadSurface(committed.state.present.project, committed.state.present.project.surfaces![0]!);
    expect(getSurfaceElevationAt(built, 5, 5)).toBeCloseTo(4, 9);
    expect(getSurfaceElevationAt(built, 5, 2.5)).toBeCloseTo(2, 9);
    expect(built.stats.maxZ).toBeCloseTo(4, 9);
  });

  it('honors voids: inside-hole queries return null, skirt stays exact', () => {
    // 3×3 grid z=0, center quad (no faces) = hole.
    let pnts = '';
    const idAt = (e: number, n: number): number => 100 + n * 3 + e;
    for (let n = 0; n < 3; n += 1) {
      for (let e = 0; e < 3; e += 1) pnts += `<P id="${idAt(e, n)}">${n * 10} ${e * 10} 5</P>`;
    }
    let faces = '';
    for (let n = 0; n < 2; n += 1) {
      for (let e = 0; e < 2; e += 1) {
        if (e === 0 && n === 0) continue; // hole over the (0..10, 0..10) quad
        const a = idAt(e, n);
        const b = idAt(e + 1, n);
        const c = idAt(e + 1, n + 1);
        const d = idAt(e, n + 1);
        faces += `<F>${a} ${b} ${c}</F><F>${a} ${c} ${d}</F>`;
      }
    }
    const preview = buildLandXmlImportPreview(doc(
      `<Surfaces><Surface name="V"><Definition surfType="TIN"><Pnts>${pnts}</Pnts><Faces>${faces}</Faces></Definition></Surface></Surfaces>`,
    ));
    expect(preview.surfaces[0]?.disposition).toBe('IMPORTABLE');
    const committed = commitLandXmlImport(createCadHistoryState(blank()), createCadSurfaceCache('t4'), preview, 'void.xml');
    const built = buildCadSurface(committed.state.present.project, committed.state.present.project.surfaces![0]!);
    expect(built.triangles).toHaveLength(6);
    expect(getSurfaceElevationAt(built, 5, 5)).toBeNull();
    expect(getSurfaceElevationAt(built, 15, 15)).toBeCloseTo(5, 9);
  });

  it('keeps same-points/different-faces topologically different', () => {
    const a = buildLandXmlImportPreview(squareDoc((e, n) => (e * n) / 10));
    const b = buildLandXmlImportPreview(squareDoc((e, n) => (e * n) / 10, '<F>7 12 31</F><F>12 25 31</F>'));
    expect(a.surfaces[0]?.faces).not.toEqual(b.surfaces[0]?.faces);
    expect(a.surfaces[0]?.vertices).toEqual(b.surfaces[0]?.vertices);
    const ma = commitLandXmlImport(createCadHistoryState(blank()), createCadSurfaceCache('ta'), a, 'a.xml');
    const mb = commitLandXmlImport(createCadHistoryState(blank()), createCadSurfaceCache('tb'), b, 'b.xml');
    const ba = buildCadSurface(ma.state.present.project, ma.state.present.project.surfaces![0]!);
    const bb = buildCadSurface(mb.state.present.project, mb.state.present.project.surfaces![0]!);
    const key = (t: readonly (readonly number[])[]): string[] =>
      t.map((tri) => [...tri].sort((x, y) => (x as number) - (y as number)).join('>')).sort();
    expect(key(ba.triangles)).not.toEqual(key(bb.triangles));
  });

  it('dedupes duplicate-XY same-Z with WARNING, blocks materially-different-Z', () => {
    const dupe = squareDoc(() => 10).replace('<P id="31">10 0 10</P>', '<P id="31">10 0 10</P><P id="42">10 0 10</P>');
    const preview = buildLandXmlImportPreview(dupe);
    expect(preview.surfaces[0]?.disposition).toBe('WARNING');
    expect(preview.surfaces[0]?.vertices).toHaveLength(12);
    const conflict = squareDoc(() => 10).replace('</Pnts>', '<P id="42">10 0 99</P></Pnts>');
    const blocked = buildLandXmlImportPreview(conflict);
    expect(blocked.surfaces[0]?.disposition).toBe('BLOCKED');
    expect(blocked.surfaces[0]?.reasonCode).toBe('LANDXML_SURFACE_DUPLICATE_XY_CONFLICT');
  });

  it('blocks non-manifold edges and GRID surfaces with stable codes', () => {
    // Three distinct CCW triangles sharing edge 1>2 (non-manifold fan).
    const fan =
      `<P id="1">0 0 0</P><P id="2">0 10 0</P><P id="3">5 5 1</P><P id="4">-5 5 1</P><P id="5">2 5 9</P>`;
    const nm = buildLandXmlImportPreview(doc(
      `<Surfaces><Surface name="NM"><Definition surfType="TIN"><Pnts>${fan}</Pnts>` +
      `<Faces><F>1 2 3</F><F>1 2 4</F><F>1 2 5</F></Faces></Definition></Surface></Surfaces>`,
    ));
    expect(nm.surfaces[0]?.disposition).toBe('BLOCKED');
    expect(nm.surfaces[0]?.reasonCode).toBe('LANDXML_SURFACE_NON_MANIFOLD');
    const grid = buildLandXmlImportPreview(doc(
      `<Surfaces><Surface name="G"><Definition surfType="grid"><Pnts>${fan}</Pnts><Faces><F>1 2 3</F></Faces></Definition></Surface></Surfaces>`,
    ));
    expect(grid.surfaces[0]?.disposition).toBe('UNSUPPORTED');
    expect(grid.surfaces[0]?.reasonCode).toBe('LANDXML_SURFACE_GRID_UNSUPPORTED');
    expect(grid.surfaces[0]?.faces).toHaveLength(0);
  });

  it('scales ft surfaces by the international foot and pins N-E order across objects', () => {
    const ftDoc = doc(
      `<CgPoints><CgPoint name="C1">100 1000 10</CgPoint></CgPoints>` +
      `<Surfaces><Surface name="F"><Definition surfType="TIN"><Pnts><P id="1">100 1000 10</P><P id="2">100 2000 10</P><P id="3">200 2000 10</P></Pnts><Faces><F>1 2 3</F></Faces></Definition></Surface></Surfaces>` +
      `<Alignments><Alignment name="A" staStart="0"><CoordGeom><Line><Start>100 1000 10</Start><End>100 2000 10</End></Line></CoordGeom></Alignment></Alignments>`,
      FT,
    );
    const preview = buildLandXmlImportPreview(ftDoc, { fileName: 'ft.xml' });
    expect(preview.units).toBe('ft');
    const cg = preview.points[0]!;
    expect(cg.x).toBeCloseTo(1000 * 0.3048, 9);
    expect(cg.y).toBeCloseTo(100 * 0.3048, 9);
    // Same coordinate text resolves to the same E/N in Surface P and Alignment Start.
    const v = preview.surfaces[0]!.vertices;
    expect(v[0]).toBeCloseTo(cg.x, 12);
    expect(v[1]).toBeCloseTo(cg.y, 12);
    const line = preview.alignments[0]!.elements[0]!;
    expect(line.kind).toBe('line');
    if (line.kind === 'line') {
      expect(line.start.x).toBeCloseTo(cg.x, 12);
      expect(line.start.y).toBeCloseTo(cg.y, 12);
    }
  });

  it('commits atomically: undo restores, duplicates skip, names deconflict, IDs stay stable', () => {
    const preview = buildLandXmlImportPreview(squareDoc(() => 7), { fileName: 'dup.xml' });
    const cache = createCadSurfaceCache('t5');
    const first = commitLandXmlImport(createCadHistoryState(blank()), cache, preview, 'dup.xml');
    expect(first.report.committed).toBe(true);
    const before = first.state.present.project;
    // Exact-duplicate re-import: nothing added, reported, drawing unchanged.
    const second = commitLandXmlImport(first.state, cache, preview, 'dup.xml');
    expect(second.report.committed).toBe(false);
    expect(second.state.present.project).toBe(before);
    // Undo of the first commit restores the blank drawing.
    const undone = undoCadHistory(first.state);
    expect(undone.present.project.entities).toHaveLength(0);
    expect(undone.present.project.surfaces ?? []).toHaveLength(0);
    // Stable IDs: a fresh commit of the same file mints the same entity/surface ids.
    const other = commitLandXmlImport(createCadHistoryState(blank()), createCadSurfaceCache('t6'), preview, 'dup.xml');
    expect(other.state.present.project.surfaces![0]!.id).toBe(before.surfaces![0]!.id);
    // Duplicate-safe names: pre-existing "EG" forces "EG (2)".
    const clashBase = createBlankCadProject({ name: 'clash', units: 'm' });
    const clashSeed = commitLandXmlImport(createCadHistoryState(clashBase), createCadSurfaceCache('t7'), preview, 'dup.xml');
    const clash = commitLandXmlImport(
      clashSeed.state,
      createCadSurfaceCache('t8'),
      buildLandXmlImportPreview(squareDoc((e) => e + 100)),
      'other.xml',
    );
    // Different topology (different Z) → added under a deconflicted name.
    expect(clash.report.surfacesAdded).toBe(1);
    expect(clash.report.renamed).toContain('EG (2)');
  });

  it('rejects selecting a BLOCKED surface: drawing unchanged', () => {
    const preview = buildLandXmlImportPreview(squareDoc(() => 10));
    const bad = buildLandXmlImportPreview(squareDoc(() => 10).replace('</Pnts>', '<P id="42">10 0 99</P></Pnts>'));
    void preview;
    const state = createCadHistoryState(blank());
    const { state: next, report } = commitLandXmlImport(state, createCadSurfaceCache('t9'), bad, 'bad.xml', {
      surfaceNames: ['EG'],
    });
    expect(report.committed).toBe(false);
    expect(report.error).toMatch(/BLOCKED/);
    expect(next).toBe(state);
  });

  it('reopens WNCAD-exact: clone round-trip rebuilds identical topology without XML', () => {
    const preview = buildLandXmlImportPreview(squareDoc((e, n) => e + 2 * n));
    const committed = commitLandXmlImport(createCadHistoryState(blank()), createCadSurfaceCache('t10'), preview, 'reopen.xml');
    const project = committed.state.present.project;
    const surface = project.surfaces![0]!;
    expect(deriveSurfaceStatus(project, surface)).toBe('CURRENT');
    // Simulate save/reopen: JSON round-trip + load-time backfill (mesh never persists).
    const reopened = JSON.parse(JSON.stringify(cloneCadProject(project))) as CadProject;
    reopened.surfaces = backfillCadSurfaces(reopened.surfaces).map(clearSurfaceBuildCacheOnLoad);
    expect(reopened.surfaces![0]!.cachedRevision).toBeNull();
    const before = buildCadSurface(project, surface);
    const after = buildCadSurface(reopened, reopened.surfaces![0]!);
    expect(after.outcome).toBe('ok');
    expect(after.triangles).toEqual(before.triangles);
    expect(after.points).toEqual(before.points);
    expect(after.stats).toEqual(before.stats);
    expect(computeCadSurfaceSourceRevision(reopened, reopened.surfaces![0]!)).toBe(
      computeCadSurfaceSourceRevision(project, surface),
    );
  });
});
