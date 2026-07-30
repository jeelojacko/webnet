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
  it('shows line endpoint grips and commits dragged endpoint edits', async () => {
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
          id: 'pt:L1',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'L1',
          x: 20,
          y: 12,
          pointClass: 'free' as const,
          source: 'parsed-input' as const,
        },
        {
          id: 'line:grip-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:grip-test"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Preview or line target not found');
    mockElementRect(preview);

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelectorAll('[data-survey-cad-grip-handle]')).toHaveLength(2);

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="line-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Line start handle not found');
    const movedStart = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 15, y: 22 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: movedStart.clientX,
          clientY: movedStart.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: movedStart.clientX,
          clientY: movedStart.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: movedStart.clientX,
          clientY: movedStart.clientY,
        }),
      );
    });

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:grip-test');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Dragged line not found');
    expect(line.fromX).toBeCloseTo(15, 6);
    expect(line.fromY).not.toBeCloseTo(12, 6);
    const movedA = capture.read()?.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'L1',
    );
    expect(movedA?.type).toBe('survey-point');
    if (movedA?.type !== 'survey-point') throw new Error('Linked line point not found');
    expect(movedA.x).toBeCloseTo(line.fromX, 6);
    expect(movedA.y).toBeCloseTo(line.fromY, 6);
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('GRIP_EDIT committed');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('limits snapping to selected entity nodes while the entity stays selected', async () => {
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
          id: 'line:snap-filter-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'SF1',
          toStationId: 'SF2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
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
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:snap-filter-test"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Preview or line target not found');
    mockElementRect(preview);
    const lineMid = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 34, y: 15 });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lineMid.clientX,
          clientY: lineMid.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')).not.toBeNull();

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lineMid.clientX,
          clientY: lineMid.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
