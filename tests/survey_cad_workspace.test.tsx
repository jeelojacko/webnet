/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { buildCadProjectSignature } from '../src/engine/cad/cadProjectState';
import type { ParseOptions } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C C 60 40 0', 'D A-C 72.1110255 0.005', 'D B-C 56.5685425 0.005'].join('\n');

const parseOptions: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

const mockElementRect = (element: Element): void => {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      width: 900,
      height: 520,
      right: 900,
      bottom: 520,
      toJSON: () => ({}),
    }),
  });
};

const setTextInputValue = (inputElement: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  setter?.call(inputElement, value);
  inputElement.dispatchEvent(new Event('input', { bubbles: true }));
};

const pressKey = (
  target: EventTarget,
  key: string,
  options?: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean },
): void => {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key, ...options }));
};

const clickButton = (container: HTMLElement, label: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find(
    (entry) => entry.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
  if (!button) throw new Error(`Button ${label} not found`);
  button.click();
  return button;
};

const ParentBackedWorkspace: React.FC = () => {
  const [persistedState, setPersistedState] = React.useState<null | {
    version: 1;
    sourceSignature: string;
    project: ReturnType<typeof buildSurveyCadSpikeProject>;
  }>(null);

  return (
    <SurveyCadWorkspace
      input={input}
      instrumentLibrary={{}}
      parseOptions={{ ...parseOptions }}
      units="m"
      result={null}
      persistedState={persistedState}
      onPersistedStateChange={setPersistedState}
    />
  );
};

describe('SurveyCadWorkspace', () => {
  it('renders the dedicated CAD page without the removed helper tool buttons', async () => {
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

    expect(container.querySelector('[data-survey-cad-dedicated-page]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-preview]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-toolbar-overlay]')).not.toBeNull();
    expect(
      (container.querySelector('[data-survey-cad-preview]') as SVGElement | null)?.getAttribute('class') ?? '',
    ).not.toContain('border-slate-800');
    expect(container.textContent).not.toContain('Zoom Extents');
    expect(container.textContent).not.toContain('Zoom Window');
    expect(container.textContent).not.toContain('Use Snap');
    expect(container.textContent).not.toContain('Finish PLINE');
    expect(container.textContent).not.toContain('Submit');
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('8 entities');
    expect(container.querySelector('[data-survey-cad-command-input]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-command-help]')?.textContent ?? '').toBe('');
    expect(container.querySelector('[data-survey-cad-command-status]')).toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-menu-button]')?.textContent).toContain('Snaps');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('restores persisted Survey CAD state when the source signature matches the current workspace input', async () => {
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
          id: 'pt:CAD100',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'CAD100',
          x: 50,
          y: 15,
          pointClass: 'free' as const,
          source: 'parsed-input' as const,
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

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '9 entities',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('supports first command-surface edit flow with erase and undo', async () => {
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

    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain(
      '1 selected',
    );

    await act(async () => {
      clickButton(container, 'S-ALL');
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain(
      '8 selected',
    );
    const undoButtonAfterSelection = Array.from(container.querySelectorAll('button')).find(
      (entry) => entry.textContent?.trim() === 'UNDO',
    ) as HTMLButtonElement | undefined;
    if (!undoButtonAfterSelection) throw new Error('Undo button not found');
    expect(undoButtonAfterSelection.disabled).toBe(true);

    await act(async () => {
      clickButton(container, 'ERASE');
    });
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '0 entities',
    );
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ERASE committed',
    );

    await act(async () => {
      clickButton(container, 'UNDO');
    });
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '8 entities',
    );
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'Undo ERASE',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps point placement aligned with the cursor even when the viewport aspect ratio introduces vertical letterboxing', async () => {
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
    if (!preview) throw new Error('Preview not found');
    Object.defineProperty(preview, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 900,
        height: 700,
        right: 900,
        bottom: 700,
        toJSON: () => ({}),
      }),
    });

    await act(async () => {
      clickButton(container, 'POINT');
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 450,
          clientY: 600,
        }),
      );
    });

    const previewPoint = container.querySelector(
      '[data-survey-cad-command-preview-point]',
    ) as SVGCircleElement | null;
    if (!previewPoint) throw new Error('Preview point not found');
    expect(Number(previewPoint.getAttribute('cy'))).toBeCloseTo(510, 1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('lets the operator toggle snap kinds from the viewport snap menu', async () => {
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
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 94,
          clientY: 461,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-glyph]')).not.toBeNull();

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="point-node"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="endpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="nearest"]') as HTMLInputElement | null)?.click();
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 94,
          clientY: 461,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-glyph]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates a manual point from typed POINT input with Enter', async () => {
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
      setTextInputValue(commandInput, 'CAD77=10,20');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '10 entities',
    );
    expect(container.textContent).toContain('CAD77');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('draws a line directly from viewport clicks', async () => {
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

    await act(async () => {
      clickButton(container, 'LINE');
    });
    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 180,
          clientY: 410,
        }),
      );
    });
    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 320,
          clientY: 320,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'LINE committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '9 entities',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a live line preview while drawing before the second click commits', async () => {
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

    await act(async () => {
      clickButton(container, 'LINE');
    });
    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 180,
          clientY: 410,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 320,
          clientY: 320,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-preview]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'LINE active',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders a true arc path after committing ARC 3PT', async () => {
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
      clickButton(container, 'ARC');
      setTextInputValue(commandInput, '10,0');
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, '0,10');
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, '-10,0');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_3PT committed',
    );
    expect(container.querySelectorAll('path.cursor-pointer').length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('does not auto-reframe the camera when entity edits expand project extents', async () => {
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
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    const firstLine = () => preview.querySelector('line.cursor-pointer') as SVGLineElement | null;
    const startingX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!commandInput) throw new Error('Command input not found');

    await act(async () => {
      clickButton(container, 'POINT');
      setTextInputValue(commandInput, 'EXT1=500,500');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '10 entities',
    );
    expect(Number(firstLine()?.getAttribute('x1') ?? Number.NaN)).toBeCloseTo(startingX1, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('uses Enter and Escape for command flow instead of helper buttons', async () => {
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
      clickButton(container, 'PLINE');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '20,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, 'N45-00-00E,20');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PLINE committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '9 entities',
    );

    await act(async () => {
      clickButton(container, 'POINT');
    });
    await act(async () => {
      pressKey(commandInput, 'Escape');
    });

    expect(commandInput.disabled).toBe(true);
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).not.toContain(
      'POINT active',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

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

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates a start-end-radius arc from the arc dropdown and renders it as a path', async () => {
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

    const arcMenuButton = container.querySelector('[data-survey-cad-arc-menu-button]') as HTMLButtonElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!arcMenuButton || !commandInput) throw new Error('Arc menu or command input not found');

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Start End Radius');
    });
    await act(async () => {
      setTextInputValue(commandInput, '0,0');
    });
    await act(async () => {
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, '10,0');
    });
    await act(async () => {
      pressKey(commandInput, 'Enter');
    });
    await act(async () => {
      setTextInputValue(commandInput, '10');
    });
    await act(async () => {
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_SER committed',
    );
    expect(container.querySelectorAll('path.cursor-pointer').length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

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
      '13 entities',
    );

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
      '15 entities',
    );
    expect(container.textContent).toContain('Parcel 1');

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

  it('supports wheel zoom, middle-drag pan, middle-double-click extents, and directional drag-box selection', async () => {
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

    const firstLine = () => preview.querySelector('line.cursor-pointer') as SVGLineElement | null;
    const startingX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);

    await act(async () => {
      preview.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          clientX: 300,
          clientY: 220,
          deltaY: -120,
        }),
      );
    });
    const zoomedX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);
    expect(zoomedX1).not.toBeCloseTo(startingX1, 6);

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 1,
          clientX: 450,
          clientY: 260,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 520,
          clientY: 300,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 520,
          clientY: 300,
        }),
      );
    });
    const pannedX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);
    expect(pannedX1).not.toBeCloseTo(zoomedX1, 6);

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 1,
          clientX: 450,
          clientY: 260,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          button: 1,
          clientX: 450,
          clientY: 260,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 1,
          clientX: 450,
          clientY: 260,
        }),
      );
    });
    const resetX1 = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);
    expect(resetX1).toBeCloseTo(startingX1, 6);

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 880,
          clientY: 500,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 880,
          clientY: 500,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain(
      '8 selected',
    );

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 880,
          clientY: 500,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: 20,
          clientY: 20,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain(
      '8 selected',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
