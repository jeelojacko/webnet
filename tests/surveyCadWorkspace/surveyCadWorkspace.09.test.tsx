/** @vitest-environment jsdom */

import { act } from 'react';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  buildSurveyCadSpikeProject,
  buildCadProjectSignature,
  input,
  parseOptions,
  mockElementRect,
  projectWorldToPreviewScreen,
  clickButton,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
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
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Arc');

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
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Arc');

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
    expect(container.querySelector('[data-survey-cad-snap-badge]')?.textContent ?? '').toContain('Arc');
    expect(container.querySelectorAll('[data-survey-cad-snap-guide]')).toHaveLength(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
