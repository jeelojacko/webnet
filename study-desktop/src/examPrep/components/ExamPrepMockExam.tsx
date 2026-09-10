// Exam Prep Mock — mock-exam page (landing / history / focused exam /
// self-grading / results).
//
// One route (/study/mock-exam) hosts the whole flow. While a current mock is
// `in_progress` the focused answering UI takes over (the Exam Prep tab bar is
// hidden by ExamPrepPage). Otherwise this view shows the provisional profile
// landing screen and recent current-binding history (graded results, grading
// in progress, abandoned).

import { useMemo, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import { formatExamMockClock } from '../examPrepFormat';
import { currentExamPrepBinding, EXAM_PREP_MANIFEST } from '../examPrepManifest';
import { EXAM_PREP_DEFAULT_MOCK_PROFILE } from '../mock/examPrepMockProfiles';
import { buildExamPrepMockPaper } from '../mock/examPrepMockPaper';
import { randomMockSeed } from '../mock/examPrepMockRandom';
import { createExamPrepMockSession, examPrepMockLocalId, examPrepMockSessionId } from '../mock/examPrepMockSession';
import {
  selectActiveMockSession,
  selectAbandonedMockSessions,
  selectCurrentMockSessions,
  selectDuplicateActiveMockSessions,
  selectRecentMockResults,
} from '../mock/examPrepMockSelectors';
import { isMockFullyGraded, mockGradedCount, buildMockScore, mockTimeUsedSeconds } from '../mock/examPrepMockResults';
import type { ExamPrepMockSession } from '../mock/examPrepMockTypes';
import type { SaveExamPrepMockSession } from './ExamPrepMockActive';
import { ExamPrepMockActive } from './ExamPrepMockActive';
import { ExamPrepMockGrading } from './ExamPrepMockGrading';
import { ExamPrepMockResultsView } from './ExamPrepMockResultsView';

export type ExamPrepMockExamViewProps = {
  sessions: ExamPrepMockSession[];
  onSaveSession: SaveExamPrepMockSession;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  onNavigate: (_path: string) => void;
};

const kindCountRows = [
  { key: 'recall', label: 'Recall', note: '1 point each' },
  { key: 'recognition', label: 'Recognition', note: '1 point each' },
  { key: 'locate', label: 'Locate', note: '1 point each' },
  { key: 'drill', label: 'Applied lookup drills', note: '3 points each' },
] as const;

const formatHistoryDate = (iso: string): string => iso.slice(0, 10);

export const ExamPrepMockExamView = ({
  sessions,
  onSaveSession,
  onOpenProvision,
  onNavigate,
}: ExamPrepMockExamViewProps) => {
  const active = selectActiveMockSession(sessions);
  const duplicates = selectDuplicateActiveMockSessions(sessions);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const focused = useMemo(
    () => (focusId ? sessions.find((session) => session.id === focusId) ?? null : null),
    [focusId, sessions],
  );

  if (active) {
    return (
      <div className="space-y-3">
        {duplicates.length > 0 ? (
          <div
            role="alert"
            className="rounded border border-amber-900/60 bg-amber-950/40 p-2 text-xs text-amber-200"
          >
            More than one in-progress mock was found. Resuming the most recently started one.
          </div>
        ) : null}
        <ExamPrepMockActive
          session={active}
          onSaveSession={onSaveSession}
          onNavigate={onNavigate}
        />
      </div>
    );
  }

  if (focused && focused.status === 'submitted') {
    return (
      <ExamPrepMockGrading
        session={focused}
        onSaveSession={onSaveSession}
        onOpenProvision={onOpenProvision}
      />
    );
  }

  if (focused && (focused.status === 'graded' || focused.status === 'abandoned')) {
    return <ExamPrepMockResultsView session={focused} onOpenProvision={onOpenProvision} />;
  }

  return (
    <div className="space-y-4">
      {startError ? (
        <div
          role="alert"
          className="rounded border border-rose-900/60 bg-rose-950/40 p-2 text-xs text-rose-200"
        >
          {startError}
        </div>
      ) : null}

      <section className="rounded border border-amber-800/60 bg-amber-950/20 p-4">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="text-amber-300" size={18} />
          <h3 className="text-base font-semibold text-white">Provisional Mock Exam</h3>
        </div>
        <p className="mt-2 max-w-3xl text-xs text-slate-300">
          This simulator is based on the exam information currently available. The registrar has
          not yet confirmed the final question format, resource rules, or pass mark.
        </p>

        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <ProfileStat label="Duration" value={`${EXAM_PREP_DEFAULT_MOCK_PROFILE.durationMinutes} minutes`} />
          <ProfileStat
            label="Questions"
            value={String(
              EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts.recall +
                EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts.recognition +
                EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts.locate +
                EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts.drill,
            )}
          />
          <ProfileStat label="Self-assessed points" value={String(
            EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts.recall +
              EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts.recognition +
              EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts.locate +
              EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts.drill * 3,
          )} />
          <ProfileStat label="Pass mark" value="Not configured" />
        </div>

        <div className="mt-3 space-y-1 text-xs text-slate-300">
          {kindCountRows.map((row) => (
            <div key={row.key} className="flex flex-wrap gap-1.5">
              <span className="w-44 font-semibold text-slate-200">
                {EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts[row.key]} × {row.label}
              </span>
              <span className="text-slate-500">
                {row.note} · {EXAM_PREP_DEFAULT_MOCK_PROFILE.questionCounts[row.key]} questions
              </span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-300">
          <span className="rounded bg-slate-800 px-2 py-1">
            {EXAM_PREP_DEFAULT_MOCK_PROFILE.resources.openBook ? 'Open-book' : 'Closed-book'}
          </span>
          <span className="rounded bg-slate-800 px-2 py-1">
            {EXAM_PREP_DEFAULT_MOCK_PROFILE.resources.builtInStatuteLibrary
              ? 'Built-in statute library enabled'
              : 'No built-in statute library'}
          </span>
        </div>

        <ul className="mt-3 list-disc space-y-0.5 pl-4 text-[11px] text-slate-500">
          {EXAM_PREP_DEFAULT_MOCK_PROFILE.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void startNewMock(setFocusId, setStartError, onSaveSession)}
            className="rounded border border-amber-600 bg-amber-900 px-4 py-2 text-sm font-semibold text-amber-50 hover:bg-amber-800"
          >
            Start New Mock
          </button>
          <button
            type="button"
            onClick={() => onNavigate('/study/learn')}
            className="rounded border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-slate-200 hover:bg-slate-700"
          >
            Browse Learn units
          </button>
        </div>
        <p className="mt-3 text-[11px] italic text-slate-600">
          Mock practice is separate from your Learn/Recall/Recognition/Locate/Drill records — it
          never updates FSRS or training attempts.
        </p>
      </section>

      <MockHistory
        sessions={sessions}
        onFocus={setFocusId}
      />

      <p className="font-mono text-[10px] text-slate-600">
        {EXAM_PREP_MANIFEST.curriculumId} · contentHash{' '}
        {EXAM_PREP_MANIFEST.contentHash.slice(0, 16)}…
      </p>
    </div>
  );
};

const startNewMock = async (
  setFocusId: (_id: string) => void,
  setStartError: (_message: string | null) => void,
  onSaveSession: SaveExamPrepMockSession,
): Promise<void> => {
  const profile = EXAM_PREP_DEFAULT_MOCK_PROFILE;
  const seed = randomMockSeed();
  const paper = buildExamPrepMockPaper({ profile, seed });
  const binding = currentExamPrepBinding();
  const id = examPrepMockSessionId(binding, examPrepMockLocalId());
  const session = createExamPrepMockSession({
    id,
    binding,
    profile,
    seed,
    paper,
    nowIso: new Date().toISOString(),
  });
  setStartError(null);
  setFocusId(id);
  try {
    await onSaveSession(session, { kind: 'absent' });
  } catch (error) {
    setStartError(
      error instanceof Error
        ? error.message
        : 'Could not start the mock exam. Another mock may already be in progress.',
    );
  }
};

const MockHistory = ({
  sessions,
  onFocus,
}: {
  sessions: ExamPrepMockSession[];
  onFocus: (_id: string) => void;
}) => {
  const recent = selectRecentMockResults(selectCurrentMockSessions(sessions), 10);
  const abandoned = selectAbandonedMockSessions(sessions);
  if (recent.length === 0 && abandoned.length === 0) {
    return (
      <section className="rounded border border-slate-800 bg-slate-900/60 p-3 text-xs text-slate-500">
        No mock exams yet. Start one above when you are ready for a timed practice run.
      </section>
    );
  }
  return (
    <div className="space-y-3">
      {recent.length > 0 ? (
        <section className="rounded border border-slate-800 bg-slate-900/70 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Recent Mock Exams
          </h4>
          <div className="mt-2 space-y-1.5">
            {recent.map((session) => (
              <HistoryRow key={session.id} session={session} onFocus={onFocus} />
            ))}
          </div>
        </section>
      ) : null}
      {abandoned.length > 0 ? (
        <section className="rounded border border-slate-800 bg-slate-900/40 p-3">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Abandoned
          </h4>
          <div className="mt-2 space-y-1.5">
            {abandoned.slice(0, 10).map((session) => (
              <HistoryRow key={session.id} session={session} onFocus={onFocus} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
};

const HistoryRow = ({
  session,
  onFocus,
}: {
  session: ExamPrepMockSession;
  onFocus: (_id: string) => void;
}) => {
  const graded = session.status === 'graded';
  const submitted = session.status === 'submitted';
  const abandoned = session.status === 'abandoned';
  const score = buildMockScore(session);
  const gradedCount = mockGradedCount(session);
  const fullyGraded = isMockFullyGraded(session);
  const timeUsedSeconds = mockTimeUsedSeconds(session);
  let summary: string;
  if (graded) {
    summary = `${score.points} / ${score.totalPoints} · ${score.percent ?? 0}%`;
  } else if (submitted) {
    summary = fullyGraded ? 'Graded — ready to finalize' : `Grading incomplete · ${gradedCount} of ${session.questions.length} graded`;
  } else {
    summary = 'No score — abandoned';
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/60 p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-slate-300">
        <span className="font-mono text-sky-300">{formatHistoryDate(session.startedAt)}</span>
        <span className="text-slate-500">{session.profileId}</span>
        <span>{summary}</span>
        {graded ? (
          <span className="font-mono text-slate-500">
            {formatExamMockClock(timeUsedSeconds)}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onFocus(session.id)}
        className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
      >
        {graded ? 'View results' : abandoned ? 'View responses' : 'Continue Grading'}
      </button>
    </div>
  );
};

const ProfileStat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded border border-slate-800 bg-slate-900/80 p-2">
    <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
    <div className="mt-0.5 font-semibold text-slate-100">{value}</div>
  </div>
);
