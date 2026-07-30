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
  it('splits a parcel by sliding area from the parcel menu', async () => {
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
            parcelLayout: {
              open: false,
              collapsed: false,
              dock: 'right',
              floatingLeftPx: 24,
              floatingTopPx: 96,
              floatingWidthPx: 304,
              floatingHeightPx: 560,
              activeParentParcelId: null,
              activeFrontageEntityId: null,
              settings: {
                minAreaSquareMeters: 67.5,
                minFrontageMeters: 10,
                useFrontageAtOffset: false,
                frontageOffsetMeters: 10,
                minWidthMeters: 5,
                minDepthMeters: 5,
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
    const frontageTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|P1"]',
    ) as SVGElement | null;
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!parcelTarget || !frontageTarget || !parcelMenuButton) {
      throw new Error('Sliding area split controls not found');
    }
    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      frontageTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
    });
    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Sliding Area Split');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL SPLIT slide committed',
    );

    const persisted = capture.read();
    const parcels = persisted?.project.entities.filter((entity) => entity.type === 'parcel') ?? [];
    expect(parcels).toHaveLength(2);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_SLIDE');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('splits a parcel by hinged area from the parcel menu', async () => {
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
            parcelLayout: {
              open: false,
              collapsed: false,
              dock: 'right',
              floatingLeftPx: 24,
              floatingTopPx: 96,
              floatingWidthPx: 304,
              floatingHeightPx: 560,
              activeParentParcelId: null,
              activeFrontageEntityId: null,
              settings: {
                minAreaSquareMeters: 67.5,
                minFrontageMeters: 10,
                useFrontageAtOffset: false,
                frontageOffsetMeters: 10,
                minWidthMeters: 5,
                minDepthMeters: 5,
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
    const frontageTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|P1"]',
    ) as SVGElement | null;
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!parcelTarget || !frontageTarget || !parcelMenuButton) {
      throw new Error('Hinged area split controls not found');
    }
    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      frontageTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
    });
    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Hinged Area Split');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL SPLIT swing committed',
    );

    const persisted = capture.read();
    const parcels = persisted?.project.entities.filter((entity) => entity.type === 'parcel') ?? [];
    expect(parcels).toHaveLength(2);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_SWING');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
