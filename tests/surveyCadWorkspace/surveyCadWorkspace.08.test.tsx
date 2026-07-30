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
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('cycles nearby cursor-local snaps with Space after LINE captures its first point', async () => {
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '20,20');
      pressKey(commandInput, 'Enter');
    });

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="direction"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 94,
          clientY: 461,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');

    await act(async () => {
      pressKey(window, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Endpoint');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('A');

    await act(async () => {
      pressKey(window, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Point');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('A');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('cycles nearby cursor-local snaps with Space during POINT while command input stays focused', async () => {
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'POINT');
    });

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="direction"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 94,
          clientY: 461,
        }),
      );
    });

    expect(document.activeElement).toBe(commandInput);
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');

    await act(async () => {
      pressKey(commandInput, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Endpoint');

    await act(async () => {
      pressKey(commandInput, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Point');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('cycles nearby cursor-local snaps with Space during ARC 3PT point capture', async () => {
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    const arcMenuButton = container.querySelector('[data-survey-cad-arc-menu-button]') as HTMLButtonElement | null;
    if (!preview || !commandInput || !arcMenuButton) throw new Error('Preview, command input, or arc menu not found');
    mockElementRect(preview);

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, '3 Point');
      setTextInputValue(commandInput, '20,20');
      pressKey(commandInput, 'Enter');
    });

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="direction"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 94,
          clientY: 461,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');

    await act(async () => {
      pressKey(commandInput, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Endpoint');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows an exact intersection snap during live POINT placement over crossing linework', async () => {
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
        {
          id: 'line:h',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'H1',
          toStationId: 'H2',
          fromX: 0,
          fromY: 10,
          toX: 20,
          toY: 10,
          sourceObservationIds: [],
        },
        {
          id: 'line:v',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'V1',
          toStationId: 'V2',
          fromX: 10,
          fromY: 0,
          toX: 10,
          toY: 20,
          sourceObservationIds: [],
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
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'POINT');
    });
    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="nearest"]') as HTMLInputElement | null)?.click();
    });

    const crossingScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 10.1, y: 9.9 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: crossingScreen.clientX,
          clientY: crossingScreen.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Intersection');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates a manual point from typed POINT input with Enter', async () => {
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
      clickButton(container, 'POINT');
    });
    await act(async () => {
      setTextInputValue(commandInput, 'CAD77=10,20');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '10 entities',
    );
    expect(container.textContent).toContain('CAD77');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
