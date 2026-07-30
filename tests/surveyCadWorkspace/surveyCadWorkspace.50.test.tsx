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
  it('shows arc endpoint and radius grips, keeps endpoint edits on-arc, and updates radius grip edits', async () => {
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
          id: 'cad-arc-grip-test',
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
          metadata: {
            entityName: 'CURVE1',
          },
        },
        {
          id: 'pt:BC1',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'BC1',
          x: 62,
          y: 20,
          pointClass: 'free' as const,
          source: 'parsed-input' as const,
          metadata: {
            anchorCurveEntityId: 'cad-arc-grip-test',
            curvePointRole: 'begin',
          },
        },
        {
          id: 'pt:R1',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'R1',
          x: 50,
          y: 20,
          pointClass: 'free' as const,
          source: 'parsed-input' as const,
          metadata: {
            anchorCurveEntityId: 'cad-arc-grip-test',
            curvePointRole: 'radius',
          },
        },
        {
          id: 'pt:MP1',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'MP1',
          x: 50,
          y: 32,
          pointClass: 'free' as const,
          source: 'parsed-input' as const,
          metadata: {
            anchorCurveEntityId: 'cad-arc-grip-test',
            curvePointRole: 'mid',
          },
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
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="cad-arc-grip-test"]',
    ) as SVGPathElement | null;
    if (!preview || !arcTarget) throw new Error('Preview or arc target not found');
    mockElementRect(preview);

    await act(async () => {
      arcTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelectorAll('[data-survey-cad-grip-handle]')).toHaveLength(3);
    expect(container.querySelector('[data-survey-cad-grip-handle="arc-radius"]')).not.toBeNull();

    const radiusHover = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 50, y: 32 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: radiusHover.clientX,
          clientY: radiusHover.clientY,
        }),
      );
    });

    const radiusBadge = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(radiusBadge).toContain('R1');
    expect(radiusBadge).not.toContain('cad-arc-grip-test');

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Arc start handle not found');
    const movedStart = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 56, y: 9.607695 });

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

    let arc = capture.read()?.project.entities.find((entity) => entity.id === 'cad-arc-grip-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Dragged arc not found');
    const movedStartX = arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    const movedStartY = arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    expect(movedStartX).toBeCloseTo(56, 3);
    expect(movedStartY).toBeCloseTo(9.607695, 3);
    expect(arc.radius).toBeCloseTo(12, 6);
    const movedBeginPoint = capture.read()?.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'BC1',
    );
    const movedMidPoint = capture.read()?.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'MP1',
    );
    expect(movedBeginPoint?.type).toBe('survey-point');
    expect(movedMidPoint?.type).toBe('survey-point');
    if (movedBeginPoint?.type !== 'survey-point' || movedMidPoint?.type !== 'survey-point') {
      throw new Error('Moved support points not found');
    }
    expect(movedBeginPoint.x).toBeCloseTo(movedStartX, 3);
    expect(movedBeginPoint.y).toBeCloseTo(movedStartY, 3);
    expect(movedMidPoint.x).not.toBeCloseTo(50, 6);
    expect(movedMidPoint.y).not.toBeCloseTo(32, 6);

    const radiusHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-radius"]',
    ) as SVGCircleElement | null;
    if (!radiusHandle) throw new Error('Arc radius handle not found');
    const movedRadius = projectWorldToPreviewScreen(capture.read()!.project.bounds!, { x: 50, y: 38 });

    await act(async () => {
      radiusHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: movedRadius.clientX,
          clientY: movedRadius.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: movedRadius.clientX,
          clientY: movedRadius.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: movedRadius.clientX,
          clientY: movedRadius.clientY,
        }),
      );
    });

    arc = capture.read()?.project.entities.find((entity) => entity.id === 'cad-arc-grip-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Radius-edited arc not found');
    expect(arc.radius).toBeCloseTo(18, 3);
    const radiusPoint = capture.read()?.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'R1',
    );
    const resizedBeginPoint = capture.read()?.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.stationId === 'BC1',
    );
    expect(radiusPoint?.type).toBe('survey-point');
    expect(resizedBeginPoint?.type).toBe('survey-point');
    if (radiusPoint?.type !== 'survey-point' || resizedBeginPoint?.type !== 'survey-point') {
      throw new Error('Resized support points not found');
    }
    expect(radiusPoint.x).toBeCloseTo(50, 6);
    expect(radiusPoint.y).toBeCloseTo(20, 6);
    const resizedStartX = arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    const resizedStartY = arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    expect(resizedBeginPoint.x).toBeCloseTo(resizedStartX, 3);
    expect(resizedBeginPoint.y).toBeCloseTo(resizedStartY, 3);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
