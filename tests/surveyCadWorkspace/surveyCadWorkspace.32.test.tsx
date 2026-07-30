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
  setTextInputValue,
  dispatchSyntheticPointerEvent,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('lets the properties panel float and drag independently', async () => {
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
        ...originalProject.entities,
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
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 40 },
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
        />,
      );
    });

    const parcelTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="parcel:source"]',
    ) as SVGElement | null;
    if (!parcelTarget) throw new Error('Properties float parcel target not found');

    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const propertiesPanel = container.querySelector(
      '[data-survey-cad-properties-panel]',
    ) as HTMLDivElement | null;
    const propertiesHeader = container.querySelector(
      '[data-survey-cad-properties-panel-header]',
    ) as HTMLDivElement | null;
    if (!propertiesPanel || !propertiesHeader) throw new Error('Properties float controls not found');

    const propertiesFloatButton = Array.from(propertiesHeader.querySelectorAll('button')).find(
      (button) => button.getAttribute('title') === 'Float panel as a movable popup',
    ) as HTMLButtonElement | undefined;
    if (!propertiesFloatButton) throw new Error('Properties float button not found');

    await act(async () => {
      propertiesFloatButton.click();
    });

    expect(propertiesPanel.style.left).toBe('24px');
    expect(propertiesPanel.style.top).toBe('120px');

    await act(async () => {
      dispatchSyntheticPointerEvent(propertiesHeader, 'pointerdown', {
        pointerId: 21,
        button: 0,
        clientX: 40,
        clientY: 140,
      });
      dispatchSyntheticPointerEvent(window, 'pointermove', {
        pointerId: 21,
        clientX: 180,
        clientY: 260,
      });
      dispatchSyntheticPointerEvent(window, 'pointerup', {
        pointerId: 21,
        clientX: 180,
        clientY: 260,
      });
    });

    expect(Number.parseFloat(propertiesPanel.style.left)).toBeGreaterThan(24);
    expect(Number.parseFloat(propertiesPanel.style.top)).toBeGreaterThanOrEqual(120);

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

  it('persists parcel layout panel settings through workspace state', async () => {
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
    if (!parcelTarget || !parcelMenuButton) throw new Error('Parcel layout persistence controls not found');

    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Layout Tools');
    });

    const useParentButton = container.querySelector(
      '[data-survey-cad-parcel-layout-use-parent]',
    ) as HTMLButtonElement | null;
    const minAreaInput = container.querySelector(
      '[data-survey-cad-parcel-layout-min-area]',
    ) as HTMLInputElement | null;
    if (!useParentButton || !minAreaInput) throw new Error('Parcel layout persistence fields not found');

    await act(async () => {
      useParentButton.click();
      setTextInputValue(minAreaInput, '2500');
    });

    expect(capture.read()?.parcelLayout?.open).toBe(true);
    expect(capture.read()?.parcelLayout?.activeParentParcelId).toBe('parcel:source');
    expect(capture.read()?.parcelLayout?.settings.minAreaSquareMeters).toBe(2500);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
