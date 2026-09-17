/** @vitest-environment jsdom */

import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CadLayer, CadSnapKind } from '../src/engine/cad/cadTypes';
import type { DraftSheet } from '../src/engine/cad/cadDraftTypes';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import { createCadShellLink, type CadShellLink } from '../src/cad-app/shell/cadShellLink';
import { CadToolspace } from '../src/cad-app/shell/CadToolspace';
import { CadPropertiesPalette } from '../src/cad-app/shell/CadPropertiesPalette';
import { CadLayerPalette } from '../src/cad-app/shell/CadLayerPalette';
import { CadCommandDock } from '../src/cad-app/shell/CadCommandDock';
import { CadStatusBar } from '../src/cad-app/shell/CadStatusBar';
import { CadDrawingTabs, CadModelLayoutTabs } from '../src/cad-app/shell/CadDrawingTabs';
import { CadMenuBar } from '../src/cad-app/shell/CadMenuBar';
import { CadRibbon } from '../src/cad-app/shell/CadRibbon';
import { CadDockPanel } from '../src/cad-app/shell/CadDockLayout';
import { DEFAULT_SHELL_LAYOUT, type CadShellLayoutController } from '../src/cad-app/shell/useCadShellLayout';

const SNAP_KINDS: CadSnapKind[] = [
  'point-node', 'endpoint', 'midpoint', 'center', 'arc-midpoint', 'quadrant',
  'intersection', 'apparent-intersection', 'extension', 'perpendicular',
  'parallel', 'direction', 'tangent', 'nearest',
];

const snapPrefs = (enabled: CadSnapKind[] = []): CadWorkspaceSnapshot['snapPreferences'] =>
  Object.fromEntries(SNAP_KINDS.map((kind) => [kind, enabled.includes(kind)])) as CadWorkspaceSnapshot['snapPreferences'];

const stubSnapshot = (overrides: Partial<CadWorkspaceSnapshot> = {}): CadWorkspaceSnapshot =>
  ({
    drawingId: 'd1',
    drawingName: 'Shell-Test',
    units: 'm',
    entityCount: 3,
    selectionCount: 0,
    selectedEntityIds: [],
    selectionPreview: [],
    layers: [
      { id: 'l1', name: 'Points', color: '#ffffff', visible: true, locked: false, printable: true, role: 'points' },
      { id: 'l2', name: 'Parcels', color: '#ff0000', visible: false, locked: true, role: 'parcels' },
    ] as CadLayer[],
    layerEntityCounts: { l1: 2, l2: 1 },
    sheets: [{ id: 's1', name: 'A-101' }] as DraftSheet[],
    properties: null,
    activeCommandKey: null,
    commandPrompt: 'Idle — type a command.',
    commandInputValue: '',
    canUndo: false,
    canRedo: false,
    historyDepth: 0,
    redoDepth: 0,
    snapPreferences: snapPrefs(['endpoint']),
    snapStatusText: 'SNAP: endpoint',
    stationCount: 0,
    dependencyStatus: 'MANUAL_ONLY',
    availableCommands: ['LINE', 'PLINE', 'MOVE', 'COPY', 'TRIM', 'EXTEND'],
    ...overrides,
  }) as CadWorkspaceSnapshot;

const stubActions = (): CadShellActions => ({
  startCommand: vi.fn(() => true),
  undo: vi.fn(),
  redo: vi.fn(),
  selectAll: vi.fn(),
  clearSelection: vi.fn(),
  eraseSelection: vi.fn(),
  selectEntities: vi.fn(),
  editField: vi.fn(() => true),
  setLayerPatch: vi.fn(),
  createLayer: vi.fn(),
  deleteLayer: vi.fn(),
  setSnapPreference: vi.fn(),
  newDrawing: vi.fn(),
  openDrawingFile: vi.fn(),
  saveDrawing: vi.fn(),
  toggleDraftingPanel: vi.fn(),
  toggleExportCenter: vi.fn(),
  cancelCommand: vi.fn(),
  confirmCommandInput: vi.fn(),
});

const stubLayout = (): CadShellLayoutController =>
  ({
    layout: DEFAULT_SHELL_LAYOUT,
    setSidePanel: vi.fn(),
    movePanel: vi.fn(),
    setSideWidth: vi.fn(),
    setCommandHeight: vi.fn(),
    setToolspaceTab: vi.fn(),
    setRibbonCollapsed: vi.fn(),
    resetWorkspace: vi.fn(),
    activeLayout: 'MODEL',
    setActiveLayout: vi.fn(),
  }) as unknown as CadShellLayoutController;

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

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const keyDown = async (input: HTMLInputElement, key: string): Promise<void> => {
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

beforeEach(() => {
  window.localStorage.clear();
});

describe('cad shell panels', () => {
  it('Toolspace renders layers, sheets, and selection with empty states', async () => {
    const actions = stubActions();
    const snapshot = stubSnapshot({
      selectionCount: 1,
      selectedEntityIds: ['e1'],
      selectionPreview: [{ id: 'e1', type: 'line', label: 'Line L1' }],
    });
    const { container, root } = await render(
      <CadToolspace snapshot={snapshot} actions={actions} tab="prospector" onTabChange={() => {}} />,
    );
    expect(container.textContent).toContain('Points');
    expect(container.textContent).toContain('A-101');
    expect(container.textContent).toContain('Line L1');
    await click(container.querySelector('.cad-shell-tree-node'));
    expect(actions.selectEntities).toHaveBeenCalledWith(['e1']);

    const empty = stubSnapshot({ selectionCount: 0, sheets: [] as DraftSheet[] });
    const second = await render(
      <CadToolspace snapshot={empty} actions={actions} tab="prospector" onTabChange={() => {}} />,
    );
    expect(second.container.textContent).toContain('Nothing selected');
    expect(second.container.textContent).toContain('No sheets');
    await cleanup(container, root);
    await cleanup(second.container, second.root);
  });

  it('Toolspace survey tab is honest about missing sources', async () => {
    const { container, root } = await render(
      <CadToolspace snapshot={stubSnapshot()} actions={stubActions()} tab="survey" onTabChange={() => {}} />,
    );
    expect(container.textContent).toContain('No adjustment source imported');
    await cleanup(container, root);
  });

  it('Properties shows a drawing summary with no selection', async () => {
    const { container, root } = await render(
      <CadPropertiesPalette snapshot={stubSnapshot()} actions={stubActions()} />,
    );
    expect(container.querySelector('[data-cad-properties="none"]')).not.toBeNull();
    expect(container.textContent).toContain('Shell-Test');
    await cleanup(container, root);
  });

  it('Properties edits a single entity through the transaction path', async () => {
    const actions = stubActions();
    const snapshot = stubSnapshot({
      selectionCount: 1,
      properties: {
        mode: 'single',
        entity: {
          entityId: 'e1',
          entityType: 'survey-point',
          entityTypeLabel: 'Point',
          entityLabel: 'Point P1',
          properties: [
            { key: 'name', label: 'Name', value: 'P1', editableField: { kind: 'entity-name' } },
            { key: 'layer', label: 'Layer', value: 'Points' },
          ],
        },
      },
    });
    const { container, root } = await render(<CadPropertiesPalette snapshot={snapshot} actions={actions} />);
    expect(container.querySelector('[data-cad-properties="single"]')).not.toBeNull();
    const input = container.querySelector('input[aria-label="Name"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await act(async () => {
      setInputValue(input, 'P2');
    });
    await keyDown(input, 'Enter');
    expect(actions.editField).toHaveBeenCalledWith('e1', { kind: 'entity-name' }, 'P2');
    await cleanup(container, root);
  });

  it('Properties multi shows common rows and *VARIES* for differing values', async () => {
    const snapshot = stubSnapshot({
      selectionCount: 2,
      properties: {
        mode: 'multi',
        groups: [
          {
            typeKey: 'line',
            typeLabel: 'Lines',
            entities: [
              {
                entityId: 'e1', entityType: 'line', entityTypeLabel: 'Line', entityLabel: 'L1',
                properties: [
                  { key: 'layer', label: 'Layer', value: 'Points' },
                  { key: 'len', label: 'Length', value: '10.000' },
                ],
              },
              {
                entityId: 'e2', entityType: 'line', entityTypeLabel: 'Line', entityLabel: 'L2',
                properties: [
                  { key: 'layer', label: 'Layer', value: 'Parcels' },
                  { key: 'len', label: 'Length', value: '10.000' },
                ],
              },
            ],
          },
        ],
        defaultTypeKey: 'line',
        defaultEntityId: 'e1',
      },
    });
    const { container, root } = await render(
      <CadPropertiesPalette snapshot={snapshot} actions={stubActions()} />,
    );
    expect(container.querySelector('[data-cad-properties="multi"]')).not.toBeNull();
    // Common rows survive; differing Layer shows the varies marker.
    expect(container.textContent).toContain('*VARIES*');
    expect(container.textContent).toContain('10.000');
    await cleanup(container, root);
  });

  it('Layer palette toggles visibility and carries the active-layer gap note', async () => {
    const actions = stubActions();
    const { container, root } = await render(
      <CadLayerPalette snapshot={stubSnapshot()} actions={actions} />,
    );
    expect(container.querySelector('[data-cad-layers]')).not.toBeNull();
    expect(container.textContent).toContain('No active layer yet');
    const hide = container.querySelector('[aria-label="Hide layer Points"]');
    expect(hide).not.toBeNull();
    await click(hide);
    expect(actions.setLayerPatch).toHaveBeenCalledWith('l1', { visible: false });
    await cleanup(container, root);
  });

  it('Command dock dispatches aliases, reports unknown text, and keeps history', async () => {
    const link = createCadShellLink();
    link.actions = stubActions();
    const { container, root } = await render(
      <CadCommandDock link={link} snapshot={stubSnapshot()} heightPx={148} onResize={() => {}} />,
    );
    expect(container.querySelector('[data-cad-command-prompt]')?.textContent).toContain('Idle');
    const input = container.querySelector('[data-cad-command-input]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'L');
    });
    // Completion lists the LINE command.
    expect(container.querySelector('.cad-shell-command-suggest')?.textContent).toContain('LINE');
    await keyDown(input, 'Enter');
    expect(link.actions!.startCommand).toHaveBeenCalledWith('LINE');
    await act(async () => {
      setInputValue(input, 'BOGUS');
    });
    await keyDown(input, 'Enter');
    expect(container.textContent).toContain('Unknown command');
    expect(container.querySelector('.cad-shell-command-history')?.textContent).toContain('BOGUS');
    await cleanup(container, root);
  });

  it('Command dock Escape clears text first, then cancels the command', async () => {
    const link = createCadShellLink();
    link.actions = stubActions();
    const { container, root } = await render(
      <CadCommandDock link={link} snapshot={stubSnapshot()} heightPx={148} onResize={() => {}} />,
    );
    const input = container.querySelector('[data-cad-command-input]') as HTMLInputElement;
    await act(async () => {
      setInputValue(input, 'L');
    });
    await keyDown(input, 'Escape');
    expect(input.value).toBe('');
    expect(link.actions!.cancelCommand).not.toHaveBeenCalled();
    await keyDown(input, 'Escape');
    expect(link.actions!.cancelCommand).toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('Status bar shows counts, units, layout, and toggles real snap modes', async () => {
    const link: CadShellLink = createCadShellLink();
    link.actions = stubActions();
    const { container, root } = await render(
      <CadStatusBar link={link} snapshot={stubSnapshot()} dirty activeLayout="MODEL" />,
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('3 entities');
    expect(container.textContent).toContain('MODEL');
    await click(container.querySelector('[data-cad-osnap-toggle]'));
    expect(container.querySelector('.cad-shell-snap-menu')).not.toBeNull();
    const boxes = container.querySelectorAll('.cad-shell-snap-menu input[type="checkbox"]');
    await act(async () => {
      (boxes[0] as HTMLInputElement).click();
    });
    expect(link.actions!.setSnapPreference).toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('Drawing tabs show the dirty asterisk and Start tab switching', async () => {
    const onClose = vi.fn();
    const onSelectStart = vi.fn();
    const { container, root } = await render(
      <CadDrawingTabs
        drawingName="Plan-A"
        dirty
        onNewDrawing={() => {}}
        onCloseDrawing={onClose}
        startTab={false}
        onSelectStart={onSelectStart}
      />,
    );
    expect(container.textContent).toContain('Plan-A*');
    await click(container.querySelector('[aria-label="Close drawing"]'));
    expect(onClose).toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('Model/Layout tabs list real sheets and report selection', async () => {
    const onSelect = vi.fn();
    const { container, root } = await render(
      <CadModelLayoutTabs snapshot={stubSnapshot()} activeLayout="MODEL" onSelect={onSelect} />,
    );
    expect(container.textContent).toContain('Model');
    expect(container.textContent).toContain('A-101');
    const tabs = container.querySelectorAll('[role="tab"]');
    await click(tabs[1]);
    expect(onSelect).toHaveBeenCalledWith({ sheetId: 's1' });
    await cleanup(container, root);
  });

  it('Menu dispatches through the registry and disables without a workspace', async () => {
    const actions = stubActions();
    const { container, root } = await render(
      <CadMenuBar snapshot={stubSnapshot()} actions={actions} layout={stubLayout()} onBackToAdjustment={() => {}} />,
    );
    await click(container.querySelector('.cad-shell-menu-trigger'));
    const items = container.querySelectorAll('[role="menuitem"]');
    expect(items.length).toBeGreaterThan(0);
    const saveItem = [...items].find((item) => item.textContent?.includes('Save Drawing'));
    await click(saveItem ?? null);
    expect(actions.saveDrawing).toHaveBeenCalled();

    const second = await render(
      <CadMenuBar snapshot={null} actions={null} layout={stubLayout()} onBackToAdjustment={() => {}} />,
    );
    await click(second.container.querySelector('.cad-shell-menu-trigger'));
    const disabled = second.container.querySelectorAll('[role="menuitem"]:disabled');
    expect(disabled.length).toBeGreaterThan(0);
    await cleanup(container, root);
    await cleanup(second.container, second.root);
  });

  it('Ribbon dispatches session commands with tooltips', async () => {
    const actions = stubActions();
    const { container, root } = await render(
      <CadRibbon snapshot={stubSnapshot()} actions={actions} collapsed={false} onToggleCollapsed={() => {}} />,
    );
    const line = container.querySelector('[data-cad-command="LINE"]') as HTMLButtonElement;
    expect(line?.title).toContain('[L]');
    await click(line);
    expect(actions.startCommand).toHaveBeenCalledWith('LINE');
    await cleanup(container, root);
  });

  it('Dock panel closes and moves via header buttons', async () => {
    const onClose = vi.fn();
    const onMove = vi.fn();
    const { container, root } = await render(
      <CadDockPanel
        panel="layers"
        title="Layers"
        side="left"
        widthPx={264}
        onClose={onClose}
        onMove={onMove}
        onResize={() => {}}
      >
        <span>body</span>
      </CadDockPanel>,
    );
    expect(container.querySelector('[data-cad-panel="layers"]')).not.toBeNull();
    await click(container.querySelector('[aria-label="Close Layers"]'));
    expect(onClose).toHaveBeenCalled();
    await click(container.querySelector('[aria-label="Move Layers"]'));
    expect(onMove).toHaveBeenCalled();
    await cleanup(container, root);
  });
});
