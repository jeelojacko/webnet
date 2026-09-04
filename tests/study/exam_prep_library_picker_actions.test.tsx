/** @vitest-environment jsdom */

// Study Library — picker-mode search result actions.
//
// When the Library tab is opened from an active Locate sprint
// (`?studyPicker=locate&prompt=…&token=…`), official search results must
// visibly offer `[ Use this document ]` (document rows) and `[ Use this
// provision ]` (official-provision rows) that post the objective pick
// (`sourceKey: null` / exact sourceKey) to the sprint tab over the
// token-scoped BroadcastChannel. Normal mode is preserved: no action row and
// result cards stay a single click target.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudyLibrary from '../../src/study/components/StudyLibrary';
import type { StudySearchService } from '../../src/study/search/studySearchService';
import type {
  StudySearchResultSummary,
  StudySearchStatus,
} from '../../src/study/search/studySearchTypes';
import { createSeedStudyData } from '../../src/study/studySeed';
import {
  examPrepLocatePickerChannelName,
  type ExamPrepLocatePickMessage,
} from '../../src/study/examPrep/examPrepLocatePicker';
import {
  installFakeBroadcastChannel,
  restoreGlobalBroadcastChannel,
} from './exam_prep_broadcast_channel_support';

type StatusListener = (_status: StudySearchStatus) => void;
type ResultsListener = (_results: StudySearchResultSummary[]) => void;

class FakeSearchService {
  private statusListeners = new Set<StatusListener>();
  private resultsListeners = new Set<ResultsListener>();
  initialize(): void {
    this.pushStatus({ ready: true, phase: 'ready', message: 'Search index ready.' });
  }
  search(_query: string, _scope: string, _limit?: number): void {}
  rebuild(): void {}
  commitStudyBulkUpdate(_options: { upsertUnitIds: string[]; removeUnitIds: string[] }): void {}
  requestDiagnostics(): Promise<null> {
    return Promise.resolve(null);
  }
  subscribeStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  subscribeResults(listener: ResultsListener): () => void {
    this.resultsListeners.add(listener);
    return () => this.resultsListeners.delete(listener);
  }
  dispose(): void {}
  pushStatus(status: StudySearchStatus): void {
    this.statusListeners.forEach((listener) => listener(status));
  }
  pushResults(results: StudySearchResultSummary[]): void {
    this.resultsListeners.forEach((listener) => listener(results));
  }
}

let fakeService: FakeSearchService | null = null;

vi.mock('../../src/study/search/studySearchService', () => ({
  createStudySearchService: () => {
    fakeService ??= new FakeSearchService();
    return fakeService as unknown as StudySearchService;
  },
}));

const summary = (
  overrides: Partial<StudySearchResultSummary> & {
    entityType: StudySearchResultSummary['entityType'];
    documentId: string;
    sourceKey?: string | null;
  },
): StudySearchResultSummary => ({
  id: `${overrides.entityType}:${overrides.documentId}:${overrides.sourceKey ?? ''}`,
  entityType: overrides.entityType,
  entityId: `${overrides.documentId}::${overrides.sourceKey ?? ''}`,
  title: overrides.title ?? `Title ${overrides.documentId}`,
  subtitle: overrides.subtitle ?? 'Subtitle',
  documentId: overrides.documentId,
  ...(overrides.sourceKey ? { sourceKey: overrides.sourceKey } : {}),
  score: 1,
});

const summaryForDocument = (documentId: string): StudySearchResultSummary =>
  summary({ entityType: 'document', documentId, title: `Act: ${documentId}` });

const summaryForProvision = (documentId: string, sourceKey: string): StudySearchResultSummary =>
  summary({
    entityType: 'official-provision',
    documentId,
    sourceKey,
    title: `s.${sourceKey.split(':').pop()} of ${documentId}`,
  });

const setPickerLocation = (token: string) => {
  const url = `/study/library?studyPicker=locate&prompt=Find+the+rule&token=${encodeURIComponent(token)}`;
  window.history.replaceState({}, '', url);
};

const resetLocation = () => {
  window.history.replaceState({}, '', '/study/library');
};

describe('Study Library picker-mode search actions', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let previousBroadcastChannel: unknown;

  beforeEach(() => {
    fakeService = null;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    previousBroadcastChannel = installFakeBroadcastChannel();
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    fakeService = null;
    restoreGlobalBroadcastChannel(previousBroadcastChannel);
    vi.restoreAllMocks();
    resetLocation();
  });

  const renderLibrary = async (onNavigate: (_path: string) => void = vi.fn()) => {
    const data = createSeedStudyData('2026-09-01T00:00:00.000Z');
    const summaryResolver = async (documentId: string) => ({
      documentId,
      componentCount: 0,
      sectionCount: 0,
      subsectionCount: 0,
      scheduleCount: 0,
      formCount: 0,
      referenceOnlyFormCount: 0,
    });
    await act(async () => {
      root?.render(
        <StudyLibrary
          data={data}
          onSelectDocument={vi.fn()}
          onCreateCustomUnit={vi.fn()}
          onEditUnit={vi.fn()}
          onPreviewUnit={vi.fn()}
          onPracticeUnit={vi.fn()}
          onOpenProvision={vi.fn()}
          onDeleteUnit={vi.fn()}
          onDuplicateUnit={vi.fn()}
          onNavigate={onNavigate}
          onLoadLegalDocumentComponentSummary={summaryResolver}
        />,
      );
    });
  };

  const typeQuery = async (query: string) => {
    const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, query);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // debounce (120ms) + worker round trip
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  const pushResults = async (results: StudySearchResultSummary[]) => {
    await act(async () => {
      fakeService?.pushResults(results);
    });
  };

  const bodyText = () => document.body.textContent ?? '';

  const clickButton = async (text: string) => {
    const button = Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.trim().startsWith(text),
    );
    expect(button).toBeTruthy();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
  };

  const pickChannelName = (token: string): string => examPrepLocatePickerChannelName(token);

  /**
   * Opens a fake listener on the picker token channel (the role the sprint tab
   * plays in the real flow) so the test can assert the pick the Library posts.
   */
  const listenForPick = (token: string): { picks: ExamPrepLocatePickMessage[] } => {
    const picks: ExamPrepLocatePickMessage[] = [];
    const channel = new BroadcastChannel(pickChannelName(token));
    channel.onmessage = (event: MessageEvent) => {
      picks.push(event.data as ExamPrepLocatePickMessage);
    };
    return { picks };
  };

  it('normal mode has no picker banner and no Use-this action rows', async () => {
    await renderLibrary();
    expect(bodyText()).not.toContain('Locate picker');
    expect(bodyText()).not.toContain('Use this document');
    expect(bodyText()).not.toContain('Use this provision');
  });

  it('document search results offer [ Use this document ] and post a document-level pick', async () => {
    const token = 'lib-doc-token';
    setPickerLocation(token);
    // The picker must communicate with NO window.opener (noopener,noreferrer).
    expect(window.opener).toBeFalsy(); // jsdom reports undefined; browsers null — never a real opener
    const { picks } = listenForPick(token);
    await renderLibrary();
    expect(bodyText()).toContain('Locate picker — find the controlling provision');

    await typeQuery('Registry');
    await pushResults([summaryForDocument('doc-registry-act')]);
    expect(bodyText()).toContain('Use this document');
    await clickButton('Use this document');

    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({
      type: 'study-locate-pick',
      token,
      documentId: 'doc-registry-act',
      sourceKey: null,
    });
    // Notice confirms the send (also no provision action on a document row).
    expect(bodyText()).toContain('Sent: Use this document');
    // A document row never offers the provision action.
    const provisionButtons = Array.from(document.querySelectorAll('button')).filter((entry) =>
      entry.textContent?.trim().startsWith('Use this provision'),
    );
    expect(provisionButtons).toHaveLength(0);
  });

  it('official-provision search results offer [ Use this provision ] with the exact sourceKey', async () => {
    const token = 'lib-provision-token';
    setPickerLocation(token);
    expect(window.opener).toBeFalsy(); // jsdom reports undefined; browsers null — never a real opener
    const { picks } = listenForPick(token);
    await renderLibrary();

    await typeQuery('integrated');
    await pushResults([summaryForProvision('doc-surveys-act', 'section:83')]);
    expect(bodyText()).toContain('Use this provision');
    await clickButton('Use this provision');

    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({
      type: 'study-locate-pick',
      token,
      documentId: 'doc-surveys-act',
      sourceKey: 'section:83',
    });
    expect(bodyText()).toContain('Sent: Use this provision');
  });

  it('explains the manual fallback when BroadcastChannel is unavailable', async () => {
    setPickerLocation('lib-lost-token');
    // Simulate a browser without BroadcastChannel.
    restoreGlobalBroadcastChannel(previousBroadcastChannel);
    (globalThis as Record<string, unknown>).BroadcastChannel = undefined;
    await renderLibrary();
    await typeQuery('Registry');
    await pushResults([summaryForDocument('doc-registry-act')]);
    await clickButton('Use this document');
    expect(bodyText()).toContain('Automatic answer return is unavailable in this browser');
    // No bogus "could not be reached" claim: browsing stays usable.
    expect(bodyText()).not.toContain('could not be reached');
  });

  it('provision deep links keep the picker query BEFORE the hash so reader context survives', async () => {
    const token = 'lib-hash-token';
    setPickerLocation(token);
    expect(window.opener).toBeFalsy(); // jsdom reports undefined; browsers null — never a real opener
    const navigate = vi.fn();
    await renderLibrary(navigate);
    await typeQuery('integrated');
    await pushResults([summaryForProvision('doc-surveys-act', 'section:83')]);

    // Click the result body (opens the provision in the picker tab).
    const body = Array.from(document.querySelectorAll('button')).find((entry) =>
      entry.textContent?.includes('s.83 of doc-surveys-act'),
    );
    expect(body).toBeTruthy();
    await act(async () => {
      body?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(navigate).toHaveBeenCalledTimes(1);
    const path = String(navigate.mock.calls[0]?.[0] ?? '');
    // Picker query must sit before `#` so window.location.search stays set.
    expect(path).toContain('?studyPicker=locate&prompt=Find+the+rule');
    expect(path).toContain(`token=${encodeURIComponent(token)}`);
    const hashIndex = path.indexOf('#');
    const queryIndex = path.indexOf('?');
    expect(hashIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeLessThan(hashIndex);
    // The provision label is URI-encoded in the hash (reader decodes it).
    expect(path.slice(hashIndex)).toBe(`#${encodeURIComponent('section:83')}`);
  });
});
