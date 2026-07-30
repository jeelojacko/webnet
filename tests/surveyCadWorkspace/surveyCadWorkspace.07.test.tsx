/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  SurveyCadPreview,
  mockElementRect,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('uses the active snap when clicking the background during command drafting', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const consumeInteractionPoint = vi.fn();

    await act(async () => {
      root.render(
        <SurveyCadPreview
          scene={{ primitives: [], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }}
          viewBounds={{ minX: 0, minY: 0, maxX: 10, maxY: 10 }}
          selectedEntityIds={[]}
          selectedParcelReport={null}
          activeSnap={{
            id: 'midpoint:pline:chain:P1-P2',
            kind: 'midpoint',
            sourceEntityId: 'pline:chain',
            sourceSegmentId: 'pline:chain#0',
            x: 5,
            y: 0,
            distance: 0.1,
            label: 'P1-P2',
          }}
          commandPreviewPrimitives={[]}
          commandStatusText=""
          commandHelpText=""
          commandModifierHint=""
          constructionHint=""
          snapPreferences={{
            'point-node': true,
            endpoint: true,
            midpoint: true,
            center: true,
            'arc-midpoint': true,
            quadrant: true,
            intersection: true,
            'apparent-intersection': true,
            extension: true,
            perpendicular: true,
            parallel: true,
            direction: true,
            tangent: true,
            nearest: true,
          }}
          commandInputValue=""
          commandInputPlaceholder=""
          commandInputEnabled={false}
          viewport={{ zoom: 1, panX: 0, panY: 0 }}
          commandActive
          commandPointInputActive
          onViewportChange={() => null}
          onSelectEntity={() => null}
          onSelectEntities={() => null}
          onConsumeInteractionPoint={consumeInteractionPoint}
          onPointerWorldPointChange={() => null}
          onSnapPreferenceChange={() => null}
          onCommandInputChange={() => null}
          onCommandInputEnter={() => null}
          onCommandInputEscape={() => null}
          onZoomExtents={() => null}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 220,
          clientY: 220,
        }),
      );
    });

    expect(consumeInteractionPoint).toHaveBeenCalledWith(
      { x: 5, y: 0 },
      'P1-P2',
      {
        extendMode: false,
        snapSourceSegmentId: 'pline:chain#0',
        snapSourceEntityId: 'pline:chain',
        snapKind: 'midpoint',
      },
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('latches the visible snap on mouse down so click still commits it after hover drift', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const consumeInteractionPoint = vi.fn();

    const renderPreview = (activeSnap: {
      id: string;
      kind: 'midpoint';
      sourceEntityId: string;
      sourceSegmentId: string;
      x: number;
      y: number;
      distance: number;
      label: string;
    } | null) =>
      root.render(
        <SurveyCadPreview
          scene={{ primitives: [], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }}
          viewBounds={{ minX: 0, minY: 0, maxX: 10, maxY: 10 }}
          selectedEntityIds={[]}
          selectedParcelReport={null}
          activeSnap={activeSnap}
          commandPreviewPrimitives={[]}
          commandStatusText=""
          commandHelpText=""
          commandModifierHint=""
          constructionHint=""
          snapPreferences={{
            'point-node': true,
            endpoint: true,
            midpoint: true,
            center: true,
            'arc-midpoint': true,
            quadrant: true,
            intersection: true,
            'apparent-intersection': true,
            extension: true,
            perpendicular: true,
            parallel: true,
            direction: true,
            tangent: true,
            nearest: true,
          }}
          commandInputValue=""
          commandInputPlaceholder=""
          commandInputEnabled={false}
          viewport={{ zoom: 1, panX: 0, panY: 0 }}
          commandActive
          commandPointInputActive
          onViewportChange={() => null}
          onSelectEntity={() => null}
          onSelectEntities={() => null}
          onConsumeInteractionPoint={consumeInteractionPoint}
          onPointerWorldPointChange={() => null}
          onSnapPreferenceChange={() => null}
          onCommandInputChange={() => null}
          onCommandInputEnter={() => null}
          onCommandInputEscape={() => null}
          onZoomExtents={() => null}
        />,
      );

    await act(async () => {
      renderPreview({
        id: 'midpoint:pline:chain:P1-P2',
        kind: 'midpoint',
        sourceEntityId: 'pline:chain',
        sourceSegmentId: 'pline:chain#0',
        x: 5,
        y: 0,
        distance: 0.1,
        label: 'P1-P2',
      });
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 220,
          clientY: 320,
        }),
      );
    });

    await act(async () => {
      renderPreview(null);
    });

    const rerenderedBackground = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!rerenderedBackground) throw new Error('Rerendered preview background not found');
    mockElementRect(rerenderedBackground);

    await act(async () => {
      rerenderedBackground.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 260,
          clientY: 360,
        }),
      );
    });

    expect(consumeInteractionPoint).toHaveBeenCalledWith(
      { x: 5, y: 0 },
      'P1-P2',
      {
        extendMode: false,
        snapSourceSegmentId: 'pline:chain#0',
        snapSourceEntityId: 'pline:chain',
        snapKind: 'midpoint',
      },
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shrinks snap query tolerance and visible snap window as viewport zoom increases', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const pointerWorldPointChange = vi.fn();

    const renderPreview = (zoom: number) =>
      root.render(
        <SurveyCadPreview
          scene={{ primitives: [], bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } }}
          viewBounds={{ minX: 0, minY: 0, maxX: 100, maxY: 100 }}
          selectedEntityIds={[]}
          selectedParcelReport={null}
          activeSnap={null}
          commandPreviewPrimitives={[]}
          commandStatusText=""
          commandHelpText=""
          commandModifierHint=""
          constructionHint=""
          snapPreferences={{
            'point-node': true,
            endpoint: true,
            midpoint: true,
            center: true,
            'arc-midpoint': true,
            quadrant: true,
            intersection: true,
            'apparent-intersection': true,
            extension: true,
            perpendicular: true,
            parallel: true,
            direction: true,
            tangent: true,
            nearest: true,
          }}
          commandInputValue=""
          commandInputPlaceholder=""
          commandInputEnabled={false}
          viewport={{ zoom, panX: 0, panY: 0 }}
          commandActive
          commandPointInputActive
          onViewportChange={() => null}
          onSelectEntity={() => null}
          onSelectEntities={() => null}
          onConsumeInteractionPoint={() => null}
          onPointerWorldPointChange={pointerWorldPointChange}
          onSnapPreferenceChange={() => null}
          onCommandInputChange={() => null}
          onCommandInputEnter={() => null}
          onCommandInputEscape={() => null}
          onZoomExtents={() => null}
        />,
      );

    await act(async () => {
      renderPreview(1);
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!preview) throw new Error('Preview not found');
    const initialPreview = preview;
    mockElementRect(initialPreview);

    await act(async () => {
      initialPreview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 450,
          clientY: 260,
        }),
      );
    });

    const firstCall = pointerWorldPointChange.mock.calls.at(-1);
    if (!firstCall) throw new Error('First pointer callback not captured');

    await act(async () => {
      renderPreview(64);
    });

    const rerenderedPreview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!rerenderedPreview) throw new Error('Preview not found after rerender');
    mockElementRect(rerenderedPreview);

    await act(async () => {
      rerenderedPreview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 450,
          clientY: 260,
        }),
      );
    });

    const secondCall = pointerWorldPointChange.mock.calls.at(-1);
    if (!secondCall) throw new Error('Second pointer callback not captured');
    expect(secondCall[1]).toBeLessThan(firstCall[1]);
    expect(secondCall[2]?.visibleBounds.maxX - secondCall[2]?.visibleBounds.minX).toBeLessThan(
      firstCall[2]?.visibleBounds.maxX - firstCall[2]?.visibleBounds.minX,
    );
    expect(secondCall[2]?.visibleBounds.maxY - secondCall[2]?.visibleBounds.minY).toBeLessThan(
      firstCall[2]?.visibleBounds.maxY - firstCall[2]?.visibleBounds.minY,
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
