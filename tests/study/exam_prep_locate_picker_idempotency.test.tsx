/** @vitest-environment jsdom */

// Locate picker-context idempotency: duplicate context for the SAME
// sprintId+token is ignored completely (no search/result/waiting/notice
// reset); a NEW token resets search/debounced/results/waiting/notice/index
// and updates the banner.

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
  EXAM_PREP_PICKER_CONTEXT_TYPE,
  examPrepLocatePickerControlChannelName,
} from '../../src/study/examPrep/examPrepLocatePicker';
import {
  installFakeBroadcastChannel,
  publishToFakeBroadcastChannel,
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
  search(): void {}
  rebuild(): void {}
  commitStudyBulkUpdate(): void {}
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

describe('Locate picker-context idempotency', () => {
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
    window.history.replaceState({}, '', '/study/library');
  });

  const searchInput = () =>
    document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;

  const typeQuery = async (query: string) => {
    const input = searchInput();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, query);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  it('ignores duplicate same sprintId+token context; new token resets', async () => {
    const sprintId = 'locate-sprint-idempotent';
    window.history.replaceState(
      {},
      '',
      `/study/library?studyPicker=locate&prompt=First+question&token=q1-token&sprint=${sprintId}`,
    );
    const data = createSeedStudyData('2026-09-01T00:00:00.000Z');
    const summary = async (documentId: string) => ({
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
          onNavigate={vi.fn()}
          onLoadLegalDocumentComponentSummary={summary}
        />,
      );
    });
    expect(document.body.textContent).toContain('First question');

    // Visible query + sent notice + waiting state.
    await typeQuery('board');
    expect(searchInput().value).toBe('board');
    const useButtons = Array.from(document.querySelectorAll('button')).filter(
      (entry) => entry.textContent?.trim() === 'Use this document',
    );
    expect(useButtons.length).toBeGreaterThan(0);
    await act(async () => {
      useButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Sent: Use this document');
    expect(document.body.textContent).toContain('Waiting for the next item');

    // Duplicate heartbeat: identical sprintId+token is ignored completely.
    await act(async () => {
      publishToFakeBroadcastChannel(examPrepLocatePickerControlChannelName(sprintId), {
        type: EXAM_PREP_PICKER_CONTEXT_TYPE,
        sprintId,
        token: 'q1-token',
        prompt: 'First question',
      });
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('First question');
    expect(searchInput().value).toBe('board');
    expect(document.body.textContent).toContain('Sent: Use this document');
    expect(document.body.textContent).toContain('Waiting for the next item');

    // New token: banner updates; search/waiting/notice reset.
    await act(async () => {
      publishToFakeBroadcastChannel(examPrepLocatePickerControlChannelName(sprintId), {
        type: EXAM_PREP_PICKER_CONTEXT_TYPE,
        sprintId,
        token: 'q2-token',
        prompt: 'Second question',
      });
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain('Second question');
    expect(document.body.textContent).not.toContain('First question');
    expect(searchInput().value).toBe('');
    expect(document.body.textContent).not.toContain('Sent: Use this document');
    expect(document.body.textContent).not.toContain('Waiting for the next item');
  });
});
