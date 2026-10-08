/** @vitest-environment jsdom */

/**
 * PERF-183.1 — command-start pointer seed.
 *
 * Idle pointer moves update only the imperative pointer ref (no root commit).
 * When a new command that expects a point pick activates, the reactive preview
 * pointer must be seeded once from that ref so the first preview read uses the
 * live cursor rather than the previous command's committed position.
 */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  buildSurveyCadSpikeProject,
  input,
  parseOptions,
  mockElementRect,
  projectWorldToPreviewScreen,
  clickButton,
} from './surveyCadWorkspace/surveyCadWorkspaceTestSupport';

const commandPreviewPoint = (
  container: HTMLElement,
): { cx: number; cy: number } | null => {
  const point = container.querySelector(
    '[data-survey-cad-command-preview-point]',
  ) as SVGCircleElement | null;
  if (!point) return null;
  return { cx: Number(point.getAttribute('cx')), cy: Number(point.getAttribute('cy')) };
};

const mouseMove = (target: EventTarget, clientX: number, clientY: number): void => {
  target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX, clientY }));
};

describe('PERF-183.1 command-start pointer seed', () => {
  it('starts a new command preview from the live cursor after idle moves', async () => {
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

    const preview = container.querySelector('[data-survey-cad-preview]') as SVGElement;
    mockElementRect(preview);
    const bounds = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    }).bounds;
    if (!bounds) throw new Error('Expected project bounds');

    // Snap-free world points (far from the A-B / A-C / B-C geometry).
    const firstPosition = { x: 95, y: 35 };
    const livePosition = { x: 5, y: 38 };
    const firstScreen = projectWorldToPreviewScreen(bounds, firstPosition);
    const liveScreen = projectWorldToPreviewScreen(bounds, livePosition);

    // Command A: a live move commits the reactive preview pointer at P1.
    await act(async () => {
      clickButton(container, 'POINT');
    });
    await act(async () => {
      mouseMove(preview, firstScreen.clientX, firstScreen.clientY);
    });
    const firstPreview = commandPreviewPoint(container);
    expect(firstPreview).not.toBeNull();
    expect(firstPreview!.cx).toBeCloseTo(firstScreen.clientX, 3);
    expect(firstPreview!.cy).toBeCloseTo(firstScreen.clientY, 3);

    // Cancel command A; its reactive position stays committed.
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    });
    expect(commandPreviewPoint(container)).toBeNull();

    // Idle move to P2: imperative ref updates, reactive state must not.
    await act(async () => {
      mouseMove(preview, liveScreen.clientX, liveScreen.clientY);
    });
    expect(commandPreviewPoint(container)).toBeNull();

    // Command B activates without any further move: preview must read P2 (live
    // ref), never command A's committed P1.
    await act(async () => {
      clickButton(container, 'POINT');
    });
    const seededPreview = commandPreviewPoint(container);
    expect(seededPreview).not.toBeNull();
    expect(seededPreview!.cx).toBeCloseTo(liveScreen.clientX, 3);
    expect(seededPreview!.cy).toBeCloseTo(liveScreen.clientY, 3);
    expect(
      Math.hypot(seededPreview!.cx - firstScreen.clientX, seededPreview!.cy - firstScreen.clientY),
    ).toBeGreaterThan(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
