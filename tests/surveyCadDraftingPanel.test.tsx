/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { SurveyCadDraftingPanel } from '../src/components/surveyCad/SurveyCadDraftingPanel';
import {
  buildSurveyCadSpikeProject,
  input,
  parseOptions,
} from './surveyCadWorkspace/surveyCadWorkspaceTestSupport';
import {
  addSheetToDraft,
  createPlanSheet,
  createTitleBlockTemplate,
} from '../src/engine/cad/cadSheets';
import { createBlankDraftDocument, type DraftDocument } from '../src/engine/cad/cadDraftTypes';

const buildDraft = (): DraftDocument => {
  let draft = createBlankDraftDocument({ projectId: 'p-panel' });
  draft = addSheetToDraft(draft, createPlanSheet({ name: 'S1' }));
  return { ...draft, titleBlockDefinitions: [createTitleBlockTemplate('Panel block')] };
};

describe('SurveyCadDraftingPanel production wiring', () => {
  it('exposes the Title Blocks tab and routes template edits through onDraftChange', async () => {
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const draft = buildDraft();
    const onDraftChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <SurveyCadDraftingPanel
          project={project}
          draft={draft}
          onLayerCommand={() => {}}
          onSetCurrentLayer={() => {}}
          onDraftChange={onDraftChange}
          onClose={() => {}}
        />,
      );
    });
    // Title Blocks tab is reachable in the production panel (not only the dev harness).
    const tabs = [...container.querySelectorAll('[role="tab"]')].map((el) => el.textContent);
    expect(tabs).toContain('Title Blocks');
    await act(async () => {
      const titleTab = [...container.querySelectorAll('[role="tab"]')].find(
        (el) => el.textContent === 'Title Blocks',
      ) as HTMLElement;
      titleTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[aria-label="Title block template editor"]')).not.toBeNull();
    // Mutating the template fires the draft mutation callback to the workspace.
    const nextBefore = onDraftChange.mock.calls.length;
    await act(async () => {
      const newButton = [...container.querySelectorAll('button')].find(
        (el) => el.textContent === 'New',
      ) as HTMLElement;
      newButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDraftChange.mock.calls.length).toBeGreaterThan(nextBefore);
    const updated = onDraftChange.mock.calls[onDraftChange.mock.calls.length - 1]?.[0] as DraftDocument;
    expect(updated.titleBlockDefinitions.length).toBe(draft.titleBlockDefinitions.length + 1);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
