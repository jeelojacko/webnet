/**
 * Phase 20J Wave C1 — hybrid grading-group provenance.
 *
 * Engine side only. Pins the hybrid product seam: group-bake and
 * design-patch provenances record targetKind `hybrid` with canonical
 * terminationKinds (only-effective order, never singular analytic values),
 * legacy homogeneous and mixed-analytic legs stay byte-identical, Extract
 * names the hybrid boundary `Grading Boundary` (homogeneous keeps
 * `Daylight`), Extract/Bake/DesignPatch stay CURRENT-only with one undo
 * entry each, a closed CURRENT hybrid design-patches to the homogeneous
 * control geometry, warped interiors block with a stable reason, and any
 * member/corner failure surfaces as FAILED (never exported).
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  parseCadDrawingFile,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import {
  createCadHistoryState,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import {
  normalizeTinProvenance,
  tinProvenanceRevisionPart,
} from '../src/engine/cad/cadImportedTin';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { deriveGroupStatus } from '../src/engine/cad/grading/gradingGroupStatus';
import { deriveFailedEffectiveStatus } from '../src/engine/cad/grading/gradingStatus';
import {
  resolveDesignPatch,
} from '../src/engine/cad/cadTransactionsDesignPatchCommands';
import { resolveDesignPatchInterior } from '../src/engine/cad/grading/designPatchBuild';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingGroup, CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion } from '../src/engine/cad/grading/gradingTypes';

const FIXED = (g: number): GradingCriterion => ({ kind: 'fixed', gradeRatio: g });
const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });
const ELEV = (g: number, e: number): GradingCriterion => ({ kind: 'elevation', gradeRatio: g, targetElevation: e });
const REL = (g: number, dz: number): GradingCriterion =>
  ({ kind: 'relative-elevation', gradeRatio: g, relativeElevation: dz });

const vertex = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const squareFeatureLine = (id: string): CadFeatureLineEntity => ({
  id, type: 'feature-line', layerId: 'general', visible: true, locked: false, name: `FL ${id}`,
  closed: true,
  vertices: [
    vertex(`${id}:a`, 0, 0, 10), vertex(`${id}:b`, 100, 0, 10),
    vertex(`${id}:c`, 100, 100, 10), vertex(`${id}:d`, 0, 100, 10),
  ],
});

const flatTarget = (id: string): CadSurface => ({
  id, name: `Target ${id}`,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-60, -60, 0, 160, -60, 0, 160, 160, 0, -60, 160, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const world = (): { project: CadProject; squareId: string; targetId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: '20j-prov', units: 'm' });
  const project: CadProject = {
    ...drawing.project,
    entities: [squareFeatureLine('fl-sq')],
    surfaces: [flatTarget('tgt')],
    gradingGroups: [],
  };
  return { project, squareId: 'fl-sq', targetId: 'tgt' };
};

const courseRefs = (project: CadProject, flId: string): Array<{ vertexAId: string; vertexBId: string }> => {
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  const ids = entity.vertices.map((v) => v.id);
  return ids.map((a, i) => ({ vertexAId: a!, vertexBId: ids[(i + 1) % ids.length]! }));
};

const hybridGroup = (project: CadProject, squareId: string, targetId: string, name: string): CadGradingGroup => {
  const [c0, c1, c2, c3] = courseRefs(project, squareId);
  return {
    id: `gg-${name}`, name, sourceFeatureLineId: squareId,
    sourceCourses: [c0!, c1!, c2!, c3!], targetSurfaceId: targetId,
    side: 'right', criterion: FIXED(-0.5),
    courseCriteria: [
      { sourceCourse: c1!, criterion: DIST(-0.5, 20) },
      { sourceCourse: c2!, criterion: ELEV(-0.5, 0) },
      { sourceCourse: c3!, criterion: REL(-0.5, -10) },
    ],
    maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
  };
};

const surfaceGroup = (project: CadProject, squareId: string, targetId: string, name: string): CadGradingGroup => {
  const group = hybridGroup(project, squareId, targetId, name);
  const { courseCriteria: _dropped, id: _id, ...rest } = group;
  return { ...rest, id: `gg-${name}` };
};

const withGroups = (project: CadProject, groups: CadGradingGroup[]): CadProject => ({
  ...project, gradingGroups: groups,
});

const calculateGroup = (project: CadProject, groupId: string): CadGradingGroupResult => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) throw new Error('group inputs did not resolve');
  if (!inputs.target) throw new Error('hybrid group must resolve a target');
  const built = buildCadSurface(project, inputs.target);
  expect(built.outcome).toBe('ok');
  if (built.outcome !== 'ok') throw new Error('target build failed');
  const flat = (points: Array<{ x: number; y: number; z: number }>): number[] =>
    points.flatMap((p) => [p.x, p.y, p.z]);
  const outcome = computeGradingGroupFromSnapshots({
    groupId,
    revision: inputs.revision,
    members: inputs.memberSources,
    side: inputs.group.side,
    criterion: inputs.group.criterion,
    memberCriteria: inputs.memberCriteria,
    maxSearchDistance: inputs.group.maxSearchDistance,
    curveChordTolerance: inputs.group.curveChordTolerance,
    closed: inputs.group.closed === true,
    target: {
      points: flat(built.points),
      triangles: built.triangles.flatMap((tri) => [...tri]),
    },
  });
  if (!outcome.ok) throw new Error(`group compute failed: ${outcome.code} ${outcome.detail}`);
  return outcome.result;
};

const bakeProvenanceOf = (project: CadProject, name: string): Record<string, unknown> => {
  const surface = project.surfaces!.find((entry) => entry.name === name)!;
  const definition = surface.definition;
  if (definition.sourceKind !== 'explicit-tin' || !definition.importedTin) {
    throw new Error(`surface ${name} is not an explicit TIN`);
  }
  return definition.importedTin.provenance as unknown as Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// 1. Hybrid bake provenance shape + revision legs (legacy pins frozen)
// ---------------------------------------------------------------------------
describe('(1) hybrid bake provenance', () => {
  const bakedHybrid = (): { project: CadProject; groupId: string; revision: string } => {
    const { project, squareId, targetId } = world();
    const staged = withGroups(project, [hybridGroup(project, squareId, targetId, 'Hybrid')]);
    const groupId = staged.gradingGroups![0]!.id;
    const result = calculateGroup(staged, groupId);
    expect(result.corners).toHaveLength(4);
    const revision = resolveGroupInputs(staged, groupId)!.revision;
    const done = runCadCommand(createCadHistoryState(staged), {
      key: 'GROUPBAKE', groupId, result, expectedRevision: revision, sessionCurrent: true,
    });
    expect(done.undoStack).toHaveLength(1);
    return { project: done.present.project, groupId, revision };
  };

  it('records hybrid truthfully: kind, canonical kinds, target, no singular values', () => {
    const { project, groupId, revision } = bakedHybrid();
    const provenance = bakeProvenanceOf(project, 'Hybrid - Baked');
    expect(provenance).toMatchObject({
      kind: 'webnet-grading-group-bake',
      groupId,
      groupName: 'Hybrid',
      groupRevision: revision,
      sourceFeatureLineId: 'fl-sq',
      targetKind: 'hybrid',
      terminationKinds: ['surface', 'distance', 'elevation', 'relative-elevation'],
      targetSurfaceId: 'tgt',
      side: 'right',
      cornerMode: 'miter',
    });
    expect(provenance).not.toHaveProperty('criterionDistance');
    expect(provenance).not.toHaveProperty('targetElevation');
    expect(provenance).not.toHaveProperty('relativeElevation');
    expect(provenance).not.toHaveProperty('analyticKinds');
    expect(JSON.stringify(provenance)).toContain('terminationKinds');
  });

  it('freezes the legacy legs and adds the hybrid leg (only present, canonical order)', () => {
    const { project, groupId, revision } = bakedHybrid();
    const hybridLeg = tinProvenanceRevisionPart(bakeProvenanceOf(project, 'Hybrid - Baked') as never);
    expect(hybridLeg).toBe(
      `webnet-grading-group-bake|${groupId}|${revision}|fl-sq|hybrid:surface+distance+elevation+relative-elevation|EXACT`,
    );
    // Homogeneous surface leg: the bare target id, byte-identical to pre-20J.
    expect(tinProvenanceRevisionPart({
      kind: 'webnet-grading-group-bake', groupId: 'g', groupName: 'g', groupRevision: 'ggrev1:x',
      sourceFeatureLineId: 'fl', sourceCourseRefs: ['a>b'], targetSurfaceId: 'tgt',
      side: 'right', accuracy: 'EXACT', cornerMode: 'miter',
    } as never)).toBe('webnet-grading-group-bake|g|ggrev1:x|fl|tgt|EXACT');
    // Mixed-analytic leg unchanged (20H bytes).
    expect(tinProvenanceRevisionPart({
      kind: 'webnet-grading-group-bake', groupId: 'g', groupName: 'g', groupRevision: 'ggrev1:x',
      sourceFeatureLineId: 'fl', sourceCourseRefs: ['a>b'], targetKind: 'mixed-analytic',
      analyticKinds: ['elevation', 'distance'], side: 'right', accuracy: 'EXACT', cornerMode: 'miter',
    } as never)).toBe('webnet-grading-group-bake|g|ggrev1:x|fl|mixed-analytic:distance+elevation|EXACT');
    // A hybrid subset leg lists only the present kinds in canonical order.
    expect(tinProvenanceRevisionPart({
      kind: 'webnet-grading-group-bake', groupId: 'g', groupName: 'g', groupRevision: 'ggrev1:x',
      sourceFeatureLineId: 'fl', sourceCourseRefs: ['a>b'], targetKind: 'hybrid',
      terminationKinds: ['distance', 'surface'], targetSurfaceId: 'tgt',
      side: 'right', accuracy: 'EXACT', cornerMode: 'miter',
    } as never)).toBe('webnet-grading-group-bake|g|ggrev1:x|fl|hybrid:surface+distance|EXACT');
  });

  it('normalizes hybrid read-tolerantly: canonical order, unknown dropped, target kept', () => {
    const normalized = normalizeTinProvenance({
      kind: 'webnet-grading-group-bake', groupId: 'g', groupName: 'g', groupRevision: 'ggrev1:x',
      sourceFeatureLineId: 'fl', sourceCourseRefs: ['a>b'], targetKind: 'hybrid',
      terminationKinds: ['relative-elevation', 'bogus', 'surface', 'distance'] as never,
      targetSurfaceId: 'tgt', criterionDistance: 99,
      side: 'right', accuracy: 'EXACT', cornerMode: 'miter',
    } as never);
    expect(normalized).toMatchObject({
      kind: 'webnet-grading-group-bake',
      targetKind: 'hybrid',
      terminationKinds: ['surface', 'distance', 'relative-elevation'],
      targetSurfaceId: 'tgt',
    });
    expect(normalized).not.toHaveProperty('criterionDistance');
    expect(normalized).not.toHaveProperty('analyticKinds');
  });

  it('round-trips the hybrid bake through WNCAD byte-identically', () => {
    const { project } = bakedHybrid();
    const drawing = createBlankCadDrawingDocument({ name: '20j-bake', units: 'm' });
    const first = serializeCadDrawingFile({ ...drawing, project });
    const parsed = parseCadDrawingFile(first);
    if (!parsed.ok) throw new Error('parse failed');
    expect(serializeCadDrawingFile(parsed.drawing)).toBe(first);
    expect(bakeProvenanceOf(parsed.drawing.project, 'Hybrid - Baked')).toMatchObject({
      targetKind: 'hybrid',
      terminationKinds: ['surface', 'distance', 'elevation', 'relative-elevation'],
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Extract: hybrid boundary name, exact id/rev, one undo, CURRENT-only
// ---------------------------------------------------------------------------
describe('(2) hybrid extract', () => {
  it('extracts one "<group> - Grading Boundary" feature line in one undo entry', () => {
    const { project, squareId, targetId } = world();
    const staged = withGroups(project, [hybridGroup(project, squareId, targetId, 'Hybrid')]);
    const groupId = staged.gradingGroups![0]!.id;
    const result = calculateGroup(staged, groupId);
    const revision = resolveGroupInputs(staged, groupId)!.revision;
    const done = runCadCommand(createCadHistoryState(staged), {
      key: 'GROUPEXTRACTDAYLIGHT', groupId, result, expectedRevision: revision, sessionCurrent: true,
    });
    expect(done.undoStack).toHaveLength(1);
    const snapshot = done.present.project.entities.find(
      (entry) => entry.type === 'feature-line' && entry.name === 'Hybrid - Grading Boundary',
    ) as CadFeatureLineEntity;
    expect(snapshot).toBeDefined();
    expect(snapshot.vertices.length).toBe(result.daylightPoints.length / 3);
    const undone = undoCadHistory(done);
    expect(undone.present.project.entities.some((entry) => entry.id === snapshot.id)).toBe(false);
  });

  it('keeps the legacy "- Daylight" name for homogeneous groups', () => {
    const { project, squareId, targetId } = world();
    const staged = withGroups(project, [surfaceGroup(project, squareId, targetId, 'Pad')]);
    const groupId = staged.gradingGroups![0]!.id;
    const result = calculateGroup(staged, groupId);
    const revision = resolveGroupInputs(staged, groupId)!.revision;
    const done = runCadCommand(createCadHistoryState(staged), {
      key: 'GROUPEXTRACTDAYLIGHT', groupId, result, expectedRevision: revision, sessionCurrent: true,
    });
    expect(done.present.project.entities.some(
      (entry) => entry.type === 'feature-line' && entry.name === 'Pad - Daylight',
    )).toBe(true);
  });

  it('blocks stale/non-current extract + bake (stale priors never export)', () => {
    const { project, squareId, targetId } = world();
    const staged = withGroups(project, [hybridGroup(project, squareId, targetId, 'Hybrid')]);
    const groupId = staged.gradingGroups![0]!.id;
    const result = calculateGroup(staged, groupId);
    for (const key of ['GROUPEXTRACTDAYLIGHT', 'GROUPBAKE'] as const) {
      const stale = runCadCommand(createCadHistoryState(staged), {
        key, groupId, result, expectedRevision: 'ggrev1:stale', sessionCurrent: true,
      });
      expect(stale.undoStack).toHaveLength(0);
      const notCurrent = runCadCommand(createCadHistoryState(staged), {
        key, groupId, result,
        expectedRevision: resolveGroupInputs(staged, groupId)!.revision,
        sessionCurrent: false,
      });
      expect(notCurrent.undoStack).toHaveLength(0);
    }
    const stalePatch = resolveDesignPatch(staged, groupId, result, 'ggrev1:stale', true);
    expect(stalePatch.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Design Patch: closed CURRENT hybrid, control geometry, truthful provenance
// ---------------------------------------------------------------------------
describe('(3) hybrid design patch', () => {
  const currentHybrid = (): { project: CadProject; groupId: string; result: CadGradingGroupResult; revision: string } => {
    const { project, squareId, targetId } = world();
    const staged = withGroups(project, [hybridGroup(project, squareId, targetId, 'Hybrid')]);
    const groupId = staged.gradingGroups![0]!.id;
    const result = calculateGroup(staged, groupId);
    const revision = resolveGroupInputs(staged, groupId)!.revision;
    return { project: staged, groupId, result, revision };
  };

  it('patches a closed CURRENT hybrid with the homogeneous control geometry', () => {
    const { project, groupId, result, revision } = currentHybrid();
    const resolved = resolveDesignPatch(project, groupId, result, revision, true);
    if (!resolved.ok) throw new Error(`patch blocked: ${resolved.code} ${resolved.detail}`);
    expect(resolved.value.provenance).toMatchObject({
      kind: 'webnet-grading-design-patch',
      groupId,
      groupRevision: revision,
      targetKind: 'hybrid',
      terminationKinds: ['surface', 'distance', 'elevation', 'relative-elevation'],
      targetSurfaceId: 'tgt',
    });
    expect(resolved.value.provenance.targetSurfaceRevision).toBe(
      resolveGroupInputs(project, groupId)!.targetRevision,
    );
    expect(resolved.value.provenance).not.toHaveProperty('criterionDistance');
    // Homogeneous control: identical merged output point-for-point.
    const { project: controlWorld, squareId, targetId } = world();
    const control = withGroups(controlWorld, [surfaceGroup(controlWorld, squareId, targetId, 'Control')]);
    const controlId = control.gradingGroups![0]!.id;
    const controlResult = calculateGroup(control, controlId);
    const controlResolved = resolveDesignPatch(
      control, controlId, controlResult, resolveGroupInputs(control, controlId)!.revision, true,
    );
    if (!controlResolved.ok) throw new Error('control patch blocked');
    expect(resolved.value.points).toEqual(controlResolved.value.points);
    expect(resolved.value.triangles).toEqual(controlResolved.value.triangles);
    // Design-patch leg carries the hybrid kinds + target revision.
    const leg = tinProvenanceRevisionPart(resolved.value.provenance);
    expect(leg).toContain('|hybrid:surface+distance+elevation+relative-elevation|');
    expect(leg).toContain(`|${resolveGroupInputs(project, groupId)!.targetRevision}|`);
  });

  it('commits the patch in one undo entry and removes it on undo', () => {
    const { project, groupId, result, revision } = currentHybrid();
    const done = runCadCommand(createCadHistoryState(project), {
      key: 'DESIGNPATCH', groupId, result, expectedRevision: revision, sessionCurrent: true,
    });
    expect(done.undoStack).toHaveLength(1);
    const surface = done.present.project.surfaces!.find(
      (entry) => entry.name === 'Hybrid - Design Patch',
    )!;
    expect(bakeProvenanceOf(done.present.project, surface.name)).toMatchObject({ targetKind: 'hybrid' });
    const undone = undoCadHistory(done);
    expect(undone.present.project.surfaces!.some((entry) => entry.id === surface.id)).toBe(false);
  });

  it('blocks warped interiors with a stable reason (never averaged)', () => {
    // Warped ring: fourth corner lifted — no flat or exactly-coplanar fit.
    const warped = [0, 0, 10, 100, 0, 10, 100, 100, 10, 0, 100, 17, 50, 50, 10];
    const interior = resolveDesignPatchInterior(warped);
    expect(interior.ok).toBe(false);
    if (interior.ok) throw new Error('warped interior must block');
    expect(interior.code).toBe('DESIGN_PATCH_NON_PLANAR_INTERIOR_UNDEFINED');
  });
});

// ---------------------------------------------------------------------------
// 4. Status: member/corner failure => FAILED; stale priors never export
// ---------------------------------------------------------------------------
describe('(4) hybrid failure status', () => {
  it('a hybrid corner mismatch fails closed and reads FAILED at the current revision', () => {
    const { project, squareId, targetId } = world();
    const [c0, c1, c2, c3] = courseRefs(project, squareId);
    const mismatched: CadGradingGroup = {
      id: 'gg-bad', name: 'Bad', sourceFeatureLineId: squareId,
      sourceCourses: [c0!, c1!, c2!, c3!], targetSurfaceId: targetId,
      side: 'right', criterion: FIXED(-0.5),
      courseCriteria: [{ sourceCourse: c1!, criterion: DIST(-0.5, 24) }],
      maxSearchDistance: 50, curveChordTolerance: 0.05, cornerMode: 'miter', closed: true,
    };
    const staged = withGroups(project, [mismatched]);
    const inputs = resolveGroupInputs(staged, 'gg-bad')!;
    const built = buildCadSurface(staged, inputs.target!);
    if (built.outcome !== 'ok') throw new Error('target build failed');
    const flat = (points: Array<{ x: number; y: number; z: number }>): number[] =>
      points.flatMap((p) => [p.x, p.y, p.z]);
    const outcome = computeGradingGroupFromSnapshots({
      groupId: 'gg-bad', revision: inputs.revision, members: inputs.memberSources,
      side: 'right', criterion: FIXED(-0.5), memberCriteria: inputs.memberCriteria,
      maxSearchDistance: 50, curveChordTolerance: 0.05, closed: true,
      target: {
        points: flat(built.points),
        triangles: built.triangles.flatMap((tri) => [...tri]),
      },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected failure');
    expect(outcome.code).toBe('CORNER_NO_SOLUTION');
    // Session overlay: the CURRENT-revision diagnostic reads FAILED (never CURRENT).
    const derived = deriveGroupStatus({
      brokenRef: false, building: false, hasResult: false,
      sourceCurrent: true, needsRecalc: false,
    });
    expect(derived).toBe('UNBUILT');
    expect(deriveFailedEffectiveStatus(
      derived,
      { revision: inputs.revision, error: `${outcome.code}: ${outcome.detail}` },
      inputs.revision,
    )).toBe('FAILED');
    // A diagnostic from another revision never poisons the row.
    expect(deriveFailedEffectiveStatus(derived, { revision: 'ggrev1:other', error: 'x' }, inputs.revision))
      .toBe('UNBUILT');
  });
});
