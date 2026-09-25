/**
 * Phase 18V persistence + PROJECTTRANSFORM pins (bulk/region edits).
 *
 * - WNCAD save/reopen keeps the ordered bulk stack exact (add E1 + bulk
 *   raise [P1,P2,E1] + bulk move + bulk set Z) and the reopened build yields
 *   the same final mesh; the session selection is NEVER restored.
 * - The imported TIN variant round-trips with a byte-identical payload.
 * - WNCAD semantic-history byte cost is measured at 10/100/1000 refs
 *   (documented, never gated).
 * - §105 commutativity: transforming the FINAL edited project equals
 *   transforming the PRE-edit project then building, under
 *   scale + 90° rotation + translation. A `move-points` delta is a
 *   displacement VECTOR (rotation+scale only, no translation), and the
 *   Grid/Ground scale touches dx/dy only.
 *
 * Pure engine reads; no UI, no worker.
 */
import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { applyCadProjectCoordinateTransform } from '../src/engine/cad/cadProjectTransform';
import { transformCadSurfaceEdits } from '../src/engine/cad/cadSurfaceEditTransform';
import {
  applyPoint,
  applyVector,
  compose,
  rotationAbout,
  translation,
  uniformScaleAbout,
} from '../src/engine/cad/cadTransform2D';
import { gridGroundTransform } from '../src/engine/cad/cadHelmert2D';
import type {
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
  ImportedTinPayload,
} from '../src/engine/cad/cadTypes';
import type { Build } from './cadSurfacePointEdits18tFixtures';

const FIXED = new Date('2026-09-25T12:00:00Z');
const plane = (x: number, y: number): number => 0.013 * x + 0.021 * y + 2.5;

const point = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id: `pt:${id}`,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

/**
 * Deterministic jittered grid: the jitter breaks cocircular ties so the
 * Delaunay diagonal is unique and therefore similarity-invariant across
 * PROJECTTRANSFORM.
 */
const jitterGrid = (side: number, surfaceId: string): { project: CadProject; surface: CadSurface } => {
  const base = createBlankCadProject({ name: 'T18V-persist', units: 'm' });
  const entities: CadSurveyPointEntity[] = [];
  for (let row = 0; row < side; row += 1) {
    for (let col = 0; col < side; col += 1) {
      const x = col * 10 + ((row * 7 + col * 3) % 5) * 0.31;
      const y = row * 10 + ((row * 2 + col * 5) % 4) * 0.27;
      entities.push(point(`${row}-${col}`, x, y, plane(x, y)));
    }
  }
  const surface: CadSurface = {
    id: surfaceId,
    name: 'Jitter grid',
    definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((entity) => entity.id) } },
  };
  return { project: { ...base, entities, surfaces: [surface] }, surface };
};

const ref = (entityId: string): { key: string } => ({ key: `source:${entityId}` });
const imp = (surfaceId: string, index: number): { key: string } => ({ key: `imported:${surfaceId}:${index}` });
const edit = (surfaceId: string, editId: string): { key: string } => ({ key: `edit:${surfaceId}:${editId}` });

const buildOf = (project: CadProject, surface: CadSurface): Build => {
  const build = buildCadSurface(project, surface);
  if (build.outcome !== 'ok') throw new Error(`fixture build ${build.outcome} ${JSON.stringify(build.editFailure ?? {})}`);
  return build;
};

/** Stable entity-key triangle digest (order-free); test-local, not a format. */
const digest = (build: Build, imported: boolean): string =>
  build.triangles
    .map((tri) => tri.map((i) => (imported ? `v${i}` : build.points[i]!.entityId)).sort().join('+'))
    .sort()
    .join('|');

const roundTrip = (project: CadProject) =>
  parseCadDrawingFile(serializeCadDrawingFile({
    ...createBlankCadDrawingDocument({ name: 'doc', units: 'm' }),
    project,
  }));

const withEdits = (surface: CadSurface, edits: CadSurfaceEdit[]): CadSurface => ({
  ...surface,
  definition: { ...surface.definition, edits },
});

const SELECTION_MARKER = 'phase18v-selection-marker';
const sessionSelection = (surfaceId: string): { surfaceId: string; revision: string; refs: Array<{ key: string }> } => ({
  surfaceId,
  revision: 'srev-session-old',
  refs: [{ key: SELECTION_MARKER }],
});

const importedPayload = (): ImportedTinPayload => ({
  vertices: [0, 0, 5, 10, 0, 6, 10, 10, 7, 0, 10, 8, 5, 5, 6.5],
  faces: [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4],
  provenance: { format: 'LandXML', fileName: 'src.xml', surfaceName: 'Imported', sourceId: 'sid-18v' },
});

const importedProject = (): { project: CadProject; surface: CadSurface } => {
  const base = createBlankCadProject({ name: 'T18V-import', units: 'm' });
  const surface: CadSurface = {
    id: 'surf-imported',
    name: 'Imported TIN',
    definition: {
      pointSource: { kind: 'points', pointEntityIds: [] },
      sourceKind: 'imported-tin',
      importedTin: importedPayload(),
    },
  };
  return { project: { ...base, surfaces: [surface] }, surface };
};

const nativeEdits = (surfaceId: string): CadSurfaceEdit[] => [
  { id: 'e-add', kind: 'add-point', x: 15, y: 15, z: plane(15, 15) + 3 },
  {
    id: 'e-raise', kind: 'raise-lower-points',
    vertices: [ref('pt:1-1'), ref('pt:2-2'), edit(surfaceId, 'e-add')], deltaZ: 5,
  },
  { id: 'e-move', kind: 'move-points', vertices: [ref('pt:1-1'), ref('pt:2-2')], deltaX: 0.3, deltaY: 0.2 },
  { id: 'e-set', kind: 'set-elevation-many', vertices: [ref('pt:1-3'), edit(surfaceId, 'e-add')], z: 7.5 },
];

const importedEdits = (surfaceId: string): CadSurfaceEdit[] => [
  { id: 'e-add', kind: 'add-point', x: 6, y: 3, z: 9 },
  {
    id: 'e-raise', kind: 'raise-lower-points',
    vertices: [imp(surfaceId, 4), imp(surfaceId, 0), edit(surfaceId, 'e-add')], deltaZ: 2,
  },
  { id: 'e-move', kind: 'move-points', vertices: [imp(surfaceId, 4)], deltaX: 0.2, deltaY: -0.1 },
  { id: 'e-set', kind: 'set-elevation-many', vertices: [imp(surfaceId, 0), edit(surfaceId, 'e-add')], z: 12 },
];

// ---------------------------------------------------------------------------
// WNCAD save / reopen
// ---------------------------------------------------------------------------

describe('18V WNCAD save/reopen (bulk kinds)', () => {
  it('native add+bulk raise+bulk move+bulk set round-trips exact; selection is not restored', () => {
    const { project, surface } = jitterGrid(4, 'surf-native');
    const edits = nativeEdits(surface.id);
    const editedSurface = withEdits(surface, edits);
    const editedProject: CadProject = { ...project, surfaces: [editedSurface] };
    const before = buildOf(editedProject, editedSurface);

    // A session selection is UI-only; its marker must never reach the file.
    const selection = sessionSelection(surface.id);
    const text = serializeCadDrawingFile({
      ...createBlankCadDrawingDocument({ name: 'doc', units: 'm' }),
      project: editedProject,
    });
    expect(text).not.toContain(SELECTION_MARKER);
    expect(text).not.toContain('"selection"');

    const parsed = roundTrip(editedProject);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    const reopened = parsed.drawing.project;
    const reopenedSurface = (reopened.surfaces ?? []).find((entry) => entry.id === surface.id)!;
    expect(reopenedSurface.definition.edits).toEqual(edits);
    expect(Object.keys(reopenedSurface)).not.toContain('selection');
    expect(Object.keys(reopenedSurface.definition)).not.toContain('selection');
    expect(JSON.stringify(reopened)).not.toContain(SELECTION_MARKER);
    expect(JSON.stringify(selection)).toContain(SELECTION_MARKER);

    const after = buildOf(reopened, reopenedSurface);
    expect(after.points).toHaveLength(before.points.length);
    expect(digest(after, false)).toBe(digest(before, false));
  });

  it('imported stack round-trips with a byte-identical payload and equal final mesh', () => {
    const { project, surface } = importedProject();
    const edits = importedEdits(surface.id);
    const editedSurface = withEdits(surface, edits);
    const editedProject: CadProject = { ...project, surfaces: [editedSurface] };
    const before = buildOf(editedProject, editedSurface);

    const parsed = roundTrip(editedProject);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    const reopened = parsed.drawing.project;
    const reopenedSurface = (reopened.surfaces ?? []).find((entry) => entry.id === surface.id)!;
    expect(reopenedSurface.definition.edits).toEqual(edits);
    expect(JSON.stringify(reopenedSurface.definition.importedTin)).toBe(JSON.stringify(importedPayload()));
    expect(JSON.stringify(reopenedSurface.definition.importedTin)).toBe(JSON.stringify(editedSurface.definition.importedTin));

    const after = buildOf(reopened, reopenedSurface);
    expect(after.points).toHaveLength(before.points.length);
    expect(digest(after, true)).toBe(digest(before, true));
  });

  it('records the WNCAD semantic-history byte cost at 10/100/1000 refs (measured, never gated)', () => {
    const { project, surface } = jitterGrid(32, 'surf-size');
    const doc = createBlankCadDrawingDocument({ name: 'doc', units: 'm' });
    const plainBytes = serializeCadDrawingFile({ ...doc, project }).length;
    const rows: string[] = [];
    let priorBytes = plainBytes;
    for (const count of [10, 100, 1000]) {
      const vertices = project.entities.slice(0, count).map((entity) => ref(entity.id));
      const sizeSurface = withEdits(surface, [{ id: 'e-size', kind: 'raise-lower-points', vertices, deltaZ: 1 }]);
      const editedBytes = serializeCadDrawingFile({ ...doc, project: { ...project, surfaces: [sizeSurface] } }).length;
      rows.push(`refs=${count} bytes=${editedBytes} delta=+${editedBytes - plainBytes}`);
      expect(editedBytes).toBeGreaterThan(priorBytes);
      priorBytes = editedBytes;
    }
    console.info(`\n[18V persist] WNCAD plain=${plainBytes} bytes; ${rows.join('; ')}`);
  });
});

// ---------------------------------------------------------------------------
// PROJECTTRANSFORM §105
// ---------------------------------------------------------------------------

describe('18V PROJECTTRANSFORM (§105)', () => {
  it('transform(final edited) ≡ final(transformed) under scale + 90° rotation + translation', () => {
    const { project, surface } = jitterGrid(4, 'surf-xform');
    const edits = nativeEdits(surface.id);
    const editedSurface = withEdits(surface, edits);
    const editedProject: CadProject = { ...project, surfaces: [editedSurface] };
    const before = buildOf(editedProject, editedSurface);

    const transform = compose(translation(7, -3), compose(rotationAbout(0, 0, 90), uniformScaleAbout(0, 0, 1.5)));
    const result = applyCadProjectCoordinateTransform(editedProject, transform, {
      transformId: 't-18v',
      createdAtIso: FIXED.toISOString(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`transform failed: ${result.reason}`);
    const movedSurface = (result.project.surfaces ?? []).find((entry) => entry.id === surface.id)!;
    expect(movedSurface.definition.edits).toEqual(transformCadSurfaceEdits(edits, transform));
    expect(movedSurface.cachedRevision).toBeNull();

    const after = buildOf(result.project, movedSurface);
    expect(after.points).toHaveLength(before.points.length);
    for (const p of after.points) {
      const b = before.points.find((q) => q.entityId === p.entityId);
      expect(b, `point ${p.entityId} missing from the pre-transform mesh`).toBeDefined();
      const expected = applyPoint(transform, { x: b!.x, y: b!.y });
      expect(p.x).toBeCloseTo(expected.x, 6);
      expect(p.y).toBeCloseTo(expected.y, 6);
      expect(p.z).toBeCloseTo(b!.z, 9);
    }
    expect(digest(after, false)).toBe(digest(before, false));
  });

  it('a move-points delta is a vector: rotation+scale apply, translation does not', () => {
    const delta: CadSurfaceEdit = { id: 'e-v', kind: 'move-points', vertices: [ref('pt:A')], deltaX: 1, deltaY: 0 };
    const transform = compose(translation(1000, -2000), compose(rotationAbout(0, 0, 90), uniformScaleAbout(0, 0, 3)));
    const moved = transformCadSurfaceEdits([delta], transform)?.[0];
    if (moved?.kind !== 'move-points') throw new Error('kind changed');
    const vector = applyVector(transform, { x: delta.deltaX, y: delta.deltaY });
    expect(moved.deltaX).toBeCloseTo(vector.x, 9);
    expect(moved.deltaY).toBeCloseTo(vector.y, 9);
    // Pure translation leaves the stored displacement bit-identical.
    const translated = transformCadSurfaceEdits([delta], translation(50, -60))?.[0];
    expect(translated).toEqual(delta);
  });

  it('Grid/Ground scale touches dx/dy only (origin translation excluded)', () => {
    const derived = gridGroundTransform(2_000_000, 7_000_000, 2, 'GRID_TO_GROUND');
    expect(derived.ok).toBe(true);
    if (!derived.ok) throw new Error(derived.reason);
    const moved = transformCadSurfaceEdits(
      [{ id: 'g', kind: 'move-points', vertices: [ref('pt:A')], deltaX: 100, deltaY: -40 }],
      derived.transform,
    )?.[0];
    if (moved?.kind !== 'move-points') throw new Error('kind changed');
    // effectiveFactor = 1/combinedScaleFactor = 0.5; the 2M/7M origin never leaks in.
    expect(derived.effectiveFactor).toBeCloseTo(0.5, 12);
    expect(moved.deltaX).toBeCloseTo(50, 12);
    expect(moved.deltaY).toBeCloseTo(-20, 12);
  });
});
