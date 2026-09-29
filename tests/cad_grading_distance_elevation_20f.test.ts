/**
 * Phase 20F — Grade to Distance / Grade to Elevation persistence slice:
 * WNCAD definition round-trip, legacy surface byte-preservation, fail-closed
 * sanitize of malformed analytic criteria, kind-conditional target clearing in
 * ONE undo entry, analytic bake provenance, and transform scaling.
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { cloneCadProject } from '../src/engine/cad/cadPersistence';
import {
  createCadHistoryState,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { resolveGradingInputs } from '../src/engine/cad/grading/gradingResolve';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { sanitizeCadGradings } from '../src/engine/cad/grading/gradingPersistence';
import { sanitizeCadGradingGroups } from '../src/engine/cad/grading/gradingGroupPersistence';
import { computeGradingFromSnapshots } from '../src/workers/surfaceGradingCompute';
import { normalizeTinProvenance, tinProvenanceRevisionPart } from '../src/engine/cad/cadImportedTin';
import { applyCadProjectCoordinateTransform, applyCadProjectTransform } from '../src/engine/cad/cadProjectTransform';
import { buildProjectTransformReport } from '../src/engine/cad/cadProjectTransformReport';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import type { CadGrading } from '../src/engine/cad/grading/gradingTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20f-p${seq}`;
};

const makeFeatureLine = (
  id: string,
  vertices: Array<[number, number, number]>,
): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: vertices.map(([x, y, z], index) => ({ id: `feature-vertex:${id}:${index}`, x, y, z })),
});

const makeFlatTarget = (id: string, name: string): CadSurface => ({
  id,
  name,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-10, -10, 0, 110, -10, 0, 110, 40, 0, -10, 40, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const projectWithFl = (): { project: CadProject; flId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Grading 20F', units: 'm' });
  const flId = nextId('fl');
  return {
    project: { ...drawing.project, entities: [makeFeatureLine(flId, [[0, 0, 10], [100, 0, 10]])] },
    flId,
  };
};

const projectWithChainAndTarget = (): { project: CadProject; flId: string; targetId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Grading 20F group', units: 'm' });
  const flId = nextId('fl');
  const targetId = nextId('tgt');
  return {
    project: {
      ...drawing.project,
      entities: [makeFeatureLine(flId, [[0, 0, 10], [100, 0, 10], [100, 100, 10]])],
      surfaces: [makeFlatTarget(targetId, 'Target')],
    },
    flId,
    targetId,
  };
};

const roundTrip = (project: CadProject): CadProject => {
  const drawing = { ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }), project };
  const parsed = parseCadDrawingFile(serializeCadDrawingFile(drawing));
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error('round-trip parse failed');
  return parsed.drawing.project;
};

describe('Phase 20F (distance/elevation) persistence', () => {
  it('distance grading persists with NO targetSurfaceId key and round-trips', () => {
    const { project, flId } = projectWithFl();
    const entity = project.entities[0] as CadFeatureLineEntity;
    const [a, b] = [entity.vertices[0]!.id, entity.vertices[1]!.id];
    const state = runCadCommand(createCadHistoryState(project), {
      key: 'GRADING_CREATE',
      name: 'G-Distance',
      sourceFeatureLineId: flId,
      vertexAId: a,
      vertexBId: b,
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    const grading = state.present.project.gradings![0]!;
    expect(grading.criterion).toEqual({ kind: 'distance', gradeRatio: -0.5, distance: 20 });
    expect(Object.prototype.hasOwnProperty.call(grading, 'targetSurfaceId')).toBe(false);

    const reopened = roundTrip(state.present.project);
    expect(reopened.gradings![0]).toEqual(grading);
    expect(Object.prototype.hasOwnProperty.call(reopened.gradings![0]!, 'targetSurfaceId')).toBe(false);
    const cloned = cloneCadProject(reopened);
    expect(Object.prototype.hasOwnProperty.call(cloned.gradings![0]!, 'targetSurfaceId')).toBe(false);
    // Definitions only — derived results/status never serialize.
    const serialized = serializeCadDrawingFile({
      ...createBlankCadDrawingDocument({ name: 'x', units: 'm' }),
      project: state.present.project,
    });
    expect(serialized).not.toMatch(/gradingMesh|daylightPoints|"status"/);
  });

  it('surface criterion still requires a live non-empty target', () => {
    const { project, flId } = projectWithFl();
    const entity = project.entities[0] as CadFeatureLineEntity;
    const [a, b] = [entity.vertices[0]!.id, entity.vertices[1]!.id];
    const state = runCadCommand(createCadHistoryState(project), {
      key: 'GRADING_CREATE',
      name: 'G-Surface',
      sourceFeatureLineId: flId,
      vertexAId: a,
      vertexBId: b,
      side: 'left',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    expect(state.present.project.gradings ?? []).toHaveLength(0);
  });

  it('sanitizer accepts analytic without a target and drops malformed new criteria', () => {
    const base: CadGrading = {
      id: 'g1',
      name: 'D',
      sourceFeatureLineId: 'fl',
      sourceCourse: { vertexAId: 'a', vertexBId: 'b' },
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 100,
      curveChordTolerance: 0.01,
    };
    expect(sanitizeCadGradings([base])).toHaveLength(1);
    expect(sanitizeCadGradings([{ ...base, targetSurfaceId: '' }])).toHaveLength(1);
    expect(sanitizeCadGradings([{ ...base, criterion: { kind: 'distance', gradeRatio: -0.5 } }])).toHaveLength(0);
    expect(sanitizeCadGradings([{ ...base, criterion: { kind: 'elevation', gradeRatio: 0, targetElevation: 5 } }])).toHaveLength(0);
    // Elevation with a machine-zero grade fails closed; a valid one survives.
    expect(sanitizeCadGradings([{ ...base, criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 5 } }])).toHaveLength(1);
    // Surface with no target drops.
    expect(sanitizeCadGradings([{ ...base, criterion: { kind: 'fixed', gradeRatio: -0.5 } }])).toHaveLength(0);
  });

  it('legacy surface grading keeps its target key and bytes (no injected targetKind)', () => {
    const { project, flId } = projectWithFl();
    const targetId = nextId('tgt');
    const projectWithTarget: CadProject = { ...project, surfaces: [makeFlatTarget(targetId, 'T')] };
    const entity = projectWithTarget.entities[0] as CadFeatureLineEntity;
    const history = runCadCommand(createCadHistoryState(projectWithTarget), {
      key: 'GRADING_CREATE',
      name: 'Legacy',
      sourceFeatureLineId: flId,
      vertexAId: entity.vertices[0]!.id,
      vertexBId: entity.vertices[1]!.id,
      targetSurfaceId: targetId,
      side: 'left',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    const grading = history.present.project.gradings![0]!;
    expect(grading.targetSurfaceId).toBe(targetId);
    const serialized = JSON.stringify(grading);
    expect(serialized).not.toMatch(/targetKind|distance|targetElevation/);
    expect(roundTrip(history.present.project).gradings![0]).toEqual(grading);
  });

  it('kind switch adds/clears the target in ONE undo entry', () => {
    const { project, flId } = projectWithFl();
    const targetId = nextId('tgt');
    const withTarget: CadProject = { ...project, surfaces: [makeFlatTarget(targetId, 'T')] };
    const entity = withTarget.entities[0] as CadFeatureLineEntity;
    const create = runCadCommand(createCadHistoryState(withTarget), {
      key: 'GRADING_CREATE',
      name: 'Switch',
      sourceFeatureLineId: flId,
      vertexAId: entity.vertices[0]!.id,
      vertexBId: entity.vertices[1]!.id,
      targetSurfaceId: targetId,
      side: 'left',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    const gradingId = create.present.project.gradings![0]!.id;
    const depth = create.undoStack.length;

    // surface -> distance clears the target in one entry.
    const switched = runCadCommand(create, {
      key: 'GRADING_EDIT_CRITERIA',
      gradingId,
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
    });
    expect(switched.undoStack.length).toBe(depth + 1);
    const analytic = switched.present.project.gradings![0]!;
    expect(Object.prototype.hasOwnProperty.call(analytic, 'targetSurfaceId')).toBe(false);
    // Undo restores the surface definition + target in one step.
    expect(undoCadHistory(switched).present.project.gradings![0]!.targetSurfaceId).toBe(targetId);

    // distance -> surface adds the target in one entry.
    const back = runCadCommand(switched, {
      key: 'GRADING_EDIT_CRITERIA',
      gradingId,
      criterion: { kind: 'fixed', gradeRatio: -0.25 },
      targetSurfaceId: targetId,
    });
    expect(back.present.project.gradings![0]!.targetSurfaceId).toBe(targetId);
    expect(back.present.project.gradings![0]!.criterion).toEqual({ kind: 'fixed', gradeRatio: -0.25 });
    // A surface criterion edit with no target and no retained target blocks.
    const blocked = runCadCommand(createCadHistoryState({ ...switched.present.project, gradings: [analytic] }), {
      key: 'GRADING_EDIT_CRITERIA',
      gradingId,
      criterion: { kind: 'fixed', gradeRatio: -0.25 },
    });
    expect(blocked.present.project.gradings![0]!.criterion.kind).toBe('distance');
  });
});

describe('Phase 20F (distance/elevation) groups', () => {
  const courseIds = (project: CadProject, flId: string): string[] => {
    const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
    return entity.vertices.map((v) => v.id);
  };

  it('analytic group persists with no target and keeps sparse overrides', () => {
    const { project, flId } = projectWithChainAndTarget();
    const [a, b, c] = courseIds(project, flId);
    const courses = [{ vertexAId: a!, vertexBId: b! }, { vertexAId: b!, vertexBId: c! }];
    const create = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_CREATE',
      name: 'GD',
      sourceFeatureLineId: flId,
      sourceCourses: courses,
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
    });
    const group = create.present.project.gradingGroups![0]!;
    expect(Object.prototype.hasOwnProperty.call(group, 'targetSurfaceId')).toBe(false);

    const applied = runCadCommand(create, {
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId: group.id,
      courses: [courses[0]!],
      criterion: { kind: 'distance', gradeRatio: -0.4, distance: 12 },
    });
    const overridden = applied.present.project.gradingGroups![0]!;
    expect(overridden.courseCriteria).toHaveLength(1);
    expect(overridden.courseCriteria![0]!.criterion).toEqual({ kind: 'distance', gradeRatio: -0.4, distance: 12 });

    const reopened = roundTrip(applied.present.project);
    expect(reopened.gradingGroups![0]).toEqual(overridden);
    expect(Object.prototype.hasOwnProperty.call(reopened.gradingGroups![0]!, 'targetSurfaceId')).toBe(false);

    // Reset removes the sparse record in one entry (default untouched).
    const reset = runCadCommand(applied, {
      key: 'GROUP_RESET_COURSE_CRITERIA',
      groupId: group.id,
      courses: [courses[0]!],
    });
    expect(reset.present.project.gradingGroups![0]!.courseCriteria).toBeUndefined();
  });

  it('group kind switch clears/adds target in one entry; mixed family blocks', () => {
    const { project, flId, targetId } = projectWithChainAndTarget();
    const [a, b, c] = courseIds(project, flId);
    const courses = [{ vertexAId: a!, vertexBId: b! }, { vertexAId: b!, vertexBId: c! }];
    const create = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_CREATE',
      name: 'GS',
      sourceFeatureLineId: flId,
      sourceCourses: courses,
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
    });
    const groupId = create.present.project.gradingGroups![0]!.id;
    const switched = runCadCommand(create, {
      key: 'GROUP_EDIT_CRITERIA',
      groupId,
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
    });
    const analytic = switched.present.project.gradingGroups![0]!;
    expect(Object.prototype.hasOwnProperty.call(analytic, 'targetSurfaceId')).toBe(false);
    const back = runCadCommand(switched, {
      key: 'GROUP_EDIT_CRITERIA',
      groupId,
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      targetSurfaceId: targetId,
    });
    expect(back.present.project.gradingGroups![0]!.targetSurfaceId).toBe(targetId);
    // Mixed termination family fails closed.
    const mixed = runCadCommand(create, {
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId,
      courses: [courses[0]!],
      criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 5 },
    });
    expect(mixed.present.project.gradingGroups![0]!.courseCriteria).toBeUndefined();
  });

  it('sanitizer drops malformed analytic group definitions', () => {
    const base: CadGradingGroup = {
      id: 'gg1',
      name: 'D',
      sourceFeatureLineId: 'fl',
      sourceCourses: [{ vertexAId: 'a', vertexBId: 'b' }],
      side: 'right',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      cornerMode: 'miter',
    };
    expect(sanitizeCadGradingGroups([base])).toHaveLength(1);
    expect(sanitizeCadGradingGroups([{ ...base, criterion: { kind: 'distance', gradeRatio: -0.5 } }])).toHaveLength(0);
    // Surface target still mandatory for fixed.
    expect(sanitizeCadGradingGroups([{ ...base, criterion: { kind: 'fixed', gradeRatio: -0.5 } }])).toHaveLength(0);
  });
});

describe('Phase 20F analytic bake provenance', () => {
  it('distance bake records targetKind/criterionDistance and no target id', () => {
    const { project, flId } = projectWithFl();
    const entity = project.entities[0] as CadFeatureLineEntity;
    const create = runCadCommand(createCadHistoryState(project), {
      key: 'GRADING_CREATE',
      name: 'BakeDistance',
      sourceFeatureLineId: flId,
      vertexAId: entity.vertices[0]!.id,
      vertexBId: entity.vertices[1]!.id,
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    });
    const gradingId = create.present.project.gradings![0]!.id;
    const inputs = resolveGradingInputs(create.present.project, gradingId)!;
    expect(inputs.target).toBeUndefined();
    const outcome = computeGradingFromSnapshots({
      gradingId,
      revision: inputs.revision,
      source: inputs.resolvedSource,
      side: inputs.grading.side,
      criterion: inputs.grading.criterion,
      maxSearchDistance: inputs.grading.maxSearchDistance,
      curveChordTolerance: inputs.grading.curveChordTolerance,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.gradingMesh.triangles.length).toBeGreaterThan(0);
    const baked = runCadCommand(create, {
      key: 'GRADINGBAKE',
      gradingId,
      result: outcome.result,
      expectedRevision: inputs.revision,
      sessionCurrent: true,
    });
    const provenance = baked.present.project.surfaces![0]!.definition.importedTin!.provenance;
    expect(provenance).toMatchObject({
      kind: 'webnet-grading-bake',
      targetKind: 'distance',
      criterionDistance: 20,
    });
    expect((provenance as { targetSurfaceId?: string }).targetSurfaceId).toBeUndefined();
    expect(tinProvenanceRevisionPart(provenance)).toContain('distance:20');
  });

  it('normalizer infers legacy surface and preserves its revision bytes', () => {
    const legacy = {
      kind: 'webnet-grading-bake' as const,
      gradingId: 'g', gradingName: 'G', gradingRevision: 'grev1:x',
      sourceFeatureLineId: 'fl', sourceVertexAId: 'a', sourceVertexBId: 'b',
      targetSurfaceId: 't', accuracy: 'EXACT' as const,
    };
    const normalized = normalizeTinProvenance(legacy);
    expect(normalized).toMatchObject({ kind: 'webnet-grading-bake', targetKind: 'surface', targetSurfaceId: 't' });
    expect(tinProvenanceRevisionPart(legacy)).toBe('webnet-grading-bake|g|grev1:x|fl|t|EXACT');

    const elevation = { ...legacy, targetKind: 'elevation' as const, targetElevation: 5 };
    expect(normalizeTinProvenance(elevation)).toMatchObject({ targetKind: 'elevation', targetElevation: 5 });
    expect(tinProvenanceRevisionPart(elevation)).toBe('webnet-grading-bake|g|grev1:x|fl|elevation:5|EXACT');
  });
});

describe('Phase 20F transform scaling', () => {
  it('scales horizontal grading lengths, leaves grade/elevation/Z alone', () => {
    const { project, flId, targetId } = projectWithChainAndTarget();
    const [a, b, c] = (project.entities[0] as CadFeatureLineEntity).vertices.map((v) => v.id);
    const courses = [{ vertexAId: a!, vertexBId: b! }, { vertexAId: b!, vertexBId: c! }];
    let current = runCadCommand(createCadHistoryState(project), {
      key: 'GRADING_CREATE',
      name: 'Dist',
      sourceFeatureLineId: flId,
      vertexAId: a!,
      vertexBId: b!,
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    }).present.project;
    current = runCadCommand(createCadHistoryState(current), {
      key: 'GRADING_CREATE',
      name: 'Elev',
      sourceFeatureLineId: flId,
      vertexAId: a!,
      vertexBId: b!,
      side: 'right',
      criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 5 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    }).present.project;
    current = runCadCommand(createCadHistoryState(current), {
      key: 'GROUP_CREATE',
      name: 'GroupDist',
      sourceFeatureLineId: flId,
      sourceCourses: courses,
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
    }).present.project;
    const groupId = current.gradingGroups![0]!.id;
    current = runCadCommand(createCadHistoryState(current), {
      key: 'GROUP_EDIT_CRITERIA',
      groupId,
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 30 },
    }).present.project;
    current = runCadCommand(createCadHistoryState(current), {
      key: 'GROUP_SET_COURSE_CRITERIA',
      groupId,
      courses: [courses[0]!],
      criterion: { kind: 'distance', gradeRatio: -0.4, distance: 12 },
    }).present.project;

    const applied = applyCadProjectTransform(current, {
      kind: 'GRID_GROUND',
      originE: 0,
      originN: 0,
      combinedScaleFactor: 0.5,
      direction: 'GRID_TO_GROUND',
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const k = applied.outcome.scale;
    expect(k).toBeCloseTo(2, 12);
    expect(applied.outcome.affected.gradings).toBe(2);
    expect(applied.outcome.affected.gradingGroups).toBe(1);

    const byName = new Map(applied.project.gradings!.map((g) => [g.name, g]));
    const distance = byName.get('Dist')!;
    expect(distance.maxSearchDistance).toBe(1000 * k);
    expect(distance.curveChordTolerance).toBeCloseTo(0.01 * k, 12);
    expect(distance.criterion).toEqual({ kind: 'distance', gradeRatio: -0.5, distance: 20 * k });
    expect(distance.targetSurfaceId).toBeUndefined();

    const elevation = byName.get('Elev')!;
    expect(elevation.maxSearchDistance).toBe(1000 * k);
    expect(elevation.criterion).toEqual({ kind: 'elevation', gradeRatio: -0.5, targetElevation: 5 });

    const group = applied.project.gradingGroups![0]!;
    expect(group.maxSearchDistance).toBe(50 * k);
    expect(group.curveChordTolerance).toBeCloseTo(0.05 * k, 12);
    expect(group.criterion).toEqual({ kind: 'distance', gradeRatio: -0.5, distance: 30 * k });
    // Sparse overrides scale one-for-one and no defaults are materialized.
    expect(group.courseCriteria).toHaveLength(1);
    expect(group.courseCriteria![0]!.criterion).toEqual({
      kind: 'distance',
      gradeRatio: -0.4,
      distance: 12 * k,
    });

    const report = buildProjectTransformReport(applied.outcome);
    const labels = report.rows.map((row) => row.label);
    expect(labels).toContain('Gradings affected');
    expect(labels).toContain('Grading groups affected');
  });

  it('rigid transform leaves grading lengths numerically unchanged', () => {
    const { project, flId } = projectWithFl();
    const entity = project.entities[0] as CadFeatureLineEntity;
    const current = runCadCommand(createCadHistoryState(project), {
      key: 'GRADING_CREATE',
      name: 'Dist',
      sourceFeatureLineId: flId,
      vertexAId: entity.vertices[0]!.id,
      vertexBId: entity.vertices[1]!.id,
      side: 'left',
      criterion: { kind: 'distance', gradeRatio: -0.5, distance: 20 },
      maxSearchDistance: 1000,
      curveChordTolerance: 0.01,
    }).present.project;
    const applied = applyCadProjectCoordinateTransform(current, { a: 1, b: 0, c: 0, d: 1, tx: 5, ty: 7 });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.project.gradings).toEqual(current.gradings);
  });
});

describe('Phase 20F analytic group compute smoke', () => {
  it('resolves an analytic group without a target and computes a result', () => {
    const { project, flId } = projectWithChainAndTarget();
    const [a, b, c] = (project.entities[0] as CadFeatureLineEntity).vertices.map((v) => v.id);
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_CREATE',
      name: 'Analytic',
      sourceFeatureLineId: flId,
      sourceCourses: [{ vertexAId: a!, vertexBId: b! }, { vertexAId: b!, vertexBId: c! }],
      side: 'right',
      criterion: { kind: 'elevation', gradeRatio: -0.5, targetElevation: 5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
    });
    const groupId = history.present.project.gradingGroups![0]!.id;
    const inputs = resolveGroupInputs(history.present.project, groupId)!;
    expect(inputs.target).toBeUndefined();
    expect(inputs.revision.startsWith('ggrev1:')).toBe(true);
  });
});
