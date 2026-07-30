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
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('renders a committed upper arc on the same visible side as its snap geometry', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

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
          id: 'arc:upper-visible',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 50,
          centerY: 20,
          radius: 12,
          startAngleDeg: 0,
          endAngleDeg: 180,
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
        />,
      );
    });

    const arcPath = container.querySelector(
      'path.cursor-pointer[data-survey-cad-entity-id="arc:upper-visible"]',
    ) as SVGPathElement | null;
    if (!arcPath) throw new Error('Arc path not found');
    expect(arcPath.getAttribute('d') ?? '').toMatch(/ A [^ ]+ [^ ]+ 0 0 0 /);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a live traverse draft panel with leg rows and closure while TRAVERSE is active', async () => {
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
    });

    expect(container.querySelector('[data-survey-cad-traverse-draft]')).not.toBeNull();
    expect(container.querySelectorAll('[data-survey-cad-traverse-leg]')).toHaveLength(2);
    expect(container.querySelector('[data-survey-cad-traverse-draft]')?.textContent).toContain('A - CAD1');
    expect(container.querySelector('[data-survey-cad-traverse-closure]')?.textContent).toContain('29.155 m');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('rewinds and closes the live traverse draft before TRAVERSE commits', async () => {
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
    });

    await act(async () => {
      (container.querySelector('[data-survey-cad-traverse-rewind-leg="0"]') as HTMLButtonElement | null)?.click();
    });
    expect(container.querySelectorAll('[data-survey-cad-traverse-leg]')).toHaveLength(0);

    await act(async () => {
      setTextInputValue(commandInput, 'N45-00-00E,20');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N0-00-00E,10');
      pressKey(commandInput, 'Enter');
    });
    expect(container.querySelectorAll('[data-survey-cad-traverse-leg]')).toHaveLength(2);

    await act(async () => {
      (container.querySelector('[data-survey-cad-traverse-close-loop]') as HTMLButtonElement | null)?.click();
    });
    expect(container.querySelector('[data-survey-cad-traverse-closure]')?.textContent).toContain('0.000 m');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('replaces a traverse leg inline so downstream legs can be rebuilt from the draft panel', async () => {
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
    });

    await act(async () => {
      (container.querySelector('[data-survey-cad-traverse-edit-leg="1"]') as HTMLButtonElement | null)?.click();
    });
    const editInput = container.querySelector('[data-survey-cad-traverse-edit-input="1"]') as HTMLInputElement | null;
    if (!editInput) throw new Error('Traverse edit input not found');
    expect(editInput.value).toBe('N0-00-00E,15');

    await act(async () => {
      setTextInputValue(editInput, 'N45-00-00E,30');
      (container.querySelector('[data-survey-cad-traverse-apply-leg="1"]') as HTMLButtonElement | null)?.click();
    });

    expect(container.querySelectorAll('[data-survey-cad-traverse-leg]')).toHaveLength(2);
    expect(container.querySelector('[data-survey-cad-traverse-draft]')?.textContent).toContain('N45-00-00E,30');
    expect(commandInput.value).toBe('');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('inserts and reorders traverse legs from the draft table', async () => {
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

    await act(async () => {
      (container.querySelector('[data-survey-cad-traverse-insert-leg="1"]') as HTMLButtonElement | null)?.click();
    });

    const insertInput = container.querySelector('[data-survey-cad-traverse-insert-input]') as HTMLInputElement | null;
    if (!insertInput) throw new Error('Traverse insert input not found');

    await act(async () => {
      setTextInputValue(insertInput, 'N45-00-00E,10');
      (container.querySelector('[data-survey-cad-traverse-insert-apply]') as HTMLButtonElement | null)?.click();
    });

    expect(container.querySelectorAll('[data-survey-cad-traverse-leg]')).toHaveLength(3);
    expect(container.querySelector('[data-survey-cad-traverse-draft]')?.textContent).toContain('N45-00-00E,10');

    await act(async () => {
      (container.querySelector('[data-survey-cad-traverse-move-up="2"]') as HTMLButtonElement | null)?.click();
    });

    const legRows = Array.from(container.querySelectorAll('[data-survey-cad-traverse-leg]'));
    expect(legRows[1]?.textContent).toContain('N0-00-00E,15');
    expect(legRows[2]?.textContent).toContain('N45-00-00E,10');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
