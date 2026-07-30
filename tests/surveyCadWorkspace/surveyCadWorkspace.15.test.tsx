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
  it('enables selected-arc curve tools and creates a point on curve from the curve menu', async () => {
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
          id: 'arc:curve-cogo-test',
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

    const curveMenuButton = container.querySelector('[data-survey-cad-curve-menu-button]') as HTMLButtonElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!curveMenuButton || !commandInput) throw new Error('Expected curve menu button and command input');

    await act(async () => {
      curveMenuButton.click();
    });
    const pointOnCurveButtonBeforeSelection = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === 'Point On Curve',
    ) as HTMLButtonElement | undefined;
    if (!pointOnCurveButtonBeforeSelection) throw new Error('Point On Curve button not found before selection');
    expect(pointOnCurveButtonBeforeSelection.disabled).toBe(true);

    const arcHitTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:curve-cogo-test"]',
    ) as SVGElement | null;
    if (!arcHitTarget) throw new Error('Expected curve test arc hit target');

    await act(async () => {
      arcHitTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('1 selected');

    const pointOnCurveButton = (
      container.querySelector('[data-survey-cad-curve-menu]')
        ? Array.from(container.querySelectorAll('button')).find(
            (entry) => entry.textContent?.trim() === 'Point On Curve',
          )
        : null
    ) as HTMLButtonElement | null;
    if (!pointOnCurveButton) {
      await act(async () => {
        curveMenuButton.click();
      });
    }
    await act(async () => {
      clickButton(container, 'Point On Curve');
    });

    await act(async () => {
      setTextInputValue(commandInput, 'ARC,6');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'POINT committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('11 entities');
    expect(container.querySelector('[data-survey-cad-properties-panel-title]')?.textContent).toContain(
      'Properties',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Point class',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('reports bearing-distance intersection alternatives from the intersection menu', async () => {
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
    if (!commandInput) throw new Error('Expected command input');

    await act(async () => {
      (container.querySelector('[data-survey-cad-intersection-menu-button]') as HTMLButtonElement | null)?.click();
    });
    await act(async () => {
      clickButton(container, 'Bearing-Distance');
      setTextInputValue(commandInput, 'A=0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'B=3,5');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N00-00-00E;5');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-properties-panel-title]')?.textContent).toContain(
      'Properties',
    );
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'CAD1',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Point class',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
