/** @vitest-environment jsdom */
/**
 * Phase 20F.2 §22 — calc-notice follow-up for both grading managers.
 *
 * Pins: the `Computing …` notice set at Calculate time clears/replaces when
 * the snapshot row settles — CURRENT reports success, FAILED reports the
 * bounded reason, a moved revision reports superseded — with zero synthetic
 * interaction (plain snapshot re-renders only). No polling, no string
 * parsing, no worker-state duplicate: the notice follows row status. A newer
 * operator notice disarms the pending request so completion can never
 * clobber it.
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { CadFeatureLineEntity, CadProject, CadSurface } from '../src/engine/cad/cadTypes';
import type { CadGrading } from '../src/engine/cad/grading/gradingTypes';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import { createGroupDefinition } from '../src/engine/cad/grading/gradingGroupAuthoring';
import { CadGradingManager } from '../src/cad-app/shell/CadGradingManager';
import { CadGradingGroupManager } from '../src/cad-app/shell/CadGradingGroupManager';
import { buildCadGradingSnapshot, type CadGradingRow } from '../src/cad-app/shell/cadGradingSnapshot';
import { buildCadGradingGroupSnapshot, type CadGradingGroupRow } from '../src/cad-app/shell/cadGradingGroupSnapshot';
import { buildCadFeatureLineSnapshot } from '../src/cad-app/shell/cadFeatureLineSnapshot';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

// ---------------------------------------------------------------------------
// fixtures (analytic distance: no target gate, so Calculate stays enabled)
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
    { id: 'vC', x: 20, y: 5, z: 0 },
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
  id: 'grading-notice-20f2',
  name: 'grading-notice-20f2',
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

const analyticGrading = (id: string): CadGrading => ({
  id,
  name: id,
  sourceFeatureLineId: 'fl-1',
  sourceCourse: { vertexAId: 'vA', vertexBId: 'vB' },
  targetSurfaceId: '',
  side: 'right',
  criterion: { kind: 'distance', gradeRatio: -0.02, distance: 20 },
  maxSearchDistance: 20,
  curveChordTolerance: 0.1,
});

const analyticGroup = (id: string): CadGradingGroup => {
  const created = createGroupDefinition({
    id,
    name: id,
    sourceFeatureLineId: 'fl-1',
    sourceCourses: [
      { vertexAId: 'vA', vertexBId: 'vB' },
      { vertexAId: 'vB', vertexBId: 'vC' },
    ],
    side: 'right',
    criterion: { kind: 'distance', gradeRatio: -0.02, distance: 20 },
    maxSearchDistance: 20,
    curveChordTolerance: 0.1,
    cornerMode: 'miter',
  });
  if (!created.ok) throw new Error(created.error);
  return created.value;
};

const surfaceSnapshot = (): CadWorkspaceSnapshot['surface'] =>
  ({ surfaces: [{ id: 'srf-a', name: 'EG', status: 'CURRENT' }] } as unknown as CadWorkspaceSnapshot['surface']);

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

const clickIn = (root: Element, selector: string): void => {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  act(() => el.click());
};

const noticeText = (host: Element, selector: string): string | null =>
  host.querySelector(selector)?.textContent ?? null;

// ---------------------------------------------------------------------------
// grading manager
// ---------------------------------------------------------------------------

const mountGrading = (): {
  host: HTMLDivElement;
  rerender: (_patch: Partial<CadGradingRow>) => void;
} => {
  const project = baseProject([ridgeLine()]);
  project.surfaces = [cadSurface('srf-a', 'EG')];
  project.gradings = [analyticGrading('g-n')];
  const { host, root } = createHost();
  const actions = {
    runGradingCommand: (): boolean => true,
    requestGradingCalculate: (): string => 'Computing grading for “g-n”…',
  } as unknown as CadShellActions;
  const renderRow = (node: ReactNode): void => {
    act(() => root.render(node));
  };
  const rerender = (patch: Partial<CadGradingRow>): void => {
    const built = buildCadGradingSnapshot(project, null, null, 'g-n');
    const rows = built.gradings.map((row) =>
      row.id === 'g-n' ? { ...row, ...patch } : row,
    );
    const snapshot = {
      units: 'm',
      grading: { ...built, gradings: rows },
      surface: surfaceSnapshot(),
      featureLine: buildCadFeatureLineSnapshot(project, []),
    } as unknown as CadWorkspaceSnapshot;
    renderRow(<CadGradingManager snapshot={snapshot} actions={actions} onClose={() => {}} />);
  };
  rerender({});
  return { host, rerender };
};

describe('Phase 20F.2 grading calc notice', () => {
  it('replaces Computing with CURRENT on settlement (no synthetic interaction)', () => {
    const { host, rerender } = mountGrading();
    const calc = host.querySelector<HTMLElement>('[data-cad-grading-calculate]');
    expect(calc?.hasAttribute('disabled')).toBe(false);
    clickIn(host, '[data-cad-grading-calculate]');
    expect(noticeText(host, '[data-cad-grading-notice]')).toContain('Computing');
    // Worker settles: plain snapshot re-renders only, zero clicks.
    rerender({ status: 'BUILDING', statusText: 'Building' });
    expect(noticeText(host, '[data-cad-grading-notice]')).toContain('Computing');
    rerender({ status: 'CURRENT', statusText: 'Current' });
    const text = noticeText(host, '[data-cad-grading-notice]');
    expect(text).toContain('CURRENT');
    expect(text).not.toContain('Computing');
  });

  it('reports FAILED with the bounded reason', () => {
    const { host, rerender } = mountGrading();
    clickIn(host, '[data-cad-grading-calculate]');
    rerender({
      status: 'FAILED',
      statusText: 'Failed',
      diagnostic: 'CORNER_NO_SOLUTION (corner 0): GRADING_ANALYTIC_CORNER_Z',
    });
    const text = noticeText(host, '[data-cad-grading-notice]');
    expect(text).toContain('Calculate failed');
    expect(text).toContain('CORNER_NO_SOLUTION');
  });

  it('reports superseded when the revision moves mid-flight', () => {
    const { host, rerender } = mountGrading();
    clickIn(host, '[data-cad-grading-calculate]');
    rerender({ revision: 'grev1:changed', status: 'NEEDS_RECALC', statusText: 'Needs recalculation' });
    expect(noticeText(host, '[data-cad-grading-notice]')).toContain('recalculate');
  });

  it('never clobbers a newer operator notice on late completion', () => {
    const { host, rerender } = mountGrading();
    clickIn(host, '[data-cad-grading-calculate]');
    // Operator deletes the row (newer notice); the late CURRENT arrival must
    // not overwrite it.
    window.confirm = (() => true) as typeof window.confirm;
    clickIn(host, '[data-cad-grading-delete]');
    expect(noticeText(host, '[data-cad-grading-notice]')).toContain('Deleted');
    rerender({ status: 'CURRENT', statusText: 'Current' });
    expect(noticeText(host, '[data-cad-grading-notice]')).toContain('Deleted');
  });
});

// ---------------------------------------------------------------------------
// grading-group manager
// ---------------------------------------------------------------------------

const mountGroup = (): {
  host: HTMLDivElement;
  rerender: (_patch: Partial<CadGradingGroupRow>) => void;
} => {
  const project = baseProject([ridgeLine()]);
  project.surfaces = [cadSurface('srf-a', 'EG')];
  project.gradingGroups = [analyticGroup('gg-n')];
  const { host, root } = createHost();
  const actions = {
    runGradingGroupCommand: (): boolean => true,
    requestGroupGradingCalculate: (): string => 'Computing grading group for “gg-n”…',
  } as unknown as CadShellActions;
  const rerender = (patch: Partial<CadGradingGroupRow>): void => {
    const built = buildCadGradingGroupSnapshot(project, null, null, 'gg-n');
    const rows = built.groups.map((row) =>
      row.id === 'gg-n' ? { ...row, ...patch } : row,
    );
    const snapshot = {
      units: 'm',
      gradingGroups: { ...built, groups: rows },
      surface: surfaceSnapshot(),
      featureLine: buildCadFeatureLineSnapshot(project, []),
    } as unknown as CadWorkspaceSnapshot;
    act(() => root.render(<CadGradingGroupManager snapshot={snapshot} actions={actions} onClose={() => {}} />));
  };
  rerender({});
  return { host, rerender };
};

describe('Phase 20F.2 grading-group calc notice', () => {
  it('replaces Computing with CURRENT on settlement (no synthetic interaction)', () => {
    const { host, rerender } = mountGroup();
    const calc = host.querySelector<HTMLElement>('[data-cad-grading-group-calculate]');
    expect(calc?.hasAttribute('disabled')).toBe(false);
    clickIn(host, '[data-cad-grading-group-calculate]');
    expect(noticeText(host, '[data-cad-grading-group-notice]')).toContain('Computing');
    rerender({ status: 'BUILDING', statusText: 'Building' });
    expect(noticeText(host, '[data-cad-grading-group-notice]')).toContain('Computing');
    rerender({ status: 'CURRENT', statusText: 'Current' });
    const text = noticeText(host, '[data-cad-grading-group-notice]');
    expect(text).toContain('CURRENT');
    expect(text).not.toContain('Computing');
  });

  it('reports FAILED with the bounded reason', () => {
    const { host, rerender } = mountGroup();
    clickIn(host, '[data-cad-grading-group-calculate]');
    rerender({
      status: 'FAILED',
      statusText: 'Failed',
      diagnostic: 'CORNER_NO_SOLUTION (corner 0): GRADING_ANALYTIC_CORNER_Z',
    });
    const text = noticeText(host, '[data-cad-grading-group-notice]');
    expect(text).toContain('Calculate failed');
    expect(text).toContain('CORNER_NO_SOLUTION');
  });
});
