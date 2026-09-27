/** @vitest-environment jsdom */

/**
 * Phase 20A — feature-line shell registry + bounded ribbon subgroup +
 * Toolspace node. Every command dispatches an undoable engine command through
 * `actions.runFeatureLineCommand`; buttons render disabled without a live
 * workspace/selection (never fake success).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import {
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import { CadFeatureLineRibbonGroup } from '../src/cad-app/shell/CadFeatureLineRibbonGroup';
import { CadRibbon } from '../src/cad-app/shell/CadRibbon';
import { FeatureLinesNode } from '../src/cad-app/shell/CadFeatureLineToolspace';
import { buildCadFeatureLineSnapshot } from '../src/cad-app/shell/cadFeatureLineSnapshot';
import { appendCadProjectEntities } from '../src/engine/cad/cadProjectState';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadCommand } from '../src/engine/cad/cadTransactions.types';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import type { CadFeatureLineEntity } from '../src/engine/cad/cadTypes';

const FEATURE_LINE_KEYS = [
  'FEATURELINECREATE',
  'FLSETZ',
  'FLGRADE',
  'FLRAISELOWER',
  'FLINTERPOLATE',
  'FLSURFACEELEV',
  'FLINQUIRY',
  'SURFACE_ADDFEATURELINEBREAKLINE',
] as const;

const featureLine: CadFeatureLineEntity = {
  id: 'fl-ui',
  type: 'feature-line',
  layerId: 'general',
  visible: true,
  locked: false,
  name: 'Feature Line 1',
  vertices: [
    { id: 'fl-ui-v0', x: 0, y: 0, z: 10 },
    { id: 'fl-ui-v1', x: 100, y: 0, z: 12 },
  ],
};

const baseSnapshot = (overrides: Partial<CadWorkspaceSnapshot> = {}): CadWorkspaceSnapshot =>
  ({
    drawingId: 'd1',
    drawingName: 'Test',
    units: 'm',
    entityCount: 1,
    selectionCount: 0,
    selectedEntityIds: [],
    selectionPreview: [],
    layers: [],
    layerEntityCounts: {},
    currentLayerId: 'general',
    lineTypes: [],
    sheets: [],
    properties: null,
    activeCommandKey: null,
    commandPrompt: 'Idle',
    commandInputValue: '',
    canUndo: false,
    canRedo: false,
    historyDepth: 0,
    redoDepth: 0,
    snapPreferences: {},
    snapStatusText: 'OSNAP off',
    stationCount: 0,
    dependencyStatus: 'MANUAL_ONLY',
    availableCommands: [],
    ...overrides,
  }) as CadWorkspaceSnapshot;

const flSelection = baseSnapshot({
  selectionCount: 1,
  selectedEntityIds: ['fl-ui'],
  selectionPreview: [{ id: 'fl-ui', type: 'feature-line', label: 'Feature Line 1' }],
});

const shellActions = (overrides: Partial<CadShellActions> = {}): CadShellActions =>
  ({ runFeatureLineCommand: () => true, ...overrides }) as unknown as CadShellActions;

describe('Phase 20A feature-line shell registry', () => {
  it('registers every feature-line command under Design and resolves aliases', () => {
    for (const key of FEATURE_LINE_KEYS) {
      const def = CAD_SHELL_COMMANDS.find((entry) => entry.key === key);
      expect(def, key).toBeDefined();
      expect(def?.category).toBe('Design');
      expect(resolveShellCommandText(key)?.key).toBe(key);
    }
    expect(resolveShellCommandText('FL')?.key).toBe('FEATURELINECREATE');
    expect(resolveShellCommandText('featurelineelev')?.key).toBe('FLSETZ');
    expect(resolveShellCommandText('FLINQ')?.key).toBe('FLINQUIRY');
  });

  it('gates availability on selection and a feature-line pick', () => {
    const create = CAD_SHELL_COMMANDS.find((entry) => entry.key === 'FEATURELINECREATE')!;
    const grade = CAD_SHELL_COMMANDS.find((entry) => entry.key === 'FLGRADE')!;
    expect(isShellCommandAvailable(create, baseSnapshot(), shellActions())).toBe(false);
    expect(isShellCommandAvailable(grade, baseSnapshot(), shellActions())).toBe(false);
    expect(isShellCommandAvailable(create, flSelection, shellActions())).toBe(true);
    expect(isShellCommandAvailable(grade, flSelection, shellActions())).toBe(true);
  });

  it('dispatches prompt-driven commands through runFeatureLineCommand', () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('2.5');
    try {
      const run = vi.fn((_command: CadCommand) => true);
      const grade = CAD_SHELL_COMMANDS.find((entry) => entry.key === 'FLGRADE')!;
      const raise = CAD_SHELL_COMMANDS.find((entry) => entry.key === 'FLRAISELOWER')!;
      const inquiry = CAD_SHELL_COMMANDS.find((entry) => entry.key === 'FLINQUIRY')!;
      expect(executeShellCommand(grade, shellActions({ runFeatureLineCommand: run }), flSelection)).toBe(true);
      expect(run).toHaveBeenCalledWith({ key: 'FLGRADE', entityId: 'fl-ui', gradePercent: 2.5 });
      expect(executeShellCommand(raise, shellActions({ runFeatureLineCommand: run }), flSelection)).toBe(true);
      expect(run).toHaveBeenCalledWith({ key: 'FLRAISELOWER', entityId: 'fl-ui', deltaZ: 2.5 });
      expect(executeShellCommand(inquiry, shellActions({ runFeatureLineCommand: run }), flSelection)).toBe(true);
      expect(run).toHaveBeenCalledWith({ key: 'FLINQUIRY', entityId: 'fl-ui' });
      // Cancelled prompt fails closed (no dispatch).
      prompt.mockReturnValueOnce(null);
      const before = run.mock.calls.length;
      expect(executeShellCommand(grade, shellActions({ runFeatureLineCommand: run }), flSelection)).toBe(false);
      expect(run.mock.calls.length).toBe(before);
    } finally {
      prompt.mockRestore();
    }
  });

  it('creates from survey points or a chain snapshot with a constant elevation', () => {
    const prompt = vi.spyOn(window, 'prompt').mockReturnValue('7');
    try {
      const run = vi.fn((_command: CadCommand) => true);
      const create = CAD_SHELL_COMMANDS.find((entry) => entry.key === 'FEATURELINECREATE')!;
      const pointSelection = baseSnapshot({
        selectionCount: 2,
        selectedEntityIds: ['pt-1', 'pt-2'],
        selectionPreview: [
          { id: 'pt-1', type: 'survey-point', label: 'A' },
          { id: 'pt-2', type: 'survey-point', label: 'B' },
        ],
      });
      expect(executeShellCommand(create, shellActions({ runFeatureLineCommand: run }), pointSelection)).toBe(true);
      expect(run).toHaveBeenCalledWith({
        key: 'FEATURELINE',
        sourceEntityIds: ['pt-1', 'pt-2'],
        sourceKind: 'survey-points',
        elevation: { method: 'constant', z: 7 },
      });
      const mixed = baseSnapshot({
        selectionCount: 2,
        selectionPreview: [
          { id: 'line-1', type: 'line', label: 'L1' },
          { id: 'fl-ui', type: 'feature-line', label: 'FL' },
        ],
      });
      expect(executeShellCommand(create, shellActions({ runFeatureLineCommand: run }), mixed)).toBe(false);
    } finally {
      prompt.mockRestore();
    }
  });
});

describe('Phase 20A bounded Feature Line ribbon subgroup', () => {
  it('renders the bounded buttons and stays disabled without a pick', async () => {
    const run = vi.fn(() => true);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <CadFeatureLineRibbonGroup snapshot={flSelection} actions={shellActions({ runFeatureLineCommand: run })} />,
      );
    });
    for (const key of FEATURE_LINE_KEYS) {
      expect(container.querySelector(`[data-cad-feature-line="${key}"]`), key).not.toBeNull();
    }
    expect(container.textContent).toContain('Set Vertices from Surface');
    await act(async () => {
      (container.querySelector('[data-cad-feature-line="FLINQUIRY"]') as HTMLButtonElement).click();
    });
    expect(run).toHaveBeenCalledWith({ key: 'FLINQUIRY', entityId: 'fl-ui' });

    await act(async () => {
      root.render(
        <CadFeatureLineRibbonGroup snapshot={baseSnapshot()} actions={shellActions({ runFeatureLineCommand: run })} />,
      );
    });
    expect((container.querySelector('[data-cad-feature-line="FLINQUIRY"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('renders on the Home ribbon and hides without a wired action', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(
        <CadRibbon
          snapshot={flSelection}
          actions={shellActions()}
          collapsed={false}
          onToggleCollapsed={() => {}}
        />,
      );
    });
    expect(container.querySelectorAll('[data-cad-feature-line="FLGRADE"]')).toHaveLength(1);
    // Design-category commands never leak into the generic group loop.
    for (const key of FEATURE_LINE_KEYS) {
      expect(container.querySelectorAll(`[data-cad-command="${key}"]`)).toHaveLength(0);
    }
    await act(async () => {
      root.render(
        <CadRibbon
          snapshot={flSelection}
          actions={shellActions({ runFeatureLineCommand: undefined })}
          collapsed={false}
          onToggleCollapsed={() => {}}
        />,
      );
    });
    expect(container.querySelectorAll('[data-cad-feature-line="FLGRADE"]')).toHaveLength(0);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

describe('Phase 20A Toolspace Feature Lines node', () => {
  it('renders name/verts/plan/Z rows and expands the selected course list', async () => {
    const drawing = createBlankCadDrawingDocument({ name: 'Toolspace', units: 'm' });
    const project = appendCadProjectEntities(drawing.project, [featureLine]);
    const snapshot = baseSnapshot({
      featureLine: buildCadFeatureLineSnapshot(project, ['fl-ui']),
      selectedEntityIds: ['fl-ui'],
      selectionPreview: [{ id: 'fl-ui', type: 'feature-line', label: 'Feature Line 1' }],
    });
    const selectEntities = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    await act(async () => {
      root.render(<FeatureLinesNode snapshot={snapshot} actions={shellActions({ selectEntities })} />);
    });
    expect(container.textContent).toContain('Feature Lines (1)');
    expect(container.textContent).toContain('Feature Line 1');
    expect(container.querySelector('[data-cad-feature-line-summary="fl-ui"]')?.textContent).toContain('2 verts');
    expect(container.querySelector('[data-cad-feature-line-course="0"]')).not.toBeNull();
    await act(async () => {
      (container.querySelector('[data-cad-feature-line-summary="fl-ui"]')?.previousElementSibling as HTMLButtonElement).click();
    });
    expect(selectEntities).toHaveBeenCalledWith(['fl-ui']);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
