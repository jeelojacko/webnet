/** @vitest-environment jsdom */
/**
 * Phase 20C Wave-4A UI slice — group snapshot/manager/display/report pins.
 *
 * Mirrors the 20B UI suite scope: registry rows, ribbon entries, Toolspace
 * node, manager actions routing, Properties content, inquiry report content,
 * display pass states (current/stale/failed/curve), ghost side preview, and
 * extract/bake snapshot semantics (one history entry each, snapshot restore
 * on redo, no recompute).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
} from '../src/cad-app/shell/cadCommandRegistry';
import {
  GRADINGGROUP_SHELL_KEYS,
  executeGradingGroupShellCommand,
} from '../src/cad-app/shell/cadGradingGroupShell';
import { buildCadGradingGroupSnapshot } from '../src/cad-app/shell/cadGradingGroupSnapshot';
import {
  buildGroupGradingDisplayPass,
  buildGroupGradingSceneLayers,
  groupGhostArrows,
  miterSeamGhosts,
} from '../src/cad-app/shell/cadGradingGroupDisplay';
import { buildGradingGroupDisplayLayers } from '../src/engine/cad/cadGradingGroupView';
import { buildGroupInquiryReport } from '../src/cad-app/shell/cadGradingGroupReport';
import { CadGradingGroupRibbonGroup } from '../src/cad-app/shell/CadGradingGroupRibbonGroup';
import { GradingGroupsNode } from '../src/cad-app/shell/CadGradingGroupToolspace';
import { GradingGroupPropertiesBlock } from '../src/cad-app/shell/CadGradingGroupProperties';
import { CadGradingGroupManager } from '../src/cad-app/shell/CadGradingGroupManager';
import { proposeGroupSpan } from '../src/cad-app/shell/cadGradingGroupSpan';
import { buildCadFeatureLineSnapshot } from '../src/cad-app/shell/cadFeatureLineSnapshot';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  createCadHistoryState,
  redoCadHistory,
  runCadCommand,
  undoCadHistory,
} from '../src/engine/cad/cadUndoRedo';
import { resolveGroupInputs } from '../src/engine/cad/grading/gradingGroupResolve';
import { computeGradingGroupFromSnapshots } from '../src/engine/cad/grading/gradingGroupCompute';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import type {
  CadFeatureLineEntity,
  CadProject,
  CadSurface,
} from '../src/engine/cad/cadTypes';
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

const fixture = (): { project: CadProject; flId: string; targetId: string } => {
  const drawing = createBlankCadDrawingDocument({ name: 'Group UI', units: 'm' });
  const flId = 'fl-ui-20c';
  const targetId = 'tgt-ui-20c';
  const project: CadProject = {
    ...drawing.project,
    entities: [makeChain(flId)],
    surfaces: [makeFlatTarget(targetId)],
  };
  return { project, flId, targetId };
};

const createGroup = (project: CadProject, flId: string, targetId: string): CadProject => {
  const entity = project.entities.find((entry) => entry.id === flId) as CadFeatureLineEntity;
  const [a, b, c] = entity.vertices.map((v) => v.id);
  const state = runCadCommand(createCadHistoryState(project), {
    key: 'GROUP_CREATE',
    name: 'Pad Group',
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
  expect(state.undoStack).toHaveLength(1);
  return state.present.project;
};

const surfaceCacheOf = (project: CadProject) => {
  const cache = createCadSurfaceCache('group-ui-20c');
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

const cacheOf = (results: readonly CadGradingGroupResult[]) => ({
  get: (id: string, revision: string) => results.find((r) => r.groupId === id && r.revision === revision),
  retained: (id: string) => results.filter((r) => r.groupId === id),
});

const currentSetup = () => {
  const { project, flId, targetId } = fixture();
  const withGroup = createGroup(project, flId, targetId);
  const groupId = withGroup.gradingGroups![0]!.id;
  const cache = surfaceCacheOf(withGroup);
  const empty = buildCadGradingGroupSnapshot(withGroup, cache, cacheOf([]), groupId);
  expect(empty.groups[0]?.status).toBe('UNBUILT');
  const result = calculateGroup(withGroup, groupId);
  expect(result.revision).toBe(empty.groups[0]!.revision);
  return { project: withGroup, groupId, cache, result };
};

describe('group registry rows', () => {
  it('derives UNBUILT then CURRENT rows with name/courses/side/target/status + CURRENT metrics', () => {
    const { project, groupId, cache, result } = currentSetup();
    const snap = buildCadGradingGroupSnapshot(project, cache, cacheOf([result]), groupId);
    const row = snap.groups[0]!;
    expect(row.name).toBe('Pad Group');
    expect(row.courseCount).toBe(2);
    expect(row.side).toBe('Right');
    expect(row.targetName).toBe('Target');
    expect(row.status).toBe('CURRENT');
    expect(row.metrics?.memberCount).toBe(2);
    expect(row.metrics?.cornerCount).toBe(1);
    expect(row.calculable).toBe(true);
    expect(row.exportable).toBe(true);
    expect(row.cornerSummary.length).toBeGreaterThan(0);
    expect(row.cornerSummary[0]).toContain('2 members');
  });

  it('marks a retained result at an old revision NEEDS_RECALC and stale (never current)', () => {
    const { project, groupId, cache, result } = currentSetup();
    const stale = { ...result, revision: 'ggrev1:stale' };
    const snap = buildCadGradingGroupSnapshot(project, cache, cacheOf([stale]), groupId);
    expect(snap.groups[0]?.status).toBe('NEEDS_RECALC');
    expect(snap.groups[0]?.stale).toBe(true);
    expect(snap.groups[0]?.exportable).toBe(false);
    expect(buildGroupGradingSceneLayers(snap)).toHaveLength(0);
  });

  it('derives FAILED only from a session diagnostic (never from status alone)', () => {
    const { project, groupId, cache } = currentSetup();
    const empty = buildCadGradingGroupSnapshot(project, cache, cacheOf([]), groupId);
    expect(empty.groups[0]?.status).toBe('UNBUILT');
    const revision = empty.groups[0]!.revision;
    const failed = buildCadGradingGroupSnapshot(project, cache, cacheOf([]), groupId, {
      sessionDiagnostics: new Map([[groupId, { revision, error: 'boom' }]]),
    });
    expect(failed.groups[0]?.status).toBe('FAILED');
  });
});

describe('group span proposals', () => {
  const courses = [
    { fromVertexId: 'a', toVertexId: 'b' },
    { fromVertexId: 'b', toVertexId: 'c' },
    { fromVertexId: 'c', toVertexId: 'd' },
    { fromVertexId: 'd', toVertexId: 'a' },
  ];

  it('takes contiguous open spans and persists ordered A/B pairs (never indices)', () => {
    const span = proposeGroupSpan(courses.slice(0, 3), 0, 1, false);
    expect(span).toEqual([
      { vertexAId: 'a', vertexBId: 'b' },
      { vertexAId: 'b', vertexBId: 'c' },
    ]);
    expect(proposeGroupSpan(courses.slice(0, 3), 1, 0, false)).toBeNull();
  });

  it('offers Shortest / Long / All around closed rings', () => {
    expect(proposeGroupSpan(courses, 0, 1, true, 'shortest')).toHaveLength(2);
    expect(proposeGroupSpan(courses, 0, 1, true, 'long')).toHaveLength(4);
    expect(proposeGroupSpan(courses, 0, 1, true, 'all')).toHaveLength(4);
    const shortest = proposeGroupSpan(courses, 3, 1, true, 'shortest')!;
    expect(shortest.map((c) => c.vertexAId)).toEqual(['d', 'a', 'b']);
  });
});

describe('group ribbon + toolspace + properties', () => {
  const snapshotOf = (): CadWorkspaceSnapshot => {
    const { project, groupId, cache, result } = currentSetup();
    const snap = buildCadGradingGroupSnapshot(project, cache, cacheOf([result]), groupId);
    return {
      gradingGroups: snap,
    } as unknown as CadWorkspaceSnapshot;
  };

  it('registers the six group keys and routes them through the group seam', () => {
    for (const key of GRADINGGROUP_SHELL_KEYS) {
      expect(CAD_SHELL_COMMANDS.some((entry) => entry.key === key)).toBe(true);
    }
    const opened: Array<string | undefined> = [];
    const actions = {
      openGradingGroupManager: (id?: string) => { opened.push(id); },
      runGradingGroupCommand: () => true,
      requestGroupGradingCalculate: () => 'ok',
      extractGroupDaylight: () => 'ok',
      bakeGroupSurface: () => 'ok',
    } as unknown as CadShellActions;
    expect(executeGradingGroupShellCommand('GRADINGGROUP', actions, null)).toBe(true);
    expect(opened).toEqual([undefined]);
    // No-args GRADEGROUP answers false until the UI supplies explicit args.
    expect(executeGradingGroupShellCommand('GRADEGROUP', actions, null)).toBe(false);
    const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === 'GRADINGGROUPCALC')!;
    expect(isShellCommandAvailable(def, null, actions)).toBe(false);
    expect(executeShellCommand(def, actions, snapshotOf())).toBe(false);
  });

  it('renders ribbon entries and the Toolspace node with status text', () => {
    const snapshot = snapshotOf();
    const actions = { runGradingGroupCommand: () => true } as unknown as CadShellActions;
    const ribbonHost = document.createElement('div');
    document.body.appendChild(ribbonHost);
    const ribbonRoot: Root = createRoot(ribbonHost);
    act(() => {
      ribbonRoot.render(<CadGradingGroupRibbonGroup snapshot={snapshot} actions={actions} />);
    });
    try {
      for (const key of ['GRADEGROUP', 'GRADINGGROUPCALC', 'GRADINGGROUPINQUIRY', 'GRADINGGROUPEXTRACTDAYLIGHT', 'GRADINGGROUPBAKE', 'GRADINGGROUP']) {
        expect(ribbonHost.querySelector(`[data-cad-grading-group-command="${key}"]`)).not.toBeNull();
      }
      const treeHost = document.createElement('div');
      document.body.appendChild(treeHost);
      const treeRoot: Root = createRoot(treeHost);
      act(() => {
        treeRoot.render(<GradingGroupsNode snapshot={snapshot} actions={null} />);
      });
      try {
        expect(treeHost.textContent).toContain('Pad Group');
        expect(treeHost.textContent).toContain('Current');
        expect(treeHost.textContent).toContain('2 members');
      } finally {
        act(() => { treeRoot.unmount(); });
        treeHost.remove();
      }
    } finally {
      act(() => { ribbonRoot.unmount(); });
      ribbonHost.remove();
    }
  });

  it('renders Properties definition + status + CURRENT metrics with no arrays', () => {
    const snapshot = snapshotOf();
    const row = snapshot.gradingGroups!.groups[0]!;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => {
      root.render(<GradingGroupPropertiesBlock row={row} />);
    });
    try {
      expect(host.textContent).toContain('Pad Group');
      expect(host.textContent).toContain('Current');
      expect(host.textContent).toContain('Members / Corners');
    } finally {
      act(() => { root.unmount(); });
      host.remove();
    }
  });
});

describe('group manager actions routing', () => {
  const managerSetup = () => {
    const { project, groupId, cache, result } = currentSetup();
    const groups = buildCadGradingGroupSnapshot(project, cache, cacheOf([result]), groupId);
    const snapshot = {
      gradingGroups: groups,
      featureLine: buildCadFeatureLineSnapshot(project, []),
      surface: { surfaces: [{ id: 'tgt-ui-20c', name: 'Target', status: 'CURRENT' }] },
    } as unknown as CadWorkspaceSnapshot;
    return { snapshot, groupId };
  };

  it('routes Calculate / Extract / Delete through the workspace seam', () => {
    const { snapshot, groupId } = managerSetup();
    const seen: string[] = [];
    const commands: string[] = [];
    const actions = {
      runGradingGroupCommand: (command: { key: string }) => { commands.push(command.key); return true; },
      selectGradingGroup: () => {},
      requestGroupGradingCalculate: (id: string) => { seen.push(`calc:${id}`); return 'ok'; },
      extractGroupDaylight: (id: string) => { seen.push(`extract:${id}`); return 'ok'; },
      bakeGroupSurface: (id: string) => { seen.push(`bake:${id}`); return 'ok'; },
    } as unknown as CadShellActions;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    act(() => {
      root.render(<CadGradingGroupManager snapshot={snapshot} actions={actions} onClose={() => {}} />);
    });
    try {
      expect(host.querySelector('[data-cad-grading-group-table]')?.textContent).toContain('Pad Group');
      expect(host.querySelector('[data-cad-grading-group-span-preview]')?.textContent).toContain('Span:');
      (host.querySelector('[data-cad-grading-group-calculate]') as HTMLButtonElement).click();
      (host.querySelector('[data-cad-grading-group-extract]') as HTMLButtonElement).click();
      (host.querySelector('[data-cad-grading-group-delete]') as HTMLButtonElement).click();
      expect(seen).toEqual([`calc:${groupId}`, `extract:${groupId}`]);
      expect(commands).toEqual(['GROUP_DELETE']);
    } finally {
      act(() => { root.unmount(); });
      host.remove();
    }
  });
});

describe('group inquiry report', () => {
  it('builds a CURRENT report with corners and answers honestly when not CURRENT', () => {
    const { project, groupId, cache, result } = currentSetup();
    const snap = buildCadGradingGroupSnapshot(project, cache, cacheOf([result]), groupId);
    const row = snap.groups[0]!;
    const report = buildGroupInquiryReport(
      row.definition, row.sourceName, row.targetName, row.status, row.accuracy, row.currentResult,
    );
    expect(report).toContain('Grading Group Inquiry');
    expect(report).toContain('Members: 2');
    expect(report).toContain('Corners:');
    const empty = buildCadGradingGroupSnapshot(project, cache, cacheOf([]), groupId);
    const stale = buildGroupInquiryReport(
      empty.groups[0]!.definition, 'FL', 'Target', 'UNBUILT', null, null,
    );
    expect(stale).toContain('No CURRENT result');
  });
});

describe('group display pass', () => {
  it('emits fill + daylight + seam for CURRENT and nothing for stale', () => {
    const { project, groupId, cache, result } = currentSetup();
    const snap = buildCadGradingGroupSnapshot(project, cache, cacheOf([result]), groupId);
    const row = snap.groups[0]!;
    const pass = buildGroupGradingDisplayPass(row, row.currentResult);
    expect(pass.current).toBe(true);
    expect(pass.daylight.length).toBeGreaterThan(0);
    expect(pass.triangles.length).toBeGreaterThan(0);
    expect(pass.seam.length).toBeGreaterThan(0);
    const layers = buildGroupGradingSceneLayers(snap);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.kind).toBe('result');
    expect(layers[0]!.daylightD.startsWith('M')).toBe(true);
    expect(layers[0]!.seamD.startsWith('M')).toBe(true);
  });

  it('marks FAILED corners without fill and badges curve-corner approximation', () => {
    const { project, groupId, cache, result } = currentSetup();
    const approx = {
      ...result,
      diagnostics: [...result.diagnostics, { code: 'CURVE_CORNER_APPROXIMATED' as const }],
    };
    const snap = buildCadGradingGroupSnapshot(project, cache, cacheOf([approx]), groupId);
    expect(snap.groups[0]?.curveCornerApproximated).toBe(true);
    const layers = buildGroupGradingSceneLayers(snap);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.curveApproximated).toBe(true);
    expect(layers[0]!.badgeText).toContain('CURVE CORNER APPROXIMATED');
    const failedRow = { ...snap.groups[0]!, status: 'FAILED' as const, currentResult: null };
    const failed = buildGroupGradingDisplayPass(failedRow, null, {
      failedDiagnostics: [{ code: 'CORNER_NO_SOLUTION', cornerIndex: 0 }],
    });
    expect(failed.current).toBe(false);
    expect(failed.triangles).toHaveLength(0);
    expect(failed.failedMarkers).toHaveLength(1);
    expect(failed.failedMarkers[0]!.label).toContain('CORNER_NO_SOLUTION');
    expect(failed.warnings.some((w) => w.includes('FAILED'))).toBe(true);
  });

  it('renders ghost side arrows for the selected uncalculated group', () => {
    const { project, groupId, cache } = currentSetup();
    const snap = buildCadGradingGroupSnapshot(project, cache, cacheOf([]), groupId);
    const row = snap.groups[0]!;
    expect(row.memberSources?.length).toBe(2);
    const arrows = groupGhostArrows(row.memberSources!, 'right', 5);
    expect(arrows).toHaveLength(2);
    // Source runs +X: right side is -Y.
    expect(arrows[0]!.to.y).toBeLessThan(arrows[0]!.from.y);
    const left = groupGhostArrows(row.memberSources!, 'left', 5);
    expect(left[0]!.to.y).toBeGreaterThan(left[0]!.from.y);
    expect(miterSeamGhosts(row.memberSources!).length).toBe(2);
    const layers = buildGroupGradingSceneLayers(snap);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.kind).toBe('ghost');
    expect(layers[0]!.ghostArrows).toHaveLength(2);
    expect(buildGradingGroupDisplayLayers([])).toHaveLength(0);
  });
});

describe('group extract/bake snapshot semantics', () => {
  it('extracts and bakes with one history entry each and snapshot restore on redo', () => {
    const { project, groupId, cache, result } = currentSetup();
    const snap = buildCadGradingGroupSnapshot(project, cache, cacheOf([result]), groupId);
    const row = snap.groups[0]!;
    const history = createCadHistoryState(project);
    const extracted = runCadCommand(history, {
      key: 'GROUPEXTRACTDAYLIGHT',
      groupId,
      result: row.currentResult!,
      expectedRevision: row.revision,
      sessionCurrent: true,
    });
    expect(extracted.undoStack).toHaveLength(1);
    const daylight = extracted.present.project.entities.filter((e) => e.type === 'feature-line');
    expect(daylight).toHaveLength(2);
    const undone = undoCadHistory(extracted);
    expect(undone.present.project.entities.filter((e) => e.type === 'feature-line')).toHaveLength(1);
    const redone = redoCadHistory(undone);
    const restored = redone.present.project.entities.filter((e) => e.type === 'feature-line');
    expect(restored).toHaveLength(2);
    expect(restored[1]!.id).toBe(daylight[1]!.id);
    const baked = runCadCommand(redone, {
      key: 'GROUPBAKE',
      groupId,
      result: row.currentResult!,
      expectedRevision: row.revision,
      sessionCurrent: true,
    });
    const surfaces = baked.present.project.surfaces ?? [];
    expect(surfaces[surfaces.length - 1]!.definition.sourceKind).toBe('explicit-tin');
    const rebaked = undoCadHistory(baked);
    expect((rebaked.present.project.surfaces ?? []).length).toBe(surfaces.length - 1);
    expect(redoCadHistory(rebaked).present.project.surfaces?.length).toBe(surfaces.length);
  });
});
