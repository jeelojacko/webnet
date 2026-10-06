import { describe, expect, it } from 'vitest';
import { CAD_SHELL_LAYOUT_STORAGE_KEY } from '../src/cad-app/shell/cadShellTypes';
import {
  DEFAULT_SHELL_LAYOUT,
  loadShellLayout,
  saveShellLayout,
} from '../src/cad-app/shell/useCadShellLayout';

const memoryStorage = (): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { clear: () => void } => {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
  };
};

describe('cad shell layout persistence', () => {
  it('loads defaults with no storage or corrupt JSON', () => {
    expect(loadShellLayout(null)).toEqual(DEFAULT_SHELL_LAYOUT);
    expect(loadShellLayout(memoryStorage())).toEqual(DEFAULT_SHELL_LAYOUT);
    const storage = memoryStorage();
    storage.setItem(CAD_SHELL_LAYOUT_STORAGE_KEY, 'not-json{');
    expect(loadShellLayout(storage)).toEqual(DEFAULT_SHELL_LAYOUT);
  });

  it('round-trips panels, sizes, and tabs without touching drawing state', () => {
    const storage = memoryStorage();
    saveShellLayout(storage, {
      ...DEFAULT_SHELL_LAYOUT,
      leftPanel: 'layers',
      rightPanel: null,
      leftWidthPx: 320,
      commandHeightPx: 200,
      commandHistoryExpanded: true,
      toolspaceTab: 'settings',
      ribbonCollapsed: true,
    });
    const loaded = loadShellLayout(storage);
    expect(loaded.leftPanel).toBe('layers');
    expect(loaded.rightPanel).toBeNull();
    expect(loaded.leftWidthPx).toBe(320);
    expect(loaded.commandHeightPx).toBe(200);
    expect(loaded.commandHistoryExpanded).toBe(true);
    expect(loaded.toolspaceTab).toBe('settings');
    expect(loaded.ribbonCollapsed).toBe(true);
    // Layout rows carry no drawing content, ids, or entities.
    expect(JSON.stringify(loaded)).not.toContain('drawingId');
    expect(JSON.stringify(loaded)).not.toContain('entities');
  });

  it('sanitizes unknown panels, tabs, and out-of-range sizes', () => {
    const storage = memoryStorage();
    storage.setItem(
      CAD_SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        leftPanel: 'xref',
        rightPanel: 'properties',
        leftWidthPx: 5000,
        rightWidthPx: 10,
        commandHeightPx: -40,
        toolspaceTab: 'blocks',
        ribbonCollapsed: 'yes',
      }),
    );
    const loaded = loadShellLayout(storage);
    expect(loaded.leftPanel).toBeNull();
    expect(loaded.rightPanel).toBe('properties');
    expect(loaded.leftWidthPx).toBeLessThanOrEqual(560);
    expect(loaded.rightWidthPx).toBeGreaterThanOrEqual(180);
    expect(loaded.commandHeightPx).toBeGreaterThanOrEqual(96);
    expect(loaded.toolspaceTab).toBe('prospector');
    expect(loaded.ribbonCollapsed).toBe(false);
  });

  it('keeps legacy layouts collapsed without discarding the expanded height', () => {
    // Old chrome stored a fixed command height and no expansion field. The
    // dock must stay collapsed (no blank reservoir) but remember the height
    // for when the operator expands the history panel.
    const storage = memoryStorage();
    storage.setItem(
      CAD_SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify({ version: 1, commandHeightPx: 200 }),
    );
    const loaded = loadShellLayout(storage);
    expect(loaded.commandHistoryExpanded).toBe(false);
    expect(loaded.commandHeightPx).toBe(200);
  });

  it('sanitizes a non-boolean history expansion flag back to collapsed', () => {
    const storage = memoryStorage();
    storage.setItem(
      CAD_SHELL_LAYOUT_STORAGE_KEY,
      JSON.stringify({ version: 1, commandHistoryExpanded: 'yes' }),
    );
    expect(loadShellLayout(storage).commandHistoryExpanded).toBe(false);
  });
});
