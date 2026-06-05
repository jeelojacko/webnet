/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import SurveyCadPreview from '../src/components/surveyCad/SurveyCadPreview';
import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import { appendCadProjectEntities, buildCadProjectSignature } from '../src/engine/cad/cadProjectState';
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

const ParentBackedCampWorkspace: React.FC = () => {
  const baseProject = React.useMemo(
    () =>
      buildSurveyCadSpikeProject({
        input: campInput,
        instrumentLibrary: {},
        parseOptions: campParseOptions,
        units: 'm',
        result: null,
      }),
    [],
  );
  const [persistedState, setPersistedState] = React.useState<null | {
    version: 1;
    sourceSignature: string;
    project: ReturnType<typeof buildSurveyCadSpikeProject>;
  }>({
    version: 1,
    sourceSignature: buildCadProjectSignature(baseProject),
    project: baseProject,
  });

  return (
    <SurveyCadWorkspace
      input={campInput}
      instrumentLibrary={{}}
      parseOptions={{ ...campParseOptions }}
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

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('A-C');

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

  it('shows arc-body nearest during LINE on a small arc instead of letting endpoints steal the snap', async () => {
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
          id: 'arc:small-hover-test',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 65,
          centerY: 35,
          radius: 1,
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

    const arcBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 65, y: 36 });
    await act(async () => {
      clickButton(container, 'LINE');
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcBodyScreen.clientX,
          clientY: arcBodyScreen.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('arc:small-hover-test');

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

  it('keeps perpendicular direction active without Shift so true line intersection beats apparent snaps', async () => {
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
          id: 'line:target',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: -2,
          fromY: 14,
          toX: 8,
          toY: 14,
          sourceObservationIds: [],
        },
        {
          id: 'line:apparent-bait',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L5',
          toStationId: 'L6',
          fromX: 2,
          fromY: 8,
          toX: 8,
          toY: 2,
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
      setTextInputValue(commandInput, '2,18');
      pressKey(commandInput, 'Enter');
    });

    const perpendicularAcquireScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 2.2, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: perpendicularAcquireScreen.clientX,
          clientY: perpendicularAcquireScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');

    const targetLineBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 14.1 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: targetLineBodyScreen.clientX,
          clientY: targetLineBodyScreen.clientY,
        }),
      );
    });

    const badgeText = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(badgeText).toContain('Perpendicular');
    expect(badgeText.toLowerCase()).not.toContain('apparent');
    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 2, y: 14 });
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

  it('keeps tangent lock active while refining onto a nearby line body during LINE input', async () => {
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
          id: 'line:tangent-target',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 5,
          fromY: 6,
          toX: 5,
          toY: 16,
          sourceObservationIds: [],
        },
        {
          id: 'arc:tangent-source',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
          radius: 10,
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '0,20');
      pressKey(commandInput, 'Enter');
    });

    const tangentAcquireScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 8.7, y: 5.1 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentAcquireScreen.clientX,
          clientY: tangentAcquireScreen.clientY,
          shiftKey: true,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Tangent');

    const tangentLineBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 14 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentLineBodyScreen.clientX,
          clientY: tangentLineBodyScreen.clientY,
          shiftKey: true,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Tangent');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('locked');
    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5, y: 20 - 5 * Math.sqrt(3) });
    expect(Number(previewLine.getAttribute('x2'))).toBeCloseTo(snappedIntersectionScreen.clientX, 8);
    expect(Number(previewLine.getAttribute('y2'))).toBeCloseTo(snappedIntersectionScreen.clientY, 8);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps tangent direction active without Shift so true line intersection beats extension/apparent alternatives', async () => {
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
          id: 'line:tangent-target',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
          fromX: 5,
          fromY: 6,
          toX: 5,
          toY: 16,
          sourceObservationIds: [],
        },
        {
          id: 'line:apparent-bait',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L3',
          toStationId: 'L4',
          fromX: 1,
          fromY: 15,
          toX: 9,
          toY: 11,
          sourceObservationIds: [],
        },
        {
          id: 'arc:tangent-source',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 0,
          centerY: 0,
          radius: 10,
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
    const commandInput = container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement | null;
    if (!preview || !commandInput) throw new Error('Preview or command input not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'LINE');
      setTextInputValue(commandInput, '0,20');
      pressKey(commandInput, 'Enter');
    });

    const tangentAcquireScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 8.7, y: 5.1 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentAcquireScreen.clientX,
          clientY: tangentAcquireScreen.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Tangent');

    const tangentLineBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5.1, y: 14 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentLineBodyScreen.clientX,
          clientY: tangentLineBodyScreen.clientY,
        }),
      );
    });

    const badgeText = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(badgeText).toContain('Tangent');
    expect(badgeText.toLowerCase()).not.toContain('apparent');
    expect(badgeText.toLowerCase()).not.toContain('ext');
    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 5, y: 20 - 5 * Math.sqrt(3) });
    expect(Number(previewLine.getAttribute('x2'))).toBeCloseTo(snappedIntersectionScreen.clientX, 8);
    expect(Number(previewLine.getAttribute('y2'))).toBeCloseTo(snappedIntersectionScreen.clientY, 8);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps perpendicular lock active while refining onto a nearby arc body during LINE input', async () => {
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
          id: 'arc:perp-target',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 10,
          centerY: 10,
          radius: 5,
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
      setTextInputValue(commandInput, '8,18');
      pressKey(commandInput, 'Enter');
    });

    const perpendicularAcquireScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 8.2, y: 0.2 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: perpendicularAcquireScreen.clientX,
          clientY: perpendicularAcquireScreen.clientY,
          shiftKey: true,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');

    const perpendicularArcBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 10.3, y: 14.5 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: perpendicularArcBodyScreen.clientX,
          clientY: perpendicularArcBodyScreen.clientY,
          shiftKey: true,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Perpendicular');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('arc:perp-target');
    const previewLine = container.querySelector('[data-survey-cad-command-preview-line]') as SVGLineElement | null;
    if (!previewLine) throw new Error('Preview line not found');
    const snappedIntersectionScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 8, y: 10 + Math.sqrt(21) });
    expect(Number(previewLine.getAttribute('x2'))).toBeCloseTo(snappedIntersectionScreen.clientX, 8);
    expect(Number(previewLine.getAttribute('y2'))).toBeCloseTo(snappedIntersectionScreen.clientY, 8);

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
          commandPointInputActive={false}
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
          commandPointInputActive
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
      {
        snapSourceSegmentId: 'pline:chain#0',
        snapSourceEntityId: 'pline:chain',
        snapKind: 'midpoint',
      },
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('latches the visible snap on mouse down so click still commits it after hover drift', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const consumeInteractionPoint = vi.fn();

    const renderPreview = (activeSnap: {
      id: string;
      kind: 'midpoint';
      sourceEntityId: string;
      sourceSegmentId: string;
      x: number;
      y: number;
      distance: number;
      label: string;
    } | null) =>
      root.render(
        <SurveyCadPreview
          scene={{ primitives: [], bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 } }}
          viewBounds={{ minX: 0, minY: 0, maxX: 10, maxY: 10 }}
          selectedEntityIds={[]}
          selectedParcelReport={null}
          activeSnap={activeSnap}
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
          commandPointInputActive
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

    await act(async () => {
      renderPreview({
        id: 'midpoint:pline:chain:P1-P2',
        kind: 'midpoint',
        sourceEntityId: 'pline:chain',
        sourceSegmentId: 'pline:chain#0',
        x: 5,
        y: 0,
        distance: 0.1,
        label: 'P1-P2',
      });
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const background = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
          clientX: 220,
          clientY: 320,
        }),
      );
    });

    await act(async () => {
      renderPreview(null);
    });

    const rerenderedBackground = container.querySelector('[data-survey-cad-background="true"]') as SVGRectElement | null;
    if (!rerenderedBackground) throw new Error('Rerendered preview background not found');
    mockElementRect(rerenderedBackground);

    await act(async () => {
      rerenderedBackground.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 260,
          clientY: 360,
        }),
      );
    });

    expect(consumeInteractionPoint).toHaveBeenCalledWith(
      { x: 5, y: 0 },
      'P1-P2',
      {
        snapSourceSegmentId: 'pline:chain#0',
        snapSourceEntityId: 'pline:chain',
        snapKind: 'midpoint',
      },
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shrinks snap query tolerance and visible snap window as viewport zoom increases', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const pointerWorldPointChange = vi.fn();

    const renderPreview = (zoom: number) =>
      root.render(
        <SurveyCadPreview
          scene={{ primitives: [], bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 } }}
          viewBounds={{ minX: 0, minY: 0, maxX: 100, maxY: 100 }}
          selectedEntityIds={[]}
          selectedParcelReport={null}
          activeSnap={null}
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
          viewport={{ zoom, panX: 0, panY: 0 }}
          commandActive
          commandPointInputActive
          onViewportChange={() => null}
          onSelectEntity={() => null}
          onSelectEntities={() => null}
          onConsumeInteractionPoint={() => null}
          onPointerWorldPointChange={pointerWorldPointChange}
          onSnapPreferenceChange={() => null}
          onCommandInputChange={() => null}
          onCommandInputEnter={() => null}
          onCommandInputEscape={() => null}
          onZoomExtents={() => null}
        />,
      );

    await act(async () => {
      renderPreview(1);
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!preview) throw new Error('Preview not found');
    const initialPreview = preview;
    mockElementRect(initialPreview);

    await act(async () => {
      initialPreview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 450,
          clientY: 260,
        }),
      );
    });

    const firstCall = pointerWorldPointChange.mock.calls.at(-1);
    if (!firstCall) throw new Error('First pointer callback not captured');

    await act(async () => {
      renderPreview(64);
    });

    const rerenderedPreview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!rerenderedPreview) throw new Error('Preview not found after rerender');
    mockElementRect(rerenderedPreview);

    await act(async () => {
      rerenderedPreview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 450,
          clientY: 260,
        }),
      );
    });

    const secondCall = pointerWorldPointChange.mock.calls.at(-1);
    if (!secondCall) throw new Error('Second pointer callback not captured');
    expect(secondCall[1]).toBeLessThan(firstCall[1]);
    expect(secondCall[2]?.visibleBounds.maxX - secondCall[2]?.visibleBounds.minX).toBeLessThan(
      firstCall[2]?.visibleBounds.maxX - firstCall[2]?.visibleBounds.minX,
    );
    expect(secondCall[2]?.visibleBounds.maxY - secondCall[2]?.visibleBounds.minY).toBeLessThan(
      firstCall[2]?.visibleBounds.maxY - firstCall[2]?.visibleBounds.minY,
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('cycles nearby cursor-local snaps with Space after LINE captures its first point', async () => {
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
      setTextInputValue(commandInput, '20,20');
      pressKey(commandInput, 'Enter');
    });

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="direction"]') as HTMLInputElement | null)?.click();
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

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');

    await act(async () => {
      pressKey(window, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Endpoint');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('A');

    await act(async () => {
      pressKey(window, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Point');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('A');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('cycles nearby cursor-local snaps with Space during POINT while command input stays focused', async () => {
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
      clickButton(container, 'POINT');
    });

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="direction"]') as HTMLInputElement | null)?.click();
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

    expect(document.activeElement).toBe(commandInput);
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');

    await act(async () => {
      pressKey(commandInput, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Endpoint');

    await act(async () => {
      pressKey(commandInput, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Point');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('cycles nearby cursor-local snaps with Space during ARC 3PT point capture', async () => {
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
    const arcMenuButton = container.querySelector('[data-survey-cad-arc-menu-button]') as HTMLButtonElement | null;
    if (!preview || !commandInput || !arcMenuButton) throw new Error('Preview, command input, or arc menu not found');
    mockElementRect(preview);

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, '3 Point');
      setTextInputValue(commandInput, '20,20');
      pressKey(commandInput, 'Enter');
    });

    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="direction"]') as HTMLInputElement | null)?.click();
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

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Nearest');

    await act(async () => {
      pressKey(commandInput, ' ');
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Endpoint');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows an exact intersection snap during live POINT placement over crossing linework', async () => {
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
          id: 'line:h',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'H1',
          toStationId: 'H2',
          fromX: 0,
          fromY: 10,
          toX: 20,
          toY: 10,
          sourceObservationIds: [],
        },
        {
          id: 'line:v',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'V1',
          toStationId: 'V2',
          fromX: 10,
          fromY: 0,
          toX: 10,
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
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'POINT');
    });
    await act(async () => {
      const snapMenuButton = container.querySelector('[data-survey-cad-snap-menu-button]') as HTMLButtonElement | null;
      if (!snapMenuButton) throw new Error('Snap menu button not found');
      snapMenuButton.click();
    });
    await act(async () => {
      (container.querySelector('[data-survey-cad-snap-toggle="midpoint"]') as HTMLInputElement | null)?.click();
      (container.querySelector('[data-survey-cad-snap-toggle="nearest"]') as HTMLInputElement | null)?.click();
    });

    const crossingScreen = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 10.1, y: 9.9 });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: crossingScreen.clientX,
          clientY: crossingScreen.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent).toContain('Intersection');

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

  it('commits one POINT history entry in StrictMode browser-style rendering', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <React.StrictMode>
          <SurveyCadWorkspace
            input={input}
            instrumentLibrary={{}}
            parseOptions={parseOptions}
            units="m"
            result={null}
          />
        </React.StrictMode>,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!preview) throw new Error('Preview not found');
    mockElementRect(preview);

    await act(async () => {
      clickButton(container, 'POINT');
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: 180,
          clientY: 120,
        }),
      );
    });

    expect(container.textContent).toContain('1 undo');
    expect(container.textContent).not.toContain('2 undo');

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

  it('holds a tangent guide after LINE starts from an arc snap point', async () => {
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
          id: 'arc:tangent-hold-test',
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
    const arcHitTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:tangent-hold-test"]',
    ) as SVGPathElement | null;
    if (!preview || !arcHitTarget) throw new Error('Preview or arc hit target not found');
    mockElementRect(preview);
    mockElementRect(arcHitTarget);

    const arcTop = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 50, y: 32 });
    const tangentHover = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 72, y: 32.2 });

    await act(async () => {
      clickButton(container, 'LINE');
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcTop.clientX,
          clientY: arcTop.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('arc:tangent-hold-test');

    await act(async () => {
      arcHitTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: arcTop.clientX,
          clientY: arcTop.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentHover.clientX,
          clientY: tangentHover.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Tangent');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('arc:tangent-hold-test');
    expect(container.querySelectorAll('[data-survey-cad-snap-guide]')).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('resolves a real tangent snap when LINE approaches an arc from an external start point', async () => {
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
          id: 'arc:tangent-attach-test',
          type: 'arc' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          centerX: 50,
          centerY: 20,
          radius: 10,
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
    if (!preview || !background) throw new Error('Preview background not found');
    mockElementRect(preview);
    mockElementRect(background);

    const startPoint = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 50, y: 40 });
    const tangentPoint = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 58.7, y: 25.1 });

    await act(async () => {
      clickButton(container, 'LINE');
    });
    await act(async () => {
      background.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: startPoint.clientX,
          clientY: startPoint.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: tangentPoint.clientX,
          clientY: tangentPoint.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Tangent');
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('arc:tangent-attach-test');

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

  it('snaps LINE nearest onto an arc created by ARC 3PT', async () => {
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
    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!arcMenuButton || !commandInput || !preview) throw new Error('Arc menu, command input, or preview not found');
    mockElementRect(preview);

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, '3 Point');
      setTextInputValue(commandInput, '10,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '20,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '30,0');
      pressKey(commandInput, 'Enter');
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('ARC_3PT committed');
    const persistedProject = capture.read()?.project;
    if (!persistedProject?.bounds) throw new Error('Persisted project bounds not captured');

    const arcBodyScreen = projectWorldToPreviewScreen(persistedProject.bounds, { x: 23, y: 8 });

    await act(async () => {
      clickButton(container, 'LINE');
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcBodyScreen.clientX,
          clientY: arcBodyScreen.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Nearest');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('lets LINE start from and finish onto the body of an ARC 3PT arc created in the same workspace session', async () => {
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
    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    if (!arcMenuButton || !commandInput || !preview) throw new Error('Arc menu, command input, or preview not found');
    mockElementRect(preview);

    await act(async () => {
      arcMenuButton.click();
    });
    await act(async () => {
      clickButton(container, '3 Point');
      setTextInputValue(commandInput, '10,0');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '20,10');
      pressKey(commandInput, 'Enter');
      setTextInputValue(commandInput, '30,0');
      pressKey(commandInput, 'Enter');
    });

    const persistedProject = capture.read()?.project;
    if (!persistedProject?.bounds) throw new Error('Persisted project bounds not captured');

    const arcBodyStart = projectWorldToPreviewScreen(persistedProject.bounds, { x: 23, y: 8 });
    const lineStart = projectWorldToPreviewScreen(persistedProject.bounds, { x: 55, y: 5 });
    const arcBodyEnd = projectWorldToPreviewScreen(persistedProject.bounds, { x: 17, y: 8 });

    await act(async () => {
      clickButton(container, 'LINE');
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('LINE active');
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcBodyStart.clientX,
          clientY: arcBodyStart.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Nearest');

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: arcBodyStart.clientX,
          clientY: arcBodyStart.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lineStart.clientX,
          clientY: lineStart.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: lineStart.clientX,
          clientY: lineStart.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('LINE committed');

    await act(async () => {
      clickButton(container, 'LINE');
    });
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('LINE active');
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lineStart.clientX,
          clientY: lineStart.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: lineStart.clientX,
          clientY: lineStart.clientY,
        }),
      );
    });
    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: arcBodyEnd.clientX,
          clientY: arcBodyEnd.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Nearest');

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: arcBodyEnd.clientX,
          clientY: arcBodyEnd.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('LINE committed');

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

  it('runs TRIM from the command surface by using selected cutting edges and clicking the portion to remove', async () => {
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
    const trimProject = appendCadProjectEntities(baseProject, [
      {
        id: 'line:trim-target',
        type: 'line',
        layerId: 'observation-lines',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        fromStationId: 'T1',
        toStationId: 'T2',
        fromX: 10,
        fromY: 20,
        toX: 90,
        toY: 20,
        sourceObservationIds: [],
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
            project: trimProject,
          }}
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const cutA = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:A|C"]',
    ) as SVGLineElement | null;
    const cutB = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:B|C"]',
    ) as SVGLineElement | null;
    const trimTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:trim-target"]',
    ) as SVGLineElement | null;
    if (!preview || !cutA || !cutB || !trimTarget) throw new Error('Trim targets not found');
    mockElementRect(preview);

    const removePick = projectWorldToPreviewScreen(trimProject.bounds!, { x: 50, y: 20 });

    await act(async () => {
      cutA.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      cutB.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0, shiftKey: true }));
      clickButton(container, 'TRIM');
    });

    expect(container.querySelector('[data-survey-cad-selection-count]')?.textContent).toContain('2 selected');

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: removePick.clientX,
          clientY: removePick.clientY,
        }),
      );
      trimTarget.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: removePick.clientX,
          clientY: removePick.clientY,
        }),
      );
    });

    const dimmedTarget = container.querySelector(
      '[data-survey-cad-render-entity-id="line:trim-target"]',
    ) as SVGLineElement | null;
    const trimPreviewLines = Array.from(
      container.querySelectorAll('[data-survey-cad-command-preview-line]'),
    ) as SVGLineElement[];

    expect(dimmedTarget?.getAttribute('opacity')).toBe('0.22');
    expect(trimPreviewLines).toHaveLength(2);

    await act(async () => {
      trimTarget.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: removePick.clientX,
          clientY: removePick.clientY,
          button: 0,
        }),
      );
      trimTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: removePick.clientX,
          clientY: removePick.clientY,
          button: 0,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('TRIM committed');

    const trimmedLines = capture.read()?.project.entities.filter(
      (entity) => entity.type === 'line' && entity.fromY === 20 && entity.toY === 20,
    );
    expect(trimmedLines).toHaveLength(2);
    expect(trimmedLines?.some((entity) => entity.type === 'line' && entity.fromX === 10 && entity.toX === 30)).toBe(true);
    expect(trimmedLines?.some((entity) => entity.type === 'line' && entity.fromX === 80 && entity.toX === 90)).toBe(true);
    expect(capture.read()?.project.entities.some((entity) => entity.id === 'line:trim-target')).toBe(false);

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

  it('keeps MOVE exact through parent-backed persisted-state rerenders on the default Camp workspace', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(<ParentBackedCampWorkspace />);
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:GPS2|GPS5"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Parent-backed Camp move targets not found');
    mockElementRect(preview);

    const bounds = buildSurveyCadSpikeProject({
      input: campInput,
      instrumentLibrary: {},
      parseOptions: campParseOptions,
      units: 'm',
      result: null,
    }).bounds!;
    const gps2 = projectWorldToPreviewScreen(bounds, { x: 683005.038, y: 5090804.624 });

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      clickButton(container, 'MOVE');
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: gps2.clientX,
          clientY: gps2.clientY,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: gps2.clientX,
          clientY: gps2.clientY,
          button: 0,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: gps2.clientX,
          clientY: gps2.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      const commandInput = container.querySelector(
        '[data-survey-cad-command-input]',
      ) as HTMLInputElement | null;
      if (!commandInput) throw new Error('Parent-backed Camp command input not found after MOVE base pick');
      setTextInputValue(commandInput, '682979.351,5090926.628');
      pressKey(commandInput, 'Enter');
    });

    const movedLine = container.querySelectorAll(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:GPS2|GPS5"]',
    );
    expect(movedLine.length).toBeGreaterThan(0);
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('MOVE committed');

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

  it('shows line endpoint grips and commits dragged endpoint edits', async () => {
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
          id: 'line:grip-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'L1',
          toStationId: 'L2',
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

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:grip-test"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Preview or line target not found');
    mockElementRect(preview);

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelectorAll('[data-survey-cad-grip-handle]')).toHaveLength(2);

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="line-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Line start handle not found');
    const movedStart = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 15, y: 22 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: movedStart.clientX,
          clientY: movedStart.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: movedStart.clientX,
          clientY: movedStart.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: movedStart.clientX,
          clientY: movedStart.clientY,
        }),
      );
    });

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:grip-test');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Dragged line not found');
    expect(line.fromX).toBeCloseTo(15, 6);
    expect(line.fromY).not.toBeCloseTo(12, 6);
    expect(container.querySelector('[data-survey-cad-command-status]')?.textContent).toContain('GRIP_EDIT committed');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('limits snapping to selected entity nodes while the entity stays selected', async () => {
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
          id: 'line:snap-filter-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'SF1',
          toStationId: 'SF2',
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
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:snap-filter-test"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Preview or line target not found');
    mockElementRect(preview);
    const lineMid = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 34, y: 15 });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lineMid.clientX,
          clientY: lineMid.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')).not.toBeNull();

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: lineMid.clientX,
          clientY: lineMid.clientY,
        }),
      );
    });
    expect(container.querySelector('[data-survey-cad-snap-badge]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('commits a dragged grip endpoint to the visible snap target on mouse release', async () => {
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
          id: 'line:snap-commit-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'SC1',
          toStationId: 'SC2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
          sourceObservationIds: [],
        },
        {
          id: 'pt:snap-target',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'SNAPPT',
          x: 14,
          y: 24,
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:snap-commit-test"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Preview or line target not found');
    mockElementRect(preview);

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="line-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Line start handle not found');
    const snapTarget = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 14, y: 24 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: snapTarget.clientX,
          clientY: snapTarget.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: snapTarget.clientX,
          clientY: snapTarget.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('SNAPPT');

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: snapTarget.clientX,
          clientY: snapTarget.clientY,
        }),
      );
    });

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:snap-commit-test');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Dragged line not found');
    expect(line.fromX).toBeCloseTo(14, 6);
    expect(line.fromY).toBeCloseTo(24, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('moves the selected entity so the picked base point lands exactly on the snapped target', async () => {
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
          id: 'line:move-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'MV1',
          toStationId: 'MV2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
          sourceObservationIds: [],
        },
        {
          id: 'pt:move-target',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'MOVEPT',
          x: 14,
          y: 24,
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:move-test"]',
    ) as SVGLineElement | null;
    const pointTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:move-target"]',
    ) as SVGCircleElement | null;
    if (!preview || !lineTarget || !pointTarget) throw new Error('Move test targets not found');
    mockElementRect(preview);

    const moveBase = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 20, y: 12 });
    const moveTarget = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 14, y: 24 });

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
          clientX: moveBase.clientX,
          clientY: moveBase.clientY,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: moveBase.clientX,
          clientY: moveBase.clientY,
          button: 0,
        }),
      );
      lineTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: moveBase.clientX,
          clientY: moveBase.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: moveTarget.clientX,
          clientY: moveTarget.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('MOVEPT');

    await act(async () => {
      pointTarget.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: moveTarget.clientX,
          clientY: moveTarget.clientY,
          button: 0,
        }),
      );
      pointTarget.dispatchEvent(
        new MouseEvent('click', {
          bubbles: true,
          clientX: moveTarget.clientX,
          clientY: moveTarget.clientY,
          button: 0,
        }),
      );
    });

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:move-test');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Moved line not found');
    expect(line.fromX).toBeCloseTo(14, 6);
    expect(line.fromY).toBeCloseTo(24, 6);
    expect(line.toX).toBeCloseTo(42, 6);
    expect(line.toY).toBeCloseTo(30, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('moves the real Camp line endpoint from GPS2 exactly onto 109 without overshoot', async () => {
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
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:109|GPS2"]',
    ) as SVGLineElement | null;
    const pointTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="pt:109"]',
    ) as SVGCircleElement | null;
    if (!preview || !lineTarget || !pointTarget) throw new Error('Camp move test targets not found');
    mockElementRect(preview);

    const gps2 = { x: 683005.038, y: 5090804.624 };
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

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:109|GPS2');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Moved Camp line not found');
    expect(line.toX).toBeCloseTo(pt109.x, 6);
    expect(line.toY).toBeCloseTo(pt109.y, 6);
    expect(line.fromX).toBeCloseTo(682953.664, 3);
    expect(line.fromY).toBeCloseTo(5091048.632, 3);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps MOVE target hover on exact 109 object snaps instead of construction compounds', async () => {
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
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:GPS2|GPS5"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Camp MOVE hover targets not found');
    mockElementRect(preview);

    const gps2 = { x: 683005.038, y: 5090804.624 };
    const pt109 = { x: 682979.351, y: 5090926.628 };
    const basePick = projectWorldToPreviewScreen(baseProject.bounds!, gps2);
    const targetPick = projectWorldToPreviewScreen(baseProject.bounds!, pt109);

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
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
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').not.toContain(
      'Parallel',
    );
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').not.toContain(
      'Extension',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

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

  it('shows vertex grips for polylines and drags the chosen vertex', async () => {
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
          id: 'polyline:grip-test',
          type: 'polyline' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          vertices: [
            { x: 16, y: 8 },
            { x: 28, y: 14 },
            { x: 40, y: 9 },
            { x: 52, y: 16 },
          ],
          vertexLabels: ['P1', 'P2', 'P3', 'P4'],
          closed: false,
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

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const polylineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="polyline:grip-test"]',
    ) as SVGLineElement | null;
    if (!preview || !polylineTarget) throw new Error('Preview or polyline target not found');
    mockElementRect(preview);

    await act(async () => {
      polylineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelectorAll('[data-survey-cad-grip-handle="vertex"]')).toHaveLength(4);

    const vertexHandle = container.querySelector(
      '[data-survey-cad-grip-handle-id="polyline:grip-test:vertex:1"]',
    ) as SVGCircleElement | null;
    if (!vertexHandle) throw new Error('Polyline vertex handle not found');
    const movedVertex = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 30, y: 22 });

    await act(async () => {
      vertexHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
        }),
      );
    });

    const polyline = capture.read()?.project.entities.find((entity) => entity.id === 'polyline:grip-test');
    expect(polyline?.type).toBe('polyline');
    if (polyline?.type !== 'polyline') throw new Error('Dragged polyline not found');
    expect(polyline.vertices[1]?.x).toBeCloseTo(30, 6);
    expect(polyline.vertices[1]?.y).toBeCloseTo(22, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows vertex grips for polygons and commits dragged polygon corners', async () => {
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
          id: 'polygon:grip-test',
          type: 'polygon' as const,
          layerId: 'parcels',
          styleId: 'style-parcel',
          visible: true,
          locked: false,
          vertices: [
            { x: 18, y: 8 },
            { x: 34, y: 8 },
            { x: 36, y: 20 },
            { x: 16, y: 18 },
          ],
          vertexLabels: ['G1', 'G2', 'G3', 'G4'],
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

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const polygonTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="polygon:grip-test"]',
    ) as SVGLineElement | null;
    if (!preview || !polygonTarget) throw new Error('Preview or polygon target not found');
    mockElementRect(preview);

    await act(async () => {
      polygonTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelectorAll('[data-survey-cad-grip-handle="vertex"]')).toHaveLength(4);

    const vertexHandle = container.querySelector(
      '[data-survey-cad-grip-handle-id="polygon:grip-test:vertex:2"]',
    ) as SVGCircleElement | null;
    if (!vertexHandle) throw new Error('Polygon vertex handle not found');
    const movedVertex = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 42, y: 26 });

    await act(async () => {
      vertexHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: movedVertex.clientX,
          clientY: movedVertex.clientY,
        }),
      );
    });

    const polygon = capture.read()?.project.entities.find((entity) => entity.id === 'polygon:grip-test');
    expect(polygon?.type).toBe('polygon');
    if (polygon?.type !== 'polygon') throw new Error('Dragged polygon not found');
    expect(polygon.vertices[2]?.x).toBeCloseTo(42, 6);
    expect(polygon.vertices[2]?.y).toBeCloseTo(26, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows arc endpoint and radius grips, keeps endpoint edits on-arc, and updates radius grip edits', async () => {
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
          id: 'arc:grip-test',
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const arcTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:grip-test"]',
    ) as SVGPathElement | null;
    if (!preview || !arcTarget) throw new Error('Preview or arc target not found');
    mockElementRect(preview);

    await act(async () => {
      arcTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    expect(container.querySelectorAll('[data-survey-cad-grip-handle]')).toHaveLength(3);
    expect(container.querySelector('[data-survey-cad-grip-handle="arc-radius"]')).not.toBeNull();

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Arc start handle not found');
    const movedStart = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 56, y: 9.607695 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: movedStart.clientX,
          clientY: movedStart.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: movedStart.clientX,
          clientY: movedStart.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: movedStart.clientX,
          clientY: movedStart.clientY,
        }),
      );
    });

    let arc = capture.read()?.project.entities.find((entity) => entity.id === 'arc:grip-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Dragged arc not found');
    const movedStartX = arc.centerX + Math.cos((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    const movedStartY = arc.centerY + Math.sin((arc.startAngleDeg * Math.PI) / 180) * arc.radius;
    expect(movedStartX).toBeCloseTo(56, 3);
    expect(movedStartY).toBeCloseTo(9.607695, 3);
    expect(arc.radius).toBeCloseTo(12, 6);

    const radiusHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-radius"]',
    ) as SVGCircleElement | null;
    if (!radiusHandle) throw new Error('Arc radius handle not found');
    const movedRadius = projectWorldToPreviewScreen(capture.read()!.project.bounds!, { x: 50, y: 38 });

    await act(async () => {
      radiusHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: movedRadius.clientX,
          clientY: movedRadius.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: movedRadius.clientX,
          clientY: movedRadius.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: movedRadius.clientX,
          clientY: movedRadius.clientY,
        }),
      );
    });

    arc = capture.read()?.project.entities.find((entity) => entity.id === 'arc:grip-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Radius-edited arc not found');
    expect(arc.radius).toBeCloseTo(18, 3);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('turns an arc into a full circle when one endpoint grip is dragged onto the other endpoint', async () => {
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
          id: 'arc:full-circle-test',
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const arcTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:full-circle-test"]',
    ) as SVGPathElement | null;
    if (!preview || !arcTarget) throw new Error('Preview or arc target not found');
    mockElementRect(preview);

    await act(async () => {
      arcTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Arc start handle not found');
    const endPoint = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 38, y: 20 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: endPoint.clientX,
          clientY: endPoint.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: endPoint.clientX,
          clientY: endPoint.clientY,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: endPoint.clientX,
          clientY: endPoint.clientY,
        }),
      );
    });

    const arc = capture.read()?.project.entities.find((entity) => entity.id === 'arc:full-circle-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Edited arc not found');
    expect(Math.abs(arc.endAngleDeg - arc.startAngleDeg)).toBeCloseTo(360, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('turns an arc into a full circle when an endpoint grip releases onto the opposite endpoint snap', async () => {
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
          id: 'arc:full-circle-snap-test',
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const arcTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:full-circle-snap-test"]',
    ) as SVGPathElement | null;
    if (!preview || !arcTarget) throw new Error('Preview or arc target not found');
    mockElementRect(preview);

    await act(async () => {
      arcTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Arc start handle not found');
    const nearEndPoint = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 38.8, y: 20.6 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain(
      'arc:full-circle-snap-test',
    );

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
        }),
      );
    });

    const arc = capture.read()?.project.entities.find((entity) => entity.id === 'arc:full-circle-snap-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Edited arc not found');
    expect(Math.abs(arc.endAngleDeg - arc.startAngleDeg)).toBeCloseTo(360, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('turns an arc into a full circle during browser-style grip drag driven by window mouse events', async () => {
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
          id: 'arc:full-circle-window-test',
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const arcTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="arc:full-circle-window-test"]',
    ) as SVGPathElement | null;
    if (!preview || !arcTarget) throw new Error('Preview or arc target not found');
    mockElementRect(preview);

    await act(async () => {
      arcTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="arc-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Arc start handle not found');
    const nearEndPoint = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 38.8, y: 20.6 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
          button: 0,
        }),
      );
    });

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
        }),
      );
    });

    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain(
      'arc:full-circle-window-test',
    );

    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: nearEndPoint.clientX,
          clientY: nearEndPoint.clientY,
        }),
      );
    });

    const arc = capture.read()?.project.entities.find((entity) => entity.id === 'arc:full-circle-window-test');
    expect(arc?.type).toBe('arc');
    if (arc?.type !== 'arc') throw new Error('Edited arc not found');
    expect(Math.abs(arc.endAngleDeg - arc.startAngleDeg)).toBeCloseTo(360, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('cycles nearby snaps with Space during grip editing and commits the cycled target', async () => {
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
          id: 'line:grip-space-test',
          type: 'line' as const,
          layerId: 'observation-lines',
          styleId: 'style-observation-line',
          visible: true,
          locked: false,
          fromStationId: 'GS1',
          toStationId: 'GS2',
          fromX: 20,
          fromY: 12,
          toX: 48,
          toY: 18,
          sourceObservationIds: [],
        },
        {
          id: 'pt:grip-space-a',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'GSA',
          x: 14,
          y: 24,
          pointClass: 'free' as const,
          source: 'parsed-input' as const,
        },
        {
          id: 'pt:grip-space-b',
          type: 'survey-point' as const,
          layerId: 'points',
          styleId: 'style-point',
          visible: true,
          locked: false,
          stationId: 'GSB',
          x: 14.35,
          y: 24.3,
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
          onPersistedStateChange={capture.onPersistedStateChange}
        />,
      );
    });

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement | null;
    const lineTarget = container.querySelector(
      '[data-survey-cad-hit-target="true"][data-survey-cad-entity-id="line:grip-space-test"]',
    ) as SVGLineElement | null;
    if (!preview || !lineTarget) throw new Error('Preview or line target not found');
    mockElementRect(preview);

    await act(async () => {
      lineTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 0, clientY: 0 }));
    });

    const startHandle = container.querySelector(
      '[data-survey-cad-grip-handle="line-start"]',
    ) as SVGCircleElement | null;
    if (!startHandle) throw new Error('Line start handle not found');
    const snapCloud = projectWorldToPreviewScreen(persistedProject.bounds!, { x: 14.15, y: 24.15 });

    await act(async () => {
      startHandle.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: snapCloud.clientX,
          clientY: snapCloud.clientY,
          button: 0,
        }),
      );
      preview.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: snapCloud.clientX,
          clientY: snapCloud.clientY,
        }),
      );
    });

    const initialBadge = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(initialBadge).toMatch(/GSA|GSB/);

    await act(async () => {
      pressKey(window, ' ');
    });

    const cycledBadge = container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '';
    expect(cycledBadge).toMatch(/GSA|GSB/);
    expect(cycledBadge).not.toBe(initialBadge);

    await act(async () => {
      preview.dispatchEvent(
        new MouseEvent('mouseup', {
          bubbles: true,
          clientX: snapCloud.clientX,
          clientY: snapCloud.clientY,
        }),
      );
    });

    const line = capture.read()?.project.entities.find((entity) => entity.id === 'line:grip-space-test');
    expect(line?.type).toBe('line');
    if (line?.type !== 'line') throw new Error('Grip-cycled line not found');
    const expectedPoint = cycledBadge.includes('GSB') ? { x: 14.35, y: 24.3 } : { x: 14, y: 24 };
    expect(line.fromX).toBeCloseTo(expectedPoint.x, 6);
    expect(line.fromY).toBeCloseTo(expectedPoint.y, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('keeps zooming far past the old CAD zoom cap', async () => {
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
    const wheelAtCenter = () =>
      preview.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          clientX: 450,
          clientY: 260,
          deltaY: -120,
        }),
      );

    await act(async () => {
      Array.from({ length: 25 }).forEach(() => wheelAtCenter());
    });
    const afterTwentyFive = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);

    await act(async () => {
      Array.from({ length: 15 }).forEach(() => wheelAtCenter());
    });
    const afterForty = Number(firstLine()?.getAttribute('x1') ?? Number.NaN);

    expect(afterForty).not.toBeCloseTo(afterTwentyFive, 6);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
