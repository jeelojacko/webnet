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
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('commits a dragged grip endpoint to the visible snap target on mouse release', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const capture = createPersistedStateCapture();

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
          id: 'line:snap-commit-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'SC1',
          toStationId: 'SC2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
          sourceObservationIds: [],
        },
        {
          id: 'pt:snap-target',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'SNAPPT',
          x: 14,
          y: 24,
          pointClass: 'free' as const,
          source: 'parsed-input' as const,
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:snap-commit-test"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Preview or line target not found');
    mockElementRect(preview);

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="line-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Line start handle not found');
    const snapTarget = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 14, y: 24 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: snapTarget.clientX,
          clientY: snapTarget.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: snapTarget.clientX,
          clientY: snapTarget.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('SNAPPT');

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: snapTarget.clientX,
          clientY: snapTarget.clientY,
        }),
      );
    });

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:snap-commit-test');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Dragged line not found');
    expect(line.fromX).toBeCloseTo(14, 6);
    expect(line.fromY).toBeCloseTo(24, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('moves the selected entity so the picked base point lands exactly on the snapped target', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const capture = createPersistedStateCapture();

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
          id: 'line:move-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'MV1',
          toStationId: 'MV2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
          sourceObservationIds: [],
        },
        {
          id: 'pt:move-target',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'MOVEPT',
          x: 14,
          y: 24,
          pointClass: 'free' as const,
          source: 'parsed-input' as const,
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:move-test"]',
    ) as SVGLineElement | null;
    const pointTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:move-target"]',
    ) as SVGCircleElement | null;
    if (!preview || !lineTarget || !pointTarget) throw new Error('Move test targets not found');
    mockElementRect(preview);

    const moveBase = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 20, y: 12 });
    const moveTarget = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 14, y: 24 });

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    await act(async () => {
      clickButton(container, 'MOVE');
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: moveBase.clientX,
          clientY: moveBase.clientY,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: moveBase.clientX,
          clientY: moveBase.clientY,
          button: 0,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: moveBase.clientX,
          clientY: moveBase.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: moveTarget.clientX,
          clientY: moveTarget.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('MOVEPT');

    await act(async () => {
      pointTarget.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: moveTarget.clientX,
          clientY: moveTarget.clientY,
          button: 0,
        }),
      );
      pointTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: moveTarget.clientX,
          clientY: moveTarget.clientY,
          button: 0,
        }),
      );
    });

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:move-test');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Moved line not found');
    expect(line.fromX).toBeCloseTo(14, 6);
    expect(line.fromY).toBeCloseTo(24, 6);
    expect(line.toX).toBeCloseTo(42, 6);
    expect(line.toY).toBeCloseTo(30, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
