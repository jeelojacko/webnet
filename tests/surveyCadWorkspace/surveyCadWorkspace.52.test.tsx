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
  pressKey,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('cycles nearby snaps with Space during grip editing and commits the cycled target', async () => {
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
          id: 'line:grip-space-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'GS1',
          toStationId: 'GS2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
          sourceObservationIds: [],
        },
        {
          id: 'pt:grip-space-a',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'GSA',
          x: 14,
          y: 24,
          pointClass: 'free' as const,
          source: 'parsed-input' as const,
        },
        {
          id: 'pt:grip-space-b',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'GSB',
          x: 14.35,
          y: 24.3,
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
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:grip-space-test"]',
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
    const snapCloud = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 14.15, y: 24.15 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: snapCloud.clientX,
          clientY: snapCloud.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: snapCloud.clientX,
          clientY: snapCloud.clientY,
        }),
      );
    });

    const initialBadge = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(initialBadge).toMatch(/GSA|GSB/);

    await act(async () => {
      pressKey(window, ' ');
    });

    const cycledBadge = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(cycledBadge).toMatch(/GSA|GSB/);
    expect(cycledBadge).not.toBe(initialBadge);

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: snapCloud.clientX,
          clientY: snapCloud.clientY,
        }),
      );
    });

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:grip-space-test');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Grip-cycled line not found');
    const expectedPoint = cycledBadge.includes('GSB') ? { x: 14.35, y: 24.3 } : { x: 14, y: 24 };
    expect(line.fromX).toBeCloseTo(expectedPoint.x, 6);
    expect(line.fromY).toBeCloseTo(expectedPoint.y, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps zooming far past the old CAD zoom cap', async () => {
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
    const wheelAtCenter = () =>
      preview.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          clientX: 450,
          clientY: 260,
          deltaY: -120,
        }),
      );

    await act(async () => {
      Array.from({ length: 25 }).forEach(() => wheelAtCenter());
    });
    const afterTwentyFive = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);

    await act(async () => {
      Array.from({ length: 15 }).forEach(() => wheelAtCenter());
    });
    const afterForty = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);

    expect(afterForty).not.toBeCloseTo(afterTwentyFive, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
