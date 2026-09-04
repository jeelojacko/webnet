// Exam Prep — shared lookup drill card.
//
// Ported verbatim from the Exam Curriculum browser (ExamCurriculumPage
// LookupDrillCard) so the Lookup Drills tab and any legacy rendering share
// one implementation. Drills keep their frozen content and hide the answer
// key before Reveal; the timer freezes on Reveal and elapsed seconds format
// as M:SS (150 seconds renders "2:30").
//
// Phase 2 adds persistence: when `attempts` and `onSaveAttempt` are
// supplied, the card shows a per-drill readiness summary before Start and a
// self-assessment panel after Reveal. Saving is explicit (Save Result), once
// per run; Practice Again resets the local card for a new attempt.

import { useState, useRef, useEffect } from 'react';
import type { ExamCurriculumUnit } from '../../examCurriculum/examCurriculumTypes';
import type { ExamPrepAttempt, ExamPrepDrillAttempt } from '../examPrepTypes';
import { DRILL_DIFFICULTY_LABELS, formatExamDrillTime } from '../examPrepFormat';
import { buildExamPrepDrillStats } from '../examPrepDrillStats';
import { formatExamPrepLocalDate } from '../examPrepLocalDate';
import { buildDrillAttempt } from '../examPrepAttemptBuilders';
import { examPrepRelatedUnitTitle, examPrepUnitCardId } from '../examPrepRelatedUnits';
import {
  EXAM_PREP_DRILL_STATUS_LABELS,
  examPrepDrillReadinessReason,
  examPrepDrillTaskId,
} from '../examPrepDrillFilters';
import { EXAM_PREP_OPEN_SOURCE_BUTTON } from './examPrepBits';

export type ExamDrillCardProps = {
  unit: ExamCurriculumUnit;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  /** Current attempt history for this drill's readiness summary. */
  attempts?: ExamPrepAttempt[];
  onSaveAttempt?: (_attempt: ExamPrepDrillAttempt) => Promise<void>;
  /** SPA navigation to the Learn page (related-unit chips). */
  onNavigate?: (_path: string) => void;
};

const createAttemptId = (taskId: string): string =>
  `drill-attempt-${taskId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const ExamDrillCard = ({
  unit,
  onOpenProvision,
  attempts,
  onSaveAttempt,
  onNavigate,
}: ExamDrillCardProps) => {
  const [phase, setPhase] = useState<'start' | 'active' | 'reveal'>('start');
  const [elapsed, setElapsed] = useState(0);
  const [textareaValue, setTextareaValue] = useState('');
  const [lawIdentified, setLawIdentified] = useState(false);
  const [provisionLocated, setProvisionLocated] = useState(false);
  const [substantiveComplete, setSubstantiveComplete] = useState(false);
  const [savedRun, setSavedRun] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drill = unit.drill;

  const stats = attempts
    ? buildExamPrepDrillStats(attempts, examPrepDrillTaskId(unit.id))
    : null;
  const readinessReason = stats ? examPrepDrillReadinessReason(stats) : null;

  useEffect(() => {
    if (phase === 'active') {
      timerRef.current = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

  const handleReset = () => {
    setPhase('start');
    setElapsed(0);
    setTextareaValue('');
    setLawIdentified(false);
    setProvisionLocated(false);
    setSubstantiveComplete(false);
    setSavedRun(false);
    setSaveError(null);
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const handleSave = async () => {
    if (!drill || !onSaveAttempt || saving || savedRun) return;
    setSaving(true);
    setSaveError(null);
    const attempt = buildDrillAttempt({
      attemptId: createAttemptId(examPrepDrillTaskId(unit.id)),
      unitId: unit.id,
      taskId: examPrepDrillTaskId(unit.id),
      difficulty: drill.difficulty,
      answer: textareaValue,
      elapsedSeconds: elapsed, // frozen at Reveal
      targetSeconds: drill.timeTargetSeconds,
      lawIdentified,
      provisionLocated,
      substantiveAnswerComplete: substantiveComplete,
      practiceDate: formatExamPrepLocalDate(new Date()),
      completedAt: new Date().toISOString(),
    });
    try {
      await onSaveAttempt(attempt);
      setSavedRun(true);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'The drill result could not be saved.',
      );
    } finally {
      setSaving(false);
    }
  };

  if (!drill) return null;

  const score = [lawIdentified, provisionLocated, substantiveComplete].filter(Boolean).length;

  return (
    <section
      id={`exam-drill-${unit.id}`}
      className="rounded border border-emerald-800 bg-emerald-950 p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-emerald-300">{unit.id}</span>
        <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-emerald-200">
          lookup_drill
        </span>
        <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-[11px] text-emerald-300">
          DRILL
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          {DRILL_DIFFICULTY_LABELS[drill.difficulty]}
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          {formatExamDrillTime(drill.timeTargetSeconds)}
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          review: {unit.reviewWeight}
        </span>
      </div>
      <h4 className="mt-2 text-sm font-semibold text-white">{unit.title}</h4>
      {phase === 'start' && stats ? (
        <div className="mt-2 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
              Status: {EXAM_PREP_DRILL_STATUS_LABELS[stats.status]}
            </span>
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
              Attempts: {stats.attemptCount}
            </span>
            {stats.attemptCount > 0 ? (
              <>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                  Best correct: {stats.bestCorrectElapsedSeconds === null ? '—' : formatExamDrillTime(stats.bestCorrectElapsedSeconds)}
                </span>
                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                  Target: {formatExamDrillTime(drill.timeTargetSeconds)}
                </span>
                {stats.latestAttempt ? (
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
                    Latest: {stats.latestScore} / 3 · {formatExamDrillTime(stats.latestElapsedSeconds ?? 0)}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          {readinessReason ? (
            <p className="text-[11px] italic text-slate-400">{readinessReason}</p>
          ) : null}
        </div>
      ) : null}
      {phase === 'start' && (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-emerald-100/70">
            Open-book lookup drill. Click Start to begin.
          </p>
          <button
            type="button"
            onClick={() => {
              setElapsed(0);
              setSavedRun(false);
              setSaveError(null);
              setPhase('active');
            }}
            className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-800"
          >
            Start
          </button>
        </div>
      )}
      {phase === 'active' && (
        <div className="mt-2 space-y-1.5 text-xs text-emerald-100/90">
          <div>
            <span className="font-semibold uppercase tracking-wide text-emerald-400">
              Fact pattern
            </span>
            <p className="mt-0.5">{drill.factPattern}</p>
          </div>
          <div>
            <span className="font-semibold uppercase tracking-wide text-emerald-400">Task</span>
            <p className="mt-0.5">{drill.task}</p>
          </div>
          <div className="rounded border border-emerald-900/60 bg-emerald-900/30 p-2">
            <span className="font-semibold uppercase tracking-wide text-emerald-300">
              Time: {formatExamDrillTime(elapsed)}
            </span>
            <textarea
              value={textareaValue}
              onChange={(event) => setTextareaValue(event.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 p-1.5 text-xs text-slate-200"
              rows={3}
              placeholder="Type your answer here..."
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setPhase('reveal');
                if (timerRef.current) clearInterval(timerRef.current);
              }}
              className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-800"
            >
              Reveal ({formatExamDrillTime(elapsed)})
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
            >
              Reset
            </button>
          </div>
        </div>
      )}
      {phase === 'reveal' && (
        <div className="mt-2 space-y-1.5 text-xs text-emerald-100/90">
          <div className="rounded border border-emerald-900/60 bg-emerald-900/30 p-2">
            <span className="font-semibold uppercase tracking-wide text-emerald-300">
              Time frozen: {formatExamDrillTime(elapsed)}
            </span>
          </div>
          <div className="rounded border border-emerald-900/60 bg-emerald-900/30 p-2">
            <span className="font-semibold uppercase tracking-wide text-emerald-300">Route</span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {drill.answerKey.requiredLookups.map((lookup, index) => (
                <li key={index}>
                  {lookup.prompt}
                  {lookup.sourceKey ? (
                    <EXAM_PREP_OPEN_SOURCE_BUTTON
                      documentId={lookup.documentId}
                      sourceKey={lookup.sourceKey}
                      label={lookup.sourceKey.split(':').pop() ?? lookup.sourceKey}
                      onOpenProvision={onOpenProvision}
                      newTab
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded border border-emerald-900/60 bg-emerald-900/30 p-2">
            <span className="font-semibold uppercase tracking-wide text-emerald-300">
              Answer points
            </span>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {drill.answerKey.requiredAnswerPoints.map((point, index) => (
                <li key={index}>{point}</li>
              ))}
            </ul>
          </div>
          {drill.answerKey.trapExplanation && (
            <div className="rounded border border-amber-900/60 bg-amber-950/30 p-2">
              <span className="font-semibold uppercase tracking-wide text-amber-300">Trap</span>
              <p className="mt-1 text-xs italic text-amber-100/80">
                {drill.answerKey.trapExplanation}
              </p>
            </div>
          )}
          {unit.relatedUnitIds.length > 0 && (
            <div className="rounded border border-slate-700 bg-slate-800/50 p-2">
              <span className="font-semibold uppercase tracking-wide text-slate-400">
                Related units
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {unit.relatedUnitIds.map((relatedId) => (
                  <button
                    key={relatedId}
                    type="button"
                    onClick={() => onNavigate?.(`/study/learn#${examPrepUnitCardId(relatedId)}`)}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-sky-200 hover:border-sky-600 hover:bg-sky-950"
                    title={`Open related unit ${relatedId} in Learn`}
                  >
                    <span className="font-mono text-[10px] text-sky-400">{relatedId}</span>
                    <span className="truncate">{examPrepRelatedUnitTitle(relatedId)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {onSaveAttempt ? (
            <div className="rounded border border-slate-700 bg-slate-800/50 p-2 space-y-1.5">
              <span className="font-semibold uppercase tracking-wide text-slate-300">
                How did you do?
              </span>
              <label className="flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={lawIdentified}
                  disabled={savedRun}
                  onChange={(event) => setLawIdentified(event.target.checked)}
                />
                Identified the correct law(s)
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={provisionLocated}
                  disabled={savedRun}
                  onChange={(event) => setProvisionLocated(event.target.checked)}
                />
                Located the controlling provision(s)
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-200">
                <input
                  type="checkbox"
                  checked={substantiveComplete}
                  disabled={savedRun}
                  onChange={(event) => setSubstantiveComplete(event.target.checked)}
                />
                Gave a substantively complete answer
              </label>
              <p className="text-[11px] text-slate-400">Score: {score} / 3</p>
              {saveError ? (
                <div
                  role="alert"
                  className="rounded border border-rose-900/60 bg-rose-950/40 p-2 text-xs text-rose-200"
                >
                  {saveError}
                </div>
              ) : null}
              {savedRun ? (
                <p className="text-xs font-semibold text-emerald-300">Result saved.</p>
              ) : (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  className="rounded border border-emerald-600 bg-emerald-900 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-800"
                >
                  Save Result
                </button>
              )}
            </div>
          ) : null}
          <button
            type="button"
            onClick={handleReset}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            Practice Again
          </button>
        </div>
      )}
    </section>
  );
};
