/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LayerPanel } from '../src/components/surveyCad/LayerPanel';
import {
  nextDeterministicLayerName,
  validateLayerDelete,
  validateLayerRename,
  validateSetCurrent,
} from '../src/components/surveyCad/LayerPanel.guards';
import { DEFAULT_CAD_LAYERS, GENERAL_CAD_LAYER_ID } from '../src/engine/cad/cadLayers';
import { resolveCurrentCadLayerId } from '../src/engine/cad/cadLayers';
import { DEFAULT_CAD_STYLE_LIBRARY } from '../src/engine/cad/cadStyles';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { buildCadProjectSignature } from '../src/engine/cad/cadProjectState';
import { createCadHistoryState, runCadCommand, undoCadHistory } from '../src/engine/cad/cadUndoRedo';
import { loadShellLayout, saveShellLayout } from '../src/cad-app/shell/useCadShellLayout';
import type { CadLayer } from '../src/engine/cad/cadTypes';

const lineTypes = DEFAULT_CAD_STYLE_LIBRARY.lineTypes;

const render = async (node: ReactNode): Promise<{ container: HTMLElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  return { container, root };
};

const cleanup = async (container: HTMLElement, root: Root): Promise<void> => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
};

const click = async (element: Element | null): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('phase 18C layer manager guards', () => {
  it('names new layers deterministically (first free LayerN)', () => {
    expect(nextDeterministicLayerName(DEFAULT_CAD_LAYERS)).toBe('Layer1');
    const taken: CadLayer[] = [
      ...DEFAULT_CAD_LAYERS,
      { id: 'x1', name: 'Layer1', color: '#fff', visible: true, locked: false, role: 'planning' },
      { id: 'x2', name: 'layer2', color: '#fff', visible: true, locked: false, role: 'planning' },
    ];
    expect(nextDeterministicLayerName(taken)).toBe('Layer3');
  });

  it('blocks renaming the General layer and duplicate names', () => {
    expect(validateLayerRename(DEFAULT_CAD_LAYERS, GENERAL_CAD_LAYER_ID, 'Other')).toContain('cannot be renamed');
    expect(validateLayerRename(DEFAULT_CAD_LAYERS, 'points', 'Control Points')).toContain('already exists');
    expect(validateLayerRename(DEFAULT_CAD_LAYERS, 'points', '  ')).toContain('cannot be empty');
    expect(validateLayerRename(DEFAULT_CAD_LAYERS, 'points', 'Fresh')).toBeNull();
  });

  it('blocks deleting general, current, and populated layers with counts', () => {
    const counts = { points: 3 };
    expect(validateLayerDelete(DEFAULT_CAD_LAYERS, counts, 'points', GENERAL_CAD_LAYER_ID)).toContain('cannot be deleted');
    expect(validateLayerDelete(DEFAULT_CAD_LAYERS, counts, 'points', 'points')).toContain('current layer');
    expect(validateLayerDelete(DEFAULT_CAD_LAYERS, counts, 'general', 'points')).toContain('3 objects');
    expect(validateLayerDelete(DEFAULT_CAD_LAYERS, {}, 'general', 'parcels')).toBeNull();
  });

  it('guards set-current: off/frozen blocked, locked allowed', () => {
    expect(validateSetCurrent(DEFAULT_CAD_LAYERS, 'nope')).toContain('no longer exists');
    const off: CadLayer[] = [{ ...DEFAULT_CAD_LAYERS[0]!, visible: false }];
    expect(validateSetCurrent(off, off[0]!.id)).toContain('is off');
    const frozen: CadLayer[] = [{ ...DEFAULT_CAD_LAYERS[0]!, frozen: true }];
    expect(validateSetCurrent(frozen, frozen[0]!.id)).toContain('is frozen');
    const locked: CadLayer[] = [{ ...DEFAULT_CAD_LAYERS[0]!, locked: true }];
    expect(validateSetCurrent(locked, locked[0]!.id)).toBeNull();
  });

  it('falls back to general when the current layer is missing', () => {
    expect(resolveCurrentCadLayerId({ layers: DEFAULT_CAD_LAYERS })).toBe(GENERAL_CAD_LAYER_ID);
    expect(
      resolveCurrentCadLayerId({ layers: DEFAULT_CAD_LAYERS, currentLayerId: 'deleted' }),
    ).toBe(GENERAL_CAD_LAYER_ID);
    expect(
      resolveCurrentCadLayerId({ layers: DEFAULT_CAD_LAYERS, currentLayerId: 'points' }),
    ).toBe('points');
  });
});

describe('phase 18C layer manager panel', () => {
  it('creates with deterministic naming through LAYER_CREATE', async () => {
    const onLayerCommand = vi.fn();
    const { container, root } = await render(
      <LayerPanel
        layers={DEFAULT_CAD_LAYERS}
        currentLayerId={GENERAL_CAD_LAYER_ID}
        lineTypes={lineTypes}
        entityCounts={{}}
        onLayerCommand={onLayerCommand}
        onSetCurrent={() => {}}
      />,
    );
    await click(container.querySelector('[aria-label="Create layer"]'));
    expect(onLayerCommand).toHaveBeenCalledWith({ key: 'LAYER_CREATE', name: 'Layer1' });
    await cleanup(container, root);
  });

  it('blocks deleting the current layer with a message and no dispatch', async () => {
    const onLayerCommand = vi.fn();
    const { container, root } = await render(
      <LayerPanel
        layers={DEFAULT_CAD_LAYERS}
        currentLayerId="points"
        lineTypes={lineTypes}
        entityCounts={{}}
        onLayerCommand={onLayerCommand}
        onSetCurrent={() => {}}
      />,
    );
    await click(container.querySelector('[aria-label="Delete layer Survey Points"]'));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('current layer');
    expect(onLayerCommand).not.toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('blocks deleting a populated layer with the object count', async () => {
    const onLayerCommand = vi.fn();
    const { container, root } = await render(
      <LayerPanel
        layers={DEFAULT_CAD_LAYERS}
        currentLayerId={GENERAL_CAD_LAYER_ID}
        lineTypes={lineTypes}
        entityCounts={{ parcels: 2 }}
        onLayerCommand={onLayerCommand}
        onSetCurrent={() => {}}
      />,
    );
    await click(container.querySelector('[aria-label="Delete layer Parcels"]'));
    expect(container.querySelector('[role="status"]')?.textContent).toContain('2 objects');
    expect(onLayerCommand).not.toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('two-click delete dispatches LAYER_DELETE for an empty non-current layer', async () => {
    const onLayerCommand = vi.fn();
    const { container, root } = await render(
      <LayerPanel
        layers={DEFAULT_CAD_LAYERS}
        currentLayerId={GENERAL_CAD_LAYER_ID}
        lineTypes={lineTypes}
        entityCounts={{}}
        onLayerCommand={onLayerCommand}
        onSetCurrent={() => {}}
      />,
    );
    await click(container.querySelector('[aria-label="Delete layer Parcels"]'));
    expect(onLayerCommand).not.toHaveBeenCalled();
    await click(container.querySelector('[aria-label="Confirm delete layer Parcels"]'));
    expect(onLayerCommand).toHaveBeenCalledWith({ key: 'LAYER_DELETE', layerId: 'parcels' });
    await cleanup(container, root);
  });

  it('routes set-current and color edits through transactions', async () => {
    const onLayerCommand = vi.fn();
    const onSetCurrent = vi.fn();
    const { container, root } = await render(
      <LayerPanel
        layers={DEFAULT_CAD_LAYERS}
        currentLayerId={GENERAL_CAD_LAYER_ID}
        lineTypes={lineTypes}
        entityCounts={{}}
        onLayerCommand={onLayerCommand}
        onSetCurrent={onSetCurrent}
      />,
    );
    await act(async () => {
      (container.querySelector('[aria-label="Set current layer Survey Points"]') as HTMLInputElement).click();
    });
    expect(onSetCurrent).toHaveBeenCalledWith('points');
    const color = container.querySelector('[aria-label="Color for layer Survey Points"]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(color, '#ff0000');
      color.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onLayerCommand).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'LAYER_COLOR', layerId: 'points' }),
    );
    await cleanup(container, root);
  });
});

describe('phase 18C layer transactions keep undo; LWT never dirties', () => {
  it('LAYER_COLOR commits and undoes without touching selection history', () => {
    const project = createBlankCadDrawingDocument({ units: 'm' }).project;
    let history = createCadHistoryState(project);
    const before = history.present.project.layers.find((layer) => layer.id === GENERAL_CAD_LAYER_ID)?.color;
    history = runCadCommand(history, { key: 'LAYER_COLOR', layerId: GENERAL_CAD_LAYER_ID, color: '#ff0000' });
    expect(history.present.project.layers.find((layer) => layer.id === GENERAL_CAD_LAYER_ID)?.color).toBe('#ff0000');
    expect(history.undoStack).toHaveLength(1);
    history = undoCadHistory(history);
    expect(history.present.project.layers.find((layer) => layer.id === GENERAL_CAD_LAYER_ID)?.color).toBe(before);
  });

  it('LAYER_SET_CURRENT guards exist at dispatch: unknown layers reject', () => {
    const project = createBlankCadDrawingDocument({ units: 'm' }).project;
    const history = createCadHistoryState(project);
    const rejected = runCadCommand(history, { key: 'LAYER_SET_CURRENT', layerId: 'missing' });
    expect(rejected).toBe(history);
    const applied = runCadCommand(history, { key: 'LAYER_SET_CURRENT', layerId: GENERAL_CAD_LAYER_ID });
    expect(applied.present.project.currentLayerId).toBe(GENERAL_CAD_LAYER_ID);
  });

  it('LWT toggle persists to shell chrome only — the drawing signature never moves', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string): string | null => store.get(key) ?? null,
      setItem: (key: string, value: string): void => void store.set(key, value),
      removeItem: (key: string): void => void store.delete(key),
    };
    expect(loadShellLayout(storage).lineweightDisplay).toBe(false);
    const project = createBlankCadDrawingDocument({ units: 'm' }).project;
    const signature = buildCadProjectSignature(project);
    saveShellLayout(storage, { ...loadShellLayout(storage), lineweightDisplay: true });
    expect(loadShellLayout(storage).lineweightDisplay).toBe(true);
    // The drawing is untouched: toggling LWT cannot dirty it.
    expect(buildCadProjectSignature(project)).toBe(signature);
    // …while a real layer mutation does move the signature (dirty-relevant).
    const history = runCadCommand(createCadHistoryState(project), {
      key: 'LAYER_COLOR',
      layerId: GENERAL_CAD_LAYER_ID,
      color: '#123456',
    });
    expect(buildCadProjectSignature(history.present.project)).not.toBe(signature);
  });
});
