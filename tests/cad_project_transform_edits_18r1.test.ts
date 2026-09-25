// Phase 18T (project-transform slice): the 18R horizontal frame mapping must
// move coordinate-bearing surface edits EXACTLY once while leaving refs/Z/
// deltaZ frame-invariant.
//
// Oracle: a mixed edit stack [Add XY, Move XY, Set Z, Raise delta, AddLine]
// under a similarity transform must (a) map add-point/move-point XY through
// applyPoint once, (b) keep refs/Z/deltaZ bit-identical, and (c) replay to
// exactly the XY-transformed pre-transform mesh (same topology, same entity
// ids). The Grid/Ground horizontal path shares the same kernel.
import { describe, expect, it } from 'vitest';

import { applyCadProjectCoordinateTransform, applyCadProjectTransform } from '../src/engine/cad/cadProjectTransform';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { applyPoint, compose, rotationAbout, translation, uniformScaleAbout } from '../src/engine/cad/cadTransform2D';
import type {
  CadEntity,
  CadProject,
  CadSurface,
  CadSurfaceEdit,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const FIXED_ISO = '2026-09-25T12:00:00.000Z';

const pt = (stationId: string, x: number, y: number, z?: number): CadSurveyPointEntity => ({
  id: `pt:${stationId}`,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  ...(z === undefined ? {} : { z }),
  pointClass: 'free',
  source: 'parsed-input',
});

const projectOf = (entities: CadEntity[], surfaces: CadSurface[] = []): CadProject =>
  ({
    version: 2,
    id: 'proj-18r1-edit',
    name: 'test',
    metadata: {
      source: 'parsed-input',
      runMode: 'unknown',
      units: 'meters',
      stationCount: 0,
      observationCount: 0,
      adjustedStationCount: 0,
    },
    layers: [],
    styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
    pointGroups: [],
    entities,
    surfaces,
    cogoComputations: [],
    bounds: null,
  }) as unknown as CadProject;

const surfaceOf = (pointEntityIds: string[]): CadSurface => ({
  id: 's18r1-edit',
  name: 'edit surface',
  definition: { pointSource: { kind: 'points', pointEntityIds } },
});

/** Square + off-center interior point: interior vertex movable, C-O edge free. */
const centerQuad = (): CadSurveyPointEntity[] => {
  const z = (x: number, y: number): number => 2 * x + 3 * y + 10;
  return [
    pt('A', 0, 0, z(0, 0)),
    pt('B', 10, 0, z(10, 0)),
    pt('C', 10, 10, z(10, 10)),
    pt('D', 0, 10, z(0, 10)),
    pt('O', 4, 5, z(4, 5)),
  ];
};

const ADD = { x: 4, y: 2 };
const MOVE = { x: 5, y: 4 };
const SET_Z = 150;
const DELTA = 2.5;

const stackOf = (): CadSurfaceEdit[] => [
  { id: 'e-add', kind: 'add-point', x: ADD.x, y: ADD.y, z: 24 },
  { id: 'e-mv', kind: 'move-point', vertex: { key: 'source:pt:O' }, x: MOVE.x, y: MOVE.y },
  { id: 'e-set', kind: 'set-elevation', vertex: { key: 'source:pt:A' }, z: SET_Z },
  { id: 'e-raise', kind: 'raise-lower-surface', deltaZ: DELTA },
  { id: 'e-line', kind: 'add-line', from: { key: 'source:pt:B' }, to: { key: 'source:pt:D' } },
];

const fixture = (): { project: CadProject; surface: CadSurface } => {
  const entities = centerQuad();
  const surface = surfaceOf(entities.map((entity) => entity.id));
  surface.definition.edits = stackOf();
  return { project: projectOf(entities, [surface]), surface };
};

const editById = <K extends CadSurfaceEdit['kind']>(
  edits: readonly CadSurfaceEdit[],
  id: string,
  kind: K,
): Extract<CadSurfaceEdit, { kind: K }> => {
  const found = edits.find((edit) => edit.id === id);
  if (!found || found.kind !== kind) throw new Error(`missing ${kind} edit ${id}`);
  return found as Extract<CadSurfaceEdit, { kind: K }>;
};

const surfaceOfApplied = (project: CadProject): CadSurface => {
  const found = (project.surfaces ?? []).find((surface) => surface.id === 's18r1-edit');
  if (!found) throw new Error('missing transformed surface');
  return found;
};

/** Independent oracle: replay equals XY-transforming the pre-transform mesh. */
const expectMeshIsTransformedPreMesh = (
  pre: ReturnType<typeof buildCadSurface>,
  post: ReturnType<typeof buildCadSurface>,
  transform: Parameters<typeof applyPoint>[0],
): void => {
  expect(pre.outcome).toBe('ok');
  expect(post.outcome).toBe('ok');
  const ids = (build: ReturnType<typeof buildCadSurface>): string[] =>
    build.points.map((p) => p.entityId).sort();
  expect(ids(post)).toEqual(ids(pre));
  const triIds = (build: ReturnType<typeof buildCadSurface>): string[] =>
    build.triangles
      .map((tri) => tri.map((index) => build.points[index]!.entityId).sort().join('+'))
      .sort();
  expect(triIds(post)).toEqual(triIds(pre));
  for (const before of pre.points) {
    const after = post.points.find((p) => p.entityId === before.entityId);
    const at = applyPoint(transform, { x: before.x, y: before.y });
    expect(after?.x).toBe(at.x);
    expect(after?.y).toBe(at.y);
    expect(after?.z).toBe(before.z);
  }
};

const expectEditsMappedOnce = (
  project: CadProject,
  transform: Parameters<typeof applyPoint>[0],
): CadSurfaceEdit[] => {
  const edits = surfaceOfApplied(project).definition.edits ?? [];
  const add = editById(edits, 'e-add', 'add-point');
  const move = editById(edits, 'e-mv', 'move-point');
  const set = editById(edits, 'e-set', 'set-elevation');
  const raise = editById(edits, 'e-raise', 'raise-lower-surface');
  const line = editById(edits, 'e-line', 'add-line');

  const addAt = applyPoint(transform, ADD);
  const moveAt = applyPoint(transform, MOVE);
  // Single application: equality here fails if a coordinate were mapped twice.
  expect({ x: add.x, y: add.y }).toEqual(addAt);
  expect({ x: move.x, y: move.y }).toEqual(moveAt);
  expect(add.z).toBe(24);
  expect(move.vertex.key).toBe('source:pt:O');
  expect(set).toMatchObject({ z: SET_Z, vertex: { key: 'source:pt:A' } });
  expect(raise.deltaZ).toBe(DELTA);
  expect(line.from.key).toBe('source:pt:B');
  expect(line.to.key).toBe('source:pt:D');
  return edits;
};

describe('18T edits under 18R similarity transform', () => {
  it('mixed stack: XY once, refs/Z/delta unchanged, replay = transformed pre-mesh', () => {
    const { project, surface } = fixture();
    const pre = buildCadSurface(project, surface);
    // Genuine similarity: scale about a point, then rotate, then translate.
    const combined = compose(translation(11, -7), compose(rotationAbout(3, 4, 30), uniformScaleAbout(3, 4, 1.5)));

    const applied = applyCadProjectCoordinateTransform(project, combined, {
      transformId: 't-18t-edits',
      createdAtIso: FIXED_ISO,
    });
    if (!applied.ok) throw new Error(applied.reason);
    expectEditsMappedOnce(applied.project, combined);
    expectMeshIsTransformedPreMesh(pre, buildCadSurface(applied.project, surfaceOfApplied(applied.project)), combined);
    // Purity: the source definition is never mutated.
    expect(surface.definition.edits).toEqual(stackOf());
  });

  it('second transform maps each edit exactly one more time (no double-apply)', () => {
    const { project, surface } = fixture();
    const first = applyCadProjectCoordinateTransform(project, uniformScaleAbout(0, 0, 1.5), {
      transformId: 't-18t-a',
      createdAtIso: FIXED_ISO,
    });
    if (!first.ok) throw new Error(first.reason);
    const second = applyCadProjectCoordinateTransform(first.project, rotationAbout(2, 3, 20), {
      transformId: 't-18t-b',
      createdAtIso: FIXED_ISO,
    });
    if (!second.ok) throw new Error(second.reason);
    const once = applyPoint(rotationAbout(2, 3, 20), applyPoint(uniformScaleAbout(0, 0, 1.5), ADD));
    const add = editById(surfaceOfApplied(second.project).definition.edits ?? [], 'e-add', 'add-point');
    expect({ x: add.x, y: add.y }).toEqual(once);
    const pre = buildCadSurface(project, surface);
    const composed = (p: { x: number; y: number }) =>
      applyPoint(rotationAbout(2, 3, 20), applyPoint(uniformScaleAbout(0, 0, 1.5), p));
    const post = buildCadSurface(second.project, surfaceOfApplied(second.project));
    expect(pre.outcome).toBe('ok');
    expect(post.outcome).toBe('ok');
    for (const before of pre.points) {
      const after = post.points.find((p) => p.entityId === before.entityId);
      const at = composed({ x: before.x, y: before.y });
      expect(after?.x).toBe(at.x);
      expect(after?.y).toBe(at.y);
      expect(after?.z).toBe(before.z);
    }
  });

  it('Grid/Ground horizontal path uses the same edit rule', () => {
    const { project, surface } = fixture();
    const pre = buildCadSurface(project, surface);
    const result = applyCadProjectTransform(
      project,
      { kind: 'GRID_GROUND', originE: 1000, originN: 2000, combinedScaleFactor: 0.9996, direction: 'GRID_TO_GROUND' },
    );
    if (!result.ok) throw new Error(result.reason);
    const transform = uniformScaleAbout(1000, 2000, 1 / 0.9996);
    expectEditsMappedOnce(result.project, transform);
    expectMeshIsTransformedPreMesh(pre, buildCadSurface(result.project, surfaceOfApplied(result.project)), transform);
  });
});
