// Exam Prep Mock — page/route/tab/landing/focused-mode UI tests.
//
// jsdom tests over ExamPrepPage (view mock): route decoding, the Mock Exam
// tab, the provisional landing screen, Start New Mock entering the focused
// answering mode with the tab bar hidden, and DOM answer-leak regression
// while actively answering.

/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExamPrepPage } from '../../src/study/examPrep/ExamPrepPage';
import { decodeExamPrepView } from '../../src/study/examPrep/examPrepRoutes';
import { createSeedStudyData } from '../../src/study/studySeed';
import type { StudyDataSnapshot } from '../../src/study/studyTypes';
import { upsertById } from '../../src/study/examPrep/examPrepStateUpdates';
import { makeMockSession } from './exam_prep_mock_support';
import { resolveExamPrepMockQuestionContent } from '../../src/study/examPrep/mock/examPrepMockQuestionContent';
import { EXAM_PREP_DOCUMENT_TITLES } from '../../src/study/examPrep/examPrepDocTitles';
import { examPrepProvisionLabel } from '../../src/study/examPrep/examPrepFormat';
import { examPrepMockQuestionPromptText } from '../../src/study/examPrep/mock/examPrepMockQuestionPrompt';
import type { ExamPrepMockSession } from '../../src/study/examPrep/mock/examPrepMockTypes';

const seed = createSeedStudyData('2026-09-01T00:00:00.000Z');

describe('Exam Prep mock routes and tabs', () => {
  it('decodes /study/mock-exam to the mock view and keeps legacy routes', () => {
    expect(decodeExamPrepView('/study/mock-exam')).toBe('mock');
    expect(decodeExamPrepView('/study/exam-prep')).toBe('home');
    expect(decodeExamPrepView('/study/learn')).toBe('learn');
    expect(decodeExamPrepView('/study/exam-curriculum')).toBe('learn');
    expect(decodeExamPrepView('/study/review')).toBe('recall');
    expect(decodeExamPrepView('/study/drills')).toBe('drills');
    expect(decodeExamPrepView('/study/session')).toBeNull();
  });
});

describe('Exam Prep mock page (jsdom)', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;
  let dataRef: { current: StudyDataSnapshot };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    dataRef = { current: { ...seed, examPrepMockSessions: [] } };
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    vi.restoreAllMocks();
  });

  const renderPage = async (data: StudyDataSnapshot) => {
    await act(async () => {
      root?.render(
        <ExamPrepPage
          view="mock"
          data={data}
          onNavigate={vi.fn()}
          onOpenProvision={vi.fn()}
          onToggleUnitStudied={vi.fn(async () => undefined)}
          onRateRecallTask={vi.fn(async () => undefined)}
          onSaveExamPrepAttempt={vi.fn(async () => undefined)}
          onSaveExamPrepMockSession={async (session) => {
            dataRef.current = {
              ...dataRef.current,
              examPrepMockSessions: upsertById(
                dataRef.current.examPrepMockSessions,
                session,
              ),
            };
          }}
        />,
      );
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
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  };

  it('shows the provisional landing screen with profile numbers and honest labelling', async () => {
    await renderPage(dataRef.current);
    const text = bodyText();
    expect(text).toContain('Provisional Mock Exam');
    expect(text).toContain('150 minutes');
    expect(text).toContain('Pass mark');
    expect(text).toContain('Not configured');
    expect(text).toContain('Open-book');
    expect(text).toContain('Built-in statute library enabled');
    expect(text).toContain('Start New Mock');
    expect(text).toContain('registrar has not yet confirmed');
    expect(text).toContain('No mock exams yet.');
    expect(text).toContain('Self-assessed points');
    // resource rows spell the configured mix without claiming an official format
    expect(text).toContain('6 × Recall');
    expect(text).toContain('8 × Recognition');
    expect(text).toContain('10 × Locate');
    expect(text).toContain('6 × Applied lookup drills');
  });

  it('shows the Mock Exam tab alongside the other Exam Prep tabs', async () => {
    await renderPage(dataRef.current);
    expect(bodyText()).toContain('Mock Exam');
    expect(bodyText()).toContain('Lookup Drills');
    expect(bodyText()).toContain('Learn');
  });

  it('starting a mock enters the focused answering mode and hides ordinary tabs', async () => {
    await renderPage(dataRef.current);
    expect(bodyText()).toContain('Start New Mock');
    await clickButton('Start New Mock');
    await renderPage(dataRef.current);

    const text = bodyText();
    expect(text).toContain('Question 1 of 30');
    expect(text).toMatch(/02:30:00 left|02:29:5\d left/);
    expect(text).toContain('Open Statute Library');
    expect(text).toContain('Submit Mock Exam');
    expect(text).toContain('Exit / Save for later');
    // focused mode: no ordinary Exam Prep tabs / landing CTA
    expect(text).not.toContain('Start New Mock');
    expect(text).not.toContain('Lookup Drills');
    expect(text).not.toContain('Suggested study flow');
  });

  it('does not put expected answers in the DOM while actively answering (all kinds)', async () => {
    // Deterministic fixed-seed in-progress session (no random start).
    const fixed = makeMockSession({ seed: 'leak-check-fixed' });
    dataRef.current = { ...dataRef.current, examPrepMockSessions: [fixed] };
    await renderPage(dataRef.current);
    expect(bodyText()).toContain('Question 1 of 30');

    // Visit every question; while each is visible its secret expected material
    // (expected rule / unit id+title / provision pins / lookup prompts / answer
    // points / trap / not-already-public document names) must be absent.
    for (let index = 0; index < fixed.questions.length; index += 1) {
      const question = fixed.questions[index];
      if (!question) throw new Error('expected question');
      const paletteButton = Array.from(document.querySelectorAll('button')).find(
        (entry) => entry.textContent?.trim() === String(index + 1),
      );
      expect(paletteButton).toBeTruthy();
      await act(async () => {
        paletteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
      });
      const rendered = bodyText();
      for (const term of secretAnswerTermsForQuestion(fixed, question.questionId)) {
        expect(rendered).not.toContain(term);
      }
    }
    const textarea = document.querySelector('textarea');
    expect(textarea?.getAttribute('placeholder')).toBe('Your answer...');
  });

  it('an archived-hash in-progress mock never becomes the current active exam', async () => {
    const archived = makeMockSession({ seed: 'archived-only' });
    const archivedRecord: ExamPrepMockSession = {
      ...archived,
      curriculumContentHash: 'f9'.padEnd(64, 'a'),
    };
    dataRef.current = { ...dataRef.current, examPrepMockSessions: [archivedRecord] };
    await renderPage(dataRef.current);
    const text = bodyText();
    expect(text).toContain('Start New Mock');
    expect(text).not.toContain('Question 1 of 30');
  });

  it('fails closed when the storage one-active lock rejects a mock start', async () => {
    // Simulates the transactional one-active-current-mock creation lock (for
    // example a second tab already holds an in-progress mock). The landing
    // screen must surface the failure and must not enter the answering UI.
    await act(async () => {
      root?.render(
        <ExamPrepPage
          view="mock"
          data={dataRef.current}
          onNavigate={vi.fn()}
          onOpenProvision={vi.fn()}
          onToggleUnitStudied={vi.fn(async () => undefined)}
          onRateRecallTask={vi.fn(async () => undefined)}
          onSaveExamPrepAttempt={vi.fn(async () => undefined)}
          onSaveExamPrepMockSession={async () => {
            throw new Error(
              'A mock exam is already in progress. Submit or abandon it before starting another.',
            );
          }}
        />,
      );
    });
    await clickButton('Start New Mock');
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    });
    const text = bodyText();
    expect(text).toContain('A mock exam is already in progress.');
    expect(text).toContain('Start New Mock');
    expect(text).not.toContain('Question 1 of 30');
  });
});

describe('Exam Prep Home — Mock Exam step 6 and provisional CTA', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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
    vi.restoreAllMocks();
  });

  it('shows Mock Exam as step 6 and a clearly provisional CTA', async () => {
    await act(async () => {
      root?.render(
        <ExamPrepPage
          view="home"
          data={{ ...seed, examPrepMockSessions: [] }}
          onNavigate={vi.fn()}
          onOpenProvision={vi.fn()}
          onToggleUnitStudied={vi.fn(async () => undefined)}
          onRateRecallTask={vi.fn(async () => undefined)}
          onSaveExamPrepAttempt={vi.fn(async () => undefined)}
        />,
      );
    });
    const text = document.body.textContent ?? '';
    expect(text).toContain('6. Mock Exam');
    expect(text).toContain('Combine the full workflow under one timed exam simulation.');
    expect(text).toContain('Provisional Mock Exam');
    expect(text).toContain('150 min · 30 questions');
    expect(text).toContain('Format awaiting registrar confirmation');
    expect(text).toContain('Open Mock Exam');
  });
});

const secretAnswerTermsForQuestion = (
  session: ExamPrepMockSession,
  questionId: string,
): string[] => {
  const question = session.questions.find((entry) => entry.questionId === questionId);
  if (!question) throw new Error(`expected question ${questionId}`);
  // Public pre-submission prompt text (fact patterns legitimately name Acts).
  const publicText = examPrepMockQuestionPromptText(question);
  const terms: string[] = [];
  const content = resolveExamPrepMockQuestionContent(question);
  if (content.kind === 'recall') {
    terms.push(content.expectedAnswer);
  } else if (content.kind === 'recognition') {
    terms.push(content.unitId);
    terms.push(content.unitTitle);
    content.expectedDocumentIds.forEach((id) =>
      terms.push(EXAM_PREP_DOCUMENT_TITLES[id] ?? id),
    );
  } else if (content.kind === 'locate') {
    terms.push(
      EXAM_PREP_DOCUMENT_TITLES[content.expectedDocumentId] ?? content.expectedDocumentId,
    );
    if (content.expectedSourceKey) {
      terms.push(examPrepProvisionLabel(content.expectedSourceKey));
    }
  } else {
    content.requiredLookups.forEach((lookup) => {
      terms.push(lookup.prompt);
      const docTitle = EXAM_PREP_DOCUMENT_TITLES[lookup.documentId] ?? lookup.documentId;
      terms.push(docTitle);
      if (lookup.sourceKey) terms.push(examPrepProvisionLabel(lookup.sourceKey));
    });
    content.requiredAnswerPoints.forEach((point) => terms.push(point));
    if (content.trapExplanation) terms.push(content.trapExplanation);
  }
  // Drop any term that is itself part of the visible public prompt (e.g. an
  // Act name inside a drill fact pattern) — that text is intentionally shown.
  return terms.filter(
    (term) => term.trim().length > 0 && !publicText.includes(term),
  );
};
