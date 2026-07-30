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
  setTextInputValue,
  pressKey,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('reuses one FILLET radius across multiple line corners and cancels on empty-space double click', async () => {
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
    const filletProject = appendCadProjectEntities(baseProject, [
      {
        id: 'line:fillet-a1',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'FA1',
        toStationId: 'FA2',
        fromX: 0,
        fromY: 0,
        toX: 10,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'line:fillet-b1',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'FB1',
        toStationId: 'FB2',
        fromX: 0,
        fromY: 0,
        toX: 0,
        toY: 10,
        sourceObservationIds: [],
      },
      {
        id: 'line:fillet-a2',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'FC1',
        toStationId: 'FC2',
        fromX: 20,
        fromY: 0,
        toX: 30,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'line:fillet-b2',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'FD1',
        toStationId: 'FD2',
        fromX: 20,
        fromY: 0,
        toX: 20,
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
            sourceSignature: buildCadProjectSignature(baseProject),
            project: filletProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    const firstHorizontal = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:fillet-a1"]',
    ) as SVGLineElement | null;
    const firstVertical = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:fillet-b1"]',
    ) as SVGLineElement | null;
    const secondHorizontal = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:fillet-a2"]',
    ) as SVGLineElement | null;
    const secondVertical = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:fillet-b2"]',
    ) as SVGLineElement | null;
    if (!preview || !commandInput || !background || !firstHorizontal || !firstVertical || !secondHorizontal || !secondVertical) {
      throw new Error('Fillet workspace controls not found');
    }
    mockElementRect(preview);

    const firstPickA = projectWorldToPreviewScreen(filletProject.bounds!, { x: 1, y: 0 });
    const firstPickB = projectWorldToPreviewScreen(filletProject.bounds!, { x: 0, y: 1 });
    const secondPickA = projectWorldToPreviewScreen(filletProject.bounds!, { x: 21, y: 0 });
    const secondPickB = projectWorldToPreviewScreen(filletProject.bounds!, { x: 20, y: 1 });

    await act(async () => {
      clickButton(container, 'FILLET');
      setTextInputValue(commandInput, '2');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('radius 2.000');

    await act(async () => {
      firstHorizontal.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: firstPickA.clientX,
          clientY: firstPickA.clientY,
          button: 0,
        }),
      );
      firstVertical.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: firstPickB.clientX,
          clientY: firstPickB.clientY,
          button: 0,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('still active');

    await act(async () => {
      secondHorizontal.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: secondPickA.clientX,
          clientY: secondPickA.clientY,
          button: 0,
        }),
      );
      secondVertical.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: secondPickB.clientX,
          clientY: secondPickB.clientY,
          button: 0,
        }),
      );
    });

    expect(
      capture.read()?.project.entities.filter(
        (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
      ),
    ).toHaveLength(2);

    await act(async () => {
      background.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, button: 0 }));
    });

    expect(commandInput.disabled).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
