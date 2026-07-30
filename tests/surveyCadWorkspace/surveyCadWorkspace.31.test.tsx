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
  clickButton,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('opens the parcel layout panel and lets the user bind selected parent and frontage geometry', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

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
          id: 'line:A|P1',
          type: 'line' as const,
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'A',
          toStationId: 'P1',
          fromX: 0,
          fromY: 0,
          toX: 25,
          toY: 0,
          sourceObservationIds: [],
        },
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
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|C"]',
    ) as SVGElement | null;
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!parcelTarget || !lineTarget || !parcelMenuButton) {
      throw new Error('Parcel layout controls not found');
    }

    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
    });
    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Layout Tools');
    });

    expect(container.querySelector('[data-survey-cad-parcel-layout-panel]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-parcel-layout-parent]')?.textContent).toContain('Parcel 1');
    expect(container.querySelector('[data-survey-cad-parcel-layout-frontage]')?.textContent).toContain('A-C');

    const useParentButton = container.querySelector(
      '[data-survey-cad-parcel-layout-use-parent]',
    ) as HTMLButtonElement | null;
    const useFrontageButton = container.querySelector(
      '[data-survey-cad-parcel-layout-use-frontage]',
    ) as HTMLButtonElement | null;
    if (!useParentButton || !useFrontageButton) {
      throw new Error('Parcel layout state buttons not found');
    }

    await act(async () => {
      useParentButton.click();
      useFrontageButton.click();
    });

    expect(container.querySelector('[data-survey-cad-parcel-layout-parent]')?.textContent).toContain('Parcel 1');
    expect(container.querySelector('[data-survey-cad-parcel-layout-frontage]')?.textContent).toContain('A-C');
    expect(
      (container.querySelector('[data-survey-cad-parcel-layout-min-area]') as HTMLInputElement | null)?.value ?? '',
    ).toContain('1000');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('tiles properties and parcel layout panels side by side when docked to the same side', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

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
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!parcelTarget || !parcelMenuButton) throw new Error('Parcel tiling controls not found');

    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Layout Tools');
    });

    const propertiesPanel = container.querySelector(
      '[data-survey-cad-properties-panel]',
    ) as HTMLDivElement | null;
    const parcelLayoutPanel = container.querySelector(
      '[data-survey-cad-parcel-layout-panel]',
    ) as HTMLDivElement | null;
    const propertiesHeader = container.querySelector(
      '[data-survey-cad-properties-panel-header]',
    ) as HTMLDivElement | null;
    const parcelLayoutHeader = container.querySelector(
      '[data-survey-cad-parcel-layout-panel-header]',
    ) as HTMLDivElement | null;
    if (!propertiesPanel || !parcelLayoutPanel || !propertiesHeader || !parcelLayoutHeader) {
      throw new Error('Docked panel headers not found');
    }

    const propertiesLeftButton = Array.from(propertiesHeader.querySelectorAll('button')).find(
      (button) => button.getAttribute('title') === 'Dock panel to the left side',
    ) as HTMLButtonElement | undefined;
    const parcelLayoutLeftButton = Array.from(parcelLayoutHeader.querySelectorAll('button')).find(
      (button) => button.getAttribute('title') === 'Dock panel to the left side',
    ) as HTMLButtonElement | undefined;
    if (!propertiesLeftButton || !parcelLayoutLeftButton) {
      throw new Error('Dock-left buttons not found');
    }

    await act(async () => {
      propertiesLeftButton.click();
      parcelLayoutLeftButton.click();
    });

    expect(propertiesPanel.style.left).toBe('12px');
    expect(parcelLayoutPanel.style.left).toBe('328px');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
