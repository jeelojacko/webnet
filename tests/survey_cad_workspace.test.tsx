/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
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

describe('SurveyCadWorkspace', () => {
  const setTextInputValue = (inputElement: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(inputElement, value);
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('renders native spike preview and adapter export without a solve result', async () => {
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

    expect(container.textContent).toContain('Survey CAD Renderer / Model Spike');
    expect(container.textContent).toContain('parsed-input');
    expect(container.textContent).toContain('mlightcad');
    expect(container.querySelector('[data-survey-cad-preview]')).not.toBeNull();
    expect(container.textContent).toContain('"nativeEntityId"');
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('Ready');

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

    const findButton = (label: string): HTMLButtonElement => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Button ${label} not found`);
      return button;
    };

    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain(
      '1 selected',
    );

    await act(async () => {
      findButton('Select All').click();
    });
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain(
      '8 selected',
    );

    await act(async () => {
      findButton('ERASE').click();
    });
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '0 entities',
    );
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ERASE committed',
    );

    await act(async () => {
      findButton('Undo').click();
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

  it('shows snap feedback when the pointer moves over CAD geometry', async () => {
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
        height: 520,
        right: 900,
        bottom: 520,
        toJSON: () => ({}),
      }),
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

    expect(container.querySelector('[data-survey-cad-snap-status]')?.textContent).toContain(
      'Snap point-node: A',
    );
    expect(container.querySelector('[data-survey-cad-snap-glyph]')).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('creates a manual point from typed POINT input', async () => {
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

    const findButton = (label: string): HTMLButtonElement => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Button ${label} not found`);
      return button;
    };
    const commandInput = container.querySelector('input[type="text"]') as HTMLInputElement | null;
    if (!commandInput) throw new Error('Command input not found');

    await act(async () => {
      findButton('POINT').click();
    });
    await act(async () => {
      setTextInputValue(commandInput, 'CAD77=10,20');
    });
    await act(async () => {
      findButton('Submit').click();
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

  it('runs LINE and INVERSE command sessions from snap and typed input', async () => {
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

    const findButton = (label: string): HTMLButtonElement => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Button ${label} not found`);
      return button;
    };
    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const commandInput = container.querySelector('input[type="text"]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    Object.defineProperty(preview, 'getBoundingClientRect', {
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

    await act(async () => {
      findButton('LINE').click();
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 94,
          clientY: 461,
        }),
      );
    });
    await act(async () => {
      findButton('Use Snap').click();
    });
    await act(async () => {
      setTextInputValue(commandInput, '@90,25');
    });
    await act(async () => {
      findButton('Submit').click();
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'LINE committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '9 entities',
    );

    await act(async () => {
      findButton('INVERSE').click();
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 94,
          clientY: 461,
        }),
      );
    });
    await act(async () => {
      findButton('Use Snap').click();
    });
    await act(async () => {
      setTextInputValue(commandInput, 'N90-00-00E,100');
    });
    await act(async () => {
      findButton('Submit').click();
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

  it('builds a PLINE session and commits it through Finish PLINE', async () => {
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

    const findButton = (label: string): HTMLButtonElement => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Button ${label} not found`);
      return button;
    };
    const commandInput = container.querySelector('input[type="text"]') as HTMLInputElement | null;
    if (!commandInput) throw new Error('Command input not found');

    await act(async () => {
      findButton('PLINE').click();
    });
    await act(async () => {
      setTextInputValue(commandInput, '0,0');
    });
    await act(async () => {
      findButton('Submit').click();
    });
    await act(async () => {
      setTextInputValue(commandInput, '20,10');
    });
    await act(async () => {
      findButton('Submit').click();
    });
    await act(async () => {
      setTextInputValue(commandInput, 'N45-00-00E,20');
    });
    await act(async () => {
      findButton('Submit').click();
    });
    await act(async () => {
      findButton('Finish PLINE').click();
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'PLINE committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '9 entities',
    );
    expect(container.textContent).toContain('polyline');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('runs MOVE and COPY from the current selection using snap and survey bearing-distance input', async () => {
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

    const findButton = (label: string): HTMLButtonElement => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Button ${label} not found`);
      return button;
    };
    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const commandInput = container.querySelector('input[type="text"]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    Object.defineProperty(preview, 'getBoundingClientRect', {
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

    await act(async () => {
      findButton('MOVE').click();
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 94,
          clientY: 461,
        }),
      );
    });
    await act(async () => {
      findButton('Use Snap').click();
    });
    await act(async () => {
      setTextInputValue(commandInput, 'N90-00-00E,25');
    });
    await act(async () => {
      findButton('Submit').click();
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'MOVE committed',
    );

    await act(async () => {
      findButton('COPY').click();
      setTextInputValue(commandInput, '25,0');
    });
    await act(async () => {
      findButton('Submit').click();
    });
    await act(async () => {
      setTextInputValue(commandInput, 'N0-00-00E,15');
    });
    await act(async () => {
      findButton('Submit').click();
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'COPY committed',
    );
    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain(
      '2 selected',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '10 entities',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
