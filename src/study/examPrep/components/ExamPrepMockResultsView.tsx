// Exam Prep Mock — read-only results + per-question review.
//
// Shows the practice score (never "grade"/"pass"/"fail" for provisional
// profiles), the type breakdown, the time used, and a full question review
// with the learner's answer, the frozen expected answer, and the self-score.
// The same component renders abandoned sessions as read-only responses (no
// score) without enabling any grading.

import { useMemo } from 'react';
import { EXAM_PREP_DOCUMENT_TITLES } from '../examPrepDocTitles';
import { examPrepProvisionLabel, EXAM_PREP_MOCK_KIND_LABELS, formatExamMockClock } from '../examPrepFormat';
import { EXAM_PREP_OPEN_SOURCE_BUTTON } from './examPrepBits';
import { resolveExamPrepMockQuestionContent } from '../mock/examPrepMockQuestionContent';
import {
  buildMockScore,
  buildMockTypeBreakdown,
  mockTimeUsedSeconds,
  type ExamPrepMockKindScore,
} from '../mock/examPrepMockResults';
import type { ExamPrepMockQuestionGrading, ExamPrepMockSession } from '../mock/examPrepMockTypes';

export type ExamPrepMockResultsViewProps = {
  session: ExamPrepMockSession;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
};

const gradingPoints = (grading: ExamPrepMockQuestionGrading): number => grading.pointsAwarded;

export const ExamPrepMockResultsView = ({
  session,
  onOpenProvision,
}: ExamPrepMockResultsViewProps) => {
  const score = buildMockScore(session);
  const breakdown = buildMockTypeBreakdown(session);
  const timeUsedSeconds = mockTimeUsedSeconds(session);
  const timeAvailable = formatExamMockClock(session.profileSnapshot.durationMinutes * 60);
  const abandoned = session.status === 'abandoned';

  return (
    <div className="space-y-4">
      <header className="rounded border border-slate-800 bg-slate-900/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {abandoned ? 'Mock Exam · abandoned' : 'Mock Exam Result'}
            </div>
            <h3 className="mt-0.5 text-lg font-semibold text-white">
              {session.profileSnapshot.title}
            </h3>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>
              Profile <span className="font-mono text-sky-300">{session.profileId}</span>
            </div>
            <div>
              Status{' '}
              <span className="capitalize text-slate-300">
                {session.status === 'graded' ? 'Graded' : abandoned ? 'Abandoned' : 'Submitted'}
              </span>
            </div>
          </div>
        </div>
        {abandoned ? (
          <p className="mt-2 rounded border border-rose-900/60 bg-rose-950/40 p-2 text-xs text-rose-200">
            This mock was abandoned. Saved responses remain available below, but the exam received
            no score.
          </p>
        ) : (
          <p className="mt-1 text-[11px] italic text-slate-500">
            No official pass mark is configured for this provisional profile.
          </p>
        )}
      </header>

      {!abandoned ? (
        <>
          <section className="rounded border border-emerald-800 bg-emerald-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-wide text-emerald-400">
                  Practice score
                </div>
                <div className="mt-1 text-3xl font-semibold text-emerald-100">
                  {score.points} / {score.totalPoints}
                  {score.percent !== null ? (
                    <span className="ml-2 text-lg text-emerald-300">{score.percent}%</span>
                  ) : null}
                </div>
              </div>
              <div className="text-xs text-slate-300">
                <div>
                  Time used <span className="font-mono">{formatExamMockClock(timeUsedSeconds)}</span> /{' '}
                  {timeAvailable}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  {score.percent !== null ? (
                    <span>
                      {score.percent}% is a practice score for this provisional profile — no
                      official pass mark exists yet.
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <ScoreCard label="Recall" score={breakdown.recall} />
              <ScoreCard label="Recognition" score={breakdown.recognition} />
              <ScoreCard label="Locate" score={breakdown.locate} />
              <ScoreCard label="Lookup Drills" score={breakdown.drill} />
            </div>
          </section>

          <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Question review
            </h4>
            <p className="mt-1 text-[11px] text-slate-600">
              Wrong or partial questions are highlighted for review. Source links open the statute
              reader.
            </p>
            <div className="mt-2 space-y-2">
              {session.questions.map((question, index) => (
                <ReviewRow
                  key={question.questionId}
                  session={session}
                  index={index}
                  onOpenProvision={onOpenProvision}
                />
              ))}
            </div>
          </section>
        </>
      ) : (
        <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Saved responses
          </h4>
          <div className="mt-2 space-y-2">
            {session.questions.map((question, index) => (
              <details key={question.questionId} className="rounded border border-slate-800 bg-slate-900/60 p-2 text-xs">
                <summary className="cursor-pointer text-slate-300">
                  Question {index + 1} · {EXAM_PREP_MOCK_KIND_LABELS[question.kind]}
                </summary>
                <p className="mt-1.5 whitespace-pre-wrap text-slate-200">
                  {questionResponseText(session, question.questionId)}
                </p>
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const ScoreCard = ({ label, score }: { label: string; score: ExamPrepMockKindScore }) => (
  <div className="rounded border border-slate-800 bg-slate-900 p-2">
    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-0.5 text-sm font-semibold text-white">
      {score.earned} / {score.possible}
    </div>
    <div className="text-[11px] text-slate-500">
      {score.correct} of {score.total} {score.kind === 'drill' ? 'drills' : 'questions'} correct /
      complete
    </div>
  </div>
);

const ReviewRow = ({
  session,
  index,
  onOpenProvision,
}: {
  session: ExamPrepMockSession;
  index: number;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
}) => {
  const question = session.questions[index];
  const response = session.responses.find((entry) => entry.questionId === question?.questionId);
  const grading = response?.grading ?? null;
  const content = useMemo(
    () => (question ? resolveExamPrepMockQuestionContent(question) : null),
    [question],
  );
  if (!question || !response || !content) return null;
  const correct = grading === null ? null : gradingPoints(grading) >= (grading.kind === 'drill' ? 1 : 1);
  const fullyCorrect =
    grading === null ? false : grading.kind === 'drill' ? grading.pointsAwarded === 3 : grading.correct;
  const chipClass = grading === null
    ? 'bg-slate-800 text-slate-400'
    : fullyCorrect
      ? 'bg-emerald-900 text-emerald-200'
      : 'bg-rose-900/70 text-rose-200';
  const label = grading === null ? 'Not graded' : grading.kind === 'drill'
    ? `${grading.pointsAwarded} / 3`
    : grading.correct ? '1 / 1' : '0 / 1';
  return (
    <details className="rounded border border-slate-800 bg-slate-900/60 p-2 text-xs">
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
        <span className="text-slate-300">
          Question {index + 1} · {EXAM_PREP_MOCK_KIND_LABELS[question.kind]}
          <span className="ml-1 text-slate-500">({question.sourceTaskId})</span>
        </span>
        <span className={`rounded px-1.5 py-0.5 ${chipClass}`}>{label}</span>
      </summary>
      <div className="mt-2 space-y-2">
        <p className="whitespace-pre-wrap text-slate-100">
          <span className="font-semibold text-slate-400">Question:</span>{' '}
          {expectedTextSummary(content, question.kind)}
        </p>
        <p className="whitespace-pre-wrap text-slate-200">
          <span className="font-semibold text-slate-400">Your answer:</span>{' '}
          {response.answer.trim() ? response.answer : '(no answer)'}
        </p>
        <ExpectedSummary content={content} onOpenProvision={onOpenProvision} />
        {correct !== null ? (
          <p className={fullyCorrect ? 'text-emerald-300' : 'text-rose-300'}>
            {fullyCorrect ? 'Self-scored correct.' : 'Self-scored wrong or partial — review the expected answer above.'}
          </p>
        ) : null}
      </div>
    </details>
  );
};

const expectedTextSummary = (
  content: ReturnType<typeof resolveExamPrepMockQuestionContent>,
  kind: string,
): string => {
  switch (content.kind) {
    case 'recall':
      return content.prompt;
    case 'recognition':
      return content.cue;
    case 'locate':
      return content.prompt;
    case 'drill':
      return `${content.factPattern} ${content.task}`.trim();
    default:
      return kind;
  }
};

const ExpectedSummary = ({
  content,
  onOpenProvision,
}: {
  content: ReturnType<typeof resolveExamPrepMockQuestionContent>;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
}) => {
  if (content.kind === 'recall') {
    return (
      <p className="whitespace-pre-wrap text-emerald-100">
        <span className="font-semibold text-emerald-400">Expected rule:</span> {content.expectedAnswer}
      </p>
    );
  }
  if (content.kind === 'recognition') {
    return (
      <p className="whitespace-pre-wrap text-emerald-100">
        <span className="font-semibold text-emerald-400">Expected topic:</span>{' '}
        <span className="font-mono text-sky-300">{content.unitId}</span> {content.unitTitle}
        {content.expectedDocumentIds.length > 0
          ? ` · ${content.expectedDocumentIds
              .map((id) => EXAM_PREP_DOCUMENT_TITLES[id] ?? id)
              .join(', ')}`
          : ''}
      </p>
    );
  }
  if (content.kind === 'locate') {
    const location = `${EXAM_PREP_DOCUMENT_TITLES[content.expectedDocumentId] ?? content.expectedDocumentId}${
      content.expectedSourceKey ? ` ${examPrepProvisionLabel(content.expectedSourceKey)}` : ''
    }`;
    return (
      <p className="whitespace-pre-wrap text-emerald-100">
        <span className="font-semibold text-emerald-400">Expected location:</span> {location}
        {content.expectedSourceKey ? (
          <>
            {' '}
            <EXAM_PREP_OPEN_SOURCE_BUTTON
              documentId={content.expectedDocumentId}
              sourceKey={content.expectedSourceKey}
              label="Open"
              onOpenProvision={onOpenProvision}
            />
          </>
        ) : (
          <span className="ml-1 italic text-slate-500">
            — Document-level target — no single provision is pinned.
          </span>
        )}
      </p>
    );
  }
  return (
    <div className="space-y-1 text-emerald-100">
      <p>
        <span className="font-semibold text-emerald-400">Required lookups:</span>
      </p>
      <ul className="list-disc space-y-0.5 pl-4">
        {content.requiredLookups.map((lookup, index) => (
          <li key={`${lookup.documentId}:${lookup.sourceKey ?? index}`}>
            {lookup.prompt} — {EXAM_PREP_DOCUMENT_TITLES[lookup.documentId] ?? lookup.documentId}
            {lookup.sourceKey ? ` ${examPrepProvisionLabel(lookup.sourceKey)}` : ''}
          </li>
        ))}
      </ul>
      <p>
        <span className="font-semibold text-emerald-400">Answer points:</span>{' '}
        {content.requiredAnswerPoints.join(' · ')}
      </p>
    </div>
  );
};

const questionResponseText = (session: ExamPrepMockSession, questionId: string): string => {
  const response = session.responses.find((entry) => entry.questionId === questionId);
  return response && response.answer.trim()
    ? response.answer
    : '(no answer)';
};
