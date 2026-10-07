/** @vitest-environment jsdom */

import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CadRibbonSplitButton } from '../src/cad-app/shell/CadRibbonSplitButton';
import { CadRibbonFlyout } from '../src/cad-app/shell/CadRibbonFlyout';
import {
  resolveCadRibbonFlyoutAnchor,
  type CadRibbonFlyoutAnchor,
} from '../src/cad-app/shell/cadRibbonFlyout.anchor';
import {
  CAD_RIBBON_FLYOUT_CARET_GAP_PX,
  CAD_RIBBON_FLYOUT_MAX_WIDTH_PX,
  CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX,
} from '../src/cad-app/shell/cadRibbonFlyout.constants';
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
        toolFamily={family('bestfit')}
        snapshot={stubSnapshot([])}
        actions={actions}
        initialVariantId="bestfit-line"
        onSelectVariant={onSelectVariant}
      />,
    );
    await click(container.querySelector('[data-cad-family-caret="bestfit"]'));
    const planned = container.querySelector('[data-cad-variant="bestfit-arc"]') as HTMLButtonElement;
    expect(planned?.getAttribute('aria-disabled')).toBe('true');
    expect(planned?.getAttribute('title')).toBe('Not implemented yet');
    await click(planned);
    expect(actions.startCommand).not.toHaveBeenCalled();
    expect(onSelectVariant).not.toHaveBeenCalled();
    expect(
      container.querySelector('.cad-ribbon-split__primary')?.getAttribute('data-cad-command'),
    ).toBeNull();
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
      const line = state.resolveVariant('bestfit');
      return (
        <div>
          <span data-cad-line={line?.id ?? 'none'} />
          <button data-cad-test="noop" onClick={() => setNoise((value) => value + 1)} />
          <button data-cad-test="pick-planned" onClick={() => state.selectVariant('bestfit', 'bestfit-arc')} />
        </div>
      );
    };
    const { container, root } = await render(<Probe />);
    const lineId = (): string | null =>
      container.querySelector('[data-cad-line]')?.getAttribute('data-cad-line') ?? null;
    expect(lineId()).toBe('bestfit-line');
    await click(container.querySelector('[data-cad-test="pick-planned"]'));
    expect(lineId()).toBe('bestfit-line');
    await cleanup(container, root);
  });
});

describe('post-L1 flyout scroll / anchor contract (L1)', () => {
  const openArcFlyout = async (container: HTMLElement): Promise<Element | null> => {
    await click(container.querySelector('[data-cad-family-caret="arc"]'));
    return container.querySelector('[data-cad-ribbon-flyout="arc"]');
  };

  const domRect = (left: number, top: number): DOMRect =>
    ({ left, top, right: left, bottom: top, width: 0, height: 0, x: left, y: top }) as unknown as DOMRect;

  // The split button must be DOM-descended from the ribbon strip's own scroll
  // container (`.cad-shell-ribbon-groups`) for the induced-scroll law to apply.
  const renderInStrip = async (): Promise<{ container: HTMLElement; root: Root }> =>
    render(
      <div className="cad-shell-ribbon-groups">
        <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={stubActions()} initialVariantId="arc-3pt" />
      </div>,
    );

  it('L1-A: keeps the flyout open when the flyout itself scrolls', async () => {
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={stubActions()} initialVariantId="arc-3pt" />,
    );
    const flyout = await openArcFlyout(container);
    expect(flyout).not.toBeNull();
    // A real internal scroll dispatches a non-bubbling scroll event whose
    // target is the flyout (or a scrolling node inside it); capture must ignore it.
    await act(async () => {
      flyout?.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).not.toBeNull();
    // A second scroll still must not close it (multiple-wheel scrolls).
    await act(async () => {
      flyout?.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).not.toBeNull();
    await cleanup(container, root);
  });

  it('L1-B: closes on an external window scroll immediately after open', async () => {
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={stubActions()} initialVariantId="arc-3pt" />,
    );
    await openArcFlyout(container);
    // No window-level grace exists: a real external window scroll must close
    // right away. (The only exemption is the one-shot, strip-target,
    // unmoved-caret induced scroll covered by L1-B2.)
    await act(async () => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).toBeNull();
    await cleanup(container, root);
  });

  it('L1-B2: ignores the strip\'s same-frame bring-into-view scroll, but only once', async () => {
    const { container, root } = await renderInStrip();
    await openArcFlyout(container);
    const strip = container.querySelector('.cad-shell-ribbon-groups');
    // jsdom rects are zero-origin, so the caret reads the same position at open
    // and at scroll time — the browser's own bring-into-view scroll of the
    // ribbon strip (issued while resolving the click, delivered after mount).
    // It is not a user scroll, so the menu stays open.
    await act(async () => {
      strip?.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).not.toBeNull();
    // One-shot: a second strip scroll is genuine and closes.
    await act(async () => {
      strip?.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).toBeNull();
    await cleanup(container, root);
  });

  it('L1-B3: closes when a genuine ribbon scroll pans the caret', async () => {
    const { container, root } = await renderInStrip();
    const caret = container.querySelector<HTMLElement>('[data-cad-family-caret="arc"]');
    if (!caret) throw new Error('caret missing');
    // Open reads the caret at 0; the scroll reports it panned 24px => a real
    // user scroll, so it closes rather than leaving a stale anchor.
    const rectSpy = vi
      .spyOn(caret, 'getBoundingClientRect')
      .mockReturnValueOnce(domRect(0, 0))
      .mockReturnValue(domRect(24, 0));
    await openArcFlyout(container);
    const strip = container.querySelector('.cad-shell-ribbon-groups');
    await act(async () => {
      strip?.dispatchEvent(new Event('scroll', { bubbles: false }));
    });
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).toBeNull();
    rectSpy.mockRestore();
    await cleanup(container, root);
  });

  it('L1-C: mousedown inside the flyout (row and scrollbar target) does not close', async () => {
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={stubActions()} initialVariantId="arc-3pt" />,
    );
    const flyout = await openArcFlyout(container);
    const row = container.querySelector('[data-cad-variant="arc-sce"]');
    await act(async () => {
      row?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).not.toBeNull();
    // A mousedown whose target is the flyout element itself stands in for a
    // native scrollbar track/thumb press.
    await act(async () => {
      flyout?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).not.toBeNull();
    await cleanup(container, root);
  });

  it('L1-D: Escape closes and restores caret focus', async () => {
    const { container, root } = await render(
      <SplitHarness toolFamily={family('arc')} snapshot={stubSnapshot(arcKeys)} actions={stubActions()} initialVariantId="arc-3pt" />,
    );
    await openArcFlyout(container);
    await keyDown(document.activeElement, 'Escape');
    expect(container.querySelector('[data-cad-ribbon-flyout="arc"]')).toBeNull();
    expect(
      (document.activeElement as HTMLElement).getAttribute('data-cad-family-caret'),
    ).toBe('arc');
    await cleanup(container, root);
  });

  it('L1-J: an upward anchor resets top:auto so bottom owns the fixed paint', async () => {
    const renderFlyout = async (anchor: CadRibbonFlyoutAnchor): Promise<HTMLElement> => {
      const { container, root } = await render(
        <CadRibbonFlyout
          family={family('arc')}
          currentVariantId="arc-3pt"
          isVariantAvailable={() => true}
          onSelect={() => undefined}
          onRequestClose={() => undefined}
          anchor={anchor}
        />,
      );
      const flyout = container.querySelector<HTMLElement>('[data-cad-ribbon-flyout="arc"]');
      if (!flyout) throw new Error('flyout missing');
      await cleanup(container, root);
      return flyout;
    };
    const up = await renderFlyout({ left: 40, maxHeight: 300, side: 'up', top: null, bottom: 120 });
    expect(up.classList.contains('cad-ribbon-flyout--fixed')).toBe(true);
    // .cad-ribbon-flyout--fixed pins top:0; the inline style must override it
    // so the box hangs from the caret via bottom instead of spanning the screen.
    expect(up.style.top).toBe('auto');
    expect(up.style.bottom).toBe('120px');
    expect(up.style.maxHeight).toBe('300px');

    const down = await renderFlyout({ left: 40, maxHeight: 300, side: 'down', top: 200, bottom: null });
    expect(down.style.top).toBe('200px');
    expect(down.style.bottom).toBe('auto');
  });

  it('L1-E: opens downward when there is more room below (top ribbon)', () => {
    const anchor = resolveCadRibbonFlyoutAnchor({ top: 30, bottom: 50, left: 100 }, 1366, 768);
    expect(anchor.side).toBe('down');
    expect(anchor.top).toBe(50 + CAD_RIBBON_FLYOUT_CARET_GAP_PX);
    expect(anchor.bottom).toBeNull();
    const room = 768 - 50 - CAD_RIBBON_FLYOUT_CARET_GAP_PX - CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX;
    expect(anchor.maxHeight).toBe(room);
  });

  it('L1-F: opens upward when there is more room above and uses bottom semantics', () => {
    const anchor = resolveCadRibbonFlyoutAnchor({ top: 700, bottom: 720, left: 100 }, 1366, 768);
    expect(anchor.side).toBe('up');
    expect(anchor.top).toBeNull();
    expect(anchor.bottom).toBe(768 - 700 + CAD_RIBBON_FLYOUT_CARET_GAP_PX);
    const room = 700 - CAD_RIBBON_FLYOUT_CARET_GAP_PX - CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX;
    expect(anchor.maxHeight).toBe(room);
  });

  it('L1-G: maxHeight is the available room, never a fixed 260px cap', () => {
    const anchor = resolveCadRibbonFlyoutAnchor({ top: 40, bottom: 60, left: 100 }, 1366, 700);
    const room = 700 - 60 - CAD_RIBBON_FLYOUT_CARET_GAP_PX - CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX;
    expect(anchor.maxHeight).toBe(room);
    expect(anchor.maxHeight).toBeGreaterThan(260);
  });

  it('L1-H: clamps left inside the viewport for a far-right caret', () => {
    const anchor = resolveCadRibbonFlyoutAnchor({ top: 30, bottom: 50, left: 1300 }, 1366, 768);
    expect(anchor.left).toBe(
      1366 - CAD_RIBBON_FLYOUT_MAX_WIDTH_PX - CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX,
    );
  });

  it('L1-I: stays positive and bounded inside a realistic minimum viewport', () => {
    // A 100px-wide viewport is not a supported target: `.cad-ribbon-flyout`
    // carries `min-width: 15rem` (240px), so the box necessarily overflows a
    // 100px viewport no matter how the left clamp is computed. Assert the
    // smallest realistic viewport (320px) where the clamp keeps the 240px
    // min-width box on-screen, instead of claiming no-overflow at 100px.
    const width = 320;
    const height = 480;
    const flyoutMinWidth = 240; // cadShell.css: `.cad-ribbon-flyout { min-width: 15rem }`
    const anchor = resolveCadRibbonFlyoutAnchor({ top: 40, bottom: 50, left: 5 }, width, height);
    expect(anchor.maxHeight).toBeGreaterThan(0);
    expect(anchor.left).toBeGreaterThanOrEqual(CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX);
    expect(anchor.left + flyoutMinWidth).toBeLessThanOrEqual(width);
    // The chosen side's far edge ends at the viewport margin.
    const topEdge = anchor.side === 'up'
      ? height - (anchor.bottom ?? 0) - anchor.maxHeight
      : anchor.top ?? 0;
    const bottomEdge = anchor.side === 'up'
      ? height - (anchor.bottom ?? 0)
      : (anchor.top ?? 0) + anchor.maxHeight;
    expect(topEdge).toBeGreaterThanOrEqual(CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX - 0.001);
    expect(bottomEdge).toBeLessThanOrEqual(height - CAD_RIBBON_FLYOUT_VIEWPORT_MARGIN_PX + 0.001);
  });
});
