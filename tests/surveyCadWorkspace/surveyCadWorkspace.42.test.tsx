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
  it('renames a station-offset point through Properties and keeps the multiline stakeout label synced', async () => {
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
    if (!alignmentTarget || !commandInput) throw new Error('Alignment station rename controls not found');

    await act(async () => {
      alignmentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      clickButton(container, 'STA PT');
      setTextInputValue(commandInput, 'SO1=110,5');
      pressKey(commandInput, 'Enter');
    });

    const pointTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:SO1"]',
    ) as SVGElement | null;
    const nameInput = container.querySelector(
      '[data-survey-cad-properties-input="name"]',
    ) as HTMLInputElement | null;
    if (!pointTarget || !nameInput) throw new Error('Stakeout rename controls not found');

    await act(async () => {
      pointTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      setTextInputValue(nameInput, 'SO2');
      pressKey(nameInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'SO2',
    );

    const renamedLabelTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="label:SO1"]',
    ) as SVGElement | null;
    if (!renamedLabelTarget) throw new Error('Renamed station-offset label target not found');

    await act(async () => {
      renamedLabelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'SO2 label',
    );
    expect(
      (container.querySelector('[data-survey-cad-properties-input="name"]') as HTMLInputElement | null)?.value,
    ).toBe('SO2 label');
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'STA 1+10.000',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'OFF 5.000 m',
    );

    const persisted = capture.read();
    const renamedPoint = persisted?.project.entities.find(
      (entity) => entity.type === 'survey-point' && entity.id === 'pt:SO1',
    );
    const renamedLabel = persisted?.project.entities.find(
      (entity) => entity.type === 'text' && entity.id === 'label:SO1',
    );
    expect(renamedPoint?.type === 'survey-point' ? renamedPoint.stationId : null).toBe('SO2');
    expect(renamedLabel?.type === 'text' ? renamedLabel.text : null).toBe('SO2\nSTA 1+10.000\nOFF 5.000 m');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('adds a station equation to a selected alignment', async () => {
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
    if (!alignmentTarget || !commandInput) throw new Error('Alignment station equation controls not found');

    await act(async () => {
      alignmentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      clickButton(container, 'STA EQ');
      setTextInputValue(commandInput, '110,120');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'STA EQ committed',
    );
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'ALIGN1',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Station equations',
    );

    const persisted = capture.read();
    const alignmentEntity = persisted?.project.entities.find(
      (entity) => entity.type === 'alignment' && entity.id === 'alignment:station-ui-test',
    );
    expect(alignmentEntity && 'stationEquations' in alignmentEntity ? alignmentEntity.stationEquations : null).toEqual([
      { backStation: 110, aheadStation: 120, rawStation: 110 },
    ]);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_STATION_EQUATION');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates interval points from a selected alignment', async () => {
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
    if (!alignmentTarget || !commandInput) throw new Error('Alignment interval controls not found');

    await act(async () => {
      alignmentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      clickButton(container, 'STA INT');
      setTextInputValue(commandInput, 'INT=100,130,10');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'STA INT committed',
    );
    expect(container.querySelector('[data-survey-cad-properties-type-select]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-properties-entity-select]')).not.toBeNull();

    const intervalLabelTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="label:INT1"]',
    ) as SVGElement | null;
    if (!intervalLabelTarget) throw new Error('Interval label target not found');

    await act(async () => {
      intervalLabelTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'INT1',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'AlignmentALIGN1',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Station1+00.000',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Offset0.000',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Stakeout kindInterval',
    );

    const persisted = capture.read();
    expect(
      persisted?.project.entities.filter(
        (entity) => entity.type === 'survey-point' && /^INT\d+$/.test(entity.stationId),
      ),
    ).toHaveLength(4);
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_INTERVALS');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
