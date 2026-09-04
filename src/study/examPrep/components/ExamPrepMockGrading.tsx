// Exam Prep Mock — self-grading view (post-submission).
//
// Reveals the exact source-grounded expected answers and asks the learner to
// self-assess (mirroring Drill self-assessment). No automated semantic
// grading. Grading persists per question and may be resumed after reload;
// Finalize Results unlocks only when every question has a grading record.

import { useMemo, useState, type ReactNode } from 'react';
import { EXAM_PREP_DOCUMENT_TITLES } from '../examPrepDocTitles';
import { examPrepProvisionLabel, examPrepTierLabel } from '../examPrepFormat';
import { EXAM_PREP_OPEN_SOURCE_BUTTON } from './examPrepBits';
import { EXAM_PREP_MOCK_KIND_LABELS } from '../examPrepFormat';
import { resolveExamPrepMockQuestionContent } from '../mock/examPrepMockQuestionContent';
import { gradeMockQuestion, finalizeMock } from '../mock/examPrepMockSession';
import { isMockFullyGraded, mockGradedCount } from '../mock/examPrepMockResults';
import type { SaveExamPrepMockSession } from './ExamPrepMockActive';
import type {
  ExamPrepMockQuestionGrading,
  ExamPrepMockSession,
} from '../mock/examPrepMockTypes';

export type ExamPrepMockGradingProps = {
  session: ExamPrepMockSession;
  onSaveSession: SaveExamPrepMockSession;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
};

const nowIso = (): string => new Date().toISOString();

export const ExamPrepMockGrading = ({
  session,
  onSaveSession,
  onOpenProvision,
}: ExamPrepMockGradingProps) => {
  const [index, setIndex] = useState(Math.min(session.currentQuestionIndex, session.questions.length - 1));
  const [saveError, setSaveError] = useState<string | null>(null);
  const question = session.questions[index];
  const total = session.questions.length;
  const response = question
    ? session.responses.find((entry) => entry.questionId === question.questionId)
    : undefined;
  const fullyGraded = isMockFullyGraded(session);
  const gradedCount = mockGradedCount(session);
  const content = useMemo(
    () => (question ? resolveExamPrepMockQuestionContent(question) : null),
    [question],
  );

  const saveGrade = async (grading: ExamPrepMockQuestionGrading) => {
    if (!question) return;
    const next = gradeMockQuestion(session, question.questionId, grading, nowIso());
    try {
      await onSaveSession(next, { kind: 'existing', updatedAt: session.updatedAt });
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'This mock session could not be saved.',
      );
    }
  };

  const finalize = async () => {
    const next = finalizeMock(session, nowIso());
    try {
      await onSaveSession(next, { kind: 'existing', updatedAt: session.updatedAt });
      setSaveError(null);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'This mock session could not be saved.',
      );
    }
  };

  if (!question || !content || !response) return null;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">
            Exam Prep · Self-grade your mock
          </div>
          <div className="mt-1 text-sm font-semibold text-white">
            Question {index + 1} of {total}
            <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
              {EXAM_PREP_MOCK_KIND_LABELS[question.kind]}
            </span>
          </div>
        </div>
        <div className="text-xs text-slate-400">
          {gradedCount} of {total} graded · answers can no longer be edited
        </div>
      </header>

      {saveError ? (
        <div
          role="alert"
          className="rounded border border-rose-900/60 bg-rose-950/40 p-2 text-xs text-rose-200"
        >
          {saveError}
        </div>
      ) : null}

      <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
          Question
        </p>
        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-100">
          {examPrepQuestionText(content)}
        </div>

        <div className="mt-3 rounded border border-slate-700 bg-slate-800/40 p-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Your answer
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-200">
            {response.answer.trim() ? response.answer : '(no answer)'}
          </p>
        </div>

        <ExamPrepMockExpectedBlock
          questionId={question.questionId}
          grading={response.grading}
          content={content}
          onOpenProvision={onOpenProvision}
          onGrade={(grading) => void saveGrade(grading)}
          onDrillSave={async (lawIdentified, provisionLocated, substantiveAnswerComplete) => {
            const points = [lawIdentified, provisionLocated, substantiveAnswerComplete].filter(
              Boolean,
            ).length as 0 | 1 | 2 | 3;
            await saveGrade({
              kind: 'drill',
              lawIdentified,
              provisionLocated,
              substantiveAnswerComplete,
              pointsAwarded: points,
              gradedAt: nowIso(),
            });
          }}
        />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => setIndex(Math.max(0, index - 1))}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={index >= total - 1}
            onClick={() => setIndex(Math.min(total - 1, index + 1))}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next
          </button>
        </div>
        <button
          type="button"
          disabled={!fullyGraded}
          onClick={() => void finalize()}
          title={fullyGraded ? undefined : 'Grade every question before finalizing.'}
          className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Finalize Results
        </button>
      </div>

      <MockGradingPalette
        session={session}
        currentIndex={index}
        onSelect={setIndex}
      />
    </div>
  );
};

const examPrepQuestionText = (
  content: ReturnType<typeof resolveExamPrepMockQuestionContent>,
): string => {
  switch (content.kind) {
    case 'recall':
      return content.prompt;
    case 'recognition':
      return `${content.cue}\n\nWhich law or legal topic applies?`;
    case 'locate':
      return content.prompt;
    case 'drill':
      return `${content.factPattern}\n\n${content.task}`;
  }
};

const ExamPrepMockExpectedBlock = ({
  questionId,
  grading,
  content,
  onOpenProvision,
  onGrade,
  onDrillSave,
}: {
  questionId: string;
  grading: ExamPrepMockQuestionGrading | null;
  content: ReturnType<typeof resolveExamPrepMockQuestionContent>;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  onGrade: (_grading: ExamPrepMockQuestionGrading) => void;
  onDrillSave: (
    _law: boolean,
    _provision: boolean,
    _substantive: boolean,
  ) => Promise<void>;
}) => {
  if (content.kind === 'recall') {
    return (
      <MockExpectedShell
        title="Expected rule"
        alreadyGraded={grading?.kind === 'recall' ? grading : null}
        kind="recall"
        gradingText={grading?.kind === 'recall' ? (grading.correct ? 'Correct' : 'Incorrect') : null}
      >
        <p className="mt-1 rounded border border-emerald-900/60 bg-emerald-950/40 p-2 text-sm text-emerald-50">
          {content.expectedAnswer}
        </p>
        <CorrectIncorrectButtons grading={grading} onCorrect={() => onGrade({ kind: 'recall', correct: true, pointsAwarded: 1, gradedAt: nowIso() })} onIncorrect={() => onGrade({ kind: 'recall', correct: false, pointsAwarded: 0, gradedAt: nowIso() })} />
      </MockExpectedShell>
    );
  }
  if (content.kind === 'recognition') {
    return (
      <MockExpectedShell
        title="Expected topic"
        alreadyGraded={grading?.kind === 'recognition' ? grading : null}
        kind="recognition"
        gradingText={grading?.kind === 'recognition' ? (grading.correct ? 'Correct' : 'Incorrect') : null}
      >
        <p className="mt-1 text-sm text-white">
          <span className="font-mono text-xs text-sky-300">{content.unitId ?? ''}</span>
          <span className="ml-2">{content.unitTitle}</span>
        </p>
        <div className="mt-1 flex flex-wrap gap-1.5 text-[11px]">
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
            {examPrepTierLabel(content.tier as 'A' | 'B' | 'C' | 'D' | 'NAV' | 'DRILL')}
          </span>
        </div>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-sky-300">
          Likely sources
        </p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-sky-100/90">
          {content.expectedDocumentIds.map((documentId) => (
            <li key={documentId}>{EXAM_PREP_DOCUMENT_TITLES[documentId] ?? documentId}</li>
          ))}
        </ul>
        <CorrectIncorrectButtons grading={grading} onCorrect={() => onGrade({ kind: 'recognition', correct: true, pointsAwarded: 1, gradedAt: nowIso() })} onIncorrect={() => onGrade({ kind: 'recognition', correct: false, pointsAwarded: 0, gradedAt: nowIso() })} />
      </MockExpectedShell>
    );
  }
  if (content.kind === 'locate') {
    return (
      <MockExpectedShell
        title="Expected location"
        alreadyGraded={grading?.kind === 'locate' ? grading : null}
        kind="locate"
        gradingText={grading?.kind === 'locate' ? (grading.correct ? 'Correct' : 'Incorrect') : null}
      >
        <p className="mt-1 text-sm text-white">
          {EXAM_PREP_DOCUMENT_TITLES[content.expectedDocumentId] ?? content.expectedDocumentId}
          {content.expectedSourceKey ? (
            <span className="ml-1.5 font-mono text-xs text-sky-300">
              {examPrepProvisionLabel(content.expectedSourceKey)}
            </span>
          ) : null}
        </p>
        {content.expectedSourceKey ? (
          <div className="mt-2">
            <EXAM_PREP_OPEN_SOURCE_BUTTON
              documentId={content.expectedDocumentId}
              sourceKey={content.expectedSourceKey}
              label={`Open exact provision · ${examPrepProvisionLabel(content.expectedSourceKey)}`}
              onOpenProvision={onOpenProvision}
            />
          </div>
        ) : (
          <p className="mt-1 text-[11px] italic text-slate-500">
            Document-level target — no single provision is pinned.
          </p>
        )}
        <CorrectIncorrectButtons grading={grading} onCorrect={() => onGrade({ kind: 'locate', correct: true, pointsAwarded: 1, gradedAt: nowIso() })} onIncorrect={() => onGrade({ kind: 'locate', correct: false, pointsAwarded: 0, gradedAt: nowIso() })} />
      </MockExpectedShell>
    );
  }
  // drill
  const drillGrading = grading?.kind === 'drill' ? grading : null;
  return (
    <MockExpectedShell
      title="Expected answer"
      alreadyGraded={drillGrading}
      kind="drill"
      gradingText={drillGrading ? `${drillGrading.pointsAwarded} / 3` : null}
    >
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
        Required lookups
      </p>
      <ul className="mt-1 space-y-1 text-xs text-slate-200">
        {content.requiredLookups.map((lookup, index) => (
          <li key={`${lookup.documentId}:${lookup.sourceKey ?? index}`} className="flex flex-wrap items-center gap-1.5">
            <span>{index + 1}.</span>
            <span className="text-slate-400">{lookup.prompt}</span>
            <span className="font-mono text-[11px] text-sky-300">
              {EXAM_PREP_DOCUMENT_TITLES[lookup.documentId] ?? lookup.documentId}
              {lookup.sourceKey ? ` · ${examPrepProvisionLabel(lookup.sourceKey)}` : ''}
            </span>
            {lookup.sourceKey ? (
              <EXAM_PREP_OPEN_SOURCE_BUTTON
                documentId={lookup.documentId}
                sourceKey={lookup.sourceKey}
                label="Open"
                onOpenProvision={onOpenProvision}
              />
            ) : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-emerald-300">
        Required answer points
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-200">
        {content.requiredAnswerPoints.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      {content.trapExplanation ? (
        <p className="mt-2 text-[11px] italic text-amber-200/80">
          Trap: {content.trapExplanation}
        </p>
      ) : null}
      <DrillSelfAssessment
        key={questionId}
        grading={drillGrading}
        onSave={onDrillSave}
      />
    </MockExpectedShell>
  );
};

const gradingWasCorrect = (grading: ExamPrepMockQuestionGrading | null): boolean | null => {
  if (!grading) return null;
  return grading.kind === 'drill' ? null : grading.correct;
};

const CorrectIncorrectButtons = ({
  grading,
  onCorrect,
  onIncorrect,
}: {
  grading: ExamPrepMockQuestionGrading | null;
  onCorrect: () => void;
  onIncorrect: () => void;
}) => {
  const wasCorrect = gradingWasCorrect(grading);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onCorrect}
        className={`rounded border px-3 py-1.5 text-xs font-semibold ${
          wasCorrect === true
            ? 'border-emerald-500 bg-emerald-800 text-emerald-50'
            : 'border-emerald-700 bg-emerald-900 text-emerald-100 hover:bg-emerald-800'
        }`}
      >
        Correct
      </button>
      <button
        type="button"
        onClick={onIncorrect}
        className={`rounded border px-3 py-1.5 text-xs font-semibold ${
          wasCorrect === false
            ? 'border-rose-500 bg-rose-800 text-rose-50'
            : 'border-rose-700 bg-rose-900 text-rose-100 hover:bg-rose-800'
        }`}
      >
        Incorrect
      </button>
    </div>
  );
};

const DrillSelfAssessment = ({
  grading,
  onSave,
}: {
  grading: ExamPrepMockQuestionGrading | null;
  onSave: (
    _law: boolean,
    _provision: boolean,
    _substantive: boolean,
  ) => Promise<void>;
}) => {
  const [law, setLaw] = useState(Boolean(grading?.kind === 'drill' && grading.lawIdentified));
  const [provision, setProvision] = useState(
    Boolean(grading?.kind === 'drill' && grading.provisionLocated),
  );
  const [substantive, setSubstantive] = useState(
    Boolean(grading?.kind === 'drill' && grading.substantiveAnswerComplete),
  );
  const points = [law, provision, substantive].filter(Boolean).length;
  return (
    <div className="mt-3 rounded border border-slate-700 bg-slate-800/30 p-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
        Self-assessment
      </p>
      <div className="mt-1.5 space-y-1 text-xs text-slate-200">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={law} onChange={(event) => setLaw(event.target.checked)} />
          Identified correct law(s)
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={provision}
            onChange={(event) => setProvision(event.target.checked)}
          />
          Located controlling provision(s)
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={substantive}
            onChange={(event) => setSubstantive(event.target.checked)}
          />
          Gave substantively complete answer
        </label>
      </div>
      <button
        type="button"
        onClick={() => void onSave(law, provision, substantive)}
        className="mt-2 rounded border border-emerald-700 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-800"
      >
        Save self-score ({points}/3)
      </button>
    </div>
  );
};

const MockExpectedShell = ({
  title,
  alreadyGraded,
  gradingText,
  kind,
  children,
}: {
  title: string;
  alreadyGraded: ExamPrepMockQuestionGrading | null;
  gradingText: string | null;
  kind: string;
  children: ReactNode;
}) => (
  <div className="mt-3 rounded border border-sky-900/60 bg-sky-950/30 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-300">{title}</p>
      {alreadyGraded ? (
        <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-[11px] text-emerald-200">
          Graded · {gradingText}
        </span>
      ) : null}
    </div>
    {children}
    {kind === 'drill' ? null : (
      <p className="mt-2 text-[11px] italic text-slate-500">
        Compare your answer, then score yourself honestly.
      </p>
    )}
  </div>
);

const MockGradingPalette = ({
  session,
  currentIndex,
  onSelect,
}: {
  session: ExamPrepMockSession;
  currentIndex: number;
  onSelect: (_index: number) => void;
}) => (
  <div className="flex flex-wrap gap-1.5">
    {session.questions.map((question, index) => {
      const response = session.responses.find((entry) => entry.questionId === question.questionId);
      const graded = response?.grading !== null;
      const stateClass = index === currentIndex
        ? 'border-emerald-500 bg-emerald-900 text-emerald-50'
        : graded
          ? 'border-emerald-800 bg-emerald-950 text-emerald-300'
          : 'border-slate-800 bg-slate-900 text-slate-500';
      return (
        <button
          key={question.questionId}
          type="button"
          onClick={() => onSelect(index)}
          className={`h-8 w-8 rounded border text-xs ${stateClass}`}
        >
          {index + 1}
        </button>
      );
    })}
  </div>
);
