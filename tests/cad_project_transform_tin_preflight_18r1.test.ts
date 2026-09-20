// Phase 18R.1 Finding C — imported-TIN fail-closed preflight for PROJECTTRANSFORM.
//
// Malformed imported-TIN surfaces must BLOCK the whole-drawing transform with
// zero mutation (project/draft/history/computation). Valid TINs keep the exact
// Phase 18R behavior: XY transformed, Z unchanged, faces + provenance identical,
// no reorder/Delaunay. Agent tier: fast, deterministic.
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { createBlankDraftDocument, type DraftDocument } from '../src/engine/cad/cadDraftTypes';
import { validateImportedTinPayload } from '../src/engine/cad/cadImportedTin';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  applyCadProjectCoordinateTransform,
  applyCadProjectTransform,
  PROJECT_TRANSFORM_IMPORTED_TIN_INVALID,
  PROJECT_COORDINATE_TRANSFORM_TOOL_KEY,
} from '../src/engine/cad/cadProjectTransform';
import { applyPoint, rotationAbout, uniformScaleAbout } from '../src/engine/cad/cadTransform2D';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import type { CadProject, ImportedTinPayload } from '../src/engine/cad/cadTypes';
import { parseSurfaces } from './landxmlCivilTestSupport';

const LAYER = 'L';
const FIXED_ISO = '2026-09-20T12:00:00.000Z';
const SURFACE_ID = 'surf-i';
const VALID_VERTICES = [0, 0, 1, 30, 0, 2, 30, 40, 3, 0, 40, 4];
const VALID_FACES = [0, 1, 2, 0, 2, 3];
const PROVENANCE: ImportedTinPayload['provenance'] = {
  format: 'LandXML',
  fileName: 'i.xml',
  surfaceName: 'I',
};

const validPayload = (): ImportedTinPayload => ({
  vertices: [...VALID_VERTICES],
  faces: [...VALID_FACES],
  provenance: { ...PROVENANCE },
});

const projectWithTin = (payload?: ImportedTinPayload): CadProject => {
  const project = createBlankCadProject({ name: 'T18R1', units: 'm' });
  project.layers = [{ id: LAYER, name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }];
  project.currentLayerId = LAYER;
  project.entities = [];
  project.surfaces = [{
    id: SURFACE_ID,
    name: 'I',
    definition: {
      pointSource: { kind: 'points', pointEntityIds: [] },
      sourceKind: 'imported-tin',
      ...(payload ? { importedTin: payload } : {}),
    },
  }];
  return project;
};

const GRID_GROUND = {
  kind: 'GRID_GROUND',
  originE: 0,
  originN: 0,
  combinedScaleFactor: 2,
  direction: 'GRID_TO_GROUND',
} as const;

const expectBlocked = (reason: string, expectedDetail: string): void => {
  expect(reason.startsWith(`${PROJECT_TRANSFORM_IMPORTED_TIN_INVALID}:${SURFACE_ID}: `)).toBe(true);
  expect(reason).toContain(expectedDetail);
};

const snapshot = (value: unknown): string => JSON.stringify(value);

describe('18R.1 imported-TIN preflight blocks malformed payloads atomically', () => {
  const malformed: Array<[string, ImportedTinPayload]> = [
    ['non-triple vertex array', { vertices: [0, 0, 1, 10, 0], faces: [...VALID_FACES], provenance: { ...PROVENANCE } }],
    ['NaN coordinate', { vertices: [0, 0, 1, Number.NaN, 0, 2, 30, 40, 3, 0, 40, 4], faces: [0, 1, 2, 0, 2, 3], provenance: { ...PROVENANCE } }],
    ['Infinity coordinate', { vertices: [0, 0, 1, Number.POSITIVE_INFINITY, 0, 2, 30, 40, 3, 0, 40, 4], faces: [0, 1, 2, 0, 2, 3], provenance: { ...PROVENANCE } }],
    ['degenerate face', { vertices: [...VALID_VERTICES], faces: [0, 1, 1], provenance: { ...PROVENANCE } }],
    ['clockwise face', { vertices: [0, 0, 1, 0, 10, 2, 10, 0, 3], faces: [0, 1, 2], provenance: { ...PROVENANCE } }],
    ['out-of-range index', { vertices: [...VALID_VERTICES], faces: [0, 1, 9], provenance: { ...PROVENANCE } }],
  ];

  it.each(malformed)('%s → ok:false with stable reason code', (_label, payload) => {
    const required = validateImportedTinPayload(payload);
    expect(required).not.toBeNull();
    const applied = applyCadProjectCoordinateTransform(projectWithTin(payload), uniformScaleAbout(0, 0, 2), {
      transformId: 't-18r1', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(false);
    if (applied.ok) throw new Error('expected block');
    expectBlocked(applied.reason, required!);
    // No raw payload dump: the reason never embeds the vertex/face arrays.
    expect(applied.reason).not.toContain(String(payload.vertices.join(',')));
  });

  it('missing importedTin on an imported-tin surface → BLOCK', () => {
    const applied = applyCadProjectCoordinateTransform(projectWithTin(), uniformScaleAbout(0, 0, 2), {
      transformId: 't-18r1-missing', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(false);
    if (applied.ok) throw new Error('expected block');
    expectBlocked(applied.reason, 'imported TIN definition missing.');
  });

  it('production command seam: project/draft/history/computation untouched on failure', () => {
    const project = projectWithTin({ vertices: [0, 0, 1, 10, 0], faces: [...VALID_FACES], provenance: { ...PROVENANCE } });
    const draft: DraftDocument = createBlankDraftDocument({ projectId: project.id, layers: project.layers });
    const projectBefore = snapshot(project);
    const draftBefore = snapshot(draft);
    const history = createCadHistoryState(project, []);
    const next = runCadCommand(history, { key: 'PROJECTTRANSFORM', request: GRID_GROUND });
    expect(next).toBe(history);
    expect(next.undoStack).toHaveLength(0);
    expect(next.redoStack).toHaveLength(0);
    expect(next.present.project.cogoComputations).toHaveLength(0);
    expect(next.present.project).toBe(project);
    expect(snapshot(next.present.project)).toBe(projectBefore);

    // Direct-kernel draft atomicity: an invalid payload returns ok:false and
    // never touches the provided draft (no viewport/label move).
    const kernel = applyCadProjectCoordinateTransform(project, uniformScaleAbout(0, 0, 2), { draft, createdAtIso: FIXED_ISO });
    expect(kernel.ok).toBe(false);
    expect(snapshot(draft)).toBe(draftBefore);
  });

  it('request-level Helmert entry shares the same preflight', () => {
    const project = projectWithTin({ vertices: [...VALID_VERTICES], faces: [0, 1, 1], provenance: { ...PROVENANCE } });
    const solved = applyCadProjectTransform(project, {
      kind: 'HELMERT_2D',
      mode: 'SIMILARITY',
      pairs: [
        { sourceE: 0, sourceN: 0, targetE: 1, targetN: 1 },
        { sourceE: 10, sourceN: 0, targetE: 11, targetN: 1 },
      ],
    });
    expect(solved.ok).toBe(false);
    if (solved.ok) throw new Error('expected block');
    expect(solved.reason.startsWith(PROJECT_TRANSFORM_IMPORTED_TIN_INVALID)).toBe(true);
  });
});

describe('18R.1 valid imported-TIN behavior is preserved exactly', () => {
  it('XY transformed, Z unchanged, faces byte-identical, provenance identical', () => {
    const payload = validPayload();
    const project = projectWithTin(payload);
    const transform = uniformScaleAbout(0, 0, 2);
    const applied = applyCadProjectCoordinateTransform(project, transform, {
      transformId: 't-18r1-valid', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const moved = applied.project.surfaces![0]!.definition.importedTin!;
    expect(validateImportedTinPayload(moved)).toBeNull();
    for (let i = 0; i < payload.vertices.length; i += 3) {
      const expected = applyPoint(transform, { x: payload.vertices[i]!, y: payload.vertices[i + 1]! });
      expect(moved.vertices[i]).toBe(expected.x);
      expect(moved.vertices[i + 1]).toBe(expected.y);
      expect(moved.vertices[i + 2]).toBe(payload.vertices[i + 2]);
    }
    expect(moved.faces).toEqual(payload.faces);
    expect(moved.provenance).toEqual(payload.provenance);
    // Source arrays never mutated in place.
    expect(project.surfaces![0]!.definition.importedTin!.vertices).toEqual(payload.vertices);
  });

  it('same-points/different-faces payloads stay distinct through the transform', () => {
    const payloadB: ImportedTinPayload = {
      vertices: [...VALID_VERTICES], faces: [0, 1, 3, 1, 2, 3], provenance: { ...PROVENANCE },
    };
    const transform = uniformScaleAbout(0, 0, 3);
    const movedA = applyCadProjectCoordinateTransform(projectWithTin(validPayload()), transform, { createdAtIso: FIXED_ISO });
    const movedB = applyCadProjectCoordinateTransform(projectWithTin(payloadB), transform, { createdAtIso: FIXED_ISO });
    expect(movedA.ok && movedB.ok).toBe(true);
    if (!movedA.ok || !movedB.ok) throw new Error('transform failed');
    expect(movedA.project.surfaces![0]!.definition.importedTin!.faces).toEqual(VALID_FACES);
    expect(movedB.project.surfaces![0]!.definition.importedTin!.faces).toEqual(payloadB.faces);
    expect(movedA.project.surfaces![0]!.definition.importedTin!.faces)
      .not.toEqual(movedB.project.surfaces![0]!.definition.importedTin!.faces);
  });

  it('LandXML export→reimport after transform preserves vertices + exact faces', () => {
    const project = projectWithTin(validPayload());
    const applied = applyCadProjectCoordinateTransform(project, rotationAbout(0, 0, 45), {
      transformId: 't-18r1-landxml', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const movedTin = applied.project.surfaces![0]!.definition.importedTin!;
    const surface = applied.project.surfaces![0]!;
    const built = buildCadSurface(applied.project, surface);
    expect(built.outcome).toBe('ok');
    const cache = createCadSurfaceCache('landxml-18r1');
    const revision = computeCadSurfaceSourceRevision(applied.project, surface);
    const current = applySurfaceBuildSuccess(applied.project, cache, surface.id, revision, built);
    const exported = buildLandXmlProjectExportWithResult(
      current,
      { units: 'm', projectName: 'T18R1', generatedAt: new Date(FIXED_ISO) },
      { surfaceCache: cache },
    );
    const surfaces = parseSurfaces(exported.output);
    expect(surfaces).toHaveLength(1);
    const parsed = surfaces[0]!;
    expect(parsed.faces.map((face) => face.map((index) => index - 1)).flat()).toEqual(movedTin.faces);
    const reimported = parsed.points.flatMap((p) => [p.e, p.n, p.z]);
    for (let i = 0; i < reimported.length; i += 1) {
      expect(reimported[i]).toBeCloseTo(movedTin.vertices[i]!, 6);
    }
  });

  it('valid transform round-trips through save/reopen with identical faces', () => {
    const applied = applyCadProjectCoordinateTransform(projectWithTin(validPayload()), uniformScaleAbout(0, 0, 2), {
      transformId: 't-18r1-save', createdAtIso: FIXED_ISO,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('transform failed');
    const document = { ...createBlankCadDrawingDocument({ name: 'T18R1', units: 'm' }), project: applied.project };
    const parsed = parseCadDrawingFile(serializeCadDrawingFile(document));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    expect(parsed.drawing.project.surfaces![0]!.definition.importedTin).toEqual(
      applied.project.surfaces![0]!.definition.importedTin,
    );
    expect(
      parsed.drawing.project.cogoComputations.filter((entry) => entry.toolKey === PROJECT_COORDINATE_TRANSFORM_TOOL_KEY),
    ).toHaveLength(1);
  });
});
