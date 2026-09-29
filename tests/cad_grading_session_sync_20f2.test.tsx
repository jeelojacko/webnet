/** @vitest-environment jsdom */
/**
 * Phase 20F.2 §20-21 — composer session sync, locked-family invariant,
 * cross-row edit clobber, and Cut/Fill prompt defaults.
 *
 * Pins: the per-course composer refreshes on group default/family changes
 * (new group, undo/redo, family switch) but preserves active typing across
 * override-only edits; the shared criterion fields force a locked composer
 * to its family so a foreign draft can never be displayed or emitted; the
 * managers remount per selected row so an open editor can never apply one
 * row's draft to another; and the Cut prompt carries an `nH:1V` default.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGrading, GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import {
  createGroupDefinition,
  setCourseCriteriaOverrides,
} from '../src/engine/cad/grading/gradingGroupAuthoring';
import { CadGradingCriterionFields } from '../src/cad-app/shell/CadGradingCriterionFields';
import { CadGradingGroupCriteriaPanel } from '../src/cad-app/shell/CadGradingGroupCriteriaPanel';
import { CadGradingManager } from '../src/cad-app/shell/CadGradingManager';
import { CadGradingGroupManager } from '../src/cad-app/shell/CadGradingGroupManager';
import {
  defaultGradingCriterionDraft,
  type GradingCriterionDraft,
} from '../src/cad-app/shell/cadGradingCriterionInput';
import { executeGradingShellCommand } from '../src/cad-app/shell/cadGradingShell';
import type { CadGradingShellCommand } from '../src/cad-app/shell/cadGradingShell';
import type { CadGradingGroupShellCommand } from '../src/cad-app/shell/cadGradingGroupShell';
import { buildCadGradingSnapshot } from '../src/cad-app/shell/cadGradingSnapshot';
import { buildCadGradingGroupSnapshot } from '../src/cad-app/shell/cadGradingGroupSnapshot';
import { buildCadFeatureLineSnapshot } from '../src/cad-app/shell/cadFeatureLineSnapshot';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const ridgeLine = (): CadFeatureLineEntity => ({
  id: 'fl-1',
  type: 'feature-line',
  layerId: 'feature-lines',
  visible: true,
  locked: false,
  name: 'Ridge',
  vertices: [
    { id: 'vA', x: 0, y: 5, z: 0 },
    { id: 'vB', x: 10, y: 5, z: 0 },
  ],
  closed: false,
});

const groupLine = (): CadFeatureLineEntity => ({
  id: 'fl-g',
  type: 'feature-line',
  layerId: 'feature-lines',
  visible: true,
  locked: false,
  name: 'Group Ridge',
  vertices: [
    { id: 'gv1', x: 0, y: 0, z: 0 },
    { id: 'gv2', x: 10, y: 0, z: 0 },
    { id: 'gv3', x: 20, y: 0, z: 0 },
  ],
  closed: false,
});

const cadSurface = (id: string, name: string): CadSurface => ({
  id,
  name,
  definition: { pointSource: { kind: 'points', pointEntityIds: [] } },
  cachedRevision: null,
});

const baseProject = (entities: CadProject['entities']): CadProject => ({
  version: 2,
  id: 'grading-sync-20f2',
  name: 'grading-sync-20f2',
  metadata: {
    source: 'parsed-input',
    runMode: 'unknown',
    units: 'm',
    stationCount: 0,
    observationCount: 0,
    adjustedStationCount: 0,
  },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities,
  cogoComputations: [],
  bounds: null,
});

const SURFACES = [{ id: 'srf-a', name: 'EG', status: 'CURRENT' as const }];

const surfaceSnapshot = (): CadWorkspaceSnapshot['surface'] =>
  ({ surfaces: SURFACES } as unknown as CadWorkspaceSnapshot['surface']);

const GROUP_COURSES = [
  { vertexAId: 'gv1', vertexBId: 'gv2' },
  { vertexAId: 'gv2', vertexBId: 'gv3' },
];

const group = (
  id: string,
  criterion: GradingCriterion,
  targetSurfaceId?: string,
): CadGradingGroup => {
  const created = createGroupDefinition({
    id,
    name: id,
    sourceFeatureLineId: 'fl-g',
    sourceCourses: GROUP_COURSES,
    ...(targetSurfaceId !== undefined ? { targetSurfaceId } : {}),
    side: 'right',
    criterion,
    maxSearchDistance: 20,
    curveChordTolerance: 0.1,
    cornerMode: 'miter',
  });
  if (!created.ok) throw new Error(created.error);
  return created.value;
};

const withOverride = (
  current: CadGradingGroup,
  courseIndex: number,
  criterion: GradingCriterion,
): CadGradingGroup => {
  const applied = setCourseCriteriaOverrides(current, [GROUP_COURSES[courseIndex]!], criterion);
  if (!applied.ok) throw new Error(applied.error);
  return applied.value;
};

const grading = (id: string, criterion: GradingCriterion): CadGrading => ({
  id,
  name: id,
  sourceFeatureLineId: 'fl-1',
  sourceCourse: { vertexAId: 'vA', vertexBId: 'vB' },
  targetSurfaceId: 'srf-a',
  side: 'right',
  criterion,
  maxSearchDistance: 20,
  curveChordTolerance: 0.1,
});

// ---------------------------------------------------------------------------
// harness
// ---------------------------------------------------------------------------

const activeRoots: Array<{ root: Root; host: HTMLDivElement }> = [];
afterEach(() => {
  for (const entry of activeRoots.splice(0)) {
    act(() => entry.root.unmount());
    entry.host.remove();
  }
});

const createHost = (): { host: HTMLDivElement; root: Root } => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  activeRoots.push({ root, host });
  return { host, root };
};

const mountNode = (node: ReactNode): { host: HTMLDivElement; root: Root } => {
  const { host, root } = createHost();
  act(() => root.render(node));
  return { host, root };
};

const panelFor = (groupValue: CadGradingGroup): ReactNode => (
  <CadGradingGroupCriteriaPanel group={groupValue} run={() => true} onNotice={() => {}} />
);

const setInput = (el: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const setSelect = (el: HTMLSelectElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const clickIn = (root: Element, selector: string): void => {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  act(() => el.click());
};

const inputIn = (root: Element, selector: string): HTMLInputElement => {
  const el = root.querySelector<HTMLInputElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
};

const queryIn = <T extends Element>(root: Element, selector: string): T => {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
};

// ---------------------------------------------------------------------------
// composer session sync (panel)
// ---------------------------------------------------------------------------

describe('Phase 20F.2 composer session sync', () => {
  it('resets the composer when another group is selected', () => {
    const a = group('gg-a', { kind: 'distance', gradeRatio: -0.02, distance: 20 });
    const b = group('gg-b', { kind: 'distance', gradeRatio: -0.05, distance: 40 });
    const { host, root } = mountNode(panelFor(a));
    setInput(inputIn(host, '[aria-label="Grade magnitude"]'), '7');
    expect(inputIn(host, '[aria-label="Target distance"]').value).toBe('20');
    act(() => root.render(panelFor(b)));
    expect(inputIn(host, '[aria-label="Target distance"]').value).toBe('40');
    expect(inputIn(host, '[aria-label="Grade magnitude"]').value).not.toBe('7');
  });

  it('refreshes on a same-group default change (undo/redo)', () => {
    const before = group('gg-u', { kind: 'distance', gradeRatio: -0.02, distance: 20 });
    const after = group('gg-u', { kind: 'distance', gradeRatio: -0.02, distance: 40 });
    const { host, root } = mountNode(panelFor(before));
    setInput(inputIn(host, '[aria-label="Grade magnitude"]'), '7');
    act(() => root.render(panelFor(after)));
    expect(inputIn(host, '[aria-label="Target distance"]').value).toBe('40');
    expect(inputIn(host, '[aria-label="Grade magnitude"]').value).toBe('2');
  });

  it('refreshes on a family switch', () => {
    const surface = group('gg-f', { kind: 'fixed', gradeRatio: -0.02 }, 'srf-a');
    const analytic = group('gg-f', { kind: 'distance', gradeRatio: -0.02, distance: 20 });
    const { host, root } = mountNode(panelFor(surface));
    expect(host.querySelector('[aria-label="Criterion kind"]')).not.toBeNull();
    act(() => root.render(panelFor(analytic)));
    expect(host.querySelector('[aria-label="Target distance"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Criterion kind"]')).toBeNull();
  });

  it('preserves active typing across an override-only edit', () => {
    const base = group('gg-o', { kind: 'distance', gradeRatio: -0.02, distance: 20 });
    const overridden = withOverride(base, 1, { kind: 'distance', gradeRatio: -0.02, distance: 25 });
    const { host, root } = mountNode(panelFor(base));
    setInput(inputIn(host, '[aria-label="Grade magnitude"]'), '7');
    act(() => root.render(panelFor(overridden)));
    expect(inputIn(host, '[aria-label="Grade magnitude"]').value).toBe('7');
    expect(inputIn(host, '[aria-label="Target distance"]').value).toBe('20');
  });
});

// ---------------------------------------------------------------------------
// locked-family invariant (shared fields)
// ---------------------------------------------------------------------------

describe('Phase 20F.2 locked-family invariant', () => {
  it('shows Surface fields for a foreign draft and emits the locked method', () => {
    const emitted: GradingCriterionDraft[] = [];
    const { host } = mountNode(
      <CadGradingCriterionFields
        draft={defaultGradingCriterionDraft('distance')}
        onChange={(next) => emitted.push(next)}
        lengthUnit="m"
        methods={['surface']}
      />,
    );
    expect(host.textContent).toContain('Surface (locked to group family)');
    expect(host.querySelector('[aria-label="Criterion kind"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Target distance"]')).toBeNull();
    expect(queryIn(host, '[data-cad-grading-criterion-summary]').textContent).not.toContain('Distance');
    setSelect(queryIn(host, '[aria-label="Criterion kind"]'), 'cut-fill');
    expect(emitted[emitted.length - 1]?.method).toBe('surface');
  });
});

// ---------------------------------------------------------------------------
// cross-row edit clobber (managers)
// ---------------------------------------------------------------------------

const mountGradingManager = (
  rows: CadGrading[],
  selectedId: string,
): { host: HTMLDivElement; commands: CadGradingShellCommand[]; rerender: (_id: string) => void } => {
  const project = baseProject([ridgeLine()]);
  project.surfaces = [cadSurface('srf-a', 'EG')];
  project.gradings = rows;
  const commands: CadGradingShellCommand[] = [];
  const { host, root } = createHost();
  const actions = {
    runGradingCommand: (command: CadGradingShellCommand): boolean => {
      commands.push(command);
      return true;
    },
  } as unknown as CadShellActions;
  const rerender = (id: string): void => {
    const snapshot = {
      units: 'm',
      grading: buildCadGradingSnapshot(project, null, null, id),
      surface: surfaceSnapshot(),
      featureLine: buildCadFeatureLineSnapshot(project, []),
    } as unknown as CadWorkspaceSnapshot;
    act(() => root.render(<CadGradingManager snapshot={snapshot} actions={actions} onClose={() => {}} />));
  };
  rerender(selectedId);
  return { host, commands, rerender };
};

const mountGroupManager = (
  rows: CadGradingGroup[],
  selectedId: string,
): { host: HTMLDivElement; commands: CadGradingGroupShellCommand[]; rerender: (_id: string) => void } => {
  const project = baseProject([groupLine()]);
  project.surfaces = [cadSurface('srf-a', 'EG')];
  project.gradingGroups = rows;
  const commands: CadGradingGroupShellCommand[] = [];
  const { host, root } = createHost();
  const actions = {
    runGradingGroupCommand: (command: CadGradingGroupShellCommand): boolean => {
      commands.push(command);
      return true;
    },
  } as unknown as CadShellActions;
  const rerender = (id: string): void => {
    const snapshot = {
      units: 'm',
      gradingGroups: buildCadGradingGroupSnapshot(project, null, null, id),
      surface: surfaceSnapshot(),
      featureLine: buildCadFeatureLineSnapshot(project, []),
    } as unknown as CadWorkspaceSnapshot;
    act(() => root.render(<CadGradingGroupManager snapshot={snapshot} actions={actions} onClose={() => {}} />));
  };
  rerender(selectedId);
  return { host, commands, rerender };
};

describe('Phase 20F.2 cross-row edit clobber', () => {
  it('grading manager closes the open editor on row switch', () => {
    const a = grading('g-a', { kind: 'fixed', gradeRatio: -0.02 });
    const b = grading('g-b', { kind: 'fixed', gradeRatio: -0.05 });
    const harness = mountGradingManager([a, b], 'g-a');
    clickIn(harness.host, '[data-cad-grading-edit-criteria]');
    expect(harness.host.querySelector('[data-cad-grading-edit-panel]')).not.toBeNull();

    harness.rerender('g-b');
    expect(harness.host.querySelector('[data-cad-grading-edit-panel]')).toBeNull();

    clickIn(harness.host, '[data-cad-grading-edit-criteria]');
    const panel = queryIn<HTMLElement>(harness.host, '[data-cad-grading-edit-panel]');
    setInput(inputIn(panel, '[aria-label="Grade magnitude"]'), '7');
    clickIn(panel, '[data-cad-grading-edit-apply]');

    expect(harness.commands).toHaveLength(1);
    const command = harness.commands[0]!;
    expect(command.key).toBe('GRADING_EDIT_CRITERIA');
    if (command.key === 'GRADING_EDIT_CRITERIA') {
      expect(command.gradingId).toBe('g-b');
      expect(command.criterion).toEqual({ kind: 'fixed', gradeRatio: -0.07 });
    }
  });

  it('grading-group manager closes the open editor on row switch', () => {
    const a = group('gg-a', { kind: 'fixed', gradeRatio: -0.02 }, 'srf-a');
    const b = group('gg-b', { kind: 'fixed', gradeRatio: -0.05 }, 'srf-a');
    const harness = mountGroupManager([a, b], 'gg-a');
    clickIn(harness.host, '[data-cad-grading-group-edit-criteria]');
    expect(harness.host.querySelector('[data-cad-grading-group-edit-panel]')).not.toBeNull();

    harness.rerender('gg-b');
    expect(harness.host.querySelector('[data-cad-grading-group-edit-panel]')).toBeNull();

    clickIn(harness.host, '[data-cad-grading-group-edit-criteria]');
    const panel = queryIn<HTMLElement>(harness.host, '[data-cad-grading-group-edit-panel]');
    setInput(inputIn(panel, '[aria-label="Grade magnitude"]'), '7');
    clickIn(panel, '[data-cad-grading-group-edit-apply]');

    expect(harness.commands).toHaveLength(1);
    const command = harness.commands[0]!;
    expect(command.key).toBe('GROUP_EDIT_CRITERIA');
    if (command.key === 'GROUP_EDIT_CRITERIA') {
      expect(command.groupId).toBe('gg-b');
      expect(command.criterion).toEqual({ kind: 'fixed', gradeRatio: -0.07 });
    }
  });
});

// ---------------------------------------------------------------------------
// Cut prompt default
// ---------------------------------------------------------------------------

describe('Phase 20F.2 grading prompt defaults', () => {
  it('offers the explicit 2:1 Cut default and builds 2H:1V / 3H:1V', () => {
    const project = baseProject([ridgeLine()]);
    project.surfaces = [cadSurface('srf-a', 'EG')];
    const snapshot = {
      units: 'm',
      grading: buildCadGradingSnapshot(project, null, null, null),
      surface: surfaceSnapshot(),
      featureLine: buildCadFeatureLineSnapshot(project, []),
      selectionPreview: [{ type: 'feature-line', id: 'fl-1' }],
    } as unknown as CadWorkspaceSnapshot;

    const prompts: Array<{ message: string; defaultValue: string | undefined }> = [];
    const answers: Record<string, string> = {
      'Grading side': 'right',
      'Criterion': 'cutfill',
      'Grading name': 'G',
      'Max search distance': '20',
      'Curve chord tolerance': '0.1',
      'Cut run': '2:1',
      'Cut direction': 'up',
      'Fill run': '3:1',
      'Fill direction': 'down',
    };
    const original = window.prompt;
    window.prompt = ((message: string, defaultValue?: string) => {
      prompts.push({ message, defaultValue });
      const key = Object.keys(answers).find((candidate) => message.includes(candidate));
      return key ? answers[key]! : null;
    }) as typeof window.prompt;
    const commands: CadGradingShellCommand[] = [];
    const actions = {
      runGradingCommand: (command: CadGradingShellCommand): boolean => {
        commands.push(command);
        return true;
      },
    } as unknown as CadShellActions;
    try {
      expect(executeGradingShellCommand('GRADETOSURFACE', actions, snapshot)).toBe(true);
    } finally {
      window.prompt = original;
    }

    const cut = prompts.find((entry) => entry.message.startsWith('Cut'));
    const fill = prompts.find((entry) => entry.message.startsWith('Fill'));
    expect(cut?.defaultValue).toBe('2:1');
    expect(fill?.defaultValue).toBe('3:1');
    expect(cut?.message).toContain('2:1 for 2H:1V');
    expect(commands).toHaveLength(1);
    const command = commands[0]!;
    expect(command.key).toBe('GRADING_CREATE');
    if (command.key === 'GRADING_CREATE') {
      expect(command.criterion).toEqual({ kind: 'cut-fill', cutGradeRatio: 0.5, fillGradeRatio: -1 / 3 });
    }
  });
});
