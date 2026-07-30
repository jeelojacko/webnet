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
  it('resolves arc midpoint and nearest hover snaps in the live workspace with zoom-aware snap range', async () => {
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
          id: 'arc:hover-test',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 50,
          centerY: 20,
          radius: 12,
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
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    const arcMidpointScreen = projectWorldToPreviewScreen(baseProject.bounds!, { x: 50.2, y: 31.6 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcMidpointScreen.clientX,
          clientY: arcMidpointScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Arc Mid');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Arc');

    const nearestScreen = projectWorldToPreviewScreen(baseProject.bounds!, { x: 57.2, y: 29.6 });
    await act(async () => {
      preview.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          clientX: nearestScreen.clientX,
          clientY: nearestScreen.clientY,
          deltaY: -120,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: nearestScreen.clientX,
          clientY: nearestScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Arc');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows arc-body nearest during LINE on a small arc instead of letting endpoints steal the snap', async () => {
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
          id: 'arc:small-hover-test',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 65,
          centerY: 35,
          radius: 1,
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
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    const arcBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 65, y: 36 });
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

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Arc');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps perpendicular lock active while refining onto an apparent intersection during LINE input', async () => {
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
          id: 'line:base',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:short-vertical',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: 5,
          fromY: 15,
          toX: 5,
          toY: 25,
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '5,10');
      pressKey(commandInput, 'Enter');
    });

    const apparentPointScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: apparentPointScreen.clientX,
          clientY: apparentPointScreen.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent?.toLowerCase()).toContain('apparent');
    expect(container.querySelectorAll('[data-survey-cad-snap-guide]').length).toBeGreaterThanOrEqual(3);

    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5, y: 0 });
    expect(Number(previewLine.getAttribute('x2'))).toBeCloseTo(snappedIntersectionScreen.clientX, 8);
    expect(Number(previewLine.getAttribute('y2'))).toBeCloseTo(snappedIntersectionScreen.clientY, 8);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
