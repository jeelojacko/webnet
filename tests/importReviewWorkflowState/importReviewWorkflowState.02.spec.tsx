/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';

import {
  act,
  createRoot,
  parseSettings,
  type Root,
  trimmedIndustryJobXml,
  useImportReviewWorkflow,
} from './importReviewWorkflowStateTestSupport';

describe('useImportReviewWorkflow review restore and presets', () => {
  it('restores a saved import-review snapshot', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: 'C P1 100.0000 200.0000 10.0000',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
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
          <div data-sources>{state.importReviewState?.sources.length ?? 0}</div>
          <div data-conflicts>{state.importReviewState?.conflicts.length ?? 0}</div>
          <div data-compare-rows>{state.importReviewState?.comparisonSummary?.rows.length ?? 0}</div>
          <div data-resolution>{state.importReviewState?.conflictResolutions['control:0'] ?? '-'}</div>
          <div data-rename>{state.importReviewState?.conflictRenameValues['control:0'] ?? '-'}</div>
          <div data-style>{state.importReviewState?.importStyle ?? '-'}</div>
          <div data-snapshot>{state.importReviewSnapshot?.sourceName ?? '-'}</div>
          <button
            onClick={() =>
              state.restoreImportReviewWorkflow({
                sourceName: 'imported.jxl',
                notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                sources: [
                  {
                    key: 'source:0',
                    sourceName: 'imported.jxl',
                    notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                    dataset: {
                      importerId: 'jobxml',
                      formatLabel: 'JobXML',
                      summary: 'summary',
                      notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                      comments: [],
                      controlStations: [
                        {
                          kind: 'control-station',
                          coordinateMode: 'local',
                          stationId: 'P1',
                          eastM: 101,
                          northM: 201,
                          heightM: 11,
                        },
                      ],
                      observations: [
                        {
                          kind: 'distance',
                          fromId: 'P1',
                          toId: 'P2',
                          distanceM: 12.3,
                        },
                      ],
                      trace: [],
                    },
                    isPrimary: true,
                  },
                  {
                    key: 'source:1',
                    sourceName: 'imported.htm',
                    notice: { title: 'Imported Survey Report', detailLines: ['detail'] },
                    dataset: {
                      importerId: 'trimble-survey-report',
                      formatLabel: 'Survey Report',
                      summary: 'summary',
                      notice: { title: 'Imported Survey Report', detailLines: ['detail'] },
                      comments: [],
                      controlStations: [],
                      observations: [],
                      trace: [],
                    },
                    isPrimary: false,
                  },
                ],
                dataset: {
                  importerId: 'jobxml',
                  formatLabel: 'JobXML',
                  summary: 'summary',
                  notice: { title: 'Imported JobXML dataset', detailLines: ['detail'] },
                  comments: [],
                  controlStations: [
                    {
                      kind: 'control-station',
                      coordinateMode: 'local',
                      stationId: 'P1',
                      eastM: 101,
                      northM: 201,
                      heightM: 11,
                    },
                  ],
                  observations: [],
                  trace: [],
                },
                reviewModel: {
                  groups: [
                    {
                      key: 'control',
                      kind: 'control',
                      label: 'Control',
                      defaultComment: 'CONTROL',
                      itemIds: ['control:0'],
                    },
                  ],
                  items: [
                    {
                      id: 'control:0',
                      kind: 'control',
                      index: 0,
                      groupKey: 'control',
                      sourceType: 'Control Point',
                      stationId: 'P1',
                    },
                  ],
                  warnings: [],
                  errors: [],
                },
                comparisonMode: 'non-mta-only',
                excludedItemIds: [],
                fixedItemIds: [],
                groupLabels: { control: 'Control' },
                groupComments: { control: 'CONTROL' },
                rowOverrides: {},
                rowTypeOverrides: {},
                preset: 'clean-webnet',
                importFaceNormalizationMode: 'on',
                importStyle: 'industry-style',
                force2DOutput: false,
                nextSyntheticId: 1,
                nextSourceId: 2,
                conflicts: [
                  {
                    id: 'coordinate-conflict:P1:0',
                    type: 'coordinate-conflict',
                    resolutionKey: 'control:0',
                    title: 'Coordinate values differ for the same station',
                    targetLabel: 'P1',
                    existingSummary: 'ID P1; E=100.0000; N=200.0000; H=10.0000',
                    incomingSummary: 'ID P1; E=101.0000; N=201.0000; H=11.0000',
                    relatedItems: [{ kind: 'control', index: 0 }],
                  },
                ],
                conflictResolutions: { 'control:0': 'rename-incoming' },
                conflictRenameValues: { 'control:0': 'P1_IMPORT' },
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
      (Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'restore',
      ) as HTMLButtonElement).click();
    });

    expect(container.querySelector('[data-source]')?.textContent).toBe('imported.jxl');
    expect(container.querySelector('[data-sources]')?.textContent).toBe('2');
    expect(container.querySelector('[data-conflicts]')?.textContent).toBe('1');
    expect(container.querySelector('[data-compare-rows]')?.textContent).toBe('1');
    expect(container.querySelector('[data-resolution]')?.textContent).toBe('rename-incoming');
    expect(container.querySelector('[data-rename]')?.textContent).toBe('P1_IMPORT');
    expect(container.querySelector('[data-style]')?.textContent).toBe('industry-style');
    expect(container.querySelector('[data-snapshot]')?.textContent).toBe('imported.jxl');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('defaults industry-style JXL review to the industry preset and excludes MTA rows', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const fileInputRef = { current: null as HTMLInputElement | null };

    const Harness = () => {
      const state = useImportReviewWorkflow({
        coordMode: '3D',
        currentInput: '',
        currentIncludeFiles: {},
        faceNormalizationMode: 'on',
        fileInputRef,
        parseSettings,
        projectInstruments: {},
        setInput: () => undefined,
        setProjectIncludeFiles: () => undefined,
        setImportNotice: () => undefined,
        resetWorkspaceForImportedInput: () => undefined,
      });

      return (
        <div>
          <div data-prompt-style>{state.pendingAnglePromptFile?.importStyle ?? '-'}</div>
          <div data-preset>{state.importReviewState?.preset ?? '-'}</div>
          <div data-import-style>{state.importReviewState?.importStyle ?? '-'}</div>
          <div data-excluded>{state.importReviewState?.excludedItemIds.size ?? 0}</div>
          <button
            onClick={() =>
              state.handleFileChange({
                target: {
                  files: [
                    new File([trimmedIndustryJobXml], '260215 TRAVERSE.jxl', {
                      type: 'text/xml',
                    }),
                  ],
                  value: '',
                },
              } as never)
            }
          >
            choose
          </button>
          <button onClick={() => state.handleImportAnglePromptSetImportStyle('industry-style')}>
            industry
          </button>
          <button onClick={state.handleImportAnglePromptAccept}>accept</button>
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

    await click('choose');
    expect(container.querySelector('[data-prompt-style]')?.textContent).toBe('generic');

    await click('industry');
    expect(container.querySelector('[data-prompt-style]')?.textContent).toBe('industry-style');

    await click('accept');
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (container.querySelector('[data-preset]')?.textContent === 'industry-style') break;
      await act(async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 10));
      });
    }
    expect(container.querySelector('[data-preset]')?.textContent).toBe('industry-style');
    expect(container.querySelector('[data-import-style]')?.textContent).toBe('industry-style');
    expect(container.querySelector('[data-excluded]')?.textContent).toBe('1');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
