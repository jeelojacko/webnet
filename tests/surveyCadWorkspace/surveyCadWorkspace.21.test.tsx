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
  it('shows preview and commits a FILLET between a line and an arc while keeping the clicked line ray', async () => {
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
        id: 'line:fillet-live-line-arc',
        type: 'line' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'LA1',
        toStationId: 'LA2',
        fromX: 0,
        fromY: 0,
        toX: 10,
        toY: 0,
        sourceObservationIds: [],
      },
      {
        id: 'arc:fillet-live-target',
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
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:fillet-live-line-arc"]',
    ) as SVGElement | null;
    const arc = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:fillet-live-target"]',
    ) as SVGElement | null;
    if (!preview || !commandInput || !line || !arc) {
      throw new Error('Live line-arc FILLET controls not found');
    }
    mockElementRect(preview);

    const linePick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 9, y: 0 });
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
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcPick.clientX,
          clientY: arcPick.clientY,
        }),
      );
      arc.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcPick.clientX,
          clientY: arcPick.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-preview-arc]')).not.toBeNull();

    await act(async () => {
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
      (entity) => entity.id === 'line:fillet-live-line-arc',
    );
    const updatedArc = capture.read()?.project.entities.find(
      (entity) => entity.id === 'arc:fillet-live-target',
    );
    const committedArc = capture.read()?.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedLine?.type).toBe('line');
    expect(updatedArc?.type).toBe('arc');
    expect(committedArc?.type).toBe('arc');
    if (updatedLine?.type !== 'line' || updatedArc?.type !== 'arc' || committedArc?.type !== 'arc') {
      throw new Error('Live line-arc FILLET entities missing');
    }
    expect(updatedLine.fromX).toBeGreaterThan(7);
    expect(updatedLine.fromX).toBeLessThan(10);
    expect(updatedLine.toX).toBeCloseTo(10, 6);
    expect(updatedArc.startAngleDeg).toBeGreaterThan(160);
    expect(updatedArc.startAngleDeg).toBeLessThan(180);
    expect(committedArc.radius).toBeCloseTo(2, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('supports arc-first FILLET picks against a polyline segment in the live workspace', async () => {
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
        id: 'arc:live-first-arc',
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
      {
        id: 'polyline:live-arc-polyline',
        type: 'polyline' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: -10 },
        ],
        vertexLabels: ['AP1', 'AP2', 'AP3'],
        closed: false,
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
    const arc = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:live-first-arc"]',
    ) as SVGElement | null;
    const polyline = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="polyline:live-arc-polyline"]',
    ) as SVGElement | null;
    if (!preview || !commandInput || !arc || !polyline) {
      throw new Error('Live arc-first polyline FILLET controls not found');
    }
    mockElementRect(preview);

    const arcPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 10.5, y: 1 });
    const polylinePick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 9, y: 0 });

    await act(async () => {
      clickButton(container, 'FILLET');
      setTextInputValue(commandInput, '2');
      pressKey(commandInput, 'Enter');
      arc.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: arcPick.clientX,
          clientY: arcPick.clientY,
          button: 0,
        }),
      );
      polyline.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: polylinePick.clientX,
          clientY: polylinePick.clientY,
          button: 0,
        }),
      );
    });

    const updatedArc = capture.read()?.project.entities.find(
      (entity) => entity.id === 'arc:live-first-arc',
    );
    const updatedPolyline = capture.read()?.project.entities.find(
      (entity) => entity.id === 'polyline:live-arc-polyline',
    );
    const committedArc = capture.read()?.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedArc?.type).toBe('arc');
    expect(updatedPolyline?.type).toBe('polyline');
    expect(committedArc?.type).toBe('arc');
    if (updatedArc?.type !== 'arc' || updatedPolyline?.type !== 'polyline' || committedArc?.type !== 'arc') {
      throw new Error('Live arc-first polyline FILLET entities missing');
    }
    expect(updatedArc.startAngleDeg).toBeGreaterThan(160);
    expect(updatedArc.startAngleDeg).toBeLessThan(180);
    expect(updatedPolyline.vertices[0].x).toBeGreaterThan(7);
    expect(updatedPolyline.vertices[0].x).toBeLessThan(10);
    expect(updatedPolyline.vertices[1]).toEqual({ x: 10, y: 0 });
    expect(committedArc.radius).toBeCloseTo(2, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
