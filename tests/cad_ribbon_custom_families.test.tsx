/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { CadRibbonToolFamily } from '../src/cad-app/shell/cadRibbonToolFamilies';
import { useCadToolFamilyState } from '../src/cad-app/shell/useCadToolFamilyState';

// Custom manifest deliberately disjoint from the production manifest: a family
// id ('custom') that does not exist globally, plus command keys that do not
// exist globally, so any global-manifest leak is observable.
const CUSTOM_FAMILIES: readonly CadRibbonToolFamily[] = [
  {
    id: 'arc',
    label: 'Custom Arc',
    defaultVariantId: 'custom-a',
    variants: [
      { id: 'custom-a', label: 'A', commandKey: 'CUSTOM_A' },
      { id: 'custom-b', label: 'B', commandKey: 'CUSTOM_B' },
      { id: 'custom-planned', label: 'Planned', planned: true },
    ],
  },
] as unknown as readonly CadRibbonToolFamily[];

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

const CustomHarness: React.FC = () => {
  const state = useCadToolFamilyState({ drawingId: 'd1', families: CUSTOM_FAMILIES });
  const current = state.resolveVariant('arc');
  return (
    <div>
      <span data-cad-current={current?.id ?? 'none'} />
      <span data-cad-active={String(state.isFamilyActive('arc', 'CUSTOM_B'))} />
      <span data-cad-global-leak={String(state.isFamilyActive('arc', 'ARC_SCE'))} />
      <span data-cad-unknown={String(state.resolveVariant('nope') == null)} />
      <button data-cad-test="select-b" onClick={() => state.selectVariant('arc', 'custom-b')} />
      <button data-cad-test="select-planned" onClick={() => state.selectVariant('arc', 'custom-planned')} />
      <button data-cad-test="reset" onClick={() => state.resetToDefaults()} />
    </div>
  );
};

const text = (container: HTMLElement, name: string): string | null =>
  container.querySelector(`[data-cad-${name}]`)?.getAttribute(`data-cad-${name}`) ?? null;

describe('phase 21B custom tool families (§7)', () => {
  it('resolves, selects, activates, rejects planned, and resets via the supplied families only', async () => {
    const { container, root } = await render(<CustomHarness />);
    // Default comes from the custom manifest, not the production arc default.
    expect(text(container, 'current')).toBe('custom-a');
    // Production keys must NOT activate the custom family.
    expect(text(container, 'global-leak')).toBe('false');
    expect(text(container, 'unknown')).toBe('true');

    await click(container.querySelector('[data-cad-test="select-b"]'));
    expect(text(container, 'current')).toBe('custom-b');
    expect(text(container, 'active')).toBe('true');

    // Planned variants are rejected.
    await click(container.querySelector('[data-cad-test="select-planned"]'));
    expect(text(container, 'current')).toBe('custom-b');

    // Reset returns to the custom default.
    await click(container.querySelector('[data-cad-test="select-b"]'));
    await click(container.querySelector('[data-cad-test="reset"]'));
    expect(text(container, 'current')).toBe('custom-a');
    await cleanup(container, root);
  });
});
