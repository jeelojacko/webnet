/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  input,
  parseOptions,
  mockElementRect,
  projectWorldToPreviewScreen,
  setTextInputValue,
  pressKey,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('lets LINE start from and finish onto the body of an ARC 3PT arc created in the same workspace session', async () => {
    const capture = createPersistedStateCapture();
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
          persistedState={null}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const arcMenuButton = container.querySelector('[data-survey-cad-arc-menu-button]') as HTMLButtonElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!arcMenuButton || !commandInput || !preview) throw new Error('Arc menu, command input, or preview not found');
    mockElementRect(preview);

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, '3 Point');
      setTextInputValue(commandInput, '10,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '20,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '30,0');
      pressKey(commandInput, 'Enter');
    });

    const persistedProject = capture.read()?.project;
    if (!persistedProject?.bounds) throw new Error('Persisted project bounds not captured');

    const arcBodyStart = projectWorldToPreviewScreen(persistedProject.bounds, { x: 23, y: 8 });
    const lineStart = projectWorldToPreviewScreen(persistedProject.bounds, { x: 55, y: 5 });
    const arcBodyEnd = projectWorldToPreviewScreen(persistedProject.bounds, { x: 17, y: 8 });

    await act(async () => {
      clickButton(container, 'LINE');
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('LINE active');
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcBodyStart.clientX,
          clientY: arcBodyStart.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Nearest');

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: arcBodyStart.clientX,
          clientY: arcBodyStart.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lineStart.clientX,
          clientY: lineStart.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: lineStart.clientX,
          clientY: lineStart.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('LINE committed');

    await act(async () => {
      clickButton(container, 'LINE');
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('LINE active');
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lineStart.clientX,
          clientY: lineStart.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: lineStart.clientX,
          clientY: lineStart.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcBodyEnd.clientX,
          clientY: arcBodyEnd.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Nearest');

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: arcBodyEnd.clientX,
          clientY: arcBodyEnd.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('LINE committed');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('explains that ARC 3PT uses the through point to fix the arc side instead of Ctrl flip', async () => {
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

    await act(async () => {
      clickButton(container, 'ARC');
    });

    expect(container.querySelector('[data-survey-cad-command-help]')?.textContent).toContain(
      'through point fixes the arc side',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a live Ctrl flip hint only for arc modes that support alternate arc side', async () => {
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

    const arcMenuButton = container.querySelector('[data-survey-cad-arc-menu-button]') as HTMLButtonElement | null;
    if (!arcMenuButton) throw new Error('Arc menu button not found');

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Start End Radius');
    });

    expect(container.querySelector('[data-survey-cad-command-modifier-hint]')?.textContent).toContain(
      'Ctrl = Flip Arc',
    );

    await act(async () => {
      pressKey(window, 'Control');
    });

    expect(container.querySelector('[data-survey-cad-command-modifier-hint]')?.textContent).toContain(
      'Ctrl Held: Flip Arc',
    );

    await act(async () => {
      pressKey(window, 'Escape');
    });

    expect(container.querySelector('[data-survey-cad-command-modifier-hint]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a live construction-snap base-point hint once a command captures its first point', async () => {
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

    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!commandInput) throw new Error('Command input not found');

    await act(async () => {
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-construction-hint]')?.textContent).toContain(
      'Base 0.000,0.000',
    );
    expect(container.querySelector('[data-survey-cad-construction-hint]')?.textContent).toContain(
      'Construction snaps live',
    );

    await act(async () => {
      pressKey(window, 'Escape');
    });

    expect(container.querySelector('[data-survey-cad-construction-hint]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('commits ARC Start Center End from an off-radius final pick by keeping the chosen center and using the picked direction', async () => {
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

    const arcMenuButton = container.querySelector('[data-survey-cad-arc-menu-button]') as HTMLButtonElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!arcMenuButton || !commandInput) throw new Error('Arc menu or command input not found');

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Start Center End');
      setTextInputValue(commandInput, '10,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '0,8');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_SCE committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '17 entities',
    );
    expect(container.querySelectorAll('path.cursor-pointer').length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
