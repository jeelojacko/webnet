import { useMemo, useState } from 'react';
import { createInitialProgress } from '../studyScheduler';
import type {
  StudyDataSnapshot,
  StudyResponseMode,
  StudyRubricCoverage,
  StudySessionItem,
} from '../studyTypes';
import { StudyEmptyState } from './StudyLayout';
import StudySessionPage from './StudySessionPage';

type StudyPreviewPageProps = {
  data: StudyDataSnapshot;
  unitId: string;
  onNavigate: (_path: string) => void;
};

const responseModeFor = (item: StudySessionItem): StudyResponseMode => {
  if (item.unit.responseModeOverride) return item.unit.responseModeOverride;
  if (item.progress.phase === 'guided-recall') return 'guided';
  return 'free-recall';
};

const sourceTextFor = (data: StudyDataSnapshot, item: StudySessionItem): string => {
  const selectedKeys = new Set(
    item.unit.sourceReferences?.map((reference) => `${reference.documentId}::${reference.sourceKey}`) ?? [],
  );
  return data.legalComponents
    .filter((component) => selectedKeys.has(`${component.documentId}::${component.sourceKey}`))
    .map((component) => `${component.label}${component.heading ? ` ${component.heading}` : ''}\n\n${component.text}`)
    .join('\n\n');
};

const StudyPreviewPage = ({ data, unitId, onNavigate }: StudyPreviewPageProps) => {
  const [answer, setAnswer] = useState('');
  const [guidedResponses, setGuidedResponses] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [coveredConceptIds, setCoveredConceptIds] = useState<string[]>([]);
  const [rubricCoverage, setRubricCoverage] = useState<StudyRubricCoverage[]>([]);

  const item = useMemo<StudySessionItem | null>(() => {
    const unit = data.units.find((entry) => entry.id === unitId);
    if (!unit) return null;
    const prompt =
      data.prompts.find((entry) => entry.unitId === unitId && entry.kind === (unit.promptKind ?? 'guided-recall')) ??
      data.prompts.find((entry) => entry.unitId === unitId);
    if (!prompt) return null;
    const progress = data.progress.find((entry) => entry.unitId === unitId) ?? createInitialProgress(unitId, new Date().toISOString());
    return {
      unit,
      prompt,
      progress,
      concepts: data.concepts
        .filter((concept) => concept.unitId === unitId)
        .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)),
      rubrics: data.rubrics
        .filter((rubric) => rubric.unitId === unitId)
        .sort((a, b) => a.order - b.order || a.prompt.localeCompare(b.prompt)),
      due: false,
    };
  }, [data, unitId]);

  if (!item) return <StudyEmptyState text="Study unit not found." />;

  return (
    <StudySessionPage
      activeItem={item}
      answer={answer}
      onAnswerChange={setAnswer}
      guidedResponses={guidedResponses}
      onGuidedResponsesChange={setGuidedResponses}
      responseMode={responseModeFor(item)}
      revealed={revealed}
      onRevealChange={setRevealed}
      coveredConceptIds={coveredConceptIds}
      onToggleConcept={(conceptId) =>
        setCoveredConceptIds((current) =>
          current.includes(conceptId) ? current.filter((entry) => entry !== conceptId) : [...current, conceptId].sort(),
        )
      }
      rubricCoverage={rubricCoverage}
      onRubricCoverageChange={setRubricCoverage}
      onRate={async () => {}}
      previewMode
      sourceText={sourceTextFor(data, item)}
      onClosePreview={() => onNavigate('/study/library?tab=units')}
    />
  );
};

export default StudyPreviewPage;
