/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';

import {
  act,
  cloneAdjustedPointsExportSettings,
  createRoot,
  DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
  parseSettings,
  type PreparedAssociatedProjectSettingsImport,
  type Root,
  useImportReviewWorkflow,
  vi,
} from './importReviewWorkflowStateTestSupport';

describe('useImportReviewWorkflow associated settings', () => {
  it('stages associated settings inside import review until final import', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };
    const settingsFileInputRef = { current: null as HTMLInputElement | null };
    const importGeneratedProjectSourceFile = vi.fn(async () => true);
    const preparedSettings: PreparedAssociatedProjectSettingsImport = {
      sourceName: 'sample.snproj',
      payload: {
        schemaVersion: 5,
        input: '',
        includeFiles: {},
        savedRuns: [],
        ui: {
          settings: {} as Record<string, unknown>,
          parseSettings: {} as Record<string, unknown>,
          exportFormat: 'industry-style',
          adjustedPointsExport: cloneAdjustedPointsExportSettings(
            DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
          ),
        },
        project: {
          projectInstruments: {},
          selectedInstrument: 'IMPORTED',
          levelLoopCustomPresets: [],
        },
      },
      appliedDomains: ['parse settings', 'instrument defaults'],
      ignoredDomains: ['data file list'],
    };
    const prepareAssociatedProjectSettingsImport = vi.fn(async () => preparedSettings);
    const applyPreparedAssociatedProjectSettings = vi.fn(async () => true);

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: '',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
        settingsFileInputRef,
        importGeneratedProjectSourceFile,
        prepareAssociatedProjectSettingsImport,
        applyPreparedAssociatedProjectSettings,
        parseSettings,
        projectInstruments: {},
        setInput: () => undefined,
        setProjectIncludeFiles: () => undefined,
        setImportNotice: () => undefined,
        resetWorkspaceForImportedInput: () => undefined,
      });

      return (
        <div>
          <div data-source>{state.importReviewState?.sourceName ?? '-'}</div>
          <div data-staged>{state.importReviewState?.stagedAssociatedSettings?.sourceName ?? '-'}</div>
          <button
            onClick={() =>
              state.restoreImportReviewWorkflow({
                sourceName: '260215 TRAVERSE.jxl',
                notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                sources: [
                  {
                    key: 'source:0',
                    sourceName: '260215 TRAVERSE.jxl',
                    notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                    dataset: {
                      importerId: 'jobxml',
                      formatLabel: 'JobXML',
                      summary: 'summary',
                      notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                      comments: [],
                      controlStations: [],
                      observations: [
                        {
                          kind: 'distance',
                          fromId: 'P1',
                          toId: 'P2',
                          distanceM: 12.3456,
                        },
                      ],
                      trace: [],
                    },
                    isPrimary: true,
                  },
                ],
                dataset: {
                  importerId: 'jobxml',
                  formatLabel: 'JobXML',
                  summary: 'summary',
                  notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                  comments: [],
                  controlStations: [],
                  observations: [
                    {
                      kind: 'distance',
                      fromId: 'P1',
                      toId: 'P2',
                      distanceM: 12.3456,
                    },
                  ],
                  trace: [],
                },
                reviewModel: {
                  groups: [
                    {
                      key: 'observation',
                      kind: 'setup',
                      label: 'Observation',
                      defaultComment: 'OBSERVATION',
                      itemIds: ['observation:0'],
                    },
                  ],
                  items: [
                    {
                      id: 'observation:0',
                      kind: 'observation',
                      index: 0,
                      groupKey: 'observation',
                      sourceType: 'Distance',
                      sourceObservationKind: 'distance',
                    },
                  ],
                  warnings: [],
                  errors: [],
                },
                comparisonMode: 'non-mta-only',
                excludedItemIds: [],
                fixedItemIds: [],
                groupLabels: { observation: 'Observation' },
                groupComments: { observation: 'OBSERVATION' },
                rowOverrides: {},
                rowTypeOverrides: {},
                preset: 'clean-webnet',
                importFaceNormalizationMode: 'on',
                importStyle: 'industry-style',
                stagedAssociatedSettings: null,
                force2DOutput: false,
                nextSyntheticId: 1,
                nextSourceId: 1,
                conflicts: [],
                conflictResolutions: {},
                conflictRenameValues: {},
              })
            }
          >
            restore
          </button>
          <button onClick={() => void state.handleApplyImportReviewAsNewFile()}>new-file</button>
          <button
            onClick={() =>
              void state.handleImportReviewSettingsFileChange({
                target: {
                  files: [
                    new File(['{}'], 'sample.snproj', { type: 'text/plain' }),
                  ],
                  value: 'sample.snproj',
                },
              } as never)
            }
          >
            settings
          </button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const click = async (label: string) => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (entry) => entry.textContent === label,
      ) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button ${label}`);
      await act(async () => {
        button.click();
      });
    };

    await click('restore');
    expect(container.querySelector('[data-source]')?.textContent).toBe('260215 TRAVERSE.jxl');

    await click('settings');
    expect(prepareAssociatedProjectSettingsImport).toHaveBeenCalledTimes(1);
    const importedSettingsFile = (
      prepareAssociatedProjectSettingsImport.mock.calls[0] as unknown as [File] | undefined
    )?.[0];
    expect(importedSettingsFile?.name).toBe('sample.snproj');
    expect(applyPreparedAssociatedProjectSettings).not.toHaveBeenCalled();
    expect(container.querySelector('[data-staged]')?.textContent).toBe('sample.snproj');

    await click('new-file');
    expect(importGeneratedProjectSourceFile).toHaveBeenCalledTimes(1);
    expect(importGeneratedProjectSourceFile).toHaveBeenCalledWith({
      sourceName: '260215 TRAVERSE.jxl',
      text: '.UNITS M\n.ORDER EN\n\n# OBSERVATION\nD P1 P2 12.3456\n',
    });
    expect(applyPreparedAssociatedProjectSettings).toHaveBeenCalledTimes(1);
    expect(applyPreparedAssociatedProjectSettings).toHaveBeenCalledWith(preparedSettings, {
      successTitle: 'Project source file added and settings applied',
      successDetailPrefix: ['Added imported review output to the current project workspace.'],
      failureDetailPrefix: ['Imported review output was added to the current project workspace.'],
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('restores staged associated settings from the import-review snapshot', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: '',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef: { current: null },
        parseSettings,
        projectInstruments: {},
        setInput: () => undefined,
        setProjectIncludeFiles: () => undefined,
        setImportNotice: () => undefined,
        resetWorkspaceForImportedInput: () => undefined,
      });

      return (
        <div>
          <div data-staged>{state.importReviewState?.stagedAssociatedSettings?.sourceName ?? '-'}</div>
          <button
            onClick={() =>
              state.restoreImportReviewWorkflow({
                sourceName: 'coldstream.dat',
                notice: { title: 'Imported dataset', detailLines: ['detail'] },
                sources: [],
                dataset: {
                  importerId: 'jobxml',
                  formatLabel: 'JobXML',
                  summary: 'summary',
                  notice: { title: 'Imported dataset', detailLines: ['detail'] },
                  comments: [],
                  controlStations: [],
                  observations: [],
                  trace: [],
                },
                reviewModel: { groups: [], items: [], warnings: [], errors: [] },
                comparisonMode: 'non-mta-only',
                excludedItemIds: [],
                fixedItemIds: [],
                groupLabels: {},
                groupComments: {},
                rowOverrides: {},
                rowTypeOverrides: {},
                preset: 'clean-webnet',
                importFaceNormalizationMode: 'on',
                importStyle: 'generic',
                stagedAssociatedSettings: {
                  sourceName: 'coldstream_case_settings.snproj',
                  payload: {
                    schemaVersion: 5,
                    input: '',
                    includeFiles: {},
                    savedRuns: [],
                    ui: {
                      settings: {} as Record<string, unknown>,
                      parseSettings: {} as Record<string, unknown>,
                      exportFormat: 'industry-style',
                      adjustedPointsExport: cloneAdjustedPointsExportSettings(
                        DEFAULT_ADJUSTED_POINTS_EXPORT_SETTINGS,
                      ),
                    },
                    project: {
                      projectInstruments: {},
                      selectedInstrument: 'IMPORTED',
                      levelLoopCustomPresets: [],
                    },
                  },
                  appliedDomains: ['parse settings'],
                  ignoredDomains: [],
                },
                force2DOutput: false,
                nextSyntheticId: 1,
                nextSourceId: 1,
                conflicts: [],
                conflictResolutions: {},
                conflictRenameValues: {},
              })
            }
          >
            restore
          </button>
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    await act(async () => {
      (container.querySelector('button') as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-staged]')?.textContent).toBe(
      'coldstream_case_settings.snproj',
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
