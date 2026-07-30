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
  it('creates all slide-based auto-layout parcels from the parcel layout panel', async () => {
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

    await act(async () => {
      clickButton(container, 'Create All');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL layout auto committed',
    );
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('5 selected');

    const persisted = capture.read();
    const parcels = persisted?.project.entities.filter((entity) => entity.type === 'parcel') ?? [];
    expect(parcels).toHaveLength(5);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_LAYOUT_AUTO');
    expect(persisted?.project.cogoComputations.at(-1)?.report.tables?.[0]?.title).toBe('Generated Parcels');
    expect(persisted?.project.cogoComputations.at(-1)?.report.tables?.[0]?.rows).toHaveLength(5);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('uses Create button for fill-parent auto layout when automatic fill is active', async () => {
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

    await act(async () => {
      clickButton(container, 'Create');
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
