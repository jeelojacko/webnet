/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  buildSurveyCadSpikeProject,
  input,
  campInput,
  parseOptions,
  campParseOptions,
  mockElementRect,
  projectWorldToPreviewScreen,
  setTextInputValue,
  pressKey,
  clickButton,
  ParentBackedCampWorkspace,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('keeps MOVE exact through parent-backed persisted-state rerenders on the default Camp workspace', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<ParentBackedCampWorkspace />);
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:GPS2|GPS5"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Parent-backed Camp move targets not found');
    mockElementRect(preview);

    const bounds = buildSurveyCadSpikeProject({
      input: campInput,
      instrumentLibrary: {},
      parseOptions: campParseOptions,
      units: 'm',
      result: null,
    }).bounds!;
    const gps2 = projectWorldToPreviewScreen(bounds, { x: 683005.038, y: 5090804.624 });

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      clickButton(container, 'MOVE');
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: gps2.clientX,
          clientY: gps2.clientY,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: gps2.clientX,
          clientY: gps2.clientY,
          button: 0,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: gps2.clientX,
          clientY: gps2.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      const commandInput = container.querySelector(
        '[data-survey-cad-command-input]',
      ) as HTMLInputElement | null;
      if (!commandInput) throw new Error('Parent-backed Camp command input not found after MOVE base pick');
      setTextInputValue(commandInput, '682979.351,5090926.628');
      pressKey(commandInput, 'Enter');
    });

    const movedLine = container.querySelectorAll(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:GPS2|GPS5"]',
    );
    expect(movedLine.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('MOVE committed');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  }, 15000);

  it('supports wheel zoom, middle-drag pan, middle-double-click extents, and directional drag-box selection', async () => {
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

    const firstLine = () => preview.querySelector('line.cursor-pointer') as SVGLineElement | null;
    const startingX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);

    await act(async () => {
      preview.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          clientX: 300,
          clientY: 220,
          deltaY: -120,
        }),
      );
    });
    const zoomedX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);
    expect(zoomedX1).not.toBeCloseTo(startingX1, 6);

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 1,
          clientX: 450,
          clientY: 260,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 520,
          clientY: 300,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 520,
          clientY: 300,
        }),
      );
    });
    const pannedX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);
    expect(pannedX1).not.toBeCloseTo(zoomedX1, 6);

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 1,
          clientX: 450,
          clientY: 260,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          button: 1,
          clientX: 450,
          clientY: 260,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 1,
          clientX: 450,
          clientY: 260,
        }),
      );
    });
    const resetX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);
    expect(resetX1).toBeCloseTo(startingX1, 6);

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 880,
          clientY: 500,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 880,
          clientY: 500,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain(
      '8 selected',
    );

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 880,
          clientY: 500,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain(
      '8 selected',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
