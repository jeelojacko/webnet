import { describe, expect, it } from 'vitest';
import {
  autocompleteShellCommands,
  CAD_SHELL_COMMANDS,
  executeShellCommand,
  isShellCommandAvailable,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';

const stubActions = (): CadShellActions & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    startCommand: (key) => {
      calls.push(`start:${key}`);
      return true;
    },
    undo: () => void calls.push('undo'),
    redo: () => void calls.push('redo'),
    selectAll: () => void calls.push('selectAll'),
    clearSelection: () => void calls.push('clearSelection'),
    eraseSelection: () => void calls.push('eraseSelection'),
    selectEntities: (ids) => void calls.push(`select:${ids.join(',')}`),
    editField: () => {
      calls.push('edit');
      return { applied: true };
    },
    runLayerCommand: (command) => {
      calls.push(`layer-cmd:${command.key}`);
      return true;
    },
    setCurrentLayer: (id) => {
      calls.push(`current:${id}`);
      return true;
    },
    openLayerManager: () => void calls.push('layers'),
    runSurveyCommand: (command) => {
      calls.push(`survey-cmd:${command.key}`);
      return true;
    },
    selectSurface: (id) => void calls.push(`surface-select:${id}`),
    startSurfacePick: (id) => void calls.push(`surface-pick:${id}`),
    querySurfaceElevation: (id) => {
      calls.push(`surface-elev:${id}`);
      return null;
    },
    rebuildSurface: (id) => {
      calls.push(`surface-rebuild:${id}`);
      return '';
    },
    rebuildAllSurfaces: () => {
      calls.push('surface-rebuild-all');
      return '';
    },
    describeBreaklineSource: () => {
      calls.push('surface-breakline');
      return null;
    },
    describeBoundarySource: () => {
      calls.push('surface-boundary');
      return null;
    },
    openSurveyManager: (kind) => void calls.push(`survey:${kind}`),
    selectAllSurveyPoints: () => void calls.push('survey-select-all'),
    selectSurveyGroupPoints: (groupId) => void calls.push(`survey-group:${groupId}`),
    setSnapPreference: (kind) => void calls.push(`snap:${kind}`),
    newDrawing: () => void calls.push('new'),
    openDrawingFile: () => void calls.push('open'),
    saveDrawing: () => void calls.push('save'),
    toggleDraftingPanel: () => void calls.push('drafting'),
    toggleExportCenter: () => void calls.push('export'),
    cancelCommand: () => void calls.push('cancel'),
    confirmCommandInput: () => void calls.push('confirm'),
  };
};

const baseSnapshot = (overrides: Partial<CadWorkspaceSnapshot> = {}): CadWorkspaceSnapshot =>
  ({
    drawingId: 'd1',
    drawingName: 'Test',
    units: 'm',
    entityCount: 0,
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
    availableCommands: ['LINE', 'PLINE', 'MOVE', 'COPY', 'TRIM', 'EXTEND'],
    ...overrides,
  }) as CadWorkspaceSnapshot;

describe('cad shell command registry', () => {
  it('resolves the six standard aliases to existing commands', () => {
    expect(resolveShellCommandText('L')?.key).toBe('LINE');
    expect(resolveShellCommandText('l')?.key).toBe('LINE');
    expect(resolveShellCommandText('PL')?.key).toBe('PLINE');
    expect(resolveShellCommandText('M')?.key).toBe('MOVE');
    expect(resolveShellCommandText('CO')?.key).toBe('COPY');
    expect(resolveShellCommandText('TR')?.key).toBe('TRIM');
    expect(resolveShellCommandText('EX')?.key).toBe('EXTEND');
  });

  it('resolves full names case-insensitively and rejects unknown text', () => {
    expect(resolveShellCommandText('line')?.key).toBe('LINE');
    expect(resolveShellCommandText('  Trim  ')?.key).toBe('TRIM');
    expect(resolveShellCommandText('NOPE')).toBeNull();
    expect(resolveShellCommandText('')).toBeNull();
  });

  it('every alias target exists in the registry map', () => {
    const keys = new Set(CAD_SHELL_COMMANDS.map((def) => def.key));
    for (const def of CAD_SHELL_COMMANDS) {
      for (const alias of def.aliases) {
        expect(keys.has(def.key)).toBe(true);
        expect(alias).not.toBe(def.key);
      }
    }
    expect(keys.has('LINE')).toBe(true);
    expect(keys.has('PLINE')).toBe(true);
    expect(keys.has('MOVE')).toBe(true);
    expect(keys.has('COPY')).toBe(true);
    expect(keys.has('TRIM')).toBe(true);
    expect(keys.has('EXTEND')).toBe(true);
  });

  it('autocompletes by prefix across keys, labels, and aliases', () => {
    const keys = autocompleteShellCommands('L', null, 8).map((def) => def.key);
    expect(keys).toContain('LINE');
    expect(keys).toContain('PLINE');
    const aliased = autocompleteShellCommands('CO', null, 8).map((def) => def.key);
    expect(aliased).toContain('COPY');
  });

  it('autocomplete respects availability and the limit', () => {
    const available = new Set(['LINE']);
    const matches = autocompleteShellCommands('', available, 8);
    expect(matches.map((def) => def.key)).toEqual(['LINE']);
    const limited = autocompleteShellCommands('', null, 2);
    expect(limited).toHaveLength(2);
  });

  it('routes session defs to startCommand and chrome actions to methods', () => {
    const actions = stubActions();
    expect(executeShellCommand(resolveShellCommandText('L')!, actions)).toBe(true);
    expect(actions.calls).toContain('start:LINE');
    expect(executeShellCommand(resolveShellCommandText('SHELL_UNDO')!, actions)).toBe(true);
    expect(actions.calls).toContain('undo');
    expect(executeShellCommand(resolveShellCommandText('SHELL_SAVE')!, actions)).toBe(true);
    expect(actions.calls).toContain('save');
  });

  it('LAYER opens the Layer Properties Manager', () => {
    const actions = stubActions();
    expect(resolveShellCommandText('LAYER')?.key).toBe('LAYER');
    expect(resolveShellCommandText('layer')?.key).toBe('LAYER');
    expect(executeShellCommand(resolveShellCommandText('LAYER')!, actions)).toBe(true);
    expect(actions.calls).toContain('layers');
  });

  it('returns false without actions or for unknown pseudo-keys', () => {
    const actions = stubActions();
    expect(executeShellCommand(resolveShellCommandText('L')!, null)).toBe(false);
    expect(
      executeShellCommand(
        { key: 'SHELL_BOGUS', label: 'Bogus', aliases: [], category: 'File', hint: '', kind: 'action' },
        actions,
      ),
    ).toBe(false);
  });

  it('gates availability on live workspace state', () => {
    const actions = stubActions();
    const snapshot = baseSnapshot();
    const undo = resolveShellCommandText('SHELL_UNDO')!;
    const erase = resolveShellCommandText('SHELL_ERASE')!;
    expect(isShellCommandAvailable(undo, snapshot, actions)).toBe(false);
    expect(isShellCommandAvailable(erase, snapshot, actions)).toBe(false);
    expect(isShellCommandAvailable(undo, baseSnapshot({ canUndo: true }), actions)).toBe(true);
    expect(isShellCommandAvailable(erase, baseSnapshot({ selectionCount: 2 }), actions)).toBe(true);
    expect(isShellCommandAvailable(resolveShellCommandText('LINE')!, snapshot, actions)).toBe(true);
    expect(isShellCommandAvailable(resolveShellCommandText('POINT')!, snapshot, actions)).toBe(false);
    expect(isShellCommandAvailable(undo, snapshot, null)).toBe(false);
    expect(isShellCommandAvailable(undo, null, actions)).toBe(false);
  });
});
