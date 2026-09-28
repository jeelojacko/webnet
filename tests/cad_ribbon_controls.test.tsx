/** @vitest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CadRibbonSplitButton } from '../src/cad-app/shell/CadRibbonSplitButton';
import {
  findCadRibbonToolFamily,
  type CadRibbonToolFamily,
} from '../src/cad-app/shell/cadRibbonToolFamilies';
import {
  isCadRibbonToolFamilyActive,
  useCadToolFamilyState,
} from '../src/cad-app/shell/useCadToolFamilyState';
import { executeShellCommand, resolveShellCommandText } from '../src/cad-app/shell/cadCommandRegistry';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

const family = (id: string): CadRibbonToolFamily => {
  const found = findCadRibbonToolFamily(id);
  if (found == null) throw new Error(`missing family ${id}`);
  return found;
};

const stubActions = (): CadShellActions =>
  ({ startCommand: vi.fn(() => true) } as unknown as CadShellActions);

const stubSnapshot = (availableCommands: string[]): CadWorkspaceSnapshot =>
  ({ availableCommands } as unknown as CadWorkspaceSnapshot);

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

const keyDown = async (element: Element | null, key: string): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

interface SplitHarnessProps {
  toolFamily: CadRibbonToolFamily;
  snapshot: CadWorkspaceSnapshot;
  actions: CadShellActions;
  initialVariantId: string;
  onSelectVariant?: (_variantId: string) => void;
}

const SplitHarness: React.FC<SplitHarnessProps> = ({
  toolFamily,
  snapshot,
  actions,
  initialVariantId,
  onSelectVariant,
}) => {
  const [currentVariantId, setCurrentVariantId] = useState(initialVariantId);
  return (
    <CadRibbonSplitButton
      family={toolFamily}
      currentVariantId={currentVariantId}
      snapshot={snapshot}
      actions={actions}
      onSelectVariant={(variantId) => {
        setCurrentVariantId(variantId);
        onSelectVariant?.(variantId);
      }}
    />
  );
};

const arcKeys = ['ARC_3PT', 'ARC_SCE', 'ARC_SCA', 'ARC_SCL', 'ARC_SEA', 'ARC_SED', 'ARC_SER', 'ARC_CSE', 'ARC_CSA', 'ARC_CSL', 'CONTINUE_CURVE'];

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('phase 21A split button (§79 A–J)', () => {
  it('A: primary click runs the selected variant', async () => {
    const actions = stubActions();
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={actions} initialVariantId="arc-3pt" />,
    );
    await click(container.querySelector('.cad-ribbon-split__primary'));
    expect(actions.startCommand).toHaveBeenCalledWith('ARC_3PT');
    expect(container.querySelector('[data-cad-ribbon-flyout]')).toBeNull();
    await cleanup(container, root);
  });

  it('B: caret click only opens the flyout and does not run', async () => {
    const actions = stubActions();
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={actions} initialVariantId="arc-3pt" />,
    );
    await click(container.querySelector('[data-cad-family-caret="arc"]'));
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).not.toBeNull();
    expect(actions.startCommand).not.toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('C+D: choosing an available variant sticks and repeat runs the new variant', async () => {
    const actions = stubActions();
    const onSelectVariant = vi.fn();
    const { container, root } = await render(
      <SplitHarness
        toolFamily={family('arc')}
        snapshot={stubSnapshot(arcKeys)}
        actions={actions}
        initialVariantId="arc-3pt"
        onSelectVariant={onSelectVariant}
      />,
    );
    await click(container.querySelector('[data-cad-family-caret="arc"]'));
    await click(container.querySelector('[data-cad-variant="arc-sce"]'));
    expect(onSelectVariant).toHaveBeenCalledWith('arc-sce');
    expect(actions.startCommand).toHaveBeenLastCalledWith('ARC_SCE');
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).toBeNull();
    const primary = container.querySelector('.cad-ribbon-split__primary') as HTMLButtonElement;
    expect(primary.getAttribute('data-cad-command')).toBe('ARC_SCE');
    await click(primary);
    expect(actions.startCommand).toHaveBeenLastCalledWith('ARC_SCE');
    expect(actions.startCommand).toHaveBeenCalledTimes(2);
    await cleanup(container, root);
  });

  it('E+F: a planned row does nothing and never becomes current', async () => {
    const actions = stubActions();
    const onSelectVariant = vi.fn();
    const { container, root } = await render(
      <SplitHarness
        toolFamily={family('line')}
        snapshot={stubSnapshot(['LINE'])}
        actions={actions}
        initialVariantId="line-create"
        onSelectVariant={onSelectVariant}
      />,
    );
    await click(container.querySelector('[data-cad-family-caret="line"]'));
    const planned = container.querySelector('[data-cad-variant="line-by-bearing"]') as HTMLButtonElement;
    expect(planned?.getAttribute('aria-disabled')).toBe('true');
    expect(planned?.getAttribute('title')).toBe('Not implemented yet');
    await click(planned);
    expect(actions.startCommand).not.toHaveBeenCalled();
    expect(onSelectVariant).not.toHaveBeenCalled();
    expect(
      container.querySelector('.cad-ribbon-split__primary')?.getAttribute('data-cad-command'),
    ).toBe('LINE');
    await cleanup(container, root);
  });

  it('G: Escape closes the flyout', async () => {
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={stubActions()} initialVariantId="arc-3pt" />,
    );
    await click(container.querySelector('[data-cad-family-caret="arc"]'));
    await keyDown(document.activeElement, 'Escape');
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).toBeNull();
    await cleanup(container, root);
  });

  it('H: outside click closes the flyout', async () => {
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={stubActions()} initialVariantId="arc-3pt" />,
    );
    await click(container.querySelector('[data-cad-family-caret="arc"]'));
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).toBeNull();
    await cleanup(container, root);
  });

  it('I: keyboard opens with Enter, navigates with arrows, and chooses with Enter', async () => {
    const actions = stubActions();
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={actions} initialVariantId="arc-3pt" />,
    );
    await keyDown(container.querySelector('[data-cad-family-caret="arc"]'), 'Enter');
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).not.toBeNull();
    // Focus starts on the current variant, then moves to the next row.
    await keyDown(document.activeElement, 'ArrowDown');
    expect((document.activeElement as HTMLElement).getAttribute('data-cad-variant')).toBe('arc-sce');
    await keyDown(document.activeElement, 'Enter');
    expect(actions.startCommand).toHaveBeenCalledWith('ARC_SCE');
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).toBeNull();
    await cleanup(container, root);
  });

  it('returns focus to the caret after choosing and hands off via onAfterExecute', async () => {
    const onAfterExecute = vi.fn();
    const { container, root } = await render(
      <CadRibbonSplitButton
        family={family('arc')}
        currentVariantId="arc-3pt"
        snapshot={stubSnapshot(arcKeys)}
        actions={stubActions()}
        onSelectVariant={vi.fn()}
        onAfterExecute={onAfterExecute}
      />,
    );
    await click(container.querySelector('[data-cad-family-caret="arc"]'));
    await click(container.querySelector('[data-cad-variant="arc-sca"]'));
    expect((document.activeElement as HTMLElement).getAttribute('data-cad-family-caret')).toBe('arc');
    expect(onAfterExecute).toHaveBeenCalledTimes(1);
    await cleanup(container, root);
  });

  it('J: availability disables the primary and keyed-but-unavailable rows', async () => {
    const actions = stubActions();
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot([])} actions={actions} initialVariantId="arc-3pt" />,
    );
    const primary = container.querySelector('.cad-ribbon-split__primary') as HTMLButtonElement;
    expect(primary.disabled).toBe(true);
    // Caret still opens so the user can inspect the family.
    await click(container.querySelector('[data-cad-family-caret="arc"]'));
    const row = container.querySelector('[data-cad-variant="arc-sce"]') as HTMLButtonElement;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    await click(row);
    expect(actions.startCommand).not.toHaveBeenCalled();
    await cleanup(container, root);
  });

  it('marks the family active when any mapped variant is the running command', () => {
    expect(isCadRibbonToolFamilyActive(family('arc'), 'ARC_SCE')).toBe(true);
    expect(isCadRibbonToolFamilyActive(family('arc'), 'LINE')).toBe(false);
    expect(isCadRibbonToolFamilyActive(family('arc'), null)).toBe(false);
    // Planned families have no mapped key, so they never show active.
    expect(isCadRibbonToolFamilyActive(family('circle'), 'ARC_SCE')).toBe(false);
  });
});

describe('phase 21A sticky/reset state (§81)', () => {
  const ResetHarness: React.FC<{ drawingId: string }> = ({ drawingId }) => {
    const state = useCadToolFamilyState({ drawingId });
    const [, setNoise] = useState(0);
    const arc = state.resolveVariant('arc');
    return (
      <div>
        <span data-cad-current-arc={arc?.commandKey ?? 'none'} />
        <button data-cad-test="select-sce" onClick={() => state.selectVariant('arc', 'arc-sce')} />
        <button data-cad-test="select-sca" onClick={() => state.selectVariant('arc', 'arc-sca')} />
        <button data-cad-test="tab" onClick={() => setNoise((value) => value + 1)} />
        <button data-cad-test="save" onClick={() => state.notifyDrawingLifecycle('cad-saved')} />
        <button data-cad-test="new" onClick={() => state.notifyDrawingLifecycle('cad-created')} />
        <button data-cad-test="open" onClick={() => state.notifyDrawingLifecycle('cad-opened')} />
      </div>
    );
  };

  const currentArc = (container: HTMLElement): string | null =>
    container.querySelector('[data-cad-current-arc]')?.getAttribute('data-cad-current-arc') ?? null;

  it('runs the full 12-step New/Open reset sequence', async () => {
    const { container, root } = await render(<ResetHarness drawingId="d1" />);
    // 1. default
    expect(currentArc(container)).toBe('ARC_3PT');
    // 2. select Start/Center/End
    await click(container.querySelector('[data-cad-test="select-sce"]'));
    // 3. primary now ARC_SCE
    expect(currentArc(container)).toBe('ARC_SCE');
    // 4. switch tabs (plain rerender)
    await click(container.querySelector('[data-cad-test="tab"]'));
    // 5. unchanged
    expect(currentArc(container)).toBe('ARC_SCE');
    // 6. save (cad-saved must NOT reset)
    await click(container.querySelector('[data-cad-test="save"]'));
    // 7. unchanged
    expect(currentArc(container)).toBe('ARC_SCE');
    // 8. New Drawing
    await click(container.querySelector('[data-cad-test="new"]'));
    // 9. reset
    expect(currentArc(container)).toBe('ARC_3PT');
    // 10. select another
    await click(container.querySelector('[data-cad-test="select-sca"]'));
    expect(currentArc(container)).toBe('ARC_SCA');
    // 11. Open Drawing
    await click(container.querySelector('[data-cad-test="open"]'));
    // 12. reset
    expect(currentArc(container)).toBe('ARC_3PT');

    // Same-id New/Open reset proves the shell-local lifecycle generation; a
    // real drawingId change must reset too.
    await click(container.querySelector('[data-cad-test="select-sce"]'));
    expect(currentArc(container)).toBe('ARC_SCE');
    await act(async () => {
      root.render(<ResetHarness drawingId="d2" />);
    });
    expect(currentArc(container)).toBe('ARC_3PT');
    await cleanup(container, root);
  });

  it('does not move the sticky face when a variant is invoked by typed alias', async () => {
    const actions = stubActions();
    const { container, root } = await render(<ResetHarness drawingId="d1" />);
    const def = resolveShellCommandText('ARC_SCE');
    expect(def).not.toBeNull();
    await act(async () => {
      executeShellCommand(def!, actions, stubSnapshot(arcKeys));
    });
    // Command ran, but the ribbon face stays on the default variant.
    expect(actions.startCommand).toHaveBeenCalledWith('ARC_SCE');
    expect(currentArc(container)).toBe('ARC_3PT');
    await cleanup(container, root);
  });

  it('ignores planned selections', async () => {
    const Probe: React.FC = () => {
      const [, setNoise] = useState(0);
      const state = useCadToolFamilyState({ drawingId: 'd1' });
      const circle = state.resolveVariant('circle');
      return (
        <div>
          <span data-cad-circle={circle?.id ?? 'none'} />
          <button data-cad-test="noop" onClick={() => setNoise((value) => value + 1)} />
          <button data-cad-test="pick-planned" onClick={() => state.selectVariant('circle', 'circle-3point')} />
        </div>
      );
    };
    const { container, root } = await render(<Probe />);
    const circleId = (): string | null =>
      container.querySelector('[data-cad-circle]')?.getAttribute('data-cad-circle') ?? null;
    expect(circleId()).toBe('circle-center-radius');
    await click(container.querySelector('[data-cad-test="pick-planned"]'));
    expect(circleId()).toBe('circle-center-radius');
    await cleanup(container, root);
  });
});
