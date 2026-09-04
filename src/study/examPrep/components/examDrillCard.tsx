// Exam Prep — shared lookup drill card.
//
// Ported verbatim from the Exam Curriculum browser (ExamCurriculumPage
// LookupDrillCard) so the Lookup Drills tab and any legacy rendering share
// one implementation. Drills are intentionally session-only: nothing here is
// persisted. The timer freezes on Reveal and formats elapsed seconds as
// M:SS (150 seconds renders "2:30"). Expected answers never appear before
// Reveal.

import { useState, useRef, useEffect } from 'react';
import type { ExamCurriculumUnit } from '../../examCurriculum/examCurriculumTypes';
import { DRILL_DIFFICULTY_LABELS, formatExamDrillTime } from '../examPrepFormat';
import { EXAM_PREP_OPEN_SOURCE_BUTTON } from './examPrepBits';

export type ExamDrillCardProps = {
  unit: ExamCurriculumUnit;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
};

export const ExamDrillCard = ({ unit, onOpenProvision }: ExamDrillCardProps) => {
  const [phase, setPhase] = useState<'start' | 'active' | 'reveal'>('start');
  const [elapsed, setElapsed] = useState(0);
  const [textareaValue, setTextareaValue] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const drill = unit.drill;

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
    if (timerRef.current) clearInterval(timerRef.current);
  };

  if (!drill) return null;

  return (
    <section className="rounded border border-emerald-800 bg-emerald-950 p-3">
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
          {drill.timeTargetSeconds}s
        </span>
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400">
          review: {unit.reviewWeight}
        </span>
      </div>
      <h4 className="mt-2 text-sm font-semibold text-white">{unit.title}</h4>
      {phase === 'start' && (
        <div className="mt-2 space-y-1.5">
          <p className="text-xs text-emerald-100/70">
            Open-book lookup drill. Click Start to begin.
          </p>
          <button
            type="button"
            onClick={() => {
              setElapsed(0);
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
              <span className="font-semibold uppercase tracking-wide text-slate-400">Related</span>
              <p className="mt-1 font-mono text-[11px] text-slate-300">
                {unit.relatedUnitIds.join(', ')}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={handleReset}
            className="rounded border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700"
          >
            Reset
          </button>
        </div>
      )}
    </section>
  );
};
