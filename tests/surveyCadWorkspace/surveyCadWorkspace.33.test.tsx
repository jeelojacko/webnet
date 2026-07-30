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
  dispatchSyntheticPointerEvent,
  clickButton,
  ParentBackedParcelLayoutWorkspace,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('supports floating parcel layout drag and resize while keeping a compact shell', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const capture = createPersistedStateCapture();

    const previousInnerWidth = window.innerWidth;
    const previousInnerHeight = window.innerHeight;

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 720,
    });

    const originalProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const persistedProject = {
      ...originalProject,
      entities: [
        {
          id: 'parcel:source',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel 1',
          vertices: [
            { x: 0, y: 0 },
            { x: 25, y: 0 },
            { x: 25, y: 15 },
          ],
          vertexLabels: ['A', 'P1', 'P2'],
          areaSquareMeters: 187.5,
          perimeterMeters: 69.154759,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 25, maxY: 15 },
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
            sourceSignature: buildCadProjectSignature(originalProject),
            project: persistedProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const parcelTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="parcel:source"]',
    ) as SVGElement | null;
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!parcelTarget || !parcelMenuButton) throw new Error('Parcel layout floating controls not found');

    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Layout Tools');
    });
    const floatButton = Array.from(
      (container.querySelector('[data-survey-cad-parcel-layout-panel-header]') as HTMLDivElement | null)?.querySelectorAll('button') ?? [],
    ).find((entry) => entry.textContent?.trim() === 'Float') as HTMLButtonElement | undefined;
    if (!floatButton) throw new Error('Float button not found');
    await act(async () => {
      dispatchSyntheticPointerEvent(floatButton, 'pointerdown', {
        pointerId: 7,
        button: 0,
        clientX: 40,
        clientY: 120,
      });
      floatButton.click();
      dispatchSyntheticPointerEvent(window, 'pointermove', {
        pointerId: 7,
        clientX: 260,
        clientY: 280,
      });
      dispatchSyntheticPointerEvent(window, 'pointerup', {
        pointerId: 7,
        clientX: 260,
        clientY: 280,
      });
    });

    const panel = container.querySelector('[data-survey-cad-parcel-layout-panel]') as HTMLDivElement | null;
    const header = container.querySelector(
      '[data-survey-cad-parcel-layout-panel-header]',
    ) as HTMLDivElement | null;
    if (!panel || !header) throw new Error('Parcel layout floating panel not found');

    expect(panel.className).toContain('fixed');
    expect(panel.style.left).toBe('24px');
    expect(panel.style.top).toBe('112px');
    expect(panel.style.width).toBe('304px');
    expect(panel.style.height).toBe('600px');
    expect(capture.read()?.parcelLayout?.floatingLeftPx).toBe(24);
    expect(capture.read()?.parcelLayout?.floatingTopPx).toBe(112);
    expect(capture.read()?.parcelLayout?.floatingWidthPx).toBe(304);
    expect(capture.read()?.parcelLayout?.floatingHeightPx).toBe(600);

    const cornerResizeHandle = container.querySelector(
      '[data-survey-cad-floating-panel-resize-corner]',
    ) as HTMLDivElement | null;
    if (!cornerResizeHandle) throw new Error('Corner resize handle not found');

    await act(async () => {
      dispatchSyntheticPointerEvent(cornerResizeHandle, 'pointerdown', {
        pointerId: 2,
        button: 0,
        clientX: 330,
        clientY: 660,
      });
    });

    expect(container.querySelector('[data-survey-cad-parcel-layout-drag-shield]')).not.toBeNull();

    await act(async () => {
      dispatchSyntheticPointerEvent(window, 'pointermove', {
        pointerId: 2,
        clientX: 390,
        clientY: 620,
      });
      dispatchSyntheticPointerEvent(window, 'pointerup', {
        pointerId: 2,
        clientX: 390,
        clientY: 620,
      });
    });

    expect(container.querySelector('[data-survey-cad-parcel-layout-drag-shield]')).toBeNull();
    expect(Number.parseFloat(panel.style.width)).toBeGreaterThan(304);
    expect(Number.parseFloat(panel.style.height)).toBeLessThan(600);
    expect((capture.read()?.parcelLayout?.floatingWidthPx ?? 0) > 304).toBe(true);
    expect((capture.read()?.parcelLayout?.floatingHeightPx ?? 0) < 600).toBe(true);

    await act(async () => {
      dispatchSyntheticPointerEvent(header, 'pointerdown', {
        pointerId: 1,
        button: 0,
        clientX: 40,
        clientY: 120,
      });
    });

    expect(container.querySelector('[data-survey-cad-parcel-layout-drag-shield]')).not.toBeNull();

    await act(async () => {
      dispatchSyntheticPointerEvent(window, 'pointermove', {
        pointerId: 1,
        clientX: 240,
        clientY: 260,
      });
      dispatchSyntheticPointerEvent(window, 'pointerup', {
        pointerId: 1,
        clientX: 240,
        clientY: 260,
      });
    });

    expect(container.querySelector('[data-survey-cad-parcel-layout-drag-shield]')).toBeNull();

    expect(capture.read()?.parcelLayout?.dock).toBe('floating');
    expect((capture.read()?.parcelLayout?.floatingLeftPx ?? 0) > 24).toBe(true);
    expect((capture.read()?.parcelLayout?.floatingTopPx ?? 0) >= 112).toBe(true);

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: previousInnerWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: previousInnerHeight,
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps floating parcel layout position stable through parent-backed persisted-state rerenders', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const previousInnerWidth = window.innerWidth;
    const previousInnerHeight = window.innerHeight;

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 720,
    });

    await act(async () => {
      root.render(<ParentBackedParcelLayoutWorkspace />);
    });

    const panel = container.querySelector('[data-survey-cad-parcel-layout-panel]') as HTMLDivElement | null;
    const header = container.querySelector(
      '[data-survey-cad-parcel-layout-panel-header]',
    ) as HTMLDivElement | null;
    if (!panel || !header) throw new Error('Parent-backed parcel layout panel not found');

    expect(panel.style.left).toBe('24px');
    expect(panel.style.top).toBe('112px');
    expect(panel.style.width).toBe('304px');
    expect(panel.style.height).toBe('600px');

    const cornerResizeHandle = container.querySelector(
      '[data-survey-cad-floating-panel-resize-corner]',
    ) as HTMLDivElement | null;
    if (!cornerResizeHandle) throw new Error('Parent-backed corner resize handle not found');

    await act(async () => {
      dispatchSyntheticPointerEvent(cornerResizeHandle, 'pointerdown', {
        pointerId: 4,
        button: 0,
        clientX: 330,
        clientY: 660,
      });
      dispatchSyntheticPointerEvent(window, 'pointermove', {
        pointerId: 4,
        clientX: 390,
        clientY: 620,
      });
      dispatchSyntheticPointerEvent(window, 'pointerup', {
        pointerId: 4,
        clientX: 390,
        clientY: 620,
      });
    });

    const resizedWidth = Number.parseFloat(panel.style.width);
    const resizedHeight = Number.parseFloat(panel.style.height);
    expect(resizedWidth).toBeGreaterThan(304);
    expect(resizedHeight).toBeLessThan(600);

    await act(async () => {
      dispatchSyntheticPointerEvent(header, 'pointerdown', {
        pointerId: 3,
        button: 0,
        clientX: 60,
        clientY: 120,
      });
      dispatchSyntheticPointerEvent(window, 'pointermove', {
        pointerId: 3,
        clientX: 160,
        clientY: 200,
      });
      dispatchSyntheticPointerEvent(window, 'pointermove', {
        pointerId: 3,
        clientX: 240,
        clientY: 280,
      });
      dispatchSyntheticPointerEvent(window, 'pointerup', {
        pointerId: 3,
        clientX: 240,
        clientY: 280,
      });
    });

    const movedLeft = Number.parseFloat(panel.style.left);
    const movedTop = Number.parseFloat(panel.style.top);
    expect(movedLeft).toBeGreaterThan(24);
    expect(movedTop).toBeGreaterThanOrEqual(112);

    await act(async () => {
      await Promise.resolve();
    });

    expect(Number.parseFloat(panel.style.left)).toBe(movedLeft);
    expect(Number.parseFloat(panel.style.top)).toBe(movedTop);
    expect(Number.parseFloat(panel.style.width)).toBe(resizedWidth);
    expect(Number.parseFloat(panel.style.height)).toBe(resizedHeight);
    expect(container.querySelector('[data-survey-cad-parcel-layout-drag-shield]')).toBeNull();

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: previousInnerWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: previousInnerHeight,
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
