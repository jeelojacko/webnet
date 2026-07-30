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
  it('keeps perpendicular direction active without Shift so true line intersection beats apparent snaps', async () => {
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
          id: 'line:target',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: -2,
          fromY: 14,
          toX: 8,
          toY: 14,
          sourceObservationIds: [],
        },
        {
          id: 'line:apparent-bait',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L5',
          toStationId: 'L6',
          fromX: 2,
          fromY: 8,
          toX: 8,
          toY: 2,
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
      setTextInputValue(commandInput, '2,18');
      pressKey(commandInput, 'Enter');
    });

    const perpendicularAcquireScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 2.2, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: perpendicularAcquireScreen.clientX,
          clientY: perpendicularAcquireScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');

    const targetLineBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 14.1 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: targetLineBodyScreen.clientX,
          clientY: targetLineBodyScreen.clientY,
        }),
      );
    });

    const badgeText = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(badgeText).toContain('Perpendicular');
    expect(badgeText.toLowerCase()).not.toContain('apparent');
    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 2, y: 14 });
    expect(Number(previewLine.getAttribute('x2'))).toBeCloseTo(snappedIntersectionScreen.clientX, 8);
    expect(Number(previewLine.getAttribute('y2'))).toBeCloseTo(snappedIntersectionScreen.clientY, 8);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps a construction snap locked with Shift while hovering farther along the same derived line', async () => {
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
          id: 'line:remote-horizontal',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L5',
          toStationId: 'L6',
          fromX: 12,
          fromY: 20,
          toX: 18,
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

    const initialPerpScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.2, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: initialPerpScreen.clientX,
          clientY: initialPerpScreen.clientY,
          shiftKey: true,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');

    const fartherScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 19.8 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: fartherScreen.clientX,
          clientY: fartherScreen.clientY,
          shiftKey: true,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
