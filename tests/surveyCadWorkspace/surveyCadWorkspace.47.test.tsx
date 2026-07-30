/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  buildSurveyCadSpikeProject,
  buildCadProjectSignature,
  campInput,
  campParseOptions,
  mockElementRect,
  projectWorldToPreviewScreen,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspaceTestSupport';

describe('SurveyCadWorkspace', () => {
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

});
