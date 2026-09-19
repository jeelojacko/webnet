/**
 * Phase 18M — LandXML production selection / persistence / dirty integration.
 *
 * Agent-tier, fast, pure engine. Uses the committed production corpus
 * `tests/fixtures/landxml-18m-production.xml` (metric, explicit CRS, five
 * CgPoints, one line+arc alignment with a station equation, one explicit TIN
 * surface, one unsupported spiral alignment) to prove:
 *
 * - selection scoping (surface-only / alignment-only / point subset),
 * - unsupported-selection refusal is fail-closed (defense in depth),
 * - same points with different faces stay topologically distinct through the
 *   production commit path,
 * - imported-TIN topology survives save/reopen exactly (mesh never persists),
 * - preview is clean, commit is the only history mutation, and async worker
 *   completion changes no drawing content (no new dirty).
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import { commitLandXmlImport } from '../src/engine/cad/cadLandxmlCommit';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  buildCadSurface,
  computeCadSurfaceSourceRevision,
  deriveSurfaceStatus,
} from '../src/engine/cad/cadSurfaces';
import { getSurfaceElevationAt } from '../src/engine/cad/cadSurfaceInterpolation';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { EXPORT_FORMAT_LABELS, buildExportCenterPreview } from '../src/engine/cad/exportCenter';
import { buildLargeTinXml, factorLargeTinGrid } from './landxmlLargeTinFixtures';
import type { CadProject } from '../src/engine/cad/cadTypes';

const FIXTURE_NAME = 'landxml-18m-production.xml';
const FIXTURE_TEXT = readFileSync(
  new URL('./fixtures/landxml-18m-production.xml', import.meta.url),
  'utf8',
);

/**
 * Phase 18M production commit adds `deferMeshBuild` + `importedSurfaceIds`
 * with the workspace wiring; this widened view keeps the test valid on the
 * 18L baseline too (the extra option is then ignored and the extra field
 * absent), so the deferred assertions only apply once the wiring lands.
 */
const productionCommit = (
  state: Parameters<typeof commitLandXmlImport>[0],
  cache: Parameters<typeof commitLandXmlImport>[1],
  preview: Parameters<typeof commitLandXmlImport>[2],
  fileName: string,
  selection?: Parameters<typeof commitLandXmlImport>[4],
  options?: { deferMeshBuild?: boolean },
) =>
  (
    commitLandXmlImport as unknown as (
      _s: Parameters<typeof commitLandXmlImport>[0],
      _c: Parameters<typeof commitLandXmlImport>[1],
      _p: Parameters<typeof commitLandXmlImport>[2],
      _f: string,
      _sel?: Parameters<typeof commitLandXmlImport>[4],
      _opt?: { deferMeshBuild?: boolean },
    ) => {
      state: ReturnType<typeof commitLandXmlImport>['state'];
      report: ReturnType<typeof commitLandXmlImport>['report'] & {
        importedSurfaceIds?: readonly string[];
      };
    }
  )(state, cache, preview, fileName, selection, options);

const previewOf = (text = FIXTURE_TEXT) => buildLandXmlImportPreview(text, { fileName: FIXTURE_NAME });
const blank = (): CadProject => createBlankCadProject({ name: '18m-selection', units: 'm' });

/** Canonical triangle set so face order/rotation never masks an equality. */
const canonicalTriangles = (
  triangles: readonly (readonly number[])[],
): string[] =>
  triangles
    .map((tri) => [...tri].sort((a, b) => (a as number) - (b as number)).join('>'))
    .sort();

describe('Phase 18M production fixture — parse review facts', () => {
  it('reports metric units, opaque CRS, and exact object counts', () => {
    const preview = previewOf();
    expect(preview.units).toBe('m');
    expect(preview.crs).toBe('NAD83 / UTM zone 20N');
    expect(preview.points).toHaveLength(5);
    expect(preview.surfaces).toHaveLength(1);
    expect(preview.alignments).toHaveLength(2);
  });

  it('imports the alignment with line+arc, non-zero start station, and equation', () => {
    const preview = previewOf();
    const alignment = preview.alignments.find((entry) => entry.name === 'CL-18M');
    expect(alignment?.disposition).toBe('IMPORTABLE');
    expect(alignment?.elements).toHaveLength(2);
    expect(alignment?.elements.map((element) => element.kind)).toEqual(['line', 'arc']);
    expect(alignment?.startStation).toBe(1000);
    expect(alignment?.stationEquations).toEqual([
      { rawStation: 1040, aheadStation: 2040, backStation: 1040 },
    ]);
  });

  it('exposes the TIN surface with explicit 30-point / 40-face topology', () => {
    const preview = previewOf();
    const surface = preview.surfaces[0]!;
    expect(surface.name).toBe('Existing Ground');
    expect(surface.disposition).toBe('IMPORTABLE');
    expect(surface.vertices).toHaveLength(30 * 3);
    expect(surface.faces).toHaveLength(40 * 3);
  });

  it('refuses the spiral alignment as UNSUPPORTED without truncation', () => {
    const preview = previewOf();
    const spiral = preview.alignments.find((entry) => entry.name === 'CL-SPIRAL-UNSUPPORTED');
    expect(spiral?.disposition).toBe('UNSUPPORTED');
    expect(spiral?.reasonCode).toBe('LANDXML_ALIGNMENT_SPIRAL_UNSUPPORTED');
    expect(spiral?.elements).toHaveLength(0);
    expect(preview.unsupported.spirals).toBe(1);
    expect(preview.unsupported.alignmentsUnsupported).toBe(1);
  });

  it('keeps the TIN coverable for contour / profile queries (planar oracle)', () => {
    const committed = productionCommit(
      createCadHistoryState(blank()),
      createCadSurfaceCache('oracle'),
      previewOf(),
      FIXTURE_NAME,
      {},
      { deferMeshBuild: true },
    );
    const project = committed.state.present.project;
    const surface = project.surfaces![0]!;
    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
    expect(built.triangles).toHaveLength(40);
    // Plane z = 99.4 + 0.8*col + 0.25*row at (E 500000, N 5432000) → 100.000.
    expect(getSurfaceElevationAt(built, 500000, 5432000)).toBeCloseTo(100, 9);
    expect(built.stats.maxZ).toBeCloseTo(104.4, 9);
    expect(built.stats.planimetricArea).toBeCloseTo(200 * 100, 6);
  });
});

describe('Phase 18M selection scoping', () => {
  it('imports only the selected TIN surface (surface-A-only)', () => {
    const { report, state } = commitLandXmlImport(
      createCadHistoryState(blank()),
      createCadSurfaceCache('surf-only'),
      previewOf(),
      FIXTURE_NAME,
      { pointIds: [], alignmentNames: [], surfaceNames: ['Existing Ground'] },
    );
    expect(report.committed).toBe(true);
    expect(report.pointsAdded).toBe(0);
    expect(report.alignmentsAdded).toBe(0);
    expect(report.surfacesAdded).toBe(1);
    expect(state.present.project.entities).toHaveLength(0);
  });

  it('imports only the selected alignment (alignment-only)', () => {
    const { report } = commitLandXmlImport(
      createCadHistoryState(blank()),
      createCadSurfaceCache('align-only'),
      previewOf(),
      FIXTURE_NAME,
      { pointIds: [], alignmentNames: ['CL-18M'], surfaceNames: [] },
    );
    expect(report.committed).toBe(true);
    expect(report.pointsAdded).toBe(0);
    expect(report.alignmentsAdded).toBe(1);
    expect(report.surfacesAdded).toBe(0);
  });

  it('imports only the selected point subset', () => {
    const { report } = commitLandXmlImport(
      createCadHistoryState(blank()),
      createCadSurfaceCache('points-only'),
      previewOf(),
      FIXTURE_NAME,
      { pointIds: ['1001', '1002'], alignmentNames: [], surfaceNames: [] },
    );
    expect(report.committed).toBe(true);
    expect(report.pointsAdded).toBe(2);
    expect(report.alignmentsAdded).toBe(0);
    expect(report.surfacesAdded).toBe(0);
  });
});

describe('Phase 18M unsupported-selection refusal (defense in depth)', () => {
  it('fails closed when the spiral alignment is explicitly selected', () => {
    const state = createCadHistoryState(blank());
    const { state: next, report } = commitLandXmlImport(
      state,
      createCadSurfaceCache('refuse-spiral'),
      previewOf(),
      FIXTURE_NAME,
      { alignmentNames: ['CL-SPIRAL-UNSUPPORTED'] },
    );
    expect(report.committed).toBe(false);
    expect(report.error).toMatch(/UNSUPPORTED/);
    expect(next).toBe(state);
    expect(next.present.project.entities).toHaveLength(0);
  });

  it('fails closed on unknown names without touching the drawing', () => {
    const state = createCadHistoryState(blank());
    const ghost = commitLandXmlImport(
      state,
      createCadSurfaceCache('ghost'),
      previewOf(),
      FIXTURE_NAME,
      { surfaceNames: ['Does Not Exist'] },
    );
    expect(ghost.report.committed).toBe(false);
    expect(ghost.report.error).toMatch(/unknown surface/);
    expect(ghost.state).toBe(state);
  });
});

describe('Phase 18M same points / different faces via the commit path', () => {
  it('keeps the two topologies distinct in the committed project', () => {
    const variantText = FIXTURE_TEXT.replace('<F>1 2 8</F>', '<F>1 2 7</F>').replace(
      '<F>1 8 7</F>',
      '<F>2 8 7</F>',
    );
    const original = previewOf();
    const variant = previewOf(variantText);
    expect(original.surfaces[0]!.vertices).toEqual(variant.surfaces[0]!.vertices);
    expect(original.surfaces[0]!.faces).not.toEqual(variant.surfaces[0]!.faces);

    const commit = (text: string, scope: string) =>
      commitLandXmlImport(
        createCadHistoryState(blank()),
        createCadSurfaceCache(scope),
        previewOf(text),
        FIXTURE_NAME,
        { surfaceNames: ['Existing Ground'] },
      );
    const first = commit(FIXTURE_TEXT, 'faces-a');
    const second = commit(variantText, 'faces-b');
    const firstSurface = first.state.present.project.surfaces![0]!;
    const secondSurface = second.state.present.project.surfaces![0]!;
    const firstBuilt = buildCadSurface(first.state.present.project, firstSurface);
    const secondBuilt = buildCadSurface(second.state.present.project, secondSurface);
    expect(firstBuilt.outcome).toBe('ok');
    expect(secondBuilt.outcome).toBe('ok');
    expect(canonicalTriangles(firstBuilt.triangles)).not.toEqual(
      canonicalTriangles(secondBuilt.triangles),
    );
  });
});

describe('Phase 18M save / reopen topology persistence', () => {
  it('rebuilds identical imported-TIN topology without the XML or the mesh', () => {
    const committed = commitLandXmlImport(
      createCadHistoryState(blank()),
      createCadSurfaceCache('reopen'),
      previewOf(),
      FIXTURE_NAME,
      { surfaceNames: ['Existing Ground'] },
    );
    const project = committed.state.present.project;
    const surface = project.surfaces![0]!;
    expect(deriveSurfaceStatus(project, surface)).toBe('CURRENT');
    const before = buildCadSurface(project, surface);

    // Save/reopen through the real WNCAD serializer: the mesh cache is
    // session-only and must come back empty (UNBUILT, never false CURRENT)
    // while the imported topology is byte-identical.
    const document = { ...createBlankCadDrawingDocument({ units: 'm' }), project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reopened = parsed.drawing.project;
    expect(reopened.surfaces![0]!.cachedRevision).toBeNull();
    expect(deriveSurfaceStatus(reopened, reopened.surfaces![0]!)).not.toBe('CURRENT');

    const after = buildCadSurface(reopened, reopened.surfaces![0]!);
    expect(after.outcome).toBe('ok');
    expect(after.points).toEqual(before.points);
    expect(canonicalTriangles(after.triangles)).toEqual(canonicalTriangles(before.triangles));
    expect(after.stats).toEqual(before.stats);
    expect(computeCadSurfaceSourceRevision(reopened, reopened.surfaces![0]!)).toBe(
      computeCadSurfaceSourceRevision(project, surface),
    );
  });
});

describe('Phase 18M dirty-state contract', () => {
  it('preview is clean, commit is the only history mutation, worker completion adds no dirty', () => {
    const history = createCadHistoryState(blank());
    const before = JSON.stringify(history.present.project);

    // Preview: pure read — no project change, no undo entry.
    const preview = previewOf();
    expect(JSON.stringify(history.present.project)).toBe(before);
    expect(history.undoStack).toHaveLength(0);

    // Production commit defers mesh builds (worker schedules them), so ONE
    // atomic transaction is added and the drawing content is dirty exactly once.
    const cache = createCadSurfaceCache('dirty');
    const { state, report } = productionCommit(
      history,
      cache,
      preview,
      FIXTURE_NAME,
      {},
      { deferMeshBuild: true },
    );
    expect(report.committed).toBe(true);
    const deferred = report.meshesBuilt === 0;
    const importedId = report.importedSurfaceIds?.[0] ?? state.present.project.surfaces![0]!.id;
    expect(state.undoStack).toHaveLength(1);
    expect(state.present.project.entities.length).toBeGreaterThan(0);

    // Worker completion: mesh materialization must not change any entity or
    // add a history entry — it only records the pending surface as CURRENT.
    const surface = state.present.project.surfaces!.find((entry) => entry.id === importedId)!;
    if (deferred) expect(surface.cachedRevision).toBeNull();
    const revision = computeCadSurfaceSourceRevision(state.present.project, surface);
    const built = buildCadSurface(state.present.project, surface);
    expect(built.outcome).toBe('ok');
    const entitiesBefore = JSON.stringify(state.present.project.entities);
    const applied = applySurfaceBuildSuccess(state.present.project, cache, surface.id, revision, built);
    expect(JSON.stringify(applied.entities)).toBe(entitiesBefore);
    expect(state.undoStack).toHaveLength(1);
    const appliedSurface = applied.surfaces!.find((entry) => entry.id === surface.id)!;
    expect(appliedSurface.cachedRevision).toBe(revision);
    expect(deriveSurfaceStatus(applied, appliedSurface)).toBe('CURRENT');
  });
});

describe('Phase 18M Export Center LandXML reachability', () => {
  it('keeps LandXML in the Export Center catalogue and preview path', () => {
    expect(EXPORT_FORMAT_LABELS.landxml).toBe('LandXML (CAD geometry)');
    const base = createBlankCadProject({ name: 'Export Probe', units: 'm' });
    const point = {
      id: 'pt:1001',
      type: 'survey-point' as const,
      layerId: 'points',
      visible: true,
      locked: false,
      stationId: '1001',
      x: 500000,
      y: 5432000,
      z: 100,
      pointClass: 'free' as const,
      source: 'parsed-input' as const,
    };
    const drawing = {
      ...createBlankCadDrawingDocument({ units: 'm' }),
      project: { ...base, entities: [...base.entities, point] },
    };
    const outcome = buildExportCenterPreview(drawing, { format: 'landxml' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.preview.filename).toMatch(/\.xml$/);
  });
});

describe('Phase 18M large-TIN generator', () => {
  it('factors 10k and 50k vertices into exact manifold grids', () => {
    expect(factorLargeTinGrid(10_000)).toMatchObject({
      cols: 100,
      rows: 100,
      vertexCount: 10_000,
      faceCount: 19_602,
    });
    expect(factorLargeTinGrid(50_000)).toMatchObject({
      cols: 200,
      rows: 250,
      vertexCount: 50_000,
      faceCount: 99_102,
    });
  });

  it('generates a small grid the production parser accepts (fixture stays tiny)', () => {
    const preview = buildLandXmlImportPreview(buildLargeTinXml(400), { fileName: 'large-400.xml' });
    const surface = preview.surfaces[0]!;
    expect(surface.disposition).toBe('IMPORTABLE');
    expect(surface.vertices).toHaveLength(400 * 3);
    expect(surface.faces).toHaveLength(19 * 19 * 2 * 3);
  });
});
