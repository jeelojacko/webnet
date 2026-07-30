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
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('creates auto-layout parcels from an arc frontage reference', async () => {
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
          id: 'arc:frontage',
          type: 'arc' as const,
          layerId: 'planning',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 45,
          centerY: 0,
          radius: 45,
          startAngleDeg: 180,
          endAngleDeg: 0,
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
              activeFrontageEntityId: 'arc:frontage',
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

    expect(container.querySelector('[data-survey-cad-parcel-layout-frontage]')?.textContent).toContain(
      'ARC START-ARC END',
    );

    await act(async () => {
      clickButton(container, 'Create All');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL layout auto committed',
    );

    const persisted = capture.read();
    const parcels = persisted?.project.entities.filter((entity) => entity.type === 'parcel') ?? [];
    expect(parcels).toHaveLength(5);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_LAYOUT_AUTO');
    expect(
      persisted?.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Minimum width' && row.value === '10.000 m',
      ),
    ).toBe(true);
    expect(
      persisted?.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Solution preference' && row.value === 'Shortest frontage',
      ),
    ).toBe(true);
    expect(
      persisted?.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Alternative mix',
      ),
    ).toBe(true);
    expect(
      persisted?.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Lot frontage range',
      ),
    ).toBe(true);
    expect(
      persisted?.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Lot width range',
      ),
    ).toBe(true);
    expect(
      persisted?.project.cogoComputations.at(-1)?.report.rows.some(
        (row) => row.label === 'Lot depth range',
      ),
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it.skip('previews and accepts a parcel slide layout split from the parcel layout panel', async () => {
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

    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    if (!parcelMenuButton) {
      throw new Error('Parcel layout menu button not found');
    }

    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Layout Tools');
    });

    const minAreaInput = container.querySelector(
      '[data-survey-cad-parcel-layout-min-area]',
    ) as HTMLInputElement | null;
    const minFrontageInput = Array.from(
      container.querySelectorAll('[data-survey-cad-parcel-layout-panel] input'),
    )[1] as HTMLInputElement | undefined;
    if (!minAreaInput || !minFrontageInput) {
      throw new Error('Parcel layout preview input not found');
    }

    await act(async () => {
      setTextInputValue(minAreaInput, '67.5');
      setTextInputValue(minFrontageInput, '10');
    });
    await act(async () => {
      clickButton(container, 'Slide');
    });

    expect(container.querySelector('[data-survey-cad-command-preview]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-parcel-layout-preview-status]')?.textContent).toContain('Slide');

    await act(async () => {
      clickButton(container, 'Accept');
    });

    const persisted = capture.read();
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_SLIDE');
    expect(persisted?.project.entities.filter((entity) => entity.type === 'parcel')).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
