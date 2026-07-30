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
  mockElementRect,
  setTextInputValue,
  pressKey,
  clickButton,
  ParentBackedWorkspace,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('creates an offset alignment from a selected alignment', async () => {
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
            end: { x: 100, y: 0 },
          },
          {
            kind: 'arc',
            center: { x: 100, y: 50 },
            radius: 50,
            startAngleDeg: -90,
            endAngleDeg: 0,
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
    if (!alignmentTarget || !commandInput) throw new Error('Offset alignment controls not found');

    await act(async () => {
      alignmentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      clickButton(container, 'ALIGN OFF');
      setTextInputValue(commandInput, '10');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ALIGN OFF committed',
    );
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'ALIGN2',
    );

    const persisted = capture.read();
    const alignments = persisted?.project.entities.filter((entity) => entity.type === 'alignment') ?? [];
    expect(alignments).toHaveLength(2);
    expect(alignments[1] && 'name' in alignments[1] ? alignments[1].name : null).toBe('ALIGN2');
    expect(persisted?.project.cogoComputations.at(-1)?.toolKey).toBe('ALIGNMENT_OFFSET');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('routes keyboard typing into the active command input without requiring an input click first', async () => {
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

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'LINE');
    });
    commandInput.blur();
    await act(async () => {
      pressKey(window, '1');
      pressKey(window, '0');
      pressKey(window, ',');
      pressKey(window, '2');
      pressKey(window, '0');
    });

    expect(commandInput.value).toBe('10,20');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('supports keyboard copy and insertion-point paste shortcuts for CAD selection', async () => {
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

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('8 entities');

    await act(async () => {
      clickButton(container, 'S-ALL');
    });
    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);
    await act(async () => {
      pressKey(window, 'c', { ctrlKey: true });
      pressKey(window, 'v', { ctrlKey: true });
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('8 entities');
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('PASTE active');
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 260,
          clientY: 320,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-command-preview]')).not.toBeNull();

    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!commandInput) throw new Error('Command input not found');

    await act(async () => {
      setTextInputValue(commandInput, '25,25');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('16 entities');
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('PASTE committed');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('supports keyboard undo after a committed CAD command without requiring focus changes', async () => {
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
      clickButton(container, 'POINT');
    });
    await act(async () => {
      setTextInputValue(commandInput, 'UNDO1=10,20');
      pressKey(commandInput, 'Enter');
    });
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('10 entities');

    await act(async () => {
      pressKey(window, 'z', { ctrlKey: true });
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('8 entities');
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('Undo POINT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('supports keyboard undo after a viewport-drawn line even when the toolbar button kept focus', async () => {
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

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    let lineButton: HTMLButtonElement | null = null;
    await act(async () => {
      lineButton = clickButton(container, 'LINE');
    });
    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 180,
          clientY: 410,
        }),
      );
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 320,
          clientY: 320,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('9 entities');
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'LINE committed',
    );

    await act(async () => {
      if (!lineButton) throw new Error('Line button not found');
      pressKey(lineButton, 'z', { ctrlKey: true });
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('8 entities');
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'Undo LINE',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps undo working through parent persisted-state rerenders in the live app wiring shape', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<ParentBackedWorkspace />);
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    await act(async () => {
      clickButton(container, 'POINT');
    });
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!commandInput) throw new Error('Command input not found');
    await act(async () => {
      setTextInputValue(commandInput, 'LIVE1=10,20');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('10 entities');
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('POINT committed');

    await act(async () => {
      clickButton(container, 'UNDO');
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('8 entities');
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('Undo POINT');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
