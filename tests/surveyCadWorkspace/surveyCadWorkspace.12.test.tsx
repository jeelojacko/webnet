/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  input,
  parseOptions,
  mockElementRect,
  setTextInputValue,
  pressKey,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('keeps ARC Start Center End start/end order on clockwise sweeps', async () => {
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
      setTextInputValue(commandInput, '0,-10');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_SCE committed',
    );
    const arc = capture.read()?.project.entities.find((entity) => entity.type === 'arc');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Committed arc not found');
    const startX = arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    const startY = arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    const endX = arc.centerX + Math.cos((arc.endAngleDeg * Math.PI) / 180) * arc.radius;
    const endY = arc.centerY + Math.sin((arc.endAngleDeg * Math.PI) / 180) * arc.radius;
    expect(startX).toBeCloseTo(10, 6);
    expect(startY).toBeCloseTo(0, 6);
    expect(endX).toBeCloseTo(0, 6);
    expect(endY).toBeCloseTo(-10, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('routes Center Start End with true center-first point order', async () => {
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
    if (!arcMenuButton || !commandInput) throw new Error('Arc menu or command input not found');

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Center Start End');
      setTextInputValue(commandInput, '50,50');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '70,50');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '50,65');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_CSE committed',
    );
    const arc = capture.read()?.project.entities.find((entity) => entity.type === 'arc');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Committed arc not found');
    expect(arc.centerX).toBeCloseTo(50, 6);
    expect(arc.centerY).toBeCloseTo(50, 6);
    const startX = arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    const startY = arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    expect(startX).toBeCloseTo(70, 6);
    expect(startY).toBeCloseTo(50, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('routes Center Start Angle and Center Start Length with true center-first point order', async () => {
    for (const [modeLabel, value, expectedEndX, expectedEndY, expectedStatus] of [
      ['Center Start Angle', '90', 50, 70, 'ARC_CSA committed'],
      ['Center Start Length', `${Math.sqrt(800)}`, 50, 70, 'ARC_CSL committed'],
    ] as const) {
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
      if (!arcMenuButton || !commandInput) throw new Error('Arc menu or command input not found');

      await act(async () => {
        arcMenuButton.click();
      });
      await act(async () => {
        clickButton(container, modeLabel);
        setTextInputValue(commandInput, '50,50');
        pressKey(commandInput, 'Enter');
        setTextInputValue(commandInput, '70,50');
        pressKey(commandInput, 'Enter');
        setTextInputValue(commandInput, value);
        pressKey(commandInput, 'Enter');
      });

      expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
        expectedStatus,
      );
      const arc = capture.read()?.project.entities.find((entity) => entity.type === 'arc');
      expect(arc?.type).toBe('arc');
      if (arc?.type !== 'arc') throw new Error('Committed arc not found');
      expect(arc.centerX).toBeCloseTo(50, 6);
      expect(arc.centerY).toBeCloseTo(50, 6);
      const startX = arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
      const startY = arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
      const endX = arc.centerX + Math.cos((arc.endAngleDeg * Math.PI) / 180) * arc.radius;
      const endY = arc.centerY + Math.sin((arc.endAngleDeg * Math.PI) / 180) * arc.radius;
      expect(startX).toBeCloseTo(70, 6);
      expect(startY).toBeCloseTo(50, 6);
      expect(endX).toBeCloseTo(expectedEndX, 6);
      expect(endY).toBeCloseTo(expectedEndY, 6);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('does not auto-reframe the camera when entity edits expand project extents', async () => {
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
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    const firstLine = () => preview.querySelector('line.cursor-pointer') as SVGLineElement | null;
    const startingX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!commandInput) throw new Error('Command input not found');

    await act(async () => {
      clickButton(container, 'POINT');
      setTextInputValue(commandInput, 'EXT1=500,500');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '10 entities',
    );
    expect(Number(firstLine()?.getAttribute('x1') ?? Number.NaN)).toBeCloseTo(startingX1, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('uses Enter and Escape for command flow instead of helper buttons', async () => {
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
      clickButton(container, 'PLINE');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '20,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N45-00-00E,20');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PLINE committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '9 entities',
    );

    await act(async () => {
      clickButton(container, 'POINT');
    });
    await act(async () => {
      pressKey(commandInput, 'Escape');
    });

    expect(commandInput.disabled).toBe(true);
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).not.toContain(
      'POINT active',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the top CAD toolbar overlay vertically visible so the arc dropdown is not clipped', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => {
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

    const toolbarOverlay = container.querySelector('[data-survey-cad-toolbar-overlay]');
    expect(toolbarOverlay?.className).toContain('overflow-visible');
    expect(toolbarOverlay?.className).not.toContain('overflow-x-auto');

    act(() => {
      root.unmount();
    });
    container.remove();
  });

});
