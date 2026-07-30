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
  it('keeps the hovered side of a reversed line during live line-arc FILLET', async () => {
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
        id: 'line:fillet-live-reversed-line',
        type: 'line' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'RL2',
        toStationId: 'RL1',
        fromX: 30,
        fromY: 0,
        toX: -30,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'arc:fillet-live-reversed-target',
        type: 'arc' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        centerX: 20,
        centerY: 0,
        radius: 10,
        startAngleDeg: 180,
        endAngleDeg: 90,
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    const line = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:fillet-live-reversed-line"]',
    ) as SVGElement | null;
    const arc = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:fillet-live-reversed-target"]',
    ) as SVGElement | null;
    if (!preview || !commandInput || !line || !arc) {
      throw new Error('Live reversed line-arc FILLET controls not found');
    }
    mockElementRect(preview);

    const linePick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 18, y: 0 });
    const arcPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 10.5, y: 1 });

    await act(async () => {
      clickButton(container, 'FILLET');
      setTextInputValue(commandInput, '2');
      pressKey(commandInput, 'Enter');
      line.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: linePick.clientX,
          clientY: linePick.clientY,
          button: 0,
        }),
      );
      arc.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: arcPick.clientX,
          clientY: arcPick.clientY,
          button: 0,
        }),
      );
    });

    const updatedLine = capture.read()?.project.entities.find(
      (entity) => entity.id === 'line:fillet-live-reversed-line',
    );
    expect(updatedLine?.type).toBe('line');
    if (updatedLine?.type !== 'line') {
      throw new Error('Live reversed line fillet missing');
    }
    expect(updatedLine.fromX).toBeCloseTo(30, 6);
    expect(updatedLine.toX).toBeGreaterThan(10);
    expect(updatedLine.toX).toBeLessThan(30);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the hovered interior arc branch during live line-arc FILLET on a larger arc', async () => {
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
        id: 'line:live-large-arc-line',
        type: 'line' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'LAL1',
        toStationId: 'LAL2',
        fromX: -40,
        fromY: 40,
        toX: 60,
        toY: -60,
        sourceObservationIds: [],
      },
      {
        id: 'arc:live-large-arc-target',
        type: 'arc' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        centerX: 0,
        centerY: 0,
        radius: 35,
        startAngleDeg: 220,
        endAngleDeg: 20,
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    const line = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:live-large-arc-line"]',
    ) as SVGElement | null;
    const arc = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:live-large-arc-target"]',
    ) as SVGElement | null;
    if (!preview || !commandInput || !line || !arc) {
      throw new Error('Live large-arc FILLET controls not found');
    }
    mockElementRect(preview);

    const linePick = projectWorldToPreviewScreen(baseProject.bounds!, { x: -18, y: 18 });
    const arcPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 0, y: 35 });

    await act(async () => {
      clickButton(container, 'FILLET');
      setTextInputValue(commandInput, '5');
      pressKey(commandInput, 'Enter');
      line.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: linePick.clientX,
          clientY: linePick.clientY,
          button: 0,
        }),
      );
      arc.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: arcPick.clientX,
          clientY: arcPick.clientY,
          button: 0,
        }),
      );
    });

    const updatedArc = capture.read()?.project.entities.find(
      (entity) => entity.id === 'arc:live-large-arc-target',
    );
    expect(updatedArc?.type).toBe('arc');
    if (updatedArc?.type !== 'arc') {
      throw new Error('Live large-arc fillet missing');
    }
    expect(updatedArc.endAngleDeg).toBeCloseTo(20, 6);
    expect(updatedArc.startAngleDeg).toBeGreaterThan(220);
    expect(updatedArc.startAngleDeg).toBeLessThan(360);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates a start-end-radius arc from the arc dropdown and renders it as a path', async () => {
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

    const arcMenuButton = container.querySelector('[data-survey-cad-arc-menu-button]') as HTMLButtonElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!arcMenuButton || !commandInput) throw new Error('Arc menu or command input not found');

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Start End Radius');
    });
    await act(async () => {
      setTextInputValue(commandInput, '0,0');
    });
    await act(async () => {
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, '10,0');
    });
    await act(async () => {
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, '10');
    });
    await act(async () => {
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_SER committed',
    );
    expect(container.querySelectorAll('path.cursor-pointer').length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
