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
  it('shows a live FILLET preview before commit and then creates the fillet arc from the same command flow', async () => {
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
          id: 'line:fillet-cross-a',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'FX1',
          toStationId: 'FX2',
          fromX: -10,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:fillet-cross-b',
          type: 'line',
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'FY1',
          toStationId: 'FY2',
          fromX: 0,
          fromY: -10,
          toX: 0,
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    const horizontal = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:fillet-cross-a"]',
    ) as SVGLineElement | null;
    const vertical = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:fillet-cross-b"]',
    ) as SVGLineElement | null;
    if (!preview || !commandInput || !horizontal || !vertical) throw new Error('Fillet side controls not found');
    mockElementRect(preview);

    const firstPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 1, y: 0 });
    const upperPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 0, y: 1 });
    const lowerPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 0, y: -1 });

    await act(async () => {
      clickButton(container, 'FILLET');
      setTextInputValue(commandInput, '2');
      pressKey(commandInput, 'Enter');
      horizontal.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: firstPick.clientX,
          clientY: firstPick.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: upperPick.clientX,
          clientY: upperPick.clientY,
        }),
      );
      vertical.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: upperPick.clientX,
          clientY: upperPick.clientY,
        }),
      );
    });

    const upperPreviewPath =
      (container.querySelector('[data-survey-cad-command-preview-arc]') as SVGPathElement | null)?.getAttribute('d') ??
      '';
    expect(upperPreviewPath).not.toBe('');

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lowerPick.clientX,
          clientY: lowerPick.clientY,
        }),
      );
      vertical.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lowerPick.clientX,
          clientY: lowerPick.clientY,
        }),
      );
    });

    await act(async () => {
      vertical.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: lowerPick.clientX,
          clientY: lowerPick.clientY,
          button: 0,
        }),
      );
    });

    const committedArc = capture.read()?.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(committedArc?.type).toBe('arc');
    if (committedArc?.type !== 'arc') throw new Error('Committed fillet arc not found');
    expect(committedArc.radius).toBeCloseTo(2, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the hovered survivor rays for live FILLET on crossing interior line picks', async () => {
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
        id: 'line:live-crossing-diagonal',
        type: 'line' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'XD1',
        toStationId: 'XD2',
        fromX: 0,
        fromY: 0,
        toX: 20,
        toY: 20,
        sourceObservationIds: [],
      },
      {
        id: 'line:live-crossing-horizontal',
        type: 'line' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'XH1',
        toStationId: 'XH2',
        fromX: -10,
        fromY: 10,
        toX: 30,
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    const diagonal = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:live-crossing-diagonal"]',
    ) as SVGElement | null;
    const horizontal = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:live-crossing-horizontal"]',
    ) as SVGElement | null;
    if (!preview || !commandInput || !diagonal || !horizontal) {
      throw new Error('Live crossing FILLET controls not found');
    }
    mockElementRect(preview);

    const diagonalPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 13, y: 13 });
    const horizontalPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 15, y: 10 });

    await act(async () => {
      clickButton(container, 'FILLET');
      setTextInputValue(commandInput, '2');
      pressKey(commandInput, 'Enter');
      diagonal.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: diagonalPick.clientX,
          clientY: diagonalPick.clientY,
          button: 0,
        }),
      );
      horizontal.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: horizontalPick.clientX,
          clientY: horizontalPick.clientY,
          button: 0,
        }),
      );
    });

    const updatedDiagonal = capture.read()?.project.entities.find(
      (entity) => entity.id === 'line:live-crossing-diagonal',
    );
    const updatedHorizontal = capture.read()?.project.entities.find(
      (entity) => entity.id === 'line:live-crossing-horizontal',
    );
    const committedArc = capture.read()?.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedDiagonal?.type).toBe('line');
    expect(updatedHorizontal?.type).toBe('line');
    expect(committedArc?.type).toBe('arc');
    if (updatedDiagonal?.type !== 'line' || updatedHorizontal?.type !== 'line' || committedArc?.type !== 'arc') {
      throw new Error('Live crossing FILLET entities missing');
    }
    expect(updatedDiagonal.toX).toBeCloseTo(20, 6);
    expect(updatedDiagonal.toY).toBeCloseTo(20, 6);
    expect(updatedDiagonal.fromX).toBeGreaterThan(10);
    expect(updatedDiagonal.fromY).toBeGreaterThan(10);
    expect(updatedHorizontal.toX).toBeCloseTo(30, 6);
    expect(updatedHorizontal.fromX).toBeGreaterThan(10);
    expect(committedArc.radius).toBeCloseTo(2, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
