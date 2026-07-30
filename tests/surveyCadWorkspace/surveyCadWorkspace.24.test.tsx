/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  buildSurveyCadSpikeProject,
  input,
  parseOptions,
  mockElementRect,
  projectWorldToPreviewScreen,
  setTextInputValue,
  setTextAreaValue,
  pressKey,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('uses a selected survey point as the point-to-point traverse close target and finishes from the draft panel', async () => {
    const persistedCapture = createPersistedStateCapture();
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
          persistedState={null}
          onPersistedStateChange={persistedCapture.onPersistedStateChange}
        />,
      );
    });

    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const pointB = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:B"]',
    ) as SVGElement | null;
    if (!commandInput || !preview || !pointB) throw new Error('Traverse point-to-point targets not found');
    mockElementRect(preview);
    const bounds = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    }).bounds!;
    const pointBScreen = projectWorldToPreviewScreen(bounds, { x: 100, y: 0 });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: pointBScreen.clientX,
          clientY: pointBScreen.clientY,
        }),
      );
      pointB.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: pointBScreen.clientX,
          clientY: pointBScreen.clientY,
          button: 0,
        }),
      );
      pointB.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: pointBScreen.clientX,
          clientY: pointBScreen.clientY,
          button: 0,
        }),
      );
      clickButton(container, 'TRAV');
      (container.querySelector('[data-survey-cad-traverse-mode-point-to-point]') as HTMLButtonElement | null)?.click();
    });

    await act(async () => {
      (container.querySelector('[data-survey-cad-traverse-use-selected-close]') as HTMLButtonElement | null)?.click();
    });

    expect(container.querySelector('[data-survey-cad-traverse-close-target]')?.textContent).toBe('B');

    await act(async () => {
      setTextInputValue(commandInput, 'A=0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'P1=N45-00-00E,20');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-traverse-draft]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('adds traverse sideshots in the draft panel and commits them as geometry', async () => {
    const persistedCapture = createPersistedStateCapture();
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
          persistedState={null}
          onPersistedStateChange={persistedCapture.onPersistedStateChange}
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
    });

    const sideshotInput = container.querySelector('[data-survey-cad-traverse-sideshot-input]') as HTMLInputElement | null;
    if (!sideshotInput) throw new Error('Sideshot input not found');

    await act(async () => {
      setTextInputValue(sideshotInput, 'SS1=L45,10');
      (container.querySelector('[data-survey-cad-traverse-sideshot-add]') as HTMLButtonElement | null)?.click();
    });

    expect(container.querySelectorAll('[data-survey-cad-traverse-sideshot-row]')).toHaveLength(1);
    expect(container.querySelector('[data-survey-cad-traverse-draft]')?.textContent).toContain('SS1');

    await act(async () => {
      pressKey(commandInput, 'Enter');
    });

    const persisted = persistedCapture.read();
    expect(persisted?.project.entities.some((entity) => entity.type === 'survey-point' && entity.stationId === 'SS1')).toBe(true);
    expect(
      persisted?.project.entities.some(
        (entity) => entity.type === 'line' && entity.toStationId === 'SS1',
      ),
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('adds traverse stations and finishes directly from the draft panel', async () => {
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

    await act(async () => {
      clickButton(container, 'TRAV');
    });

    const nextInput = container.querySelector('[data-survey-cad-traverse-next-input]') as HTMLInputElement | null;
    if (!nextInput) throw new Error('Traverse next-leg input not found');

    await act(async () => {
      setTextInputValue(nextInput, 'A=0,0');
      (container.querySelector('[data-survey-cad-traverse-next-add]') as HTMLButtonElement | null)?.click();
      setTextInputValue(nextInput, 'N90-00-00E,25');
      (container.querySelector('[data-survey-cad-traverse-next-add]') as HTMLButtonElement | null)?.click();
      setTextInputValue(nextInput, 'N0-00-00E,15');
      (container.querySelector('[data-survey-cad-traverse-next-add]') as HTMLButtonElement | null)?.click();
    });

    expect(container.querySelectorAll('[data-survey-cad-traverse-leg]')).toHaveLength(2);
    expect(container.querySelector('[data-survey-cad-traverse-draft]')?.textContent).toContain('CAD1');
    expect(container.querySelector('[data-survey-cad-traverse-draft]')?.textContent).toContain('CAD2');

    await act(async () => {
      (container.querySelector('[data-survey-cad-traverse-finish]') as HTMLButtonElement | null)?.click();
    });

    expect(container.querySelector('[data-survey-cad-traverse-draft]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('applies Bowditch adjustment in the traverse draft and persists the adjustment report on commit', async () => {
    const persistedCapture = createPersistedStateCapture();
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
          persistedState={null}
          onPersistedStateChange={persistedCapture.onPersistedStateChange}
        />,
      );
    });

    await act(async () => {
      clickButton(container, 'TRAV');
      (container.querySelector('[data-survey-cad-traverse-mode-closed]') as HTMLButtonElement | null)?.click();
    });

    const nextInput = container.querySelector('[data-survey-cad-traverse-next-input]') as HTMLInputElement | null;
    if (!nextInput) throw new Error('Traverse next-leg input not found');

    await act(async () => {
      setTextInputValue(nextInput, 'A=0,0');
      (container.querySelector('[data-survey-cad-traverse-next-add]') as HTMLButtonElement | null)?.click();
      setTextInputValue(nextInput, 'N90-00-00E,100');
      (container.querySelector('[data-survey-cad-traverse-next-add]') as HTMLButtonElement | null)?.click();
      setTextInputValue(nextInput, 'N0-00-00E,98');
      (container.querySelector('[data-survey-cad-traverse-next-add]') as HTMLButtonElement | null)?.click();
    });

    await act(async () => {
      (container.querySelector('[data-survey-cad-traverse-adjust-bowditch]') as HTMLButtonElement | null)?.click();
    });

    expect(container.querySelector('[data-survey-cad-traverse-adjustment-method]')?.textContent).toBe('bowditch');
    expect(container.querySelector('[data-survey-cad-traverse-adjustment-report]')?.textContent).toContain('0.000 m');

    await act(async () => {
      (container.querySelector('[data-survey-cad-traverse-finish]') as HTMLButtonElement | null)?.click();
    });

    const latestComputation = persistedCapture.read()?.project.cogoComputations.at(-1);
    expect(latestComputation?.toolKey).toBe('TRAVERSE');
    expect(latestComputation?.report.rows.some((row) => row.label === 'Adjustment' && row.value === 'bowditch')).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('previews and commits batch deed cogo rows from the native batch panel', async () => {
    const persistedCapture = createPersistedStateCapture();
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
          persistedState={null}
          onPersistedStateChange={persistedCapture.onPersistedStateChange}
        />,
      );
    });

    await act(async () => {
      clickButton(container, 'DEED');
    });

    const batchInput = container.querySelector('[data-survey-cad-batch-cogo-input]') as HTMLTextAreaElement | null;
    if (!batchInput) throw new Error('Batch COGO input not found');

    await act(async () => {
      setTextAreaValue(
        batchInput,
        ['START POB=1000,1000', 'P1=N45-00-00E,100', 'CURVE RIGHT R 50 DELTA 30'].join('\n'),
      );
    });

    expect(container.querySelector('[data-survey-cad-batch-cogo-draft]')?.textContent).toContain('POB');
    expect(container.querySelectorAll('[data-survey-cad-batch-cogo-row]')).toHaveLength(3);
    expect(container.querySelector('[data-survey-cad-batch-cogo-end]')?.textContent).toBe('P2');

    await act(async () => {
      (container.querySelector('[data-survey-cad-batch-cogo-commit]') as HTMLButtonElement | null)?.click();
    });

    expect(container.querySelector('[data-survey-cad-batch-cogo-draft]')).toBeNull();
    expect(persistedCapture.read()?.project.cogoComputations.at(-1)?.toolKey).toBe('BATCH_COGO');
    expect(
      persistedCapture.read()?.project.entities.some((entity) => entity.type === 'arc'),
    ).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
