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
  it('creates an alignment from a selected line-arc chain and reports it through the COGO panel', async () => {
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
    const alignmentProject = appendCadProjectEntities(baseProject, [
      {
        id: 'arc:alignment-ui-test',
        type: 'arc',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        centerX: 60,
        centerY: 60,
        radius: 20,
        startAngleDeg: -90,
        endAngleDeg: 0,
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
            project: alignmentProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|C"]',
    ) as SVGLineElement | null;
    const arcTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:alignment-ui-test"]',
    ) as SVGPathElement | null;
    if (!lineTarget || !arcTarget) throw new Error('Alignment selection targets not found');

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      arcTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
    });

    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('2 selected');

    await act(async () => {
      clickButton(container, 'ALIGN');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ALIGN committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('10 entities');
    expect(container.querySelector('[data-survey-cad-properties-panel-title]')?.textContent).toContain(
      'Properties',
    );
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'ALIGN1',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Start station',
    );

    const persisted = capture.read();
    expect(persisted?.project.entities.some((entity) => entity.type === 'alignment')).toBe(true);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('reports station and offset from a selected point onto a selected alignment', async () => {
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
    const stationProject = appendCadProjectEntities(baseProject, [
      {
        id: 'alignment:station-ui-test',
        type: 'alignment',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        name: 'ALIGN1',
        startStation: 100,
        elements: [
          {
            kind: 'line',
            start: { x: 0, y: 0 },
            end: { x: 60, y: 40 },
          },
        ],
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
            project: stationProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const alignmentTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="alignment:station-ui-test"]',
    ) as SVGElement | null;
    const pointTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:C"]',
    ) as SVGElement | null;
    if (!alignmentTarget || !pointTarget) throw new Error('Alignment station targets not found');

    await act(async () => {
      alignmentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      pointTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
      clickButton(container, 'STA');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'STA committed',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-title]')?.textContent).toContain(
      'Properties',
    );
    expect(container.querySelector('[data-survey-cad-properties-type-select]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-properties-entity-select]')).not.toBeNull();

    const persisted = capture.read();
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_STATION');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates a station-offset point from a selected alignment', async () => {
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
    const stationProject = appendCadProjectEntities(baseProject, [
      {
        id: 'alignment:station-ui-test',
        type: 'alignment',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        name: 'ALIGN1',
        startStation: 100,
        elements: [
          {
            kind: 'line',
            start: { x: 0, y: 0 },
            end: { x: 60, y: 40 },
          },
        ],
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
            project: stationProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const alignmentTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="alignment:station-ui-test"]',
    ) as SVGElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!alignmentTarget || !commandInput) throw new Error('Alignment station point controls not found');

    await act(async () => {
      alignmentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      clickButton(container, 'STA PT');
      setTextInputValue(commandInput, 'SO1=110,5');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'STA PT committed',
    );
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'SO1',
    );

    const stationLabelTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="label:SO1"]',
    ) as SVGElement | null;
    if (!stationLabelTarget) throw new Error('Station-offset label target not found');

    await act(async () => {
      stationLabelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'SO1 label',
    );
    expect(
      (container.querySelector('[data-survey-cad-properties-input="name"]') as HTMLInputElement | null)?.value,
    ).toBe('SO1 label');
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'AlignmentALIGN1',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Station1+10.000',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Offset5.000',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Stakeout kindStation offset',
    );

    const persisted = capture.read();
    expect(persisted?.project.entities.some((entity) => entity.type === 'survey-point' && entity.stationId === 'SO1')).toBe(true);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_POINT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
