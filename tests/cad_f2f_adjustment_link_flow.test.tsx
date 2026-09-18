/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import {
  createBlankCadDrawingDocument,
  createBlankCadProject,
} from '../src/engine/cad/cadDrawingFile';
import {
  applyFieldToFinishPayload,
  type FieldToFinishCadPayload,
} from '../src/engine/fieldToFinish/cadGeneration';
import { applySuccessfulAdjustmentRunToDrawing } from '../src/engine/fieldToFinish/linkedRerunSync';
import { SurveyCadFieldToFinishPanel } from '../src/components/surveyCad/SurveyCadFieldToFinishPanel';
import type { AdjustmentResult, Station } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const station = (x: number, y: number, h: number): Station =>
  ({ x, y, h, fixed: false }) as Station;

const resultOf = (
  stations: Record<string, Station>,
  sideshots?: Array<Record<string, unknown>>,
): AdjustmentResult =>
  ({ success: true, stations, ...(sideshots !== undefined ? { sideshots } : {}) }) as unknown as AdjustmentResult;

// CSV coords deliberately differ from adjusted coords to prove the overlay.
const CSV = [
  'Point,Northing,Easting,Elevation,Code,Description',
  'A,100,100,10,TREE,oak',
  'B,100,110,11,TREE,pine',
].join('\n');

const setNativeTextareaValue = (area: HTMLTextAreaElement, value: string): void => {
  // React controlled inputs ignore direct value assignment; go through the
  // native setter so the input event updates state.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(area, value);
};

const clickByText = async (element: HTMLElement, role: string, text: string): Promise<void> => {
  const target = [...element.querySelectorAll(`[role="${role}"]`)].find((node) =>
    node.textContent?.includes(text),
  );
  expect(target, text).not.toBeUndefined();
  await act(async () => {
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const renderPanel = async (
  csv: string,
  adjustmentSource: {
    result: AdjustmentResult;
    inputFingerprint: string;
    settingsFingerprint: string;
  } | null,
): Promise<{ element: HTMLElement; payloads: FieldToFinishCadPayload[]; cleanup: () => void }> => {
  const payloads: FieldToFinishCadPayload[] = [];
  const element = document.createElement('div');
  document.body.appendChild(element);
  const root = createRoot(element);
  await act(async () => {
    root.render(
      <SurveyCadFieldToFinishPanel
        project={createBlankCadProject({ name: 'F2F', units: 'm' })}
        onCommitPayload={(payload) => { payloads.push(payload); }}
        adjustmentSource={adjustmentSource}
      />,
    );
  });
  await clickByText(element, 'tab', 'Load/Review');
  await act(async () => {
    const area = element.querySelector(
      'textarea[aria-label="Coded point CSV"]',
    ) as HTMLTextAreaElement;
    setNativeTextareaValue(area, csv);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    element.querySelector('button[data-f2f-import-run]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await clickByText(element, 'tab', 'Commit');
  return { element, payloads, cleanup: () => { root.unmount(); element.remove(); } };
};

describe('f2f adjustment link flow (production wiring)', () => {
  it('creates an adjustment link through the panel, syncs the rerun, leaves imports alone', async () => {
    const adjustmentSource = {
      result: resultOf({ A: station(0, 0, 10), B: station(10, 0, 11) }),
      inputFingerprint: 'in-A',
      settingsFingerprint: 'set-A',
    };
    const { element, payloads, cleanup } = await renderPanel(CSV, adjustmentSource);
    try {
      // Explicit opt-in only: both commits offered, adjusted one annotated.
      const note = element.querySelector('[data-f2f-adjusted-note]');
      expect(note?.textContent).toContain('2 of 2 stations use adjusted coordinates');
      expect(element.querySelector('button[data-f2f-commit]')).not.toBeNull();
      const linked = element.querySelector('button[data-f2f-commit-adjusted]');
      expect(linked).not.toBeNull();
      await act(async () => {
        linked?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(payloads).toHaveLength(1);

      // The committed link is adjustment-backed with the run's revision, and
      // generated points carry adjusted (not CSV) coordinates.
      const project = applyFieldToFinishPayload(
        createBlankCadProject({ name: 'F2F', units: 'm' }),
        payloads[0] as FieldToFinishCadPayload,
      );
      expect(project.metadata.fieldToFinishLink?.sourceKind).toBe('adjustment');
      expect(project.metadata.fieldToFinishLink?.sourceRevision).toBe('in-A:set-A');
      const pointA = project.entities.find((entry) => entry.id === 'pt:A');
      expect(pointA?.type === 'survey-point' && [pointA.x, pointA.y]).toEqual([0, 0]);

      // A successful rerun through the production subscriber core moves the
      // generated coordinates.
      const drawing = { ...createBlankCadDrawingDocument({ name: 'F2F', units: 'm' }), project };
      const moved = applySuccessfulAdjustmentRunToDrawing(drawing, {
        result: resultOf({ A: station(1, 1, 10), B: station(10, 0, 11) }),
        inputFingerprint: 'in-A',
        settingsFingerprint: 'set-A',
      });
      expect(moved).not.toBe(drawing);
      const movedA = moved?.project.entities.find((entry) => entry.id === 'pt:A');
      expect(movedA?.type === 'survey-point' && [movedA.x, movedA.y]).toEqual([1, 1]);
      expect(moved?.project.metadata.fieldToFinishLink?.status).toBe('CURRENT');
    } finally {
      cleanup();
    }
  });

  it('keeps the plain commit coordinate-import (rerun is a no-op)', async () => {
    const adjustmentSource = {
      result: resultOf({ A: station(0, 0, 10), B: station(10, 0, 11) }),
      inputFingerprint: 'in-A',
      settingsFingerprint: 'set-A',
    };
    const { element, payloads, cleanup } = await renderPanel(CSV, adjustmentSource);
    try {
      await act(async () => {
        element.querySelector('button[data-f2f-commit]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(payloads).toHaveLength(1);
      const project = applyFieldToFinishPayload(
        createBlankCadProject({ name: 'F2F', units: 'm' }),
        payloads[0] as FieldToFinishCadPayload,
      );
      expect(project.metadata.fieldToFinishLink?.sourceKind).toBe('coordinate-import');
      const drawing = { ...createBlankCadDrawingDocument({ name: 'F2F', units: 'm' }), project };
      const outcome = applySuccessfulAdjustmentRunToDrawing(drawing, {
        result: resultOf({ A: station(1, 1, 10), B: station(10, 0, 11) }),
        inputFingerprint: 'in-A',
        settingsFingerprint: 'set-A',
      });
      expect(outcome).toBe(drawing);
    } finally {
      cleanup();
    }
  });

  it('covers sideshot-only stations in the linked commit', async () => {
    // B exists only as a sideshot: same adjusted-wins/sideshots-fill
    // resolution as rerun sync, so the linked commit is allowed.
    const adjustmentSource = {
      result: resultOf(
        { A: station(0, 0, 10) },
        [{ id: 'ss-b', from: 'A', to: 'B', easting: 10, northing: 0, height: 11 }],
      ),
      inputFingerprint: 'in-A',
      settingsFingerprint: 'set-A',
    };
    const { element, payloads, cleanup } = await renderPanel(CSV, adjustmentSource);
    try {
      expect(element.querySelector('[data-f2f-adjusted-note]')?.textContent)
        .toContain('2 of 2 stations use adjusted coordinates');
      await act(async () => {
        element.querySelector('button[data-f2f-commit-adjusted]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(payloads).toHaveLength(1);
      const project = applyFieldToFinishPayload(
        createBlankCadProject({ name: 'F2F', units: 'm' }),
        payloads[0] as FieldToFinishCadPayload,
      );
      expect(project.metadata.fieldToFinishLink?.sourceKind).toBe('adjustment');
      const pointB = project.entities.find((entry) => entry.id === 'pt:B');
      expect(pointB?.type === 'survey-point' && [pointB.x, pointB.y]).toEqual([10, 0]);
      // The follow-up rerun finds every linked station: no MISSING_SOURCE.
      const drawing = { ...createBlankCadDrawingDocument({ name: 'F2F', units: 'm' }), project };
      const moved = applySuccessfulAdjustmentRunToDrawing(drawing, {
        result: resultOf(
          { A: station(0, 0, 10) },
          [{ id: 'ss-b', from: 'A', to: 'B', easting: 11, northing: 0, height: 11 }],
        ),
        inputFingerprint: 'in-A',
        settingsFingerprint: 'set-A',
      });
      expect(moved?.project.metadata.fieldToFinishLink?.status).toBe('CURRENT');
      const movedB = moved?.project.entities.find((entry) => entry.id === 'pt:B');
      expect(movedB?.type === 'survey-point' && [movedB.x, movedB.y]).toEqual([11, 0]);
    } finally {
      cleanup();
    }
  });

  it('refuses the linked commit when a reviewed station lacks run coverage', async () => {
    // B is in neither stations nor sideshots: the linked button must not
    // exist (committing it would doom the first rerun to MISSING_SOURCE),
    // while the plain coordinate-import commit stays available.
    const adjustmentSource = {
      result: resultOf({ A: station(0, 0, 10) }),
      inputFingerprint: 'in-A',
      settingsFingerprint: 'set-A',
    };
    const { element, payloads, cleanup } = await renderPanel(CSV, adjustmentSource);
    try {
      expect(element.querySelector('[data-f2f-adjusted-note]')?.textContent)
        .toContain('Linked commit unavailable: B has no adjusted or sideshot coordinates');
      expect(element.querySelector('button[data-f2f-commit-adjusted]')).toBeNull();
      await act(async () => {
        element.querySelector('button[data-f2f-commit]')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(payloads).toHaveLength(1);
      const project = applyFieldToFinishPayload(
        createBlankCadProject({ name: 'F2F', units: 'm' }),
        payloads[0] as FieldToFinishCadPayload,
      );
      expect(project.metadata.fieldToFinishLink?.sourceKind).toBe('coordinate-import');
    } finally {
      cleanup();
    }
  });
});
