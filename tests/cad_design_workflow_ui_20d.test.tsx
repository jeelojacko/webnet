/** @vitest-environment jsdom */

/**
 * Phase 20D Wave-2 design workflow UI contracts (agent-tier fast, jsdom only).
 * Registry rows + manager-first dispatch, panel selects/status/actions,
 * purpose badge mapping, dispatch payload shape, EG-target apply block.
 * No engine math; engine suites cover the numeric seams.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type { CadProject, CadSurface, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import { buildCadSurface } from '../src/engine/cad/cadSurfaces';
import { createCadSurfaceCache } from '../src/engine/cad/cadSurfaceCache';
import {
  buildCadSurfaceSnapshot,
  surfacePurposeBadge,
  surfacePurposeSuffix,
} from '../src/cad-app/shell/cadSurfaceSnapshot';
import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import { CadDesignWorkflowPanel } from '../src/cad-app/shell/CadDesignWorkflowPanel';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import { DESIGN_APPLY_EG_BLOCKED } from '../src/engine/cad/cadTransactionsDesignSurfaceCommands';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let seq = 0;
const pt = (stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id: `pt-${(seq += 1)}`,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'unknown',
  source: 'parsed-input',
});

const projectWith = (surfaces: CadSurface[], entities: CadProject['entities']): CadProject => ({
  version: 2,
  id: 'test-project',
  name: 'test',
  metadata: { source: 'parsed-input', runMode: 'unknown', units: 'm', stationCount: 0, observationCount: 0, adjustedStationCount: 0 },
  layers: [],
  styleLibrary: { lineTypes: [], textStyles: [], pointSymbols: [], styles: [] },
  entities,
  cogoComputations: [],
  bounds: null,
  surfaces,
});

const quadDef = (ids: string[]) => ({
  pointSource: { kind: 'points', pointEntityIds: ids },
});

const fixture = () => {
  const a = pt('A', 0, 0, 100);
  const b = pt('B', 10, 0, 100);
  const c = pt('C', 10, 10, 100);
  const d = pt('D', 0, 10, 100);
  const e = pt('E', 20, 0, 110);
  const f = pt('F', 30, 0, 110);
  const g = pt('G', 30, 10, 110);
  const h = pt('H', 20, 10, 110);
  const project = projectWith(
    [
      { id: 'eg', name: 'EG', definition: quadDef([a.id, b.id, c.id, d.id]), purpose: 'existing-ground', cachedRevision: null } as CadSurface,
      { id: 'dsn', name: 'DSN', definition: quadDef([a.id, b.id, c.id, d.id]), purpose: 'design', cachedRevision: null } as CadSurface,
      { id: 'pch', name: 'P', definition: quadDef([e.id, f.id, g.id, h.id]), purpose: 'design-patch', cachedRevision: null } as CadSurface,
    ],
    [a, b, c, d, e, f, g, h],
  );
  const cache = createCadSurfaceCache('test');
  for (const surface of project.surfaces!) {
    const built = buildCadSurface(project, surface);
    expect(built.outcome).toBe('ok');
    if (built.outcome !== 'ok') continue;
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
  const surface = buildCadSurfaceSnapshot(project, cache, 'eg', {});
  for (const row of surface.surfaces) expect(row.status).toBe('CURRENT');
  return { project, surface };
};

const stubActions = (extra: Partial<CadShellActions> = {}): CadShellActions =>
  ({
    runSurveyCommand: vi.fn((): boolean => true),
    selectVolume: vi.fn(),
    calculateSelectedVolume: vi.fn(),
    openSurveyManager: vi.fn(),
    ...extra,
  }) as unknown as CadShellActions;

const stubSnapshot = (surface: ReturnType<typeof fixture>['surface']): CadWorkspaceSnapshot =>
  ({
    surface,
    volume: { volumes: [], selectedVolumeId: null, styles: [] },
    gradingGroups: null,
    layers: [],
    currentLayerId: 'general',
  }) as unknown as CadWorkspaceSnapshot;

const render = async (ui: React.ReactElement): Promise<{ element: HTMLElement; cleanup: () => void }> => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const root = createRoot(element);
  await act(async () => {
    root.render(ui);
  });
  return {
    element,
    cleanup: () => {
      act(() => root.unmount());
      element.remove();
    },
  };
};

const click = async (element: Element | null): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const changeSelect = async (select: HTMLSelectElement, value: string): Promise<void> => {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const buttonByName = (element: HTMLElement, name: string): HTMLButtonElement | null => {
  const buttons = [...element.querySelectorAll('button')];
  return (buttons.find((entry) => entry.textContent === name) as HTMLButtonElement) ?? null;
};

describe('design workflow registry (Phase 20D UI)', () => {
  const keys = ['DESIGNSURFACE', 'DESIGNPATCH', 'DESIGNAPPLY', 'DESIGNVOLUME', 'SURFPURPOSE'];
  it('registers all five rows in the Surface category with no aliases', () => {
    for (const key of keys) {
      const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === key);
      expect(def).toBeDefined();
      expect(def!.category).toBe('Surface');
      expect(def!.aliases).toEqual([]);
      expect(resolveShellCommandText(key)).not.toBeNull();
    }
  });

  it('routes every design key to the surface manager without executing', () => {
    const runSurveyCommand = vi.fn((..._args: unknown[]): boolean => true);
    const openSurveyManager = vi.fn();
    const actions = stubActions({ runSurveyCommand, openSurveyManager });
    for (const key of keys) {
      const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === key)!;
      expect(executeShellCommand(def, actions, stubSnapshot(fixture().surface))).toBe(true);
      expect(openSurveyManager).toHaveBeenCalledWith('surfaces', expect.anything());
    }
    expect(runSurveyCommand).not.toHaveBeenCalled();
  });
});

describe('purpose badges (Phase 20D UI)', () => {
  it('maps all five purposes plus absent to compact badges and suffixes', () => {
    expect(surfacePurposeBadge('existing-ground')).toBe('EG');
    expect(surfacePurposeBadge('design')).toBe('DESIGN');
    expect(surfacePurposeBadge('design-patch')).toBe('PATCH');
    expect(surfacePurposeBadge('reference')).toBe('REF');
    expect(surfacePurposeBadge('other')).toBe('—');
    expect(surfacePurposeBadge(undefined)).toBe('—');
    expect(surfacePurposeSuffix('existing-ground')).toBe('Existing Ground');
    expect(surfacePurposeSuffix('design')).toBe('Design');
    expect(surfacePurposeSuffix('design-patch')).toBe('Design Patch');
    expect(surfacePurposeSuffix('reference')).toBe('Reference');
    expect(surfacePurposeSuffix('other')).toBeNull();
    expect(surfacePurposeSuffix(undefined)).toBeNull();
  });

  it('carries purpose through the snapshot rows', () => {
    const { surface } = fixture();
    expect(surface.surfaces.find((entry) => entry.id === 'eg')?.purposeBadge).toBe('EG');
    expect(surface.surfaces.find((entry) => entry.id === 'dsn')?.purposeBadge).toBe('DESIGN');
    expect(surface.surfaces.find((entry) => entry.id === 'pch')?.purposeBadge).toBe('PATCH');
  });
});

describe('design workflow panel (Phase 20D UI)', () => {
  it('renders EG/Design selects plus the status summary', async () => {
    const { surface } = fixture();
    const { element, cleanup } = await render(
      <CadDesignWorkflowPanel snapshot={stubSnapshot(surface)} actions={stubActions()} notify={() => {}} />,
    );
    try {
      expect(element.querySelector('select[aria-label="Existing Ground surface"]')).not.toBeNull();
      expect(element.querySelector('select[aria-label="Design surface"]')).not.toBeNull();
      expect(element.querySelector('select[aria-label="Patch surface"]')).not.toBeNull();
      expect(element.textContent).toContain('EG — Current');
      expect(element.textContent).toContain('DSN — Current');
      expect(element.textContent).toContain('P — Current');
      expect(element.textContent).toContain('Not tracked');
    } finally {
      cleanup();
    }
  });

  it('dispatches DESIGNSURFACE with expectedRevision and sessionCurrent', async () => {
    const { surface } = fixture();
    let seen: unknown = null;
    const runSurveyCommand = ((command: unknown): boolean => {
      seen = command;
      return true;
    }) as CadShellActions['runSurveyCommand'];
    const notify = vi.fn();
    const { element, cleanup } = await render(
      <CadDesignWorkflowPanel snapshot={stubSnapshot(surface)} actions={stubActions({ runSurveyCommand })} notify={notify} />,
    );
    try {
      await click(buttonByName(element, 'Create Design Copy'));
      const command = seen as unknown as Record<string, unknown>;
      expect(command.key).toBe('DESIGNSURFACE');
      expect(command.sourceSurfaceId).toBe('eg');
      expect(typeof command.expectedRevision).toBe('string');
      expect(command.sessionCurrent).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('blocks Apply Patch on an Existing Ground target with the copy-first message', async () => {
    const { surface } = fixture();
    const runSurveyCommand = vi.fn((..._args: unknown[]): boolean => true);
    const notify = vi.fn();
    const { element, cleanup } = await render(
      <CadDesignWorkflowPanel snapshot={stubSnapshot(surface)} actions={stubActions({ runSurveyCommand })} notify={notify} />,
    );
    try {
      const designSelect = element.querySelector('select[aria-label="Design surface"]') as HTMLSelectElement;
      await changeSelect(designSelect, 'eg');
      await click(buttonByName(element, 'Apply Patch'));
      expect(runSurveyCommand).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith(DESIGN_APPLY_EG_BLOCKED);
      expect(element.textContent).toContain('Create a Design Copy first');
    } finally {
      cleanup();
    }
  });
});
