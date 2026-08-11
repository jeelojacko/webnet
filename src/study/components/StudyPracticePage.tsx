import { useMemo, useState } from 'react';
import {
  buildStudySessionItemForUnit,
  responseModeForStudyItem,
  sourceTextForStudyItem,
} from '../studySessionItems';
import type {
  StudyDataSnapshot,
  StudyRating,
  StudyRubricCoverage,
  StudySessionItem,
} from '../studyTypes';
import { StudyEmptyState } from './StudyLayout';
import StudySessionPage from './StudySessionPage';

type StudyPracticeMode = 'manual-practice' | 'surprise-practice';

type StudyPracticePageProps = {
  data: StudyDataSnapshot;
  unitId: string | null;
  mode: StudyPracticeMode;
  onSavePracticeAttempt: (_options: {
    item: StudySessionItem;
    rating: StudyRating;
    reason: StudyPracticeMode;
    answer: string;
    guidedResponses: Record<string, string>;
    responseMode: ReturnType<typeof responseModeForStudyItem>;
    coveredConceptIds: string[];
    rubricCoverage: StudyRubricCoverage[];
    revealedAt: string;
    startedAt: string;
    countScheduling?: boolean;
  }) => Promise<void>;
  onNavigate: (_path: string) => void;
};

const modeText: Record<StudyPracticeMode, { empty: string; title: string }> = {
  'manual-practice': {
    empty: 'No study unit is available for manual practice.',
    title: 'Manual Practice - scheduling will not be changed.',
  },
  'surprise-practice': {
    empty: 'No study unit is available for surprise practice.',
    title: 'Surprise Practice - scheduling will not be changed.',
  },
};

const StudyPracticePage = ({
  data,
  unitId,
  mode,
  onSavePracticeAttempt,
  onNavigate,
}: StudyPracticePageProps) => {
  const [answer, setAnswer] = useState('');
  const [guidedResponses, setGuidedResponses] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [revealedAt, setRevealedAt] = useState<string | null>(null);
  const [startedAt] = useState(() => new Date().toISOString());
  const [coveredConceptIds, setCoveredConceptIds] = useState<string[]>([]);
  const [rubricCoverage, setRubricCoverage] = useState<StudyRubricCoverage[]>([]);
  const [countScheduling, setCountScheduling] = useState(false);
  const item = useMemo(
    () =>
      unitId
        ? buildStudySessionItemForUnit({
            data,
            unitId,
            now: new Date(),
            reason: mode,
          })
        : null,
    [data, mode, unitId],
  );

  if (!item) return <StudyEmptyState text={modeText[mode].empty} />;

  const setPracticeRevealed = (nextRevealed: boolean) => {
    setRevealed(nextRevealed);
    setRevealedAt(nextRevealed ? new Date().toISOString() : null);
  };

  const savePracticeRating = async (rating: StudyRating) => {
    const nowIso = revealedAt ?? new Date().toISOString();
    const responseMode = responseModeForStudyItem(item);
    await onSavePracticeAttempt({
      item,
      rating,
      reason: mode,
      answer,
      responseMode,
      guidedResponses,
      coveredConceptIds,
      rubricCoverage,
      revealedAt: nowIso,
      startedAt,
      countScheduling,
    });
    onNavigate('/study/library?tab=units');
  };

  return (
    <div className="space-y-3">
      <section className="rounded border border-amber-700 bg-amber-950/30 p-3 text-sm text-amber-100">
        {modeText[mode].title}
        <label className="mt-3 flex items-center gap-2 text-xs text-amber-50">
          <input
            type="checkbox"
            checked={countScheduling}
            onChange={(event) => setCountScheduling(event.target.checked)}
            className="h-4 w-4 rounded border-amber-600 bg-slate-950"
          />
          Count this practice rating toward scheduling
        </label>
      </section>
      <StudySessionPage
        activeItem={item}
        answer={answer}
        onAnswerChange={setAnswer}
        guidedResponses={guidedResponses}
        onGuidedResponsesChange={setGuidedResponses}
        responseMode={responseModeForStudyItem(item)}
        revealed={revealed}
        onRevealChange={setPracticeRevealed}
        coveredConceptIds={coveredConceptIds}
        onToggleConcept={(conceptId) =>
          setCoveredConceptIds((current) =>
            current.includes(conceptId)
              ? current.filter((entry) => entry !== conceptId)
              : [...current, conceptId].sort(),
          )
        }
        rubricCoverage={rubricCoverage}
        onRubricCoverageChange={setRubricCoverage}
        onRate={savePracticeRating}
        sourceText={sourceTextForStudyItem(data, item)}
      />
    </div>
  );
};

export default StudyPracticePage;
