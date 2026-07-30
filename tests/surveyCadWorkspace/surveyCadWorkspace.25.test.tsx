/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  buildSurveyCadSpikeProject,
  appendCadProjectEntities,
  buildCadProjectSignature,
  input,
  parseOptions,
  setTextInputValue,
  pressKey,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('runs a first TRAVERSE workflow and finishes it with Enter on an empty prompt', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <SurveyCadWorkspace
          input={input}
          instrumentLibrary={{}}
          parseOptions={parseOptions}
          units="m"
          result={null}
        />,
      );
    });

    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!commandInput) throw new Error('Command input not found');

    await act(async () => {
      clickButton(container, 'TRAV');
      setTextInputValue(commandInput, 'A=0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N90-00-00E,25');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N0-00-00E,15');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'TRAVERSE committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '11 entities',
    );
    expect(container.textContent).not.toContain('25.000,0.000');
    expect(container.textContent).not.toContain('25.000,15.000');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates a parcel from the selected traverse polyline and reports closure in status text', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <SurveyCadWorkspace
          input={input}
          instrumentLibrary={{}}
          parseOptions={parseOptions}
          units="m"
          result={null}
        />,
      );
    });

    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!commandInput) throw new Error('Command input not found');

    await act(async () => {
      clickButton(container, 'TRAV');
      setTextInputValue(commandInput, 'A=0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N90-00-00E,25');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N0-00-00E,15');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'A=0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'TRAVERSE committed',
    );

    await act(async () => {
      clickButton(container, 'PARCEL');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL_CREATE committed',
    );
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'Closure 0.000 m',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '12 entities',
    );
    expect(container.textContent).toContain('187.500 m²');
    expect(container.textContent).toContain('69.155 m');
    expect(container.querySelector('[data-survey-cad-parcel-report]')).toBeNull();
    expect(container.querySelector('[data-survey-cad-properties-panel-title]')?.textContent).toContain(
      'Properties',
    );
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'Parcel 1',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Area',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel]')?.textContent).toContain(
      'Area (ha)',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel]')?.textContent).toContain(
      '0.0187 ha',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel]')?.textContent).toContain(
      '0.0463 ac',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel]')?.textContent).toContain(
      '2018.233 ft²',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel]')?.textContent).toContain(
      'A-CAD1',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel]')?.textContent).toContain(
      'N90-00-00.00E',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel]')?.textContent).toContain(
      '90°00\'00"',
    );
    expect(container.querySelectorAll('[data-survey-cad-parcel-course]')).toHaveLength(3);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates a parcel from a closed selection of line entities in the CAD workspace', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const capture = createPersistedStateCapture();

    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const lineProject = appendCadProjectEntities(baseProject, [
      {
        id: 'line:A|P1',
        type: 'line',
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
        id: 'line:P1|P2',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'P1',
        toStationId: 'P2',
        fromX: 25,
        fromY: 0,
        toX: 25,
        toY: 15,
        sourceObservationIds: [],
      },
      {
        id: 'line:P2|A',
        type: 'line',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'P2',
        toStationId: 'A',
        fromX: 25,
        fromY: 15,
        toX: 0,
        toY: 0,
        sourceObservationIds: [],
      },
    ]);

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
            sourceSignature: buildCadProjectSignature(baseProject),
            project: lineProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const firstLine = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|P1"]',
    ) as SVGElement | null;
    const secondLine = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:P1|P2"]',
    ) as SVGElement | null;
    const thirdLine = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:P2|A"]',
    ) as SVGElement | null;
    if (!firstLine || !secondLine || !thirdLine) throw new Error('Parcel line targets not found');

    await act(async () => {
      firstLine.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      secondLine.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
      thirdLine.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
    });

    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('3 selected');

    await act(async () => {
      clickButton(container, 'PARCEL');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PARCEL_CREATE committed',
    );
    expect(container.querySelector('[data-survey-cad-parcel-report]')).toBeNull();
    expect(container.querySelector('[data-survey-cad-properties-panel]')?.textContent).toContain('A-P1');
    expect(container.querySelector('[data-survey-cad-properties-panel]')?.textContent).toContain('P1-P2');
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain('Parcel 1');

    const persisted = capture.read();
    const parcel = persisted?.project.entities.find((entity) => entity.type === 'parcel');
    expect(parcel?.type).toBe('parcel');
    expect(parcel?.type === 'parcel' ? parcel.vertexLabels : null).toEqual(['A', 'P1', 'P2']);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('PARCEL_CREATE');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('toggles parcel center labels in the CAD preview', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const capture = createPersistedStateCapture();

    const baseProject = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });
    const parcelProject = appendCadProjectEntities(baseProject, [
      {
        id: 'parcel:toggle',
        type: 'parcel',
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
        perimeterMeters: 69.1547594742265,
        closureDeltaX: 0,
        closureDeltaY: 0,
        closureDistanceMeters: 0,
      },
    ]);

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
            sourceSignature: buildCadProjectSignature(baseProject),
            project: parcelProject,
            showParcelLabels: true,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const parcelLabelText = '187.500';
    expect(
      Array.from(container.querySelectorAll('svg text')).some((node) =>
        (node.textContent ?? '').replace(/\s+/g, '').includes(parcelLabelText),
      ),
    ).toBe(true);

    await act(async () => {
      clickButton(container, 'Parcel Labels');
    });

    expect(
      Array.from(container.querySelectorAll('svg text')).some((node) =>
        (node.textContent ?? '').replace(/\s+/g, '').includes(parcelLabelText),
      ),
    ).toBe(false);
    expect(capture.read()?.showParcelLabels).toBe(false);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
