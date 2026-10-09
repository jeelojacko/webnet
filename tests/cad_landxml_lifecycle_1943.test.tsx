/** @vitest-environment jsdom */
/**
 * STRUCT-194.3 — LandXML import lifecycle extraction coverage.
 *
 * Two layers:
 *   1. Handler-level: the real `useSurveyCadLandXmlImportLifecycle` hook driven
 *      with controlled mock setters + a fake build service — stage / select /
 *      commit / stale-payload / drawing-switch race, with no timers.
 *   2. Component-level: the real `SurveyCadWorkspace` — stage through the hidden
 *      input, review modal cancel/commit, history landing, build scheduling,
 *      diagnostics-once, and staged-state wipe on drawing switch.
 */
import React, { act, useEffect, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/engine/browserFileIo', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/engine/browserFileIo')>();
  return {
    ...actual,
    readBrowserFileAsText: vi.fn(),
  };
});

import SurveyCadWorkspace from '../src/components/SurveyCadWorkspace';
import {
  useSurveyCadLandXmlImportLifecycle,
  type SurveyCadLandXmlBuildService,
  type SurveyCadLandXmlImportLifecycle,
  type SurveyCadLandXmlImportLifecycleArgs,
  type SurveyCadLandXmlImportRunner,
} from '../src/hooks/surveyCad/useSurveyCadLandXmlImportLifecycle';
import { SurfaceBuildService } from '../src/workers/surfaceBuildService';
import { buildLandXmlImportPreview } from '../src/engine/landxmlImport';
import {
  buildLandXmlImportCommitPayload,
  createLandXmlImportReviewSelection,
} from '../src/components/landXmlImportReview/landXmlImportReview.selection';
import { readBrowserFileAsText } from '../src/engine/browserFileIo';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadDrawingDocument, CadSurface } from '../src/engine/cad/cadTypes';
import type { LandXmlCommitReport } from '../src/engine/cad/cadLandxmlCommit';
import type { LandXmlImportStagedState } from '../src/components/landXmlImportReview/landXmlImportReview.types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = readFileSync('tests/fixtures/landxml-18m-production.xml', 'utf8');
const FILE_NAME = 'landxml-18m-production.xml';
const DRAWING_ID = 'drawing-1';

const report = (overrides: Partial<LandXmlCommitReport> = {}): LandXmlCommitReport => ({
  committed: true,
  pointsAdded: 0,
  alignmentsAdded: 0,
  surfacesAdded: 0,
  duplicatesSkipped: 0,
  renamed: [],
  importedSurfaceIds: [],
  meshesBuilt: 0,
  meshErrors: [],
  excludedUnsupported: 0,
  excludedBlocked: 0,
  ...overrides,
});

const commitPayload = (drawingId: string) => {
  const preview = buildLandXmlImportPreview(XML, { fileName: FILE_NAME });
  return buildLandXmlImportCommitPayload({
    drawingId,
    fileName: FILE_NAME,
    version: '1.2',
    preview,
    selection: createLandXmlImportReviewSelection(preview),
  });
};

const changeEventFor = (file: File): ChangeEvent<HTMLInputElement> => {
  const input = document.createElement('input');
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  Object.defineProperty(input, 'value', { value: 'picked', writable: true, configurable: true });
  return { target: input } as unknown as ChangeEvent<HTMLInputElement>;
};

const makeService = () => {
  const scheduleSurfaces = vi.fn<(_surfaceIds: readonly string[]) => void>();
  return {
    service: {
      scheduleSurfaces,
      sessionDiagnostics: () => new Map<string, { error: string }>(),
      buildingSurfaceIds: () => new Set<string>(),
    } satisfies SurveyCadLandXmlBuildService,
    scheduleSurfaces,
  };
};

// ---------------------------------------------------------------------------
// Layer 1 — handler-level hook harness (mock setters)
// ---------------------------------------------------------------------------

type HandlerHost = { api: SurveyCadLandXmlImportLifecycle | null };

const HandlerHarness: React.FC<{ onApi: (_api: SurveyCadLandXmlImportLifecycle) => void } & SurveyCadLandXmlImportLifecycleArgs> = ({
  onApi,
  ...args
}) => {
  const api = useSurveyCadLandXmlImportLifecycle(args);
  useEffect(() => {
    onApi(api);
  });
  return null;
};

const makeHandlerArgs = (overrides: Partial<SurveyCadLandXmlImportLifecycleArgs> = {}) => {
  const { service, scheduleSurfaces } = makeService();
  const setStaged = vi.fn<Dispatch<SetStateAction<LandXmlImportStagedState | null>>>();
  const setPending = vi.fn<Dispatch<SetStateAction<readonly string[]>>>();
  const importedSurfaceIdsRef = { current: new Set<string>() };
  const liveId = { value: DRAWING_ID };
  const setFileStatusText = vi.fn();
  const runLandXmlImport = vi.fn<SurveyCadLandXmlImportRunner>(() => null);
  const args: SurveyCadLandXmlImportLifecycleArgs = {
    pendingImportedSurfaceIds: [],
    setStagedLandXmlImport: setStaged,
    setPendingImportedSurfaceIds: setPending,
    importedSurfaceIdsRef,
    getLiveDrawingId: () => liveId.value,
    activeDrawingId: DRAWING_ID,
    surfaceBuildService: service,
    surfaceBuildVersion: 0,
    surfaces: [],
    runLandXmlImport,
    setFileStatusText,
    ...overrides,
  };
  return { args, setStaged, setPending, importedSurfaceIdsRef, liveId, setFileStatusText, runLandXmlImport, scheduleSurfaces };
};

const mountHandler = async (
  ctx: ReturnType<typeof makeHandlerArgs>,
): Promise<{ api: () => SurveyCadLandXmlImportLifecycle; unmount: () => Promise<void> }> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const host: HandlerHost = { api: null };
  await act(async () => {
    root.render(<HandlerHarness onApi={(api) => { host.api = api; }} {...ctx.args} />);
  });
  // The drawing-switch cleanup effect fires on mount; clear those calls so
  // each test observes only its own handler / effect behavior.
  ctx.setStaged.mockClear();
  ctx.setPending.mockClear();
  ctx.setFileStatusText.mockClear();
  return {
    api: () => {
      if (!host.api) throw new Error('hook not mounted');
      return host.api;
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

beforeEach(() => {
  vi.mocked(readBrowserFileAsText).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('useSurveyCadLandXmlImportLifecycle — stage / select / commit', () => {
  it('stage awaits the read, builds the preview, and binds it to the live drawing', async () => {
    const ctx = makeHandlerArgs();
    vi.mocked(readBrowserFileAsText).mockResolvedValueOnce(XML);
    const { api, unmount } = await mountHandler(ctx);
    await act(async () => {
      await api().handleLandXmlImportChange(changeEventFor(new File(['x'], FILE_NAME)));
    });
    expect(ctx.setStaged).toHaveBeenCalledTimes(1);
    const staged = ctx.setStaged.mock.calls[0]?.[0] as LandXmlImportStagedState;
    expect(staged.drawingId).toBe(DRAWING_ID);
    expect(staged.fileName).toBe(FILE_NAME);
    expect(staged.version).toBe('1.2');
    expect(staged.preview.surfaces.length).toBeGreaterThan(0);
    expect(staged.selection.surfaceNames.length).toBeGreaterThan(0);
    expect(ctx.setFileStatusText).toHaveBeenCalledWith(`LandXML import review: ${FILE_NAME}.`);
    await unmount();
  });

  it('malformed XML clears the staged preview and surfaces the exact error', async () => {
    const ctx = makeHandlerArgs();
    vi.mocked(readBrowserFileAsText).mockResolvedValueOnce('<not-landxml/>');
    const { api, unmount } = await mountHandler(ctx);
    await act(async () => {
      await api().handleLandXmlImportChange(changeEventFor(new File(['x'], 'bad.xml')));
    });
    expect(ctx.setStaged).toHaveBeenCalledWith(null);
    const message = ctx.setFileStatusText.mock.calls.at(-1)?.[0] as string;
    expect(message).toMatch(/^LandXML import failed: /);
    await unmount();
  });

  it('an in-flight drawing switch cancels staging without binding a preview', async () => {
    const ctx = makeHandlerArgs();
    let resolveRead: (_text: string) => void = () => {};
    vi.mocked(readBrowserFileAsText).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveRead = resolve;
      }),
    );
    const { api, unmount } = await mountHandler(ctx);
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = api().handleLandXmlImportChange(changeEventFor(new File(['x'], FILE_NAME)));
    });
    // Switch the live drawing mid-read, then let the read finish.
    ctx.liveId.value = 'drawing-2';
    await act(async () => {
      resolveRead(XML);
      await pending;
    });
    expect(ctx.setStaged).not.toHaveBeenCalled();
    expect(ctx.setFileStatusText).toHaveBeenCalledWith(
      'LandXML import cancelled — the active drawing changed while reading the file.',
    );
    await unmount();
  });

  it('selection is a functional update that keeps null null and replaces otherwise', async () => {
    const ctx = makeHandlerArgs();
    const { api, unmount } = await mountHandler(ctx);
    await act(async () => {
      api().handleLandXmlSelectionChange({ includePoints: true, alignmentNames: [], surfaceNames: ['A'] });
    });
    const updater = ctx.setStaged.mock.calls[0]?.[0] as (
      _current: LandXmlImportStagedState | null,
    ) => LandXmlImportStagedState | null;
    expect(updater(null)).toBeNull();
    const current = {
      drawingId: DRAWING_ID,
      fileName: FILE_NAME,
      version: '1.2',
      preview: buildLandXmlImportPreview(XML, { fileName: FILE_NAME }),
      selection: { includePoints: false, alignmentNames: [], surfaceNames: [] },
    };
    const next = updater(current);
    expect(next?.selection).toEqual({ includePoints: true, alignmentNames: [], surfaceNames: ['A'] });
    expect(next).not.toBe(current);
    await unmount();
  });

  it('a committed import schedules only the committed surfaces, watches them, and releases staging', async () => {
    const committedReport = report({ surfacesAdded: 2, importedSurfaceIds: ['surf-1', 'surf-2'] });
    const ctx = makeHandlerArgs();
    ctx.runLandXmlImport.mockReturnValueOnce(committedReport);
    const { api, unmount } = await mountHandler(ctx);
    await act(async () => {
      api().handleLandXmlImportSelected(commitPayload(DRAWING_ID));
    });
    expect(ctx.runLandXmlImport).toHaveBeenCalledTimes(1);
    expect(ctx.setPending).toHaveBeenCalledWith(['surf-1', 'surf-2']);
    expect([...ctx.importedSurfaceIdsRef.current]).toEqual(['surf-1', 'surf-2']);
    expect(ctx.setStaged).toHaveBeenCalledWith(null);
    await unmount();
  });

  it('a rejected commit mutates nothing and still releases staging', async () => {
    const ctx = makeHandlerArgs();
    ctx.runLandXmlImport.mockReturnValueOnce(report({ committed: false, error: 'Nothing new to import.' }));
    const { api, unmount } = await mountHandler(ctx);
    await act(async () => {
      api().handleLandXmlImportSelected(commitPayload(DRAWING_ID));
    });
    expect(ctx.setPending).not.toHaveBeenCalled();
    expect(ctx.importedSurfaceIdsRef.current.size).toBe(0);
    expect(ctx.setStaged).toHaveBeenCalledWith(null);
    expect(ctx.setFileStatusText).toHaveBeenCalledWith('Nothing new to import.');
    await unmount();
  });

  it('an unavailable history seam reports Import unavailable without scheduling', async () => {
    const ctx = makeHandlerArgs();
    ctx.runLandXmlImport.mockReturnValueOnce(null);
    const { api, unmount } = await mountHandler(ctx);
    await act(async () => {
      api().handleLandXmlImportSelected(commitPayload(DRAWING_ID));
    });
    expect(ctx.setPending).not.toHaveBeenCalled();
    expect(ctx.setFileStatusText).toHaveBeenCalledWith('Import unavailable.');
    expect(ctx.setStaged).toHaveBeenCalledWith(null);
    await unmount();
  });

  it('a payload staged for a different drawing is rejected before the history seam', async () => {
    const ctx = makeHandlerArgs();
    const { api, unmount } = await mountHandler(ctx);
    await act(async () => {
      api().handleLandXmlImportSelected(commitPayload('drawing-2'));
    });
    expect(ctx.runLandXmlImport).not.toHaveBeenCalled();
    expect(ctx.setFileStatusText).toHaveBeenCalledWith(
      'Import staged for a different drawing — reopen the file.',
    );
    expect(ctx.setPending).not.toHaveBeenCalled();
    await unmount();
  });
});

// ---------------------------------------------------------------------------
// Layer 2 — effect harness (real React state) + component-level
// ---------------------------------------------------------------------------

type EffectHost = {
  staged: LandXmlImportStagedState | null;
  pending: readonly string[];
  imported: Set<string>;
  api: SurveyCadLandXmlImportLifecycle | null;
};

const EffectHarness: React.FC<{
  onUpdate: (_snapshot: EffectHost) => void;
  version: number;
  service: SurveyCadLandXmlBuildService;
  surfaces: readonly CadSurface[] | undefined;
  activeDrawingId: string;
  runLandXmlImport: SurveyCadLandXmlImportRunner;
  setFileStatusText: (_text: string) => void;
}> = ({ onUpdate, version, service, surfaces, activeDrawingId, runLandXmlImport, setFileStatusText }) => {
  const [staged, setStaged] = useState<LandXmlImportStagedState | null>(null);
  const [pending, setPending] = useState<readonly string[]>([]);
  const importedRef = useRef(new Set<string>());
  const api = useSurveyCadLandXmlImportLifecycle({
    pendingImportedSurfaceIds: pending,
    setStagedLandXmlImport: setStaged,
    setPendingImportedSurfaceIds: setPending,
    importedSurfaceIdsRef: importedRef,
    getLiveDrawingId: () => activeDrawingId,
    activeDrawingId,
    surfaceBuildService: service,
    surfaceBuildVersion: version,
    surfaces,
    runLandXmlImport,
    setFileStatusText,
  });
  useEffect(() => {
    onUpdate({ staged, pending, imported: importedRef.current, api });
  });
  return null;
};

const makeEffectHost = (): EffectHost => ({
  staged: null,
  pending: [],
  imported: new Set<string>(),
  api: null,
});

const surface = (id: string): CadSurface =>
  ({ id, name: `Surface ${id}`, styleId: 'style' } as unknown as CadSurface);

describe('useSurveyCadLandXmlImportLifecycle — follow-up effects', () => {
  it('schedules pending imports once, then reports a materialization failure exactly once', async () => {
    const host = makeEffectHost();
    const combined = makeService();
    let diagnostics = new Map<string, { error: string }>();
    const service: SurveyCadLandXmlBuildService = {
      scheduleSurfaces: combined.scheduleSurfaces,
      sessionDiagnostics: () => diagnostics,
      buildingSurfaceIds: () => new Set<string>(),
    };
    const statuses: string[] = [];
    const runLandXmlImport = vi.fn<SurveyCadLandXmlImportRunner>(() =>
      report({ surfacesAdded: 1, importedSurfaceIds: ['surf-1'] }),
    );
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = async (version: number, surfaces: readonly CadSurface[]) => {
      await act(async () => {
        root.render(
          <EffectHarness
            onUpdate={(snapshot) => Object.assign(host, snapshot)}
            version={version}
            service={service}
            surfaces={surfaces}
            activeDrawingId={DRAWING_ID}
            runLandXmlImport={runLandXmlImport}
            setFileStatusText={(text) => statuses.push(text)}
          />,
        );
      });
    };
    await render(0, []);
    await act(async () => {
      host.api?.handleLandXmlImportSelected(commitPayload(DRAWING_ID));
    });
    expect(combined.scheduleSurfaces).toHaveBeenCalledTimes(1);
    expect(combined.scheduleSurfaces).toHaveBeenCalledWith(['surf-1']);
    expect(host.imported.has('surf-1')).toBe(true);

    diagnostics = new Map([['surf-1', { error: 'worker exploded' }]]);
    await render(1, [surface('surf-1')]);
    const failure = statuses.filter((text) => text.includes('surface materialization failed'));
    expect(failure).toHaveLength(1);
    expect(failure[0]).toContain('worker exploded');
    expect(failure[0]).toContain('Surface surf-1');

    // A later version bump must not re-notify: the watched id was retired.
    await render(2, [surface('surf-1')]);
    expect(statuses.filter((text) => text.includes('surface materialization failed'))).toHaveLength(1);
    expect(host.imported.has('surf-1')).toBe(false);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('wipes staged / watched / pending state on a drawing switch', async () => {
    const host = makeEffectHost();
    const { service } = makeService();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = async (activeDrawingId: string) => {
      await act(async () => {
        root.render(
          <EffectHarness
            onUpdate={(snapshot) => Object.assign(host, snapshot)}
            version={0}
            service={service}
            surfaces={[]}
            activeDrawingId={activeDrawingId}
            runLandXmlImport={vi.fn<SurveyCadLandXmlImportRunner>(() =>
              report({ importedSurfaceIds: ['surf-1'] }),
            )}
            setFileStatusText={() => {}}
          />,
        );
      });
    };
    await render(DRAWING_ID);
    await act(async () => {
      host.api?.handleLandXmlImportSelected(commitPayload(DRAWING_ID));
    });
    expect(host.imported.has('surf-1')).toBe(true);
    await render('drawing-2');
    expect(host.staged).toBeNull();
    expect(host.imported.size).toBe(0);
    expect(host.pending).toEqual([]);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});

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

const pickFile = (input: HTMLInputElement, file: File): void => {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

const statusTextOf = (container: HTMLElement): string | null =>
  container.querySelector('[data-survey-cad-file-status]')?.textContent ?? null;

describe('SurveyCadWorkspace — LandXML review modal and scheduling', () => {
  it('stages on file pick, cancels without mutating, and leaves no modal behind', async () => {
    const scheduleSpy = vi.spyOn(SurfaceBuildService.prototype, 'scheduleSurfaces').mockImplementation(() => {});
    vi.mocked(readBrowserFileAsText).mockResolvedValue(XML);
    const { container, root } = await mountWorkspace({
      units: 'm',
      result: null,
      drawing: createBlankCadDrawingDocument({ units: 'm' }),
    });
    const input = container.querySelector<HTMLInputElement>('[data-landxml-import-input]');
    if (!input) throw new Error('missing landxml input');
    await act(async () => {
      pickFile(input, new File(['<x/>'], FILE_NAME));
    });
    expect(container.querySelector('[data-landxml-import-review]')).not.toBeNull();
    expect(statusTextOf(container)).toBe(`LandXML import review: ${FILE_NAME}.`);

    await act(async () => {
      container.querySelector<HTMLElement>('[data-landxml-import-cancel]')?.click();
    });
    expect(container.querySelector('[data-landxml-import-review]')).toBeNull();
    expect(scheduleSpy).not.toHaveBeenCalled();
    scheduleSpy.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it('commits through the modal, schedules imported surfaces once, and closes', async () => {
    const scheduleSpy = vi.spyOn(SurfaceBuildService.prototype, 'scheduleSurfaces').mockImplementation(() => {});
    vi.mocked(readBrowserFileAsText).mockResolvedValue(XML);
    const { container, root } = await mountWorkspace({
      units: 'm',
      result: null,
      drawing: createBlankCadDrawingDocument({ units: 'm' }),
    });
    const input = container.querySelector<HTMLInputElement>('[data-landxml-import-input]');
    if (!input) throw new Error('missing landxml input');
    await act(async () => {
      pickFile(input, new File(['<x/>'], FILE_NAME));
    });
    await act(async () => {
      container.querySelector<HTMLElement>('[data-landxml-import-selected]')?.click();
    });
    expect(container.querySelector('[data-landxml-import-review]')).toBeNull();
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    const scheduled = scheduleSpy.mock.calls[0]?.[0] as readonly string[];
    expect(scheduled.length).toBeGreaterThan(0);
    expect(statusTextOf(container)).toContain('building');
    scheduleSpy.mockRestore();
    await act(async () => {
      root.unmount();
    });
  });

  it('releases the staged preview when the active drawing switches', async () => {
    vi.mocked(readBrowserFileAsText).mockResolvedValue(XML);
    const props = {
      units: 'm' as const,
      result: null,
      onDrawingChange: (() => {}) as React.Dispatch<React.SetStateAction<CadDrawingDocument | null>>,
    };
    const { container, root } = await mountWorkspace({
      ...props,
      drawing: createBlankCadDrawingDocument({ name: 'A', units: 'm' }),
    });
    const input = container.querySelector<HTMLInputElement>('[data-landxml-import-input]');
    if (!input) throw new Error('missing landxml input');
    await act(async () => {
      pickFile(input, new File(['<x/>'], FILE_NAME));
    });
    expect(container.querySelector('[data-landxml-import-review]')).not.toBeNull();
    await act(async () => {
      root.render(<SurveyCadWorkspace {...props} drawing={createBlankCadDrawingDocument({ name: 'B', units: 'm' })} />);
    });
    expect(container.querySelector('[data-landxml-import-review]')).toBeNull();
    await act(async () => {
      root.unmount();
    });
  });
});
