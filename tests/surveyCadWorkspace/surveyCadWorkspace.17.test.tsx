/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  buildSurveyCadSpikeProject,
  appendCadProjectEntities,
  buildCadProjectSignature,
  input,
  parseOptions,
  mockElementRect,
  projectWorldToPreviewScreen,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('runs repeatable EXT from the command surface by capturing a source entity first and then extending it to picked boundaries', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const capture = createPersistedStateCapture();

    const originalProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const baseProject = appendCadProjectEntities(originalProject, [
      {
        id: 'line:extend-boundary-1',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'EB1',
        toStationId: 'EB2',
        fromX: 30,
        fromY: -10,
        toX: 30,
        toY: 20,
        sourceObservationIds: [],
      },
      {
        id: 'line:extend-boundary-2',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'EC1',
        toStationId: 'EC2',
        fromX: 55,
        fromY: -10,
        toX: 55,
        toY: 20,
        sourceObservationIds: [],
      },
      {
        id: 'line:extend-target-1',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'ET1',
        toStationId: 'ET2',
        fromX: 0,
        fromY: 0,
        toX: 20,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'line:extend-target-2',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'EU1',
        toStationId: 'EU2',
        fromX: 0,
        fromY: 10,
        toX: 25,
        toY: 10,
        sourceObservationIds: [],
      },
    ]);

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
            sourceSignature: buildCadProjectSignature(originalProject),
            project: baseProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const boundary1 = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:extend-boundary-1"]',
    ) as SVGLineElement | null;
    const boundary2 = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:extend-boundary-2"]',
    ) as SVGLineElement | null;
    const target1 = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:extend-target-1"]',
    ) as SVGLineElement | null;
    const target2 = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:extend-target-2"]',
    ) as SVGLineElement | null;
    if (!preview || !boundary1 || !boundary2 || !target1 || !target2) throw new Error('Extend targets not found');
    mockElementRect(preview);

    const target1Pick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 19, y: 0 });
    const target2Pick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 24, y: 10 });
    const boundary1Pick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 30, y: 0 });
    const boundary2Pick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 55, y: 10 });

    await act(async () => {
      clickButton(container, 'EXT');
    });

    await act(async () => {
      target1.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: target1Pick.clientX,
          clientY: target1Pick.clientY,
          button: 0,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'source entity captured',
    );

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: boundary1Pick.clientX,
          clientY: boundary1Pick.clientY,
        }),
      );
      boundary1.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: boundary1Pick.clientX,
          clientY: boundary1Pick.clientY,
        }),
      );
    });

    const extendPreviewLines = Array.from(
      container.querySelectorAll('[data-survey-cad-command-preview-line]'),
    ) as SVGLineElement[];
    expect(extendPreviewLines).toHaveLength(1);

    await act(async () => {
      boundary1.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: boundary1Pick.clientX,
          clientY: boundary1Pick.clientY,
          button: 0,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'Click the next entity to extend',
    );

    await act(async () => {
      target2.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: target2Pick.clientX,
          clientY: target2Pick.clientY,
          button: 0,
        }),
      );
      boundary2.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: boundary2Pick.clientX,
          clientY: boundary2Pick.clientY,
          button: 0,
        }),
      );
    });

    const extendedTargets = capture.read()?.project.entities.filter(
      (entity) => entity.type === 'line' && (entity.id === 'line:extend-target-1' || entity.id === 'line:extend-target-2'),
    );
    expect(extendedTargets).toHaveLength(2);
    const extendedTarget1 = extendedTargets?.find((entity) => entity.id === 'line:extend-target-1');
    const extendedTarget2 = extendedTargets?.find((entity) => entity.id === 'line:extend-target-2');
    expect(extendedTarget1?.type).toBe('line');
    expect(extendedTarget2?.type).toBe('line');
    if (extendedTarget1?.type !== 'line' || extendedTarget2?.type !== 'line') {
      throw new Error('Extended targets missing');
    }
    expect(extendedTarget1.toX).toBeCloseTo(30, 6);
    expect(extendedTarget2.toX).toBeCloseTo(55, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
