/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest';
import {
  act,
  useRef,
  useState,
  createRoot,
  cloneAdjustedPointsExportSettings,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  useProjectFileWorkflow,
  baseSettings,
  baseParseSettings,
  cloneInstrumentLibrary,
  normalizeUiTheme,
  normalizeSolveProfile,
  buildObservationModeFromGridFields,
} from './projectFileWorkflowStateTestSupport';
import type {
  Root,
  ParseSettings,
  PersistedSavedRunSnapshot,
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from './projectFileWorkflowStateTestSupport';

describe('useProjectFileWorkflow', () => {
  it('imports multiple dat files into the current project as new source files', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const originalIndexedDb = window.indexedDB;
    const originalPrompt = window.prompt;
    const originalFileReader = globalThis.FileReader;

    const stores = {
      projectIndex: new Map<string, unknown>(),
      projectManifest: new Map<string, unknown>(),
      projectFile: new Map<string, unknown>(),
    };

    const createFakeRequest = <T,>(resolver: () => T, onComplete?: () => void): IDBRequest<T> => {
      const request: {
        result: T;
        error: DOMException | null;
        onsuccess: IDBRequest<T>['onsuccess'];
        onerror: IDBRequest<T>['onerror'];
      } = {
        result: undefined as T,
        error: null,
        onsuccess: null,
        onerror: null,
      };
      const idbRequest = request as unknown as IDBRequest<T>;
      window.setTimeout(() => {
        try {
          request.result = resolver();
          request.onsuccess?.call(idbRequest, new Event('success') as never);
          window.setTimeout(() => {
            onComplete?.();
          }, 0);
        } catch (error) {
          request.error = error as DOMException;
          request.onerror?.call(idbRequest, new Event('error') as never);
          window.setTimeout(() => {
            onComplete?.();
          }, 0);
        }
      }, 0);
      return idbRequest;
    };

    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: {
        open: vi.fn(() => {
          const request: {
            result: IDBDatabase | null;
            error: DOMException | null;
            onsuccess: IDBOpenDBRequest['onsuccess'];
            onerror: IDBOpenDBRequest['onerror'];
            onupgradeneeded: IDBOpenDBRequest['onupgradeneeded'];
          } = {
            result: null,
            error: null,
            onsuccess: null,
            onerror: null,
            onupgradeneeded: null,
          };
          const db = {
            objectStoreNames: {
              contains: () => true,
            },
            createObjectStore: () => undefined,
            close: () => undefined,
            transaction: (storeNames: string | string[]) => {
              const names = Array.isArray(storeNames) ? storeNames : [storeNames];
              const transaction = {
                oncomplete: null,
                onerror: null,
                onabort: null,
                objectStore: (name: string) => {
                  if (!names.includes(name)) {
                    throw new Error(`Unexpected store ${name}`);
                  }
                  const store =
                    name === 'projectIndex'
                      ? stores.projectIndex
                      : name === 'projectManifest'
                        ? stores.projectManifest
                        : stores.projectFile;
                  return {
                    get: (key: string) =>
                      createFakeRequest(() => store.get(key), () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                    getAll: () =>
                      createFakeRequest(() => Array.from(store.values()), () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                    put: (value: unknown) =>
                      createFakeRequest(() => {
                        if (name === 'projectIndex') {
                          const row = value as { id: string };
                          store.set(row.id, value);
                        } else if (name === 'projectManifest') {
                          const row = value as { projectId: string };
                          store.set(row.projectId, value);
                        } else {
                          const row = value as { projectId: string; fileId: string };
                          store.set(`${row.projectId}:${row.fileId}`, value);
                        }
                        return value;
                      }, () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                    delete: (key: string | string[]) =>
                      createFakeRequest(() => {
                        store.delete(Array.isArray(key) ? key.join(':') : key);
                        return undefined;
                      }, () => {
                        transaction.oncomplete?.(new Event('complete') as never);
                      }),
                  };
                },
              } as unknown as IDBTransaction;
              return transaction;
            },
          } as unknown as IDBDatabase;
          request.result = db;
          const openRequest = request as unknown as IDBOpenDBRequest;
          window.setTimeout(() => {
            request.onsuccess?.call(openRequest, new Event('success') as never);
          }, 0);
          return openRequest;
        }),
      },
    });
    window.prompt = vi.fn(() => 'Source Import Project');

    class MockFileReader {
      public result: string | null = null;
      public onload: null | (() => void) = null;
      public onerror: null | (() => void) = null;

      readAsText(file: Blob) {
        const namedFile = file as File;
        this.result = namedFile.name === 'traverse.dat' ? 'TRAVERSE' : 'CONTROL';
        this.onload?.();
      }
    }

    (globalThis as { FileReader: typeof FileReader }).FileReader =
      MockFileReader as unknown as typeof FileReader;

    const waitForText = async (selector: string, matcher: (_text: string) => boolean) => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const text = container.querySelector(selector)?.textContent ?? '';
        if (matcher(text)) return text;
        await act(async () => {
          await new Promise((resolve) => window.setTimeout(resolve, 10));
        });
      }
      return container.querySelector(selector)?.textContent ?? '';
    };

    const Harness = () => {
      const projectFileInputRef = useRef<HTMLInputElement | null>(null);
      const projectSourceFileInputRef = useRef<HTMLInputElement | null>(null);
      const [input, setInput] = useState('NETWORK');
      const [projectIncludeFiles, setProjectIncludeFiles] = useState<Record<string, string>>({});
      const [settings, setSettings] = useState(baseSettings);
      const [parseSettings, setParseSettings] = useState(baseParseSettings);
      const [_geoidSourceData, setGeoidSourceData] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabel, setGeoidSourceDataLabel] = useState('');
      const [exportFormat, setExportFormat] = useState<ProjectExportFormat>('points');
      const [adjustedPointsExportSettings, setAdjustedPointsExportSettings] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [savedRunSnapshots, setSavedRunSnapshots] = useState<PersistedSavedRunSnapshot[]>([]);
      const [projectInstruments, setProjectInstruments] = useState<InstrumentLibrary>({
        S9: { code: 'S9' } as InstrumentLibrary['S9'],
      });
      const [selectedInstrument, setSelectedInstrument] = useState('S9');
      const [levelLoopCustomPresets, setLevelLoopCustomPresets] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_settingsDraft, setSettingsDraft] = useState(baseSettings);
      const [_parseSettingsDraft, setParseSettingsDraft] = useState(baseParseSettings);
      const [_geoidSourceDataDraft, setGeoidSourceDataDraft] = useState<Uint8Array | null>(null);
      const [_geoidSourceDataLabelDraft, setGeoidSourceDataLabelDraft] = useState('');
      const [_projectInstrumentsDraft, setProjectInstrumentsDraft] = useState(projectInstruments);
      const [_selectedInstrumentDraft, setSelectedInstrumentDraft] = useState('S9');
      const [_levelLoopCustomPresetsDraft, setLevelLoopCustomPresetsDraft] = useState<
        CustomLevelLoopTolerancePreset[]
      >([]);
      const [_adjustedPointsExportSettingsDraft, setAdjustedPointsExportSettingsDraft] =
        useState<AdjustedPointsExportSettings>(() =>
          cloneAdjustedPointsExportSettings(DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS),
        );
      const [_isAdjustedPointsTransformSelectOpen, setIsAdjustedPointsTransformSelectOpen] =
        useState(false);
      const [_adjustedPointsTransformSelectedDraft, setAdjustedPointsTransformSelectedDraft] =
        useState<string[]>([]);
      const [_importNotice, setImportNotice] = useState<{
        title: string;
        detailLines: string[];
      } | null>(null);

      const {
        createLocalProjectFromCurrentWorkspace,
        importProjectSourceFiles,
        activeProjectFileViews,
        currentProjectFile,
      } = useProjectFileWorkflow({
        projectFileInputRef,
        projectSourceFileInputRef,
        input,
        projectIncludeFiles,
        settings,
        parseSettings,
        exportFormat,
        adjustedPointsExportSettings,
        savedRunSnapshots,
        projectInstruments,
        selectedInstrument,
        levelLoopCustomPresets,
        setInput,
        setProjectIncludeFiles,
        setSettings,
        setParseSettings,
        setGeoidSourceData,
        setGeoidSourceDataLabel,
        setExportFormat,
        setAdjustedPointsExportSettings,
        setProjectInstruments,
        setSelectedInstrument,
        setLevelLoopCustomPresets,
        setSettingsDraft,
        setParseSettingsDraft,
        setGeoidSourceDataDraft,
        setGeoidSourceDataLabelDraft,
        setProjectInstrumentsDraft,
        setSelectedInstrumentDraft,
        setLevelLoopCustomPresetsDraft,
        setAdjustedPointsExportSettingsDraft,
        setIsAdjustedPointsTransformSelectOpen,
        setAdjustedPointsTransformSelectedDraft,
        setImportNotice,
        resetWorkspaceAfterProjectLoad: () => undefined,
        restoreSavedRunSnapshots: setSavedRunSnapshots,
        normalizeUiTheme,
        normalizeSolveProfile,
        buildObservationModeFromGridFields,
        cloneInstrumentLibrary,
      });

      return (
        <div>
          <button type="button" id="create-project" onClick={() => void createLocalProjectFromCurrentWorkspace()}>
            create
          </button>
          <button
            type="button"
            id="import-sources"
            onClick={() =>
              void importProjectSourceFiles([
                new File(['TRAVERSE'], 'traverse.dat', { type: 'text/plain' }),
                new File(['CONTROL'], 'control.dat', { type: 'text/plain' }),
              ])
            }
          >
            import
          </button>
          <div id="file-names">{activeProjectFileViews.map((file) => file.name).join('|')}</div>
          <div id="active-file">{currentProjectFile?.name ?? '-'}</div>
          <div id="input">{input}</div>
        </div>
      );
    };

    try {
      await act(async () => {
        root.render(<Harness />);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });

      await act(async () => {
        (container.querySelector('#create-project') as HTMLButtonElement).click();
      });
      expect(await waitForText('#file-names', (text) => text.includes('main.dat'))).toContain('main.dat');

      await act(async () => {
        (container.querySelector('#import-sources') as HTMLButtonElement).click();
      });
      expect(await waitForText('#file-names', (text) => text.includes('traverse'))).toContain('traverse');

      expect(container.querySelector('#file-names')?.textContent).toContain('traverse');
      expect(container.querySelector('#file-names')?.textContent).toContain('control');
      expect(container.querySelector('#active-file')?.textContent).toBe('control');
      expect(container.querySelector('#input')?.textContent).toBe('CONTROL');
    } finally {
      await act(async () => {
        root.unmount();
      });
      container.remove();
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: originalIndexedDb,
      });
      window.prompt = originalPrompt;
      (globalThis as { FileReader: typeof FileReader }).FileReader = originalFileReader;
    }
  });

});
