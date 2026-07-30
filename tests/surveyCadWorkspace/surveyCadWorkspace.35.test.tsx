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
  it('uses Create button to commit one automatic parcel in single-preview mode', async () => {
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
        ...originalProject.entities,
        {
          id: 'line:A|B3',
          type: 'line' as const,
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'A',
          toStationId: 'B3',
          fromX: 0,
          fromY: 0,
          toX: 90,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'parcel:auto',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel 1',
          vertices: [
            { x: 0, y: 0 },
            { x: 90, y: 0 },
            { x: 90, y: 60 },
            { x: 0, y: 60 },
          ],
          vertexLabels: ['A', 'B3', 'C3', 'D3'],
          areaSquareMeters: 5400,
          perimeterMeters: 300,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 90, maxY: 60 },
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
              activeParentParcelId: 'parcel:auto',
              activeFrontageEntityId: 'line:A|B3',
              activeFrontageParcelSegmentIds: null,
              settings: {
                minAreaSquareMeters: 1200,
                minFrontageMeters: 20,
                useFrontageAtOffset: false,
                frontageOffsetMeters: 10,
                minWidthMeters: 10,
                minDepthMeters: 20,
                useMaxDepth: false,
                maxDepthMeters: 150,
                solutionPreference: 'shortest_frontage',
                automaticMode: 'single_preview',
                remainderDistribution: 'create_parcel_from_remainder',
              },
            },
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    await act(async () => {
      clickButton(container, 'Create');
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

  it('uses selected parcel and frontage directly for fill-parent auto layout without binding them first', async () => {
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
        ...originalProject.entities,
        {
          id: 'line:A|B3',
          type: 'line' as const,
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'A',
          toStationId: 'B3',
          fromX: 0,
          fromY: 0,
          toX: 90,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'parcel:auto',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel 1',
          vertices: [
            { x: 0, y: 0 },
            { x: 90, y: 0 },
            { x: 90, y: 60 },
            { x: 0, y: 60 },
          ],
          vertexLabels: ['A', 'B3', 'C3', 'D3'],
          areaSquareMeters: 5400,
          perimeterMeters: 300,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 90, maxY: 60 },
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
                minAreaSquareMeters: 1200,
                minFrontageMeters: 20,
                useFrontageAtOffset: false,
                frontageOffsetMeters: 10,
                minWidthMeters: 10,
                minDepthMeters: 20,
                useMaxDepth: false,
                maxDepthMeters: 150,
                solutionPreference: 'shortest_frontage',
                automaticMode: 'fill_parent',
                remainderDistribution: 'create_parcel_from_remainder',
              },
            },
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const parcelTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="parcel:auto"]',
    ) as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|B3"]',
    ) as SVGElement | null;
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!parcelTarget || !lineTarget || !parcelMenuButton) {
      throw new Error('Selection-first auto layout controls not found');
    }

    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Layout Tools');
    });

    expect(container.querySelector('[data-survey-cad-parcel-layout-parent]')?.textContent).toContain('Parcel 1');
    expect(container.querySelector('[data-survey-cad-parcel-layout-frontage]')?.textContent).toContain('A-B3');

    const createButton = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === 'Create',
    ) as HTMLButtonElement | undefined;
    if (!createButton) {
      throw new Error('Create button not found');
    }
    expect(createButton.disabled).toBe(false);

    await act(async () => {
      createButton.click();
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL layout auto committed',
    );

    const persisted = capture.read();
    const parcels = persisted?.project.entities.filter((entity) => entity.type === 'parcel') ?? [];
    expect(parcels).toHaveLength(5);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_LAYOUT_AUTO');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
