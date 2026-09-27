/** @vitest-environment jsdom */

/**
 * Phase 19D — parcel plan/network UI. Registry entries, derived snapshot,
 * Toolspace Network/Schedules rendering with wired Unlink, Properties
 * Designation/Role/Description + shared-boundary rows, the bounded ribbon
 * subgroup, and the designation centre label. Plan Role is display metadata
 * only; no test asserts any legal meaning.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { createCadHistoryState, type CadHistoryState } from '../src/engine/cad/cadUndoRedo';
import { handleSurveyCadParcelNetworkSubmit } from '../src/hooks/surveyCad/useSurveyCadParcelNetworkSubmit';
import type { CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { buildCadDisplayScene } from '../src/engine/cad/cadRenderer';
import { buildParcelCourseIds } from '../src/engine/cad/cadParcelCourses';
import { buildCadParcelSharedBoundaryId } from '../src/engine/cad/cadParcelSharedBoundary';
import type { CadEntityId, CadParcelEntity, CadProject } from '../src/engine/cad/cadTypes';
import { CAD_SHELL_COMMANDS, resolveShellCommandText } from '../src/cad-app/shell/cadCommandRegistry';
import { buildCadParcelSnapshot } from '../src/cad-app/shell/cadParcelSnapshot';
import { ParcelNetworkNode, ParcelSchedulesNode } from '../src/cad-app/shell/CadParcelToolspace';
import { CadParcelNetworkRibbonGroup } from '../src/cad-app/shell/CadParcelNetworkRibbonGroup';
import { CadRibbon } from '../src/cad-app/shell/CadRibbon';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import SurveyCadPropertiesPanel from '../src/components/surveyCad/SurveyCadPropertiesPanel';
import { buildBaseCadPropertiesProject } from './cadPropertiesTestSupport';

const NETWORK_KEYS = [
  'PARCELDESIGNATE',
  'PARCELNUMBER',
  'PARCELLINK',
  'PARCELUNLINK',
  'PARCELCHECK',
  'PARCELSCHEDULE',
  'PARCELSHAREDEDIT',
] as const;

/** Two adjacent 10x10 parcels sharing the x=10 edge with opposite traversal. */
const buildParcelNetworkProject = (): {
  project: CadProject;
  parcelAId: CadEntityId;
  parcelBId: CadEntityId;
  boundaryId: string;
} => {
  const parcelA: CadParcelEntity = {
    id: 'parcel:a',
    type: 'parcel',
    layerId: 'parcels',
    visible: true,
    locked: false,
    parcelName: 'Parcel A',
    planInfo: { designation: 'LOT 24-1', role: 'lot', description: 'Corner lot' },
    vertices: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
    vertexLabels: ['A1', 'A2', 'A3', 'A4'],
    courseIds: buildParcelCourseIds('parcel:a', 4),
    areaSquareMeters: 100,
    perimeterMeters: 40,
    closureDeltaX: 0,
    closureDeltaY: 0,
    closureDistanceMeters: 0,
  };
  const parcelB: CadParcelEntity = {
    id: 'parcel:b',
    type: 'parcel',
    layerId: 'parcels',
    visible: true,
    locked: false,
    parcelName: 'Parcel B',
    planInfo: { designation: 'Parcel 3', role: 'remainder' },
    vertices: [
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 10 },
    ],
    vertexLabels: ['B1', 'B2', 'B3', 'B4'],
    courseIds: buildParcelCourseIds('parcel:b', 4),
    areaSquareMeters: 100,
    perimeterMeters: 40,
    closureDeltaX: 0,
    closureDeltaY: 0,
    closureDistanceMeters: 0,
  };
  const first = { parcelId: 'parcel:a', courseId: parcelA.courseIds![1]! };
  const second = { parcelId: 'parcel:b', courseId: parcelB.courseIds![3]! };
  const boundaryId = buildCadParcelSharedBoundaryId(first, second);
  const base = appendCadProjectEntities(buildBaseCadPropertiesProject(), [parcelA, parcelB]);
  const project: CadProject = {
    ...base,
    sharedParcelBoundaries: [{ id: boundaryId, first, second }],
  };
  return { project, parcelAId: 'parcel:a', parcelBId: 'parcel:b', boundaryId };
};

const shellActions = (overrides: Partial<CadShellActions> = {}): CadShellActions =>
  ({
    selectEntities: () => undefined,
    runLayerCommand: () => true,
    startCommand: () => true,
    zoomToParcel: () => undefined,
    ...overrides,
  }) as unknown as CadShellActions;

const baseSnapshot = (overrides: Partial<CadWorkspaceSnapshot> = {}): CadWorkspaceSnapshot =>
  ({
    drawingId: 'd1',
    drawingName: 'Test',
    units: 'm',
    entityCount: 0,
    selectionCount: 0,
    selectedEntityIds: [],
    selectionPreview: [],
    layers: [],
    layerEntityCounts: {},
    currentLayerId: 'general',
    lineTypes: [],
    sheets: [],
    properties: null,
    activeCommandKey: null,
    commandPrompt: 'Idle',
    commandInputValue: '',
    canUndo: false,
    canRedo: false,
    historyDepth: 0,
    redoDepth: 0,
    snapPreferences: {},
    snapStatusText: 'OSNAP off',
    stationCount: 0,
    dependencyStatus: 'MANUAL_ONLY',
    availableCommands: [...NETWORK_KEYS],
    ...overrides,
  }) as CadWorkspaceSnapshot;

describe('Phase 19D parcel network shell registry', () => {
  it('registers every network command with the Parcel category and resolve text', () => {
    for (const key of NETWORK_KEYS) {
      const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === key);
      expect(def, key).toBeDefined();
      expect(def?.category).toBe('Parcel');
      expect(resolveShellCommandText(key)?.key).toBe(key);
    }
    expect(resolveShellCommandText('parceldesig')?.key).toBe('PARCELDESIGNATE');
    expect(resolveShellCommandText('parcelshareboundary')?.key).toBe('PARCELLINK');
    expect(resolveShellCommandText('parcelschedule')?.key).toBe('PARCELSCHEDULE');
  });
});

describe('Phase 19D parcel snapshot', () => {
  it('derives designation primary, linked count, shared length and neighbors', () => {
    const { project, parcelAId, boundaryId } = buildParcelNetworkProject();
    const snapshot = buildCadParcelSnapshot(project, [parcelAId]);
    const entryA = snapshot.parcels.find((parcel) => parcel.id === parcelAId)!;
    expect(entryA.designation).toBe('LOT 24-1');
    expect(entryA.role).toBe('lot');
    expect(entryA.description).toBe('Corner lot');
    expect(entryA.linkedCount).toBe(1);
    expect(entryA.links[0]?.id).toBe(boundaryId);
    expect(entryA.links[0]?.status).toBe('CURRENT');
    expect(entryA.links[0]?.neighborDesignation).toBe('Parcel 3');
    expect(entryA.links[0]?.lengthMeters).toBeCloseTo(10, 6);
    expect(entryA.neighbors[0]?.relation).toBe('LINKED_ADJACENCY');
    expect(entryA.neighbors[0]?.linked).toBe(true);
    expect(snapshot.selectedParcel?.id).toBe(parcelAId);
  });

  it('builds a live schedule with arithmetic totals', () => {
    const { project } = buildParcelNetworkProject();
    const snapshot = buildCadParcelSnapshot(project, []);
    expect(snapshot.schedule.rows).toHaveLength(2);
    expect(snapshot.schedule.totals.arithmetic).toBe(true);
    expect(snapshot.schedule.totals.areaSquareMeters).toBeCloseTo(200, 6);
    const lot = snapshot.schedule.rows.find((row) => row.designation === 'LOT 24-1')!;
    expect(lot.role).toBe('lot');
    expect(lot.courseCount).toBe(4);
  });
});

describe('Phase 19D parcel Toolspace nodes', () => {
  it('renders designation, Plan Role, links and neighbors, and wires Unlink', async () => {
    const { project, parcelAId, boundaryId } = buildParcelNetworkProject();
    const runLayerCommand = vi.fn(() => true);
    const snapshot = baseSnapshot({
      parcel: buildCadParcelSnapshot(project, [parcelAId]),
      selectedEntityIds: [parcelAId],
    });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<ParcelNetworkNode snapshot={snapshot} actions={shellActions({ runLayerCommand })} />);
    });
    expect(container.textContent).toContain('LOT 24-1');
    expect(container.textContent).toContain('Plan Role: Lot');
    expect(container.querySelector(`[data-cad-parcel-node="${parcelAId}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-cad-parcel-link="${boundaryId}"]`)).not.toBeNull();
    expect(container.textContent).toContain('Parcel 3');
    await act(async () => {
      (container.querySelector(`[data-cad-parcel-link-unlink="${boundaryId}"]`) as HTMLButtonElement).click();
    });
    expect(runLayerCommand).toHaveBeenCalledWith({ key: 'PARCELUNLINK', boundaryId });
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders schedule rows and totals', async () => {
    const { project } = buildParcelNetworkProject();
    const snapshot = baseSnapshot({ parcel: buildCadParcelSnapshot(project, []) });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<ParcelSchedulesNode snapshot={snapshot} actions={shellActions()} />);
    });
    expect(container.querySelector('[data-cad-parcel-schedule="totals"]')?.textContent).toContain('200.000 m²');
    expect(container.querySelector('[data-cad-parcel-schedule-row="parcel:a"]')).not.toBeNull();
    expect(container.querySelector('[data-cad-parcel-schedule-row="parcel:b"]')).not.toBeNull();
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe('Phase 19D parcel Properties rows', () => {
  it('adds Plan Designation / Plan Role / Description and shared-boundary rows', () => {
    const { project, parcelAId } = buildParcelNetworkProject();
    const parcel = project.entities.find((entity) => entity.id === parcelAId)!;
    const state = buildCadPropertiesPanelState(project, [parcel]);
    if (!state || state.mode !== 'single') throw new Error('Parcel properties missing');
    const rows = state.entity.properties;
    expect(rows.find((row) => row.label === 'Plan Designation')?.value).toBe('LOT 24-1');
    expect(rows.find((row) => row.label === 'Plan Role')?.value).toBe('Lot');
    expect(rows.find((row) => row.label === 'Description')?.value).toBe('Corner lot');
    const sharedWith = rows.find((row) => row.label === 'Shared With')!;
    expect(sharedWith.value).toContain('Parcel 3');
    expect(sharedWith.actions?.map((action) => action.kind)).toEqual(['parcel-shared-edit', 'parcel-unlink']);
    // Phase 19D fix wave (F2): the shared-edit session is live, so Edit
    // Shared enables (no disabledReason); Unlink was already enabled.
    expect(sharedWith.actions?.find((action) => action.kind === 'parcel-shared-edit')?.disabledReason).toBeUndefined();
    expect(rows.find((row) => row.label === 'Shared Status')?.value).toBe('CURRENT');
    expect(rows.find((row) => row.label === 'Shared Length')?.value).toBe('10.000');
  });

  it('routes the Unlink action button through onParcelRowAction', async () => {
    const { project, parcelAId } = buildParcelNetworkProject();
    const parcel = project.entities.find((entity) => entity.id === parcelAId)!;
    const panelState = buildCadPropertiesPanelState(project, [parcel]);
    if (!panelState) throw new Error('Parcel properties missing');
    const onParcelRowAction = vi.fn(() => ({ applied: true }));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <SurveyCadPropertiesPanel
          panelState={panelState}
          dock="right"
          dockOffsetPx={0}
          floatingLeftPx={0}
          floatingTopPx={0}
          collapsed={false}
          onSetDock={() => {}}
          onToggleCollapsed={() => {}}
          onClose={() => {}}
          onSelectEntity={() => {}}
          onEditField={() => ({ applied: true })}
          onParcelRowAction={onParcelRowAction}
        />,
      );
    });
    const unlink = container.querySelector(
      '[data-survey-cad-properties-action^="parcel-unlink:"]',
    ) as HTMLButtonElement;
    expect(unlink).not.toBeNull();
    await act(async () => {
      unlink.click();
    });
    expect(onParcelRowAction).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'parcel-unlink' }),
    );
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe('Phase 19D bounded Network ribbon subgroup', () => {
  it('renders the bounded buttons and a secondary split for Unlink', async () => {
    const startCommand = vi.fn(() => true);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <CadParcelNetworkRibbonGroup
          snapshot={baseSnapshot()}
          actions={shellActions({ startCommand })}
        />,
      );
    });
    expect(container.querySelector('[data-cad-parcel-network="PARCELDESIGNATE"]')).not.toBeNull();
    expect(container.querySelector('[data-cad-parcel-network="PARCELNUMBER"]')).not.toBeNull();
    expect(container.querySelector('[data-cad-parcel-network="PARCELLINK"]')).not.toBeNull();
    expect(container.querySelector('[data-cad-parcel-network="PARCELCHECK"]')).not.toBeNull();
    // Secondary command is hidden until the caret opens.
    expect(container.querySelector('[data-cad-parcel-network="PARCELUNLINK"]')).toBeNull();
    await act(async () => {
      (container.querySelector('[data-cad-parcel-network-caret="PARCELLINK"]') as HTMLButtonElement).click();
    });
    const unlink = container.querySelector('[data-cad-parcel-network="PARCELUNLINK"]') as HTMLButtonElement;
    expect(unlink).not.toBeNull();
    await act(async () => {
      unlink.click();
    });
    expect(startCommand).toHaveBeenCalledWith('PARCELUNLINK');
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('does not duplicate network commands in the generic Parcel ribbon loop', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <CadRibbon
          snapshot={baseSnapshot()}
          actions={shellActions()}
          collapsed={false}
          onToggleCollapsed={() => {}}
        />,
      );
    });
    for (const key of NETWORK_KEYS) {
      // Network commands only ride the bounded subgroup, never the generic loop.
      expect(container.querySelectorAll(`[data-cad-command="${key}"]`)).toHaveLength(0);
    }
    for (const key of ['PARCELDESIGNATE', 'PARCELNUMBER', 'PARCELLINK', 'PARCELCHECK']) {
      expect(container.querySelectorAll(`[data-cad-parcel-network="${key}"]`)).toHaveLength(1);
    }
    // Secondary commands stay behind the split carets; Shared Edit is contextual.
    expect(container.querySelectorAll('[data-cad-parcel-network="PARCELUNLINK"]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-cad-parcel-network="PARCELSHAREDEDIT"]')).toHaveLength(0);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe('Phase 19D parcel designation centre label', () => {
  it('prefixes the designation without changing legacy parcel labels', () => {
    const { project, parcelAId } = buildParcelNetworkProject();
    const scene = buildCadDisplayScene(project);
    const label = scene.primitives.find(
      (primitive) =>
        primitive.kind === 'text' && primitive.id === `primitive:${parcelAId}:parcel-label`,
    );
    if (label?.kind !== 'text') throw new Error('Parcel label missing');
    expect(label.text.split('\n')[0]).toBe('LOT 24-1');
    expect(label.text).toContain('100.000 m²');
  });
});

describe('Phase 19D fix wave F1/F2: network sessions commit through engine commands', () => {
  const submitNetwork = (
    project: CadProject,
    session: CommandSession,
    selectedParcelEntityIds: string[] = [],
  ): { handled: boolean; history: CadHistoryState; nextSession: CommandSession | null | undefined } => {
    let history = createCadHistoryState(project);
    let nextSession: CommandSession | null | undefined;
    const handled = handleSurveyCadParcelNetworkSubmit({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      replaceSession: (next) => {
        nextSession = next;
      },
      session,
      project: history.present.project,
      selectedParcelEntityIds,
    });
    return { handled, history, nextSession };
  };

  it('PARCELDESIGNATE starter session commits designation/role/description', () => {
    const { project, parcelBId } = buildParcelNetworkProject();
    const { handled, history, nextSession } = submitNetwork(
      project,
      { key: 'PARCELDESIGNATE', inputValue: 'Lot 7; lot; New desc', parcelEntityIds: [parcelBId] },
      [parcelBId],
    );
    expect(handled).toBe(true);
    expect(nextSession).toBeNull();
    const parcel = history.present.project.entities.find(
      (entity): entity is CadParcelEntity => entity.id === parcelBId && entity.type === 'parcel',
    )!;
    expect(parcel.planInfo?.designation).toBe('Lot 7');
    expect(parcel.planInfo?.role).toBe('lot');
    expect(parcel.planInfo?.description).toBe('New desc');
  });

  it('PARCELSHAREDEDIT session moves the shared endpoint on both parcels', () => {
    const { project, parcelAId, parcelBId, boundaryId } = buildParcelNetworkProject();
    const { handled, history, nextSession } = submitNetwork(
      project,
      { key: 'PARCELSHAREDEDIT', inputValue: 'from 12,0', linkId: boundaryId },
      [parcelAId, parcelBId],
    );
    expect(handled).toBe(true);
    expect(nextSession).toBeNull();
    for (const id of [parcelAId, parcelBId]) {
      const parcel = history.present.project.entities.find(
        (entity): entity is CadParcelEntity => entity.id === id && entity.type === 'parcel',
      )!;
      // Shared FROM endpoint (10,0) moved to (12,0) on both sides atomically.
      expect(parcel.vertices.some((vertex) => vertex.x === 12 && vertex.y === 0)).toBe(true);
      expect(parcel.vertices.some((vertex) => vertex.x === 10 && vertex.y === 0)).toBe(false);
    }
  });
});
