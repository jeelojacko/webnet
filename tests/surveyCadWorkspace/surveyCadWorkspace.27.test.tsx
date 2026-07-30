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
  it('reports parcel overlap diagnostics from the parcel menu', async () => {
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
          id: 'parcel:left',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel 1',
          vertices: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
          vertexLabels: ['A', 'B', 'C', 'D'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
        {
          id: 'parcel:right',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel 2',
          vertices: [
            { x: 5, y: 0 },
            { x: 15, y: 0 },
            { x: 15, y: 10 },
            { x: 5, y: 10 },
          ],
          vertexLabels: ['E', 'F', 'G', 'H'],
          areaSquareMeters: 100,
          perimeterMeters: 40,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 15, maxY: 10 },
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

    const leftParcelTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="parcel:left"]',
    ) as SVGElement | null;
    const rightParcelTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="parcel:right"]',
    ) as SVGElement | null;
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!leftParcelTarget || !rightParcelTarget || !parcelMenuButton) {
      throw new Error('Parcel overlap controls not found');
    }

    await act(async () => {
      leftParcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      rightParcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
    });

    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Parcel Overlap');
    });

    const cogoPanels = Array.from(container.querySelectorAll('[data-survey-cad-cogo-panel]'));
    const overlapPanel = cogoPanels.find((panel) =>
      panel.querySelector('[data-survey-cad-cogo-panel-source]')?.textContent?.includes('Latest COGO Result'),
    );
    expect(overlapPanel?.querySelector('[data-survey-cad-cogo-panel-title]')?.textContent).toContain(
      'Parcel Overlap Check',
    );
    expect(overlapPanel?.querySelector('[data-survey-cad-cogo-panel-tool]')?.textContent).toContain(
      'PARCEL_OVERLAP',
    );
    expect(overlapPanel?.querySelector('[data-survey-cad-cogo-panel-summary]')?.textContent).toContain(
      'Found 1 overlapping parcel pair',
    );
    expect(overlapPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      'Parcel 1 x Parcel 2',
    );
    expect(overlapPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      '50.000 m2',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
