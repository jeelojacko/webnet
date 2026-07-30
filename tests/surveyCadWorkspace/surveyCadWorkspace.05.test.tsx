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
  it('keeps perpendicular lock active while refining onto a nearby arc body during LINE input', async () => {
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
          id: 'arc:perp-target',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 10,
          centerY: 10,
          radius: 5,
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
      setTextInputValue(commandInput, '8,18');
      pressKey(commandInput, 'Enter');
    });

    const perpendicularAcquireScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 8.2, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: perpendicularAcquireScreen.clientX,
          clientY: perpendicularAcquireScreen.clientY,
          shiftKey: true,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');

    const perpendicularArcBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 10.3, y: 14.5 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: perpendicularArcBodyScreen.clientX,
          clientY: perpendicularArcBodyScreen.clientY,
          shiftKey: true,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Arc');
    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 8, y: 10 + Math.sqrt(21) });
    expect(Number(previewLine.getAttribute('x2'))).toBeCloseTo(snappedIntersectionScreen.clientX, 8);
    expect(Number(previewLine.getAttribute('y2'))).toBeCloseTo(snappedIntersectionScreen.clientY, 8);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps midpoint-started LINE construction scope local instead of snapping remote parallels', async () => {
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
          id: 'line:local',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L2',
          toStationId: 'L3',
          fromX: 10,
          fromY: 0,
          toX: 10,
          toY: 10,
          sourceObservationIds: [],
        },
        {
          id: 'line:remote',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'R1',
          toStationId: 'R2',
          fromX: 40,
          fromY: -10,
          toX: 40,
          toY: 10,
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
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="nearest"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="endpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="point-node"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="apparent-intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="perpendicular"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      clickButton(container, 'LINE');
    });

    const midpointScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5, y: 0 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: midpointScreen.clientX,
          clientY: midpointScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Midpoint');

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: midpointScreen.clientX,
          clientY: midpointScreen.clientY,
        }),
      );
    });

    const remoteParallelScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 39.8, y: 6 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: remoteParallelScreen.clientX,
          clientY: remoteParallelScreen.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').not.toContain('Parallel');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
