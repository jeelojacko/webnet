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
  it('creates auto-layout parcels from a multi-segment frontage polyline', async () => {
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
          id: 'frontage:poly',
          type: 'polyline' as const,
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          vertices: [
            { x: 0, y: 0 },
            { x: 90, y: 0 },
            { x: 90, y: 60 },
            { x: 0, y: 60 },
          ],
          vertexLabels: ['A', 'B3', 'C3', 'D3'],
          closed: false,
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
              activeFrontageEntityId: 'frontage:poly',
              settings: {
                minAreaSquareMeters: 600,
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

    expect(clickButton(container, 'Auto').disabled).toBe(false);
    expect(clickButton(container, 'Create').disabled).toBe(false);

    await act(async () => {
      clickButton(container, 'Create');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL layout auto committed',
    );
    expect(capture.read()?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_LAYOUT_AUTO');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps fill-parent auto enabled when minimum frontage/depth exceed minimum area target', async () => {
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
          id: 'parcel:auto',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel 1',
          vertices: [
            { x: 0, y: 0 },
            { x: 1200, y: 0 },
            { x: 1200, y: 500 },
            { x: 0, y: 500 },
          ],
          vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4'],
          areaSquareMeters: 600000,
          perimeterMeters: 3400,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
      ],
      bounds: { minX: 0, minY: 0, maxX: 1200, maxY: 500 },
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
              activeFrontageEntityId: null,
              activeFrontageParcelSegmentIds: ['parcel:auto#0'],
              settings: {
                minAreaSquareMeters: 100,
                minFrontageMeters: 30,
                useFrontageAtOffset: false,
                frontageOffsetMeters: 10,
                minWidthMeters: 20,
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

    const createButton = clickButton(container, 'Create');
    const autoButton = clickButton(container, 'Auto');
    expect(createButton.disabled).toBe(false);
    expect(autoButton.disabled).toBe(false);

    await act(async () => {
      createButton.click();
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL layout auto committed',
    );
    expect((capture.read()?.project.entities.filter((entity) => entity.type === 'parcel').length ?? 0)).toBeGreaterThan(10);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  }, 15000);

  it('creates frontage-strip auto parcels on the screenshot parcel fixture', async () => {
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
          id: 'parcel:fixture',
          type: 'parcel' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          parcelName: 'Parcel 1',
          vertices: [
            { x: 685672.814, y: 5091312.877 },
            { x: 686879.074, y: 5091312.877 },
            { x: 686694.912, y: 5090134.241 },
            { x: 685522.415, y: 5090336.819 },
          ],
          vertexLabels: ['CAD1', 'CAD2', 'CAD3', 'CAD4'],
          areaSquareMeters: 1298316.528,
          perimeterMeters: 4576.642,
          closureDeltaX: 0,
          closureDeltaY: 0,
          closureDistanceMeters: 0,
        },
      ],
      bounds: { minX: 685522, minY: 5090134, maxX: 686880, maxY: 5091313 },
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
              activeParentParcelId: 'parcel:fixture',
              activeFrontageEntityId: null,
              activeFrontageParcelSegmentIds: ['parcel:fixture#0'],
              settings: {
                minAreaSquareMeters: 100,
                minFrontageMeters: 30,
                useFrontageAtOffset: false,
                frontageOffsetMeters: 10,
                minWidthMeters: 20,
                minDepthMeters: 20,
                useMaxDepth: true,
                maxDepthMeters: 150,
                solutionPreference: 'shortest_frontage',
                automaticMode: 'fill_parent',
                remainderDistribution: 'place_remainder_in_last_parcel',
              },
            },
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const createButton = clickButton(container, 'Create');
    expect(createButton.disabled).toBe(false);

    await act(async () => {
      createButton.click();
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL layout auto committed',
    );
    expect(capture.read()?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_LAYOUT_AUTO');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
