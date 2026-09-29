/** @vitest-environment jsdom */
/**
 * Phase 20F.3 Worker A — grading-group shell command truthfulness.
 *
 * Focused registry/adapter coverage: selection-routed CALC / Extract / Bake
 * (exact id, exactly once), explicit override, invalid/missing fail-closed,
 * missing-action false, availability==execution parity, the status gate
 * matrix, Create/Manager/Inquiry/Criteria targeting, standalone preservation,
 * and no first-row fallback. All dispatch assertions go through the central
 * registry path (`isShellCommandAvailable` + `executeShellCommand`).
 */
import { describe, expect, it } from 'vitest';

import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  type CadShellCommandDef,
} from '../src/cad-app/shell/cadCommandRegistry';
import {
  executeGradingGroupShellCommand,
  gradingGroupShellAvailable,
  resolveGradingGroupRow,
} from '../src/cad-app/shell/cadGradingGroupShell';
import {
  buildCadGradingGroupSnapshot,
  type CadGradingGroupSnapshot,
} from '../src/cad-app/shell/cadGradingGroupSnapshot';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import { createCadHistoryState, runCadCommand } from '../src/engine/cad/cadUndoRedo';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGradingGroupResult } from '../src/engine/cad/grading/gradingGroupTypes';

const vertex = (id: string, x: number, y: number, z: number) => ({ id, x, y, z });

const makeChain = (id: string): CadFeatureLineEntity => ({
  id,
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: `FL ${id}`,
  vertices: [
    vertex(`${id}:a`, 0, 0, 10),
    vertex(`${id}:b`, 100, 0, 10),
    vertex(`${id}:c`, 100, 100, 10),
    vertex(`${id}:d`, 200, 100, 10),
  ],
});

const makeFlatTarget = (id: string): CadSurface => ({
  id,
  name: 'Target',
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

const baseProject = (): { project: CadProject; flId: string; targetId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Group shell 20F.3', units: 'm' });
  const flId = 'fl-shell-20f3';
  const targetId = 'tgt-shell-20f3';
  return { project: { ...drawing.project, entities: [makeChain(flId)], surfaces: [makeFlatTarget(targetId)] }, flId, targetId };
};

const addGroup = (project: CadProject, flId: string, targetId: string, name: string): CadProject => {
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  const [a, b, c] = entity.vertices.map((v) => v.id);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name,
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

const fullSurfaceCache = (project: CadProject) => {
  const cache = createCadSurfaceCache('group-shell-20f3');
  for (const surface of project.surfaces ?? []) {
    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
    if (built.outcome !== 'ok') throw new Error('target build failed');
    cache.set(surface.id, built.revision, {
      revision: built.revision,
      points: built.points,
      triangles: built.triangles,
      stats: built.stats,
      grid: built.grid,
      adjacency: built.adjacency,
      edgeKinds: built.edgeKinds,
    });
  }
  return cache;
};

const emptySurfaceCache = () => createCadSurfaceCache('group-shell-20f3-empty');

const calculateGroup = (project: CadProject, groupId: string): CadGradingGroupResult => {
  const inputs = resolveGroupInputs(project, groupId);
  if (!inputs) throw new Error('group inputs did not resolve');
  const built = buildCadSurface(project, inputs.target!);
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
    target: { points: flat(built.points), triangles: built.triangles.flatMap((tri) => [...tri]) },
  });
  if (!outcome.ok) throw new Error(`group compute failed: ${outcome.code}`);
  return outcome.result;
};

const groupCacheOf = (results: readonly CadGradingGroupResult[]) => ({
  get: (id: string, revision: string) => results.find((r) => r.groupId === id && r.revision === revision),
  retained: (id: string) => results.filter((r) => r.groupId === id),
});

/** Two-group project + CURRENT result for the first group. */
const twoGroupSetup = () => {
  const { project, flId, targetId } = baseProject();
  const withTwo = addGroup(addGroup(project, flId, targetId, 'First'), flId, targetId, 'Second');
  const [firstId, secondId] = withTwo.gradingGroups!.map((group) => group.id);
  const surfaceCache = fullSurfaceCache(withTwo);
  const result = calculateGroup(withTwo, firstId!);
  return { project: withTwo, firstId: firstId!, secondId: secondId!, surfaceCache, result };
};

const snapOf = (
  project: CadProject,
  selectedId: string | null,
  opts?: {
    surfaceCache?: ReturnType<typeof fullSurfaceCache>;
    results?: readonly CadGradingGroupResult[];
    building?: boolean;
    diagnostics?: boolean;
  },
): CadWorkspaceSnapshot => {
  const groupId = project.gradingGroups![0]!.id;
  const groups = buildCadGradingGroupSnapshot(
    project,
    opts?.surfaceCache ?? fullSurfaceCache(project),
    groupCacheOf(opts?.results ?? []),
    selectedId,
    {
      ...(opts?.building ? { buildingGroupIds: new Set([groupId]) } : {}),
      ...(opts?.diagnostics
        ? {
            sessionDiagnostics: new Map([
              [groupId, { revision: buildCadGradingGroupSnapshot(project, fullSurfaceCache(project), groupCacheOf([]), groupId).groups[0]!.revision, error: 'boom' }],
            ]),
          }
        : {}),
    },
  );
  return { gradingGroups: groups } as unknown as CadWorkspaceSnapshot;
};

const spyActions = () => {
  const calls: string[] = [];
  const opened: Array<{ id: string | undefined; tab: string | undefined }> = [];
  const actions = {
    runGradingGroupCommand: (command: { key: string }) => { calls.push(`run:${command.key}`); return true; },
    requestGroupGradingCalculate: (id: string) => { calls.push(`calc:${id}`); return 'Computing…'; },
    extractGroupDaylight: (id: string) => { calls.push(`extract:${id}`); return 'Extracted.'; },
    bakeGroupSurface: (id: string) => { calls.push(`bake:${id}`); return 'Baked.'; },
    openGradingGroupManager: (id?: string, tab?: 'definition' | 'criteria' | 'inquiry') => {
      opened.push({ id, tab });
    },
  } as unknown as CadShellActions;
  return { actions, calls, opened };
};

const defFor = (key: string): CadShellCommandDef => {
  const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === key);
  if (!def) throw new Error(`missing registry def ${key}`);
  return def;
};

const viaRegistry = (key: string, snapshot: CadWorkspaceSnapshot | null, actions: CadShellActions | null) => {
  const def = defFor(key);
  return { available: isShellCommandAvailable(def, snapshot, actions), executed: executeShellCommand(def, actions, snapshot) };
};

describe('resolver precedence', () => {
  it('prefers an explicit group id, else the snapshot selection, else fail closed', () => {
    const { project, firstId, secondId, surfaceCache, result } = twoGroupSetup();
    const groups: CadGradingGroupSnapshot = buildCadGradingGroupSnapshot(
      project, surfaceCache, groupCacheOf([result]), secondId,
    );
    const snapshot = { gradingGroups: groups } as unknown as CadWorkspaceSnapshot;
    expect(resolveGradingGroupRow(snapshot)?.id).toBe(secondId);
    expect(resolveGradingGroupRow(snapshot, { groupId: firstId })?.id).toBe(firstId);
    // Explicit id naming no row fails closed WITHOUT falling back to selection.
    expect(resolveGradingGroupRow(snapshot, { groupId: 'nope' })).toBeNull();
    expect(resolveGradingGroupRow(null)).toBeNull();
    expect(resolveGradingGroupRow(null, { groupId: firstId })).toBeNull();
  });

  it('never picks the first row when the selection is missing or invalid', () => {
    const { project, surfaceCache, result } = twoGroupSetup();
    for (const selected of [null, 'nope'] as const) {
      const groups = buildCadGradingGroupSnapshot(project, surfaceCache, groupCacheOf([result]), selected);
      const snapshot = { gradingGroups: groups } as unknown as CadWorkspaceSnapshot;
      expect(snapshot.gradingGroups!.groups).toHaveLength(2);
      expect(resolveGradingGroupRow(snapshot)).toBeNull();
      const { actions, calls } = spyActions();
      expect(executeGradingGroupShellCommand('GRADINGGROUPCALC', actions, snapshot)).toBe(false);
      expect(calls).toHaveLength(0);
    }
  });
});

describe('selection-routed dispatch through the registry', () => {
  it.each([
    ['GRADINGGROUPCALC', 'calc'],
    ['GRADINGGROUPEXTRACTDAYLIGHT', 'extract'],
    ['GRADINGGROUPBAKE', 'bake'],
  ])('%s dispatches the selected id exactly once', (key, prefix) => {
    const { project, firstId, secondId, surfaceCache, result } = twoGroupSetup();
    // Second group has no result: select the CURRENT first group instead.
    const groups = buildCadGradingGroupSnapshot(project, surfaceCache, groupCacheOf([result]), firstId);
    const snapshot = { gradingGroups: groups } as unknown as CadWorkspaceSnapshot;
    const { actions, calls } = spyActions();
    const { available, executed } = viaRegistry(key, snapshot, actions);
    expect(available).toBe(true);
    expect(executed).toBe(true);
    expect(calls).toEqual([`${prefix}:${firstId}`]);
    expect(secondId).not.toBe(firstId);
  });

  it('explicit options.groupId overrides the snapshot selection', () => {
    const { project, firstId, secondId, surfaceCache, result } = twoGroupSetup();
    const secondResult = calculateGroup(project, secondId);
    const groups = buildCadGradingGroupSnapshot(
      project, surfaceCache, groupCacheOf([result, secondResult]), firstId,
    );
    const snapshot = { gradingGroups: groups } as unknown as CadWorkspaceSnapshot;
    const { actions, calls } = spyActions();
    expect(executeGradingGroupShellCommand('GRADINGGROUPCALC', actions, snapshot, { groupId: secondId })).toBe(true);
    expect(calls).toEqual([`calc:${secondId}`]);
  });

  it('invalid explicit id fails closed even with a valid selection (no silent retarget)', () => {
    const { project, firstId, surfaceCache, result } = twoGroupSetup();
    const groups = buildCadGradingGroupSnapshot(project, surfaceCache, groupCacheOf([result]), firstId);
    const snapshot = { gradingGroups: groups } as unknown as CadWorkspaceSnapshot;
    const { actions, calls } = spyActions();
    expect(executeGradingGroupShellCommand('GRADINGGROUPCALC', actions, snapshot, { groupId: 'nope' })).toBe(false);
    expect(executeGradingGroupShellCommand('GRADINGGROUPEXTRACTDAYLIGHT', actions, snapshot, { groupId: 'nope' })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('snapshot-less explicit dispatch is preserved for direct callers; missing action fails', () => {
    const { actions, calls } = spyActions();
    expect(executeGradingGroupShellCommand('GRADINGGROUPCALC', actions, null, { groupId: 'g1' })).toBe(true);
    expect(executeGradingGroupShellCommand('GRADINGGROUPEXTRACTDAYLIGHT', actions, null, { groupId: 'g1' })).toBe(true);
    expect(executeGradingGroupShellCommand('GRADINGGROUPBAKE', actions, null, { groupId: 'g1' })).toBe(true);
    expect(calls).toEqual(['calc:g1', 'extract:g1', 'bake:g1']);
    const noCalc = { requestGroupGradingCalculate: undefined, extractGroupDaylight: undefined, bakeGroupSurface: undefined } as unknown as CadShellActions;
    expect(executeGradingGroupShellCommand('GRADINGGROUPCALC', noCalc, null, { groupId: 'g1' })).toBe(false);
    expect(gradingGroupShellAvailable('GRADINGGROUPCALC', noCalc, null)).toBe(false);
  });
});

describe('status gate matrix (availability == execution)', () => {
  const matrix: Array<{
    name: string;
    status: string;
    setup: () => { snapshot: CadWorkspaceSnapshot; groupId: string };
    calc: boolean;
    expo: boolean;
  }> = [
    {
      name: 'UNBUILT', status: 'UNBUILT', calc: true, expo: false,
      setup: () => {
        const { project, flId, targetId } = baseProject();
        const withGroup = addGroup(project, flId, targetId, 'Pad');
        return { snapshot: snapOf(withGroup, withGroup.gradingGroups![0]!.id), groupId: withGroup.gradingGroups![0]!.id };
      },
    },
    {
      name: 'BUILDING', status: 'BUILDING', calc: false, expo: false,
      setup: () => {
        const { project, flId, targetId } = baseProject();
        const withGroup = addGroup(project, flId, targetId, 'Pad');
        return { snapshot: snapOf(withGroup, withGroup.gradingGroups![0]!.id, { building: true }), groupId: withGroup.gradingGroups![0]!.id };
      },
    },
    {
      name: 'CURRENT', status: 'CURRENT', calc: true, expo: true,
      setup: () => {
        const { project, flId, targetId } = baseProject();
        const withGroup = addGroup(project, flId, targetId, 'Pad');
        const groupId = withGroup.gradingGroups![0]!.id;
        const result = calculateGroup(withGroup, groupId);
        return { snapshot: snapOf(withGroup, groupId, { results: [result] }), groupId };
      },
    },
    {
      name: 'NEEDS_RECALC stale', status: 'NEEDS_RECALC', calc: true, expo: false,
      setup: () => {
        const { project, flId, targetId } = baseProject();
        const withGroup = addGroup(project, flId, targetId, 'Pad');
        const groupId = withGroup.gradingGroups![0]!.id;
        const stale = { ...calculateGroup(withGroup, groupId), revision: 'ggrev1:stale' };
        return { snapshot: snapOf(withGroup, groupId, { results: [stale] }), groupId };
      },
    },
    {
      name: 'FAILED', status: 'FAILED', calc: true, expo: false,
      setup: () => {
        const { project, flId, targetId } = baseProject();
        const withGroup = addGroup(project, flId, targetId, 'Pad');
        return { snapshot: snapOf(withGroup, withGroup.gradingGroups![0]!.id, { diagnostics: true }), groupId: withGroup.gradingGroups![0]!.id };
      },
    },
    {
      name: 'BROKEN_REFERENCE', status: 'BROKEN_REFERENCE', calc: false, expo: false,
      setup: () => {
        const { project, flId, targetId } = baseProject();
        const withGroup = addGroup(project, flId, targetId, 'Pad');
        const broken: CadProject = { ...withGroup, entities: [] };
        return { snapshot: snapOf(broken, withGroup.gradingGroups![0]!.id), groupId: withGroup.gradingGroups![0]!.id };
      },
    },
    {
      name: 'SOURCE_NOT_CURRENT', status: '', calc: false, expo: false,
      setup: () => {
        const { project, flId, targetId } = baseProject();
        const withGroup = addGroup(project, flId, targetId, 'Pad');
        const groupId = withGroup.gradingGroups![0]!.id;
        const stale = { ...calculateGroup(withGroup, groupId), revision: 'ggrev1:stale' };
        return {
          snapshot: snapOf(withGroup, groupId, { results: [stale], surfaceCache: emptySurfaceCache() }),
          groupId,
        };
      },
    },
  ];

  it.each(matrix.map((entry) => [entry.name, entry] as const))('%s gates CALC=%s Extract/Bake=%s', (_name, entry) => {
    const { snapshot, groupId } = entry.setup();
    if (entry.status.length > 0) expect(snapshot.gradingGroups!.groups[0]!.status).toBe(entry.status);
    const row = snapshot.gradingGroups!.groups[0]!;
    expect(row.calculable).toBe(entry.calc);
    expect(row.exportable).toBe(entry.expo);
    const { actions, calls } = spyActions();
    const calc = viaRegistry('GRADINGGROUPCALC', snapshot, actions);
    const extract = viaRegistry('GRADINGGROUPEXTRACTDAYLIGHT', snapshot, actions);
    const bake = viaRegistry('GRADINGGROUPBAKE', snapshot, actions);
    expect(calc.available).toBe(entry.calc);
    expect(calc.executed).toBe(entry.calc);
    expect(extract.available).toBe(entry.expo);
    expect(extract.executed).toBe(entry.expo);
    expect(bake.available).toBe(entry.expo);
    expect(bake.executed).toBe(entry.expo);
    expect(calls.filter((call) => call === `calc:${groupId}`).length).toBe(entry.calc ? 1 : 0);
    expect(calls.filter((call) => call === `extract:${groupId}`).length).toBe(entry.expo ? 1 : 0);
    expect(calls.filter((call) => call === `bake:${groupId}`).length).toBe(entry.expo ? 1 : 0);
  });
});

describe('Create / Manager / Inquiry / Criteria targeting', () => {
  it('no-args GRADEGROUP opens the manager create workflow (exactly one creation UI)', () => {
    const { project, flId, targetId } = baseProject();
    const withGroup = addGroup(project, flId, targetId, 'Pad');
    const snapshot = snapOf(withGroup, withGroup.gradingGroups![0]!.id);
    const { actions, opened } = spyActions();
    const { available, executed } = viaRegistry('GRADEGROUP', snapshot, actions);
    expect(available).toBe(true);
    expect(executed).toBe(true);
    expect(opened).toEqual([{ id: undefined, tab: undefined }]);
  });

  it('GRADEGROUP with create args runs exactly one GROUP_CREATE; without opener or runner it fails', () => {
    const { project, flId, targetId } = baseProject();
    const withGroup = addGroup(project, flId, targetId, 'Pad');
    const snapshot = snapOf(withGroup, withGroup.gradingGroups![0]!.id);
    const entity = withGroup.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
    const [a, b] = entity.vertices.map((v) => v.id);
    const create = {
      sourceFeatureLineId: flId,
      sourceCourses: [{ vertexAId: a!, vertexBId: b! }],
      targetSurfaceId: targetId,
      side: 'right' as const,
      criterion: { kind: 'fixed' as const, gradeRatio: -0.5 },
      maxSearchDistance: 50,
      curveChordTolerance: 0.05,
    };
    const { actions, calls } = spyActions();
    expect(executeGradingGroupShellCommand('GRADEGROUP', actions, snapshot, { create })).toBe(true);
    expect(calls).toEqual(['run:GROUP_CREATE']);
    const openerOnly = { openGradingGroupManager: () => undefined } as unknown as CadShellActions;
    expect(executeGradingGroupShellCommand('GRADEGROUP', openerOnly, snapshot, { create })).toBe(false);
    const bare = {} as unknown as CadShellActions;
    expect(executeGradingGroupShellCommand('GRADEGROUP', bare, snapshot)).toBe(false);
    expect(gradingGroupShellAvailable('GRADEGROUP', bare, snapshot)).toBe(false);
  });

  it('Manager opens with the selected id; snapshot-less opens generally', () => {
    const { project, firstId, surfaceCache, result } = twoGroupSetup();
    const groups = buildCadGradingGroupSnapshot(project, surfaceCache, groupCacheOf([result]), firstId);
    const snapshot = { gradingGroups: groups } as unknown as CadWorkspaceSnapshot;
    const { actions, opened } = spyActions();
    const routed = viaRegistry('GRADINGGROUP', snapshot, actions);
    expect(routed.available).toBe(true);
    expect(routed.executed).toBe(true);
    expect(opened).toEqual([{ id: firstId, tab: undefined }]);
    const general = spyActions();
    expect(executeGradingGroupShellCommand('GRADINGGROUP', general.actions, null)).toBe(true);
    expect(general.opened).toEqual([{ id: undefined, tab: undefined }]);
  });

  it('Inquiry / Criteria target the resolved group; fail closed without selection', () => {
    const { project, firstId, surfaceCache, result } = twoGroupSetup();
    const groups = buildCadGradingGroupSnapshot(project, surfaceCache, groupCacheOf([result]), firstId);
    const snapshot = { gradingGroups: groups } as unknown as CadWorkspaceSnapshot;
    const { actions, opened } = spyActions();
    expect(viaRegistry('GRADINGGROUPINQUIRY', snapshot, actions)).toEqual({ available: true, executed: true });
    expect(viaRegistry('GRADINGGROUPCRITERIA', snapshot, actions)).toEqual({ available: true, executed: true });
    expect(opened).toEqual([
      { id: firstId, tab: 'inquiry' },
      { id: firstId, tab: 'criteria' },
    ]);
    const empty = snapOf(project, null);
    const closed = spyActions();
    expect(viaRegistry('GRADINGGROUPINQUIRY', empty, closed.actions)).toEqual({ available: false, executed: false });
    expect(viaRegistry('GRADINGGROUPCRITERIA', empty, closed.actions)).toEqual({ available: false, executed: false });
    expect(closed.opened).toHaveLength(0);
    // Snapshot-less explicit id still opens (manager validates the id).
    expect(executeGradingGroupShellCommand('GRADINGGROUPINQUIRY', closed.actions, null, { groupId: 'g' })).toBe(true);
    expect(closed.opened).toEqual([{ id: 'g', tab: 'inquiry' }]);
  });
});

describe('standalone grading contract preserved', () => {
  it('GRADINGCALC stays available by row presence (no selection gate introduced)', () => {
    const snapshot = {
      grading: { gradings: [{ id: 'g', status: 'CURRENT' }], selectedGradingId: null },
    } as unknown as CadWorkspaceSnapshot;
    const actions = {
      runGradingCommand: () => true,
      requestGradingCalculate: () => 'ok',
      openGradingManager: () => undefined,
    } as unknown as CadShellActions;
    expect(isShellCommandAvailable(defFor('GRADINGCALC'), snapshot, actions)).toBe(true);
    // Group CALC with the same shape (rows, no selection) stays closed.
    const { project, flId, targetId } = baseProject();
    const withGroup = addGroup(project, flId, targetId, 'Pad');
    const groupSnap = snapOf(withGroup, null);
    const groupActions = spyActions();
    expect(viaRegistry('GRADINGGROUPCALC', groupSnap, groupActions.actions)).toEqual({
      available: false,
      executed: false,
    });
  });
});
