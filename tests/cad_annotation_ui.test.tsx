/** @vitest-environment jsdom */

/**
 * Phase 18O annotation UI contracts (agent-tier fast, jsdom render only).
 * Renders the Annotate manager with a stub snapshot and the Properties
 * blocks for each annotation kind; asserts the op seam is called with the
 * narrow typed payload and that referenced-delete stays blocked.
 */
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import type {
  CadAnnotationSelectionInfo,
  CadAnnotationSnapshot,
  CadAnnotationUiOp,
} from '../src/cad-app/annotation/cadAnnotationUiTypes';
import { CadAnnotateRibbonGroups } from '../src/cad-app/annotation/CadAnnotateRibbonGroups';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import { CadAnnotationManager } from '../src/cad-app/annotation/CadAnnotationManager';
import { CadAnnotationProperties } from '../src/cad-app/annotation/CadAnnotationProperties';
import type { CadLayer } from '../src/engine/cad/cadTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const render = async (ui: React.ReactElement): Promise<{ element: HTMLElement; cleanup: () => void }> => {
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

const click = async (element: Element | null): Promise<void> => {
  await act(async () => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const setInputValue = (input: HTMLInputElement, value: string): void => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const commitInput = async (input: HTMLInputElement, value: string): Promise<void> => {
  await act(async () => {
    setInputValue(input, value);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
};

const arrow = { id: 'arrow-closed', name: 'Closed Arrow' };

const snapshot = (overrides: Partial<CadAnnotationSnapshot> = {}): CadAnnotationSnapshot => ({
  annotationScaleDenominator: 500,
  textStyles: [
    {
      id: 's1', name: 'Standard-Model', fontFamily: 'Arial', fontSize: 2.5,
      heightMode: 'model', modelHeight: 2.5, widthFactor: 1, lineSpacingFactor: 1,
    },
    { id: 's2', name: 'Paper-2.5mm', fontFamily: 'Arial', fontSize: 2.5, heightMode: 'paper', paperHeightMm: 2.5 },
  ],
  dimensionStyles: [
    {
      id: 'd1', name: 'Standard-500', textStyleId: 's1', arrowBlockDefinitionId: 'arrow-closed',
      arrowSize: 2.5, textGap: 1, extensionOffset: 1, extensionOvershoot: 1, decimalPrecision: 3,
    },
  ],
  leaderStyles: [
    { id: 'l1', name: 'Standard-Leader', textStyleId: 's1', arrowBlockDefinitionId: 'arrow-closed', arrowSize: 2.5, landingLength: 5, textGap: 1 },
  ],
  bearingLabelStyles: [
    { id: 'b1', name: 'Bearing-Default', textStyleId: 's1', content: 'bearing-distance', separator: 'newline', offset: { x: 0, y: 0 }, decimalPrecision: 3 },
  ],
  curveLabelStyles: [
    { id: 'c1', name: 'Curve-Default', textStyleId: 's1', fields: ['radius', 'delta'], offset: { x: 0, y: 0 }, decimalPrecision: 3 },
  ],
  referenceCounts: {
    textStyles: { s1: 2, s2: 0 },
    dimensionStyles: { d1: 1 },
    leaderStyles: {},
    bearingLabelStyles: {},
    curveLabelStyles: {},
  },
  arrowDefinitions: [arrow],
  selected: [],
  ...overrides,
});

const layers: CadLayer[] = [
  { id: 'general', name: 'General', color: '#ffffff', visible: true, locked: false, printable: true, role: 'labels' },
  { id: 'ann', name: 'Annotation', color: '#00ffff', visible: true, locked: false, printable: true, role: 'labels' },
];

describe('18o annotation manager UI', () => {
  it('lists text styles, blocks referenced delete, and dispatches create/scale ops', async () => {
    const runOp = vi.fn((_op: CadAnnotationUiOp) => ({ applied: true }));
    const { element, cleanup } = await render(
      <CadAnnotationManager annotation={snapshot()} runOp={runOp} onClose={() => {}} />,
    );
    try {
      const table = element.querySelector('[data-cad-text-style-table]');
      expect(table?.querySelectorAll('tbody tr')).toHaveLength(2);
      const referencedRow = element.querySelector('[data-cad-text-style="s1"]');
      expect(referencedRow?.querySelector('button:nth-of-type(2)')?.hasAttribute('disabled')).toBe(true);
      const freeRow = element.querySelector('[data-cad-text-style="s2"]');
      expect(freeRow?.querySelector('button:nth-of-type(2)')?.hasAttribute('disabled')).toBe(false);

      const newName = element.querySelector('input[aria-label="New text style name"]') as HTMLInputElement;
      await commitInput(newName, 'QA Style');
      const newButton = [...element.querySelectorAll('button')].find((button) => button.textContent === 'New');
      await click(newButton ?? null);
      expect(runOp).toHaveBeenCalledWith(expect.objectContaining({ kind: 'text-style-create', name: 'QA Style' }));

      const scale = element.querySelector('input[aria-label="Annotation scale denominator"]') as HTMLInputElement;
      await commitInput(scale, '1000');
      expect(runOp).toHaveBeenCalledWith({ kind: 'annotation-scale', scaleDenominator: 1000 });

      await click(element.querySelector('[data-cad-annotation-tab="dimension"]'));
      expect(element.querySelectorAll('[data-cad-dimension-style-table] tbody tr')).toHaveLength(1);
      expect(element.querySelector('[data-cad-annotation-preview^="dimension-"]')).not.toBeNull();
      await click(element.querySelector('[data-cad-annotation-tab="curve-label"]'));
      expect(element.querySelectorAll('[data-cad-curve-label-style-table] tbody tr')).toHaveLength(1);
    } finally {
      cleanup();
    }
  });
});

describe('18o annotate ribbon groups', () => {
  it('renders TEXT/LEADERS/DIMENSIONS/SURVEY LABELS/STYLES and gates on availableCommands', async () => {
    const unavailable = await render(<CadAnnotateRibbonGroups snapshot={null} actions={null} />);
    try {
      for (const label of ['Text', 'Leaders', 'Dimensions', 'Survey Labels', 'Styles']) {
        expect(unavailable.element.querySelector(`.cad-shell-ribbon-group[aria-label="${label}"]`)).not.toBeNull();
      }
      expect(unavailable.element.querySelector('[data-cad-annotation-command="MTEXT"]')?.hasAttribute('disabled')).toBe(true);
    } finally {
      unavailable.cleanup();
    }

    const available = await render(
      <CadAnnotateRibbonGroups
        snapshot={{ availableCommands: ['MTEXT', 'LEADER', 'BDLABEL'] } as unknown as CadWorkspaceSnapshot}
        actions={{ startCommand: () => false } as unknown as CadShellActions}
      />,
    );
    try {
      expect(available.element.querySelector('[data-cad-annotation-command="MTEXT"]')?.hasAttribute('disabled')).toBe(false);
      expect(available.element.querySelector('[data-cad-annotation-command="CURVELABEL"]')?.hasAttribute('disabled')).toBe(true);
    } finally {
      available.cleanup();
    }
  });
});

const mtextInfo: CadAnnotationSelectionInfo = {
  kind: 'mtext', entityId: 'e1', layerId: 'ann', layerName: 'Annotation', text: 'HELLO', textStyleId: 's1',
  x: 10, y: 20, rotationDeg: 15, attachment: 'middle-left',
};

const leaderInfo: CadAnnotationSelectionInfo = {
  kind: 'leader', entityId: 'e2', layerId: 'ann', layerName: 'Annotation', text: 'NOTE', leaderStyleId: 'l1',
  textStyleId: 's1', targetStatus: 'broken', targetLabel: 'Line A', vertices: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
};

const dimensionInfo: CadAnnotationSelectionInfo = {
  kind: 'dimension', entityId: 'e3', layerId: 'ann', layerName: 'Annotation', dimensionKind: 'linear',
  dimensionStyleId: 'd1', measuredText: '12.345', displayedText: '12.345', textOverride: null,
  placement: 'horizontal @ 0,0', sourceText: 'Line A endpoints', broken: false,
};

const bearingInfo: CadAnnotationSelectionInfo = {
  kind: 'bearing-label', entityId: 'e4', layerId: 'ann', layerName: 'Annotation', labelStyleId: 'b1',
  sourceEntityId: 'line1', sourceLabel: 'Line A', statusText: 'Attached', derived: [{ label: 'Bearing', value: 'N 45° E' }],
  offset: { x: 0, y: 0 }, manualTextOverride: null, broken: false,
};

describe('18o annotation properties', () => {
  const renderProps = async (info: CadAnnotationSelectionInfo) => {
    const runOp = vi.fn((_op: CadAnnotationUiOp) => ({ applied: true }));
    const view = await render(
      <CadAnnotationProperties info={info} annotation={snapshot()} layers={layers} runOp={runOp} />,
    );
    return { ...view, runOp };
  };

  it('MText edits text/style/rotation/attachment and keeps insertion read-only', async () => {
    const { element, runOp, cleanup } = await renderProps(mtextInfo);
    try {
      expect(element.querySelector('[data-cad-annotation-properties="mtext"]')).not.toBeNull();
      await commitInput(element.querySelector('input[aria-label="Text"]') as HTMLInputElement, 'WORLD');
      expect(runOp).toHaveBeenCalledWith(expect.objectContaining({ kind: 'mtext-update', entityId: 'e1', patch: { text: 'WORLD' } }));
      await commitInput(element.querySelector('input[aria-label="Rotation"]') as HTMLInputElement, '45');
      expect(runOp).toHaveBeenCalledWith(expect.objectContaining({ patch: { rotationDeg: 45 } }));
    } finally {
      cleanup();
    }
  });

  it('Leader shows broken target and dispatches reattach/convert', async () => {
    const { element, runOp, cleanup } = await renderProps(leaderInfo);
    try {
      expect(element.querySelector('[data-cad-leader-target-status="broken"]')?.textContent).toContain('Broken');
      expect(element.textContent).toContain('2');
      await click(element.querySelector('[data-cad-leader-reattach]'));
      expect(runOp).toHaveBeenCalledWith({ kind: 'leader-reattach', entityId: 'e2' });
      await click(element.querySelector('[data-cad-leader-convert-fixed]'));
      expect(runOp).toHaveBeenCalledWith({ kind: 'leader-convert-fixed', entityId: 'e2' });
    } finally {
      cleanup();
    }
  });

  it('Dimension measurement is read-only and override writes', async () => {
    const { element, runOp, cleanup } = await renderProps(dimensionInfo);
    try {
      expect(element.querySelector('[data-cad-dimension-measured]')?.textContent).toContain('12.345');
      expect(element.querySelector('[data-cad-dimension-measured] input')).toBeNull();
      await commitInput(element.querySelector('input[aria-label="Text override"]') as HTMLInputElement, '12.35');
      expect(runOp).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'dimension-update', entityId: 'e3', patch: { textOverride: '12.35' },
      }));
    } finally {
      cleanup();
    }
  });

  it('Survey label shows derived metrics and offset/override edits', async () => {
    const { element, runOp, cleanup } = await renderProps(bearingInfo);
    try {
      expect(element.querySelector('[data-cad-label-derived="Bearing"]')?.textContent).toContain('N 45° E');
      await commitInput(element.querySelector('input[aria-label="Offset E"]') as HTMLInputElement, '3');
      expect(runOp).toHaveBeenCalledWith(expect.objectContaining({ patch: { offset: { x: 3, y: 0 } } }));
      await commitInput(element.querySelector('input[aria-label="Text override"]') as HTMLInputElement, 'CUSTOM');
      expect(runOp).toHaveBeenCalledWith(expect.objectContaining({ patch: { manualTextOverride: 'CUSTOM' } }));
    } finally {
      cleanup();
    }
  });

  it('surfaces a rejected (LOCKED) edit instead of silently applying it', async () => {
    const runOp = vi.fn(() => ({ applied: false, reason: 'LAYER_LOCKED' }));
    const { element, cleanup } = await render(
      <CadAnnotationProperties info={mtextInfo} annotation={snapshot()} layers={layers} runOp={runOp} />,
    );
    try {
      await commitInput(element.querySelector('input[aria-label="Text"]') as HTMLInputElement, 'BLOCKED');
      expect(element.querySelector('[data-cad-annotation-rejected]')?.textContent).toContain('LAYER_LOCKED');
    } finally {
      cleanup();
    }
  });
});
