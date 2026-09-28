/** @vitest-environment jsdom */
/* Phase 21A — shellChrome gating: exactly one Properties UI (palette in the
 * dock) and command entry via CadCommandDock; the standalone legacy path is
 * unchanged. Browser specs mount the shell, so this pins the seam in jsdom. */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  input,
  parseOptions,
} from './surveyCadWorkspace/surveyCadWorkspaceTestSupport';
import { SurveyCadCommandHelpOverlay } from '../src/components/surveyCad/SurveyCadPreviewOverlays';

const renderWorkspace = async (shellChrome: boolean): Promise<{ container: HTMLElement; root: Root }> => {
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
        shellChrome={shellChrome}
      />,
    );
  });
  return { container, root };
};

const selectPoint = async (container: HTMLElement): Promise<void> => {
  const target = container.querySelector(
    '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:A"]',
  ) as SVGElement | null;
  if (!target) throw new Error('Point hit target not found');
  await act(async () => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
  });
};

const unmount = async (container: HTMLElement, root: Root): Promise<void> => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
};

describe('SurveyCadWorkspace shellChrome gating', () => {
  it('shell mode hides the legacy Properties panel + preview input and keeps snap controls', async () => {
    const { container, root } = await renderWorkspace(true);
    await selectPoint(container);
    expect(container.querySelector('[data-survey-cad-properties-panel]')).toBeNull();
    expect(container.querySelector('[data-survey-cad-command-input]')).toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-menu]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-parcel-label-toggle]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-menu-button]')).not.toBeNull();
    await unmount(container, root);
  });

  it('legacy mode keeps the floating Properties panel and preview command input', async () => {
    const { container, root } = await renderWorkspace(false);
    expect(container.querySelector('[data-survey-cad-command-input]')).not.toBeNull();
    await selectPoint(container);
    expect(container.querySelector('[data-survey-cad-properties-panel]')).not.toBeNull();
    await unmount(container, root);
  });
});

describe('SurveyCadCommandHelpOverlay shell echo', () => {
  const renderOverlay = async (suppressCommandStatus: boolean): Promise<{ container: HTMLElement; root: Root }> => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <SurveyCadCommandHelpOverlay
          commandStatusText="Specify next point or type distance"
          commandHelpText="Click in model space or type x,y"
          commandInputEnabled
          commandModifierHint="Ctrl = Flip Arc"
          constructionHint="Construction snaps live"
          suppressCommandStatus={suppressCommandStatus}
        />,
      );
    });
    return { container, root };
  };

  it('shows the prompt echo, help, modifier and construction hints by default', async () => {
    const { container, root } = await renderOverlay(false);
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'Specify next point',
    );
    expect(container.textContent).toContain('Click in model space');
    expect(container.querySelector('[data-survey-cad-command-modifier-hint]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-construction-hint]')).not.toBeNull();
    await unmount(container, root);
  });

  it('suppresses the duplicate prompt echo while keeping help + hints', async () => {
    const { container, root } = await renderOverlay(true);
    expect(container.querySelector('[data-survey-cad-command-status]')).toBeNull();
    expect(container.textContent).toContain('Click in model space');
    expect(container.querySelector('[data-survey-cad-command-modifier-hint]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-construction-hint]')).not.toBeNull();
    await unmount(container, root);
  });
});
