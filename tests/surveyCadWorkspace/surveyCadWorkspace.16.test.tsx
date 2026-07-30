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
  it('runs repeatable TRIM from the command surface as a first-pick/second-pick loop one pair at a time', async () => {
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
    const baseProject = appendCadProjectEntities(
      originalProject,
      [
        {
          id: 'line:trim-cutter',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'TC1',
          toStationId: 'TC2',
          fromX: 30,
          fromY: 0,
          toX: 30,
          toY: 40,
          sourceObservationIds: [],
        },
        {
          id: 'line:trim-target-1',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'TT1',
          toStationId: 'TT2',
          fromX: 10,
          fromY: 20,
          toX: 50,
          toY: 20,
          sourceObservationIds: [],
        },
        {
          id: 'line:trim-target-2',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'TT3',
          toStationId: 'TT4',
          fromX: 10,
          fromY: 10,
          toX: 50,
          toY: 10,
          sourceObservationIds: [],
        },
      ],
    );

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
    const cutter = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:trim-cutter"]',
    ) as SVGLineElement | null;
    const trimTarget1 = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:trim-target-1"]',
    ) as SVGLineElement | null;
    const trimTarget2 = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:trim-target-2"]',
    ) as SVGLineElement | null;
    if (!preview || !cutter || !trimTarget1 || !trimTarget2) throw new Error('Trim targets not found');
    mockElementRect(preview);

    const cutterPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 30, y: 30 });
    const removeRightPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 40, y: 20 });
    const removeLeftPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 20, y: 10 });

    await act(async () => {
      clickButton(container, 'TRIM');
    });

    await act(async () => {
      cutter.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: cutterPick.clientX,
          clientY: cutterPick.clientY,
          button: 0,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'first entity captured',
    );

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: removeRightPick.clientX,
          clientY: removeRightPick.clientY,
        }),
      );
      trimTarget1.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: removeRightPick.clientX,
          clientY: removeRightPick.clientY,
        }),
      );
    });

    const dimmedTarget = container.querySelector(
      '[data-survey-cad-render-entity-id="line:trim-target-1"]',
    ) as SVGLineElement | null;
    const trimPreviewLines = Array.from(
      container.querySelectorAll('[data-survey-cad-command-preview-line]'),
    ) as SVGLineElement[];

    expect(dimmedTarget?.getAttribute('opacity')).toBe('0.22');
    expect(trimPreviewLines).toHaveLength(1);

    await act(async () => {
      trimTarget1.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: removeRightPick.clientX,
          clientY: removeRightPick.clientY,
          button: 0,
        }),
      );
      trimTarget1.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: removeRightPick.clientX,
          clientY: removeRightPick.clientY,
          button: 0,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'Click the next cutting edge, then the next target',
    );

    await act(async () => {
      cutter.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: cutterPick.clientX,
          clientY: cutterPick.clientY,
          button: 0,
        }),
      );
      trimTarget2.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: removeLeftPick.clientX,
          clientY: removeLeftPick.clientY,
          button: 0,
        }),
      );
    });

    const trimmedTargets = capture.read()?.project.entities.filter(
      (entity) =>
        entity.type === 'line' &&
        entity.id !== 'line:trim-cutter' &&
        ((entity.fromY === 20 && entity.toY === 20) || (entity.fromY === 10 && entity.toY === 10)),
    );
    expect(trimmedTargets).toHaveLength(2);
    expect(
      trimmedTargets?.some((entity) => entity.type === 'line' && entity.fromY === 20 && entity.fromX === 10 && entity.toX === 30),
    ).toBe(true);
    expect(
      trimmedTargets?.some((entity) => entity.type === 'line' && entity.fromY === 10 && entity.fromX === 30 && entity.toX === 50),
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('centers the command status/help overlay above the command bar so long prompts stay clear of the input lane', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const capture = createPersistedStateCapture();

    await act(async () => {
      root.render(
        <SurveyCadWorkspace
          input={input}
          instrumentLibrary={{}}
          parseOptions={parseOptions}
          units="m"
          result={null}
          persistedState={null}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const commandHelp = container.querySelector('[data-survey-cad-command-help]') as HTMLDivElement | null;
    expect(commandHelp?.className).toContain('left-1/2');
    expect(commandHelp?.className).toContain('-translate-x-1/2');
    expect(commandHelp?.className).toContain('bottom-16');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
