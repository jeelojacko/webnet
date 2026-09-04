// Exam Prep — tabbed page (Home / Learn / Recall / Lookup Drills).
//
// One shell renders all four Exam Prep views; StudyApp maps the routes
// /study/exam-prep, /study/learn, /study/review and /study/drills to it and
// treats the legacy /study/exam-curriculum route as Learn. All persistence
// actions come from props (implemented by useStudyApp/useStudyExamPrep);
// UI-only session/card/reveal/textarea state stays in the views.

import { useEffect, useMemo, useState } from 'react';
import { GraduationCap, Home, Library, RotateCcw, Timer } from 'lucide-react';
import type { StudyDataSnapshot } from '../studyTypes';
import type { ExamPrepQueueItem } from './examPrepQueue';
import type { ExamPrepRecallRating } from './examPrepTypes';
import { EXAM_PREP_MANIFEST } from './examPrepManifest';
import { buildExamPrepHomeMetrics } from './examPrepSelectors';
import { resolveExamPrepSettings } from './examPrepSettings';
import { ExamPrepHomeView } from './components/ExamPrepHome';
import { ExamPrepLearnView } from './components/ExamPrepLearn';
import { ExamPrepRecallView } from './components/ExamPrepRecall';
import { ExamPrepDrillsView } from './components/ExamPrepDrills';

export type ExamPrepViewKind = 'home' | 'learn' | 'recall' | 'drills';

export type ExamPrepPageProps = {
  view: ExamPrepViewKind;
  data: StudyDataSnapshot;
  onNavigate: (_path: string) => void;
  onOpenProvision: (_documentId: string, _sourceKey: string) => void;
  onToggleUnitStudied: (_unitId: string) => Promise<void>;
  onRateRecallTask: (_options: {
    item: ExamPrepQueueItem;
    rating: ExamPrepRecallRating;
    now: Date;
    answer?: string;
  }) => Promise<void>;
};

const TABS: Array<{
  view: ExamPrepViewKind;
  path: string;
  label: string;
  icon: typeof Home;
}> = [
  { view: 'home', path: '/study/exam-prep', label: 'Home', icon: Home },
  { view: 'learn', path: '/study/learn', label: 'Learn', icon: Library },
  { view: 'recall', path: '/study/review', label: 'Recall', icon: RotateCcw },
  { view: 'drills', path: '/study/drills', label: 'Lookup Drills', icon: Timer },
];

export const ExamPrepPage = ({
  view,
  data,
  onNavigate,
  onOpenProvision,
  onToggleUnitStudied,
  onRateRecallTask,
}: ExamPrepPageProps) => {
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  useEffect(() => {
    const handle = window.setTimeout(() => setNowIso(new Date().toISOString()), 30_000);
    return () => window.clearTimeout(handle);
  }, [nowIso]);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const metrics = useMemo(
    () =>
      buildExamPrepHomeMetrics(data.examPrepUnitProgress, data.examPrepRecallProgress, now),
    [data.examPrepRecallProgress, data.examPrepUnitProgress, now],
  );
  const settings = useMemo(
    () => resolveExamPrepSettings(data.examPrepSettings, {
      curriculumId: EXAM_PREP_MANIFEST.curriculumId,
      curriculumContentHash: EXAM_PREP_MANIFEST.contentHash,
    }, nowIso),
    [data.examPrepSettings, nowIso],
  );
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <GraduationCap className="text-emerald-400" size={20} />
          <h2 className="text-xl font-semibold text-white">Exam Prep</h2>
        </div>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Study the open-book Statute Law curriculum: browse and mark the 133 A-D + Navigation
          units as studied, review 57 FSRS-scheduled recall cards, and practise 24 lookup
          drills (session-only).
        </p>
      </div>
      <div className="flex flex-wrap gap-2 border-b border-slate-800 pb-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = view === tab.view;
          return (
            <button
              key={tab.view}
              type="button"
              onClick={() => onNavigate(tab.path)}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${
                active
                  ? 'bg-emerald-900/60 text-emerald-100'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>
      {view === 'home' && (
        <ExamPrepHomeView
          metrics={metrics}
          unitProgress={data.examPrepUnitProgress}
          newRecallCardsPerSession={settings.newRecallCardsPerSession}
          maxRecallCardsPerSession={settings.maxRecallCardsPerSession}
          onNavigate={onNavigate}
        />
      )}
      {view === 'learn' && (
        <ExamPrepLearnView
          unitProgress={data.examPrepUnitProgress}
          onOpenProvision={onOpenProvision}
          onToggleUnitStudied={onToggleUnitStudied}
        />
      )}
      {view === 'recall' && (
        <ExamPrepRecallView
          data={data}
          onRateRecallTask={onRateRecallTask}
          onNavigate={onNavigate}
        />
      )}
      {view === 'drills' && <ExamPrepDrillsView onOpenProvision={onOpenProvision} />}
    </div>
  );
};
