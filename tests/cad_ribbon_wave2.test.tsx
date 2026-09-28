/** @vitest-environment jsdom */

// Phase 21A Wave 2 — ribbon regroup: one nowrap band per tab, family splits
// on Home Draw, icon grids elsewhere, sticky state resets on New/Open only.
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { CadRibbon } from '../src/cad-app/shell/CadRibbon';
import { useCadToolFamilyState } from '../src/cad-app/shell/useCadToolFamilyState';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

const stubActions = (): CadShellActions =>
  ({ startCommand: () => true } as unknown as CadShellActions);

const stubSnapshot = (): CadWorkspaceSnapshot =>
  ({ drawingId: 'd1', availableCommands: ['LINE', 'ARC_3PT'], activeCommandKey: null, layers: [], currentLayerId: '' } as unknown as CadWorkspaceSnapshot);

const render = async (node: React.ReactNode): Promise<{ container: HTMLElement; root: Root }> => {
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
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const groupLabels = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('.cad-shell-ribbon-groups > .cad-shell-ribbon-group')]
    .map((entry) => entry.getAttribute('aria-label') ?? '');

const tabButton = (container: HTMLElement, name: string): Element | null =>
  [...container.querySelectorAll('[role="tab"]')].find((entry) => entry.textContent === name) ?? null;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('phase 21A wave 2 ribbon regroup', () => {
  it('renders one band per tab with no wrapping container', async () => {
    const Probe: React.FC = () => {
      const familyState = useCadToolFamilyState({ drawingId: 'd1' });
      return <CadRibbon snapshot={stubSnapshot()} actions={stubActions()} familyState={familyState} collapsed={false} onToggleCollapsed={() => {}} />;
    };
    const { container, root } = await render(<Probe />);
    // Exactly one groups strip (one band) on every tab.
    expect(container.querySelectorAll('.cad-shell-ribbon-groups').length).toBe(1);
    expect(groupLabels(container)).toContain('Draw');
    expect(groupLabels(container)).toContain('Modify');
    expect(groupLabels(container)).toContain('Edit');
    // Home Draw carries all eight family splits.
    for (const family of ['line', 'arc', 'circle', 'bestfit', 'curves', 'ellipse', 'shapes', 'hatch']) {
      expect(container.querySelector(`[data-cad-family="${family}"]`), family).not.toBeNull();
    }
    await click(tabButton(container, 'Annotate'));
    expect(container.querySelectorAll('.cad-shell-ribbon-groups').length).toBe(1);
    expect(groupLabels(container)).toEqual(
      expect.arrayContaining(['Text', 'Dimensions', 'Tables', 'Styles']),
    );
    await click(tabButton(container, 'Survey'));
    expect(groupLabels(container)).toEqual(
      expect.arrayContaining(['Survey', 'Transform', 'Field to Finish', 'Tables']),
    );
    await click(tabButton(container, 'Surface'));
    expect(groupLabels(container)).toContain('Build');
    await click(tabButton(container, 'Output'));
    expect(groupLabels(container)).toEqual(['File']);
    expect(container.querySelector('[data-cad-command="SHELL_SAVE"]')).not.toBeNull();
    await cleanup(container, root);
  });

  it('draw dispatch stays registry-only and save never resets families', async () => {
    const Probe: React.FC<{ drawingId: string }> = ({ drawingId }) => {
      const familyState = useCadToolFamilyState({ drawingId });
      return (
        <div>
          <span data-cad-arc={familyState.resolveVariant('arc')?.commandKey ?? 'none'} />
          <button data-cad-test="pick" onClick={() => familyState.selectVariant('arc', 'arc-sce')} />
          <button data-cad-test="save" onClick={() => familyState.notifyDrawingLifecycle('cad-saved')} />
          <button data-cad-test="new" onClick={() => familyState.notifyDrawingLifecycle('cad-created')} />
        </div>
      );
    };
    const { container, root } = await render(<Probe drawingId="d1" />);
    const arc = (): string | null => container.querySelector('[data-cad-arc]')?.getAttribute('data-cad-arc') ?? null;
    await click(container.querySelector('[data-cad-test="pick"]'));
    expect(arc()).toBe('ARC_SCE');
    await click(container.querySelector('[data-cad-test="save"]'));
    expect(arc()).toBe('ARC_SCE');
    await click(container.querySelector('[data-cad-test="new"]'));
    expect(arc()).toBe('ARC_3PT');
    await cleanup(container, root);
  });
});
