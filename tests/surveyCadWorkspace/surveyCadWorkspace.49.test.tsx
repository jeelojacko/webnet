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
  it('shows vertex grips for polylines and drags the chosen vertex', async () => {
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
          id: 'polyline:grip-test',
          type: 'polyline' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          vertices: [
            { x: 16, y: 8 },
            { x: 28, y: 14 },
            { x: 40, y: 9 },
            { x: 52, y: 16 },
          ],
          vertexLabels: ['P1', 'P2', 'P3', 'P4'],
          closed: false,
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
    const polylineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="polyline:grip-test"]',
    ) as SVGLineElement | null;
    if (!preview || !polylineTarget) throw new Error('Preview or polyline target not found');
    mockElementRect(preview);

    await act(async () => {
      polylineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelectorAll('[data-survey-cad-grip-handle="vertex"]')).toHaveLength(4);

    const hoverVertex = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 28, y: 14 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: hoverVertex.clientX,
          clientY: hoverVertex.clientY,
        }),
      );
    });

    const vertexBadge = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(vertexBadge).toContain('P2');
    expect(vertexBadge).not.toContain('polyline:grip-test');
    expect(vertexBadge).not.toContain(':vertex:');

    const vertexHandle = container.querySelector(
      '[data-survey-cad-grip-handle-id="polyline:grip-test:vertex:1"]',
    ) as SVGCircleElement | null;
    if (!vertexHandle) throw new Error('Polyline vertex handle not found');
    const movedVertex = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 30, y: 22 });

    await act(async () => {
      vertexHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
        }),
      );
    });

    const polyline = capture.read()?.project.entities.find((entity) => entity.id === 'polyline:grip-test');
    expect(polyline?.type).toBe('polyline');
    if (polyline?.type !== 'polyline') throw new Error('Dragged polyline not found');
    expect(polyline.vertices[1]?.x).toBeCloseTo(30, 6);
    expect(polyline.vertices[1]?.y).toBeCloseTo(22, 6);
    const movedP2 = capture.read()?.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'P2',
    );
    if (movedP2?.type === 'survey-point') {
      expect(movedP2.x).toBeCloseTo(30, 6);
      expect(movedP2.y).toBeCloseTo(22, 6);
    }

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows vertex grips for polygons and commits dragged polygon corners', async () => {
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
          id: 'polygon:grip-test',
          type: 'polygon' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          vertices: [
            { x: 18, y: 8 },
            { x: 34, y: 8 },
            { x: 36, y: 20 },
            { x: 16, y: 18 },
          ],
          vertexLabels: ['G1', 'G2', 'G3', 'G4'],
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
    const polygonTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="polygon:grip-test"]',
    ) as SVGLineElement | null;
    if (!preview || !polygonTarget) throw new Error('Preview or polygon target not found');
    mockElementRect(preview);

    await act(async () => {
      polygonTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelectorAll('[data-survey-cad-grip-handle="vertex"]')).toHaveLength(4);

    const vertexHandle = container.querySelector(
      '[data-survey-cad-grip-handle-id="polygon:grip-test:vertex:2"]',
    ) as SVGCircleElement | null;
    if (!vertexHandle) throw new Error('Polygon vertex handle not found');
    const movedVertex = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 42, y: 26 });

    await act(async () => {
      vertexHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
        }),
      );
    });

    const polygon = capture.read()?.project.entities.find((entity) => entity.id === 'polygon:grip-test');
    expect(polygon?.type).toBe('polygon');
    if (polygon?.type !== 'polygon') throw new Error('Dragged polygon not found');
    expect(polygon.vertices[2]?.x).toBeCloseTo(42, 6);
    expect(polygon.vertices[2]?.y).toBeCloseTo(26, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
