/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  buildSurveyCadSpikeProject,
  buildCadProjectSignature,
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
  it('resolves a real tangent snap when LINE approaches an arc from an external start point', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const persistedProject = {
      ...baseProject,
      entities: [
        ...baseProject.entities,
        {
          id: 'arc:tangent-attach-test',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 50,
          centerY: 20,
          radius: 10,
          startAngleDeg: 0,
          endAngleDeg: 180,
        },
      ],
    };

    await act(async () => {
      root.render(
        <SurveyCadWorkspace
          input={input}
          instrumentLibrary={{}}
          parseOptions={parseOptions}
          units="m"
          result={null}
          persistedState={{
            version: 1,
            sourceSignature: buildCadProjectSignature(baseProject),
            project: persistedProject,
          }}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    const startPoint = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 50, y: 40 });
    const tangentPoint = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 58.7, y: 25.1 });

    await act(async () => {
      clickButton(container, 'LINE');
    });
    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: startPoint.clientX,
          clientY: startPoint.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentPoint.clientX,
          clientY: tangentPoint.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Tangent');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Arc');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a live line preview while drawing before the second click commits', async () => {
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

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    await act(async () => {
      clickButton(container, 'LINE');
    });
    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 180,
          clientY: 410,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 320,
          clientY: 320,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-preview]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'LINE active',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders a true arc path after committing ARC 3PT', async () => {
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
      clickButton(container, 'ARC');
      setTextInputValue(commandInput, '10,0');
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, '0,10');
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, '-10,0');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_3PT committed',
    );
    expect(container.querySelectorAll('path.cursor-pointer').length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('snaps LINE nearest onto an arc created by ARC 3PT', async () => {
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

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('ARC_3PT committed');
    const persistedProject = capture.read()?.project;
    if (!persistedProject?.bounds) throw new Error('Persisted project bounds not captured');

    const arcBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds, { x: 23, y: 8 });

    await act(async () => {
      clickButton(container, 'LINE');
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcBodyScreen.clientX,
          clientY: arcBodyScreen.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Nearest');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
