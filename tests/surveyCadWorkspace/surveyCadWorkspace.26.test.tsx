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
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('reports parcel linework diagnostics for selected open/overlapping lines', async () => {
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
          id: 'line:A|B:1',
          type: 'line' as const,
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'A',
          toStationId: 'B',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:B|C',
          type: 'line' as const,
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'B',
          toStationId: 'C',
          fromX: 10,
          fromY: 0,
          toX: 20,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:A|B:2',
          type: 'line' as const,
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'A',
          toStationId: 'B',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 1 },
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

    const firstLine = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|B:1"]',
    ) as SVGLineElement | null;
    const secondLine = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:B|C"]',
    ) as SVGLineElement | null;
    const thirdLine = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|B:2"]',
    ) as SVGLineElement | null;
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!firstLine || !secondLine || !thirdLine || !parcelMenuButton) {
      throw new Error('Expected parcel diagnostic controls not found');
    }

    await act(async () => {
      firstLine.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      secondLine.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
      thirdLine.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('3 selected');

    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Parcel Check');
    });

    const cogoPanels = Array.from(container.querySelectorAll('[data-survey-cad-cogo-panel]'));
    const parcelCheckPanel = cogoPanels.find((panel) =>
      panel.querySelector('[data-survey-cad-cogo-panel-source]')?.textContent?.includes('Latest COGO Result'),
    );
    expect(parcelCheckPanel?.querySelector('[data-survey-cad-cogo-panel-title]')?.textContent).toContain(
      'Parcel Linework Check',
    );
    expect(parcelCheckPanel?.querySelector('[data-survey-cad-cogo-panel-tool]')?.textContent).toContain(
      'PARCEL_CHECK',
    );
    expect(parcelCheckPanel?.querySelector('[data-survey-cad-cogo-panel-summary]')?.textContent).toContain(
      '1 open end',
    );
    expect(parcelCheckPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      'Needs cleanup',
    );
    expect(parcelCheckPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      'C',
    );
    expect(parcelCheckPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      'A-B x2',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('splits a selected parcel by a selected line from the parcel menu', async () => {
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
        {
          id: 'line:split',
          type: 'line' as const,
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'S1',
          toStationId: 'S2',
          fromX: 20,
          fromY: -5,
          toX: 20,
          toY: 20,
          sourceObservationIds: [],
        },
      ],
      bounds: { minX: 0, minY: -5, maxX: 25, maxY: 20 },
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
            parcelLayout: {
              open: true,
              collapsed: false,
              dock: 'right',
              floatingLeftPx: 24,
              floatingTopPx: 96,
              floatingWidthPx: 304,
              floatingHeightPx: 560,
              activeParentParcelId: 'parcel:source',
              activeFrontageEntityId: 'line:A|P1',
              settings: {
                minAreaSquareMeters: 1000,
                minFrontageMeters: 30,
                useFrontageAtOffset: false,
                frontageOffsetMeters: 10,
                minWidthMeters: 20,
                minDepthMeters: 20,
                useMaxDepth: false,
                maxDepthMeters: 150,
                solutionPreference: 'shortest_frontage',
                automaticMode: 'off',
                remainderDistribution: 'place_remainder_in_last_parcel',
              },
            },
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const parcelTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="parcel:source"]',
    ) as SVGElement | null;
    const splitLineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:split"]',
    ) as SVGElement | null;
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!parcelTarget || !splitLineTarget || !parcelMenuButton) {
      throw new Error('Parcel split controls not found');
    }

    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      splitLineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('2 selected');

    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Split by Line');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL SPLIT committed',
    );
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('2 selected');
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain('Area');

    const persisted = capture.read();
    const parcels = persisted?.project.entities.filter((entity) => entity.type === 'parcel') ?? [];
    expect(parcels).toHaveLength(2);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
