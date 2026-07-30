/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  buildSurveyCadSpikeProject,
  buildCadProjectSignature,
  input,
  campInput,
  parseOptions,
  campParseOptions,
  mockElementRect,
  projectWorldToPreviewScreen,
  pressKey,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('moves the parsed-input GPS2-GPS5 line by anchoring the GPS2 endpoint exactly onto 109', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const capture = createPersistedStateCapture();

    const baseProject = buildSurveyCadSpikeProject({
      input: campInput,
      instrumentLibrary: {},
      parseOptions: campParseOptions,
      units: 'm',
      result: null,
    });

    await act(async () => {
      root.render(
        <SurveyCadWorkspace
          input={campInput}
          instrumentLibrary={{}}
          parseOptions={campParseOptions}
          units="m"
          result={null}
          persistedState={{
            version: 1,
            sourceSignature: buildCadProjectSignature(baseProject),
            project: baseProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:GPS2|GPS5"]',
    ) as SVGLineElement | null;
    const pointTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:109"]',
    ) as SVGCircleElement | null;
    if (!preview || !lineTarget || !pointTarget) throw new Error('Camp GPS2-GPS5 move targets not found');
    mockElementRect(preview);

    const gps2 = { x: 683005.038, y: 5090804.624 };
    const gps5 = { x: 683186.559, y: 5090575.718 };
    const pt109 = { x: 682979.351, y: 5090926.628 };
    const basePick = projectWorldToPreviewScreen(baseProject.bounds!, gps2);
    const targetPick = projectWorldToPreviewScreen(baseProject.bounds!, pt109);

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    await act(async () => {
      clickButton(container, 'MOVE');
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: basePick.clientX,
          clientY: basePick.clientY,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: basePick.clientX,
          clientY: basePick.clientY,
          button: 0,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: basePick.clientX,
          clientY: basePick.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: targetPick.clientX,
          clientY: targetPick.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('109');

    await act(async () => {
      pointTarget.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: targetPick.clientX,
          clientY: targetPick.clientY,
          button: 0,
        }),
      );
      pointTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: targetPick.clientX,
          clientY: targetPick.clientY,
          button: 0,
        }),
      );
    });

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:GPS2|GPS5');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Moved GPS2-GPS5 line not found');
    expect(line.fromX).toBeCloseTo(pt109.x, 6);
    expect(line.fromY).toBeCloseTo(pt109.y, 6);
    expect(line.toX).toBeCloseTo(gps5.x + (pt109.x - gps2.x), 6);
    expect(line.toY).toBeCloseTo(gps5.y + (pt109.y - gps2.y), 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('erases the current selection when Delete is pressed outside command input', async () => {
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
    const persistedProject = {
      ...baseProject,
      entities: [
        ...baseProject.entities,
        {
          id: 'line:delete-hotkey-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'DK1',
          toStationId: 'DK2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
          sourceObservationIds: [],
        },
      ],
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
            sourceSignature: buildCadProjectSignature(baseProject),
            project: persistedProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:delete-hotkey-test"]',
    ) as SVGLineElement | null;
    if (!lineTarget) throw new Error('Delete hotkey line target not found');

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('1 selected');

    await act(async () => {
      pressKey(window, 'Delete');
    });

    expect(capture.read()?.project.entities.some((entity) => entity.id === 'line:delete-hotkey-test')).toBe(false);
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('ERASE committed');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('erases the current selection when Backspace is pressed outside command input', async () => {
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
    const persistedProject = {
      ...baseProject,
      entities: [
        ...baseProject.entities,
        {
          id: 'line:backspace-hotkey-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'BK1',
          toStationId: 'BK2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
          sourceObservationIds: [],
        },
      ],
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
            sourceSignature: buildCadProjectSignature(baseProject),
            project: persistedProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:backspace-hotkey-test"]',
    ) as SVGLineElement | null;
    if (!lineTarget) throw new Error('Backspace hotkey line target not found');

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    await act(async () => {
      pressKey(window, 'Backspace');
    });

    expect(capture.read()?.project.entities.some((entity) => entity.id === 'line:backspace-hotkey-test')).toBe(false);
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('ERASE committed');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
