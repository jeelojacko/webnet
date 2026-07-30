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
  it('keeps tangent lock active while refining onto a nearby line body during LINE input', async () => {
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
          id: 'line:tangent-target',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 5,
          fromY: 6,
          toX: 5,
          toY: 16,
          sourceObservationIds: [],
        },
        {
          id: 'arc:tangent-source',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '0,20');
      pressKey(commandInput, 'Enter');
    });

    const tangentAcquireScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 8.7, y: 5.1 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentAcquireScreen.clientX,
          clientY: tangentAcquireScreen.clientY,
          shiftKey: true,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Tangent');

    const tangentLineBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 14 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentLineBodyScreen.clientX,
          clientY: tangentLineBodyScreen.clientY,
          shiftKey: true,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Tangent');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('locked');
    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5, y: 20 - 5 * Math.sqrt(3) });
    expect(Number(previewLine.getAttribute('x2'))).toBeCloseTo(snappedIntersectionScreen.clientX, 8);
    expect(Number(previewLine.getAttribute('y2'))).toBeCloseTo(snappedIntersectionScreen.clientY, 8);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps tangent direction active without Shift so true line intersection beats extension/apparent alternatives', async () => {
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
          id: 'line:tangent-target',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 5,
          fromY: 6,
          toX: 5,
          toY: 16,
          sourceObservationIds: [],
        },
        {
          id: 'line:apparent-bait',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: 1,
          fromY: 15,
          toX: 9,
          toY: 11,
          sourceObservationIds: [],
        },
        {
          id: 'arc:tangent-source',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '0,20');
      pressKey(commandInput, 'Enter');
    });

    const tangentAcquireScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 8.7, y: 5.1 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentAcquireScreen.clientX,
          clientY: tangentAcquireScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Tangent');

    const tangentLineBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 14 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentLineBodyScreen.clientX,
          clientY: tangentLineBodyScreen.clientY,
        }),
      );
    });

    const badgeText = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(badgeText).toContain('Tangent');
    expect(badgeText.toLowerCase()).not.toContain('apparent');
    expect(badgeText.toLowerCase()).not.toContain('ext');
    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5, y: 20 - 5 * Math.sqrt(3) });
    expect(Number(previewLine.getAttribute('x2'))).toBeCloseTo(snappedIntersectionScreen.clientX, 8);
    expect(Number(previewLine.getAttribute('y2'))).toBeCloseTo(snappedIntersectionScreen.clientY, 8);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
