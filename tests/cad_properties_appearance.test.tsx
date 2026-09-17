/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildCadPropertiesPanelState } from '../src/engine/cad/cadProperties';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import {
  CAD_EDIT_LOCKED_REASON,
  describeCadEditBlock,
  editSurveyCadPropertiesField,
} from '../src/hooks/surveyCad/surveyCadPropertiesEdit';
import { CadPropertiesPalette } from '../src/cad-app/shell/CadPropertiesPalette';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';

const pointOn = (layerId: string, id: string): CadEntity =>
  ({
    id,
    type: 'survey-point',
    layerId,
    visible: true,
    locked: false,
    stationId: id.toUpperCase(),
    x: 1,
    y: 2,
    pointClass: 'free',
    source: 'parsed-input',
  }) as CadEntity;

const withEntities = (project: CadProject, entities: CadEntity[]): CadProject => ({
  ...project,
  entities,
});

const editHarness = (project: CadProject): {
  apply: (_entityId: string, _field: Parameters<typeof editSurveyCadPropertiesField>[0]['field'], _value: string) => boolean;
  current: () => CadProject;
  undo: () => void;
} => {
  let history = createCadHistoryState(project);
  return {
    apply: (entityId, field, value): boolean =>
      editSurveyCadPropertiesField({
        entityId,
        field,
        history,
        updateHistory: (updater) => {
          history = updater(history);
        },
        value,
      }).applied,
    current: () => history.present.project,
    undo: () => {
      history = undoCadHistory(history);
    },
  };
};

const render = async (node: ReactNode): Promise<{ container: HTMLElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
};

describe('phase 18C properties appearance rows', () => {
  it('single selection shows Layer (editable) + ByLayer rows with effective values', () => {
    const project = withEntities(createBlankCadDrawingDocument({ units: 'm' }).project, [pointOn('points', 'e1')]);
    const state = buildCadPropertiesPanelState(project, [project.entities[0]!]);
    expect(state?.mode).toBe('single');
    if (state?.mode !== 'single') return;
    const byKey = new Map(state.entity.properties.map((row) => [row.key, row]));
    expect(byKey.get('layer')?.editableField).toEqual({ kind: 'entity-layer' });
    // Survey Points layer color #38bdf8 flows through as the effective value.
    expect(byKey.get('appearance-color')?.value).toBe('ByLayer (#38bdf8)');
    expect(byKey.get('appearance-linetype')?.value).toContain('ByLayer');
    expect(byKey.get('appearance-lineweight')?.value).toBe('ByLayer (0.250 mm)');
    expect(byKey.get('appearance-transparency')?.value).toBe('ByLayer (0%)');
  });

  it('explicit overrides display directly; edits are undoable', () => {
    const base = withEntities(createBlankCadDrawingDocument({ units: 'm' }).project, [pointOn('points', 'e1')]);
    const harness = editHarness(base);
    expect(harness.apply('e1', { kind: 'entity-color' }, '#ff0000')).toBe(true);
    expect(harness.apply('e1', { kind: 'entity-transparency' }, '50%')).toBe(true);
    const edited = harness.current();
    const state = buildCadPropertiesPanelState(edited, [edited.entities[0]!]);
    if (state?.mode !== 'single') throw new Error('expected single');
    const byKey = new Map(state.entity.properties.map((row) => [row.key, row]));
    expect(byKey.get('appearance-color')?.value).toBe('#ff0000');
    expect(byKey.get('appearance-transparency')?.value).toBe('50%');
    harness.undo();
    harness.undo();
    const undone = harness.current();
    expect(undone.entities[0]?.appearance).toBeUndefined();
  });

  it('ByLayer token clears an explicit override; bad values reject', () => {
    const base = withEntities(createBlankCadDrawingDocument({ units: 'm' }).project, [pointOn('points', 'e1')]);
    const harness = editHarness(base);
    expect(harness.apply('e1', { kind: 'entity-color' }, '#ff0000')).toBe(true);
    expect(harness.apply('e1', { kind: 'entity-color' }, 'ByLayer')).toBe(true);
    expect(harness.current().entities[0]?.appearance?.color).toBeUndefined();
    expect(harness.apply('e1', { kind: 'entity-color' }, 'not-a-color')).toBe(false);
    expect(harness.apply('e1', { kind: 'entity-linetype' }, 'no-such-type')).toBe(false);
    expect(harness.apply('e1', { kind: 'entity-lineweight' }, 'chunky')).toBe(false);
    expect(harness.apply('e1', { kind: 'entity-transparency' }, '200%')).toBe(false);
    expect(harness.apply('e1', { kind: 'entity-linetype' }, 'dashed')).toBe(true);
    expect(harness.current().entities[0]?.appearance?.lineTypeId).toBe('dashed');
  });

  it('layer move edits the entity layer and honors locks with LAYER_LOCKED', () => {
    const base = withEntities(createBlankCadDrawingDocument({ units: 'm' }).project, [pointOn('points', 'e1')]);
    const harness = editHarness(base);
    expect(describeCadEditBlock(harness.current(), 'e1')).toBeNull();
    expect(harness.apply('e1', { kind: 'entity-layer' }, 'parcels')).toBe(true);
    expect(harness.current().entities[0]?.layerId).toBe('parcels');
    harness.undo();
    expect(harness.current().entities[0]?.layerId).toBe('points');

    // Locked source layer rejects the move with the stable reason.
    const lockedProject = withEntities(createBlankCadDrawingDocument({ units: 'm' }).project, [pointOn('points', 'e1')]);
    const lockedHistory = runCadCommand(createCadHistoryState(lockedProject), {
      key: 'LAYER_LOCKED',
      layerId: 'points',
      locked: true,
    });
    const lockedHarness = editHarness(lockedHistory.present.project);
    expect(describeCadEditBlock(lockedHarness.current(), 'e1')).toBe(CAD_EDIT_LOCKED_REASON);
    expect(lockedHarness.apply('e1', { kind: 'entity-layer' }, 'parcels')).toBe(false);
    expect(lockedHarness.apply('e1', { kind: 'entity-color' }, '#ff0000')).toBe(false);
    expect(lockedHarness.current().entities[0]?.layerId).toBe('points');

    // Engine gate agrees: the EDIT_ENTITY layer edit is a rejected no-op.
    const rejected = runCadCommand(lockedHistory, {
      key: 'EDIT_ENTITY',
      entityId: 'e1',
      edit: { kind: 'entity-layer', layerId: 'parcels' },
    });
    expect(rejected).toBe(lockedHistory);
  });

  it('multi-select differing colors render *VARIES* in the palette', async () => {
    const base = withEntities(createBlankCadDrawingDocument({ units: 'm' }).project, [
      pointOn('points', 'e1'),
      { ...pointOn('points', 'e2'), appearance: { color: '#ff0000' } },
    ]);
    const properties = buildCadPropertiesPanelState(base, [...base.entities]);
    const snapshot = {
      drawingId: 'd1',
      drawingName: 'T',
      units: 'm',
      entityCount: 2,
      selectionCount: 2,
      selectedEntityIds: ['e1', 'e2'],
      selectionPreview: [],
      layers: base.layers,
      layerEntityCounts: {},
      currentLayerId: 'general',
      lineTypes: base.styleLibrary.lineTypes,
      sheets: [],
      properties,
      activeCommandKey: null,
      commandPrompt: '',
      commandInputValue: '',
      canUndo: false,
      canRedo: false,
      historyDepth: 0,
      redoDepth: 0,
      snapPreferences: {},
      snapStatusText: '',
      stationCount: 0,
      dependencyStatus: '',
      availableCommands: [],
    } as unknown as CadWorkspaceSnapshot;
    const actions = { editField: vi.fn(() => ({ applied: true })) } as unknown as CadShellActions;
    const { container, root } = await render(<CadPropertiesPalette snapshot={snapshot} actions={actions} />);
    expect(container.querySelector('[data-cad-properties="multi"]')).not.toBeNull();
    // Differing Color renders as an empty input with the *VARIES* placeholder.
    const colorInput = container.querySelector('input[aria-label="Color"]') as HTMLInputElement | null;
    expect(colorInput?.getAttribute('placeholder')).toBe('*VARIES*');
    // Common rows (same value everywhere) still render their value.
    expect(container.textContent).toContain('Points — 2 selected');
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('palette surfaces LAYER_LOCKED when a locked-source edit rejects', async () => {
    const base = withEntities(createBlankCadDrawingDocument({ units: 'm' }).project, [pointOn('points', 'e1')]);
    const properties = buildCadPropertiesPanelState(base, [...base.entities]);
    const snapshot = {
      drawingId: 'd1',
      drawingName: 'T',
      units: 'm',
      entityCount: 1,
      selectionCount: 1,
      selectedEntityIds: ['e1'],
      selectionPreview: [],
      layers: base.layers,
      layerEntityCounts: {},
      currentLayerId: 'general',
      lineTypes: base.styleLibrary.lineTypes,
      sheets: [],
      properties,
      activeCommandKey: null,
      commandPrompt: '',
      commandInputValue: '',
      canUndo: false,
      canRedo: false,
      historyDepth: 0,
      redoDepth: 0,
      snapPreferences: {},
      snapStatusText: '',
      stationCount: 0,
      dependencyStatus: '',
      availableCommands: [],
    } as unknown as CadWorkspaceSnapshot;
    const actions = {
      editField: vi.fn(() => ({ applied: false, reason: 'LAYER_LOCKED' })),
    } as unknown as CadShellActions;
    const { container, root } = await render(<CadPropertiesPalette snapshot={snapshot} actions={actions} />);
    const colorInput = container.querySelector('input[aria-label="Color"]') as HTMLInputElement;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(colorInput, '#ff0000');
      colorInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      colorInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(container.textContent).toContain('LAYER_LOCKED');
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
