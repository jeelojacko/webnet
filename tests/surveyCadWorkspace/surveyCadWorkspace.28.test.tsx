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
  it('reports parcel gap diagnostics from the parcel menu', async () => {
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
        {
          id: 'parcel:bl',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel BL',
          vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
          vertexLabels: ['A', 'B', 'C', 'D'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
        {
          id: 'parcel:bm',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel BM',
          vertices: [{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }],
          vertexLabels: ['E', 'F', 'G', 'H'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
        {
          id: 'parcel:br',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel BR',
          vertices: [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }],
          vertexLabels: ['I', 'J', 'K', 'L'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
        {
          id: 'parcel:lm',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel LM',
          vertices: [{ x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 20 }, { x: 0, y: 20 }],
          vertexLabels: ['M', 'N', 'O', 'P'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
        {
          id: 'parcel:rm',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel RM',
          vertices: [{ x: 20, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 20 }, { x: 20, y: 20 }],
          vertexLabels: ['Q', 'R', 'S', 'T'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
        {
          id: 'parcel:tl',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel TL',
          vertices: [{ x: 0, y: 20 }, { x: 10, y: 20 }, { x: 10, y: 30 }, { x: 0, y: 30 }],
          vertexLabels: ['U', 'V', 'W', 'X'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
        {
          id: 'parcel:tm',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel TM',
          vertices: [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 30 }, { x: 10, y: 30 }],
          vertexLabels: ['Y', 'Z', 'AA', 'AB'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
        {
          id: 'parcel:tr',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel TR',
          vertices: [{ x: 20, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 20, y: 30 }],
          vertexLabels: ['AC', 'AD', 'AE', 'AF'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
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
          onPersistedStateChange={() => {}}
        />,
      );
    });

    const parcelIds = ['parcel:bl', 'parcel:bm', 'parcel:br', 'parcel:lm', 'parcel:rm', 'parcel:tl', 'parcel:tm', 'parcel:tr'];
    const parcelTargets = parcelIds.map((entityId) =>
      container.querySelector(
        `[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="${entityId}"]`,
      ) as SVGElement | null,
    );
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (parcelTargets.some((target) => !target) || !parcelMenuButton) {
      throw new Error('Parcel gap controls not found');
    }

    await act(async () => {
      parcelTargets[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      parcelTargets.slice(1).forEach((target) => {
        target?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
      });
    });

    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Parcel Gap');
    });

    const cogoPanels = Array.from(container.querySelectorAll('[data-survey-cad-cogo-panel]'));
    const gapPanel = cogoPanels.find((panel) =>
      panel.querySelector('[data-survey-cad-cogo-panel-source]')?.textContent?.includes('Latest COGO Result'),
    );
    expect(gapPanel?.querySelector('[data-survey-cad-cogo-panel-title]')?.textContent).toContain(
      'Parcel Gap Check',
    );
    expect(gapPanel?.querySelector('[data-survey-cad-cogo-panel-tool]')?.textContent).toContain(
      'PARCEL_GAP',
    );
    expect(gapPanel?.querySelector('[data-survey-cad-cogo-panel-summary]')?.textContent).toContain(
      'Found 1 enclosed gap loop',
    );
    expect(gapPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      '100.000 m2',
    );
    expect(gapPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      '15.000, 15.000',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
