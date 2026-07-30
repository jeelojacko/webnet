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
  mockElementRect,
  clickButton,
} from './surveyCadWorkspaceTestSupport';

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

});
