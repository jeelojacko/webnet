// Exam Prep — tabbed page (Home / Learn / Recall / Recognition / Locate /
// Lookup Drills).
//
// One shell renders all six Exam Prep views; StudyApp maps the routes
// /study/exam-prep, /study/learn, /study/review, /study/recognition,
// /study/locate and /study/drills to it and treats the legacy
// /study/exam-curriculum route as Learn. All persistence actions come from
// props (implemented by useStudyApp/useStudyExamPrep); UI-only
// session/card/reveal/textarea state stays in the views.

import { useEffect, useMemo, useState } from 'react';
import {
  ClipboardCheck,
  Compass,
  GraduationCap,
  Home,
  Library,
  LocateFixed,
  RotateCcw,
  Timer,
} from 'lucide-react';
import type { StudyDataSnapshot } from '../studyTypes';
import type { ExamPrepQueueItem } from './examPrepQueue';
import type {
  ExamPrepAttempt,
  ExamPrepRecallRating,
} from './examPrepTypes';
import { EXAM_PREP_MANIFEST } from './examPrepManifest';
import { buildExamPrepHomeMetrics } from './examPrepSelectors';
import { resolveExamPrepSettings } from './examPrepSettings';
import { ExamPrepHomeView } from './components/ExamPrepHome';
import { ExamPrepMockExamView } from './components/ExamPrepMockExam';
import { selectActiveMockSession } from './mock/examPrepMockSelectors';
import type {
  ExamPrepMockSession,
  ExamPrepMockSessionExpectation,
} from './mock/examPrepMockTypes';
import { ExamPrepLearnView } from './components/ExamPrepLearn';
import { ExamPrepRecallView } from './components/ExamPrepRecall';
import { ExamPrepRecognitionView } from './components/ExamPrepRecognition';
import { ExamPrepLocateView } from './components/ExamPrepLocate';
import { ExamPrepDrillsView } from './components/ExamPrepDrills';

export type ExamPrepViewKind =
  | 'home'
  | 'learn'
  | 'recall'
  | 'recognition'
  | 'locate'
  | 'drills'
  | 'mock';

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
  onSaveExamPrepAttempt: (_attempt: ExamPrepAttempt) => Promise<void>;
  onSaveExamPrepMockSession?: (
    _session: ExamPrepMockSession,
    _expectation: ExamPrepMockSessionExpectation,
  ) => Promise<void>;
  onLoadLegalDocumentComponentSummary?: (_documentId: string) => Promise<{
    documentId: string;
    componentCount: number;
    sectionCount: number;
    subsectionCount: number;
    scheduleCount: number;
    formCount: number;
    referenceOnlyFormCount: number;
  }>;
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
  { view: 'recognition', path: '/study/recognition', label: 'Recognition', icon: Compass },
  { view: 'locate', path: '/study/locate', label: 'Locate', icon: LocateFixed },
  { view: 'drills', path: '/study/drills', label: 'Lookup Drills', icon: Timer },
  { view: 'mock', path: '/study/mock-exam', label: 'Mock Exam', icon: ClipboardCheck },
];

export const ExamPrepPage = ({
  view,
  data,
  onNavigate,
  onOpenProvision,
  onToggleUnitStudied,
  onRateRecallTask,
  onSaveExamPrepAttempt,
  onSaveExamPrepMockSession,
  onLoadLegalDocumentComponentSummary,
}: ExamPrepPageProps) => {
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  useEffect(() => {
    const handle = window.setTimeout(() => setNowIso(new Date().toISOString()), 30_000);
    return () => window.clearTimeout(handle);
  }, [nowIso]);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const activeMock = useMemo(
    () => selectActiveMockSession(data.examPrepMockSessions),
    [data.examPrepMockSessions],
  );
  const focusedMock = view === 'mock' && activeMock !== null;
  const metrics = useMemo(
    () =>
      buildExamPrepHomeMetrics(
        data.examPrepUnitProgress,
        data.examPrepRecallProgress,
        now,
        data.examPrepAttempts,
      ),
    [data.examPrepAttempts, data.examPrepRecallProgress, data.examPrepUnitProgress, now],
  );
  const settings = useMemo(
    () =>
      resolveExamPrepSettings(
        data.examPrepSettings,
        {
          curriculumId: EXAM_PREP_MANIFEST.curriculumId,
          curriculumContentHash: EXAM_PREP_MANIFEST.contentHash,
        },
        nowIso,
      ),
    [data.examPrepSettings, nowIso],
  );
  const binding = useMemo(
    () => ({
      curriculumId: EXAM_PREP_MANIFEST.curriculumId,
      curriculumContentHash: EXAM_PREP_MANIFEST.contentHash,
    }),
    [],
  );
  return (
    <div className="space-y-5">
      {!focusedMock ? (
        <>
          <div>
            <div className="flex items-center gap-2">
              <GraduationCap className="text-emerald-400" size={20} />
              <h2 className="text-xl font-semibold text-white">Exam Prep</h2>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-slate-400">
              Study the open-book Statute Law curriculum: browse and mark the 133 A-D + Navigation
              units as studied, review 57 FSRS-scheduled recall cards, recognise which law applies
              from frozen cues, locate the correct statute or controlling provision, practise 24
              lookup drills, and run provisional timed mock exams.
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
        </>
      ) : null}
      {view === 'home' && (
        <ExamPrepHomeView
          metrics={metrics}
          unitProgress={data.examPrepUnitProgress}
          recallProgress={data.examPrepRecallProgress}
          attempts={data.examPrepAttempts}
          now={now}
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
      {view === 'recognition' && (
        <ExamPrepRecognitionView
          attempts={data.examPrepAttempts}
          onSaveExamPrepAttempt={onSaveExamPrepAttempt}
          onNavigate={onNavigate}
        />
      )}
      {view === 'locate' && (
        <ExamPrepLocateView
          attempts={data.examPrepAttempts}
          onSaveExamPrepAttempt={onSaveExamPrepAttempt}
          onOpenProvision={onOpenProvision}
          onNavigate={onNavigate}
          pickerLibraryData={data}
          onLoadLegalDocumentComponentSummary={onLoadLegalDocumentComponentSummary}
        />
      )}
      {view === 'drills' && (
        <ExamPrepDrillsView
          attempts={data.examPrepAttempts}
          onOpenProvision={onOpenProvision}
          onSaveDrillAttempt={onSaveExamPrepAttempt}
          onNavigate={onNavigate}
        />
      )}
      {view === 'mock' && (
        <ExamPrepMockExamView
          sessions={data.examPrepMockSessions}
          onSaveSession={
            onSaveExamPrepMockSession ??
            (async () => {
              throw new Error('Mock session persistence is not available.');
            })
          }
          onOpenProvision={onOpenProvision}
          onNavigate={onNavigate}
        />
      )}
      {view !== 'home' && !focusedMock ? (
        <p className="font-mono text-[10px] text-slate-600">
          {binding.curriculumId} · contentHash {binding.curriculumContentHash.slice(0, 16)}…
        </p>
      ) : null}
    </div>
  );
};
