/**
 * Phase 20C Wave-3 group transactions: create/delete/edit/reassign/span/
 * add/remove-end lifecycle, extract + bake snapshot independence,
 * calculate-gate no-history, single-entry undo/redo, report content.
 */
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
} from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import { groupCalculateGate } from '../src/engine/cad/cadTransactionsGradingGroupCommands';
import {
  buildGroupCreateCommand,
  executeGradingGroupShellCommand,
  gradingGroupShellAvailable,
} from '../src/cad-app/shell/cadGradingGroupShell';
import { resolveShellCommandText } from '../src/cad-app/shell/cadCommandRegistry';
import {
  buildGroupCsv,
  buildGroupCsvFilename,
  buildGroupInquiryReport,
} from '../src/cad-app/shell/cadGradingGroupReport';
import type { CadShellActions } from '../src/cad-app/shell/cadShellTypes';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
import type {
  CadGradingGroup,
  CadGradingGroupResult,
} from '../src/engine/cad/grading/gradingGroupTypes';

let seq = 0;
const nextId = (prefix: string): string => {
  seq += 1;
  return `${prefix}-20c-gc${seq}`;
};

const vertex = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const makeChainFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    vertex(`feature-vertex:${id}:a`, 0, 0, 10),
    vertex(`feature-vertex:${id}:b`, 100, 0, 10),
    vertex(`feature-vertex:${id}:c`, 100, 100, 10),
    vertex(`feature-vertex:${id}:d`, 200, 100, 10),
  ],
});

const makeSquareFeatureLine = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  closed: true,
  vertices: [
    vertex(`feature-vertex:${id}:a`, 0, 0, 10),
    vertex(`feature-vertex:${id}:b`, 100, 0, 10),
    vertex(`feature-vertex:${id}:c`, 100, 100, 10),
    vertex(`feature-vertex:${id}:d`, 0, 100, 10),
  ],
});

const makeFlatTarget = (id: string, name: string): CadSurface => ({
  id,
  name,
  definition: {
    sourceKind: 'explicit-tin',
    pointSource: { kind: 'points', pointEntityIds: [] },
    importedTin: {
      vertices: [-60, -60, 0, 260, -60, 0, 260, 160, 0, -60, 160, 0],
      faces: [0, 1, 2, 0, 2, 3],
      provenance: { kind: 'webnet-bake', sourceSurfaceId: 'seed', sourceSurfaceName: 'seed', sourceRevision: 'srev1:seed' },
    },
  },
  cachedRevision: null,
});

const projectWithWorld = (): { project: CadProject; chainId: string; squareId: string; targetId: string; target2Id: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Group Commands', units: 'm' });
  const chainId = nextId('fl');
  const squareId = nextId('fl');
  const targetId = nextId('tgt');
  const target2Id = nextId('tgt');
  const project: CadProject = {
    ...drawing.project,
    entities: [makeChainFeatureLine(chainId), makeSquareFeatureLine(squareId)],
    surfaces: [makeFlatTarget(targetId, 'Target'), makeFlatTarget(target2Id, 'Target 2')],
  };
  return { project, chainId, squareId, targetId, target2Id };
};

const vertexIds = (project: CadProject, flId: string): string[] => {
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  return entity.vertices.map((v) => v.id);
};

const createOpenGroup = (project: CadProject, flId: string, targetId: string, name?: string): CadProject => {
  const [a, b, c] = vertexIds(project, flId);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    ...(name !== undefined ? { name } : {}),
    sourceFeatureLineId: flId,
    sourceCourses: [
      { vertexAId: a!, vertexBId: b! },
      { vertexAId: b!, vertexBId: c! },
    ],
    targetSurfaceId: targetId,
    side: 'right',
    criterion: { kind: 'fixed', gradeRatio: -0.5 },
    maxSearchDistance: 50,
    curveChordTolerance: 0.05,
  });
  return state.present.project;
};

const calculateGroup = (project: CadProject, groupId: string): CadGradingGroupResult => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) throw new Error('group inputs did not resolve');
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

const groupById = (project: CadProject, groupId: string): CadGradingGroup =>
  project.gradingGroups!.find((entry) => entry.id === groupId)!;

describe('group definition lifecycle', () => {
  it('create defaults the name, validates the chain, and rejects bad input with no history', () => {
    const { project, chainId, targetId } = projectWithWorld();
    const history = createCadHistoryState(project);
    const [a, b, c] = vertexIds(project, chainId);
    const done = runCadCommand(history, {
      key: 'GROUP_CREATE',
      sourceFeatureLineId: chainId,
      sourceCourses: [
        { vertexAId: a!, vertexBId: b! },
        { vertexAId: b!, vertexBId: c! },
      ],
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
    });
    expect(done.undoStack).toHaveLength(1);
    const group = done.present.project.gradingGroups![0]!;
    expect(group.name).toBe('Grading Group 1');
    // Disconnected chain fails closed with no history entry.
    const bad = runCadCommand(history, {
      key: 'GROUP_CREATE',
      name: 'Bad',
      sourceFeatureLineId: chainId,
      sourceCourses: [
        { vertexAId: a!, vertexBId: b! },
        { vertexAId: a!, vertexBId: b! },
      ],
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
    });
    expect(bad.present.project.gradingGroups ?? []).toHaveLength(0);
    expect(bad.undoStack).toHaveLength(0);
  });

  it('edit criteria / reassign target / edit span move the revision', () => {
    const { project, chainId, targetId, target2Id } = projectWithWorld();
    const withGroup = createOpenGroup(project, chainId, targetId, 'G1');
    const groupId = withGroup.gradingGroups![0]!.id;
    const rev0 = resolveGroupInputs(withGroup, groupId)!.revision;
    const edited = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUP_EDIT_CRITERIA',
      groupId,
      criterion: { kind: 'fixed', gradeRatio: -0.25 },
      maxSearchDistance: 60,
      curveChordTolerance: 0.1,
    }).present.project;
    expect(groupById(edited, groupId).criterion).toEqual({ kind: 'fixed', gradeRatio: -0.25 });
    expect(groupById(edited, groupId).maxSearchDistance).toBe(60);
    expect(resolveGroupInputs(edited, groupId)!.revision).not.toBe(rev0);
    // Empty edit (nothing to change) fails closed.
    const noop = runCadCommand(createCadHistoryState(withGroup), { key: 'GROUP_EDIT_CRITERIA', groupId });
    expect(noop.undoStack).toHaveLength(0);
    const reassigned = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUP_REASSIGN_TARGET',
      groupId,
      targetSurfaceId: target2Id,
    }).present.project;
    expect(groupById(reassigned, groupId).targetSurfaceId).toBe(target2Id);
    // Same-target reassign fails closed.
    const same = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUP_REASSIGN_TARGET',
      groupId,
      targetSurfaceId: targetId,
    });
    expect(same.undoStack).toHaveLength(0);
    // Edit span replaces the courses (single-course span survives).
    const [a, b] = vertexIds(project, chainId);
    const spanned = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUP_EDIT_SPAN',
      groupId,
      sourceCourses: [{ vertexAId: a!, vertexBId: b! }],
    }).present.project;
    expect(groupById(spanned, groupId).sourceCourses).toHaveLength(1);
    expect(resolveGroupInputs(spanned, groupId)!.revision).not.toBe(rev0);
  });

  it('add / remove-end courses follow the open-end rules', () => {
    const { project, chainId, targetId } = projectWithWorld();
    const withGroup = createOpenGroup(project, chainId, targetId, 'G1');
    const groupId = withGroup.gradingGroups![0]!.id;
    const [, , c, d] = vertexIds(project, chainId);
    const extended = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUP_ADD_COURSE',
      groupId,
      course: { vertexAId: c!, vertexBId: d! },
    }).present.project;
    expect(groupById(extended, groupId).sourceCourses).toHaveLength(3);
    // Non-touching course fails closed.
    const [a] = vertexIds(project, chainId);
    const bad = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUP_ADD_COURSE',
      groupId,
      course: { vertexAId: a!, vertexBId: a! },
    });
    expect(bad.undoStack).toHaveLength(0);
    const trimmed = runCadCommand(createCadHistoryState(extended), {
      key: 'GROUP_REMOVE_END_COURSE',
      groupId,
      which: 'last',
    }).present.project;
    expect(groupById(trimmed, groupId).sourceCourses).toEqual(
      groupById(withGroup, groupId).sourceCourses,
    );
  });

  it('delete drops the definition only; snapshots survive; undo restores', () => {
    const { project, chainId, targetId } = projectWithWorld();
    const withGroup = createOpenGroup(project, chainId, targetId, 'G1');
    const groupId = withGroup.gradingGroups![0]!.id;
    const result = calculateGroup(withGroup, groupId);
    const revision = resolveGroupInputs(withGroup, groupId)!.revision;
    const extracted = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    }).present.project;
    const snapshotId = extracted.entities.find(
      (entry) => entry.type === 'feature-line' && entry.name === 'G1 - Daylight',
    )!.id;
    const history = createCadHistoryState(extracted);
    const deleted = runCadCommand(history, { key: 'GROUP_DELETE', groupId });
    expect(deleted.present.project.gradingGroups).toHaveLength(0);
    // The snapshot survives the delete.
    expect(deleted.present.project.entities.some((entry) => entry.id === snapshotId)).toBe(true);
    expect(deleted.undoStack).toHaveLength(1);
    const undone = undoCadHistory(deleted);
    expect(undone.present.project.gradingGroups).toHaveLength(1);
    const redone = redoCadHistory(undone);
    expect(redone.present.project.gradingGroups).toHaveLength(0);
  });
});

describe('group extract + bake snapshots', () => {
  it('extract snapshots open→open with fresh ids, LINE courses, and one undo entry', () => {
    const { project, chainId, targetId } = projectWithWorld();
    const withGroup = createOpenGroup(project, chainId, targetId, 'G1');
    const groupId = withGroup.gradingGroups![0]!.id;
    const result = calculateGroup(withGroup, groupId);
    expect(result.daylightPoints.length).toBeGreaterThanOrEqual(6);
    const revision = resolveGroupInputs(withGroup, groupId)!.revision;
    // Stale revision fails closed.
    const stale = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result,
      expectedRevision: 'ggrev1:stale',
      sessionCurrent: true,
    });
    expect(stale.undoStack).toHaveLength(0);
    const history = createCadHistoryState(withGroup);
    const done = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(done.undoStack).toHaveLength(1);
    const snapshot = done.present.project.entities.find(
      (entry) => entry.type === 'feature-line' && entry.name === 'G1 - Daylight',
    ) as CadFeatureLineEntity;
    expect(snapshot.name).toBe('G1 - Daylight');
    expect(snapshot.closed).toBeUndefined();
    expect(snapshot.segmentGeometry).toBeUndefined();
    expect(snapshot.vertices.length).toBe(result.daylightPoints.length / 3);
    const sourceIds = new Set(vertexIds(withGroup, chainId));
    for (const v of snapshot.vertices) expect(sourceIds.has(v.id)).toBe(false);
    // Editing the group leaves the snapshot unchanged (independence).
    const edited = runCadCommand(done, {
      key: 'GROUP_EDIT_CRITERIA',
      groupId,
      criterion: { kind: 'fixed', gradeRatio: -0.1 },
    }).present.project;
    const after = edited.entities.find((entry) => entry.id === snapshot.id) as CadFeatureLineEntity;
    expect(after.vertices).toEqual(snapshot.vertices);
    // Undo removes the snapshot; redo restores it (single entry).
    const undone = undoCadHistory(done);
    expect(undone.present.project.entities.some((entry) => entry.id === snapshot.id)).toBe(false);
    expect(redoCadHistory(undone).present.project.entities.some((entry) => entry.id === snapshot.id)).toBe(true);
  });

  it('extract snapshots closed→closed; bake carries group provenance with independence', () => {
    const { project, squareId, targetId } = projectWithWorld();
    const [s0, s1, s2, s3] = vertexIds(project, squareId);
    const state = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_CREATE',
      name: 'Pad',
      sourceFeatureLineId: squareId,
      sourceCourses: [
        { vertexAId: s0!, vertexBId: s1! },
        { vertexAId: s1!, vertexBId: s2! },
        { vertexAId: s2!, vertexBId: s3! },
        { vertexAId: s3!, vertexBId: s0! },
      ],
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });
    const withGroup = state.present.project;
    const groupId = withGroup.gradingGroups![0]!.id;
    const result = calculateGroup(withGroup, groupId);
    expect(result.gradingMesh.triangles.length).toBeGreaterThan(0);
    const revision = resolveGroupInputs(withGroup, groupId)!.revision;
    const extracted = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    }).present.project;
    const snapshot = extracted.entities.find(
      (entry) => entry.type === 'feature-line' && entry.name === 'Pad - Daylight',
    ) as CadFeatureLineEntity;
    expect(snapshot.closed).toBe(true);
    const baked = runCadCommand(createCadHistoryState(withGroup), {
      key: 'GROUPBAKE',
      groupId,
      result,
      expectedRevision: revision,
      sessionCurrent: true,
    });
    expect(baked.undoStack).toHaveLength(1);
    const surface = baked.present.project.surfaces!.find((entry) => entry.name === 'Pad - Baked')!;
    const provenance = surface.definition.sourceKind === 'explicit-tin' &&
      surface.definition.importedTin != null
      ? surface.definition.importedTin.provenance
      : null;
    expect(provenance).toMatchObject({
      kind: 'webnet-grading-group-bake',
      groupId,
      groupName: 'Pad',
      groupRevision: revision,
      sourceFeatureLineId: squareId,
      targetSurfaceId: targetId,
      side: 'right',
      cornerMode: 'miter',
    });
    // Bake independence: a later group edit leaves the baked mesh alone.
    const bakedPayload = surface.definition.sourceKind === 'explicit-tin'
      ? surface.definition.importedTin
      : null;
    const edited = runCadCommand(baked, {
      key: 'GROUP_EDIT_CRITERIA',
      groupId,
      criterion: { kind: 'fixed', gradeRatio: -0.1 },
    }).present.project;
    const after = edited.surfaces!.find((entry) => entry.id === surface.id)!;
    const afterPayload = after.definition.sourceKind === 'explicit-tin' ? after.definition.importedTin : null;
    expect(afterPayload).toEqual(bakedPayload);
    // Undo removes the baked surface; redo restores it (single entry).
    const undone = undoCadHistory(baked);
    expect(undone.present.project.surfaces!.some((entry) => entry.id === surface.id)).toBe(false);
    expect(redoCadHistory(undone).present.project.surfaces!.some((entry) => entry.id === surface.id)).toBe(true);
  });

  it('calculate gate is explicit-only: no history, revision-gated', () => {
    const { project, chainId, targetId } = projectWithWorld();
    const withGroup = createOpenGroup(project, chainId, targetId, 'G1');
    const groupId = withGroup.gradingGroups![0]!.id;
    const history = createCadHistoryState(withGroup);
    const gated = groupCalculateGate(history.present.project, groupId, true);
    expect(gated.ok).toBe(true);
    if (gated.ok) {
      expect(gated.revision).toBe(resolveGroupInputs(withGroup, groupId)!.revision);
    }
    // The gate never touches history.
    expect(history.undoStack).toHaveLength(0);
    const staleTarget = groupCalculateGate(history.present.project, groupId, false);
    expect(staleTarget.ok).toBe(false);
    if (!staleTarget.ok) expect(staleTarget.message).toContain('SOURCE_NOT_CURRENT');
    const broken = groupCalculateGate(history.present.project, 'missing', true);
    expect(broken.ok).toBe(false);
  });
});

describe('group report', () => {
  it('inquiry summarizes the group with a corner table; CSV carries summary + corners + stations', () => {
    const { project, squareId, targetId } = projectWithWorld();
    const [s0, s1, s2, s3] = vertexIds(project, squareId);
    const state = runCadCommand(createCadHistoryState(project), {
      key: 'GROUP_CREATE',
      name: 'Pad',
      sourceFeatureLineId: squareId,
      sourceCourses: [
        { vertexAId: s0!, vertexBId: s1! },
        { vertexAId: s1!, vertexBId: s2! },
        { vertexAId: s2!, vertexBId: s3! },
        { vertexAId: s3!, vertexBId: s0! },
      ],
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
      closed: true,
    });
    const group = state.present.project.gradingGroups![0]!;
    const result = calculateGroup(state.present.project, group.id);
    const report = buildGroupInquiryReport(group, 'FL Pad', 'Target', 'CURRENT', result.accuracy, result);
    expect(report).toContain('Grading Group Inquiry — Pad');
    expect(report).toContain('Members: 4 · corners: 4');
    expect(report).toContain('Corners:');
    expect(report).toContain('#0 GAP');
    expect(report).not.toContain(group.id);
    const staleReport = buildGroupInquiryReport(group, 'FL Pad', 'Target', 'NEEDS_RECALC', null, null);
    expect(staleReport).toContain('No CURRENT result');
    const csv = buildGroupCsv(group, 'CURRENT', result.accuracy, result);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('Metric,Value');
    expect(csv).toContain('Corner,Classification,Miter Distance,Tie E,Tie N,Tie Z,Diagnostics');
    expect(csv).toContain('Station,Daylight E,Daylight N,Daylight Z');
    const cornerRows = lines.filter((line) => /^[0-3],GAP,/.test(line));
    expect(cornerRows).toHaveLength(4);
    const stationRows = lines.filter((line) => /^\d+,-?\d+\.\d+,-?\d+\.\d+,-?\d+\.\d+$/.test(line));
    expect(stationRows.length).toBe(result.daylightPoints.length / 3);
    expect(buildGroupCsvFilename('Pad 1')).toBe('grading-group-pad-1.csv');
  });
});

describe('group shell + registry', () => {
  it('GG alias resolves collision-free; shell routes explicit calls', () => {
    expect(resolveShellCommandText('GG')?.key).toBe('GRADEGROUP');
    expect(resolveShellCommandText('GRADINGGROUPCALC')?.key).toBe('GRADINGGROUPCALC');
    expect(resolveShellCommandText('GROUPEXTRACTDAYLIGHT')?.key).toBe('GRADINGGROUPEXTRACTDAYLIGHT');
    const actions = {
      runGradingGroupCommand: () => true,
      requestGroupGradingCalculate: (_groupId: string) => 'Computing…',
      extractGroupDaylight: (_groupId: string) => 'Extracted.',
      bakeGroupSurface: (_groupId: string) => 'Baked.',
      openGradingGroupManager: () => undefined,
    } as unknown as CadShellActions;
    expect(gradingGroupShellAvailable('GRADEGROUP', actions)).toBe(true);
    expect(gradingGroupShellAvailable('GRADINGGROUPCALC', actions)).toBe(true);
    expect(gradingGroupShellAvailable('NOPE', actions)).toBe(false);
    expect(gradingGroupShellAvailable('GRADEGROUP', null)).toBe(false);
    // CALC needs an explicit group id (no viewport picking).
    expect(executeGradingGroupShellCommand('GRADINGGROUPCALC', actions, null, { groupId: 'g1' })).toBe(true);
    expect(executeGradingGroupShellCommand('GRADINGGROUPCALC', actions, null)).toBe(false);
    expect(executeGradingGroupShellCommand('GRADEGROUP', actions, null)).toBe(false);
    const { project, chainId, targetId } = projectWithWorld();
    const [a, b] = vertexIds(project, chainId);
    const built = buildGroupCreateCommand({
      sourceFeatureLineId: chainId,
      sourceCourses: [{ vertexAId: a!, vertexBId: b! }],
      targetSurfaceId: targetId,
      side: 'right',
      criterion: { kind: 'fixed', gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
    });
    expect(built.key).toBe('GROUP_CREATE');
    expect(
      executeGradingGroupShellCommand('GRADEGROUP', actions, null, {
        create: {
          sourceFeatureLineId: chainId,
          sourceCourses: [{ vertexAId: a!, vertexBId: b! }],
          targetSurfaceId: targetId,
          side: 'right',
          criterion: { kind: 'fixed', gradeRatio: -0.5 },
          maxSearchDistance: 50,
          curveChordTolerance: 0.05,
        },
      }),
    ).toBe(true);
  });
});
