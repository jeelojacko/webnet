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
  pressKey,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('auto-labels mouse-picked pline vertices with plain CAD names instead of raw coordinates', async () => {
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

    await act(async () => {
      root.render(
        <SurveyCadWorkspace
          input={input}
          instrumentLibrary={{}}
          parseOptions={parseOptions}
          units="m"
          result={null}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);
    const firstPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 12, y: 28 });
    const secondPick = projectWorldToPreviewScreen(baseProject.bounds!, { x: 28, y: 34 });

    await act(async () => {
      clickButton(container, 'PLINE');
      preview.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: firstPick.clientX,
          clientY: firstPick.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: firstPick.clientX,
          clientY: firstPick.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: secondPick.clientX,
          clientY: secondPick.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: secondPick.clientX,
          clientY: secondPick.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      setTextInputValue(commandInput, '');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('PLINE committed');
    const persistedProject = capture.read()?.project;
    const polyline = persistedProject?.entities.filter((entity) => entity.type === 'polyline').at(-1);
    expect(polyline?.type).toBe('polyline');
    expect(polyline?.type === 'polyline' ? polyline.vertexLabels : null).toEqual(['CAD1', 'CAD2']);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('closes the properties panel automatically when selection clears', async () => {
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

    const pointTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:A"]',
    ) as SVGElement | null;
    if (!pointTarget) throw new Error('Point target not found');

    await act(async () => {
      pointTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelector('[data-survey-cad-properties-panel]')).not.toBeNull();

    await act(async () => {
      clickButton(container, 'CLEAR');
    });

    expect(container.querySelector('[data-survey-cad-properties-panel]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('uses multi-select properties dropdowns to collapse selection to one entity', async () => {
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

    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|C"]',
    ) as SVGElement | null;
    const pointTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:C"]',
    ) as SVGElement | null;
    if (!lineTarget || !pointTarget) throw new Error('Mixed selection targets not found');

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      pointTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
    });

    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('2 selected');

    const typeSelect = container.querySelector(
      '[data-survey-cad-properties-type-select]',
    ) as HTMLSelectElement | null;
    const entitySelect = container.querySelector(
      '[data-survey-cad-properties-entity-select]',
    ) as HTMLSelectElement | null;
    if (!typeSelect || !entitySelect) throw new Error('Properties dropdowns not found');

    await act(async () => {
      typeSelect.value = 'survey-point';
      typeSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await act(async () => {
      entitySelect.value = 'pt:C';
      entitySelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('1 selected');
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain('C');
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain('Easting');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('edits point properties from properties panel and applies on enter', async () => {
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

    const pointTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:A"]',
    ) as SVGElement | null;
    if (!pointTarget) throw new Error('Point target not found');

    await act(async () => {
      pointTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const nameInput = container.querySelector(
      '[data-survey-cad-properties-input="name"]',
    ) as HTMLInputElement | null;
    if (!nameInput) throw new Error('Point name input not found');

    await act(async () => {
      setTextInputValue(nameInput, 'A_EDIT');
      pressKey(nameInput, 'Enter');
    });

    const updatedNameInput = container.querySelector(
      '[data-survey-cad-properties-input="name"]',
    ) as HTMLInputElement | null;
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain('A_EDIT');
    expect(updatedNameInput?.value).toBe('A_EDIT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('edits line length from properties panel and applies on enter', async () => {
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

    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|C"]',
    ) as SVGElement | null;
    if (!lineTarget) throw new Error('Line target not found');

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const lengthInput = container.querySelector(
      '[data-survey-cad-properties-input="length"]',
    ) as HTMLInputElement | null;
    if (!lengthInput) throw new Error('Line length input not found');

    await act(async () => {
      setTextInputValue(lengthInput, '100');
      pressKey(lengthInput, 'Enter');
    });

    const updatedLengthInput = container.querySelector(
      '[data-survey-cad-properties-input="length"]',
    ) as HTMLInputElement | null;
    expect(updatedLengthInput?.value).toBe('100.000');
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain('83.205');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
