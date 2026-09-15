/** @vitest-environment jsdom */

// Production wiring: the workspace owns the active feature catalog, the
// Field-to-Finish panel edits that same object, and the Export Center
// catalog tab exports it (previously the tab was permanently disabled in
// production because no catalog prop reached the panel).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  input,
  parseOptions,
} from '../surveyCadWorkspace/surveyCadWorkspaceTestSupport';

const clickSelector = async (container: HTMLElement, selector: string) => {
  const button = container.querySelector(selector) as HTMLElement;
  if (!button) throw new Error(`Selector ${selector} not found`);
  await act(async () => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const renderWorkspace = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      <SurveyCadWorkspace
        input={input}
        instrumentLibrary={{}}
        parseOptions={parseOptions}
        units="m"
        result={null}
      />,
    );
  });
  return { container, root };
};

const clickTab = async (container: HTMLElement, text: string) => {
  const tab = [...container.querySelectorAll('[role="tab"]')].find(
    (el) => el.textContent === text,
  ) as HTMLElement;
  if (!tab) throw new Error(`Tab ${text} not found`);
  await act(async () => {
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('ExportCenter catalog production wiring', () => {
  it('shares the workspace catalog between the F2F editor and the Export Center', async () => {
    const { container, root } = await renderWorkspace();
    try {
      // Open the drafting panel → Field-to-Finish tab → catalog editor.
      await clickSelector(container, '[data-survey-cad-drafting-panels]');
      await clickTab(container, 'Field-to-Finish');
      const addButton = container.querySelector('[data-f2f-catalog-add]') as HTMLElement;
      expect(addButton).not.toBeNull();
      const listBefore = container.querySelector('[data-f2f-catalog-list]')?.textContent ?? '';
      await act(async () => {
        addButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      const listText = container.querySelector('[data-f2f-catalog-list]')?.textContent ?? '';
      expect(listText.length).toBeGreaterThan(listBefore.length);
      // Workspace-owned state survives the drafting panel unmount.
      await clickSelector(container, '[data-survey-cad-drafting-panels]');
      expect(container.querySelector('[data-f2f-catalog-editor]')).toBeNull();
      await clickSelector(container, '[data-survey-cad-drafting-panels]');
      await clickTab(container, 'Field-to-Finish');
      expect(container.querySelector('[data-f2f-catalog-list]')?.textContent).toBe(listText);
      // The Export Center catalog tab is enabled in production and offers
      // the catalog download for the same active catalog.
      await clickSelector(container, '[data-survey-cad-export-center]');
      const catalogTab = [...container.querySelectorAll('[role="tab"]')].find(
        (el) => el.getAttribute('aria-label') === 'Export format Feature Catalog JSON',
      ) as HTMLButtonElement;
      expect(catalogTab).not.toBeUndefined();
      expect(catalogTab.disabled).toBe(false);
      await act(async () => {
        catalogTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(
        container.querySelector('[data-export-center-filename]')?.textContent,
      ).toContain('-catalog.json');
      expect(container.querySelector('[aria-label="Export preview"]')?.textContent).toContain(
        'Active feature catalog',
      );
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});
