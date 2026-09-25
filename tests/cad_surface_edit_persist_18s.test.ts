/**
 * Phase 18S persistence + transform + export integration.
 *
 * Pins:
 * - WNCAD save/reopen keeps the ordered edit stack exact (ids/kinds/refs/
 *   enabled/order) for native (swap + add + delete + one disabled) and
 *   imported (swap + delete) surfaces, and the reopened build yields the
 *   same final topology digest.
 * - LandXML export serializes the CURRENT FINAL (edited) mesh; the stored
 *   ImportedTinPayload/provenance is never rewritten, and export->reimport is
 *   flattened (no history) with mesh equivalence.
 * - PROJECTTRANSFORM (similarity + uniform scale) preserves edit refs
 *   verbatim, stales the surface, and a rebuild yields the same logical
 *   topology in the new frame; uniform scale never fails the edits.
 */
import { describe, expect, it } from 'vitest';
import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface, computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { applySurfaceBuildSuccess, createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { applyCadSurfaceEdits, CadSurfaceEditFailure, type CadSurfaceEditBaseline } from '../src/engine/cad/cadSurfaceEdits';
import { applyCadProjectCoordinateTransform } from '../src/engine/cad/cadProjectTransform';
import { uniformScaleAbout, rotationAbout } from '../src/engine/cad/cadTransform2D';
import { buildLandXmlProjectExportWithResult } from '../src/engine/landxmlCad';
import { deriveCadSurfaceEditSummaries } from '../src/cad-app/shell/cadSurfaceSnapshot';
import type { TinEdgeKinds } from '../src/engine/cad/tin/tinTypes';
import { parseSurfaces } from './landxmlCivilTestSupport';
import type {
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
  ImportedTinPayload,
} from '../src/engine/cad/cadTypes';

const FIXED = new Date('2026-09-20T12:00:00Z');
const plane = (x: number, y: number): number => 0.013 * x + 0.021 * y + 2.5;

const point = (id: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id: `pt:${id}`,
  type: 'survey-point',
  layerId: 'L',
  visible: true,
  locked: false,
  stationId: id,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const withLayer = (base: CadProject): CadProject => ({
  ...base,
  layers: [{ id: 'L', name: 'Test', color: '#ffffff', visible: true, locked: false, role: 'planning' }],
  currentLayerId: 'L',
});

const gridNative = (surfaceId = 'surf-native'): { project: CadProject; surface: CadSurface } => {
  const base = withLayer(createBlankCadProject({ name: 'T18S-persist', units: 'm' }));
  const entities: CadSurveyPointEntity[] = [];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      // Deterministic jitter breaks cocircular ties so the Delaunay diagonal
      // is unique (and therefore similarity-invariant across transforms).
      const x = col * 10 + ((row * 7 + col * 3) % 5) * 0.31;
      const y = row * 10 + ((row * 2 + col * 5) % 4) * 0.27;
      entities.push(point(`${row}${col}`, x, y, plane(x, y)));
    }
  }
  const surface: CadSurface = {
    id: surfaceId,
    name: 'Native grid',
    definition: { pointSource: { kind: 'points', pointEntityIds: entities.map((e) => e.id) } },
  };
  return { project: { ...base, entities, surfaces: [surface] }, surface };
};

const importedPayload = (): ImportedTinPayload => ({
  vertices: [0, 0, 5, 10, 0, 6, 10, 10, 7, 0, 10, 8, 20, 5, 9, 20, 15, 10],
  faces: [0, 1, 2, 0, 2, 3, 1, 4, 2, 2, 4, 5],
  provenance: { format: 'LandXML', fileName: 'src.xml', surfaceName: 'Imported', sourceId: 'sid-1' },
});

const importedProject = (surfaceId = 'surf-imported'): { project: CadProject; surface: CadSurface } => {
  const base = withLayer(createBlankCadProject({ name: 'T18S-import', units: 'm' }));
  const surface: CadSurface = {
    id: surfaceId,
    name: 'Imported TIN',
    definition: {
      pointSource: { kind: 'points', pointEntityIds: [] },
      sourceKind: 'imported-tin',
      importedTin: importedPayload(),
    },
  };
  return { project: { ...base, surfaces: [surface] }, surface };
};

const buildOf = (project: CadProject, surface: CadSurface) => {
  const build = buildCadSurface(project, surface);
  if (build.outcome !== 'ok') throw new Error(`fixture build ${build.outcome} ${JSON.stringify(build.editFailure ?? {})}`);
  return build;
};

const edgeMap = (build: ReturnType<typeof buildCadSurface>): Map<string, number[]> => {
  const map = new Map<string, number[]>();
  build.triangles.forEach((tri, index) => {
    for (const [u, v] of [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]] as const) {
      const key = `${Math.min(u, v)}>${Math.max(u, v)}`;
      map.set(key, [...(map.get(key) ?? []), index]);
    }
  });
  return map;
};

const toBaseline = (build: ReturnType<typeof buildCadSurface>): CadSurfaceEditBaseline => ({
  points: build.points.map((p) => ({ id: p.entityId, x: p.x, y: p.y, z: p.z })),
  triangles: build.triangles.map((t) => [t[0], t[1], t[2]] as [number, number, number]),
  edgeKinds: build.edgeKinds.map((k) => [k[0], k[1], k[2]] as TinEdgeKinds),
  constrainedKindMap: new Map(),
});

const tryStack = (baseline: CadSurfaceEditBaseline, edits: CadSurfaceEdit[]): boolean => {
  try {
    applyCadSurfaceEdits(baseline, edits);
    return true;
  } catch (error) {
    if (error instanceof CadSurfaceEditFailure) return false;
    throw error;
  }
};

const refFor = (imported: boolean, surfaceId: string, build: ReturnType<typeof buildCadSurface>, index: number): string =>
  imported ? `imported:${surfaceId}:${index}` : `source:${build.points[index].entityId}`;

/** Deterministically discover a reusable swap + add + delete + disabled stack. */
const discoverStack = (
  build: ReturnType<typeof buildCadSurface>,
  surfaceId: string,
  imported: boolean,
): CadSurfaceEdit[] => {
  const baseline = toBaseline(build);
  const key = (index: number): string => refFor(imported, surfaceId, build, index);
  const interior = [...edgeMap(build)]
    .filter(([, list]) => list.length === 2)
    .map(([edge]) => edge.split('>').map(Number) as [number, number]);
  const swap = interior
    .map(([a, b]): CadSurfaceEdit => ({ id: 'e-swap', kind: 'swap-edge', edge: { a: { key: key(a) }, b: { key: key(b) } } }))
    .find((edit) => tryStack(baseline, [edit]));
  if (!swap) throw new Error('fixture: no swap');
  let add: CadSurfaceEdit | null = null;
  for (let i = 0; i < build.points.length && !add; i += 1) {
    for (let j = i + 1; j < build.points.length && !add; j += 1) {
      const edit: CadSurfaceEdit = { id: 'e-add', kind: 'add-line', from: { key: key(i) }, to: { key: key(j) } };
      if (tryStack(baseline, [swap, edit])) add = edit;
    }
  }
  if (!add) throw new Error('fixture: no add-line');
  const del = interior
    .map(([a, b]): CadSurfaceEdit => ({ id: 'e-del', kind: 'delete-line', edge: { a: { key: key(a) }, b: { key: key(b) } } }))
    .find((edit) => tryStack(baseline, [swap, add as CadSurfaceEdit, edit]));
  if (!del) throw new Error('fixture: no delete');
  return [swap, add, del, { ...swap, id: 'e-off', enabled: false }];
};

const applied = (
  project: CadProject,
  surface: CadSurface,
  edits: CadSurfaceEdit[],
): { project: CadProject; surface: CadSurface } => {
  const edited: CadSurface = { ...surface, definition: { ...surface.definition, edits } };
  return { project: { ...project, surfaces: [edited] }, surface: edited };
};

/** Stable entity-key triangle digest (order-free); test-local, not a format. */
const digest = (build: ReturnType<typeof buildCadSurface>, imported: boolean): string =>
  build.triangles
    .map((tri) => tri.map((i) => (imported ? `v${i}` : build.points[i].entityId)).sort().join('+'))
    .sort()
    .join('|');

const topologyByCoords = (
  points: Array<{ x: number; y: number; z: number }>,
  triangles: Array<[number, number, number]>,
): string[] =>
  triangles
    .map((tri) =>
      tri
        .map((i) => `${points[i].x.toFixed(6)},${points[i].y.toFixed(6)},${points[i].z.toFixed(6)}`)
        .sort()
        .join('+'),
    )
    .sort();

const roundTrip = (project: CadProject) =>
  parseCadDrawingFile(serializeCadDrawingFile({
    ...createBlankCadDrawingDocument({ name: 'doc', units: 'm' }),
    project,
  }));

// ---------------------------------------------------------------------------
// WNCAD save / reopen
// ---------------------------------------------------------------------------

describe('18S WNCAD save/reopen', () => {
  it('native swap+add+delete+disabled round-trips exactly and rebuilds equal topology', () => {
    const { project, surface } = gridNative();
    const base = buildOf(project, surface);
    const edits = discoverStack(base, surface.id, false);
    const edited = applied(project, surface, edits);
    const before = buildOf(edited.project, edited.surface);

    const parsed = roundTrip(edited.project);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    const reopened = parsed.drawing.project;
    const reopenedSurface = (reopened.surfaces ?? []).find((entry) => entry.id === surface.id)!;
    expect(reopenedSurface.definition.edits).toEqual(edits);
    const after = buildOf(reopened, reopenedSurface);
    expect(digest(after, false)).toBe(digest(before, false));
  });

  it('imported swap+delete round-trips with payload/provenance untouched', () => {
    const { project, surface } = importedProject();
    const base = buildOf(project, surface);
    const edits = discoverStack(base, surface.id, true).filter((edit) => edit.kind !== 'add-line');
    const edited = applied(project, surface, edits);
    const before = buildOf(edited.project, edited.surface);
    const parsed = roundTrip(edited.project);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('parse failed');
    const reopened = parsed.drawing.project;
    const reopenedSurface = (reopened.surfaces ?? []).find((entry) => entry.id === surface.id)!;
    expect(reopenedSurface.definition.edits).toEqual(edits);
    expect(reopenedSurface.definition.importedTin).toEqual(importedPayload());
    expect(digest(buildOf(reopened, reopenedSurface), true)).toBe(digest(before, true));
  });
});

// ---------------------------------------------------------------------------
// LandXML export -> reimport (flattened)
// ---------------------------------------------------------------------------

describe('18S LandXML export', () => {
  it('serializes the edited mesh, leaves the imported payload alone, and reimports flattened-equivalent', () => {
    const { project, surface } = importedProject();
    const base = buildOf(project, surface);
    const edits = discoverStack(base, surface.id, true).filter((edit) => edit.kind !== 'add-line');
    const edited = applied(project, surface, edits);
    const build = buildOf(edited.project, edited.surface);
    const cache = createCadSurfaceCache('18s-export');
    const revision = computeCadSurfaceSourceRevision(edited.project, edited.surface);
    const current = applySurfaceBuildSuccess(edited.project, cache, surface.id, revision, build);

    const result = buildLandXmlProjectExportWithResult(
      current,
      { units: 'm', projectName: 'T18S', generatedAt: FIXED },
      { surfaceCache: cache },
    );
    const parsed = parseSurfaces(result.output);
    expect(parsed).toHaveLength(1);
    expect(result.civilEntries.find((entry) => entry.class === 'surface')?.disposition).toBe('EXPORTED');
    const reimported = topologyByCoords(
      parsed[0].points.map((p) => ({ x: p.e, y: p.n, z: p.z })),
      parsed[0].faces.map((f) => [f[0] - 1, f[1] - 1, f[2] - 1] as [number, number, number]),
    );
    expect(reimported).toEqual(topologyByCoords(build.points, build.triangles));
    expect(result.output).not.toContain('edit');
    expect(current.surfaces![0].definition.importedTin).toEqual(importedPayload());
  });
});

// ---------------------------------------------------------------------------
// PROJECTTRANSFORM
// ---------------------------------------------------------------------------

describe('18S PROJECTTRANSFORM', () => {
  it('similarity transform preserves edit refs verbatim and rebuilds the same logical topology', () => {
    const { project, surface } = gridNative();
    const base = buildOf(project, surface);
    const edits = discoverStack(base, surface.id, false);
    const edited = applied(project, surface, edits);
    const before = buildOf(edited.project, edited.surface);

    const result = applyCadProjectCoordinateTransform(edited.project, rotationAbout(0, 0, 30), {
      transformId: 't-18s',
      createdAtIso: FIXED.toISOString(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('transform failed');
    const moved = (result.project.surfaces ?? []).find((entry) => entry.id === surface.id)!;
    expect(moved.definition.edits).toEqual(edits);
    expect(moved.cachedRevision).toBeNull();
    const after = buildOf(result.project, moved);
    expect(digest(after, false)).toBe(digest(before, false));
  });

  it('uniform scale does not fail the edit stack', () => {
    const { project, surface } = importedProject();
    const base = buildOf(project, surface);
    const edits = discoverStack(base, surface.id, true).filter((edit) => edit.kind !== 'add-line');
    const edited = applied(project, surface, edits);
    const before = buildOf(edited.project, edited.surface);
    const result = applyCadProjectCoordinateTransform(edited.project, uniformScaleAbout(0, 0, 2), {
      transformId: 't-scale',
      createdAtIso: FIXED.toISOString(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('transform failed');
    const moved = (result.project.surfaces ?? []).find((entry) => entry.id === surface.id)!;
    expect(moved.definition.edits).toEqual(edits);
    expect(moved.definition.importedTin!.vertices.every((v) => Number.isFinite(v))).toBe(true);
    const after = buildOf(result.project, moved);
    expect(digest(after, true)).toBe(digest(before, true));
  });
});

// ---------------------------------------------------------------------------
// Snapshot derivation (readable refs, status, counts)
// ---------------------------------------------------------------------------

describe('18S surface snapshot edit rows', () => {
  it('derives readable labels (no raw ids), status, and broken fail-closed rows', () => {
    const { project, surface } = gridNative();
    const build = buildOf(project, surface);
    const edits = discoverStack(build, surface.id, false);
    const { surface: edited } = applied(project, surface, edits);
    const labels = new Map(project.entities.map((e) => [e.id, e.type === 'survey-point' ? `P${e.stationId}` : e.id]));
    const rows = deriveCadSurfaceEditSummaries(edited, labels, true);
    expect(rows.map((row) => row.id)).toEqual(edits.map((edit) => edit.id));
    expect(rows.map((row) => row.description)).toEqual([
      expect.stringContaining('Swap Edge P'),
      expect.stringContaining('Add Line P'),
      expect.stringContaining('Delete Line P'),
      expect.stringContaining('Swap Edge P'),
    ]);
    expect(rows.some((row) => row.description.includes('pt:'))).toBe(false);
    expect(rows[3].enabled).toBe(false);
    expect(rows[3].status).toBe('disabled');
    // Unresolvable native refs read broken with a reason, still no raw id.
    const broken = deriveCadSurfaceEditSummaries(edited, new Map(), true);
    expect(broken.some((row) => row.status === 'broken-reference')).toBe(true);
    expect(broken.filter((row) => row.status === 'broken-reference').every((row) => row.reason != null)).toBe(true);
    expect(broken.some((row) => row.description.includes('pt:'))).toBe(false);
  });

  it('renders imported refs as V<i> with the imported vertex count (no fake stations)', () => {
    const { project, surface } = importedProject();
    const build = buildOf(project, surface);
    const edits = discoverStack(build, surface.id, true).filter((edit) => edit.kind !== 'add-line');
    const { surface: edited } = applied(project, surface, edits);
    const rows = deriveCadSurfaceEditSummaries(edited, new Map(), true);
    expect(rows.every((row) => /V\d+ – V\d+/.test(row.description))).toBe(true);
    expect(rows.some((row) => row.description.includes('imported:'))).toBe(false);
  });
});
