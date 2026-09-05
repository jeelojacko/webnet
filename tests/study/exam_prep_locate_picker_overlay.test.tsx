/** @vitest-environment jsdom */

// Locate same-tab picker overlay: Open Locate Picker renders a near-fullscreen
// overlay WITHOUT window.open and WITHOUT unmounting the sprint; a direct
// pick closes the overlay, freezes feedback, and persists only on Continue;
// closing without a pick preserves the item; reopening after an advance
// starts fresh with the new prompt.

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepLocateView } from '../../src/study/examPrep/components/ExamPrepLocate';
import type { StudySearchService } from '../../src/study/search/studySearchService';
import type {
  StudySearchResultSummary,
  StudySearchStatus,
} from '../../src/study/search/studySearchTypes';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { ExamPrepAttempt } from '../../src/study/examPrep/examPrepTypes';

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

describe('Locate same-tab picker overlay', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    fakeService = null;
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    fakeService = null;
    vi.restoreAllMocks();
  });

  const render = async (node: React.ReactNode) => {
    await act(async () => {
      root?.render(node);
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

  const renderSprint = async (saved: ExamPrepAttempt[]) => {
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
    await render(
      <ExamPrepLocateView
        attempts={[]}
        onSaveExamPrepAttempt={async (attempt) => {
          saved.push(attempt);
        }}
        onOpenProvision={vi.fn()}
        onNavigate={vi.fn()}
        pickerLibraryData={data}
        onLoadLegalDocumentComponentSummary={summary}
      />,
    );
  };

  it('opens the overlay without window.open; pick freezes feedback and persists only on Continue', async () => {
    const saved: ExamPrepAttempt[] = [];
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await renderSprint(saved);
    await clickButton('Start Locate Sprint');
    expect(bodyText()).toContain('Question 1 of 10');

    await clickButton('Open Locate Picker');
    expect(openSpy).not.toHaveBeenCalled();
    // Overlay is up with the current prompt; the sprint stays mounted behind it.
    const dialog = document.querySelector('[role="dialog"][aria-label="Locate picker"]');
    expect(dialog).toBeTruthy();
    expect(bodyText()).toContain('Close Picker');
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain('Elapsed:');
    expect(bodyText()).toContain('Check Answer');

    // Direct document pick: overlay closes, feedback freezes, nothing saved yet.
    const useButtons = Array.from(document.querySelectorAll('button')).filter(
      (entry) => entry.textContent?.trim() === 'Use this document',
    );
    expect(useButtons.length).toBeGreaterThan(0);
    await act(async () => {
      useButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.querySelector('[role="dialog"][aria-label="Locate picker"]')).toBeNull();
    expect(bodyText()).toContain('Your selection');
    expect(bodyText()).toContain('Expected location');
    expect(saved).toHaveLength(0);

    await clickButton('Continue');
    expect(saved).toHaveLength(1);
    expect(bodyText()).toContain('Question 2 of 10');
  });

  it('closing without a pick preserves the item; reopening after an advance shows the new prompt fresh', async () => {
    const saved: ExamPrepAttempt[] = [];
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    await renderSprint(saved);
    await clickButton('Start Locate Sprint');

    await clickButton('Open Locate Picker');
    expect(openSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"][aria-label="Locate picker"]')).toBeTruthy();
    await clickButton('Close Picker');
    expect(document.querySelector('[role="dialog"][aria-label="Locate picker"]')).toBeNull();
    // Item preserved: still Q1, unanswered, nothing saved.
    expect(bodyText()).toContain('Question 1 of 10');
    expect(bodyText()).toContain('Open Locate Picker');
    expect(saved).toHaveLength(0);

    // Answer manually, advance, reopen: overlay shows the Q2 prompt.
    await clickButton('Check Answer');
    await clickButton('Found it');
    expect(bodyText()).toContain('Question 2 of 10');
    await clickButton('Open Locate Picker');
    const dialog = document.querySelector('[role="dialog"][aria-label="Locate picker"]');
    expect(dialog).toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
