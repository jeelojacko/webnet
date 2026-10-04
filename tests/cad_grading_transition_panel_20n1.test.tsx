/** @vitest-environment jsdom */

/**
 * Phase 20N.1 WAVE H — per-joint transition panel UI contracts.
 *
 * Multi-row list in canonical joint order, per-joint edit/remove, duplicate
 * prevention (re-stage replaces), and bounded overlap validation surfaced
 * from available geometry. Engine end-to-end (second joint stages) rides the
 * plural authoring path directly.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import { CadGradingGroupTransitionPanel } from '../src/cad-app/shell/CadGradingGroupTransitionPanel';
import type { CadGradingGroup } from '../src/engine/cad/grading/gradingGroupTypes';
import type { GradingCriterion, ResolvedGradingSource } from '../src/engine/cad/grading/gradingTypes';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import { setGroupTransition } from '../src/engine/cad/grading/gradingTransitionAuthoring';
import type { TransitionPersistedIntent } from '../src/engine/cad/grading/gradingTransitionProvenance';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DIST = (g: number, d: number): GradingCriterion => ({ kind: 'distance', gradeRatio: g, distance: d });

const src = (sx: number, ex: number): ResolvedGradingSource => ({
  startX: sx, startY: 0, endX: ex, endY: 0, startZ: 10, endZ: 10,
  length: Math.abs(ex - sx), reoriented: false, isArc: false,
});

const group = (transitions?: TransitionPersistedIntent[]): CadGradingGroup => ({
  id: 'gg-h',
  name: 'H',
  sourceFeatureLineId: 'fl',
  sourceCourses: [
    { vertexAId: 'a', vertexBId: 'b' },
    { vertexAId: 'b', vertexBId: 'c' },
    { vertexAId: 'c', vertexBId: 'd' },
  ],
  side: 'left',
  criterion: DIST(0.5, 5),
  maxSearchDistance: 10,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  ...(transitions ? { transitions } : {}),
}) as CadGradingGroup;

const staged = (jointId: string, memberIds: [string, string], width: number): TransitionPersistedIntent => ({
  policyVersion: 'trp1',
  jointId,
  memberIds: [...memberIds],
  width,
  lawKind: 'TRANSITION_LINEAR_V1',
  lawVersion: 'v1',
  criterionFamily: 'distance',
  side: 'left',
});

const sources = [src(-20, 0), src(0, 20), src(20, 40)];
const criteria = [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9)];

// 4-course group (joints 0..2) for SPARSE coverage: gap 0 -> 2 spans member 1+2.
const group4 = (transitions?: TransitionPersistedIntent[]): CadGradingGroup => ({
  id: 'gg-h4',
  name: 'H4',
  sourceFeatureLineId: 'fl',
  sourceCourses: [
    { vertexAId: 'a', vertexBId: 'b' },
    { vertexAId: 'b', vertexBId: 'c' },
    { vertexAId: 'c', vertexBId: 'd' },
    { vertexAId: 'd', vertexBId: 'e' },
  ],
  side: 'left',
  criterion: DIST(0.5, 5),
  maxSearchDistance: 10,
  curveChordTolerance: 0.01,
  cornerMode: 'miter',
  ...(transitions ? { transitions } : {}),
}) as CadGradingGroup;

const sources4 = [src(-40, -20), src(-20, 0), src(0, 20), src(20, 40)];
const criteria4 = [DIST(0.5, 5), DIST(0.5, 7), DIST(0.5, 9), DIST(0.5, 9)];

const renderPanel = async (ui: React.ReactElement): Promise<{ element: HTMLElement; cleanup: () => void }> => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const root = createRoot(element);
  await act(async () => {
    root.render(ui);
  });
  return {
    element,
    cleanup: () => {
      act(() => root.unmount());
      element.remove();
    },
  };
};

const setSelect = async (element: HTMLElement, label: string, value: string): Promise<void> => {
  const select = element.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

const setInput = async (element: HTMLElement, label: string, value: string): Promise<void> => {
  const input = element.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('20N.1 WAVE H transition panel', () => {
  it('lists every staged transition in canonical joint order', async () => {
    const g = group([staged('joint:1', ['b>c', 'c>d'], 6), staged('joint:0', ['a>b', 'b>c'], 8)]);
    const { element, cleanup } = await renderPanel(
      <CadGradingGroupTransitionPanel group={g} memberSources={sources} memberCriteria={criteria} side="left" run={() => true} onNotice={() => {}} />,
    );
    try {
      const rows = [...element.querySelectorAll('[data-cad-grading-group-transition-row]')];
      expect(rows.map((row) => row.getAttribute('data-cad-grading-group-transition-row'))).toEqual(['joint:0', 'joint:1']);
      expect(element.textContent).toContain('joint:0');
      expect(element.textContent).toContain('joint:1');
      expect(element.textContent).toContain('width 8 m');
      expect(element.textContent).toContain('width 6 m');
      // Stored out of order → truthful warning, rows still shown.
      expect(element.querySelector('[data-cad-grading-group-transition-order-warning]')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('re-staging an existing joint edits its width (no duplicate record)', async () => {
    const g = group([staged('joint:0', ['a>b', 'b>c'], 8)]);
    const calls: CadCommand[] = [];
    const notices: string[] = [];
    const { element, cleanup } = await renderPanel(
      <CadGradingGroupTransitionPanel
        group={g}
        memberSources={sources}
        memberCriteria={criteria}
        side="left"
        run={(command) => { calls.push(command); return true; }}
        onNotice={(message) => { notices.push(message); }}
      />,
    );
    try {
      await setSelect(element, 'Transition joint', '0');
      const width = element.querySelector('input[aria-label="Transition width"]') as HTMLInputElement;
      expect(width.value).toBe('8');
      await setInput(element, 'Transition width', '4');
      const button = element.querySelector('[data-cad-grading-group-transition-add]') as HTMLButtonElement;
      expect(button.textContent).toContain('Update');
      await act(async () => { button.click(); });
      expect(calls).toHaveLength(1);
      const intent = (calls[0] as { key: string; intent: TransitionPersistedIntent }).intent;
      expect(calls[0]!.key).toBe('GROUP_SET_TRANSITION');
      expect(intent.jointId).toBe('joint:0');
      expect(intent.width).toBe(4);
      expect(notices.join(' ')).toContain('updated');
    } finally {
      cleanup();
    }
  });

  it('removal targets only the named joint', async () => {
    const g = group([staged('joint:0', ['a>b', 'b>c'], 8), staged('joint:1', ['b>c', 'c>d'], 6)]);
    const calls: CadCommand[] = [];
    const { element, cleanup } = await renderPanel(
      <CadGradingGroupTransitionPanel group={g} memberSources={sources} memberCriteria={criteria} side="left" run={(command) => { calls.push(command); return true; }} onNotice={() => {}} />,
    );
    try {
      const remove = element.querySelector('[data-cad-grading-group-transition-remove="joint:0"]') as HTMLButtonElement;
      await act(async () => { remove.click(); });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ key: 'GROUP_CLEAR_TRANSITION', groupId: 'gg-h', jointId: 'joint:0' });
    } finally {
      cleanup();
    }
  });

  it('surfaces overlap from available geometry without dispatching', async () => {
    const g = group([staged('joint:0', ['a>b', 'b>c'], 30)]);
    const calls: CadCommand[] = [];
    const notices: string[] = [];
    const { element, cleanup } = await renderPanel(
      <CadGradingGroupTransitionPanel
        group={g}
        memberSources={sources}
        memberCriteria={criteria}
        side="left"
        run={(command) => { calls.push(command); return true; }}
        onNotice={(message) => { notices.push(message); }}
      />,
    );
    try {
      await setSelect(element, 'Transition joint', '1');
      await setInput(element, 'Transition width', '30');
      const button = element.querySelector('[data-cad-grading-group-transition-add]') as HTMLButtonElement;
      await act(async () => { button.click(); });
      expect(calls).toHaveLength(0);
      expect(notices.join(' ')).toMatch(/not authorized/);
    } finally {
      cleanup();
    }
  });

  it('stages a second authorized transition end to end (plural authoring)', () => {
    const first = setGroupTransition(group(), staged('joint:0', ['a>b', 'b>c'], 8));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = setGroupTransition(first.value, staged('joint:1', ['b>c', 'c>d'], 6));
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value).toMatchObject({
      transitions: [
        { jointId: 'joint:0', width: 8 },
        { jointId: 'joint:1', width: 6 },
      ],
    });
    // Same-joint re-stage replaces: still two records, never a duplicate.
    const edit = setGroupTransition(second.value, staged('joint:0', ['a>b', 'b>c'], 4));
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(edit.value).toMatchObject({
      transitions: [
        { jointId: 'joint:0', width: 4 },
        { jointId: 'joint:1', width: 6 },
      ],
    });
  });

  it('authorizes a sparse add at a non-adjacent joint with no order warning', async () => {
    const g = group4([staged('joint:0', ['a>b', 'b>c'], 8)]);
    const calls: CadCommand[] = [];
    const notices: string[] = [];
    const { element, cleanup } = await renderPanel(
      <CadGradingGroupTransitionPanel
        group={g}
        memberSources={sources4}
        memberCriteria={criteria4}
        side="left"
        run={(command) => { calls.push(command); return true; }}
        onNotice={(message) => { notices.push(message); }}
      />,
    );
    try {
      await setSelect(element, 'Transition joint', '2');
      await setInput(element, 'Transition width', '6');
      const button = element.querySelector('[data-cad-grading-group-transition-add]') as HTMLButtonElement;
      await act(async () => { button.click(); });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ key: 'GROUP_SET_TRANSITION', intent: { jointId: 'joint:2', width: 6 } });
      expect(notices.join(' ')).toContain('staged');
      expect(element.querySelector('[data-cad-grading-group-transition-order-warning]')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('does not warn on a sparse stored set, still warns out of order', async () => {
    const sparse = group4([staged('joint:0', ['a>b', 'b>c'], 8), staged('joint:2', ['c>d', 'd>e'], 6)]);
    const first = await renderPanel(
      <CadGradingGroupTransitionPanel group={sparse} memberSources={sources4} memberCriteria={criteria4} side="left" run={() => true} onNotice={() => {}} />,
    );
    try {
      const rows = [...first.element.querySelectorAll('[data-cad-grading-group-transition-row]')];
      expect(rows.map((row) => row.getAttribute('data-cad-grading-group-transition-row'))).toEqual(['joint:0', 'joint:2']);
      expect(first.element.querySelector('[data-cad-grading-group-transition-order-warning]')).toBeNull();
    } finally {
      first.cleanup();
    }
    const reversed = group4([staged('joint:2', ['c>d', 'd>e'], 6), staged('joint:0', ['a>b', 'b>c'], 8)]);
    const second = await renderPanel(
      <CadGradingGroupTransitionPanel group={reversed} memberSources={sources4} memberCriteria={criteria4} side="left" run={() => true} onNotice={() => {}} />,
    );
    try {
      expect(second.element.querySelector('[data-cad-grading-group-transition-order-warning]')).not.toBeNull();
    } finally {
      second.cleanup();
    }
  });

  it('refuses a touching sparse pair from true station gaps without dispatching', async () => {
    const g = group4([staged('joint:0', ['a>b', 'b>c'], 40)]);
    const calls: CadCommand[] = [];
    const notices: string[] = [];
    const { element, cleanup } = await renderPanel(
      <CadGradingGroupTransitionPanel
        group={g}
        memberSources={sources4}
        memberCriteria={criteria4}
        side="left"
        run={(command) => { calls.push(command); return true; }}
        onNotice={(message) => { notices.push(message); }}
      />,
    );
    try {
      await setSelect(element, 'Transition joint', '2');
      await setInput(element, 'Transition width', '40');
      const button = element.querySelector('[data-cad-grading-group-transition-add]') as HTMLButtonElement;
      await act(async () => { button.click(); });
      expect(calls).toHaveLength(0);
      expect(notices.join(' ')).toMatch(/touching transitions are not authorized/);
    } finally {
      cleanup();
    }
  });
});
