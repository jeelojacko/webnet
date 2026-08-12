import { createInitialProgress } from '../studyScheduler';
import type {
  ImportedLegalComponent,
  StudyConcept,
  StudyDataSnapshot,
  StudyPrompt,
  StudyRubricItem,
  StudyUnit,
} from '../studyTypes';
import { aiPriorityToStudyPriority, type AiStoredUnitProposal } from './studyAiTypes';

const objectiveCategory = (type: string): StudyRubricItem['category'] => {
  if (type === 'scope' || type === 'trigger') return 'scope-trigger';
  if (type === 'actor') return 'actor';
  if (type === 'authority' || type === 'duty' || type === 'prohibition') return 'power-duty';
  if (type === 'required-information') return 'required-material';
  if (type === 'procedure' || type === 'hearing' || type === 'appeal') return 'procedure';
  if (type === 'notice') return 'notice';
  if (type === 'deadline' || type === 'penalty' || type === 'offence') return 'deadline-number';
  if (type === 'exception') return 'limit-exception';
  if (type === 'legal-effect') return 'legal-effect';
  if (type === 'filing' || type === 'evidence') return 'filing-record';
  if (type === 'surveying-practice') return 'survey-relevance';
  if (type === 'relationship') return 'related-provision';
  return 'custom';
};

const makeUnitId = (proposalId: string): string =>
  `unit-ai-${proposalId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)}`;

export const buildStudyUnitFromAiProposal = ({
  proposal,
  sourceComponents,
  existingUnitIds,
  nowIso = new Date().toISOString(),
}: {
  proposal: AiStoredUnitProposal;
  sourceComponents: ImportedLegalComponent[];
  existingUnitIds: Set<string>;
  nowIso?: string;
}): {
  unit: StudyUnit;
  prompt: StudyPrompt;
  concepts: StudyConcept[];
  rubrics: StudyRubricItem[];
  progress: ReturnType<typeof createInitialProgress>;
} => {
  let unitId = makeUnitId(proposal.proposalId);
  let suffix = 2;
  while (existingUnitIds.has(unitId)) {
    unitId = `${makeUnitId(proposal.proposalId)}-${suffix}`;
    suffix += 1;
  }
  const labels = sourceComponents.map((component) => component.label).filter(Boolean);
  const unit: StudyUnit = {
    id: unitId,
    title: proposal.title,
    sourceMode: 'official',
    documentIds: [proposal.sourceDocumentId],
    sectionRefs: labels.map((label) => ({
      documentId: proposal.sourceDocumentId,
      label,
      anchor: label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    })),
    sourceReferences: proposal.sourceKeys.map((sourceKey) => ({
      documentId: proposal.sourceDocumentId,
      sourceKey,
      contentHashAtLinkTime: proposal.sourceHashes[sourceKey] ?? '',
    })),
    generatedContentState: {
      title: 'generated',
      question: 'generated',
      referenceAnswer: 'generated',
      editableSummary: 'generated',
      concepts: 'generated',
      rubrics: 'generated',
    },
    category: 'AI-authored legal source',
    priority: aiPriorityToStudyPriority(proposal.suggestedPriority),
    promptKind: 'guided-recall',
    phase: 'unread',
    unitType: 'section',
    tags: ['ai-authored', proposal.generationMetadata.providerKind],
    editableSummary: proposal.studySummary,
    referenceAnswer: proposal.objectives.map((objective) => objective.studyAnswer).join('\n\n'),
    referenceAnswerOrigin: 'ai-source-grounded',
    generationOrigin: 'ai',
    aiAuthoring: {
      proposalId: proposal.proposalId,
      runId: proposal.runId,
      providerKind: proposal.generationMetadata.providerKind,
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const prompt: StudyPrompt = {
    id: `${unitId}-guided`,
    unitId,
    kind: 'guided-recall',
    question: proposal.mainQuestion,
    referenceAnswer: unit.referenceAnswer,
    conceptIds: proposal.objectives.map((objective, index) => `${unitId}-concept-${index + 1}`),
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  const concepts = proposal.objectives.map(
    (objective, index): StudyConcept => ({
      id: `${unitId}-concept-${index + 1}`,
      unitId,
      label: objective.objective,
      explanation: objective.studyAnswer,
      required: objective.required,
      origin: 'generated',
      order: index,
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
  );
  const rubrics = proposal.objectives.map(
    (objective, index): StudyRubricItem => ({
      id: `${unitId}-rubric-${index + 1}`,
      unitId,
      category: objectiveCategory(objective.type),
      prompt: objective.guidedQuestion,
      referenceAnswer: objective.studyAnswer,
      required: objective.required,
      origin: 'generated',
      order: index,
      sourceReferences: objective.sourceKeys.map((sourceKey) => ({
        documentId: proposal.sourceDocumentId,
        sourceKey,
        contentHashAtLinkTime: proposal.sourceHashes[sourceKey] ?? '',
      })),
      createdAt: nowIso,
      updatedAt: nowIso,
    }),
  );
  return {
    unit,
    prompt,
    concepts,
    rubrics,
    progress: createInitialProgress(unitId, nowIso),
  };
};

export const applyAiProposalApprovalToSnapshot = ({
  snapshot,
  proposal,
  sourceComponents,
  nowIso = new Date().toISOString(),
}: {
  snapshot: StudyDataSnapshot;
  proposal: AiStoredUnitProposal;
  sourceComponents: ImportedLegalComponent[];
  nowIso?: string;
}): StudyDataSnapshot => {
  const approved = buildStudyUnitFromAiProposal({
    proposal,
    sourceComponents,
    existingUnitIds: new Set(snapshot.units.map((unit) => unit.id)),
    nowIso,
  });
  const storedProposal: AiStoredUnitProposal = {
    ...proposal,
    reviewStatus: 'approved',
    approvedUnitId: approved.unit.id,
    updatedAt: nowIso,
  };
  return {
    ...snapshot,
    units: [...snapshot.units, approved.unit],
    prompts: [...snapshot.prompts, approved.prompt],
    concepts: [...snapshot.concepts, ...approved.concepts],
    rubrics: [...snapshot.rubrics, ...approved.rubrics],
    progress: [...snapshot.progress, approved.progress],
    aiUnitProposals: snapshot.aiUnitProposals.map((entry) =>
      entry.proposalId === proposal.proposalId ? storedProposal : entry,
    ),
  };
};
