/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import SurveyCadPreview from '../src/components/surveyCad/SurveyCadPreview';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { buildCadProjectSignature } from '../src/engine/cad/cadProjectState';
import type { ParseOptions } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const input = ['.2D', 'C A 0 0 0 ! !', 'C B 100 0 0 ! !', 'C C 60 40 0', 'D A-C 72.1110255 0.005', 'D B-C 56.5685425 0.005'].join('\n');
const campInput = readFileSync('tests/fixtures/camp_design_preanalysis_input.dat', 'utf8');

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

const campParseOptions: ParseOptions = {
  ...parseOptions,
  runMode: 'preanalysis',
  preanalysisMode: true,
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

const projectWorldToPreviewScreen = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  worldPoint: { x: number; y: number },
): { clientX: number; clientY: number } => {
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  const normalized = {
    minX: bounds.minX - width * 0.08,
    minY: bounds.minY - height * 0.08,
    maxX: bounds.maxX + width * 0.08,
    maxY: bounds.maxY + height * 0.08,
  };
  const scale = Math.min((900 - 36 * 2) / (normalized.maxX - normalized.minX), (520 - 36 * 2) / (normalized.maxY - normalized.minY));
  return {
    clientX: 36 + (worldPoint.x - normalized.minX) * scale,
    clientY: 520 - 36 - (worldPoint.y - normalized.minY) * scale,
  };
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

const createPersistedStateCapture = () => {
  let captured: null | {
    version: 1;
    sourceSignature: string;
    project: ReturnType<typeof buildSurveyCadSpikeProject>;
  } = null;
  const onPersistedStateChange = (
    update:
      | ((
          _previous:
            | null
            | {
                version: 1;
                sourceSignature: string;
                project: ReturnType<typeof buildSurveyCadSpikeProject>;
              },
        ) =>
          | null
          | {
              version: 1;
              sourceSignature: string;
              project: ReturnType<typeof buildSurveyCadSpikeProject>;
            })
      | null
      | {
          version: 1;
          sourceSignature: string;
          project: ReturnType<typeof buildSurveyCadSpikeProject>;
        },
  ) => {
    captured =
      typeof update === 'function'
        ? update(captured)
        : update;
  };
  return {
    read: () => captured,
    onPersistedStateChange,
  };
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
    expect(
      container.querySelector('[data-survey-cad-preview-shell]')?.getAttribute('class') ?? '',
    ).toContain('bg-slate-950');
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
    expect(container.querySelector('[data-survey-cad-snap-toggle="center"]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-toggle="arc-midpoint"]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-toggle="quadrant"]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-toggle="apparent-intersection"]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-toggle="extension"]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-toggle="perpendicular"]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-toggle="parallel"]')).not.toBeNull();
    expect(container.querySelector('[data-survey-cad-snap-toggle="tangent"]')).not.toBeNull();
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="point-node"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="endpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="center"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="arc-midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="quadrant"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="apparent-intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="perpendicular"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="parallel"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="tangent"]') as HTMLInputElement | null)?.click();
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

  it('shows the active snap kind and label beside the snap glyph', async () => {
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

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Endpoint');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('A');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('resolves arc midpoint and nearest hover snaps in the live workspace with zoom-aware snap range', async () => {
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
          id: 'arc:hover-test',
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

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    const arcMidpointScreen = projectWorldToPreviewScreen(baseProject.bounds!, { x: 50.2, y: 31.6 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcMidpointScreen.clientX,
          clientY: arcMidpointScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Arc Mid');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('arc:hover-test');

    const nearestScreen = projectWorldToPreviewScreen(baseProject.bounds!, { x: 57.2, y: 29.6 });
    await act(async () => {
      preview.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          clientX: nearestScreen.clientX,
          clientY: nearestScreen.clientY,
          deltaY: -120,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: nearestScreen.clientX,
          clientY: nearestScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('arc:hover-test');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps perpendicular lock active while refining onto an apparent intersection during LINE input', async () => {
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
        {
          id: 'line:base',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:short-vertical',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: 5,
          fromY: 15,
          toX: 5,
          toY: 25,
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
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '5,10');
      pressKey(commandInput, 'Enter');
    });

    const apparentPointScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: apparentPointScreen.clientX,
          clientY: apparentPointScreen.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent?.toLowerCase()).toContain('apparent');
    expect(container.querySelectorAll('[data-survey-cad-snap-guide]').length).toBeGreaterThanOrEqual(3);

    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5, y: 0 });
    expect(Number(previewLine.getAttribute('x2'))).toBeCloseTo(snappedIntersectionScreen.clientX, 8);
    expect(Number(previewLine.getAttribute('y2'))).toBeCloseTo(snappedIntersectionScreen.clientY, 8);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps a construction snap locked with Shift while hovering farther along the same derived line', async () => {
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
          id: 'line:base',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:remote-horizontal',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L5',
          toStationId: 'L6',
          fromX: 12,
          fromY: 20,
          toX: 18,
          toY: 20,
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
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '5,10');
      pressKey(commandInput, 'Enter');
    });

    const initialPerpScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.2, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: initialPerpScreen.clientX,
          clientY: initialPerpScreen.clientY,
          shiftKey: true,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');

    const fartherScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 19.8 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: fartherScreen.clientX,
          clientY: fartherScreen.clientY,
          shiftKey: true,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps midpoint-started LINE construction scope local instead of snapping remote parallels', async () => {
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
          id: 'line:base',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:local',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L2',
          toStationId: 'L3',
          fromX: 10,
          fromY: 0,
          toX: 10,
          toY: 10,
          sourceObservationIds: [],
        },
        {
          id: 'line:remote',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'R1',
          toStationId: 'R2',
          fromX: 40,
          fromY: -10,
          toX: 40,
          toY: 10,
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
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="nearest"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="endpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="point-node"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="apparent-intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="perpendicular"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      clickButton(container, 'LINE');
    });

    const midpointScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5, y: 0 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: midpointScreen.clientX,
          clientY: midpointScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Midpoint');

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: midpointScreen.clientX,
          clientY: midpointScreen.clientY,
        }),
      );
    });

    const remoteParallelScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 39.8, y: 6 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: remoteParallelScreen.clientX,
          clientY: remoteParallelScreen.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').not.toContain('Parallel');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('preserves the hovered midpoint snap when LINE starts so immediate clicks keep startup parallel scope local', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const baseProject = buildSurveyCadSpikeProject({
      input: campInput,
      instrumentLibrary: {},
      parseOptions: campParseOptions,
      units: 'm',
      result: null,
    });
    const persistedProject = baseProject;
    const startLine = persistedProject.entities.find(
      (entity) => entity.type === 'line' && entity.id === 'line:GPS2|GPS5',
    );
    const remoteLine = persistedProject.entities.find(
      (entity) => entity.type === 'line' && entity.id === 'line:119|120',
    );
    if (!startLine || startLine.type !== 'line' || !remoteLine || remoteLine.type !== 'line') {
      throw new Error('Expected startup linework not found');
    }

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
            project: persistedProject,
          }}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    const midpointScreen = projectWorldToPreviewScreen(persistedProject.bounds!, {
      x: (startLine.fromX + startLine.toX) / 2,
      y: (startLine.fromY + startLine.toY) / 2,
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: midpointScreen.clientX,
          clientY: midpointScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Midpoint');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('GPS2-GPS5');

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="point-node"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="center"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="arc-midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="quadrant"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="apparent-intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="perpendicular"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="tangent"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="nearest"]') as HTMLInputElement | null)?.click();
    });

    await act(async () => {
      clickButton(container, 'LINE');
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: midpointScreen.clientX,
          clientY: midpointScreen.clientY,
        }),
      );
    });

    const remoteScreen = projectWorldToPreviewScreen(persistedProject.bounds!, {
      x: (remoteLine.fromX + remoteLine.toX) / 2,
      y: (remoteLine.fromY + remoteLine.toY) / 2,
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: remoteScreen.clientX,
          clientY: remoteScreen.clientY,
        }),
      );
    });

    const badgeText = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(badgeText).not.toContain('119-120');
    expect(badgeText).not.toContain('120-119');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('uses the clicked line body as the LINE start seed so parallel preview does not fall back to remote lines', async () => {
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
        {
          id: 'line:base',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 0,
          fromY: 0,
          toX: 10,
          toY: 0,
          sourceObservationIds: [],
        },
        {
          id: 'line:local',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L2',
          toStationId: 'L3',
          fromX: 10,
          fromY: 0,
          toX: 10,
          toY: 10,
          sourceObservationIds: [],
        },
        {
          id: 'line:remote',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'R1',
          toStationId: 'R2',
          fromX: 35,
          fromY: -10,
          toX: 35,
          toY: 10,
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
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="point-node"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="endpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="center"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="arc-midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="quadrant"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="apparent-intersection"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="extension"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="perpendicular"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="tangent"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="nearest"]') as HTMLInputElement | null)?.click();
    });

    const baseLineScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.2, y: 0.1 });
    await act(async () => {
      clickButton(container, 'LINE');
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: baseLineScreen.clientX,
          clientY: baseLineScreen.clientY,
        }),
      );
    });

    const remoteScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 35.1, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: remoteScreen.clientX,
          clientY: remoteScreen.clientY,
        }),
      );
    });

    const badgeText = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(badgeText).not.toContain('R1-R2');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders tangent snap badge text and styling when tangent snap is active', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <SurveyCadPreview
          scene={{ primitives: [], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }}
          viewBounds={{ minX: 0, minY: 0, maxX: 10, maxY: 10 }}
          selectedEntityIds={[]}
          selectedParcelReport={null}
          activeSnap={{
            id: 'tangent:arc:tangent-test',
            kind: 'tangent',
            sourceEntityId: 'arc:tangent-test',
            x: 8.660254,
            y: 5,
            distance: 0.1,
            label: 'arc:tangent-test tangent',
            guideSegments: [
              [{ x: 0, y: 20 }, { x: 8.660254, y: 5 }],
              [{ x: 0, y: 0 }, { x: 8.660254, y: 5 }],
            ],
          }}
          commandPreviewPrimitives={[]}
          commandStatusText=""
          commandHelpText=""
          commandModifierHint=""
          constructionHint=""
          snapPreferences={{
            'point-node': true,
            endpoint: true,
            midpoint: true,
            center: true,
            'arc-midpoint': true,
            quadrant: true,
            intersection: true,
            'apparent-intersection': true,
            extension: true,
            perpendicular: true,
            parallel: true,
            direction: true,
            tangent: true,
            nearest: true,
          }}
          commandInputValue=""
          commandInputPlaceholder=""
          commandInputEnabled={false}
          viewport={{ zoom: 1, panX: 0, panY: 0 }}
          commandActive={false}
          onViewportChange={() => null}
          onSelectEntity={() => null}
          onSelectEntities={() => null}
          onConsumeInteractionPoint={() => null}
          onPointerWorldPointChange={() => null}
          onSnapPreferenceChange={() => null}
          onCommandInputChange={() => null}
          onCommandInputEnter={() => null}
          onCommandInputEscape={() => null}
          onZoomExtents={() => null}
        />,
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Tangent');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('arc:tangent-test');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.getAttribute('style')).toContain(
      'border-color',
    );
    expect(container.querySelectorAll('[data-survey-cad-snap-guide]')).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('uses the active snap when clicking the background during command drafting', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const consumeInteractionPoint = vi.fn();

    await act(async () => {
      root.render(
        <SurveyCadPreview
          scene={{ primitives: [], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }}
          viewBounds={{ minX: 0, minY: 0, maxX: 10, maxY: 10 }}
          selectedEntityIds={[]}
          selectedParcelReport={null}
          activeSnap={{
            id: 'midpoint:pline:chain:P1-P2',
            kind: 'midpoint',
            sourceEntityId: 'pline:chain',
            sourceSegmentId: 'pline:chain#0',
            x: 5,
            y: 0,
            distance: 0.1,
            label: 'P1-P2',
          }}
          commandPreviewPrimitives={[]}
          commandStatusText=""
          commandHelpText=""
          commandModifierHint=""
          constructionHint=""
          snapPreferences={{
            'point-node': true,
            endpoint: true,
            midpoint: true,
            center: true,
            'arc-midpoint': true,
            quadrant: true,
            intersection: true,
            'apparent-intersection': true,
            extension: true,
            perpendicular: true,
            parallel: true,
            direction: true,
            tangent: true,
            nearest: true,
          }}
          commandInputValue=""
          commandInputPlaceholder=""
          commandInputEnabled={false}
          viewport={{ zoom: 1, panX: 0, panY: 0 }}
          commandActive
          onViewportChange={() => null}
          onSelectEntity={() => null}
          onSelectEntities={() => null}
          onConsumeInteractionPoint={consumeInteractionPoint}
          onPointerWorldPointChange={() => null}
          onSnapPreferenceChange={() => null}
          onCommandInputChange={() => null}
          onCommandInputEnter={() => null}
          onCommandInputEscape={() => null}
          onZoomExtents={() => null}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 220,
          clientY: 220,
        }),
      );
    });

    expect(consumeInteractionPoint).toHaveBeenCalledWith(
      { x: 5, y: 0 },
      'P1-P2',
      { snapSourceSegmentId: 'pline:chain#0' },
    );

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

  it('starts LINE from an arc-body hit target and exposes arc nearest snaps during drafting', async () => {
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
          id: 'arc:line-snap-test',
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

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    const arcHitTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:line-snap-test"]',
    ) as SVGPathElement | null;
    if (!preview || !background || !arcHitTarget) throw new Error('Preview not found');
    mockElementRect(preview);
    mockElementRect(background);
    mockElementRect(arcHitTarget);

    const arcNearestStart = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 57.2, y: 29.6 });
    const lineEnd = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 72, y: 22 });

    await act(async () => {
      clickButton(container, 'LINE');
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcNearestStart.clientX,
          clientY: arcNearestStart.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Nearest');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('arc:line-snap-test');

    await act(async () => {
      arcHitTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: arcNearestStart.clientX,
          clientY: arcNearestStart.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lineEnd.clientX,
          clientY: lineEnd.clientY,
        }),
      );
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: lineEnd.clientX,
          clientY: lineEnd.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain('9 entities');

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

  it('explains that ARC 3PT uses the through point to fix the arc side instead of Ctrl flip', async () => {
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
      clickButton(container, 'ARC');
    });

    expect(container.querySelector('[data-survey-cad-command-help]')?.textContent).toContain(
      'through point fixes the arc side',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a live Ctrl flip hint only for arc modes that support alternate arc side', async () => {
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
    if (!arcMenuButton) throw new Error('Arc menu button not found');

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, 'Start End Radius');
    });

    expect(container.querySelector('[data-survey-cad-command-modifier-hint]')?.textContent).toContain(
      'Ctrl = Flip Arc',
    );

    await act(async () => {
      pressKey(window, 'Control');
    });

    expect(container.querySelector('[data-survey-cad-command-modifier-hint]')?.textContent).toContain(
      'Ctrl Held: Flip Arc',
    );

    await act(async () => {
      pressKey(window, 'Escape');
    });

    expect(container.querySelector('[data-survey-cad-command-modifier-hint]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows a live construction-snap base-point hint once a command captures its first point', async () => {
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
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-construction-hint]')?.textContent).toContain(
      'Base 0.000,0.000',
    );
    expect(container.querySelector('[data-survey-cad-construction-hint]')?.textContent).toContain(
      'Construction snaps live',
    );

    await act(async () => {
      pressKey(window, 'Escape');
    });

    expect(container.querySelector('[data-survey-cad-construction-hint]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('commits ARC Start Center End from an off-radius final pick by keeping the chosen center and using the picked direction', async () => {
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
      clickButton(container, 'Start Center End');
      setTextInputValue(commandInput, '10,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '0,8');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_SCE committed',
    );
    expect(container.querySelector('[data-survey-cad-entity-count]')?.textContent).toContain(
      '9 entities',
    );
    expect(container.querySelectorAll('path.cursor-pointer').length).toBeGreaterThan(0);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps ARC Start Center End start/end order on clockwise sweeps', async () => {
    const capture = createPersistedStateCapture();
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
          onPersistedStateChange={capture.onPersistedStateChange}
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
      clickButton(container, 'Start Center End');
      setTextInputValue(commandInput, '10,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '0,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '0,-10');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_SCE committed',
    );
    const arc = capture.read()?.project.entities.find((entity) => entity.type === 'arc');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Committed arc not found');
    const startX = arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    const startY = arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    const endX = arc.centerX + Math.cos((arc.endAngleDeg * Math.PI) / 180) * arc.radius;
    const endY = arc.centerY + Math.sin((arc.endAngleDeg * Math.PI) / 180) * arc.radius;
    expect(startX).toBeCloseTo(10, 6);
    expect(startY).toBeCloseTo(0, 6);
    expect(endX).toBeCloseTo(0, 6);
    expect(endY).toBeCloseTo(-10, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('routes Center Start End with true center-first point order', async () => {
    const capture = createPersistedStateCapture();
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
          onPersistedStateChange={capture.onPersistedStateChange}
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
      clickButton(container, 'Center Start End');
      setTextInputValue(commandInput, '50,50');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '70,50');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '50,65');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
      'ARC_CSE committed',
    );
    const arc = capture.read()?.project.entities.find((entity) => entity.type === 'arc');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Committed arc not found');
    expect(arc.centerX).toBeCloseTo(50, 6);
    expect(arc.centerY).toBeCloseTo(50, 6);
    const startX = arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    const startY = arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    expect(startX).toBeCloseTo(70, 6);
    expect(startY).toBeCloseTo(50, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('routes Center Start Angle and Center Start Length with true center-first point order', async () => {
    for (const [modeLabel, value, expectedEndX, expectedEndY, expectedStatus] of [
      ['Center Start Angle', '90', 50, 70, 'ARC_CSA committed'],
      ['Center Start Length', `${Math.sqrt(800)}`, 50, 70, 'ARC_CSL committed'],
    ] as const) {
      const capture = createPersistedStateCapture();
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
            onPersistedStateChange={capture.onPersistedStateChange}
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
        clickButton(container, modeLabel);
        setTextInputValue(commandInput, '50,50');
        pressKey(commandInput, 'Enter');
        setTextInputValue(commandInput, '70,50');
        pressKey(commandInput, 'Enter');
        setTextInputValue(commandInput, value);
        pressKey(commandInput, 'Enter');
      });

      expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain(
        expectedStatus,
      );
      const arc = capture.read()?.project.entities.find((entity) => entity.type === 'arc');
      expect(arc?.type).toBe('arc');
      if (arc?.type !== 'arc') throw new Error('Committed arc not found');
      expect(arc.centerX).toBeCloseTo(50, 6);
      expect(arc.centerY).toBeCloseTo(50, 6);
      const startX = arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
      const startY = arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
      const endX = arc.centerX + Math.cos((arc.endAngleDeg * Math.PI) / 180) * arc.radius;
      const endY = arc.centerY + Math.sin((arc.endAngleDeg * Math.PI) / 180) * arc.radius;
      expect(startX).toBeCloseTo(70, 6);
      expect(startY).toBeCloseTo(50, 6);
      expect(endX).toBeCloseTo(expectedEndX, 6);
      expect(endY).toBeCloseTo(expectedEndY, 6);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
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

  it('keeps the top CAD toolbar overlay vertically visible so the arc dropdown is not clipped', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    act(() => {
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

    const toolbarOverlay = container.querySelector('[data-survey-cad-toolbar-overlay]');
    expect(toolbarOverlay?.className).toContain('overflow-visible');
    expect(toolbarOverlay?.className).not.toContain('overflow-x-auto');

    act(() => {
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
      '11 entities',
    );
    expect(container.textContent).not.toContain('25.000,0.000');
    expect(container.textContent).not.toContain('25.000,15.000');

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
      '12 entities',
    );
    expect(container.textContent).toContain('187.500 m²');
    expect(container.textContent).toContain('69.155 m');
    expect(container.querySelector('[data-survey-cad-parcel-report]')?.textContent).toContain(
      'Closure',
    );
    expect(container.querySelector('[data-survey-cad-parcel-report]')?.textContent).toContain(
      'A-V2',
    );
    expect(container.querySelector('[data-survey-cad-parcel-report]')?.textContent).toContain(
      '90°00\'00"',
    );
    expect(container.querySelectorAll('[data-survey-cad-parcel-course]')).toHaveLength(3);

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
