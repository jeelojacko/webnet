/** @vitest-environment jsdom */
/**
 * STRUCT-194.3 — drawing-file lifecycle extraction coverage.
 *
 * Drives the real production hook `useSurveyCadDrawingFileLifecycle` and the
 * real `SurveyCadWorkspace` (React + `act`) with mocked browser file I/O, so
 * every New / Open / Save / Import-adjusted branch and the exact
 * `replaceActiveDrawing` emission order are pinned without duplicating source.
 */
import React, { act, useEffect, type ChangeEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/browserFileIo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/browserFileIo')>();
  return {
    ...actual,
    saveBrowserTextFile: vi.fn(),
    readBrowserFileAsText: vi.fn(),
  };
});

vi.mock('../src/engine/cad/cadAdjustedPointsImport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/cad/cadAdjustedPointsImport')>();
  return {
    ...actual,
    importAdjustedPointsIntoCadDrawing: vi.fn(actual.importAdjustedPointsIntoCadDrawing),
  };
});

import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';
import {
  useSurveyCadDrawingFileLifecycle,
  type SurveyCadDrawingFileLifecycle,
  type SurveyCadDrawingFileLifecycleArgs,
} from '../src/hooks/surveyCad/useSurveyCadDrawingFileLifecycle';
import {
  buildCadDrawingFileName,
  createBlankCadDrawingDocument,
  MAX_CAD_DRAWING_TEXT_BYTES,
  serializeCadDrawingFile,
} from '../src/engine/cad/cadDrawingFile';
import { readBrowserFileAsText, saveBrowserTextFile } from '../src/engine/browserFileIo';
import { importAdjustedPointsIntoCadDrawing } from '../src/engine/cad/cadAdjustedPointsImport';
import { importSnapshotIntoCadDrawing } from '../src/cad-app/cadSnapshotImport';
import { buildAdjustmentSourceSnapshot, type AdjustmentSourceSnapshot } from '../src/cad-app/cadSourceBridge';
import type { CadDrawingLifecycleEvent } from '../src/cad-app/cadAppTypes';
import type { CadDrawingDocument, SurveyCadPersistedState } from '../src/engine/cad/cadTypes';
import type { ResultDependencyIdentity, AppliedRunIdentity } from '../src/engine/resultIntegrity';
import type { AdjustmentResult } from '../src/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDENTITY: ResultDependencyIdentity = {
  inputFingerprint: 'input-a',
  mathFingerprint: 'math-a',
  exclusionFingerprint: 'excl-a',
};

const APPLIED_IDENTITY: AppliedRunIdentity = { ...IDENTITY, runMode: 'adjustment' };

const makeSnapshot = (): AdjustmentSourceSnapshot =>
  buildAdjustmentSourceSnapshot({
    projectId: 'proj-a',
    projectName: 'Project A',
    runMode: 'adjustment',
    appliedRunIdentity: APPLIED_IDENTITY,
    resultFingerprint: 'fp-a',
    generatedAt: '2026-09-17T00:00:00.000Z',
    units: 'm',
    crsId: null,
    crsLabel: null,
    stations: { A: { x: 0, y: 0, h: 0, fixed: true }, B: { x: 100, y: 0, h: 0, fixed: false } },
  });

const fakeResult = (): AdjustmentResult => ({ stations: {} } as unknown as AdjustmentResult);

// ---------------------------------------------------------------------------
// Hook-level harness (real production hook)
// ---------------------------------------------------------------------------

type Holder = { current: SurveyCadDrawingFileLifecycle | null };

const Harness: React.FC<SurveyCadDrawingFileLifecycleArgs & { onApi: (_api: SurveyCadDrawingFileLifecycle) => void }> = ({
  onApi,
  ...args
}) => {
  const api = useSurveyCadDrawingFileLifecycle(args);
  useEffect(() => {
    onApi(api);
  }, [onApi, api]);
  return null;
};

const makeArgs = (
  overrides: Partial<SurveyCadDrawingFileLifecycleArgs> = {},
): SurveyCadDrawingFileLifecycleArgs => ({
  activeDrawing: createBlankCadDrawingDocument({ name: 'Base', units: 'm' }),
  emitDrawingChange: vi.fn(),
  replaceCadProject: vi.fn(),
  units: 'm',
  onDrawingLifecycle: vi.fn(),
  adjustmentSnapshot: null,
  result: null,
  canFeedDraftingFromResult: false,
  resultDependencyIdentity: null,
  setFileStatusText: vi.fn(),
  ...overrides,
});

const mountHook = async (
  args: SurveyCadDrawingFileLifecycleArgs,
): Promise<{ api: () => SurveyCadDrawingFileLifecycle; unmount: () => Promise<void> }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const holder: Holder = { current: null };
  await act(async () => {
    root.render(<Harness onApi={(api) => { holder.current = api; }} {...args} />);
  });
  return {
    api: () => {
      if (!holder.current) throw new Error('hook not mounted');
      return holder.current;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

const changeEventFor = (file: File): { event: ChangeEvent<HTMLInputElement>; input: HTMLInputElement } => {
  const input = document.createElement('input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  Object.defineProperty(input, 'value', { value: 'picked', writable: true, configurable: true });
  return { event: { target: input } as unknown as ChangeEvent<HTMLInputElement>, input };
};

beforeEach(() => {
  vi.mocked(saveBrowserTextFile).mockReset();
  vi.mocked(readBrowserFileAsText).mockReset();
  vi.mocked(importAdjustedPointsIntoCadDrawing).mockClear();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useSurveyCadDrawingFileLifecycle — New / Save / Open', () => {
  it('replaceActiveDrawing emits drawing -> project -> status in that exact order', async () => {
    const order: string[] = [];
    const args = makeArgs({
      emitDrawingChange: vi.fn(() => { order.push('emit'); }),
      replaceCadProject: vi.fn(() => { order.push('project'); }),
      setFileStatusText: vi.fn(() => { order.push('status'); }),
    });
    const { api, unmount } = await mountHook(args);
    const next = createBlankCadDrawingDocument({ name: 'Next', units: 'm' });
    await act(async () => {
      api().replaceActiveDrawing(next, 'Replaced.');
    });
    expect(order).toEqual(['emit', 'project', 'status']);
    expect(args.emitDrawingChange).toHaveBeenCalledWith(next);
    expect(args.replaceCadProject).toHaveBeenCalledWith(next.project, 'Replaced.');
    expect(args.setFileStatusText).toHaveBeenCalledWith('Replaced.');
    await unmount();
  });

  it('New creates a blank drawing in the current units and emits cad-created', async () => {
    for (const units of ['m', 'ft'] as const) {
      const args = makeArgs({ units });
      const { api, unmount } = await mountHook(args);
      await act(async () => {
        api().handleNewDrawing();
      });
      const drawn = vi.mocked(args.emitDrawingChange).mock.calls[0]?.[0] as CadDrawingDocument;
      expect(drawn.units).toBe(units);
      expect(drawn.project.entities).toEqual([]);
      expect(args.replaceCadProject).toHaveBeenCalledWith(drawn.project, 'New CAD drawing created.');
      expect(args.setFileStatusText).toHaveBeenCalledWith('New CAD drawing created.');
      expect(args.onDrawingLifecycle).toHaveBeenCalledWith('cad-created', null);
      await unmount();
    }
  });

  it('Save writes the serialized drawing with the CAD file types and reports success once', async () => {
    const active = createBlankCadDrawingDocument({ name: 'Saved Drawing', units: 'm' });
    const args = makeArgs({ activeDrawing: active });
    vi.mocked(saveBrowserTextFile).mockResolvedValueOnce(true);
    const { api, unmount } = await mountHook(args);
    await act(async () => {
      await api().handleSaveDrawing();
    });
    const fileName = buildCadDrawingFileName(active.name);
    expect(saveBrowserTextFile).toHaveBeenCalledTimes(1);
    expect(saveBrowserTextFile).toHaveBeenCalledWith(
      fileName,
      serializeCadDrawingFile(active),
      [{ description: 'WebNet CAD Drawing', accept: { 'application/json': ['.wncad', '.json'] } }],
    );
    expect(args.setFileStatusText).toHaveBeenCalledWith(`Saved ${fileName}.`);
    expect(args.onDrawingLifecycle).toHaveBeenCalledWith('cad-saved', fileName);
    await unmount();
  });

  it('Save cancel (picker dismissed) leaves status and lifecycle untouched', async () => {
    const args = makeArgs();
    vi.mocked(saveBrowserTextFile).mockResolvedValueOnce(false);
    const { api, unmount } = await mountHook(args);
    await act(async () => {
      await api().handleSaveDrawing();
    });
    expect(saveBrowserTextFile).toHaveBeenCalledTimes(1);
    expect(args.setFileStatusText).not.toHaveBeenCalled();
    expect(args.onDrawingLifecycle).not.toHaveBeenCalled();
    await unmount();
  });

  it('Open parses a valid drawing, replaces it, resets the input, and emits cad-opened', async () => {
    const source = createBlankCadDrawingDocument({ name: 'Opened', units: 'm' });
    const text = serializeCadDrawingFile(source);
    const file = new File([text], 'opened.wncad', { type: 'application/json' });
    const args = makeArgs();
    vi.mocked(readBrowserFileAsText).mockResolvedValueOnce(text);
    const { api, unmount } = await mountHook(args);
    const { event, input } = changeEventFor(file);
    await act(async () => {
      await api().handleOpenDrawingChange(event);
    });
    const drawn = vi.mocked(args.emitDrawingChange).mock.calls[0]?.[0] as CadDrawingDocument;
    expect(drawn.name).toBe('Opened');
    expect(args.setFileStatusText).toHaveBeenCalledWith('Opened opened.wncad.');
    expect(args.onDrawingLifecycle).toHaveBeenCalledWith('cad-opened', 'opened.wncad');
    expect(input.value).toBe('');
    await unmount();
  });

  it('Open reports malformed JSON without replacing the drawing', async () => {
    const args = makeArgs();
    vi.mocked(readBrowserFileAsText).mockResolvedValueOnce('{ not json');
    const { api, unmount } = await mountHook(args);
    const { event } = changeEventFor(new File(['{ not json'], 'bad.wncad'));
    await act(async () => {
      await api().handleOpenDrawingChange(event);
    });
    expect(args.emitDrawingChange).not.toHaveBeenCalled();
    expect(args.setFileStatusText).toHaveBeenCalledWith('CAD drawing file is not valid JSON.');
    await unmount();
  });

  it('Open enforces the size limit before reading', async () => {
    const args = makeArgs();
    const { api, unmount } = await mountHook(args);
    const file = new File(['x'], 'big.wncad');
    Object.defineProperty(file, 'size', { value: MAX_CAD_DRAWING_TEXT_BYTES + 1 });
    const { event } = changeEventFor(file);
    await act(async () => {
      await api().handleOpenDrawingChange(event);
    });
    expect(readBrowserFileAsText).not.toHaveBeenCalled();
    expect(args.setFileStatusText).toHaveBeenCalledWith(expect.stringContaining('is too large'));
    await unmount();
  });

  it('Open surfaces a read rejection as status text', async () => {
    const args = makeArgs();
    vi.mocked(readBrowserFileAsText).mockRejectedValueOnce(new Error('read blew up'));
    const { api, unmount } = await mountHook(args);
    const { event } = changeEventFor(new File(['x'], 'x.wncad'));
    await act(async () => {
      await api().handleOpenDrawingChange(event);
    });
    expect(args.setFileStatusText).toHaveBeenCalledWith('read blew up');
    expect(args.emitDrawingChange).not.toHaveBeenCalled();
    await unmount();
  });
});

describe('useSurveyCadDrawingFileLifecycle — Import adjusted points', () => {
  it('bridge snapshot wins over the live result and imports through the snapshot seam', async () => {
    const active = createBlankCadDrawingDocument({ units: 'm' });
    const snapshot = makeSnapshot();
    const args = makeArgs({
      activeDrawing: active,
      adjustmentSnapshot: snapshot,
      result: fakeResult(),
      canFeedDraftingFromResult: true,
      resultDependencyIdentity: IDENTITY,
    });
    const { api, unmount } = await mountHook(args);
    await act(async () => {
      api().handleImportAdjustedPoints();
    });
    const expected = importSnapshotIntoCadDrawing({ document: active, snapshot });
    expect(expected.ok).toBe(true);
    // The snapshot path delegates through the shared point importer, but with
    // the snapshot's applied-run identity and derived source name — never the
    // legacy 'Current adjustment' source.
    const calls = vi.mocked(importAdjustedPointsIntoCadDrawing).mock.calls;
    expect(calls.some(([params]) => params.identity === snapshot.appliedRunIdentity)).toBe(true);
    expect(calls.some(([params]) => params.sourceName === 'Current adjustment')).toBe(false);
    expect(args.setFileStatusText).toHaveBeenCalledWith('Imported adjusted points.');
    const drawn = vi.mocked(args.emitDrawingChange).mock.calls[0]?.[0] as CadDrawingDocument;
    expect((drawn.project.entities ?? []).length).toBeGreaterThan(0);
    await unmount();
  });

  it('bridge snapshot with mismatched units fails closed with the engine message', async () => {
    const active = createBlankCadDrawingDocument({ units: 'ft' });
    const snapshot = makeSnapshot();
    const args = makeArgs({ activeDrawing: active, adjustmentSnapshot: snapshot });
    const { api, unmount } = await mountHook(args);
    await act(async () => {
      api().handleImportAdjustedPoints();
    });
    const expected = importSnapshotIntoCadDrawing({ document: active, snapshot });
    expect(expected.ok).toBe(false);
    expect(args.setFileStatusText).toHaveBeenCalledWith((expected as { message: string }).message);
    expect(args.emitDrawingChange).not.toHaveBeenCalled();
    await unmount();
  });

  it('legacy result path routes the exact identity/result/source args and imports', async () => {
    const active = createBlankCadDrawingDocument({ units: 'm' });
    const result = fakeResult();
    const nextDrawing = createBlankCadDrawingDocument({ name: 'Imported', units: 'm' });
    const args = makeArgs({
      activeDrawing: active,
      result,
      canFeedDraftingFromResult: true,
      resultDependencyIdentity: IDENTITY,
    });
    vi.mocked(importAdjustedPointsIntoCadDrawing).mockReturnValueOnce(nextDrawing);
    const { api, unmount } = await mountHook(args);
    await act(async () => {
      api().handleImportAdjustedPoints();
    });
    expect(importAdjustedPointsIntoCadDrawing).toHaveBeenCalledWith({
      document: active,
      identity: IDENTITY,
      result,
      sourceName: 'Current adjustment',
    });
    expect(args.emitDrawingChange).toHaveBeenCalledWith(nextDrawing);
    expect(args.setFileStatusText).toHaveBeenCalledWith('Imported adjusted points.');
    await unmount();
  });

  it.each([
    ['no result', { result: null, canFeedDraftingFromResult: true, resultDependencyIdentity: IDENTITY }],
    ['stale gate off', { result: fakeResult(), canFeedDraftingFromResult: false, resultDependencyIdentity: IDENTITY }],
    ['missing identity', { result: fakeResult(), canFeedDraftingFromResult: true, resultDependencyIdentity: null }],
  ])('legacy path fails closed with the exact blocked text (%s)', async (_label, overrides) => {
    const args = makeArgs(overrides);
    const { api, unmount } = await mountHook(args);
    await act(async () => {
      api().handleImportAdjustedPoints();
    });
    expect(args.setFileStatusText).toHaveBeenCalledWith(
      'Import blocked: the adjustment result is not current (stale, failed, or non-production run). Re-run the adjustment, then import again.',
    );
    expect(importAdjustedPointsIntoCadDrawing).not.toHaveBeenCalled();
    await unmount();
  });

  it('exposes hasAdjustmentSource only for a bridge snapshot or a gated live result', async () => {
    const withBridge = makeArgs({ adjustmentSnapshot: makeSnapshot() });
    const bridged = await mountHook(withBridge);
    expect(bridged.api().hasAdjustmentSource).toBe(true);
    await bridged.unmount();

    const gated = makeArgs({ result: fakeResult(), canFeedDraftingFromResult: true, resultDependencyIdentity: IDENTITY });
    const on = await mountHook(gated);
    expect(on.api().hasAdjustmentSource).toBe(true);
    await on.unmount();

    const off = await mountHook(makeArgs({ result: fakeResult(), canFeedDraftingFromResult: false, resultDependencyIdentity: IDENTITY }));
    expect(off.api().hasAdjustmentSource).toBe(false);
    await off.unmount();

    const none = await mountHook(makeArgs());
    expect(none.api().hasAdjustmentSource).toBe(false);
    await none.unmount();
  });
});

// ---------------------------------------------------------------------------
// Component-level: dedicated chrome + shellLink action channel
// ---------------------------------------------------------------------------

const mountWorkspace = async (
  props: React.ComponentProps<typeof SurveyCadWorkspace>,
): Promise<{ container: HTMLElement; root: Root }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<SurveyCadWorkspace {...props} />);
  });
  return { container, root };
};

const click = (container: HTMLElement, selector: string): void => {
  const element = container.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  element.click();
};

const statusTextOf = (container: HTMLElement): string | null =>
  container.querySelector('[data-survey-cad-file-status]')?.textContent ?? null;

const persistedFor = (name: string): SurveyCadPersistedState => {
  const drawing = createBlankCadDrawingDocument({ name, units: 'm' });
  return {
    version: 1,
    sourceSignature: 'legacy',
    project: drawing.project,
  };
};

describe('SurveyCadWorkspace — drawing file chrome and shell actions', () => {
  it('New Drawing parity: controlled and legacy persisted hosts show the same status', async () => {
    const lifecycleControlled = vi.fn<(_e: CadDrawingLifecycleEvent, _f: string | null) => void>();
    const onDrawingChange = vi.fn();
    const controlled = await mountWorkspace({
      units: 'm',
      result: null,
      drawing: createBlankCadDrawingDocument({ name: 'Controlled', units: 'm' }),
      onDrawingChange,
      onDrawingLifecycle: lifecycleControlled,
    });
    await act(async () => {
      click(controlled.container, '[data-survey-cad-new-drawing]');
    });
    expect(onDrawingChange).toHaveBeenCalled();
    expect(lifecycleControlled).toHaveBeenCalledWith('cad-created', null);
    const controlledStatus = statusTextOf(controlled.container);
    await act(async () => {
      controlled.root.unmount();
    });

    const lifecycleLegacy = vi.fn<(_e: CadDrawingLifecycleEvent, _f: string | null) => void>();
    let legacyState: SurveyCadPersistedState | null = persistedFor('Legacy');
    const legacy = await mountWorkspace({
      units: 'm',
      result: null,
      persistedState: legacyState,
      onPersistedStateChange: (update) => {
        legacyState = typeof update === 'function' ? update(legacyState) : update;
      },
      onDrawingLifecycle: lifecycleLegacy,
    });
    await act(async () => {
      click(legacy.container, '[data-survey-cad-new-drawing]');
    });
    expect(legacyState).not.toBeNull();
    expect(lifecycleLegacy).toHaveBeenCalledWith('cad-created', null);
    expect(statusTextOf(legacy.container)).toBe(controlledStatus);
    expect(controlledStatus).toBe('New CAD drawing created.');
    await act(async () => {
      legacy.root.unmount();
    });
  });

  it('Save Drawing button writes bytes and shows the saved status once', async () => {
    vi.mocked(saveBrowserTextFile).mockResolvedValueOnce(true);
    const lifecycle = vi.fn();
    const drawing = createBlankCadDrawingDocument({ name: 'Save Me', units: 'm' });
    const { container, root } = await mountWorkspace({
      units: 'm',
      result: null,
      drawing,
      onDrawingChange: vi.fn(),
      onDrawingLifecycle: lifecycle,
    });
    await act(async () => {
      click(container, '[data-survey-cad-save-drawing]');
    });
    const fileName = buildCadDrawingFileName(drawing.name);
    expect(saveBrowserTextFile).toHaveBeenCalledTimes(1);
    expect(lifecycle).toHaveBeenCalledWith('cad-saved', fileName);
    expect(statusTextOf(container)).toBe(`Saved ${fileName}.`);
    await act(async () => {
      root.unmount();
    });
  });

  it('shellLink actions route newDrawing/saveDrawing and openDrawingFile clicks the shared input', async () => {
    vi.mocked(saveBrowserTextFile).mockResolvedValueOnce(true);
    const link = createCadShellLink();
    const onDrawingChange = vi.fn();
    const drawing = createBlankCadDrawingDocument({ name: 'Shell', units: 'm' });
    const { root } = await mountWorkspace({
      units: 'm',
      result: null,
      drawing,
      onDrawingChange,
      shellLink: link,
      shellChrome: true,
    });
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => {
      link.actions?.newDrawing();
    });
    expect(onDrawingChange).toHaveBeenCalled();
    await act(async () => {
      link.actions?.saveDrawing();
    });
    expect(saveBrowserTextFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      link.actions?.openDrawingFile();
    });
    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it('StrictMode mount/unmount keeps the shell action channel usable', async () => {
    const link = createCadShellLink();
    const onDrawingChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <React.StrictMode>
          <SurveyCadWorkspace
            units="m"
            result={null}
            drawing={createBlankCadDrawingDocument({ name: 'Strict', units: 'm' })}
            onDrawingChange={onDrawingChange}
            shellLink={link}
            shellChrome
          />
        </React.StrictMode>,
      );
    });
    expect(link.actions).not.toBeNull();
    await act(async () => {
      link.actions?.newDrawing();
    });
    expect(onDrawingChange).toHaveBeenCalled();
    await act(async () => {
      root.unmount();
    });
    expect(link.actions).toBeNull();
    container.remove();
  });
});
