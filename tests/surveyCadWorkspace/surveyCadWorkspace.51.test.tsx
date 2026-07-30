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
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('turns an arc into a full circle when one endpoint grip is dragged onto the other endpoint', async () => {
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
          id: 'arc:full-circle-test',
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const arcTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:full-circle-test"]',
    ) as SVGPathElement | null;
    if (!preview || !arcTarget) throw new Error('Preview or arc target not found');
    mockElementRect(preview);

    await act(async () => {
      arcTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Arc start handle not found');
    const endPoint = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 38, y: 20 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: endPoint.clientX,
          clientY: endPoint.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: endPoint.clientX,
          clientY: endPoint.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: endPoint.clientX,
          clientY: endPoint.clientY,
        }),
      );
    });

    const arc = capture.read()?.project.entities.find((entity) => entity.id === 'arc:full-circle-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Edited arc not found');
    expect(Math.abs(arc.endAngleDeg - arc.startAngleDeg)).toBeCloseTo(360, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('turns an arc into a full circle when an endpoint grip releases onto the opposite endpoint snap', async () => {
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
          id: 'arc:full-circle-snap-test',
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const arcTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:full-circle-snap-test"]',
    ) as SVGPathElement | null;
    if (!preview || !arcTarget) throw new Error('Preview or arc target not found');
    mockElementRect(preview);

    await act(async () => {
      arcTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-start"]',
    ) as SVGCircleElement | null;
    const endHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-end"]',
    ) as SVGCircleElement | null;
    if (!startHandle || !endHandle) throw new Error('Arc grip handles not found');
    const previewRect = preview.getBoundingClientRect();
    const nearEndPoint = {
      clientX: previewRect.left + Number(endHandle.getAttribute('cx') ?? '0'),
      clientY: previewRect.top + Number(endHandle.getAttribute('cy') ?? '0'),
    };

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Arc');

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
        }),
      );
    });

    const arc = capture.read()?.project.entities.find((entity) => entity.id === 'arc:full-circle-snap-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Edited arc not found');
    expect(Math.abs(arc.endAngleDeg - arc.startAngleDeg)).toBeCloseTo(360, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('turns an arc into a full circle during browser-style grip drag driven by window mouse events', async () => {
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
          id: 'arc:full-circle-window-test',
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const arcTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:full-circle-window-test"]',
    ) as SVGPathElement | null;
    if (!preview || !arcTarget) throw new Error('Preview or arc target not found');
    mockElementRect(preview);

    await act(async () => {
      arcTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Arc start handle not found');
    const nearEndPoint = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 38.8, y: 20.6 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
        }),
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
        }),
      );
    });

    const arc = capture.read()?.project.entities.find((entity) => entity.id === 'arc:full-circle-window-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Edited arc not found');
    expect(Math.abs(arc.endAngleDeg - arc.startAngleDeg)).toBeCloseTo(360, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
