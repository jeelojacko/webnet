/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  input,
  parseOptions,
  mockElementRect,
  setTextInputValue,
  pressKey,
  clickButton,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
  it('runs MOVE, COPY, COGO, ARC, TCURVE, and INVERSE from the streamlined command surface', async () => {
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
      clickButton(container, 'MOVE');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N90-00-00E,25');
      pressKey(commandInput, 'Enter');
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'MOVE committed',
    );

    await act(async () => {
      clickButton(container, 'COPY');
      setTextInputValue(commandInput, '25,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N0-00-00E,15');
      pressKey(commandInput, 'Enter');
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'COPY committed',
    );

    await act(async () => {
      clickButton(container, 'COGO');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N45-00-00E,20');
      pressKey(commandInput, 'Enter');
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'COGO_POINT committed',
    );

    await act(async () => {
      clickButton(container, 'ARC');
      setTextInputValue(commandInput, '5,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '0,5');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '-5,0');
      pressKey(commandInput, 'Enter');
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_3PT committed',
    );

    await act(async () => {
      const arcMenuButton = container.querySelector('[data-survey-cad-arc-menu-button]') as HTMLButtonElement | null;
      if (!arcMenuButton) throw new Error('Arc menu button not found');
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Tangent Curve');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '-10,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '0,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '10');
      pressKey(commandInput, 'Enter');
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'TANGENT_CURVE committed',
    );

    await act(async () => {
      clickButton(container, 'INV');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N90-00-00E,100');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'distance 100.000',
    );
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'azimuth 90.0000',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-title]')?.textContent).toContain(
      'Properties',
    );
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain(
      'CURVE2',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain(
      'Arc length',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('reports a multi-point inverse sequence from the point-line COGO menu', async () => {
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
      clickButton(container, 'P/L');
      setTextInputValue(commandInput, 'A=0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'B=0,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'C=10,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'MULTI_INVERSE reported 2 legs',
    );
    expect(container.querySelector('[data-survey-cad-properties-panel-title]')?.textContent).toContain(
      'Properties',
    );
    expect(container.querySelector('[data-survey-cad-properties-entity-label]')?.textContent).toContain('A');
    expect(container.querySelector('[data-survey-cad-properties-panel-rows]')?.textContent).toContain('Easting');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('reports area from a picked point sequence through the point-line COGO menu', async () => {
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
      (container.querySelector('[data-survey-cad-core-cogo-menu-button]') as HTMLButtonElement | null)?.click();
    });
    await act(async () => {
      clickButton(container, 'Area Sequence');
      setTextInputValue(commandInput, 'A=0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'B=0,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'C=10,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'AREA reported 3 sides, 50.000 m².',
    );
    const cogoPanels = Array.from(container.querySelectorAll('[data-survey-cad-cogo-panel]'));
    const areaPanel = cogoPanels.find((panel) =>
      panel.querySelector('[data-survey-cad-cogo-panel-source]')?.textContent?.includes('Latest COGO Result'),
    );
    expect(areaPanel?.querySelector('[data-survey-cad-cogo-panel-title]')?.textContent).toContain(
      'Area by Point Sequence',
    );
    expect(areaPanel?.querySelector('[data-survey-cad-cogo-panel-tool]')?.textContent).toContain('AREA');
    expect(areaPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      '50.000 m2',
    );
    expect(areaPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      '0.0050 ha',
    );
    expect(areaPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      '538.196 ft2',
    );
    expect(areaPanel?.querySelector('[data-survey-cad-cogo-panel-rows]')?.textContent).toContain(
      '14.142 m',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates a point along a selected line from the point-line COGO menu', async () => {
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

    const hitTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|C"]',
    ) as SVGLineElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!hitTarget || !commandInput) throw new Error('Expected line hit target and command input');

    await act(async () => {
      hitTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('1 selected');

    await act(async () => {
      (container.querySelector('[data-survey-cad-core-cogo-menu-button]') as HTMLButtonElement | null)?.click();
    });
    await act(async () => {
      clickButton(container, 'Point Along Line');
      setTextInputValue(commandInput, '50%');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'POINT committed',
    );
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
