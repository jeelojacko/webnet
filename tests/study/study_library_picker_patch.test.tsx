/** @vitest-environment jsdom */

// Study Library picker patch: picker-mode search category order and
// unsearched document-card actions.

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
  examPrepLocatePickerChannelName,
  examPrepLocatePickerControlChannelName,
  type ExamPrepLocatePickMessage,
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

const resultFor = (
  entityType: StudySearchResultSummary['entityType'],
  id: string,
): StudySearchResultSummary => ({
  id,
  entityType,
  entityId: id,
  title: `Title ${id}`,
  subtitle: 'Subtitle',
  ...(entityType === 'document' ? { documentId: 'doc-a' } : {}),
  ...(entityType === 'official-provision'
    ? { documentId: 'doc-a', sourceKey: 'section:1' }
    : {}),
  ...(entityType === 'study-unit' || entityType === 'custom-unit' ? { unitId: 'unit-a' } : {}),
  score: 1,
});

describe('Study Library picker patch', () => {
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

  const renderLibrary = async (onNavigate: (_path: string) => void = vi.fn()) => {
    const data = createSeedStudyData('2026-09-01T00:00:00.000Z');
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
          onLoadLegalDocumentComponentSummary={async (documentId: string) => ({
            documentId,
            componentCount: 0,
            sectionCount: 0,
            subsectionCount: 0,
            scheduleCount: 0,
            formCount: 0,
            referenceOnlyFormCount: 0,
          })}
        />,
      );
    });
  };

  const typeQuery = async (query: string) => {
    const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, query);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  };

  it('orders picker search categories Official Provisions first', async () => {
    window.history.replaceState(
      {},
      '',
      '/study/library?studyPicker=locate&prompt=Find+the+rule&token=order-token',
    );
    await renderLibrary();
    await typeQuery('board');
    await act(async () => {
      fakeService?.pushResults([
        resultFor('document', 'document:doc-a:'),
        resultFor('official-provision', 'official-provision:doc-a:section:1'),
        resultFor('study-unit', 'study-unit:unit-a'),
      ]);
    });
    const headings = Array.from(document.querySelectorAll('h3')).map((entry) =>
      entry.textContent?.trim(),
    );
    const provisions = headings.indexOf('Official Provisions');
    const documents = headings.indexOf('Documents');
    const units = headings.indexOf('Study Units');
    const custom = headings.indexOf('Custom Units');
    expect(provisions).toBeGreaterThan(-1);
    expect(documents).toBeGreaterThan(-1);
    expect(provisions).toBeLessThan(documents);
    expect(documents).toBeLessThan(units);
    expect(units).toBeLessThan(custom);
  });

  it('gives every picker document card separate Open and Use actions', async () => {
    const token = 'doc-card-token';
    window.history.replaceState(
      {},
      '',
      `/study/library?studyPicker=locate&prompt=Find+the+rule&token=${token}`,
    );
    const picks: ExamPrepLocatePickMessage[] = [];
    const channel = new BroadcastChannel(examPrepLocatePickerChannelName(token));
    channel.onmessage = (event: MessageEvent) => {
      picks.push(event.data as ExamPrepLocatePickMessage);
    };
    const navigate = vi.fn();
    await renderLibrary(navigate);

    const openButtons = Array.from(document.querySelectorAll('button')).filter(
      (entry) => entry.textContent?.trim() === 'Open document',
    );
    const useButtons = Array.from(document.querySelectorAll('button')).filter(
      (entry) => entry.textContent?.trim() === 'Use this document',
    );
    // Every listed document card has both actions (no search typed).
    expect(openButtons.length).toBeGreaterThan(0);
    expect(useButtons.length).toBeGreaterThan(0);
    expect(openButtons.length).toBe(useButtons.length);

    await act(async () => {
      openButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(picks).toHaveLength(0);

    await act(async () => {
      useButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ type: 'study-locate-pick', token, sourceKey: null });
    expect(document.body.textContent).toContain('Sent: Use this document');
  });

  it('adopts fresh picker-context: banner updates, search + sent notice clear, picks bind to the new token', async () => {
    const sprintId = 'locate-sprint-adopt';
    window.history.replaceState(
      {},
      '',
      `/study/library?studyPicker=locate&prompt=First+question&token=q1-token&sprint=${sprintId}`,
    );
    const q1Picks: ExamPrepLocatePickMessage[] = [];
    const q1Channel = new BroadcastChannel(examPrepLocatePickerChannelName('q1-token'));
    q1Channel.onmessage = (event: MessageEvent) => {
      q1Picks.push(event.data as ExamPrepLocatePickMessage);
    };
    await renderLibrary();
    expect(document.body.textContent).toContain('First question');

    // Learner searches, then sends a pick: sent notice + waiting state show.
    await typeQuery('board');
    const useButtons = Array.from(document.querySelectorAll('button')).filter(
      (entry) => entry.textContent?.trim() === 'Use this document',
    );
    expect(useButtons.length).toBeGreaterThan(0);
    await act(async () => {
      useButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(q1Picks).toHaveLength(1);
    expect(document.body.textContent).toContain('Sent: Use this document');
    expect(document.body.textContent).toContain('Waiting for the next item');

    // Sprint advances: fresh context arrives on the control channel.
    const q2Picks: ExamPrepLocatePickMessage[] = [];
    const q2Channel = new BroadcastChannel(examPrepLocatePickerChannelName('q2-token'));
    q2Channel.onmessage = (event: MessageEvent) => {
      q2Picks.push(event.data as ExamPrepLocatePickMessage);
    };
    await act(async () => {
      publishToFakeBroadcastChannel(examPrepLocatePickerControlChannelName(sprintId), {
        type: EXAM_PREP_PICKER_CONTEXT_TYPE,
        sprintId,
        token: 'q2-token',
        prompt: 'Second question',
      });
      await Promise.resolve();
    });
    // Banner adopts the new prompt; search box and sent notice are cleared.
    expect(document.body.textContent).toContain('Second question');
    expect(document.body.textContent).not.toContain('First question');
    const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
    expect(input?.value).toBe('');
    expect(document.body.textContent).not.toContain('Sent: Use this document');
    expect(document.body.textContent).not.toContain('Waiting for the next item');

    // Selection actions now bind to the CURRENT (Q2) token.
    const useButtonsQ2 = Array.from(document.querySelectorAll('button')).filter(
      (entry) => entry.textContent?.trim() === 'Use this document',
    );
    expect(useButtonsQ2.length).toBeGreaterThan(0);
    await act(async () => {
      useButtonsQ2[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(q2Picks).toHaveLength(1);
    expect(q2Picks[0]).toMatchObject({ type: 'study-locate-pick', token: 'q2-token' });
    expect(q1Picks).toHaveLength(1);
    q1Channel.close();
    q2Channel.close();
  });

  it('keeps normal-mode document cards as a single open target', async () => {
    await renderLibrary();
    expect(document.body.textContent).not.toContain('Locate picker');
    const openButtons = Array.from(document.querySelectorAll('button')).filter(
      (entry) => entry.textContent?.trim() === 'Open document',
    );
    expect(openButtons).toHaveLength(0);
    expect(document.body.textContent).not.toContain('Use this document');
  });
});
