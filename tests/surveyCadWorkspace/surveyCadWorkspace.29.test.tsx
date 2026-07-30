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
  pressKey,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('splits a selected parcel by a through-point bearing from the parcel menu', async () => {
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
            parcelLayout: {
              open: false,
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
    const parcelMenuButton = container.querySelector(
      '[data-survey-cad-parcel-menu-button]',
    ) as HTMLButtonElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!parcelTarget || !parcelMenuButton || !commandInput) {
      throw new Error('Parcel split by bearing controls not found');
    }

    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });
    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Split by Bearing');
    });

    await act(async () => {
      setTextInputValue(commandInput, 'SP1=20,6');
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, 'N00-00-00E');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL SPLIT bearing committed',
    );
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('2 selected');

    const persisted = capture.read();
    const parcels = persisted?.project.entities.filter((entity) => entity.type === 'parcel') ?? [];
    expect(parcels).toHaveLength(2);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_BEARING');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('splits a selected parcel by a through-point target area from the parcel menu', async () => {
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!parcelTarget || !parcelMenuButton || !commandInput) {
      throw new Error('Parcel split by area controls not found');
    }

    await act(async () => {
      parcelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });
    await act(async () => {
      parcelMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Split by Area');
    });

    await act(async () => {
      setTextInputValue(commandInput, 'SP1=20,6');
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, '67.5');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL SPLIT area committed',
    );
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('2 selected');

    const persisted = capture.read();
    const parcels = persisted?.project.entities.filter((entity) => entity.type === 'parcel') ?? [];
    expect(parcels).toHaveLength(2);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_SPLIT_AREA');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
