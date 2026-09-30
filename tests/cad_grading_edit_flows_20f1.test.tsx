/** @vitest-environment jsdom */
/**
 * Phase 20F.1 — analytic <-> Surface edit flows + false-success notices.
 *
 * Pins the inline Edit Criteria editor for BOTH the grading manager and the
 * grading-group manager: a Surface method renders the CURRENT-only target gate
 * (same rule as Create), an analytic method commits a target-free criterion,
 * an analytic -> Surface switch commits criterion + real target in ONE undo
 * entry, a missing eligible surface blocks Apply honestly, a rejected edit
 * keeps the editor open and never claims success, and the group
 * one-family-per-course guard stays engine-authoritative (a rejected
 * Distance-with-overrides -> Surface switch does not silently delete
 * overrides).
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGrading, GradingCriterion } from '../src/engine/cad/grading/gradingTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import { executeCadCommand } from '../src/engine/cad/cadTransactions';
import type { CadWorkspaceSnapshot as EngineSnapshot } from '../src/engine/cad/cadTransactions.types';
import {
  createGroupDefinition,
  setCourseCriteriaOverrides,
} from '../src/engine/cad/grading/gradingGroupAuthoring';
import { buildCadGradingSnapshot } from '../src/cad-app/shell/cadGradingSnapshot';
import { buildCadFeatureLineSnapshot } from '../src/cad-app/shell/cadFeatureLineSnapshot';
import { buildCadGradingGroupSnapshot } from '../src/cad-app/shell/cadGradingGroupSnapshot';
import { CadGradingManager } from '../src/cad-app/shell/CadGradingManager';
import { CadGradingGroupManager } from '../src/cad-app/shell/CadGradingGroupManager';
import type { CadGradingShellCommand } from '../src/cad-app/shell/cadGradingShell';
import type { CadGradingGroupShellCommand } from '../src/cad-app/shell/cadGradingGroupShell';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

type SurfaceSpec = { id: string; name: string; status: string };

const CURRENT_SURFACES: SurfaceSpec[] = [
  { id: 'srf-a', name: 'EG', status: 'CURRENT' },
  { id: 'srf-b', name: 'Design', status: 'CURRENT' },
];
const NO_CURRENT_SURFACES: SurfaceSpec[] = [{ id: 'srf-dirty', name: 'Dirty', status: 'DIRTY' }];

const FIXED: GradingCriterion = { kind: 'fixed', gradeRatio: -0.02 };
const DISTANCE: GradingCriterion = { kind: 'distance', gradeRatio: -0.02, distance: 20 };
const ELEVATION: GradingCriterion = { kind: 'elevation', gradeRatio: -0.02, targetElevation: 98 };

const cadSurface = (id: string, name: string): CadSurface => ({
  id,
  name,
  definition: { pointSource: { kind: 'points', pointEntityIds: [] } },
  cachedRevision: null,
});

const baseProject = (entities: CadProject['entities']): CadProject => ({
  version: 2,
  id: 'grading-edit-20f1',
  name: 'grading-edit-20f1',
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

const grading = (criterion: GradingCriterion, targetSurfaceId?: string): CadGrading => ({
  id: 'g-1',
  name: 'Ridge',
  sourceFeatureLineId: 'fl-1',
  sourceCourse: { vertexAId: 'vA', vertexBId: 'vB' },
  ...(targetSurfaceId !== undefined ? { targetSurfaceId } : {}),
  side: 'right',
  criterion,
  maxSearchDistance: 20,
  curveChordTolerance: 0.1,
});

const GROUP_COURSES = [
  { vertexAId: 'gv1', vertexBId: 'gv2' },
  { vertexAId: 'gv2', vertexBId: 'gv3' },
];

const group = (criterion: GradingCriterion, targetSurfaceId?: string): CadGradingGroup => {
  const created = createGroupDefinition({
    id: 'gg-1',
    name: 'Group',
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

/** Distance default + a Distance override on course 1 (mixed with Surface only). */
const mixedFamilyGroup = (): CadGradingGroup => {
  const applied = setCourseCriteriaOverrides(group(DISTANCE), [GROUP_COURSES[0]!], {
    kind: 'distance',
    gradeRatio: -0.03,
    distance: 15,
  });
  if (!applied.ok) throw new Error(applied.error);
  return applied.value;
};

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

const renderManager = (node: ReactNode): { host: HTMLDivElement; root: Root } => {
  const { host, root } = createHost();
  act(() => root.render(node));
  return { host, root };
};

const surfaceSnapshot = (rows: SurfaceSpec[]): CadWorkspaceSnapshot['surface'] =>
  ({ surfaces: rows } as unknown as CadWorkspaceSnapshot['surface']);

interface GradingHarness {
  host: HTMLDivElement;
  commands: CadGradingShellCommand[];
}

const mountGrading = (
  row: CadGrading,
  surfaces: SurfaceSpec[],
  runResult = true,
): GradingHarness => {
  const project = baseProject([ridgeLine()]);
  project.surfaces = surfaces.map((entry) => cadSurface(entry.id, entry.name));
  project.gradings = [row];
  const snapshot = {
    units: 'm',
    grading: buildCadGradingSnapshot(project, null, null, row.id),
    surface: surfaceSnapshot(surfaces),
    featureLine: buildCadFeatureLineSnapshot(project, []),
  } as unknown as CadWorkspaceSnapshot;
  const commands: CadGradingShellCommand[] = [];
  const actions = {
    runGradingCommand: (command: CadGradingShellCommand): boolean => {
      commands.push(command);
      return runResult;
    },
  } as unknown as CadShellActions;
  const { host } = renderManager(
    <CadGradingManager snapshot={snapshot} actions={actions} onClose={() => {}} />,
  );
  return { host, commands };
};

interface GroupHarness {
  host: HTMLDivElement;
  commands: CadGradingGroupShellCommand[];
}

const mountGroup = (
  row: CadGradingGroup,
  surfaces: SurfaceSpec[],
  runResult = true,
): GroupHarness => {
  const project = baseProject([groupLine()]);
  project.surfaces = surfaces.map((entry) => cadSurface(entry.id, entry.name));
  project.gradingGroups = [row];
  const snapshot = {
    units: 'm',
    gradingGroups: buildCadGradingGroupSnapshot(project, null, null, row.id),
    surface: surfaceSnapshot(surfaces),
    featureLine: buildCadFeatureLineSnapshot(project, []),
  } as unknown as CadWorkspaceSnapshot;
  const commands: CadGradingGroupShellCommand[] = [];
  const actions = {
    runGradingGroupCommand: (command: CadGradingGroupShellCommand): boolean => {
      commands.push(command);
      return runResult;
    },
  } as unknown as CadShellActions;
  const { host } = renderManager(
    <CadGradingGroupManager snapshot={snapshot} actions={actions} onClose={() => {}} />,
  );
  return { host, commands };
};

/** Stateful group harness executing the REAL engine command definitions. */
interface EngineGroupHarness {
  host: HTMLDivElement;
  commands: CadGradingGroupShellCommand[];
  project: () => CadProject;
  run: (_command: CadGradingGroupShellCommand) => boolean;
  rerender: () => void;
}

const mountGroupEngine = (row: CadGradingGroup, surfaces: SurfaceSpec[]): EngineGroupHarness => {
  let project = baseProject([groupLine()]);
  project.surfaces = surfaces.map((entry) => cadSurface(entry.id, entry.name));
  project.gradingGroups = [row];
  const commands: CadGradingGroupShellCommand[] = [];
  const { host, root } = createHost();
  const run = (command: CadGradingGroupShellCommand): boolean => {
    commands.push(command);
    const engineSnapshot = {
      project,
      selection: { selectedEntityIds: [] },
    } as unknown as EngineSnapshot;
    const result = executeCadCommand(engineSnapshot, command);
    if (!result) return false;
    project = result.nextSnapshot.project;
    return true;
  };
  const actions = { runGradingGroupCommand: run } as unknown as CadShellActions;
  const rerender = (): void => {
    const snapshot = {
      units: 'm',
      gradingGroups: buildCadGradingGroupSnapshot(project, null, null, row.id),
      surface: surfaceSnapshot(surfaces),
      featureLine: buildCadFeatureLineSnapshot(project, []),
    } as unknown as CadWorkspaceSnapshot;
    act(() => {
      root.render(<CadGradingGroupManager snapshot={snapshot} actions={actions} onClose={() => {}} />);
    });
  };
  rerender();
  return { host, commands, project: () => project, run, rerender };
};

// ---------------------------------------------------------------------------
// DOM helpers (selectors shared by both managers via the attr prefix)
// ---------------------------------------------------------------------------

const adapter = (attr: 'cad-grading' | 'cad-grading-group') => ({
  open: `[data-${attr}-edit-criteria]`,
  panel: `[data-${attr}-edit-panel]`,
  apply: `[data-${attr}-edit-apply]`,
  blocked: `[data-${attr}-edit-surface-blocked]`,
  notice: `[data-${attr}-notice]`,
  method: `[data-cad-grading-field="${attr}-edit-method"]`,
  distance: `[data-cad-grading-field="${attr}-edit-distance"]`,
  elevation: `[data-cad-grading-field="${attr}-edit-elevation"]`,
  target: '[aria-label="Target surface"]',
});

type Adapter = ReturnType<typeof adapter>;

const query = <T extends Element>(root: Element, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`missing ${selector}`);
  return found;
};

const clickIn = (root: Element, selector: string): void => {
  act(() => query<HTMLElement>(root, selector).click());
};

const setSelectIn = (root: Element, selector: string, value: string): void => {
  const select = query<HTMLSelectElement>(root, selector);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const setInputIn = (root: Element, selector: string, value: string): void => {
  const input = query<HTMLInputElement>(root, selector);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const openEditPanel = (host: HTMLElement, spec: Adapter): HTMLElement => {
  clickIn(host, spec.open);
  return query<HTMLElement>(host, spec.panel);
};

const applyEdit = (host: HTMLElement, spec: Adapter): void => clickIn(host, spec.apply);

const noticeText = (host: HTMLElement, spec: Adapter): string =>
  host.querySelector(spec.notice)?.textContent ?? '';

const panelOf = (host: HTMLElement, spec: Adapter): HTMLElement | null =>
  host.querySelector<HTMLElement>(spec.panel);

// ---------------------------------------------------------------------------
// ordinary grading edit flows (A-F)
// ---------------------------------------------------------------------------

describe('Phase 20F.1 ordinary grading edit flows', () => {
  const SPEC = adapter('cad-grading');

  it('Surface -> Distance / Elevation drops the target in one command', () => {
    for (const [method, kind] of [
      ['distance', 'distance'],
      ['elevation', 'elevation'],
    ] as const) {
      const harness = mountGrading(grading(FIXED, 'srf-a'), CURRENT_SURFACES);
      const panel = openEditPanel(harness.host, SPEC);
      expect(panel.querySelector(SPEC.target)).not.toBeNull();

      setSelectIn(panel, SPEC.method, method);
      expect(panel.querySelector(SPEC.target)).toBeNull();
      applyEdit(harness.host, SPEC);

      expect(harness.commands).toHaveLength(1);
      const command = harness.commands[0]!;
      expect(command.key).toBe('GRADING_EDIT_CRITERIA');
      if (command.key === 'GRADING_EDIT_CRITERIA') {
        expect(command.criterion.kind).toBe(kind);
        expect(command.targetSurfaceId).toBeNull();
      }
      expect(noticeText(harness.host, SPEC)).toContain('Criteria updated');
      expect(panelOf(harness.host, SPEC)).toBeNull();
    }
  });

  it('Distance / Elevation -> Surface restores a real CURRENT target in one command', () => {
    for (const criterion of [DISTANCE, ELEVATION]) {
      const harness = mountGrading(grading(criterion), CURRENT_SURFACES);
      const panel = openEditPanel(harness.host, SPEC);
      expect(panel.querySelector(SPEC.target)).toBeNull();

      setSelectIn(panel, SPEC.method, 'surface');
      const target = query<HTMLSelectElement>(panel, SPEC.target);
      expect(target.value).toBe('srf-a');
      applyEdit(harness.host, SPEC);

      expect(harness.commands).toHaveLength(1);
      const command = harness.commands[0]!;
      expect(command.key).toBe('GRADING_EDIT_CRITERIA');
      if (command.key === 'GRADING_EDIT_CRITERIA') {
        expect(command.criterion.kind).toBe('fixed');
        expect(command.targetSurfaceId).toBe('srf-a');
      }
      expect(noticeText(harness.host, SPEC)).toContain('Criteria updated');
    }
  });

  it('Surface mode with no eligible CURRENT surface blocks Apply and never reports success', () => {
    const harness = mountGrading(grading(DISTANCE), NO_CURRENT_SURFACES);
    const panel = openEditPanel(harness.host, SPEC);
    setSelectIn(panel, SPEC.method, 'surface');

    expect(panel.querySelector(SPEC.blocked)).not.toBeNull();
    expect(query<HTMLButtonElement>(panel, SPEC.apply).disabled).toBe(true);
    clickIn(panel, SPEC.apply);
    expect(harness.commands).toHaveLength(0);
    expect(noticeText(harness.host, SPEC)).toBe('');
    expect(panelOf(harness.host, SPEC)).not.toBeNull();
  });

  it('invalid analytic field never commits and keeps the editor open', () => {
    const harness = mountGrading(grading(FIXED, 'srf-a'), CURRENT_SURFACES);
    const panel = openEditPanel(harness.host, SPEC);
    setSelectIn(panel, SPEC.method, 'distance');
    setInputIn(panel, SPEC.distance, '0');
    applyEdit(harness.host, SPEC);

    expect(harness.commands).toHaveLength(0);
    const notice = noticeText(harness.host, SPEC);
    expect(notice).toContain('rejected');
    expect(notice).not.toContain('updated');
    expect(panelOf(harness.host, SPEC)).not.toBeNull();
  });

  it('a rejected edit keeps the editor open and never emits success', () => {
    const harness = mountGrading(grading(FIXED, 'srf-a'), CURRENT_SURFACES, false);
    openEditPanel(harness.host, SPEC);
    applyEdit(harness.host, SPEC);

    expect(harness.commands).toHaveLength(1);
    const notice = noticeText(harness.host, SPEC);
    expect(notice).toContain('rejected');
    expect(notice).not.toContain('updated');
    expect(panelOf(harness.host, SPEC)).not.toBeNull();
  });

  it('Change Target and Delete report rejection instead of a false success', () => {
    const harness = mountGrading(grading(FIXED, 'srf-a'), CURRENT_SURFACES, false);
    setSelectIn(harness.host, '[data-cad-grading-change-target]', 'srf-b');
    expect(noticeText(harness.host, SPEC)).toContain('rejected');
    clickIn(harness.host, '[data-cad-grading-delete]');
    expect(noticeText(harness.host, SPEC)).toContain('rejected');
  });
});

// ---------------------------------------------------------------------------
// grading-group edit flows (A-F)
// ---------------------------------------------------------------------------

describe('Phase 20F.1 grading-group edit flows', () => {
  const SPEC = adapter('cad-grading-group');

  it('Surface -> Distance / Elevation drops the target in one command', () => {
    for (const [method, kind] of [
      ['distance', 'distance'],
      ['elevation', 'elevation'],
    ] as const) {
      const harness = mountGroup(group(FIXED, 'srf-a'), CURRENT_SURFACES);
      const panel = openEditPanel(harness.host, SPEC);
      expect(panel.querySelector(SPEC.target)).not.toBeNull();

      setSelectIn(panel, SPEC.method, method);
      expect(panel.querySelector(SPEC.target)).toBeNull();
      applyEdit(harness.host, SPEC);

      expect(harness.commands).toHaveLength(1);
      const command = harness.commands[0]!;
      expect(command.key).toBe('GROUP_EDIT_CRITERIA');
      if (command.key === 'GROUP_EDIT_CRITERIA') {
        expect(command.criterion?.kind).toBe(kind);
        expect(command.targetSurfaceId).toBeNull();
      }
      expect(noticeText(harness.host, SPEC)).toContain('Criteria updated');
      expect(panelOf(harness.host, SPEC)).toBeNull();
    }
  });

  it('Distance / Elevation -> Surface restores a real CURRENT target in one command', () => {
    for (const criterion of [DISTANCE, ELEVATION]) {
      const harness = mountGroup(group(criterion), CURRENT_SURFACES);
      const panel = openEditPanel(harness.host, SPEC);
      expect(panel.querySelector(SPEC.target)).toBeNull();

      setSelectIn(panel, SPEC.method, 'surface');
      expect(query<HTMLSelectElement>(panel, SPEC.target).value).toBe('srf-a');
      applyEdit(harness.host, SPEC);

      expect(harness.commands).toHaveLength(1);
      const command = harness.commands[0]!;
      expect(command.key).toBe('GROUP_EDIT_CRITERIA');
      if (command.key === 'GROUP_EDIT_CRITERIA') {
        expect(command.criterion?.kind).toBe('fixed');
        expect(command.targetSurfaceId).toBe('srf-a');
      }
      expect(noticeText(harness.host, SPEC)).toContain('Criteria updated');
    }
  });

  it('Surface mode with no eligible CURRENT surface blocks Apply and never reports success', () => {
    const harness = mountGroup(group(DISTANCE), NO_CURRENT_SURFACES);
    const panel = openEditPanel(harness.host, SPEC);
    setSelectIn(panel, SPEC.method, 'surface');

    expect(panel.querySelector(SPEC.blocked)).not.toBeNull();
    expect(query<HTMLButtonElement>(panel, SPEC.apply).disabled).toBe(true);
    clickIn(panel, SPEC.apply);
    expect(harness.commands).toHaveLength(0);
    expect(noticeText(harness.host, SPEC)).toBe('');
    expect(panelOf(harness.host, SPEC)).not.toBeNull();
  });

  it('invalid analytic field never commits and keeps the editor open', () => {
    const harness = mountGroup(group(FIXED, 'srf-a'), CURRENT_SURFACES);
    const panel = openEditPanel(harness.host, SPEC);
    setSelectIn(panel, SPEC.method, 'distance');
    setInputIn(panel, SPEC.distance, '0');
    applyEdit(harness.host, SPEC);

    expect(harness.commands).toHaveLength(0);
    const notice = noticeText(harness.host, SPEC);
    expect(notice).toContain('rejected');
    expect(notice).not.toContain('updated');
    expect(panelOf(harness.host, SPEC)).not.toBeNull();
  });

  it('a rejected edit keeps the editor open and never emits success', () => {
    const harness = mountGroup(group(FIXED, 'srf-a'), CURRENT_SURFACES, false);
    openEditPanel(harness.host, SPEC);
    applyEdit(harness.host, SPEC);

    expect(harness.commands).toHaveLength(1);
    const notice = noticeText(harness.host, SPEC);
    expect(notice).toContain('rejected');
    expect(notice).not.toContain('updated');
    expect(panelOf(harness.host, SPEC)).not.toBeNull();
  });

  it('Change Target and Delete report rejection instead of a false success', () => {
    const harness = mountGroup(group(FIXED, 'srf-a'), CURRENT_SURFACES, false);
    setSelectIn(harness.host, '[data-cad-grading-group-change-target]', 'srf-b');
    expect(noticeText(harness.host, SPEC)).toContain('rejected');
    clickIn(harness.host, '[data-cad-grading-group-delete]');
    expect(noticeText(harness.host, SPEC)).toContain('rejected');
  });
});

// ---------------------------------------------------------------------------
// engine-authoritative group family guard
// ---------------------------------------------------------------------------

describe('Phase 20J group hybrid switch (no domain lock)', () => {
  const SPEC = adapter('cad-grading-group');

  it('an analytic -> Surface default switch keeps overrides and lands hybrid in one command', () => {
    // Phase 20J Wave C2: hybrid groups mix freely, so switching the default
    // to Surface with a stored analytic override asks nothing and deletes
    // nothing — criterion + real target commit in ONE undo entry and the
    // override survives as the analytic half of the hybrid.
    const harness = mountGroupEngine(mixedFamilyGroup(), CURRENT_SURFACES);
    const panel = openEditPanel(harness.host, SPEC);
    setSelectIn(panel, SPEC.method, 'surface');
    // Preview names the hybrid result before commit.
    expect(panel.textContent).toContain('Next: Hybrid');
    expect(harness.host.querySelector('[data-cad-grading-group-edit-hybrid-warning]')?.textContent)
      .toContain('one exact common tie');
    applyEdit(harness.host, SPEC);
    expect(harness.commands.map((command) => command.key)).toEqual([
      'GROUP_EDIT_CRITERIA',
    ]);
    expect(noticeText(harness.host, SPEC)).toContain('Criteria updated');
    expect(panelOf(harness.host, SPEC)).toBeNull();
    const saved = harness.project().gradingGroups?.[0];
    expect(saved?.criterion.kind).toBe('fixed');
    expect(saved?.targetSurfaceId).toBe('srf-a');
    expect(saved?.courseCriteria ?? []).toHaveLength(1);
  });
});
