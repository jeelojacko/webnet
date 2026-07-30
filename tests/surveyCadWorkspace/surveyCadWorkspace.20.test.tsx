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
  it('creates a FILLET from a picked polyline segment and a line in the live workspace', async () => {
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
        id: 'polyline:fillet-live-source',
        type: 'polyline' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
        vertexLabels: ['FP1', 'FP2', 'FP3'],
        closed: false,
      },
      {
        id: 'line:fillet-live-boundary',
        type: 'line' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'FL1',
        toStationId: 'FL2',
        fromX: 0,
        fromY: 0,
        toX: 0,
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
    const polyline = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="polyline:fillet-live-source"]',
    ) as SVGElement | null;
    const boundary = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:fillet-live-boundary"]',
    ) as SVGElement | null;
    if (!preview || !commandInput || !polyline || !boundary) {
      throw new Error('Live polyline FILLET controls not found');
    }
    mockElementRect(preview);

    const polylinePick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 1, y: 0 });
    const boundaryPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 0, y: 1 });

    await act(async () => {
      clickButton(container, 'FILLET');
      setTextInputValue(commandInput, '2');
      pressKey(commandInput, 'Enter');
      polyline.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: polylinePick.clientX,
          clientY: polylinePick.clientY,
          button: 0,
        }),
      );
      boundary.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: boundaryPick.clientX,
          clientY: boundaryPick.clientY,
          button: 0,
        }),
      );
    });

    const updatedPolyline = capture.read()?.project.entities.find(
      (entity) => entity.id === 'polyline:fillet-live-source',
    );
    const updatedBoundary = capture.read()?.project.entities.find(
      (entity) => entity.id === 'line:fillet-live-boundary',
    );
    const committedArc = capture.read()?.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedPolyline?.type).toBe('polyline');
    expect(updatedBoundary?.type).toBe('line');
    expect(committedArc?.type).toBe('arc');
    if (updatedPolyline?.type !== 'polyline' || updatedBoundary?.type !== 'line' || committedArc?.type !== 'arc') {
      throw new Error('Live polyline FILLET entities missing');
    }
    expect(updatedPolyline.vertices[0]).toEqual({ x: 0, y: 0 });
    expect(updatedPolyline.vertices[1]).toEqual({ x: 2, y: 0 });
    expect(updatedBoundary.fromX).toBeCloseTo(0, 6);
    expect(updatedBoundary.toY).toBeCloseTo(2, 6);
    expect(committedArc.radius).toBeCloseTo(2, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps the neighboring polyline segment fixed by inserting a tangent vertex during live FILLET', async () => {
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
        id: 'polyline:live-shared-corner',
        type: 'polyline' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        vertices: [
          { x: 0, y: -10 },
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        vertexLabels: ['P1', 'P2', 'P3'],
        closed: false,
      },
      {
        id: 'line:live-shared-corner-target',
        type: 'line' as const,
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'SC1',
        toStationId: 'SC2',
        fromX: 0,
        fromY: 0,
        toX: -10,
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
    const polylineSegments = Array.from(
      container.querySelectorAll(
        '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="polyline:live-shared-corner"]',
      ),
    ) as SVGElement[];
    const line = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:live-shared-corner-target"]',
    ) as SVGElement | null;
    const polyline = polylineSegments[1] ?? null;
    if (!preview || !commandInput || !polyline || !line) {
      throw new Error('Live shared-corner FILLET controls not found');
    }
    mockElementRect(preview);

    const polylinePick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 4, y: 4 });
    const linePick = projectWorldToPreviewScreen(baseProject.bounds!, { x: -2, y: 2 });

    await act(async () => {
      clickButton(container, 'FILLET');
      setTextInputValue(commandInput, '2');
      pressKey(commandInput, 'Enter');
      polyline.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: polylinePick.clientX,
          clientY: polylinePick.clientY,
          button: 0,
        }),
      );
      line.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: linePick.clientX,
          clientY: linePick.clientY,
          button: 0,
        }),
      );
    });

    const updatedPolyline = capture.read()?.project.entities.find(
      (entity) => entity.id === 'polyline:live-shared-corner',
    );
    const committedArc = capture.read()?.project.entities.find(
      (entity) => entity.type === 'arc' && entity.metadata?.createdBy === 'FILLET',
    );
    expect(updatedPolyline?.type).toBe('polyline');
    expect(committedArc?.type).toBe('arc');
    if (updatedPolyline?.type !== 'polyline' || committedArc?.type !== 'arc') {
      throw new Error('Live shared-corner FILLET entities missing');
    }
    expect(updatedPolyline.vertices).toHaveLength(4);
    expect(updatedPolyline.vertices[0]).toEqual({ x: 0, y: -10 });
    expect(updatedPolyline.vertices[1]).toEqual({ x: 0, y: 0 });
    expect(updatedPolyline.vertices[2].x).toBeGreaterThan(0);
    expect(updatedPolyline.vertices[2].y).toBeGreaterThan(0);
    expect(updatedPolyline.vertices[3]).toEqual({ x: 10, y: 10 });
    expect(committedArc.radius).toBeCloseTo(2, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
